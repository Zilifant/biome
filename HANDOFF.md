# Handoff — BEHAVIOR-PLAN P0–P5 and P7–P9 done, P6 skipped, start on P10

**Date:** 2026-08-06 · **Branch:** `update/improved-herbivore-behavior` · **Last commit:** `fa3a34e P9` — this file's P10 preparation is the only thing after it

Read [`BEHAVIOR-PLAN.md`](BEHAVIOR-PLAN.md) first — it is the spec and it is still
accurate. ⚠ **P10 is the last phase and it is the only one that reaches the
renderer**: inspection fields, a metrics aggregate, `PROTOCOL_VERSION` 33 → 34
matched by the renderer's `SUPPORTED_PROTOCOL_VERSION`, and a fixture regeneration
that has been deliberately deferred through **six** behavioural phases and must be
run **last of all**. Everything it has to do is enumerated below under *What P10 has
to do* — including the three items the plan lists that are already done, and the two
pieces of state the plan predates. This file is only what a fresh session cannot get
from the plan.

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
| **P8** herd consensus + leadership | ✅ committed `56925c9` — **save format v33**, and the herd *label* finally has a behavioural consumer |
| **P9** coordinated charge and pursuit | ✅ committed `fa3a34e` — **save format v34** |
| P10 observability and closing the loop | ⬜ **next** |

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

## What P9 shipped

**A charge and a pursuit, and neither is a new action.** A defender of a species that
declares `behavior.chargeWeight` **sprints** to the animal under attack instead of
walking, and its `defend` keeps scoring for `behavior.pursuitTicks` after the ward is
gone, steering at the place the threat was last seen. Three new **persisted** entity
fields (`defendUntil`, `defendThreatX`, `defendThreatY`), a new `config.charge`
section, `SAVE_FORMAT_VERSION` **34**. ⚠ **No new system** — this is two blocks
inside `DecisionSystem` plus a resolver module.

Shipped **on** for the **buffalo only**: `chargeWeight: 0.9`, `pursuitTicks: 20`.

New file: [`src/simulation/predation/charge.js`](src/simulation/predation/charge.js);
14 new tests in [`test/cooperation.test.js`](test/cooperation.test.js).

## ⚠⚠ What P10 has to do, and the order it has to happen in

The plan's P10 list is accurate but it was written before P8 and P9 existed, so three
of its doc items are **already done** and two pieces of state it does not mention now
exist. This is the current state of each, verified against a running engine on
2026-08-06 rather than read off the source.

### 1. Inspection — `SimulationEngine.js#getEntityDetails`, the `group` (551) and `social` (563) blocks

**What is there today**, dumped from a live demo buffalo at tick 200 rather than read
off the source, so a P10 session knows exactly what it is adding to:

```
group  : id, speciesId, size, memberIds, founderId, foundedTick
social : groupId, dominance, alarmed, alarmedUntil, alarmSource, defendingId,
         lastContestTick, nearby
nearby : groupmates, adults, associates, nearestDistance, drift
```

⚠ The method is `getEntityDetails(entityId)` (line **368**); 551/563 are the two
object literals inside it.

| what the plan asks for | state |
| --- | --- |
| `social.nearby` gains `pullScale` | ⬜ to do. The value is already on the summary (`world.social.get(id).pullScale`), so this is one line |
| new `social.consensus` `{ heading, strength, until }` | ⬜ to do. ⚠ P8 stores a **fourth** field, `herdCommitLabel` — the label the commitment was made in. Project it or state why not; `groupId` is projected two lines above, so a commitment held over from a herd the animal has left is otherwise invisible |
| `group` gains a derived `centre` and `leaderId` | ⬜ to do, and ⚠⚠ **see the trap below** |

⚠⚠ **Do not read `group.centre` out of `world.groupCentres`.** That map is rebuilt by
`GroupSystem#rally`, which runs **only when `config.groups.rallyEnabled`** — so an
inspection block that read it would report `null` for every group the moment somebody
switched the rally off, which is a control arm the suite uses. **Measured, not
inferred**: on the demo at tick 200, `groupCentres.size` is **28 with the rally on and
0 with it off, against 28 live records in both**. Derive the centre on read from
`memberIds`, the same way `leaderId` has to be derived (`leadershipOf` with
`leadAgeWeightOf(species)`); it is bounded by `maxMembers` and it is the rule
`GroupRegistry` already states — **standing is derived, never stored**.

