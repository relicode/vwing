import type { AsteroidSize, GamePhase } from '$/game/constants'

export type Vec2 = { x: number; y: number }

// A seeded pseudo-random generator returning a float in [0, 1).
export type Rng = () => number

// A Newtonian body the player flies. PvP-ready: the world holds a list of ships.
export type Ship = {
  x: number
  y: number
  vx: number
  vy: number
  angle: number // heading in radians; forward = (cos, sin)
  radius: number
  thrusting: boolean // drives the engine-flame render
  fireCooldown: number // s until the next shot is allowed
  invuln: number // s of remaining spawn invulnerability
}

export type Bullet = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  life: number // s remaining
}

export type Asteroid = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  size: AsteroidSize
  angle: number // current visual rotation
  spin: number // rad/s
  verts: number[] // per-vertex radius multipliers for the rough outline
}

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number // s remaining
  maxLife: number
  size: number
  color: number
}

// The full mutable simulation. Owned by the engine closure (never module-level).
export type World = {
  time: number // s elapsed in the current run
  wave: number
  ship: Ship
  bullets: Bullet[]
  asteroids: Asteroid[]
  particles: Particle[]
  rng: Rng
}

// HUD-facing snapshot the React shell subscribes to.
export type EngineStatus = {
  phase: GamePhase
  score: number
  best: number
  lives: number
  wave: number
}
