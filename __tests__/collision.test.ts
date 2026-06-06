import { describe, expect, test } from 'bun:test'

import { circlesOverlap } from '$/game/collision'

describe('circlesOverlap', () => {
  test('overlapping circles report true', () => {
    expect(circlesOverlap(0, 0, 5, 3, 0, 5)).toBe(true)
  })

  test('exactly touching circles count as overlap', () => {
    expect(circlesOverlap(0, 0, 5, 10, 0, 5)).toBe(true)
  })

  test('separated circles report false', () => {
    expect(circlesOverlap(0, 0, 5, 11, 0, 5)).toBe(false)
  })

  test('handles diagonal placement', () => {
    expect(circlesOverlap(0, 0, 5, 3, 3, 2)).toBe(true)
    expect(circlesOverlap(0, 0, 1, 5, 5, 1)).toBe(false)
  })
})
