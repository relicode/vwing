import { Container, Graphics } from 'pixi.js'

import { cameraOrigin } from '$/game/camera'
import {
  CAMERA_EASE_RATE,
  CAMERA_SNAP_DIST,
  Color,
  DeviceKind,
  GamePhase,
  InfantryWeapon,
  PLAYER_ID,
  SHAKE_FREQ,
  SHIP_MAX_HEALTH,
  SHIP_MAX_SHIELDS,
  ShipKind,
  SurfaceMaterial,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from '$/game/constants'
import { clamp } from '$/game/math'
import { randRange } from '$/game/rng'
import type { Beam, Block, Device, Particle, Rng, Ship, Vec2, WaterBody, World } from '$/game/types'

type Star = { x: number; y: number; depth: number; size: number }

const STAR_COUNT = 150
const WING_SPREAD = 2.4 // radians from nose to each tail corner

export type Renderer = {
  view: Container
  draw: (world: World, phase: GamePhase) => void
  destroy: () => void
}

const createStars = (rng: Rng): Star[] => {
  const stars: Star[] = []
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const depth = randRange(rng, 0.15, 0.6)
    stars.push({
      x: randRange(rng, 0, VIEW_WIDTH),
      y: randRange(rng, 0, VIEW_HEIGHT),
      depth,
      size: 0.6 + depth * 2,
    })
  }
  return stars
}

// Screen-space parallax: nearer stars (higher depth) slide faster with the camera.
const drawStars = (g: Graphics, stars: Star[], camera: Vec2): void => {
  g.clear()
  for (const star of stars) {
    const x = (((star.x - camera.x * star.depth) % VIEW_WIDTH) + VIEW_WIDTH) % VIEW_WIDTH
    const y = (((star.y - camera.y * star.depth) % VIEW_HEIGHT) + VIEW_HEIGHT) % VIEW_HEIGHT
    const color = star.depth > 0.42 ? Color.STAR_NEAR : Color.STAR_FAR
    g.circle(x, y, star.size).fill({ color, alpha: 0.35 + star.depth * 0.8 })
  }
}

// Per-material fill + brighter edge for terrain blocks.
const BLOCK_STYLE: Record<SurfaceMaterial, { fill: number; edge: number }> = {
  [SurfaceMaterial.BEDROCK]: { fill: Color.BEDROCK, edge: Color.BEDROCK_EDGE },
  [SurfaceMaterial.ROCK]: { fill: Color.ROCK, edge: Color.ROCK_EDGE },
  [SurfaceMaterial.GRASS]: { fill: Color.GRASS, edge: Color.GRASS_EDGE },
  [SurfaceMaterial.ICE]: { fill: Color.ICE, edge: Color.ICE_EDGE },
}

// Per-material flourishes (drawn once into the cached terrain layer, deterministic from
// block coords): grass blades, ice shine streaks, bedrock rivets, rock cracks.
const drawBlockDetail = (g: Graphics, b: Block): void => {
  switch (b.material) {
    case SurfaceMaterial.GRASS:
      for (let x = b.x + 5; x < b.x + b.w - 3; x += 13) {
        g.moveTo(x, b.y)
          .lineTo(x + 2, b.y - 4)
          .stroke({ width: 1.5, color: Color.GRASS_EDGE, alpha: 0.85 })
      }
      break
    case SurfaceMaterial.ICE:
      for (let i = 0; i < 2; i += 1) {
        const ox = b.x + b.w * (0.25 + i * 0.4)
        g.moveTo(ox, b.y + 3)
          .lineTo(ox + b.h * 0.5, b.y + b.h * 0.5)
          .stroke({ width: 2, color: Color.ICE_EDGE, alpha: 0.4 })
      }
      break
    case SurfaceMaterial.BEDROCK:
      for (let x = b.x + 12; x < b.x + b.w - 6; x += 24) {
        for (let y = b.y + 12; y < b.y + b.h - 6; y += 24) {
          g.circle(x, y, 1.2).fill({ color: Color.BEDROCK_EDGE, alpha: 0.5 })
        }
      }
      break
    case SurfaceMaterial.ROCK: {
      const cx = b.x + b.w * 0.5
      g.moveTo(cx, b.y + 4)
        .lineTo(cx - b.w * 0.12, b.y + b.h * 0.4)
        .lineTo(cx + b.w * 0.08, b.y + b.h * 0.7)
        .stroke({ width: 1, color: Color.ROCK_EDGE, alpha: 0.35 })
      break
    }
  }
}

// Static terrain: a filled rect per block with a brighter material edge + detail.
const drawBlocks = (g: Graphics, blocks: Block[]): void => {
  for (const b of blocks) {
    const style = BLOCK_STYLE[b.material]
    g.rect(b.x, b.y, b.w, b.h).fill({ color: style.fill }).stroke({ width: 2, color: style.edge, alpha: 0.8 })
    drawBlockDetail(g, b)
  }
}

