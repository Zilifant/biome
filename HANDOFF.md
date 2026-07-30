# Handoff — 2026-07-30 session (species phase 10)

Supersedes the phase-9 handoff, which it absorbs; its traps are still live and
repeated in §4. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

**Phase 10 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) is done** — cooperative
hunting, mobbing, and the A32 geometry fix. Phases 0–4 are committed; **phases 5,
6, 7, 8, 9, and 10 are uncommitted.**

⚠ **Read §2 before touching any of the three.** Two of them shipped in a shape the
plan did not propose, and the third — the A32 fix the docs have named as "the only
lever left standing" since Step 23 — **was built, measured, and does nothing.**
That measurement is the phase's real result.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **886 passing / 0 failing**, 225 suites (+26 from phase 10's own suite), plus 28 in `tests-ui` |
| `PROTOCOL_VERSION` | 29 (unchanged, and checked rather than assumed — see §2c: mobbing needed **no** new event type, because a mobber *is* what `entity.defended` already means) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged — the mechanism stores nothing new; a mob is read off `defendingId`, which was already saved) |
| Species | **4** — gazelle, stalker, vulture, hyena |
| Benchmark | large-5k **80.86 ms/tick** (2026-07-30, 5983→7546 entities) — phase 10's own interleaved A/B measured **flat**, and ⚠ 80.86 is *not* comparable to phase 9's 79.06: different session, and the machine drifts ~10% across a day on identical code. The A/B is the measurement; this is the dated reading |
| Closed | nothing outright. **A33 is implemented but inert** (no species mobs) and moves to DOCS §1.2 |
| Opened | **A59** (cooperative hunting cannot make a pride take prey a lone hunter would refuse) |
| Gate | 10 seeds × 15 000 ticks, `decision.defendTargeted` on against off: **PASS**, every species ≥8/10 |
| Git | phases 0–4 committed; **5–10 uncommitted**. The user handles git |

---

## 2. ⚠ Phase 10, and the three things it found

The deliverable is small: a species may state `hunting.cooperationWeight` (hunt
together) or `behavior.mobWeight` (turn on a predator that has gone for a
groupmate), and **neither is declared by any shipped species**, so the demo is
byte-identical. Everything below is what the phase actually cost and learned.

### a. ⚠⚠ Mobbing is not a new action — it is the half of `defend` nobody built

`PLAN-SPECIES.md` §3.7 proposes mobbing as a `flee` alternative, and its reasoning
is right (it must not compete with foraging). But it points at an action that did
not need to exist. DOCS §7 Decision has described `defend` as *"a predator is on
kin **or a groupmate**; stand and face it"* since Step 23 — and only the **kin**
half was ever implemented.

So mobbing shipped as a second *trigger* for an existing action: same intent, same
`defendingId` field, same slot in the utility table, its own weight because a
herdmate is a different risk from your own calf. The candidate set is exactly the
size it was, and the effects land on `shielding` and `trampleChance`, which
already existed.

**The rule worth carrying:** ⚠ *before adding an action, check whether the action
you want is already described by an existing one and merely unimplemented on one
branch.* Six steps of "give existing machinery a reason" turned into "give an
existing action its second reason", and the whole §9 Decision hazard (a new
movement behaviour competes with foraging, and foraging must win) never came up.

### b. ⚠⚠ The A32 lever was built, measured, and is not the constraint

DOCS A32 has named one fix since Step 23: relax "the calf must be nearer the
predator than I am" to "near enough to interpose". Territory failed to move A32
(Step 24), the hidden-fawn stage failed to move it (phase 8), and this was
explicitly *"the only one left standing"*.

Built as `decision.interposeSlack`. Measured, demo, 2000 ticks × seeds 1/2/42,
`entity.defended`:

| arm | events |
| --- | --- |
| strict (today) | 1 / 1 / 0 |
| slack 2 | 0 / 1 / 0 |
| slack 6 | 0 / 1 / 1 |
| **no test at all** (slack ∞) | 0 / 1 / 1 |

**Removing the clause entirely does not move the thing it was blamed for.** It
still perturbs the world — slack 2 was enough to flip a phase-9 single-seed
assertion — so it ships at **0**, its identity. A knob that changes the world and
buys nothing is not a fix.

⚠ **Measuring the whole chain instead of the last link is what produced a
diagnosis** (2000 ticks, seeds 1/2/42):

| | s1 | s2 | s42 |
| --- | ---: | ---: | ---: |
| hunter-ticks with a committed target | 1513 | 1587 | 1466 |
| …on a **juvenile** | 119 (7.9%) | 141 (8.9%) | 93 (6.3%) |
| …whose parent is alive | 88 | 45 | 38 |
| …and within 6 units of the hunter (what a gazelle can perceive) | **4** | **2** | **1** |
| capture attempts on a juvenile at all | 4 | 3 | 4 |

There are **one to four opportunities per 2000 ticks before any geometry test
runs**. No ward-selection rule can be the fix, because ward selection is not what
is scarce: predators commit to adults 91–94% of the time, and the mother is almost
never within perception of the hunt. The remaining levers are **prey selection**
and **perception radius / `defendRange`** — species biology, to be settled against
the buffalo cow in phase 11, not against the only species in the demo that has
young.

