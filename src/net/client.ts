import {
  Color,
  GamePhase,
  NET_DEFAULT_PORT,
  PLAYER_PALETTE,
  SECONDARY_MAX_CHARGE,
  SHIP_SMOKE_HEALTH,
  SMOKE_LIFE,
  THRUST_PARTICLE_LIFE,
  THRUST_PARTICLE_SPEED,
  WeaponKind,
} from '$/game/constants'
import { createInput, readSnapshot } from '$/game/input'
import { spawnExplosion, spawnPuff, updateParticles } from '$/game/particles'
import { createRenderer } from '$/game/renderer'
import { createRng } from '$/game/rng'
import type { Particle } from '$/game/types'
import { createCanvasApp } from '$/game/view'
import { decodeServer, encode, type JoinIntent, MsgType, type PlayerInfo, type WorldSnapshot } from '$/net/protocol'

// Clamp a wire palette slot into the table (a stale/hostile server value falls back to enemy rose).
const clampSlot = (palette: number): number =>
  Number.isInteger(palette) && palette >= 0 && palette < PLAYER_PALETTE.length ? palette : 1

// Where the game server lives. Overridable for split deploys via `?server=` or a stored value;
// otherwise the current host on the game-server port (covers both single-origin production and
// the dev split between the HTML dev server and `bun run server`).
export const serverOrigin = (): string => {
  const override =
    new URLSearchParams(globalThis.location?.search).get('server') ?? globalThis.localStorage?.getItem('vwing.server')
  if (override) return override
  const { protocol, hostname } = globalThis.location
  return `${protocol}//${hostname}:${NET_DEFAULT_PORT}`
}

const wsBase = (): string => serverOrigin().replace(/^http/, 'ws')

export enum NetPhase {
  CONNECTING = 'CONNECTING',
  PLAYING = 'PLAYING',
  DISCONNECTED = 'DISCONNECTED',
}

export type NetStatus = {
  phase: NetPhase
  game: string
  selfId: number
  players: PlayerInfo[]
  score: number // this player's frags
  weapon: WeaponKind
  charge: number // 0..100 percent of the secondary energy bar
  error: string | undefined
}

export type NetClient = {
  canvas: HTMLCanvasElement
  getStatus: () => NetStatus
  subscribe: (listener: () => void) => () => void
  leave: () => void
  destroy: () => void
}

const HEARTBEAT_MS = 400 // resend the current input at least this often (covers dropped packets)

