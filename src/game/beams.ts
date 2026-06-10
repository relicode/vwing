import { applyDamage } from '$/game/combat'
import { Color, RAIL_BEAM_LIFE, RAIL_DAMAGE, RAIL_RANGE } from '$/game/constants'
import type { Ship, World } from '$/game/types'

// Age out spent rail beams (damage was applied when they were fired).
export const updateBeams = (world: World, dt: number): void => {
  for (const beam of world.beams) beam.life -= dt
  world.beams = world.beams.filter((beam) => beam.life > 0)
}

// Shared rail hitscan: damage the nearest enemy ship lying along the ray from (x, y), draw the
// transient beam to that ship (or to max range), and return the struck ship so the caller can
// reap it if the hull is gone. Terrain does not block it. Fired by ships (full power along the
// nose) and by kneeling rail troopers (a scaled man-portable lance).
export const castRail = (
  world: World,
  x: number,
  y: number,
  angle: number,
  ownerId: number,
  range: number,
  damage: number
): Ship | undefined => {
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)

  let hit: Ship | undefined
  let hitDist = range
  for (const other of world.ships) {
    if (other.id === ownerId || other.invuln > 0) continue
    const relX = other.x - x
    const relY = other.y - y
    const along = relX * dirX + relY * dirY // distance along the ray
    if (along < 0 || along > hitDist) continue
    const perp = Math.abs(relX * dirY - relY * dirX) // perpendicular offset from the ray
    if (perp > other.radius) continue
    hit = other
    hitDist = along
  }

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

// The ship's Rail Lance: full-power hitscan from the nose.
export const fireRail = (world: World, ship: Ship): Ship | undefined =>
  castRail(
    world,
    ship.x + Math.cos(ship.angle) * ship.radius,
    ship.y + Math.sin(ship.angle) * ship.radius,
    ship.angle,
    ship.id,
    RAIL_RANGE,
    RAIL_DAMAGE
  )
