import { NET_BENCH_MAX, NET_MAX_PLAYERS, ShipKind, SimMode } from '$/game/constants'
import { type InputSnapshot, inputFromSnapshot, NEUTRAL_INPUT } from '$/game/input'
import { createShip } from '$/game/ship'
import { type Combatant, chooseSpawn, createSim, createWorld, type DeathEvent, type Sim } from '$/game/sim'
import type { Ship } from '$/game/types'
import { MsgType, type PlayerInfo, pilotNameKey, type ServerMessage } from '$/net/protocol'
import { PERSIST_VERSION, type PersistedSeat, type RoomRestore } from '$/server/restore'

// The state document's reader (validation + the RoomRestore shape) lives in restore.ts; this
// re-export keeps the original import surface for callers and tests.
export { parseRestore, type RoomRestore } from '$/server/restore'

// A connected player's mutable control state — the room mutates this object from inbound
// INPUT messages and the sim reads it live each tick through inputFromSnapshot.
type Member = {
  shipId: number
  name: string
  input: InputSnapshot
}

// A disconnected pilot's seat, parked so the same name can reclaim it (no auth — the name IS
// the identity, NFKC-casefolded). The ship object is kept whole (position, hull, troop bay) and
// its deployed troopers keep fighting; the attrition clock is captured as relative seconds and
// resumes on reclaim. Spoofable by design within this room and the state TTL window: only
// disconnected seats are claimable — a live duplicate name is refused.
type BenchedSeat = {
  ship: Ship
  name: string
  score: number
  deaths: number
  respawnIn: number
  palette: number // the seat's PLAYER_PALETTE slot — held while benched so a reclaim keeps its color
}

export enum JoinRefusal {
  FULL = 'FULL',
  NAME_TAKEN = 'NAME_TAKEN',
}

export type JoinResult = { shipId: number; reclaimed: boolean } | { refusal: JoinRefusal }

