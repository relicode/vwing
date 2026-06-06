import { describe, expect, test } from 'bun:test'

import { createRng, pick, randInt, randRange } from '$/game/rng'

describe('createRng', () => {
  test('is deterministic for a given seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  test('returns values in [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 1000; i += 1) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  test('different seeds diverge', () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })
})

describe('randInt / randRange / pick', () => {
  test('randInt stays within [min, max)', () => {
    const rng = createRng(99)
    for (let i = 0; i < 500; i += 1) {
      const value = randInt(rng, 3, 7)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThan(7)
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  test('randRange stays within [min, max)', () => {
    const rng = createRng(5)
    for (let i = 0; i < 500; i += 1) {
      const value = randRange(rng, -2, 2)
      expect(value).toBeGreaterThanOrEqual(-2)
      expect(value).toBeLessThan(2)
    }
  })

  test('pick returns an element of the array', () => {
    const rng = createRng(42)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 50; i += 1) expect(items).toContain(pick(rng, items))
  })
})
