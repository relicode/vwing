import { describe, expect, test } from 'bun:test'

import { WATER_CELL_FULL } from '$/game/constants'
import { createFluidGrid, type FluidGrid, pourFluid, type SolidFn, stepFluid, wakeAround } from '$/game/water-cell'

// A grid whose solidity comes from a list of solid cells (out-of-grid counts as solid: walls + floor
// + ceiling). The fluid module is terrain-agnostic, so this is all it needs.
const arena = (cols: number, rows: number, solidCells: [number, number][]): { g: FluidGrid; solid: SolidFn } => {
  const s = new Uint8Array(cols * rows)
  for (const [c, r] of solidCells) s[r * cols + c] = 1
  const solid: SolidFn = (c, r) => c < 0 || c >= cols || r < 0 || r >= rows || s[r * cols + c] === 1
  return { g: createFluidGrid(cols, rows), solid }
}

const volume = (g: FluidGrid): number => g.level.reduce((a, b) => a + b, 0)

// Run the fluid to rest (active-set empty) or until a tick cap, returning the tick count.
const settle = (g: FluidGrid, solid: SolidFn, cap = 2000): number => {
  let n = 0
  while (g.active.size > 0 && n < cap) {
    stepFluid(g, solid)
    n += 1
  }
  return n
}

// Solid border: floor (bottom row), two side walls, leaving an open-topped box of interior columns.
const box = (cols: number, rows: number): [number, number][] => {
  const cells: [number, number][] = []
  for (let c = 0; c < cols; c += 1) cells.push([c, rows - 1]) // floor
  for (let r = 0; r < rows; r += 1) {
    cells.push([0, r]) // left wall
    cells.push([cols - 1, r]) // right wall
  }
  return cells
}

// Topmost wet row in a column, or rows (dry).
const surfaceRow = (g: FluidGrid, col: number): number => {
  for (let r = 0; r < g.rows; r += 1) if (g.level[r * g.cols + col] > 0) return r
  return g.rows
}
const columnVolume = (g: FluidGrid, col: number): number => {
  let v = 0
  for (let r = 0; r < g.rows; r += 1) v += g.level[r * g.cols + col]
  return v
}

