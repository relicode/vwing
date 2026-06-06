import { applyDamage } from '$/game/combat'
import { Color, RAIL_BEAM_LIFE, RAIL_DAMAGE, RAIL_RANGE } from '$/game/constants'
import type { Ship, World } from '$/game/types'

// Rail Lance hitscan: damage the nearest enemy ship lying along the ship's nose,
// draw the transient beam to that ship (or to max range), and return the struck
// ship so the caller can reap it if the hull is gone. Asteroids don't block it.
export const fireRail = (world: World, ship: Ship): Ship | undefined => {
  const dirX = Math.cos(ship.angle)
  const dirY = Math.sin(ship.angle)
  const originX = ship.x + dirX * ship.radius
  const originY = ship.y + dirY * ship.radius

  let hit: Ship | undefined
  let hitDist = RAIL_RANGE
  for (const other of world.ships) {
    if (other.id === ship.id || other.invuln > 0) continue
    const relX = other.x - originX
    const relY = other.y - originY
    const along = relX * dirX + relY * dirY // distance along the ray
    if (along < 0 || along > hitDist) continue
    const perp = Math.abs(relX * dirY - relY * dirX) // perpendicular offset from the ray
    if (perp > other.radius) continue
    hit = other
    hitDist = along
  }

  world.beams.push({
    x1: originX,
    y1: originY,
    x2: originX + dirX * hitDist,
    y2: originY + dirY * hitDist,
    life: RAIL_BEAM_LIFE,
    maxLife: RAIL_BEAM_LIFE,
    color: Color.RAIL,
  })
  if (hit) applyDamage(hit, RAIL_DAMAGE)
  return hit
}
