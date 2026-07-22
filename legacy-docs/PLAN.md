# biome — Ecosystem Simulation Development Plan

> **⚠ This plan is complete (Steps 1–30) and is now a historical record.**
>
> **For reference documentation — architecture, invariants, subsystem design,
> the protocol, performance, and every open action item — read
> [`DOCS.md`](DOCS.md) instead.** It consolidates this file and `HANDOFF.md`
> into topic-organized reference, and nothing in it depends on reading this one.
>
> What this file still uniquely holds is **provenance**: each step's dated
> completion notes, in the order the work actually happened, including the
> measurements and false starts behind every decision. Read it when you want to
> know _why_ or _when_ something was decided. Do not add new steps here.

This was the authoritative, linear development plan for growing the existing
biome foundation (deterministic headless engine + versioned protocol +
Dracula ASCII renderer) into an animal-centered artificial-life ecosystem.

**This document was executed one numbered step at a time.** It does **not**
re-plan the completed foundation or renderer — those are treated as
authoritative except where the §1 audit flags remediation.

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

## 1.4 Carried-forward deviations and open issues (Steps 1–29)

Consolidated from the completion notes of the finished steps. Each item is
either **debt** (something deliberately deferred or simplified) or a **known
limitation** (real behaviour a future step must handle). Nothing here is a
correctness bug in shipped code unless marked ⚠.

### A. Deliberately deferred / simplified scope

