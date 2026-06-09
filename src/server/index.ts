import { normalize, join as pathJoin } from 'node:path'
import { file, type Server, type ServerWebSocket } from 'bun'

import {
  NET_EMPTY_ROOM_TTL,
  NET_GAME_NAME_MAX,
  NET_MAX_PLAYERS,
  NET_PERSIST_EVERY,
  NET_TICK_RATE,
} from '$/game/constants'
import { decodeClient, encode, MsgType, sanitizeGameName } from '$/net/protocol'
import { createRoom, type Room } from '$/server/room'
import type { Store } from '$/server/store'

// Per-connection data carried on each WebSocket (assigned at upgrade, finalized on open).
type ConnData = { game: string; name: string; shipId: number }

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
  const rooms = new Map<string, RoomState>()
  const tickMs = 1000 / NET_TICK_RATE
  const dt = 1 / NET_TICK_RATE
  let tickCount = 0

  const getOrCreateRoom = (name: string): RoomState => {
    const existing = rooms.get(name)
    if (existing) return existing
    const created: RoomState = { room: createRoom(name), topic: `game:${name}`, persistTick: 0, emptySince: undefined }
    rooms.set(name, created)
    void store.registerGame(name, { players: 0, maxPlayers: NET_MAX_PLAYERS })
    console.log(`[server] room created: "${name}"`)
    return created
  }

  const disposeRoom = (rs: RoomState): void => {
    rooms.delete(rs.room.name)
    void store.unregisterGame(rs.room.name)
    void store.deleteState(rs.room.name)
    console.log(`[server] room disposed: "${rs.room.name}"`)
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
      if (url.pathname === '/api/health') return jsonResponse({ ok: true, store: store.kind, rooms: rooms.size })

      if (url.pathname === '/ws') {
        const game = sanitizeGameName(url.searchParams.get('game') ?? '', NET_GAME_NAME_MAX)
        const rawName = sanitizeGameName(url.searchParams.get('name') ?? '', NET_GAME_NAME_MAX)
        if (!game) return new Response('Missing game name', { status: 400, headers: CORS })
        const data: ConnData = { game, name: rawName || 'Pilot', shipId: -1 }
        return srv.upgrade(request, { data })
          ? undefined
          : new Response('Upgrade failed', { status: 400, headers: CORS })
      }

      return serveStatic(url.pathname)
    },
    websocket: {
      open: (ws: ServerWebSocket<ConnData>) => {
        const rs = getOrCreateRoom(ws.data.game)
        const shipId = rs.room.join(ws.data.name)
        if (shipId === undefined) {
          ws.send(encode({ t: MsgType.REJECTED, reason: 'Game is full' }))
          ws.close()
          return
        }
        ws.data.shipId = shipId
        rs.emptySince = undefined
        ws.subscribe(rs.topic)
        ws.send(encode({ t: MsgType.WELCOME, selfId: shipId, game: rs.room.name, tickRate: NET_TICK_RATE }))
        void store.registerGame(rs.room.name, { players: rs.room.playerCount(), maxPlayers: NET_MAX_PLAYERS })
        console.log(
          `[server] "${ws.data.name}" joined "${rs.room.name}" as #${shipId} (${rs.room.playerCount()} in room)`
        )
      },
      message: (ws: ServerWebSocket<ConnData>, raw) => {
        if (ws.data.shipId < 0) return
        try {
          const message = decodeClient(typeof raw === 'string' ? raw : raw.toString())
          if (message) rooms.get(ws.data.game)?.room.setInput(ws.data.shipId, message.input)
        } catch {
          // A malformed packet must never take down the room loop or other players.
        }
      },
      close: (ws: ServerWebSocket<ConnData>) => {
        const rs = rooms.get(ws.data.game)
        if (!rs || ws.data.shipId < 0) return
        ws.unsubscribe(rs.topic)
        rs.room.leave(ws.data.shipId)
        void store.registerGame(rs.room.name, { players: rs.room.playerCount(), maxPlayers: NET_MAX_PLAYERS })
        if (rs.room.isEmpty()) rs.emptySince = tickCount
        console.log(`[server] "${ws.data.name}" left "${rs.room.name}" (${rs.room.playerCount()} remain)`)
      },
    },
  })

  // ── The single authoritative clock: step every live room, broadcast its snapshot, persist
  // periodically, and reap rooms that have stood empty past the TTL. ───────────────────────
  const emptyTtlTicks = NET_EMPTY_ROOM_TTL * NET_TICK_RATE
  const loop = setInterval(() => {
    tickCount += 1
    for (const rs of rooms.values()) {
      if (rs.room.isEmpty()) {
        if (rs.emptySince !== undefined && tickCount - rs.emptySince >= emptyTtlTicks) disposeRoom(rs)
        continue
      }
      const events = rs.room.step(dt)
      server.publish(rs.topic, encode(rs.room.snapshot(events)))
      rs.persistTick += 1
      if (rs.persistTick >= NET_PERSIST_EVERY) {
        rs.persistTick = 0
        void store.saveState(rs.room.name, JSON.stringify(rs.room.snapshot([]))) // entire game state → Redis
        void store.registerGame(rs.room.name, { players: rs.room.playerCount(), maxPlayers: NET_MAX_PLAYERS }) // refresh lobby TTL
      }
    }
  }, tickMs)

  return {
    server,
    stop: async () => {
      clearInterval(loop)
      await server.stop(true)
      await store.close()
    },
  }
}
