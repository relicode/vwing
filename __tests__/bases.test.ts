import { describe, expect, test } from 'bun:test'

import { createCampaignBases, stepBases } from '$/game/bases'
import {
  BASE_ASSAULT_RATE,
  BASE_BUILDING_HALF_WIDTH,
  BASE_BUILDING_HEIGHT,
  BASE_CAPTURE_RADIUS,
  BASE_CAPTURE_TIME,
  BASE_GARRISON_CAP,
  BASE_GARRISON_START,
  BASE_GUARD_PATROL,
  BASE_GUARD_RESERVE,
  BASE_STORM_CONTACT,
  BASE_STORM_ROOF_SLOTS,
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

const trooper = (
  owner: number,
  x: number,
  y: number,
  attached = true
): Extract<Device, { kind: DeviceKind.INFANTRY }> => ({
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
  storming: false,
  slide: 0,
  burning: 0,
  stun: 0,
  fallen: 0,
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

// Contact spots on that fixture for a radius-9 trooper: pressed flush to a wall face (x), or
// standing on the roof (y for any x over the building span). Storming demands one of these.
const WALL_WEST = 1000 - BASE_BUILDING_HALF_WIDTH - 9
const WALL_EAST = 1000 + BASE_BUILDING_HALF_WIDTH + 9
const ROOF_Y = 3000 - BASE_BUILDING_HEIGHT - 9

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
    const raider = trooper(BOT_ID, base.x + 150, base.y)
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

  test('a housed garrison stalls the clock: a wall-contact stormer batters it to zero first', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE }) // just the reserve cowering inside
    const raider = trooper(BOT_ID, WALL_EAST, base.y) // pressed flush to the east wall
    const world = makeWorld([], [raider], [base])
    stepBases(world, 1)
    expect(base.capture).toBe(0) // the clock can't run over a living garrison
    expect(base.garrison).toBeLessThan(BASE_GUARD_RESERVE) // but the battering bleeds it
    for (let i = 0; i < 60; i += 1) stepBases(world, 1)
    expect(base.garrison).toBe(0)
    expect(base.capture).toBeGreaterThan(0) // emptied — now the takeover ticks
  })

  test('a defender in the zone freezes the takeover', () => {
    const base = makeBase({ capture: 0.4 })
    const world = makeWorld(
      [],
      [trooper(BOT_ID, base.x + 150, base.y), trooper(PLAYER_ID, base.x - 150, base.y)],
      [base]
    )
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

  test('a knocked-flat attacker neither storms nor captures until he scrambles up', () => {
    const base = makeBase({ garrison: 2 })
    const downed = { ...trooper(BOT_ID, WALL_EAST, base.y), fallen: 1 }
    const world = makeWorld([], [downed], [base])
    stepBases(world, 1)
    expect(base.garrison).toBe(2) // flat on his back, even in wall contact: no storming
    expect(base.capture).toBe(0)
    downed.fallen = 0 // back on his feet — the assault resumes
    stepBases(world, 1)
    expect(base.garrison).toBeLessThan(2)
  })

  test('a knocked-flat defender holds nothing — the takeover ticks over his body', () => {
    const base = makeBase({ garrison: 0 })
    const raider = trooper(BOT_ID, base.x + 150, base.y)
    const downed = { ...trooper(PLAYER_ID, base.x - 150, base.y), fallen: 1 }
    const world = makeWorld([], [raider, downed], [base])
    stepBases(world, 1)
    expect(base.capture).toBeGreaterThan(0)
  })

  test('an EMP-seized man is as helpless as a fallen one — no storming, no holding', () => {
    const base = makeBase({ garrison: 2 })
    const seized = { ...trooper(BOT_ID, WALL_EAST, base.y), stun: 1 }
    const world = makeWorld([], [seized], [base])
    stepBases(world, 1)
    expect(base.garrison).toBe(2) // a seized attacker doesn't storm
    expect(base.capture).toBe(0)
    const held = makeBase({ garrison: 0, capture: 0.4 })
    const frozen = { ...trooper(PLAYER_ID, held.x - 150, held.y), stun: 1 }
    const raider = trooper(BOT_ID, held.x + 150, held.y)
    stepBases(makeWorld([], [raider, frozen], [held]), 1)
    expect(held.capture).toBeGreaterThan(0.4) // a seized defender freezes nothing
  })

  test('a downed occupier still occupies: one knockdown blast cannot un-capture a won pad', () => {
    // The capture-war exclusion must not reach a completed capture — the knockdown ring is
    // side-blind, so a single grenade over the muster pad would otherwise clear capturedBy in
    // one frame and (mid-respawn-wait) eliminate a capturer whose men are merely flat.
    const taken = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 0 })
    const occupier = { ...trooper(BOT_ID, taken.x + 30, taken.y), fallen: 2.5 }
    const world = makeWorld([], [occupier], [taken])
    stepBases(world, 1 / 60)
    expect(taken.capture).toBe(1)
    expect(taken.capturedBy).toBe(BOT_ID) // the flag still flies while he scrambles up
    occupier.fallen = 0
    occupier.attached = false // scooped away — NOW the pad really is unheld
    stepBases(world, 1 / 60)
    expect(taken.capture).toBeLessThan(1)
    expect(taken.capturedBy).toBeUndefined()
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

describe('stepBases — the battering crew (contact storming)', () => {
  test('wall-contact attackers on an uncaptured base mark storming and square up to the building', () => {
    // Garrison at the cowering reserve: below the sortie commit threshold nobody steps out, so
    // the squad really is unopposed (a fuller house fields a guard mid-step — a live defender).
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const left = { ...trooper(BOT_ID, WALL_WEST, base.y), facing: -1 }
    const right = { ...trooper(BOT_ID, WALL_EAST, base.y), facing: 1 }
    const world = makeWorld([], [left, right], [base])
    stepBases(world, 1 / 60)
    expect(left.storming).toBe(true)
    expect(right.storming).toBe(true)
    expect(left.facing).toBe(1) // turned to face the building…
    expect(right.facing).toBe(-1) // …from either side
  })

  test('storming is contact-only: a man short of the wall occupies the disc but never grinds', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const loiterer = trooper(BOT_ID, base.x + 200, base.y) // well inside the disc, nowhere near a wall
    const world = makeWorld([], [loiterer], [base])
    stepBases(world, 1)
    expect(loiterer.storming).toBe(false)
    expect(base.garrison).toBe(BASE_GUARD_RESERVE) // not a scratch from across the pad
    expect(base.capture).toBe(0) // and the housed reserve still stalls the clock
  })

  test('each wall holds ONE batterer: the second man at the same face queues unmarked', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const first = trooper(BOT_ID, WALL_EAST, base.y)
    const second = trooper(BOT_ID, WALL_EAST + 2, base.y) // pressed into the same face
    const world = makeWorld([], [first, second], [base])
    const dt = 1 / 60
    stepBases(world, dt)
    expect(first.storming).toBe(true)
    expect(second.storming).toBe(false)
    expect(base.garrison).toBeCloseTo(BASE_GUARD_RESERVE - BASE_ASSAULT_RATE * dt, 8) // one man's work, not two
  })

  test('the roof holds three: a fourth man up top adds nothing', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const roofers = [-60, -20, 20, 60].map((dx) => trooper(BOT_ID, base.x + dx, ROOF_Y))
    const world = makeWorld([], roofers, [base])
    const dt = 1 / 60
    stepBases(world, dt)
    expect(roofers.filter((r) => r.storming)).toHaveLength(BASE_STORM_ROOF_SLOTS)
    expect(base.garrison).toBeCloseTo(BASE_GUARD_RESERVE - BASE_ASSAULT_RATE * BASE_STORM_ROOF_SLOTS * dt, 8)
  })

  test('a full crew — one per wall plus the roof party — grinds at five men’s rate', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const crew = [
      trooper(BOT_ID, WALL_WEST, base.y),
      trooper(BOT_ID, WALL_EAST, base.y),
      trooper(BOT_ID, base.x - 40, ROOF_Y),
      trooper(BOT_ID, base.x, ROOF_Y),
      trooper(BOT_ID, base.x + 40, ROOF_Y),
    ]
    const world = makeWorld([], crew, [base])
    const dt = 1 / 60
    stepBases(world, dt)
    expect(crew.every((c) => c.storming)).toBe(true)
    expect(base.garrison).toBeCloseTo(BASE_GUARD_RESERVE - BASE_ASSAULT_RATE * 5 * dt, 8)
  })

  test('an enemy ship near the pad halts the storm — the men down tools', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const stormer = trooper(BOT_ID, WALL_EAST, base.y)
    const owner = makeShip({ id: PLAYER_ID, x: base.x + 400, y: base.y - 200 }) // the defender swoops in
    const world = makeWorld([owner], [stormer], [base])
    stepBases(world, 1)
    expect(stormer.storming).toBe(false)
    expect(base.garrison).toBe(BASE_GUARD_RESERVE) // nobody batters under a hostile ship
  })

  test('a live enemy trooper near halts the storm — even from outside the disc; a downed one scares nobody', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const stormer = trooper(BOT_ID, WALL_EAST, base.y)
    const defender = trooper(PLAYER_ID, base.x + BASE_CAPTURE_RADIUS + 90, base.y) // outside the disc, inside threat range
    const world = makeWorld([], [stormer, defender], [base])
    stepBases(world, 1 / 60)
    expect(stormer.storming).toBe(false)
    expect(base.garrison).toBe(BASE_GUARD_RESERVE)
    defender.fallen = 1 // flat on his back he threatens nobody — the battering resumes
    stepBases(world, 1 / 60)
    expect(stormer.storming).toBe(true)
    expect(base.garrison).toBeLessThan(BASE_GUARD_RESERVE)
  })

  test('a defender in the zone stops the riot — last frame’s marks expire', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const raider = { ...trooper(BOT_ID, WALL_EAST, base.y), storming: true } // marked last frame
    const defender = trooper(PLAYER_ID, base.x - 150, base.y)
    const world = makeWorld([], [raider, defender], [base])
    stepBases(world, 1 / 60)
    expect(raider.storming).toBe(false)
  })

  test('the helpless and the spectators never mark: fallen, seized, airborne, out of the disc', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const flat = { ...trooper(BOT_ID, WALL_WEST, base.y), fallen: 1 } // in contact, but flat
    const seized = { ...trooper(BOT_ID, WALL_EAST + 2, base.y), stun: 1 }
    const chuting = trooper(BOT_ID, base.x, ROOF_Y - 100, false) // descending on the roof, not on it
    const far = trooper(BOT_ID, base.x + BASE_CAPTURE_RADIUS + 50, base.y)
    const stormer = trooper(BOT_ID, WALL_EAST, base.y)
    const world = makeWorld([], [flat, seized, chuting, far, stormer], [base])
    stepBases(world, 1 / 60)
    expect(stormer.storming).toBe(true) // the one able man in contact
    expect(flat.storming).toBe(false)
    expect(seized.storming).toBe(false)
    expect(chuting.storming).toBe(false)
    expect(far.storming).toBe(false)
  })

  test('occupiers of an already-won pad hold it without the theatrics', () => {
    const taken = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 0 })
    const occupier = trooper(BOT_ID, taken.x + 30, taken.y)
    const world = makeWorld([], [occupier], [taken])
    stepBases(world, 1 / 60)
    expect(occupier.storming).toBe(false)
    expect(taken.capture).toBe(1) // still pinned by his presence
  })

  test('a kneeling specialist or a bolting man still marks, but keeps his own facing', () => {
    // The renderer only swaps the pounding pose in for WALKING/STANDING — a kneeler renders his
    // wind-up and a runner his bolt, so flipping their facing to the door would point a firing
    // bazooka or a sprint the wrong way. The mark itself stays (they storm like everyone else).
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const kneeler = { ...trooper(BOT_ID, WALL_WEST, base.y), kneel: 1, facing: -1 }
    const runner = { ...trooper(BOT_ID, WALL_EAST, base.y), running: true, facing: 1 }
    const world = makeWorld([], [kneeler, runner], [base])
    stepBases(world, 1 / 60)
    expect(kneeler.storming).toBe(true)
    expect(runner.storming).toBe(true)
    expect(kneeler.facing).toBe(-1) // squared up to his target, not the door
    expect(runner.facing).toBe(1) // his legs keep selling the direction he runs
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

describe('the building is indestructible — and a shelter', () => {
  const mineAt = (x: number, y: number): Device => ({
    kind: DeviceKind.MINE,
    x,
    y,
    owner: BOT_ID,
    radius: 6,
    armTime: 0,
    life: 5,
    triggerRadius: 60,
    blastRadius: 90,
    damage: 40,
  })

  test('a mine blast hugging the building grinds NOTHING off the housed garrison', () => {
    const tripper = makeShip({ id: PLAYER_ID, x: 1120, y: 2960 }) // walks into the enemy mine by the wall
    const base = makeBase({}) // player barracks at (1000, 3000): the blast laps the east wall
    const world = makeWorld([tripper], [mineAt(1120, 2960)], [base])
    updateDevices(world, 0.016)
    expect(world.devices).toHaveLength(0) // the mine really did go off…
    expect(base.garrison).toBe(BASE_GARRISON_START) // …and the walls shrugged the whole blast off
  })

  test('the walls shelter the holder`s men: a blast outside kills the exposed, never the housed watch', () => {
    const tripper = makeShip({ id: PLAYER_ID, x: 1120, y: 2960 })
    const sheltered = trooper(PLAYER_ID, 1090, 2991) // inside the building box, near the east wall
    const exposed = trooper(PLAYER_ID, 1130, 2991) // on the pad outside, same distance from the mine
    const base = makeBase({})
    const world = makeWorld([tripper], [mineAt(1120, 2960), sheltered, exposed], [base])
    updateDevices(world, 0.016)
    expect(world.devices).toContain(sheltered) // the walls ate the blast…
    expect(sheltered.fallen).toBe(0) // …and its shockwave
    expect(world.devices).not.toContain(exposed)
  })
})

describe('the assault on foot — march, walls, roof', () => {
  const padBlock = { x: 600, y: 3000, w: 800, h: 60, structure: StructureType.METAL, surface: Surface.EARTH }

  test('an unopposed attacker in the disc marches to the wall, plants, and batters', () => {
    const base = makeBase({ garrison: BASE_GUARD_RESERVE })
    const raider = { ...trooper(BOT_ID, base.x + 300, 2991), groundLeft: 600, groundRight: 1400 }
    const world = makeWorld([], [raider], [base])
    world.blocks = [padBlock]
    for (let i = 0; i < 30 * 8; i += 1) {
      stepBases(world, 1 / 30)
      updateDevices(world, 1 / 30)
    }
    expect(Math.abs(raider.x - WALL_EAST)).toBeLessThanOrEqual(BASE_STORM_CONTACT) // at the east face, in contact
    expect(raider.storming).toBe(true)
    expect(base.garrison).toBeLessThan(BASE_GUARD_RESERVE) // and already at work
  })

  test('a storming man slings his rifle: no fire even with a target in range', () => {
    // No bases in these worlds: the manual mark stands in for stepBases' (which would clear it
    // here — a ship this close to the pad is a threat); under test is devices.ts honoring it.
    const stormer = { ...trooper(BOT_ID, 1119, 2991), storming: true, fireCooldown: 0 }
    const held = makeWorld([makeShip({ id: PLAYER_ID, x: 1300, y: 2960 })], [stormer], [])
    held.blocks = [padBlock]
    for (let i = 0; i < 30; i += 1) updateDevices(held, 1 / 30)
    expect(held.bullets).toHaveLength(0) // both fists on the building

    const rifleman = { ...trooper(BOT_ID, 1119, 2991), fireCooldown: 0 }
    const free = makeWorld([makeShip({ id: PLAYER_ID, x: 1300, y: 2960 })], [rifleman], [])
    free.blocks = [padBlock]
    for (let i = 0; i < 30; i += 1) updateDevices(free, 1 / 30)
    expect(free.bullets.length).toBeGreaterThan(0) // the unmarked control blazes away
  })

  test('an enemy chute settles on the bunker roof; the holder`s man falls through into the shelter', () => {
    const base = makeBase({})
    const invader = trooper(BOT_ID, base.x, ROOF_Y - 40, false) // falling, 40 px over the roof
    const housemate = trooper(PLAYER_ID, base.x, ROOF_Y - 40, false)
    const world = makeWorld([], [invader, housemate], [base])
    world.blocks = [padBlock]
    for (let i = 0; i < 90; i += 1) updateDevices(world, 1 / 30)
    expect(invader.attached).toBe(true)
    expect(invader.y + invader.radius).toBeCloseTo(base.y - BASE_BUILDING_HEIGHT, 5) // feet on the roof
    expect(invader.groundLeft).toBe(base.x - BASE_BUILDING_HALF_WIDTH) // the roof is his patrol span
    expect(invader.groundRight).toBe(base.x + BASE_BUILDING_HALF_WIDTH)
    expect(housemate.attached).toBe(true)
    expect(housemate.y + housemate.radius).toBeCloseTo(base.y, 5) // straight through to the pad inside
  })

  test('a storming sapper plants nothing — the satchel stays shut', () => {
    const sapper = { ...trooper(BOT_ID, 1119, 2991), heavy: WeaponKind.MINES, storming: true, fireCooldown: 0 }
    const held = makeWorld([], [sapper], [])
    held.blocks = [padBlock]
    for (let i = 0; i < 30; i += 1) updateDevices(held, 1 / 30)
    expect(held.devices.some((d) => d.kind === DeviceKind.MINE)).toBe(false)

    const free = { ...trooper(BOT_ID, 1119, 2991), heavy: WeaponKind.MINES, fireCooldown: 0 }
    const patrol = makeWorld([], [free], [])
    patrol.blocks = [padBlock]
    for (let i = 0; i < 30; i += 1) updateDevices(patrol, 1 / 30)
    expect(patrol.devices.some((d) => d.kind === DeviceKind.MINE)).toBe(true) // the unmarked control seeds
  })

  test('a storming specialist never starts the brace — no kneel, no round', () => {
    const stormer = { ...trooper(BOT_ID, 1119, 2991), heavy: WeaponKind.GRENADE, storming: true, fireCooldown: 0 }
    const held = makeWorld([makeShip({ id: PLAYER_ID, x: 1300, y: 2960 })], [stormer], [])
    held.blocks = [padBlock]
    for (let i = 0; i < 60; i += 1) updateDevices(held, 1 / 30)
    expect(stormer.kneel).toBe(0)
    expect(held.devices.some((d) => d.kind === DeviceKind.GRENADE)).toBe(false)

    const grenadier = { ...trooper(BOT_ID, 1119, 2991), heavy: WeaponKind.GRENADE, fireCooldown: 0 }
    const free = makeWorld([makeShip({ id: PLAYER_ID, x: 1300, y: 2960 })], [grenadier], [])
    free.blocks = [padBlock]
    let braced = false
    for (let i = 0; i < 60; i += 1) {
      updateDevices(free, 1 / 30)
      braced ||= grenadier.kneel > 0
    }
    expect(braced).toBe(true) // the unmarked control drops to a knee for his target
  })

  test('the walls stop a walker: an enemy trooper overlapping the building is shoved back out', () => {
    const base = makeBase({})
    const intruder = { ...trooper(BOT_ID, base.x - 80, 2991), groundLeft: 600, groundRight: 1400 }
    const world = makeWorld([], [intruder], [base])
    world.blocks = [padBlock]
    updateDevices(world, 1 / 30)
    expect(intruder.x).toBe(WALL_WEST) // out the nearest (west) face, flush against it
  })
})