describe('water-cell — water falls, levels, and pours like a fluid', () => {
  test('a blob in mid-air falls to the floor and spreads into a flat puddle', () => {
    const { g, solid } = arena(5, 6, [
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
    ]) // floor at row 5, no walls
    g.level[0 * 5 + 2] = WATER_CELL_FULL // one full cell at the top of column 2
    wakeAround(g, 2, 0)
    settle(g, solid)
    let onFloor = 0
    for (let c = 0; c < 5; c += 1) onFloor += g.level[4 * 5 + c] // the row just above the floor
    expect(onFloor).toBe(WATER_CELL_FULL) // it all landed and spread along the floor, none left aloft
    for (let c = 0; c < 5; c += 1) expect(g.level[3 * 5 + c]).toBe(0) // a thin sheet, nothing stacked up
    expect(volume(g)).toBe(WATER_CELL_FULL) // nothing created or destroyed on the way down
  })

  test('a poured column levels out flat across a flat-bottomed basin', () => {
    const cols = 9
    const rows = 9
    const { g, solid } = arena(cols, rows, box(cols, rows))
    const before = volume(g)
    pourFluid(g, solid, 1, rows - 2, 4 * WATER_CELL_FULL) // dump 4 cells of water into the far-left column
    const poured = volume(g) - before
    settle(g, solid)
    const wetCols = []
    for (let c = 1; c <= cols - 2; c += 1) if (columnVolume(g, c) > 0) wetCols.push(c)
    expect(wetCols.length).toBe(cols - 2) // it spread across the whole basin, not a left-side heap
    const surfaces = wetCols.map((c) => surfaceRow(g, c))
    expect(Math.max(...surfaces) - Math.min(...surfaces)).toBeLessThanOrEqual(1) // flat top (±1 cell)
    expect(volume(g)).toBe(poured) // volume conserved exactly through all the flowing
  })

  test('a wide body levels truly flat — no resting wedge perched across the span', () => {
    // A wide flat-bottomed basin. Dump everything into ONE column; it must settle level across the
    // whole span — not as a mound tapering 1 unit per cell from the impact (the wedge bug, where a
    // monotone ramp rests because every neighbour is within WATER_SETTLE_EPS, so a wide pour mounds up
    // cells deep instead of lying flat like a natural pool).
    const cols = 60
    const rows = 8
    const { g, solid } = arena(cols, rows, box(cols, rows))
    pourFluid(g, solid, 2, rows - 2, 30 * WATER_CELL_FULL)
    settle(g, solid)
    const surfaces = []
    const fills = []
    for (let c = 1; c <= cols - 2; c += 1) {
      surfaces.push(surfaceRow(g, c))
      fills.push(g.level[(rows - 2) * cols + c]) // fill in the surface row of each column
    }
    expect(Math.max(...surfaces) - Math.min(...surfaces)).toBeLessThanOrEqual(1) // dead flat across 58 cells
    expect(Math.max(...fills) - Math.min(...fills)).toBeLessThanOrEqual(1) // even the partial fills agree to ±1
    expect(volume(g)).toBe(30 * WATER_CELL_FULL)
  })

  test('water on a WIDE shelf drains right off the open edge — no wedge clings far from the edge', () => {
    // The narrow-shelf case below proves draining at all; this proves the whole span drains. A wide
    // flat shelf (cols 1..40) with a deep pit to its right. Water poured at the FAR end (col 2, 38
    // cells from the edge) must trickle all the way across and off — not leave a ramp deepening with
    // distance from the drain (which is exactly what the 1-per-cell wedge did).
    const cols = 50
    const rows = 12
    const solidCells: [number, number][] = []
    for (let c = 0; c < cols; c += 1) solidCells.push([c, rows - 1])
    for (let r = 0; r < rows; r += 1) {
      solidCells.push([0, r])
      solidCells.push([cols - 1, r])
    }
    for (let c = 1; c <= 40; c += 1) for (let r = 3; r < rows - 1; r += 1) solidCells.push([c, r]) // shelf top row 2
    const { g, solid } = arena(cols, rows, solidCells)
    pourFluid(g, solid, 2, 2, 8 * WATER_CELL_FULL)
    const poured = volume(g)
    settle(g, solid)
    let onShelf = 0
    for (let c = 1; c <= 40; c += 1) onShelf += g.level[2 * cols + c] // shelf-top row
    expect(onShelf).toBeLessThanOrEqual(40) // at most a 1-unit film per cell — the body trickled into the pit
    let inPit = 0
    for (let c = 41; c <= cols - 2; c += 1) inPit += columnVolume(g, c)
    expect(inPit).toBeGreaterThan(poured * 0.9)
    expect(volume(g)).toBe(poured)
  })

  test('water on a shelf pours off the open edge instead of perching', () => {
    // A shelf at row 4 spanning cols 1..4; open air to its right (cols 5..7) down to the floor row 8.
    const cols = 9
    const rows = 9
    const solidCells: [number, number][] = []
    for (let c = 0; c < cols; c += 1) solidCells.push([c, rows - 1]) // floor
    for (let r = 0; r < rows; r += 1) {
      solidCells.push([0, r])
      solidCells.push([cols - 1, r])
    }
    for (let c = 1; c <= 4; c += 1) solidCells.push([c, 4]) // the shelf top
    for (let c = 1; c <= 4; c += 1) for (let r = 5; r < rows - 1; r += 1) solidCells.push([c, r]) // shelf body
    const { g, solid } = arena(cols, rows, solidCells)
    pourFluid(g, solid, 3, 3, 3 * WATER_CELL_FULL) // pour onto the shelf top
    const poured = volume(g)
    settle(g, solid)
    let onShelf = 0
    for (let c = 1; c <= 4; c += 1) onShelf += g.level[3 * cols + c] // shelf-top row
    expect(onShelf).toBeLessThan(WATER_CELL_FULL * 0.1) // drained off the shelf (only a sub-eps film clings)
    let inPit = 0
    for (let c = 5; c <= cols - 2; c += 1) inPit += columnVolume(g, c) // the right-hand pit
    expect(inPit).toBeGreaterThan(poured * 0.9) // nearly all of it ended up down in the pit
    expect(volume(g)).toBe(poured)
  })

  test('a poured slug never deposits above the impact row (it pools at/under the hit)', () => {
    // A 1-wide crevice (walls at cols 3 and 5 from row 8 down). Hit it partway down with a big slug;
    // the old fill climbed bottom-up past the impact, stacking water ABOVE where the stream struck.
    const cols = 9
    const rows = 20
    const solidCells: [number, number][] = []
    for (let c = 0; c < cols; c += 1) solidCells.push([c, rows - 1])
    for (let r = 0; r < rows; r += 1) {
      solidCells.push([0, r])
      solidCells.push([cols - 1, r])
    }
    for (let r = 8; r < rows - 1; r += 1) {
      solidCells.push([3, r])
      solidCells.push([5, r])
    }
    const { g, solid } = arena(cols, rows, solidCells)
    const impact = 10
    pourFluid(g, solid, 4, impact, 8 * WATER_CELL_FULL)
    let aboveImpact = 0
    for (let r = 0; r < impact; r += 1) for (let c = 0; c < cols; c += 1) aboveImpact += g.level[r * cols + c]
    expect(aboveImpact).toBe(0) // nothing deposited above where the stream hit
    expect(volume(g)).toBe(8 * WATER_CELL_FULL) // and no volume lost capping the fill
  })

  test('a sealed shaft full to the impact overflows upward rather than losing volume', () => {
    // A 1-wide sealed shaft (col 2). Pour more than fits from floor to impact: it has nowhere to go
    // but up, so the overflow pass lets it rise — volume must be conserved exactly.
    const cols = 5
    const rows = 20
    const solidCells: [number, number][] = []
    for (let c = 0; c < cols; c += 1) solidCells.push([c, rows - 1])
    for (let r = 0; r < rows; r += 1) {
      solidCells.push([0, r])
      solidCells.push([1, r])
      solidCells.push([3, r])
      solidCells.push([4, r])
    }
    const { g, solid } = arena(cols, rows, solidCells)
    pourFluid(g, solid, 2, 15, 8 * WATER_CELL_FULL)
    expect(volume(g)).toBe(8 * WATER_CELL_FULL)
  })

  test('flow is deterministic — identical runs yield byte-identical grids', () => {
    const cols = 9
    const rows = 9
    const run = (): Uint8Array => {
      const { g, solid } = arena(cols, rows, box(cols, rows))
      pourFluid(g, solid, 2, rows - 2, 5 * WATER_CELL_FULL)
      pourFluid(g, solid, 6, rows - 2, 2 * WATER_CELL_FULL)
      settle(g, solid)
      return g.level.slice()
    }
    expect(run()).toEqual(run())
  })

  test('a settled body leaves the active-set empty (rests for free)', () => {
    const cols = 9
    const rows = 9
    const { g, solid } = arena(cols, rows, box(cols, rows))
    pourFluid(g, solid, 4, rows - 2, 3 * WATER_CELL_FULL)
    settle(g, solid)
    expect(g.active.size).toBe(0)
  })

  test('a heavy hit at the base of a wall spreads along the basin instead of cresting it', () => {
    const cols = 9
    const rows = 9
    const solidCells: [number, number][] = []
    for (let c = 0; c < cols; c += 1) solidCells.push([c, rows - 1]) // floor
    for (let r = 0; r < rows; r += 1) {
      solidCells.push([0, r]) // left wall
      solidCells.push([cols - 1, r]) // right wall
    }
    for (let r = 4; r < rows - 1; r += 1) solidCells.push([4, r]) // a mid wall, its top at row 4
    const { g, solid } = arena(cols, rows, solidCells)
    pourFluid(g, solid, 3, rows - 2, 5 * WATER_CELL_FULL) // a fast stream slammed into the wall's base
    // Deposit-and-spread: the water widens across the near basin; it never builds a climbing column up
    // the wall face, so nothing is perched above the wall's top (rows < 4)...
    for (let r = 0; r < 4; r += 1) for (let c = 1; c <= cols - 2; c += 1) expect(g.level[r * cols + c]).toBe(0)
    // ...and none of it crested onto the far side of the wall.
    for (let c = 5; c <= cols - 2; c += 1) expect(columnVolume(g, c)).toBe(0)
    expect(volume(g)).toBe(5 * WATER_CELL_FULL) // volume conserved exactly
  })
})
