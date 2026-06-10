import { describe, expect, test } from 'bun:test'

import { circleRectContact } from '$/game/collision'
import {
  BASE_PAD_CELLS,
  BASE_PAD_Y_FRAC,
  MAX_AUTHORED_WATER,
  SHIP_RADIUS,
  SPAWN_ALTITUDE,
  StructureType,
  Surface,
  VOXEL_CELL,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { createRng } from '$/game/rng'
import { basePadCenters, createTerrain, spawnPoints } from '$/game/terrain-map'
import { createVoxelTerrain } from '$/game/voxel'
import { waterSurfaceAt } from '$/game/water'

const SEEDS = [1, 0xc0ffee, 0x1234, 42, 0xdeadbeef]

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

  test('both home pads are flat grass at pad level with an open approach column above', () => {
    const padY = Math.round((WORLD_HEIGHT * BASE_PAD_Y_FRAC) / VOXEL_CELL) * VOXEL_CELL
    const halfSpan = (BASE_PAD_CELLS / 2 - 1) * VOXEL_CELL // just inside the pad edges
    for (const seed of SEEDS) {
      const { blocks, water } = createTerrain(createRng(seed))
      for (const pad of basePadCenters()) {
        for (const dx of [-halfSpan, 0, halfSpan]) {
          const x = pad.x + dx
          // The surface at pad level: a grass cap whose top is exactly padY (the cap is pushed
          // after the body, so the last matching block is the visible surface).
          const surfaceBlock = blocks.filter((b) => x >= b.x && x < b.x + b.w && b.y === padY).at(-1)
          expect(surfaceBlock?.surface).toBe(Surface.GRASS)
          // Open air from the pad top up to the spawn perch (nothing overhangs the approach).
          const obstructed = blocks.some(
            (b) => x >= b.x && x < b.x + b.w && b.y + b.h > padY - SPAWN_ALTITUDE && b.y < padY
          )
          expect(obstructed).toBe(false)
          expect(waterSurfaceAt(water, x, padY - VOXEL_CELL)).toBeUndefined() // no water over the pad
        }
      }
    }
  })

  test('the world is substantially ground: destructible earth covers >= 30% of the interior', () => {
    const interior = (WORLD_WIDTH - 2 * WALL_THICKNESS) * (WORLD_HEIGHT - 2 * WALL_THICKNESS)
    for (const seed of SEEDS) {
      const { blocks } = createTerrain(createRng(seed))
      const area = blocks.reduce((sum, b) => (b.structure === StructureType.EARTH ? sum + b.w * b.h : sum), 0)
      expect(area / interior).toBeGreaterThanOrEqual(0.3)
    }
  })
})
