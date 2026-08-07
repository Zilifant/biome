/**
 * The lion (PLAN-SPECIES.md phase 11, batch 2) — the species cooperative hunting
 * was built for, and the first to declare `hunting.cooperationWeight`.
 *
 * ⚠ **It is paired with the buffalo on purpose and must not be read alone.**
 * PLAN-SPECIES §0 moved the lion out of batch 1 for exactly this reason: a pride
 * only means anything against prey a single hunter cannot take, so cooperative
 * capture was built at phase 10 and is *proved* here, against the 600 kg animal
 * that justifies it. A lion in a gazelle-only world would have been a heavy
 * stalker with a group label.
 *
 * What makes it more than that, and all of it is data:
 *
 * - `hunting.cooperationWeight` — every clanmate already committed to the same
 *   quarry raises the capture odds. **The first species in the world to state
 *   it**, so DOCS A59's "built and inert" half closes with this file.
 * - `groups.forms: true`, from machinery the hyena already proved (§3.8).
 *   ⚠ Pride *membership* and cooperative hunting, not inherited rank, matrilines,
 *   male takeover, or infanticide: §10.2 puts all four out of scope and they stay
 *   out. ⚠⚠ **This read "with the config's `leavingSex: 'male'` — a female-cored
 *   pride" until 2026-08-07.** PREDATOR-PLAN P1 overrides it to `'none'` so that
 *   the whole species is one pride, which gives the female-cored half up on
 *   purpose and temporarily. See the `groups` block below.
 * - `predation.maxPreyMassRatio: 3.5` — high enough to commit to an adult buffalo
 *   **alone**, which is the A59 decision made concrete. Prey eligibility is
 *   resolved per animal in perception, where it cannot know whether help is at
 *   hand, so a cooperative species needs a ceiling that lets it start the hunt
 *   and cooperation then supplies the *odds* rather than the eligibility. A lone
 *   lion therefore does try, and usually fails, and `riskyMassRatio` is what it
 *   pays for trying.
 * - ⚠ **It hunts buffalo and nothing else**, which is a measurement rather than a
 *   taste (see `preySpeciesIds` below): perception reports the *nearest eligible*
 *   prey, so a lion that would also take gazelle never engages the animal it was
 *   built for. That is also the prey partition keeping lion and hyena out of each
 *   other's niche (§2) — the hyena takes gazelle, the pride takes buffalo, and
 *   they meet only at a carcass.
 *
 * ⚠⚠ **`minHungerToHunt` is the tightest number in this file, and the first gate
 * failed on it.** A large carnivore that also scavenges is not limited by the prey
 * it hunts: at 0.3 the pride grew on **37.6% of all carrion taken in the world**
 * and ate the buffalo out — 5/10 seeds, 317 of 501 buffalo deaths from predation —
 * which is the hyena's phase-7 failure repeated against a slower-breeding victim.
 * But the same number is what makes cooperative hunting *visible*: at 0.6 a lion
 * is hungry enough to hunt in only 5% of its ticks and two of them rarely are at
 * once, so the mechanism this whole batch exists to demonstrate never fires.
 * **0.45 is the only setting measured to do both**, which is a narrower window
 * than anything in batch 1.
 */
