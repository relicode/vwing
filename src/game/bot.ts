import { closestPointOnRect } from '$/game/collision'
import {
  BaseAlarm,
  BOT_AIM_DEADBAND,
  BOT_ARRIVAL_RADIUS,
  BOT_ASSAULT_MIN_TROOPS,
  BOT_CRUISE_ALT_FRAC,
  BOT_CRUISE_SPEED,
  BOT_DESCEND_DX,
  BOT_DODGE_DIST,
  BOT_DROP_ALTITUDE,
  BOT_DROP_BAND,
  BOT_DROP_WINDOW_X,
  BOT_FALL_LIMIT,
  BOT_FIRE_CONE,
  BOT_FIRE_RANGE,
  BOT_HOVER_SLOW,
  BOT_REARM_DONE_TROOPS,
  BOT_SECONDARY_RANGE,
  BOT_STANDOFF,
  BOT_THREAT_RANGE,
  BOT_THRUST_CONE,
  BOT_WALL_LOOKAHEAD,
  BOT_WALL_MARGIN,
  BotGoal,
  BULLET_SPEED,
  WALL_THICKNESS,
  WEAPON_CONFIG,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Input } from '$/game/input'
import { wrapAngle } from '$/game/math'
import type { Base, Block, Ship, World } from '$/game/types'

const FACING_UP = -Math.PI / 2

// The per-frame command the AI feeds through the shared `updateShip`/fire path.
export type BotDecision = {
  turn: number
  thrusting: boolean
  firing: boolean
  altFiring: boolean
  deploying: boolean
}

const IDLE: BotDecision = { turn: 0, thrusting: false, firing: false, altFiring: false, deploying: false }

const CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 } as const

// Heading to flee toward the arena center when the bot is hugging — or about to cross —
// a lethal wall (the floor included, so this doubles as gravity/altitude recovery).
const wallEscapeHeading = (self: Ship): number | undefined => {
  const margin = WALL_THICKNESS + self.radius + BOT_WALL_MARGIN
  const fx = self.x + self.vx * BOT_WALL_LOOKAHEAD
  const fy = self.y + self.vy * BOT_WALL_LOOKAHEAD
  const breached = (x: number, y: number): boolean =>
    x < margin || x > WORLD_WIDTH - margin || y < margin || y > WORLD_HEIGHT - margin
  if (!breached(self.x, self.y) && !breached(fx, fy)) return undefined
  return Math.atan2(CENTER.y - self.y, CENTER.x - self.x)
}

// Heading directly away from the nearest dangerously close terrain block, if any.
const terrainEscapeHeading = (self: Ship, blocks: Block[]): number | undefined => {
  let worstX = 0
  let worstY = 0
  let worstGap = Number.POSITIVE_INFINITY
  for (const b of blocks) {
    const q = closestPointOnRect(self.x, self.y, b.x, b.y, b.w, b.h)
    const gap = Math.hypot(q.x - self.x, q.y - self.y) - self.radius
    if (gap < BOT_DODGE_DIST && gap < worstGap) {
      worstGap = gap
      worstX = q.x
      worstY = q.y
    }
  }
  if (worstGap === Number.POSITIVE_INFINITY) return undefined
  return Math.atan2(self.y - worstY, self.x - worstX)
}

// Thrust only helps when the nose is within 90° of the goal heading; otherwise the
// engine would shove the bot the wrong way, so it turns to face the goal first.
const facingToward = (self: Ship, heading: number): boolean => Math.abs(wrapAngle(heading - self.angle)) < Math.PI / 2

const turnCommand = (self: Ship, desired: number): number => {
  const error = wrapAngle(desired - self.angle)
  return Math.abs(error) < BOT_AIM_DEADBAND ? 0 : Math.sign(error)
}

