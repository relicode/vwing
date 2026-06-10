# PixiJS v8 built-ins migration — living plan

Migrate V-Wing's **presentation layer** to idiomatic PixiJS v8 built-ins. Keep the React + MUI
shell and the framework-free deterministic sim exactly as they are.

**Resume protocol:** phases run one-by-one, each on its own git-flow feature branch, finished
(merged to `develop`) before the next starts. Tick the checkbox + add the merge commit hash when a
phase lands. If a session dies mid-phase, the feature branch holds the WIP; `git log develop..HEAD`
shows what's done.

## Status

- [x] Phase 0 — Docs sync (README.md is stale, CLAUDE.md layout) — branch `feature/pixi-p0-docs-sync` (merged `cc2c6e3`)
- [x] Phase 1 — Boundary guard test — branch `feature/pixi-p1-boundary-guard` (merged `22de837`)
- [x] Phase 2 — Application lifecycle & loop hygiene — branch `feature/pixi-p2-app-lifecycle` (merged `c3d03a5`)
- [x] Phase 3 — Mechanical split of renderer.ts — branch `feature/pixi-p3-renderer-split` (merged `a3257f3`)
- [x] Phase 4 — Particles → ParticleContainer — branch `feature/pixi-p4-particle-container` (merged `fd6fa36`)
- [x] Phase 5 — Bullets & flame gouts → particle atlas — branch `feature/pixi-p5-bullet-atlas` (merged `2d385e7`)
- [x] Phase 6 — Ships → retained Containers + GraphicsContext banks — branch `feature/pixi-p6-retained-ships` (merged `5f8ef68`)
- [x] Phase 7 — Starfield → TilingSprite parallax bands — branch `feature/pixi-p7-tiling-stars` (merged `9387a85`)
- [x] Phase 8 — Terrain chunking + minimap cacheAsTexture + culling — branch `feature/pixi-p8-terrain-chunks`
- [ ] Phase 9 — (optional, profile-gated) infantry draw batching

## Honest scope

PixiJS is a renderer — it has **no** physics, AI, camera, networking, or determinism tooling.
These stay custom and pixi-free forever (the sim runs headless on the Bun server via `src/server/`
and under `bun test`): Newtonian flight (`ship.ts`), collision, voxel carve/mesh/debris
(`voxel.ts`), infantry/bot AI (`devices.ts`, `bot.ts`), base capture, seeded RNG, camera/shake
*math*, `MAX_FRAME_DT` clamp, keyboard input, WebSocket protocol. No `Assets.load` — zero external
assets; all textures are runtime-generated from Graphics.

The genuinely reinvented wheels are all in the draw path: today only `Application` (view.ts) and
`Container, Graphics` (renderer.ts) are imported; everything dynamic is re-tessellated into one
immediate-mode `Graphics` per frame for the whole 10800×6750 world, with zero culling, hand-modulo
star parallax, and full terrain re-tessellation per carve/debris frame.

Hard constraints discovered in research:

- Wire snapshots carry **no particles** (server strips; `client.ts` regenerates with cosmetic
  `fxRng`) — particle *drawing* is presentation, particle *data/physics* stay sim-owned.
- Bullets/devices/particles have **no stable ids** (ships do) → index-pooled display objects;
  ships diff by `ship.id` (snapshot array identity changes every net tick).
- Animation inputs stay `world.time` + entity fields (never wall-clock/frame counters) so visuals
  remain deterministic and snapshot-driven.
- The expressive procedural infantry art is a shipped feature → stays procedural vector Graphics;
  sprite-baking is lossy, Phase 8 is profile-gated and skippable.
- `createEngine()` contract `{canvas, getStatus, subscribe, start, destroy}` (engine.ts:26) and
  the net client mirror (client.ts:51) must not change.

## Target scene graph (end state)

```
app.stage
└─ view: Container                                ← shake offset (as today)
   ├─ starLayers: 3-4 × TilingSprite              ← RenderTexture star bands; tilePosition = -camera·depth
   ├─ worldLayer: Container {isRenderGroup:true}  ← -camera offset (as today)
   │   ├─ terrainChunks: Graphics[≈8]             ← column bands, cullable, per-chunk redraw on carve
   │   ├─ waterGfx: Graphics                      ← redrawn with terrainVersion
   │   ├─ baseGfx + beamGfx + deviceGfx: Graphics ← immediate-mode (mutate every frame; infantry procedural)
   │   ├─ bulletFx: ParticleContainer             ← bullets + glows + flame gouts (2-frame generated atlas)
   │   ├─ particleFx: ParticleContainer           ← world.particles / fxParticles (white disc, tint+alpha)
   │   └─ shipLayer: Container                    ← per-ship retained Containers — ships stay ABOVE
   │                                                the fx passes (the sim always drew them last)
   └─ mapLayer: Container                         ← counter-shake (as today)
       ├─ mapTerrain: cacheAsTexture(true)        ← updateCacheTexture() on terrainVersion
       └─ mapDynGfx: Graphics                     ← per-frame markers
```

