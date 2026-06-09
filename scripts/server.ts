// V-Wing authoritative multiplayer server: the lobby HTTP API + the per-room WebSocket
// game loop, with full game state persisted to Redis (falling back to in-memory). Run with
// `bun run server`. Serves the built client from ./dist too, so a production deploy is a
// single process/origin (run `bun run build` first).

import { join } from 'node:path'

import { NET_DEFAULT_PORT } from '$/game/constants'
import { startServer } from '$/server/index'
import { createStore } from '$/server/store'

const PORT = Number(Bun.env.PORT ?? NET_DEFAULT_PORT)
const DIST = join(import.meta.dir, '..', 'dist')
const distExists = await Bun.file(join(DIST, 'index.html')).exists()

const store = await createStore()
const { server, stop } = startServer(store, { port: PORT, distDir: distExists ? DIST : undefined })

console.log(
  `▶ V-Wing server on ${server.url}  [store: ${store.kind}${distExists ? ', serving ./dist' : ''}, ${NET_DEFAULT_PORT === PORT ? 'default' : 'custom'} port]`
)

const shutdown = () => {
  console.log('\n[server] shutting down…')
  void stop().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
