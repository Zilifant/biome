# Handoff — 2026-07-30 session (species phases 12, 13 and 14)

Supersedes the phases 10–11 handoff and absorbs it; the traps that will bite again
are repeated in §4. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and that
problem is still open (§6).

**Phases 12, 13 and 14 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) are done.** Phase 12
built the two batch-3 prerequisites — **heterospecific association** (§3.16) and
**seasonal breeding windows** (§3.11) — and shipped both inert and byte-identical.
Phase 13 shipped **batch 3: the wildebeest and the zebra**, which declare them.
Phase 14 shipped **batch 4: the leopard**, with **cover concealment** (§3.12), which
the plan had marked optional. Phases 0–11 are committed; **12, 13 and 14 are
uncommitted.**

⚠ **The world has eight species and is past PLAN-SPECIES §8's own stated stopping
point** — clans, prides, bands, cooperative hunting, contested carcasses, mobbing,
a three-tier grazing succession, a calving season, and an ambush predator.
Everything past this is refinement, and §7 says so rather than assuming the list
should be finished.

⚠ **Read §3a before touching perception.** Phase 14's mechanism was built wrong
twice, and both failures measured as *no effect* rather than as an error.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **943 passing / 0 failing**, 241 suites, plus **28 in `tests-ui`** |
| `PROTOCOL_VERSION` | 29 (unchanged across both phases, checked rather than assumed — no new event type, and two new species need none by construction since v29 publishes the roster) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged, also checked: `describeSystems()` carries only `{id, phase, priority, updateInterval}`, and an old save's `config` merges over the new defaults — a pre-phase-12 save was restored and stepped) |
| Species | **8** — gazelle, wildebeest, zebra, buffalo, **leopard** (was `predator.stalker`), lion, vulture, hyena |
| Benchmark | large-5k **129.02 ms/tick** — flat against phase 13 at the same roster size. Cover concealment costs **+2.6%** interleaved (§5) |
| Gate | phase 13 **PASS first time** (§3d). Phase 14 **PASS at 10/10 on every species** — better than its own control, which lost a seed each on buffalo and gazelle (§3a) |
| Opened | **A61** (an association weight only bites in mixed company), **A62** (a calendar mechanism meets the compressed lifespan), **A63** (a perception gate is not a predation gate) |
| Closed | The `maxGroupSize` decision §7 deferred "before batch 2" — and it turned out not to be a tuning question (§3c). **P14 measured** and its proposed lever corrected (§5) |
| Git | phases 0–11 committed (`c8bfaff phase 11`); **12, 13 and 14 uncommitted**. The user handles git |

---

## 2. ⚠ Phase 12, and the two things it found

### a. ⚠⚠ A weight that has already been spent must not be spent again

§3.16 asks for "a weight below conspecific herding", which reads as *two* things:
an associate contributes less to the herd's centre of mass, **and** the pull toward
that centre is weaker. Both were built. The second is phase 9's symmetric forage
window in a new costume — **it charges the animal twice for one fact**, because the
weight is already inside the centroid.

Not a rounding difference: herding is the weakest utility in the table, so at
`herdWeight` 0.6 a second discount of 0.5 caps the pull at **0.30 against a
`wanderBias` of 0.35** — it can never win. Measured end to end, a follower at
weight 0.5 finished **16.1 units** from the herd it was following against **16.1**
with the mechanism off. Every weight below ~0.58 was inert. The weight now means
exactly one thing: **how much of a body a member of that species is worth when the
herd's centre is worked out** — which costs A61, since it then does nothing at all
in company that is *only* the other species.

### b. ⚠ Association's second half is the reason it exists, and the plan did not propose it

§3.16 names vigilance, dilution, and short grass as the benefits and then proposes
only the herd centre — but **standing beside an animal whose warnings you cannot
hear buys nothing**. So an associate's alarm carries, on the existing wave and
under the same `maxAlarmHops` cap, with **its own switch** (`sharesAlarm`) so the
two halves can be measured apart. Dilution needed nothing: perception reports the
nearest eligible prey (A58), so a mixed aggregation dilutes risk with no term at
all.

**The breeding window needed no correction** — the first section in the plan whose
As-built records no wrong prediction — and the reason is structural and worth
copying: **it gates an existing predicate rather than adding a competitor to the
utility table.** Every expensive lesson in this project is about the second kind of
change.

