import { describe, expect, test } from 'bun:test'

import { SHIP_TURN_RATE, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { Input } from '$/game/input'
import { createShip, respawnShip, shipHitWall, updateShip } from '$/game/ship'
import type { WaterPool } from '$/game/types'

const makeInput = (turn: number, thrusting: boolean): Input => ({
  turn: () => turn,
  thrusting: () => thrusting,
  firing: () => false,
  altFiring: () => false,
  destroy: () => {},
})

describe('ship physics', () => {
  test('gravity pulls a coasting ship downward', () => {
    const ship = createShip()
    ship.invuln = 0
    const startY = ship.y
    updateShip(ship, makeInput(0, false), 0.5)
    expect(ship.vy).toBeGreaterThan(0)
    expect(ship.y).toBeGreaterThan(startY)
  })

  test('thrusting while facing up overcomes gravity', () => {
    const ship = createShip() // spawns facing up
    updateShip(ship, makeInput(0, true), 0.1)
    expect(ship.vy).toBeLessThan(0)
    expect(ship.thrusting).toBe(true)
  })

  test('turning changes heading at the turn rate', () => {
    const ship = createShip()
    const startAngle = ship.angle
    updateShip(ship, makeInput(1, false), 0.1)
    expect(ship.angle).toBeCloseTo(startAngle + SHIP_TURN_RATE * 0.1)
  })

  test('shipHitWall detects the lethal border', () => {
    const ship = createShip()
    expect(shipHitWall(ship)).toBe(false)
    ship.x = WALL_THICKNESS
    expect(shipHitWall(ship)).toBe(true)
    ship.x = WORLD_WIDTH / 2
    ship.y = WORLD_HEIGHT - WALL_THICKNESS
    expect(shipHitWall(ship)).toBe(true)
  })

  test('respawn recenters, stops, and grants invulnerability', () => {
    const ship = createShip()
    ship.x = 123
    ship.vx = 50
    ship.invuln = 0
    respawnShip(ship)
    expect(ship.vx).toBe(0)
    expect(ship.invuln).toBeGreaterThan(0)
    expect(ship.x).toBeCloseTo(WORLD_WIDTH / 2)
  })

  test('water buoyancy lifts a submerged ship relative to open air', () => {
    const pool: WaterPool = { x: WORLD_WIDTH / 2 - 200, width: 400, level: 300, capacity: 400 }
    const submerged = createShip()
    submerged.invuln = 0
    submerged.x = WORLD_WIDTH / 2
    submerged.y = WORLD_HEIGHT - WALL_THICKNESS - 10 // deep in the pool

    const dry = createShip()
    dry.invuln = 0
    dry.x = WORLD_WIDTH / 2
    dry.y = 200 // open air

    updateShip(submerged, makeInput(0, false), 0.1, { pools: [pool] })
    updateShip(dry, makeInput(0, false), 0.1)
    expect(submerged.vy).toBeLessThan(dry.vy) // buoyancy fights gravity
  })

  test('an EMP-disabled ship ignores turn and thrust input', () => {
    const ship = createShip()
    ship.invuln = 0
    ship.disabled = 1
    const startAngle = ship.angle
    updateShip(ship, makeInput(1, true), 0.1)
    expect(ship.angle).toBe(startAngle) // no turn
    expect(ship.thrusting).toBe(false) // no thrust
    expect(ship.disabled).toBeCloseTo(0.9) // lockout ticks down
  })
})
