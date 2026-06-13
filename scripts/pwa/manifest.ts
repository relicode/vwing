// Web app manifest builder. Fields that the spec resolves against the manifest URL
// (start_url, scope, id, icon srcs) are emitted absolute against the deploy base anyway,
// so the file is unambiguous wherever it is fetched from.

import {
  APP_VERSION,
  absoluteUrl,
  GAME_DESCRIPTION,
  GAME_NAME,
  GAME_TITLE,
  MANIFEST_ICONS,
  SHARE_IMAGE,
  THEME_COLOR,
} from './identity'

export const buildManifest = (site: string): Record<string, unknown> => ({
  name: GAME_TITLE,
  short_name: GAME_NAME,
  description: GAME_DESCRIPTION,
  version: APP_VERSION,
  id: site,
  start_url: site,
  scope: site,
  display: 'standalone',
  orientation: 'landscape',
  theme_color: THEME_COLOR,
  background_color: THEME_COLOR,
  lang: 'en',
  dir: 'ltr',
  categories: ['games'],
  icons: MANIFEST_ICONS.map((icon) => ({
    src: absoluteUrl(site, icon.file),
    sizes: `${icon.size}x${icon.size}`,
    type: 'image/png',
    purpose: icon.purpose,
  })),
  // The share card doubles as the richer-install-UI screenshot.
  screenshots: [
    {
      src: absoluteUrl(site, SHARE_IMAGE.file),
      sizes: `${SHARE_IMAGE.width}x${SHARE_IMAGE.height}`,
      type: 'image/png',
      form_factor: 'wide',
      label: GAME_TITLE,
    },
  ],
})
