import type { Ship } from '$/game/types'

// Apply gunfire damage: shields soak first, the remainder bites the hull.
export const applyDamage = (ship: Ship, damage: number): void => {
  const absorbed = Math.min(ship.shields, damage)
  ship.shields -= absorbed
  ship.health = Math.max(0, ship.health - (damage - absorbed))
}

export const isDead = (ship: Ship): boolean => ship.health <= 0