`createRenderer` gains `app.renderer` (passed from engine.ts/client.ts — internal factory
signature, contract-safe) for boot-time `generateTexture()`.

## Phases

Every phase: game playable offline + online, `bun run lint` + `bun test` green, screenshot
spot-check (`bun run dev` + `bun run chrome`, CDP on :9222). Branch `feature/pixi-pN-<slug>`,
finish with `bun run git:feature:finish`.

**Use the bundled PixiJS skills** (`.claude/skills/pixijs*` — the official collection,
github.com/pixijs/pixijs-skills) before writing Pixi code in a phase: P2 → `pixijs-application` +
`pixijs-events` + `pixijs-ticker`; P3 → `pixijs-scene-container`; P4/P5 →
`pixijs-scene-particle-container`; P6 → `pixijs-scene-graphics` (GraphicsContext) +
`pixijs-scene-container`; P7 → `pixijs-scene-sprite` (TilingSprite); P8/P9 →
`pixijs-performance` (culling, cacheAsTexture). Anything not covered (e.g. RenderTexture /
`generateTexture`): WebFetch `https://pixijs.download/release/docs/llms.txt` and follow its links.

### Phase 1 — Boundary guard
New `__tests__/presentation-boundary.test.ts`: walks the import graph from `src/server/index.ts`,
`src/game/sim.ts`, and every test file; asserts `pixi.js` never reachable; asserts the set of
direct `pixi.js` importers ⊆ {`src/game/view.ts`, `src/game/renderer.ts`, `src/game/render/**`,
`src/game/engine.ts`, `src/net/client.ts`}. Makes the sim/presentation boundary a failing test
instead of a convention.

### Phase 2 — Application lifecycle & loop hygiene
Files: `view.ts`, `engine.ts:177-183`, `client.ts:159-169,201-208`.
- `app.init({..., eventFeatures: {move:false, click:false, wheel:false, globalMove:false}})` +
  `app.stage.eventMode = 'none'` — input is keyboard, UI is React; stop paying FederatedEvents
  hit-test traversal.
- Replace `app.destroy(true)` with the v8 options form (remove view, destroy children, release
  global GL resources — verify exact shape against v8.19 typings); fixes leaks across the
  Practice↔Online destroy/recreate cycle in App routing.
- Bug fix: net heartbeat clocks off `frame * (1000/60)` (`client.ts:164`) — drifts at non-60 Hz;
  accumulate `ticker.deltaMS` instead.
- Keep the explicit `MAX_FRAME_DT` clamp (Ticker `minFPS` is not a determinism clamp).
Verify: Practice→Online→Practice ×5, no GL corruption; heartbeat ≤400 ms gaps.

### Phase 3 — Mechanical split of renderer.ts (no behavior change)
`renderer.ts` (983 lines) → `src/game/render/`: `index.ts` (createRenderer, same signature),
`stars.ts`, `terrain.ts`, `infantry.ts` (lines 145–695), `entities.ts` (ships/bases/devices/beams/
bullets), `minimap.ts`, `camera-view.ts` (ease/snap/shake). Keep `src/game/renderer.ts` as a
re-export shim so engine.ts/client.ts imports are untouched. Pixel-identical screenshot diff.
Update the CLAUDE.md layout block for `render/**`.

### Phase 4 — Particles → ParticleContainer
New `render/particles-view.ts`. Sim untouched (spawn sites + `updateParticles` stay sim-owned).
- Boot texture: `renderer.generateTexture(new Graphics().circle(R,R,R).fill(0xffffff), {antialias:true})`.
- `new ParticleContainer({texture, boundsArea: new Rectangle(0,0,WORLD_WIDTH,WORLD_HEIGHT),
  dynamicProperties: {position:true, color:true, vertex:true}})` — `boundsArea` mandatory (default
  bounds empty → culled invisible).
- Pooled `Particle` structs via `addParticle`/`particleChildren` (NOT `addChild`): per frame set
  `x,y`, `scale = p.size/R`, `tint = p.color`, `alpha = p.life/p.maxLife`; truncate + `update()`.
