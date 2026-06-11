import {
  DEBRIS_MAX_BODIES,
  DEBRIS_TERMINAL,
  GRASS_BURN_TIME,
  GRASS_FIRE_SPREAD_AFTER,
  GRAVITY,
  POOL_HALF_WIDTH,
  POOL_MAX_DEPTH,
  POOL_MAX_RISE,
  POOL_MIN_WIDTH,
  StructureType,
  SURFACE_REGROW_TIME,
  Surface,
  VOXEL_CELL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'

// Destructible terrain as a grid of small cells. Metal stays as indestructible anchor
// rectangles; earth cells are voxelized (each carrying its surface: bare earth / grass / ice)
// so a shot can carve a crater and any piece that loses its connection to a stable anchor
// (metal, the floor, or a floating island's pinned main mass) breaks off and falls as a debris
// chunk that re-settles where it lands. Collision + rendering still consume rectangles: the
// static grid and each falling chunk are greedily meshed into Block[] (see voxelToBlocks)
// whenever anything changes.

const EMPTY = 0
// Surface ids stored in the grid. Every grid cell is structure EARTH (metal lives out of the
// grid as bedrock anchors), so a cell value is just its surface (kept in sync with SURFACE_OF).
const EARTH = 1 // bare earth
const GRASS = 2
const ICE = 3
const FIRE = 4 // grass alight (its burn clock lives in `burning`; spent cells become EARTH)

const SURFACE_OF: Record<number, Surface> = {
  [EARTH]: Surface.EARTH,
  [GRASS]: Surface.GRASS,
  [ICE]: Surface.ICE,
  [FIRE]: Surface.FIRE,
}
const ID_OF: Partial<Record<Surface, number>> = {
  [Surface.EARTH]: EARTH,
  [Surface.GRASS]: GRASS,
  [Surface.ICE]: ICE,
  [Surface.FIRE]: FIRE,
}

// A loosed chunk falling under gravity. It moves vertically in whole-cell steps (timed by the
// `fall` accumulator) and is grid-aligned, so it re-stamps cleanly into the grid when it lands.
type DebrisBody = {
  col0: number // grid column of the body's top-left cell
  row0: number // grid row of the body's top-left cell (increases as it falls)
  boxCols: number
  boxRows: number
  cells: Uint8Array // material per local cell, indexed lr * boxCols + lc (0 = hole in the chunk)
  vy: number
  fall: number // px of pending downward travel not yet applied as whole cells
}

export type VoxelTerrain = {
  cols: number
  rows: number
  cell: number
  mat: Uint8Array // static grid material per cell
  bedrock: readonly Block[] // indestructible anchors (also collidable)
  bedrockMask: Uint8Array // 1 where a cell center lies inside a bedrock block
  pinned: Set<number>[] // undisturbed floating-island components (cell indices), kept aloft until shot
  bodies: DebrisBody[]
  water: readonly WaterBody[]
  staticBlocks: Block[] // cached greedy mesh of `mat`, recomputed on change
  regrow: Map<number, number> // wetted bare-earth cells → s left until they regrow grass (server-side only)
  burning: Map<number, number> // FIRE cells → s of burn left (spreads at the spread mark, spends to EARTH at 0)
}

const idx = (vt: { cols: number }, col: number, row: number): number => row * vt.cols + col
const centerX = (cell: number, col: number): number => col * cell + cell / 2
const centerY = (cell: number, row: number): number => row * cell + cell / 2

const pointInBlock = (b: Block, x: number, y: number): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

// Greedy-mesh a material grid into the fewest axis-aligned rectangles (one material each),
// offset into world space. Used for the static grid and, per chunk, for falling debris.
const meshGrid = (mat: Uint8Array, cols: number, rows: number, cell: number, ox: number, oy: number): Block[] => {
  const used = new Uint8Array(cols * rows)
  const blocks: Block[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = row * cols + col
      const m = mat[i]
      if (m === EMPTY || used[i]) continue
      let w = 1
      while (col + w < cols && mat[row * cols + col + w] === m && !used[row * cols + col + w]) w += 1
      let h = 1
      let extend = true
      while (row + h < rows && extend) {
        for (let k = 0; k < w; k += 1) {
          const j = (row + h) * cols + col + k
          if (mat[j] !== m || used[j]) {
            extend = false
            break
          }
        }
        if (extend) h += 1
      }
      for (let r = 0; r < h; r += 1) for (let k = 0; k < w; k += 1) used[(row + r) * cols + col + k] = 1
      blocks.push({
        x: ox + col * cell,
        y: oy + row * cell,
        w: w * cell,
        h: h * cell,
        structure: StructureType.EARTH,
        surface: SURFACE_OF[m],
      })
    }
  }
  return blocks
}

