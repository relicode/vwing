import {
  BAND_SKY_BOTTOM,
  BASE_APRON_CELLS,
  BASE_BOT_X_FRAC,
  BASE_PAD_CELLS,
  BASE_PAD_Y_FRAC,
  BASE_PLAYER_X_FRAC,
  CAVE_MOUTH_CELLS,
  MAX_AUTHORED_WATER,
  PLATEAU_MIN_CELLS,
  SPAWN_ALTITUDE,
  SPAWN_ANCHOR_FRACS_X,
  SPAWN_ANCHOR_FRACS_Y,
  SPAWN_KEEPOUT_RADIUS,
  StructureType,
  Surface,
  VOXEL_CELL,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp } from '$/game/math'
import { randInt, randRange } from '$/game/rng'
import type { Block, Rng, Vec2, WaterBody } from '$/game/types'

// ── Procedural biome arena ───────────────────────────────────────────────────
// A deterministic, seeded generator (see createWorld: a salted sub-stream feeds this, so the same
// seed yields the same arena on server + client). Layout is BANDED so correctness is structural:
//   SKY  band (y < BAND_SKY_BOTTOM·H): open airspace — the deathmatch anchors live here, so they
//                                       are clear by construction; only floating islands stray in
//                                       (kept off the spawn discs).
//   MID  band: high mesas brushing the sky line + grasslands (grass-capped earth) + rock (taller
//              earth/ice + metal massifs) + caves + cliff-face shelves; the two flat home-base
//              pads are carved in with clamped approach aprons (campaign ships spawn above them).
//   LOW  band: a central sea + a few pools, each sitting in a real basin.
// Land is emitted as column runs that descend to the floor, so every permanent mass is 4-connected
// to the bedrock floor → grounded (the voxel grid never has to pin it). Only the small islands are
// intentionally ungrounded (auto-pinned aloft by createVoxelTerrain), and shelves butt against
// solid cliff faces (side-adjacent → grounded through them).

const make = (x: number, y: number, w: number, h: number, structure: StructureType, surface: Surface): Block => ({
  x,
  y,
  w,
  h,
  structure,
  surface,
})

// Which land biome a column slab carries. MESA is the tall third layer: bare-earth towers whose
// tops brush the bottom of the SKY band, turning the upper world into flyable canyon space.
enum Biome {
  GRASS = 'GRASS',
  ROCK = 'ROCK',
  MESA = 'MESA',
}

// The campaign home-base pad anchors (west = player, east = bot), shared with bases.ts/ship.ts.
export const basePadCenters = (): Vec2[] => [
  { x: WORLD_WIDTH * BASE_PLAYER_X_FRAC, y: WORLD_HEIGHT * BASE_PAD_Y_FRAC },
  { x: WORLD_WIDTH * BASE_BOT_X_FRAC, y: WORLD_HEIGHT * BASE_PAD_Y_FRAC },
]

// Every protected spawn point: the two campaign perches above their pads + the DM anchor grid.
export const spawnPoints = (): Vec2[] => [
  ...basePadCenters().map((p) => ({ x: p.x, y: p.y - SPAWN_ALTITUDE })),
  ...SPAWN_ANCHOR_FRACS_X.flatMap((fx) =>
    SPAWN_ANCHOR_FRACS_Y.map((fy) => ({ x: WORLD_WIDTH * fx, y: WORLD_HEIGHT * fy }))
  ),
]

