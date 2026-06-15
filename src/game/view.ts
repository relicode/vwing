import { Application, CullerPlugin, extensions } from 'pixi.js'

import { Color, VIEW_HEIGHT, VIEW_WIDTH } from '$/game/constants'

// Opt-in render culling: skips `cullable` containers (terrain chunks, ship views) whose bounds
// leave the screen. Registered once at module load — it must precede every app.init().
extensions.add(CullerPlugin)

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
    // All game input is keyboard and the surrounding UI is React-owned DOM, so nothing on the
    // stage ever listens to pointers — turn the FederatedEvents machinery off entirely.
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
  })
  app.stage.eventMode = 'none'
  app.canvas.style.width = '100%'
  app.canvas.style.height = '100%'
  app.canvas.style.display = 'block'
  return app
}

// Letterbox scale-to-fit. The stage is composed at the fixed VIEW_WIDTH×VIEW_HEIGHT design
// resolution — the same world-window for every client, which keeps online PvP fair (constants.ts).
// Rather than CSS-upscaling that fixed buffer (soft on displays wider than VIEW_WIDTH), resize the
// WebGL buffer to the canvas's on-screen box and uniformly scale + center the stage to fit,
// letterboxing the off-aspect axis with the renderer's BACKGROUND clear. Presentation-only: the
// camera/HUD math still runs in the unchanged VIEW_* space, now under the scaled stage. The
// per-frame `view.position` shake lives a layer below on `renderer.view`, so it composes cleanly.
// Returns a disposer that stops observing. Call once at boot; run it in the owner's destroy().
export const fitStageToCanvas = (app: Application): (() => void) => {
  const fit = (): void => {
    // The canvas fills its host (width/height:100%), so its client box is the on-screen size.
    // It is detached at boot — fall back to the design size until React mounts it (autoDensity is
    // off, so resizing the buffer never rewrites style.width, hence no observer feedback loop).
    const w = app.canvas.clientWidth || VIEW_WIDTH
    const h = app.canvas.clientHeight || VIEW_HEIGHT
    if (app.renderer.screen.width !== w || app.renderer.screen.height !== h) app.renderer.resize(w, h)
    const scale = Math.min(w / VIEW_WIDTH, h / VIEW_HEIGHT)
    app.stage.scale.set(scale)
    app.stage.position.set((w - VIEW_WIDTH * scale) / 2, (h - VIEW_HEIGHT * scale) / 2)
  }
  if (typeof ResizeObserver === 'undefined') {
    fit()
    return () => {}
  }
  const observer = new ResizeObserver(fit)
  observer.observe(app.canvas) // detached at boot; fires once the canvas is mounted into its host
  return () => observer.disconnect()
}
