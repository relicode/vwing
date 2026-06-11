// Default the installed app's window to the game area. The web manifest has no field for
// a launch window size, but Chromium grants standalone app windows the popup resizing
// privilege, so one resizeTo at boot sets the default; the platform clamps it to the
// screen and regular browser tabs ignore it (the display-mode guard never matches there).

import { VIEW_HEIGHT, VIEW_WIDTH } from '$/game/constants'

export const sizeStandaloneWindow = (): void => {
  if (!window.matchMedia('(display-mode: standalone)').matches) return
  // resizeTo takes the outer size; pad the game area with the current window chrome.
  const chromeWidth = window.outerWidth - window.innerWidth
  const chromeHeight = window.outerHeight - window.innerHeight
  window.resizeTo(VIEW_WIDTH + chromeWidth, VIEW_HEIGHT + chromeHeight)
}
