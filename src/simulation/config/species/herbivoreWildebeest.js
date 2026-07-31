/**
 * The blue wildebeest (PLAN-SPECIES.md phase 13, batch 3) — the middle tier of
 * the grazing succession, and the first animal in this world with a **calendar**.
 *
 * ⚠ **It is the species phase 12's breeding window was built for**, exactly as the
 * buffalo was the species mobbing was built for. Until now every animal in this
 * world bred whenever it was fed and off cooldown, which is honest for a gazelle
 * and wrong for this one: a wildebeest's defining life-history fact is a
 * compressed rut followed by a calving season, and what that buys is
 * **predator swamping** — a year's calves arriving inside a few hundred ticks,
 * more of them at once than the predators can eat while they are vulnerable.
 *
 * ⚠⚠ **Birth synchrony is not declared anywhere below.** It emerges:
 * `reproduction.breedingWindow` compresses conception, `gestationTicks` is
 * constant, and a constant offset from a compressed window is a compressed window.
 * That is the whole of §3.11, and it is why the calving season costs two numbers.
 *
 * Three other things make it a different animal from the buffalo it most
 * resembles on paper, and all three are data:
 *
 * - **The middle of the succession** (§3.3). `forage.preferredBiomass: 5` sits
 *   between the gazelle's 3 and the zebra's 9 — it takes the regrowth behind the
 *   zebra and leaves the short flush to the gazelle. ⚠ The falloff is one-sided,
 *   so this is *tolerance of coarse growth*, not a taste for it; what keeps a
 *   200 kg animal off a cropped lawn is mass-scaled intake, not a preference.
 * - **It goes where the grass is.** The strongest `migration.cueRadius` in the
 *   roster (20), because forage tracking is the whole of what a wildebeest does
 *   with its year. ⚠ This is the expensive field in the file: the buffalo's cue
 *   is what phase 11 measured as **+5.7% per animal**, and this species carries a
 *   wider one.
 * - **A herd label, not a group record** (§3.8). Wildebeest aggregations are
 *   fission–fusion — they merge and tear apart with who is standing where — which
 *   is what the label models. ⚠ The **zebra** arriving beside it is the opposite
 *   case, and the two shipping together is what makes the distinction visible in
 *   one world.
 *
 * ⚠ **What it is not:** the Great Migration. The source analysis is explicit that
 * a landscape-scale circuit needs a forage gradient far larger than local
 * perception and a commitment mechanism this engine does not have; what is here is
 * a *plausible locally-migratory* wildebeest, which is the honest approximation and
 * is recorded as one rather than claimed as the real thing.
 */
