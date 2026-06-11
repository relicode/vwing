# Multiplayer overhaul — living plan

Make online play durable, legible, and self-healing: **Redis is the source of state** (a server
restart or room disposal resurrects the FULL game), every player gets a **distinct color**, and
connection trouble becomes **visible and self-healing** — with a logging compromise that serves
the developer without drowning them. No auth: the pilot name IS the identity, scoped to a room.

**Resume protocol:** phases run one-by-one, each on its own git-flow feature branch, finished
(merged to `develop`) before the next starts. Tick the checkbox + add the merge hash when a phase
lands. If a session dies mid-phase, the feature branch holds the WIP.

## Status

- [ ] Phase 1 — Online state resurrection — branch `feature/online-state-resurrection`
- [ ] Phase 2 — Per-player colors — branch `feature/online-player-colors`
- [ ] Phase 3 — Reconnect + kill feed + logging — branch `feature/online-reconnect-ux`

## Settled decisions

- **Transport stays WebSocket; store stays Redis.** BullMQ was considered and rejected (a job
  queue is the wrong shape for a 30 Hz authoritative loop — nothing here is a job), as was SSE
  (unidirectional; the input stream needs the bidirectional socket we already have). Redis's role
  is durability + the TTL'd lobby, not transport: the hot sim lives in server memory, Redis holds
  the truth a restart rebuilds from. (`bun:sqlite` noted as the simpler-ops alternative if the
  Redis dependency ever chafes — the store interface already abstracts it.)
- **Identity without auth:** the pilot name, normalized by `pilotNameKey` (NFKC + casefold, the
  same fold as `gameNameKey`). One mechanism — the **bench** — serves both a disconnect blip and
  a server restart: a closed socket benches the seat (ship + score + deaths + respawn clock;
  troopers keep fighting — this is the minion game), a restart benches every persisted seat, and
  `join` with a benched name **reclaims** the exact seat. A live duplicate name is rejected
  (`NAME_TAKEN`). Spoofable by design within one room + TTL window — accepted, code-commented.
- **Colors are server-assigned palette slots** carried as `PlayerInfo.palette` (NOT derived from
  shipId — ids are monotonic and never reused, so any hash drifts after churn). Globally
  consistent: self also renders its slot color (every client agrees who's amber); self stays
  unmistakable via a white self-ring + minimap core + bold scoreboard row. The offline campaign
  passes no color map and stays pixel-identical by construction.
- **Persisted v2 blob** (`PERSIST_VERSION = 2`): `{v, seed, savedAt, nextId, time, water,
  devices, roster: [{id, name, score, deaths, respawnIn, palette, ship}], terrain}`. Bullets/
  beams/particles are deliberately NOT persisted (≤ 2 s cosmetic churn); bases aren't either
  (online is baseless DEATHMATCH); the rng stream position isn't (restart replay-determinism is
  a non-goal). `respawnIn` is RELATIVE seconds. Restore validates per-section/per-row and never
  throws; legacy blobs degrade to today's arena-only restore.
- **Logging compromise:** a ~40-line dependency-free `src/server/log.ts` (leveled by
  `$VWING_LOG`, `transition`/`throttle` helpers). INFO = one line per lifecycle event; WARN =
  state transitions only (store outage/recovery, degraded restore, slow tick throttled); DEBUG
  (off by default) = per-persist blob size. Nothing logs at 30 Hz. Client: one-line `[net]`
  breadcrumbs. Player UX: RECONNECTING banner over the still-mounted canvas, kill feed, respawn
  countdown, welcome-back toast, UNSTABLE chip on snapshot stall.

## Phase 1 — `feature/online-state-resurrection`

Redis becomes the durable source of truth: restart / graceful shutdown / empty-room disposal
followed by any host/join resurrects the FULL game, and a returning pilot reclaims their seat.

- `src/game/sim.ts` — `Combatant.deaths` replaces the closure-private `deathCounts` Map;
  `addCombatant(c, opts?: {respawnIn?})` registers a seat whose ship waits out a clock before
  entering `world.ships`; `removeCombatant(id, keepDevices = false)` can leave troopers fighting.
- `src/game/engine.ts` — `deaths: 0` on the two offline combatant literals.
- `src/net/protocol.ts` — `WELCOME.reclaimed: boolean`; export `pilotNameKey` (= `gameNameKey`).
- `src/game/constants.ts` — `NET_BENCH_MAX = 32`, `NET_PERSIST_MAX_DEVICES = 512`.
- `src/server/restore.ts` — NEW: `PERSIST_VERSION = 2`, `parsePersisted` with per-section
  graceful degradation (legacy/v-mismatch → arena-only; stale `savedAt` → drop roster+devices;
  finite checks + clamps; row-level drops; reports degraded sections). `RoomRestore` widens and
  moves here.
- `src/server/room.ts` — the bench (`Map<pilotKey, BenchedSeat>`, cap + evict oldest);
  `join` → `{shipId, reclaimed} | refusal (FULL | NAME_TAKEN)`; reclaim = same shipId, same ship
  object, invuln ≥ 1 s, **troops reassigned AFTER addCombatant** (refillBay ordering); `leave`
  benches with captured `respawnIn`; `players()` appends benched rows `connected: false`;
  `persisted()` emits v2; hydration order (load-bearing, comment + test-pinned):
  time → water → devices → terrain → nextId = max(persisted, roster max + 1) → bench roster.
- `src/server/index.ts` — join-refusal handling; `reclaimed` in WELCOME; disposeRoom
  **hibernates** (final `saveState` instead of `deleteState`; STATE_TTL is the single expiry
  authority); `stop()` persists live rooms first (SIGINT/SIGTERM already route here).
