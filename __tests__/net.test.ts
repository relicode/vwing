import { describe, expect, test } from 'bun:test'
import type { RedisClient } from 'bun'

import {
  Color,
  DeviceKind,
  NET_MAX_PLAYERS,
  NET_PERSIST_MAX_DEVICES,
  PLAYER_PALETTE,
  RESPAWN_DELAY_BASE,
  SHIP_MAX_HEALTH,
  StructureType,
} from '$/game/constants'
import type { Device } from '$/game/types'
import { decodeClient, gameNameKey, MsgType, pilotNameKey, sanitizeGameName } from '$/net/protocol'
import { startServer } from '$/server/index'
import { createLog } from '$/server/log'
import { parsePersisted } from '$/server/restore'
import { createRoom, JoinRefusal, type JoinResult, parseRestore, type Room } from '$/server/room'
import { createRedisStore, createStore, STATE_TTL } from '$/server/store'

// Unwrap a join that the test expects to succeed (a refusal is a test failure, not a branch).
const seat = (result: JoinResult): { shipId: number; reclaimed: boolean } => {
  if ('refusal' in result) throw new Error(`join refused: ${result.refusal}`)
  return result
}

// A minimal deployed trooper for ownership/persistence tests.
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
  wade: 0,
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
  storming: false,
  slide: 0,
  burning: 0,
  stun: 0,
  fallen: 0,
})

// Down a seated ship this frame (an unseated owner id, so no killer bookkeeping interferes).
const downShip = (room: Room, shipId: number): void => {
  const combatant = room.sim.getCombatant(shipId)
  if (!combatant) throw new Error(`no combatant #${shipId}`)
  combatant.ship.invuln = 0
  combatant.ship.health = 5
  room.sim.world.bullets.push({
    x: combatant.ship.x,
    y: combatant.ship.y,
    vx: 0,
    vy: 0,
    radius: 6,
    life: 1,
    owner: 999,
    damage: 200,
  })
  room.step(1 / 30)
}

describe('protocol helpers', () => {
  test('sanitizeGameName keeps a readable slug and caps the length', () => {
    expect(sanitizeGameName('  Hello World  ', 24)).toBe('Hello World')
    expect(sanitizeGameName('drop/these*chars!', 24)).toBe('dropthesechars')
    expect(sanitizeGameName('way too long a name for the cap', 8)).toHaveLength(8)
    expect(sanitizeGameName('   ', 24)).toBe('')
  })
})

describe('gameNameKey (internationally-normalized, case-insensitive game identity)', () => {
  test('folds letter case', () => {
    expect(gameNameKey('Arena')).toBe(gameNameKey('arena'))
    expect(gameNameKey('MY GAME')).toBe(gameNameKey('my game'))
  })

  test('collapses Unicode normalization forms (precomposed vs combining)', () => {
    const nfc = 'Café'.normalize('NFC') // "Café" — é as one code point (U+00E9)
    const nfd = 'Café'.normalize('NFD') // "Cafe" + U+0301 combining acute accent
    expect(nfc).not.toBe(nfd) // genuinely different code-point sequences…
    expect(gameNameKey(nfc)).toBe(gameNameKey(nfd)) // …but the same game
  })

  test('collapses compatibility forms via NFKC (fullwidth, ligatures)', () => {
    expect(gameNameKey('ＡＲＥＮＡ')).toBe(gameNameKey('arena')) // fullwidth → ASCII
    expect(gameNameKey('ﬁght')).toBe(gameNameKey('fight')) // ﬁ ligature → "fi"
  })

  test('keeps genuinely different names distinct (diacritics are not stripped)', () => {
    expect(gameNameKey('alpha')).not.toBe(gameNameKey('beta'))
    expect(gameNameKey('café')).not.toBe(gameNameKey('cafe'))
  })
})

