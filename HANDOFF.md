## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–24 (Step 25 next)                                                 |
| Tests                 | 480 passing / 0 failing, 136 suites                                 |
| `PROTOCOL_VERSION`    | 23                                                                  |
| `SAVE_FORMAT_VERSION` | 22                                                                  |
| Benchmark (large-5k)  | ~74 ms/tick, 5333→7205 entities                                     |
| Git                   | Steps 22, 23 and 24 are **uncommitted** (the user handles git)      |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls: `killAnimal`, `recordLifeEvent`,
`recordMemory`, `applyInjury`, `inheritGenome`, `mateQuality` /
`acceptanceThreshold` (mating/mateChoice.js), and `dominanceOf` / `isKin` /
`resolveContest` (social/dominance.js — used by *both* mating rivalries and
territorial disputes).

**All action selection lives in `DecisionSystem`.** `flee`, `chase`, `stalk`,
`shelter`, `followParent`, `seekMate`, `herd`, `defend`, `patrol`, `retreat` are
all scored there; other systems _resolve_ the chosen action. Never let a second
system write `action` or `moveIntent`.

⚠ **`#intentFor` is a `switch` with fallthrough groups.** Adding a bare `case`
in the middle of one silently redirects everything above it (§1.4 D9 — five
suites, one hour). Add new cases *before* a group, never inside it. A `NaN`
heading fails the passability check, so the symptom is "chose the right action,
stood perfectly still" — and `JSON.stringify(NaN)` prints `null`.

**Fixed RNG draw budgets.** Same number of draws regardless of outcome.
`resolveContest` is three, always; mate assessment is zero. Tests assert streams
are identical across outcomes.

**Bounded everything, and bound it explicitly.** Per-entity structures are capped
in their insert helper: memories (8), life events (12), injuries (4), tombstones
(256), metrics history (120), mate candidates (6). Propagation is bounded too —
herd labels and alarms carry a hop count from their source and die at a cap
(§1.4 D10). And per-animal *spatial* state is a running summary, never a history:
`homeRange` is four numbers no matter how long the animal lives.

**Inspection vs. bulk snapshot.** Per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only or a query.
Inspection returns **copies**. Whole layers (the territorial claim grid) stay out
of snapshots entirely unless they earn the per-tick cost.

**Event volume is a real budget.** Emit on the *transition* or the *changed
verdict*, not every tick the condition holds (`entity.courted`,
`entity.alarmed`).

**Tuning is measured, against a control — and bisected when it breaks.** Any
step touching an energy source, a mortality source, a food ceiling, a breeding
rate, or *where animals go* needs a fresh 5-seed, 15–20k-tick sweep with the new
mechanism disabled as a control. Step 24 needed more than that: it went 5/5 →
1/5 and had to be bisected factor by factor to find that a single behaviour
(`patrol`) was the whole cause. Bisect before tuning.

**Assert invariants, not population outcomes.** §1.4 D1–D12. The traps that have
bitten: a fixture that makes the mechanism unobservable (D5), source scans
reading prose (D6), a fixture that never applied the pressure it claimed (D7),
severed `switch` fallthrough (D9), a threshold set equal to the value it
thresholds (D11), and comparing stochastic outcomes across two runs that diverge
from tick one (D12).

## Step 25 specifics

Simplified disease or parasites. Useful groundwork already in place:

- **Contact structure exists**: `world.social` gives groupmates in range each
  tick, and the territorial claim layer is already a map of who spends time
  where — between them that is most of a contact network, without a new scan.
- `applyInjury` / `impairment` is the model to copy for a bounded, healing
  condition; `health` and the `health <= 0` death path already exist.
- **⚠ A20** is directly relevant and still open: health lost to dehydration never
  recovers while wounds heal. A disease/recovery pass is the natural place to
  fix that asymmetry rather than adding a third recovery model beside it.
- Watch the ecology. Three steps running have shifted it, and stalkers (~9
  individuals) are the fragile side of it every time.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ A34** (24) — **patrolling is near-inert in the demo.** Routine site
  fidelity competes with the wandering animals need to find food, and cost two
  seeds in five. The pull now ramps over six range radii so it fires only for an
  animal that is genuinely lost. Giving patrol a *reason* (a den, food worth
  returning to) rather than making it compete with foraging is the way out.
- **⚠ A31** (23) — Step 21's selection sandbox has never demonstrated its claim;
  the test now claims no direction. An unmet **Step 21** acceptance criterion.
- **⚠ A20** (17) — dehydration damage never heals while wounds do.
- **C6** (7, 23, 24) — perception and sociality each walk the same grid
  neighbourhood separately (+26 ms/tick for the second). Folding them into one
  loop is the clearest optimization available; **Step 30**.
- **A32** (23) — juvenile defense fires about once in 12 000 ticks. Step 24 did
  not fix it as hoped, because grazers turned out not to afford site fidelity.
- **A35/A36** (24) — territory is a predator-only phenomenon at ~9 individuals,
  and the claim layer is not drawn on the grid.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A12** (13) — orphan mercy, left alone on purpose.
- **B3/B4/A13/A29/A30** — metabolism, hydration, aging, trait spread, mutation,
  `matePreference`, `territory`, and `GESTATING_SEX` all live in global config or
  ad-hoc species fields rather than one species schema. **Step 29** unifies them.
