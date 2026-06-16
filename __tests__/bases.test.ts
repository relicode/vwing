import { describe, expect, test } from 'bun:test'

import { createCampaignBases, shellBase, stepBases } from '$/game/bases'
import {
  BASE_ACTIVE_DEFENDERS,
  BASE_BUILDING_HALF_WIDTH,
  BASE_BUILDING_HEIGHT,
  BASE_CAPTURE_RADIUS,
  BASE_GARRISON_CAP,
  BASE_GARRISON_START,
  BASE_SHELL_KILL_DAMAGE,
  BASE_STORM_ROOF_SLOTS,
  BASE_STORM_SIDE_TIME,
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
import type { Base, Device, InfantryDevice, Ship, World } from '$/game/types'

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

const trooper = (owner: number, x: number, y: number, attached = true): InfantryDevice => ({
  kind: DeviceKind.INFANTRY,
  x,
  y,
  vx: 0,
  vy: 0,
  owner,
  radius: 9,
  guard: false,
  attached,
  wade: 0,
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
  panic: 0,
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
  waterVersion: 0,
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

// Count this base's fielded defenders (guard troopers standing inside the building).
const guardsOf = (world: World, base: Base): number =>
  world.devices.filter((d) => d.kind === DeviceKind.INFANTRY && d.guard && d.owner === base.owner).length

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

describe('stepBases — defender fielding + regen', () => {
  test('mans a firing line of BASE_ACTIVE_DEFENDERS inside, regrows the reserve to the cap', () => {
    const base = makeBase({ garrison: BASE_GARRISON_START })
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 200; i += 1) stepBases(world, 1)
    expect(guardsOf(world, base)).toBe(BASE_ACTIVE_DEFENDERS) // four men on the line
    expect(base.garrison + guardsOf(world, base)).toBe(BASE_GARRISON_CAP) // the rest in reserve, topped up
  })

  test('reserve regrows from empty (counting fielded + reserve against the cap)', () => {
    const base = makeBase({ garrison: 0 })
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 30; i += 1) stepBases(world, 1)
    expect(base.garrison + guardsOf(world, base)).toBeGreaterThan(0)
    for (let i = 0; i < 600; i += 1) stepBases(world, 1)
    expect(base.garrison + guardsOf(world, base)).toBe(BASE_GARRISON_CAP)
  })

  test('regen PAUSES under a ground assault (enemy troopers in the disc) — but the line is still manned', () => {
    const base = makeBase({ garrison: 1 })
    const raider = trooper(BOT_ID, base.x + 200, base.y) // landed in the disc, not at a wall
    const world = makeWorld([], [raider], [base])
    for (let i = 0; i < 200; i += 1) stepBases(world, 1)
    expect(guardsOf(world, base)).toBeGreaterThan(0) // the one reserve man stepped to the line
    expect(base.garrison + guardsOf(world, base)).toBeLessThanOrEqual(1) // …and no reinforcement mustered
  })

  test('a landed owner by the pad opens the doors: the men stream out, run over, and board by touch', () => {
    const base = makeBase({ garrison: 5 })
    const owner = makeShip({ id: PLAYER_ID, x: base.x + 40, y: base.y - 12, vx: 0, vy: 0, troops: 0 }) // resting on the pad
    const world = makeWorld([owner], [], [base])
    world.blocks = [
      { x: base.x - 400, y: base.y, w: 800, h: 60, structure: StructureType.METAL, surface: Surface.EARTH },
    ]
    for (let i = 0; i < 900; i += 1) {
      stepBases(world, 1 / 30)
      updateDevices(world, 1 / 30)
      resolveInfantryContacts(world)
    }
    expect(owner.troops).toBeGreaterThanOrEqual(5) // the house (and the regen trickle) came aboard
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

  test('alarm is a threat SENSOR only — the line stays manned whatever it reads', () => {
    const base = makeBase({})
    const peace = makeWorld([], [], [base])
    for (let i = 0; i < 100; i += 1) stepBases(peace, 0.1)
    expect(base.alarm).toBe(BaseAlarm.PATROL)
    expect(guardsOf(peace, base)).toBe(BASE_ACTIVE_DEFENDERS)

    // An enemy ship in sight reads HIDE — but the defenders do NOT bolt indoors; they hold.
    const shipBase = makeBase({})
    const shelled = makeWorld(
      [makeShip({ id: BOT_ID, kind: ShipKind.BOT, x: shipBase.x + 300, y: shipBase.y - 200 })],
      [],
      [shipBase]
    )
    for (let i = 0; i < 100; i += 1) stepBases(shelled, 0.1)
    expect(shipBase.alarm).toBe(BaseAlarm.HIDE)
    expect(guardsOf(shelled, shipBase)).toBe(BASE_ACTIVE_DEFENDERS)

    // Enemy infantry on the ground reads SORTIE — again, the line just holds (no sally).
    const groundBase = makeBase({})
    const stormed = makeWorld([], [trooper(BOT_ID, groundBase.x + 300, groundBase.y)], [groundBase])
    for (let i = 0; i < 100; i += 1) stepBases(stormed, 0.1)
    expect(groundBase.alarm).toBe(BaseAlarm.SORTIE)
    expect(guardsOf(stormed, groundBase)).toBe(BASE_ACTIVE_DEFENDERS)
  })

  test('a captured barracks fields nobody and regrows nobody', () => {
    const base = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 5 })
    const raider = trooper(BOT_ID, base.x + 50, base.y) // holds the zone so capture stays pinned at 1
    const world = makeWorld([], [raider], [base])
    for (let i = 0; i < 40; i += 1) stepBases(world, 0.5)
    expect(guardsOf(world, base)).toBe(0)
    expect(base.garrison).toBe(5) // frozen — no regen, no fielding
  })
})

describe('shellBase — shelling the defenders', () => {
  test('a certain-damage strike kills a fielded defender first (a visible casualty), then the reserve', () => {
    const base = makeBase({ garrison: 3 })
    const defender: InfantryDevice = { ...trooper(PLAYER_ID, base.x, base.y - 9), guard: true } // standing inside
    const world = makeWorld([], [defender], [base])
    shellBase(world, base, BASE_SHELL_KILL_DAMAGE) // P = 1 → certain
    expect(world.devices).not.toContain(defender) // the man on the line fell
    expect(base.garrison).toBe(3) // reserve untouched while a fielded man stood
    shellBase(world, base, BASE_SHELL_KILL_DAMAGE) // none fielded now → the reserve takes it
    expect(base.garrison).toBe(2)
  })

  test('a captured fort and a zero-damage round are shrugged off', () => {
    const taken = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 4 })
    const w1 = makeWorld([], [], [taken])
    shellBase(w1, taken, BASE_SHELL_KILL_DAMAGE)
    expect(taken.garrison).toBe(4)

    const base = makeBase({ garrison: 4 })
    const w2 = makeWorld([], [], [base])
    shellBase(w2, base, 0)
    expect(base.garrison).toBe(4)
  })

  test('lethality scales with damage: many P=0.2 strikes thin the garrison roughly in proportion', () => {
    const base = makeBase({ garrison: 100 })
    const world = makeWorld([], [], [base])
    for (let i = 0; i < 300; i += 1) shellBase(world, base, BASE_SHELL_KILL_DAMAGE * 0.2)
    const killed = 100 - base.garrison
    expect(killed).toBeGreaterThan(30) // ~60 expected; loose bounds (the roll is seeded + deterministic)
    expect(killed).toBeLessThan(90)
  })
})

