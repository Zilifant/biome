# biome — Reference Documentation

A deterministic, headless, animal-centered ecosystem simulation engine, plus a
versioned protocol through which a browser ASCII renderer (and any other client)
observes and steers it. The engine is the product; Express is only a host.

This document is the consolidated reference for the whole system: what exists,
why it is shaped the way it is, what it costs, and **what is still open**. It
supersedes `PLAN.md` (the linear 30-step development roadmap, now complete) and
`HANDOFF.md` (the session-handoff summary) as the place to look things up. Those
two remain as the historical record — every measurement in this document is
traceable to a dated completion note there — but nothing in this document
depends on reading them.

**Open work is collected in §1.** Everything not implemented, not optimized, or
known to be broken is listed there with its evidence, its reasoning, and a
pointer to the section that explains it. Nothing has been quietly dropped.

---

## How to read this document

⚠ **Every number here is a reading taken on a date, not a standing fact.** This
is the single most important convention in the project and it has already
bitten. Each step changed the world the previous step was measured in: dispersal
distance was measured at a median of 70 units, and the _same unchanged mechanism_
later measured ~60 because a third species and per-species metabolism changed
what the demo is. Neither figure is wrong. A figure is only misleading if you
cannot tell which world it describes.

So measurements here carry their date. If you re-measure one, **add the new
figure with its own date beside the original** rather than overwriting it — the
drift between them is usually the interesting part. Never inherit a number;
re-run the thing.

Verify current state with:

```bash
npm test                                    # the node:test suite
npm run benchmark                           # performance + a determinism check
npm run headless -- --ticks=2000 --seed=42  # advance the engine as fast as possible
```

### Current state (measured 2026-07-24)

|                       |                                                        |
| --------------------- | ------------------------------------------------------ |
| Roadmap               | Steps 1–30 complete; the plan is finished              |
| Tests                 | 796 passing / 0 failing, 202 suites _(2026-07-28)_     |
| `PROTOCOL_VERSION`    | 28                                                     |
| `SAVE_FORMAT_VERSION` | **29** — carcass possession (§9 Carcasses)              |
| Benchmark (large-5k)  | see BENCHMARK.md — measured per phase, interleaved against the same-session HEAD, because ⚠ the machine drifted ~10% across 2026-07-28 on identical code. Never compare against the 67.25 figure from 2026-07-21: it predates line of sight, thickets, the water field, and the crowding cap |
| Species               | 3 (grazer, stalker, corvid) — all pure config          |
| Species blocks        | **11** — `feeding`, `hunting`, `behavior` joined 2026-07-28 |
| Crowding cap          | **on** — `locomotion.maxOccupantsPerCell: 2` (§7 Movement) |
| Git                   | Steps 26–30 are **uncommitted** (the user handles git) |

The renderer is a fully separate subsystem with its own reference documentation,
[`src/renderer/DOCS-RENDERER.md`](src/renderer/DOCS-RENDERER.md) (and its own
`README-RENDERER.md`, `PLAN-RENDERER.md`, `HANDOFF-RENDERER.md`), which advance
independently of the engine. Its open items are in that file's §1 and in the
repository-wide [`ACTION-ITEMS.md`](ACTION-ITEMS.md).

---

## 1. Action items (open work)

> [`ACTION-ITEMS.md`](ACTION-ITEMS.md) is the same open work as a **flat list**,
> without the settled and closed items, and covering the renderer's open items
> too. This section is the one that carries the evidence and reasoning.
> ⚠ **They must be updated together** — closing an item, or opening one, means
> editing both.

Everything below is open **unless marked _Settled_ or listed in §1.6**. Items are
numbered with their original `PLAN.md` §1.4 identifiers (A = deferred scope,
B = structural debt, C = behavioural limitation, D = test/measurement fragility)
so cross-references in code comments and git history keep resolving. The "from"
note is the step that opened the item.

### 1.1 Known defects — ⚠

These are real problems in shipped code, not deliberate simplifications.

**⚠ A31 — The selection sandbox has never demonstrated its claim** _(from Steps
21, 23)_

An **unmet acceptance criterion** of the evolutionary-observation step, and the
oldest open ⚠. The sandbox is supposed to impose a pressure (sparse food
favouring metabolic efficiency) and show the mean trait moving in the expected
direction. Measured over seven seeds: the trait rose in 3 and fell in 4, mean
change **−0.0002**, with the selection differential _negative_ in five of seven
and its sign uncorrelated with the direction the trait actually went.

The cause is understood and is a property of the metric, not a bug in the
simulation: the selection differential compares breeders against **all** adults,
and in that world **71% of adults are breeders**, so the two samples are nearly
the same set. Tightening the breeding gate does make it visible (breeder share
falls to 3–17%, and the differential grows by an order of magnitude) but every
such setting drove the population extinct.

The test now asserts what the fixture genuinely shows and claims **no
direction** — it has not been papered over. Closing this means _building_ a
world that demonstrates selection, not tuning the existing one.

### 1.2 Implemented, tested, and near-inert

Real mechanisms that demonstrably almost never fire in the demo. Recorded
because "implemented" and "doing visible work" are different claims.

**⚠ A34 — Patrolling / site fidelity** _(from Step 24)_

Routine site fidelity competes with **wandering**, and wandering is how a
grazing animal finds its next meal. An animal that keeps going home keeps not
finding food. Measured, patrol cost the demo two seeds in five (4/5 → 2/5), and
gating it to territorial species only still left it at 1/5 — because a stalker
that walks home is a stalker not hunting.

The adopted setting ramps the patrol pull over **six range radii**
(`patrolSpanFactor: 6`), so an animal six range-widths from home does turn
around, but it never fires during normal foraging. The test suite tightens the
ramp specifically to exercise it.

_The lever, if this is revisited:_ give patrol a **reason** — food worth
returning to, or a den — rather than making it compete with foraging on equal
terms. ⚠ Check the ramp value before theorizing about site fidelity; a wrong
diagnosis has already been built and reverted once on the assumption that patrol
was pinning stalkers to empty ground when it was ramped almost out of existence.

**A32 — Juvenile defense fires about once in 12 000 ticks** _(from Step 23)_

A parent interposing between a predator and its own calf is implemented and unit
tested (both the decision and its effect on capture odds), but the geometry it
needs — an adult with a living juvenile of its own, that juvenile nearer the
predator than the parent and inside `defendRange` — almost never arises. Grazers
flee readily and juveniles disperse early.

Territory did **not** fix it as hoped: grazers turned out not to be able to
afford site fidelity at all (A34), so families are no more co-located than
before. The named lever is relaxing "nearer the predator than I am" to "near
enough to interpose".

**A55 — The persistent-group registry never fires in the demo** _(from
2026-07-28, PLAN-SPECIES.md §3.8)_

Not near-inert but **wholly** inert, and deliberately: no shipped species
declares `groups.forms: true`, so `GroupSystem` returns on its first branch every
tick. This is the schema-ahead-of-the-roster pattern A38 records for `disease`,
and it is measured rather than assumed — the demo's entity state is
byte-identical across three seeds to the tree without it. It stops being inert at
the first clan-forming carnivore (PLAN-SPECIES.md phase 7), which is also the
first time anything gets to be wrong about it. Until then the mechanism is
carried entirely by tests that invent a group-forming species.

### 1.3 Deferred scope

Features named in the roadmap that were deliberately not built, each with the
reasoning. Several are marked _settled_ — meaning the decision not to build them
is considered final, and re-opening one needs a new reason rather than a
reminder.

| #   | Item                                                                                                                                                                           | Status and reasoning                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A3  | **Individual tree/shrub entities.** Vegetation is a cell-level biomass field, not thousands of plant entities                                                                  | Open. The `plant` entity kind is reserved for them. Needed only by a step that wants _point_ vegetation                                                                                                                                                                                                                                          |
| A5  | **Renderer debug overlay of perceived cells**                                                                                                                                  | Open — a later renderer pass                                                                                                                                                                                                                                                                                                                     |
| A7  | **Action glyph tint.** The current action is textual in the inspector only                                                                                                     | Open — `action` already rides in the bulk snapshot, so this is renderer-only work                                                                                                                                                                                                                                                                |
| A12 | **Orphan mercy.** An orphaned unweaned juvenile is weaned early rather than facing a real dependency crisis                                                                    | Open **deliberately**. Removing it would change juvenile survival at the same time as any other change to juvenile survival, with no way to attribute the result                                                                                                                                                                                 |
| A18 | **Prey have no spatial refuge from predators** — cover slows both equally                                                                                                      | Open, but **advanced 2026-07-23**: line of sight now hides animals behind opaque terrain (§7 Perception), and the static **thicket** (A51, §7 Terrain) is a genuine refuge — it blocks sight and a non-fleeing pursuer will not follow prey into it (measured: 23–42% of fleeing grazers shelter inside, demo survival unchanged). Low cover still slows both equally; the remaining fix is a flee-_toward_-refuge pull. Territory was expected to address it and did not: grazers hold no ground (A35)                                                                                             |
| A22 | **Tombstones are bounded at 256**, so ancestry cannot be walked further back than that                                                                                         | Open. Lineage _depth_ is carried on the entity as `generation` and needs no lookup, so this only bites a query that walks ancestry                                                                                                                                                                                                               |
| A24 | **No per-cell microclimate.** Temperature is global; cover is the only spatial modifier                                                                                        | Open — needs terrain elevation, which does not exist. This is also why migration has no "warmer south" to steer toward                                                                                                                                                                                                                           |
| A28 | **Bottleneck detection is left to the caller.** The bounded history carries population per species over time, but nothing computes a minimum or flags a crash                  | Open. Detecting one is a judgement about what counts as a crash; inventing that threshold would be guessing                                                                                                                                                                                                                                      |
| A33 | **Mobbing** — prey collectively attacking a predator — is not implemented                                                                                                      | Open. Cooperative defense is passive (vigilance) plus a parent interposing, which is what a herd actually buys                                                                                                                                                                                                                                   |
| A35 | **Territory is a predator-only phenomenon** at ~9 individuals. Grazers get a home range but no site fidelity and no claims                                                     | Open. A genuinely territorial third species would be the demonstration                                                                                                                                                                                                                                                                           |
| A36 | **The claim layer is not drawn on the grid.** The home-range ring is drawn from inspection, for the selected animal only                                                       | Open. A per-cell ownership layer in every snapshot would rival vegetation for something that changes far more slowly and matters for one animal at a time                                                                                                                                                                                        |
| A37 | **Disease does not cross species.** A pathogen adapted to a grazer is not the one adapted to a stalker                                                                         | Open — a shared or zoonotic pathogen is its own subject                                                                                                                                                                                                                                                                                          |
| A39 | **An environmental spillover stands in for an unsimulated reservoir.** Without it the pathogen went extinct with its last carrier (one epidemic in 15k ticks)                  | _Settled_ — an honest modelling stand-in, the same shape as A42. Two draws per tick flat                                                                                                                                                                                                                                                         |
| A40 | **Remembered routes are not implemented**                                                                                                                                      | _Settled._ Remembered _places_ already exist and `recallFood` already steers to them. A route is a trajectory, and the codebase deliberately stores no trajectory anywhere — a home range is four numbers for exactly this reason                                                                                                                |
| A42 | **The forage cue reaches beyond perception** (18 units against 6)                                                                                                              | _Settled_ — a stated stand-in for coarse long-range cues this world does not simulate (the smell of green ground, the lie of the land). Bounded by being a _difference_: a flat world produces no pull                                                                                                                                           |
| A43 | **Population fragmentation is enabled, not asserted.** Herd labels split by hop count and separate forage patches pull herds apart, but no test claims a fragmentation outcome | Open — a later observability pass, if a fragmentation _measure_ earns its keep                                                                                                                                                                                                                                                                   |
| A44 | **Drought and severe winter are not local disturbances**                                                                                                                       | _Settled._ Both exist as _global_ weather states, so a spatially bounded copy would be the same mechanism at a different scale. Fire, flood, and storm have no global analogue, which is why they are the three that shipped                                                                                                                     |
| A45 | **A disturbance never modifies terrain**                                                                                                                                       | _Settled._ Terrain is derived and unsaved, so an edit would vanish on restore. "Affected terrain" is a derived traversal penalty plus a renderer overlay                                                                                                                                                                                         |
| A46 | **Disturbance mortality is rare in the demo** — 0–12 deaths across ten seeds, against **852 burns** over the same runs                                                         | _Settled._ A region covers ~1% of the map and animals walk out of it, so the cost is local and **sublethal** rather than demographic — the same shape disease turned out to have. The lethal path is exercised in a controlled test. Making it demographically significant means bigger or more frequent events, which breaks recovery (see D18) |
| A47 | **Animals do not seek other animals' burrows.** A burrow shelters whoever stands on it, but only trails exert a pull                                                           | Open. Giving burrows one means teaching the perception hot loop about features                                                                                                                                                                                                                                                                   |
| A48 | **Grazing clearings are not a feature**                                                                                                                                        | _Settled._ Vegetation biomass already drops visibly where animals graze and regrows after; a separate "clearing" would be a second mechanism for something the world already does                                                                                                                                                                |
| A49 | **"Activity pattern" and "habitat preference" are not schema blocks**                                                                                                          | Open. There is no diurnal cycle for a pattern to exist in, and habitat preference is expressed through `migration.tracksForage` plus the comfort band rather than as a field                                                                                                                                                                     |
| A50 | **The species roster is a hand-written import list**, not a directory scan or a runtime-loaded data file                                                                       | _Settled_ — runtime species authoring is explicitly out of scope, and a static import list is the honest form of "species definitions are code"                                                                                                                                                                                                  |
| A54 | ⚠ **Two mechanisms are invisible through the protocol.** (a) Persistent group membership — `world.groups` and the per-entity `groupRecordId` exist in the engine, but neither entity inspection nor `/api/metrics` mentions them and there are no formation/dissolution events. (b) **Carcass possession** — `possessorId` is not projected and a kill theft emits nothing, so an observer watching the demo sees a scavenger stop eating for no stated reason | Open, **scheduled**, and (b) is the sharper half because it is *live in the demo* rather than dormant. Both are held back deliberately so the projection rides the v29 bump the founding-roster rework needs anyway (PLAN-SPECIES.md §6) — bumping twice in consecutive phases means regenerating renderer fixtures twice for nothing. ⚠ Reusing `entity.contested` for a carcass fight was considered and **rejected**: the renderer's `EventCatalog` labels it "contests over a mate", so it would have made the UI lie, which is exactly what protocol v29 exists to stop. v29 owes: the group projection, `possessorId` on carcass inspection, and one new event type with its catalog entry |
| A51 | **Dynamic shrub layer (large bush / small tree)** — a growing, grazable, maturing plant, not a terrain code                                                                    | Open, planned. A dynamic layer mirroring vegetation (seeded capacity + biomass + a woody floor): blocks sight when mature, passable-but-slowing, weather shelter, edible-but-not-preferred with a woody floor once mature (eat the leaves, the trunk and its cover remain), clumped with some mature at init, denser than rock. The static **thicket** terrain is its shipped MVP (§7 Terrain); the growth/grazing/maturity superset is the full build — plan in [`ACTION-ITEMS.md`](ACTION-ITEMS.md). Relates to A3 (reserved `plant` entity) and A18 (refuge)                                       |

### 1.4 Structural and configuration debt

**B7 — Three mass-blind constants remain, recorded rather than fixed** _(from
the 2026-07-28 mass audit, PLAN-SPECIES.md §4)_. Every constant that ought to
scale with body mass was audited ahead of the species roster and given a written
verdict in its config comment. Three came back **open**, all deliberately left
until the species that exposes them exists:

| Constant                         | Why it is open                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `carcass.decayTicks`             | A 600 kg body rots on the same clock as a 6 kg one — wrong in both directions. Changing it changes a food source, so it needs its own sweep  |
| `hunting.captureStaminaCost`     | Flat against a per-species `maxStamina`, so the ratio is _expressible_ but no species varies it yet. Re-check when two predators differ      |
| `locomotion.maxOccupantsPerCell` | A headcount, not a volume: two 6 kg animals and two 600 kg animals cost a cell the same. The fix is an occupancy _cost_, on a knife edge     |

Everything else audited as `scaled` or *correctly flat*. Two were fixed on the
spot and are recorded as A52 and A53 below.

**B1 — `createDemoSimulation.js` was never renamed to `createEcosystem.js`**
_(from Step 4)_. Pure churn across server, scripts, and tests for no behavioural
gain. Cosmetic cleanup if ever wanted.

**B5 — `utilityBreakdown` persists on the entity** _(from Steps 8, 14)_. It is
recomputed every tick by the decision system and read by nothing in the
simulation, so persisting it is genuinely redundant.

_Measured 2026-07-21 on a 3000-tick demo save (1.78 MiB total):_

| Component       | Share |
| --------------- | ----: |
| event outbox    | 42.4% |
| entity array    | 34.6% |
| vegetation      | 15.2% |
| metrics history |  3.6% |
| features        |  3.3% |

| Top entity fields      | Share of whole save |
| ---------------------- | ------------------: |
| `genome`               |                4.9% |
| `memories`             |                4.0% |
| **`utilityBreakdown`** |            **3.3%** |
| `traits`               |                3.1% |
| `lifeEvents`           |                2.5% |

The premise — that it would bloat saves at 25k animals — measured **small**.
`genome` and `memories` each cost more and neither is derivable. Removing it
means a `SAVE_FORMAT_VERSION` bump and a fixture regeneration to buy 3%. Not
worth it now; the number is recorded so nobody re-derives it.

**C3 — Per-tick event volume** _(from Steps 1, 9, 13)_. One `entity.moved` per
animal per tick, plus one `entity.fed` per eater and one `entity.provisioned`
per nursing juvenile in range. Bounded by the event buffer and off by default in the
renderer's event feed (where it is also the short-retention tier), but it
competes for the retention window. Never addressed.

It surfaced somewhere new in 2026-07-21's save-size measurement: **events are
42% of a demo save, more than the entire entity array.** The established answer
when a transition genuinely happens often is that the renderer filters and
expires it, not that the engine emits less truth — but that answer has never been
tested against save size.

### 1.5 Unmet targets

**The mature performance target is not reached**, and was never reachable by
cleanup alone. The target is ~25 000 behaviourally complex animals inside a
one-second authoritative tick.

Linear extrapolation from large-5k puts ~25k entities at **~220 ms/tick**, which
is _within_ budget — but that extrapolation assumes the world grows with the
population (vegetation and terrain cost scale with area, not animals) and it has
not been run. The honest statement is that the demo and every benchmark scenario
sit far under budget, and that the next real gain is **structural** — visiting
fewer cells per animal, or staggering perception — not another cleanup pass. See
§13.

### 1.6 Closed, and recorded so they are not re-opened

