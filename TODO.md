# TODO

## Server / persistence

- [x] **Persist carved terrain across server restarts.** _(done)_
  The persisted state document (`room.persisted()`) now carries the room's generator **seed**
  plus a `terrain` snapshot of the server-internal voxel grid — `mat` (base64), the `pinned`
  floating-island components, in-flight `bodies` debris, and the `regrow` clock (see
  `snapshotVoxel` / `restoreVoxel` in `voxel.ts`, exposed as `sim.serializeTerrain()` /
  `sim.restoreTerrain()`). Opening a game name whose room died with a server restart (either
  intent) resurrects it via `store.loadState` → `parseRestore` → `createRoom(name, restore)`:
  the seed reproduces the authored arena deterministically and the snapshot overlays the
  craters, debris, pins, and poured water. The terrain blob is re-encoded only when
  `world.terrainVersion` changes, and a snapshot that doesn't fit the grid is ignored (the room
  starts pristine rather than corrupted). Recovery works for as long as the state lives in the
  store (`STATE_TTL`, currently an hour past the last write); player seats/scores are not
  restored — only the arena.
