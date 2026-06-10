import { describe, expect, test } from 'bun:test'

import { applyDamage, applyDisable, applyKnockback, isDead } from '$/game/combat'
import { ShipKind, WeaponKind } from '$/game/constants'
import type { Ship } from '$/game/types'

const makeShip = (over: Partial<Ship>): Ship => ({
  id: 0,
  kind: ShipKind.BOT,
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

describe('combat damage', () => {
  test('shields absorb damage before the hull', () => {
    const ship = makeShip({ shields: 50, health: 100 })
    applyDamage(ship, 30)
    expect(ship.shields).toBe(20)
    expect(ship.health).toBe(100)
  })

  test('damage past the shields spills into the hull', () => {
    const ship = makeShip({ shields: 20, health: 100 })
    applyDamage(ship, 30)
    expect(ship.shields).toBe(0)
    expect(ship.health).toBe(90)
  })

  test('a ship with no shields takes full damage to the hull', () => {
    const ship = makeShip({ shields: 0, health: 40 })
    applyDamage(ship, 22)
    expect(ship.health).toBe(18)
    expect(isDead(ship)).toBe(false)
  })

  test('isDead reports a depleted hull', () => {
    const ship = makeShip({ shields: 0, health: 10 })
    applyDamage(ship, 22)
    expect(ship.health).toBeLessThanOrEqual(0)
    expect(isDead(ship)).toBe(true)
  })
})

describe('knockback + disable', () => {
  test('applyKnockback shoves the ship along a normalized direction', () => {
    const ship = makeShip({ vx: 0, vy: 0 })
    applyKnockback(ship, 10, 0, 50) // direction +x (magnitude normalized away)
    expect(ship.vx).toBeCloseTo(50)
    expect(ship.vy).toBeCloseTo(0)
  })

  test('applyDisable keeps the longer lockout and drains shields once', () => {
    const ship = makeShip({ disabled: 0, shields: 50 })
    applyDisable(ship, 2, 40)
    expect(ship.disabled).toBe(2)
    expect(ship.shields).toBe(10)
    applyDisable(ship, 1) // shorter lockout never shortens the active one
    expect(ship.disabled).toBe(2)
  })
})
