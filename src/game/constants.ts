// Tunables and shared literals for the V-Wing flight sim (XPilot-style: Newtonian
// thrust, global gravity, inertia). Everything balance-related lives here.

export enum GamePhase {
  TITLE = 'TITLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
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

// Static terrain surfaces. BEDROCK is indestructible; ROCK is removed by a weapon hit;
// ICE is low-friction (the ship slides); GRASS grips like rock.
export enum SurfaceMaterial {
  BEDROCK = 'BEDROCK',
  ROCK = 'ROCK',
  GRASS = 'GRASS',
  ICE = 'ICE',
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

// What a deployed infantry unit fights with (rolled per unit on deploy).
export enum InfantryWeapon {
  RIFLE = 'RIFLE',
  GRENADE = 'GRENADE',
}

// Camera follow + screen shake.
export const CAMERA_EASE_RATE = 9 // higher = snappier follow (per-second easing toward the target)
export const CAMERA_SNAP_DIST = 400 // px target jump beyond which the camera snaps (respawns) not eases
export const SHAKE_DECAY = 26 // shake amplitude lost per second
export const SHAKE_FREQ = 47 // rad/s wobble frequency of the shake offset
export const SHIP_DEATH_SHAKE = 17 // shake amplitude (px) on a ship explosion
export const BLAST_SHAKE = 11 // shake amplitude (px) on a mine/seeker blast

// Camera viewport (the canvas) and the larger world it pans across.
export const VIEW_WIDTH = 900
export const VIEW_HEIGHT = 600
export const WORLD_WIDTH = 2400
export const WORLD_HEIGHT = 1500
export const WALL_THICKNESS = 26 // thickness of the bedrock border frame (authored in terrain-map.ts)

// Neon-on-near-black palette, stored as 0xRRGGBB for PixiJS fills.
export const Color = {
  BACKGROUND: 0x05060d,
  STAR_FAR: 0x2a3566,
  STAR_NEAR: 0x9fb4ff,
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
  EXPLOSION: 0xffd166,
  // Secondary weapons + water terrain.
  WATER: 0x2c6fb0,
  WATER_EDGE: 0x7fc8ff,
  MISSILE: 0xffd166,
  MINE: 0xc0c6d4,
  MINE_ARMED: 0xff5a5a,
  INFANTRY: 0xcfe8a0,
  PARACHUTE: 0xe6e2cf,
  SMOKE: 0x6b7280,
  GRENADE: 0x9fd36b,
  FLAK: 0xd8b46a,
  BLOOD: 0xff3b3b, // infantry death (shot / splatted / blasted)
  WELL: 0xb388ff,
  RAIL: 0xff5ad1,
  EMP: 0x7af7ff,
  SHRAPNEL: 0xffc97a,
  // Terrain surfaces (fill + brighter edge).
  BEDROCK: 0x767c88, // metallic gray — kept clearly distinct from the blue water
  BEDROCK_EDGE: 0xb4bcc9,
  ROCK: 0x5b4636,
  ROCK_EDGE: 0x9a7a59,
  GRASS: 0x3f7d3a,
  GRASS_EDGE: 0x77c95f,
  ICE: 0x8fd0e8,
  ICE_EDGE: 0xd9f4ff,
} as const

// Global gravity: a constant downward pull. Thrust must beat it to climb.
export const GRAVITY = 200 // px/s^2

// Ship ambiance (cosmetic particles spawned by the engine).
export const THRUST_PARTICLE_SPEED = 120 // px/s backward ember speed from the nozzle while thrusting
export const THRUST_PARTICLE_LIFE = 0.34 // s exhaust ember lifetime
export const SHIP_SMOKE_HEALTH = 40 // hull below this trails smoke
export const SMOKE_LIFE = 0.9 // s smoke puff lifetime

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
// Terrain uses the land/bounce/crash model; only gunfire is graded against shields/hull.
export const SHIP_MAX_HEALTH = 100
export const SHIP_MAX_SHIELDS = 50
export const SHIP_SHIELD_REGEN = 9 // shield points/s recovered between hits
export const BOT_KILL_SCORE = 250 // awarded when the player downs the bot

// AI bot tuning (single balancing surface — the logic in bot.ts reads these).
export const BOT_AIM_DEADBAND = 0.06 // rad of heading error tolerated before turning
export const BOT_FIRE_CONE = 0.16 // rad of aim error within which the bot shoots
export const BOT_FIRE_RANGE = 620 // px max engagement distance (primary cannon)
export const BOT_SECONDARY_RANGE = 950 // px range the bot will loose a secondary (rail/seeker reach further)
export const BOT_THRUST_CONE = 1.1 // rad: thrust to close only when roughly facing the target
export const BOT_STANDOFF = 240 // px: stop closing once this near the target
export const BOT_FALL_LIMIT = 220 // vy above which the bot climbs even mid-engagement
export const BOT_WALL_MARGIN = 90 // px buffer off the walls before the bot flees to center
export const BOT_WALL_LOOKAHEAD = 0.85 // s of velocity projected when testing wall danger
export const BOT_DODGE_DIST = 220 // px gap to a terrain block that triggers an evasive turn

// ── Secondary weapons ───────────────────────────────────────────────────────
// One weapon is rolled onto each ship per life. Instead of a fixed ammo pool, the
// secondary draws on a recharging energy bar: each use spends `cost`, the bar
// regenerates over time, and `cooldown` still caps the firing rate.
// (Secondary keybinding lives with the other keys in input.ts.)
export const SECONDARY_DEPLOY_DIST = 22 // px ahead of the nose where devices spawn
export const SECONDARY_MAX_CHARGE = 100 // full energy bar
export const SECONDARY_REGEN = 22 // energy/s the bar refills (full in ~4.5s)
export const INFANTRY_PICKUP_REFUND = 22 // energy returned when the owner rescues a unit

export type WeaponConfig = { name: string; cost: number; cooldown: number }

export const WEAPON_CONFIG: Record<WeaponKind, WeaponConfig> = {
  [WeaponKind.SCATTERGUN]: { name: 'Scattergun', cost: 22, cooldown: 0.5 },
  [WeaponKind.WATER_CANNON]: { name: 'Water Cannon', cost: 3, cooldown: 0.05 }, // cheap stream
  [WeaponKind.INFANTRY]: { name: 'Infantry Drop', cost: 14, cooldown: 0.3 }, // per trooper while held
  [WeaponKind.SEEKER]: { name: 'Seeker Missiles', cost: 55, cooldown: 0.8 },
  [WeaponKind.RAIL]: { name: 'Rail Lance', cost: 80, cooldown: 0.9 },
  [WeaponKind.GRENADE]: { name: 'Grenade Lob', cost: 32, cooldown: 0.7 },
  [WeaponKind.MINES]: { name: 'Proximity Mines', cost: 55, cooldown: 0.6 },
  [WeaponKind.FLAK]: { name: 'Flak Burst', cost: 30, cooldown: 0.6 },
  [WeaponKind.EMP]: { name: 'EMP Orb', cost: 50, cooldown: 0.8 },
  [WeaponKind.SINGULARITY]: { name: 'Singularity', cost: 100, cooldown: 1.5 }, // a full bar
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

// Infantry Drop — held to stream units out one at a time; they parachute from high
// drops, patrol the block they land on, and plink the nearest enemy in range/LOS. A unit
// dies from any single hit, splats if it hits the ground too fast, falls if the block
// under it is destroyed, dies instantly if it ends up embedded in a block, and is
// splattered by any ship that rams through it. It swims (no shooting) if it lands in water
// and drowns unless rescued. To be rescued, a unit walks/swims toward its own owner's
// slow (landed) ship — reaching it restores the Infantry slot.
export const INFANTRY_RADIUS = 5
export const INFANTRY_FIRE_INTERVAL = 1.1 // s between rifle shots (landed)
export const INFANTRY_GRENADE_FIRE_INTERVAL = 2.6 // s between grenade lobs (slower; landed grenadier)
export const INFANTRY_PARACHUTE_FIRE_INTERVAL = 3.2 // s between shots while descending (very slow)
export const INFANTRY_SHOT_DAMAGE = 6
export const INFANTRY_SHOT_SPEED = 380
export const INFANTRY_RANGE = 520
export const INFANTRY_GRENADE_CHANCE = 0.2 // 1 in 5 units carries a grenade launcher
export const INFANTRY_WALK_SPEED = 26 // px/s patrol speed on a surface
export const INFANTRY_WALK_TURN_CHANCE = 0.012 // per-frame chance a patroller spontaneously reverses
export const INFANTRY_PICKUP_DELAY = 2 // s after deploy before a unit can be picked up
export const INFANTRY_FALL_LETHAL = 300 // landing impact speed (px/s) above which a unit splats
export const INFANTRY_SWIM_TIME = 6 // s a unit floats (can't shoot) in water before it drowns
export const INFANTRY_SWIM_DRAG = 1.6 // horizontal damping coefficient while swimming (no rescuer near)
export const INFANTRY_SWIM_SPEED = 34 // px/s a unit paddles toward a rescuing owner
export const INFANTRY_PICKUP_RADIUS = 30 // px: a unit reaching this close to its slow owner is scooped up
export const INFANTRY_PICKUP_SPEED = 90 // px/s: the owner must be slower than this to rescue a unit
export const INFANTRY_RAM_SPEED = 150 // px/s: a ship faster than this splatters any trooper it touches
export const INFANTRY_RESCUE_RANGE = 260 // px: a unit only walks/swims toward an owner this near
export const INFANTRY_SINK_TIME = 1.5 // s a drowned unit sinks and fades before vanishing
export const INFANTRY_SINK_SPEED = 36 // px/s it descends while sinking

// Parachute: deploys on a fast fall and opens over PARACHUTE_OPEN_TIME. The brake is
// all-or-nothing — until the canopy is *fully* open it does nothing (the unit keeps
// accelerating), then it snaps the descent to a slow terminal. So a high drop blooms in
// time and lands soft; a too-low drop hits the ground before the canopy finishes and
// splats (a clear, visible reason the trooper died).
export const PARACHUTE_DEPLOY_SPEED = 200 // vy (px/s) past which a chute starts opening
export const PARACHUTE_OPEN_TIME = 0.7 // s to ramp from just-deployed to fully open
export const PARACHUTE_TERMINAL = 55 // px/s descent once the canopy is fully open (hard clamp)

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

// ── Water ─────────────────────────────────────────────────────────────────
// A submerged ship gets buoyancy (counter-gravity) + extra drag. Water bodies and
// their depths are authored in terrain-map.ts.
export const WATER_BUOYANCY = 320 // px/s^2 upward at full submersion (beats GRAVITY → floats)
export const WATER_DRAG = 2.4 // extra exponential damping coefficient when submerged
export const SPLASH_MIN_SPEED = 130 // |vy| above which crossing the surface throws a splash
export const SPLASH_PARTICLES = 11 // droplets per splash

// ── Terrain landing model ─────────────────────────────────────────────────
// On contact the ship is classified by `impact` = closing speed (px/s) along the
// surface normal: gentle → land (rest + slide), middling → bounce, hard → crash.
export const LAND_SPEED = 130 // impact below this rests the ship on the surface
export const CRASH_SPEED = 430 // impact at/above this destroys the ship (costs a life)
export const BOUNCE_RESTITUTION = 0.45 // fraction of normal velocity kept on a mid-speed bounce

// Per-second tangential damping applied while a ship is resting on a surface:
// ICE keeps almost all speed (slippery), the others grip and shed it quickly.
export const SURFACE_FRICTION: Record<SurfaceMaterial, number> = {
  [SurfaceMaterial.BEDROCK]: 6,
  [SurfaceMaterial.ROCK]: 6,
  [SurfaceMaterial.GRASS]: 7,
  [SurfaceMaterial.ICE]: 0.3,
}
