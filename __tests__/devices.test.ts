import { describe, expect, test } from 'bun:test'

import { updateBeams } from '$/game/beams'
import { DeviceKind, InfantryWeapon, ShipKind, SurfaceMaterial, WeaponKind } from '$/game/constants'
import { resolveInfantryContacts, updateDevices } from '$/game/devices'
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
  charge: 100,
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
  terrainVersion: 0,
  water: [],
  shake: 0,
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
  const infantry = (over: Partial<Extract<Device, { kind: DeviceKind.INFANTRY }>>): Device => ({
    kind: DeviceKind.INFANTRY,
    x: 100,
    y: 193,
    vx: 0,
    vy: 0,
    owner: 0,
    radius: 6,
    weapon: InfantryWeapon.RIFLE,
    attached: false,
    swim: 0,
    sinking: 0,
    chute: -1,
    pickupLock: 0,
    walkDir: 1,
    facing: 1,
    groundLeft: 0,
    groundRight: 0,
    fireCooldown: 0,
    kneel: 0,
    ...over,
  })

  test('falls under gravity and lands on a block when it hits slowly', () => {
    const world = makeWorld([], [infantry({})])
    world.blocks = [{ x: 0, y: 200, w: 200, h: 80, material: SurfaceMaterial.ROCK }]
    updateDevices(world, 0.2)
    const live = world.devices[0]
    expect(live?.kind).toBe(DeviceKind.INFANTRY)
    if (live?.kind === DeviceKind.INFANTRY) expect(live.attached).toBe(true)
  })

  test('splats when it lands too fast (dropped from too high)', () => {
    const world = makeWorld([], [infantry({ vy: 400 })])
    world.blocks = [{ x: 0, y: 200, w: 200, h: 80, material: SurfaceMaterial.ROCK }]
    updateDevices(world, 0.05)
    expect(world.devices.length).toBe(0)
  })

  test('a landed unit persists past the old lifetime (no self-despawn)', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 100, y: 100 })])
    world.blocks = [{ x: 50, y: 106, w: 120, h: 40, material: SurfaceMaterial.ROCK }] // ground beneath
    for (let i = 0; i < 20; i += 1) updateDevices(world, 1) // 20 simulated seconds on the ground
    expect(world.devices.length).toBe(1)
  })

  test('attached infantry shoots at an enemy in range', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 200, y: 100 })
    const world = makeWorld([enemy], [infantry({ x: 200, y: 120, attached: true })])
    world.blocks = [{ x: 140, y: 128, w: 120, h: 40, material: SurfaceMaterial.ROCK }] // ground beneath
    updateDevices(world, 0.016)
    expect(world.bullets.length).toBeGreaterThan(0)
  })

  test('a landed unit holds fire when terrain blocks line of sight', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 300, y: 100 })
    const world = makeWorld([enemy], [infantry({ x: 100, y: 100, attached: true })])
    world.blocks = [
      { x: 40, y: 108, w: 120, h: 40, material: SurfaceMaterial.ROCK }, // ground beneath the unit
      { x: 180, y: 60, w: 40, h: 80, material: SurfaceMaterial.BEDROCK }, // wall between them
    ]
    updateDevices(world, 0.016)
    expect(world.bullets.length).toBe(0)
  })

  test('a landed unit patrols its block and never walks off the edges', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 150, y: 94, groundLeft: 100, groundRight: 160 })])
    world.blocks = [{ x: 100, y: 102, w: 60, h: 40, material: SurfaceMaterial.ROCK }] // the block it stands on
    for (let i = 0; i < 600; i += 1) updateDevices(world, 1 / 60) // 10s of patrolling
    const u = world.devices[0]
    expect(u?.kind).toBe(DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.x).toBeGreaterThanOrEqual(106) // groundLeft + radius
      expect(u.x).toBeLessThanOrEqual(154) // groundRight - radius
    }
  })

  test('a fast fall deploys a parachute that brakes the descent', () => {
    const world = makeWorld([], [infantry({ y: 200, vy: 260 })]) // already past PARACHUTE_DEPLOY_SPEED
    for (let i = 0; i < 60; i += 1) updateDevices(world, 1 / 60) // ~1s of descent, no ground
    const u = world.devices[0]
    expect(u?.kind).toBe(DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.chute).toBeGreaterThanOrEqual(0) // chute deployed
      expect(u.vy).toBeLessThan(260) // and braked the fall
    }
  })

  test('a parachuting trooper gusts sideways so a stream fans out', () => {
    const world = makeWorld([], [infantry({ y: 200, vy: 260, vx: 0 })]) // past deploy speed, no lateral motion
    for (let i = 0; i < 60; i += 1) updateDevices(world, 1 / 60) // ~1s under canopy, no ground/water
    const u = world.devices[0]
    expect(u?.kind).toBe(DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.chute).toBeGreaterThanOrEqual(0) // canopy out
      expect(Math.abs(u.vx)).toBeGreaterThan(0) // and it has drifted off the vertical
      expect(Math.abs(u.vx)).toBeLessThanOrEqual(60 + 1e-9) // bounded by PARACHUTE_DRIFT
    }
  })

  test('a landed grenadier plants on one knee to fire, lobbing mid-crouch', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 200, y: 100 })
    const world = makeWorld([enemy], [infantry({ weapon: InfantryWeapon.GRENADE, x: 100, y: 100, attached: true })])
    world.blocks = [{ x: 40, y: 108, w: 120, h: 40, material: SurfaceMaterial.ROCK }] // ground beneath
    updateDevices(world, 0.016) // cadence ready + target in sight → drops to a knee (no lob yet)
    const crouched = world.devices.find((d) => d.kind === DeviceKind.INFANTRY)
    if (crouched?.kind === DeviceKind.INFANTRY) expect(crouched.kneel).toBeGreaterThan(0) // kneeling first
    expect(world.devices.some((d) => d.kind === DeviceKind.GRENADE)).toBe(false) // hasn't fired during wind-up
    for (let i = 0; i < 60; i += 1) updateDevices(world, 1 / 60) // ~1s: the wind-up elapses and the round flies
    expect(world.devices.some((d) => d.kind === DeviceKind.GRENADE)).toBe(true)
  })

  test('a kneeling grenadier holds perfectly still through the crouch', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 300, y: 100 })
    // already crouched (kneel set), well above the fire point so it just holds during these frames
    const world = makeWorld(
      [enemy],
      [
        infantry({
          weapon: InfantryWeapon.GRENADE,
          x: 100,
          y: 100,
          attached: true,
          kneel: 1.5,
          groundLeft: 40,
          groundRight: 160,
        }),
      ]
    )
    world.blocks = [{ x: 40, y: 108, w: 120, h: 40, material: SurfaceMaterial.ROCK }]
    for (let i = 0; i < 10; i += 1) updateDevices(world, 1 / 60) // ~0.17s, stays above INFANTRY_KNEEL_FIRE_AT
    const u = world.devices.find((d) => d.kind === DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.x).toBe(100) // never drifted — crouched units don't patrol
      expect(u.kneel).toBeGreaterThan(0)
    }
  })

  test('a falling unit grazing the side of a wall slides past instead of sticking', () => {
    const world = makeWorld([], [infantry({ x: 96, y: 100, vx: 0, vy: 50 })])
    world.blocks = [{ x: 100, y: 0, w: 40, h: 400, material: SurfaceMaterial.BEDROCK }] // a tall wall to its right
    updateDevices(world, 0.05)
    const u = world.devices[0]
    expect(u?.kind).toBe(DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.attached).toBe(false) // didn't latch onto the wall's side
      expect(u.vy).toBeGreaterThan(0) // still falling past it (slides, doesn't stick)
    }
  })

  test('a landed unit falls when the block beneath it is destroyed', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 100, y: 100, groundLeft: 50, groundRight: 170 })])
    world.blocks = [{ x: 50, y: 106, w: 120, h: 40, material: SurfaceMaterial.ROCK }]
    updateDevices(world, 0.05)
    const landed = world.devices[0]
    if (landed?.kind === DeviceKind.INFANTRY) expect(landed.attached).toBe(true) // still standing
    world.blocks = [] // the rock is shot away
    updateDevices(world, 0.05) // loses footing this frame…
    updateDevices(world, 0.1) // …and is falling the next
    const u = world.devices[0]
    expect(u?.kind).toBe(DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.attached).toBe(false)
      expect(u.vy).toBeGreaterThan(0)
    }
  })

  test('a unit embedded in a block dies on the spot', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 100, y: 100, groundLeft: 50, groundRight: 170 })])
    world.blocks = [{ x: 50, y: 80, w: 120, h: 80, material: SurfaceMaterial.ROCK }] // engulfs the unit
    updateDevices(world, 0.016)
    expect(world.devices.length).toBe(0)
  })

  test('a slow owner reaching its own trooper scoops it up and re-arms Infantry', () => {
    const owner = makeShip({ id: 0, x: 100, y: 100, vx: 10, vy: 0, weapon: WeaponKind.RAIL, charge: 0 })
    const world = makeWorld([owner], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 0 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(0)
    expect(owner.weapon).toBe(WeaponKind.INFANTRY)
    expect(owner.charge).toBeGreaterThan(0)
  })

  test('a ship ramming through a trooper splatters it (own or enemy)', () => {
    const rammer = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 100, vx: 300, vy: 0 })
    const world = makeWorld([rammer], [infantry({ owner: 0, x: 100, y: 100, attached: true })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(0)
  })

  test('a slow owner cannot scoop a unit still in its pickup lockout', () => {
    const owner = makeShip({ id: 0, x: 100, y: 100, vx: 0, vy: 0 })
    const world = makeWorld([owner], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 1.5 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(1) // locked out → untouched
  })

  test('a fast own ship cannot mince its trooper during the deploy lockout', () => {
    const owner = makeShip({ id: 0, x: 100, y: 100, vx: 300, vy: 0 }) // well past ram speed
    const world = makeWorld([owner], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 1.5 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(1) // freshly deployed → immune to its own hull
  })

  test('once the deploy lockout expires, a fast own ship splatters its trooper', () => {
    const owner = makeShip({ id: 0, x: 100, y: 100, vx: 300, vy: 0 })
    const world = makeWorld([owner], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 0 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(0)
  })

  test('an enemy ship rams a trooper even during its owner-deploy lockout', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 100, vx: 300, vy: 0 })
    const world = makeWorld([enemy], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 1.5 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(0) // the lockout only shields against the OWN ship
  })

  test('lands in water and swims instead of attaching, holding fire', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 60 }) // in range, but it must not shoot
    const world = makeWorld([enemy], [infantry({ y: 194 })])
    world.water = [{ x: 0, y: 200, w: 400, h: 200 }]
    updateDevices(world, 0.2)
    const live = world.devices[0]
    expect(live?.kind).toBe(DeviceKind.INFANTRY)
    if (live?.kind === DeviceKind.INFANTRY) {
      expect(live.swim).toBeGreaterThan(0)
      expect(live.attached).toBe(false)
    }
    expect(world.bullets.length).toBe(0)
  })

  test('a swimming unit drowns, then sinks away before vanishing', () => {
    const world = makeWorld([], [infantry({ y: 205, swim: 0.05 })])
    world.water = [{ x: 0, y: 200, w: 400, h: 200 }]
    updateDevices(world, 0.1) // swim elapses → starts sinking (still present)
    const sinking = world.devices[0]
    expect(sinking?.kind).toBe(DeviceKind.INFANTRY)
    if (sinking?.kind === DeviceKind.INFANTRY) expect(sinking.sinking).toBeGreaterThan(0)
    updateDevices(world, 10) // sink time elapses → gone
    expect(world.devices.length).toBe(0)
  })

  test('a blast splatters a nearby enemy infantry unit', () => {
    const enemyShip = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 100 }) // triggers the mine
    const inf = infantry({ x: 120, y: 100, owner: 1, attached: true }) // enemy of the mine owner (0)
    const mine: Device = {
      kind: DeviceKind.MINE,
      x: 100,
      y: 100,
      owner: 0,
      radius: 6,
      armTime: 0,
      life: 5,
      triggerRadius: 60,
      blastRadius: 90,
      damage: 40,
    }
    const world = makeWorld([enemyShip], [mine, inf])
    updateDevices(world, 0.016)
    expect(world.devices.some((d) => d.kind === DeviceKind.INFANTRY)).toBe(false)
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