export type Room = {
  name: string
  sim: Sim
  // Seat a player: a benched same-name seat is reclaimed (same ship, score, clocks), a fresh
  // name gets a new seat, a live duplicate name or a full room is refused.
  join: (name: string) => JoinResult
  leave: (shipId: number) => void
  setInput: (shipId: number, input: InputSnapshot) => void
  step: (dt: number) => DeathEvent[]
  snapshot: (events: DeathEvent[]) => ServerMessage
  // The persistence document (PERSIST_VERSION, see restore.ts): seed + clock + id cursor +
  // water + devices + the full seat roster (live and benched, ships included), with the carved
  // voxel state spliced in (encoded once per terrainVersion, not per write). Bullets/beams/
  // particles are deliberately NOT persisted (≤ 2 s of cosmetic churn), nor is the rng stream
  // position (a resurrected room is state-equal, not a replay continuation).
  persisted: () => string
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
  // Resurrecting a persisted room: the seed already rebuilt the authored terrain above. The
  // hydration ORDER below is load-bearing: the clock first (pending-respawn math is
  // world.time-relative), then devices + the carved grid, then the id cursor pushed past every
  // restored seat, then the roster onto the bench — nobody's ship enters the sim until its pilot
  // reclaims it, so a resurrected room is the arena plus the autonomous minion war under a greyed
  // scoreboard. A snapshot that doesn't fit (foreign seed / changed grid constants) is ignored —
  // the room simply starts with the seed's pristine arena. Water is NOT hydrated here: it lives in
  // the per-cell fluid grid (inside the terrain snapshot), and restoreTerrain re-derives world.water
  // from it — so a stale rect array can never desync from the grid the physics actually flows.
  if (restore?.time !== undefined) world.time = restore.time
  if (restore?.devices) world.devices = restore.devices
  if (restore?.terrain) sim.restoreTerrain(restore.terrain)
  const members = new Map<number, Member>()
  let nextId = restore?.nextId ?? 0 // monotonic per room: ids are never reused, so stale bullets can't mislabel a new seat
  const bench = new Map<string, BenchedSeat>() // pilotNameKey → seat; insertion order = age
  const palettes = new Map<number, number>() // live shipId → PLAYER_PALETTE slot

  // The lowest PLAYER_PALETTE slot no live or benched seat holds. When every slot is held the
  // OLDEST benched seat's slot is stolen — live players always stay pairwise distinct (a stolen
  // slot recolors that orphan's lingering troopers, a brief visual lie, never a live ambiguity).
  const freeSlot = (): number => {
    const used = new Set<number>([...palettes.values(), ...[...bench.values()].map((seat) => seat.palette)])
    for (let slot = 0; slot < NET_MAX_PLAYERS; slot += 1) if (!used.has(slot)) return slot
    const live = new Set(palettes.values())
    for (const seat of bench.values()) if (!live.has(seat.palette)) return seat.palette // oldest first
    return NET_MAX_PLAYERS - 1 // unreachable: live seats can't fill every slot AND the bench
  }

  for (const seat of restore?.roster ?? []) {
    nextId = Math.max(nextId, seat.id + 1)
    bench.set(pilotNameKey(seat.name), {
      ship: seat.ship,
      name: seat.name,
      score: seat.score,
      deaths: seat.deaths,
      respawnIn: seat.respawnIn,
      palette: seat.palette ?? freeSlot(), // a degraded/legacy row gets the lowest free slot
    })
  }
  // The persisted terrain blob is the heavy part of the state document — encode it only when
  // the terrain actually changed, not on every periodic write.
  let terrainCache: { version: number; json: string } | undefined

  // Park a seat for reclaim; re-benching the same pilot refreshes its age, and past the cap
  // the OLDEST seat is forgotten.
  const benchSeat = (seat: BenchedSeat): void => {
    const key = pilotNameKey(seat.name)
    bench.delete(key)
    bench.set(key, seat)
    while (bench.size > NET_BENCH_MAX) {
      const oldest = bench.keys().next().value
      if (oldest === undefined) break
      bench.delete(oldest)
    }
  }

  const join = (displayName: string): JoinResult => {
    const key = pilotNameKey(displayName)
    // One seat per live pilot name: refusing the duplicate (rather than evicting the original)
    // also keeps a reconnect-before-close race from seating a pilot twice.
    for (const member of members.values()) {
      if (pilotNameKey(member.name) === key) return { refusal: JoinRefusal.NAME_TAKEN }
    }
    if (members.size >= NET_MAX_PLAYERS) return { refusal: JoinRefusal.FULL }
    const input: InputSnapshot = { ...NEUTRAL_INPUT }
    const benched = bench.get(key)
    if (benched) {
      bench.delete(key)
      const combatant: Combatant = {
        ship: benched.ship,
        input: inputFromSnapshot(input),
        name: displayName,
        score: benched.score,
        deaths: benched.deaths,
        spawn: { x: benched.ship.x, y: benched.ship.y },
      }
      const troops = benched.ship.troops
      sim.addCombatant(combatant, { respawnIn: benched.respawnIn })
      // Reassigned AFTER addCombatant: seating refills a DEATHMATCH bay, which would clobber
      // the bay the pilot disconnected with. Load-bearing only for an ALIVE reclaim — a seat
      // still mid-respawn re-enters through the normal dequeue, which re-kits the ship
      // (fresh bay, fresh weapon) like any other respawn, by design.
      benched.ship.troops = troops
      benched.ship.invuln = Math.max(benched.ship.invuln, 1) // re-entry grace
      // Same seat, same color — unless that slot was stolen out from under this bench while it
      // slept (all-8-held steal). Restoring a slot a LIVE seat now holds would put two live
      // players in one color; in that (rare) case take the lowest free slot instead.
      const live = new Set(palettes.values())
      palettes.set(benched.ship.id, live.has(benched.palette) ? freeSlot() : benched.palette)
      members.set(benched.ship.id, { shipId: benched.ship.id, name: displayName, input })
      return { shipId: benched.ship.id, reclaimed: true }
    }
    const shipId = nextId++
    const spawn = chooseSpawn(world, sim.world.ships)
    const ship = createShip(ShipKind.PLAYER, spawn.x, spawn.y, shipId, world.rng)
    const combatant: Combatant = {
      ship,
      input: inputFromSnapshot(input),
      name: displayName,
      score: 0,
      deaths: 0,
      spawn,
    }
    sim.addCombatant(combatant)
    palettes.set(shipId, freeSlot())
    members.set(shipId, { shipId, name: displayName, input })
    return { shipId, reclaimed: false }
  }

  const leave = (shipId: number): void => {
    const member = members.get(shipId)
    const combatant = sim.getCombatant(shipId)
    if (member && combatant) {
      // Capture the respawn clock BEFORE removeCombatant clears the pending queue.
      benchSeat({
        ship: combatant.ship,
        name: member.name,
        score: combatant.score,
        deaths: combatant.deaths,
        respawnIn: sim.respawnIn(shipId),
        palette: palettes.get(shipId) ?? 1, // the slot rides the bench
      })
    }
    sim.removeCombatant(shipId, true) // benched, not gone — the pilot's troopers keep fighting
    palettes.delete(shipId)
    members.delete(shipId)
  }

  const setInput = (shipId: number, input: InputSnapshot): void => {
    const member = members.get(shipId)
    if (member) Object.assign(member.input, sanitizeInput(input))
  }

  // Live seats first, then the bench (connected: false) — a disconnected pilot stays on the
  // scoreboard (greyed) and their orphaned troopers keep a resolvable owner AND color.
  // respawnIn rides the row (0.1 s steps) so the client can count its own reinforcement down.
  const players = (): PlayerInfo[] => [
    ...sim.combatants.map((c) => ({
      id: c.ship.id,
      name: c.name,
      score: c.score,
      palette: palettes.get(c.ship.id) ?? 1,
      respawnIn: Math.round(sim.respawnIn(c.ship.id) * 10) / 10,
      connected: members.has(c.ship.id),
    })),
    ...[...bench.values()].map((seat) => ({
      id: seat.ship.id,
      name: seat.name,
      score: seat.score,
      palette: seat.palette,
      respawnIn: 0,
      connected: false,
    })),
  ]

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
    // Every seat, live and benched — full ship objects included (a mid-respawn ship is not in
    // world.ships; the seat owns it), respawn clocks as RELATIVE seconds remaining.
    const roster: PersistedSeat[] = [
      ...sim.combatants.map((c) => ({
        id: c.ship.id,
        name: c.name,
        score: c.score,
        deaths: c.deaths,
        respawnIn: sim.respawnIn(c.ship.id),
        palette: palettes.get(c.ship.id) ?? 1,
        ship: c.ship,
      })),
      ...[...bench.values()].map((seat) => ({
        id: seat.ship.id,
        name: seat.name,
        score: seat.score,
        deaths: seat.deaths,
        respawnIn: seat.respawnIn,
        palette: seat.palette,
        ship: seat.ship,
      })),
    ]
    // Assembled by string concatenation so the (large, already-encoded) terrain blob isn't
    // re-serialized through the object path on every periodic write.
    const head = JSON.stringify({
      v: PERSIST_VERSION,
      seed,
      savedAt: Date.now(),
      nextId,
      time: world.time,
      devices: world.devices,
      roster,
    })
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