| #         | From   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Owed to                                                                                                                                                                                                                                                                                                |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1        | 2      | Terrain legend lives at `terrain.cellTypes`, not `world.cellTypes` (natural home for the payload)                                                                                                                                                                                                                                                                                                                                                                                  | — (settled)                                                                                                                                                                                                                                                                                            |
| A2        | 2      | Cover generated as clumped patches, not per-cell scatter — per-cell scatter fragmented the RLE (1024² snapshot 916 KB → 118 KB)                                                                                                                                                                                                                                                                                                                                                    | — (settled)                                                                                                                                                                                                                                                                                            |
| A3        | 3      | Individual tree/shrub entities omitted (plan marked optional); `plant` kind reserved for them                                                                                                                                                                                                                                                                                                                                                                                      | any later step that needs point vegetation                                                                                                                                                                                                                                                             |
| ~~A4~~    | 6      | Bounded per-entity `lifeEvents` list deferred                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Done in Step 13** — `systems/lifeEvents.js`, capped at 12 entries; Step 21 may extend the vocabulary                                                                                                                                                                                                 |
| A5        | 7      | Renderer debug overlay of perceived cells deferred                                                                                                                                                                                                                                                                                                                                                                                                                                 | later renderer pass                                                                                                                                                                                                                                                                                    |
| A6        | 8      | `approachFood` folded into `seekFood` (identical mechanics)                                                                                                                                                                                                                                                                                                                                                                                                                        | — (settled)                                                                                                                                                                                                                                                                                            |
| A7        | 8      | Action glyph _tint_ deferred (`action` is in the bulk snapshot, so it is available)                                                                                                                                                                                                                                                                                                                                                                                                | later renderer pass                                                                                                                                                                                                                                                                                    |
| A8        | 10     | Optional `entity.drank` event skipped (redundant with the public `action` field)                                                                                                                                                                                                                                                                                                                                                                                                   | — (settled)                                                                                                                                                                                                                                                                                            |
| ~~A9~~    | 12     | No sexes: either adult may initiate, the lower id gestates                                                                                                                                                                                                                                                                                                                                                                                                                         | **Done in Step 22** — females gestate and choose, males clear a lower energy bar and a shorter refractory period. The asymmetry is the point, not a convenience                                                                                                                                        |
| ~~A10~~   | 12     | `seekMate` steers toward a conspecific but does not assess mate quality                                                                                                                                                                                                                                                                                                                                                                                                            | **Done in Step 22** — it now steers toward the _best_ perceived candidate (distance-discounted), and the reproduction system accepts or rejects against a declining standard                                                                                                                           |
| ~~A11~~   | 13     | Juvenile _protection_ omitted from the parenting strategy — a guardian does not defend or shield its young                                                                                                                                                                                                                                                                                                                                                                         | **Done in Step 23** — a parent stands over a threatened juvenile (`defend`) and materially lowers the predator's odds. But see **A32**: it is demonstrably rare                                                                                                                                        |
| A12       | 13     | An orphaned unweaned juvenile is weaned early rather than facing a real dependency crisis                                                                                                                                                                                                                                                                                                                                                                                          | **still open, deliberately.** Step 23 already moved juvenile survival twice (defense, and herding); removing the mercy in the same step would have changed two variables at once with no way to attribute the result                                                                                   |
| ~~A13~~   | 14, 20 | Trait spread lives in `config.traits` and mutation in `config.genetics`, neither per species (a _third_ pattern alongside B3/B4)                                                                                                                                                                                                                                                                                                                                                   | **Done in Step 29** — `traits.spread` and `genetics` are per-species blocks in the schema, resolved against the config defaults                                                                                                                                                                        |
| A14       | 14     | Only `speed` and `adultMass` are precomputed onto the entity; other trait multipliers are applied inline each tick                                                                                                                                                                                                                                                                                                                                                                 | — (settled; measured as free)                                                                                                                                                                                                                                                                          |
| ~~A15~~   | 15     | Kin identity omitted from the memory kinds — lineage is already exact and non-decaying via `parents`/`offspring`/`guardianId`, so a decaying copy would duplicate authoritative state for no consumer                                                                                                                                                                                                                                                                              | **Settled in Step 23** — kin recognition got its reader (defense), and it reads the _authoritative_ lists directly. So the memory kind is still not needed and now demonstrably so, rather than by assumption                                                                                          |
| ~~A16~~   | 15     | The `danger` memory kind shipped with avoidance implemented but no writer                                                                                                                                                                                                                                                                                                                                                                                                          | **Done in Step 16** — a failed hunt records the attack site in the prey's memory                                                                                                                                                                                                                       |
| ~~A17~~   | 16     | Predator `birthMass` and the aging curve come from global config, so a stalker cub is born at the grazer's 5 kg (B3 debt, now spanning two species)                                                                                                                                                                                                                                                                                                                                | **Done in Step 29** — the stalker has its own `aging` block (born at 8 kg, matures slower, lives to 14 000) and its own `metabolism` and `hydration`. The last place this survived was the _birth_ path, where a newborn took one global `birthMass`                                                   |
| A18       | 16     | Prey have no spatial refuge from predators — cover slows both equally — which is part of why the founding counts are a knife edge                                                                                                                                                                                                                                                                                                                                                  | **Step 24** (territory)                                                                                                                                                                                                                                                                                |
| ~~A19~~   | 17     | Hazards and fights are not injury sources — failed captures are still the only writer                                                                                                                                                                                                                                                                                                                                                                                              | **Done in Step 23** — a dominance contest that escalates wounds both parties (the loser worse), via the same `applyInjury` helper. 114 battle wounds in one live 30 s window. _Hazards_ are still not an injury source, by the Step 19 reasoning below                                                 |
| ~~A21~~   | 18     | No dedicated scavenger guild — predators are the scavengers, since a third species is its own scope                                                                                                                                                                                                                                                                                                                                                                                | **Done in Step 29** — `scavenger.corvid`, whose entire implementation is a config file: a carnivore with an **empty `preySpeciesIds`**, so it can only eat what is already dead. No engine code was written to add it                                                                                  |
| A22       | 18     | Tombstones are bounded at 256, so lineage questions cannot reach further back than that                                                                                                                                                                                                                                                                                                                                                                                            | still open — Step 21 measured lineage _depth_ (`generation`) instead, which needs no tombstones; a deeper query would need them                                                                                                                                                                        |
| A23       | 19     | Snow is a weather state, not an accumulating snowpack layer                                                                                                                                                                                                                                                                                                                                                                                                                        | — (settled; a layer needs a reason to exist)                                                                                                                                                                                                                                                           |
| A24       | 19     | No per-cell microclimate — temperature is global and cover is the only spatial modifier                                                                                                                                                                                                                                                                                                                                                                                            | needs terrain elevation, which does not exist                                                                                                                                                                                                                                                          |
| A25       | 20     | No dominance or epistasis — expression is purely additive                                                                                                                                                                                                                                                                                                                                                                                                                          | — (settled; "quantitative traits only" per the step, and it keeps genotype→phenotype legible)                                                                                                                                                                                                          |
| A26       | 20     | Genetics is a module called by reproduction, not a registered `GeneticsSystem` — inheritance happens at one instant that reproduction already owns                                                                                                                                                                                                                                                                                                                                 | — (settled; a system would need a per-tick newborn scan)                                                                                                                                                                                                                                               |
| A27       | 21     | Metrics are polled over HTTP rather than streamed in snapshots/deltas — a full aggregate would dwarf the per-tick payload                                                                                                                                                                                                                                                                                                                                                          | — (settled; a summary view needs no tick resolution)                                                                                                                                                                                                                                                   |
| A28       | 21     | Bottleneck detection is left to the caller: the bounded history carries population per species, but nothing computes a minimum or flags a crash                                                                                                                                                                                                                                                                                                                                    | a later observability pass, if it earns its keep                                                                                                                                                                                                                                                       |
| A37       | 25     | Disease does not cross species — a pathogen adapted to a grazer is not the one adapted to a stalker                                                                                                                                                                                                                                                                                                                                                                                | a later step, if a shared or zoonotic pathogen is wanted                                                                                                                                                                                                                                               |
| ~~A38~~   | 25     | Susceptibility, incubation, and virulence are global config rather than per species                                                                                                                                                                                                                                                                                                                                                                                                | **Done in Step 29** — `disease` is a resolved species block, so susceptibility, incubation, and virulence can vary by species (they do not yet in the demo, which is a tuning choice rather than a structural one)                                                                                     |
| A39       | 25     | An environmental **spillover** keeps the pathogen alive. Without it the disease went extinct with its last carrier (one epidemic in 15k ticks); with it, outbreaks recur. It is a modelling convenience standing in for a reservoir that is not simulated                                                                                                                                                                                                                          | — (settled; a reservoir species would be Step 29's business)                                                                                                                                                                                                                                           |
| ~~A29~~   | 22     | Mate preference direction is species data (`species.matePreference`); only its _strength_ (`choosiness`) is heritable, so there is no full Fisherian runaway                                                                                                                                                                                                                                                                                                                       | **Settled in Step 29** — `matePreference` is a resolved species block like every other. Direction is still species data and only _strength_ is heritable, so there is still no full Fisherian runaway; that remains a deliberate choice rather than a config gap                                       |
| ~~A30~~   | 22     | `GESTATING_SEX` is one model-wide constant, not per-species data — every species would set it identically today                                                                                                                                                                                                                                                                                                                                                                    | **Settled in Step 29** — `reproduction` is a per-species block, so a species that needed the other answer could now state it. `GESTATING_SEX` stays one constant because every species still sets it identically                                                                                       |
| ⚠ A31     | 23     | **Step 21's selection sandbox has never demonstrated its claim.** Measured over seven seeds: the trait rose in 3, fell in 4, mean change −0.0002, with the selection differential negative in five and uncorrelated with the trait's direction. Cause: the differential compares breeders against _all_ adults, and 71 % of adults are breeders there, so the two samples are nearly the same set. Tightening the breeding gate makes it visible but drives the population extinct | an unmet **Step 21** acceptance criterion. The test now claims no direction; a world that demonstrates it must be built, not tuned                                                                                                                                                                     |
| A32       | 23     | Juvenile defense fires **once in 12 000 demo ticks** — the geometry it needs (an adult with a living juvenile of its own, nearer the predator than the parent and inside `defendRange`) almost never arises                                                                                                                                                                                                                                                                        | still open. Step 24 did **not** fix it as hoped: grazers turned out not to be able to afford site fidelity at all (A34), so families are no more co-located than before. Relaxing "nearer the predator than I am" to "near enough to interpose" remains the named lever                                |
| ⚠ A34     | 24     | **Patrolling is near-inert in the demo.** Routine site fidelity competes with wandering — which is how an animal finds its next meal — and cost the demo two seeds in five (4/5 → 2/5). The pull now ramps over six range radii, so it fires only for an animal that is genuinely lost. The mechanism is implemented and tested (the suite tightens the ramp to exercise it) but is not doing visible work in the demo                                                             | a future pass could give patrol a _reason_ — food that is worth returning to, or a den — rather than making it compete with foraging on equal terms                                                                                                                                                    |
| A35       | 24     | Grazers get a home range but no site fidelity and no claims, so "territory" in the demo is a predator-only phenomenon at ~9 individuals                                                                                                                                                                                                                                                                                                                                            | **Step 29** (species schema) is where a third, genuinely territorial species would land                                                                                                                                                                                                                |
| A36       | 24     | The claim layer is not projected to the renderer — the home-range ring is drawn from inspection for the selected animal only                                                                                                                                                                                                                                                                                                                                                       | a later renderer pass, if a territory _map_ earns the per-snapshot cost                                                                                                                                                                                                                                |
| A40       | 26     | **Remembered routes are not implemented.** The step named them, but Step 15 already stores remembered _places_ and `recallFood` already steers to them; a route is a trajectory, and the codebase deliberately stores no trajectory anywhere (a home range is four numbers for exactly this reason)                                                                                                                                                                                | a later step, if a _sequence_ of places ever earns the storage a single place does not                                                                                                                                                                                                                 |
| ~~A41~~   | 26     | Migration is a **grazer-only** phenomenon: a stalker's food is the grazer, which it already follows through perception and the hunt pipeline, so a vegetation gradient would point it at grass it cannot eat. Letting stalkers track forage as a prey proxy was tried and measured _worse_ (stalkers 0–3). Both species do disperse                                                                                                                                                | **Settled in Step 29** — `migration` is a resolved block like the rest. Migration remains grazer-only _by data_ (`tracksForage`), which is now a statement about the species rather than a limitation of the code                                                                                      |
| A42       | 26     | The forage cue reaches **beyond perception** (18 units against 6) and is a stated modelling convenience standing in for coarse long-range cues this world does not simulate — the smell of green ground, the lie of the land. Bounded by being a _difference_ (a flat world produces no pull) and by a strength cap well below 1                                                                                                                                                   | — (settled; the same kind of honest stand-in as A39's spillover)                                                                                                                                                                                                                                       |
| A43       | 26     | **Population fragmentation is enabled, not asserted.** Herd labels already split by hop count and separate forage patches already pull herds apart, but no test claims a fragmentation outcome                                                                                                                                                                                                                                                                                     | a later observability pass, if a fragmentation _measure_ earns its keep                                                                                                                                                                                                                                |
| A44       | 27     | **Drought and severe winter are not local disturbances.** Both already exist as _global_ weather states (Step 19), so a spatially bounded copy would be the same mechanism at a different scale rather than a new one. Fire, flood, and storm have no global analogue, which is why they are the three that shipped                                                                                                                                                                | — (settled; a kind is a row in the effect table if one is ever wanted)                                                                                                                                                                                                                                 |
| A45       | 27     | **A disturbance never modifies terrain.** Terrain is derived — regenerated from the seed on load and deliberately unsaved — so an edit would vanish on restore. "Affected terrain" is expressed as a derived traversal penalty plus a renderer overlay, and the disturbance list is its own protocol layer                                                                                                                                                                         | — (settled; mutable terrain would need terrain to become saved state)                                                                                                                                                                                                                                  |
| A46       | 27     | Disturbance **mortality is rare in the demo** (0–12 deaths across ten seeds): a region covers ~1% of the map and animals walk out of it. The lethal path is real and exercised in a controlled test, but the demo-level cost is sublethal — 852 burns across those seeds — exactly as Step 25's disease turned out to be                                                                                                                                                           | — (settled; making it demographically significant would mean bigger or more frequent events, which the 91% experiment showed breaks recovery)                                                                                                                                                          |
| A47       | 28     | Animals do not seek _other_ animals' burrows — a burrow shelters whoever stands on it (through `isShelteredAt`, so thermoregulation and the `shelter` action both get it free), but only trails exert a pull. Giving burrows one would mean teaching the perception hot loop about features                                                                                                                                                                                        | a later step, if a species should ever compete for or inherit a den                                                                                                                                                                                                                                    |
| A48       | 28     | **Grazing clearings are not a feature.** Vegetation biomass already drops visibly where animals graze and regrows after, so a separate "clearing" would be a second mechanism for something the world already does — the same reasoning that kept drought out of Step 27 (A44)                                                                                                                                                                                                     | — (settled)                                                                                                                                                                                                                                                                                            |
| A49       | 29     | "Activity pattern" and "habitat preference" are named in the step's objective but are **not schema blocks**: there is no diurnal cycle for a pattern to exist in, and habitat preference is already expressed by `migration.tracksForage` plus the comfort band rather than as a field of its own                                                                                                                                                                                  | a later step, if a day/night cycle or a real habitat-suitability model arrives                                                                                                                                                                                                                         |
| A50       | 29     | The species roster is a hand-written **import list**, not a directory scan or a data file loaded at runtime. Runtime species authoring is explicitly out of scope for the step, and a static import list is the honest form of "species definitions are code"                                                                                                                                                                                                                      | — (settled)                                                                                                                                                                                                                                                                                            |
| A33       | 23     | Cooperative defense is passive (vigilance lowers the odds) plus a parent interposing; **mobbing** — prey collectively attacking a predator — is not implemented                                                                                                                                                                                                                                                                                                                    | a later social pass, if a species ever needs it                                                                                                                                                                                                                                                        |
| ~~⚠ A20~~ | 17     | **Health lost to dehydration never recovers** — the hydration system only subtracts, so a once-thirsty animal carried that damage for life while a mauled one healed                                                                                                                                                                                                                                                                                                               | **Done in Step 25** — a healthy, well-fed animal now slowly regains health from _any_ source of damage, gated on energy exactly as injury healing is. It lives in the disease system because that step is about recovery generally; injury healing remains the faster, severity-paid path on top of it |

### B. Configuration / structural debt

| #      | From      | Item                                                                                                                                                                                                                             | Owed to                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1     | 4         | `fixtures/createDemoSimulation.js` not renamed to `createEcosystem.js` (rename was pure churn)                                                                                                                                   | cosmetic cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ~~B2~~ | 4         | `config.demo` retained for _scenario_ selection (count + species id); biology did move to `config/species/*`                                                                                                                     | **Done in Step 29** — `config.demo` is now a `founding` **roster** (`[{ speciesId, count }]`) walked in order, so adding a species to the world is a line of config rather than a third hardcoded slot. The benchmark scenarios use the same shape                                                                                                                                                                                                               |
| ~~B3~~ | 6, 10, 11 | Metabolism, hydration, and aging parameters live in **global config sections** rather than per-species                                                                                                                           | **Done in Step 29** — metabolism, hydration, and aging are per-species blocks resolved against the config defaults                                                                                                                                                                                                                                                                                                                                               |
| ~~B4~~ | 7         | Perception radius resolved per-species from the registry (no entity field) — a _different_ pattern from B3                                                                                                                       | **Done in Step 29** — `perceptionRadius` became a `perception` block, so the third config pattern is gone and all species biology resolves one way                                                                                                                                                                                                                                                                                                               |
| B5     | 8, 14     | `utilityBreakdown` persisted on the entity rather than kept transient — could bloat saves at 25k animals; Step 14's per-entity `traits` object adds to the same pressure (though it is genuinely non-derivable and must persist) | **Measured and declined in Step 30.** On a 3000-tick demo save (1.78 MiB) `utilityBreakdown` is **3.3%**. The bulk is the **event outbox at 42.4%** (that is C3, surfacing somewhere new) and vegetation at 15.2%; `genome` (4.9%) and `memories` (4.0%) each cost more, and neither is derivable. Removing it means a save-format bump and a fixture regeneration to buy 3%. Still open, but now with a number attached — revisit if a save ever actually bites |
| B6     | 11        | `age` is a stored, per-tick-incremented field rather than derived from a `birthTick`; `updateInterval` staggering is supported and tested but unused                                                                             | **Measured and closed in Step 30** — `AgingSystem` is **0.17 ms/tick at large-5k (0.2% of a tick)**. There is no cost to remove, so deriving `age` would be churn. The staggering knob stays supported and unused, deliberately: the demo wants exact ages                                                                                                                                                                                                       |

### C. Known behavioural limitations

| #        | From      | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owed to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~⚠ C1~~ | 2, 3, 5   | **Entity spawning ignored terrain** — animals could spawn on impassable rock                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Done in Step 13** — founding spawns rejection-sample a passable position (deterministic scan as fallback). Externally submitted `entity.spawn` commands are still the caller's responsibility, by choice                                                                                                                                                                                                                                                                                           |
| ~~⚠ C2~~ | 12, 13    | **Parent references stayed valid only because entities were never removed**                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Done in Step 18** — bounded tombstone registry + a four-state lineage lookup (`alive` / `carcass` / `dead` / `forgotten`). Written at the engine's single removal chokepoint. The old "everything resolves" assertions were rewritten to assert the _resolution is accurate_, so they cannot pass vacuously                                                                                                                                                                                        |
| C3       | 1, 9, 13  | High per-tick event volume: one `entity.moved` per animal per tick, plus one `entity.fed` per eater and one `entity.provisioned` per nursing juvenile in range. Bounded by the event buffer and hidden behind the renderer's "show routine" toggle, but it competes for the retention window                                                                                                                                                                                                                                                             | **Step 30** / ongoing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ~~C4~~   | 10        | Single lake + no memory ⇒ animals stranded far from water die of thirst                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Done in Step 15** — animals remember where they drank and return to it. Re-tuned `dehydrationRate` 0.02 → 0.035 on a five-seed measurement: ~3× the visible water-seeking for a modest survival cost. Memory helps but does not make thirst free (0.06 nearly emptied one seed)                                                                                                                                                                                                                    |
| ~~C5~~   | 12        | Reproduction first exploded exponentially (8 → 1037 by tick 20 000; food never became limiting). An unchecked herbivore _should_ grow until something limits it                                                                                                                                                                                                                                                                                                                                                                                          | **Answered in Step 16** — predation is the limiter. Measured over 20k ticks on five seeds, grazers now oscillate in the 24–111 range instead of growing without bound. Disease (Step 25) can still add a second check                                                                                                                                                                                                                                                                                |
| ~~C6~~   | 7, 23, 24 | Perception is the dominant per-tick cost (O(r²) local scan), and **Step 23 added a second neighbour walk** (the social pass, +26 ms/tick at large-5k) over the same grid neighbourhood                                                                                                                                                                                                                                                                                                                                                                   | **Done in Step 30** — the second walk is gone (15.30 → 5.03 ms/tick): perception publishes its neighbour list to `world.neighbourhood` and the social system reads it, keeping its own walk as a checked fallback. The cell scan itself got ~28% cheaper per cell. Large-5k 86.59 → 68.75 ms/tick overall. **Ring-search early exit was rejected, not skipped** — ring order is by cell offset while the answer is nearest to the animal's _continuous_ position, so it would change which cell wins |
| ⚠ C8     | 5, 28     | **Animals spend ~49% of their time within two cells of the world boundary**, which is 6% of the area — measured with Step 28's engineering _disabled_, so it is pre-existing and not caused by it. Movement clamps at the edge (Step 5), so an animal whose heading points off-map slides along the wall instead of turning away, and they accumulate there. Nothing before Step 28 made it visible; the trail layer is effectively an occupancy heatmap, and 78% of trails formed on the edge. Engineering adds ~4.6 points on top via trail attraction | **Step 30** or a movement pass. Reflecting the heading at a boundary instead of clamping is the obvious fix, but it changes Step 5 behaviour for every system and needs its own ten-seed measurement — deliberately not attempted inside Step 28                                                                                                                                                                                                                                                     |
| C7       | 5, 9      | Two deliberate modelling choices: movement uses the **current** cell's terrain modifier (not the target cell), and feeding is **in-cell** (no separate eating range)                                                                                                                                                                                                                                                                                                                                                                                     | — (settled)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### D. Test / benchmark fragility observed

| #     | Item                                                                                                                                                                                                                                                                                                                                                                                                                          | Guidance                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1    | The determinism "benchmark-style" assertion had to be rewritten **four times** as biology landed (all survive → all carcasses → `entityCount === N` → `>= N`)                                                                                                                                                                                                                                                                 | Assert invariants that survive biology changes, not population outcomes                                                                                                                                                                                                                                                                                                                                                                              |
| D2    | `seekWater` is seed-dependent (seed 42 shows none in 3000 ticks; seed 7 does) — the test is pinned to a seed that exercises it                                                                                                                                                                                                                                                                                                | Prefer controlled scenarios over demo-behaviour assertions; pin the seed and say why                                                                                                                                                                                                                                                                                                                                                                 |
| D3    | Vegetation biomass is a `Float32Array`, so measured deltas carry ~1e-6 error                                                                                                                                                                                                                                                                                                                                                  | Use float32-appropriate tolerances (1e-5), not 1e-9                                                                                                                                                                                                                                                                                                                                                                                                  |
| D5    | Step 20's first "siblings differ" test bred _homozygous_ parents, where recombination is invisible and the assertion was vacuous                                                                                                                                                                                                                                                                                              | When testing a mechanism, first ask what setup would make it _unobservable_ — and make sure the fixture is not that                                                                                                                                                                                                                                                                                                                                  |
| D6    | Step 20's boundary scan rejected a file for the word "window." inside a doc comment                                                                                                                                                                                                                                                                                                                                           | Source scans must strip comments: a guard that fires on prose teaches people to word around it rather than trust it                                                                                                                                                                                                                                                                                                                                  |
| D7    | Step 21's selection sandbox broke under Step 22 and the cause was **not** the new step: breaking deaths down by cause showed they were entirely age deaths, so the "sparse food favours efficiency" pressure had never really been applied and the assertion had been passing on drift, pinned to a lucky seed                                                                                                                | When a seeded assertion breaks, ask what the fixture is _actually_ measuring before re-pinning the seed. Check the mechanism (here: deaths by cause), then re-verify on seeds it was never tuned against                                                                                                                                                                                                                                             |
| D8    | Step 22's first "condition keeps the display honest" assertion over-claimed: at `conditionWeight` 0.4 a large display genuinely does outweigh poor condition                                                                                                                                                                                                                                                                  | When an assertion about a model fails, decide whether the model or the assertion is wrong — then pin the real behaviour in _both_ directions so a future retune is caught in a unit test rather than a five-seed sweep                                                                                                                                                                                                                               |
| D9    | Step 23 added `case 'herd'` in the middle of a shared `switch` fallthrough chain, silently redirecting `seekFood` / `seekMate` / `followParent` into it. The result was a `NaN` heading, which fails the passability check, so animals **chose the right action and stood perfectly still** — five suites failed at once with "did not move"                                                                                  | A bare `case` added to a fallthrough group is a silent behaviour change, not an addition. And `JSON.stringify(NaN)` prints `null`, which sends you hunting a null-assignment bug that does not exist — check for `NaN` first when a numeric field reads `null` in a dump                                                                                                                                                                             |
| D10   | Step 23's first cuts of both group formation and alarm were unbounded local mechanisms, and both went global: alarm became a self-sustaining chain reaction (106/119 permanently fleeing), and herd labels never dissolved after a split                                                                                                                                                                                      | A local mechanism needs an _explicit_ bound — a hop count from the source — to stay local. Population density is not a bound                                                                                                                                                                                                                                                                                                                         |
| D11   | Step 24's `intrusionThreshold` was set equal to `markStrength`, so freshly marked ground sat exactly at the "occupied" threshold and decayed below it immediately — avoidance never fired at all                                                                                                                                                                                                                              | When one parameter is a threshold _on_ another, write the relationship down beside them. Equal values are the failure case, not the neutral one                                                                                                                                                                                                                                                                                                      |
| D12   | Two Step 24 tests assumed a resident still held the cell it was spawned on. It does not — it moves. A third asserted a stochastic time-on-claim comparison across two runs whose trajectories diverge from tick one                                                                                                                                                                                                           | Ask the world what is true (`heldGround` scans the grid) instead of assuming the setup held; and assert mechanisms, not outcomes compared across diverging runs                                                                                                                                                                                                                                                                                      |
| D13   | A Step 22 test measured event _retention_ rather than emission: it stepped 3000 ticks at once and then asked `eventsSince`, so the bounded outbox had long since trimmed everything but the tail. It passed only because a courtship happened to land in the surviving window, and Step 23's new events shortened that window until it reported **zero** courtships in a run that had 280                                     | Collect events tick by tick when counting them. `eventsSince` after a long `step(n)` measures what survived retention, not what happened                                                                                                                                                                                                                                                                                                             |
| D14   | Step 26 measured **3/5 seeds** against a 4/5 control and would have been ramped down for it. Bisecting the strength gave 1/5, 2/5, 3/5, 3/5 — non-monotonic, which is the tell. At **ten** seeds both read 4/10: the gap was noise and the canonical five seeds flatter the control                                                                                                                                           | The demo's two-species balance is a knife edge at ~3–9 stalkers. **Five seeds cannot resolve a one-seed difference.** When a sweep disagrees with a control by one seed, add seeds before touching a parameter — and treat a non-monotonic bisection as evidence you are tuning noise                                                                                                                                                                |
| D15   | Step 26's end-to-end test was written twice and was a bad test both times: first measuring diffusion across a small box (the control arrived just as fast), then measuring a ~1-unit displacement against a mechanism deliberately built to be gentle                                                                                                                                                                         | Before asserting an outcome, ask what the _control_ would score. If the control scores the same, the test measures the world and not the change. Prefer asserting the mechanism (here: the distribution of chosen headings) over the outcome it accumulates into                                                                                                                                                                                     |
| D16   | Step 26's "at zero strength nothing changes" guarantee was false by one ulp: `normalizeAngle(1.2)` is `1.2000000000000002`, and a fed animal on a real gradient does pass through the blend at strength 0                                                                                                                                                                                                                     | An identity path must be _exactly_ the identity. If a feature's safety argument is "at zero it does nothing", assert `===` on the untouched input — float-normalizing a pass-through silently makes it a different value, and it compounds                                                                                                                                                                                                           |
| ⚠ D17 | Step 27's fire recorded **no injuries at all** while still killing animals: `injuryPerTick` was 0.006 and `applyInjury` silently discards anything at or below `HEALED_BELOW` (0.02), so every call returned `null`. Visible only because a diagnostic happened to print burn counts _and_ deaths-by-cause side by side                                                                                                       | A shared helper with a **threshold** silently discards sub-threshold input, and a per-tick rate is exactly the shape that trips it. Before feeding a small value into an accumulator helper, check its floor — and when adding a new caller, assert the effect landed rather than assuming the call did something                                                                                                                                    |
| D18   | Step 27's first parameters left a disturbance running **91% of ticks**. Beyond over-pressuring the demo, it made the step's own acceptance criterion untestable: nothing ever finished recovering, so "recovery" could not be observed                                                                                                                                                                                        | For a mechanism whose visible result is _recovery_, the quiet interval is part of the design, not slack. Tune the duty cycle before tuning the severity, and sanity-check "what fraction of the time is this running?" — a mechanism that is always on has become the background rather than an event                                                                                                                                                |
| ⚠ D19 | Step 28's first cut ran in the phase its spec named (`environment`) and wore **nothing at all** for 15 000 ticks, because `lastMoveDistance` is an accumulator the metabolism system consumes and zeroes in `physiology`. Burrows, which read `action` instead, worked perfectly throughout                                                                                                                                   | A **half**-working feature hides much better than a broken one — burrows forming was positive evidence that made the missing trails look like a tuning problem rather than a wiring one. When one of two similar paths produces nothing, suspect the input before the parameters. And check whether a per-tick field is _consumed_ by a later phase before reading it from an earlier one                                                            |
| D20   | Step 28's cells flapped across the feature threshold: 9569 trails formed and 9081 lost in one run, each flap costing two events and a projection churn                                                                                                                                                                                                                                                                        | Any threshold a continuously-varying value crosses needs a **hysteresis band**, not a single number — cells will always sit near the boundary. Storing which side a cell is on is the right call even where "derive rather than store" is the house rule: with hysteresis the state genuinely depends on history, which a derived value cannot express                                                                                               |
| D21   | Step 28 tried to reduce that churn further by widening the band, and got 0.66 / 0.76 / 0.58 events per tick at bands of 0.7 / 0.5 / 0.3 — non-monotonic, i.e. noise. The residual churn was animals genuinely using and abandoning ground, not cells oscillating                                                                                                                                                              | Two distinct causes can produce the same symptom, and fixing the first does not mean the second is the same thing. When a parameter sweep comes back non-monotonic (§1.4 D14 again), stop tuning and ask what is actually generating the number                                                                                                                                                                                                      |
| ⚠ D22 | Step 29's first three-species sweep read 3/10 against a 6/10 control, and the cause was **not** the new species: `fleshIntakeRate` was a flat per-tick number, so a 4 kg scavenger stripped a carcass as fast as a 45 kg predator. Mass-scaling intake turned it into 5/10                                                                                                                                                    | A shared constant that is _correct for one size_ is a latent bug that only a second size can expose. When adding a variant that differs by an order of magnitude in some dimension, grep for constants that ought to scale with it before blaming the variant's own parameters                                                                                                                                                                       |
| D23   | Step 29's refactor broke **23 tests**, almost all in one way: they constructed a system with custom parameters and expected those to apply, but a species' resolved block now beats anything a system was constructed with — so the parameters have to reach the _config_ the registry resolves against                                                                                                                       | When a parameter's _source_ moves, every caller that supplied it the old way keeps working syntactically and stops working semantically. That is worse than a break. The fixes carry a ⚠ comment at each site for exactly that reason                                                                                                                                                                                                                |
| ⚠ D24 | Step 30 replaced `SpeciesRegistry.hunts`'s linear `includes` with a precomputed `Set` — obviously right for the busiest predicate in the engine. Two whole-simulation runs read it ~1% faster; two more read it slower. A microbenchmark of the predicate itself showed the `Set` is **35% slower**, because the rosters are one or zero entries long and hashing a string costs more than scanning an array of one. Reverted | **Whole-system timings on this machine cannot resolve a ~1% difference** — run-to-run spread at large-5k is ±10%. Reading one as signal is D14's five-seed mistake in a new costume. Benchmark the _thing you changed_, at a call volume where it dominates, before believing a whole-run delta. And treat "obviously faster data structure" as a hypothesis: constant factors decide small-N cases, and this codebase's rosters are small by design |
| D4    | All twelve completed steps still read `**Status:** Not started` until this review                                                                                                                                                                                                                                                                                                                                             | Update the `**Status:**` line, not just the checkboxes — the execution protocol keys off it                                                                                                                                                                                                                                                                                                                                                          |

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

> ⚠ **Date every completion note, and read every figure in one as of its date.**
> A completion note is a record of what was true when the step shipped, not a
> live reading — and the numbers in these notes _do_ drift, because each step
> changes the world the previous one was measured in. Step 26 reported juveniles
> dispersing a median of 70 units; after Step 29's species schema the same
> unchanged mechanism measures ~60. Neither figure is wrong, and the note is only
> misleading if you cannot tell which world it describes.
>
> So: each step's notes open with **Completed `YYYY-MM-DD`**, absolute and never
> relative ("recently", "after the next step", "currently" all rot). If you
> re-measure an old figure, add the new one _with its own date_ beside the
> original rather than overwriting it — the drift between them is usually the
> interesting part. The same rule applies to `README.md`, which describes the
> **current** build and must be re-measured rather than inherited.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

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
essentially unchanged; the rise is because the population _grows_ during the
benchmark (large-5k ends at ~7.3k entities rather than 5k). Mate search is
grid-local.

**Tuning note (parameters, not a cap — and an honest finding).** The first
parameter set was far too cheap: the population grew exponentially (8 → 1037
by tick 20 000, and in a small world 6 → 186 with vegetation barely dented and
_zero_ starvation — food never became limiting). That is the risk register's
"population explosion" materialising. I did **not** add a carrying cap;
instead I made reproduction genuinely costly and slow (37 energy per offspring,
80 %-full gate, ~2600-tick inter-birth interval against a ~5000-tick adult
life). The result is an emergent near-balance (births ≈ age deaths). This is a
cost parameterisation, not an enforced outcome — and it is worth stating
plainly that an unchecked herbivore _should_ grow until something limits it;
the real ecological checks are predation (Step 16) and disease (Step 25).

**Deviations from the step spec (minor):** (1) no sexes — either adult can
initiate and the lower id gestates; sexes/mate choice belong to Step 22.
(2) "Mate seeking" is implemented as a `seekMate` action that steers toward a
perceived conspecific; assessing _whether_ that individual is a desirable mate
is Step 22.

**Follow-on notes:** `parents` is the seam Step 13 (parenting: juvenile
dependency, following, provisioning, dispersal) and Step 21 (lineages) build
on; Step 20 attaches heredity at birth (the offspring-construction site in
`#births` is where genomes will combine). Parent refs stay valid because
entities are never removed — if removal is ever introduced (Step 18 carcass
decay), lineage refs will need care.

---

## Step 13 — Offspring and parenting

**Status:** Done

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

- [x] Coherent parenting + dispersal with valid relationships
- [x] Life cycle observable end-to-end
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (sparse relationships)

### Explicitly out of scope

Genetics, social groups beyond parent-offspring, predators.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Closes Milestone C — the
herbivore life cycle now runs end to end: born → parented → weaned →
dispersed → mature → reproduce → age → die, every milestone readable.

**What shipped.**

- **Simulation:** new `ParentingSystem` (`interaction` phase, priority 20 —
  after feeding and reproduction, so a guardian provisions from what it
  actually has after eating). A newborn is bonded to the parent that carried it
  (`guardianId`, part of the spawn definition); while the bond holds the system
  provisions it, weans it at `weaningAge`, and clears the bond when it outgrows
  the juvenile stage (dispersal) or when the guardian dies (orphaning). New
  entity fields: `offspring` (sparse inverse of `parents`), `guardianId`,
  `weaned`, and the bounded `lifeEvents` list. New shared helper
  `systems/lifeEvents.js` (`recordLifeEvent`, hard cap `MAX_LIFE_EVENTS = 12`),
  following the `death.js`/`killAnimal` precedent — several systems append life
  events, so the append and the bound live in one place. New
  `config.parenting`.
- **Juvenile dependency is a real constraint, not a top-up.** An unweaned
  juvenile does not graze at all: the decision system scores no `eat`/`seekFood`
  for one and the feeding system refuses it, so it lives entirely on
  provisioned energy (lossy transfer, and never below the guardian's own
  reserve floor). That is what makes it _follow_ the parent. First attempt had
  provisioning as a top-up on a juvenile that also grazed; measured, it
  delivered ~2.5 energy per juvenile — parenting existed but did nothing. Under
  real dependency it delivers **~29.5 energy per juvenile**, a genuine parental
  investment on top of the 37 already spent on mating and birth. An orphan is
  weaned on the spot and may feed itself, so losing a parent is a setback, not
  a death sentence.
- **Following is a decision, not a parenting side-effect.** `followParent` is a
  new action in `DecisionSystem`, so all action selection stays in one place
  and `ParentingSystem` never competes for `action`/`moveIntent`. Its utility
  is half the follow weight the moment the juvenile loses contact, ramping to
  full weight at the edge of perception — so keeping up always outranks aimless
  wandering but never outranks real hunger or thirst. (First shape scaled
  linearly from zero and lost to `wander` below distance 3, so juveniles drifted
  and were rarely in provisioning range; mean juvenile–guardian distance is now
  **1.97** world units.) `PerceptionSystem` reports a `guardian` entry — a
  juvenile can only follow a parent it can actually sense, and the check rides
  along inside the neighbor loop perception already ran, so it costs nothing.
- **⚠ C1 fixed:** founding animals are now spawned by rejection-sampling a
  passable position (with a deterministic scan as fallback), so no animal ever
  starts inside rock. Births already placed newborns on passable cells.
  Externally submitted `entity.spawn` commands are still the caller's
  responsibility — deliberately, since a command rejection would be a protocol
  behaviour change.
- **Protocol (v11 → v12):** two new events — `entity.provisioned`
  (`{ entityId, guardianId, amount }`) and `entity.lifeEvent`
  (`{ entityId, event, guardianId }`, carrying `weaned` | `dispersed` |
  `orphaned`). Inspection gained `offspring`, `parentingState`
  (`{ guardianId, dependent, weaned }`), and `lifeEvents`. Bulk snapshots are
  unchanged: relationships stay inspection-only so per-tick payloads stay lean,
  and `followParent` is already visible through the existing public `action`
  field. A test asserts none of the new fields leak into snapshots, and that
  inspection returns copies.
- **Renderer:** inspector gained a Family block (parents, offspring, the
  guardian a dependent is following with its nursing/weaned state) and the
  life-event timeline; the grid marks the selected entity's guardian and
  offspring with pink brackets; the event log formats both new event types and
  groups `entity.provisioned` with the routine (per-tick) events behind the
  existing "show routine" toggle. `SUPPORTED_PROTOCOL_VERSION` → 12.
- **Persistence (save v10 → v11):** the four new fields round-trip
  automatically; the new `ParentingSystem` descriptor changes the system
  lineup, so v10 saves are invalidated (noted in the serializer). Fixtures
  regenerated.

**Tests:** `npm test` → **211 passing / 0 failing** (was 193; +18). New
`test/parenting.test.js`: provisioning (transfer at a loss, out of range, the
guardian's reserve floor, a full juvenile costing nothing, the event),
weaning/dispersal/orphaning (including that an orphan may then graze), a
follow sandbox (a drifted dependent chooses `followParent` and closes the gap;
a nursing juvenile removes no biomass but the same animal does once weaned),
life history (the cap drops oldest-first, death closes the log with its cause,
a newborn and both parents record the birth), and protocol/demo integration
(inspection-only projection, inspection returns copies, the demo raises
juveniles born → provisioned → weaned → dispersed with every relationship ref
still resolving, founders never on impassable terrain, determinism over 2000
ticks).

**Visible result verified.** Against a live server (protocol v12): juvenile
#23, age 60, `action=followParent`, energy 72.5 (born at 60, provisioned up),
`parentingState {guardianId: 15, dependent: true, weaned: false}`, 2.74 units
from its guardian, with `eat`/`seekFood` scored 0 and `followParent` 0.447
beating `wander` 0.35. And a complete lineage read from inspection: #9 born
t843 → weaned t1094 → dispersed t1244 → birthed its own offspring t4171.

**Performance.** large-5k **35.3 → 33.4 ms/tick** (within noise, same ~7.3k end
population). Each animal is visited once and resolves its guardian by an O(1)
id lookup — no scan, no reverse index — and only bonded juveniles do any work.
Relationships are sparse arrays of a few ids; life histories are hard-capped.

**Deviations from the step spec (minor, documented):** (1) **Protection was
not implemented** — there is nothing to protect juveniles _from_ until
predators arrive, so it belongs with Step 16 rather than as an untestable
placeholder here. (2) `lifeEvents` is appended by three systems through one
shared helper rather than owned by a single system; the cap is a module
constant, not a config knob, because `killAnimal` has no config access and the
bound is structural rather than tuning. (3) Weaning uses an explicit
`weaningAge` but dispersal keys off `lifeStage !== 'juvenile'` rather than a
second age constant, so it can never drift from `aging.juvenileUntil`.

**Follow-on notes for later steps:** an orphaned _unweaned_ juvenile is
currently rescued by being weaned early; once predators (Step 16) make
orphaning common, that mercy is worth revisiting. `offspring` and `parents`
stay valid only because entities are never removed — carcass decay (Step 18)
still has to deal with that (§1.4 C2), and it now affects two fields, not one.
Per-individual variation of parental investment is Step 14; mate choice and
sexes are Step 22.

---

## Step 14 — Stable individual variation (non-inherited)

**Status:** Done

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

- [x] Per-individual traits with survival/behavior consequences
- [x] Traits inspectable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Inheritance (Step 20), mate choice on traits (Step 22).

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) The phenotype seam is in
place: Step 20 now only has to make these traits heritable, not invent them.

**What shipped.**

- **Simulation:** new `traits/traits.js` — `TRAIT_NAMES`, a frozen
  `NEUTRAL_TRAITS`, and `sampleTraits(random, spread)`. Each animal carries
  seven multipliers centred on 1.0, sampled once at creation from the `traits`
  stream and read-only thereafter. Sampling is triangular (two draws summed),
  so most individuals sit near the species mean and extremes are rare — what
  variation around a type should look like — with a fixed draw budget so the
  stream never shifts. New `config.traits.spread` gives behavioural traits a
  wider spread (0.3–0.4) than physiological ones (0.12–0.18): temperaments
  differ more visibly than body plans.
- **Every trait has a real consequence.** This was the design constraint —
  a trait with no effect would be exactly the "over-generalized abstraction"
  the risk register warns about, so nothing was added that could not be
  pointed at a system:

  | trait                    | what reads it                                                            |
  | ------------------------ | ------------------------------------------------------------------------ |
  | `size`                   | `adultMass` at spawn → aging growth curve → metabolic cost, carcass mass |
  | `speed`                  | `entity.speed` at spawn → movement distance and movement cost            |
  | `metabolicEfficiency`    | divides the metabolic burn → starvation resistance                       |
  | `boldness`               | scales `wander` up and `rest` down → ground covered vs. energy kept      |
  | `caution`                | scales hunger and thirst urgency → how big a reserve it keeps            |
  | `exploration`            | scales `explorationRate` → how often it ignores its own ranking          |
  | `reproductiveInvestment` | newborn starting energy, birth cost, provisioning rate                   |

  They are trade-offs, not upgrades: a bold animal finds more and spends more;
  a heavily investing parent raises better-stocked young at a higher price per
  birth. Nothing selects on them yet — that is Step 20.

- **Protocol (v12 → v13):** inspection gained `traits` and `adultMass`. Bulk
  snapshots are unchanged, per the step spec — traits are fixed for life, so
  streaming them every tick would be pure waste. A test asserts they never leak
  into snapshots and that inspection returns copies.
- **Renderer:** inspector trait panel — one centred bar per trait with the
  numeric value, so above/below average reads without comparing digits, plus
  the adult mass this individual is growing toward.
  `SUPPORTED_PROTOCOL_VERSION` → 13.
- **Persistence (save v11 → v12):** `traits` and `adultMass` are persisted —
  once a population has turned over they cannot be recovered from the seed
  alone. v11 saves are invalidated (noted in the serializer). Fixtures
  regenerated.

**Tests:** `npm test` → **229 passing / 0 failing** (was 211; +18). New
`test/traits.test.js`: sampling (every trait varies and is centred on 1,
deterministic per seed, zero spread ⇒ exactly neutral, fixed draw budget, and
a trait-less entity gets the frozen neutral set), the **demonstration
scenario** (two animals equidistant from one isolated food patch differing
only in the speed trait — the swifter one feeds first, and the outcome is
byte-identical across runs), physiological consequences (the efficient
individual keeps more energy; the larger one grows to its own adult mass and
burns more getting there), behavioural consequences (bold values roaming over
resting; the same hunger weighs more on a cautious animal; **neutral traits
reproduce the pre-Step-14 numbers exactly**), reproductive investment (a
generous parent's newborn starts richer and the parent ends poorer), and
protocol/persistence/determinism (inspection-only, returns copies, traits
round-trip through save/load and the restored run continues identically, the
demo stays deterministic, and the `traits` stream is independent of others).

**Visible result verified.** Against a live server (protocol v13) the eight
founders are visibly individuals — speed 1.15–1.31 u/tick, adult mass
28.7–31.9 kg, boldness 0.96–1.20, exploration 0.75–1.09 — and that spread
persists into the offspring born during the run. The inspector renders the
trait panel for whichever animal is selected.

**Performance.** large-5k **33.4 → 33.97 ms/tick** (within noise). Traits are
sampled once at creation, never per tick. The two values worth precomputing
are resolved at spawn (`speed`, `adultMass`); the aging system reads
`adultMass` through a **reused scratch object** rather than allocating a growth
record per animal per tick, which was the one real hot-path trap here. The
remaining trait effects are float multiplies inside loops that already run.

**Deviations from the step spec (minor, documented):** (1) the spec says
"precompute trait-derived multipliers" — only `speed` and `adultMass` are
precomputed onto the entity; the decision-weight and metabolism multipliers are
applied inline, because storing four more fields per animal to save four
multiplies is the wrong trade at 25k animals (measured: no detectable cost).
(2) `boldness` and `caution` were given distinct axes — boldness is roam-vs-rest,
caution is how early unmet needs dominate — rather than two names for the same
tendency; boldness gains its second, more natural effect (flight distance) at
Step 16. (3) Trait spread lives in `config.traits`, not in the species
definition; Step 29's species schema is the natural place to make it
per-species, and Step 20 moves the ranges into a genetics layer regardless.

**Follow-on notes for later steps:** `NEUTRAL_TRAITS` is shared and frozen, so
the "no variation" case costs nothing and cannot be mutated by accident —
Step 20 must keep expressing a _fresh_ traits object per individual rather than
mutating that one. `entity.adultMass` is nullable and the aging system falls
back to the species mean, which is what keeps every hand-built test animal and
externally spawned entity working unchanged. Each animal now carries a
7-number object, which is the first per-entity allocation worth watching if
Step 30 profiles save size (§1.4 B5).

---

## Step 15 — Memory and elementary learning

**Status:** Done

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

- [x] Bounded, decaying memories influencing behavior
- [x] Memories inspectable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (bounded memory)

### Explicitly out of scope

Predators, social learning, territories.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Animals now learn where things
are, and act on it when they cannot see.

**What shipped.**

- **Simulation:** new `memory/memories.js` — `MemoryKinds`
  (`food` / `water` / `barren` / `danger`), `recordMemory`, `forgetMemory`,
  `bestRemembered`, `isNearDanger`, and a hard `MAX_MEMORIES = 8`. New
  `MemorySystem` (`perception` phase, priority 10 — after perception is rebuilt
  and before decisions read it) does the fading and eviction. Two guarantees
  carry the risk register's "unbounded memory growth" row: at most 8 entries
  per animal ever, and re-experiencing a place _refreshes_ the existing entry
  rather than adding one, so standing in a patch for 200 ticks cannot fill the
  list. As with `recordLifeEvent` and `killAnimal`, insertion is one shared
  helper — several systems record memories, and keeping the append and the cap
  together is what makes the cap trustworthy.
- **Decay rates are per kind and deliberately unequal**, each for a stated
  reason: water fades slowest (~1250 ticks — a lake does not move), then
  danger (~1000), then food (~250 — a patch may already be grazed out), and
  `barren` fastest of all (~170, because vegetation regrows). Staggering is
  real: decay is multiplied by `updateInterval`, so running every 5 ticks fades
  memories at exactly the same rate as running every tick, and a test asserts
  the two are indistinguishable.
- **Writers are real experiences, not perception spam.** Feeding records where
  the animal _ate_; drinking records where it _drank_. Arriving somewhere
  remembered as food and finding it bare forgets that memory and records
  `barren` instead — which is what makes an animal's map self-correcting rather
  than an accumulating pile of stale beliefs.
- **Consumer:** two new decision actions, `recallFood` and `recallWater`,
  gated on perception having come up empty and weighted at `recallWeight: 0.8`
  — memory is deliberately _weaker_ than sight, since a remembered patch may
  already be gone. Recall targets are scored by strength discounted by
  distance, so a vivid memory across the map loses to a fainter one nearby.
  Because they are distinct actions rather than a memory-sourced `seekFood`,
  "this animal is navigating from memory" is visible through the existing
  public `action` field.
- **⚠ C4 re-checked and re-tuned, with the measurement recorded.** The plan
  predicted the dehydration rate "can likely go back up". Measured over 15k
  ticks on five seeds, that is only **partly** true: raising it from 0.02 to
  0.035 roughly tripled visible water-seeking (2.9k → 8.6k action-ticks) for a
  modest cost (58 → 46 survivors, 26 → 31 dehydration deaths), but 0.06 cost
  markedly more (seed 99 fell to a single survivor) for little extra behaviour.
  Settled on **0.035**, with the numbers written into the config comment so the
  next person does not have to re-derive them. Memory helps; it does not make
  thirst free.
- **Protocol (v13 → v14):** inspection gained `memories` (strongest first, as
  copies). Bulk snapshots unchanged — memory is per-animal and inspection-only.
- **Renderer:** inspector "Remembers" panel with a strength bar per place, and
  a grid overlay marking the selected animal's remembered cells with
  renderer-owned glyphs (`"` food, `~` water, `x` barren, `!` danger),
  alpha-faded by strength so forgetting is visible. Drawn _under_ entities and
  selection: it is one animal's private map, not world state. An unmapped kind
  draws nothing rather than guessing. `SUPPORTED_PROTOCOL_VERSION` → 14.
- **Persistence (save v12 → v13):** `memories` persisted (what an animal has
  learned is not derivable from the seed) plus the new `MemorySystem`
  descriptor; v12 saves invalidated. Fixtures regenerated.

**Tests:** `npm test` → **248 passing / 0 failing** (was 229; +19). New
`test/memory.test.js`: the bound (cap holds, faintest evicted first,
re-experiencing cannot flood the list, kinds are independent per cell), fading
(weakens then is forgotten, water outlasts food outlasts barren, staggering
does not change the rate), recall choice (near-and-faint beats far-and-vivid,
out-of-range ignored, danger poisons nearby recalls), what is learned (eating
and drinking record; a bare patch converts food → barren; founders start with
a blank map and learn by living), the **demonstration scenario**, and
protocol/persistence/determinism.

**Deterministic demonstration scenario.** Exactly as the step specifies, with
perception _disabled_ to prove the point: a near-blind animal (perception
radius 1, so nothing can be explained by sight) eats at an isolated patch, is
carried 12 cells away, and — with `nearestFood` confirmed null — chooses
`recallFood`, targets the remembered cell, and walks back to within 1.5 units.
The paired negative test is what makes it evidence: the same animal, same
position, same hunger, same blindness, but _no memory_, does not go back and
has no action target.

**Visible result verified.** Against a live server (protocol v14): animal #14
at 50% hydration with `perception.nearestWater: null` was walking toward cell
(69,33) — a water memory recorded at tick 6987 and faded to 0.19 strength —
with `recallWater` scoring 0.43 against `eat` 0.41 and `wander` 0.38. Other
animals showed 6–8 remembered places each, mixed food and water, at a spread
of strengths.

**Performance.** large-5k **33.97 → 37.18 ms/tick** (+3.2). The decay pass is
staggered and cheap; most of the rise is per-animal recall lookups in the
decision system. Both are bounded by the cap of 8, so the cost is flat in world
size and linear in animals — a scan of 8 entries, never a spatial query.

**Deviations from the step spec (documented):** (1) **Kin identity is not a
memory kind.** Lineage is already exact and non-decaying via
`parents`/`offspring`/`guardianId` (Steps 12–13), so a decaying kin memory
would duplicate authoritative state for no consumer; kin _recognition_ belongs
with mate choice (Step 22) and social groups (Step 23). (2) **`danger` ships
with avoidance implemented and tested but no writer** — nothing is dangerous
until predators exist. This is a tested capability awaiting its data source,
not decoration: `bestRemembered` refuses to recall a place near remembered
danger, an animal will not `rest` near one, and both are covered by tests that
record the memory directly. Step 16 only has to call `recordMemory`.

**Follow-on notes for later steps:** `recallFood` almost never fires in the
demo, because the demo world is blanketed in vegetation and `nearestFood` is
essentially always non-null — the gate is correct (why recall what you can
see?), but food recall will only start earning its keep when food becomes
patchy (seasons, Step 19) or contested. `barren` is rare for the same reason.
Memory is the first per-entity _growable_ structure in the engine; the cap is
enforced in the insert helper precisely so no future writer can bypass it.

---

## Step 16 — First predator species

**Status:** Done

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

- [x] Multi-stage hunt with real capture/escape dynamics
- [x] Visible pursuit, flee, success and failure
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Injury system (Step 17), scavenging mechanics (Step 18), pack hunting
(Step 23).

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Milestone D. The world now has
two species and a working predator/prey oscillation.

**What shipped.**

- **The hunt is a pipeline across the systems that already own each part**,
  which is what keeps it from being one opaque roll:
  _detect_ (perception reports `nearestPrey` / `nearestThreat`) → _evaluate_
  (the decision system gates on hunger, stamina, and a post-attempt cooldown)
  → _approach_ (`stalk`, at a walk, saving the sprint budget) → _chase_
  (sprint) → _capture-or-escape_ (`HuntingSystem`, one attempt inside striking
  range) → _feed_ (the feeding system's carnivore branch eats the carcass) →
  _recover_ (stamina regenerates in metabolism; `lastHuntTick` blocks an
  instant re-attack).
- **New species** `predator.stalker` and a `hunts(predatorId, preyId)` relation
  driven by the species' own `preySpeciesIds`. Perception reads it in _both_
  directions inside the neighbour loop it already ran — what I hunt, and what
  hunts me — so predation works without a single species-name conditional in
  any system.
- **Stamina** is the new resource that decides chases: `MovementSystem` spends
  it to sprint and drops to a walk when it runs out; `MetabolismSystem`
  recovers it when not sprinting. The same two-writer accumulator pattern as
  energy, documented on both sides.
- **Capture odds come from state, not a constant.** `captureChance` is the
  predator's speed against the prey's, weighted by how much sprint each has
  left and by how vulnerable the prey is (wounded, or not yet grown), clamped
  so nothing is ever untouchable and nothing is ever certain. Live sampling
  shows real spread — 31%, 34%, 37%, 43%, 49% across consecutive attempts — and
  the number is published on `entity.hunted` rather than hidden.
- **⚠ C5 is now answered.** Step 12 noted that "an unchecked herbivore _should_
  grow until something limits it" and owed the limiter to Steps 16/25.
  Predation is that limiter: grazers no longer grow without bound.
- **A16 (Step 15) is now written.** The `danger` memory kind shipped with
  avoidance implemented but no writer; a failed hunt now records the attack
  site in the prey's memory, exactly as predicted.
- **Protocol (v14 → v15):** three new events — `entity.hunted`
  (`{ entityId, targetId, chance, captured }`), `entity.killed`,
  `entity.escaped` — plus `predation` as an `entity.died` cause. `stalk`,
  `chase`, and `flee` ride the existing public `action` field, so a pursuit is
  visible in bulk snapshots without widening them; `stamina` and `huntTargetId`
  are inspection-only.
- **Renderer:** the stalker is `S`/red at display priority 60 (above prey, so a
  predator on its kill still reads as the predator); the event log formats hunt
  outcomes _with the odds the engine used_; selecting a predator brackets its
  quarry in red. `SUPPORTED_PROTOCOL_VERSION` → 15.
- **Persistence (save v13 → v14):** `stamina`/`maxStamina`, `huntTargetId`,
  `lastHuntTick`, a second species in the demo, and the new `HuntingSystem`
  descriptor; v13 saves invalidated. Fixtures regenerated.

**Two real bugs found by measuring rather than by tests.**

1. _Prey ignored distant predators._ Flee urgency was `1 - d/radius`, which is
   **zero at the edge of perception** — so a hungry grazer kept eating while a
   predator walked up to it. Reshaped to half weight at the boundary rising to
   full at contact (the same shape as following a parent). Caught by a test
   asserting fleeing outranks grazing, which failed for the right reason.
2. _Predators could never catch fleeing prey._ Stalking walks (1.35) while
   fleeing prey sprint (1.92), and the sprint only engaged inside
   `chaseRange: 4` — but prey bolt at up to 6 units, so the gap only ever grew.
   Predators starved in 4 of 5 seeds. Fixed by making a **fleeing target force
   the sprint regardless of range**, with `fleeing` exposed on the perceived
   prey record. This is visible in the live capture below: a chase at distance
   4.9, outside `chaseRange`, because the quarry had bolted.

**Tuning is measured, and the numbers are in the config.** Founding counts are
a knife edge: over 20k ticks on five seeds, a pack of 3 dies out in 2 of 5,
while 7 wipes the grazers out entirely in 3 of 5. At **4 predators against 60
grazers** both species survive in all five seeds, oscillating between roughly
24–111 grazers and 1–9 stalkers. Diagnosis before tuning mattered here:
predators were _not_ starving (mean energy 0.83, above the breeding threshold
68% of the time), so the failure mode was demographic stochasticity in a
founding population of 3, not an energy-budget problem.

**Tests:** `npm test` → **272 passing / 0 failing** (was 248; +24). New
`test/hunting.test.js`: the species relation (data-driven, both directions,
unknown species hunt nothing), perception (prey/threat detection bounded by the
grid), capture odds (faster predator ↑, faster prey ↓, tired predator ↓, tired
or wounded or half-grown prey ↑, always inside the floor/ceiling), capture and
escape (kill → carcass + events; miss → energy cost + a `danger` memory + an
escape event; the lunge costs stamina either way; no attempt out of range),
sprinting (faster than walking, spends stamina, exhausted animals drop to a
walk, recovery only at rest), pursuit behaviour (prey abandon grazing to run; a
predator stalks at range and commits up close; a fed or exhausted one does
neither), carnivore feeding (a predator eats a carcass, a grazer on the same
carcass ignores it — diet decides), and the demonstration scenario.

**Deterministic demonstration scenario.** The predation sandbox the step asks
for: one fixed pairing run at two capture-odds settings with everything else
including the seed identical. Both variants show the full pursuit (`chase`,
`flee`, an attempt); the favourable one produces a kill _and_ the predator
feeding on the carcass, the unfavourable one produces an escape and no kill.

**Visible result verified.** Against a live server (protocol v15) at tick 3085:
53 grazers, 6 stalkers, 37 carcasses. Caught mid-hunt — predator #80 `chase`,
stamina 90.5/100, committed to target #111 at distance 4.9 with
`fleeing: true`; quarry #111 `flee`, stamina 84.8, `nearestThreat` #80 at 4.7.
Both burning stamina, the gap closing.

**Performance.** large-5k **37.18 → 40.13 ms/tick** (+2.9), now with 333
predators among 5000 prey. `HuntingSystem` only touches predators mid-chase and
resolves targets by id; the classification cost rides inside the neighbour loop
perception already ran. The benchmark scenarios now seed predators alongside
prey, so the numbers describe a mixed population as the step requires.

**Deviations from the step spec (documented):** (1) hunting _behaviour_ lives
in the decision system rather than in `HuntingSystem`, which only resolves
captures — this keeps all action selection in one place, as with Step 13's
parenting, and avoids two systems competing for `action`/`moveIntent`.
(2) Predator `birthMass` and the aging curve still come from global config
rather than per-species, so a stalker cub is born at the grazer's 5 kg — the
same global-config debt as §1.4 B3, now spanning two species and more visible.
(3) Prey have no _spatial_ refuge from predators (cover slows both equally),
which is part of why the founding counts are a knife edge; terrain-aware
escape belongs with territory (Step 24).

**Follow-on notes for later steps:** carcasses now accumulate fast (37 at tick
3085 in the demo) and never decay — Step 18 is no longer optional cleanup but a
real need, and it inherits §1.4 C2 (relationship refs stay valid only because
entities are never removed). Injury (Step 17) already has its hook: capture
odds read prey `health`, so a wounded animal is measurably easier to catch.
Pack hunting (Step 23) would extend `HuntingSystem`'s single-attacker
assumption.

---

## Step 17 — Injury and healing

**Status:** Done

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

- [x] Nonfatal + fatal injuries with penalties and healing
- [x] Injuries inspectable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Disease (Step 25).

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Predation now has a middle
ground between untouched and dead.

**What shipped.**

- **Simulation:** new `injury/injuries.js` — `InjuryKinds`, `applyInjury`,
  `totalSeverity`, `refreshImpairment`, and a hard `MAX_INJURIES = 4`. New
  `InjurySystem` (`physiology`, priority 10 — after metabolism and hydration,
  so healing is charged against the energy the animal actually has left) does
  the recovery. Inflicting is a shared helper, matching `recordMemory` /
  `recordLifeEvent` / `killAnimal`; the system never inflicts, only heals.
- **`impairment` is a cached derived total**, recomputed in the one place the
  injury list changes. The movement and feeding hot loops read one number
  instead of walking a list — the same precompute pattern as Step 14's
  `adultMass`, and it means the penalties cost essentially nothing.
- **The loop that makes an injury matter.** A wound scales speed and feeding by
  its severity, and because `HuntingSystem.captureChance` already read prey
  condition (the hook noted in Step 16's follow-on), a limping animal is
  measurably easier to catch. Healing is slow and paid for in energy, and an
  animal below `healEnergyFloor` does not heal at all — so being wounded and
  being starved compound each other rather than being independent problems.
- **Wounds come from real events.** A failed capture usually leaves the prey
  hurt (`wound`), and a heavy enough prey can hurt its attacker on the way out
  (`trample`, scaled by the mass ratio) — hunting is now a gamble in both
  directions. A _successful_ capture wounds nobody: the prey is simply dead.
  Severity scales with how decisively the roll landed, so a marginal hit grazes
  and a decisive one mauls.
- **Fatal injuries** go through the existing `health <= 0` path, the same one
  dehydration uses, with cause `injury`.
- **Draw budget held fixed.** The hunting stream now spends exactly three draws
  per attempt (capture, then a wound roll for each animal) regardless of
  outcome, so injuries can never shift the stream. A test asserts the stream
  state is identical whether both animals are wounded or neither is.
- **Protocol (v15 → v16):** `entity.injured`
  (`{ entityId, injury, severity, sourceId }`) and `entity.recovered`, plus
  `injury` as an `entity.died` cause and `injured`/`recovered` life-event
  types. `injuries` and `impairment` are inspection-only.
- **Renderer:** the injured tint needed **no protocol widening** — a living
  animal below `HURT_HEALTH_FRACTION` is drawn in the hurt tone from the
  `healthFraction` that has ridden in every bulk snapshot since Step 4.
  `resolveColorToken` is kept separate from `resolveAppearance` so the glyph
  (a cached species fact) and the tint (a moment-to-moment condition) stay
  independent. Inspector gained an injury panel with severity bars and the
  impairment percentage. `SUPPORTED_PROTOCOL_VERSION` → 16.
- **Persistence (save v14 → v15):** `injuries` and `impairment` persisted (a
  wound and how far it has healed are not derivable from the seed) plus the new
  `InjurySystem` descriptor; v14 saves invalidated. Fixtures regenerated.

**Tests:** `npm test` → **294 passing / 0 failing** (was 272; +22). New
`test/injury.test.js`: the bound and derived total (severities stack and clamp,
damage past the cap is _folded in_ rather than dropped, a scratch below the
threshold is ignored, `refreshImpairment` cannot drift), penalties (a wounded
animal limps and feeds worse; an injury raises capture odds through the
existing formula), healing (wounds close and cost energy and restore health; a
starving animal does not heal; recovery is announced and written to the life
history; a wound that empties an animal kills it with cause `injury`), what a
failed hunt leaves (prey usually wounded with the event naming the attacker, a
lucky prey untouched, the predator sometimes trampled, a successful capture
wounding nobody, and the fixed draw budget), and
protocol/persistence/determinism.

**Deterministic demonstration scenario.** Exactly the one the step asks for,
built as a before/after/after measurement on one animal: ten unhurt ticks
establish a baseline distance, a 0.3-severity wound makes the same ten ticks
cover measurably less ground, the injury is still present halfway through the
recovery window **computed from config** (`(severity − HEALED_BELOW) /
healRatePerTick`), and it is gone past that window — after which the animal
covers exactly its baseline distance again.

**Visible result verified.** Against a live server (protocol v16) at tick
10954: predator #168 carrying a `trample` injury from its own prey, severity
0.172, 17% impaired, effective speed 1.361 against a 1.489 baseline. Life
histories show the full arc on prey too — grazer #33 injured t680 → recovered
t804, injured again t1538 → recovered t1644. Thirteen living animals were below
full health, which is what the grid tints.

**Performance.** large-5k **40.13 → 42.66 ms/tick** (+2.5). `InjurySystem`
skips uninjured animals after one array-length check, and the penalties are a
single cached multiply each.

**Deviations from the step spec (documented):** (1) hazards and fights are not
injury sources — nothing else in the world is dangerous yet, so failed captures
are the only writer, as predation was the only realistic source available.
(2) Injury does not have its own RNG stream; the wound rolls come from the
`hunting` stream that already governs the event that causes them, which keeps
the draw budget for one attempt in one place.

**Follow-on notes for later steps:** health lost to **dehydration never
recovers** — the hydration system only ever subtracts, so an animal that has
been thirsty carries that damage permanently while a mauled one heals. That
asymmetry was invisible before this step and is now conspicuous; it belongs
either with a general condition/recovery pass or with disease (Step 25).
Carcasses continue to pile up untouched (Step 18). Pack hunting (Step 23) will
want to attribute a wound to multiple attackers, which the current
single-`sourceId` event shape does not express.

---

## Step 18 — Carcasses and scavenging

**Status:** Done

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

- [x] Carcass edible mass, decay stages, scavenging, disappearance
- [x] Visible scavenging + decay
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Decomposition chemistry, microbes, insects.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) The death→nutrient loop opened
at Step 6 is closed, and the world removes things for the first time.

**⚠ C2 resolved — the policy, decided before anything was removed.** The engine
turned out to be _behaviourally_ null-tolerant already: parenting orphans a
juvenile whose guardian is missing, hunting abandons a vanished target,
reproduction skips a parent that is gone. What removal actually destroys is
**observability** of lineage. So the policy is "be honest, with a memory":
new `world/lineage.js` keeps a bounded tombstone registry (256 entries, FIFO),
and a lineage reference resolves to one of four states — `alive`, `carcass`,
`dead` (gone, but we remember who and what killed it), or `forgotten` (evicted).
`forgotten` is a _stated limit_, not a failed lookup.

The plan warned the existing invariant must not "silently start passing
vacuously", and it would have: `assert(entities.get(parentId))` becomes
meaningless once everything is forgotten. Both tests were rewritten to assert
the **resolution is accurate** instead — an id present in the world must never
report `dead`/`forgotten`, and one absent must never report `alive`/`carcass`.
Tombstones are written at the engine's single removal chokepoint
(`applyDeferredEntityChanges`), so no removal path — including a command-driven
`entity.remove` — can bypass them; a test covers that other path specifically.

**What else shipped.**

- **`CarcassSystem`** (`physiology`, priority 20 — after feeding has taken its
  bite, so nothing is removed out from under a scavenger mid-meal). Decay is a
  pure function of elapsed time, so the `updateInterval: 5` stagger cannot
  drift it — asserted by a test comparing interval 1 against 5.
- **Freshness matters.** `STAGE_YIELD` cuts flesh value at each stage
  (1 → 0.8 → 0.5 → 0.25), shared between the feeding system and tests through
  one `CarcassSystem.yieldFor`. Old remains are barely worth crossing the map
  for, which is what keeps scavenging from replacing hunting.
- **Nutrient return.** Whatever mass is left when a carcass goes is deposited
  into its cell via a new `VegetationGrid.addAt`, clamped to carrying capacity.
  A carcass eaten clean returns nothing — the scavengers already took it.
- **Protocol (v16 → v17):** `decayStage` added to `PUBLIC_ENTITY_FIELDS` (the
  renderer ramps its glyph from it; 0 on everything living), new
  `entity.decayed` event, and inspection gained resolved `lineage` plus carcass
  detail. Absolute `edibleMass` stays inspection-only.
- **Renderer:** `CARCASS_DECAY_APPEARANCE` ramps a fresh orange `%` down
  through `;` to faint `.` remains; the appearance cache key gained the stage so
  the ramp stays free. `SUPPORTED_PROTOCOL_VERSION` → 17.
- **Persistence (save v15 → v16):** `diedTick`, `deathCause`, `decayStage`, the
  `CarcassSystem` descriptor, and a new top-level `tombstones` block. The
  registry has to persist: without it a restored run would forget _different_
  animals than the original.

**The re-tune this step forced, and why it matters.** Making carcasses decay
changed the predator economics fundamentally, and exposed that **Step 16's
balance had been propped up by the pile-up**. Measured directly: with decay
disabled the demo held 62 grazers / 6 predators at 15k ticks; with decay on,
identical otherwise, grazers went extinct. The ever-growing heap of bodies had
been a free larder keeping predators fed without hunting. With it gone the old
60/4 world is bistable — 1–3 predators starve out, 4 wipe the grazers out, with
no stable middle. Scaling both cohorts up is what restores a real cycle:
**120 grazers / 8 predators leaves both species alive in 5 of 5 seeds** at 15k
ticks (roughly 74–255 grazers against 4–13 predators). Long runs still show
genuine predator–prey behaviour rather than a fixed point: at 24k ticks seed 99
sits near equilibrium (82 grazers / 10 predators) while seed 42 shows prey
release (373 grazers / 2 predators). Both are real outcomes, not bugs.

**Two bugs caught by writing the tests.**

1. `VegetationGrid.addAt` read `this.#capacity[i]` — but `#capacity` is the
   _scalar_ config value; the per-cell array is `#capacityPerCell`. Indexing a
   number gave `undefined`, so every deposit computed `NaN` and silently added
   nothing. The nutrient-return test failed on exactly that.
2. `test/movement.test.js` still asserted a single step never exceeds
   `speed × terrain modifier` — a bound from Step 5, before sprinting existed.
   It only started failing now because the denser demo produces a flee inside
   the tested window. Updated to the real ceiling (× the sprint multiplier),
   _and_ strengthened: a non-sprinting animal must still respect the old bound.

**Tests:** `npm test` → **312 passing / 0 failing** (was 294; +18). New
`test/carcass.test.js`: decay stages (announced once each, not per tick;
stagger-independent; yields strictly decreasing), being eaten (mass converts at
exactly the stated rate; an old carcass feeds less than a fresh one; one eaten
clean returns nothing), rotting away (disappears by the expected tick and feeds
the ground; the pulse applies once; the deposit is capped by carrying capacity),
lineage across removal (the four states, bounded FIFO eviction, every removal
path remembered, inspection resolving rather than handing over raw ids), the
demonstration scenario, and protocol/persistence/determinism.

**Deterministic demonstration scenario.** A hungry scavenger a short walk from
a fresh body: it approaches, feeds, the carcass decays through its stages and
vanishes — and is still resolvable as `dead` afterwards.

**Visible result verified.** Against a live server (protocol v17) at tick 3786:
158 grazers, 7 predators, 44 carcasses spread across all four decay stages
(25 fresh / 9 ripe / 7 dry / 3 remains) rather than piling up. And the C2 case
end to end — grazer #226's parents both resolve `dead` with cause `age` and
their death ticks, while its two offspring resolve `alive`.

**Performance.** large-5k **42.66 → 42.57 ms/tick** (no measurable change).
Removal actually _shrinks_ what every other system iterates: before this step
carcasses accumulated forever and every system paid to skip them.

**Deviations from the step spec (documented):** (1) there is no dedicated
scavenger guild — predators are the scavengers, since a third species is its
own scope. (2) The optional "local vegetation boost" is implemented as the
nutrient return on removal rather than a continuous seep, which keeps it a
single auditable event and makes "applied once" testable.

**Follow-on notes for later steps:** the standing carcass count now scales with
the death rate (44 at 158 grazers), which is a flow equilibrium rather than
growth — but `decayTicks: 3000` against a compressed lifespan means bodies are
conspicuous. Weather (Step 19) would plausibly modulate decay rate. The
tombstone registry is the natural home for the population/lineage metrics Step
21 wants, and its 256-entry bound is the first thing to revisit if lineage
questions need to reach further back.

---

## Step 19 — Weather and seasons

**Status:** Done

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

- [x] Seasons/weather with visible vegetation + behavior effects
- [x] Environment inspectable in status
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Atmospheric simulation, wind fields, precise climate.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) The world now has a turning
year — the first genuinely _global_ state in the engine.

**What shipped.**

- **Two clocks, deliberately separated.** The **season** and baseline
  temperature are pure functions of the tick: given a tick and a year length
  you can compute them with no history, which is what makes the cycle
  reproduce exactly across a save, a restore, or a fresh run. The **weather** is
  stochastic and stateful — drawn from the `weather` stream, held for a spell,
  then re-rolled on a fixed cadence with season-dependent odds (snow only in
  winter, drought only in summer, rain mostly at the shoulders). Because the
  re-roll is on a clock rather than a reaction, the stream advances predictably.
- **`WeatherSystem`** (`environment`, priority −10, ahead of vegetation) writes
  one small record; everything downstream reads it. Emits
  `environment.changed` only on a turn, never on temperature drift, which would
  flood the log.
- **The year is compressed** exactly as lifespan is (PLAN §3): a literal year
  would be 525,600 ticks and no demo run would ever reach winter.
  `ticksPerYear: 8000` puts four 2000-tick seasons inside a run, against a
  compressed `maxAge` of 12,000 — so an animal lives about a year and a half.
- **Thermoregulation** is charged as energy in `MetabolismSystem`, so a cold
  snap kills by burning an animal out — which is what hypothermia is. No new
  death path was needed; an animal that empties while under stress simply dies
  of `exposure` rather than `starvation`. Same mechanism, accurate label.
- **Shelter is a real mechanic, not decoration.** Cover removes ~55% of thermal
  stress, which is exactly why the new `shelter` action is worth taking.
  Perception finds the nearest cover in the cell scan it already ran.
  `thermalStress` lives in `world/Environment.js` and is shared by the system
  that _charges_ for it and the system that _decides to walk out of it_, so the
  two cannot drift.
- **Protocol (v17 → v18):** an `environment` block on full snapshots _and_
  deltas (a handful of scalars, so carried whole rather than diffed —
  `applyDeltaSnapshot` reproduces it exactly), plus the `environment.changed`
  event. Status bar shows `season · weather · temperature`.
- **Persistence (save v16 → v17):** the environment block is saved. The season
  could be recomputed from the tick, but the _held weather spell_ could not
  without replaying every roll, so it must persist.

**A modelling bug the first run exposed: seasons that did nothing.** Scaling
the vegetation _growth rate_ by season looked correct and changed almost
nothing — biomass moved 91k↔96k across the whole year. The reason is that
logistic growth toward a fixed capacity means a field already _at_ capacity
simply stops growing; a slower rate cannot brown it off. Winter has to shrink
the **ceiling**, not the rate. `VegetationGrid.grow` gained a `capacityScale`
and a dieback term, and the seasonal swing became real: **85.8k in summer
against 30.4k in winter**. A test pins the distinction directly — growth rate
alone leaves a settled field unchanged, lowering the ceiling shrinks it.
(A second bug: the temperature sinusoid was phase-shifted wrong, putting the
peak in mid-autumn. Caught by asserting the peak falls in the season actually
named `summer`.)

**A third ecological re-tune, and the pattern is now clear.** Seasons are a
large new pressure and the Step 18 balance did not survive them: at the first
amplitude (±14 °C) predators died out in 3 of 5 seeds. Measured sweep — ±14 →
2/5 both species surviving, ±11 → 4/5, ±9 → 4/5. Settled on **±11**, which is
also the better _model_: at ±14 the bare season pushed animals outside their
comfort band all winter, whereas at ±11 the season alone is survivable and it
is the **weather** that bites (snow −6, drought +5 on top). This is the third
consecutive step to invalidate the previous step's tuning; §1.4 now records
that as a standing expectation rather than a surprise.

**Tests:** `npm test` → **331 passing / 0 failing** (was 312; +19). New
`test/weather.test.js`: the cycle (four seasons in order, wraps, pure function
of the tick, peak in midsummer and trough in midwinter _in the seasons so
named_), spells (season-appropriate weather and only that, one draw per roll,
a spell holds then re-rolls, turns announced but not drift), vegetation (browns
off and greens up; **the ceiling is the lever, not the rate**; still monotonic
at full capacity as it always was), thermal stress and shelter (zero inside the
band, cover takes the edge off, the cold costs energy and kills as `exposure`,
an exposed animal heads for cover and a comfortable one does not), and
protocol/persistence/determinism including delta round-tripping.

**Deterministic demonstration scenario.** A full compressed year of the demo,
bucketing total biomass by season: summer > winter by a wide margin and every
season is visited. The paired stress test runs _two_ years and asserts animals
were pushed outside their comfort band and took cover — deliberately **not**
that anyone died of it, since whether a well-fed animal ever burns out is a
population outcome that shifts with tuning (§1.4 D1). The lethal path is
asserted directly in a controlled sandbox instead.

**Visible result verified.** Against a live server (protocol v18), watching the
year turn: winter snow at −2.2 °C with growth ×0.00, capacity ×0.30 and **16
animals sheltering**; winter clear at 3.1 °C, nobody sheltering; spring rain at
4.5 °C with growth ×2.16; summer drought at 27.1 °C cutting capacity to ×0.60;
autumn rain at 19.2 °C.

**Performance.** large-5k **42.57 → 46.11 ms/tick** (+3.5). The weather system
is free; the cost is the two per-animal reads (thermoregulation in metabolism,
shelter utility in decision). Vegetation pays one extra multiply inside a loop
it already ran.

**Deviations from the step spec (documented):** (1) snow is a weather state
that halts growth and chills, not a separate accumulating snowpack layer.
(2) There is no per-cell microclimate — temperature is global, and cover is the
only spatial modifier. A real thermal field belongs with terrain elevation,
which does not exist.

**Follow-on notes for later steps:** seasonal scarcity is the selection
pressure Step 20 (genetics) and Step 21 (evolutionary metrics) were waiting
for — `metabolicEfficiency` and `size` now have a season in which they
genuinely matter. Migration (Step 26) has its driver too. §1.4 A19 (hazards as
an injury source) is still open: weather is now harsh enough that cold snaps
are a plausible writer, but exposure currently kills through energy rather than
injury, which is the simpler model and worth keeping until something needs
otherwise.

---

## Step 20 — Genetics and inherited quantitative traits

**Status:** Done

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

- [x] Heritable quantitative traits with recombination + mutation
- [x] Visible parent-offspring resemblance
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Nucleotide sequences, epistasis networks, sexual selection (Step 22).

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Milestone E. Traits are now
inherited rather than resampled — and **nothing downstream changed**, which is
the payoff for having built the phenotype seam in Step 14. Every system still
reads only `entity.traits`.

**What shipped.**

- **New `traits/genetics.js`** — a diploid genome with one locus per heritable
  trait (all seven), and four operations: `sampleGenome` (founders only),
  `inheritGenome`, `expressGenome`, `genotypeOf`. Deliberately the simplest
  model that makes recombination _mean_ something:
  - **Additive expression** — a trait's raw value is the mean of its two
    alleles, so a child sits between its parents rather than picking a side.
    No dominance; that is a different model, not a missing feature.
  - **Independent assortment per locus** — one allele from each parent, chosen
    independently at every locus, so siblings genuinely differ.
  - **Bounded mutation** — a small perturbation with a fixed draw budget.
- **Tradeoffs, because without them selection has nothing to push against.**
  This was the part worth getting right: with no antagonism every trait would
  ratchet toward its maximum forever — bigger, faster, bolder, all at once.
  Expression charges three antagonistic pairs (mass costs speed, speed costs
  efficiency, boldness costs caution), computed from the **raw** genotype
  rather than sequentially, so the order of the table cannot change the result.
  A test pins that specifically.
- **Not a registered system.** The spec says "`GeneticsSystem` at birth (in
  reproduction/`interaction`)". Inheritance happens at one instant, and the
  reproduction system already owns that instant — so this is a module it calls,
  not a scheduled pass that would have to hunt for newborns each tick. Same
  call the spec describes, one fewer scan; consistent with `killAnimal`,
  `recordMemory`, `applyInjury`.
- **Protocol (v18 → v19):** inspection gained `genome` (the allele pairs),
  `genotype` (raw, pre-tradeoff), and `parentTraits` — which reuses Step 18's
  lineage lookup, so a parent that has decayed away reports its status instead
  of vanishing. Bulk snapshots are untouched.
- **Renderer:** a genetics panel showing alleles · genotype → phenotype ·
  parents, with the arrow drawn _only_ where the two differ — which is exactly
  where a tradeoff was paid, turning an otherwise mysterious gap into the
  explanation.
- **Persistence (save v17 → v18):** the genome persists (it cannot be recovered
  from the seed once a population has turned over); v17 saves invalidated.

**A boundary-scan false positive, fixed properly.** `test/engine.test.js`
rejected `genetics.js` for a "forbidden browser API" — the pattern `\bwindow\.`
matched the prose _"the mutation window. The magnitude…"_ in a doc comment.
The tempting fix is to reword the comment. The right fix is that a scan about
what code _does_ should not read prose: it now strips comments before matching.
Verified both ways — the prose no longer trips it, and real `window.` /
`Math.random` still do. A guard that fires on documentation teaches people to
word around it rather than to trust it.

**A test that could not have failed.** My first "siblings differ" test bred two
_homozygous_ parents — where every child is identical no matter which allele is
picked, so recombination is invisible and the assertion was vacuous. Rewritten
with heterozygous parents, and strengthened to assert that assortment is **per
locus** (some sibling inherits differently at one locus than another), which a
single whole-genome coin flip could never produce.

**Tests:** `npm test` → **354 passing / 0 failing** (was 331; +23). New
`test/genetics.test.js`: the genome (one diploid locus per trait, deterministic
sampling, neutral genome → neutral phenotype, additive expression), tradeoffs
(every pair names real loci; investing in one is paid out of another; genotype
and phenotype differ exactly where one applies; order-independence; expressed
values never reach zero, since several systems divide by them), inheritance
(alleles trace to parents, offspring inside the parental envelope plus one
mutation step, siblings differ, same parents + same stream → same child, fixed
draw budget, mutation bounded and absent at rate zero, single-parent births),
the inheritance sandbox, and protocol/persistence/determinism.

**Deterministic demonstration scenario.** Two parents at opposite ends of the
size range, bred repeatedly in a sandbox: every child's size genotype lands
inside the parental range plus one mutation step, and the offspring cluster
_between_ the parents — which is precisely the difference between inheritance
and the Step 14 resampling it replaced. The demo-scale test measures
midparent–offspring correlation and asserts it is real but not perfect
(qualitative resemblance, as the step asks).

**Visible result verified.** Against a live server (protocol v19), child #129
of parents #89 and #99, locus by locus: alleles `1.04/0.97` averaging to a size
genotype of 1.01 against a parent at 0.98; `1.05/0.90` → speed 0.97 from a
parent at 1.06. Measured across the demo at 9000 ticks, midparent–offspring
correlations of **0.70 (size), 0.55 (speed), 0.57 (boldness)** — real
resemblance, pulled below 1 by Mendelian sampling and mutation exactly as it
should be. And a tradeoff caught in the act: animal #239 with a size genotype
of 0.853 expressing 1.071 speed against a 0.998 genotype — credited 0.073 of
speed for being small.

**Performance.** large-5k **46.11 → 41.34 ms/tick** (run-to-run noise; genetics
does no per-tick work). Inheritance runs once at birth: 4 draws per locus plus
one expression pass, against a birth rate in the tens per thousand ticks. The
cost is memory — two alleles per locus instead of one value — still bounded.

**Deviations from the step spec (documented):** (1) no registered
`GeneticsSystem`, for the reason above. (2) No dominance or epistasis —
expression is purely additive, which the spec's "quantitative traits only"
framing allows and which keeps the genotype→phenotype map legible. (3) The
species mean is still the _founding_ distribution; there is no separate
"developmental influence" term, since the environment already shapes outcomes
through survival rather than through expression.

**Follow-on notes for later steps:** everything Step 21 needs is now in place —
genotype, phenotype, lineage, and cause of death — so trait distributions can
be tracked over generations and selection actually measured. Mate choice
(Step 22) has a genome to choose on. The three tradeoff pairs are the knob to
watch if Step 21 shows a trait ratcheting anyway; §1.4 A13 (trait spread living
in `config.traits` rather than per species) now also covers `config.genetics`.

---

## Step 21 — Evolutionary observation

**Status:** Done

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

- [x] Trait distributions, lineages, selection metrics observable
- [x] Selection emerges (not hard-coded)
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol version)
- [x] Performance checked

### Explicitly out of scope

Per-organism full histories, mate choice.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Milestone E is legible:
selection can now be _measured_ rather than assumed.

**What shipped.**

- **`metrics/metrics.js`** — a pure aggregation pass: trait distributions
  (mean, spread, extremes, and a fixed-bin histogram, for both phenotype and
  genotype), generation depth, reproductive success, births and deaths by
  cause, and a **selection differential** per trait: the mean among adults that
  actually bred minus the mean among all adults. Positive means breeders are
  above average for that trait — selection _in progress_, computed, never
  scripted. It reports `null` rather than `0` when nothing has bred yet, which
  is an honest "unknown" instead of a misleading "no selection".
- **`MetricsSystem`** in the `observation` phase — the last phase, after
  deferred spawns and removals flush, so it always sees settled state.
  Staggered every 50 ticks, because a summary view needs nothing like tick
  resolution.
- **Rates are derived from state, not from events.** Births in a window are the
  animals young enough to have been born inside it; deaths are the carcasses
  stamped with a `diedTick` inside it. Reading the event bus instead would
  couple metrics to event _retention_ (the buffer is bounded and gets trimmed)
  and would double-count on replay. A test pins the window behaviour directly.
- **New `generation` field** — lineage _depth_, one deeper than the deepest
  parent, written once at birth. Deliberately not a global cohort counter.
- **Protocol (v19 → v20):** a `metrics` query at `GET /api/metrics`, returning
  the aggregate plus the bounded history. Deliberately **not** in snapshots or
  deltas: histograms for every trait of every species would dwarf the entity
  array, and a test asserts snapshots stay clean.
- **Renderer:** a `MetricsPanel` polled on an interval, drawing histograms,
  trends, and selection differentials from numbers the engine computed. Its
  only arithmetic is scaling bars to the tallest bin, which is layout.
- **Persistence (save v18 → v19):** the _report_ is derived and deliberately
  not saved — it rebuilds on the next metrics tick — but the bounded history
  is, because a chart that resets on every restore is useless. That split is
  exactly what the step called for, and a test asserts both halves.

**The invariant that mattered most: observation must not perturb.** A metrics
layer that nudged anything would be measuring itself. The test that pins this
runs the demo twice — once with metrics on the normal cadence, once with the
system effectively disabled — and asserts the populations are **byte-identical**
after 600 ticks. A companion test asserts every animal's `traits` still exactly
equal `expressGenome(its genome)` after 1500 ticks of a selection run, so
nothing anywhere is quietly writing traits post-birth.

**Deterministic demonstration scenario — the selection sandbox.** A world where
efficiency is the thing that matters: scarce food, fast generations, no
predators, no seasons (a cycling food supply would confound the signal), and
genetic variance concentrated in `metabolicEfficiency` with everything else
near-clonal so the measurement is not polluted by other traits drifting.
Measured: mean efficiency **genotype** rose from 1.008 → 1.030 (seed 42) and
0.999 → 1.053 (seed 7) across ~19 generations in 5000 ticks. The assertion is
**directional only**, as the step asks — no magnitude, no exact value.

I also cut this test's runtime 50s → 21s after first writing it, by shrinking
the world and founder count rather than the tick count: the signal comes from
generations elapsed, not from population size, and 450 animals was simply
buying nothing.

**Tests:** `npm test` → **369 passing / 0 failing** (was 354; +15). New
`test/metrics.test.js`: the summary primitives (empty samples report nulls;
histograms count everything and clamp outliers in rather than dropping them),
aggregates **checked against a brute-force pass over the entities themselves**,
the window behaviour of birth/death rates, the selection differential computed
by hand on a rigged population, the system (stagger, bounded history,
observation-does-not-perturb, history summary stays small), the selection
sandbox, and protocol/persistence/determinism.

**Visible result verified.** Against the live demo at 9000 ticks: grazers at
generation depth 5 (mean 2.65), 1.03 offspring each, life stages
17/16/99/13, size distribution `[0,0,0,28,102,15,0,0,0]` around a mean of
0.993 ± 0.055, and 120 history samples retained. Deaths broken out by cause
(age 3, dehydration 3, predation 1 in the window). The predator row tells its
own story — 3 alive, mean efficiency 0.940, well below the grazers'.

**Performance.** No measurable change: aggregation is one O(N) pass every 50
ticks, and the history is capped at 120 small samples. Metrics never enter the
per-tick payload.

**Deviations from the step spec (documented):** (1) metrics are polled over
HTTP rather than carried in snapshots — recorded as §1.4 A27. (2) "Bottlenecks"
are left to the caller: the bounded history carries population per species over
time, which is the data a bottleneck is visible _in_, but nothing computes a
minimum or raises a flag. Detecting one is a judgement about what counts as a
crash, and inventing that threshold now would be guessing (§1.4 A28).

**Follow-on notes for later steps:** mate choice (Step 22) can select on the
genome that Step 20 added and this step made observable — and the selection
differential is exactly the number that will show whether it is doing anything.
§1.4 A22 (tombstones bounded at 256) turned out **not** to bite here, because
lineage depth is carried on the entity as `generation` and needs no lookup; it
would only matter for a query that walks ancestry.

---

## Step 22 — Mate choice and sexual selection

**Status:** Done

**Carried forward (see §1.4):** **A9** — there were no sexes; either adult could
initiate and the lower entity id carried the pregnancy. **A10** — the
`seekMate` action steered toward a perceived conspecific but assessed nothing.
Both were deferred here deliberately: preference only becomes meaningful once
traits are heritable (Step 20). The open question this step had to answer was
whether to introduce sexes at all, or keep hermaphroditic pairing and put all
the selection pressure in preferences. **Both are now resolved — sexes were
introduced; see the completion notes for the reasoning.**

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

- [x] Trait-based mate choice with costs
- [x] Sexual-selection effect observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Complex courtship displays, ornaments as separate entities.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Selection now has a second
mechanism, and it is measurably distinguishable from the first.

**The decision the step asked for: this simulation has sexes.**

The alternative was hermaphroditic pairing with all the pressure in mutual
preference, and I rejected it for one reason. Sexual selection is not really
about preference — it is about an **asymmetry in reproductive investment**.
One sex's output is limited by resources and time; the other's is limited by
access to the first. Without that asymmetry there is no principled reason for
either party to be choosy, and mate choice degenerates into two animals
filtering each other for no stake. So females gestate and therefore choose;
males clear a much lower energy bar (0.45 vs 0.8) and a much shorter refractory
period (200 vs 1800 ticks) because they pay for one mating rather than a
pregnancy. That also retires §1.4 A9's arbitrary "the lower entity id
gestates", which only ever worked because nothing cared who was who.

The thing I expected to be the problem turned out not to be. Sexes look like
they should halve the birth rate, and they do not: under the old rule a mating
consumed _both_ adults for a full cooldown to produce one pregnancy, so
pregnancies per adult per cooldown are unchanged — the male was never the
limiting resource. What actually changes is that a female now needs a _male_ in
range rather than any adult, and that is precisely the pressure that makes
choosing worth something.

**Preference is split deliberately in two.** _What_ is preferred is species data
(`species.matePreference`: the displayed trait, how sharply it discriminates,
how much plain condition counts), read generically so no system branches on a
species name — grazers display **size**, stalkers display **speed**. _How hard_
it is weighed is the individual's new heritable **`choosiness`** trait, so the
strength of sexual selection evolves rather than being a constant I picked.
Grazers displaying size is the load-bearing choice: size costs speed (the Step
20 tradeoff) and burns more energy at rest, so sexual and natural selection pull
against each other and the metrics can tell them apart.

**Choosiness costs, via a declining threshold.** A chooser insists on quality
`acceptanceThreshold × choosiness`, falling linearly to zero over
`choosinessPatienceTicks`. That is the classic sequential-search rule, and it
does two jobs: holding out for better costs breeding-window time she cannot get
back, and nobody holds out _forever_, so the mechanism cannot quietly starve a
small population to extinction on a threshold I chose.

**What shipped.**

- **`mating/mateChoice.js`** — sexes, `mateQuality`, `acceptanceThreshold`,
  `bestMateCandidate`. Not a system: assessment happens at the instant two
  animals are in range and reproduction already owns that instant (same
  convention as `killAnimal`, `recordMemory`, `applyInjury`, `inheritGenome`).
  Quality is half **signal** (the displayed trait against the species mean) and
  half **condition** (energy, health, freedom from injury) — condition is what
  keeps the signal honest, since an animal cannot fake being well fed.
- **`ReproductionSystem`** — receptive females drive the pairing loop, score the
  eligible males in `matingRange`, and take the best that clears the standard.
  Rejections are recorded and emitted, not silently dropped.
- **`DecisionSystem` / `PerceptionSystem`** — `seekMate` now steers toward the
  _best_ perceived candidate rather than the nearest (discounted by distance),
  which is where choice becomes visible: a female walks past a scrawny
  neighbour toward a better animal and pays for it in ground covered. The
  seeking sex takes the nearest and assesses nothing — the same asymmetry, in
  behaviour. Perception gained a bounded `mateCandidates` list built inside the
  neighbour pass it was already walking.
- **Protocol (v20 → v21):** `sex` added to `PUBLIC_ENTITY_FIELDS` (one short
  string, fixed for life, so it never dirties a delta after creation); new
  `entity.courted` event carrying quality _and_ the threshold it was judged
  against — the same discipline as `entity.hunted` publishing its odds, so a
  verdict is checkable rather than taken on trust; `entity.mated` gained
  `quality`, `entity.born` gained `sex`; inspection gained a `mateChoice` block;
  spawn validation rejects an unknown sex.
- **Metrics:** per-species sex counts, and a **per-sex selection differential**.
  That split matters more than it looks — sexual selection acts on the sex being
  chosen, so pooling the sexes dilutes the very signal the number exists to
  detect.
- **Renderer:** sex by letter case (`g`/`G`, `s`/`S`) so a herd's composition
  reads off the grid; an inspector mate-choice panel showing preference,
  choosiness, the current standard, and the last animal sized up; courtship in
  the event log; per-sex differentials in the metrics panel.
- **Persistence (save v19 → v20):** `sex`, `mateSearchSince`, `lastCourtship`,
  and the new `choosiness` locus. v19 saves are invalidated — their animals have
  no sexes and could never pair.

**Tuning is measured (five seeds, 15k ticks, against a control with choice
off).** Sexes plus choice are an energy/mortality-adjacent change, so the
handoff's rule applied:

|                            | seeds alive | grazers    | size genotype     | mean S(size) male / female |
| -------------------------- | ----------- | ---------- | ----------------- | -------------------------- |
| choice off (control)       | 5/5         | 138–247    | 0.997 → 1.012     | +0.004 / −0.001            |
| patience 700               | 4/5         | 17–326     | 0.997 → 1.035     | +0.012 / −0.002            |
| **patience 400 (adopted)** | **5/5**     | **75–351** | **0.997 → 1.040** | **+0.012 / −0.002**        |

400 is not a compromise: it selects exactly as hard as 700 while leaving both
species alive in every seed instead of four of five. Being choosy for longer
bought nothing but a thinner margin. Note the signature in the last column —
positive among males, flat among females. That is what sexual selection looks
like when only one sex is being chosen; natural selection moves both together.

**Deterministic demonstration scenario — the sexual-selection sandbox.** The
measurement is deliberately **comparative**: the same seeded world run with
choice on and with choice off. Asserting only that size rose would prove
nothing, since size drifts and a run is one sample; asserting it rose _further
with choice than without_ isolates the mechanism, and the per-sex differential
says which sex it acted on. Measured: **0.976 → 1.051 with choice against 0.976
→ 0.998 without** — three and a half times the movement. Direction only, as the
step asks; no magnitude is pinned.

**Tests:** `npm test` → **406 passing / 0 failing** (was 369; +37). New
`test/mate-choice.test.js`: the sexes (vocabulary shared with the protocol, the
sex stream, balanced founding cohorts), what makes a good mate (display,
condition, saturation, a species with no preference), the cost of choosiness
(higher standard, monotonic decline, no deadlock), who an animal walks toward
(the chooser passes a poor neighbour, but not across the meadow; the seeker
takes the nearest; perception's bounded candidate set), pairing (only
opposite-sex pairs; **the female gestates even when the male holds the lower
id**; best-not-nearest; same standard, different verdicts; a picky female waits
longer; nobody holds out forever), observability (the event carries the numbers
behind the verdict; re-checking is not re-reported; inspection returns copies;
bulk snapshots stay clean), metrics per sex checked against a brute-force pass,
determinism and persistence, and the sandbox.

**Three things worth recording because they were not what I expected.**

1. **A test that failed for the right reason.** My first "condition keeps the
   display honest" assertion said a starving animal always scores below a
   healthy average one. It does not: at `conditionWeight` 0.4, a starving animal
   near the top of the size range still wins. That is the handicap reading of
   the signal rather than a gap in it, so the assertion now pins the real
   behaviour _in both directions_ — a modest display loses to condition, a large
   one does not — and anyone who retunes the weight finds out in a unit test
   rather than in a five-seed sweep.
2. **Step 22 invalidated Step 21's selection sandbox**, exactly as the risk
   register predicts for consecutive steps. Diagnosing it rather than re-pinning
   the seed was the whole value: breaking the deaths down by cause showed they
   were _entirely_ age deaths on all five seeds. The "sparse food favouring
   efficiency" pressure had never really been applied — the assertion rose in 4
   of 5 seeds by drift, and passed because it was pinned to one of the four.
   Retuned (capacity 1.4 → 1.0, basal rate 0.04 → 0.08, mate choice off so it
   measures one force) it now rises in **5 of 5**, four of them seeds it was
   never tuned against. Worth naming: even now almost nothing starves —
   efficiency pays through the _breeding gate_, so this is fecundity selection,
   not viability selection.
3. **Event volume was a real cost, fixed rather than absorbed.** Emitting one
   `entity.courted` per assessment produced ~1.7 events per tick across the demo
   (26k over 15k ticks), competing for the bounded retention window (§1.4 C3) —
   because a female beside a male must reassess him every tick as her standard
   falls. Reporting only a _new candidate or a changed verdict_ cut it 20× to
   ~1.4k, and reads better: "sized up #57, walked on", then later "sized up #57,
   accepted".

**Also fixed along the way:** `test/species.test.js` asserted spawned speed
against the _speed_ trait spread alone, which silently ignored the Step 20
size→speed tradeoff and only held while no founder sat far out on both loci at
once. It now asserts the identity (`speed === baseSpeed × traits.speed`) rather
than a distribution outcome — §1.4 D1's lesson.

**Visible result verified.** Against a live server at protocol v21: 130 animals
projecting `sex` (63 female / 67 male) with no internal fields leaking into the
bulk snapshot, and grazer **#290** courting four males over a single WebSocket
window — rejecting #180 (quality 0.521 against a standard of 0.718), #171
(0.566), #158 (0.632), and #160 (0.667 vs 0.733) — and then **mating with #160**
once her standard had fallen below him. Another female accepted at a standard of
0.000, her patience fully spent. Inspection shows the basis of the choice
(preference `size`, choosiness 1.020, the last courtship and its numbers), and
`GET /api/metrics` reported the signature live: selection differential on size
**+0.021 among males, −0.002 among females**.

**Performance.** large-5k **41.42 → 46.06 ms/tick**, inside the 41–46 band this
scenario has bounced through since Step 19, with the end population up 7060 → 7233. Assessment is a little arithmetic per receptive female, inside a grid
query reproduction was already making, consuming **no randomness at all** — a
test asserts that a run where a female rejects a male leaves every stream
exactly where a run where she accepts one does, which is the fixed-draw-budget
rule applied to a system whose budget is zero.

**Deviations from the step spec (documented):** (1) **Preference direction is
species data, not a heritable preference locus** — only its _strength_
(`choosiness`) is inherited. Full Fisherian runaway needs a heritable preference
and would multiply the model; this keeps the "what" a species fact and lets the
"how much" evolve, which is enough for sexual selection to act and be measured.
(2) **`GESTATING_SEX` is one model-wide constant rather than per-species data** —
declaring it per species when every species would set it identically is the
"over-generalized abstraction" the risk register warns about; Step 29 can make
it data if a species ever needs the other answer. (3) **Founding cohorts are
dealt alternating sexes rather than drawing them** — a founding cohort is
scenario setup (the same judgement that already spreads founder ages), and
drawing would leave an 8-strong predator cohort one unlucky seed from a sex
ratio that cannot breed, which would be a measurement artifact rather than an
ecological finding. Everything born in-world draws its sex.

**Follow-on notes for later steps:** `sex` is now available to Step 23 (social
behaviour), where dominance and fights are the obvious consumers, and to Step 24
(territory), where holding ground is usually about mate access. §1.4 A15 (kin
identity omitted from memory) is still open and still points at Step 23 — mate
choice did not need kin _recognition_, since it never had to avoid relatives;
inbreeding avoidance would be the first real reader for it. The `matePreference`
block is another per-species field that Step 29's species schema should absorb
alongside B3/B4/A13.

---

## Step 23 — Social behavior

**Status:** Done

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

- [x] Bounded groups, herding, alarm, dominance, kin recognition
- [x] Social structure observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (no global matrices)

### Explicitly out of scope

Territory (Step 24), complex politics, multi-level societies.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Milestone F. Four carried-forward
debts closed with it (A11, A15, A19, and the last of A9/A10's consequences).

**A herd is a label, not a roster.** That is the whole design, and it is what
keeps invariant 17 satisfied: nothing anywhere holds a membership list, and no
per-pair structure is ever built. Animals converge on a shared `groupId` by
local propagation — take the smallest label you can see — so herds form, merge
on contact, and split when they lose sight of each other, all from one
grid-local neighbour query per animal and without a single structural operation.

Two things had to be bounded before that worked, and both were found by running
it rather than by reasoning about it:

1. **Alarm was a chain reaction.** Alarmed animals re-alarm the neighbours who
   alarmed them, so panic never runs out of fuel: the first cut left **106 of
   119 grazers permanently fleeing**. Every alarm now carries its distance in
   hops from whoever actually saw the predator and dies at `maxAlarmHops`.
2. **Labels never dissolved.** "Take the smallest label in sight" only ever
   moves labels _downward_, so when a herd tore in half the piece without the
   root kept the old label forever and two herds on opposite sides of the map
   stayed nominally one. Labels now carry hops from their root too; an orphaned
   half has no route back, its hop counts climb a tick at a time until they
   exceed the cap, and it re-founds on its own.

   These are the same trick, and the lesson is the same one: **a local mechanism
   needs an explicit bound to stay local.** Density is not a bound.

**Dominance is derived, never stored.** There is no pecking order in state and
no memory of who beat whom — that is the "complex politics" this step rules out,
and it would also be per-pair. An animal's standing is read off what it _is_:
mass, condition, soundness, boldness, maturity. So it falls when the animal is
mauled and comes back when it heals, which is the point — a rank you cannot lose
by being hurt is a title, not a rank.

**Where dominance bites: male–male competition.** Rivals in range of the same
female contest for access, resolved pairwise down the list (one contest per
extra suitor, never a bracket). The stronger wins — there is no roll to lose, so
the event reports both _scores_ rather than odds. What chance governs is whether
the loser yields or they actually fight, and that is likeliest between evenly
matched animals: a rival twice your size is not worth bleeding for. Fights are
the **second writer of injuries** (§1.4 A19), after failed hunts.

This lands directly on top of Step 22 and the interaction is the interesting
part: **competition decides who she is offered, choice decides whether she takes
him.** Neither silently overrides the other. Step 22's "she takes the best male
present" test broke the moment contests landed, which was the honest signal that
the pipeline had grown a stage — it is now a test of the whole pipeline.

**Kin recognition finally has a reader** (§1.4 A15). Step 15 left kinship out of
the decaying spatial memories because nothing consumed it and a fading copy would
duplicate authoritative state. Defense consumes it — and reads `parents` /
`offspring` **directly**, which is why the memory kind is still not needed:
recognition here is lineage, not a scent, and the lists are exact, sparse, and
already persisted.

**What shipped.**

- **`social/dominance.js`** — `dominanceOf`, `isKin`, `resolveContest`. A shared
  helper, not a system: all three are judgements about a pair at one instant, and
  the systems that need them own that instant (same convention as `killAnimal`,
  `recordMemory`, `applyInjury`, `inheritGenome`, `mateQuality`).
- **`SocialSystem`** (`decision` phase, priority −10, ahead of the decision
  system) — labels, the transient `world.social` summary, and alarm.
- **`DecisionSystem`** — `herd` (cohesion _and_ alignment, so it is group
  movement rather than a huddle) and `defend`; an alarmed animal flees from where
  it was _told_ the threat was. Herding is scaled by `(2 − boldness)`, reusing
  the trait that already governs roaming rather than adding an eighth one.
- **`HuntingSystem`** — cooperative defense: adult groupmates shave the capture
  chance with diminishing returns, capped so a big herd is never untouchable; an
  interposing parent counts double and makes the attempt genuinely dangerous for
  the predator. Both halves are read from state that already exists — the social
  summary and the prey's own sparse `parents` list — so no new scan.
- **Protocol (v21 → v22):** `groupId` in bulk snapshots; `entity.alarmed` (with
  the hop count, so a wave is readable), `entity.contested` (both dominance
  scores, and whether it escalated), `entity.defended`; a `social` inspection
  block. **Persistence (save v20 → v21):** the label, its hop count, alarm state,
  and `lastContestTick` — the only social state there is.
- **Renderer:** the selected animal's herd bracketed on the grid, a Herd
  inspector panel, the three events in the log, herd statistics in the metrics
  panel.

**Tuning is measured** (five seeds, 15k ticks, against a control with the social
_behaviours_ switched off):

|                         | seeds with both species alive | grazers    | stalkers |
| ----------------------- | ----------------------------- | ---------- | -------- |
| sociality off (control) | 3/5                           | 0–320      | 4–23     |
| **sociality on**        | **5/5**                       | **34–135** | **4–19** |

The direction surprised me. Herding gathers prey into clusters a predator can
find, which ought to _raise_ predation — and the measured net effect is the
opposite: sociality **stabilises** the system, trading a much lower peak grazer
population for never losing them. One control seed lost its grazers outright.
Both halves of that trade are worth having; a demo that swings 0–320 is one bad
seed from an empty world.

**Tests:** `npm test` → **448 passing / 0 failing** (was 406; +42). New
`test/social.test.js`: dominance (every input moves it; a wounded animal's
standing returns when it heals, because nothing is stored), kin recognition,
contests (the stronger always wins; ties go to the lower id; a **fixed
three-draw budget** whatever happens; even matches escalate far more than
lopsided ones; a fight hurts the loser more than the winner and a yield hurts
nobody), herds (form, merge onto the smaller label, split, respect the cap even
when a crowd joins in one tick, never mix species, and build no roster), alarm
(reaches beyond line of sight, stops at the hop cap, reports how far it
travelled, expires, and fires on the transition only), herding (a straggler
holds station against a control, herding loses to fleeing, a bolder animal is a
looser member, and an animal that loses contact is gone), defense, cooperative
defense, protocol/metrics/persistence, a **near-linear scaling guard** for
invariant 17, and the herd sandbox.

**Deterministic demonstration scenario — the herd sandbox.** Cohesion measured
**against a control** (`herdWeight: 0`), because "the animals ended up near each
other" proves nothing about animals that started near each other; what has to be
shown is that they stay closer _than they would have_. And a long line of grazers
with a stalker at one end: the near end panics, the far end never hears about it,
and at least one alarmed animal was warned by a neighbour rather than by its own
eyes — local propagation with no global effect, which is exactly what the step
asks for.

**Three findings worth recording.**

1. **A `switch` fallthrough I severed.** Adding `case 'herd'` in the middle of
   the shared `case 'seekFood': case 'seekMate': case 'followParent': …` chain
   silently redirected all of them into the herd branch, where a missing field
   made the heading `NaN` — and an animal with a `NaN` heading fails the
   passability check and **stands perfectly still**. Five suites failed at once,
   all reading "chose the right action, did not move." Worth remembering twice
   over: a bare `case` added to a fallthrough group is a silent behaviour change,
   and `JSON.stringify(NaN)` prints `null`, which sent me looking for a
   null-assignment bug that did not exist.
2. **⚠ Step 21's selection sandbox has never demonstrated what it claims** — and
   this is a genuine unmet acceptance criterion, recorded rather than papered
   over (§1.4 A31). Step 22 already found the pressure was barely applied;
   measuring properly this time across seven seeds showed the trait moves up in
   3 and down in 4, mean change −0.0002, with the selection differential
   _negative_ in five of seven and its sign uncorrelated with the direction the
   trait went. The cause is now understood and is a property of the metric: the
   differential compares breeders against **all** adults, and in that world
   **71% of adults are breeders**, so the two samples are nearly the same set.
   Tightening the breeding gate does make it visible (breeder share 3–17%, an
   order of magnitude larger differential) but every such setting drove the
   population extinct. The test now asserts what the fixture genuinely shows and
   claims **no direction**; building a world that demonstrates the claim is
   Step 21 scenario 9's work, not Step 23's.
3. **Juvenile defense is implemented, tested, and demonstrably rare.** Over
   12 000 demo ticks it fired **once**. The geometry it needs — an adult with a
   living juvenile of its own, that juvenile nearer the predator than the parent
   and inside `defendRange` — almost never comes up, partly because grazers flee
   readily and partly because juveniles disperse early. It is not broken (unit
   tests pin both the decision and its effect on capture odds), it is rare, and
   saying so is more useful than calling A11 done and moving on (§1.4 A32).

**Visible result verified.** Against a live server at protocol v22: 120 animals
in **18 herds** (sizes 12, 12, 12, 9, 7, 7, 6, … capped exactly at 12) with 15
solitary. A wave of alarm crossing the population with the hop counter telling
the story — **93 first-hand sightings, 229 at one hop, 331 at two, and nothing
beyond the cap**. Dominance contests reading correctly: animal #26 (dominance 29) turning away rivals of 21–27 one after another, all yielding because it
outmatched them; over the window, 164 contests, 57 escalating into fights, 114
battle wounds.

**Performance.** large-5k **46.06 → 72.01 ms/tick**, the largest jump since
perception in Step 7 and the same cause — a _second_ `queryRadius` per animal per
tick on top of perception's. Still ~14× inside the tick budget, so it is recorded
rather than optimized, and the fix is named: perception and sociality walk the
same grid neighbourhood, so the social pass folds into perception's existing loop
for close to nothing. That is Step 30's work; it joins §1.4 C6. The demo-default
row nearly doubled (0.60 → 1.05) for an interesting reason — herding _clusters_
animals, so every grid query returns more neighbours. Sociality makes its own
neighbourhoods denser.

**Deviations from the step spec (documented):** (1) **Contests live in the
reproduction system**, not a system of their own — reproduction already gathers
the eligible males around a female, and a second system would have duplicated
that scan for the same instant. (2) **Cooperative defense is split in two**:
passive (adult groupmates lower the capture chance, i.e. collective vigilance)
and active (a parent interposing). Mobbing — prey collectively attacking a
predator — is not implemented; the passive form is what a herd actually buys you
and it needed no new behaviour. (3) **`groupId` is projected in bulk snapshots**
rather than inspection-only, because a herd you cannot see is not a visible
result; nothing else social is projected. (4) **§1.4 A12 (orphan mercy) was left
alone deliberately** — this step already changed juvenile survival through
defense and through herding, and removing the mercy in the same step would have
moved two variables at once with no way to attribute the result.

**Follow-on notes for later steps:** Step 24 (territory) has what it needs —
`groupId`, dominance, and contests are exactly the machinery a territorial
dispute is made of, and `world.social` is the seam a home-range summary would sit
beside. The `defend` rarity above may fix itself there, since territory keeps
animals and their young in the same place. Step 30 now has two named neighbour
passes to fold together (§1.4 C6 and this step's).

---

## Step 24 — Territories and home ranges

**Status:** Done

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

- [x] Emergent home ranges/territories with marking + conflict
- [x] Ranges observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Global territory partitioning, optimal boundary solving.

### Completion notes

**Completed 2026-07-19.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) Nothing in this step draws a
boundary or assigns anyone a plot. Two mechanisms run, and every behaviour the
step lists is a consequence of them.

**A home range is four numbers, not a trajectory.** An exponentially-weighted
centroid of where an animal has actually been, plus its mean distance from that
centre, updated in O(1) per tick. That is a direct answer to the step's own
performance note ("bounded per-animal spatial summary, not full occupancy
history"): a decaying mean _is_ "repeated-use area" without storing a single
past position. An animal that keeps returning somewhere tightens its range
around it; a rover reports a wider one; an animal that moves house drags its
range along behind it. Nobody sets the radius — it is measured. A test asserts
the record cannot grow with the length of the animal's life, which is the
property that matters however the rest changes.

**A territory is a mark on the ground.** `world/ScentGrid.js` holds two numbers
per coarse claim cell — who claims it, how fresh the claim is — and everything
else falls out of that pair rather than being modelled beside it: **avoidance**
is an O(1) lookup, **conflict** is standing on someone else's claim,
**territory loss** is a stronger claim overwriting a weaker one, and the
**occupation of vacant ground** needs no rule at all, because when an animal
stops marking (it died, it moved on) its claims fade and the next animal through
writes its own. The grid is deliberately coarser than the world (4×4): a
territory is a coarse-grained thing, and a per-world-cell layer would spend
sixteen times the memory storing the same information at a resolution nothing
reads.

Taking occupied ground **erodes** the resident's claim rather than overwriting
it, which is the single rule that makes a boundary sit where two animals'
marking rates balance instead of wherever the last passer-by happened to stand.

**Disputes are with the claim, not with a search.** An intruder looks up who
holds the ground (O(1)) and then that animal by id (O(1)) — no spatial query
anywhere. If the owner is dead or far away, the intruder simply marks over it.
If it is close enough to answer, they contest, decided by the same
`resolveContest` that settles mating rivalries, and the loser yields **every
cell it held** at once — which is what makes losing a territory something you
can watch rather than a slow fade.

**Which species defends is species data.** Grazers have home ranges and no
territory (herd animals with overlapping ranges); stalkers hold, mark, avoid,
and dispute. That distinction — living somewhere versus owning it — is the one
the whole step turns on.

**The measurement that changed the design.** Territory was the most ecologically
destructive step yet, and bisecting it was the work. Over 15k ticks on five
seeds:

|                                       | seeds with both species alive | grazers    |
| ------------------------------------- | ----------------------------- | ---------- |
| territory layer inert                 | 5/5                           | 6–107      |
| marking + disputes, no patrolling     | 4/5                           | 52–165     |
| + routine patrolling (ramp 1.5 radii) | **2/5**                       | 6–162      |
| + routine patrolling (ramp 3 radii)   | 2/5                           | 13–148     |
| **adopted: ramp 6 radii**             | **4/5**                       | **52–165** |

The culprit was **patrol**, and the reason is worth stating because it is not
obvious: patrolling competes with **wandering**, and wandering is how an animal
finds the next patch once it has eaten this one. An animal that keeps going home
keeps not finding food. My first instinct — that this was grazers being pulled
inside a 14-unit range — was half right: gating patrol to territorial species
only still left it at 1/5, because a stalker that walks home is a stalker not
hunting. Marking and disputes cost about one seed; routine patrolling cost two
more.

The adopted setting ramps the patrol pull over six range radii, so the behaviour
still exists — an animal six range-widths from home does turn around — but it
never fires during normal foraging. That is a real scope reduction stated
plainly rather than hidden: **patrol is implemented and tested but is
near-inert in the demo**, and the test suite tightens the ramp to exercise it
(§1.4 A34).

**What shipped.** `world/ScentGrid.js`; `TerritorySystem` (`interaction`,
priority 30 — after movement so it marks where the animal actually ended up,
after hunting and mating so a fight over ground cannot pre-empt one over a
mate); `patrol` and `retreat` in the decision system; per-species `territory`
data; **protocol v22 → v23** (`entity.disputed` carrying both dominance scores
_and_ how much ground changed hands, plus a `territory` inspection block);
**save v21 → v22** (`homeRange`, `lastMarkTick`, and the claim layer — both are
evolved state that no seed can reproduce); metrics for settled ranges and
claimed ground; a renderer home-range ring for the selected animal.

**Tests:** `npm test` → **480 passing / 0 failing** (was 448; +32). New
`test/territory.test.js`: the claim layer (coarse cells, erosion, instant
takeover of abandoned ground, decay, whole-territory transfer, save round-trip),
home ranges (a resident settles, a rover reports a wider radius, a mover drags
its range, and the record never grows with age), who holds ground (only a
defending species and only adults), conflict (dominance decides; an absent or
dead owner simply loses; a fixed three-draw budget; the cooldown stops rivals
grinding each other down), behaviour (patrol, retreat, and the guard below),
protocol/metrics/persistence, and the residency sandbox.

**Two bugs worth recording.**

1. **A latent crash only a long run found.** `retreat` did not require a home
   range, so an animal too young to have settled one steered at a `null` target
   — and because a `NaN` heading fails the passability check, the animal would
   have stood still rather than crashing, had the target not been null outright.
   The window is a single tick in a newborn's life; a 16 000-tick probe hit it,
   the 448-test suite did not. There is now a test for it.
2. **`intrusionThreshold` equalled `markStrength`.** Freshly marked ground sat
   exactly at the threshold and decayed below it immediately, so a claim never
   read as "occupied" and avoidance never fired. The threshold has to sit below
   what one mark leaves; it is now 0.2 against a mark of 0.35, with the
   relationship written down in the config so it cannot silently invert again.

**Deterministic demonstration scenario — the residency sandbox.** A resident
settles a stable range measured **against a control** with the range pull off
(the resident ends up closer to home and with a tighter radius than the same
animal without it), and a neighbour placed on the resident's ground leaves it,
five times out of five. The avoidance half is asserted as a _mechanism_, not as
time-on-claim across two whole runs: switching avoidance off changes the
trajectory from tick one, so the two runs wander differently and the tick counts
would be comparing noise (§1.4 D1).

**Visible result verified.** Against a live server at protocol v23: stalker #121
holding **5 claim cells**, home range centred on (11.1, 52.9) with radius 16.3
from 1992 samples, standing on its own ground at claim strength 0.325, drift
12.2 inside its 26-unit range. World-level, 36 of 1024 claim cells held by 7
holders. Over 8000 headless ticks, **116 disputes, 26 escalating into fights**,
reading exactly as intended — `#128 (39) challenged #127 (47) → #127 (+2
cells)`, the stronger animal keeping the ground and taking more of it. And the
species split is visible in the metrics: 146 grazers with settled ranges (mean
radius 22.5) holding **no** ground at all, against 9 stalkers that do.

**Performance.** large-5k **72.01 → 74.33 ms/tick** (+2.3, within the noise this
scenario shows). Cheap by construction: the range summary is O(1) per animal,
marking is one grid write on an interval, avoidance is one grid read, and a
dispute is two id lookups. The only O(cells) work is decay — staggered every 10
ticks with the rate compensated — and `transfer`, which only a resolved dispute
calls. The coarse grid is what keeps both affordable: 1024 cells for the demo
world rather than 16 384.

**Deviations from the step spec (documented):** (1) **`TerritorySystem` runs in
`interaction`, not `decision`/`observation`** — it needs the post-movement
position to mark, and its disputes are fights, which belong where the other
fights are. (2) **Patrolling is near-inert in the demo**, for the measured
reason above (§1.4 A34). (3) **The claim layer is not projected to the
renderer.** The step asks only for an inspector panel and an optional
selected-entity overlay, and a per-cell ownership layer in every snapshot would
rival the vegetation block for something that changes far more slowly and
matters for one animal at a time; the home-range ring is drawn from inspection
instead.

**Follow-on notes for later steps:** Step 25 (disease) has a natural spatial
substrate here — a claim layer is already a map of who spends time where, which
is what a contact network is made of. Step 29's species schema now has a fourth
per-species block to absorb (`territory`, after `matePreference`). And Step 30
inherits a third neighbour-adjacent cost to look at, though this one is much
smaller than the other two (§1.4 C6).

---

## Step 25 — Simplified disease or parasites

**Status:** Done

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

- [x] SIR-style disease with visible symptoms and outcomes
- [x] Disease observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Detailed immunology, pathogen evolution, vectors as entities.

### Completion notes

**Completed 2026-07-20.** Figures below are as of that date; see §5 on reading them.

**Status: Done.** (Node v23.4.0, darwin arm64.) One modelling choice carries the
whole step, and §1.4 A20 is closed along with it.

**An incubating animal is infectious and looks perfectly healthy.** Everything
interesting follows from that. If only visibly sick animals could transmit,
avoidance would be a complete defence and an outbreak would be a non-event — the
herd shuns the one obvious case and carries on. Because the disease runs ahead
of its own symptoms, **avoidance is late by construction**: by the time a herd
can see who is ill, it has been standing next to them for a couple of hundred
ticks. That is what turns the density Step 23 introduced into a genuine cost,
which is precisely the pressure the plan asks this step to supply. Live, the
demo showed **13 infectious animals of which only 4 were visible**.

Compartments are susceptible → incubating → symptomatic → recovered, and
**immunity wanes** so the population returns to the susceptible pool. Severity
is _derived_ from the compartment rather than stored, for the same reason
dominance is (Step 23): a value computed from the state cannot drift out of step
with it.

**Transmission is driven by the infectious, not by everybody.** The obvious
shape — every animal looking around for a sick neighbour — would have been a
**third** full neighbour walk per animal per tick, on top of perception's and
sociality's (§1.4 C6, already flagged twice). Only infectious animals query the
grid, so the cost tracks **prevalence** rather than population: nothing at all
between outbreaks. It is also the more faithful direction — a pathogen spreads
outward from a host, it is not sought out by the healthy. A test pins the
property by showing that twenty animals and four hundred leave the stream in the
same state.

**Social avoidance without a new movement action.** Step 24's lesson was that a
new behaviour competing with foraging wrecks the ecology, so illness is avoided
by a subtraction instead: a visibly sick animal is simply **not counted in the
herd's centre of mass**, so the group's pull leads away from it and it is left
behind. That looks exactly like shunning and costs nothing. And because it keys
on _symptoms_, the carrier that looks fine stays in the middle of the herd —
which is how the outbreak spreads at all.

**§1.4 A20 is closed.** Wounds healed from Step 17, but health lost to thirst
never came back, so a once-thirsty animal carried the damage for life while a
mauled one mended. A step about recovering from illness is the right home for
the general case: a healthy, well-fed animal now slowly regains health from _any_
source of damage, gated on energy exactly as injury healing is, because mending
is work.

**Two findings from running it.**

1. **The pathogen went extinct.** The seeded outbreak peaked at 68 symptomatic
   around tick 1500, burned through by 2500, and by 5500 every survivor's
   immunity had lapsed with nothing left to catch — one epidemic in the demo's
   entire history, then 10 000 quiet ticks. Correct epidemiology for a disease
   with no reservoir, and useless as a standing pressure. A small **environmental
   spillover** (a fresh case roughly every 2900 ticks) makes outbreaks recur. It
   spends two draws per tick flat, whatever the population; rolling per animal
   would have been an O(N) walk through the stream for something this rare.
2. **The cost is almost entirely sublethal, and that is what needed tuning.** A
   run has 300+ infections and only 1–5 deaths _from_ disease. What suppresses
   the population is the time spent feeding badly and not breeding — so
   `symptomaticTicks` and `feedPenalty`, not the mortality rate, are the numbers
   that decide what disease costs.

**Tuning is measured** (five seeds, 15k ticks, against a disease-off control):

|                                | seeds with both species alive | grazers  |
| ------------------------------ | ----------------------------- | -------- |
| disease off (control)          | 4/5                           | 52–165   |
| 400 sick ticks, feed −40 %     | 3/5                           | 1–83     |
| **200 sick ticks, feed −30 %** | **4/5**                       | **7–75** |

Adopted because it matches the control's 4/5 while still visibly suppressing the
population — a density-dependent pressure that bites without breaking the demo.

**What shipped.** `disease/disease.js` (compartments, predicates, derived
severity, and the `infect` / `recover` / `clearImmunity` transitions, as a shared
helper in the established pattern); `DiseaseSystem` (`physiology`) owning
progression, transmission, spillover, mortality, and condition recovery; effects
in movement, feeding, fertility (`isReproductivelyReady` excludes the visibly
ill), and the herd centroid; **protocol v23 → v24** (`diseaseState` in bulk
snapshots so an outbreak is watchable, `entity.infected` / `entity.sickened` /
`entity.cured`, and an inspection block that spells out `infectious` separately
from `symptomatic`); **save v22 → v23**; per-species compartment counts in
metrics plus `infectious` in the bounded history, which is the outbreak curve;
a renderer sick tint, disease panel, event formatting, and a sparkline.

**Tests:** `npm test` → **507 passing / 0 failing** (was 480; +27). New
`test/disease.test.js`: the compartments (including that an incubating animal is
infectious, invisible, and unimpaired — asserted on its own because everything
else depends on it), progression on an exact schedule with a fixed draw budget,
transmission (in range and not beyond it, never across species, never to the
immune, a traceable source id, and the population-independent cost), what illness
costs (slower, infertile-when-visible-but-not-when-incubating, and left out of
the herd's centre while an incubating animal is not), condition recovery closing
A20, protocol/metrics/persistence, and the outbreak sandbox.

**Deterministic demonstration scenario — the outbreak sandbox.** A tight cluster
of 24 animals and one infected. Asserted as the _shape_ of an epidemic rather
than counts: it spreads beyond patient zero, animals visibly sicken, it resolves
into recovered and dead, and it **burns out** rather than running forever. A
companion test puts one animal on the far side of the world and asserts it never
catches anything in 3000 ticks — locality asserted where it matters, since
transmission is contact and not a population-wide roll.

**Visible result verified.** Against a live server at protocol v24: 157 animals
reading 93 recovered / 51 susceptible / 9 incubating / 4 symptomatic — the
13-infectious-but-4-visible gap that is the whole model. Stalkers at 0 infected
throughout, confirming the disease is species-bound. The outbreak curve moving in
the bounded history (10 → 9 → 12 → 9 → 8 → 9 → 10 → 13 infectious). And a
transmission chain traceable straight out of the event log: **#134 → #66 → #6**
and **#129 → #24 → #185**.

**Performance.** large-5k **74.33 → 79.78 ms/tick** (+5.5). Almost all of it is
the O(N) progression-and-recovery pass; transmission itself costs nothing between
outbreaks by design. Still ~12× inside the tick budget.

**Deviations from the step spec (documented):** (1) **No cross-species
transmission** — a pathogen adapted to a grazer is not the one adapted to a
stalker, and spillover between hosts is its own subject; the two species carry it
independently. (2) **Avoidance is the herd subtraction described above rather
than a `shun` action**, deliberately, on Step 24's evidence. (3) **Condition
recovery lives in this system**, not the injury system, because injury healing is
paid per unit of wound severity and this is the baseline underneath it.

**Follow-on notes for later steps:** Step 26 (migration and dispersal) inherits a
population whose density now has a real cost, which is one of the classic
reasons to leave. Step 29's species schema gains a fifth per-species candidate if
susceptibility ever varies by species (it does not yet — `disease` is global).
And §1.4 C6 is unchanged: this step deliberately did not add a third neighbour
walk, so the optimization owed to Step 30 is still just perception + sociality.

---

## Step 26 — Migration and dispersal

**Status:** Done

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

- [x] Dispersal, seasonal migration, recolonization via local heuristics
- [x] Movement patterns observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked (no global pathfinding)

### Explicitly out of scope

A\* over the whole map per entity, optimal route solving.

### Completion notes

**Completed 2026-07-20.** Figures below are as of that date; see §5 on reading them.

**The whole step is one decision: migration is not an action.** §1.4 A34 is the
evidence. Step 24's `patrol` gave animals a routine reason to move and cost the
demo two seeds in five, because any new movement action competes with `wander` —
and wandering is how a grazing animal finds its next meal. So this step adds
nothing to the utility table. It steers the heading `wander` was going to pick
anyway, and only at the moment a fresh wander commitment is made.

Three properties follow, and they are why the shape was chosen rather than
pleasant side effects:

1. **Foraging cannot lose.** An animal that can see food still runs `seekFood`;
   one that remembers food still runs `recallFood`. Migration only ever replaces
   a _random_ heading with a _directed_ one, so it spends no tick that was doing
   anything useful.
2. **At zero strength the behaviour is bit-identical to Step 25** — so the
   mechanism is off unless the world says otherwise. This turned out to need
   defending: see the ulp bug below.
3. **Distance comes from commitment, not from range.** The cue is local and
   shallow; the wander commitment holds a heading for 8–24 ticks and re-picks the
   same direction while the gradient persists. Nothing searches, plans, or
   routes.

**Nothing in the step is seasonal.** Season reaches migration through the
vegetation ceiling (Step 19) and the herd's own grazing: a green spring flattens
the gradient to nothing, a grazed-out winter sharpens it. There is no seasonal
branch anywhere in the code, which is the honest way to get seasonal movement out
of a world whose climate is global (§1.4 A24 — no per-cell microclimate exists,
so there is no "warmer south" to migrate toward, and inventing one would have
been a fake layer).

**Recolonization is not implemented anywhere.** Nothing in the engine knows a
region was vacated. It falls out of the same gradient: ground nobody is eating
grows back to capacity and therefore becomes the best thing on the compass. The
test asserts that consequence rather than a feature.

**Dispersal is the one thing that overrides the gradient.** A juvenile that
outgrows its guardian holds an outward heading for a bounded spell whatever the
forage says — an animal that turned back at the first green patch would never
leave. `beginDispersal` also **clears the home range**, which is what makes
dispersal spatial rather than bookkeeping: Step 24's range is a running average
of where an animal has been, so a juvenile that kept its natal range would spend
its life being pulled back toward its mother's ground.

**Randomness: none at all.** Sampling is deterministic and a dispersal heading is
geometry (straight out from the natal centre), so this step adds not one draw to
any stream — it cannot shift another system's sequence even in principle. A test
asserts every stream is byte-identical across a step with and without the system.

**Three findings from running it.**

1. **The five-seed sweep lied, in both directions.** Against the Step 25 control
   (4/5 seeds with both species alive, grazers 7–75) migration read **3/5**,
   which by the standard every step since 22 has used would have meant ramping it
   down. Bisecting `biasWeight` gave 1/5, 2/5, 3/5, 3/5 at 0.2/0.3/0.4/0.5 —
   _non-monotonic_, which is itself the tell. Re-run at **ten** seeds:

   |                         | both alive | grazers | stalkers |
   | ----------------------- | ---------- | ------- | -------- |
   | migration off (control) | **4/10**   | 6–107   | 0–7      |
   | migration on            | **4/10**   | 16–96   | 0–15     |

   Identical seed survival; one seed lost and one gained. The 4/5→3/5 gap was
   noise, and the original five seeds simply happen to flatter the control. On
   the measures that are not a five-sample binary, migration is _better_: the
   grazer floor rises 6→16 (fewer near-collapses) and the stalker ceiling 7→15.
   This is §1.4 D7 exactly — check what the fixture is measuring before re-pinning
   anything.

2. **A diagnosis that was wrong, and cheap to falsify.** Hunts _fall_ when
   migration is on even as prey numbers rise (seed 13: grazers 21→96, hunts
   231→141) with capture rate flat at ~0.34 — so predators were finding prey less
   often, not failing to catch them. The obvious cause was a stalker pinned to
   empty ground by site fidelity, and a hunger-gated `patrol` was written to fix
   it. Then `patrolSpanFactor` turned out to be **6** — patrol is ramped almost
   out of existence (A34 again), so nothing was pinning anything. The change was
   reverted unshipped. The real mechanism is plainer: aggregated prey are harder
   for a random searcher to find, which is landscape-scale dilution and genuine
   ecology. A second attempt — letting stalkers track forage as a prey proxy —
   made stalker numbers _worse_ (0–3) and was also reverted.
3. **The drift is weak over short distances, and that is by design.** Two cuts of
   the end-to-end test measured position and both were bad tests. The first
   painted a bare desert with a rich band beyond it; the control reached it just
   as fast, because a random walk crosses a small box easily and because a cue
   reaching 18 units reads _nothing_ across bare ground — it was measuring
   diffusion and would have passed with migration deleted. The second used a
   smooth ramp, where the effect was real but ~1 unit, because `biasWeight` 0.5 ×
   hunger × gradient is deliberately gentle. Migration's effect on position is
   **cumulative**; pinning a small displacement in a sandbox would be pinning
   noise. The shipped test asserts the _mechanism_ — mean cos(heading) over
   hundreds of wander commitments, which is 0 for a random walk and clearly
   positive when the gradient points east.

**One real defect, caught by its own test.** `blendHeadings(1.2, bias, 0)`
returned `1.2000000000000002` — `normalizeAngle` wobbling the float. Property 2
above was therefore false: a _fed_ animal standing on a real gradient carries a
non-null heading at strength 0 and does come through the blend, so every such
animal got a one-ulp course change compounding over 15 000 ticks. The endpoints
now return their input untouched (both callers already pass normalized angles).

**What shipped.** `migration/migration.js` (the forage gradient, `beginDispersal`
/ `isDispersing`, and `blendHeadings`, as a shared helper in the established
pattern); `MigrationSystem` (`decision`, priority −5, staggered) owning the two
drift numbers and the relocation event; a six-line change in `DecisionSystem`'s
`wander` case and nothing else in it; dispersal wired into the one instant
`ParentingSystem` already owns; **protocol v24 → v25** (`dispersing` in bulk
snapshots so a leaving juvenile is watchable, `entity.migrated`, the natal centre
on the `dispersed` life event, and an inspection block showing the live habitat
reading beside the drift it produced); **save v23 → v24**; a `migration.enabled`
switch that makes the control reproducible rather than hand-assembled; and
renderer event formatting plus a Migration panel.

**Tests:** `npm test` → **535 passing / 0 failing** (was 507; +28). New
`test/migration.test.js`: the blend (including the wrap point, the opposed-vector
degenerate case, and the zero-weight identity that the ulp bug broke), habitat
evaluation (flat world → no pull, nowhere-better → no pull, direction, strength
as a ratio, the cap, and an assertion that it is exactly `SAMPLE_DIRECTIONS × 2 +
1` grid reads and **zero** spatial queries), the hunger throttle, the stagger,
the zero-draw budget, dispersal (outward heading, range cleared, bounded, the
degenerate on-centre case, the inert zero-tick control path, precedence over
forage, and that orphans are _not_ dispersed — §1.4 A12), recolonization,
protocol/persistence/determinism, and the `enabled: false` control pinned so it
stays a control.

**Deterministic demonstration scenario — the gradient sandbox.** Bare ground with
rich forage due east, inside the 18-unit cue and well outside the 6-unit
perception radius so `seekFood` cannot be what steers them. Asserted as a
_direction_: mean cos(heading) over 300 ticks of wander commitments is < 0.1
without migration and > 0.15 with it. The recolonization companion puts 16 animals
on bare western ground with the whole lush east half empty of animals and asserts
they arrive.

**Visible result verified.** Against a live server at protocol v25: `dispersing`
present in the bulk entity projection, and an inspected grazer reporting
`tracksForage: true`, a live `habitat` reading (0.54 better within 18 units) beside
the weaker `drift` it produced (0.067 — the gradient scaled by `biasWeight` and
hunger), and its `settled` centre. Over 15 000 ticks on seed 42: **247 dispersals**
with a **median 70.7 units** travelled from the natal centre (max 152) on a
128-wide map, and **2 832 relocations** — 2 567 following forage, 265 while
dispersing. Mean drift strength across the population is **0.0995**: a bias, not a
beeline, which is the number A34 says has to stay small.

**Re-measured 2026-07-20** (after Step 29's species schema): the median is **~60
units**, not 70. The mechanism is untouched — `dispersalTicks` is still 400 and no
migration code changed — but the world it runs in is not the world it was measured
in. Both figures stand, each as of its own date; the drift between them is what a
third species and a per-species metabolism cost a juvenile's outward walk.

**Performance.** large-5k **79.78 → 79.19 ms/tick** — flat, and within run-to-run
noise. Habitat evaluation is 16 O(1) vegetation reads per animal per evaluation
divided by a stagger of 10, and touches no spatial query at all, so §1.4 C6 still
owes Step 30 exactly two neighbour walks rather than three.

**Deviations from the step spec (documented):** (1) **No `MigrationSystem`
movement bias as a competing intent** — it writes a drift the decision system
folds into `wander`, for the A34 reasons above. (2) **"Remembered routes" are not
implemented**; Step 15's memory already stores remembered _places_ and
`recallFood` already steers to them, and a route is a trajectory, which the
codebase deliberately does not store anywhere (see A40). (3) **Migration is a
grazer-only phenomenon** — a stalker's food is the grazer, which it already
follows through perception and the hunt pipeline; both species do disperse
(A41). (4) **Population fragmentation is not asserted**, only enabled: herd
labels already split by hop count (Step 23) and separate forage patches already
pull herds apart, but no test claims a specific fragmentation outcome.

**Follow-on notes for later steps:** Step 27 (local disturbances) inherits the
mechanism that makes recovery from a disturbance work — a burnt patch is
low-forage ground animals drift _off_, and regrown ground is what draws them
back, with no recolonization code to write. Step 29's species schema gains a
sixth block (`migration`). And the honest caveat for anyone tuning later: the
demo's two-species balance is a knife edge at ~3–9 stalkers, so **five seeds
cannot resolve a one-seed difference** — use ten.

---

## Step 27 — Local disturbances

**Status:** Done

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

- [x] Bounded disturbances with terrain/vegetation/mortality + recovery
- [x] Disturbance + recovery observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

Global catastrophes, fire spread physics, fluid simulation.

### Completion notes

**Completed 2026-07-20.** Figures below are as of that date; see §5 on reading them.

**A disturbance is a record, and its effects are derived from it on read.** That
one choice is the whole step, and it is what makes recovery nearly free:

- a flooded cell is not _marked_ flooded; it is slow **while a flood covers
  it**, and the instant the record expires it is ordinary ground again. There
  is no un-flooding pass, and therefore no way to leave the world stuck
  half-flooded because a cleanup was missed;
- **terrain is never mutated.** Terrain is derived — regenerated from the seed
  on load and deliberately not saved — so a disturbance that edited it would
  silently vanish on restore. Disturbances are their own protocol layer
  instead, exactly as vegetation is. A bounded list of _circles_ is not a
  per-cell field, which is why it can ride in every snapshot where the
  territorial claim grid (§1.4 A36) cannot.

The one destructive effect is vegetation, because burnt grass should not
reappear when the fire goes out — it should grow back, and Step 3's logistic
regrowth already does that. A fire consumes biomass once, at ignition, and
recovery is the vegetation system doing what it always does.

**No behaviour was added, and that was the point.** §1.4 A34 and D14 both say a
new action competes with foraging and loses. Displacement is two existing
mechanisms given a reason: a burnt region is low-forage ground that Step 26's
drift carries animals _off_, and a fire writes a `danger` memory (Step 15) that
animals already avoid resting near and already refuse to recall food from.
Recolonization when the grass returns is Step 26's, unchanged. Step 26's handoff
note predicted this would be the payoff of ordering 26 before 27, and it was.

Effects live in a **declarative table** rather than a switch, so a kind is a row
rather than a code path — which is also what made the per-kind attribution below
possible at all.

**Three findings from running it.**

1. **⚠ A silent discard: fire recorded no wounds whatsoever.** `injuryPerTick`
   was set to a plausible-looking 0.006, and `applyInjury` discards anything at
   or below `HEALED_BELOW` (0.02) — so every burn returned `null` and vanished,
   while animals still burned to death from the separate health drain. The
   symptom was a diagnostic reading **0 burn injuries alongside 5 deaths by
   `disturbance`**, which is only suspicious if you happen to print both. A burn
   is now a discrete wound on an interval (0.12 every 25 ticks), which clears
   the floor, and the interval doubles as the event-volume bound. Recorded as
   §1.4 D17.
2. **The first cut was a climate, not a disturbance regime.** At one ignition
   check per 100 ticks with a 0.35 chance, something was burning, flooding, or
   blowing **91% of ticks** — which not only over-pressured the demo but made
   _recovery unobservable_, because nothing ever finished recovering. Now one
   ignition per ~1200 ticks against a median duration near 300, so roughly a
   quarter of ticks have something running somewhere and the rest are quiet
   enough to watch the land come back.
3. **The cost is local, not demographic — and per-kind attribution proved it.**
   A `kinds` config knob was added so each could be measured alone. Over ten
   seeds and 15k ticks:

   |               | both alive | grazers | stalkers | deaths by disturbance |
   | ------------- | ---------- | ------- | -------- | --------------------- |
   | off (control) | 4/10       | 16–96   | 0–15     | 0                     |
   | fire only     | 5/10       | 0–117   | 0–4      | 12                    |
   | flood only    | 3/10       | 3–96    | 0–5      | 0                     |
   | storm only    | 5/10       | 14–108  | 0–6      | 0                     |
   | all three     | 3/10       | 1–128   | 0–6      | 6                     |

   Seed survival spans **±1 of the control in both directions** and the death
   causes barely move (exposure 140–184, predation 492–565 across every row).
   At ten seeds the demo cannot distinguish these configurations, which is the
   honest reading and also the expected one: a disturbance covering ~1% of the
   map a quarter of the time should not move a population aggregate. The effect
   it _does_ have is local and sublethal — 852 burns across the ten seeds — which
   is the same shape as Step 25's disease finding, where mortality was never the
   lever either.

**Recovery, measured.** In a controlled world with an unburnt control region: a
radius-8 fire removed **78%** of the regional biomass, which was back to **48%
of pre-fire at +100 ticks, 99% at +300, and 100% at +600**, while the control
region moved less than 1%. Recovery is asserted against that control in the test
suite so a turning season can never be mistaken for it.

**Two deliberate model choices worth stating.** A flood makes ground **slow
rather than impassable**: the movement system refuses impassable target cells, so
a region of them would wall in any animal standing where the water arrived, with
no way out — a trap rather than a hazard. And overlapping disturbances take the
**first match** rather than stacking, because multiplying two effect rows
together produces a combination neither kind describes.

**What shipped.** `disturbance/disturbances.js` (kinds, the declarative effect
table, geometry, and the derived accessors, as a shared helper in the
established pattern); `DisturbanceSystem` (`environment`, priority 10 — after
weather, before vegetation growth, so a fire burns the field before the same
tick regrows it) owning ignition, expiry, the bounded scour, and affliction;
disturbance effects folded into the two chokepoints that already existed
(`world.speedModifierAt` and `thermalStress`) so no system had to learn what a
disturbance is; `InjuryKinds.BURN`, closing the _hazard_ half of §1.4 A19, which
has been carried since Step 17; **protocol v25 → v26** (a `disturbances` block in
snapshots and deltas, `environment.disturbed` / `environment.settled`, and a
`caughtIn` inspection field); **save v24 → v25**; `enabled` and `kinds` config
switches so the control is reproducible rather than hand-assembled; and a
renderer overlay drawn over the ground and under the animals, plus event
formatting.

**Tests:** `npm test` → **561 passing / 0 failing** (was 535; +26). New
`test/disturbance.test.js`: geometry (including that the corner of a bounding box
is _not_ inside the disc), the empty-list early exit pinned so quiet ticks stay
cheap, first-match overlap, the fixed draw budget (proved by two worlds whose
ignition outcomes differ completely landing on the same stream state, plus a
direct count against `IGNITION_DRAWS`), expiry announced exactly once with its
real duration, the active cap, an invariant that nothing ever ignites on water or
rock, per-kind worlds, vegetation loss bounded to the region asserted **cell by
cell against an identical unburnt world**, the recovery curve against an in-world
control, burn/memory/mortality inside and untouched animals outside, event volume
bounded by the burn interval, a flood slowing movement and releasing it on
expiry, an animal always being able to struggle out of a flood, a storm's local
thermal bite, protocol round-tripping (including that an **empty** delta list
clears a fire rather than being treated as absent), save/load with a disturbance
actually running, and the `enabled: false` control pinned so it stays a control.

**Deterministic demonstration scenario — the burn-and-recover sandbox.** A seeded
fire at a known centre in a flat world, asserted as loss then recovery against an
unburnt control region in the same world: most of the forage gone, and back above
90% of pre-fire within 600 ticks while the control barely moves.

**Visible result verified.** At protocol v26: a snapshot carrying two concurrent
disturbances (a flood at 12,97 r9 and a fire at 103,64 r15), **3 animals caught
in the fire**, and inspection reporting `caughtIn` for one of them. The event log
reads as a lifecycle — `t2400 disturbed fire @103,64 r15` … `t2718 settled fire
(318 ticks)` — with the per-kind duration scaling visible in it: fires last
205–318 ticks, floods 537–1015.

**Performance.** large-5k **79.19 → ~80.1 ms/tick** (+1). medium-1k is noisy
across runs (11.1–15.2 against Step 26's 10.4); a second run put it at 11.1, so
the first reading was variance rather than a regression. Ignition is five draws
every 300 ticks, the scour is πr² cell writes _once_ per disturbance, and the
per-animal pass runs only while something is active — everything else costs one
array-length check.

**Deviations from the step spec (documented):** (1) **Drought and severe winter
are not implemented** — both already exist as _global_ weather states (Step 19),
so a local copy would be the same mechanism at a different scale rather than a
new one (A44). (2) **Terrain is not modified**, for the persistence reason above;
"affected terrain" is expressed as a derived traversal penalty and a renderer
overlay (A45). (3) **Mortality is rare in the demo** — 0–12 deaths across ten
seeds — because a region covers ~1% of the map and animals walk out of it; the
lethal path is exercised in a controlled test instead (A46).

**Follow-on notes for later steps:** Step 28 (ecosystem engineering) inherits the
pattern this step establishes — a bounded record whose effects are derived on
read, layered over static terrain — which is exactly the shape a beaver dam or a
wallow needs, with the difference that engineering _persists_ rather than
expiring. Step 29's species schema is untouched by this step (disturbances are
world state, not biology). And §1.4 C6 is still unchanged at two neighbour walks:
the affliction pass is O(animals × active) with no spatial query.

---

## Step 28 — Ecosystem engineering

**Status:** Done

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

- [x] Concrete visible environment modification with behavioral feedback
- [x] Modifications observable
- [x] Tests pass
- [x] Visible result verified
- [x] Documentation updated (protocol + save version)
- [x] Performance checked

### Explicitly out of scope

A generic scriptable environment-modification engine.

### Completion notes

**Completed 2026-07-20.** Figures below are as of that date; see §5 on reading them.

**Wear is the only state, and the shape is Step 27's with the clock removed.**
Two enumerated features — a **trail** worn by traffic, a **burrow** dug by
resting — held as sparse per-cell wear in a `Map` rather than a dense field,
because a handful of cells out of the whole map carry anything and a world
nobody has walked on must cost nothing. A disturbance is a record that _expires_;
a feature has no clock at all. It persists while wear arrives faster than decay
removes it, so "built → maintained → lost" needs no maintenance mechanism —
"maintained" is simply what not fading looks like.

**Both effects land on chokepoints that already existed**, which is why no system
had to learn what a feature is: `world.speedModifierAt` already decided how fast
ground is to cross, and `world.isShelteredAt` already decided what counts as
shelter — so a burrow is picked up by thermoregulation _and_ by the `shelter`
action for free, and neither knows an animal dug it. The one genuinely new pull
(an animal drifting onto a nearby trail) feeds Step 26's wander-heading blend
rather than the utility table, because §1.4 A34 has been the answer four steps
running now.

**Three bugs, and the first two were silent.**

1. **⚠ The system wore nothing at all, in the phase the spec asked for.**
   `lastMoveDistance` is a per-tick accumulator that the metabolism system
   _consumes and zeroes_ in `physiology`, so by the time any `environment` system
   runs it is always 0. Fifteen thousand ticks produced **zero trails** while
   burrows (which read `action` instead) formed perfectly — a half-working
   feature is much harder to notice than a broken one. Moved to `interaction`
   priority 40, which is where the territory system already sits for exactly the
   same reason: it marks where an animal _ended_ the tick. Recorded as §1.4 D19.
2. **⚠ Wear was charged per tick, not per unit of distance.** An animal crossing
   a cell may spend several ticks in it, so one slow pass wore the ground as much
   as three fast ones — and the moment the phase bug was fixed this **paved 7% of
   the map** (1116 simultaneous trail cells). Scaling by `lastMoveDistance` makes
   a trail a measure of traffic rather than of dawdling.
3. **Cells flapped across the threshold.** One run produced **9569 trails formed
   and 9081 lost** — a flickering world rather than a world with trails in it,
   costing two events and a projection churn per flap. Fixed with a hysteresis
   band (promote at `threshold`, demote at `threshold × 0.7`), which is a
   deliberate exception to "derive rather than store": with hysteresis the state
   genuinely depends on history, which is exactly what a derived value cannot
   express (§1.4 D20).

**Measured against the control** (ten seeds, 15k ticks, `engineering.enabled`
false):

|                 | both alive | grazers   | stalkers |
| --------------- | ---------- | --------- | -------- |
| engineering off | 3/10       | **1**–128 | 0–6      |
| engineering on  | 4/10       | **26**–97 | 0–8      |

Seed survival moves by one, which at n=10 is not evidence on its own (§1.4 D14).
The **grazer floor** is the real signal: it rises from 1 to 26 and the range
narrows from 1–128 to 26–97 across every seed. Trails appear to buy the
population stability rather than size — plausibly because faster travel on worn
ground shortens the time spent between food patches — but that is a mechanism
claim the sweep does not prove, so it is offered as a reading rather than a
result.

**⚠ The most interesting finding is not about trails.** 78% of trail cells sit on
the map edge, which is 6% of the area — a 13× concentration. Diagnosing it turned
up something that has nothing to do with this step: **animals spend ~49% of their
time within two cells of the world boundary**, measured with engineering
_disabled_. Movement clamps at the edge (Step 5), so an animal whose heading
points off-map slides along the wall instead of turning, and they pile up there.
Engineering adds ~4.6 points on top (edge trails mildly attract), but the bulk is
pre-existing and nothing before this step made it visible — the trail layer is
effectively an occupancy heatmap, and this is the first time anyone has looked at
one. Deliberately **not fixed here**: changing boundary handling is a Step 5
change affecting every system, and it needs its own ten-seed measurement.
Recorded as §1.4 ⚠ C8.

**Event volume is real turnover, not noise.** Features form and fade about 0.74
times per tick. Widening the hysteresis band did _not_ reduce it (0.66 / 0.76 /
0.58 at bands of 0.7 / 0.5 / 0.3 — non-monotonic, the D14 signature of tuning
noise), because the churn is animals genuinely using and abandoning ground rather
than cells oscillating. So the rate was left alone and the _renderer_ hides the
events by default, which is the established answer here — `entity.moved` and
`entity.fed` have been routine-filtered since Step 9.

**What shipped.** `world/FeatureGrid.js` (sparse, bounded, decaying, with the
hysteresis band and a revision that moves only when the promoted set changes);
`engineering/features.js` (kinds, the declarative effect table, the derived
accessors, and a trail gradient built to the same shape as Step 26's forage
gradient); `EngineeringSystem` (`interaction`, priority 40); effects folded into
the two existing world chokepoints; **protocol v26 → v27** (a revision-gated
`features` block carrying only cells deep enough to _be_ something, plus
`environment.feature`); **save v25 → v26**; an `enabled` switch for the control;
and renderer glyphs drawn over the ground and under everything that happens on
it. Also fixed a latent wiring bug found on the way: `config.engineering` was
never passed to the `World`, so a configured threshold would have been silently
ignored.

**Tests:** `npm test` → **590 passing / 0 failing** (was 561; +29). New
`test/engineering.test.js`: that a single pass wears ground _without_ making
anything of it (the step's whole claim is that _repeated_ use reshapes the
world), promotion announced exactly once, decay and loss announced once, the
hysteresis band surviving a dip below the promotion threshold, a different kind
having to erode the old one, the tracking cap, the wear cap, features listed in
cell order rather than insertion order (iteration order is deterministic by
rule), the revision moving on promotion but _not_ on ordinary walking, both
effects reaching their chokepoints, the gradient producing nothing for an animal
already on the best ground, wear-per-distance rather than per-tick, the zero-draw
budget, the trail bias measured on the _heading distribution_ against a
trail-free control (§1.4 D15), revision-gated deltas, scuffed ground never being
projected, save/load with features actually present, and the `enabled: false`
control pinned so it stays a control.

**Deterministic demonstration scenario — the worn-path sandbox.** A well-worn
path due east of sixteen animals in a featureless world, asserted as a
_direction_: mean cos(heading) over their wander commitments is near zero without
the trail and clearly positive with it, against the identical world.

**Visible result verified.** At protocol v27, seed 42 after 6000 ticks: **349
trail cells** projected, and **96% of them touch another trail cell** — connected
paths rather than scattered dots, which is the difference between a trail system
and a heatmap of noise. The deepest cells sit at the wear cap. Formation is
readable in the event log from tick 18.

**Performance.** large-5k **80.1 → 80.6 ms/tick**, flat. Decay walks the _worn_
cells rather than the world (a `Map`, not a field), the projection is memoized on
a revision that barely moves, and both read chokepoints early-exit on
`featureCount === 0`. No spatial query — §1.4 C6 still owes Step 30 two neighbour
walks rather than three.

**Deviations from the step spec (documented):** (1) **Phase `interaction`, not
`environment`** — the spec's placement cannot work, per finding 1 above. (2) **No
grazing clearings**: vegetation biomass already visibly drops where animals graze
and regrows after, so a separate "clearing" feature would be a second mechanism
for a thing the world already does (A48) — the same reasoning that kept drought
out of Step 27. (3) **Animals do not seek _other_ animals' burrows** (A47): a
burrow shelters whoever is standing on it, but only trails attract, and giving
burrows a pull would mean touching the perception hot loop.

**Follow-on notes for later steps:** Step 29's species schema is untouched —
features are world state, not biology — though `attracts` and `shelters` are the
obvious hooks if a species should ever build something others do not. Step 30
inherits ⚠ C8 (the boundary pile-up), which is now measured and which any
occupancy-sensitive optimization should know about. And the feature layer is the
first thing in the engine that makes _where animals actually spend their time_
visible, which is likely to surface more than it already has.

---

## Step 29 — Expanded species system

**Status:** Done

**Carried forward (see §1.4):** this step is the designated home for the
config debt accumulated while there was only one species. **B3** — metabolism
(Step 6), hydration (Step 10), and aging/life-curve (Step 11) parameters all
live in **global** config sections and should become per-species. **B4** —
perception radius already _is_ per-species (resolved from the registry), so the
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

- [x] Config-driven multi-species with no core conditionals
- [x] Multiple species visibly coexist
- [x] Tests pass (incl. no-species-literal scan)
- [x] Visible result verified
- [x] Documentation updated
- [x] Performance checked

### Explicitly out of scope

A biological scripting language; runtime species authoring UI.

### Completion notes

**Completed 2026-07-20.** Figures below are as of that date; see §5 on reading them.

**A species overrides; the config supplies defaults.** That one decision is the
whole schema. Eight blocks — `metabolism`, `hydration`, `aging`, `perception`,
`traits`, `genetics`, `disease`, `reproduction` — fall back to the same-named
global config section, so a species file states only what is _different_ about
that animal. The alternative (every species restating every parameter) makes the
interesting differences invisible and turns a change to a shared default into a
twelve-file edit. Merging is **recursive**, because at least one block is nested
(`traits.spread`) and a shallow merge would silently drop seven of eight traits
from any species that tweaked one.

**Resolution happens once, at engine construction**, into deep-frozen records
held by a `SpeciesRegistry` on the world. A system lookup is one `Map.get` and no
allocation, which is what the step's performance note demands. The registry is
per-engine rather than a module singleton on purpose: resolution depends on the
_config_, and every sweep and half the test suite runs engines with different
configs in one process.

**The debt this step was built to absorb, item by item.** §1.4 **B3**
(metabolism, hydration, aging all global), **B4** (perception radius as a bare
`perceptionRadius` scalar — a _third_ config pattern, now a block like the
rest), **A13** (trait spread and mutation), **A17** (a stalker cub born at the
grazer's 5 kg), **A29/A30** (`matePreference`, `GESTATING_SEX`), **A38** (disease
parameters), **A41** (`migration`). Also **B2**: `config.demo` was a hardcoded
prey/predator pair and is now a `founding` _roster_, so adding a species to the
world is a line of config.

**A21 is closed, and it closed itself.** The third species is a **scavenger**,
and its entire implementation is one config file. It is a carnivore, so feeding
already lets it eat carrion; it declares an **empty `preySpeciesIds`**, so
perception finds it nothing to hunt, the hunting system never fires for it, and —
read in the other direction — nothing fears it. Not one line of engine code was
written or changed to add it. The empty case in `hunts()` was always reachable;
nobody had asked what it meant. It had been open since Step 18 as "no dedicated
scavenger guild — a third species is its own scope", and this was that step.

**The static scan is the acceptance criterion made mechanical.** "No
species-name conditionals in core systems" has been an invariant since Step 4 and
was, until now, enforced by nothing at all. `test/species-schema.test.js` scans
every file in `src/simulation`, strips comments first (§1.4 D6 — a guard that
fires on prose teaches people to word around it), and fails if any species id
appears outside `config/species/`. A companion check requires every
`'herbivore'` / `'carnivore'` literal to sit within sixty characters of `.diet`,
so diet remains a read of data rather than a hardcoded name.

**Two findings from running it.**

1. **⚠ Feeding rate was never mass-scaled, and only a third carnivore could show
   it.** With three species the first ten-seed sweep read **3/10** against a
   two-species control's 6/10, with corvids booming to 184. The cause was not the
   scavenger's biology: `fleshIntakeRate` was a flat per-tick number, so a 4 kg
   bird stripped a carcass exactly as fast as a 45 kg predator. Invisible while
   every carnivore was the same size, decisive the moment one was not. Scaling
   intake on the same allometric exponent metabolism already uses (a 4 kg animal
   eats at 22% of the reference rate, a 45 kg one at 136%) is the honest fix, and
   it is a no-op for the 30 kg grazer that _is_ the reference mass. Recorded as
   §1.4 D22.
2. **Closing A17 helped the predator more than expected.** Giving the stalker its
   own body — born at 8 kg, maturing slower, living to 14 000 ticks, cheaper to
   travel, slower to dry out — moved the _two-species_ control from the 4/10 of
   Step 28 to 6/10 before the scavenger was added at all. Thirteen steps of
   predators living on grazer physiology had been quietly costing them.

**Measured** (ten seeds, 15k ticks, after the intake fix):

|                       | grazer + stalker alive | grazers | stalkers | corvids |
| --------------------- | ---------------------- | ------- | -------- | ------- |
| two species (control) | 4/10                   | 12–172  | 0–6      | —       |
| three species         | **5/10**               | 8–75    | 0–2      | 0–173   |

Adding a whole trophic level does not cost the demo: seed survival is the same or
better, and **all three species coexist in 4/10 seeds**. Stalkers are squeezed
(0–2 against 0–6) — a scavenger competing for carrion is real pressure — and
corvids show a genuine boom-and-bust (0 on one seed, 173 on another), which is
what an animal living on a thin, unpredictable food supply should do. §1.4 D14
applies as always: a one-seed difference at n=10 is not evidence, which is why
the claim here is "does not degrade" rather than "improves".

**What shipped.** `config/species/schema.js` (`SPECIES_BLOCKS`,
`resolveSpecies`, `SpeciesRegistry`); the roster in `config/species/index.js`
split into raw _definitions_ (declared) and resolved species (per engine);
`scavengerCorvid.js`; per-species blocks on the stalker closing A17;
`world.species` as the single read path, with `metabolism`, `hydration`,
`aging`, `perception`, `reproduction`, and newborn birth mass all now reading it;
mass-scaled carnivore intake; `demo.founding` as a roster in the config, the
fixture, and the benchmark scenarios; **save v26 → v27** (no entity field
changed — the _config shape_ did, and config is saved verbatim); a renderer
appearance entry; and **no protocol bump**, since `speciesId` was already
projected and no new observable species metadata is exposed.

**Tests:** `npm test` → **609 passing / 0 failing** (was 590; +19). New
`test/species-schema.test.js`: resolution (inheritance, partial override,
recursive merge, every block resolvable, deep-frozen, per-engine independence,
unknown species null-vs-throw, the relation read both ways), the two static
scans, "a species is config not code" (a _browser_ invented inside the test file
and resolved correctly, plus the demo founding every cohort and three species
alive at 3000 ticks), the scavenger hunting nothing and being hunted by nothing
from data alone, a scavenger never making a capture attempt in 3000 ticks, three
distinct birth masses and three distinct lifespans, newborns born at their own
species' mass, perception as a block with three distinct radii, determinism, and
save/load.

**The refactor broke 23 existing tests, and the pattern is worth recording.**
Almost all of them constructed a system with custom parameters and expected those
to apply — but a species' block now beats anything a system was constructed with,
so the parameters have to reach the _config_ (which the registry resolves
against) instead. That is the correct new shape and the fixes say so in comments;
it is also exactly the sort of quiet inversion that would be baffling six months
on. Recorded as §1.4 D23.

**Visible result verified.** The demo founds 120 grazers, 8 stalkers, and 10
corvids and runs three species side by side; at 3000 ticks on seed 42 all three
are alive. The scavenger's ecology is visibly its own: it hunts nothing, breeds
fast, lives ~6000 ticks against the stalker's 14 000, and sees furthest of the
three (radius 14 against 12 and 6).

**Performance.** large-5k **80.6 → 80.97 ms/tick** while carrying ~7% more
entities (7219 → 7744) — the config indirection is not measurable, which is the
point of resolving once and freezing.

**Deviations from the step spec (documented):** (1) **No protocol bump** — the
spec allows this explicitly ("possibly none"), and nothing new is observable.
(2) **"Activity pattern" and "habitat preference" are not schema blocks**: there
is no diurnal cycle to have a pattern in, and habitat preference is already
expressed through `migration.tracksForage` and the comfort band rather than as a
field of its own (A49). (3) **The species roster is still a hand-written import
list**, not a directory scan — runtime species authoring is explicitly out of
scope, and an import list is the honest static form (A50).

**Follow-on notes for later steps:** Step 30 inherits a world with three species
and ~7% more animals per scenario, and the C6 neighbour-walk fold it owes is now
worth more per tick than it was. The schema is also where a fourth species would
go with no code at all — which is the cheapest way to test whether C6's
optimization actually generalizes.

---

## Step 30 — Measured performance optimization

**Status:** Complete

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

- [x] Profiling report with before/after for each change
- [x] Determinism preserved (byte-identical runs)
- [x] Tests pass
- [x] Visible result verified (higher counts within budget)
- [x] Documentation updated
- [x] Performance checked (mature target)

### Explicitly out of scope

Speculative optimization without a profile; changing observable behavior.

### Completion notes

**Scope taken.** A performance-focused **cleanup** rather than a deep
optimization pass: demonstrated bottlenecks only, and nothing that could move
the simulation. Struct-of-arrays storage, worker threads, region subscriptions,
and binary encoding were all available under the step's spec and none was
needed — the profile said two systems were 77% of a tick, so that is where the
work went. No protocol bump, no save-format bump, no fixture change.

**Measured first, twice.** A per-system timing harness (wrap every registered
system's `update`) on large-5k, and a V8 CPU profile for function-level self
time. The result was unambiguous and matched what §1.4 C6 had predicted since
Step 7:

| System               | ms/tick | share |
| -------------------- | ------: | ----: |
| `PerceptionSystem`   |   38.48 | 54.8% |
| `SocialSystem`       |   15.30 | 21.8% |
| `DecisionSystem`     |    7.80 | 11.1% |
| the other 19 systems |    8.67 | 12.3% |

Everything added since Step 23 is under 1 ms/tick, exactly as those steps
claimed. `AgingSystem` is **0.17 ms/tick**, which settles B6 without writing
any code.

**Result: large-5k 86.59 → 68.75 ms/tick (−20.6%)**, −18% to −20% on every
other scenario. The demo world's authoritative tick is now ~1.0 ms.

**What actually changed, in order of what it bought:**

1. **The second neighbour walk is gone (§1.4 C6 — closed).** 15.30 → 5.03
   ms/tick. Perception and sociality each ran `queryRadius` over the same
   neighbourhood; perception now publishes the ids and distances it already
   computed into `world.neighbourhood`, and the social system reads that.
   It is sound because the social system runs in `decision` at priority −10,
   perception runs in the `perception` phase, and nothing moves in between.
   Both preconditions are **checked rather than assumed**: the list must carry
   the current tick (perception supports `updateInterval`), and its radius must
   reach at least as far as the social one. A _longer_ list is safe — everything
   past the social radius fails the distance gates anyway. The buffer is
   deliberately kept beside the perception summary rather than inside it,
   because the summary is projected to inspection and this is internal scratch.
2. **The perception cell scan got cheaper per cell.** 38.48 → 27.73 ms/tick.
   Four changes, none of which alters which cell wins: row x-spans computed from
   the circle rather than testing a bounding box (the corners are ~21% of a
   square, and the exact distance guard is _kept_ so boundary cells are still
   decided by the same comparison); terrain read once per cell with passability
   derived from the code via a new `isPassableCode`; the "nearer than the best
   so far" test moved ahead of the grid reads it guards; and the best-so-far
   held in plain numbers so the loop allocates nothing.
3. **The spatial grid.** Packed integer bucket keys instead of `"x:y"` template
   strings — a radius query built one string per cell visited, in the hottest
   loop in the engine — and positions stored in the buckets so a candidate costs
   no second hash lookup. `queryRadius` self time is 7.3 ms/tick, now the second
   hottest function in the engine.

**What was rejected, and why the rejections matter as much:**

- **Ring-search early exit**, named as a candidate since Step 7. Scanning cells
  in rings and stopping once the answer cannot improve is exact only if ring
  order matches distance order — and it does not, because rings are ordered by
  _cell offset_ while the answer is the nearest cell to the animal's
  **continuous** position. It would change which cell wins. Worse, the exit
  would almost never fire: the scan hunts four things at once, and water, rock,
  and cover are absent from most animals' radius entirely, so it would run to
  the full radius regardless.
- **⚠ `Math.hypot` → `Math.sqrt(dx*dx + dy*dy)`.** `hypot` is several times
  slower in V8 and sits in both hot loops. It is also _more accurate_, so the
  two disagree in the last ulp — and a one-ulp change to every distance in the
  world is a simulation change, on a demo that §1.4 D14 establishes is a knife
  edge. Declined. If a later step wants it, it needs a ten-seed measurement and
  a new baseline, not a benchmark.
- **B5 (`utilityBreakdown` in saves) — measured, declined.** The premise was
  that it would bloat saves at 25k animals. Measured on a 3000-tick demo save:
  it is **3.3%** of 1.78 MiB. The actual bulk is the **event outbox at 42.4%**
  and vegetation at 15.2%; among entity fields, `genome` (4.9%) and `memories`
  (4.0%) both cost more than `utilityBreakdown`, and neither is derivable.
  Dropping it would buy 3% for a save-format bump and a fixture regeneration.
  Not worth it now, and the number is recorded so the next person need not
  re-derive it.
- **B6 (`age` derived from a `birthTick`) — measured, declined.** `AgingSystem`
  is 0.17 ms/tick, 0.2% of a tick. There is no cost to remove.
- **⚠ C8 (the boundary pile-up) — not attempted, and it is not a performance
  item.** Reflecting headings instead of clamping changes Step 5 movement for
  every system and needs its own ten-seed measurement. It stays open.

**⚠ One optimization was applied, measured, and reverted — the most useful
finding in the step.** `SpeciesRegistry.hunts` is the busiest predicate in the
engine (twice per neighbour per animal per tick) and scans `preySpeciesIds`
linearly, so precomputing a `Set` per predator looked obviously right. Two
whole-simulation runs said it was ~1% faster; two more said the opposite. A
direct microbenchmark of the predicate settled it: the `Set` is **35% slower**
at 20M calls, because the rosters are one or zero entries long and hashing a
string costs more than scanning an array of one. Reverted, with the measurement
written down at the call site so nobody re-does it. Recorded as §1.4 **D24** —
whole-system timings on this machine cannot resolve a 1% difference, and reading
one as signal is the same mistake as D14's five seeds.

**How behaviour parity was established** (the step's real risk, since an
optimization that changes iteration order changes the _simulation_):

- A fingerprint harness hashing the full serialized state after 3000 demo ticks
  on **six seeds**, plus a 256×256 world with 465 animals for 1500 ticks. All
  seven hashes are **identical before and after**, and were re-checked after
  every individual change rather than once at the end.
- `npm run benchmark` reports **identical start and end entity counts** in all
  four scenarios, and its built-in determinism check passes.
- `npm run fixtures:renderer` regenerates the committed protocol fixtures with
  **zero diff** — the renderer sees the same bytes.
- A new test (`test/social.test.js`, "the shared neighbour walk") runs 400 demo
  ticks with the shared list and 400 with the social system forced onto its
  fallback grid walk, and asserts the serialized states match. It also asserts
  the sabotage actually engaged, so it cannot pass by comparing two identical
  runs — and separately checks the shared list against a fresh grid query for
  the same ids in the same ascending order.

**Tests:** `npm test` → **662 passing / 0 failing, 170 suites** (was 660/169;
+2). Note that HANDOFF.md carried **609** into this step, which was already
stale — the count is now measured rather than inherited.

**Versions unchanged:** `PROTOCOL_VERSION` 28, `SAVE_FORMAT_VERSION` 27. No
observable interface moved, which is the strongest statement available that this
was a speed change.

**Mature target.** Not reached, and it was never reachable by cleanup alone: the
step's target is ~25 000 animals within a 1 s tick. Linear extrapolation from
large-5k puts ~25k entities at ~220 ms/tick, which is _within_ the one-second
budget — but that extrapolation assumes the world grows with the population
(vegetation and terrain cost scale with area, not animals) and it has not been
run. The honest statement is that the demo and every benchmark scenario sit far
under budget, and that the next real gain is structural (fewer cells visited per
animal, or perception staggered), not another pass of this kind.

**Follow-on notes.** The two neighbour walks are now one, so §1.4 C6 is closed
and the _next_ system that wants a neighbourhood should read
`world.neighbourhood` rather than adding a third walk — that is what the buffer
exists for. C3 (event volume) is untouched and is now visible in a new place:
events are 42% of a save.

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

### Milestone B — Self-sustaining herbivore loop (Steps 5–10)

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

| #   | Scenario                     | Seed  | Expected qualitative behavior                             | Stable assertions                                                        | Steps | Renderer fixture? |
| --- | ---------------------------- | ----- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ----- | ----------------- |
| 0   | Baseline determinism         | 42    | demo world runs identically                               | two runs byte-identical                                                  | 1     | no                |
| 1   | Terrain sandbox              | fixed | water + rock present, rock impassable                     | cell-type counts; blocked cells                                          | 2, 5  | yes               |
| 2   | Movement sandbox             | fixed | one animal navigates around obstacles                     | never enters blocked cells; stable pos@N                                 | 5     | yes               |
| 3   | Foraging sandbox             | fixed | herbivore finds + eats a patch                            | energy rises; biomass drops                                              | 8, 9  | yes               |
| 4   | Starvation sandbox           | fixed | predictable energy decline → death                        | exact death tick; carcass created                                        | 6     | yes               |
| 5   | Resource-competition sandbox | fixed | several herbivores, limited food                          | some survive, some starve (no balance)                                   | 9     | no                |
| 6   | Life-cycle sandbox           | fixed | accelerated grow/mate/birth/age/death                     | lineage completes; refs valid                                            | 11–13 | yes               |
| 7   | Predation sandbox            | fixed | pursuit, escape, failed + successful hunts                | ≥1 fail + ≥1 capture; carcass fed                                        | 16    | yes               |
| 8   | Inheritance sandbox          | fixed | short generations; kids resemble parents                  | parent-offspring trait correlation                                       | 20    | no                |
| 9   | Selection sandbox            | fixed | a pressure shifts a trait distribution                    | mean trait moves expected direction                                      | 21    | no                |
| 10  | Disturbance sandbox          | fixed | local event → displacement → recovery                     | bounded effect; recovery by tick N                                       | 27    | yes               |
| 11  | Sexual-selection sandbox     | fixed | females prefer size; the trait rises                      | rises _more_ than a choice-off control; S positive among males only      | 22    | no                |
| 12  | Herd sandbox                 | fixed | a herd holds together; a threat alarms the near side only | tighter than a herding-off control; far side never alarmed               | 23    | no                |
| 13  | Residency sandbox            | fixed | a resident settles a range; a neighbour leaves its ground | closer to home than a pull-off control; neighbour leaves 5/5             | 24    | no                |
| 14  | Outbreak sandbox             | fixed | one case in a dense group becomes an epidemic             | spreads past patient zero, peaks, burns out; an isolate never catches it | 25    | no                |

For each: record initial state, seed, expected behavior, stable assertions,
related steps, and whether a renderer fixture is generated. **Do not assert
exact final populations for stochastic runs.**

Scenario 11 is the pattern to copy whenever a step adds a _second_ force acting
on something already being measured: run the same seeded world with the new
mechanism on and off, and assert the difference between them. "The trait rose"
proves nothing when the trait also drifts on its own; "it rose further than the
control did" isolates the mechanism.

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
  the spatial index; energy has defined sources/costs; ids stable; **lineage
  references resolve to an accurate status** (`alive` / `carcass` / `dead` /
  `forgotten` — since Step 18 entities are removed, so "refs valid" would pass
  vacuously); expressed traits always equal what the genome expresses (nothing
  writes traits post-birth); observation never perturbs the population;
  commands apply at deterministic boundaries; save/load continuation matches
  uninterrupted runs; renderer imports nothing internal; no species-name
  literals in core systems (from Step 29).
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

### Observed status after Steps 1–25

What has actually happened, so the register reflects evidence rather than
prediction:

| Risk                                 | Observed?                                        | Evidence and outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Population explosion                 | **Yes (four times)**                             | Step 12 reproduction grew 8 → 1037 by tick 20 000, with food never limiting; re-tuned to costly reproduction (§1.4 C5). Inverse also seen: Step 11 without reproduction went extinct by ~9000. Step 16 found a genuine knife edge: 3 founding predators die out in 2 of 5 seeds, 7 wipe the prey out in 3 of 5; 4 sustains both. Tuned from a recorded five-seed sweep, and diagnosed first — the predators were well fed, so the failure was demographic stochasticity, not energy. Step 24 was the most destructive yet (5/5 → 1/5 at first) and had to be _bisected_ rather than tuned: the cause was a single behaviour, `patrol`, competing with the wandering animals need to find food. Step 25 cost one seed (4/5 → 3/5) until the _sublethal_ cost was tuned down — and the diagnosis mattered there too, since a run had 300+ infections and only 1–5 deaths, so the mortality rate was never the lever. |
| Tick-budget overruns                 | **Yes (contained)**                              | Step 1 found an O(n)-per-emit event-buffer trim (58.7 → 1.6 ms/tick after fix). Step 7 perception took large-5k 1.8 → 14.0 ms/tick. Current worst case ~46 ms/tick with a mixed predator/prey population — far under the 1 s budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Unstable parameter tuning            | **Yes — now the expectation, not the exception** | Hydration (§1.4 C4) and reproduction (C5) needed sweeps; Step 13's follow utility was reshaped twice; Step 15 re-tuned hydration from a recorded five-seed sweep. **Steps 16→18→19 each invalidated the previous step's balance**: Step 16's predator/prey tuning silently depended on a _defect_ (carcasses accumulating as a free larder), fixing it in Step 18 collapsed the ecology, and Step 19's seasons collapsed it again. Treat any step that changes an energy source, a mortality source, or a food ceiling as _requiring_ a fresh multi-seed sweep — and record the numbers in the config comment so the next person need not re-derive them. Step 22 followed exactly that: sexes and mate choice were swept on five seeds against a _control with choice off_, which is what showed that a shorter patience selected just as hard while keeping both species alive in 5/5 seeds rather than 4/5.     |
| Tests overfitting stochastic results | **Yes**                                          | §1.4 D1/D2 — one assertion rewritten four times; a behaviour test pinned to a specific seed. Step 19 deliberately _weakened_ a demo assertion (exposure deaths) back to a behavioural one after tuning made the outcome unstable. Step 22 found the sharpest case (D7): Step 21's selection sandbox had been passing on drift on a pinned seed, and the fix was to diagnose the mechanism (deaths were _all_ age deaths — the pressure was never applied) rather than re-pin, then re-verify on four seeds it had never seen.                                                                                                                                                                                                                                                                                                                                                                                      |
| Unbounded memory/event growth        | **Partly**                                       | Event _volume_ is high (C3) but bounded by the buffer; no unbounded growth observed. Step 13's per-entity life histories are hard-capped at 12 entries and relationship lists are sparse; Step 15's spatial memories are capped at 8 per animal and Step 17's injuries at 4, both enforced in their insert helpers so no future writer can bypass them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Determinism regressions              | **No**                                           | Byte-identical seeded runs asserted every step; never broken.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Engine–renderer coupling             | **No**                                           | Boundary tests have held since the renderer was built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Protocol/save incompatibility        | **No (by discipline)**                           | 20 protocol and 19 save-format bumps, each with fixtures regenerated and invalidation notes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Quadratic neighbour searches         | **No**                                           | All neighbour work goes through `SpatialGrid.queryRadius`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AI-generated duplication             | **No (actively countered)**                      | Shared `killAnimal` (Step 10), `isReproductivelyReady` (Step 12), `recordLifeEvent` (Step 13), `recordMemory` (Step 15), and `applyInjury` (Step 17) helpers extracted instead of duplicating. Step 13 put `followParent` in the decision system rather than building a second action-selection path, and Step 16 did the same for `flee`/`stalk`/`chase`. Step 17 reused the existing `health <= 0` death path and the already-projected `healthFraction` rather than adding either.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Over-generalized abstractions        | **No**                                           | Species config stayed single-species; generalization deliberately deferred to Step 29 (§1.4 B3/B4). Step 14 admitted no trait that no system reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Renderer fixtures drifting           | **No**                                           | Regenerated on every protocol change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