const drawParticles = (g: Graphics, particles: Particle[]): void => {
  for (const p of particles) {
    g.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: Math.max(0, p.life / p.maxLife) })
  }
}

// Water bodies: a translucent volume with a brighter surface line at the top.
const drawWaterBodies = (g: Graphics, water: WaterBody[]): void => {
  for (const b of water) {
    g.rect(b.x, b.y, b.w, b.h).fill({ color: Color.WATER, alpha: 0.38 })
    g.rect(b.x, b.y, b.w, 2).fill({ color: Color.WATER_EDGE, alpha: 0.8 })
  }
}

const drawDevice = (g: Graphics, d: Device): void => {
  switch (d.kind) {
    case DeviceKind.MISSILE: {
      const a = Math.atan2(d.vy, d.vx)
      g.moveTo(d.x - Math.cos(a) * d.radius * 2.4, d.y - Math.sin(a) * d.radius * 2.4)
        .lineTo(d.x, d.y)
        .stroke({ width: 2, color: d.color, alpha: 0.55 })
      g.circle(d.x, d.y, d.radius).fill({ color: d.color })
      break
    }
    case DeviceKind.MINE: {
      const armed = d.armTime <= 0
      const color = armed ? Color.MINE_ARMED : Color.MINE
      g.circle(d.x, d.y, d.radius).stroke({ width: 2, color })
      g.circle(d.x, d.y, d.radius * 0.4).fill({ color })
      break
    }
    case DeviceKind.INFANTRY: {
      // Cannon-Fodder-style trooper: head + torso, a weapon that reads its type, facing its
      // movement/aim direction, with a parachute canopy overhead while descending.
      const r = d.radius
      const f = d.facing >= 0 ? 1 : -1
      const alpha = d.sinking > 0 ? 0.3 : d.swim > 0 ? 0.55 : 1
      if (d.chute >= 0) {
        const open = 0.35 + d.chute * 0.65 // canopy widens as the chute opens
        const cw = r * 3 * open
        const cy = d.y - r * 3.4
        g.moveTo(d.x - cw, cy)
          .quadraticCurveTo(d.x, cy - r * 2 * open, d.x + cw, cy)
          .stroke({ width: 2, color: Color.PARACHUTE, alpha: 0.9 })
        g.moveTo(d.x - cw, cy)
          .lineTo(d.x, d.y - r)
          .stroke({ width: 1, color: Color.PARACHUTE, alpha: 0.55 })
        g.moveTo(d.x + cw, cy)
          .lineTo(d.x, d.y - r)
          .stroke({ width: 1, color: Color.PARACHUTE, alpha: 0.55 })
      }
      g.rect(d.x - r * 0.5, d.y - r, r, r * 1.6).fill({ color: Color.INFANTRY, alpha }) // torso
      g.circle(d.x, d.y - r * 1.2, r * 0.55).fill({ color: Color.INFANTRY, alpha }) // head
      if (d.weapon === InfantryWeapon.GRENADE) {
        // stubby launcher, angled up
        g.moveTo(d.x, d.y - r * 0.2)
          .lineTo(d.x + f * r * 1.7, d.y - r * 0.9)
          .stroke({ width: 2.4, color: Color.GRENADE, alpha })
      } else {
        // thin rifle, level
        g.moveTo(d.x, d.y - r * 0.2)
          .lineTo(d.x + f * r * 2, d.y - r * 0.2)
          .stroke({ width: 1.4, color: Color.SHIP_CORE, alpha })
      }
      break
    }
    case DeviceKind.GRENADE:
      g.circle(d.x, d.y, d.radius).fill({ color: Color.GRENADE })
      break
    case DeviceKind.FLAK:
      g.circle(d.x, d.y, d.radius).fill({ color: Color.FLAK })
      break
    case DeviceKind.WELL:
      g.circle(d.x, d.y, d.pullRadius).stroke({ width: 1, color: Color.WELL, alpha: 0.12 })
      g.circle(d.x, d.y, d.radius * 2).stroke({ width: 2, color: Color.WELL, alpha: 0.5 })
      g.circle(d.x, d.y, d.radius).fill({ color: Color.WELL })
      break
  }
}

const drawBeams = (g: Graphics, beams: Beam[]): void => {
  for (const b of beams) {
    g.moveTo(b.x1, b.y1)
      .lineTo(b.x2, b.y2)
      .stroke({ width: 3, color: b.color, alpha: Math.max(0, b.life / b.maxLife) })
  }
}

// Floating hull (bottom) + shield (top) gauges above a ship, so combat reads at a glance.
const drawBars = (g: Graphics, ship: Ship): void => {
  const w = ship.radius * 2.6
  const x = ship.x - w / 2
  const y = ship.y - ship.radius - 12
  g.rect(x, y, w, 3).fill({ color: Color.BAR_BACK })
  g.rect(x, y, w * clamp(ship.health / SHIP_MAX_HEALTH, 0, 1), 3).fill({ color: Color.HEALTH })
  g.rect(x, y - 4, w, 2).fill({ color: Color.BAR_BACK })
  g.rect(x, y - 4, w * clamp(ship.shields / SHIP_MAX_SHIELDS, 0, 1), 2).fill({ color: Color.SHIELD })
}

