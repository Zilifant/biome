# Handoff — BEHAVIOR-PLAN P0–P5 done, P6 skipped, start on P7

**Date:** 2026-08-05 · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `ad0130e` (P4; committed as "P3") — P5 uncommitted at the time of writing

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec and it is still
accurate. ⚠ P7 is the phase with the **most ways to go wrong**: two new entity
fields that are deliberately *not* persisted, a NaN path that parks an animal at
NaN forever, and a dispersal interaction that would undo A64 at the movement layer.
Its prerequisite (P5a) is now in. This file is only what a fresh session cannot get
from the plan.

## Where things stand

| Phase | State |
| --- | --- |
| **P0** perception restructure | ✅ committed `ae3b4e9` |
| **P1** per-species herd radius | ✅ committed `ae3b4e9` |
| **P2** affinity-weighted centroid | ✅ committed `49fa9f5` |
| **P3** association pull (A61) | ✅ committed `b413449` |
| **P4** calf-centred centroid | ✅ committed `ad0130e` — **shipped at its identity, on purpose** (below) |
| **P5** A56 hysteresis, registry capacity, buffalo cow–calf core | ✅ this session — **A56 closed**, save format v32 |
| **P6** bachelor bulls | ⛔ **skipped by decision** (2026-08-05) — a dispersed bull staying loosely with the local buffalo through the herd label is an acceptable bachelor. The plan section is kept, marked, with what it gives up stated |
| **P7** band rally drift | ⬜ **next** |
| P8–P10 | ⬜ untouched |

Full suite: **1260 tests, 1255 pass, 0 fail, 5 cancelled** (~10 min, of which the
new `groups.slow.test.js` is ~2). The cancelled
ones are `presets.test.js`'s HTTP tests, which the command sandbox blocks from
binding a port (`listen EPERM`) — pre-existing, unrelated, ignore them.

⚠ Renderer fixtures are **stale** for the demo's behaviour (P1, P2 and P3 moved
it). P4 is byte-identical in the demo, and so are P5b and P5c; **P5a is not** — the
grace clock changes which records exist, though only after the first die-off around
tick 4500, so short fixture runs are very likely unaffected. Verify rather than
assume. That regen is deliberately deferred to P10 per DOCS §12 — "regenerate after
the last behavioural change, not after the protocol change."

## ⚠⚠ Read this before P7: what P4 found out about steering

**P4 works and does nothing, and the second half is the useful part.** The calf
weight moves the centroid exactly as specified, and three separate attempts to find
a *spatial* consequence — on the demo at weights 2.5 and 4, and in a sandbox with
`herdWeight` lifted until herding dominated — all came back inside seed noise.

The reason is structural and it applies to **P7's rally drift and P8's consensus as
much as to P4**: `herd` is a **dead-band** controller. An animal closes up only once
it is more than `herdDistance` from the centre, then stops. Move the target point
and it re-settles at the same radius around the new one. So a mechanism that only
*moves the centroid* changes headings tick by tick and leaves the equilibrium
configuration alone.

Consequences worth carrying into P5–P8:

- **Do not measure a centroid mechanism by where animals end up.** Measure the
  heading, the utility, or the centroid itself. P4's shipped movement test is a
  deterministic single-tick heading claim for exactly this reason; the averaged
  position test I wrote first passed on seed 6 and reversed on seeds 1 and 3.
- **P7 is not subject to this** — a rally drift bends `wander`, which has no
  dead-band — which is a reason to expect it to be the phase that actually moves
  animals, and a reason to measure it the same careful way anyway.
- ⚠ **A weight is not the lever; the dead-band is.** Raising the calf weight from
  2.5 to 4 changed nothing. If a later phase wants a herd to genuinely reorganize,
  the number to look at is `behavior.herdDistance`, not another multiplier.

**So P4 ships at `config.social.calfWeight: 1`** — the identity — with the demo
verified byte-identical (seeds 1/2/42 × 1500 ticks, hashes of
`captureSimulationState`). The mechanism is real, tested, off, and one `--set` away.
Do not "finish" it by raising the number without re-reading DOCS §9 first.

## ⚠⚠ Read this too: what P5 found out about horizons

**A56 was ten times worse than four phases of measurement said, and the reason is
that every demo assertion in the suite stops at 1500 ticks.** Cumulative membership
events on seed 42: 212 at tick 1000, 220 at 3000, 235 at 4000 — and **3502 at
5000**. The demo founds its records in the first hundred ticks and they sit there;
the churn arrives with the **first wave of deaths**, when records start losing
members faster than they regain them.

So P5a's assertion could not live in `test/groups.test.js` at all. It is in a new
`test/groups.slow.test.js` at a 5000-tick horizon (~2 min, two arms, memoized).

⚠ **The transferable rule, and it now has two instances**: `BENCHMARK.md` records
P1's cost being understated 5× by a 400-tick window ("when a mechanism changes where
animals stand, measure it after they have stood there"). This is the same defect
from the other side — **when a mechanism changes what happens after a die-off,
measure it after the die-off**. Before believing any demo measurement in P7–P10,
ask what tick the phenomenon actually starts at.

## What P3–P5 changed about the code P7 touches

**`SocialSystem`'s neighbour loop now composes four numbers**, and the distinction
that matters is *how* they compose: the association weight and the band affinity
are **alternatives** (a body is either my kind or not), the calf weight
**multiplies onto whichever won** (dependency is an independent fact), and
`pullScale` is a **separate accumulator** that is never multiplied into `worth` at
all, because it is spent outside the centroid. Getting a new weight's category
wrong is the A61/D34 failure.

**`GroupSystem`'s reconcile pass now has a grace clock**, and P7 derives its group
centres in a *third* pass after the entity pass — so it sees this tick's joins and
dissolutions, including the ones the clock deferred. That ordering is the plan's,
and it is right.

