import { describe, expect, test } from 'bun:test'

import { createWave, splitAsteroid, updateAsteroids } from '$/game/asteroids'
import { ASTEROID_CONFIG, AsteroidSize, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Asteroid } from '$/game/types'

const makeAsteroid = (over: Partial<Asteroid>): Asteroid => ({
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
  vx: 0,
  vy: 0,
  radius: ASTEROID_CONFIG[AsteroidSize.LARGE].radius,
  size: AsteroidSize.LARGE,
  angle: 0,
  spin: 0,
  verts: [],
  ...over,
})

describe('createWave', () => {
  test('spawns the requested count of large rocks inside the playfield', () => {
    const wave = createWave(createRng(11), 4, { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }, 200)
    expect(wave).toHaveLength(4)
    for (const rock of wave) {
      expect(rock.size).toBe(AsteroidSize.LARGE)
      expect(rock.x).toBeGreaterThanOrEqual(WALL_THICKNESS + rock.radius - 1e-6)
      expect(rock.x).toBeLessThanOrEqual(WORLD_WIDTH - WALL_THICKNESS - rock.radius + 1e-6)
      expect(rock.y).toBeGreaterThanOrEqual(WALL_THICKNESS + rock.radius - 1e-6)
      expect(rock.y).toBeLessThanOrEqual(WORLD_HEIGHT - WALL_THICKNESS - rock.radius + 1e-6)
    }
  })
})

describe('updateAsteroids', () => {
  test('bounces off a wall and stays inside the playfield', () => {
    const radius = ASTEROID_CONFIG[AsteroidSize.LARGE].radius
    const maxX = WORLD_WIDTH - WALL_THICKNESS - radius
    const rock = makeAsteroid({ x: maxX - 10, vx: 200 })
    updateAsteroids([rock], 1)
    expect(rock.x).toBeLessThanOrEqual(maxX + 1e-6)
    expect(rock.vx).toBeLessThan(0)
  })
})

describe('splitAsteroid', () => {
  test('a large rock breaks into two medium rocks', () => {
    const children = splitAsteroid(makeAsteroid({ vx: 50, vy: 20 }), createRng(2))
    expect(children).toHaveLength(2)
    for (const child of children) expect(child.size).toBe(AsteroidSize.MEDIUM)
  })

  test('a small rock vaporizes with no children', () => {
    const small = makeAsteroid({ size: AsteroidSize.SMALL, radius: ASTEROID_CONFIG[AsteroidSize.SMALL].radius })
    expect(splitAsteroid(small, createRng(2))).toHaveLength(0)
  })
})
