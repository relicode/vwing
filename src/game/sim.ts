import { updateBeams } from '$/game/beams'
import { spawnBullet, updateBullets } from '$/game/bullets'
import { circleRectContact, circlesOverlap } from '$/game/collision'
import { applyDamage, applyKnockback, isDead } from '$/game/combat'
import {
  BOT_KILL_SCORE,
  CARVE_RADIUS_BASE,
  CARVE_RADIUS_SCALE,
  Color,
  DEATHMATCH_FRAG_SCORE,
  DeviceKind,
  INCENDIARY_BURN_RADIUS,
  MAX_WATER_BODIES,
  SHAKE_DECAY,
  SHIP_DEATH_SHAKE,
  SHIP_FIRE_INTERVAL,
  SHIP_RADIUS,
  SHIP_SMOKE_HEALTH,
  SHIP_SPAWN_CLEAR_RADIUS,
  ShipKind,
  SimMode,
  SMOKE_LIFE,
  SPLASH_MIN_SPEED,
  SPLASH_PARTICLES,
  StructureType,
  TERRAIN_SALT,
  THRUST_PARTICLE_LIFE,
  THRUST_PARTICLE_SPEED,
  WATER_CANNON_WET_RADIUS,
  type WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { resolveInfantryContacts, updateDevices } from '$/game/devices'
import type { Input } from '$/game/input'
import { spawnExplosion, spawnPuff, updateParticles } from '$/game/particles'
import { createRng } from '$/game/rng'
import { respawnShipAt, type ShipEnv, updateShip } from '$/game/ship'
import { resolveShipTerrain } from '$/game/terrain'
import { createTerrain } from '$/game/terrain-map'
import type { Bullet, Ship, Vec2, World } from '$/game/types'
import {
  burnSurface,
  carveVoxel,
  createVoxelTerrain,
  findPool,
  stepVoxel,
  voxelToBlocks,
  wetSurface,
} from '$/game/voxel'
import { addPool, submersion, waterSurfaceAt } from '$/game/water'
import { fireSecondary } from '$/game/weapons'

// Pairs a ship with whatever drives it plus its match bookkeeping. The sim owns these;
// `world.ships` is kept in lockstep (the same Ship objects) for the rest of the pipeline.
export type Combatant = {
  ship: Ship
  input: Input
  name: string
  score: number // points (CAMPAIGN) / frags (DEATHMATCH)
  lives: number // remaining lives; Number.POSITIVE_INFINITY = endless respawns (bots, PvP)
  spawn: Vec2 // CAMPAIGN home respawn point
}

// A combatant died this frame. The caller maps it to its own bookkeeping (HUD, kill feed,
// game-over) and, on the network, to a client-side explosion at (x, y). `killerId` is
// undefined for environmental deaths (terrain crash / wall).
export type DeathEvent = {
  victimId: number
  victimKind: ShipKind
  killerId: number | undefined
  eliminated: boolean // CAMPAIGN: out of lives, removed from play (never true in DEATHMATCH)
  x: number // death location (the networked client spawns the wreck explosion here)
  y: number
}

export type SimConfig = {
  mode: SimMode
  forcedWeapon?: WeaponKind // debug: pins every ship's secondary when set
}

export type Sim = {
  world: World
  combatants: Combatant[]
  config: SimConfig
  step: (dt: number) => DeathEvent[]
  addCombatant: (combatant: Combatant) => void
  removeCombatant: (id: number) => void
  getCombatant: (id: number) => Combatant | undefined
}

// A blank arena: seeded rng + the procedurally generated terrain, with empty entity lists. Ships
// are attached by the sim from its combatants.
export const createWorld = (seed: number): World => {
  // Generate the arena once, off a salted sub-stream, so it's deterministic per seed (identical on
  // server + client) without consuming draws from the run's main rng (which feeds combat/particles).
  const { blocks, water } = createTerrain(createRng((seed ^ TERRAIN_SALT) >>> 0))
  return {
    time: 0,
    ships: [],
    bullets: [],
    particles: [],
    devices: [],
    beams: [],
    blocks,
    terrainVersion: 0,
    water,
    shake: 0,
    rng: createRng(seed),
  }
}

// Candidate respawn anchors spread across the open upper airspace (DEATHMATCH picks the one
// farthest from live enemies). Blocked points are skipped at pick-time, so a few sitting
// inside islands are harmless.
const SPAWN_POINTS: readonly Vec2[] = [0.18, 0.34, 0.5, 0.66, 0.82].flatMap((fx) =>
  [0.22, 0.4].map((fy) => ({ x: WORLD_WIDTH * fx, y: WORLD_HEIGHT * fy }))
)

const pointBlocked = (world: World, x: number, y: number, r: number): boolean => {
  const surface = waterSurfaceAt(world.water, x, y)
  if (surface !== undefined && y + r >= surface) return true // at/under a water surface — not a dry spawn
  return world.blocks.some((b) => circleRectContact(x, y, r, b.x, b.y, b.w, b.h) !== undefined)
}

// The open spawn anchor farthest from every `occupant` (so a (re)spawn isn't a face-off).
// Blocked anchors are skipped; falls back to the first anchor if all are blocked.
export const chooseSpawn = (world: World, occupants: readonly Ship[]): Vec2 => {
  let best: Vec2 = SPAWN_POINTS[0]
  let bestGap = -1
  for (const point of SPAWN_POINTS) {
    if (pointBlocked(world, point.x, point.y, SHIP_RADIUS * 2)) continue
    let nearest = Number.POSITIVE_INFINITY
    for (const ship of occupants) nearest = Math.min(nearest, Math.hypot(ship.x - point.x, ship.y - point.y))
    if (nearest > bestGap) {
      bestGap = nearest
      best = point
    }
  }
  return best
}

export const createSim = (world: World, combatants: Combatant[], config: SimConfig): Sim => {
  world.ships = combatants.map((combatant) => combatant.ship)
  const submergedShips = new Set<number>() // ids currently underwater, for splash-on-crossing
  const eliminated = new Set<number>() // ids removed from play this run (CAMPAIGN, out of lives)
  // Read `water` live: pooling can replace world.water with a new array mid-run, so a one-time
  // snapshot would go stale and ship buoyancy would miss freshly pooled water.
  const env: ShipEnv = {
    get water() {
      return world.water
    },
  }

  // The destructible terrain is authoritative; `world.blocks` is the rectangle view derived
  // from it (for collision, rendering, and the network snapshot).
  const voxel = createVoxelTerrain(world.blocks, world.water)
  let terrainDirty = false // a carve happened this frame; refresh derived blocks before drawing
  const refreshTerrain = (): void => {
    world.blocks = voxelToBlocks(voxel)
    world.terrainVersion += 1
  }
  refreshTerrain()

  const getCombatant = (id: number): Combatant | undefined => combatants.find((c) => c.ship.id === id)

  // The open spawn anchor farthest from every live enemy (so a respawn isn't a face-off).
  const pickSpawn = (exceptId: number): Vec2 => {
    const enemies = combatants.filter((c) => c.ship.id !== exceptId && !eliminated.has(c.ship.id)).map((c) => c.ship)
    return chooseSpawn(world, enemies)
  }

  // Clear deployed devices around a fresh spawn so a respawn isn't an instant re-death.
  const clearSpawnArea = (x: number, y: number): void => {
    world.devices = world.devices.filter((device) => Math.hypot(device.x - x, device.y - y) > SHIP_SPAWN_CLEAR_RADIUS)
  }

  // Blow up a downed ship: credit the killer, then respawn it (or, in CAMPAIGN, eliminate it
  // once its lives run out). Guarded so a ship already reaped this frame isn't killed twice.
  const killShip = (victim: Ship, killerId: number | undefined, events: DeathEvent[]): void => {
    if (eliminated.has(victim.id)) return
    const vc = getCombatant(victim.id)
    if (!vc) return
    const deathX = victim.x // captured before respawn relocates the ship (for the death event)
    const deathY = victim.y
    const color = victim.kind === ShipKind.BOT ? Color.ENEMY : Color.SHIP
    spawnExplosion(world.particles, victim.x, victim.y, color, world.rng, 34)
    world.shake = Math.max(world.shake, SHIP_DEATH_SHAKE)

    const killer = killerId !== undefined && killerId !== victim.id ? getCombatant(killerId) : undefined
    if (killer) killer.score += config.mode === SimMode.DEATHMATCH ? DEATHMATCH_FRAG_SCORE : BOT_KILL_SCORE

    let isEliminated = false
    if (Number.isFinite(vc.lives)) {
      vc.lives -= 1
      if (vc.lives <= 0) isEliminated = true
    }
    if (isEliminated) {
      eliminated.add(victim.id)
    } else {
      const spawn = config.mode === SimMode.DEATHMATCH ? pickSpawn(victim.id) : vc.spawn
      respawnShipAt(victim, spawn.x, spawn.y, world.rng, config.forcedWeapon)
      victim.lastHitBy = undefined
      clearSpawnArea(victim.x, victim.y)
    }
    events.push({
      victimId: victim.id,
      victimKind: victim.kind,
      killerId: killer?.ship.id,
      eliminated: isEliminated,
      x: deathX,
      y: deathY,
    })
  }

  // A shot striking an enemy ship: spark, damage, attribute, and reap on hull depletion.
  // Returns true when the bullet is spent. Invulnerable / eliminated ships and the firer skip.
  const bulletHitShip = (bullet: Bullet, events: DeathEvent[]): boolean => {
    for (const { ship } of combatants) {
      if (ship.id === bullet.owner || ship.invuln > 0 || eliminated.has(ship.id)) continue
      if (!circlesOverlap(bullet.x, bullet.y, bullet.radius, ship.x, ship.y, ship.radius)) continue
      applyDamage(ship, bullet.damage)
      ship.lastHitBy = bullet.owner
      if (bullet.push) applyKnockback(ship, bullet.vx, bullet.vy, bullet.push)
      spawnExplosion(world.particles, bullet.x, bullet.y, bullet.color ?? Color.SPARK, world.rng, 5)
      if (isDead(ship)) killShip(ship, ship.lastHitBy, events)
      return true
    }
    return false
  }

  // Devices/rail report ships they dealt lethal damage to; reap them by their last attacker.
  const reap = (victim: Ship, events: DeathEvent[]): void => {
    if (isDead(victim)) killShip(victim, victim.lastHitBy, events)
  }

  // A bullet that misses every ship is tested against terrain: it's consumed on contact, and a
  // destructible surface (rock/grass/ice) takes a crater sized to the shot — chunks that lose
  // their footing then fall. Bedrock just sparks and stops the shot.
  const resolveBulletHits = (events: DeathEvent[]): void => {
    const surviving: Bullet[] = []
    for (const bullet of world.bullets) {
      if (bulletHitShip(bullet, events)) continue
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
        const block = world.blocks[hit]
        if (bullet.burn) {
          // Incendiary: scorch grass → bare earth (surface only, no carve), with a lick of flame.
          if (burnSurface(voxel, bullet.x, bullet.y, INCENDIARY_BURN_RADIUS)) terrainDirty = true
          spawnExplosion(world.particles, bullet.x, bullet.y, Color.THRUST, world.rng, 7)
        } else if (bullet.wet) {
          // Water cannon: wet bare earth → grass (regrows over time, no carve), and if the impact
          // sits in a cupped basin, pour a pool there (merging into any adjacent body).
          wetSurface(voxel, bullet.x, bullet.y, WATER_CANNON_WET_RADIUS)
          const pool = findPool(voxel, bullet.x, bullet.y)
          if (pool) {
            const pooled = addPool(world.water, pool, MAX_WATER_BODIES)
            if (pooled !== world.water) {
              world.water = pooled
              terrainDirty = true // water is drawn in the terrainVersion-cached layer
            }
          }
          spawnExplosion(world.particles, bullet.x, bullet.y, Color.WATER_EDGE, world.rng, 6)
        } else if (block.structure === StructureType.EARTH) {
          const radius = bullet.radius * CARVE_RADIUS_SCALE + CARVE_RADIUS_BASE
          if (carveVoxel(voxel, bullet.x, bullet.y, radius)) terrainDirty = true
          spawnExplosion(world.particles, bullet.x, bullet.y, Color.ROCK_EDGE, world.rng, 8)
        } else {
          // Indestructible metal: just sparks.
          spawnExplosion(world.particles, bullet.x, bullet.y, Color.SPARK, world.rng, 4)
        }
        continue
      }
      surviving.push(bullet)
    }
    world.bullets = surviving
  }

  // Land/bounce/crash each ship against terrain; only a hard crash (once invuln lapses) kills.
  const resolveTerrain = (dt: number, events: DeathEvent[]): void => {
    for (const { ship } of combatants) {
      if (eliminated.has(ship.id)) continue
      if (resolveShipTerrain(ship, world.blocks, dt) === 'crash' && ship.invuln <= 0) killShip(ship, undefined, events)
    }
  }

  const step = (dt: number): DeathEvent[] => {
    const events: DeathEvent[] = []
    if (world.shake > 0) world.shake = Math.max(0, world.shake - SHAKE_DECAY * dt)
    world.time += dt
    for (const { ship, input: control } of combatants) {
      if (eliminated.has(ship.id)) continue
      updateShip(ship, control, dt, env)
      if (ship.thrusting) {
        const bx = -Math.cos(ship.angle)
        const by = -Math.sin(ship.angle)
        spawnPuff(
          world.particles,
          ship.x + bx * ship.radius,
          ship.y + by * ship.radius,
          bx * THRUST_PARTICLE_SPEED,
          by * THRUST_PARTICLE_SPEED,
          Color.THRUST,
          world.rng,
          THRUST_PARTICLE_LIFE
        )
      }
      if (ship.health < SHIP_SMOKE_HEALTH && ship.invuln <= 0) {
        spawnPuff(world.particles, ship.x, ship.y, 0, -30, Color.SMOKE, world.rng, SMOKE_LIFE)
      }
      const surface = waterSurfaceAt(world.water, ship.x, ship.y)
      if (surface !== undefined) {
        const wet = submersion(ship, world.water) > 0
        if (wet !== submergedShips.has(ship.id) && Math.abs(ship.vy) > SPLASH_MIN_SPEED) {
          spawnExplosion(world.particles, ship.x, surface, Color.WATER_EDGE, world.rng, SPLASH_PARTICLES)
        }
        if (wet) submergedShips.add(ship.id)
        else submergedShips.delete(ship.id)
      }
      if (control.firing() && ship.fireCooldown <= 0 && ship.disabled <= 0) {
        spawnBullet(world.bullets, ship)
        ship.fireCooldown = SHIP_FIRE_INTERVAL
      }
      if (control.altFiring()) for (const killed of fireSecondary(world, ship)) reap(killed, events)
    }
    world.bullets = updateBullets(world.bullets, dt)
    for (const killed of updateDevices(world, dt)) reap(killed, events)
    updateBeams(world, dt)
    world.particles = updateParticles(world.particles, dt)
    resolveBulletHits(events)
    resolveTerrain(dt, events)
    resolveInfantryContacts(world)
    // Advance loosed terrain chunks; rebuild the derived blocks if the terrain changed this frame.
    const debrisMoved = stepVoxel(voxel, dt)
    if (terrainDirty || debrisMoved) {
      refreshTerrain()
      terrainDirty = false
    }
    return events
  }

  const addCombatant = (combatant: Combatant): void => {
    combatants.push(combatant)
    world.ships.push(combatant.ship)
  }

  const removeCombatant = (id: number): void => {
    const index = combatants.findIndex((c) => c.ship.id === id)
    if (index < 0) return
    combatants.splice(index, 1)
    world.ships = world.ships.filter((ship) => ship.id !== id)
    world.devices = world.devices.filter((device) => device.owner !== id) // drop orphaned mines/troopers
    eliminated.delete(id)
    submergedShips.delete(id)
  }

  return { world, combatants, config, step, addCombatant, removeCombatant, getCombatant }
}