const drawShip = (g: Graphics, ship: Ship, time: number): void => {
  if (ship.invuln > 0 && Math.floor(time * 12) % 2 === 0) return
  const a = ship.angle
  const r = ship.radius
  const hull = ship.kind === ShipKind.PLAYER ? Color.SHIP : Color.ENEMY
  if (ship.thrusting) {
    const flick = 0.6 + (Math.floor(time * 40) % 3) * 0.28
    g.poly([
      ship.x + Math.cos(a + WING_SPREAD) * r * 0.7,
      ship.y + Math.sin(a + WING_SPREAD) * r * 0.7,
      ship.x + Math.cos(a - WING_SPREAD) * r * 0.7,
      ship.y + Math.sin(a - WING_SPREAD) * r * 0.7,
      ship.x - Math.cos(a) * r * (1.1 + flick),
      ship.y - Math.sin(a) * r * (1.1 + flick),
    ]).fill({ color: Color.THRUST, alpha: 0.9 })
  }
  g.poly([
    ship.x + Math.cos(a) * r * 1.5,
    ship.y + Math.sin(a) * r * 1.5,
    ship.x + Math.cos(a + WING_SPREAD) * r,
    ship.y + Math.sin(a + WING_SPREAD) * r,
    ship.x + Math.cos(a - WING_SPREAD) * r,
    ship.y + Math.sin(a - WING_SPREAD) * r,
  ]).fill({ color: hull })
  g.circle(ship.x, ship.y, r * 0.34).fill({ color: Color.SHIP_CORE })
  drawBars(g, ship)
}

export const createRenderer = (rng: Rng): Renderer => {
  const view = new Container()
  const starLayer = new Graphics()
  const worldLayer = new Container()
  const terrainGfx = new Graphics()
  const dynGfx = new Graphics()
  worldLayer.addChild(terrainGfx, dynGfx)
  view.addChild(starLayer, worldLayer)
  const stars = createStars(rng)
  // Terrain is static; redraw the cached layer only when its block count changes
  // (i.e. a rock was destroyed, or a fresh run reset the arena).
  let terrainBlockCount = -1
  // Eased camera state (smooth follow); undefined until the first frame snaps to the target.
  let camX: number | undefined
  let camY = 0
  let lastTime = 0

  const draw = (world: World, phase: GamePhase): void => {
    const player = world.ships.find((ship) => ship.kind === ShipKind.PLAYER) ?? world.ships[0]
    const target = cameraOrigin(player)
    if (camX === undefined || Math.hypot(target.x - camX, target.y - camY) > CAMERA_SNAP_DIST) {
      camX = target.x // first frame or a big jump (respawn): snap, don't drift across the arena
      camY = target.y
    } else {
      const dt = Math.min(0.05, Math.max(0, world.time - lastTime))
      const ease = 1 - Math.exp(-CAMERA_EASE_RATE * dt)
      camX += (target.x - camX) * ease
      camY += (target.y - camY) * ease
    }
    lastTime = world.time
    const camera = { x: camX, y: camY }
    // Screen shake: wobble the whole view (stars + world) by the decaying amplitude.
    const shakeX = world.shake > 0 ? Math.sin(world.time * SHAKE_FREQ) * world.shake : 0
    const shakeY = world.shake > 0 ? Math.cos(world.time * SHAKE_FREQ * 1.3) * world.shake : 0
    view.position.set(shakeX, shakeY)
    worldLayer.position.set(-camera.x, -camera.y)
    drawStars(starLayer, stars, camera)
    if (world.blocks.length !== terrainBlockCount) {
      terrainBlockCount = world.blocks.length
      terrainGfx.clear()
      drawBlocks(terrainGfx, world.blocks)
      drawWaterBodies(terrainGfx, world.water)
    }
    dynGfx.clear()
    for (const device of world.devices) drawDevice(dynGfx, device)
    for (const bullet of world.bullets) {
      const color = bullet.color ?? (bullet.owner === PLAYER_ID ? Color.BULLET : Color.BULLET_ENEMY)
      dynGfx.circle(bullet.x, bullet.y, bullet.radius).fill({ color })
    }
    drawBeams(dynGfx, world.beams)
    drawParticles(dynGfx, world.particles)
    // Ships are drawn only in-play: in TITLE/GAME_OVER updateShip never runs, so their
    // spawn invulnerability never ticks down and they'd blink forever over the backdrop.
    if (phase === GamePhase.PLAYING) for (const ship of world.ships) drawShip(dynGfx, ship, world.time)
  }

  const destroy = (): void => {
    view.destroy({ children: true })
  }

  return { view, draw, destroy }
}
