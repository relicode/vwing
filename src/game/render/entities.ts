import type { Graphics } from 'pixi.js'

import { baseHolder, captureLead } from '$/game/bases'
import {
  BASE_BUILDING_HALF_WIDTH,
  BASE_BUILDING_HEIGHT,
  Color,
  DeviceKind,
  SHIP_MAX_HEALTH,
  SHIP_MAX_SHIELDS,
} from '$/game/constants'
import { clamp } from '$/game/math'
import { drawInfantry } from '$/game/render/infantry'
import { lighten, ownerHex, type PaletteSlots } from '$/game/render/owner-colors'
import type { Base, Beam, Device, Ship } from '$/game/types'

export const drawDevice = (g: Graphics, d: Device, time: number, selfId: number, slots?: PaletteSlots): void => {
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
      drawInfantry(g, d, time, selfId, slots)
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
// Immediate-mode on purpose: the bars never rotate with the hull (ships-view owns the hull).
export const drawBars = (g: Graphics, ship: Ship): void => {
  const w = ship.radius * 2.6
  const x = ship.x - w / 2
  const y = ship.y - ship.radius - 12
  g.rect(x, y, w, 3).fill({ color: Color.BAR_BACK })
  g.rect(x, y, w * clamp(ship.health / SHIP_MAX_HEALTH, 0, 1), 3).fill({ color: Color.HEALTH })
  g.rect(x, y - 4, w, 2).fill({ color: Color.BAR_BACK })
  g.rect(x, y - 4, w * clamp(ship.shields / SHIP_MAX_SHIELDS, 0, 1), 2).fill({ color: Color.SHIELD })
}

// A home barracks: a bunker squatting on its pad, tinted by whoever holds it (the tint flips to
// the capturer's color the moment it falls). Its translucent body shows the fielded defenders
// standing inside (drawn by the infantry layer); reserve helmet pips rack over the door, and a
// flashing takeover bar runs above the roof while a capture is in progress. Drawn in the dynamic
// layer — capture state and the reserve count mutate every frame, so it can't live in the cache.
export const drawBase = (g: Graphics, base: Base, time: number, selfId: number, slots?: PaletteSlots): void => {
  const body = ownerHex(baseHolder(base), selfId, slots)
  const w = BASE_BUILDING_HALF_WIDTH * 2 // the drawn body IS the solid/impenetrable box (see baseBuilding)
  const h = BASE_BUILDING_HEIGHT
  const x = base.x - w / 2
  const y = base.y - h
  g.roundRect(x, y, w, h, 8).fill({ color: body, alpha: 0.26 }).stroke({ width: 2, color: body })
  // Your own barracks reads at a glance — a bright inner ring sets it apart from rivals' forts.
  if (baseHolder(base) === selfId) {
    g.roundRect(x + 3.5, y + 3.5, w - 7, h - 7, 6).stroke({ width: 1.5, color: lighten(body, 0.55), alpha: 0.95 })
  }
  g.circle(base.x, y, 15).fill({ color: body, alpha: 0.5 }) // roof dome
  g.rect(base.x - 9, y + h - 26, 18, 26).fill({ color: Color.INK, alpha: 0.85 }) // door
  g.moveTo(x + w - 16, y)
    .lineTo(x + w - 16, y - 22)
    .stroke({ width: 2, color: body }) // antenna
  g.circle(x + w - 16, y - 24, 3).fill({ color: body })
  // Reserve pips: one helmet dot per reserve trooper (the fielded defenders stand inside the
  // building proper), racked beside the door.
  const housed = Math.floor(base.garrison)
  for (let i = 0; i < housed; i += 1) {
    const px = x + 10 + (i % 6) * 10
    const py = y + 12 + Math.floor(i / 6) * 9
    g.circle(px, py, 3).fill({ color: Color.SMOKE })
  }
  // Takeover bar above the roof while a capture is running — colored by the LEADING attacker's seat,
  // so a contested fort shows WHO is taking it rather than one anonymous green bar (flashes as alarm).
  const lead = captureLead(base)
  if (lead) {
    const blink = Math.floor(time * 4) % 2 === 0
    g.rect(x, y - 34, w, 5).fill({ color: Color.BAR_BACK })
    g.rect(x, y - 34, w * lead.pct, 5).fill({ color: ownerHex(lead.by, selfId, slots), alpha: blink ? 1 : 0.55 })
    // Contested: the runner-up's progress as a thinner under-bar in HIS seat color, so a multi-pilot
    // brawl reads distinctly from a lone storm (and you can see you're being out-stormed).
    let runnerPct = 0
    let runnerBy = -1
    for (const key of Object.keys(base.contest)) {
      const id = Number(key)
      if (id !== lead.by && base.contest[id] > runnerPct) {
        runnerPct = base.contest[id]
        runnerBy = id
      }
    }
    if (runnerBy >= 0) {
      g.rect(x, y - 27, w * runnerPct, 2).fill({ color: ownerHex(runnerBy, selfId, slots), alpha: 0.75 })
    }
  }
}
