// Build-time procedural artwork for the PWA: app icons and the og:image share the game's
// own visual language — the unit-space hull dart from ships-view.ts, the dark-neon palette
// from constants.ts/theme.ts, starfield, and a voxel skyline. Everything is rasterized here
// with signed-distance fields onto RGBA buffers (encoded by png.ts), so the bake needs no
// native image dependency and stays deterministic (seeded rng, fixed flame frame).

import { encodePng } from './png'

type Vec2 = readonly [number, number]
type Rgb = readonly [number, number, number]

// Palette (Color.* in src/game/constants.ts + the MUI theme).
const BG: Rgb = [0x04 / 255, 0x06 / 255, 0x0c / 255]
const BG_HIGH: Rgb = [0x0a / 255, 0x12 / 255, 0x2a / 255]
const HULL: Rgb = [0x8f / 255, 0xe3 / 255, 0xff / 255]
const ENEMY: Rgb = [0xff / 255, 0x6b / 255, 0x8b / 255]
const CORE: Rgb = [1, 1, 1]
const THRUST: Rgb = [1, 0xb3 / 255, 0x47 / 255]
const STAR_NEAR: Rgb = [0x9f / 255, 0xb4 / 255, 0xff / 255]
const TERRAIN: Rgb = [0x09 / 255, 0x14 / 255, 0x12 / 255]
const TERRAIN_EDGE: Rgb = [0x33 / 255, 0xf5 / 255, 0xa3 / 255]

// The ship in unit space (radius 1, nose along +x) — the exact polygons the renderer draws.
const WING_SPREAD = 2.4
const HULL_POLY: Vec2[] = [
  [Math.cos(0) * 1.5, Math.sin(0) * 1.5],
  [Math.cos(WING_SPREAD), Math.sin(WING_SPREAD)],
  [Math.cos(-WING_SPREAD), Math.sin(-WING_SPREAD)],
]
const FLAME_POLY: Vec2[] = [
  [Math.cos(WING_SPREAD) * 0.7, Math.sin(WING_SPREAD) * 0.7],
  [Math.cos(-WING_SPREAD) * 0.7, Math.sin(-WING_SPREAD) * 0.7],
  [-(1.1 + 0.88), 0], // thrustContext frame k=1
]
const CORE_RADIUS = 0.34

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const add = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + b[0] * t, a[1] + b[1] * t, a[2] + b[2] * t]

// Signed distance to a polygon (negative inside) — the classic edge-walk with winding parity.
const sdPolygon = (poly: readonly Vec2[], x: number, y: number): number => {
  let dist = (x - poly[0][0]) ** 2 + (y - poly[0][1]) ** 2
  let sign = 1
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ix, iy] = poly[i]
    const [jx, jy] = poly[j]
    const ex = jx - ix
    const ey = jy - iy
    const wx = x - ix
    const wy = y - iy
    const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey))
    dist = Math.min(dist, (wx - ex * t) ** 2 + (wy - ey * t) ** 2)
    const c1 = y >= iy
    const c2 = y < jy
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign
  }
  return sign * Math.sqrt(dist)
}

const sdSegment = (a: Vec2, b: Vec2, x: number, y: number): number => {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const wx = x - a[0]
  const wy = y - a[1]
  const t = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey || 1))
  return Math.hypot(wx - ex * t, wy - ey * t)
}

// Mulberry32 — local copy so the build scripts stay decoupled from src/game/rng.ts.
const makeRng = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A ship instance placed in raster space: center, pixel radius, nose direction in radians
// (raster y grows downward, so -PI/2 points the nose up).
type ShipPose = { cx: number; cy: number; radius: number; angle: number; hull: Rgb }

type PlacedShip = { hull: Vec2[]; flame: Vec2[]; core: Vec2; pose: ShipPose }

const placeShip = (pose: ShipPose): PlacedShip => {
  const cos = Math.cos(pose.angle)
  const sin = Math.sin(pose.angle)
  const transform = (points: readonly Vec2[]): Vec2[] =>
    points.map(([sx, sy]) => [
      pose.cx + pose.radius * (sx * cos - sy * sin),
      pose.cy + pose.radius * (sx * sin + sy * cos),
    ])
  return { hull: transform(HULL_POLY), flame: transform(FLAME_POLY), core: [pose.cx, pose.cy], pose }
}

