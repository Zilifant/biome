/**
 * The leopard (PLAN-SPECIES.md phase 14, batch 4) — the ambush predator, and the
 * animal §3.12's cover concealment was built for.
 *
 * ⚠ **This species is thirteen phases old.** It was `predator.stalker`, the first
 * predator in the world (Step 16), and it was always this animal in everything but
 * name: its own file said *"a solitary ambush predator holds ground"* and *"solitary
 * and slow to breed, as a top predator at low density must be"*, which is why
 * §11.1 checked it against the lion and found it unconvertible. Phase 14 is that
 * observation cashed in. ⚠ The rename was proved a **no-op first** — 2.36 MB of
 * serialized state across three seeds at 1500 ticks, matching byte for byte with
 * the two id strings normalized away — so everything below is separately
 * attributable from it, exactly as phase 7 split the grazer's rename from the
 * vulture's mass bump.
 *
 * **What makes it a leopard rather than a heavier stalker**, and all of it is data:
 *
 * - ⚠⚠ **It hunts from cover** (§3.12, phase 14). This is the first species to
 *   declare a `habitat` preference *for* cover, and it is the whole point of the
 *   phase: an animal standing in cover is harder to see (`world.concealmentAt`),
 *   so a leopard that chooses cover is a leopard prey does not notice until it is
 *   close. ⚠ **Nothing here is an "ambush" term** — there is no bonus, no
 *   modifier, no new action. The advantage is entirely emergent from *where it
 *   chooses to be* against where its prey chooses to be (the gazelle weights open
 *   ground 1.15 and cover 0.8; this animal is the mirror of that), which is the
 *   shape DOCS §9 Decision has asked for since Step 24: give existing machinery a
 *   reason rather than adding a mechanism.
 * - ⚠ **A cue radius, because a preference with none has nowhere to act** (§3.4).
 *   The stalker's was 0, which would have made the habitat block above decorative.
 *   It is deliberately short — 8, against the gazelle's 18 and the wildebeest's 20
 *   — because a leopard is not looking for a *region*, it is looking for the next
 *   thicket edge, and a wide cue would make it commute across the map.
 * - **Calves, by a mass ratio.** `maxPreyMassRatio: 1.0` on a 60 kg cat admits a
 *   wildebeest calf (born at 18 kg) and refuses its 200 kg mother, with no
 *   life-stage conditional anywhere — the same trick the hyena uses, and what
 *   §10.4 means by "takes gazelle and calves".
 *
 * ⚠ **Vertical refuge stays deferred** (§3.13), and this file is where that
 * decision is visible: a real leopard rests in trees, caches kills above
 * scavengers, and ambushes from height. None of it is here. `african-species.md`
 * concedes that a ground-only leopard is convincing, and the cost is a new entity
 * kind (A3), an elevation dimension threaded through perception, movement, and
 * predation, and a protocol change. What phase 14 buys instead is the *horizontal*
 * half of the same idea — concealment — for one terrain table and one comparison.
 * ⚠ The consequence is a stated limit rather than a hidden one: **this leopard
 * cannot protect a kill from the hyena clan**, and the carcass-possession contest
 * (§3.9) resolves on dominance alone, so it loses kills a real one would keep.
 */
