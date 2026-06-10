import { Container, Graphics } from 'pixi.js'

import { cameraOrigin } from '$/game/camera'
import {
  CAMERA_EASE_RATE,
  CAMERA_SNAP_DIST,
  Color,
  DeviceKind,
  GamePhase,
  INFANTRY_FIRE_INTERVAL,
  INFANTRY_KNEEL_FIRE_AT,
  INFANTRY_SINK_TIME,
  InfantryState,
  SHAKE_FREQ,
  SHIP_MAX_HEALTH,
  SHIP_MAX_SHIELDS,
  StructureType,
  Surface,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { stateOf } from '$/game/devices'
import { clamp } from '$/game/math'
import { randRange } from '$/game/rng'
import type { Base, Beam, Block, Device, Particle, RenderWorld, Rng, Ship, Vec2, WaterBody } from '$/game/types'

type Star = { x: number; y: number; depth: number; size: number }

const STAR_COUNT = 150
const WING_SPREAD = 2.4 // radians from nose to each tail corner

export type Renderer = {
  view: Container
  draw: (world: RenderWorld, phase: GamePhase, selfId: number) => void
  destroy: () => void
}

const createStars = (rng: Rng): Star[] => {
  const stars: Star[] = []
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const depth = randRange(rng, 0.15, 0.6)
    stars.push({
      x: randRange(rng, 0, VIEW_WIDTH),
      y: randRange(rng, 0, VIEW_HEIGHT),
      depth,
      size: 0.6 + depth * 2,
    })
  }
  return stars
}

// Screen-space parallax: nearer stars (higher depth) slide faster with the camera.
const drawStars = (g: Graphics, stars: Star[], camera: Vec2): void => {
  g.clear()
  for (const star of stars) {
    const x = (((star.x - camera.x * star.depth) % VIEW_WIDTH) + VIEW_WIDTH) % VIEW_WIDTH
    const y = (((star.y - camera.y * star.depth) % VIEW_HEIGHT) + VIEW_HEIGHT) % VIEW_HEIGHT
    const color = star.depth > 0.42 ? Color.STAR_NEAR : Color.STAR_FAR
    g.circle(x, y, star.size).fill({ color, alpha: 0.35 + star.depth * 0.8 })
  }
}

// Per-surface fill + brighter edge for earth blocks; metal (any surface) always renders gray.
const SURFACE_STYLE: Record<Surface, { fill: number; edge: number }> = {
  [Surface.EARTH]: { fill: Color.ROCK, edge: Color.ROCK_EDGE },
  [Surface.GRASS]: { fill: Color.GRASS, edge: Color.GRASS_EDGE },
  [Surface.ICE]: { fill: Color.ICE, edge: Color.ICE_EDGE },
  [Surface.WATER]: { fill: Color.WATER, edge: Color.WATER_EDGE },
}
const METAL_STYLE = { fill: Color.BEDROCK, edge: Color.BEDROCK_EDGE }

// A block's fill/edge: metal is gray regardless of surface; earth takes its surface colour.
const blockStyle = (b: Block): { fill: number; edge: number } =>
  b.structure === StructureType.METAL ? METAL_STYLE : SURFACE_STYLE[b.surface]

// Per-block flourishes (drawn once into the cached terrain layer, deterministic from block
// coords): metal rivets, else grass blades / ice shine streaks / earth cracks by surface.
const drawBlockDetail = (g: Graphics, b: Block): void => {
  if (b.structure === StructureType.METAL) {
    for (let x = b.x + 12; x < b.x + b.w - 6; x += 24) {
      for (let y = b.y + 12; y < b.y + b.h - 6; y += 24) {
        g.circle(x, y, 1.2).fill({ color: Color.BEDROCK_EDGE, alpha: 0.5 })
      }
    }
    return
  }
  switch (b.surface) {
    case Surface.GRASS:
      for (let x = b.x + 5; x < b.x + b.w - 3; x += 13) {
        g.moveTo(x, b.y)
          .lineTo(x + 2, b.y - 4)
          .stroke({ width: 1.5, color: Color.GRASS_EDGE, alpha: 0.85 })
      }
      break
    case Surface.ICE:
      for (let i = 0; i < 2; i += 1) {
        const ox = b.x + b.w * (0.25 + i * 0.4)
        g.moveTo(ox, b.y + 3)
          .lineTo(ox + b.h * 0.5, b.y + b.h * 0.5)
          .stroke({ width: 2, color: Color.ICE_EDGE, alpha: 0.4 })
      }
      break
    case Surface.EARTH: {
      const cx = b.x + b.w * 0.5
      g.moveTo(cx, b.y + 4)
        .lineTo(cx - b.w * 0.12, b.y + b.h * 0.4)
        .lineTo(cx + b.w * 0.08, b.y + b.h * 0.7)
        .stroke({ width: 1, color: Color.ROCK_EDGE, alpha: 0.35 })
      break
    }
    case Surface.WATER:
      break // water never appears on a block (it is a WaterBody overlay)
  }
}

// Static terrain: a filled rect per block with a brighter edge + detail.
const drawBlocks = (g: Graphics, blocks: Block[]): void => {
  for (const b of blocks) {
    const style = blockStyle(b)
    g.rect(b.x, b.y, b.w, b.h).fill({ color: style.fill }).stroke({ width: 2, color: style.edge, alpha: 0.8 })
    drawBlockDetail(g, b)
  }
}

const drawParticles = (g: Graphics, particles: Particle[]): void => {
  for (const p of particles) {
    g.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: Math.max(0, p.life / p.maxLife) })
  }
}

// Water bodies: a translucent volume with a brighter surface line at the top.
const drawWaterBodies = (g: Graphics, water: WaterBody[]): void => {
  for (const b of water) {
    g.rect(b.x, b.y, b.w, b.h).fill({ color: Color.WATER, alpha: 0.38 })
    g.rect(b.x, b.y, b.w, 2).fill({ color: Color.WATER_EDGE, alpha: 0.8 })
  }
}

