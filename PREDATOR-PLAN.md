# Social predators — lions and hyenas

**Status: P1 shipped 2026-08-07. P2–P8 not started.** Eight phases.

The brief is the seven asks in the original file, kept verbatim at the bottom.
This is the implementation plan for them, in an order that lands each mechanism
before the data that spends it.

## Context — what already exists

Most of this is not new machinery. Read these before writing anything:

| The ask needs                                            | Already exists                                                                                                                   | Where                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A pride/clan that survives separation                    | `GroupRegistry` + `GroupSystem` — records, join/leave/dissolve, guardian inheritance, sex-biased departure, `dissolveGraceTicks` | `world/GroupRegistry.js`, `systems/GroupSystem.js` |
| Founders starting _as_ a pride                           | `config.cohorts` + per-species `cohort: { groupSize, spread }`                                                                   | `fixtures/createDemoSimulation.js`                 |
| Several hunters on one quarry                            | `attackersFor` / `cooperationBonus` / `adoptedPrey`, tightened to "same group record" by `huntsTogether`                         | `predation/cooperation.js`                         |
| Age-structured prey selection                            | `predation.maxPreyMassRatio` / `minPreyMassRatio` read against `bodyMass`, not `adultMass`                                       | `predation/predation.js`                           |
| A carcass with an owner, and a contest for it            | `possessorId`, `holderOf`, `outranks`, `shareFor`                                                                                | `predation/possession.js`                          |
| A free count of "how many of my own band are next to me" | `world.social.get(id).bandmates`, counted inside `herdRadius` (6)                                                                | `systems/SocialSystem.js:472`                      |

Three open items in `ACTION-ITEMS.md` **are** three of these asks, already
diagnosed with the fix named:

- **A59** — "a pride cannot take prey a lone lion would refuse". Eligibility
  resolves per animal in perception, which cannot know whether help is at hand.
  → P3.
- **A60** — "territory is an individual claim, so a social species cannot hold
  ground". `retreat` moves a lion off ground a pride-mate marked, so the lion
  ships `defends: false`. → P6.
- **A58** — perception reports the _nearest eligible_ prey, so a prey **list** is
  a statement about what an animal spends its life on. A lion that also listed
  gazelle took **2 buffalo in 4000 ticks**. → the standing risk on P5.

## Rules this plan obeys

Each has a recorded failure behind it (`DOCS.md` §16, and the retired plans).

1. **No species-id conditionals in `src/simulation`** — `test/species-schema.test.js`
   greps for them. Every behavioural difference below is a species field.
2. **A species block beats the config**, so every world-level switch lives in a
   global config section, never inside a species block.
3. **No new rows in the utility table.** Nothing here adds an action. New
   steering lands on an existing action's target, and new strength lands on a
   term of a product that already exists.
4. **Two systems never write the same entity field.**
5. **One neighbour grid walk per tick, and it is perception's.** New counts reuse
   `world.social` / `world.neighbourhood` or are gated on a species weight so a
   species that declares nothing pays one property read.
6. **Every mechanism ships an `enabled` switch and a 0-is-the-identity weight**,
   so its off arm is a byte-identical control.
7. **Derived on read, not stored**, wherever the answer is a pure function of
   present state — the rule that keeps dominance, possession, and group centres
   out of the save file.

---

## P1 — One pride, by construction (data only) — ✅ **SHIPPED 2026-08-07**

_Serves: Lions 1._

All lions in one pride, temporarily and for simplicity.

**Change** — `config/species/predatorLion.js` only:

- `cohort: { groupSize: 64, spread: 8 }` — one anchor for every founder, so the
  whole roster founds a single record on tick 1. `spread` up from 4 because
  `locomotion.maxOccupantsPerCell: 2` refuses a tight stack.
- `groups: { forms: true, maxMembers: 64, leavingSex: 'none' }` — nobody leaves
  at dispersal, and the record has room for the population to grow into.

