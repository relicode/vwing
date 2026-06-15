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
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'
import {
  carveVoxel,
  createVoxelTerrain,
  douseSurface,
  findPool,
  hasDebris,
  igniteSurface,
  restoreVoxel,
  settleWater,
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

// A small contained basin: two earth walls (rows 30–59) with a thick bed between them (rows 50–59),
// holding water from row 40 (surface) down to row 50 (the bed top). All in whole cells so the
// re-settled rect is exact. Independent of the production terrain.
const WALL_L = 10
const WALL_R = 20
const SURF_ROW = 40
const BED_ROW = 50
const basin = (): { vt: ReturnType<typeof createVoxelTerrain>; water: WaterBody[] } => {
  const blocks: Block[] = [
    blk(WALL_L, 30, 1, BED_ROW - 30, StructureType.EARTH, Surface.EARTH), // left wall, rows 30–49
    blk(WALL_R, 30, 1, BED_ROW - 30, StructureType.EARTH, Surface.EARTH), // right wall, rows 30–49
    blk(WALL_L, BED_ROW, WALL_R - WALL_L + 1, 10, StructureType.EARTH, Surface.EARTH), // bed, rows 50–59
  ]
  const water: WaterBody[] = [
    { x: (WALL_L + 1) * C, y: SURF_ROW * C, w: (WALL_R - WALL_L - 1) * C, h: (BED_ROW - SURF_ROW) * C },
  ]
  return { vt: createVoxelTerrain(blocks, water), water }
}

describe('settleWater — water falls / is contained as the terrain changes', () => {
  test('an intact basin is left exactly as it was (same array reference)', () => {
    const { vt, water } = basin()
    expect(settleWater(vt, water)).toBe(water) // unchanged → no redraw
  })

  test('a localized hole gouged under the bed (solid still below) does NOT smear the body deeper', () => {
    // The bed is 10 cells thick (rows 50–59). Gouge a hole through its top half in the middle columns,
    // leaving solid below — the flat rect must NOT chase the hole down (that would draw "water" over
    // the solid flanks beside it: the screenshot bug). The body is left exactly as it was.
    const { vt, water } = basin()
    carveVoxel(vt, 15 * C + C / 2, (BED_ROW + 2) * C, 2.5 * C) // hole in cols ~13–17, rows ~50–54
    expect(settleWater(vt, water)).toBe(water) // unchanged — no deepen, no bleed over the solid flanks
  })

  test('breaching a side wall at the waterline drops the surface — the water spills out and falls', () => {
    const { vt, water } = basin()
    carveVoxel(vt, WALL_L * C + C / 2, SURF_ROW * C + C / 2, C) // notch the left lip at the surface
    const settled = settleWater(vt, water)
    expect(settled).not.toBe(water)
    expect(settled[0].y).toBeGreaterThan(water[0].y) // the level fell to the breach
  })

  test('knocking the floor out from under a body drains it away entirely', () => {
    const { vt, water } = basin()
    carveVoxel(vt, 15 * C + C / 2, (BED_ROW + 5) * C, 6 * C) // blow the whole bed out under the body
    expect(settleWater(vt, water)).toHaveLength(0) // no bed left → the water falls away
  })

  test('a thick rim survives one carved-out boundary column (the lip probe looks past it)', () => {
    const blocks: Block[] = [
      blk(8, 30, 3, BED_ROW - 30, StructureType.EARTH, Surface.EARTH), // 3-col-thick left wall, cols 8–10
      blk(20, 30, 3, BED_ROW - 30, StructureType.EARTH, Surface.EARTH), // 3-col-thick right wall, cols 20–22
      blk(8, BED_ROW, 15, 10, StructureType.EARTH, Surface.EARTH), // bed, cols 8–22
    ]
    const water: WaterBody[] = [
      { x: 11 * C, y: SURF_ROW * C, w: 9 * C, h: (BED_ROW - SURF_ROW) * C }, // body in cols 11–19
    ]
    const vt = createVoxelTerrain(blocks, water)
    // Blow the innermost left wall column (col 10) clean out from the waterline down to the bed.
    for (let row = SURF_ROW; row < BED_ROW; row += 1) carveVoxel(vt, 10 * C + C / 2, row * C + C / 2, 5)
    expect(settleWater(vt, water)).toBe(water) // col 9 still walls it — surface held, no drop, no drain
  })
})