| #   | Item                                                                                                                         | Closed by                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Terrain legend lives at `terrain.cellTypes`, not `world.cellTypes`                                                           | _Settled_ — it is the natural home for the terrain payload, and it keeps `world` to dimensions                                                                                                                                                            |
| A2  | Cover generated as clumped patches rather than per-cell scatter                                                              | _Settled_ — per-cell scatter fragmented the RLE (a 1024² snapshot went 916 KB → 118 KB for patches). See §7                                                                                                                                               |
| A4  | Bounded per-entity `lifeEvents`                                                                                              | Step 13 — `systems/lifeEvents.js`, capped at 12                                                                                                                                                                                                           |
| A6  | `approachFood` folded into `seekFood`                                                                                        | _Settled_ — identical mechanics (move toward food), so the extra label added no behaviour                                                                                                                                                                 |
| A8  | Optional `entity.drank` event skipped                                                                                        | _Settled_ — redundant with the public `action` field, and `hydrationFraction` already shows recovery                                                                                                                                                      |
| A9  | No sexes; the lower entity id gestated                                                                                       | Step 22 — females gestate and choose; males clear a lower bar and a shorter refractory period                                                                                                                                                             |
| A10 | `seekMate` steered toward a conspecific but assessed nothing                                                                 | Step 22 — steers toward the _best_ perceived candidate, distance-discounted                                                                                                                                                                               |
| A11 | No juvenile protection                                                                                                       | Step 23 — a parent interposes and materially lowers the predator's odds. But see A32: it is rare                                                                                                                                                          |
| A13 | Trait spread and mutation not per-species                                                                                    | Step 29 — `traits.spread` and `genetics` are species blocks                                                                                                                                                                                               |
| A14 | Only `speed` and `adultMass` precomputed onto the entity; other trait multipliers applied inline each tick                   | _Settled_ — measured as free. Storing four more fields per animal to save four multiplies is the wrong trade at 25k animals. See §9, Traits                                                                                                               |
| A15 | Kin identity omitted from memory kinds                                                                                       | _Settled_ at Step 23 — kin recognition got its reader (defense) and it reads the **authoritative** `parents`/`offspring` lists directly, so a decaying copy is still not needed, now demonstrably rather than by assumption                               |
| A16 | The `danger` memory kind had no writer                                                                                       | Step 16 — a failed hunt records the attack site in the prey's memory                                                                                                                                                                                      |
| A17 | Predator born at the grazer's birth mass                                                                                     | Step 29 — the stalker has its own `aging`, `metabolism`, and `hydration`                                                                                                                                                                                  |
| A19 | Hazards and fights are not injury sources                                                                                    | Step 23 (fights) and Step 27 (burns) — both writers exist                                                                                                                                                                                                 |
| A20 | ⚠ Health lost to dehydration never recovered, so a once-thirsty animal carried the damage for life while a mauled one healed | Step 25 — a healthy, well-fed animal slowly regains health from _any_ source of damage, gated on energy                                                                                                                                                   |
| A21 | No dedicated scavenger guild                                                                                                 | Step 29 — `scavenger.corvid`, implemented entirely as one config file                                                                                                                                                                                     |
| A23 | Snow is a weather state, not an accumulating snowpack layer                                                                  | _Settled_ — a layer needs a reason to exist                                                                                                                                                                                                               |
| A25 | No dominance or epistasis in genetics                                                                                        | _Settled_ — quantitative traits only; it keeps genotype→phenotype legible                                                                                                                                                                                 |
| A26 | Genetics is a module, not a registered system                                                                                | _Settled_ — inheritance happens at one instant reproduction already owns; a system would need a per-tick newborn scan                                                                                                                                     |
| A27 | Metrics polled over HTTP rather than streamed                                                                                | _Settled_ — a full aggregate would dwarf the per-tick payload                                                                                                                                                                                             |
| A29 | Mate preference direction is species data, only strength is heritable                                                        | _Settled_ at Step 29 — still no full Fisherian runaway, now a choice rather than a config gap                                                                                                                                                             |
| A30 | `GESTATING_SEX` is one model-wide constant                                                                                   | _Settled_ at Step 29 — `reproduction` is a species block, so a species needing the other answer could state it. Every species still sets it identically                                                                                                   |
| A38 | Disease parameters global rather than per-species                                                                            | Step 29 — `disease` is a species block; it simply does not _vary_ by species in the demo yet                                                                                                                                                              |
| A41 | Migration is grazer-only                                                                                                     | _Settled_ at Step 29 — grazer-only **by data** (`tracksForage`), a statement about the species rather than a limit of the code. Letting stalkers track forage as a prey proxy was tried and measured _worse_                                              |
| B2  | `config.demo` was a hardcoded prey/predator pair                                                                             | Step 29 — now a `founding` **roster**, so adding a species to the world is a line of config                                                                                                                                                               |
| B3  | Metabolism, hydration, aging in global config                                                                                | Step 29 — per-species blocks                                                                                                                                                                                                                              |
| B4  | Perception radius resolved a third, different way                                                                            | Step 29 — a `perception` block like everything else                                                                                                                                                                                                       |
| B6  | `age` stored rather than derived from a `birthTick`                                                                          | **Measured and closed** 2026-07-21 — `AgingSystem` is 0.17 ms/tick at large-5k (0.2% of a tick). There is no cost to remove, so deriving it would be churn. The `updateInterval` knob stays supported and unused, deliberately: the demo wants exact ages |
| C1  | ⚠ Entity spawning ignored terrain                                                                                            | Step 13 — founding spawns rejection-sample a passable position. Externally submitted `entity.spawn` commands are still the caller's responsibility, by choice                                                                                             |
| C2  | ⚠ Parent references stayed valid only because entities were never removed                                                    | Step 18 — bounded tombstone registry + a four-state lineage lookup                                                                                                                                                                                        |
| C4  | Single lake + no memory ⇒ animals stranded far from water died of thirst                                                     | Step 15 — animals remember where they drank                                                                                                                                                                                                               |
| C5  | Reproduction exploded exponentially (8 → 1037 by tick 20 000)                                                                | Step 16 — predation is the limiter                                                                                                                                                                                                                        |
| C6  | Two separate neighbour walks per animal per tick                                                                             | Step 30 — perception publishes its walk; sociality reads it (15.30 → 5.03 ms/tick)                                                                                                                                                                        |
| C7  | Movement uses the **current** cell's terrain modifier, and feeding is **in-cell**                                            | _Settled_ — two deliberate modelling choices                                                                                                                                                                                                              |
| A52 | ⚠ **Herbivore intake was flat while carnivore intake was mass-scaled.** `FeedingSystem` scaled `fleshIntakeRate` from Step 29 (the corvid, D22) but the herbivore branch above it still took a flat `0.6` biomass/tick at any body mass — the same latent bug, left standing on the other side of the same function because every herbivore was 30 kg | **Closed 2026-07-28** — scaled on the same allometric exponent. Inert in the demo by construction: the grazer sits exactly at `referenceMass`, so its factor is 1 and the world is bit-identical. Found by auditing for it rather than by a failure, which is the point of doing the audit in advance |
| A53 | ⚠ **A carcass returned its nutrients to one cell, and `addAt` clamps to that cell's carrying capacity and discards the remainder.** So the closing half of the death→nutrient loop (Step 6) leaked for everything above the reference mass. Measured against `vegetation.capacity: 8`: a 30 kg grazer loses ~1 of ~9 — invisible, which is why it stood for fourteen steps — while **a 45 kg stalker loses ~60%**, true since Step 16 | **Closed 2026-07-28** — the return spills outward through Chebyshev rings to `carcass.nutrientSpreadRadius` (default 4), fixed order, no randomness. `0` restores the old single-cell behaviour and is the measured control. Also the truer model: one cell is a stride, and a body enriches a patch |
| C8  | ⚠ Animals piled up at the world boundary (~49% of time in the 2-cell edge band, a 13× concentration) because movement _clamped_ off-map steps to the wall and animals slid along it | **Closed 2026-07-21** — movement now **reflects** the heading off a world wall instead of clamping the target, so an animal aimed off-map bounces back inward. Ten-seed demo measurement: edge occupancy **49.4% → 14.0%**, all ten seeds still surviving with equal-or-higher populations (155–178 → 164–183). See §7 Movement. The two boundary-sensitive residency-sandbox tests (D1) were recalibrated from single-endpoint snapshots to over-the-run measures, since a wall-bouncing animal no longer pins to the edge. **Follow-up 2026-07-22:** reflection closed only the _wander_ half; the residual crowding was predator-driven `flee` re-aiming into the wall every tick, closed at the decision layer by edge-aware fleeing (`escapeHeading`, §7 Decision). 2-cell edge occupancy ~19% → ~9%, acute corner pinning ~×4–9 → ~×1.5, survival unchanged. Remaining outer-ring occupancy is a herd-distribution effect for the forage-taper change, not flee-pinning |

---

## 2. Architecture

### 2.1 Layering

```text
Browser ASCII Renderer               src/renderer/app (separate subsystem)
   │
   │ commands / snapshots / deltas / events / queries
   ▼
Versioned Simulation Protocol        src/protocol
   │
   ▼
Transport Adapter                    src/server/transports (HTTP, WebSocket)
   │
   ▼
SimulationRunner (wall-clock host)   src/server
   │ engine.step() ~1/sec
   ▼
Headless Simulation Engine           src/simulation
```

Dependency arrows only ever point downward; nothing in a lower layer knows about
a higher one.

| Directory         | Responsibility                                                                   | May import                                     |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `src/protocol/`   | The versioned contract: commands, snapshots, deltas, events, queries, validation | nothing                                        |
| `src/simulation/` | The deterministic domain engine                                                  | `src/protocol`                                 |
| `src/server/`     | Real-time hosting and transports                                                 | simulation, protocol                           |
| `src/fixtures/`   | Deterministic world setup (demo)                                                 | simulation                                     |
| `src/scripts/`    | Headless entry points (headless run, benchmark, fixture generation)              | fixtures, protocol, simulation                 |
| `src/renderer/`   | Browser ASCII renderer + committed protocol fixtures                             | nothing (speaks the protocol as messages only) |
| `test/`           | `node:test` suites                                                               | everything                                     |

### 2.2 Architectural invariants — permanent, never violate

1. The engine runs without Express or the renderer.
2. The engine owns all authoritative simulation state.
3. Rendering is a separate system (a pure consumer of protocol output).
4. The renderer never directly mutates simulation state.
5. Ecological logic never exists in renderer code.
6. External state changes enter only through commands.
7. Observable state leaves only through snapshots, deltas, queries, and domain events.
8. Camera visibility never changes simulation fidelity.
9. Rendering frequency is independent of simulation tick frequency.
10. Randomness is seeded and reproducible; `Math.random()` is banned in the domain.
11. System execution order is explicit and deterministic (phase, then priority, then id).
12. Entity IDs are stable and never reused.
13. Structural creation and removal occur only at controlled boundaries.
14. Internal data layout does not leak into the protocol (whitelist projection only).
15. Save formats and protocol payloads are versioned.
16. Expensive systems support staggered (`updateInterval`) or event-driven updates.
17. No global pairwise organism searches in hot paths — use the spatial index.
18. Every new system must declare its state ownership (which fields it reads, which it writes).
19. Significant biological behavior must be inspectable via the protocol.
20. Renderer glyph and color mappings remain renderer-owned.

### 2.3 What is enforced mechanically

- `test/engine.test.js` — source scan of `src/simulation` and `src/protocol` for
  forbidden imports/APIs (Express, `ws`, DOM, `Math.random`).
- `test/renderer-boundaries.test.js` — the renderer imports nothing from the
  simulation, server, or protocol; no relative import escapes
  `src/renderer/app/`; the simulation stores no glyphs or colors.
- `test/protocol.test.js` — snapshots hold no references to internal mutable
  engine state and expose only whitelisted fields.
- `test/determinism.test.js` — two seeded runs are byte-identical.
- `test/species-schema.test.js` — **no species-name literal anywhere in
  `src/simulation`**, plus a companion scan requiring every `'herbivore'` /
  `'carnivore'` literal to sit within sixty characters of a `.diet` read.
- `test/source-scan.test.js` — the comment stripper the three scans above share.

⚠ **Source scans strip comments before matching.** A scan once rejected a file
for the word "window." inside a doc comment. The tempting fix is to reword the
prose; the right fix is that a scan about what code _does_ should not read prose.
A guard that fires on documentation teaches people to word around it rather than
to trust it.

⚠ **And a scan that strips comments with regexes goes blind, silently.** All
three scans shared this line until 2026-07-28:

```js
source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
```

Block comments first, line comments second — so a `/` followed by a `*` inside a
**line** comment reads as opening a block comment. `defaultSimulationConfig.js`
contains exactly that: the literal `config/species/*` in a `//` comment. The
regex took it as an opener and swallowed **six hundred lines**, including the
whole `demo.founding` roster — the one place in that file where species ids
appear. The invariant the species work leans on was unenforced across the file
where ids are most likely to spread, and every test passed throughout.

Reversing the order only moves the blind spot (a `*/` inside a line comment
inside a block comment). Comments are not a regular language, so the shared
stripper in `test/helpers/sourceScan.js` is a one-pass scanner tracking line
comments, block comments, strings, and template literals — and the demo roster is
now exempted **by name** rather than by accident. ⚠ Correcting it immediately
caught a live violation the blind version had been hiding, and the first draft of
the scanner had a bug of its own (it left template-literal mode at `${` and never
returned, so a file of HTML templates desynced) — which is why the stripper has
its own suite.

---

## 3. The tick model

The engine holds **no timers**. It advances only when someone calls
`engine.step()` / `engine.step(n)`. The `SimulationRunner` does so about once per
second in the server; tests and `npm run headless` step as fast as the CPU
allows. One step is one authoritative tick:

1. The clock advances to tick `T`.
2. Queued commands (spawn/remove) are applied and flushed, in submission order —
   they are part of the deterministic input.
3. Phases run in fixed order:
   `environment → perception → decision → movement → interaction → physiology →
lifecycle → cleanup → observation`.
   Within a phase, systems run by ascending `priority`, tie-broken by `id`.
   A system with `updateInterval: N` runs only when `T % N === 0`.
4. Deferred entity spawns/removals flush after `cleanup`, so `observation`
   systems always see the settled state of the tick.

The runner's pause/resume/speed only change _when_ ticks happen, never what a
tick computes. Renderer interpolation between ticks is a client concern.

**Coalesced multi-tick steps.** A manual `simulation.step` with `ticks: N` (only
accepted while paused) advances the engine N times and emits a **single** delta
covering the whole run rather than one per tick. The engine takes the same steps
in the same order either way — a coalesced run and a tick-by-tick one end
byte-identical, asserted in `test/runner.test.js` — so this is a reporting
cadence, not a simulation change. It is safe because a delta is a diff between
two snapshots rather than a replay: an animal born and eaten inside the window is
simply absent from both ends. Measured 2026-07-20, a 300-tick step costs 1
message and 1.4 MiB instead of 300 messages and 26 MiB. The one thing a long step
gives up is domain **events**: the outbox is bounded, so a 500-tick step emits
~77 000 events and the delta carries ~8 800.

---

## 4. Determinism

- Identical config + seed + ordered commands + tick count ⇒ identical state.
- `Math.random()` is banned in `src/simulation` and `src/protocol` (a test greps
  for it). All randomness comes from `SeededRandom` streams obtained via
  `context.random(streamName)`. Named streams are derived from the root seed, so
  one system drawing more values never shifts another system's sequence.
- Iteration order is deterministic everywhere: entities iterate in creation
  order, spatial queries return ids sorted ascending, scheduler order is
  explicit.
- Wall-clock time, `Date.now()`, and timers must never influence simulation state.

### Named RNG streams

| Stream                                    | Consumer                                        |
| ----------------------------------------- | ----------------------------------------------- |
| `terrain`, `vegetation`                   | world generation (once, at construction)        |
| `worldgen`, `demogen.age`, `disease.seed` | the demo fixture's founding cohort              |
| `decision`                                | action selection (exploration and tie-breaking) |
| `aging`                                   | late-life mortality roll                        |
| `hunting`                                 | capture roll **and** both wound rolls           |
| `possession`                              | contests over a carcass                         |
| `sex`                                     | sex of everything born in-world                 |
| `social`                                  | contest escalation                              |
| `weather`                                 | weather spell re-rolls                          |
| `disease`                                 | infection, progression, spillover               |
| `disturbance`                             | ignition                                        |
| `genetics`                                | founder genomes, recombination, mutation        |

Movement draws **no** randomness (it became a pure executor when the decision
system took over heading selection). Migration and engineering draw **none at
all** — a dispersal heading is geometry, and habitat sampling is deterministic.

### ⚠ Fixed draw budgets

A system must spend the **same number of draws regardless of outcome**, or its
results shift every other system's sequence. Established budgets:

- `resolveContest` — three, always. ⚠ It has three callers now (mate contests,
  territory disputes, and carcass possession) and the first two share the
  `social` stream while the third has its own. That is the point of named
  streams: a fight over a body cannot shift the sequence a fight over a mate
  draws from.
- Mate assessment — **zero**. A run where a female rejects a male leaves every
  stream exactly where a run where she accepts one does.
- Disease spillover — two per tick flat, whatever the population.
- Migration and engineering — **zero**.
- A disturbance ignition check — five, spent _before_ the early-returns.
- One hunt attempt — three (capture, then a wound roll for each animal),
  whether or not anyone is wounded.
- Movement — was exactly two per animal per update before it became RNG-free, so
  that terrain outcomes never shifted the stream.

Tests assert these directly, usually by running two worlds whose outcomes differ
completely and asserting the stream lands in the same state.

---

## 5. Time, units, and ownership

### Clocks — kept strictly distinct

- **1 simulation tick** — one authoritative `engine.step()`. The engine owns no timer.
- **In-world duration of one tick** — defined as **~1 in-world minute**, so a day
  is ~1440 ticks. Chosen so single moves read clearly at 1 cell ≈ a short stride
  while days and lifespans stay simulable.
- **Real-time runner cadence** — `SIM_TICK_MS`, default 1000 ms. The speed
  multiplier scales cadence only, never tick math.
- **Rendered frame** — `requestAnimationFrame`, fully decoupled.

`config.time` (`tickMinutes`, `runnerTickMs`) holds the convention as
**documentation only** — it never affects tick math.

**The year and the lifespan are both compressed.** A literal year would be
525 600 ticks and no demo run would reach winter. `ticksPerYear: 8000` puts four
2000-tick seasons inside a run, against a compressed `maxAge` of 12 000 — so a
grazer lives about a year and a half, and growth, stage transitions, and age
death are all observable in a short run.

### Units

| Quantity                  | Unit                                        | Notes                                       |
| ------------------------- | ------------------------------------------- | ------------------------------------------- |
| World coordinate          | 1 cell = 1 world unit                       | continuous floats in `[0,width]×[0,height]` |
| Distance                  | world units                                 | euclidean                                   |
| Speed                     | world units / tick                          | locomotion cost scales with it              |
| Age                       | ticks                                       |                                             |
| Body mass                 | kilograms                                   | scales metabolism and movement cost         |
| Energy                    | abstract kJ-equivalent "energy units"       |                                             |
| Food energy               | energy units per unit biomass / edible mass |                                             |
| Hydration                 | 0–1 fraction                                |                                             |
| Temperature               | °C                                          |                                             |
| Probabilities / fractions | 0–1                                         | always via a named RNG stream               |

### State ownership

- The engine owns all authoritative state. External consumers change it only
  through commands and observe it only through snapshots, deltas, and domain
  events.
- Systems may mutate fields of existing entities but must not structurally
  create/remove entities mid-iteration; they call `context.queueSpawn()` /
  `context.queueRemove()`, and the engine flushes at safe boundaries
  (`EntityManager` defers, `SimulationEngine.applyDeferredEntityChanges`
  flushes, keeping the spatial grid and `entity.created`/`entity.removed` events
  in sync).
- Position changes go through `world.moveEntity()` so the spatial index can never
  drift from entity state.
- The event bus is an **outbox for observers**, not an internal dispatch bus —
  systems call each other directly in hot paths. Retention is bounded
  (`config.events.maxBufferedEvents`); consumers that fall behind resynchronize
  from a full snapshot.
- **Two systems must never write the same field.** Every system declares what it
  reads and what it writes, in its module docstring.

---

## 6. Entity composition

Composition only — **no inheritance hierarchy**. Entities are flat plain-data
records; component groups were added only when a system needed them, and each
ships with its projection, persistence, inspection, and tests.

| Group            | Fields                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Identity         | `id, kind, speciesId`                                                                     |
| Position         | `x, y, heading`                                                                           |
| Locomotion       | `speed, moveIntent, lastMoveDistance, stamina, maxStamina`                                |
| Physiology       | `energy, maxEnergy, bodyMass, health, maxHealth, hydration, maxHydration, lowEnergy`      |
| Life stage       | `age, lifeStage, adultMass`                                                               |
| Current intent   | `action, actionTarget, utilityBreakdown`                                                  |
| Memory           | bounded `memories[]` (max 8)                                                              |
| Reproduction     | `gestationUntil, lastMatedTick, sex, mateSearchSince, lastCourtship`                      |
| Genetics         | `genome{}`, `traits{}` (expressed phenotype), `generation`                                |
| Relationships    | sparse `parents[], offspring[], guardianId, weaned, groupId, groupHops, groupRecordId`    |
| Injury           | `injuries[]` (max 4), cached `impairment`                                                 |
| Disease          | `diseaseState`                                                                            |
| Social / spatial | `alarmedUntil, alarmSource, homeRange, lastMarkTick, migrationHeading, migrationStrength` |
| Life history     | bounded `lifeEvents[]` (max 12)                                                           |
| Carcass          | `edibleMass, decayStage, diedTick, deathCause, possessorId`                               |

**Entity kinds:** `animal`, `carcass`, and the reserved-but-unused `plant`.

A dead animal becomes a `carcass`-kind entity **in place** — a kind change
carried as a delta update, not a removal. This preserves the entity id, keeps a
valid spatial-grid entry at the death position (which is what scavenging
queries), and costs fewer events than spawn+remove.

