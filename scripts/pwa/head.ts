// Head metadata injected into dist/index.html after the bundle: PWA links (manifest, icons,
// theme-color), social/share metadata (canonical + Open Graph + Twitter card), and a
// schema.org VideoGame JSON-LD block — mapifest's seo.astro/json-ld.astro, hand-rolled.
// Injection happens post-build so Bun's HTML bundler never tries to hash-rename the
// manifest or icons, and the dev server stays free of dead references.

import {
  APPLE_TOUCH_ICON,
  absoluteUrl,
  FAVICON,
  GAME_DESCRIPTION,
  GAME_NAME,
  GAME_TITLE,
  MANIFEST_ICONS,
  SHARE_IMAGE,
  THEME_COLOR,
} from './identity'

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// `<` escaped to its unicode form so a value can never break out of the inline
// <script> block (the same guarantee mapifest's buildJsonLd makes).
export const buildJsonLd = (site: string): string =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: GAME_NAME,
    alternateName: GAME_TITLE,
    description: GAME_DESCRIPTION,
    url: site,
    image: absoluteUrl(site, SHARE_IMAGE.file),
    genre: ['Shooter', 'Real-time strategy'],
    gamePlatform: 'Web browser',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any',
    playMode: ['SinglePlayer', 'MultiPlayer'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
  }).replaceAll('<', '\\u003c')

export const buildHeadTags = (site: string): string => {
  // Even the site-derived URLs go through escapeAttribute: the WHATWG URL serializer can
  // emit a raw double quote in the host (https://%22.example.com/ round-trips to a literal
  // "), so "it's a parsed URL" is not an escaping guarantee.
  const href = (path?: string): string => escapeAttribute(path === undefined ? site : absoluteUrl(site, path))
  const shareImage = href(SHARE_IMAGE.file)
  const shareAlt = `${GAME_TITLE} — a neon ship dogfight over voxel terrain`
  const appIcon = MANIFEST_ICONS.find((icon) => icon.purpose === 'any') ?? MANIFEST_ICONS[0]
  const lines = [
    `<meta name="description" content="${escapeAttribute(GAME_DESCRIPTION)}">`,
    `<meta name="theme-color" content="${THEME_COLOR}">`,
    `<link rel="canonical" href="${href()}">`,
    `<link rel="manifest" href="${href('manifest.webmanifest')}">`,
    `<link rel="icon" type="image/png" sizes="${FAVICON.size}x${FAVICON.size}" href="${href(FAVICON.file)}">`,
    `<link rel="icon" type="image/png" sizes="${appIcon.size}x${appIcon.size}" href="${href(appIcon.file)}">`,
    `<link rel="apple-touch-icon" sizes="${APPLE_TOUCH_ICON.size}x${APPLE_TOUCH_ICON.size}" href="${href(APPLE_TOUCH_ICON.file)}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    `<meta name="apple-mobile-web-app-title" content="${escapeAttribute(GAME_NAME)}">`,
    `<meta property="og:title" content="${escapeAttribute(GAME_TITLE)}">`,
    `<meta property="og:description" content="${escapeAttribute(GAME_DESCRIPTION)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${href()}">`,
    `<meta property="og:site_name" content="${escapeAttribute(GAME_NAME)}">`,
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:image" content="${shareImage}">`,
    `<meta property="og:image:width" content="${SHARE_IMAGE.width}">`,
    `<meta property="og:image:height" content="${SHARE_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${escapeAttribute(shareAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeAttribute(GAME_TITLE)}">`,
    `<meta name="twitter:description" content="${escapeAttribute(GAME_DESCRIPTION)}">`,
    `<meta name="twitter:image" content="${shareImage}">`,
    `<script type="application/ld+json">${buildJsonLd(site)}</script>`,
  ]
  return lines.join('')
}

export const injectHead = (html: string, site: string): string => {
  if (!html.includes('</head>')) throw new Error('injectHead: no </head> in document')
  if (html.includes('rel="manifest"')) throw new Error('injectHead: document already carries PWA head tags')
  // Function replacement so `$&`-style patterns in the tag block stay literal.
  return html.replace('</head>', () => `${buildHeadTags(site)}</head>`)
}
