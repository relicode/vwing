import {
  NET_BENCH_MAX,
  NET_DISCONNECT_GRACE,
  NET_MAX_PLAYERS,
  ShipKind,
  SimMode,
  SPAWN_ALTITUDE,
} from '$/game/constants'
import { type InputSnapshot, inputFromSnapshot, NEUTRAL_INPUT } from '$/game/input'
import { createShip } from '$/game/ship'
import { type Combatant, createSim, createWorld, type DeathEvent, type Sim } from '$/game/sim'
import { basePadCenters } from '$/game/terrain-map'
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
  forfeitAt: number // world.time past which this disconnected pilot stops counting toward the match
}

export enum JoinRefusal {
  FULL = 'FULL',
  NAME_TAKEN = 'NAME_TAKEN',
  OVER = 'OVER', // the match has already been decided — no new seats (and no eliminated pilot re-entry)
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
  // The FFA base war has been decided (a lone contender remains after two+ engaged). Latched —
  // the server drops a decided room from the lobby and refuses new seats.
  isOver: () => boolean
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
  // Online is the FFA base war: one barracks per pilot, seated dynamically on a generator pad as
  // each player joins (sim.addBase). Empty bay per life — you fly home and load at your own
  // barracks — capture an enemy's to cut their respawns, and the last pilot still holding a base
  // wins. (Was a baseless DEATHMATCH; SimMode.BATTLE flips on the whole base war.)
  const sim = createSim(world, [], { mode: SimMode.BATTLE })
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

  // ── The FFA base war ────────────────────────────────────────────────────────
  // Each connected seat owns a barracks on a generator pad. A base lives exactly while its seat is
  // connected: allocated on join, torn down on disconnect (the pilot's deployed troopers fight on,
  // but the fort and its capture progress reset), and a fresh one is seated on reclaim. Pads number
  // NET_MAX_PLAYERS — the same cap join enforces — so a free pad always exists when a seat is
  // admitted, and freeing one on every leave keeps live seats and pads exactly paired.
  const pads = basePadCenters()
  const padOf = new Map<number, number>() // live shipId → the pad index its barracks stands on
  const freePad = (): number => {
    const used = new Set(padOf.values())
    for (let i = 0; i < pads.length; i += 1) if (!used.has(i)) return i
    return 0 // unreachable: seats are capped at the pad count, so one is always free here
  }
  const padPerch = (idx: number): { x: number; y: number } => ({ x: pads[idx].x, y: pads[idx].y - SPAWN_ALTITUDE })

  // The match layer over the per-ship base war the sim already runs. A pilot whose last base is
  // captured and then dies is eliminated (the sim drops their ship and never respawns it); once
  // two or more contenders have shared the arena, the instant a lone one is left the match is
  // decided. Everything latches so a late seat or a lingering spectator can't revive a finished
  // match, and an eliminated pilot's name is barred from reclaiming back into the same match.
  const eliminated = new Set<number>() // live shipIds out of the match (from elimination death events)
  const eliminatedNames = new Set<string>() // pilotNameKeys eliminated this match — refused on re-join
  let engaged = false // two+ contenders have been live at once (guards a 1-player walkover "win")
  let matchOver = false
  let winnerId: number | undefined

