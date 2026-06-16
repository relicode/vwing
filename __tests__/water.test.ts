import { describe, expect, test } from 'bun:test'

import { ShipKind, WeaponKind } from '$/game/constants'
import type { Ship, WaterBody } from '$/game/types'
import { submersion, waterSurfaceAt } from '$/game/water'

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

  test('a thin film gives only a thin film of buoyancy (depth clamped to the body height)', () => {
    const film: WaterBody = { x: 100, y: 800, w: 400, h: 6 } // 6px-deep poured film, floor at y=806
    const ship = makeShip({ x: 300, y: 800, radius: 12 }) // bottom 12px below the surface, but only 6px of water
    // Without the body-height clamp this reads 12/24 = 0.5 (a half dunk over a 6px puddle); clamped it's 6/24.
    expect(submersion(ship, [film])).toBeCloseTo(6 / 24, 5)
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
