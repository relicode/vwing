import { describe, expect, test } from 'bun:test'

import { ShipKind, WeaponKind } from '$/game/constants'
import type { Ship, WaterBody } from '$/game/types'
import { submersion } from '$/game/water'

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
