/**
 * The plains zebra (PLAN-SPECIES.md phase 13, batch 3) — the top of the grazing
 * succession, and the first **herbivore** to carry a persistent group.
 *
 * It arrives with the wildebeest because the two are a competitive pair: 200 kg
 * and 300 kg, both open-plain grazers, both water-dependent, both following the
 * same grass. Two species that eat the same food at the same rate in the same
 * places do not coexist (§2), so what separates them has to be real and has to be
 * expressible. Three things are, and they are the whole file:
 *
 * - ⚠ **It eats the grass the others cannot.** `forage.preferredBiomass: 9`
 *   against the wildebeest's 5 and the gazelle's 3 — a hindgut fermenter that
 *   processes bulk, so the tall coarse sward is food to it and a discount to
 *   everything else (§3.3). ⚠ The falloff is one-sided, so a high number means
 *   "almost nothing is rank to me" rather than "I seek out rank grass": it is
 *   tolerance, and the succession works because its grazing *creates* the shorter
 *   sward the wildebeest wants behind it.
 * - ⚠⚠ **It has a society, not an aggregation** (§3.8). `groups.forms: true`
 *   makes this the third species on the persistent registry — after the hyena's
 *   clan and the lion's pride — and the **first prey animal** on it. A wildebeest
 *   herd is a label that reforms wherever bodies are; a zebra band is an identity
 *   that survives the animals walking apart, which is the distinction the two
 *   sociality mechanisms exist to draw, now visible in one world between two
 *   species standing in the same field.
 * - **It must drink.** `dehydrationRate` second only to the buffalo's, which with
 *   `tracksWater` ties it to the lake in a way the wildebeest is not tied.
 *
 * ⚠ **What shipped is a band, not a harem, and §10.3 asks for that to be stated
 * rather than glossed.** The registry has *one* founding rule — two unattached
 * conspecifics meet, offspring inherit their guardian's membership, and the sex
 * named by `groups.leavingSex` leaves at dispersal. Against a real zebra society
 * that gives the persistent, female-cored, male-dispersing half **exactly**, and
 * gives none of: a resident stallion (there is no rank in this world at all —
 * standing is derived, never stored, DOCS §9), bachelor groups (a disperser is
 * unattached, not a member of a second kind of group), or bands merging into a
 * super-herd without losing identity (records never merge, by design). A second
 * founding rule over the same store is the honest way to add those, and nothing
 * has asked for it.
 */
