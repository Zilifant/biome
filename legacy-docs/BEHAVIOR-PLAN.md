# Herbivore social behaviour — next level

⚠⚠ **RETIRED 2026-08-06. Everything in this file that is still true has been folded
into the living documentation, and this copy is kept for provenance only** — the
same terms as the three plans beside it. Read it for *why* a decision was made, and
for the **As built** notes where a phase's own prediction turned out wrong. Do not
read it for current state: it describes line numbers and a codebase that have moved.

✅ **Complete.** P0–P5 and P7–P10 shipped; P6 was skipped by decision.

**Where its content lives now:**

| what | where |
| --- | --- |
| What the ten phases built | [`DOCS.md`](../DOCS.md) §9 (Sociality, Persistent groups) and §11 (the v34 inspection blocks) |
| The `decision`-phase ordering, and why no fourth drift | [`DOCS.md`](../DOCS.md) §9 Sociality |
| The seven asks that are **not expressible**, and the nearest legal thing to each | [`DOCS.md`](../DOCS.md) §1.3, *Sociality asks that are not expressible* |
| The lessons — weights tested at 1/0, sizing against the real competitor, ttl-on-an-intent, the coupled projection, verifying a plan's claim, the iterator | [`DOCS.md`](../DOCS.md) §16, **D43–D48** |
| The measurement discipline — horizons, dead bands, off-arm proofs, `updateInterval` as mechanism | [`DOCS.md`](../DOCS.md) §15 |
| What is still open | [`ACTION-ITEMS.md`](../ACTION-ITEMS.md) — **A43** (narrowed) and **A82** |
| Per-phase cost measurements | [`BENCHMARK.md`](../BENCHMARK.md) |

⚠ **P6 is skipped** (2026-08-05, by decision): a dispersed bull staying loosely
associated with the local buffalo is an acceptable model of a bachelor, and the
herd label already delivers it. The section is kept, marked, with what it gives up
stated. The plan is therefore P0–P5 and P7–P10.

## Context

`species-behavior-prompt.md` is the brief: the sociality architecture is sound and
should be **extended, not replaced**. What is missing is that persistent identity
and group-level intent do not causally affect movement.

The codebase already says this about itself, and the evidence decides the design:

- **The herd label has no behavioural consumer at all** — measured 2026-07-30,
  recorded in [DOCS.md](../DOCS.md) §9. `groupId` is read by the metrics, the entity
  projection, and the propagation that writes it. Herding steers at a centroid
  built from *neighbours*.
