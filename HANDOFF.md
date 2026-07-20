## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–28 (Step 29 next)                                                 |
| Tests                 | 590 passing / 0 failing, 157 suites                                 |
| `PROTOCOL_VERSION`    | 27                                                                  |
| `SAVE_FORMAT_VERSION` | 26                                                                  |
| Benchmark (large-5k)  | ~80 ms/tick, 5333→7219 entities                                     |
| Git                   | Steps 26–28 are **uncommitted** (the user handles git)              |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls: `killAnimal`, `recordLifeEvent`,
`recordMemory`, `applyInjury`, `inheritGenome`, `mateQuality` /
`acceptanceThreshold` (mating/mateChoice.js), `dominanceOf` / `isKin` /
`resolveContest` (social/dominance.js — used by both mating rivalries *and*
territorial disputes), `infect` / `recover` (disease/disease.js), and
`beginDispersal` (migration/migration.js, called by parenting at the one instant
a bond ends).

⚠ **A helper with a threshold silently discards sub-threshold input** (§1.4 D17).
`applyInjury` drops anything at or below `HEALED_BELOW` (0.02), so Step 27's fire
applying 0.006 per tick recorded **no wounds at all** while still killing animals
through a separate health drain. Before feeding a small per-tick rate into an
accumulator helper, check its floor — and assert the *effect landed*, not that
the call happened.

⚠ **Check whether a per-tick field is consumed before you read it** (§1.4 D19).
`lastMoveDistance` is zeroed by the metabolism system in `physiology`, so any
`environment`-phase system reads 0 forever. Step 28 sat there and wore **nothing
at all** for 15 000 ticks while its *other* half worked perfectly — a
half-working feature hides far better than a broken one. Systems that read what
an animal just did belong in `interaction`, after `movement`; that is where the
territory and engineering systems both are, for the same reason.

**Derive rather than store, where you can.** Dominance (23), disease severity
(25), the `dispersing` flag (26), and every disturbance effect (27) are computed
on read. ⚠ The one deliberate exception is Step 28's per-cell `feature` flag:
with a **hysteresis band** the state genuinely depends on history, which is
exactly what a derived value cannot express (§1.4 D20). Any threshold a
continuously-varying value crosses needs a band, not a number — without one,
cells flapped 9569 times in a single run.

⚠ **Terrain is derived and unsaved.** It regenerates from the seed on load, so
nothing may mutate it. Steps 27 and 28 both wanted to change the ground and both
expressed it as a *separate layer* whose effects are read through existing world
methods (§1.4 A45).

**All action selection lives in `DecisionSystem`.** `flee`, `chase`, `stalk`,
`shelter`, `followParent`, `seekMate`, `herd`, `defend`, `patrol`, `retreat` are
scored there; other systems _resolve_ the chosen action.

⚠ **`#intentFor` is a `switch` with fallthrough groups.** Adding a bare `case`
in the middle of one silently redirects everything above it (§1.4 D9 — five
suites, one hour). Add new cases *before* a group, never inside it. A `NaN`
heading fails the passability check, so the symptom is "chose the right action,
stood perfectly still" — and `JSON.stringify(NaN)` prints `null`.

⚠ **A new movement behaviour competes with foraging, and foraging must win.**
Step 24's `patrol` cost the demo two seeds in five before it was ramped almost
out of existence (§1.4 A34). **Steps 25, 26, 27, and 28 all added no action at
all**: disease avoidance is a subtraction, migration is a bias on the heading
`wander` would have picked anyway, disturbances give existing drift and
danger-memory machinery a reason, and a trail pull rides migration's channel.
Four steps running the answer has been to give existing behaviour a cause.

**Effects belong at existing chokepoints.** `world.speedModifierAt` now carries
terrain, disturbances, *and* worn ground; `world.isShelteredAt` carries cover and
burrows; `thermalStress` carries weather and storms. Nothing downstream knows the
difference, which is why two whole steps needed no changes to the movement or
metabolism systems. Look for the chokepoint before adding a reader.

**Fixed RNG draw budgets.** Same draws regardless of outcome. `resolveContest` is
three, always; mate assessment is zero; disease spillover is two per tick flat;
migration and engineering are **zero**; a disturbance ignition check is five,
spent *before* the early-returns so a full active list cannot change the stream.

**Bounded everything, and bound it explicitly.** Per-entity structures are capped
in their insert helper (memories 8, life events 12, injuries 4, tombstones 256,
metrics history 120, mate candidates 6); active disturbances at 3; tracked worn
cells at 8192. *Propagation* is bounded by hop counts (§1.4 D10). Per-animal
*spatial* state is a running summary, never a history. And anything added to a
**metrics history sample** multiplies by 120 retained samples.

**Inspection vs. bulk snapshot.** Per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only or a query. Whole
dense *layers* stay out unless they earn it — but a bounded list of circles
(disturbances) or a short sparse list gated on a revision that rarely moves
(features) is not a layer. Inspection returns **copies**.

