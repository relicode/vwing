# V-Wing

An [XPilot](https://simple.wikipedia.org/wiki/XPilot)-style 2D gravity dogfighter turned
**indirect-minion war game** (Settlers/Populous lineage): Newtonian flight — thrust, rotation,
inertia — under constant gravity, over a large **destructible voxel-terrain** arena of grasslands,
rock, caves, ice, and seas.

**Infantry is the heart of the game.** Your ship carries a troop bay loaded at your home barracks.
Paradrop autonomous troopers (riflemen, plus one-in-five specialists shouldering a man-portable
version of the squad's heavy weapon), rescue your own from drowning and recruit the enemy's by slow
contact — and win by capturing the enemy barracks: a captured base cuts respawns, so dying then is
elimination. The offline campaign pits you against an AI bot playing the same game (REARM / ASSAULT
/ DEFEND goals); **online multiplayer** is a server-authoritative deathmatch over WebSockets.

Built with [PixiJS](https://pixijs.com) (WebGL) for the game canvas and **React + MUI** for the
shell (title, lobby, HUD, game-over). Bundled and served by [Bun](https://bun.sh); linted by
[Biome](https://biomejs.dev) and type-checked by `tsc`.

## Quick start

```sh
bun install
bun run dev      # web client on :3110 — practice vs. the bot needs no server
bun run dev:all  # web client + game server (:8787) for online play
```

| Action | Keys |
| ------ | ---- |
| Rotate | `←` `→` / `A` `D` |
| Thrust | `↑` / `W` |
| Retro-brake | `↓` / `S` |
| Fire | `Space` / `J` / `Z` |
| Secondary weapon | `K` / `Left Shift` |
| Deploy troops | `X` / `L` |

Each life rolls a random secondary (scattergun, water cannon, flamethrower, seeker, rail, grenades,
mines, flak, EMP, singularity) off a recharging energy bar. Terrain carves under fire: craters,
falling debris, water that pools into basins, grass that burns and regrows. Land on your barracks
pad to load troopers; touch a swimmer to rescue him. Best campaign score is saved to
`localStorage`.

## Scripts

| Script | What it does |
| ------ | ------------ |
| `bun run dev` | Dev server for `src/index.html` with hot reload (`:3110`) |
| `bun run server` | Authoritative game server (Bun WebSocket, `:8787`; Redis state if available, in-memory fallback) |
| `bun run dev:all` | Both of the above, labelled `vwing:web` / `vwing:srv` |
| `bun run build` | Production bundle into `dist/` |
| `bun run preview` | Serve the built `dist/` (`:3111`; run `build` first) |
| `bun test` | Unit tests for the pure simulation logic |
| `bun run lint` | `biome check` + `tsc --noEmit` (concurrent) |
| `bun run format` | `biome check --write` (format + lint fixes + import sort) |
| `bun run chrome` | Headless Chrome on the dev URL, CDP on `:9222` (visual QA) |
| `bun run git:feature:finish` | `git flow feature finish --no-ff` |

This repo uses **git-flow** (`main` + `develop`, standard `feature/` `release/` `hotfix/` prefixes).

## How it works

- **`src/game/`** — the simulation: pure, framework-free TypeScript. Newtonian flight (`ship`),
  voxel terrain with carving/debris/water (`voxel`, `terrain-map`, `water`), troopers and their
  state machine (`devices`, `troops`), barracks and capture (`bases`), the bot's goal layer
  (`bot`), weapons/bullets/beams, and a seeded RNG so every run is deterministic and testable.
  The same sim steps headlessly on the server — nothing in it touches the DOM or PixiJS.
- **`src/game/renderer.ts` + `view.ts`** — the PixiJS presentation: camera-offset world layer,
  parallax stars, procedural vector art for ships and the Cannon-Fodder troopers, minimap.
- **`src/net/` + `src/server/`** — the JSON WebSocket protocol, the thin snapshot-drawing client,
  and the authoritative Bun server (rooms, lobby, Redis-or-memory state).
- **`src/app/`** — the React + MUI shell: boots the engine or net client, mounts its canvas, and
  renders HUD and menus on top.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions, and [`PLAN.md`](./PLAN.md) for
the in-flight migration of the presentation layer to PixiJS v8 built-ins.
