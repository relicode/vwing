import {
  BASE_CAPTURE_RADIUS,
  BASE_CAPTURE_TIME,
  BASE_GARRISON_CAP,
  BASE_GARRISON_REGEN,
  BASE_GARRISON_START,
  BASE_LOAD_RADIUS,
  BASE_LOAD_RATE,
  BASE_REVERT_TIME,
  BOT_ID,
  DeviceKind,
  INFANTRY_PICKUP_SPEED,
  PLAYER_ID,
  TROOP_BAY_CAPACITY,
} from '$/game/constants'
import { basePadCenters } from '$/game/terrain-map'
import type { Base, World } from '$/game/types'

// The campaign's two home barracks, seated on the generator's flat pads (west = player,
// east = bot). DEATHMATCH never calls this — world.bases stays [] and every base rule is a no-op.
export const createCampaignBases = (): Base[] => {
  const [west, east] = basePadCenters()
  return [
    { owner: PLAYER_ID, x: west.x, y: west.y, garrison: BASE_GARRISON_START, capture: 0 },
    { owner: BOT_ID, x: east.x, y: east.y, garrison: BASE_GARRISON_START, capture: 0 },
  ]
}

// Advance every barracks one frame: garrison regen, owner loading, and the capture tug-of-war.
// Drop placement is the whole skill — troopers only count while landed inside the disc, and they
// never pathfind toward it.
export const stepBases = (world: World, dt: number): void => {
  for (const base of world.bases) {
    const captured = base.capture >= 1

    // Garrison replenishes only while the owner holds the base.
    if (!captured && base.garrison < BASE_GARRISON_CAP) {
      base.garrison = Math.min(BASE_GARRISON_CAP, base.garrison + BASE_GARRISON_REGEN * dt)
    }

    // Loading: the owner ship hovering/landed slow by the pad (the same gentle-approach verb as
    // the trooper rescue) streams garrison into its bay.
    const owner = world.ships.find((s) => s.id === base.owner)
    if (
      owner &&
      !captured &&
      Math.hypot(owner.vx, owner.vy) <= INFANTRY_PICKUP_SPEED &&
      Math.hypot(owner.x - base.x, owner.y - (base.y - 40)) <= BASE_LOAD_RADIUS
    ) {
      const moved = Math.min(BASE_LOAD_RATE * dt, base.garrison, TROOP_BAY_CAPACITY - owner.troops)
      if (moved > 0) {
        base.garrison -= moved
        owner.troops += moved
      }
    }

    // Capture tug-of-war over the LANDED troopers inside the disc: attackers alone push progress
    // (crossing 1 records the capturer), any defender freezes it, and an empty zone bleeds it
    // back — which is also how a base is re-liberated (dropping below 1 clears capturedBy), so
    // purging the zone with ship guns alone wins the base back too.
    let attackers = 0
    let defenders = 0
    let attackerId: number | undefined
    for (const d of world.devices) {
      if (d.kind !== DeviceKind.INFANTRY || !d.attached) continue
      if (Math.hypot(d.x - base.x, d.y - base.y) > BASE_CAPTURE_RADIUS) continue
      if (d.owner === base.owner) {
        defenders += 1
      } else {
        attackers += 1
        attackerId = d.owner
      }
    }
    if (attackers > 0 && defenders === 0) {
      base.capture = Math.min(1, base.capture + dt / BASE_CAPTURE_TIME)
      if (base.capture >= 1) base.capturedBy = attackerId
    } else if (attackers === 0 && base.capture > 0) {
      base.capture = Math.max(0, base.capture - dt / BASE_REVERT_TIME)
      if (base.capture < 1) base.capturedBy = undefined
    }
  }
}