describe('sanitizeGameName (international names)', () => {
  test('keeps Unicode letters and normalizes to NFC', () => {
    expect(sanitizeGameName('Café Münch', 24)).toBe('Café Münch'.normalize('NFC'))
    expect(sanitizeGameName('アリーナ', 24)).toBe('アリーナ')
    expect(sanitizeGameName('Café', 24)).toBe('Café'.normalize('NFC')) // NFD input → NFC
  })

  test('still strips punctuation, symbols and control characters', () => {
    expect(sanitizeGameName('drop/these*chars!', 24)).toBe('dropthesechars')
    expect(sanitizeGameName('emoji 🎮 game', 24)).toBe('emoji game') // emoji dropped, spaces collapse
  })
})

describe('store (in-memory fallback)', () => {
  test('persists state and the lobby listing without a Redis server', async () => {
    const store = await createStore('redis://127.0.0.1:1') // nothing listens here → memory fallback
    expect(store.kind).toBe('memory')

    await store.saveState('arena', '{"t":"SNAPSHOT"}')
    expect(await store.loadState('arena')).toBe('{"t":"SNAPSHOT"}')

    // keyed by the canonical 'arena'; the lobby shows the host's display spelling 'Arena'
    await store.registerGame('arena', { name: 'Arena', players: 2, maxPlayers: 8 })
    expect(await store.listGames()).toEqual([{ name: 'Arena', players: 2, maxPlayers: 8 }])

    await store.unregisterGame('arena')
    expect(await store.listGames()).toEqual([])

    await store.deleteState('arena')
    expect(await store.loadState('arena')).toBeUndefined()
    await store.close()
  })
})

describe('decodeClient (hostile-input hardening)', () => {
  const good = JSON.stringify({
    t: MsgType.INPUT,
    input: { turn: 1, thrusting: true, reversing: false, firing: false, altFiring: false, deploying: false },
  })

  test('accepts a well-formed INPUT message', () => {
    expect(decodeClient(good)?.input).toEqual({
      turn: 1,
      thrusting: true,
      reversing: false,
      firing: false,
      altFiring: false,
      deploying: false,
    })
  })

  test('rejects malformed payloads that would crash the server (regression for the INPUT DoS)', () => {
    expect(decodeClient('{"t":"INPUT"}')).toBeUndefined() // correct tag, missing input → must not pass
    expect(decodeClient('{"t":"INPUT","input":null}')).toBeUndefined()
    expect(decodeClient('{"t":"INPUT","input":"nope"}')).toBeUndefined()
    expect(decodeClient('{"t":"WELCOME"}')).toBeUndefined() // not a client message
    expect(decodeClient('not json at all')).toBeUndefined()
  })
})

describe('message kinds', () => {
  test('the input/welcome/snapshot/rejected discriminants exist', () => {
    expect(MsgType.INPUT).toBe('INPUT' as MsgType)
    expect(MsgType.WELCOME).toBe('WELCOME' as MsgType)
    expect(MsgType.SNAPSHOT).toBe('SNAPSHOT' as MsgType)
    expect(MsgType.REJECTED).toBe('REJECTED' as MsgType)
  })
})

describe('room persistence (carved terrain survives a restart)', () => {
  test('persisted() → parseRestore → createRoom resurrects the same arena, craters included', () => {
    const room = createRoom('Crater Lake')
    const world = room.sim.world
    // Carve: park a bullet inside the first destructible block and let the sim resolve the hit.
    const target = world.blocks.find((b) => b.structure === StructureType.EARTH)
    expect(target).toBeDefined()
    if (!target) return
    world.bullets.push({
      x: target.x + target.w / 2,
      y: target.y + 1,
      vx: 0,
      vy: 0,
      radius: 6,
      life: 1,
      owner: 0,
      damage: 22,
    })
    const versionBefore = world.terrainVersion
    room.step(1 / 30)
    expect(world.terrainVersion).toBeGreaterThan(versionBefore) // the crater landed

    const restore = parseRestore(room.persisted())
    expect(restore).toBeDefined()
    const twin = createRoom('Crater Lake', restore)
    expect(JSON.stringify(twin.sim.world.blocks)).toBe(JSON.stringify(world.blocks))
    expect(JSON.stringify(twin.sim.world.water)).toBe(JSON.stringify(world.water))
  })

  test('a corrupt or foreign persisted blob is rejected (a fresh room, never a crash)', () => {
    expect(parseRestore('{not json')).toBeUndefined()
    expect(parseRestore('{"seed":"nope"}')).toBeUndefined()
    expect(parseRestore('null')).toBeUndefined()
  })
})

