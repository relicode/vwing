import { Color, PLAYER_PALETTE } from '$/game/constants'

// Per-seat coloring for the render passes. Online, the client passes a map of owner id →
// PLAYER_PALETTE slot (built from the snapshot's players[], benched seats included so orphaned
// troopers keep their team color); every pass resolves through these helpers. With NO map (the
// offline campaign) each pass keeps the legacy binary — self cyan, enemy rose — so the campaign
// renders pixel-identical by construction, not by re-derivation.
export type PaletteSlots = ReadonlyMap<number, number>

// Channel math on 0xRRGGBB hexes.
export const darken = (hex: number, f: number): number => {
  const r = Math.round(((hex >> 16) & 0xff) * f)
  const g = Math.round(((hex >> 8) & 0xff) * f)
  const b = Math.round((hex & 0xff) * f)
  return (r << 16) | (g << 8) | b
}
export const lighten = (hex: number, f: number): number => {
  const channel = (v: number): number => Math.round(v + (0xff - v) * f)
  return (channel((hex >> 16) & 0xff) << 16) | (channel((hex >> 8) & 0xff) << 8) | channel(hex & 0xff)
}

// Derived per-slot tables, built once — the palette is a closed set, so immutable module
// constants replace any runtime cache. RIM darkens a trooper's outline to its team shade;
// FLASH is the seat's shot/muzzle hue.
export const PALETTE_RIM: readonly number[] = PLAYER_PALETTE.map((hex) => darken(hex, 0.6))
export const PALETTE_FLASH: readonly number[] = PLAYER_PALETTE.map((hex) => lighten(hex, 0.35))

// The hull hex for an owner: its palette slot online (unknown owners fall back to the enemy
// rose — slot 1), the legacy self/enemy binary offline.
export const ownerHex = (owner: number, selfId: number, slots?: PaletteSlots): number => {
  if (!slots) return owner === selfId ? Color.SHIP : Color.ENEMY
  return PLAYER_PALETTE[slots.get(owner) ?? 1] ?? Color.ENEMY
}
