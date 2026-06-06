import { Application } from 'pixi.js'

import { createWave, splitAsteroid, updateAsteroids } from '$/game/asteroids'
import { spawnBullet, updateBullets } from '$/game/bullets'
import { circlesOverlap } from '$/game/collision'
import {
  ASTEROID_BASE_COUNT,
  ASTEROID_CONFIG,
  ASTEROID_PER_WAVE,
  AsteroidSize,
  Color,
  GamePhase,
  SHIP_FIRE_INTERVAL,
  SHIP_SPAWN_CLEAR_RADIUS,
  SHIP_START_LIVES,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from '$/game/constants'
import { createInput } from '$/game/input'
import { spawnExplosion, updateParticles } from '$/game/particles'
import { createRenderer } from '$/game/renderer'
import { createRng } from '$/game/rng'
import { createShip, respawnShip, shipHitWall, updateShip } from '$/game/ship'
import type { Asteroid, Bullet, EngineStatus, World } from '$/game/types'

const BEST_KEY = 'vwing.best'
const MAX_FRAME_DT = 1 / 30 // clamp long frames (tab switch) so the sim never leaps

export type Engine = {
  canvas: HTMLCanvasElement
  getStatus: () => EngineStatus
  subscribe: (listener: () => void) => () => void
  start: () => void
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

const explosionCount = (size: AsteroidSize): number =>
  size === AsteroidSize.LARGE ? 26 : size === AsteroidSize.MEDIUM ? 18 : 12

const createWorld = (seed: number): World => {
  const rng = createRng(seed)
  const ship = createShip()
  return {
    time: 0,
    wave: 1,
    ship,
    bullets: [],
    asteroids: createWave(rng, ASTEROID_BASE_COUNT, ship, SHIP_SPAWN_CLEAR_RADIUS),
    particles: [],
    rng,
  }
}

export const createEngine = async (): Promise<Engine> => {
  const app = new Application()
  await app.init({
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    background: Color.BACKGROUND,
    antialias: true,
    resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    autoDensity: false,
  })
  app.canvas.style.width = '100%'
  app.canvas.style.height = '100%'
  app.canvas.style.display = 'block'

  const renderer = createRenderer(createRng(0xc0ffee))
  app.stage.addChild(renderer.view)
  const input = createInput(window)

  let phase = GamePhase.TITLE
  let score = 0
  let lives = SHIP_START_LIVES
  let best = readBest()
  let world = createWorld(makeSeed())

  const listeners = new Set<() => void>()
  let status: EngineStatus = { phase, score, lives, best, wave: world.wave }

  const publish = (): void => {
    const flooredScore = Math.floor(score)
    if (
      status.phase === phase &&
      status.score === flooredScore &&
      status.lives === lives &&
      status.best === best &&
      status.wave === world.wave
    ) {
      return
    }
    status = { phase, score: flooredScore, lives, best, wave: world.wave }
    for (const listener of listeners) listener()
  }

  const endGame = (): void => {
    phase = GamePhase.GAME_OVER
    const finalScore = Math.floor(score)
    if (finalScore > best) {
      best = finalScore
      writeBest(best)
    }
  }

  const killShip = (): void => {
    spawnExplosion(world.particles, world.ship.x, world.ship.y, Color.SHIP, world.rng, 34)
    lives -= 1
    if (lives <= 0) {
      endGame()
      return
    }
    respawnShip(world.ship)
    // Clear rocks around the spawn point so the respawn isn't an instant re-death.
    world.asteroids = world.asteroids.filter(
      (asteroid) => Math.hypot(asteroid.x - world.ship.x, asteroid.y - world.ship.y) > SHIP_SPAWN_CLEAR_RADIUS
    )
  }

  const resolveBulletHits = (): void => {
    const removed = new Set<number>()
    const spawned: Asteroid[] = []
    const survivingBullets: Bullet[] = []
    for (const bullet of world.bullets) {
      let consumed = false
      for (let i = 0; i < world.asteroids.length; i += 1) {
        if (removed.has(i)) continue
        const asteroid = world.asteroids[i]
        if (circlesOverlap(bullet.x, bullet.y, bullet.radius, asteroid.x, asteroid.y, asteroid.radius)) {
          removed.add(i)
          score += ASTEROID_CONFIG[asteroid.size].score
          spawnExplosion(
            world.particles,
            asteroid.x,
            asteroid.y,
            Color.ASTEROID_EDGE,
            world.rng,
            explosionCount(asteroid.size)
          )
          spawned.push(...splitAsteroid(asteroid, world.rng))
          consumed = true
          break
        }
      }
      if (!consumed) survivingBullets.push(bullet)
    }
    world.bullets = survivingBullets
    if (removed.size > 0) {
      world.asteroids = world.asteroids.filter((_, i) => !removed.has(i)).concat(spawned)
    }
  }

  const shipCrashed = (): boolean => {
    if (shipHitWall(world.ship)) return true
    if (world.ship.invuln > 0) return false
    return world.asteroids.some((asteroid) =>
      circlesOverlap(world.ship.x, world.ship.y, world.ship.radius * 0.8, asteroid.x, asteroid.y, asteroid.radius)
    )
  }

  const advanceWaveIfClear = (): void => {
    if (world.asteroids.length > 0) return
    world.wave += 1
    const count = ASTEROID_BASE_COUNT + ASTEROID_PER_WAVE * (world.wave - 1)
    world.asteroids = createWave(world.rng, count, world.ship, SHIP_SPAWN_CLEAR_RADIUS)
  }

  const stepPlaying = (dt: number): void => {
    world.time += dt
    updateShip(world.ship, input, dt)
    if (input.firing() && world.ship.fireCooldown <= 0) {
      spawnBullet(world.bullets, world.ship)
      world.ship.fireCooldown = SHIP_FIRE_INTERVAL
    }
    world.bullets = updateBullets(world.bullets, dt)
    updateAsteroids(world.asteroids, dt)
    world.particles = updateParticles(world.particles, dt)

    resolveBulletHits()
    if (shipCrashed()) {
      killShip()
      return
    }
    advanceWaveIfClear()
  }

  const step = (dt: number): void => {
    if (phase === GamePhase.PLAYING) {
      stepPlaying(dt)
    } else {
      // Title + game-over: keep the rocks drifting (and debris fading) as ambiance.
      world.time += dt
      updateAsteroids(world.asteroids, dt)
      world.particles = updateParticles(world.particles, dt)
    }
  }

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_DT)
    step(dt)
    publish()
    renderer.draw(world, phase)
  })

  const start = (): void => {
    score = 0
    lives = SHIP_START_LIVES
    world = createWorld(makeSeed())
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
