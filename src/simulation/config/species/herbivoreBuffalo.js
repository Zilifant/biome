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
 * **Not stated, deliberately:** persistent groups. Buffalo herds are fission–fusion
 * — they merge and split with who happens to be standing where — which is exactly
 * what the *herd label* models and exactly what a group record does not (§3.8). It
 * shares that answer with the gazelle and differs from the lion and the hyena, so
 * the two sociality mechanisms now run side by side across four species.
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
  // ⚠ Fission–fusion, so the **label**, not the record (§3.8). See the header.
  groups: Object.freeze({ forms: false }),
  // Three herds of twelve (`config.cohorts`). ⚠ The count was already a
  // *density* rather than an appetite — 35 was chosen because `mobbing`
  // needs `minMobbers` adults within six units of the animal under attack, and
  // twenty buffalo reached zero mobbed captures. Founding them in herds is the
  // same argument applied to tick 0: a mob cannot form out of a scatter.
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
  forage: Object.freeze({ preferredBiomass: 8, span: 4 }),
  // Water-associated open-country grazer. ⚠ It acts through the long-range cue,
  // which this species has because it already carries a `cueRadius` for forage
  // (§3.4) — the reason three of the four earlier species could declare nothing.
  habitat: Object.freeze({ ground: 1.1, water: 1.35, cover: 0.9, thicket: 0.4 }),
  behavior: Object.freeze({
    // ⚠⚠ **The whole point of this species, and the first declaration of it in the
    // world** (A33, phase 10). Above `fleeWeight` below, or the animal would
    // simply run and the mechanism would never fire — mobbing competes with
    // fleeing, which is what makes it safe to have at all (it never competes with
    // foraging). It only fires when a perceived predator has *committed* to a
    // herdmate and `mobbing.minMobbers` adults are standing nearby, so a grazing
    // herd nobody is hunting behaves exactly as a gazelle herd does.
    mobWeight: 2.4,
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
    // Water is the need this animal organizes its life around.
    thirstWeight: 1.35,
    // A big animal reaches further to put itself between a predator and a calf.
    defendRange: 6.0,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
