// Tunables and shared literals for the V-Wing flight sim (XPilot-style: Newtonian
// thrust, global gravity, inertia). Everything balance-related lives here.

export enum GamePhase {
  TITLE = 'TITLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY', // the campaign won: the bot eliminated (base captured + ship downed)
}

// Who controls a ship. PLAYER is the camera-followed human; BOT is AI.
export enum ShipKind {
  PLAYER = 'PLAYER',
  BOT = 'BOT',
}

// How a simulation scores and respawns. CAMPAIGN is the offline base war (respawns flow from
// holding a base — lose every base and death is elimination); DEATHMATCH is online PvP
// (baseless: everyone respawns endlessly and a kill is worth one frag to its shooter).
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
  FLAMETHROWER = 'FLAMETHROWER',
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
// transforms without touching the structure: flame sets GRASS alight (FIRE — it creeps to
// adjacent grass, then burns out to bare EARTH), bare EARTH regrows to GRASS when wetted, ICE
// is slippery. WATER is a surface in the design vocabulary but is modeled as WaterBody overlays
// (see water.ts), never a stored grid cell.
export enum StructureType {
  EARTH = 'EARTH',
  METAL = 'METAL',
}

export enum Surface {
  EARTH = 'EARTH',
  GRASS = 'GRASS',
  ICE = 'ICE',
  FIRE = 'FIRE', // grass that is currently alight (transient: douse → GRASS, burn out → EARTH)
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

// A threat SENSOR over a base, recomputed by stepBases each tick and read by the bot's goal
// layer (defenders no longer change posture — they hold the shelter and fire): PATROL = clear,
// HIDE = an enemy ship within BASE_ALERT_RANGE, SORTIE = enemy infantry landed within
// BASE_SORTIE_RANGE. SORTIE outranks HIDE: a landed assault is the louder alarm.
export enum BaseAlarm {
  PATROL = 'PATROL',
  HIDE = 'HIDE',
  SORTIE = 'SORTIE',
}

// The behavioural state of a deployed trooper, derived from its fields each tick (see stateOf in
// devices.ts). Drives firing accuracy/cadence and the rendered pose.
export enum InfantryState {
  STANDING = 'STANDING', // landed, nowhere to patrol — fires dead-on
  WALKING = 'WALKING', // landed, patrolling / repositioning — fires with reduced accuracy
  RUNNING = 'RUNNING', // sprinting clear of a point-blank threat — holds fire
  KNEELING = 'KNEELING', // braced to launch a heavy weapon (grenadier)
  FALLEN = 'FALLEN', // knocked flat (blast shove / hard landing / icy pratfall) — helpless until back up
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
export const NET_BENCH_MAX = 32 // disconnected seats a room remembers for same-name reclaim (oldest evicted)
export const NET_PERSIST_MAX_DEVICES = 512 // cap on devices read back from a persisted blob (hostile-blob bound)
// Client self-healing: an unexpected close after a WELCOME re-dials with intent=JOIN on this
// backoff (JOIN also resurrects a hibernated room, so blips and server restarts heal through
// the same reclaim path); the schedule exhausted = genuinely disconnected.
export const NET_RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 8000]
export const NET_FEED_MAX = 4 // kill-feed lines shown at once (oldest dropped)
export const NET_FEED_TTL = 6 // s a kill-feed line lives
export const NET_SNAPSHOT_STALL_MS = 2000 // no SNAPSHOT for this long while PLAYING → the UNSTABLE chip

// Minimap (renderer.ts): a corner overview of the whole arena — terrain silhouette, water,
// both bases, and every ship, tinted with the same owner colors as the world (self cyan,
// enemy red). Height follows the world's aspect ratio.
export const MINIMAP_WIDTH = 200 // px on screen (world aspect 10800×6750 → 125 px tall)
export const MINIMAP_MARGIN = 12 // px inset from the viewport's bottom-right corner

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
// Thickness of the bedrock border frame (emitted by terrain-map.ts). MUST stay a multiple of
// VOXEL_CELL: the destructible grid is anchored at the world origin, so a frame that ends off-grid
// shifts every wall-adjacent terrain column off the cell boundaries — the re-meshed voxels then
// round outward and bleed over the walls, and authored water rects sit half a cell off their
// basin lips. 36 = 2 cells keeps all authored terrain + water exactly grid-aligned.
export const WALL_THICKNESS = 36

// ── Procedural arena generation (terrain-map.ts createTerrain) ───────────────
// The arena is generated once per run from a seeded sub-stream so it is deterministic per seed
// (identical on server + client) yet varied between runs. Layout is banded: an open SKY band up top
// carrying the deathmatch spawn anchors, a tall MID band of mesas / grasslands / rock / caves /
// shelves, and a LOW band of sea + pools. The two campaign home-base pads are flattened into the
// MID band with clamped approach aprons so each side's spawn column stays open.
export const TERRAIN_SALT = 0x9e3779b9 // xor'd into the seed for the terrain rng sub-stream
export const SPAWN_KEEPOUT_RADIUS = 400 // px disc around every spawn kept free of structure + water
export const BAND_SKY_BOTTOM = 0.3 // fraction of WORLD_HEIGHT: open airspace above this (DM anchors live here)
// The central sea (LOW band): column span as fractions of the play width, surface + floor as
// fractions of WORLD_HEIGHT. Shared with the tests so the gulf geometry can't drift apart.
export const SEA_WEST_FRAC = 0.4
export const SEA_EAST_FRAC = 0.62
export const SEA_SPILL_FRAC = 0.74 // the water surface (spill level below the containing lips)
export const SEA_FLOOR_FRAC = 0.9
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
// The barracks itself: the DEFENDERS are the base's hitpoints. Up to BASE_ACTIVE_DEFENDERS of
// them stand INSIDE the building and fire out (sheltered — immune to direct fire); the rest wait
// in reserve (the housed `garrison` count). Total defense = reserve + fielded defenders. The
// building's body is solid (ships bounce, enemy troopers stop at the walls) and opaque to
// gunfire, but a ship-class round STRIKING it can kill a sheltered defender — by chance,
// proportional to the round's damage (BASE_SHELL_KILL_DAMAGE). When the last defender is gone
// the fort is stormable: attackers in wall/roof contact run the capture clock (BASE_STORM_*).
// Defenders regrow over time unless the fort is under ground assault. A captured base stops
// regen, loading, AND the owner's respawns — death while captured is elimination (see sim.ts).
export const BASE_GARRISON_CAP = 12 // total defenders a barracks holds (reserve + fielded)
export const BASE_GARRISON_START = 8 // total defenders at match start
export const BASE_ACTIVE_DEFENDERS = 4 // defenders manifested inside the building, firing out (rest are reserve)
// The building's body is IMPENETRABLE (solid to every ship, stops enemy troopers at the walls)
// and OPAQUE to gunfire (no round passes through). It is no longer indestructible to the men
// within: a ship-class round/blast/lance that strikes the walls can kill ONE sheltered defender,
// at a chance proportional to its damage. Infantry small arms still cross the band (the wall
// fight happens through the slits — that is how the defenders fire out and how a stormer's rifle
// reaches nobody inside).
export const BASE_BUILDING_HALF_WIDTH = 150 // px — the bunker's half-width (hitbox = drawn body)
export const BASE_BUILDING_HEIGHT = 120 // px the bunker rises above the pad line (hitbox = drawn body)
// Shelling lethality: a ship-class hit on the building kills one defender with probability
// min(1, damage / BASE_SHELL_KILL_DAMAGE). Primary (30) → 0.2 (~5 hits/kill); a heavy blast or
// lance is far more likely. Sheltered defenders die ONLY this way — never to a direct hit.
export const BASE_SHELL_KILL_DAMAGE = 150 // damage at which a single building hit is a certain kill
export const BASE_GARRISON_REGEN = 1 / 15 // defenders/s regrown while uncaptured + not under ground assault
export const BASE_LOAD_RADIUS = 200 // px from the pad within which a slow owner ship throws the doors open to board
export const BASE_PAD_METAL_CELLS = 2 // thickness (cells) of the indestructible metal slab the barracks stands on
export const BASE_CAPTURE_RADIUS = 460 // px disc around the pad center that counts capturers/defenders
export const BASE_REVERT_TIME = 12 // s for progress to bleed back once the zone is purged
// Defenders are fielded from reserve on a cadence, manifesting inside the building (they don't
// patrol or sortie — they hold the shelter and fire out). Loading is embodied: a slow owner ship
// by the pad throws the doors open and the whole defense (reserve and fielded) streams out, runs
// to the ship, and boards by touch. There is no abstract counter transfer.
export const BASE_GUARD_PATROL = 4 // (bot supply threshold) fielded-defender headcount a healthy base shows
export const BASE_GUARD_RESERVE = 2 // (bot threshold) defenders the bot won't strip when loading
export const BASE_GUARD_RANGE = 96 // px fallback half-span for a defender's footing when no pad block is found
export const BASE_ALERT_RANGE = 700 // px enemy-ship distance that raises the HIDE sensor (bot signal)
export const BASE_SORTIE_RANGE = 600 // px enemy-infantry (landed) distance that raises the SORTIE sensor (bot signal)
export const BASE_DOOR_INTERVAL = 0.7 // s between defenders fielding out the door
export const BASE_DOOR_RADIUS = 16 // px from the door within which a returning defender slips back inside
// Storming runs only over an EMPTIED fort (no defender left). It is a CONTACT job: capture
// progresses at 1/BASE_STORM_SIDE_TIME per second for EACH of the THREE sides a stormer presses —
// the west wall, the roof (north), and the east wall — counted for at most one man per side. So one
// side takes BASE_STORM_SIDE_TIME, two sides half that, all three a third of it. A live threat near
// the pad halts the storm.
export const BASE_STORM_SIDE_TIME = 10 // s to storm with one soldier on a single side (all three sides → 3.3 s)
export const BASE_STORM_CONTACT = 8 // px gap within which a trooper counts as pressed to a wall / standing on the roof
export const BASE_STORM_ROOF_SLOTS = 3 // roofers marked for the pounding pose (the roof counts as ONE side for capture)
export const BASE_STORM_THREAT_RANGE = 700 // px — an enemy ship or live enemy trooper this close to the pad halts the storm

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
  FIRE: 0xb5461b, // grass alight — ember-orange body
  FIRE_EDGE: 0xff9e3f,
} as const