// Filled cells reachable (4-connected) from a seed predicate. Used both for grounding (seeds =
// bedrock/floor/pin) and for isolating loose components (seeds = a single cell).
const floodFilled = (vt: VoxelTerrain, seeds: Iterable<number>, into: Uint8Array): void => {
  const stack: number[] = []
  for (const s of seeds) {
    if (vt.mat[s] !== EMPTY && !into[s]) {
      into[s] = 1
      stack.push(s)
    }
  }
  while (stack.length > 0) {
    const i = stack.pop() as number
    const col = i % vt.cols
    const row = (i / vt.cols) | 0
    const neighbours = [
      col > 0 ? i - 1 : -1,
      col < vt.cols - 1 ? i + 1 : -1,
      row > 0 ? i - vt.cols : -1,
      row < vt.rows - 1 ? i + vt.cols : -1,
    ]
    for (const n of neighbours) {
      if (n >= 0 && vt.mat[n] !== EMPTY && !into[n]) {
        into[n] = 1
        stack.push(n)
      }
    }
  }
}

// Cells whose removal would break the "main static surface" link: a filled cell is a grounding
// seed when it neighbours bedrock or the floor, or belongs to a still-undisturbed pinned island.
const groundingSeeds = (vt: VoxelTerrain): number[] => {
  const seeds: number[] = []
  for (let row = 0; row < vt.rows; row += 1) {
    for (let col = 0; col < vt.cols; col += 1) {
      const i = idx(vt, col, row)
      if (vt.mat[i] === EMPTY) continue
      const onFloor = row === vt.rows - 1
      const touchesBedrock =
        vt.bedrockMask[i] === 1 ||
        (col > 0 && vt.bedrockMask[i - 1] === 1) ||
        (col < vt.cols - 1 && vt.bedrockMask[i + 1] === 1) ||
        (row > 0 && vt.bedrockMask[i - vt.cols] === 1) ||
        (row < vt.rows - 1 && vt.bedrockMask[i + vt.cols] === 1)
      if (onFloor || touchesBedrock) seeds.push(i)
    }
  }
  for (const pin of vt.pinned) for (const i of pin) if (vt.mat[i] !== EMPTY) seeds.push(i)
  return seeds
}

// After the grid changes, isolate every filled cell that is no longer grounded into a falling
// debris body (lifting it out of the static grid), then refresh the cached static mesh.
const reflowDebris = (vt: VoxelTerrain): void => {
  const anchored = new Uint8Array(vt.cols * vt.rows)
  floodFilled(vt, groundingSeeds(vt), anchored)

  const visited = new Uint8Array(vt.cols * vt.rows)
  for (let i = 0; i < vt.mat.length; i += 1) {
    if (vt.mat[i] === EMPTY || anchored[i] || visited[i]) continue
    // Grow the loose component from this cell.
    const component: number[] = []
    const stack = [i]
    visited[i] = 1
    while (stack.length > 0) {
      const j = stack.pop() as number
      component.push(j)
      const col = j % vt.cols
      const row = (j / vt.cols) | 0
      const neighbours = [
        col > 0 ? j - 1 : -1,
        col < vt.cols - 1 ? j + 1 : -1,
        row > 0 ? j - vt.cols : -1,
        row < vt.rows - 1 ? j + vt.cols : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && vt.mat[n] !== EMPTY && !anchored[n] && !visited[n]) {
          visited[n] = 1
          stack.push(n)
        }
      }
    }
    liftComponent(vt, component)
  }
  vt.staticBlocks = meshGrid(vt.mat, vt.cols, vt.rows, vt.cell, 0, 0)
}

