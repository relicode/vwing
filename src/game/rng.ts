import type { Rng } from '$/game/types'

// mulberry32 — small, fast, deterministic. State is captured in the closure,
// never module-level, so each game owns an independent stream.
export const createRng = (seed: number): Rng => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randRange = (rng: Rng, min: number, max: number): number => min + rng() * (max - min)

export const randInt = (rng: Rng, minInclusive: number, maxExclusive: number): number =>
  Math.floor(randRange(rng, minInclusive, maxExclusive))

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[randInt(rng, 0, items.length)]
