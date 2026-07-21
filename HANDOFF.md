> **⚠ Superseded by [`DOCS.md`](DOCS.md).** Everything below — the current-state
> table, the conventions, and the open items — is consolidated there alongside
> the architecture, subsystem, protocol, and performance reference, and kept in
> sync there rather than here. Read `DOCS.md §1` for open work and `§15` for the
> conventions. This file is retained as the historical handoff record.

## State at handoff

**As of 2026-07-21.** Every figure below, and every measurement quoted in
`PLAN.md`'s completion notes, is a reading taken on a date — not a standing fact.
See §5 of `PLAN.md` for why that distinction has already bitten once.

|                       |                                                        |
| --------------------- | ------------------------------------------------------ |
| Steps complete        | **1–30 — the plan is finished**                        |
| Tests                 | 662 passing / 0 failing, 170 suites                    |
| `PROTOCOL_VERSION`    | 28 (unchanged by Step 30)                              |
| `SAVE_FORMAT_VERSION` | 27 (unchanged by Step 30)                              |
| Benchmark (large-5k)  | 68.75 ms/tick, 5733→7744 entities                      |
| Git                   | Steps 26–30 are **uncommitted** (the user handles git) |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

⚠ The `609 tests` this file carried into Step 30 was stale by 51. Re-run the
suite rather than quoting this table.

**There is no Step 31.** What is left is the open ⚠ items below, plus the
renderer's own roadmap (`src/renderer/PLAN-RENDERER.md`), which advances
independently.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

⚠ **Biology is per-species, and a species block beats a system's constructor
options.** New in Step 29 and the single most surprising thing in the codebase
right now. `world.species.get(id)` returns a resolved, frozen record; systems
read `species.metabolism.basalRate`, `species.aging.maxAge`, and so on. A species
_overrides_ the same-named global config section, so:

    new HydrationSystem({ dehydrationRate: 0.1 })   // ignored for a known species
    new SimulationEngine({ config: { hydration: { dehydrationRate: 0.1 } } })  // works

The config is what the registry resolves against. This inverted 23 tests in one
go (§1.4 D23) — they kept compiling and quietly stopped meaning anything, which
is worse than a break. Configure through the config.

⚠ **No species-name literal may appear in `src/simulation`.** An invariant since
Step 4, mechanically enforced from Step 29 by a source scan in
`test/species-schema.test.js` (comments stripped first, per §1.4 D6). Express
behaviour as _data_ — `diet`, `preySpeciesIds`, `territory.defends`,
`migration.tracksForage` — not as a name check. A companion scan requires every
`'herbivore'` / `'carnivore'` literal to sit beside a `.diet` read. Adding a
species is then a config edit: definition file, roster entry,
`config.demo.founding` line, and one renderer appearance entry.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls: `killAnimal`, `recordLifeEvent`,
`recordMemory`, `applyInjury`, `inheritGenome`, `mateQuality` /
`acceptanceThreshold`, `dominanceOf` / `isKin` / `resolveContest`, `infect` /
`recover`, and `beginDispersal`.

⚠ **A helper with a threshold silently discards sub-threshold input** (§1.4 D17).
`applyInjury` drops anything at or below `HEALED_BELOW` (0.02), so Step 27's fire
applying 0.006 per tick recorded **no wounds at all** while still killing
animals. Assert the _effect landed_, not that the call happened.

⚠ **Check whether a per-tick field is consumed before you read it** (§1.4 D19).
`lastMoveDistance` is zeroed by metabolism in `physiology`, so any
`environment`-phase system reads 0 forever. Step 28 sat there and wore nothing
for 15 000 ticks while its _other_ half worked perfectly.

⚠ **A constant that is correct for one size is a latent bug** (§1.4 D22). Step
29's scavenger read as a balance problem until the real cause turned up: a flat
`fleshIntakeRate` meant a 4 kg bird stripped a carcass as fast as a 45 kg
predator. When adding a variant that differs by an order of magnitude in some
dimension, grep for constants that ought to scale with it _before_ blaming the
variant's own parameters.

