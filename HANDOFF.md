## State at handoff

|                       |                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Steps complete        | 1–21 (Step 22 next)                                                                                                     |
| Tests                 | 369 passing / 0 failing, 110 suites                                                                                     |
| `PROTOCOL_VERSION`    | 20                                                                                                                      |
| `SAVE_FORMAT_VERSION` | 19                                                                                                                      |
| Benchmark (large-5k)  | ~41 ms/tick, 5333→7060 entities                                                                                         |
| Git                   | committed through `step 21`; **`PLAN.md` and `README.md` have uncommitted doc-accuracy fixes** — review and commit them |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls, not a scheduled pass that hunts for
work: `killAnimal` (death.js), `recordLifeEvent`, `recordMemory`,
`applyInjury`, `inheritGenome`. Follow this rather than adding a system that
scans for newborns/corpses each tick.

**All action selection lives in `DecisionSystem`.** `flee`, `chase`, `stalk`,
`shelter`, `followParent`, `recallFood`… are all scored there; other systems
_resolve_ the chosen action. Never let a second system write `action` or
`moveIntent`.

**Fixed RNG draw budgets.** A system must consume the same number of draws
regardless of outcome, or its stream shifts and determinism breaks. Draw first,
branch after. Several tests assert stream state is identical across outcomes.

**Bounded everything.** Per-entity growable structures are hard-capped in their
_insert helper_, not by callers: memories (8), life events (12), injuries (4),
tombstones (256), metrics history (120).

**Inspection vs. bulk snapshot.** Anything per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only
(`GET /api/entities/:id`) or a query (`GET /api/metrics`). Inspection must
return **copies** — tests assert mutating a response cannot reach engine state.

**Tuning is measured, and the numbers go in the config comment.** Steps 16→18→19
each invalidated the previous step's ecological balance. Any step that changes
an energy source, a mortality source, or a food ceiling _requires_ a fresh
multi-seed sweep (5 seeds, 15–20k ticks). Do not tune from one run.

**Assert invariants, not population outcomes.** §1.4 D1–D6 records the tests
that had to be rewritten. Two recurring traps: a fixture that makes the
mechanism _unobservable_ (D5 — homozygous parents can't show recombination),
and source scans that read prose instead of code (D6).

## Step 22 specifics

The step's own carried-forward note flags **A9** (no sexes — either adult may
initiate, lower id gestates) and **A10** (`seekMate` steers toward a
conspecific but assesses nothing). Both were deliberately deferred here because
preference only means something once traits are heritable — which they now are.

The step explicitly asks you to **decide whether to introduce sexes at all**,
or keep hermaphroditic pairing and put all the pressure in preferences. That is
a design decision to make and document, not an implementation detail.

Everything needed is already in place: `entity.genome` / `entity.traits`
(Step 20), and `GET /api/metrics` reports a **selection differential** per
trait (Step 21) — that is the number that will show whether mate choice is
actually doing anything. Use it as the demonstration measurement.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **A11/A12** (13) — juvenile protection and orphan mercy; both want Step 23.
- **A19** (17) — fights as an injury source; Step 23.
- **⚠ A20** (17) — health lost to dehydration never recovers, while wounds heal.
  An asymmetry that became conspicuous once injuries could heal.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A28** (21) — bottleneck _detection_ is not implemented; the history carries
  the data, but nothing decides what counts as a crash.
- **B3/B4/A13** — metabolism, hydration, aging, trait spread and mutation all
  live in global config rather than per species. Step 29 unifies them.
