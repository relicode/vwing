import {
  WALL_THICKNESS,
  WATER_POOL_CAPACITY,
  WATER_POOL_COUNT,
  WATER_POOL_START_LEVEL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { clamp } from '$/game/math'
import { randRange } from '$/game/rng'
import type { Rng, Ship, WaterPool } from '$/game/types'

const FLOOR_Y = WORLD_HEIGHT - WALL_THICKNESS

// Lay out non-overlapping floor pools, one per evenly-sized segment of the arena.
export const createInitialPools = (rng: Rng): WaterPool[] => {
  const pools: WaterPool[] = []
  const segment = WORLD_WIDTH / WATER_POOL_COUNT
  const width = segment * 0.6
  const slack = segment - width
  for (let i = 0; i < WATER_POOL_COUNT; i += 1) {
    const x = i * segment + randRange(rng, slack * 0.2, slack * 0.8)
    pools.push({ x, width, level: WATER_POOL_START_LEVEL, capacity: WATER_POOL_CAPACITY })
  }
  return pools
}

const poolAt = (pools: WaterPool[], x: number): WaterPool | undefined =>
  pools.find((pool) => x >= pool.x && x <= pool.x + pool.width)

export const surfaceY = (pool: WaterPool): number => FLOOR_Y - pool.level

// How submerged a ship is, 0 (dry / above the surface) .. 1 (fully under).
export const submersion = (ship: Ship, pools: WaterPool[]): number => {
  const pool = poolAt(pools, ship.x)
  if (!pool) return 0
  const depth = clamp(ship.y + ship.radius - surfaceY(pool), 0, ship.radius * 2)
  return depth / (ship.radius * 2)
}

// Water Cannon plumbing: siphon from the pool under `fromX` and deposit under `toX`
// (levels stay within [0, capacity]; spraying onto dry land just drains the source).
export const transferWater = (pools: WaterPool[], fromX: number, toX: number, amount: number): void => {
  const source = poolAt(pools, fromX)
  if (!source) return
  const drained = Math.min(amount, source.level)
  source.level -= drained
  const dest = poolAt(pools, toX)
  if (dest) dest.level = Math.min(dest.capacity, dest.level + drained)
}
