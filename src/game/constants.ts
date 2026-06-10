// Tunables and shared literals for the V-Wing flight sim (XPilot-style: Newtonian
// thrust, global gravity, inertia). Everything balance-related lives here.

export enum GamePhase {
  TITLE = 'TITLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY', // the campaign won: the bot eliminated (base captured + ship downed)
}

// Who controls a ship. PLAYER is the camera-followed, life-counted human; BOT is AI.
export enum ShipKind {
  PLAYER = 'PLAYER',
  BOT = 'BOT',
}

// How a simulation scores and respawns. CAMPAIGN is the offline run (the human has a
// finite life count + a point score, bots respawn endlessly); DEATHMATCH is online PvP
// (everyone respawns endlessly and a kill is worth one frag to its shooter).
export enum SimMode {
  CAMPAIGN = 'CAMPAIGN',
  DEATHMATCH = 'DEATHMATCH',
}

export const DEATHMATCH_FRAG_SCORE = 1 // points a kill awards its shooter in DEATHMATCH

// Stable owner ids tagged onto bullets so shots never hit their firer.
export const PLAYER_ID = 0
export const BOT_ID = 1

// The ten random heavy weapons; one is rolled onto each ship on every (re)spawn, and the
// ship's infantry squad type (the man-portable variant its specialists carry) is a second,
// independent roll from the same pool.
export enum WeaponKind {
  SCATTERGUN = 'SCATTERGUN',
  WATER_CANNON = 'WATER_CANNON',
  INCENDIARY = 'INCENDIARY',
  SEEKER = 'SEEKER',
  RAIL = 'RAIL',
  GRENADE = 'GRENADE',
  MINES = 'MINES',
  FLAK = 'FLAK',
  EMP = 'EMP',
  SINGULARITY = 'SINGULARITY',
}

// Terrain is two independent layers. STRUCTURE is the material body: EARTH is destructible
// (voxelized, carves into craters), METAL is indestructible (an out-of-grid anchor that never
// falls and grounds the floating-island flood-fill). SURFACE is the cover on top, which
// transforms without touching the structure: GRASS burns to bare EARTH, bare EARTH regrows to
// GRASS when wetted, ICE is slippery. WATER is a surface in the design vocabulary but is modeled
// as WaterBody overlays (see water.ts), never a stored grid cell.
export enum StructureType {
  EARTH = 'EARTH',
  METAL = 'METAL',
}

