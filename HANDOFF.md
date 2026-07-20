## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–27 (Step 28 next)                                                 |
| Tests                 | 561 passing / 0 failing, 153 suites                                 |
| `PROTOCOL_VERSION`    | 26                                                                  |
| `SAVE_FORMAT_VERSION` | 25                                                                  |
| Benchmark (large-5k)  | ~80 ms/tick, 5333→7200 entities                                     |
| Git                   | Steps 26–27 are **uncommitted** (the user handles git)              |

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

⚠ **A helper with a threshold silently discards sub-threshold input.** New in
Step 27 (§1.4 D17) and the nastiest bug of the last two steps: `applyInjury`
drops anything at or below `HEALED_BELOW` (0.02), so a fire applying a
plausible-looking 0.006 per tick recorded **no wounds at all** while still
killing animals through a separate health drain. Before feeding a small
per-tick rate into an accumulator helper, check its floor — and when adding a
caller, assert the *effect landed*, not that the call happened.

**Derive rather than store, where you can.** Dominance (23), disease severity
(25), the `dispersing` flag (26), and every disturbance effect (27) are computed
on read. A disturbance is the strongest case: because slow ground and cold air
are *derived from an active record*, a flood that expires needs no un-flooding
pass and cannot leave the world half-changed. A home range (24) is the same idea
for space — four numbers, never a trajectory — which is also why Step 26 declined
to add "remembered routes" (§1.4 A40).

⚠ **Terrain is derived and unsaved.** It regenerates from the seed on load, so
nothing may mutate it — an edit vanishes on the next restore. Step 27 wanted
"affected terrain" and expressed it as a derived traversal penalty plus a
renderer overlay instead (§1.4 A45). Anything Step 28 wants to *engineer* into
the ground faces the same constraint.

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
out of existence (§1.4 A34). **Steps 25, 26, and 27 all added no action at
all**: disease avoidance is a *subtraction* (sick animals leave the herd
centroid), migration is a *bias on the heading `wander` would have picked
anyway*, and disturbances give the *existing* drift and danger-memory machinery
a reason to fire. Three steps running, the answer has been to give existing
behaviour a cause rather than to add behaviour. Prefer that.

**Fixed RNG draw budgets.** Same draws regardless of outcome. `resolveContest` is
three, always; mate assessment is zero; disease spillover is two per tick flat;
migration is zero; a disturbance ignition check is five, spent *before* the
early-returns so a full active list cannot change the stream.

**Bounded everything, and bound it explicitly.** Per-entity structures are capped
in their insert helper (memories 8, life events 12, injuries 4, tombstones 256,
metrics history 120, mate candidates 6); active disturbances are capped at 3.
*Propagation* is bounded by hop counts (herd labels, alarms — §1.4 D10).
Per-animal *spatial* state is a running summary, never a history. And anything
added to a **metrics history sample** multiplies by 120 retained samples, which
is why that test pins its exact key list.

**Inspection vs. bulk snapshot.** Per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only or a query. Whole
*layers* (the territorial claim grid) stay out of snapshots unless they earn it —
but a bounded list of **circles** is not a layer, which is how disturbances ride
in every message. Inspection returns **copies**.

**Event volume is a real budget.** Emit on the *transition* or the *changed
verdict*, not every tick the condition holds — a disturbance costs exactly two
events for its whole life. And when counting events in a test, collect them tick
by tick; `eventsSince` after a long `step(n)` measures what survived the bounded
outbox, not what happened (§1.4 D13).

⚠ **Five seeds cannot resolve a one-seed difference** (§1.4 D14). The demo's
two-species balance is a knife edge at ~3–9 stalkers. Step 26 measured 3/5
against a 4/5 control and would have been ramped down for it; at ten seeds both
read 4/10. Add seeds before touching a parameter, and treat a **non-monotonic
bisection as proof you are tuning noise**. Every mechanism since 26 ships an
`enabled` config switch so the control is reproducible rather than
hand-assembled; Step 27 added a `kinds` list too, which is what made per-kind
attribution possible. Do the same for the next one.

