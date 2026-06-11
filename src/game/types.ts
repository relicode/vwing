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
      guard: boolean // a base-garrison sentry: patrols its barracks, hides indoors from enemy ships, never boards a ship
      attached: boolean // true once it lands on a surface (then it patrols + shoots)
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

// A home barracks: it garrisons troopers for its owner ship to load aboard, and is the
// side's lifeline — enemy troopers capturing it cut the owner's respawns (see bases.ts).
// The garrison doubles as the base's hitpoints: it fields live guards around the pad, and
// attackers who clear them whittle the housed count before the capture timer can start.
export type Base = {
  owner: number // ship id whose respawns this barracks sustains
  x: number // pad center, world px
  y: number // pad top surface, world px (the building sits on this line)
  garrison: number // housed troopers (0..BASE_GARRISON_CAP; float accumulator) — the base's HP pool
  capture: number // enemy capture progress 0..1; >= 1 = captured (respawns cut)
  capturedBy?: number // capturing ship id while captured; undefined = the owner holds it
  alarm: BaseAlarm // the garrison's posture this tick (patrol / hide indoors / sortie), set by stepBases
  door: number // s until the next guard can step out the door
}

// The full mutable simulation. Owned by the engine closure (never module-level).
// `ships` holds every combatant; ships[0] / kind PLAYER is the camera-followed human.
export type World = {
  time: number // s elapsed in the current run
  ships: Ship[]
  bullets: Bullet[]
  particles: Particle[]
  devices: Device[]
  beams: Beam[]
  blocks: Block[] // collision/render terrain — rectangles greedily meshed from the voxel grid + debris
  terrainVersion: number // bumped whenever `blocks` changes (carve / falling debris); drives render caching
  water: WaterBody[] // bodies the ship can submerge into
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
