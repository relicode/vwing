import { describe, expect, test } from 'bun:test'

import { castRail, fireRail } from '$/game/beams'
import {
  BASE_BUILDING_HALF_WIDTH,
  BASE_SHELL_KILL_DAMAGE,
  BaseAlarm,
  DeviceKind,
  RAIL_DAMAGE,
  ShipKind,
  StructureType,
  Surface,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Base, Device, Ship, World } from '$/game/types'

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
  reversing: false,
  fireCooldown: 0,
  invuln: 0,
  health: 100,
  shields: 0, // simplify damage math
  weapon: WeaponKind.RAIL,
  charge: 100,
  altCooldown: 0,
  disabled: 0,
  troops: 0,
  squad: WeaponKind.GRENADE,
  deployCooldown: 0,
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
  terrainVersion: 0,
  water: [],
  waterVersion: 0,
  bases: [],
  shake: 0,
  rng: createRng(1),
})

const trooper = (x: number, owner: number): Device => ({
  kind: DeviceKind.INFANTRY,
  x,
  y: 0,
  vx: 0,
  vy: 0,
  owner,
  radius: 9,
  guard: false,
  attached: true,
  wade: 0,
  swim: 0,
  sinking: 0,
  chute: -1,
  pickupLock: 0,
  walkDir: 1,
  facing: 1,
  groundLeft: 0,
  groundRight: 0,
  fireCooldown: 99,
  kneel: 0,
  running: false,
  storming: false,
  slide: 0,
  burning: 0,
  stun: 0,
  fallen: 0,
})

