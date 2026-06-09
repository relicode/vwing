import { circleRectContact } from '$/game/collision'
import { BOUNCE_RESTITUTION, CRASH_SPEED, LAND_SPEED, SURFACE_FRICTION } from '$/game/constants'
import type { Block, Ship } from '$/game/types'

// The outcome of resolving a ship against terrain for one frame.
export type TerrainResult = 'none' | 'land' | 'bounce' | 'crash'

const SEVERITY: Record<TerrainResult, number> = { none: 0, land: 1, bounce: 2, crash: 3 }
const worse = (a: TerrainResult, b: TerrainResult): TerrainResult => (SEVERITY[a] >= SEVERITY[b] ? a : b)

// Resolve a ship against every overlapping block: push it out of penetration and reshape
// its velocity by the impact speed (closing speed along the contact normal). Below
// LAND_SPEED the ship rests on the surface and sheds tangential speed by the block's
// surface friction (ICE keeps it; grass/earth/metal grip); up to CRASH_SPEED it bounces;
// at/above it the ship is flagged 'crash' (and hard-stopped so an invulnerable ship the
// engine spares can't tunnel). Returns the most severe outcome across all contacts.
export const resolveShipTerrain = (ship: Ship, blocks: Block[], dt: number): TerrainResult => {
  const pending: { block: Block; depth: number }[] = []
  for (const block of blocks) {
    const c = circleRectContact(ship.x, ship.y, ship.radius, block.x, block.y, block.w, block.h)
    if (c) pending.push({ block, depth: c.depth })
  }
  if (pending.length === 0) return 'none'
  // Resolve the deepest contact first so a wedge between two blocks settles cleanly.
  pending.sort((a, b) => b.depth - a.depth)

  let result: TerrainResult = 'none'
  for (const { block } of pending) {
    // Re-test live: an earlier push-out may have already separated this pair.
    const c = circleRectContact(ship.x, ship.y, ship.radius, block.x, block.y, block.w, block.h)
    if (!c) continue
    ship.x += c.nx * c.depth
    ship.y += c.ny * c.depth
    const vn = ship.vx * c.nx + ship.vy * c.ny
    if (vn >= 0) continue // separating or tangential: position corrected, leave velocity alone
    const impact = -vn
    if (impact >= CRASH_SPEED) {
      ship.vx -= vn * c.nx
      ship.vy -= vn * c.ny
      result = worse(result, 'crash')
    } else if (impact > LAND_SPEED) {
      ship.vx -= (1 + BOUNCE_RESTITUTION) * vn * c.nx
      ship.vy -= (1 + BOUNCE_RESTITUTION) * vn * c.ny
      result = worse(result, 'bounce')
    } else {
      ship.vx -= vn * c.nx
      ship.vy -= vn * c.ny
      const damp = Math.exp(-SURFACE_FRICTION[block.surface] * dt)
      ship.vx *= damp
      ship.vy *= damp
      result = worse(result, 'land')
    }
  }
  return result
}