export enum Surface {
  EARTH = 'EARTH',
  GRASS = 'GRASS',
  ICE = 'ICE',
  WATER = 'WATER',
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

// The behavioural state of a deployed trooper, derived from its fields each tick (see stateOf in
// devices.ts). Drives firing accuracy/cadence and the rendered pose.
export enum InfantryState {
  STANDING = 'STANDING', // landed, nowhere to patrol — fires dead-on
  WALKING = 'WALKING', // landed, patrolling / repositioning — fires with reduced accuracy
  RUNNING = 'RUNNING', // sprinting clear of a point-blank threat — holds fire
  KNEELING = 'KNEELING', // braced to launch a heavy weapon (grenadier)
  FALLING = 'FALLING', // airborne with no canopy — holds fire
  FALLING_PARACHUTE = 'FALLING_PARACHUTE', // descending under a canopy — fires inaccurately
  SWIMMING = 'SWIMMING', // afloat — only the drifting "standby" swimmer fires (poorly)
  DROWNING = 'DROWNING', // sinking under water; saveable for a brief window
}

// ── Online multiplayer ──────────────────────────────────────────────────────
// The authoritative server steps each game room at NET_TICK_RATE and broadcasts a full
// world snapshot; clients stream their input and render the snapshots they receive.
export const NET_TICK_RATE = 30 // server sim + broadcast ticks per second
export const NET_DEFAULT_PORT = 8787 // game server (HTTP lobby + WebSocket) port
export const NET_MAX_PLAYERS = 8 // combatants per game room
export const NET_PERSIST_EVERY = 15 // ticks between full-state writes to Redis (2×/s at 30 Hz)
export const NET_EMPTY_ROOM_TTL = 30 // s an emptied room lingers (state kept in Redis) before disposal
export const NET_GAME_NAME_MAX = 24 // max characters in a hosted game name

// Camera follow + screen shake.
export const CAMERA_EASE_RATE = 9 // higher = snappier follow (per-second easing toward the target)
export const CAMERA_SNAP_DIST = 400 // px target jump beyond which the camera snaps (respawns) not eases
export const SHAKE_DECAY = 26 // shake amplitude lost per second
export const SHAKE_FREQ = 47 // rad/s wobble frequency of the shake offset
export const SHIP_DEATH_SHAKE = 17 // shake amplitude (px) on a ship explosion
export const BLAST_SHAKE = 11 // shake amplitude (px) on a mine/seeker blast

// Camera viewport (the canvas) and the larger world it pans across. The viewport is a fixed
// 16:10 design resolution (same world-window for every client — fair for PvP) sized so it never
// upscales on the assumed ~1280×800-or-larger display: the WebGL buffer is >= the on-screen box,
// so it only ever downscales (stays crisp). Bigger than the old 900×600 so sprite detail reads.
export const VIEW_WIDTH = 1280
export const VIEW_HEIGHT = 800
export const WORLD_WIDTH = 10800
export const WORLD_HEIGHT = 6750
export const WALL_THICKNESS = 26 // thickness of the bedrock border frame (emitted by terrain-map.ts)

// ── Procedural arena generation (terrain-map.ts createTerrain) ───────────────
// The arena is generated once per run from a seeded sub-stream so it is deterministic per seed
// (identical on server + client) yet varied between runs. Layout is banded: an open SKY band up top
// carrying the deathmatch spawn anchors, a tall MID band of mesas / grasslands / rock / caves /
// shelves, and a LOW band of sea + pools. The two campaign home-base pads are flattened into the
// MID band with clamped approach aprons so each side's spawn column stays open.
export const TERRAIN_SALT = 0x9e3779b9 // xor'd into the seed for the terrain rng sub-stream
export const SPAWN_KEEPOUT_RADIUS = 400 // px disc around every spawn kept free of structure + water
export const BAND_SKY_BOTTOM = 0.3 // fraction of WORLD_HEIGHT: open airspace above this (DM anchors live here)
export const PLATEAU_MIN_CELLS = 8 // min flat-run width (cells) so plateau tops are wide patrol ledges
export const CAVE_MOUTH_CELLS = 5 // min cave-mouth width (cells) so a ship flies in/out (>= ship diameter)
export const MAX_AUTHORED_WATER = 6 // sea + a few pools (headroom under the runtime MAX_WATER_BODIES cap)
// Deathmatch respawn anchors (fractions of the world) — shared by the generator's keep-outs,
// the sim's spawn picker, and the tests, so the three can never drift apart. Both rows sit in
// the SKY band, above BAND_SKY_BOTTOM, so they are open by construction.
export const SPAWN_ANCHOR_FRACS_X: readonly number[] = [0.18, 0.34, 0.5, 0.66, 0.82]
export const SPAWN_ANCHOR_FRACS_Y: readonly number[] = [0.12, 0.24]

// ── Home bases (barracks) ───────────────────────────────────────────────────
// Each campaign side owns a barracks on a flat pad; its ship spawns hovering above its own pad.
export const BASE_PLAYER_X_FRAC = 0.12 // west pad center, fraction of WORLD_WIDTH
export const BASE_BOT_X_FRAC = 0.88 // east pad center
export const BASE_PAD_Y_FRAC = 0.52 // pad top, fraction of WORLD_HEIGHT (flattened by the generator)
export const BASE_PAD_CELLS = 24 // pad width in voxel cells (432 px of flat grass)
export const BASE_APRON_CELLS = 24 // span each side of the pad where land is clamped to pad level (open approach)
export const SPAWN_ALTITUDE = 320 // px above its pad top where a campaign ship (re)spawns
// The barracks itself: it houses a garrison the owner ship loads aboard (hover/land slow by the
// pad, same learned verb as the trooper rescue), regrowing over time — so troops are a stream,
// not a faucet. Enemy troopers landed inside the capture disc push capture progress; defenders
// in the zone contest it; a purged zone bleeds progress back. A captured base stops garrison
// regen, loading, AND the owner's respawns — death while captured is elimination (see sim.ts).
export const BASE_GARRISON_CAP = 12 // troopers a barracks can house
export const BASE_GARRISON_START = 8 // housed at match start
export const BASE_GARRISON_REGEN = 0.15 // troopers/s regrown while uncaptured (~6.7 s per man)
export const BASE_LOAD_RADIUS = 140 // px from the pad within which a slow owner ship loads troops
export const BASE_LOAD_RATE = 1.5 // troopers/s transferred garrison → bay while loading
export const BASE_CAPTURE_RADIUS = 460 // px disc around the pad center that counts capturers/defenders
export const BASE_CAPTURE_TIME = 30 // s of uncontested enemy presence to capture
export const BASE_REVERT_TIME = 12 // s for progress to bleed back once the zone is purged

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
  INK: 0x10131a, // near-black — infantry eyes / mouths
  SHADOW: 0x000000, // ground shadow under a figure (low alpha; only shows over terrain)
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

export type WeaponConfig = { name: string; cost: number; cooldown: number }

export const WEAPON_CONFIG: Record<WeaponKind, WeaponConfig> = {
  [WeaponKind.SCATTERGUN]: { name: 'Scattergun', cost: 22, cooldown: 0.5 },
  [WeaponKind.WATER_CANNON]: { name: 'Water Cannon', cost: 3, cooldown: 0.05 }, // cheap stream
  [WeaponKind.INCENDIARY]: { name: 'Incendiary', cost: 18, cooldown: 0.45 },
  [WeaponKind.SEEKER]: { name: 'Seeker Missiles', cost: 55, cooldown: 0.8 },
  [WeaponKind.RAIL]: { name: 'Rail Lance', cost: 80, cooldown: 0.9 },
  [WeaponKind.GRENADE]: { name: 'Grenade Lob', cost: 32, cooldown: 0.7 },
  [WeaponKind.MINES]: { name: 'Proximity Mines', cost: 55, cooldown: 0.6 },
  [WeaponKind.FLAK]: { name: 'Flak Burst', cost: 30, cooldown: 0.6 },
  [WeaponKind.EMP]: { name: 'EMP Orb', cost: 50, cooldown: 0.8 },
  [WeaponKind.SINGULARITY]: { name: 'Singularity', cost: 100, cooldown: 1.5 }, // a full bar
}

// Pool the random respawn assignment draws from (all ten, equal odds) — used for both
// the ship's heavy weapon roll and the independent infantry squad-type roll.
export const WEAPON_POOL: readonly WeaponKind[] = [
  WeaponKind.SCATTERGUN,
  WeaponKind.WATER_CANNON,
  WeaponKind.INCENDIARY,
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

// Water Cannon — knockback stream that wets terrain (earth→grass) and pools water in basins.
export const WATER_CANNON_DAMAGE = 2
export const WATER_CANNON_PUSH = 120 // velocity impulse applied to a hit ship
export const WATER_CANNON_SPEED = 520
export const WATER_CANNON_LIFE = 0.5
export const WATER_CANNON_SPREAD = 0.05 // rad jitter
export const WATER_CANNON_WET_RADIUS = 26 // px radius of earth→grass wetting on a terrain hit

// Incendiary — a short cone of flame that scorches grass→earth and lightly burns ships.
export const INCENDIARY_PELLETS = 5
export const INCENDIARY_SPREAD = 0.22 // rad half-cone
export const INCENDIARY_DAMAGE = 7
export const INCENDIARY_SPEED = 460
export const INCENDIARY_LIFE = 0.4
export const INCENDIARY_BURN_RADIUS = 22 // px radius of grass→earth scorch on a terrain hit

// ── Infantry (troop bay) ────────────────────────────────────────────────────
// Every ship carries a troop bay: it loads troopers from its barracks, then the deploy key
// streams them out one at a time. They parachute from high drops (swaying apart on the wind
// so a stream fans out instead of stacking), patrol the block they land on, and plink the
// nearest enemy in range/LOS. A unit dies from any single hit, splats if it hits the ground
// too fast, falls if the block under it is destroyed, dies instantly if it ends up embedded
// in a block, and is splattered by any ship that rams through it — except its *own* ship
// can't run it over during the deploy lockout (`INFANTRY_PICKUP_DELAY`), so a fast drop
// doesn't instantly mince the trooper it just released. It swims (no shooting) if it lands
// in water and drowns unless rescued. To be rescued, a unit walks/swims toward its own
// owner's slow (landed) ship — reaching it returns the trooper to the bay. A *slow* enemy
// ship over a trooper recruits it instead (the trooper switches sides where it stands).
export const TROOP_BAY_CAPACITY = 8 // troopers a ship can hold (float: barracks loading accrues fractionally)
export const TROOP_DEPLOY_COOLDOWN = 0.3 // s between drops while the deploy key is held
export const TROOP_SPECIALIST_CHANCE = 0.2 // 1 in 5 deployed units carries the squad's man-portable heavy weapon
export const INFANTRY_RADIUS = 9 // bigger so Cannon-Fodder-style detail reads at the 1280×800 viewport
export const INFANTRY_FIRE_INTERVAL = 1.1 // s between rifle shots (landed)
export const INFANTRY_GRENADE_FIRE_INTERVAL = 2.6 // s between grenade lobs (slower; landed grenadier)
// A landed grenadier plants itself to shoot: it drops to a knee and holds dead still for
// INFANTRY_KNEEL_TIME, letting the round fly once the crouch winds down to INFANTRY_KNEEL_FIRE_AT
// (a brief aim wind-up), then holds the rest of the crouch as recovery before standing up free.
export const INFANTRY_KNEEL_TIME = 1.6 // s the crouch lasts (wind-up + recovery), still the whole time
export const INFANTRY_KNEEL_FIRE_AT = 0.9 // kneel value (s left) at which the braced bazooka fires
export const INFANTRY_PARACHUTE_FIRE_INTERVAL = 3.2 // s between shots while descending (very slow)
export const INFANTRY_SHOT_DAMAGE = 6
export const INFANTRY_SHOT_SPEED = 380
export const INFANTRY_RANGE = 520
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

// Firing accuracy (half-spread, rad) by state: a halt is dead-on; walking wobbles; a canopy or an
// idle swim is wild. Spread is drawn from world.rng so it stays deterministic across the network.
export const INFANTRY_SPREAD_STANDING = 0 // aimed from a dead halt
export const INFANTRY_SPREAD_WALKING = 0.06 // fires on the move, less accurate
export const INFANTRY_SPREAD_PARACHUTE = 0.22 // swinging under the canopy
export const INFANTRY_SPREAD_SWIM = 0.34 // treading water, barely aimed
export const INFANTRY_SWIM_FIRE_INTERVAL = 2.4 // s between shots while drifting (standby — slow)
// Running: a landed trooper sprints clear of a point-blank threat, and never fires while running.
export const INFANTRY_RUN_SPEED = 60 // px/s flee speed (faster than the walk patrol)
export const INFANTRY_PANIC_DIST = 80 // px: an enemy this close makes a landed trooper bolt
// Ice: a trooper on an icy surface occasionally loses its footing and slides a little.
export const INFANTRY_ICE_SLIP_CHANCE = 0.015 // per-frame chance to slip while standing on ice
export const INFANTRY_SLIP_SPEED = 70 // px/s the slide starts at when a slip triggers
export const INFANTRY_SLIP_FRICTION = 1.2 // s^-1 decay of the slide (low → it glides for a moment)
export const INFANTRY_SLIP_STOP_SPEED = 4 // px/s below which a slide ends (snaps back to firm footing)
// Drowning is saveable: the owner can still scoop a sinking trooper this soon after it goes under.
export const INFANTRY_DROWN_RESCUE_WINDOW = 0.8 // s of the sink during which a rescue still works

// Parachute: deploys on a fast fall and opens over PARACHUTE_OPEN_TIME. The brake is
// all-or-nothing — until the canopy is *fully* open it does nothing (the unit keeps
// accelerating), then it snaps the descent to a slow terminal. So a high drop blooms in
// time and lands soft; a too-low drop hits the ground before the canopy finishes and
// splats (a clear, visible reason the trooper died). While a canopy is open the unit
// gusts sideways (a bounded random walk) so a held-down stream of troopers spreads into a
// fan rather than dropping in one stacked column.
export const PARACHUTE_DEPLOY_SPEED = 200 // vy (px/s) past which a chute starts opening
export const PARACHUTE_OPEN_TIME = 0.7 // s to ramp from just-deployed to fully open
export const PARACHUTE_TERMINAL = 55 // px/s descent once the canopy is fully open (hard clamp)
export const PARACHUTE_SWAY = 320 // px/s^2 random horizontal gusting applied while the canopy is open
export const PARACHUTE_DRIFT = 60 // px/s cap on the sideways glide (keeps the wind-fan bounded)

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

// ── Water pooling (basin detection) ─────────────────────────────────────────
// A water-cannon terrain hit looks for a cupped basin around the impact: terrain lips rising on
// both sides within POOL_HALF_WIDTH cells and a floor within POOL_MAX_DEPTH cells below. A found
// basin becomes (or merges into) a WaterBody. Bounded + deterministic; no per-cell fluid sim.
export const POOL_HALF_WIDTH = 40 // cells scanned each side of a hit for a containing rim
export const POOL_MAX_RISE = 30 // cells a basin rim may sit above the hit
export const POOL_MAX_DEPTH = 40 // cells below the hit searched for the basin floor
export const POOL_MIN_WIDTH = 2 // cells: ignore puddles narrower than this
export const MAX_WATER_BODIES = 24 // cap on authored + dynamic water bodies

// ── Destructible terrain (voxel grid) ───────────────────────────────────────
// Destructible materials (rock/grass/ice) are modeled as a grid of small cells. A shot
// carves a crater sized to the projectile; cells no longer connected to the "main static
// surface" (bedrock, the floor, or an undisturbed floating island) break loose and fall as
// debris that re-settles where it lands. Bedrock is indestructible and anchors everything.
// Collision/rendering still use rectangles: the grid (and each debris chunk) is greedily
// meshed into Block[] each time it changes. Cell size trades fidelity for cost.
export const VOXEL_CELL = 18 // px per destructible cell (WORLD 10800×6750 → 600×375 grid, ~225k cells)
export const CARVE_RADIUS_BASE = 5 // px crater radius floor (even a tiny pellet leaves a mark)
export const CARVE_RADIUS_SCALE = 2.4 // crater radius = projectile radius × this + base (bigger shot → bigger hole)
export const DEBRIS_TERMINAL = 520 // px/s terminal fall speed of a loosed chunk
export const DEBRIS_MAX_BODIES = 32 // safety cap on simultaneous falling chunks (excess is discarded)
// Surfaces transform without touching structure: an incendiary scorches grass→bare earth on hit;
// the water cannon wets bare earth, which regrows grass after SURFACE_REGROW_TIME of being wet.
export const SURFACE_REGROW_TIME = 6 // s a wetted bare-earth cell takes to regrow grass

// ── Terrain landing model ─────────────────────────────────────────────────
// On contact the ship is classified by `impact` = closing speed (px/s) along the
// surface normal: gentle → land (rest + slide), middling → bounce, hard → crash.
export const LAND_SPEED = 130 // impact below this rests the ship on the surface
export const CRASH_SPEED = 430 // impact at/above this destroys the ship (costs a life)
export const BOUNCE_RESTITUTION = 0.45 // fraction of normal velocity kept on a mid-speed bounce

// Per-second tangential damping applied while a ship is resting on a surface, keyed by the
// block's SURFACE: ICE keeps almost all speed (slippery), the others grip and shed it quickly.
// Bare metal anchors carry surface EARTH, so they grip like earth. WATER is never a resting
// surface (it is a WaterBody), included only for enum exhaustiveness.
export const SURFACE_FRICTION: Record<Surface, number> = {
  [Surface.EARTH]: 6,
  [Surface.GRASS]: 7,
  [Surface.ICE]: 0.3,
  [Surface.WATER]: 0,
}
