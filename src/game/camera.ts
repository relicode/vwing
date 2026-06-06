import { VIEW_HEIGHT, VIEW_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import { clamp } from '$/game/math'
import type { Vec2 } from '$/game/types'

// Top-left corner of the viewport in world coordinates, centered on `target`
// but clamped so the camera never reveals anything past the world walls.
export const cameraOrigin = (target: Vec2): Vec2 => ({
  x: clamp(target.x - VIEW_WIDTH / 2, 0, Math.max(0, WORLD_WIDTH - VIEW_WIDTH)),
  y: clamp(target.y - VIEW_HEIGHT / 2, 0, Math.max(0, WORLD_HEIGHT - VIEW_HEIGHT)),
})
