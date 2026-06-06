import { describe, expect, test } from 'bun:test'

import {
  ShipKind,
  WALL_THICKNESS,
  WATER_POOL_CAPACITY,
  WATER_POOL_COUNT,
  WATER_POOL_START_LEVEL,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Ship, WaterPool } from '$/game/types'
import { createInitialPools, submersion, surfaceY, transferWater } from '$/game/water'

const makeShip = (over: Partial<Ship>): Ship => ({
  id: 0,
  kind: ShipKind.PLAYER,
  x: 0,
  y: 0,
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
  ammo: 0,
  altCooldown: 0,
  disabled: 0,
  ...over,
})

describe('createInitialPools', () => {
  test('lays out the configured number of non-overlapping, in-bounds pools', () => {
    const pools = createInitialPools(createRng(7))
    expect(pools).toHaveLength(WATER_POOL_COUNT)
    const sorted = [...pools].sort((a, b) => a.x - b.x)
    for (let i = 0; i < sorted.length; i += 1) {
      const p = sorted[i]
      expect(p.level).toBe(WATER_POOL_START_LEVEL)
      expect(p.capacity).toBe(WATER_POOL_CAPACITY)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + p.width).toBeLessThanOrEqual(WORLD_WIDTH)
      if (i > 0) expect(p.x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width)
    }
  })
})

describe('submersion', () => {
  const pool: WaterPool = { x: 100, width: 400, level: 100, capacity: 240 }

  test('is 0 above the surface and outside the pool span', () => {
    expect(submersion(makeShip({ x: 300, y: surfaceY(pool) - 50 }), [pool])).toBe(0)
    expect(submersion(makeShip({ x: 900, y: WORLD_HEIGHT - WALL_THICKNESS }), [pool])).toBe(0)
  })

  test('rises from a partial dip to fully under', () => {
    const partial = submersion(makeShip({ x: 300, y: surfaceY(pool) - 6 }), [pool])
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
    expect(submersion(makeShip({ x: 300, y: WORLD_HEIGHT - WALL_THICKNESS }), [pool])).toBe(1)
  })
})

describe('transferWater', () => {
  test('moves level from the source pool to the destination, clamped to capacity', () => {
    const a: WaterPool = { x: 0, width: 100, level: 100, capacity: 240 }
    const b: WaterPool = { x: 200, width: 100, level: 50, capacity: 240 }
    transferWater([a, b], 50, 250, 30)
    expect(a.level).toBe(70)
    expect(b.level).toBe(80)
  })

  test('spraying onto dry land just drains the source; an over-drain bottoms out at 0', () => {
    const a: WaterPool = { x: 0, width: 100, level: 20, capacity: 240 }
    transferWater([a], 50, 9999, 30) // toX hits no pool
    expect(a.level).toBe(0)
  })

  test('no source pool under the muzzle is a no-op', () => {
    const a: WaterPool = { x: 0, width: 100, level: 100, capacity: 240 }
    transferWater([a], 9999, 50, 30)
    expect(a.level).toBe(100)
  })
})
