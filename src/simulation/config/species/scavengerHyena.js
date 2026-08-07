/**
 * The spotted hyena (PLAN-SPECIES.md phase 7, batch 1) — the first genuinely
 * **new** species since the corvid, and the first one that uses the machinery
 * phases 2–4 built.
 *
 * ⚠ **A facultative scavenger needs no engine change to exist.** It is a
 * carnivore with a non-empty `preySpeciesIds`, exactly as the stalker is — it
 * hunts, and the feeding system already lets any carnivore eat carrion. What
 * makes it more than a heavy stalker is entirely in the blocks below, and every
 * one of them is data:
 *
 * - `groups.forms: true` — **the first species in the world to declare it.** The
 *   persistent-group registry (§3.8) shipped inert at phase 3 and has been
 *   carried by tests that invent a species ever since; this is the animal it was
 *   built for, and DOCS A55 closes with it.
 * - `predation` mass ratios — the first species to bound what it will take on.
 * - `behavior.herdWeight` above the config default — a clan animal, against the
 *   solitary stalker, expressible only since the `behavior` split (§3.1).
 * - `hunting.agility` on the prey side and possession on the carcass side do the
 *   rest without it declaring anything.
 *
 * **Kill theft is its defining behaviour**, and it is why the hyena rather than
 * the lion is in batch 1: cooperative *hunting* cannot be demonstrated against
 * 30 kg prey a single hyena takes easily, but cooperative *possession* can —
 * the contested resource is the carcass, not the prey, so a clan displacing the
 * resident stalker from its kill is observable in a world containing only
 * gazelle. That is `possessorId` plus `resolveContest` (§3.9, phase 4), and this
 * species declares nothing to get it: it is heavier and stronger than a vulture
 * and comparable to a stalker, and dominance does the rest.
 *
 * ⚠ **`hunting.cooperationWeight` is deliberately absent**, because
 * `attackersFor` does not exist until phase 10. Tuning a cooperation term
 * against gazelle would fit a parameter to the case it was not built for; the
 * lion and the 600 kg buffalo are what justify it, and they arrive together in
 * batch 2.
 *
 * ⚠ **The species at risk in this batch is the vulture, not the stalker.** A
 * 60 kg facultative scavenger and a 6 kg obligate one contend for the same
 * bodies, and without carcass possession the hyena would take every one of them
 * on id ordering alone. `possessionShare` is what leaves the vulture a living —
 * scraps at an occupied kill rather than nothing — and its 0.25 was measured on
 * the *corvid–stalker* world, so batch 1 is where it is re-measured against the
 * animals it was designed for.
 */