describe('room bench (disconnect → same-name reclaim, no auth)', () => {
  test('a benched seat is reclaimed by any casing of the name — ship, score, deaths, and bay intact', () => {
    const room = createRoom('Bench')
    const a = seat(room.join('Maverick'))
    expect(a.reclaimed).toBe(false)
    const combatant = room.sim.getCombatant(a.shipId)
    expect(combatant).toBeDefined()
    if (!combatant) return
    combatant.score = 7
    combatant.deaths = 2
    combatant.ship.troops = 3 // a part-spent bay (a fresh DEATHMATCH seat starts full)
    combatant.ship.x = 4321

    room.leave(a.shipId)
    expect(room.playerCount()).toBe(0)
    expect(room.players()).toContainEqual({
      id: a.shipId,
      name: 'Maverick',
      score: 7,
      palette: 0,
      respawnIn: 0,
      connected: false,
    })

    const back = seat(room.join('MAVERICK')) // identity is the NFKC casefold, not the spelling
    expect(back).toEqual({ shipId: a.shipId, reclaimed: true })
    const reclaimed = room.sim.getCombatant(a.shipId)
    expect(reclaimed?.score).toBe(7)
    expect(reclaimed?.deaths).toBe(2)
    expect(reclaimed?.ship.troops).toBe(3) // seating must NOT refill the bay it disconnected with
    expect(reclaimed?.ship.x).toBe(4321)
    expect(reclaimed?.ship.invuln).toBeGreaterThanOrEqual(1) // re-entry grace
  })

  test('a live duplicate pilot name is refused; a fresh name gets the next monotonic seat', () => {
    const room = createRoom('Bench2')
    const a = seat(room.join('Ace'))
    expect(room.join('ace')).toEqual({ refusal: JoinRefusal.NAME_TAKEN })
    expect(pilotNameKey('Ace')).toBe(pilotNameKey('ace'))
    const b = seat(room.join('Bandit'))
    expect(b.shipId).toBe(a.shipId + 1)
  })

  test('benching leaves the pilot’s troopers fighting on', () => {
    const room = createRoom('Bench3')
    const a = seat(room.join('Hollywood'))
    const man = trooperOf(a.shipId)
    room.sim.world.devices.push(man)
    room.leave(a.shipId)
    expect(room.sim.world.devices).toContain(man) // the minion war doesn't pause for a dropped socket
  })

  test('a seat benched mid-respawn waits out its remaining clock after reclaim', () => {
    const room = createRoom('Bench4')
    const a = seat(room.join('Goose'))
    downShip(room, a.shipId)
    expect(room.sim.respawnIn(a.shipId)).toBeGreaterThan(0)
    room.leave(a.shipId)

    const back = seat(room.join('goose'))
    expect(back.reclaimed).toBe(true)
    expect(room.sim.world.ships.some((s) => s.id === a.shipId)).toBe(false) // still waiting
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 0.3) * 30); i += 1) room.step(1 / 30)
    expect(room.sim.world.ships.some((s) => s.id === a.shipId)).toBe(true) // the clock ran out normally
  })
})