- Tests: full round-trip (trooper survives, seat reclaimed with score/deaths/bay un-refilled);
  attrition clock survives restore (next death waits base + deaths×growth); NFKC identity +
  NAME_TAKEN; bench semantics (troopers fight on, cap evicts oldest); hostile/corrupt blobs
  degrade without throwing; dispose-then-load round-trip on the memory store; concurrent-open
  race (rooms.get re-check).

## Phase 2 — `feature/online-player-colors`

- `src/game/constants.ts` — `PLAYER_PALETTE` (8 hexes; slots 0/1 = legacy `Color.SHIP`/`ENEMY`;
  documented FX-collision constraints; length === `NET_MAX_PLAYERS`):
  `[0x8fe3ff, 0xff6b8b, 0xffd76a, 0xb38bff, 0xc6f25a, 0xff7ae0, 0x7d8cff, 0xdde6f2]`.
- `src/net/protocol.ts` — `PlayerInfo.palette: number` (client clamps, fallback 1).
- `src/server/room.ts` + `restore.ts` — lowest free slot over live + benched; slot rides the
  bench and the persisted roster; steal the oldest benched slot only when all 8 held; validate
  on restore.
- `src/game/render/*` — `draw(world, phase, selfId, colors?: ReadonlyMap<number, number>)`;
  absent map → today's exact binary self/enemy branches (campaign untouched by construction).
  ships-view: lazy `Map<hex, GraphicsContext>` through the existing `hullContext(color)`
  (bounded 8+2, drained in `destroy()`), white self-ring on the self view only; infantry rim =
  cached `darken(hex, 0.6)`; bullets = `bullet.color ?? lighten(hex, 0.35)` online, legacy
  offline; minimap/entities thread `ownerColor`.
- `src/net/client.ts` — per-snapshot `colorMap` (players incl. benched); wreck explosions use
  the victim's slot hex; **fold `palette` into the publish() signature string** (the hand-built
  dirty-check silently drops new fields otherwise).
- `src/app/OnlineHud.tsx` — palette chip per scoreboard row.
- Tests: palette invariants (distinct, valid, no FX collisions, length); slot assignment/reuse/
  steal/persistence; out-of-range restore reassigns; boundary test green (palette lives in
  pixi-free constants). Manual `bun run chrome` QA: two tabs distinct; campaign pixel-identical.

## Phase 3 — `feature/online-reconnect-ux`

- `src/game/constants.ts` — `NET_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000]`,
  `NET_FEED_MAX = 4`, `NET_FEED_TTL = 6`, `NET_SNAPSHOT_STALL_MS = 2000`.
- `src/net/protocol.ts` — `PlayerInfo.respawnIn` (from `sim.respawnIn`, 0.1 s rounding).
- `src/net/feed.ts` — NEW pure module: `updateFeed` ("Ace downed Maverick" / "Maverick
  crashed"), names via players incl. benched, cap + TTL; `reconnectDelay(attempt)`.
- `src/net/client.ts` — `openSocket()` extraction; `NetPhase.RECONNECTING`; re-dial with
  `intent=JOIN` (the same path that resurrects a hibernated room — blips and restarts heal
  identically); NAME_TAKEN-while-reconnecting is retryable (stale-socket race), other REJECTED →
  DISCONNECTED; snapshot-stall tracking; `[net]` breadcrumbs; **fold every new NetStatus field
  into the publish() signature**.
- `src/app/OnlineGame.tsx` / `OnlineHud.tsx` — reconnect banner over the mounted canvas; kill
  feed (palette-tinted names); REINFORCEMENTS countdown; welcome-back Snackbar; UNSTABLE chip;
  greyed disconnected rows.
- `src/server/log.ts` — NEW leveled logger (`formatLine`, `createLog`, `transition`,
  `throttle`); adopt in `index.ts` (lifecycle lines, slow-tick warn, per-persist debug,
  `/api/health` rooms) and `store.ts` (closure outage flag, lost/restored transitions).
- Tests: feed phrasing/cap/TTL; reconnect schedule; respawnIn on the wire; formatLine /
  level gating / transition / throttle; store outage→recovery emits exactly one line each.
  Manual QA: kill `vwing:srv` mid-match, restart, watch auto-reclaim with score+color intact.

## Risks (carry into each phase's review)

- `PERSIST_VERSION` must be bumped whenever Ship/Device shapes change (comment on the Ship type
  points at it); per-row finite/clamp validators are the backstop.
- No-auth reclaim is spoofable within one room + TTL window — accepted, code-commented.
- Reconnect-before-close race yields NAME_TAKEN → treated as retryable through the backoff.
- `keepDevices` leaves devices whose owner has no live combatant — current sim tolerates it
  (verified); future owner-lookup code must too.
- The client `publish()` signature string silently drops un-folded NetStatus fields — explicit
  reviewer checklist item on phases 2–3.
- Blob growth: devices ride every 0.5 s write; bullets dropped + 512-device cap bound it; the
  debug persist line reports KB. SIGKILL loses ≤ one persist interval — accepted.
- Per-hex GraphicsContext caches must stay bounded and be drained in `destroy()` (Pixi v8 leaks
  GL otherwise; the Practice↔Online destroy/recreate cycle exercises this).
- A resurrected room is state-equal, not a deterministic replay continuation (rng position not
  persisted) — tests compare state at restore, never lockstep afterwards.
- Hibernation means re-hosting a name within the hour resurrects old craters/scores — the
  "resumed" log line is the signal; a future "fresh" host flag is the escape hatch.
