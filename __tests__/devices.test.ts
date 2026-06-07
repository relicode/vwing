import { describe, expect, test } from 'bun:test'

import { updateBeams } from '$/game/beams'
import { DeviceKind, ShipKind, WALL_THICKNESS, WeaponKind, WORLD_HEIGHT } from '$/game/constants'
import { updateDevices } from '$/game/devices'
import { createRng } from '$/game/rng'
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
  fireCooldown: 0,
  invuln: 0,
  health: 100,
  shields: 0,
  weapon: WeaponKind.SCATTERGUN,
  ammo: 0,
  altCooldown: 0,
  disabled: 0,
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
  water: [],
  rng: createRng(1),
})

const missile = (over: Partial<Extract<Device, { kind: DeviceKind.MISSILE }>>): Device => ({
  kind: DeviceKind.MISSILE,
  x: 0,
  y: 0,
  vx: 300,
  vy: 0,
  life: 4,
  owner: 0,
  radius: 6,
  turnRate: 3,
  speed: 300,
  damage: 40,
  blastRadius: 60,
  blastDamage: 15,
  disableTime: 0,
  shieldDrain: 0,
  color: 0xffffff,
  ...over,
})

describe('updateDevices — missiles', () => {
  test('a homing missile steers toward the target, capped at turnRate*dt', () => {
    const target = makeShip({ id: 1, kind: ShipKind.BOT, x: 1200, y: 1100 }) // straight down, in bounds
    const m = missile({ x: 1200, y: 700, vx: 300, vy: 0, turnRate: 3 })
    const world = makeWorld([target], [m])
    updateDevices(world, 0.1)
    const live = world.devices[0]
    expect(live.kind).toBe(DeviceKind.MISSILE)
    if (live.kind === DeviceKind.MISSILE) {
      expect(live.vy).toBeGreaterThan(0) // now angling downward toward the target
      const heading = Math.atan2(live.vy, live.vx)
      expect(heading).toBeLessThanOrEqual(3 * 0.1 + 1e-6) // capped this frame
    }
  })

  test('a missile detonates on contact and kills a weak target', () => {
    const target = makeShip({ id: 1, kind: ShipKind.BOT, x: 0, y: 0, health: 20, shields: 0 })
    const m = missile({ x: 0, y: 0, vx: 0, vy: 0, turnRate: 0, damage: 40 })
    const world = makeWorld([target], [m])
    const dead = updateDevices(world, 0.016)
    expect(world.devices).toHaveLength(0) // consumed
    expect(dead).toContain(target)
  })

  test('an EMP orb disables instead of damaging', () => {
    const target = makeShip({ id: 1, kind: ShipKind.BOT, x: 0, y: 0, health: 100, shields: 50 })
    const orb = missile({ x: 0, y: 0, vx: 0, vy: 0, turnRate: 0, damage: 0, disableTime: 2, shieldDrain: 40 })
    const world = makeWorld([target], [orb])
    const dead = updateDevices(world, 0.016)
    expect(dead).toHaveLength(0)
    expect(target.disabled).toBe(2)
    expect(target.shields).toBe(10)
    expect(target.health).toBe(100)
  })

  test('an expired missile is culled', () => {
    const world = makeWorld([], [missile({ x: 1200, y: 700, life: 0.01 })])
    updateDevices(world, 0.1)
    expect(world.devices).toHaveLength(0)
  })
})

describe('updateDevices — mines', () => {
  const mine = (over: Partial<Extract<Device, { kind: DeviceKind.MINE }>>): Device => ({
    kind: DeviceKind.MINE,
    x: 0,
    y: 0,
    owner: 0,
    radius: 6,
    armTime: 0.8,
    life: 14,
    triggerRadius: 60,
    blastRadius: 90,
    damage: 40,
    ...over,
  })

  test('does not trigger before it arms', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 10, y: 0, health: 100 })
    const world = makeWorld([enemy], [mine({ armTime: 0.8 })])
    updateDevices(world, 0.1) // armTime → 0.7, still arming
    expect(world.devices).toHaveLength(1)
    expect(enemy.health).toBe(100)
  })

  test('detonates once armed and an enemy is in range', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 10, y: 0, health: 100, shields: 0 })
    const world = makeWorld([enemy], [mine({ armTime: 0.05 })])
    updateDevices(world, 0.1) // arms, then triggers
    expect(world.devices).toHaveLength(0)
    expect(enemy.health).toBeLessThan(100)
  })
})