export const predatorLeopard = Object.freeze({
  id: 'predator.leopard',
  kind: 'animal',
  diet: 'carnivore',
  // ⚠ Gazelle, and wildebeest **calves** — see the header. The zebra is left off
  // for the reason the hyena leaves it off: a foal is born at 30 kg and is over a
  // 60 kg cat's ratio within a fraction of its juvenile stage, so listing it buys
  // a handful of ticks of eligibility and a great deal of A58.
  preySpeciesIds: Object.freeze(['herbivore.gazelle', 'herbivore.wildebeest']),
  bodyMass: 60, // kg (adult) — up from the stalker's 45, and the same mass as the
  // hyena, which is the point: the two are separated by *behaviour*, not by size
  baseSpeed: 1.35, // world units per tick; only modestly faster at a walk
  // 168 ≈ 100 × 2^0.75 — the tank scales as the burn does, which is the rule the
  // buffalo established at phase 11 and the reason this moved with the mass. The
  // stalker's 120 was already ~12% under the rule at 45 kg; left at 120 for a 60 kg
  // animal it would have been 29% under, and a predator that eats rarely and in
  // bulk is exactly the animal a small tank punishes.
  maxEnergy: 168,
  maxHealth: 100,
  maxHydration: 100,
  // ⚠ **The ambush physiology**, and the axis that separates it from the hyena at
  // the same mass: 90 against the hyena's 120. A leopard wins in the first few
  // seconds from close range or not at all; a hyena wins by outlasting. With the
  // concealment above, a short sprint budget is not a weakness — it is what makes
  // getting close *matter*.
  maxStamina: 90,
  // Hunts by detection, so it senses much further than its prey. ⚠ Unchanged from
  // the stalker's 12 on purpose: this animal's edge is *not being seen*, and
  // raising its own sight range as well would confound the two at the gate.
  perception: Object.freeze({ radius: 12 }),
  // Bigger and better insulated than its prey, so it tolerates the cold
  // better and the heat worse (Step 19), °C.
  comfortMin: -3,
  comfortMax: 24,
  // §1.4 A17, closed. A predator is born larger, takes longer to reach a bigger
  // adult size, and lives longer than its prey — all of which used to be the
  // gazelle's numbers applied to a different animal.
  aging: Object.freeze({
    birthMass: 8, // kg — a cub, not a calf
    maturityAge: 1400, // slower to grow into a bigger body
    juvenileUntil: 500,
    subadultUntil: 1400,
    adultUntil: 7000, // a longer prime than the gazelle's 6000
    maxAge: 14000,
  }),
  // A predator at rest is expensive (more muscle) but travels cheaply for its
  // mass — the economics that make ambush and long patrols both viable.
  metabolism: Object.freeze({ basalRate: 0.045, moveCostFactor: 0.017 }),
  // Gets much of its water from what it eats, so it dries out more slowly.
  hydration: Object.freeze({ dehydrationRate: 0.028 }),
  // Mate choice (Step 22). A different species, a different display: this animal
  // reads **speed**, the trait its whole living depends on, and weighs it more
  // sharply (a smaller `span`) than gazelle weigh size. Nothing in the code
  // knows which species is which — the preference is read generically from
  // here (see mating/mateChoice.js).
  matePreference: Object.freeze({ trait: 'speed', span: 0.22, conditionWeight: 0.4 }),
  // Solitary and slow to breed, as a top predator at low density must be.
  reproduction: Object.freeze({ gestationTicks: 1000, cooldownTicks: 2400 }),
  // What it will take on. A 60 kg cat commits to prey up to its own mass, which is
  // every gazelle and every wildebeest calf; the floor keeps it off newborns too
  // small to be worth the sprint.
  predation: Object.freeze({ maxPreyMassRatio: 1.0, minPreyMassRatio: 0.08 }),
  // Territory (Step 24). A solitary ambush predator holds ground: it marks,
  // it avoids a rival's marks, and it disputes ground it finds occupied. The
  // range is wide because a predator needs a lot of prey to live off, and it
  // settles slowly because a territory is a claim built over time, not a
  // decision taken once. ⚠ It is also the **only** species in the world that can
  // use `territory.defends` as built — A60 records that a claim is an individual
  // one, so a social species scatters itself with it.
  territory: Object.freeze({ defends: true, rangeRadius: 26, settleTicks: 1400 }),
  // Persistent social groups (PLAN-SPECIES.md §3.8). No — and for this animal it
  // is the whole design: a solitary ambush predator that holds ground against its
  // own kind is the opposite of a pride. This is also the check that kept it from
  // being converted into a social carnivore (§11.1): a species that defends ground
  // from conspecifics cannot also live with them.
  groups: Object.freeze({ forms: false }),
  // ⚠⚠ **No `cohort` block, and the omission is the declaration.** Every other
  // species in the roster is founded in herds, prides, clans or roosts
  // (`config.cohorts`); this one is founded exactly as it always was, one animal
  // per cluster and therefore one animal per anchor, with no offset draw at all.
  // A solitary ambush predator that defends ground against its own kind starting
  // life in a huddle would be the same contradiction `groups.forms: false` above
  // exists to prevent.
  //
  // It is also useful as a measurement: this species is placed by the same
  // *procedure* in both arms, so it is the null control living inside the on arm
  // — the one cohort placement cannot have moved directly, and therefore the one
  // that says whether the rest of the world moved it (§16 D40).
  // ⚠ Same procedure, not the same coordinates: every cohort draws from one
  // shared `worldgen` stream in roster order, so a clustered gazelle cohort
  // ahead of it spends a different number of draws and lands the leopards
  // elsewhere. The distribution is the invariant, and it is what a control
  // needs to be; `test/cohorts.test.js` asserts it as one.
  // Migration (Step 26). It does **not** track forage: its food is the gazelle,
  // and it already follows that through perception and the hunt pipeline — a
  // vegetation gradient would point it at grass it cannot eat. It **does** track
  // water: a predator gets most of its water from what it eats and so rarely needs
  // the lake, but when it does dry out it needs the same long-range steer toward it
  // a gazelle has — without it a cat that spends its life in a corner of the map far
  // from the one lake can dehydrate having never encountered water (measured on a
  // corner-lake seed: the last stalkers died of thirst having never perceived water
  // once). What it also shares is **natal dispersal**, and for a territorial species
  // that is the important half: a young leopard cannot inherit its parent's ground,
  // so it must leave and found its own.
  //
  // ⚠ `cueRadius: 8` is new at phase 14 and is what the `habitat` block below acts
  // through — see the header for why it is short rather than wide.
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 8, dispersalTicks: 700 }),
  // ⚠⚠ **What makes cover work for this animal and for nothing else** (§3.12).
  // `crypsis` scales the terrain's concealment by how well *this* species uses it,
  // and it is 0 for every species that says nothing — a rosetted cat lying still in
  // brush disappears; a herd of wildebeest standing in the same brush is a herd of
  // wildebeest. At 1 against cover's 0.55, a gazelle picks this animal out at 45%
  // of the range it would spot one in the open: 2.7 units against 6.
  //
  // ⚠ It is here rather than symmetric **because symmetric was built first and
  // measured worse** — the leopard population fell 27 → 19, because a mechanism
  // that hides bodies helps whoever is hiding and hurts whoever is searching, and
  // a predator with a perception radius of 12 is mostly searching. See
  // `perception/concealment.js`.
  crypsis: 1,
  // ⚠⚠ **The ambush, expressed as a place rather than as a bonus** (§3.12). Cover
  // and thicket are where this animal wants to be, because that is where it cannot
  // be seen; open ground is where its prey is, so it is discounted rather than
  // refused. Thicket is *above* cover here and nowhere else in the roster — every
  // other species treats a dense stand as something to be avoided at 0.3–0.4, and
  // this is the one animal for which it is home.
  // ⚠ `tree: 1.5` joined on 2026-08-03 (phase T3). It sits just under cover,
  // because what a leopard wants a tree for is not concealment — a scattered
  // canopy conceals *less* than brush (0.4 against 0.55) — it is the larder and
  // the refuge above it. This is also the first entry any species has made for
  // the tree terrain, and it is half the fix for the artifact phase T1 measured:
  // every herbivore weights `ground` at 1.1–1.2 and names no tree, so converting
  // open ground to trees quietly shrank the preferred habitat of every grazer.
  // ⚠ The *other* half — giving the herbivores a tree weight — is deliberately
  // not in this phase: it would move four species' habitat in the same gate that
  // is measuring one predator's new behaviour, and neither result would be
  // attributable (A12).
  habitat: Object.freeze({ cover: 1.6, tree: 1.5, thicket: 1.25, ground: 0.85, water: 0.9 }),
  // ⚠⚠ **Vertical refuge, thirteen phases after the file said it was deferred**
  // (A67, phases T1–T3). The header below still describes the deferral; this is
  // what replaced it, and the two halves are worth separating because only one
  // of them does any work:
  //
  //   - **Resting above competitors is fidelity, and mechanically near-inert.**
  //     A resting or sheltering leopard standing under a tree is in it, with no
  //     new code at all — `rest` already existed and `elevationFor` does the
  //     rest. But *nothing hunts a leopard*: no species lists it in
  //     `preySpeciesIds`, so being out of reach is being out of reach of
  //     something that was never coming. It is visible, correct, and not a
  //     survival mechanism. ⚠ This is also why the plan's **flee-toward-a-tree
  //     heading rule was dropped rather than built**: `flee` fires from a
  //     perceived threat or a conspecific's alarm, and a leopard can have
  //     neither, so the rule would have been provably unreachable — A34's shape,
  //     caught before shipping instead of after.
  //   - ⚠ **Caching a kill is the half that does the work**, and it closes the
  //     limitation the header states outright: *"this leopard cannot protect a
  //     kill from the hyena clan, and the carcass-possession contest resolves on
  //     dominance alone, so it loses kills a real one would keep."* A carcass in
  //     the canopy feeds climbers and nobody else.
  climbs: true,
  behavior: Object.freeze({
    // Sized against `eat` rather than against the other behaviour weights, since
    // that is the only action it ever competes with: `eat` scores
    // `0.2 + hunger`, this scores `1.2 × (1 − hunger)`. They cross at hunger
    // ≈ 0.45 — so a leopard that has just made a kill on a comfortable stomach
    // hauls it to a tree first, and one that hunted because it was starving eats
    // where it stands. ⚠ Below `fleeWeight` (2.0) and `defendWeight` (2.6) at
    // every hunger, so a cat under threat drops the kill.
    cacheWeight: 1.2,
  }),
  // ⚠ **`chaseRange` is deliberately still absent from the block above, and one
  // experiment is why.** Concealment costs this animal completed hunts — prey
  // that never sees it never *flees*, and a fleeing target is what used to force
  // the sprint (`chasing = … || prey.fleeing`), so a stalk converts to a chase
  // more slowly. Raising `chaseRange` 4 → 6 to commit sooner is the obvious
  // compensation; measured over 3 seeds × 15 000 ticks it was **worse** (2/3
  // seeds, mean 7.0, against 10/10 and 8.2 at the default). Left at the config
  // default and recorded rather than tuned around. _(This note read "no
  // `behavior` block" until phase T3 gave the species one for `cacheWeight`; the
  // measurement it records is unchanged.)_

  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
