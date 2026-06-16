import { fireRail } from '$/game/beams'
import { spawnBurst } from '$/game/bullets'
import {
  Color,
  DeviceKind,
  EMP_DISABLE_TIME,
  EMP_LIFE,
  EMP_RADIUS,
  EMP_SHIELD_DRAIN,
  EMP_SPEED,
  FLAK_FUSE,
  FLAK_RADIUS,
  FLAK_SPEED,
  FLAMETHROWER_DAMAGE,
  FLAMETHROWER_LIFE,
  FLAMETHROWER_PELLETS,
  FLAMETHROWER_SPEED,
  FLAMETHROWER_SPREAD,
  GRENADE_FUSE,
  GRENADE_RADIUS,
  GRENADE_SPEED,
  MINE_ARM_TIME,
  MINE_BLAST_RADIUS,
  MINE_COUNT,
  MINE_DAMAGE,
  MINE_LIFE,
  MINE_RADIUS,
  MINE_TRIGGER_RADIUS,
  SCATTERGUN_DAMAGE,
  SCATTERGUN_LIFE,
  SCATTERGUN_PELLETS,
  SCATTERGUN_SPEED,
  SCATTERGUN_SPREAD,
  SEEKER_BLAST_DAMAGE,
  SEEKER_BLAST_RADIUS,
  SEEKER_COUNT,
  SEEKER_DAMAGE,
  SEEKER_LIFE,
  SEEKER_RADIUS,
  SEEKER_SPEED,
  SEEKER_TURN_RATE,
  WATER_CANNON_DAMAGE,
  WATER_CANNON_LIFE,
  WATER_CANNON_PUSH,
  WATER_CANNON_SPEED,
  WATER_CANNON_SPREAD,
  WEAPON_CONFIG,
  WEAPON_POOL,
  WELL_DEPLOY_DIST,
  WELL_LIFE,
  WELL_PULL_RADIUS,
  WELL_RADIUS,
  WELL_STRENGTH,
  WeaponKind,
} from '$/game/constants'
import { pick, randRange } from '$/game/rng'
import type { Rng, Ship, World } from '$/game/types'

// Roll a fresh random secondary for a (re)spawning ship.
export const assignWeapon = (rng: Rng): WeaponKind => pick(rng, WEAPON_POOL)

// Bare lowercase alphanumerics of a weapon's enum value — its canonical URL slug ('WATER_CANNON' → 'watercannon').
const weaponSlug = (kind: WeaponKind): string => kind.toLowerCase().replace(/[^a-z0-9]/g, '')

// Resolve a URL-friendly slug to its WeaponKind, separator- and case-insensitively, so
// 'watercannon', 'water-cannon', 'water_cannon' and 'Water Cannon' all land on WATER_CANNON.
// Returns undefined for an unrecognized weapon (caller falls back to a random roll).
export const weaponFromSlug = (slug: string): WeaponKind | undefined => {
  const norm = slug.toLowerCase().replace(/[^a-z0-9]/g, '')
  return WEAPON_POOL.find((kind) => weaponSlug(kind) === norm)
}

