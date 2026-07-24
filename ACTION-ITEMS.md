# biome — Action items

Everything currently open across the engine and the renderer.

**This is a list, not a plan.** Items are grouped by area purely so the list is
navigable; the grouping and the order within it carry no priority, sequence, or
recommendation. The `⚠` markers are inherited from the source docs, where they
mean "this is a defect or a trap" rather than "this is urgent".

Each item keeps the identifier it has in the source docs, so cross-references in
code comments and git history keep resolving. Fuller reasoning, evidence, and
measurements for the engine items are in [`DOCS.md`](DOCS.md) §1; for the
renderer items, in [`src/renderer/DOCS-RENDERER.md`](src/renderer/DOCS-RENDERER.md)
§1. ⚠ **This file and those two §1 sections must be updated together** — closing
an item, or opening one, means editing both.

**Not on this list:** items that were considered and **settled** (a decision not
to build something, taken deliberately), and items already **closed**. Those are
recorded in `DOCS.md` §1.3 / §1.6 and `src/renderer/DOCS-RENDERER.md` §1.5 so
they are not re-opened by accident.

---

## Engine — known defects

- **⚠ A31 — The selection sandbox has never demonstrated its claim.** An unmet
  acceptance criterion. Over seven seeds the trait rose in 3 and fell in 4 (mean
  change −0.0002), with the selection differential negative in five and its sign
  uncorrelated with the trait's direction. Cause: the differential compares
  breeders against _all_ adults, and 71% of adults are breeders in that world.
  Tightening the breeding gate makes it visible but drives the population
  extinct. Closing it means building a world that demonstrates selection, not
  tuning the existing one.

## Engine — implemented, tested, and near-inert

- **⚠ A34 — Patrolling / site fidelity.** Ramped over six range radii
  (`patrolSpanFactor: 6`) so it never fires during normal foraging, because
  patrol competes with wandering and wandering is how an animal finds its next
  meal. The named lever is giving patrol a _reason_ — food worth returning to, or
  a den — rather than making it compete with foraging on equal terms.

- **A32 — Juvenile defense fires about once in 12 000 ticks.** The geometry it
  needs (an adult with a living juvenile of its own, that juvenile nearer the
  predator than the parent and inside `defendRange`) almost never arises. The
  named lever is relaxing "nearer the predator than I am" to "near enough to
  interpose".

## Engine — behaviour and modelling

- **A18 — Prey have no spatial refuge from predators.** Cover slows both
  equally. Part of why the founding counts are a knife edge. The static `thicket`
  terrain (A51) is a first refuge: it blocks line of sight and predators will not
  follow prey into it.

- **A51 — Dynamic shrub layer (large bush / small tree).** A new *dynamic* plant
  layer — deliberately **not** a terrain code, because terrain is static and a
  shrub grows, is grazed, and matures. It mirrors the vegetation architecture: a
  static seeded *capacity* placed in clumps, plus dynamic *state* (biomass + a
  woody floor) that serializes; its obstacle/cover properties fold into the
  existing `speedModifierAt` / `blocksSightAt` / `isShelteredAt` chokepoints, so
  no system learns shrubs exist to be slowed, hidden, or sheltered by one. Six
  features: (1) blocks line of sight once **mature**; (2) passable but extremely
  slowing; (3) weather shelter; (4) edible but not preferred — and once mature,
  eating strips only the leaves down to a **woody floor**, so the trunk/branches
  and the cover they give remain; (5) grows in clumps, some already mature at
  world init; (6) denser than rock. Maturity (`woodyFloor > 0`) is the stable
  flag driving sight/slow/shelter, so a grazed shrub still blocks and shelters,
  while leaf biomass (`biomass − woodyFloor`) is the edible, regrowing part.
  Suggested build order, gated behind `shrub.enabled` (default off) and measured
  via a config override so the suite stays green each step: **(1)** `ShrubGrid` +
  `ShrubSystem` + the three chokepoints — measure whether dense sight-blocking
  cover finally makes line of sight bite and eases the outer-ring/corner
  gathering; **(2)** floored, non-preferred feeding; **(3)** protocol + renderer
  layer (RLE + revision-gated deltas, a glyph, protocol-version bump, fixtures);
  **(4)** persistence (serialize biomass + woody floor, save-version bump); **(5)**
  tune density / slow factor / food value and enable. The **static `thicket`
  terrain type is the shipped MVP of this** (blocks sight, shelters,
  passable-but-avoided, placed like rock); the dynamic layer is the
  growth/grazing/maturity superset. Relates to A18 (spatial refuge) and A3 (the
  reserved `plant` entity kind — this uses a field, not entities).

- **A35 — Territory is a predator-only phenomenon** at ~9 individuals. Grazers
  get a home range but no site fidelity and no claims.

- **A37 — Disease does not cross species.** The two species carry it
  independently; a shared or zoonotic pathogen is unbuilt.

- **A33 — Mobbing is not implemented.** Cooperative defense is passive
  (vigilance) plus a parent interposing; prey collectively attacking a predator
  does not exist.

- **A12 — Orphan mercy.** An orphaned unweaned juvenile is weaned early rather
  than facing a real dependency crisis. Left in place deliberately, so that
  removing it is not bundled with any other change to juvenile survival.

- **A47 — Animals do not seek other animals' burrows.** A burrow shelters
  whoever stands on it, but only trails exert a pull. Giving burrows one means
  teaching the perception hot loop about features.

- **A24 — No per-cell microclimate.** Temperature is global and cover is the only
  spatial modifier. Needs terrain elevation, which does not exist. This is also
  why migration has no "warmer south" to steer toward.

