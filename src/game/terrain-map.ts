import { StructureType, Surface, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'

// Block factories per (structure, surface) combination used in the arena. `metal` is the
// indestructible anchor (bare); `earth` is destructible bare dirt; `grass`/`ice` are destructible
// earth carrying a grass / ice surface (a thin cap over an earth or metal body, as below).
const make = (x: number, y: number, w: number, h: number, structure: StructureType, surface: Surface): Block => ({
  x,
  y,
  w,
  h,
  structure,
  surface,
})
const metal = (x: number, y: number, w: number, h: number): Block =>
  make(x, y, w, h, StructureType.METAL, Surface.EARTH)
const earth = (x: number, y: number, w: number, h: number): Block =>
  make(x, y, w, h, StructureType.EARTH, Surface.EARTH)
const grass = (x: number, y: number, w: number, h: number): Block =>
  make(x, y, w, h, StructureType.EARTH, Surface.GRASS)
const ice = (x: number, y: number, w: number, h: number): Block => make(x, y, w, h, StructureType.EARTH, Surface.ICE)

// The single hand-authored arena. A metal border wraps the play area; the lower part is a water
// body sitting on the metal floor with destructible earth beneath it; a few unattached islands,
// two cliffs rising through the surface, and a metal cave (open to the right) fill the airspace.
// Player/bot spawns (~0.4 height, x≈1200/1488) stay clear.
export const createTerrain = (): { blocks: Block[]; water: WaterBody[] } => {
  const t = WALL_THICKNESS
  const floorY = WORLD_HEIGHT - t
  const waterSurface = Math.round(WORLD_HEIGHT * 0.72)

  const blocks: Block[] = [
    // Metal border frame.
    metal(0, 0, WORLD_WIDTH, t),
    metal(0, floorY, WORLD_WIDTH, t),
    metal(0, 0, t, WORLD_HEIGHT),
    metal(WORLD_WIDTH - t, 0, t, WORLD_HEIGHT),

    // Destructible earth submerged in the lower-area water.
    earth(420, 1300, 240, floorY - 1300),
    earth(1520, 1340, 320, floorY - 1340),

    // Cliffs rising from the floor up through the water surface.
    metal(1150, 760, 90, floorY - 760),
    earth(300, 980, 80, floorY - 980),

    // Floating island A — grass cap over earth.
    earth(600, 620, 260, 90),
    grass(600, 590, 260, 30),

    // Floating island B — ice cap over earth.
    earth(1380, 430, 220, 80),
    ice(1380, 406, 220, 24),

    // Floating island C — small earth platform.
    earth(1900, 760, 160, 70),

    // Cave — a metal shell open on the right; ship flies into the hollow.
    metal(1950, 300, 60, 300), // back wall
    metal(1950, 300, 300, 50), // ceiling
    metal(1950, 550, 300, 50), // floor
  ]

  const water: WaterBody[] = [{ x: t, y: waterSurface, w: WORLD_WIDTH - 2 * t, h: floorY - waterSurface }]

  return { blocks, water }
}
