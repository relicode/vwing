import { Container, Graphics } from 'pixi.js'

import { cameraOrigin } from '$/game/camera'
import {
  Color,
  GamePhase,
  PLAYER_ID,
  SHIP_MAX_HEALTH,
  SHIP_MAX_SHIELDS,
  ShipKind,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp, TWO_PI } from '$/game/math'
import { randRange } from '$/game/rng'
import type { Asteroid, Particle, Rng, Ship, Vec2, World } from '$/game/types'

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

// World border (drawn once): lethal wall bands plus a neon inner edge.
const drawWalls = (g: Graphics): void => {
  const t = WALL_THICKNESS
  g.rect(0, 0, WORLD_WIDTH, t)
  g.rect(0, WORLD_HEIGHT - t, WORLD_WIDTH, t)
  g.rect(0, 0, t, WORLD_HEIGHT)
  g.rect(WORLD_WIDTH - t, 0, t, WORLD_HEIGHT)
  g.fill({ color: Color.WALL })
  g.rect(t, t, WORLD_WIDTH - t * 2, WORLD_HEIGHT - t * 2).stroke({ width: 3, color: Color.WALL_EDGE, alpha: 0.85 })
}

const drawAsteroid = (g: Graphics, asteroid: Asteroid): void => {
  const points: number[] = []
  const n = asteroid.verts.length
  for (let i = 0; i < n; i += 1) {
    const angle = asteroid.angle + (i / n) * TWO_PI
    const r = asteroid.radius * asteroid.verts[i]
    points.push(asteroid.x + Math.cos(angle) * r, asteroid.y + Math.sin(angle) * r)
  }
  g.poly(points).fill({ color: Color.ASTEROID_FILL }).stroke({ width: 2, color: Color.ASTEROID_EDGE, alpha: 0.9 })
}

const drawParticles = (g: Graphics, particles: Particle[]): void => {
  for (const p of particles) {
    g.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: Math.max(0, p.life / p.maxLife) })
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
  const wallGfx = new Graphics()
  const dynGfx = new Graphics()
  worldLayer.addChild(wallGfx, dynGfx)
  view.addChild(starLayer, worldLayer)
  const stars = createStars(rng)
  drawWalls(wallGfx)

  const draw = (world: World, phase: GamePhase): void => {
    const player = world.ships.find((ship) => ship.kind === ShipKind.PLAYER) ?? world.ships[0]
    const camera = cameraOrigin(player)
    worldLayer.position.set(-camera.x, -camera.y)
    drawStars(starLayer, stars, camera)
    dynGfx.clear()
    for (const asteroid of world.asteroids) drawAsteroid(dynGfx, asteroid)
    for (const bullet of world.bullets) {
      const color = bullet.owner === PLAYER_ID ? Color.BULLET : Color.BULLET_ENEMY
      dynGfx.circle(bullet.x, bullet.y, bullet.radius).fill({ color })
    }
    drawParticles(dynGfx, world.particles)
    if (phase !== GamePhase.GAME_OVER) for (const ship of world.ships) drawShip(dynGfx, ship, world.time)
  }

  const destroy = (): void => {
    view.destroy({ children: true })
  }

  return { view, draw, destroy }
}
