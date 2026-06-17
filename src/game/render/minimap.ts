import type { Graphics } from 'pixi.js'

import { baseHolder } from '$/game/bases'
import { Color, MINIMAP_WIDTH, VIEW_HEIGHT, VIEW_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import { ownerHex, type PaletteSlots } from '$/game/render/owner-colors'
import { blockStyle } from '$/game/render/terrain'
import type { RenderWorld, Vec2 } from '$/game/types'

// ── Minimap ──────────────────────────────────────────────────────────────────
// A corner overview of the whole arena: terrain silhouette + water, both bases, every ship —
// tinted with the same owner colors as the world — and the camera's current window.
const MAP_SCALE = MINIMAP_WIDTH / WORLD_WIDTH
export const MINIMAP_HEIGHT = Math.round(WORLD_HEIGHT * MAP_SCALE)

// The arena silhouette, cached per terrainVersion like the main terrain layer. Painted sizes
// get a floor so one-cell caps and shelves still read at map scale.
export const drawMapTerrain = (g: Graphics, world: RenderWorld): void => {
  g.clear()
  g.roundRect(-3, -3, MINIMAP_WIDTH + 6, MINIMAP_HEIGHT + 6, 4)
    .fill({ color: Color.BACKGROUND, alpha: 0.78 })
    .stroke({ width: 1, color: Color.BEDROCK_EDGE, alpha: 0.6 })
  for (const b of world.blocks) {
    const style = blockStyle(b)
    g.rect(b.x * MAP_SCALE, b.y * MAP_SCALE, Math.max(b.w * MAP_SCALE, 0.7), Math.max(b.h * MAP_SCALE, 0.7)).fill({
      color: style.fill,
      alpha: 0.9,
    })
  }
  for (const w of world.water) {
    g.rect(w.x * MAP_SCALE, w.y * MAP_SCALE, Math.max(w.w * MAP_SCALE, 0.7), Math.max(w.h * MAP_SCALE, 0.7)).fill({
      color: Color.WATER,
      alpha: 0.85,
    })
  }
}

// Live markers, redrawn each frame: bases as owner-tinted bunkers (the tint flips to the
// capturer when one falls), ships as palette-tinted dots — self gets a brighter core — plus
// the viewport box.
export const drawMapMarkers = (
  g: Graphics,
  world: RenderWorld,
  camera: Vec2,
  selfId: number,
  slots?: PaletteSlots
): void => {
  g.clear()
  for (const base of world.bases) {
    const color = ownerHex(baseHolder(base), selfId, slots)
    g.rect(base.x * MAP_SCALE - 3.5, base.y * MAP_SCALE - 5, 7, 5)
      .fill({ color, alpha: 0.9 })
      .stroke({ width: 1, color, alpha: 1 })
    // A bright core marks a base YOU hold — the same self-cue the player's own ship dot gets.
    if (baseHolder(base) === selfId) {
      g.circle(base.x * MAP_SCALE, base.y * MAP_SCALE - 2.5, 1.1).fill({ color: Color.SHIP_CORE })
    }
  }
  for (const ship of world.ships) {
    const own = ship.id === selfId
    const color = ownerHex(ship.id, selfId, slots)
    g.circle(ship.x * MAP_SCALE, ship.y * MAP_SCALE, own ? 3 : 2.4).fill({ color })
    if (own) g.circle(ship.x * MAP_SCALE, ship.y * MAP_SCALE, 1.2).fill({ color: Color.SHIP_CORE })
  }
  g.rect(camera.x * MAP_SCALE, camera.y * MAP_SCALE, VIEW_WIDTH * MAP_SCALE, VIEW_HEIGHT * MAP_SCALE).stroke({
    width: 1,
    color: Color.STAR_NEAR,
    alpha: 0.45,
  })
}