type InfantrySprite = Extract<Device, { kind: DeviceKind.INFANTRY }>

// ── Cannon-Fodder troopers ───────────────────────────────────────────────────
// A big-headed little soldier built from one standing pose that every state deforms. THREE colour
// channels keep the read clean at small size: the large masses (head, torso, limbs) carry the OWNER
// tint (friend/foe, like the ships); a fixed soldier-grey helmet + boots + belt say "infantry" on
// top; a khaki pack on the rear gives a facing cue. A big expressive face (one eye + a mouth that
// shifts with mood) plus per-state accents (panic eyes, sweat, waving arms, X-eyes, bubbles) sell
// what each trooper is doing at a glance. Every measure is in units of r, so the figure scales.

const FLASH_WINDOW = 0.08 // s after a shot the muzzle bloom shows (derived from the sim's fireCooldown)
const SWIM_PADDLE_VX = 12 // |vx| above which a swimmer is stroking toward a rescuer (vs. treading water)
const HELMET_COLOR = Color.SMOKE
const BOOT_COLOR = Color.SMOKE
const BELT_COLOR = Color.SMOKE
const PACK_COLOR = Color.ROCK
const EYE_COLOR = Color.INK

// Darken a 0xRRGGBB colour per channel — the owner-derived rim stroke that keeps a trooper's outline
// reading its team while popping it off bright grass/ice as well as the dark void.
const darken = (hex: number, f: number): number => {
  const r = Math.round(((hex >> 16) & 0xff) * f)
  const g = Math.round(((hex >> 8) & 0xff) * f)
  const b = Math.round((hex & 0xff) * f)
  return (r << 16) | (g << 8) | b
}
const SHIP_RIM = darken(Color.SHIP, 0.6)
const ENEMY_RIM = darken(Color.ENEMY, 0.6)

// The face mood drives eye + mouth shape; each state picks one so its emotion reads.
enum Mood {
  SMIRK = 'SMIRK', // at-ease standing
  SMILE = 'SMILE', // content march / calm canopy descent
  GRIT = 'GRIT', // firing / straining / paddling
  FLAT = 'FLAT', // alarmed (ice slide)
  PANIC_O = 'PANIC_O', // wide-eyed open-mouth terror (run / fall / drowning cry)
  DEAD_X = 'DEAD_X', // X-eyed corpse (drowned)
}

// The owner-derived colours every state shares (built once per draw) so a unit never changes its
// apparent team as it changes pose.
type Kit = { body: number; rim: number; flash: number }
const infantryKit = (d: InfantrySprite, selfId: number): Kit => {
  const self = d.owner === selfId
  return {
    body: self ? Color.SHIP : Color.ENEMY,
    rim: self ? SHIP_RIM : ENEMY_RIM,
    flash: self ? Color.BULLET : Color.BULLET_ENEMY,
  }
}

// Flat-bottomed upper half-disc — the helmet dome (y-down: the PI→2PI sweep is the top half).
const dome = (g: Graphics, cx: number, cy: number, r: number, color: number, alpha: number): void => {
  g.moveTo(cx - r, cy)
    .arc(cx, cy, r, Math.PI, Math.PI * 2)
    .fill({ color, alpha })
}

// A fixed-grey boot ellipse on the ground line, toe nudged toward facing.
const boot = (g: Graphics, x: number, footY: number, f: number, r: number, alpha: number): void => {
  g.ellipse(x + f * r * 0.08, footY, r * 0.42, r * 0.26).fill({ color: BOOT_COLOR, alpha })
}

// A faint ground shadow (shows over terrain, invisible on the void) anchoring the figure.
const shadow = (g: Graphics, d: InfantrySprite, r: number, alpha: number): void => {
  g.ellipse(d.x, d.y + r, r * 0.9, r * 0.22).fill({ color: Color.SHADOW, alpha: 0.22 * alpha })
}

// The khaki pack on the rear side — a back/front asymmetry that makes heading legible.
const pack = (g: Graphics, d: InfantrySprite, r: number, f: number, alpha: number): void => {
  const cx = d.x - f * r * 0.45
  g.roundRect(cx - r * 0.17, d.y - r * 0.5, r * 0.34, r * 0.7, r * 0.14).fill({ color: PACK_COLOR, alpha })
}

// The rounded barrel torso (team fill + owner rim + a grey belt); topY = its top edge.
const torso = (g: Graphics, cx: number, topY: number, r: number, kit: Kit, alpha: number): void => {
  const w = r * 1.05
  const h = r * 1.35
  g.roundRect(cx - w / 2, topY, w, h, r * 0.4)
    .fill({ color: kit.body, alpha })
    .stroke({ width: r * 0.1, color: kit.rim, alpha })
  g.rect(cx - w / 2, topY + h * 0.62, w, r * 0.1).fill({ color: BELT_COLOR, alpha }) // belt
}

