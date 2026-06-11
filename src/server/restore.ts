import {
  DeviceKind,
  NET_BENCH_MAX,
  NET_GAME_NAME_MAX,
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
export const PERSIST_VERSION = 2

// One roster row: a seat as it stood at save time — live, benched, or mid-respawn alike. The
// ship object rides whole (mid-respawn ships are NOT in world.ships; the seat owns them), and
// the attrition clock is RELATIVE seconds so it is robust against world.time handling.
export type PersistedSeat = {
  id: number
  name: string
  score: number
  deaths: number
  respawnIn: number
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

const DEVICE_KINDS = new Set<string>(Object.values(DeviceKind))

const validWater = (raw: unknown): WaterBody[] | undefined => {
  if (!Array.isArray(raw)) return undefined
  const bodies = raw.filter(
    (b): b is WaterBody =>
      b !== null && typeof b === 'object' && finite(b.x) && finite(b.y) && finite(b.w) && finite(b.h)
  )
  return bodies.length === raw.length ? bodies : undefined
}

// Row-validate the device list: unknown kinds and non-finite positions/owners are dropped
// individually; the list is capped so a hostile blob can't seed an unbounded device array.
const validDevices = (raw: unknown): { devices: Device[]; dropped: boolean } | undefined => {
  if (!Array.isArray(raw)) return undefined
  const rows = raw.slice(0, NET_PERSIST_MAX_DEVICES)
  const devices = rows.filter(
    (d): d is Device =>
      d !== null &&
      typeof d === 'object' &&
      typeof d.kind === 'string' &&
      DEVICE_KINDS.has(d.kind) &&
      finite(d.x) &&
      finite(d.y) &&
      finite(d.owner)
  )
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
  if (ship === null || typeof ship !== 'object' || !finite(ship.x) || !finite(ship.y) || !finite(ship.health)) {
    return undefined
  }
  seenIds.add(seat.id)
  seenKeys.add(key)
  ship.id = seat.id // the seat's id is authoritative — a mismatched ship tag must not mislabel bullets
  ship.x = clamp(ship.x, 0, WORLD_WIDTH)
  ship.y = clamp(ship.y, 0, WORLD_HEIGHT)
  ship.health = clamp(ship.health, 1, SHIP_MAX_HEALTH)
  return {
    id: seat.id,
    name,
    score: seat.score,
    deaths: Math.max(0, Math.floor(seat.deaths)),
    respawnIn: Math.max(0, seat.respawnIn),
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