export const connectGame = async (game: string, name: string, intent: JoinIntent): Promise<NetClient> => {
  const app = await createCanvasApp()
  const renderer = createRenderer(createRng(0xc0ffee), app.renderer)
  app.stage.addChild(renderer.view)
  const input = createInput(window)
  const fxRng = createRng(0x51ce) // cosmetic-only stream for client-side particles
  let fxParticles: Particle[] = [] // engine trails / smoke / wreck explosions, regenerated locally

  let world: WorldSnapshot | undefined
  let selfId = -1
  let players: PlayerInfo[] = []
  let paletteSlots = new Map<number, number>() // owner id → PLAYER_PALETTE slot, rebuilt per snapshot
  let phase = NetPhase.CONNECTING
  let error: string | undefined
  let leaving = false
  let lastSent = ''
  let sinceSentMs = 0 // real ms since the input was last streamed (heartbeat timer)

  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const selfShip = () => world?.ships.find((s) => s.id === selfId)
  const chargePct = (): number => {
    const ship = selfShip()
    return ship ? Math.round((ship.charge / SECONDARY_MAX_CHARGE) * 100) : 0
  }

  let status: NetStatus = {
    phase,
    game,
    selfId,
    players,
    score: 0,
    weapon: WeaponKind.SCATTERGUN,
    charge: 0,
    error,
  }
  const publish = (): void => {
    const ship = selfShip()
    const me = players.find((p) => p.id === selfId)
    const next: NetStatus = {
      phase,
      game,
      selfId,
      players,
      score: me?.score ?? 0,
      weapon: ship?.weapon ?? status.weapon,
      charge: chargePct(),
      error,
    }
    // Cheap shallow compare on the fields the HUD reads (players identity changes per tick,
    // but its content rarely does — compare a small signature to avoid churning React).
    // EVERY HUD-read field must appear here, or its changes silently never reach React.
    const sig = (s: NetStatus): string =>
      `${s.phase}|${s.score}|${s.weapon}|${s.charge}|${s.error ?? ''}|${s.players.map((p) => `${p.id}:${p.score}:${p.palette}:${p.connected}`).join(',')}`
    if (sig(next) === sig(status)) return
    status = next
    notify()
  }

  const url = `${wsBase()}/ws?game=${encodeURIComponent(game)}&name=${encodeURIComponent(name)}&intent=${encodeURIComponent(intent)}`
  const ws = new WebSocket(url)

  ws.onmessage = (event) => {
    const message = decodeServer(typeof event.data === 'string' ? event.data : '')
    if (!message) return
    if (message.t === MsgType.WELCOME) {
      selfId = message.selfId
      phase = NetPhase.PLAYING
      publish()
    } else if (message.t === MsgType.SNAPSHOT) {
      world = message.world
      players = message.players
      // Benched seats ride players[] too, so a disconnected pilot's troopers keep their color.
      paletteSlots = new Map(players.map((p) => [p.id, clampSlot(p.palette)]))
      // The wire carries no particles (cosmetic); spawn a wreck explosion at each death here,
      // in the victim's seat color.
      for (const event of message.events) {
        const slot = paletteSlots.get(event.victimId)
        const color = slot === undefined ? Color.ENEMY : (PLAYER_PALETTE[slot] ?? Color.ENEMY)
        spawnExplosion(fxParticles, event.x, event.y, color, fxRng, 34)
      }
      publish()
    } else if (message.t === MsgType.REJECTED) {
      error = message.reason
      phase = NetPhase.DISCONNECTED
      publish()
    }
  }
  ws.onclose = () => {
    if (leaving) return
    phase = NetPhase.DISCONNECTED
    if (!error) error = 'Connection lost'
    publish()
  }
  ws.onerror = () => {
    if (!error) error = 'Could not reach the game server'
  }

  // Each rendered frame: stream the current control state to the server (on change or as a
  // heartbeat), regenerate local cosmetic particles from the latest snapshot, then draw it.
  app.ticker.add((ticker) => {
    sinceSentMs += ticker.deltaMS
    if (ws.readyState === WebSocket.OPEN && phase === NetPhase.PLAYING) {
      const snapshot = readSnapshot(input)
      const serialized = JSON.stringify(snapshot)
      if (serialized !== lastSent || sinceSentMs > HEARTBEAT_MS) {
        ws.send(encode({ t: MsgType.INPUT, input: snapshot }))
        lastSent = serialized
        sinceSentMs = 0
      }
    }
    if (!world) return
    const dt = Math.min(ticker.deltaMS / 1000, 1 / 30)
    for (const ship of world.ships) {
      if (ship.thrusting) {
        const bx = -Math.cos(ship.angle)
        const by = -Math.sin(ship.angle)
        spawnPuff(
          fxParticles,
          ship.x + bx * ship.radius,
          ship.y + by * ship.radius,
          bx * THRUST_PARTICLE_SPEED,
          by * THRUST_PARTICLE_SPEED,
          Color.THRUST,
          fxRng,
          THRUST_PARTICLE_LIFE
        )
      }
      if (ship.health < SHIP_SMOKE_HEALTH && ship.invuln <= 0) {
        spawnPuff(fxParticles, ship.x, ship.y, 0, -30, Color.SMOKE, fxRng, SMOKE_LIFE)
      }
    }
    fxParticles = updateParticles(fxParticles, dt)
    renderer.draw({ ...world, particles: fxParticles }, GamePhase.PLAYING, selfId, paletteSlots)
  })

  const leave = (): void => {
    leaving = true
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
  }

  const destroy = (): void => {
    leave()
    input.destroy()
    app.ticker.stop()
    renderer.destroy()
    // releaseGlobalResources drains Pixi's global pools (batches, texture caches) — without it,
    // the Practice↔Online destroy/recreate cycles in App routing leak stale GL state.
    app.destroy(
      { removeView: true, releaseGlobalResources: true },
      { children: true, texture: true, textureSource: true }
    )
    listeners.clear()
  }

  return {
    canvas: app.canvas,
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    leave,
    destroy,
  }
}

// Fetch the lobby listing from the game server (used by the lobby screen).
export const fetchGames = async (): Promise<{ name: string; players: number; maxPlayers: number }[]> => {
  const response = await fetch(`${serverOrigin()}/api/games`)
  if (!response.ok) throw new Error(`Lobby unavailable (${response.status})`)
  const body = (await response.json()) as { games: { name: string; players: number; maxPlayers: number }[] }
  return body.games
}
