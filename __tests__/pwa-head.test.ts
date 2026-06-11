import { describe, expect, test } from 'bun:test'

import { buildHeadTags, buildJsonLd, injectHead } from '../scripts/pwa/head'
import { resolveSiteBase } from '../scripts/pwa/identity'

const SITE = resolveSiteBase('https://example.test/game/')
const SHELL = '<!doctype html><html><head><title>V-Wing</title></head><body></body></html>'

describe('buildHeadTags', () => {
  const tags = buildHeadTags(SITE)

  test('links the PWA surface absolute against the site base', () => {
    expect(tags).toContain('<link rel="manifest" href="https://example.test/game/manifest.webmanifest">')
    expect(tags).toContain('<link rel="canonical" href="https://example.test/game/">')
    expect(tags).toContain('<meta name="theme-color" content="#04060c">')
    expect(tags).toContain('apple-touch-icon')
  })

  test('carries the share/unfurl pair: Open Graph + Twitter card', () => {
    expect(tags).toContain('<meta property="og:url" content="https://example.test/game/">')
    expect(tags).toContain('<meta property="og:image" content="https://example.test/game/og-image.png">')
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(tags).toContain('<meta name="twitter:image" content="https://example.test/game/og-image.png">')
  })

  test('escapes attribute values', () => {
    // The em-dash title passes through; the guarantee that matters is no raw quotes/angles
    // survive in any injected attribute value.
    for (const match of tags.matchAll(/content="([^"]*)"/g)) {
      expect(match[1]).not.toContain('<')
      expect(match[1]).not.toContain('>')
    }
  })
})

describe('buildJsonLd', () => {
  test('parses back as schema.org VideoGame with absolute URLs', () => {
    const jsonLd = JSON.parse(buildJsonLd(SITE)) as Record<string, unknown>
    expect(jsonLd['@type']).toBe('VideoGame')
    expect(jsonLd.url).toBe('https://example.test/game/')
    expect(jsonLd.image).toBe('https://example.test/game/og-image.png')
    expect(jsonLd.playMode).toEqual(['SinglePlayer', 'MultiPlayer'])
  })

  test('cannot break out of an inline script block', () => {
    expect(buildJsonLd(SITE)).not.toContain('<')
  })
})

describe('injectHead', () => {
  test('injects the block right before </head>', () => {
    const html = injectHead(SHELL, SITE)
    expect(html.indexOf('rel="manifest"')).toBeGreaterThan(html.indexOf('<title>'))
    expect(html.indexOf('rel="manifest"')).toBeLessThan(html.indexOf('</head>'))
    expect(html).toContain('application/ld+json')
  })

  test('refuses a document without a head or with tags already present', () => {
    expect(() => injectHead('<html><body></body></html>', SITE)).toThrow()
    expect(() => injectHead(injectHead(SHELL, SITE), SITE)).toThrow()
  })
})