// One distinct hull color per online seat, assigned by the server as a SLOT index that rides
// the wire (PlayerInfo.palette), the bench, and the persisted roster — so every client agrees
// who is amber. Slots 0/1 equal the legacy SHIP/ENEMY hues, so a 1v1 looks like it always has,
// and the offline campaign (which passes no palette map to the renderer) is untouched.
// Constraints on the hexes: pairwise distinct, length === NET_MAX_PLAYERS, and clear of the
// FX/terrain hues they'd be confused with (EXPLOSION/MISSILE 0xffd166, BULLET_ENEMY 0xff9d5c,
// THRUST 0xffb347, WATER_EDGE 0x7fc8ff, FIRE_EDGE 0xff9e3f, GRASS_EDGE 0x77c95f) — pinned by
// __tests__/net.test.ts. The most-separated hues come first so small games read best.
export const PLAYER_PALETTE: readonly number[] = [
  0x8fe3ff, // 0 cyan — the legacy self hue
  0xff6b8b, // 1 rose — the legacy enemy hue
  0xffd76a, // 2 gold
  0xb38bff, // 3 violet
  0xc6f25a, // 4 lime
  0xff7ae0, // 5 magenta
  0x7d8cff, // 6 indigo
  0xdde6f2, // 7 silver
]

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
// Reverse-afterburners: a pair of smaller retro nozzles at the nose firing FORWARD to brake
// without flipping the ship (↓ / S). Weaker than the main engine — a brake, not a second drive.
export const SHIP_REVERSE_THRUST = 260 // px/s^2 opposite the nose while the retros burn
export const SHIP_TURN_RATE = 3.6 // rad/s (at full hull; degrades with damage — see SHIP_STEER_MIN)
export const SHIP_STEER_MIN = 0.4 // a wrecked hull (0 HP) still steers at this fraction of SHIP_TURN_RATE; full hull = 1×
export const SHIP_DRAG = 0.22 // gentle velocity damping coefficient (per second)
export const SHIP_FIRE_INTERVAL = 0.17 // s between shots
export const SHIP_RESPAWN_INVULN = 2.5 // s of invulnerability after (re)spawn
export const SHIP_SPAWN_CLEAR_RADIUS = 260 // rocks within this of a respawn are cleared
// Respawns are unlimited, but dying costs time and it compounds without ceiling: the waits run
// 5, 10, 15, … — a side being worn down reinforces ever slower. The only hard stop is the base
// war: a side holding NO base (its own lost, none captured) has no respawns at all (sim.ts).
export const RESPAWN_DELAY_BASE = 5 // s the first respawn waits
export const RESPAWN_DELAY_GROWTH = 5 // s added per prior death (uncapped)

