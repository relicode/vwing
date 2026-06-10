import { castRail } from '$/game/beams'
import { pushBullet } from '$/game/bullets'
import { circleRectContact, circlesOverlap, segmentIntersectsRect } from '$/game/collision'
import { applyDamage, applyDisable, isDead } from '$/game/combat'
import {
  AFTERBURNER_IGNITE_LEN,
  AFTERBURNER_IGNITE_RADIUS,
  BASE_DOOR_RADIUS,
  BASE_GARRISON_CAP,
  BaseAlarm,
  BLAST_SHAKE,
  BULLET_RADIUS,
  Color,
  DeviceKind,
  EMP_STUN_RADIUS,
  FLAK_FUSE,
  FLAK_RADIUS,
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
  INFANTRY_BURN_RUN_SPEED,
  INFANTRY_BURN_TIME,
  INFANTRY_BURN_TURN_CHANCE,
  INFANTRY_DROWN_RESCUE_WINDOW,
  INFANTRY_EMP_DISABLE,
  INFANTRY_EMP_DRAIN,
  INFANTRY_EMP_LIFE,
  INFANTRY_EMP_RADIUS,
  INFANTRY_EMP_SPEED,
  INFANTRY_FALL_LETHAL,
  INFANTRY_FIRE_CATCH_CHANCE,
  INFANTRY_FIRE_CATCH_RADIUS,
  INFANTRY_FIRE_INTERVAL,
  INFANTRY_FIRE_PANIC_DIST,
  INFANTRY_FLAK_SPEED,
  INFANTRY_FLAME_DAMAGE,
  INFANTRY_FLAME_LIFE,
  INFANTRY_FLAME_PELLETS,
  INFANTRY_FLAME_SPEED,
  INFANTRY_FLAME_SPREAD,
  INFANTRY_HEAVY,
  INFANTRY_ICE_SLIP_CHANCE,
  INFANTRY_KNEEL_FIRE_AT,
  INFANTRY_KNEEL_TIME,
  INFANTRY_MINE_ARM,
  INFANTRY_MINE_BLAST,
  INFANTRY_MINE_DAMAGE,
  INFANTRY_MINE_RADIUS,
  INFANTRY_MINE_TRIGGER,
  INFANTRY_PANIC_DIST,
  INFANTRY_PARACHUTE_FIRE_INTERVAL,
  INFANTRY_PICKUP_DELAY,
  INFANTRY_PICKUP_RADIUS,
  INFANTRY_PICKUP_SPEED,
  INFANTRY_RAIL_DAMAGE,
  INFANTRY_RAIL_RANGE,
  INFANTRY_RAM_SPEED,
  INFANTRY_RANGE,
  INFANTRY_RESCUE_RANGE,
  INFANTRY_RUN_SPEED,
  INFANTRY_SCATTER_DAMAGE,
  INFANTRY_SCATTER_LIFE,
  INFANTRY_SCATTER_PELLETS,
  INFANTRY_SCATTER_SPEED,
  INFANTRY_SCATTER_SPREAD,
  INFANTRY_SEEKER_BLAST,
  INFANTRY_SEEKER_BLAST_DAMAGE,
  INFANTRY_SEEKER_DAMAGE,
  INFANTRY_SEEKER_LIFE,
  INFANTRY_SEEKER_RADIUS,
  INFANTRY_SEEKER_SPEED,
  INFANTRY_SEEKER_TURN,
  INFANTRY_SHOT_DAMAGE,
  INFANTRY_SHOT_SPEED,
  INFANTRY_SINK_SPEED,
  INFANTRY_SINK_TIME,
  INFANTRY_SLIP_FRICTION,
  INFANTRY_SLIP_SPEED,
  INFANTRY_SLIP_STOP_SPEED,
  INFANTRY_SPREAD_PARACHUTE,
  INFANTRY_SPREAD_STANDING,
  INFANTRY_SPREAD_SWIM,
  INFANTRY_SPREAD_WALKING,
  INFANTRY_SWIM_DRAG,
  INFANTRY_SWIM_FIRE_INTERVAL,
  INFANTRY_SWIM_SPEED,
  INFANTRY_SWIM_TIME,
  INFANTRY_THRUST_PANIC_DIST,
  INFANTRY_WALK_SPEED,
  INFANTRY_WALK_TURN_CHANCE,
  INFANTRY_WATER_DAMAGE,
  INFANTRY_WATER_LIFE,
  INFANTRY_WATER_PUSH,
  INFANTRY_WATER_SHOTS,
  INFANTRY_WATER_SPEED,
  INFANTRY_WATER_SPREAD,
  INFANTRY_WELL_DIST,
  INFANTRY_WELL_LIFE,
  INFANTRY_WELL_PULL,
  INFANTRY_WELL_RADIUS,
  INFANTRY_WELL_STRENGTH,
  InfantryState,
  MINE_LIFE,
  PARACHUTE_DEPLOY_SPEED,
  PARACHUTE_DRIFT,
  PARACHUTE_OPEN_TIME,
  PARACHUTE_SWAY,
  PARACHUTE_TERMINAL,
  RETRO_IGNITE_LEN,
  RETRO_IGNITE_RADIUS,
  Surface,
  TROOP_BAY_CAPACITY,
  WALL_THICKNESS,
  WELL_MAX_ACCEL,
  WELL_MIN_DIST,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp, TWO_PI, wrapAngle } from '$/game/math'
