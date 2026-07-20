## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–29 (Step 30 next — the last one)                                  |
| Tests                 | 609 passing / 0 failing, 161 suites                                 |
| `PROTOCOL_VERSION`    | 27 (unchanged by Step 29)                                           |
| `SAVE_FORMAT_VERSION` | 27                                                                  |
| Benchmark (large-5k)  | ~81 ms/tick, 5733→7744 entities                                     |
| Git                   | Steps 26–29 are **uncommitted** (the user handles git)              |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

⚠ **Biology is per-species, and a species block beats a system's constructor
options.** New in Step 29 and the single most surprising thing in the codebase
right now. `world.species.get(id)` returns a resolved, frozen record; systems
read `species.metabolism.basalRate`, `species.aging.maxAge`, and so on. A species
*overrides* the same-named global config section, so:

    new HydrationSystem({ dehydrationRate: 0.1 })   // ignored for a known species
    new SimulationEngine({ config: { hydration: { dehydrationRate: 0.1 } } })  // works

The config is what the registry resolves against. This inverted 23 tests in one
go (§1.4 D23) — they kept compiling and quietly stopped meaning anything, which
is worse than a break. Configure through the config.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls: `killAnimal`, `recordLifeEvent`,
`recordMemory`, `applyInjury`, `inheritGenome`, `mateQuality` /
`acceptanceThreshold`, `dominanceOf` / `isKin` / `resolveContest`, `infect` /
`recover`, and `beginDispersal`.

⚠ **A helper with a threshold silently discards sub-threshold input** (§1.4 D17).
`applyInjury` drops anything at or below `HEALED_BELOW` (0.02), so Step 27's fire
applying 0.006 per tick recorded **no wounds at all** while still killing
animals. Assert the *effect landed*, not that the call happened.

⚠ **Check whether a per-tick field is consumed before you read it** (§1.4 D19).
`lastMoveDistance` is zeroed by metabolism in `physiology`, so any
`environment`-phase system reads 0 forever. Step 28 sat there and wore nothing
for 15 000 ticks while its *other* half worked perfectly.

⚠ **A constant that is correct for one size is a latent bug** (§1.4 D22). Step
29's scavenger read as a balance problem until the real cause turned up: a flat
`fleshIntakeRate` meant a 4 kg bird stripped a carcass as fast as a 45 kg
predator. When adding a variant that differs by an order of magnitude in some
dimension, grep for constants that ought to scale with it *before* blaming the
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

**Effects belong at existing chokepoints.** `world.speedModifierAt` carries
terrain, disturbances, *and* worn ground; `world.isShelteredAt` carries cover and
burrows; `thermalStress` carries weather and storms. Look for the chokepoint
before adding a reader.

**Fixed RNG draw budgets.** `resolveContest` is three, always; mate assessment is
zero; disease spillover is two per tick flat; migration and engineering are
**zero**; a disturbance ignition check is five, spent *before* the early-returns.

**Bounded everything, and bound it explicitly.** Memories 8, life events 12,
injuries 4, tombstones 256, metrics history 120, mate candidates 6, active
disturbances 3, tracked worn cells 8192. Propagation is bounded by hop counts
(§1.4 D10).

**Inspection vs. bulk snapshot.** Per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only. Dense layers stay out
unless they earn it — but a bounded list of circles, or a short sparse list gated
on a rarely-moving revision, is not a layer. Inspection returns **copies**.

**Event volume is a real budget.** Emit on the *transition*. Collect events tick
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

## Step 30 specifics

Measured performance optimization — the last step, and the one with the most
groundwork already laid.

- **C6 is the named target and has been since Step 7.** Perception and sociality
  each walk the same grid neighbourhood separately; the second cost +26 ms/tick
  at large-5k when it landed. Folding them into one loop is the single clearest
  win, and Steps 25–29 all deliberately declined to add a *third* walk, so the
  problem is still exactly two walks wide.
- **Everything added since is O(1)-per-animal by construction** and should not be
  on the critical path: migration samples the vegetation field with 16 grid
  reads on a stagger, disturbance affliction is O(animals × active ≤ 3), and
  engineering decay walks the *worn* cells rather than the world. Verify rather
  than assume, but expect perception to dominate.
- ⚠ **C8** (new in Step 28) — animals spend ~49% of their time within two cells
  of the world boundary because movement *clamps* there. Any occupancy-sensitive
  optimization (spatial hashing, culling) should know the distribution is that
  lopsided, and it may be worth fixing on its own merits first.
- **B5/B6** are the save-size and aging-cost items parked for this step:
  `utilityBreakdown` and per-entity `traits` persist on the entity, and `age` is
  stored rather than derived from a `birthTick`.
- The demo now runs **three species and ~7% more animals** per scenario than the
  Step 28 baseline, so re-baseline before optimizing.
- ⚠ Heed D14: the demo's balance is a knife edge, and an optimization that
  changes iteration order or draw counts changes the *simulation*, not just its
  speed. `determinism.test.js` is the guard; run ten seeds if anything about
  ordering moves.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ C8** (5, 28) — the boundary pile-up described above.
- **⚠ A31** (21) — Step 21's selection sandbox has never demonstrated its claim.
  An unmet **Step 21** acceptance criterion, and the oldest open ⚠ in the file.
- **⚠ A34** (24) — patrolling is near-inert (`patrolSpanFactor` is **6**). Check
  the ramp before theorizing about site fidelity.
- **C6** (7, 23, 24) — the two neighbour walks. **Step 30**.
- **A49/A50** (29) — "activity pattern" and "habitat preference" are not schema
  blocks (there is no diurnal cycle, and preference is expressed through
  `migration.tracksForage` and the comfort band); the species roster is a
  hand-written import list rather than a runtime-loaded data file.
- **A47/A48** (28) — animals do not seek others' burrows; grazing clearings are
  not a feature because vegetation already does that.
- **A44/A45/A46** (27) — drought and severe winter stay *global* weather; terrain
  is never modified; disturbance mortality is rare in the demo by design.
- **A40/A42/A43** (26) — no remembered routes; the forage cue reaches beyond
  perception as a stated stand-in; fragmentation is enabled but not asserted.
- **A32** (23) — juvenile defense fires about once in 12 000 ticks.
- **A37/A39** (25) — disease does not cross species, and a spillover stands in
  for an unsimulated reservoir. (A38 is closed: disease is a species block now,
  it simply does not *vary* by species in the demo yet.)
- **A35/A36** (24) — territory is a predator-only phenomenon at ~9 individuals,
  and the claim layer is not drawn on the grid.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose.
- **B1** (4) — `createDemoSimulation.js` was never renamed to `createEcosystem.js`
  (pure churn). **B2 is closed**: `config.demo` is now a founding *roster*.
- **B5/B6** (8, 11, 14) — save-size and aging-cost items, parked for Step 30.