---

## 3. ⚠ Phase 14, and the three things it found

### a. ⚠⚠ A perception gate is not a predation gate — and it broke the species it was written for

Cover concealment was built symmetric: brush hides whoever stands in it, and the
asymmetry comes from the leopard wanting cover while its prey wants open ground.
Measured over 3 seeds × 4000 ticks, the leopard population fell **27 → 19**. The
reason is plain afterwards and invisible before: **a mechanism that hides bodies
helps whoever hides and hurts whoever *searches*,** and a predator with twice its
prey's sight radius is overwhelmingly a searcher.

The fix is a per-species **`crypsis`** (0 by default, 1 for the leopard alone) — a
motionless rosetted cat is hidden, a herd of wildebeest in the same brush is a herd
of wildebeest. With that in, the population was **still 19**, for a completely
different reason: **mate candidates come through the same perception gate**, so a
cryptic *solitary* species had stopped finding mates. Exempting conspecifics
brought it back to 26.

⚠ **Both failures presented as a population number, three subsystems from the
cause, and neither looked like an error** — they looked like the mechanism being
badly tuned. Recorded as **A63**: everything one animal knows about another comes
through one test, so anything added there gates reproduction, guardianship and
territory too.

### b. ⚠ The ambush fires, and it still costs the leopard

The ten-seed gate passes on **all eight species at 10/10**, against a control that
loses a seed each on buffalo and gazelle — so concealment makes the world *more*
stable. Within that:

| | concealment on | off |
| --- | ---: | ---: |
| attempts launched from concealment | **34** | 21 |
| gazelle sightings of a leopard | **−24%** | — |
| capture rate | **41.1%** | 39.0% |
| leopards at t15000 (10 seeds) | **8.2** | 12.3 |
| gazelle at t15000 | **61.8** | 38.1 |

⚠ **The mechanism works and the animal is a third scarcer.** The cause was measured
rather than guessed: *not* mortality — leopard deaths are **down**, 158 against 184
— but fewer completed hunts. Prey that never sees the cat never **flees**, and a
fleeing target is what forced the sprint (`chasing = … || prey.fleeing`), so a stalk
now converts to a chase more slowly. The surprise gain does not pay for it.
⚠ Raising `chaseRange` 4 → 6 to commit sooner was tried and measured **worse** (2/3
seeds against 10/10); it is recorded in the species file rather than shipped.

**Whether that trade is right is a judgement and is left as one.** A leopard that
ambushes is the animal §10.4 asked for, and it is a third less numerous than the
generic stalker it replaced.

### c. ✅ The rename was a proven no-op, and the cost warning was wrong

`predator.stalker` → `predator.leopard` was proved **byte-identical** first — 2.36 MB
across three seeds with the two id strings normalized away — so the mass bump (45 →
60 kg) and the ambush are separately attributable from it. ⚠ **`git stash` cannot
take that baseline any more**: three phases are uncommitted, so it reverts to phase
11. The baseline was built by copying the tree and reversing the rename in the copy.

And §3.12's headline fear — that grading sight would make every ray accumulate —
did not happen, because **opacity became the top of the concealment scale rather
than a second pass over it**. The raycast keeps its derived boolean array and is
untouched; the whole mechanism costs **+2.6%**.

---

## 3b. ⚠ Phase 13, and the four things it found

### a. ⚠⚠ A real rut is not survivable in this world, and the cause is not the mechanism

The wildebeest's first window ran over **0.30 of the year**, which §3.11 had called
deliberately wide. It cost the species its existence — **1 seed in 3** against 3/3
with `breeding.enabled: false`, isolated in one command by the switch phase 12
built for exactly this. Four arms, clean dose–response:

| conception window | wildebeest at t15000 | mean |
| --- | --- | ---: |
| 0.30 of the year | **1/3 seeds** | 0.3 |
| 0.50 | 3/3 | 6.7 |
| **0.65 (shipped)** | 3/3 | **10.7** |
| none | 3/3 | 16.7 |

