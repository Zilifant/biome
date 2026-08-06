# Handoff — BEHAVIOR-PLAN P0–P5, P7 and P8 done, P6 skipped, start on P9

**Date:** 2026-08-06 · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `09f88be update handoff` — P8 uncommitted at the time of writing

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec and it is still
accurate. ⚠ P9 is the last phase that adds a **behaviour** rather than a report, and
it is the most dangerous one in the plan: it is the only mechanism here that
**suppresses `flee`**, on a species whose whole point is not running away. This file
is only what a fresh session cannot get from the plan.

## Where things stand

| Phase | State |
| --- | --- |
| **P0** perception restructure | ✅ committed `ae3b4e9` |
| **P1** per-species herd radius | ✅ committed `ae3b4e9` |
| **P2** affinity-weighted centroid | ✅ committed `49fa9f5` |
| **P3** association pull (A61) | ✅ committed `b413449` |
| **P4** calf-centred centroid | ✅ committed `ad0130e` — **shipped at its identity, on purpose**. ⚠ Its commit *message* also reads “P3”, so `git log` shows two of those; `b413449` is the real P3 |
| **P5** A56 hysteresis, registry capacity, buffalo cow–calf core | ✅ committed `5fa62e7` — **A56 closed**, save format v32 |
| **P6** bachelor bulls | ⛔ **skipped by decision** (2026-08-05) |
| **P7** band rally drift | ✅ committed `65d3474` |
| **P8** herd consensus + leadership | ✅ this session — **save format v33**, and the herd *label* finally has a behavioural consumer |
| P9 coordinated charge | ⬜ **next** |
| P10 observability | ⬜ untouched |

## What P8 shipped

**`HerdConsensusSystem`** (`decision`, priority −3) pools the migration drifts of
everyone sharing a herd label into one circular mean, hands every member the same
heading and strength, and each holds it for `consensus.commitTicks` (60) whatever
its own cue does next. `DecisionSystem` steers a fresh `wander` by it **in place of**
`migrationHeading` — one conditional, not a fourth blend. Four new **persisted**
entity fields, a new `config.consensus` section, `SAVE_FORMAT_VERSION` **33**.

**Leadership** closes the seam P7 left open: `leadershipOf` in `social/dominance.js`,
spent in `GroupSystem#rally`'s centre derivation at `config.groups.leadWeight` (0.5).

Shipped **on**: wildebeest `behavior.consensusWeight: 1.0`, buffalo `0.6`, buffalo
`behavior.leadAgeWeight: 0.5`. Everything else is at 0 and is never touched.

New files: [`src/simulation/social/consensus.js`](src/simulation/social/consensus.js),
[`src/simulation/systems/HerdConsensusSystem.js`](src/simulation/systems/HerdConsensusSystem.js),
[`test/consensus.test.js`](test/consensus.test.js) (31 tests).

## ⚠⚠ Read this before P9: the five things P8 learned

### 1. The off-arm proof needs *both* switches, and it is exact

`consensus.enabled: false` **and** `groups.leadWeight: 0` together reproduce the
pre-P8 world byte-for-byte (seeds 1/2/42 × 1500 ticks, hashes of
`captureSimulationState` with the four new entity fields stripped). ⚠ Each switch
alone leaves the other's difference in, and **both genuinely move the world** — that
is checked, so neither is inert. If you need the recipe again:

```js
createDemoSimulation({ seed, config: { consensus: { enabled: false }, groups: { leadWeight: 0 } } })
```

⚠ **Strip the new entity fields before hashing.** Entities serialize whole, so a save
from this tree can never equal one from before it — the comparison is about the
*world*, not the record format, and it took one confused run to notice.

### 2. ⚠⚠ The mutation that survived was a **double charge**, for the fourth time

`consensusWeight` is spent once, where the fresh consensus is computed. Charging it
again when a **joiner adopts** a standing consensus is invisible at weight 1 (`× 1`)
and invisible at weight 5 (both arms saturate against `maxStrength`). Only a weight
that is *neither* catches it — `test/consensus.test.js`'s `HALF` at 0.5.

That is now four phases in a row with the identical shape: `MIXER` (P2), `HOLDER`
(P3), `worth *= calfWeight` (P4), and this. **The rule, stated once more because P9
adds two more weights (`chargeWeight`, `pursuitTicks`):**

> ⚠ **A weight tested only at 1, at 0, or at a value that saturates its own cap is
> not tested.** Pick a fixture number that is none of those, then delete the
> multiply and watch the test fail.

