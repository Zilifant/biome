# PLAN — Multiple species per animal type

A plan for going from **three species filling three roles** to **several species
per role**, each with its own behaviour, food, and water needs. Written
2026-07-24 against the code as it stands (protocol v28, 725 tests); revised
2026-07-28 to adopt a concrete African savanna roster (§0), again to record the
six settled decisions (§11), and again to put the **gazelle** rather than the
wildebeest in the first batch.

> ### ⚠⚠ Status: phases 0–14 are done, and the plan is PARKED (last updated 2026-07-30)
>
> **Phases 15, 16 and 17 are deferred — a decision taken on 2026-07-30, not a
> stall.** This document is no longer a plan for unimplemented work: phases 0–14
> have shipped (see §8) and the world has **eight species** — gazelle, wildebeest,
> zebra, buffalo, **leopard**, lion, vulture, hyena — at protocol v29.
>
> ⚠ **§8's own "reasonable stopping point" was after phase 13, and phase 14 went
> one past it**: eight species with clans, prides, bands, cooperative hunting,
> contested carcasses, mobbing, a three-tier grazing succession, a calving season,
> and an ambush predator. §2's table has **one ❌ row left** (the `diet` string).
> ⚠ Eight of the twelve species blocks and all nine always-per-species fields are
> used by a shipped animal — but `traits`, `genetics`, `disease`, and `feeding` are
> still inherited unchanged by all eight, which is A38's shape four blocks deep.
> Everything remaining is refinement — see `HANDOFF.md` §8 for what each deferred
> phase would cost.
>
> A section marked ✅ has an **"As built"** block recording where its own
> prediction was wrong; those blocks are the most useful part of the document now,
> and they sit *above* the original text, which is kept unedited as "the section as
> written". ⚠ Read the two together and prefer the As-built block: the plan was
> right about shape far more often than about consequence.
>
> **If the plan is ever resumed**, phase 15 (A51 browse, the `diet` forage-source
> list, sex-specific territory) is the next row and the largest single piece of work
> left in the document. §3.13 (vertical refuge) remains **deferred, deliberately**;
> phase 14 took the horizontal half of it — concealment — instead.
>
> ⚠ **Read §3.12's As-built before touching perception.** Phase 14's mechanism was
> built wrong twice, and both failures measured as "no effect" rather than as an
> error: a perception gate is not a predation gate, and a mechanism that hides
> bodies helps whoever hides and hurts whoever searches.
>
> ⚠ **The mechanisms built at phases 10 and 12 are now all declared** (§3.11 by the
> wildebeest, §3.16 by the gazelle, §3.12 by the leopard), which means their
> inert-and-byte-identical readings are **gone**; what replaced them is a narrower
> claim in each suite. Do not try to restore the old assertions.

The short version, still true of what remains: **the species system is already
good enough to declare new species, and not yet good enough to make them behave
differently.** The work is not "build a species system" — it is closing the places
where behaviour is still global, breaking the one-species-per-role assumptions
outside the engine, and making sure the animals occupy different niches rather
than competing to extinction.

**All six open decisions are settled** — see §11. The consequences run through
§3.8 (a full persistent-group registry, not the cheap cut) and §3.1 (a curated
`behavior` block, not the whole of `decision`). ⚠ The third consequence this
paragraph used to name — "lions in the first batch pull the group registry and
cooperative hunting from optional depth to prerequisite" — **was superseded before
either shipped**: the hyena and lion swapped batches (§0), so batch 1 pulled the
registry forward and left cooperative hunting in phase 10. The registry is still a
prerequisite; the reason is now the clan rather than the pride.

---

## 0. What changed in this revision

The roster was abstract (`browser`, `darter`, `courser`, `pouncer`, `jackal`,
`forager`). It is now a **named African savanna guild**, taken from
`african-species.md`: gazelle, wildebeest, plains zebra, African buffalo, black
rhino, African elephant, lion, leopard, spotted hyena, plus a vulture to keep the
obligate-scavenger niche occupied.

That document was written against an older `DOCS.md` and its **species biology
is adopted; its implementation proposals are treated as suggestions.** Where it
proposes something this codebase already does differently, or does at a
chokepoint it did not know about, the version here wins. Three places where that
matters most:

- It proposes a `SocialGroup` record type. This repo has a **deliberate** design
  decision that a herd is a label and nothing holds a membership list (DOCS §9
  Sociality). §3.8 adopts the registry anyway — that is a settled decision, taken
  with the conflict understood, because lions land in the first batch.
- It proposes several new combat/defense actions (`rally`, `mobThreat`,
  `chargeThreat`, `guardCalf`). Three of the four already have hooks:
  `defendersFor` and `trampleChance` in `HuntingSystem`, and `resolveContest` in
  `social/dominance.js`. §3.7 routes through those rather than adding a system.
- It proposes forage guilds as new resource fields. One of the two guilds
  (grass height/quality) is **derivable from state that already exists** —
  `biomass / capacity` — for no new storage at all. §3.3.

### The gazelle-first change

Putting the **gazelle** rather than the wildebeest in batch 1 removes most of the
risk from the first species step, and it is worth saying why:

- The existing `herbivore.grazer` is **30 kg** — which is a gazelle, not a
  wildebeest. Converting it to a gazelle is a rename and a docstring; converting
  it to a 200 kg wildebeest was a rename **plus a 6.7× rebalance** of every
  measured number in the demo. Batch 1 goes from "re-derive the whole demo" back
  to "prove nothing changed".
- `metabolism.referenceMass: 30` stays honest. Under the wildebeest plan the
  reference animal stopped existing in the world; under this one the gazelle
  _is_ approximately the reference animal, as it has been since Step 4.
- The **mass audit (§4) no longer fires on the herbivore side in batch 1.** It
  still fires — via the 180 kg lion — but on a much narrower front (§5.2).
- Grazing succession gets a third tier, which is the real Serengeti pattern and
  strictly better than the two-tier version: **zebra** take tall coarse grass,
  **wildebeest** the mid regrowth behind them, **gazelle** the short flush behind
  _them_. All three fall out of the same `biomass / capacity` preference (§3.3).

The wildebeest moves to **batch 3**, alongside the zebra, where it belongs: the
two are a competitive pair that only coexists once forage guilds exist, and
building either without the other means tuning it twice.

### The hyena-before-lion change

Batch 1's carnivore was the lion; it is now the **hyena**, with the lion moving to
batch 2 beside the buffalo. Four reasons:

- **The pairing is ecologically correct.** A 60 kg hyena on 30 kg gazelle is a
  prey/predator mass ratio of 0.5 — an ordinary predator–prey match, and gazelle
  is staple solo hyena prey. A 180 kg lion on gazelle is 0.17, well under what a
  pride is for.
- ⚠ **It closes a six-phase gap between building and validating.** Under the lion
  plan the group registry (phase 3) and cooperative hunting (phase 4) both shipped
  unproven until the buffalo arrived. The hyena's defining group behaviour is
  **kill theft**, and that _is_ demonstrable in batch 1, because the contested
  resource is the **carcass**, not the prey: a clan displacing the resident stalker
  from its kill works in a world containing only gazelle. The registry is built and
  proved in the same batch.
- **It nearly removes the batch-1 mass jump.** 60 kg against the stalker's 45 kg
  is 1.3×, not 4×.
- **Batch 2 becomes lion + buffalo**, which is a better pair than hyena + buffalo:
  a 600 kg buffalo is exactly what a pride is for, so cooperative hunting is built
  and demonstrated together rather than six phases apart.

The cost is one reordering: **carcass possession (§3.9) moves up** from a batch-2
prerequisite into phase 4, because kill theft is the hyena's whole identity and
because without it a 60 kg facultative scavenger simply flattens the 6 kg vulture
on id-order contention. `attackersFor` cooperative hunting trades places with it
and moves down to phase 10, so the phase count is unchanged.

The roster swap also **changed the headline risk.** The abstract roster's danger
was competitive exclusion between look-alike species (§2). A real savanna guild
is genuinely differentiated and mostly dodges that — and substitutes a new one:
a **~130× body-mass range** (6 kg to 4000 kg, before the elephant is even
counted) across an engine tuned in a 4–45 kg band. That is §4.

It also **dropped omnivory** from the critical path: no species in this roster
eats plants _and_ meat, so `diet` still has to stop being a binary string, but
toward **forage sources**, not toward an omnivore (§3.2).

---

## 1. What already works, and must not be rebuilt

- **A species is data.** `config/species/*.js` files declare biology only;
  `SpeciesRegistry` resolves each against the global config once at engine
  construction and hands systems a deep-frozen record via one `Map.get`.
- **Twelve blocks fall back to config:** `metabolism`, `hydration`, `aging`,
  `perception`, `traits`, `genetics`, `disease`, `reproduction` — plus
  `feeding`, `hunting`, `behavior`, and `predation`, added by phases 1–4 on
  2026-07-28. Plus always-per-species fields: `matePreference`, `territory`,
  `migration`, `diet`, `preySpeciesIds`, `groups`, and — from phase 9 — `forage` and
  `habitat`. ⚠ `feeding`, `hunting`, and `behavior` still barely vary by species —
  the schema arriving ahead of the roster, exactly as `disease` did at Step 29 (A38)
  — while `predation`, `groups`, `forage`, and `habitat` are all now *used* by a
  shipped species.
- **No system branches on a species name** — enforced by a source scan
  (`test/species-schema.test.js`), with behaviour driven by `diet`,
  `preySpeciesIds`, `territory.defends`, `migration.tracksForage`.
- **`demo.founding` is already a list** of `{ speciesId, count }`, walked in
  order — adding a cohort is a line, not a new spawn slot.
- **The vulture (then the corvid) is the existence proof:** a whole trophic level
  added as one config file, zero engine code. ✅ **The hyena proved it a second
  time on 2026-07-29** — a net-new species, and the renderer needed nothing at all
  because phase 6 had assigned its glyph in advance.
- **Metrics bucket by species dynamically** and sort by id; the renderer's
  legend is generated from the appearance registry.
- **Persistent groups exist as of 2026-07-28** (§3.8, phase 3). `world.groups` is
  a bounded record store and `groupRecordId` is the membership; a species opts in
  with `groups: { forms: true }`. ⚠ **This bullet used to say "no shipped species
  does, so it is inert".** That stopped being true on 2026-07-29: the **hyena**
  declares it, the demo founds real clans, and DOCS A55 closed. The herd label is
  untouched and is what the gazelle still uses — the two mechanisms now run side
  by side in one world, which is what §3.8 designed for.
- **Forage guilds and habitat preference exist as of 2026-07-29** (§3.3 and §3.4,
  phase 9). A species states `forage: { preferredBiomass, span }` — how coarse a
  sward it can still live on — and `habitat: { ground, cover, … }` — which terrain it
  wants. Both are **always-per-species fields beside a global section**, not
  `SPECIES_BLOCKS` blocks, and ⚠ that shape is now a *rule* rather than a preference:
  a species block beats the config, so an off switch inside one cannot switch
  anything off. Any future per-species mechanism needing a reproducible control has
  this shape.
- **Cooperative action exists as of 2026-07-30** (§3.7, phase 10): a species may
  state `hunting.cooperationWeight` (co-attackers raise the capture odds, and a
  predator joins a conspecific's committed chase) or `behavior.mobWeight` (adults
  turn on a predator that has gone for a groupmate). ⚠ **Mobbing is not a new
  action** — it is the groupmate half of `defend`, which DOCS §7 has described
  since Step 23 while only the kin half was built. ⚠ Both are 0 for every shipped
  species and the demo is byte-identical with them off; the lion and the buffalo
  (phase 11) are what they will be tuned against.
- **Neonatal concealment exists as of 2026-07-29** (§3.14, phase 8): a fawn lies
  hidden (`hide`) and its mother returns to it (`tend`), gated on
  `aging.hiddenUntil` and switchable at `parenting.concealment`. ⚠ Its `tend` half
  is the working example of DOCS A34's lever, and worth copying rather than
  reinventing the next time something needs a reason to return to a place.
- **Sexes, lineage, dominance, and injury all already exist**, which matters more
  for this roster than for the old one: sex-structured behaviour (§3.10),
  kin-based defense, and contest resolution are extensions of shipped
  mechanisms rather than new subsystems.
- **The gazelle's whole social and life-history model already works.** Loose
  herds, alarm propagation, forage-tracking migration, mother–calf attachment,
  fast juvenile development, heavy predation pressure, and male competition on
  size and condition are all shipped and tuned — `african-species.md` rates a
  config-only gazelle at **7/10**, the joint-highest in the roster, and the
  missing 3 are itemized in §3.14–§3.16.

So a fourth species can be added _today_. The reason to plan rather than just do
it is everything in §2–§7.

---

## 2. Competitive exclusion — the risk the African roster mostly retires

Two herbivores that eat the same grass, at the same rate, in the same places,
with the same predators will not coexist — one wins on the margin and the other
disappears, usually within a few thousand ticks and always in a way that reads
as "the new species is badly tuned". **Coexistence requires a niche difference
the engine can actually represent.**

The good news in the roster swap is that a real guild arrives pre-differentiated:
gazelle, wildebeest, and zebra differ in _grass maturity_, buffalo in _water
dependence and group defense_, rhino and elephant in _browse_, and the three
carnivores in _prey size and social mode_. The differences are real; the question
is only which of them the engine can express.

| Axis                           | Representable now?      | Via                                                  | Who needs it                    |
| ------------------------------ | ----------------------- | ---------------------------------------------------- | ------------------------------- |
| Body size / metabolism         | ✅                      | `bodyMass`, `metabolism`                             | everyone (but see §4)           |
| Life history (fast vs slow)    | ✅                      | `aging`, `reproduction`                              | everyone                        |
| Water dependence               | ✅                      | `hydration`, `migration.tracksWater`                 | buffalo, zebra, elephant        |
| Thermal band                   | ✅                      | `comfortMin` / `comfortMax`                          | everyone                        |
| Who eats whom                  | ✅ by species           | `preySpeciesIds` (empty = obligate scavenger)        | lion, leopard, hyena            |
| Sociality (herd vs solitary)   | ✅ **since 2026-07-28** | `behavior.herdWeight` — herding is automatic, its strength per-species | all herbivores, lion, hyena |
| ~~**How it behaves**~~         | ✅ **since 2026-07-28** | `behavior`, a species block of 22 weights (§3.1)     | everyone |
| **What food it eats**          | ❌ binary carnivore/not | `diet` is a string with two meanings                 | rhino, elephant (browse)        |
| ~~**Which grass it eats**~~     | ✅ **since 2026-07-29** | `forage.preferredBiomass` / `span` — standing crop *is* maturity, so no new state (§3.3, phase 9) | gazelle / wildebeest / zebra    |
| ~~**Where it lives**~~          | ✅ **since 2026-07-29** | a per-species `habitat` weight per terrain, read by the long-range cue (§3.4, phase 9) — ⚠ needs a `cueRadius` to act through. The **leopard** is the species this was waiting for and it got one at phase 14 | leopard, buffalo, rhino         |
| ~~**Ambush from cover**~~      | ✅ **since 2026-07-30** | graded `world.concealmentAt` (opacity is its top end) scaled by a per-species `crypsis`, plus a concealed-approach heading inside the existing `stalk` (§3.12, phase 14). ⚠ No ambush *term* anywhere — the advantage is emergent from where the two species choose to stand | leopard |
| ~~**Which individuals it eats**~~ | ✅ **since 2026-07-28** | `predation.maxPreyMassRatio` / `minPreyMassRatio`, gated in perception on `bodyMass` (§3.6, phase 4) | lion, leopard, hyena            |
| ~~**Persistent social identity**~~ | ✅ **since 2026-07-28** | `world.groups` + `groupRecordId`, gated by `groups.forms` (§3.8, phase 3) | lion, hyena, zebra, elephant    |
| ~~**Cooperative action**~~     | ✅ **since 2026-07-30** | `hunting.cooperationWeight` + `attackersFor`, and mobbing as the groupmate half of `defend` (§3.7, phase 10); **demonstrated at phase 11** by the lion and buffalo — company takes a hunt's odds 0.451 → 0.535, a mob takes them 0.451 → 0.275 | lion, hyena, buffalo            |
| ~~**Contested carcasses**~~    | ✅ **since 2026-07-28** | `carcass.possessorId`, contested through `resolveContest` (§3.9, phase 4) | lion vs hyena vs vulture        |
| ~~**Escape by agility**~~      | ✅ **since 2026-07-28** | `hunting.agility`, prey-resolved, one divide in `captureChance` (§3.15) | gazelle                         |
| ~~**Concealed newborns**~~     | ✅ **since 2026-07-29** | `aging.hiddenUntil` + the `hide`/`tend` actions and concealment in perception (§3.14, phase 8). ⚠ The *invisibility* half only bites for a fawn born on cover — DOCS A57 | gazelle |
| ~~**Heterospecific association**~~ | ✅ **since 2026-07-30** | a per-species `association` weight per partner species, read where the herd centre is already computed, plus the associate's alarm (§3.16, phase 12) | gazelle with wildebeest / zebra |

⚠ **This table is now one row from empty**, and the row left is `diet` (phase 15).
When it closes, the *next* unrepresentable axis will have to be found rather than
looked up — which is a harder job than any of the twelve above, and worth knowing
is coming.

**Six ❌ rows closed on 2026-07-28**, across phases 2–4: `behavior` became a
species block (§3.1), which is what makes "a skittish gazelle" and "a pride
versus a solitary cat" expressible at all; the group registry landed (§3.8),
which is what makes a pride a thing that exists between sightings; and phase 4
closed prey eligibility (§3.6), carcass possession (§3.9), and the agility term
(§3.15). **Three more closed on 2026-07-29** — concealed newborns at phase 8, then
grass maturity and habitat at phase 9. **Cooperative action closed on 2026-07-30**
(phase 10), ⚠ *expressible* but not yet exercised: no shipped species declares
either weight, so the row records a schema rather than a behaviour until phase 11.

**Heterospecific association closed on 2026-07-30** (phase 12), ⚠ *expressible* and
not yet exercised, in the same sense cooperative action was between phases 10 and
11: no shipped species declares an `association`, so the row records a schema until
batch 3 declares one.

What remains is **one row**: what food it eats (the `diet` string, phase 15).

⚠ **Prior art from this repo:** adding the corvid read as a balance problem
(3/10 seeds vs a 6/10 control) until the real cause turned up — `fleshIntakeRate`
was a flat constant that should have scaled with mass. Expect one of those per
new species, and budget for finding it rather than for tuning around it. §4 and
§5 are that lesson written out in advance.

---

## 3. Gaps to close before N species mean anything

### 3.1 ✅ Behaviour was global — `config.decision` split in two

`config.decision` **held** ~45 scalars that every animal in the world shared. A
skittish gazelle and a bold buffalo were not expressible; neither was "a rhino
does not flee"; and — most urgently for batch 1 — **a lion and a leopard sit at
opposite ends of `herdWeight`**, the single number that separates a pride from a
solitary cat.