⚠ **P9 added state the plan's list predates**: `defendUntil` / `defendThreatX` /
`defendThreatY`. `social.defendingId` is projected already, but a *pursuit* is
precisely a commitment that outlives the visible cue, so there is currently no way to
see one at all. A `social.charge` block (`{ until, threat: { x, y } }`) is the obvious
addition and it is a **decision to make out loud**, not an omission to make quietly.

### 2. Metrics — `metrics.js:260`, the `groups` aggregate

⬜ Mean band spread, so cohesion is a number rather than an impression. Aggregates
only — a membership list here would be the per-organism record §11 rules out.

⚠ **Fold in the open thread while you are there**: the group store's saturation is
still *silent* (at the cap `found()` returns null with no event, metric or log). This
aggregate is the place, and P10 is the phase — see Open threads below.

### 3. Protocol — bump to 34, and it is asserted rather than remembered

⬜ `PROTOCOL_VERSION` 33 → **34**, matched by `SUPPORTED_PROTOCOL_VERSION`
(`RendererStore.js:20`), plus a new `test/protocol-v34.test.js` copied from
`protocol-v33.test.js:32`. ✅ All three are currently **33** and agree — protocol,
renderer, and the committed fixture's `protocolVersion` — so the starting state is
clean and any disagreement after the bump is yours. ⚠ **Assert against the live constants, never literals** —
the v29 bump shipped that comparison written against itself and three stale fixtures
passed (D31).

### 4. ⚠⚠ Fixtures — LAST, after every behavioural change, and expect a UI spec to move

⬜ `npm run fixtures:renderer`, then `npm test`, then `npm run test:ui`.

This is the ordering constraint the whole phase turns on. DOCS §12: *"a change to
behaviour is a roster change for this purpose too — regenerate after the last
behavioural change, not after the protocol change"*, learned the cheap way at F1
when fixtures were regenerated at the bump and then five actions were reclassified
underneath them. **Six behavioural phases have landed since the last regeneration**
(P1, P2, P3, P7, P8, P9), so the committed recording describes a world that no longer
exists.

⚠ **The fixtures are a 10-tick warm-up plus one step** (`generateRendererFixtures.js`,
`WARMUP_TICKS = 10`), which decides which of those six actually show. P1/P2/P3 move
animals from tick 1 and certainly show; P7 moves them inside the first hundred ticks;
**P8 and P9 almost certainly do not** — a consensus needs a herd label and a settled
migration drift, and P9 does not bite until tick 2300+. ⚠ Do not let that tempt you
into skipping the regen: the fixture is a recording of *a world*, and the roster,
config and save format have all moved under it.

⚠ **A UI spec is likely to move with it.** `tests-ui/event-filters.spec.js` assumed
the fixtures contain no births or deaths, which stopped being true the last time the
world changed underneath them. ⚠ `npm run test:ui` is Playwright and is **not** part
of `npm test`; it has to be run separately, and this sandbox may not be able to.

### 5. Docs — three of the four are already done

| plan item | state |
| --- | --- |
| DOCS §9 retract "the label has no behavioural consumer at all" | ✅ **done at P8** — retracted in place, with the original paragraph kept because the measurement in it is what made the consensus worth building |
| §19 the configuration map | ✅ **done** — `consensus` and `charge` are both listed |
| close or annotate **A61** (P3) and **A56** (P5a) | ✅ both already carry `✅ … CLOSED` in `ACTION-ITEMS.md` |
| **A43** — population fragmentation is enabled, not asserted | ⬜ **the one still open.** The plan's claim is that P2's two-bands test is the fragmentation assertion A43 says nobody has written. ⚠ Read A43 before agreeing: it asks for a *population* fragmentation outcome, and P2's test asserts a **centroid** — decide whether that closes it or merely narrows it, and say which |

### What P10 is *not*

⚠ It is not renderer work. The renderer is a separate subsystem with its own roadmap
(`src/renderer/DOCS-RENDERER.md`); making it *display* any of the new inspection
fields is its item, not this plan's. P10 owes the protocol version, the fixtures and
the passing UI suite — nothing beyond that.

## ✅ The plan's line numbers for P10 are all still exact — verified 2026-08-06

Every phase since P3 has drifted BEHAVIOR-PLAN's references into `DecisionSystem.js`
(P8 alone added ~25 lines to the `wander` branch, P9 another ~60). **P10 follows none
of them**, and the four it does follow were re-checked after P9 landed:

| BEHAVIOR-PLAN says | actually at | what it is |
| --- | --- | --- |
| `SimulationEngine.js:563-585` | **563** | the `social` inspection block; the sibling `group` block is at **551** |
| `metrics.js:260` | **260** | the `groups` aggregate |
| `RendererStore.js:20` | **20** | `SUPPORTED_PROTOCOL_VERSION`, currently **33** |
| `test/protocol-v33.test.js:32` | **32** | the assertion shape `protocol-v34.test.js` copies |

