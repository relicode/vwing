import type { BaseAlarm, DeviceKind, GamePhase, ShipKind, StructureType, Surface, WeaponKind } from '$/game/constants'

export type Vec2 = { x: number; y: number }

// A seeded pseudo-random generator returning a float in [0, 1).
export type Rng = () => number

// A Newtonian body in the dogfight. PvP-ready: the world holds a list of ships.
export type Ship = {
  id: number // owner tag matched against bullets so shots skip their firer
  kind: ShipKind // PLAYER (the camera-followed human) vs BOT (AI), drives render + victory rules
  x: number
  y: number
  vx: number
  vy: number
  angle: number // heading in radians; forward = (cos, sin)
  radius: number
  thrusting: boolean // drives the engine-flame render (and the exhaust's trooper ignition)
  reversing: boolean // retro nozzles braking — two smaller forward plumes, same fire hazard
  fireCooldown: number // s until the next shot is allowed
  invuln: number // s of remaining spawn invulnerability
  health: number // hull points; ship is destroyed at <= 0
  shields: number // absorbs damage before hull, regenerates over time
  weapon: WeaponKind // current random secondary, rerolled each respawn
  charge: number // secondary energy (0..SECONDARY_MAX_CHARGE); spent per use, regenerates
  altCooldown: number // s until the secondary can fire again
  disabled: number // s of EMP lockout remaining (no thrust/turn/fire)
  troops: number // troopers aboard (0..TROOP_BAY_CAPACITY; float — barracks loading accrues fractionally, deploy needs >= 1)
  squad: WeaponKind // the squad's specialist kind, rolled per (re)spawn independently of `weapon`
  deployCooldown: number // s until the next trooper can be dropped
  lastHitBy?: number // id of the ship whose fire last damaged this one (kill attribution); cleared on respawn
}

export type Bullet = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  life: number // s remaining
  owner: number // firing ship's id; cannot damage that ship
  damage: number // hp removed on a ship hit (primary = BULLET_DAMAGE)
  push?: number // knockback impulse applied to a hit ship (water cannon); washes a trooper into a skid
  burn?: boolean // flamethrower: scorches grass→earth on terrain hit (no carve), sets a hit trooper alight
  wet?: boolean // water cannon: wets earth→grass + pools on terrain hit (no carve), douses a burning trooper
  infantry?: boolean // small-arms round (rifle / specialist burst): passes the barracks band (the wall fight happens through the slits) — ship-class rounds are stopped by the walls and shell the defenders
  color?: number // render tint override (undefined = owner-based default)
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

// A discrete explosion the sim spawned THIS tick, recorded as a compact trigger (spawnExplosion's
// args, minus the rng) so a networked client can replay the burst locally. The particle field
// itself is purely cosmetic and never crosses the wire — only these triggers ride the snapshot.
export type FxBurst = {
  x: number
  y: number
  color: number
  count: number // particles to spawn (the burst's size/intensity)
}

// Deployed, world-resident entities — one Device[] array, switched on `kind`.
export type Device =
  | {
      kind: DeviceKind.MISSILE // seeker (homing) or EMP orb (turnRate 0, disableTime > 0)
      x: number
      y: number
      vx: number
      vy: number
      life: number
      owner: number
      radius: number
      turnRate: number // rad/s steering toward the nearest enemy; 0 = straight
      speed: number
      damage: number
      blastRadius: number
      blastDamage: number
      disableTime: number // > 0 → disables the target instead of (or besides) damaging
      shieldDrain: number
      color: number
    }
  | {
      kind: DeviceKind.MINE
      x: number
      y: number
      owner: number
      radius: number
      armTime: number // counts down; armed once <= 0
      life: number
      triggerRadius: number
      blastRadius: number
      damage: number
    }
  | {
      kind: DeviceKind.INFANTRY
      x: number
      y: number
      vx: number
      vy: number
      owner: number
      radius: number
      heavy?: WeaponKind // undefined = rifleman; set = specialist carrying that man-portable heavy (rolled on deploy)
      guard: boolean // a fielded base defender: holds inside its barracks firing out, leaves only to board (devices.ts)
      attached: boolean // true once it lands on a surface (then it patrols + shoots)
      wade: number // px of water over the footing while standing in the shallows (0 = dry); slows movement, never drowns
      swim: number // s of floating left while in water (0 = on land / airborne); drowns at 0
      sinking: number // s of sinking left after drowning (> 0 = a corpse descending + fading)
      chute: number // parachute: -1 = none; 0..1 = deployed openness while descending
      pickupLock: number // s before this unit can be picked up (anti instant re-grab) — also grants immunity from its own ship's ram
      walkDir: number // -1 / +1 patrol direction along the ground
      facing: number // -1 / +1 render facing (aim direction, else walk direction)
      groundLeft: number // patrol bound: left edge of the supporting block (world x)
      groundRight: number // patrol bound: right edge of the supporting block (world x)
      fireCooldown: number
      kneel: number // s of post-launch crouch remaining (grenadier braces to fire its bazooka)
      running: boolean // sprinting clear of a point-blank threat (holds fire); drives the run pose
      slide: number // px/s lateral slide from an ice slip or a water-jet wash (0 = firm footing); decays + holds fire
      burning: number // s of fire left before the trooper collapses (0 = not alight); water douses it
      stun: number // s of EMP seize-up remaining (a landed unit can't move or fire)
      fallen: number // s of knocked-flat left (blast shove / hard landing / icy pratfall) — can't move or fire while down
      storming: boolean // elected to an enemy base's battering crew — in CONTACT with a wall or its roof, unopposed, no threat near (stepBases re-marks each frame): the man plants there (patrol halts, weapon slung — no firing) for the renderer's pounding pose; never set online (DEATHMATCH has no bases)
      panic: number // s of spill-panic left: flung from a damaged hull it free-falls flailing (FALLING) and won't pull its chute until this elapses (0 = composed; ordinary deploys never panic)
    }
  | {
      kind: DeviceKind.GRENADE // gravity arc → shrapnel ring on fuse
      x: number
      y: number
      vx: number
      vy: number
      owner: number
      radius: number
      fuse: number
    }
  | {
      kind: DeviceKind.FLAK // straight shell → expanding ring airburst on fuse
      x: number
      y: number
      vx: number
      vy: number
      owner: number
      radius: number
      fuse: number
    }
  | {
      kind: DeviceKind.WELL // temporary gravity well pulling nearby ships
      x: number
      y: number
      owner: number
      radius: number
      life: number
      strength: number
      pullRadius: number
    }

