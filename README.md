# V-Wing

<!-- docs/og-image.png is the PWA share card baked by `bun run build` (scripts/pwa/artwork.ts);
     re-copy it from dist/ when the artwork changes. -->
[![V-Wing — Gravity Dogfighter](./docs/og-image.png)](https://mccall.kapsi.fi/vwing/)

A collision of two beloved old genres: the **2D gravity dogfighter** — its DOS-era namesake
V-Wing, [XPilot](https://simple.wikipedia.org/wiki/XPilot) — and the **god game of wilful little
people** in the Populous II / Settlers / Dungeon Keeper tradition. You get direct control of
exactly one thing: your ship. Everything that actually wins the war walks.

The flying is honest Newtonian business — thrust, rotation, inertia, a constant pull of gravity —
over a large **destructible voxel-terrain** arena of grasslands, rock, caves, ice, seas and
floating sky isles. Fire carves the world: craters, falling debris, water that pools into basins,
grass that burns in a creeping front and grows back. Each life rolls a random secondary weapon
(scattergun, water cannon, flamethrower, seeker, rail, grenades, mines, flak, EMP, singularity)
off a recharging energy bar.

**The troopers are the heart of the game, and they do not take orders.** Land on your barracks
pad and they board on their own short legs; paradrop them where you think the war is, and that is
the last instruction they accept. From there they patrol, take cover, kneel to fire, slip on ice,
and swim with more courage than skill. Most are riflemen; one in five shoulders a man-portable
version of the squad's heavy weapon. Your job is logistics and rescue — ferry them forward, fish
swimmers out before they drown, recruit the enemy's by slow, patient contact — until your infantry
storms the enemy barracks. Respawns are free but each one takes a little longer; lose every base
your side holds and the next death is the last.

The offline campaign pits you against an AI bot playing the same game you are — rearming,
assaulting and defending with a ship and wilful infantry of its own. **Online multiplayer** is a
server-authoritative deathmatch over WebSockets: no barracks, no babysitting, just the dogfight.

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

Best campaign score is saved to `localStorage`.

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
- **`src/game/render/` + `view.ts`** — the PixiJS presentation: camera-offset world layer,
  parallax stars, procedural vector art for ships and the Cannon-Fodder troopers, minimap.
- **`src/net/` + `src/server/`** — the JSON WebSocket protocol, the thin snapshot-drawing client,
  and the authoritative Bun server (rooms, lobby, Redis-or-memory state).
- **`src/app/`** — the React + MUI shell: boots the engine or net client, mounts its canvas, and
  renders HUD and menus on top.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions, and [`PLAN.md`](./PLAN.md) for
the record of the presentation layer's migration to PixiJS v8 built-ins.
