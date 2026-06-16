import { NET_DEFAULT_PORT } from '$/game/constants'

// Resolving where the game server lives. Kept free of the (pixi-coupled) client so this
// connectivity-critical logic stays pure and unit-testable.
//
// Overridable for split deploys via `?server=` or a stored value. A production build is served
// by the game server itself — directly, or proxied by Traefik on 80/443 — and HTTP, the static
// client and the /ws socket all share that one origin, so dial it (this is what lets a
// Traefik-only deployment carry the WebSocket; it assumes the server is mounted at the origin
// root, which matches the exact `/ws` + `/api` routes in server/index.ts). Only the dev split
// serves the client from a separate web dev server (VWING_WEB_PORT), with the game server on its
// own NET_DEFAULT_PORT, so there we cross to that port explicitly. The build inlines
// NODE_ENV='production'; the `dev` script pins NODE_ENV=development so a stray env value can't
// flip this branch and silently point the dev client at the wrong port.
export const serverOrigin = (): string => {
  const override =
    new URLSearchParams(globalThis.location?.search).get('server') ?? globalThis.localStorage?.getItem('vwing.server')
  if (override) return override
  if (process.env.NODE_ENV === 'production') return globalThis.location.origin
  const { protocol, hostname } = globalThis.location
  return `${protocol}//${hostname}:${NET_DEFAULT_PORT}`
}

// The WebSocket base for the same origin — ws:// for http, wss:// for https.
export const wsBase = (): string => serverOrigin().replace(/^http/, 'ws')
