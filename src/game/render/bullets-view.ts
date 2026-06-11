import { Graphics, Particle, ParticleContainer, Rectangle, type Renderer, Texture } from 'pixi.js'

import { Color, FLAMETHROWER_LIFE, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import { clamp } from '$/game/math'
import { PALETTE_FLASH, type PaletteSlots } from '$/game/render/owner-colors'
import type { Bullet } from '$/game/types'

// GPU bullet pass: primary shots and flame gouts batched through one ParticleContainer over a
// generated two-frame atlas — a hard antialiased disc for cores and a soft radial glow for the
// halos. Each bullet emits its layers in the sim's draw order (glow under core, per bullet).

const FRAME_R = 16 // logical px radius of each atlas frame; particle scale = radius / FRAME_R
const FRAME_D = FRAME_R * 2
const GLOW_STEPS = 8 // concentric rings approximating the radial falloff of the soft frame

export type BulletsView = {
  container: ParticleContainer<Particle>
  draw: (bullets: Bullet[], selfId: number, slots?: PaletteSlots) => void
  destroy: () => void
}

export const createBulletsView = (renderer: Renderer): BulletsView => {
  // Frame 0: hard disc. Frame 1: soft glow — stacked translucent rings that fade outward.
  const art = new Graphics().circle(FRAME_R, FRAME_R, FRAME_R).fill(0xffffff)
  for (let i = 0; i < GLOW_STEPS; i += 1) {
    art.circle(FRAME_D + FRAME_R, FRAME_R, FRAME_R * (1 - i / GLOW_STEPS)).fill({
      color: 0xffffff,
      alpha: (i + 1) / GLOW_STEPS / 2.5,
    })
  }
  const atlas = renderer.generateTexture({ target: art, antialias: true })
  art.destroy()
  const hard = new Texture({ source: atlas.source, frame: new Rectangle(0, 0, FRAME_D, FRAME_D) })
  const soft = new Texture({ source: atlas.source, frame: new Rectangle(FRAME_D, 0, FRAME_D, FRAME_D) })

  const container = new ParticleContainer<Particle>({
    texture: atlas,
    boundsArea: new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT),
    // A pooled slot can flip between the hard and soft frame between frames → uvs dynamic too.
    dynamicProperties: { position: true, color: true, vertex: true, uvs: true },
  })

  const spare: Particle[] = []
  let used = 0

  const emit = (texture: Texture, x: number, y: number, radius: number, tint: number, alpha: number): void => {
    const live = container.particleChildren
    let view: Particle
    if (used < live.length) {
      view = live[used]
    } else {
      view = spare.pop() ?? new Particle({ texture, anchorX: 0.5, anchorY: 0.5 })
      live.push(view)
    }
    view.texture = texture
    view.x = x
    view.y = y
    const scale = radius / FRAME_R
    view.scaleX = scale
    view.scaleY = scale
    view.tint = tint
    view.alpha = alpha
    used += 1
  }

  const draw = (bullets: Bullet[], selfId: number, slots?: PaletteSlots): void => {
    used = 0
    for (const bullet of bullets) {
      if (bullet.burn) {
        // A flame gout: it blooms as it ages — a swelling, dimming tongue around a white-hot
        // core that cools out of existence (life runs FLAMETHROWER_LIFE → 0). The color switch
        // at age 0.5 is a deliberate step, not a lerp.
        const age = clamp(1 - bullet.life / FLAMETHROWER_LIFE, 0, 1)
        const r = bullet.radius * (1.6 + age * 2.8)
        emit(soft, bullet.x, bullet.y, r * 1.5, Color.THRUST, 0.14)
        emit(hard, bullet.x, bullet.y, r, age < 0.5 ? Color.EXPLOSION : Color.THRUST, 0.85 - age * 0.45)
        emit(hard, bullet.x, bullet.y, r * 0.45, Color.SHIP_CORE, Math.max(0, 0.9 - age * 1.5))
        continue
      }
      // Online (a palette map in play): a shot carries its seat's flash hue, so tracers read
      // per-player; offline keeps the legacy self/enemy pair exactly.
      const owned = slots
        ? (PALETTE_FLASH[slots.get(bullet.owner) ?? 1] ?? Color.BULLET_ENEMY)
        : bullet.owner === selfId
          ? Color.BULLET
          : Color.BULLET_ENEMY
      const color = bullet.color ?? owned
      emit(soft, bullet.x, bullet.y, bullet.radius * 2.2, color, 0.18) // soft halo
      emit(hard, bullet.x, bullet.y, bullet.radius, color, 1)
    }
    const live = container.particleChildren
    while (live.length > used) {
      const surplus = live.pop()
      if (surplus !== undefined) spare.push(surplus)
    }
    container.update()
  }

  const destroy = (): void => {
    hard.destroy()
    soft.destroy()
    atlas.destroy(true)
  }

  return { container, draw, destroy }
}
