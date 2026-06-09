import {
  BULLET_DAMAGE,
  BULLET_LIFETIME,
  BULLET_RADIUS,
  BULLET_SPEED,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { randRange } from '$/game/rng'
import type { Bullet, Rng, Ship } from '$/game/types'

type BulletPayload = {
  owner: number
  damage: number
  life: number
  radius?: number
  push?: number
  burn?: boolean
  wet?: boolean
  color?: number
}
type BurstConfig = {
  count: number
  spread: number
  speed: number
  life: number
  damage: number
  push?: number
  burn?: boolean
  wet?: boolean
  color?: number
}

// Shots inherit the ship's velocity plus muzzle speed along the nose (XPilot-style),
// and fly straight — no gravity. Tagged with the firer's id so they skip that ship.
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
    owner: ship.id,
    damage: BULLET_DAMAGE,
  })
}

// Low-level: drop one projectile with explicit kinematics + payload. Shared by every
// bullet-emitting weapon so per-weapon damage/push/color/life stay data-driven.
export const pushBullet = (
  bullets: Bullet[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  payload: BulletPayload
): void => {
  bullets.push({
    x,
    y,
    vx,
    vy,
    radius: payload.radius ?? BULLET_RADIUS,
    life: payload.life,
    owner: payload.owner,
    damage: payload.damage,
    push: payload.push,
    burn: payload.burn,
    wet: payload.wet,
    color: payload.color,
  })
}

// A spread of pellets from a ship's nose (Scattergun cone, Water Cannon stream).
export const spawnBurst = (bullets: Bullet[], ship: Ship, rng: Rng, cfg: BurstConfig): void => {
  for (let i = 0; i < cfg.count; i += 1) {
    const angle = ship.angle + randRange(rng, -cfg.spread, cfg.spread)
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    pushBullet(
      bullets,
      ship.x + dirX * ship.radius,
      ship.y + dirY * ship.radius,
      ship.vx + dirX * cfg.speed,
      ship.vy + dirY * cfg.speed,
      {
        owner: ship.id,
        damage: cfg.damage,
        life: cfg.life,
        push: cfg.push,
        burn: cfg.burn,
        wet: cfg.wet,
        color: cfg.color,
      }
    )
  }
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
