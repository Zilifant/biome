# biome — Ecosystem Simulation Development Plan

This is the authoritative, linear development plan for growing the existing
biome foundation (deterministic headless engine + versioned protocol +
Dracula ASCII renderer) into an animal-centered artificial-life ecosystem.

**This document is executed one numbered step at a time.** Read the whole
file, then do only the next incomplete step (see _Future execution
protocol_ at the end). It does **not** re-plan the completed foundation or
renderer — those are treated as authoritative except where this audit flags
remediation.

---

## 1. Repository audit (as inspected)

Inspected: `package.json`, `README.md`, `src/renderer/README.md`, the full
`src/simulation`, `src/protocol`, `src/server`, `src/fixtures`,
`src/scripts`, `src/renderer` trees, all nine `test/*.test.js` suites, and
the committed renderer fixtures. Test suite: **76 tests / 18 suites, all
passing**. Runtime deps: `express`, `ws`; dev dep: `nodemon`. Node ESM, no
build step.

### 1.1 Classification

| Area                                                                      | File(s)                                                                                     | Status                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Deterministic engine + tick loop                                          | `simulation/engine/SimulationEngine.js`, `SimulationClock.js`                               | **Complete**                                               |
| Seeded RNG + named streams                                                | `simulation/random/SeededRandom.js`                                                         | **Complete**                                               |
| Ordered phase scheduler + intervals                                       | `simulation/engine/SystemScheduler.js`                                                      | **Complete**                                               |
| Entity storage, stable ids, deferred create/remove                        | `simulation/world/EntityManager.js`                                                         | **Complete**                                               |
| Spatial grid (insert/move/remove/radius/cell)                             | `simulation/world/SpatialGrid.js`                                                           | **Complete**                                               |
| Commands (queue + validation + boundaries)                                | `simulation/commands/CommandProcessor.js`, `protocol/commands.js`, `protocol/validation.js` | **Complete**                                               |
| Domain events (bounded, seq'd)                                            | `simulation/events/DomainEventBus.js`, `protocol/events.js`                                 | **Complete**                                               |
| Snapshots + deltas (projected, versioned)                                 | `protocol/snapshots.js`                                                                     | **Complete**                                               |
| Persistence (save/load, deterministic continuation)                       | `simulation/persistence/SimulationSerializer.js`                                            | **Complete**                                               |
| Server host + runner cadence                                              | `server/createServer.js`, `server/SimulationRunner.js`                                      | **Complete**                                               |
| HTTP + WebSocket transports                                               | `server/transports/*`                                                                       | **Complete**                                               |
| Headless script                                                           | `scripts/runHeadless.js`                                                                    | **Complete**                                               |
| Renderer (canvas grid, camera, inspector, events, controls, live+fixture) | `renderer/app/**`                                                                           | **Complete**                                               |
| Renderer fixtures                                                         | `renderer/fixtures/*.json`, `scripts/generateRendererFixtures.js`                           | **Complete** (static; one delta tick 10→11)                |
| Boundary/determinism tests                                                | `test/renderer-boundaries.test.js`, `test/engine.test.js`, `test/determinism.test.js`       | **Complete**                                               |
| Demo movement + lifecycle                                                 | `simulation/systems/MovementSystem.js`, `LifecycleSystem.js`                                | **Temporary scaffolding — to be replaced**                 |
| Demo world populate                                                       | `fixtures/createDemoSimulation.js` (`demo.grazer`, `demo.grass`)                            | **Temporary scaffolding — to be replaced/renamed**         |
| Terrain / world cells                                                     | —                                                                                           | **Missing** (renderer synthesizes ground locally)          |
| Vegetation as resource                                                    | —                                                                                           | **Missing** (`demo.grass` is an inert entity, not biomass) |
| Committed performance baseline                                            | —                                                                                           | **Missing** (headless prints ticks/sec; nothing recorded)  |

### 1.2 Specific determinations required by the task

1. **Placeholder movement/lifecycle systems exist?** Yes. `demo.movement`
   (deterministic random wander, two RNG draws/animal/tick on the
   `movement` stream) and `demo.lifecycle` (age++, flat `energyDrainPerTick`
   drain, death at energy 0 → carcass-less removal). Both are explicitly
   commented temporary and are the first real replacement targets.
2. **Renderer already displays demo entities?** Yes — `demo.grazer` (glyph
   `g`, yellow) and `demo.grass` (glyph `"`, green), selectable and
   inspectable.
3. **Terrain exists, or blank ground assumed?** Blank ground assumed.
   `AsciiGridRenderer` draws `.` inside world bounds and `#` outside, purely
   from `world.{width,height}`. No terrain is in authoritative state or the
   protocol.
4. **Environment cells in the protocol?** No. Snapshots carry
   `world:{width,height}` + an entity array only. There is no cell layer.
5. **Current entity state supports the first animal?** Yes, minimally:
   `id, kind, speciesId, x, y, heading, alive, age, energy, maxEnergy`.
   Locomotion/physiology/perception/life-stage state must be added as new
   component groups (Steps 4–6).
6. **Snapshots/deltas can evolve without exposing internals?** Yes.
   `publicEntityView` + `PUBLIC_ENTITY_FIELDS` project a whitelist; deltas
   diff public views. Adding an observable field = extend both, never expose
   the raw record.
7. **Save/load supports new component state?** Yes.
   `EntityManager.serialize()` spreads entire entity records, so new fields
   round-trip automatically; RNG streams save by name; system descriptors
   are verified on load. Save format is versioned (`SAVE_FORMAT_VERSION`).
8. **Renderer fixtures represent the live protocol?** Yes — generated from
   the real engine at seed 42 via `scripts/generateRendererFixtures.js`.
   They are a static single-delta snapshot; each protocol change must
   regenerate them (drift risk tracked in the risk register).
9. **Import boundaries enforced by tests?** Yes.
   `renderer-boundaries.test.js` fails any renderer import escaping
   `renderer/app/`, plus `node:`/`express`/`ws`/`Math.random`.
   `engine.test.js` scans `simulation`+`protocol` for host/DOM/`Math.random`
   leakage.
10. **Performance measured?** Not durably. `runHeadless.js` reports
    ticks/sec ad hoc; `determinism.test.js` runs 5000 ticks under a loose
    `<30s` smoke bound. No recorded baseline. **Step 1 establishes one.**

### 1.3 Defects / incomplete items found

- **No blocking defects.** No architectural-boundary violations, no
  `Math.random` in the domain, no unsafe mid-iteration structural mutation
  (create/remove is deferred and flushed at boundaries).
- **Minor:** no committed benchmark baseline (Step 1 fixes). Renderer
  fixtures are static and must be regenerated on protocol change (ongoing
  discipline, encoded in every step's _Persistence and fixture changes_).
- **Naming:** `defaultSimulationConfig.demo.*` and the `demo.*` species ids
  are scaffolding names; Step 4 introduces a real species-config layer and
  retires them.

**Nothing must be fixed before feature development can begin beyond the
narrow Step 1 remediation gate.**

---

## 1.4 Carried-forward deviations and open issues (Steps 1–12)

Consolidated from the completion notes of the finished steps. Each item is
either **debt** (something deliberately deferred or simplified) or a **known
limitation** (real behaviour a future step must handle). Nothing here is a
correctness bug in shipped code unless marked ⚠.

### A. Deliberately deferred / simplified scope

| # | From | Item | Owed to |
| --- | --- | --- | --- |
| A1 | 2 | Terrain legend lives at `terrain.cellTypes`, not `world.cellTypes` (natural home for the payload) | — (settled) |
| A2 | 2 | Cover generated as clumped patches, not per-cell scatter — per-cell scatter fragmented the RLE (1024² snapshot 916 KB → 118 KB) | — (settled) |
| A3 | 3 | Individual tree/shrub entities omitted (plan marked optional); `plant` kind reserved for them | any later step that needs point vegetation |
| A4 | 6 | Bounded per-entity `lifeEvents` list deferred | **Step 13** (and 21) |
| A5 | 7 | Renderer debug overlay of perceived cells deferred | later renderer pass |
| A6 | 8 | `approachFood` folded into `seekFood` (identical mechanics) | — (settled) |
| A7 | 8 | Action glyph *tint* deferred (`action` is in the bulk snapshot, so it is available) | later renderer pass |
| A8 | 10 | Optional `entity.drank` event skipped (redundant with the public `action` field) | — (settled) |
| A9 | 12 | No sexes: either adult may initiate, the lower id gestates | **Step 22** |
| A10 | 12 | `seekMate` steers toward a conspecific but does not assess mate quality | **Step 22** |

### B. Configuration / structural debt

| # | From | Item | Owed to |
| --- | --- | --- | --- |
| B1 | 4 | `fixtures/createDemoSimulation.js` not renamed to `createEcosystem.js` (rename was pure churn) | cosmetic cleanup |
| B2 | 4 | `config.demo` retained for *scenario* selection (count + species id); biology did move to `config/species/*` | — (settled) |
| B3 | 6, 10, 11 | Metabolism, hydration, and aging parameters live in **global config sections** rather than per-species | **Step 29** (species schema) |
| B4 | 7 | Perception radius resolved per-species from the registry (no entity field) — a *different* pattern from B3 | **Step 29** (unify) |
| B5 | 8 | `utilityBreakdown` persisted on the entity rather than kept transient — could bloat saves at 25k animals | **Step 30** (if save size bites) |
| B6 | 11 | `age` is a stored, per-tick-incremented field rather than derived from a `birthTick`; `updateInterval` staggering is supported and tested but unused | **Step 30** (if aging cost ever matters) |

### C. Known behavioural limitations

| # | From | Item | Owed to |
| --- | --- | --- | --- |
| ⚠ C1 | 2, 3, 5 | **Entity spawning still ignores terrain** — animals can spawn on impassable rock. Latent since Step 2; it surfaced as four test failures in Step 11 when a new RNG draw shifted spawn positions. Animals escape via the movement guard, but a spawn can be briefly invalid | **Step 13** or earlier — make spawning terrain-aware (births already are) |
| ⚠ C2 | 12 | **Parent references stay valid only because entities are never removed.** Carcass decay/removal will break this | **Step 18** — lineage refs need explicit care |
| C3 | 1, 9 | High per-tick event volume: one `entity.moved` per animal per tick, plus one `entity.fed` per eater. Bounded by the event buffer and hidden behind the renderer's "show routine" toggle, but it competes for the retention window | **Step 30** / ongoing |
| C4 | 10 | Single lake + no memory ⇒ animals stranded far from water die of thirst. Mitigated by a gentle `dehydrationRate: 0.02` | **Step 15** (remember water) |
| C5 | 12 | Reproduction first exploded exponentially (8 → 1037 by tick 20 000; food never became limiting). Re-tuned to be genuinely costly. An unchecked herbivore *should* grow until something limits it | **Steps 16 / 25** (predation, disease) |
| C6 | 7 | Perception is the dominant per-tick cost (O(r²) local scan). Staggering knob verified; ring-search early-exit and buffer reuse are the real fixes | **Step 30** |
| C7 | 5, 9 | Two deliberate modelling choices: movement uses the **current** cell's terrain modifier (not the target cell), and feeding is **in-cell** (no separate eating range) | — (settled) |

### D. Test / benchmark fragility observed

| # | Item | Guidance |
| --- | --- | --- |
| D1 | The determinism "benchmark-style" assertion had to be rewritten **four times** as biology landed (all survive → all carcasses → `entityCount === N` → `>= N`) | Assert invariants that survive biology changes, not population outcomes |
| D2 | `seekWater` is seed-dependent (seed 42 shows none in 3000 ticks; seed 7 does) — the test is pinned to a seed that exercises it | Prefer controlled scenarios over demo-behaviour assertions; pin the seed and say why |
| D3 | Vegetation biomass is a `Float32Array`, so measured deltas carry ~1e-6 error | Use float32-appropriate tolerances (1e-5), not 1e-9 |
| D4 | All twelve completed steps still read `**Status:** Not started` until this review | Update the `**Status:**` line, not just the checkboxes — the execution protocol keys off it |

---

## 2. Architectural invariants (permanent — never violate)

1. The engine runs without Express or the renderer.
2. The engine owns all authoritative simulation state.
3. Rendering is a separate system (a pure consumer of protocol output).
4. The renderer never directly mutates simulation state.
5. Ecological logic never exists in renderer code.
6. External state changes enter only through commands.
7. Observable state leaves only through snapshots, deltas, queries, and
   domain events.
8. Camera visibility never changes simulation fidelity.
9. Rendering frequency is independent of simulation tick frequency.
10. Randomness is seeded and reproducible; `Math.random()` is banned in the
    domain.
11. System execution order is explicit and deterministic (phase, then
    priority, then id).
12. Entity IDs are stable and never reused.
13. Structural creation and removal occur only at controlled boundaries.
14. Internal data layout does not leak into the protocol (whitelist
    projection only).
15. Save formats and protocol payloads are versioned.
16. Expensive systems support staggered (`updateInterval`) or event-driven
    updates.
17. No global pairwise organism searches in hot paths — use the spatial
    index.
18. Every new system must declare its state ownership (which fields it
    reads, which it writes).
19. Significant biological behavior must be inspectable via the protocol.
20. Renderer glyph and color mappings remain renderer-owned.

These are enforced by `test/renderer-boundaries.test.js` and
`test/engine.test.js`; extend those scans as new modules land.

---

## 3. Time, units, and ownership model

Confirmed from the code, and fixed here as the project convention. Where a
value does not yet exist, this is the definition to implement.

**Clocks (kept strictly distinct — invariant 8/9):**

- **1 simulation tick** — one authoritative `engine.step()`. The engine owns
  no timer.
- **In-world duration of one tick** — **defined as ~1 in-world minute.**
  This makes a day ≈ 1440 ticks; accelerated seasons/generations remain
  reachable via speed multiplier and staggered updates. (Chosen so single
  animal moves read clearly at 1 cell ≈ short stride, while days/lifespans
  are still simulable.)
- **Real-time runner cadence** — `SimulationRunner` ticks every
  `SIM_TICK_MS` (default **1000 ms** = 1 tick/sec at speed 1). Speed
  multiplier scales cadence only, never tick math.
- **Fast-forward / pause / single-step** — runner-owned
  (`simulation.setSpeed`, `pause`, `resume`, `step`). Never alter
  per-tick computation.
- **Rendered frame** — `requestAnimationFrame`, decoupled; the renderer
  redraws on dirty, interpolating between ticks is allowed later
  (`previousPosition` already tracked).

**Units (SI-ish, dimensionless where a real unit adds no visible value):**

| Quantity                  | Unit                                        | Notes                                                           |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| World coordinate          | 1 cell = 1 world unit                       | continuous floats in `[0,width]×[0,height]`                     |
| Distance                  | world units                                 | euclidean                                                       |
| Speed                     | world units / tick                          | locomotion cost scales with it                                  |
| Age                       | ticks                                       | (`age` already exists)                                          |
| Body mass                 | kilograms (kg)                              | Step 4; scales metabolism & movement cost                       |
| Energy                    | abstract kJ-equivalent "energy units"       | `energy`/`maxEnergy` exist; give them a defined scale in Step 6 |
| Food energy               | energy units per unit biomass / edible mass | Steps 3, 9, 18                                                  |
| Hydration                 | 0–1 fraction (or 0–100)                     | Step 10                                                         |
| Temperature               | °C                                          | Step 19                                                         |
| Probabilities / fractions | 0–1                                         | always via a named RNG stream                                   |

**Ownership rule for every step:** name the component group(s) written, the
RNG stream(s) consumed, the phase(s) used, and the events emitted. Two
systems must never write the same field.

---

## 4. Entity-composition roadmap

Composition only — **no inheritance hierarchy** (`Entity → Organism →
Animal → …` is forbidden). Entities stay flat plain-data records; component
groups are added as steps require them, and each new group is projected,
persisted, and inspected deliberately.

Introduce these groups **only when a step needs them**:

- **Identity** — `id, kind, speciesId` _(exists)_
- **Position** — `x, y, heading` _(exists)_
- **Locomotion** — `speed, moveIntent, terrainClass` (Step 5)
- **Physiology** — `energy, maxEnergy, bodyMass, basalRate, health`
  (Steps 4, 6, 17)
- **Life stage** — `lifeStage, birthTick, maturityTick` (Step 11)
- **Perception** — transient per-tick `perceived` summary (Step 7)
- **Current intent** — `action, actionTarget, utilityBreakdown` (Step 8)
- **Memory** — bounded `memories[]` (Step 15)
- **Reproduction** — `reproState, gestationUntil, mateId` (Steps 12, 22)
- **Genetics** — `genome{}, phenotype{}` (Step 20)
- **Relationships** — sparse `parents[], offspring[], groupId` (Steps 13, 23)
- **Injury** — `injuries[]` (Step 17)
- **Disease** — `diseaseState` (Step 25)
- **Life-history references** — bounded `lifeEvents[]` (Steps 6, 13, 21)

Do not pre-build the final schema. Each group ships with its projection,
persistence, inspection, and tests in the step that introduces it.

---

## 5. Implementation steps

> Every step must leave the app runnable (`npm install && npm run dev`),
> testable (`npm test`), and visibly improved. Statuses: `Not started` →
> `In progress` → `Done`. Fill _Completion notes_ when finishing.

---

## Step 1 — Audit and minimally remediate the completed foundation

**Status:** Done

### Objective

Verify the foundation against the invariants and establish a recorded,
deterministic performance baseline. Replace **no** architecture; fix only
what blocks safe feature development.

### Why this step comes now

Feature work rests on determinism, boundary tests, and a known tick budget.
This gate confirms those and gives every later step a benchmark to compare
against (invariant 16, risk "tick-budget overruns").

### Visible result

No new in-world visuals. A committed `BENCHMARK.md` (or
`scripts/benchmark.js` output) records baseline ticks/sec and ms/tick for
the demo world at defined entity counts. `README`/`PLAN` note the tick =
~1 in-world minute convention.

### Existing code to retain or replace

Retain everything. Only add a benchmark script/doc and, if inspection finds
one, a single targeted fix. Do **not** touch the demo systems yet (Step 4
replaces them).

### Dependencies

None.

### Simulation changes

Add `src/scripts/benchmark.js` (headless, seeded, prints ms/tick and
ticks/sec for e.g. 1k/5k/20k ticks and N entities). Optionally add a
`config.time.tickMinutes` constant documenting the convention.

### Protocol changes

None (no version bump).

### Renderer changes

None.

### Persistence and fixture changes

None. Confirm save/load round-trip continuation test still passes.

### Tests

Confirm all 76 pass. Add a boundary-scan assertion if any module lacks
coverage. Add a determinism guard asserting two seeded 2000-tick runs are
byte-identical (already present — verify).

### Deterministic demonstration scenario

Scenario 0 (baseline): seed 42 demo world, 2000 ticks, assert identical
serialized state across two runs; record timing.

### Performance considerations

This step _is_ the baseline. Record hardware and Node version alongside
numbers.

### Acceptance criteria

- [x] Foundation verified against invariants 1–20 (note each verified)
- [x] Baseline benchmark committed with numbers + environment
- [x] Tests pass
- [x] Visible result verified (benchmark output reproducible)
- [x] Documentation updated (tick/unit convention)
- [x] Performance checked where applicable

### Explicitly out of scope

Replacing demo systems, terrain, any new component state.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.)

**Invariant verification (1–20):** all confirmed present, most by existing
tests.

- 1 engine runs without Express/renderer — `engine.test.js` "engine runs
  headless"; `benchmark.js`/`runHeadless.js` run the engine standalone.
- 2 engine owns authoritative state — snapshots are projections
  (`publicEntityView`); no external writer path except commands.
- 3/4/5 rendering separate, renderer never mutates, changes via commands —
  `renderer-boundaries.test.js` (renderer imports nothing internal),
  `CommandProcessor` is the only mutation intake.
- 6/7 observable state leaves via snapshots/deltas/events/queries — protocol
  layer only.
- 8/9 camera & frame rate independent of sim — renderer owns camera; runner
  owns cadence; verified in renderer tests.
- 10 seeded RNG, no `Math.random` in domain — `engine.test.js` source scan;
  `determinism.test.js`.
- 11 explicit deterministic order — `SystemScheduler` (phase→priority→id),
  tested.
- 12 stable ids — `engine.test.js` "ids stable, monotonic, never reused".
- 13 controlled create/remove boundaries — deferred flush, tested.
- 14 no internal layout leak — `PUBLIC_ENTITY_FIELDS` whitelist; snapshot
  isolation test.
- 15 versioned protocol + save — `PROTOCOL_VERSION`, `SAVE_FORMAT_VERSION`.
- 16 staggered updates — `updateInterval` in scheduler, tested.
- 17 no global pairwise search in hot paths — spatial grid present; demo
  systems iterate once, no pairwise loops.
- 18 state ownership — documented per system; enforced by convention.
- 19 behavior inspectable — inspector + `entity.inspection`.
- 20 glyph/color renderer-owned — `EntityAppearance` in renderer only;
  `renderer-boundaries.test.js` asserts sim stores no glyph/color.

**Remediation applied (one targeted fix):** the baseline exposed an
O(maxBufferedEvents)-per-emit front `splice` in `DomainEventBus` (the demo
emits one move event per animal per tick). Measured **58.65 ms/tick** at
25k entities; isolated to the trim (74 → 2.8 ms/tick with trimming
effectively off). Replaced with an amortized-O(1) bulk trim (retention floor
unchanged at `maxBufferedEvents`, ceiling `2×`). Result **58.65 → 1.63
ms/tick (~36×)**, determinism preserved. New `test/event-bus.test.js`
(5 tests) covers retention bounds, `since()` correctness after trimming,
amortized-cost guard, and serialize/restore. No other defects found; no
architecture rebuilt.

**Also added:** `config.time` (`tickMinutes: 1`, `runnerTickMs: 1000`) as
documentation-only constants; `src/scripts/benchmark.js` + `npm run
benchmark`; `BENCHMARK.md` (committed baseline + environment + repro);
README "Time and units" section; a 2000-tick byte-identical determinism
guard in `determinism.test.js`.

**Verification:** `npm test` → **81 passing / 0 failing** (was 76; +5
event-bus). `npm run benchmark` reproducible, determinism OK. Server boots
and serves `/api/status` + `/api/snapshot` (protocolVersion 1, 32 entities).
No protocol or save-format version bump (config addition round-trips through
existing save/load; persistence test green). Renderer fixtures unchanged —
no protocol output changed, so no regeneration needed.

**Baseline (post-fix):** demo-default 0.0035 ms/tick · small-100 (500 ent)
0.025 · medium-1k (5000 ent) 0.244 · large-5k (25000 ent) 1.63. All far
under the 1 s tick budget.

**Follow-on note for later steps:** the demo `MovementSystem` emits one
`entity.moved` per animal per tick — fine now, but per-animal behavior
systems (Steps 5–9) should prefer deltas over per-entity events where
possible, and event volume should be watched against the retention window.

---

## Step 2 — Terrain and world-cell projection

**Status:** Done

### Objective

Introduce a deterministic, seeded terrain cell layer (open ground, water,
impassable rock, optional sparse cover) as authoritative state, projected to
the renderer and affecting movement validity.

### Why this step comes now

Terrain is the substrate every later system references (movement, water,
vegetation suitability). It is the earliest high-visibility change and the
renderer already fakes ground, so this replaces a fake with real data.

### Visible result

The ASCII grid shows real terrain: `.` ground, `~` water, `#` rock, `,`
sparse cover — from authoritative data, not synthesized locally.

### Existing code to retain or replace

Retain the renderer's glyph registry; **remove the renderer's synthesized
`#`/`.` assumption** in `AsciiGridRenderer` in favor of protocol terrain.
Keep `World`; add a terrain grid alongside the spatial index.

### Dependencies

Step 1.

### Simulation changes

Add `world/TerrainGrid.js` (typed-array-friendly cell enum, seeded
generation via a `terrain` RNG stream). Store on `World`. Add an
`EnvironmentSystem`-free static layer for now (regeneration is deterministic
from seed + world config). Declare ownership: terrain is written only at
world init.

### Protocol changes

**Version bump.** Extend snapshots with a `terrain` block (run-length or
row-packed cell codes + legend), and add a `terrain` query
(`GET /api/terrain` or include-in-snapshot flag). Keep it renderer-neutral
(codes, not glyphs). Add `world.cellTypes` legend to snapshot metadata.

### Renderer changes

Consume terrain from the snapshot; map cell codes → glyph/color in the
renderer's appearance registry. Terrain drawn first (already the draw order).

### Persistence and fixture changes

**Save version bump**; persist terrain seed + params (regenerate on load,
do not store the full grid unless generation is non-reproducible).
Regenerate renderer fixtures.

### Tests

Terrain determinism (same seed → same grid); projection excludes internal
arrays; renderer boundary still holds; a "terrain legend covers all emitted
codes" test.

### Deterministic demonstration scenario

**Terrain sandbox** (seed fixed): a world with a water body and a rock ridge;
assert cell counts by type and that specific cells are impassable.

### Performance considerations

Terrain packing must keep snapshot size bounded (RLE or region queries for
large worlds — see Step 30). Measure snapshot bytes vs. Step 1.

### Acceptance criteria

- [x] Deterministic seeded terrain in authoritative state
- [x] Terrain visible in renderer from protocol data
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (snapshot size)

### Explicitly out of scope

Geology, hydrology, erosion, elevation, moisture diffusion.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.)

