import { describe, expect, test } from 'bun:test'

import { StructureType, SURFACE_REGROW_TIME, Surface, VOXEL_CELL, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'
import {
  burnSurface,
  carveVoxel,
  createVoxelTerrain,
  findPool,
  hasDebris,
  restoreVoxel,
  snapshotVoxel,
  stepVoxel,
  voxelToBlocks,
  wetSurface,
} from '$/game/voxel'

// A small controlled arena (independent of the procedural production terrain, which is random per
// seed and so unsuitable as a fixture). All coordinates are in whole cells so assertions are exact.
const C = VOXEL_CELL
const FLOOR_ROW = 100 // a bedrock floor strip — grounds anything resting on it
const PILLAR_C0 = 300
const PILLAR_COLS = 16
const PILLAR_TOP_ROW = 80 // grounded pillar: rows 80–99, cols 300–315
const A_C0 = 100
const A_COLS = 14
const A_TOP_ROW = 30 // floating island A: body rows 30–36 (+ a grass cap on row 29), cols 100–113
const A_ROWS = 7
const B_C0 = 200
const B_COLS = 10
const B_TOP_ROW = 40 // floating island B: rows 40–45, cols 200–209
const B_ROWS = 6

const blk = (c0: number, r0: number, cw: number, rh: number, structure: StructureType, surface: Surface): Block => ({
  x: c0 * C,
  y: r0 * C,
  w: cw * C,
  h: rh * C,
  structure,
  surface,
})

const fixture = (): { blocks: Block[]; water: WaterBody[] } => ({
  blocks: [
    blk(0, FLOOR_ROW, Math.ceil(WORLD_WIDTH / C), 1, StructureType.METAL, Surface.EARTH), // bedrock floor
    blk(PILLAR_C0, PILLAR_TOP_ROW, PILLAR_COLS, FLOOR_ROW - PILLAR_TOP_ROW, StructureType.EARTH, Surface.EARTH),
    blk(A_C0, A_TOP_ROW, A_COLS, A_ROWS, StructureType.EARTH, Surface.EARTH), // island A body
    blk(A_C0, A_TOP_ROW - 1, A_COLS, 1, StructureType.EARTH, Surface.GRASS), // island A grass cap (row 29)
    blk(B_C0, B_TOP_ROW, B_COLS, B_ROWS, StructureType.EARTH, Surface.EARTH), // island B
  ],
  water: [],
})

const mkVt = (): ReturnType<typeof createVoxelTerrain> => {
  const f = fixture()
  return createVoxelTerrain(f.blocks, f.water)
}

const cellCenter = (col: number, row: number): [number, number] => [col * C + C / 2, row * C + C / 2]

// Count filled destructible cells in the static grid (excludes bedrock + falling debris).
const filledCells = (mat: Uint8Array): number => {
  let n = 0
  for (const m of mat) if (m !== 0) n += 1
  return n
}

// Sever island A's 2-col left sliver (cols 100–101) by emptying col 102 down its whole height (the
// grass cap row 29 + the 7 body rows 30–36 = 8 cells). The 8-cell crater leaves a 16-cell sliver
// disconnected from the 88-cell main mass, which is lifted into a falling chunk.
const severIslandSliver = (vt: ReturnType<typeof createVoxelTerrain>): void => {
  for (let row = A_TOP_ROW - 1; row <= A_TOP_ROW + A_ROWS - 1; row += 1) carveVoxel(vt, ...cellCenter(102, row), 4)
}

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

const pinSizeContaining = (vt: ReturnType<typeof createVoxelTerrain>, cell: number): number =>
  vt.pinned.find((pin) => pin.has(cell))?.size ?? 0

describe('createVoxelTerrain', () => {
  test('sizes the grid to the world and rasterizes the provided arena', () => {
    const vt = mkVt()
    expect(vt.cols).toBe(Math.ceil(WORLD_WIDTH / VOXEL_CELL))
    expect(vt.rows).toBe(Math.ceil(WORLD_HEIGHT / VOXEL_CELL))
    expect(vt.bedrock.length).toBeGreaterThan(0) // the bedrock floor
    expect(filledCells(vt.mat)).toBeGreaterThan(0) // earth voxelized into the grid
  })

  test('floating islands start pinned (aloft), so nothing falls before a shot lands', () => {
    const vt = mkVt()
    expect(vt.pinned.length).toBe(2) // islands A + B are the two pinned components
    expect(hasDebris(vt)).toBe(false)
  })

  test('derives a compact block set (fewer rectangles than filled cells)', () => {
    const vt = mkVt()
    const blocks = voxelToBlocks(vt)
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.length).toBeLessThan(filledCells(vt.mat)) // greedy meshing actually merges
    expect(blocks.some((b) => b.structure === StructureType.METAL)).toBe(true)
  })
})

