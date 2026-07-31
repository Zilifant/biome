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
  meal. ✅ **The named lever — give it a reason — was tested 2026-07-29 and the
  diagnosis held**: `tend` (a mother returning to a hungry hidden calf) is
  patrol's shape with a reason attached, and it fired **1045–1455 adult-ticks per
  3000** where `patrol` fired **0–1** in the same worlds. Still open, now for a
  sharper reason: `patrol`'s target is a *place* rather than a *purpose*, so
  giving it a den means giving it something at the den to want.

- **⚠ A59 — A pride cannot take prey a lone lion would refuse** (from
  2026-07-30, phase 10; narrowed by phase 11). Cooperative hunting works and is
  measured — a lion's mean capture chance goes 0.454 alone to 0.534 with a
  pride-mate on the same quarry. What it cannot do is change **eligibility**:
  `predation.maxPreyMassRatio` is resolved per animal in perception, which cannot
  know whether help is at hand, so the lion needs a ceiling that lets it commit to
  a buffalo **alone** and does. This world can say "a pride is better at it" but
  not "only a pride will try it". The fix is a second cooperative ceiling, which
  means either teaching the perception hot loop about company (D28) or resolving
  eligibility twice; not worth it for one species.

- **⚠ A60 — Territory is an individual claim, so a social species cannot hold
  ground** (from 2026-07-30, phase 11). `TerritorySystem` marks cells by entity
  id and `retreat` moves an animal off ground *anyone* has marked, pride-mate
  included — so a pride with `territory.defends: true` scatters itself, and
  cooperative hunting measured **zero shared-quarry ticks in 8 000** until the lion
  was given `defends: false`. Shared pride territory is therefore not expressible;
  the fix is keying the claim layer on `groupRecordId`. ⚠ It sharpens **A35**:
  territory is not predator-only, it is *solitary*-only.

- **⚠ A63 — A perception gate is not a predation gate** (from 2026-07-30, phase
  14). Everything an animal knows about another animal comes through **one** test
  in `PerceptionSystem` — prey, threats, **mate candidates**, a juvenile's
  guardian, territorial rivals. Cover concealment was added there, correctly, and
  the species it was written for is the one it broke: a cryptic **solitary**
  predator stopped finding mates and its population fell **27 → 19**, with the
  hunting half working exactly as designed. Fixed by exempting conspecifics
  (camouflage is against other species), which is right on its own terms — but the
  general hazard stands and has no guard on it. ⚠ **Anything added to that gate
  gates reproduction too**, and the failure looks like a tuning problem rather than
  a plumbing one. The lever, if this bites again, is separating "can I see it" from
  "can I find my own kind"; nothing has needed that yet.

- **⚠ A62 — A calendar mechanism meets the compressed lifespan** (from
  2026-07-30, phase 13). The year is compressed to 8000 ticks and lifespans are
  compressed beside it (PLAN-SPECIES §11.6), each defensible alone; together they
  leave a large animal with **about one year of adult life**, so anything keyed to
  the calendar rather than to the animal's own clock costs a female her whole
  remaining reproductive life when she falls out of phase with it. Measured: a
  wildebeest rut over 0.30 of the year — wide, in life — left the species alive on
  **1 seed in 3** against 3/3 with `breeding.enabled: false`, on a clean
  dose–response (0.30 → 0.3 mean · 0.50 → 6.7 · 0.65 → 10.7 · none → 16.7). It
  ships at 0.65, which is a seasonal restriction rather than a rut. ⚠ The lever is
  `ticksPerYear`, **not** the breeding window: lengthening the year relative to
  lifespan is what makes a narrow window affordable, and it re-bases every seasonal
  measurement in the project.

- **⚠ A61 — An association weight only bites in mixed company** (from
  2026-07-30, phase 12). The weight is an *exchange rate between bodies* in the
  herd's centre of mass, so it decides whose centre wins when both kinds are
  present and cancels out of the mean when only the other kind is: a gazelle alone
  among wildebeest sticks to them exactly as hard as to its own herd. ⚠ The obvious
  fix — scale the herd *pull* by it too — was built first and measured **inert**:
  it charges the animal twice for one fact, and at `herdWeight` 0.6 a second
  discount of 0.5 caps the pull at 0.30 against a `wanderBias` of 0.35, so it can
  never win (a follower held station no better than one with the mechanism off,
  16.1 units either way). The lever is a *separate* pull weight rather than a reuse
  of this one; nothing has asked for it yet.

