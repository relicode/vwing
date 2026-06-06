import type { Ship } from '$/game/types'

// Apply gunfire damage: shields soak first, the remainder bites the hull.
export const applyDamage = (ship: Ship, damage: number): void => {
  const absorbed = Math.min(ship.shields, damage)
  ship.shields -= absorbed
  ship.health = Math.max(0, ship.health - (damage - absorbed))
}

export const isDead = (ship: Ship): boolean => ship.health <= 0

// Shove a ship along a (not necessarily normalized) direction — water cannon knockback.
export const applyKnockback = (ship: Ship, dirX: number, dirY: number, impulse: number): void => {
  const len = Math.hypot(dirX, dirY) || 1
  ship.vx += (dirX / len) * impulse
  ship.vy += (dirY / len) * impulse
}

// EMP lockout: take the longer of the existing/new disable, optionally drain shields.
export const applyDisable = (ship: Ship, seconds: number, shieldDrain = 0): void => {
  if (seconds > ship.disabled) ship.disabled = seconds
  if (shieldDrain > 0) ship.shields = Math.max(0, ship.shields - shieldDrain)
}
