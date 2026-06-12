import {
  BASE_ALERT_RANGE,
  BASE_ASSAULT_RATE,
  BASE_CAPTURE_RADIUS,
  BASE_CAPTURE_TIME,
  BASE_DOOR_INTERVAL,
  BASE_GARRISON_CAP,
  BASE_GARRISON_REGEN,
  BASE_GARRISON_START,
  BASE_GUARD_PATROL,
  BASE_GUARD_RESERVE,
  BASE_LOAD_RADIUS,
  BASE_REVERT_TIME,
  BASE_SORTIE_RANGE,
  BASE_STRUCTURE_ARMOR,
  BaseAlarm,
  BOT_ID,
  Color,
  DeviceKind,
  INFANTRY_PICKUP_SPEED,
  PLAYER_ID,
  TROOP_BAY_CAPACITY,
} from '$/game/constants'
import { spawnExplosion } from '$/game/particles'
import { basePadCenters } from '$/game/terrain-map'
import { spawnGuard } from '$/game/troops'
import type { Base, Device, World } from '$/game/types'

// The campaign's two home barracks, seated on the generator's flat pads (west = player,
// east = bot). DEATHMATCH never calls this — world.bases stays [] and every base rule is a no-op.
export const createCampaignBases = (): Base[] => {
  const [west, east] = basePadCenters()
  return [
    {
      owner: PLAYER_ID,
      x: west.x,
      y: west.y,
      garrison: BASE_GARRISON_START,
      capture: 0,
      alarm: BaseAlarm.PATROL,
      door: 0,
    },
    {
      owner: BOT_ID,
      x: east.x,
      y: east.y,
      garrison: BASE_GARRISON_START,
      capture: 0,
      alarm: BaseAlarm.PATROL,
      door: 0,
    },
  ]
}

// The side a base currently answers to: the capturer once fully taken, the original owner
// otherwise. The renderer paints the building this color, so the holder is who the building
// *is* in play — shelling exemptions and occlusion key off this, never off the deed.
export const baseHolder = (base: Base): number =>
  base.capture >= 1 && base.capturedBy !== undefined ? base.capturedBy : base.owner

// Ship weaponry shelling the building: `amount` weapon hit-points grind the housed garrison
// down through the walls' armor — but never below the guard reserve, and never once the
// garrison is already at or under it. The last men can only be stormed out by landed infantry
// (stepBases), so shelling softens a base without ever starting the capture clock by itself.
// A fallen barracks is past hurting; a whole housed trooper lost flashes red at the door.
export const damageBase = (world: World, base: Base, amount: number): void => {
  if (base.capture >= 1) return
  const floor = Math.min(base.garrison, BASE_GUARD_RESERVE)
  const before = base.garrison
  base.garrison = Math.max(floor, base.garrison - amount / BASE_STRUCTURE_ARMOR)
  if (Math.floor(before) > Math.floor(base.garrison)) {
    spawnExplosion(world.particles, base.x, base.y - 12, Color.BLOOD, world.rng, 6)
  }
}

