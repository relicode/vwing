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

// Who controls a ship. PLAYER is the camera-followed, life-counted human; BOT is AI.
export enum ShipKind {
  PLAYER = 'PLAYER',
  BOT = 'BOT',
}

// Stable owner ids tagged onto bullets so shots never hit their firer.
export const PLAYER_ID = 0
export const BOT_ID = 1

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
  ENEMY: 0xff6b8b, // AI ship hull
  THRUST: 0xffb347,
  BULLET: 0xfff27a, // player shots
  BULLET_ENEMY: 0xff9d5c, // AI shots
  SPARK: 0xffd9a0, // shield/hull impact flecks
  SHIELD: 0x5ad1ff, // shield bar
  HEALTH: 0x57e08a, // hull bar
  BAR_BACK: 0x20242e, // bar backing
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
export const BULLET_DAMAGE = 22 // hit points removed per shot

// Ship combat: shields soak damage first and regenerate; hull is the real pool.
// Walls and asteroids stay one-hit lethal — only gunfire is graded.
export const SHIP_MAX_HEALTH = 100
export const SHIP_MAX_SHIELDS = 50
export const SHIP_SHIELD_REGEN = 9 // shield points/s recovered between hits
export const BOT_KILL_SCORE = 250 // awarded when the player downs the bot

// AI bot tuning (single balancing surface — the logic in bot.ts reads these).
export const BOT_AIM_DEADBAND = 0.06 // rad of heading error tolerated before turning
export const BOT_FIRE_CONE = 0.16 // rad of aim error within which the bot shoots
export const BOT_FIRE_RANGE = 620 // px max engagement distance
export const BOT_THRUST_CONE = 1.1 // rad: thrust to close only when roughly facing the target
export const BOT_STANDOFF = 240 // px: stop closing once this near the target
export const BOT_FALL_LIMIT = 220 // vy above which the bot climbs even mid-engagement
export const BOT_WALL_MARGIN = 90 // px buffer off the walls before the bot flees to center
export const BOT_WALL_LOOKAHEAD = 0.85 // s of velocity projected when testing wall danger
export const BOT_DODGE_DIST = 150 // px gap to an asteroid that triggers an evasive turn

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
