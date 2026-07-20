## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–26 (Step 27 next)                                                 |
| Tests                 | 535 passing / 0 failing, 149 suites                                 |
| `PROTOCOL_VERSION`    | 25                                                                  |
| `SAVE_FORMAT_VERSION` | 24                                                                  |
| Benchmark (large-5k)  | ~79 ms/tick, 5333→7219 entities                                     |
| Git                   | Step 26 is **uncommitted** (the user handles git)                   |

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

**Derive rather than store, where you can.** Dominance (23), disease severity
(25), and the `dispersing` flag (26) are all computed on read, so they cannot
drift out of step with the thing they describe. A home range (24) is the same
idea for space: four numbers accumulated in place, never a trajectory — and
Step 26 declined to add "remembered routes" for exactly that reason (§1.4 A40).

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
out of existence (§1.4 A34). **Steps 25 and 26 both took the lesson and added no
action at all**: disease avoidance is a *subtraction* (sick animals are left out
of the herd centroid) and migration is a *bias on the heading `wander` was going
to pick anyway*. Prefer those shapes over a new entry in the utility table.

**Fixed RNG draw budgets.** Same draws regardless of outcome. `resolveContest` is
three, always; mate assessment is zero; disease spillover is two per tick flat;
**migration is zero** — sampling is deterministic and a dispersal heading is
geometry.

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

⚠ **Five seeds cannot resolve a one-seed difference.** New in Step 26 (§1.4 D14)
and the most expensive thing on this list. The demo's two-species balance is a
knife edge at ~3–9 stalkers. Step 26 measured **3/5 against a 4/5 control** and
would have been ramped down for it; bisecting the strength gave 1/5, 2/5, 3/5,
3/5 — *non-monotonic*, which is the tell that you are tuning noise. At **ten**
seeds both configurations read 4/10. Add seeds before touching a parameter.
There is a `migration.enabled` config switch precisely so the control is
reproducible rather than hand-assembled; do the same for the next mechanism.

**Before asserting an outcome, ask what the control would score** (§1.4 D15). If
the control scores the same, the test is measuring the world rather than the
change. Prefer asserting the mechanism over the outcome it accumulates into —
Step 26 ships "the distribution of chosen headings" instead of "where the animals
ended up", because the displacement is real but small.

**Assert invariants, not population outcomes.** §1.4 D1–D16.

## Step 27 specifics

Local disturbances — bounded events (drought, fire, flood, storm, severe winter)
that sweep a region, hurt it, and let it recover. Groundwork in place:

- **Recovery is already solved.** Step 26's forage gradient means animals drift
  *off* low-forage ground and back onto ground that has regrown, with no
  recolonization code to write. A burnt patch should need only to lower biomass;
  the response is emergent. This is the strongest reason Step 27 follows 26.
- Weather (19) already draws stochastic spells with season-dependent odds and is
  the obvious model to copy for a disturbance's arrival and duration.
- The vegetation field already has a per-cell capacity separate from biomass, so
  a fire can burn standing crop without permanently changing what the land can
  hold — or change both, if a disturbance should scar.
- ⚠ Hazards are still **not** an injury source (§1.4 A19 records the partial
  close — fights are, hazards are not). A disturbance that hurts animals would be
  the natural writer.
- ⚠ Heed A34/D14 both: if a disturbance needs animals to *flee* it, prefer
  biasing an existing behaviour over adding an action, and measure on ten seeds.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ A31** (21) — Step 21's selection sandbox has never demonstrated its claim;
  the test now claims no direction. An unmet **Step 21** acceptance criterion.
- **⚠ A34** (24) — patrolling is near-inert in the demo (`patrolSpanFactor` is
  **6**, so it effectively never fires). Step 26 briefly wrote a fix for a
  problem it assumed patrol was causing before discovering this; check the
  ramp before theorizing about site fidelity.
- **C6** (7, 23, 24) — perception and sociality each walk the same grid
  neighbourhood separately (+26 ms/tick for the second). Steps 25 and 26 both
  deliberately declined to add a third (migration samples the vegetation field
  with O(1) reads and touches no spatial query). Folding the two is the clearest
  optimization; **Step 30**.
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
  one species schema. **Step 29** unifies them; it now has six blocks to absorb.
