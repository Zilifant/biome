## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–23 (Step 24 next)                                                 |
| Tests                 | 448 passing / 0 failing, 129 suites                                 |
| `PROTOCOL_VERSION`    | 22                                                                  |
| `SAVE_FORMAT_VERSION` | 21                                                                  |
| Benchmark (large-5k)  | ~72 ms/tick, 5333→7184 entities                                     |
| Git                   | Steps 22 and 23 are **uncommitted** (the user handles git)          |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls, not a scheduled pass that hunts for
work: `killAnimal`, `recordLifeEvent`, `recordMemory`, `applyInjury`,
`inheritGenome`, `mateQuality`/`acceptanceThreshold` (mating/mateChoice.js), and
`dominanceOf`/`isKin`/`resolveContest` (social/dominance.js).

**All action selection lives in `DecisionSystem`.** `flee`, `chase`, `stalk`,
`shelter`, `followParent`, `seekMate`, `herd`, `defend`… are all scored there;
other systems _resolve_ the chosen action. Never let a second system write
`action` or `moveIntent`.

⚠ **`#intentFor` is a `switch` with fallthrough groups.** Adding a bare `case`
in the middle of one silently redirects everything above it (§1.4 D9 — it cost
five suites and an hour). Add new cases *before* a group, never inside it.

**Fixed RNG draw budgets.** A system must consume the same number of draws
regardless of outcome. Draw first, branch after. `resolveContest` is three,
always; mate assessment is zero (a test asserts rejecting and accepting leave
every stream identical).

**Bounded everything, and bound it explicitly.** Per-entity structures are capped
in their _insert helper_: memories (8), life events (12), injuries (4),
tombstones (256), metrics history (120), mate candidates (6). Since Step 23 the
same applies to *propagation*: herd labels and alarms both carry a hop count from
their source and die at a cap. §1.4 D10 — a local mechanism without an explicit
bound goes global, and population density is not a bound.

**Inspection vs. bulk snapshot.** Anything per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only or a query.
Inspection must return **copies**.

**Event volume is a real budget.** Two steps in a row needed the same fix: emit
on the *transition* or the *changed verdict*, not every tick the condition holds
(`entity.courted`, `entity.alarmed`).

**Tuning is measured, against a control.** Any step touching an energy source, a
mortality source, a food ceiling, or a breeding rate needs a fresh 5-seed,
15–20k-tick sweep **with the new mechanism disabled as a control** — that
comparison is what told Steps 22 and 23 which parameters to pick, and in Step 23
it revealed sociality *stabilises* the ecology (5/5 seeds vs 3/5), which was the
opposite of the prediction.

**Assert invariants, not population outcomes.** §1.4 D1–D10. The traps that have
actually bitten: a fixture that makes the mechanism unobservable (D5), source
scans reading prose (D6), a fixture that never applied the pressure it claimed
and passed on a lucky seed (D7, and see A31 below), and severed `switch`
fallthrough (D9).

## Step 24 specifics

Territories and home ranges, emerging from spatial history — not a prescribed
map. Most of the machinery now exists:

- `groupId`, `dominanceOf`, and `resolveContest` are what a territorial dispute
  is made of; contests already handle "two animals want the same thing".
- `world.social` is the transient-summary seam a home-range summary sits beside
  (copy the `world.perception` / `world.social` pattern).
- Step 15's bounded spatial memory is the obvious substrate for repeated-use
  areas — but note it remembers *places*, not animals.
- **A32**: juvenile defense fires about once in 12 000 demo ticks because the
  geometry it needs is rare. Territory may fix that for free by keeping families
  in one place; if not, the named lever is relaxing "my calf is nearer the
  predator than I am" to "near enough to interpose".

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ A31** (23) — **Step 21's selection sandbox has never demonstrated its
  claim.** Measured over seven seeds the trait moves up in 3 and down in 4
  (mean −0.0002), and the selection differential is negative in five with its
  sign uncorrelated with the outcome. Cause: the differential compares breeders
  against *all* adults and 71% of adults are breeders there, so the two samples
  are nearly the same set; tightening the breeding gate makes it visible but
  drives the population extinct. The test now claims no direction. This is an
  unmet **Step 21** acceptance criterion and wants a purpose-built world.
- **⚠ A20** (17) — health lost to dehydration never recovers, while wounds heal.
- **C6** (7, 23) — perception and sociality each walk the same grid
  neighbourhood separately (+26 ms/tick at large-5k for the second one). Folding
  them into one loop is the single clearest optimization available; **Step 30**.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose so Step 23 did not move
  juvenile survival by three mechanisms at once.
- **A33** (23) — no mobbing; cooperative defense is vigilance plus an
  interposing parent.
- **B3/B4/A13/A29/A30** — metabolism, hydration, aging, trait spread, mutation,
  `matePreference`, and `GESTATING_SEX` all live in global config or ad-hoc
  species fields rather than one species schema. **Step 29** unifies them.