// Lift a loose component out of the static grid into a new debris body (or, past the body cap,
// simply discard it so a barrage can't spawn unbounded chunks).
const liftComponent = (vt: VoxelTerrain, component: number[]): void => {
  let minCol = vt.cols
  let minRow = vt.rows
  let maxCol = 0
  let maxRow = 0
  for (const i of component) {
    const col = i % vt.cols
    const row = (i / vt.cols) | 0
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  const boxCols = maxCol - minCol + 1
  const boxRows = maxRow - minRow + 1
  const cells = new Uint8Array(boxCols * boxRows)
  for (const i of component) {
    const col = i % vt.cols
    const row = (i / vt.cols) | 0
    // The fall snuffs a flame: a burning cell rides into the chunk as plain scorched earth
    // (its timer entry, keyed to the static grid, is swept by the fire tick once mat empties).
    cells[(row - minRow) * boxCols + (col - minCol)] = vt.mat[i] === FIRE ? EARTH : vt.mat[i]
    vt.mat[i] = EMPTY
  }
  if (vt.bodies.length < DEBRIS_MAX_BODIES) {
    vt.bodies.push({ col0: minCol, row0: minRow, boxCols, boxRows, cells, vy: 0, fall: 0 })
  }
}

// Is the static field solid at a grid cell? Out of bounds counts as solid (walls/floor), as do
// bedrock and filled static cells — debris rests on all of them (but not on other debris).
const solidAt = (vt: VoxelTerrain, col: number, row: number): boolean => {
  if (row >= vt.rows || col < 0 || col >= vt.cols || row < 0) return true
  const i = idx(vt, col, row)
  return vt.bedrockMask[i] === 1 || vt.mat[i] !== EMPTY
}

// Can the body drop one whole cell without any of its bottom-edge cells entering a solid?
const canDescend = (vt: VoxelTerrain, body: DebrisBody): boolean => {
  for (let lr = 0; lr < body.boxRows; lr += 1) {
    for (let lc = 0; lc < body.boxCols; lc += 1) {
      if (body.cells[lr * body.boxCols + lc] === EMPTY) continue
      const belowLocal = lr + 1 < body.boxRows ? body.cells[(lr + 1) * body.boxCols + lc] : EMPTY
      if (belowLocal !== EMPTY) continue // another body cell supports this column internally
      if (solidAt(vt, body.col0 + lc, body.row0 + lr + 1)) return false
    }
  }
  return true
}

const stampBody = (vt: VoxelTerrain, body: DebrisBody): void => {
  for (let lr = 0; lr < body.boxRows; lr += 1) {
    for (let lc = 0; lc < body.boxCols; lc += 1) {
      const m = body.cells[lr * body.boxCols + lc]
      if (m === EMPTY) continue
      const col = body.col0 + lc
      const row = body.row0 + lr
      if (row >= 0 && row < vt.rows && col >= 0 && col < vt.cols) vt.mat[idx(vt, col, row)] = m
    }
  }
}

// Build the destructible terrain from the hand-authored arena: metal blocks become anchors,
// every earth block is rasterized into the cell grid by its surface, and each free-floating
// (non-grounded) island is recorded as a pinned component so it stays aloft until a shot disturbs it.
export const createVoxelTerrain = (blocks: Block[], water: WaterBody[]): VoxelTerrain => {
  const cell = VOXEL_CELL
  const cols = Math.ceil(WORLD_WIDTH / cell)
  const rows = Math.ceil(WORLD_HEIGHT / cell)
  const mat = new Uint8Array(cols * rows)
  const bedrockMask = new Uint8Array(cols * rows)
  const bedrock: Block[] = []

  // One pass over the authored blocks: METAL becomes an indestructible bedrock anchor (kept out of
  // the grid) AND is rasterized straight into bedrockMask; EARTH is voxelized into mat by surface.
  // Rasterizing each block's own cell range here is O(filled cells) — far cheaper than the old
  // O(cols*rows*|bedrock|) per-cell scan that dominated init cost on the larger grid.
  for (const block of blocks) {
    const c0 = Math.max(0, Math.floor(block.x / cell))
    const c1 = Math.min(cols - 1, Math.floor((block.x + block.w - 0.001) / cell))
    const r0 = Math.max(0, Math.floor(block.y / cell))
    const r1 = Math.min(rows - 1, Math.floor((block.y + block.h - 0.001) / cell))
    if (block.structure === StructureType.METAL) {
      bedrock.push(block)
      for (let row = r0; row <= r1; row += 1) {
        for (let col = c0; col <= c1; col += 1) {
          if (pointInBlock(block, centerX(cell, col), centerY(cell, row))) bedrockMask[row * cols + col] = 1
        }
      }
      continue
    }
    const id = ID_OF[block.surface]
    if (id === undefined) continue
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (pointInBlock(block, centerX(cell, col), centerY(cell, row))) mat[row * cols + col] = id
      }
    }
  }

  const vt: VoxelTerrain = {
    cols,
    rows,
    cell,
    mat,
    bedrock,
    bedrockMask,
    pinned: [],
    bodies: [],
    water,
    staticBlocks: [],
    regrow: new Map(),
    burning: new Map(),
  }

  // Anything not grounded at birth is an intentional floating island: pin its component so it
  // hovers. Carving the island later shrinks the pin to whatever main mass survives, so only the
  // fragments severed from that mass fall while the rest stays aloft (see carveVoxel).
  const anchored = new Uint8Array(cols * rows)
  floodFilled(vt, groundingSeeds(vt), anchored)
  const visited = new Uint8Array(cols * rows)
  for (let i = 0; i < mat.length; i += 1) {
    if (mat[i] === EMPTY || anchored[i] || visited[i]) continue
    const component = new Set<number>()
    const stack = [i]
    visited[i] = 1
    while (stack.length > 0) {
      const j = stack.pop() as number
      component.add(j)
      const col = j % cols
      const row = (j / cols) | 0
      const neighbours = [
        col > 0 ? j - 1 : -1,
        col < cols - 1 ? j + 1 : -1,
        row > 0 ? j - cols : -1,
        row < rows - 1 ? j + cols : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && mat[n] !== EMPTY && !visited[n]) {
          visited[n] = 1
          stack.push(n)
        }
      }
    }
    vt.pinned.push(component)
  }

  vt.staticBlocks = meshGrid(mat, cols, rows, cell, 0, 0)
  return vt
}

