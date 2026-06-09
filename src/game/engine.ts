import { updateBeams } from '$/game/beams'
import { createBotInput } from '$/game/bot'
import {
  BOT_ID,
  GamePhase,
  PLAYER_ID,
  SECONDARY_MAX_CHARGE,
  SHAKE_DECAY,
  SHIP_START_LIVES,
  ShipKind,
  SimMode,
  type WeaponKind,
} from '$/game/constants'
import { createInput } from '$/game/input'
import { updateParticles } from '$/game/particles'
import { createRenderer } from '$/game/renderer'
import { createRng } from '$/game/rng'
import { BOT_SPAWN_X, BOT_SPAWN_Y, createShip, PLAYER_SPAWN_X, PLAYER_SPAWN_Y } from '$/game/ship'
import { type Combatant, createSim, createWorld, type Sim } from '$/game/sim'
import type { EngineStatus, Ship } from '$/game/types'
import { createCanvasApp } from '$/game/view'

const BEST_KEY = 'vwing.best'
const MAX_FRAME_DT = 1 / 30 // clamp long frames (tab switch) so the sim never leaps

export type Engine = {
  canvas: HTMLCanvasElement
  getStatus: () => EngineStatus
  subscribe: (listener: () => void) => () => void
  start: (weapon?: WeaponKind) => void // weapon = debug override; undefined = random per life
  destroy: () => void
}

const makeSeed = (): number => Math.floor(Math.random() * 0xffffffff)

const readBest = (): number => {
  const raw = globalThis.localStorage?.getItem(BEST_KEY)
  const value = raw ? Number.parseInt(raw, 10) : 0
  return Number.isFinite(value) ? value : 0
}

const writeBest = (value: number): void => {
  globalThis.localStorage?.setItem(BEST_KEY, String(value))
}

export const createEngine = async (): Promise<Engine> => {
  const app = await createCanvasApp()
  const renderer = createRenderer(createRng(0xc0ffee))
  app.stage.addChild(renderer.view)
  const input = createInput(window)

  let phase = GamePhase.TITLE
  let best = readBest()
  let forcedWeapon: WeaponKind | undefined // debug: pins every ship's secondary when set

  // The offline campaign: the keyboard-driven player (finite lives, point score) versus an
  // endlessly respawning AI bot, both running through the shared authoritative sim.
  const buildSim = (): Sim => {
    const world = createWorld(makeSeed())
    const player = createShip(ShipKind.PLAYER, PLAYER_SPAWN_X, PLAYER_SPAWN_Y, PLAYER_ID, world.rng, forcedWeapon)
    const bot = createShip(ShipKind.BOT, BOT_SPAWN_X, BOT_SPAWN_Y, BOT_ID, world.rng, forcedWeapon)
    const combatants: Combatant[] = [
      {
        ship: player,
        input,
        name: 'You',
        score: 0,
        lives: SHIP_START_LIVES,
        spawn: { x: PLAYER_SPAWN_X, y: PLAYER_SPAWN_Y },
      },
      {
        ship: bot,
        input: createBotInput(bot, () => world),
        name: 'Bot',
        score: 0,
        lives: Number.POSITIVE_INFINITY,
        spawn: { x: BOT_SPAWN_X, y: BOT_SPAWN_Y },
      },
    ]
    return createSim(world, combatants, { mode: SimMode.CAMPAIGN, forcedWeapon })
  }

  let sim = buildSim()
  const player = (): Combatant => sim.combatants[0]
  const playerShip = (): Ship => player().ship

  const listeners = new Set<() => void>()
  const chargePct = (ship: Ship): number => Math.round((ship.charge / SECONDARY_MAX_CHARGE) * 100)
  let status: EngineStatus = {
    phase,
    score: 0,
    lives: SHIP_START_LIVES,
    best,
    weapon: playerShip().weapon,
    charge: chargePct(playerShip()),
  }

  const publish = (): void => {
    const p = player()
    const score = Math.floor(p.score)
    const charge = chargePct(p.ship)
    if (
      status.phase === phase &&
      status.score === score &&
      status.lives === p.lives &&
      status.best === best &&
      status.weapon === p.ship.weapon &&
      status.charge === charge
    ) {
      return
    }
    status = { phase, score, lives: p.lives, best, weapon: p.ship.weapon, charge }
    for (const listener of listeners) listener()
  }

  const endGame = (): void => {
    phase = GamePhase.GAME_OVER
    const finalScore = Math.floor(player().score)
    if (finalScore > best) {
      best = finalScore
      writeBest(best)
    }
  }

  const step = (dt: number): void => {
    if (phase === GamePhase.PLAYING) {
      const events = sim.step(dt)
      // The run ends the moment the human is out of lives.
      if (events.some((e) => e.eliminated && e.victimKind === ShipKind.PLAYER)) endGame()
    } else {
      // Title + game-over: just let debris and beams fade as ambiance (terrain is static).
      const world = sim.world
      if (world.shake > 0) world.shake = Math.max(0, world.shake - SHAKE_DECAY * dt)
      world.time += dt
      world.particles = updateParticles(world.particles, dt)
      updateBeams(world, dt)
    }
  }

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_DT)
    step(dt)
    publish()
    renderer.draw(sim.world, phase, PLAYER_ID)
  })

  const start = (weapon?: WeaponKind): void => {
    forcedWeapon = weapon
    sim = buildSim()
    phase = GamePhase.PLAYING
    publish()
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const destroy = (): void => {
    input.destroy()
    app.ticker.stop()
    renderer.destroy()
    app.destroy(true)
    listeners.clear()
  }

  return { canvas: app.canvas, getStatus: () => status, subscribe, start, destroy }
}