**What shipped.** A static, authoritative terrain layer — `ground`, `water`,
`rock` (impassable), `cover` — generated deterministically at world init and
projected to the renderer, replacing the renderer's synthesized ground.

- **Simulation:** new `world/TerrainGrid.js` (Uint8Array cells, seeded
  generation: circular lakes, straight rock ridges, clumped cover patches;
  `codeAt`/`isPassable`/`countByType`/`toRunLength`, plus `projectTerrain`).
  `World` owns `terrain` and exposes `isPassableAt(x, y)` (authoritative
  movement validity). Engine seeds terrain from `deriveSeed(seed, 'terrain')`
  and memoizes the projection (`getTerrainData`). `config.terrain` holds
  generation params. Ownership: terrain is written only at construction.
- **Scaffolding touched (minimal):** `MovementSystem` now refuses to step
  onto impassable cells (both RNG draws still happen unconditionally, so the
  stream is unchanged — determinism preserved). Full terrain-aware
  locomotion remains Step 5.
- **Protocol (v1 → v2):** full snapshots embed a `terrain` block
  (`{ width, height, cellTypes legend, encoding: 'rle-row-major', runs }`);
  new `GET /api/terrain` + `buildTerrainResponse`. Renderer-neutral (codes +
  passability, never glyphs). Deltas never carry terrain; `applyDeltaSnapshot`
  carries it forward from the base so it still reproduces the next snapshot.
- **Renderer:** store decodes the RLE into a row-major `Uint8Array`
  (`terrainNameAt`); `AsciiGridRenderer` draws each cell from the legend via
  renderer-owned `TERRAIN_APPEARANCE` (`.` `~` `#` `,`), edges beyond the
  world. `SUPPORTED_PROTOCOL_VERSION` → 2.
- **Persistence (save v1 → v2):** terrain is derived (regenerates from seed +
  `config.terrain`), so no new persisted field; v2 bump explicitly
  invalidates pre-terrain saves (none committed). Migration note in the
  serializer.
- **Fixtures:** regenerated (now v2 with terrain).

**Tests:** `npm test` → **96 passing / 0 failing** (was 82; +14). New
`test/terrain.test.js` (determinism, RLE coverage, passability, cover-only-on-
ground, legend covers codes, projection is presentation-free, terrain
sandbox: seeded lake+ridge with impassable cells, and "demo animals never
step onto impassable terrain"). Renderer-store terrain-decode tests (row-major
lookup, clears when absent, rejects malformed runs). Renderer synthetic
messages now track `SUPPORTED_PROTOCOL_VERSION`.

**Visible result verified.** Server serves terrain (v2); `/api/snapshot`
embeds it; driving the renderer store with the live snapshot decoded the full
128×128 world (ground 14769 + water 657 + rock 384 + cover 574 = 16384) and
mapped names → glyphs `.` `~` `#` `,`; out-of-bounds → null (edge glyph).

**Performance.** Baseline unchanged: large-5k **1.63 → 1.52 ms/tick** (within
noise; movement guard is a cheap `isPassableAt`), determinism OK. Terrain
generation is one-time at init. **Snapshot size:** per-cell cover scatter
first fragmented the RLE (1024² → 150k runs / 916 KB); switching cover to
clumped patches cut it to **18k runs / 118 KB** at 1024², and 3.8 KB for the
128×128 demo. Terrain is memoized and shared; per-snapshot cost is a shallow
structuredClone of the runs.

**Deviations from the step spec (minor, documented):** (1) the cell legend
lives inside the `terrain` block (`terrain.cellTypes`) rather than under
`world.cellTypes` — it is the natural home for the terrain payload and keeps
`world` to dimensions. (2) Cover is generated as clumped patches rather than
per-cell scatter, for RLE compactness (see snapshot-size note). (3) The save
gained no new field (terrain is derived); the version bump serves to
invalidate pre-terrain saves.

**Follow-on notes for later steps:** entity spawning still ignores terrain
(animals/plants may spawn on rock and escape via the movement guard);
terrain-aware spawning belongs to Step 4/5. Water is currently passable;
Step 10 makes it behaviorally distinct.

---

## Step 3 — Simplified vegetation (cell biomass)

**Status:** Done

### Objective

Add grass/low vegetation as **cell-level biomass** with seeded regrowth
gated by simple suitability (sunlight/water/temperature proxies), plus
consumption/depletion hooks. Optionally a few individual tree/shrub
entities.

### Why this step comes now

Food must exist before herbivores can forage (Steps 4–9). Biomass-as-cells
avoids thousands of plant entities (invariant 17, performance).

### Visible result

Vegetation density visibly varies across cells (e.g. shading of the ground
glyph or a `"`/`,`/`.` density ramp); patches visibly deplete and regrow.

### Existing code to retain or replace

**Replace `demo.grass` inert plant entities** with the biomass layer. Retain
the option of sparse individual shrubs/trees as real entities where a point
feature matters.

### Dependencies

Step 2 (suitability reads terrain/water).

### Simulation changes

Add `world/VegetationGrid.js` (biomass float per cell) and a
`VegetationSystem` (phase `environment`, `updateInterval` staggered) doing
logistic regrowth from a `vegetation` RNG stream + suitability. Ownership:
biomass written only by `VegetationSystem` and by feeding (Step 9).

### Protocol changes

**Version bump.** Add a `vegetation` layer to snapshots/deltas
(quantized biomass per cell, delta only for changed cells). Add a
vegetation legend/scale.

### Renderer changes

Map biomass buckets → glyph/intensity in the appearance registry
(renderer-owned). Vegetation distinct from bare terrain.

### Persistence and fixture changes

**Save version bump**; persist biomass grid (or seed + tick if reproducible).
Regenerate fixtures.

### Tests

Regrowth determinism and monotonic-under-no-grazing; depletion reduces
biomass; suitability zero on rock/water; delta only emits changed cells.

### Deterministic demonstration scenario

Seeded world; run N ticks with no herbivores; assert biomass approaches a
suitability-bounded level per region (qualitative bands, not exact floats).

### Performance considerations

Vegetation update is the largest cell loop; stagger it and delta only
changed cells. Benchmark cell-update ms.

### Acceptance criteria

- [x] Vegetation biomass layer with seeded regrowth
- [x] Visibly distinct from terrain; depletes and regrows
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (cell-update + delta size)

### Explicitly out of scope

Soil chemistry, roots, nutrient pools, individual grass entities, moisture
diffusion.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.)

**What shipped.** Cell-level vegetation biomass replacing the inert
`demo.grass` plant entities — a continuous field that grows and can be
depleted, visible as a green density ramp over the ground.

- **Simulation:** new `world/VegetationGrid.js` (Float32Array biomass +
  static per-cell carrying capacity from terrain suitability × seeded
  fertility; `biomassAt`/`levelAt`/`grow`/`consumeAt`/`levels`, plus
  `projectVegetation`/`encodeLevelRuns`). New `VegetationSystem`
  (`environment` phase, `updateInterval: 5`) does logistic regrowth toward
  each cell's capacity — deterministic and monotonic-up without grazing, with
  a colonization seed floor so grazed-bare cells recover. `World` owns
  `vegetation` (built after terrain for suitability) and adds `cellOf`.
  `config.vegetation` holds the parameters. Ownership: biomass written only by
  `VegetationSystem` (regrowth) and `consumeAt` (the Step 9 feeding hook);
  every mutation bumps a `revision`.
- **Demo composition:** `demo.grass` plant entities removed; the demo now runs
  animals + terrain + vegetation. `config.demo.plantCount` retired.
- **Protocol (v2 → v3):** full snapshots embed a `vegetation` block (quantized
  levels 0..4, RLE, `revision`). Deltas carry sparse
  `vegetation: { revision, changes: [[cellIndex, level]] }`, gated by the
  revision so unchanged ticks produce an empty set without an O(cells) diff.
  `applyDeltaSnapshot` reconstructs vegetation from base + changes.
- **Renderer:** store decodes vegetation RLE into a row-major `Uint8Array`
  (`vegetationLevelAt`) and patches it from deltas; `AsciiGridRenderer` draws
  a renderer-owned green density ramp (`. , " "`) over ground for levels 1+,
  terrain showing through at level 0. `SUPPORTED_PROTOCOL_VERSION` → 3.
- **Persistence (save v2 → v3):** biomass is saved (it evolves and will be
  grazed, so it is not reproducible from the seed alone); older saves
  invalidated.
- **Performance:** the engine memoizes the vegetation projection by revision,
  so per-tick snapshot cost is O(1) on the many ticks where biomass is
  unchanged (regrowth is staggered).

