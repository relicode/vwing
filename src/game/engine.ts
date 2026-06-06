import { Application } from 'pixi.js'

import { createWave, splitAsteroid, updateAsteroids } from '$/game/asteroids'
import { createBotInput } from '$/game/bot'
import { spawnBullet, updateBullets } from '$/game/bullets'
import { circlesOverlap } from '$/game/collision'
import { applyDamage, isDead } from '$/game/combat'
import {
  ASTEROID_BASE_COUNT,
  ASTEROID_CONFIG,
  ASTEROID_PER_WAVE,
  AsteroidSize,
  BOT_ID,
  BOT_KILL_SCORE,
  BULLET_DAMAGE,
  Color,
  GamePhase,
  PLAYER_ID,
  SHIP_FIRE_INTERVAL,
  SHIP_SPAWN_CLEAR_RADIUS,
  SHIP_START_LIVES,
  ShipKind,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from '$/game/constants'
import { createInput, type Input } from '$/game/input'
import { spawnExplosion, updateParticles } from '$/game/particles'
import { createRenderer } from '$/game/renderer'
import { createRng } from '$/game/rng'
import { BOT_SPAWN_X, BOT_SPAWN_Y, createShip, respawnShip, respawnShipAt, shipHitWall, updateShip } from '$/game/ship'
import type { Asteroid, Bullet, EngineStatus, Ship, World } from '$/game/types'

// Pairs a ship with whatever drives it — keyboard for the player, AI for the bot.
type Combatant = { ship: Ship; input: Input }

const BEST_KEY = 'vwing.best'
const MAX_FRAME_DT = 1 / 30 // clamp long frames (tab switch) so the sim never leaps

export type Engine = {
  canvas: HTMLCanvasElement
  getStatus: () => EngineStatus
  subscribe: (listener: () => void) => () => void
  start: () => void
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

const explosionCount = (size: AsteroidSize): number =>
  size === AsteroidSize.LARGE ? 26 : size === AsteroidSize.MEDIUM ? 18 : 12

const createWorld = (seed: number): World => {
  const rng = createRng(seed)
  const player = createShip(ShipKind.PLAYER)
  const bot = createShip(ShipKind.BOT, BOT_SPAWN_X, BOT_SPAWN_Y, BOT_ID)
  return {
    time: 0,
    wave: 1,
    ships: [player, bot],
    bullets: [],
    asteroids: createWave(rng, ASTEROID_BASE_COUNT, player, SHIP_SPAWN_CLEAR_RADIUS),
    particles: [],
    devices: [],
    beams: [],
    pools: [],
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
    wave: world.wave,
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
      status.wave === world.wave &&
      status.weapon === player.weapon &&
      status.ammo === player.ammo
    ) {
      return
    }
    status = { phase, score: flooredScore, lives, best, wave: world.wave, weapon: player.weapon, ammo: player.ammo }
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

  // Clear rocks around a fresh spawn so a respawn isn't an instant re-death.
  const clearRocksAround = (x: number, y: number): void => {
    world.asteroids = world.asteroids.filter(
      (asteroid) => Math.hypot(asteroid.x - x, asteroid.y - y) > SHIP_SPAWN_CLEAR_RADIUS
    )
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
      respawnShip(ship)
    } else {
      score += BOT_KILL_SCORE
      respawnShipAt(ship, BOT_SPAWN_X, BOT_SPAWN_Y)
    }
    clearRocksAround(ship.x, ship.y)
  }

  // A shot striking an enemy ship: spark, deal damage, and destroy on hull depletion.
  // Returns true when the bullet is spent. Invulnerable ships and the firer are skipped.
  const bulletHitShip = (bullet: Bullet): boolean => {
    for (const { ship } of combatants) {
      if (ship.id === bullet.owner || ship.invuln > 0) continue
      if (!circlesOverlap(bullet.x, bullet.y, bullet.radius, ship.x, ship.y, ship.radius)) continue
      applyDamage(ship, BULLET_DAMAGE)
      spawnExplosion(world.particles, bullet.x, bullet.y, Color.SPARK, world.rng, 5)
      if (isDead(ship)) destroyShip(ship)
      return true
    }
    return false
  }

  const resolveBulletHits = (): void => {
    const removed = new Set<number>()
    const spawned: Asteroid[] = []
    const survivingBullets: Bullet[] = []
    for (const bullet of world.bullets) {
      if (bulletHitShip(bullet)) continue
      let consumed = false
      for (let i = 0; i < world.asteroids.length; i += 1) {
        if (removed.has(i)) continue
        const asteroid = world.asteroids[i]
        if (circlesOverlap(bullet.x, bullet.y, bullet.radius, asteroid.x, asteroid.y, asteroid.radius)) {
          removed.add(i)
          if (bullet.owner === PLAYER_ID) score += ASTEROID_CONFIG[asteroid.size].score
          spawnExplosion(
            world.particles,
            asteroid.x,
            asteroid.y,
            Color.ASTEROID_EDGE,
            world.rng,
            explosionCount(asteroid.size)
          )
          spawned.push(...splitAsteroid(asteroid, world.rng))
          consumed = true
          break
        }
      }
      if (!consumed) survivingBullets.push(bullet)
    }
    world.bullets = survivingBullets
    if (removed.size > 0) {
      world.asteroids = world.asteroids.filter((_, i) => !removed.has(i)).concat(spawned)
    }
  }

  // Walls are lethal to everyone (even mid-invuln); asteroids only bite once invuln lapses.
  const resolveCrashes = (): void => {
    for (const { ship } of combatants) {
      const crashed =
        shipHitWall(ship) ||
        (ship.invuln <= 0 &&
          world.asteroids.some((asteroid) =>
            circlesOverlap(ship.x, ship.y, ship.radius * 0.8, asteroid.x, asteroid.y, asteroid.radius)
          ))
      if (crashed) destroyShip(ship)
      if (gameOver()) return
    }
  }

  const advanceWaveIfClear = (): void => {
    if (world.asteroids.length > 0) return
    world.wave += 1
    const count = ASTEROID_BASE_COUNT + ASTEROID_PER_WAVE * (world.wave - 1)
    world.asteroids = createWave(world.rng, count, world.ships[0], SHIP_SPAWN_CLEAR_RADIUS)
  }

  const stepPlaying = (dt: number): void => {
    world.time += dt
    for (const { ship, input: control } of combatants) {
      updateShip(ship, control, dt)
      if (control.firing() && ship.fireCooldown <= 0) {
        spawnBullet(world.bullets, ship)
        ship.fireCooldown = SHIP_FIRE_INTERVAL
      }
    }
    world.bullets = updateBullets(world.bullets, dt)
    updateAsteroids(world.asteroids, dt)
    world.particles = updateParticles(world.particles, dt)

    resolveBulletHits()
    if (gameOver()) return
    resolveCrashes()
    if (gameOver()) return
    advanceWaveIfClear()
  }

  const step = (dt: number): void => {
    if (phase === GamePhase.PLAYING) {
      stepPlaying(dt)
    } else {
      // Title + game-over: keep the rocks drifting (and debris fading) as ambiance.
      world.time += dt
      updateAsteroids(world.asteroids, dt)
      world.particles = updateParticles(world.particles, dt)
    }
  }

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_DT)
    step(dt)
    publish()
    renderer.draw(world, phase)
  })

  const start = (): void => {
    score = 0
    lives = SHIP_START_LIVES
    world = createWorld(makeSeed())
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
