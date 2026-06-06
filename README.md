# V-Wing

An [XPilot](https://simple.wikipedia.org/wiki/XPilot)-style 2D space dogfighter: Newtonian flight
with thrust, inertia, and **gravity**. Fly a larger-than-screen arena, fight the downward pull, and
blast drifting asteroids. **PvP is the goal** — these first steps are single-player (you vs. the
rocks); the ship model is already a list, so bots and other players drop in later.

Built with [PixiJS](https://pixijs.com) (WebGL) for the game canvas and **React + MUI** for the
shell (title screen, HUD, game-over menu). Bundled and served by [Bun](https://bun.sh); linted by
[Biome](https://biomejs.dev) and type-checked by `tsc`.

## Quick start

```sh
bun install
bun run dev      # Bun dev server + hot reload — open the printed URL
```

| Action | Keys             |
| ------ | ---------------- |
| Rotate | `←` `→` / `A` `D` |
| Thrust | `↑` / `W`        |
| Fire   | `Space` / `J`    |
| Start  | Click **Launch** (or press `Enter`/`Space` on the focused button) |

Thrust to fight gravity, don't drift into the walls, and shoot the rocks — large rocks break into
smaller, faster ones. Clear a wave to spawn a bigger one. Best score is saved to `localStorage`.

## Scripts

| Script                | What it does                                              |
| --------------------- | -------------------------------------------------------- |
| `bun run dev`         | Dev server for `src/index.html` with hot reload          |
| `bun run build`       | Production bundle into `dist/`                            |
| `bun run preview`     | Serve the built `dist/` (run `build` first)              |
| `bun test`            | Unit tests for the pure simulation logic                 |
| `bun run lint`        | `biome check` + `tsc --noEmit` (concurrent)              |
| `bun run format`      | `biome check --write` (format + lint fixes + import sort) |
| `bun run git:feature:finish` | `git flow feature finish --no-ff`                 |

This repo uses **git-flow** (`main` + `develop`, standard `feature/` `release/` `hotfix/` prefixes).

## How it works

- **`src/game/`** — the simulation. Pure, framework-free TypeScript: the ship flight model
  (`ship`), gravity + integration, bullets, drifting/splitting `asteroids`, a follow `camera`,
  particles, a seeded RNG, and the PixiJS `engine` + `renderer`. The engine runs the loop and
  exposes a small status snapshot (score / lives / wave / phase) over a subscribe API.
- **`src/app/`** — the React + MUI shell. It boots the engine, mounts its canvas, and renders the
  HUD and menus on top, driving phase transitions (title → playing → game-over).

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions.