**Tests:** `npm test` → **111 passing / 0 failing** (was 96; +15). New
`test/vegetation.test.js` (determinism, no growth on water/rock, monotonic
regrowth, bare-cell recolonization, `consumeAt`, revision bumps, RLE
round-trip, presentation-free projection, snapshot embeds vegetation, sparse
deltas reproduce the next snapshot, empty-change revision gate). Renderer
store vegetation tests (decode, sparse delta apply, empty change set, clear
when absent, malformed runs rejected). Updated the determinism benchmark
assertion (no plant entities → 0 entities after starvation) and the benchmark
script (animals only).

**Visible result verified.** Server serves v3 with vegetation; a live 128×128
snapshot decoded to 15343 vegetated + 1041 bare cells (bare = water 657 +
rock 384) mapped to green glyphs `. , "`. Over a live WebSocket run, 2 of 12
per-tick deltas (the vegetation-update ticks) carried 1397 cell changes total
and the store applied them in sync (revision-gated; the other 10 were empty).

**Performance.** large-5k **1.52 → 1.81 ms/tick** (Step 2 → 3): the staggered
regrowth cell loop is the added cost, still far under the 1 s budget.
Vegetation delta size is sparse (empty on non-update ticks; ~700 changes per
update tick on the demo world). Snapshot vegetation payload: ~7.8k RLE runs
for the 128×128 demo.

**Deviations from the step spec (minor, documented):** (1) individual
tree/shrub entities were left out (the plan marks them optional) — deferred to
keep scope tight; `plant` remains a valid entity kind for them. (2) The
`vegetation` RNG stream seeds the initial biomass and per-cell fertility
field; regrowth itself is deterministic (no per-tick RNG), which is what makes
"monotonic under no grazing" hold.

**Follow-on notes for later steps:** `VegetationGrid.consumeAt` is the feeding
hook Step 9 will call; grazing is what will make depletion→regrowth dynamic
(regrowth alone currently just fills toward capacity). Entity spawning still
ignores terrain/vegetation.

---

## Step 4 — First real herbivore species

**Status:** Done

### Objective

Replace generic demo animals with one configured herbivore species carrying
the minimum authoritative physiology/locomotion state, driven by a
species-definition config layer (biological params only — no glyphs/colors).

### Why this step comes now

Every behavior step attaches to a real species record. Establishing the
species-config seam now prevents species-name conditionals later
(invariant, risk "over-generalized abstractions" balanced against
"duplication").

### Visible result

The world is populated by an inspectable herbivore (e.g. species id
`herbivore.grazer`) with real fields in the inspector: body mass, speed,
health, energy, age, alive.

### Existing code to retain or replace

**Replace `demo.grazer` populate** in a renamed
`fixtures/createDemoSimulation.js` (or new `fixtures/createEcosystem.js`).
Retain `EntityManager` and the spawn command path. Retire
`config.demo.*` in favor of `config.species.*`.

### Dependencies

Steps 2–3.

### Simulation changes

Add `config/species/` definitions (mass, base speed, diet, metabolic
constants, lifespan bounds — biology only). Extend entity records with
`bodyMass, speed, health, maxHealth`. Ownership documented per field.

### Protocol changes

**Version bump.** Add `bodyMass, health, healthFraction` (and keep
`speciesId`) to `PUBLIC_ENTITY_FIELDS`/`publicEntityView`. Renderer maps
`speciesId` → appearance (already supported).

### Renderer changes

Add the herbivore to `EntityAppearance` (glyph/color/priority) — renderer
config only. Inspector shows the new fields.

### Persistence and fixture changes

**Save version bump** (new fields round-trip automatically; verify).
Regenerate fixtures; update species mapping docs.

### Tests

Species config loads deterministically; spawned herbivore has expected
derived stats; snapshot exposes only whitelisted fields; renderer boundary
holds.

### Deterministic demonstration scenario

Seeded spawn of K herbivores; assert count, that inspector fields are
populated, and determinism across two runs.

### Performance considerations

Negligible; record entity-record size growth.

### Acceptance criteria

- [x] One configured herbivore species from a biology-only config layer
- [x] Selectable/inspectable with real physiology fields
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (species config, protocol + save version)
- [x] Performance checked where applicable

### Explicitly out of scope

Behavior beyond existing wander, energy dynamics, multiple species.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.)

**What shipped.** A species-config seam and the first real herbivore
(`herbivore.grazer`), replacing the generic `demo.grazer`, with authoritative
physiology fields that are projected and inspectable.

- **Simulation:** new `config/species/` layer — `herbivoreGrazer.js`
  (biology only: `bodyMass`, `baseSpeed`, `maxEnergy`, `maxHealth`,
  `metabolicRate`, `diet`, initial-energy range — no glyphs/colors/labels) and
  `index.js` (registry + `getSpecies`/`listSpecies`, id lookup, throws on
  unknown). Entity records gained `bodyMass, speed, health, maxHealth`
  (`EntityManager` factory, with defaults). `config.demo` is now scenario-only
  (`animalCount`, `speciesId`); all biology moved to the species definition.
  The demo spawns from the species and `MovementSystem` now steps by each
  entity's `speed` (making `speed` a physiology field that matters); the
  scaffolding `LifecycleSystem` drain is sourced from the species'
  `metabolicRate`.
- **Ownership:** `bodyMass`/`speed` set at spawn from the species, read-only
  for now; `health` will be written by lifecycle/injury systems later.
- **Protocol (v3 → v4):** `PUBLIC_ENTITY_FIELDS`/`publicEntityView` gained
  `bodyMass` and `healthFraction`; absolute `health`/`maxHealth`/`speed` are
  inspection-only (`getEntityDetails`). Spawn validation now checks
  `bodyMass`/`speed`/`health`/`maxHealth`.
- **Renderer:** `SPECIES_APPEARANCE` maps `herbivore.grazer` → `g`/yellow
  (renderer-owned); the inspector shows body mass, health %, and (from
  inspection detail) absolute health and speed. `SUPPORTED_PROTOCOL_VERSION`
  → 4.
- **Persistence (save v3 → v4):** the four new fields round-trip
  automatically (records are serialized whole); v3 saves invalidated.

**Tests:** `npm test` → **118 passing / 0 failing** (was 111; +7). New
`test/species.test.js` (registry is biology-only, unknown id throws, demo
animals configured from the species, deterministic spawn across two runs,
inspectable physiology, snapshot exposes only whitelisted fields with
`bodyMass`/`healthFraction` and no absolute-value leak, movement bounded by
`speed`). Updated `renderer-view.test.js` species ids to `herbivore.grazer`.

**Visible result verified.** Server serves v4; a live snapshot entity shows
`speciesId: herbivore.grazer`, `bodyMass: 30`, `healthFraction: 1`;
`GET /api/entities/1` returns `health 100/100`, `speed 1.2`, `bodyMass 30`,
`energy 65.4/100`; a spawn with `bodyMass: -3` is rejected with
`entity.bodyMass: must be > 0`.

**Performance.** Entity records grew 10 → 14 fields (four scalars); benchmark
unchanged from Step 3 (large-5k 1.81 → 1.79 ms/tick, within noise),
determinism OK.

**Deviations from the step spec (minor):** (1) kept the file
`fixtures/createDemoSimulation.js` rather than renaming to `createEcosystem.js`
— the rename adds churn across the server/scripts/tests for no behavioral gain;
noted for a later cleanup. (2) `config.demo` was retained for
scenario selection (count + species id) rather than fully removed — biology
moved to `config/species/*`, which is the intent; scenario knobs are not
biology.

**Follow-on notes for later steps:** the species declares `metabolicRate`,
`diet`, and (implicitly) lifespan needs that Steps 6/11 will consume; per-
individual variation of `bodyMass`/`speed` is Step 14; multiple species and a
config-driven species schema are Step 29.

---

## Step 5 — Terrain-aware locomotion

**Status:** Done

### Objective

Replace `demo.movement` with real movement: heading + speed intents, terrain
traversal rules (impassable cells blocked, cover/terrain speed modifiers),
local wandering, spatial-index sync, and movement deltas/events.

### Why this step comes now

First major visible-action milestone; everything downstream (foraging,
fleeing) is movement. Must respect terrain from Step 2.

### Visible result

Animals visibly move around obstacles; they cannot enter rock/water;
movement reads as continuous cell-to-cell change in the grid.

### Existing code to retain or replace

**Replace `MovementSystem` (`demo.movement`).** Retain `World.moveEntity`
(keeps spatial index synced) and the `entity.moved` event.

### Dependencies

Steps 2, 4.

### Simulation changes

`MovementSystem` v2 (phase `movement`): consume a `movement` RNG stream for
wander; compute candidate step; reject impassable target cells; apply
terrain speed modifier; call `World.moveEntity`. Add `moveIntent`
transient. Ownership: writes `x, y, heading`; reads terrain.

### Protocol changes

Likely none (positions already projected). Possibly enrich `entity.moved`
or add a `blocked` flag if visibly useful; if so, **version bump**.

### Renderer changes

None required beyond existing move rendering; optional heading indicator.

### Persistence and fixture changes

Regenerate fixtures (movement values change). Save version unchanged unless
`moveIntent` is persisted.

### Tests

Impassable cells never occupied; position always matches spatial index
(invariant); deterministic paths for a seeded single animal; clamping at
world bounds.

### Deterministic demonstration scenario

**Movement sandbox**: one animal, a rock wall, fixed seed; assert it never
enters blocked cells and its tick-N position is stable.

### Performance considerations

Movement is per-animal per-tick; ensure no global scans. Benchmark ms/tick
vs. baseline.

### Acceptance criteria

- [x] Terrain-aware movement replacing demo wander
- [x] Spatial index stays consistent (invariant test)
- [x] Tests pass
- [x] Visible result verified (animals navigate obstacles)
- [x] Documentation updated
- [x] Performance checked (ms/tick)

### Explicitly out of scope

Pathfinding, goal-directed movement, energy cost (next step), perception.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.) First major visible-action
milestone.

**What shipped.** Real terrain-aware locomotion replacing the demo wander.

- **Simulation:** `MovementSystem` rewritten (id `demo.movement` →
  `movement.wander`, no longer scaffolding). Animals wander with a _committed
  intent_ — a held heading plus a tick countdown, with gentle per-tick jitter
  — so paths read as coherent travel instead of per-tick noise. Steps are
  scaled by `entity.speed × terrain speed modifier` (cover 0.6, water 0.5,
  ground 1.0); a step onto an impassable cell is refused, and the animal turns
  around (π) and re-commits. New per-entity `moveIntent` field
  (`{ heading, ttl }`, null until first move). `TerrainGrid.speedModifierAt` +
  `World.speedModifierAt` provide the authoritative traversal cost. Ownership:
  writes `x, y, heading, moveIntent`; reads terrain. No global scans (each
  animal processed once); exactly two RNG draws per animal per update, so
  terrain outcomes never shift the `movement` stream.
- **Protocol:** unchanged (v4) — positions and heading were already projected;
  `moveIntent` is internal and never leaves the engine.
- **Renderer:** no change needed; movement already renders as cell-to-cell
  change, and heading is available for an optional indicator later.
- **Persistence (save v4 → v5):** `moveIntent` is persisted (needed for
  deterministic wander continuation across save/load); v4 saves invalidated.
  Fixtures regenerated (movement values changed; still protocol v4).

**Tests:** `npm test` → **127 passing / 0 failing** (was 118; +9). New
`test/movement.test.js`: terrain speed modifiers (ground/cover/water/
out-of-bounds), `World.speedModifierAt`, animals never occupy impassable
cells over a long run, spatial-index stays consistent with positions
(queryRadius finds each entity at its own position; grid size == entity
count), positions clamped to world bounds, a single step never exceeds
`speed × start-cell modifier`, deterministic movement across two seeded runs,
committed-intent coherence, and the **movement sandbox** (blocked-by-rock
animals turn away and never breach the wall).

**Visible result verified.** Live server: animal #1 traveled
(128.00, 99.79) → (123.01, 89.85) over 12 ticks with a coherent heading; all
8 animals moved in the window; **zero** animals on impassable terrain. The
"never on impassable cell" invariant holds across a 400-tick run in tests.

**Performance.** large-5k **1.79 → 1.72 ms/tick** (within noise; movement is
per-animal, no global scans), determinism OK. Save/load continuation with
`moveIntent` verified identical to an uninterrupted run (mid-run save at tick
37, +50 ticks both sides → byte-identical).

**Deviations from the step spec:** none of substance. Chose current-cell
terrain modifier (the terrain the animal is moving through) rather than
target-cell; documented in the system. Renamed the system id to
`movement.wander` to reflect it is now real locomotion (goal selection is
Step 8).

**Follow-on notes for later steps:** movement is undirected wander; Step 8's
decision system will set `moveIntent` toward goals (food/water/threats).
Energy cost of movement lands in Step 6 (metabolism reads distance moved /
`bodyMass`). `moveIntent` is the seam Step 8 writes into.

---

## Step 6 — Energy and metabolism

**Status:** Done

### Objective

Replace `demo.lifecycle`'s flat drain with real bioenergetics: stored
energy, basal cost (mass-scaled), movement cost (speed/mass-scaled),
low-energy states, starvation, death, and **carcass creation**.

### Why this step comes now

Completes the minimal survival loop's cost side; death must produce carcasses
that later scavenging (Step 18) consumes. Closes Milestone B's energy arc.

### Visible result

Animals that move a lot deplete faster; starving animals die and leave a
visible carcass glyph (`%`); the event log shows `entity.died` with a cause.

### Existing code to retain or replace

**Replace `LifecycleSystem`'s energy drain** (aging split into Step 11).
Retain the death→event path; extend it to spawn a carcass entity/state
instead of plain removal.

### Dependencies

Steps 4, 5.

### Simulation changes

`MetabolismSystem` (phase `physiology`): basal + movement energy cost;
clamp; set low-energy flag; on energy ≤ 0 → `alive=false`, emit
`entity.died{cause:'starvation'}`, create a `carcass` entity/state (edible
mass ~ body mass) via deferred spawn. Ownership: writes `energy`, `alive`.

### Protocol changes

**Version bump.** `energyFraction` already exists; add `cause` breadth to
death events and a `carcass` kind projection. Add `lifeEvents` bounded list
(optional now, needed by Step 13/21).

### Renderer changes

Carcass appearance (`%`, orange) — already reserved in the registry.
Inspector shows energy scale and low-energy state.

### Persistence and fixture changes

**Save version bump** (carcass state). Regenerate fixtures.

### Tests

Energy monotonic under no feeding; movement increases drain; death exactly
at threshold; carcass created with expected edible mass; determinism.

### Deterministic demonstration scenario

**Starvation sandbox**: one animal, no food, fixed seed; assert tick of
death is exact and a carcass appears.

### Performance considerations

Per-animal arithmetic; negligible. Confirm no allocation churn in the hot
loop.

### Acceptance criteria

