/**
 * The African buffalo (PLAN-SPECIES.md phase 11, batch 2) — the first animal in
 * this world that **fights back**, and the first heavy one.
 *
 * ⚠ **It is the species phase 10's mobbing was built for**, and until it arrived
 * that mechanism was a schema with nothing declaring it (DOCS A33). A buffalo
 * without mobbing is, in the source analysis's words, "a gazelle that weighs
 * twenty times as much": same flight response, same passive shielding, just more
 * meat. `behavior.mobWeight` above `fleeWeight` is what makes it a different
 * animal — adults turn on a predator that has committed to a herdmate instead of
 * running, and the lion pays for the attempt in `trampleChance`.
 *
 * Three other things follow from 600 kg, and each is a number below rather than
 * an engine change (PLAN-SPECIES §4, the mass audit done in advance at phase 1):
 *
 * - ⚠ **Metabolism, intake, and *thermal cost* all scale themselves**, and that is
 *   what caught the first draft out. All three read
 *   `(bodyMass / referenceMass) ** 0.75`, so this animal burns and eats ~9.5× the
 *   gazelle's rate without stating either — which means the two numbers it must
 *   state are a **tank sized on the same exponent** and a **comfort band widened
 *   for its bulk**. Both are below, both with the measurement that forced them.
 * - **A flat wound is a scratch on a heavy animal**, and that is expressible
 *   rather than missing: `injury.healthDamage` is 60 for everyone, and `maxHealth`
 *   is per-species, so 60 against this animal's 260 is what "low adult predation
 *   vulnerability" means here.
 * - ⚠ **It is a walking carrion subsidy.** 600 kg at `edibleMassFraction: 0.6` is
 *   **360 edible mass**, twenty times a gazelle's 18, and `carcass.decayTicks` is
 *   flat (DOCS B7) so it lies there on a 6 kg animal's clock. Phase 7's failure
 *   mode — a scavenger population fed by carrion hunting a prey species to
 *   extinction — is the one to watch, and it is why the lion's `minHungerToHunt`
 *   is high and why this batch was swept before its counts went above zero.
 *
 * ⚠⚠ **This file used to say "Not stated, deliberately: persistent groups", and
 * that is reversed as of 2026-08-05 (BEHAVIOR-PLAN P5c).** The old paragraph
 * argued that buffalo herds are fission–fusion — they merge and split with who
 * happens to be standing where — which is what the *herd label* models and what a
 * group record does not (§3.8). ⚠ That argument is **still true and is not
 * withdrawn**; it was simply answering the wrong question. Rewritten rather than
 * deleted, on the precedent `GroupRegistry.js` sets for overriding a documented
 * decision of this codebase's own.
 *
 * **A buffalo herd is both things at once, and they are different sizes.** The
 * fission–fusion aggregation is the herd — hundreds in the field, dozens here, and
 * it genuinely is whoever is standing there. Inside it sits a **cow–calf core**
 * that does *not* dissolve when the herd splits: related females and their
 * dependent young, with the bulls leaving at maturity. The label cannot express the
 * core (it is positional, so it is gone the moment the herd tears) and the record
 * cannot express the herd (it never merges, by design). So this species declares
 * **both**, and it is the first in the roster to do so — `groups.forms: true`
 * below for the core, the label around it as before.
 *
 * ⚠ It costs no new mechanism whatsoever. `leavingSex: 'male'` is the config
 * default, `inheritFromGuardian` puts a calf in its guardian's record, and the
 * guardian is the parent that gestated (DOCS §9 Reproduction) — so matrilineal
 * descent falls out with no sex conditional anywhere in `src/simulation`.
 */
