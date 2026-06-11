import { describe, expect, test } from 'bun:test'

import { createCampaignBases, damageBase, stepBases } from '$/game/bases'
import {
  BASE_CAPTURE_RADIUS,
  BASE_CAPTURE_TIME,
  BASE_GARRISON_CAP,
  BASE_GARRISON_START,
  BASE_GUARD_PATROL,
  BASE_GUARD_RESERVE,
  BASE_STRUCTURE_ARMOR,
  BaseAlarm,
  BOT_ID,
  DeviceKind,
  PLAYER_ID,
  ShipKind,
  StructureType,
  Surface,
  TROOP_BAY_CAPACITY,
  WeaponKind,
} from '$/game/constants'
import { resolveInfantryContacts, updateDevices } from '$/game/devices'
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
  reversing: false,
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
  guard: false,
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
  burning: 0,
  stun: 0,
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
  alarm: BaseAlarm.PATROL,
  door: 0,
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

// Count this base's fielded guard troopers.
const guardsOf = (world: World, base: Base): number =>
  world.devices.filter((d) => d.kind === DeviceKind.INFANTRY && d.guard && d.owner === base.owner).length

describe('stepBases — garrison + loading', () => {
  test('the garrison regrows (slowly) up to its cap, counting housed AND fielded guards', () => {
    const base = makeBase({ garrison: 0 })
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 60; i += 1) stepBases(world, 1)
    expect(base.garrison + guardsOf(world, base)).toBeGreaterThan(0)
    for (let i = 0; i < 600; i += 1) stepBases(world, 1)
    expect(base.garrison + guardsOf(world, base)).toBe(BASE_GARRISON_CAP)
    expect(guardsOf(world, base)).toBe(BASE_GUARD_PATROL) // the watch is out, the rest housed
  })

  test('a landed owner by the pad opens the doors: the men stream out, run over, and board by touch — down to an empty house', () => {
    const base = makeBase({ garrison: 5 })
    const owner = makeShip({ id: PLAYER_ID, x: base.x + 40, y: base.y - 12, vx: 0, vy: 0, troops: 0 }) // resting on the pad
    const world = makeWorld([owner], [], [base])
    world.blocks = [
      { x: base.x - 400, y: base.y, w: 800, h: 60, structure: StructureType.METAL, surface: Surface.EARTH },
    ]
    for (let i = 0; i < 900; i += 1) {
      // 30 s: the door cadence + each man's walk to the hull
      stepBases(world, 1 / 30)
      updateDevices(world, 1 / 30)
      resolveInfantryContacts(world)
    }
    expect(owner.troops).toBeGreaterThanOrEqual(5) // the whole house came aboard (plus any regen trickle)
    expect(base.garrison).toBeLessThan(1)
    expect(guardsOf(world, base)).toBeLessThanOrEqual(1) // at most the freshest walker still en route
  })

  test('boarding respects the bay cap: a full ship takes nobody else aboard', () => {
    const base = makeBase({ garrison: 4 })
    const owner = makeShip({ id: PLAYER_ID, x: base.x, y: base.y - 12, vx: 0, vy: 0, troops: TROOP_BAY_CAPACITY })
    const world = makeWorld([owner], [], [base])
    world.blocks = [
      { x: base.x - 400, y: base.y, w: 800, h: 60, structure: StructureType.METAL, surface: Surface.EARTH },
    ]
    for (let i = 0; i < 300; i += 1) {
      stepBases(world, 1 / 30)
      updateDevices(world, 1 / 30)
      resolveInfantryContacts(world)
    }
    expect(owner.troops).toBe(TROOP_BAY_CAPACITY)
    expect(base.garrison + guardsOf(world, base)).toBeGreaterThanOrEqual(4) // nobody vanished into a full bay
  })

  test('a fast fly-by, a far ship, or an enemy ship boards nothing', () => {
    const base = makeBase({})
    const fast = makeShip({ id: PLAYER_ID, x: base.x, y: base.y - 40, vx: 500 })
    const far = makeShip({ id: PLAYER_ID, x: base.x + 4000, y: base.y - 40 })
    const enemy = makeShip({ id: BOT_ID, x: base.x, y: base.y - 40 })
    for (const ship of [fast, far, enemy]) {
      const world = makeWorld([ship], [], [makeBase({})])
      world.blocks = [{ x: 600, y: 3000, w: 800, h: 60, structure: StructureType.METAL, surface: Surface.EARTH }]
      for (let i = 0; i < 150; i += 1) {
        stepBases(world, 1 / 30)
        updateDevices(world, 1 / 30)
        resolveInfantryContacts(world)
      }
      expect(ship.troops).toBe(0)
    }
  })
})