- [x] Mass-scaled basal + movement energy costs
- [x] Starvation death + carcass creation with cause
- [x] Tests pass
- [x] Visible result verified (differential depletion, carcass)
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Feeding/energy gain (Steps 8–9), aging (Step 11), decay stages (Step 18).

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.) Closes the cost side of the
minimal survival loop (Milestone B's energy arc).

**What shipped.** Real bioenergetics replacing the scaffolding flat drain.

- **Simulation:** new `MetabolismSystem` (phase `physiology`): each living
  animal pays `basalRate × massFactor` plus `moveCostFactor × distance ×
massFactor` per tick, where `massFactor = (bodyMass/referenceMass) **
0.75`. Energy is clamped at 0; a `lowEnergy` flag is set below
  `lowEnergyFraction`. On energy ≤ 0 the animal **starves**: it dies in place
  and becomes a `carcass`-kind entity (identity preserved) with
  `edibleMass = bodyMass × 0.6`, emitting `entity.died{cause:'starvation'}`.
  `MovementSystem` now records `entity.lastMoveDistance` (actual travel, 0 if
  blocked), which metabolism consumes and resets — so movers deplete faster
  (differential depletion). `LifecycleSystem` reduced to aging only (id
  `demo.lifecycle` → `lifecycle.aging`; energy/death moved out); life stages
  are Step 11. `config.metabolism` holds the params (global for now; the
  species' old `metabolicRate` was removed as superseded). Ownership:
  metabolism writes `energy`, `lowEnergy`, and on death `alive`/`kind`/
  `edibleMass`; no randomness, no global scans.
- **Carcass model:** in-place transformation rather than spawn+remove — fewer
  events, preserved entity id, valid spatial-grid entry at the death position
  (what scavenging in Step 18 will query). The kind flip animal→carcass rides
  a normal delta `updated` entry; all animal systems skip carcasses via the
  `kind === 'animal' && alive` guard.
- **Protocol (v4 → v5):** `carcass` added to `ENTITY_KINDS`; `entity.died`
  now carries `cause: 'starvation'`; `getEntityDetails` exposes `lowEnergy`
  and `edibleMass`. (`energyFraction` already existed; carcass is projected
  via the normal `kind` field.) `lifeEvents` deferred to Step 13 where it is
  needed.
- **Renderer:** `resolveAppearance` maps `kind === 'carcass'` → `%` orange;
  the inspector shows a "low energy" state and (for carcasses) edible mass.
  `SUPPORTED_PROTOCOL_VERSION` → 5.
- **Persistence (save v5 → v6):** `lastMoveDistance`, `lowEnergy`,
  `edibleMass`, and the `carcass` kind round-trip automatically; v5 saves
  invalidated.

**Tests:** `npm test` → **137 passing / 0 failing** (was 127; +10). New
`test/metabolism.test.js`: exact basal drain, mass scaling (heavier burns
more), movement adds cost proportional to distance, `lastMoveDistance` reset,
low-energy threshold toggle, death exactly at zero energy with a carcass of
the expected edible mass, `entity.died{cause:'starvation'}`, carcasses inert
thereafter, and demo integration (inspection exposes the fields; carcasses
appear; run stays deterministic). Updated the determinism benchmark test
(animals now become persistent carcasses, not removed) and the protocol
delta test (death is a carcass _update_, not a removal).

**Visible result verified.** Live: a spawned starving animal (energy 0.15)
became a `carcass` by tick 3 with `edibleMass = 18` (= 30 × 0.6),
`alive = false`; the snapshot carries `kind: 'carcass'` for the renderer.
Differential depletion (movers burn more) is covered by unit tests.

**Performance.** large-5k **1.72 → 1.81 ms/tick** (per-animal arithmetic +
carcasses now persist and are iterated but skipped cheaply), determinism OK.
No per-tick allocation in the metabolism loop.

**Deviations from the step spec (minor, documented):** (1) carcass by
in-place transformation rather than spawn+remove (rationale above). (2)
`lifeEvents` deferred to Step 13. (3) metabolism params live in a global
`config.metabolism` rather than per-species — Step 29 can move them into the
species schema (noted alongside the existing species-generalization note).

**Follow-on notes for later steps:** `edibleMass` + the `carcass` kind are the
seams Step 18 (decay/scavenging) builds on; the `lowEnergy` flag is what
Step 8's decision system reads to prioritize seeking food; Step 9 feeding will
raise `energy` (via `VegetationGrid.consumeAt`) so animals stop simply
starving.

---

## Step 7 — Local perception

**Status:** Done

### Objective

Give animals a bounded, local view (radius-limited via the spatial index) of
nearby vegetation biomass, water, obstacles, and animals — never global
world reads.

### Why this step comes now

Decisions (Step 8) require inputs. Perception must precede behavior and use
the spatial grid to stay sub-quadratic (invariant 17).

### Visible result

No direct visual yet; the inspector gains a concise "perceives: N food
cells, water at …, M animals nearby" summary for the selected entity.

### Existing code to retain or replace

Retain `SpatialGrid.queryRadius`. Add a transient perception component
rebuilt each tick.

### Dependencies

Steps 2, 3, 5, 6.

### Simulation changes

`PerceptionSystem` (phase `perception`, possibly staggered per species):
gather within `perceptionRadius` using the grid; summarize nearest
food/water/threat. Ownership: writes transient `perceived`; reads grids.

### Protocol changes

**Version bump.** Add an on-demand `entity.inspection` perception summary
(query response only — not in every snapshot, to bound size).

### Renderer changes

Inspector renders the perception summary when present. Optional debug
overlay of perceived cells (renderer-only highlight).

### Persistence and fixture changes

Transient — not persisted. Regenerate fixtures only if inspection sample
changes.

### Tests

Perception returns only in-radius entities; matches spatial-grid ground
truth; no global iteration (assert via a spy/among-N bound); determinism.

### Deterministic demonstration scenario

Seeded cluster; assert a focal animal perceives exactly the expected
neighbor ids and nearest-food cell.

### Performance considerations

Perception is a top hot path. Stagger by species; cap radius; reuse buffers.
Benchmark perception ms/tick.

### Acceptance criteria

- [x] Bounded local perception via spatial index (no global reads)
- [x] Perception summary inspectable
- [x] Tests pass
- [x] Visible result verified (inspector summary)
- [x] Documentation updated
- [x] Performance checked (perception ms/tick, staggering)

### Explicitly out of scope

Acting on perception (Step 8), memory (Step 15).

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.)

**What shipped.** Bounded local perception — the input layer decisions
(Step 8) will consume.

- **Simulation:** new `PerceptionSystem` (phase `perception`, before movement).
  Each living animal builds a summary within its species `perceptionRadius`:
  nearby animals (via `SpatialGrid.queryRadius` — sub-quadratic) and the
  nearest food cell (vegetation ≥ `foodMinLevel`), water cell, and obstacle
  (via a radius-bounded local cell scan — never a global read, invariant 17).
  Summaries live in a transient `world.perception` Map (keyed by entity id,
  cleared and rebuilt each tick, **never serialized** — derived state like the
  spatial grid). `perceptionRadius` added to the herbivore species (6);
  `config.perception` holds `defaultRadius`/`foodMinLevel`/`updateInterval`.
  Ownership: writes `world.perception`; reads grid/terrain/vegetation; no
  randomness.
- **Protocol (v5 → v6):** `getEntityDetails` (entity inspection) gains a
  `perception` summary — inspection-only, never in bulk snapshots, to bound
  size. Bulk snapshot/delta shapes unchanged.
- **Renderer:** the inspector renders a "Perceives" section (radius, animal
  count + nearest, nearest food/water/obstacle with distances).
  `SUPPORTED_PROTOCOL_VERSION` → 6.
- **Persistence:** unchanged (save v6) — perception is transient; verified no
  `perception`/`perceived` field appears in a captured save.

**Tests:** `npm test` → **146 passing / 0 failing** (was 137; +9). New
`test/perception.test.js`: perceives exactly the in-radius animals (nearest
first, excludes self, cross-checked against the spatial grid); carcasses not
counted; nearest food/water/obstacle match a manual neighborhood scan;
distant entities never perceived (locality); per-species radius overrides the
default; summaries are transient/not serialized; deterministic across two
runs; inspection exposes the summary. A test-authoring subtlety surfaced and
is handled: perception reflects the **pre-movement** position (it runs before
the movement phase), so the cross-check uses a perception-only engine with
stable positions.

**Visible result verified.** Live `GET /api/entities/1` returns a v6
perception summary (radius 6; nearest food at (127,98) level 1, dist 0.5; an
obstacle at dist 0.5); the bulk snapshot entity has no `perception` key
(bounded, as intended).

**Performance.** Perception is now the **dominant per-tick cost**: large-5k
**1.81 → 14.0 ms/tick** — the O(r²) per-animal cell scan (r=6 → 169 cells)
plus the grid neighbor query. Still far under the 1 s budget and ~linear in
animals (~70 ms extrapolated to 25k). Staggering via
`config.perception.updateInterval` was verified to cut cost proportionally
(interval 3 → ~2.6×, 5 → ~3.7×); the demo keeps interval 1 (8 animals,
0.022 ms/tick). BENCHMARK.md records this and the Step 30 options (ring-search
early termination, buffer reuse) if profiling later demands them.

**Deviations from the step spec (minor, documented):** (1) perception radius
is resolved per-species from the registry (`SPECIES[speciesId]`) rather than
stored on the entity, so no entity field / save-format change was needed. (2)
Staggering is exposed as a config knob (demonstrated) but the demo runs every
tick for freshness; per-species stagger intervals can come with Step 29.
Optional debug overlay of perceived cells was left to a later renderer pass.

**Follow-on notes for later steps:** Step 8's `DecisionSystem` (phase
`decision`, right after perception) reads `world.perception` to choose actions
and writes `moveIntent` toward `nearestFood`/away from threats; the
`lowEnergy` flag plus `nearestFood` are the core seek-food inputs. Step 15
(memory) will let animals remember food/water beyond the perception radius.

---

## Step 8 — Utility-based behavior

**Status:** Done

### Objective

Replace random wander with utility-based action selection: wander, seek food,
approach food, eat, rest, avoid blocked terrain — chosen from scored
candidates using perception inputs.

### Why this step comes now

Turns perception into visible purpose; prerequisite for real foraging (Step
9). Decision logic must live in the engine, never the renderer.

### Visible result

Animals visibly head toward food and pause to act rather than wandering
randomly; the inspector shows current action and the utility breakdown.

### Existing code to retain or replace

Replace random-wander selection in `MovementSystem` with intents produced by
a new decision system; movement executes the chosen intent.

### Dependencies

Step 7.

### Simulation changes

`DecisionSystem` (phase `decision`): score candidate actions from perception

- physiology using a `decision` RNG stream for tie-breaking/exploration;
  write `action`, `actionTarget`, `utilityBreakdown`. Ownership: writes intent
  fields; movement/feeding consume them.

### Protocol changes

**Version bump.** Add `action` to `PUBLIC_ENTITY_FIELDS`; expose
`utilityBreakdown` and `actionTarget` in `entity.inspection` (not bulk
snapshots).

### Renderer changes

Inspector renders current action + top utilities. Optional action glyph tint
(renderer-owned).

### Persistence and fixture changes

Persist `action`/`actionTarget` (bump save version). Regenerate fixtures.

### Tests

Deterministic action given fixed inputs; food nearby → seek/approach/eat
sequence; blocked terrain avoided; utilities sum/compare as specified.

### Deterministic demonstration scenario

Seeded animal + one food patch; assert action transitions
wander→seek→approach→eat by expected ticks.

### Performance considerations

Bounded candidate set per animal; no allocation per candidate. Benchmark
decision ms/tick.

### Acceptance criteria

- [x] Utility action selection replacing random movement
- [x] Action + utilities inspectable
- [x] Tests pass
- [x] Visible result verified (purposeful movement)
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Actual biomass consumption mechanics (Step 9), water (Step 10), predators.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.)

**What shipped.** Utility-based behavior replacing random wander — the
decision layer that turns perception into purpose.

- **Simulation:** new `DecisionSystem` (phase `decision`, after perception,
  before movement). Each animal scores a fixed candidate set — `eat`
  (on a food cell), `seekFood` (food perceived, head toward it; subsumes
  "approach"), `rest`, `wander` — from hunger (`1 - energy/maxEnergy`) and
  `world.perception`, then commits to the best (with a small `explorationRate`
  chance to wander regardless; ties broken by fixed order). It writes
  `action`, `actionTarget`, `utilityBreakdown`, and `moveIntent`
  (`{heading, ttl, moving}`). `MovementSystem` was restructured into a pure
  **executor** (id `movement.wander` → `movement.execute`): it no longer picks
  headings or draws RNG — it steps along the intent, applies the terrain
  modifier, refuses impassable cells, and on a block turns around and expires
  the commitment so decision re-commits. The committed-wander logic moved from
  movement into decision. `config.decision` holds the weights. Ownership:
  decision writes action/target/utilities/intent; movement writes
  position/heading/lastMoveDistance. Determinism: exactly two draws per animal
  per tick on the new `decision` stream (movement is now RNG-free).
- **Protocol (v6 → v7):** `action` added to `PUBLIC_ENTITY_FIELDS` (bulk);
  `actionTarget` and `utilityBreakdown` added to entity inspection
  (inspection-only).
- **Renderer:** inspector shows the current action plus a sorted "Decides"
  utility breakdown (chosen action marked) and the target cell.
  `SUPPORTED_PROTOCOL_VERSION` → 7.
- **Persistence (save v6 → v7):** `action`, `actionTarget`,
  `utilityBreakdown`, and `moveIntent.moving` persist; v6 saves invalidated.

**Tests:** `npm test` → **154 passing / 0 failing** (was 146; +8). New
`test/decision.test.js`: a hungry animal on food eats; a satiated one wanders
(and moves); utilities recorded with numeric scores; a controlled foraging
scenario shows purposeful seek/eat (not just wander); a seeking animal
net-approaches its target; determinism across two runs and under an unrelated
stream consumer (fixed two-draw budget); `action` is a public field while
utilities/target stay inspection-only.

**Visible result verified.** A controlled headless scenario (hungry animal on
bare ground with food a few cells away) shows the full transition
**seekFood → eat → wander → eat**. Live: `action` is a v7 snapshot field; the
inspector detail exposes `utilities = {eat 0.55, wander 0.35, rest 0.2,
seekFood 0}` with the chosen action and target. In the fully-vegetated demo
world, hungry animals are almost always already on food, so they choose `eat`
in place (≈11k occurrences over 1500 ticks) and full animals `wander` (≈870);
`seekFood` fires mainly at non-food cells (near water/rock).

**Performance.** large-5k **14.0 → 18.3 ms/tick** (+4; per-animal scoring),
perception still dominant, determinism OK. ~90 ms extrapolated to 25k animals,
well under the 1 s budget.

**Deviations from the step spec (minor, documented):** (1) `seekFood` subsumes
the plan's separate "approach food" — the mechanics are identical (move toward
food), so the extra label added no behavior; the scenario still shows
seek→eat. (2) `utilityBreakdown` is persisted on the entity (small object)
rather than kept in a transient map — simpler, one home; can move to transient
if 25k-animal save size ever matters. (3) The optional action glyph _tint_ was
left out (action is in the bulk snapshot, so a future renderer pass can add
it); the inspector shows action textually.

**Follow-on notes for later steps:** the `eat` action is the seam Step 9's
`FeedingSystem` acts on — it will consume biomass via
`VegetationGrid.consumeAt` and raise `energy`, at which point animals stop
starving, food patches deplete, and `seekFood`/`approach` become common
(depleted patches force travel). Step 10 adds a `seekWater`/`drink` action
alongside these; Step 16 predators add `flee`.

---

## Step 9 — Herbivory and resource competition

**Status:** Done

### Objective

Implement feeding: eating range, feeding duration, biomass removal, energy
gain, contention among animals for the same patch, depletion, and regrowth
interplay.

### Why this step comes now

Closes the herbivore survival loop (Milestone B): move → perceive → decide →
eat → gain energy → spend → die. First recognizable foraging behavior.

### Visible result

Herbivores graze patches down (biomass visibly drops), compete for rich
patches, and disperse as patches deplete; well-fed animals survive, others
starve.

### Existing code to retain or replace

Retain `VegetationGrid` and the eat action from Step 8. Add feeding
mechanics binding them.

### Dependencies

Steps 3, 6, 8.

### Simulation changes

`FeedingSystem` (phase `interaction`): validate range; consume biomass up to
an intake rate; convert to energy (efficiency ≤ 1); handle multiple eaters
per cell deterministically (ordered by id). Ownership: writes `energy`
(gain) and vegetation biomass (decrement); emits `entity.fed` event.

### Protocol changes

**Version bump.** Add `entity.fed{entityId, cell, amount}` domain event.

### Renderer changes

Event log formats feeding events; vegetation depletion already visible.

### Persistence and fixture changes

Regenerate fixtures; save version bump only if feeding adds persisted state.

### Tests

Biomass conservation (removed = gained/efficiency); range enforced;
contention deterministic; a fed animal's energy rises; regrowth refills over
time.

### Deterministic demonstration scenario

**Foraging sandbox** (one herbivore, one patch): assert energy rises then
plateaus as patch depletes. **Resource-competition sandbox** (several
herbivores, limited patches): assert some thrive and some starve — no
hard-coded balance.

### Performance considerations

Feeding touches cells + animals locally via the grid; no global scans.
Benchmark.

### Acceptance criteria

- [x] Feeding with depletion, energy gain, and contention
- [x] Recognizable foraging + competition emerges
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol version)
- [x] Performance checked

### Explicitly out of scope

