import {
  DeviceKind,
  NET_BENCH_MAX,
  NET_GAME_NAME_MAX,
  NET_MAX_PLAYERS,
  NET_PERSIST_MAX_DEVICES,
  SHIP_MAX_HEALTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp } from '$/game/math'
import type { Device, Ship, WaterBody } from '$/game/types'
import type { VoxelSnapshot } from '$/game/voxel'
import { pilotNameKey } from '$/net/protocol'
import { STATE_TTL } from '$/server/store'

// Versioning + validation for the room state document that crosses the Redis boundary. The
// writer is room.persisted(); this is the only reader. Everything coming back is treated as
// hostile until proven finite: a corrupt, stale, or foreign blob must never throw, never seat a
// ship at NaN, and never take down room creation — it degrades per SECTION (and per ROW inside a
// section), and the caller learns which sections were dropped so the resume log can say so.
//
// Bump PERSIST_VERSION whenever the Ship/Device shapes change: a version mismatch degrades the
// blob to the legacy arena-only restore (seed + terrain + water) instead of seating stale shapes.
export const PERSIST_VERSION = 3

// One roster row: a seat as it stood at save time — live, benched, or mid-respawn alike. The
// ship object rides whole (mid-respawn ships are NOT in world.ships; the seat owns them), and
// the attrition clock is RELATIVE seconds so it is robust against world.time handling.
export type PersistedSeat = {
  id: number
  name: string
  score: number
  deaths: number
  respawnIn: number
  palette?: number // PLAYER_PALETTE slot; absent/invalid → the room reassigns the lowest free
  ship: Ship
}