// Composite one ship onto a sample: additive neon glow, then anti-aliased fills.
const shadeShip = (ship: PlacedShip, x: number, y: number, color: Rgb): Rgb => {
  let out = color
  const glowR = ship.pose.radius * 0.45
  const dFlame = sdPolygon(ship.flame, x, y)
  out = add(out, THRUST, 0.55 * Math.exp(-Math.max(dFlame, 0) / (glowR * 0.7)))
  out = mix(out, THRUST, 0.9 * clamp01(0.5 - dFlame))
  const dHull = sdPolygon(ship.hull, x, y)
  out = add(out, ship.pose.hull, 0.5 * Math.exp(-Math.max(dHull, 0) / glowR))
  out = mix(out, ship.pose.hull, clamp01(0.5 - dHull))
  const dCore = Math.hypot(x - ship.core[0], y - ship.core[1]) - CORE_RADIUS * ship.pose.radius
  out = mix(out, CORE, clamp01(0.5 - dCore))
  return out
}

// Starfield + vertical glow gradient, rendered once per pixel (soft dots need no supersampling).
const paintBase = (width: number, height: number, stars: number, seed: number): Float32Array => {
  const rng = makeRng(seed)
  const dots = Array.from({ length: stars }, () => ({
    x: rng() * width,
    y: rng() * height,
    r: 0.6 + rng() * 1.6,
    glow: 0.25 + rng() * 0.75,
  }))
  const base = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lift = (1 - Math.hypot(x - width / 2, y - height * 0.42) / Math.hypot(width / 2, height)) ** 2
      let color: Rgb = mix(BG, BG_HIGH, lift)
      for (const dot of dots) {
        const d = Math.hypot(x - dot.x, y - dot.y) - dot.r
        if (d < 4) color = add(color, STAR_NEAR, dot.glow * clamp01(1 - d / 2.5))
      }
      base.set(color, (y * width + x) * 3)
    }
  }
  return base
}

// Squared techno letterforms (polyline strokes in a 0..1 glyph box, y down) — straight
// segments only, in the spirit of Orbitron. Width is the per-glyph advance.
const GLYPHS: Record<string, { width: number; strokes: Vec2[][] }> = {
  V: {
    width: 1,
    strokes: [
      [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ],
    ],
  },
  '-': {
    width: 0.7,
    strokes: [
      [
        [0.15, 0.5],
        [0.55, 0.5],
      ],
    ],
  },
  W: {
    width: 1.2,
    strokes: [
      [
        [0, 0],
        [0.3, 1],
        [0.6, 0.3],
        [0.9, 1],
        [1.2, 0],
      ],
    ],
  },
  I: {
    width: 0.3,
    strokes: [
      [
        [0.15, 0],
        [0.15, 1],
      ],
    ],
  },
  N: {
    width: 1,
    strokes: [
      [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ],
    ],
  },
  G: {
    width: 1,
    strokes: [
      [
        [1, 0.22],
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0.55],
        [0.55, 0.55],
      ],
    ],
  },
}

type Title = { strokes: Vec2[][]; thickness: number }

// Lay out text centered at (cx, cy) with glyph boxes `size` tall, returning raster-space strokes.
const layoutTitle = (text: string, cx: number, cy: number, size: number): Title => {
  const gap = 0.32
  const glyphs = [...text].map((ch) => {
    const glyph = GLYPHS[ch]
    if (!glyph) throw new Error(`layoutTitle: no glyph for ${JSON.stringify(ch)}`)
    return glyph
  })
  const total = glyphs.reduce((sum, g) => sum + g.width + gap, -gap) * size
  let penX = cx - total / 2
  const strokes: Vec2[][] = []
  for (const glyph of glyphs) {
    for (const stroke of glyph.strokes) {
      strokes.push(stroke.map(([gx, gy]): Vec2 => [penX + gx * size, cy - size / 2 + gy * size]))
    }
    penX += (glyph.width + gap) * size
  }
  return { strokes, thickness: size * 0.13 }
}

