import {
  BULLET_LIFETIME,
  BULLET_RADIUS,
  BULLET_SPEED,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Bullet, Ship } from '$/game/types'

// Shots inherit the ship's velocity plus muzzle speed along the nose (XPilot-style),
// and fly straight — no gravity.
export const spawnBullet = (bullets: Bullet[], ship: Ship): void => {
  const dirX = Math.cos(ship.angle)
  const dirY = Math.sin(ship.angle)
  bullets.push({
    x: ship.x + dirX * ship.radius,
    y: ship.y + dirY * ship.radius,
    vx: ship.vx + dirX * BULLET_SPEED,
    vy: ship.vy + dirY * BULLET_SPEED,
    radius: BULLET_RADIUS,
    life: BULLET_LIFETIME,
  })
}

export const updateBullets = (bullets: Bullet[], dt: number): Bullet[] => {
  for (const bullet of bullets) {
    bullet.x += bullet.vx * dt
    bullet.y += bullet.vy * dt
    bullet.life -= dt
  }
  // Expire on timeout or when they reach the wall band (shots don't pass through the lethal border).
  return bullets.filter(
    (bullet) =>
      bullet.life > 0 &&
      bullet.x > WALL_THICKNESS &&
      bullet.x < WORLD_WIDTH - WALL_THICKNESS &&
      bullet.y > WALL_THICKNESS &&
      bullet.y < WORLD_HEIGHT - WALL_THICKNESS
  )
}
