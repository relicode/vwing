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
const PRECACHED = new Set(__PRECACHE_URLS__.map((url) => new URL(url, sw.location.href).href))
const SHELL_URL = new URL('index.html', sw.location.href).href

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      // cache: 'reload' bypasses the HTTP cache so a stale CDN/browser entry can never
      // be enshrined as the new version's shell.
      .then((cache) => cache.addAll([...PRECACHED].map((href) => new Request(href, { cache: 'reload' }))))
      .then(() => sw.skipWaiting())
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('vwing-precache-') && key !== PRECACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => sw.clients.claim())
  )
})

const offlineShell = (): Promise<Response> =>
  caches.match(SHELL_URL).then((cached) => cached ?? new Response('V-Wing is offline.', { status: 503 }))

const cacheFirst = (request: Request, cacheName: string): Promise<Response> =>
  caches.match(request).then(
    (cached) =>
      cached ??
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(cacheName).then((cache) => cache.put(request, copy))
        }
        return response
      })
  )

// Serve the cached copy immediately but refresh it in the background (the Fonts CSS can
// change per user agent, so it should not be pinned forever like the woff2 binaries).
const staleWhileRevalidate = (request: Request, cacheName: string): Promise<Response> =>
  caches.open(cacheName).then((cache) => {
    const refresh = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    return cache.match(request).then((cached) => cached ?? refresh)
  })

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlineShell))
    return
  }
  if (PRECACHED.has(url.href)) {
    event.respondWith(cacheFirst(request, PRECACHE))
    return
  }
  if (url.hostname === 'fonts.gstatic.com') event.respondWith(cacheFirst(request, FONT_CACHE))
  else if (url.hostname === 'fonts.googleapis.com') event.respondWith(staleWhileRevalidate(request, FONT_CACHE))
})
