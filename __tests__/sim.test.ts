import { describe, expect, test } from 'bun:test'

import {
  BOT_KILL_SCORE,
  DEATHMATCH_FRAG_SCORE,
  DeviceKind,
  GRASS_BURN_TIME,
  RESPAWN_DELAY_BASE,
  RESPAWN_DELAY_GROWTH,
  SHIP_MAX_HEALTH,
  ShipKind,
  SimMode,
  SPAWN_ALTITUDE,
  StructureType,
  Surface,
  TROOP_BAY_CAPACITY,
} from '$/game/constants'
import { inputFromSnapshot, NEUTRAL_INPUT } from '$/game/input'
import { createShip } from '$/game/ship'
import { type Combatant, createSim, createWorld } from '$/game/sim'
import type { Block, Bullet, Device } from '$/game/types'

// Total pixel area of destructible (earth, non-metal) terrain — shrinks as earth is shot away.
const destructibleArea = (blocks: Block[]): number =>
  blocks.reduce((sum, b) => (b.structure === StructureType.METAL ? sum : sum + b.w * b.h), 0)

const combatant = (id: number, x: number, y: number): Combatant => {
  const ship = createShip(ShipKind.PLAYER, x, y, id)
  ship.invuln = 0 // drop spawn invulnerability so the test shot connects
  return { ship, input: inputFromSnapshot({ ...NEUTRAL_INPUT }), name: `p${id}`, score: 0, deaths: 0, spawn: { x, y } }
}

const lethalShot = (x: number, y: number, owner: number): Bullet => ({
  x,
  y,
  vx: 0,
  vy: 0,
  radius: 6,
  life: 1,
  owner,
  damage: 200,
})

describe('createSim — deathmatch', () => {
  test('a kill credits the shooter a frag and respawns the victim after the reinforcement wait', () => {
    const world = createWorld(1)
    const shooter = combatant(0, 500, 400)
    const victim = combatant(1, 520, 400)
    const sim = createSim(world, [shooter, victim], { mode: SimMode.DEATHMATCH })
    victim.ship.health = 10
    world.bullets.push(lethalShot(victim.ship.x, victim.ship.y, shooter.ship.id))

    const events = sim.step(1 / 60)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ victimId: 1, killerId: 0, eliminated: false })
    expect(shooter.score).toBe(DEATHMATCH_FRAG_SCORE)
    // The wreck leaves the sky while the reinforcement clock runs (~RESPAWN_DELAY_BASE).
    expect(world.ships.some((s) => s.id === 1)).toBe(false)
    expect(sim.respawnIn(1)).toBeCloseTo(RESPAWN_DELAY_BASE, 1)
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 0.2) * 60); i += 1) sim.step(1 / 60)
    expect(world.ships.some((s) => s.id === 1)).toBe(true) // re-entered
    expect(victim.ship.health).toBe(SHIP_MAX_HEALTH) // respawned, full hull
    expect(victim.ship.invuln).toBeGreaterThan(0) // with fresh spawn invulnerability
  })

  test('every death grows the next wait (the reinforcement clock compounds)', () => {
    const world = createWorld(5)
    const shooter = combatant(0, 500, 400)
    const victim = combatant(1, 520, 400)
    const sim = createSim(world, [shooter, victim], { mode: SimMode.DEATHMATCH })
    victim.ship.health = 10
    world.bullets.push(lethalShot(victim.ship.x, victim.ship.y, shooter.ship.id))
    sim.step(1 / 60)
    expect(sim.respawnIn(1)).toBeCloseTo(RESPAWN_DELAY_BASE, 1)
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 0.2) * 60); i += 1) sim.step(1 / 60) // re-enter…
    victim.ship.invuln = 0
    victim.ship.health = 10
    world.bullets.push(lethalShot(victim.ship.x, victim.ship.y, shooter.ship.id))
    sim.step(1 / 60) // …and die again
    // The waits run 5, 10, 15, … — one full RESPAWN_DELAY_GROWTH longer per prior death, no cap.
    expect(sim.respawnIn(1)).toBeCloseTo(RESPAWN_DELAY_BASE + RESPAWN_DELAY_GROWTH, 1)
  })

  test('a shooter never scores off its own deaths', () => {
    const world = createWorld(2)
    const a = combatant(0, 500, 400)
    const b = combatant(1, 1500, 400)
    const sim = createSim(world, [a, b], { mode: SimMode.DEATHMATCH })
    a.ship.health = 10
    world.bullets.push(lethalShot(a.ship.x, a.ship.y, b.ship.id)) // b kills a
    sim.step(1 / 60)
    expect(b.score).toBe(DEATHMATCH_FRAG_SCORE)
    expect(a.score).toBe(0)
  })
})