**Why this is enough, and where it is only "by construction".** Founders start in
one cluster ⇒ one record. `inheritFromGuardian` puts every cub in its mother's
record. `leavingSex: 'none'` means nothing ever removes a living member. So the
single pride holds without a new rule — but it is an _initial condition plus no
departures_, not an enforced invariant: a lion that somehow ends up unattached
more than `groups.joinRadius` (6) from a pride-mate has no way back. State that
in the file rather than claim an invariant.

⚠ `leavingSex: 'none'` is what makes the pride female-cored today. Giving it up
is the "temporary" the ask asks for; record it in the species file so restoring
male dispersal is one field, not an archaeology exercise.

**Risk.** `maxMembers: 64` against `config.groups.maxGroups: 192` — no capacity
concern. A 64-member record makes `GroupSystem`'s per-record walks 8× longer for
one species; bounded and small, but it is the first record over 16.

**Test** (`test/groups.test.js`, sandbox, ~50 ticks): every living lion shares one
`groupRecordId` at tick 1 and after a birth. Update `test/cohorts.test.js`, which
currently asserts the 4+1 split.

### ✅ As built — 2026-08-07

Shipped as three fields in `config/species/predatorLion.js` and no engine change,
as planned. Two things the plan got wrong:

⚠⚠ **`spread` was raised 4 → 8 and had to be put back, and the reasoning was
inverted.** The plan argued that 64 founders cannot fit inside a radius-4 disc
because `locomotion.maxOccupantsPerCell` (2) refuses a full cell. They fit — ~50
cells at 2 occupants is ~100 slots — and lion rosters of 5/12/20/40/64 all found
**one record with nobody unattached** at spread 4 on every seed tried.

What spread 8 actually broke was the founding. A record forms by single-linkage
through `groups.joinRadius` (6), and at spread 8 two founders can land 16 apart
with too few animals between them to chain. Measured, ten seeds, lion records on
tick 1:

| `cohort.spread` | seeds founding **one** pride |
| ---: | ---: |
| 2, 3, 4 | 10 / 10 |
| 5 | 8 / 10 |
| 6 | 6 / 10 |
| 8 | 4 / 10 |

**A sparser cluster is the failure mode, not a denser one** — the opposite of the
plan's intuition — and a split pride is permanent, because records never merge
(`GroupSystem` rule 6). This is A84's shape again (a radius moved without its
geometric partner), caught by the test rather than by review.

⚠ **Two tests asserted the old arithmetic and both were about the roster rather
than the mechanism.** `cohorts.test.js`'s stranded-lion test asserted `5 % 4 === 1`
and is replaced by the P1 claim; its registry-cap test read `maxMembers` off
`config.groups` when `GroupSystem` resolves the species' block over it (DOCS §8),
so the test that exists to catch config/species drift was itself drifting.

✅ **It holds over a real run, and `maxMembers` is what makes that true.**
Measured on the demo, 6000 ticks, lions / prides / unattached:

| seed | t1 | t1500 | t3000 | t6000 |
| ---: | --- | --- | --- | --- |
| 1 | 5 / 1 / 0 | 4 / 1 / 0 | 4 / 1 / 0 | **6 / 1 / 0** |
| 42 | 5 / 1 / 0 | 5 / 1 / 0 | 5 / 1 / 0 | **8 / 1 / 0** |

Cubs are born into the pride and nothing leaves it, so the record simply grows.
⚠ Seed 42 reaches **8 members by tick 6000, which is exactly the config's
`maxMembers`** — so without the raise to 64 the next cub would have been refused
silently and the pride would have started shedding animals into second records
from there. The headroom was not a precaution.

⚠ **Not asserted in the suite**, deliberately: 2 seeds × 6000 demo ticks is ~1.5
minutes of CPU for a claim the ~4-tick sandbox test already makes about the
mechanism. Recorded here as a measurement instead.

**Cost.** No new state, no save-format change, no protocol change, no measurable
tick cost — `GroupSystem`'s per-record walks are longer for one record of five.

---

## P2 — Hyena clans sized from the roster (fixture only)

_Serves: Hyenas 1._

