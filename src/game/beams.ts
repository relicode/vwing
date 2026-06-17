import { baseBuilding, shellBase, shelteredInBase } from '$/game/bases'
import { applyDamage } from '$/game/combat'
import { Color, DeviceKind, RAIL_BEAM_LIFE, RAIL_DAMAGE, RAIL_RANGE } from '$/game/constants'
import { burst } from '$/game/particles'
import type { Base, Device, Ship, World } from '$/game/types'

// Age out spent rail beams (damage was applied when they were fired).
export const updateBeams = (world: World, dt: number): void => {
  for (const beam of world.beams) beam.life -= dt
  world.beams = world.beams.filter((beam) => beam.life > 0)
}

// Distance along a ray (origin + t·dir, t >= 0) to its entry into a rect, or undefined if the
// ray misses. Slab method; an origin already inside returns 0 (a muzzle pressed to the rock).
const rayRectEntry = (
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  b: { x: number; y: number; w: number; h: number }
): number | undefined => {
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY
  for (const [origin, dir, lo, hi] of [
    [x, dirX, b.x, b.x + b.w],
    [y, dirY, b.y, b.y + b.h],
  ] as const) {
    if (dir === 0) {
      if (origin < lo || origin > hi) return undefined
    } else {
      const t1 = (lo - origin) / dir
      const t2 = (hi - origin) / dir
      tMin = Math.max(tMin, Math.min(t1, t2))
      tMax = Math.min(tMax, Math.max(t1, t2))
    }
  }
  return tMin <= tMax ? tMin : undefined
}

// Shared rail hitscan: damage the nearest enemy ship lying along the ray from (x, y), draw the
// transient beam to that ship (or to the first terrain face, or to max range), and return the
// struck ship so the caller can reap it if the hull is gone. Terrain blocks the lance — it
// burns into the first wall it meets, never through a mountain, and an enemy barracks counts
// as a wall (an indestructible one: it stops the lance and shrugs it off) — but flesh doesn't: EVERY
// trooper along the beam dies, either side's (friendly fire is real; `self` exempts only the
// kneeling sniper's own body from its own lance). Killed troopers are marked into
// `deadTroopers` — the caller removes them, because the device array may be mid-iteration.
// Fired by ships (full power along the nose) and by kneeling rail troopers (a scaled
// man-portable lance).
export const castRail = (
  world: World,
  x: number,
  y: number,
  angle: number,
  ownerId: number,
  range: number,
  damage: number,
  deadTroopers: Set<Device>,
  self?: Device
): Ship | undefined => {
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)

  let hit: Ship | undefined
  let struckBase: Base | undefined
  let hitDist = range
  for (const block of world.blocks) {
    const t = rayRectEntry(x, y, dirX, dirY, block)
    if (t !== undefined && t < hitDist) hitDist = t // the beam stops at the nearest terrain face
  }
  // The barracks building stops the SHIP's lance like any wall — and the strike rolls a sheltered
  // defender's death (shellBase below); friendly fire counts, so the holder's own building is no
  // longer transparent to its own fire. A kneeling trooper's man-portable lance (`self` set) is
  // small arms like every other infantry round: it passes the band untouched — the wall fight
  // happens through the slits, and a rail specialist pressed to the wall would otherwise fire a
  // zero-length lance into the face at his nose.
  for (const base of self === undefined ? world.bases : []) {
    const t = rayRectEntry(x, y, dirX, dirY, baseBuilding(base))
    if (t !== undefined && t < hitDist) {
      hitDist = t
      struckBase = base
    }
  }
  for (const other of world.ships) {
    if (other.id === ownerId || other.invuln > 0) continue
    const relX = other.x - x
    const relY = other.y - y
    const along = relX * dirX + relY * dirY // distance along the ray
    if (along < 0 || along > hitDist) continue
    const perp = Math.abs(relX * dirY - relY * dirX) // perpendicular offset from the ray
    if (perp > other.radius) continue
    hit = other
    hitDist = along // a ship in front soaks the lance before it reaches any wall
    struckBase = undefined // …and shields the building behind it from the strike
  }
  // The lance pierces infantry: every trooper lying on the beam (up to whatever stopped it —
  // terrain face or struck ship) dies where it stands, whichever side it fights for — except a
  // defender sheltering inside its own building (the opaque wall already stopped the lance).
  for (const d of world.devices) {
    if (d.kind !== DeviceKind.INFANTRY || d === self || d.sinking > 0) continue
    if (shelteredInBase(world, d.owner, d.x, d.y)) continue
    const relX = d.x - x
    const relY = d.y - y
    const along = relX * dirX + relY * dirY
    if (along < 0 || along > hitDist) continue
    if (Math.abs(relX * dirY - relY * dirX) > d.radius) continue
    burst(world, d.x, d.y, Color.BLOOD, 6)
    deadTroopers.add(d)
  }
  if (struckBase) shellBase(world, struckBase, damage)

  world.beams.push({
    x1: x,
    y1: y,
    x2: x + dirX * hitDist,
    y2: y + dirY * hitDist,
    life: RAIL_BEAM_LIFE,
    maxLife: RAIL_BEAM_LIFE,
    color: Color.RAIL,
  })
  if (hit) {
    applyDamage(hit, damage)
    hit.lastHitBy = ownerId
  }
  return hit
}

// The ship's Rail Lance: full-power hitscan from the nose. Fired from the ship-input pass
// (never mid-device-iteration), so the pierced troopers can be removed on the spot.
export const fireRail = (world: World, ship: Ship): Ship | undefined => {
  const deadTroopers = new Set<Device>()
  const hit = castRail(
    world,
    ship.x + Math.cos(ship.angle) * ship.radius,
    ship.y + Math.sin(ship.angle) * ship.radius,
    ship.angle,
    ship.id,
    RAIL_RANGE,
    RAIL_DAMAGE,
    deadTroopers
  )
  if (deadTroopers.size > 0) world.devices = world.devices.filter((d) => !deadTroopers.has(d))
  return hit
}
