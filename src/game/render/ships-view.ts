import { Container, Graphics, GraphicsContext } from 'pixi.js'

import { Color } from '$/game/constants'
import { ownerHex, type PaletteSlots } from '$/game/render/owner-colors'
import type { Ship } from '$/game/types'

// Retained ship pass: one Container per ship (diffed by ship.id — snapshot array identity
// changes every net tick), positioned/rotated/scaled per frame instead of re-tessellated.
// All geometry lives in shared GraphicsContexts built once in UNIT space (radius 1, nose at
// rotation 0 along +x), so `scale = ship.radius` and `rotation = ship.angle` do the rest.

const WING_SPREAD = 2.4 // radians from nose to each tail corner
const FLAME_FRAMES = 3 // the sim's flicker is a discrete 3-frame cycle: Math.floor(time*40)%3

// Hull + cockpit core for one team color (the fills the sim drew last, after the flames).
const hullContext = (hull: number): GraphicsContext =>
  new GraphicsContext()
    .poly([
      Math.cos(0) * 1.5,
      Math.sin(0) * 1.5,
      Math.cos(WING_SPREAD),
      Math.sin(WING_SPREAD),
      Math.cos(-WING_SPREAD),
      Math.sin(-WING_SPREAD),
    ])
    .fill({ color: hull })
    .circle(0, 0, 0.34)
    .fill({ color: Color.SHIP_CORE })

// Main engine flame frame k: the tail tongue stretching to -(1.1 + flick) behind the wings.
const thrustContext = (k: number): GraphicsContext => {
  const flick = 0.6 + k * 0.28
  return new GraphicsContext()
    .poly([
      Math.cos(WING_SPREAD) * 0.7,
      Math.sin(WING_SPREAD) * 0.7,
      Math.cos(-WING_SPREAD) * 0.7,
      Math.sin(-WING_SPREAD) * 0.7,
      -(1.1 + flick),
      0,
    ])
    .fill({ color: Color.THRUST, alpha: 0.9 })
}

// Retro plume frame k: the two smaller tongues licking FORWARD past the nose's flanks.
const retroContext = (k: number): GraphicsContext => {
  const flick = 0.5 + k * 0.25
  const ctx = new GraphicsContext()
  for (const side of [1, -1]) {
    const by = side * 0.55
    ctx
      .poly([0.9, by + side * 0.2, 0.9, by - side * 0.2, 0.9 + (0.5 + flick * 0.6), by])
      .fill({ color: Color.THRUST, alpha: 0.85 })
  }
  return ctx
}

// Spawn-invulnerability blink: the whole ship (bars included) strobes at 12 Hz. Shared with the
// bars pass in index.ts so both halves of a ship vanish on the same frames, as the sim drew it.
export const shipBlinkHidden = (ship: Ship, time: number): boolean => ship.invuln > 0 && Math.floor(time * 12) % 2 === 0

type ShipView = {
  root: Container
  thrust: Graphics
  retro: Graphics
  hull: Graphics
  hex: number // the hull context's color, so a slot change swaps contexts instead of rebuilding
  ring: Graphics | undefined // the white self-ring (built on the self view only)
}

export type ShipsView = {
  layer: Container
  draw: (ships: Ship[], time: number, selfId: number, slots?: PaletteSlots) => void
  destroy: () => void
}

export const createShipsView = (): ShipsView => {
  const layer = new Container()
  // One shared hull context per color, built lazily — bounded by the palette (8) plus the two
  // legacy hues (which equal slots 0/1, so the bank really tops out at the palette size).
  const hullBank = new Map<number, GraphicsContext>()
  const hullFor = (hex: number): GraphicsContext => {
    let context = hullBank.get(hex)
    if (context === undefined) {
      context = hullContext(hex)
      hullBank.set(hex, context)
    }
    return context
  }
  // The self-ring: with every seat in its own color, the white halo is what still says "you"
  // at a glance (shown only when a palette map is in play — the campaign keeps cyan-vs-rose).
  const ringContext = new GraphicsContext()
    .circle(0, 0, 1.4)
    .stroke({ width: 0.12, color: Color.SHIP_CORE, alpha: 0.55 })
  const thrustFrames = Array.from({ length: FLAME_FRAMES }, (_, k) => thrustContext(k))
  const retroFrames = Array.from({ length: FLAME_FRAMES }, (_, k) => retroContext(k))
  const views = new Map<number, ShipView>()

  const buildView = (hex: number, isSelf: boolean): ShipView => {
    const root = new Container()
    root.cullable = true // far-away ships skip rendering entirely (CullerPlugin)
    const thrust = new Graphics(thrustFrames[0])
    const retro = new Graphics(retroFrames[0])
    const hull = new Graphics(hullFor(hex))
    root.addChild(thrust, retro, hull) // flames under the hull, as the sim drew them
    let ring: Graphics | undefined
    if (isSelf) {
      ring = new Graphics(ringContext)
      root.addChild(ring)
    }
    layer.addChild(root)
    return { root, thrust, retro, hull, hex, ring }
  }

  const draw = (ships: Ship[], time: number, selfId: number, slots?: PaletteSlots): void => {
    const seen = new Set<number>()
    // The flicker is time-derived (deterministic from the snapshot), not a local animation.
    const frame = Math.floor(time * 40) % FLAME_FRAMES
    for (const ship of ships) {
      seen.add(ship.id)
      const hex = ownerHex(ship.id, selfId, slots)
      let view = views.get(ship.id)
      if (view === undefined) {
        view = buildView(hex, ship.id === selfId)
        views.set(ship.id, view)
      }
      if (view.hex !== hex) {
        view.hull.context = hullFor(hex) // a reassigned slot recolors in place
        view.hex = hex
      }
      if (view.ring) view.ring.visible = slots !== undefined
      view.root.position.set(ship.x, ship.y)
      view.root.rotation = ship.angle
      view.root.scale.set(ship.radius)
      view.root.visible = !shipBlinkHidden(ship, time)
      view.thrust.visible = ship.thrusting
      if (ship.thrusting) view.thrust.context = thrustFrames[frame]
      view.retro.visible = ship.reversing
      // The sim's retro flick ran one step ahead of the main flame: floor(time*40 + 1) % 3.
      if (ship.reversing) view.retro.context = retroFrames[(frame + 1) % FLAME_FRAMES]
    }
    for (const [id, view] of views) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true }) // shared contexts survive — Graphics doesn't own them
        views.delete(id)
      }
    }
  }

  const destroy = (): void => {
    for (const context of [ringContext, ...hullBank.values(), ...thrustFrames, ...retroFrames]) context.destroy()
    hullBank.clear()
  }

  return { layer, draw, destroy }
}