Clan count derived from the founder count; clans placed apart.

**Change** — `fixtures/createDemoSimulation.js` and `config.cohorts`:

1. **Size rule.** A species may declare `cohort: { preferredGroupSize, maxGroups }`
   instead of a literal `groupSize`. The fixture resolves
   `clans = clamp(round(count / preferredGroupSize), 1, maxGroups)` and
   `groupSize = ceil(count / clans)`. For the hyena, `preferredGroupSize: 10`,
   `maxGroups: 5`:

   |             founders | clans | clan size |
   | -------------------: | ----: | --------: |
   | 20 (`default-small`) |     2 |        10 |
   |                   30 |     3 |        10 |
   |                   60 |     5 |        12 |
   |                  100 |     5 |        20 |

   That is the ask exactly: it optimizes for size (8–12) until 5 clans is
   reached, then optimizes for count. ⚠ At 100 founders the clan size runs past
   12; the ask caps count, not size, so this is the ask rather than a defect.

2. **Separation.** `config.cohorts.minClusterSeparation` (world-level; 0 is the
   identity). Anchors are rejection-sampled against already-placed anchors _of
   the same species_, bounded by `cohorts.placementAttempts`, falling back to the
   first draw. ✅ **Shifting the `worldgen` stream is accepted** (decision,
   2026-08-07): every seeded world will differ from today's, and that is the cost
   of a founding change rather than a reason to defer one. Still write the loop
   so that at 0 it draws nothing extra — the off arm is worth having as a control
   even though nothing is being held byte-identical.

