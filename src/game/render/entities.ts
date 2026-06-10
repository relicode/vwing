import type { Graphics } from 'pixi.js'

import { Color, DeviceKind, SHIP_MAX_HEALTH, SHIP_MAX_SHIELDS } from '$/game/constants'
import { clamp } from '$/game/math'
import { drawInfantry } from '$/game/render/infantry'
import type { Base, Beam, Device, Ship } from '$/game/types'

const WING_SPREAD = 2.4 // radians from nose to each tail corner

export const drawDevice = (g: Graphics, d: Device, time: number, selfId: number): void => {
  switch (d.kind) {
    case DeviceKind.MISSILE: {
      const a = Math.atan2(d.vy, d.vx)
      g.moveTo(d.x - Math.cos(a) * d.radius * 2.4, d.y - Math.sin(a) * d.radius * 2.4)
        .lineTo(d.x, d.y)
        .stroke({ width: 2, color: d.color, alpha: 0.55 })
      g.circle(d.x, d.y, d.radius).fill({ color: d.color })
      break
    }
    case DeviceKind.MINE: {
      const armed = d.armTime <= 0
      const color = armed ? Color.MINE_ARMED : Color.MINE
      g.circle(d.x, d.y, d.radius).stroke({ width: 2, color })
      g.circle(d.x, d.y, d.radius * 0.4).fill({ color })
      break
    }
    case DeviceKind.INFANTRY:
      drawInfantry(g, d, time, selfId)
      break
    case DeviceKind.GRENADE:
      g.circle(d.x, d.y, d.radius).fill({ color: Color.GRENADE })
      break
    case DeviceKind.FLAK:
      g.circle(d.x, d.y, d.radius).fill({ color: Color.FLAK })
      break
    case DeviceKind.WELL:
      g.circle(d.x, d.y, d.pullRadius).stroke({ width: 1, color: Color.WELL, alpha: 0.12 })
      g.circle(d.x, d.y, d.radius * 2).stroke({ width: 2, color: Color.WELL, alpha: 0.5 })
      g.circle(d.x, d.y, d.radius).fill({ color: Color.WELL })
      break
  }
}

export const drawBeams = (g: Graphics, beams: Beam[]): void => {
  for (const b of beams) {
    g.moveTo(b.x1, b.y1)
      .lineTo(b.x2, b.y2)
      .stroke({ width: 3, color: b.color, alpha: Math.max(0, b.life / b.maxLife) })
  }
}

// Floating hull (bottom) + shield (top) gauges above a ship, so combat reads at a glance.
const drawBars = (g: Graphics, ship: Ship): void => {
  const w = ship.radius * 2.6
  const x = ship.x - w / 2
  const y = ship.y - ship.radius - 12
  g.rect(x, y, w, 3).fill({ color: Color.BAR_BACK })
  g.rect(x, y, w * clamp(ship.health / SHIP_MAX_HEALTH, 0, 1), 3).fill({ color: Color.HEALTH })
  g.rect(x, y - 4, w, 2).fill({ color: Color.BAR_BACK })
  g.rect(x, y - 4, w * clamp(ship.shields / SHIP_MAX_SHIELDS, 0, 1), 2).fill({ color: Color.SHIELD })
}

export const drawShip = (g: Graphics, ship: Ship, time: number, isSelf: boolean): void => {
  if (ship.invuln > 0 && Math.floor(time * 12) % 2 === 0) return
  const a = ship.angle
  const r = ship.radius
  const hull = isSelf ? Color.SHIP : Color.ENEMY
  if (ship.thrusting) {
    const flick = 0.6 + (Math.floor(time * 40) % 3) * 0.28
    g.poly([
      ship.x + Math.cos(a + WING_SPREAD) * r * 0.7,
      ship.y + Math.sin(a + WING_SPREAD) * r * 0.7,
      ship.x + Math.cos(a - WING_SPREAD) * r * 0.7,
      ship.y + Math.sin(a - WING_SPREAD) * r * 0.7,
      ship.x - Math.cos(a) * r * (1.1 + flick),
      ship.y - Math.sin(a) * r * (1.1 + flick),
    ]).fill({ color: Color.THRUST, alpha: 0.9 })
  }
  if (ship.reversing) {
    // The two smaller retro plumes: short tongues licking FORWARD past the nose's flanks.
    const flick = 0.5 + (Math.floor(time * 40 + 1) % 3) * 0.25
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    for (const side of [1, -1]) {
      const bx = ship.x + nx * r * 0.9 - side * ny * r * 0.55
      const by = ship.y + ny * r * 0.9 + side * nx * r * 0.55
      g.poly([
        bx - ny * side * r * 0.2,
        by + nx * side * r * 0.2,
        bx + ny * side * r * 0.2,
        by - nx * side * r * 0.2,
        bx + nx * r * (0.5 + flick * 0.6),
        by + ny * r * (0.5 + flick * 0.6),
      ]).fill({ color: Color.THRUST, alpha: 0.85 })
    }
  }
  g.poly([
    ship.x + Math.cos(a) * r * 1.5,
    ship.y + Math.sin(a) * r * 1.5,
    ship.x + Math.cos(a + WING_SPREAD) * r,
    ship.y + Math.sin(a + WING_SPREAD) * r,
    ship.x + Math.cos(a - WING_SPREAD) * r,
    ship.y + Math.sin(a - WING_SPREAD) * r,
  ]).fill({ color: hull })
  g.circle(ship.x, ship.y, r * 0.34).fill({ color: Color.SHIP_CORE })
  drawBars(g, ship)
}

// A home barracks: a bunker squatting on its pad, tinted by whoever holds it (the tint flips to
// the capturer's color the moment it falls), with garrison helmet pips over the door and a
// flashing takeover bar while the capture is in progress. Drawn in the dynamic layer — capture
// state and garrison mutate every frame, so it can't live in the terrainVersion cache.
export const drawBase = (g: Graphics, base: Base, time: number, selfId: number): void => {
  const holder = base.capture >= 1 && base.capturedBy !== undefined ? base.capturedBy : base.owner
  const body = holder === selfId ? Color.SHIP : Color.ENEMY
  const w = 120
  const h = 52
  const x = base.x - w / 2
  const y = base.y - h
  g.roundRect(x, y, w, h, 8).fill({ color: body, alpha: 0.26 }).stroke({ width: 2, color: body })
  g.circle(base.x, y, 15).fill({ color: body, alpha: 0.5 }) // roof dome
  g.rect(base.x - 9, y + h - 26, 18, 26).fill({ color: Color.INK, alpha: 0.85 }) // door
  g.moveTo(x + w - 16, y)
    .lineTo(x + w - 16, y - 22)
    .stroke({ width: 2, color: body }) // antenna
  g.circle(x + w - 16, y - 24, 3).fill({ color: body })
  // Garrison pips: one helmet dot per housed trooper, racked beside the door.
  const housed = Math.floor(base.garrison)
  for (let i = 0; i < housed; i += 1) {
    const px = x + 10 + (i % 6) * 10
    const py = y + 12 + Math.floor(i / 6) * 9
    g.circle(px, py, 3).fill({ color: Color.SMOKE })
  }
  // Takeover bar above the roof while a capture is running (flashes to read as an alarm).
  if (base.capture > 0 && base.capture < 1) {
    const blink = Math.floor(time * 4) % 2 === 0
    g.rect(x, y - 34, w, 5).fill({ color: Color.BAR_BACK })
    g.rect(x, y - 34, w * base.capture, 5).fill({ color: Color.THRUST, alpha: blink ? 1 : 0.55 })
  }
}
