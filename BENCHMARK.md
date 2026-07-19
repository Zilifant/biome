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

## Results (post-Step-13)

| Scenario | World | Start→end entities | ms/tick | ticks/sec |
| --- | --- | ---: | ---: | ---: |
| demo-default | 128×128 | 8→11 | 0.033 | ~30,700 |
| small-100 | 256×256 | 100→143 | 0.367 | ~2,720 |
| medium-1k | 512×512 | 1000→1452 | 4.47 | ~224 |
| large-5k | 1024×1024 | 5000→7262 | 33.4 | ~30 |

"entities" are animals and carcasses (Step 3 replaced the demo plant entities
with a cell-level vegetation biomass field, so vegetation cost scales with
world size, not entity count). End counts now *exceed* the start because
animals reproduce (Step 12). All scenarios sit far under the one-second
authoritative tick budget.

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
  (PLAN.md risk register: "tick-budget overruns").