// Pure AI: aim (with lead) at the target and fire when lined up, but let survival
// reflexes — wall/floor recovery, then terrain dodging — override the heading.
export const decideBot = (self: Ship, target: Ship, blocks: Block[]): BotDecision => {
  const dx = target.x - self.x
  const dy = target.y - self.y
  const dist = Math.hypot(dx, dy) || 1
  const lead = dist / BULLET_SPEED
  const aimX = target.x + target.vx * lead
  const aimY = target.y + target.vy * lead

  let desired = Math.atan2(aimY - self.y, aimX - self.x)
  let thrusting = false
  let firing = false
  let altFiring = false

  const charged = self.charge >= WEAPON_CONFIG[self.weapon].cost && self.altCooldown <= 0 && self.disabled <= 0

  const escapeHeading = wallEscapeHeading(self) ?? terrainEscapeHeading(self, blocks)
  if (escapeHeading !== undefined) {
    desired = escapeHeading
    thrusting = facingToward(self, desired)
  } else {
    const aimError = Math.abs(wrapAngle(desired - self.angle))
    const onTarget = aimError < BOT_FIRE_CONE && target.invuln <= 0 // don't waste shots on invuln targets
    firing = onTarget && dist < BOT_FIRE_RANGE
    // Secondaries reach further than the primary cannon (rail/seeker), so use their own range.
    altFiring = onTarget && dist < BOT_SECONDARY_RANGE && charged
    thrusting = aimError < BOT_THRUST_CONE && dist > BOT_STANDOFF
    // Falling too fast while engaging? Point up and ride thrust before resuming the chase.
    if (!thrusting && self.vy > BOT_FALL_LIMIT) {
      desired = FACING_UP
      thrusting = facingToward(self, FACING_UP)
      firing = false
      altFiring = false
    }
  }

  return { turn: turnCommand(self, desired), thrusting, firing, altFiring, deploying: false }
}

// Ferry flight: steer toward a world point with the survival reflexes still in charge, an
// along-track speed cap so the bot stays controllable, and (when `arrive` is set) a braking
// hover inside the arrival radius — retro-thrust until slow, then feather against gravity.
// Terrain dodging is suppressed close to the destination: a pad approach IS deliberate
// terrain proximity, and the dodge would otherwise shove the bot off its own barracks.
export const steerTo = (self: Ship, px: number, py: number, blocks: Block[], arrive: boolean): BotDecision => {
  const dist = Math.hypot(px - self.x, py - self.y)
  const speed = Math.hypot(self.vx, self.vy)
  let desired = Math.atan2(py - self.y, px - self.x)
  let thrusting = false

  const escapeHeading =
    wallEscapeHeading(self) ?? (dist > BOT_ARRIVAL_RADIUS * 3 ? terrainEscapeHeading(self, blocks) : undefined)
  if (escapeHeading !== undefined) {
    desired = escapeHeading
    thrusting = facingToward(self, desired)
  } else if (arrive && dist < BOT_ARRIVAL_RADIUS) {
    if (speed > BOT_HOVER_SLOW) {
      desired = Math.atan2(-self.vy, -self.vx) // retro-burn the velocity away
      thrusting = facingToward(self, desired)
    } else {
      desired = FACING_UP // feather against gravity to loiter
      thrusting = self.vy > 30 && facingToward(self, FACING_UP)
    }
  } else {
    const along = self.vx * Math.cos(desired) + self.vy * Math.sin(desired)
    thrusting = facingToward(self, desired) && along < BOT_CRUISE_SPEED
    if (!thrusting && self.vy > BOT_FALL_LIMIT) {
      desired = FACING_UP
      thrusting = facingToward(self, FACING_UP)
    }
  }

  return { turn: turnCommand(self, desired), thrusting, firing: false, altFiring: false, deploying: false }
}

const nearestEnemy = (self: Ship, ships: Ship[]): Ship | undefined => {
  let best: Ship | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const ship of ships) {
    if (ship.id === self.id) continue
    const d = Math.hypot(ship.x - self.x, ship.y - self.y)
    if (d < bestDist) {
      bestDist = d
      best = ship
    }
  }
  return best
}

// The goal ladder, top priority first. Pure: the only memory is `prev` (REARM is sticky until
// the bay is topped up, so the bot doesn't thrash at the load threshold). A world without bases
// (DEATHMATCH) short-circuits straight to DOGFIGHT.
export const nextGoal = (prev: BotGoal, self: Ship, world: World, target: Ship | undefined): BotGoal => {
  const home = world.bases.find((b) => b.owner === self.id)
  const enemyBase = world.bases.find((b) => b.owner !== self.id)
  if (!home || !enemyBase) return BotGoal.DOGFIGHT
  // 1. A nearby enemy ship always wins attention — never stop being a dogfighter when pressed.
  if (target && Math.hypot(target.x - self.x, target.y - self.y) < BOT_THREAT_RANGE) return BotGoal.DOGFIGHT
  // 2. The home barracks under threat — capture progress, or the garrison already sortied
  // against landed raiders (capture stays 0 while they storm the building, so the sortie is
  // the early warning). Flying home empty-handed helps nobody, so the sortie response needs
  // troops aboard to drop.
  if (home.capture > 0) return BotGoal.DEFEND
  if (home.alarm === BaseAlarm.SORTIE && self.troops >= 1) return BotGoal.DEFEND
  // 3. Sticky rearm: keep loading until topped up (or the garrison runs dry / the base falls).
  const canLoad = home.capture < 1 && home.garrison >= 1
  if (prev === BotGoal.REARM && self.troops < BOT_REARM_DONE_TROOPS && canLoad) return BotGoal.REARM
  // 4. Stocked: fly the assault. 5. Short on troops but the barracks can supply: go load.
  if (self.troops >= BOT_ASSAULT_MIN_TROOPS) return BotGoal.ASSAULT
  if (canLoad) return BotGoal.REARM
  // 6. Garrison dry: attack with whatever is aboard, else just hunt the enemy ship.
  return self.troops >= 1 ? BotGoal.ASSAULT : BotGoal.DOGFIGHT
}

