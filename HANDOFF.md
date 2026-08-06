# Handoff — BEHAVIOR-PLAN P0–P5 and P7 done, P6 skipped, start on P8

**Date:** 2026-08-05 → 06 (the session ran past midnight) · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `5fa62e7 P5` — P7 uncommitted at the time of writing

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec and it is still
accurate. ⚠ P8 is the only phase left that adds a **system** rather than a number,
and it carries a save-format bump, an `atan2(0, 0)` trap, and a re-decision rule
that is easy to half-implement. This file is only what a fresh session cannot get
from the plan.

## Where things stand

| Phase | State |
| --- | --- |
| **P0** perception restructure | ✅ committed `ae3b4e9` |
| **P1** per-species herd radius | ✅ committed `ae3b4e9` |
| **P2** affinity-weighted centroid | ✅ committed `49fa9f5` |
| **P3** association pull (A61) | ✅ committed `b413449` |
| **P4** calf-centred centroid | ✅ committed `ad0130e` — **shipped at its identity, on purpose** (below). ⚠ Its commit *message* also reads “P3”, so `git log` shows two of those; `b413449` is the real P3 |
| **P5** A56 hysteresis, registry capacity, buffalo cow–calf core | ✅ committed `5fa62e7` — **A56 closed**, save format v32 |
| **P6** bachelor bulls | ⛔ **skipped by decision** (2026-08-05) — a dispersed bull staying loosely with the local buffalo through the herd label is an acceptable bachelor. The plan section is kept, marked, with what it gives up stated |
| **P7** band rally drift | ✅ this session — the record’s first mover |
| **P8** herd consensus + leadership | ⬜ **next** |
| P9–P10 | ⬜ untouched |

Full suite: **1270 tests, 1265 pass, 0 fail, 5 cancelled** (~10 min, of which the
new `groups.slow.test.js` is ~2). The cancelled
ones are `presets.test.js`'s HTTP tests, which the command sandbox blocks from
binding a port (`listen EPERM`) — pre-existing, unrelated, ignore them.

⚠ Renderer fixtures are **stale** for the demo's behaviour. P1, P2, P3 and **P7**
all move it; P4 is byte-identical and so are P5b and P5c; **P5a** changes which
records exist but only after the first die-off (~tick 4500), so short fixture runs
are probably unaffected by that one alone. **P7 is the one that certainly matters** —
it moves animals from the first hundred ticks. That regen is deliberately deferred
to P10 per DOCS §12 — "regenerate after the last behavioural change, not after the
protocol change."

## ⚠⚠ Read this before P8: what P4 found out about steering

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

Consequences worth carrying into P8–P10:

- **Do not measure a centroid mechanism by where animals end up.** Measure the
  heading, the utility, or the centroid itself. P4's shipped movement test is a
  deterministic single-tick heading claim for exactly this reason; the averaged
  position test I wrote first passed on seed 6 and reversed on seeds 1 and 3.
- ✅ **P7 was not subject to this and duly moved animals** — a rally bends `wander`,
  which has no dead-band. ⚠ **P8 is back on the dead-band side for its cohesion
  half**, but its consensus *replaces* the migration drift in the same wander
  channel P7 used, so expect it to bite where P4 did not.
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
measure it after the die-off**. Before believing any demo measurement in P8–P10,
ask what tick the phenomenon actually starts at.

## ⚠⚠ Read this before P8: the mutation that found a real bug

**P7's dispersal gate was dead code and no test could tell.** The plan says gate the
rally on `isDispersing`; I gated it on `#dispersingOut`, the sex-filtered predicate
the *membership* rules use — which reads correctly and is wrong. Any animal
`#dispersingOut` answers true for has **already left its record** in the pass above,
so it never reaches the rally at all. The animal that can actually be dragged back
toward the band it is leaving is the one dispersal *keeps*: a dispersing **female**
under the default `leavingSex: 'male'`, who walks out still holding her membership.

