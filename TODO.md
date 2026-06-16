# TODO

## Open

### Substrate redesign (`StructureType`) — needs a design decision

Enrich the structure axis beyond today's `{ EARTH, METAL }`. (`Surface.WATER` has already been
dropped — water is the per-cell fluid grid now.) Proposed substrates and the open questions:

- **GROUND** — destructible (today's EARTH). *Rename EARTH→GROUND is optional cosmetic churn;
  probably skip unless we want the name.*
- **METAL** — indestructible + non-falling (today's bedrock anchors).
- **STATIC** — **destructible but never falls**. Formalizes the floating-island cores. **Decision:**
  fully replace the runtime `pinned` set (simpler, loses dynamic "re-pin to largest surviving piece"
  on damage) or **coexist** (STATIC = authored anchors, `pinned` = runtime severance)? *Lean coexist.*
- **WATER** — a solid that **floats on the fluid** (ice floe). **Decision:** model as a dynamic
  debris-style body that eases toward the fluid surface under it and falls when the surface drops away
  (keeps the greedy-meshed static grid untouched), destructible like GROUND. New physics — own branch,
  with tests, after the semantics are confirmed.

Sequencing: the rename is trivial; STATIC is a contained `voxel.ts` change; WATER is the meaty one
and should be its own branch.

## Recently shipped (see git history / release notes)

- **Per-cell water fluid** (`water-cell.ts` `FluidGrid`): falls, levels, pours off ledges, fills
  carved pockets; `world.water` is a derived rect view. Watertight + static barracks; pools fall with
  the terrain chunk under them. Water cannon deposits-and-spreads (no wall cresting).
- **Infantry:** non-heavy troopers step over 1-vexel ledges (specialists don't); the base roof is a
  storming side (north) — capture sums three sides (west / north / east), ≤1 man each.
- **Ship:** steering degrades with hull damage; hull repairs only while docked at a base you hold.
- **Render:** the bazooka muzzle is a T-bar (was a round "lollipop").
