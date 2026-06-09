import { clamp } from '$/game/math'
import type { Vec2 } from '$/game/types'

// Squared-distance circle overlap test — no sqrt, used for every entity pair each frame.
export const circlesOverlap = (ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean => {
  const dx = ax - bx
  const dy = ay - by
  const radii = ar + br
  return dx * dx + dy * dy <= radii * radii
}

// Nearest point on an axis-aligned rect (top-left x,y; size w,h) to an arbitrary point.
export const closestPointOnRect = (px: number, py: number, rx: number, ry: number, rw: number, rh: number): Vec2 => ({
  x: clamp(px, rx, rx + rw),
  y: clamp(py, ry, ry + rh),
})

// Contact between a circle and a block: an outward unit normal (pointing from the block
// toward the circle) plus the penetration depth needed to push the circle clear.
export type Contact = { nx: number; ny: number; depth: number }

const EPS = 1e-6

export const circleRectContact = (
  cx: number,
  cy: number,
  cr: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): Contact | undefined => {
  const qx = clamp(cx, rx, rx + rw)
  const qy = clamp(cy, ry, ry + rh)
  const dx = cx - qx
  const dy = cy - qy
  const d2 = dx * dx + dy * dy
  if (d2 > cr * cr) return undefined
  if (d2 > EPS) {
    const d = Math.sqrt(d2)
    return { nx: dx / d, ny: dy / d, depth: cr - d }
  }
  // Center is inside the rect: escape along the axis of least penetration.
  const left = cx - rx
  const right = rx + rw - cx
  const top = cy - ry
  const bottom = ry + rh - cy
  if (Math.min(left, right) < Math.min(top, bottom)) {
    return left < right ? { nx: -1, ny: 0, depth: cr + left } : { nx: 1, ny: 0, depth: cr + right }
  }
  return top < bottom ? { nx: 0, ny: -1, depth: cr + top } : { nx: 0, ny: 1, depth: cr + bottom }
}

// Does the segment (x1,y1)→(x2,y2) cross the axis-aligned rect? Liang–Barsky clipping:
// keep narrowing the [t0,t1] slice of the segment that stays inside every slab; if it
// ever empties, the segment misses. Used for line-of-sight tests against terrain.
export const segmentIntersectsRect = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean => {
  const dx = x2 - x1
  const dy = y2 - y1
  let t0 = 0
  let t1 = 1
  const accept = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0 // parallel to this edge: inside only if not on the outer side
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return accept(-dx, x1 - rx) && accept(dx, rx + rw - x1) && accept(-dy, y1 - ry) && accept(dy, ry + rh - y1)
}
