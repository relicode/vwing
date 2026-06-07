import { pushBullet } from '$/game/bullets'
import { circleRectContact, circlesOverlap, segmentIntersectsRect } from '$/game/collision'
import { applyDamage, applyDisable, isDead } from '$/game/combat'
import {
  BLAST_SHAKE,
  Color,
  DeviceKind,
  FLAK_SHARD_DAMAGE,
  FLAK_SHARD_LIFE,
  FLAK_SHARD_SPEED,
  FLAK_SHARDS,
  GRAVITY,
  GRENADE_FUSE,
  GRENADE_RADIUS,
  GRENADE_SHARD_DAMAGE,
  GRENADE_SHARD_LIFE,
  GRENADE_SHARD_SPEED,
  GRENADE_SHARDS,
  GRENADE_SPEED,
  INFANTRY_FALL_LETHAL,
  INFANTRY_FIRE_INTERVAL,
  INFANTRY_GRENADE_FIRE_INTERVAL,
  INFANTRY_PARACHUTE_FIRE_INTERVAL,
  INFANTRY_RANGE,
  INFANTRY_SHOT_DAMAGE,
  INFANTRY_SHOT_SPEED,
  INFANTRY_SINK_SPEED,
  INFANTRY_SINK_TIME,
  INFANTRY_SWIM_DRAG,
  INFANTRY_SWIM_TIME,
  INFANTRY_WALK_SPEED,
  INFANTRY_WALK_TURN_CHANCE,
  InfantryWeapon,
  PARACHUTE_BRAKE,
  PARACHUTE_DEPLOY_SPEED,
  PARACHUTE_OPEN_TIME,
  PARACHUTE_TERMINAL,
  WALL_THICKNESS,
  WELL_MAX_ACCEL,
  WELL_MIN_DIST,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { TWO_PI, wrapAngle } from '$/game/math'
import { spawnExplosion } from '$/game/particles'
import { randRange } from '$/game/rng'
import type { Block, Device, Ship, World } from '$/game/types'
import { waterSurfaceAt } from '$/game/water'

// True when no terrain block sits on the straight line between two points (infantry LOS).
const hasLineOfSight = (x1: number, y1: number, x2: number, y2: number, blocks: Block[]): boolean =>
  !blocks.some((b) => segmentIntersectsRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h))

const inBounds = (x: number, y: number): boolean =>
  x > WALL_THICKNESS && x < WORLD_WIDTH - WALL_THICKNESS && y > WALL_THICKNESS && y < WORLD_HEIGHT - WALL_THICKNESS

const nearestEnemyOf = (ownerId: number, x: number, y: number, ships: Ship[]): Ship | undefined => {
  let best: Ship | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const ship of ships) {
    if (ship.id === ownerId) continue
    const d = Math.hypot(ship.x - x, ship.y - y)
    if (d < bestDist) {
      bestDist = d
      best = ship
    }
  }
  return best
}

// Damage every enemy ship within `radius`, collecting any that die. `exclude` skips
// a ship already damaged directly (so a missile's splash never double-hits its target).
// Enemy infantry caught in the radius are splattered (added to `deadDevices`).
const areaDamage = (
  world: World,
  x: number,
  y: number,
  radius: number,
  damage: number,
  ownerId: number,
  dead: Set<Ship>,
  deadDevices: Set<Device>,
  exclude?: Ship
): void => {
  world.shake = Math.max(world.shake, BLAST_SHAKE)
  for (const ship of world.ships) {
    if (ship.id === ownerId || ship.invuln > 0 || ship === exclude) continue
    if (Math.hypot(ship.x - x, ship.y - y) > radius) continue
    applyDamage(ship, damage)
    if (isDead(ship)) dead.add(ship)
  }
  for (const device of world.devices) {
    if (device.kind !== DeviceKind.INFANTRY || device.owner === ownerId || deadDevices.has(device)) continue
    if (Math.hypot(device.x - x, device.y - y) > radius) continue
    spawnExplosion(world.particles, device.x, device.y, Color.BLOOD, world.rng, 6)
    deadDevices.add(device)
  }
}