Seven mutations were run against P8; six failed the suite immediately. The other
five worth knowing about are recorded in `test/consensus.test.js`'s header.

### 3. ⚠ `updateInterval` is part of the *mechanism* here, not only the cost

Because a label re-decides only on a tick the system runs, commitments quantize onto
multiples of `consensus.updateInterval` (5) — which is what makes herds founded ticks
apart still expire **together**, and therefore what turns n independent
re-decisions into one collective one. Setting it to 1 does not "make it more exact",
it makes the front *blurrier*. The trade is that `commitTicks` is a floor rounded up
to the cadence, so `DecisionSystem` gates on the fields rather than on the clock and
a commitment can outlast its ttl by up to four ticks.

### 4. ⚠⚠ Three seeds at 3000 ticks said the opposite of five seeds at 8000

**This is the P5 lesson again and it nearly cost a tuning decision.** The first
reading — wildebeest population at tick 3000, three seeds — was 238→235, 216→152,
261→213, which reads as "the consensus costs the species it is for a third of its
population". The sweep at 8000 ticks on five seeds says wildebeest is **flat** (89.0
against 91.4) and that what actually moved is the *top of the food web*: the leopard,
hyena and vulture are all up on both mean and seeds-survived, and extinctions fall
from 6 to 2. A herd that walks as a body is prey a predator can keep finding.

⚠ **Ask what tick the phenomenon starts at, then measure past it.** The wildebeest
population is still falling steeply at 3000 in *both* arms; comparing two curves
mid-fall compares their phase, not their level.

### 5. ⚠ The one defect worth looking for, and it is not there

A consensus replaces the **whole** migration drift, and that drift multiplexes
thirst — so a thirsty animal in a herd that is not thirsty loses its long-range water
cue for up to 60 ticks. That is a real hazard and it is why the buffalo declares 0.6
rather than 1.0. Measured: wildebeest dehydration deaths are **655 with the consensus
against 708 without**, i.e. down. ⚠ Re-check it if anyone raises a `consensusWeight`.
(The short-range `drink` / `seekWater` / `recallWater` are *actions* and cannot be
replaced by any of this — only the "smell of water on the wind" can.)

## ⚠ Carried forward from P4 and P7: how to measure a steering mechanism

**Do not measure a centroid mechanism by where animals end up.** `herd` is a
**dead-band** controller — an animal closes up only past `herdDistance`, then stops —
so moving the target point changes headings tick by tick and leaves the equilibrium
alone. P4's three attempts at a spatial consequence all came back inside seed noise.

- ✅ **P7 and P8 are both on the other side of that line.** They bend `wander`, which
  has no dead band, and both moved animals on the first measurement.
- ⚠ P8's own shipped movement claim is still a **deterministic single-tick heading**
  test for exactly P4's reason, plus a 40-tick direction count. The averaged-position
  version of it is the one that passes on one seed and reverses on the next.
- ⚠ **A weight is not the lever; the dead-band is.** If a later phase wants a herd to
  genuinely reorganize, the number to look at is `behavior.herdDistance`.

## ⚠ Carried forward from P5: ask what tick the phenomenon starts at

**A56 was ten times worse than four phases of measurement said**, because every demo
assertion in the suite stopped at 1500 ticks and the churn arrives with the first
wave of deaths (212 membership events at tick 1000, **3502** at 5000). `BENCHMARK.md`
records the same defect from the other side — P1's cost understated 5× by a 400-tick
window. **Before believing any demo measurement in P9–P10, ask what tick the thing
you are measuring actually starts at.** `test/groups.slow.test.js` exists because of
this and runs at a 5000-tick horizon.

## What P8 measured

**The mechanism, directly** (`test/consensus.test.js`, 31 assertions): the circular
mean and its denominator, the three-clause re-decision rule, the `atan2(0, 0)` guard,
the commitment outliving a *deleted* cue for 58 ticks, the strength not climbing over
four commitment cycles, decay when a quarter of the herd reverses, the dispersal
gate over 100 ticks, and both off arms.

**The claim, on the demo** — within-label circular variance of the effective drift
heading among wildebeest, sampled every 25 ticks from tick 300 to 3000:

| seed | off | on |
| ---: | ---: | ---: |
| 42 | 0.098 | **0.032** |
| 1 | 0.131 | **0.024** |
| 2 | 0.139 | **0.079** |

