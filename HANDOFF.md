# Handoff — BEHAVIOR-PLAN P0–P3 done, start on P4

**Date:** 2026-08-05 · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `a5ea452 add handoff` (P3 uncommitted at the time of writing)

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec, it is still
accurate, and P4 is a short self-contained section in it. This file is only what a
fresh session cannot get from the plan: what the code looks like *now* that P0–P3
have landed on it, and which of my mistakes are worth not repeating.

## Where things stand

| Phase | State |
| --- | --- |
| **P0** perception restructure | ✅ committed `ae3b4e9` |
| **P1** per-species herd radius | ✅ committed `ae3b4e9` |
| **P2** affinity-weighted centroid | ✅ committed `49fa9f5` |
| **P3** association pull (A61) | ✅ **this session** |
| **P4** calf-centred centroid | ⬜ **next** |
| P5–P10 | ⬜ untouched |

Full suite: **1236 tests, 1231 pass, 0 fail, 5 cancelled**. The cancelled ones are
`presets.test.js`'s HTTP tests, which the command sandbox blocks from binding a port
(`listen EPERM`) — pre-existing, unrelated, ignore them.

⚠ Renderer fixtures are **stale** for the demo's behaviour (P1, P2 and P3 all moved
it). That regen is deliberately deferred to P10 per DOCS §12 — "regenerate after the
last behavioural change, not after the protocol change." Do not do it now.

## What P3 changed about the code P4 touches

P4 lands in the same neighbour loop as P2 and P3, so read `SocialSystem.js` before
the plan's P4 text.