**The cause is two compressions meeting** (DOCS §5, now **A62**): the year is 8000
ticks *and* lifespans are compressed beside it, so a wildebeest's adult life is
under one year. A female whose cooldown ends just after the window closes does not
wait a season — she waits a lifetime. A narrow window does not slow recruitment, it
deletes most of the population's opportunities. ⚠ The lever is `ticksPerYear`, not
the window, and pulling it re-bases every seasonal measurement in the project.

⚠ **Practical note: the switch is global but the *width* is species data.** An
on/off arm is `--set=breeding.enabled=false`; a width arm is a file edit. That is
the species-block rule working correctly, and it is worth knowing before trying to
sweep a width from the command line.

### b. ⚠⚠ Measure the shift a preference causes, never the state it leaves behind

The three-tier succession reads **backwards** in raw numbers — gazelle feeds at 2.4
standing crop, wildebeest 1.3, zebra 1.2, buffalo 0.6 — because **a big animal
empties a cell in one bite**, so the biomass under it measures its appetite rather
than its taste. Against the mechanism switched off, on the same seeds, the tiers
come out in exactly the declared order: gazelle shifts **−0.97 / −1.64**, wildebeest
−0.51 / −0.62, zebra and buffalo ≈ 0. The succession is real; the obvious reading of
it is not.

⚠ **The gazelle needed no re-tune, and §8's table had scheduled that as this
phase's headline work.** It feeds at 2.29/2.52 against phase 9's 1.93/2.88 — three
more grazers did not shorten the sward enough to move it. Recorded as a prediction
that did not hold rather than a re-tune done to satisfy the plan.

### c. ⚠⚠ The herd label has no behavioural consumer, and that answers a question §7 asked

§7 deferred "is `social.maxGroupSize: 12` wrong for wildebeest?" to this batch.
Measured at 12 against 24 over 3 seeds × 15 000 ticks: **every one of the eight
species identical to the digit.** The reason is structural — herding steers at a
neighbour centroid, mobbing and collective defense count `adults` from the same
summary, alarm travels by proximity, and **nothing reads `groupId`** but the metrics
and the entity projection. The label is a *statistic*, not a mechanism.

So it was raised to 24 on reporting grounds (a herd of thirty was being reported as
three) and stays a bound rather than being removed.

### d. The passing world, first time

10 seeds × 15 000 ticks against the batch-2 roster, same seeds, one process:

| Species | batch 3 | batch-2 control | read as |
| --- | --- | --- | --- |
| gazelle | 10/10, mean 77.5 | 10/10, mean 82.4 | **−6%** — three more grazers cost it almost nothing |
| wildebeest | **10/10**, mean 8.8 | — | establishes everywhere; declines 34 → 16 → 9 and dies mostly of **age** |
| zebra | **10/10**, mean 15.4 | — | the flattest trajectory in the world (17.7 → 16.8 → 15.4) |
| buffalo | 9/10, mean 16.2 | 9/10, mean 15.8 | level — its *predation* deaths fell (145 against 194) as the pride spread out |
| stalker | 8/10, mean 6.0 | 9/10, mean 5.1 | ⚠ one seed worse on a higher mean — the incumbent to watch, as in batch 1 |
| lion | **10/10**, mean 14.8 | 9/10, mean 10.2 | **+45%** — the prey base did what §10.3 said it would |
| hyena | 10/10, mean 5.8 | 10/10, mean 7.7 | −25%, squeezed at carcasses by a bigger pride |
| vulture | 10/10, mean 307.3 | 10/10, mean 157.8 | ⚠ **+95%** — more animals and heavier ones is more carrion |

⚠ **The batch passed first time, which no batch has done**, and the reason is not
that this pair is easy: the two things that would have failed it were caught by a
**3-seed exploratory sweep** and a **one-command config A/B** before the ten-seed
gate ran. That practice is the transferable part, not the outcome.

⚠ **Nothing here is limited by grass.** The herbivores die of **dehydration and
age**, not starvation (gazelle: 1480 against 33), so §2's competitive-exclusion case
never arrived — three grazers coexist because water and lifespan bind first. The
risk was real; the reason it did not fire is a property of *this world's* limiting
factor, not proof the niche axis was unnecessary.

---

## 4. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** Still most dangerous: a guard can go
blind silently; a species-level constant is not an entity-level one; ⚠⚠ the hottest
function in the engine is arity-sensitive; an off switch must leave no trace (D30).