// Projectiles fly straight (no gravity), inheriting the ship's velocity.
export const BULLET_SPEED = 600 // muzzle speed
export const BULLET_RADIUS = 3
export const BULLET_LIFETIME = 1.5 // s
export const BULLET_DAMAGE = 30 // hit points removed per shot (5 bare shots / 6 with regen to down a full ship)

// Ship combat: shields soak damage first and regenerate; hull is the real pool.
// Terrain uses the land/bounce/crash model; only gunfire is graded against shields/hull.
export const SHIP_MAX_HEALTH = 100
export const SHIP_MAX_SHIELDS = 50
export const SHIP_SHIELD_REGEN = 9 // shield points/s recovered between hits
export const SHIP_HULL_REPAIR = 20 // hull points/s mended while docked at a base you hold — the ONLY way hull repairs
export const BOT_KILL_SCORE = 250 // awarded when the player downs the bot

// The bot's campaign goal layer (bot.ts): a priority ladder over the inner dogfight reflexes.
// DOGFIGHT when pressed, DEFEND a contested home base, REARM at the barracks when the bay runs
// low (sticky until topped up), ASSAULT the enemy pad with a paradrop, else dogfight.
export enum BotGoal {
  DOGFIGHT = 'DOGFIGHT',
  REARM = 'REARM',
  ASSAULT = 'ASSAULT',
  DEFEND = 'DEFEND',
}
export const BOT_THREAT_RANGE = 520 // px: an enemy ship this close always wins the bot's attention
export const BOT_ASSAULT_MIN_TROOPS = 4 // don't fly an assault with a near-empty bay
export const BOT_REARM_DONE_TROOPS = 6 // hysteresis: stop loading once this many are aboard
export const BOT_DROP_ALTITUDE = 400 // px above the target pad to release (chutes open in time)
export const BOT_DROP_WINDOW_X = 160 // |x - pad center| within which the bot streams its drop
export const BOT_HOVER_SLOW = 60 // px/s target speed for the loading hover (under the rescue gate)
export const BOT_ARRIVAL_RADIUS = 120 // px from a steer destination where the bot starts braking
export const BOT_CRUISE_SPEED = 320 // px/s along-track cap while ferrying (stays controllable)
// Ferry routing: long crossings fly a two-leg route — climb to the open SKY band (above every
// mesa top), transit, then descend the destination column (the pad aprons keep it clear). Pure
// reactive dodging can't survive the new mesa country at cruise speed.
export const BOT_CRUISE_ALT_FRAC = 0.22 // fraction of WORLD_HEIGHT to cruise at (inside the sky band)
export const BOT_DESCEND_DX = 600 // |x - destination| below which the bot leaves cruise and descends
export const BOT_DROP_BAND = 240 // drop only within this band above the release altitude (short chute rides)

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
  [WeaponKind.FLAMETHROWER]: { name: 'Flamethrower', cost: 4, cooldown: 0.07 }, // cheap stream (the water cannon's mirror)
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
  WeaponKind.FLAMETHROWER,
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