// Of a floating island's pin, the largest 4-connected sub-set of cells that are still filled: the
// island's surviving "main mass". When a carve splits an island, this becomes its new anchor, so
// the main body keeps hovering while severed minor fragments lose their pin and fall. Connectivity
// stays inside the pin (the magic anchor), but reflowDebris still re-grounds anything bridged to it
// by other terrain. Ties break on lowest cell index (top-left wins) to stay deterministic.
const largestPinComponent = (vt: VoxelTerrain, pin: Set<number>): Set<number> => {
  const seen = new Set<number>()
  let best = new Set<number>()
  let bestSeed = vt.cols * vt.rows
  for (const start of pin) {
    if (vt.mat[start] === EMPTY || seen.has(start)) continue
    const component = new Set<number>()
    let seed = start
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const j = stack.pop() as number
      component.add(j)
      if (j < seed) seed = j
      const col = j % vt.cols
      const row = (j / vt.cols) | 0
      const neighbours = [
        col > 0 ? j - 1 : -1,
        col < vt.cols - 1 ? j + 1 : -1,
        row > 0 ? j - vt.cols : -1,
        row < vt.rows - 1 ? j + vt.cols : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && pin.has(n) && vt.mat[n] !== EMPTY && !seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    if (component.size > best.size || (component.size === best.size && seed < bestSeed)) {
      best = component
      bestSeed = seed
    }
  }
  return best
}

// Carve a circular crater at (x, y). Removes covered destructible cells; if the crater bites into a
// floating island, that island is re-pinned to its largest surviving piece so the main mass keeps
// hovering while any fragment severed from it loses its anchor and drops. Re-flows whatever is left
// unsupported. Returns whether the terrain changed (so the caller can refresh derived blocks).
export const carveVoxel = (vt: VoxelTerrain, x: number, y: number, radius: number): boolean => {
  const r2 = radius * radius
  const c0 = Math.max(0, Math.floor((x - radius) / vt.cell))
  const c1 = Math.min(vt.cols - 1, Math.floor((x + radius) / vt.cell))
  const r0 = Math.max(0, Math.floor((y - radius) / vt.cell))
  const r1 = Math.min(vt.rows - 1, Math.floor((y + radius) / vt.cell))
  const removed: number[] = []
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = idx(vt, col, row)
      if (vt.mat[i] === EMPTY) continue
      const dx = centerX(vt.cell, col) - x
      const dy = centerY(vt.cell, row) - y
      if (dx * dx + dy * dy <= r2) {
        vt.mat[i] = EMPTY
        removed.push(i)
      }
    }
  }
  if (removed.length === 0) return false
  // A shot that bites a floating island shrinks its pin to the surviving main mass, so only the
  // pieces severed from that mass lose their anchor and fall — the rest keeps floating.
  if (vt.pinned.length > 0) {
    const nextPinned: Set<number>[] = []
    for (const pin of vt.pinned) {
      if (!removed.some((i) => pin.has(i))) {
        nextPinned.push(pin)
        continue
      }
      const mass = largestPinComponent(vt, pin)
      if (mass.size > 0) nextPinned.push(mass)
    }
    vt.pinned = nextPinned
  }
  reflowDebris(vt)
  return true
}

