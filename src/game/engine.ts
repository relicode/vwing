import { Application } from 'pixi.js'

import { updateBeams } from '$/game/beams'
import { createBotInput } from '$/game/bot'
import { spawnBullet, updateBullets } from '$/game/bullets'
import { circleRectContact, circlesOverlap } from '$/game/collision'
import { applyDamage, applyKnockback, isDead } from '$/game/combat'
import {
  BOT_ID,
  BOT_KILL_SCORE,
  Color,
  DeviceKind,
  GamePhase,
  INFANTRY_PICKUP_RADIUS,
  INFANTRY_PICKUP_SPEED,
  PLAYER_ID,
  SHIP_FIRE_INTERVAL,
  SHIP_SPAWN_CLEAR_RADIUS,
  SHIP_START_LIVES,
  ShipKind,
  SurfaceMaterial,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WEAPON_CONFIG,
  WeaponKind,
} from '$/game/constants'
import { updateDevices } from '$/game/devices'
import { createInput, type Input } from '$/game/input'
import { spawnExplosion, updateParticles } from '$/game/particles'
import { createRenderer } from '$/game/renderer'
import { createRng } from '$/game/rng'
import {
  BOT_SPAWN_X,
  BOT_SPAWN_Y,
  createShip,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Y,
  respawnShip,
  respawnShipAt,
  updateShip,
} from '$/game/ship'
import { resolveShipTerrain } from '$/game/terrain'
import { createTerrain } from '$/game/terrain-map'
import type { Bullet, EngineStatus, Ship, World } from '$/game/types'
import { fireSecondary } from '$/game/weapons'

// Pairs a ship with whatever drives it — keyboard for the player, AI for the bot.
type Combatant = { ship: Ship; input: Input }

const BEST_KEY = 'vwing.best'
const MAX_FRAME_DT = 1 / 30 // clamp long frames (tab switch) so the sim never leaps

export type Engine = {
  canvas: HTMLCanvasElement
  getStatus: () => EngineStatus
  subscribe: (listener: () => void) => () => void
  start: (weapon?: WeaponKind) => void // weapon = debug override; undefined = random per life
  destroy: () => void
}

const makeSeed = (): number => Math.floor(Math.random() * 0xffffffff)

const readBest = (): number => {
  const raw = globalThis.localStorage?.getItem(BEST_KEY)
  const value = raw ? Number.parseInt(raw, 10) : 0
  return Number.isFinite(value) ? value : 0
}

const writeBest = (value: number): void => {
  globalThis.localStorage?.setItem(BEST_KEY, String(value))
}

const createWorld = (seed: number, forcedWeapon?: WeaponKind): World => {
  const rng = createRng(seed)
  const player = createShip(ShipKind.PLAYER, PLAYER_SPAWN_X, PLAYER_SPAWN_Y, PLAYER_ID, rng, forcedWeapon)
  const bot = createShip(ShipKind.BOT, BOT_SPAWN_X, BOT_SPAWN_Y, BOT_ID, rng, forcedWeapon)
  const { blocks, water } = createTerrain()
  return {
    time: 0,
    ships: [player, bot],
    bullets: [],
    particles: [],
    devices: [],
    beams: [],
    blocks,
    water,
    rng,
  }
}

