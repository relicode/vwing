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
  INFANTRY_KNEEL_FIRE_AT,
  INFANTRY_KNEEL_TIME,
  INFANTRY_PARACHUTE_FIRE_INTERVAL,
  INFANTRY_PICKUP_RADIUS,
  INFANTRY_PICKUP_REFUND,
  INFANTRY_PICKUP_SPEED,
  INFANTRY_RAM_SPEED,
  INFANTRY_RANGE,
  INFANTRY_RESCUE_RANGE,
  INFANTRY_SHOT_DAMAGE,
  INFANTRY_SHOT_SPEED,
  INFANTRY_SINK_SPEED,
  INFANTRY_SINK_TIME,
  INFANTRY_SWIM_DRAG,
  INFANTRY_SWIM_SPEED,
  INFANTRY_SWIM_TIME,
  INFANTRY_WALK_SPEED,
  INFANTRY_WALK_TURN_CHANCE,
  InfantryWeapon,
  PARACHUTE_DEPLOY_SPEED,
  PARACHUTE_DRIFT,
  PARACHUTE_OPEN_TIME,
  PARACHUTE_SWAY,
  PARACHUTE_TERMINAL,
  SECONDARY_MAX_CHARGE,
  WALL_THICKNESS,
  WELL_MAX_ACCEL,
  WELL_MIN_DIST,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp, TWO_PI, wrapAngle } from '$/game/math'
import { spawnExplosion } from '$/game/particles'
import { randRange } from '$/game/rng'
import type { Block, Device, Ship, World } from '$/game/types'
import { waterSurfaceAt } from '$/game/water'

type InfantryDevice = Extract<Device, { kind: DeviceKind.INFANTRY }>

// True when no terrain block sits on the straight line between two points (infantry LOS).
const hasLineOfSight = (x1: number, y1: number, x2: number, y2: number, blocks: Block[]): boolean =>
  !blocks.some((b) => segmentIntersectsRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h))

// True when a point lies strictly inside any block. A trooper resting on a surface sits
// *above* its block, so this only fires when one is wrongly embedded (a kill condition).
const insideAnyBlock = (x: number, y: number, blocks: Block[]): boolean =>
  blocks.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h)

// True while solid ground is still directly under a landed trooper's feet. Probes just
// below the soles: if the supporting block was shot away, this goes false and the unit falls.
const FOOTING_PROBE = 3 // px below the feet to sample for solid ground
const hasFooting = (device: InfantryDevice, blocks: Block[]): boolean => {
  const footY = device.y + device.radius + FOOTING_PROBE
  return blocks.some((b) => device.x > b.x && device.x < b.x + b.w && footY > b.y && footY < b.y + b.h)
}

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
    ship.lastHitBy = ownerId
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

// The nearest enemy ship within range and with a clear line of sight, or undefined.
const infantryTarget = (world: World, device: InfantryDevice): Ship | undefined => {
  const target = nearestEnemyOf(device.owner, device.x, device.y, world.ships)
  if (!target || Math.hypot(target.x - device.x, target.y - device.y) > INFANTRY_RANGE) return undefined
  if (!hasLineOfSight(device.x, device.y, target.x, target.y, world.blocks)) return undefined
  return target
}

// A small spark at the barrel tip when a unit fires, pointed along `angle`.
const muzzleFlash = (world: World, device: InfantryDevice, angle: number, color: number): void => {
  const mx = device.x + Math.cos(angle) * device.radius * 1.8
  const my = device.y + Math.sin(angle) * device.radius * 1.8
  spawnExplosion(world.particles, mx, my, color, world.rng, 3)
}

// Fire at the nearest enemy in range with clear line of sight, at the given cadence. Used by
// rifles (landed) and any unit shooting while it descends. Ticks the cooldown every frame.
const infantryFire = (world: World, device: InfantryDevice, spawned: Device[], interval: number, dt: number): void => {
  device.fireCooldown -= dt
  if (device.fireCooldown > 0) return
  const target = infantryTarget(world, device)
  if (!target) return
  const angle = Math.atan2(target.y - device.y, target.x - device.x)
  if (device.weapon === InfantryWeapon.GRENADE) {
    lobGrenade(spawned, device, angle)
    muzzleFlash(world, device, angle, Color.GRENADE)
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
    muzzleFlash(world, device, angle, Color.SPARK)
  }
  device.fireCooldown = interval
}

// A crouched grenadier lets one round fly at the current target (if still in sight). Driven by
// the landed kneel-fire cycle — no cooldown of its own; the crouch timing sets the cadence.
const grenadierLob = (world: World, device: InfantryDevice, spawned: Device[]): void => {
  const target = infantryTarget(world, device)
  if (!target) return // target slipped out of sight during the wind-up — dry click
  const angle = Math.atan2(target.y - device.y, target.x - device.x)
  lobGrenade(spawned, device, angle)
  muzzleFlash(world, device, angle, Color.GRENADE)
}

