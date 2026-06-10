import type { Graphics } from 'pixi.js'

import { Color, StructureType, Surface } from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'

// Per-surface fill + brighter edge for earth blocks; metal (any surface) always renders gray.
const SURFACE_STYLE: Record<Surface, { fill: number; edge: number }> = {
  [Surface.EARTH]: { fill: Color.ROCK, edge: Color.ROCK_EDGE },
  [Surface.GRASS]: { fill: Color.GRASS, edge: Color.GRASS_EDGE },
  [Surface.ICE]: { fill: Color.ICE, edge: Color.ICE_EDGE },
  [Surface.WATER]: { fill: Color.WATER, edge: Color.WATER_EDGE },
}
const METAL_STYLE = { fill: Color.BEDROCK, edge: Color.BEDROCK_EDGE }

// A block's fill/edge: metal is gray regardless of surface; earth takes its surface colour.
export const blockStyle = (b: Block): { fill: number; edge: number } =>
  b.structure === StructureType.METAL ? METAL_STYLE : SURFACE_STYLE[b.surface]

// Per-block flourishes (drawn once into the cached terrain layer, deterministic from block
// coords): metal rivets, else grass blades / ice shine streaks / earth cracks by surface.
const drawBlockDetail = (g: Graphics, b: Block): void => {
  if (b.structure === StructureType.METAL) {
    for (let x = b.x + 12; x < b.x + b.w - 6; x += 24) {
      for (let y = b.y + 12; y < b.y + b.h - 6; y += 24) {
        g.circle(x, y, 1.2).fill({ color: Color.BEDROCK_EDGE, alpha: 0.5 })
      }
    }
    return
  }
  switch (b.surface) {
    case Surface.GRASS:
      for (let x = b.x + 5; x < b.x + b.w - 3; x += 13) {
        g.moveTo(x, b.y)
          .lineTo(x + 2, b.y - 4)
          .stroke({ width: 1.5, color: Color.GRASS_EDGE, alpha: 0.85 })
      }
      break
    case Surface.ICE:
      for (let i = 0; i < 2; i += 1) {
        const ox = b.x + b.w * (0.25 + i * 0.4)
        g.moveTo(ox, b.y + 3)
          .lineTo(ox + b.h * 0.5, b.y + b.h * 0.5)
          .stroke({ width: 2, color: Color.ICE_EDGE, alpha: 0.4 })
      }
      break
    case Surface.EARTH: {
      const cx = b.x + b.w * 0.5
      g.moveTo(cx, b.y + 4)
        .lineTo(cx - b.w * 0.12, b.y + b.h * 0.4)
        .lineTo(cx + b.w * 0.08, b.y + b.h * 0.7)
        .stroke({ width: 1, color: Color.ROCK_EDGE, alpha: 0.35 })
      break
    }
    case Surface.WATER:
      break // water never appears on a block (it is a WaterBody overlay)
  }
}

// Static terrain: a filled rect per block with a brighter edge + detail.
export const drawBlocks = (g: Graphics, blocks: Block[]): void => {
  for (const b of blocks) {
    const style = blockStyle(b)
    g.rect(b.x, b.y, b.w, b.h).fill({ color: style.fill }).stroke({ width: 2, color: style.edge, alpha: 0.8 })
    drawBlockDetail(g, b)
  }
}

// Water bodies: a translucent volume with a brighter surface line at the top.
export const drawWaterBodies = (g: Graphics, water: WaterBody[]): void => {
  for (const b of water) {
    g.rect(b.x, b.y, b.w, b.h).fill({ color: Color.WATER, alpha: 0.38 })
    g.rect(b.x, b.y, b.w, 2).fill({ color: Color.WATER_EDGE, alpha: 0.8 })
  }
}
