import {
  DEBRIS_MAX_BODIES,
  DEBRIS_TERMINAL,
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
import { createTerrain } from '$/game/terrain-map'
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

const SURFACE_OF: Record<number, Surface> = {
  [EARTH]: Surface.EARTH,
  [GRASS]: Surface.GRASS,
  [ICE]: Surface.ICE,
}
const ID_OF: Partial<Record<Surface, number>> = {
  [Surface.EARTH]: EARTH,
  [Surface.GRASS]: GRASS,
  [Surface.ICE]: ICE,
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
    cells[(row - minRow) * boxCols + (col - minCol)] = vt.mat[i]
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
export const createVoxelTerrain = (): VoxelTerrain => {
  const { blocks, water } = createTerrain()
  const cell = VOXEL_CELL
  const cols = Math.ceil(WORLD_WIDTH / cell)
  const rows = Math.ceil(WORLD_HEIGHT / cell)
  const mat = new Uint8Array(cols * rows)
  const bedrockMask = new Uint8Array(cols * rows)
  const bedrock: Block[] = []

  for (const block of blocks) {
    if (block.structure === StructureType.METAL) {
      bedrock.push(block)
      continue
    }
    const id = ID_OF[block.surface]
    if (id === undefined) continue
    const c0 = Math.max(0, Math.floor(block.x / cell))
    const c1 = Math.min(cols - 1, Math.floor((block.x + block.w - 0.001) / cell))
    const r0 = Math.max(0, Math.floor(block.y / cell))
    const r1 = Math.min(rows - 1, Math.floor((block.y + block.h - 0.001) / cell))
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
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = centerX(cell, col)
      const y = centerY(cell, row)
      if (bedrock.some((b) => pointInBlock(b, x, y))) bedrockMask[row * cols + col] = 1
    }
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

// Scorch the GRASS surface to bare EARTH inside a circle (incendiary). Structure is untouched
// (no carve); cancels any pending regrow on the burned cells. Re-meshes if anything changed.
// Returns whether the terrain changed (so the caller refreshes derived blocks).
export const burnSurface = (vt: VoxelTerrain, x: number, y: number, radius: number): boolean => {
  const r2 = radius * radius
  const c0 = Math.max(0, Math.floor((x - radius) / vt.cell))
  const c1 = Math.min(vt.cols - 1, Math.floor((x + radius) / vt.cell))
  const r0 = Math.max(0, Math.floor((y - radius) / vt.cell))
  const r1 = Math.min(vt.rows - 1, Math.floor((y + radius) / vt.cell))
  let changed = false
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = idx(vt, col, row)
      if (vt.mat[i] !== GRASS) continue
      const dx = centerX(vt.cell, col) - x
      const dy = centerY(vt.cell, row) - y
      if (dx * dx + dy * dy > r2) continue
      vt.mat[i] = EARTH
      vt.regrow.delete(i)
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
      if (row > 0 && vt.mat[i - vt.cols] !== EMPTY) continue // only the exposed top can regrow grass
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

// Advance falling debris one frame and tick wetted cells toward regrowing grass; lands chunks
// back into the grid where they come to rest. Returns whether anything changed (so the caller
// refreshes derived blocks). Both regrowth and debris settling mutate the static grid; mesh once.
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
      if (vt.mat[i] === EARTH && (i < vt.cols || vt.mat[i - vt.cols] === EMPTY)) {
        vt.mat[i] = GRASS
        needsMesh = true
        changed = true
      }
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
