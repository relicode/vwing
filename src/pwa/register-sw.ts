// Registers the production service worker (dist/sw.js, emitted by scripts/build.ts).
// Production-only: the dev server neither builds nor serves a worker, and the bundler
// inlines NODE_ENV so the whole body falls away from dev bundles. Registration resolves
// 'sw.js' against the document base, so the worker scopes to wherever the build is
// deployed (e.g. /vwing/ on kapsi) without knowing the path.

export const registerServiceWorker = (): void => {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      // updateViaCache: 'none' so a long-cached sw.js can never wedge an old build in place.
      .register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' })
      .catch((error) => console.warn('V-Wing service worker registration failed', error))
  })
}
