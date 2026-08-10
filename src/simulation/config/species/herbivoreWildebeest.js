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
    // ⚠⚠ **1400 → 2400 with the wet/dry year** (SEASON-PLAN.md §2.4), and the
    // gestation moved rather than only the window because of an *energy* gate.
    // `isReproductivelyReady` requires `energy >= 0.8 × maxEnergy`. At 4000 ticks
    // to the year a 1400-tick gestation is 0.35 of it, so calving at the start of
    // the wet season would put the rut at 0.65 — the middle of the dry season,
    // when grass has stopped growing everywhere except the old channels. The rut
    // would very likely just **never fire**, and the species would lose a year's
    // recruitment for a reason invisible in this file.
    //
    // At 2400 (0.60 of a year) the rut sits at the wet→dry turn, while the herd
    // is still fat off the wet season, and the calves land at its start. That is
    // also what the real animal does — Serengeti wildebeest rut at the end of the
    // rains and calve at the beginning of the next ones — and 0.60 of a year is
    // ~7 months against a real 8.5.
    //
    // ⚠ The cost, stated: a longer gestation is slower recruitment. At
    // `maxAge: 13000` (3.25 years) an adult female still gets ~5 attempts, but
    // this is a real reduction and it is one of the first things the balance pass
    // should look at.
    gestationTicks: 2400,
    cooldownTicks: 2200,
    // ⚠⚠ **The first breeding window declared in this world** (§3.11, phase 12).
    // Fractions of the year, half-open, and this one does not wrap: conception
    // runs from the middle of the wet season into the start of the dry, which
    // with a 0.60-year gestation puts every calf in the first fifth of the *next*
    // wet season — the flush, where `PHASE_GROWTH` is 1.35.
    //
    // ⚠⚠ **The previous value and this comment disagreed, and had for some time.**
    // It declared `{ 0.85, 0.5 }`, which *wraps*, so its true width was
    // `(1 − 0.85) + 0.5` = **0.65 of the year** — while the prose beside it
    // described "early spring to the start of summer" and did the arithmetic for
    // 0.30. A rut covering two thirds of the year is not compressed, and this
    // file's whole claim is that birth synchrony *emerges* from a compressed
    // window. 0.20 of the year is 800 ticks and is a rut.
    //
    // ⚠ §3.11's warning still stands and is the reason this is not narrower: a
    // species that misses one window loses a *year*. If recruitment fails, widen
    // this before touching anything else — but widen it **backwards** (a smaller
    // `startFraction`), since the far end is what pushes calves into the dry
    // season.
    breedingWindow: Object.freeze({ startFraction: 0.4, endFraction: 0.6 }),
  }),
  territory: Object.freeze({ defends: false, rangeRadius: 22, settleTicks: 1000 }),
  // ⚠ **The label, not the record**, and the deliberate contrast with the zebra
  // beside it (§3.8). A wildebeest aggregation is who happens to be standing here.
  groups: Object.freeze({ forms: false }),
  // Founders are packed into clusters of this size in roster order
  // (`config.cohorts`) — on `default-small`'s 100 wildebeest, six herds of fifteen
  // and a group of ten (2026-08-07; the line read "two herds of fifteen" until
  // then, which described the 222-animal world).
  // The largest founding group in the world, and the deliberate contrast with the
  // zebra beside it a second time:
  // the wildebeest starts in the biggest aggregation and holds none of it, while
  // the zebra starts in small bands that are identities.
  cohort: Object.freeze({ groupSize: 15, spread: 6 }),
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
  // ⚠ **Dry, and the most strongly so of the three plains grazers** (2026-08-09;
  // the wet half is the buffalo's file, the mechanism is `habitat/habitat.js`).
  // This is the short-grass-plains species — `habitat.ground: 1.2` is already the
  // highest open-ground weight in the roster and `cover: 0.7` the lowest — so the
  // wetness axis says the same thing on the axis the terrain codes cannot reach.
  // `water: 1.05` stays: it still drinks, and a bearing to the lake is not a wish
  // to live beside it.
  wetPreference: 0.7,
  // ⚠ **The second association declared in this world** (BEHAVIOR-PLAN P3), and the
  // one the succession above implies: the zebra opens the tall coarse sward and
  // this animal takes the regrowth behind it (`forage.preferredBiomass` 9 → 5), so
  // a zebra band is a standing advertisement for ground a wildebeest wants. Mixed
  // wildebeest–zebra aggregations are the ordinary state of the plain.
  //
  // ⚠ **Directional, and the direction is the point.** The zebra says nothing back:
  // it is the animal in front, and it gains nothing from the herd behind it. One
  // declaration, not two — the same asymmetry the gazelle's is built on. ⚠ It buys
  // the vigilance half too (`association.sharesAlarm`): a zebra's warning now
  // reaches the wildebeest standing with it, and the zebra has the sharpest eyes
  // among the grazers.
  //
  // ⚠ **No `associationPull` beside it, deliberately**, and that makes this species
  // P3's shipped control: `pullScale` is exactly 1 for it, so the *distance* it
  // tolerates from a herd is bit-for-bit what it was, and what changed is only
  // *where* that herd's centre is — which is the phase-12 mechanism doing its
  // ordinary job, not P3's. A gazelle standing in the same crowd is the arm that
  // moved. The distinction is not decoration: it is what says the two fields are
  // genuinely separable in the shipped roster rather than only in a test sandbox.
  association: Object.freeze({ 'herbivore.zebra': 0.5 }),
  behavior: Object.freeze({
    // Large herds, and tight enough to *be* herds — the phase-11 lesson that
    // anything counting neighbours is a density mechanism, applied in advance. At
    // the config's 0.6/2.0 a founding cohort this size grazes itself apart.
    herdWeight: 1.0,
    herdDistance: 2.0,
    // ⚠⚠ **The first species to declare a herd wider than the world's six cells**
    // (BEHAVIOR-PLAN P1). This animal founds in the largest cohort in the roster
    // (fifteen, at `spread: 6`), so at `social.groupRadius` a founding herd is
    // already wider than the radius that is supposed to hold it together and the
    // centre of mass an animal on the edge steers at is built from a third of its
    // own herd. Eleven covers a `spread: 6` disc from either edge.
    //
    // ⚠ It widens the **centre of mass and nothing else** — not the herd label,
    // not `adults`, and therefore not collective vigilance or mobbing. See
    // `social/herding.js` for why that line is where it is. It is above this
    // species' `perception.radius` of 7 on purpose: a wildebeest keeps station
    // with a herd larger than it can see across, which is what the shared
    // neighbour walk was widened to express.
    herdRadius: 11,
    // ⚠⚠ **The highest in the roster, and this is the species the mechanism was
    // built for** (BEHAVIOR-PLAN P8). The animals of one herd label pool their
    // forage drifts into a single heading and hold it for `consensus.commitTicks`
    // whatever their own noses say next, so a wildebeest aggregation bends as a
    // front and keeps going after the gradient that started it has flattened.
    //
    // ⚠ **1 is the reference point, not the maximum**: at 1 a herd that agrees
    // drifts at exactly the mean strength of the cues behind it — the herd's version
    // of the drift this animal already had, rather than an amplification of it. It
    // is the highest declared because going where the grass is *together* is the
    // whole of what a wildebeest does with its year, and because this species has
    // the widest `migration.cueRadius` in the roster to agree about.
    //
    // ⚠⚠ **This is also the nearest legal thing to the subherds the brief asked
    // for.** Persisting a subherd through separation is literally a group record,
    // and 219 wildebeest on the registry would need ~28–100 records for one species
    // against a `maxGroups` of 192 — while `groups.forms: false` above is a stated
    // design decision about what a wildebeest aggregation *is*. A shared heading
    // carried on the entity is what two halves of a torn herd can still both be
    // holding. Do not "fix" this later by flipping `forms`.
    consensusWeight: 1.0,
    thirstWeight: 1.15,
    defendRange: 5.5,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
