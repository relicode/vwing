import {
  GRAVITY,
  PLAYER_ID,
  SHIP_DRAG,
  SHIP_MAX_HEALTH,
  SHIP_MAX_SHIELDS,
  SHIP_RADIUS,
  SHIP_RESPAWN_INVULN,
  SHIP_SHIELD_REGEN,
  SHIP_THRUST,
  SHIP_TURN_RATE,
  ShipKind,
  WALL_THICKNESS,
  WEAPON_CONFIG,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Input } from '$/game/input'
import type { Rng, Ship } from '$/game/types'
import { assignWeapon } from '$/game/weapons'

// Default secondary when no rng is supplied (the deterministic path the unit tests use).
const DEFAULT_WEAPON = WeaponKind.SCATTERGUN
const rollWeapon = (rng?: Rng): WeaponKind => (rng ? assignWeapon(rng) : DEFAULT_WEAPON)

export const PLAYER_SPAWN_X = WORLD_WIDTH / 2
export const PLAYER_SPAWN_Y = WORLD_HEIGHT * 0.4
export const BOT_SPAWN_X = WORLD_WIDTH * 0.62 // off to the player's right, just in view
export const BOT_SPAWN_Y = WORLD_HEIGHT * 0.4
const FACING_UP = -Math.PI / 2

export const createShip = (
  kind: ShipKind = ShipKind.PLAYER,
  x: number = PLAYER_SPAWN_X,
  y: number = PLAYER_SPAWN_Y,
  id: number = PLAYER_ID,
  rng?: Rng
): Ship => {
  const weapon = rollWeapon(rng)
  return {
    id,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: FACING_UP,
    radius: SHIP_RADIUS,
    thrusting: false,
    fireCooldown: 0,
    invuln: SHIP_RESPAWN_INVULN,
    health: SHIP_MAX_HEALTH,
    shields: SHIP_MAX_SHIELDS,
    weapon,
    ammo: WEAPON_CONFIG[weapon].ammo,
    altCooldown: 0,
    disabled: 0,
  }
}

// Reset a ship in place at a spawn point: full hull/shields, stopped, facing up,
// invulnerable, and rolling a fresh random secondary (when an rng is supplied).
export const respawnShipAt = (ship: Ship, x: number, y: number, rng?: Rng): void => {
  const weapon = rollWeapon(rng)
  ship.x = x
  ship.y = y
  ship.vx = 0
  ship.vy = 0
  ship.angle = FACING_UP
  ship.thrusting = false
  ship.fireCooldown = 0
  ship.invuln = SHIP_RESPAWN_INVULN
  ship.health = SHIP_MAX_HEALTH
  ship.shields = SHIP_MAX_SHIELDS
  ship.weapon = weapon
  ship.ammo = WEAPON_CONFIG[weapon].ammo
  ship.altCooldown = 0
  ship.disabled = 0
}

export const respawnShip = (ship: Ship, rng?: Rng): void => respawnShipAt(ship, PLAYER_SPAWN_X, PLAYER_SPAWN_Y, rng)

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
  if (ship.shields < SHIP_MAX_SHIELDS) ship.shields = Math.min(SHIP_MAX_SHIELDS, ship.shields + SHIP_SHIELD_REGEN * dt)
}

export const shipHitWall = (ship: Ship): boolean => {
  const min = WALL_THICKNESS + ship.radius
  return ship.x < min || ship.x > WORLD_WIDTH - min || ship.y < min || ship.y > WORLD_HEIGHT - min
}