- **A3 — Individual tree/shrub entities.** Vegetation is a cell-level biomass
  field. The `plant` entity kind is reserved for point vegetation if a use for it
  arrives.

## Engine — schema and configuration

- **A49 — "Activity pattern" and "habitat preference" are not schema blocks.**
  There is no diurnal cycle for a pattern to exist in, and habitat preference is
  expressed through `migration.tracksForage` plus the comfort band.

- **B1 — `createDemoSimulation.js` was never renamed to `createEcosystem.js`.**
  Cosmetic; the rename is churn across server, scripts, and tests.

## Engine — observability

- **A28 — Bottleneck detection is left to the caller.** The bounded history
  carries population per species over time, but nothing computes a minimum or
  flags a crash. Closing it means choosing what counts as a crash.

- **A43 — Population fragmentation is enabled, not asserted.** Herd labels split
  by hop count and separate forage patches pull herds apart, but no test claims a
  fragmentation outcome.

- **A22 — Tombstones are bounded at 256**, so ancestry cannot be walked further
  back than that. Only bites a query that walks ancestry; lineage _depth_ is
  carried on the entity as `generation`.

- **A36 — The territorial claim layer is not projected to the renderer.** The
  home-range ring is drawn from inspection, for the selected animal only. Blocks
  renderer item P1.

- **A5 — No renderer debug overlay of perceived cells.**

- **A7 — No action glyph tint.** The current action is textual in the inspector
  only; `action` already rides in the bulk snapshot.

## Engine — performance and payload

- **The mature performance target is not reached.** ~25 000 behaviourally complex
  animals inside a one-second tick. Linear extrapolation from large-5k puts ~25k
  entities at ~220 ms/tick, but that assumes the world grows with the population
  and has not been run. The next gain is structural — visiting fewer cells per
  animal, or staggering perception — not another cleanup pass.

- **C3 — Per-tick event volume.** One `entity.moved` per animal per tick, plus
  one `entity.fed` per eater and one `entity.provisioned` per nursing juvenile in
  range. Bounded by the buffer and routine-filtered in the renderer, but it
  competes for the retention window — and events are **42% of a 1.78 MiB demo
  save**, more than the entire entity array.

- **B5 — `utilityBreakdown` persists on the entity.** It is recomputed every tick
  and read by nothing in the simulation. Measured at **3.3% of a save**;
  removing it costs a `SAVE_FORMAT_VERSION` bump and a fixture regeneration.

---

## Renderer — decisions not yet taken

- **Phase D — what "step backward" means.** The engine only moves forward; there
  is no reverse command and `validateCommand` requires `ticks >= 1`. Three
  recorded options: **D1** don't offer it (label the control `Advance N`);
  **D2** a renderer-side bounded review buffer (~300 ticks) scrubbed read-only
  behind a `REVIEW t1234` badge, needing no protocol or engine change; **D3** a
  true engine rewind via a ring of `captureSimulationState` saves, which needs a
  new command, a protocol bump, and a forced full-snapshot resync — and which
  belongs in the engine plan rather than the renderer's. `DOCS-RENDERER.md` §1.2
  records D2 as its own recommendation. Whichever is chosen, a past tick must
  never be displayed as though it were the present.

## Renderer — verification and tooling

- **⚠ P9 — The inspector popover has never been driven in a browser.** Its pure
  logic is tested and its wiring was reviewed (which caught two real bugs), but
  positioning, edge-flipping, dragging, and the `<details>` toggle path stand on
  review rather than evidence. The clicks that would settle it: select a cell
  near the right edge (flip), drag the header (pin), press dock then float,
  expand Genome and reload (persistence).

- **P6 / E3 — Fixture mode has no inspection or metrics data at all**, so the
  panel shows ground and bulk fields but no sections offline. Closing it means
  adding an `entity.inspection` fixture to
  `scripts/generateRendererFixtures.js`.

- **E4 — Keep `README-RENDERER.md`, `DOCS-RENDERER.md`, `PLAN-RENDERER.md`, and
  `HANDOFF-RENDERER.md` current _with_ each phase** rather than after it. An
  ongoing discipline rather than a discrete task.

## Renderer — known limitations

- **P1 — Per-cell territory ownership is not shown.** Blocked on engine item A36;
  the protocol carries a claim only via a selected animal's
  `territory.standingOn`.

- **P5 — The renderer cannot show a tick it never received, and cannot move the
  engine backward at all.** Resolved by whatever Phase D decides; currently
  stated in the UI rather than worked around.

- **⚠ P12 — A coalesced delta is ~95% event payload**, and a step long enough to
  overrun the bounded outbox drops events: ~77 000 emitted at 500 ticks, 8 810
  delivered. World state stays exact; the narration does not. The named fix is
  for a long step to send _no_ events rather than a truncated set — a protocol
  question, not a renderer one.

- **P13 — A large advance blocks the host's event loop for its whole duration**
  (~1.4 ms/tick), so 10 000 ticks is ~14 s unresponsive. UI defaults stay under a
  second; a genuinely long run belongs in `npm run headless`.

- **P11 — The inspection poll runs at a fixed 2 s** whether the simulation is
  paused or running at 8×. The run state is now known, so backing it off while
  paused is a two-line change; left undone because re-fetching identical data is
  cheap.

- **P8 — The whole world is streamed.** Bounded region subscription awaits
  region-scoped deltas; `requestSnapshot(bounds)` is isolated for when they
  exist.