describe('stepBases — storming an emptied fort', () => {
  // Empty fort = no reserve and no fielded line: storming runs ONLY here.
  const emptyFort = () => makeBase({ garrison: 0 })

  test('one soldier on a side storms in BASE_STORM_SIDE_TIME seconds', () => {
    const base = emptyFort()
    const world = makeWorld([], [trooper(BOT_ID, WALL_EAST, base.y)], [base])
    stepBases(world, BASE_STORM_SIDE_TIME / 2)
    expect(base.capture).toBeCloseTo(0.5, 5)
    stepBases(world, BASE_STORM_SIDE_TIME) // overshoot clamps and records the capturer
    expect(base.capture).toBe(1)
    expect(base.capturedBy).toBe(BOT_ID)
  })

  test('flanked on both sides storms in half the time', () => {
    const base = emptyFort()
    const world = makeWorld([], [trooper(BOT_ID, WALL_WEST, base.y), trooper(BOT_ID, WALL_EAST, base.y)], [base])
    stepBases(world, BASE_STORM_SIDE_TIME / 4) // two sides → 1/4 of the single-side time = half of the half
    expect(base.capture).toBeCloseTo(0.5, 5)
  })

  test('all three sides — both walls and the roof — storm in a third of the single-side time', () => {
    const base = emptyFort()
    const crew = [
      trooper(BOT_ID, WALL_WEST, base.y),
      trooper(BOT_ID, WALL_EAST, base.y),
      trooper(BOT_ID, base.x, ROOF_Y),
    ]
    const world = makeWorld([], crew, [base])
    stepBases(world, BASE_STORM_SIDE_TIME / 6) // three sides → 3× rate → half storms in 1/6 the single-side time
    expect(base.capture).toBeCloseTo(0.5, 5)
    stepBases(world, BASE_STORM_SIDE_TIME) // overshoot clamps and records the capturer
    expect(base.capture).toBe(1)
    expect(base.capturedBy).toBe(BOT_ID)
  })

  test('the roof is the north side: a lone roofer storms at the one-side rate, extra roofers add nothing', () => {
    const base = emptyFort()
    const roofers = [-40, 0, 40].map((dx) => trooper(BOT_ID, base.x + dx, ROOF_Y)) // three on the roof
    const world = makeWorld([], roofers, [base])
    stepBases(world, BASE_STORM_SIDE_TIME / 2) // the roof is ONE side → half in half the single-side time
    expect(base.capture).toBeCloseTo(0.5, 5) // not 3× — extra roofers on the same side don't stack
  })

  test('a manned fort cannot be stormed: defenders gate it shut until they are cleared', () => {
    const base = makeBase({ garrison: 2 }) // a living reserve — fields to the line, never empty
    const raider = trooper(BOT_ID, WALL_EAST, base.y)
    const world = makeWorld([], [raider], [base])
    for (let i = 0; i < 600; i += 1) stepBases(world, 1 / 60)
    expect(base.capture).toBe(0)
    expect(raider.storming).toBe(false) // no pounding while a defender stands
  })
})