⚠ **A weight already spent must not be spent twice** (§2a). Two redesigns in four
phases under two names.

⚠ **Measure the shift, not the state** (§3b). A mechanism's effect is the
difference against its own control, and the after-state can read backwards.

⚠ **An off switch in a species block is not an off switch.** `config.association`
and `config.breeding` exist only because of it; `config.breeding` holds one boolean
and nothing else.

⚠ **A `deepEqual` on two large states that *do* differ will kill the runner.**
When the wildebeest declared a window, `assert.deepEqual` on two ~650 KB entity
graphs exhausted a 4 GB heap building a diff and reported nothing. Both
byte-identity assertions now compare `JSON.stringify` output, which fails in one
line. ⚠ Use that idiom for any whole-state comparison.

⚠ **A single-seed assertion about the demo is an assertion about a trajectory.**
Five broke this session and **none was a regression**: `test/habitat.test.js`
(twice moved now — see §6), `test/persistence.test.js` (its "unknown species"
example became a real species), `test/social.test.js` (compared perception's list
against a grid query taken *after* movement — a latent bug a denser world exposed),
and the two phase-12 inertness assertions, which were *designed* to be replaced
here.

⚠ **Anything that counts neighbours is a density mechanism** (phase 11), and a
breeding window is one indirectly: it concentrates conception, which concentrates
births.

⚠⚠ **A perception gate is not a predation gate** (A63, §3a). Prey, threats, **mate
candidates**, a juvenile's guardian and territorial rivals all come through one
test. Anything added there gates reproduction, and the failure shows up as a
population number three subsystems away.

⚠ **A mechanism that hides bodies helps whoever hides and hurts whoever searches**
(§3a). Symmetry is not neutrality: check which side of your mechanism the species
you built it for is actually on.

⚠ **`git stash` no longer reaches the previous phase** — three are uncommitted, so
it reverts to phase 11. `BENCHMARK.md` recorded this for benchmarks; phase 14 hit it
taking a *rename* baseline. Copy the tree and reverse the change in the copy.

⚠⚠ **`npm run fixtures:renderer` is due on every ROSTER change, not only on a
protocol bump** — which nobody had written down, so the committed fixtures still
described the *batch-1* world when phase 13 opened: no lion, no buffalo, and
offline renderer development could not see half the species the demo ships.
Regenerated here, and one UI test moved with them
(`tests-ui/event-filters.spec.js` assumed the fixtures contain no births or
deaths; they do now).

---

## 5. Measurements

- **Phase 12 inertness**: demo entity state byte-identical to HEAD across seeds
  1/2/42 at 1500 ticks (1.92 MB, matching sha256), the save differing by exactly
  100 bytes of config literal per seed.
