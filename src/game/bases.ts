import {
  BASE_ALERT_RANGE,
  BASE_ASSAULT_RATE,
  BASE_BUILDING_HALF_WIDTH,
  BASE_BUILDING_HEIGHT,
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
  BASE_STORM_CONTACT,
  BASE_STORM_ROOF_SLOTS,
  BASE_STORM_THREAT_RANGE,
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
import type { Base, InfantryDevice, World } from '$/game/types'

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
// *is* in play — wall exemptions and occlusion key off this, never off the deed.
export const baseHolder = (base: Base): number =>
  base.capture >= 1 && base.capturedBy !== undefined ? base.capturedBy : base.owner

// The bunker's body box (top-left + size). This one rectangle IS the building everywhere:
// the drawn shape, the wall that stops ships / bullets / beams / projectiles, the solid the
// enemy infantry collide with, and the shelter the holder's men are safe inside.
export const baseBuilding = (base: Base): { x: number; y: number; w: number; h: number } => ({
  x: base.x - BASE_BUILDING_HALF_WIDTH,
  y: base.y - BASE_BUILDING_HEIGHT,
  w: BASE_BUILDING_HALF_WIDTH * 2,
  h: BASE_BUILDING_HEIGHT,
})

// A live threat near the pad, from the STORMERS' point of view: any enemy-of-raider ship, or
// any enemy-of-raider trooper still on its feet (downed/seized/drowned men scare nobody —
// airborne ones count: an incoming defender drop is exactly what a stormer breaks off for).
// While one is near, nobody storms — the men down tools and fight the threat instead.
export const stormThreatNear = (world: World, base: Base, raiderId: number): boolean => {
  if (world.ships.some((s) => s.id !== raiderId && Math.hypot(s.x - base.x, s.y - base.y) <= BASE_STORM_THREAT_RANGE)) {
    return true
  }
  return world.devices.some(
    (d) =>
      d.kind === DeviceKind.INFANTRY &&
      d.owner !== raiderId &&
      d.sinking <= 0 &&
      d.fallen <= 0 &&
      d.stun <= 0 &&
      Math.hypot(d.x - base.x, d.y - base.y) <= BASE_STORM_THREAT_RANGE
  )
}

// Where a landed trooper touches the building, if anywhere: pressed to a wall (its leading edge
// within BASE_STORM_CONTACT of the face, body below the roofline) or standing on the roof.
// Storming is gated on this — only men actually at the structure can batter it.
export const stormContact = (base: Base, d: InfantryDevice): 'left' | 'right' | 'roof' | undefined => {
  const b = baseBuilding(base)
  if (Math.abs(d.y + d.radius - b.y) <= BASE_STORM_CONTACT && d.x >= b.x && d.x <= b.x + b.w) return 'roof'
  if (d.y + d.radius <= b.y) return undefined // above the roofline but off the roof: nothing to press
  if (d.x < base.x && Math.abs(b.x - (d.x + d.radius)) <= BASE_STORM_CONTACT) return 'left'
  if (d.x > base.x && Math.abs(d.x - d.radius - (b.x + b.w)) <= BASE_STORM_CONTACT) return 'right'
  return undefined
}

// Advance every barracks one frame: threat posture + guard fielding (including throwing the
// doors open for a boarding owner), garrison regen, and the capture war. The garrison is the
// base's hitpoints — it walks the building's shelter as live guards (who hide indoors from
// ships and sortie against infantry), and attackers who clear the fielded defenders batter
// the building by CONTACT — one man pressed to each wall, a roof party of three — killing
// the housed count down to zero before the capture timer can start. Loading is embodied: there
// is no counter transfer — the men step out, run to the landed ship, and board by touch (see
// devices.ts). Drop placement is still the whole skill — troopers only count while landed inside
// the disc, and they never pathfind toward it.
export const stepBases = (world: World, dt: number): void => {
  if (world.bases.length === 0) return
  // Last frame's storming marks expire — the capture war below re-marks the men still at it.
  // The flag drives the renderer's pounding pose AND plants the man (patrolInfantry holds a
  // marked man at the door instead of wandering him around the disc).
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
    // progress. Unopposed attackers storm the building by CONTACT — one man battering each
    // wall plus a roof party chips the housed garrison (the base's hitpoints) — and only over
    // an emptied barracks does the capture clock run (crossing 1 records the capturer). An
    // empty zone bleeds progress back — which is also how a base is re-liberated (dropping
    // below 1 clears capturedBy), so purging the zone with ship guns alone wins the base back.
    let attackers = 0
    let attackersDown = 0
    let defenders = 0
    let attackerId: number | undefined
    const raiders: InfantryDevice[] = []
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
        raiders.push(d)
      }
    }
    if (attackers > 0 && defenders === 0) {
      // The battering crew: contact only — the FIRST man pressed to each wall (one per side)
      // and the first BASE_STORM_ROOF_SLOTS standing on the roof. Everyone else in the disc is
      // occupation, not demolition. And the work stops cold while a live threat (enemy ship or
      // trooper) is near the pad: stormers down tools and fight instead — devices.ts reads the
      // expired mark and releases them back to their weapons.
      if (!captured && attackerId !== undefined && !stormThreatNear(world, base, attackerId)) {
        const crew: InfantryDevice[] = []
        let leftTaken = false
        let rightTaken = false
        let roofTaken = 0
        for (const s of raiders) {
          const contact = stormContact(base, s)
          if (contact === 'left' && !leftTaken) {
            leftTaken = true
            crew.push(s)
          } else if (contact === 'right' && !rightTaken) {
            rightTaken = true
            crew.push(s)
          } else if (contact === 'roof' && roofTaken < BASE_STORM_ROOF_SLOTS) {
            roofTaken += 1
            crew.push(s)
          }
        }
        // The crew marks for the renderer's comic pounding (and devices.ts holds its fire —
        // both hands are on the building). The turn-to-the-door applies only in the poses the
        // renderer actually swaps (kneel ≤ 0 && !running && no slide ⟺ stateOf WALKING/STANDING
        // for a marked man): a kneeling specialist keeps squaring up to his target and a
        // bolting or skidding man keeps the heading his legs are selling.
        for (const s of crew) {
          s.storming = true
          if (s.kneel <= 0 && !s.running && s.slide === 0 && s.x !== base.x) {
            s.facing = s.x < base.x ? 1 : -1
          }
        }
        // Battering only matters while the base still stands — a fallen barracks' count is
        // frozen. A whole housed trooper lost: a red flash at the door sells the storming.
        if (base.garrison > 0 && crew.length > 0) {
          const before = base.garrison
          base.garrison = Math.max(0, base.garrison - BASE_ASSAULT_RATE * crew.length * dt)
          if (Math.floor(before) > Math.floor(base.garrison)) {
            spawnExplosion(world.particles, base.x, base.y - 12, Color.BLOOD, world.rng, 6)
          }
        }
      }
      // A fraction of a man isn't a defender (the same floor a deploy uses): the clock starts
      // once the last whole housed trooper is dead, while the residue bleeds out underneath.
      // Deliberately NOT threat-gated: the clock is occupation, not battering — a hostile in
      // the wider threat ring makes the men down tools, but only a defender INSIDE the disc
      // contests the ground itself.
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
