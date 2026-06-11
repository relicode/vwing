import {
  Color,
  GamePhase,
  NET_DEFAULT_PORT,
  NET_RECONNECT_DELAYS_MS,
  NET_SNAPSHOT_STALL_MS,
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
import { type FeedEntry, reconnectDelay, updateFeed } from '$/net/feed'
import {
  decodeServer,
  encode,
  JoinIntent,
  MsgType,
  NAME_TAKEN_REASON,
  type PlayerInfo,
  type WorldSnapshot,
} from '$/net/protocol'

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
  RECONNECTING = 'RECONNECTING', // an unexpected drop after a WELCOME — auto-redialing on the backoff
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
  attempt: number // reconnect re-dials so far this outage (banner: "reconnecting (n/5)")
  reclaims: number // count of reclaimed WELCOMEs (the HUD toasts each increment)
  feed: FeedEntry[] // the rolling kill feed (newest last)
  respawnIn: number // s until this player's ship re-enters; 0 = flying
  stalled: boolean // no SNAPSHOT for NET_SNAPSHOT_STALL_MS while PLAYING (the UNSTABLE chip)
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
  let welcomed = false // ever seated — gates auto-reconnect (an initial failure stays a plain refusal)
  let attempt = 0 // re-dials so far this outage; reset by the next WELCOME
  let reclaims = 0
  let feed: FeedEntry[] = []
  let stalled = false
  let lastSnapshotMs = Number.POSITIVE_INFINITY // no stall chip before the first snapshot
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

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
    attempt,
    reclaims,
    feed,
    respawnIn: 0,
    stalled,
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
      attempt,
      reclaims,
      feed,
      respawnIn: me?.respawnIn ?? 0,
      stalled,
      error,
    }
    // Cheap shallow compare on the fields the HUD reads (players identity changes per tick,
    // but its content rarely does — compare a small signature to avoid churning React).
    // EVERY HUD-read field must appear here, or its changes silently never reach React.
    // (respawnIn folds at whole seconds — the countdown displays whole seconds.)
    const sig = (s: NetStatus): string =>
      `${s.phase}|${s.score}|${s.weapon}|${s.charge}|${s.attempt}|${s.reclaims}|${s.stalled}|${Math.ceil(s.respawnIn)}|${s.error ?? ''}|${s.feed.map((f) => f.id).join('.')}|${s.players.map((p) => `${p.id}:${p.score}:${p.palette}:${p.connected}`).join(',')}`
    if (sig(next) === sig(status)) return
    status = next
    notify()
  }

  // The reconnect backoff: re-dial with intent=JOIN — the same path that reclaims the benched
  // seat AND resurrects a hibernated room, so a network blip and a server restart heal alike.
  const scheduleReconnect = (): void => {
    if (leaving || reconnectTimer !== undefined) return
    const delay = reconnectDelay(attempt)
    if (delay === undefined) {
      phase = NetPhase.DISCONNECTED
      if (!error) error = 'Connection lost'
      publish()
      return
    }
    attempt += 1
    phase = NetPhase.RECONNECTING
    console.info(
      `[net] reconnecting to "${game}" in ${delay} ms (attempt ${attempt}/${NET_RECONNECT_DELAYS_MS.length})`
    )
    publish()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      openSocket(JoinIntent.JOIN)
    }, delay)
  }

  let ws: WebSocket // the CURRENT socket; handlers of a superseded one check identity and bail
  const openSocket = (joinAs: JoinIntent): void => {
    const url = `${wsBase()}/ws?game=${encodeURIComponent(game)}&name=${encodeURIComponent(name)}&intent=${encodeURIComponent(joinAs)}`
    const socket = new WebSocket(url)
    ws = socket
    socket.onmessage = (event) => {
      if (socket !== ws) return
      const message = decodeServer(typeof event.data === 'string' ? event.data : '')
      if (!message) return
      if (message.t === MsgType.WELCOME) {
        selfId = message.selfId
        phase = NetPhase.PLAYING
        welcomed = true
        attempt = 0
        error = undefined // a stale outage reason must not resurface on the next real drop
        lastSnapshotMs = Date.now()
        if (message.reclaimed) reclaims += 1
        console.info(`[net] welcome — ship #${message.selfId}${message.reclaimed ? ' (seat reclaimed)' : ''}`)
        publish()
      } else if (message.t === MsgType.SNAPSHOT) {
        world = message.world
        players = message.players
        lastSnapshotMs = Date.now()
        // Benched seats ride players[] too, so a disconnected pilot's troopers keep their color.
        paletteSlots = new Map(players.map((p) => [p.id, clampSlot(p.palette)]))
        feed = updateFeed(feed, message.events, players, Date.now())
        // The wire carries no particles (cosmetic); spawn a wreck explosion at each death here,
        // in the victim's seat color.
        for (const event of message.events) {
          const slot = paletteSlots.get(event.victimId)
          const color = slot === undefined ? Color.ENEMY : (PLAYER_PALETTE[slot] ?? Color.ENEMY)
          spawnExplosion(fxParticles, event.x, event.y, color, fxRng, 34)
        }
        publish()
      } else if (message.t === MsgType.REJECTED) {
        if (phase === NetPhase.RECONNECTING && message.reason === NAME_TAKEN_REASON) {
          // The stale-socket race: the server hasn't benched the dropped seat yet. This socket
          // is about to close — onclose retries through the remaining backoff schedule.
          console.info('[net] seat still held by the stale socket — retrying')
          return
        }
        error = message.reason
        phase = NetPhase.DISCONNECTED
        publish()
      }
    }
    socket.onclose = () => {
      if (socket !== ws || leaving || phase === NetPhase.DISCONNECTED) return
      console.info('[net] socket closed')
      if (!welcomed) {
        // The very first dial failed — that's a refusal, not an outage to ride out.
        phase = NetPhase.DISCONNECTED
        if (!error) error = 'Connection lost'
        publish()
        return
      }
      scheduleReconnect()
    }
    socket.onerror = () => {
      if (socket === ws && !welcomed && !error) error = 'Could not reach the game server'
    }
  }
  openSocket(intent)

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
    // Connection-quality housekeeping each frame: the stall chip and kill-feed expiry are
    // clock-driven (no message arrives to trigger them); publish()'s signature compare keeps
    // the per-frame call from churning React.
    const nowMs = Date.now()
    stalled = phase === NetPhase.PLAYING && nowMs - lastSnapshotMs > NET_SNAPSHOT_STALL_MS
    if (feed.some((entry) => entry.until <= nowMs)) feed = feed.filter((entry) => entry.until > nowMs)
    publish()
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
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
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
