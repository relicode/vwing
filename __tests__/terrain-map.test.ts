import { describe, expect, test } from 'bun:test'

import { circleRectContact } from '$/game/collision'
import {
  BOT_SPAWN_OFFSET_PX,
  MAX_AUTHORED_WATER,
  SHIP_RADIUS,
  StructureType,
  Surface,
  VOXEL_CELL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { createRng } from '$/game/rng'
import { createTerrain } from '$/game/terrain-map'
import type { Vec2 } from '$/game/types'
import { createVoxelTerrain } from '$/game/voxel'
import { waterSurfaceAt } from '$/game/water'

const SEEDS = [1, 0xc0ffee, 0x1234, 42, 0xdeadbeef]

// The spawn points the world must keep clear (campaign player/bot + the deathmatch respawn anchors).
const spawnPoints = (): Vec2[] => [
  { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT * 0.4 },
  { x: WORLD_WIDTH / 2 + BOT_SPAWN_OFFSET_PX, y: WORLD_HEIGHT * 0.4 },
  ...[0.18, 0.34, 0.5, 0.66, 0.82].flatMap((fx) =>
    [0.22, 0.4].map((fy) => ({ x: WORLD_WIDTH * fx, y: WORLD_HEIGHT * fy }))
  ),
]

describe('createTerrain (procedural arena)', () => {
  test('is deterministic per seed (same seed → identical blocks + water)', () => {
    for (const seed of SEEDS) {
      const a = createTerrain(createRng(seed))
      const b = createTerrain(createRng(seed))
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  test('different seeds produce different arenas', () => {
    const a = JSON.stringify(createTerrain(createRng(SEEDS[0])))
    const b = JSON.stringify(createTerrain(createRng(SEEDS[1])))
    expect(a).not.toBe(b)
  })

  test('emits all four biome ingredients: grass, rock, a metal frame/massif, and water', () => {
    for (const seed of SEEDS) {
      const { blocks, water } = createTerrain(createRng(seed))
      expect(blocks.some((b) => b.surface === Surface.GRASS)).toBe(true) // grasslands
      expect(blocks.some((b) => b.structure === StructureType.EARTH && b.surface === Surface.EARTH)).toBe(true) // rock
      expect(blocks.some((b) => b.structure === StructureType.METAL)).toBe(true) // bedrock frame / massifs
      expect(water.length).toBeGreaterThan(0) // sea + pools
    }
  })

  // Swept wide (not just SEEDS) because overlapping basins floating water over a gap only showed on
  // ~2.6% of seeds — a handful of fixtures would miss it.
  test('every water body sits in a real basin — positive depth and solid ground beneath it', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const { blocks, water } = createTerrain(createRng(seed))
      expect(water.length).toBeLessThanOrEqual(MAX_AUTHORED_WATER)
      for (const body of water) {
        expect(body.w).toBeGreaterThan(0)
        expect(body.h).toBeGreaterThan(0) // positive depth from surface to floor
        const cx = body.x + body.w / 2
        const bottom = body.y + body.h
        const floored = blocks.some(
          (b) => cx >= b.x && cx <= b.x + b.w && b.y <= bottom + VOXEL_CELL && b.y + b.h >= bottom
        )
        expect(floored).toBe(true) // solid terrain right under the water — no water hanging over a gap
      }
    }
  })

  test('keeps every spawn point clear of structure and water', () => {
    for (const seed of SEEDS) {
      const { blocks, water } = createTerrain(createRng(seed))
      for (const p of spawnPoints()) {
        const embedded = blocks.some(
          (b) => circleRectContact(p.x, p.y, SHIP_RADIUS * 2, b.x, b.y, b.w, b.h) !== undefined
        )
        expect(embedded).toBe(false)
        const surface = waterSurfaceAt(water, p.x, p.y)
        expect(surface === undefined || p.y + SHIP_RADIUS < surface).toBe(true) // not at/under a water surface
      }
    }
  })

  test('the terrain is overwhelmingly grounded — only small islands hover (no map-eating pins)', () => {
    for (const seed of SEEDS) {
      const { blocks, water } = createTerrain(createRng(seed))
      const vt = createVoxelTerrain(blocks, water)
      let filled = 0
      for (const m of vt.mat) if (m !== 0) filled += 1
      const pinned = vt.pinned.reduce((sum, pin) => sum + pin.size, 0)
      expect(filled).toBeGreaterThan(0)
      expect(pinned / filled).toBeLessThan(0.1) // pinned (floating) cells are a small minority
    }
  })
})
