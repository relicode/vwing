import { describe, expect, test } from 'bun:test'

import { fireRail } from '$/game/beams'
import {
  BASE_BUILDING_HALF_WIDTH,
  BASE_STRUCTURE_ARMOR,
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
  slide: 0,
  burning: 0,
  stun: 0,
  fallen: 0,
})

// A barracks parked dead ahead of a muzzle at the origin: the body spans y -26..26, so a
// +x lance from (0, 0) runs straight through it. Owner 1 = an enemy wall for shooter 0.
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

  test('an enemy barracks stops the lance and takes the shelling through the armor', () => {
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 }) // facing +x
    const base = makeBase({})
    const world = makeWorld([shooter])
    world.bases = [base]
    world.devices = [
      trooper(150, 1), // exposed in front of the wall: skewered
      trooper(500, 1), // sheltering behind it: the walls that stop bullets stop the lance too
    ]
    fireRail(world, shooter)
    expect(base.garrison).toBeCloseTo(8 - RAIL_DAMAGE / BASE_STRUCTURE_ARMOR, 5)
    expect(world.beams[0].x2).toBeCloseTo(base.x - BASE_BUILDING_HALF_WIDTH) // burns into the wall face
    const survivors = world.devices.filter((d) => d.kind === DeviceKind.INFANTRY)
    expect(survivors).toHaveLength(1)
    expect(survivors[0]?.x).toBe(500)
  })

  test('the holder`s own building is transparent to its own fire', () => {
    const shooter = makeShip({ id: 1, x: 0, y: 0, angle: 0 }) // the base's own side
    const enemy = makeShip({ id: 0, x: 500, y: 0 })
    const base = makeBase({})
    const world = makeWorld([shooter, enemy])
    world.bases = [base]
    expect(fireRail(world, shooter)).toBe(enemy) // straight through its own wall
    expect(base.garrison).toBe(8)
  })

  test('a captured building answers to its capturer: a wall to the dispossessed, transparent to the holder', () => {
    const dispossessed = makeShip({ id: 1, x: 0, y: 0, angle: 0 })
    const taken = makeBase({ capture: 1, capturedBy: 0 }) // deed says 1, the flag flies for 0
    const world = makeWorld([dispossessed])
    world.bases = [taken]
    fireRail(world, dispossessed)
    expect(world.beams[0].x2).toBeCloseTo(taken.x - BASE_BUILDING_HALF_WIDTH) // now an enemy wall
    expect(taken.garrison).toBe(8) // though a fallen barracks is past hurting

    const capturer = makeShip({ id: 0, x: 0, y: 0, angle: 0 })
    const held = makeWorld([capturer])
    held.bases = [makeBase({ capture: 1, capturedBy: 0 })]
    fireRail(held, capturer)
    expect(held.beams[0].x2).toBeGreaterThan(360) // his own muster pad doesn't eat his fire
  })
})