- **A32 — Juvenile defense fires about once in 12 000 ticks.** ⚠⚠ **All three
  named fixes have now been tried and measured, and all three failed** — territory
  (Step 24), the hidden-fawn stage (2026-07-29), and, at phase 10, relaxing the
  "nearer the predator than I am" test itself (`decision.interposeSlack`, measured
  2026-07-30: `entity.defended` 1/1/0 strict, 0/1/0 at slack 2, **0/1/1 with the
  clause removed entirely**, so the knob ships at its identity). The diagnosis has
  moved off ward selection altogether: predators commit to a **juvenile** in only
  6–9% of hunter-ticks, and in **1–4 of those per 2000 ticks** is a living parent
  within the 6 units it needs to perceive the hunt at all. The remaining levers are
  therefore about *what a predator chooses* and *how far a parent can sense* —
  species biology, to be settled against the buffalo cow in phase 11 rather than
  against the gazelle. `decision.defendTargeted` (a parent defends the calf the
  hunter actually committed to) shipped from this pass on correctness, not on
  measured effect.

- **⚠ A57 — A hidden fawn is concealed only if it was born on cover (~8–10%).**
  The hidden-fawn stage's `hide` half applies to every fawn; the *invisibility*
  half applies only on sheltering ground, and nothing makes a mother choose such
  ground to give birth on — so the concealed fraction (7.6–11.1%) tracks the
  sheltering fraction of the map (7.2–9.9%) almost exactly. Implemented, tested,
  correct, and rarely doing visible work. Named lever: **birth-site selection** (a
  female near term preferring cover), which is a new pull on the existing
  `shelter` action but changes reproduction placement, so it wants its own measured
  step. Also the strongest argument yet for A51 — more cover raises this with no
  behavioural change at all. ⚠ **Phase 9 made it slightly worse, knowingly**: the
  gazelle's new habitat preference is open-plain (`cover: 0.8`), so a mother is
  marginally less likely to be standing on sheltering ground when she gives birth.
  Folding A57 into `habitat` is not the answer — a flat per-terrain weight cannot
  express "a female *near term* prefers cover".

- **⚠ A56 — A two-member clan flaps between founding and dissolution.**
  `groups.minMembers: 2` makes a pair a clan and a lone animal not one, so a pair
  that drifts apart dissolves and re-founds on meeting again — measured
  2026-07-29 at **157 foundings against 150 dissolutions in 3000 ticks on seed 2**,
  against 7 and 0 on seed 1. Nothing is corrupted; the identity that "survives
  separation" just survives it only while a second member stays close. The named
  fix is hysteresis (hold a record N ticks below its minimum before dissolving),
  one field on the record, the same shape as `alarmedUntil`. ⚠ Not before batch
  2 — tuning a dissolution delay against the only clan-forming species in the
  world would fit it to a case the mechanism is about to outgrow.

  _(A55, the registry never firing in the demo, **closed 2026-07-29** — the hyena
  declares `groups.forms` and the demo founds real clans, asserted directly in
  `test/groups.test.js` rather than inferred from a survival number.)_

## Engine — behaviour and modelling

- **A18 — Prey have no spatial refuge from predators.** Cover slows both
  equally. Part of why the founding counts are a knife edge. The static `thicket`
  terrain (A51) is a first refuge: it blocks line of sight and predators will not
  follow prey into it. ⚠ **Phase 14 built the machinery and pointed it the other
  way, on purpose.** Cover now conceals (`world.concealmentAt`, a graded scale) —
  but scaled by a per-species `crypsis` that is **0 for every herbivore** and 1
  only for the leopard, so what shipped is an *ambush* mechanism rather than a
  refuge. Symmetric concealment was measured first and made the ambush predator
  worse (27 → 19), which is why prey crypsis is a separate decision: raising it
  changes every predator's living in the world at once and wants its own gated
  phase. **The mechanism is in place; the number is the open question.**

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
  growth/grazing/maturity superset. Relates to A18 (spatial refuge), A3 (the
  reserved `plant` entity kind — this uses a field, not entities), and A65 (it is
  also the browse a forage-source list would need a second source *for*).
  ⚠ **Two shipped limitations now share this one lever**, which is the strongest
  argument for it: A57 (a fawn is concealed only if born on cover) and the
  leopard's ambush ceiling are the same finding from two directions — **cover is
  3% of the map** — and more of it raises both with no behavioural change at all.