Water, life stages, reproduction, predators.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.) **Closes the herbivore
survival loop** — move → perceive → decide → eat → gain energy → spend → live
or die (Milestone B's core; Step 10 hydration completes the milestone).

**What shipped.** Herbivory binding the eat action to real biomass
consumption.

- **Simulation:** new `FeedingSystem` (phase `interaction`, after movement,
  before metabolism). An animal whose action is `eat` removes up to
  `intakeRate` biomass from its cell via `VegetationGrid.consumeAt`,
  assimilates it to energy at `energyPerBiomass × efficiency` (clamped to
  `maxEnergy`, and capped by the energy deficit so it never overeats), and
  emits `entity.fed`. Multiple eaters on a cell contend **deterministically**:
  entities iterate in ascending id order, so the lower id eats first and later
  ones get the remainder. `config.feeding` holds the params. Ownership: writes
  `energy` (gain) and vegetation biomass (decrement). No randomness, no global
  scans.
- **Protocol (v7 → v8):** new `entity.fed{entityId, cell, amount}` domain
  event. Snapshot/entity shapes unchanged.
- **Renderer:** the event log formats `entity.fed` (cyan) and folds it into
  the "show routine (moves, feeding)" toggle so it doesn't flood the default
  view. Vegetation depletion was already visible (Step 3 deltas).
  `SUPPORTED_PROTOCOL_VERSION` → 8.
- **Persistence:** unchanged (save v7) — feeding writes existing state
  (`energy`, biomass); no new persisted fields.

**Tests:** `npm test` → **163 passing / 0 failing** (was 154; +9). New
`test/feeding.test.js`: intake/energy conversion (`gain = removed ×
energyPerBiomass × efficiency`), deficit-capped intake (never overeats),
only `eat`-action animals feed, `entity.fed` emitted with cell + amount,
grazing depletes a cell and regrowth refills it, deterministic contention
(lower id feeds first), and demo integration (animals survive; deterministic).
Updated the determinism benchmark (demo animals now **survive**, 8 living / 0
carcasses after 5000 ticks), the metabolism demo-integration test (survival,
not starvation — carcass creation stays covered by the metabolism unit
tests), and the protocol delta test (added a controlled metabolism-only
starvation to keep carcass-kind-change delta coverage, since the demo no
longer starves).

**Visible result verified.** Live over WebSocket: `entity.fed` events flow
(v8), vegetation deltas show grazed cells depleting and regrowing (9 of 25
ticks changed), and all 8 demo animals survive at ~87% energy. Competition
emerges without hard-coded balance: 40 animals crowded into a 32×32 world →
37 survive, 3 starve, vs all 8 surviving in the abundant demo. Controlled
foraging (Step 8) already showed seek→eat; feeding makes the eat actually
sustain the animal.

**Performance.** large-5k **18.3 → 20.2 ms/tick** (+2; per-eater consume +
conversion, local). Perception still dominant. `entity.fed` adds event volume
(one per eater per feeding tick), bounded by the event buffer.

**Deviations from the step spec:** none of substance. Chose in-cell feeding
(the animal eats the cell it stands on) rather than an eating _range_ — the
decision system already only chooses `eat` when standing on food, so a
separate range check would be redundant; "feeding duration" emerges naturally
(an animal eats until satiated at ~85% energy, when wander utility overtakes
eat, or until the cell is depleted).

**Follow-on notes for later steps:** the survival loop is closed, so demo
populations are now stable (8 animals) rather than dying out — the substrate
for reproduction (Step 12) to grow populations. Step 10 adds
`seekWater`/`drink` alongside feeding to finish Milestone B. `entity.fed` +
the biomass-depletion dynamics are what make `seekFood`/`approach` common once
patches are grazed down (visible in the resource-competition sandbox).

---

## Step 10 — Hydration and water seeking

**Status:** Done

### Objective

Add hydration/thirst and drinking **only** if water yields distinct behavior
beyond food seeking: hydration pool, dehydration over time, drink at water
cells, water-seeking utility.

### Why this step comes now

Adds a second, spatially different need (water is terrain-bound from Step 2),
enriching decisions before life cycle complexity. Deferrable if it does not
add visible behavior.

### Visible result

Thirsty animals visibly divert to water cells to drink, distinct from
grazing routes.

### Existing code to retain or replace

Retain terrain water cells and the decision system; add a hydration
component and a drink action.

### Dependencies

Steps 2, 8.

### Simulation changes

`HydrationSystem` (phase `physiology`): dehydrate per tick; drink at water;
severe dehydration damages health. Add water-seeking utility to
`DecisionSystem`. Ownership: writes `hydration`.

### Protocol changes

**Version bump.** Add `hydrationFraction` to projection; drinking event
optional.

### Renderer changes

Inspector shows hydration; optional thirst indicator.

### Persistence and fixture changes

Save version bump (`hydration`). Regenerate fixtures.

### Tests

Dehydration monotonic without water; drinking restores; thirst overrides
mild hunger at thresholds; determinism.

### Deterministic demonstration scenario

Seeded animal far from water; assert it seeks water at the thirst threshold
and its hydration recovers.

### Performance considerations

Negligible; one more per-animal scalar.

### Acceptance criteria

- [x] Hydration need with distinct water-seeking behavior
- [x] Inspectable hydration
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Detailed hydrology, moisture diffusion, water depth.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.) **Completes Milestone B**
(self-sustaining herbivore loop, Steps 5–10). Judged worth implementing (the
step is conditional): water is one lake while food covers the ground, so
seeking water is a genuinely distinct, spatially separate behaviour.

**What shipped.** A second need — hydration — parallel to energy.

- **Simulation:** new `HydrationSystem` (phase `physiology`, alongside
  metabolism). Every living animal dehydrates by `dehydrationRate`/tick; one
  that chose `drink` within `drinkRange` of a water cell restores hydration
  (net gain); sustained zero hydration damages `health` and, when health is
  exhausted, kills (cause `dehydration`). `DecisionSystem` gained two actions —
  `drink` (at water, stationary) and `seekWater` (head toward perceived
  water) — scored from thirst with the same weight as hunger, so **thirst
  competes with hunger** (whichever need is greater wins). Reuses perception's
  `nearestWater`. New entity fields `hydration`/`maxHydration`; species gained
  `maxHydration`; `config.hydration` + thirst weights in `config.decision`.
  Ownership: hydration writes `hydration` and (on severe dehydration) `health`.
- **Shared kill helper:** extracted `systems/death.js` `killAnimal(...)` — the
  carcass transformation + `entity.died` — now used by both metabolism
  (starvation) and hydration (dehydration), removing duplication (a named
  risk) and giving predation/injury a ready seam.
- **Protocol (v8 → v9):** `hydrationFraction` added to
  `PUBLIC_ENTITY_FIELDS`; absolute `hydration`/`maxHydration` in inspection;
  spawn validation for the new fields; `dehydration` is a new `entity.died`
  cause. (The optional drinking event was skipped — `action='drink'` is
  already a public field and `hydrationFraction` shows recovery.)
- **Renderer:** inspector shows hydration % (warn-tinted when low).
  `SUPPORTED_PROTOCOL_VERSION` → 9.
- **Persistence (save v7 → v8):** `hydration`/`maxHydration` round-trip; v7
  saves invalidated.

**Tests:** `npm test` → **171 passing / 0 failing** (was 163; +8). New
`test/hydration.test.js`: exact per-tick dehydration, monotonic without water,
dehydration→health-damage→carcass (cause `dehydration`), drinking near water
raises hydration, thirst beats mild hunger at water (utility ordering),
`hydrationFraction` public / absolute inspection-only, determinism + save
round-trip, and demo integration (animals both drink and seek water, most
surviving).

**Visible result verified.** A controlled thirsty animal (hydration 15) at the
lake edge drank up to 90 then resumed eating/wandering; demo runs show
drinking and water-seeking as recurring distinct behaviours (aggregate
sweep: hundreds of drink-ticks, dozens of seek-water-ticks). Live: v9
snapshot carries `hydrationFraction`; inspection exposes absolute hydration
and the drink/seekWater utilities; validation rejects `maxHydration: 0`.

**Performance.** large-5k **20.2 → 20.9 ms/tick** (+0.7 — negligible, as the
plan predicted; one scalar + reuse of perceived water).

**Tuning note (no hard-coded balance, but a deliberate default).** With one
lake and no water memory yet (Step 15), a fast dehydration rate collapsed the
demo (animals wander far, can't perceive the lake, die of thirst — 2–6 of 8).
I swept the rate and set `dehydrationRate: 0.02`, which keeps ~7–8 of 8 alive
while thirst still visibly diverts animals to water. This is a parameter
choice, not an enforced outcome — thirst deaths still emerge, and crowded/
low-water scenarios still kill. Step 15 (remembering water locations) is the
real fix for animals stranded far from the lake.

**Deviations from the step spec (minor):** (1) drinking lives in
`HydrationSystem` (physiology), as the plan specifies, rather than a separate
interaction-phase system like feeding — a slight asymmetry, documented. (2)
The optional drink event was skipped (redundant with the public `action`
field). (3) Extracted the shared `killAnimal` helper (an improvement beyond
the step, reducing duplication).

**Follow-on notes:** Milestone B is complete — the herbivore survives on two
renewable needs with emergent competition and thirst pressure. Step 11 (aging

- life stages) begins Milestone C; the `health` field (now written by
  dehydration) and the `killAnimal`/`health<=0` path are the seams Step 17
  (injury) and Step 16 (predation) build on. Step 15 memory will let animals
  remember food/water beyond perception.

---

## Step 11 — Aging and life stages

**Status:** Done

### Objective

Add life stages (juvenile, subadult, reproductive adult, senescent), growth
of body mass toward adult size, maturity gating, age-related decline, and
probabilistic late-life mortality.

### Why this step comes now

Reproduction (Step 12) needs maturity; growth needs to precede offspring
(Step 13). Splits aging out of the retired demo lifecycle.

### Visible result

Animals visibly grow (mass/inspector), transition stages, and old animals
die of age; the inspector shows life stage and age.

### Existing code to retain or replace

Fully retire the demo `LifecycleSystem` (energy already moved to Step 6);
replace with an aging/growth system.

### Dependencies

Steps 4, 6.

### Simulation changes

`AgingSystem` (phase `lifecycle`): increment age; grow mass by stage curve;
set `lifeStage`; apply senescent decline; roll late-life mortality from an
`aging` RNG stream → `entity.died{cause:'age'}`. Ownership: writes
`age, bodyMass, lifeStage`.

### Protocol changes

**Version bump.** Add `lifeStage` to projection.

### Renderer changes

Inspector shows life stage; optional glyph case/tint by stage
(renderer-owned).

### Persistence and fixture changes

Save version bump (`lifeStage, birthTick`). Regenerate fixtures.

### Tests

Stage thresholds deterministic; mass growth curve; senescent mortality
probability bounded; determinism.

### Deterministic demonstration scenario

Accelerated-age seeded animal; assert stage transitions at expected ages and
eventual age death.

### Performance considerations

Per-animal; stagger aging updates (e.g. every N ticks) since it changes
slowly.

### Acceptance criteria

- [x] Life stages + growth + age mortality
- [x] Stage/age inspectable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (staggering)

### Explicitly out of scope

Reproduction, parenting, inherited traits.

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.) Begins **Milestone C**
(complete herbivore life cycle).

**What shipped.** Aging, growth, life stages, and death of old age, replacing
the demo lifecycle scaffolding.

- **Simulation:** new `AgingSystem` (phase `lifecycle`) — increments age,
  grows `bodyMass` along a linear stage curve (`birthMass` → adult mass over
  `maturityAge`), assigns `lifeStage` (juvenile → subadult → adult →
  senescent), and rolls a per-tick death probability that ramps through
  senescence (cause `age`, certain by `maxAge`). Exports `bodyMassForAge` /
  `lifeStageForAge` helpers (reused by the demo spawn). `config.aging` holds
  the curve; adult mass comes from the species. The scaffolding
  `LifecycleSystem` was **deleted**. Ownership: writes `age`, `bodyMass`,
  `lifeStage`, and kills via the shared `killAnimal` helper. One `aging`-stream
  draw per animal per update (fixed budget → deterministic).
- **Demo:** initial animals spawn with a spread of ages (from a dedicated
  `demogen.age` stream, so positions are unchanged) and matching growth-curve
  mass/stage — a mix of stages at t=0, avoiding a fully synchronized cohort.
- **Protocol (v9 → v10):** `lifeStage` added to `PUBLIC_ENTITY_FIELDS`.
- **Renderer:** inspector shows life stage. `SUPPORTED_PROTOCOL_VERSION` → 10.
- **Persistence (save v8 → v9):** `lifeStage` field + the system-descriptor
  change (`LifecycleSystem` → `AgingSystem`) invalidate v8 saves.

**Tests:** `npm test` → **182 passing / 0 failing** (was 171; +11). New
`test/aging.test.js`: growth-curve and stage-threshold helpers, growth over
time, stage transitions at thresholds, senescent-only age mortality with
`entity.died{cause:'age'}` carcass, certain death at `maxAge`, bounded
mortality probability, `lifeStage` public projection, determinism across
7000-tick runs (incl. age deaths), the demo showing all four stages + age
deaths, and staggering (age increments by `updateInterval`). Updated the
determinism benchmark (assert `entityCount === animalCount`, robust to how
many have died — carcasses persist), the species test (demo mass now follows
the growth curve, not fixed adult mass), and the hydration demo test (seed
that exercises seek-water).

**Visible result verified.** Live: v10 snapshot carries `lifeStage` with a
mix (juvenile/subadult/adult) and matching masses (juveniles ~11–18 kg, adults
30); inspection shows stage + age + growing mass. Over a run: masses grow
(t=0 spread 5–30 → t=1000 all 30), all four stages appear, and age deaths fire
(first at tick ~4819, cause `age`).

**Performance.** large-5k unchanged (~20.9 ms/tick) — per-animal scalar
arithmetic + one draw. `AgingSystem` supports `updateInterval` staggering
(tested), but the cost is negligible so the demo runs it every tick for exact
ages.

**Deviations from the step spec (minor):** (1) age is a stored, per-tick-
incremented field (not derived from a `birthTick`) with `updateInterval 1` in
the demo, keeping ages exact and tests simple; the plan's suggested staggering
is supported and tested but unused (negligible cost). (2) Life-curve params
live in a global `config.aging` (like metabolism/hydration), with adult mass
from the species — Step 29 can move the rest per-species.

**Follow-on notes for later steps:** without reproduction the demo population
ages and dies out by ~9000 ticks — Step 12 (reproduction, gated on the
`adult` stage) renews it and staggers generations. Growth means juveniles are
cheaper metabolically; parenting (Step 13) will use `lifeStage` for dependency
and dispersal, and genetics (Step 20) will make growth/lifespan heritable.

---

## Step 12 — Basic reproduction

**Status:** Done

### Objective

Add reproductive maturity, reproductive condition (energy-gated), mate
seeking, mating, reproductive energy cost, gestation/delayed birth, birth,
and parent-id linkage. No guaranteed replacement rate.

### Why this step comes now

First population-renewal mechanism; must follow life stages and precede
genetics (heredity attaches to birth in Step 20).

### Visible result

Mature, well-fed animals pair, and new juveniles appear after gestation; the
event log shows mating and birth; offspring reference parents.

### Existing code to retain or replace

Retain spawn/deferred-create path; add reproduction as its own system.

### Dependencies

Steps 6, 9, 11.

### Simulation changes

`ReproductionSystem` (phase `interaction`): find mate via grid within range;
gate on stage + energy; deduct reproductive cost; set `gestationUntil`; on
term, deferred-spawn offspring with `parents:[a,b]`, birth position near
parent; emit `entity.mated`, `entity.born`. Ownership: writes reproductive
fields; creates entities at boundary.

### Protocol changes

**Version bump.** Add `entity.mated`, `entity.born` events; add
`parents`/`reproState` to inspection (not bulk snapshot).

### Renderer changes

Event log formats mating/birth; inspector shows parents + repro state.

### Persistence and fixture changes

Save version bump (repro fields, parent refs). Regenerate fixtures.

### Tests

Maturity/energy gating; gestation timing exact; offspring parent refs valid
(invariant: parentage references remain valid); reproductive cost applied;
determinism.

### Deterministic demonstration scenario

Seeded pair, fed; assert mating then birth at expected tick with valid
parent ids.

### Performance considerations

Mate search via grid only (invariant 17). Benchmark with dense populations.

### Acceptance criteria

- [x] Energy-gated mating, gestation, birth, parent linkage
- [x] No hard-coded replacement rate
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Parenting/dependency (Step 13), mate choice (Step 22), genetics (Step 20).

### Completion notes

**Status: Done.** (Node v23.4.0, darwin arm64.) The demo population is now
**multi-generational and self-sustaining**.

**What shipped.** Reproduction — the first population-renewal mechanism.

- **Simulation:** new `ReproductionSystem` (phase `interaction`, priority 10 —
  after feeding). Two adult conspecifics within `matingRange`, both well fed,
  not gestating, and off cooldown pair up; both pay a mating cost, and the
  initiator (deterministically the lower entity id, since entities iterate in
  ascending id order) sets `gestationUntil`. At term it deferred-spawns a
  juvenile just behind the parent (falling back to the parent's own passable
  cell), carrying `parents: [a, b]`, and pays a birth cost. Emits
  `entity.mated` and `entity.born`. Mate search is grid-local
  (`queryRadius`) — never a global pairwise scan (invariant 17). No randomness:
  timing follows from encounters plus fixed gestation.
- **Shared rule:** `isReproductivelyReady(entity, tick, params)` is exported
  from the reproduction system and used by **both** it and the decision system,
  so the eligibility rule can't drift.
- **Behaviour:** new `seekMate` action — a ready adult that perceives a
  conspecific heads toward it (perception's `nearestAnimal` now carries
  `speciesId` and position). Pairing itself remains the reproduction system's
  call, so behaviour and biology stay separated.
- **Protocol (v10 → v11):** `entity.mated` / `entity.born` events; `parents`
  and `reproState` added to inspection (not bulk snapshots).
- **Renderer:** event log formats mating/birth (pink); inspector shows parents
  and gestation/last-mated. `SUPPORTED_PROTOCOL_VERSION` → 11.
- **Persistence (save v9 → v10):** the four reproductive fields + the new
  system descriptor; v9 saves invalidated.

