import { describe, expect, test } from 'bun:test'

import { pushBullet, spawnBullet, spawnBurst, updateBullets } from '$/game/bullets'
import { BULLET_SPEED, ShipKind, WALL_THICKNESS, WeaponKind, WORLD_WIDTH } from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Bullet, Ship } from '$/game/types'

const makeShip = (over: Partial<Ship>): Ship => ({
  id: 0,
  kind: ShipKind.PLAYER,
  x: 100,
  y: 100,
  vx: 0,
  vy: 0,
  angle: 0,
  radius: 12,
  thrusting: false,
  fireCooldown: 0,
  invuln: 0,
  health: 100,
  shields: 50,
  weapon: WeaponKind.SCATTERGUN,
  charge: 100,
  altCooldown: 0,
  disabled: 0,
  troops: 0,
  squad: WeaponKind.GRENADE,
  deployCooldown: 0,
  ...over,
})

describe('bullets', () => {
  test('a spawned bullet inherits ship velocity plus muzzle speed along the nose', () => {
    const bullets: Bullet[] = []
    spawnBullet(bullets, makeShip({ vx: 10, angle: 0 })) // facing +x
    expect(bullets).toHaveLength(1)
    expect(bullets[0].vx).toBeCloseTo(10 + BULLET_SPEED)
    expect(bullets[0].vy).toBeCloseTo(0)
  })

  test('a spawned bullet is tagged with the firing ship id', () => {
    const bullets: Bullet[] = []
    spawnBullet(bullets, makeShip({ id: 7 }))
    expect(bullets[0].owner).toBe(7)
  })

  test('pushBullet drops one projectile carrying the given payload', () => {
    const bullets: Bullet[] = []
    pushBullet(bullets, 1, 2, 3, 4, { owner: 5, damage: 9, life: 1, push: 7, color: 0xabc })
    expect(bullets[0]).toMatchObject({ x: 1, y: 2, vx: 3, vy: 4, owner: 5, damage: 9, life: 1, push: 7, color: 0xabc })
  })

  test('spawnBurst fires the configured count with per-weapon damage/push/color', () => {
    const bullets: Bullet[] = []
    spawnBurst(bullets, makeShip({ id: 3, angle: 0 }), createRng(1), {
      count: 7,
      spread: 0.3,
      speed: 500,
      life: 0.4,
      damage: 12,
      push: 80,
      color: 0x1234,
    })
    expect(bullets).toHaveLength(7)
    for (const b of bullets) {
      expect(b.owner).toBe(3)
      expect(b.damage).toBe(12)
      expect(b.push).toBe(80)
      expect(b.color).toBe(0x1234)
    }
  })

  test('updateBullets culls expired shots', () => {
    const expired: Bullet[] = [
      { x: WORLD_WIDTH / 2, y: 100, vx: 0, vy: 0, radius: 3, life: 0.01, owner: 0, damage: 22 },
    ]
    expect(updateBullets(expired, 0.5)).toHaveLength(0)
  })

  test('updateBullets culls shots that reach the wall band but keeps in-flight ones', () => {
    const wallEdge = WORLD_WIDTH - WALL_THICKNESS
    // Starts inside the playfield, crosses the inner wall face within the step → culled.
    const escaping: Bullet[] = [{ x: wallEdge - 5, y: 100, vx: 1000, vy: 0, radius: 3, life: 5, owner: 0, damage: 22 }]
    expect(updateBullets(escaping, 0.1)).toHaveLength(0)

    // Comfortably inside, slow → survives.
    const inFlight: Bullet[] = [
      { x: WORLD_WIDTH / 2, y: 100, vx: 100, vy: 0, radius: 3, life: 5, owner: 0, damage: 22 },
    ]
    expect(updateBullets(inFlight, 0.1)).toHaveLength(1)
  })
})