// The big head: team ball + owner rim, fixed-grey helmet dome + brim (unless detached), one eye
// toward facing, and a mood-driven mouth. eyeScale widens the eye for panic; brow adds a tick.
const head = (
  g: Graphics,
  hx: number,
  hy: number,
  r: number,
  f: number,
  kit: Kit,
  alpha: number,
  mood: Mood,
  eyeScale = 1,
  brow = false,
  helmet = true
): void => {
  g.circle(hx, hy, r * 0.62)
    .fill({ color: kit.body, alpha })
    .stroke({ width: r * 0.1, color: kit.rim, alpha })
  if (helmet) {
    dome(g, hx, hy - r * 0.08, r * 0.66, HELMET_COLOR, alpha)
    g.rect(hx - r * 0.62, hy - r * 0.2, r * 1.24, r * 0.18).fill({ color: HELMET_COLOR, alpha }) // brim band
    g.rect(hx + (f > 0 ? r * 0.5 : -r * 0.84), hy - r * 0.2, r * 0.34, r * 0.18).fill({ color: HELMET_COLOR, alpha }) // peak +f
  }
  const eyeX = hx + f * r * 0.2
  const eyeY = hy + r * 0.08
  if (mood === Mood.DEAD_X) {
    const s = r * 0.15
    g.moveTo(eyeX - s, eyeY - s)
      .lineTo(eyeX + s, eyeY + s)
      .moveTo(eyeX + s, eyeY - s)
      .lineTo(eyeX - s, eyeY + s)
      .stroke({ width: r * 0.08, color: EYE_COLOR, alpha })
  } else {
    g.circle(eyeX, eyeY, r * 0.13 * eyeScale).fill({ color: EYE_COLOR, alpha })
    if (brow)
      g.moveTo(eyeX - f * r * 0.16, eyeY - r * 0.24)
        .lineTo(eyeX + f * r * 0.16, eyeY - r * 0.12)
        .stroke({ width: r * 0.06, color: EYE_COLOR, alpha })
  }
  const mX = hx + f * r * 0.04
  const mY = hy + r * 0.38
  const mW = r * 0.18
  if (mood === Mood.PANIC_O) {
    g.circle(mX, mY, r * 0.13).fill({ color: EYE_COLOR, alpha })
  } else if (mood === Mood.GRIT || mood === Mood.FLAT) {
    g.moveTo(mX - mW, mY)
      .lineTo(mX + mW, mY)
      .stroke({ width: r * 0.08, color: EYE_COLOR, alpha })
  } else {
    const depth = mood === Mood.SMILE ? r * 0.16 : r * 0.08 // control point below the baseline → corners up
    g.moveTo(mX - mW, mY)
      .quadraticCurveTo(mX, mY + depth, mX + mW, mY)
      .stroke({ width: r * 0.07, color: EYE_COLOR, alpha })
  }
}

// The shoulder-fired heavy tube (any specialist kind): tinted tube + flared muzzle + grey venturi, with a
// forward puff and the signature rear backblast while firing.
// Tube tint per specialist kind, so a kneeling rail sniper / EMP trooper / sapper reads at a
// glance (each borrows its ship weapon's signature colour).
const HEAVY_TUBE: Record<WeaponKind, number> = {
  [WeaponKind.SCATTERGUN]: Color.SHRAPNEL,
  [WeaponKind.WATER_CANNON]: Color.WATER_EDGE,
  [WeaponKind.INCENDIARY]: Color.THRUST,
  [WeaponKind.SEEKER]: Color.MISSILE,
  [WeaponKind.RAIL]: Color.RAIL,
  [WeaponKind.GRENADE]: Color.GRENADE,
  [WeaponKind.MINES]: Color.MINE_ARMED,
  [WeaponKind.FLAK]: Color.FLAK,
  [WeaponKind.EMP]: Color.EMP,
  [WeaponKind.SINGULARITY]: Color.WELL,
}
const tubeColor = (d: InfantrySprite): number => HEAVY_TUBE[d.heavy ?? WeaponKind.GRENADE]

const bazooka = (
  g: Graphics,
  sx: number,
  sy: number,
  f: number,
  r: number,
  alpha: number,
  flashT: number,
  tube: number
): void => {
  const rearX = sx - f * r * 1.0
  const rearY = sy + r * 0.12
  const muzX = sx + f * r * 2.3
  const muzY = sy - r * 0.7
  g.moveTo(rearX, rearY)
    .lineTo(muzX, muzY)
    .stroke({ width: r * 0.4, color: tube, alpha }) // tube
  g.circle(muzX, muzY, r * 0.5).fill({ color: tube, alpha }) // muzzle
  g.circle(rearX, rearY, r * 0.32).fill({ color: Color.SMOKE, alpha }) // venturi
  if (flashT > 0) {
    g.circle(muzX + f * r * 0.5, muzY, r * 0.5 * flashT).fill({ color: Color.EXPLOSION, alpha: 0.85 * flashT })
    g.circle(rearX - f * r * 0.35, rearY, r * 0.55 * flashT).fill({ color: Color.SMOKE, alpha: 0.5 * flashT })
  }
}

// The rifle: body-tinted stock + white barrel, with a 4-point muzzle star + hot core while firing.
const rifle = (
  g: Graphics,
  hx: number,
  hy: number,
  f: number,
  r: number,
  kit: Kit,
  alpha: number,
  flashT: number
): void => {
  const muzX = hx + f * r * 1.9
  g.moveTo(hx - f * r * 0.3, hy + r * 0.06)
    .lineTo(hx + f * r * 0.3, hy)
    .stroke({ width: r * 0.22, color: kit.body, alpha }) // stock
  g.moveTo(hx, hy)
    .lineTo(muzX, hy)
    .stroke({ width: r * 0.16, color: Color.SHIP_CORE, alpha }) // barrel
  if (flashT > 0) {
    g.star(muzX, hy, 4, r * 0.85 * flashT, r * 0.3 * flashT).fill({ color: kit.flash, alpha: 0.9 * flashT })
    g.circle(muzX, hy, r * 0.3 * flashT).fill({ color: Color.SHIP_CORE, alpha: flashT })
  }
}

