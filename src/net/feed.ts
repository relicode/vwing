import { NET_FEED_MAX, NET_FEED_TTL, NET_RECONNECT_DELAYS_MS } from '$/game/constants'
import type { DeathEvent } from '$/game/sim'
import type { PlayerInfo } from '$/net/protocol'

// The kill feed, built purely from what is already on the wire: this tick's DeathEvents plus
// the players[] roster (benched seats included, so a disconnected victim still has a name and a
// color). Pixi-free on purpose — the HUD renders it, the tests pin it headlessly.

export type FeedSide = { name: string; palette: number }

export type FeedEntry = {
  id: number // monotonic per client (the React key)
  killer: FeedSide | undefined // undefined = an environmental death (terrain / wall)
  victim: FeedSide
  until: number // ms timestamp the line expires at
}

const sideOf = (id: number, players: PlayerInfo[]): FeedSide => {
  const player = players.find((p) => p.id === id)
  return { name: player?.name ?? `Pilot #${id}`, palette: player?.palette ?? 1 }
}

// The line's plain phrasing (the HUD tints the names; tests pin the words).
export const feedText = (entry: FeedEntry): string =>
  entry.killer ? `${entry.killer.name} downed ${entry.victim.name}` : `${entry.victim.name} crashed`

// Fold this tick's deaths into the rolling feed: expired lines drop, new lines append newest-
// last, and the feed keeps at most NET_FEED_MAX lines (oldest forgotten first).
export const updateFeed = (
  feed: FeedEntry[],
  events: DeathEvent[],
  players: PlayerInfo[],
  now: number
): FeedEntry[] => {
  let nextId = feed.reduce((max, entry) => Math.max(max, entry.id), -1) + 1
  const next = feed.filter((entry) => entry.until > now)
  for (const event of events) {
    next.push({
      id: nextId++,
      killer: event.killerId === undefined ? undefined : sideOf(event.killerId, players),
      victim: sideOf(event.victimId, players),
      until: now + NET_FEED_TTL * 1000,
    })
  }
  return next.slice(-NET_FEED_MAX)
}

// The reconnect backoff: delay (ms) before re-dial number `attempt` (0-based), or undefined
// once the schedule is exhausted — the outage is then reported as a real disconnect.
export const reconnectDelay = (attempt: number): number | undefined => NET_RECONNECT_DELAYS_MS[attempt]
