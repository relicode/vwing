import { describe, expect, test } from 'bun:test'

import { ShipKind, WeaponKind } from '$/game/constants'
import type { Ship, WaterBody } from '$/game/types'
import { addPool, raisePool, submersion, waterSurfaceAt } from '$/game/water'

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
  reversing: false,
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

describe('submersion', () => {
  const body: WaterBody = { x: 100, y: 800, w: 400, h: 200 } // surface at y = 800

  test('is 0 above the surface and outside the body span', () => {
    expect(submersion(makeShip({ x: 300, y: 700 }), [body])).toBe(0) // above the surface
    expect(submersion(makeShip({ x: 900, y: 850 }), [body])).toBe(0) // outside the x-span
  })

  test('rises from a partial dip to fully under', () => {
    const partial = submersion(makeShip({ x: 300, y: 794 }), [body]) // bottom 6px under the surface
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
    expect(submersion(makeShip({ x: 300, y: 900 }), [body])).toBe(1) // well under
  })
})

describe('addPool', () => {
  const lake: WaterBody = { x: 0, y: 1000, w: 2000, h: 400 } // full-width lake

  test('a basin overlapping an existing body fuses into one (union bounds)', () => {
    const a: WaterBody = { x: 100, y: 500, w: 100, h: 40 } // 100..200
    const b: WaterBody = { x: 150, y: 500, w: 100, h: 40 } // 150..250, overlaps a
    const next = addPool([a], b, 24)
    expect(next).toHaveLength(1)
    expect(next[0].x).toBe(100)
    expect(next[0].w).toBe(150) // union spans 100..250
  })

  test('a pool stacked above another at the same x stays separate (no vertical overlap)', () => {
    const perched: WaterBody = { x: 500, y: 590, w: 80, h: 20 } // x overlaps the lake, far above it
    expect(addPool([lake], perched, 24)).toHaveLength(2)
  })

  test('at the body cap, a non-merging pool is dropped', () => {
    const bodies = Array.from({ length: 24 }, (_, i) => ({ x: i * 100, y: 0, w: 10, h: 10 }))
    const lonely: WaterBody = { x: 5000, y: 0, w: 10, h: 10 }
    expect(addPool(bodies, lonely, 24)).toHaveLength(24) // skipped (no room, nothing to fuse)
  })
})

describe('raisePool — basins fill gradually', () => {
  const basin: WaterBody = { x: 0, y: 100, w: 100, h: 50 } // spill level 100, floor 150

  test('each pour raises the level by area/width, capped at the spill level', () => {
    let water: WaterBody[] = []
    water = raisePool(water, basin, 700, 24)
    expect(water).toHaveLength(1)
    expect(water[0].y).toBeCloseTo(150 - 7, 5) // 700 px² across a 100 px basin = 7 px of water
    const firstY = water[0].y
    water = raisePool(water, basin, 700, 24)
    expect(water[0].y).toBeLessThan(firstY) // climbing…
    for (let i = 0; i < 50; i += 1) water = raisePool(water, basin, 700, 24)
    expect(water[0].y).toBe(100) // …and pinned at the spill level, never past it
    expect(raisePool(water, basin, 700, 24)).toBe(water) // a full basin takes no more
  })
})

describe('waterSurfaceAt (y-aware for stacked pools)', () => {
  const lake: WaterBody = { x: 0, y: 1000, w: 2000, h: 400 }
  const perched: WaterBody = { x: 480, y: 590, w: 80, h: 20 }

  test('returns the surface of the body nearest the query point', () => {
    expect(waterSurfaceAt([lake, perched], 500, 595)).toBe(590) // inside the perched pool
    expect(waterSurfaceAt([lake, perched], 500, 1100)).toBe(1000) // down in the lake
  })

  test('is undefined where there is no water column', () => {
    expect(waterSurfaceAt([lake, perched], 2500, 500)).toBeUndefined()
  })
})