describe('stepBases — the battering crew (contact storming)', () => {
  const emptyFort = () => makeBase({ garrison: 0 })

  test('wall-contact attackers on an emptied fort mark storming and square up to the building', () => {
    const base = emptyFort()
    const left = { ...trooper(BOT_ID, WALL_WEST, base.y), facing: -1 }
    const right = { ...trooper(BOT_ID, WALL_EAST, base.y), facing: 1 }
    const world = makeWorld([], [left, right], [base])
    stepBases(world, 1 / 60)
    expect(left.storming).toBe(true)
    expect(right.storming).toBe(true)
    expect(left.facing).toBe(1) // turned to face the building…
    expect(right.facing).toBe(-1) // …from either side
  })

  test('storming is contact-only: a man short of the wall occupies the disc but never breaches', () => {
    const base = emptyFort()
    const loiterer = trooper(BOT_ID, base.x + 200, base.y) // inside the disc, nowhere near a wall
    const world = makeWorld([], [loiterer], [base])
    stepBases(world, 1)
    expect(loiterer.storming).toBe(false)
    expect(base.capture).toBe(0) // no side pressed, no progress
  })

  test('each wall holds ONE batterer: a second man at the same face queues unmarked, and the rate stays one-side', () => {
    const base = emptyFort()
    const first = trooper(BOT_ID, WALL_EAST, base.y)
    const second = trooper(BOT_ID, WALL_EAST + 2, base.y) // pressed into the same face
    const world = makeWorld([], [first, second], [base])
    stepBases(world, BASE_STORM_SIDE_TIME / 2)
    expect(first.storming).toBe(true)
    expect(second.storming).toBe(false)
    expect(base.capture).toBeCloseTo(0.5, 5) // one side's rate, not two
  })

  test('the roof marks three for the pounding pose: a fourth man up top adds nothing', () => {
    // One wall + a roof crowd: the wall makes progress, the roof is render-crew only (no second
    // wall, so no instant breach) — three of the four roofers get the storming mark.
    const base = emptyFort()
    const roofers = [-60, -20, 20, 60].map((dx) => trooper(BOT_ID, base.x + dx, ROOF_Y))
    const wall = trooper(BOT_ID, WALL_EAST, base.y)
    const world = makeWorld([], [...roofers, wall], [base])
    stepBases(world, 1 / 60)
    expect(roofers.filter((r) => r.storming)).toHaveLength(BASE_STORM_ROOF_SLOTS)
    expect(wall.storming).toBe(true)
  })

  test('an enemy ship near the pad halts the storm — the men down tools', () => {
    const base = emptyFort()
    const stormer = trooper(BOT_ID, WALL_EAST, base.y)
    const owner = makeShip({ id: PLAYER_ID, x: base.x + 400, y: base.y - 200 }) // the defender swoops in
    const world = makeWorld([owner], [stormer], [base])
    stepBases(world, 1)
    expect(stormer.storming).toBe(false)
    expect(base.capture).toBe(0) // nobody breaches under a hostile ship
  })

  test('a live enemy trooper near halts the storm — even from outside the disc; a downed one scares nobody', () => {
    const base = emptyFort()
    const stormer = trooper(BOT_ID, WALL_EAST, base.y)
    const defender = trooper(PLAYER_ID, base.x + BASE_CAPTURE_RADIUS + 90, base.y) // outside the disc, inside threat range
    const world = makeWorld([], [stormer, defender], [base])
    stepBases(world, 1 / 60)
    expect(stormer.storming).toBe(false)
    expect(base.capture).toBe(0)
    defender.fallen = 1 // flat on his back he threatens nobody — the breach resumes
    stepBases(world, 1 / 60)
    expect(stormer.storming).toBe(true)
    expect(base.capture).toBeGreaterThan(0)
  })

  test('last frame’s marks expire when the storm is interrupted', () => {
    const base = emptyFort()
    const raider = { ...trooper(BOT_ID, WALL_EAST, base.y), storming: true } // marked last frame
    const threat = trooper(PLAYER_ID, base.x - 150, base.y) // a defender swoops into the disc
    const world = makeWorld([], [raider, threat], [base])
    stepBases(world, 1 / 60)
    expect(raider.storming).toBe(false)
  })

  test('the helpless and the spectators never mark: fallen, seized, airborne, out of the disc', () => {
    const base = emptyFort()
    const flat = { ...trooper(BOT_ID, WALL_WEST, base.y), fallen: 1 } // in contact, but flat
    const seized = { ...trooper(BOT_ID, WALL_EAST + 2, base.y), stun: 1 }
    const chuting = trooper(BOT_ID, base.x, ROOF_Y - 100, false) // descending toward the roof, not on it
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

  test('a downed attacker neither storms nor captures until he scrambles up', () => {
    const base = emptyFort()
    const downed = { ...trooper(BOT_ID, WALL_EAST, base.y), fallen: 1 }
    const world = makeWorld([], [downed], [base])
    stepBases(world, 1)
    expect(base.capture).toBe(0) // flat on his back, even in wall contact
    downed.fallen = 0 // back on his feet — the assault resumes
    stepBases(world, 1)
    expect(base.capture).toBeGreaterThan(0)
  })

  test('a kneeling specialist or a bolting man still marks, but keeps his own facing', () => {
    // The renderer only swaps the pounding pose in for WALKING/STANDING — a kneeler renders his
    // wind-up and a runner his bolt, so flipping their facing to the door would point a firing
    // bazooka or a sprint the wrong way. The mark itself stays (they storm like everyone else).
    const base = emptyFort()
    const kneeler = { ...trooper(BOT_ID, WALL_WEST, base.y), kneel: 1, facing: -1 }
    const runner = { ...trooper(BOT_ID, WALL_EAST, base.y), running: true, facing: 1 }
    const world = makeWorld([], [kneeler, runner], [base])
    stepBases(world, 1 / 60)
    expect(kneeler.storming).toBe(true)
    expect(runner.storming).toBe(true)
    expect(kneeler.facing).toBe(-1) // squared up to his target, not the door
    expect(runner.facing).toBe(1) // his legs keep selling the direction he runs
  })

  test('occupiers of an already-won pad hold it without the theatrics', () => {
    const taken = makeBase({ capture: 1, capturedBy: BOT_ID, garrison: 0 })
    const occupier = trooper(BOT_ID, taken.x + 30, taken.y)
    const world = makeWorld([], [occupier], [taken])
    stepBases(world, 1 / 60)
    expect(occupier.storming).toBe(false)
    expect(taken.capture).toBe(1) // still pinned by his presence
  })
})

describe('stepBases — capture tug-of-war', () => {
  test('crossing 1 records the capturer and freezes the fort (no regen)', () => {
    // No defending ship near the pad — its presence would (rightly) halt the storm.
    const base = makeBase({ garrison: 0 })
    const raider = trooper(BOT_ID, WALL_EAST, base.y)
    const world = makeWorld([], [raider], [base])
    stepBases(world, BASE_STORM_SIDE_TIME) // one side, full time → captured
    expect(base.capture).toBe(1)
    expect(base.capturedBy).toBe(BOT_ID)
    const garrisonAtFall = base.garrison
    stepBases(world, 10)
    expect(base.garrison).toBe(garrisonAtFall) // no regen while captured
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

  test('airborne (chuting) attackers do not count — only landed ones storm', () => {
    const base = makeBase({ garrison: 0 })
    const world = makeWorld([], [trooper(BOT_ID, WALL_EAST, base.y - 100, false)], [base])
    stepBases(world, 5)
    expect(base.capture).toBe(0)
  })

  test('attackers outside the capture disc are spectators', () => {
    const base = makeBase({ garrison: 0 })
    const world = makeWorld([], [trooper(BOT_ID, base.x + BASE_CAPTURE_RADIUS + 50, base.y)], [base])
    stepBases(world, 5)
    expect(base.capture).toBe(0)
  })
})

describe('the building shelters its defenders', () => {
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

  test('a blast outside kills the exposed but never the man sheltering inside the walls', () => {
    const wallX = 1000 + BASE_BUILDING_HALF_WIDTH // east wall face
    const tripper = makeShip({ id: PLAYER_ID, x: wallX - 30, y: 2960 })
    const sheltered = trooper(PLAYER_ID, wallX - 60, 2991) // inside the building box, near the east wall
    const exposed = trooper(PLAYER_ID, wallX + 30, 2991) // on the pad outside, within the blast
    const base = makeBase({})
    const world = makeWorld([tripper], [mineAt(wallX - 30, 2960), sheltered, exposed], [base])
    updateDevices(world, 0.016)
    expect(world.devices).toContain(sheltered) // the walls ate the blast…
    expect(sheltered.fallen).toBe(0) // …and its shockwave
    expect(world.devices).not.toContain(exposed)
  })
})

describe('the assault on foot — march, walls, roof', () => {
  const padBlock = { x: 600, y: 3000, w: 800, h: 60, structure: StructureType.METAL, surface: Surface.EARTH }

  test('an unopposed attacker in the disc marches to the wall, plants, and storms an emptied fort', () => {
    const base = makeBase({ garrison: 0 })
    const raider = { ...trooper(BOT_ID, base.x + 300, 2991), groundLeft: 600, groundRight: 1400 }
    const world = makeWorld([], [raider], [base])
    world.blocks = [padBlock]
    for (let i = 0; i < 30 * 8; i += 1) {
      stepBases(world, 1 / 30)
      updateDevices(world, 1 / 30)
    }
    expect(Math.abs(raider.x - WALL_EAST)).toBeLessThanOrEqual(9) // at the east face, in contact
    expect(raider.storming).toBe(true)
    expect(base.capture).toBeGreaterThan(0) // and the breach is under way
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

  test('the walls stop a walker: an enemy trooper overlapping the building is shoved back out', () => {
    const base = makeBase({})
    const intruder = { ...trooper(BOT_ID, base.x - 80, 2991), groundLeft: 600, groundRight: 1400 }
    const world = makeWorld([], [intruder], [base])
    world.blocks = [padBlock]
    updateDevices(world, 1 / 30)
    expect(intruder.x).toBe(WALL_WEST) // out the nearest (west) face, flush against it
  })
})