export const herbivoreWildebeest = Object.freeze({
  id: 'herbivore.wildebeest',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 200, // kg (adult) — 6.7× the reference animal
  baseSpeed: 1.15, // between the gazelle's 1.2 and the buffalo's 1.0: it does not
  // sprint away from a lion, it walks away from a drought
  // 415 ≈ 100 × 6.67^0.75. The tank scales exactly as the burn does — every energy
  // cost is multiplied by `(bodyMass/30)^0.75` — which is the rule the buffalo file
  // had to derive the hard way at phase 11 (its first draft starved 3.4× faster
  // than a gazelle and died mostly of exposure). Applied up front here.
  maxEnergy: 415,
  maxHealth: 150, // a flat 60-point wound is 40% of this against the buffalo's 23%
  maxHydration: 110,
  maxStamina: 130, // endurance rather than speed, and more of it than anything
  // heavier: this is the animal that covers ground
  perception: Object.freeze({ radius: 7 }),
  // Band widened for bulk, on the rule the buffalo established: thermal cost is
  // multiplied by `(bodyMass/30)^0.75`, so a 200 kg animal pays 4.15× a gazelle's
  // energy per degree out of band and needs the band that its bulk actually buys.
  // Between the gazelle's 2…27 and the buffalo's −5…28.
  comfortMin: -2,
  comfortMax: 27,
  aging: Object.freeze({
    birthMass: 18, // kg — a calf is over half a grown gazelle
    // ⚠ **Fast development is the other half of predator swamping.** A wildebeest
    // calf runs with the herd within minutes of birth, and the shortest juvenile
    // stage of any large grazer here (900 for the buffalo) is how that is said.
    juvenileUntil: 500,
    maturityAge: 2200,
    subadultUntil: 2200,
    adultUntil: 9000,
    // Compressed (§11.6): the ordering is real — gazelle < wildebeest < buffalo —
    // and the ratios are given up so every species stays measurable in a
    // 15 000-tick sweep.
    maxAge: 13000,
  }),
  metabolism: Object.freeze({ basalRate: 0.04, moveCostFactor: 0.019 }),
  // Moderate-to-high: it must drink, but it is not tied to the lake the way the
  // buffalo is (0.05). With `tracksWater` this is what keeps a herd's circuit
  // running between pasture and water rather than sitting on one or the other.
  hydration: Object.freeze({ dehydrationRate: 0.042, drinkRate: 6 }),
  matePreference: Object.freeze({ trait: 'size', span: 0.25, conditionWeight: 0.45 }),
  reproduction: Object.freeze({
    gestationTicks: 1400, // 0.175 of a year, so the calving season lands that far
    // after the rut and nothing has to say where it is
    cooldownTicks: 2200,
    // ⚠⚠ **The first breeding window declared in this world** (§3.11, phase 12).
    // Fractions of the year, half-open, and this one does not wrap: conception
    // runs from early spring to the start of summer, which puts calving in late
    // spring through midsummer — `SEASON_GROWTH` peaks in spring (1.35) and
    // capacity in summer (1.0), so calves grow through the two seasons that have
    // the grass in them and are subadult before winter.
    //
    // ⚠ **Wide on purpose, and it is the number to loosen first if recruitment
    // fails.** 0.30 of the year is 2400 ticks — §3.11's warning is that a species
    // missing one window loses a *year*, and a 15 000-tick sweep contains only two
    // windows, so a narrow rut is a knife edge under a gate that cannot see it.
    breedingWindow: Object.freeze({ startFraction: 0.85, endFraction: 0.5 }),
  }),
  territory: Object.freeze({ defends: false, rangeRadius: 22, settleTicks: 1000 }),
  // ⚠ **The label, not the record**, and the deliberate contrast with the zebra
  // beside it (§3.8). A wildebeest aggregation is who happens to be standing here.
  groups: Object.freeze({ forms: false }),
  // The strongest long-range cue in the roster: this animal's whole strategy is
  // going where the grass is, and `cueRadius` is the only way this engine has of
  // saying so (§3.4 — a preference with no cue radius has nowhere to act).
  migration: Object.freeze({ tracksForage: true, tracksWater: true, cueRadius: 20, dispersalTicks: 450 }),
  // ⚠ **The middle tier** (§3.3): 5 against the gazelle's 3 and the zebra's 9. It
  // takes the regrowth behind the coarse feeders and leaves the flush to the
  // gazelle, and the whole succession is those three numbers.
  forage: Object.freeze({ preferredBiomass: 5, span: 4 }),
  // Open plain, more strongly than the gazelle: this is a species of the short-grass
  // plains and it wants nothing to do with cover.
  habitat: Object.freeze({ ground: 1.2, cover: 0.7, water: 1.05, thicket: 0.3 }),
  behavior: Object.freeze({
    // Large herds, and tight enough to *be* herds — the phase-11 lesson that
    // anything counting neighbours is a density mechanism, applied in advance. At
    // the config's 0.6/2.0 a founding cohort this size grazes itself apart.
    herdWeight: 1.0,
    herdDistance: 2.0,
    thirstWeight: 1.15,
    defendRange: 5.5,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