**Derive rather than store, where you can.** Dominance, disease severity, the
`dispersing` flag, and every disturbance effect are computed on read. ⚠ The one
deliberate exception is Step 28's per-cell `feature` flag: with a **hysteresis
band** the state genuinely depends on history (§1.4 D20). Any threshold a
continuously-varying value crosses needs a band, not a number.

⚠ **Terrain is derived and unsaved.** It regenerates from the seed on load, so
nothing may mutate it. Steps 27 and 28 both expressed ground changes as separate
layers read through existing world methods (§1.4 A45).

**All action selection lives in `DecisionSystem`.** Other systems _resolve_ the
chosen action.

⚠ **`#intentFor` is a `switch` with fallthrough groups.** Adding a bare `case`
in the middle of one silently redirects everything above it (§1.4 D9). A `NaN`
heading fails the passability check, so the symptom is "chose the right action,
stood perfectly still" — and `JSON.stringify(NaN)` prints `null`.

⚠ **A new movement behaviour competes with foraging, and foraging must win.**
§1.4 A34. **Steps 25–28 all added no action at all**: disease avoidance is a
subtraction, migration is a bias on the heading `wander` would have picked
anyway, disturbances give existing machinery a reason, and a trail pull rides
migration's channel. Four steps running the answer has been to give existing
behaviour a cause.

⚠ **There is exactly one neighbour walk per tick, and it is perception's.**
Since Step 30 it publishes its result to `world.neighbourhood`; the social
system reads that rather than querying the grid again. Adding a system that
walks the grid per animal re-opens the cost §1.4 C6 spent twenty-three steps
accumulating. See the Step 30 section below for the two checks a reader owes.

**Effects belong at existing chokepoints.** `world.speedModifierAt` carries
terrain, disturbances, _and_ worn ground; `world.isShelteredAt` carries cover and
burrows; `thermalStress` carries weather and storms. Look for the chokepoint
before adding a reader.

**Fixed RNG draw budgets.** `resolveContest` is three, always; mate assessment is
zero; disease spillover is two per tick flat; migration and engineering are
**zero**; a disturbance ignition check is five, spent _before_ the early-returns.

**Bounded everything, and bound it explicitly.** Memories 8, life events 12,
injuries 4, tombstones 256, metrics history 120, mate candidates 6, active
disturbances 3, tracked worn cells 8192. Propagation is bounded by hop counts
(§1.4 D10).

**Inspection vs. bulk snapshot.** Per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only. Dense layers stay out
unless they earn it — but a bounded list of circles, or a short sparse list gated
on a rarely-moving revision, is not a layer. Inspection returns **copies**.

**Event volume is a real budget.** Emit on the _transition_. Collect events tick
by tick in tests (§1.4 D13). When a transition genuinely happens often, the
answer is the renderer's **routine filter**, not emitting less truth.

⚠ **Five seeds cannot resolve a one-seed difference** (§1.4 D14). The demo is a
knife edge. Use ten, and treat a **non-monotonic sweep as proof you are tuning
noise** — that signature has now appeared three times (D14, D21, and briefly in
D22). Every mechanism since 26 ships an `enabled` switch so the control is
reproducible.

**Before asserting an outcome, ask what the control would score** (§1.4 D15).
Prefer asserting the mechanism over the outcome it accumulates into.

**Assert invariants, not population outcomes.** §1.4 D1–D23.

## What Step 30 changed, and what it means for the next change

Large-5k went **86.59 → 68.75 ms/tick (−20.6%)** with the simulation
bit-for-bit unchanged. Two facts from it are load-bearing going forward.