## ⚠⚠ Read this before P10: the four things P9 learned

### 1. ⚠⚠ A ttl on an intent commits to nothing, and the plan was right about it

`#intentFor` is called fresh from the winning action **every tick**, and only the
`wander` branch reads a prior intent's ttl as a continuation. So a `defend` intent
with `ttl: 20` is overwritten on the very next tick, the moment `defendUrgency`
reaches 0. **A commitment has to live in the utility** — state that keeps the *score*
non-zero. That is now true of both P8's consensus and P9's pursuit, and it is the
first thing to check if a later phase wants an animal to keep doing something after
its reason has gone.

### 2. ⚠⚠ The pursuit competes with `alarmFlee` by construction, and shipped inert

`alarmFlee` is `fleeWeight × 0.75` and fires **exactly when no threat is perceived** —
which is exactly the situation a pursuit exists for. Worse, every pursuit begins
moments after a predator was standing in the herd, so the whole herd is inside
`social.alarmTicks` when it starts. The buffalo shipped at `chargeWeight: 0.7`
against an alarm of 0.75 for an afternoon: the mechanism formed commitments and
**never once acted on one**, and the demo could not have told me — the sandbox test
did. It is 0.9 now.

> ⚠ **Before setting any new weight, list what it will actually be compared against
> *in the situation the mechanism fires in*, not in general.** A weight sized against
> `fleeWeight` was sized against the wrong number.

### 3. ⚠⚠ A guard tested on the wrong species is not tested — the sixth instance

The rule that stops a pursuit suppressing `flee` is "any perceived threat cancels it
outright". On a species with the config's `fleeWeight: 2.0`, flee beats any sane
`chargeWeight` on the weights alone, so **the guard can be deleted with every test
still green**. `test/cooperation.test.js`'s `CHARGER` therefore carries the buffalo's
own `fleeWeight: 1.0`, where a predator 5.5 cells away scores 0.54 against the
pursuit's 0.9 — the weights say keep chasing and only the guard says otherwise.

Same shape as `MIXER` (P2), `HOLDER` (P3), `worth *= calfWeight` (P4), P7's
unreachable dispersal gate, and P8's double charge. **Six phases, six times.**

### 4. ⚠ The batch-2 mobbing tripwire fired for the fourth time

`test/cooperation.test.js`'s `soloMobbed` cell — solo lion attempts that are *also*
mobbed, the rarest of its 2×2 — fell from n=7 to **n=2** against a threshold of 3.
Not a regression: re-measured cumulatively across eight seeds the mobbed capture
chance runs 0.204–0.224 against an unmobbed 0.363–0.371 **at every cumulative total**.
The seed list is now `[42, 2, 3, 5, 1, 7]`, taking the cell to **n=10** — its first
real margin, at the cost of two more 6000-tick demo runs. ⚠ That block's comment
records the whole history; read it before touching a buffalo again.

## What P9 measured

**The mechanism, directly** (14 assertions): the charge and its walking control, the
self-ward refusal, the stamina reserve, the commitment outliving the ward and
expiring on schedule, the remembered position being refreshed while the threat is
visible and steered at once it is not, clearing on giving up, the world ceiling on
`pursuitTicks`, `pursuitTicks: 0` as its own arm, flee winning against a second
threat, and a save round-trip that then runs on identically.

⚠⚠ **It is inert in the demo for thousands of ticks, and that is the roster rather
than the mechanism.** With `charge.enabled: false` the world is byte-identical to the
shipped one until tick **3700** on seed 42 and **2300** on seed 1 — because a buffalo
chooses `defend` about **25 ticks in 4000** to begin with, against ~1800 ticks in
which it has any predator in view at all. Mobbing was already the rarest thing in
this world (A33); P9 changes what happens on those ticks, not how often they come.
⚠ **So do not look for a population signal here**, and do not tune toward one.

⚠ `npm run ethologist` reports **no new anomaly kind** across six worlds — the check
this phase most needed, since "a buffalo sprinting until it dies" is what a
badly-bounded charge looks like and that tool already knows how to report an animal
that covers ground and gets nowhere. Cost: **nothing measurable** (5.110 against
5.120 ms/tick, eight interleaved rounds, four paired differences up and three down),
which is the cost of *asking* — over the timed window the two arms are byte-identical.

