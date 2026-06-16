import { WATER_CELL_FULL, WATER_SETTLE_EPS } from '$/game/constants'

// ── Per-cell water as a flowing fluid ────────────────────────────────────────
// Water is a per-cell fill level over the voxel grid: level[i] is how full cell i is, 0 (dry) ..
// WATER_CELL_FULL (one VOXEL_CELL of depth). Each tick water FLOWS — it falls into the cell below,
// and when it can't fall it spreads sideways to equalize with its neighbours — so a body seeks the
// lowest point, levels its surface, pours off ledges, and fills carved pockets. The motion is fully
// deterministic (a sorted active-set, integer transfers that conserve volume exactly, and an L/R
// spread bias that alternates by tick parity to kill directional drift) and NEVER touches the rng.
//
// Only `active` cells — wet ones still able to move — are processed; settled water (the resting sea)
// drops out of the set and costs nothing per frame, the same active-set trick the fire walk uses.
// The grid is terrain-agnostic: callers pass a `solid(col,row)` predicate, so this module stays pure
// and testable without pixi, the voxel grid, or any sim state. (Limitation: with no pressure term,
// water levels open basins and spills dams but won't climb a sealed far arm of a U-tube above the
// channel that feeds it — rare in this open terrain, and a pressure pass can be added later.)

export type FluidGrid = {
  cols: number
  rows: number
  level: Uint8Array // per-cell fill 0..WATER_CELL_FULL
  wall: Uint8Array // 1 = solid to water ONLY (watertight base footprints) — never to hulls/troopers
  active: Set<number> // cells that may still move (wet + out of equilibrium)
  tick: number // flow-tick counter; its low bit alternates the sideways bias
  // Bounding box of cells that have held water, so derivation/scans skip the dry rest of the grid.
  // Grown when water enters a new cell; re-tightened to the live wet extent by markWetBounds.
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

export type SolidFn = (col: number, row: number) => boolean

export const createFluidGrid = (cols: number, rows: number): FluidGrid => ({
  cols,
  rows,
  level: new Uint8Array(cols * rows),
  wall: new Uint8Array(cols * rows),
  active: new Set(),
  tick: 0,
  minCol: cols,
  maxCol: -1,
  minRow: rows,
  maxRow: -1,
})

// Grow the wet bounding box to include (col, row) — called wherever water enters a cell.
export const markWet = (g: FluidGrid, col: number, row: number): void => {
  if (col < g.minCol) g.minCol = col
  if (col > g.maxCol) g.maxCol = col
  if (row < g.minRow) g.minRow = row
  if (row > g.maxRow) g.maxRow = row
}

// Reset the wet bounding box to a freshly measured tight extent (callers that scan the grid feed
// the live min/max back in so drained regions stop being scanned next time).
export const setWetBounds = (g: FluidGrid, minCol: number, maxCol: number, minRow: number, maxRow: number): void => {
  g.minCol = minCol
  g.maxCol = maxCol
  g.minRow = minRow
  g.maxRow = maxRow
}

// Wake a cell so it (re)enters the flow next tick. Out-of-grid indices are ignored.
const wake = (g: FluidGrid, col: number, row: number): void => {
  if (col >= 0 && col < g.cols && row >= 0 && row < g.rows) g.active.add(row * g.cols + col)
}

// Wake a cell and the four orthogonal neighbours its level change could unbalance.
export const wakeAround = (g: FluidGrid, col: number, row: number): void => {
  wake(g, col, row)
  wake(g, col, row - 1)
  wake(g, col, row + 1)
  wake(g, col - 1, row)
  wake(g, col + 1, row)
}

// Mark a cell as a permanent WALL — solid to water ONLY (a watertight base footprint). Water can
// never occupy it: any fill it already holds is evicted and it leaves the active set. The flow reads
// walls through the caller's `solid` predicate (so it never falls or spreads into one); this just
// keeps the cell itself dry. Idempotent, so re-sealing on restore is free.
export const sealFluidCell = (g: FluidGrid, col: number, row: number): void => {
  if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) return
  const i = row * g.cols + col
  g.wall[i] = 1
  if (g.level[i] > 0) {
    g.level[i] = 0
    g.active.delete(i)
  }
}

