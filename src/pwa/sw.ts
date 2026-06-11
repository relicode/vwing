// V-Wing service worker — bundled standalone by scripts/build.ts, which injects the
// precache manifest and version via `define` (the two declares below). Hand-rolled rather
// than Workbox because the precache list comes from our own Bun build, and the runtime
// policy fits in a page: versioned precache of the app shell, network-first navigations
// with an offline shell fallback, and a small runtime cache for the Google Fonts pair.
// Updates take over silently (skipWaiting + clients.claim) but never force a reload —
// nobody loses a dogfight to a deploy; the new build lands on the next launch.

declare const __PRECACHE_URLS__: string[]
declare const __CACHE_VERSION__: string

// tsconfig lib is dom (the page side) and bun-types owns the bare FetchEvent name, so the
// worker globals are typed locally — just the surface this file touches, Sw-prefixed.
type SwExtendableEvent = Event & { waitUntil(work: Promise<unknown>): void }
type SwFetchEvent = SwExtendableEvent & { request: Request; respondWith(response: Promise<Response> | Response): void }
type SwGlobal = {
  location: Location
  addEventListener(type: 'install' | 'activate', listener: (event: SwExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
}

const sw = self as unknown as SwGlobal

const PRECACHE = `vwing-precache-${__CACHE_VERSION__}`
const FONT_CACHE = 'vwing-fonts'
const FONT_CACHE_LIMIT = 32
const PRECACHED = new Set(__PRECACHE_URLS__.map((url) => new URL(url, sw.location.href).href))
const SHELL_URL = new URL('index.html', sw.location.href).href

const install = async (): Promise<void> => {
  const cache = await caches.open(PRECACHE)
  // cache: 'reload' bypasses the HTTP cache so a stale CDN/browser entry can never
  // be enshrined as the new version's shell.
  await cache.addAll([...PRECACHED].map((href) => new Request(href, { cache: 'reload' })))
  await sw.skipWaiting()
}

const activate = async (): Promise<void> => {
  const keys = await caches.keys()
  await Promise.all(
    keys.filter((key) => key.startsWith('vwing-precache-') && key !== PRECACHE).map((key) => caches.delete(key))
  )
  await sw.clients.claim()
}

sw.addEventListener('install', (event) => event.waitUntil(install()))
sw.addEventListener('activate', (event) => event.waitUntil(activate()))

// The Fonts stylesheet <link> carries no crossorigin attribute, so its request mode is
// no-cors and the response is opaque: status 0, ok false — but still perfectly cacheable
// and servable. Anything else (4xx/5xx/partial) stays out of the caches.
const storable = (response: Response): boolean => response.ok || response.type === 'opaque'

// Drop the oldest entries once the runtime cache outgrows its cap (Cache keys() returns
// insertion order). The font pair is small but unversioned — without this it grows forever.
const trim = async (cache: Cache): Promise<void> => {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - FONT_CACHE_LIMIT)).map((key) => cache.delete(key)))
}

const offlineShell = async (): Promise<Response> =>
  (await caches.match(SHELL_URL)) ?? new Response('V-Wing is offline.', { status: 503 })

const networkFirst = async (request: Request): Promise<Response> => {
  try {
    return await fetch(request)
  } catch {
    return offlineShell()
  }
}

const cacheFirst = async (request: Request, cacheName: string): Promise<Response> => {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (storable(response)) {
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
    if (cacheName === FONT_CACHE) await trim(cache)
  }
  return response
}

// Serve the cached copy immediately but refresh it in the background (the Fonts CSS can
// change per user agent, so it should not be pinned forever like the woff2 binaries).
const staleWhileRevalidate = async (request: Request, cacheName: string): Promise<Response> => {
  const cache = await caches.open(cacheName)
  const refresh = fetch(request).then(async (response) => {
    if (storable(response)) {
      await cache.put(request, response.clone())
      await trim(cache)
    }
    return response
  })
  const cached = await cache.match(request)
  if (cached) {
    refresh.catch(() => undefined) // offline refresh failing is the expected case
    return cached
  }
  return refresh
}

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  if (PRECACHED.has(url.href)) {
    event.respondWith(cacheFirst(request, PRECACHE))
    return
  }
  if (url.hostname === 'fonts.gstatic.com') event.respondWith(cacheFirst(request, FONT_CACHE))
  else if (url.hostname === 'fonts.googleapis.com') event.respondWith(staleWhileRevalidate(request, FONT_CACHE))
})