**Event volume is a real budget.** Emit on the *transition*, not every tick the
condition holds. Collect events tick by tick in tests — `eventsSince` after a
long `step(n)` measures what survived the bounded outbox (§1.4 D13). When a
transition genuinely happens often (worn ground turns over ~0.7×/tick), the
answer is the renderer's **routine filter**, not emitting less truth.

⚠ **Five seeds cannot resolve a one-seed difference** (§1.4 D14). The demo is a
knife edge at ~3–9 stalkers. Use ten, and treat a **non-monotonic sweep as proof
you are tuning noise** — that signature has now appeared three times (D14, D21).
Every mechanism since 26 ships an `enabled` config switch so the control is
reproducible; Step 27 added `kinds` and Step 28 a `demoteFraction`, both of which
existed to make attribution possible. Do the same for the next one.

**Before asserting an outcome, ask what the control would score** (§1.4 D15). If
the control scores the same, the test measures the world rather than the change.
Prefer asserting the mechanism (a distribution of chosen headings) over the
outcome it accumulates into.

⚠ **Check the duty cycle of anything whose result is a cycle** (§1.4 D18). Step
27's first parameters left something running 91% of ticks, which meant nothing
ever finished recovering and the acceptance criterion could not be observed.

**Assert invariants, not population outcomes.** §1.4 D1–D21.

## Step 29 specifics

The species schema — unify the biology that currently lives in global config and
ad-hoc species fields. This is the longest-deferred item in the plan and it has
**six blocks** waiting for it. Groundwork:

- The debt is enumerated: **B3** (metabolism, hydration, aging), **B4**
  (perception radius, resolved from the registry with no entity field — a
  *different* pattern from B3), **A13** (trait spread and mutation), **A17**
  (predator `birthMass` and the aging curve), **A29/A30** (`matePreference`
  direction, `GESTATING_SEX`), **A38** (disease parameters), **A41**
  (`migration`). Disturbances and features are *world* state, not biology, so
  they add nothing.
- `config/species/*` already holds the pattern to generalize: biology only, never
  glyphs, looked up by id, never branched on by name. `territory`, `migration`,
  and `matePreference` are already per-species blocks and are the model.
- A third species is the natural forcing function — **A21** (no scavenger guild)
  and **A35** (territory is predator-only at ~9 individuals) both want one, and a
  schema with two hand-written species proves very little.
- ⚠ Watch the save format: species definitions are code, not saved data, but
  every per-entity field derived from them is saved. Moving a global to a species
  block changes what a restored entity resolves against.
- ⚠ Heed A34/D14 as always, and note that a third species changes the demo's
  two-species knife edge outright — expect to re-measure the founding counts
  (`config.demo`) rather than assuming the existing balance survives.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ C8** (5, 28) — **new**. Animals spend ~49% of their time within two cells of
  the world boundary (6% of the area), because movement *clamps* at the edge
  rather than turning away. Pre-existing since Step 5 and invisible until Step
  28's trail layer made occupancy visible. Reflecting the heading at a boundary
  is the obvious fix, but it changes movement for every system and needs its own
  ten-seed measurement.
- **⚠ A31** (21) — Step 21's selection sandbox has never demonstrated its claim.
  An unmet **Step 21** acceptance criterion.
- **⚠ A34** (24) — patrolling is near-inert (`patrolSpanFactor` is **6**, so it
  effectively never fires). Step 26 wrote a fix for a problem it assumed patrol
  was causing before discovering this; check the ramp before theorizing.
- **C6** (7, 23, 24) — perception and sociality each walk the same grid
  neighbourhood separately (+26 ms/tick for the second). Steps 25–28 all
  deliberately declined to add a third walk. Folding the two is the clearest
  optimization; **Step 30**.
- **A47/A48** (28) — animals do not seek others' burrows; grazing clearings are
  not a feature, because vegetation already does that.
- **A44/A45/A46** (27) — drought and severe winter stay *global* weather; terrain
  is never modified; disturbance mortality is rare in the demo by design.
- **A40/A41/A42/A43** (26) — no remembered routes; migration is grazer-only; the
  forage cue reaches beyond perception as a stated stand-in; fragmentation is
  enabled but not asserted.
- **A32** (23) — juvenile defense fires about once in 12 000 ticks.
- **A37/A38/A39** (25) — disease does not cross species, its parameters are
  global, and a spillover stands in for an unsimulated reservoir.
- **A35/A36** (24) — territory is a predator-only phenomenon at ~9 individuals,
  and the claim layer is not drawn on the grid.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose (and Step 26 deliberately
  does *not* disperse orphans, for the same reason).
- **B5/B6** (8, 11, 14) — `utilityBreakdown` and per-entity `traits` persist on
  the entity; `age` is stored rather than derived from a `birthTick`. **Step 30**
  if save size or aging cost ever bites.
