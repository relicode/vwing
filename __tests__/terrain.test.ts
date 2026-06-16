import { describe, expect, test } from 'bun:test'

import { circleRectContact, closestPointOnRect, segmentIntersectsRect } from '$/game/collision'
import { CRASH_SPEED, GRAVITY, LAND_SPEED, ShipKind, StructureType, Surface, WeaponKind } from '$/game/constants'
import { resolveShipTerrain } from '$/game/terrain'
import type { Block, Ship } from '$/game/types'

const makeShip = (over: Partial<Ship>): Ship => ({
  id: 0,
  kind: ShipKind.PLAYER,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  angle: 0,
  radius: 12,
  thrusting: false,
  reversing: false,
  fireCooldown: 0,
  invuln: 0,
  health: 100,
  shields: 50,
  weapon: WeaponKind.SCATTERGUN,
  charge: 100,
  altCooldown: 0,
  disabled: 0,
  troops: 0,
  squad: WeaponKind.GRENADE,
  deployCooldown: 0,
  ...over,
})

// A 200×100 platform; its top edge is y = 100. Friction is driven by the surface; structure
// defaults to destructible EARTH (pass METAL for the indestructible equivalent of old bedrock).
const platform = (surface: Surface, structure: StructureType = StructureType.EARTH): Block => ({
  x: 0,
  y: 100,
  w: 200,
  h: 100,
  structure,
  surface,
})

describe('closestPointOnRect', () => {
  test('returns the point itself when inside, and clamps when outside', () => {
    expect(closestPointOnRect(50, 150, 0, 100, 200, 100)).toEqual({ x: 50, y: 150 })
    expect(closestPointOnRect(-30, 150, 0, 100, 200, 100)).toEqual({ x: 0, y: 150 })
    expect(closestPointOnRect(50, 40, 0, 100, 200, 100)).toEqual({ x: 50, y: 100 })
  })
})

describe('circleRectContact', () => {
  test('no contact when the circle is clear of the rect', () => {
    expect(circleRectContact(50, 50, 12, 0, 100, 200, 100)).toBeUndefined()
  })

  test('contact from above gives an upward normal and the penetration depth', () => {
    const c = circleRectContact(50, 92, 12, 0, 100, 200, 100) // bottom of circle 4px into the top
    expect(c).toBeDefined()
    expect(c?.nx).toBeCloseTo(0)
    expect(c?.ny).toBeCloseTo(-1)
    expect(c?.depth).toBeCloseTo(4)
  })

  test('a center inside the rect escapes along the least-penetration axis', () => {
    const c = circleRectContact(20, 110, 12, 0, 100, 200, 100) // nearest edge is the top
    expect(c?.ny).toBeCloseTo(-1)
    expect(c?.depth).toBeCloseTo(12 + 10)
  })
})

describe('segmentIntersectsRect', () => {
  // rect spans x 0..200, y 100..200
  test('true when the segment crosses the rect', () => {
    expect(segmentIntersectsRect(-50, 150, 250, 150, 0, 100, 200, 100)).toBe(true)
  })

  test('false when the segment passes clear of the rect', () => {
    expect(segmentIntersectsRect(-50, 50, 250, 50, 0, 100, 200, 100)).toBe(false) // runs above it
  })

  test('true when an endpoint sits inside the rect', () => {
    expect(segmentIntersectsRect(100, 150, 400, 150, 0, 100, 200, 100)).toBe(true)
  })

  test('false when the segment stops short of the rect', () => {
    expect(segmentIntersectsRect(-100, 150, -50, 150, 0, 100, 200, 100)).toBe(false)
  })
})

describe('resolveShipTerrain', () => {
  test('a gentle descent lands: ship rests on the surface with no normal velocity', () => {
    const ship = makeShip({ x: 100, y: 92, vy: 50 }) // impact 50 < LAND_SPEED
    const result = resolveShipTerrain(ship, [platform(Surface.GRASS)], 0.1)
    expect(result.result).toBe('land')
    expect(ship.y).toBeCloseTo(88) // pushed out: center = top - radius
    expect(ship.vy).toBeCloseTo(0)
  })

  test('a middling impact bounces back off the surface', () => {
    const ship = makeShip({ x: 100, y: 92, vy: 200 }) // LAND_SPEED < 200 < CRASH_SPEED
    const result = resolveShipTerrain(ship, [platform(Surface.EARTH)], 0.1)
    expect(result.result).toBe('bounce')
    expect(result.impact).toBeCloseTo(200) // closing speed reported for the sim's wall-dent damage
    expect(ship.vy).toBeLessThan(0) // reversed
  })

  test('a hard impact crashes', () => {
    const ship = makeShip({ x: 100, y: 92, vy: CRASH_SPEED + 10 })
    expect(resolveShipTerrain(ship, [platform(Surface.EARTH, StructureType.METAL)], 0.1).result).toBe('crash')
  })

  test('ice keeps far more sliding speed than grass', () => {
    const onIce = makeShip({ x: 100, y: 92, vx: 100, vy: 10 })
    const onGrass = makeShip({ x: 100, y: 92, vx: 100, vy: 10 })
    resolveShipTerrain(onIce, [platform(Surface.ICE)], 0.1)
    resolveShipTerrain(onGrass, [platform(Surface.GRASS)], 0.1)
    expect(onIce.vx).toBeGreaterThan(onGrass.vx)
    expect(onGrass.vx).toBeLessThan(100) // grass actually grips
  })

  test('a ship under gravity settles on a block and stays put', () => {
    const block = platform(Surface.EARTH)
    const ship = makeShip({ x: 100, y: 88 }) // already resting on the top
    const dt = 1 / 60
    for (let i = 0; i < 180; i += 1) {
      ship.vy += GRAVITY * dt
      ship.y += ship.vy * dt
      resolveShipTerrain(ship, [block], dt)
    }
    expect(ship.y).toBeGreaterThan(86)
    expect(ship.y).toBeLessThan(90)
    expect(Math.abs(ship.vy)).toBeLessThan(LAND_SPEED)
  })

  test('no contact returns "none" and leaves the ship untouched', () => {
    const ship = makeShip({ x: 100, y: 0, vy: 5 })
    expect(resolveShipTerrain(ship, [platform(Surface.EARTH)], 0.1).result).toBe('none')
    expect(ship.y).toBe(0)
  })
})
