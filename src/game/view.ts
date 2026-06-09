import { Application } from 'pixi.js'

import { Color, VIEW_HEIGHT, VIEW_WIDTH } from '$/game/constants'

// Boot a PixiJS Application sized to the viewport and styled to fill its host box. Shared by
// the offline engine and the online net client (both own a renderer + ticker on top of it).
export const createCanvasApp = async (): Promise<Application> => {
  const app = new Application()
  await app.init({
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    background: Color.BACKGROUND,
    antialias: true,
    resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    autoDensity: false,
  })
  app.canvas.style.width = '100%'
  app.canvas.style.height = '100%'
  app.canvas.style.display = 'block'
  return app
}