⚠ **The realized wander-intent variance barely moves** (0.638 → 0.619 on seed 42),
and that is honest rather than disappointing: the consensus strength on the demo runs
~0.10, so it is a weak bend on a random candidate heading, exactly as the migration
drift it replaces is. What the consensus changes is *which* weak bend, and that they
all get the same one.

**The sweep**, 5 seeds × 8000 ticks,
`--set=consensus.enabled=true --controlSet=consensus.enabled=false`, mean living at
t8000 (seeds survived in brackets):

| | gazelle | wildebeest | zebra | buffalo | lion | hyena | vulture | leopard |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| on | 110.0 (5) | **89.0** (5) | 159.4 (5) | 13.8 (4) | 17.4 (5) | **3.4** (5) | **13.8** (5) | **2.2** (4) |
| off | 126.0 (5) | 91.4 (5) | 162.4 (5) | 16.8 (5) | 18.8 (5) | 2.0 (3) | 9.0 (4) | 0.6 (2) |

The species it is for is flat; the three A81 calls effectively gone are all up;
extinctions fall 6 → 2. ⚠ Five seeds is exploratory (D14), A81 says the demo is not a
bar to pass, and buffalo lost a seed. Nothing reached a non-finite position, and
`npm run ethologist` reports no new anomaly kind across six worlds.

**Cost: ≈ +2% of a demo tick**, eight interleaved rounds — and the ranges *overlap*,
so read the paired differences (positive on 6 of 8, mean +0.128 ms). See
`BENCHMARK.md`. ⚠ The full `npm run benchmark` the same day reads demo-default 8.30
and large-5k 165.73 against 2026-08-04's 5.52 and 133.73; **that is machine drift, not
P8** — nothing changed by 24% — and it is recorded in `BENCHMARK.md` so nobody reads
it as a regression.

## The plan's line numbers into `DecisionSystem.js` are stale — again

P8 added ~25 lines in the `wander` branch on top of P3/P4/P7's edits. The references
BEHAVIOR-PLAN makes into that file are now **50–70 lines low**. The one P9 follows:

| BEHAVIOR-PLAN says | actually at | what it is |
| --- | --- | --- |
| `DecisionSystem.js:1111-1116` | **~1359** | the `wander` ttl continuation P9's note is about |
| `DecisionSystem.js:1122-1139` | **~1157** | `#intentFor`'s `herd` case |
| `DecisionSystem.js:626-631` | **~648** | the `herd` utility |

✅ Its references into **other** files are still exact — `dominance.js:61` (the
`maturity` term, now joined by `leadershipOf` directly below it), `metrics.js:260`,
`SimulationEngine.js:563`, `cooperation.test.js`.

## What the `decision` phase looks like now

| priority | system | writes |
| ---: | --- | --- |
| −10 | `SocialSystem` | herd labels, `world.social` (incl. `bandmates`) |
| −8 | `GroupSystem` | records, `world.groupCentres`, `rallyHeading`/`rallyStrength` |
| −5 | `MigrationSystem` | `migrationHeading` / `migrationStrength` |
| **−3** | **`HerdConsensusSystem`** | `herdHeading` / `herdStrength` / `herdCommitUntil` / `herdCommitLabel` |
| 0 | `DecisionSystem` | reads all of the above |

⚠ **`DecisionSystem`'s wander blends three drifts and must not gain a fourth.** P8's
consensus *replaces* the migration drift rather than joining the queue; P9 does not
touch this channel at all (it is a utility and an intent, not a drift).

## Landmines, all of which cost time this session or the last

- ⚠⚠ **`git checkout` cannot restore an untracked file, and P8 added three.** A
  mutation-test loop that backs up with `cp` into a directory that does not exist
  will silently stack its mutations. Make the directory first, or check `cp`'s exit
  code — the repair here was by hand.
- **Two tests fish for a rare emergent event in a fixed window** and break on every
  behaviour change: [`test/groups.test.js`](test/groups.test.js) and
  [`test/protocol-v29.test.js`](test/protocol-v29.test.js), first-carcass-theft.
  ⚠ **P8 did not move them** — they still pass on the seeds recorded beside each —
  but the failure mode is *late*, never absent. An audit found 13 tests of this shape;
  `carcass.slow` and `mate-choice` are next closest to the edge.
- **A 0/0 is not a crash here, it is a silent behaviour deletion.** `NaN` loses every
  `argmaxUtility` comparison. ⚠ **P8's `atan2(0, 0)` is the third of the family and
  the nastiest**: it does not look like an error, it looks like a whole wildebeest
  herd deciding to march east. Guarded, and the guard is *load-bearing* — without it
  a herd that disagreed completely would hold a live commitment at strength 3e-17,
  suppressing for sixty ticks the drift it replaced.