// STANDING (idle breathing) or WALKING (marching gait) — the base build; weapon + face read its job.
const drawStanding = (g: Graphics, d: InfantrySprite, kit: Kit, time: number, f: number, walking: boolean): void => {
  const r = d.radius
  const a = 1
  const footY = d.y + r
  const phase = time * 6 + d.x * 0.05
  const legA = Math.sin(phase)
  const legB = Math.sin(phase + Math.PI)
  const bob = walking ? Math.abs(legA) * r * 0.06 : Math.sin(time * 2 + d.x * 0.1) * r * 0.05
  const cy = d.y - bob // body + head bob; feet stay planted on footY
  const hipY = cy + r * 0.7
  shadow(g, d, r, a)
  pack(g, d, r, f, a)
  if (walking) {
    const ff = d.x + f * r * 0.25 + legA * f * r * 0.4
    const rf = d.x - f * r * 0.2 + legB * f * r * 0.4
    const fy = footY - Math.max(0, legA) * r * 0.18 // lift the forward foot mid-step
    g.moveTo(d.x - f * r * 0.2, hipY)
      .lineTo(rf, footY)
      .stroke({ width: r * 0.34, color: kit.body, alpha: a })
    boot(g, rf, footY, f, r, a)
    g.moveTo(d.x + f * r * 0.25, hipY)
      .lineTo(ff, fy)
      .stroke({ width: r * 0.34, color: kit.body, alpha: a })
    boot(g, ff, fy, f, r, a)
  } else {
    g.moveTo(d.x - f * r * 0.2, hipY)
      .lineTo(d.x - f * r * 0.28, footY)
      .stroke({ width: r * 0.34, color: kit.body, alpha: a })
    boot(g, d.x - f * r * 0.28, footY, f, r, a)
    g.moveTo(d.x + f * r * 0.25, hipY)
      .lineTo(d.x + f * r * 0.28, footY)
      .stroke({ width: r * 0.34, color: kit.body, alpha: a })
    boot(g, d.x + f * r * 0.28, footY, f, r, a)
  }
  torso(g, d.x, cy - r * 0.55, r, kit, a)
  if (d.heavy !== undefined) {
    head(g, d.x, cy - r * 0.95, r, f, kit, a, walking ? Mood.SMILE : Mood.SMIRK)
    g.moveTo(d.x + f * r * 0.2, cy - r * 0.3)
      .lineTo(d.x + f * r * 0.35, cy - r * 0.45)
      .stroke({ width: r * 0.3, color: kit.body, alpha: a }) // grip arm
    bazooka(g, d.x + f * r * 0.1, cy - r * 0.5, f, r, a, 0, tubeColor(d)) // a standing specialist kneels before firing — no flash
  } else {
    const flashT = clamp((d.fireCooldown - (INFANTRY_FIRE_INTERVAL - FLASH_WINDOW)) / FLASH_WINDOW, 0, 1)
    head(g, d.x, cy - r * 0.95, r, f, kit, a, flashT > 0 ? Mood.GRIT : walking ? Mood.SMILE : Mood.SMIRK)
    const handX = d.x + f * r * 0.55 - (walking ? legA * r * 0.15 : 0)
    const handY = cy - r * 0.1
    g.moveTo(d.x + f * r * 0.2, cy - r * 0.3)
      .lineTo(handX, handY)
      .stroke({ width: r * 0.3, color: kit.body, alpha: a }) // arm
    rifle(g, handX, handY, f, r, kit, a, flashT)
  }
}

// RUNNING — a comedic panic bolt (wide eyes + open mouth, scissoring legs, pumping arm, no weapon),
// or the stiff-legged ice slide variant (d.slide) with an alarmed mouth + a skid tick.
const drawRunning = (g: Graphics, d: InfantrySprite, kit: Kit, time: number, f: number): void => {
  const r = d.radius
  const a = 1
  const footY = d.y + r
  shadow(g, d, r, a)
  pack(g, d, r, f, a)
  if (!d.running && d.slide !== 0) {
    g.moveTo(d.x - f * r * 0.1, d.y + r * 0.5)
      .lineTo(d.x + f * r * 0.7, footY)
      .stroke({ width: r * 0.34, color: kit.body, alpha: a })
    boot(g, d.x + f * r * 0.7, footY, f, r, a)
    g.moveTo(d.x - f * r * 0.1, d.y + r * 0.5)
      .lineTo(d.x - f * r * 0.5, footY)
      .stroke({ width: r * 0.34, color: kit.body, alpha: a })
    boot(g, d.x - f * r * 0.5, footY, f, r, a)
    torso(g, d.x + f * r * 0.1, d.y - r * 0.5, r, kit, a)
    head(g, d.x + f * r * 0.2, d.y - r * 0.9, r, f, kit, a, Mood.FLAT, 1.2)
    g.moveTo(d.x - f * r * 0.8, footY)
      .lineTo(d.x - f * r * 1.5, footY)
      .stroke({ width: r * 0.1, color: Color.ICE_EDGE, alpha: 0.8 }) // skid
    return
  }
  const phase = time * 16 + d.x * 0.1
  const s = Math.sin(phase)
  const lean = f * r * 0.4
  const hipY = d.y + r * 0.55
  g.moveTo(d.x, hipY)
    .lineTo(d.x + f * (r * 0.5 + s * r * 0.5), footY)
    .stroke({ width: r * 0.34, color: kit.body, alpha: a })
  boot(g, d.x + f * (r * 0.5 + s * r * 0.5), footY, f, r, a)
  const kick = Math.max(0, -s) * r * 0.3
  g.moveTo(d.x, hipY)
    .lineTo(d.x - f * (r * 0.3 + s * r * 0.5), footY - kick)
    .stroke({ width: r * 0.34, color: kit.body, alpha: a })
  boot(g, d.x - f * (r * 0.3 + s * r * 0.5), footY - kick, f, r, a)
  torso(g, d.x + lean * 0.5, d.y - r * 0.5, r, kit, a)
  g.moveTo(d.x + lean * 0.5, d.y - r * 0.2)
    .lineTo(d.x + lean + f * r * 0.2, d.y - r * 0.1 - s * r * 0.4)
    .stroke({ width: r * 0.3, color: kit.body, alpha: a }) // pumping arm
  head(g, d.x + lean, d.y - r * 0.85, r, f, kit, a, Mood.PANIC_O, 1.3, true)
}

