import {
  BASE_BOT_X_FRAC,
  BASE_PAD_Y_FRAC,
  BASE_PLAYER_X_FRAC,
  GRAVITY,
  PLAYER_ID,
  SECONDARY_MAX_CHARGE,
  SECONDARY_REGEN,
  SHIP_DRAG,
  SHIP_MAX_HEALTH,
  SHIP_MAX_SHIELDS,
  SHIP_RADIUS,
  SHIP_RESPAWN_INVULN,
  SHIP_REVERSE_THRUST,
  SHIP_SHIELD_REGEN,
  SHIP_THRUST,
  SHIP_TURN_RATE,
  ShipKind,
  SPAWN_ALTITUDE,
  WATER_BUOYANCY,
  WATER_DRAG,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Input } from '$/game/input'
import type { Rng, Ship, WaterBody } from '$/game/types'
import { submersion } from '$/game/water'
import { assignWeapon } from '$/game/weapons'

// Optional surroundings passed to updateShip; absent = open air (the default everywhere
// except the live engine), which keeps the pure physics tests calling updateShip(s,i,dt).
export type ShipEnv = { water: WaterBody[] }

// Default secondary when no rng is supplied (the deterministic path the unit tests use).
// `forced` (a debug override) pins the weapon when set, bypassing the random roll.
const DEFAULT_WEAPON = WeaponKind.SCATTERGUN
const rollWeapon = (rng?: Rng, forced?: WeaponKind): WeaponKind => forced ?? (rng ? assignWeapon(rng) : DEFAULT_WEAPON)
// The squad type is its own draw (never pinned by `forced`): rolled *after* the weapon, and
// that order is load-bearing — both sides of the network must consume the rng identically.
const rollSquad = (rng?: Rng): WeaponKind => (rng ? assignWeapon(rng) : DEFAULT_WEAPON)

// Campaign ships spawn perched above their own home pad (the generator clamps the pad's
// approach aprons, so this column is open by construction).
export const PLAYER_SPAWN_X = WORLD_WIDTH * BASE_PLAYER_X_FRAC
export const PLAYER_SPAWN_Y = WORLD_HEIGHT * BASE_PAD_Y_FRAC - SPAWN_ALTITUDE
export const BOT_SPAWN_X = WORLD_WIDTH * BASE_BOT_X_FRAC
export const BOT_SPAWN_Y = WORLD_HEIGHT * BASE_PAD_Y_FRAC - SPAWN_ALTITUDE
const FACING_UP = -Math.PI / 2

export const createShip = (
  kind: ShipKind = ShipKind.PLAYER,
  x: number = PLAYER_SPAWN_X,
  y: number = PLAYER_SPAWN_Y,
  id: number = PLAYER_ID,
  rng?: Rng,
  forced?: WeaponKind
): Ship => {
  const weapon = rollWeapon(rng, forced)
  const squad = rollSquad(rng)
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
    reversing: false,
    fireCooldown: 0,
    invuln: SHIP_RESPAWN_INVULN,
    health: SHIP_MAX_HEALTH,
    shields: SHIP_MAX_SHIELDS,
    weapon,
    charge: SECONDARY_MAX_CHARGE,
    altCooldown: 0,
    disabled: 0,
    troops: 0, // the sim fills the bay per mode (DEATHMATCH full, CAMPAIGN loads at the barracks)
    squad,
    deployCooldown: 0,
  }
}

// Reset a ship in place at a spawn point: full hull/shields, stopped, facing up,
// invulnerable, and rolling a fresh random secondary (when an rng is supplied,
// unless `forced` pins it).
export const respawnShipAt = (ship: Ship, x: number, y: number, rng?: Rng, forced?: WeaponKind): void => {
  const weapon = rollWeapon(rng, forced)
  const squad = rollSquad(rng)
  ship.x = x
  ship.y = y
  ship.vx = 0
  ship.vy = 0
  ship.angle = FACING_UP
  ship.thrusting = false
  ship.reversing = false
  ship.fireCooldown = 0
  ship.invuln = SHIP_RESPAWN_INVULN
  ship.health = SHIP_MAX_HEALTH
  ship.shields = SHIP_MAX_SHIELDS
  ship.weapon = weapon
  ship.charge = SECONDARY_MAX_CHARGE
  ship.altCooldown = 0
  ship.disabled = 0
  ship.troops = 0 // the sim refills per mode (DEATHMATCH full, CAMPAIGN reloads at the barracks)
  ship.squad = squad
  ship.deployCooldown = 0
}

export const respawnShip = (ship: Ship, rng?: Rng, forced?: WeaponKind): void =>
  respawnShipAt(ship, PLAYER_SPAWN_X, PLAYER_SPAWN_Y, rng, forced)

// Newtonian integration: turn, optional thrust along the nose, global gravity,
// gentle drag, then advance. Position is unbounded here — wall death is the engine's call.
// While EMP-disabled the ship can't turn or thrust. `env` adds water buoyancy + drag.
export const updateShip = (ship: Ship, input: Input, dt: number, env?: ShipEnv): void => {
  const controllable = ship.disabled <= 0
  if (controllable) ship.angle += input.turn() * SHIP_TURN_RATE * dt
  ship.thrusting = controllable && input.thrusting()
  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * SHIP_THRUST * dt
    ship.vy += Math.sin(ship.angle) * SHIP_THRUST * dt
  }
  // Retro-brake: the two smaller nose nozzles push opposite the nose — kill speed on an
  // approach without flipping the ship (both engines held just fight each other).
  ship.reversing = controllable && input.reversing()
  if (ship.reversing) {
    ship.vx -= Math.cos(ship.angle) * SHIP_REVERSE_THRUST * dt
    ship.vy -= Math.sin(ship.angle) * SHIP_REVERSE_THRUST * dt
  }
  ship.vy += GRAVITY * dt
  const drag = Math.exp(-SHIP_DRAG * dt)
  ship.vx *= drag
  ship.vy *= drag
  // Water: buoyancy fights gravity and a heavier drag bogs the ship down when submerged.
  const submerged = env ? submersion(ship, env.water) : 0
  if (submerged > 0) {
    ship.vy -= WATER_BUOYANCY * submerged * dt
    const waterDrag = Math.exp(-WATER_DRAG * submerged * dt)
    ship.vx *= waterDrag
    ship.vy *= waterDrag
  }
  ship.x += ship.vx * dt
  ship.y += ship.vy * dt
  if (ship.fireCooldown > 0) ship.fireCooldown -= dt
  if (ship.altCooldown > 0) ship.altCooldown -= dt
  if (ship.deployCooldown > 0) ship.deployCooldown -= dt
  if (ship.invuln > 0) ship.invuln -= dt
  if (ship.disabled > 0) ship.disabled -= dt
  if (ship.shields < SHIP_MAX_SHIELDS) ship.shields = Math.min(SHIP_MAX_SHIELDS, ship.shields + SHIP_SHIELD_REGEN * dt)
  if (ship.charge < SECONDARY_MAX_CHARGE)
    ship.charge = Math.min(SECONDARY_MAX_CHARGE, ship.charge + SECONDARY_REGEN * dt)
}
