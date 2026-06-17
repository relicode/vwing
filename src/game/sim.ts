import {
  baseBuilding,
  baseHolder,
  createBase,
  createCampaignBases,
  shellBase,
  shelteredInBase,
  stepBases,
} from '$/game/bases'
import { updateBeams } from '$/game/beams'
import { spawnBullet, updateBullets } from '$/game/bullets'
import { circleRectContact, circlesOverlap } from '$/game/collision'
import { applyDamage, applyKnockback, isDead } from '$/game/combat'
import {
  BASE_LOAD_RADIUS,
  BOT_KILL_SCORE,
  CARVE_RADIUS_BASE,
  CARVE_RADIUS_SCALE,
  Color,
  DEATHMATCH_FRAG_SCORE,
  DeviceKind,
  FLAMETHROWER_BURN_RADIUS,
  GRASS_FIRE_EMBERS,
  INFANTRY_BURN_TIME,
  INFANTRY_PICKUP_SPEED,
  INFANTRY_WASH_PUSH_MAX,
  LAND_SPEED,
  RESPAWN_DELAY_BASE,
  RESPAWN_DELAY_GROWTH,
  SHAKE_DECAY,
  SHIP_DEATH_SHAKE,
  SHIP_FIRE_INTERVAL,
  SHIP_HULL_REPAIR,
  SHIP_MAX_HEALTH,
  SHIP_RADIUS,
  SHIP_SMOKE_HEALTH,
  SHIP_SPAWN_CLEAR_RADIUS,
  ShipKind,
  SimMode,
  SMOKE_LIFE,
  SPAWN_ALTITUDE,
  SPAWN_ANCHOR_FRACS_X,
  SPAWN_ANCHOR_FRACS_Y,
  SPLASH_MIN_SPEED,
  SPLASH_PARTICLES,
  StructureType,
  Surface,
  TERRAIN_SALT,
  THRUST_PARTICLE_LIFE,
  THRUST_PARTICLE_SPEED,
  TROOP_BAY_CAPACITY,
  TROOP_DEPLOY_COOLDOWN,
  WALL_DAMAGE_SCALE,
  WATER_CANNON_WET_RADIUS,
  WATER_POUR_LEVEL,
  type WeaponKind,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import { resolveInfantryContacts, updateDevices } from '$/game/devices'
import type { Input } from '$/game/input'
import { clamp } from '$/game/math'
import { burst, spawnExplosion, spawnPuff, updateParticles } from '$/game/particles'
import { createRng, randRange } from '$/game/rng'
import { respawnShipAt, type ShipEnv, updateShip } from '$/game/ship'
import { resolveShipTerrain } from '$/game/terrain'
import { createTerrain } from '$/game/terrain-map'
import { spawnTrooper, spillTroops } from '$/game/troops'
import type { Base, Bullet, Ship, Vec2, World } from '$/game/types'
import {
  carveVoxel,
  createVoxelTerrain,
  douseSurface,
  fluidToBodies,
  igniteSurface,
  pourWater,
  restoreVoxel,
  sealWaterRect,
  snapshotVoxel,
  stepVoxel,
  stepWater,
  type VoxelSnapshot,
  voxelToBlocks,
  wetSurface,
} from '$/game/voxel'
import { submersion, waterSurfaceAt } from '$/game/water'
import { fireSecondary } from '$/game/weapons'

// Pairs a ship with whatever drives it plus its match bookkeeping. The sim owns these;
// `world.ships` is kept in lockstep (the same Ship objects) for the rest of the pipeline.
export type Combatant = {
  ship: Ship
  input: Input
  name: string
  score: number // points (CAMPAIGN) / frags (DEATHMATCH)
  deaths: number // deaths this run — drives the compounding respawn delay (survives a bench/restore)
  spawn: Vec2 // CAMPAIGN home respawn point
}

// A combatant died this frame. The caller maps it to its own bookkeeping (HUD, kill feed,
// game-over) and, on the network, to a client-side explosion at (x, y). `killerId` is
// undefined for environmental deaths (terrain crash / wall).
export type DeathEvent = {
  victimId: number
  victimKind: ShipKind
  killerId: number | undefined
  eliminated: boolean // CAMPAIGN: no base left to respawn from — out of the run (never true in DEATHMATCH)
  x: number // death location (the networked client spawns the wreck explosion here)
  y: number
}

export type SimConfig = {
  mode: SimMode
  forcedWeapon?: WeaponKind // debug: pins every ship's secondary when set
}

export type Sim = {
  world: World
  combatants: Combatant[]
  config: SimConfig
  step: (dt: number) => DeathEvent[]
  // Seat a combatant; respawnIn > 0 keeps its ship out of the world until the clock elapses
  // (a reclaimed or restored seat that was mid-respawn). keepDevices leaves the combatant's
  // deployed troopers/mines fighting on (a benched seat, not a gone one).
  addCombatant: (combatant: Combatant, opts?: { respawnIn?: number }) => void
  removeCombatant: (id: number, keepDevices?: boolean) => void
  getCombatant: (id: number) => Combatant | undefined
  respawnIn: (id: number) => number // s until the combatant's ship re-enters; 0 = alive (or gone)
  // The online BATTLE war seats bases per pilot: addBase stands one barracks for `owner` on `pad`
  // (sealing its watertight footprint, like construction does for the campaign pair); removeBase
  // tears down the owner's barracks when the seat leaves. CAMPAIGN/DEATHMATCH manage world.bases
  // at construction and never call these.
  addBase: (owner: number, pad: Vec2) => Base
  removeBase: (owner: number) => void
  // Terrain persistence: the carved voxel state as plain JSON, and its overlay onto a sim
  // rebuilt from the SAME world seed (false = snapshot didn't fit; nothing was touched).
  serializeTerrain: () => VoxelSnapshot
  restoreTerrain: (snap: VoxelSnapshot) => boolean
}

// A blank arena: seeded rng + the procedurally generated terrain, with empty entity lists. Ships
// are attached by the sim from its combatants.
export const createWorld = (seed: number): World => {
  // Generate the arena once, off a salted sub-stream, so it's deterministic per seed (identical on
  // server + client) without consuming draws from the run's main rng (which feeds combat/particles).
  const { blocks, water } = createTerrain(createRng((seed ^ TERRAIN_SALT) >>> 0))
  return {
    time: 0,
    ships: [],
    bullets: [],
    particles: [],
    fx: [],
    devices: [],
    beams: [],
    blocks,
    terrainVersion: 0,
    water,
    waterVersion: 0,
    bases: [],
    shake: 0,
    rng: createRng(seed),
  }
}

// Candidate respawn anchors spread across the open upper airspace (DEATHMATCH picks the one
// farthest from live enemies), derived from the same fracs the terrain keep-outs use. Blocked
// points are skipped at pick-time, so a few sitting inside islands are harmless.
const SPAWN_POINTS: readonly Vec2[] = SPAWN_ANCHOR_FRACS_X.flatMap((fx) =>
  SPAWN_ANCHOR_FRACS_Y.map((fy) => ({ x: WORLD_WIDTH * fx, y: WORLD_HEIGHT * fy }))
)

const pointBlocked = (world: World, x: number, y: number, r: number): boolean => {
  const surface = waterSurfaceAt(world.water, x, y)
  if (surface !== undefined && y + r >= surface) return true // at/under a water surface — not a dry spawn
  return world.blocks.some((b) => circleRectContact(x, y, r, b.x, b.y, b.w, b.h) !== undefined)
}

// The open spawn anchor farthest from every `occupant` (so a (re)spawn isn't a face-off).
// Blocked anchors are skipped; falls back to the first anchor if all are blocked.
export const chooseSpawn = (world: World, occupants: readonly Ship[]): Vec2 => {
  let best: Vec2 = SPAWN_POINTS[0]
  let bestGap = -1
  for (const point of SPAWN_POINTS) {
    if (pointBlocked(world, point.x, point.y, SHIP_RADIUS * 2)) continue
    let nearest = Number.POSITIVE_INFINITY
    for (const ship of occupants) nearest = Math.min(nearest, Math.hypot(ship.x - point.x, ship.y - point.y))
    if (nearest > bestGap) {
      bestGap = nearest
      best = point
    }
  }
  return best
}

// DEATHMATCH ships carry a full bay per life (no barracks online yet); CAMPAIGN ships
// spawn empty and load up at their home barracks — that round-trip IS the infantry loop.
const refillBay = (ship: Ship, mode: SimMode): void => {
  ship.troops = mode === SimMode.DEATHMATCH ? TROOP_BAY_CAPACITY : 0
}

export const createSim = (world: World, combatants: Combatant[], config: SimConfig): Sim => {
  world.ships = combatants.map((combatant) => combatant.ship)
  for (const { ship } of combatants) refillBay(ship, config.mode)
  // The campaign is the base war: one barracks per side. DEATHMATCH stays baseless (frags only),
  // which short-circuits every base/capture rule below into a no-op.
  if (config.mode === SimMode.CAMPAIGN) world.bases = createCampaignBases()
  const submergedShips = new Set<number>() // ids currently underwater, for splash-on-crossing
  const eliminated = new Set<number>() // ids removed from play this run (CAMPAIGN, no base left)
  // Dying costs time, and it compounds: the wreck leaves the sky and the combatant waits out a
  // delay that grows with every death already suffered (the reinforcement clock).
  const awaiting = new Set<number>() // ids whose ships are out of the world, waiting to respawn
  const pending: { combatant: Combatant; at: number }[] = []
  // Read `water` live: pooling can replace world.water with a new array mid-run, so a one-time
  // snapshot would go stale and ship buoyancy would miss freshly pooled water.
  const env: ShipEnv = {
    get water() {
      return world.water
    },
  }

  // The destructible terrain is authoritative; `world.blocks` is the rectangle view derived
  // from it (for collision, rendering, and the network snapshot).
  const voxel = createVoxelTerrain(world.blocks, world.water)
  // The barracks are watertight: their footprint is solid to the fluid (as it already is to hulls),
  // so poured/rising water sheds off the roof and flows around the walls instead of drowning the
  // sheltered defenders. Bases are static, so this is sealed once here (and re-sealed on restore).
  for (const base of world.bases) sealWaterRect(voxel, baseBuilding(base))
  let terrainDirty = false // a carve happened this frame; refresh derived blocks before drawing
  let waterDirty = false // water was poured this frame (the flow tick may also flag movement)
  const refreshTerrain = (): void => {
    world.blocks = voxelToBlocks(voxel)
    world.terrainVersion += 1
  }
  // world.water is the rectangle view of the per-cell fluid, rebuilt whenever the water moves; the
  // waterVersion bump tells the renderer to redraw the water layer ALONE — terrain chunks and the
  // server's terrain-persist cache (both keyed on terrainVersion) aren't disturbed by water flowing.
  const refreshWater = (): void => {
    world.water = fluidToBodies(voxel)
    world.waterVersion += 1
  }
  refreshTerrain()
  refreshWater()

  // Burning grass sheds embers: a few cells sampled per frame — not one per cell, so even a
  // broad fire line stays inside the particle budget (the FIRE surface itself sells the area).
  const emberBurningGrass = (): void => {
    if (voxel.burning.size === 0) return
    const cells = [...voxel.burning.keys()]
    for (let n = 0; n < GRASS_FIRE_EMBERS; n += 1) {
      const i = cells[Math.floor(world.rng() * cells.length)]
      const x = (i % voxel.cols) * voxel.cell + voxel.cell / 2
      const y = Math.floor(i / voxel.cols) * voxel.cell // the cell's top — flames lick up off the skin
      spawnPuff(
        world.particles,
        x + randRange(world.rng, -voxel.cell / 2, voxel.cell / 2),
        y,
        0,
        -randRange(world.rng, 30, 80),
        world.rng() < 0.5 ? Color.THRUST : Color.EXPLOSION,
        world.rng,
        0.45
      )
    }
  }

  const getCombatant = (id: number): Combatant | undefined => combatants.find((c) => c.ship.id === id)

  // The open spawn anchor farthest from every live enemy (so a respawn isn't a face-off).
  const pickSpawn = (exceptId: number): Vec2 => {
    const enemies = combatants.filter((c) => c.ship.id !== exceptId && !eliminated.has(c.ship.id)).map((c) => c.ship)
    return chooseSpawn(world, enemies)
  }

  // Every base sustaining a combatant's respawns: simply the bases it HOLDS — its own deed while it
  // still holds it, plus any enemy barracks it has captured (baseHolder folds both cases into one).
  const controlledBases = (id: number): Base[] => world.bases.filter((b) => baseHolder(b) === id)

  // The base-war noose: a side controlling no base has no reinforcements left. Always false in
  // baseless (DEATHMATCH) worlds.
  const noBaseLeft = (id: number): boolean => world.bases.length > 0 && controlledBases(id).length === 0

  // Where a reinforcement re-enters: DEATHMATCH picks the open anchor farthest from live
  // enemies; CAMPAIGN musters above a base the side still controls — the home pad while it
  // stands, else a pad it captured. undefined = no base left to muster at.
  const spawnFor = (vc: Combatant): Vec2 | undefined => {
    if (config.mode === SimMode.DEATHMATCH) return pickSpawn(vc.ship.id)
    if (world.bases.length === 0) return vc.spawn
    const held = controlledBases(vc.ship.id)
    if (held.some((b) => b.owner === vc.ship.id)) return vc.spawn // home stands — the usual pad
    const taken = held[0]
    return taken ? { x: taken.x, y: taken.y - SPAWN_ALTITUDE } : undefined
  }

  // Clear deployed ORDNANCE around a fresh spawn so a respawn isn't an instant re-death.
  // Infantry is spared: the muster point hangs SPAWN_ALTITUDE over the pad, and with the
  // battering crew now perched on the (taller) roof, a radius wipe would hand the defender a
  // free storm-clear on every respawn — the ground war is settled by men, not by mustering.
  const clearSpawnArea = (x: number, y: number): void => {
    world.devices = world.devices.filter(
      (device) =>
        device.kind === DeviceKind.INFANTRY || Math.hypot(device.x - x, device.y - y) > SHIP_SPAWN_CLEAR_RADIUS
    )
  }

  // Blow up a downed ship: credit the killer, then queue its respawn (or, in CAMPAIGN,
  // eliminate it once it holds no base). Guarded so a ship already reaped this frame isn't
  // killed twice.
  const killShip = (victim: Ship, killerId: number | undefined, events: DeathEvent[]): void => {
    if (eliminated.has(victim.id) || awaiting.has(victim.id)) return
    const vc = getCombatant(victim.id)
    if (!vc) return
    const deathX = victim.x // captured before respawn relocates the ship (for the death event)
    const deathY = victim.y
    const color = victim.kind === ShipKind.BOT ? Color.ENEMY : Color.SHIP
    // NOT routed through burst(): the networked client already replays the wreck from the
    // DeathEvent below (in the victim's own seat color), so adding it to world.fx would double it.
    spawnExplosion(world.particles, victim.x, victim.y, color, world.rng, 34)
    world.shake = Math.max(world.shake, SHIP_DEATH_SHAKE)

    const killer = killerId !== undefined && killerId !== victim.id ? getCombatant(killerId) : undefined
    // CAMPAIGN scores assault POINTS (BOT_KILL_SCORE); the frag-driven modes (DEATHMATCH and the
    // online BATTLE war) tick the scoreboard a flat frag per kill.
    if (killer) killer.score += config.mode === SimMode.CAMPAIGN ? BOT_KILL_SCORE : DEATHMATCH_FRAG_SCORE

    // The base-war noose: respawns flow from holding a base. A side that controls none — its
    // own barracks lost and no enemy barracks taken — has no reinforcements left, and dying in
    // that state is elimination. DEATHMATCH worlds are baseless, so the noose never closes
    // there: respawns are endless, only ever slower.
    const isEliminated = noBaseLeft(victim.id)
    if (isEliminated) {
      eliminated.add(victim.id)
      // Drop the wreck from the world so nothing keeps targeting (or drawing) a ghost.
      world.ships = world.ships.filter((ship) => ship.id !== victim.id)
    } else {
      // The reinforcement clock: the wreck leaves the sky and the respawn waits — 5 s more for
      // every death already suffered this run, without ceiling. Attrition IS the cost of dying.
      vc.deaths += 1
      const delay = RESPAWN_DELAY_BASE + (vc.deaths - 1) * RESPAWN_DELAY_GROWTH
      awaiting.add(victim.id)
      pending.push({ combatant: vc, at: world.time + delay })
      world.ships = world.ships.filter((ship) => ship.id !== victim.id)
      victim.lastHitBy = undefined
    }
    events.push({
      victimId: victim.id,
      victimKind: victim.kind,
      killerId: killer?.ship.id,
      eliminated: isEliminated,
      x: deathX,
      y: deathY,
    })
  }

  // A shot striking an enemy ship: spark, damage, attribute, and reap on hull depletion.
  // Returns true when the bullet is spent. Invulnerable / eliminated / respawn-waiting ships
  // and the firer skip.
  const bulletHitShip = (bullet: Bullet, events: DeathEvent[]): boolean => {
    for (const { ship } of combatants) {
      if (ship.id === bullet.owner || ship.invuln > 0 || eliminated.has(ship.id) || awaiting.has(ship.id)) continue
      if (!circlesOverlap(bullet.x, bullet.y, bullet.radius, ship.x, ship.y, ship.radius)) continue
      applyDamage(ship, bullet.damage)
      ship.lastHitBy = bullet.owner
      if (bullet.push) applyKnockback(ship, bullet.vx, bullet.vy, bullet.push)
      burst(world, bullet.x, bullet.y, bullet.color ?? Color.SPARK, 5)
      if (isDead(ship)) killShip(ship, ship.lastHitBy, events)
      return true
    }
    return false
  }

  // Devices/rail report ships they dealt lethal damage to; reap them by their last attacker.
  const reap = (victim: Ship, events: DeathEvent[]): void => {
    if (isDead(victim)) killShip(victim, victim.lastHitBy, events)
  }

  // A bullet that misses every ship is tested against terrain: it's consumed on contact, and a
  // destructible surface (rock/grass/ice) takes a crater sized to the shot — chunks that lose
  // their footing then fall. Bedrock just sparks and stops the shot.
  const resolveBulletHits = (events: DeathEvent[]): void => {
    const surviving: Bullet[] = []
    for (const bullet of world.bullets) {
      if (bulletHitShip(bullet, events)) continue
      // Friendly fire is real: a bullet hits whatever trooper it meets, whoever fired it
      // (infantry fire from the muzzle, clear of their own bodies, and hold the trigger when a
      // friend stands in the lane — see devices.ts). A defender sheltering inside its own
      // building is the exception: no round reaches it directly — the wall takes the hit, and
      // shellBase rolls the casualty below.
      const unit = world.devices.findIndex(
        (d) =>
          d.kind === DeviceKind.INFANTRY &&
          !shelteredInBase(world, d.owner, d.x, d.y) &&
          circlesOverlap(bullet.x, bullet.y, bullet.radius, d.x, d.y, d.radius)
      )
      if (unit >= 0) {
        const inf = world.devices[unit]
        if (inf.kind === DeviceKind.INFANTRY && bullet.wet) {
          // The water jet doesn't kill a trooper — it douses any fire on it and washes it off
          // its feet into a skid (airborne/swimming units just get shoved).
          inf.burning = 0
          const dir = bullet.vx >= 0 ? 1 : -1
          if (inf.attached) {
            inf.slide = clamp(inf.slide + dir * (bullet.push ?? 0), -INFANTRY_WASH_PUSH_MAX, INFANTRY_WASH_PUSH_MAX)
            inf.kneel = 0 // knocked out of any brace
          } else {
            inf.vx += dir * (bullet.push ?? 0) * 0.5
          }
          burst(world, inf.x, inf.y, Color.WATER_EDGE, 5)
        } else if (inf.kind === DeviceKind.INFANTRY && bullet.burn) {
          // A flame gout sets the trooper alight rather than killing outright — the burn
          // timer (and the panicked flailing) takes it from here. Wet units can't catch.
          if (inf.swim <= 0 && inf.sinking <= 0) inf.burning = INFANTRY_BURN_TIME
          burst(world, inf.x, inf.y, Color.THRUST, 5)
        } else {
          burst(world, inf.x, inf.y, Color.BLOOD, 6)
          world.devices.splice(unit, 1)
        }
        continue
      }
      // Ship fire vs the barracks building: the walls are OPAQUE — every ship-class round (water
      // and flame gouts included) is stopped where it strikes, never passing through. It no longer
      // hurts nothing: shellBase rolls a sheltered defender's death by chance proportional to the
      // round's damage — and friendly fire counts (a holder shelling its own pad culls its own
      // garrison). Only small-arms rounds are exempt: the wall fight happens through the slits, so
      // rifles cross the band both ways (that is how the defenders fire out).
      const struckBase = bullet.infantry
        ? undefined
        : world.bases.find((b) => {
            const r = baseBuilding(b)
            return circleRectContact(bullet.x, bullet.y, bullet.radius, r.x, r.y, r.w, r.h) !== undefined
          })
      if (struckBase) {
        shellBase(world, struckBase, bullet.damage)
        burst(world, bullet.x, bullet.y, Color.SPARK, 5)
        continue
      }
      // Prefer a destructible (EARTH) contact: blocks list bedrock first, so taking the first
      // match would let an indestructible seam shadow the earth a corner shot also touches.
      let hit = -1
      for (let i = 0; i < world.blocks.length; i += 1) {
        const b = world.blocks[i]
        if (!circleRectContact(bullet.x, bullet.y, bullet.radius, b.x, b.y, b.w, b.h)) continue
        if (b.structure === StructureType.EARTH) {
          hit = i
          break
        }
        if (hit < 0) hit = i
      }
      if (hit >= 0) {
        const block = world.blocks[hit]
        if (bullet.burn) {
          // Flamethrower: set the grass ALIGHT (surface only, no carve) — the fire then creeps
          // on its own through the voxel fire tick — with a lick of flame at the impact.
          if (igniteSurface(voxel, bullet.x, bullet.y, FLAMETHROWER_BURN_RADIUS)) terrainDirty = true
          burst(world, bullet.x, bullet.y, Color.THRUST, 7)
        } else if (bullet.wet && block.structure === StructureType.EARTH) {
          // Water cannon on EARTH: douse any grass alight, wet bare earth → grass (regrows over time,
          // no carve), and POUR a droplet's worth of real water into the grid at the impact — it then
          // flows, pools, and levels on its own through the fluid tick. METAL (bedrock + the home-base
          // pads) is impervious: water just splashes off it (below) and never pools on the bunker pad,
          // so firing at a base no longer dumps a sheet on its roof that pours off the edges.
          if (douseSurface(voxel, bullet.x, bullet.y, WATER_CANNON_WET_RADIUS)) terrainDirty = true
          wetSurface(voxel, bullet.x, bullet.y, WATER_CANNON_WET_RADIUS)
          pourWater(voxel, bullet.x, bullet.y, WATER_POUR_LEVEL)
          waterDirty = true
          burst(world, bullet.x, bullet.y, Color.WATER_EDGE, 6)
        } else if (bullet.wet) {
          // Water cannon on metal: it can't soak in or pool on the indestructible pad — just a splash.
          burst(world, bullet.x, bullet.y, Color.WATER_EDGE, 4)
        } else if (block.structure === StructureType.EARTH) {
          const radius = bullet.radius * CARVE_RADIUS_SCALE + CARVE_RADIUS_BASE
          if (carveVoxel(voxel, bullet.x, bullet.y, radius)) terrainDirty = true
          burst(world, bullet.x, bullet.y, Color.ROCK_EDGE, 8)
        } else {
          // Indestructible metal: just sparks.
          burst(world, bullet.x, bullet.y, Color.SPARK, 4)
        }
        continue
      }
      surviving.push(bullet)
    }
    world.bullets = surviving
  }

  // Land/bounce/crash each ship against terrain; a hard crash kills, a softer wall smack just dents
  // the hull (scaled by impact — shields soak first). Both spare a flashing (invuln) ship: terrain
  // still pushes it out of penetration, it just can't crash or be dented while spawn-protected.
  // The barracks buildings are solid to EVERY hull (the owner sets down beside his own pad, or
  // on the roof) and indestructible besides — flying into one is flying into bedrock.
  const resolveTerrain = (dt: number, events: DeathEvent[]): void => {
    const solids =
      world.bases.length === 0
        ? world.blocks
        : world.blocks.concat(
            world.bases.map((b) => ({ ...baseBuilding(b), structure: StructureType.METAL, surface: Surface.EARTH }))
          )
    for (const { ship } of combatants) {
      if (eliminated.has(ship.id) || awaiting.has(ship.id)) continue
      const { result, impact } = resolveShipTerrain(ship, solids, dt)
      if (ship.invuln > 0) continue // flashing: shoved clear but immune to the crash and the dent
      if (result === 'crash') killShip(ship, undefined, events)
      else if (result === 'bounce') applyDamage(ship, (impact - LAND_SPEED) * WALL_DAMAGE_SCALE)
    }
  }

  const step = (dt: number): DeathEvent[] => {
    const events: DeathEvent[] = []
    world.fx = [] // this tick's discrete FX bursts, collected for the network snapshot (see burst())
    if (world.shake > 0) world.shake = Math.max(0, world.shake - SHAKE_DECAY * dt)
    world.time += dt
    // Reinforcements whose wait has elapsed re-enter (the spawn point is picked NOW, against the
    // world as it is, not as it was at the moment of death). A side whose last base falls while
    // the clock runs is eliminated on the spot — by design, even though its surviving troopers
    // could still have re-liberated the pad before the timer ran out: baseless-while-dead ends
    // the run the same instant it would at the moment of death.
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const doomed = noBaseLeft(pending[i].combatant.ship.id)
      if (!doomed && world.time < pending[i].at) continue
      const { combatant: vc } = pending.splice(i, 1)[0]
      awaiting.delete(vc.ship.id)
      const spawn = doomed ? undefined : spawnFor(vc)
      if (!spawn) {
        // The noose closed mid-wait: the side's last held base fell while the clock ran. The
        // reinforcement never arrives — that is elimination, reported like any other death.
        eliminated.add(vc.ship.id)
        events.push({
          victimId: vc.ship.id,
          victimKind: vc.ship.kind,
          killerId: undefined,
          eliminated: true,
          x: vc.ship.x,
          y: vc.ship.y,
        })
        continue
      }
      respawnShipAt(vc.ship, spawn.x, spawn.y, world.rng, config.forcedWeapon)
      refillBay(vc.ship, config.mode)
      clearSpawnArea(vc.ship.x, vc.ship.y)
      world.ships.push(vc.ship)
    }
    // Snapshot hull HP before this tick's damage resolves: any ship that ends the tick with less hull
    // than it started took a hit, and a hit rattles troopers loose from its bay (spillTroops, end of
    // step). Captured here — ahead of the combatant loop — so a same-tick rail/secondary strike counts;
    // base repair only nudges hull UP, never down, so it never reads as a hit.
    const hullBefore = new Map<number, number>()
    for (const ship of world.ships) hullBefore.set(ship.id, ship.health)
    for (const { ship, input: control } of combatants) {
      if (eliminated.has(ship.id) || awaiting.has(ship.id)) continue
      updateShip(ship, control, dt, env)
      // Hull mends ONLY while docked at a base you still hold — fly home, set down by the pad, and
      // patch up (the same dock the troop bay loads at). In the field a battered ship stays battered
      // (and sluggish to steer) until it limps home or dies; nothing else repairs hull damage.
      if (ship.health < SHIP_MAX_HEALTH) {
        const home = world.bases.find((b) => baseHolder(b) === ship.id)
        if (
          home &&
          Math.hypot(ship.vx, ship.vy) <= INFANTRY_PICKUP_SPEED &&
          Math.hypot(ship.x - home.x, ship.y - (home.y - 40)) <= BASE_LOAD_RADIUS
        ) {
          ship.health = Math.min(SHIP_MAX_HEALTH, ship.health + SHIP_HULL_REPAIR * dt)
        }
      }
      if (ship.thrusting) {
        const bx = -Math.cos(ship.angle)
        const by = -Math.sin(ship.angle)
        spawnPuff(
          world.particles,
          ship.x + bx * ship.radius,
          ship.y + by * ship.radius,
          bx * THRUST_PARTICLE_SPEED,
          by * THRUST_PARTICLE_SPEED,
          Color.THRUST,
          world.rng,
          THRUST_PARTICLE_LIFE
        )
      }
      if (ship.reversing) {
        // The retro nozzles spit a smaller ember stream forward past the nose.
        const fx = Math.cos(ship.angle)
        const fy = Math.sin(ship.angle)
        spawnPuff(
          world.particles,
          ship.x + fx * ship.radius,
          ship.y + fy * ship.radius,
          fx * THRUST_PARTICLE_SPEED * 0.7,
          fy * THRUST_PARTICLE_SPEED * 0.7,
          Color.THRUST,
          world.rng,
          THRUST_PARTICLE_LIFE * 0.7
        )
      }
      if (ship.health < SHIP_SMOKE_HEALTH && ship.invuln <= 0) {
        spawnPuff(world.particles, ship.x, ship.y, 0, -30, Color.SMOKE, world.rng, SMOKE_LIFE)
      }
      const surface = waterSurfaceAt(world.water, ship.x, ship.y)
      if (surface !== undefined) {
        const wet = submersion(ship, world.water) > 0
        if (wet !== submergedShips.has(ship.id) && Math.abs(ship.vy) > SPLASH_MIN_SPEED) {
          burst(world, ship.x, surface, Color.WATER_EDGE, SPLASH_PARTICLES)
        }
        if (wet) submergedShips.add(ship.id)
        else submergedShips.delete(ship.id)
      }
      // A freshly (re)spawned ship strobes invulnerable — it can't be hit, so it can't shoot
      // either (no firing from behind the spawn shield).
      if (control.firing() && ship.fireCooldown <= 0 && ship.disabled <= 0 && ship.invuln <= 0) {
        spawnBullet(world.bullets, ship)
        ship.fireCooldown = SHIP_FIRE_INTERVAL
      }
      if (control.altFiring()) for (const killed of fireSecondary(world, ship)) reap(killed, events)
      if (control.deploying() && ship.troops >= 1 && ship.deployCooldown <= 0 && ship.disabled <= 0) {
        spawnTrooper(world, ship)
        ship.troops -= 1
        ship.deployCooldown = TROOP_DEPLOY_COOLDOWN
      }
    }
    world.bullets = updateBullets(world.bullets, dt)
    for (const killed of updateDevices(world, dt)) reap(killed, events)
    updateBeams(world, dt)
    world.particles = updateParticles(world.particles, dt)
    resolveBulletHits(events)
    resolveTerrain(dt, events)
    resolveInfantryContacts(world)
    stepBases(world, dt)
    emberBurningGrass()
    // Advance loosed terrain chunks + the grass fire; rebuild the derived blocks if the terrain
    // changed this frame.
    const debrisMoved = stepVoxel(voxel, dt)
    if (terrainDirty || debrisMoved) {
      refreshTerrain() // a carve / debris settle changed the solid grid (and woke any water it touched)
      terrainDirty = false
    }
    // Flow the per-cell water (carves, pours, and debris this frame have already woken the cells it
    // owns); rebuild the rectangle view whenever water appeared or moved so it draws + reads current.
    const waterMoved = stepWater(voxel)
    if (waterDirty || waterMoved) {
      refreshWater()
      waterDirty = false
    }
    // A hull breach this tick shakes the bay: each survivor that ends with less hull than it started
    // spills a few panicked troopers. Done here — outside every entity loop — so the fresh devices
    // land cleanly in world.devices, and only for ships that lived (a downed ship's bay dies with it).
    for (const ship of world.ships) {
      const before = hullBefore.get(ship.id)
      if (before !== undefined && ship.health < before) spillTroops(world, ship)
    }
    return events
  }

  const addCombatant = (combatant: Combatant, opts?: { respawnIn?: number }): void => {
    combatants.push(combatant)
    const wait = opts?.respawnIn ?? 0
    if (wait > 0) {
      // The seat re-enters mid-wait: keep the ship out of the world and let the normal
      // reinforcement dequeue respawn it when the remaining clock elapses.
      awaiting.add(combatant.ship.id)
      pending.push({ combatant, at: world.time + wait })
      return
    }
    refillBay(combatant.ship, config.mode)
    world.ships.push(combatant.ship)
  }

  const removeCombatant = (id: number, keepDevices = false): void => {
    const index = combatants.findIndex((c) => c.ship.id === id)
    if (index < 0) return
    combatants.splice(index, 1)
    world.ships = world.ships.filter((ship) => ship.id !== id)
    // A benched seat's troopers/mines keep fighting (keepDevices); a gone combatant's are dropped.
    if (!keepDevices) world.devices = world.devices.filter((device) => device.owner !== id)
    eliminated.delete(id)
    submergedShips.delete(id)
    awaiting.delete(id)
    const queued = pending.findIndex((p) => p.combatant.ship.id === id)
    if (queued >= 0) pending.splice(queued, 1)
  }

  const respawnIn = (id: number): number => {
    const queued = pending.find((p) => p.combatant.ship.id === id)
    return queued ? Math.max(0, queued.at - world.time) : 0
  }

  // Stand a fresh barracks for `owner` on `pad` mid-match (the online base war seats one per pilot
  // as they join). Sealing its footprint keeps the fluid out of the shelter exactly as the
  // construction pass does for the campaign pair, then the rect view is rebuilt so any water that
  // had been sitting on the spot is evicted this tick rather than next.
  // Drop any fielded guards belonging to `owner` — they belong to a barracks, not the field, so a
  // base teardown (or a stale set restored from a persisted blob / a prior base instance) must not
  // leave them standing to be miscounted as a fresh fort's defenders (stepBases tallies guards by
  // owner id). The owner's deployed FIELD troopers (guard === false) are untouched — they fight on.
  const standDownGuards = (owner: number): void => {
    world.devices = world.devices.filter((d) => !(d.kind === DeviceKind.INFANTRY && d.guard && d.owner === owner))
  }

  const addBase = (owner: number, pad: Vec2): Base => {
    standDownGuards(owner) // clear any ghosts before the fresh fort fields its own line
    const base = createBase(owner, pad)
    world.bases.push(base)
    sealWaterRect(voxel, baseBuilding(base))
    refreshWater()
    return base
  }

  // Tear down `owner`'s barracks when its seat leaves the match. The watertight seal on the old
  // footprint is left in place (there is no unseal, and the footprint sits on the indestructible
  // metal pad in open air — a harmless invisible dry column). Its guards stand down with it, and any
  // capture `owner` held over ANOTHER base is released — otherwise that base reads as captured by a
  // ghost and its rightful holder, controlling no base, becomes wrongly eligible for elimination.
  const removeBase = (owner: number): void => {
    world.bases = world.bases.filter((b) => b.owner !== owner)
    for (const base of world.bases) {
      delete base.contest[owner] // drop this pilot's in-flight assault progress on every other base
      if (base.holderId === owner) {
        // it had CAPTURED another base → that fort reverts to its deed owner. Otherwise it would read
        // as held by a ghost, wrongly making its rightful owner (controlling no base) elimination-eligible.
        base.holderId = undefined
      }
    }
    standDownGuards(owner)
  }

  const serializeTerrain = (): VoxelSnapshot => snapshotVoxel(voxel)

  const restoreTerrain = (snap: VoxelSnapshot): boolean => {
    if (!restoreVoxel(voxel, snap)) return false
    refreshTerrain()
    // Re-seal the watertight barracks footprints — the wall mask isn't persisted, and a pre-fix
    // snapshot may even carry water that had pooled inside the shelter; sealing evicts it.
    for (const base of world.bases) sealWaterRect(voxel, baseBuilding(base))
    refreshWater() // the snapshot carried the fluid grid too — rebuild its rectangle view
    return true
  }

  return {
    world,
    combatants,
    config,
    step,
    addCombatant,
    removeCombatant,
    getCombatant,
    respawnIn,
    addBase,
    removeBase,
    serializeTerrain,
    restoreTerrain,
  }
}
