import { describe, expect, test } from 'bun:test'

import {
  BOT_KILL_SCORE,
  DEATHMATCH_FRAG_SCORE,
  SHIP_MAX_HEALTH,
  ShipKind,
  SimMode,
  StructureType,
} from '$/game/constants'
import { inputFromSnapshot, NEUTRAL_INPUT } from '$/game/input'
import { createShip } from '$/game/ship'
import { type Combatant, createSim, createWorld } from '$/game/sim'
import type { Block, Bullet } from '$/game/types'

// Total pixel area of destructible (earth, non-metal) terrain — shrinks as earth is shot away.
const destructibleArea = (blocks: Block[]): number =>
  blocks.reduce((sum, b) => (b.structure === StructureType.METAL ? sum : sum + b.w * b.h), 0)

const combatant = (id: number, x: number, y: number, lives: number): Combatant => {
  const ship = createShip(ShipKind.PLAYER, x, y, id)
  ship.invuln = 0 // drop spawn invulnerability so the test shot connects
  return { ship, input: inputFromSnapshot({ ...NEUTRAL_INPUT }), name: `p${id}`, score: 0, lives, spawn: { x, y } }
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
  test('a kill credits the shooter a frag and respawns the victim (endless lives)', () => {
    const world = createWorld(1)
    const shooter = combatant(0, 500, 400, Number.POSITIVE_INFINITY)
    const victim = combatant(1, 520, 400, Number.POSITIVE_INFINITY)
    const sim = createSim(world, [shooter, victim], { mode: SimMode.DEATHMATCH })
    victim.ship.health = 10
    world.bullets.push(lethalShot(victim.ship.x, victim.ship.y, shooter.ship.id))

    const events = sim.step(1 / 60)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ victimId: 1, killerId: 0, eliminated: false })
    expect(shooter.score).toBe(DEATHMATCH_FRAG_SCORE)
    expect(victim.ship.health).toBe(SHIP_MAX_HEALTH) // respawned, full hull
    expect(victim.ship.invuln).toBeGreaterThan(0) // with fresh spawn invulnerability
  })

  test('a shooter never scores off its own deaths', () => {
    const world = createWorld(2)
    const a = combatant(0, 500, 400, Number.POSITIVE_INFINITY)
    const b = combatant(1, 1500, 400, Number.POSITIVE_INFINITY)
    const sim = createSim(world, [a, b], { mode: SimMode.DEATHMATCH })
    a.ship.health = 10
    world.bullets.push(lethalShot(a.ship.x, a.ship.y, b.ship.id)) // b kills a
    sim.step(1 / 60)
    expect(b.score).toBe(DEATHMATCH_FRAG_SCORE)
    expect(a.score).toBe(0)
  })
})

describe('createSim — campaign', () => {
  test('running out of lives eliminates the victim (no respawn) and scores the killer', () => {
    const world = createWorld(3)
    const player = combatant(0, 500, 400, 1) // last life
    const enemy = combatant(1, 1500, 400, Number.POSITIVE_INFINITY)
    const sim = createSim(world, [player, enemy], { mode: SimMode.CAMPAIGN })
    player.ship.health = 5
    world.bullets.push(lethalShot(player.ship.x, player.ship.y, enemy.ship.id))

    const events = sim.step(1 / 60)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ victimId: 0, eliminated: true })
    expect(player.lives).toBe(0)
    expect(enemy.score).toBe(BOT_KILL_SCORE)
  })
})

describe('createSim — destructible terrain', () => {
  test('firing into a destructible surface carves it and bumps the terrain version', () => {
    const world = createWorld(7)
    // Park a ship just above the submerged rock pillar at block(420,1300,240,…), nose down.
    const gunner = combatant(0, 540, 1280, Number.POSITIVE_INFINITY)
    gunner.ship.angle = Math.PI / 2 // forward = +y (straight down into the rock)
    gunner.ship.invuln = 999 // keep it from dying on the rock while it shoots
    gunner.input = inputFromSnapshot({ turn: 0, thrusting: false, firing: true, altFiring: false })
    const sim = createSim(world, [gunner], { mode: SimMode.DEATHMATCH })

    const versionBefore = world.terrainVersion
    const rockAreaBefore = destructibleArea(world.blocks)
    for (let i = 0; i < 30; i += 1) sim.step(1 / 60)

    expect(world.terrainVersion).toBeGreaterThan(versionBefore) // a carve happened and blocks were rebuilt
    expect(destructibleArea(world.blocks)).toBeLessThan(rockAreaBefore) // the rock actually lost mass
  })
})

describe('createSim — water', () => {
  test('ship buoyancy reads water pooled into world.water after the sim was created', () => {
    const world = createWorld(8)
    const floater = combatant(0, 500, 400, Number.POSITIVE_INFINITY)
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
  test('addCombatant / removeCombatant keep world.ships in lockstep', () => {
    const world = createWorld(4)
    const a = combatant(0, 500, 400, Number.POSITIVE_INFINITY)
    const sim = createSim(world, [a], { mode: SimMode.DEATHMATCH })
    expect(world.ships).toHaveLength(1)

    const b = combatant(1, 700, 400, Number.POSITIVE_INFINITY)
    sim.addCombatant(b)
    expect(world.ships).toHaveLength(2)
    expect(sim.getCombatant(1)).toBe(b)

    sim.removeCombatant(0)
    expect(world.ships).toHaveLength(1)
    expect(world.ships[0].id).toBe(1)
    expect(sim.getCombatant(0)).toBeUndefined()
  })
})