// The unit's own owner ship when it's a viable rescuer: present and drifting slowly enough
// to scoop the unit up (so a fast fly-by isn't a rescue — it's a ram). undefined otherwise.
const rescuingOwner = (world: World, device: InfantryDevice): Ship | undefined => {
  if (device.pickupLock > 0) return undefined
  const owner = world.ships.find((s) => s.id === device.owner)
  if (!owner) return undefined
  return Math.hypot(owner.vx, owner.vy) <= INFANTRY_PICKUP_SPEED ? owner : undefined
}

// March toward a target x along the supporting block (clamped to its edges) to be picked up.
const walkToward = (device: InfantryDevice, targetX: number, dt: number): void => {
  device.walkDir = targetX >= device.x ? 1 : -1
  device.x = clamp(
    device.x + device.walkDir * INFANTRY_WALK_SPEED * dt,
    device.groundLeft + device.radius,
    device.groundRight - device.radius
  )
  device.facing = device.walkDir
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

// A landed unit between firing actions: walk toward a slow rescuing owner sharing its block
// (to be scooped up), otherwise patrol it. The vertical gate keeps the rescuer to a ship resting
// at the unit's level (not hovering above), within reach of the pickup overlap once it arrives.
const repositionLanded = (world: World, device: InfantryDevice, dt: number): void => {
  const rescuer = rescuingOwner(world, device)
  if (
    rescuer &&
    rescuer.x >= device.groundLeft &&
    rescuer.x <= device.groundRight &&
    Math.abs(rescuer.y - device.y) <= INFANTRY_PICKUP_RADIUS
  ) {
    walkToward(device, rescuer.x, dt)
  } else {
    patrolInfantry(device, world, dt)
  }
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
          ship.lastHitBy = device.owner
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
      // Swimming: bob at the surface, hold fire, and either paddle toward a nearby rescuing
      // owner or drift to a stop — begin sinking on drown.
      if (device.swim > 0) {
        device.swim -= dt
        const surface = waterSurfaceAt(world.water, device.x, device.y)
        if (surface !== undefined) device.y = surface + device.radius * 0.2
        device.vy = 0
        const rescuer = rescuingOwner(world, device)
        if (rescuer && Math.hypot(rescuer.x - device.x, rescuer.y - device.y) <= INFANTRY_RESCUE_RANGE) {
          device.facing = rescuer.x >= device.x ? 1 : -1
          device.vx = device.facing * INFANTRY_SWIM_SPEED
        } else {
          device.vx *= Math.exp(-INFANTRY_SWIM_DRAG * dt)
        }
        device.x += device.vx * dt
        if (device.swim <= 0) {
          device.sinking = INFANTRY_SINK_TIME
          return true
        }
        return true
      }
      // Airborne: fall (with optional parachute braking), then land / splat / start swimming.
      if (!device.attached) {
        device.vy += GRAVITY * dt
        // Parachute: deploy past a fast descent, then open over time. The brake is all-or-
        // nothing — while opening it does nothing (the unit keeps accelerating), then snaps
        // the descent to a slow terminal the instant the canopy is fully open. A high drop
        // blooms in time and lands soft; a too-low one hits before it opens and still splats.
        if (device.chute < 0 && device.vy > PARACHUTE_DEPLOY_SPEED) device.chute = 0
        if (device.chute >= 0) {
          device.chute = Math.min(1, device.chute + dt / PARACHUTE_OPEN_TIME)
          // Gust sideways (a bounded random walk) so a held-down stream of troopers fans
          // out across the sky instead of falling in one stacked column.
          device.vx = clamp(
            device.vx + randRange(world.rng, -PARACHUTE_SWAY, PARACHUTE_SWAY) * dt,
            -PARACHUTE_DRIFT,
            PARACHUTE_DRIFT
          )
          if (device.chute >= 1 && device.vy > PARACHUTE_TERMINAL) device.vy = PARACHUTE_TERMINAL
          infantryFire(world, device, spawned, INFANTRY_PARACHUTE_FIRE_INTERVAL, dt) // fire slowly while descending
        }
        device.x += device.vx * dt
        device.y += device.vy * dt
        for (const block of world.blocks) {
          const c = circleRectContact(device.x, device.y, device.radius, block.x, block.y, block.w, block.h)
          if (!c) continue
          // A landing only counts on a block's TOP with the feet actually over it (x within the
          // span) — that's where it has real footing. A side or corner contact is a wall: push
          // clear and keep falling so the unit slides off instead of latching on and re-thumping.
          const onTop = c.ny < 0 && device.x > block.x && device.x < block.x + block.w
          if (onTop) {
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
          // Wall / underside: push out of the block and cancel only the velocity driving into it,
          // leaving the fall (and the chute brake) intact so the unit slides down and off.
          device.x += c.nx * c.depth
          device.y += c.ny * c.depth
          const into = device.vx * c.nx + device.vy * c.ny
          if (into < 0) {
            device.vx -= into * c.nx
            device.vy -= into * c.ny
          }
        }
        if (!device.attached) {
          const surface = waterSurfaceAt(world.water, device.x, device.y)
          if (surface !== undefined && device.y + device.radius >= surface) {
            device.swim = INFANTRY_SWIM_TIME
            device.vy = 0
            device.chute = -1
          }
        }
        return true
      }
      // Landed. Embedded in a block (terrain shifted under it) → instant death.
      if (insideAnyBlock(device.x, device.y, world.blocks)) {
        spawnExplosion(world.particles, device.x, device.y, Color.BLOOD, world.rng, 6)
        return false
      }
      // Block beneath shot away → lose footing and fall (re-enters the airborne path next frame).
      if (!hasFooting(device, world.blocks)) {
        device.attached = false
        device.chute = -1
        return true
      }
      // A heavy weapon (grenadier) plants itself to shoot: it repositions freely until the cadence
      // is up and a target is in sight, then drops to a knee and holds DEAD STILL — winds up, lets
      // the round fly mid-crouch, holds through the recovery, then stands back up free to move.
      if (device.weapon === InfantryWeapon.GRENADE) {
        if (device.kneel > 0) {
          const before = device.kneel
          device.kneel -= dt
          if (before > INFANTRY_KNEEL_FIRE_AT && device.kneel <= INFANTRY_KNEEL_FIRE_AT) {
            grenadierLob(world, device, spawned) // the round flies at the wind-up's end
          }
          return true // crouched: stay perfectly still (no patrol/walk)
        }
        device.fireCooldown -= dt
        repositionLanded(world, device, dt)
        if (device.fireCooldown <= 0) {
          const target = infantryTarget(world, device)
          if (target) {
            device.facing = target.x >= device.x ? 1 : -1 // square up to the target
            device.kneel = INFANTRY_KNEEL_TIME // drop to a knee; fires once the wind-up elapses
            device.fireCooldown = INFANTRY_GRENADE_FIRE_INTERVAL
          }
        }
        return true
      }
      // Rifle: reposition (walk-to-rescue or patrol) and fire on the move, standing.
      repositionLanded(world, device, dt)
      infantryFire(world, device, spawned, INFANTRY_FIRE_INTERVAL, dt)
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

// Resolve ship-vs-trooper overlaps: an owner drifting slowly over its own (re-armable) unit
// scoops it up — refunding secondary energy and re-arming the Infantry slot — while any ship
// fast enough to ram (own or enemy) splatters the trooper it ploughs through, save for an
// owner still inside its trooper's deploy lockout (so a fast drop can't instantly mince it).
// Iterates from the tail so removals don't disturb pending indices.
export const resolveInfantryContacts = (world: World): void => {
  for (const ship of world.ships) {
    const speed = Math.hypot(ship.vx, ship.vy)
    const slow = speed <= INFANTRY_PICKUP_SPEED
    const ramming = speed > INFANTRY_RAM_SPEED
    if (!slow && !ramming) continue // a moderate fly-by neither rescues nor rams
    for (let i = world.devices.length - 1; i >= 0; i -= 1) {
      const d = world.devices[i]
      if (d.kind !== DeviceKind.INFANTRY || d.sinking > 0) continue
      if (
        slow &&
        d.owner === ship.id &&
        d.pickupLock <= 0 &&
        (d.attached || d.swim > 0) &&
        circlesOverlap(ship.x, ship.y, INFANTRY_PICKUP_RADIUS, d.x, d.y, d.radius)
      ) {
        world.devices.splice(i, 1)
        ship.weapon = WeaponKind.INFANTRY
        ship.charge = Math.min(SECONDARY_MAX_CHARGE, ship.charge + INFANTRY_PICKUP_REFUND)
        ship.altCooldown = 0
        continue
      }
      if (ramming && circlesOverlap(ship.x, ship.y, ship.radius, d.x, d.y, d.radius)) {
        // A ship still in its own trooper's deploy lockout can't mince it — otherwise a fast
        // drop would splatter the unit the instant it left the hull. Enemies ram freely.
        if (d.owner === ship.id && d.pickupLock > 0) continue
        spawnExplosion(world.particles, d.x, d.y, Color.BLOOD, world.rng, 6)
        world.devices.splice(i, 1)
      }
    }
  }
}