// Three-leg ferry routing: CLIMB straight out of the canyons first, CRUISE across the open SKY
// band (above every mesa top — reactive dodging alone can't survive mesa country at cruise
// speed; a near-horizontal heading just pinballs off the walls), then DESCEND the destination
// column, which is clear by construction over the pads (the generator's clamped aprons).
const ferryLeg = (self: Ship, destX: number, destY: number): { x: number; y: number; final: boolean } => {
  const cruiseY = WORLD_HEIGHT * BOT_CRUISE_ALT_FRAC
  if (Math.abs(self.x - destX) > BOT_DESCEND_DX) {
    if (self.y > cruiseY + 200) return { x: self.x, y: cruiseY, final: false } // climb out vertically
    return { x: destX, y: cruiseY, final: false } // cruise the sky band
  }
  return { x: destX, y: destY, final: true }
}

// Stream the bay over a pad: ferry to the release point, BRAKE into a hover there (a cruise-
// speed flythrough crosses the drop window before a single chute can pop, overshoots, and
// strands the bot at the far wall), and deploy while inside the window — above the pad but not
// so high the chutes ride exposed forever.
const dropDecision = (self: Ship, base: Base, blocks: Block[]): BotDecision => {
  const leg = ferryLeg(self, base.x, base.y - BOT_DROP_ALTITUDE)
  const decision = steerTo(self, leg.x, leg.y, blocks, leg.final)
  const overPad =
    Math.abs(self.x - base.x) < BOT_DROP_WINDOW_X &&
    self.y < base.y - 100 &&
    self.y > base.y - BOT_DROP_ALTITUDE - BOT_DROP_BAND
  return { ...decision, deploying: overPad && self.troops >= 1 }
}

// Execute the chosen goal as a per-frame command.
const actOnGoal = (
  goal: BotGoal,
  self: Ship,
  world: World,
  target: Ship | undefined,
  home: Base | undefined,
  enemyBase: Base | undefined
): BotDecision => {
  switch (goal) {
    case BotGoal.DOGFIGHT:
      return target ? decideBot(self, target, world.blocks) : IDLE
    case BotGoal.REARM: {
      if (!home) return IDLE
      // Park by the pad; stepBases does the actual loading once the bot is slow and near.
      const leg = ferryLeg(self, home.x, home.y - 100)
      return steerTo(self, leg.x, leg.y, world.blocks, leg.final)
    }
    case BotGoal.DEFEND:
      return home ? dropDecision(self, home, world.blocks) : IDLE
    case BotGoal.ASSAULT:
      return enemyBase ? dropDecision(self, enemyBase, world.blocks) : IDLE
  }
}

// Wrap the AI as an `Input`: the accessors share one decision recomputed once
// per simulation frame (keyed on world.time), so it slots straight into updateShip.
// The current goal is closure state (REARM hysteresis), never module state.
export const createBotInput = (self: Ship, getWorld: () => World): Input => {
  let cachedTime = Number.NaN
  let decision: BotDecision = IDLE
  let goal: BotGoal = BotGoal.DOGFIGHT

  const refresh = (): void => {
    const world = getWorld()
    if (world.time === cachedTime) return
    cachedTime = world.time
    const target = nearestEnemy(self, world.ships)
    goal = nextGoal(goal, self, world, target)
    const home = world.bases.find((b) => b.owner === self.id)
    const enemyBase = world.bases.find((b) => b.owner !== self.id)
    decision = actOnGoal(goal, self, world, target, home, enemyBase)
  }

  return {
    turn: () => {
      refresh()
      return decision.turn
    },
    thrusting: () => {
      refresh()
      return decision.thrusting
    },
    firing: () => {
      refresh()
      return decision.firing
    },
    altFiring: () => {
      refresh()
      return decision.altFiring
    },
    deploying: () => {
      refresh()
      return decision.deploying
    },
    destroy: () => {},
  }
}
