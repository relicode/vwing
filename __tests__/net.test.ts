import { describe, expect, test } from 'bun:test'

import { decodeClient, gameNameKey, livesFromWire, livesToWire, MsgType, sanitizeGameName } from '$/net/protocol'
import { createStore } from '$/server/store'

describe('protocol helpers', () => {
  test('sanitizeGameName keeps a readable slug and caps the length', () => {
    expect(sanitizeGameName('  Hello World  ', 24)).toBe('Hello World')
    expect(sanitizeGameName('drop/these*chars!', 24)).toBe('dropthesechars')
    expect(sanitizeGameName('way too long a name for the cap', 8)).toHaveLength(8)
    expect(sanitizeGameName('   ', 24)).toBe('')
  })

  test('lives round-trip through the wire (Infinity ⇄ null)', () => {
    expect(livesToWire(Number.POSITIVE_INFINITY)).toBeNull()
    expect(livesToWire(3)).toBe(3)
    expect(livesFromWire(null)).toBe(Number.POSITIVE_INFINITY)
    expect(livesFromWire(3)).toBe(3)
  })
})

describe('gameNameKey (internationally-normalized, case-insensitive game identity)', () => {
  test('folds letter case', () => {
    expect(gameNameKey('Arena')).toBe(gameNameKey('arena'))
    expect(gameNameKey('MY GAME')).toBe(gameNameKey('my game'))
  })

  test('collapses Unicode normalization forms (precomposed vs combining)', () => {
    const nfc = 'Café'.normalize('NFC') // "Café" — é as one code point (U+00E9)
    const nfd = 'Café'.normalize('NFD') // "Cafe" + U+0301 combining acute accent
    expect(nfc).not.toBe(nfd) // genuinely different code-point sequences…
    expect(gameNameKey(nfc)).toBe(gameNameKey(nfd)) // …but the same game
  })

  test('collapses compatibility forms via NFKC (fullwidth, ligatures)', () => {
    expect(gameNameKey('ＡＲＥＮＡ')).toBe(gameNameKey('arena')) // fullwidth → ASCII
    expect(gameNameKey('ﬁght')).toBe(gameNameKey('fight')) // ﬁ ligature → "fi"
  })

  test('keeps genuinely different names distinct (diacritics are not stripped)', () => {
    expect(gameNameKey('alpha')).not.toBe(gameNameKey('beta'))
    expect(gameNameKey('café')).not.toBe(gameNameKey('cafe'))
  })
})

describe('sanitizeGameName (international names)', () => {
  test('keeps Unicode letters and normalizes to NFC', () => {
    expect(sanitizeGameName('Café Münch', 24)).toBe('Café Münch'.normalize('NFC'))
    expect(sanitizeGameName('アリーナ', 24)).toBe('アリーナ')
    expect(sanitizeGameName('Café', 24)).toBe('Café'.normalize('NFC')) // NFD input → NFC
  })

  test('still strips punctuation, symbols and control characters', () => {
    expect(sanitizeGameName('drop/these*chars!', 24)).toBe('dropthesechars')
    expect(sanitizeGameName('emoji 🎮 game', 24)).toBe('emoji game') // emoji dropped, spaces collapse
  })
})

describe('store (in-memory fallback)', () => {
  test('persists state and the lobby listing without a Redis server', async () => {
    const store = await createStore('redis://127.0.0.1:1') // nothing listens here → memory fallback
    expect(store.kind).toBe('memory')

    await store.saveState('arena', '{"t":"SNAPSHOT"}')
    expect(await store.loadState('arena')).toBe('{"t":"SNAPSHOT"}')

    await store.registerGame('arena', { players: 2, maxPlayers: 8 })
    expect(await store.listGames()).toEqual([{ name: 'arena', players: 2, maxPlayers: 8 }])

    await store.unregisterGame('arena')
    expect(await store.listGames()).toEqual([])

    await store.deleteState('arena')
    expect(await store.loadState('arena')).toBeUndefined()
    await store.close()
  })
})

describe('decodeClient (hostile-input hardening)', () => {
  const good = JSON.stringify({
    t: MsgType.INPUT,
    input: { turn: 1, thrusting: true, firing: false, altFiring: false },
  })

  test('accepts a well-formed INPUT message', () => {
    expect(decodeClient(good)?.input).toEqual({ turn: 1, thrusting: true, firing: false, altFiring: false })
  })

  test('rejects malformed payloads that would crash the server (regression for the INPUT DoS)', () => {
    expect(decodeClient('{"t":"INPUT"}')).toBeUndefined() // correct tag, missing input → must not pass
    expect(decodeClient('{"t":"INPUT","input":null}')).toBeUndefined()
    expect(decodeClient('{"t":"INPUT","input":"nope"}')).toBeUndefined()
    expect(decodeClient('{"t":"WELCOME"}')).toBeUndefined() // not a client message
    expect(decodeClient('not json at all')).toBeUndefined()
  })
})

describe('message kinds', () => {
  test('the input/welcome/snapshot/rejected discriminants exist', () => {
    expect(MsgType.INPUT).toBe('INPUT' as MsgType)
    expect(MsgType.WELCOME).toBe('WELCOME' as MsgType)
    expect(MsgType.SNAPSHOT).toBe('SNAPSHOT' as MsgType)
    expect(MsgType.REJECTED).toBe('REJECTED' as MsgType)
  })
})
