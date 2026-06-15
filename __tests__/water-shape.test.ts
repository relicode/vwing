import { describe, expect, test } from 'bun:test'

import { StructureType, Surface } from '$/game/constants'
import { waterQuads } from '$/game/render/water-shape'
import type { Block, WaterBody } from '$/game/types'

// A solid block in pixel coords; waterQuads only reads x/y/w/h, so the surface/structure are filler.
const block = (x: number, y: number, w: number, h: number): Block => ({
  x,
  y,
  w,
  h,
  structure: StructureType.EARTH,
  surface: Surface.EARTH,
})

// Surface at y=100, bed 100 px down at y=200; 180 px wide = 10 cells.
const body: WaterBody = { x: 0, y: 100, w: 180, h: 100 }

describe('waterQuads — water hugs the basin floor instead of painting over solid rock', () => {
  test('an empty body draws as one full-height quad (no fragmentation over a flat bed)', () => {
    const quads = waterQuads(body, [])
    expect(quads).toEqual([{ x: 0, top: 100, w: 180, floor: 200 }])
  })

  test('a raised block inside the span carves the fill down to its top — never over it', () => {
    // Left half: shallow shelf (top at y=160). Right half: deep floor (top at y=190). One rect
    // would paint translucent water from y=100 to y=200 straight over the left shelf; the conform
    // splits it into two flat-topped quads, each stopping at its own column's solid.
    const blocks = [block(0, 160, 90, 300), block(90, 190, 90, 300)]
    const quads = waterQuads(body, blocks)
    expect(quads).toEqual([
      { x: 0, top: 100, w: 90, floor: 160 },
      { x: 90, top: 100, w: 90, floor: 190 },
    ])
    // No quad reaches below the solid that stands in its span (the mesa-overlap bug).
    expect(quads.every((q) => q.floor <= 200)).toBeTrue()
    expect(quads[0].floor).toBeLessThan(quads[1].floor) // the shallow shelf reads as shallower water
  })

  test('a column of dry land (a block straddling the waterline) leaves a gap with no water', () => {
    // A pillar pokes above the surface mid-span (y=80..300 straddles the y=100 waterline): the two
    // pooled stretches on either side stay separate, and no water is drawn over the pillar.
    const blocks = [block(72, 80, 18, 220)]
    const quads = waterQuads(body, blocks)
    expect(quads).toEqual([
      { x: 0, top: 100, w: 72, floor: 200 },
      { x: 90, top: 100, w: 90, floor: 200 },
    ])
  })
})