**There are now four per-world resolved maps, and they all hang off one registry
check** inside `#associationsFor`
([SocialSystem.js:568](src/simulation/systems/SocialSystem.js#L568)), with thin
`#xFor(world)` readers beside it: associations, herd radii, band affinities,
association pulls. Follow that exactly — one registry check, one rebuild, so the
maps can never describe different rosters. Each has a `size === 0` early-out.

⚠ **P4 probably needs no fifth map.** `config.social.calfWeight` is a world-level
number and `guardianId !== null` is on the entity, so the whole mechanism is a
constant plus two field reads. Resist adding a species field it does not need.

**`worth` is composed, not constant, and there are now two different kinds of
number in that loop.** Per neighbour, `worth` is either the heterospecific
association weight *or* the band affinity (P2) — mutually exclusive branches on
`conspecific`. **P4's calf bonus belongs in that same slot** and multiplies into
`worth` (a calf really is worth more bodies when the centre is worked out).
⚠ **`pullScale` (P3) is the opposite case and must not be imitated**: it is a
*separate accumulator* because it is spent outside the centroid, on the herd
distance. Two rates in one product is what A61 charges twice for; a rate and a
distance are not.

**The centroid's denominator is `conspecificWeight + associateWeight`**, not a
headcount, and P4's bonus must land in **both** or the centroid is scaled away from
the origin. P1, P2 and P3 all nearly died on that; there is a regression block for
it in [`test/herding.test.js`](test/herding.test.js).

**Where `world.social` is published:**
[SocialSystem.js:525](src/simulation/systems/SocialSystem.js#L525). It now carries
`pullScale`. Adding fields there still costs **no protocol bump** — the summary is
transient and `SimulationEngine`'s inspection block enumerates `social.nearby`
field by field, so nothing leaks until you add it to *that* literal. `pullScale` is
deliberately **not** in it yet; P10 adds it.

## P4 specifics the plan gets right but understates

**The observer gate is the whole phase.** The plan says gate the bonus on the
*observer* being adult or senescent, and it is right: a dependent juvenile runs the
identical loop, so an ungated bonus makes foals weight foals 3× and adults 1× —
a self-reinforcing calf ball that drifts off the herd. It is a `lifeStage` test on
`entity`, not on `other`, and it mirrors the existing `adults` tally.

**⚠ There are two juvenile-ish predicates and they are not the same question.**
`guardianId !== null` is *dependency* (the plan's choice — it is what makes a calf a
calf), while `lifeStage === 'juvenile'` is *age*. An orphan is weaned on the spot
and keeps its lifeStage, so the two disagree exactly where it matters. Pick the
plan's and say so in the file header.

**`groupmates` and `adults` stay headcounts**, for the third phase running:
`adults` feeds collective vigilance and `mobbing.minMobbers`, so weighting it turns
a cohesion knob into a predation knob. `test/herding.test.js` has the pin.

**Claim what is measurable.** "A defensive ring falls out" is false — a weighted
mean produces a blob and nothing in this engine repels. The assertable claim is
mean calf-to-centroid < mean adult-to-centroid.

## Landmines, all of which cost me time today

- **Demo-trajectory-dependent tests break on every behaviour change, and they are
  the same two tests each time.** P1 moved seed 42's first carcass theft out of a
  fixed window and both tests moved to seed 2; **P3 moved seed 2 out and pulled 42
  back in**, so both moved back. Re-measured 2026-08-05 with P3 landed, first theft
  by seed: 42→971, 1→1297, 2→1901, 3→311, 7→392, 13→1355 — every seed steals, 8–16
  times inside 3000 ticks. **The failure mode is *late*, never absent.** When one
  fails, re-measure that row before concluding anything is broken. The two files are
  [`test/groups.test.js`](test/groups.test.js) and
  [`test/protocol-v29.test.js`](test/protocol-v29.test.js); the measurement lives
  beside each.
- **Mutation-test every new assertion, and make the numbers in a fixture
  *different*.** Ten deliberate breakages were run against P3's tests and all ten
  fail at least one. ⚠ One of them — reading the association *weight* where the code
  should read the *pull* — is undetectable unless the test species declares two
  **different** values, because the two live in the same loop over the same species
  ids. `HOLDER` in `association.test.js` declares weight 0.5 and pull 0.4 for
  exactly that reason; it is the same hazard `MIXER` exists for in P2.
- **A 0/0 is not a crash here, it is a silent behaviour deletion.** `NaN` in a
  utility loses every `argmaxUtility` comparison (`NaN > x` is false), so the action
  is never chosen again, nothing throws, and the inspector shows `null`. P4 has no
  division, but P7's `clamp01(undefined)` is the same shape and worse.
- **Measure with entity counts matched.** 450 demo ticks, five interleaved rounds,
  and discard round 1 (JIT). P3's own machinery came out *negative* (the on arm
  faster) — a behaviour difference, not a cost difference — while the wildebeest's
  new association is a real ~+3.5%.
- ⚠ `perl -0pi -e 's/…/…/'` without `/g` replaces **only the first match**.
- ⚠ `git checkout <file>` cannot restore an **untracked** file. Use a copy.

## Test workflow

```bash
npm run test:fast   # ~5 min — use this in the edit loop
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

- **The wildebeest now associates with the zebra**, which is a real change to the
  demo's trajectory and the reason the theft seeds moved. It declares **no**
  `associationPull`, deliberately: it is P3's in-roster control arm, and the pair of
  species either side of that field is what says the two are separable. Do not
  "finish the job" by giving it one without measuring.
- **P3 only bites where an animal is actually standing in mixed company**, exactly
  as P2 only bites where bandmates are in sight. Neither brings anybody back; that
  is P7's rally drift.
- **A61 is answered** (DOCS §1 and §9, ACTION-ITEMS). **A56** is P5a, **A43** is
  partly answered by P2's two-bands test and is scheduled to close at P10.
- **Two tests were deleted at the user's instruction** and their coverage is gone:
  determinism through the **age-death** path, and the **no-timer** tripwire
  (invariant 9 is now stated but unenforced). Notes sit where each test was.
- **Nine determinism guards are byte-for-byte the same test** in nine files. Kept
  because each names its own system in the failure message, but they add nothing
  over `determinism.test.js`'s baseline. First place to cut if the suite needs it.
- `src/simulation/social/banding.js` and `herding.js` are the two new social
  modules; `association.js` is the third, now holds P3's `associationPull` readers,
  and is the one to imitate.
