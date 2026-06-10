import { Container, Graphics, type Renderer as PixiRenderer } from 'pixi.js'

import { GamePhase, MINIMAP_MARGIN, MINIMAP_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from '$/game/constants'
import { createBulletsView } from '$/game/render/bullets-view'
import { createFollowCamera, shakeOffset } from '$/game/render/camera-view'
import { drawBase, drawBeams, drawDevice, drawShip } from '$/game/render/entities'
import { drawMapMarkers, drawMapTerrain, MINIMAP_HEIGHT } from '$/game/render/minimap'
import { createParticlesView } from '$/game/render/particles-view'
import { createStars, drawStars } from '$/game/render/stars'
import { drawBlocks, drawWaterBodies } from '$/game/render/terrain'
import type { RenderWorld, Rng } from '$/game/types'

export type Renderer = {
  view: Container
  draw: (world: RenderWorld, phase: GamePhase, selfId: number) => void
  destroy: () => void
}

export const createRenderer = (rng: Rng, pixiRenderer: PixiRenderer): Renderer => {
  const view = new Container()
  const starLayer = new Graphics()
  const worldLayer = new Container()
  const terrainGfx = new Graphics()
  const dynGfx = new Graphics()
  const bulletsView = createBulletsView(pixiRenderer)
  const particlesView = createParticlesView(pixiRenderer)
  // shipGfx sits above the fx passes: the sim draws ships after particles, so hulls read
  // over thrust puffs and explosion debris exactly as before the ParticleContainer move.
  const shipGfx = new Graphics()
  worldLayer.addChild(terrainGfx, dynGfx, bulletsView.container, particlesView.container, shipGfx)
  const mapLayer = new Container()
  const mapTerrainGfx = new Graphics()
  const mapDynGfx = new Graphics()
  mapLayer.addChild(mapTerrainGfx, mapDynGfx)
  view.addChild(starLayer, worldLayer, mapLayer)
  const mapBaseX = VIEW_WIDTH - MINIMAP_WIDTH - MINIMAP_MARGIN
  const mapBaseY = VIEW_HEIGHT - MINIMAP_HEIGHT - MINIMAP_MARGIN
  const stars = createStars(rng)
  const camera = createFollowCamera()
  // Redraw the cached terrain layers only when they actually change — the sim bumps
  // world.terrainVersion on every carve and while debris is falling, and once per fresh run.
  let terrainVersion = -1
  let mapTerrainVersion = -1

  const draw = (world: RenderWorld, phase: GamePhase, selfId: number): void => {
    const cam = camera.update(world, selfId)
    // Screen shake: wobble the whole view (stars + world) by the decaying amplitude.
    const shake = shakeOffset(world)
    view.position.set(shake.x, shake.y)
    worldLayer.position.set(-cam.x, -cam.y)
    drawStars(starLayer, stars, cam)
    if (world.terrainVersion !== terrainVersion) {
      terrainVersion = world.terrainVersion
      terrainGfx.clear()
      drawBlocks(terrainGfx, world.blocks)
      drawWaterBodies(terrainGfx, world.water)
    }
    dynGfx.clear()
    for (const base of world.bases) drawBase(dynGfx, base, world.time, selfId)
    for (const device of world.devices) drawDevice(dynGfx, device, world.time, selfId)
    drawBeams(dynGfx, world.beams)
    bulletsView.draw(world.bullets, selfId)
    particlesView.draw(world.particles)
    // Ships are drawn only in-play: in TITLE/GAME_OVER updateShip never runs, so their
    // spawn invulnerability never ticks down and they'd blink forever over the backdrop.
    shipGfx.clear()
    if (phase === GamePhase.PLAYING)
      for (const ship of world.ships) drawShip(shipGfx, ship, world.time, ship.id === selfId)
    // Minimap: in-play only (it's HUD furniture). Counter-shifted by the shake so the map
    // holds still while the battle view rattles.
    mapLayer.visible = phase === GamePhase.PLAYING
    if (mapLayer.visible) {
      mapLayer.position.set(mapBaseX - shake.x, mapBaseY - shake.y)
      if (world.terrainVersion !== mapTerrainVersion) {
        mapTerrainVersion = world.terrainVersion
        drawMapTerrain(mapTerrainGfx, world)
      }
      drawMapMarkers(mapDynGfx, world, cam, selfId)
    }
  }

  const destroy = (): void => {
    bulletsView.destroy()
    particlesView.destroy()
    view.destroy({ children: true })
  }

  return { view, draw, destroy }
}