// The deployed-trooper member of the union — the sim and the renderer both narrow to it.
export type InfantryDevice = Extract<Device, { kind: DeviceKind.INFANTRY }>

// Transient hitscan visual for the Rail Lance (damage is applied at spawn).
export type Beam = {
  x1: number
  y1: number
  x2: number
  y2: number
  life: number
  maxLife: number
  color: number
}

// A static, landable terrain rectangle (top-left + size) carrying its two independent layers:
// `structure` (EARTH destructible / METAL indestructible) drives destructibility, and `surface`
// (grass/earth/ice) drives landing friction + look. Greedily meshed from the voxel grid + anchors.
export type Block = {
  x: number
  y: number
  w: number
  h: number
  structure: StructureType
  surface: Surface
}

// A body of water: `y` is the surface (top), `h` the depth down to its bottom.
// A ship below the surface within the x-span gets buoyancy + drag (see water.ts).
export type WaterBody = {
  x: number
  y: number // surface (top) in world space
  w: number
  h: number // depth from the surface to the bottom
}

// A home barracks: it garrisons troopers for its HOLDER ship to load aboard, and is a lifeline —
// capturing it cuts the loser's respawns (see bases.ts). FRIENDLY to whoever holds it (deed owner,
// or whoever captured it) and HOSTILE to everyone else: the body is impenetrable (solid to every
// hull and to hostile infantry) and OPAQUE to gunfire, but the men within are its hitpoints — up to
// BASE_ACTIVE_DEFENDERS of the holder's defenders stand inside firing out, the rest wait in reserve
// (`garrison`), and a ship-class round striking the walls kills them by chance (shellBase). Only over
// an emptied fort can a hostile pilot's men in wall/roof contact run THEIR capture clock.
export type Base = {
  owner: number // the DEED — ship id this barracks was built for (sustains its respawns while it holds it)
  x: number // pad center, world px
  y: number // pad top surface, world px (the building sits on this line)
  garrison: number // RESERVE troopers (0..BASE_GARRISON_CAP; float) — fielded defenders are checked out of this
  // Per-attacker storm progress: hostile shipId → that pilot's OWN capture progress 0..1. Each rival
  // builds its own bar (no shared "the enemy" scalar), so 3+ raiders contest independently. A plain
  // Record, NOT a Map — world.bases is JSON.stringify'd into every WorldSnapshot, where a Map → {}.
  contest: Record<number, number>
  holderId?: number // current holder once captured; undefined = the deed owner holds it (see baseHolder)
  attritionClock: number // s countdown; fires one soldier loss per contestant when 2+ rivals storm at once
  alarm: BaseAlarm // threat sensor this tick (patrol / ship near / infantry near), set by stepBases — read by the bot
  door: number // s until the next defender can field out the door
}

// The full mutable simulation. Owned by the engine closure (never module-level).
// `ships` holds every combatant; ships[0] / kind PLAYER is the camera-followed human.
export type World = {
  time: number // s elapsed in the current run
  ships: Ship[]
  bullets: Bullet[]
  particles: Particle[]
  fx: FxBurst[] // discrete explosion triggers spawned THIS tick — replayed client-side over the net
  devices: Device[]
  beams: Beam[]
  blocks: Block[] // collision/render terrain — rectangles greedily meshed from the voxel grid + debris
  terrainVersion: number // bumped whenever `blocks` changes (carve / falling debris); drives render caching
  water: WaterBody[] // the rectangle view of the per-cell fluid the ship can submerge into
  waterVersion: number // bumped whenever `water` changes (flow / pour); drives the water-layer redraw alone
  bases: Base[] // home barracks (CAMPAIGN populates one per side; DEATHMATCH leaves it empty)
  shake: number // screen-shake amplitude (px); bumped by explosions, decays each frame
  rng: Rng
}

// The world as it is rendered: everything except the rng closure. The live sim passes a
// full `World` (assignable here); a networked client passes a deserialized snapshot, which
// never carries the rng because the client only draws — it never advances the sim.
export type RenderWorld = Omit<World, 'rng'>

// HUD-facing snapshot the React shell subscribes to.
export type EngineStatus = {
  phase: GamePhase
  score: number
  best: number
  weapon: WeaponKind // the PLAYER ship's current secondary
  charge: number // the PLAYER ship's secondary energy as a 0..100 percent (for the HUD bar)
  troops: number // whole troopers aboard the PLAYER ship (bay pips)
  squad: WeaponKind // the PLAYER squad's specialist kind
  homeCapture: number // enemy capture progress on the player's base, whole percent 0..100 (alarm)
  enemyCapture: number // the player's capture progress on the enemy base, whole percent 0..100
  respawnIn: number // whole seconds until the player's ship re-enters; 0 = flying
}