describe('carveVoxel', () => {
  test('open air / bedrock carves nothing', () => {
    const vt = mkVt()
    expect(carveVoxel(vt, ...cellCenter(50, 10), 12)).toBe(false) // open sky
    expect(carveVoxel(vt, ...cellCenter(50, FLOOR_ROW), 12)).toBe(false) // bedrock floor
  })

  test('a crater removes cells sized to its radius, and a repeat carve is a no-op', () => {
    const vt = mkVt()
    const before = filledCells(vt.mat)
    expect(carveVoxel(vt, ...cellCenter(PILLAR_C0 + 8, 90), 18)).toBe(true) // mid-pillar
    const after = filledCells(vt.mat)
    expect(after).toBeLessThan(before)
    expect(carveVoxel(vt, ...cellCenter(PILLAR_C0 + 8, 90), 18)).toBe(false) // already hollowed
  })

  test('boring a hole through a floating island leaves the connected remainder aloft', () => {
    const vt = mkVt()
    const pinsBefore = vt.pinned.length
    const before = filledCells(vt.mat)
    expect(carveVoxel(vt, ...cellCenter(A_C0 + 6, A_TOP_ROW + 3), 12)).toBe(true) // a hole in A's middle
    expect(filledCells(vt.mat)).toBeLessThan(before) // material removed
    expect(hasDebris(vt)).toBe(false) // still one connected piece → nothing falls
    expect(vt.pinned.length).toBe(pinsBefore) // and the island stays pinned/aloft
  })

  test('severing a fragment off a floating island drops only the fragment, not the whole island', () => {
    const vt = mkVt()
    const pinsBefore = vt.pinned.length
    severIslandSliver(vt)
    expect(hasDebris(vt)).toBe(true) // the severed left sliver lost its footing and falls
    expect(vt.pinned.length).toBe(pinsBefore) // island A is still pinned — its main mass stays aloft
    // The LARGER piece must be the one that stays (a 'keep the smallest piece' regression is caught).
    expect(filledInRect(vt, A_C0 + 3, A_C0 + A_COLS - 1, A_TOP_ROW - 1, A_TOP_ROW + A_ROWS - 1)).toBe(11 * 8) // main mass
    expect(filledInRect(vt, A_C0, A_C0 + 1, A_TOP_ROW - 1, A_TOP_ROW + A_ROWS - 1)).toBe(0) // sliver gone
  })

  test('carving one island leaves the other islands’ pins untouched', () => {
    const vt = mkVt()
    const aCell = (A_TOP_ROW + 2) * vt.cols + (A_C0 + 8) // inside island A's main mass
    const bCell = (B_TOP_ROW + 2) * vt.cols + (B_C0 + 5) // inside island B
    const aBefore = pinSizeContaining(vt, aCell)
    const bBefore = pinSizeContaining(vt, bCell)
    expect(aBefore).toBeGreaterThan(0)
    expect(bBefore).toBeGreaterThan(0)
    severIslandSliver(vt) // bites island A only
    expect(pinSizeContaining(vt, bCell)).toBe(bBefore) // B's pin is byte-for-byte unchanged
  })
})

describe('connectivity + debris', () => {
  // Slice clean through the grounded pillar near its top, leaving a thin cap unsupported.
  const severPillarTop = (vt: ReturnType<typeof createVoxelTerrain>): void => {
    for (let col = PILLAR_C0; col < PILLAR_C0 + PILLAR_COLS; col += 1) carveVoxel(vt, ...cellCenter(col, 82), 4)
  }

  test('a piece cut off from the main static surface becomes debris and then settles', () => {
    const vt = mkVt()
    severPillarTop(vt)
    expect(hasDebris(vt)).toBe(true) // the cap above the slice lost its footing

    let settled = false
    for (let i = 0; i < 600 && !settled; i += 1) {
      stepVoxel(vt, 1 / 30)
      if (!hasDebris(vt)) settled = true
    }
    expect(settled).toBe(true)
  })

  test('stepVoxel reports no change when there is no debris in flight', () => {
    const vt = mkVt()
    expect(stepVoxel(vt, 1 / 30)).toBe(false)
  })

  test('a falling chunk conserves material: every lifted cell lands back into the grid', () => {
    const vt = mkVt()
    const before = filledCells(vt.mat)
    severIslandSliver(vt) // 8 crater cells removed + a 16-cell sliver lifted into a falling chunk
    expect(before - filledCells(vt.mat)).toBe(8 + 16)
    expect(hasDebris(vt)).toBe(true)
    for (let i = 0; i < 600 && hasDebris(vt); i += 1) stepVoxel(vt, 1 / 30)
    expect(hasDebris(vt)).toBe(false)
    expect(filledCells(vt.mat)).toBe(before - 8) // only the 8 crater cells are truly gone
  })
})

// Total pixel area of a given surface across the derived blocks.
const surfaceArea = (vt: ReturnType<typeof createVoxelTerrain>, surface: Surface): number =>
  voxelToBlocks(vt).reduce((sum, b) => (b.surface === surface ? sum + b.w * b.h : sum), 0)

