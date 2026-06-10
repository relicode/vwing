import { describe, expect, test } from 'bun:test'

import {
  Color,
  DeviceKind,
  INFANTRY_FLAME_PELLETS,
  INFANTRY_KNEEL_FIRE_AT,
  INFANTRY_RAIL_DAMAGE,
  INFANTRY_SCATTER_PELLETS,
  INFANTRY_WATER_SHOTS,
  ShipKind,
  StructureType,
  Surface,
  TROOP_SPECIALIST_CHANCE,
  WeaponKind,
} from '$/game/constants'
import { updateDevices } from '$/game/devices'
import { createRng } from '$/game/rng'
import { spawnTrooper } from '$/game/troops'
import type { Device, Ship, World } from '$/game/types'

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

const makeWorld = (ships: Ship[], devices: Device[]): World => ({
  time: 0,
  ships,
  bullets: [],
  particles: [],
  devices,
  beams: [],
  blocks: [],
  terrainVersion: 0,
  water: [],
  bases: [],
  shake: 0,
  rng: createRng(1),
})

// A braced specialist one tick from the trigger: stepping once crosses INFANTRY_KNEEL_FIRE_AT
// and the heavy fires at the enemy parked in range + LOS to the right.
const bracedSpecialist = (heavy: WeaponKind): World => {
  const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 300, y: 100 })
  const world = makeWorld(
    [enemy],
    [
      {
        kind: DeviceKind.INFANTRY,
        x: 100,
        y: 100,
        vx: 0,
        vy: 0,
        owner: 0,
        radius: 6,
        heavy,
        guard: false,
        attached: true,
        swim: 0,
        sinking: 0,
        chute: -1,
        pickupLock: 0,
        walkDir: 1,
        facing: 1,
        groundLeft: 40,
        groundRight: 160,
        fireCooldown: 99,
        kneel: INFANTRY_KNEEL_FIRE_AT + 0.005, // the next 1/60 s step crosses the fire moment
        running: false,
        slide: 0,
        burning: 0,
        stun: 0,
      },
    ]
  )
  world.blocks = [{ x: 40, y: 108, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }]
  return world
}

describe('fireHeavy — every specialist kind produces its signature effect from the kneel', () => {
  test('SCATTERGUN: a cone of shrapnel pellets', () => {
    const world = bracedSpecialist(WeaponKind.SCATTERGUN)
    updateDevices(world, 1 / 60)
    expect(world.bullets).toHaveLength(INFANTRY_SCATTER_PELLETS)
    expect(world.bullets.every((b) => b.color === Color.SHRAPNEL)).toBe(true)
  })

  test('WATER_CANNON: a wet knockback squirt', () => {
    const world = bracedSpecialist(WeaponKind.WATER_CANNON)
    updateDevices(world, 1 / 60)
    expect(world.bullets).toHaveLength(INFANTRY_WATER_SHOTS)
    expect(world.bullets.every((b) => b.wet === true && (b.push ?? 0) > 0)).toBe(true)
  })

  test('FLAMETHROWER: a burning flame fan', () => {
    const world = bracedSpecialist(WeaponKind.FLAMETHROWER)
    updateDevices(world, 1 / 60)
    expect(world.bullets).toHaveLength(INFANTRY_FLAME_PELLETS)
    expect(world.bullets.every((b) => b.burn === true)).toBe(true)
  })

  test('SEEKER: one homing shoulder missile', () => {
    const world = bracedSpecialist(WeaponKind.SEEKER)
    updateDevices(world, 1 / 60)
    const missile = world.devices.find((d) => d.kind === DeviceKind.MISSILE)
    expect(missile).toBeDefined()
    if (missile?.kind === DeviceKind.MISSILE) expect(missile.turnRate).toBeGreaterThan(0)
  })

  test('RAIL: an instant lance that beams and damages the target', () => {
    const world = bracedSpecialist(WeaponKind.RAIL)
    updateDevices(world, 1 / 60)
    expect(world.beams).toHaveLength(1)
    expect(world.ships[0].health).toBe(100 - INFANTRY_RAIL_DAMAGE)
  })

  test('GRENADE: the classic lobbed grenade', () => {
    const world = bracedSpecialist(WeaponKind.GRENADE)
    updateDevices(world, 1 / 60)
    expect(world.devices.some((d) => d.kind === DeviceKind.GRENADE)).toBe(true)
  })

  test('FLAK: a slow airburst shell', () => {
    const world = bracedSpecialist(WeaponKind.FLAK)
    updateDevices(world, 1 / 60)
    expect(world.devices.some((d) => d.kind === DeviceKind.FLAK)).toBe(true)
  })

  test('EMP: a slow disabling orb', () => {
    const world = bracedSpecialist(WeaponKind.EMP)
    updateDevices(world, 1 / 60)
    const orb = world.devices.find((d) => d.kind === DeviceKind.MISSILE)
    expect(orb).toBeDefined()
    if (orb?.kind === DeviceKind.MISSILE) {
      expect(orb.turnRate).toBe(0)
      expect(orb.disableTime).toBeGreaterThan(0)
    }
  })

  test('SINGULARITY: a pocket gravity well toward the target', () => {
    const world = bracedSpecialist(WeaponKind.SINGULARITY)
    updateDevices(world, 1 / 60)
    const well = world.devices.find((d) => d.kind === DeviceKind.WELL)
    expect(well).toBeDefined()
    if (well?.kind === DeviceKind.WELL) expect(well.x).toBeGreaterThan(100) // lobbed toward the enemy
  })
})

describe('mine sapper (the no-kneel specialist)', () => {
  test('seeds a mine at its feet on the plant cadence, no target needed', () => {
    const world = bracedSpecialist(WeaponKind.MINES)
    world.ships = [] // no target anywhere — sappers plant regardless
    const sapper = world.devices[0]
    if (sapper.kind === DeviceKind.INFANTRY) {
      sapper.kneel = 0
      sapper.fireCooldown = 0
    }
    updateDevices(world, 1 / 60)
    expect(world.devices.some((d) => d.kind === DeviceKind.MINE)).toBe(true)
  })
})

describe('spawnTrooper', () => {
  test('rolls ~80% riflemen and ~20% specialists carrying the squad kind', () => {
    const ship = makeShip({ squad: WeaponKind.RAIL, x: 500, y: 400 })
    const world = makeWorld([ship], [])
    const N = 2000
    for (let i = 0; i < N; i += 1) spawnTrooper(world, ship)
    const specialists = world.devices.filter((d) => d.kind === DeviceKind.INFANTRY && d.heavy !== undefined)
    expect(specialists.every((d) => d.kind === DeviceKind.INFANTRY && d.heavy === WeaponKind.RAIL)).toBe(true)
    const ratio = specialists.length / N
    expect(ratio).toBeGreaterThan(TROOP_SPECIALIST_CHANCE - 0.04)
    expect(ratio).toBeLessThan(TROOP_SPECIALIST_CHANCE + 0.04)
  })
})