describe('full-session persistence (Redis is the source of state)', () => {
  test('persisted → parsePersisted → createRoom resurrects seats, devices, and the clock; reclaim restores the seat', () => {
    const room = createRoom('Resurrect')
    const a = seat(room.join('Maverick'))
    const b = seat(room.join('Goose'))
    const combatant = room.sim.getCombatant(a.shipId)
    if (!combatant) return
    combatant.score = 3
    combatant.deaths = 1
    combatant.ship.troops = 2
    room.sim.world.devices.push(trooperOf(a.shipId))
    for (let i = 0; i < 10; i += 1) room.step(1 / 30)

    const parsed = parsePersisted(room.persisted())
    expect(parsed).toBeDefined()
    if (!parsed) return
    expect(parsed.degraded).toEqual([]) // a clean self-written blob degrades nothing

    const twin = createRoom('Resurrect', parsed.restore)
    expect(twin.sim.world.time).toBeCloseTo(room.sim.world.time, 5)
    expect(twin.sim.world.devices.filter((d) => d.kind === DeviceKind.INFANTRY)).toHaveLength(1)
    expect(twin.playerCount()).toBe(0) // nobody reconnected yet…
    expect(twin.players().filter((p) => !p.connected)).toHaveLength(2) // …both seats benched, greyed

    const back = seat(twin.join('maverick'))
    expect(back).toEqual({ shipId: a.shipId, reclaimed: true })
    const reclaimed = twin.sim.getCombatant(a.shipId)
    expect(reclaimed?.score).toBe(3)
    expect(reclaimed?.deaths).toBe(1)
    expect(reclaimed?.ship.troops).toBe(2)

    const fresh = seat(twin.join('Iceman'))
    expect(fresh.shipId).toBeGreaterThan(Math.max(a.shipId, b.shipId)) // the id cursor cleared the roster
  })

  test('a seat persisted mid-respawn restores its RELATIVE clock', () => {
    const room = createRoom('Clock')
    const a = seat(room.join('Viper'))
    downShip(room, a.shipId)
    const remaining = room.sim.respawnIn(a.shipId)
    expect(remaining).toBeGreaterThan(0)

    const parsed = parsePersisted(room.persisted())
    const twin = createRoom('Clock', parsed?.restore)
    const back = seat(twin.join('viper'))
    expect(back.reclaimed).toBe(true)
    expect(twin.sim.world.ships.some((s) => s.id === a.shipId)).toBe(false)
    expect(twin.sim.respawnIn(a.shipId)).toBeCloseTo(remaining, 1)
    for (let i = 0; i < Math.ceil((remaining + 0.3) * 30); i += 1) twin.step(1 / 30)
    expect(twin.sim.world.ships.some((s) => s.id === a.shipId)).toBe(true)
  })
})