**Tests:** `npm test` → **193 passing / 0 failing** (was 182; +11). New
`test/reproduction.test.js`: mating pays costs and sets cooldown/gestation on
the initiator; maturity gate (juveniles/subadults never mate); energy gate;
range gate; cooldown blocks re-mating; the shared readiness predicate; birth
**exactly** at term with valid parent ids, juvenile stage, birth mass/energy,
and the birth cost applied; newborn placed on passable terrain near the parent;
demo births with no dangling parent references; determinism; inspection
exposes parents/reproState. Updated the determinism benchmark assertion
(entity count now only grows).

**Visible result verified.** Live over WebSocket: v11 `entity.mated` and
`entity.born` events flow (`{entityId: 9, parents: [3, 6]}` at tick 843) and
the renderer's entity count grows; inspection shows a gestating animal
(`gestationUntil: 1557`, `lastMatedTick: 757`). Over 15 000 demo ticks: 31
births vs 16 age deaths, population 8 → 13 → 14 → 13 → 12, all four life
stages continuously present.

**Performance.** large-5k **20.9 → 35.3 ms/tick** — the per-entity cost is
essentially unchanged; the rise is because the population *grows* during the
benchmark (large-5k ends at ~7.3k entities rather than 5k). Mate search is
grid-local.

**Tuning note (parameters, not a cap — and an honest finding).** The first
parameter set was far too cheap: the population grew exponentially (8 → 1037
by tick 20 000, and in a small world 6 → 186 with vegetation barely dented and
*zero* starvation — food never became limiting). That is the risk register's
"population explosion" materialising. I did **not** add a carrying cap;
instead I made reproduction genuinely costly and slow (37 energy per offspring,
80 %-full gate, ~2600-tick inter-birth interval against a ~5000-tick adult
life). The result is an emergent near-balance (births ≈ age deaths). This is a
cost parameterisation, not an enforced outcome — and it is worth stating
plainly that an unchecked herbivore *should* grow until something limits it;
the real ecological checks are predation (Step 16) and disease (Step 25).

**Deviations from the step spec (minor):** (1) no sexes — either adult can
initiate and the lower id gestates; sexes/mate choice belong to Step 22.
(2) "Mate seeking" is implemented as a `seekMate` action that steers toward a
perceived conspecific; assessing *whether* that individual is a desirable mate
is Step 22.

**Follow-on notes:** `parents` is the seam Step 13 (parenting: juvenile
dependency, following, provisioning, dispersal) and Step 21 (lineages) build
on; Step 20 attaches heredity at birth (the offspring-construction site in
`#births` is where genomes will combine). Parent refs stay valid because
entities are never removed — if removal is ever introduced (Step 18 carcass
decay), lineage refs will need care.

---

## Step 13 — Offspring and parenting

**Status:** Not started

**Carried forward (see §1.4):** **A4** — the bounded per-entity `lifeEvents`
list was deferred from Step 6 and is due here (this step's "life-history
entries"). **⚠ C1** — entity spawning still ignores terrain (animals can spawn
on rock); births already place newborns on passable cells, so folding the same
check into the founding spawn is a small, natural fix to do here or earlier.

### Objective

One coherent parenting strategy for the herbivore: juvenile dependency,
parent following, provisioning/nursing if appropriate, some protection, and
dispersal at maturity — with visible relationships and life-history entries.

### Why this step comes now

Completes the herbivore life cycle (Milestone C): born → grow → parented →
mature → reproduce → age → die.

### Visible result

Juveniles visibly follow a parent and disperse when mature; inspector shows
parent/offspring links and life events (born, weaned, dispersed).

### Existing code to retain or replace

Retain relationships fields from Step 12; add parenting behavior + bounded
`lifeEvents`.

### Dependencies

Steps 11, 12.

### Simulation changes

`ParentingSystem` (phase `decision`/`interaction`): juvenile follow utility
toward parent; provisioning energy transfer; dispersal at maturity clears
the link. Ownership: writes `offspring`/`parents` (sparse), `lifeEvents`
(bounded).

### Protocol changes

**Version bump.** Add `entity.lifeEvent` (or fold into inspection); expose
offspring list + recent life events in inspection.

### Renderer changes

Inspector renders parent/offspring + life-event timeline; optional
follow-link highlight (renderer-only).

### Persistence and fixture changes

Save version bump (bounded life events, relationship refs). Regenerate
fixtures.

### Tests

Juveniles stay near parent within tolerance; provisioning transfers energy;
dispersal at maturity; relationship refs stay valid on death; determinism.

### Deterministic demonstration scenario

**Life-cycle sandbox** (accelerated): assert a lineage born → grows →
disperses → reproduces within the run, with valid refs throughout.

### Performance considerations

Sparse relationships only — no global matrices (risk register). Bounded life
events (observation roadmap).

### Acceptance criteria

- [ ] Coherent parenting + dispersal with valid relationships
- [ ] Life cycle observable end-to-end
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked (sparse relationships)

### Explicitly out of scope

Genetics, social groups beyond parent-offspring, predators.

### Completion notes

_(fill on completion)_

---

## Step 14 — Stable individual variation (non-inherited)

**Status:** Not started

### Objective

Give each individual fixed non-inherited variation (body size, speed,
metabolic efficiency, boldness, caution, exploration, reproductive
investment), each with an observable or survival consequence.

### Why this step comes now

Establishes the phenotype seam and per-individual trait effects **before**
inheritance (Step 20), so genetics only has to make these heritable, not
introduce them.

### Visible result

Animals visibly differ (e.g. faster/bolder foragers reach food first);
inspector shows a trait panel.

### Existing code to retain or replace

Retain species defaults; add a per-entity `traits` object sampled at birth
from a `traits` RNG stream around species means.

### Dependencies

Steps 5–9 (traits modulate existing systems).

### Simulation changes

Traits sampled at creation; existing systems read trait multipliers (speed,
efficiency, decision weights). Ownership: `traits` written once at birth;
read-only after.

### Protocol changes

**Version bump.** Expose trait values in inspection (not bulk snapshot).

### Renderer changes

Inspector trait panel.

### Persistence and fixture changes

Save version bump (`traits`). Regenerate fixtures.

### Tests

Traits deterministic per seed; trait extremes change outcomes (fast animal
reaches food first in a controlled scenario); determinism.

### Deterministic demonstration scenario

Two animals, differing speed traits, one food patch; assert the faster
reaches/eats first deterministically.

### Performance considerations

Precompute trait-derived multipliers to avoid per-tick recomputation.

### Acceptance criteria

- [ ] Per-individual traits with survival/behavior consequences
- [ ] Traits inspectable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Inheritance (Step 20), mate choice on traits (Step 22).

### Completion notes

_(fill on completion)_

---

## Step 15 — Memory and elementary learning

**Status:** Not started

**Carried forward (see §1.4):** **C4** — with one lake and no memory, animals
that wander far from water die of thirst; `dehydrationRate` was tuned down to
0.02 to keep the demo viable. Remembering water locations is the real fix, so
this step should re-check that dehydration rate afterwards (it can likely go
back up, restoring visible thirst pressure).

### Objective

Add bounded, decaying memories: food locations, water locations, dangerous
locations, failed searches, and kin identity — surfaced in inspection.

### Why this step comes now

Improves foraging/avoidance realism and is a prerequisite for territory
(Step 24) and migration (Step 26). Precedes advanced social behavior.

### Visible result

Animals revisit remembered food/water and avoid remembered danger; inspector
lists salient memories that fade over time.

### Existing code to retain or replace

Retain perception; memories are written from perception/events and read by
decision.

### Dependencies

Steps 7, 8.

### Simulation changes

`MemorySystem` (phase `perception`/`observation`): insert/refresh bounded
memories; decay/evict oldest; feed decision utilities. Ownership: writes
bounded `memories[]`.

### Protocol changes

**Version bump.** Expose top memories in inspection.

### Renderer changes

Inspector memory list; optional remembered-cell overlay (renderer-only).

### Persistence and fixture changes

Save version bump (bounded memories). Regenerate fixtures.

### Tests

Memory capacity bounded; decay/eviction deterministic; remembered food
biases return; determinism.

### Deterministic demonstration scenario

Animal finds a patch, leaves, returns using memory; assert the return path
is memory-driven (disable perception range to prove it).

### Performance considerations

Hard cap per animal; O(1) insert/evict. Bounded memory (risk register).

### Acceptance criteria

- [ ] Bounded, decaying memories influencing behavior
- [ ] Memories inspectable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked (bounded memory)

### Explicitly out of scope

Predators, social learning, territories.

### Completion notes

_(fill on completion)_

---

## Step 16 — First predator species

**Status:** Not started

### Objective

Add one configured predator with a full hunt pipeline: detect → evaluate →
approach → chase → capture-or-escape → feed → recover. Predation is never a
single opaque random roll.

### Why this step comes now

Milestone D. Requires stable herbivore survival (Steps 5–15) so prey behave
believably under pressure.

### Visible result

Predators visibly stalk and chase; prey flee; hunts visibly succeed or fail;
successful hunts leave a carcass the predator feeds on.

### Existing code to retain or replace

Reuse perception, decision, movement, feeding, carcass. Add predator config

- hunt/flee behaviors; extend prey decision with flee.

### Dependencies

Steps 7–9, 14, 15.

### Simulation changes

`HuntingSystem` + flee utility: predator hunger drives prey selection;
pursuit dynamics (speed/stamina/traits); capture probability from relative
state (not a flat roll); on capture → prey death + carcass; failed hunts
cost energy. Ownership: predator intent + prey `alive`; emits
`entity.hunted`, `entity.escaped`, `entity.killed`.

### Protocol changes

**Version bump.** Add predation/escape events; `action` covers hunt/flee.

### Renderer changes

Event log formats hunt outcomes; optional chase highlight (renderer-only).

### Persistence and fixture changes

Save version bump (predator state). Regenerate fixtures.

### Tests

Detection via grid only; capture depends on relative speed/stamina (fast
prey escape more); failed hunts cost energy; carcass on kill; determinism.

### Deterministic demonstration scenario

**Predation sandbox**: predator + prey, fixed seed; assert pursuit, at least
one failed and one successful hunt across variants, and carcass feeding.

### Performance considerations

Prey search via grid; cap pursuit targets. Benchmark with mixed populations.

### Acceptance criteria

- [ ] Multi-stage hunt with real capture/escape dynamics
- [ ] Visible pursuit, flee, success and failure
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Injury system (Step 17), scavenging mechanics (Step 18), pack hunting
(Step 23).

### Completion notes

_(fill on completion)_

---

## Step 17 — Injury and healing

**Status:** Not started

### Objective

Add nonfatal injuries (from failed captures, fights, hazards) with movement
and feeding penalties, healing over time at an energy cost, fatal injuries,
and injury life-history events.

### Why this step comes now

Makes predation consequential without instant death and adds survival
texture; builds on hunting outcomes.

### Visible result

Injured animals visibly slow/limp (reduced speed) and recover or die;
inspector shows injuries and healing progress.

### Existing code to retain or replace

Retain health from Step 4; add an injuries list and healing dynamics.

### Dependencies

Steps 6, 16.

### Simulation changes

`InjurySystem` (phase `physiology`): apply injury on qualifying events;
penalties to speed/feeding; heal over time consuming energy; severe injury →
death. Ownership: writes `injuries[]`, modifies `health`.

### Protocol changes

**Version bump.** Add injury events + injury summary in inspection;
`healthFraction` already projected.

### Renderer changes

Inspector injury panel; optional injured tint (renderer-only).

### Persistence and fixture changes

Save version bump (`injuries`). Regenerate fixtures.

### Tests

Injury applies penalties; healing consumes energy and clears over time;
fatal injury kills; determinism.

### Deterministic demonstration scenario

Animal takes a nonfatal injury; assert slowed movement then recovery by an
expected tick.

### Performance considerations

Bounded injuries per animal; negligible.

### Acceptance criteria

- [ ] Nonfatal + fatal injuries with penalties and healing
- [ ] Injuries inspectable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Disease (Step 25).

### Completion notes

_(fill on completion)_

---

## Step 18 — Carcasses and scavenging

**Status:** Not started

**Carried forward (see §1.4):** **⚠ C2 — this step breaks a standing
assumption.** Nothing has ever been removed from the world, so `parents` ids
(Step 12) and any lineage reference are trivially valid. "Eventual
disappearance" of carcasses introduces the first real removal. Before removing
anything, decide the policy: keep a lightweight tombstone / lineage record, or
allow dangling ids and make every consumer null-tolerant. The invariant
"parentage references remain valid" is asserted in
`test/reproduction.test.js` and must not silently start passing vacuously.

### Objective

Make carcasses a real resource: edible mass, consumption by scavengers/
predators, decay stages, scavenger attraction, eventual disappearance, and
optional local vegetation boost.

### Why this step comes now

Completes the death→nutrient loop opened at Step 6; enriches predator/omnivore
diets. Milestone D depth.

### Visible result

Carcasses visibly attract scavengers, shrink as eaten, pass through decay
glyphs/stages, and vanish; nearby vegetation may green up afterward.

### Existing code to retain or replace

Replace Step 6's minimal carcass with staged decay + feeding integration.

### Dependencies

Steps 6, 9, 16.

### Simulation changes

`CarcassSystem` (phase `environment`/`physiology`): decrement edible mass on
feeding; advance decay stages over time; remove when depleted/fully decayed;
optional biomass bump to underlying cell. Ownership: writes carcass state +
vegetation cell.

### Protocol changes

**Version bump.** Carcass decay stage + edible mass in projection/inspection.

### Renderer changes

Decay-stage glyph/color ramp (renderer-owned); scavenging events in log.

### Persistence and fixture changes

Save version bump (carcass stages). Regenerate fixtures.

### Tests

Edible mass conserved on feeding; decay stage progression deterministic;
removal timing; optional vegetation boost applied once; determinism.

### Deterministic demonstration scenario

Carcass + scavenger; assert consumption reduces mass, decay advances, and it
disappears by an expected tick.

### Performance considerations

Carcasses are few; decay staggered. Negligible.

### Acceptance criteria

- [ ] Carcass edible mass, decay stages, scavenging, disappearance
- [ ] Visible scavenging + decay
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Decomposition chemistry, microbes, insects.

### Completion notes

_(fill on completion)_

---

## Step 19 — Weather and seasons

**Status:** Not started

### Objective

Add visible environmental cycling: temperature, rain, drought, seasonal
vegetation-growth modulation, heat/cold stress, optional snow, and
shelter-seeking where useful.

### Why this step comes now

Introduces a shared environmental pressure that drives selection (Step 21)
and migration (Step 26); affects vegetation (Step 3) and physiology.

### Visible result

Seasons visibly change vegetation density and animal behavior (shelter/
cluster in extremes); status bar shows season/weather.

### Existing code to retain or replace

Retain vegetation suitability inputs (Step 3); now driven by weather/season
rather than static.

### Dependencies

Steps 3, 6.

### Simulation changes

`WeatherSystem` (phase `environment`): seasonal cycle + stochastic weather
from a `weather` RNG stream; modulate vegetation growth and thermal stress;
optional shelter utility. Ownership: writes global `environment` state +
reads terrain.

### Protocol changes

**Version bump.** Add `environment{season, temperature, weather}` to
snapshot metadata; weather-change events.

### Renderer changes

Status bar shows season/weather/temperature; optional palette shift within
Dracula tokens (renderer-owned).

### Persistence and fixture changes

Save version bump (environment + weather RNG). Regenerate fixtures.

### Tests

Seasonal cycle deterministic; vegetation responds to season; thermal stress
at extremes; determinism.

### Deterministic demonstration scenario

Run across a full year (accelerated); assert vegetation peaks/troughs by
season and stress events in extremes.

### Performance considerations

Global scalars + vegetation modulation (already staggered). Cheap.

### Acceptance criteria

- [ ] Seasons/weather with visible vegetation + behavior effects
- [ ] Environment inspectable in status
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Atmospheric simulation, wind fields, precise climate.

### Completion notes

_(fill on completion)_

---

## Step 20 — Genetics and inherited quantitative traits

**Status:** Not started

### Objective

Make selected Step-14 traits heritable: parental contribution, recombination,
mutation, genotype→phenotype mapping, developmental influence, and trait
tradeoffs. Quantitative traits only — no DNA sequences.

### Why this step comes now

Milestone E. Requires working reproduction (Step 12) and an existing
phenotype seam (Step 14); heredity only makes those traits transmissible.

### Visible result

Offspring visibly resemble parents in traits (speed/size/boldness);
inspector shows genotype vs. phenotype and parent trait values.

### Existing code to retain or replace

Retain `traits` (Step 14) as phenotype; add a `genome` and inheritance at
birth replacing random-around-species sampling.

### Dependencies

Steps 12, 14.

### Simulation changes

`GeneticsSystem` at birth (in reproduction/`interaction`): combine parent
genomes, recombine, mutate via a `genetics` RNG stream, express phenotype
with tradeoffs. Ownership: `genome` written once at birth; phenotype derived.

### Protocol changes

**Version bump.** Expose genotype/phenotype + parent trait values in
inspection.

### Renderer changes

Inspector genetics panel (parent vs. offspring).

### Persistence and fixture changes