- **Batch-3 zero-count proof** (§9's procedure, first half): both species added at
  `count: 0`, with the lion's and hyena's prey lists and the gazelle's association
  already declared — **byte-identical again**, the save differing by the two roster
  lines. That proof covers the association declaration too: a weight naming species
  that do not exist yet costs nothing.
- **The window dose–response** and the succession shift: §3a and §3b.
- **`hunts()` re-measured** at the roster §7 said would force it (the lion now
  lists three prey species): `includes` **259/362/360 ms against a `Set`'s
  372/368/368** over 20M calls, winning all three rounds. Step 30's decision stands;
  the comment in `schema.js` now records the re-measurement.
- **P14 measured**: the metrics report is **383 KB at eight species**, split
  **347 KB of bounded history (91%)** against 36 KB of current metrics (9%). ⚠ So
  the *server-side species filter* §7 proposed is the wrong lever — the history is,
  and its levers are fewer points, fewer traits in `summarizeForHistory`, or a delta
  encoding. Left open with the diagnosis corrected.
- **Phase 14's rename proof**: 2.36 MB × 3 seeds, byte-identical modulo the two id
  strings, taken against a *copy* of the phase-13 tree with the rename reversed.
- **Performance**: phase 12 **flat** (interleaved at two scenarios). Phase 13
  **+3.0% per animal**. Phase 14's concealment **+2.6%**, slower in all three
  rounds — against §3.12's fear that it would be the most expensive item in the
  plan. `BENCHMARK.md` has all three tables.

---

## 6. ⚠ Open threads

**Unchanged:** A56 (a two-member clan flaps), A57 (concealment needs cover), A34
(patrol's target is a place, not a purpose), A59, A60, A32, the `escapeHeading`
wide-pocket limitation, A51 at phase 15, and the renderer's P6/E3 and P9.

**New or sharpened:**

- **A62** — a calendar mechanism meets the compressed lifespan (§3a). The lever is
  `ticksPerYear`, and pulling it invalidates every seasonal measurement taken so far.
- **A61** — an association weight only bites in mixed company (§2a).
- **A58 re-examined and half-closed.** It was scheduled for re-examination "at batch
  3, when three grazers disagree about what a good cell is". They do, and it did not
  bite on the herbivore side — the discount does its work once the animal is
  standing there. It stays open on the **predator** side, where the lion's list is
  now three entries and the nearest-eligible rule decides which it lives on.
- ⚠ **`test/habitat.test.js` has now been moved twice by roster changes**, and the
  pattern is worth naming: a claim about *where a species ends up* stops being about
  the mechanism as soon as another species wants the same ground. It asserted the
  gazelle's cover share (phase 11 reversed it), then the buffalo's open-ground share
  (phase 13 flattened it: four grazers now contest open ground, and pooled shares
  went 78.0→79.9% buffalo and 88.3→89.7% gazelle but **82.9→79.6%** wildebeest and
  **80.9→74.9%** zebra). It now asserts **thicket avoidance**, which has headroom and
  no contest — nobody wants thicket, and the cue takes the big grazers from
  0.25–0.43% down to 0.05–0.18%.
- ⚠ **B7's constants** unchanged and still live; `carcass.decayTicks` is now feeding
  a vulture population that **doubled**.
- **A63** — a perception gate is not a predation gate (§3a). No guard on it.
- ⚠ **A18 is half-answered and the number is the open part.** Cover *can* conceal
  now, but `crypsis` is 0 for every herbivore, so what shipped is an ambush
  mechanism rather than a prey refuge. Raising prey crypsis is a real change to
  every predator's living and wants its own gate.
- ⚠ **The ambush is bounded by how little cover exists** — 3% of the map, which is
  the same ceiling A57 hit for the hidden fawn and the same argument for **A51**.
  Two open items now share one lever.

**Unchanged, and the user explicitly chose to skip them:** edge/corner congregation
and disturbance size (`NOTES.md` Tier 1). ⚠ There are now **eight** swept results to
re-run afterwards.

---

## 7. Next step: phase 15 — A51, the `diet` list, sex-specific territory — or stop

⚠ **§8's "reasonable stopping point" was phase 13, and phase 14 has gone past it.**
Eight species, every mechanism in the plan exercised by a shipped animal, and the
one remaining ❌ row in §2's table is the `diet` string. Continuing is a decision
worth taking deliberately rather than by momentum — the remaining phases are
refinement, and phase 15 is the largest single piece of work left in the document.

If it continues, phase 15 is **A51 (the dynamic shrub layer) + the forage-source
list replacing `diet` + sex-specific territory**, and four things now point at it:

- ⚠ **A51 is the answer to two separate findings, not one.** It was already the
  lever for **A57** (a fawn is only concealed if born on cover, ~8–10% of the time)
  and it is now the lever for phase 14's ceiling too: the ambush is bounded by
  cover being **3% of the map**. More cover raises both with no behavioural change
  at all.
- ⚠ **§5.7 must move in the same commit as the `diet` change** — it only breaks
  when `diet` stops being a string, so the fix is untestable before then.
- ⚠ **A protocol bump and fixture regeneration are due** if the shrub layer lands
  (a new world layer on the wire), and `SUPPORTED_PROTOCOL_VERSION` must move with
  it — see D31, which is exactly the miss that stayed green.
- ⚠ **Prey crypsis is the open number left by phase 14** (A18). The machinery is
  built and pointed only at the leopard; raising it for herbivores changes every
  predator's living at once and wants its own gated arm.

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

Unchanged:

- `carcass.decayTicks` — ⚠ live, and now feeding twice the vultures.
- `hunting.captureStaminaCost` — flat against a `maxStamina` spanning 80 (lion) to
  140 (zebra); the leopard's 90 joined that spread at phase 14.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume, in a world whose
  animals differ 100× in mass.
