import { normalize, join as pathJoin } from 'node:path'
import { file, type Server, type ServerWebSocket } from 'bun'

import {
  NET_EMPTY_ROOM_TTL,
  NET_GAME_NAME_MAX,
  NET_MAX_PLAYERS,
  NET_PERSIST_EVERY,
  NET_TICK_RATE,
} from '$/game/constants'
import {
  decodeClient,
  encode,
  gameNameKey,
  JoinIntent,
  MsgType,
  NAME_TAKEN_REASON,
  sanitizeGameName,
} from '$/net/protocol'
import { createLog } from '$/server/log'
import { parsePersisted, type RoomRestore } from '$/server/restore'
import { createRoom, JoinRefusal, type Room } from '$/server/room'
import type { Store } from '$/server/store'

// Per-connection data carried on each WebSocket (assigned at upgrade, finalized on open).
// `game` is the display name; `key` is its canonical (case-insensitive, normalized) identity,
// which is what rooms are indexed by so two casings of a name are the same game.
type ConnData = { game: string; key: string; name: string; intent: JoinIntent; shipId: number }

type RoomState = {
  room: Room
  topic: string
  persistTick: number // ticks since the last full-state write to the store
  emptySince: number | undefined // tick count when the room went empty (for TTL disposal)
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

export type ServerOptions = { port: number; distDir?: string }
export type GameServer = { server: Server<ConnData>; stop: () => Promise<void> }

export const startServer = (store: Store, options: ServerOptions): GameServer => {
  const log = createLog('server')
  const rooms = new Map<string, RoomState>()
  const tickMs = 1000 / NET_TICK_RATE
  const dt = 1 / NET_TICK_RATE
  let tickCount = 0

  // Creates a room indexed by its canonical key (and topic); the caller decides whether that's
  // allowed — host into a free key, join into an existing one. With `restored` the room is
  // resurrected from a persisted state (full session: seats benched, devices live, carved
  // terrain overlaid) instead of fresh.
  const createRoomState = (
    key: string,
    displayName: string,
    restored?: { restore: RoomRestore; degraded: string[] }
  ): RoomState => {
    const created: RoomState = {
      room: createRoom(displayName, restored?.restore),
      topic: `game:${key}`,
      persistTick: 0,
      emptySince: undefined,
    }
    rooms.set(key, created)
    void store.registerGame(key, { name: displayName, players: 0, maxPlayers: NET_MAX_PLAYERS })
    const detail = restored
      ? `: ${restored.restore.roster?.length ?? 0} benched pilots, ${restored.restore.devices?.length ?? 0} devices` +
        (restored.degraded.length > 0 ? ` (degraded: ${restored.degraded.join(', ')})` : '')
      : ''
    log.info(`room ${restored ? 'resumed' : 'created'}: "${displayName}"${detail}`)
    return created
  }

  // The persisted state for a key, validated into a restore — undefined when none exists or the
  // blob is unusable. This is what makes a whole game session survive a server restart.
  const loadRestore = async (key: string): Promise<{ restore: RoomRestore; degraded: string[] } | undefined> => {
    const json = await store.loadState(key)
    return json ? parsePersisted(json) : undefined
  }

  const disposeRoom = (key: string, rs: RoomState): void => {
    rooms.delete(key)
    void store.unregisterGame(key)
    // Hibernate, don't delete: the final write leaves the room resurrectable until the store's
    // state TTL lapses — the single authority on when a game is truly gone.
    void store.saveState(key, rs.room.persisted())
    log.info(`room hibernated: "${rs.room.name}"`)
  }

  // ── Static serving (production single-origin): everything that isn't /api or /ws falls
  // through to the built client in distDir, with an index.html SPA fallback. ───────────────
  const serveStatic = async (pathname: string): Promise<Response> => {
    if (!options.distDir) return new Response('Not found', { status: 404 })
    const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
    const candidate = file(pathJoin(options.distDir, relative === '/' ? 'index.html' : relative))
    if (await candidate.exists()) return new Response(candidate)
    return new Response(file(pathJoin(options.distDir, 'index.html')))
  }

  const server = Bun.serve<ConnData>({
    port: options.port,
    fetch: async (request, srv) => {
      const url = new URL(request.url)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

      // The lobby reads from the store, so Redis is the source of truth for "what games exist"
      // (and survives across instances). With the in-memory fallback this mirrors the live rooms.
      if (url.pathname === '/api/games') return jsonResponse({ games: await store.listGames() })
      if (url.pathname === '/api/health') {
        // Per-room rows for curl-level DX: who's live, and how old each match is (sim seconds).
        const live = [...rooms.entries()].map(([key, rs]) => ({
          key,
          players: rs.room.playerCount(),
          ageSeconds: Math.round(rs.room.sim.world.time),
        }))
        return jsonResponse({ ok: true, store: store.kind, rooms: live })
      }

      if (url.pathname === '/ws') {
        const game = sanitizeGameName(url.searchParams.get('game') ?? '', NET_GAME_NAME_MAX)
        const rawName = sanitizeGameName(url.searchParams.get('name') ?? '', NET_GAME_NAME_MAX)
        if (!game) return new Response('Missing game name', { status: 400, headers: CORS })
        const intent = url.searchParams.get('intent') === JoinIntent.HOST ? JoinIntent.HOST : JoinIntent.JOIN
        const data: ConnData = { game, key: gameNameKey(game), name: rawName || 'Pilot', intent, shipId: -1 }
        return srv.upgrade(request, { data })
          ? undefined
          : new Response('Upgrade failed', { status: 400, headers: CORS })
      }

      return serveStatic(url.pathname)
    },
    websocket: {
      open: async (ws: ServerWebSocket<ConnData>) => {
        const { key, intent, game } = ws.data
        let existing = rooms.get(key)
        // Enforce intent against the canonical key: you can't host onto a name that's already
        // live, and you can't join one that doesn't exist — though a game whose room died with
        // a server restart still "exists" in the store, and either intent resurrects it (same
        // seed, carved terrain overlaid) for as long as its persisted state lives.
        if (intent === JoinIntent.HOST && existing) {
          const reason = `“${existing.room.name}” is already hosted — pick another name.`
          ws.send(encode({ t: MsgType.REJECTED, reason }))
          ws.close()
          return
        }
        let restored: { restore: RoomRestore; degraded: string[] } | undefined
        if (!existing) {
          restored = await loadRestore(key)
          existing = rooms.get(key) // a parallel open may have created the room during the await
          if (intent === JoinIntent.JOIN && !existing && !restored) {
            ws.send(encode({ t: MsgType.REJECTED, reason: 'That game is no longer open.' }))
            ws.close()
            return
          }
        }
        const rs = existing ?? createRoomState(key, game, restored)
        const seat = rs.room.join(ws.data.name)
        if ('refusal' in seat) {
          const reason = seat.refusal === JoinRefusal.NAME_TAKEN ? NAME_TAKEN_REASON : 'Game is full'
          log.info(`"${ws.data.name}" refused from "${rs.room.name}": ${seat.refusal}`)
          ws.send(encode({ t: MsgType.REJECTED, reason }))
          ws.close()
          return
        }
        ws.data.shipId = seat.shipId
        rs.emptySince = undefined
        ws.subscribe(rs.topic)
        ws.send(
          encode({
            t: MsgType.WELCOME,
            selfId: seat.shipId,
            game: rs.room.name,
            tickRate: NET_TICK_RATE,
            reclaimed: seat.reclaimed,
          })
        )
        void store.registerGame(key, {
          name: rs.room.name,
          players: rs.room.playerCount(),
          maxPlayers: NET_MAX_PLAYERS,
        })
        const verb = intent === JoinIntent.HOST ? 'hosted' : 'joined'
        log.info(
          `"${ws.data.name}" ${verb} "${rs.room.name}" as #${seat.shipId}${seat.reclaimed ? ' (reclaimed seat)' : ''} (${rs.room.playerCount()} in room)`
        )
      },
      message: (ws: ServerWebSocket<ConnData>, raw) => {
        if (ws.data.shipId < 0) return
        try {
          const message = decodeClient(typeof raw === 'string' ? raw : raw.toString())
          if (message) rooms.get(ws.data.key)?.room.setInput(ws.data.shipId, message.input)
        } catch {
          // A malformed packet must never take down the room loop or other players.
        }
      },
      close: (ws: ServerWebSocket<ConnData>) => {
        const rs = rooms.get(ws.data.key)
        if (!rs || ws.data.shipId < 0) return
        ws.unsubscribe(rs.topic)
        rs.room.leave(ws.data.shipId)
        void store.registerGame(ws.data.key, {
          name: rs.room.name,
          players: rs.room.playerCount(),
          maxPlayers: NET_MAX_PLAYERS,
        })
        if (rs.room.isEmpty()) rs.emptySince = tickCount
        log.info(`"${ws.data.name}" left "${rs.room.name}" (${rs.room.playerCount()} remain)`)
      },
    },
  })

  // ── The single authoritative clock: step every live room, broadcast its snapshot, persist
  // periodically, and reap rooms that have stood empty past the TTL. ───────────────────────
  const emptyTtlTicks = NET_EMPTY_ROOM_TTL * NET_TICK_RATE
  const loop = setInterval(() => {
    tickCount += 1
    const passStart = performance.now()
    for (const [key, rs] of rooms) {
      if (rs.room.isEmpty()) {
        if (rs.emptySince !== undefined && tickCount - rs.emptySince >= emptyTtlTicks) disposeRoom(key, rs)
        continue
      }
      const events = rs.room.step(dt)
      server.publish(rs.topic, encode(rs.room.snapshot(events)))
      rs.persistTick += 1
      if (rs.persistTick >= NET_PERSIST_EVERY) {
        rs.persistTick = 0
        const persisted = rs.room.persisted() // full session: seats + devices + carved terrain (see restore.ts)
        void store.saveState(key, persisted)
        log.debug(`persisted "${rs.room.name}" (${(persisted.length / 1024).toFixed(1)} KB)`)
        // refresh lobby TTL
        void store.registerGame(key, {
          name: rs.room.name,
          players: rs.room.playerCount(),
          maxPlayers: NET_MAX_PLAYERS,
        })
      }
    }
    // A pass that overruns the tick budget means the sim is falling behind real time — warn,
    // but never per tick (a sustained overload would otherwise drown the pane it warns into).
    const passMs = performance.now() - passStart
    if (passMs > tickMs)
      log.throttle('slow-tick', 10, `tick took ${passMs.toFixed(1)} ms (budget ${tickMs.toFixed(1)} ms)`)
  }, tickMs)

  return {
    server,
    stop: async () => {
      clearInterval(loop)
      // A graceful shutdown checkpoints every live room, so a restart resumes mid-match games
      // (SIGINT/SIGTERM route here via scripts/server.ts). allSettled: one room's failed
      // write must not cost every other room its final state.
      await Promise.allSettled([...rooms].map(([key, rs]) => store.saveState(key, rs.room.persisted())))
      await server.stop(true)
      await store.close()
    },
  }
}