describe('parsePersisted (hostile/corrupt/stale blobs degrade per section, never throw)', () => {
  // A real, current-format document to mutate per case.
  const freshDoc = (): { doc: string; shipId: number } => {
    const room = createRoom('Hostile')
    const a = seat(room.join('Maverick'))
    seat(room.join('Goose'))
    room.sim.world.devices.push(trooperOf(a.shipId))
    room.step(1 / 30)
    return { doc: room.persisted(), shipId: a.shipId }
  }

  test('a legacy (pre-versioned) blob restores the arena only — seed + terrain, water re-seeds', () => {
    const legacy = JSON.stringify({
      seed: 9,
      world: { water: [{ x: 0, y: 100, w: 50, h: 20 }] },
      terrain: { cols: 1, rows: 1, mat: '', pinned: [], bodies: [], regrow: [] },
    })
    const parsed = parsePersisted(legacy)
    expect(parsed).toBeDefined()
    expect(parsed?.degraded).toContain('version')
    expect(parsed?.restore.terrain).toBeDefined() // the carved grid still overlays
    expect(parsed?.restore).not.toHaveProperty('water') // water is no longer hydrated — it re-seeds from the seed
    expect(parsed?.restore.roster).toBeUndefined()
    expect(parsed?.restore.devices).toBeUndefined()
  })

  test('a FUTURE version degrades the same way (never seats unknown shapes)', () => {
    const { doc } = freshDoc()
    const raw = JSON.parse(doc)
    raw.v = 99
    const parsed = parsePersisted(JSON.stringify(raw))
    expect(parsed?.degraded).toContain('version')
    expect(parsed?.restore.roster).toBeUndefined()
  })

  test('a blob older than STATE_TTL keeps the arena but drops the session (roster + devices)', () => {
    const { doc } = freshDoc()
    const savedAt = (JSON.parse(doc) as { savedAt: number }).savedAt
    const parsed = parsePersisted(doc, savedAt + STATE_TTL * 1000 + 1)
    expect(parsed?.degraded).toContain('stale')
    expect(parsed?.restore.terrain).toBeDefined()
    expect(parsed?.restore.roster).toBeUndefined()
    expect(parsed?.restore.devices).toBeUndefined()
  })

  test('poisoned rows are dropped individually; sane neighbours survive with clamped fields', () => {
    const { doc } = freshDoc()
    const raw = JSON.parse(doc)
    raw.roster[0].ship.x = null // NaN/null coordinates: this row must go
    raw.roster[1].ship.health = 1e9 // absurd hull: clamped, row kept
    raw.roster.push({ ...raw.roster[1], name: 'Dupe' }) // duplicate id: dropped
    raw.devices.push({ kind: 'NUKE', x: 1, y: 1, owner: 0 }) // unknown kind: dropped
    const parsed = parsePersisted(JSON.stringify(raw))
    expect(parsed?.degraded).toEqual(expect.arrayContaining(['devices', 'roster']))
    expect(parsed?.restore.roster).toHaveLength(1)
    expect(parsed?.restore.roster?.[0].ship.health).toBe(SHIP_MAX_HEALTH)
    expect(parsed?.restore.devices?.every((d) => d.kind !== ('NUKE' as DeviceKind))).toBe(true)
  })

  test('a device carrying only the position/owner fields is dropped (no NaN-poisoned sim)', () => {
    const { doc } = freshDoc()
    const raw = JSON.parse(doc)
    // A MISSILE and an INFANTRY with the position/owner present but every kind-specific numeric
    // field (vx/vy/speed/turnRate, swim/chute/…) missing — admitting either makes device.x NaN
    // on the first tick and rides every snapshot to every client.
    raw.devices = [
      { kind: DeviceKind.MISSILE, x: 500, y: 400, owner: 0 },
      { kind: DeviceKind.INFANTRY, x: 600, y: 400, owner: 0 },
    ]
    const parsed = parsePersisted(JSON.stringify(raw))
    expect(parsed?.restore.devices).toHaveLength(0)
    expect(parsed?.degraded).toContain('devices')

    // And the restore must step cleanly — no NaN leaks into the live device array.
    const twin = createRoom('Hostile', parsed?.restore)
    for (let i = 0; i < 5; i += 1) twin.step(1 / 30)
    expect(twin.sim.world.devices.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))).toBe(true)
  })

  test('a roster ship missing numeric fields (or shaped as an array) is dropped, not seated as NaN', () => {
    const { doc } = freshDoc()
    const raw = JSON.parse(doc)
    // Row 0: a ship object with only x/y/health — no vx/angle/radius/… → would NaN-poison updateShip.
    raw.roster[0].ship = { x: 500, y: 400, health: 100 }
    // Row 1: ship shaped as an array (typeof 'object', but no fields) — must also drop.
    raw.roster[1].ship = [1, 2, 3]
    const parsed = parsePersisted(JSON.stringify(raw))
    expect(parsed?.restore.roster).toHaveLength(0)
    expect(parsed?.degraded).toContain('roster')

    const twin = createRoom('Hostile', parsed?.restore)
    const back = twin.join('Maverick')
    if ('refusal' in back) throw new Error('expected a fresh seat')
    expect(back.reclaimed).toBe(false) // nothing to reclaim — the poisoned seat was dropped
    for (let i = 0; i < 5; i += 1) twin.step(1 / 30)
    expect(twin.sim.world.ships.every((s) => Number.isFinite(s.x) && Number.isFinite(s.vx))).toBe(true)
  })

  test('the device list is capped (a hostile blob cannot seed an unbounded army)', () => {
    const { doc, shipId } = freshDoc()
    const raw = JSON.parse(doc)
    raw.devices = Array.from({ length: NET_PERSIST_MAX_DEVICES + 88 }, () => trooperOf(shipId))
    const parsed = parsePersisted(JSON.stringify(raw))
    expect(parsed?.restore.devices).toHaveLength(NET_PERSIST_MAX_DEVICES)
    expect(parsed?.degraded).toContain('devices')
  })
})