My first test used a **male** disperser, so deleting the gate entirely changed
nothing and the mutation passed. That is the third phase running with this exact
shape — `MIXER` for P2, `HOLDER` for P3, `worth *= calfWeight` for P4 — and it is
worth stating as a rule for P8/P9:

> ⚠ **A test that exercises a guard through the arrangement where the guard is
> unreachable proves nothing.** Before believing a guard is tested, delete it and
> watch the test fail. If it does not, the fixture is in the wrong arrangement.

P8 has two guards of exactly this kind: the `atan2(0, 0)` resultant check (needs
genuinely opposed cues, not merely different ones) and the "member joining a label
mid-commitment adopts the label's consensus" clause (needs a member that joins
*after* the commitment was formed).

## ⚠ The plan's line numbers into `DecisionSystem.js` are stale

P3, P4 and P7 all edited that file, so every reference the plan makes into it is now
**35–45 lines low**. Checked 2026-08-06; the ones P8 will actually follow:

| BEHAVIOR-PLAN says | actually at | what it is |
| --- | --- | --- |
| `DecisionSystem.js:1311-1316` | **1353** | the `wander` drift blend — P8's one conditional goes here |
| `DecisionSystem.js:1122-1139` | **1157** | `#intentFor`'s `herd` case |
| `DecisionSystem.js:626-631` | **648** | the `herd` utility |
| `DecisionSystem.js:1111-1116` | **1308** | the `wander` ttl continuation |

✅ Its references into **other** files are still exact — `migration.js:333-335`,
`dominance.js:61` (the `maturity` term P8 calls "pointed the wrong way"),
`metrics.js:260`, `SimulationEngine.js:563`. Only `DecisionSystem.js` drifted.

## What P3–P7 changed about the code P8 touches

**The `decision` phase is now four systems deep, and P8 inserts into it.** Verified
2026-08-06:

| priority | system | writes what P8 cares about |
| ---: | --- | --- |
| −10 | `SocialSystem` | herd labels, `world.social` (incl. `bandmates`) |
| −8 | `GroupSystem` | records, `world.groupCentres`, `rallyHeading`/`rallyStrength` |
| −5 | `MigrationSystem` | `migrationHeading` / `migrationStrength` |
| **−3** | **`HerdConsensusSystem`** ← P8 | `herdHeading` / `herdStrength` |
| 0 | `DecisionSystem` | reads all of the above |

−3 is free and is the right slot for the plan's reason: it is after the migration
drift has settled (so consensus aggregates a finished number) and before anything
consumes it.

**`SocialSystem` publishes `bandmates`** — how many of an animal's own record are
inside its herd radius — added for P7's gate. It is counted whatever the species
declares, unlike P2's band affinity, because the buffalo has records and no affinity.

**`GroupSystem` has a third pass** (`#rally`) that runs after membership settles,
derives `world.groupCentres`, and writes `entity.rallyHeading` / `rallyStrength`.
⚠ Those two fields are **not** save-critical, and the invariant that allows that is
stated in the file header: this system (−8) precedes `DecisionSystem` (0) every
tick. **P8's `herdHeading` / `herdStrength` are different** — the plan says they are
persisted, because the whole point is a commitment that outlives the cue, so P8 is a
`SAVE_FORMAT_VERSION` bump (33) with a numbered entry.

**`DecisionSystem`'s wander now blends three drifts** — migration, then rally, then
trail. ⚠ P8 must **not** add a fourth: the plan is explicit that `herdHeading`
*replaces* `migrationHeading` while live, one conditional, no new blend. Adding a
fourth is how this expression becomes unreadable and how the strengths stop summing
to anything meaningful.

**Leadership is still unbuilt.** P7's plan text mentions weighting a group's centre
by `groups.leadWeight`; I derived the centre as a plain mean and left the seam,
because `leadershipOf` is P8's to add. If P8 adds it, `#rally`'s centre derivation is
where it goes — one multiply in an existing loop.

## What P7 shipped, and what it measured

