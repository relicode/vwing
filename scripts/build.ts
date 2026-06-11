// Production build: bundles the web client and layers the PWA on top — baked icons +
// share image, manifest.webmanifest, head metadata (PWA links, Open Graph/Twitter,
// JSON-LD), and a precaching service worker. Fields that need an absolute URL resolve
// against the deploy base: `--site <url>` > $VWING_SITE_URL > the kapsi default.
//
//   bun run build                                    # deploys to https://mccall.kapsi.fi/vwing/
//   bun run build --site http://localhost:3111/      # local preview / PWA QA

import { readdir, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { renderIcon, renderShareImage } from './pwa/artwork'
import { buildHeadTags } from './pwa/head'
import { APPLE_TOUCH_ICON, FAVICON, MANIFEST_ICONS, resolveSiteBase, SHARE_IMAGE, SITE_DEFAULT } from './pwa/identity'
import { buildManifest } from './pwa/manifest'

const ROOT = resolve(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')

const siteArgument = (): string | undefined => {
  const flag = process.argv.findIndex((argument) => argument === '--site' || argument.startsWith('--site='))
  if (flag === -1) return undefined
  const inline = process.argv[flag].split('=')[1]
  const value = inline ?? process.argv[flag + 1]
  if (!value) throw new Error('--site needs a URL argument')
  return value
}

const fail = (stage: string, logs: ReadonlyArray<{ toString(): string }>): never => {
  console.error(`✗ ${stage} failed`)
  for (const log of logs) console.error(String(log))
  process.exit(1)
}

const site = resolveSiteBase(siteArgument() ?? Bun.env.VWING_SITE_URL ?? SITE_DEFAULT)

await rm(DIST, { recursive: true, force: true })

// 1. The app bundle (same shape the old inline `bun build` CLI invocation produced).
const app = await Bun.build({
  entrypoints: [join(ROOT, 'src/index.html')],
  outdir: DIST,
  minify: true,
  sourcemap: 'linked',
  naming: { asset: '[name]-[hash].[ext]' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
if (!app.success) fail('app bundle', app.logs)

// 2. Icons + share card, then the manifest that points at them.
const icons: Array<[string, Uint8Array]> = [
  ...MANIFEST_ICONS.map((icon): [string, Uint8Array] => [
    icon.file,
    renderIcon(icon.size, { maskable: icon.purpose === 'maskable' }),
  ]),
  [APPLE_TOUCH_ICON.file, renderIcon(APPLE_TOUCH_ICON.size)],
  [FAVICON.file, renderIcon(FAVICON.size)],
  [SHARE_IMAGE.file, renderShareImage(SHARE_IMAGE.width, SHARE_IMAGE.height)],
]
await Promise.all(icons.map(([file, bytes]) => Bun.write(join(DIST, file), bytes)))
await Bun.write(join(DIST, 'manifest.webmanifest'), `${JSON.stringify(buildManifest(site), undefined, 2)}\n`)

// 3. Head metadata into the built shell.
const shellPath = join(DIST, 'index.html')
const shell = await Bun.file(shellPath).text()
if (!shell.includes('</head>')) throw new Error('dist/index.html has no </head> to inject into')
await Bun.write(shellPath, shell.replace('</head>', `${buildHeadTags(site)}</head>`))

// 4. Service worker, last: its precache list is everything now in dist except sourcemaps
// (debugging aids) and the share card (scraper-only). Cache version = content hash of the lot.
const entries = (await readdir(DIST, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(DIST, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .filter((path) => path !== 'sw.js' && path !== SHARE_IMAGE.file && !path.endsWith('.map'))
  .sort()
const hasher = new Bun.CryptoHasher('sha256')
for (const path of entries) hasher.update(path).update(await Bun.file(join(DIST, path)).arrayBuffer())
const version = hasher.digest('hex').slice(0, 12)

const worker = await Bun.build({
  entrypoints: [join(ROOT, 'src/pwa/sw.ts')],
  outdir: DIST,
  minify: true,
  define: {
    __PRECACHE_URLS__: JSON.stringify(entries),
    __CACHE_VERSION__: JSON.stringify(version),
  },
})
if (!worker.success) fail('service worker bundle', worker.logs)

console.log(`✓ built ${entries.length + 2} files for ${site} (precache ${version})`)