  for (const seat of restore?.roster ?? []) {
    nextId = Math.max(nextId, seat.id + 1)
    bench.set(pilotNameKey(seat.name), {
      ship: seat.ship,
      name: seat.name,
      score: seat.score,
      deaths: seat.deaths,
      respawnIn: seat.respawnIn,
      palette: seat.palette ?? freeSlot(), // a degraded/legacy row gets the lowest free slot
      forfeitAt: world.time + NET_DISCONNECT_GRACE, // a restored seat gets a fresh grace window to reclaim
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
    // A decided match takes no more seats, and a pilot eliminated this match can't slip back in
    // under the same name (otherwise a fresh barracks on reclaim would undo their elimination).
    if (matchOver || eliminatedNames.has(key)) return { refusal: JoinRefusal.OVER }
    // One seat per live pilot name: refusing the duplicate (rather than evicting the original)
    // also keeps a reconnect-before-close race from seating a pilot twice.
    for (const member of members.values()) {
      if (pilotNameKey(member.name) === key) return { refusal: JoinRefusal.NAME_TAKEN }
    }
    if (members.size >= NET_MAX_PLAYERS) return { refusal: JoinRefusal.FULL }
    const input: InputSnapshot = { ...NEUTRAL_INPUT }
    // A free pad is guaranteed by the size cap above (pads === NET_MAX_PLAYERS, padOf tracks only
    // live seats). The pilot spawns on its perch and musters there on every later respawn.
    const padIdx = freePad()
    const pad = pads[padIdx]
    const benched = bench.get(key)
    if (benched) {
      bench.delete(key)
      const combatant: Combatant = {
        ship: benched.ship,
        input: inputFromSnapshot(input),
        name: displayName,
        score: benched.score,
        deaths: benched.deaths,
        spawn: padPerch(padIdx), // future respawns muster at the fresh home pad
      }
      const troops = benched.ship.troops
      sim.addCombatant(combatant, { respawnIn: benched.respawnIn })
      // Reassigned AFTER addCombatant: seating refills the bay per mode, which would clobber the
      // bay the pilot disconnected with. Load-bearing only for an ALIVE reclaim — a seat still
      // mid-respawn re-enters through the normal dequeue, which re-kits the ship like any respawn.
      benched.ship.troops = troops
      benched.ship.invuln = Math.max(benched.ship.invuln, 1) // re-entry grace
      // A returning pilot gets a fresh barracks — its old one stood down (and any capture progress
      // reset) the moment it disconnected. The reclaimed ship resumes wherever it dropped; it flies
      // home to reload and defend.
      sim.addBase(benched.ship.id, pad)
      padOf.set(benched.ship.id, padIdx)
      // Same seat, same color — unless that slot was stolen out from under this bench while it
      // slept (all-8-held steal). Restoring a slot a LIVE seat now holds would put two live
      // players in one color; in that (rare) case take the lowest free slot instead.
      const live = new Set(palettes.values())
      palettes.set(benched.ship.id, live.has(benched.palette) ? freeSlot() : benched.palette)
      members.set(benched.ship.id, { shipId: benched.ship.id, name: displayName, input })
      return { shipId: benched.ship.id, reclaimed: true }
    }
    const shipId = nextId++
    const spawn = padPerch(padIdx)
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
    sim.addBase(shipId, pad)
    padOf.set(shipId, padIdx)
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
        // A disconnect is NOT elimination: this pilot keeps counting toward the match (so a 2-player
        // blip can't hand the survivor an instant walkover) until the grace window lapses unreclaimed.
        forfeitAt: world.time + NET_DISCONNECT_GRACE,
      })
    }
    sim.removeCombatant(shipId, true) // benched, not gone — the pilot's troopers keep fighting
    sim.removeBase(shipId) // the fort stands down with its pilot (capture progress resets), freeing its pad
    padOf.delete(shipId)
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
      eliminated: eliminated.has(c.ship.id),
    })),
    ...[...bench.values()].map((seat) => ({
      id: seat.ship.id,
      name: seat.name,
      score: seat.score,
      palette: seat.palette,
      respawnIn: 0,
      connected: false,
      eliminated: eliminatedNames.has(pilotNameKey(seat.name)),
    })),
  ]

  // Advance the sim a tick, then fold this frame's eliminations into the match verdict. A pilot
  // out of bases dying is removed by the sim (eliminated event); once two+ have contended, the
  // moment a single one is left the match latches decided with that lone survivor as the winner
  // (undefined if the field emptied the same tick — a draw). Latching means a late seat or a
  // wandering spectator can't reopen it.
  // Pilots still in the match: live seats not eliminated, PLUS benched (disconnected) seats that
  // haven't been eliminated and are still inside their reclaim grace window. Counting the benched is
  // the crux of the disconnect fix — a transient drop in a 2-player fight must NOT collapse the win
  // condition and lock the dropped pilot out (its name would then be refused on reclaim); only a real
  // elimination or a lapsed grace removes a contender.
  const contenders = (): { liveIds: number[]; benched: number } => ({
    liveIds: [...members.keys()].filter((id) => !eliminated.has(id)),
    benched: [...bench.values()].filter((s) => !eliminatedNames.has(pilotNameKey(s.name)) && world.time < s.forfeitAt)
      .length,
  })

  const step = (dt: number): DeathEvent[] => {
    // Engagement arms from the pre-casualty contender count, so a duel that resolves the very tick it
    // became one (both present, one falls) still decides instead of leaving the match open.
    {
      const { liveIds, benched } = contenders()
      if (liveIds.length + benched >= 2) engaged = true
    }
    const events = sim.step(dt)
    for (const event of events) {
      if (!event.eliminated) continue
      eliminated.add(event.victimId)
      const seat = members.get(event.victimId)
      if (seat) eliminatedNames.add(pilotNameKey(seat.name))
    }
    const { liveIds, benched } = contenders()
    if (!matchOver && engaged && liveIds.length + benched <= 1) {
      matchOver = true
      // The lone survivor wins; undefined (mutual elimination / only a fading benched seat) is a draw.
      winnerId = liveIds[0]
    }
    return events
  }

  const snapshot = (events: DeathEvent[]): ServerMessage => ({
    t: MsgType.SNAPSHOT,
    // A full World minus the rng closure (JSON.stringify drops it anyway) and the high-churn
    // `particles` trail buffer (the client regenerates engine trails / smoke / wreck explosions
    // locally). The discrete FX bursts the sim spawned THIS tick DO cross — as the compact
    // `world.fx` triggers (a handful of {x,y,color,count} per tick) — so trooper blood, base
    // sparks and weapon detonations replay client-side without the particle data on the wire.
    world: { ...sim.world, particles: [] },
    players: players(),
    events,
    // The match verdict rides every snapshot so clients show VICTORY / ELIMINATED terminals.
    matchOver,
    winnerId,
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
    step,
    snapshot,
    persisted,
    players,
    playerCount: () => members.size,
    isEmpty: () => members.size === 0,
    isOver: () => matchOver,
  }
}
