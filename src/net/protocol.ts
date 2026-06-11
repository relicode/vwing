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
  palette: number // PLAYER_PALETTE slot the server assigned this seat (clients clamp, fallback 1)
  respawnIn: number // s until the seat's ship re-enters (0 = flying, or benched)
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

// Why a client opened the socket: HOST refuses to reuse a live game name; JOIN refuses to
// connect to one that doesn't exist. Sent as the `intent` query param on the /ws upgrade.
export enum JoinIntent {
  HOST = 'HOST',
  JOIN = 'JOIN',
}

// The exact REJECTED reason for a live duplicate pilot name. Shared as a constant because the
// reconnecting client treats THIS refusal as retryable — its own stale socket simply hasn't been
// benched server-side yet — while every other refusal is terminal.
export const NAME_TAKEN_REASON = 'That pilot is already flying in this game.'

export type ClientMessage = { t: MsgType.INPUT; input: InputSnapshot }

export type ServerMessage =
  | { t: MsgType.WELCOME; selfId: number; game: string; tickRate: number; reclaimed: boolean }
  | { t: MsgType.SNAPSHOT; world: WorldSnapshot; players: PlayerInfo[]; events: DeathEvent[] }
  | { t: MsgType.REJECTED; reason: string }

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

// Trim/normalize a hosted game name to a safe display name. NFC-normalize first so combining
// sequences precompose, then keep Unicode letters/digits/marks plus spaces, underscores and
// hyphens (so international names like "Café" or "アリーナ" survive), collapse whitespace runs,
// and cap the length. Control/format/punctuation/emoji are dropped.
const UNSAFE_NAME_CHARS = /[^\p{L}\p{N}\p{M} _-]+/gu
const WHITESPACE_RUN = /\s+/g
export const sanitizeGameName = (raw: string, max: number): string =>
  raw.normalize('NFC').replace(UNSAFE_NAME_CHARS, '').replace(WHITESPACE_RUN, ' ').trim().slice(0, max)

// Canonical identity of a hosted game — what uniqueness is tested against. Case-insensitive and
// compatibility-normalized (NFKC), so names differing only by letter case or Unicode form map to
// the same game and can't be double-hosted ("Arena" == "arena", precomposed "é" == combining
// "é", fullwidth "Ａ" == "a"). Diacritics are preserved (café ≠ cafe — genuinely distinct names).
export const gameNameKey = (name: string): string => name.normalize('NFKC').toLowerCase()

// A pilot's canonical identity within a room — the same NFKC casefold a game name gets. With no
// auth, the name IS the identity: a disconnected pilot rejoining under any casing/normalization
// of their name reclaims their benched seat (see server/room.ts).
export const pilotNameKey = gameNameKey