import { spawnExplosion, spawnPuff } from '$/game/particles'
import { randRange } from '$/game/rng'
import type { Block, Device, Ship, Vec2, World } from '$/game/types'
import { waterSurfaceAt } from '$/game/water'

type InfantryDevice = Extract<Device, { kind: DeviceKind.INFANTRY }>

// True when no terrain block sits on the straight line between two points (infantry LOS).
const hasLineOfSight = (x1: number, y1: number, x2: number, y2: number, blocks: Block[]): boolean =>
  !blocks.some((b) => segmentIntersectsRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h))

// True when a point lies strictly inside any block. A trooper resting on a surface sits
// *above* its block, so this only fires when one is wrongly embedded (a kill condition).
const insideAnyBlock = (x: number, y: number, blocks: Block[]): boolean =>
  blocks.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h)

// Solid rock just ahead at body height — a step face or wall rising from the patrol block.
// Lateral movers treat it like a patrol edge: walking into a cliff turns a trooper around, it
// never grinds it into the embedded-death check (which is for terrain MOVING into a unit —
// falling debris — not for a unit strolling into terrain). Probed past the leading edge so the
// turn happens before the body ever clips the face.
const wallAhead = (blocks: Block[], device: InfantryDevice, dir: number): boolean =>
  insideAnyBlock(device.x + dir * (device.radius + 2), device.y, blocks)

// A flying device's body touching any terrain block (walls included — the bedrock frame lives
// in world.blocks). Projectile devices detonate or fizzle here instead of tunnelling through.
const touchingBlock = (blocks: Block[], x: number, y: number, r: number): boolean =>
  blocks.some((b) => circleRectContact(x, y, r, b.x, b.y, b.w, b.h) !== undefined)

// The block directly under a landed trooper's feet (probed just below the soles), or undefined if
// the ground was shot away. Its surface tells us whether the footing is icy (see the ice slip).
const FOOTING_PROBE = 3 // px below the feet to sample for solid ground
const supportingBlock = (device: InfantryDevice, blocks: Block[]): Block | undefined => {
  const footY = device.y + device.radius + FOOTING_PROBE
  return blocks.find((b) => device.x > b.x && device.x < b.x + b.w && footY > b.y && footY < b.y + b.h)
}