- **The group record has no movement consumer either.** `groupRecordId` is read
  only by carcass possession ([possession.js:176](../src/simulation/predation/possession.js#L176))
  and cooperative hunting ([cooperation.js:125](../src/simulation/predation/cooperation.js#L125)).
  A zebra band is a roster nobody acts on.
- **A61** names the association defect *and* its failed fix: scaling the herd
  *pull* by the centroid weight was built and measured **inert**.
- **A56** (157 foundings against 150 dissolutions in 3000 ticks) gets worse the
  moment another species joins the registry.

So this is mostly about **giving existing state its first consumers**. Ecological
balance is explicitly out of scope; bug-free logic is the goal.

## Rules this plan obeys

Each has a recorded failure behind it.

1. **No species-id conditionals in `src/simulation`** — `test/species-schema.test.js`
   greps for them. Everything below is a species field or block value.
2. **A species block beats the config**, so every world-level switch lives in a
   global config section, never in a block (the phase-8 trap).
3. **No new utility-table rows.** A new movement behaviour that competes with
   foraging has cost the demo seeds four times. New steering lands on an existing
   product: an exchange rate in the centroid, a heading bent in the `wander` drift
   channel, or an existing action.
4. **Two systems never write the same entity field.**
5. **One neighbour grid walk per tick, and it is perception's.**
6. **No new randomness.** Nothing below draws at all.
7. **Every mechanism ships an `enabled` switch**, so its off-arm is a
   byte-identical control.

---

## P0 — Perception restructure (byte-identical, no behaviour change)

Everything else depends on a neighbour list that can be wider than the perception
radius. Do the restructure *first*, with the widening switched off, so any
behavioural difference here is a bug rather than a feature.

In [PerceptionSystem.js#perceive](../src/simulation/systems/PerceptionSystem.js#L137):

```js
neighbours.push(otherId, distance);
if (distance > radius) continue;   // ← new: everything below is perception-radius
animalCount += 1;
… LOS, crypsis, prey, threat, mate, guardian …
```

⚠ **The couplings are broader than `animalCount`.** None of these has a distance
gate today — the query radius *was* the gate:

| Coupling | Where | Fix |
| --- | --- | --- |
| `animalCount` | line 223, right after the push | move below the new gate |
| carcasses | lines 200-216 — **no distance test at all** | own `distance <= radius` gate |
| `nearestAnimal`/`guardian`/`nearestPrey`/`nearestThreat`/`mateCandidates` | 258+ | behind the new gate (A63: this gate feeds **reproduction** too) |
| `adoptedPrey` — the *second* consumer of `world.neighbourhood` | [cooperation.js:173](../src/simulation/predation/cooperation.js#L173), called from `DecisionSystem:963` | gates on distance to the quarry, never to the neighbour — add the gate; it is a no-op today |
| `SocialSystem`/`GroupSystem` reuse checks | `SocialSystem:389`, `GroupSystem:404` | must compare the **neighbour** radius. Keep both fallbacks — they are what saves you when perception is staggered |

⚠ **Do not add a parameter to `#perceive`.** [D28](../src/simulation/systems/PerceptionSystem.js#L107)
records one extra argument costing **12% of total engine time** at large-5k. Derive
the radius inside from the `species` already in hand, exactly as the flight
multiplier does at line 157.

⚠ **Do not put `neighbourRadius` in the perception summary.** That object is
projected **whole** to inspection, so it would cost a protocol bump. Put it in a
new `world.neighbourhoodRadius` map beside `world.neighbourhood` — which
[World.js:84-88](../src/simulation/world/World.js#L84) already explains is kept
outside the summary precisely because the summary is projected.

`neighbourRadius = max(perception.radius, behavior.herdRadius, groups.joinRadius,
social.alarmRadius)` — all four, or the second walk simply reappears somewhere
else. `alarmRadius` lives in `config.social`, so the composition root wires it in
(precedent: `foodMinLevel`, `drinkRange`, `carcassRange` all cross sections in
`createDemoSimulation.js`).

*Test:* [test/perception.test.js](../test/perception.test.js) — copy the `animalCount`
idiom at `:38` and [line-of-sight.test.js:110](../test/line-of-sight.test.js#L110)'s
"still counted on the shared walk". Plus the §20 inertness proof: seeds 1/2/42 ×
1500 ticks, comparing `JSON.stringify(captureSimulationState(engine))` — ⚠ never
`assert.deepEqual`, which exhausts a 4 GB heap on two entity graphs.

---

## P1 — Per-species social radius

Wildebeest and buffalo coordinate over more than 6 cells. Add an **optional**
`herdRadius` key read from the species' `behavior` block:
`species.behavior?.herdRadius ?? this.groupRadius`.

⚠ **Do not add a default to `config.behavior`.** `behavior` is deep-merged, so
every species would carry a copy and `config.social.groupRadius` would become a
second home for one number (D11). The world default stays in `config.social`.
Resolve to a `Map<speciesId, radius>` once per world, cached against
`world.species`, exactly like
[`#associationsFor`](../src/simulation/systems/SocialSystem.js#L364).

⚠⚠ **The radius currently widens three things, and only one of them is wanted.**
It appears in `#neighboursOf`, in the centroid gate at
[SocialSystem.js:221](../src/simulation/systems/SocialSystem.js#L221), and — inside
that same gate — in **label propagation** (253-263) and the **`adults`** tally
(236). Widening the label means bigger herds and `maxGroupSize: 24` saturating;
widening `adults` means `HuntingSystem.defendersFor` shields more, which quietly
**makes wildebeest and buffalo harder to kill**.

**Decision: widen only the centroid and heading accumulation.** Label propagation,
`groupmates`, `adults` and `nearestDistance` stay on `config.social.groupRadius`.
One per-species number, one changed behaviour, and the collective-vigilance
numbers stay comparable with their history. Say so in the file header.

**Switch:** `config.social.perSpeciesRadius` (global section).
**Species:** wildebeest and buffalo declare `behavior.herdRadius`.

*Test:* [test/social.test.js](../test/social.test.js) — copy "two separated herds keep
separate labels, and merge on contact" with a wide-radius species **invented in
the test file** (the `CLAN` idiom at [test/groups.test.js:47](../test/groups.test.js#L47)).
Add a `defendersFor` assertion so the shielding behaviour is pinned rather than
discovered later. Re-baseline `npm run benchmark`: `queryRadius` 7 → 12 is ~2.9×
the candidates, though the expensive per-neighbour work (LOS raycast,
`concealmentAt`) is now behind the new gate and does not grow.

---

## P2 — Affinity-weighted centroid

The highest-leverage change, and it needs no new state, no new action, and no new
system. At [SocialSystem.js:205-241](../src/simulation/systems/SocialSystem.js#L205)
the neighbour's `worth` is `1` for a conspecific. Make it an exchange rate that
also reads **who this animal belongs to**:

| neighbour | worth |
| --- | --- |
| same `groupRecordId` (both non-null) | `× sameBandWeight` (> 1) |
| different `groupRecordId` (both non-null) | `× otherBandWeight` (< 1, **strictly positive**) |
| either null | `× 1` — unchanged |

⚠⚠ **The denominator must change with it, and this is the bug that would sink
the phase.** [SocialSystem.js:328](../src/simulation/systems/SocialSystem.js#L328) is
`const weight = groupmates + associateWeight` — a **headcount**, correct only
because every conspecific contributes exactly `1` to `sumX`. Weight the numerator
and leave the denominator a count, and the centroid is scaled away from the
origin: a band of 8 at affinity 1.2 gives `9.6·x̄ / 8` — a phantom point **20%
further from (0,0) than the band actually is**, silent, and on a 500-unit map
worth 20–100 units of error. Accumulate `conspecificWeight` and use
`weight = conspecificWeight + associateWeight`. Bit-identity survives: `1.0`
summed n times is exactly the integer n in IEEE-754.

⚠ **`groupmates`, `adults` and `nearestDistance` stay unweighted.** `adults` is
read by [HuntingSystem.js:331](../src/simulation/systems/HuntingSystem.js#L331) and
`mobbing.minMobbers`; weighting them turns a cohesion knob into a predation knob.

⚠ **Never a negative or zero affinity.** A weighted mean of positions cannot
repel — weight 0 means *ignore*, not *avoid*. A negative weight can drive
`weight` toward zero, and `sumX / ~0` is ±Infinity, then a NaN heading, then
`entity.x = NaN` **permanently** and the animal vanishes from every spatial query.
The brief's "maintain separation between adjacent bands" is therefore **not
expressible** — there is no repulsion term anywhere in the engine. What is
expressible is **differential attraction**: each band's centre is dominated by its
own members, so two overlapping bands pull apart. Claim that, not separation.

⚠ **One-tick lag, and it is structural.** `SocialSystem` is priority −10 and
`GroupSystem` −8, so the affinity read of `other.groupRecordId` sees *last tick's*
membership. Harmless in steady state; it means any test that founds a band and
asserts on the centroid must step ≥ 2 ticks.

⚠ Symptomatic animals are excluded from the centroid *before* any weighting
([SocialSystem.js:221](../src/simulation/systems/SocialSystem.js#L221)) and must stay
excluded — a heavy band weight must not resurrect disease shunning.

✅ **Alignment comes free.** `worth` also scales `sumSin`/`sumCos`, so
`social.heading` becomes band-weighted, and the `herd` intent
([DecisionSystem.js:1122-1139](../src/simulation/systems/DecisionSystem.js#L1122))
already blends cohesion with alignment. The brief's "align with their persistent
group" needs no separate work.

**Config:** `config.social.bandAffinity` — `{ enabled, sameWeight, otherWeight }`.
**Species:** overrides in the `behavior` block. Defaults all `1` ⇒ arithmetically
identical to today.

*Test:* [test/association.test.js](../test/association.test.js) — copy "a mixed group
weights the two kinds against each other" (`:247`) into "two bands weight their own
members"; assert the centroid of a uniform band sits **on** the band (the
denominator regression test); byte-identity at all-`1` defaults.

---

## P3 — Association strength that actually scales (A61)

**Shape:** a second always-per-species **field**,
`associationPull: Object.freeze({ 'herbivore.wildebeest': 0.8 })`, absent ⇒ `1`.
⚠ Do **not** nest it inside `association` — that breaks `associationWeightFor`,
`associationOf`, and every test in `association.test.js`.

`SocialSystem` publishes `pullScale` in `world.social`: the contribution-weighted
mean of `1` per conspecific and `pull_s` per associate ⇒ exactly `1.0` for an
all-conspecific group.

⚠⚠ **Do not spend it on the utility — it would land in A61's inert band again.**
A61's measurement was about *magnitude*, not about which parameter carried it.
For the gazelle (`herdWeight` 0.6, `wanderBias` 0.35): a bold animal (boldness 1),
fully ramped, scores herd 0.6 against wander 0.35, so a `pullScale` of 0.55 gives
**0.33 < 0.35 — inert**; a timid animal (boldness 0.5) scores 0.495 against 0.175
and fires. That is a threshold effect keyed on a trait, dressed as a smooth
weight — worse than either arm.

**Spend it on the distance instead:** `effectiveHerdDistance = herdDistance /
pullScale`. At 0.55 a gazelle tolerates 3.6 units from a wildebeest centre and 2.0
from its own. Monotone, has no comparison to lose, and is directly measurable as
mean distance-to-centroid. It lands in the same expression
([DecisionSystem.js:626-631](../src/simulation/systems/DecisionSystem.js#L626)) **and**
in `#intentFor`'s `cohesion` term, which reads the same number — so the two stay
consistent for free.

⚠ **NaN guard.** `pullScale = pullSum / weight` is `0/0 = NaN` when the animal is
alone. `NaN` then propagates into `utilities.herd`, and `argmaxUtility` compares
with `>`, so `NaN > x` is false and `herd` is **silently never chosen** — no
crash, and the inspector shows `null`. Publish `pullScale: 1` when `weight === 0`,
and assert it.

**Switch:** `config.association.scalesPull` — the third cell of the 2×2 the module
header already argues for.
**Species:** gazelle declares pull values; **wildebeest declares an association
with zebra** (the brief's explicit ask — association is directional, so this is one
new declaration, not two).

*Test:* extend `association.test.js` — keep "company of another species pulls
exactly as hard" (`:429`) as the pull-1 arm and add its inverse at a declared
weight, measured as equilibrium distance; plus the `weight === 0` guard.

---

## P4 — Calf-centred spatial organisation

Same channel: weight a dependent juvenile (`guardianId !== null`) up in the
centroid, so adults converge on the calves.

⚠ **Gate the bonus on the *observer* being adult or senescent.** A dependent
juvenile runs the same loop, so without the gate a crèche of foals weights other
foals 3× and the adults 1× — a self-reinforcing calf ball that drifts off the
herd (zebra `herdWeight` 1.15 already outranks `followWeight` 0.7). It is a
`lifeStage` test, not a species test — legal, and it mirrors the existing `adults`
tally at line 236.

⚠ **"A defensive ring falls out" is false.** A weighted centroid produces a blob;
there is no repulsion. The only thing producing a shell is
`locomotion.maxOccupantsPerCell: 2` refusing entry to a full cell, which is an
emergent one-cell crust, not a formation. **Claim what is measurable:** mean
calf-to-centroid distance < mean adult-to-centroid distance.

**Config:** `config.social.calfWeight` (default 1).

*Test:* `test/social.test.js`, the "defending young" block — assert
calf-to-centroid < adult-to-centroid, and that a calf-only group is unaffected.

---

## P5 — A56 hysteresis, registry capacity, buffalo cow–calf core

**5a. Hysteresis (A56) is a prerequisite, not a follow-up.** Flapping already runs
at one membership change per ~95 ticks per hyena across three forming species.
Buffalo makes it four species and +97 animals, and a rally heading (P7) keyed to a
record that dissolves and re-founds every few ticks jumps between centres —
jitter that will read as a rally bug. Implement the named fix: `belowMinSince` on
the record ([GroupRegistry.js](../src/simulation/world/GroupRegistry.js)), dissolving
only after `config.groups.dissolveGraceTicks` still below `minMembers`. Same shape
as `alarmedUntil`. The reconcile pass
([GroupSystem.js:151-168](../src/simulation/systems/GroupSystem.js#L151)) is the only
caller. Persisted ⇒ `SAVE_FORMAT_VERSION` bump.

**5b. Capacity.** DOCS reports **33 peak concurrent groups** today against a cap of
64. Buffalo at ~96 peak adds ~16 records at the default `maxMembers: 8` → **~49 of
64 at peak**, and 33 is a max over ten seeds. ⚠ At the cap `found()` returns
`null`, `#joinOrFound` returns, **no event, no metric, no log** — the feature just
stops working, intermittently and seed-dependently.

- `config.groups.maxGroups`: 64 → **192**. A provable bound, not a hope: worst case
  is `ceil(population / minMembers)`, ≈150 at peak herbivore populations. Cost is
  an `O(n log n)` sort per reconcile pass at n=192 — negligible.
- Buffalo `groups.maxMembers`: **16–24**, matched against its `cohort.groupSize: 12`
  — otherwise a founding herd of 12 splits into two records on tick 1.

**5c. Buffalo `groups: { forms: true }`.** ✅ Verified against the code: this alone
gives the cow–calf core. `leavingSex: 'male'` is already the config default;
`inheritFromGuardian` + [`#inherit`](../src/simulation/systems/GroupSystem.js#L278)
puts a calf in its guardian's record, and the guardian is the parent that
gestated, so descent is matrilineal with no sex conditional anywhere.

⚠ [herbivoreBuffalo.js:33-37](../src/simulation/config/species/herbivoreBuffalo.js#L33)
currently says persistent groups are "**Not stated, deliberately**". Rewrite that
header rather than quietly contradicting it — the convention this codebase follows
(see [GroupRegistry.js:5](../src/simulation/world/GroupRegistry.js#L5), "⚠ **This
overrides a documented design decision, and it is meant to**"). The honest framing:
the **record** models the cow–calf core, the **label** continues to model the
fission–fusion herd around it. Both run side by side.

*Test:* `test/groups.test.js` demo-world block — cow-cored membership; a record at
`minMembers - 1` survives `graceTicks - 1` and dissolves on `graceTicks`; a
**saturation assertion** (`world.groups.size < world.groups.maxGroups`), since
nothing reports it today; the round-trip at `groups.test.js:214` covers
`belowMinSince`.

---

## P6 — Bachelor bulls — ⛔ **SKIPPED (2026-08-05, by decision)**

**A dispersed bull staying loosely attached to the local buffalo is an acceptable
model of a bachelor, and it is what the engine already does.** The herd *label* is
fission–fusion by construction: a bull that has walked out of its natal group is
still in whatever aggregation it is standing in, drifts in and out of it, and
carries no membership anybody has to maintain. What P6 would have added is the
narrower claim that a bachelor cannot **re-enrol in a cow group's record** — a
distinction that costs a new per-species field, a second predicate beside the
existing A64 one with a confusable name (`joinsAfterDispersal` against
`rejoinWhileDispersing`), and a 100-tick transition-counting test to prove it.

The scope this gives up is stated rather than hidden: **bachelor groups are not
modelled as an identity**. Buffalo bull bands in the field are real and are
somewhat persistent; here they will be loose local aggregation and nothing more.
⚠ The section below is kept verbatim as the design that was not built — it is
accurate, it costs nothing to leave, and it is the starting point if anybody wants
it later. Nothing else in this plan depends on it: P5 stands alone, and P7's
dispersal gate reads `isDispersing`, not anything P6 would have added.

<details>
<summary>The unbuilt design</summary>

⚠ **This does *not* fall out of the existing rules, and the code says why.**
`#dispersingOut` goes false the instant the dispersal window closes; after that
the bull is an ordinary unattached animal and `#joinOrFound` has, in the system's
own words, **"no admission test"** — it takes the smallest-id record in range with
room. A dispersed bull walks straight back into a cow group, and possibly its own
(dispersal ends wherever the walk ended; `joinRadius` is 6).

**Nearest legal thing, needing no new state:** `entity.dispersalUntil` is set once
by `beginDispersal` and is **never cleared** anywhere in `src/simulation`, so "has
completed dispersal" is `dispersalUntil !== null && tick >= dispersalUntil` — free.
Add one per-species value resolved through
[`#resolve`](../src/simulation/systems/GroupSystem.js#L239):

- `groups.joinsAfterDispersal`, config default `true` (= today, identity); buffalo
  sets `false`.
- Scoped by the **same `leavingSex` predicate**, so "the sex that leaves is the sex
  that does not rejoin" is one question with two consequences — literally the A64
  shape. A dispersed cow still accretes into cow groups; a dispersed bull can only
  **found**, with another unattached conspecific. That is a bachelor group.

⚠ **Name collision:** `config.groups.rejoinWhileDispersing` already exists as the
A64 control. Use `joinsAfterDispersal` and cross-reference both in the comments.

*Test:* `test/groups.test.js`, copying the **A64 idiom** — step 100 ticks and count
transitions, never one tick. That is the test shape whose absence *caused* A64.

</details>

---

## P7 — Band rally drift (reunion)

A separated animal must deliberately return. Copy the
[MigrationSystem](../src/simulation/systems/MigrationSystem.js) pattern — the
documented shape for steering without an action.

- `GroupSystem` derives each record's centre into a transient `world.groupCentres`
  map, bounded by `maxGroups × maxMembers`. ⚠ **Never persisted** —
  [GroupRegistry.js:52](../src/simulation/world/GroupRegistry.js#L52) is explicit that
  a group has no stored centre.
- Derive it in a **third pass, after the entity pass**, so this tick's joins and
  dissolutions are included. Deriving first gives headings pointing at records that
  dissolved this tick.
- Weight members by leadership at `groups.leadWeight` (see P8), using
  `w = 1 + leadWeight · score` so `0` is exactly `1`.
- Write `entity.rallyHeading` / `rallyStrength` for a member with **no bandmate
  contributing to its centroid** — derive that gate from the same `world.social`
  summary, not from a raw distance, or you have two rules for one question (D11).
- [DecisionSystem.js:1311-1316](../src/simulation/systems/DecisionSystem.js#L1311)
  blends it into the fresh `wander` commitment, after migration and before trail.

⚠ **Bound it.** Every other drift cue in the engine is bounded by a sense
(`forageGradient` and `habitatGradient` sample within `cueRadius`; water is "the
smell of water on the wind"). A heading toward a band centre 200 units away is
knowledge no animal has, and mechanically it is A34 in a new suit — an animal
walking across the map ignoring forage. Add `groups.rallyRange`, beyond which the
band is genuinely lost, and cap `rallyStrength` well below
`migration.dispersalWeight: 0.9`.

⚠ **It will corrupt dispersal if left ungated.** Dispersal "wins outright" at
strength 0.9 ([MigrationSystem.js:109](../src/simulation/systems/MigrationSystem.js#L109));
a rally blended onto it drags a dispersing zebra back toward the band it is
walking out of — undoing A64 at the *movement* layer instead of the membership
layer. `GroupSystem` already imports `isDispersing`; gate on it.

⚠⚠ **The default-value NaN path is catastrophic.** `blendHeadings` calls
`clamp01(weight)`, and `clamp01(undefined)` returns `undefined` (both comparisons
false), giving `NaN` → `normalizeAngle(NaN)` → `MovementSystem` computes
`cos(NaN)` → `entity.x = NaN` **permanently**, and the animal disappears from every
spatial query. Guard both sides: default `rallyHeading: null` / `rallyStrength: 0`
in `EntityManager.createEntity`, and null-check in `DecisionSystem` exactly the way
`trailHeading` is.

⚠ **Clear it on every path.** `GroupSystem` returns early when no species forms
groups, and `continue`s on the guardian, dispersing and already-attached branches.
A field not written on some path outlives its tick — the `entity.flying` lesson at
[DecisionSystem.js:800-806](../src/simulation/systems/DecisionSystem.js#L800).

✅ **Not persisted, and state why in the header:** `GroupSystem` (−8) precedes
`DecisionSystem` (0) every tick and non-forming species keep the `createEntity`
default, so the fields are always written-or-defaulted before any read. Saves a
save-format bump. The invariant breaks if anyone adds a reader at priority < −8.

✅ **No feedback with P2:** `herd` is an *action* and rally only bends `wander`, so
rally applies exactly when there is no local centroid worth steering at. Write that
down.

**Config:** `config.groups.rally*` holds the switch and machinery; ranges and
weights are per-species inside the `groups` field.

*Test:* `test/groups.test.js` plus `association.test.js`'s `distanceAfter` A/B
harness (`:409-426`) — reunion distance shrinks with rally on and does not with it
off; a dispersing animal is provably unaffected (100-tick A64-style assertion);
`rallyStrength === 0` for an animal with its band.

---

## P8 — Herd movement consensus, and leadership

The wildebeest asks — a collective front, shared directional commitment, and
consensus that **outlives the cue** — land on the one piece of state with no
consumer: the **herd label**.

New `HerdConsensusSystem`, `decision` phase, **priority −3** (after
`MigrationSystem` at −5, before `DecisionSystem` at 0, so it aggregates settled
drift). O(N), no grid walk, no randomness, deterministic ascending-id accumulation.

**The re-decision rule must be stated, or the herd never decides together.**
Members join a label at different ticks, so independently-expiring ttls give a
rolling average rather than a front. The rule:

1. Recompute a label's consensus each tick from **only** those members whose ttl
   has expired.
2. A member with a live ttl keeps its own heading.
3. **A member joining a label mid-commitment adopts the label's current consensus
   with a fresh ttl.** ⚠ This clause is what propagates a front through a growing
   herd, and it is the one that is easy to omit.

⚠ **`atan2(0, 0)` is a real trap.** Opposed cues give `sumSin ≈ 0, sumCos ≈ 0`, and
`Math.atan2(0, 0)` is **0** — a valid heading pointing due east. A whole wildebeest
herd marching east because its cues cancelled looks exactly like emergent
behaviour. `blendHeadings` already guards this
([migration.js:333-335](../src/simulation/migration/migration.js#L333)); require a
resultant length > 1e-12, else no consensus.

⚠ **Do not add a fourth blend to `wander`.** Publish `herdHeading` / `herdStrength`
and have `DecisionSystem` use them **in place of** `migrationHeading` /
`migrationStrength` while live. One conditional, no new blend, and the commitment
outlives the cue because the strength survives too. `MigrationSystem` still owns
its own two fields — no ownership violation.

⚠ **Commit on the entity, never in a per-label map.** Labels are recomputed every
tick and split on hop count; a per-tick map would lose the commitment the moment a
label changed.

**Leadership, without storing rank.** `dominanceOf` is legal and O(1), but it is
**pointed the wrong way for the species that asked**: `maturity` is 1 for adult and
**0.85 for senescent** ([dominance.js:61](../src/simulation/social/dominance.js#L61)),
so an old cow rates *below* a prime adult, and `condition` moves every tick so the
"leader" flickers. Add a separate `leadershipOf` in `social/dominance.js` with an
age term weighted upward, controlled by `behavior.leadAgeWeight` (default 0 =
`dominanceOf` exactly). Nothing is stored — `GroupRegistry.js:44-51` forbids that,
and it stays forbidden.

**Wildebeest subherds.** The brief wants subherds that persist while spatially
separated. That is literally a group record — but wildebeest is 219 founders,
`forms: false` is a stated design decision, and putting them on the registry needs
~28–100 records for that species alone. **The nearest legal thing is this
commitment**: a shared heading carried on the entity that outlives separation. Say
that plainly; do not let anyone "fix" it later by flipping `forms`.

**Config:** new `config.consensus` section — `{ enabled, updateInterval,
commitTicks, maxStrength }`.
**Species:** `behavior.consensusWeight`, default **0**, so the mechanism leaves on
its first comparison for everything else — the `mobWeight` pattern. Wildebeest
highest, buffalo moderate.
**Cost:** persisted entity fields + a new config section + a changed system
descriptor ⇒ `SAVE_FORMAT_VERSION` bump.

*Test:* new block in `test/social.test.js` — heading variance within a label falls;
the commitment survives after `migrationHeading` is zeroed; consensus **decays**
when the gradient reverses and strength does not climb tick over tick in a static
world (the positive-feedback check); `consensusWeight: 0` byte-identical.

---

## P9 — Coordinated charge and pursuit

⚠ **A ttl on the `defend` intent does nothing.** `#intentFor` is called fresh from
the winning action every tick, and only the `wander`/default branch reads a prior
`moveIntent.ttl` as a continuation
([DecisionSystem.js:1111-1116](../src/simulation/systems/DecisionSystem.js#L1111)).
The moment the threat leaves perception, `defendUrgency` goes 0 and another
action's intent overwrites it.

**The commitment must live in the utility.** Add `entity.defendUntil` plus a
remembered threat position (the threat object is gone by then), keeping
`defendUrgency` non-zero for N ticks; `defend`'s intent gains `sprint: true` while
committed. Persisted ⇒ save bump.

⚠ **`defendWeight` 2.6 and `mobWeight` 2.4 both outrank `fleeWeight` 2.0.** A
commitment that holds `defend` for N ticks means the buffalo will not flee for N
ticks — **including from a second predator**. Bound N hard and re-check the threat
every tick.

⚠ Sprinting spends stamina, and the mechanical effect of defending is
proximity-based (`shielding`, `trampleChance`) — there is no attack. So a charge
buys faster arrival and longer station-keeping, which does raise trample chance,
but it can leave a buffalo with no sprint budget for the flee it needs next. Gate
the sprint on a stamina fraction.

**Species:** `behavior.chargeWeight` / `behavior.pursuitTicks`, 0 for everything
but buffalo. ⚠ This shifts the mobbing baseline, so phase-10/11 mobbing numbers
need re-reading.

*Test:* [test/cooperation.test.js](../test/cooperation.test.js) (it holds the 2×2
mobbing design) — a mobbing buffalo closes on a retreating predator at
`chargeWeight > 0` and not at 0; the commitment expires; **flee still wins against
a second threat**; an exhausted buffalo does not sprint.

---

## P10 — Observability and closing the loop

- **Inspection** ([SimulationEngine.js:563-585](../src/simulation/engine/SimulationEngine.js#L563)):
  `social.nearby` gains `pullScale`; new `social.consensus`
  (`{ heading, strength, until }`); the sibling `group` block gains a derived
  `centre` and `leaderId` (walked from `memberIds` through `leadershipOf` **on
  read** — never stored).
- **Metrics** ([metrics.js:260](../src/simulation/metrics/metrics.js#L260)): the
  `groups` aggregate gains mean band spread, so cohesion is a number rather than an
  impression. Aggregates only.
- **Protocol:** one `PROTOCOL_VERSION` bump for the inspection additions, matched
  by `SUPPORTED_PROTOCOL_VERSION` ([RendererStore.js:20](../src/renderer/app/state/RendererStore.js#L20))
  plus `npm run fixtures:renderer`. ⚠ Regenerate **after the last behavioural
  change**, not after the version bump. Add `test/protocol-v34.test.js` copying
  [test/protocol-v33.test.js:32](../test/protocol-v33.test.js#L32) — asserted against
  the **live constants**, never literals (the v29 bump shipped that comparison
  written against itself and three stale fixtures passed).
- **Docs:** DOCS §9 can finally retract "the label has no behavioural consumer at
  all". Update §9 Persistent groups, §19 the configuration map, and close or
  annotate **A61** (P3), **A56** (P5a), and **A43** (P2's band-separation test is
  the fragmentation assertion A43 says nobody has written).

### ✅ As built — 2026-08-06

Shipped as written, with **three additions the list predates** and **one item
refused**:

- ⚠ **P7's and P9's outputs had no inspection at all**, and the list only names
  P8's. The plan's P10 was written before either existed. So `social` gained
  `rally` (`{ heading, strength }`) and `charge` (`{ until, threat }`) beside
  `consensus`, and `nearby` gained `bandmates` beside `pullScale`. That is not
  scope creep: a **pursuit** is by construction the state that outlives every
  visible cue, so `defendingId` has already gone null by the time one is what is
  happening, and there was no way to see one at all.
- ⚠ **`social.consensus` carries a fourth field, `label`.** P8 stores which herd a
  commitment was made *in*, and with `groupId` projected three lines above, a
  commitment held over from a herd the animal has since left reads as a
  disagreement between the two rather than as a mystery.
- ⚠⚠ **`group.centre` must not be read out of `world.groupCentres`.** That map is
  rebuilt by `GroupSystem#rally`, and only when `config.groups.rallyEnabled` — so
  the obvious implementation reports `null` for every group the moment somebody
  switches the rally off, which is a control arm this suite uses. Measured on the
  demo at tick 200: `groupCentres.size` is **28 with the rally on and 0 with it
  off, against 28 live records either way**. Derived on read from `memberIds`
  instead, as the plan's own wording required — and as the **plain** mean, because
  a "where is this band" that moved with `config.groups.leadWeight` would be
  answering a question about the mechanism.
- ⬜ **A43 is narrowed, not closed, and the plan's claim about it is wrong.** P2's
  two-bands test asserts a **centroid** — a steering input, one tick, a sandbox —
  where A43 asks for a population fragmentation **outcome**. What P10 does deliver
  is the *measure* A43's own resolution was waiting on (`groups.spread`), and its
  first reading is that demo bands loosen from 5.5 to 15.6 mean spread over 1500
  ticks with a per-record max of 83. The label-split reading is deliberately not
  written as a demo assertion: a label count is an equilibrium, and an equilibrium
  test measures the seed. See `ACTION-ITEMS.md` A43.
- ✅ **The `groups` aggregate also ends the "silent cap" thread** P5b left open —
  `capacity` beside `count`, plus a `saturated` flag. ⚠ A **sample**, at the
  metrics stagger of 50 ticks, and it says so: counting refusals would need a
  cumulative counter, which is history rather than state and would read
  differently after a restore, for a failure mode that has never occurred (peak 37
  against 192).
- ✅ **Three of the four doc items were already done** at P8. Only A43 was left,
  and see above.
- ✅ **The fixtures were the point of the ordering**, and six behavioural phases
  showed in them: `entity.grouped` went 113 → 209 and the `herd` action 95 → 111
  of 500 animals in a 10-tick recording. ⚠ **No new event kind and no births or
  deaths**, so `tests-ui/event-filters.spec.js`'s assumption survived — the UI spec
  the handoff warned would probably move did not have to.
- ⚠⚠ **The step this plan could not finish is `npm run test:ui`.** Playwright runs
  and the tests execute, but every fixture *teardown* hangs in this sandbox — 35
  failures, **all of them teardown timeouts and none of them assertions**, and a
  120-second timeout does not help. Verified pre-existing by stashing to clean HEAD
  and reproducing it against the *old* fixtures. See `legacy-docs/HANDOFF-2026-08-06.md` for the full
  reading. The suite was run; it did not pass; nothing in it indicates the fixtures
  are wrong.

---

## Verification

1. **`npm test` after every phase.** Every mechanism ships its off-arm asserted
   **byte-identical** to the pre-change engine: seeds 1/2/42 × 1500 ticks,
   `JSON.stringify(captureSimulationState(engine))`. ⚠ Never `deepEqual`.
2. **Assert the mechanism directly, never through the population** (§20 step 4). A
   registry that quietly never founded a second band passes any survival gate.
3. **Save/load explicitly for every new field.** Entities serialize whole, so a
   missing field fails *silently*. New persisted state: `belowMinSince` (record);
   `herdHeading`/`herdStrength`/`herdCommitUntil`; `defendUntil` + remembered
   threat. Not persisted, by the stated invariant: `rallyHeading`/`rallyStrength`.
   Bump `SAVE_FORMAT_VERSION` on P5, P8 and P9, each with a numbered entry in
   `SimulationSerializer.js`'s version-history docblock.
4. **`npm run benchmark`** after P0/P1 (the hottest loop in the engine) and again
   at the end (one new system). Re-baseline `BENCHMARK.md`.
5. **`npm run ethologist`** — it answers "did any individual animal behave
   absurdly", which is precisely this plan's risk surface: an animal locked on one
   bearing, a band collapsed to a point, a buffalo sprinting until it dies, an
   entity at NaN.
6. **Exploratory sweep as a reading, not a gate:**
   `npm run sweep -- --seedCount=3 --ticks=15000 --control=…` after P5 and after
   P9. Record `peak N concurrent` groups (that is how the 192 gets confirmed),
   foundings/dissolutions (A56's figure should fall), and per-species populations.
   The brief waives the balance bar — take the reading anyway.
7. **`npm run fixtures:renderer`**, then `npm test` and `npm run test:ui`, last.

## Cannot be built as asked

| Asked for | Blocked by | Nearest legal thing |
| --- | --- | --- |
| Separation between adjacent bands | a weighted mean cannot repel; a negative weight is a divide-by-≈0 → NaN landmine | differential attraction (P2) |
| A defensive **ring** | no repulsion force exists anywhere | calves measurably nearer the centroid than adults (P4) |
| Bachelor groups "falling out" of existing rules | `#joinOrFound` has no admission test | ⛔ **not built** — P6 skipped 2026-08-05. A dispersed bull stays loosely attached to the local buffalo through the herd *label*, which is what fission–fusion already models; a bachelor **identity** is out of scope |
| A stored leader / resident stallion | `GroupRegistry.js:44-51`, "standing is derived, never stored" | leadership-weighted centre, nothing stored (P7/P8) |
| Wildebeest subherds persisting while separated | 219 wildebeest on the registry blows `maxGroups`; `forms: false` is a stated decision | the consensus commitment, carried on the entity (P8) |
| Bands merging into a super-herd without losing identity | `GroupSystem` rule 6: records never merge, by design | overlapping labels over distinct records — already true |
| A group holding ground | A60: territory is keyed on entity id | out of scope; its own action item |
