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

// The ten random secondary weapons; one is rolled onto each ship on every (re)spawn.
export enum WeaponKind {
  SCATTERGUN = 'SCATTERGUN',
  WATER_CANNON = 'WATER_CANNON',
  INFANTRY = 'INFANTRY',
  SEEKER = 'SEEKER',
  RAIL = 'RAIL',
  GRENADE = 'GRENADE',
  MINES = 'MINES',
  FLAK = 'FLAK',
  EMP = 'EMP',
  SINGULARITY = 'SINGULARITY',
}

// Deployed, world-resident entities spawned by some weapons (one Device[] array, switched on kind).
export enum DeviceKind {
  MISSILE = 'MISSILE',
  MINE = 'MINE',
  INFANTRY = 'INFANTRY',
  GRENADE = 'GRENADE',
  FLAK = 'FLAK',
  WELL = 'WELL',
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
  // Secondary weapons + water terrain.
  WATER: 0x2c6fb0,
  WATER_EDGE: 0x7fc8ff,
  MISSILE: 0xffd166,
  MINE: 0xc0c6d4,
  MINE_ARMED: 0xff5a5a,
  INFANTRY: 0xcfe8a0,
  GRENADE: 0x9fd36b,
  FLAK: 0xd8b46a,
  WELL: 0xb388ff,
  RAIL: 0xff5ad1,
  EMP: 0x7af7ff,
  SHRAPNEL: 0xffc97a,
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

// ── Secondary weapons ───────────────────────────────────────────────────────
// One weapon is rolled onto each ship per life (limited charges). Per-weapon
// charge count + cooldown live here; mechanic params follow, grouped per weapon.
export const ALT_FIRE_KEYS = ['KeyK', 'ShiftLeft'] // secondary trigger
export const SECONDARY_DEPLOY_DIST = 22 // px ahead of the nose where devices spawn

export type WeaponConfig = { name: string; ammo: number; cooldown: number }

export const WEAPON_CONFIG: Record<WeaponKind, WeaponConfig> = {
  [WeaponKind.SCATTERGUN]: { name: 'Scattergun', ammo: 8, cooldown: 0.5 },
  [WeaponKind.WATER_CANNON]: { name: 'Water Cannon', ammo: 60, cooldown: 0.05 },
  [WeaponKind.INFANTRY]: { name: 'Infantry Drop', ammo: 2, cooldown: 1.2 },
  [WeaponKind.SEEKER]: { name: 'Seeker Missiles', ammo: 3, cooldown: 0.8 },
  [WeaponKind.RAIL]: { name: 'Rail Lance', ammo: 3, cooldown: 0.9 },
  [WeaponKind.GRENADE]: { name: 'Grenade Lob', ammo: 4, cooldown: 0.7 },
  [WeaponKind.MINES]: { name: 'Proximity Mines', ammo: 3, cooldown: 0.6 },
  [WeaponKind.FLAK]: { name: 'Flak Burst', ammo: 4, cooldown: 0.6 },
  [WeaponKind.EMP]: { name: 'EMP Orb', ammo: 3, cooldown: 0.8 },
  [WeaponKind.SINGULARITY]: { name: 'Singularity', ammo: 1, cooldown: 1.5 },
}

// Pool the random respawn assignment draws from (all ten, equal odds).
export const WEAPON_POOL: readonly WeaponKind[] = [
  WeaponKind.SCATTERGUN,
  WeaponKind.WATER_CANNON,
  WeaponKind.INFANTRY,
  WeaponKind.SEEKER,
  WeaponKind.RAIL,
  WeaponKind.GRENADE,
  WeaponKind.MINES,
  WeaponKind.FLAK,
  WeaponKind.EMP,
  WeaponKind.SINGULARITY,
]

// Scattergun — cone of pellets.
export const SCATTERGUN_PELLETS = 7
export const SCATTERGUN_SPREAD = 0.32 // rad half-cone
export const SCATTERGUN_DAMAGE = 12
export const SCATTERGUN_SPEED = 540
export const SCATTERGUN_LIFE = 0.35

// Water Cannon — knockback stream that drains/fills pools.
export const WATER_CANNON_DAMAGE = 2
export const WATER_CANNON_PUSH = 120 // velocity impulse applied to a hit ship
export const WATER_CANNON_SPEED = 520
export const WATER_CANNON_LIFE = 0.5
export const WATER_CANNON_SPREAD = 0.05 // rad jitter
export const WATER_TRANSFER = 14 // px of pool level moved (muzzle pool → aim pool) per shot

// Infantry Drop — units fall, attach to a surface, plink the nearest enemy.
export const INFANTRY_COUNT = 3
export const INFANTRY_LIFE = 9
export const INFANTRY_RADIUS = 5
export const INFANTRY_FIRE_INTERVAL = 1.1
export const INFANTRY_SHOT_DAMAGE = 6
export const INFANTRY_SHOT_SPEED = 380
export const INFANTRY_RANGE = 520

// Seeker Missiles — limited-turn homing, area blast on contact.
export const SEEKER_COUNT = 3
export const SEEKER_SPEED = 360
export const SEEKER_TURN_RATE = 2.6 // rad/s
export const SEEKER_LIFE = 4
export const SEEKER_RADIUS = 5
export const SEEKER_DAMAGE = 30
export const SEEKER_BLAST_RADIUS = 70
export const SEEKER_BLAST_DAMAGE = 16

// Rail Lance — hitscan beam.
export const RAIL_RANGE = 1100
export const RAIL_DAMAGE = 70
export const RAIL_BEAM_LIFE = 0.18

// Grenade Lob — gravity arc + fuse → shrapnel ring.
export const GRENADE_SPEED = 420
export const GRENADE_FUSE = 1.0
export const GRENADE_RADIUS = 5
export const GRENADE_SHARDS = 12
export const GRENADE_SHARD_DAMAGE = 10
export const GRENADE_SHARD_SPEED = 360
export const GRENADE_SHARD_LIFE = 0.5

// Proximity Mines — arm, then detonate on enemy approach.
export const MINE_COUNT = 3
export const MINE_ARM_TIME = 0.8
export const MINE_LIFE = 14
export const MINE_RADIUS = 6
export const MINE_TRIGGER_RADIUS = 60
export const MINE_BLAST_RADIUS = 90
export const MINE_DAMAGE = 40

// Flak Burst — straight shell, timed airburst into an expanding ring.
export const FLAK_SPEED = 520
export const FLAK_FUSE = 0.55
export const FLAK_RADIUS = 4
export const FLAK_SHARDS = 14
export const FLAK_SHARD_DAMAGE = 9
export const FLAK_SHARD_SPEED = 300
export const FLAK_SHARD_LIFE = 0.45

// EMP Orb — modeled as a slow, zero-turn missile; on hit disables + drains shields.
export const EMP_SPEED = 300
export const EMP_LIFE = 3
export const EMP_RADIUS = 7
export const EMP_DISABLE_TIME = 2.0 // s the target can't thrust/turn/fire
export const EMP_SHIELD_DRAIN = 40

// Singularity — temporary gravity well.
export const WELL_LIFE = 4
export const WELL_RADIUS = 8 // visual core
export const WELL_PULL_RADIUS = 320
export const WELL_STRENGTH = 90000 // accel = strength / max(dist, WELL_MIN_DIST)
export const WELL_MIN_DIST = 60 // clamp so force stays finite at the center
export const WELL_MAX_ACCEL = 900 // hard cap on pull accel
export const WELL_DEPLOY_DIST = 240 // px ahead of the ship where the well anchors

// ── Water terrain ───────────────────────────────────────────────────────────
// Pools sit on the floor; a submerged ship gets buoyancy (counter-gravity) + drag.
export const WATER_POOL_COUNT = 2
export const WATER_BUOYANCY = 320 // px/s^2 upward at full submersion (beats GRAVITY → floats)
export const WATER_DRAG = 2.4 // extra exponential damping coefficient when submerged
export const WATER_POOL_CAPACITY = 240 // max fill height (px)
export const WATER_POOL_START_LEVEL = 150 // initial fill height (px)

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
