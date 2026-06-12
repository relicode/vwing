import { describe, expect, test } from 'bun:test'

import { NET_FEED_MAX, NET_FEED_TTL, NET_RECONNECT_DELAYS_MS, ShipKind } from '$/game/constants'
import type { DeathEvent } from '$/game/sim'
import { type FeedEntry, feedText, reconnectDelay, updateFeed } from '$/net/feed'
import type { PlayerInfo } from '$/net/protocol'

const player = (id: number, name: string, palette: number, connected = true): PlayerInfo => ({
  id,
  name,
  score: 0,
  palette,
  respawnIn: 0,
  connected,
})

const death = (victimId: number, killerId?: number): DeathEvent => ({
  victimId,
  victimKind: ShipKind.PLAYER,
  killerId,
  eliminated: false,
  x: 0,
  y: 0,
})

describe('updateFeed', () => {
  const players = [player(0, 'Ace', 0), player(1, 'Maverick', 1, false), player(2, 'Goose', 2)]

  test('narrates kills and environmental crashes, resolving names incl. benched seats', () => {
    const feed = updateFeed([], [death(1, 0), death(2)], players, 1000)
    expect(feed).toHaveLength(2)
    expect(feedText(feed[0])).toBe('Ace downed Maverick') // the victim is BENCHED — still named + tinted
    expect(feed[0].killer?.palette).toBe(0)
    expect(feed[0].victim.palette).toBe(1)
    expect(feedText(feed[1])).toBe('Goose crashed')
    expect(feed[1].killer).toBeUndefined()
    expect(feed.every((entry) => entry.until === 1000 + NET_FEED_TTL * 1000)).toBe(true)
  })

  test('an unknown id gets a readable placeholder', () => {
    const feed = updateFeed([], [death(9)], players, 0)
    expect(feedText(feed[0])).toBe('Pilot #9 crashed')
  })

  test('caps at NET_FEED_MAX (oldest dropped) with monotonic ids, newest last', () => {
    let feed: FeedEntry[] = []
    for (let i = 0; i < NET_FEED_MAX + 3; i += 1) feed = updateFeed(feed, [death(0)], players, i)
    expect(feed).toHaveLength(NET_FEED_MAX)
    const ids = feed.map((entry) => entry.id)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids) // newest last
    expect(new Set(ids).size).toBe(ids.length) // React keys stay unique across the cap
  })

  test('expired lines drop on the next update', () => {
    const feed = updateFeed([], [death(0)], players, 0)
    expect(updateFeed(feed, [], players, NET_FEED_TTL * 1000 + 1)).toHaveLength(0)
  })
})

describe('reconnectDelay', () => {
  test('yields the backoff schedule, then undefined (give up)', () => {
    expect(NET_RECONNECT_DELAYS_MS.map((_, attempt) => reconnectDelay(attempt))).toEqual([...NET_RECONNECT_DELAYS_MS])
    expect(reconnectDelay(NET_RECONNECT_DELAYS_MS.length)).toBeUndefined()
  })
})