// KNEELING — grenadier braced on one knee, hunched behind the tube, gritted; a recoil shove + rear
// backblast on the firing frame, a sweat bead during the wind-up.
const drawKneeling = (g: Graphics, d: InfantrySprite, kit: Kit, f: number): void => {
  const r = d.radius
  const a = 1
  const footY = d.y + r
  // The round flies as kneel crosses INFANTRY_KNEEL_FIRE_AT; bloom peaks then (kneel ≈ FIRE_AT) and
  // decays over the next FLASH_WINDOW. Gated to after the shot so the wind-up shows no flash.
  const flashT =
    d.kneel <= INFANTRY_KNEEL_FIRE_AT
      ? clamp((d.kneel - (INFANTRY_KNEEL_FIRE_AT - FLASH_WINDOW)) / FLASH_WINDOW, 0, 1)
      : 0
  const shove = -f * r * 0.12 * flashT
  shadow(g, d, r, a)
  pack(g, d, r, f, a)
  const hipX = d.x + shove
  const kneeX = d.x + f * r * 0.85
  g.moveTo(hipX, d.y + r * 0.5)
    .lineTo(kneeX, d.y + r * 0.55)
    .stroke({ width: r * 0.38, color: kit.body, alpha: a }) // forward thigh
  g.moveTo(kneeX, d.y + r * 0.55)
    .lineTo(kneeX, footY)
    .stroke({ width: r * 0.38, color: kit.body, alpha: a }) // forward shin
  boot(g, kneeX, footY, f, r, a)
  g.moveTo(hipX, d.y + r * 0.5)
    .lineTo(d.x - f * r * 0.7, footY)
    .stroke({ width: r * 0.38, color: kit.body, alpha: a }) // rear knee
  g.ellipse(d.x - f * r * 0.7, footY, r * 0.3, r * 0.22).fill({ color: BOOT_COLOR, alpha: a })
  torso(g, d.x + f * r * 0.1 + shove, d.y - r * 0.25, r, kit, a)
  head(g, d.x + shove, d.y - r * 0.55, r, f, kit, a, Mood.GRIT, 0.85)
  bazooka(g, d.x + f * r * 0.3 + shove, d.y - r * 0.05, f, r, a, flashT, tubeColor(d))
  if (d.kneel > INFANTRY_KNEEL_FIRE_AT)
    g.circle(d.x - f * r * 0.3, d.y - r * 0.7, r * 0.1).fill({ color: Color.WATER_EDGE, alpha: 0.85 }) // sweat
}

// FALLING (no canopy) — a flailing tumble: windmilling arms, kicking legs, terrified O-face, helmet
// on but askew, speed-lines streaming up. Reads instantly as "this one has no parachute".
const drawFalling = (g: Graphics, d: InfantrySprite, kit: Kit, time: number, f: number): void => {
  const r = d.radius
  const a = 1
  const tilt = Math.sin(time * 6 + d.x) * 0.5
  const phase = time * 12 + d.x
  torso(g, d.x + Math.sin(tilt) * r * 0.3, d.y - r * 0.5, r, kit, a)
  for (const off of [0, Math.PI]) {
    const ang = Math.PI * 1.5 + Math.sin(phase + off)
    g.moveTo(d.x, d.y - r * 0.2)
      .lineTo(d.x + Math.cos(ang) * r * 1.2, d.y - r * 0.2 + Math.sin(ang) * r * 1.2)
      .stroke({ width: r * 0.3, color: kit.body, alpha: a }) // windmill arms
  }
  g.moveTo(d.x, d.y + r * 0.5)
    .lineTo(d.x - r * 0.7, d.y + r + Math.sin(phase) * r * 0.3)
    .stroke({ width: r * 0.34, color: kit.body, alpha: a })
  boot(g, d.x - r * 0.7, d.y + r + Math.sin(phase) * r * 0.3, -f, r, a)
  g.moveTo(d.x, d.y + r * 0.5)
    .lineTo(d.x + r * 0.7, d.y + r - Math.sin(phase) * r * 0.3)
    .stroke({ width: r * 0.34, color: kit.body, alpha: a })
  boot(g, d.x + r * 0.7, d.y + r - Math.sin(phase) * r * 0.3, f, r, a)
  head(g, d.x + Math.sin(tilt) * r * 0.4, d.y - r * 0.95, r, f, kit, a, Mood.PANIC_O, 1.3, true)
  g.moveTo(d.x - r * 0.3, d.y - r * 1.9)
    .lineTo(d.x - r * 0.3, d.y - r * 2.4)
    .moveTo(d.x + r * 0.3, d.y - r * 1.8)
    .lineTo(d.x + r * 0.3, d.y - r * 2.3)
    .stroke({ width: r * 0.08, color: Color.SMOKE, alpha: 0.5 }) // speed lines
}

