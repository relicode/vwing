# CLAUDE.md

Guidance for working in this repo.

## What this is

An **XPilot-style 2D space dogfighter** — Newtonian flight (thrust, rotation, inertia) under a
constant global **gravity**, in an arena larger than the screen with a camera that follows the ship.
PixiJS renders the game in a `<canvas>`; **React + MUI** provide the surrounding chrome (title, HUD,
game-over). There is **no Astro** — only React + MUI for the wrappers.

PvP is the end goal; the current scope is **single-player** (the ship vs. drifting asteroids). Ships
are modeled as data in a list so AI bots / additional players slot in later.

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
  app/                # React + MUI shell
    app.tsx           # stage frame + phase routing
    theme.ts          # MUI dark-neon theme (pure factory)
    use-engine.ts     # boot engine + subscribe to status (useSyncExternalStore)
    game-canvas.tsx   # mounts engine.canvas
    hud.tsx, title-screen.tsx, game-over-screen.tsx, overlay.tsx
  game/               # framework-free simulation + PixiJS engine
    constants.ts      # enums + all tunables (single balancing surface)
    types.ts          # shared types (World, Ship, Bullet, Asteroid, EngineStatus)
    math.ts rng.ts collision.ts input.ts
    ship.ts           # Newtonian flight: turn, thrust, gravity, drag, wall test
    bullets.ts        # straight shots inheriting ship velocity
    asteroids.ts      # drifting / wall-bouncing rocks + split mechanic + wave spawner
    camera.ts         # follow camera origin, clamped to the world
    particles.ts      # explosion debris
    renderer.ts       # draws the World with PixiJS (camera-offset world layer + parallax stars)
    engine.ts         # Pixi Application + game loop + state machine + status pub/sub
__tests__/            # bun:test specs for the pure logic
```

## Architecture notes

- **Separation:** `game/` holds no React. `engine.createEngine()` returns `{ canvas, getStatus,
  subscribe, start, destroy }`; React subscribes for HUD state and calls `start()` to (re)begin.
- **Phases:** `GamePhase` (TITLE / PLAYING / GAME_OVER). The engine sims flight only while PLAYING;
  in TITLE/GAME_OVER it just drifts rocks + fades debris as ambiance.
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