One change did ship from this pass, on correctness rather than measured effect:
`decision.defendTargeted` makes a parent defend **the calf the hunter actually
committed to** rather than whichever calf is nearest the predator. Before it, a
mother could stand over a calf nothing was hunting.

### c. Mobbing needed no protocol bump, and that was checked rather than assumed

A mobber is reported through **`entity.defended`** — *"an adult putting itself
between a predator and a groupmate or its own young"*, which is exactly what it
is. So there is no new event type, no `SUPPORTED_PROTOCOL_VERSION` bump, and no
fixture regeneration. ⚠ Contrast `entity.contested`, where reuse *would* have made
the UI lie (a carcass fight is not a fight over a mate) and phase 4 correctly took
the bump instead. **The test is whether the existing type's stated meaning already
covers the new fact, not whether the payload happens to fit.**

### d. What cooperation cannot express, stated rather than discovered later (A59)

`attackersFor` counts the other hunters on the same quarry — same species, and the
same group record when the hunter has one — and multiplies `captureChance`. A
predator with nothing of its own in sight also joins a conspecific's committed
chase (⚠ a `chase`, never a `stalk`: a stalk is not yet a hunt, and a chase bounds
the geometry for free).

⚠ **But prey eligibility is resolved per animal in perception (§3.6), where it
cannot know whether help is at hand.** So "prey no single hunter would commit to,
that a pride will" is *not* expressible: somebody has to start the hunt, so a
cooperative species needs a mass ceiling high enough to commit **alone**, and
cooperation then supplies the odds rather than the eligibility. A lion at
`maxPreyMassRatio: 3.5` will single-handedly commit to a buffalo and usually fail,
where the truth is that it would not try. Named fix: a second, cooperative ceiling.
**Decide it in phase 11 with the buffalo in front of it** — deciding it now would
be inventing a number for a case that does not exist yet.

---

## 3. What the mechanisms do, and why nothing measures them yet

⚠ **Both halves ship inert, and that is the plan's instruction rather than a
shortcut.** §9 is explicit that a cooperative capture only pays when the prey is
too large for one hunter, so `cooperationWeight` is built at phase 10 and tuned at
phase 11; mobbing is the same argument with the buffalo instead of the lion. A
weight fitted to a 30 kg gazelle that a single hyena takes solo would be re-tuned
twice.

So the claim this phase can make is **resolution plus inertness**, not effect:

- **Inertness is proved byte-identical**, not merely "no measurable difference":
  400 demo ticks at seed 42 with `cooperation.enabled` and `mobbing.enabled` both
  off produce identical serialized entity state (`test/cooperation.test.js`).
  ⚠ Take that reading while the roster still declares nothing — once a species
  states a weight the arms diverge by design and the check is gone (the same
  warning phase 9 recorded, and phase 3 before it).
- **A companion test asserts no shipped species declares either weight**, so the
  byte-identity claim cannot quietly become false when one does — the failure would
  otherwise read as a determinism bug rather than as the roster change it was.
- **Resolution is asserted directly** (26 tests): who counts as a co-attacker, that
  "conspecific" tightens to "same group record", that joining never takes a hunter
  off prey of its own, that a mob is found from `defendingId`, that kin outrank the
  herd, and that both world switches are real off switches.

**Gate** (10 seeds × 15 000 ticks, `decision.defendTargeted` on against off — the
one part of the phase a shipped world can feel):

| Species | on | off (control) |
| --- | --- | --- |
| gazelle | **10/10**, mean 88.7 | 8/10, mean 94.3 |
| stalker | 8/10, mean 4.8 | 9/10, mean 4.8 |
| hyena | 10/10, mean 3.7 | 9/10, mean 3.0 |
| vulture | 10/10, mean 140.7 | 10/10, mean 119.1 |

⚠ **Read this as "no cost", not as "a gain".** The control loses gazelle seeds 7
and 10 late (t13291, t14275) — *the same two seeds at the same two ticks phase 9
recorded losing*, so the control faithfully reproduces the phase-9 world — and the
arm keeps them. But the mechanism fires a handful of times per thousand ticks and
cannot plausibly hold up a population; on a species whose final range is 0–242,
D14 says two seeds is the signature of a reshuffled trajectory. The honest
statement is that the gate passes and nothing is materially worse.

---

## 4. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** Still most dangerous: a guard can go
blind silently; a species-level constant is not an entity-level one; ⚠⚠ the
hottest function in the engine is arity-sensitive; an off switch must leave no
trace (D30).

⚠ **An off switch in a species block is not an off switch.** Inherited from phase
8 and now applied twice more by construction: `hunting.cooperationWeight` and
`behavior.mobWeight` are the biology, and their switches live in the new global
`config.cooperation` / `config.mobbing`. **Any per-species mechanism that needs a
reproducible control has this shape.**

⚠ **Before adding an action, re-read what the existing actions claim to do.**
`defend` had promised the groupmate case for twenty steps (§2a). The docstring was
the specification and the code was the subset.