// FALLING_PARACHUTE — a calm canopy descent: segmented chute, risers to the shoulders, body hanging
// relaxed and pendulum-swaying with legs together and a content little face.
const drawParachute = (g: Graphics, d: InfantrySprite, kit: Kit, time: number, f: number): void => {
  const r = d.radius
  const a = 1
  const open = 0.35 + d.chute * 0.65 // canopy widens as it opens
  const cw = r * 3 * open
  const cy = d.y - r * 3.4
  const sway = Math.sin(time * 1.6 + d.x * 0.1) * 0.16
  const sx = d.x + Math.sin(sway) * r * 0.6 // shoulders swing under the canopy
  g.moveTo(d.x - cw, cy)
    .quadraticCurveTo(d.x, cy - r * 2.2 * open, d.x + cw, cy)
    .fill({ color: Color.PARACHUTE, alpha: 0.18 })
  g.moveTo(d.x - cw, cy)
    .quadraticCurveTo(d.x, cy - r * 2.2 * open, d.x + cw, cy)
    .stroke({ width: r * 0.22, color: Color.PARACHUTE, alpha: 0.9 })
  g.moveTo(d.x - cw * 0.5, cy - r * 0.05)
    .lineTo(d.x, cy - r * 1.7 * open)
    .moveTo(d.x + cw * 0.5, cy - r * 0.05)
    .lineTo(d.x, cy - r * 1.7 * open)
    .stroke({ width: r * 0.08, color: Color.PARACHUTE, alpha: 0.5 }) // gore seams
  g.moveTo(d.x - cw, cy)
    .lineTo(sx - r * 0.4, d.y - r * 0.4)
    .moveTo(d.x + cw, cy)
    .lineTo(sx + r * 0.4, d.y - r * 0.4)
    .stroke({ width: r * 0.1, color: Color.PARACHUTE, alpha: 0.55 }) // risers
  g.moveTo(sx - r * 0.15, d.y + r * 0.55)
    .lineTo(sx - r * 0.15, d.y + r)
    .stroke({ width: r * 0.34, color: kit.body, alpha: a })
  g.moveTo(sx + r * 0.15, d.y + r * 0.55)
    .lineTo(sx + r * 0.15, d.y + r)
    .stroke({ width: r * 0.34, color: kit.body, alpha: a })
  boot(g, sx - r * 0.15, d.y + r, f, r, a)
  boot(g, sx + r * 0.15, d.y + r, f, r, a)
  torso(g, sx, d.y - r * 0.5, r, kit, a)
  g.moveTo(sx, d.y - r * 0.2)
    .lineTo(sx - r * 0.4, d.y - r * 0.5)
    .moveTo(sx, d.y - r * 0.2)
    .lineTo(sx + r * 0.4, d.y - r * 0.5)
    .stroke({ width: r * 0.26, color: kit.body, alpha: a }) // arms up to the risers
  head(g, sx, d.y - r * 0.95, r, f, kit, a, Mood.SMILE)
}

// SWIMMING — head + helmet bobbing at the waterline, body half-sunk; TREADING (wave for rescue,
// worried O) when nearly still, PADDLING (freestyle toward a rescuer, gritted) when moving.
const drawSwimming = (g: Graphics, d: InfantrySprite, kit: Kit, time: number, f: number): void => {
  const r = d.radius
  const a = 0.8
  const wl = d.y // waterline
  const bob = Math.sin(time * 4 + d.x * 0.12) * r * 0.16
  const sh = wl - r * 0.3 + bob // shoulder line
  g.roundRect(d.x - r * 0.5, wl - r * 0.1 + bob, r, r * 0.7, r * 0.3).fill({ color: kit.body, alpha: a }) // half-sunk torso
  if (Math.abs(d.vx) > SWIM_PADDLE_VX) {
    const s = Math.sin(time * 14)
    g.moveTo(d.x, sh)
      .lineTo(d.x + f * (r * 1.5 + s * r * 0.5), sh - s * r * 0.4)
      .stroke({ width: r * 0.28, color: kit.body, alpha: a })
    g.moveTo(d.x, sh)
      .lineTo(d.x - f * (r * 0.9 - s * r * 0.3), sh + r * 0.3)
      .stroke({ width: r * 0.28, color: kit.body, alpha: a })
    head(g, d.x, wl - r * 0.75 + bob, r, f, kit, a, Mood.GRIT)
  } else {
    const w = Math.sin(time * 9) * 0.55
    g.moveTo(d.x, sh)
      .lineTo(d.x - r * 1.2, sh - r * (1.3 + w))
      .stroke({ width: r * 0.28, color: kit.body, alpha: a })
    g.moveTo(d.x, sh)
      .lineTo(d.x + r * 1.2, sh - r * (1.3 - w))
      .stroke({ width: r * 0.28, color: kit.body, alpha: a })
    head(g, d.x, wl - r * 0.75 + bob, r, f, kit, a, Mood.PANIC_O)
  }
  g.ellipse(d.x, wl + r * 0.1, r * 1.3, r * 0.35).stroke({ width: r * 0.14, color: Color.WATER_EDGE, alpha: 0.8 }) // splash collar
  g.moveTo(d.x - r * 1.7, wl)
    .lineTo(d.x - r * 0.9, wl)
    .moveTo(d.x + r * 0.9, wl)
    .lineTo(d.x + r * 1.7, wl)
    .stroke({ width: r * 0.12, color: Color.WATER_EDGE, alpha: 0.6 }) // ripples
}

// DROWNING — a sinking corpse: limp drooping limbs, lolling X-eyed head, the helmet slipping off and
// drifting away, rising bubbles, fading out as it descends (saveable for a brief window).
const drawDrowning = (g: Graphics, d: InfantrySprite, kit: Kit, time: number, f: number): void => {
  const r = d.radius
  const prog = clamp(1 - d.sinking / INFANTRY_SINK_TIME, 0, 1) // 0 just drowned → 1 gone
  const a = clamp(d.sinking / INFANTRY_SINK_TIME, 0, 1) * 0.5 + 0.12 // smooth fade (was a binary 0.3)
  torso(g, d.x, d.y - r * 0.4, r, kit, a)
  g.moveTo(d.x - r * 0.3, d.y)
    .lineTo(d.x - r * 0.5, d.y + r * 0.7)
    .moveTo(d.x + r * 0.3, d.y)
    .lineTo(d.x + r * 0.5, d.y + r * 0.7)
    .stroke({ width: r * 0.28, color: kit.body, alpha: a }) // slack arms
  g.moveTo(d.x - r * 0.2, d.y + r * 0.7)
    .lineTo(d.x - r * 0.3, d.y + r * 1.2)
    .moveTo(d.x + r * 0.2, d.y + r * 0.7)
    .lineTo(d.x + r * 0.3, d.y + r * 1.2)
    .stroke({ width: r * 0.3, color: kit.body, alpha: a }) // trailing legs
  head(g, d.x - f * r * 0.15, d.y - r * 0.85, r, f, kit, a, Mood.DEAD_X, 1, false, false) // helmet off
  dome(g, d.x + r * (0.4 + prog * 0.6), d.y - r * (1.4 + prog * 0.5), r * 0.66, HELMET_COLOR, a) // drifting helmet
  const by = d.y - r - ((time * r * 1.5) % (r * 2))
  g.circle(d.x + r * 0.3, by, r * 0.12).fill({ color: Color.WATER_EDGE, alpha: 0.5 * a }) // rising bubble
}