// Is the cell's covering open to the sky-side (nothing in the grid directly above)? Fire and
// regrowth both live on this exposed skin: buried grass neither catches nor regrows.
const exposedAbove = (vt: VoxelTerrain, i: number): boolean => i < vt.cols || vt.mat[i - vt.cols] === EMPTY

// Set the exposed GRASS surface ALIGHT inside a circle (flame gout). Structure is untouched
// (no carve): each caught cell turns FIRE and starts its burn clock — the fire tick in stepVoxel
// then creeps it to adjacent grass and eventually spends it to bare earth. Cancels any pending
// regrow on the caught cells. Re-meshes if anything caught. Returns whether the terrain changed
// (so the caller refreshes derived blocks).
export const igniteSurface = (vt: VoxelTerrain, x: number, y: number, radius: number): boolean => {
  const r2 = radius * radius
  const c0 = Math.max(0, Math.floor((x - radius) / vt.cell))
  const c1 = Math.min(vt.cols - 1, Math.floor((x + radius) / vt.cell))
  const r0 = Math.max(0, Math.floor((y - radius) / vt.cell))
  const r1 = Math.min(vt.rows - 1, Math.floor((y + radius) / vt.cell))
  let changed = false
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = idx(vt, col, row)
      if (vt.mat[i] !== GRASS || !exposedAbove(vt, i)) continue
      const dx = centerX(vt.cell, col) - x
      const dy = centerY(vt.cell, row) - y
      if (dx * dx + dy * dy > r2) continue
      vt.mat[i] = FIRE
      vt.burning.set(i, GRASS_BURN_TIME)
      vt.regrow.delete(i)
      changed = true
    }
  }
  if (changed) vt.staticBlocks = meshGrid(vt.mat, vt.cols, vt.rows, vt.cell, 0, 0)
  return changed
}

// Douse every burning cell inside a circle (water hit): the flame dies and the cell is GRASS
// again — it never finished burning. Re-meshes if anything was put out. Returns whether the
// terrain changed (so the caller refreshes derived blocks).
export const douseSurface = (vt: VoxelTerrain, x: number, y: number, radius: number): boolean => {
  const r2 = radius * radius
  const c0 = Math.max(0, Math.floor((x - radius) / vt.cell))
  const c1 = Math.min(vt.cols - 1, Math.floor((x + radius) / vt.cell))
  const r0 = Math.max(0, Math.floor((y - radius) / vt.cell))
  const r1 = Math.min(vt.rows - 1, Math.floor((y + radius) / vt.cell))
  let changed = false
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = idx(vt, col, row)
      if (vt.mat[i] !== FIRE) continue
      const dx = centerX(vt.cell, col) - x
      const dy = centerY(vt.cell, row) - y
      if (dx * dx + dy * dy > r2) continue
      vt.mat[i] = GRASS
      vt.burning.delete(i)
      changed = true
    }
  }
  if (changed) vt.staticBlocks = meshGrid(vt.mat, vt.cols, vt.rows, vt.cell, 0, 0)
  return changed
}