⚠ **There is now one neighbour walk, and `world.neighbourhood` is it.** The
perception system publishes the ids and distances it already computed; the
social system reads them instead of walking the grid again (§1.4 C6, closed).
**A new system that wants neighbours should read that buffer, not add a third
walk.** Two conditions must be checked and both already have a helper to copy
(`SocialSystem#neighboursOf`): the buffer must carry the _current_ tick
(`world.neighbourhoodTick` — perception supports `updateInterval`), and its
radius must reach at least as far as yours. A longer list is safe; a shorter one
silently drops neighbours. Keep the fallback walk — the test that proves the
optimization sound is a byte-for-byte comparison of the two paths.

⚠ **A ~1% whole-simulation timing difference on this machine is noise, not a
result** (§1.4 D24). Run-to-run spread at large-5k is ±10%. Step 30 "improved"
`hunts` with a precomputed `Set`, saw a 1% gain, and only found out from a
direct microbenchmark that it was a **35% regression** — the rosters are one
entry long and hashing a string beats scanning an array of one only in theory.
Benchmark the thing you changed, at a volume where it dominates.

**Before optimizing anything else, re-baseline.** `86.59` was a fresh reading of
Step 29's unchanged code taken the same day; the figure that file had carried
was `~81`. Measurements do not keep.

**The profile, so you need not re-derive it.** After Step 30, at large-5k:
perception 27.7 ms/tick, decision 7.5, social 5.0, movement 2.9, and all
nineteen other systems together 5.3. `SpatialGrid.queryRadius` is the second
hottest function at 7.3 ms/tick self time. The remaining perception cost is
visiting every cell in the radius — cutting it means visiting fewer cells, and
the obvious way (ring search with early exit) is **not exact** and was rejected
for that reason, not overlooked.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ C8** (5, 28) — **animals spend ~49% of their time within two cells of the
  world boundary**, because movement _clamps_ there instead of turning away.
  Step 30 left it alone on purpose: it is a behaviour bug wearing a performance
  costume, and reflecting the heading changes Step 5 for every system, so it
  needs its own ten-seed measurement. The largest open item in the file.
- **⚠ A31** (21) — Step 21's selection sandbox has never demonstrated its claim.
  An unmet **Step 21** acceptance criterion, and the oldest open ⚠ in the file.
- **⚠ A34** (24) — patrolling is near-inert (`patrolSpanFactor` is **6**). Check
  the ramp before theorizing about site fidelity.
- **C3** (1, 9, 13) — per-tick event volume, never addressed. Step 30 found it in
  a new place: **events are 42% of a 1.78 MiB demo save**, more than the entire
  entity array.
- **B5** (8, 14) — `utilityBreakdown` still persists, now measured at 3.3% of a
  save. Removing it costs a save-format bump to buy 3%.
- **A49/A50** (29) — "activity pattern" and "habitat preference" are not schema
  blocks (there is no diurnal cycle, and preference is expressed through
  `migration.tracksForage` and the comfort band); the species roster is a
  hand-written import list rather than a runtime-loaded data file.
- **A47/A48** (28) — animals do not seek others' burrows; grazing clearings are
  not a feature because vegetation already does that.
- **A44/A45/A46** (27) — drought and severe winter stay _global_ weather; terrain
  is never modified; disturbance mortality is rare in the demo by design.
- **A40/A42/A43** (26) — no remembered routes; the forage cue reaches beyond
  perception as a stated stand-in; fragmentation is enabled but not asserted.
- **A32** (23) — juvenile defense fires about once in 12 000 ticks.
- **A37/A39** (25) — disease does not cross species, and a spillover stands in
  for an unsimulated reservoir. (A38 is closed: disease is a species block now,
  it simply does not _vary_ by species in the demo yet.)
- **A35/A36** (24) — territory is a predator-only phenomenon at ~9 individuals,
  and the claim layer is not drawn on the grid.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose.
- **B1** (4) — `createDemoSimulation.js` was never renamed to `createEcosystem.js`
  (pure churn). **B2 is closed**: `config.demo` is now a founding _roster_.
- **B6 is closed** (11) — aging costs 0.17 ms/tick, so there is nothing to
  derive away. B5 is listed above with its measurement.
