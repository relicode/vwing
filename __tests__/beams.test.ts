import { describe, expect, test } from 'bun:test'

import { fireRail } from '$/game/beams'
import { RAIL_DAMAGE, ShipKind, WeaponKind, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Ship, World } from '$/game/types'

const makeShip = (over: Partial<Ship>): Ship => ({
  id: 0,
  kind: ShipKind.BOT,
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
  vx: 0,
  vy: 0,
  angle: 0,
  radius: 12,
  thrusting: false,
  fireCooldown: 0,
  invuln: 0,
  health: 100,
  shields: 0, // simplify damage math
  weapon: WeaponKind.RAIL,
  ammo: 5,
  altCooldown: 0,
  disabled: 0,
  ...over,
})

const makeWorld = (ships: Ship[]): World => ({
  time: 0,
  ships,
  bullets: [],
  particles: [],
  devices: [],
  beams: [],
  blocks: [],
  water: [],
  rng: createRng(1),
})

describe('fireRail', () => {
  test('hits the nearest in-line enemy, damages it, and draws a beam', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 }) // facing +x
    const near = makeShip({ id: 1, x: 200, y: 0 })
    const far = makeShip({ id: 2, x: 500, y: 0 })
    const world = makeWorld([shooter, near, far])
    const hit = fireRail(world, shooter)
    expect(hit).toBe(near)
    expect(near.health).toBe(100 - RAIL_DAMAGE)
    expect(far.health).toBe(100) // beam stopped at the nearer ship
    expect(world.beams).toHaveLength(1)
  })

  test('skips the firer and invulnerable ships', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 })
    const shielded = makeShip({ id: 1, x: 150, y: 0, invuln: 2 }) // in line but invulnerable
    const real = makeShip({ id: 2, x: 300, y: 0 })
    const world = makeWorld([shooter, shielded, real])
    const hit = fireRail(world, shooter)
    expect(hit).toBe(real)
    expect(shielded.health).toBe(100)
  })

  test('misses cleanly when nothing is in line', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 })
    const offAxis = makeShip({ id: 1, x: 0, y: 400 })
    const world = makeWorld([shooter, offAxis])
    expect(fireRail(world, shooter)).toBeUndefined()
    expect(offAxis.health).toBe(100)
    expect(world.beams).toHaveLength(1)
  })
})