// Everything a room needs to resurrect: the seed reproduces the authored arena, and the rest
// overlays what the seed can't know. Only `seed` is mandatory — every other section degrades.
export type RoomRestore = {
  seed: number
  terrain?: VoxelSnapshot
  water?: WaterBody[]
  time?: number
  nextId?: number
  devices?: Device[]
  roster?: PersistedSeat[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Every numeric field the sim reads off a device, per kind. A persisted device that is missing
// (or non-finite in) any of these would NaN-poison updateDevices the first tick after restore —
// `device.x += device.vx * dt` with `vx === undefined` makes `x` NaN forever, and the broken
// device then rides every snapshot to every client. So a row is admitted only when ALL of its
// kind's numeric fields are finite (booleans/optional-enum fields like `guard`/`heavy` aren't
// gating — the sim tolerates their absence; required booleans added after a blob was written —
// `running`, `storming` — stay undefined on its restored rows for the room's life, so every
// reader must treat them as falsy). `wade` is deliberately NOT gated either: stepDevice rewrites it
// from scratch every tick (`device.wade = 0` before any read), so a blob missing it self-heals on
// the first step and never NaN-poisons — no version bump needed (same as `running`/`storming`).
// Keep this in lockstep with the Device union in types.ts; PERSIST_VERSION must bump if a kind's
// required numeric surface changes in a way the sim does NOT self-heal.
const DEVICE_NUMERIC_FIELDS: Record<DeviceKind, readonly string[]> = {
  [DeviceKind.MISSILE]: [
    'x',
    'y',
    'vx',
    'vy',
    'life',
    'owner',
    'radius',
    'turnRate',
    'speed',
    'damage',
    'blastRadius',
    'blastDamage',
    'disableTime',
    'shieldDrain',
    'color',
  ],
  [DeviceKind.MINE]: ['x', 'y', 'owner', 'radius', 'armTime', 'life', 'triggerRadius', 'blastRadius', 'damage'],
  [DeviceKind.INFANTRY]: [
    'x',
    'y',
    'vx',
    'vy',
    'owner',
    'radius',
    'swim',
    'sinking',
    'chute',
    'pickupLock',
    'walkDir',
    'facing',
    'groundLeft',
    'groundRight',
    'fireCooldown',
    'kneel',
    'slide',
    'burning',
    'stun',
    'fallen',
  ],
  [DeviceKind.GRENADE]: ['x', 'y', 'vx', 'vy', 'owner', 'radius', 'fuse'],
  [DeviceKind.FLAK]: ['x', 'y', 'vx', 'vy', 'owner', 'radius', 'fuse'],
  [DeviceKind.WELL]: ['x', 'y', 'owner', 'radius', 'life', 'strength', 'pullRadius'],
}

// Every numeric field the sim/renderer reads off a ship. A reclaimed seat whose ship is missing
// any of these poisons updateShip the same way (a ship with no `vx`/`angle`/`radius` goes to NaN
// and breaks collision, camera, and render for the whole room) — so the row is dropped, not seated.
const SHIP_NUMERIC_FIELDS: readonly (keyof Ship)[] = [
  'x',
  'y',
  'vx',
  'vy',
  'angle',
  'radius',
  'fireCooldown',
  'invuln',
  'health',
  'shields',
  'charge',
  'altCooldown',
  'disabled',
  'troops',
  'deployCooldown',
]

const allFinite = (obj: Record<string, unknown>, fields: readonly string[]): boolean =>
  fields.every((field) => finite(obj[field]))

const validWater = (raw: unknown): WaterBody[] | undefined => {
  if (!Array.isArray(raw)) return undefined
  const bodies = raw.filter(
    (b): b is WaterBody =>
      b !== null && typeof b === 'object' && finite(b.x) && finite(b.y) && finite(b.w) && finite(b.h)
  )
  return bodies.length === raw.length ? bodies : undefined
}

// Row-validate the device list: unknown kinds and rows missing any of their kind's numeric
// fields are dropped individually (a partial device NaN-poisons the sim — see the field table
// above); the list is capped so a hostile blob can't seed an unbounded device array.
const validDevice = (d: unknown): d is Device => {
  if (d === null || typeof d !== 'object') return false
  const kind = (d as { kind?: unknown }).kind
  if (typeof kind !== 'string' || !(kind in DEVICE_NUMERIC_FIELDS)) return false
  return allFinite(d as Record<string, unknown>, DEVICE_NUMERIC_FIELDS[kind as DeviceKind])
}

const validDevices = (raw: unknown): { devices: Device[]; dropped: boolean } | undefined => {
  if (!Array.isArray(raw)) return undefined
  const rows = raw.slice(0, NET_PERSIST_MAX_DEVICES)
  const devices = rows.filter(validDevice)
  return { devices, dropped: devices.length !== raw.length }
}

// Row-validate a roster seat: finite ids/scores/clocks, a usable name, and a ship whose
// position/hull are clamped back into the world. Duplicate ids or pilot keys drop the row
// (the bench is keyed by pilot name).
const validSeat = (raw: unknown, seenIds: Set<number>, seenKeys: Set<string>): PersistedSeat | undefined => {
  if (raw === null || typeof raw !== 'object') return undefined
  const seat = raw as Partial<PersistedSeat>
  if (!finite(seat.id) || seat.id < 0 || !Number.isInteger(seat.id) || seenIds.has(seat.id)) return undefined
  if (typeof seat.name !== 'string' || seat.name.trim() === '') return undefined
  const name = seat.name.slice(0, NET_GAME_NAME_MAX)
  const key = pilotNameKey(name)
  if (seenKeys.has(key)) return undefined
  if (!finite(seat.score) || !finite(seat.deaths) || !finite(seat.respawnIn)) return undefined
  const ship = seat.ship
  // A reclaimed ship is read live by updateShip/collision/render: every numeric field must be
  // finite or the seat is dropped (a half-shaped ship goes to NaN and breaks the whole room).
  if (
    ship === null ||
    typeof ship !== 'object' ||
    Array.isArray(ship) ||
    !allFinite(ship as Record<string, unknown>, SHIP_NUMERIC_FIELDS as readonly string[])
  ) {
    return undefined
  }
  seenIds.add(seat.id)
  seenKeys.add(key)
  ship.id = seat.id // the seat's id is authoritative — a mismatched ship tag must not mislabel bullets
  ship.x = clamp(ship.x, 0, WORLD_WIDTH)
  ship.y = clamp(ship.y, 0, WORLD_HEIGHT)
  ship.health = clamp(ship.health, 1, SHIP_MAX_HEALTH)
  const palette =
    finite(seat.palette) && Number.isInteger(seat.palette) && seat.palette >= 0 && seat.palette < NET_MAX_PLAYERS
      ? seat.palette
      : undefined // out-of-range/missing → the room reassigns the lowest free slot on bench
  return {
    id: seat.id,
    name,
    score: seat.score,
    deaths: Math.max(0, Math.floor(seat.deaths)),
    respawnIn: Math.max(0, seat.respawnIn),
    palette,
    ship,
  }
}

// Parse + validate a persisted state document. undefined = nothing usable (corrupt JSON or no
// finite seed). Otherwise a RoomRestore plus the list of sections that degraded along the way —
// a legacy/foreign version keeps only the arena (seed + terrain + water, exactly the old
// behavior), and a blob older than STATE_TTL drops the session (roster + devices) while the
// carved arena still resurrects.
export const parsePersisted = (
  json: string,
  now = Date.now()
): { restore: RoomRestore; degraded: string[] } | undefined => {
  let raw: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed === null || typeof parsed !== 'object') return undefined
    raw = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  if (!finite(raw.seed)) return undefined
  const degraded: string[] = []
  const restore: RoomRestore = { seed: raw.seed >>> 0 }

  if (raw.terrain && typeof raw.terrain === 'object') restore.terrain = raw.terrain as VoxelSnapshot

  if (raw.v !== PERSIST_VERSION) {
    // Legacy (or future/foreign) document: arena-only, the pre-v2 shape carried water inside a
    // full world snapshot.
    degraded.push('version')
    const world = raw.world as { water?: unknown } | undefined
    const water = validWater(world?.water)
    if (water) restore.water = water
    return { restore, degraded }
  }

  const water = validWater(raw.water)
  if (water) restore.water = water
  else if (raw.water !== undefined) degraded.push('water')

  if (finite(raw.time) && raw.time >= 0) restore.time = raw.time
  if (finite(raw.nextId) && raw.nextId >= 0 && Number.isInteger(raw.nextId)) restore.nextId = raw.nextId

  // Staleness gates the SESSION, not the arena: an expired room's craters still resurrect, but
  // its seats and minions are gone (also covers the in-memory store, which has no TTL of its own).
  if (!finite(raw.savedAt) || now - raw.savedAt > STATE_TTL * 1000) {
    degraded.push('stale')
    return { restore, degraded }
  }

  const deviceResult = validDevices(raw.devices)
  if (deviceResult) {
    restore.devices = deviceResult.devices
    if (deviceResult.dropped) degraded.push('devices')
  } else if (raw.devices !== undefined) {
    degraded.push('devices')
  }

  if (Array.isArray(raw.roster)) {
    const seenIds = new Set<number>()
    const seenKeys = new Set<string>()
    const roster = raw.roster
      .slice(0, NET_BENCH_MAX)
      .map((row) => validSeat(row, seenIds, seenKeys))
      .filter((seat): seat is PersistedSeat => seat !== undefined)
    restore.roster = roster
    if (roster.length !== raw.roster.length) degraded.push('roster')
  } else if (raw.roster !== undefined) {
    degraded.push('roster')
  }

  return { restore, degraded }
}

// Back-compat shim for callers that only want the restore (the original parseRestore contract).
export const parseRestore = (json: string): RoomRestore | undefined => parsePersisted(json)?.restore