// Flamethrower — a held-down stream of short-lived flame gouts: sets grass ALIGHT (the fire
// then creeps on its own — see GRASS_BURN_TIME / GRASS_FIRE_SPREAD_AFTER), lightly burns ships,
// and SETS INFANTRY ALIGHT (see INFANTRY_BURN_*). Short reach, murder up close.
export const FLAMETHROWER_PELLETS = 2 // gouts per pulse (the stream is the cooldown cadence)
export const FLAMETHROWER_SPREAD = 0.18 // rad half-cone
export const FLAMETHROWER_DAMAGE = 3
export const FLAMETHROWER_SPEED = 340
export const FLAMETHROWER_LIFE = 0.5
export const FLAMETHROWER_BURN_RADIUS = 22 // px radius of grass ignition on a terrain hit

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
export const INFANTRY_STEP_HEIGHT = 18 // px (one VOXEL_CELL) a non-heavy trooper steps up/down over; specialists can't
export const INFANTRY_WALK_TURN_CHANCE = 0.012 // per-frame chance a patroller spontaneously reverses
export const INFANTRY_PICKUP_DELAY = 2 // s after deploy before a unit can be picked up
export const INFANTRY_FALL_LETHAL = 300 // landing impact speed (px/s) above which a unit splats
// Knocked flat: a survivable-but-hard landing (chute not fully open), a blast's shove, or an icy
// skid's end dumps a trooper on his back — helpless (no walking, no firing) until he scrambles up.
export const INFANTRY_FALLEN_TIME = 2.5 // s a knocked-down trooper stays flat before getting up
export const INFANTRY_FALL_KNOCKDOWN = 140 // landing impact (px/s) above which a survivable fall still knocks flat (sets `fallen`, not `stun`)
// A hull breach shakes the troop bay: on any tick a trooper-laden ship loses hull HP, EACH whole
// trooper still aboard rolls INFANTRY_SPILL_CHANCE to be flung clear. A spilled man tumbles out
// PANICKED — flailing and too rattled to pull his ripcord for INFANTRY_PANIC_TIME, so the chute
// opens late (a hit taken low over the ground can cost troopers to the splat; see devices.ts).
export const INFANTRY_SPILL_CHANCE = 0.22 // per-trooper chance to fall out when the hull takes damage
export const INFANTRY_PANIC_TIME = 1.2 // s a spilled trooper free-falls in a panic before its chute can deploy
export const INFANTRY_KNOCKDOWN_RADIUS_SCALE = 1.6 // blast knockdown ring: kill radius × this flattens landed survivors
export const BURST_KNOCKDOWN_RADIUS = 80 // px around a grenade/flak burst where landed troopers are knocked flat
export const INFANTRY_SWIM_TIME = 6 // s a unit floats (can't shoot) in water before it drowns
export const INFANTRY_SWIM_DRAG = 1.6 // horizontal damping coefficient while swimming (no rescuer near)
export const INFANTRY_SWIM_SPEED = 34 // px/s a unit paddles toward a rescuing owner (or, lacking one, toward home shore)
// Wading: knee/waist-high shallows. A trooper standing where the water over its footing is at most
// INFANTRY_WADE_DEPTH keeps its feet and fights on (no swim, no drown) but slogs at a fraction of
// its land speed. Deeper than this it loses the bottom and starts swimming; a swimmer that drifts
// over ground within this depth of the surface stands back up and wades ashore.
export const INFANTRY_WADE_DEPTH = 14 // px of water over the feet a trooper can still stand in
export const INFANTRY_WADE_SPEED_SCALE = 0.55 // fraction of land speed kept while wading
// Boarding is by TOUCH: the hulls must actually meet (ship radius + trooper radius) — "near" is
// not aboard. The approach gate below is only how close a ship must hover for a unit to start
// walking toward it; the scoop itself happens on contact with a landed / barely-drifting ship.
export const INFANTRY_PICKUP_RADIUS = 30 // px vertical gate within which a landed unit walks toward its rescuer
export const INFANTRY_PICKUP_SPEED = 60 // px/s: the ship must be landed or barely drifting to take a unit aboard
export const INFANTRY_RAM_SPEED = 150 // px/s: a ship faster than this splatters any trooper it touches
export const INFANTRY_RESCUE_RANGE = 260 // px: a unit only walks/swims toward an owner this near
export const INFANTRY_SINK_TIME = 1.5 // s a drowned unit sinks and fades before vanishing
export const INFANTRY_SINK_SPEED = 36 // px/s it descends while sinking