**A separated member walks back to its band.** `GroupSystem` derives each record's
centre into transient `world.groupCentres`, writes `rallyHeading` / `rallyStrength`
for a member with **no bandmate contributing to its centroid** (read off the social
summary, not measured again — D11), and `DecisionSystem` folds it into the fresh
`wander` commitment between the migration and trail drifts.

Measured: a torn pair reunites on **5 of 5** seeds with the drift and **2 of 5**
without. In the demo over 6000 ticks × 4 seeds, banded animals with a bandmate in
range go **72.7→80.7, 78.3→81.1, 79.3→76.8, 76.6→85.3** — up on three of four, mean
76.7 → 81.0. ⚠ By tick 6000 the arms hold different populations (438 vs 522 on the
reversed seed), so that percentage is measured over different worlds. Four seeds is
exploratory. Cost **+0.9%** of a demo tick. ~5% of banded animals are rallying at any
moment, and nothing anywhere reached a non-finite position.

⚠ **`npm run ethologist` is the check this phase most needed and it is clean** — an
animal locked on one bearing is exactly what a badly-bounded rally produces, and
that tool already knows how to report it. It also independently confirms P5a: its
pre-fix run flagged a `group-flapping` anomaly and the post-fix run flags **none
across six worlds**. Run it after P8; it is four minutes and it reads the failure
modes a test suite is not shaped to notice.

⚠ **P7 confirms P4's dead-band finding from the other side.** P4 moved a centroid
that `herd` reads through a dead-band and produced no spatial change; P7 bends
`wander`, which has no dead-band, and moves animals on the first measurement. If a
later phase wants animals to actually go somewhere, that is the distinction to reach
for.

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
  have margin (that audit covered ~1236 tests; the suite is 1270 now and the 13 are
  unchanged). `carcass.slow` and `mate-choice` are the next closest to the edge.
- **Mutation-test every new assertion, and make the fixture's numbers *different*.**
  P3 ran ten deliberate breakages, P4 seven, P5 six, P7 four. ⚠ **One of P4's and
  one of P7's survived the first pass.** P4's: `worth = calfWeight` instead of
  `worth *= calfWeight` is invisible unless a calf is standing there with a band
  weight *already* on it — in every other arrangement the body it replaces is worth
  exactly 1. The fix is the new test in `herding.test.js`; it is the same hazard
  `MIXER` and P3's `HOLDER` exist for. P7's is worse and has its own section above —
  a guard that was **unreachable** in the arrangement its test used, and which turned
  out to be a real bug rather than a weak test. **Assume every new weight and every
  new guard has this hole until you have shown it does not.**
- **A test that measures an equilibrium is measuring the seed** unless you have
  shown otherwise. Run it on five seeds before you believe it.
- **A 0/0 is not a crash here, it is a silent behaviour deletion.** `NaN` loses every
  `argmaxUtility` comparison (`NaN > x` is false), so the action is never chosen
  again and nothing throws. P7's `clamp01(undefined)` is the same shape and worse —
  it reaches `entity.x` and parks the animal outside every spatial query for good.
  Both are guarded. ⚠ **P8's `atan2(0, 0)` is the third of the family and the
  nastiest to spot**: it does not look like an error at all, it looks like a whole
  wildebeest herd deciding to march due east.
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
- **P3 and P4 both only bite where the animals are already together.** ✅ P7 brings
  a scattered *record* back; nothing brings back a scattered **label**, and nothing
  is scheduled to — a herd that tears in half is meant to become two herds.
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
- `src/simulation/social/` holds four modules beside `dominance.js`:
  `association.js` (weights + P3's pulls), `herding.js` (P1), `banding.js` (P2),
  `calves.js` (P4). Any fifth weight goes in its own file on the same pattern.
  ⚠ P7 deliberately added **no** module: it is a system pass and two entity fields,
  not an exchange rate, and putting it in `social/` would have implied otherwise.
- ⚠ **P7 left one seam open on purpose.** The plan wanted a group's centre weighted
  by leadership (`groups.leadWeight`); the centre is a plain mean, because
  `leadershipOf` is P8's to add. If P8 builds it, `GroupSystem#rally`'s derivation
  loop is where one multiply goes.