---

## 7. World layers

`World` owns every spatial layer. They are deliberately different shapes,
because a layer's storage should match how densely it is actually populated.

| Layer                            | Storage                                           | Saved?                                            | Notes                                          |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `TerrainGrid`                    | `Uint8Array`, row-major                           | **No** — regenerated from seed + `config.terrain` | ⚠ Static and **never mutated**                 |
| `VegetationGrid`                 | `Float32Array` biomass + static per-cell capacity | **Yes**                                           | Grazed, so not reproducible from the seed      |
| `SpatialGrid`                    | uniform hash of buckets                           | **No** — rebuilt from entity positions            | `cellSize: 8`                                  |
| `ScentGrid` (territorial claims) | coarse cells, 4×4 world cells each                | **Yes**                                           | Two numbers per cell: who claims it, how fresh |
| `FeatureGrid` (trails/burrows)   | **sparse `Map`**, bounded at 8192 tracked cells   | **Yes**                                           | Most of the map carries nothing                |
| Disturbances                     | a bounded list (≤3) of circles                    | **Yes**                                           | Not a cell layer at all                        |
| `GroupRegistry` (persistent groups) | a bounded `Map` of ≤64 records                 | **Yes**                                           | Not spatial at all — an identity store (§9)    |
| `Environment` (season/weather)   | a handful of scalars                              | **Yes**                                           | The one genuinely global state                 |

⚠ **Terrain is derived and unsaved, so nothing may mutate it.** Both the
disturbance layer and the feature layer exist because of this constraint: an
edit to terrain would silently vanish the first time anyone reloaded a save.
Ground changes are expressed as separate layers read through existing world
methods.

### Terrain

Six cell codes — `GROUND (0)`, `WATER (1)`, `ROCK (2, impassable)`,
`COVER (3)`, `DEEP_WATER (4, impassable)`, `THICKET (5)` — generated
deterministically at world init from circular lakes, **irregular rock
formations**, clumped cover patches, and **thicket stands**, then finished by a
**connectivity pass**. Out-of-bounds cells report `ROCK`, so passability checks
are safe without a separate bounds guard.

Per-code traversal speed: ground 1.0, water 0.5, cover 0.6, thicket 0.1, rock and
deep water 0 (impassable).

⚠ **A thicket is a spatial refuge (A18), the static MVP of the shrub layer
(A51).** A dense stand of tall brush / small trees, generated in clumps exactly
like rock formations but **more prevalent** (`thickets` count, on open ground
only) and with three refuge properties: it **blocks line of sight** (opaque like
rock), **shelters from the weather** (like cover), and is **passable but a
crawl** (speed 0.1). The crawl alone would only make animals _accumulate_ in
thickets — slow ground is high-occupancy — so the refuge behaviour lives in the
movement and decision systems: an animal treats a thicket edge as a wall and
**turns away**, and the only ways it ever steps in are the deliberate ones, all
last-resort:

- **A cornered flee.** `escapeHeading` (§7 Decision) treats thicket as a wall to
  _skirt_, exactly as it skirts a rock or a map edge: a driven prey runs **along**
  the thicket edge, and only when no open ground is left does the geometry aim
  into the thicket — a break-in the decision system marks (`intent.breakThicket`)
  so movement lets it juke into cover. ⚠ **Merely fleeing is not enough** to drive
  an animal in (it was, before 2026-07-24): a pursuer that is not itself cornered
  stops at the edge, and so does the prey until it must.
- **Pushing through a thin band to walled water or food.** A thirsty or hungry
  animal will crawl into thicket toward a resource within a few cells of it
  (`thicketReachDistance`), the corner-lake case where the only water is ringed by
  thicket and refusing the crawl means dying at its edge. Tightly gated so it is
  never a shortcut into deep cover.
- **Already inside** — it can always push back out, and in fact **prioritizes
  leaving** (the `leaveThicket` action, §7 Decision): a safe animal caught in a
  thicket heads for the nearest open cell rather than crawling around in it,
  unless a predator is within a few spaces, in which case the thicket is refuge
  and it stays.

A pursuer that is not itself cornered therefore stops at the edge, and — because
line of sight is blocked — loses the prey it followed in. Measured (thickets 0 →
14): concealment on predator–prey pairs **~1% → ~11%** (line of sight finally
bites), and edge/corner occupancy eased slightly, with demo survival unchanged.
It does not grow, is not eaten, and is not sought — the growing, grazable,
maturing version is A51.

⚠ **A lake is a shallow ring around an impassable deep core.** Each lake stamps a
shallow `WATER` disc, then a `DEEP_WATER` disc of `lakeDeepFraction` of the
radius at the same centre — so the drinkable water is the ring at the edge, the
only reach an animal has (swimming is future work). The deep stamp reuses the
already-drawn radius and adds no random draw, so it shifts nothing downstream;
only the cells change. Perception already reports shallow water as drinkable and
any impassable cell as an obstacle, so the two halves need no new plumbing: an
animal walks to the ring to drink and treats the core as a wall. The connectivity
pass counts deep water among the impassable, so the shallow ring stays connected
to land.

⚠ **Rock is scattered outcrops, not one dividing ridge.** The generator used to
lay a single straight rock ridge across the world, which paired with the single
circular lake to split almost every seed into two halves. Rock is now placed as
several formations (`terrain.ridges` is the formation _count_, 0 disables rock);
each is a short random walk of overlapping discs of varying radius, so its
outline is organic and its size varies from a small outcrop to a broad massif,
and none spans the map. `ridgeThickness` is gone; the shape is governed by
`rockFormationMin/MaxRadius`, `rockFormationMin/MaxSteps`, and
`rockFormationDrift`. The config key stayed `ridges` deliberately — the ~two
dozen flat-world tests disable rock with `ridges: 0`, and renaming it would be
pure churn for no behavioural gain.

⚠ **Passable terrain is guaranteed to be one connected region.** After all
terrain is placed, `#ensureConnectivity` labels the 4-connected components of
passable (non-rock) cells; if more than one exists it keeps the largest as the
mainland and links every other pocket to it by carving the **shortest** rock
corridor (rock → ground) found by a breadth-first search seeded from the
mainland. It carves the minimum, so rock stays plentiful. This makes "rock walls
off part of the world" impossible by construction rather than by hoping the RNG
is kind — `test/terrain.test.js` asserts a single passable component across a
spread of seeds and sizes, including a deliberately over-rocked world that
strands pockets before the pass runs. The pass runs once at construction and is
`O(width·height)`.

⚠ **Cover is generated as clumped patches, not per-cell scatter.** Per-cell
scatter fragmented the run-length encoding badly — a 1024² snapshot went 916 KB
against 118 KB for patches.

### Vegetation

A continuous biomass field growing **logistically** toward a terrain-derived,
seeded per-cell carrying capacity, with a colonization seed floor so grazed-bare
cells recover. Rock and water support nothing. Written only by the vegetation
system (regrowth), by feeding (`consumeAt`), and by carcass nutrient return
(`addAt`). Every mutation bumps a `revision`, which is what makes the snapshot
projection and per-tick deltas cheap to gate.

⚠ **Season scales the ceiling, not the growth rate.** Scaling the rate alone
looked correct and changed almost nothing — biomass moved 91k↔96k across a whole
year — because logistic growth toward a _fixed_ capacity means a field already at
capacity simply stops growing, and a slower rate cannot brown it off. Scaling
`capacityScale` plus a dieback term made the swing real: **85.8k in summer
against 30.4k in winter**. A test pins the distinction directly.

**Edge forage taper (`buildEdgeTaper`, off by default).** A static per-cell
capacity multiplier that ramps forage from 0 at the map boundary up to full over
an inland band — gradual, slightly irregular (a coherent-noise coastline), and
rounded hardest at the corners (the two axis tapers multiply, plus a radial
corner term). It is groundwork for the eventual irregular-island world, and it
was tried as the habitat half of the edge-congregation fix. ⚠ **Measurement
declined it for that purpose.** It shapes the map correctly but does not thin the
edge/corner crowding: predators follow the forage into the interior, so the
barren margin becomes a predator-light refuge that fleeing grazers run _to_
(the outermost corner band went the wrong way, 16 → 58 grazers), and removing a
third of the forage roughly halved grazer carrying capacity — a knife-edge risk
for a two-species demo. So it stays implemented, unit-tested, and deterministic
(a dedicated noise stream leaves the vegetation RNG sequence untouched, and it is
inert on maps below `edgeTaperMinDimension`, keeping every sandbox byte-identical)
but `edgeTaperFraction` ships at 0. Clearing the outer ring is a predator-side
problem, not a forage one.

### Chokepoints

**Effects belong at existing chokepoints.** Look for one before adding a reader:

- `world.speedModifierAt` carries terrain, disturbances, **and** worn ground.
- `world.isShelteredAt` carries cover, burrows, **and** thicket.
- `world.blocksSightAt` carries terrain opacity today (only rock), and is the one
  place a future sight-blocker — smoke, a wall, concealing cover — is added, so
  perception's raycast never learns a new source to be hidden by one.
- `thermalStress` (in `world/Environment.js`) carries weather **and** storms, and
  is shared by the system that _charges_ for stress and the system that _decides
  to walk out of it_, so the two cannot drift.

This is why the movement system and the thermoregulation code never learned that
features exist: a burrow simply _is_ sheltering.

---

## 8. Species — biology as data

**A species is data, and adding one is a config edit.** There is no engine
change to make, and a test will fail if you make one.

1. Add a definition to `src/simulation/config/species/` — biology only, never
   glyphs or colors.
2. Add it to the roster in `config/species/index.js` and to
   `config.demo.founding` if it should exist in the demo world.
3. Give it an appearance entry in the renderer's `SPECIES_APPEARANCE`.
4. Do **not** add a species-name conditional anywhere in `src/simulation`.

### ⚠ A species block beats a system's constructor options

This is the single most surprising thing in the codebase. `world.species.get(id)`
returns a resolved, frozen record; systems read `species.metabolism.basalRate`,
`species.aging.maxAge`, and so on. A species _overrides_ the same-named global
config section, so:

```js
new HydrationSystem({ dehydrationRate: 0.1 }); // ignored for a known species
new SimulationEngine({ config: { hydration: { dehydrationRate: 0.1 } } }); // works
```

**Configure through the config** — that is what the registry resolves against.
This inverted 23 tests in one go when the schema landed: they kept compiling and
quietly stopped meaning anything, which is worse than a break.

### The schema

Twelve blocks fall back to the same-named global config section:
`metabolism`, `hydration`, `aging`, `perception`, `traits`, `genetics`,
`disease`, `reproduction`, and — added 2026-07-28 — `feeding`, `hunting`,
`behavior`, and `predation`.
Alongside them sit fields that were always per-species: `matePreference`,
`territory`, `migration`, `diet`, `preySpeciesIds` — and `groups`, which joined
them the same day rather than becoming a block, because its config section also
carries world-level machinery (see §19).

⚠ **`feeding`, `hunting`, `behavior`, and `predation` do not yet _vary_ by
species**, exactly as `disease` did not when it landed (A38). They are the schema
arriving ahead of the roster that needs it: a 6 kg animal and a 600 kg one
currently eat at the same declared rate, two predators cannot differ in how they
capture, and nothing states a prey mass ratio. Three notes on how they resolve,
all modelling choices rather than plumbing:

- **`hunting` resolves off the _hunter_** — how you capture is your biology —
  **except `edibleMassFraction` and `agility`, which resolve off the prey**,
  because what they describe is how much of a body is meat and how well the
  animal being chased turns.
- **`predation` resolves off the _hunter_**: what this predator will take on is
  a fact about the predator, including how much risk its build lets it accept.
- **Feeding's mass scaling reads the `metabolism` block, not `feeding`**, since
  that is where `referenceMass` and `massScalingExponent` live and where
  `MetabolismSystem` reads them. Before this, a species overriding
  `metabolism.referenceMass` would have changed what it burns without changing
  what it can take in.

A species file therefore reads as a list of what makes that animal _unusual_.
The alternative — every species restating every parameter — makes the
interesting differences invisible and turns a change to a shared default into a
twelve-file edit.

Merging is **recursive**, because at least one block is nested (`traits.spread`)
and a shallow merge would silently drop seven of eight traits from any species
that tweaked one.

**Resolution happens once, at engine construction**, into deep-frozen records
held by a `SpeciesRegistry` on the world. A lookup in a hot loop is one
`Map.get` and no allocation. The registry is per-engine rather than a module
singleton on purpose: resolution depends on the _config_, and every sweep and
half the test suite runs engines with different configs in one process.

### The three species

| Species            | Role                 | Perception radius | Notes                                                                                                      |
| ------------------ | -------------------- | ----------------: | ---------------------------------------------------------------------------------------------------------- |
| `herbivore.grazer` | prey, herbivore      |                 6 | Displays **size** in mate choice; tracks forage; home range but no territory                               |
| `predator.stalker` | predator, carnivore  |                12 | Displays **speed**; holds, marks, and disputes ground; born at 8 kg, matures slower, lives to 14 000 ticks |
| `scavenger.corvid` | scavenger, carnivore |                14 | **Empty `preySpeciesIds`** — an entire trophic level expressed by leaving a field empty                    |

**The corvid is the proof that "species is data" is real rather than
decorative.** Its entire implementation is one config file. It is a carnivore, so
feeding already lets it eat carrion; it declares no prey at all, so perception
finds it nothing to hunt, the hunting system never fires for it, and — read in
the other direction — nothing fears it. Not one line of engine code was written
to add a whole trophic level. The empty case in `hunts()` was always reachable;
nobody had asked what it meant.

⚠ **A constant that is correct for one size is a latent bug.** Adding the corvid
first read as a balance problem (3/10 seeds against a 6/10 control) until the
real cause turned up: `fleshIntakeRate` was a flat per-tick number, so a 4 kg
bird stripped a carcass exactly as fast as a 45 kg predator. Invisible while
every carnivore was the same size, decisive the moment one was not. Mass-scaling
intake on the same allometric exponent metabolism already uses turned it into
5/10. **When adding a variant that differs by an order of magnitude in some
dimension, grep for constants that ought to scale with it before blaming the
variant's own parameters.**

---

## 9. Systems reference

Twenty-three registered systems. Each declares `{ id, phase, priority,
updateInterval }` and an `update(world, context)`.

| System               | Phase       | Priority |  Interval | What it does                                                                                           |
| -------------------- | ----------- | -------: | --------: | ------------------------------------------------------------------------------------------------------ |
| `WeatherSystem`      | environment |      −10 |         1 | Turns the year: season and temperature from the tick, weather drawn in spells                          |
| `DisturbanceSystem`  | environment |       10 |         1 | Raises fires, floods, and storms as bounded regions on a clock                                         |
| `VegetationSystem`   | environment |        — |         5 | Logistic growth toward a _seasonally scaled_ capacity                                                  |
| `PerceptionSystem`   | perception  |        0 |         1 | Bounded local sense of nearest food/water/obstacle/cover, nearby animals, parent, prey, threats, mates |
| `MemorySystem`       | perception  |       10 |         5 | Fades each remembered place on its own schedule and forgets it once too faint                          |
| `SocialSystem`       | decision    |      −10 |         1 | Herd labels, the local group summary, and alarm propagation                                            |
| `GroupSystem`        | decision    |       −8 |         1 | Persistent group records: founding, joining, inheritance, departure, dissolution                       |
| `MigrationSystem`    | decision    |       −5 | staggered | Reads the forage gradient and keeps a drift heading current; sends juveniles walking                   |
| `DecisionSystem`     | decision    |        0 |         1 | Scores every candidate action and sets the movement intent                                             |
| `MovementSystem`     | movement    |        — |         1 | Executes the intent: terrain-aware stepping, sprinting, passability                                    |
| `FeedingSystem`      | interaction |        — |         1 | Converts what the diet allows into energy                                                              |
| `ReproductionSystem` | interaction |       10 |         1 | Mate assessment, male–male contests, gestation, birth                                                  |
| `HuntingSystem`      | interaction |        — |         1 | Resolves one capture attempt                                                                           |
| `ParentingSystem`    | interaction |       20 |         1 | Provisions, weans, and breaks the guardian bond                                                        |
| `TerritorySystem`    | interaction |       30 |         1 | Home-range accumulation, marking, disputes                                                             |
| `EngineeringSystem`  | interaction |       40 |         1 | Wears trails and digs burrows                                                                          |
| `MetabolismSystem`   | physiology  |        — |         1 | Basal + movement + thermoregulation cost; stamina recovery                                             |
| `HydrationSystem`    | physiology  |        — |         1 | Dehydration, drinking, health damage                                                                   |
| `InjurySystem`       | physiology  |       10 |         1 | Closes wounds at an energy cost                                                                        |
| `DiseaseSystem`      | physiology  |        — |         1 | Compartments, transmission, condition recovery                                                         |
| `CarcassSystem`      | physiology  |       20 |         5 | Decay stages, removal, nutrient return                                                                 |
| `AgingSystem`        | lifecycle   |        — |         1 | Growth along a stage curve; death of old age                                                           |
| `MetricsSystem`      | observation |        — |        50 | Aggregates; writes no organism state                                                                   |

### Perception

Each living animal builds a bounded summary within its species' radius: nearby
animals via `SpatialGrid.queryRadius`, and the nearest food cell, water cell,
obstacle, and cover via a radius-bounded local cell scan. Never a global read.
Summaries live in a transient `world.perception` Map, rebuilt every tick and
never serialized.

Classification rides _inside_ the neighbour loop it was already walking: what I
hunt, what hunts me, my guardian, and a bounded set of mate candidates all come
out of one pass. That is why predation, parenting, and mate choice each cost
essentially nothing on top.

⚠ **Line of sight gates what an animal _sees_, not who is nearby.** An animal
behind an opaque obstacle is not a prey, a threat, a mate, or a guardian —
`hasLineOfSight` raycasts the grid (Amanatides–Woo, one step per cell crossed, so
it scales with the radius not the map) against `world.blocksSightAt`, and a
blocked target is dropped from the summary. Opacity is its **own** terrain
property, deliberately not passability: **only rock is opaque today** (deep water
is impassable but you see across a lake), and the sight chokepoint is built to
fold in non-terrain blockers — a fire's smoke, a future wall, cover if it is ever
made concealing — the way `speedModifierAt` folds in disturbances, so nothing is
specific to rock. Toggle: `perception.lineOfSight`.

Two deliberate scope limits. It gates **animals and carcasses**, not the
cell-feature scan — concealment is about who sees whom, and the cell scan is the
engine's hottest loop. And the **shared neighbour list stays raw** (see below):
line of sight shapes perception, but herding and alarm read the unfiltered
neighbours, because cohesion and a panic call are not strictly line-of-sight (an
alarm is a sound that carries around a rock). ⚠ **With rock as the only opaque
terrain its effect was near zero** — rock covers ~3% of the map, so a boulder
rarely sat on a sightline (concealment fired on ~1% of predator–prey pairs). The
**thicket** terrain (A51, §7 Terrain) is the sight-blocking terrain in quantity it
was waiting for: denser and more prevalent, it lifts concealment to **~11% of
predator–prey pairs** and turns a thicket into a real refuge (a fleeing prey
vanishes into one, and a pursuer that will not follow loses the sightline). Cost:
about +8% engine time for the raycasts.

⚠ **There is exactly one neighbour walk per tick, and it is perception's.**
Since Step 30, perception publishes the ids and distances it computed to
`world.neighbourhood` (a flat `[id, distance, …]` array per animal, in ascending
id order), and the social system reads that rather than querying the grid again.

**A new system that wants neighbours should read that buffer, not add a third
walk.** Two conditions must be checked, and `SocialSystem#neighboursOf` is the
helper to copy:

1. The buffer must carry the **current** tick (`world.neighbourhoodTick`) —
   perception supports `updateInterval`, so on a staggered tick it is stale.
2. Its radius must reach at least as far as yours. A **longer** list is safe;
   everything past your radius fails your own distance gates. A **shorter** one
   silently drops neighbours.

Keep a fallback grid walk. The test that proves the optimization sound runs 400
demo ticks down each path and asserts the serialized states match byte for byte.

### Decision

**All action selection lives here.** Other systems _resolve_ the chosen action.
The scored candidate set is:

`flee` · `chase` · `stalk` · `eat` · `seekFood` · `drink` · `seekWater` ·
`recallFood` · `recallWater` · `followParent` · `seekMate` · `leaveThicket` ·
`herd` · `defend` · `shelter` · `patrol` · `retreat` · `rest` · `wander`

