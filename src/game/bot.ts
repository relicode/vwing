import {
  BOT_AIM_DEADBAND,
  BOT_DODGE_DIST,
  BOT_FALL_LIMIT,
  BOT_FIRE_CONE,
  BOT_FIRE_RANGE,
  BOT_STANDOFF,
  BOT_THRUST_CONE,
  BOT_WALL_LOOKAHEAD,
  BOT_WALL_MARGIN,
  BULLET_SPEED,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '$/game/constants'
import type { Input } from '$/game/input'
import { wrapAngle } from '$/game/math'
import type { Asteroid, Ship, World } from '$/game/types'

const FACING_UP = -Math.PI / 2

// The per-frame command the AI feeds through the shared `updateShip`/fire path.
export type BotDecision = { turn: number; thrusting: boolean; firing: boolean }

const IDLE: BotDecision = { turn: 0, thrusting: false, firing: false }

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

// Heading directly away from the nearest dangerously close asteroid, if any.
const asteroidEscapeHeading = (self: Ship, asteroids: Asteroid[]): number | undefined => {
  let worst: Asteroid | undefined
  let worstGap = Number.POSITIVE_INFINITY
  for (const a of asteroids) {
    const gap = Math.hypot(a.x - self.x, a.y - self.y) - a.radius - self.radius
    if (gap < BOT_DODGE_DIST && gap < worstGap) {
      worstGap = gap
      worst = a
    }
  }
  if (!worst) return undefined
  return Math.atan2(self.y - worst.y, self.x - worst.x)
}

// Pure AI: aim (with lead) at the target and fire when lined up, but let survival
// reflexes — wall/floor recovery, then asteroid dodging — override the heading.
export const decideBot = (self: Ship, target: Ship, asteroids: Asteroid[]): BotDecision => {
  const dx = target.x - self.x
  const dy = target.y - self.y
  const dist = Math.hypot(dx, dy) || 1
  const lead = dist / BULLET_SPEED
  const aimX = target.x + target.vx * lead
  const aimY = target.y + target.vy * lead

  let desired = Math.atan2(aimY - self.y, aimX - self.x)
  let thrusting = false
  let firing = false

  // Thrust only helps when the nose is within 90° of the goal heading; otherwise the
  // engine would shove the bot the wrong way, so it turns to face the goal first.
  const thrustToward = (heading: number): boolean => Math.abs(wrapAngle(heading - self.angle)) < Math.PI / 2

  const escapeHeading = wallEscapeHeading(self) ?? asteroidEscapeHeading(self, asteroids)
  if (escapeHeading !== undefined) {
    desired = escapeHeading
    thrusting = thrustToward(desired)
  } else {
    const aimError = Math.abs(wrapAngle(desired - self.angle))
    // Don't waste shots on a target still under spawn invulnerability.
    firing = aimError < BOT_FIRE_CONE && dist < BOT_FIRE_RANGE && target.invuln <= 0
    thrusting = aimError < BOT_THRUST_CONE && dist > BOT_STANDOFF
    // Falling too fast while engaging? Point up and ride thrust before resuming the chase.
    if (!thrusting && self.vy > BOT_FALL_LIMIT) {
      desired = FACING_UP
      thrusting = thrustToward(FACING_UP)
      firing = false
    }
  }

  const error = wrapAngle(desired - self.angle)
  const turn = Math.abs(error) < BOT_AIM_DEADBAND ? 0 : Math.sign(error)
  return { turn, thrusting, firing }
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

// Wrap the AI as an `Input`: the three accessors share one decision recomputed once
// per simulation frame (keyed on world.time), so it slots straight into updateShip.
export const createBotInput = (self: Ship, getWorld: () => World): Input => {
  let cachedTime = Number.NaN
  let decision: BotDecision = IDLE

  const refresh = (): void => {
    const world = getWorld()
    if (world.time === cachedTime) return
    cachedTime = world.time
    const target = nearestEnemy(self, world.ships)
    decision = target ? decideBot(self, target, world.asteroids) : IDLE
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
    destroy: () => {},
  }
}