describe('surface transitions (burn / wet / regrow)', () => {
  // Island A's grass cap sits on row 29, cols 100–113.
  const [GRASS_X, GRASS_Y] = cellCenter(A_C0 + 6, A_TOP_ROW - 1)

  test('burnSurface scorches grass to bare earth (structure intact, no carve) and is idempotent', () => {
    const vt = mkVt()
    const filledBefore = filledCells(vt.mat)
    const grassBefore = surfaceArea(vt, Surface.GRASS)
    expect(grassBefore).toBeGreaterThan(0)

    expect(burnSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(true)
    expect(surfaceArea(vt, Surface.GRASS)).toBeLessThan(grassBefore)
    expect(filledCells(vt.mat)).toBe(filledBefore) // burning removes no cells (structure intact)
    expect(burnSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(false) // nothing left to scorch there
  })

  test('wetSurface regrows grass on the burned top after SURFACE_REGROW_TIME', () => {
    const vt = mkVt()
    burnSurface(vt, GRASS_X, GRASS_Y, 30)
    const grassBurned = surfaceArea(vt, Surface.GRASS)

    expect(wetSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(true)
    stepVoxel(vt, SURFACE_REGROW_TIME * 0.5)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBurned)
    stepVoxel(vt, SURFACE_REGROW_TIME * 0.6)
    expect(surfaceArea(vt, Surface.GRASS)).toBeGreaterThan(grassBurned)
  })

  test('a dry surface does not regrow without wetting', () => {
    const vt = mkVt()
    burnSurface(vt, GRASS_X, GRASS_Y, 30)
    const grassBurned = surfaceArea(vt, Surface.GRASS)
    for (let i = 0; i < 600; i += 1) stepVoxel(vt, 1 / 30)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBurned)
  })
})

describe('findPool (basin detection)', () => {
  const PILLAR_CX = (PILLAR_C0 + PILLAR_COLS / 2) * C
  const PILLAR_TOP_Y = PILLAR_TOP_ROW * C

  test('a flat surface does not pool', () => {
    const vt = mkVt()
    expect(findPool(vt, PILLAR_CX, PILLAR_TOP_Y - 5)).toBeUndefined() // just above the flat pillar top
  })

  test('a carved dip pools to its rim; an open ledge does not', () => {
    const vt = mkVt()
    carveVoxel(vt, PILLAR_CX, PILLAR_TOP_Y + 5, 18) // notch the top, leaving earth lips on both sides
    const pool = findPool(vt, PILLAR_CX, PILLAR_TOP_Y + 20)
    expect(pool).toBeDefined()
    if (pool) {
      expect(pool.w).toBeGreaterThan(0)
      expect(pool.h).toBeGreaterThan(0)
      expect(pool.y).toBeCloseTo(PILLAR_TOP_Y, -1) // surface sits at the surviving rim row
    }
    expect(findPool(vt, ...cellCenter(50, 10))).toBeUndefined() // far open air still refuses to pool
  })
})

describe('snapshotVoxel / restoreVoxel (terrain persistence round-trip)', () => {
  test('a carved, scorched, wetted arena restores cell-for-cell onto a same-fixture grid', () => {
    const vt = mkVt()
    // Crater the pillar, scorch + wet the island cap, and carve into island B (possibly
    // severing a chunk into flight — whatever results must round-trip exactly).
    carveVoxel(vt, ...cellCenter(PILLAR_C0 + 4, PILLAR_TOP_ROW), 2.5 * C)
    burnSurface(vt, ...cellCenter(A_C0 + 2, A_TOP_ROW - 1), C)
    wetSurface(vt, ...cellCenter(A_C0 + 8, A_TOP_ROW - 1), C)
    carveVoxel(vt, ...cellCenter(B_C0 + 5, B_TOP_ROW + 2), 2.2 * C)
    stepVoxel(vt, 0.1) // let any loosed chunk accrue fall state worth persisting
    const snap = snapshotVoxel(vt)

    const restored = mkVt()
    expect(restoreVoxel(restored, snap)).toBe(true)
    expect(restored.mat.every((value, i) => value === vt.mat[i])).toBe(true)
    expect(restored.pinned.map((s) => [...s].sort())).toEqual(vt.pinned.map((s) => [...s].sort()))
    expect(restored.bodies.length).toBe(vt.bodies.length)
    expect([...restored.regrow.entries()]).toEqual([...vt.regrow.entries()])
    expect(JSON.stringify(voxelToBlocks(restored))).toBe(JSON.stringify(voxelToBlocks(vt)))
  })

  test('a snapshot that does not fit the grid is rejected untouched', () => {
    const vt = mkVt()
    const before = JSON.stringify(voxelToBlocks(vt))
    const snap = snapshotVoxel(vt)
    expect(restoreVoxel(vt, { ...snap, cols: vt.cols - 1 })).toBe(false)
    expect(JSON.stringify(voxelToBlocks(vt))).toBe(before)
  })
})
