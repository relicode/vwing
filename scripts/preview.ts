// Serves the production bundle from ./dist (run `bun run build` first).

import { join, normalize } from 'node:path'
import { file } from 'bun'

const DIST = join(import.meta.dir, '..', 'dist')
const PORT = Number(Bun.env.PORT ?? 3111)

const server = Bun.serve({
  port: PORT,
  fetch: async (request) => {
    const url = new URL(request.url)
    const relative = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
    const candidate = file(join(DIST, relative === '/' ? 'index.html' : relative))
    if (await candidate.exists()) {
      // Bun's extension table doesn't know .webmanifest; the manifest spec wants this type.
      if (relative.endsWith('.webmanifest'))
        return new Response(candidate, { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } })
      return new Response(candidate)
    }
    // SPA fallback so client routing / deep links resolve to the shell.
    return new Response(file(join(DIST, 'index.html')))
  },
})

console.log(`▶ V-Wing preview on http://localhost:${server.port}`)
