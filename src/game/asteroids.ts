import {
  ASTEROID_CONFIG,
  ASTEROID_MAX_SPEED,
  ASTEROID_MIN_SPEED,
  ASTEROID_VERTEX_COUNT,
  AsteroidSize,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp, TWO_PI } from '$/game/math'
import { randRange } from '$/game/rng'
import type { Asteroid, Rng, Vec2 } from '$/game/types'

const SPAWN_ATTEMPTS = 20

const makeVerts = (rng: Rng): number[] =>
  Array.from({ length: ASTEROID_VERTEX_COUNT }, () => randRange(rng, 0.82, 1.12))

const createAsteroid = (size: AsteroidSize, x: number, y: number, vx: number, vy: number, rng: Rng): Asteroid => ({
  x,
  y,
  vx,
  vy,
  radius: ASTEROID_CONFIG[size].radius,
  size,
  angle: randRange(rng, 0, TWO_PI),
  spin: randRange(rng, -1.5, 1.5),
  verts: makeVerts(rng),
})

const randomDriftVelocity = (rng: Rng): Vec2 => {
  const heading = randRange(rng, 0, TWO_PI)
  const speed = randRange(rng, ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED)
  return { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed }
}

// Place `count` large rocks at random playfield spots, kept away from `avoid` (the ship).
export const createWave = (rng: Rng, count: number, avoid: Vec2, clearRadius: number): Asteroid[] => {
  const radius = ASTEROID_CONFIG[AsteroidSize.LARGE].radius
  const min = WALL_THICKNESS + radius
  const maxX = WORLD_WIDTH - min
  const maxY = WORLD_HEIGHT - min
  const asteroids: Asteroid[] = []
  for (let i = 0; i < count; i += 1) {
    let x = 0
    let y = 0
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
      x = randRange(rng, min, maxX)
      y = randRange(rng, min, maxY)
      if (Math.hypot(x - avoid.x, y - avoid.y) > clearRadius) break
    }
    const velocity = randomDriftVelocity(rng)
    asteroids.push(createAsteroid(AsteroidSize.LARGE, x, y, velocity.x, velocity.y, rng))
  }
  return asteroids
}

// Drift, spin, and bounce off the inner wall faces.
export const updateAsteroids = (asteroids: Asteroid[], dt: number): void => {
  for (const asteroid of asteroids) {
    asteroid.x += asteroid.vx * dt
    asteroid.y += asteroid.vy * dt
    asteroid.angle += asteroid.spin * dt
    const min = WALL_THICKNESS + asteroid.radius
    const maxX = WORLD_WIDTH - min
    const maxY = WORLD_HEIGHT - min
    if (asteroid.x < min) {
      asteroid.x = min
      asteroid.vx = Math.abs(asteroid.vx)
    } else if (asteroid.x > maxX) {
      asteroid.x = maxX
      asteroid.vx = -Math.abs(asteroid.vx)
    }
    if (asteroid.y < min) {
      asteroid.y = min
      asteroid.vy = Math.abs(asteroid.vy)
    } else if (asteroid.y > maxY) {
      asteroid.y = maxY
      asteroid.vy = -Math.abs(asteroid.vy)
    }
  }
}

// A shot rock breaks into two smaller, faster ones — or nothing, if already small.
export const splitAsteroid = (asteroid: Asteroid, rng: Rng): Asteroid[] => {
  const next = ASTEROID_CONFIG[asteroid.size].next
  if (!next) return []
  const baseHeading = Math.atan2(asteroid.vy, asteroid.vx)
  const baseSpeed = clamp(Math.hypot(asteroid.vx, asteroid.vy) * 1.15, ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED)
  return [0.6, -0.6].map((spread) => {
    const heading = baseHeading + spread + randRange(rng, -0.25, 0.25)
    return createAsteroid(
      next,
      asteroid.x,
      asteroid.y,
      Math.cos(heading) * baseSpeed,
      Math.sin(heading) * baseSpeed,
      rng
    )
  })
}
