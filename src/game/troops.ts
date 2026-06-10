import {
  DeviceKind,
  INFANTRY_FIRE_INTERVAL,
  INFANTRY_PICKUP_DELAY,
  INFANTRY_RADIUS,
  TROOP_SPECIALIST_CHANCE,
} from '$/game/constants'
import { randRange } from '$/game/rng'
import type { Ship, World } from '$/game/types'

// Drop a single trooper from the ship's bay, just below the hull (the deploy key held
// streams them out one per cadence). Most are riflemen; one in TROOP_SPECIALIST_CHANCE
// carries the man-portable version of the squad's heavy weapon kind.
export const spawnTrooper = (world: World, ship: Ship): void => {
  const heavy = world.rng() < TROOP_SPECIALIST_CHANCE ? ship.squad : undefined
  const walkDir = world.rng() < 0.5 ? -1 : 1
  world.devices.push({
    kind: DeviceKind.INFANTRY,
    x: ship.x + randRange(world.rng, -8, 8),
    y: ship.y + ship.radius + INFANTRY_RADIUS, // clear the whole body below the hull
    vx: ship.vx * 0.4,
    vy: Math.max(0, ship.vy * 0.4),
    owner: ship.id,
    radius: INFANTRY_RADIUS,
    heavy,
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
  })
}
