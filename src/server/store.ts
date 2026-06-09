import { RedisClient } from 'bun'

import type { GameSummary } from '$/net/protocol'

// Where the lobby lives and where each room's world snapshot is persisted. The server writes the
// *entire* world JSON per game (the user's requirement) plus a lobby entry per active room. That
// snapshot is a write-side operational artifact — for inspection / external recovery tooling, not
// auto-restore: the live server intentionally (re)creates rooms fresh (players reconnect into a new
// arena), and the snapshot omits the server-internal voxel-terrain grid (it lives in the createSim
// closure, not on `world`), so carved terrain is never rehydrated. A Redis-backed store is used
// whenever a server is reachable; otherwise an in-memory store keeps a single-process server fully
// functional (and lets tests run without Redis).

const STATE_KEY = (game: string): string => `vwing:state:${game}`
const SUMMARY_KEY = (game: string): string => `vwing:game:${game}`
const GAMES_SET = 'vwing:games'
const SUMMARY_TTL = 30 // s; refreshed by each room's heartbeat, so a crashed server expires out of the lobby
const STATE_TTL = 3600 // s; the persisted snapshot lingers an hour for inspection / external tooling

// Keyed by a game's canonical (case-insensitive, normalized) key — same index the server's
// `rooms` map uses — so the lobby never lists two casings of one game. `name` carries the
// host's original display spelling for presentation.
export type StoredSummary = { name: string; players: number; maxPlayers: number }

export type Store = {
  kind: 'redis' | 'memory'
  // Snapshot persistence for a game (write / read-back / drop). The server only writes (saveState)
  // and cleans up (deleteState); loadState is the read accessor for external recovery tooling and
  // tests — the live server does not auto-rehydrate from it (rooms always start fresh).
  saveState: (game: string, json: string) => Promise<void>
  loadState: (game: string) => Promise<string | undefined>
  deleteState: (game: string) => Promise<void>
  // Lobby membership (with a refreshable TTL so dead rooms disappear on their own).
  registerGame: (game: string, summary: StoredSummary) => Promise<void>
  unregisterGame: (game: string) => Promise<void>
  listGames: () => Promise<GameSummary[]>
  close: () => Promise<void>
}

const createMemoryStore = (): Store => {
  const states = new Map<string, string>()
  const summaries = new Map<string, StoredSummary>()
  return {
    kind: 'memory',
    saveState: async (game, json) => void states.set(game, json),
    loadState: async (game) => states.get(game),
    deleteState: async (game) => void states.delete(game),
    registerGame: async (game, summary) => void summaries.set(game, summary),
    unregisterGame: async (game) => void summaries.delete(game),
    listGames: async () =>
      [...summaries.values()].map((s) => ({ name: s.name, players: s.players, maxPlayers: s.maxPlayers })),
    close: async () => {},
  }
}

// Wrap a Redis call so a mid-game outage degrades gracefully (the WebSocket game keeps
// running; only persistence/lobby is affected) instead of crashing the server.
let warnedOutage = false
const guard = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    if (!warnedOutage) {
      warnedOutage = true
      console.warn(`[store] Redis operation failed; continuing without persistence: ${(error as Error).message}`)
    }
    return fallback
  }
}

const createRedisStore = (client: RedisClient): Store => ({
  kind: 'redis',
  saveState: async (game, json) => void (await guard(() => client.set(STATE_KEY(game), json, 'EX', STATE_TTL), 'OK')),
  loadState: async (game) => (await guard(() => client.get(STATE_KEY(game)), null)) ?? undefined,
  deleteState: async (game) => void (await guard(() => client.del(STATE_KEY(game)), 0)),
  registerGame: async (game, summary) => {
    await guard(async () => {
      await client.set(SUMMARY_KEY(game), JSON.stringify(summary), 'EX', SUMMARY_TTL)
      await client.sadd(GAMES_SET, game)
    }, undefined)
  },
  unregisterGame: async (game) => {
    await guard(async () => {
      await client.del(SUMMARY_KEY(game))
      await client.srem(GAMES_SET, game)
    }, undefined)
  },
  listGames: async () =>
    guard(async () => {
      const names = await client.smembers(GAMES_SET)
      const games: GameSummary[] = []
      for (const name of names) {
        const raw = await client.get(SUMMARY_KEY(name))
        if (raw === null) {
          await client.srem(GAMES_SET, name) // summary TTL lapsed (dead room): prune the index
          continue
        }
        try {
          const summary = JSON.parse(raw) as StoredSummary
          games.push({ name: summary.name, players: summary.players, maxPlayers: summary.maxPlayers })
        } catch {
          // ignore a corrupt entry
        }
      }
      return games
    }, []),
  close: async () => client.close(),
})

// Connect to Redis if one is reachable, otherwise fall back to the in-memory store. The
// initial probe fails fast (short timeout, no offline queue) so startup isn't blocked when
// no Redis is running.
export const createStore = async (url?: string): Promise<Store> => {
  const target = url ?? process.env.REDIS_URL ?? process.env.VALKEY_URL ?? 'redis://localhost:6379'
  try {
    const client = new RedisClient(target, {
      connectionTimeout: 1500,
      enableOfflineQueue: false,
      maxRetries: 2,
    })
    client.onclose = () => {} // swallow disconnect errors; guard() handles failed commands
    await client.connect()
    await client.ping()
    return createRedisStore(client)
  } catch (error) {
    console.warn(
      `[store] Redis unavailable at ${target} (${(error as Error).message}); using in-memory store — state is not persisted across restarts.`
    )
    return createMemoryStore()
  }
}
