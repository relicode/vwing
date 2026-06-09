import { describe, expect, test } from 'bun:test'

import { StructureType, SURFACE_REGROW_TIME, Surface, VOXEL_CELL, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import {
  burnSurface,
  carveVoxel,
  createVoxelTerrain,
  findPool,
  hasDebris,
  stepVoxel,
  voxelToBlocks,
  wetSurface,
} from '$/game/voxel'

// Count filled destructible cells in the static grid (excludes bedrock + falling debris).
const filledCells = (mat: Uint8Array): number => {
  let n = 0
  for (const m of mat) if (m !== 0) n += 1
  return n
}

// Empty one full-height column of island C (block(1900,760,160,70) → cols 190–205, rows 76–82) at
// x≈1925 (col 192), severing the cols 190–191 sliver from the cols 193–205 main mass. The crater
// itself removes 7 cells (col 192 × 7 rows); the 14-cell sliver is lifted into a falling chunk.
const severIslandSliver = (vt: ReturnType<typeof createVoxelTerrain>): void => {
  for (let row = 76; row <= 82; row += 1) carveVoxel(vt, 1925, row * VOXEL_CELL + 5, 4)
}

// Count filled static-grid cells inside an inclusive [c0,c1]×[r0,r1] cell rectangle.
const filledInRect = (
  vt: ReturnType<typeof createVoxelTerrain>,
  c0: number,
  c1: number,
  r0: number,
  r1: number
): number => {
  let n = 0
  for (let row = r0; row <= r1; row += 1)
    for (let col = c0; col <= c1; col += 1) if (vt.mat[row * vt.cols + col] !== 0) n += 1
  return n
}

// Size of the pinned island that currently contains a given cell index (0 if no pin holds it).
const pinSizeContaining = (vt: ReturnType<typeof createVoxelTerrain>, cell: number): number =>
  vt.pinned.find((pin) => pin.has(cell))?.size ?? 0

describe('createVoxelTerrain', () => {
  test('sizes the grid to the world and rasterizes the hand-authored arena', () => {
    const vt = createVoxelTerrain()
    expect(vt.cols).toBe(Math.ceil(WORLD_WIDTH / VOXEL_CELL))
    expect(vt.rows).toBe(Math.ceil(WORLD_HEIGHT / VOXEL_CELL))
    expect(vt.bedrock.length).toBeGreaterThan(0) // the border frame + cave are bedrock anchors
    expect(filledCells(vt.mat)).toBeGreaterThan(0) // rock/grass/ice voxelized into the grid
  })

  test('floating islands start pinned (aloft), so nothing falls before a shot lands', () => {
    const vt = createVoxelTerrain()
    expect(vt.pinned.length).toBeGreaterThan(0) // islands A/B/C are pinned components
    expect(hasDebris(vt)).toBe(false)
  })

  test('derives a compact block set (fewer rectangles than filled cells)', () => {
    const vt = createVoxelTerrain()
    const blocks = voxelToBlocks(vt)
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.length).toBeLessThan(filledCells(vt.mat)) // greedy meshing actually merges
    expect(blocks.some((b) => b.structure === StructureType.METAL)).toBe(true)
  })
})