// Wet the exposed bare-EARTH surface inside a circle (water cannon): each qualifying top cell is
// queued to regrow grass after SURFACE_REGROW_TIME. No immediate grid change (grass appears later
// in stepVoxel), so this never re-meshes here. Returns whether any cell was newly wetted.
export const wetSurface = (vt: VoxelTerrain, x: number, y: number, radius: number): boolean => {
  const r2 = radius * radius
  const c0 = Math.max(0, Math.floor((x - radius) / vt.cell))
  const c1 = Math.min(vt.cols - 1, Math.floor((x + radius) / vt.cell))
  const r0 = Math.max(0, Math.floor((y - radius) / vt.cell))
  const r1 = Math.min(vt.rows - 1, Math.floor((y + radius) / vt.cell))
  let wetted = false
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = idx(vt, col, row)
      if (vt.mat[i] !== EARTH) continue
      if (!exposedAbove(vt, i)) continue // only the exposed top can regrow grass
      const dx = centerX(vt.cell, col) - x
      const dy = centerY(vt.cell, row) - y
      if (dx * dx + dy * dy > r2) continue
      vt.regrow.set(i, SURFACE_REGROW_TIME)
      wetted = true
    }
  }
  return wetted
}

// Find the cupped basin a water-cannon hit at (x, y) would pool into, as a WaterBody, or undefined
// if the impact isn't contained (open ground, a slope, or a basin wider/deeper than the search
// window). Deterministic and bounded to a POOL_HALF_WIDTH × (POOL_MAX_RISE + POOL_MAX_DEPTH) window:
// it reads the terrain surface row per column (metal anchors count as walls), takes the lower of
// the highest lip on each side as the spill level, and fills from there down to the basin floor.
// Each column is treated as a heightfield (its topmost solid), so overhangs/ceilings aren't modeled.
export const findPool = (vt: VoxelTerrain, x: number, y: number): WaterBody | undefined => {
  const hc = Math.floor(x / vt.cell)
  const hr = Math.floor(y / vt.cell)
  if (hc < 0 || hc >= vt.cols || hr < 0 || hr >= vt.rows) return undefined
  const c0 = Math.max(0, hc - POOL_HALF_WIDTH)
  const c1 = Math.min(vt.cols - 1, hc + POOL_HALF_WIDTH)
  const r0 = Math.max(0, hr - POOL_MAX_RISE)
  const r1 = Math.min(vt.rows - 1, hr + POOL_MAX_DEPTH)
  const span = c1 - c0 + 1

  // Terrain surface row per window column: the topmost solid cell (earth or metal) in [r0, r1],
  // or r1 + 1 when the column is empty all the way down (an open column — water would drain).
  const surf = new Int32Array(span)
  for (let c = c0; c <= c1; c += 1) {
    let s = r1 + 1
    for (let r = r0; r <= r1; r += 1) {
      if (solidAt(vt, c, r)) {
        s = r
        break
      }
    }
    surf[c - c0] = s
  }

  const hi = hc - c0
  const floorRow = surf[hi]
  if (floorRow > r1) return undefined // no floor under the hit within the window → drains

  // Highest lip (smallest row) reachable to each side (prefix / suffix minima of surf).
  const leftMin = new Int32Array(span)
  const rightMin = new Int32Array(span)
  leftMin[0] = surf[0]
  for (let i = 1; i < span; i += 1) leftMin[i] = Math.min(leftMin[i - 1], surf[i])
  rightMin[span - 1] = surf[span - 1]
  for (let i = span - 2; i >= 0; i -= 1) rightMin[i] = Math.min(rightMin[i + 1], surf[i])

  // Water rises to the lower of the two bounding lips; below that it would spill over.
  const surfaceRow = Math.max(leftMin[hi], rightMin[hi])
  if (surfaceRow >= floorRow) return undefined // hit sits at/above the rim line → not contained
  if (surfaceRow <= r0) return undefined // the spill rim rides the window top → basin too tall, treat as open

  // Pooled columns: the contiguous run around the hit whose floor lies below the spill surface.
  let left = hi
  while (left - 1 >= 0 && surf[left - 1] > surfaceRow) left -= 1
  let right = hi
  while (right + 1 < span && surf[right + 1] > surfaceRow) right += 1
  if (left === 0 || right === span - 1) return undefined // reaches the window edge → not contained
  if (right - left + 1 < POOL_MIN_WIDTH) return undefined

  let bottomRow = floorRow
  for (let i = left; i <= right; i += 1) if (surf[i] > bottomRow) bottomRow = surf[i]
  const px = (c0 + left) * vt.cell
  const pw = (right - left + 1) * vt.cell
  const py = surfaceRow * vt.cell
  const ph = (bottomRow - surfaceRow) * vt.cell
  return ph > 0 ? { x: px, y: py, w: pw, h: ph } : undefined
}

