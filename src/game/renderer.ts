// Re-export shim: the renderer lives in src/game/render/ (split in PLAN.md Phase 3). Kept so
// the engine's and the net client's `$/game/renderer` imports stay stable.
export { createRenderer, type Renderer } from '$/game/render'