export const herbivoreBuffalo = Object.freeze({
  id: 'herbivore.buffalo',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 600, // kg (adult) — 20× the reference animal, and the mass the whole
  // §4 audit was written in advance for
  baseSpeed: 1.0, // slower than everything that hunts it: it does not outrun a
  // lion and is not built to
  // ⚠⚠ **Sized on the burn rate, not on the roster's eyeballed trend, and the
  // first draft got this wrong.** Every energy cost in the engine — basal,
  // movement, and *thermal* — is multiplied by `(bodyMass/30) ** 0.75`, which is
  // 9.5× here. The existing roster's tanks fit ~mass^0.34 (vulture 60 → gazelle
  // 100 → stalker 120 → hyena 130), a trend nobody ever had to defend because the
  // whole roster lived inside one order of magnitude. Extended to 600 kg it makes
  // a buffalo starve **3.4× faster** than a gazelle, which is backwards: a large
  // animal survives famine *longer*. Measured before the fix, 2 seeds × 6000
  // ticks: **exposure was the leading cause of buffalo death** (11 of 21), the
  // largest animal in the world burning out against the weather.
  //
  // 950 ≈ 100 × 20^0.75, i.e. the tank scales exactly as the burn does, which
  // makes time-to-starve and time-to-fill **mass-independent** — the honest
  // statement for an engine tuned in a 4–45 kg band and now spanning 100×. (The
  // stalker's 120 already sits within 12% of that rule; the hyena and vulture do
  // not, and are left alone rather than re-tuned under a species change.)
  maxEnergy: 950,
  maxHealth: 260, // where "low adult predation vulnerability" actually lives: a
  // flat 60-point wound is 23% of this and 60% of a gazelle
  maxHydration: 120,
  maxStamina: 110, // it keeps going, but see `baseSpeed` — endurance is not escape
  // Poor eyes, but a big animal sees over the grass. Barely above the gazelle's 6.
  perception: Object.freeze({ radius: 7 }),
  // ⚠ **Wider on the cold side than anything else in the roster, and the first
  // draft had it narrower — which was backwards and measured so.** Thermal cost
  // is `thermalCostFactor × stress × (bodyMass/30)^0.75`, so a 600 kg animal pays
  // **9.5×** a gazelle's energy for every degree it is out of band. Bulk is
  // exactly what buys a large animal its cold tolerance (surface area grows more
  // slowly than volume), so the band has to widen as the mass rises or the
  // engine's own scaling turns the largest animal in the world into the one the
  // weather kills. Measured at 0/26 over 5 seeds × 15 000 ticks: **exposure was a
  // third of all buffalo deaths** (73 of 220), second only to predation.
  comfortMin: -5,
  comfortMax: 28,
  aging: Object.freeze({
    birthMass: 40, // kg — a calf is already the size of an adult gazelle
    maturityAge: 3000, // slow to grow into a very large body
    juvenileUntil: 900, // and a long dependency, which is what makes calves the
    // thing a herd has to defend
    subadultUntil: 3000,
    adultUntil: 11000,
    // ⚠ Compressed on purpose (§11.6): the life-history *ordering* is real
    // (buffalo outlive gazelle), the *ratio* is not. A biologically faithful
    // lifespan would put no buffalo generation inside a 15 000-tick sweep, and
    // the gate would then measure nothing about this species at all.
    maxAge: 16000,
  }),
  // Cheap to run for its mass — a grazer's economics, and the reason a herd can
  // cover ground between water and pasture.
  metabolism: Object.freeze({ basalRate: 0.038, moveCostFactor: 0.018 }),
  // ⚠ **The defining physiology, and it is one number.** A buffalo is tied to
  // water: it dries out half again as fast as a gazelle, which — with
  // `tracksWater` and a raised `thirstWeight` — is what makes the lake a place it
  // has to keep coming back to rather than a convenience.
  hydration: Object.freeze({ dehydrationRate: 0.05, drinkRate: 7 }),
  // Bulls compete on size and condition, as they do in life; the females choose.
  matePreference: Object.freeze({ trait: 'size', span: 0.25, conditionWeight: 0.5 }),
  // ⚠ **Slow, and it has to be**: one calf at long intervals is what a large
  // herbivore does, and it is also the demo's main risk in this batch — a
  // slow-breeding prey species under a new predator is how a population goes to
  // zero between checkpoints. Swept before the count went above zero.
  reproduction: Object.freeze({ gestationTicks: 1800, cooldownTicks: 2600 }),
  // A home range without exclusivity, like the gazelle: herds overlap freely.
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 1200 }),
  // ⚠⚠ **Both, since 2026-08-05 (BEHAVIOR-PLAN P5c), and the header above says why
  // this reverses what this file used to state.** The record is the **cow–calf
  // core**; the label around it is still the fission–fusion herd.
  //
  // It needs no new machinery at all, which is the whole reason it is affordable:
  // `leavingSex: 'male'` is already the config default, `inheritFromGuardian` puts
  // a calf in its guardian's record, and the guardian is the parent that gestated —
  // so descent is matrilineal with **no sex conditional anywhere**, and the bulls
  // walk out at dispersal because that rule already exists.
  //
  // ⚠ `maxMembers: 16` against the config's 8, matched to `cohort.groupSize: 12`
  // below. A founding herd of twelve placed inside `joinRadius` of each other would
  // otherwise enrol eight and leave four to found a second record on tick 1 — which
  // reads as the registry splitting a herd it never held. 16 leaves room for the
  // calves that arrive later without being so large that one record swallows a
  // third of the species.
  //
  // ⚠ **A bachelor bull is not modelled as an identity** (P6, skipped 2026-08-05).
  // A dispersed bull leaves the cow record and is thereafter an ordinary unattached
  // animal that the label keeps loosely with the local buffalo — which is what a
  // bachelor looks like from a distance, and is all this world claims.
  groups: Object.freeze({ forms: true, maxMembers: 16 }),
  // Founders are packed into clusters of this size in roster order
  // (`config.cohorts`) — on `default-small`'s 50 buffalo, four herds of twelve and
  // a pair (2026-08-07; the line read "three herds of twelve" until then, which
  // described the 222-animal world's 35). ⚠ The count was already a *density*
  // rather than an appetite — 35 was chosen because `mobbing` needs `minMobbers`
  // adults within six units of the animal under attack, and twenty buffalo reached
  // zero mobbed captures. Founding them in herds is the same argument applied to
  // tick 0: a mob cannot form out of a scatter.
  cohort: Object.freeze({ groupSize: 12, spread: 5 }),
  // Follows the grass and, more than anything else in this world, the water.
  migration: Object.freeze({ tracksForage: true, tracksWater: true, cueRadius: 18, dispersalTicks: 500 }),
  // ⚠ **Tolerance of coarse growth, not a taste for it** (§3.3). The falloff is
  // one-sided, so a high `preferredBiomass` means "nearly everything suits me" —
  // a bulk feeder that can live on rank sward the gazelle discounts. What keeps it
  // *off* a cropped lawn is not a preference but mass-scaled intake: a 600 kg
  // animal cannot make a living on cells that hold two biomass.
  //
  // ⚠ This is the middle tier by accident rather than by design — the succession
  // is a three-way one (zebra → wildebeest → gazelle) and both of those arrive in
  // batch 3, where this number is re-tuned alongside the gazelle's.
  //
  // ⚠⚠ **8 → 13 when the wetland arrived (2026-08-09), and this is a correction
  // rather than a re-tune.** Wet ground now carries a 1.6× ceiling, so marsh cover
  // stands at up to 8 × 1.35 × 1.6 ≈ **17 biomass** where the dry plain tops out
  // near 8. At the old 8 the one-sided falloff put the tall wet sward at the
  // quality *floor* — the buffalo would have been pushed into the marsh by its
  // habitat preference and then discounted every cell it found there, which is the
  // two-halves-disagreeing failure the forage module's own history is made of. 13
  // with a span of 6 says what a 600 kg bulk grazer means: nothing standing in this
  // world is too rank to live on. ⚠ It also makes the tall wet sward *effectively
  // buffalo-only* food, because the other three keep the numbers they were tuned
  // with (3 / 5 / 9) and all three bottom out well below 17 — which is the
  // separation this whole wetland split exists to create, arriving through the
  // succession that was already there rather than through a new mechanism.
  forage: Object.freeze({ preferredBiomass: 13, span: 6 }),
  // Water-associated open-country grazer. ⚠ It acts through the long-range cue,
  // which this species has because it already carries a `cueRadius` for forage
  // (§3.4) — the reason three of the four earlier species could declare nothing.
  //
  // ⚠ **`cover` and `thicket` moved up with the marsh** (0.9 → 1.15, 0.4 → 0.6).
  // Those two codes *are* the wetland's tall grass and reed beds
  // (`TERRAIN-PLAN.md` §2), so the old weights — written for a world where cover
  // meant a dry scrub patch — would have had this animal's terrain half fighting
  // its wetness half over the same cells. Thicket stays the lowest weight it
  // states: a buffalo standing in reeds is real, and a buffalo crossing a stand at
  // speed 0.1 is not something to encourage.
  // ⚠ `dry_bed` is the fifth weight and arrived with the dry season (A79, phase
  // D4). An unnamed terrain resolves to a *neutral* 1, so without it this animal's
  // 1.35 for water would silently become indifference the moment its water dried —
  // the same silent-flattening A79 records for `tree`. A water animal follows the
  // water down: 1.15 keeps it drawn to the bed the lake left without pretending a
  // dry pan is a drink.
  habitat: Object.freeze({ ground: 1.1, water: 1.35, cover: 1.15, thicket: 0.6, dry_bed: 1.15 }),
  // ⚠⚠ **The wetland animal of this roster** (2026-08-09). A weight on how *wet*
  // the ground is (`world/wetness.js`, distance to the nearest water), applied
  // through the same long-range cue as the terrain weights above and multiplied
  // into them — see `habitat/habitat.js` for why it is a field beside `habitat`
  // rather than a key inside it.
  //
  // ⚠ **This is a different claim from `water: 1.35`, and the difference is the
  // point.** The terrain weight can only ask to stand *in* the water; a marsh, a
  // lake shore and a stream bank are `ground`, `cover` and `thicket` like anywhere
  // else, and until this field existed nothing in the roster could tell them from
  // the arid plain twenty cells away. `tracksWater: true` cannot either — that is
  // thirst, it falls silent the moment the animal has drunk, and where an animal
  // *lives* is precisely what it chooses when nothing is urgent.
  //
  // 1.5 against the grazers' 0.7–0.8: this is the strongest habitat statement in
  // the roster, because separating the buffalo from the plains grazers is what it
  // is for.
  wetPreference: 1.5,
  behavior: Object.freeze({
    // ⚠⚠ **The whole point of this species, and the first declaration of it in the
    // world** (A33, phase 10). Above `fleeWeight` below, or the animal would
    // simply run and the mechanism would never fire — mobbing competes with
    // fleeing, which is what makes it safe to have at all (it never competes with
    // foraging). It only fires when a perceived predator has *committed* to a
    // herdmate and `mobbing.minMobbers` adults are standing nearby, so a grazing
    // herd nobody is hunting behaves exactly as a gazelle herd does.
    mobWeight: 2.4,
    // ⚠⚠ **And since P9 it presses the attack home rather than only turning to face
    // it.** Mobbing is entirely reactive: a lion that thinks better of the hunt is
    // not driven off, it simply stops being mobbed, and the whole herd goes back to
    // grazing on the same tick. `chargeWeight` buys two things — a defender
    // **sprints** to the animal under attack instead of walking, which is the whole
    // of what 600 kg is worth when every effect of defending is positional; and it
    // keeps `defend` scoring for `pursuitTicks` after the predator has broken
    // contact, steering at where it was last seen.
    //
    // ⚠⚠ **0.9 is pinned between two of this animal's own numbers rather than
    // chosen for feel, and the lower one is a finding.** It must clear
    // `fleeWeight × 0.75` = **0.75**, the urgency of a herdmate's alarm: that
    // product competes with a pursuit *by construction* — an alarm-flee fires
    // exactly when no threat is perceived — and every pursuit begins inside
    // `social.alarmTicks` of the predator that caused it, so a weight below it is an
    // off switch rather than a safety margin. It was 0.7 for an afternoon and the
    // mechanism formed commitments it never once acted on.
    //
    // ⚠ And it sits under **`eat`** for a hungry animal (`eatBias` 0.2 + hunger), so
    // a buffalo above ~70% hunger breaks off and grazes. That is the A34 discipline
    // holding with no threshold anywhere: a pursuit is what a comfortable animal
    // does. ⚠ What it costs is stated in `predation/charge.js` — a pursuing buffalo
    // ignores a *second-hand* alarm for up to `pursuitTicks`, which is consistent
    // with an animal whose `mobWeight` of 2.4 already means it does not run from a
    // lion it can see. A **perceived** threat cancels the pursuit outright.
    chargeWeight: 0.9,
    // ⚠ Half the world's ceiling of 40. A bounded errand — far enough to put a lion
    // outside `defendRange` and give up the ground it was hunting on, nowhere near
    // far enough to walk a herd off its own range.
    pursuitTicks: 20,
    // ⚠ And it is less flighty than a gazelle in the first place: an adult buffalo
    // is not what a predator's presence should scatter. Below the config's 2.0 so
    // that mobbing wins when it applies, and so a lone adult does not bolt from a
    // lion it could stand up to.
    fleeWeight: 1.0,
    // ⚠ **A tight herd is the defense**, and it has to be tighter than a
    // gazelle's rather than looser: mobbing needs `mobbing.minMobbers` adults
    // within six units of the animal under attack, so a herd that grazes four
    // units apart is a herd on paper and a row of lone buffalo in practice.
    herdWeight: 1.1,
    herdDistance: 2.0,
    // ⚠⚠ **A herd wider than six cells** (BEHAVIOR-PLAN P1), and for this species
    // it is the same argument as the tight `herdWeight` above rather than a new
    // one: mobbing is a density mechanism, and a herd whose members are steering
    // at a centre built from only the neighbours inside six cells drifts into
    // subgroups too small to mob. Founding cohorts of twelve at `spread: 5` are
    // what this number has to hold together.
    //
    // ⚠ The centre of mass only. `adults` — which is what `mobbing.minMobbers`
    // and the hunting system's collective vigilance actually count — stays on
    // `social.groupRadius`, so this animal is no harder to catch than it was.
    // That separation is the whole of `social/herding.js`.
    herdRadius: 11,
    // ⚠ **Moderate, against the wildebeest's 1.0** (BEHAVIOR-PLAN P8). A buffalo
    // herd moves as a body between water and pasture, so it wants the shared
    // commitment — but this animal organizes its life around the *lake*
    // (`thirstWeight` below, `dehydrationRate` the highest in the roster), and a
    // herd heading that could outvote an individual's thirst cue at full weight
    // would walk thirsty animals past water. 0.6 lets the herd lean and leaves the
    // individual's own need the louder voice. ⚠ The consensus only bends a
    // `wander`; `drink` and `seekWater` are actions and are untouched by it.
    consensusWeight: 0.6,
    // ⚠ **The matriarch, and it is the species that asked for her** (P8). The
    // record this animal declares above is a **cow–calf core**, and what a cow–calf
    // core is led by is the oldest cow — while `dominanceOf`, which is right for a
    // shoving match, rates a senescent animal *below* a prime adult. This is what
    // `leadershipOf` re-weights, and it is spent in one place: the centre of mass a
    // separated member rallies back toward (`config.groups.leadWeight`). At 0.5 a
    // senescent cow of the same body outranks a prime adult by ~27%.
    //
    // ⚠ **Nothing is stored** — there is no matriarch field, no election, and no
    // record of who led. She is derived from what each animal is right now, which
    // means she changes when she is mauled and comes back when she heals.
    leadAgeWeight: 0.5,
    // Water is the need this animal organizes its life around.
    thirstWeight: 1.35,
    // A big animal reaches further to put itself between a predator and a calf.
    //
    // ⚠⚠ **6.0 → 7.0 on 2026-08-09, and it is the single most effective of the
    // three levers that raised the mobbing rate** (A100). This is the distance at
    // which a *perceived* predator is close enough to turn on, and at 6.0 it sat
    // **below this species' own `perception.radius` of 7** — so there was a ring
    // one unit wide in which a buffalo could see a lion committing to a herdmate
    // and was structurally forbidden from reacting to it. That ring is where a
    // hunt is decided: the decision is taken a tick or more before contact, while
    // the lion is still closing.
    //
    // ⚠ 7.0 rather than higher because `threat` comes from perception, so anything
    // above the perception radius is unreachable by construction — this is the
    // *maximum useful value*, not a tuned one. If the radius ever moves, this
    // should move with it, and the pairing is the point rather than the number.
    defendRange: 7.0,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