describe('createSim — campaign', () => {
  test('a campaign kill scores the killer; the victim respawns while its base stands (no life count)', () => {
    const world = createWorld(3)
    const player = combatant(0, 500, 400)
    const enemy = combatant(1, 1500, 400)
    const sim = createSim(world, [player, enemy], { mode: SimMode.CAMPAIGN })
    player.ship.health = 5
    world.bullets.push(lethalShot(player.ship.x, player.ship.y, enemy.ship.id))

    const events = sim.step(1 / 60)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ victimId: 0, eliminated: false })
    expect(enemy.score).toBe(BOT_KILL_SCORE)
  })
})

describe('createSim — base capture cuts respawns', () => {
  test('CAMPAIGN seeds one barracks per side; DEATHMATCH stays baseless', () => {
    const campaign = createWorld(21)
    createSim(campaign, [combatant(0, 500, 400)], { mode: SimMode.CAMPAIGN })
    expect(campaign.bases).toHaveLength(2)
    const dm = createWorld(21)
    createSim(dm, [combatant(0, 500, 400)], { mode: SimMode.DEATHMATCH })
    expect(dm.bases).toHaveLength(0)
  })

  test('dying with your last held base captured is elimination — and the wreck leaves the world', () => {
    const world = createWorld(22)
    const player = combatant(0, 500, 400)
    const enemy = combatant(1, 1500, 400)
    const sim = createSim(world, [player, enemy], { mode: SimMode.CAMPAIGN })
    const home = world.bases.find((b) => b.owner === 0)
    if (home) {
      home.capture = 1
      home.capturedBy = 1
    }
    player.ship.health = 5
    world.bullets.push(lethalShot(player.ship.x, player.ship.y, enemy.ship.id))

    const events = sim.step(1 / 60)

    expect(events[0]).toMatchObject({ victimId: 0, eliminated: true })
    expect(world.ships.some((s) => s.id === 0)).toBe(false) // no ghost left to target or draw
  })

  test('holding the ENEMY base keeps a beheaded side respawning — mustered above the captured pad', () => {
    const world = createWorld(26)
    const player = combatant(0, 500, 400)
    const enemy = combatant(1, 1500, 400)
    const sim = createSim(world, [player, enemy], { mode: SimMode.CAMPAIGN })
    const home = world.bases.find((b) => b.owner === 0)
    const taken = world.bases.find((b) => b.owner === 1)
    expect(home).toBeDefined()
    expect(taken).toBeDefined()
    if (!home || !taken) return
    player.ship.health = 5
    world.bullets.push(lethalShot(player.ship.x, player.ship.y, enemy.ship.id))
    // An occupying squad holds both captures for the whole wait (an empty zone bleeds capture
    // back through stepBases — occupation, not a flag, is what "holding" means).
    const holdCaptures = (): void => {
      home.capture = 1
      home.capturedBy = 1 // own barracks lost…
      taken.capture = 1
      taken.capturedBy = 0 // …but the enemy's taken in return
    }
    holdCaptures()
    expect(sim.step(1 / 60)[0]).toMatchObject({ victimId: 0, eliminated: false }) // the taken pad sustains the side
    let musterX: number | undefined // sampled the frame the ship re-enters (gravity moves it after)
    let musterY: number | undefined
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 0.2) * 60); i += 1) {
      holdCaptures()
      sim.step(1 / 60)
      const ship = world.ships.find((s) => s.id === 0)
      if (ship && musterY === undefined) {
        musterX = ship.x
        musterY = ship.y
      }
    }
    expect(musterX).toBe(taken.x) // respawned despite the fallen home, above the pad it captured
    expect(musterY).toBeCloseTo(taken.y - SPAWN_ALTITUDE, 0)
  })

  test('losing your last base while the clock runs is immediate elimination (no doomed countdown)', () => {
    const world = createWorld(27)
    const player = combatant(0, 500, 400)
    const enemy = combatant(1, 1500, 400)
    const sim = createSim(world, [player, enemy], { mode: SimMode.CAMPAIGN })
    player.ship.health = 5
    world.bullets.push(lethalShot(player.ship.x, player.ship.y, enemy.ship.id))
    expect(sim.step(1 / 60)[0]).toMatchObject({ victimId: 0, eliminated: false }) // the base stood at death
    const home = world.bases.find((b) => b.owner === 0)
    expect(home).toBeDefined()
    if (!home) return
    home.capture = 1 // the assault completes while the wreck waits
    home.capturedBy = 1
    // The very next frame — far inside the RESPAWN_DELAY_BASE wait — the noose closes: no
    // sitting through a countdown whose outcome is already sealed.
    const events = sim.step(1 / 60)
    expect(events).toContainEqual(expect.objectContaining({ victimId: 0, eliminated: true }))
    expect(world.ships.some((s) => s.id === 0)).toBe(false) // the reinforcement never arrived
    expect(sim.respawnIn(0)).toBe(0)
  })

  test('a pool lapping over a pad floats the barracks slab up to the waterline', () => {
    const world = createWorld(21)
    const sim = createSim(world, [combatant(0, 500, 400)], { mode: SimMode.CAMPAIGN })
    const home = world.bases.find((b) => b.owner === 0)
    expect(home).toBeDefined()
    if (!home) return
    const before = home.y
    world.water = [...world.water, { x: home.x - 200, y: before - 30, w: 400, h: 60 }] // surface 30 px over the pad
    sim.step(1 / 60)
    expect(home.y).toBe(before - 36) // floated up in whole cells until the deck cleared the waterline
    const slab = world.blocks.find(
      (b) => b.structure === StructureType.METAL && home.x >= b.x && home.x < b.x + b.w && b.y === home.y
    )
    expect(slab).toBeDefined() // the indestructible slab moved with the barracks line
  })

  test('an uncaptured base means a normal respawn (the noose only closes when the base falls)', () => {
    const world = createWorld(23)
    const player = combatant(0, 500, 400)
    const enemy = combatant(1, 1500, 400)
    const sim = createSim(world, [player, enemy], { mode: SimMode.CAMPAIGN })
    player.ship.health = 5
    world.bullets.push(lethalShot(player.ship.x, player.ship.y, enemy.ship.id))
    const events = sim.step(1 / 60)
    expect(events[0]).toMatchObject({ victimId: 0, eliminated: false })
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 0.2) * 60); i += 1) sim.step(1 / 60)
    expect(world.ships.some((s) => s.id === 0)).toBe(true) // back after the reinforcement wait
  })
})

