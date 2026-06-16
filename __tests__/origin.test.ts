import { afterEach, describe, expect, test } from 'bun:test'

import { NET_DEFAULT_PORT } from '$/game/constants'
import { serverOrigin, wsBase } from '$/net/origin'

// serverOrigin()/wsBase() decide which host:port the browser dials for the lobby + the /ws
// socket — connectivity-critical, and easy to silently break (the NODE_ENV branch is what makes
// a Traefik-only deployment work). These tests stub the browser globals the functions read.

type Loc = { protocol: string; hostname: string; origin: string; search: string }

const setLocation = (loc: Partial<Loc>): void => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost', search: '', ...loc },
  })
}

const setStored = (value: string | undefined): void => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => (key === 'vwing.server' && value !== undefined ? value : null) },
  })
}

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  // @ts-expect-error — clearing the test stubs off the global
  delete globalThis.location
  // @ts-expect-error — clearing the test stubs off the global
  delete globalThis.localStorage
})

describe('serverOrigin', () => {
  test('dev split: crosses to the game-server port on the current host', () => {
    process.env.NODE_ENV = 'development'
    setLocation({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:3110', search: '' })
    setStored(undefined)
    expect(serverOrigin()).toBe(`http://localhost:${NET_DEFAULT_PORT}`)
  })

  test('production: same origin (so Traefik can carry it)', () => {
    process.env.NODE_ENV = 'production'
    setLocation({ origin: 'http://play.example.com', search: '' })
    setStored(undefined)
    expect(serverOrigin()).toBe('http://play.example.com')
  })

  test('production over https: keeps the secure origin', () => {
    process.env.NODE_ENV = 'production'
    setLocation({ protocol: 'https:', hostname: 'play.example.com', origin: 'https://play.example.com', search: '' })
    setStored(undefined)
    expect(serverOrigin()).toBe('https://play.example.com')
  })

  test('?server= override wins over everything', () => {
    process.env.NODE_ENV = 'production'
    setLocation({ origin: 'http://play.example.com', search: '?server=http://other:9000' })
    setStored(undefined)
    expect(serverOrigin()).toBe('http://other:9000')
  })

  test('stored override wins when no query param', () => {
    process.env.NODE_ENV = 'development'
    setLocation({ origin: 'http://localhost:3110', search: '' })
    setStored('http://stored:9001')
    expect(serverOrigin()).toBe('http://stored:9001')
  })
})

describe('wsBase', () => {
  test('http origin → ws://', () => {
    process.env.NODE_ENV = 'production'
    setLocation({ origin: 'http://play.example.com', search: '' })
    setStored(undefined)
    expect(wsBase()).toBe('ws://play.example.com')
  })

  test('https origin → wss://', () => {
    process.env.NODE_ENV = 'production'
    setLocation({ protocol: 'https:', hostname: 'play.example.com', origin: 'https://play.example.com', search: '' })
    setStored(undefined)
    expect(wsBase()).toBe('wss://play.example.com')
  })
})
