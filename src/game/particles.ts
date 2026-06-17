import { randRange } from '$/game/rng'
import type { Particle, Rng, World } from '$/game/types'

const DEFAULT_BURST = 16

export const spawnExplosion = (
  particles: Particle[],
  x: number,
  y: number,
  color: number,
  rng: Rng,
  count = DEFAULT_BURST
): void => {
  for (let i = 0; i < count; i += 1) {
    const angle = randRange(rng, 0, Math.PI * 2)
    const speed = randRange(rng, 40, 230)
    const life = randRange(rng, 0.3, 0.7)
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: randRange(rng, 1.5, 3.6),
      color,
    })
  }
}

// A discrete explosion that BOTH draws locally (offline play and the server's own headless sim)
// AND records a compact trigger on `world.fx` for the networked client to replay. This is how a
// sim-spawned FX (trooper blood, base sparks, weapon detonations, splashes) reaches online players
// without the high-churn particle field ever crossing the wire. Continuous trails (thrust/smoke)
// deliberately bypass this and call spawnExplosion/spawnPuff directly — the client regenerates
// those locally from ship state. Consumes the SAME rng draws spawnExplosion does, so routing a
// site through burst() never shifts the sim's deterministic stream.
export const burst = (world: World, x: number, y: number, color: number, count = DEFAULT_BURST): void => {
  spawnExplosion(world.particles, x, y, color, world.rng, count)
  world.fx.push({ x, y, color, count })
}

// A single drifting puff (exhaust ember, smoke) emitted with a base velocity + slight jitter.
export const spawnPuff = (
  particles: Particle[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  color: number,
  rng: Rng,
  lifeMax: number
): void => {
  const life = randRange(rng, lifeMax * 0.6, lifeMax)
  particles.push({
    x,
    y,
    vx: vx + randRange(rng, -18, 18),
    vy: vy + randRange(rng, -18, 18),
    life,
    maxLife: life,
    size: randRange(rng, 1.4, 3),
    color,
  })
}

export const updateParticles = (particles: Particle[], dt: number): Particle[] => {
  const drag = Math.exp(-3 * dt)
  for (const particle of particles) {
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.vx *= drag
    particle.vy *= drag
    particle.life -= dt
  }
  return particles.filter((particle) => particle.life > 0)
}
