import { NET_MAX_PLAYERS, ShipKind, SimMode } from '$/game/constants'
import { type InputSnapshot, inputFromSnapshot, NEUTRAL_INPUT } from '$/game/input'
import { createShip } from '$/game/ship'
import { type Combatant, chooseSpawn, createSim, createWorld, type DeathEvent, type Sim } from '$/game/sim'
import type { WaterBody } from '$/game/types'
import type { VoxelSnapshot } from '$/game/voxel'
import { livesToWire, MsgType, type PlayerInfo, type ServerMessage } from '$/net/protocol'

// A connected player's mutable control state — the room mutates this object from inbound
// INPUT messages and the sim reads it live each tick through inputFromSnapshot.
type Member = {
  shipId: number
  name: string
  input: InputSnapshot
}

export type Room = {
  name: string
  sim: Sim
  // Seat a new player; returns the assigned ship id, or undefined when the room is full.
  join: (name: string) => number | undefined
  leave: (shipId: number) => void
  setInput: (shipId: number, input: InputSnapshot) => void
  step: (dt: number) => DeathEvent[]
  snapshot: (events: DeathEvent[]) => ServerMessage
  // The persistence document: the broadcast world PLUS what a restart needs to rebuild the
  // arena exactly — the generator seed and the carved voxel state (encoded once per
  // terrainVersion, not per write).
  persisted: () => string
  players: () => PlayerInfo[]
  playerCount: () => number
  isEmpty: () => boolean
}

// Everything a restarted server needs to resurrect a room's arena: the seed reproduces the
// authored terrain (the generator is deterministic per seed), the voxel snapshot overlays the
// craters/debris/pins on top, and the water list carries any pools poured since authoring.
export type RoomRestore = {
  seed: number
  terrain?: VoxelSnapshot
  water?: WaterBody[]
}

// Parse + shape-check a persisted state document into a RoomRestore, or undefined when the
// JSON is foreign/corrupt (a bad blob must never take the room-creation path down).
export const parseRestore = (json: string): RoomRestore | undefined => {
  try {
    const raw = JSON.parse(json) as { seed?: unknown; terrain?: VoxelSnapshot; world?: { water?: WaterBody[] } }
    if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) return undefined
    return {
      seed: raw.seed >>> 0,
      terrain: raw.terrain && typeof raw.terrain === 'object' ? raw.terrain : undefined,
      water: Array.isArray(raw.world?.water) ? raw.world.water : undefined,
    }
  } catch {
    return undefined
  }
}

const makeSeed = (): number => Math.floor(Math.random() * 0xffffffff)

// Coerce arbitrary inbound JSON into a safe control snapshot (a hostile/buggy client can't
// inject odd turn values, non-booleans, or a missing/non-object payload into the sim).
const sanitizeInput = (raw: InputSnapshot | undefined): InputSnapshot => {
  if (!raw || typeof raw !== 'object') return { ...NEUTRAL_INPUT }
  return {
    turn: raw.turn > 0 ? 1 : raw.turn < 0 ? -1 : 0,
    thrusting: raw.thrusting === true,
    reversing: raw.reversing === true,
    firing: raw.firing === true,
    altFiring: raw.altFiring === true,
    deploying: raw.deploying === true, // absent on a stale client → safely false
  }
}

export const createRoom = (name: string, restore?: RoomRestore): Room => {
  const seed = restore?.seed ?? makeSeed()
  const world = createWorld(seed)
  const sim = createSim(world, [], { mode: SimMode.DEATHMATCH })
  // Resurrecting a persisted arena: the seed already rebuilt the authored terrain above;
  // overlay the carved grid (craters, debris, island pins) and the poured water on top.
  // A snapshot that doesn't fit (foreign seed / changed grid constants) is ignored — the
  // room simply starts with the seed's pristine arena.
  if (restore?.water) world.water = restore.water
  if (restore?.terrain) sim.restoreTerrain(restore.terrain)
  const members = new Map<number, Member>()
  let nextId = 0 // monotonic per room: ids are never reused, so stale bullets can't mislabel a new seat
  // The persisted terrain blob is the heavy part of the state document — encode it only when
  // the terrain actually changed, not on every periodic write.
  let terrainCache: { version: number; json: string } | undefined

  const join = (displayName: string): number | undefined => {
    if (members.size >= NET_MAX_PLAYERS) return undefined
    const shipId = nextId++
    const spawn = chooseSpawn(world, sim.world.ships)
    const ship = createShip(ShipKind.PLAYER, spawn.x, spawn.y, shipId, world.rng)
    const input: InputSnapshot = { ...NEUTRAL_INPUT }
    const combatant: Combatant = {
      ship,
      input: inputFromSnapshot(input),
      name: displayName,
      score: 0,
      lives: Number.POSITIVE_INFINITY, // endless respawns in PvP
      spawn,
    }
    sim.addCombatant(combatant)
    members.set(shipId, { shipId, name: displayName, input })
    return shipId
  }

  const leave = (shipId: number): void => {
    sim.removeCombatant(shipId)
    members.delete(shipId)
  }

  const setInput = (shipId: number, input: InputSnapshot): void => {
    const member = members.get(shipId)
    if (member) Object.assign(member.input, sanitizeInput(input))
  }

  const players = (): PlayerInfo[] =>
    sim.combatants.map((c) => ({
      id: c.ship.id,
      name: c.name,
      score: c.score,
      lives: livesToWire(c.lives),
      connected: members.has(c.ship.id),
    }))

  const snapshot = (events: DeathEvent[]): ServerMessage => ({
    t: MsgType.SNAPSHOT,
    // A full World minus the two purely-cosmetic, high-churn fields: `particles` (the client
    // regenerates engine trails / smoke / wreck explosions locally) and the rng closure (which
    // JSON.stringify drops anyway). Everything authoritative still crosses the wire.
    world: { ...sim.world, particles: [] },
    players: players(),
    events,
  })

  const persisted = (): string => {
    if (!terrainCache || terrainCache.version !== sim.world.terrainVersion) {
      terrainCache = { version: sim.world.terrainVersion, json: JSON.stringify(sim.serializeTerrain()) }
    }
    // Assembled by string concatenation so the (large, already-encoded) terrain blob isn't
    // re-serialized through the object path on every periodic write.
    const head = JSON.stringify({ seed, world: { ...sim.world, particles: [] }, players: players() })
    return `${head.slice(0, -1)},"terrain":${terrainCache.json}}`
  }

  return {
    name,
    sim,
    join,
    leave,
    setInput,
    step: (dt) => sim.step(dt),
    snapshot,
    persisted,
    players,
    playerCount: () => members.size,
    isEmpty: () => members.size === 0,
  }
}