// Advance every barracks one frame: threat posture + guard fielding (including throwing the
// doors open for a boarding owner), garrison regen, and the capture war. The garrison is the
// base's hitpoints — it walks its own pad as live guards (who hide indoors from ships and sortie
// against infantry), and attackers who clear the fielded defenders storm the building, killing
// the housed count down to zero before the capture timer can start. Loading is embodied: there
// is no counter transfer — the men step out, run to the landed ship, and board by touch (see
// devices.ts). Drop placement is still the whole skill — troopers only count while landed inside
// the disc, and they never pathfind toward it.
export const stepBases = (world: World, dt: number): void => {
  if (world.bases.length === 0) return
  // Last frame's storming marks expire — the capture war below re-marks the men still at it
  // (the flag is a pure render cue; nothing in the sim reads it back).
  for (const d of world.devices) {
    if (d.kind === DeviceKind.INFANTRY) d.storming = false
  }
  for (const base of world.bases) {
    const captured = base.capture >= 1

    // One pass over the devices: count this base's fielded guards and spot landed enemy
    // infantry close enough to warrant the sortie.
    let fielded = 0
    let enemyInfantryNear = false
    for (const d of world.devices) {
      if (d.kind !== DeviceKind.INFANTRY) continue
      if (d.owner === base.owner) {
        if (d.guard) fielded += 1
      } else if (d.attached && Math.hypot(d.x - base.x, d.y - base.y) <= BASE_SORTIE_RANGE) {
        enemyInfantryNear = true
      }
    }
    const enemyShipNear = world.ships.some(
      (s) => s.id !== base.owner && Math.hypot(s.x - base.x, s.y - base.y) <= BASE_ALERT_RANGE
    )
    // SORTIE outranks HIDE: troopers on the ground must be met even under an enemy ship's guns.
    base.alarm = enemyInfantryNear ? BaseAlarm.SORTIE : enemyShipNear ? BaseAlarm.HIDE : BaseAlarm.PATROL

    // Garrison replenishes only while the owner holds the base AND no ground battle is on —
    // nobody musters with enemies at the door (regen mid-assault would sustain a zombie
    // garrison hovering just under one man, stalling the capture clock forever). The cap
    // counts the whole defense (housed + fielded), so cycling guards out the door grows nothing.
    if (!captured && base.alarm !== BaseAlarm.SORTIE && base.garrison + fielded < BASE_GARRISON_CAP) {
      base.garrison = Math.min(BASE_GARRISON_CAP - fielded, base.garrison + BASE_GARRISON_REGEN * dt)
    }

    // A boarding call: the owner ship landed (or barely drifting) by the pad with room in the
    // bay throws the doors open. Loading is embodied — the men run to the hull and board by
    // touch (devices.ts) — so emptying the WHOLE garrison is the owner's call to make; only
    // the defensive sortie is bound by the reserve.
    const owner = world.ships.find((s) => s.id === base.owner)
    const loading =
      owner !== undefined &&
      !captured &&
      owner.troops < TROOP_BAY_CAPACITY &&
      Math.hypot(owner.vx, owner.vy) <= INFANTRY_PICKUP_SPEED &&
      Math.hypot(owner.x - base.x, owner.y - (base.y - 40)) <= BASE_LOAD_RADIUS

    // The door: guards step out on a cadence — a small standing patrol in peacetime (everyone,
    // down to an empty house, while the owner is boarding), everyone but the reserve when enemy
    // infantry close in, nobody while hiding from a ship (the recall back through the door lives
    // in devices.ts with the rest of the guard behaviour).
    base.door = Math.max(0, base.door - dt)
    if (!captured && base.door <= 0) {
      const wantsOut =
        base.alarm === BaseAlarm.SORTIE
          ? base.garrison >= BASE_GUARD_RESERVE + 1
          : base.alarm === BaseAlarm.PATROL && base.garrison >= 1 && (loading || fielded < BASE_GUARD_PATROL)
      if (wantsOut) {
        spawnGuard(world, base, world.ships.find((s) => s.id === base.owner)?.squad)
        base.garrison -= 1
        base.door = BASE_DOOR_INTERVAL
      }
    }

    // The capture war over the LANDED troopers inside the disc. Any defender freezes enemy
    // progress. Unopposed attackers first storm the building — each chips the housed garrison
    // (the base's hitpoints) — and only over an emptied barracks does the capture clock run
    // (crossing 1 records the capturer). An empty zone bleeds progress back — which is also how
    // a base is re-liberated (dropping below 1 clears capturedBy), so purging the zone with
    // ship guns alone wins the base back too.
    let attackers = 0
    let attackersDown = 0
    let defenders = 0
    let attackerId: number | undefined
    const stormers: Extract<Device, { kind: DeviceKind.INFANTRY }>[] = []
    for (const d of world.devices) {
      if (d.kind !== DeviceKind.INFANTRY || !d.attached) continue
      if (Math.hypot(d.x - base.x, d.y - base.y) > BASE_CAPTURE_RADIUS) continue
      // A man flat on his back (or EMP-seized) neither storms the door nor holds it — a blast
      // that floors the whole party really does interrupt the assault (or the defense). But a
      // downed man still OCCUPIES: he's counted apart so a won pad isn't un-captured (and a
      // dead-waiting capturer isn't eliminated) by one knockdown ring over men who are alive
      // and about to stand back up.
      const down = d.fallen > 0 || d.stun > 0
      if (d.owner === base.owner) {
        if (!down) defenders += 1
      } else if (down) {
        attackersDown += 1
      } else {
        attackers += 1
        attackerId = d.owner
        stormers.push(d)
      }
    }
    if (attackers > 0 && defenders === 0) {
      // The men at work taking the building — grinding the garrison or running the clock — turn
      // to face the door and mark for the renderer's comic pounding. Occupiers of an already-won
      // pad (this same branch, forever after capture) are holding it, not storming it.
      if (!captured) {
        for (const s of stormers) {
          s.storming = true
          if (s.x !== base.x) s.facing = s.x < base.x ? 1 : -1
        }
      }
      // Storming only matters while the base still stands — a fallen barracks' count is frozen.
      if (!captured && base.garrison > 0) {
        const before = base.garrison
        base.garrison = Math.max(0, base.garrison - BASE_ASSAULT_RATE * attackers * dt)
        // A whole housed trooper lost: a red flash at the door sells the storming.
        if (Math.floor(before) > Math.floor(base.garrison)) {
          spawnExplosion(world.particles, base.x, base.y - 12, Color.BLOOD, world.rng, 6)
        }
      }
      // A fraction of a man isn't a defender (the same floor a deploy uses): the clock starts
      // once the last whole housed trooper is dead, while the residue bleeds out underneath.
      if (base.garrison < 1) {
        base.capture = Math.min(1, base.capture + dt / BASE_CAPTURE_TIME)
        if (base.capture >= 1) base.capturedBy = attackerId
      }
    } else if (attackers === 0 && attackersDown === 0 && base.capture > 0) {
      base.capture = Math.max(0, base.capture - dt / BASE_REVERT_TIME)
      if (base.capture < 1) base.capturedBy = undefined
    }
  }
}