// Firing accuracy (half-spread, rad) by state: a halt is dead-on; walking wobbles; a canopy or an
// idle swim is wild. Spread is drawn from world.rng so it stays deterministic across the network.
export const INFANTRY_SPREAD_STANDING = 0 // aimed from a dead halt
export const INFANTRY_SPREAD_WALKING = 0.06 // fires on the move, less accurate
export const INFANTRY_SPREAD_PARACHUTE = 0.7 // swinging under the canopy — the worst aim in the game
export const INFANTRY_SPREAD_SWIM = 0.34 // treading water, barely aimed
export const INFANTRY_SWIM_FIRE_INTERVAL = 2.4 // s between shots while drifting (standby — slow)
// Running: a landed trooper sprints clear of a point-blank threat, and never fires while running.
export const INFANTRY_RUN_SPEED = 60 // px/s flee speed (faster than the walk patrol)
export const INFANTRY_PANIC_DIST = 80 // px: an enemy this close makes a landed trooper bolt
// Ice: a trooper on an icy surface occasionally loses its footing and slides a little.
export const INFANTRY_ICE_SLIP_CHANCE = 0.015 // per-frame chance to slip while standing on ice
export const INFANTRY_ICE_FALL_CHANCE = 0.45 // chance an icy skid ends in a pratfall (always-fall made ice unwalkable)
export const INFANTRY_SLIP_SPEED = 70 // px/s the slide starts at when a slip triggers
export const INFANTRY_SLIP_FRICTION = 1.2 // s^-1 decay of the slide (low → it glides for a moment)
export const INFANTRY_SLIP_STOP_SPEED = 4 // px/s below which a slide ends (snaps back to firm footing)
// Drowning is saveable: the owner can still scoop a sinking trooper this soon after it goes under.
export const INFANTRY_DROWN_RESCUE_WINDOW = 0.8 // s of the sink during which a rescue still works
// Fire: a flame-gout hit sets a trooper alight instead of killing outright. A burning trooper
// flails blindly (no fire discipline at all) until the timer burns down and it collapses; water
// douses it — a swim, or a friendly water-cannon squirt, saves the unit. Fire is contagious:
// it jumps to any trooper (either side) in near-contact, so everyone gives a burning man room.
export const INFANTRY_BURN_TIME = 3 // s a trooper burns before it collapses
export const INFANTRY_BURN_RUN_SPEED = 85 // px/s burning flail (faster than the panic sprint)
export const INFANTRY_BURN_TURN_CHANCE = 0.03 // per-frame chance the flail reverses direction
export const INFANTRY_FIRE_CATCH_RADIUS = 26 // px within which fire can jump trooper → trooper
export const INFANTRY_FIRE_CATCH_CHANCE = 0.06 // per-frame chance of catching inside that radius
export const INFANTRY_FIRE_PANIC_DIST = 110 // px: anyone alight (friend or foe) this close makes a trooper bolt
// A burning engine is an open flame: the exhaust plume behind a thrusting ship's nozzle sets any
// trooper it washes over alight (either side's — fire doesn't read uniforms), so infantry give a
// hot engine room and a ship coming in to load must cut thrust and LAND before the men approach.
export const AFTERBURNER_IGNITE_LEN = 30 // px the exhaust plume reaches behind the hull
export const AFTERBURNER_IGNITE_RADIUS = 12 // px half-width of the plume's ignition zone
export const RETRO_IGNITE_LEN = 18 // px each of the two smaller retro plumes reaches ahead of the nose
export const RETRO_IGNITE_RADIUS = 8 // px half-width of a retro plume's ignition zone
export const INFANTRY_THRUST_PANIC_DIST = 100 // px: a ship burning ANY engine this close makes a landed trooper bolt
// EMP vs infantry: a popped orb seizes nearby troopers up — no walking, no firing — for the
// orb's disable time (the man-portable EMP carries its own shorter time).
export const EMP_STUN_RADIUS = 80 // px around the popped orb that stuns troopers
// Water cannon vs infantry: the jet doesn't kill — it knocks a unit off its feet into a skid
// (the ice-slide mechanic) and douses any fire on it. The skid impulse is the bullet's push.
export const INFANTRY_WASH_PUSH_MAX = 240 // px/s cap on the accumulated water-jet skid