// Read a preselected secondary from a location hash like `#special-weapon=watercannon` (a QA /
// deep-link convenience). Undefined when the param is absent or names no weapon — i.e. random.
export const weaponFromHash = (hash: string): WeaponKind | undefined => {
  const slug = new URLSearchParams(hash.replace(/^#/, '')).get('special-weapon')
  return slug ? weaponFromSlug(slug) : undefined
}

const noseX = (ship: Ship): number => ship.x + Math.cos(ship.angle) * ship.radius
const noseY = (ship: Ship): number => ship.y + Math.sin(ship.angle) * ship.radius

const spawnSeekers = (world: World, ship: Ship): void => {
  for (let i = 0; i < SEEKER_COUNT; i += 1) {
    const angle = ship.angle + randRange(world.rng, -0.4, 0.4)
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    world.devices.push({
      kind: DeviceKind.MISSILE,
      x: noseX(ship),
      y: noseY(ship),
      // Launch at the missile's own constant speed (homing maintains it) — no inherited
      // platform velocity, so the seeker doesn't visibly snap-decelerate on frame one.
      vx: dirX * SEEKER_SPEED,
      vy: dirY * SEEKER_SPEED,
      life: SEEKER_LIFE,
      owner: ship.id,
      radius: SEEKER_RADIUS,
      turnRate: SEEKER_TURN_RATE,
      speed: SEEKER_SPEED,
      damage: SEEKER_DAMAGE,
      blastRadius: SEEKER_BLAST_RADIUS,
      blastDamage: SEEKER_BLAST_DAMAGE,
      disableTime: 0,
      shieldDrain: 0,
      color: Color.MISSILE,
    })
  }
}

const spawnEmp = (world: World, ship: Ship): void => {
  const dirX = Math.cos(ship.angle)
  const dirY = Math.sin(ship.angle)
  world.devices.push({
    kind: DeviceKind.MISSILE, // a slow, non-homing orb that disables instead of damaging
    x: noseX(ship),
    y: noseY(ship),
    vx: ship.vx + dirX * EMP_SPEED,
    vy: ship.vy + dirY * EMP_SPEED,
    life: EMP_LIFE,
    owner: ship.id,
    radius: EMP_RADIUS,
    turnRate: 0,
    speed: EMP_SPEED,
    damage: 0,
    blastRadius: 0,
    blastDamage: 0,
    disableTime: EMP_DISABLE_TIME,
    shieldDrain: EMP_SHIELD_DRAIN,
    color: Color.EMP,
  })
}

const spawnGrenade = (world: World, ship: Ship): void => {
  const dirX = Math.cos(ship.angle)
  const dirY = Math.sin(ship.angle)
  world.devices.push({
    kind: DeviceKind.GRENADE,
    x: noseX(ship),
    y: noseY(ship),
    vx: ship.vx + dirX * GRENADE_SPEED,
    vy: ship.vy + dirY * GRENADE_SPEED,
    owner: ship.id,
    radius: GRENADE_RADIUS,
    fuse: GRENADE_FUSE,
  })
}

const spawnFlak = (world: World, ship: Ship): void => {
  const dirX = Math.cos(ship.angle)
  const dirY = Math.sin(ship.angle)
  world.devices.push({
    kind: DeviceKind.FLAK,
    x: noseX(ship),
    y: noseY(ship),
    vx: ship.vx + dirX * FLAK_SPEED,
    vy: ship.vy + dirY * FLAK_SPEED,
    owner: ship.id,
    radius: FLAK_RADIUS,
    fuse: FLAK_FUSE,
  })
}

const spawnMines = (world: World, ship: Ship): void => {
  for (let i = 0; i < MINE_COUNT; i += 1) {
    world.devices.push({
      kind: DeviceKind.MINE,
      x: ship.x + randRange(world.rng, -20, 20),
      y: ship.y + randRange(world.rng, -20, 20),
      owner: ship.id,
      radius: MINE_RADIUS,
      armTime: MINE_ARM_TIME,
      life: MINE_LIFE,
      triggerRadius: MINE_TRIGGER_RADIUS,
      blastRadius: MINE_BLAST_RADIUS,
      damage: MINE_DAMAGE,
    })
  }
}

const spawnWell = (world: World, ship: Ship): void => {
  world.devices.push({
    kind: DeviceKind.WELL,
    x: ship.x + Math.cos(ship.angle) * WELL_DEPLOY_DIST,
    y: ship.y + Math.sin(ship.angle) * WELL_DEPLOY_DIST,
    owner: ship.id,
    radius: WELL_RADIUS,
    life: WELL_LIFE,
    strength: WELL_STRENGTH,
    pullRadius: WELL_PULL_RADIUS,
  })
}

// Fire the ship's current secondary. Self-guards energy/cooldown/disabled, spends the
// weapon's energy cost, and arms the cooldown. Returns ships hit *instantly* (Rail only)
// so the engine can reap them — spawn-based weapons resolve later in their own passes.
export const fireSecondary = (world: World, ship: Ship): Ship[] => {
  const config = WEAPON_CONFIG[ship.weapon]
  if (ship.charge < config.cost || ship.altCooldown > 0 || ship.disabled > 0) return []
  ship.charge -= config.cost
  ship.altCooldown = config.cooldown

  switch (ship.weapon) {
    case WeaponKind.SCATTERGUN:
      spawnBurst(world.bullets, ship, world.rng, {
        count: SCATTERGUN_PELLETS,
        spread: SCATTERGUN_SPREAD,
        speed: SCATTERGUN_SPEED,
        life: SCATTERGUN_LIFE,
        damage: SCATTERGUN_DAMAGE,
        color: Color.SHRAPNEL,
      })
      return []
    case WeaponKind.WATER_CANNON:
      spawnBurst(world.bullets, ship, world.rng, {
        count: 1,
        spread: WATER_CANNON_SPREAD,
        speed: WATER_CANNON_SPEED,
        life: WATER_CANNON_LIFE,
        damage: WATER_CANNON_DAMAGE,
        push: WATER_CANNON_PUSH,
        wet: true, // wets bare earth → grass and pools in basins on a terrain hit
        color: Color.WATER_EDGE,
      })
      return []
    case WeaponKind.FLAMETHROWER:
      spawnBurst(world.bullets, ship, world.rng, {
        count: FLAMETHROWER_PELLETS,
        spread: FLAMETHROWER_SPREAD,
        speed: FLAMETHROWER_SPEED,
        life: FLAMETHROWER_LIFE,
        damage: FLAMETHROWER_DAMAGE,
        burn: true, // scorches grass → bare earth on a terrain hit; sets a hit trooper alight
        color: Color.THRUST,
      })
      return []
    case WeaponKind.RAIL: {
      const hit = fireRail(world, ship)
      return hit ? [hit] : []
    }
    case WeaponKind.SEEKER:
      spawnSeekers(world, ship)
      return []
    case WeaponKind.EMP:
      spawnEmp(world, ship)
      return []
    case WeaponKind.GRENADE:
      spawnGrenade(world, ship)
      return []
    case WeaponKind.FLAK:
      spawnFlak(world, ship)
      return []
    case WeaponKind.MINES:
      spawnMines(world, ship)
      return []
    case WeaponKind.SINGULARITY:
      spawnWell(world, ship)
      return []
  }
}