describe('PLAYER_PALETTE (distinct seat colors)', () => {
  test('one valid, pairwise-distinct hex per seat, clear of the FX hues it could be confused with', () => {
    expect(PLAYER_PALETTE).toHaveLength(NET_MAX_PLAYERS)
    expect(new Set(PLAYER_PALETTE).size).toBe(PLAYER_PALETTE.length)
    for (const hex of PLAYER_PALETTE) {
      expect(Number.isInteger(hex)).toBe(true)
      expect(hex).toBeGreaterThanOrEqual(0)
      expect(hex).toBeLessThanOrEqual(0xffffff)
    }
    // Slots 0/1 ARE the legacy hues by design (a 1v1 looks like it always has)…
    expect(PLAYER_PALETTE[0]).toBe(Color.SHIP)
    expect(PLAYER_PALETTE[1]).toBe(Color.ENEMY)
    // …and no slot collides with an FX/terrain hue a player would misread.
    const reserved = [
      Color.EXPLOSION,
      Color.BULLET_ENEMY,
      Color.THRUST,
      Color.WATER_EDGE,
      Color.FIRE_EDGE,
      Color.GRASS_EDGE,
    ]
    for (const hex of PLAYER_PALETTE) expect(reserved).not.toContain(hex)
  })
})

describe('palette slots (server-assigned seat colors)', () => {
  const slotOf = (room: Room, id: number): number | undefined => room.players().find((p) => p.id === id)?.palette

  test('fresh joins take the lowest free slots; a benched seat keeps its slot through leave + rejoin', () => {
    const room = createRoom('Hue')
    const a = seat(room.join('A'))
    const b = seat(room.join('B'))
    const c = seat(room.join('C'))
    expect([slotOf(room, a.shipId), slotOf(room, b.shipId), slotOf(room, c.shipId)]).toEqual([0, 1, 2])
    room.leave(b.shipId)
    const d = seat(room.join('D'))
    expect(slotOf(room, d.shipId)).toBe(3) // B's bench still holds slot 1 — no recolor on a blip
    const back = seat(room.join('b'))
    expect(back.shipId).toBe(b.shipId)
    expect(slotOf(room, back.shipId)).toBe(1) // the reclaimed seat kept its color
  })

  test('with every slot held, a fresh join steals the OLDEST benched slot — live seats stay distinct', () => {
    const room = createRoom('Hue2')
    const ids = Array.from({ length: NET_MAX_PLAYERS }, (_, i) => seat(room.join(`P${i}`)).shipId)
    expect(room.join('Q')).toEqual({ refusal: JoinRefusal.FULL })
    room.leave(ids[0]) // slot 0 rides P0's bench; all 8 slots stay held
    const q = seat(room.join('Q'))
    expect(slotOf(room, q.shipId)).toBe(0) // stolen from the only (oldest) benched seat
    const live = room
      .players()
      .filter((p) => p.connected)
      .map((p) => p.palette)
    expect(new Set(live).size).toBe(live.length) // live players never share a color
  })

  test('a reclaim whose slot was stolen while benched is reassigned, never duplicating a live color', () => {
    const room = createRoom('Hue4')
    const ids = Array.from({ length: NET_MAX_PLAYERS }, (_, i) => seat(room.join(`P${i}`)).shipId)
    room.leave(ids[0]) // slot 0 rides P0's bench
    const q = seat(room.join('Q')) // …and is stolen — Q is now live on slot 0
    expect(slotOf(room, q.shipId)).toBe(0)
    room.leave(ids[1]) // free a live seat (slot 1) so P0's reclaim isn't refused FULL
    const back = seat(room.join('P0')) // P0 returns to find its old slot taken
    expect(back.reclaimed).toBe(true)
    const live = room
      .players()
      .filter((p) => p.connected)
      .map((p) => p.palette)
    expect(new Set(live).size).toBe(live.length) // two live pilots must never share a color
    expect(slotOf(room, back.shipId)).not.toBe(slotOf(room, q.shipId))
  })

  test('the slot survives persist → restore → reclaim; an out-of-range persisted slot is reassigned', () => {
    const room = createRoom('Hue3')
    seat(room.join('A')) // A must be a seated pilot so it can reclaim slot 0 after the restart
    const b = seat(room.join('B'))
    room.step(1 / 30)
    const raw = JSON.parse(room.persisted())
    const rowB = raw.roster.find((s: { id: number }) => s.id === b.shipId)
    rowB.palette = 99 // a poisoned slot must not render PLAYER_PALETTE[-ish] garbage
    const twin = createRoom('Hue3', parsePersisted(JSON.stringify(raw))?.restore)
    const backA = seat(twin.join('a'))
    expect(slotOf(twin, backA.shipId)).toBe(0) // A kept its slot across the restart
    const backB = seat(twin.join('b'))
    expect(slotOf(twin, backB.shipId)).toBe(1) // B was reassigned the lowest free, not 99
  })
})