// ── Man-portable heavy weapons (squad specialists) ──────────────────────────
// One trooper in TROOP_SPECIALIST_CHANCE carries the squad's heavy kind — a scaled-down,
// shoulder-fired cousin of the ship weapon. Most plant themselves with the grenadier's
// kneel-brace-fire cycle; the mine sapper instead seeds its patrol path (no kneel, no target).
// Airborne/swimming specialists fall back to the rifle sidearm — the heavy only comes out landed.
export type InfantryHeavySpec = { interval: number; kneel: boolean }
export const INFANTRY_HEAVY: Record<WeaponKind, InfantryHeavySpec> = {
  [WeaponKind.SCATTERGUN]: { interval: 2.2, kneel: true },
  [WeaponKind.WATER_CANNON]: { interval: 2.0, kneel: true },
  [WeaponKind.FLAMETHROWER]: { interval: 2.6, kneel: true },
  [WeaponKind.SEEKER]: { interval: 4.5, kneel: true },
  [WeaponKind.RAIL]: { interval: 3.5, kneel: true },
  [WeaponKind.GRENADE]: { interval: 2.6, kneel: true }, // the original grenadier cadence
  [WeaponKind.MINES]: { interval: 8.0, kneel: false }, // plants along the patrol
  [WeaponKind.FLAK]: { interval: 4.0, kneel: true },
  [WeaponKind.EMP]: { interval: 5.0, kneel: true },
  [WeaponKind.SINGULARITY]: { interval: 10.0, kneel: true }, // rare, absurd, wonderful
}
// Scattergun trooper — a hand cannon's pellet cone.
export const INFANTRY_SCATTER_PELLETS = 4
export const INFANTRY_SCATTER_SPREAD = 0.3
export const INFANTRY_SCATTER_DAMAGE = 5
export const INFANTRY_SCATTER_SPEED = 420
export const INFANTRY_SCATTER_LIFE = 0.35
// Water-cannon trooper — a knockback squirt that wets terrain like the ship stream.
export const INFANTRY_WATER_SHOTS = 3
export const INFANTRY_WATER_SPREAD = 0.08
export const INFANTRY_WATER_PUSH = 60
export const INFANTRY_WATER_SPEED = 400
export const INFANTRY_WATER_DAMAGE = 1
export const INFANTRY_WATER_LIFE = 0.5
// Flamethrower trooper — a short flame fan that scorches grass and sets infantry alight.
export const INFANTRY_FLAME_PELLETS = 3
export const INFANTRY_FLAME_SPREAD = 0.2
export const INFANTRY_FLAME_DAMAGE = 2
export const INFANTRY_FLAME_SPEED = 320
export const INFANTRY_FLAME_LIFE = 0.45
// Seeker trooper — one shoulder-launched homing missile per brace.
export const INFANTRY_SEEKER_SPEED = 300
export const INFANTRY_SEEKER_TURN = 2.2
export const INFANTRY_SEEKER_LIFE = 3
export const INFANTRY_SEEKER_RADIUS = 4
export const INFANTRY_SEEKER_DAMAGE = 18
export const INFANTRY_SEEKER_BLAST = 50
export const INFANTRY_SEEKER_BLAST_DAMAGE = 10
// Rail sniper — a scaled hitscan lance from the kneel.
export const INFANTRY_RAIL_RANGE = 700
export const INFANTRY_RAIL_DAMAGE = 30
// Mine sapper — area denial seeded at its feet while patrolling.
export const INFANTRY_MINE_RADIUS = 4
export const INFANTRY_MINE_ARM = 1.2
export const INFANTRY_MINE_TRIGGER = 50
export const INFANTRY_MINE_BLAST = 70
export const INFANTRY_MINE_DAMAGE = 25
// Flak trooper — a slow shell that airbursts into the standard shard ring.
export const INFANTRY_FLAK_SPEED = 320
// EMP trooper — base defense: a slow orb that locks a strafing ship's controls.
export const INFANTRY_EMP_SPEED = 240
export const INFANTRY_EMP_LIFE = 2
export const INFANTRY_EMP_RADIUS = 5
export const INFANTRY_EMP_DISABLE = 1.2
export const INFANTRY_EMP_DRAIN = 20
// Singularity trooper — a pocket gravity well lobbed a short way toward the target.
export const INFANTRY_WELL_DIST = 140
export const INFANTRY_WELL_LIFE = 2.5
export const INFANTRY_WELL_RADIUS = 5
export const INFANTRY_WELL_PULL = 200
export const INFANTRY_WELL_STRENGTH = 40000

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