describe('stepBases — capture tug-of-war', () => {
  test('uncontested attackers push capture once the garrison is dead; crossing 1 records the capturer and halts regen/loading', () => {
    const base = makeBase({ garrison: 0 }) // an emptied barracks — the capture clock can run
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

  test('a housed garrison stalls the clock: attackers storm the building, chipping it to zero first', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE }) // just the reserve cowering inside
    const raider = trooper(BOT_ID, base.x + 50, base.y)
    const world = makeWorld([], [raider], [base])
    stepBases(world, 1)
    expect(base.capture).toBe(0) // the clock can't run over a living garrison
    expect(base.garrison).toBeLessThan(BASE_GUARD_RESERVE) // but the storming bleeds it
    for (let i = 0; i < 60; i += 1) stepBases(world, 1)
    expect(base.garrison).toBe(0)
    expect(base.capture).toBeGreaterThan(0) // emptied — now the takeover ticks
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

describe('stepBases — the garrison in the flesh', () => {
  test('fields a standing patrol in peacetime, then hides it indoors from an enemy ship', () => {
    const base = makeBase({})
    const world = makeWorld([], [], [base])
    // Ground under the pad so landed guards keep their footing once updateDevices runs.
    world.blocks = [
      { x: base.x - 400, y: base.y, w: 800, h: 60, structure: StructureType.EARTH, surface: Surface.GRASS },
    ]
    for (let i = 0; i < 50; i += 1) stepBases(world, 0.1)
    expect(base.alarm).toBe(BaseAlarm.PATROL)
    expect(guardsOf(world, base)).toBe(BASE_GUARD_PATROL)
    expect(base.garrison).toBeGreaterThanOrEqual(BASE_GARRISON_START - BASE_GUARD_PATROL) // housed (+ a regen trickle)
    expect(base.garrison).toBeLessThan(BASE_GARRISON_START - BASE_GUARD_PATROL + 0.5)
    // An enemy ship in sight: the watch runs for the door and slips back inside, where no
    // strafing run can reach it — the housed count swells back to (regen aside) the start.
    world.ships.push(makeShip({ id: BOT_ID, kind: ShipKind.BOT, x: base.x + 300, y: base.y - 200 }))
    for (let i = 0; i < 600; i += 1) {
      stepBases(world, 1 / 30)
      updateDevices(world, 1 / 30)
    }
    expect(base.alarm).toBe(BaseAlarm.HIDE)
    expect(guardsOf(world, base)).toBe(0)
    expect(base.garrison).toBeGreaterThanOrEqual(BASE_GARRISON_START)
  })

  test('a sortie fields everyone but the reserve when enemy infantry land nearby', () => {
    const base = makeBase({})
    const raider = trooper(BOT_ID, base.x + 300, base.y)
    const world = makeWorld([], [raider], [base])
    for (let i = 0; i < 100; i += 1) stepBases(world, 0.1)
    expect(base.alarm).toBe(BaseAlarm.SORTIE)
    expect(base.garrison).toBeCloseTo(BASE_GUARD_RESERVE, 5)
    expect(guardsOf(world, base)).toBe(BASE_GARRISON_START - BASE_GUARD_RESERVE)
  })

  test('fielded guards count against the regen cap — cycling the door grows nothing', () => {
    const base = makeBase({ garrison: BASE_GARRISON_CAP })
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 200; i += 1) stepBases(world, 0.5) // 100 s of peacetime
    expect(base.garrison + guardsOf(world, base)).toBe(BASE_GARRISON_CAP)
  })

  test('a captured barracks fields nobody and absorbs nobody', () => {
    const base = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 5 })
    const raider = trooper(BOT_ID, base.x + 50, base.y) // holds the zone so capture stays pinned at 1
    const world = makeWorld([], [raider], [base])
    for (let i = 0; i < 20; i += 1) stepBases(world, 0.5)
    expect(guardsOf(world, base)).toBe(0)
    expect(base.garrison).toBe(5) // frozen — no regen, no fielding, no storming needed (already fallen)
  })
})

describe('damageBase — shelling the building', () => {
  test('weapon damage grinds the housed garrison through the armor', () => {
    const base = makeBase({})
    damageBase(makeWorld([], [], [base]), base, BASE_STRUCTURE_ARMOR) // exactly one man's worth
    expect(base.garrison).toBeCloseTo(BASE_GARRISON_START - 1, 5)
  })

  test('gunfire never grinds below the guard reserve — the last men must be stormed out', () => {
    const base = makeBase({})
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 50; i += 1) damageBase(world, base, BASE_STRUCTURE_ARMOR)
    expect(base.garrison).toBe(BASE_GUARD_RESERVE)
  })

  test('a garrison already stormed under the reserve is neither chipped further nor topped up', () => {
    const base = makeBase({ garrison: 0.5 })
    damageBase(makeWorld([], [], [base]), base, BASE_STRUCTURE_ARMOR * 10)
    expect(base.garrison).toBe(0.5)
  })

  test('a fallen barracks is past hurting', () => {
    const base = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 5 })
    damageBase(makeWorld([], [], [base]), base, BASE_STRUCTURE_ARMOR * 10)
    expect(base.garrison).toBe(5)
  })

  test('a mine blast by the building chips the garrison through the same armor — but not the owner side`s own', () => {
    const tripper = makeShip({ id: PLAYER_ID, x: 1000, y: 2940 }) // walks into the enemy mine by the pad
    const mine: Device = {
      kind: DeviceKind.MINE,
      x: 1000,
      y: 2940,
      owner: BOT_ID,
      radius: 6,
      armTime: 0,
      life: 5,
      triggerRadius: 60,
      blastRadius: 90,
      damage: 40,
    }
    const shelled = makeBase({}) // player barracks at (1000, 3000): building center ~34 px from the blast
    const world = makeWorld([tripper], [mine], [shelled])
    updateDevices(world, 0.016)
    expect(shelled.garrison).toBeCloseTo(BASE_GARRISON_START - 40 / BASE_STRUCTURE_ARMOR, 5)

    const own = makeBase({ owner: BOT_ID }) // the blast owner's own base shrugs the same splash off
    const friendly = makeWorld([makeShip({ id: PLAYER_ID, x: 1000, y: 2940 })], [{ ...mine }], [own])
    updateDevices(friendly, 0.016)
    expect(own.garrison).toBe(BASE_GARRISON_START)
  })
})
