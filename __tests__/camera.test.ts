import { describe, expect, test } from 'bun:test'

import { cameraOrigin } from '$/game/camera'
import { VIEW_HEIGHT, VIEW_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'

describe('cameraOrigin', () => {
  test('centers on a target in open space', () => {
    const origin = cameraOrigin({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 })
    expect(origin.x).toBeCloseTo(WORLD_WIDTH / 2 - VIEW_WIDTH / 2)
    expect(origin.y).toBeCloseTo(WORLD_HEIGHT / 2 - VIEW_HEIGHT / 2)
  })

  test('clamps at the near corner so no void shows', () => {
    const origin = cameraOrigin({ x: 0, y: 0 })
    expect(origin.x).toBe(0)
    expect(origin.y).toBe(0)
  })

  test('clamps at the far corner', () => {
    const origin = cameraOrigin({ x: WORLD_WIDTH, y: WORLD_HEIGHT })
    expect(origin.x).toBeCloseTo(WORLD_WIDTH - VIEW_WIDTH)
    expect(origin.y).toBeCloseTo(WORLD_HEIGHT - VIEW_HEIGHT)
  })
})
