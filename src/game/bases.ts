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
  BASE_STORM_ATTRITION_INTERVAL,
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
  Relation,
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
  contest: {},
  attritionClock: BASE_STORM_ATTRITION_INTERVAL,
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

// The side a base currently answers to: whoever captured it, the deed owner otherwise. The renderer
// paints the building this color, the defender economy fields THIS side's men, and wall exemptions /
// occlusion key off it — the holder is who the building *is* in play, never the deed.
export const baseHolder = (base: Base): number => base.holderId ?? base.owner

// A ship's standing toward a base: FRIENDLY if it holds it, HOSTILE otherwise. The one friend/foe
// chokepoint the base war reads — NEUTRAL (an unheld, capturable-by-all base) lands later and only
// touches this fn plus the renderer's color branch.
export const relation = (base: Base, shipId: number): Relation =>
  shipId === baseHolder(base) ? Relation.FRIENDLY : Relation.HOSTILE

// The leading assault on a base: the hostile pilot with the most storm progress, and how far (0..1).
// undefined = nobody is storming it. Drives the HUD's under-attack alarm and the renderer's takeover
// bar (so a contested fort shows WHO is taking it, not one anonymous green bar). Object key order is
// ascending-numeric for integer ids, so ties resolve to the lowest id — deterministic.
export const captureLead = (base: Base): { by: number; pct: number } | undefined => {
  let by: number | undefined
  let pct = 0
  for (const key of Object.keys(base.contest)) {
    const p = base.contest[Number(key)]
    if (p > pct) {
      pct = p
      by = Number(key)
    }
  }
  return by === undefined ? undefined : { by, pct }
}

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
// — sheltered defenders die ONLY this way, never to a direct hit. The casualty is the HOLDER's: a
// fielded defender (a live device inside) is the visible one; failing that a reserve man falls
// (stepBases re-mans the line next tick). A held fort defends its holder, so it is shellable by the
// holder's foes (and by the holder's own friendly fire). An already-empty fort shrugs the round off.
// Rolls on world.rng so the sim stays deterministic on the server and under test.
export const shellBase = (world: World, base: Base, damage: number): void => {
  if (damage <= 0) return
  if (world.rng() >= Math.min(1, damage / BASE_SHELL_KILL_DAMAGE)) return
  const holder = baseHolder(base)
  const idx = world.devices.findIndex(
    (d) =>
      d.kind === DeviceKind.INFANTRY &&
      d.guard &&
      d.owner === holder &&
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

// The HOLDER's relief near the pad: its ship, or any of its troopers still on their feet
// (downed/seized/drowned men relieve nobody — airborne ones count: an incoming defender drop is
// exactly what a stormer breaks off for). While one is near, no storm runs — the raiders down tools
// and fight the relief. Crucially this is the HOLDER's force only: rival attackers do NOT freeze each
// other's storm (in the old self-vs-the-one-enemy model they did, deadlocking every contested pad) —
// when several pilots storm at once they bleed by attrition instead (stepBases).
export const holderReliefNear = (world: World, base: Base): boolean => {
  const holder = baseHolder(base)
  if (world.ships.some((s) => s.id === holder && Math.hypot(s.x - base.x, s.y - base.y) <= BASE_STORM_THREAT_RANGE)) {
    return true
  }
  return world.devices.some(
    (d) =>
      d.kind === DeviceKind.INFANTRY &&
      d.owner === holder &&
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

// Elect ONE pilot's storming crew on a fort and mark them: the FIRST man pressed to each wall (one
// per side) and the first BASE_STORM_ROOF_SLOTS standing on the roof — everyone else of that pilot in
// the disc is occupation. The mark drives the renderer's pounding pose AND plants the man (devices.ts
// holds his fire and holds him at the wall). Returns how many of the three sides (west / roof / east)
// the crew presses — the per-second capture rate for this pilot's bar.
const markStormCrew = (base: Base, raiders: InfantryDevice[]): number => {
  let leftTaken = false
  let rightTaken = false
  let roofTaken = 0
  for (const s of raiders) {
    const contact = stormContact(base, s)
    if (contact === 'left' && !leftTaken) leftTaken = true
    else if (contact === 'right' && !rightTaken) rightTaken = true
    else if (contact === 'roof' && roofTaken < BASE_STORM_ROOF_SLOTS) roofTaken += 1
    else continue
    s.storming = true
    // The turn-to-the-door applies only in the poses the renderer actually swaps (kneel ≤ 0 &&
    // !running && no slide ⟺ stateOf WALKING/STANDING).
    if (s.kneel <= 0 && !s.running && s.slide === 0 && s.x !== base.x) s.facing = s.x < base.x ? 1 : -1
  }
  return (leftTaken ? 1 : 0) + (roofTaken > 0 ? 1 : 0) + (rightTaken ? 1 : 0)
}

// Cull ONE of a pilot's storming soldiers in a contested fight (the attrition that resolves a shared
// pad). The casualty is the first crew man in wall/roof contact, else the first raider — picked by
// device order so the choice is deterministic on the server and under bun:test. A BLOOD puff marks it.
const cullStormCrew = (world: World, base: Base, raiders: InfantryDevice[]): void => {
  if (raiders.length === 0) return
  const victim = raiders.find((r) => stormContact(base, r) !== undefined) ?? raiders[0]
  const idx = world.devices.indexOf(victim)
  if (idx < 0) return
  spawnExplosion(world.particles, victim.x, victim.y, Color.BLOOD, world.rng, 6)
  world.devices.splice(idx, 1)
}

// A fort falls: `attackerId` becomes its holder. Every rival's progress is cleared (the new regime
// starts fresh) and the attrition clock resets. The dispossessed holder fielded NO defenders here (a
// storm runs only over an emptied fort, totalDefense < 1, so its guard count was already zero), so
// there are no stale guards to stand down — the captor's own door re-mans the line next frame.
const captureBase = (base: Base, attackerId: number): void => {
  base.holderId = attackerId
  base.contest = {}
  base.attritionClock = BASE_STORM_ATTRITION_INTERVAL
}

// Advance every barracks one frame: the threat sensor, defender fielding (manning the firing line
// inside, or streaming out to a boarding holder), reserve regen, and the capture war. The DEFENDERS
// are the base's hitpoints — up to BASE_ACTIVE_DEFENDERS of the HOLDER's men stand inside the shelter
// and fire out (devices.ts), the rest wait in reserve (`garrison`). Ship fire that strikes the
// building kills them by chance (shellBase). Only over an EMPTIED fort do hostile pilots in wall/roof
// contact run their capture clocks — each its OWN (base.contest[id]); first to 1 takes the fort. A
// lone storm runs unopposed; when 2+ rivals storm at once they bleed by attrition. Loading is embodied:
// no counter transfer — the men step out, run to the landed ship, and board by touch (devices.ts).
export const stepBases = (world: World, dt: number): void => {
  if (world.bases.length === 0) return
  // Last frame's storming marks expire — the capture war below re-marks the men still at it.
  for (const d of world.devices) {
    if (d.kind === DeviceKind.INFANTRY) d.storming = false
  }
  for (const base of world.bases) {
    const holder = baseHolder(base)

    // One pass over the devices: count the HOLDER's fielded defenders, read the sortie sensor, and
    // group landed HOSTILE raiders inside the disc by their owner (each pilot contests its own bar).
    // A man flat on his back (or EMP-seized) doesn't storm, but a downed raider still OCCUPIES (its
    // owner stays in `occupiers`) so a knockdown ring can't bleed back a stalled storm.
    let fielded = 0
    let enemyInfantryNear = false
    const crews = new Map<number, InfantryDevice[]>() // hostile owner → its upright raiders in the disc
    const occupiers = new Set<number>() // hostile owners with ANY man (up or down) in the disc — pins decay
    for (const d of world.devices) {
      if (d.kind !== DeviceKind.INFANTRY) continue
      if (d.owner === holder) {
        // A guard counts for THIS fort only if it is actually here — a holder may garrison TWO forts
        // (its own deed AND a captured one), and one fort's line must not gate the other's storm shut.
        if (d.guard && Math.hypot(d.x - base.x, d.y - base.y) <= BASE_CAPTURE_RADIUS) fielded += 1
        continue
      }
      if (d.attached && Math.hypot(d.x - base.x, d.y - base.y) <= BASE_SORTIE_RANGE) enemyInfantryNear = true
      if (!d.attached || Math.hypot(d.x - base.x, d.y - base.y) > BASE_CAPTURE_RADIUS) continue
      occupiers.add(d.owner)
      if (d.fallen > 0 || d.stun > 0) continue
      const crew = crews.get(d.owner)
      if (crew) crew.push(d)
      else crews.set(d.owner, [d])
    }
    const enemyShipNear = world.ships.some(
      (s) => s.id !== holder && Math.hypot(s.x - base.x, s.y - base.y) <= BASE_ALERT_RANGE
    )
    // The alarm is purely a SENSOR for the bot's goal layer (defenders no longer patrol/sortie/hide —
    // they hold the shelter and fire). SORTIE outranks HIDE.
    base.alarm = enemyInfantryNear ? BaseAlarm.SORTIE : enemyShipNear ? BaseAlarm.HIDE : BaseAlarm.PATROL

    // Total defense = reserve + the fielded firing line: the base's hitpoints, and the gate on
    // storming. The cap counts the whole defense, so fielding a man out the door grows nothing.
    const totalDefense = base.garrison + fielded

    // Reserve regrows while the holder holds it AND no ground assault is on (no hostile man in the
    // disc): the fort patches up between battles but cannot regenerate its way out of a storm.
    if (occupiers.size === 0 && totalDefense < BASE_GARRISON_CAP) {
      base.garrison = Math.min(BASE_GARRISON_CAP - fielded, base.garrison + BASE_GARRISON_REGEN * dt)
    }

    // A boarding call: the HOLDER's ship landed (or barely drifting) by the pad with bay room throws
    // the doors open — the men run to the hull and board by touch (devices.ts), so emptying the WHOLE
    // defense onto the ship is the holder's call to make. A captured fort loads its captor the same way.
    const holderShip = world.ships.find((s) => s.id === holder)
    const loading =
      holderShip !== undefined &&
      holderShip.troops < TROOP_BAY_CAPACITY &&
      Math.hypot(holderShip.vx, holderShip.vy) <= INFANTRY_PICKUP_SPEED &&
      Math.hypot(holderShip.x - base.x, holderShip.y - (base.y - 40)) <= BASE_LOAD_RADIUS

    // The door: a reserve man steps out on a cadence — to man the firing line (up to
    // BASE_ACTIVE_DEFENDERS inside) in peace and under siege alike, or to stream out and board while
    // the holder is loading. The return back through the door lives in devices.ts.
    base.door = Math.max(0, base.door - dt)
    if (base.door <= 0 && base.garrison >= 1 && (loading || fielded < BASE_ACTIVE_DEFENDERS)) {
      spawnGuard(world, base, holder, holderShip?.squad)
      base.garrison -= 1
      base.door = BASE_DOOR_INTERVAL
    }

    // The storm war over an emptied fort. Each hostile pilot with a crew pressed to the walls / roof
    // runs ITS OWN capture clock at 1/BASE_STORM_SIDE_TIME per pressed side (three sides → a third the
    // time); first to 1 takes the fort. The holder's relief near the pad pauses every storm (the men
    // break off to fight it). Rival attackers do NOT freeze each other — when 2+ press at once they
    // bleed one soldier each on the attrition clock, so a shared pad is a war of feeding troops.
    const contesting: number[] = [] // owners whose crew actually pressed a side this frame
    let captured = false
    if (totalDefense < 1 && crews.size > 0 && !holderReliefNear(world, base)) {
      for (const [attackerId, raiders] of crews) {
        const sides = markStormCrew(base, raiders)
        if (sides === 0) continue
        contesting.push(attackerId)
        base.contest[attackerId] = Math.min(1, (base.contest[attackerId] ?? 0) + (sides / BASE_STORM_SIDE_TIME) * dt)
        if (base.contest[attackerId] >= 1) {
          captureBase(base, attackerId)
          captured = true
          break
        }
      }
      if (!captured && contesting.length >= 2) {
        base.attritionClock -= dt
        if (base.attritionClock <= 0) {
          // crews.get is defined for every contesting id (it pressed a side, so it has upright men).
          for (const attackerId of contesting) cullStormCrew(world, base, crews.get(attackerId) ?? [])
          base.attritionClock = BASE_STORM_ATTRITION_INTERVAL
        }
      } else if (!captured) {
        base.attritionClock = BASE_STORM_ATTRITION_INTERVAL // a lone storm never attrites
      }
    } else {
      base.attritionClock = BASE_STORM_ATTRITION_INTERVAL
    }

    // Independent revert: a pilot's progress bleeds back on its own once its men leave the disc (no
    // upright crew AND no downed occupier) — a withdrawing raider's bar fades without gifting it to the
    // next arrival. The deed owner storming a captured fort back is just another contestant; reaching 1
    // sets holderId to the owner again (baseHolder reads it as the deed), so re-liberation and capture
    // are one mechanic. A fresh capture cleared `contest`, so this loop no-ops that frame.
    if (!captured) {
      for (const key of Object.keys(base.contest)) {
        const attackerId = Number(key)
        if (occupiers.has(attackerId)) continue
        const next = base.contest[attackerId] - dt / BASE_REVERT_TIME
        if (next <= 0) delete base.contest[attackerId]
        else base.contest[attackerId] = next
      }
    }
  }
}
