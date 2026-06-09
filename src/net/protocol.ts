import type { InputSnapshot } from '$/game/input'
import type { DeathEvent } from '$/game/sim'
import type { World } from '$/game/types'

// The full simulation state minus the rng closure (functions don't serialize, and clients
// only render — they never advance the sim). This is exactly what crosses the wire and what
// the server persists to Redis as the "entire game state".
export type WorldSnapshot = Omit<World, 'rng'>

// A combatant's scoreboard row (derived from the server's sim each tick).
export type PlayerInfo = {
  id: number
  name: string
  score: number // points (CAMPAIGN) / frags (DEATHMATCH)
  lives: number | null // null = endless respawns (Infinity doesn't survive JSON)
  connected: boolean
}

// One active game in the lobby listing.
export type GameSummary = {
  name: string
  players: number
  maxPlayers: number
}

// Tagged message kinds (the `t` discriminant on every wire message).
export enum MsgType {
  // client → server
  INPUT = 'INPUT', // latest control state for this player
  // server → client
  WELCOME = 'WELCOME', // sent once on join: which ship id is yours + room facts
  SNAPSHOT = 'SNAPSHOT', // broadcast every tick: world + scoreboard + this tick's deaths
  REJECTED = 'REJECTED', // join refused (room full / bad name)
}

export type ClientMessage = { t: MsgType.INPUT; input: InputSnapshot }

export type ServerMessage =
  | { t: MsgType.WELCOME; selfId: number; game: string; tickRate: number }
  | { t: MsgType.SNAPSHOT; world: WorldSnapshot; players: PlayerInfo[]; events: DeathEvent[] }
  | { t: MsgType.REJECTED; reason: string }

// Lives are Number.POSITIVE_INFINITY in-sim (endless respawns); JSON can't carry that, so
// the wire uses null and the client treats null as "endless".
export const livesToWire = (lives: number): number | null => (Number.isFinite(lives) ? lives : null)
export const livesFromWire = (wire: number | null): number => (wire === null ? Number.POSITIVE_INFINITY : wire)

export const encode = (message: ServerMessage | ClientMessage): string => JSON.stringify(message)

export const decodeClient = (raw: string): ClientMessage | undefined => {
  try {
    const value = JSON.parse(raw) as ClientMessage
    // Validate the shape, not just the tag: a crafted `{"t":"INPUT"}` (no `input`) must not
    // reach the sim — the server derefs `message.input` straight away.
    return value?.t === MsgType.INPUT && value.input !== null && typeof value.input === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

export const decodeServer = (raw: string): ServerMessage | undefined => {
  try {
    return JSON.parse(raw) as ServerMessage
  } catch {
    return undefined
  }
}

// Trim/normalize a hosted game name to a safe lobby key (also used as a Redis key and a
// WebSocket topic): keep letters/digits/underscore plus spaces and hyphens, collapse
// whitespace runs, and cap the length.
const UNSAFE_NAME_CHARS = /[^\w -]+/g
const WHITESPACE_RUN = /\s+/g
export const sanitizeGameName = (raw: string, max: number): string =>
  raw.replace(UNSAFE_NAME_CHARS, '').replace(WHITESPACE_RUN, ' ').trim().slice(0, max)