✅ **Shipped 2026-07-28 (phase 2).** The section below is the plan as written,
kept because its reasoning is what should govern where a *future* field lands;
the "As built" block records the four places the prediction was wrong.

**Settled (§11.4): option B, implemented as a config split.** Not a curated
allowlist over the existing section — that is a second hidden list to maintain —
but physically splitting the config in two, then adding the new section to
`SPECIES_BLOCKS` as an ordinary block:

| `config.behavior` — per-species (biology)                                                                                                                                                                                                                                                                                                                              | `config.decision` — global (mechanics)                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hungerWeight`, `thirstWeight`, `fleeWeight`, `herdWeight`, `herdDistance`, `defendWeight`, `restBias`, `wanderBias`, `explorationRate`, `mateWeight`, `shelterWeight`, `recallWeight`, `huntWeight`, `stalkDiscount`, `chaseRange`, `minHungerToHunt`, `minHuntStamina`, `patrolWeight`, `retreatWeight`, `dangerRadius`, `leaveThicketWeight`, `thicketRefugeRadius` | `minCommitTicks`, `commitTickSpan`, `wanderJitter`, `ranging*`, `fleeWallMargin`, `fleeLookahead`, `intrusionThreshold`, `thicketExitRadius`, `needOverridesTerritory`, `patrolSpanFactor`, `followDistance`, `mateDistanceWeight`, `recallRange`, `recallDistanceWeight`, `shelterStress*`, `drinkRange`, `huntCooldownTicks` |

That is ~22 fields, not the ~10 first guessed — this roster needs more
differentiation than the abstract one did. The line is arguable in a couple of
places (`dangerRadius` and `patrolSpanFactor` could go either way); drawing it
_at all_ is the deliverable, and a field can be moved later.

#### ✅ As built (2026-07-28) — where the table above was wrong

The split shipped at **22 behaviour fields and 14 global**, but not quite the
ones predicted. Recorded rather than silently corrected, because the reasons are
reusable:

- ⚠ **`leaveThicketWeight`, `thicketRefugeRadius`, `thicketExitRadius`,
  `needOverridesTerritory`, and `ranging*` are not in `config.decision` at all.**
  They are **constructor-only defaults** on `DecisionSystem` and always have been,
  so there was nothing to move — and, more to the point, they cannot be tuned
  through config today by anyone. That is a pre-existing gap this split did not
  close; a species that wants its own thicket behaviour needs them promoted to
  config first.
- **`followWeight` and `defendRange` went to `behavior`** (both absent from the
  prediction). How tightly young follow, and how far an adult will go to
  interpose, are plainly biology.
- **`eatBias` and `drinkBias` stayed global** (also absent above). They are
  tie-breaks that stop `eat` oscillating against `seekFood` on the same cell —
  machinery, not appetite.
- **`drinkRange` is not in the global column either**: phase 1 had already
  removed it, leaving `hydration` its sole owner (§5.4).
- **`shelterWeight` came from `config.locomotion`, not `config.decision`.** It is
  a decision weight that happened to live with the movement constants, and
  nothing but `DecisionSystem` read it. ⚠ `shelterRelief` deliberately did *not*
  move — it is shared with metabolism through the `thermalStress` chokepoint
  precisely so the system that charges for stress and the one that decides to
  walk out of it cannot drift.

**Why the split rather than the whole block.** Both are small changes. The
difference is what a species file is allowed to _be_. Today it reads as a list of
what makes that animal unusual. Handing it `minCommitTicks`, `wanderJitter`,
`fleeLookahead`, and `intrusionThreshold` lets a species file change how the
_engine_ works rather than how the animal behaves — and once one species tunes
those, the demo stops being one world with N animals in it and becomes N
separately-tuned simulations sharing a map.

Two hazards, both smaller than feared:

- ⚠️ **"A species block beats a system's constructor options."** DOCS.md calls
  this the single most surprising thing in the codebase; when the schema landed
  it silently inverted 23 tests, which kept compiling and stopped meaning
  anything. **Measured 2026-07-28: 32 `new DecisionSystem({…})` calls across 15
  test files, and 30 of them set only `foodMinLevel`.** The rest set
  `shelterWeight`, `patrolSpanFactor`, and `maxMemories` — one test each. So the
  audit surface is ~2 tests, not 23. Still do the audit; just do not budget a week
  for it.
- **Hot-loop cost.** `DecisionSystem.update` reads these as instance fields once
  per animal per tick. The `Map.get` is **already paid** — `update` already looks
  the species up for `diet`, mate preference, and territory — so this reuses the
  `params = world.species.get(id)?.block ?? this` pattern `MetabolismSystem`
  already uses, and the only new cost is property loads going polymorphic across
  species records. Must still re-baseline.

  ✅ **Both hazards measured 2026-07-28. The first was right; the second was
  wrong, and wrong in an instructive way.**

  The **constructor-options audit** came to three test files — `social`,
  `territory`, and `traits` — on top of the two phase 1 had already converted
  (`injury`, `hunting`). Small, as predicted. The fix is always the same: route
  the override through the **config**, which is what the registry resolves
  against.

  ⚠ **The polymorphic-property-load prediction was simply false.** The split
  cost nothing measurable: an A/B forcing `behavior = this` — no species lookup
  at all — was *just as slow* as the split version. What did cost 12% of total
  engine time was somewhere the plan never looked: phase 1's per-species
  `foodMinLevel` had made `PerceptionSystem#perceive` a **four-argument**
  function, and that arity alone was the whole regression (66.1 → 70.7 ms/tick;
  three arguments read 62.8). Passing the resolved block as one object fixed it,
  and large-5k finished at 69.50 against a same-session HEAD of 69.2/70.6/72.1 —
  flat. Written up as **D28**.

  Two lessons worth carrying into phase 3, which touches hotter code than this
  did: **the guess about *which* line is expensive was wrong even though the
  suspicion that something would be was right**, and the per-system profiler
  *hid* it — wrapping prototypes to time each system reported +0.8%, because the
  wrapper overhead perturbed exactly the inlining under test. Measure the
  population trajectory and total ms/tick, not a wrapped breakdown.

### 3.2 ✅ Food blocks landed; `diet` is still a two-valued string

- ✅ **Done (phase 1).** `config.feeding` was not a species block; it is now.
  ⚠ Two resolution rules were decided while wiring it and are easy to get
  backwards: **feeding's mass scaling reads the `metabolism` block**, not
  `feeding`, because that is where `referenceMass` lives and where
  `MetabolismSystem` reads it — otherwise a species could change what it burns
  without changing what it can take in.
- ✅ **Done (phase 1).** `config.hunting` was likewise global, so two predators
  could not differ in how they capture. ⚠ It resolves off the **hunter**, except
  `edibleMassFraction`, which resolves off the **prey** — what it describes is
  how much of a body is meat, not what killed it. Lion, leopard, and hyena differ
  on almost every field in it, the hyena arrives in batch 1, and the gazelle's
  agility term (§3.15) will live here too.
- ⏳ **Still open.** `diet` is a string tested as `=== 'carnivore'`; everything else grazes. There
  is no browser, no distinction between grass and woody browse, and no way to say
  "eats leaves off shrubs, not grass off the ground". → Replace the string with a
  **forage source list**: which sources a species can use, at what relative rate,
  and with what preference ordering. This is the one item that must touch
  `FeedingSystem` and `DecisionSystem` — still data-driven, still no species-name
  branch. Not needed until the rhino (batch 5).

**Two things the roster swap removed from this section.** No African species
here is a plants-and-meat omnivore, so **omnivory drops off the critical path**
entirely. And the _facultative_ scavenger case — hyena, which hunts and also eats
carrion — needs no engine change at all: it is a carnivore with a non-empty
`preySpeciesIds`, exactly as the stalker is. Only **grass vs. browse** is
genuinely unbuilt.

### 3.3 ✅ Forage guilds — grass maturity (shipped 2026-07-29, phase 9)

✅ **Built, and this section's central claim — that the maturity axis is free —
held. Its central *proposal*, the ratio `biomass / capacity`, did not.** The
section as written follows; four deltas, and the first is the phase's real result:

- ⚠⚠ **The ratio was built, measured, and rejected in favour of absolute standing
  crop.** The reasoning below for a ratio is good and it fails for a reason nothing
  here could have seen: **a ratio knows nothing about absolute abundance**, so in a
  low-capacity world every ungrazed cell reads as rank grass. The sparse-forage
  selection sandbox (`vegetation.capacity: 1.0`) holds at most one biomass unit per
  cell — a lawn — and under the ratio the gazelle discounted the only food in that
  world and went **extinct inside 5000 ticks**, breaking a shipped scenario. What
  shipped is `forage: { preferredBiomass, span }`, read straight off the biomass
  field. It is cheaper still (no second grid read at all, since the gradient already
  reads biomass) and physically truer: two cells holding the same standing crop are
  the same height of grass whatever their potential.
- ⚠ **The falloff is one-sided**, not a window: ideal at and below
  `preferredBiomass`, discounted only above it. A symmetric window **double-counts
  scarcity** — a nearly-bare cell already hands an animal almost nothing, because
  `consumeAt` returns only what is there — and measured, it punished exactly the
  ground a herd lives on (its own grazing halo): **gazelle 3/10 seeds against the
  control's 10/10**, taking the stalker and hyena down with it. The other side of
  the succession needs no term: a 300 kg zebra cannot live on a cropped sward
  because mass-scaled intake already says so.
