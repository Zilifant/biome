# Handoff — BEHAVIOR-PLAN P0–P2 done, start on P3

**Date:** 2026-08-05 · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `49fa9f5 P2`

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec, it is still
accurate, and P3 is a self-contained section in it. This file is only what a fresh
session cannot get from the plan: what the code looks like *now* that P0–P2 have
landed on it, and which of my mistakes are worth not repeating.

## Where things stand

| Phase | State |
| --- | --- |
| **P0** perception restructure | ✅ committed `ae3b4e9` |
| **P1** per-species herd radius | ✅ committed `ae3b4e9` |
| **P2** affinity-weighted centroid | ✅ committed `49fa9f5` |
| **P3** association pull | ⬜ **next** |
| P4–P10 | ⬜ untouched |

Working tree is clean apart from this file. Full suite: **1218 tests, 1213 pass,
0 fail**. The 5 cancelled tests in `presets.test.js` are HTTP tests the command
sandbox blocks from binding a port — pre-existing, unrelated, ignore them.

⚠ Renderer fixtures are **stale** for the demo's behaviour (P1 and P2 both moved
it). That regen is deliberately deferred to P10 per DOCS §12 — "regenerate after
the last behavioural change, not after the protocol change." Do not do it now.

## What P0–P2 changed about the code P3 touches

P3 lands in the same neighbour loop as P2, so read `SocialSystem.js` before the
plan's P3 text — the file has moved under it.

**There are now three per-world resolved maps, and P3 adds a fourth.** All are
cached against `world.species` inside `#associationsFor`
([SocialSystem.js:493](src/simulation/systems/SocialSystem.js#L493)), with thin
`#xFor(world)` readers beside it. Follow that exactly: one registry check, one
rebuild, so the maps can never describe different rosters. Each has a
`size === 0` early-out that costs a world declaring nothing a single comparison.

**`worth` is now composed, not constant.** Per neighbour it is either the
heterospecific association weight *or* the band affinity (P2), never both —
they are mutually exclusive branches on `conspecific`. P3's pull weight is a
**fourth number that must not join that chain**: it is a separate accumulator, not
another thing multiplied into `worth`. Two rates in one product is exactly what
A61 charges twice for.

**The centroid's denominator is `conspecificWeight + associateWeight`**, not a
headcount. P1 and P2 both nearly died on that; there is a regression block for it
in [`test/herding.test.js`](test/herding.test.js). `pullScale` must be built from
the *same* weights or it will disagree with the centroid it describes.

**Where `world.social` is published:**
[SocialSystem.js:458](src/simulation/systems/SocialSystem.js#L458). Adding
`pullScale` there costs **no protocol bump** — the summary is transient and
`SimulationEngine`'s inspection block enumerates `social.nearby` field by field,
so nothing leaks until you add it to *that* literal.

## P3 specifics the plan gets right but understates

**Both readers of `herdDistance` must move together — there are exactly two:**

- [DecisionSystem.js:629-630](src/simulation/systems/DecisionSystem.js#L629) — the
  `herd` utility (the gate `drift > herdDistance` **and** the ramp denominator)
- [DecisionSystem.js:1139](src/simulation/systems/DecisionSystem.js#L1139) — the
  `cohesion` term inside `#intentFor`'s `herd` case

Miss the second and the animal decides to close up using one distance and steers
using another. That is a D11 split-brain, and it will not fail a test — it will
just make herding subtly wrong.

⚠ **`herdDistance` also has a constructor default** (line 176) used as the
unknown-species fallback. It is not a species value; do not scale it there.

**The NaN path the plan warns about is real and silent.** `pullScale = pullSum /
weight` is `0/0` when an animal is alone. `NaN` propagates into `utilities.herd`,
`argmaxUtility` compares with `>`, `NaN > x` is false — so `herd` is **never
chosen**, no crash, and the inspector shows `null`. Publish `1` when
`weight === 0` and assert it directly.

**`associationPull` is an always-per-species FIELD, not a `behavior` key.** It
mirrors `association`. Add it to the field list in the
[`schema.js`](src/simulation/config/species/schema.js) header comment — that list
is documentation the next person will trust.

## Landmines, all of which cost me time today

- **Demo-trajectory-dependent tests break on every behaviour change.** P1 moved
  seed 42's first carcass theft from tick <1500 to 1682 and broke two tests that
  fish for an emergent event in a fixed window; both moved to seed 2 with the
  per-seed measurements recorded in place. **Expect P3 to break more of these.**
  When one fails, first check whether the *mechanism* still works at a longer
  horizon before concluding anything is broken.
- **P2 surfaced a latent bug this way**: `killAnimal` had never cleared `flying`,
  so a bird that died airborne stayed a flying carcass in every bulk snapshot.
  Fixed in [`death.js`](src/simulation/systems/death.js). If a seemingly unrelated
  invariant test fails, it may be an old bug the new trajectory finally reached.
- **Mutation-test every new assertion.** I did this for P2 and one of my four
  checks passed against a broken engine — a heterospecific with no declared
  association is dropped on the species comparison before a band weight could
  reach it, so only a species declaring *both* rates can catch that collision.
  `MIXER` in `herding.test.js` exists for exactly that. P3 has the same hazard
  shape: pull and centroid weight share a slot.
- ⚠ `perl -0pi -e 's/…/…/'` without `/g` replaces **only the first match** — I
  mutated the wrong branch and briefly believed my tests were weak.
- ⚠ `git checkout <file>` cannot restore an **untracked** file. Use a copy.
- **Measure before the arms diverge.** A 2000-tick A/B on the demo measures two
  *different worlds*, not two code paths. P1's cost read +21% that way and +9.7%
  over 400 ticks with entity counts matched — and a non-monotonic row (radius 10
  slower than 11) was the tell. `BENCHMARK.md` has the write-up.

## Test workflow

```bash
npm run test:fast   # ~5 min, 1043 tests — use this in the edit loop
npm test            # ~10 min, everything — before committing
```

`test:fast` skips demo/persistence/determinism suites and the `*.slow.test.js`
files. ⚠ `--test-skip-pattern` is **silently ignored if it comes after the file
arguments**; the npm script has the order right, don't reshuffle it.

New size-independent guards should use
[`test/helpers/smallDemo.js`](test/helpers/smallDemo.js) (~3.9× faster) — but read
its header: legitimate for determinism and round-trip claims, **never** for
ecological ones, where the demo *is* the claim.

## Open threads

- **P2 only bites where bandmates are already in sight.** It makes a band that is
  together stay together and does nothing to bring a scattered one back — that is
  P7's rally drift. Stated in DOCS §9; don't let it read as a defect of P2.
- **Two tests were deleted at the user's instruction** and their coverage is gone:
  determinism through the **age-death** path, and the **no-timer** tripwire
  (invariant 9 is now stated but unenforced). Notes sit where each test was.
- **Nine determinism guards are byte-for-byte the same test** in nine files. Kept
  because each names its own system in the failure message, but they add nothing
  over `determinism.test.js`'s baseline. First place to cut if the suite needs it.
- **A43** (population fragmentation asserted, not just enabled) is partly answered
  by P2's two-bands test. The plan schedules closing it at P10.
- `src/simulation/social/banding.js` and `herding.js` are the two new social
  modules; `association.js` is the third and the one to imitate for P3.