describe('updateDevices — infantry / grenade / flak / well', () => {
  test('infantry falls under gravity and attaches to the floor', () => {
    const inf: Device = {
      kind: DeviceKind.INFANTRY,
      x: 100,
      y: WORLD_HEIGHT - WALL_THICKNESS - 6 - 1, // just above the floor
      vx: 0,
      vy: 0,
      owner: 0,
      radius: 6,
      life: 9,
      attached: false,
      fireCooldown: 1,
    }
    const world = makeWorld([], [inf])
    updateDevices(world, 0.2)
    const live = world.devices[0]
    expect(live.kind).toBe(DeviceKind.INFANTRY)
    if (live.kind === DeviceKind.INFANTRY) expect(live.attached).toBe(true)
  })

  test('attached infantry shoots at an enemy in range', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 200, y: 100 })
    const inf: Device = {
      kind: DeviceKind.INFANTRY,
      x: 200,
      y: 120,
      vx: 0,
      vy: 0,
      owner: 0,
      radius: 6,
      life: 9,
      attached: true,
      fireCooldown: 0,
    }
    const world = makeWorld([enemy], [inf])
    updateDevices(world, 0.016)
    expect(world.bullets.length).toBeGreaterThan(0)
  })

  test('grenade falls and bursts into shards on fuse', () => {
    const nade: Device = { kind: DeviceKind.GRENADE, x: 1200, y: 700, vx: 0, vy: 0, owner: 0, radius: 5, fuse: 0.05 }
    const world = makeWorld([], [nade])
    updateDevices(world, 0.1)
    expect(world.devices).toHaveLength(0)
    expect(world.bullets.length).toBeGreaterThan(0)
  })

  test('flak airbursts into shards on fuse', () => {
    const flak: Device = { kind: DeviceKind.FLAK, x: 1200, y: 700, vx: 300, vy: 0, owner: 0, radius: 4, fuse: 0.05 }
    const world = makeWorld([], [flak])
    updateDevices(world, 0.1)
    expect(world.devices).toHaveLength(0)
    expect(world.bullets.length).toBeGreaterThan(0)
  })

  test('a singularity pulls a nearby ship toward it and stays finite at the center', () => {
    const ship = makeShip({ id: 1, kind: ShipKind.BOT, x: 200, y: 400, vx: 0, vy: 0 })
    const well: Device = {
      kind: DeviceKind.WELL,
      x: 200,
      y: 200,
      owner: 0,
      radius: 8,
      life: 4,
      strength: 90000,
      pullRadius: 320,
    }
    const world = makeWorld([ship], [well])
    updateDevices(world, 0.1)
    expect(ship.vy).toBeLessThan(0) // pulled upward toward the well

    const atCenter = makeShip({ id: 2, kind: ShipKind.BOT, x: 200, y: 200 })
    const world2 = makeWorld([atCenter], [{ ...well }])
    updateDevices(world2, 0.1)
    expect(Number.isFinite(atCenter.vx)).toBe(true)
    expect(Number.isFinite(atCenter.vy)).toBe(true)
  })
})

describe('updateBeams', () => {
  test('ages out spent beams', () => {
    const world = makeWorld([], [])
    world.beams.push({ x1: 0, y1: 0, x2: 1, y2: 0, life: 0.05, maxLife: 0.2, color: 0xffffff })
    updateBeams(world, 0.1)
    expect(world.beams).toHaveLength(0)
  })
})
