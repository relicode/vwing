import { NET_MAX_PLAYERS, ShipKind, SimMode } from '$/game/constants'
import { type InputSnapshot, inputFromSnapshot, NEUTRAL_INPUT } from '$/game/input'
import { createShip } from '$/game/ship'
import { type Combatant, chooseSpawn, createSim, createWorld, type DeathEvent, type Sim } from '$/game/sim'
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
  players: () => PlayerInfo[]
  playerCount: () => number
  isEmpty: () => boolean
}

const makeSeed = (): number => Math.floor(Math.random() * 0xffffffff)

// Coerce arbitrary inbound JSON into a safe control snapshot (a hostile/buggy client can't
// inject odd turn values, non-booleans, or a missing/non-object payload into the sim).
const sanitizeInput = (raw: InputSnapshot | undefined): InputSnapshot => {
  if (!raw || typeof raw !== 'object') return { ...NEUTRAL_INPUT }
  return {
    turn: raw.turn > 0 ? 1 : raw.turn < 0 ? -1 : 0,
    thrusting: raw.thrusting === true,
    firing: raw.firing === true,
    altFiring: raw.altFiring === true,
  }
}

export const createRoom = (name: string): Room => {
  const world = createWorld(makeSeed())
  const sim = createSim(world, [], { mode: SimMode.DEATHMATCH })
  const members = new Map<number, Member>()
  let nextId = 0 // monotonic per room: ids are never reused, so stale bullets can't mislabel a new seat

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

  return {
    name,
    sim,
    join,
    leave,
    setInput,
    step: (dt) => sim.step(dt),
    snapshot,
    players,
    playerCount: () => members.size,
    isEmpty: () => members.size === 0,
  }
}