// Slide a bedrock anchor vertically to `newY` (a floating landing slab riding a rising pool):
// clears the anchor's old footprint from the grounding mask and rasterizes the new one. The
// caller re-meshes (the anchor's rect is emitted verbatim into the derived blocks). Assumes the
// anchor doesn't overlap other bedrock — true for the isolated pad slabs this exists for.
export const moveBedrock = (vt: VoxelTerrain, block: Block, newY: number): void => {
  const stamp = (b: Block, value: 0 | 1): void => {
    const c0 = Math.max(0, Math.floor(b.x / vt.cell))
    const c1 = Math.min(vt.cols - 1, Math.floor((b.x + b.w - 0.001) / vt.cell))
    const r0 = Math.max(0, Math.floor(b.y / vt.cell))
    const r1 = Math.min(vt.rows - 1, Math.floor((b.y + b.h - 0.001) / vt.cell))
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        if (pointInBlock(b, centerX(vt.cell, col), centerY(vt.cell, row))) vt.bedrockMask[row * vt.cols + col] = value
      }
    }
  }
  stamp(block, 0)
  block.y = newY
  stamp(block, 1)
}

// Advance falling debris one frame, tick wetted cells toward regrowing grass, and walk the
// grass fire (spread + burn-out); lands chunks back into the grid where they come to rest.
// Returns whether anything changed (so the caller refreshes derived blocks). Regrowth, fire,
// and debris settling all mutate the static grid; mesh once.
export const stepVoxel = (vt: VoxelTerrain, dt: number): boolean => {
  let changed = false
  let needsMesh = false

  // Wetted bare-earth cells regrow grass once their timer elapses (still bare + still exposed).
  if (vt.regrow.size > 0) {
    for (const [i, time] of vt.regrow) {
      const next = time - dt
      if (next > 0) {
        vt.regrow.set(i, next)
        continue
      }
      vt.regrow.delete(i)
      if (vt.mat[i] === EARTH && exposedAbove(vt, i)) {
        vt.mat[i] = GRASS
        needsMesh = true
        changed = true
      }
    }
  }

  // The fire walks: each burning cell creeps to its exposed grass neighbours once its clock
  // crosses the spread mark (a deterministic wavefront — no rng anywhere in the terrain), and
  // is spent to bare earth at zero. Cells the grid no longer owns as FIRE (carved away, doused,
  // or lifted into debris) just drop their stale timer. Fresh catches are collected and lit
  // AFTER the walk: a Map visits entries inserted mid-iteration, which would tick (and spread)
  // a newborn flame in the very frame it caught.
  if (vt.burning.size > 0) {
    const spreadMark = GRASS_BURN_TIME - GRASS_FIRE_SPREAD_AFTER
    const catches: number[] = []
    for (const [i, time] of vt.burning) {
      if (vt.mat[i] !== FIRE) {
        vt.burning.delete(i)
        continue
      }
      const next = time - dt
      if (time > spreadMark && next <= spreadMark) {
        const col = i % vt.cols
        const row = (i / vt.cols) | 0
        if (col > 0) catches.push(i - 1)
        if (col < vt.cols - 1) catches.push(i + 1)
        if (row > 0) catches.push(i - vt.cols)
        if (row < vt.rows - 1) catches.push(i + vt.cols)
      }
      if (next <= 0) {
        vt.burning.delete(i)
        vt.mat[i] = EARTH
        needsMesh = true
        changed = true
      } else {
        vt.burning.set(i, next)
      }
    }
    for (const i of catches) {
      if (vt.mat[i] !== GRASS || !exposedAbove(vt, i)) continue
      vt.mat[i] = FIRE
      vt.burning.set(i, GRASS_BURN_TIME)
      vt.regrow.delete(i)
      needsMesh = true
      changed = true
    }
  }

  const remaining: DebrisBody[] = []
  for (const body of vt.bodies) {
    body.vy = Math.min(DEBRIS_TERMINAL, body.vy + GRAVITY * dt)
    body.fall += body.vy * dt
    let settled = false
    while (body.fall >= vt.cell) {
      if (canDescend(vt, body)) {
        body.row0 += 1
        body.fall -= vt.cell
        changed = true
      } else {
        settled = true
        break
      }
    }
    if (settled) {
      stampBody(vt, body)
      needsMesh = true
      changed = true
    } else {
      remaining.push(body)
    }
  }
  vt.bodies = remaining

  if (needsMesh) vt.staticBlocks = meshGrid(vt.mat, vt.cols, vt.rows, vt.cell, 0, 0)
  return changed
}

