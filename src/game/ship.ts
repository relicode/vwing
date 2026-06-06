import {
  GRAVITY,
  SHIP_DRAG,
  SHIP_RADIUS,
  SHIP_RESPAWN_INVULN,
  SHIP_THRUST,
  SHIP_TURN_RATE,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Input } from '$/game/input'
import type { Ship } from '$/game/types'

const SPAWN_X = WORLD_WIDTH / 2
const SPAWN_Y = WORLD_HEIGHT * 0.4
const FACING_UP = -Math.PI / 2

export const createShip = (): Ship => ({
  x: SPAWN_X,
  y: SPAWN_Y,
  vx: 0,
  vy: 0,
  angle: FACING_UP,
  radius: SHIP_RADIUS,
  thrusting: false,
  fireCooldown: 0,
  invuln: SHIP_RESPAWN_INVULN,
})

export const respawnShip = (ship: Ship): void => {
  ship.x = SPAWN_X
  ship.y = SPAWN_Y
  ship.vx = 0
  ship.vy = 0
  ship.angle = FACING_UP
  ship.thrusting = false
  ship.fireCooldown = 0
  ship.invuln = SHIP_RESPAWN_INVULN
}

// Newtonian integration: turn, optional thrust along the nose, global gravity,
// gentle drag, then advance. Position is unbounded here — wall death is the engine's call.
export const updateShip = (ship: Ship, input: Input, dt: number): void => {
  ship.angle += input.turn() * SHIP_TURN_RATE * dt
  ship.thrusting = input.thrusting()
  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * SHIP_THRUST * dt
    ship.vy += Math.sin(ship.angle) * SHIP_THRUST * dt
  }
  ship.vy += GRAVITY * dt
  const drag = Math.exp(-SHIP_DRAG * dt)
  ship.vx *= drag
  ship.vy *= drag
  ship.x += ship.vx * dt
  ship.y += ship.vy * dt
  if (ship.fireCooldown > 0) ship.fireCooldown -= dt
  if (ship.invuln > 0) ship.invuln -= dt
}

export const shipHitWall = (ship: Ship): boolean => {
  const min = WALL_THICKNESS + ship.radius
  return ship.x < min || ship.x > WORLD_WIDTH - min || ship.y < min || ship.y > WORLD_HEIGHT - min
}
