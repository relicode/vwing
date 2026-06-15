import { VOXEL_CELL } from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'

// A flat-topped slice of visible water: the rectangle [x, top] .. [x + w, floor]. Every slice of a
// body shares the body's surface `top` (water is level); `floor` is where solid terrain rises
// through the body across that span. Pure geometry so the presentation layer (and bun:test) can
// share it without touching pixi.
export type WaterQuad = { x: number; top: number; w: number; floor: number }

// Clip one water body to the actual empty space inside it, column by column at cell resolution. A
// body is stored as one flat-topped rectangle, but greedy meshing leaves higher solid blocks poking
// up through its span (a perched pool, or a water-cannon fill over an uneven bed). Drawing the whole
// rectangle smears translucent water across those solid high spots — the mesa-overlap look. Instead
// each column is filled only from the surface down to the first solid block standing in it, clamped
// to the body's own floor: water is never produced beyond the body, only carved away where rock
// rises through it. Equal-floor columns coalesce into one quad, so a flat bed still yields a couple
// of wide quads rather than one per cell.
export const waterQuads = (body: WaterBody, blocks: Block[]): WaterQuad[] => {
  const top = body.y
  const bottom = body.y + body.h
  // Only blocks overlapping the body's rectangle can shape its silhouette.
  const near = blocks.filter((k) => k.x < body.x + body.w && k.x + k.w > body.x && k.y < bottom && k.y + k.h > top)
  const quads: WaterQuad[] = []
  let runStart = -1
  let runFloor = bottom
  const flush = (xEnd: number): void => {
    if (runStart >= 0 && xEnd - runStart >= 0.5 && runFloor - top >= 0.5) {
      quads.push({ x: runStart, top, w: xEnd - runStart, floor: runFloor })
    }
    runStart = -1
  }
  for (let x = body.x; x < body.x + body.w - 0.5; x += VOXEL_CELL) {
    const mid = x + VOXEL_CELL / 2
    // The first solid this column meets going down from the surface: a block straddling the
    // waterline means the column is dry land (no water here); otherwise the highest block-top below
    // the surface is the floor.
    let floor = bottom
    let dry = false
    for (const k of near) {
      if (mid < k.x || mid >= k.x + k.w) continue
      if (k.y <= top + 0.5 && k.y + k.h > top + 0.5) {
        dry = true
        break
      }
      if (k.y > top && k.y < floor) floor = k.y
    }
    if (dry || floor - top < 0.5) {
      flush(x)
      continue
    }
    if (runStart < 0) {
      runStart = x
      runFloor = floor
    } else if (Math.abs(floor - runFloor) > 0.5) {
      flush(x)
      runStart = x
      runFloor = floor
    }
  }
  flush(body.x + body.w)
  return quads
}
