// The game's public identity, shared by the manifest, the head metadata, and the icon bake
// so every surface (installed app, link unfurl, search result) tells the same story.

export const SITE_DEFAULT = 'https://mccall.kapsi.fi/vwing/'

export const GAME_NAME = 'V-Wing'
export const GAME_TITLE = 'V-Wing — Gravity Dogfighter'
export const GAME_DESCRIPTION =
  'An XPilot-style 2D gravity dogfighter over destructible voxel terrain: fly Newtonian ships, ' +
  'paradrop autonomous infantry, and capture the enemy barracks — solo against the AI or in online deathmatch.'
export const THEME_COLOR = '#04060c'

// Manifest icons (baked by artwork.ts). `purpose: maskable` art keeps the ship inside the
// platform mask's safe zone; the rest are full-bleed squares.
export const MANIFEST_ICONS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-512-maskable.png', size: 512, purpose: 'maskable' },
] as const

export const APPLE_TOUCH_ICON = { file: 'apple-touch-icon.png', size: 180 } as const
export const FAVICON = { file: 'favicon.png', size: 48 } as const
export const SHARE_IMAGE = { file: 'og-image.png', width: 1200, height: 630 } as const

// Normalize the deploy origin: must parse as an absolute http(s) URL and end in '/' so it
// can serve as the manifest scope and as the base every relative artifact resolves against.
export const resolveSiteBase = (raw: string): string => {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`site base must be http(s): ${raw}`)
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  url.search = ''
  url.hash = ''
  return url.href
}

export const absoluteUrl = (site: string, path: string): string => new URL(path, site).href