Save version bump (`genome`). Regenerate fixtures.

### Tests

Offspring traits within parental+mutation envelope; mutation rate bounded;
tradeoffs enforced; determinism (same parents+seed → same child).

### Deterministic demonstration scenario

**Inheritance sandbox** (short generations): assert parent-offspring trait
correlation across a lineage — qualitative resemblance, not exact equality.

### Performance considerations

Genetics only at birth; cheap. Genome size bounded.

### Acceptance criteria

- [ ] Heritable quantitative traits with recombination + mutation
- [ ] Visible parent-offspring resemblance
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Nucleotide sequences, epistasis networks, sexual selection (Step 22).

### Completion notes

_(fill on completion)_

---

## Step 21 — Evolutionary observation

**Status:** Not started

### Objective

Add population/evolution observability: trait distributions, reproductive
success, lineages, generation counts, bottlenecks, selection differentials,
and trait change over time — selection emerging from survival/reproduction,
never scripted.

### Why this step comes now

Makes Milestone E legible; needs heredity (Step 20). Pure observability plus
metrics — no new organism behavior.

### Visible result

A metrics/summary panel shows trait histograms and generation stats shifting
over a run; the story of selection becomes visible.

### Existing code to retain or replace

Retain genetics/lineage refs; add aggregation + a metrics query.

### Dependencies

Step 20.

### Simulation changes

`MetricsSystem` (phase `observation`, staggered): aggregate population trait
distributions, birth/death rates, generation counts, reproductive success.
Ownership: writes derived metrics only (no organism state).

### Protocol changes

**Version bump.** Add a `metrics` query/snapshot section (aggregated only —
no per-organism histories; observation roadmap).

### Renderer changes

Metrics panel (histograms/counters) — presentation only, no ecological
computation.

### Persistence and fixture changes

Metrics derived — recomputed on load; bounded time-series persisted if shown.
Regenerate fixtures.

### Tests

Aggregates match brute-force over the population; distributions shift under a
forced pressure; determinism.

### Deterministic demonstration scenario

**Selection sandbox**: impose a pressure (e.g. sparse food favoring
efficiency); assert the mean efficiency trait moves in the expected
direction — direction, not exact value.

### Performance considerations

Aggregation staggered; O(N) not O(N²). Bounded time-series (risk register).

### Acceptance criteria

- [ ] Trait distributions, lineages, selection metrics observable
- [ ] Selection emerges (not hard-coded)
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol version)
- [ ] Performance checked

### Explicitly out of scope

Per-organism full histories, mate choice.

### Completion notes

_(fill on completion)_

---

## Step 22 — Mate choice and sexual selection

**Status:** Not started

**Carried forward (see §1.4):** **A9** — there are no sexes; either adult may
initiate and the lower entity id carries the pregnancy. **A10** — the
`seekMate` action steers toward a perceived conspecific but performs no
assessment. Both were deferred here deliberately: preference only becomes
meaningful once traits are heritable (Step 20). Decide here whether to
introduce sexes at all, or keep hermaphroditic pairing and put all the
selection pressure in preferences.

### Objective

Add mate preferences over measurable traits with costs/tradeoffs, so sexual
selection can act alongside natural selection.

### Why this step comes now

Requires working inheritance (Step 20) and observation (Step 21) to be
meaningful and verifiable.

### Visible result

Animals visibly prefer/reject mates by trait; preferred traits shift in the
metrics panel over generations.

### Existing code to retain or replace

Extend `ReproductionSystem` mate selection with preference scoring.

### Dependencies

Steps 12, 20, 21.

### Simulation changes

Preference utility over perceived mate traits, with a choosiness cost
(time/energy/opportunity). Ownership: reads traits; writes `mateId`.

### Protocol changes

**Version bump.** Expose mate-preference summary in inspection.

### Renderer changes

Inspector shows chosen mate + preference basis.

### Persistence and fixture changes

Save version bump if preference state persisted. Regenerate fixtures.

### Tests

Preference biases mate choice; choosiness cost applied; preferred trait
frequency rises under model conditions; determinism.

### Deterministic demonstration scenario

Seeded population with a preference; assert preferred-trait frequency
increases across generations (direction).

### Performance considerations

Mate evaluation bounded to perceived candidates via grid.

### Acceptance criteria

- [ ] Trait-based mate choice with costs
- [ ] Sexual-selection effect observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Complex courtship displays, ornaments as separate entities.

### Completion notes

_(fill on completion)_

---

## Step 23 — Social behavior

**Status:** Not started

### Objective

Add incremental sociality: conspecific attraction, herding, group movement,
alarm behavior, dominance, kin recognition, cooperative defense — using
bounded groups and sparse relationships.

### Why this step comes now

Milestone F. Needs perception, memory, and kin refs (Steps 7, 13, 15).
Precedes territory (Step 24), which builds on group/home-range behavior.

### Visible result

Animals visibly form herds, move together, raise alarms, and defend
cooperatively; inspector shows group membership and dominance.

### Existing code to retain or replace

Reuse perception + memory; add group membership and social utilities.

### Dependencies

Steps 7, 13, 15.

### Simulation changes

`SocialSystem` (phase `decision`): bounded group formation, cohesion/
alignment utilities, alarm propagation locally, dominance interactions.
Ownership: writes sparse `groupId`/relationships. **No global pairwise
matrices** (invariant 17, risk register).

### Protocol changes

**Version bump.** Group id + dominance + alarm events in projection/
inspection.

### Renderer changes

Inspector group panel; optional group tint (renderer-owned); alarm events in
log.

### Persistence and fixture changes

Save version bump (group membership). Regenerate fixtures.

### Tests

Group cohesion within tolerance; alarm spreads only locally; dominance
deterministic; no O(N²) relationship scan; determinism.

### Deterministic demonstration scenario

Seeded herd + a threat; assert herd cohesion and local alarm propagation
without global effects.

### Performance considerations

Sparse relationships + grid neighborhoods only. Benchmark with large herds.

### Acceptance criteria

- [ ] Bounded groups, herding, alarm, dominance, kin recognition
- [ ] Social structure observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked (no global matrices)

### Explicitly out of scope

Territory (Step 24), complex politics, multi-level societies.

### Completion notes

_(fill on completion)_

---

## Step 24 — Territories and home ranges

**Status:** Not started

### Objective

Let territories/home ranges **emerge** from spatial history and behavior:
repeated-use areas, marking, patrol, conflict, avoidance, territory loss, and
occupation of vacant areas.

### Why this step comes now

Builds on memory (Step 15) and social behavior (Step 23); a spatial-history
consequence, not a prescribed map.

### Visible result

Animals visibly patrol/defend recurring areas and avoid others' ranges;
inspector shows home-range center/marks.

### Existing code to retain or replace

Reuse memory + social; add home-range accumulation from position history.

### Dependencies

Steps 15, 23.

### Simulation changes

`TerritorySystem` (phase `decision`/`observation`): accumulate use density;
derive home-range centroid; marking + avoidance utilities; conflict on
overlap. Ownership: writes bounded home-range summary + marks.

### Protocol changes

**Version bump.** Home-range summary + marks in inspection; optional
territory events.

### Renderer changes

Inspector home-range panel; optional range overlay (renderer-only,
selected entity).

### Persistence and fixture changes

Save version bump (home-range summary). Regenerate fixtures.

### Tests

Home range emerges from repeated use; avoidance reduces overlap; vacant area
gets occupied; determinism.

### Deterministic demonstration scenario

Seeded resident; assert a stable home-range centroid emerges and a neighbor
avoids it.

### Performance considerations

Bounded per-animal spatial summary (not full occupancy history). Bounded
memory (risk register).

### Acceptance criteria

- [ ] Emergent home ranges/territories with marking + conflict
- [ ] Ranges observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Global territory partitioning, optimal boundary solving.

### Completion notes

_(fill on completion)_

---

## Step 25 — Simplified disease or parasites

**Status:** Not started

### Objective

Add a compartmental disease model (susceptible → infected → symptomatic →
recovered or dead) with visible effects: reduced movement/feeding/fertility,
social avoidance, and mortality.

### Why this step comes now

Adds a density-dependent pressure that interacts with social behavior
(Step 23) and drives selection (Step 21).

### Visible result

Outbreaks visibly spread through dense groups; symptomatic animals slow and
are avoided; populations visibly recover or crash.

### Existing code to retain or replace

Reuse perception/social proximity for transmission; add disease state.

### Dependencies

Steps 7, 23.

### Simulation changes

`DiseaseSystem` (phase `physiology`): local transmission via proximity from a
`disease` RNG stream; state transitions with durations; effects on movement/
feeding/fertility; recovery/death. Ownership: writes `diseaseState`.

### Protocol changes

**Version bump.** `diseaseState` in projection; outbreak/infection events.

### Renderer changes

Symptomatic tint/marker (renderer-owned); disease events in log; inspector
disease panel.

### Persistence and fixture changes

Save version bump (`diseaseState`). Regenerate fixtures.

### Tests

Transmission only within proximity; state durations deterministic; effects
applied by stage; determinism.

### Deterministic demonstration scenario

Seeded dense group + one infected; assert local spread then recovery/deaths —
qualitative outbreak curve, not exact counts.

### Performance considerations

Transmission via grid neighborhoods only. Benchmark in dense populations.

### Acceptance criteria

- [ ] SIR-style disease with visible symptoms and outcomes
- [ ] Disease observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Detailed immunology, pathogen evolution, vectors as entities.

### Completion notes

_(fill on completion)_

---

## Step 26 — Migration and dispersal

**Status:** Not started

### Objective

Add juvenile dispersal, seasonal movement, habitat evaluation, remembered
routes, recolonization, and population fragmentation — without globally
optimal pathfinding.

### Why this step comes now

Ties together memory (15), weather/seasons (19), and territory (24) into
larger-scale spatial dynamics.

### Visible result

Juveniles visibly disperse from natal ranges; herds shift seasonally; empty
regions get recolonized.

### Existing code to retain or replace

Reuse dispersal-at-maturity (Step 13) + memory + weather; add
migration/habitat-evaluation behavior.

### Dependencies

Steps 15, 19, 24.

### Simulation changes

`MigrationSystem` (phase `decision`): habitat-quality estimate from local
perception + memory; directional movement bias; remembered routes. Ownership:
writes movement bias/intent. Local heuristics only — **no per-entity global
pathfinding** (risk register).

### Protocol changes

**Version bump.** Migration/dispersal events; habitat estimate in inspection.

### Renderer changes

Migration/dispersal events in log; optional route overlay (renderer-only).

### Persistence and fixture changes

Save version bump if route memory persisted. Regenerate fixtures.

### Tests

Juveniles leave natal range; seasonal bias direction; recolonization of
emptied regions; determinism.

### Deterministic demonstration scenario

Seeded seasonal world; assert directional seasonal movement and
recolonization of a cleared region.

### Performance considerations

Habitat evaluation bounded/staggered; no global search. Benchmark.

### Acceptance criteria

- [ ] Dispersal, seasonal migration, recolonization via local heuristics
- [ ] Movement patterns observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked (no global pathfinding)

### Explicitly out of scope

A\* over the whole map per entity, optimal route solving.

### Completion notes

_(fill on completion)_

---

## Step 27 — Local disturbances

**Status:** Not started

### Objective

Add spatially bounded events (drought, fire, flood, storm, severe winter)
that visibly affect terrain, vegetation, movement, survival, and recovery.

### Why this step comes now

Provides acute selection pressure and tests resilience of all prior systems;
depends on weather (19) and migration (26) for response/recovery.

### Visible result

A disturbance visibly sweeps a region (scorched/flooded cells, vegetation
loss), animals flee/die, then the area recovers over time.

### Existing code to retain or replace

Reuse terrain/vegetation/weather; add bounded disturbance events + effects.

### Dependencies

Steps 2, 3, 19, 26.

### Simulation changes

`DisturbanceSystem` (phase `environment`): spawn bounded events from a
`disturbance` RNG stream; apply local terrain/vegetation/mortality effects;
schedule recovery. Ownership: writes affected cells + triggers mortality.

### Protocol changes

**Version bump.** Disturbance events + affected-region metadata.

### Renderer changes

Disturbance glyph/color states (renderer-owned); events in log.

### Persistence and fixture changes

Save version bump (active disturbances). Regenerate fixtures.

### Tests

Effects bounded to the region; vegetation/terrain recover over time;
mortality only inside the event; determinism.

### Deterministic demonstration scenario

**Disturbance sandbox**: seeded fire in a region; assert local vegetation
loss, displacement, and recovery by an expected tick.

### Performance considerations

Bounded region iteration; infrequent. Cheap.

### Acceptance criteria

- [ ] Bounded disturbances with terrain/vegetation/mortality + recovery
- [ ] Disturbance + recovery observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

Global catastrophes, fire spread physics, fluid simulation.

### Completion notes

_(fill on completion)_

---

## Step 28 — Ecosystem engineering

**Status:** Not started

### Objective

Add concrete, visible environment modification by animals: burrows, trails,
grazing clearings, nest sites, shade, or modified water access — only where a
specific visible effect justifies it.

### Why this step comes now

A capstone behavioral-feedback layer; depends on stable movement, territory,
and parenting. Kept concrete to avoid an over-general framework (risk
register).

### Visible result

Repeated animal activity visibly reshapes the world (worn trails, cleared
patches, burrow glyphs) that in turn affects behavior.

### Existing code to retain or replace

Reuse territory/movement history; add specific modification effects.

### Dependencies

Steps 5, 24.

### Simulation changes

`EngineeringSystem` (phase `environment`): specific, enumerated modifications
tied to behaviors (trail wear from repeated movement, clearing from grazing,
burrow creation). Ownership: writes specific terrain/feature cells.

### Protocol changes

**Version bump.** Feature/modification cell states in projection.

### Renderer changes

Feature glyphs (trail, burrow, nest) — renderer-owned.

### Persistence and fixture changes

Save version bump (features). Regenerate fixtures.

### Tests

Repeated use creates a feature; feature affects later behavior/movement;
determinism.

### Deterministic demonstration scenario

Seeded repeated traffic; assert a trail forms and biases later movement.

### Performance considerations

Feature writes are sparse/local. Cheap.

### Acceptance criteria

- [ ] Concrete visible environment modification with behavioral feedback
- [ ] Modifications observable
- [ ] Tests pass
- [ ] Visible result verified
- [ ] Documentation updated (protocol + save version)
- [ ] Performance checked

### Explicitly out of scope

A generic scriptable environment-modification engine.

### Completion notes

_(fill on completion)_

---

## Step 29 — Expanded species system

**Status:** Not started

**Carried forward (see §1.4):** this step is the designated home for the
config debt accumulated while there was only one species. **B3** — metabolism
(Step 6), hydration (Step 10), and aging/life-curve (Step 11) parameters all
live in **global** config sections and should become per-species. **B4** —
perception radius already *is* per-species (resolved from the registry), so the
two patterns must be unified; prefer the registry approach. Also revisit
**B1/B2** (`createDemoSimulation.js` naming, `config.demo` scenario block) while
the config layers are being reorganised.

### Objective

Generalize now-stable mechanics into configuration-driven species definitions
covering diet, size, movement, activity pattern, lifespan, reproduction,
parenting, sociality, habitat preference, and predator-prey relationships —
with **no species-name conditionals in core systems**.

### Why this step comes now

Only generalize after the mechanics are proven single-species; premature
generalization is a named risk. Enables a multi-species community.

### Visible result

Multiple distinct species coexist with visibly different ecology (grazers,
browsers, multiple predators, omnivores).

### Existing code to retain or replace

Refactor per-species constants (accumulated since Step 4) into the species
config schema; remove any name checks that crept into systems.

### Dependencies

Steps 4–28 (mechanics to generalize).

### Simulation changes

Species schema + registry; systems read species params generically.
Ownership unchanged; only the source of parameters generalizes.

### Protocol changes

Possibly none (speciesId already projected). **Version bump** only if new
observable species metadata is exposed.

### Renderer changes

Appearance registry gains entries per species (renderer-owned); no logic
change.

### Persistence and fixture changes

Save version bump if species schema alters records. Regenerate fixtures with
a multi-species scenario.

### Tests

Adding a species via config alone (no core edits) changes behavior; a
"no species-name literals in systems" static scan; determinism.

### Deterministic demonstration scenario

Seeded multi-species world; assert each species exhibits its configured
ecology and the world runs deterministically.

### Performance considerations

Config indirection must not add per-tick allocation; precompute derived
params. Benchmark multi-species tick.

### Acceptance criteria

- [ ] Config-driven multi-species with no core conditionals
- [ ] Multiple species visibly coexist
- [ ] Tests pass (incl. no-species-literal scan)
- [ ] Visible result verified
- [ ] Documentation updated
- [ ] Performance checked

### Explicitly out of scope

A biological scripting language; runtime species authoring UI.

### Completion notes

_(fill on completion)_

---

## Step 30 — Measured performance optimization

**Status:** Not started

