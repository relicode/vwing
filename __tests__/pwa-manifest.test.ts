import { describe, expect, test } from 'bun:test'

import { absoluteUrl, resolveSiteBase, SITE_DEFAULT } from '../scripts/pwa/identity'
import { buildManifest } from '../scripts/pwa/manifest'

describe('resolveSiteBase', () => {
  test('keeps a canonical base intact', () => {
    expect(resolveSiteBase(SITE_DEFAULT)).toBe('https://mccall.kapsi.fi/vwing/')
  })

  test('appends the trailing slash a scope needs', () => {
    expect(resolveSiteBase('https://mccall.kapsi.fi/vwing')).toBe('https://mccall.kapsi.fi/vwing/')
  })

  test('drops query and fragment', () => {
    expect(resolveSiteBase('http://localhost:3111/?utm=x#y')).toBe('http://localhost:3111/')
  })

  test('rejects non-http schemes and non-URLs', () => {
    expect(() => resolveSiteBase('ftp://example.com/')).toThrow()
    expect(() => resolveSiteBase('not a url')).toThrow()
  })
})

describe('buildManifest', () => {
  const site = resolveSiteBase('https://example.test/game')
  const manifest = buildManifest(site)

  test('resolves the URL-valued fields absolute against the site base', () => {
    expect(manifest.id).toBe('https://example.test/game/')
    expect(manifest.start_url).toBe('https://example.test/game/')
    expect(manifest.scope).toBe('https://example.test/game/')
    const icons = manifest.icons as Array<{ src: string }>
    for (const icon of icons) expect(icon.src).toStartWith('https://example.test/game/')
  })

  test('meets the installability baseline: 192 + 512 any icons plus a maskable variant', () => {
    const icons = manifest.icons as Array<{ sizes: string; purpose: string; type: string }>
    expect(icons.map((icon) => `${icon.sizes}/${icon.purpose}`)).toEqual([
      '192x192/any',
      '512x512/any',
      '512x512/maskable',
    ])
    for (const icon of icons) expect(icon.type).toBe('image/png')
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBe('V-Wing')
  })

  test('theme and background match the game backdrop', () => {
    expect(manifest.theme_color).toBe('#04060c')
    expect(manifest.background_color).toBe('#04060c')
  })
})

describe('absoluteUrl', () => {
  test('resolves relative artifacts under the base path', () => {
    expect(absoluteUrl('https://example.test/game/', 'sw.js')).toBe('https://example.test/game/sw.js')
  })
})