describe('players() respawn clock on the wire', () => {
  test('respawnIn counts a downed seat to re-entry; flying and benched rows carry 0', () => {
    const room = createRoom('Clock2')
    const a = seat(room.join('Viper'))
    const b = seat(room.join('Jester'))
    expect(room.players().every((p) => p.respawnIn === 0)).toBe(true)
    downShip(room, a.shipId)
    const downed = room.players().find((p) => p.id === a.shipId)?.respawnIn ?? 0
    expect(downed).toBeGreaterThan(0)
    for (let i = 0; i < 30; i += 1) room.step(1 / 30)
    expect(room.players().find((p) => p.id === a.shipId)?.respawnIn).toBeLessThan(downed) // counting down
    room.leave(b.shipId)
    expect(room.players().find((p) => p.id === b.shipId)?.respawnIn).toBe(0) // benched rows carry 0
    for (let i = 0; i < Math.ceil((RESPAWN_DELAY_BASE + 1) * 30); i += 1) room.step(1 / 30)
    expect(room.players().find((p) => p.id === a.shipId)?.respawnIn).toBe(0) // flying again
  })
})

describe('store outage → recovery (one transition line each)', () => {
  test('a flaky Redis client logs exactly one loss and one recovery', async () => {
    const lines: string[] = []
    let failures = 2
    const fake = {
      set: async () => {
        if (failures > 0) {
          failures -= 1
          throw new Error('boom')
        }
        return 'OK'
      },
      close: () => {},
    } as unknown as RedisClient
    const store = createRedisStore(fake, createLog('store', { sink: (_level, line) => void lines.push(line) }))
    await store.saveState('a', '{}') // fail → the one loss line
    await store.saveState('a', '{}') // fail again → suppressed
    await store.saveState('a', '{}') // success → the one recovery line
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Redis lost')
    expect(lines[1]).toContain('Redis restored')
  })
})

describe('graceful shutdown (stop() checkpoints live rooms)', () => {
  test('a room with a live pilot is persisted before the server stops, restorable seat included', async () => {
    const store = await createStore('redis://127.0.0.1:1') // nothing listens → memory fallback
    const { server, stop } = startServer(store, { port: 0 })
    const ws = new WebSocket(`ws://localhost:${server.port}/ws?intent=HOST&game=Shutdown%20Test&name=Ace`)
    const welcome = await new Promise<{ t: string; reclaimed?: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no WELCOME inside 2s')), 2000)
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { t: string; reclaimed?: boolean }
        if (message.t === MsgType.WELCOME) {
          clearTimeout(timer)
          resolve(message)
        }
      }
      ws.onerror = () => reject(new Error('socket error'))
    })
    expect(welcome.reclaimed).toBe(false)

    await stop()
    const json = await store.loadState(gameNameKey('Shutdown Test'))
    expect(json).toBeDefined()
    const parsed = json === undefined ? undefined : parsePersisted(json)
    expect(parsed?.restore.roster?.some((s) => s.name === 'Ace')).toBe(true)
  })
})