// The trooper's behavioural state, derived from its fields — drives the firing rules and most
// rendered poses. Precedence runs sinking → swimming → airborne → landed. An in-progress ice
// slide (device.slide) is a transient handled inline (it holds fire and the renderer keys its
// skid pose off device.slide), so it has no dedicated state here.
export const stateOf = (device: InfantryDevice): InfantryState => {
  if (device.sinking > 0) return InfantryState.DROWNING
  if (device.swim > 0) return InfantryState.SWIMMING
  if (!device.attached) return device.chute >= 0 ? InfantryState.FALLING_PARACHUTE : InfantryState.FALLING
  if (device.kneel > 0) return InfantryState.KNEELING
  if (device.running) return InfantryState.RUNNING
  // Landed: walking when there's room to patrol, otherwise standing (and dead-on).
  return device.groundRight - device.groundLeft > device.radius * 2 ? InfantryState.WALKING : InfantryState.STANDING
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
// Infantry caught in the radius are splattered (added to `deadDevices`) regardless of side —
// a blast is indiscriminate; only the TRIGGERS (mine trip, missile contact) read uniforms.
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
    if (device.kind !== DeviceKind.INFANTRY || deadDevices.has(device)) continue
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

// The nearest enemy trooper (not a drowned corpse), or undefined. Infantry hate other infantry
// and shoot them first, so this is consulted ahead of enemy ships.
const nearestEnemyInfantry = (ownerId: number, x: number, y: number, devices: Device[]): InfantryDevice | undefined => {
  let best: InfantryDevice | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const d of devices) {
    if (d.kind !== DeviceKind.INFANTRY || d.owner === ownerId || d.sinking > 0) continue
    const dist = Math.hypot(d.x - x, d.y - y)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}

// The nearest trooper that's alight — EITHER side's: fire doesn't care whose uniform it eats,
// so everyone gives a burning man room (it's how the contagion is dodged).
const nearestBurningInfantry = (self: InfantryDevice, devices: Device[]): InfantryDevice | undefined => {
  let best: InfantryDevice | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const d of devices) {
    if (d.kind !== DeviceKind.INFANTRY || d === self || d.burning <= 0 || d.sinking > 0) continue
    const dist = Math.hypot(d.x - self.x, d.y - self.y)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}

const inSightInRange = (world: World, device: InfantryDevice, tx: number, ty: number): boolean =>
  Math.hypot(tx - device.x, ty - device.y) <= INFANTRY_RANGE && hasLineOfSight(device.x, device.y, tx, ty, world.blocks)

// True when a same-side trooper stands in the firing lane to (tx, ty) — the trigger discipline
// that keeps friendly fire (which is real: bullets don't read uniforms) from turning every
// firefight into fratricide. Checked at the moment of firing, so the shot flies as soon as the
// buddy steps clear.
const friendlyInLine = (world: World, device: InfantryDevice, tx: number, ty: number): boolean => {
  const dx = tx - device.x
  const dy = ty - device.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  for (const d of world.devices) {
    if (d.kind !== DeviceKind.INFANTRY || d === device || d.owner !== device.owner || d.sinking > 0) continue
    const relX = d.x - device.x
    const relY = d.y - device.y
    const along = relX * ux + relY * uy
    if (along <= 0 || along >= len) continue
    if (Math.abs(relX * uy - relY * ux) > d.radius + BULLET_RADIUS) continue
    return true
  }
  return false
}

// A trooper's aim point: the nearest enemy *infantry* in range + line of sight if there is one
// (infantry hate infantry), otherwise the nearest enemy ship. undefined when nothing is engageable.
const infantryTarget = (world: World, device: InfantryDevice): Vec2 | undefined => {
  const foe = nearestEnemyInfantry(device.owner, device.x, device.y, world.devices)
  if (foe && inSightInRange(world, device, foe.x, foe.y)) return { x: foe.x, y: foe.y }
  const ship = nearestEnemyOf(device.owner, device.x, device.y, world.ships)
  if (ship && inSightInRange(world, device, ship.x, ship.y)) return { x: ship.x, y: ship.y }
  return undefined
}

// A small spark at the barrel tip when a unit fires, pointed along `angle`.
const muzzleFlash = (world: World, device: InfantryDevice, angle: number, color: number): void => {
  const mx = device.x + Math.cos(angle) * device.radius * 1.8
  const my = device.y + Math.sin(angle) * device.radius * 1.8
  spawnExplosion(world.particles, mx, my, color, world.rng, 3)
}

// Fire at the current target at the given cadence, with `spread` rad of aim jitter (drawn from
// world.rng so it stays deterministic). Used by rifles (landed), descending, and drifting swimmers.
// The round leaves from the MUZZLE (clear of the firer's own body — friendly fire is real and a
// center-spawned bullet would clip its own shooter) and holds when a friend stands in the lane.
const infantryFire = (world: World, device: InfantryDevice, interval: number, spread: number, dt: number): void => {
  device.fireCooldown -= dt
  if (device.fireCooldown > 0) return
  const target = infantryTarget(world, device)
  if (!target) return
  if (friendlyInLine(world, device, target.x, target.y)) return // trigger discipline — retry once clear
  const angle = Math.atan2(target.y - device.y, target.x - device.x) + randRange(world.rng, -spread, spread)
  const muzzle = device.radius * 1.8
  pushBullet(
    world.bullets,
    device.x + Math.cos(angle) * muzzle,
    device.y + Math.sin(angle) * muzzle,
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
  device.fireCooldown = interval
}

// A short burst of aimed specialist bullets (scatter pellets / water squirt / flame fan),
// leaving from the tube's muzzle so the burst can't clip the firer's own body.
const heavyBurst = (
  world: World,
  device: InfantryDevice,
  angle: number,
  count: number,
  spread: number,
  speed: number,
  opts: { damage: number; life: number; color: number; push?: number; wet?: boolean; burn?: boolean }
): void => {
  const mx = device.x + Math.cos(angle) * device.radius * 1.8
  const my = device.y - device.radius * 0.5 + Math.sin(angle) * device.radius * 1.8
  for (let i = 0; i < count; i += 1) {
    const jittered = angle + randRange(world.rng, -spread, spread)
    pushBullet(world.bullets, mx, my, Math.cos(jittered) * speed, Math.sin(jittered) * speed, {
      owner: device.owner,
      ...opts,
    })
  }
}

// The sapper's plant: a small proximity mine seeded at the trooper's feet (queued in `spawned`).
const plantMine = (spawned: Device[], device: InfantryDevice): void => {
  spawned.push({
    kind: DeviceKind.MINE,
    x: device.x,
    y: device.y + device.radius - INFANTRY_MINE_RADIUS,
    owner: device.owner,
    radius: INFANTRY_MINE_RADIUS,
    armTime: INFANTRY_MINE_ARM,
    life: MINE_LIFE,
    triggerRadius: INFANTRY_MINE_TRIGGER,
    blastRadius: INFANTRY_MINE_BLAST,
    damage: INFANTRY_MINE_DAMAGE,
  })
}

// A braced specialist lets its man-portable heavy fly at the current target (if still in sight —
// otherwise a dry click). Driven by the landed kneel-fire cycle, so there's no cooldown here; the
// crouch timing sets the cadence. Rail kills land in `dead` (ships) and `deadDevices` (troopers
// pierced along the lance) — hitscan resolves immediately, mid-device-iteration.
const fireHeavy = (
  world: World,
  device: InfantryDevice,
  spawned: Device[],
  dead: Set<Ship>,
  deadDevices: Set<Device>
): void => {
  const heavy = device.heavy
  if (heavy === undefined) return
  const target = infantryTarget(world, device)
  if (!target) return // target slipped out of sight during the wind-up — dry click
  if (friendlyInLine(world, device, target.x, target.y)) return // a friend in the lane — hold the round
  const angle = Math.atan2(target.y - device.y, target.x - device.x)
  const shoulderY = device.y - device.radius * 0.5
  switch (heavy) {
    case WeaponKind.SCATTERGUN:
      heavyBurst(world, device, angle, INFANTRY_SCATTER_PELLETS, INFANTRY_SCATTER_SPREAD, INFANTRY_SCATTER_SPEED, {
        damage: INFANTRY_SCATTER_DAMAGE,
        life: INFANTRY_SCATTER_LIFE,
        color: Color.SHRAPNEL,
      })
      muzzleFlash(world, device, angle, Color.SHRAPNEL)
      return
    case WeaponKind.WATER_CANNON:
      heavyBurst(world, device, angle, INFANTRY_WATER_SHOTS, INFANTRY_WATER_SPREAD, INFANTRY_WATER_SPEED, {
        damage: INFANTRY_WATER_DAMAGE,
        life: INFANTRY_WATER_LIFE,
        color: Color.WATER_EDGE,
        push: INFANTRY_WATER_PUSH,
        wet: true,
      })
      muzzleFlash(world, device, angle, Color.WATER_EDGE)
      return
    case WeaponKind.FLAMETHROWER:
      heavyBurst(world, device, angle, INFANTRY_FLAME_PELLETS, INFANTRY_FLAME_SPREAD, INFANTRY_FLAME_SPEED, {
        damage: INFANTRY_FLAME_DAMAGE,
        life: INFANTRY_FLAME_LIFE,
        color: Color.THRUST,
        burn: true,
      })
      muzzleFlash(world, device, angle, Color.THRUST)
      return
    case WeaponKind.SEEKER:
      spawned.push({
        kind: DeviceKind.MISSILE,
        x: device.x,
        y: shoulderY,
        vx: Math.cos(angle) * INFANTRY_SEEKER_SPEED,
        vy: Math.sin(angle) * INFANTRY_SEEKER_SPEED,
        life: INFANTRY_SEEKER_LIFE,
        owner: device.owner,
        radius: INFANTRY_SEEKER_RADIUS,
        turnRate: INFANTRY_SEEKER_TURN,
        speed: INFANTRY_SEEKER_SPEED,
        damage: INFANTRY_SEEKER_DAMAGE,
        blastRadius: INFANTRY_SEEKER_BLAST,
        blastDamage: INFANTRY_SEEKER_BLAST_DAMAGE,
        disableTime: 0,
        shieldDrain: 0,
        color: Color.MISSILE,
      })
      muzzleFlash(world, device, angle, Color.MISSILE)
      return
    case WeaponKind.RAIL: {
      const hit = castRail(
        world,
        device.x,
        shoulderY,
        angle,
        device.owner,
        INFANTRY_RAIL_RANGE,
        INFANTRY_RAIL_DAMAGE,
        deadDevices,
        device // the lance pierces flesh on EITHER side — but never the sniper's own body
      )
      if (hit && isDead(hit)) dead.add(hit)
      muzzleFlash(world, device, angle, Color.RAIL)
      return
    }
    case WeaponKind.GRENADE:
      lobGrenade(spawned, device, angle)
      muzzleFlash(world, device, angle, Color.GRENADE)
      return
    case WeaponKind.MINES:
      plantMine(spawned, device) // sappers normally plant on patrol, but stay exhaustive here
      return
    case WeaponKind.FLAK:
      spawned.push({
        kind: DeviceKind.FLAK,
        x: device.x,
        y: shoulderY,
        vx: Math.cos(angle) * INFANTRY_FLAK_SPEED,
        vy: Math.sin(angle) * INFANTRY_FLAK_SPEED,
        owner: device.owner,
        radius: FLAK_RADIUS,
        fuse: FLAK_FUSE,
      })
      muzzleFlash(world, device, angle, Color.FLAK)
      return
    case WeaponKind.EMP:
      spawned.push({
        kind: DeviceKind.MISSILE,
        x: device.x,
        y: shoulderY,
        vx: Math.cos(angle) * INFANTRY_EMP_SPEED,
        vy: Math.sin(angle) * INFANTRY_EMP_SPEED,
        life: INFANTRY_EMP_LIFE,
        owner: device.owner,
        radius: INFANTRY_EMP_RADIUS,
        turnRate: 0,
        speed: INFANTRY_EMP_SPEED,
        damage: 0,
        blastRadius: 0,
        blastDamage: 0,
        disableTime: INFANTRY_EMP_DISABLE,
        shieldDrain: INFANTRY_EMP_DRAIN,
        color: Color.EMP,
      })
      muzzleFlash(world, device, angle, Color.EMP)
      return
    case WeaponKind.SINGULARITY:
      spawned.push({
        kind: DeviceKind.WELL,
        x: device.x + Math.cos(angle) * INFANTRY_WELL_DIST,
        y: shoulderY + Math.sin(angle) * INFANTRY_WELL_DIST,
        owner: device.owner,
        radius: INFANTRY_WELL_RADIUS,
        life: INFANTRY_WELL_LIFE,
        strength: INFANTRY_WELL_STRENGTH,
        pullRadius: INFANTRY_WELL_PULL,
      })
      muzzleFlash(world, device, angle, Color.WELL)
      return
  }
}

// A guard still bound to its post: while the barracks stands and the alarm is up (HIDE or
// SORTIE), the watch stays on duty — it neither walks to nor boards a ship. At ease (PATROL),
// guards are ordinary boarders: that IS how a base is loaded, all the way down to an empty house.
const guardOnDuty = (world: World, device: InfantryDevice): boolean => {
  if (!device.guard) return false
  const post = world.bases.find((b) => b.owner === device.owner)
  return post !== undefined && post.capture < 1 && post.alarm !== BaseAlarm.PATROL
}

// The unit's own owner ship when it's a viable boarder: present, with room in the bay, and
// landed or barely drifting (so a fly-by isn't a rescue — it's a ram). undefined otherwise.
// The bay-room gate keeps troopers patrolling instead of bunching under a parked ship that
// can't actually take them aboard; a guard under alarm stays on post.
const rescuingOwner = (world: World, device: InfantryDevice): Ship | undefined => {
  if (device.pickupLock > 0 || guardOnDuty(world, device)) return undefined
  const owner = world.ships.find((s) => s.id === device.owner)
  if (!owner || owner.troops >= TROOP_BAY_CAPACITY) return undefined
  return Math.hypot(owner.vx, owner.vy) <= INFANTRY_PICKUP_SPEED ? owner : undefined
}

// Clamp x to a unit's walkable span on its block (feet kept inside both edges). When the block is
// narrower than the unit there is no valid interior, so clamp()'s inverted bounds (min > max) would
// snap the unit to a bogus edge every frame — instead hold it centred so a big trooper on a thin
// ledge stays put. patrolInfantry guards this inline; the other movers route through here.
const clampToGround = (device: InfantryDevice, x: number): number => {
  const min = device.groundLeft + device.radius
  const max = device.groundRight - device.radius
  return max <= min ? (device.groundLeft + device.groundRight) / 2 : clamp(x, min, max)
}

// Double-time toward a target x along the supporting block (clamped to its edges, halted by a
// wall face) to climb aboard — boarding is urgent, so the unit SPRINTS (the run pose reads the
// dash to the hull; `running` resets at the top of every landed tick, so it clears on arrival).
const walkToward = (world: World, device: InfantryDevice, targetX: number, dt: number): void => {
  device.walkDir = targetX >= device.x ? 1 : -1
  device.running = true
  if (!wallAhead(world.blocks, device, device.walkDir)) {
    device.x = clampToGround(device, device.x + device.walkDir * INFANTRY_RUN_SPEED * dt)
  }
  device.facing = device.walkDir
}

// Walk back and forth along the supporting block, turning at its edges (never off it) and at
// any wall face rising from it, and occasionally reversing on a whim. `facing` tracks the
// movement direction for the sprite.
const patrolInfantry = (device: InfantryDevice, world: World, dt: number): void => {
  const min = device.groundLeft + device.radius
  const max = device.groundRight - device.radius
  if (max <= min) {
    device.facing = device.walkDir
    return
  }
  if (world.rng() < INFANTRY_WALK_TURN_CHANCE) device.walkDir = -device.walkDir
  if (wallAhead(world.blocks, device, device.walkDir)) device.walkDir = -device.walkDir
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
// at the unit's level (not hovering above), within reach of the boarding touch once it arrives.
const repositionLanded = (world: World, device: InfantryDevice, dt: number): void => {
  const rescuer = rescuingOwner(world, device)
  if (
    rescuer &&
    rescuer.x >= device.groundLeft &&
    rescuer.x <= device.groundRight &&
    Math.abs(rescuer.y - device.y) <= INFANTRY_PICKUP_RADIUS + device.radius
  ) {
    walkToward(world, device, rescuer.x, dt)
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
      // Flesh stops it too: a warhead contact-detonates on an enemy trooper (splattering it and
      // splashing the blast), while an EMP orb pops and seizes every trooper around the burst.
      for (const d of world.devices) {
        if (d.kind !== DeviceKind.INFANTRY || d.owner === device.owner || d.sinking > 0 || deadDevices.has(d)) continue
        if (!circlesOverlap(device.x, device.y, device.radius, d.x, d.y, d.radius)) continue
        if (device.disableTime > 0) {
          for (const t of world.devices) {
            if (t.kind !== DeviceKind.INFANTRY || t.owner === device.owner || t.sinking > 0) continue
            if (Math.hypot(t.x - device.x, t.y - device.y) > EMP_STUN_RADIUS) continue
            t.stun = Math.max(t.stun, device.disableTime)
            t.kneel = 0
            t.running = false
          }
        } else {
          spawnExplosion(world.particles, d.x, d.y, Color.BLOOD, world.rng, 6)
          deadDevices.add(d)
          if (device.blastRadius > 0) {
            areaDamage(
              world,
              device.x,
              device.y,
              device.blastRadius,
              device.blastDamage,
              device.owner,
              dead,
              deadDevices
            )
          }
        }
        spawnExplosion(world.particles, device.x, device.y, device.color, world.rng, 14)
        return false
      }
      // Terrain stops it: a blast warhead (seeker) detonates against the rock — splashing any
      // ship or trooper hugging the wall — while a bare orb (EMP) just fizzles out.
      if (touchingBlock(world.blocks, device.x, device.y, device.radius)) {
        if (device.blastRadius > 0) {
          areaDamage(world, device.x, device.y, device.blastRadius, device.blastDamage, device.owner, dead, deadDevices)
        }
        spawnExplosion(world.particles, device.x, device.y, device.color, world.rng, 14)
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
        // Enemy infantry trip it too — the sapper's patrol-seeded field is area denial
        // against the capture disc, not just against strafing hulls.
        for (const d of world.devices) {
          if (d.kind !== DeviceKind.INFANTRY || d.owner === device.owner || d.sinking > 0) continue
          if (Math.hypot(d.x - device.x, d.y - device.y) > device.triggerRadius) continue
          areaDamage(world, device.x, device.y, device.blastRadius, device.damage, device.owner, dead, deadDevices)
          spawnExplosion(world.particles, device.x, device.y, Color.MINE_ARMED, world.rng, 22)
          return false
        }
      }
      return device.life > 0
    }

    case DeviceKind.INFANTRY: {
      if (device.pickupLock > 0) device.pickupLock -= dt
      if (device.stun > 0) device.stun = Math.max(0, device.stun - dt)
      // Drowned corpse: sink and fade for a moment, then vanish (no explosion).
      if (device.sinking > 0) {
        device.sinking -= dt
        device.y += INFANTRY_SINK_SPEED * dt
        return device.sinking > 0
      }
      // On fire: water douses it instantly; otherwise the timer burns down, flames shed embers,
      // and the fire JUMPS to any trooper (either side) in near-contact. At zero it collapses.
      if (device.burning > 0) {
        if (device.swim > 0) {
          device.burning = 0
        } else {
          device.burning -= dt
          if (world.rng() < 0.5) {
            spawnPuff(
              world.particles,
              device.x + randRange(world.rng, -4, 4),
              device.y - device.radius,
              0,
              -randRange(world.rng, 30, 80),
              world.rng() < 0.5 ? Color.THRUST : Color.EXPLOSION,
              world.rng,
              0.45
            )
          }
          for (const other of world.devices) {
            if (other === device || other.kind !== DeviceKind.INFANTRY) continue
            if (other.burning > 0 || other.swim > 0 || other.sinking > 0) continue
            if (Math.hypot(other.x - device.x, other.y - device.y) > INFANTRY_FIRE_CATCH_RADIUS) continue
            if (world.rng() < INFANTRY_FIRE_CATCH_CHANCE) other.burning = INFANTRY_BURN_TIME
          }
          if (device.burning <= 0) {
            spawnExplosion(world.particles, device.x, device.y, Color.THRUST, world.rng, 10)
            spawnExplosion(world.particles, device.x, device.y, Color.BLOOD, world.rng, 4)
            return false
          }
        }
      }
      // Swimming: bob at the surface and either paddle toward a nearby rescuing owner (directed —
      // both hands busy, holds fire) or drift to a stop (standby — looses the odd poor shot).
      if (device.swim > 0) {
        device.running = false
        device.slide = 0
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
          infantryFire(world, device, INFANTRY_SWIM_FIRE_INTERVAL, INFANTRY_SPREAD_SWIM, dt)
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
        device.running = false
        device.slide = 0
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
          // Fire slowly and inaccurately while swinging under the canopy.
          infantryFire(world, device, INFANTRY_PARACHUTE_FIRE_INTERVAL, INFANTRY_SPREAD_PARACHUTE, dt)
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
      const ground = supportingBlock(device, world.blocks)
      if (!ground) {
        device.attached = false
        device.chute = -1
        device.running = false
        device.slide = 0
        return true
      }
      // Alight: a burning trooper has no discipline left — it flails blindly along its block
      // at a dead sprint (reversing on a whim), shedding the fire onto anyone it brushes.
      if (device.burning > 0) {
        device.slide = 0
        device.kneel = 0
        device.running = true
        if (world.rng() < INFANTRY_BURN_TURN_CHANCE) device.walkDir = -device.walkDir
        if (device.x <= device.groundLeft + device.radius) device.walkDir = 1
        else if (device.x >= device.groundRight - device.radius) device.walkDir = -1
        if (wallAhead(world.blocks, device, device.walkDir)) device.walkDir = -device.walkDir
        device.facing = device.walkDir
        device.x = clampToGround(device, device.x + device.walkDir * INFANTRY_BURN_RUN_SPEED * dt)
        return true
      }
      // Ice slip: footing on an icy surface occasionally gives way into a decaying slide. Once
      // sliding, the trooper glides (clamped to its block) and can't shoot until it stops.
      // A water-cannon wash lands a unit in the same skid (see resolveBulletHits).
      if (device.slide !== 0 || (ground.surface === Surface.ICE && world.rng() < INFANTRY_ICE_SLIP_CHANCE)) {
        if (device.slide === 0) device.slide = device.walkDir * INFANTRY_SLIP_SPEED // a fresh slip
        if (wallAhead(world.blocks, device, Math.sign(device.slide))) device.slide = 0 // skidded into a face: dead stop
        device.x = clampToGround(device, device.x + device.slide * dt)
        device.slide *= Math.exp(-INFANTRY_SLIP_FRICTION * dt)
        if (Math.abs(device.slide) < INFANTRY_SLIP_STOP_SPEED) device.slide = 0
        device.facing = device.walkDir
        device.running = false
        device.kneel = 0 // a slip breaks any brace
        return true // sliding: no shooting
      }
      // EMP-seized: the unit locks up where it stands — no walking, no firing — until it shakes
      // the jolt off. (The timer ticks down at the top of the case, airborne or not.)
      if (device.stun > 0) {
        device.running = false
        device.kneel = 0
        return true
      }
      // Bolt from a point-blank threat: a crowding enemy trooper, or ANYONE alight (friend or
      // foe — fire jumps, so a burning man clears a circle). Infantry shoot each other at range
      // but back off when crowded, sprinting along the block (no fire). Enemy ships are stood
      // up to, not fled — the garrison's hide-indoors rule lives with the guards instead.
      const foe = nearestEnemyInfantry(device.owner, device.x, device.y, world.devices)
      let threatX: number | undefined
      let threatDist = Number.POSITIVE_INFINITY
      if (foe) {
        const dist = Math.hypot(foe.x - device.x, foe.y - device.y)
        if (dist < INFANTRY_PANIC_DIST) {
          threatX = foe.x
          threatDist = dist
        }
      }
      const burner = nearestBurningInfantry(device, world.devices)
      if (burner) {
        const dist = Math.hypot(burner.x - device.x, burner.y - device.y)
        if (dist < INFANTRY_FIRE_PANIC_DIST && dist < threatDist) {
          threatX = burner.x
          threatDist = dist
        }
      }
      // A hot engine is an open flame: any ship burning EITHER engine this close (your own
      // pilot's exhaust burns just as hot) clears a circle. A ship that has cut its engines
      // and landed is safe to approach and board.
      for (const ship of world.ships) {
        if (!ship.thrusting && !ship.reversing) continue
        const dist = Math.hypot(ship.x - device.x, ship.y - device.y)
        if (dist < INFANTRY_THRUST_PANIC_DIST && dist < threatDist) {
          threatX = ship.x
          threatDist = dist
        }
      }
      if (threatX !== undefined) {
        const away = device.x >= threatX ? 1 : -1
        device.running = true
        device.walkDir = away
        device.facing = away
        device.kneel = 0
        // Cornered against a wall: hold there (still running scared) rather than grind into it.
        if (!wallAhead(world.blocks, device, away)) {
          device.x = clampToGround(device, device.x + away * INFANTRY_RUN_SPEED * dt)
        }
        return true
      }
      device.running = false
      // A garrison guard answers its barracks' alarm: while the post stands and HIDE is up, it
      // double-times to the door and slips back inside (despawning into the housed count, where
      // no strafing run can touch it). A fallen post releases it to fight as a regular trooper.
      if (device.guard) {
        const post = world.bases.find((b) => b.owner === device.owner)
        if (!post || post.capture >= 1) {
          device.guard = false
        } else if (post.alarm === BaseAlarm.HIDE) {
          if (Math.abs(device.x - post.x) <= BASE_DOOR_RADIUS) {
            post.garrison = Math.min(BASE_GARRISON_CAP, post.garrison + 1)
            return false // through the door
          }
          const dir = post.x >= device.x ? 1 : -1
          device.running = true
          device.walkDir = dir
          device.facing = dir
          device.kneel = 0
          if (!wallAhead(world.blocks, device, dir)) {
            device.x = clampToGround(device, device.x + dir * INFANTRY_RUN_SPEED * dt)
          }
          return true
        }
      }
      // A specialist plants itself to shoot its heavy weapon: it repositions freely until the
      // cadence is up and a target is in sight, then drops to a knee and holds DEAD STILL — winds
      // up, lets the round fly mid-crouch, holds through the recovery, then stands back up free.
      // The mine sapper is the no-kneel exception: it seeds its patrol path, no target needed.
      if (device.heavy !== undefined) {
        const spec = INFANTRY_HEAVY[device.heavy]
        if (!spec.kneel) {
          device.fireCooldown -= dt
          repositionLanded(world, device, dt)
          if (device.fireCooldown <= 0) {
            plantMine(spawned, device)
            device.fireCooldown = spec.interval
          }
          return true
        }
        if (device.kneel > 0) {
          const before = device.kneel
          device.kneel -= dt
          if (before > INFANTRY_KNEEL_FIRE_AT && device.kneel <= INFANTRY_KNEEL_FIRE_AT) {
            fireHeavy(world, device, spawned, dead, deadDevices) // the round flies at the wind-up's end
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
            device.fireCooldown = spec.interval
          }
        }
        return true
      }
      // Rifle: reposition (walk-to-rescue or patrol), then fire — dead-on from a halt (STANDING),
      // looser on the move (WALKING).
      repositionLanded(world, device, dt)
      const spread = stateOf(device) === InfantryState.STANDING ? INFANTRY_SPREAD_STANDING : INFANTRY_SPREAD_WALKING
      infantryFire(world, device, INFANTRY_FIRE_INTERVAL, spread, dt)
      return true // landed unit persists until it's killed or picked up
    }

    case DeviceKind.GRENADE: {
      device.vy += GRAVITY * dt
      device.x += device.vx * dt
      device.y += device.vy * dt
      device.fuse -= dt
      // Pops on the fuse OR on impact — a grenade bursts where it lands instead of sinking
      // into the rock (the shard ring then chews the surface like any bullets).
      if (
        device.fuse <= 0 ||
        !inBounds(device.x, device.y) ||
        touchingBlock(world.blocks, device.x, device.y, device.radius)
      ) {
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
      // Airbursts on the fuse OR against terrain — a shell never tunnels through a wall.
      if (
        device.fuse <= 0 ||
        !inBounds(device.x, device.y) ||
        touchingBlock(world.blocks, device.x, device.y, device.radius)
      ) {
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
      // Enemy troopers are gripped too: a landed unit is plucked clean off its feet and rides
      // the pull airborne (gravity, chute, and the splat-on-landing rules take over from there).
      for (const d of world.devices) {
        if (d.kind !== DeviceKind.INFANTRY || d.owner === device.owner || d.sinking > 0 || d.swim > 0) continue
        const dx = device.x - d.x
        const dy = device.y - d.y
        const dist = Math.hypot(dx, dy)
        if (dist > device.pullRadius) continue
        if (d.attached) {
          d.attached = false
          d.chute = -1
          d.running = false
          d.kneel = 0
        }
        const accel = Math.min(WELL_MAX_ACCEL, device.strength / Math.max(dist, WELL_MIN_DIST))
        const inv = 1 / (dist || 1)
        d.vx += dx * inv * accel * dt
        d.vy += dy * inv * accel * dt
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

// Set alight every trooper a flame plume washes over: a segment of `len` from (x0, y0) along
// the unit direction (dx, dy), `radius` wide. Fire doesn't read uniforms: a pilot hovering on
// the burner over their own boarding queue torches it, which is why a loading ship cuts thrust
// and LANDS (and why the men give a hot engine room).
const ignitePlume = (
  world: World,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  len: number,
  radius: number
): void => {
  for (const d of world.devices) {
    if (d.kind !== DeviceKind.INFANTRY || d.sinking > 0 || d.swim > 0 || d.burning > 0) continue
    // Closest point on the plume segment to the trooper ((dx, dy) is unit length).
    const t = clamp((d.x - x0) * dx + (d.y - y0) * dy, 0, len)
    const px = x0 + dx * t
    const py = y0 + dy * t
    if (Math.hypot(d.x - px, d.y - py) > radius + d.radius) continue
    d.burning = INFANTRY_BURN_TIME
    spawnExplosion(world.particles, d.x, d.y, Color.THRUST, world.rng, 4)
  }
}

// A ship's live engine flames: the main afterburner plume behind the hull while thrusting, and
// the two smaller retro plumes reaching FORWARD past the nose while braking.
const igniteExhaust = (world: World, ship: Ship): void => {
  const nx = Math.cos(ship.angle)
  const ny = Math.sin(ship.angle)
  if (ship.thrusting) {
    ignitePlume(
      world,
      ship.x - nx * ship.radius,
      ship.y - ny * ship.radius,
      -nx,
      -ny,
      AFTERBURNER_IGNITE_LEN,
      AFTERBURNER_IGNITE_RADIUS
    )
  }
  if (ship.reversing) {
    // The retro nozzles sit on the nose's flanks; their plumes wash whatever the ship is
    // backing away from (perpendicular offset = ±(px, py)).
    const px = -ny * ship.radius * 0.55
    const py = nx * ship.radius * 0.55
    for (const side of [1, -1]) {
      ignitePlume(
        world,
        ship.x + nx * ship.radius + side * px,
        ship.y + ny * ship.radius + side * py,
        nx,
        ny,
        RETRO_IGNITE_LEN,
        RETRO_IGNITE_RADIUS
      )
    }
  }
}

// Resolve ship-vs-trooper contacts. A LANDED (or barely drifting) ship TOUCHING a trooper is a
// gentle hand: its own unit climbs aboard the troop bay (if there's room — a full bay leaves it
// fielded), while an ENEMY unit is recruited where it stands — it flips sides on the spot (the
// Dungeon-Keeper conversion; touch it again after the lockout to bay it). "Near" is not aboard:
// the hulls must actually meet. Any ship fast enough to ram (own or enemy) splatters the trooper
// it ploughs through instead, save for an owner still inside its trooper's deploy lockout (so a
// fast drop can't instantly mince it). A thrusting ship's exhaust sets troopers alight whatever
// its speed. Drowning is saveable by the trooper's OWN ship for INFANTRY_DROWN_RESCUE_WINDOW
// after it goes under (enemies can't recruit the sinking — only swimmers and the landed); past
// the window it's an unreachable corpse. Iterates from the tail so removals don't disturb
// pending indices.
export const resolveInfantryContacts = (world: World): void => {
  for (const ship of world.ships) {
    if (ship.thrusting || ship.reversing) igniteExhaust(world, ship)
    const speed = Math.hypot(ship.vx, ship.vy)
    const slow = speed <= INFANTRY_PICKUP_SPEED
    const ramming = speed > INFANTRY_RAM_SPEED
    if (!slow && !ramming) continue // a moderate fly-by neither rescues nor rams
    for (let i = world.devices.length - 1; i >= 0; i -= 1) {
      const d = world.devices[i]
      if (d.kind !== DeviceKind.INFANTRY) continue
      const rescuableDrowning = d.sinking > INFANTRY_SINK_TIME - INFANTRY_DROWN_RESCUE_WINDOW
      if (d.sinking > 0 && !rescuableDrowning) continue // a corpse past the rescue window: untouchable
      if (
        slow &&
        d.owner === ship.id &&
        !guardOnDuty(world, d) && // an alarmed watch stays on post; at ease, boarding IS the loading
        d.pickupLock <= 0 &&
        ship.troops < TROOP_BAY_CAPACITY &&
        (d.attached || d.swim > 0 || rescuableDrowning) &&
        circlesOverlap(ship.x, ship.y, ship.radius, d.x, d.y, d.radius)
      ) {
        world.devices.splice(i, 1)
        ship.troops = Math.min(TROOP_BAY_CAPACITY, ship.troops + 1)
        continue
      }
      if (
        slow &&
        d.owner !== ship.id &&
        d.pickupLock <= 0 &&
        d.sinking <= 0 &&
        (d.attached || d.swim > 0) &&
        circlesOverlap(ship.x, ship.y, ship.radius, d.x, d.y, d.radius)
      ) {
        // Recruited: same side-switch sparkle for both teams; the renderer's owner tint flips.
        // The lockout blocks an instant re-flip/scoop, and the reset cooldown denies a free shot.
        // A turned guard abandons its post — it's a regular trooper for its new master.
        d.owner = ship.id
        d.guard = false
        d.pickupLock = INFANTRY_PICKUP_DELAY
        d.fireCooldown = INFANTRY_FIRE_INTERVAL
        d.kneel = 0
        d.running = false
        spawnExplosion(world.particles, d.x, d.y, Color.EMP, world.rng, 8)
        continue
      }
      if (ramming && d.sinking <= 0 && circlesOverlap(ship.x, ship.y, ship.radius, d.x, d.y, d.radius)) {
        // A ship still in its own trooper's deploy lockout can't mince it — otherwise a fast
        // drop would splatter the unit the instant it left the hull. Enemies ram freely.
        if (d.owner === ship.id && d.pickupLock > 0) continue
        spawnExplosion(world.particles, d.x, d.y, Color.BLOOD, world.rng, 6)
        world.devices.splice(i, 1)
      }
    }
  }
}
