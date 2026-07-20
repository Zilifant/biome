## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–25 (Step 26 next)                                                 |
| Tests                 | 507 passing / 0 failing, 143 suites                                 |
| `PROTOCOL_VERSION`    | 24                                                                  |
| `SAVE_FORMAT_VERSION` | 23                                                                  |
| Benchmark (large-5k)  | ~80 ms/tick, 5333→7228 entities                                     |
| Git                   | Steps 22–25 are **uncommitted** (the user handles git)              |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls: `killAnimal`, `recordLifeEvent`,
`recordMemory`, `applyInjury`, `inheritGenome`, `mateQuality` /
`acceptanceThreshold` (mating/mateChoice.js), `dominanceOf` / `isKin` /
`resolveContest` (social/dominance.js — used by both mating rivalries *and*
territorial disputes), and `infect` / `recover` (disease/disease.js).

**Derive rather than store, where you can.** Dominance (Step 23) and disease
severity (Step 25) are both computed from state on read, so they cannot drift out
of step with the thing they describe. A home range (Step 24) is the same idea for
space: four numbers accumulated in place, never a trajectory.

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
out of existence (§1.4 A34). Step 25 took the lesson and implemented social
avoidance of illness as a *subtraction* — sick animals are left out of the herd's
centroid — rather than a new action. Prefer that shape.

**Fixed RNG draw budgets.** Same draws regardless of outcome. `resolveContest` is
three, always; mate assessment is zero; disease spillover is two per tick flat,
whatever the population.

**Bounded everything, and bound it explicitly.** Per-entity structures are capped
in their insert helper (memories 8, life events 12, injuries 4, tombstones 256,
metrics history 120, mate candidates 6). *Propagation* is bounded by hop counts
(herd labels, alarms — §1.4 D10). Per-animal *spatial* state is a running summary,
never a history. And anything added to a **metrics history sample** multiplies by
120 retained samples, which is why that test pins its exact key list.

**Inspection vs. bulk snapshot.** Per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only or a query. Whole
layers (the territorial claim grid) stay out of snapshots unless they earn it.
Inspection returns **copies**.

**Event volume is a real budget.** Emit on the *transition* or the *changed
verdict*, not every tick the condition holds. And when counting events in a test,
collect them tick by tick — `eventsSince` after a long `step(n)` measures what
survived the bounded outbox, not what happened (§1.4 D13).

**Tuning is measured against a control, and bisected when it breaks.** Every step
since 22 has needed a 5-seed, 15–20k-tick sweep with the new mechanism disabled
as the control. Step 24 needed more: 5/5 → 1/5, bisected factor by factor to find
one behaviour was the whole cause. Diagnose before tuning — Step 25's disease has
300+ infections and only 1–5 deaths per run, so mortality was never the lever.

**Assert invariants, not population outcomes.** §1.4 D1–D13.

## Step 26 specifics

Migration and dispersal. Groundwork in place:

- **Density now has a real cost** (disease, Step 25), which is one of the classic
  reasons to leave — and `homeRange` (Step 24) is already the "where I live"
  summary a migration would move.
- Seasons (Step 19) are the other classic driver and are already a pure function
  of the tick, so a seasonal trigger needs no new state.
- Juvenile **dispersal** already exists in name (`LifeEventTypes.DISPERSED`, when
  a juvenile outgrows its guardian) but does nothing spatial. That is the obvious
  first thread to pull.
- ⚠ Heed A34: a migration *pull* will compete with foraging exactly as `patrol`
  did. Consider making it a seasonal override of the home range rather than a
  new competing action.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ A34** (24) — patrolling is near-inert in the demo; routine site fidelity
  cost two seeds in five. Giving patrol a *reason* (a den, food worth returning
  to) is the way out.
- **⚠ A31** (23) — Step 21's selection sandbox has never demonstrated its claim;
  the test now claims no direction. An unmet **Step 21** acceptance criterion.
- **C6** (7, 23, 24) — perception and sociality each walk the same grid
  neighbourhood separately (+26 ms/tick for the second). Step 25 deliberately did
  *not* add a third. Folding the two is the clearest optimization; **Step 30**.
- **A32** (23) — juvenile defense fires about once in 12 000 ticks.
- **A37/A38/A39** (25) — disease does not cross species, its parameters are
  global rather than per species, and an environmental spillover stands in for a
  reservoir that is not simulated.
- **A35/A36** (24) — territory is a predator-only phenomenon at ~9 individuals,
  and the claim layer is not drawn on the grid.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose.
- **B3/B4/A13/A29/A30/A38** — metabolism, hydration, aging, trait spread,
  mutation, `matePreference`, `territory`, disease parameters, and
  `GESTATING_SEX` all live in global config or ad-hoc species fields rather than
  one species schema. **Step 29** unifies them.