// Inject `amount` level-units of water at (col, row) — the water-cannon stream. The water FALLS to
// where it lands (the first cell whose floor is solid or already brim-full), then DEPOSITS AND
// SPREADS: each row is filled OUTWARD from the impact column (alternating left/right, each side
// stopping at a solid/wall) before the fill climbs to the row above. So a stream lays down a widening
// puddle at the surface that the flow then levels — it does NOT build a 1-wide column, which (with no
// pressure term modelled) used to let a fast stream stack straight up the face of a wall and crest
// it. Anything that overflows past row 0 spills off the top of the world and is lost. Volume-
// conserving and fully deterministic (fixed scan order, no rng).
export const pourFluid = (g: FluidGrid, solid: SolidFn, col: number, row: number, amount: number): void => {
  const { cols, rows } = g
  let remaining = amount
  if (remaining <= 0) return
  // 1. Fall: the stream drops from the impact through open air to where it lands.
  let land = row
  while (land + 1 < rows && !solid(col, land + 1) && g.level[(land + 1) * cols + col] < WATER_CELL_FULL) {
    land += 1
  }
  const put = (c: number, r: number): void => {
    const i = r * cols + c
    const amt = Math.min(WATER_CELL_FULL - g.level[i], remaining)
    if (amt <= 0) return
    g.level[i] += amt
    remaining -= amt
    markWet(g, c, r)
    wakeAround(g, c, r)
  }
  // 2. From the landing row up, widen each row outward from the impact column before climbing.
  for (let r = land; remaining > 0 && r >= 0; r -= 1) {
    if (solid(col, r)) continue // a solid in the impact column — climb past it
    put(col, r)
    let left = col - 1
    let right = col + 1
    let goL = true
    let goR = true
    while (remaining > 0 && (goL || goR)) {
      if (goL) {
        if (left < 0 || solid(left, r)) goL = false
        else {
          put(left, r)
          left -= 1
        }
      }
      if (goR && remaining > 0) {
        if (right >= cols || solid(right, r)) goR = false
        else {
          put(right, r)
          right += 1
        }
      }
    }
  }
}

// True when cell i can't move any water this tick: it can't fall (below is solid or brim-full) and
// every open horizontal neighbour is within WATER_SETTLE_EPS of it. Resting cells leave the set.
const atRest = (g: FluidGrid, solid: SolidFn, col: number, row: number): boolean => {
  const i = row * g.cols + col
  const lvl = g.level[i]
  if (lvl === 0) return true
  if (!solid(col, row + 1) && g.level[i + g.cols] < WATER_CELL_FULL) return false // can still fall
  if (col > 0 && !solid(col - 1, row) && Math.abs(lvl - g.level[i - 1]) > WATER_SETTLE_EPS) return false
  if (col < g.cols - 1 && !solid(col + 1, row) && Math.abs(lvl - g.level[i + 1]) > WATER_SETTLE_EPS) return false
  return true
}

// Advance the fluid one tick. Returns whether any water moved (so the caller refreshes the render
// geometry). Processes the active-set in a fixed order (descending index = bottom-up, right-to-left)
// so a column drains roughly one cell per tick instead of teleporting, and so replays are identical.
export const stepFluid = (g: FluidGrid, solid: SolidFn): boolean => {
  if (g.active.size === 0) return false
  const cols = g.cols
  const cells = [...g.active].sort((a, b) => b - a)
  g.active = new Set()
  const leftFirst = (g.tick & 1) === 0
  g.tick = (g.tick + 1) & 0x7fffffff
  let changed = false

  for (const i of cells) {
    let lvl = g.level[i]
    if (lvl === 0) continue
    const col = i % cols
    const row = (i / cols) | 0

    // 1. Fall: dump as much as fits into the cell directly below.
    if (!solid(col, row + 1)) {
      const b = i + cols
      const move = Math.min(lvl, WATER_CELL_FULL - g.level[b])
      if (move > 0) {
        g.level[i] = lvl - move
        g.level[b] += move
        lvl -= move
        changed = true
        markWet(g, col, row + 1)
        wakeAround(g, col, row) // both endpoints' neighbourhoods may now be out of balance
        wakeAround(g, col, row + 1)
      }
    }

    // 2. Spread: once it's resting on support, level off with the lower horizontal neighbour(s).
    const supported = solid(col, row + 1) || g.level[i + cols] >= WATER_CELL_FULL
    if (lvl > 0 && supported) {
      const order = leftFirst ? -1 : 1
      for (let s = 0; s < 2; s += 1) {
        const d = s === 0 ? order : -order
        const nc = col + d
        if (nc < 0 || nc >= cols || solid(nc, row)) continue
        const n = i + d
        const move = (lvl - g.level[n]) >> 1 // half the gap, integer → converges, never overshoots
        if (move > 0) {
          g.level[i] = lvl - move
          g.level[n] += move
          lvl -= move
          changed = true
          markWet(g, nc, row)
          wakeAround(g, col, row)
          wakeAround(g, nc, row)
        }
      }
    }

    if (!atRest(g, solid, col, row)) g.active.add(i)
  }
  return changed
}
