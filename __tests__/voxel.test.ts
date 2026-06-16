import { describe, expect, test } from 'bun:test'

import {
  BULLET_RADIUS,
  CARVE_RADIUS_BASE,
  CARVE_RADIUS_SCALE,
  GRASS_BURN_TIME,
  GRASS_FIRE_SPREAD_AFTER,
  StructureType,
  SURFACE_REGROW_TIME,
  Surface,
  VOXEL_CELL,
  WATER_CELL_FULL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'
import {
  carveVoxel,
  createVoxelTerrain,
  douseSurface,
  fluidToBodies,
  hasDebris,
  igniteSurface,
  pourWater,
  restoreVoxel,
  sealWaterRect,
  snapshotVoxel,
  stepVoxel,
  stepWater,
  voxelToBlocks,
  wetSurface,
} from '$/game/voxel'
import { markWet } from '$/game/water-cell'

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

  test('a primary-shot corner hit carves — even from a contact point just outside the corner', () => {
    const carve = BULLET_RADIUS * CARVE_RADIUS_SCALE + CARVE_RADIUS_BASE
    const cornerX = PILLAR_C0 * C // the pillar's top-left corner (a cell corner by construction)
    const cornerY = PILLAR_TOP_ROW * C
    const exact = mkVt()
    expect(carveVoxel(exact, cornerX, cornerY, carve)).toBe(true)
    expect(exact.mat[PILLAR_TOP_ROW * exact.cols + PILLAR_C0]).toBe(0) // the corner cell is gone
    // circleRectContact registers a corner hit with the bullet center up to BULLET_RADIUS
    // diagonally OUTSIDE the rect — a detected hit must never carve nothing.
    const off = (BULLET_RADIUS * 0.7) / Math.SQRT2
    const outside = mkVt()
    expect(carveVoxel(outside, cornerX - off, cornerY - off, carve)).toBe(true)
    expect(outside.mat[PILLAR_TOP_ROW * outside.cols + PILLAR_C0]).toBe(0)
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

  test('undercut grass falls instead of bridging the void (grass is a non-cohesive skin)', () => {
    // A grounded earth slab (cols 100–119, rows 91–99 on the bedrock floor) under a one-row grass
    // cap (row 90). Emptying the earth directly beneath two MIDDLE grass cells leaves that grass
    // laterally connected to still-supported grass on either side — old slab behaviour kept it
    // hovering as a bridge; a non-cohesive skin loses its footing and drops.
    const floor = blk(0, FLOOR_ROW, Math.ceil(WORLD_WIDTH / C), 1, StructureType.METAL, Surface.EARTH)
    const slab = blk(100, 91, 20, 9, StructureType.EARTH, Surface.EARTH)
    const cap = blk(100, 90, 20, 1, StructureType.EARTH, Surface.GRASS)
    const vt = createVoxelTerrain([floor, slab, cap], [])
    expect(vt.pinned.length).toBe(0) // all grounded at birth — grass sits on earth, nothing floats
    expect(hasDebris(vt)).toBe(false)
    const capCell = (col: number): number => 90 * vt.cols + col
    expect(vt.mat[capCell(109)]).not.toBe(0) // grass present before we dig under it
    // Empty the earth under cols 109–110 the full depth, leaving the grass cap row 90 untouched.
    for (const col of [109, 110]) for (let row = 91; row <= 99; row += 1) carveVoxel(vt, ...cellCenter(col, row), 4)
    expect(hasDebris(vt)).toBe(true) // the unsupported grass dropped (regression guard: old code bridged it)
    expect(vt.mat[capCell(109)]).toBe(0) // grass lifted out of the static grid…
    expect(vt.mat[capCell(110)]).toBe(0)
    expect(vt.mat[capCell(108)]).not.toBe(0) // …while its still-supported neighbours hold
    expect(vt.mat[capCell(111)]).not.toBe(0)
  })
})

// Total pixel area of a given surface across the derived blocks.
const surfaceArea = (vt: ReturnType<typeof createVoxelTerrain>, surface: Surface): number =>
  voxelToBlocks(vt).reduce((sum, b) => (b.surface === surface ? sum + b.w * b.h : sum), 0)

describe('surface transitions (ignite / creep / burn out / douse / wet / regrow)', () => {
  // Island A's grass cap sits on row 29, cols 100–113.
  const [GRASS_X, GRASS_Y] = cellCenter(A_C0 + 6, A_TOP_ROW - 1)
  // Long enough for a fire lit at one END of the cap to creep its A_COLS - 1 jumps and for the
  // last-caught cell to burn through.
  const CAP_BURNOUT = (A_COLS - 1) * GRASS_FIRE_SPREAD_AFTER + GRASS_BURN_TIME + 1

  test('igniteSurface sets exposed grass alight in place (structure intact, no carve)', () => {
    const vt = mkVt()
    const filledBefore = filledCells(vt.mat)
    const grassBefore = surfaceArea(vt, Surface.GRASS)
    expect(grassBefore).toBeGreaterThan(0)

    expect(igniteSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(true)
    const alight = surfaceArea(vt, Surface.FIRE)
    expect(alight).toBeGreaterThan(0) // alight where the gout splashed, not scorched away
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBefore - alight)
    expect(filledCells(vt.mat)).toBe(filledBefore) // fire removes no cells (structure intact)
    expect(igniteSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(false) // already alight — nothing new catches
    expect(igniteSurface(vt, ...cellCenter(PILLAR_C0 + 8, PILLAR_TOP_ROW), 30)).toBe(false) // bare earth never catches
  })

  test('the fire creeps across the whole exposed cap, then spends itself to bare earth for good', () => {
    const vt = mkVt()
    expect(igniteSurface(vt, ...cellCenter(A_C0, A_TOP_ROW - 1), 1)).toBe(true) // one END cell alight
    expect(surfaceArea(vt, Surface.FIRE)).toBe(C * C)
    stepVoxel(vt, GRASS_FIRE_SPREAD_AFTER + 1 / 30) // cross the spread mark
    expect(surfaceArea(vt, Surface.FIRE)).toBe(2 * C * C) // crept exactly one neighbour along the cap
    for (let t = 0; t < CAP_BURNOUT; t += 1 / 30) stepVoxel(vt, 1 / 30)
    expect(surfaceArea(vt, Surface.FIRE)).toBe(0) // every cell spent…
    expect(surfaceArea(vt, Surface.GRASS)).toBe(0) // …and no grass survived anywhere on the cap
    for (let i = 0; i < 300; i += 1) stepVoxel(vt, 1 / 30)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(0) // spent ground stays bare without wetting
  })

  test('a water hit douses burning cells back to grass mid-burn (no stale timer resurrects)', () => {
    const vt = mkVt()
    const grassBefore = surfaceArea(vt, Surface.GRASS)
    igniteSurface(vt, GRASS_X, GRASS_Y, 30)
    stepVoxel(vt, 1 / 30) // the burn is underway
    expect(douseSurface(vt, GRASS_X, GRASS_Y, 60)).toBe(true)
    expect(surfaceArea(vt, Surface.FIRE)).toBe(0)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBefore) // saved — it never finished burning
    expect(douseSurface(vt, GRASS_X, GRASS_Y, 60)).toBe(false) // nothing left alight
    for (let i = 0; i < 300; i += 1) stepVoxel(vt, 1 / 30) // long past the would-be burn-out
    expect(surfaceArea(vt, Surface.GRASS)).toBe(grassBefore)
  })

  test('wetSurface regrows grass on burned-out ground after SURFACE_REGROW_TIME', () => {
    const vt = mkVt()
    igniteSurface(vt, ...cellCenter(A_C0, A_TOP_ROW - 1), 1)
    for (let t = 0; t < CAP_BURNOUT + GRASS_FIRE_SPREAD_AFTER; t += 1 / 30) stepVoxel(vt, 1 / 30)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(0) // the whole cap burned through

    expect(wetSurface(vt, GRASS_X, GRASS_Y, 30)).toBe(true)
    stepVoxel(vt, SURFACE_REGROW_TIME * 0.5)
    expect(surfaceArea(vt, Surface.GRASS)).toBe(0)
    stepVoxel(vt, SURFACE_REGROW_TIME * 0.6)
    expect(surfaceArea(vt, Surface.GRASS)).toBeGreaterThan(0)
  })
})

describe('snapshotVoxel / restoreVoxel (terrain persistence round-trip)', () => {
  test('a carved, burning, wetted arena restores cell-for-cell onto a same-fixture grid', () => {
    const vt = mkVt()
    // Crater the pillar, ignite + wet the island cap, and carve into island B (possibly
    // severing a chunk into flight — whatever results must round-trip exactly).
    carveVoxel(vt, ...cellCenter(PILLAR_C0 + 4, PILLAR_TOP_ROW), 2.5 * C)
    igniteSurface(vt, ...cellCenter(A_C0 + 2, A_TOP_ROW - 1), C)
    wetSurface(vt, ...cellCenter(A_C0 + 8, A_TOP_ROW - 1), C)
    carveVoxel(vt, ...cellCenter(B_C0 + 5, B_TOP_ROW + 2), 2.2 * C)
    stepVoxel(vt, 0.1) // let any loosed chunk accrue fall state (and the fire clock tick) worth persisting
    expect(vt.burning.size).toBeGreaterThan(0) // the cap is alight going into the snapshot
    const snap = snapshotVoxel(vt)

    const restored = mkVt()
    expect(restoreVoxel(restored, snap)).toBe(true)
    expect(restored.mat.every((value, i) => value === vt.mat[i])).toBe(true)
    expect(restored.pinned.map((s) => [...s].sort())).toEqual(vt.pinned.map((s) => [...s].sort()))
    expect(restored.bodies.length).toBe(vt.bodies.length)
    expect([...restored.regrow.entries()]).toEqual([...vt.regrow.entries()])
    expect([...restored.burning.entries()]).toEqual([...vt.burning.entries()])
    expect(JSON.stringify(voxelToBlocks(restored))).toBe(JSON.stringify(voxelToBlocks(vt)))
  })

  test('a pre-fire snapshot (no burning map) restores with nothing alight', () => {
    const vt = mkVt()
    const snap = { ...snapshotVoxel(vt), burning: undefined }
    const restored = mkVt()
    restored.burning.set(0, 1) // stale state the restore must replace
    expect(restoreVoxel(restored, snap)).toBe(true)
    expect(restored.burning.size).toBe(0)
  })

  test('a snapshot that does not fit the grid is rejected untouched', () => {
    const vt = mkVt()
    const before = JSON.stringify(voxelToBlocks(vt))
    const snap = snapshotVoxel(vt)
    expect(restoreVoxel(vt, { ...snap, cols: vt.cols - 1 })).toBe(false)
    expect(JSON.stringify(voxelToBlocks(vt))).toBe(before)
  })
})

// A stone basin in an otherwise-empty arena: a bedrock floor, a thick destructible earth bed on it
// (rows 100–109), and two earth walls (rows 94–99) ten cells apart. Water poured between the walls
// pools on the bed; carving through the bed lets it drain. All whole cells so wet rows are exact.
const BASIN_FLOOR_ROW = 110
const BED_TOP = 100 // earth bed top (the pool's resting floor)
const basinTerrain = (): ReturnType<typeof createVoxelTerrain> => {
  const blocks: Block[] = [
    blk(0, BASIN_FLOOR_ROW, Math.ceil(WORLD_WIDTH / C), 1, StructureType.METAL, Surface.EARTH), // bedrock floor
    blk(40, BED_TOP, 11, BASIN_FLOOR_ROW - BED_TOP, StructureType.EARTH, Surface.EARTH), // earth bed, cols 40–50
    blk(40, 94, 1, 6, StructureType.EARTH, Surface.EARTH), // left wall, rows 94–99
    blk(50, 94, 1, 6, StructureType.EARTH, Surface.EARTH), // right wall, rows 94–99
  ]
  return createVoxelTerrain(blocks, [])
}
const runToRest = (vt: ReturnType<typeof createVoxelTerrain>, cap = 5000): void => {
  let n = 0
  while (stepWater(vt) && n < cap) n += 1
}
// The lowest (largest-row) cell holding water — how far down the fluid has reached.
const deepestWetRow = (vt: ReturnType<typeof createVoxelTerrain>): number => {
  let row = -1
  for (let i = 0; i < vt.fluid.level.length; i += 1) if (vt.fluid.level[i] > 0) row = Math.max(row, (i / vt.cols) | 0)
  return row
}

describe('per-cell water (voxel ↔ fluid wiring)', () => {
  test('pourWater injects, stepWater flows, and it settles into a contained body', () => {
    const vt = basinTerrain()
    expect(fluidToBodies(vt)).toHaveLength(0) // dry to start
    pourWater(vt, ...cellCenter(45, BED_TOP - 1), 3 * WATER_CELL_FULL) // dump into the basin
    expect(fluidToBodies(vt).length).toBeGreaterThan(0) // water present immediately
    runToRest(vt)
    expect(stepWater(vt)).toBe(false) // it came to rest — no perpetual churn
    const bodies = fluidToBodies(vt)
    expect(bodies.length).toBeGreaterThan(0) // pooled, didn't vanish
    expect(bodies.every((b) => b.x >= 40 * C && b.x + b.w <= 51 * C)).toBeTrue() // contained by the walls
  })

  test('carving through the bed under a pool lets the water flow down the new hole', () => {
    const vt = basinTerrain()
    pourWater(vt, ...cellCenter(45, BED_TOP - 1), 2 * WATER_CELL_FULL)
    runToRest(vt)
    const restedFloor = deepestWetRow(vt)
    expect(restedFloor).toBe(BED_TOP - 1) // resting on the bed top (a shallow pool above row 100)
    carveVoxel(vt, ...cellCenter(45, BED_TOP + 1), 2.5 * C) // gouge a pocket through the bed top
    runToRest(vt)
    expect(deepestWetRow(vt)).toBeGreaterThan(restedFloor) // the water followed the carve DOWN, not floating
  })

  test('a settled pool derives as coalesced, whole-pixel bodies (stable buoyancy queries)', () => {
    const vt = basinTerrain()
    pourWater(vt, ...cellCenter(45, BED_TOP - 1), 3 * WATER_CELL_FULL)
    runToRest(vt)
    const bodies = fluidToBodies(vt)
    expect(bodies.length).toBeLessThanOrEqual(2) // a flat pool coalesces, it doesn't shatter per-column
    for (const b of bodies) expect(b.y).toBe(Math.round(b.y)) // surfaces snap to whole px — no sub-pixel jitter
    // Deriving twice without flowing yields identical bodies (nothing wobbles frame to frame).
    expect(fluidToBodies(vt)).toEqual(bodies)
  })

  test('water trapped under an overhang derives as its own (lower) body — not dropped under the surface pool', () => {
    const vt = basinTerrain()
    const { fluid, cols } = vt
    // Two separate wet runs in the same columns: a surface pool (row 80) and, below a dry gap (the
    // overhang's rock roof + the air beneath it, rows 81–89), a pocket trapped under it (row 90).
    // The old derivation kept only the topmost run per column, so the pocket vanished — rendering as
    // a black void and reading as dry to anything down in it. Both runs must now derive.
    for (let col = 44; col <= 46; col += 1) {
      fluid.level[80 * cols + col] = WATER_CELL_FULL
      fluid.level[90 * cols + col] = WATER_CELL_FULL
      markWet(fluid, col, 80)
      markWet(fluid, col, 90)
    }
    const bodies = fluidToBodies(vt)
    const surface = bodies.filter((b) => b.y === 80 * C)
    const pocket = bodies.filter((b) => b.y === 90 * C)
    expect(surface).toHaveLength(1) // the top pool, cols 44–46 coalesced
    expect(pocket).toHaveLength(1) // the trapped pocket, NOT dropped
    expect(pocket[0].x).toBe(44 * C)
    expect(pocket[0].w).toBe(3 * C)
    expect(pocket[0].y).toBeGreaterThan(surface[0].y + surface[0].h) // stacked below, a real gap between
  })

  test('a chunk breaking off wakes the pool resting on it — water rides terrain down, never hangs', () => {
    // A little bowl (floor + two walls) on a thin neck down to bedrock, holding a settled pool.
    const FLOOR = 120
    const vt = createVoxelTerrain(
      [
        blk(0, FLOOR, Math.ceil(WORLD_WIDTH / C), 1, StructureType.METAL, Surface.EARTH), // bedrock floor
        blk(55, 109, 12, 1, StructureType.EARTH, Surface.EARTH), // bowl floor, cols 55–66 row 109
        blk(55, 106, 1, 3, StructureType.EARTH, Surface.EARTH), // left bowl wall
        blk(66, 106, 1, 3, StructureType.EARTH, Surface.EARTH), // right bowl wall
        blk(60, 110, 2, FLOOR - 110, StructureType.EARTH, Surface.EARTH), // neck, cols 60–61
      ],
      []
    )
    pourWater(vt, ...cellCenter(60, 108), 3 * WATER_CELL_FULL) // pool settles in the bowl
    runToRest(vt)
    expect(deepestWetRow(vt)).toBeLessThan(110) // resting up in the bowl, well above the floor
    expect(stepWater(vt)).toBe(false) // and at rest — nothing moving

    // Sever the neck: the bowl loses its ground and breaks off as a falling chunk. The pool sitting
    // in it must wake and come down with the space the chunk left — not float where the bowl was.
    for (let row = 110; row < FLOOR; row += 1) carveVoxel(vt, ...cellCenter(60, row), 4)
    for (let row = 110; row < FLOOR; row += 1) carveVoxel(vt, ...cellCenter(61, row), 4)
    expect(stepWater(vt)).toBe(true) // the breaking chunk woke the pool — it's falling, not hanging
  })

  test('a sealed footprint is watertight — poured water sheds off it, never pooling inside', () => {
    const vt = basinTerrain()
    // A "barracks" standing on the basin bed (cols 43–47, rows 97–99): sealed solid to water only.
    const shelter = { x: 43 * C, y: 97 * C, w: 5 * C, h: 3 * C }
    sealWaterRect(vt, shelter)
    const sealed: number[] = []
    for (let row = 97; row <= 99; row += 1) for (let col = 43; col <= 47; col += 1) sealed.push(row * vt.cols + col)
    expect(sealed.every((i) => vt.fluid.wall[i] === 1)).toBeTrue() // footprint marked watertight

    pourWater(vt, ...cellCenter(45, 90), 8 * WATER_CELL_FULL) // dump water straight onto the roof
    runToRest(vt)

    expect(sealed.every((i) => vt.fluid.level[i] === 0)).toBeTrue() // not a drop got inside the shelter
    // It shed off the roof and pooled on the bed in the gaps beside the walls (cols 41–42 / 48–49).
    const beside = (col: number): boolean => {
      for (let row = 94; row <= 99; row += 1) if (vt.fluid.level[row * vt.cols + col] > 0) return true
      return false
    }
    expect(beside(41) || beside(42)).toBeTrue()
    expect(beside(48) || beside(49)).toBeTrue()
  })

  test('the fluid grid round-trips through the terrain snapshot', () => {
    const vt = basinTerrain()
    pourWater(vt, ...cellCenter(45, BED_TOP - 1), 4 * WATER_CELL_FULL)
    for (let i = 0; i < 30; i += 1) stepWater(vt)
    const before = fluidToBodies(vt)
    const restored = basinTerrain()
    expect(restoreVoxel(restored, snapshotVoxel(vt))).toBe(true)
    expect([...restored.fluid.level]).toEqual([...vt.fluid.level]) // cell-for-cell water levels
    expect(fluidToBodies(restored)).toEqual(before) // same derived bodies
  })

  test('a pre-fluid snapshot leaves authored water intact (no dry-wipe on restore)', () => {
    const authored = [{ x: 41 * C, y: 96 * C, w: 9 * C, h: 4 * C }] // a body sitting in the basin
    const seeded = createVoxelTerrain(
      [
        blk(0, BASIN_FLOOR_ROW, Math.ceil(WORLD_WIDTH / C), 1, StructureType.METAL, Surface.EARTH),
        blk(40, BED_TOP, 11, BASIN_FLOOR_ROW - BED_TOP, StructureType.EARTH, Surface.EARTH),
        blk(40, 94, 1, 6, StructureType.EARTH, Surface.EARTH),
        blk(50, 94, 1, 6, StructureType.EARTH, Surface.EARTH),
      ],
      authored
    )
    expect(fluidToBodies(seeded).length).toBeGreaterThan(0) // authored water seeded into the grid
    const legacy = { ...snapshotVoxel(seeded), fluid: undefined, fluidTick: undefined } // a pre-fluid blob
    expect(restoreVoxel(seeded, legacy)).toBe(true)
    expect(fluidToBodies(seeded).length).toBeGreaterThan(0) // still wet — the authored fill survived
  })
})
