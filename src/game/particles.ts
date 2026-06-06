import { randRange } from '$/game/rng'
import type { Particle, Rng } from '$/game/types'

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
