import { describe, expect, test } from 'bun:test'

import { spawnBullet, updateBullets } from '$/game/bullets'
import { BULLET_SPEED, WORLD_WIDTH } from '$/game/constants'
import type { Bullet, Ship } from '$/game/types'

const makeShip = (over: Partial<Ship>): Ship => ({
  x: 100,
  y: 100,
  vx: 0,
  vy: 0,
  angle: 0,
  radius: 12,
  thrusting: false,
  fireCooldown: 0,
  invuln: 0,
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

  test('updateBullets culls expired and out-of-world shots', () => {
    const expired: Bullet[] = [{ x: 100, y: 100, vx: 0, vy: 0, radius: 3, life: 0.01 }]
    expect(updateBullets(expired, 0.5)).toHaveLength(0)

    const escaping: Bullet[] = [{ x: WORLD_WIDTH - 1, y: 100, vx: 1000, vy: 0, radius: 3, life: 5 }]
    expect(updateBullets(escaping, 0.1)).toHaveLength(0)
  })
})
