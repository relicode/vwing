import {
  BAND_SKY_BOTTOM,
  BOT_SPAWN_OFFSET_PX,
  CAVE_MOUTH_CELLS,
  MAX_AUTHORED_WATER,
  PLATEAU_MIN_CELLS,
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
//   SKY  band (y < BAND_SKY_BOTTOM·H): open airspace — every spawn lives here, so spawns are clear
//                                       by construction; only floating islands stray in (kept off
//                                       the spawn discs).
//   MID  band: grasslands (grass-capped earth) + rock (taller earth/ice + metal massifs) + a cave.
//   LOW  band: a central sea + a couple of pools, each sitting in a real basin.
// Land is emitted as column runs that descend to the floor, so every permanent mass is 4-connected
// to the bedrock floor → grounded (the voxel grid never has to pin it). Only the small islands are
// intentionally ungrounded (auto-pinned aloft by createVoxelTerrain).

const make = (x: number, y: number, w: number, h: number, structure: StructureType, surface: Surface): Block => ({
  x,
  y,
  w,
  h,
  structure,
  surface,
})

// Which land biome a column slab carries.
enum Biome {
  GRASS = 'GRASS',
  ROCK = 'ROCK',
}

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

  // ── Protected spawn discs (computed before any terrain so nothing buries a spawn) ──
  const playerX = W / 2
  const protectedPts: Vec2[] = [
    { x: playerX, y: H * 0.4 },
    { x: playerX + BOT_SPAWN_OFFSET_PX, y: H * 0.4 },
    ...[0.18, 0.34, 0.5, 0.66, 0.82].flatMap((fx) => [0.22, 0.4].map((fy) => ({ x: W * fx, y: H * fy }))),
  ]
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

  // ── Column slabs, each a land biome ──
  type Slab = { c0: number; c1: number; biome: Biome }
  const nSlabs = randInt(rng, 6, 10)
  const slabs: Slab[] = []
  for (let s = 0; s < nSlabs; s += 1) {
    const c0 = Math.floor((cols * s) / nSlabs)
    const c1 = s === nSlabs - 1 ? cols : Math.floor((cols * (s + 1)) / nSlabs)
    slabs.push({ c0, c1, biome: rng() < 0.55 ? Biome.GRASS : Biome.ROCK })
  }

  // Stepped surface per slab: flat runs (wide patrol ledges) at biome-dependent heights, grounded
  // by reaching the floor. Grass sits lower + gentler, rock higher + jaggeder with the odd ice cap.
  for (const slab of slabs) {
    const rock = slab.biome === Biome.ROCK
    const base = H * (rock ? 0.5 : 0.6)
    const amp = H * (rock ? 0.09 : 0.045)
    let h = base + randRange(rng, -amp * 0.4, amp * 0.4)
    let c = slab.c0
    while (c < slab.c1) {
      const runW = randInt(rng, PLATEAU_MIN_CELLS, PLATEAU_MIN_CELLS * 2 + 1)
      const end = Math.min(slab.c1, c + runW)
      h = clamp(h + randRange(rng, -amp, amp), minTop, maxTop)
      const ty = snap(h)
      const surface = rock ? (rng() < 0.14 ? Surface.ICE : Surface.EARTH) : Surface.GRASS
      for (let k = c; k < end; k += 1) {
        top[k] = ty
        surf[k] = surface
      }
      c = end
    }
  }

  // Columns claimed by a water basin or the cave. A later pass must not dig/overwrite these — doing
  // so would drop the ground out from under an already-emitted water body (leaving it hanging in air)
  // or plant solid mass inside the open cave. Every basin/cave reserves its span here first.
  const claimed = new Uint8Array(cols)

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

  // ── One cave: an alcove tunnelled into a tall rock mountain, open to the flyway on its left so it
  // can never be sealed. A thick rock ceiling overhangs a chamber whose floor continues out to a low
  // approach ledge; a ship flies in horizontally through the mouth. Built before the pools and clear
  // of the sea, then claimed, so nothing later digs into it (and it digs into nothing). ──
  const clearOfSea = (s: Slab): boolean => s.c1 <= seaC0 || s.c0 >= seaC1
  const caveReady = slabs.filter((s) => s.c1 - s.c0 >= CAVE_MOUTH_CELLS + 10 && clearOfSea(s))
  const caveSlab = caveReady.find((s) => s.biome === Biome.ROCK) ?? caveReady[0]
  if (caveSlab) {
    const chC1 = caveSlab.c1 - 2 // leave a solid right-hand back wall
    const chC0 = chC1 - randInt(rng, 6, 10)
    const mouthC0 = chC0 - CAVE_MOUTH_CELLS
    if (mouthC0 > caveSlab.c0) {
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
  for (let i = 0; i < randInt(rng, 1, 3); i += 1) {
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

  // ── A metal massif or two: indestructible rock landmarks + hard cover, seated on the floor. ──
  for (const slab of slabs) {
    if (slab.biome !== Biome.ROCK || rng() < 0.5 || slab.c1 - slab.c0 < 8) continue
    const mc0 = randInt(rng, slab.c0 + 1, slab.c1 - 5)
    const mw = randInt(rng, 3, 6)
    let blocked = false
    for (let k = mc0; k < mc0 + mw; k += 1) if (claimed[k]) blocked = true // don't wall up the cave / fill a basin
    if (blocked) continue
    const mx = colX(mc0)
    if (nearSpawn(mx + (mw * cell) / 2, top[mc0], mw * cell)) continue
    const mTop = clamp(snap(top[mc0] - randInt(rng, 2, 5) * cell), minTop, maxTop)
    metal(mx, mTop, mw * cell, floorY - mTop)
    cap(mx, mTop - cell, mw * cell, Surface.EARTH) // a landable earth ledge skinning the metal core
  }

  // ── Floating islands (the only ungrounded earth — auto-pinned aloft), kept off the spawn discs. ──
  for (let i = 0; i < randInt(rng, 2, 5); i += 1) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const iw = randInt(rng, 12, 26) * cell
      const ih = randInt(rng, 4, 7) * cell
      const ix = snap(randRange(rng, x0 + 4 * cell, W - t - iw - 4 * cell))
      const iy = snap(randRange(rng, H * 0.12, skyBottom - ih - 2 * cell))
      if (nearSpawn(ix + iw / 2, iy + ih / 2, Math.max(iw, ih))) continue
      earth(ix, iy, iw, ih)
      cap(ix, iy, iw, rng() < 0.5 ? Surface.GRASS : Surface.ICE)
      break
    }
  }

  return { blocks, water }
}