export const createTerrain = (rng: Rng): { blocks: Block[]; water: WaterBody[] } => {
  const W = WORLD_WIDTH
  const H = WORLD_HEIGHT
  const t = WALL_THICKNESS
  const cell = VOXEL_CELL
  const floorY = H - t
  const blocks: Block[] = []
  const water: WaterBody[] = []
  const snap = (v: number): number => Math.round(v / cell) * cell

  const push = (x: number, y: number, w: number, h: number, structure: StructureType, surface: Surface): void => {
    if (w > 0 && h > 0) blocks.push(make(x, y, w, h, structure, surface))
  }
  const metal = (x: number, y: number, w: number, h: number): void =>
    push(x, y, w, h, StructureType.METAL, Surface.EARTH)
  const earth = (x: number, y: number, w: number, h: number): void =>
    push(x, y, w, h, StructureType.EARTH, Surface.EARTH)
  const cap = (x: number, y: number, w: number, surface: Surface): void =>
    push(x, y, w, cell, StructureType.EARTH, surface)

  // ── Bedrock border frame: walls a ship can't leave + the floor that grounds the flood-fill ──
  metal(0, 0, W, t)
  metal(0, floorY, W, t)
  metal(0, 0, t, H)
  metal(W - t, 0, t, H)

  // ── Protected spawn discs (computed before any terrain so nothing buries a spawn). The home
  // pads themselves are deliberate terrain beneath the campaign perches; discretionary features
  // (massifs, islands, shelves) still keep the full disc clear. ──
  const protectedPts: Vec2[] = spawnPoints()
  const nearSpawn = (x: number, y: number, pad: number): boolean =>
    protectedPts.some((p) => Math.hypot(p.x - x, p.y - y) < SPAWN_KEEPOUT_RADIUS + pad)

  // ── Bands (px) ──
  const skyBottom = snap(H * BAND_SKY_BOTTOM) // land tops never rise above this → SKY + spawns stay open
  const minTop = skyBottom + 2 * cell
  const maxTop = floorY - 4 * cell

  // ── Per-column ground surface across the play width (between the side walls) ──
  const x0 = t
  const cols = Math.floor((W - 2 * t) / cell)
  const colX = (c: number): number => x0 + c * cell
  const top = new Float64Array(cols) // surface y (px) per column — for a cave column, the ceiling top
  const surf: Surface[] = new Array(cols).fill(Surface.EARTH)
  const isCave = new Uint8Array(cols)
  const caveTop = new Float64Array(cols)
  const caveBot = new Float64Array(cols)

  // ── Column slabs, each a land biome: grasslands low, rock mid, mesas towering to the sky line ──
  type Slab = { c0: number; c1: number; biome: Biome }
  const nSlabs = randInt(rng, 9, 15)
  const slabs: Slab[] = []
  const rollBiome = (): Biome => {
    const r = rng()
    if (r < 0.4) return Biome.GRASS
    return r < 0.73 ? Biome.ROCK : Biome.MESA
  }
  for (let s = 0; s < nSlabs; s += 1) {
    const c0 = Math.floor((cols * s) / nSlabs)
    const c1 = s === nSlabs - 1 ? cols : Math.floor((cols * (s + 1)) / nSlabs)
    slabs.push({ c0, c1, biome: rollBiome() })
  }

  // Per-biome surface shaping: base height (fraction of H), step amplitude, and cap rolls.
  const BIOME_SHAPE: Record<Biome, { base: number; amp: number; ice: number; grass: boolean }> = {
    [Biome.GRASS]: { base: 0.58, amp: 0.045, ice: 0, grass: true },
    [Biome.ROCK]: { base: 0.46, amp: 0.1, ice: 0.14, grass: false },
    [Biome.MESA]: { base: 0.34, amp: 0.07, ice: 0.2, grass: false }, // tops clamp to the sky line
  }

  // Stepped surface per slab: flat runs (wide patrol ledges) at biome-dependent heights, grounded
  // by reaching the floor. Grass sits lower + gentler, rock higher + jaggeder with the odd ice cap,
  // mesas tower into clamped flat-topped buttes.
  for (const slab of slabs) {
    const shape = BIOME_SHAPE[slab.biome]
    const base = H * shape.base
    const amp = H * shape.amp
    let h = base + randRange(rng, -amp * 0.4, amp * 0.4)
    let c = slab.c0
    while (c < slab.c1) {
      const runW = randInt(rng, PLATEAU_MIN_CELLS, PLATEAU_MIN_CELLS * 2 + 1)
      const end = Math.min(slab.c1, c + runW)
      h = clamp(h + randRange(rng, -amp, amp), minTop, maxTop)
      const ty = snap(h)
      const surface = shape.grass ? Surface.GRASS : rng() < shape.ice ? Surface.ICE : Surface.EARTH
      for (let k = c; k < end; k += 1) {
        top[k] = ty
        surf[k] = surface
      }
      c = end
    }
  }

  // Columns claimed by a water basin, a cave, or a home pad. A later pass must not dig/overwrite
  // these — doing so would drop the ground out from under an already-emitted water body (leaving it
  // hanging in air), plant solid mass inside the open cave, or deform a base pad. Every basin/cave/
  // pad reserves its span here first.
  const claimed = new Uint8Array(cols)
  const padApron = new Uint8Array(cols) // pad + apron columns: discretionary mass (massifs/shelves) keeps out

  // ── Home-base pads: a flat grass shelf per side at the shared pad level, with aprons either side
  // where land is clamped DOWN to pad level — so the approach (and the spawn perch 320 px up) is
  // open by construction even though the pad sits inside the terrain band. ──
  const padY = snap(H * BASE_PAD_Y_FRAC)
  for (const pad of basePadCenters()) {
    const center = Math.round((pad.x - x0) / cell)
    const half = Math.floor(BASE_PAD_CELLS / 2)
    for (
      let k = Math.max(0, center - half - BASE_APRON_CELLS);
      k < Math.min(cols, center + half + BASE_APRON_CELLS);
      k += 1
    ) {
      padApron[k] = 1
      if (k >= center - half && k < center + half) {
        top[k] = padY
        surf[k] = Surface.GRASS
        claimed[k] = 1
      } else if (top[k] < padY) {
        top[k] = padY // apron: nothing rises above the pad (clamp toward the floor = larger y)
      }
    }
  }

  // ── A central sea in a real basin: drop the middle columns to a deep floor; the higher land on
  // either side forms the containing lips, and the water fills to a spill level below them. ──
  const seaC0 = Math.floor(cols * 0.34)
  const seaC1 = Math.floor(cols * 0.66)
  const seaSpill = snap(H * 0.74)
  const seaFloor = snap(H * 0.9)
  for (let c = seaC0; c < seaC1; c += 1) {
    top[c] = seaFloor
    surf[c] = Surface.EARTH
    claimed[c] = 1
  }
  water.push({ x: colX(seaC0), y: seaSpill, w: (seaC1 - seaC0) * cell, h: seaFloor - seaSpill })

  // ── Caves (up to two): an alcove tunnelled into a tall rock/mesa mountain, open to the flyway on
  // its left so it can never be sealed. A thick rock ceiling overhangs a chamber whose floor
  // continues out to a low approach ledge; a ship flies in horizontally through the mouth. Built
  // before the pools, clear of the sea and the pads, then claimed, so nothing later digs into it
  // (and it digs into nothing). ──
  const clearOfSea = (s: Slab): boolean => s.c1 <= seaC0 || s.c0 >= seaC1
  const caveReady = slabs.filter((s) => s.c1 - s.c0 >= CAVE_MOUTH_CELLS + 10 && clearOfSea(s))
  const tall = caveReady.filter((s) => s.biome !== Biome.GRASS)
  const caveSlabs = [...tall, ...caveReady.filter((s) => s.biome === Biome.GRASS)].slice(0, 2)
  for (const caveSlab of caveSlabs) {
    const chC1 = caveSlab.c1 - 2 // leave a solid right-hand back wall
    const chC0 = chC1 - randInt(rng, 6, 10)
    const mouthC0 = chC0 - CAVE_MOUTH_CELLS
    if (mouthC0 <= caveSlab.c0) continue
    let blocked = false
    for (let c = mouthC0; c < chC1; c += 1) if (claimed[c] || padApron[c]) blocked = true
    if (blocked) continue // never tunnel through a pad, the sea, or another cave
    const ceilTop = snap(H * 0.5) // tall mountain surface (the overhang's top)
    const chamberTop = snap(H * 0.57)
    const chamberBot = chamberTop + randInt(rng, 4, 6) * cell
    for (let c = mouthC0; c < chC0; c += 1) {
      top[c] = chamberBot // open approach ledge at the chamber-floor level (the mouth)
      surf[c] = Surface.EARTH
      claimed[c] = 1
    }
    for (let c = chC0; c < chC1; c += 1) {
      isCave[c] = 1
      top[c] = ceilTop
      caveTop[c] = chamberTop
      caveBot[c] = chamberBot
      surf[c] = Surface.EARTH
      claimed[c] = 1
    }
  }

  // ── A couple of perched pools: dig a basin into an UNCLAIMED land span, lips on both sides. ──
  const addPoolBasin = (pc0: number, pc1: number): void => {
    if (water.length >= MAX_AUTHORED_WATER || pc1 - pc0 < 6) return
    for (let c = pc0; c < pc1; c += 1) if (claimed[c]) return // never overlap the sea / cave / another pool
    const rim = Math.max(top[pc0], top[pc1 - 1]) // lower lip (larger y) = where water would spill
    const poolFloor = snap(rim + randInt(rng, 3, 6) * cell)
    if (poolFloor >= maxTop) return
    for (let c = pc0; c < pc1; c += 1) claimed[c] = 1
    for (let c = pc0 + 1; c < pc1 - 1; c += 1) {
      top[c] = poolFloor
      surf[c] = Surface.EARTH
    }
    const surfaceY = rim + cell // just under the lower lip → contained
    water.push({ x: colX(pc0 + 1), y: surfaceY, w: (pc1 - 1 - (pc0 + 1)) * cell, h: poolFloor - surfaceY })
  }
  for (let i = 0; i < randInt(rng, 2, 5); i += 1) {
    const pw = randInt(rng, 8, 16)
    const pc0 = randInt(rng, 4, Math.max(5, cols - pw - 4))
    addPoolBasin(pc0, pc0 + pw)
  }

  // ── Emit land as merged column runs (greedy-meshes cleanly). A cave column emits a ceiling + a
  // floor with the chamber empty between; a normal column a solid body + a surface cap. ──
  let c = 0
  while (c < cols) {
    if (isCave[c]) {
      let e = c
      while (e < cols && isCave[e] && top[e] === top[c] && caveTop[e] === caveTop[c] && caveBot[e] === caveBot[c]) {
        e += 1
      }
      const x = colX(c)
      const w = (e - c) * cell
      earth(x, top[c], w, caveTop[c] - top[c]) // overhang ceiling
      earth(x, caveBot[c], w, floorY - caveBot[c]) // chamber floor (grounded)
      c = e
      continue
    }
    let e = c
    while (e < cols && !isCave[e] && top[e] === top[c] && surf[e] === surf[c]) e += 1
    const x = colX(c)
    const w = (e - c) * cell
    earth(x, top[c], w, floorY - top[c]) // solid body to the floor → grounded
    if (surf[c] !== Surface.EARTH) cap(x, top[c], w, surf[c]) // grass/ice cap (last write wins over the body)
    c = e
  }

  // ── Cliff-face shelves: short landable ledges jutting from tall steps between surface runs,
  // a few cells below the high side's lip. Side-adjacent to solid column mass → grounded through
  // it. Multi-level patrol/drop real estate over rock and mesa country. ──
  let shelves = 0
  for (let b = 1; b < cols - 1 && shelves < 14; b += 1) {
    if (top[b - 1] === top[b]) continue // not a step boundary
    const highTop = Math.min(top[b - 1], top[b])
    const lowTop = Math.max(top[b - 1], top[b])
    if (lowTop - highTop < 6 * cell) continue // cliff too short to shelve
    if (rng() >= 0.5) continue
    const toRight = top[b] > top[b - 1] // the drop falls to the right → shelf juts rightward
    const sw = randInt(rng, 6, 10)
    const sy = highTop + randInt(rng, 2, 4) * cell
    if (sy + 2 * cell >= lowTop) continue // must hang clear above the lower ground
    const s0 = toRight ? b : b - sw
    const s1 = s0 + sw
    if (s0 < 1 || s1 > cols - 1) continue
    let blocked = false
    for (let k = s0; k < s1; k += 1) {
      if (claimed[k] || padApron[k] || isCave[k] || top[k] <= sy + 2 * cell) blocked = true // keep real clearance
    }
    if (blocked) continue
    const sx = colX(s0)
    if (nearSpawn(sx + (sw * cell) / 2, sy, sw * cell)) continue
    earth(sx, sy, sw * cell, 2 * cell)
    cap(sx, sy, sw * cell, rng() < 0.5 ? Surface.GRASS : Surface.EARTH)
    shelves += 1
    b += sw // don't immediately stack another shelf on the same face
  }

  // ── A few metal massifs: indestructible rock landmarks + hard cover, seated on the floor. ──
  for (const slab of slabs) {
    if (slab.biome === Biome.GRASS || rng() < 0.5 || slab.c1 - slab.c0 < 8) continue
    const mc0 = randInt(rng, slab.c0 + 1, slab.c1 - 5)
    const mw = randInt(rng, 3, 6)
    let blocked = false
    for (let k = mc0; k < mc0 + mw; k += 1) {
      if (claimed[k] || padApron[k]) blocked = true // don't wall up a cave/basin or crowd a pad approach
    }
    if (blocked) continue
    const mx = colX(mc0)
    if (nearSpawn(mx + (mw * cell) / 2, top[mc0], mw * cell)) continue
    const mTop = clamp(snap(top[mc0] - randInt(rng, 2, 5) * cell), minTop, maxTop)
    metal(mx, mTop, mw * cell, floorY - mTop)
    cap(mx, mTop - cell, mw * cell, Surface.EARTH) // a landable earth ledge skinning the metal core
  }

  // ── Floating islands (the only ungrounded earth — auto-pinned aloft), kept off the spawn discs.
  // The smaller sky is busier: more of them, starting higher. ──
  for (let i = 0; i < randInt(rng, 4, 8); i += 1) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const iw = randInt(rng, 12, 26) * cell
      const ih = randInt(rng, 4, 7) * cell
      const ix = snap(randRange(rng, x0 + 4 * cell, W - t - iw - 4 * cell))
      const iy = snap(randRange(rng, H * 0.06, skyBottom - ih - 2 * cell))
      if (nearSpawn(ix + iw / 2, iy + ih / 2, Math.max(iw, ih))) continue
      earth(ix, iy, iw, ih)
      cap(ix, iy, iw, rng() < 0.5 ? Surface.GRASS : Surface.ICE)
      break
    }
  }

  return { blocks, water }
}