describe('createSim — troop bay + deploy', () => {
  const deployInput = inputFromSnapshot({ ...NEUTRAL_INPUT, deploying: true })

  test('mode fills the bay: DEATHMATCH spawns full, CAMPAIGN spawns empty', () => {
    const dm = combatant(0, 500, 400)
    createSim(createWorld(11), [dm], { mode: SimMode.DEATHMATCH })
    expect(dm.ship.troops).toBe(TROOP_BAY_CAPACITY)

    const camper = combatant(0, 500, 400)
    createSim(createWorld(11), [camper], { mode: SimMode.CAMPAIGN })
    expect(camper.ship.troops).toBe(0)
  })

  test('holding deploy streams troopers at the cadence and drains the bay', () => {
    const world = createWorld(12)
    const carrier = combatant(0, 500, 400)
    carrier.input = deployInput
    const sim = createSim(world, [carrier], { mode: SimMode.DEATHMATCH })

    sim.step(1 / 60)
    expect(world.devices).toHaveLength(1) // first trooper out
    expect(carrier.ship.troops).toBe(TROOP_BAY_CAPACITY - 1)
    sim.step(1 / 60) // still inside TROOP_DEPLOY_COOLDOWN
    expect(world.devices).toHaveLength(1)

    for (let i = 0; i < 180; i += 1) sim.step(1 / 60) // 3s hold: the whole bay empties, then stops
    expect(carrier.ship.troops).toBeLessThan(1)
    const troopers = world.devices.filter((d) => d.owner === 0)
    expect(troopers).toHaveLength(TROOP_BAY_CAPACITY) // exactly one bay's worth — never more
  })

  test('an empty bay deploys nothing (CAMPAIGN spawn)', () => {
    const world = createWorld(13)
    const empty = combatant(0, 500, 400)
    empty.input = deployInput
    const sim = createSim(world, [empty], { mode: SimMode.CAMPAIGN })
    for (let i = 0; i < 10; i += 1) sim.step(1 / 60)
    // The barracks field their own guards in CAMPAIGN — only ship-deployed troopers count here.
    expect(world.devices.filter((d) => d.kind === DeviceKind.INFANTRY && !d.guard)).toHaveLength(0)
  })

  test('a DEATHMATCH respawn refills the bay', () => {
    const world = createWorld(14)
    const shooter = combatant(0, 500, 400)
    const victim = combatant(1, 520, 400)
    const sim = createSim(world, [victim, shooter], { mode: SimMode.DEATHMATCH })
    victim.ship.troops = 2 // partially spent bay
    victim.ship.health = 10
    world.bullets.push(lethalShot(victim.ship.x, victim.ship.y, shooter.ship.id))
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 0.2) * 60); i += 1) sim.step(1 / 60)
    expect(victim.ship.troops).toBe(TROOP_BAY_CAPACITY)
  })
})

