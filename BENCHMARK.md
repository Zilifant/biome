# Performance baseline

Baseline established in **PLAN.md Step 1**. Every later step that changes
hot-path behavior should re-run `npm run benchmark` and compare against these
numbers. This is a **reporting baseline, not a CI gate** — timings are
machine-dependent, so tests never assert absolute times (only the amortized
event-bus test uses a deliberately generous bound).

## How to reproduce

```bash
npm run benchmark                 # human-readable table
npm run benchmark -- --json       # machine-readable
npm run benchmark -- --ticks=5000 --seed=7
```

The script (`src/scripts/benchmark.js`) runs the demo world headless (no
server, no renderer, no real-time pacing) across scaled entity counts. Each
scenario warms up 50 ticks (JIT steady state) before timing the remainder,
and reports start→end entity counts because populations change over the run
(births, age deaths, carcasses). It also verifies two identical 2000-tick runs
serialize byte-for-byte identically, so a benchmark run doubles as a
determinism check.

## Environment

| | |
| --- | --- |
| Node | v23.4.0 |
| Platform | darwin arm64 (Apple Silicon) |
| Seed | 42 |
| Ticks per scenario | 2000 (50 warmup + 1950 measured) |
| Determinism (2000 ticks) | OK (byte-identical) |

## Results (post-Step-30)