Inputs are hunger, thirst, readiness, dependency, perception, memory,
temperament, threat, thermal stress, and the social summary. A small
`explorationRate` chance wanders regardless; ties break by fixed order.

⚠ **The weights live in two config sections, and the split is about ownership,
not about which system reads them** (2026-07-28). Both are consumed here:

- **`config.behavior`** — what an animal *wants*, and how it weighs competing
  needs: the flee/herd/hunt/rest/patrol weights and the thresholds it acts on,
  22 fields. A **species block**, because a skittish gazelle and a bold buffalo
  are different animals — and because a lion and a leopard sit at opposite ends
  of `herdWeight`, which is the one number separating a pride from a solitary cat.
- **`config.decision`** — the machinery of committing to and executing a choice:
  commitment windows, geometry probes, and thresholds defined against *other*
  parameters. Global, 14 fields.

The line matters more than exactly where it falls, and a field can be moved
across it later. What cannot be undone is erasing it: handing a species file
`minCommitTicks` or `fleeLookahead` lets it change how the *engine* works rather
than what the animal is like, and once one species tunes those, the demo stops
being one world with N animals in it and becomes N separately-tuned simulations
sharing a map.

The per-animal cost is nil — `update` already resolved the species for `diet`,
mate preference, and territory, so `behavior` rides that same `Map.get`.

**`leaveThicket`** heads an animal caught in a thicket toward the nearest open
cell rather than leaving it crawling around in cover at speed 0.1 (§7 Terrain).
It ranks above every idle/discretionary action (`herd`/`retreat`/`rest`/`patrol`/
`wander`) and below every real need and directed goal — those lead out of the
thicket anyway, since nothing grows or drinks in one — and it is suppressed when a
predator is within a few spaces, because then the thicket is refuge and the
animal stays.

⚠ **Acute hunger or thirst suspends the territorial pulls** (`patrol`, `retreat`)
and **lengthens an aimless wander**. A starving or dehydrating animal that a home
range keeps dragging back to the same empty quarter of the map dies there; above
`needOverridesTerritory` the territorial pulls stand down so it can follow the
long-range forage/water cue somewhere new. And with an unmet need but _no_
directional cue to follow, a wander strikes out in longer, straighter excursions
(`rangingThreshold`) so the animal covers new ground instead of re-searching the
patch it is standing in — inert once a drift gives it a direction, and for a fed,
watered animal, so the patrol lesson below still holds.

⚠ **`#intentFor` is a `switch` with fallthrough groups.** Adding a bare `case`
in the middle of one silently redirects everything above it. This happened: a
`case 'herd'` inserted into the shared `seekFood` / `seekMate` / `followParent`
chain redirected all of them, a missing field made the heading `NaN`, and an
animal with a `NaN` heading fails the passability check and **stands perfectly
still**. Five suites failed at once, all reading "chose the right action, did not
move." Worth remembering twice over: `JSON.stringify(NaN)` prints `null`, which
sends you hunting a null-assignment bug that does not exist.

⚠ **A new movement behaviour competes with foraging, and foraging must win.**
This is the most expensive lesson in the project. Patrol was added as a real
action and cost the demo two seeds in five, because wandering is how a grazing
animal finds its next meal and anything that displaces it starves the animal.

**Edge-aware fleeing (`escapeHeading`).** `flee` no longer aims blindly away
from the threat; the heading is chosen in three escalating tiers, all from that
same honest instinct, so a predator can no longer smear prey into a wall or jam
them into a corner (this closed the half of C8 the movement layer's reflection
could not — see §7 Movement):

1. **Open flight** — nothing blocks the away-heading, so take it. The common
   case, one room probe and done.
2. **Along-wall glide** — the away-heading points into a nearby world edge, so
   the component through the wall is dropped and the animal runs _along_ it,
   provided that glide is clear to the horizon.
3. **Cornered break-past** — the glide itself dead-ends (a map corner, or, once
   terrain gets restrictive, a rock hard against the wall). Every direction is
   scored by open room `roomAhead` — bonused when clear to the horizon,
   discounted for pointing toward the predator — and the best is taken. The
   discount is multiplicative, so a heading wins by _charging the predator's
   gap_ only when every safer direction has run out of room. That escalation is
   the scoring, not a special case, which is why it is already terrain-ready:
   `roomAhead` reads a rock exactly as it reads a map edge. **Known limit:** in
   a _wide_ concave pocket whose exit is farther than `fleeLookahead`, local
   room probing cannot tell a diagonal that merely stays clear within the
   horizon from one that leads out — deferred to real exit-detection when
   restrictive terrain exists to tune against (`test/escape-heading.test.js`
   pins the current behaviour).

⚠ **Thicket is one of those walls (`avoidThicket`, 2026-07-24).** A fleeing
animal that is not already inside a thicket treats its edge exactly as `roomAhead`
treats a rock, so the along-wall glide and the break-past route it **along** the
thicket rather than into the crawl — a merely-fleeing animal no longer dives into
cover (§7 Terrain). Only when the break-past finds no open ground left does the
heading point into the thicket; the decision system detects that (the escape aims
into thicket ⟺ cornered) and marks `intent.breakThicket` so the movement system
lets the animal juke inside as its last choice. An animal _already_ inside passes
`avoidThicket: false`, so it can still compute a straight-away escape through the
cover it is standing in.

Pure geometry and grid reads — no draws — so the two-draw-per-animal budget and
determinism hold. `fleeWallMargin` (0 disables, restoring straight-away flight),
`fleeLookahead`, and `avoidThicket` are the knobs.

**Four consecutive steps then added no action at all:**

- _Disease avoidance_ is a **subtraction** — a visibly sick animal is simply not
  counted in the herd's centre of mass, so the group's pull leads away from it.
- _Migration_ is a **bias on the heading `wander` would have picked anyway**, at
  the moment a fresh commitment is made.
- _Disturbances_ give **existing machinery a reason** — a burnt region is
  low-forage ground the drift carries animals off, and a fire writes the same
  `danger` memory a failed hunt does.
- _Trail attraction_ rides **migration's channel**.

The answer has been to give existing behaviour a cause.

### Movement

A pure **executor** since the decision system took over heading selection: it
steps along the intent, applies the terrain speed modifier, refuses impassable
cells, and on a block turns around (π) and expires the commitment so decision
re-commits. Sprinting spends stamina; exhausted animals drop to a walk.