const spawnShards = (
  world: World,
  x: number,
  y: number,
  owner: number,
  count: number,
  speed: number,
  life: number,
  damage: number
): void => {
  const base = randRange(world.rng, 0, TWO_PI)
  for (let i = 0; i < count; i += 1) {
    const angle = base + (i / count) * TWO_PI
    pushBullet(world.bullets, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      owner,
      damage,
      life,
      color: Color.SHRAPNEL,
    })
  }
}

type InfantryDevice = Extract<Device, { kind: DeviceKind.INFANTRY }>

// A grenadier's lob: an arcing GRENADE device aimed along `angle` (gravity + fuse → shards,
// just like the ship's Grenade Lob). Queued in `spawned` so we don't mutate mid-iteration.
const lobGrenade = (spawned: Device[], device: InfantryDevice, angle: number): void => {
  spawned.push({
    kind: DeviceKind.GRENADE,
    x: device.x,
    y: device.y - device.radius,
    vx: Math.cos(angle) * GRENADE_SPEED,
    vy: Math.sin(angle) * GRENADE_SPEED,
    owner: device.owner,
    radius: GRENADE_RADIUS,
    fuse: GRENADE_FUSE,
  })
}

// Fire at the nearest enemy in range with clear line of sight, at the given cadence.
// Rifles shoot straight; grenadiers lob. Ticks the cooldown every frame regardless.
const infantryFire = (world: World, device: InfantryDevice, spawned: Device[], interval: number, dt: number): void => {
  device.fireCooldown -= dt
  if (device.fireCooldown > 0) return
  const target = nearestEnemyOf(device.owner, device.x, device.y, world.ships)
  if (!target || Math.hypot(target.x - device.x, target.y - device.y) > INFANTRY_RANGE) return
  if (!hasLineOfSight(device.x, device.y, target.x, target.y, world.blocks)) return
  const angle = Math.atan2(target.y - device.y, target.x - device.x)
  if (device.weapon === InfantryWeapon.GRENADE) {
    lobGrenade(spawned, device, angle)
  } else {
    pushBullet(
      world.bullets,
      device.x,
      device.y,
      Math.cos(angle) * INFANTRY_SHOT_SPEED,
      Math.sin(angle) * INFANTRY_SHOT_SPEED,
      {
        owner: device.owner,
        damage: INFANTRY_SHOT_DAMAGE,
        life: INFANTRY_RANGE / INFANTRY_SHOT_SPEED,
        color: Color.INFANTRY,
      }
    )
  }
  // Muzzle flash at the barrel tip.
  const flash = device.weapon === InfantryWeapon.GRENADE ? Color.GRENADE : Color.SPARK
  const mx = device.x + Math.cos(angle) * device.radius * 1.8
  const my = device.y + Math.sin(angle) * device.radius * 1.8
  spawnExplosion(world.particles, mx, my, flash, world.rng, 3)
  device.fireCooldown = interval
}

// Walk back and forth along the supporting block, turning at its edges (never off it) and
// occasionally reversing on a whim. `facing` tracks the movement direction for the sprite.
const patrolInfantry = (device: InfantryDevice, world: World, dt: number): void => {
  const min = device.groundLeft + device.radius
  const max = device.groundRight - device.radius
  if (max <= min) {
    device.facing = device.walkDir
    return
  }
  if (world.rng() < INFANTRY_WALK_TURN_CHANCE) device.walkDir = -device.walkDir
  device.x += device.walkDir * INFANTRY_WALK_SPEED * dt
  if (device.x <= min) {
    device.x = min
    device.walkDir = 1
  } else if (device.x >= max) {
    device.x = max
    device.walkDir = -1
  }
  device.facing = device.walkDir
}