export const createEngine = async (): Promise<Engine> => {
  const app = new Application()
  await app.init({
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    background: Color.BACKGROUND,
    antialias: true,
    resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    autoDensity: false,
  })
  app.canvas.style.width = '100%'
  app.canvas.style.height = '100%'
  app.canvas.style.display = 'block'

  const renderer = createRenderer(createRng(0xc0ffee))
  app.stage.addChild(renderer.view)
  const input = createInput(window)

  let phase = GamePhase.TITLE
  let score = 0
  let lives = SHIP_START_LIVES
  let best = readBest()
  let forcedWeapon: WeaponKind | undefined // debug: pins every ship's secondary when set
  let world = createWorld(makeSeed())

  // The player drives ships[0] with the keyboard; bots get an AI Input bound to the
  // world they were built for (rebuilt on every restart, so it's always the live sim).
  const buildCombatants = (w: World): Combatant[] =>
    w.ships.map((ship) =>
      ship.kind === ShipKind.PLAYER ? { ship, input } : { ship, input: createBotInput(ship, () => w) }
    )

  let combatants = buildCombatants(world)

  const listeners = new Set<() => void>()
  // The HUD reflects the local player (ships[0] by construction).
  const playerShip = (): Ship => world.ships[0]
  let status: EngineStatus = {
    phase,
    score,
    lives,
    best,
    weapon: playerShip().weapon,
    ammo: playerShip().ammo,
  }

  const publish = (): void => {
    const flooredScore = Math.floor(score)
    const player = playerShip()
    if (
      status.phase === phase &&
      status.score === flooredScore &&
      status.lives === lives &&
      status.best === best &&
      status.weapon === player.weapon &&
      status.ammo === player.ammo
    ) {
      return
    }
    status = { phase, score: flooredScore, lives, best, weapon: player.weapon, ammo: player.ammo }
    for (const listener of listeners) listener()
  }

  const endGame = (): void => {
    phase = GamePhase.GAME_OVER
    const finalScore = Math.floor(score)
    if (finalScore > best) {
      best = finalScore
      writeBest(best)
    }
  }

  // Read through a helper so phase comparisons survive control-flow narrowing
  // (endGame flips `phase` from inside nested helpers TS can't see into).
  const gameOver = (): boolean => phase === GamePhase.GAME_OVER

  // Clear rocks AND deployed devices (mines, wells, …) around a fresh spawn so a
  // respawn isn't an instant re-death.
  const clearSpawnArea = (x: number, y: number): void => {
    world.devices = world.devices.filter((device) => Math.hypot(device.x - x, device.y - y) > SHIP_SPAWN_CLEAR_RADIUS)
  }

  // Blow up a destroyed ship. The player costs a life (and ends the run when out);
  // a downed bot scores for the player, then both respawn at their home with invuln.
  const destroyShip = (ship: Ship): void => {
    const isPlayer = ship.kind === ShipKind.PLAYER
    spawnExplosion(world.particles, ship.x, ship.y, isPlayer ? Color.SHIP : Color.ENEMY, world.rng, 34)
    if (isPlayer) {
      lives -= 1
      if (lives <= 0) {
        endGame()
        return
      }
      respawnShip(ship, world.rng, forcedWeapon)
    } else {
      score += BOT_KILL_SCORE
      respawnShipAt(ship, BOT_SPAWN_X, BOT_SPAWN_Y, world.rng, forcedWeapon)
    }
    clearSpawnArea(ship.x, ship.y)
  }

  // Devices/rail report ships they dealt lethal damage to; reap them (guarded so an
  // already-respawned ship isn't destroyed twice in one frame).
  const reap = (ship: Ship): void => {
    if (isDead(ship)) destroyShip(ship)
  }

  // A shot striking an enemy ship: spark, deal damage, and destroy on hull depletion.
  // Returns true when the bullet is spent. Invulnerable ships and the firer are skipped.
  const bulletHitShip = (bullet: Bullet): boolean => {
    for (const { ship } of combatants) {
      if (ship.id === bullet.owner || ship.invuln > 0) continue
      if (!circlesOverlap(bullet.x, bullet.y, bullet.radius, ship.x, ship.y, ship.radius)) continue
      applyDamage(ship, bullet.damage)
      if (bullet.push) applyKnockback(ship, bullet.vx, bullet.vy, bullet.push)
      spawnExplosion(world.particles, bullet.x, bullet.y, bullet.color ?? Color.SPARK, world.rng, 5)
      if (isDead(ship)) destroyShip(ship)
      return true
    }
    return false
  }

  // A bullet that misses every ship is tested against terrain: it's consumed on contact,
  // and a ROCK block is destroyed outright (BEDROCK/GRASS/ICE just stop the shot).
  const resolveBulletHits = (): void => {
    const survivingBullets: Bullet[] = []
    for (const bullet of world.bullets) {
      if (bulletHitShip(bullet)) continue
      // A bullet touching an enemy-owned infantry unit kills it outright (one hit, one life).
      const unit = world.devices.findIndex(
        (d) =>
          d.kind === DeviceKind.INFANTRY &&
          d.owner !== bullet.owner &&
          circlesOverlap(bullet.x, bullet.y, bullet.radius, d.x, d.y, d.radius)
      )
      if (unit >= 0) {
        const inf = world.devices[unit]
        spawnExplosion(world.particles, inf.x, inf.y, Color.BLOOD, world.rng, 6)
        world.devices.splice(unit, 1)
        continue
      }
      const hit = world.blocks.findIndex((b) =>
        circleRectContact(bullet.x, bullet.y, bullet.radius, b.x, b.y, b.w, b.h)
      )
      if (hit >= 0) {
        const rock = world.blocks[hit].material === SurfaceMaterial.ROCK
        spawnExplosion(
          world.particles,
          bullet.x,
          bullet.y,
          rock ? Color.ROCK_EDGE : Color.SPARK,
          world.rng,
          rock ? 8 : 4
        )
        if (rock) world.blocks.splice(hit, 1)
        continue
      }
      survivingBullets.push(bullet)
    }
    world.bullets = survivingBullets
  }

  // Land/bounce/crash each ship against terrain; only a hard 'crash' (once invuln lapses)
  // destroys it. resolveShipTerrain also pushes ships clear and rests them on surfaces.
  const resolveTerrain = (dt: number): void => {
    for (const { ship } of combatants) {
      if (resolveShipTerrain(ship, world.blocks, dt) === 'crash' && ship.invuln <= 0) destroyShip(ship)
      if (gameOver()) return
    }
  }

  // An owner drifting slowly over its own landed/swimming infantry scoops one up, restoring
  // an Infantry charge (and switching its secondary back to Infantry).
  const resolvePickups = (): void => {
    const cap = WEAPON_CONFIG[WeaponKind.INFANTRY].ammo
    for (const { ship } of combatants) {
      if (Math.hypot(ship.vx, ship.vy) > INFANTRY_PICKUP_SPEED) continue
      const idx = world.devices.findIndex(
        (d) =>
          d.kind === DeviceKind.INFANTRY &&
          d.owner === ship.id &&
          d.pickupLock <= 0 &&
          (d.attached || d.swim > 0) &&
          circlesOverlap(ship.x, ship.y, INFANTRY_PICKUP_RADIUS, d.x, d.y, d.radius)
      )
      if (idx < 0) continue
      world.devices.splice(idx, 1)
      const wasInfantry = ship.weapon === WeaponKind.INFANTRY
      ship.weapon = WeaponKind.INFANTRY
      ship.ammo = Math.min(cap, (wasInfantry ? ship.ammo : 0) + 1)
      ship.altCooldown = 0
    }
  }

  const stepPlaying = (dt: number): void => {
    world.time += dt
    const env = { water: world.water }
    for (const { ship, input: control } of combatants) {
      updateShip(ship, control, dt, env)
      if (control.firing() && ship.fireCooldown <= 0 && ship.disabled <= 0) {
        spawnBullet(world.bullets, ship)
        ship.fireCooldown = SHIP_FIRE_INTERVAL
      }
      if (control.altFiring()) for (const killed of fireSecondary(world, ship)) reap(killed)
      if (gameOver()) return
    }
    world.bullets = updateBullets(world.bullets, dt)
    for (const killed of updateDevices(world, dt)) reap(killed)
    if (gameOver()) return
    updateBeams(world, dt)
    world.particles = updateParticles(world.particles, dt)

    resolveBulletHits()
    if (gameOver()) return
    resolveTerrain(dt)
    if (gameOver()) return
    resolvePickups()
  }

  const step = (dt: number): void => {
    if (phase === GamePhase.PLAYING) {
      stepPlaying(dt)
    } else {
      // Title + game-over: just let debris and beams fade as ambiance (terrain is static).
      world.time += dt
      world.particles = updateParticles(world.particles, dt)
      updateBeams(world, dt)
    }
  }

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_DT)
    step(dt)
    publish()
    renderer.draw(world, phase)
  })

  const start = (weapon?: WeaponKind): void => {
    forcedWeapon = weapon
    score = 0
    lives = SHIP_START_LIVES
    world = createWorld(makeSeed(), forcedWeapon)
    combatants = buildCombatants(world)
    phase = GamePhase.PLAYING
    publish()
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const destroy = (): void => {
    input.destroy()
    app.ticker.stop()
    renderer.destroy()
    app.destroy(true)
    listeners.clear()
  }

  return { canvas: app.canvas, getStatus: () => status, subscribe, start, destroy }
}
