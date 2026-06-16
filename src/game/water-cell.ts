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
// pressure term modelled) used to let a fast stream stack straight up the face of a wall and crest it.
// The deposit NEVER rises above the impact row: water pools at and under where the stream hit and
// spreads sideways, it doesn't climb a column up past the hit. Only a genuinely walled-in pocket that
// is already full down to the impact overflows upward (the second pass) so no volume is lost; anything
// past row 0 spills off the top of the world. Volume-conserving and fully deterministic (no rng).
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
  // Fill one row: the impact column (when open) plus an outward widening to both sides, each stopping
  // at a solid. Used bottom-up so a slug lays down a flat, widening puddle rather than a tall column.
  const fillRow = (r: number): void => {
    if (!solid(col, r)) put(col, r)
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
  // 2. From the landing row up to the impact row, widen each row before climbing — capped at the hit
  //    so the puddle never starts above where the stream struck.
  for (let r = land; remaining > 0 && r >= row; r -= 1) fillRow(r)
  // 3. Overflow: only if the impact row and everything below it is walled in and brim-full does water
  //    have nowhere left to go but up — then let it rise (still widening) rather than vanish.
  for (let r = row - 1; remaining > 0 && r >= 0; r -= 1) fillRow(r)
}

// Does a cell REST at this row — i.e. it can't fall, so it holds water here? True when the floor
// below is solid or already brim-full. Cells that can fall (open air / room below) are NOT resting:
// water spills off them, so they bound a level-run rather than belonging to it.
const restsAt = (g: FluidGrid, solid: SolidFn, col: number, row: number): boolean =>
  !solid(col, row) && (solid(col, row + 1) || g.level[(row + 1) * g.cols + col] >= WATER_CELL_FULL)

// Level the maximal run of horizontally-adjacent RESTING cells that (col, row) belongs to, sharing
// their water evenly so the surface goes truly flat. This is what stops a poured puddle (or any body)
// from settling as a 1-unit-per-cell wedge: pairwise half-gap spreading leaves a monotone ramp resting
// (each neighbour within WATER_SETTLE_EPS), which over a wide span mounds up px deep instead of lying
// flat like a natural pool. The run is bounded by solids (walls) and by cells that can fall (cliff
// edges / floor holes) — water pours off those through the spread step, it doesn't level across them.
// Volume is conserved exactly; an odd remainder packs into the left-most cells so the rest state is a
// single deterministic configuration (no left/right ping-pong → it settles, never oscillates). Touched
// cells are flagged in `leveled` so each run is equalised once a tick, not once per member.
const equalizeRun = (g: FluidGrid, solid: SolidFn, col: number, row: number, leveled: Set<number>): boolean => {
  const { cols } = g
  let a = col
  let b = col
  while (a - 1 >= 0 && restsAt(g, solid, a - 1, row)) a -= 1
  while (b + 1 < cols && restsAt(g, solid, b + 1, row)) b += 1
  const base = row * cols
  let sum = 0
  for (let c = a; c <= b; c += 1) {
    sum += g.level[base + c]
    leveled.add(base + c)
  }
  const n = b - a + 1
  if (n === 1) return false // a lone resting cell (walled / cliff-edged) — nothing to level against
  const q = (sum / n) | 0
  const rem = sum - q * n
  let changed = false
  for (let c = a; c <= b; c += 1) {
    const target = q + (c - a < rem ? 1 : 0) // the `rem` extra units sit on the left-most cells
    const i = base + c
    if (g.level[i] !== target) {
      g.level[i] = target
      if (target > 0) markWet(g, c, row)
      wakeAround(g, c, row)
      changed = true
    }
  }
  return changed
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
  const leveled = new Set<number>() // cells equalised this tick (so each level-run runs once)

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

    const supported = solid(col, row + 1) || g.level[i + cols] >= WATER_CELL_FULL

    // 2. Level: flatten the resting horizontal run this cell sits in so the surface lies flat (a real
    //    pool), instead of resting as a 1-per-cell wedge. Done once per run via the `leveled` flags.
    if (lvl > 0 && supported && !leveled.has(i)) {
      if (equalizeRun(g, solid, col, row, leveled)) changed = true
      lvl = g.level[i]
    }

    // 3. Spread: once it's resting on support, pour off toward a lower neighbour outside the run —
    //    a cliff edge or a lower basin — so water drains off ledges and trickles down to the bottom.
    if (lvl > 0 && supported) {
      const order = leftFirst ? -1 : 1
      for (let s = 0; s < 2; s += 1) {
        const d = s === 0 ? order : -order
        const nc = col + d
        if (nc < 0 || nc >= cols || solid(nc, row)) continue
        const n = i + d
        // A neighbour that can fall is a drain (a cliff edge or a hole over a lower basin): hand it the
        // whole surplus that fits, since the water pours off and won't wash back — so the last unit
        // leaves instead of clinging as a within-WATER_SETTLE_EPS film, and a shelf empties completely.
        // Otherwise level off by half the gap (integer → converges, never overshoots or oscillates).
        const nFalls = !solid(nc, row + 1) && g.level[n + cols] < WATER_CELL_FULL
        const move = nFalls ? Math.min(lvl, WATER_CELL_FULL - g.level[n]) : (lvl - g.level[n]) >> 1
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