describe('carveVoxel', () => {
  test('open air / bedrock carves nothing', () => {
    const vt = createVoxelTerrain()
    expect(carveVoxel(vt, 5, 5, 12)).toBe(false) // top-left bedrock corner: no destructible cells
    expect(carveVoxel(vt, WORLD_WIDTH / 2, 40, 12)).toBe(false) // open sky just under the top border
  })

  test('a crater removes cells sized to its radius, and a repeat carve is a no-op', () => {
    const vt = createVoxelTerrain()
    const before = filledCells(vt.mat)
    // Center of the submerged rock pillar at block(420,1300,240,…).
    expect(carveVoxel(vt, 540, 1380, 18)).toBe(true)
    const after = filledCells(vt.mat)
    expect(after).toBeLessThan(before)
    expect(carveVoxel(vt, 540, 1380, 18)).toBe(false) // already hollowed: nothing left to remove
  })

  test('boring a hole through a floating island leaves the connected remainder aloft', () => {
    const vt = createVoxelTerrain()
    const pinsBefore = vt.pinned.length
    const before = filledCells(vt.mat)
    // Island C — the standalone rock platform at block(1900,760,160,70). A hole in its middle
    // never disconnects it, so it must keep floating with nothing breaking off.
    expect(carveVoxel(vt, 1980, 795, 12)).toBe(true)
    expect(filledCells(vt.mat)).toBeLessThan(before) // material was removed
    expect(hasDebris(vt)).toBe(false) // still one connected piece → nothing falls
    expect(vt.pinned.length).toBe(pinsBefore) // and the island stays pinned/aloft
  })

  test('severing a fragment off a floating island drops only the fragment, not the whole island', () => {
    const vt = createVoxelTerrain()
    const pinsBefore = vt.pinned.length
    severIslandSliver(vt)
    expect(hasDebris(vt)).toBe(true) // the severed left sliver lost its footing and falls
    expect(vt.pinned.length).toBe(pinsBefore) // island C is still pinned — its main mass stays aloft
    // The LARGER piece must be the one that stays: assert the main mass is intact in the grid and the
    // sliver was lifted out — so a 'keep the smallest piece' regression (the original bug) is caught.
    expect(filledInRect(vt, 193, 205, 76, 82)).toBe(91) // 13×7 main mass still anchored in place
    expect(filledInRect(vt, 190, 191, 76, 82)).toBe(0) // the 2-col sliver is gone from the static grid
  })

  test('carving one island leaves the other islands’ pins untouched', () => {
    const vt = createVoxelTerrain()
    const islandACell = 65 * vt.cols + 70 // inside floating island A (block(600,620,260,90))
    const islandBCell = 45 * vt.cols + 145 // inside floating island B (block(1380,430,220,80))
    const aBefore = pinSizeContaining(vt, islandACell)
    const bBefore = pinSizeContaining(vt, islandBCell)
    expect(aBefore).toBeGreaterThan(0)
    expect(bBefore).toBeGreaterThan(0)
    severIslandSliver(vt) // bites island C only
    expect(pinSizeContaining(vt, islandACell)).toBe(aBefore) // A's pin is byte-for-byte unchanged
    expect(pinSizeContaining(vt, islandBCell)).toBe(bBefore) // and so is B's
  })
})

describe('connectivity + debris', () => {
  // Slice clean through a grounded pillar near its top, leaving a thin cap unsupported.
  const severPillarTop = (vt: ReturnType<typeof createVoxelTerrain>): void => {
    for (let x = 422; x < 658; x += VOXEL_CELL) carveVoxel(vt, x, 1322, VOXEL_CELL)
  }

  test('a piece cut off from the main static surface becomes debris and then settles', () => {
    const vt = createVoxelTerrain()
    severPillarTop(vt)
    expect(hasDebris(vt)).toBe(true) // the cap above the slice lost its footing

    // Let the chunk fall; it must come to rest (back into the static grid) in finite time.
    let settled = false
    for (let i = 0; i < 600 && !settled; i += 1) {
      stepVoxel(vt, 1 / 30)
      if (!hasDebris(vt)) settled = true
    }
    expect(settled).toBe(true)
  })

  test('stepVoxel reports no change when there is no debris in flight', () => {
    const vt = createVoxelTerrain()
    expect(stepVoxel(vt, 1 / 30)).toBe(false)
  })

  test('a falling chunk conserves material: every lifted cell lands back into the grid', () => {
    const vt = createVoxelTerrain()
    const before = filledCells(vt.mat)
    severIslandSliver(vt) // 7 crater cells removed + a 14-cell sliver lifted into a falling chunk
    expect(before - filledCells(vt.mat)).toBe(7 + 14) // both the crater and the airborne sliver left the grid
    expect(hasDebris(vt)).toBe(true)
    for (let i = 0; i < 600 && hasDebris(vt); i += 1) stepVoxel(vt, 1 / 30)
    expect(hasDebris(vt)).toBe(false)
    // Only the 7 crater cells are truly gone; all 14 sliver cells re-stamp where the chunk settles.
    expect(filledCells(vt.mat)).toBe(before - 7)
  })
})