Verify: flamethrower + mine chain identical offline/online; perf trace CPU drop.

### Phase 5 — Bullets & flame gouts join the particle path
Second `ParticleContainer`, one generated 2-frame atlas (hard disc + soft radial glow), `Texture`
frames via `Rectangle`; glow particles ordered before cores. Preserve the flame gout's *step*
color switch at age 0.5 (no lerp). New `render/bullets-view.ts`.

### Phase 6 — Ships → retained Containers + GraphicsContext banks
New `render/ships-view.ts`; id-keyed map diffed by `ship.id`.
- Hull re-derived in local space (nose at rotation 0), `container.rotation = ship.angle`; one
  shared `GraphicsContext` per team color.
- Thrust flame: 3 prebuilt `GraphicsContext`s indexed by `Math.floor(time*40)%3` (current flicker
  is already a discrete 3-frame cycle); retro plumes likewise.
- Invuln blink → `container.visible`. Health/shield bars stay immediate-mode (don't rotate).
Verify: thrust/reverse/invuln/respawn offline; 2-player online; screenshot diff.

### Phase 7 — Starfield → TilingSprite parallax bands
Bucket the 150 seeded stars into 3-4 depth bands (band depth = bucket mean; `createStars` + rng
stream stay); bake each band into a `RenderTexture` at the renderer's resolution (a 1x bake
loses the sub-pixel dots — learned the hard way); one `TilingSprite` per band,
`tilePosition.set(-camera.x*depth, -camera.y*depth)` per frame. `render/stars.ts`.
Verify: fast flight, no wrap seams, parallax feel unchanged.

### Phase 8 — Terrain chunking + minimap cacheAsTexture + culling
Files: `render/terrain.ts`, `render/minimap.ts`, `render/index.ts`, `view.ts`.
- Split terrain into ~8 column-band `Graphics` chunks (1350 px); on `terrainVersion` bump redraw
  only intersecting chunks (fallback: redraw all chunks — culling still wins). Blocks spanning
  bands draw into each (opaque overlap harmless).
- `extensions.add(CullerPlugin)` before `app.init`; `chunk.cullable = true` + `cullArea` band
  rect; `worldLayer` → render group; ship containers cullable.
- **No** whole-terrain cacheAsTexture (10800×6750 exceeds GPU limits). Minimap terrain (≈206×131)
  IS the target: `cacheAsTexture(true)` + `updateCacheTexture()` on version bump; release on destroy.
- Manual CPU cull in the `deviceGfx` loop: skip entities outside camera ± margin (Pixi can't cull
  inside one Graphics) — removes most infantry draw cost when the fight is elsewhere.
Verify: debris-storm frame times; minimap updates on carve; draw-call count over empty sky.

### Phase 9 — (optional, profile-gated) infantry draw batching
Only if post-Phase-8 trace shows `drawInfantry` > ~3 ms/frame: quantize *cyclic* sub-animations
(walk gait, run scissor) into K-frame `GraphicsContext` banks; transient poses stay procedural.
Acceptable to never do.

### Phase 0 — Docs sync
README.md still describes the asteroids-and-waves game — rewrite for the current game (infantry
war, online multiplayer, destructible voxel terrain, full controls + scripts). Fix the CLAUDE.md
layout (lists a long-gone `asteroids.ts`; missing `sim/voxel/devices/net/server/...`), note the
sim/presentation boundary rule, and link PLAN.md. CLAUDE.md gets a small touch-up again in
Phase 3 when `src/game/render/**` exists.

## Wheels retired

| Hand-rolled today | Pixi v8 replacement | Phase |
|---|---|---|
| Per-particle `Graphics.circle`/frame | `ParticleContainer` + pooled `Particle` | 4 |
| Bullet glow + flame-gout circle stacks | second `ParticleContainer` + generated atlas | 5 |
| Per-frame world-space ship trig + flame frames | retained `Container`, shared `GraphicsContext` | 6 |
| 150-circle modulo parallax loop | `RenderTexture` bands + `TilingSprite.tilePosition` | 7 |
| Full-terrain redraw per carve; zero culling | chunked `Graphics` + `CullerPlugin`, render group | 8 |
| Minimap manual version cache | `cacheAsTexture` + `updateCacheTexture` | 8 |
| Silent FederatedEvents hit-testing | `eventFeatures` off + `eventMode='none'` | 2 |
| Synthetic 60 Hz net-heartbeat clock | `ticker.deltaMS` accumulation | 2 |