// A barracks parked dead ahead of a muzzle at the origin: the body spans y -94..26 and x 150..450,
// so a +x lance from (0, 0) hits its west face at x=150. Owner 1 = an enemy wall for shooter 0.
const makeBase = (over: Partial<Base>): Base => ({
  owner: 1,
  x: 300,
  y: 26,
  garrison: 8,
  capture: 0,
  alarm: BaseAlarm.PATROL,
  door: 0,
  ...over,
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

  test('terrain blocks the lance: a ship behind a wall is safe and the beam stops at the face', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 }) // facing +x
    const bunkered = makeShip({ id: 1, x: 600, y: 0 })
    const world = makeWorld([shooter, bunkered])
    world.blocks = [{ x: 300, y: -200, w: 80, h: 400, structure: StructureType.EARTH, surface: Surface.EARTH }]
    expect(fireRail(world, shooter)).toBeUndefined()
    expect(bunkered.health).toBe(100) // the mountain ate the shot
    expect(world.beams[0].x2).toBeCloseTo(300) // beam burns into the wall face, not through it
  })

  test('a ship in front of a wall is still fair game', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 })
    const exposed = makeShip({ id: 1, x: 200, y: 0 })
    const world = makeWorld([shooter, exposed])
    world.blocks = [{ x: 300, y: -200, w: 80, h: 400, structure: StructureType.EARTH, surface: Surface.EARTH }]
    expect(fireRail(world, shooter)).toBe(exposed)
    expect(exposed.health).toBe(100 - RAIL_DAMAGE)
  })

  test('the lance pierces every trooper along the beam — either side — but not past terrain', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 }) // facing +x
    const world = makeWorld([shooter])
    world.devices = [
      trooper(100, 1), // skewered
      trooper(200, 1), // skewered too — flesh doesn't stop the lance
      trooper(150, 0), // the firer's own man: friendly fire is real — skewered with them
      trooper(500, 1), // behind the wall: safe
    ]
    world.blocks = [{ x: 300, y: -200, w: 80, h: 400, structure: StructureType.EARTH, surface: Surface.EARTH }]
    fireRail(world, shooter)
    const survivors = world.devices.filter((d) => d.kind === DeviceKind.INFANTRY)
    expect(survivors).toHaveLength(1)
    expect(survivors[0]?.x).toBe(500)
  })

  test('an enemy barracks stops the lance and shells a sheltered defender; those behind survive', () => {
    const base = makeBase({ garrison: 4 })
    const inside = { ...trooper(300, 1), guard: true } // a fielded defender on the line, sheltered
    const exposed = trooper(120, 1) // in front of the west wall (x < 150): skewered
    const behind = trooper(500, 1) // beyond the opaque wall: safe
    const world = makeWorld([])
    world.bases = [base]
    world.devices = [inside, exposed, behind]
    const dead = new Set<Device>()
    castRail(world, 0, 0, 0, 0, 1100, BASE_SHELL_KILL_DAMAGE, dead) // a ship lance, certain to shell
    expect(world.beams[0].x2).toBeCloseTo(base.x - BASE_BUILDING_HALF_WIDTH) // burns into the wall face
    expect(dead.has(exposed)).toBe(true) // the man out front is skewered
    expect(dead.has(behind)).toBe(false) // the man behind the opaque wall is safe
    expect(world.devices).not.toContain(inside) // …and the sheltered defender is shelled (certain kill)
  })

  test('no holder exemption: a ship`s lance is stopped by its OWN building too (friendly fire)', () => {
    const shooter = makeShip({ id: 1, x: 0, y: 0, angle: 0 }) // the base's own side
    const enemy = makeShip({ id: 0, x: 500, y: 0 })
    const base = makeBase({}) // owner 1
    const world = makeWorld([shooter, enemy])
    world.bases = [base]
    expect(fireRail(world, shooter)).toBeUndefined() // its own wall stops it short of the enemy
    expect(world.beams[0].x2).toBeCloseTo(base.x - BASE_BUILDING_HALF_WIDTH) // burns into its own wall face
  })

  test('a trooper`s man-portable lance is small arms: it crosses the band, shells nothing, never touches the sheltered', () => {
    // A kneeling rail specialist stands INSIDE the building box — a wall that stopped his lance
    // would make it zero-length at his nose. castRail marks trooper fire by its `self` param, which
    // skips the bases entirely: it passes the band, shells no defender, and (like all small arms)
    // can't reach a defender sheltering inside — only an exposed enemy beyond the wall.
    const sniper = trooper(250, 0) // inside the box (150..450)
    const sheltered = { ...trooper(340, 1), guard: true } // a defender on the line behind the wall
    const exposed = trooper(600, 1) // an enemy out in the open beyond the building
    const base = makeBase({})
    const world = makeWorld([])
    world.devices = [sniper, sheltered, exposed]
    world.bases = [base]
    const dead = new Set<Device>()
    castRail(world, sniper.x, sniper.y, 0, 0, 1100, 30, dead, sniper)
    expect(base.garrison).toBe(8) // small arms don't shell the building…
    expect(world.beams[0].x2).toBeCloseTo(sniper.x + 1100) // …or get eaten by it
    expect(dead.has(exposed)).toBe(true) // it skewers the man in the open
    expect(dead.has(sheltered)).toBe(false) // but never the defender sheltering inside
    expect(world.devices).toContain(sheltered)
  })

  test('a captured building is a wall to BOTH sides; a fallen fort loses no one', () => {
    const dispossessed = makeShip({ id: 1, x: 0, y: 0, angle: 0 })
    const taken = makeBase({ capture: 1, capturedBy: 0, garrison: 4 }) // deed 1, flag flies for 0
    const world = makeWorld([dispossessed])
    world.bases = [taken]
    fireRail(world, dispossessed)
    expect(world.beams[0].x2).toBeCloseTo(taken.x - BASE_BUILDING_HALF_WIDTH) // stopped at the wall
    expect(taken.garrison).toBe(4) // a fallen barracks is past hurting

    const capturer = makeShip({ id: 0, x: 0, y: 0, angle: 0 })
    const held = makeWorld([capturer])
    held.bases = [makeBase({ capture: 1, capturedBy: 0, garrison: 4 })]
    fireRail(held, capturer)
    expect(held.beams[0].x2).toBeCloseTo(300 - BASE_BUILDING_HALF_WIDTH) // the holder's fire is stopped too — no transparency
  })
})
