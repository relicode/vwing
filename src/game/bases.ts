import {
  BASE_ACTIVE_DEFENDERS,
  BASE_ALERT_RANGE,
  BASE_BUILDING_HALF_WIDTH,
  BASE_BUILDING_HEIGHT,
  BASE_CAPTURE_RADIUS,
  BASE_DOOR_INTERVAL,
  BASE_GARRISON_CAP,
  BASE_GARRISON_REGEN,
  BASE_GARRISON_START,
  BASE_LOAD_RADIUS,
  BASE_REVERT_TIME,
  BASE_SHELL_KILL_DAMAGE,
  BASE_SORTIE_RANGE,
  BASE_STORM_CONTACT,
  BASE_STORM_ROOF_SLOTS,
  BASE_STORM_SIDE_TIME,
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
import type { Base, InfantryDevice, Vec2, World } from '$/game/types'

// One fresh barracks for `owner`, seated on a generator pad at full reserve. The single base
// builder, shared by the campaign's fixed pair and the online base war's dynamic per-seat
// allocation (sim.addBase) — so both spawn identical, regen-ready forts.
export const createBase = (owner: number, pad: Vec2): Base => ({
  owner,
  x: pad.x,
  y: pad.y,
  garrison: BASE_GARRISON_START,
  capture: 0,
  alarm: BaseAlarm.PATROL,
  door: 0,
})

// The campaign's two home barracks, seated on the generator's first two flat pads (index 0 = west
// player, index 1 = east bot). DEATHMATCH never calls this — world.bases stays [] and every base
// rule is a no-op; the online BATTLE war builds its bases per seat via sim.addBase instead.
export const createCampaignBases = (): Base[] => {
  const [west, east] = basePadCenters()
  return [createBase(PLAYER_ID, west), createBase(BOT_ID, east)]
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

// A point lying within the building's body — used to spot the defenders manning its shelter.
const insideBuilding = (base: Base, x: number, y: number): boolean => {
  const b = baseBuilding(base)
  return x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h
}

// A trooper standing inside a building its own side holds: sheltered from outside fire, blasts,
// and rams (only shellBase's chance roll can touch it). One-sided by construction — the building
// is solid to its enemies, so a hostile can never be inside someone else's shelter. Shared by the
// sim's bullet path, the rail caster, and the device step.
export const shelteredInBase = (world: World, owner: number, x: number, y: number): boolean =>
  world.bases.some((base) => baseHolder(base) === owner && insideBuilding(base, x, y))

// A ship-class round / blast / lance striking the building. The walls are OPAQUE (the round
// never passes through) but no longer indestructible to the men within: this kills ONE sheltered
// defender at a chance proportional to the round's damage (min(1, damage / BASE_SHELL_KILL_DAMAGE))
// — sheltered defenders die ONLY this way, never to a direct hit. A fielded defender (a live
// device inside) is the visible casualty; failing that a reserve man falls (stepBases re-mans the
// line from reserve next tick). A captured or already-empty fort shrugs the round off. Rolls on
// world.rng so the sim stays deterministic on the server and under test.
export const shellBase = (world: World, base: Base, damage: number): void => {
  if (base.capture >= 1 || damage <= 0) return
  if (world.rng() >= Math.min(1, damage / BASE_SHELL_KILL_DAMAGE)) return
  const idx = world.devices.findIndex(
    (d) =>
      d.kind === DeviceKind.INFANTRY &&
      d.guard &&
      d.owner === base.owner &&
      d.sinking <= 0 &&
      insideBuilding(base, d.x, d.y)
  )
  if (idx >= 0) {
    const d = world.devices[idx]
    spawnExplosion(world.particles, d.x, d.y, Color.BLOOD, world.rng, 6)
    world.devices.splice(idx, 1)
  } else if (base.garrison >= 1) {
    base.garrison -= 1
    spawnExplosion(world.particles, base.x, base.y - 12, Color.BLOOD, world.rng, 6)
  }
}

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

// Advance every barracks one frame: the threat sensor, defender fielding (manning the firing
// line inside, or streaming out to a boarding owner), reserve regen, and the capture war. The
// DEFENDERS are the base's hitpoints — up to BASE_ACTIVE_DEFENDERS stand inside the shelter and
// fire out (devices.ts), the rest wait in reserve (`garrison`). Ship fire that strikes the
// building kills them by chance (shellBase, called from the bullet/beam/blast paths); only over
// an EMPTIED fort do unopposed attackers in wall/roof contact run the capture clock. Loading is
// embodied: there is no counter transfer — the men step out, run to the landed ship, and board
// by touch (devices.ts). Drop placement is still the whole skill — attackers only count while
// landed inside the disc, and they never pathfind toward it.
export const stepBases = (world: World, dt: number): void => {
  if (world.bases.length === 0) return
  // Last frame's storming marks expire — the capture war below re-marks the men still at it.
  // The flag drives the renderer's pounding pose AND plants the man (advanceOnBase holds a
  // marked man at the wall instead of wandering him around the disc).
  for (const d of world.devices) {
    if (d.kind === DeviceKind.INFANTRY) d.storming = false
  }
  for (const base of world.bases) {
    const captured = base.capture >= 1

    // One pass over the devices: count this base's fielded defenders and spot landed enemy
    // infantry close enough to read on the threat sensor.
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
    // The alarm is now purely a SENSOR for the bot's goal layer (defenders no longer patrol,
    // sortie, or hide — they hold the shelter and fire). SORTIE outranks HIDE.
    base.alarm = enemyInfantryNear ? BaseAlarm.SORTIE : enemyShipNear ? BaseAlarm.HIDE : BaseAlarm.PATROL

    // The capture war over the LANDED attackers inside the disc. A man flat on his back (or
    // EMP-seized) neither storms nor occupies as a live raider, but a downed man still OCCUPIES
    // (counted apart) so a knockdown ring doesn't un-capture a won pad or revert a stalled storm.
    let attackers = 0
    let attackersDown = 0
    let attackerId: number | undefined
    const raiders: InfantryDevice[] = []
    for (const d of world.devices) {
      if (d.kind !== DeviceKind.INFANTRY || !d.attached || d.owner === base.owner) continue
      if (Math.hypot(d.x - base.x, d.y - base.y) > BASE_CAPTURE_RADIUS) continue
      if (d.fallen > 0 || d.stun > 0) {
        attackersDown += 1
      } else {
        attackers += 1
        attackerId = d.owner
        raiders.push(d)
      }
    }

    // Total defense = reserve + the fielded firing line: the base's hitpoints, and the gate on
    // storming. The cap counts the whole defense, so fielding a man out the door grows nothing.
    const totalDefense = base.garrison + fielded

    // Reserve regrows while the owner holds the base AND no ground assault is on (enemy troopers
    // in the disc): the fort patches up between battles but cannot regenerate its way out of a
    // storm. Regen mid-assault would also stall the capture clock forever just under one man.
    if (!captured && attackers === 0 && attackersDown === 0 && totalDefense < BASE_GARRISON_CAP) {
      base.garrison = Math.min(BASE_GARRISON_CAP - fielded, base.garrison + BASE_GARRISON_REGEN * dt)
    }

    // A boarding call: the owner ship landed (or barely drifting) by the pad with room in the bay
    // throws the doors open. Loading is embodied — the men run to the hull and board by touch
    // (devices.ts) — so emptying the WHOLE defense onto the ship is the owner's call to make.
    const owner = world.ships.find((s) => s.id === base.owner)
    const loading =
      owner !== undefined &&
      !captured &&
      owner.troops < TROOP_BAY_CAPACITY &&
      Math.hypot(owner.vx, owner.vy) <= INFANTRY_PICKUP_SPEED &&
      Math.hypot(owner.x - base.x, owner.y - (base.y - 40)) <= BASE_LOAD_RADIUS

    // The door: a reserve man steps out on a cadence — to man the firing line (up to
    // BASE_ACTIVE_DEFENDERS inside) in peace and under siege alike, or to stream out and board
    // while the owner is loading. The return back through the door lives in devices.ts.
    base.door = Math.max(0, base.door - dt)
    if (!captured && base.door <= 0 && base.garrison >= 1 && (loading || fielded < BASE_ACTIVE_DEFENDERS)) {
      spawnGuard(world, base, owner?.squad)
      base.garrison -= 1
      base.door = BASE_DOOR_INTERVAL
    }

    // Storming runs ONLY over an emptied fort. Unopposed attackers in wall/roof contact run the
    // capture clock at 1/BASE_STORM_SIDE_TIME per pressed side — and there are THREE: the west
    // wall, the roof (north), and the east wall, counted for at most one man each. So a lone roofer
    // storms in BASE_STORM_SIDE_TIME, a crew on all three in a third of that. The work stops cold
    // while a live threat (enemy ship or trooper) is near the pad. An empty zone bleeds progress
    // back — which also re-liberates a base (dropping below 1 clears capturedBy), so relieving the
    // pad wins it back.
    if (attackers > 0 && totalDefense < 1) {
      if (!captured && attackerId !== undefined && !stormThreatNear(world, base, attackerId)) {
        // The contact crew: the FIRST man pressed to each wall (one per side) and the first
        // BASE_STORM_ROOF_SLOTS standing on the roof. Everyone else in the disc is occupation.
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
        // The crew marks for the renderer's comic pounding (and devices.ts holds its fire — both
        // hands are on the building). The turn-to-the-door applies only in the poses the renderer
        // actually swaps (kneel ≤ 0 && !running && no slide ⟺ stateOf WALKING/STANDING).
        for (const s of crew) {
          s.storming = true
          if (s.kneel <= 0 && !s.running && s.slide === 0 && s.x !== base.x) {
            s.facing = s.x < base.x ? 1 : -1
          }
        }
        // Three storming sides — west wall, roof (north), east wall — each counted for at most one
        // man, contributing 1/BASE_STORM_SIDE_TIME per second. A lone roofer storms like a lone
        // flanker; a crew on all three breaches in a third of the single-side time.
        const sides = (leftTaken ? 1 : 0) + (roofTaken > 0 ? 1 : 0) + (rightTaken ? 1 : 0)
        if (sides > 0) {
          base.capture = Math.min(1, base.capture + (sides / BASE_STORM_SIDE_TIME) * dt)
          if (base.capture >= 1) base.capturedBy = attackerId
        }
      }
    } else if (attackers === 0 && attackersDown === 0 && base.capture > 0) {
      base.capture = Math.max(0, base.capture - dt / BASE_REVERT_TIME)
      if (base.capture < 1) base.capturedBy = undefined
    }
  }
}
