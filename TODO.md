# TODO

## Server / persistence (optional, future — a design change)

- [ ] **Persist carved terrain across server restarts.**
  Today rooms are (re)created fresh *by design* — players reconnect into a new arena, and the
  persisted world snapshot deliberately omits the server-internal voxel grid (`mat` / `pinned` /
  `bodies`, which live in the `createSim` closure, not on `world`). To actually rehydrate terrain
  you'd serialize that grid (e.g. `mat` as base64 + `pinned` index arrays + `bodies`) into the
  snapshot and rebuild it in `createRoom`, then wire `store.loadState` into `createRoomState`.
  Only worth doing if we decide rooms should survive restarts — it reverses the current
  "reconnect fresh" tradeoff.

  _Note: the dead-code / misleading-"recovery" half of this was already resolved — `store.ts`
  now honestly documents that the snapshot is write-only and terrain is not rehydrated._
