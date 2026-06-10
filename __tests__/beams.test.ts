import { describe, expect, test } from 'bun:test'

import { fireRail } from '$/game/beams'
import {
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
import type { Device, Ship, World } from '$/game/types'

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

  test('the lance pierces every enemy trooper along the beam — but not past terrain', () => {
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
    })
    const shooter = makeShip({ id: 0, x: 0, y: 0, angle: 0 }) // facing +x
    const world = makeWorld([shooter])
    world.devices = [
      trooper(100, 1), // skewered
      trooper(200, 1), // skewered too — flesh doesn't stop the lance
      trooper(150, 0), // the firer's own man: untouched
      trooper(500, 1), // behind the wall: safe
    ]
    world.blocks = [{ x: 300, y: -200, w: 80, h: 400, structure: StructureType.EARTH, surface: Surface.EARTH }]
    fireRail(world, shooter)
    const survivors = world.devices.filter((d) => d.kind === DeviceKind.INFANTRY)
    expect(survivors).toHaveLength(2)
    expect(survivors.map((d) => d.x).sort((a, b) => a - b)).toEqual([150, 500])
  })
})