3. `groups.maxMembers: 16` on the hyena (from the config's 8), or a clan of 10
   cannot exist. ⚠ A clan at the cap refuses joiners, who then found a _new_
   record — so clan count creeps upward over a long run. Stated limit; measure
   peak concurrent hyena records in P8 rather than assume.

**Risk.** This is the one phase that is **not byte-identical** once
`minClusterSeparation > 0`: founding placement changes, so every seeded world
changes. That is expected for a founding change and is why the off arm is a
config number rather than an argument.

**Test** (`test/cohorts.test.js`, ~1 tick): the resolver's table above, as a unit
test on the rule; plus a demo assertion that hyena records at tick 1 number 2 and
that their centres are ≥ `minClusterSeparation` apart.

---

## P3 — A cooperative prey ceiling (closes A59)

_Serves: Hyenas 3, and the "collectively decide" half of Lions 2._

Larger groups commit to larger prey. **This is the phase the other predator asks
lean on**, so it lands before any of them.

**Change** — `predation/predation.js` and `PerceptionSystem`:

- Two new fields in the `predation` block:
  `groupPreyMassRatio` (a second, higher ceiling; `null` = no second ceiling)
  and `groupSizeForLargePrey` (how many band-mates it takes to reach it).
- `maxPreyMassFor(hunter, predation, backing)` returns the group ceiling when
  `backing >= groupSizeForLargePrey`, else the solo ceiling. Absent field ⇒ the
  function is what it is today, exactly.

**Where `backing` comes from, and why it costs nothing.** `SocialSystem` already
publishes `world.social.get(id).bandmates` — record-mates inside `herdRadius`
(6) — for P7's rally, counted for every animal whatever its species declares. The
perception loop hoists the mass bounds once per animal; it reads this there, in
the same place, and the in-loop test stays a single numeric compare. **No new
traversal anywhere.**

⚠⚠ **It is last tick's count, and that must be stated rather than discovered.**
`PerceptionSystem` is in the `perception` phase; `SocialSystem` is in `decision`.
So perception reads the summary written on the previous tick. This is precedented
— the band affinity reads last tick's `groupRecordId` for the same reason
(`DOCS.md` §9) — and it is harmless in steady state, but any test asserting on a
freshly-assembled group must step ≥ 2 ticks. Verify `world.social` is refilled by
`SocialSystem` rather than cleared before perception runs.

**Data.**

- Hyena: `groupPreyMassRatio: 5.0` (60 kg × 5 = 300 kg — an adult zebra, a
  subadult buffalo), `groupSizeForLargePrey: 4`. Solo ceiling stays `1.0`.
- Lion: `groupPreyMassRatio: 4.5`, `groupSizeForLargePrey: 2`. ⚠ The solo ceiling
  stays **3.5** — deliberately still above an adult buffalo, because the ask says
  a solo hunt on an easy or urgently-needed target must not be precluded. The
  second ceiling is what lets a pride reach the top of the zebra/buffalo range a
  lone lion refuses.

**Off arm.** `groupPreyMassRatio: null` on both ⇒ the comparison is never made ⇒
bit-identical to today.

**Risk.** This is the first thing in the engine where _what an animal can see as
prey_ depends on who is standing next to it. A clan that gathers and disperses
flips eligibility, and A58's failure mode — "a target that stops being eligible
mid-stalk is a hunt that evaporates" — is exactly what that produces. Measure
abandoned stalks, not only captures.

**Test** (`test/predation.test.js`, sandbox, ~10 ticks): one hyena beside a
250 kg zebra does not perceive it as prey; four hyenas of one record do. Plus the
identity test with the field absent.

---

## P4 — Coordinated stalking

_Serves: Lions 2 (the "before a member has entered `chase`" half)._

**Change** — `predation/cooperation.js`:

1. **A stalk becomes joinable.** `adoptedPrey` today accepts only
   `other.action === 'chase'`, on the stated grounds that "a chase bounds the
   geometry for free". Accept `'stalk'` too, gated on a new world-level
   `cooperation.joinStalks` (default `false` = today's behaviour, byte-identical).
   The geometry bound is then carried by `cooperation.joinRange` (12) and the
   caller's perception-radius gate alone, which is what `joinRange` was written
   to do. ⚠ Keep the two other guards untouched: only a predator with **no prey
   of its own** joins, and only within its own record.

2. **Approach spread** — the nearest legal thing to flanking. A joiner's `stalk`
   steers at a point offset around the quarry rather than at the quarry itself:
   bearing = (quarry→joiner bearing) rotated by
   `k × 2π / n`, where `n` is the co-stalker count from `attackersFor` and `k` is
   this animal's rank in the record's ascending `memberIds` among those
   co-stalkers. Deterministic, no per-pair state, no repulsion, no stored
   formation. It changes an existing action's **target point**, not the utility
   table. Gated on `cooperation.approachSpread` (0 = the quarry itself = the
   identity).

⚠⚠ **This is approach-from-distinct-bearings, and it must be claimed as that
and not as encirclement.** See _Cannot be built as asked_ below.

**Risk.** Joining a stalk widens the window in which several predators are
committed to one animal, which raises `attackersFor` and therefore capture odds
across the board — the effect is not confined to the new behaviour. Expect the
capture rate to move and budget a `cooperationWeight` re-tune in P5.

**Test** (`test/cooperation.test.js`, sandbox, ~30 ticks): three pride-mates and
one buffalo, none yet chasing — all three end on the same `huntTargetId`; their
bearings to the quarry are separated by ≥ some floor. Cost: ~100 ticks total, no
demo world.

---

## P5 — The prey partition comes out (data only)

_Serves: Lions & Hyenas 1, Hyenas 2._

**This is the ecological phase and the riskiest one**, which is why it is fifth
rather than first: with P3 and P4 in place, the mass ratios do the partitioning
that the species lists are doing today.

### ✅ The prey **floor** landed early — 2026-08-07, with P1

`minPreyMassRatio` was lowered for all three hunting species so that a predator
takes the small, easy animals within its reach:

| species | was | now | floor |
| --- | ---: | ---: | ---: |
| lion | 0.2 | **0.05** | 36 kg → 9 kg |
| hyena | 0.08 | **0.03** | 4.8 kg → 1.8 kg |
| leopard | 0.08 | **0.03** | 4.8 kg → 1.8 kg |

⚠ **The lion's was not inert and the old value was a defect on its own terms.** A
36 kg floor is above a newborn wildebeest (18 kg) and a zebra foal (30 kg), so a
lion walked past the calves of two of the three species on its own prey list —
the opposite of what `minPreyMassRatio` is for. Every floor still refuses a
newborn hyena (1.5 kg), and the lion's still refuses a vulture (6 kg).

⚠ **It is unmeasured**, and it lands ahead of the sweep that would have measured
it. What it takes away is the gazelle's recruitment protection: the hyena's old
floor was explicitly argued in its own file as "a real protection for the
gazelle's recruitment", and that is now gone. **The gazelle is the species to
watch** when P5's sweep runs, alongside `behavior.minHungerToHunt`, which is the
number that actually limits a carrion-subsidised predator.

⚠ `test/predation.test.js` asserted `minPreyMassRatio === 0.08` as a literal. It
now asserts what the floor *admits* — below every listed prey's birth mass, above
a newborn of the hunter's own kind — which is the claim the number exists to make
and survives the next tuning pass (D1).

The rest of P5 — the two prey **lists** — is unchanged and still waits on P3/P4.

**Change** — two species files:

- Lion `preySpeciesIds: [buffalo, wildebeest, zebra, gazelle]`. ⚠ Adding gazelle
  is close to inert by arithmetic: `minPreyMassRatio: 0.2` × 180 kg = 36 kg, and
  a gazelle tops out at 30 — so only a **subadult** lion (bodyMass ≤ 150) is
  admitted to adult gazelle. That is the mass floor doing the partitioning
  instead of the list, which is precisely what the ask wants.
- Hyena `preySpeciesIds: [gazelle, wildebeest, zebra, buffalo]`. This is the real
  change: solo hyenas take zebra foals and buffalo calves under the 60 kg
  ceiling, and clans of four reach adult zebra under P3.
- Hyena `hunting: { cooperationWeight: 0.3, maxAttackers: 5 }` — its first
  declaration. `maxAttackers` up from the config's 3 because a clan is bigger
  than a pride and the cap is what stops a crowd being a certainty.

**Risk — read A58, A73, A76 before running this.** Three consecutive phases have
already reshuffled this guild's carrion. Two failure modes, both previously
measured on this exact pair of species:

- _A58._ A wider list makes perception report a nearer, smaller animal, and the
  species stops doing what it was built for. The lion has failed this once (2
  buffalo in 4000 ticks).
- _The hyena's phase-7 failure._ A carrion-subsidised predator is not limited by
  its prey, and can eat that prey to extinction without going hungry.
  `behavior.minHungerToHunt: 0.75` is what couples it back; **check it first if
  this phase misbehaves.**

**Measurement.** This phase does not ship on a unit test. Ten seeds × 15 000
ticks, `npm run sweep -- --control=…`, per `DOCS.md` §20 — watching all four
grazers, both predators, and the leopard and vulture that share the carrion.

---

## P6 — Pride territory (closes A60)

_Serves: Lions 3._

**Change** — read-side only. Claims stay keyed on entity id; **ownership is read
through the record**:

- New predicate, beside `outranks` in the social/predation helpers:
  `sharesClaim(world, entity, ownerId)` → `ownerId === entity.id`, or the owner
  is alive and shares a non-null `groupRecordId` with `entity`.
- `DecisionSystem`'s `intruding` (line ~798) uses it, so a lion standing on a
  pride-mate's mark is not an intruder and `retreat` never fires. **This is the
  whole of A60's symptom**: the lion ships `defends: false` today because
  `retreat` scattered the pride and cooperative hunting measured _zero_ shared-
  quarry ticks in 8 000.
- `TerritorySystem`'s dispute path uses it, so pride-mates never contest ground.
- Lion `territory: { defends: true, rangeRadius: 30, settleTicks: 1600 }`.

**Why read-side rather than a second array.** A `groupOwner` layer in `ScentGrid`
would be new persisted state that can disagree with the registry, and a
save-format bump. Deriving it on read is the same judgement that keeps possession
held by presence and group centres out of the save — and it costs one id lookup
on a path that is already an O(1) grid read.

**Stated limits** (record them, do not half-build them):

- **Transfer on a lost dispute stays per-entity.** The loser hands over the cells
  _it_ marked, not everything its pride holds. A pride losing its whole territory
  at once would need the claim layer walked by record.
- A pride-mate's claim decays on its own schedule; there is no shared freshness.

**Risk.** `defends: true` also re-enables `patrol`, which competes with wandering
— measured to collapse the demo when given to grazers. A lion is not a grazer,
but this is the fourth time a movement behaviour has competed with foraging, so
watch lion energy and starvation deaths specifically.

**Test** (`test/territory.test.js`, sandbox, ~200 ticks): two pride-mates on one
another's marks neither retreat nor dispute; a lion from a second record does
both. Plus the P4 test re-run with `defends: true` — shared-quarry ticks must
stay > 0, which is the assertion A60 was opened by.

---

## P7 — Numbers at a carcass

_Serves: Hyenas 4._

Many hyenas displace a solo healthy adult lion.

**Change** — `predation/possession.js`:

- `backingAt(world, animal, carcass, contest)` — how many of `animal`'s own
  record are within `contest.range` of the body. One `grid.queryRadius`, the
  same shape as `attackersFor`.
- Effective standing in a possession contest becomes
  `dominanceOf(a) × (1 + backingWeight × min(backers, maxBackers))` — the exact
  shape of `cooperationBonus` and `shielding`. Applied to **both** sides, so two
  clans at one body is symmetric.
- `outranks` takes the world and the carcass; `shareFor` and `isAvailableTo`
  thread them through. ⚠ Both readers must keep giving the same answer — the D11
  rule that `isAvailableTo` exists to enforce, or an animal walks to a body the
  feeding system then refuses.

**Data.** `behavior.contestBackingWeight` — hyena `0.5`, `maxBackers: 4`.
Arithmetic: a 60 kg hyena with four clanmates scores `60 × 3 = 180` against a
healthy adult lion's ~180 — a coin-flip that tips to the clan with a fifth
animal, or against a lion in poor condition. That is the ask, quantified;
tune it against the measurement, not against this paragraph.

⚠ **`resolveContest` in `social/dominance.js` is deliberately left alone.**
Backing applies to carcass possession only. Territory disputes and mating
rivalries keep the individual reading — widening it would change three
mechanisms for one ask.

**Cost.** `shareFor` runs per eater per carcass in the feeding loop. Gate on the
species weight _first_: at 0 the grid is never touched, so seven of eight species
pay one property read. Measure the demo tick anyway — this is a hot path.

**Risk.** This moves carrion between the lion, hyena, vulture and leopard, which
is the guild A73/A76 record as already having been reshuffled three times. The
vulture is the species at risk, as it was in batch 1.

**Test** (`test/carcass.test.js`, sandbox, ~20 ticks): one hyena at a lion's kill
waits; five of one record take it. Plus the weight-0 identity.

---

## P8 — Observability, and the numbers

No behaviour. This is what makes the seven asks checkable rather than asserted.

- **Inspection** (protocol bump to v35): on the entity inspection block, the
  resolved prey ceiling _actually in force_ and the backing count it came from,
  beside the existing `social.nearby.bandmates`. "Why did that hyena walk past a
  zebra" and "because it was alone" should be one look, not two inferences.
- **Metrics**: peak concurrent records and mean size per species (the store
  already reports `capacity`/`saturated`), and cooperative-attempt counts.
- **`npm run sweep`** — 10 seeds × 15 000 ticks against a control with every new
  switch off. Per `DOCS.md` §20 this is a **reading to record, not a bar to
  pass** (A81); take it anyway, on all eight species.
- **`npm run ethologist`** — six worlds. It is the independent check on exactly
  this plan's failure shapes: `group-flapping` for P1/P2, `circling-in-need` and
  `unresolved-intent` for P4's approach spread.
- **`BENCHMARK.md`** — **mandatory.** P3 touches the perception hot loop and P7
  the feeding loop. Interleaved against HEAD, in one session, at a **mature**
  world: step 3000 first, then time 1000 ticks. A cold measurement will report a
  real regression as flat.

---

## Cannot be built as asked

Two of the asks have no legal form in this engine. Both are recorded here rather
than approximated, in the shape `DOCS.md` §1.3 uses.

| Asked for                                               | Blocked by                                                                                                                                                                                                                                                                                                                                                                                                                | What P4 ships instead                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flanking and encirclement**                           | there is **no repulsion anywhere in this engine** and no trajectory: movement stores a heading and a step length, steering is a weighted mean of positions, and a weighted mean cannot repel. A negative weight drives the denominator toward zero, and `sumX / ~0` is a NaN position that removes the animal from every spatial query permanently (§1.3). A formation is also per-pair state, which invariant 17 refuses | **approach from distinct bearings**: each co-stalker aims at a point offset around the quarry by its deterministic rank in the record. Claim, and measure, _mean angular separation of co-stalkers_ — never "encirclement"                                                    |
| **A pride-level decision taken before any member acts** | there is no group-level actor. Every decision in this engine is one animal scoring a utility from what it perceives; a pride deliberating would be a new kind of entity with stored intent                                                                                                                                                                                                                                | **a threshold on an individual decision**: a lion commits to prey it would refuse alone once enough pride-mates are beside it (P3), and joins a pride-mate's stalk rather than only its chase (P4). The pride converges on one quarry without anything deciding on its behalf |

---

## Verification

Per `CLAUDE.md`, and it is the rule this plan is most likely to be broken by:
iterate on **one test file**, not the suite. `npm run test:fast` when a phase is
complete; `npm test` **once**, before calling a phase done — the demo,
persistence and determinism tiers it skips are where cross-cutting regressions
land, and every phase here is cross-cutting.

Per-phase test cost, stated up front (ticks × seeds is the whole cost model):

| phase  | world                                     |                                    ticks |
| ------ | ----------------------------------------- | ---------------------------------------: |
| P1, P2 | sandbox + `smallDemo()`                   |                                     ~100 |
| P3, P4 | sandbox                                   |                                     ~150 |
| P5     | **full demo** — the claim _is_ ecological | 10 seeds × 15 000 (sweep, not the suite) |
| P6, P7 | sandbox                                   |                                     ~250 |

Only P5 touches the demo, and only as a sweep. ⚠ If any phase adds a
`createDemoSimulation()` test, say why on the line.

Permanent invariants that must stay green throughout: no species id outside the
species files (`test/species-schema.test.js`), two seeded runs byte-identical
(`test/determinism.test.js`), snapshots expose only whitelisted fields
(`test/protocol.test.js`).

---

## The original brief

> **Lions and Hyenas** — 1. Both species should be allowed to hunt all prey
> species. No artificial partitioning.
>
> **Lions** — 1. Make all lions automatically members of the same pride. (This
> temporary and for simplicity. Multiple prides and male coalitions will return
> when more lion behaviors are added to support it.) 2. A pride should be able to
> collectively decide to attack a prey before a member has entered `chase`. They
> should engage in coordinated stalking, flanking, encirclement. (This should not
> preclude individual lions starting a hunt solo, if it is a particularly easy
> target and/or they're particularly hungry.) 3. Territory should belong to the
> pride, not to individual members.
>
> **Hyenas** — 1. Spawn hyenas into different clans placed in different areas of
> the map. The number of clans should depend on the total number of spawned
> hyenas. At smaller starting population sizes, it should optimize for clan size,
> aiming for sizes of 8-12. At larger starting population sizes, it should
> optimize for number of clans, aiming for 3-5 clans. 2. Hyenas should hunt
> cooperatively within their clan. (This can share logic with lions.) 3. Larger
> groups of hyenas (within the same clan) should be more willing to hunt larger
> prey (e.g. adult wildebeest, zebra, buffalo) 4. Group numerical strength should
> be able to affect carcass contests. Many hyenas should be able to contest and
> possibly displace a solo healthy adult lion.
