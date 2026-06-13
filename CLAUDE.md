# CLAUDE.md

Guidance for working in this repo.

## What this is

An **XPilot-style 2D dogfighter turned indirect-minion war game** (Settlers/Populous lineage) —
Newtonian flight (thrust, rotation, inertia) under a constant global **gravity**, over a large
destructible voxel-terrain arena with a camera that follows the ship. PixiJS renders the game in a
`<canvas>`; **React + MUI** provide the surrounding chrome (title, HUD, game-over/victory).

**Infantry is the heart of the game**: every ship carries a troop bay loaded at its home barracks,
paradrops autonomous troopers (riflemen + one-in-five specialists carrying a man-portable version
of the squad's heavy weapon kind), rescues its own and *recruits* enemy troopers by slow contact —
and wins by capturing the enemy barracks with troops (a captured base cuts respawns; dying then is
elimination → VICTORY). The campaign pits the player vs. an AI bot that plays the same game
(REARM / ASSAULT / DEFEND goal layer); online DEATHMATCH stays a baseless frag-fest. Controls:
flight on the arrow keys, **D** fires the primary, **S** the secondary, **A** deploys troops.

## Stack & toolchain

- **Runtime / bundler:** Bun (`>=1.3.13`). Dev server and bundler are Bun-native — no Vite/webpack.
- **Rendering:** PixiJS v8 (WebGL 2D).
- **Shell:** React 19 + MUI v9 (`@mui/material`) + Emotion.
- **Lint/format:** Biome only. **Type-check:** `tsc --noEmit`. (No ESLint, no Prettier.)
- **Import alias:** `$/*` → `src/*` (see `tsconfig.json` `paths`; Biome/Bun honor it).
- **Git:** git-flow (`main` + `develop`; `feature/` `bugfix/` `release/` `hotfix/` prefixes).
  Finish a feature with `bun run git:feature:finish`.

Commands: `bun run dev`, `bun run build`, `bun run preview`, `bun test`, `bun run lint`,
`bun run format`. Always finish a change with `bun run lint` and `bun test` green.

**Build / PWA** — `bun run build` runs `scripts/build.ts`: the app bundle, then the PWA layer —
procedurally baked icons + og:image (`scripts/pwa/artwork.ts`, no native image deps),
`manifest.webmanifest`, head metadata (PWA links, Open Graph/Twitter, VideoGame JSON-LD), and a
precaching service worker (`src/pwa/sw.ts`, compiled to `dist/sw.js` with the precache list
injected via `define`). Absolute-URL fields resolve against `--site <url>` > `$VWING_SITE_URL` >
the default `https://mccall.kapsi.fi/vwing/`; for local PWA QA build with
`--site http://localhost:3111/` and `bun run preview`. The worker registers in production only
(`src/pwa/register-sw.ts`, NODE_ENV-gated) — the dev server never serves one.

**Dev ports** are pinned to the `31xx` block so this repo's runner never collides with a
sibling dev server (e.g. `mapifest-builder-astro` on `43xx`) and the browser keeps their
PWA/localStorage origins separate: `dev` (web client) → **3110** (`$VWING_WEB_PORT`), `preview`
→ **3111** (`$PORT`), game `server` → **8787** (`$PORT`). `dev:all` labels the two processes
`vwing:web` / `vwing:srv`.

**Browser inspect** — `bun run chrome` opens the dev URL in **headless** Chrome by default, exposing
a CDP endpoint on `localhost:9222` (`$CHROME_PORT`) for DevTools, the chrome-devtools MCP
(`--browser-url http://localhost:9222`), or scripted CDP. `bun run chrome:visual` opens a real
window (CDP on `9223`, `$CHROME_VISUAL_PORT`) for manual inspection. Each uses an isolated
`--user-data-dir`; override the binary with `$CHROME_BIN`. Start the dev server first.

## Layout

```
src/
  index.html          # entry — loads main.tsx
  main.tsx            # React root (no StrictMode: avoids double WebGL context in dev)
  app/                # React + MUI shell — component files are PascalCase.tsx;
                      # hooks (use-engine, use-net) and theme.ts stay lowercase
    App.tsx           # stage frame + phase routing (title / practice / lobby / online)
    theme.ts          # MUI dark-neon theme (pure factory)
    use-engine.ts use-net.ts  # boot engine / net client + subscribe (useSyncExternalStore)
    GameCanvas.tsx    # mounts engine.canvas
    Hud.tsx OnlineHud.tsx TitleScreen.tsx GameOverScreen.tsx Overlay.tsx
    LobbyScreen.tsx PracticeGame.tsx OnlineGame.tsx
  game/               # framework-free simulation + PixiJS presentation
    constants.ts      # enums + all tunables (single balancing surface)
    types.ts          # shared types (World, Ship, Bullet, Device, Base, EngineStatus)
    math.ts rng.ts collision.ts input.ts
    sim.ts            # the authoritative step: combatants, scoring, respawns, victory events
    ship.ts           # Newtonian flight: turn, thrust, retro-brake, gravity, drag, land/crash
    bullets.ts beams.ts weapons.ts  # primary shots, rail beams, the 10 random secondaries
    devices.ts        # deployed world entities: troopers (state machine + stateOf), missiles,
                      # mines, grenades, flak, gravity wells
    troops.ts bases.ts  # troop bay, rescue/recruit; barracks, garrison-as-HP, capture
    bot.ts            # the AI combatant: REARM / ASSAULT / DEFEND goals driving an Input
    voxel.ts terrain.ts terrain-map.ts water.ts  # destructible voxel grid → greedy-meshed
                      # blocks; seeded biome worldgen; carving + falling debris; water/pooling
    camera.ts         # follow camera origin, clamped to the world
    particles.ts      # explosion/exhaust debris (sim-owned data; the renderer only draws it)
    renderer.ts       # re-export shim → render/ (keeps engine/client imports stable)
    render/           # draws the World with PixiJS — index.ts (createRenderer) wires stars,
                      # terrain, infantry (procedural Cannon-Fodder art), entities, minimap,
                      # camera-view — migrating to v8 built-ins, see PLAN.md
    view.ts           # PixiJS Application boot (shared by the engine and the net client)
    engine.ts         # game loop + phase machine + status pub/sub (offline campaign vs. bot)
  pwa/                # sw.ts (precache service worker, bundled standalone by the build) +
                      # register-sw.ts (prod-only registration from main.tsx)
  net/                # protocol.ts (JSON wire format) + client.ts (snapshot-drawing online client)
  server/             # authoritative Bun server: index.ts (HTTP + WS), room.ts, store.ts (Redis
                      # state with in-memory fallback)
scripts/              # server.ts (game-server entry), preview.ts, build.ts (bundle + PWA layer)
  pwa/                # build-time generators: identity.ts (site base + naming), manifest.ts,
                      # head.ts (OG/Twitter/JSON-LD), artwork.ts + png.ts (SDF icon/og bake)
__tests__/            # bun:test specs for the pure logic (sim + build-time PWA generators —
                      # never imports pixi.js)
```

## Architecture notes

- **Separation:** `game/` holds no React. `engine.createEngine()` returns `{ canvas, getStatus,
  subscribe, start, destroy }`; React subscribes for HUD state and calls `start()` to (re)begin.
- **Sim/presentation boundary:** the sim modules never import `pixi.js` — only `view.ts` and the
  renderer (presentation) do. The same sim steps headlessly on the server and under `bun test`.
  `PLAN.md` tracks the phased migration of the presentation layer to Pixi v8 built-ins.
- **Phases:** `GamePhase` (TITLE / PLAYING / GAME_OVER / VICTORY). The engine sims flight only
  while PLAYING; in TITLE/GAME_OVER it just fades debris + beams as ambiance (terrain stays put).
- **Coordinates:** the world is `WORLD_WIDTH × WORLD_HEIGHT` (larger than the `VIEW_WIDTH ×
  VIEW_HEIGHT` viewport). `camera.ts` returns the viewport's top-left in world space, clamped to the
  walls; the renderer offsets a world `Container` by `-camera`. Heading `angle` has forward =
  `(cos, sin)`; gravity is `+y`.
- **Determinism:** all randomness flows through a seeded `Rng` (`rng.ts`) — never `Math.random()`
  inside the sim, so logic stays testable. The engine seeds a fresh stream per run.

## Conventions

Follow the `reviewer-b` agent in `.claude/agents/reviewer-b.md` (run it after writing TS):
arrow functions and `const`, `type` over `interface`, function closures over classes, enums for
discriminants/keys (`PascalCase` type, `SCREAMING_SNAKE_CASE` members equal to their string value),
`undefined` over `null`, named default exports for components, top-down declaration order, and no
module-level mutable state (engine state lives in the `createEngine` closure).
