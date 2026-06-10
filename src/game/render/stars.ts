import { Container, Graphics, type Renderer, RenderTexture, TilingSprite } from 'pixi.js'

import { Color, VIEW_HEIGHT, VIEW_WIDTH } from '$/game/constants'
import { randRange } from '$/game/rng'
import type { Rng, Vec2 } from '$/game/types'

// Parallax starfield as depth-banded TilingSprites: the seeded stars are bucketed into a few
// depth bands, each baked once into a viewport-sized RenderTexture; per frame only each band's
// tilePosition moves (-camera · band depth). The texture wraps, replacing the hand-modulo loop.

export type Star = { x: number; y: number; depth: number; size: number }

const STAR_COUNT = 150
const BAND_COUNT = 3
const DEPTH_MIN = 0.15 // the range createStars rolls — banding buckets span it evenly
const DEPTH_MAX = 0.6

const createStars = (rng: Rng): Star[] => {
  const stars: Star[] = []
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const depth = randRange(rng, DEPTH_MIN, DEPTH_MAX)
    stars.push({
      x: randRange(rng, 0, VIEW_WIDTH),
      y: randRange(rng, 0, VIEW_HEIGHT),
      depth,
      size: 0.6 + depth * 2,
    })
  }
  return stars
}

const bandOf = (depth: number): number =>
  Math.min(BAND_COUNT - 1, Math.floor(((depth - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN)) * BAND_COUNT))

// A star keeps its per-star look (color split, alpha, size); copies near the texture edges are
// re-drawn wrapped so the tiling seam never cuts a dot in half.
const drawStarInto = (g: Graphics, star: Star): void => {
  const color = star.depth > 0.42 ? Color.STAR_NEAR : Color.STAR_FAR
  const alpha = 0.35 + star.depth * 0.8
  const margin = star.size + 1
  const xs = [star.x]
  if (star.x < margin) xs.push(star.x + VIEW_WIDTH)
  if (star.x > VIEW_WIDTH - margin) xs.push(star.x - VIEW_WIDTH)
  const ys = [star.y]
  if (star.y < margin) ys.push(star.y + VIEW_HEIGHT)
  if (star.y > VIEW_HEIGHT - margin) ys.push(star.y - VIEW_HEIGHT)
  for (const x of xs) {
    for (const y of ys) g.circle(x, y, star.size).fill({ color, alpha })
  }
}

export type StarsView = {
  container: Container
  update: (camera: Vec2) => void
  destroy: () => void
}

export const createStarsView = (rng: Rng, renderer: Renderer): StarsView => {
  const stars = createStars(rng)
  const container = new Container()
  const bands: { sprite: TilingSprite; depth: number }[] = []
  for (let b = 0; b < BAND_COUNT; b += 1) {
    const members = stars.filter((star) => bandOf(star.depth) === b)
    if (members.length === 0) continue
    const art = new Graphics()
    for (const star of members) drawStarInto(art, star)
    // Bake at the renderer's own resolution: the dots are sub-pixel (r 0.6–1.8), so a 1x bake
    // loses most of their coverage and the field all but vanishes on hidpi screens.
    const texture = RenderTexture.create({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      antialias: true,
      resolution: renderer.resolution,
      // The bands tile, and this MUST be set at create time: a post-hoc `source.addressMode =`
      // never calls style.update(), so the sampler id memoized at first render stays clamp.
      addressMode: 'repeat',
    })
    renderer.render({ container: art, target: texture })
    art.destroy()
    const sprite = new TilingSprite({ texture, width: VIEW_WIDTH, height: VIEW_HEIGHT })
    container.addChild(sprite)
    // The band scrolls at its members' mean depth — nearer bands slide faster, as before.
    bands.push({ sprite, depth: members.reduce((sum, star) => sum + star.depth, 0) / members.length })
  }

  const update = (camera: Vec2): void => {
    for (const band of bands) band.sprite.tilePosition.set(-camera.x * band.depth, -camera.y * band.depth)
  }

  const destroy = (): void => {
    for (const band of bands) band.sprite.texture.destroy(true)
  }

  return { container, update, destroy }
}