// Dispatch a trooper to its state pose. stateOf (devices.ts) is the single source of truth for the
// behavioural state, so the pose ladder never drifts from the sim. The ice slide is a transient
// stateOf intentionally doesn't model (it would otherwise read as WALKING/STANDING), so it's caught
// first and routed to drawRunning's skid branch.
const drawInfantry = (g: Graphics, d: InfantrySprite, time: number, selfId: number): void => {
  const f = d.facing >= 0 ? 1 : -1
  const kit = infantryKit(d, selfId)
  if (d.attached && d.slide !== 0 && !d.running) {
    drawRunning(g, d, kit, time, f)
    return
  }
  switch (stateOf(d)) {
    case InfantryState.DROWNING:
      drawDrowning(g, d, kit, time, f)
      break
    case InfantryState.SWIMMING:
      drawSwimming(g, d, kit, time, f)
      break
    case InfantryState.FALLING_PARACHUTE:
      drawParachute(g, d, kit, time, f)
      break
    case InfantryState.FALLING:
      drawFalling(g, d, kit, time, f)
      break
    case InfantryState.KNEELING:
      drawKneeling(g, d, kit, f)
      break
    case InfantryState.RUNNING:
      drawRunning(g, d, kit, time, f)
      break
    case InfantryState.WALKING:
      drawStanding(g, d, kit, time, f, true)
      break
    case InfantryState.STANDING:
      drawStanding(g, d, kit, time, f, false)
      break
  }
}

const drawDevice = (g: Graphics, d: Device, time: number, selfId: number): void => {
  switch (d.kind) {
    case DeviceKind.MISSILE: {
      const a = Math.atan2(d.vy, d.vx)
      g.moveTo(d.x - Math.cos(a) * d.radius * 2.4, d.y - Math.sin(a) * d.radius * 2.4)
        .lineTo(d.x, d.y)
        .stroke({ width: 2, color: d.color, alpha: 0.55 })
      g.circle(d.x, d.y, d.radius).fill({ color: d.color })
      break
    }
    case DeviceKind.MINE: {
      const armed = d.armTime <= 0
      const color = armed ? Color.MINE_ARMED : Color.MINE
      g.circle(d.x, d.y, d.radius).stroke({ width: 2, color })
      g.circle(d.x, d.y, d.radius * 0.4).fill({ color })
      break
    }
    case DeviceKind.INFANTRY:
      drawInfantry(g, d, time, selfId)
      break
    case DeviceKind.GRENADE:
      g.circle(d.x, d.y, d.radius).fill({ color: Color.GRENADE })
      break
    case DeviceKind.FLAK:
      g.circle(d.x, d.y, d.radius).fill({ color: Color.FLAK })
      break
    case DeviceKind.WELL:
      g.circle(d.x, d.y, d.pullRadius).stroke({ width: 1, color: Color.WELL, alpha: 0.12 })
      g.circle(d.x, d.y, d.radius * 2).stroke({ width: 2, color: Color.WELL, alpha: 0.5 })
      g.circle(d.x, d.y, d.radius).fill({ color: Color.WELL })
      break
  }
}

const drawBeams = (g: Graphics, beams: Beam[]): void => {
  for (const b of beams) {
    g.moveTo(b.x1, b.y1)
      .lineTo(b.x2, b.y2)
      .stroke({ width: 3, color: b.color, alpha: Math.max(0, b.life / b.maxLife) })
  }
}

// Floating hull (bottom) + shield (top) gauges above a ship, so combat reads at a glance.
const drawBars = (g: Graphics, ship: Ship): void => {
  const w = ship.radius * 2.6
  const x = ship.x - w / 2
  const y = ship.y - ship.radius - 12
  g.rect(x, y, w, 3).fill({ color: Color.BAR_BACK })
  g.rect(x, y, w * clamp(ship.health / SHIP_MAX_HEALTH, 0, 1), 3).fill({ color: Color.HEALTH })
  g.rect(x, y - 4, w, 2).fill({ color: Color.BAR_BACK })
  g.rect(x, y - 4, w * clamp(ship.shields / SHIP_MAX_SHIELDS, 0, 1), 2).fill({ color: Color.SHIELD })
}

const drawShip = (g: Graphics, ship: Ship, time: number, isSelf: boolean): void => {
  if (ship.invuln > 0 && Math.floor(time * 12) % 2 === 0) return
  const a = ship.angle
  const r = ship.radius
  const hull = isSelf ? Color.SHIP : Color.ENEMY
  if (ship.thrusting) {
    const flick = 0.6 + (Math.floor(time * 40) % 3) * 0.28
    g.poly([
      ship.x + Math.cos(a + WING_SPREAD) * r * 0.7,
      ship.y + Math.sin(a + WING_SPREAD) * r * 0.7,
      ship.x + Math.cos(a - WING_SPREAD) * r * 0.7,
      ship.y + Math.sin(a - WING_SPREAD) * r * 0.7,
      ship.x - Math.cos(a) * r * (1.1 + flick),
      ship.y - Math.sin(a) * r * (1.1 + flick),
    ]).fill({ color: Color.THRUST, alpha: 0.9 })
  }
  g.poly([
    ship.x + Math.cos(a) * r * 1.5,
    ship.y + Math.sin(a) * r * 1.5,
    ship.x + Math.cos(a + WING_SPREAD) * r,
    ship.y + Math.sin(a + WING_SPREAD) * r,
    ship.x + Math.cos(a - WING_SPREAD) * r,
    ship.y + Math.sin(a - WING_SPREAD) * r,
  ]).fill({ color: hull })
  g.circle(ship.x, ship.y, r * 0.34).fill({ color: Color.SHIP_CORE })
  drawBars(g, ship)
}