**Carried forward (see §1.4) — known candidates, still to be confirmed by
profiling:** **C6** — perception is already the dominant per-tick cost (O(r²)
local scan; large-5k went 1.8 → 14.0 ms/tick when it landed); the
`updateInterval` stagger knob is verified, and ring-search early-exit plus
buffer reuse are the untried fixes. **C3** — per-tick `entity.moved` /
`entity.fed` volume competes for the event retention window. **B5** —
`utilityBreakdown` is persisted per entity and may bloat saves at 25k animals.
**B6** — aging could move to a `birthTick`-derived age and be staggered.
Measure before touching any of these.

### Objective

Profile realistic mature scenarios and optimize **only** demonstrated
bottlenecks toward the mature tick-budget target.

### Why this step comes now

Optimization follows measurement (invariant/consistency review). Only
meaningful once the full system exists and can be profiled at scale.

### Visible result

Same behavior, higher entity counts within the one-second cadence; a
profiling report identifies and validates each optimization.

### Existing code to retain or replace

Retain behavior; optimize hot paths (spatial queries, perception, decision,
vegetation, snapshot/delta, serialization, renderer-state application).

### Dependencies

All prior steps.

### Simulation changes

Profile-guided: candidates include staggered updates, typed/struct-of-arrays
storage, object reuse, region subscriptions, worker threads, binary encoding —
**only where profiling proves a win.** Public engine API unchanged
(invariant: internal layout must not leak).

### Protocol changes

Only if region subscriptions/binary encoding are adopted — must stay
renderer-neutral and versioned.

### Renderer changes

Only to consume region subscriptions if added; otherwise none.

### Persistence and fixture changes

Save/protocol versions bump only if encoding changes. Regenerate fixtures.

### Tests

Behavior parity before/after (determinism preserved); benchmark deltas
recorded; region-subscription correctness if added.

### Deterministic demonstration scenario

Reuse the largest scenario; assert identical results pre/post optimization
and record the tick-budget improvement.

### Performance considerations

This step _is_ performance. Report against Step 1 baseline and mature target.

### Acceptance criteria

- [ ] Profiling report with before/after for each change
- [ ] Determinism preserved (byte-identical runs)
- [ ] Tests pass
- [ ] Visible result verified (higher counts within budget)
- [ ] Documentation updated
- [ ] Performance checked (mature target)

### Explicitly out of scope

Speculative optimization without a profile; changing observable behavior.

### Completion notes

_(fill on completion)_

---

## 6. Milestones

### Milestone A — Visible biome (Steps 2–4)

- **Scenario:** seeded world shows terrain + vegetation + inspectable
  herbivores.
- **Tests:** terrain/vegetation determinism, projection whitelist, boundary.
- **Performance target:** 10–100 animals, thousands of veg cells, tick well
  under 1 s.
- **Done when:** terrain, vegetation, and a real herbivore are visible and
  inspectable from protocol data.
- **Risks:** snapshot size from cell layers; fixture drift.

### Milestone B — Self-sustaining herbivore loop (Steps 5–10) — **COMPLETE**

- **Scenario:** herbivores move, perceive, decide, forage, compete, drink,
  spend energy/hydration, and survive or die.
- **Tests:** movement/spatial invariants, energy conservation, foraging,
  starvation, competition, hydration/thirst. (171 tests total at completion.)
- **Performance target:** ≤ mid-range; tick ~250–500 ms at low-hundreds
  animals. **Met:** ~0.29 ms/tick at 100 animals; ~21 ms/tick at 5000.
- **Done when:** the survival loop runs with no hard-coded balance. **Met at
  Step 9** (feeding closed the loop); Step 10 added the second need.
- **Risks (observed):** thirst-driven population decline with a single lake +
  no memory — mitigated by a gentle dehydration default; the real fix is
  Step 15 memory.

### Milestone C — Complete herbivore life cycle (Steps 11–15)

- **Scenario:** born → grow → parented → mature → reproduce → age → die, with
  variation and memory.
- **Tests:** life-stage transitions, reproduction gating, parenting refs,
  trait effects, bounded memory.
- **Performance target:** hundreds of animals within budget.
- **Done when:** lineages persist across generations without scripted rates.
- **Risks:** relationship-ref validity; unbounded memory/events.

### Milestone D — Predator-prey biome (Steps 16–19)

- **Scenario:** predators hunt, prey flee, hunts fail/succeed, injuries occur,
  carcasses are scavenged, seasons shift.
- **Tests:** hunt pipeline dynamics, injury/healing, carcass conservation,
  seasonal effects.
- **Performance target:** mixed low-thousands within budget.
- **Done when:** predator-prey dynamics emerge and persist.
- **Risks:** predation tuning → extinction; tick-budget overruns.

### Milestone E — Heredity and evolution (Steps 20–22)

- **Scenario:** traits inherited; distributions shift under pressure; mate
  choice acts.
- **Tests:** inheritance envelope, metrics vs. brute force, selection
  direction.
- **Performance target:** unchanged tick budget; metrics staggered.
- **Done when:** trait change across generations is observable and emergent.
- **Risks:** tests overfitting stochastic outcomes; determinism regressions.

### Milestone F — Social and environmental depth (Steps 23–29; Step 30 spans all)

- **Scenario:** herding/alarm/dominance, territories, disease outbreaks,
  migration, disturbances, ecosystem engineering, multi-species coexistence.
- **Tests:** no global matrices, local transmission, emergent territories,
  bounded disturbances, config-driven species.
- **Performance target:** progress toward several-thousand→~25k animals with
  Step 30.
- **Done when:** a multi-species world shows social + environmental dynamics
  and stays runnable/demonstrable.
- **Risks:** over-generalization; quadratic searches; fixture drift.

---

## 7. Deterministic demonstration scenarios

Maintain small seeded scenarios under `src/fixtures/scenarios/` (or similar),
each with a fixed seed and **qualitative** assertions (never exact long-term
population counts).

| #   | Scenario                     | Seed  | Expected qualitative behavior              | Stable assertions                        | Steps | Renderer fixture? |
| --- | ---------------------------- | ----- | ------------------------------------------ | ---------------------------------------- | ----- | ----------------- |
| 0   | Baseline determinism         | 42    | demo world runs identically                | two runs byte-identical                  | 1     | no                |
| 1   | Terrain sandbox              | fixed | water + rock present, rock impassable      | cell-type counts; blocked cells          | 2, 5  | yes               |
| 2   | Movement sandbox             | fixed | one animal navigates around obstacles      | never enters blocked cells; stable pos@N | 5     | yes               |
| 3   | Foraging sandbox             | fixed | herbivore finds + eats a patch             | energy rises; biomass drops              | 8, 9  | yes               |
| 4   | Starvation sandbox           | fixed | predictable energy decline → death         | exact death tick; carcass created        | 6     | yes               |
| 5   | Resource-competition sandbox | fixed | several herbivores, limited food           | some survive, some starve (no balance)   | 9     | no                |
| 6   | Life-cycle sandbox           | fixed | accelerated grow/mate/birth/age/death      | lineage completes; refs valid            | 11–13 | yes               |
| 7   | Predation sandbox            | fixed | pursuit, escape, failed + successful hunts | ≥1 fail + ≥1 capture; carcass fed        | 16    | yes               |
| 8   | Inheritance sandbox          | fixed | short generations; kids resemble parents   | parent-offspring trait correlation       | 20    | no                |
| 9   | Selection sandbox            | fixed | a pressure shifts a trait distribution     | mean trait moves expected direction      | 21    | no                |
| 10  | Disturbance sandbox          | fixed | local event → displacement → recovery      | bounded effect; recovery by tick N       | 27    | yes               |

For each: record initial state, seed, expected behavior, stable assertions,
related steps, and whether a renderer fixture is generated. **Do not assert
exact final populations for stochastic runs.**

---

## 8. Testing strategy

- **Unit:** energy/metabolism math, utility scoring, inheritance,
  movement/terrain validation, spatial queries, world projection, protocol
  validation.
- **System:** one system against controlled state (e.g. feeding on a fixed
  grid).
- **Integration:** movement↔spatial index, perception↔decision, feeding↔
  physiology, reproduction↔genetics, predation↔injury, weather↔vegetation,
  snapshot↔renderer-store delta application.
- **Deterministic scenarios:** the seeded worlds above with stable
  invariants.
- **Invariant tests (permanent):** living entities in bounds; impassable
  cells never illegally occupied; dead entities don't act; positions match
  the spatial index; energy has defined sources/costs; ids stable; parentage
  refs valid; commands apply at deterministic boundaries; save/load
  continuation matches uninterrupted runs; renderer imports nothing internal;
  no species-name literals in core systems (from Step 29).
- **Performance:** benchmarks report ms/tick per subsystem; prefer reporting
  over fragile strict-timing CI gates. Fail CI only on gross regressions.

Keep engine logic in browser-independent modules so `node:test` covers it
without a DOM.

---

## 9. Performance targets (engineering targets, not guarantees)

Calibrate against the Step 1 baseline.

- **Early visible biome (A–B):** 10–100 animals, thousands of veg cells, tick
  comfortably < 1 s.
- **Mid-development (C–D):** hundreds→low-thousands animals, tens of thousands
  of veg cells, typical tick ~250–500 ms on a modern dev machine.
- **Mature (with Step 30):** several thousand→~25,000 behaviorally complex
  animals, large aggregated vegetation, typical tick < ~500–700 ms with the
  1 s authoritative cadence retaining safety margin.

---

## 10. Observation roadmap

Add observability with each biological system (never as an afterthought):
physiological state, current action, perceived entities, decision-utility
breakdown, salient memories, parents/offspring/mates, injuries, disease,
major life events, cause of death, population counts, birth/death rates,
trait distributions, reproductive success, per-system timing.

**Do not store complete tick-by-tick histories for every organism.** Use
bounded significant-event histories; enable detailed tracing only for
selected entities or debug scenarios.

---

## 11. Configuration roadmap

Keep these layers separate:

- **Engine constants** (tick math, phase list).
- **World configuration** (dimensions, seed, terrain params).
- **Scenario definitions** (the seeded demos in §7).
- **Species definitions** (biology only).
- **Behavior parameters** (utilities, thresholds).
- **Genetics** (trait ranges, mutation rates).
- **Renderer appearance mappings** (glyphs, colors — renderer-owned only).

Species definitions may hold biological parameters but **must not** contain
ASCII glyphs, Dracula colors, or presentation-only UI labels. Do not build a
general-purpose biological scripting language prematurely.

---

## 12. Protocol, fixture, and persistence change discipline

Each step's dedicated sections state exactly what changes. Rules:

- Bump `PROTOCOL_VERSION` on any change to command/snapshot/delta/event/query
  shapes; keep additions renderer-neutral (codes, not glyphs).
- Bump `SAVE_FORMAT_VERSION` when persisted state changes; prefer
  regenerate-from-seed over storing derived grids; provide a migration or an
  explicit dev-save invalidation note — **never silently break saves**.
- Regenerate renderer fixtures whenever the protocol changes
  (`npm run fixtures:renderer`); a fixture-vs-live check guards drift.
- Extend `PUBLIC_ENTITY_FIELDS`/inspection deliberately; never widen the
  projection to raw records.

---

## 13. Risk register

| Risk                                          | Likelihood | Impact | Warning sign                                                | Mitigation                                                                 |
| --------------------------------------------- | ---------- | ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Engine–renderer coupling                      | Low        | High   | renderer needs a sim import; sim references glyph/color     | boundary tests (already present); extend scans each step                   |
| Over-generalized abstractions                 | Medium     | Medium | frameworks before a second use case (e.g. Step 28/29 early) | generalize only after ≥2 concrete uses; single-species first               |
| Quadratic neighbor searches                   | Medium     | High   | tick time grows super-linearly with N                       | spatial-grid-only queries (invariant 17); benchmark each behavior step     |
| Unbounded memory/event growth                 | Medium     | High   | RSS climbs over long runs                                   | bounded memories/events/life-histories; caps in Steps 6,13,15,21           |
| Determinism regressions                       | Medium     | High   | two seeded runs diverge                                     | `Math.random` ban + named streams; byte-identical run test every step      |
| Protocol/save incompatibility                 | Medium     | Medium | old fixtures/saves fail to load                             | version bumps + migration/invalidation notes; regenerate fixtures          |
| Population explosion or extinction            | High       | Medium | counts hit 0 or blow up                                     | no hard-coded balance, but tune costs; scenario assertions are qualitative |
| Unstable parameter tuning                     | High       | Medium | tiny param change flips outcomes                            | centralize params in config; document sensitivity; sandbox scenarios       |
| Tick-budget overruns                          | Medium     | High   | ms/tick approaches 1000                                     | per-subsystem benchmarks; stagger updates; Step 30 gated by profiling      |
| Renderer fixtures drifting from live protocol | Medium     | Medium | fixture tests pass but live differs                         | regenerate on every protocol change; fixture-vs-live guard test            |
| AI-generated duplication                      | Medium     | Medium | near-identical systems/utilities                            | reuse existing abstractions; review before adding new modules              |
| Tests overfitting stochastic results          | Medium     | Medium | flaky tests on exact counts                                 | assert invariants/directions, never exact long-term populations            |

### Observed status after Steps 1–12

What has actually happened, so the register reflects evidence rather than
prediction:

| Risk | Observed? | Evidence and outcome |
| --- | --- | --- |
| Population explosion | **Yes (twice)** | Step 12 reproduction grew 8 → 1037 by tick 20 000, with food never limiting; re-tuned to costly reproduction (§1.4 C5). Inverse also seen: Step 11 without reproduction went extinct by ~9000. |
| Tick-budget overruns | **Yes (contained)** | Step 1 found an O(n)-per-emit event-buffer trim (58.7 → 1.6 ms/tick after fix). Step 7 perception took large-5k 1.8 → 14.0 ms/tick. Current worst case ~35 ms/tick — far under the 1 s budget. |
| Unstable parameter tuning | **Yes** | Hydration (§1.4 C4) and reproduction (C5) both needed parameter sweeps to avoid collapse/explosion. |
| Tests overfitting stochastic results | **Yes** | §1.4 D1/D2 — one assertion rewritten four times; a behaviour test pinned to a specific seed. |
| Unbounded memory/event growth | **Partly** | Event *volume* is high (C3) but bounded by the buffer; no unbounded growth observed. |
| Determinism regressions | **No** | Byte-identical seeded runs asserted every step; never broken. |
| Engine–renderer coupling | **No** | Boundary tests have held since the renderer was built. |
| Protocol/save incompatibility | **No (by discipline)** | 11 protocol and 10 save-format bumps, each with fixtures regenerated and invalidation notes. |
| Quadratic neighbour searches | **No** | All neighbour work goes through `SpatialGrid.queryRadius`. |
| AI-generated duplication | **No (actively countered)** | Shared `killAnimal` helper (Step 10) and shared `isReproductivelyReady` predicate (Step 12) extracted instead of duplicating. |
| Over-generalized abstractions | **No** | Species config stayed single-species; generalization deliberately deferred to Step 29 (§1.4 B3/B4). |
| Renderer fixtures drifting | **No** | Regenerated on every protocol change. |

---

## 14. Future execution protocol (for each Fable session)

1. Read the complete `PLAN.md`.
2. Inspect the repository before modifying code.
3. Execute only the next incomplete numbered step unless told otherwise.
4. Preserve every architectural invariant (§2).
5. Reuse existing abstractions where appropriate.
6. Do not recreate completed foundation or renderer systems.
7. Update simulation, protocol, renderer, fixtures, persistence, tests, and
   docs together when the step requires it.
8. Run the complete test suite (`npm test`).
9. Run the step's deterministic scenario (§7).
10. Start the app (`npm run dev`) and verify the visible behavior.
11. Record benchmark results when hot-path behavior changes.
12. Mark acceptance criteria individually (check the boxes).
13. Add concise completion notes to the step.
14. Update later steps only when a new technical constraint requires it.
15. Do not silently defer failed criteria — record them.
16. Do not begin the next step in the same session unless explicitly
    instructed.

---

## 15. Final consistency review (verified for this plan)

1. Starts from the repository's actual completed state (§1 audit). ✔
2. Existing engine/renderer functionality is not redundantly planned. ✔
3. Foundation work is limited to verified remediation (Step 1). ✔
4. Dependencies flow linearly; each step lists its predecessors. ✔
5. No step depends on a later incomplete feature. ✔
6. Terrain (Step 2) and visible movement (Step 5) occur early. ✔
7. Herbivore survival loop (Steps 5–9) precedes reproduction (Step 12). ✔
8. Reproduction (Step 12) precedes genetics (Step 20). ✔
9. Stable herbivore behavior (through Step 15) precedes predators (Step 16). ✔
10. Perception (Step 7) and memory (Step 15) precede advanced social
    behavior (Steps 23–24). ✔
11. Every feature step includes protocol, renderer, test, and observability
    implications. ✔
12. Camera visibility never influences simulation behavior (invariant 8). ✔
13. Performance optimization (Step 30) follows measurement (Step 1 baseline +
    per-step benchmarks). ✔
14. Every milestone leaves the app runnable and demonstrable. ✔
