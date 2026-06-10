import { Graphics, Particle, ParticleContainer, Rectangle, type Renderer, type Texture } from 'pixi.js'

import { WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import type { Particle as SimParticle } from '$/game/types'

// GPU particle pass: the sim's Particle[] (data + physics stay sim-owned) drawn as one batched
// ParticleContainer instead of per-circle Graphics tessellation. Every particle is the same
// generated white disc, scaled to p.size and tinted/faded per frame.

const TEXTURE_R = 8 // px radius of the generated disc; particle scale = p.size / TEXTURE_R

export type ParticlesView = {
  container: ParticleContainer<Particle>
  draw: (particles: SimParticle[]) => void
  destroy: () => void
}

export const createParticlesView = (renderer: Renderer): ParticlesView => {
  // Boot-time texture: a white antialiased disc rendered once — tint does the coloring.
  const disc = new Graphics().circle(TEXTURE_R, TEXTURE_R, TEXTURE_R).fill(0xffffff)
  const texture: Texture = renderer.generateTexture({ target: disc, antialias: true })
  disc.destroy()

  const container = new ParticleContainer<Particle>({
    texture,
    // Mandatory: ParticleContainer reports empty bounds by default and would be culled invisible.
    boundsArea: new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT),
    // Position, tint+alpha (color), and scale (vertex) all animate every frame.
    dynamicProperties: { position: true, color: true, vertex: true },
  })

  // Index-pooled views: sim particles carry no ids, so view i mirrors particles[i] each frame.
  const spare: Particle[] = []

  const draw = (particles: SimParticle[]): void => {
    const live = container.particleChildren
    while (live.length < particles.length) {
      live.push(spare.pop() ?? new Particle({ texture, anchorX: 0.5, anchorY: 0.5 }))
    }
    while (live.length > particles.length) {
      const surplus = live.pop()
      if (surplus !== undefined) spare.push(surplus)
    }
    for (let i = 0; i < particles.length; i += 1) {
      const src = particles[i]
      const view = live[i]
      view.x = src.x
      view.y = src.y
      const scale = src.size / TEXTURE_R
      view.scaleX = scale
      view.scaleY = scale
      view.tint = src.color
      view.alpha = Math.max(0, src.life / src.maxLife)
    }
    container.update() // single re-upload after direct particleChildren manipulation
  }

  const destroy = (): void => {
    texture.destroy(true)
  }

  return { container, draw, destroy }
}