- **⚠ A65 — `diet` is a two-valued string, and it is the last unrepresentable
  niche axis.** Tested as `=== 'carnivore'`; everything else grazes. So there is
  no browser, no distinction between grass and woody browse, and no way to say
  "eats leaves off shrubs, not grass off the ground". The replacement is a
  **forage-source list** — which sources a species can use, at what relative rate,
  in what preference order — and it is the one species item that must touch
  `FeedingSystem` and `DecisionSystem`, still data-driven and still with no
  species-name branch. It needs **A51's woody layer first**, or there is nothing
  for the second source to be, and it is what blocks the rhino (A68). ⚠ **The
  measurement harness is inside the blast radius and is half-guarded**:
  `foodModelOf()` in `src/scripts/ethologist.js` is the single place the
  comparison lives and it **throws** on an unrecognised diet, naming the species,
  so an unmigrated ethologist stops rather than silently reclassifying every
  carnivore as a herbivore and reporting confidently wrong anomaly counts.
  Migrating that function is the whole edit and **must land in the same commit**,
  or the fix is untestable. Omnivory is not part of this — no species in this
  roster eats plants and meat.

- **A66 — Territory cannot be restricted by sex, life stage, or season.**
  `territory.defends` is a species-wide boolean, so "bucks hold rut territories
  that females and juveniles walk straight through" is not expressible — which is
  why the gazelle ships with `defends: false` and its male competition runs
  entirely through mate contests instead. The change is widening the field to
  `false | true | 'male' | 'female'` and reading `entity.sex` in
  `TerritorySystem`, plus a life-stage and breeding-window restriction. It is what
  would finally make A35 interesting, and it is a *different* fix from A60, which
  is about a group holding ground rather than an individual. ⚠ Sex-biased
  **dispersal** is already built and is not this: `groups.leavingSex` filters the
  existing dispersal event.

- **A67 — Vertical refuge: trees, climbing, and cached kills.** Deferred, and
  possibly permanently. A complete leopard rests above lions, caches kills above
  scavengers, and ambushes from height; expressing it needs an entity elevation
  dimension threaded through perception, movement, and predation, plus tree
  entities (A3) and a protocol change. A ground-only leopard is a convincing
  leopard — one shipped at phase 14 and hunts from cover instead. Revisit only if
  "cached out of reach" can be one more possession state rather than a new axis.

- **A68 — The species roster stops at eight; the rhino and the elephant are
  deferred** _(decided 2026-07-30)_. Scope rather than work. The **black rhino**
  is config-only but gated on A51 — without a woody layer it is a heavy
  wildebeest. The **elephant may never be built**: it needs A51, matriarchal
  families on the group registry, a `musthUntil` timed state (defensible — the
  same shape as `alarmedUntil` — but it must modify *derived* dominance rather
  than replace it), woody-floor damage, and it has no top-down control on a
  128×128 map. A config-only elephant would be physiology without ecology, which
  is worse than no elephant.

- **A35 — Territory is a predator-only phenomenon** at ~9 individuals. Grazers
  get a home range but no site fidelity and no claims.

- **A37 — Disease does not cross species.** The two species carry it
  independently; a shared or zoonotic pathogen is unbuilt.

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

- **A49 — "Activity pattern" is not a schema field.** ⚠ Half of this item
  **closed 2026-07-29**: habitat preference now exists as a per-species `habitat`
  field (one weight per terrain name) consumed by the long-range cue, and the
  gazelle uses it. What is still open is the *activity pattern* half — there is no
  diurnal cycle for one to exist in. See [`DOCS.md`](DOCS.md) §9 Migration.

- **A58 — Perception reports the *nearest* food cell, not the best-scoring one**
  _(2026-07-29, phase 9)_. Forage preference discounts a cell once an animal is
  standing on it, but perception still picks the nearest cell with anything on it, so
  a grazer walks to ordinary grass with a better patch two cells further off.
  Widening it means scoring every candidate instead of only cells nearer than the
  best so far — in the hottest loop in the engine, where D28 records one extra
  *argument* costing 12% of a tick. A stated bargain, harmless at one grazer.
  ⚠ **Phase 11 hit the same limit on the predator side, where it was decisive**:
  perception reports the nearest *eligible prey*, so a lion listing both gazelle
  and buffalo engaged a buffalo twice in 4000 ticks and batch 2 demonstrated
  nothing. Narrowing `preySpeciesIds` fixed that case; the general fix would close
  both. Re-examine at batch 3, when three grazers disagree about what a good cell
  is.