export const herbivoreZebra = Object.freeze({
  id: 'herbivore.zebra',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 300, // kg (adult) — 10× the reference animal, half the buffalo
  baseSpeed: 1.25, // the fastest thing over 100 kg in this world: a zebra outruns
  // a lion over distance, which is why it is not the pride's easiest meal
  // 560 ≈ 100 × 10^0.75 — the tank scales as the burn does (see the buffalo file
  // for the phase-11 measurement that made this a rule rather than a trend).
  maxEnergy: 560,
  maxHealth: 180,
  maxHydration: 120,
  maxStamina: 140, // the largest sprint budget in the roster, and the species
  // fact behind it: a zebra's defence is that it keeps going
  perception: Object.freeze({ radius: 8 }), // high vigilance, the sharpest eyes
  // among the grazers — which is also what makes it worth standing next to (§3.16)
  comfortMin: -3,
  comfortMax: 28,
  aging: Object.freeze({
    birthMass: 30, // kg — a foal is born the size of an adult gazelle
    juvenileUntil: 700, // mobile within an hour of birth, but a longer dependency
    // than the wildebeest's: a foal stays with its mother's band
    maturityAge: 2600,
    subadultUntil: 2600,
    adultUntil: 10000,
    maxAge: 14000, // compressed (§11.6), ordering kept, ratios given up
  }),
  // Cheap to run for its mass — a hindgut fermenter's economics, and the other
  // half of why coarse grass is a living for it.
  metabolism: Object.freeze({ basalRate: 0.036, moveCostFactor: 0.017 }),
  hydration: Object.freeze({ dehydrationRate: 0.048, drinkRate: 7 }),
  matePreference: Object.freeze({ trait: 'size', span: 0.25, conditionWeight: 0.45 }),
  // Slow, as a 300 kg animal is, and slower than the wildebeest beside it — which
  // is one of the two things that keeps the pair from being the same animal on the
  // demographic axis (the other is the calving season the wildebeest has and this
  // species deliberately does not).
  reproduction: Object.freeze({ gestationTicks: 1900, cooldownTicks: 2500 }),
  territory: Object.freeze({ defends: false, rangeRadius: 22, settleTicks: 1100 }),
  // ⚠⚠ **The band** — see the header for exactly which half of a zebra society
  // this is and which half it is not. World-level machinery (`joinRadius`,
  // `maxMembers`, `leavingSex: 'male'`) lives in `config.groups`; a species only
  // says whether it takes part.
  groups: Object.freeze({ forms: true }),
  // Founders are packed into clusters of this size in roster order
  // (`config.cohorts`) — on `default-small`'s 50 zebra, six bands of eight and a
  // pair (2026-08-07; the line read "two bands of eight" until then, which
  // described the 222-animal world). The size is `config.groups.maxMembers` on
  // purpose: a founding cluster larger than the cap would place animals together
  // that the registry then refuses to enrol, which reads as a bug in the registry
  // rather than as the arithmetic it is.
  // ⚠ The spread is tighter than any herbivore that only aggregates, because a
  // *record* is founded from two animals within `groups.joinRadius` (6) with no
  // hop chaining — unlike the herd label, which crosses a loose group in hops.
  // Mean pair separation inside a radius-4 disc is ~3.6, so a band founds on the
  // first tick instead of waiting for its members to drift into each other.
  cohort: Object.freeze({ groupSize: 8, spread: 4 }),
  migration: Object.freeze({ tracksForage: true, tracksWater: true, cueRadius: 20, dispersalTicks: 600 }),
  // ⚠ **The top tier** (§3.3): tolerant of nearly everything standing. Above the
  // buffalo's 8, which is the other bulk feeder — the two are not separated on this
  // axis and are not meant to be; what separates them is water, mobbing, and 300 kg.
  forage: Object.freeze({ preferredBiomass: 9, span: 5 }),
  // Open plain and water, in that order.
  // ⚠ `dry_bed` at 1.2, matching its weight for water: the coarse-grass grazer at
  // the front of the succession, and a drained bed is where the regrowth is.
  habitat: Object.freeze({ ground: 1.15, cover: 0.75, water: 1.2, thicket: 0.3, dry_bed: 1.2 }),
  // ⚠ **Dry, but the mildest of the three** (2026-08-09; see `habitat/habitat.js`).
  // 0.8 against the gazelle's and wildebeest's 0.7, for the reason the header
  // above already gives: this is the bulk feeder of the plains
  // (`forage.preferredBiomass: 9`), so the tall sward that grows on damp ground is
  // the one thing in the wetland it can actually use. ⚠ It is still **below 1**,
  // and deliberately, because the file's own line — "what separates the zebra from
  // the buffalo is water, mobbing, and 300 kg" — was until now carried entirely by
  // the other two. This is the water half finally being said in data.
  wetPreference: 0.8,
  behavior: Object.freeze({
    // Tighter than the wildebeest's, because a band is a small thing that stays
    // together — and because `groups.joinRadius` is 6, so a band whose members
    // graze further apart than that cannot recruit or hold itself.
    herdWeight: 1.15,
    herdDistance: 2.0,
    thirstWeight: 1.25,
    defendRange: 5.5,
    // ⚠⚠ **The band finally drives behaviour** (BEHAVIOR-PLAN P2), and until this
    // pair of numbers it did not. The record said who belonged together and
    // *nothing read it* except carcass possession and cooperative hunting, so a
    // zebra did not prefer its bandmates, did not steer at a band centre, and two
    // bands that met became one aggregation while their rosters stayed separate.
    // These two numbers are the whole fix: a bandmate is worth two and a half
    // bodies when this animal works out where its herd is, an unfamiliar zebra
    // about a third of one.
    //
    // ⚠ 0.35 rather than 0 so a bandless zebra — a disperser, or the survivor of a
    // dissolved record — still has something to aggregate with. It is a discount,
    // not a blindfold. And it cannot be a *push*: a weighted mean of positions has
    // no way to repel, so what this produces is two bands drawn to two different
    // points, which is separation as a consequence rather than as a rule
    // (`social/banding.js`).
    sameBandWeight: 2.5,
    otherBandWeight: 0.35,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
