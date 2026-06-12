import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'

import { renderIcon, renderShareImage } from '../scripts/pwa/artwork'
import { encodePng } from '../scripts/pwa/png'

// Pull width/height back out of IHDR and the raw scanline bytes out of IDAT so the
// tests prove the files are decodable, not just signed.
const decodeHeader = (png: Uint8Array): { width: number; height: number } => {
  const view = new DataView(png.buffer, png.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('encodePng', () => {
  test('emits a decodable RGBA png', () => {
    const rgba = new Uint8Array(2 * 3 * 4).fill(128)
    const png = encodePng(2, 3, rgba)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(decodeHeader(png)).toEqual({ width: 2, height: 3 })
    const idatStart = png.findIndex(
      (_, i) => png[i] === 0x49 && png[i + 1] === 0x44 && png[i + 2] === 0x41 && png[i + 3] === 0x54
    )
    const view = new DataView(png.buffer, png.byteOffset)
    const idatLength = view.getUint32(idatStart - 4)
    const raw = inflateSync(png.subarray(idatStart + 4, idatStart + 4 + idatLength))
    expect(raw.length).toBe(3 * (1 + 2 * 4)) // filter byte + RGBA per scanline
  })

  test('rejects a buffer that disagrees with the dimensions', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow()
  })
})

describe('icon and share artwork', () => {
  test('icons decode to their nominal square size and bake deterministically', () => {
    const icon = renderIcon(48)
    expect(decodeHeader(icon)).toEqual({ width: 48, height: 48 })
    expect(renderIcon(48)).toEqual(icon)
  })

  test('maskable variant differs from the full-bleed art (ship pulled into the safe zone)', () => {
    expect(renderIcon(48, { maskable: true })).not.toEqual(renderIcon(48))
  })

  test('share image decodes at the requested aspect', () => {
    expect(decodeHeader(renderShareImage(120, 63))).toEqual({ width: 120, height: 63 })
  })
})