// ── Water as a per-cell fluid ────────────────────────────────────────────────
// Water lives on the voxel grid as a per-cell fill level (a Uint8 0..WATER_CELL_FULL parallel to
// the destructible `mat`), and FLOWS each tick: a cell drains into the empty cell below, else
// spreads sideways to equalize, so water seeks the lowest point, levels out, and pours off ledges.
// The motion is deterministic (fixed scan order, alternating L/R per tick, no rng) and runs only on
// an active-set of wet/moving cells, so settled water (the sea at rest) costs nothing per frame.
export const WATER_CELL_FULL = 255 // a brim-full cell (one VOXEL_CELL of depth). px depth = level/FULL * cell
export const WATER_MIN_LEVEL = 2 // levels below this evaporate to dry — kills 1-px shimmer films that never rest
export const WATER_SETTLE_EPS = 1 // |level - neighbour| at/under which two cells count as level (stop flowing)
export const WATER_POUR_LEVEL = 430 // level units a single water-cannon droplet injects (~POOL_FILL_AREA of old)
export const MAX_WATER_BODIES = 24 // legacy cap retained for the authored-water generator (terrain-map.ts)
// Basin scan window the authored-water generator still uses to seed pools at worldgen.
export const POOL_HALF_WIDTH = 40 // cells scanned each side for a containing rim
export const POOL_MAX_RISE = 30 // cells a basin rim may sit above the hit
export const POOL_MAX_DEPTH = 40 // cells below the hit searched for the basin floor
export const POOL_MIN_WIDTH = 2 // cells: ignore puddles narrower than this

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
// Surfaces transform without touching structure: a flame gout SETS grass ALIGHT rather than
// scorching it outright — the burning cell creeps fire to adjacent exposed grass (a deterministic
// wavefront, no rng) and only burns out to bare earth once its own timer is spent; a water hit
// douses burning cells back to grass; the water cannon wets bare earth, which regrows grass
// after SURFACE_REGROW_TIME of being wet.
export const SURFACE_REGROW_TIME = 6 // s a wetted bare-earth cell takes to regrow grass
export const GRASS_BURN_TIME = 3 // s a grass cell stays alight before it is spent to bare earth
export const GRASS_FIRE_SPREAD_AFTER = 0.8 // s into a cell's burn at which the fire jumps to adjacent grass
export const GRASS_FIRE_EMBERS = 3 // ember puffs sampled per frame across ALL burning cells (particle budget)

