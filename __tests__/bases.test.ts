import { describe, expect, test } from 'bun:test'

import { createCampaignBases, stepBases } from '$/game/bases'
import {
  BASE_CAPTURE_RADIUS,
  BASE_CAPTURE_TIME,
  BASE_GARRISON_CAP,
  BASE_GARRISON_START,
  BASE_LOAD_RATE,
  BOT_ID,
  DeviceKind,
  PLAYER_ID,
  ShipKind,
  TROOP_BAY_CAPACITY,
  WeaponKind,
} from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Base, Device, Ship, World } from '$/game/types'

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
  shields: 0,
  weapon: WeaponKind.SCATTERGUN,
  charge: 100,
  altCooldown: 0,
  disabled: 0,
  troops: 0,
  squad: WeaponKind.GRENADE,
  deployCooldown: 0,
  ...over,
})

const trooper = (owner: number, x: number, y: number, attached = true): Device => ({
  kind: DeviceKind.INFANTRY,
  x,
  y,
  vx: 0,
  vy: 0,
  owner,
  radius: 9,
  attached,
  swim: 0,
  sinking: 0,
  chute: -1,
  pickupLock: 0,
  walkDir: 1,
  facing: 1,
  groundLeft: x - 100,
  groundRight: x + 100,
  fireCooldown: 99, // hold fire — these tests are about presence, not shooting
  kneel: 0,
  running: false,
  slide: 0,
})

const makeWorld = (ships: Ship[], devices: Device[], bases: Base[]): World => ({
  time: 0,
  ships,
  bullets: [],
  particles: [],
  devices,
  beams: [],
  blocks: [],
  terrainVersion: 0,
  water: [],
  bases,
  shake: 0,
  rng: createRng(1),
})

// A lone base fixture parked away from world edges; tests place actors relative to it.
const makeBase = (over: Partial<Base>): Base => ({
  owner: PLAYER_ID,
  x: 1000,
  y: 3000,
  garrison: BASE_GARRISON_START,
  capture: 0,
  ...over,
})

describe('createCampaignBases', () => {
  test('seats one barracks per side on the two pads, west player / east bot', () => {
    const bases = createCampaignBases()
    expect(bases).toHaveLength(2)
    expect(bases[0].owner).toBe(PLAYER_ID)
    expect(bases[1].owner).toBe(BOT_ID)
    expect(bases[0].x).toBeLessThan(bases[1].x)
    expect(bases[0].garrison).toBe(BASE_GARRISON_START)
  })
})

describe('stepBases — garrison + loading', () => {
  test('the garrison regrows over time up to its cap', () => {
    const base = makeBase({ garrison: 0 })
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 60; i += 1) stepBases(world, 1)
    expect(base.garrison).toBeGreaterThan(0)
    for (let i = 0; i < 600; i += 1) stepBases(world, 1)
    expect(base.garrison).toBe(BASE_GARRISON_CAP)
  })

  test('a slow owner ship by the pad loads garrison into its bay at the load rate', () => {
    const base = makeBase({})
    const owner = makeShip({ id: PLAYER_ID, x: base.x, y: base.y - 40, vx: 10, vy: 0, troops: 0 })
    const world = makeWorld([owner], [], [base])
    stepBases(world, 1)
    expect(owner.troops).toBeCloseTo(BASE_LOAD_RATE, 5)
    expect(base.garrison).toBeCloseTo(BASE_GARRISON_START + 0.15 - BASE_LOAD_RATE, 5) // regen 0.15 also ticked
  })

  test('loading stops at the bay cap and never goes negative on the garrison', () => {
    const base = makeBase({ garrison: 1 })
    const owner = makeShip({ id: PLAYER_ID, x: base.x, y: base.y - 40, troops: TROOP_BAY_CAPACITY - 0.5 })
    const world = makeWorld([owner], [], [base])
    for (let i = 0; i < 10; i += 1) stepBases(world, 1)
    expect(owner.troops).toBe(TROOP_BAY_CAPACITY)
    expect(base.garrison).toBeGreaterThanOrEqual(0)
  })

  test('a fast fly-by, a far ship, or an enemy ship loads nothing', () => {
    const base = makeBase({})
    const fast = makeShip({ id: PLAYER_ID, x: base.x, y: base.y - 40, vx: 500 })
    const far = makeShip({ id: PLAYER_ID, x: base.x + 4000, y: base.y - 40 })
    const enemy = makeShip({ id: BOT_ID, x: base.x, y: base.y - 40 })
    for (const ship of [fast, far, enemy]) {
      const world = makeWorld([ship], [], [makeBase({})])
      for (let i = 0; i < 10; i += 1) stepBases(world, 1)
      expect(ship.troops).toBe(0)
    }
  })
})

describe('stepBases — capture tug-of-war', () => {
  test('uncontested attackers push capture; crossing 1 records the capturer and halts regen/loading', () => {
    const base = makeBase({})
    const raider = trooper(BOT_ID, base.x + 50, base.y)
    const owner = makeShip({ id: PLAYER_ID, x: base.x, y: base.y - 40, troops: 0 })
    const world = makeWorld([owner], [raider], [base])
    stepBases(world, BASE_CAPTURE_TIME / 2)
    expect(base.capture).toBeCloseTo(0.5, 5)
    stepBases(world, BASE_CAPTURE_TIME) // overshoot clamps at 1
    expect(base.capture).toBe(1)
    expect(base.capturedBy).toBe(BOT_ID)
    const garrisonAtFall = base.garrison
    const troopsAtFall = owner.troops
    stepBases(world, 10)
    expect(base.garrison).toBe(garrisonAtFall) // no regen while captured
    expect(owner.troops).toBe(troopsAtFall) // no loading while captured
  })

  test('a defender in the zone freezes the takeover', () => {
    const base = makeBase({ capture: 0.4 })
    const world = makeWorld([], [trooper(BOT_ID, base.x + 50, base.y), trooper(PLAYER_ID, base.x - 50, base.y)], [base])
    stepBases(world, 5)
    expect(base.capture).toBe(0.4)
  })

  test('an emptied zone bleeds progress back, and a captured base re-liberates the same way', () => {
    const fallen = makeBase({ capture: 1, capturedBy: BOT_ID })
    const world = makeWorld([], [], [fallen])
    stepBases(world, 1)
    expect(fallen.capture).toBeLessThan(1)
    expect(fallen.capturedBy).toBeUndefined() // dropping below 1 IS the re-liberation
    stepBases(world, 60)
    expect(fallen.capture).toBe(0)
  })

  test('airborne (chuting) troopers do not count — only landed ones contest or capture', () => {
    const base = makeBase({})
    const world = makeWorld([], [trooper(BOT_ID, base.x, base.y - 100, false)], [base])
    stepBases(world, 5)
    expect(base.capture).toBe(0)
  })

  test('troopers outside the capture disc are spectators', () => {
    const base = makeBase({})
    const world = makeWorld([], [trooper(BOT_ID, base.x + BASE_CAPTURE_RADIUS + 50, base.y)], [base])
    stepBases(world, 5)
    expect(base.capture).toBe(0)
  })
})
