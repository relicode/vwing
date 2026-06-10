import { clamp } from '$/game/math'
import type { Ship, WaterBody } from '$/game/types'

// The water body at (x, y): among bodies whose x-span contains x, the one whose vertical span is
// nearest to y (0 distance = y is inside it). Pools can stack at one x (a perched basin above the
// lake), so the query is y-aware rather than assuming one body per column.
const bodyAt = (water: WaterBody[], x: number, y: number): WaterBody | undefined => {
  let best: WaterBody | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const body of water) {
    if (x < body.x || x > body.x + body.w) continue
    const dist = Math.max(0, body.y - y, y - (body.y + body.h)) // 0 when y is within the body
    if (dist < bestDist) {
      bestDist = dist
      best = body
    }
  }
  return best
}

// Surface (top) y of the water body nearest (x, y), or undefined if there's no water there.
export const waterSurfaceAt = (water: WaterBody[], x: number, y: number): number | undefined => bodyAt(water, x, y)?.y

// How submerged a ship is, 0 (dry / above the surface) .. 1 (fully under), against the water body
// nearest the ship's centre.
export const submersion = (ship: Ship, water: WaterBody[]): number => {
  const body = bodyAt(water, ship.x, ship.y)
  if (!body) return 0
  const depth = clamp(ship.y + ship.radius - body.y, 0, ship.radius * 2)
  return depth / (ship.radius * 2)
}

// Two water bodies' rectangles overlap (touching counts), used to decide whether a freshly pooled
// basin merges with an existing body.
const overlaps = (a: WaterBody, b: WaterBody): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

// The bounding union of two water bodies (highest surface, deepest bottom, widest span).
const union = (a: WaterBody, b: WaterBody): WaterBody => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: right - x, h: bottom - y }
}

// Add a freshly detected basin pool to the water set, absorbing any bodies its rectangle overlaps
// (so adjacent pools fuse) while leaving vertically-stacked bodies separate. At the body cap a
// non-merging new pool is dropped (rather than growing the set without bound). Returns a new array.
export const addPool = (water: WaterBody[], pool: WaterBody, maxBodies: number): WaterBody[] => {
  let merged = pool
  let rest = water
  let absorbedAny = false
  let changed = true
  while (changed) {
    changed = false
    const next: WaterBody[] = []
    for (const body of rest) {
      if (overlaps(body, merged)) {
        merged = union(body, merged)
        absorbedAny = true
        changed = true
      } else {
        next.push(body)
      }
    }
    rest = next
  }
  if (!absorbedAny && rest.length >= maxBodies) return water // at cap and nothing to fuse: skip
  return [...rest, merged]
}

// Pour `area` px² of water into a basin: the level climbs by area/width per pour — fast in a
// gully, slow in a wide bowl — capped at the basin's spill level (basin.y). A first pour seeds a
// sliver at the basin floor; later pours raise the existing body, fusing into neighbours through
// addPool. One squirt never conjures the whole basin. Returns a new array (or `water` unchanged
// when the basin is already full / the body cap blocks a fresh seed).
export const raisePool = (water: WaterBody[], basin: WaterBody, area: number, maxBodies: number): WaterBody[] => {
  const existing = water.find((body) => overlaps(body, basin))
  if (existing) {
    if (existing.y <= basin.y) return water // already at (or past) the spill level — full
    const newY = Math.max(basin.y, existing.y - area / existing.w)
    const raised: WaterBody = { x: existing.x, y: newY, w: existing.w, h: existing.h + (existing.y - newY) }
    return addPool(
      water.filter((body) => body !== existing),
      raised,
      maxBodies
    )
  }
  const h = Math.min(area / basin.w, basin.h)
  return addPool(water, { x: basin.x, y: basin.y + basin.h - h, w: basin.w, h }, maxBodies)
}