// ── Terrain landing model ─────────────────────────────────────────────────
// On contact the ship is classified by `impact` = closing speed (px/s) along the
// surface normal: gentle → land (rest + slide), middling → bounce, hard → crash.
export const LAND_SPEED = 130 // impact below this rests the ship on the surface
export const CRASH_SPEED = 430 // impact at/above this destroys the ship (costs a life)
export const BOUNCE_RESTITUTION = 0.45 // fraction of normal velocity kept on a mid-speed bounce
// A non-fatal wall smack (a bounce — impact between LAND_SPEED and CRASH_SPEED) now dents the hull:
// damage = (impact - LAND_SPEED) × this, so a glancing tap barely stings (mostly shields) while a
// near-crash takes a real bite. Shields soak it first; a crash still just kills outright.
export const WALL_DAMAGE_SCALE = 0.2 // hull points per px/s of impact above the gentle-landing threshold

// Per-second tangential damping applied while a ship is resting on a surface, keyed by the
// block's SURFACE: ICE keeps almost all speed (slippery), the others grip and shed it quickly.
// Bare metal anchors carry surface EARTH, so they grip like earth. WATER is never a resting
// surface (it is a WaterBody), included only for enum exhaustiveness.
export const SURFACE_FRICTION: Record<Surface, number> = {
  [Surface.EARTH]: 6,
  [Surface.GRASS]: 7,
  [Surface.ICE]: 0.3,
  [Surface.FIRE]: 7, // still grass underfoot — it grips like grass while it burns
}