⚠⚠ **The machine drifted ~15% between P8's cost measurement and P9's**, same day,
no code in between (5.83–6.07 against 4.96–5.39). Both tables in `BENCHMARK.md` are
interleaved pairs for exactly that reason; do not read across them.

## ⚠ Carried forward: the five things P8 learned

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
window. **Before believing any demo measurement in P10, ask what tick the thing you are
measuring actually starts at.** ⚠ P9 is the third instance: its off arm is
byte-identical for 2300–3700 ticks and then is not. `test/groups.slow.test.js` exists because of
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
  ⚠ **Neither P8 nor P9 moved them** — both still pass on the seeds recorded beside
  each — but the failure mode is *late*, never absent. ⚠⚠ **A third test of this shape
  did fire at P9**: `cooperation.test.js`'s batch-2 `soloMobbed` cell, now widened to
  six seeds (above). An audit found 13 tests of this shape; `carcass.slow` and
  `mate-choice` are next closest to the edge, and the mobbing cell has now gone first
  four times running.
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

Full suite after P9: **1315 tests, 1310 pass, 0 fail, 5 cancelled** (~14 min). The
cancelled ones are `presets.test.js`'s HTTP tests, which the command sandbox blocks
from binding a port — pre-existing, unrelated, ignore them.

```bash
npm run test:fast   # ~5 min — use this in the edit loop
npm test            # ~14 min, everything — before committing
```

`test:fast` skips demo/persistence/determinism suites and the `*.slow.test.js` files.
⚠ `--test-skip-pattern` is **silently ignored if it comes after the file arguments**;
the npm script has the order right, don't reshuffle it.

⚠ **`npm run test:ui` (Playwright) is separate and is not in `npm test`.** P10 is the
first phase in this plan that needs it, because it regenerates the fixtures the
offline renderer runs against.

⚠ `test/cooperation.test.js` got **~50% slower at P9** (its batch-2 block runs six
6000-tick demo worlds instead of four). It is now one of the slowest files in the
suite; `--test-name-pattern` does *not* help, because that block builds its sample in
an IIFE at describe time and runs whatever you select.

New size-independent guards should use
[`test/helpers/smallDemo.js`](test/helpers/smallDemo.js) (~3.9× faster) — but read
its header: legitimate for determinism and round-trip claims, **never** for
ecological ones.

## Open threads

- ⚠ **Renderer fixtures are stale** for the demo's behaviour — six phases' worth. The
  regen is deliberately deferred to P10 per DOCS §12: "regenerate after the last
  behavioural change, not after the protocol change." **P10 is that moment**, and the
  detail (which phases actually show in a 10-tick fixture, and why you should regen
  anyway) is under *What P10 has to do* → §4.
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
  null with no event, metric or log, so a cap that binds looks like the feature
  intermittently not working. P5b raised the cap to 192 against a measured peak of 35
  (37 after P8), so nothing binds today. **Making it visible is P10's**, and the
  `groups` aggregate in `metrics.js` is the place — it is already being edited there
  for mean band spread.
- ⚠ **The demo's buffalo are collapsing** — 93 alive at t3000, 18 at t9000 on seed 42.
  **Pre-existing and not P5's or P8's**: an identical run with `forms: false` gives
  identical numbers, and `BENCHMARK.md` records buffalo going 116 → 74 when P1 landed.
- **Two tests were deleted at the user's instruction** and their coverage is gone:
  determinism through the **age-death** path, and the **no-timer** tripwire.
- **Nine determinism guards are byte-for-byte the same test** in nine files. First
  place to cut if the suite needs it.
- ⚠ **P9 is the mechanism most likely to be judged by the wrong number.** It fires
  ~25 ticks in 4000 in the demo, so any population or survival reading of it is noise
  by construction. What it changes is the *shape* of the rare tick, and the shape is
  what the 14 sandbox assertions pin. Anyone re-tuning `chargeWeight` should re-read
  the `alarmFlee` collision first — that is the number it is actually competing with.
- `src/simulation/predation/` now holds `charge.js` beside `mobbing.js`,
  `cooperation.js` and `possession.js`. ⚠ P9 added no *system*: a charge is a sprint
  flag on an intent and a commitment read by the utility, both inside
  `DecisionSystem`, so a system would have been a fourth writer of `defendingId`.
- `src/simulation/social/` now holds five modules beside `dominance.js`:
  `association.js` (P3's pulls), `herding.js` (P1), `banding.js` (P2), `calves.js`
  (P4), `consensus.js` (P8). ⚠ P7 deliberately added none — it is a system pass and
  two entity fields, not an exchange rate. P8 added one because it has a per-species
  weight *and* an argument about a re-decision rule that had nowhere else to live.