- **B7 — Three mass-blind constants, found by the 2026-07-28 mass audit** and
  deliberately left until the species that exposes each one exists. ⚠ **The
  species arrived on 2026-07-30**: `carcass.decayTicks` now has a 600 kg body
  rotting on a 6 kg animal's clock (one buffalo is 360 edible mass against a
  gazelle's 18, and the lion took 37.6% of all carrion in the world), and
  `hunting.captureStaminaCost` is flat against a `maxStamina` that now ranges
  80–120. Both are still unfixed, because each changes a food source or a hunt
  and phase 11 already changed both.
  `carcass.decayTicks` (a 600 kg body rots on a 6 kg body's clock — and changing
  it changes a food source, so it needs its own multi-seed sweep);
  `hunting.captureStaminaCost` (flat against a per-species `maxStamina`, so the
  ratio is expressible but untested until two predators differ); and
  `locomotion.maxOccupantsPerCell` (a headcount rather than a volume — the fix is
  an occupancy *cost*, on a knife edge). Every other candidate audited as scaled
  or correctly flat, with the verdict written into its config comment. Full
  reasoning in [`DOCS.md`](DOCS.md) §1.4 and
  [`legacy-docs/PLAN-SPECIES.md`](legacy-docs/PLAN-SPECIES.md) §4.

- **Four species blocks are still inherited unchanged by all eight species**
  _(2026-07-28, narrowed 2026-07-31)_: `feeding`, `traits`, `genetics`, and
  `disease`. No species varies what it gets out of a mouthful, how widely its
  individuals differ, how fast it mutates, or how it takes an infection, so a
  6 kg vulture and a 600 kg buffalo assimilate at the same declared rate with only
  the mass scaling between them. That is A38's shape four blocks deep. ⚠ **The
  other three blocks this item used to name have since been declared**: `hunting`
  by the lion, `behavior` by five species, `predation` by the three carnivores —
  so the pattern is "schema ahead of the roster", not dead weight, and it resolves
  by a species arriving rather than by an engine change. Closing what remains is a
  config edit apiece behind the [`DOCS.md`](DOCS.md) §20 species gate.

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
  range. Bounded by the buffer, and in the renderer both off by default and
  expired within a few hundred events, but it competes for the retention
  window — and events are **42% of a 1.78 MiB demo save**, more than the entire
  entity array.

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

- **⚠ P9 — The inspector popover's placement and hosting have never been driven
  in a browser.** Its pure logic is tested and its wiring was reviewed (which
  caught two real bugs), but positioning, edge-flipping, dragging, and the
  dock/float path stand on review rather than evidence. ⚠ Narrowed 2026-07-28:
  `tests-ui` opens the popover and checks it, and the `<details>` toggle path is
  covered for the metrics panel — this is now four specific unwritten specs, not
  an absence of browser automation. The clicks that would settle it: select a
  cell near the right edge (flip), drag the header (pin), press dock then float,
  expand Genome and reload (persistence).

- **P6 / E3 — Fixture mode has no inspection or metrics data at all**, so the
  panel shows ground and bulk fields but no sections offline. Closing it means
  adding an `entity.inspection` fixture to
  `scripts/generateRendererFixtures.js`.

- **⚠ P14 — The `/api/metrics` payload is 383 KB at eight species, and the
  species dimension is not what makes it that.** ✅ **Measured 2026-07-30 at batch
  3**, as this item asked. The report splits **347 KB of bounded history (91%)
  against 36 KB of current metrics (9%)**, and a species block is ~4.4 KB of which
  3.2 KB is eight trait histograms. So the **server-side species filter** PLAN-
  SPECIES §7 proposed is the wrong lever: it attacks the 9%, and the client wants
  every species' counts for its legend anyway. The payload is
  `historyLength × species × ~355 bytes` plus `species × ~4.4 KB`, polled every
  3 s — the history is 120 points of eight trait *means* per species, and the
  levers on it are fewer points, fewer traits in `summarizeForHistory`, or a delta
  encoding. Left open with the diagnosis corrected rather than fixed: on a
  localhost poll it is not yet a defect, and the roster grows by two more species
  at most (§10.4).

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
