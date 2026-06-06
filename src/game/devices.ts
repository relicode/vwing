import { pushBullet } from '$/game/bullets'
import { circlesOverlap } from '$/game/collision'
import { applyDamage, applyDisable, isDead } from '$/game/combat'
import {
  Color,
  DeviceKind,
  FLAK_SHARD_DAMAGE,
  FLAK_SHARD_LIFE,
  FLAK_SHARD_SPEED,
  FLAK_SHARDS,
  GRAVITY,
  GRENADE_SHARD_DAMAGE,
  GRENADE_SHARD_LIFE,
  GRENADE_SHARD_SPEED,
  GRENADE_SHARDS,
  INFANTRY_FIRE_INTERVAL,
  INFANTRY_RANGE,
  INFANTRY_SHOT_DAMAGE,
  INFANTRY_SHOT_SPEED,
  WALL_THICKNESS,
  WELL_MAX_ACCEL,
  WELL_MIN_DIST,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { TWO_PI, wrapAngle } from '$/game/math'
import { spawnExplosion } from '$/game/particles'
import { randRange } from '$/game/rng'
import type { Device, Ship, World } from '$/game/types'

const FLOOR_Y = WORLD_HEIGHT - WALL_THICKNESS

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

// Damage every enemy ship within `radius`, collecting any that die.
const areaDamage = (
  world: World,
  x: number,
  y: number,
  radius: number,
  damage: number,
  ownerId: number,
  dead: Set<Ship>
): void => {
  for (const ship of world.ships) {
    if (ship.id === ownerId || ship.invuln > 0) continue
    if (Math.hypot(ship.x - x, ship.y - y) > radius) continue
    applyDamage(ship, damage)
    if (isDead(ship)) dead.add(ship)
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

// Advance one device. Mutates the device and the world (spawns shards/shots/blasts),
// adds any killed ships to `dead`, and returns whether the device survives the frame.
const stepDevice = (world: World, device: Device, dt: number, dead: Set<Ship>): boolean => {
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
            areaDamage(world, device.x, device.y, device.blastRadius, device.blastDamage, device.owner, dead)
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
          areaDamage(world, device.x, device.y, device.blastRadius, device.damage, device.owner, dead)
          spawnExplosion(world.particles, device.x, device.y, Color.MINE_ARMED, world.rng, 22)
          return false
        }
      }
      return device.life > 0
    }

    case DeviceKind.INFANTRY: {
      device.life -= dt
      if (!device.attached) {
        device.vy += GRAVITY * dt
        device.x += device.vx * dt
        device.y += device.vy * dt
        const leftWall = WALL_THICKNESS + device.radius
        const rightWall = WORLD_WIDTH - WALL_THICKNESS - device.radius
        if (device.y + device.radius >= FLOOR_Y) {
          device.y = FLOOR_Y - device.radius
          device.attached = true
        } else if (device.x <= leftWall) {
          device.x = leftWall
          device.attached = true
        } else if (device.x >= rightWall) {
          device.x = rightWall
          device.attached = true
        }
        if (device.attached) {
          device.vx = 0
          device.vy = 0
        }
      } else {
        device.fireCooldown -= dt
        if (device.fireCooldown <= 0) {
          const target = nearestEnemyOf(device.owner, device.x, device.y, world.ships)
          if (target && Math.hypot(target.x - device.x, target.y - device.y) <= INFANTRY_RANGE) {
            const angle = Math.atan2(target.y - device.y, target.x - device.x)
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
            device.fireCooldown = INFANTRY_FIRE_INTERVAL
          }
        }
      }
      return device.life > 0
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
  const survivors: Device[] = []
  for (const device of world.devices) {
    if (stepDevice(world, device, dt, dead)) survivors.push(device)
  }
  world.devices = survivors
  return [...dead]
}

// Age out spent rail beams (damage was applied when they were fired).
export const updateBeams = (world: World, dt: number): void => {
  for (const beam of world.beams) beam.life -= dt
  world.beams = world.beams.filter((beam) => beam.life > 0)
}
