import { SurfaceMaterial, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { Block, WaterBody } from '$/game/types'

const { BEDROCK, ROCK, GRASS, ICE } = SurfaceMaterial

const block = (x: number, y: number, w: number, h: number, material: SurfaceMaterial): Block => ({
  x,
  y,
  w,
  h,
  material,
})

// The single hand-authored arena. A bedrock border wraps the play area; the lower part
// is a water body sitting on the bedrock floor with destructible rock beneath it; a few
// unattached islands, two cliffs rising through the surface, and a bedrock cave (open to
// the right) fill the airspace. Player/bot spawns (~0.4 height, x≈1200/1488) stay clear.
export const createTerrain = (): { blocks: Block[]; water: WaterBody[] } => {
  const t = WALL_THICKNESS
  const floorY = WORLD_HEIGHT - t
  const waterSurface = Math.round(WORLD_HEIGHT * 0.72)

  const blocks: Block[] = [
    // Bedrock border frame.
    block(0, 0, WORLD_WIDTH, t, BEDROCK),
    block(0, floorY, WORLD_WIDTH, t, BEDROCK),
    block(0, 0, t, WORLD_HEIGHT, BEDROCK),
    block(WORLD_WIDTH - t, 0, t, WORLD_HEIGHT, BEDROCK),

    // Destructible rock submerged in the lower-area water.
    block(420, 1300, 240, floorY - 1300, ROCK),
    block(1520, 1340, 320, floorY - 1340, ROCK),

    // Cliffs rising from the floor up through the water surface.
    block(1150, 760, 90, floorY - 760, BEDROCK),
    block(300, 980, 80, floorY - 980, ROCK),

    // Floating island A — grass cap over rock.
    block(600, 620, 260, 90, ROCK),
    block(600, 590, 260, 30, GRASS),

    // Floating island B — ice cap over rock.
    block(1380, 430, 220, 80, ROCK),
    block(1380, 406, 220, 24, ICE),

    // Floating island C — small rock platform.
    block(1900, 760, 160, 70, ROCK),

    // Cave — a bedrock shell open on the right; ship flies into the hollow.
    block(1950, 300, 60, 300, BEDROCK), // back wall
    block(1950, 300, 300, 50, BEDROCK), // ceiling
    block(1950, 550, 300, 50, BEDROCK), // floor
  ]

  const water: WaterBody[] = [{ x: t, y: waterSurface, w: WORLD_WIDTH - 2 * t, h: floorY - waterSurface }]

  return { blocks, water }
}
