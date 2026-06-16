import { describe, expect, test } from 'bun:test'

import {
  DeviceKind,
  FLAMETHROWER_PELLETS,
  MINE_COUNT,
  SCATTERGUN_PELLETS,
  SEEKER_COUNT,
  ShipKind,
  WEAPON_CONFIG,
  WEAPON_POOL,
  WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { createRng } from '$/game/rng'
import type { Ship, World } from '$/game/types'
import { assignWeapon, fireSecondary } from '$/game/weapons'

const makeShip = (over: Partial<Ship>): Ship => ({
  id: 0,
  kind: ShipKind.PLAYER,
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
  shields: 50,
  weapon: WeaponKind.SCATTERGUN,
  charge: 100,
  altCooldown: 0,
  disabled: 0,
  troops: 0,
  squad: WeaponKind.GRENADE,
  deployCooldown: 0,
  ...over,
})

const makeWorld = (over?: Partial<World>): World => ({
  time: 0,
  ships: [],
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
  ...over,
})

describe('assignWeapon', () => {
  test('always returns a weapon from the pool', () => {
    const rng = createRng(42)
    for (let i = 0; i < 30; i += 1) expect(WEAPON_POOL).toContain(assignWeapon(rng))
  })

  test('offers all ten heavy weapons and no infantry entry', () => {
    expect(WEAPON_POOL).toHaveLength(10)
    expect(WEAPON_POOL).toContain(WeaponKind.FLAMETHROWER)
    expect(WEAPON_POOL.some((k) => String(k) === 'INFANTRY')).toBe(false) // infantry is a ship system now
    expect(new Set(WEAPON_POOL).size).toBe(WEAPON_POOL.length) // no duplicates
  })
})

describe('fireSecondary — gating', () => {
  test('spends the energy cost and arms the cooldown', () => {
    const ship = makeShip({ weapon: WeaponKind.SCATTERGUN, charge: 100 })
    const world = makeWorld({ ships: [ship] })
    fireSecondary(world, ship)
    expect(ship.charge).toBe(100 - WEAPON_CONFIG[WeaponKind.SCATTERGUN].cost)
    expect(ship.altCooldown).toBe(WEAPON_CONFIG[WeaponKind.SCATTERGUN].cooldown)
  })

  test('is a no-op without enough energy, while cooling down, or while disabled', () => {
    const dry = makeShip({ charge: 0 })
    const cooling = makeShip({ charge: 100, altCooldown: 0.4 })
    const emp = makeShip({ charge: 100, disabled: 1 })
    const world = makeWorld()
    expect(fireSecondary(world, dry)).toEqual([])
    expect(fireSecondary(world, cooling)).toEqual([])
    expect(fireSecondary(world, emp)).toEqual([])
    expect(world.bullets).toHaveLength(0)
    expect(world.devices).toHaveLength(0)
    expect(cooling.charge).toBe(100) // untouched
  })
})

describe('fireSecondary — bullet/beam weapons', () => {
  test('Scattergun emits a cone of pellets', () => {
    const ship = makeShip({ weapon: WeaponKind.SCATTERGUN })
    const world = makeWorld({ ships: [ship] })
    fireSecondary(world, ship)
    expect(world.bullets).toHaveLength(SCATTERGUN_PELLETS)
  })

  test('Water Cannon emits a knockback droplet tagged to wet terrain', () => {
    const ship = makeShip({ weapon: WeaponKind.WATER_CANNON })
    const world = makeWorld({ ships: [ship] })
    fireSecondary(world, ship)
    expect(world.bullets).toHaveLength(1)
    expect(world.bullets[0].push ?? 0).toBeGreaterThan(0)
    expect(world.bullets[0].wet).toBe(true)
  })

  test('Flamethrower emits a fan of flame gouts that scorch and ignite', () => {
    const ship = makeShip({ weapon: WeaponKind.FLAMETHROWER })
    const world = makeWorld({ ships: [ship] })
    fireSecondary(world, ship)
    expect(world.bullets).toHaveLength(FLAMETHROWER_PELLETS)
    expect(world.bullets.every((b) => b.burn === true)).toBe(true)
  })

  test('Rail Lance beams and damages a target in line', () => {
    const ship = makeShip({ id: 0, weapon: WeaponKind.RAIL, x: 100, y: 100, angle: 0 })
    const target = makeShip({ id: 1, kind: ShipKind.BOT, x: 400, y: 100, health: 100 })
    const world = makeWorld({ ships: [ship, target] })
    const hits = fireSecondary(world, ship)
    expect(world.beams).toHaveLength(1)
    expect(hits).toEqual([target])
    expect(target.health).toBeLessThan(100)
  })

  test('Rail Lance misses cleanly when nothing is in line', () => {
    const ship = makeShip({ id: 0, weapon: WeaponKind.RAIL, x: 100, y: 100, angle: 0 })
    const target = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 600 }) // off-axis
    const world = makeWorld({ ships: [ship, target] })
    expect(fireSecondary(world, ship)).toEqual([])
    expect(world.beams).toHaveLength(1)
    expect(target.health).toBe(100)
  })
})

describe('fireSecondary — device weapons', () => {
  const fireWith = (weapon: WeaponKind) => {
    const ship = makeShip({ weapon })
    const world = makeWorld({ ships: [ship] })
    fireSecondary(world, ship)
    return world.devices
  }

  test('Seeker launches homing missiles', () => {
    const devices = fireWith(WeaponKind.SEEKER)
    expect(devices).toHaveLength(SEEKER_COUNT)
    expect(devices.every((d) => d.kind === DeviceKind.MISSILE && d.turnRate > 0)).toBe(true)
  })

  test('EMP launches one non-homing disabling orb', () => {
    const devices = fireWith(WeaponKind.EMP)
    expect(devices).toHaveLength(1)
    const orb = devices[0]
    expect(orb.kind).toBe(DeviceKind.MISSILE)
    if (orb.kind === DeviceKind.MISSILE) {
      expect(orb.turnRate).toBe(0)
      expect(orb.disableTime).toBeGreaterThan(0)
    }
  })

  test('Mines drop the configured count; Grenade/Flak/Singularity drop one each', () => {
    expect(fireWith(WeaponKind.MINES)).toHaveLength(MINE_COUNT)
    expect(fireWith(WeaponKind.GRENADE)[0].kind).toBe(DeviceKind.GRENADE)
    expect(fireWith(WeaponKind.FLAK)[0].kind).toBe(DeviceKind.FLAK)
    expect(fireWith(WeaponKind.SINGULARITY)[0].kind).toBe(DeviceKind.WELL)
  })
})
