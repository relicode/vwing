import { Container, Graphics, type Renderer as PixiRenderer } from 'pixi.js'

import { GamePhase, MINIMAP_MARGIN, MINIMAP_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from '$/game/constants'
import { createBulletsView } from '$/game/render/bullets-view'
import { createFollowCamera, shakeOffset } from '$/game/render/camera-view'
import { drawBars, drawBase, drawBeams, drawDevice } from '$/game/render/entities'
import { drawMapMarkers, drawMapTerrain, MINIMAP_HEIGHT } from '$/game/render/minimap'
import type { PaletteSlots } from '$/game/render/owner-colors'
import { createParticlesView } from '$/game/render/particles-view'
import { createShipsView, shipBlinkHidden } from '$/game/render/ships-view'
import { createStarsView } from '$/game/render/stars'
import { createTerrainView } from '$/game/render/terrain'
import type { RenderWorld, Rng } from '$/game/types'

// Devices outside camera ± margin skip drawing; sized past the largest device visual (the
// singularity well's pull-radius ring) so nothing pops at the screen edge.
const DEVICE_CULL_MARGIN = 400

export type Renderer = {
  view: Container
  // `slots` (owner id → PLAYER_PALETTE slot) colors every pass per seat; absent — the offline
  // campaign — every pass keeps the legacy self/enemy binary exactly.
  draw: (world: RenderWorld, phase: GamePhase, selfId: number, slots?: PaletteSlots) => void
  destroy: () => void
}

export const createRenderer = (rng: Rng, pixiRenderer: PixiRenderer): Renderer => {
  const view = new Container()
  const starsView = createStarsView(rng, pixiRenderer)
  // A render group: the worldLayer scrolls as one unit every frame, so let the GPU own its
  // transform instead of re-walking the subtree on the CPU. Note: CullerPlugin culls before the
  // render-group transform updates, so a camera teleport (respawn snap) can cull a band or ship
  // one frame late — a single ~16 ms flicker at worst, inherent to the plugin, not a bug here.
  const worldLayer = new Container({ isRenderGroup: true })
  const terrainView = createTerrainView()
  const dynGfx = new Graphics()
  const bulletsView = createBulletsView(pixiRenderer)
  const particlesView = createParticlesView(pixiRenderer)
  // Ships sit above the fx passes: the sim draws ships after particles, so hulls read over
  // thrust puffs and explosion debris. The bars overlay stays immediate-mode and unrotated.
  const shipsView = createShipsView()
  const barsGfx = new Graphics()
  worldLayer.addChild(
    terrainView.container,
    dynGfx,
    bulletsView.container,
    particlesView.container,
    shipsView.layer,
    barsGfx
  )
  const mapLayer = new Container()
  const mapTerrainGfx = new Graphics()
  // The minimap silhouette only changes on a carve — render its thousands of tiny rects into a
  // cached texture once per terrainVersion instead of tessellating them every frame.
  mapTerrainGfx.cacheAsTexture(true)
  const mapDynGfx = new Graphics()
  mapLayer.addChild(mapTerrainGfx, mapDynGfx)
  view.addChild(starsView.container, worldLayer, mapLayer)
  const mapBaseX = VIEW_WIDTH - MINIMAP_WIDTH - MINIMAP_MARGIN
  const mapBaseY = VIEW_HEIGHT - MINIMAP_HEIGHT - MINIMAP_MARGIN
  const camera = createFollowCamera()
  // The map silhouette redraws only when terrain actually changes — the sim bumps
  // world.terrainVersion on every carve and while debris is falling, and once per fresh run.
  let mapTerrainVersion = -1
  let mapWaterVersion = -1

  const draw = (world: RenderWorld, phase: GamePhase, selfId: number, slots?: PaletteSlots): void => {
    const cam = camera.update(world, selfId)
    // Screen shake: wobble the whole view (stars + world) by the decaying amplitude.
    const shake = shakeOffset(world)
    view.position.set(shake.x, shake.y)
    worldLayer.position.set(-cam.x, -cam.y)
    starsView.update(cam)
    terrainView.draw(world)
    dynGfx.clear()
    for (const base of world.bases) drawBase(dynGfx, base, world.time, selfId, slots)
    // Manual CPU cull: Pixi can't cull inside one Graphics, and most of the infantry war is
    // happening far from the camera. The margin clears the largest device visual (well rings).
    const cullLeft = cam.x - DEVICE_CULL_MARGIN
    const cullRight = cam.x + VIEW_WIDTH + DEVICE_CULL_MARGIN
    const cullTop = cam.y - DEVICE_CULL_MARGIN
    const cullBottom = cam.y + VIEW_HEIGHT + DEVICE_CULL_MARGIN
    for (const device of world.devices) {
      if (device.x < cullLeft || device.x > cullRight || device.y < cullTop || device.y > cullBottom) continue
      drawDevice(dynGfx, device, world.time, selfId, slots)
    }
    drawBeams(dynGfx, world.beams)
    bulletsView.draw(world.bullets, selfId, slots)
    particlesView.draw(world.particles)
    // Ships are drawn only in-play: in TITLE/GAME_OVER updateShip never runs, so their
    // spawn invulnerability never ticks down and they'd blink forever over the backdrop.
    shipsView.layer.visible = phase === GamePhase.PLAYING
    barsGfx.clear()
    if (phase === GamePhase.PLAYING) {
      shipsView.draw(world.ships, world.time, selfId, slots)
      for (const ship of world.ships) {
        if (!shipBlinkHidden(ship, world.time)) drawBars(barsGfx, ship)
      }
    }
    // Minimap: in-play only (it's HUD furniture). Counter-shifted by the shake so the map
    // holds still while the battle view rattles.
    mapLayer.visible = phase === GamePhase.PLAYING
    if (mapLayer.visible) {
      mapLayer.position.set(mapBaseX - shake.x, mapBaseY - shake.y)
      if (world.terrainVersion !== mapTerrainVersion || world.waterVersion !== mapWaterVersion) {
        mapTerrainVersion = world.terrainVersion
        mapWaterVersion = world.waterVersion
        drawMapTerrain(mapTerrainGfx, world)
        mapTerrainGfx.updateCacheTexture() // re-render the cached texture from the fresh geometry
      }
      drawMapMarkers(mapDynGfx, world, cam, selfId, slots)
    }
  }

  const destroy = (): void => {
    mapTerrainGfx.cacheAsTexture(false) // release the minimap cache texture
    bulletsView.destroy()
    particlesView.destroy()
    shipsView.destroy()
    starsView.destroy()
    view.destroy({ children: true })
  }

  return { view, draw, destroy }
}
