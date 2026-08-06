# Handoff — BEHAVIOR-PLAN P0–P4 done, start on P5

**Date:** 2026-08-05 · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `b413449 P3` (P4 uncommitted at the time of writing)

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec and it is still
accurate. ⚠ P5 is the **largest** phase left: three sub-parts, a save-format bump,
and the first one (A56 hysteresis) is a prerequisite for P7 rather than a nicety.
This file is only what a fresh session cannot get from the plan.

## Where things stand

| Phase | State |
| --- | --- |
| **P0** perception restructure | ✅ committed `ae3b4e9` |
| **P1** per-species herd radius | ✅ committed `ae3b4e9` |
| **P2** affinity-weighted centroid | ✅ committed `49fa9f5` |
| **P3** association pull (A61) | ✅ committed `b413449` |
| **P4** calf-centred centroid | ✅ this session — **shipped at its identity, on purpose** (below) |
| **P5** A56 hysteresis, registry capacity, buffalo cow–calf core | ⬜ **next** |
| P6–P10 | ⬜ untouched |

Full suite: **1248 tests, 1243 pass, 0 fail, 5 cancelled**. The cancelled
ones are `presets.test.js`'s HTTP tests, which the command sandbox blocks from
binding a port (`listen EPERM`) — pre-existing, unrelated, ignore them.

⚠ Renderer fixtures are **stale** for the demo's behaviour (P1, P2 and P3 moved it;
P4 did not). That regen is deliberately deferred to P10 per DOCS §12 — "regenerate
after the last behavioural change, not after the protocol change."

## ⚠⚠ Read this before P5: what P4 found out about steering

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

## What P3 and P4 changed about the code P5 touches

P5 lands mostly in `GroupSystem` / `GroupRegistry`, which P3 and P4 did not touch —
so the plan's P5 text reads true against the current files. Two things carried over:

**`SocialSystem`'s neighbour loop now composes four numbers**, and the distinction
that matters is *how* they compose: the association weight and the band affinity
are **alternatives** (a body is either my kind or not), the calf weight
**multiplies onto whichever won** (dependency is an independent fact), and
`pullScale` is a **separate accumulator** that is never multiplied into `worth` at
all, because it is spent outside the centroid. Getting a new weight's category
wrong is the A61/D34 failure.

**There are four per-world resolved maps on one registry guard** inside
`#associationsFor` ([SocialSystem.js:611](src/simulation/systems/SocialSystem.js#L611)).
P4 needed no fifth — it is a world-level number resolved once in the constructor —
and P5 needs none either.

## P5 specifics the plan gets right but understates

- **5a's `belowMinSince` is persisted state**, so it is a `SAVE_FORMAT_VERSION` bump
  with a numbered entry in `SimulationSerializer.js`'s version-history docblock, and
  a round-trip assertion (`groups.test.js:214` is the existing shape). Entities and
  records serialize *whole*, so a missing field fails **silently**.
- **5b's saturation is invisible today.** At the cap `found()` returns `null`,
  `#joinOrFound` returns, and there is **no event, no metric, no log** — the feature
  just stops working, seed-dependently. Assert `world.groups.size <
  world.groups.maxGroups` as the plan says, and consider whether the silence itself
  deserves fixing while you are in there.
- **5c rewrites a header that currently says the opposite.**
  [herbivoreBuffalo.js:33-37](src/simulation/config/species/herbivoreBuffalo.js#L33)
  says persistent groups are "Not stated, deliberately". Rewrite it rather than
  contradicting it — `GroupRegistry.js:5` is the precedent for how this codebase
  overrides its own documented decisions.
- ⚠ **5c changes the demo**, unlike P4. Expect the trajectory-dependent tests below
  to move again.

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
- **A61 is answered** (DOCS §1 and §9, ACTION-ITEMS). **A56** is P5a. **A43** is
  partly answered by P2's two-bands test and closes at P10. ⚠ **A12** got very
  slightly worse at P4: an orphan has `guardianId === null`, so it is not weighted up
  by anybody — stated in `social/calves.js` rather than hidden.
- **Two tests were deleted at the user's instruction** and their coverage is gone:
  determinism through the **age-death** path, and the **no-timer** tripwire
  (invariant 9 is now stated but unenforced). Notes sit where each test was.
- **Nine determinism guards are byte-for-byte the same test** in nine files. First
  place to cut if the suite needs it.
- `src/simulation/social/` now holds four modules beside `dominance.js`:
  `association.js` (weights + P3's pulls), `herding.js` (P1), `banding.js` (P2),
  `calves.js` (P4). Any fifth weight goes in its own file on the same pattern.