⚠ **Measure the whole chain, not the last link.** A32 was blamed on its final
clause for three phases because that is the clause anyone reads. Counting the
funnel — how often a predator even targets a juvenile, how often that juvenile has
a living parent, how often that parent is within perception — took twenty minutes
and moved the diagnosis off the clause entirely (§2b).

⚠ **A single-seed assertion about the demo is an assertion about a trajectory.**
Two of them broke this session on changes that fire a handful of times per thousand
ticks, and neither break was a regression:

- `test/habitat.test.js`'s cover share (phase 9) is thinnest at exactly the seed it
  was pinned to. **Now pooled over three seeds**, with the per-seed numbers in the
  failure message.
- `test/carcass.test.js` compared the standing carcass count at tick 9000 against a
  **1-in-100 sample** of the interior — an assertion about where the sampling
  landed. **Now states the claim directly**: the count falls repeatedly over the
  run, and removals outnumber standing bodies.

⚠ **Phase 11 adds two species and will move every such number again.** Expect to
recalibrate rather than to debug.

---

## 5. Measurements

- Inertness: byte-identical serialized entity state, 400 demo ticks at seed 42,
  both switches off against both on.
- A32: the slack sweep and the funnel in §2b (2000 ticks × seeds 1/2/42).
- Gate: 10 seeds × 15 000 ticks, `--set=decision.defendTargeted=true
  --controlSet=decision.defendTargeted=false`, in one process over the same seeds.
- Performance: **flat.** Interleaved medium-1k, three rounds alternating all three
  phase-10 switches: 9.229 (off) vs 9.190 (on) ms/tick, "on" slower in **2 of 3**
  rounds with the ranges overlapping — no effect either way. ⚠ Entity counts
  **identical** (1147), so the comparison is not quietly measuring a population
  difference.

---

## 6. ⚠ Open threads

**Unchanged from the last handoff:** A56 (a two-member clan flaps — fix not before
batch 2), A57 (concealment needs cover), P14 (metrics payload at a long roster),
A34 (patrol's target is a place, not a purpose), A58 (perception reports the
nearest food cell, not the best), the `escapeHeading` wide-pocket limitation, A51
at phase 15, and the renderer's P6/E3 and P9.

**New or sharpened by phase 10:**

- **A32 stays open with a new diagnosis and no named lever left in the defense
  code** (§2b). The two candidates are prey selection favouring juveniles and a
  wider sensory radius for a species whose defense is meant to matter — both
  species biology, both for phase 11.
- **A33 is implemented and inert**; it closes when a species mobs.
- **A59 is new**: cooperation cannot make a pride take prey a lone hunter would
  refuse (§2d).
- ⚠ **Neither new weight has ever been tuned in a world.** Phase 11 is the first
  time either mechanism does anything at all, so budget a failed gate for it — as
  phase 7 did for the hyena and phase 9 for forage guilds. §11.1's rule stands:
  budget a failed gate per net-new species, not per batch.

**Unchanged, and the user explicitly chose to skip them:** edge/corner
congregation and disturbance size (`NOTES.md` Tier 1). ⚠ Both move where animals
are and how often they die, so both need a fresh multi-seed sweep — and there are
now **six** swept results to re-run afterwards (phase 1/2 energy, phase 4
possession, phase 7 batch 1, phase 8 concealment, phase 9 forage guilds, phase 10
targeted defense). `npm run sweep --set=` makes each arm one command.

---

## 7. Next step: phase 11 — batch 2, lion + buffalo

The first phase in which phase 10's mechanisms do anything. Five warnings, four
inherited and one from this session:

- ⚠ **Check `minHungerToHunt` first.** The lion is the same shape of animal as the
  hyena — a large carnivore that also scavenges — and §10.1 records exactly how
  that failed its first gate: a carrion-subsidised predator is not limited by its
  prey, and it ate the gazelle to extinction in 7 of 10 seeds at a stalker-ish
  value.
- ⚠ **`buffalo` needs `mobWeight` above `fleeWeight` (2.0) or it will simply
  run**, and `minMobbers` decides whether a mob is a herd or a pair.
- ⚠ **A59 is a decision the buffalo forces** (§2d): give the lion a
  `maxPreyMassRatio` high enough to commit to a buffalo alone and accept that it
  will try alone, or build the second cooperative ceiling. Do not build the ceiling
  speculatively.
- ⚠ **Do not tune `cooperationWeight` against the gazelle** — unchanged from the
  phase-9 handoff, and now also true of `mobWeight`.
- **New:** the shape phase 10 shipped in is worth holding to. `attackersFor` and
  the mob each modify an existing product; if either turns out to need to influence
  *where* an animal goes, bend an existing cue rather than adding a competitor to
  the utility table (the phase-9 §2c/§2d rule).

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock; interacts
  with possession. ⚠ **Phase 11 is where this finally bites**, because the buffalo
  is the 600 kg body.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`, and
  ⚠ the hyena is the first species to differ on `maxStamina` (120 vs 100), so the
  ratio it implies is no longer uniform. Re-check when the lion arrives — which is
  now.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
