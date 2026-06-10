import {
  BASE_GUARD_RANGE,
  DeviceKind,
  INFANTRY_FIRE_INTERVAL,
  INFANTRY_PICKUP_DELAY,
  INFANTRY_RADIUS,
  TROOP_SPECIALIST_CHANCE,
  type WeaponKind,
} from '$/game/constants'
import { randRange } from '$/game/rng'
import type { Base, Ship, World } from '$/game/types'

// Drop a single trooper from the ship's bay, just below the hull (the deploy key held
// streams them out one per cadence). Most are riflemen; one in TROOP_SPECIALIST_CHANCE
// carries the man-portable version of the squad's heavy weapon kind.
export const spawnTrooper = (world: World, ship: Ship): void => {
  const heavy = world.rng() < TROOP_SPECIALIST_CHANCE ? ship.squad : undefined
  const walkDir = world.rng() < 0.5 ? -1 : 1
  world.devices.push({
    kind: DeviceKind.INFANTRY,
    // Spawn at the hull center: the trooper (radius 9) fits anywhere the ship (radius 12) does,
    // so a drop from a LANDED ship steps out beside it instead of materializing inside the pad
    // (which read as an embedded death). Mid-flight it tumbles out of the hull and falls clear —
    // the deploy lockout already protects it from its own ship's ram.
    x: ship.x + randRange(world.rng, -8, 8),
    y: ship.y,
    vx: ship.vx * 0.4,
    vy: Math.max(0, ship.vy * 0.4),
    owner: ship.id,
    radius: INFANTRY_RADIUS,
    heavy,
    guard: false,
    attached: false,
    swim: 0,
    sinking: 0,
    chute: -1,
    pickupLock: INFANTRY_PICKUP_DELAY,
    walkDir,
    facing: walkDir,
    groundLeft: 0,
    groundRight: 0,
    fireCooldown: randRange(world.rng, 0, INFANTRY_FIRE_INTERVAL),
    kneel: 0,
    running: false,
    slide: 0,
    burning: 0,
    stun: 0,
  })
}

// A garrison guard stepping out the barracks door, already on its feet on the pad. It patrols
// a fixed span around the pad center, rolls the same one-in-five specialist chance off the
// owner ship's current squad kind (riflemen only while the owner is out of play), and never
// boards a ship — the bay loads from the housed count, not from the watch.
export const spawnGuard = (world: World, base: Base, squad: WeaponKind | undefined): void => {
  const heavy = squad !== undefined && world.rng() < TROOP_SPECIALIST_CHANCE ? squad : undefined
  const walkDir = world.rng() < 0.5 ? -1 : 1
  world.devices.push({
    kind: DeviceKind.INFANTRY,
    x: base.x + randRange(world.rng, -10, 10),
    y: base.y - INFANTRY_RADIUS,
    vx: 0,
    vy: 0,
    owner: base.owner,
    radius: INFANTRY_RADIUS,
    heavy,
    guard: true,
    attached: true,
    swim: 0,
    sinking: 0,
    chute: -1,
    pickupLock: 0,
    walkDir,
    facing: walkDir,
    groundLeft: base.x - BASE_GUARD_RANGE,
    groundRight: base.x + BASE_GUARD_RANGE,
    fireCooldown: randRange(world.rng, 0, INFANTRY_FIRE_INTERVAL),
    kneel: 0,
    running: false,
    slide: 0,
    burning: 0,
    stun: 0,
  })
}
