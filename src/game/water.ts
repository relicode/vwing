import { clamp } from '$/game/math'
import type { Ship, WaterBody } from '$/game/types'

// The water body whose horizontal span contains `x` (bodies don't overlap).
const bodyAt = (water: WaterBody[], x: number): WaterBody | undefined =>
  water.find((body) => x >= body.x && x <= body.x + body.w)

// Surface (top) y of the water body at `x`, or undefined if there's no water there.
export const waterSurfaceAt = (water: WaterBody[], x: number): number | undefined => bodyAt(water, x)?.y

// How submerged a ship is, 0 (dry / above the surface) .. 1 (fully under).
export const submersion = (ship: Ship, water: WaterBody[]): number => {
  const body = bodyAt(water, ship.x)
  if (!body) return 0
  const depth = clamp(ship.y + ship.radius - body.y, 0, ship.radius * 2)
  return depth / (ship.radius * 2)
}