// Total pixel area of a given surface across the derived blocks (greedily meshed → coarse but stable).
const surfaceArea = (vt: ReturnType<typeof createVoxelTerrain>, surface: Surface): number =>
  voxelToBlocks(vt).reduce((sum, b) => (b.surface === surface ? sum + b.w * b.h : sum), 0)

describe('surface transitions (burn / wet / regrow)', () => {
  // Island A's grass cap sits at block(600, 590, 260, 30) — a strip of GRASS over earth.
  const GRASS_X = 730
  const GRASS_Y = 600

  test('burnSurface scorches grass to bare earth (structure intact, no carve) and is idempotent', () => {
    const vt = createVoxelTerrain()
    const filledBefore = filledCells(vt.mat) // structure (cell count) must be untouched by a burn
    const grassBefore = surfaceArea(vt, Surface.GRASS)
    expect(grassBefore).toBeGreaterThan(0)

    expect(burnSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(true)
    expect(surfaceArea(vt, Surface.GRASS)).toBeLessThan(grassBefore) // grass turned to earth
    expect(filledCells(vt.mat)).toBe(filledBefore) // burning removes no cells (structure intact)
    expect(burnSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(false) // nothing left to scorch there
  })

  test('wetSurface regrows grass on the burned top after SURFACE_REGROW_TIME', () => {
    const vt = createVoxelTerrain()
    burnSurface(vt, GRASS_X, GRASS_Y, 30) // bare the top first
    const grassBurned = surfaceArea(vt, Surface.GRASS)

    expect(wetSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(true) // the exposed top is now wet
    // Below the regrow time nothing has changed yet…
    stepVoxel(vt, SURFACE_REGROW_TIME * 0.5)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBurned)
    // …past it the wetted top cells flip back to grass.
    stepVoxel(vt, SURFACE_REGROW_TIME * 0.6)
    expect(surfaceArea(vt, Surface.GRASS)).toBeGreaterThan(grassBurned)
  })

  test('a dry surface does not regrow without wetting', () => {
    const vt = createVoxelTerrain()
    burnSurface(vt, GRASS_X, GRASS_Y, 30)
    const grassBurned = surfaceArea(vt, Surface.GRASS)
    for (let i = 0; i < 600; i += 1) stepVoxel(vt, 1 / 30) // 20s of idle time
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBurned) // no water → no regrowth
  })
})

describe('findPool (basin detection)', () => {
  test('a flat surface does not pool', () => {
    const vt = createVoxelTerrain()
    // Just above the flat top of the submerged earth pillar at block(420, 1300, 240, …).
    expect(findPool(vt, 540, 1295)).toBeUndefined()
  })

  test('a carved dip pools to its rim; an open ledge does not', () => {
    const vt = createVoxelTerrain()
    carveVoxel(vt, 540, 1305, 18) // notch the pillar top, leaving earth lips on both sides
    const pool = findPool(vt, 540, 1320)
    expect(pool).toBeDefined()
    if (pool) {
      expect(pool.w).toBeGreaterThan(0)
      expect(pool.h).toBeGreaterThan(0)
      expect(pool.y).toBeCloseTo(1300, -1) // surface sits at the surviving rim row (~y 1300)
    }
    // The far open corner of the arena (no rims) must still refuse to pool.
    expect(findPool(vt, 1200, 200)).toBeUndefined()
  })
})