**Before asserting an outcome, ask what the control would score** (§1.4 D15). If
the control scores the same, the test measures the world rather than the change.
Prefer asserting the mechanism over the outcome it accumulates into.

⚠ **For a mechanism whose visible result is *recovery*, the quiet interval is
part of the design** (§1.4 D18). Step 27's first parameters left something
running 91% of ticks — not just too much pressure, but a world where nothing ever
finished recovering, so the acceptance criterion could not be observed. Check
"what fraction of the time is this running?" before tuning severity.

**Assert invariants, not population outcomes.** §1.4 D1–D18.

## Step 28 specifics

Ecosystem engineering — animals that change the world rather than only living in
it (dams, wallows, burrows, grazing lawns). Groundwork in place:

- **Step 27 built the pattern this needs.** A bounded record whose effects are
  derived on read, layered over static terrain, projected as its own protocol
  block. An engineered structure is the same shape with one difference: it
  **persists** rather than expiring, so the lifecycle is "built → maintained →
  decays when unmaintained" instead of "started → ended".
- The `disturbance` layer already proves derived effects can reach the two hot
  chokepoints (`world.speedModifierAt`, `thermalStress`) without any system
  learning what caused them. A dam that slows movement or a burrow that shelters
  would use the same seams.
- Vegetation already has per-cell **capacity** separate from biomass, which is
  the natural lever for a grazing lawn or an enriched patch — change what the
  land can hold, not just what is on it.
- ⚠ Terrain cannot be modified (A45). If Step 28 wants genuinely permanent
  terrain change, that is a decision to make terrain saved state, and it should
  be made deliberately rather than discovered.
- ⚠ Heed A34/D14: if engineering needs animals to *seek* a structure, bias an
  existing behaviour rather than adding an action, and measure on ten seeds.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ A31** (21) — Step 21's selection sandbox has never demonstrated its claim;
  the test now claims no direction. An unmet **Step 21** acceptance criterion.
- **⚠ A34** (24) — patrolling is near-inert in the demo (`patrolSpanFactor` is
  **6**, so it effectively never fires). Step 26 briefly wrote a fix for a
  problem it assumed patrol was causing before discovering this; check the ramp
  before theorizing about site fidelity.
- **C6** (7, 23, 24) — perception and sociality each walk the same grid
  neighbourhood separately (+26 ms/tick for the second). Steps 25, 26, and 27 all
  deliberately declined to add a third (migration samples the vegetation field
  with O(1) reads; disturbance affliction is O(animals × active)). Folding the
  two is the clearest optimization; **Step 30**.
- **A44/A45/A46** (27) — drought and severe winter stay *global* weather rather
  than becoming local disturbances; terrain is never modified; disturbance
  mortality is rare in the demo by design.
- **A40/A41/A42/A43** (26) — no remembered routes (a route is a trajectory);
  migration is grazer-only; the forage cue deliberately reaches beyond perception
  as a stated stand-in for long-range cues; fragmentation is enabled but not
  asserted.
- **A32** (23) — juvenile defense fires about once in 12 000 ticks.
- **A37/A38/A39** (25) — disease does not cross species, its parameters are
  global rather than per species, and an environmental spillover stands in for a
  reservoir that is not simulated.
- **A35/A36** (24) — territory is a predator-only phenomenon at ~9 individuals,
  and the claim layer is not drawn on the grid.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose (and Step 26 deliberately
  does *not* disperse orphans, for the same reason).
- **B3/B4/A13/A29/A30/A38/A41** — metabolism, hydration, aging, trait spread,
  mutation, `matePreference`, `territory`, disease parameters, `migration`, and
  `GESTATING_SEX` all live in global config or ad-hoc species fields rather than
  one species schema. **Step 29** unifies them; it has six blocks to absorb.
  (Disturbances are *world* state, not biology, so they add nothing to that
  pile.)