export const scavengerHyena = Object.freeze({
  id: 'scavenger.hyena',
  kind: 'animal',
  // Hunts *and* scavenges. The non-empty prey list is the entire difference
  // between this animal and the vulture at the schema level; everything else
  // below is what makes it a different animal to watch.
  diet: 'carnivore',
  // ⚠⚠ **The wildebeest is on this list as a *calf*, and nothing below says so.**
  // `maxPreyMassRatio: 1.0` was written at phase 7 with the note that it "bounds
  // nothing today"; batch 3 is where it starts binding. A 60 kg hyena may commit
  // to prey up to 60 kg, a wildebeest is born at 18 kg and grows to 200, so the
  // ratio admits calves and refuses their mothers — with no life-stage
  // conditional anywhere, because `bodyMass` grows along the aging curve (§3.6).
  // That is age-structured prey selection falling out of a field that already
  // existed, and hyenas taking wildebeest calves is the textbook case of it.
  //
  // ⚠ The zebra is deliberately **not** here: a zebra foal is born at 30 kg and is
  // over the ratio within a fraction of its juvenile stage, so listing it would
  // buy a handful of ticks of eligibility and a great deal of A58 — the nearest
  // *eligible* animal is what perception reports, and a target that stops being
  // eligible mid-stalk is a hunt that evaporates.
  // ⚠⚠ **The zebra and the buffalo joined on 2026-08-07 (PREDATOR-PLAN P5).** The
  // note above argued the zebra out on the grounds that "a zebra foal is born at
  // 30 kg and is over the ratio within a fraction of its juvenile stage, so listing
  // it would buy a handful of ticks of eligibility and a great deal of A58". That
  // was **true against a 60 kg ceiling and is no longer the whole story**: P3 gives
  // a clan of three a 300 kg ceiling, so a grown zebra is a clan's prey while a
  // foal is a lone hyena's, and the eligibility a listing buys is no longer a
  // handful of ticks. The buffalo is here on the same terms — calves solo, subadults
  // to a clan, and an adult refused by both.
  //
  // ⚠ The A58 caution stands and is now carried by the ratios rather than by the
  // list: what a hyena spends its life on is decided by which eligible animal is
  // *nearest*, and eligibility is a mass test that moves with the animal's own
  // clan. ⚠⚠ **A quarry that stops being eligible mid-stalk is a hunt that
  // evaporates**, and this is the roster where that can first happen — a clan that
  // scatters drops a zebra it had committed to. Watch abandoned stalks, not only
  // captures.
  preySpeciesIds: Object.freeze([
    'herbivore.gazelle',
    'herbivore.wildebeest',
    'herbivore.zebra',
    'herbivore.buffalo',
  ]),
  bodyMass: 60, // kg (adult) — 0.5× ratio on a 30 kg gazelle is an ordinary
  // predator–prey match, and only 1.3× the stalker, so batch 1 carries almost
  // none of the mass jump the original lion-first plan would have
  baseSpeed: 1.3, // a courser: not fast, but it does not stop
  maxEnergy: 130, // eats rarely and in bulk, like any large carnivore
  maxHealth: 110, // famously robust — it takes and gives injuries
  maxHydration: 100,
  maxStamina: 120, // the distinguishing physiology: it wins by outlasting, so
  // its sprint budget is larger than the ambush predator's while its top speed
  // is lower
  // Sees well but not as far as an obligate scavenger, which lives or dies on
  // spotting a body first. Between the stalker's 12 and the vulture's 14.
  perception: Object.freeze({ radius: 13 }),
  comfortMin: 0,
  comfortMax: 30, // a hot-climate animal, more heat-tolerant than the stalker
  aging: Object.freeze({
    birthMass: 1.5, // kg — cubs are small relative to a 60 kg adult
    maturityAge: 1600, // slower than a gazelle, slower even than the stalker
    juvenileUntil: 600,
    subadultUntil: 1600,
    adultUntil: 8000,
    maxAge: 15000,
  }),
  // Heavier than the stalker and travels further, but is built to do it
  // cheaply — the economics of a courser rather than an ambusher.
  metabolism: Object.freeze({ basalRate: 0.05, moveCostFactor: 0.015 }),
  // Gets most of its water from what it eats, like every carnivore here.
  hydration: Object.freeze({ dehydrationRate: 0.027 }),
  // Reads condition far more than any ornament — in a clan animal the thing
  // worth choosing is a mate that is thriving, and there is no display trait to
  // read. Same shape as the vulture's, for the same reason.
  matePreference: Object.freeze({ trait: 'speed', span: 0.3, conditionWeight: 0.75 }),
  // ⚠ **Slower than the stalker, not faster.** The first draft had 900/2000 —
  // quicker than the 45 kg solitary predator — which is backwards for a heavier
  // animal and was a real part of the first gate failure: a carrion-subsidised
  // population that also breeds fast is a population nothing limits. A large
  // carnivore raises one or two young slowly and at long intervals, and the
  // demo needs that to be true as much as the biology does.
  reproduction: Object.freeze({ gestationTicks: 1200, cooldownTicks: 3200 }),
  // ⚠ **Not territorial**, and it is one of the three axes that keep this animal
  // from competing the stalker to extinction (§2). The stalker holds, marks, and
  // disputes ground; the clan ranges over it. Two mid-size carnivores on one
  // prey species with the *same* answer here would be exactly the competitive-
  // exclusion case the whole plan is built around avoiding — so they differ on
  // territory, on sociality, and on whether they can eat carrion at all.
  territory: Object.freeze({ defends: false, rangeRadius: 24, settleTicks: 1200 }),
  // ⚠ **The first species in this world to form persistent groups.** A clan is
  // an identity that survives separation — members scatter to forage and are
  // still a clan — which is precisely what the herd label cannot express and
  // what the registry was built for. Everything else about founding, joining,
  // guardian inheritance, sex-biased departure, and dissolution is world-level
  // machinery in `config.groups`; a species only says whether it takes part.
  //
  // ⚠⚠ **`maxMembers: 16` against the config's 8** (PREDATOR-PLAN P2). The clan
  // *size* is now solved from the founder count (see `cohort` below) and aims at
  // 8–12, so a cap of 8 does not hold one: measured before this line existed, a
  // cluster of ten enrolled **8 + 2** — one clan and a stranded pair standing
  // inside it, which is worse than either a big clan or two real ones, because
  // the pair is a record founded on the `groups.dissolveGraceTicks` clock in the
  // middle of somebody else's clan. 16 holds the whole aimed range with room for
  // the cubs that inherit it.
  groups: Object.freeze({ forms: true, maxMembers: 16 }),
  // ⚠⚠ **The clan structure is solved from the roster rather than stated**
  // (PREDATOR-PLAN P2, 2026-08-07). `preferredGroupSize` / `maxGroups` replace a
  // literal `groupSize`, and `cohortShapeFor` resolves
  // `clusters = clamp(round(count / 10), 1, 5)`, `groupSize = ceil(count / clusters)`:
  // **optimize for clan size until five clans, then optimize for clan count.**
  //
  //   | founders | clans | clan size |
  //   | -------: | ----: | --------: |
  //   |       20 |     2 |        10 |  ← `default-small`
  //   |       30 |     3 |        10 |
  //   |       60 |     5 |        12 |
  //   |      100 |     5 |        20 |
  //
  // ⚠ This line read "clusters of three — six clans of three and a pair" until
  // P2, with the argument that three beats two because `groups.minMembers` is 2
  // and a founding *pair* dissolves the moment either animal walks away (the
  // flapping A56 records). **That argument is not withdrawn, it is obsoleted**:
  // the smallest clan this rule can produce is `ceil(count / 1)` for a small
  // roster or `ceil(count / 5)` for a large one, and neither is a pair unless the
  // world founds fewer than ten hyena in total. The remainder that used to start
  // on the dissolve-grace clock is gone because there is no remainder — the size
  // is derived from the count rather than dividing into it.
  //
  // ⚠⚠ **`spread` 4 → 3, and the intuition is backwards here too** — the lion's
  // `cohort` records the same trap. A cluster of ten looks like it needs *more*
  // ground than one of three, and 6 was tried on exactly that reasoning; a
  // ten-animal cluster must instead stay connected within `groups.joinRadius` (6)
  // **transitively**, and at spread 6 the far members cannot see the near ones, so
  // the clan founds as two records and they never merge (`GroupSystem` rule 6).
  // Measured, ten seeds, hyena records on tick 1 from 20 founders:
  //
  //   | spread | records |
  //   | -----: | ------- |
  //   |   2, 3 | **2 of 10 members, on 10/10 seeds** |
  //   |      4 | 2 on 9 seeds, `8+2+10` on one |
  //   |      5 | 2 on 5 seeds, splitting on the rest |
  //   |      6 | 2 on 2 seeds; `4+4+2+10` at worst |
  //
  // A denser cluster is not a crowding problem: a radius-3 disc is ~28 cells at
  // `locomotion.maxOccupantsPerCell: 2`, so ten animals use a sixth of it.
  //
  // ⚠ **`separation` is the "different areas of the map" half**, and it is the
  // first per-species value for it. Clans are pushed 60 units apart on a 230×180
  // ellipse — about a third of the long axis, so two clans genuinely start in
  // different parts of the world instead of in one crowd carrying two records.
  // Measured over ten seeds, nearest distance between two clan centres on tick 1:
  // **64 minimum / 105 mean with it, against 25 / 87 without** — so it moves the
  // worst case rather than the average, which is what a floor should do. Both arms
  // found 2 clans of 10 on 10/10 seeds, so this separates clans without changing
  // the clan structure.
  //
  // The world-level switch is `config.cohorts.separated`; 0 here (or `separated:
  // false`) restores independent anchors byte-identically.
  cohort: Object.freeze({ preferredGroupSize: 10, maxGroups: 5, spread: 3, separation: 60 }),
  // What it *wants*, and where it differs from the solitary stalker (§3.1).
  behavior: Object.freeze({
    // A clan animal stays with its clan. The config default is 0.6 (a gazelle
    // herd); this is the strongest pull in the world, and it is what makes a
    // clan read as a clan on the grid rather than as several adjacent hyenas.
    herdWeight: 1.1,
    herdDistance: 3.0, // looser than a herd — a clan spreads while foraging
    // Bolder at a carcass than anything else alive. This is the decision-side
    // half of kill theft: possession is resolved by dominance, but an animal
    // has to be willing to walk up to an occupied body in the first place.
    huntWeight: 1.3, // slightly below the stalker's 1.4 — it would rather scavenge
    // ⚠⚠ **The most load-bearing number in this file, and it was measured the
    // hard way — three failed sweeps.** At the stalker-ish 0.35 the demo failed
    // its gate outright: **gazelle extinct in 7 of 10 seeds** against a control
    // where they never went extinct at all, and the vulture halved with them.
    //
    // The cause is not that the hyena is too strong a hunter. It is that **a
    // facultative scavenger is not limited by the prey it hunts.** Carrion fed
    // it — 37% of all carrion taken in the world — its population more than
    // doubled on that subsidy, and the subsidised population then hunted. A
    // predator whose numbers do not depend on its prey can eat that prey to
    // extinction without ever going hungry, which is textbook apparent
    // competition and is a genuinely correct thing for this model to produce.
    //
    // So the fix is the one that states what the animal is rather than the one
    // that makes it weaker: **it hunts only when scavenging has failed to feed
    // it.** That is what couples its hunting effort back to its own hunger, and
    // with it the prey base holds. ⚠ Lowering the founding count instead does
    // *not* work and was tried: the population recovers to whatever carrion
    // supports regardless of how many are founded.
    minHungerToHunt: 0.75,
    retreatWeight: 0.5, // gives ground less readily than the default 0.7
  }),
  // ⚠⚠ **Cooperative hunting, and the hyena's first declaration of it**
  // (PREDATOR-PLAN P5). The brief asks that hyenas hunt cooperatively within their
  // clan and says "this can share logic with lions" — and it does, entirely: this
  // one field is what makes `attackersFor`'s capture bonus, `adoptedPrey`'s
  // joining, and P4's approach spread all reach this species. Not a line of engine
  // code was added for it.
  //
  // ⚠ **Deliberately absent until now, and the reason it was is worth keeping.**
  // Phase 7's note said tuning a cooperation term against a 30 kg gazelle a single
  // hyena takes solo "would fit a parameter to the case it was not built for". That
  // held while the hyena hunted only gazelle and wildebeest calves. With zebra and
  // buffalo on the list above and a clan ceiling from P3, there is finally prey
  // this species needs help with, which is the condition phase 7 said to wait for.
  //
  // ⚠ 0.3 against the lion's 0.35 — slightly weaker per animal, because a clan is
  // bigger than a pride and the two should not compound into a certainty; and
  // `maxAttackers: 5` against the config's 3 for the same reason, since the cap is
  // what stops a crowd being a guarantee rather than an advantage.
  hunting: Object.freeze({ cooperationWeight: 0.3, maxAttackers: 5 }),
  // Which *individuals* it will take on (§3.6). ⚠ The first species to state
  // these at all — every other ships the config's `null`, meaning no bound.
  predation: Object.freeze({
    // A solo hyena takes prey up to about its own mass. At 60 kg that is every
    // gazelle in the world, so this bounds nothing today — and that is
    // deliberate: it is the honest statement of the animal, and it starts
    // biting the moment batch 2 puts a 600 kg buffalo in front of it, without
    // anyone having to remember to come back and add it.
    maxPreyMassRatio: 1.0,
    // ⚠⚠ **What a clan will take on that a single hyena will not** (PREDATOR-PLAN
    // P3, closing **A59**). Four clanmates inside the herd radius raise the
    // ceiling from 60 kg to 300 kg — an adult zebra, a subadult buffalo, a grown
    // wildebeest — which is the brief's "larger groups of hyenas should be more
    // willing to hunt larger prey" stated as the two numbers it actually is.
    //
    // ⚠⚠ **Two, and the plan said four — which measurement showed would have been
    // dead code.** `bandmates` counts clanmates inside `social.groupRadius` (6),
    // and a clan of ten does not stand within six units of itself: measured over
    // 2 seeds × 1500 ticks at a mature world, an adult hyena has **≥1 clanmate in
    // 67% of its ticks, ≥2 in 28%, ≥3 in 9%, and ≥4 in 1%**. A threshold of 4
    // would have shipped a number that never fires, which is D43 exactly — six
    // consecutive phases shipping a weight that could have been deleted with the
    // suite still green.
    //
    // ⚠ **The honest cost of 2: this is "a pair or more", not "a clan".** The
    // brief asks that *larger* groups take larger prey, and what the engine can
    // currently see is company within one social radius. The lever if that is too
    // weak is `behavior.herdRadius` — the wildebeest and buffalo declare 11
    // against the config's 6 — but widening it also moves the herd centroid this
    // animal steers at, which is a movement change and not this phase's.
    //
    // ⚠ 5.0 = 300 kg, and it is **not** inert against today's prey list: the solo
    // ceiling of 60 kg admits only wildebeest *calves*, so this is what puts a
    // grown 200 kg wildebeest in reach of a pair — the brief's own example. It
    // stops short of a 600 kg buffalo on purpose; what a clan will *commit* to is
    // this, and the odds it then gets are `hunting.cooperationWeight`'s business.
    groupPreyMassRatio: 5.0,
    backingForLargePrey: 2,
    // Below this a chase costs more than the meal returns.
    //
    // ⚠⚠ **0.08 → 0.03 on 2026-08-07 (PREDATOR-PLAN).** This line used to argue
    // that a 4.8 kg floor "keeps it from bothering with newborn calves, which is
    // ... a real protection for the gazelle's recruitment". Both halves are being
    // given up deliberately: a hyena taking the smallest, easiest animal it can
    // reach is what a hyena does, and protecting a prey species through the
    // predator's floor was tuning the demo rather than stating the animal. 1.8 kg
    // still refuses a newborn of its own kind (1.5 kg) and a vulture (6 kg) is
    // above it either way.
    //
    // ⚠ The recruitment pressure this removes is real and is why the gazelle is a
    // species to watch in the next sweep, alongside `behavior.minHungerToHunt`
    // below — which is the number that actually limits this animal.
    minPreyMassRatio: 0.03,
  }),
  // Migration (Step 26). Tracks no forage — grass is not food — and follows prey
  // and carrion through perception, exactly as the stalker and vulture do. It
  // tracks water for the same reason both of them do. Its dispersal is the
  // longest in the world: a young hyena leaving its natal clan has to cross
  // other clans' ranges before it finds unattached animals of its own, and
  // `groups.leavingSex: 'male'` is what makes that departure sex-biased and the
  // clan female-cored.
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 0, dispersalTicks: 800 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