⚠ **A step that would cross a world wall is reflected, not clamped** (this
closed C8, §1.6). If the raw target leaves the map on an axis, that velocity
component is flipped and the heading re-derived, so an animal aimed off-map
bounces back inward and the reflected heading is committed (it keeps leading
away rather than re-aiming at the wall next tick). Clamping the target used to
pin animals to the boundary — the clamped edge cell is still passable, so they
moved there and stayed — and they spent ~49% of their time in the 2-cell edge
band; reflection cut that to ~14% over ten seeds with no loss of demo survival.
Reflection preserves the step _length_ (it flips a component's sign), so the
single-step speed ceiling still holds. `world.clampX/clampY` remain as a
final safety net but are a no-op in the common case.

⚠ **Reflection closed only half of C8.** It stopped _wandering_ animals sliding
along a wall, but the residual edge crowding was a different mechanism it could
not touch: `flee` re-derives "straight away from the threat" **every tick**
(ttl 1), so a predator pushing prey at a wall had them re-aim into it the tick
after the movement layer bounced them off — a one-step reflection cannot fix a
heading that is regenerated each tick. Measuring by action confirmed it: with
predators removed the demo's edge occupancy is already uniform (~4%); with them
it is not, and ~half of all _fleeing_ ticks were spent in the 2-cell edge band.
The fix is therefore at the **decision layer**, where the heading is chosen —
see §7 Decision, `escapeHeading` (edge-aware fleeing). Ten-seed style
measurement over five seeds: 2-cell edge occupancy **~19% → ~9%**, acute corner
pinning (within 4 units of a corner point) **~×4–9 → ~×1.5**, demo survival
unchanged (predators and both species 5/5). The broad outer-ring occupancy
(mean radius ~62 vs ~50 uniform, centre still sparse) is _not_ a flee-pinning
effect and is left for the forage-taper habitat change.

One deliberate modelling choice remains: movement uses the **current** cell's
terrain modifier (the terrain the animal is moving _through_).

**Per-cell crowding cap (`locomotion.maxOccupantsPerCell`, default 2).** With no
cap, nothing stops animals sharing a 1×1 cell, and a tight herd genuinely
stacks — measured up to **~20 animals in a single cell**, with **~10% of
animal-ticks** spent in a cell holding more than two, which is not what a herd
grazing a meadow looks like. The cap refuses a step _into_ a cell already holding
N living animals, treated exactly like a wall (turn around, re-commit); moving
_out of_ or _within_ an over-full cell is always allowed, so it thins stacking
without ever trapping an animal, and carcasses do not count (a scavenger can
still stand on the body it is eating). A birth can still momentarily seat three
in a cell (a newborn spawns on its parent, no move involved); movement then
spreads them.

Because every pairwise interaction (predation, mating, courtship, provisioning)
needs exactly two animals and its distance gate is satisfied by adjacent cells,
**N = 2 breaks no behaviour** — verified across four seeds (demo + the corner-lake
world) with the cap on and off: every species survives, every death cause still
fires, and reproduction still runs. It is a real ecological change rather than a
no-op — final populations shift by ±15–55% per seed with **no systematic
direction** (the corner-lake world's grazers rose 44 → 68 and its exposure deaths
halved; another seed's grazers fell), the same magnitude as re-rolling the seed,
and it is deterministic (the outcome is a fixed function of movement iteration
order). `null` disables it, restoring the pre-cap uncapped movement — which is
what the mate-choice selection sandbox does (§1.4 A31), holding crowding off the
way it holds weather off, to keep a knife-edge evolutionary metric clean.

⚠ **This shifted the demo baseline on 2026-07-24.** Renderer fixtures were
regenerated and the benchmark re-measured; the older dated readings scattered
through this document (edge occupancy, migration, thicket concealment, …) predate
the cap and were taken uncapped — re-measure rather than inherit, per the reading
convention above.

### Metabolism and physiology

Each living animal pays `basalRate × massFactor` plus
`moveCostFactor × distance × massFactor`, where
`massFactor = (bodyMass / referenceMass) ** 0.75`, divided by the individual's
metabolic efficiency, plus a thermoregulation term.

**Thermoregulation is charged as energy**, so a cold snap kills by burning an
animal out — which is what hypothermia is. No separate death path was needed; an
animal that empties while under stress dies of `exposure` rather than
`starvation`. Same mechanism, accurate label.

⚠ **Check whether a per-tick field is consumed before you read it.**
`lastMoveDistance` is an accumulator that metabolism _consumes and zeroes_ in
`physiology`, so any `environment`-phase system reads 0 forever. The engineering
system sat in that phase and wore **nothing** for 15 000 ticks while its _other_
half (burrows, which read `action`) worked perfectly. A half-working feature
hides much better than a broken one.

### Hunting

**A hunt is a pipeline across the systems that already own each part**, never one
opaque roll:

_detect_ (perception reports `nearestPrey` / `nearestThreat`) → _evaluate_ (the
decision system gates on hunger, stamina, and a post-attempt cooldown) →
_approach_ (`stalk`, at a walk, saving the sprint budget) → _chase_ (sprint) →
_capture-or-escape_ (one attempt inside striking range) → _feed_ (the feeding
system's carnivore branch) → _recover_ (stamina regenerates at rest;
`lastHuntTick` blocks an instant re-attack).

`captureChance` comes from the predator's speed against the prey's, weighted by
how much sprint each has left and by how vulnerable the prey is (wounded, or not
yet grown), divided by how well the prey **turns**, and clamped so nothing is
ever untouchable or certain. Live sampling showed 31%–49% across consecutive
attempts. **The odds are published on `entity.hunted` rather than hidden.**

⚠ **`hunting.agility` is the one term in that product that resolves off the
prey** _(added 2026-07-28)_, joining `edibleMassFraction` as the second
prey-resolved field in a block that otherwise describes the hunter. Everything
else in the formula is about *speed*, and a gazelle's living is not made on
speed — it is made on turning better than the thing behind it. One divide, in a
function that already existed. Acceleration and turn radius are **not**
representable and were declined: movement stores a heading and a step length by
design, with no trajectory anywhere, and adding a physics model for one term
would be the wrong trade. Default 1, which is exactly the identity.

**Which individuals a predator will take** is the `predation` block (a species
block since 2026-07-28): `maxPreyMassRatio`, `minPreyMassRatio`, and
`riskyMassRatio`. The first two gate eligibility in perception's classification
loop, in both directions — what I will commit to, and what I need fear.

⚠ **The gate reads `bodyMass`, not `adultMass`, and that is the whole trick.**
`bodyMass` is what the animal weighs *now*, walked up the growth curve, so
age-structured prey selection falls out of a mass ratio for free: the calf is
under the ceiling its mother is over, with no life-stage conditional anywhere
and nothing new stored. ⚠ The test sits **after** `SpeciesRegistry.hunts()`,
never inside it — that predicate is the busiest in the engine and its linear
`includes` was measured rather than assumed (D24), so the species relation stays
exactly as cheap as it was and the mass comparison only runs on its rare true
case. `riskyMassRatio` is the cap on the existing `defenderMass / attackerMass`
term in the hunter's injury odds, which was a bare `2` in the code until it
became species data.

⚠ **No shipped species states a ratio, so all of this is inert today** —
verified, not assumed: with possession switched off the demo is state-identical
to the tree without any of it, on every entity field across three seeds. That is
deliberate. A ratio tight enough to be interesting would stop a *subadult*
stalker (bodyMass ~25 kg while it grows toward 45) taking an adult grazer (up to
~34 kg), which is a large ecological change bought for a roster with nothing to
spend it on. The species that need ratios declare them when they arrive.

Two bugs found by measuring rather than by tests:

1. _Prey ignored distant predators._ Flee urgency was `1 − d/radius`, which is
   **zero at the edge of perception**, so a hungry grazer kept eating while a
   predator walked up to it. Reshaped to half weight at the boundary rising to
   full at contact.
2. _Predators could never catch fleeing prey._ Stalking walks (1.35) while
   fleeing prey sprint (1.92), and the sprint only engaged inside `chaseRange: 4`
   — but prey bolt at up to 6 units, so the gap only ever grew. Predators starved
   in 4 of 5 seeds. Fixed by making a **fleeing target force the sprint
   regardless of range**, with `fleeing` exposed on the perceived prey record.

**Cooperative defense** is split in two: adult groupmates shave the capture
chance with diminishing returns and a cap (collective vigilance), and an
interposing parent counts double and makes the attempt genuinely dangerous for
the hunter. Which calf is _its own_ comes from the lineage lists directly —
recognition here is ancestry, not a scent.

### Feeding

An animal whose action is `eat` removes up to `intakeRate` biomass from its cell
and assimilates it at `energyPerBiomass × efficiency`, capped by its own energy
deficit so it never overeats. Carnivores eat carrion instead, at a rate scaled
by body mass and by the carcass's decay stage.

⚠ **Herbivore intake is mass-scaled too, since 2026-07-28** — it was flat until
then, which is the corvid's `fleshIntakeRate` bug (D22) left standing on the
herbivore side because every herbivore was 30 kg.

⚠ **It is _not_ inert in the demo, though it looks like it should be.** The
grazer *species* sits exactly at `referenceMass`, so the obvious conclusion is
that its factor is 1 and nothing changes — and that conclusion is wrong, because
what the system reads is the **individual's** `bodyMass`: `adultMass` (species
mass × the heritable `size` trait) walked up a growth curve. Measured on seed
42's founding cohort: **5.1–33.7 kg, mass factors 0.265–1.092**, so a half-grown
grazer eats about 40% less than it did.

That is the more correct model rather than a regression — metabolism already
scaled cost by the same mass on the same exponent, so before this a juvenile ate
a full adult ration while paying a juvenile's upkeep and was quietly subsidised.
But it changes an energy source, so it ships behind `feeding.massScaleIntake`
(false restores the flat rate) and was swept against that control.

_Measured 2026-07-28, **ten seeds × 15 000 ticks, four arms**_ — because this
change and the carcass-nutrient one (§9 Carcasses) both touch an energy source,
and A12's reasoning is that two changes to the same quantity at once leave no way
to attribute the result. Populations are grazer / stalker / corvid:

| Arm       | intake | carcass return | survival (seeds alive of 10) | mean population    |
| --------- | ------ | -------------- | ---------------------------- | ------------------ |
| `control` | flat   | one cell       | 10 / **10** / 10             | 143.6 / 5.4 / 242.5 |
| `intake`  | scaled | one cell       | 10 / **9** / 10              | 173.5 / 6.3 / 215.9 |
| `carcass` | flat   | spread         | 10 / **10** / 10             | 153.9 / 7.1 / 222.0 |
| `both`    | scaled | spread         | 10 / **9** / 10              | 170.0 / 8.4 / 227.7 |

Scaled intake **raises grazer carrying capacity ~21%** (143.6 → 173.5), which is
the expected direction: juveniles no longer eat an adult ration, so less
vegetation is stripped by animals that were being subsidised.

⚠ **The one apparent cost is a single seed of stalker survival (10/10 → 9/10),
and it should not be read as a result.** The seed in question (2) held exactly
**one** stalker in the control arm — a population of one is a coin flip, not a
surviving predator — and D14's rule is that a one-seed difference is the
signature of noise rather than signal. Stalker _means_ move the other way in
every arm (5.4 → 6.3 → 7.1 → 8.4). Recorded rather than tuned around.

Multiple eaters on a **cell** contend **deterministically**: entities iterate in
ascending id order, so the lower id eats first and later ones get the remainder.
⚠ Multiple eaters on a **carcass** no longer do — since 2026-07-28 a body has a
holder, and id order decides only who claims it first. See §9 Carcasses.

Feeding is **in-cell** — no separate eating range — because the decision system
only chooses `eat` when standing on food, so a range check would be redundant.
"Feeding duration" emerges: an animal eats until satiated at ~85% energy, when
wander utility overtakes eat, or until the cell is depleted.

**Juvenile dependency is a real constraint, not a top-up.** An unweaned juvenile
does not graze at all — the decision system scores no `eat`/`seekFood` for one
and the feeding system refuses it — so it lives entirely on energy provisioned by
its guardian (at a transfer loss, and never below the guardian's own reserve
floor). That is what makes it _follow_ the parent. The first attempt had
provisioning as a top-up on a juvenile that also grazed; measured, it delivered
~2.5 energy per juvenile — parenting existed but did nothing. Under real
dependency it delivers **~29.5**, a genuine parental investment on top of the 37
already spent on mating and birth.

### Reproduction, mate choice, and dominance

**There are two sexes, and one of them chooses.** The alternative — hermaphroditic
pairing with all the pressure in mutual preference — was rejected for one reason:
sexual selection is not really about preference, it is about an **asymmetry in
reproductive investment**. Without a difference in what a bad mate _costs_,
neither party has a principled reason to be choosy. So females gestate and
therefore choose; males clear a much lower energy bar (0.45 vs 0.8) and a much
shorter refractory period (200 vs 1800 ticks).

Sexes look like they should halve the birth rate and do not: under the old rule a
mating consumed _both_ adults for a full cooldown to produce one pregnancy, so
pregnancies per adult per cooldown are unchanged — the male was never the
limiting resource. What changes is that a female needs a _male_ in range rather
than merely another adult, which is precisely the pressure that makes choosing
worth something.

**Preference is split deliberately in two.** _What_ is preferred is species data
(`species.matePreference`: the displayed trait, how sharply it discriminates, how
much plain condition counts) — grazers display **size**, stalkers display
**speed**. _How hard_ it is weighed is the individual's heritable **`choosiness`**
trait, so the strength of sexual selection evolves rather than being a constant.

Grazers displaying size is load-bearing: size costs speed (a genetic tradeoff)
and burns more energy, so sexual and natural selection genuinely pull against
each other and the metrics can tell them apart.

**Choosiness costs, via a declining threshold.** A chooser insists on quality
`acceptanceThreshold × choosiness`, falling linearly to zero over
`choosinessPatienceTicks`. That is the classic sequential-search rule and does
two jobs: holding out for better spends breeding-window time she cannot get back,
and nobody holds out forever, so the mechanism cannot quietly starve a small
population to extinction on a threshold somebody picked.

Quality is half **signal** (the displayed trait against the species mean) and
half **condition** (energy, health, freedom from injury) — condition keeps the
signal honest, since an animal cannot fake being well fed.

**Standing is derived, never stored.** There is no pecking order in state and no
memory of who beat whom. An animal's dominance is read off what it _is_: mass,
condition, soundness, boldness, maturity. So it falls when the animal is mauled
and returns when it heals — which is the point. A rank you cannot lose by being
hurt is a title, not a rank.

Where it bites is **male–male competition**: rivals in range of the same female
contest for access, resolved pairwise down the list (one contest per extra
suitor, never a bracket). The stronger simply wins — there is no roll to lose, so
the event reports both _scores_ rather than odds. What chance governs is whether
the loser yields or they fight, and that is likeliest between animals too evenly
matched for either to back down. A fight wounds both, the loser worse.

Together: **competition decides who she is offered, and she still decides whether
to take him.** Neither silently overrides the other.

### Sociality

⚠ **This section used to open "a herd is a label, not a roster — nothing
anywhere holds a membership list", and since 2026-07-28 that is no longer true
of the world as a whole.** It is recorded here rather than quietly edited,
because it was a deliberate design decision held for seven steps and the reasons
it was right are the reasons the replacement is shaped the way it is.

There are now **two** sociality mechanisms, and they model different things:

| Mechanism                     | Models                                    | State                                                  | Owner          |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------ | -------------- |
| **Herd label** (`groupId`)    | fission–fusion aggregation: who I happen to be standing with | a label, recomputed every tick by local propagation | `SocialSystem` |
| **Group record** (`world.groups`) | identity that survives separation: who I belong to | a bounded, saved record with a membership list | `GroupSystem`  |

The label is not deprecated, weakened, or wrapped. It is what every loosely
aggregating species keeps using, and the grazer keeps using it exclusively —
which is also the control that proves it was not disturbed. What it structurally
cannot express is a lion pride, a hyena clan, a zebra band, or an elephant
family: those are memberships that persist while the animals are out of sight of
each other, and a positional label loses them the moment they walk apart. The
registry exists for exactly that, and for nothing else.

⚠ **Two systems must never write the same field**, and here that rule is what
keeps the mechanisms honest: `GroupSystem` never touches `groupId` or
`groupHops`, and `SocialSystem` never touches `groupRecordId`. A registry that
quietly rewrote herd labels would be a roster pretending to be a label, which
is the worst of both. A test asserts each direction directly.

The rest of this section is the label mechanism, unchanged. The registry is
written up under **Persistent groups** below.

#### Herd labels

**A herd is a label, not a roster.** Nothing in *this* mechanism holds a
membership list. Animals in sight of each other converge on a shared `groupId`
by local propagation — take the smallest label you can see — so herds form,
merge on contact, and split apart, all from one grid-local neighbour query per
animal and without a single structural operation.

⚠ **`minGroupSize` counts groupmates, not members.** At the default of 2 an
animal needs two *others* in range before it carries a label at all, so the
smallest herd that exists is **three** animals and a pair is nothing. That is
the intended behaviour and it is not going to change; the name reads the other
way, which is worth knowing before wondering why two animals standing together
have no label.

⚠ **A local mechanism needs an explicit bound to stay local. Population density
is not a bound.** Two things had to be bounded, and both were found by _running_
the system rather than by reasoning about it:

1. **Alarm was a chain reaction.** Alarmed animals re-alarm the neighbours who
   alarmed them, so panic never runs out of fuel — the first cut left **106 of
   119 grazers permanently fleeing**. Every alarm now carries its distance in
   hops from whoever actually saw the predator and dies at `maxAlarmHops`.
2. **Labels never dissolved.** "Take the smallest label in sight" only moves
   labels _downward_, so when a herd tore in half the piece without the root kept
   the old label forever. Labels now carry hops from their root; an orphaned half
   has no route back, its hop counts climb a tick at a time until they exceed the
   cap, and it re-founds on its own.

**Herding is deliberately the weakest thing an animal can want.** It loses to
hunger, thirst, weather and predators, which is what makes a herd loose and
living. It is scaled by `(2 − boldness)`, reusing an existing trait rather than
adding an eighth: a bold animal is a looser member.

Alarm is staged into a map and committed after the pass, so panic spreads exactly
one hop per tick regardless of entity iteration order. Writing straight to the
entity would let an alarm race down the id ordering and cross the whole herd in a
single tick.

### Persistent groups

_Added 2026-07-28 (PLAN-SPECIES.md §3.8, phase 3). See the note at the head of
§9 Sociality for what it overrides._

**A group record is an identity, not a position.** `world.groups` is a bounded
store of records — `{ id, speciesId, memberIds, founderId, foundedTick }` — and
each member carries a `groupRecordId` pointing back at one. Membership changes
only when an animal explicitly joins or leaves, so two members forty units apart
are still in the same clan while their herd labels have long since diverged.
That sentence is the whole feature; everything below is what it costs.

⚠ **It is inert in the demo, by construction.** No shipped species declares
`groups.forms: true` — the grazer and corvid are label animals, the stalker is
solitary, and each says so in its own file. `GroupSystem` builds its set of
group-forming species once and returns on its first branch every tick
thereafter, so this cannot move a demo number: measured across three seeds at
1500 ticks, entity state is **byte-identical** to the tree without it, and
large-5k is flat. The mechanism is the schema arriving ahead of the roster that
needs it, exactly as `disease` did at Step 29 (A38) and `feeding`/`hunting`/
`behavior` did earlier the same day. Its first consumer is the clan-forming
carnivore of batch 1.

**The rules, all of them the cheapest honest first cut:**

- **Founding** — two unattached conspecifics of a group-forming species within
  `joinRadius`.
- **Joining** — an unattached animal takes an existing group with room in
  preference to founding a new one, **smallest record id first**, the same min-id
  rule herd labels merge by and for the same reason: it makes the outcome
  symmetric. ⚠ There is **no admission test**; a pride does not really accept
  every passing lioness, but rank-structured admission is out of scope.
- **Inheritance** — a dependent juvenile takes its guardian's group and never
  joins by proximity. The guardian is the parent that gestated, so **matrilineal
  descent falls out with no sex conditional anywhere**.
- **Leaving** — the sex named by `leavingSex` leaves its natal group when it
  disperses. Natal dispersal already exists as a bounded outward walk, so
  sex-biased dispersal costs no new state and no new clock: it is that event,
  filtered by sex, and it is what makes a female-cored group expressible.
  ⚠ **Nothing else removes a living member.** Membership surviving separation is
  the point, not a side effect.
- **Dissolution** — a record with fewer than `minMembers` living members is
  destroyed and its survivors released. That is what reclaims a clan whose
  members have died, and `minMembers: 2` says "a lone animal is not a group of
  one" exactly as the herd label does.
- **No merging.** Two clans that meet stay two clans. Labels merge on contact
  because a label *is* proximity; an identity that dissolved into whichever group
  it walked past would not be an identity.

**The registry follows the world by filtering, not by being told.** Each update
first prunes every roster against the live entities — gone, dead, or no longer
claiming membership — rather than hooking every death path. One place to be
right instead of six places to remember, and it means a removal route this
mechanism has never heard of still cannot leave a phantom clan. A carcass is
dropped from the roster but **keeps its own `groupRecordId`**, which is a fact
about who it was, exactly as `deathCause` is.

**Three things it deliberately does not store**, each because storing them would
contradict a rule this codebase already keeps:

- **No leader, and no rank.** The plan's field sketch named a `leaderId`; it is
  absent. Standing is derived, never stored (see Reproduction above) — a rank you
  cannot lose by being hurt is a title. A consumer wanting "the dominant member"
  walks the bounded `memberIds` through `dominanceOf`.
- **No centre.** Where a group is changes every tick and is a pure function of
  where its members are, so it is derived on read rather than cached into saved
  state where it could go stale.
- **No size counter.** `memberIds.length`.

**Bounded, and it says so.** At most `maxGroups` (64) records exist. A full store
**refuses to found** until one dissolves; it never evicts. Evicting would
silently delete a group whose members are all still walking around, which is the
failure `forgotten` exists to avoid in the tombstone registry. Ids climb
monotonically and are never reused, so a stale reference can resolve to nothing
but never to the wrong group — the same discipline as entity ids.

Randomness: **none at all**, like migration and engineering. Measured directly:
a world whose species forms clans and one whose species does not are identical
animal for animal *and* stream for stream after 50 ticks.

⚠ **Not yet inspectable through the protocol, and that is a scheduling choice
rather than an oversight.** Invariant 19 wants "which pride is this lion in" on
the wire, and both the entity projection and a metrics count are held back to
ride the v29 bump that the founding-roster rework needs anyway (PLAN-SPECIES.md
§6) — two protocol versions in consecutive phases would mean two fixture
regenerations for nothing. Until then the registry is engine-visible only, and
the tests assert it directly rather than through a projection.

### Territory and home range

**A home range is four numbers, not a trajectory.** An exponentially-weighted
centroid of where an animal has actually been, plus its mean distance from that
centre, updated in O(1) per tick. A decaying mean _is_ "repeated-use area"
without storing a single past position. An animal that keeps returning somewhere
tightens its range; a rover reports a wider one; an animal that moves house drags
its range behind it. **Nobody sets the radius — it is measured.** A test asserts
the record cannot grow with the length of the animal's life.

**A territory is a mark on the ground.** Two numbers per coarse claim cell — who
claims it, how fresh — and everything else falls out of that pair rather than
being modelled beside it:

- **avoidance** is an O(1) lookup;
- **conflict** is standing on someone else's claim;
- **territory loss** is a stronger claim overwriting a weaker one;
- **occupation of vacant ground needs no rule at all** — when an animal stops
  marking (it died, it moved on) its claims fade and the next animal through
  writes its own.

Taking _occupied_ ground **erodes** the resident's claim rather than overwriting
it, which is the single rule that makes a boundary sit where two animals' marking
rates balance instead of wherever the last passer-by happened to stand.

Disputes are with the claim, not with a search: an intruder looks up who holds
the ground (O(1)) and then that animal by id (O(1)) — no spatial query anywhere.
If the owner is dead or far away, the intruder simply marks over it. If it is
close enough to answer, they contest, and the loser yields **every cell it held**
at once, which makes losing a territory something you can watch rather than a
slow fade.

**Grazers have ranges; stalkers hold ground.** That distinction — living
somewhere versus owning it — is the one the whole mechanism turns on, and it is
species data (`territory.defends`).

### Migration and dispersal

**Migration is not something an animal decides to do.** There is no `migrate`
action and nothing was added to the utility table. What it touches is the one
heading in the whole system that was going to be arbitrary anyway: when a wander
commitment runs out and the animal picks a fresh random direction, that direction
is bent toward better forage.

Three properties follow, and they are why the shape was chosen:

1. **Foraging cannot lose.** An animal that can see food still runs `seekFood`;
   one that remembers food still runs `recallFood`. Migration only ever replaces
   a _random_ heading with a _directed_ one.
2. **At zero strength the behaviour is bit-identical** to the world without it.
3. **Distance comes from commitment, not range.** The cue is shallow and local —
   eight directions sampled, no search, no route, no map — but a heading is held
   for 8–24 ticks and re-chosen the same way while the gradient persists, so a
   weak preference integrated over a long walk carries an animal a long way.

**The same channel carries a thirst cue** (`tracksWater`). Water is one lake,
too far to perceive (radius 6) or even recall (`recallRange` 60) across most of
the map — measured, 39–72% of grazers sit beyond recall of it at any moment — so
without a long-range cue a thirsty animal has no idea which way water is and only
finds it by drifting into it. `world.nearestWater` is that cue: a bearing field
flooded once from the shallow-water cells through passable ground (cached, no
draws), the point-source analogue of the forage gradient. When thirsty, the
wander bends lakeward, scaled by thirst exactly as forage is scaled by hunger,
and **whichever need is more urgent sets the drift** — the same "greater of
hunger and thirst wins" the decision utilities use. Like forage it only bends a
wander; once close enough to perceive or recall the lake, `seekWater` /
`recallWater` take the wheel. Measured (`waterBiasWeight` 0 → 0.5, ten-seed
style over five): mean hydration **~56 → ~66**, dehydration-crisis time
**~6% → ~2%**, occupancy within 20 cells of the lake **~17% → ~30%** (the lake
becomes a real gathering point), and grazer population _rose_ (fewer die of
thirst) with survival unchanged — the water counterpart of the forage gradient,
built for a point source instead of a field.

⚠ **Every species tracks water, even the ones that do not track forage**
(`tracksWater: true` for the stalker and corvid since 2026-07-24; they stay
`tracksForage: false`). A predator gets most of its water from what it eats and
rarely needs the lake — but _rarely_ is not _never_, and a stalker that spends
its life in a far corner of the map can dry out having **never once encountered
water**, with no cue to tell it which way to go. Measured on a corner-lake seed
(one lake jammed in a corner, 180×120): before, the last stalkers died of thirst
at the opposite corner having never perceived water; after, they cross the whole
map to the lake and drink, and predators survive a run that had previously
collapsed to zero (13 alive at t9000 against 0). The cue only bends a wander and
only while the animal is thirsty, so a fed, watered predator behaves exactly as
before. Two more pieces make it land: acute thirst or hunger **suspends the
territorial pulls** (`patrol`/`retreat`, §7 Decision) so a home range stops
dragging a dying animal back to the quarter it is dehydrating in, and a
remembered drinking spot **never fades** (water memory decay is 0 — a lake does
not move, §6 Memory), so an animal that drank once is not left to forget the only
water on the map.

**Nothing in it is seasonal, and nothing in it knows what a season is.** Season
arrives through the grass: a green spring flattens the gradient to nothing and
animals scatter; a grazed-out winter sharpens it and they concentrate.

**Recolonization is not implemented at all** — nothing anywhere knows a region
was emptied. Ground nobody is eating grows back to capacity and becomes the best
thing on the compass. The behaviour is a consequence of the mechanism rather than
a feature beside it.

**Dispersal overrides the gradient.** A juvenile that outgrows its guardian takes
an outward heading — straight out from the natal centre, so it costs no
randomness — and holds it for a bounded spell whatever the forage says, because
an animal that turned back at the first green patch would never leave.
`beginDispersal` also **clears the home range**, which is what makes dispersal
spatial rather than bookkeeping: a juvenile that kept its natal range would spend
its life being drawn back to its mother's ground.

Measured 2026-07-20: young grazers end a median **~60 units** from where they
were born, on a 128-wide map. (The same unchanged mechanism read **70** before
the species schema landed — see "How to read this document".)

### Disease

**An incubating animal is infectious and looks perfectly healthy.** Everything
interesting follows from that. If only visibly sick animals could transmit,
avoidance would be a complete defence and an outbreak would be a non-event — the
herd shuns the one obvious case and carries on. Because the disease runs ahead of
its own symptoms, **avoidance is late by construction**, and the density that
herding creates becomes a real cost rather than a free benefit. Live, the demo
showed **13 infectious animals of which only 4 were visible**.

Compartments are susceptible → incubating → symptomatic → recovered, and
**immunity wanes**, so a population that has been through an epidemic slowly
becomes susceptible again. Severity is _derived_ from the compartment rather than
stored.

**Transmission is driven by the infectious, not by everybody.** The obvious shape
— every animal looking around for a sick neighbour — would have been a **third**
full neighbour walk per animal per tick. Only infectious animals query the grid,
so the cost tracks **prevalence** rather than population: nothing at all between
outbreaks. It is also the more faithful direction — a pathogen spreads outward
from a host, it is not sought out by the healthy. A test pins the property by
showing that twenty animals and four hundred leave the stream in the same state.

**The cost is almost entirely sublethal.** A run has 300+ infections and only 1–5
deaths _from_ disease. What suppresses the population is time spent feeding badly
and not breeding — so `symptomaticTicks` and `feedPenalty`, not the mortality
rate, are the numbers that decide what disease costs.

### Disturbances

**A disturbance is a record, and its effects are derived from it on read.** That
one choice is the whole design and it is what makes recovery nearly free: a
flooded cell is never _marked_ flooded; it is slow **while a flood covers it**,
and the instant the record expires it is ordinary ground again. There is no
un-flooding pass to forget, and no way to leave the world stuck half-changed.

The one destructive effect is vegetation, because burnt grass should not reappear
when the fire goes out — it should _grow back_, and logistic regrowth already
does that. A fire consumes biomass once, at ignition.

Effects live in a **declarative table** rather than a switch, so a kind is a row
rather than a code path — which is also what made per-kind attribution possible.

Two deliberate model choices: a flood makes ground **slow rather than
impassable**, because the movement system refuses impassable target cells and a
region of them would wall in any animal standing where the water arrived — a trap
rather than a hazard. And overlapping disturbances take the **first match**
rather than stacking, because multiplying two effect rows together produces a
combination neither kind describes.

_Measured 2026-07-20:_ a radius-8 fire removed **78%** of regional biomass, back
to **48% at +100 ticks, 99% at +300, 100% at +600**, while an unburnt control
region a map away moved less than 1%.

### Ecosystem engineering

**Wear is the only state.** Two enumerated features — a **trail** worn by
traffic, a **burrow** dug by resting — held as sparse per-cell wear in a `Map`.
A disturbance is a record that _expires_; a feature has no clock at all. It
persists while wear arrives faster than decay removes it, so "built → maintained
→ lost" needs no maintenance mechanism: **"maintained" is simply what not fading
looks like.**

The feedback loop is the point: a trail is faster, faster ground attracts
traffic, traffic deepens the trail.

⚠ **Wear is charged per unit of distance, not per tick.** An animal crossing a
cell may spend several ticks in it, so per-tick charging made one slow pass wear
the ground as much as three fast ones — and once a phase bug was fixed this
**paved 7% of the map** (1116 simultaneous trail cells).

⚠ **Any threshold a continuously-varying value crosses needs a hysteresis band,
not a number.** Cells flapped across the feature threshold: one run produced
**9569 trails formed and 9081 lost** — a flickering world rather than a world
with trails in it, costing two events and a projection churn per flap. Promote at
`threshold`, demote at `threshold × 0.7`. This is a deliberate exception to
"derive rather than store": with hysteresis the state genuinely depends on
history, which is exactly what a derived value cannot express.

_Measured 2026-07-20:_ **96% of trail cells touch another one** — connected paths,
not a scatter of worn dots.

### Memory

At most **8** remembered places per animal, ever. Kinds are `food` / `water` /
`barren` / `danger`, and **decay rates are per kind and deliberately unequal**,
each for a stated reason: ⚠ **water never fades at all** (decay 0 — a lake does
not move, so a place an animal drank is remembered for good; forgetting a static
lake is never correct, and it was measured doing exactly that — a stalker that
drank eight times died with zero water memories), then danger (~1000), then food
(~250 — a patch may already be grazed out), and `barren` fastest of all (~170,
because vegetation regrows). Staying at full strength also keeps a water memory
from being the entry evicted when the bounded list overflows.

Re-experiencing a place **refreshes** the existing entry rather than adding one,
so standing in a patch for 200 ticks cannot fill the list.

**Writers are real experiences, not perception spam.** Feeding records where the
animal _ate_; drinking records where it _drank_; a failed hunt writes `danger` at
the attack site; a fire writes one too. Arriving somewhere remembered as food and
finding it bare **forgets that memory and records `barren` instead**, which is
what makes an animal's map self-correcting rather than an accumulating pile of
stale beliefs.

`recallFood` / `recallWater` are gated on perception having come up empty and
weighted _below_ sight, since a remembered patch may already be gone. Recall
targets are scored by strength discounted by distance, so a vivid memory across
the map loses to a fainter one nearby.

Staggering is real: decay is multiplied by `updateInterval`, so running every 5
ticks fades memories at exactly the same rate as running every tick, and a test
asserts the two are indistinguishable.

### Genetics

A **diploid genome** with one locus per heritable trait (all seven, plus
`choosiness`), and four operations: `sampleGenome` (founders only),
`inheritGenome`, `expressGenome`, `genotypeOf`.

- **Additive expression** — a trait's raw value is the mean of its two alleles,
  so a child sits _between_ its parents rather than picking a side.
- **Independent assortment per locus** — one allele from each parent chosen
  independently at every locus, so siblings genuinely differ.
- **Bounded mutation** with a fixed draw budget.

**Tradeoffs, because without them selection has nothing to push against.** With
no antagonism every trait would ratchet toward its maximum forever — bigger,
faster, bolder, all at once. Expression charges three antagonistic pairs (mass
costs speed, speed costs efficiency, boldness costs caution), computed from the
**raw** genotype rather than sequentially, so the order of the table cannot
change the result.

The inspector shows genotype beside phenotype, and **where they differ is exactly
where a tradeoff is being paid** — which turns an otherwise mysterious gap into
the explanation.

_Measured 2026-07-19:_ midparent–offspring correlations of **0.70 (size), 0.55
(speed), 0.57 (boldness)** — real resemblance, pulled below 1 by Mendelian
sampling and mutation exactly as it should be.

### Traits

Seven multipliers centred on 1.0, sampled once at creation and read-only
thereafter. Sampling is **triangular** (two draws summed), so most individuals
sit near the species mean and extremes are rare. Behavioural traits get a wider
spread (0.3–0.4) than physiological ones (0.12–0.18): temperaments differ more
visibly than body plans.

**Every trait has a real consequence** — this was the design constraint, since a
trait with no effect is exactly the "over-generalized abstraction" the risk
register warns about:

| Trait                    | What reads it                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| `size`                   | `adultMass` at spawn → growth curve → metabolic cost, carcass mass |
| `speed`                  | `entity.speed` at spawn → movement distance and movement cost      |
| `metabolicEfficiency`    | divides the metabolic burn → starvation resistance                 |
| `boldness`               | scales `wander` up and `rest` down; scales herd cohesion down      |
| `caution`                | scales hunger and thirst urgency → how big a reserve it keeps      |
| `exploration`            | scales `explorationRate` → how often it ignores its own ranking    |
| `reproductiveInvestment` | newborn starting energy, birth cost, provisioning rate             |
| `choosiness`             | how hard a chooser weighs the displayed trait                      |

They are **trade-offs, not upgrades**: a bold animal finds more and spends more;
a heavily investing parent raises better-stocked young at a higher price per
birth; a choosy one gets a better mate but breeds later.

Only `speed` and `adultMass` are precomputed onto the entity. The remaining
effects are inline float multiplies inside loops that already run — storing four
more fields per animal to save four multiplies is the wrong trade at 25k animals,
and it measured as no detectable cost.

### Metrics

A pure aggregation pass in the `observation` phase (the last phase, after
deferred spawns and removals flush, so it always sees settled state), staggered
every 50 ticks.

It produces trait distributions (mean, spread, extremes, fixed-bin histograms,
for both phenotype and genotype), generation depth, reproductive success, births
and deaths by cause, disease compartment counts, herd statistics, settled ranges
and claimed ground, and a **selection differential** per trait — reported both
overall and **per sex**.

That split is what separates the two kinds of selection: **a mate preference
moves only the sex being chosen, while natural selection moves both together.**
In the demo it reads exactly that way — the differential on size runs positive
among male grazers and flat among females.

**Rates are derived from state, not from events.** Births in a window are the
animals young enough to have been born inside it; deaths are the carcasses
stamped with a `diedTick` inside it. Reading the event bus instead would couple
metrics to event _retention_ (the buffer is bounded and gets trimmed) and would
double-count on replay.

It reports `null` rather than `0` when nothing has bred yet — an honest
"unknown" instead of a misleading "no selection".

**Observation must not perturb.** A metrics layer that nudged anything would be
measuring itself. A test runs the demo twice — once with metrics on the normal
cadence, once with the system effectively disabled — and asserts the populations
are **byte-identical** after 600 ticks. A companion test asserts every animal's
`traits` still exactly equal `expressGenome(its genome)` after 1500 ticks, so
nothing anywhere is quietly writing traits post-birth.

### Carcasses and lineage

A body is a resource on a clock. It passes through decay stages whose
`STAGE_YIELD` cuts flesh value at each one (1 → 0.8 → 0.5 → 0.25), and leaves
the world when either eaten clean or fully rotted — returning whatever mass is
left to the ground as biomass. **A carcass eaten clean returns nothing**; the
scavengers already took it.

⚠ **That return used to go into the death cell alone, and `addAt` clamps to the
cell's carrying capacity and discards the rest** — so the closing half of the
death→nutrient loop leaked for every animal above the reference mass. Measured
2026-07-28 against `vegetation.capacity: 8`: a 30 kg grazer returns ~9 and loses
about 1 (which is why it went unnoticed for fourteen steps), **a 45 kg stalker
loses ~60%**, and a 600 kg animal would lose nearly all of it. The return now
spills outward through Chebyshev rings up to `carcass.nutrientSpreadRadius`
(default 4), in a fixed order with no randomness; whatever still will not fit is
genuinely lost, which keeps the work bounded. Setting the radius to **0 restores
the exact single-cell behaviour** and is the control it was measured against.
This is also the truer model — one cell is a single stride, and a large body
plainly enriches a patch rather than a square metre.

_Measured 2026-07-28, ten seeds × 15 000 ticks against the `radius: 0` control:_
**survival unchanged** — grazers 10/10 both ways, stalkers 9/10 both ways,
corvids 10/10 both ways. Mean populations moved 173.5 → 170.0 (grazer),
6.3 → 8.4 (stalker), 215.9 → 227.7 (corvid). ⚠ Read those means as noise, not
result: per-seed grazer counts span 13–413 and move in both directions
(seed 1 120 → 67, seed 2 334 → 413), the same magnitude as re-rolling the seed —
the signature D14 and the crowding cap both describe.

Old remains being barely worth crossing the map for is what keeps scavenging from
replacing hunting.

#### Possession and kill theft

_Added 2026-07-28 (PLAN-SPECIES.md §3.9)._ A carcass used to have no owner, and
several carnivores on one body contended only through the ascending-id ordering
above — the lower id ate first and the rest took the remainder. That is not
competition, it is a queue, and it is wrong for the predator / thief / vulture
triangle the roster is built around.

**The whole mechanism is one field and three predicates.** A carcass carries
`possessorId`; an animal that feeds on it claims it; another carnivore either
feeds beside the holder, waits, or takes it by contest.

⚠ **Possession is held by presence, not by a clock.** The plan asked for a
freshness stamp; there is none. A holder still standing over the body holds it,
one that walked away does not, and no timer has to expire to say so — the same
judgement that keeps dominance and every disturbance effect derived on read. It
also means possession cannot get stuck in a state nobody can clear.

⚠ **A challenger only challenges when it is strictly stronger.** Dominance
decides a contest — there is no roll to lose — so an outmatched animal would be
choosing to lose, spending three draws and risking a wound for a meal it was
never going to get. And because the winner then eats (raising its energy, and so
its dominance) the arrangement is self-stabilising: a takeover happens once, not
once per tick, with no cooldown field to store and no flapping. Two exactly-equal
animals never contest, so the tie case cannot oscillate either.

⚠ **A bystander gets scraps, not nothing, and that was a measurement rather than
a preference.** The first version excluded outright, which is the obvious reading
of "arrive first, leave when the big animals come" — and it cost the demo three
seeds of predator survival. See the sweep below. `carcass.possessionShare: 0`
restores strict exclusion and is kept as the measured variant.

**Group-held possession falls out for free** — the first real payoff of the
group registry (§9 Persistent groups). A clanmate of the holder feeds *beside* it
rather than against it, tested as `eater.groupRecordId === holder.groupRecordId`
and read off the live holder, so there is no second copy of the membership on
the carcass to go stale. One clan member takes the body by contest and the rest
simply eat, which is what a clan displacing a lone predator looks like.

⚠ **One predicate, two readers.** `DecisionSystem` asks whether a body is worth
walking to and `FeedingSystem` asks whether it may be eaten. If those disagree
the animal walks to a carcass, is refused it, and then **keeps choosing `eat`
while starving on the spot** — nothing outscores a meal at your feet. So both
call the same functions in `predation/possession.js`, the same fix `drinkRange`
and `carcassRange` each got (D11). Known limit, stated rather than discovered
later: perception reports only the *nearest* carcass, so an animal turned away
from a held body does not fall back to a further free one that tick.

⚠ **Unlike the rest of phase 4 this is not inert** — the demo already had two
carnivores contending for the same bodies — so it ships behind
`carcass.possessionEnabled` and was swept against that control.

_Measured 2026-07-28, **ten seeds × 15 000 ticks, three arms**. Populations are
grazer / stalker / corvid:_

| Arm      | bystander gets | survival (seeds alive of 10) | mean population       |
| -------- | -------------- | ---------------------------- | --------------------- |
| `control` | possession off | 10 / **9** / 10             | 161.4 / 9.1 / 76.5    |
| `strict`  | nothing (share 0) | 10 / **6** / 9           | 176.2 / 7.6 / 80.3    |
| `shared`  | a quarter rate | 10 / **9** / 10             | 158.8 / 8.6 / 86.4    |

⚠ **The middle row is why the design changed, and the reason it failed was not
the predicted one.** Three seeds is well past the one-seed threshold D14 calls
noise, so strict exclusion is a real regression — but it did not work by starving
predators of carrion. **Per-capita carrion barely moved in any arm** (stalker
230.8 / 227.4 / 227.1). What moved was *how stalkers died*:

| Arm      | age | exposure | starvation | dehydration |
| -------- | --: | -------: | ---------: | ----------: |
| `control` | 119 |       43 |          9 |           2 |
| `strict`  | 102 |       36 |     **17** |      **13** |
| `shared`  | 124 |       32 |          9 |           3 |

A diagnostic pass counting turn-aways found the cause: **young** stalkers being
locked out. `dominanceOf` halves for immaturity, so a subadult scores below a
well-fed adult corvid, and the demo runs ~80 corvids to ~7 stalkers. Recruitment
failed and the population aged out — which is why the fix had to be a share
rather than a tuned threshold. With scraps, the death profile returns to the
control's almost exactly.

⚠ **Read the mean populations as noise, not result.** Per-seed stalker counts
move as much between arms as between seeds (control 10/0/4/10/11/…, shared
3/5/2/13/11/…), the same signature D14 and the crowding cap both describe. The
survival counts and the death-cause profile are the load-bearing numbers here.
The one directional change worth noting is **corvid mean 76.5 → 86.4**: a body
now has one full-rate eater instead of a crowd, so it lasts longer and more
scavengers get a turn at it.

Decay is a **pure function of elapsed time**, so the `updateInterval: 5` stagger
cannot drift it — asserted by a test comparing interval 1 against 5.

**Carcasses are the first things ever removed from the world**, which means a
parent or offspring reference can point at something that is gone. The engine
turned out to be _behaviourally_ null-tolerant already (parenting orphans a
juvenile whose guardian is missing; hunting abandons a vanished target;
reproduction skips a parent that is gone). What removal actually destroys is
**observability** of lineage.

So the policy is "be honest, with a memory": a bounded tombstone registry (256
entries, FIFO) makes a lineage reference resolve to one of four states —
`alive`, `carcass`, `dead` (gone, but we remember who it was and what killed it),
or `forgotten` (evicted). **`forgotten` is a stated limit, not a failed lookup.**

Tombstones are written at the engine's **single removal chokepoint**
(`applyDeferredEntityChanges`), so no removal path — including a command-driven
`entity.remove` — can bypass them.

⚠ The old "every parent reference resolves" assertions were rewritten to assert
the **resolution is accurate** instead: an id present in the world must never
report `dead`/`forgotten`, and one absent must never report `alive`/`carcass`.
Otherwise they would have started passing vacuously.

---

## 10. Shared mutation helpers, not systems

Things that happen at one _instant_ live in a module the owning system calls,
rather than in a scheduled pass that would have to hunt for work each tick:

| Helper                                                           | Module                   | Owner                                                                |
| ---------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `killAnimal`                                                     | `systems/death.js`       | metabolism, hydration, injury, disease, disturbance                  |
| `recordLifeEvent`                                                | `systems/lifeEvents.js`  | several                                                              |
| `recordMemory`, `forgetMemory`, `bestRemembered`, `isNearDanger` | `memory/memories.js`     | feeding, hydration, hunting, disturbance, decision                   |
| `applyInjury`, `totalSeverity`, `refreshImpairment`              | `injury/injuries.js`     | hunting, reproduction (fights), disturbance                          |
| `inheritGenome`, `expressGenome`, `sampleGenome`, `genotypeOf`   | `traits/genetics.js`     | reproduction                                                         |
| `mateQuality`, `acceptanceThreshold`, `bestMateCandidate`        | `mating/mateChoice.js`   | reproduction, decision                                               |
| `dominanceOf`, `isKin`, `resolveContest`                         | `social/dominance.js`    | reproduction, territory                                              |
| `infect`, `recover`, `clearImmunity`, `isSymptomatic`            | `disease/disease.js`     | disease, social                                                      |
| `beginDispersal`, `isDispersing`, `blendHeadings`                | `migration/migration.js` | parenting, decision                                                  |
| `isReproductivelyReady`                                          | `ReproductionSystem`     | reproduction **and** decision — so the eligibility rule cannot drift |

**Keeping the append and the bound in one place is what makes a cap
trustworthy** — no future writer can bypass it.

⚠ **A helper with a threshold silently discards sub-threshold input.**
`applyInjury` drops anything at or below `HEALED_BELOW` (0.02). A fire applying
0.006 per tick therefore recorded **no wounds at all** while still killing
animals — visible only because a diagnostic happened to print burn counts _and_
deaths-by-cause side by side. A per-tick rate is exactly the shape that trips
this. **Assert the effect landed, not that the call happened.**

---

## 11. Protocol reference

Everything a client sees carries `protocolVersion` (currently **28**) and is
built by `src/protocol/`.

### Commands

`simulation.pause`, `simulation.resume`, `simulation.setSpeed`,
`simulation.step`, `simulation.restart` (host-level, applied by the runner) and
`entity.spawn`, `entity.remove` (engine-level, queued and applied at the next
tick boundary). Results are structured `{ ok, ... }` or
`{ ok: false, error: { code, message } }`.

**`simulation.restart`** is the one command whose result cannot be a delta — the
new world shares no ids, no tick, and not even a `simulationId`, so every client
is sent a full snapshot. Its `seed` is optional: name one for a specific world,
or omit it and the **host** picks at random and reports back which it chose. The
host rolls that die because `src/simulation`, `src/protocol`, and the renderer
all ban unseeded randomness — a client that wants to replay a world simply names
the seed it was given.

It also takes optional **world-composition** fields — `width`, `height`, and the
per-role founder counts `herbivores`, `predators`, `scavengers` — each bounded in
`commands.js` (`MAX_WORLD_DIMENSION` and `MAX_FOUNDING_*`, set high enough to
reach the performance ceiling without an OOM or a non-terminating build). They
are additive and optional, so omitting them is the original behaviour and the
protocol version did not move. The runner never learns world _composition_: it
passes the options to the engine factory, and `buildDemoConfig` (in the demo
fixture) is the single place that maps a role to its species id and to a
`config.demo.founding` override.

### Snapshots

**Inspection vs. bulk snapshot** is a standing judgement: per-tick and cheap goes
in `PUBLIC_ENTITY_FIELDS`; everything else is inspection-only. Dense layers stay
out unless they earn it — but a bounded list of circles, or a short sparse list
gated on a rarely-moving revision, is not a layer. **Inspection returns copies.**

`PUBLIC_ENTITY_FIELDS`: `id, kind, speciesId, x, y, heading, age,
energyFraction, hydrationFraction, bodyMass, healthFraction, lifeStage, sex,
groupId, diseaseState, dispersing, action, alive, decayStage`.

Inspection-only (`GET /api/entities/:id`): absolute energy/hydration/health and
speed, the action target, the utility breakdown, the perception summary, the
individual's `traits` and `adultMass`, its `genome`/`genotype`/parent traits, its
bounded `memories`, its `injuries` and derived `impairment`, its `stamina` and
hunt target, carcass detail, the `mateChoice` block, the `social` block, the
`territory` block, the `disease` block (which spells out `infectious` separately
from `symptomatic` — they are not the same claim), the `migration` block (the
drift beside the live habitat reading it was computed from, so a bias is
checkable rather than mysterious), `caughtIn`, and the family/life-history block
(resolved `lineage`, parenting state, bounded `lifeEvents`).

Full snapshots also embed:

- **terrain** — `{ width, height, cellTypes, encoding: 'rle-row-major', runs }`,
  renderer-neutral cell codes plus a legend with authoritative passability.
- **vegetation** — quantized biomass levels `0..maxLevel`, RLE, with a
  `revision`.
- **disturbances** and **features** — see below.

Region-bounded snapshots are supported (`?minX=&minY=&maxX=&maxY=`).

### Deltas

`created` / `updated` (complete public entities) / `removed` (ids) plus the
domain events of the window. `applyDeltaSnapshot` is the reference application
algorithm.

- Deltas **never** carry terrain (it is static).
- Vegetation rides as a sparse `{ revision, changes: [[cellIndex, level]] }`
  list, gated by the revision so unchanged ticks cost nothing.
- **Disturbances** are carried **whole** rather than diffed, because there are
  never many. ⚠ An **empty** list is the message that everything has stopped, not
  the absence of one.
- **Features** ride as `{ revision, cells: [{ cellX, cellY, kind, wear }] }`,
  gated on a revision that moves only when a cell becomes or stops being a
  feature — so the layer costs a delta nothing on the overwhelming majority of
  ticks even though it is _written_ on all of them. Only cells deep enough to be
  something are projected; scuffed ground is internal.
- The **environment** block (a handful of scalars) is carried whole.

### Events

Facts with `{ seq, tick }`, never presentation instructions.

`entity.created` · `entity.moved` · `entity.died` (with a `cause`: `starvation`,
`dehydration`, `age`, `predation`, `injury`, `exposure`, `disease`,
`disturbance`) · `entity.removed` · `entity.fed` · `entity.mated` ·
`entity.courted` · `entity.born` · `entity.alarmed` · `entity.contested` ·
`entity.disputed` · `entity.defended` · `entity.hunted` · `entity.killed` ·
`entity.escaped` · `entity.injured` · `entity.recovered` · `entity.decayed` ·
`entity.provisioned` · `entity.migrated` · `entity.lifeEvent` ·
`entity.infected` · `entity.sickened` · `entity.cured` · `environment.changed` ·
`environment.disturbed` · `environment.settled` · `environment.feature`.

**Several events publish the number behind the verdict rather than hiding it** —
a discipline worth keeping: `entity.hunted` carries the capture `chance`,
`entity.courted` carries the `threshold` beside the `quality`, `entity.contested`
carries **both** dominance scores (because dominance decides it and there is no
roll to report), and `entity.disputed` adds how many cells actually changed
hands — the part an observer could not otherwise see. `entity.alarmed` carries
`hops` from whoever actually saw the predator, so a wave of panic is readable.
`environment.settled` carries `durationTicks` — how long it _actually_ lasted,
the one fact that is gone once the record is.

**Event volume is a real budget.** Emit on the **transition**, not on the state.
Nothing is emitted per tick while a disturbance runs — the region rides in every
snapshot instead — so a fire costs the event budget exactly two events for its
whole life.

When a transition genuinely happens often, the answer is on the **renderer**
side, not emitting less truth: its event feed has a filter per event type (off by
default for these) and retains them for only a few hundred events, against 20 000
for milestones. `entity.moved`, `entity.fed`, `entity.provisioned`,
`entity.alarmed`, and `environment.feature` are the five, and they were **99.2%
of 127 464 events over 1000 demo ticks** (2026-07-24).

_A worked example of the budget biting:_ emitting one `entity.courted` per
assessment produced ~1.7 events per tick (26k over 15k ticks), because a female
beside a male must reassess him every tick as her standard falls. Reporting only
a **new candidate or a changed verdict** cut it 20× to ~1.4k — and reads better:
"sized up #57, walked on", then later "sized up #57, accepted".

### Queries

Status reports, entity inspection, terrain (`GET /api/terrain`), population
metrics (`GET /api/metrics` — aggregates only, never per-organism histories), and
bounds parsing.

### Bounded everything, and bound it explicitly

Memories **8** · life events **12** · injuries **4** · tombstones **256** ·
metrics history **120** · mate candidates **6** · active disturbances **3** ·
tracked worn cells **8192** · persistent groups **64** (and members per group
**8**). Propagation is bounded by **hop counts**.

⚠ **Two of these bounds refuse rather than evict**, and the difference is
deliberate: tracked worn cells and persistent groups both decline to record
something new when full, because the alternative deletes live state. Tombstones
evict, because there the oldest entry is genuinely the least useful and
`forgotten` is a reportable answer.

---

## 12. Persistence

`captureSimulationState(engine)` produces a versioned, JSON-safe save
(`SAVE_FORMAT_VERSION`, currently **29**) with the tick, random stream states,
config, all entity state (including deferred queues), vegetation biomass, the
season/weather record, the territorial claim layer, the active disturbances, the
worn-ground feature layer, the tombstone registry, the persistent-group
registry, the bounded metrics history, the event outbox, pending commands, and
system descriptors.

`createEngineFromSave(saved, { registerSystems })` restores it; a restored
simulation continues **identically** to an uninterrupted one (tested).

**Derived state is not saved and is rebuilt on load:** the spatial grid, the
terrain layer (regenerated from the seed + `config.terrain`), per-entity
perception summaries, the shared neighbourhood buffer, and the metrics report
(recomputed on the next metrics tick — only its bounded history persists).

Two things are saved that look derived, each for a stated reason:

- **The held weather spell.** The season could be recomputed from the tick, but
  the spell could not without replaying every roll.
- **The migration drift.** Habitat evaluation is staggered, so a restore would
  otherwise run on a stale value until the next evaluation and diverge from an
  uninterrupted run.

⚠ **The two sociality mechanisms persist differently, and comparing them is the
clearest illustration of what "derived" means here.** A herd label is saved as a
bare number on the entity and would in fact rebuild itself from the animals'
positions within a few ticks of a load. A group *record* would not: nothing about
who belongs to which clan is recoverable from where anybody is standing, so the
registry is saved whole — including its `nextId`, since a counter that restarted
would reissue an id something still refers to (the same reason
`nextDisturbanceId` is saved).

Restoring verifies the save format version **and that the same systems are
registered**, so a changed system lineup cannot silently load an old save. The
version history — and which step invalidated which format — is documented in
`SimulationSerializer.js`.

### Change discipline

- Bump `PROTOCOL_VERSION` on any change to command/snapshot/delta/event/query
  shapes; keep additions renderer-neutral (codes, not glyphs).
- Bump `SAVE_FORMAT_VERSION` when persisted state changes; prefer
  regenerate-from-seed over storing derived grids; provide a migration or an
  explicit dev-save invalidation note — **never silently break saves**.
- Regenerate renderer fixtures whenever the protocol changes
  (`npm run fixtures:renderer`).
- Extend `PUBLIC_ENTITY_FIELDS`/inspection deliberately; never widen the
  projection to raw records.

Across 30 steps: **28 protocol bumps and 27 save-format bumps**, each with
fixtures regenerated and invalidation notes. No incompatibility incident. The
species work has since taken the save format to **29** (the group registry, then
carcass possession) with the protocol deliberately held at 28 — see A54 for what
that owes and when it is paid.

---

## 13. Performance

### Current baseline (measured 2026-07-21, Node v23.4.0, darwin arm64, seed 42)

| Scenario     | World     | Start→end entities |   ms/tick | ticks/sec |
| ------------ | --------- | -----------------: | --------: | --------: |
| demo-default | 128×128   |            138→188 |     1.008 |      ~992 |
| small-100    | 256×256   |            115→150 |     0.671 |    ~1,491 |
| medium-1k    | 512×512   |          1147→1556 |     9.230 |      ~108 |
| large-5k     | 1024×1024 |          5733→7744 | **68.75** |       ~15 |

Every scenario sits far under the one-second authoritative tick budget.
`npm run benchmark` doubles as a determinism check (two identical 2000-tick runs
must serialize byte-for-byte).

### Where the time goes (large-5k, 2026-07-21)

| System                       | ms/tick |
| ---------------------------- | ------: |
| `PerceptionSystem`           |   27.73 |
| `DecisionSystem`             |    7.53 |
| `SocialSystem`               |    5.03 |
| `MovementSystem`             |    2.93 |
| all nineteen others combined |    5.29 |

`SpatialGrid.queryRadius` is the second-hottest _function_ at 7.3 ms/tick self
time. Every system other than the four above is under 1 ms/tick and always has
been — "everything added since perception is O(1) per animal" held up under
measurement.

### Targets

- **Early (Milestones A–B):** 10–100 animals, tick well under 1 s. **Met.**
- **Mid (C–D):** hundreds→low-thousands, typical tick ~250–500 ms. **Met** with
  large margin.
- **Mature:** several thousand→~25 000 behaviourally complex animals, typical
  tick < ~500–700 ms. **Not reached** — see §1.5.

### ⚠ Before optimizing anything, re-baseline

`86.59 ms/tick` was a fresh reading of _unchanged_ code taken the same day the
optimization work started; the figure the handoff had been carrying was `~81`.
**Measurements do not keep.**

⚠ **They do not even keep within a day.** The same unmodified HEAD measured
68.70 / 69.18 / 70.64 / 72.09 ms/tick across one afternoon on 2026-07-28, and
**76.21 / 78.94 that evening** — a ~10% shift with no code change at all. So a
single "before" number is not a baseline; the working rule is to **interleave**
readings of HEAD and the change in the same session and compare the two
*distributions*. `git stash push -u` → benchmark → `git stash pop` is the cheap
way to do it. Two single readings a few percent apart are not a result; HEAD at
69.2–72.1 against a tree at 78.2–79.4 is one, because they do not overlap. (The
drift continued: the same HEAD read **83.9–84.6** later that same evening.)

⚠ **And a third arm is often worth more than a fourth pair.** Phase 4 touched
`#perceive` — the function D28 charged 12% for — *and* added real per-tick work
elsewhere, so a bare before/after could not have said which was which.
Benchmarking the tree with the new mechanism **switched off** settled it: 84.73
against HEAD's 83.94–84.55 with identical entity counts, so the hot-loop edit was
free and the ~1% belonged to the mechanism. When a change has two candidate
costs, measure the arm that isolates them.

### ⚠ A ~1% whole-simulation timing difference is noise, not a result

Run-to-run spread at large-5k is **±10%**. `SpeciesRegistry.hunts` was
"optimized" with a precomputed `Set` — obviously right for the busiest predicate
in the engine, asked twice per neighbour per animal per tick. Two whole-sim runs
read it ~1% faster; two more read it slower. A direct microbenchmark of the
predicate settled it: the `Set` is **35% slower** at 20M calls, because the
rosters are one or zero entries long and hashing a string costs more than
scanning an array of one. Reverted, with the measurement recorded at the call
site.

**Benchmark the thing you changed, at a volume where it dominates.** And treat
"obviously faster data structure" as a hypothesis: constant factors decide
small-N cases, and this codebase's rosters are small by design.

### What the optimization pass did, and what it deliberately did not

The 2026-07-21 pass took large-5k from **86.59 → 68.75 ms/tick (−20.6%)** with
the simulation bit-for-bit unchanged (identical entity counts, byte-identical
saves across six seeds, byte-identical renderer fixtures).

**Applied:**

1. The **second neighbour walk removed** (15.30 → 5.03 ms/tick) — see §9,
   Perception.
2. The **perception cell scan made cheaper per cell** (38.48 → 27.73): row
   x-spans computed from the circle rather than testing a bounding box (the
   corners are ~21% of a square, and the exact distance guard is _kept_ so
   boundary cells are still decided by the same comparison); terrain read once
   per cell with passability derived from the code; the "nearer than the best so
   far" test moved ahead of the grid reads it guards; the best-so-far held in
   plain numbers so the loop allocates nothing.
3. **Spatial grid** — packed integer bucket keys instead of `"x:y"` template
   strings, and positions stored in the buckets so a candidate costs no second
   hash lookup.

**Rejected, and the rejections matter as much:**

- **Ring-search early exit**, a named candidate since perception landed.
  Scanning cells in rings and stopping once the answer cannot improve is exact
  only if ring order matches distance order — and it does not, because rings are
  ordered by _cell offset_ while the answer is the nearest cell to the animal's
  **continuous** position. It would change which cell wins. Worse, it would
  almost never fire: the scan hunts four things at once, and water, rock, and
  cover are absent from most animals' radius entirely.
- ⚠ **`Math.hypot` → `Math.sqrt(dx*dx + dy*dy)`.** `hypot` is several times
  slower in V8 and sits in both hot loops. It is also _more accurate_, so the two
  disagree in the last ulp — and a one-ulp change to every distance in the world
  is a **simulation** change on a demo that is a knife edge. Declined. If a later
  step wants it, it needs a ten-seed measurement and a new baseline, not a
  benchmark.

### Historical per-step measurements (large-5k, ms/tick)

Each figure is as of the step that took it; the world changed underneath them.

|   Step |   ms/tick | Note                                                                     |
| -----: | --------: | ------------------------------------------------------------------------ |
|      1 |      1.63 | after fixing an O(n)-per-emit event-buffer trim (**58.65 → 1.63, ~36×**) |
|      2 |      1.52 | terrain; generation is one-time at init                                  |
|      3 |      1.81 | vegetation regrowth, staggered every 5 ticks                             |
|      4 |      1.79 | herbivore species; four extra scalars are free                           |
|      5 |      1.72 | terrain-aware locomotion                                                 |
|      6 |      1.81 | metabolism                                                               |
|  **7** |  **14.0** | **perception — became the dominant cost immediately**                    |
|      8 |      18.3 | utility decisions                                                        |
|      9 |      20.2 | herbivory                                                                |
|     10 |      20.9 | hydration                                                                |
|     11 |     ~20.9 | aging                                                                    |
|     12 |      35.3 | reproduction — the rise is the population _growing_ during the run       |
|     13 |      33.4 | parenting                                                                |
|     14 |     33.97 | individual traits                                                        |
|     15 |     37.18 | memory                                                                   |
|     16 |     40.13 | predation, now with 333 predators among 5000 prey                        |
|     17 |     42.66 | injury                                                                   |
|     18 |     42.57 | carcass decay — removal _shrinks_ what every system iterates             |
|     19 |     46.11 | weather                                                                  |
|     20 |     41.34 | genetics (no per-tick work; run-to-run noise)                            |
|     21 |     41.42 | metrics                                                                  |
|     22 |     46.06 | mate choice                                                              |
| **23** | **72.01** | **sociality — a second `queryRadius` per animal per tick**               |
|     24 |     74.33 | territory                                                                |
|     25 |     79.78 | disease                                                                  |
|     26 |     79.19 | migration                                                                |
|     27 |     ~80.1 | disturbances                                                             |
|     28 |      80.6 | engineering                                                              |
|     29 |     80.97 | species schema, while carrying ~7% more entities                         |
| **30** | **68.75** | **optimization (from a same-day re-baseline of 86.59)**                  |

### Standing performance discipline

- Record Node version and platform alongside numbers — they dominate absolute
  timings.
- When a step adds a per-entity system, expect ms/tick to rise; keep medium-1k
  under a few ms/tick and large-5k comfortably under the 1 s budget.
- If a change regresses large-5k by more than ~2× without a matching feature
  reason, treat it as a hot-path regression and profile before proceeding.
- Timings are machine-dependent, so tests never assert absolute times. Only the
  amortized event-bus test uses a deliberately generous bound.

---

## 14. Testing

796 tests, 202 suites. Layers:

- **Unit** — energy/metabolism math, utility scoring, inheritance,
  movement/terrain validation, spatial queries, world projection, protocol
  validation.
- **System** — one system against controlled state.
- **Integration** — movement↔spatial index, perception↔decision,
  feeding↔physiology, reproduction↔genetics, predation↔injury,
  weather↔vegetation, snapshot↔renderer-store delta application.
- **Deterministic scenarios** — seeded worlds with stable, qualitative
  assertions.
- **Performance** — benchmarks report; they do not gate.

### Permanent invariant tests

Living entities in bounds · impassable cells never illegally occupied · dead
entities do not act · positions match the spatial index · energy has defined
sources and costs · ids stable · **lineage references resolve to an accurate
status** · expressed traits always equal what the genome expresses (nothing
writes traits post-birth) · observation never perturbs the population · commands
apply at deterministic boundaries · save/load continuation matches uninterrupted
runs · renderer imports nothing internal · no species-name literals in core
systems.

### The demonstration scenarios

Small seeded worlds with **qualitative** assertions. Never assert exact final
populations for stochastic runs.

| #   | Scenario                     | Expected behaviour                                        | Stable assertions                                                        |
| --- | ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0   | Baseline determinism         | demo world runs identically                               | two runs byte-identical                                                  |
| 1   | Terrain sandbox              | water + rock present, rock impassable                     | cell-type counts; blocked cells                                          |
| 2   | Movement sandbox             | one animal navigates around obstacles                     | never enters blocked cells; stable pos@N                                 |
| 3   | Foraging sandbox             | herbivore finds and eats a patch                          | energy rises; biomass drops                                              |
| 4   | Starvation sandbox           | predictable energy decline → death                        | exact death tick; carcass created                                        |
| 5   | Resource-competition sandbox | several herbivores, limited food                          | some survive, some starve (no balance)                                   |
| 6   | Life-cycle sandbox           | accelerated grow/mate/birth/age/death                     | lineage completes; refs valid                                            |
| 7   | Predation sandbox            | pursuit, escape, failed + successful hunts                | ≥1 fail + ≥1 capture; carcass fed                                        |
| 8   | Inheritance sandbox          | short generations; kids resemble parents                  | parent-offspring trait correlation                                       |
| 9   | Selection sandbox            | a pressure shifts a trait distribution                    | ⚠ **claims no direction** — see A31 (§1.1)                               |
| 10  | Disturbance sandbox          | local event → displacement → recovery                     | bounded effect; recovery by tick N against an in-world control           |
| 11  | Sexual-selection sandbox     | females prefer size; the trait rises                      | rises **more** than a choice-off control; S positive among males only    |
| 12  | Herd sandbox                 | a herd holds together; a threat alarms the near side only | tighter than a herding-off control; far side never alarmed               |
| 13  | Residency sandbox            | a resident settles a range; a neighbour leaves its ground | closer to home than a pull-off control; neighbour leaves 5/5             |
| 14  | Outbreak sandbox             | one case in a dense group becomes an epidemic             | spreads past patient zero, peaks, burns out; an isolate never catches it |
| —   | Gradient sandbox             | forage due east bends wander headings                     | mean cos(heading) > control                                              |
| —   | Worn-path sandbox            | a trail due east bends wander headings                    | mean cos(heading) > trail-free control                                   |
| —   | Shared-walk equivalence      | the two neighbour paths agree                             | 400 demo ticks byte-identical                                            |
| —   | Clan sandbox                 | an invented group-forming species founds, joins, separates, and dissolves | membership outlives a separation the herd label does not; a clan-forming world and a control are identical animal for animal |
| —   | Carcass-possession sandbox   | two carnivores, one body: the holder eats, the weaker waits, the stronger takes it | the weaker gains no energy while the claim stands; a clanmate does; the disabled control is the exact id-ordered queue |

**Scenario 11 is the pattern to copy** whenever a step adds a _second_ force
acting on something already being measured: run the same seeded world with the
new mechanism on and off, and assert the difference between them. "The trait
rose" proves nothing when the trait also drifts on its own; "it rose further than
the control did" isolates the mechanism.

Every mechanism from migration onward ships an `enabled` switch, so the control
is reproducible rather than hand-assembled.

---

## 15. Engineering conventions

These are load-bearing and cost real time to rediscover.

**Derive rather than store, where you can.** Dominance, disease severity, the
`dispersing` flag, and every disturbance effect are computed on read. ⚠ The one
deliberate exception is the per-cell `feature` flag: with a **hysteresis band**
the state genuinely depends on history, which a derived value cannot express.

**Shared mutation helpers, not systems** — see §10.

**All action selection lives in `DecisionSystem`.** Other systems _resolve_ the
chosen action. This is why `followParent`, `flee`, `stalk`, `chase`, `herd`,
`defend`, `patrol`, and `retreat` are all decision actions rather than each
system building a second action-selection path.

**Effects belong at existing chokepoints** — see §7.

**Fixed RNG draw budgets** — see §4.

**Bounded everything, and bound it explicitly** — see §11.

**Inspection vs. bulk snapshot** — see §11.

**Event volume is a real budget** — see §11.

⚠ **Five seeds cannot resolve a one-seed difference.** The demo is a knife edge.
Use **ten**, and treat a **non-monotonic sweep as proof you are tuning noise** —
that signature has now appeared three times.

**Before asserting an outcome, ask what the control would score.** If the control
scores the same, the test measures the world and not the change. Prefer asserting
the _mechanism_ over the outcome it accumulates into.

**Assert invariants, not population outcomes.**

**Treat any step that changes an energy source, a mortality source, or a food
ceiling as requiring a fresh multi-seed sweep** — and record the numbers in the
config comment so the next person need not re-derive them.

---

## 16. Failure patterns worth remembering

Every one of these cost real time. They are recorded as patterns, not anecdotes.

| #     | What happened                                                                                                                                                                                                                                                     | The lesson                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1    | The determinism assertion had to be rewritten **four times** as biology landed (all survive → all carcasses → `entityCount === N` → `>= N`)                                                                                                                       | Assert invariants that survive biology changes, not population outcomes                                                                                                                                                      |
| D2    | `seekWater` is seed-dependent (seed 42 shows none in 3000 ticks; seed 7 does)                                                                                                                                                                                     | Prefer controlled scenarios over demo-behaviour assertions; pin the seed and say why                                                                                                                                         |
| D3    | Vegetation biomass is a `Float32Array`, so measured deltas carry ~1e-6 error                                                                                                                                                                                      | Use float32-appropriate tolerances (1e-5), not 1e-9                                                                                                                                                                          |
| D5    | The first "siblings differ" test bred **homozygous** parents, where recombination is invisible and the assertion was vacuous                                                                                                                                      | When testing a mechanism, first ask what setup would make it _unobservable_ — and make sure the fixture is not that                                                                                                          |
| D6    | A boundary scan rejected a file for the word "window." inside a doc comment                                                                                                                                                                                       | Source scans must strip comments: a guard that fires on prose teaches people to word around it rather than trust it                                                                                                          |
| D7    | A selection sandbox broke, and the cause was **not** the new step: breaking deaths down by cause showed they were entirely age deaths, so the intended pressure had never really been applied and the assertion had been passing on drift, pinned to a lucky seed | When a seeded assertion breaks, ask what the fixture is _actually_ measuring before re-pinning the seed. Check the mechanism, then re-verify on seeds it was never tuned against                                             |
| D8    | A "condition keeps the display honest" assertion over-claimed: at `conditionWeight` 0.4 a large display genuinely does outweigh poor condition                                                                                                                    | When an assertion about a model fails, decide whether the _model_ or the _assertion_ is wrong — then pin the real behaviour in **both** directions so a future retune is caught in a unit test rather than a five-seed sweep |
| D9    | A bare `case 'herd'` added to a shared `switch` fallthrough chain silently redirected `seekFood`/`seekMate`/`followParent` into it, producing a `NaN` heading — so animals **chose the right action and stood perfectly still**                                   | A bare `case` added to a fallthrough group is a silent behaviour change, not an addition. And `JSON.stringify(NaN)` prints `null`, which sends you hunting a null-assignment bug that does not exist                         |
| D10   | Both group formation and alarm were unbounded local mechanisms, and both went global                                                                                                                                                                              | A local mechanism needs an **explicit** bound — a hop count from the source. Population density is not a bound                                                                                                               |
| D11   | `intrusionThreshold` was set equal to `markStrength`, so freshly marked ground sat exactly at the "occupied" threshold and decayed below it immediately — avoidance never fired at all                                                                            | When one parameter is a threshold **on** another, write the relationship down beside them. Equal values are the failure case, not the neutral one                                                                            |
| D12   | Two tests assumed a resident still held the cell it was spawned on. It does not — it moves. A third asserted a stochastic comparison across two runs whose trajectories diverge from tick one                                                                     | Ask the world what is true instead of assuming the setup held; assert mechanisms, not outcomes compared across diverging runs                                                                                                |
| D13   | A test measured event **retention** rather than emission: it stepped 3000 ticks at once and then asked `eventsSince`, so the bounded outbox had long since trimmed everything but the tail                                                                        | Collect events tick by tick when counting them                                                                                                                                                                               |
| D14   | A step measured **3/5 seeds** against a 4/5 control and would have been ramped down for it. Bisecting gave 1/5, 2/5, 3/5, 3/5 — **non-monotonic**, which is the tell. At **ten** seeds both read 4/10                                                             | **Five seeds cannot resolve a one-seed difference.** When a sweep disagrees with a control by one seed, add seeds before touching a parameter — and treat a non-monotonic bisection as evidence you are tuning noise         |
| D15   | An end-to-end test was written twice and was bad both times: first measuring diffusion across a small box (the control arrived just as fast), then measuring a ~1-unit displacement against a mechanism deliberately built to be gentle                           | Before asserting an outcome, ask what the **control** would score. Prefer asserting the mechanism over the outcome it accumulates into                                                                                       |
| D16   | A "at zero strength nothing changes" guarantee was false by one ulp: `normalizeAngle(1.2)` is `1.2000000000000002`, compounding over 15 000 ticks                                                                                                                 | An identity path must be **exactly** the identity. If a feature's safety argument is "at zero it does nothing", assert `===` on the untouched input                                                                          |
| ⚠ D17 | A fire recorded **no injuries at all** while still killing animals: `injuryPerTick` was 0.006 and `applyInjury` silently discards anything at or below `HEALED_BELOW` (0.02)                                                                                      | A shared helper with a **threshold** silently discards sub-threshold input, and a per-tick rate is exactly the shape that trips it. Check the floor; assert the effect landed                                                |
| D18   | First parameters left a disturbance running **91% of ticks** — not a disturbance regime but a climate. Worse, nothing ever finished recovering, so "recovery" could not be observed                                                                               | For a mechanism whose visible result is _recovery_, the quiet interval is part of the design. Tune the duty cycle before the severity, and sanity-check "what fraction of the time is this running?"                         |
| ⚠ D19 | A system ran in the phase its spec named (`environment`) and wore **nothing at all** for 15 000 ticks, because `lastMoveDistance` is consumed and zeroed in `physiology`. Burrows, which read `action`, worked perfectly throughout                               | A **half**-working feature hides much better than a broken one. When one of two similar paths produces nothing, suspect the input before the parameters                                                                      |
| D20   | Cells flapped across a feature threshold: 9569 trails formed and 9081 lost in one run                                                                                                                                                                             | Any threshold a continuously-varying value crosses needs a **hysteresis band**, not a single number                                                                                                                          |
| D21   | Widening that band gave 0.66 / 0.76 / 0.58 events per tick at 0.7 / 0.5 / 0.3 — non-monotonic, i.e. noise. The residual churn was animals genuinely using and abandoning ground                                                                                   | Two distinct causes can produce the same symptom. When a sweep comes back non-monotonic, stop tuning and ask what is actually generating the number                                                                          |
| ⚠ D22 | A three-species sweep read 3/10 against a 6/10 control, and the cause was **not** the new species: `fleshIntakeRate` was flat, so a 4 kg scavenger stripped a carcass as fast as a 45 kg predator                                                                 | A shared constant that is _correct for one size_ is a latent bug that only a second size can expose                                                                                                                          |
| D23   | A refactor broke **23 tests**, almost all the same way: they constructed a system with custom parameters and expected those to apply, but a species' resolved block now beats anything a system was constructed with                                              | When a parameter's **source** moves, every caller that supplied it the old way keeps working syntactically and stops working semantically. That is worse than a break                                                        |
| ⚠ D24 | `hunts` was "optimized" with a precomputed `Set`; two whole-sim runs read ~1% faster, two read slower. A microbenchmark showed the `Set` is **35% slower** — the rosters are one entry long                                                                       | Whole-system timings here cannot resolve ~1% (spread is ±10%). Benchmark the _thing you changed_, at a volume where it dominates. "Obviously faster data structure" is a hypothesis                                          |
| ⚠ D25 | Three source scans shared one comment-stripping line that read `/*` **inside a `//` comment** as opening a block comment. `defaultSimulationConfig.js` has exactly that (`config/species/*` in a line comment), so the regex swallowed 600 lines including the whole `demo.founding` roster — the one place ids appear. The species invariant was unenforced for months and every test passed | A guard can go blind **silently**, and a passing test is not evidence it is looking. Comments are not a regular language: strip them with a scanner, not two regexes. ⚠ Correcting it immediately exposed a real violation the blind version had been hiding — so the pass rate had been measuring the scan's blindness, not the code |
| D26   | The replacement scanner had a bug of its own: it left template-literal mode at `${` and never returned, so everything after a substitution was read as code. In a file of HTML templates the next `"` opened a bogus string and the scanner desynced — surfacing as `Controls.js` failing for a `Math.random` that appears only inside a comment saying it is banned | A hand-written scanner needs its own tests before it is trusted to police anything else. This one failed loudly by luck; it could as easily have gone blind in the other direction |
| ⚠ D27 | Mass-scaling herbivore intake was written up as "inert — the grazer sits exactly at `referenceMass`, so its factor is 1". It is not: the system reads the **individual's** `bodyMass`, which is `adultMass × size trait` walked up a growth curve. Seed 42's cohort measured 5.1–33.7 kg, factors 0.265–1.092 — a half-grown animal's intake fell ~40% | **A species-level constant is not an entity-level one.** To decide whether a change is inert, check the value the code actually reads, on real entities — not the config it resolves from. The claim was written before it was measured, which is the entire error |
| ⚠ D28 | Making `foodMinLevel` per-species meant resolving it beside `radius` and passing both into `PerceptionSystem#perceive` — a four-argument call instead of three. That cost **12% of total engine time** at large-5k (66.1 → 70.7 ms/tick). An A/B pinned it on the **arity alone**: keeping the fourth parameter but passing the old global value was just as slow (70.4), while returning to three arguments was 62.8. Passing the resolved block as one object restored it | **The hottest function in the engine is arity-sensitive, and nothing about the diff looks expensive.** `#perceive` is ~53% of a tick and holds the (2r+1)² cell scan; one more parameter is enough to change what the optimiser does with it. Prefer handing a hot helper one object over widening its signature — and ⚠ note the whole-system profiler *hid* this: wrapping prototypes to time each system showed only +0.8%, because the wrapper overhead perturbed exactly the inlining under test |
| D30   | Carcass possession shipped behind `possessionEnabled` so it had a reproducible control — but with the switch **off** the feeding system still stamped `possessorId` on every body it fed from. Behaviour was identical, so nothing failed; the control world simply was not the old world, it was the old world plus a field, and every "identical to before" comparison taken against it would have been quietly false. Caught only because a test asserted the control claims *nothing*, not merely that it behaves the same | **An off switch must leave no trace, not merely no effect.** D16 says an identity path has to be *exactly* the identity; this is the same rule applied to state rather than to arithmetic. When adding a control arm, assert what it *writes*, not only what it does — and put the guard on the write, not on the read, because a field nothing reads today is still a field in the save |
| D29   | A test spawned two animals, asserted they formed a herd, and got `null`. `social.minGroupSize: 2` is compared against **groupmates** — how many *others* are in range — so it means "three animals", and the comment beside it ("a lone animal is not a herd of one") reads as though it means "two". Two test iterations to notice                                                                     | **A threshold named for an aggregate is often counted on a part.** When a parameter's name describes one quantity (group *size*) and the code compares it against another (neighbour *count*), the off-by-one is invisible in both the name and the comment. State which quantity beside the number, not just what it is for — the same discipline D11 asks for a threshold defined on another parameter |
| D4    | Twelve completed steps still read `Status: Not started` until a review caught it                                                                                                                                                                                  | Update the status line, not just the checkboxes                                                                                                                                                                              |

---

## 17. Risk register

Predicted risks, with what actually happened over 30 steps.

| Risk                                     | Predicted       | Observed                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Population explosion or extinction**   | High / Medium   | **Yes — five times**                             | Reproduction grew 8 → 1037 by tick 20 000 with food never limiting; re-tuned to costly reproduction rather than a cap. Inverse also seen: without reproduction the demo went extinct by ~9000. Predation is a genuine knife edge (3 founding predators die out in 2/5 seeds, 7 wipe the prey out in 3/5, 4 sustains both). Territory was the most destructive and had to be **bisected** rather than tuned — the culprit was `patrol` competing with wandering. Disease cost one seed until the _sublethal_ cost was tuned down |
| **Unstable parameter tuning**            | High / Medium   | **Yes — now the expectation, not the exception** | Three consecutive steps each invalidated the previous step's balance. Predation tuning silently depended on a **defect** (carcasses accumulating as a free larder); fixing it collapsed the ecology; seasons collapsed it again. Treat any step touching an energy source, a mortality source, or a food ceiling as _requiring_ a fresh multi-seed sweep                                                                                                                                                                        |
| **Tick-budget overruns**                 | Medium / High   | **Yes — contained**                              | An O(n)-per-emit event-buffer trim (58.7 → 1.6 ms/tick after fix). Perception took large-5k 1.8 → 14.0. Sociality took 46 → 72. Optimization brought 86.6 → 68.8. Always far under the 1 s budget                                                                                                                                                                                                                                                                                                                               |
| **Tests overfitting stochastic results** | Medium / Medium | **Yes**                                          | See D1, D2, D7. One assertion rewritten four times; a demo assertion deliberately _weakened_ back to a behavioural one after tuning made the outcome unstable                                                                                                                                                                                                                                                                                                                                                                   |
| **Unbounded memory/event growth**        | Medium / High   | **Partly**                                       | Event _volume_ is high (C3) but bounded by the buffer; no unbounded growth observed. Every growable per-entity structure is hard-capped in its insert helper so no future writer can bypass it                                                                                                                                                                                                                                                                                                                                  |
| **Determinism regressions**              | Medium / High   | **No**                                           | Byte-identical seeded runs asserted every step; never broken                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Engine–renderer coupling**             | Low / High      | **No**                                           | Boundary tests have held since the renderer was built                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Protocol/save incompatibility**        | Medium / Medium | **No — by discipline**                           | 28 protocol and 27 save-format bumps, each with fixtures regenerated and invalidation notes                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Quadratic neighbour searches**         | Medium / High   | **No**                                           | All neighbour work goes through `SpatialGrid.queryRadius`, and there is now exactly one walk per tick                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **AI-generated duplication**             | Medium / Medium | **No — actively countered**                      | Shared helpers extracted instead of duplicated (§10). New behaviours went into the decision system rather than building a second action-selection path                                                                                                                                                                                                                                                                                                                                                                          |
| **Over-generalized abstractions**        | Medium / Medium | **No**                                           | Species config stayed single-species until the mechanics were proven; no trait was admitted that no system reads                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Renderer fixtures drifting**           | Medium / Medium | **No**                                           | Regenerated on every protocol change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 18. Project history

The engine was grown in 30 numbered steps, each leaving the app runnable,
testable, and visibly improved. This table is the index; the design reasoning
from each is folded into §7–§13 above, and the full dated completion notes live
in `PLAN.md`.

|   # | Step                 | What it added                                                               | Protocol | Save | Tests |
| --: | -------------------- | --------------------------------------------------------------------------- | :------: | :--: | ----: |
|   1 | Audit + baseline     | Verified invariants 1–20; fixed an O(n)-per-emit event trim; `BENCHMARK.md` |    —     |  —   |    81 |
|   2 | Terrain              | Seeded static cell layer; RLE projection                                    |    v2    |  v2  |    96 |
|   3 | Vegetation           | Cell biomass field with logistic regrowth, replacing plant entities         |    v3    |  v3  |   111 |
|   4 | First herbivore      | Species-config seam; `herbivore.grazer`                                     |    v4    |  v4  |   118 |
|   5 | Locomotion           | Terrain-aware movement with committed intent                                |    —     |  v5  |   127 |
|   6 | Metabolism           | Mass-scaled bioenergetics; starvation → carcass                             |    v5    |  v6  |   137 |
|   7 | Perception           | Bounded local sense via the spatial grid                                    |    v6    |  —   |   146 |
|   8 | Decisions            | Utility-based action selection; movement became an executor                 |    v7    |  v7  |   154 |
|   9 | Herbivory            | Feeding, depletion, deterministic contention                                |    v8    |  —   |   163 |
|  10 | Hydration            | A second, spatially distinct need; shared `killAnimal`                      |    v9    |  v8  |   171 |
|  11 | Aging                | Life stages, growth curve, death of old age                                 |   v10    |  v9  |   182 |
|  12 | Reproduction         | Energy-gated mating, gestation, parent linkage                              |   v11    | v10  |   193 |
|  13 | Parenting            | Real juvenile dependency, weaning, dispersal, life events                   |   v12    | v11  |   211 |
|  14 | Individual variation | Seven non-inherited trait multipliers, each with a consumer                 |   v13    | v12  |   229 |
|  15 | Memory               | Bounded decaying places; `recallFood` / `recallWater`                       |   v14    | v13  |   248 |
|  16 | Predation            | `predator.stalker`; the full hunt pipeline; stamina                         |   v15    | v14  |   272 |
|  17 | Injury               | Nonfatal wounds, cached impairment, energy-gated healing                    |   v16    | v15  |   294 |
|  18 | Carcasses            | Decay stages, nutrient return, the tombstone registry                       |   v17    | v16  |   312 |
|  19 | Weather              | Seasons, weather spells, thermoregulation, shelter                          |   v18    | v17  |   331 |
|  20 | Genetics             | Diploid genome, recombination, mutation, **tradeoffs**                      |   v19    | v18  |   354 |
|  21 | Metrics              | Trait distributions, generations, selection differentials                   |   v20    | v19  |   369 |
|  22 | Mate choice          | Sexes; species-data preference; heritable choosiness                        |   v21    | v20  |   406 |
|  23 | Sociality            | Herd labels, hop-bounded alarm, derived dominance, contests                 |   v22    | v21  |   448 |
|  24 | Territory            | Home ranges as four numbers; a claim layer on the ground                    |   v23    | v22  |   480 |
|  25 | Disease              | Compartments; infectious-before-symptomatic; waning immunity                |   v24    | v23  |   507 |
|  26 | Migration            | A bias on the wander heading; dispersal clears the natal range              |   v25    | v24  |   535 |
|  27 | Disturbances         | Fire/flood/storm as records whose effects are derived on read               |   v26    | v25  |   561 |
|  28 | Engineering          | Trails and burrows as wear, with a hysteresis band                          |   v27    | v26  |   590 |
|  29 | Species schema       | Eight overridable blocks; the corvid as a config-only species               |    —     | v27  |   609 |
|  30 | Optimization         | One neighbour walk; a cheaper cell scan (**−20.6%**)                        |    —     |  —   |   662 |

### Milestones

- **A — Visible biome** (2–4): terrain, vegetation, and a real herbivore visible
  and inspectable from protocol data. **Met.**
- **B — Self-sustaining herbivore loop** (5–10): move → perceive → decide → eat →
  gain → spend → live or die, with no hard-coded balance. **Met at Step 9**;
  hydration added the second need.
- **C — Complete herbivore life cycle** (11–15): lineages persist across
  generations without scripted rates. **Met.**
- **D — Predator-prey biome** (16–19): predator-prey dynamics emerge and persist.
  **Met.**
- **E — Heredity and evolution** (20–22): trait change across generations is
  observable and emergent. **Met**, with the caveat of A31.
- **F — Social and environmental depth** (23–29, with 30 spanning all): a
  multi-species world showing social and environmental dynamics that stays
  runnable and demonstrable. **Met**; the ~25k-animal performance target is not
  (§1.5).

### What the demo actually does

_Measured 2026-07-20, 15k ticks, ten seeds, all three species present:_ roughly
**8–75 grazers against 0–2 stalkers**, with both still alive in **5 of 10** seeds
and all three species coexisting in **4**. Nothing enforces any of that — it
emerges from encounter rates, capture odds, lifespan, and competition for
carrion. **The honest reading is that predators go extinct about half the time.**

That figure is measured on **ten** seeds for a reason (see D14).

---

## 19. Configuration map

Layers are kept separate:

- **Engine constants** — tick math, the phase list.
- **World configuration** — dimensions, seed, terrain params.
- **Scenario definitions** — `config.demo.founding`, a roster of
  `{ speciesId, count }` walked in order.
- **Species definitions** — biology only.
- **Behavior parameters** — utilities, thresholds.
- **Genetics** — trait ranges, mutation rates.
- **Renderer appearance mappings** — glyphs, colors, renderer-owned only.

⚠ Species definitions may hold biological parameters but **must not** contain
ASCII glyphs, Dracula colors, or presentation-only UI labels.

`config` sections in `defaultSimulationConfig.js`: `world`, `time`, `terrain`,
`vegetation`, `events`, `metabolism`, `perception`, `reproduction`, `territory`,
`engineering`, `disturbance`, `migration`, `disease`, `social`, `groups`,
`environment`, `carcass`, `lineage`, `injury`, `hunting`, `locomotion`,
`memory`, `metrics`, `genetics`, `traits`, `parenting`, `aging`, `hydration`,
`feeding`, `behavior`, `decision`, `predation`,
`demo`.

**Twelve** of these (`metabolism`, `hydration`, `aging`, `perception`, `traits`,
`genetics`, `disease`, `reproduction`, and — from 2026-07-28 — `feeding`,
`hunting`, `behavior`, and `predation`) double as **species-block defaults** —
see §8.

⚠ **`behavior` and `decision` are one mechanism split in two**, both read by
`DecisionSystem`: `behavior` is what an animal wants (per-species), `decision`
is the machinery of choosing (global). See §9 Decision.

⚠ **`social` and `groups` are two mechanisms that sound like one**, and reading
either as the other will waste an afternoon. `social` is the herd *label* —
positional, recomputed every tick, owned by `SocialSystem`. `groups` is the
persistent group *record* — an identity that survives separation, owned by
`GroupSystem`. See §9 Sociality, which opens with the design decision this
overrode.

⚠ **`groups`, `migration`, and `territory` are the three sections that are
half-global and half-per-species**, and none of them is a species block. Each
has a same-named field on the species record holding that animal's biology
(`groups.forms`, `migration.tracksForage`, `territory.defends`), while the config
section holds world-level machinery — for `groups` that is `enabled`,
`updateInterval`, and the store bound `maxGroups`. They are not blocks precisely
*because* of that mixture: a species inheriting `maxGroups` would be inheriting a
knob on a store it does not own.

⚠ **A value must have exactly one home.** Three constants were restated in a second
section with a comment saying they matched the first, which is the D11 shape
("when one parameter is a threshold on another, write the relationship down
beside them; equal values are the failure case, not the neutral one"):

- `drinkRange` lived in both `hydration` and `decision`. It now lives only in
  `hydration`, and the decision system reads it from there — so a species that
  changes its reach to water changes both halves at once, instead of deciding it
  is at water and then being refused the drink.
- `carcassRange` lived in both `feeding` and `decision`, with the same
  "(matches feeding)" comment. It now lives only in `feeding`. Drifted, a
  carnivore decides it is on a carcass and then cannot reach it.
- `foodMinLevel` lives in `perception` and was **declared per-species but read
  from two constructors**, so no species could actually differ in what counted as
  food. Both perception and decision now read the species' own value, which
  matters because they must agree: otherwise an animal walks to a cell its senses
  called food and then declines to eat it.

---

## 20. Extending the system

### Adding a simulation system

1. Create a class extending `SimulationSystem` (or a plain object) in
   `src/simulation/systems/` with `{ id, phase, priority, updateInterval }` and
   `update(world, context)`.
2. Use only `context.random('your-stream')` for randomness,
   `context.queueSpawn/queueRemove` for structural changes, `world.moveEntity`
   for movement, and `context.emit(type, payload)` for observable facts (add new
   event types to `src/protocol/events.js`).
3. Register it in the composition root (`registerDemoSystems`). Saves record
   system descriptors, so a changed lineup will not silently restore old saves.
4. Test determinism: two runs with the same seed must match.

**Before you write it, check the four questions this project keeps getting
wrong:**

- Does it need to **select an action**? Put it in `DecisionSystem` (§9), and
  remember that anything competing with foraging loses.
- Does it need **neighbours**? Read `world.neighbourhood`; do not add a walk
  (§9).
- Does it read a **per-tick accumulator**? Check which phase consumes it (D19).
- Does its effect belong at an **existing chokepoint** (§7)?

### Adding a species

See §8. It is a config edit: a definition file, a roster entry, a
`config.demo.founding` line, and one renderer appearance entry. A test will fail
if you touch the engine.

### Building a renderer

Depend only on the protocol and a transport, treat snapshots as authoritative,
map entity data to glyphs yourself, interpolate between authoritative ticks at
your own frame rate, and develop offline against the committed fixtures in
`src/renderer/fixtures/` (`?mode=fixture` runs the shipped renderer that way).
See `src/renderer/README-RENDERER.md`.
