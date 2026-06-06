// Tunables and shared literals for the V-Wing flight sim (XPilot-style: Newtonian
// thrust, global gravity, inertia). Everything balance-related lives here.

export enum GamePhase {
  TITLE = 'TITLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
}

export enum AsteroidSize {
  LARGE = 'LARGE',
  MEDIUM = 'MEDIUM',
  SMALL = 'SMALL',
}

// Camera viewport (the canvas) and the larger world it pans across.
export const VIEW_WIDTH = 900
export const VIEW_HEIGHT = 600
export const WORLD_WIDTH = 2400
export const WORLD_HEIGHT = 1500
export const WALL_THICKNESS = 26 // lethal border; ships die on contact, rocks bounce

// Neon-on-near-black palette, stored as 0xRRGGBB for PixiJS fills.
export const Color = {
  BACKGROUND: 0x05060d,
  STAR_FAR: 0x2a3566,
  STAR_NEAR: 0x9fb4ff,
  WALL: 0x1b2f6b,
  WALL_EDGE: 0x4f7bff,
  SHIP: 0x8fe3ff,
  SHIP_CORE: 0xffffff,
  THRUST: 0xffb347,
  BULLET: 0xfff27a,
  ASTEROID_FILL: 0x3a3f4d,
  ASTEROID_EDGE: 0xb9c0d0,
  EXPLOSION: 0xffd166,
} as const

// Global gravity: a constant downward pull. Thrust must beat it to climb.
export const GRAVITY = 200 // px/s^2

// Ship flight model.
export const SHIP_RADIUS = 12
export const SHIP_THRUST = 580 // px/s^2 along the nose
export const SHIP_TURN_RATE = 3.6 // rad/s
export const SHIP_DRAG = 0.22 // gentle velocity damping coefficient (per second)
export const SHIP_START_LIVES = 3
export const SHIP_FIRE_INTERVAL = 0.17 // s between shots
export const SHIP_RESPAWN_INVULN = 2.5 // s of invulnerability after (re)spawn
export const SHIP_SPAWN_CLEAR_RADIUS = 260 // rocks within this of a respawn are cleared

// Projectiles fly straight (no gravity), inheriting the ship's velocity.
export const BULLET_SPEED = 600 // muzzle speed
export const BULLET_RADIUS = 3
export const BULLET_LIFETIME = 1.5 // s

// Asteroid waves.
export const ASTEROID_BASE_COUNT = 5 // large rocks in wave 1
export const ASTEROID_PER_WAVE = 1 // extra large rock per subsequent wave
export const ASTEROID_MIN_SPEED = 28
export const ASTEROID_MAX_SPEED = 92
export const ASTEROID_VERTEX_COUNT = 11 // points around the rough rock outline

export type AsteroidConfig = {
  radius: number
  score: number
  next?: AsteroidSize // what it splits into when shot (undefined = vaporizes)
}

export const ASTEROID_CONFIG: Record<AsteroidSize, AsteroidConfig> = {
  [AsteroidSize.LARGE]: { radius: 46, score: 20, next: AsteroidSize.MEDIUM },
  [AsteroidSize.MEDIUM]: { radius: 28, score: 50, next: AsteroidSize.SMALL },
  [AsteroidSize.SMALL]: { radius: 15, score: 100 },
}
