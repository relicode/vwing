import { describe, expect, test } from 'bun:test'

import { updateBeams } from '$/game/beams'
import { DeviceKind, InfantryState, ShipKind, StructureType, Surface, WeaponKind } from '$/game/constants'
import { resolveInfantryContacts, stateOf, updateDevices } from '$/game/devices'
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

describe('updateDevices — projectiles respect terrain', () => {
  const wall = (x: number, y: number, w: number, h: number) => ({
    x,
    y,
    w,
    h,
    structure: StructureType.EARTH,
    surface: Surface.EARTH,
  })

  test('a seeker detonates against a wall, splashing a ship hugging it', () => {
    const bystander = makeShip({ id: 1, kind: ShipKind.BOT, x: 180, y: 340, shields: 0 })
    const world = makeWorld([bystander], [missile({ x: 150, y: 300, vx: 300, vy: 0, turnRate: 0 })])
    world.blocks = [wall(200, 100, 80, 400)]
    for (let i = 0; i < 30; i += 1) updateDevices(world, 1 / 60)
    expect(world.devices).toHaveLength(0) // stopped by the rock, not sailing through
    expect(bystander.health).toBeLessThan(100) // caught the blast beside the impact
  })

  test('an EMP orb fizzles on terrain without harming anyone', () => {
    const bystander = makeShip({ id: 1, kind: ShipKind.BOT, x: 180, y: 340 })
    const world = makeWorld(
      [bystander],
      [missile({ x: 150, y: 300, vx: 300, vy: 0, turnRate: 0, damage: 0, blastRadius: 0, disableTime: 2 })]
    )
    world.blocks = [wall(200, 100, 80, 400)]
    for (let i = 0; i < 30; i += 1) updateDevices(world, 1 / 60)
    expect(world.devices).toHaveLength(0)
    expect(bystander.health).toBe(100)
    expect(bystander.disabled).toBe(0) // never reached it
  })

  test('a grenade bursts where it lands instead of sinking into the ground', () => {
    const world = makeWorld(
      [],
      [{ kind: DeviceKind.GRENADE, x: 100, y: 260, vx: 0, vy: 150, owner: 0, radius: 5, fuse: 99 }]
    )
    world.blocks = [wall(40, 300, 400, 100)]
    for (let i = 0; i < 30; i += 1) updateDevices(world, 1 / 60)
    expect(world.devices).toHaveLength(0) // popped on contact, fuse never elapsed
    expect(world.bullets.length).toBeGreaterThan(0) // the shard ring flew
    const grenade = world.devices.find((d) => d.kind === DeviceKind.GRENADE)
    expect(grenade).toBeUndefined()
  })

  test('a flak shell airbursts against a wall, never tunnelling through', () => {
    const world = makeWorld(
      [],
      [{ kind: DeviceKind.FLAK, x: 150, y: 300, vx: 300, vy: 0, owner: 0, radius: 4, fuse: 99 }]
    )
    world.blocks = [wall(200, 100, 80, 400)]
    for (let i = 0; i < 30; i += 1) updateDevices(world, 1 / 60)
    expect(world.devices).toHaveLength(0)
    expect(world.bullets.length).toBeGreaterThan(0) // shards released at the face
    expect(world.bullets.every((b) => b.x < 260)).toBe(true) // none spawned beyond the wall
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
    running: false,
    slide: 0,
    ...over,
  })

  test('falls under gravity and lands on a block when it hits slowly', () => {
    const world = makeWorld([], [infantry({})])
    world.blocks = [{ x: 0, y: 200, w: 200, h: 80, structure: StructureType.EARTH, surface: Surface.EARTH }]
    updateDevices(world, 0.2)
    const live = world.devices[0]
    expect(live?.kind).toBe(DeviceKind.INFANTRY)
    if (live?.kind === DeviceKind.INFANTRY) {
      expect(live.attached).toBe(true)
      expect(stateOf(live)).toBe(InfantryState.WALKING) // landed on a patrollable block
    }
  })

  test('splats when it lands too fast (dropped from too high)', () => {
    const world = makeWorld([], [infantry({ vy: 400 })])
    world.blocks = [{ x: 0, y: 200, w: 200, h: 80, structure: StructureType.EARTH, surface: Surface.EARTH }]
    updateDevices(world, 0.05)
    expect(world.devices.length).toBe(0)
  })

  test('a landed unit persists past the old lifetime (no self-despawn)', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 100, y: 100 })])
    world.blocks = [{ x: 50, y: 106, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }] // ground beneath
    for (let i = 0; i < 20; i += 1) updateDevices(world, 1) // 20 simulated seconds on the ground
    expect(world.devices.length).toBe(1)
  })

  test('attached infantry shoots at an enemy in range', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 200, y: 100 })
    const world = makeWorld([enemy], [infantry({ x: 200, y: 120, attached: true })])
    world.blocks = [{ x: 140, y: 128, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }] // ground beneath
    updateDevices(world, 0.016)
    expect(world.bullets.length).toBeGreaterThan(0)
  })

  test('a landed unit holds fire when terrain blocks line of sight', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 300, y: 100 })
    const world = makeWorld([enemy], [infantry({ x: 100, y: 100, attached: true })])
    world.blocks = [
      { x: 40, y: 108, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }, // ground beneath the unit
      { x: 180, y: 60, w: 40, h: 80, structure: StructureType.METAL, surface: Surface.EARTH }, // wall between them
    ]
    updateDevices(world, 0.016)
    expect(world.bullets.length).toBe(0)
  })

  test('a landed unit patrols its block and never walks off the edges', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 150, y: 94, groundLeft: 100, groundRight: 160 })])
    world.blocks = [{ x: 100, y: 102, w: 60, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }] // the block it stands on
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
      expect(stateOf(u)).toBe(InfantryState.FALLING_PARACHUTE)
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
    const world = makeWorld([enemy], [infantry({ heavy: WeaponKind.GRENADE, x: 100, y: 100, attached: true })])
    world.blocks = [{ x: 40, y: 108, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }] // ground beneath
    updateDevices(world, 0.016) // cadence ready + target in sight → drops to a knee (no lob yet)
    const crouched = world.devices.find((d) => d.kind === DeviceKind.INFANTRY)
    if (crouched?.kind === DeviceKind.INFANTRY) {
      expect(crouched.kneel).toBeGreaterThan(0) // kneeling first
      expect(stateOf(crouched)).toBe(InfantryState.KNEELING)
    }
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
          heavy: WeaponKind.GRENADE,
          x: 100,
          y: 100,
          attached: true,
          kneel: 1.5,
          groundLeft: 40,
          groundRight: 160,
        }),
      ]
    )
    world.blocks = [{ x: 40, y: 108, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }]
    for (let i = 0; i < 10; i += 1) updateDevices(world, 1 / 60) // ~0.17s, stays above INFANTRY_KNEEL_FIRE_AT
    const u = world.devices.find((d) => d.kind === DeviceKind.INFANTRY)
    if (u?.kind === DeviceKind.INFANTRY) {
      expect(u.x).toBe(100) // never drifted — crouched units don't patrol
      expect(u.kneel).toBeGreaterThan(0)
    }
  })

  test('a falling unit grazing the side of a wall slides past instead of sticking', () => {
    const world = makeWorld([], [infantry({ x: 96, y: 100, vx: 0, vy: 50 })])
    world.blocks = [{ x: 100, y: 0, w: 40, h: 400, structure: StructureType.METAL, surface: Surface.EARTH }] // a tall wall to its right
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
    world.blocks = [{ x: 50, y: 106, w: 120, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }]
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
      expect(stateOf(u)).toBe(InfantryState.FALLING)
    }
  })

  test('a unit embedded in a block dies on the spot', () => {
    const world = makeWorld([], [infantry({ attached: true, x: 100, y: 100, groundLeft: 50, groundRight: 170 })])
    world.blocks = [{ x: 50, y: 80, w: 120, h: 80, structure: StructureType.EARTH, surface: Surface.EARTH }] // engulfs the unit
    updateDevices(world, 0.016)
    expect(world.devices.length).toBe(0)
  })

  test('a slow owner reaching its own trooper scoops it back into the bay', () => {
    const owner = makeShip({ id: 0, x: 100, y: 100, vx: 10, vy: 0, troops: 0 })
    const world = makeWorld([owner], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 0 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(0)
    expect(owner.troops).toBe(1)
  })

  test('a full bay leaves the trooper fielded (no silent loss)', () => {
    const owner = makeShip({ id: 0, x: 100, y: 100, vx: 10, vy: 0, troops: 8 })
    const world = makeWorld([owner], [infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 0 })])
    resolveInfantryContacts(world)
    expect(world.devices.length).toBe(1) // still on the ground
    expect(owner.troops).toBe(8)
  })

  test('a slow enemy ship recruits a fielded trooper in place (side flip, lockout, no free shot)', () => {
    const raider = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 100, vx: 10, vy: 0, troops: 0 })
    const turncoat = infantry({ owner: 0, x: 100, y: 100, attached: true, pickupLock: 0, heavy: WeaponKind.RAIL })
    const world = makeWorld([raider], [turncoat])
    resolveInfantryContacts(world)
    expect(world.devices).toHaveLength(1) // converted, not scooped — he stays fielded
    if (turncoat.kind === DeviceKind.INFANTRY) {
      expect(turncoat.owner).toBe(1) // now fights for the raider
      expect(turncoat.heavy).toBe(WeaponKind.RAIL) // keeps his specialist kit
      expect(turncoat.pickupLock).toBeGreaterThan(0) // can't be instantly re-flipped or bayed
      expect(turncoat.fireCooldown).toBeGreaterThan(0) // no free shot at his old side
    }
    expect(raider.troops).toBe(0) // recruiting is not a pickup
  })

  test('a drowning trooper cannot be recruited by an enemy (only its own ship saves it)', () => {
    const raider = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 205, vx: 0, vy: 0 })
    const sinker = infantry({ owner: 0, x: 100, y: 205, sinking: 1.4, pickupLock: 0 })
    const world = makeWorld([raider], [sinker])
    resolveInfantryContacts(world)
    if (sinker.kind === DeviceKind.INFANTRY) expect(sinker.owner).toBe(0) // still going down with his colors
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

  test('lands in water and swims instead of attaching', () => {
    const world = makeWorld([], [infantry({ y: 194 })])
    world.water = [{ x: 0, y: 200, w: 400, h: 200 }]
    updateDevices(world, 0.2)
    const live = world.devices[0]
    expect(live?.kind).toBe(DeviceKind.INFANTRY)
    if (live?.kind === DeviceKind.INFANTRY) {
      expect(live.swim).toBeGreaterThan(0)
      expect(live.attached).toBe(false)
      expect(stateOf(live)).toBe(InfantryState.SWIMMING)
    }
  })

  test('a directed swimmer (paddling to a rescuer) holds fire; a drifting one looses poor shots', () => {
    const target = makeShip({ id: 1, kind: ShipKind.BOT, x: 100, y: 60 }) // in range + LOS
    // Directed: the unit's own slow ship is alongside as a rescuer → it paddles over, hands busy.
    const owner = makeShip({ id: 0, x: 130, y: 205, vx: 0, vy: 0 })
    const directed = makeWorld([owner, target], [infantry({ owner: 0, x: 100, y: 205, swim: 5, pickupLock: 0 })])
    directed.water = [{ x: 0, y: 200, w: 400, h: 200 }]
    updateDevices(directed, 0.2)
    expect(directed.bullets.length).toBe(0) // paddling: no shooting

    // Drifting (no rescuer): it can loose the odd poorly-aimed shot at a target.
    const drifting = makeWorld([target], [infantry({ owner: 0, x: 100, y: 205, swim: 5, fireCooldown: 0 })])
    drifting.water = [{ x: 0, y: 200, w: 400, h: 200 }]
    updateDevices(drifting, 0.2)
    expect(drifting.bullets.length).toBeGreaterThan(0) // standby: fires (poorly)
  })

  test('a swimming unit drowns, then sinks away before vanishing', () => {
    const world = makeWorld([], [infantry({ y: 205, swim: 0.05 })])
    world.water = [{ x: 0, y: 200, w: 400, h: 200 }]
    updateDevices(world, 0.1) // swim elapses → starts sinking (still present)
    const sinking = world.devices[0]
    expect(sinking?.kind).toBe(DeviceKind.INFANTRY)
    if (sinking?.kind === DeviceKind.INFANTRY) {
      expect(sinking.sinking).toBeGreaterThan(0)
      expect(stateOf(sinking)).toBe(InfantryState.DROWNING)
    }
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

  test('targets enemy infantry over a ship at the same range (infantry hate infantry)', () => {
    // STANDING (groundLeft/Right unset → unpatrollable) so the shot is dead-on, no spread.
    const rifle = infantry({ owner: 0, x: 200, y: 120, attached: true })
    const enemyInf = infantry({ owner: 1, x: 300, y: 120, attached: true }) // 100px right (> panic dist)
    const ship = makeShip({ id: 2, kind: ShipKind.BOT, x: 200, y: 40 }) // 80px straight up, also in range
    const world = makeWorld([ship], [rifle, enemyInf])
    world.blocks = [{ x: 140, y: 128, w: 320, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }]
    updateDevices(world, 0.016)
    const shot = world.bullets.find((b) => b.owner === 0)
    expect(shot).toBeDefined()
    if (shot) expect(shot.vx).toBeGreaterThan(Math.abs(shot.vy)) // sideways at the trooper, not up at the ship
  })

  test('a sliding unit glides along and cannot shoot mid-slide', () => {
    const enemy = makeShip({ id: 1, kind: ShipKind.BOT, x: 200, y: 40 }) // in range + LOS
    const u = infantry({ owner: 0, x: 200, y: 120, attached: true, slide: 70, groundLeft: 140, groundRight: 460 })
    const world = makeWorld([enemy], [u])
    world.blocks = [{ x: 140, y: 128, w: 320, h: 40, structure: StructureType.EARTH, surface: Surface.EARTH }]
    updateDevices(world, 0.05)
    const live = world.devices[0]
    if (live?.kind === DeviceKind.INFANTRY) expect(live.x).toBeGreaterThan(200) // slid in the slide's direction
    expect(world.bullets.length).toBe(0) // no firing while off-balance
  })

  test('a unit standing on ice eventually slips into a slide', () => {
    const u = infantry({ owner: 0, x: 200, y: 120, attached: true, groundLeft: 140, groundRight: 460 })
    const world = makeWorld([], [u])
    world.blocks = [{ x: 140, y: 128, w: 320, h: 40, structure: StructureType.EARTH, surface: Surface.ICE }]
    let slipped = false
    for (let i = 0; i < 600 && !slipped; i += 1) {
      updateDevices(world, 1 / 60)
      const d = world.devices[0]
      if (d?.kind === DeviceKind.INFANTRY && d.slide !== 0) slipped = true
    }
    expect(slipped).toBe(true)
  })

  test('a drowning trooper is rescuable within the window, but not after', () => {
    const ownerEarly = makeShip({ id: 0, x: 100, y: 205, vx: 0, vy: 0 })
    const early = makeWorld([ownerEarly], [infantry({ owner: 0, x: 100, y: 205, sinking: 1.4, pickupLock: 0 })])
    resolveInfantryContacts(early)
    expect(early.devices.length).toBe(0) // scooped mid-sink (within INFANTRY_DROWN_RESCUE_WINDOW)
    expect(ownerEarly.troops).toBe(1)

    const ownerLate = makeShip({ id: 0, x: 100, y: 205, vx: 0, vy: 0 })
    const late = makeWorld([ownerLate], [infantry({ owner: 0, x: 100, y: 205, sinking: 0.5, pickupLock: 0 })])
    resolveInfantryContacts(late)
    expect(late.devices.length).toBe(1) // too deep to save
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
