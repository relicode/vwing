import { cameraOrigin } from '$/game/camera'
import { CAMERA_EASE_RATE, CAMERA_SNAP_DIST, SHAKE_FREQ, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { RenderWorld, Vec2 } from '$/game/types'

// The presentation half of the camera: smooth-follow easing with a snap on big jumps, fed by
// the sim's cameraOrigin math. State lives in this closure so the renderer stays re-creatable.
export type FollowCamera = {
  update: (world: RenderWorld, selfId: number) => Vec2
}

export const createFollowCamera = (): FollowCamera => {
  // Eased camera state (smooth follow); undefined until the first frame snaps to the target.
  let camX: number | undefined
  let camY = 0
  let lastTime = 0

  const update = (world: RenderWorld, selfId: number): Vec2 => {
    // While the player's ship waits out its respawn it isn't in the world — hold the camera on
    // the death spot (the eased position we already have) instead of snapping to another ship.
    const self = world.ships.find((ship) => ship.id === selfId)
    const target = self
      ? cameraOrigin(self)
      : camX !== undefined
        ? { x: camX, y: camY }
        : cameraOrigin({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 })
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
    return { x: camX, y: camY }
  }

  return { update }
}

// Screen shake: the decaying-amplitude wobble the whole view (stars + world) rides on.
export const shakeOffset = (world: RenderWorld): Vec2 =>
  world.shake > 0
    ? {
        x: Math.sin(world.time * SHAKE_FREQ) * world.shake,
        y: Math.cos(world.time * SHAKE_FREQ * 1.3) * world.shake,
      }
    : { x: 0, y: 0 }