- ⚠ **The section was right that the gradient needed rescoring, and the fix is
  subtler than "score it".** Scoring direction *and* strength from
  `biomass × quality` inverts the animal's motivation: quality ≤ 1 shrinks the
  difference between here and there, so an animal surrounded by grass it disliked
  had almost no reason to move — when it is precisely the animal that should move.
  What shipped: **the preference chooses the direction, raw biomass sets the
  strength.** (The section also names `world.nearestFood` as a reader. There is no
  such method; the readers are perception's cell scan and this gradient.)
- **Perception's nearest-food scan was left monotonic on purpose.** Making it pick
  the best-scoring cell rather than the nearest means computing a quality for every
  candidate instead of only for cells nearer than the best so far — in the hottest
  loop in the engine, where D28 records one extra *argument* costing 12% of a tick.
  So an animal walks to the nearest grass and then decides whether it is worth
  eating. Recorded as a stated limit.

**Preference is a discount, never a veto**: it scales the hunger drive and floors at
`forage.qualityFloor`, so a comfortable animal walks off rank grass and a starving
one eats it. Only the gazelle states a preference; its succession partners arrive in
batch 3, and its numbers are expected to be re-tuned then.

**The gate, and what it took** — 10 seeds × 15 000 ticks, mechanism on against off
over the same seeds and in one process (2026-07-29). ⚠ **Three arms, because the
first two are the record of the two design failures above:**

| Arm | gazelle | stalker | hyena | vulture |
| --- | --- | --- | --- | --- |
| ratio + symmetric window | **3/10**, mean 0.6 | 3/10, 0.4 | **0/10**, 0.0 | 9/10, 19.4 |
| standing crop, floor 0.30 | 9/10, mean 59.8 | 8/10, 4.9 | 7/10, 1.9 | 10/10, 102.6 |
| **shipped** — floor 0.55 | 8/10, mean **94.3** | 9/10, 4.8 | 9/10, 3.0 | 10/10, 119.1 |
| control (mechanism off) | 10/10, mean 81.5 | 9/10, 5.4 | 10/10, 3.4 | 10/10, 133.5 |

The shipped arm puts the gazelle **above** the control's mean and the two carnivores
level with it; the vulture is down 11%. ⚠ What it does not buy back is the last seed
or two of gazelle survival — it loses seeds 7 and 10 *late* (t13291, t14275) where
the 0.30 arm lost seed 8 — and D14's rule applies: on a population whose control
range is 15–184, one seed is the signature of noise rather than of the parameter.
Recorded rather than tuned against.

**And it fires** (seeds 1 and 42, 3000 ticks): the mean standing crop of the cell a
gazelle is *eating on* falls **3.31 → 1.93** and **4.25 → 2.88** — it is choosing
shorter grass, which is the whole claim. (The habitat half's own number is in §3.4.)
Asserted against the demo world in `test/habitat.test.js` rather than left as prose,
because §1.2's standing complaint is mechanisms that are correct and never do visible
work.

### 3.3 The section as written

`african-species.md` asks for four resources: short grass, tall/coarse grass,
woody browse, and point fruit. Split them by cost, because they are not remotely
equal:

**Grass maturity is free.** `VegetationGrid` already stores dynamic `biomass`
against a static per-cell `capacity`. The ratio `biomass / capacity` **is** the
maturity/quality axis: a cell at 0.9 fill is tall, coarse, low-quality standing
grass; a cell at 0.3 fill is short, freshly regrowing, high-quality forage. So
the roster's three grazers stack into the real **grazing succession**:

| Species    | Prefers                          | Effect on the cell               |
| ---------- | -------------------------------- | -------------------------------- |
| zebra      | high fill — tall, coarse         | crops it down, opening the sward |
| wildebeest | mid fill — the regrowth behind   | grazes it shorter still          |
| gazelle    | low fill — the short green flush | maintains it                     |

Three species coexisting because each one's feeding _creates the next one's
habitat_, from two numbers apiece — `forage: { preferredFill, fillTolerance }`,
read where `seekFood`/`eat` already score a cell — with **zero new state, zero
save format change, and zero new grid.** That is the single best cost-to-realism
ratio in this whole document, and it is strictly better with the gazelle in the
roster than it was with two tiers.

⚠ Verify before building: this makes forage preference a **non-monotonic**
function of biomass for the first time. Everything in the engine that assumes
"more grass is better" needs checking — most importantly `MigrationSystem`'s
forage gradient (which samples eight directions and steers toward _more_) and
`world.nearestFood`. A gazelle steering toward maximum biomass while preferring
low biomass will oscillate. The gradient must be scored through the same
preference function, not against raw biomass.

⚠ Expect to **re-tune the gazelle when the larger grazers arrive.** In batch 1 it
is the only herbivore and its forage preference is unconstrained; from batch 3 it
is the bottom tier of a three-way succession. That re-tune is planned work, not a
regression.

**Woody browse is not free, and it is already planned.** Rhino and elephant are
browsers; without a woody resource they are "a heavy wildebeest" and nothing else.
The honest build is **A51, the dynamic shrub layer** — a growing, grazable,
maturing plant layer that already has a five-step build order written down in
`ACTION-ITEMS.md`, mirrors the vegetation architecture, and folds into the three
existing chokepoints. It was designed as a refuge; **it is also the browse
field**, and its `woodyFloor` concept (eat the leaves, the trunk and its cover
remain) is exactly the right model for browsing pressure.

That also settles where **elephant vegetation damage** belongs. Terrain is
derived and unsaved and ⚠ nothing may mutate it, so "elephants convert woodland
to open ground" cannot be a terrain edit. It can be a _shrub_ edit, because the
shrub layer is dynamic and saved.

**Point fruit is dropped** unless something needs it. It is A3 (the reserved
`plant` entity kind) and no species in this roster requires it.

### 3.4 ✅ Habitat preference (shipped 2026-07-29, phase 9 — closes A49's habitat half)

✅ **Built as per-terrain weights, as proposed — but at one chokepoint of the three
named, and the two that were dropped were dropped on measurement.**

- **It is a field, not a block**, for the phase-8 reason: a species block beats the
  config, so an `enabled` inside one is not an off switch. `config.habitat` holds the
  switch and the shape; `species.habitat` holds the weights, keyed by the terrain
  legend's own names so a partial declaration ("avoids thicket, otherwise
  indifferent") is one number.
- ✅ **The migration cue was the right consumer** and is the only one built. It
  reaches the animal through the wander heading, which is where **40–77% of all
  animal-ticks** are spent (measured 2026-07-29) — the only place in this engine
  where a preference of this size can do visible work.
- ❌ **Scaling `rest` by the ground underfoot would have been born near-inert.**
  `rest` is **0.8–1.6%** of animal-ticks in the demo and is already gated to
  satisfied animals. That is A34's shape exactly, and measuring first is what kept
  it from being built.
- ❌ **Weighting the home range (settling) was declined on principle.** A home range
  is a running average of where an animal has *been*; bending it toward liked ground
  makes it a statement of preference rather than a measurement, and its only
  consumer (`patrol`) is near-inert anyway.
- ⚠ **It bends the need-cue's heading rather than competing with it.** Competing on
  strength left it near-inert (cover occupancy 6.9% → 6.3%) once the forage cue was
  fixed to keep full strength; blending — the shape the trail drift already uses —
  moved it to 4.9%. And it is the **one cue not throttled by a need**, because
  hunger and thirst silence the others for exactly the animal that acts on where it
  would rather be.
- ⚠ **A preference needs a `cueRadius` to act through**, and three of the four
  shipped species set that to 0 deliberately. Only the gazelle declares habitat
  weights; a cover-loving leopard needs a cue radius first (batch 4).

Measured: gazelle time on cover **9.2% → 8.1%** and **6.9% → 4.9%** against cover's
2.8% of the map — it was using cover at twice its availability, because cover grows
1.35× the biomass and nothing else about it was visible to the cue.

### 3.4 The section as written

Nothing lets a species prefer thicket over open ground, or open plain over cover.
This is the cheapest remaining niche axis and it is already an open action item.

**Proposal:** a `habitat` block — per-terrain weights consumed at the existing
chokepoints (wander/patrol heading scoring, migration cue, settling). The roster
makes it load-bearing rather than decorative: gazelle, wildebeest, and zebra are
open-plain animals, leopard and rhino are cover animals, and buffalo sit near
water. Without it every species prefers the same ground and §2 comes back.

### 3.5 ✅ Water needs are now fully expressible

`hydration` is already per-species (`dehydrationRate`, `drinkRate`,
`drinkRange`), and `migration.tracksWater` decides whether the animal gets a
long-range steer to the lake. What was missing was the _decision_ side —
`thirstWeight` was global and `drinkRange` was duplicated in both `hydration`
and `decision`. ✅ Both closed on 2026-07-28: `thirstWeight` is now in the
per-species `behavior` block (§3.1) and `hydration` is `drinkRange`'s sole owner
(§5.4). ⚠ `drinkBias` deliberately stayed global — it is the tie-break that stops
`drink` oscillating against `seekWater` at the same spot, which is machinery.
So the water axis is now fully expressible per species.

Buffalo is the species this bites: strongly water-dependent, and "congregates at
the waterhole" should fall out of a high `thirstWeight` plus a low
`dehydrationRate` tolerance rather than needing a new mechanism. The lake is
**already** a gathering point — measured, occupancy within 20 cells rose 17% → 30%
when `tracksWater` landed — so this is tuning an existing effect, not building one.

### 3.6 ✅ Prey eligibility — mass gating (shipped 2026-07-28, phase 4)

✅ **Built as proposed, with two additions the section did not call for and one
number it did not name.** The reasoning below stands; the deltas are:

- **The gate runs in both directions.** The section only asked that a predator
  not commit to prey it cannot take. The mirror — that an animal too big to be
  taken should stop treating the hunter as a threat — is the same comparison with
  the roles swapped and is what stops an adult rhino fleeing a leopard for life.
  ⚠ The two are not symmetric in cost: the hunter's own bounds hoist out of the
  neighbour loop into two numbers, but "does *that* animal hunt me" needs
  whichever species is looking, so the threat side resolves per neighbour. Paid
  only on the rare true case of the reverse relation.
- **`riskyMassRatio` turned out to already exist as a literal.** The section said
  the hook was `trampleChance` and needed "a species-tunable weight, not a new
  mechanism" — it was more exact than that. The term was
  `Math.min(2, defenderMass / attackerMass)`, and the ratio simply *is* that
  hardcoded `2`. Default 2 makes the change a magic number becoming species data.
- ⚠ **Both ratios ship as `null`.** The section did not say what to default them
  to, and the honest answer is "nothing". Any ratio tight enough to be
  interesting would stop a *subadult* stalker (bodyMass ~25 kg while it grows
  toward 45) from taking an adult grazer (up to ~34 kg) — a large ecological
  change on a knife-edge demo, bought for a roster that has nothing to spend it
  on. `null` skips the comparison, which is exactly the identity (D16), and the
  species that need ratios declare them when they arrive.

### 3.6 The section as written

`preySpeciesIds` is a flat list of who is edible. `captureChance` already reads
prey condition — health, and `bodyMass / adultMass` as a "grown" fraction — but
nothing gates **eligibility**. A predator will commit to any listed species at
any size.

With a 30 kg grazer and a 45 kg stalker that never mattered. With a 180 kg lion
and a 600 kg buffalo it is the difference between a simulation and a farce.
A leopard should hunt a wildebeest _calf_, lions may take adult buffalo at real
risk, and adult elephant and rhino should be ineligible.

**Proposal — and it is cheaper than it looks.** Add a `predation` block:

```text
predation: { maxPreyMassRatio, minPreyMassRatio, riskyMassRatio }
```

and gate in `PerceptionSystem`'s classification loop, immediately after the
existing `hunts()` call: a candidate is prey only if
`prey.bodyMass <= self.bodyMass * maxPreyMassRatio`.

⚠ **Use `bodyMass`, not `adultMass`.** `bodyMass` is the animal's _current_ mass
and grows along the aging curve, so **age-structured prey selection falls out for
free**: a wildebeest calf is under the leopard's ratio and its mother is over it,
with no life-stage conditional anywhere and nothing new stored. That is the whole
"calf targeting" requirement, obtained from a field that already exists.

Two notes:

- Keep the mass test **out of** `SpeciesRegistry.hunts()`. That predicate is the
  busiest in the engine (twice per neighbour per animal per tick) and its linear
  `includes` was measured, not assumed. Leave it as the species relation and put
  the mass gate after it, so the extra comparison only runs on the rare true case.
- `riskyMassRatio` is the buffalo case: prey large enough to be taken but likely
  to hurt the hunter. The hook already exists — `HuntingSystem`'s `trampleChance`
  already scales predator injury by `defenderMass / attackerMass`. It needs a
  species-tunable weight, not a new mechanism.

`minPreyMassRatio` is the gazelle's protection in reverse: it is what stops a
600 kg predator bothering with something it cannot profit from, and it is why a
batch-1 lion on gazelle-only prey needs care (§10.1).

### 3.7 ✅ Cooperative action (shipped 2026-07-30, phase 10 — closes A33, and settles A32)

✅ **Built, and the section below was right about the hooks and wrong about the
shape of one of them.** Four deltas, and the third is the phase's real result:

- ⚠⚠ **Mobbing is not a `flee` alternative — it is the unimplemented half of
  `defend`.** The section calls it "a `flee` alternative, not a `wander`
  alternative", and the reasoning behind that (it must not compete with foraging)
  is exactly right. But it led to an action that did not need to exist: DOCS §7
  has described `defend` as *"a predator is on kin **or a groupmate**; stand and
  face it"* since Step 23, and only the kin half was ever built. So mobbing shipped
  as a second **trigger** for an existing action, with its own weight
  (`behavior.mobWeight`) because a herdmate is a different risk from your own calf.
  The candidate set is the size it always was. ⚠ The transferable rule: **before
  adding an action, check whether the one you want is already described by an
  existing action and merely unimplemented on one branch.**
- ✅ **`attackersFor` landed exactly as proposed** — the mirror of `defendersFor`,
  feeding `captureChance` from the other side, plus a joining rule (a predator with
  no prey of its own adopts a conspecific's `huntTargetId`). ⚠ Only a committed
  `chase` is joinable, never a `stalk`: a stalk is not yet a hunt, and a chase
  bounds the geometry for free. "Conspecific" tightens to "same group record" when
  the hunter has one, as the section hoped.
- ⚠⚠ **The A32 fix failed, and its failure is the useful part.** The section names
  the lever — relax "nearer the predator than I am" to "near enough to interpose" —
  and it was built (`decision.interposeSlack`), measured, and **ships at 0**: with
  the clause removed *entirely*, `entity.defended` measured 0/1/1 over 2000 ticks
  on three seeds against the strict test's 1/1/0. Measuring the whole chain instead
  of the last link relocated the problem: predators commit to a **juvenile** in only
  6–9% of hunter-ticks, and in **1–4 of those per 2000 ticks** is a living parent
  within perception of the hunt. There are one to four opportunities before any
  geometry test runs, so no ward-selection rule can be the fix. Full table in DOCS
  §1.2 A32; the remaining levers are prey selection and perception radius, both
  species biology, both for phase 11.
- ⚠ **Both mechanisms ship inert and byte-identical**, since no species declares
  `cooperationWeight` or `mobWeight` — and one thing cooperation *cannot* express
  is recorded as **A59**: prey eligibility is resolved per animal in perception, so
  "prey no single hunter would commit to, that a pride will" needs a second,
  cooperative mass ceiling. A lion therefore needs a ceiling high enough to commit
  alone, and cooperation supplies the odds rather than the eligibility. Decide in
  phase 11 with the buffalo in front of it.

### 3.7 The section as written

Three of the roster's headline behaviours (lion and hyena group hunts, buffalo
mobbing) do not exist. `african-species.md` proposes four new actions; this
repo's recorded lesson is that **four consecutive steps deliberately added no
action at all** and instead gave existing machinery a reason (DOCS §9 Decision).
Follow that, because the hooks are genuinely already there:

- **Cooperative defense already exists** and is exactly the right shape:
  `defendersFor(world, prey)` counts adult groupmates, shaves `captureChance`
  with diminishing returns and a cap, and an interposing parent counts double.
  Buffalo "collective calf defense" is mostly this with per-species weights
  (§3.1) — plus a real fix for **A32**, which is that juvenile defense fires about
  once in 12 000 ticks because the geometry never arises. The named lever is
  already written down: relax "nearer the predator than I am" to "near enough to
  interpose".
- **Group hunting is the mirror of it.** Add `attackersFor(world, prey)`
  symmetric to `defendersFor`, feeding the same `captureChance` product from the
  other side. A predator adopts a conspecific's `huntTargetId` when it perceives
  one already chasing — perception already classifies conspecifics, and
  `huntTargetId` already lives on the entity. **No new neighbour walk.** Lion and
  hyena group hunts become a per-species `hunting.cooperationWeight` plus a
  willingness to adopt a target. With the group registry (§3.8) landing first,
  "conspecific" can tighten to "same pride", which is the version that actually
  reads as a pride hunting together.
  ⚠ **Cooperative capture only pays when prey is too large for one hunter**, so
  it is built in **phase 10 and proved in batch 2**, alongside the lion and the
  600 kg buffalo that justify it. A batch-1 hyena hunts gazelle solo, as a real
  one does; its group behaviour in batch 1 is **kill theft** (§3.9), not
  cooperative capture. Building `attackersFor` earlier would mean tuning
  `cooperationWeight` against a case it was not built for.
- **Mobbing (A33) is a `flee` alternative, not a `wander` alternative.** This
  matters, because the most expensive lesson in the project is that a new
  movement behaviour competes with foraging and foraging must win. Mobbing does
  not compete with foraging: it competes with fleeing, in a situation where the
  animal had already stopped foraging. That makes it a much safer addition than
  `patrol` was. Its effect lands on the two terms that already exist —
  `shielding` in `captureChance` and `trampleChance` for the hunter's injury.

⚠ **Do not build separate lion, hyena, and buffalo combat systems.** That advice
from `african-species.md` is correct and matches this repo's own rules: one
generalized mechanism, driven by species data.

### 3.8 ✅ Persistent social groups — full registry (shipped 2026-07-28, phase 3)

✅ **Built.** The section below is the plan as written, kept because its reasoning
is what should govern the *next* decision about group state; the "As built" block
at the end records the five places the design sketch was wrong and why.

**Settled (§11.2): build the full bounded group registry, and build it early**,
because lions land in the first batch and a lion without a pride is, in
`african-species.md`'s words, "several adjacent independent predators".

⚠ **This overrides a deliberate, documented design decision, and DOCS.md must say
so rather than quietly changing.** DOCS §9 Sociality currently reads: _"A herd is
a label, not a roster. Nothing anywhere holds a membership list."_ Herds form,
merge, and split by local min-id propagation with no structural operation at all,
and two hard-won bounds (`maxGroupHops`, `maxAlarmHops`) exist because that local
mechanism went pathological without them. That mechanism is **not being deleted**
— it stays, and it keeps doing what it is good at.

The two must be kept clearly separate, because they model different things:

| Mechanism                             | Models                                                       | Used by                                             |
| ------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| **Herd label** (existing, positional) | fission–fusion aggregation: who I happen to be standing with | gazelle, wildebeest, buffalo herds                  |
| **Group record** (new, persistent)    | identity that survives separation: who I belong to           | lion pride, hyena clan, zebra band, elephant family |

⚠ The gazelle is explicitly on the **label** side. `african-species.md` is direct
about it: gazelle social groups are fluid and _"better represented by the existing
herd system than the persistent family structures needed for zebra, elephants,
lions, or hyenas."_ So batch 1 exercises the registry for the **hyena clan** only,
with the gazelle as the control that proves the old label mechanism still works
untouched — the two mechanisms running side by side in the same world from the
first species batch, which is the cleanest possible test that they stay separate.

⚠ Per the state-ownership rule, **two systems must never write the same field.**
The registry must not write `groupId`; that field belongs to `SocialSystem`. A
membership reference is a separate field (`groupRecordId` or similar) with a
single declared writer.

**What the registry costs, stated up front so none of it is a surprise:**

- A bounded record store on the world, in the shape of the precedents that
  already exist — disturbances (≤3), tombstones (256, FIFO), `FeatureGrid`
  (8192). Fields roughly `{ id, type, speciesId, memberIds, leaderId, centre,
createdTick }`.
- **A `SAVE_FORMAT_VERSION` bump** and serializer coverage — this is new
  authoritative state.
- **A protocol projection**, because invariant 19 requires significant biological
  behaviour to be inspectable, and "which pride is this lion in" is exactly that.
  Fold it into the same protocol bump as §6 (v29) rather than taking two.
- **A stated eviction / dissolution policy.** The tombstone registry already
  taught this project that _"forgotten" must be a stated limit, not a failed
  lookup_. A group whose members all die must be reclaimed, and a bounded store
  that fills must have a defined answer.
- **Structural discipline:** records are created and destroyed at a controlled
  boundary, in the spirit of invariant 13, not mid-iteration.
- **Determinism:** member lists iterate in ascending id order, like every other
  collection in the engine.

Founding, joining, and leaving are the design work. The cheapest honest first
cut: a record is founded when an animal of a `social.formsGroups` species has no
group and meets a conspecific with none; membership is inherited by offspring
(matrilineal for lion and hyena, which is also what makes female philopatry and
male dispersal expressible); males leave at dispersal age (§3.10).

#### ✅ As built (2026-07-28) — where the sketch above was wrong

Every cost the section predicted was real and was paid: the save bump, the
dissolution policy, the ascending-id iteration, the structural discipline, and
the rewrite of DOCS §9 Sociality. Five things came out differently, and the
reasons are reusable:

- ⚠ **`leaderId` was dropped, not deferred.** The field list named one. Storing
  it would be storing a **rank**, and DOCS §9 is explicit that "standing is
  derived, never stored" — `dominanceOf` reads mass, condition, soundness,
  boldness, and maturity on demand precisely so a mauled animal loses standing.
  §10.2 also puts rank-structured access out of scope for both prides and clans,
  so the record would have carried a field nothing was allowed to use. A consumer
  wanting the dominant member walks the bounded `memberIds`. `founderId` took its
  place: a fact about history rather than about hierarchy.
- ⚠ **`centre` was dropped too**, for the same family of reason: it is a pure
  function of where the members are right now, and caching it into *saved* state
  is the one place a derived value can go stale across a load. Derived on read.
- **The gate is not `social.formsGroups`.** `config.social` is the herd-label
  section, and hanging the registry's switch inside it would have merged the two
  mechanisms in the one place the whole design says to keep them apart. It is a
  separate `groups` section, and — following `migration` and `territory` rather
  than the `SPECIES_BLOCKS` pattern — an **always-per-species field, not a
  block**: the section also holds world-level machinery (`enabled`,
  `updateInterval`, and the store bound `maxGroups`), and a species block would
  have handed every species a knob on a store it does not own.
- **The store bound refuses rather than evicts.** The section asked for "a
  defined answer" when a bounded store fills and left the answer open. It is: a
  full registry declines to found a new group until one dissolves. Evicting would
  delete a clan whose members are all still alive, which is the failure
  `forgotten` exists to avoid in the tombstone registry — there, eviction is fine
  because the oldest tombstone genuinely is the least useful and `forgotten` is a
  reportable answer. `FeatureGrid` declining to track new ground is the closer
  precedent and is the one this copies.
- ⚠ **The protocol projection did not land, on purpose.** §6 already says to take
  it in the v29 bump; doing it here would have meant two protocol versions and
  two fixture regenerations in consecutive phases. It is now tracked as **DOCS
  A54**, with the note that it stops being a scheduling choice and becomes a
  defect the moment a species actually forms groups — which is the same phase the
  bump lands in.

Two things worth carrying forward. **The mechanism is inert and that was
measured, not assumed** (D27's lesson applied in advance): no shipped species
declares `groups.forms`, and the demo's entity state is byte-identical across
three seeds at 1500 ticks, with large-5k flat against interleaved HEAD readings.
And **the hot-path fear from phase 2 did not repeat**, because the system's first
branch is "does any species in this world form groups?" — one `Set` built per
world and a size check per tick. The neighbour walk it would otherwise need is
never reached.

### 3.9 ✅ Carcass possession and kleptoparasitism (shipped 2026-07-28, phase 4)

✅ **Built, and cheaper than proposed.** The section below stands; four deltas:

- **No freshness stamp.** The proposal was "`possessorId` and a freshness
  stamp". Possession is held by **presence** instead — a holder still standing
  over the body holds it, one that walked away does not — which answers the same
  question with nothing stored and cannot get stuck in a state nobody clears.
  The mechanism is one field.
- **No stored group possessor either.** "Possession can be held by a group" is
  read off `holder.groupRecordId` on the live holder, so a clan shares a kill
  with no second copy of the membership on the carcass to outlive the group.
- **"Challenges, waits, or leaves" resolved into one rule**: challenge only when
  strictly stronger. Dominance decides a contest, so an outmatched challenger
  would be choosing to lose; and because the winner then eats, the arrangement
  is self-stabilising — a takeover happens once rather than once per tick, with
  no cooldown field and no flapping.
- ⚠ **The decision system had to learn the same rule**, which the section did not
  anticipate. Enforcing possession in feeding alone produces an animal that
  chooses `eat` every tick and starves standing on a body it cannot touch,
  because nothing outscores a meal at your feet. One predicate, two readers.

⚠ **And it is the one part of phase 4 that a shipped world can feel**, so it
carries a config switch and a ten-seed sweep against it. **The sweep changed the
design**, which is the most useful thing in this section:

The first cut excluded outright — a bystander at an occupied body got nothing —
and that read as the obvious meaning of "arrive first, leave when the big animals
come". Ten seeds said no: **stalker survival 9/10 → 6/10**, with their deaths
moving from `age` (53 → 37) to `starvation` (3 → 10) and `dehydration` (2 → 13).

⚠ **And the cause was not the one this section predicted.** §10.1 says "the
vulture is the species at risk, not the stalker". It was the stalker, and not
because it was robbed of carrion — per-capita carrion barely moved (226 → 211).
A diagnostic pass counting turn-aways found **young** stalkers being locked out:
`dominanceOf` halves for immaturity, so a subadult scores below a well-fed adult
corvid, and the demo runs ~80 corvids to ~7 stalkers. Recruitment failed and the
population aged out.

The fix is a `possessionShare` — a bystander picks at the edge for a quarter of
its normal intake — which is both what the numbers wanted and the truer model: a
vulture at an occupied kill gets scraps, not nothing, and the holder still takes
four times what a bystander does. **`share: 0` restores strict exclusion** and is
kept as the measured variant. Full three-arm table in DOCS §9 Carcasses.

### 3.9 The section as written

A carcass has no owner. Multiple carnivores on one body contend only through the
deterministic id ordering in `FeedingSystem`. That is fine for one predator and a
scavenger; it is wrong for the stalker–hyena–vulture triangle, which is one of
the most legible things this roster can produce — and which arrives in **batch 1**.

⚠ **This is a batch-1 prerequisite, not a batch-2 one** (phase 4). Two reasons:
kill theft is the hyena's defining behaviour and the thing that makes it more
than a heavy stalker; and without possession, a 60 kg facultative scavenger beats
the 6 kg vulture to every carcass on nothing but id ordering, which would squeeze
out a species that currently works.

**Proposal, and it is cheap:** a carcass is already an entity that serializes.
Add `possessorId` and a freshness stamp. A carnivore approaching an occupied
carcass evaluates the possessor and either challenges, waits, or leaves —
resolved through **`resolveContest` in `social/dominance.js`**, which already
exists, already reads mass/condition/boldness/maturity, and already has a **fixed
three-draw budget** (⚠ that budget is asserted by tests and must not change; a
contest that sometimes draws four values shifts every downstream stream).

With the group registry in place, possession can be held by a _group_ rather than
an individual, which is what makes a clan displacing a lioness work.

Two consequences worth stating: this gives the vulture a real reason to be small
and fast (arrive first, leave when the big animals come), and it gives the hyena
its defining behaviour.

### 3.10 Sex- and age-structured behaviour

Sexes already exist (`entity.sex`), lineage already exists, and dominance is
already derived. Three roster requirements sit on top of that:

- **Sex-specific territory** (gazelle, rhino, lion): `territory.defends` is a
  species-wide boolean. Widen it to `false | true | 'male' | 'female'` and read
  `entity.sex` in `TerritorySystem`; the roster also wants a _life stage_ and a
  _breeding season_ restriction, since gazelle bucks hold rut territories that
  females and juveniles walk straight through. Cheap, and it finally makes **A35**
  ("territory is a predator-only phenomenon at ~9 individuals") interesting.
  ⚠ **Until it exists, the gazelle keeps `territory.defends: false`** and male
  competition runs entirely through the existing mate contests — which is both
  what `african-species.md` recommends and exactly what the current grazer already
  does. So this blocks nothing in batch 1.
- **Sex-biased natal dispersal** (lion, hyena, zebra): male-biased dispersal is a
  `migration.dispersalTicks` that differs by sex, which the migration system can
  read without new state. Paired with §3.8 it is what makes a pride female-cored.
- **Musth / rut** (elephant, wildebeest): ⚠ tension with "standing is derived,
  never stored". A timed state field is precedented (`alarmedUntil` is exactly
  that shape), so `musthUntil` is defensible — but it should modify the _derived_
  dominance rather than replace it. Elephant-only in its full form, so it rides at
  the very end and may never be built.

### 3.11 ✅ Seasonal reproduction and birth synchrony (shipped 2026-07-30, phase 12)

✅ **Built exactly as proposed — the only section in this document so far whose
prediction needed no correction.** `breedingWindow: { startFraction, endFraction }`
in the `reproduction` block, gated against the `yearProgress` `WeatherSystem`
already publishes, and **birth synchrony did emerge for free**: with a conception
window a quarter of the year wide and a constant gestation, every birth in a
two-year run landed inside that quarter shifted by the gestation, with nothing
anywhere synchronizing them. Asserted in `test/breeding.test.js` on the births
rather than on the matings, because the births are the claim.

Four things the section did not say, none of them a correction:

- ⚠ **The switch could not go in `reproduction`.** That block is per-species, and a
  species block beats the config, so `config.breeding` exists to hold one boolean —
  the standing pattern (§3.4, §3.7) reduced to its point.
- ⚠ **A window may wrap the year**, and that is the normal case rather than an edge
  one: a rut running from late autumn into early spring is `{ 0.9, 0.1 }`. A
  mechanism that could not express it would push every species' season away from the
  boundary for reasons that are purely arithmetic.
- **It gates the chooser only, and that is a stated limit.** Conception is what a
  window is for; gating the seeking sex would stop males competing for females about
  to become receptive, and would change nothing about when calves are born.
- ⚠ **A degenerate window is year-round, not a sterile species.** Equal ends read as
  no window at all. "Breeds on exactly one instant of the year" is a config typo that
  quietly extinguishes a species over ten seeds and looks like an ecological result;
  the identity is the safe failure.

And one thing that fell out: **she enters each window at full choosiness**, because
the search clock already stops while she is not receptive. Nothing was built for it.

⚠ **The section's own warning is the one to carry into phase 13** and it is
unchanged: a species that misses a window loses a year of recruitment, and a
15 000-tick sweep contains only two windows. Start wide.

### 3.11 The section as written

The **wildebeest** is the roster's clearest case: a compressed rut and
synchronized calving. The pieces are all present — `environment.ticksPerYear` is
8000, season is already computed from the tick, and `reproduction` is **already a
species block**. Add a breeding window (`breedingWindow: { startFraction,
endFraction }`) that gates female readiness by position in the year.

**Birth synchrony then needs nothing** — it emerges, because a compressed
conception window plus a roughly constant `gestationTicks` produces a compressed
calving window. Zero new state, and a strong ecological effect (predator swamping)
for one config field.

⚠ Watch the interaction with a knife-edge founding population. A breeding window
that is too narrow means a species that misses one window loses a whole year of
recruitment, and at 8000 ticks/year a 15k-tick sweep contains only two windows.
Start wide and narrow it under measurement.

This moves to **batch 3 with the wildebeest**. The gazelle breeds close enough to
year-round that it does not need it, which is one more reason batch 1 is cheap.

### 3.12 ✅ Cover as a hunting modifier (shipped 2026-07-30, phase 14)

✅ **Built, and this section's central proposal — a graded `concealmentAt` with
`blocksSightAt` as its `>= 1` end — is exactly what shipped.** Its central
*warning* was wrong in the most useful direction: it called this "possibly the most
expensive item in this document per unit of realism", and it cost nothing
measurable. Four deltas, and the first two are the phase's real results:

- ⚠⚠ **Symmetric concealment made the leopard WORSE, and that had to be measured
  rather than reasoned.** The section says cover should raise "*its* detection
  advantage", and the obvious build is symmetric — cover hides whoever stands in
  it, and the asymmetry comes from the two species wanting different ground. Built
  that way: the leopard population fell **27 → 19** over 3 seeds × 4000 ticks. The
  reason is plain afterwards and invisible before: **this mechanism helps whoever
  hides and hurts whoever searches**, and a predator with twice its prey's sight
  radius is overwhelmingly a searcher. It lost more prey sightings to brush than it
  gained ambushes from it. The fix is a per-species **`crypsis`** — a motionless
  rosetted cat is hidden, a herd of wildebeest in the same brush is a herd of
  wildebeest — defaulting to **0**, so the mechanism is the exact identity for the
  seven species that decline it.
- ⚠⚠ **Then it sterilised the leopard, for a completely different reason.** With
  crypsis in, the population *still* sat at 19: mate candidates come through the
  same perception gate, so a cryptic **solitary** species had stopped finding
  mates. Camouflage is against other species; conspecifics know each other's calls
  and scent. One `speciesId` comparison, and the population came back to 26.
  ⚠ The transferable part: **a perception gate is not a predation gate.** Anything
  added there also gates mating, guardianship, and territorial rivalry, and the
  species most affected is the one the change was written for.
- ⚠ **Detection alone was not enough, and the section did not anticipate a second
  half.** Measured, the range discount only paid when the cat *happened* to be
  standing in brush — 9% of its hunt-starts — and the habitat cue did not move that
  (10.9% of its time on cover with the cue on against 10.7% with it off; the
  occupancy turned out to be mostly cover being *slow* rather than chosen). That is
  A34's shape exactly, so A34's lever was applied: **give it a reason.** `stalk`
  now steps through cover where cover lies toward the prey — a heading rule inside
  an action that already existed, like `escapeHeading`, not a new action. Attempts
  launched from concealment went **21 → 34**.
- ✅ **The cost warning was wrong, and why is worth keeping.** The section feared
  "every ray accumulates rather than early-exiting". Nothing accumulates: opacity
  is the *top* of the concealment scale rather than a separate fact, so the raycast
  keeps the boolean array it always read (derived from the scale, so the two cannot
  drift) and the new work is **one cell read per neighbour that already has line of
  sight**, skipped entirely for the seven non-cryptic species. Grading sight cost
  `hasLineOfSight` exactly nothing.

⚠ **What it does not do: cover still does not shelter prey.** Crypsis is 0 for
every herbivore, so **DOCS A18 stays open** — deliberately, because raising prey
crypsis changes every predator's living in the world at once and wants its own
gated phase rather than a ride along with the leopard's.

### 3.12 The section as written

Today cover slows predator and prey equally (A18) and only **rock and thicket**
are opaque. A leopard's whole living is that cover raises _its_ detection
advantage.

`world.blocksSightAt` is explicitly documented as the one place a future
sight-blocker is added — _"smoke, a wall, concealing cover"_. The extension is
that it is currently **boolean**. Proposal: a `concealmentAt(x, y)` returning
0–1, with `blocksSightAt` becoming `concealmentAt >= 1`, and perception
discounting effective detection range by the concealment along the ray.

⚠ **Measure the cost first.** Line of sight already costs about +8% engine time
for the raycasts, and this makes every ray accumulate rather than early-exit on
the first opaque cell. That may be the most expensive item in this document per
unit of realism. Optional even for the leopard — a ground-only, cover-neutral
leopard is still a convincing leopard. **But note it is also what the hidden-fawn
phase wants** (§3.14), so the two share a consumer and should be costed together.

### 3.13 Vertical refuge — trees, climbing, cached kills (deferred)

`african-species.md` is right that a complete leopard needs trees: resting above
lions, caching kills above scavengers, ambushing from height. It proposes an
entity elevation state plus tree entities.

**Deferred, and possibly permanently.** The document itself concedes a
ground-only leopard is convincing. The cost is a new entity kind (A3), a new
elevation dimension threaded through perception, movement, and predation, and a
protocol change. Revisit only after §3.9 ships, at which point "cached out of
reach" is one more possession state rather than a new axis.

### 3.14 ✅ Neonatal concealment — the hidden-fawn phase (shipped 2026-07-29, phase 8)

✅ **Built as three parts, and the section below predicted the shape of all three
correctly.** What it got wrong, and what it could not have known:

- ⚠ **The `hide` half is fully effective; the *concealment* half is not.** The
  section says "cover should reduce detection of a hidden calf", and it does — but
  nothing makes a mother give birth on cover, so only **7.6–11.1%** of hiding
  calf-ticks are actually concealed, tracking the 7.2–9.9% of the map that is
  sheltering ground almost exactly. Concealment is sampled, not chosen. Recorded as
  **DOCS A57**, with birth-site selection as the named lever.
- ✅ **The A34 bet paid off, and this is the phase's real result.** The section
  called a hidden calf "the first genuine reason this world has ever had" and
  said §3.14 was worth building as the honest test of A34. Measured over 3000 ticks
  on three seeds: `tend` fired **1045–1455** adult-ticks against `patrol`'s
  **0–1** — two behaviours of identical shape in the same worlds, separated only
  by whether there was a reason at the far end.
- ⚠ **A32 did not improve, contradicting the section's expectation** that "a
  stationary calf is far easier geometry for an interposing parent".
  `entity.defended` moved 0→0, 1→1, 0→1. Both hoped-for fixes for A32 have now
  failed, which relocates the blame to the "nearer the predator than I am" test.
- ⚠ **The control switch had to be world-level, and the section did not say so.**
  `aging.hiddenUntil: 0` in the config **cannot** switch this off, because a
  species block beats the config — so the off arm silently stayed on. Caught by a
  guard in the measurement script, fixed by `config.parenting.concealment`. Any
  future per-species mechanism needing a reproducible control has this shape.

**Gate:** 10 seeds × 15 000 ticks against the phase-7 baseline on the same seeds.
Survival held or improved for every species — gazelle 10/10 → 10/10, stalker
**7/10 → 9/10**, hyena 9/10 → 10/10, vulture 10/10 → 10/10 — while the means moved
within the noise band the demo is known to have. It ships as a fidelity
improvement that costs nothing, not as a rescue.

### 3.14 The section as written

A gazelle fawn lies hidden for its first days rather than following its mother:
**hidden → periodically nursed → begins following → joins the herd → weans.**
Cover should reduce detection of a hidden calf. Today a juvenile follows its
guardian from birth (`followParent`), so the first stage does not exist.

Most of this is a **suppression** rather than a new mechanism, which is the
cheap half:

- `aging.hiddenUntil` — the `aging` block is already per-species.
- Decision: suppress `followParent` while hidden; the animal stays put.
- Perception: a hidden juvenile standing in cover is not reported as prey —
  reusing `world.isShelteredAt`, or `concealmentAt` if §3.12 has landed.

⚠ **The expensive half is the mother, and it is the same problem as A34.** An
unweaned juvenile eats nothing but what its guardian provisions (DOCS §9
Feeding), and `ParentingSystem` provisions in range. If the calf no longer
follows, the **mother must have a reason to return** — otherwise she forages away
and the hidden calf simply starves. A34 records exactly this shape: patrolling
loses to foraging because it has no reason, and _"the lever, if this is revisited:
give patrol a **reason** — food worth returning to, or a den."_

**A hidden calf is the first genuine reason this world has ever had.** That makes
§3.14 worth building for its own sake and as the honest test of A34, and it is
why it gets its own phase rather than riding along with a species.

⚠ **Do not bundle it with the grazer → gazelle conversion.** A12 (orphan mercy)
exists precisely so that a change to juvenile survival is never made at the same
time as another change to juvenile survival, _"with no way to attribute the
result"_. Ship the gazelle, measure, then add concealment as its own gated change.
It also interacts with **A32** (juvenile defense, near-inert — a stationary calf
is far easier geometry for an interposing parent) and with **A12** itself, since a
hidden calf whose mother dies is exactly the dependency crisis orphan mercy
currently papers over.

### 3.15 ✅ Escape is only about top speed (closed 2026-07-28, phase 4)

✅ **Built exactly as scoped**, which is worth recording because the scoping was
the work: of the five things `african-species.md` asked for, one already existed
(sprint exhaustion), one was a single multiply (agility), two were declined as
un-representable (acceleration, turn radius), and one was deferred (stotting).
The shipped term is `hunting.agility`, resolved off the **prey** — joining
`edibleMassFraction` as the second prey-resolved field in a hunter's block, which
is the easiest thing here to wire backwards and so has its own test. Default 1,
exactly the identity.

### 3.15 The section as written

`captureChance` is `speed ratio × stamina edge × vulnerability × shielding`.
There is no agility term, so a gazelle can only escape by being _faster_, never
by turning better. `african-species.md` asks for turning agility, acceleration,
evasive direction changes, stotting, and sprint exhaustion.

Sort those by what this engine can honestly represent:

- **Sprint exhaustion already exists** — stamina, `sprintMultiplier`, and the
  recovery curve. Nothing to build.
- **Agility is one term**, declared per-species once `hunting` is a species block
  (phase 1). This is the whole of the realistic ask and it costs one multiply in
  a function that already exists.
- **Acceleration and turn radius are not representable** without a physics model
  that movement deliberately does not have — a heading and a step length, with no
  trajectory stored anywhere by design. Do not add one for this.
- **Stotting is deferred.** It is an honest-signal mechanic (the prey advertises
  condition; the predator declines the chase), which needs the predator's decision
  to read a per-prey signal. Genuinely interesting, entirely unnecessary for a
  convincing gazelle.

### 3.16 ✅ Heterospecific association (shipped 2026-07-30, phase 12)

✅ **Built, and the section below was right about the cost, the chokepoint, and
the warning.** "A filter change rather than a traversal change" is exactly what it
turned out to be: one comparison in `SocialSystem`'s existing neighbour loop, no
new walk, no new state, no save or protocol change. Four deltas:

- ⚠⚠ **The weight means one thing, and the first cut gave it two.** The section
  asks for "a weight below conspecific herding", which reads as *both* a smaller
  contribution to the herd centre and a weaker pull toward it. Built that way, and
  it is the phase-9 symmetric-window error again — **it charges the animal twice
  for one fact.** Measured: herding is the weakest utility in the table, so at
  `herdWeight` 0.6 a second discount of 0.5 caps the pull at 0.30 against a
  `wanderBias` of 0.35 and it can *never* win; a follower held station no better
  than one with the mechanism off (16.1 units from the herd either way, 200 ticks),
  and every weight below ~0.58 behaved identically. So the weight is spent inside
  the centroid alone: **how much of a body a member of that species is worth.** The
  cost is that it only bites in *mixed* company — recorded as **A61**.
- ⚠ **It is a weight map, not a list, and not in `social`.** The section proposes
  `social.associatesWith: [speciesId]`. `config.social` is the herd-label section,
  and hanging a second sociality mechanism inside it is the merge phase 3
  specifically refused for the group registry. It ships as an always-per-species
  `association` field keyed by partner species id — the shape `habitat` uses for
  terrain, so a partial declaration is one number — beside a global
  `config.association` holding the switches.
- ✅ **"Keep it out of the label propagation" was the load-bearing warning** and is
  now a test rather than a comment. Labels, `groupmates`, `adults`, and
  `nearestDistance` are all conspecific, and the sharpest reason is one the section
  did not have: `mobbing.minMobbers` counts `adults` off the same summary, so
  counting associates there would let a herd of the wrong species talk an animal
  into turning and facing a predator none of them will help with.
- ⚠ **A second half the section did not propose: an associate's alarm carries.**
  The section names "better vigilance" as the *reason* the association exists and
  then builds only the attraction — but standing beside an animal whose warnings
  you cannot hear buys nothing. It rides the existing wave (same hops, same
  `maxAlarmHops` cap) and has its **own switch**, `association.sharesAlarm`, so the
  two halves can be measured apart. That switch is phase 11's lesson applied in
  advance: two mechanisms shipped together confound each other, and the uncontrolled
  comparison there read backwards while both were working perfectly.

**Predator dilution needed nothing and got nothing**, which is worth recording as a
saving: perception reports the *nearest* eligible prey (A58), so a predator entering
a mixed aggregation takes what is closest and the odds of that being any one species
fall as the mixture grows. No term, no code.

⚠ **Inert, and byte-identically so**: no species declares an association, the
declaring-species map is empty, and the demo's entity state is identical across
seeds 1/2/42 at 1500 ticks to the tree without the mechanism (1.92 MB). The
wildebeest and zebra arrive at phase 13 and are what the weights get tuned against.

### 3.16 The section as written

The `herd` action scores the centre of mass of **same-species** neighbours.
Gazelles associating with wildebeest and zebra — better vigilance, predator
dilution, and access to the short grass the bigger grazers create — is not
expressible.

Cheap: a `social.associatesWith: [speciesId]` list with a weight below
conspecific herding, read where the herd centre is already computed. **No new
neighbour walk** — perception already publishes `world.neighbourhood` with every
species in it, and `SocialSystem` already filters by species, so this is a filter
change rather than a traversal change.

⚠ **Keep it out of the label propagation.** Herd _labels_ must stay conspecific,
or two species merge into one group and every per-species herd metric becomes
meaningless. Association is an attraction, not a membership — the same
distinction §3.8 draws between a label and a record.

Needed only once two or more herbivore species exist, i.e. from batch 2.

---

## 4. ⚠ The mass-range audit — the corvid lesson at 100× scale

> ✅ **Done 2026-07-28 (phase 1).** Every constant below now carries a written
> verdict — `scaled`, `per-species`, or *correctly flat* — in its own config
> comment, so nobody re-derives it. Two came back as live defects and were fixed
> (§5.1, §5.2, now DOCS §1.6 A52/A53). **Three remain deliberately mass-blind**
> and are tracked as DOCS §1.4 B7: `carcass.decayTicks`,
> `hunting.captureStaminaCost`, and `locomotion.maxOccupantsPerCell` — each
> waiting for the species that exposes it. The table below is the input to that
> audit, kept for its reasoning.

**This is the most likely source of bugs in the entire plan, and it deserves its
own pass rather than being discovered one species at a time.** It is scheduled as
phase 1.

Today's world spans 4 kg (corvid) to 45 kg (stalker) — a factor of 11. The
African roster spans roughly:

| Species | Adult mass (kg) | Species     | Adult mass (kg) |
| ------- | --------------: | ----------- | --------------: |
| vulture |               6 | lion        |             180 |
| gazelle |              30 | wildebeest  |             200 |
| hyena   |              60 | zebra       |             300 |
| leopard |              60 | buffalo     |             600 |
| —       |               — | black rhino |            1000 |
| —       |               — | elephant    |            4000 |

That is a factor of **~670**, against a `metabolism.referenceMass` of 30 and a
0.75 allometric exponent applied in exactly two places. DOCS states the rule
already: _"When adding a variant that differs by an order of magnitude in some
dimension, grep for constants that ought to scale with it before blaming the
variant's own parameters."_ This roster differs by nearly three.

⚠ **Batch 1 barely fires this at all, which is the point of the gazelle-plus-hyena
pairing.** The gazelle keeps the grazer's 30 kg, so nothing in the herbivore path
moves, and the hyena at 60 kg is 1.3× the existing stalker. The carnivore-side
constants start to bite at the **180 kg lion** (batch 2, 4× the stalker) and the
herbivore-side ones at the **600 kg buffalo** (batch 2). §5.2 is the exception —
it is already wrong today, at 45 kg.

**Constants to audit.** Each is currently flat, and each needs a written
verdict — `scaled`, `per-species`, or _correctly flat_:

| Constant                              | Current | Why it is suspect                                                     | First bites       |
| ------------------------------------- | ------: | --------------------------------------------------------------------- | ----------------- |
| `carcass.nutrientReturn`              |     0.5 | ⚠ returns to **one cell**, clamped — see §5.2                         | **already live**  |
| `hunting.captureStaminaCost`          |      12 | flat cost against wildly different stamina economics                  | batch 2           |
| `locomotion.sprintStaminaCost`        |     2.5 | ditto                                                                 | batch 2           |
| `injury.healthDamage`, `speedPenalty` | 60, 0.5 | a wound fatal to a gazelle is a scratch on a rhino                    | batch 2           |
| `feeding.intakeRate`                  |     0.6 | ⚠ flat, unlike `fleshIntakeRate` — see §5.1                           | batch 2 (buffalo) |
| `hydration.drinkRate`                 |       5 | flat — a buffalo refills a 100-unit tank as slowly as a vulture       | batch 2           |
| `hydration.drinkRange`                |     1.5 | a 600 kg animal reaching 1.5 cells is arguably fine; state the choice | batch 2           |
| `carcass.decayTicks`                  |    3000 | a 600 kg buffalo rots on the same clock as a 6 kg vulture             | batch 2           |
| `locomotion.maxOccupantsPerCell`      |       2 | 1 cell = 1 world unit; two buffalo in one is already generous         | batch 2           |
| `territory.rangeRadius`               |   14–26 | on a 128×128 map, a megafaunal range should plausibly be most of it   | batch 5           |

Do the whole audit in phase 1 regardless of when each one bites — the point of an
audit done in advance is that nothing later gets mis-blamed for it.

**On `metabolism.referenceMass: 30`.** Keeping the gazelle at the grazer's 30 kg
keeps this honest: the reference animal still exists in the world, as it has since
Step 4. **Leave it at 30 and change nothing.**

⚠ But note the asymmetry it hides: `metabolism` **is** a species block, so
`MetabolismSystem.js:87` reads `params.referenceMass` per-species; `FeedingSystem`
reads its constructor field. A species that overrode `metabolism.referenceMass`
today would change its metabolic cost and not its intake. Adding `feeding` to
`SPECIES_BLOCKS` (phase 1) fixes this by construction — do it in the same pass so
the two stay in step.

---

## 5. Bugs and half-wired fields found while researching

> ✅ **Seven of the eight were fixed in phases 0–1 (2026-07-28).** Only §5.7 is
> still open, and deliberately: it only breaks when `diet` stops being a string,
> so it must move in that same commit (phase 15) or the fix is untestable. Each
> subsection keeps its original text — the finding is the useful part — with its
> status in the heading.

All are live, none is made moot by later work, and all are scheduled in phases
0–1 so nothing later gets mis-blamed for them.

### 5.1 ✅ FIXED — `feeding.intakeRate` was flat, the corvid bug on the herbivore side

`FeedingSystem` mass-scales `fleshIntakeRate` (added in Step 29 _because of_ the
corvid) but the herbivore branch above it still takes a flat `0.6` biomass/tick
regardless of body mass — `FeedingSystem.js:95` against the scaled carnivore path
at line 155. Invisible while every herbivore is ~30 kg; **decisive at the 600 kg
buffalo in batch 2**, and wrong for every grazer above the gazelle.

Fix with the same `#massScale` the carnivore branch already calls. One line, in
**phase 1**, long before any heavy herbivore exists to be blamed for it.

### 5.2 ✅ FIXED — a large carcass silently deleted most of its own nutrients

`CarcassSystem` returns remaining mass to **one cell**, clamped to that cell's
carrying capacity (`vegetation.capacity: 8`).

⚠ **This is already wrong today, before any new species exists.** A 30 kg grazer
yields ~18 edible mass → ~9 biomass into a capacity-8 cell, so about 1 unit is
lost — unnoticeable. But the **45 kg stalker** already yields ~27 → ~13.5, of
which **~60% vanishes**, and that has been true since Step 16. The roster only
makes it worse: hyena ~55% lost, lion ~85%, buffalo far more.

The death→nutrient loop was closed in Step 6, and this quietly reopens it for
every animal above the reference mass. Either spread the return over a radius
proportional to mass, or cap-and-state the loss. Phase 1 work, and the one §5 item
that is a live defect rather than a latent one.

### 5.3 ✅ FIXED — `foodMinLevel` was a species-block field nobody read per-species

`foodMinLevel` lives in `config.perception` — which **is** already a species
block — but neither `PerceptionSystem.js:188` nor `DecisionSystem.js:262` reads it
per-species; both take it from their constructor. Harmless today (every species
uses 1), but it becomes load-bearing at §3.3, since "what counts as food for this
animal" is exactly the grass-maturity question that separates gazelle from
wildebeest from zebra. Two lines, in **phase 1**, alongside the `feeding` block.

### 5.4 ✅ FIXED — `drinkRange` was duplicated in `hydration` and `decision`

The same number in two config sections, which will drift the moment they differ
per species. Fold into one place while §3.1 is touching `decision` anyway.

### 5.5 ✅ FIXED — the species-id source scan was blind to most of the config

`test/species-schema.test.js` strips block comments _before_ line comments
(`stripComments`, line 106), and `defaultSimulationConfig.js` line 178 contains
the literal `config/species/*` inside a `//` comment. The regex reads that `/*` as
opening a block comment and swallows **lines 178–784** — including the entire
`demo.founding` roster. So the invariant this whole plan leans on ("no species id
leaks into the engine") is currently unenforced across the file where species ids
are most likely to spread.

Fix: strip line comments first, then block comments, and exempt the demo roster
_explicitly_ rather than accidentally. Verified: with the order corrected, the
only hits are the three ids in `demo.founding`, which is the intended exemption.
The same two-replace pattern appears in `renderer-boundaries.test.js` and the
engine scan in `engine.test.js` — check both for the same blindness.
**Re-confirmed 2026-07-28: still present.** This is **phase 0**, because every
later phase relies on the guard it is supposed to provide.

### 5.6 ✅ FIXED — two tests asserted "every species differs on every axis", true at N=3 by accident

`test/species-schema.test.js:275` asserts that **all perception radii are
distinct**:

```js
assert.equal(
  new Set(radii).size,
  radii.length,
  `distinct perception radii: ${radii}`,
);
```

That holds at three species because three animals happened to need three radii.
At ten it is an over-constraint with no biological content: a 60 kg leopard and a
60 kg hyena have every reason to see equally far, and so do a gazelle and a
wildebeest. The test fails the first time two species honestly agree.

The same shape sits at line ~237 (`distinct birth masses`, `distinct lifespans`),
though those name the three species explicitly so they will not break — they will
just quietly stop covering the roster.

This is D1 again: _assert invariants that survive biology changes, not population
outcomes._ Rewrite both to assert the **mechanism** — that `perception` resolves
per species, that overriding it changes what an animal senses, and that at least
one species overrides each block — rather than the incidental fact that no two
current species collide. **Phase 0**, alongside the scan fix, because phase 1
starts adding blocks these tests are supposed to be guarding.

### 5.7 ⏳ STILL OPEN — the measurement harness itself reads `diet === 'carnivore'`

`src/scripts/ethologist.js:226` (was :190 when this was written — ⚠ don't trust
the number, grep for the comparison) does
`world.species.get(entity.speciesId)?.diet === 'carnivore'`. Everything else in
that script already buckets by `speciesId` dynamically, so it survives a growing
roster — but §3.2 replaces `diet` with a forage-source structure, and that one
line silently reclassifies every carnivore as a herbivore when it does.

✅ **The newer harness is clean.** `src/scripts/sweep.js` (phase 7) reads no
`diet` at all — it buckets deaths, carrion, and populations by `speciesId` and
counts events — so the §9 gate itself is outside this blast radius. Only the
anomaly finder is inside it.

⚠ **The harness that measures the plan is inside the plan's blast radius.** A
broken ethologist does not fail a test; it reports confidently wrong anomaly
counts, which is exactly the failure mode D19 warns about. Fix it in the same
commit as the `diet` change (phase 15), and grep for other `diet` string
comparisons at that point rather than trusting this list.

### 5.8 ✅ HANDLED — save compatibility is asymmetric (a consequence, not a bug)

Adding a species is save-compatible (a save references `speciesId`; the registry
resolves at load). Renaming or removing one is not — `world.species.get()` returns
`null` and systems degrade to config defaults **silently** rather than failing.

Per §11.3 old saves are not a concern, so no alias map is needed. But "not
worried about old saves" should mean _fails loudly_, not _degrades quietly_: add
a load-time check that every `speciesId` in a save is known to the registry, and
refuse the load otherwise. Cheap, and it converts a silent wrong-physics bug into
an error message.

---

## 6. ✅ One-species-per-role assumptions outside the engine (closed 2026-07-28, phase 5)

✅ **All five rows below are gone**, and the settled decision was implemented as
written. Four things are worth recording because the section did not anticipate
them:

- **A roster and a role alias are different operations**, not two spellings of
  one. `founding` *replaces* the roster — a species left out gets none, because
  "found only the gazelle" has to be expressible — while a role field can only
  *patch* three counts inside the default roster, which is exactly what it did at
  v28. Conflating them would have made the alias path silently destructive.
- ⚠ **Both forms in one command is refused**, not resolved. There is no reading
  of "40 herbivores *and* this roster" that is not a guess.
- **The protocol does not learn the roster**, and that was the right call: it
  validates shape and bounds, and an unknown species id is rejected by the host,
  loudly, naming the id. A species list in `src/protocol` would have been one
  more thing to keep in step.
- ⚠ **The bump nearly shipped broken.** `SUPPORTED_PROTOCOL_VERSION` and all
  three committed fixtures stayed on 28 with the entire suite green, because the
  tests compared the renderer's version against *itself*. Fixture mode would have
  refused every message at runtime. The rule in §12 ("mandatory on every protocol
  bump") was discipline only; it is now a test.

### The section as written

These are all outside `src/simulation`, and each one silently assumes a bijection
between "role" and "species":

| Where                                                                     | Assumption                    |
| ------------------------------------------------------------------------- | ----------------------------- |
| `FOUNDING_ROLE_BY_SPECIES` (createDemoSimulation.js)                      | species → role, 1:1           |
| `simulation.restart { herbivores, predators, scavengers }` (protocol v28) | one count per role            |
| `MAX_FOUNDING_HERBIVORES` / `_PREDATORS` / `_SCAVENGERS`                  | bounds per role               |
| Renderer restart panel (`Controls.js`)                                    | three hardcoded number fields |
| `npm run ethologist -- --herbivores=…`                                    | same three flags              |

**Settled (§11.5): protocol v29.** Restart takes `founding: [{ speciesId, count }]`,
and the host publishes its roster — either a `/api/species` query or a `species`
array on the status report — so the **renderer generates one field per species
from what the host tells it** and never hardcodes a roster again. Keep the three
role fields as accepted aliases for one version so nothing breaks mid-flight.

This is what stops the UI lying. Two ways it lies today, and both get worse with
this roster: the renderer knows the words "herbivore", "predator", "scavenger",
which are engine concepts it was only ever handed by coincidence — and with a
**hyena** in the roster those words stop being _true_, because a hyena is both
predator and scavenger and there is no third box to put it in. Splitting a role's
count across its species host-side would keep v28 and would be exactly the lie
this decision rejects.

⚠ Take the §3.8 group projection in the **same** bump. Two protocol versions in
consecutive phases means two fixture regenerations for no reason.

---

## 7. What does not scale to a ten-species roster

- ✅ **Glyph space (shipped 2026-07-28, phase 6).** One ASCII letter per species,
  with _case already meaning age_ and _italic already meaning sex_. The African
  roster is unusually kind here — most common names give a distinct first letter.
  Assignment as built, colour by trophic family, `priority` in bands — every row
  landed exactly as proposed:

  | Species    | Glyph | Colour token    | Priority | Note                                  |
  | ---------- | :---: | --------------- | -------: | ------------------------------------- |
  | gazelle    |  `g`  | `yellow`        |       50 | inherits the grazer's glyph unchanged |
  | wildebeest |  `w`  | `bright-yellow` |       51 |                                       |
  | zebra      |  `z`  | `foreground`    |       52 | white/black, and it reads             |
  | buffalo    |  `b`  | `orange`        |       53 |                                       |
  | rhino      |  `r`  | `bright-cyan`   |       54 | ⚠ _not_ `comment` — that is cover     |
  | elephant   |  `e`  | `bright-purple` |       55 | ⚠ _not_ `background-lighter` — rock   |
  | leopard    |  `p`  | `bright-red`    |       60 | `l` goes to the lion; p for _panther_ |
  | lion       |  `l`  | `red`           |       62 |                                       |
  | hyena      |  `h`  | `pink`          |       61 | between the two cats, as in life      |
  | vulture    |  `v`  | `purple`        |       45 | keeps the corvid's glyph and rank     |

  ⚠ The gazelle keeping `g`/`yellow` is deliberate: batch 1 should be
  indistinguishable on screen from today's demo except for the lions, which makes
  a visual regression obvious.

  Terrain already owns `cyan` (water), `green` (thicket), `comment` (cover), and
  `background-lighter` (rock), which is why rhino and elephant take `bright-*`
  variants. The legend is generated, so it follows for free; the four legend tests
  already enforce that every registry entry reaches it.

  ⚠ **One thing the table did not anticipate: the entries had to coexist with the
  species they replace.** The registry now holds thirteen entries, and three
  pairs share a letter — `g` (grazer/gazelle), `v` (corvid/vulture) — or name the
  same future animal (`s` stalker / `p` leopard). Rather than leave that as
  folklore, the superseded entry carries **`supersededBy`**, so the pairing is
  data: a test allows a shared glyph *only* between a species and its successor,
  and the rename phase's renderer work is "delete the entry the field points
  from".

- ✅ **The metrics panel (shipped 2026-07-28, phase 6).** It rendered one full
  section per species — trait histograms, herds, disease, home range — which at
  ten species made the sidebar unusable. Built as proposed: per-species
  `<details>`, collapsed by default, with the event feed's remembered-open-set
  pattern. Two additions the proposal did not name:

  - The collapsed summary carries the species' **grid glyph in its grid colour**,
    so the panel and the map are recognizably about the same animals. Collapsed,
    the panel is an overview it never had: a glyph, a name, a living count, and a
    sparkline per species.
  - The v29 `groups` aggregate was **being computed and shown nowhere** — phase 5
    added it to `/api/metrics` and no panel read it. It now appears as a
    world-level row and a per-species one, in both cases *only* where a group
    exists, so it stays invisible until the first clan and needs no renderer edit
    when one is founded.

  ⏳ Still open from the proposal: **measuring the `/api/metrics` payload** at ten
  species to decide whether it needs a server-side species filter. Collapsing
  changed what is *drawn*, not what is *fetched*.

- **`SpeciesRegistry.hunts()`** is a linear `includes` over `preySpeciesIds`, and
  the comment is explicit that this was measured at roster length 0–1 (a `Set`
  was a 35% _loss_ there) and must be re-measured with a longer roster. **This
  roster changes the arithmetic the comment names**: a lion's `preySpeciesIds`
  runs to four or five entries, not one. Re-measure the microbenchmark, not the
  whole simulation (whole-sim timings already failed to resolve this once, D24).
  Not urgent in batch 1 (one prey species); due by batch 3.

- ⚠ **`social.maxGroupSize: 12` is a hard cap on a herd label.** No herd, of any
  species, can exceed twelve animals — the propagation loop refuses a label whose
  current size is at the cap (`SocialSystem.js:179`). That is invisible at 120
  gazelle founders spread over a 128² map, and it is a **ceiling on the thing the
  roster is about**: wildebeest and buffalo aggregations are supposed to be the
  large, loose end of the sociality axis, and they cannot be. Decide before batch
  2 whether this becomes per-species (it belongs in `config.behavior`, §3.1) or
  stays a global sanity bound with the limitation recorded. It is _not_ a
  constraint on the group registry (§3.8), which is a separate store — one more
  reason to keep the two mechanisms clearly named apart.

- ✅ **The metrics panel's trend sparklines were quadratic in species count
  (fixed 2026-07-28, phase 6).** `MetricsPanel.js:75` did
  `history.map((sample) => sample.species.find(…))` _inside_ a per-species,
  per-trait loop, so the cost was `historyLength × species² × traits` — with
  `metrics.historyLength: 120` that is ~7.5k comparisons at three species and
  ~84k at ten, on **every metrics render**. Fixed as described: `indexHistory`
  buckets the history by `speciesId` once per render. It rode with the
  collapsible-sections work rather than being discovered as jank, which was the
  point. ⚠ The equivalence is asserted, not assumed — the old form produced an
  `undefined` slot for a sample that did not mention a species and the new one
  omits it, and a test proves the sparkline is identical either way.

- ✅ **The rename in phase 7 touched 48 files** (predicted 42). Measured
  2026-07-28: the species ids appear in ~30 test files,
  `src/scripts/benchmark.js`, the demo config, the appearance registry, both
  renderer docs, and three committed fixture JSONs. The fixtures regenerate
  (`npm run fixtures:renderer`) and the rest is mechanical — but ⚠ **"mechanical"
  turned out to be the trap, in two ways a find-and-replace cannot see:**

  - The renderer's **superseded appearance entries had to be *deleted*, not
    renamed.** Substituting the ids turned each into a duplicate key of its own
    successor in one object literal, where the later silently wins. Phase 6 had
    added `supersededBy` precisely so the answer was "delete this"; the pass did
    not know that. **Treat the `supersededBy` entries as a delete list.**
  - **The dotted id is not the only form of the id.** `#ctl-founding-herbivore-grazer`
    in `tests-ui/` is the species id with dots turned to hyphens, and it survived
    the pass. `npm test` stayed green; Playwright caught it (D32).
  - It also rewrote two docstrings that meant to name the *old* id, producing
    "Was `herbivore.gazelle` until…". Caught by reading, not by a test.

  Still worth doing as its own commit so the real change (the hyena) is reviewable
  on its own.

- **Founding balance.** D14 says five seeds cannot resolve a one-seed difference
  in the founding counts. With ten species the interaction surface is far larger;
  ten seeds is the floor for any claim.

- **Crowding.** `locomotion.maxOccupantsPerCell: 2` — more species sharing the
  same good ground means more contention, and the cap is currently on. See §4.

- **Lifespan compression (settled, §11.6).** The demo's clock is compressed:
  `ticksPerYear: 8000` against a grazer `maxAge: 12000`, and the measurement gate
  runs 15 000 ticks. A biologically faithful life-history ordering would put an
  elephant at several times the gazelle's lifespan, at which point 15k ticks
  contains no elephant generation at all and the gate measures nothing. **Decision:
  compress megafauna lifespans harder than reality** so every species stays
  measurable in a 15k-tick sweep, and record the distortion explicitly in DOCS §5
  beside the existing note that the year and lifespan are already compressed. Keep
  the _ordering_ real (elephant > rhino > buffalo > zebra > wildebeest > gazelle);
  give up the _ratios_.

  ⚠ The elephant additionally has **no predator in this roster**, so nothing but
  forage and lifespan limits it — on a 128×128 map that is a carrying-capacity
  risk, and one more reason it is last.

---

## 8. Phases

### ⚠ Two prerequisites that sit outside this plan

Both were found in the final review (2026-07-28) and both are **sequencing**
problems rather than technical ones. Neither is species work; both invalidate
species measurements if they land afterwards.

> **Decided 2026-07-28: the `NOTES.md` Tier-1 items are skipped for now**, with
> the consequence understood and accepted — species gates taken before they land
> will need re-running afterwards. Recorded so a future session treats the
> re-measure as budgeted rather than as a surprise, and does not re-open the
> question as though it were an oversight.
>
> ⚠ **The bill is now four sweeps, not one** (2026-07-29): the phase-1/2 energy
> sweep, phase 4's possession sweep, phase 7's batch-1 gate, and phase 8's
> concealment measurement all pre-date those Tier-1 items and would all need
> re-running. It is still the right call — `npm run sweep` (built at phase 7) makes
> a re-run one command per arm, which it was not when the debt was taken on — but
> the number grows by one per gated phase, so the longer this waits the more it
> costs. **Item 2 (the stale benchmark
> baseline) was done** — see below.

**1. `NOTES.md` has unaddressed Tier-1 items that change the world this plan
measures in.** Verbatim, under _Tier 1 — Sim_:

> - animals still tend to congregate around the edges of the map and especially
>   corners. fix this. a fix that uses RNG is acceptible if it is more robust
>   and/or more performant
> - floods/storms/droughts should cover MUCH larger areas of the map

`HANDOFF.md`'s entire "Recommended next step" is the first of these, with two
candidate approaches already scoped (flee-toward-interior; predator break-off)
and a third for the corners (a convex island shape). The second changes the
disturbance duty cycle, which DOCS D18 records as having been hard to tune once
already.

Either one moves **where animals are** and **how often they die**, which is the
definition of a change requiring a fresh multi-seed sweep (DOCS §15). Running
them after batch 1 means re-gating every species shipped to that point. ⚠ **Decide
before phase 0**: do them first, or accept that the species gates get re-run.
There is no third option where the numbers stay valid.

**2. The performance baseline this plan re-baselines against is stale.**
`BENCHMARK.md`'s large-5k figure (67.25 ms/tick) predates line of sight (+8%
measured), the thicket movement rule, the water bearing field, and the per-cell
crowding cap — `HANDOFF.md` says so explicitly: _"`BENCHMARK.md`'s large-5k
figures predate all of this session's changes and were not re-measured."_ Every
"re-baseline, ≤1% is noise" instruction in §3.1, §9, and §7 is therefore measured
against a number that no longer describes the engine. **Run `npm run benchmark`
once at phase 0** and record the new figure with its date, per the reading
convention. This is ten minutes and it makes every later performance claim
meaningful.

> ✅ **Done, and it turned out to matter more than expected.** A single
> re-baseline is not enough: machine conditions drift across a long session, and
> the same unmodified HEAD measured **68.70, 69.18, 70.64, and 72.09 ms/tick** at
> different points on 2026-07-28. A one-off "before" number would have made
> phase 2's real 12% regression (D28) look like anything from 5% to 15%, or
> hidden it entirely.
>
> ⚠ **So the working rule is: measure HEAD and the change back-to-back, in the
> same session, several times each.** `git stash push -u` → benchmark → `git
> stash pop` is the cheap way to do it, and it is what finally separated signal
> from drift. Take the *distributions*: HEAD 69.2–72.1 against a tree at 78.2–79.4
> do not overlap, which is a result; two single readings a few percent apart are
> not.
>
> ⚠ **Refined at phases 7–8, and the refinement is what to copy.** `git stash`
> stops working once several phases are uncommitted — it reverts to HEAD, not to
> the previous phase. Both arms were instead run **in one process**, alternating
> A/B/A/B/A/B, which removes drift entirely and needs no git at all (see
> `BENCHMARK.md`). And read the **ordering across rounds**, not the means: the
> hyena was slower in all three rounds (a real +1.6%/animal), while the hidden-fawn
> stage won two rounds and lost one (no effect) — even though in both cases the
> within-arm spread was larger than the gap.

---

Each phase leaves the suite green and the demo runnable, in this repo's usual
shape. Phases 0–6 are groundwork with no new species at all; species land from
phase 7 onward, **one or two at a time** (§11.1), each behind the §9 gate.

**⚠ Fourteen of eighteen phases have shipped, the world has eight species, and the
remaining three are deferred (2026-07-30).** The
table is a *chart*, not a record: a done row states what landed, when, and the one
thing worth carrying out of it. The reasoning, the measurements, and every place a
phase's own prediction turned out wrong live in that phase's **"As built"** block
in the section it links to — read those before repeating any of this work.

| Phase | What | Status | Landed with / risk |
| ----- | ---- | ------ | ------------------ |
| **0** | Guard rails: comment-stripping in all three source scans (§5.5); the two "every species differs" assertions rewritten (§5.6); benchmark re-baselined | ✅ **2026-07-28** | test-only. ⚠ Fixing the scanner immediately caught a live violation it had been hiding |
| **1** | Mass-scaled `intakeRate` (§5.1); carcass nutrient spread (§5.2); per-species `foodMinLevel` (§5.3); `drinkRange` dedupe (§5.4); load-time speciesId check (§5.8); the §4 mass audit, with a written verdict per constant | ✅ **2026-07-28** | `feeding` + `hunting` became species blocks. ⚠ §5.7 deliberately **not** fixed — it only breaks when `diet` does (phase 15) |
| **2** | `config.decision` split into `config.behavior` (22 fields, a species block) and `config.decision` (14, global) — §3.1 | ✅ **2026-07-28** | ⚠⚠ Cost a **12% hot-path regression** and its fix: `#perceive` is arity-sensitive (D28) |
| **3** | Persistent group registry: `GroupRegistry`, `GroupSystem`, `groupRecordId` — §3.8 | ✅ **2026-07-28** | `SAVE_FORMAT_VERSION` 27 → **28**. Shipped **inert** and byte-identical; DOCS §9 Sociality rewritten to record the decision it overrode |
| **4** | `predation` mass gating in perception both ways (§3.6); the `agility` divide (§3.15); `riskyMassRatio`; **carcass possession and theft** (§3.9) | ✅ **2026-07-28** | `SAVE_FORMAT_VERSION` 28 → **29**. ⚠ The first three are *exactly* inert, so possession was the single attributable change and the only one swept |
| **5** | Protocol **v29** (§6): a founding roster by species, the host publishing its roster, renderer fields generated from it — plus the whole A54 projection debt from phases 3–4 | ✅ **2026-07-28** | `PROTOCOL_VERSION` 28 → **29**. ⚠ The bump left the renderer and all three fixtures on 28 **with the suite green**; now guarded (D31) |
| **6** | Renderer scale (§7): the full ten-species glyph/colour/priority scheme, collapsible per-species metrics, the quadratic sparkline fixed | ✅ **2026-07-28** | Renderer only. `supersededBy` makes a shared glyph a stated transition; ⚠ it is a **delete list**, which phase 7's rename pass did not know |
| **7** | **Batch 1 — gazelle + hyena** (§10.1). Two renames proved byte-identical, vulture 4 → 6 kg as its own arm, then the hyena behind the ten-seed gate | ✅ **2026-07-29** | **`npm run sweep`** (the §9 gate harness) built here. Closed **A55**, opened **A56**. ⚠ The gate **failed first**: a carrion-subsidised predator is not limited by its prey |
| **8** | **Hidden-fawn stage** (§3.14): `aging.hiddenUntil`, the `hide` and `tend` actions, concealment in perception | ✅ **2026-07-29** | Benchmark flat. ✅ **A34's lever proved** (`tend` 1000×, `patrol` 0×); ⚠ **A32 did not improve**; opened **A57** |
| **9** | Forage guilds (§3.3): grass-maturity preference; `habitat` weights, closing A49's habitat half (§3.4) | ✅ **2026-07-29** | Decision / Migration. ⚠⚠ **Two gates failed first**: `biomass / capacity` as the axis, then a symmetric window. What shipped is **absolute standing crop** with a one-sided falloff, and a cue whose *direction* is scored but whose *strength* is not. `npm run sweep --set=` added so a config A/B is one command |
| **10** | Batch-2 prerequisites: `attackersFor` cooperative hunting (§3.7); mobbing (A33) + the A32 geometry fix | ✅ **2026-07-30** | Decision / Hunting. ⚠ **No new action**: mobbing turned out to be the unimplemented groupmate half of `defend`. Both mechanisms ship **inert and byte-identical**; ⚠⚠ **the A32 fix failed** — removing the clause entirely moves nothing, and the measured blocker is that only 6–9% of hunts commit to a juvenile at all. Opened **A59** |
| **11** | **Batch 2 — lion + buffalo.** Cooperative hunting built and demonstrated together; first mobbing | ✅ **2026-07-30** | config + one correction to phase 10. ⚠⚠ **The gate failed first, exactly as predicted** — a carrion-subsidised pride ate the buffalo out (5/10 seeds) until `minHungerToHunt` went 0.3 → 0.45. ⚠ Every other difficulty was **density**: both mechanisms count neighbours, so `herdDistance` is a parameter of both. Closed **A33**, narrowed **A59**, opened **A60** (territory is an individual claim, so a pride cannot hold ground) |
| **12** | Batch-3 prerequisites: heterospecific association (§3.16); seasonal breeding windows (§3.11) | ✅ **2026-07-30** | Social / Reproduction. Both ship **inert and byte-identical**, and the risk estimate ("low") held. ⚠ The one thing measured wrong first was scaling the herd *pull* by the association weight as well as the centroid — the phase-9 double-count again, and it made every weight below ~0.58 inert. Opened **A61**. ⚠ Association grew a half the plan did not propose (an associate's alarm carries) because the plan's own reason for the mechanism was *vigilance* |
| **13** | **Batch 3 — wildebeest + zebra.** The three-tier grazing succession, and the first declaring species for both of phase 12's mechanisms | ✅ **2026-07-30** | config only — **no engine change at all**, which is the claim §1 has made since Step 29 and this is the cleanest proof of it. ⚠ **Passed its gate first time**, the only batch that has. ⚠⚠ A 0.30-of-the-year rut cost the wildebeest 2 seeds in 3 before a config A/B relocated the cause to §11.6's lifespan compression; ⚠ the gazelle re-tune this row scheduled turned out **not to be needed**, and `maxGroupSize` turned out not to be a tuning question |
| **14** | **Batch 4 — leopard.** Rename `predator.stalker` → `predator.leopard`, mass 45 → 60, **and ambush concealment (§3.12)**, which was optional and was taken | ✅ **2026-07-30** | config + perception + terrain. ⚠ The rename was proved **byte-identical** first (2.36 MB × 3 seeds), so the biology is separately attributable. ⚠⚠ The mechanism was **built wrong twice and both failures read as "no effect"**: symmetric concealment made the leopard worse (27 → 19), then hiding from conspecifics sterilised it (19). Opened **A63**; the last `supersededBy` entry is deleted here |
| **15** | A51 shrub layer as browse (§3.3); forage-source list replacing the `diet` string (§3.2); sex-specific territory (§3.10) | ⏸ **deferred 2026-07-30** | high — large. §5.7 must move in the same commit. ⚠ A51 is now also the answer to "the ambush is bounded by how little cover exists" (§3.12) |
| **16** | **Batch 5 — black rhino.** | ⏸ **deferred 2026-07-30** | high — config only, but gated on A51's browse: without a woody layer a rhino is a heavy wildebeest |
| **17** | **Batch 6 — elephant** (§11.1: _may never happen_). Needs everything above plus musth and woody-floor damage | ⏸ **deferred 2026-07-30** | high — large. Phase 14 did not change the case against it |

**Ordering rationale** — ✅ marks a decision the shipped phases have now tested.

- ✅ Phases 0–2 came first because everything downstream is measured, and §5's
  bugs would have corrupted those measurements. §5.2 was _already a live defect at
  45 kg_ — fixing it afterwards would have meant a new species getting blamed for
  it, which is precisely how the corvid cost 3/10 seeds. **Vindicated at phase 7**,
  where the hyena's gate failure had to be diagnosed against a clean baseline and
  was.
- ✅ **Phases 3 and 4 moved up sharply.** In the first draft the group registry was
  optional depth at the very end. Putting a clan-forming carnivore in batch 1 made
  it a prerequisite — and, unlike the earlier lion-first ordering, batch 1 _proved_
  it: 41 kill thefts in 4000 demo ticks, with clans founding, spanning separate
  herd labels, and dissolving.
- ✅ **Carcass possession in phase 4, cooperative hunting in phase 10.** They
  swapped when the hyena moved to batch 1, and the swap paid: possession is what
  kept the vulture alive at 10/10 seeds beside a 60 kg competitor.
- ✅ **Phase 5 before phase 7 so a new species is spawnable without a renderer
  edit** — and phase 6 extended the same idea to glyphs. Measured outcome: the
  hyena needed **no renderer change at all**.
- ✅ **Phase 8 deliberately separate from phase 7.** Both change juvenile survival,
  and A12 exists so two such changes are never made together (§3.14). Worth the
  extra phase: batch 1's numbers stayed attributable to the hyena, and phase 8's
  own A34/A32 results stayed attributable to concealment.
- ✅ **Phase 9 (forage guilds) sat before batch 2 even though the buffalo does not
  strictly need it**, on the argument that a 600 kg buffalo and a 30 kg gazelle
  would otherwise compete for identical cells, separated only by mass-scaled intake
  and the buffalo's water tie. The ordering was right and the "cheap enough" half was
  **wrong**: the mechanism cost two failed ten-seed gates and two redesigns before it
  passed. Better it happened here, with one herbivore to attribute it to, than in the
  batch where a 600 kg one arrives — which is the argument for the ordering, restated
  by what it cost.
- Each batch is gated on a mechanic, not on appetite. Batch 2 needs mobbing and
  carcass possession; batch 3 needs forage guilds; batch 5 needs browse. A species
  shipped before its mechanic is a palette swap that gets re-tuned twice.
- **A reasonable stopping point is after phase 13** — eight species (gazelle,
  wildebeest, zebra, buffalo, hyena, lion, vulture, plus the still-generic
  stalker) with clans, prides, cooperative hunting, contested carcasses, mobbing,
  and a three-tier grazing succession. Everything past that is refinement.
  ⚠ Four of those eight already exist, so the stopping point is **five phases
  away**, not thirteen.

---

## 9. The measurement gate

No species ships without this, because the demo is a knife edge and the last
species added cost 3/10 seeds until the real bug surfaced.

- ✅ **Harness: `npm run sweep`, built 2026-07-29** (`src/scripts/sweep.js`).
  Reports, per seed and in aggregate: population by species at each checkpoint,
  deaths by cause **by species**, extinction ticks, carrion feeds and mass by
  species, and persistent-group founding/dissolution. ⚠ Its `--control=` runs a
  second founding roster **over the same seeds in the same process**, which is
  the A/B the gate is actually stated in — and, unlike the benchmark, a sweep is
  deterministic, so the two arms are exactly comparable and need no interleaving
  against machine drift. ✅ **Phase 9 added `--set=` / `--controlSet=`**, so a config
  change is one command too; the line this bullet used to end with ("a config change
  still needs two runs; only a roster change can be done in one") was true only
  because nobody had written the flag.
- **Procedure per species:** add the definition with `count: 0` → confirm zero
  diff → raise the count → sweep **10 seeds × 15 000 ticks** against the
  pre-species control.
- **Gate:** every species alive at 15k on ≥6/10 seeds, the control's survival not
  materially worse, `npm run benchmark` re-baselined (⚠ **not** against the ~67
  ms/tick this line used to name — the roster changed at phase 7, so large-5k is
  75.7 and nothing earlier is comparable), and `hunts()` re-measured once rosters
  get long (§7).
- ✅ **Phase 7 split into a no-op half and a real half, measured separately, and
  both halves came out as this bullet demanded.** The grazer → gazelle conversion
  was provable as **literally byte-identical** — 6.28 MB across three seeds modulo
  the two id strings. ⚠ Two corrections to the original wording: the real change is
  the **hyena**, not the lion (they swapped batches in §0 and this bullet was never
  updated), and there turned out to be a **third** half — the vulture's 4 → 6 kg,
  which is neither a rename nor the new species and so took an arm of its own.
- ✅ **What batch 1 had to demonstrate was the group registry, and it does:** clans
  form, persist through separation (a clan spanning two herd labels), hold and lose
  carcasses (41 thefts in 4000 ticks), and dissolve. ⚠ Asserted **directly** in
  `test/groups.test.js` against the demo world rather than inferred from
  populations — a registry that quietly never founded a second clan would still
  pass a survival gate. ⚠ The one thing this bullet did not anticipate: dissolution
  is *seed-dependent* in the demo and on some seeds becomes flapping (A56).
- ⚠ **Batch 1 cannot demonstrate cooperative _hunting_, and does not try to.** A
  hyena takes a 30 kg gazelle solo, as a real one does, so `attackersFor` is not
  built until phase 10 and not proved until the 600 kg buffalo arrives in batch 2.
  Do **not** tune `hunting.cooperationWeight` against gazelle — that would fit a
  parameter to a case it was not built for.
- ⚠ **"Watch the vulture in batch 1" was right to ask and wrong about the
  answer.** The reasoning stands — a 60 kg facultative scavenger entering a world
  with a 6 kg obligate one is the tightest interaction in the batch, and carcass
  possession (§3.9) is what gives the vulture its "arrive first, leave when the big
  animals come" niche. Measured: the vulture survived **10/10** seeds at a mean of
  116.3 against the control's 201.3, still taking 50.6% of all carrion — squeezed
  but not displaced, so possession did its job. ⚠ **The species that actually paid
  was the stalker**, 10/10 → 7/10, because the hyena competes with it for the same
  prey while not depending on that prey. Watch the stalker in batch 2.
- **Before blaming the new species' own numbers**, grep for constants that ought
  to scale with whatever dimension it differs in by an order of magnitude. §4 and
  §5 are that grep, done in advance.
- ✅ **Batch 3 passed first time (2026-07-30), and how is the transferable part.**
  §11.1 says "budget a failed gate per net-new species" and that had held for every
  batch. What changed is not the species but the order of measurement: a **3-seed
  exploratory sweep** (~3 minutes) found the wildebeest failing, a **one-command
  config A/B** (`--set=breeding.enabled=false`) located the cause in a single run,
  and a four-arm width sweep settled the number — all before the ten-seed gate was
  started. ⚠ The ten-seed gate is a *verdict*, not an instrument: it costs twenty
  minutes and tells you a species failed, not why.

---

## 10. The roster

### 10.1 Batch 1 (phase 7) — gazelle, hyena

#### ✅ As built (2026-07-29) — and the one thing nobody predicted

The rename half went exactly as §9 demanded: **byte-identical**, 6.28 MB of
serialized state across three seeds at 1500 ticks matching modulo the two id
strings. The vulture's 4 → 6 kg then went as its own arm (all four species 10/10
seeds; the stalker actually improved 9/10 → 10/10, and the gazelle fell ~30 —
fewer, larger vultures leave more carrion, which feeds more stalkers, which kill
more gazelle: a three-step chain the sweep makes visible and nobody would have
guessed).

⚠ **The hyena failed its first gate outright, and the reason is the most
transferable thing in this phase.** At `minHungerToHunt: 0.35` — a stalker-ish
value — **the gazelle went extinct in 7 of 10 seeds** against a control where it
never went extinct at all, and the vulture halved beside it.

The cause was not that the hyena hunts too well. It is that **a facultative
scavenger is not limited by the prey it hunts.** Carrion supplied 37% of
everything the world's scavengers took, the hyena population more than doubled on
that subsidy, and the subsidised population then hunted. A predator whose numbers
do not depend on its prey can eat that prey to extinction without ever going
hungry — apparent competition, and a genuinely correct thing for this model to
have produced.

⚠ **Lowering the founding count does not fix it, and was tried.** The population
recovers to whatever carrion supports regardless of how many are founded; the
count changes the ramp, not the ceiling. What fixed it was coupling the hunting
back to the hunger: `minHungerToHunt: 0.75`, i.e. *it hunts only when scavenging
has failed to feed it*. Also corrected: the first draft bred **faster** than the
45 kg stalker, which is backwards for a 60 kg carnivore and was the other half of
the collapse.

**Carry this into batch 2.** The lion is the same shape of animal — a large
carnivore that also scavenges — and the buffalo it is meant to eat breeds far
more slowly than a gazelle. Expect the same failure mode and check
`minHungerToHunt` *first*.

**The passing world (10 seeds × 15 000 ticks, 2026-07-29), stated with its
costs** — because the gate's second half is a judgement and the honest answer is
that this species is not free:

| Species  | With hyena | Hyena-free control | Read as                                            |
| -------- | ---------- | ------------------ | -------------------------------------------------- |
| gazelle  | **10/10**, mean 95.6 | 10/10, mean 152.1 | suppressed to ~⅔, never extinct — the intended effect of a second predator guild |
| stalker  | **7/10**, mean 5.1   | 10/10, mean 7.9   | ⚠ **the real cost: three seeds in ten lose the stalker** |
| vulture  | **10/10**, mean 116.3 | 10/10, mean 201.3 | ⚠ −42%; §9 warned that a surviving-but-halved vulture is a result, not a pass |
| hyena    | **9/10**, mean 3.9   | —                 | establishes, but thinly — a marginal population    |

Every species clears the ≥6/10 bar, so the batch ships; but two of the three
incumbents are materially reduced and that is recorded rather than rounded off.
⚠ **The stalker is the species to watch in batch 2**, not the vulture the plan
expected: possession works and the vulture keeps a living (50.6% of all carrion
taken, up from 73.7% only because there is now a third claimant), while the
stalker is squeezed by a competitor for the same prey that does not depend on it.


**`herbivore.grazer` → `herbivore.gazelle`.** A rename, a rewritten docstring,
and an appearance label. **Keep `bodyMass: 30`** — that sits between a Thomson's
and a Grant's gazelle, it is biologically honest, it keeps
`metabolism.referenceMass: 30` meaningful, and it makes this half of the phase
provable as a no-op (§9).

Everything the gazelle needs is already there and already tuned: loose herds that
form and split, alarm propagation, `migration.tracksForage`/`tracksWater`,
`territory.defends: false`, mother–calf attachment, fast juvenile development,
heavy predation pressure, and `matePreference` on **size** with condition
weighting — which is exactly the "size, condition, and display traits" the model
calls for, and which the metrics depend on because size costs speed.

Deliberately **not** in this phase, each with a reason:

| Gazelle feature            | Where it goes | Why not now                                                                                                                               |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| short-grass preference     | phase 9       | it is the only herbivore in batch 1; there is nothing to prefer _against_                                                                 |
| hidden-fawn phase          | phase 8       | A12 — never two juvenile-survival changes at once (§3.14)                                                                                 |
| male-only rut territory    | phase 15      | `african-species.md`'s own advice: leave territory off and let mate contests carry male competition until sex-restricted territory exists |
| agility in escape          | phase 4       | rides with the `hunting` species block and `predation` gating                                                                             |
| heterospecific association | phase 12      | needs a second herbivore species to associate with                                                                                        |
| stotting                   | —             | deferred indefinitely (§3.15)                                                                                                             |

**`predator.stalker` stays generic.** Checked against the rule in §11.1: the
stalker is explicitly **solitary** — `territory.defends: true`, and its own file
says _"a solitary ambush predator holds ground"_ and _"solitary and slow to breed,
as a top predator at low density must be."_ So it is not convertible to a lion. It
stays as-is and becomes the **leopard** in batch 4, which is what its biology
already describes. Keeping it also means batch 1 still has a predator whose
behaviour is a known quantity, which makes the hyena's effect attributable — and
it is the animal the hyena steals _from_, which is what makes kill theft
observable at all in batch 1.

**`scavenger.hyena` is net-new** — 60 kg, clan-forming, hunts gazelle solo and
**steals kills**. It is the first consumer of the group registry (§3.8), carcass
possession (§3.9), per-species `herdWeight` (§3.1), and `predation` ratios
(§3.6), all of which are phase 3–4 prerequisites.

Its basic form costs nothing new: a _facultative_ scavenger is simply a carnivore
with a non-empty `preySpeciesIds`, exactly as the stalker is (§3.2). What the
phases buy is the clan and the theft.

Three things make it the right first carnivore, and one is a real risk:

- **Prey match.** 60 kg on a 30 kg gazelle is a mass ratio of 0.5 — an ordinary
  pairing, and gazelle is staple solo hyena prey. It needs no cooperative capture
  to make a living, which is why phase 10 can wait.
- **It proves the registry inside its own batch.** Clan-held carcass possession
  exercises membership, group identity across separation, and dissolution — with
  a 30 kg prey animal and nothing larger. That is the whole reason it displaced
  the lion (§0).
- **It differs from the stalker on three representable axes**, so §2 does not
  bite: it scavenges (a second food channel the stalker lacks), it is social
  (`herdWeight`, phase 2), and it is not territorial. Two mid-size carnivores on
  one prey species would otherwise be exactly the competitive-exclusion case this
  document is built around.
- ⚠ **The vulture is the species at risk**, not the stalker. A 60 kg facultative
  scavenger and a 6 kg obligate one contend for the same carcasses, and without
  §3.9 the hyena wins every one of them on id ordering alone. This is the batch's
  main measurement risk and §9 calls for reporting it explicitly.

The **lion moves to batch 2**, where the 600 kg buffalo gives a pride something
to be a pride _for_.

**`scavenger.corvid` → `scavenger.vulture`** rides along: a straight rename,
4 → 6 kg, biology otherwise unchanged. The obligate-scavenger niche (empty
`preySpeciesIds` — the entire corvid mechanism) is preserved exactly. ⚠ **The
hyena does not replace it**; a hyena hunts _and_ scavenges, which is a different
niche the engine expresses differently.

### 10.2 ✅ Batch 2 (shipped 2026-07-30, phase 11) — lion, buffalo

#### ✅ As built — and the four things that had to be measured rather than reasoned

The pairing was right and the section below stands: cooperative hunting was built
at phase 10 and **demonstrated here**, against the one animal in the roster that
justifies it. What the section did not predict is that *every one* of the phase's
difficulties was about **density and scale**, not about the mechanisms:

- ⚠⚠ **A lion that also hunts gazelle never hunts buffalo.** The first draft listed
  both, which reads as obviously correct — a lion takes what it finds. Perception
  reports the **nearest eligible** prey (A58) and the demo runs six gazelle to
  every buffalo, so the pride spent its life on gazelle: **2 buffalo attempts in
  4000 ticks, 0 cooperative hunts, 0 mob-ticks.** Batch 2 with neither mechanism
  firing. `preySpeciesIds: ['herbivore.buffalo']` is the fix, and it is exactly
  what §3.6 says `minPreyMassRatio` is *for* — "what stops a large predator
  bothering with something it cannot profit from" — reached by the species
  relation rather than by a ratio because the ratio would have been a boundary
  that never fires.
- ⚠⚠ **Both mechanisms are density mechanisms, and neither says so in its name.**
  Cooperation counts hunters committed to *one quarry* within 6 units; mobbing
  counts adults within 6 units of the animal under attack. A pride whose members
  forage four units apart is a pride on paper: **0 shared-quarry ticks in 8 000**.
  A herd thin enough to graze alone cannot defend itself however well the
  mechanism resolves. `herdDistance` — 2.0 for both species — is what turned a
  shared record into a shared hunt, and the founding counts had to be raised until
  the herds were herds. **Treat `behavior.herdDistance` as a parameter of any
  mechanism that counts neighbours.**
- ⚠⚠ **A pride cannot hold territory, because territory is an individual claim.**
  `TerritorySystem` marks by entity id and `retreat` moves an animal off ground
  *anyone else* marked, pride-mate included — so `territory.defends: true` made
  the pride scatter itself. Recorded as **DOCS A60**, and it sharpens A35:
  territory is not predator-only, it is *solitary*-only.
- ⚠⚠ **600 kg broke a species number before it broke any global constant**, which
  is the opposite of what §4 spent its length preparing for. Every energy cost is
  multiplied by `(bodyMass/30)^0.75`, while the roster's `maxEnergy` values fit
  ~mass^0.34 — a trend nobody had to defend inside one order of magnitude. At
  600 kg it means starving 3.4× faster than a gazelle, and the first measured
  buffalo died mostly of **exposure**. Two fixes, both species data: size the tank
  on mass^0.75 (time-to-starve becomes mass-independent), and **widen the comfort
  band as mass rises** — bulk is what buys cold tolerance, and the first draft had
  the largest animal in the world with a *narrower* band than a 45 kg stalker.

**And phase 7's failure mode arrived exactly where §8's table said it would.** The
first ten-seed gate **failed**: buffalo alive on 5/10 seeds, with 317 of 501 deaths
from predation, while the lion population *grew* on 37.6% of all carrion taken in
the world. A predator subsidised by carrion is not limited by its prey, so it eats
it out — the hyena's lesson, and the reason §8 said "check `minHungerToHunt`
first". ⚠ The tension this time is sharper than in batch 1, and worth stating: the
same number that keeps the buffalo alive is the one that stops the pride hunting
often enough to *demonstrate* cooperation. 0.3 fires the mechanism and loses the
buffalo; 0.6 saves the buffalo and fires nothing; **0.45 does both**, which is a
narrower window than any parameter in batch 1.

**The passing world** (10 seeds × 15 000 ticks against the batch-1 roster, on the
same seeds and in one process):

| Species | batch 2 | batch-1 control | read as |
| --- | --- | --- | --- |
| gazelle | 10/10, mean 82.4 | 10/10, mean 88.7 | **−7%** — barely touched, because the lion does not hunt it and 35 buffalo do not crowd it off the grass |
| buffalo | **9/10**, mean 15.8 | — | establishes from 35 founders; the one loss is late (t14977) |
| stalker | **9/10**, mean 5.1 | 8/10, mean 4.8 | level, and a seed *better* — it competes with neither newcomer |
| lion | **9/10**, mean 10.2 | — | establishes well; the one loss is early (t8017) |
| hyena | 10/10, mean 7.7 | 10/10, mean 3.7 | ⚠ **doubled** — a 600 kg carcass is twenty gazelle, and the facultative scavenger is what that feeds |
| vulture | 10/10, mean 157.8 | 10/10, mean 140.7 | +12%, same reason |

⚠ **Batch 2 costs the incumbents almost nothing and *feeds* two of them**, which is
the opposite of batch 1 (where the hyena cost the stalker three seeds in ten and cut
the vulture 42%). The reason is the prey partition: the lion took a species nothing
else hunts, so the only thing it added to the old food web was 360 kg of carrion at
a time.

**The demonstration** (three seeds × 8000 ticks, every lion attempt split by what
was actually on the field). ⚠ A 2×2, because the two mechanisms **confound each
other** — a co-attacked buffalo is usually also a mobbed one, and the uncontrolled
comparison read *backwards* while both mechanisms were working perfectly:

| lion attempt | attempts | mean capture chance | taken |
| --- | ---: | ---: | ---: |
| alone, unmobbed | 31 | 0.451 | 29.0% |
| with a pride-mate, unmobbed | 20 | **0.535** | 70.0% |
| alone, against a mob | 5 | **0.275** | 0% |
| with a pride-mate, against a mob | 8 | 0.331 | 25% |

Both main effects hold inside both cells. ⚠ The *odds* are the claim and the
outcomes are context: a demo run yields a few dozen attempts, and at that sample
size the captured rate is a coin flip (one seed read 54.5% with company against
55.6% alone — the opposite of the pooled figure, from the same mechanism).

⚠ **One correction to phase 10 came out of this**: mobbing's target now **stands
its ground** rather than fleeing. A fleeing animal is carried away from its herd by
the chase, so the capture happens where no mobber can reach it — **not one attempt
in 12 000 tick-seeds was resolved against a mob** until the hunted buffalo turned
and faced. See `predation/mobbing.js`.

### 10.2 The section as written

| Species             | Mass | Niche                                                                                                            | Gated on                                                  |
| ------------------- | ---: | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `predator.lion`     |  180 | large social predator; pride-forming, female-cored with male dispersal; takes buffalo cooperatively at real risk | `attackersFor` (§3.7), group registry, `predation` ratios |
| `herbivore.buffalo` |  600 | large water-tied grazer, fluid herds, **mobs predators**, dangerous to hunt                                      | mobbing/A33 + A32 fix (§3.7), `riskyMassRatio` (§3.6)     |

**These two belong together**, and pairing them is the main dividend of moving
the hyena earlier: cooperative hunting is built (phase 10) and demonstrated
(phase 11) in adjacent phases, against the one prey animal in the roster that
actually requires a pride. Under the old ordering it shipped six phases before
anything could prove it worked.

This is also the batch where predation stops being one number and becomes a
structure: lion and hyena partition prey by mass (§3.6) and contest each other at
carcasses (§3.9, already built in phase 4), and buffalo is prey that fights back.

Buffalo without mobbing is a gazelle that weighs twenty times as much;
`african-species.md` is right that it is the best early addition _after_ mobbing
exists.

⚠ Lion prides and hyena clans both get **membership and cooperative hunting**, not
inherited rank, matrilines, male takeover, or infanticide. Rank-structured access
to food is a further layer on §3.8 and is out of scope; record it as a stated
limitation for both species.

### 10.3 ✅ Batch 3 (shipped 2026-07-30, phase 13) — wildebeest, zebra

#### ✅ As built — the first batch whose prerequisites were waiting for it

Both mechanisms built at phase 12 shipped inert and were declared here, which is
the ordering §8 has argued for since phase 3 and the first time it paid in full:
nothing had to be built during a species batch. ⚠ **The batch passed its ten-seed
gate on the first attempt** — the first batch that did, against §11.1's "budget a
failed gate per net-new species" — and the reason is not that this pair is easy but
that the two things that would have failed it were caught by *cheaper* measurements
first (a 3-seed exploratory sweep and a config A/B), which is the practice worth
carrying rather than the outcome.

Four results, and the first is the phase's real one:

- ⚠⚠ **A real rut is not survivable in this world, and the cause is two
  compressions meeting.** The wildebeest's first window ran over 0.30 of the year —
  which §3.11 called deliberately wide — and cost the species its existence: **1
  seed in 3** against 3/3 with `breeding.enabled: false`, isolated in one command
  by the switch phase 12 built. The dose–response over four arms is clean: 0.30 →
  1/3 (mean 0.3) · 0.50 → 3/3 (6.7) · **0.65 → 3/3 (10.7)** · none → 3/3 (16.7).
  The mechanism is not at fault. The year is compressed to 8000 ticks *and*
  lifespans are compressed beside it (§11.6), so a wildebeest's adult life is under
  one year — a female whose cooldown ends just after the window closes does not
  wait a season, she waits a lifetime. A narrow window does not slow recruitment,
  it deletes most of the population's opportunities. **0.65 ships**, and it is a
  seasonal restriction rather than the compressed rut the animal is famous for,
  recorded as the limit it is.
- ⚠⚠ **Measure the shift a preference causes, never the state it leaves behind.**
  The raw succession reads *backwards* — gazelle feeds at 2.4 standing crop,
  wildebeest 1.3, zebra 1.2, buffalo 0.6 — because a big animal empties a cell in
  one bite, so the biomass under it measures its appetite rather than its taste.
  Against the mechanism off, the tiers come out in exactly the declared order
  (gazelle shifts −0.97/−1.64, wildebeest −0.51/−0.62, zebra and buffalo ~0). The
  succession is real; the obvious reading of it is not.
- ⚠ **The gazelle needed no re-tune, and this section predicted it would.** §3.3
  said "expect to re-tune the gazelle when the larger grazers arrive" and §8's table
  scheduled it as the phase's headline work. Measured: it feeds at 2.29/2.52 against
  phase 9's 1.93/2.88, because three more grazers did not shorten the sward enough
  to move it. Recorded as a prediction that did not hold, rather than a re-tune done
  for its own sake.
- ⚠ **`social.maxGroupSize` turned out not to be a tuning question at all.** §7
  deferred "is 12 wrong for wildebeest?" to this batch. Measured at 12 against 24,
  every one of the eight species came back **identical to the digit** — because the
  herd label has no behavioural consumer: herding steers at a neighbour centroid,
  mobbing counts `adults` from the same summary, alarm travels by proximity, and
  nothing reads `groupId` but the metrics and the projection. It was raised to 24 on
  reporting grounds (a herd of thirty was reported as three) and the finding is
  written up in DOCS §9 Sociality.

**The passing world** (10 seeds × 15 000 ticks against the batch-2 roster, same
seeds, one process):

| Species | batch 3 | batch-2 control | read as |
| --- | --- | --- | --- |
| gazelle | 10/10, mean 77.5 | 10/10, mean 82.4 | **−6%** — three more grazers on its grass cost it almost nothing |
| wildebeest | **10/10**, mean 8.8 | — | establishes on every seed; declines through the run (34 → 16 → 9) and dies mostly of **age** |
| zebra | **10/10**, mean 15.4 | — | the flattest trajectory in the world (17.7 → 16.8 → 15.4) |
| buffalo | 9/10, mean 16.2 | 9/10, mean 15.8 | level — and its *predation* deaths fell (145 against 194) as the pride spread out |
| stalker | 8/10, mean 6.0 | 9/10, mean 5.1 | ⚠ one seed worse on a higher mean: the incumbent to watch, as in batch 1 |
| lion | **10/10**, mean 14.8 | 9/10, mean 10.2 | **+45%** — the prey base did exactly what §10.3 said it would |
| hyena | 10/10, mean 5.8 | 10/10, mean 7.7 | −25%, squeezed at carcasses by a bigger pride (10.9% of carrion against 17.4%) |
| vulture | 10/10, mean 307.3 | 10/10, mean 157.8 | ⚠ **+95%** — more animals and heavier ones is more carrion, and this is what eats it |

⚠ **Nothing in this batch is limited by the grass**, which is the surprise. The
herbivores die of **dehydration and age**, not starvation (gazelle: 1480 dehydration
against 33 starvation), so the competitive-exclusion case §2 was built around did
not arrive — three grazers on one field coexist here because water and lifespan bind
first. That is worth carrying: §2's risk was real and the reason it did not fire is
a property of *this world's* limiting factor, not proof that the axis was
unnecessary.

### 10.3 The section as written

| Species                | Mass | Niche                                                                                                                 | Gated on                                       |
| ---------------------- | ---: | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `herbivore.wildebeest` |  200 | open plain, large loose herds, mid-maturity regrowth, strong forage-tracking, compressed rut and synchronized calving | forage guilds (§3.3), breeding windows (§3.11) |
| `herbivore.zebra`      |  300 | tolerates tall coarse grass and crops it down; high water need                                                        | forage guilds (§3.3)                           |

✅ **Every gate in that last column now exists**, and two of the three were built
for this batch specifically and are **inert until it declares them** (phase 12).
Four notes for whoever writes these two species files:

- **A breeding window is `reproduction.breedingWindow`**, fractions of the year,
  and it may wrap the boundary. ⚠ Start **wide**: a species that misses a window
  loses a year of recruitment and a 15k sweep holds only two windows (§3.11).
- **An association is `association: { 'herbivore.wildebeest': 0.5 }`** on the
  *gazelle*, not on the wildebeest — it is directional, and the small species is
  the one that benefits (§3.16). ⚠ Its weight only bites in mixed company (A61).
- ⚠ **Both are density mechanisms in the §10.2 sense.** Association counts
  neighbours within `groupRadius`; a window concentrates every conception into a
  quarter of the year, which concentrates the *births*, which is a density spike by
  construction. `behavior.herdDistance` and the founding counts are parameters of
  both, exactly as they were of cooperation and mobbing.
- ⚠ **They will confound each other**, and phase 12 left the switches to separate
  them: `association.enabled`, `association.sharesAlarm`, and `breeding.enabled`
  are three independent arms over the same seeds, which is what `npm run sweep
  --set=` exists for.

These two are a competitive pair and must land together — building either alone
means tuning it twice. With the gazelle already present they complete the
**three-tier grazing succession** (§3.3): zebra open the sward, wildebeest take
the regrowth, gazelle take the short flush. Each species' feeding creates the next
one's habitat, from two config numbers apiece.

This is also where the lion finally gets its proper prey base, and where
`hunts()` needs re-measuring (§7) since a lion's `preySpeciesIds` reaches four
entries.

⚠ Zebra ships **without** true family bands unless §3.8's registry is extended to
them; a pride and a band are different founding rules over the same store. State
which was built. `african-species.md` is explicit that zebra bands are persistent
in a way gazelle herds are not, so this is a real gap, not a quibble.

### 10.4 ✅ Batch 4 (shipped 2026-07-30, phase 14) — leopard · rhino and elephant ahead

#### ✅ As built — a rename that was thirteen phases overdue, and a mechanism built wrong twice

The section below calls phase 14 "about *timing*, not blockers", and that held: the
leopard needed nothing that did not exist. What it did not anticipate is that
taking §3.12 along — which it calls *optional* — would be the whole phase.

- ✅ **The rename was a proven no-op**, as phase 7 established for the grazer and
  the corvid: 2.36 MB of state across three seeds at 1500 ticks, byte-identical
  with the two id strings normalized away. Everything else is separately
  attributable from it. The last `supersededBy` entry went with it, so that scheme
  is now empty — kept, because the next rename needs it.
- ⚠⚠ **Cover concealment was built wrong twice, and both failures measured as "no
  effect" rather than as an error.** Symmetric concealment made the leopard *worse*
  (27 → 19), because a mechanism that hides bodies helps whoever hides and hurts
  whoever **searches**. Then, with per-species `crypsis` in, it *sterilised* the
  leopard (still 19): mate candidates come through the same perception gate, so a
  cryptic **solitary** animal stopped finding mates — now **A63**. Full account in
  §3.12's As-built.
- ⚠ **The ambush fires, and it still costs the leopard.** Attempts launched from
  concealment **21 → 34**, gazelle sightings of a leopard **−24%**, capture rate
  **39.0% → 41.1%** — and the population falls **12.3 → 8.2**. Measured cause:
  *not* mortality (deaths 158 against 184) but fewer completed hunts, because prey
  that never sees the cat never **flees**, and a fleeing target is what forced the
  sprint. The surprise gain does not pay for the slower conversion. ⚠ Raising
  `chaseRange` 4 → 6 to commit sooner was tried and measured **worse** (2/3 seeds
  against 10/10), and is recorded in the species file rather than shipped.
- ✅ **The cost warning was wrong in the useful direction.** §3.12 called this
  possibly "the most expensive item in this document per unit of realism"; measured
  interleaved, **+2.6%**. Nothing accumulates along a ray, because opacity became
  the top of the concealment scale rather than a second pass.

**The passing world** (10 seeds × 15 000 ticks, concealment on against off, same
roster and seeds): every species **10/10** with it on, against 9/10 for the buffalo
and the gazelle with it off — a *more* stable world, with more prey (gazelle 61.8
against 38.1) and a scarcer, more efficient ambush predator (8.2 against 12.3).

⚠ **Whether that trade is the right one is a judgement, and it is recorded rather
than settled**: a leopard that ambushes is the animal §10.4 asked for, and it is a
third less numerous than the generic stalker it replaced.

### 10.4 The section as written

| Species              | Mass | Niche                                                                  | Gated on                                             |
| -------------------- | ---: | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `predator.leopard`   |   60 | solitary, territorial, ambush; takes gazelle and calves                | `predation` ratios; optionally §3.12                 |
| `herbivore.rhino`    | 1000 | solitary browser, cover-associated, territorial males, counter-charges | A51 browse, sex-specific territory, low `fleeWeight` |
| `herbivore.elephant` | 4000 | mega-herbivore, browses and damages woody vegetation, no predators     | everything, plus musth and woody-floor damage        |

Leopard is a rename of the existing stalker plus a mass bump. It works from
batch 1 onward in principle — the gazelle is ideal leopard prey — so phase 14 is
about _timing_, not blockers: doing it after batch 3 means the leopard is tuned
against the prey base it will actually live with. Rhino closes A35 properly (a
genuinely territorial _herbivore_, which the docs have wanted since Step 24).

**The elephant is last and may never be built** (§11.1). It needs A51, the
lifespan compression decision, the full §3.8 registry extended to matriarchal
families, `musthUntil` state, and woody-floor damage — and it has no top-down
control on a 128×128 map. A config-only elephant would be physiology without
ecology, which is worse than no elephant.

### 10.5 What was dropped from the previous roster, and why

| Old candidate       | Became              | Note                                                                              |
| ------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `herbivore.darter`  | `herbivore.gazelle` | it was already the existing grazer                                                |
| `herbivore.browser` | rhino + elephant    | same requirement (browse), real animals                                           |
| `predator.courser`  | lion + hyena        | pursuit predation, plus a social dimension                                        |
| `predator.pouncer`  | _dropped_           | its job was "give the small herbivore a predator" — leopard and hyena now do that |
| `scavenger.jackal`  | `scavenger.hyena`   | same facultative niche                                                            |
| `omnivore.forager`  | _dropped_           | no omnivore in this guild ⇒ **omnivory leaves the critical path** (§3.2)          |

---

## 11. Settled decisions

Recorded 2026-07-28. Re-opening one needs a new reason, not a reminder.

1. **Roster size and cadence — one or two species at a time.** Batch 1 is
   **gazelle + hyena**; batch 2 **lion + buffalo**; batch 3 wildebeest + zebra;
   then leopard, then rhino. **The elephant is last and may never be added.** The
   grazer converts _into_ the gazelle, keeping its 30 kg and essentially all of
   its biology. The stalker converts into a lion **only if it is a social
   carnivore** — checked, it is not (§10.1), so it stays generic until it becomes
   the leopard.
   ⚠ **Amended 2026-07-28:** the hyena and the lion swapped batches. A 60 kg
   hyena is the ecologically correct partner for a 30 kg gazelle (ratio 0.5
   against the lion's 0.17), and its group behaviour — kill theft — is provable in
   batch 1, which the lion's cooperative hunting is not. See §0.
   ✅ **Batch 1 shipped 2026-07-29 and the swap was the right call**: kill theft
   fired 41 times in 4000 demo ticks, so the registry was proved inside its own
   batch exactly as intended. ⚠ But the batch was **not** free the way the "keeps
   essentially all of its biology" phrasing suggests — the gazelle half was free
   (byte-identical), while the hyena cost the stalker three seeds in ten and needed
   a failed gate to find its `minHungerToHunt` (§10.1). Budget a failed gate per
   net-new species, not per batch.
2. ✅ **Persistent social groups — build the full registry, and build it early.**
   Not the cheap sticky-label cut. A clan-forming carnivore in batch 1 makes it a
   prerequisite rather than optional depth, so it lands in phase 3 — and batch 1
   proves it, via clan-held carcasses. ⚠ It overrides a documented design
   decision in DOCS §9 Sociality and that section must be rewritten to say so, not
   quietly changed. The existing herd-label mechanism is kept alongside it and is
   what the gazelle keeps using (§3.8).
   ✅ **Shipped 2026-07-28.** DOCS §9 Sociality now opens with the override.
   Still unproven in a world: nothing forms groups until phase 7, which is why
   §9's gate asks batch 1 to assert clan formation and dissolution *directly*
   rather than inferring them from survival.
3. **Rename the species.** Old saves are not a concern, so no alias map. But
   "not a concern" must mean _fails loudly_: add a load-time check that rejects a
   save containing an unknown `speciesId` rather than silently degrading to config
   defaults (§5.8).
4. **`decision` per-species — option B, as a config split.** `config.decision`
   splits into `config.behavior` (~22 biology weights, a species block) and
   `config.decision` (mechanics, global). Keeps a species file a description of an
   animal rather than a description of the engine (§3.1).
5. **Protocol v29, so the UI does not lie.** The restart command takes a founding
   roster by species and the host publishes its species list; the renderer stops
   hardcoding three role fields. Splitting a role's count host-side would preserve
   v28 and would be exactly the lie this rejects — and with a hyena in the roster
   the words "predator" and "scavenger" stop being true anyway (§6). Take the
   group projection in the same bump.
6. **Compress megafauna lifespans** rather than extending the measurement window.
   Every species stays measurable in a 15k-tick sweep. Keep the life-history
   _ordering_ real, give up the _ratios_, and record the distortion in DOCS §5
   beside the existing compression note (§7).

---

## 12. Documents that must move with this

Per E4 discipline, and all lists must stay in step:

- `DOCS.md` — ✅ **§8's species table** grew with every batch: "The four species" at
  phase 7, six at phase 11, **"The eight species" at phase 13**, and the leopard
  rename at phase 14 — each with its byte-identity proof recorded beside it; ✅ **§9 Sociality was
  rewritten** at phase 3 (§11.2) — it now opens by recording the decision it
  overrode, with the label mechanism kept whole underneath and a new "Persistent
  groups" subsection beside it; ✅ §9 Carcasses at phase 4 (possession); ✅ **§9
  Parenting gained "The hidden-fawn stage"** at phase 8, and ✅ §7 Decision now
  lists `hide`/`tend` and says why two new actions were allowed; ✅ **§9 Hunting and
  §7 Decision again at phase 10** (cooperative action, and why it added no action);
  ✅ **§9 Sociality gained "Heterospecific association" and §9 Reproduction
  "Seasonal breeding windows" at phase 12**, and the Sociality table went from two
  mechanisms to three; ✅ **§8's table became "The eight species" at phase 13**, with
  the succession measurement in §9 Feeding, the herd-label finding in §9 Sociality,
  the zebra band in §9 Persistent groups, and the hyena's calf predation in §9
  Hunting; ✅ **§5 lifespan compression at phase 13** (§11.6) — and it is no longer a
  note but a live interaction (A62); §9 Feeding at phase 9; §7 Vegetation at phase 9;
  ✅ §19 configuration map at phase 2, phase 10, and phase 12
- `ACTION-ITEMS.md` — ✅ **A55 closed at phase 7**; ✅ **A56 opened at phase 7** (a
  two-member clan flaps) and ✅ **A57 at phase 8** (concealment needs cover); ✅ A34
  was *tested* by phase 8 and its diagnosis held — it stays open, for the sharper
  reason that patrol's target is a place rather than a purpose; ⚠ **A32 was touched
  by phase 8 and did not improve**, so its remaining lever was the "nearer the
  predator than I am" test; ⚠ **that lever was built and measured at phase 10 and it
  is not the constraint** — A32 stays open with a new diagnosis, ✅ A33 is
  implemented-but-inert, and **A59** opened; ✅ **A61 opened at phase 12** (an
  association weight only bites in mixed company, and the obvious fix measured
  inert); ✅ **A49's habitat half
  closed at phase 9** (its activity-pattern half stays open, with no diurnal cycle to
  hang one on); A35
  revisited by sex-specific territory (phase 15); A51 in phase 15 — ⚠ and A57 is
  now an extra argument for it; A18 by §3.12; A3, A12, and A37 remain open
- `src/renderer/DOCS-RENDERER.md` + `README-RENDERER.md` — ✅ appearance scheme and
  metrics panel at phase 6, ✅ the two superseded glyph entries deleted at phase 7,
  ✅ **the last one at phase 14** (stalker → leopard), which empties the
  `supersededBy` scheme without removing it; restart controls and protocol version
  as they change
- ✅ `tests-ui/controls.spec.js` — done at phase 5. It now asserts the founder
  fields are **generated from the host's roster** rather than merely present; a
  panel that hardcoded the same three species would pass a presence check
- ⚠ `src/renderer/app/state/EventCatalog.js` — **every new event type needs an
  entry** (label, group, retention tier) or `test/renderer-*.test.js` fails
  against the protocol's type list. ✅ Kill theft and group formation/dissolution
  landed at phase 5. ⚠ **Mobbing needed none after all**, which is the payoff of it
  being `defend` rather than a new action: a mobber is reported through
  `entity.defended` — "an adult putting itself between a predator and a groupmate or
  its own young", which is exactly what it is — so phase 10 took **no protocol bump
  and no fixture regeneration**. (Contrast `entity.contested`, where reuse *would*
  have made the UI lie.)
- ⚠ `npm run fixtures:renderer` — mandatory on **every** protocol bump (done at
  phase 5; due again if §3.2's `diet` change lands). ⚠⚠ **And on every roster
  change, which nobody had written down**: the committed fixtures still described
  the *batch-1* world at phase 13 — no lion, no buffalo — so offline renderer
  development could not see half the species the demo ships, including two whose
  glyphs phase 6 had assigned in advance. Regenerated at phase 13. One UI test had
  to move with them (`tests-ui/event-filters.spec.js` assumed the fixtures contain
  no births or deaths; eight species and 24% more animals means something dies
  inside the warm-up).
  ⚠⚠ **And bump `SUPPORTED_PROTOCOL_VERSION` with it.** At v29 both were missed
  and *the whole suite stayed green*, because the renderer tests compared that
  constant against itself — fixture mode would have refused every message at
  runtime. Both are now asserted by `test/protocol-v29.test.js`; see DOCS D31
- `src/scripts/benchmark.js` — all four scenarios hardcode the roster and its
  ratios; they must move with every rename and every added species, or the
  benchmark stops describing the demo. ✅ Done at phase 7 (the hyena joined all
  four at the demo's 120:8:10:6 ratio) — ⚠ which means **every figure taken before
  2026-07-29 describes a different population** and is not comparable
- `BENCHMARK.md` — ✅ re-baselined at phase 0, again at phase 7 (large-5k 75.7
  ms/tick on the new roster), and phase 8 measured flat. ⚠ The rule that matters is
  recorded there: interleave the arms in one session and read the **ordering across
  rounds**, not the means — a real cost is slower in every round, and an arm that
  wins two and loses one is noise
- ✅ `src/scripts/sweep.js` + `npm run sweep` — **new at phase 7**, and the thing
  §9's gate is actually run with. Every future batch is measured through it, and a
  species-count or roster change wants `--control=` rather than two hand-compared
  runs. ✅ **Phase 9 added `--set=` / `--controlSet=`**, so a *config* A/B is one
  command over the same seeds too — the limitation §9 used to state ("a config change
  still needs two runs") is gone, and it existed only because nobody had written the
  flag
- `african-species.md` — its biology is now folded into §10 and its mechanics into
  §3, including the gazelle model added 2026-07-28. Either delete it or mark it
  explicitly as the source analysis, so nobody implements its proposals directly