// Advance one device. Mutates the device and the world (spawns shards/shots/blasts),
// adds any killed ships to `dead`, and returns whether the device survives the frame.
const stepDevice = (
  world: World,
  device: Device,
  dt: number,
  dead: Set<Ship>,
  deadDevices: Set<Device>,
  spawned: Device[]
): boolean => {
  switch (device.kind) {
    case DeviceKind.MISSILE: {
      if (device.turnRate > 0) {
        const target = nearestEnemyOf(device.owner, device.x, device.y, world.ships)
        if (target) {
          const desired = Math.atan2(target.y - device.y, target.x - device.x)
          const heading = Math.atan2(device.vy, device.vx)
          const step = Math.max(-device.turnRate * dt, Math.min(device.turnRate * dt, wrapAngle(desired - heading)))
          const next = heading + step
          device.vx = Math.cos(next) * device.speed
          device.vy = Math.sin(next) * device.speed
        }
      }
      device.x += device.vx * dt
      device.y += device.vy * dt
      device.life -= dt
      for (const ship of world.ships) {
        if (ship.id === device.owner || ship.invuln > 0) continue
        if (!circlesOverlap(device.x, device.y, device.radius, ship.x, ship.y, ship.radius)) continue
        if (device.damage > 0) {
          applyDamage(ship, device.damage)
          if (isDead(ship)) dead.add(ship)
          if (device.blastRadius > 0) {
            areaDamage(
              world,
              device.x,
              device.y,
              device.blastRadius,
              device.blastDamage,
              device.owner,
              dead,
              deadDevices,
              ship
            )
          }
        }
        if (device.disableTime > 0) applyDisable(ship, device.disableTime, device.shieldDrain)
        spawnExplosion(world.particles, device.x, device.y, device.color, world.rng, 16)
        return false
      }
      if (device.life <= 0 || !inBounds(device.x, device.y)) return false
      return true
    }

    case DeviceKind.MINE: {
      device.armTime -= dt
      device.life -= dt
      if (device.armTime <= 0) {
        for (const ship of world.ships) {
          if (ship.id === device.owner || ship.invuln > 0) continue
          if (Math.hypot(ship.x - device.x, ship.y - device.y) > device.triggerRadius) continue
          areaDamage(world, device.x, device.y, device.blastRadius, device.damage, device.owner, dead, deadDevices)
          spawnExplosion(world.particles, device.x, device.y, Color.MINE_ARMED, world.rng, 22)
          return false
        }
      }
      return device.life > 0
    }

    case DeviceKind.INFANTRY: {
      if (device.pickupLock > 0) device.pickupLock -= dt
      // Drowned corpse: sink and fade for a moment, then vanish (no explosion).
      if (device.sinking > 0) {
        device.sinking -= dt
        device.y += INFANTRY_SINK_SPEED * dt
        return device.sinking > 0
      }
      // Swimming: bob at the surface, drift to a stop, hold fire — begin sinking on drown.
      if (device.swim > 0) {
        device.swim -= dt
        const surface = waterSurfaceAt(world.water, device.x)
        if (surface !== undefined) device.y = surface + device.radius * 0.2
        device.vy = 0
        device.x += device.vx * dt
        device.vx *= Math.exp(-INFANTRY_SWIM_DRAG * dt)
        if (device.swim <= 0) {
          device.sinking = INFANTRY_SINK_TIME
          return true
        }
        return true
      }
      // Airborne: fall (with optional parachute braking), then land / splat / start swimming.
      if (!device.attached) {
        device.vy += GRAVITY * dt
        // Parachute: deploy past a fast descent, then open over time and brake toward terminal.
        // A high drop fully opens and lands soft; a too-low one opens late and may still splat.
        if (device.chute < 0 && device.vy > PARACHUTE_DEPLOY_SPEED) device.chute = 0
        if (device.chute >= 0) {
          device.chute = Math.min(1, device.chute + dt / PARACHUTE_OPEN_TIME)
          device.vy += (PARACHUTE_TERMINAL - device.vy) * device.chute * PARACHUTE_BRAKE * dt
          infantryFire(world, device, spawned, INFANTRY_PARACHUTE_FIRE_INTERVAL, dt) // fire slowly while descending
        }
        device.x += device.vx * dt
        device.y += device.vy * dt
        for (const block of world.blocks) {
          const c = circleRectContact(device.x, device.y, device.radius, block.x, block.y, block.w, block.h)
          if (!c) continue
          const impact = -(device.vx * c.nx + device.vy * c.ny)
          if (impact > INFANTRY_FALL_LETHAL) {
            spawnExplosion(world.particles, device.x, device.y, Color.BLOOD, world.rng, 6)
            return false
          }
          device.x += c.nx * c.depth
          device.y += c.ny * c.depth
          device.vx = 0
          device.vy = 0
          device.attached = true
          device.chute = -1
          device.groundLeft = block.x
          device.groundRight = block.x + block.w
          spawnExplosion(world.particles, device.x, device.y + device.radius, Color.ROCK_EDGE, world.rng, 4) // landing dust
          break
        }
        if (!device.attached) {
          const surface = waterSurfaceAt(world.water, device.x)
          if (surface !== undefined && device.y + device.radius >= surface) {
            device.swim = INFANTRY_SWIM_TIME
            device.vy = 0
            device.chute = -1
          }
        }
        return true
      }
      // Landed: patrol the supporting block (never off its edges) and fire at the nearest enemy.
      patrolInfantry(device, world, dt)
      const interval =
        device.weapon === InfantryWeapon.GRENADE ? INFANTRY_GRENADE_FIRE_INTERVAL : INFANTRY_FIRE_INTERVAL
      infantryFire(world, device, spawned, interval, dt)
      return true // landed unit persists until it's killed or picked up
    }

    case DeviceKind.GRENADE: {
      device.vy += GRAVITY * dt
      device.x += device.vx * dt
      device.y += device.vy * dt
      device.fuse -= dt
      if (device.fuse <= 0 || !inBounds(device.x, device.y)) {
        spawnShards(
          world,
          device.x,
          device.y,
          device.owner,
          GRENADE_SHARDS,
          GRENADE_SHARD_SPEED,
          GRENADE_SHARD_LIFE,
          GRENADE_SHARD_DAMAGE
        )
        spawnExplosion(world.particles, device.x, device.y, Color.GRENADE, world.rng, 20)
        return false
      }
      return true
    }

    case DeviceKind.FLAK: {
      device.x += device.vx * dt
      device.y += device.vy * dt
      device.fuse -= dt
      if (device.fuse <= 0 || !inBounds(device.x, device.y)) {
        spawnShards(
          world,
          device.x,
          device.y,
          device.owner,
          FLAK_SHARDS,
          FLAK_SHARD_SPEED,
          FLAK_SHARD_LIFE,
          FLAK_SHARD_DAMAGE
        )
        spawnExplosion(world.particles, device.x, device.y, Color.FLAK, world.rng, 18)
        return false
      }
      return true
    }

    case DeviceKind.WELL: {
      device.life -= dt
      for (const ship of world.ships) {
        if (ship.id === device.owner || ship.invuln > 0) continue // invuln ships aren't gripped
        const dx = device.x - ship.x
        const dy = device.y - ship.y
        const dist = Math.hypot(dx, dy)
        if (dist > device.pullRadius) continue
        const accel = Math.min(WELL_MAX_ACCEL, device.strength / Math.max(dist, WELL_MIN_DIST))
        const inv = 1 / (dist || 1)
        ship.vx += dx * inv * accel * dt
        ship.vy += dy * inv * accel * dt
      }
      return device.life > 0
    }
  }
}

// Advance every device one frame; returns the ships killed this frame (deduped) so
// the engine can run its destroy/respawn bookkeeping.
export const updateDevices = (world: World, dt: number): Ship[] => {
  const dead = new Set<Ship>()
  const deadDevices = new Set<Device>() // infantry splattered by a blast mid-iteration
  const spawned: Device[] = [] // grenades lobbed by grenadiers this frame (added after the loop)
  const survivors: Device[] = []
  for (const device of world.devices) {
    if (stepDevice(world, device, dt, dead, deadDevices, spawned)) survivors.push(device)
  }
  const kept = deadDevices.size > 0 ? survivors.filter((device) => !deadDevices.has(device)) : survivors
  world.devices = spawned.length > 0 ? kept.concat(spawned) : kept
  return [...dead]
}