// A home barracks: a bunker squatting on its pad, tinted by whoever holds it (the tint flips to
// the capturer's color the moment it falls), with garrison helmet pips over the door and a
// flashing takeover bar while the capture is in progress. Drawn in the dynamic layer — capture
// state and garrison mutate every frame, so it can't live in the terrainVersion cache.
const drawBase = (g: Graphics, base: Base, time: number, selfId: number): void => {
  const holder = base.capture >= 1 && base.capturedBy !== undefined ? base.capturedBy : base.owner
  const body = holder === selfId ? Color.SHIP : Color.ENEMY
  const w = 120
  const h = 52
  const x = base.x - w / 2
  const y = base.y - h
  g.roundRect(x, y, w, h, 8).fill({ color: body, alpha: 0.26 }).stroke({ width: 2, color: body })
  g.circle(base.x, y, 15).fill({ color: body, alpha: 0.5 }) // roof dome
  g.rect(base.x - 9, y + h - 26, 18, 26).fill({ color: Color.INK, alpha: 0.85 }) // door
  g.moveTo(x + w - 16, y)
    .lineTo(x + w - 16, y - 22)
    .stroke({ width: 2, color: body }) // antenna
  g.circle(x + w - 16, y - 24, 3).fill({ color: body })
  // Garrison pips: one helmet dot per housed trooper, racked beside the door.
  const housed = Math.floor(base.garrison)
  for (let i = 0; i < housed; i += 1) {
    const px = x + 10 + (i % 6) * 10
    const py = y + 12 + Math.floor(i / 6) * 9
    g.circle(px, py, 3).fill({ color: Color.SMOKE })
  }
  // Takeover bar above the roof while a capture is running (flashes to read as an alarm).
  if (base.capture > 0 && base.capture < 1) {
    const blink = Math.floor(time * 4) % 2 === 0
    g.rect(x, y - 34, w, 5).fill({ color: Color.BAR_BACK })
    g.rect(x, y - 34, w * base.capture, 5).fill({ color: Color.THRUST, alpha: blink ? 1 : 0.55 })
  }
}

export const createRenderer = (rng: Rng): Renderer => {
  const view = new Container()
  const starLayer = new Graphics()
  const worldLayer = new Container()
  const terrainGfx = new Graphics()
  const dynGfx = new Graphics()
  worldLayer.addChild(terrainGfx, dynGfx)
  view.addChild(starLayer, worldLayer)
  const stars = createStars(rng)
  // Redraw the cached terrain layer only when it actually changes — the sim bumps
  // world.terrainVersion on every carve and while debris is falling, and once per fresh run.
  let terrainVersion = -1
  // Eased camera state (smooth follow); undefined until the first frame snaps to the target.
  let camX: number | undefined
  let camY = 0
  let lastTime = 0

  const draw = (world: RenderWorld, phase: GamePhase, selfId: number): void => {
    const self = world.ships.find((ship) => ship.id === selfId) ?? world.ships[0]
    const target = cameraOrigin(self ?? { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 })
    if (camX === undefined || Math.hypot(target.x - camX, target.y - camY) > CAMERA_SNAP_DIST) {
      camX = target.x // first frame or a big jump (respawn): snap, don't drift across the arena
      camY = target.y
    } else {
      const dt = Math.min(0.05, Math.max(0, world.time - lastTime))
      const ease = 1 - Math.exp(-CAMERA_EASE_RATE * dt)
      camX += (target.x - camX) * ease
      camY += (target.y - camY) * ease
    }
    lastTime = world.time
    const camera = { x: camX, y: camY }
    // Screen shake: wobble the whole view (stars + world) by the decaying amplitude.
    const shakeX = world.shake > 0 ? Math.sin(world.time * SHAKE_FREQ) * world.shake : 0
    const shakeY = world.shake > 0 ? Math.cos(world.time * SHAKE_FREQ * 1.3) * world.shake : 0
    view.position.set(shakeX, shakeY)
    worldLayer.position.set(-camera.x, -camera.y)
    drawStars(starLayer, stars, camera)
    if (world.terrainVersion !== terrainVersion) {
      terrainVersion = world.terrainVersion
      terrainGfx.clear()
      drawBlocks(terrainGfx, world.blocks)
      drawWaterBodies(terrainGfx, world.water)
    }
    dynGfx.clear()
    for (const base of world.bases) drawBase(dynGfx, base, world.time, selfId)
    for (const device of world.devices) drawDevice(dynGfx, device, world.time, selfId)
    for (const bullet of world.bullets) {
      const color = bullet.color ?? (bullet.owner === selfId ? Color.BULLET : Color.BULLET_ENEMY)
      dynGfx.circle(bullet.x, bullet.y, bullet.radius * 2.2).fill({ color, alpha: 0.18 }) // soft glow
      dynGfx.circle(bullet.x, bullet.y, bullet.radius).fill({ color })
    }
    drawBeams(dynGfx, world.beams)
    drawParticles(dynGfx, world.particles)
    // Ships are drawn only in-play: in TITLE/GAME_OVER updateShip never runs, so their
    // spawn invulnerability never ticks down and they'd blink forever over the backdrop.
    if (phase === GamePhase.PLAYING)
      for (const ship of world.ships) drawShip(dynGfx, ship, world.time, ship.id === selfId)
  }

  const destroy = (): void => {
    view.destroy({ children: true })
  }

  return { view, draw, destroy }
}