describe('createSim — destructible terrain', () => {
  test('firing into a destructible surface carves it and bumps the terrain version', () => {
    const world = createWorld(7)
    const gunner = combatant(0, 540, 1280)
    gunner.ship.angle = Math.PI / 2 // forward = +y (straight down into the earth)
    gunner.ship.invuln = 999 // keep it from dying on the terrain while it shoots
    gunner.input = inputFromSnapshot({
      turn: 0,
      thrusting: false,
      reversing: false,
      firing: true,
      altFiring: false,
      deploying: false,
    })
    const sim = createSim(world, [gunner], { mode: SimMode.DEATHMATCH })
    // The arena is procedural, so target whatever destructible earth this seed produced: park the
    // gunner just above the highest exposed earth top and let its downward stream carve into it.
    const air = (x: number, y: number): boolean =>
      !world.blocks.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    const target = world.blocks
      .filter((b) => b.structure === StructureType.EARTH && b.w >= 36 && air(b.x + b.w / 2, b.y - 30))
      .sort((a, b) => a.y - b.y)[0]
    expect(target).toBeDefined()
    gunner.ship.x = target.x + target.w / 2
    gunner.ship.y = target.y - 24

    const versionBefore = world.terrainVersion
    const rockAreaBefore = destructibleArea(world.blocks)
    for (let i = 0; i < 30; i += 1) sim.step(1 / 60)

    expect(world.terrainVersion).toBeGreaterThan(versionBefore) // a carve happened and blocks were rebuilt
    expect(destructibleArea(world.blocks)).toBeLessThan(rockAreaBefore) // the earth actually lost mass
  })
})

