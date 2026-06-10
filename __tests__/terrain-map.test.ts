import { describe, expect, test } from 'bun:test'

import { circleRectContact } from '$/game/collision'
import {
  BAND_SKY_BOTTOM,
  BASE_PAD_CELLS,
  BASE_PAD_Y_FRAC,
  MAX_AUTHORED_WATER,
  SEA_SPILL_FRAC,
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
import { createVoxelTerrain, voxelToBlocks } from '$/game/voxel'
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

  test('the re-meshed voxel terrain stays grid-aligned: no bleed over the walls, no water overlap', () => {
    // Guards the WALL_THICKNESS-is-a-cell-multiple invariant: an off-grid frame makes every
    // wall-adjacent column round outward when voxelized, over the frame and the water lips.
    for (const seed of SEEDS) {
      const { blocks, water } = createTerrain(createRng(seed))
      const vt = createVoxelTerrain(blocks, water)
      for (const b of voxelToBlocks(vt)) {
        if (b.structure !== StructureType.EARTH) continue
        expect(b.x).toBeGreaterThanOrEqual(WALL_THICKNESS)
        expect(b.x + b.w).toBeLessThanOrEqual(WORLD_WIDTH - WALL_THICKNESS)
        expect(b.y + b.h).toBeLessThanOrEqual(WORLD_HEIGHT - WALL_THICKNESS)
        for (const body of water) {
          const ox = Math.min(b.x + b.w, body.x + body.w) - Math.max(b.x, body.x)
          const oy = Math.min(b.y + b.h, body.y + body.h) - Math.max(b.y, body.y)
          expect(ox > 0.5 && oy > 0.5).toBe(false) // solid earth never sits inside a water rect
        }
      }
    }
  })

  test('a floating archipelago of narrow isles hangs in the gulf over the central sea', () => {
    const snap = (v: number): number => Math.round(v / VOXEL_CELL) * VOXEL_CELL
    const minTop = snap(WORLD_HEIGHT * BAND_SKY_BOTTOM) + 2 * VOXEL_CELL
    const seaSpill = snap(WORLD_HEIGHT * SEA_SPILL_FRAC)
    for (const seed of SEEDS) {
      const { blocks, water } = createTerrain(createRng(seed))
      const sea = water[0] // the sea is the first body pushed
      // Isle bodies: earth blocks floating fully inside the gulf box (caps are exactly a cell tall).
      const isles = blocks.filter(
        (b) =>
          b.structure === StructureType.EARTH &&
          b.h > VOXEL_CELL &&
          b.x >= sea.x &&
          b.x + b.w <= sea.x + sea.w &&
          b.y >= minTop &&
          b.y + b.h <= seaSpill
      )
      expect(isles.length).toBeGreaterThanOrEqual(3) // the gulf is populated, not empty
      const vt = createVoxelTerrain(blocks, water)
      const cellIdx = (x: number, y: number): number =>
        Math.floor(y / VOXEL_CELL) * vt.cols + Math.floor(x / VOXEL_CELL)
      for (const isle of isles) {
        expect(isle.w).toBeLessThanOrEqual(24 * VOXEL_CELL) // narrow: the bot's dodge slips around
        expect(isle.y + isle.h).toBeLessThanOrEqual(seaSpill - 2 * VOXEL_CELL) // low-flying lane over the water
        // Inset from the gulf walls: cell-adjacency to the grounded sea-lip mesas would weld the
        // isle onto the mainland, and the voxelizer would never pin it.
        expect(isle.x).toBeGreaterThanOrEqual(sea.x + 2 * VOXEL_CELL)
        expect(isle.x + isle.w).toBeLessThanOrEqual(sea.x + sea.w - 2 * VOXEL_CELL)
        // And it really floats: its core belongs to a pinned (ungrounded) component.
        const core = cellIdx(isle.x + isle.w / 2, isle.y + isle.h / 2)
        expect(vt.pinned.some((pin) => pin.has(core))).toBe(true)
      }
      // Every isle pair keeps an air channel on at least one axis so ships thread the archipelago.
      const gap = 6 * VOXEL_CELL
      for (let i = 0; i < isles.length; i += 1) {
        for (let j = i + 1; j < isles.length; j += 1) {
          const a = isles[i]
          const b = isles[j]
          const tooClose =
            a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
          expect(tooClose).toBe(false)
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