export const predatorLion = Object.freeze({
  id: 'predator.lion',
  kind: 'animal',
  diet: 'carnivore',
  // ⚠⚠ **Buffalo only, and the first draft listed the gazelle as well** — which
  // was measured to make this species pointless. Perception reports the *nearest*
  // eligible prey (DOCS A58), and the demo runs six gazelle to every buffalo, so a
  // lion that will take either almost never engages the one it was built for:
  // measured 4000 ticks × 2 seeds, **2 attempts on a buffalo, 0 shared quarries,
  // 0 mob-ticks** — batch 2 with neither of phase 10's mechanisms firing at all.
  //
  // This is `minPreyMassRatio`'s stated purpose (§3.6) reached by the honest
  // route: "what stops a large predator bothering with something it cannot profit
  // from". A 30 kg gazelle is 0.17 of a lion's mass, which §0 already called "well
  // under what a pride is for". So the partition is by species here and by *mass*
  // within the species below, and it is what makes lion and hyena coexist on one
  // map rather than compete for one prey animal (§2).
  // ⚠⚠ **Three entries as of batch 3, and the reason it was one is still live.**
  // Perception reports the *nearest eligible* prey (A58), so a list is a
  // statement about what this animal spends its life on, not a menu it chooses
  // from — phase 11 measured a lion that also listed gazelle taking **2 buffalo
  // in 4000 ticks**. What makes wildebeest and zebra safe to add where gazelle
  // was not is that they are *worth* the hunt: 200 kg and 300 kg against a 180 kg
  // hunter, where a 30 kg gazelle is a lion doing a leopard's job for a leopard's
  // meal. This is the prey base §10.3 said this phase would give it, and it is
  // what a Serengeti pride actually lives on.
  //
  // ⚠ It is also the phase's main measurement risk, and it runs both ways: a
  // wider base feeds more lions, and more lions is more pressure on the buffalo
  // the pride was built for. Watch `predator.lion` and `herbivore.buffalo`
  // together in the sweep — and `minHungerToHunt` first, as ever.
  preySpeciesIds: Object.freeze(['herbivore.buffalo', 'herbivore.wildebeest', 'herbivore.zebra']),
  bodyMass: 180, // kg (adult) — 4× the stalker, and the first real step up
  baseSpeed: 1.4, // powerful rather than quick: faster than a buffalo, barely
  // faster than a gazelle, and it pays for every second of it
  // 380 ≈ 100 × 6^0.75 — the tank scales as the burn does (see the buffalo file
  // for why the roster's older ~mass^0.34 trend does not survive this batch).
  maxEnergy: 380, // eats rarely and enormously
  maxHealth: 180,
  maxHydration: 100,
  // ⚠ **The physiology that separates it from the hyena**, which is the other
  // social carnivore in the world: 80 against the hyena's 120. A lion is a
  // sprinter with no endurance — it wins in the first few seconds or not at all —
  // where a hyena wins by outlasting. Two social predators that differed only in
  // mass would be the competitive-exclusion case §2 is built around avoiding.
  maxStamina: 80,
  perception: Object.freeze({ radius: 13 }),
  comfortMin: -2,
  comfortMax: 28,
  aging: Object.freeze({
    birthMass: 12, // kg — a cub
    maturityAge: 2600,
    juvenileUntil: 800,
    subadultUntil: 2600,
    adultUntil: 10000,
    maxAge: 16000, // ⚠ compressed like the buffalo's (§11.6): ordering real,
    // ratio given up, so a 15 000-tick sweep still contains a generation
  }),
  // Expensive at rest (muscle), cheap to move for its mass.
  metabolism: Object.freeze({ basalRate: 0.05, moveCostFactor: 0.016 }),
  // Gets much of its water from what it eats, like every carnivore here.
  hydration: Object.freeze({ dehydrationRate: 0.03 }),
  // Males compete on size; the females choose and weigh condition heavily.
  matePreference: Object.freeze({ trait: 'size', span: 0.25, conditionWeight: 0.5 }),
  // ⚠ Slower than the hyena, which is slower than the stalker — the ordering a
  // top predator at low density needs, and the half of phase 7's failure that was
  // *not* about hunting: the first hyena draft bred faster than the animal twice
  // its size, and a subsidised population that also breeds fast is a population
  // nothing limits.
  reproduction: Object.freeze({ gestationTicks: 1400, cooldownTicks: 3000 }),
  // ⚠⚠ **`defends: false`, and the first draft had it true — which quietly made a
  // pride impossible.** A lion pride does hold ground in life, but this engine's
  // territory is an **individual** claim: `TerritorySystem` marks cells by entity
  // id, and `retreat` moves an animal off ground *anyone else* has marked,
  // pride-mate included. So two lions that met immediately pushed each other
  // apart, and cooperative hunting — which needs two hunters on one quarry —
  // measured **0 shared-quarry ticks in 8000** across two seeds. A social species
  // cannot use a mechanism whose unit is the individual.
  //
  // What it keeps is the home range (descriptive, and what `patrol` would use),
  // without exclusivity — the gazelle's and buffalo's answer. ⚠ Shared *pride*
  // territory would need the claim layer to key on `groupRecordId` rather than on
  // an entity id, which is a real extension of §3.8 and is not in this batch's
  // scope; recorded as a limitation rather than half-built.
  territory: Object.freeze({ defends: false, rangeRadius: 30, settleTicks: 1600 }),
  // ⚠ A **pride**: an identity that survives separation, which is what the group
  // registry models and what a herd label cannot (§3.8). Everything about
  // founding, joining, guardian inheritance, and departure at dispersal is
  // world-level machinery in `config.groups`; a species says whether it takes
  // part and which of those numbers it differs on.
  //
  // ⚠⚠ **One pride for the whole species, and it is deliberately temporary**
  // (PREDATOR-PLAN P1, 2026-08-07). Multiple prides and male coalitions come back
  // when there are lion behaviours to support them; until then the world is
  // simpler with one. It is three fields and no mechanism:
  //
  //   - `cohort.groupSize` below is larger than any roster, so every founder is
  //     placed at one anchor and the registry founds a single record on tick 1.
  //   - `inheritFromGuardian` (the config default) puts every cub in its
  //     mother's record, so births need no rule.
  //   - `leavingSex: 'none'` means nothing ever removes a living member.
  //
  // ⚠ **It is an initial condition plus no departures, not an enforced
  // invariant.** Nothing in `GroupSystem` knows this species wants one record. A
  // lion that ends up unattached — its record dissolved while it was the only
  // survivor, or it was spawned by command away from the others — rejoins only
  // by walking within `groups.joinRadius` (6) of a pride-mate, and may found a
  // second pride with another stray in the meantime. The test in
  // `test/groups.test.js` asserts the founded world, not an invariant that holds
  // under every history.
  //
  // ⚠ **`leavingSex: 'none'` is what a female-cored pride costs.** The config's
  // `'male'` is what made departure sex-biased and the pride matrilineal (§3.8);
  // restoring it is this one field, and it is named here so that is a one-line
  // change rather than an archaeology exercise.
  //
  // ⚠ `maxMembers: 64` against the config's 8: a single pride has to hold the
  // whole population as it grows, and a record at its cap refuses joiners
  // silently. 64 is well clear of any lion population this world has produced
  // (mean 17 at the crater's ten founders) and well under `groups.maxGroups`.
  groups: Object.freeze({ forms: true, maxMembers: 64, leavingSex: 'none' }),
  // Founders are packed into clusters of this size in roster order
  // (`config.cohorts`), tight enough that a full cluster founds a record on the
  // first tick (see the zebra for why a forming species gets a smaller spread
  // than an aggregating one).
  //
  // ⚠⚠ **`groupSize` is larger than any roster on purpose** (PREDATOR-PLAN P1):
  // the placement loop opens a new anchor only when the current cluster is full,
  // so a size no roster reaches means *one* anchor for every lion in the world,
  // which is how the single pride above is founded without a fixture ever writing
  // a `groupRecordId`. It is not a claim that 64 lions are founded.
  //
  // ⚠⚠ **`spread` stays at 4, and the first draft of this phase raised it to 8 on
  // an argument that measurement refuted.** The argument was that a cluster of
  // sixty-four cannot fit in a radius-4 disc, since
  // `locomotion.maxOccupantsPerCell` (2) refuses a full cell. It fits: ~50 cells
  // at 2 occupants is ~100 slots, and a lion roster of 5/12/20/40/64 founds **one
  // record with nobody unattached on every seed tried** at spread 4.
  //
  // What 8 actually cost was the founding itself. `groups.joinRadius` is 6, so a
  // record forms by single-linkage through the cluster; at spread 8 two founders
  // can land 16 apart and five animals are too few to chain between them.
  // Measured over ten seeds: spread 2/3/4 found **one** pride on 10 of 10, spread
  // 5 on 8 of 10, spread 6 on 6 of 10, spread 8 on 4 of 10 — and a split pride is
  // permanent, because records never merge (`GroupSystem` rule 6). **A sparser
  // cluster is the failure mode here, not a denser one**, which is the opposite
  // of the intuition, and it is why this number is left alone.
  //
  // ⚠ This line read "two prides of four out of the eight founders" from
  // 2026-08-04 to 2026-08-07 — it described the 222-animal world and was never
  // updated when the crater roster made it ten. Six species files carried the same
  // rot. It then read "one pride of four and one animal left over" for
  // `default-small`'s five, which P1 makes obsolete: there is no remainder now,
  // because there is only ever one cluster.
  cohort: Object.freeze({ groupSize: 64, spread: 4 }),
  // Follows prey through perception, not grass through a gradient — and tracks
  // water for the reason the stalker does: a predator that spends its life in a
  // dry corner of the map needs a steer to the lake on the rare occasions it
  // dries out. Long natal dispersal, because a young lion must cross other
  // prides' ground before it finds unattached animals.
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 0, dispersalTicks: 900 }),
  hunting: Object.freeze({
    // ⚠⚠ **The first declaration of cooperative hunting in this world** (§3.7,
    // phase 10, DOCS A59). Each other pride member already committed to the same
    // quarry multiplies the capture chance by this much, capped at
    // `maxAttackers` — so three lions on a buffalo roughly double the odds a
    // single one has, and a lone lion is left with the odds its own body gives
    // it. ⚠ Tuned here rather than at phase 10 on purpose: a weight fitted to a
    // 30 kg gazelle a single hyena takes solo would have been fitted to the case
    // it was not built for.
    cooperationWeight: 0.35,
  }),
  predation: Object.freeze({
    // See the header: high enough to commit to an adult buffalo alone, because
    // eligibility cannot know whether help is coming (A59).
    maxPreyMassRatio: 3.5,
    // ⚠⚠ **0.2 → 0.05 on 2026-08-07 (PREDATOR-PLAN), and it stopped being inert
    // in the same edit.** At 0.2 the floor was 36 kg, which is above a newborn
    // wildebeest (18 kg) and a zebra foal (30 kg) — so a lion walked past the
    // calves of two of the three species on its own prey list. That was the
    // opposite of what the number was written for: `minPreyMassRatio` is "what
    // stops a large predator bothering with something it cannot profit from", and
    // a calf of a 200 kg grazer is not that.
    //
    // 9 kg admits every calf in the world and still refuses a newborn hyena
    // (1.5 kg) and a vulture (6 kg) if either is ever listed. ⚠ It also admits an
    // adult gazelle (30 kg) the moment one appears on `preySpeciesIds` — see the
    // list above for why that is a measurement rather than a preference (A58).
    minPreyMassRatio: 0.05,
    // ⚠ **What it pays for trying.** `HuntingSystem` scales the hunter's injury
    // chance by `defenderMass / attackerMass`, capped here; the config's 2 would
    // clip a buffalo's 3.33 down to the danger of a 360 kg animal. Raising it to 3
    // is what "takes buffalo at real risk" means in this engine, and it compounds
    // with a mob: every adult standing over the prey multiplies it again.
    riskyMassRatio: 3,
  }),
  behavior: Object.freeze({
    // ⚠ **Check this first if batch 2 misbehaves** (see the header, and §10.1 for
    // the hyena's identical failure). A carrion-subsidised predator is not limited
    // by its prey; coupling hunting back to hunger is what limits it.
    minHungerToHunt: 0.45,
    huntWeight: 1.5,
    // ⚠ **The tightest social pull in the world, and it is what makes a pride
    // hunt rather than merely exist.** Cooperation is counted from animals
    // committed to the *same* quarry within `cooperation.range` (6), so lionesses
    // that forage four units apart are a pride on paper and several independent
    // predators in practice — measured at `herdDistance: 4`, **2 cooperative
    // attempts in 12 000 tick-seeds**. Closing the band to 2 puts pride-mates
    // inside one perception of the same buffalo, which is what turns a shared
    // record into a shared hunt.
    herdWeight: 1.2,
    herdDistance: 2.0,
    // A short sprint budget is worth spending only when it will decide something.
    minHuntStamina: 20,
    // It gives ground at a carcass less readily than anything else alive.
    retreatWeight: 0.4,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
