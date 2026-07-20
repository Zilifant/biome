## State at handoff

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| Steps complete        | 1–22 (Step 23 next)                                                 |
| Tests                 | 406 passing / 0 failing, 119 suites                                 |
| `PROTOCOL_VERSION`    | 21                                                                  |
| `SAVE_FORMAT_VERSION` | 20                                                                  |
| Benchmark (large-5k)  | ~46 ms/tick, 5333→7233 entities                                     |
| Git                   | committed through `step 21`; **Step 22's work is uncommitted**      |

Verify with: `npm test`, `npm run benchmark`, `npm run headless -- --ticks=2000 --seed=42`.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

**Shared mutation helpers, not systems.** Things that happen at one _instant_
live in a module the owning system calls, not a scheduled pass that hunts for
work: `killAnimal` (death.js), `recordLifeEvent`, `recordMemory`,
`applyInjury`, `inheritGenome`, and now `mateQuality` / `acceptanceThreshold`
(mating/mateChoice.js). Follow this rather than adding a system that scans for
newborns/corpses/couples each tick.

**All action selection lives in `DecisionSystem`.** `flee`, `chase`, `stalk`,
`shelter`, `followParent`, `recallFood`, `seekMate`… are all scored there; other
systems _resolve_ the chosen action. Never let a second system write `action` or
`moveIntent`.

**Fixed RNG draw budgets.** A system must consume the same number of draws
regardless of outcome, or its stream shifts and determinism breaks. Draw first,
branch after. Several tests assert stream state is identical across outcomes —
including mate choice, whose budget is *zero* (quality is a pure function of
traits and condition).

**Bounded everything.** Per-entity growable structures are hard-capped in their
_insert helper_, not by callers: memories (8), life events (12), injuries (4),
tombstones (256), metrics history (120), perceived mate candidates (6).

**Inspection vs. bulk snapshot.** Anything per-tick and cheap goes in
`PUBLIC_ENTITY_FIELDS`; everything else is inspection-only
(`GET /api/entities/:id`) or a query (`GET /api/metrics`). Inspection must
return **copies** — tests assert mutating a response cannot reach engine state.

**Event volume is a real budget.** Step 22's first cut emitted one
`entity.courted` per assessment and produced ~1.7 events/tick; it now reports
only a new candidate or a changed verdict (20× less). If you add an event that
fires while two animals are merely co-located, ask what it costs per tick.

**Tuning is measured, and the numbers go in the config comment.** Steps 16→18→19
each invalidated the previous step's ecological balance, and Step 22 invalidated
Step 21's *test*. Any step that changes an energy source, a mortality source, a
food ceiling, or a breeding rate _requires_ a fresh multi-seed sweep (5 seeds,
15–20k ticks). Do not tune from one run. **Sweep against a control** with the new
mechanism disabled — that comparison is what told Step 22 which patience value
to pick.

**Assert invariants, not population outcomes.** §1.4 D1–D8 records the tests that
had to be rewritten. The recurring traps: a fixture that makes the mechanism
_unobservable_ (D5 — homozygous parents can't show recombination), source scans
that read prose instead of code (D6), and — the sharpest one — a fixture that was
never applying the pressure it claimed and passed on drift because it was pinned
to a lucky seed (D7). When a seeded assertion breaks, diagnose the *mechanism*
before re-pinning the seed.

## Step 23 specifics

Social behaviour: conspecific attraction, herding, group movement, alarm,
dominance, kin recognition, cooperative defense. Several threads converge here.

- **A11/A12** (13) — juvenile *protection* and orphan mercy were both explicitly
  deferred to this step. A parent that fought or interposed belongs with fights.
- **A19** (17) — fights are still not an injury source; failed hunts remain the
  only writer. `applyInjury` is the seam.
- **A15** (15) — kin *recognition* has never had a reader. Step 22 confirmed it
  still doesn't: mate choice never has to avoid relatives. Social groups (or
  inbreeding avoidance) would be the first.
- `sex` now exists and is projected, which dominance and mating competition are
  the obvious consumers of.
- `world.perception` already carries `animalCount`, `nearestAnimal`, and a
  bounded `mateCandidates` list — a groups pass wants something similar, built in
  the same neighbour loop rather than a second scan.

## Things deliberately left undone

Recorded in `PLAN.md` §1.4 with reasoning; the ones most likely to matter next:

- **⚠ A20** (17) — health lost to dehydration never recovers, while wounds heal.
  An asymmetry that became conspicuous once injuries could heal.
- **A22** (18) — tombstones bounded at 256, so ancestry cannot be walked far.
- **A28** (21) — bottleneck _detection_ is not implemented; the history carries
  the data, but nothing decides what counts as a crash.
- **A29/A30** (22) — mate preference *direction* is species data and only its
  strength is heritable (so no Fisherian runaway); `GESTATING_SEX` is one
  model-wide constant rather than per-species data.
- **B3/B4/A13** — metabolism, hydration, aging, trait spread, mutation, and now
  `matePreference` all live in global config or ad-hoc species fields rather
  than one species schema. Step 29 unifies them.
