import { describe, expect, test } from 'bun:test'

import { createBotInput, decideBot } from '$/game/bot'
import { AsteroidSize, BOT_ID, PLAYER_ID, ShipKind, WeaponKind, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { Asteroid, Ship, World } from '$/game/types'

const CENTER_X = WORLD_WIDTH / 2
const CENTER_Y = WORLD_HEIGHT / 2

const makeShip = (over: Partial<Ship>): Ship => ({
  id: BOT_ID,
  kind: ShipKind.BOT,
  x: CENTER_X,
  y: CENTER_Y,
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

const makeTarget = (over: Partial<Ship>): Ship => makeShip({ id: PLAYER_ID, kind: ShipKind.PLAYER, ...over })

const makeAsteroid = (x: number, y: number, radius: number): Asteroid => ({
  x,
  y,
  vx: 0,
  vy: 0,
  radius,
  size: AsteroidSize.LARGE,
  angle: 0,
  spin: 0,
  verts: [1, 1, 1],
})

describe('decideBot', () => {
  test('turns toward a target off to the side', () => {
    const self = makeShip({ angle: -Math.PI / 2 }) // facing up
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y }) // to the right
    const d = decideBot(self, target, [])
    expect(d.turn).toBe(1) // rotate right, toward the target
    expect(d.firing).toBe(false) // way off aim
  })

  test('fires and closes when lined up within range', () => {
    const self = makeShip({ angle: 0 }) // facing +x
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y })
    const d = decideBot(self, target, [])
    expect(d.turn).toBe(0)
    expect(d.firing).toBe(true)
    expect(d.thrusting).toBe(true)
  })

  test('holds station (no thrust) once inside standoff range', () => {
    const self = makeShip({ angle: 0 })
    const target = makeTarget({ x: CENTER_X + 120, y: CENTER_Y }) // closer than BOT_STANDOFF
    const d = decideBot(self, target, [])
    expect(d.firing).toBe(true)
    expect(d.thrusting).toBe(false)
  })

  test('leads a crossing target', () => {
    const self = makeShip({ angle: 0 }) // facing +x
    const target = makeTarget({ x: CENTER_X + 400, y: CENTER_Y, vy: 300 }) // sliding down
    const d = decideBot(self, target, [])
    expect(d.turn).toBe(1) // aims below the target's current position
  })

  test('climbs when hugging the floor and already facing the recovery heading', () => {
    const self = makeShip({ x: CENTER_X, y: WORLD_HEIGHT - 100, angle: -Math.PI / 2 }) // near floor, nose up
    const target = makeTarget({ x: CENTER_X + 300, y: WORLD_HEIGHT - 100 })
    const d = decideBot(self, target, [])
    expect(d.thrusting).toBe(true) // recovery heading is up; aligned → burn
    expect(d.firing).toBe(false) // survival overrides the shot
  })

  test('turns before thrusting when the floor is below but the nose points down', () => {
    const self = makeShip({ x: CENTER_X, y: WORLD_HEIGHT - 100, angle: Math.PI / 2 }) // nose-down at the floor
    const target = makeTarget({ x: CENTER_X + 300, y: WORLD_HEIGHT - 100 })
    const d = decideBot(self, target, [])
    expect(d.thrusting).toBe(false) // would otherwise burn straight into the floor
    expect(d.turn).not.toBe(0) // rotates toward the recovery heading first
    expect(d.firing).toBe(false)
  })

  test('breaks off from a close asteroid even with the target lined up', () => {
    const self = makeShip({ angle: 0 }) // facing the rock and the target
    const target = makeTarget({ x: CENTER_X + 600, y: CENTER_Y }) // dead ahead, in range
    const rock = makeAsteroid(CENTER_X + 30, CENTER_Y, 20) // right on top of the bot
    const d = decideBot(self, target, [rock])
    expect(d.firing).toBe(false) // dodging overrides the shot
    expect(d.turn).not.toBe(0) // turns away from the rock
    expect(d.thrusting).toBe(false) // won't burn straight into it before turning
  })

  test('alt-fires when lined up with a charge ready', () => {
    const self = makeShip({ angle: 0, ammo: 3, altCooldown: 0 })
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y })
    const d = decideBot(self, target, [])
    expect(d.firing).toBe(true)
    expect(d.altFiring).toBe(true)
  })

  test('holds the secondary when out of charges or still cooling down', () => {
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y })
    expect(decideBot(makeShip({ angle: 0, ammo: 0, altCooldown: 0 }), target, []).altFiring).toBe(false)
    expect(decideBot(makeShip({ angle: 0, ammo: 3, altCooldown: 0.5 }), target, []).altFiring).toBe(false)
  })

  test('createBotInput memoizes one decision per world.time and recomputes on advance', () => {
    const self = makeShip({ id: BOT_ID, angle: 0, x: CENTER_X, y: CENTER_Y })
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y }) // lined up to the right
    const world: World = {
      time: 1,
      wave: 1,
      ships: [target, self],
      bullets: [],
      asteroids: [],
      particles: [],
      devices: [],
      beams: [],
      pools: [],
      rng: () => 0,
    }
    const input = createBotInput(self, () => world)
    expect(input.turn()).toBe(0) // aligned → no turn
    expect(input.firing()).toBe(true)

    // Target jumps far overhead, but the frame hasn't advanced → the decision is reused.
    target.y = CENTER_Y - 4000
    expect(input.turn()).toBe(0)
    expect(input.firing()).toBe(true)

    // New frame → recompute against the moved target → now aims upward.
    world.time = 2
    expect(input.turn()).toBe(-1)
  })
})