// The full collision/render rectangle set: indestructible bedrock, the cached static mesh, and
// each falling chunk meshed at its current position.
export const voxelToBlocks = (vt: VoxelTerrain): Block[] => {
  const blocks: Block[] = [...vt.bedrock, ...vt.staticBlocks]
  for (const body of vt.bodies) {
    const ox = body.col0 * vt.cell
    const oy = body.row0 * vt.cell
    for (const block of meshGrid(body.cells, body.boxCols, body.boxRows, vt.cell, ox, oy)) blocks.push(block)
  }
  return blocks
}

export const hasDebris = (vt: VoxelTerrain): boolean => vt.bodies.length > 0

// ── Terrain persistence ───────────────────────────────────────────────────────
// The carved state of the grid as plain JSON, so a server can persist a room's terrain and
// rebuild it after a restart: the authored arena is reproduced from the room's SEED (the
// generator is seed-deterministic by design), and this snapshot overlays everything the seed
// can't know — craters (mat), the surviving floating-island pins, in-flight debris, and the
// wet-cells regrow clock. Bedrock anchors are NOT here: same seed → same anchors.

// Universal base64 for a cell grid (btoa/atob exist in both Bun and the browser; chunked so
// String.fromCharCode never sees a 225k-argument spread).
const encodeCells = (bytes: Uint8Array): string => {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}
const decodeCells = (data: string): Uint8Array => {
  const raw = atob(data)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export type VoxelSnapshot = {
  cols: number
  rows: number
  mat: string // base64 of the static grid
  pinned: number[][] // each pinned floating-island component's cell indices
  bodies: { col0: number; row0: number; boxCols: number; boxRows: number; cells: string; vy: number; fall: number }[]
  regrow: [number, number][] // wetted-cell index → s left until grass regrows
  burning?: [number, number][] // FIRE-cell index → s of burn left (absent in pre-fire snapshots)
}

export const snapshotVoxel = (vt: VoxelTerrain): VoxelSnapshot => ({
  cols: vt.cols,
  rows: vt.rows,
  mat: encodeCells(vt.mat),
  pinned: vt.pinned.map((component) => [...component]),
  bodies: vt.bodies.map((b) => ({
    col0: b.col0,
    row0: b.row0,
    boxCols: b.boxCols,
    boxRows: b.boxRows,
    cells: encodeCells(b.cells),
    vy: b.vy,
    fall: b.fall,
  })),
  regrow: [...vt.regrow],
  burning: [...vt.burning],
})

// Overlay a persisted snapshot onto a terrain rebuilt from the SAME seed. Returns false (and
// touches nothing) when the snapshot doesn't fit this grid — a stale or foreign snapshot must
// never corrupt a live arena. The caller re-derives world.blocks afterwards.
export const restoreVoxel = (vt: VoxelTerrain, snap: VoxelSnapshot): boolean => {
  if (snap.cols !== vt.cols || snap.rows !== vt.rows) return false
  const mat = decodeCells(snap.mat)
  if (mat.length !== vt.mat.length) return false
  vt.mat.set(mat)
  vt.pinned = snap.pinned.map((component) => new Set(component))
  vt.bodies = snap.bodies.map((b) => ({
    col0: b.col0,
    row0: b.row0,
    boxCols: b.boxCols,
    boxRows: b.boxRows,
    cells: decodeCells(b.cells),
    vy: b.vy,
    fall: b.fall,
  }))
  vt.regrow = new Map(snap.regrow)
  vt.burning = new Map(snap.burning ?? []) // pre-fire snapshots carry no burning map
  vt.staticBlocks = meshGrid(vt.mat, vt.cols, vt.rows, vt.cell, 0, 0)
  return true
}