const shadeTitle = (title: Title, x: number, y: number, color: Rgb): Rgb => {
  let d = Number.POSITIVE_INFINITY
  for (const stroke of title.strokes) {
    for (let i = 0; i < stroke.length - 1; i += 1) d = Math.min(d, sdSegment(stroke[i], stroke[i + 1], x, y))
  }
  d -= title.thickness
  let out = add(color, HULL, 0.45 * Math.exp(-Math.max(d, 0) / (title.thickness * 2.4)))
  out = mix(out, HULL, clamp01(0.5 - d))
  return out
}

// Render shapes over the base with 2x2 supersampling and pack to 8-bit RGBA.
const composite = (
  width: number,
  height: number,
  base: Float32Array,
  shade: (x: number, y: number, color: Rgb) => Rgb
): Uint8Array => {
  const offsets = [0.25, 0.75]
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const pixel: Rgb = [base[index * 3], base[index * 3 + 1], base[index * 3 + 2]]
      let r = 0
      let g = 0
      let b = 0
      for (const oy of offsets) {
        for (const ox of offsets) {
          const [sr, sg, sb] = shade(x + ox, y + oy, pixel)
          r += sr
          g += sg
          b += sb
        }
      }
      out[index * 4] = Math.round(clamp01(r / 4) * 255)
      out[index * 4 + 1] = Math.round(clamp01(g / 4) * 255)
      out[index * 4 + 2] = Math.round(clamp01(b / 4) * 255)
      out[index * 4 + 3] = 255
    }
  }
  return out
}

// App icon: the player ship climbing nose-up on a starfield. `maskable` shrinks the art
// into the safe zone (inner 80% circle) so platform masks never clip the wings.
export const renderIcon = (size: number, options?: { maskable?: boolean }): Uint8Array => {
  const base = paintBase(size, size, Math.max(8, Math.round(size / 24)), 0x5eed)
  const ship = placeShip({
    cx: size / 2,
    cy: size * 0.47,
    radius: (size / 2) * (options?.maskable ? 0.3 : 0.4),
    angle: -Math.PI / 2,
    hull: HULL,
  })
  return encodePng(
    size,
    size,
    composite(size, size, base, (x, y, color) => shadeShip(ship, x, y, color))
  )
}

// Social share card: the V-WING title over a dogfight above the voxel skyline.
export const renderShareImage = (width: number, height: number): Uint8Array => {
  const base = paintBase(width, height, 70, 0xd06f)
  const title = layoutTitle('V-WING', width / 2, height * 0.38, height * 0.24)
  const player = placeShip({
    cx: width * 0.72,
    cy: height * 0.74,
    radius: height * 0.085,
    angle: -Math.PI / 2.6,
    hull: HULL,
  })
  const enemy = placeShip({
    cx: width * 0.24,
    cy: height * 0.78,
    radius: height * 0.06,
    angle: -Math.PI / 1.8,
    hull: ENEMY,
  })

  // Blocky voxel skyline along the bottom — hard pixel edges on purpose.
  const rng = makeRng(0xb10c)
  const cell = Math.round(height / 28)
  const columns = Math.ceil(width / (cell * 2))
  let level = 3 + Math.floor(rng() * 2)
  const heights = Array.from({ length: columns }, () => {
    level = Math.min(6, Math.max(1, level + Math.floor(rng() * 3) - 1))
    return level
  })
  const skyline = (x: number, y: number, color: Rgb): Rgb => {
    const top = height - heights[Math.min(columns - 1, Math.floor(x / (cell * 2)))] * cell
    if (y < top) return color
    return y < top + 2 ? mix(TERRAIN, TERRAIN_EDGE, 0.5) : TERRAIN
  }

  const pixels = composite(width, height, base, (x, y, color) => {
    let out = skyline(x, y, color)
    out = shadeShip(enemy, x, y, out)
    out = shadeShip(player, x, y, out)
    return shadeTitle(title, x, y, out)
  })
  return encodePng(width, height, pixels)
}