describe('createSim — grass fire', () => {
  test('a flame gout sets the lawn alight; the first cells spend to bare earth while the fire creeps on', () => {
    const world = createWorld(7)
    const bystander = combatant(0, 500, 400)
    bystander.ship.invuln = 999 // park it out of the story — the terrain is the subject
    const sim = createSim(world, [bystander], { mode: SimMode.DEATHMATCH })
    // The arena is procedural, so torch whatever lawn this seed produced: the highest exposed
    // grass top wide enough for the fire to have somewhere to creep.
    const air = (x: number, y: number): boolean =>
      !world.blocks.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    const lawn = world.blocks
      .filter((b) => b.surface === Surface.GRASS && b.w >= 90 && air(b.x + b.w / 2, b.y - 30))
      .sort((a, b) => a.y - b.y)[0]
    expect(lawn).toBeDefined()
    const cx = lawn.x + lawn.w / 2
    const surfaceAt = (x: number, y: number): Surface | undefined =>
      world.blocks.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)?.surface

    const versionBefore = world.terrainVersion
    world.bullets.push({ x: cx, y: lawn.y + 2, vx: 0, vy: 0, radius: 3, life: 0.3, owner: 0, damage: 3, burn: true })
    sim.step(1 / 60)
    expect(surfaceAt(cx, lawn.y + 2)).toBe(Surface.FIRE) // alight where the gout splashed, not scorched away
    expect(world.terrainVersion).toBeGreaterThan(versionBefore)

    for (let i = 0; i < Math.ceil((GRASS_BURN_TIME + 0.2) * 60); i += 1) sim.step(1 / 60)
    expect(surfaceAt(cx, lawn.y + 2)).toBe(Surface.EARTH) // the first-caught cells burned through…
    expect(world.blocks.some((b) => b.surface === Surface.FIRE)).toBe(true) // …while the creep marches on
  })
})

describe('createSim — water', () => {
  test('ship buoyancy reads water pooled into world.water after the sim was created', () => {
    const world = createWorld(8)
    const floater = combatant(0, 500, 400)
    const sim = createSim(world, [floater], { mode: SimMode.DEATHMATCH })
    // A pool forms mid-run (as the water cannon does), replacing the world.water array. The ship
    // sits fully under the new surface, so buoyancy (which beats gravity) must push it upward —
    // proving the ship-physics env reads world.water live rather than a stale start-of-run snapshot.
    sim.world.water = [{ x: 0, y: 380, w: 5000, h: 400 }]
    floater.ship.vy = 0
    sim.step(1 / 60)
    expect(floater.ship.vy).toBeLessThan(0)
  })
})

