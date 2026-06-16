import { clamp } from '$/game/math'
import type { Ship, WaterBody } from '$/game/types'

// Physics queries against `world.water` — the rectangle VIEW of the per-cell fluid (see
// voxel.ts fluidToBodies): one flat-topped body per column run. Ship buoyancy and infantry
// wading/drowning read water purely through these, so the switch to a flowing fluid never touched
// those call sites — only what fills world.water changed.

// The water body at (x, y): among bodies whose x-span contains x, the one whose vertical span is
// nearest to y (0 distance = y is inside it). Bodies can stack at one x (a perched run above the
// lake), so the query is y-aware. Ties (a point submerged in two adjacent per-column bodies at a
// seam) break toward the body whose centre is nearest x — a stable choice that won't flip frame to
// frame as the fluid's per-column surfaces wobble, so buoyancy/wading don't jitter at a column edge.
const bodyAt = (water: WaterBody[], x: number, y: number): WaterBody | undefined => {
  let best: WaterBody | undefined
  let bestDist = Number.POSITIVE_INFINITY
  let bestXd = Number.POSITIVE_INFINITY
  for (const body of water) {
    if (x < body.x || x > body.x + body.w) continue
    const dist = Math.max(0, body.y - y, y - (body.y + body.h)) // 0 when y is within the body
    const xd = Math.abs(x - (body.x + body.w / 2))
    if (dist < bestDist || (dist === bestDist && xd < bestXd)) {
      bestDist = dist
      bestXd = xd
      best = body
    }
  }
  return best
}

// Surface (top) y of the water body nearest (x, y), or undefined if there's no water there.
export const waterSurfaceAt = (water: WaterBody[], x: number, y: number): number | undefined => bodyAt(water, x, y)?.y

// How submerged a ship is, 0 (dry / above the surface) .. 1 (fully under), against the water body
// nearest the ship's centre. Depth is clamped to the body's actual height too, so a ship can't read
// as more submerged than the water is deep — a thin poured film gives a thin film's buoyancy, not a
// full dunk's.
export const submersion = (ship: Ship, water: WaterBody[]): number => {
  const body = bodyAt(water, ship.x, ship.y)
  if (!body) return 0
  const depth = clamp(ship.y + ship.radius - body.y, 0, ship.radius * 2)
  return Math.min(depth, body.h) / (ship.radius * 2)
}
