import { describe, expect, test } from 'bun:test'

import { createBotInput, decideBot, nextGoal } from '$/game/bot'
import {
  BOT_ID,
  BotGoal,
  PLAYER_ID,
  ShipKind,
  StructureType,
  Surface,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Base, Block, Ship, World } from '$/game/types'

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
  charge: 0,
  altCooldown: 0,
  disabled: 0,
  troops: 0,
  squad: WeaponKind.GRENADE,
  deployCooldown: 0,
  ...over,
})

const makeTarget = (over: Partial<Ship>): Ship => makeShip({ id: PLAYER_ID, kind: ShipKind.PLAYER, ...over })

const makeBlock = (x: number, y: number, w: number, h: number): Block => ({
  x,
  y,
  w,
  h,
  structure: StructureType.EARTH,
  surface: Surface.EARTH,
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

  test('breaks off from a close terrain block even with the target lined up', () => {
    const self = makeShip({ angle: 0 }) // facing the block and the target
    const target = makeTarget({ x: CENTER_X + 600, y: CENTER_Y }) // dead ahead, in range
    const block = makeBlock(CENTER_X + 8, CENTER_Y - 40, 80, 80) // right on top of the bot
    const d = decideBot(self, target, [block])
    expect(d.firing).toBe(false) // dodging overrides the shot
    expect(d.turn).not.toBe(0) // turns away from the block
    expect(d.thrusting).toBe(false) // won't burn straight into it before turning
  })

  test('alt-fires when lined up with a charge ready', () => {
    const self = makeShip({ angle: 0, charge: 100, altCooldown: 0 })
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y })
    const d = decideBot(self, target, [])
    expect(d.firing).toBe(true)
    expect(d.altFiring).toBe(true)
  })

  test('holds the secondary when out of charges or still cooling down', () => {
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y })
    expect(decideBot(makeShip({ angle: 0, charge: 0, altCooldown: 0 }), target, []).altFiring).toBe(false)
    expect(decideBot(makeShip({ angle: 0, charge: 100, altCooldown: 0.5 }), target, []).altFiring).toBe(false)
  })

  test('looses a long-range secondary past primary-cannon range', () => {
    const self = makeShip({ angle: 0, charge: 100, altCooldown: 0 })
    const target = makeTarget({ x: CENTER_X + 800, y: CENTER_Y }) // > BOT_FIRE_RANGE, < BOT_SECONDARY_RANGE
    const d = decideBot(self, target, [])
    expect(d.firing).toBe(false) // primary cannon can't reach
    expect(d.altFiring).toBe(true) // but the rail/seeker can
  })

  test('createBotInput memoizes one decision per world.time and recomputes on advance', () => {
    const self = makeShip({ id: BOT_ID, angle: 0, x: CENTER_X, y: CENTER_Y })
    const target = makeTarget({ x: CENTER_X + 300, y: CENTER_Y }) // lined up to the right
    const world: World = {
      time: 1,
      ships: [target, self],
      bullets: [],
      particles: [],
      devices: [],
      beams: [],
      blocks: [],
      terrainVersion: 0,
      water: [],
      bases: [],
      shake: 0,
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

describe('nextGoal (the campaign goal ladder)', () => {
  const homeBase = (over: Partial<Base>): Base => ({
    owner: BOT_ID,
    x: WORLD_WIDTH * 0.88,
    y: WORLD_HEIGHT * 0.52,
    garrison: 8,
    capture: 0,
    ...over,
  })
  const enemyBase = (over: Partial<Base>): Base => ({
    owner: PLAYER_ID,
    x: WORLD_WIDTH * 0.12,
    y: WORLD_HEIGHT * 0.52,
    garrison: 8,
    capture: 0,
    ...over,
  })
  const baseWorld = (bases: Base[], ships: Ship[]): World => ({
    time: 1,
    ships,
    bullets: [],
    particles: [],
    devices: [],
    beams: [],
    blocks: [],
    terrainVersion: 0,
    water: [],
    bases,
    shake: 0,
    rng: () => 0,
  })

  test('no bases (deathmatch world) → pure DOGFIGHT regardless of the bay', () => {
    const self = makeShip({ troops: 8 })
    const world = baseWorld([], [self])
    expect(nextGoal(BotGoal.ASSAULT, self, world, undefined)).toBe(BotGoal.DOGFIGHT)
  })

  test('an enemy ship inside the threat range overrides everything', () => {
    const self = makeShip({ troops: 8 })
    const target = makeTarget({ x: self.x + 200, y: self.y })
    const world = baseWorld([homeBase({ capture: 0.5 }), enemyBase({})], [self, target])
    expect(nextGoal(BotGoal.ASSAULT, self, world, target)).toBe(BotGoal.DOGFIGHT)
  })

  test('a contested home base pulls the bot to DEFEND', () => {
    const self = makeShip({ troops: 8 })
    const world = baseWorld([homeBase({ capture: 0.2 }), enemyBase({})], [self])
    expect(nextGoal(BotGoal.ASSAULT, self, world, undefined)).toBe(BotGoal.DEFEND)
  })

  test('a low bay sends the bot to REARM, which sticks until topped up', () => {
    const low = makeShip({ troops: 1 })
    const world = baseWorld([homeBase({}), enemyBase({})], [low])
    expect(nextGoal(BotGoal.DOGFIGHT, low, world, undefined)).toBe(BotGoal.REARM)
    const half = makeShip({ troops: 5 }) // above the assault floor, below the rearm-done bar
    expect(nextGoal(BotGoal.REARM, half, world, undefined)).toBe(BotGoal.REARM) // sticky
    const full = makeShip({ troops: 6 })
    expect(nextGoal(BotGoal.REARM, full, world, undefined)).toBe(BotGoal.ASSAULT) // topped up → go
  })

  test('a stocked bay flies the ASSAULT; a dry garrison attacks with what is aboard', () => {
    const stocked = makeShip({ troops: 6 })
    const world = baseWorld([homeBase({}), enemyBase({})], [stocked])
    expect(nextGoal(BotGoal.DOGFIGHT, stocked, world, undefined)).toBe(BotGoal.ASSAULT)
    const scraps = makeShip({ troops: 2 })
    const dry = baseWorld([homeBase({ garrison: 0 }), enemyBase({})], [scraps])
    expect(nextGoal(BotGoal.DOGFIGHT, scraps, dry, undefined)).toBe(BotGoal.ASSAULT)
    const empty = makeShip({ troops: 0 })
    expect(nextGoal(BotGoal.DOGFIGHT, empty, dry, undefined)).toBe(BotGoal.DOGFIGHT)
  })

  test('an ASSAULT bot over the enemy pad streams its drop', () => {
    const foe = enemyBase({})
    const self = makeShip({ id: BOT_ID, troops: 6, x: foe.x + 50, y: foe.y - 500, vx: 0, vy: 0 })
    const world = baseWorld([homeBase({}), foe], [self])
    const input = createBotInput(self, () => world)
    expect(input.deploying()).toBe(true) // inside the drop window, above the pad → bombs away
  })

  test('a REARM bot steers toward its own barracks', () => {
    const home = homeBase({})
    const self = makeShip({ id: BOT_ID, troops: 0, x: home.x - 2000, y: home.y - 1500, angle: 0, vx: 0, vy: 0 })
    const world = baseWorld([home, enemyBase({})], [self])
    const input = createBotInput(self, () => world)
    input.turn() // force a refresh
    // Steering target is down-right of the bot (the pad sits below and to the east): the desired
    // heading has a positive x component, and facing 0 (due east) is within the thrust cone.
    expect(input.thrusting()).toBe(true)
  })
})