Measured **2026-07-21**, both columns on the same machine on the same day —
which is the only way these are comparable (see DOCS.md, "How to read this
document").

| Scenario | World | Start→end entities | ms/tick | before Step 30 | ticks/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| demo-default | 128×128 | 138→188 | 1.008 | 1.231 | ~992 |
| small-100 | 256×256 | 115→150 | 0.671 | 0.841 | ~1,491 |
| medium-1k | 512×512 | 1147→1556 | 9.230 | 11.566 | ~108 |
| large-5k | 1024×1024 | 5733→7744 | **68.75** | 86.59 | ~15 |

**Start and end entity counts are unchanged by Step 30, to the animal.** That is
the point: it optimized nothing but the cost of computing the same world. The
same seeds serialize byte-identically before and after.

Since Step 16 each scenario seeds **predators alongside prey** at roughly the
demo's ratio, so these numbers describe a mixed population, not a
herbivore-only world. The `demo-default` row also grew from 8 animals to 64:
a working predator/prey demo needs enough prey density for encounters to
happen at all.

"entities" are animals and carcasses (Step 3 replaced the demo plant entities
with a cell-level vegetation biomass field, so vegetation cost scales with
world size, not entity count). End counts now *exceed* the start because
animals reproduce (Step 12). All scenarios sit far under the one-second
authoritative tick budget.

### Where the time goes (large-5k, measured 2026-07-21)

Per-system wall clock, taken by wrapping every registered system's `update`.
The left column is the state Step 30 inherited; the right is after it. Both are
300-tick runs at ~5.7k entities, so they are comparable to each other but not to
the table above (which runs 1950 ticks and ends at 7.7k).

| System | before | after |
| --- | ---: | ---: |
| `PerceptionSystem` | 38.48 | 27.73 |
| `SocialSystem` | 15.30 | **5.03** |
| `DecisionSystem` | 7.80 | 7.53 |
| `MovementSystem` | 3.16 | 2.93 |
| everything else (18 systems) | 5.51 | 5.29 |
| **total** | **70.25** | **48.51** |

Perception and sociality were 77% of a tick and are now 67% of a much cheaper
one. Every other system is under 1 ms/tick and always has been — §1.4's
"everything added since Step 7 is O(1) per animal" held up under measurement.

### History
- **Step 1** (post event-bus fix): demo 0.0035, small 0.025, medium 0.244,
  large 1.63 ms/tick — with 4× the entity load (animals + plant entities).
- **Step 2** (terrain): large-5k 1.52 ms/tick (terrain generation is
  one-time at init; the movement passability guard is negligible).
- **Step 3** (vegetation): large-5k 1.81 ms/tick. Vegetation regrowth is the
  largest cell loop but is staggered (every 5 ticks) and quantized deltas are
  sparse; the snapshot projection is memoized by a revision counter so idle
  ticks pay nothing.
- **Step 4** (herbivore species): large-5k 1.79 ms/tick — four extra scalar
  physiology fields per entity are free.
- **Step 5** (terrain-aware locomotion): large-5k 1.72 ms/tick. Real movement
  (committed intent + terrain speed modifiers + passability) is per-animal
  per-tick with no global scans, so cost is unchanged within noise.
- **Step 6** (energy & metabolism): large-5k 1.81 ms/tick. Per-animal
  bioenergetics arithmetic; starved animals become carcasses that persist
  (decay is Step 18), so end entity counts are now the starting count of
  carcasses rather than 0.
- **Step 7** (local perception): large-5k **14.0 ms/tick** — now the dominant
  cost. Each animal scans its radius neighborhood (O(r²) cells, r=6 → 169
  cells) for nearest food/water/obstacle, plus a spatial-grid neighbor query.
  Still far under the 1 s budget and ~linear in animals (extrapolates to
  ~70 ms at 25k). Staggering via `config.perception.updateInterval` cuts it
  proportionally (measured: interval 3 → ~2.6×, interval 5 → ~3.7× faster);
  the demo keeps interval 1. Ring-search early termination and buffer reuse
  are the Step 30 optimizations if profiling demands them.
- **Step 8** (utility-based decisions): large-5k **18.3 ms/tick** (+4 over
  Step 7). Per-animal action scoring (2 RNG draws + a few utility terms + a
  perception/vegetation lookup); perception is still the dominant cost. ~90 ms
  extrapolated to 25k animals, comfortably under budget.
- **Step 9** (herbivory): large-5k **20.2 ms/tick** (+2). Per-eater biomass
  consumption (`VegetationGrid.consumeAt`) + energy conversion; local, no
  global scans. Animals now survive, so end counts are living animals, not
  carcasses. `entity.fed` events add volume (one per eater per feeding tick),
  bounded by the event buffer and hidden behind the renderer's "show routine"
  toggle.
- **Step 10** (hydration): large-5k **20.9 ms/tick** (+0.7, negligible as
  predicted). One more per-animal scalar update plus reuse of the existing
  perception `nearestWater`; no new scans.
- **Step 11** (aging + life stages): large-5k **~20.9 ms/tick** (no measurable
  change). Per-animal age/mass/stage arithmetic + one `aging`-stream draw, run
  every tick. `AgingSystem` supports `updateInterval` staggering (verified:
  age increments by the interval), but the cost is negligible so the demo runs
  it every tick for exact ages.
- **Step 12** (reproduction): large-5k **35.3 ms/tick**. The per-entity cost is
  essentially unchanged — the rise is because populations now *grow* during the
  benchmark (large-5k ends at ~7.3k entities instead of 5k). Mate search is
  grid-local (`queryRadius`), never a global pairwise scan. Note that scenario
  "end entity" counts now exceed the start.
- **Step 13** (parenting): large-5k **33.4 ms/tick** (within noise of Step 12,
  at the same ~7.3k end population). `ParentingSystem` visits each animal once
  and resolves its guardian by an O(1) id lookup — no scan, no reverse index —
  and only bonded juveniles do any work at all, which is a small fraction of
  the population. The guardian-in-perception check rides along inside the
  spatial-grid neighbor loop perception already ran, so it costs nothing extra.
  Relationships are sparse arrays (a handful of ids per animal) and life
  histories are hard-capped at 12 entries, so neither grows without bound.
- **Step 14** (individual variation): large-5k **33.97 ms/tick** (within noise
  of Step 13's 33.4). Traits are sampled once at creation, never per tick. The
  two values worth precomputing are resolved at spawn — `speed` (species mean ×
  trait) and `adultMass`, which the aging system reads every tick through a
  reused scratch object rather than allocating a growth record per animal per
  tick. The remaining trait effects are a handful of float multiplies inside
  loops that already run, which is invisible next to perception. Cost is in
  memory, not time: each animal now carries a 7-number `traits` object, and
  entities created without traits share one frozen neutral instance.
- **Step 15** (memory): large-5k **33.97 → 37.18 ms/tick** (+3.2). The decay
  pass itself is cheap and staggered (`memory.updateInterval: 5`, with decay
  scaled by the interval so the fade rate is unchanged); most of the rise is
  the per-animal recall lookups in the decision system. Both are bounded by the
  hard cap of 8 memories per animal, so this cost is flat in world size and
  linear in animals — a scan of 8 entries, not a spatial query. Memory is the
  first per-entity *growable* structure in the engine, which is exactly why the
  cap is enforced in the insert helper rather than left to the systems.
- **Step 16** (predation): large-5k **37.18 → 40.13 ms/tick** (+2.9), now with
  333 predators among 5000 prey rather than prey alone. `HuntingSystem` only
  touches predators that are mid-chase and resolves the target by id, so it is
  effectively free; the cost is in perception, which now classifies each
  neighbour as prey/threat/carcass — but that rides inside the spatial-grid
  loop it already ran, so it is a few comparisons per neighbour rather than a
  new query. Sprinting adds one branch and one subtraction to the movement
  loop. The `demo-default` row rose from 0.034 to 0.244 ms/tick purely because
  the demo herd grew 8 → 64.
- **Step 17** (injury and healing): large-5k **40.13 → 42.66 ms/tick** (+2.5).
  `InjurySystem` skips every uninjured animal after one array-length check, and
  injured animals are a small minority. The penalties cost nothing to apply:
  `impairment` is a cached total maintained wherever the injury list changes, so
  the movement and feeding hot loops read one number instead of walking a list.
  Injuries are capped at 4 per animal, so like memories and life events they
  cannot grow without bound.
- **Step 18** (carcasses and decay): large-5k **42.66 → 42.57 ms/tick** (no
  measurable change). `CarcassSystem` is staggered (every 5 ticks) and only
  touches carcasses, whose decay is a pure function of elapsed time — no state
  machine to advance, so a stagger cannot drift it. The one structural change
  is that entities are now *removed*, which shrinks the entity set the other
  systems iterate: before this step carcasses accumulated forever and every
  system paid to skip them. The `demo-default` row rose to 0.63 ms/tick because
  the demo cohorts doubled to 120 prey / 8 predators — see PLAN.md Step 18 for
  why that re-tune was needed.
- **Step 19** (weather and seasons): large-5k **42.57 → 46.11 ms/tick** (+3.5).
  The weather system itself is a handful of global scalars and one RNG draw per
  spell — free. The cost is in the two places the environment is *read* per
  animal per tick: the thermoregulation term in metabolism, and the shelter
  utility in decision. Vegetation pays nothing extra: the seasonal ceiling is
  one more multiply inside the cell loop it already ran, still staggered every
  5 ticks. The `environment` block adds ~7 scalars to each snapshot and delta,
  which is negligible beside the entity array.
- **Step 20** (genetics): large-5k **46.11 → 41.34 ms/tick** (within run-to-run
  noise at this population; genetics does no per-tick work at all). Inheritance
  runs once, at birth: 4 draws per locus and one expression pass, against a
  birth rate measured in tens per thousand ticks. The cost is memory rather than
  time — the genome doubles what Step 14's traits held (two alleles per locus
  instead of one value), still a bounded 7 loci per animal. Every system
  continues to read only the expressed `traits`, exactly as before, so nothing
  in the hot path learned about genetics.
- **Step 25** (disease): large-5k **74.33 → 79.78 ms/tick (+5.5)**. Almost all of
  it is the O(N) progression-and-recovery pass every animal makes each tick;
  **transmission itself costs nothing between outbreaks**, because only
  *infectious* animals query the grid. That was the deliberate choice: the
  obvious shape — every animal looking around for a sick neighbour — would have
  been a third full neighbour walk on top of perception's and sociality's
  (§1.4 C6), and would have cost far more than this. Spillover is two draws per
  tick flat, whatever the population. A test pins the scaling by showing twenty
  animals and four hundred leave the random stream in the same state.

- **Step 24** (territories and home ranges): large-5k **72.01 → 74.33 ms/tick
  (+2.3, within this scenario's noise)** — cheap by construction, and
  deliberately so. The home-range summary is four numbers updated in O(1) per
  animal (the step's own performance note rules out occupancy history); marking
  is one grid write on a 20-tick interval; avoidance is one grid read; and a
  dispute is two id lookups and no spatial query at all. The only O(cells) work
  is claim decay, staggered every 10 ticks with the rate compensated, and the
  whole-territory `transfer` that a resolved dispute triggers. The **coarse**
  claim grid is what keeps both affordable: 4×4 world cells per claim cell means
  1024 cells for the demo world instead of 16 384, and 65 536 at 1024² instead
  of a million.

- **Step 23** (social behaviour): large-5k **46.06 → 72.01 ms/tick (+26)** —
  the largest single jump since perception in Step 7, and the same cause. The
  `SocialSystem` runs a **second** `queryRadius` per animal per tick, over
  radius 6, on top of the one perception already does. Everything else it adds
  is cheap: the group tally is one O(N) pass over labels, dominance is a handful
  of arithmetic derived on read, and contests happen only where two rivals share
  a female.
  
  Still ~14× inside the one-second tick budget, so it is recorded rather than
  optimized — but the fix is obvious and named: **perception and sociality walk
  the same grid neighbourhood**, so the social pass could be folded into
  perception's existing loop for close to nothing. That is Step 30's work
  (measured optimization), and it now joins §1.4 C6 as the second entry in the
  "one neighbour walk too many" column. Note that the demo-default row nearly
  doubled (0.60 → 1.05) because herding *clusters* animals, so each grid query
  returns more neighbours — sociality makes its own neighbourhoods denser.

- **Step 22** (mate choice and sexual selection): large-5k **41.42 → 46.06
  ms/tick**. Within the run-to-run band this scenario has shown all along (it
  has bounced 41–46 since Step 19), and the added work is genuinely small:
  assessment is a handful of arithmetic per receptive female per tick, it runs
  only inside `matingRange` on a grid query reproduction was already making,
  and it consumes no randomness at all. Perception gained a bounded
  (`maxMateCandidates: 6`) candidate list built in the neighbour pass it was
  already walking, so it costs a comparison per neighbour rather than a second
  scan. End entity count rose 7060 → 7233, which accounts for part of it.
  Courtship *events* were the one real cost and were fixed rather than
  absorbed: emitting one per assessment produced ~1.7 events/tick across the
  demo (26k over 15k ticks), so the system now reports only a new candidate or
  a changed verdict — ~1.4k over the same run, a 20× cut.

- **Step 21** (evolutionary observation): large-5k **41.34 → 41.42 ms/tick** (no
  measurable change). Aggregation is a single O(N) pass — no pairwise work —
  staggered to every 50 ticks, so its amortized cost is a fiftieth of one walk
  over the entity list. Everything it produces is bounded: fixed bins per
  histogram, fixed traits per species, and a 120-sample history. Metrics never
  enter the per-tick payload; they are fetched through `GET /api/metrics`,
  which is the reason a full aggregate can afford to be this detailed.

- **Steps 26–29** (migration, disturbances, engineering, species schema): no
  entry here — each is recorded in its PLAN.md completion note instead. The
  short version is that none of them moved large-5k measurably (79.78 → ~80.97
  across all four, while carrying ~7% more entities), which is what §1.4
  predicted: everything since Step 23 is O(1) per animal, and all four
  deliberately declined to add a **third** neighbour walk.

- **Step 30** (measured optimization): large-5k **86.59 → 68.75 ms/tick
  (−20.6%)**, and −18% to −20% on every other scenario. The 86.59 is a fresh
  reading of the *unchanged* code taken the same day, not Step 29's 80.97 —
  re-baselining first is the whole reason the improvement is believable.
  Nothing about the simulation changed: identical entity counts, identical
  serialized state, identical renderer fixtures.

  Two things paid for nearly all of it, and both were named in §1.4 C6 long
  before this step:
  1. **The second neighbour walk is gone** (15.30 → 5.03 ms/tick). Perception
     and sociality walked the same grid neighbourhood separately; perception now
     publishes the list it already built and the social system reads it. The
     social system keeps its own walk as a fallback for when perception is
     staggered or has a shorter radius, and a test runs 400 demo ticks down each
     path and asserts they agree byte for byte.
  2. **The perception cell scan got cheaper per cell** (38.48 → 27.73 ms/tick).
     Row spans come from the circle rather than testing a bounding box; terrain
     is read once per cell instead of twice; the cheap "nearer than the best so
     far" test moved ahead of the grid reads it guards; and the best-so-far is
     held in plain numbers, so a scan allocates nothing. It still visits every
     cell in the radius — a **ring-search early exit was considered and
     rejected**, because ring order is by cell offset while the answer is the
     nearest cell to the animal's *continuous* position, so exiting early would
     change which cell wins. That is a behaviour change, and this step was not
     allowed one.

  The supporting changes are the spatial grid's: packed integer bucket keys
  instead of `"x:y"` strings, and positions stored in the buckets so a candidate
  costs no second hash lookup.

## Step 1 remediation recorded here

The initial baseline exposed a hot-path defect in `DomainEventBus`: it trimmed
the bounded buffer with a front `splice` on **every** emit once full, i.e.
O(maxBufferedEvents) per event. With the demo emitting one move event per
animal per tick, the large-5k scenario measured **58.65 ms/tick**. Measuring
with trimming effectively disabled isolated the cause (74 → 2.8 ms/tick).

The fix makes trimming amortized O(1): the buffer overflows by up to one
`maxBufferedEvents` chunk, then drops the oldest chunk in bulk (retention
floor unchanged at `maxBufferedEvents`, hard ceiling `2 × maxBufferedEvents`).
Result: large-5k improved **58.65 → 1.63 ms/tick (~36×)** with determinism
preserved. Covered by `test/event-bus.test.js`.

## Notes for future baselines

- Record Node version and platform alongside numbers (they dominate absolute
  timings).
- When a step adds a per-entity system, expect ms/tick to rise; keep the
  medium-1k scenario under a few ms/tick and large-5k comfortably under the
  1 s budget.
- If a change regresses large-5k by more than ~2× without a matching feature
  reason, treat it as a hot-path regression and profile before proceeding
  (DOCS.md §17 risk register: "tick-budget overruns").