- **A test that measures an equilibrium is measuring the seed** unless you have shown
  otherwise. Run it on five seeds before you believe it.
- **Measure with entity counts matched**, 450 ticks, five interleaved rounds, discard
  round 1 (JIT).
- ⚠ `perl -0pi -e 's/…/…/'` without `/g` replaces **only the first match**.
- ⚠ The 5 `presets.test.js` HTTP suites are **cancelled** in a sandboxed shell
  (`listen EPERM`) — pre-existing, unrelated, ignore them.

## Test workflow

Full suite after P8: **1301 tests, 1296 pass, 0 fail, 5 cancelled** (~13 min). The
cancelled ones are `presets.test.js`'s HTTP tests, which the command sandbox blocks
from binding a port — pre-existing, unrelated, ignore them.

```bash
npm run test:fast   # ~5 min — use this in the edit loop
npm test            # ~13 min, everything — before committing
```

`test:fast` skips demo/persistence/determinism suites and the `*.slow.test.js` files.
⚠ `--test-skip-pattern` is **silently ignored if it comes after the file arguments**;
the npm script has the order right, don't reshuffle it.

New size-independent guards should use
[`test/helpers/smallDemo.js`](test/helpers/smallDemo.js) (~3.9× faster) — but read
its header: legitimate for determinism and round-trip claims, **never** for
ecological ones.

## Open threads

- ⚠ **Renderer fixtures are stale** for the demo's behaviour. P1, P2, P3, P7 and now
  **P8** all move it. The regen is deliberately deferred to P10 per DOCS §12 —
  "regenerate after the last behavioural change, not after the protocol change."
- ⚠ **`behavior.leadAgeWeight` is inert in short runs, by construction.** Seniority is
  `senescent` or nothing, and buffalo reach `adultUntil: 11000` — so a 1500-tick demo
  contains no matriarch at all. What `leadWeight` moves in a short run is plain
  `dominanceOf` (mass and condition). Anyone measuring the age half needs a horizon
  past 11 000 ticks, which is the P5 lesson in a new suit.
- ⚠ **A label re-decides with whoever is free that tick.** The rule is the plan's, and
  its consequence is that a straggler whose commitment lapsed out of phase re-decides
  by itself — a herd is mostly, not perfectly, in phase. `updateInterval` is what
  keeps that from becoming a smear; if a herd ever looks like it is fanning out, that
  is the number to look at, not `commitTicks`.
- **The wildebeest associates with the zebra as of P3** and declares no
  `associationPull`, deliberately — the in-roster control arm that says the two fields
  are separable. Do not give it one without measuring.
- ✅ **P7 brings a scattered *record* back; P8 keeps a scattered *label* pointed the
  same way.** Nothing reassembles a torn label and nothing is scheduled to — a herd
  that tears in half is meant to become two herds, which now both keep marching.
- **A61 and A56 are both closed** (DOCS §1 and §9). **A43** is partly answered by P2's
  two-bands test and closes at P10. ⚠ **A12** got slightly worse at P4: an orphan has
  `guardianId === null`, so nobody weights it up.
- ⚠ **Saturation of the group store is still silent** — at the cap `found()` returns
  null with no event, metric or log. P5b raised the cap to 192 against a measured peak
  of 35, so nothing binds today; making it *visible* is P10's.
- ⚠ **The demo's buffalo are collapsing** — 93 alive at t3000, 18 at t9000 on seed 42.
  **Pre-existing and not P5's or P8's**: an identical run with `forms: false` gives
  identical numbers, and `BENCHMARK.md` records buffalo going 116 → 74 when P1 landed.
- **Two tests were deleted at the user's instruction** and their coverage is gone:
  determinism through the **age-death** path, and the **no-timer** tripwire.
- **Nine determinism guards are byte-for-byte the same test** in nine files. First
  place to cut if the suite needs it.
- `src/simulation/social/` now holds five modules beside `dominance.js`:
  `association.js` (P3's pulls), `herding.js` (P1), `banding.js` (P2), `calves.js`
  (P4), `consensus.js` (P8). ⚠ P7 deliberately added none — it is a system pass and
  two entity fields, not an exchange rate. P8 added one because it has a per-species
  weight *and* an argument about a re-decision rule that had nowhere else to live.