**Four species now form records** (hyena, lion, zebra, buffalo), so P7's rally will
have ~35 concurrent centres to derive rather than the ~11 the plan's numbers assume.
`maxGroups` is 192 and peak measured is 35, so the `maxGroups × maxMembers` bound
the plan asks for is comfortable.

⚠ **The buffalo's record is P7's first real consumer.** 5c gave it one and it
changes *nothing* today — a demo with `forms: true` and one with `forms: false` are
identical at 3000/6000/9000 ticks, because `groupRecordId` is read only by carcass
possession, cooperative hunting and P2's band affinity, and a buffalo meets none of
them. If P7's rally drift lands and the buffalo still behaves identically, that is a
bug in P7, not a property of the buffalo.

## P7 specifics the plan gets right but understates

- ⚠⚠ **The NaN path is the worst one in the plan.** `clamp01(undefined)` returns
  `undefined`, which makes `blendHeadings` produce `NaN`, which makes
  `entity.x = NaN` **permanently** — the animal vanishes from every spatial query
  and never comes back. Default both fields in `EntityManager.createEntity` *and*
  null-check in `DecisionSystem` exactly the way `trailHeading` is.
- **Clear the fields on every path.** `GroupSystem` returns early when no species
  forms groups and `continue`s on three branches; a field not written on some path
  outlives its tick.
- ⚠ **Gate on `isDispersing`** or a rally drags a dispersing animal back toward the
  band it is walking out of — undoing A64 at the movement layer instead of the
  membership layer.
- **P7 is the first phase not subject to P4's dead-band finding**, because a rally
  bends `wander` rather than moving a centroid that `herd` reads through a
  dead-band. Expect it to actually move animals — and measure it at a horizon past
  4000 ticks anyway.

## Landmines, all of which cost me time this session

- **Two tests fish for a rare emergent event in a fixed window, and they break on
  every behaviour change.** P1 pushed seed 42's first carcass theft out and they
  moved to seed 2; P3 pushed seed 2 out and they moved back to 42. Re-measured
  2026-08-05 with P3 landed: 42→971, 1→1297, 2→1901, 3→311, 7→392, 13→1355 — every
  seed steals, 8–16 times inside 3000 ticks. **The failure mode is *late*, never
  absent.** Files: [`test/groups.test.js`](test/groups.test.js) and
  [`test/protocol-v29.test.js`](test/protocol-v29.test.js); the row is recorded
  beside each. ⚠ An audit of the whole suite found **13** tests of this shape out of
  ~1236; these two are the worst case (a rare event in a short window) and the rest
  have margin. `carcass.slow` and `mate-choice` are the next closest to the edge.
- **Mutation-test every new assertion, and make the fixture's numbers *different*.**
  P3 ran ten deliberate breakages, P4 seven. ⚠ **One of P4's survived the first
  pass**: `worth = calfWeight` instead of `worth *= calfWeight` is invisible unless a
  calf is standing there with a band weight *already* on it — in every other
  arrangement the body it replaces is worth exactly 1. The fix is the new test in
  `herding.test.js`; it is the same hazard `MIXER` and P3's `HOLDER` exist for, three
  phases running. **Assume your new weight has this hole until you have shown it
  does not.**
- **A test that measures an equilibrium is measuring the seed** unless you have
  shown otherwise. Run it on five seeds before you believe it.
- **A 0/0 is not a crash here, it is a silent behaviour deletion.** `NaN` loses every
  `argmaxUtility` comparison (`NaN > x` is false), so the action is never chosen
  again and nothing throws. P7's `clamp01(undefined)` is the same shape and worse.
- **Measure with entity counts matched**, 450 ticks, five interleaved rounds,
  discard round 1 (JIT).
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

- **The wildebeest associates with the zebra as of P3** and declares no
  `associationPull`, deliberately — it is the in-roster control arm that says the two
  fields are separable. Do not give it one without measuring.
- **P3 and P4 both only bite where the animals are already together.** Neither
  brings a scattered group back; that is P7.
- **A61 and A56 are both closed** (DOCS §1 and §9, ACTION-ITEMS). **A43** is
  partly answered by P2's two-bands test and closes at P10. ⚠ **A12** got very
  slightly worse at P4: an orphan has `guardianId === null`, so it is not weighted up
  by anybody — stated in `social/calves.js` rather than hidden.
- ⚠ **Saturation of the group store is still silent** — at the cap `found()`
  returns null with no event, metric or log. P5b raised the cap to 192 against a
  measured peak of 35, so nothing binds today, but making it *visible* is unbuilt.
  The metrics aggregate is the place and P10 is the phase.
- ⚠ **The demo's buffalo are collapsing** — 93 alive at t3000, 18 at t9000 on seed
  42, with 15 births in 9000 ticks against 96 founders. **Pre-existing and not
  P5's**: an identical run with `forms: false` gives the identical numbers, and
  `BENCHMARK.md` records buffalo going 116 → 74 when P1's herd radius landed. It
  matters here only because it is why 5c's cow–calf core is asserted in a sandbox:
  the demo cannot be relied on to contain a dependent calf.
- **Two tests were deleted at the user's instruction** and their coverage is gone:
  determinism through the **age-death** path, and the **no-timer** tripwire
  (invariant 9 is now stated but unenforced). Notes sit where each test was.
- **Nine determinism guards are byte-for-byte the same test** in nine files. First
  place to cut if the suite needs it.
- `src/simulation/social/` now holds four modules beside `dominance.js`:
  `association.js` (weights + P3's pulls), `herding.js` (P1), `banding.js` (P2),
  `calves.js` (P4). Any fifth weight goes in its own file on the same pattern.