describe('createSim — membership', () => {
  const trooperOf = (owner: number): Device => ({
    kind: DeviceKind.INFANTRY,
    x: 700,
    y: 300,
    vx: 0,
    vy: 0,
    owner,
    radius: 9,
    guard: false,
    attached: false,
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

  test('addCombatant / removeCombatant keep world.ships in lockstep', () => {
    const world = createWorld(4)
    const a = combatant(0, 500, 400)
    const sim = createSim(world, [a], { mode: SimMode.DEATHMATCH })
    expect(world.ships).toHaveLength(1)

    const b = combatant(1, 700, 400)
    sim.addCombatant(b)
    expect(world.ships).toHaveLength(2)
    expect(sim.getCombatant(1)).toBe(b)

    sim.removeCombatant(0)
    expect(world.ships).toHaveLength(1)
    expect(world.ships[0].id).toBe(1)
    expect(sim.getCombatant(0)).toBeUndefined()
  })

  test('removeCombatant(keepDevices) leaves the seat’s troopers fighting; the default drops them', () => {
    const world = createWorld(43)
    const sim = createSim(world, [combatant(0, 500, 400), combatant(1, 700, 400)], { mode: SimMode.DEATHMATCH })
    const benched = trooperOf(0)
    const gone = trooperOf(1)
    world.devices.push(benched, gone)
    sim.removeCombatant(0, true) // benched seat — its man fights on
    expect(world.devices).toContain(benched)
    sim.removeCombatant(1) // gone for good — orphans dropped
    expect(world.devices).not.toContain(gone)
  })

  test('addCombatant with respawnIn keeps the ship out of the world until the clock elapses', () => {
    const world = createWorld(41)
    const sim = createSim(world, [], { mode: SimMode.DEATHMATCH })
    sim.addCombatant(combatant(0, 500, 400), { respawnIn: 2 })
    expect(world.ships).toHaveLength(0) // mid-respawn seat: registered, not flying
    expect(sim.respawnIn(0)).toBeCloseTo(2, 1)
    for (let i = 0; i < Math.ceil(2.2 * 60); i += 1) sim.step(1 / 60)
    expect(world.ships.some((s) => s.id === 0)).toBe(true) // the normal reinforcement path seated it
  })

  test('restored deaths drive the compounding delay (the attrition clock survives a restore)', () => {
    const world = createWorld(42)
    const shooter = combatant(0, 500, 400)
    const victim = combatant(1, 520, 400)
    victim.deaths = 3 // as if read back from a persisted seat
    const sim = createSim(world, [shooter, victim], { mode: SimMode.DEATHMATCH })
    victim.ship.health = 10
    world.bullets.push(lethalShot(victim.ship.x, victim.ship.y, shooter.ship.id))
    sim.step(1 / 60)
    expect(sim.respawnIn(1)).toBeCloseTo(RESPAWN_DELAY_BASE + 3 * RESPAWN_DELAY_GROWTH, 1)
  })
})

describe('createSim — flame and water vs infantry', () => {
  const airborneTrooper = (x: number, y: number, owner: number): Extract<Device, { kind: DeviceKind.INFANTRY }> => ({
    kind: DeviceKind.INFANTRY,
    x,
    y,
    vx: 0,
    vy: 0,
    owner,
    radius: 9,
    guard: false,
    attached: false,
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

  test('friendly fire is real: a stray same-side bullet splatters a trooper', () => {
    const world = createWorld(31)
    const sim = createSim(world, [combatant(0, 500, 400)], { mode: SimMode.DEATHMATCH })
    const ownMan = airborneTrooper(700, 300, 0) // same side as the bullet below
    world.devices.push(ownMan)
    world.bullets.push({ x: 700, y: 300, vx: 0, vy: 0, radius: 3, life: 0.3, owner: 0, damage: 22 })
    sim.step(1 / 60)
    expect(world.devices).not.toContain(ownMan)
  })

  test('a flame gout ignites a trooper (no instant kill); a water squirt douses and shoves it', () => {
    const world = createWorld(21)
    const sim = createSim(world, [combatant(0, 500, 400)], { mode: SimMode.DEATHMATCH })
    const victim = airborneTrooper(700, 300, 1)
    world.devices.push(victim)
    world.bullets.push({ x: 700, y: 300, vx: 0, vy: 0, radius: 3, life: 0.3, owner: 0, damage: 3, burn: true })
    sim.step(1 / 60)
    expect(world.devices).toContain(victim) // alight, not splattered
    expect(victim.burning).toBeGreaterThan(0)
    world.bullets.push({
      x: victim.x,
      y: victim.y,
      vx: 50,
      vy: 0,
      radius: 3,
      life: 0.3,
      owner: 0,
      damage: 2,
      push: 120,
      wet: true,
    })
    sim.step(1 / 60)
    expect(world.devices).toContain(victim) // the jet never kills
    expect(victim.burning).toBe(0) // doused
    expect(victim.vx).toBeGreaterThan(0) // and shoved along the jet
  })
})
