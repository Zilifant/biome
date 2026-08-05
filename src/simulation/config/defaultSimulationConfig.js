/**
 * Default simulation configuration. Configuration must stay plain,
 * JSON-serializable data — it is stored verbatim in save files.
 *
 * `demo` holds tuning for the temporary scaffolding systems and fixture; it
 * will be replaced by species/environment definitions as real systems land.
 */
export const defaultSimulationConfig = Object.freeze({
  // ⚠ Several parameters elsewhere in this file are absolute distances or rates
  // that were calibrated against a specific map (see `disturbance.maxRadius` and
  // the `engineering` decay/wear balance). They do **not** rescale with these
  // dimensions; changing the world changes what those mechanisms mean as a
  // fraction of it. The comments there name the map they were measured on.
  //
  // ⚠ **The demo is the `ngorongoro-500-10x` world from 2026-08-04** (see
  // `presets/ngorongoro-500-10x.json`, which is the same composition expressed as
  // a restart payload). It was 160×120 with a 222-animal roster until then, and
  // every measurement in this file dated before 2026-08-04 was taken on that
  // smaller map — they are kept with their dates rather than deleted, because a
  // reading is only meaningful beside the world it was taken in (§"How to read
  // this document").
  world: Object.freeze({
    width: 332,
    height: 280,
    cellSize: 8,
  }),
  // Time model (see PLAN.md §3). The engine holds no timer; these values only
  // document the intended interpretation of a tick and never affect tick math.
  // One authoritative tick represents ~1 in-world minute, so a day is ~1440
  // ticks. The real-time runner ticks once per `runnerTickMs` at speed 1.
  time: Object.freeze({
    tickMinutes: 1,
    runnerTickMs: 1000,
  }),
  // Seeded terrain generation parameters (see world/TerrainGrid.js). Terrain
  // is derived deterministically from the engine seed + these params, so it is
  // regenerated on load rather than stored.
  //
  // ⚠ **This block is the single home for terrain generation** (§19: a value
  // must have exactly one home). `TerrainGrid.DEFAULT_TERRAIN_PARAMS` is this
  // object, re-exported — not a second copy. Until 2026-08-02 it *was* a second
  // copy, and seven of these keys (`lakeDeepFraction` and all six thicket
  // params) lived only there, so the demo's thicket count could not be found or
  // changed from the config at all. The duplicated ten were silently equal,
  // which is the D11 failure case rather than the neutral one: editing either
  // file appeared to work. Worse, a param absent from the config is absent from
  // the save file, and terrain is *regenerated* from these on load — so
  // retuning a generator default silently changed the terrain under every
  // existing save. Add new generation params here, never there.
  terrain: Object.freeze({
    // World shape, 0..MAX_ROUNDNESS (5 levels). 0 is the full rectangle; 4 is a
    // true ellipse inscribed in `world.width` × `world.height` — an oval on a
    // non-square map, a circle on a square one. Between them the corners round
    // off progressively (a superellipse; see TerrainGrid ROUNDNESS_EXPONENTS).
    // Everything outside becomes impassable ROCK, which is what the engine
    // already reports beyond the world edge, so the rim needs no new terrain
    // type and no protocol change.
    //
    // ⚠ **Level 0 is a true no-op** — it skips the carve entirely, so every
    // existing seed generates exactly the world it did before roundness existed,
    // and it remains the control the mechanism was proved against. Raising it
    // shrinks the *playable* area without changing `world.width`/`height`: usable
    // fraction by level is 1.000, 0.978, 0.927, 0.873, 0.785. Since the founding
    // roster is a flat count, a level-4 world is ~27% denser in animals than a
    // level-0 one of the same dimensions.
    //
    // ⚠ The demo shipped at 0 until 2026-08-04 and is now **4**, the ellipse: the
    // caldera the roster is named for is a bowl, and the rim is what makes it one.
    // The density note above therefore applies to the demo itself — its 500
    // animals sit on 0.785 of 332×280.
    roundness: 4,
    lakes: 1,
    lakeRadiusFraction: 0.14,
    // Fraction of a lake's radius that is deep (impassable) water at its centre,
    // leaving a shallow drinkable ring of the remaining radius. 0 disables it (a
    // fully shallow lake). See TerrainGrid #carveLakes.
    lakeDeepFraction: 0.55,
    // Rock is generated as several irregular formations of varying size
    // scattered around the map, never one long dividing ridge. `ridges` is the
    // formation count (0 disables rock entirely, which the flat-world tests
    // rely on); each formation is a short random walk of overlapping discs, so
    // its outline is organic rather than a line or a circle. After all terrain
    // is placed, a connectivity pass carves the minimum rock needed so that no
    // passable region is walled off from the rest (see world/TerrainGrid.js).
    // ⚠ 5 until 2026-08-04, when the demo became the ngorongoro world: these four
    // formation counts (`ridges`, `thickets`, `treeGroves`, `treeSingles`) are all
    // doubled, which is exactly what the old prevalence level 4 produced on the old
    // defaults. `DEFAULT_TERRAIN_PREVALENCE` moved 2 → 4 in the same change so
    // "the default level reproduces the demo's own terrain" still holds *and* every
    // preset already saved at level 4 still generates the terrain it was saved
    // with. See `buildDemoConfig` in the demo fixture for the mapping.
    ridges: 10,
    rockFormationMinRadius: 1.5,
    rockFormationMaxRadius: 4,
    rockFormationMinSteps: 2,
    rockFormationMaxSteps: 7,
    rockFormationDrift: 1,
    // Cover grows in clumps, not per-cell noise: patches keep the run-length
    // encoding compact on large worlds (per-cell scatter fragmented it into
    // ~1 run per cell). Density is patches per 1000 cells — the one terrain
    // quantity already expressed per unit area, so it rescales with the map on
    // its own.
    coverPatchDensity: 1.5,
    coverPatchRadius: 3,
    // Thicket stands, placed exactly like rock formations (a short random walk
    // of overlapping discs, organic outline) but on open ground only.
    // `thickets` is the formation count (0 disables). See TerrainGrid
    // #carveThicketFormations.
    thickets: 10, // 5 before 2026-08-04; see `ridges` above
    thicketMinRadius: 1.5,
    thicketMaxRadius: 4,
    thicketMinSteps: 2,
    thicketMaxSteps: 7,
    thicketDrift: 1,
    // Trees (TREES-FLIGHT-VULTURE-PLAN.md phase T1). Two placement passes,
    // because savanna has trees in two arrangements and one generator cannot
    // produce both: **groves** of semi-open woodland, and **lone trees, pairs
    // and triplets** scattered over grassland.
    //
    // ⚠ A grove is a random walk of discs like a thicket stand, but each open
    // cell inside a disc becomes a tree only with probability
    // `treeGroveDensity` — a *scattered* disc, not a filled one. Filling it
    // would produce a thicket wearing a different name; the broken canopy is
    // what makes it woodland an animal walks and grazes through.
    //
    // ⚠ **0 is the control these shipped through**, and it still is: with both
    // counts at 0 `#scatterTrees` returns before its first draw, so a treeless
    // world is byte-identical to one generated before trees existed — proved on
    // seeds 1/2/42 × 1500 ticks (state, terrain and vegetation hashes all
    // matching) before either was raised, per the §20 procedure.
    //
    // _Measured 2026-08-03, 10 seeds × 15 000 ticks, `8/60` against `0/0` on the
    // same seeds:_ the gate **passes** — every species alive on 10/10 seeds
    // except the gazelle at 9/10 (it loses seed 1 at t14384, in the last 4% of
    // the run). Means against the control: buffalo +6.9, lion +0.9, wildebeest
    // +1.0, leopard −0.4, hyena −0.3, zebra −3.8, vulture −30.1 (on 371 vs 401),
    // and ⚠ **gazelle −15.4 (60.7 against 76.1)**. See DOCS §7 Terrain for what
    // is and is not established about that last one.
    //
    // At `8/60` trees are **2.45% of the map** (5 seeds, 160×120), which
    // takes sheltering ground from 5.05% to ~7.5% — the largest single change to
    // shelter availability since thicket arrived.
    treeGroves: 16, // 8 before 2026-08-04; see `ridges` above
    treeGroveMinRadius: 2,
    treeGroveMaxRadius: 5,
    treeGroveMinSteps: 2,
    treeGroveMaxSteps: 6,
    treeGroveDrift: 1,
    treeGroveDensity: 0.4, // fraction of open cells inside a grove that carry a tree
    // Lone trees, each with 0..`treeClusterMax` companions on an adjacent cell —
    // so a "single" is a single, a pair, or a triplet. A count rather than a
    // density because it is the one tree quantity that reads as a number of
    // *objects* on the map rather than as an area.
    treeSingles: 120, // 60 before 2026-08-04; see `ridges` above
    treeClusterMax: 2,
  }),
  // Cell-level vegetation biomass (see world/VegetationGrid.js). Seeded from
  // the engine seed; grows logistically toward terrain-derived capacity.
  vegetation: Object.freeze({
    capacity: 8,
    growthRate: 0.08,
    seedFloor: 0.08,
    initialFraction: 0.5,
    minFertility: 0.55,
    coverSuitability: 1.35,
    quantizeLevels: 4,
    // How fast biomass above the season's ceiling falls back to it (Step 19).
    // Scaling growth alone cannot brown off a field already at capacity.
    diebackRate: 0.04,
    updateInterval: 5, // regrowth runs every N ticks (staggered)
    // Edge forage taper (see world/VegetationGrid.js `buildEdgeTaper`). Carrying
    // capacity ramps from 0 at the boundary to full over an inland band —
    // gradual, slightly irregular, and rounded hardest at the corners (a square
    // corner is the worst predator trap and the least island-like shape).
    //
    // ⚠ Off by default (fraction 0). Measured 2026-07-22: the taper shapes the
    // map as intended but does NOT reduce edge/corner congregation — predators
    // follow the forage into the interior, which turns the barren margin into a
    // predator-light refuge that fleeing grazers run to, and it cuts grazer
    // carrying capacity ~in half (a knife-edge risk). It is the map-shaping
    // groundwork for the irregular-island direction, not a congregation fix; set
    // `edgeTaperFraction` (~0.10–0.18 on the 128 demo) to enable it there.
    edgeTaperFraction: 0, // 0 = uniform map; the demo ships with the taper off
    edgeTaperIrregularity: 0.4, // coastline wobble as a fraction of the band width
    edgeTaperCornerBoost: 1.5, // carve corners back ~1.5 band widths (rounds them)
    edgeTaperMinDimension: 96, // no taper below this size — keeps test sandboxes uniform
  }),
  events: Object.freeze({
    maxBufferedEvents: 5000,
  }),
  // Metabolism / bioenergetics (see systems/MetabolismSystem.js). Costs are in
  // energy units per tick; mass scaling normalizes by `referenceMass` so a
  // reference-mass animal at rest pays exactly `basalRate`. Global for now;
  // Step 29 can move these per-species alongside the species schema.
  metabolism: Object.freeze({
    basalRate: 0.04, // resting energy cost per tick for a reference-mass animal
    moveCostFactor: 0.02, // energy per unit distance for a reference-mass animal
    referenceMass: 30, // kg; massFactor = (bodyMass/referenceMass) ** massScalingExponent
    massScalingExponent: 0.75,
    lowEnergyFraction: 0.25, // energyFraction below this sets the low-energy flag
    edibleMassFraction: 0.6, // carcass edible mass = bodyMass × this
  }),
  // Local perception (see systems/PerceptionSystem.js). Animals sense within a
  // species radius (falling back to defaultRadius). `foodMinLevel` is the
  // quantized vegetation level that counts as food. `updateInterval` staggers
  // the (per-cell) scan for performance.
  perception: Object.freeze({
    defaultRadius: 5,
    foodMinLevel: 1,
    maxMateCandidates: 6, // bounded set of possible mates sensed (Step 22)
    // Line of sight: an animal behind an opaque obstacle (rock today) is not
    // sensed — the basis of terrain concealment. Applied to animals/carcasses
    // only, not the hot cell-feature scan. False sees through everything.
    lineOfSight: true,
    updateInterval: 1,
  }),
  // Reproduction and mate choice (see systems/ReproductionSystem.js and
  // mating/mateChoice.js). A receptive female assesses the eligible males
  // within `matingRange` and takes the best one that clears the standard she is
  // currently holding; she gestates and gives birth after `gestationTicks`.
  // Nothing guarantees a replacement rate — births emerge from encounters,
  // choice, energy, and lifespan.
  reproduction: Object.freeze({
    matingRange: 2.0, // distance within which a female assesses the males present
    // Reproduction is deliberately expensive and slow: ~37 energy per offspring
    // and a ~2600-tick inter-birth interval against a ~5000-tick adult life.
    // These are cost parameters, not a population cap — with food abundant and
    // no predators yet (Step 16), the herbivore population still grows; cheaper
    // settings made it explode exponentially.
    minEnergyFraction: 0.8, // the gestating sex must be at least this full
    matingEnergyCost: 12, // energy each parent spends at mating
    gestationTicks: 800, // delay from mating to birth
    birthEnergyCost: 25, // extra energy the gestating parent spends at birth
    offspringEnergyFraction: 0.6, // newborn energy as a fraction of its max
    cooldownTicks: 1800, // ticks before the gestating sex may mate again
    // The seeking sex clears a much lower bar and recovers quickly, because it
    // pays for one mating rather than a pregnancy (Step 22). This asymmetry is
    // the whole basis of mate choice: it keeps most males available and most
    // females not, so it is females that males effectively compete for. Note
    // that it leaves the *birth rate* roughly where it was — the old rule
    // consumed both partners for a full cooldown to make one pregnancy, this
    // one consumes only the female.
    suitorMinEnergyFraction: 0.45,
    suitorCooldownTicks: 200,
    // Mate choice (see mating/mateChoice.js). A chooser insists on quality
    // `acceptanceThreshold × her choosiness`, declining linearly to zero over
    // `choosinessPatienceTicks`. 0.72 sits inside the band that healthy adults
    // actually score (roughly 0.6–0.8), which is what makes it discriminate
    // rather than accept or reject everyone; the decline is what makes
    // choosiness cost time instead of risking a population that never breeds.
    //
    // Both numbers are measured, over 15k ticks on five seeds, against a
    // control with choice switched off (`acceptanceThreshold: 0`):
    //
    //   choice off      5/5 seeds alive, grazers 138–247, mean size genotype
    //                   0.997 → 1.012, selection differential on size +0.004
    //                   among males and −0.001 among females
    //   patience 700    4/5 seeds alive, grazers  17–326, size → 1.035, S +0.012 / −0.002
    //   patience 400    5/5 seeds alive, grazers  75–351, size → 1.040, S +0.012 / −0.002
    //
    // So 400 is not a compromise — it selects just as hard as 700 (the trait
    // moves three times as far as the control either way) while leaving both
    // species alive in every seed rather than four of five. Being choosy for
    // longer bought nothing except a thinner margin. Note the signature in that
    // last column: the differential is positive among males and flat among
    // females, which is what sexual selection looks like when only one sex is
    // being chosen — natural selection would move both together.
    acceptanceThreshold: 0.72,
    choosinessPatienceTicks: 400, // ~22% of the female cooldown
    // Male–male competition (Step 23) — the other half of sexual selection.
    // Rivals in range of the same female contest for access; the stronger one
    // wins (dominance decides it, there is no roll), and the loser keeps away
    // for `contestCooldownTicks`. Escalation into an actual *fight* is the only
    // stochastic part, and is likeliest between evenly matched animals: a rival
    // twice your size is not worth bleeding for. Fights are the second source
    // of injuries after failed hunts (§1.4 A19).
    contestEscalationChance: 0.35,
    contestCooldownTicks: 60,
    fightInjurySeverity: 0.22, // milder than a predator's bite (0.35)
    fightWinnerInjuryFraction: 0.4, // winning a fight is not the same as being unhurt
    birthOffset: 1.0, // how far behind the parent the newborn appears
    // Seasonal breeding (see mating/breeding.js). PLAN-SPECIES.md §3.11, phase 12.
    //
    // ⚠ **`null` means year-round, and the comparison is then never made** —
    // exactly the identity rather than a window that happens to cover the year
    // (D16, as `predation`'s mass ratios are). Every species inherits it; the
    // wildebeest of batch 3 is the first animal with a compressed rut, and
    // synchronized calving then needs nothing else at all, because a compressed
    // conception window plus a constant `gestationTicks` *is* a calving season.
    //
    // ⚠ The off switch is `config.breeding.enabled`, **not** a field in here:
    // `reproduction` is a species block and a species block beats the config
    // (DOCS §8), so a switch in this section could not switch anything off.
    //
    // ⚠ Fractions of the year, and the window may wrap the boundary
    // (`{ startFraction: 0.8, endFraction: 0.1 }` is a rut running from late
    // autumn into early spring). Start **wide** and narrow it under measurement:
    // a species that misses one window loses a year of recruitment, and at 8000
    // ticks to the year a 15k-tick sweep contains only two windows.
    breedingWindow: null,
  }),
  // Territories and home ranges (see systems/TerritorySystem.js and
  // world/ScentGrid.js). Nothing here draws a boundary. A home range is a
  // running summary of where an animal has actually been (four numbers, no
  // occupancy history — the step's performance note rules that out), and a
  // territory is whatever ground it has marked most recently and most
  // strongly. Avoidance, conflict, territory loss, and the occupation of
  // vacated ground all fall out of that pair of mechanisms rather than being
  // modelled separately. Which species *defends* ground is species data
  // (`config/species/*`): grazers have ranges, stalkers hold territories.
  // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4): `rangeRadius` is **already
  // per-species** (it lives on the species' `territory` field, 14–30 today), so
  // a wide-ranging animal states its own and nothing here needs to scale. The
  // numbers below are the *mechanics* of a claim — how fast a mark fades, how
  // close an owner must be to answer — and none of them is a function of body
  // size. Correctly flat.
  territory: Object.freeze({
    cellSize: 4, // world cells per claim cell — a territory is coarse-grained
    markInterval: 20, // ticks between an animal's marks
    markStrength: 0.35, // strength one mark writes (≈3 marks to hold a cell)
    decayPerTick: 0.0025, // ≈400 ticks for an unrenewed claim to fade out
    decayInterval: 10, // decay is staggered; the rate is compensated, not changed
    claimFloor: 0.05,
    disputeRange: 8, // how close an owner must be to answer an intruder
    disputeCooldownTicks: 120,
    // Fights over ground are milder than fights over mates: a resident that
    // yields loses its whole claim, which is punishment enough.
    contestEscalationChance: 0.3,
    fightInjurySeverity: 0.2,
    fightWinnerInjuryFraction: 0.4,
  }),
  // Ecosystem engineering (see engineering/features.js and
  // systems/EngineeringSystem.js). Two enumerated features — a trail worn by
  // traffic, a burrow dug by resting — held as sparse per-cell wear. Both land
  // on chokepoints that already exist (`speedModifierAt`, `isShelteredAt`), so
  // no system had to learn what a feature is, and the only new pull feeds Step
  // 26's wander blend rather than the utility table (§1.4 A34).
  //
  // The lifecycle has no clock: a feature exists while wear arrives faster than
  // decay removes it, so "maintained" is simply what not fading looks like.
  engineering: Object.freeze({
    // The whole step, on one switch — the reproducible control, as
    // `migration.enabled` and `disturbance.enabled` are.
    enabled: true,
    // ⚠ These three are one mechanism, and the relationship between them is
    // what decides whether the step works at all — so it is derived here rather
    // than left to be inferred (§1.4 D11, D19).
    //
    // Decay sets the **traffic rate a cell must beat to accumulate anything**:
    // roughly one animal-crossing per `trailWearPerUnit / decayPerTick` ticks
    // breaks even, and anything rarer fades. At 0.035 and 0.0016 that is one
    // crossing per ~22 ticks. Ordinary ground on a 160×120 map with ~100 animals
    // sees far less traffic than that, so it never forms a trail; the routes
    // animals actually converge on (around water, through gaps) do. That gap is
    // the entire mechanism, and it is narrow — 0.0006 paved 7% of the map.
    //
    // ⚠ `demoteFraction` is a **hysteresis band**, not decoration. Promotion at
    // `threshold` and demotion at `threshold × 0.7` keeps a cell sitting near
    // the boundary from flapping across it: without the band one run produced
    // 9569 trails formed and 9081 lost, which is a flickering world rather than
    // a world with trails in it, and each flap costs two events and a
    // projection churn (§1.4 D20).
    threshold: 0.5,
    trailWearPerUnit: 0.035,
    demoteFraction: 0.7,
    decayPerTick: 0.0016,
    // Digging is slower *per tick* than wearing is per crossing, because a
    // resting animal spends many consecutive ticks on one cell — without that
    // asymmetry a single nap would dig a burrow. ~45 resting ticks on the same
    // cell makes one.
    burrowWearPerRest: 0.012,
    maxWear: 1,
    // Decay is staggered over the *worn* cells (never the world), rate
    // compensated so the interval changes cost and not behaviour.
    decayInterval: 20,
    floor: 0.02,
    // Hard cap on tracked worn cells. Decay keeps the real number far below
    // this; the cap is a stated bound rather than a tuning knob.
    maxCells: 8192,
    // How far an animal feels a trail, and how hard it bends an aimless wander
    // toward one. Deliberately weaker than the forage drift: an easier way to
    // walk should never outrank where the food is.
    trailPullRadius: 4,
    trailPullWeight: 0.35,
    driftInterval: 10,
  }),
  // Local disturbances (see disturbance/disturbances.js and
  // systems/DisturbanceSystem.js). Fire, flood, and storm as bounded events: a
  // record holding where, how big, and until when, with every effect derived
  // from it on read. Nothing here makes animals flee — a burnt region is
  // low-forage ground Step 26's drift carries them off, and a fire writes a
  // `danger` memory (Step 15) they already avoid. This step adds a reason for
  // behaviour that exists rather than new behaviour (§1.4 A34, D14).
  //
  // Drought and severe winter are deliberately absent: both already exist as
  // *global* weather states (Step 19), and a local copy would be the same
  // mechanism at a different scale (§1.4 A44).
  disturbance: Object.freeze({
    // The whole step, on one switch — the reproducible control, as Step 26's
    // `migration.enabled` is. False leaves the demo exactly as Step 26 left it.
    enabled: true,
    // One check every `updateInterval` ticks, each spending a flat five draws
    // whatever happens. The first cut (0.35 every 100 ticks) left something
    // burning, flooding, or blowing **91% of ticks** — that is a climate, not a
    // disturbance regime, and it made "recovery" unobservable because nothing
    // ever finished recovering. At one ignition per ~1200 ticks against a median
    // duration around 300, roughly a quarter of ticks have something running
    // somewhere, and the rest of the time the world is quiet enough that
    // recovery is a thing you can watch happen.
    ignitionChance: 0.25,
    updateInterval: 300,
    // A burn is applied on this interval rather than every tick — see the
    // effect table: per-tick severities below `HEALED_BELOW` are silently
    // discarded by `applyInjury`, and it also keeps the event volume sane.
    burnInterval: 25,
    // Hard cap on simultaneous disturbances. Bounds both the per-animal cost
    // (which is O(animals × active)) and the snapshot payload.
    maxActive: 3,
    // Bounded in space as well as number: a disturbance is a local event, and a
    // 16-unit radius covers about 1.3% of a 160×120 map (1.6% of the 128×128 it
    // was set on). "Global catastrophes" are explicitly out of scope for this
    // step. ⚠ Absolute units, so this is a *smaller* share of a bigger world —
    // it does not rescale with `world`.
    minRadius: 6,
    maxRadius: 16,
    // One draw sets radius *and* duration together, so a bigger disturbance
    // lasts longer; each kind then scales that (a fire is short and violent, a
    // flood drains slowly).
    minDurationTicks: 200,
    maxDurationTicks: 700,
  }),
  // Migration and dispersal (see migration/migration.js and
  // systems/MigrationSystem.js). The step's whole design decision is that
  // migration is **not an action**: it adds nothing to the utility table and
  // instead steers the heading `wander` was going to pick anyway, so foraging
  // can never lose to it. §1.4 A34 is why — Step 24's `patrol` competed with
  // wandering and cost the demo two seeds in five.
  //
  // Nothing here is seasonal. Season reaches migration through the vegetation
  // ceiling (Step 19) and the herd's own grazing, so a green spring flattens the
  // gradient to nothing and a grazed-out winter sharpens it. Which species
  // tracks forage, how far its cue reaches, and how long its young walk before
  // settling are all species data (`config/species/*`).
  migration: Object.freeze({
    // The whole step, on one switch. It exists because every step since 22 has
    // had to be measured against a control with the new mechanism disabled, and
    // a control assembled by hand is a control that can be assembled wrongly.
    // False leaves the migration system unregistered *and* dispersal inert, so
    // the demo behaves exactly as it did at Step 25.
    enabled: true,
    // Biomass difference that reads as a full-strength signal. Set against the
    // vegetation reference capacity (8), so roughly "half a full cell better
    // than here" saturates the cue.
    cueReference: 4,
    // Cap on how hard the forage gradient may steer a wander. Deliberately well
    // below 1 — this bends an aimless walk, it does not aim it. Measured; see
    // the sweep recorded in PLAN.md's Step 26 completion notes.
    biasWeight: 0.5,
    // Cap on how hard the thirst cue steers a wander toward the nearest lake —
    // the water counterpart of `biasWeight`, mirrored deliberately. A thirsty
    // animal beyond perception/recall range of the single lake would otherwise
    // have no idea which way water is; this bends its wander lakeward, harder the
    // thirstier it gets. Same "bends, does not aim" intent as the forage cue.
    waterBiasWeight: 0.5,
    // A dispersing juvenile holds its outward heading hard — not at 1, because
    // an animal that ignored terrain entirely would walk into a lake and stand
    // there (the movement system refuses impassable cells, so the residual
    // randomness is what lets it get around one).
    dispersalWeight: 0.9,
    // Habitat evaluation is staggered: 16 O(1) vegetation reads per animal per
    // evaluation, so at 10 this is under two grid reads per animal per tick and
    // no spatial query at all.
    updateInterval: 10,
  }),
  // Disease (see disease/disease.js and systems/DiseaseSystem.js). A
  // compartmental model — susceptible → incubating → symptomatic → recovered —
  // whose one load-bearing choice is that **an incubating animal is infectious
  // and looks healthy**. If only visibly sick animals could transmit, the herd
  // would shun the one obvious case and an outbreak would be a non-event;
  // because the disease runs ahead of its own symptoms, avoidance is late by
  // construction and density is a real cost of the sociality Step 23 added.
  // Immunity wanes so outbreaks can recur instead of burning through once.
  disease: Object.freeze({
    transmissionRadius: 2.5, // contact range — tighter than perception
    transmissionChance: 0.02, // per susceptible contact per tick
    incubationTicks: 250, // infectious and invisible
    // Visibly ill: slow, feeding badly, infertile, shunned. This duration and
    // `feedPenalty` are the two numbers that decide what disease costs the
    // demo, and it is worth being clear that the cost is almost entirely
    // **sublethal** — measured over 15k ticks on five seeds, a run has 300+
    // infections and only 1–5 deaths *from* disease. What suppresses the
    // population is 200 ticks per case of feeding badly and not breeding.
    //
    //   disease off (control)          4/5 seeds alive, grazers 52–165
    //   400 ticks, feedPenalty 0.4     3/5, grazers 1–83   (too harsh)
    //   200 ticks, feedPenalty 0.3     4/5, grazers 7–75   (adopted)
    //
    // Adopted because it matches the control's 4/5 while still visibly
    // suppressing the population — a density-dependent pressure that bites
    // without breaking the demo, which is what the step asks for.
    symptomaticTicks: 200,
    immunityTicks: 3000, // then back into the susceptible pool
    mortalityPerTick: 0.0004, // chance a symptomatic animal simply dies
    sickHealthDrain: 0.03, // health lost per symptomatic tick (the usual route)
    // Baseline condition recovery (§1.4 A20). Wounds healed from Step 17 but
    // health lost to thirst never came back, so a once-thirsty animal carried
    // the damage for life while a mauled one mended. A step about recovering
    // from illness is the right home for the general case: a healthy, well-fed
    // animal now slowly regains health from *any* source of damage. Gated on
    // energy like injury healing, because mending is work.
    healthRecoveryPerTick: 0.02,
    recoveryEnergyFraction: 0.5,
    speedPenalty: 0.45, // speed lost while symptomatic (stacks with injury)
    feedPenalty: 0.3, // intake lost while symptomatic
    edibleMassFraction: 0.6,
    // How many animals start the demo already incubating. One is enough: the
    // point is that an outbreak *spreads*, not that it is seeded broadly.
    initialInfected: 1,
    // A fresh case from outside the population, roughly once every ~2900 ticks.
    // Without it the pathogen goes extinct with its last carrier: the seeded
    // outbreak peaked at 68 symptomatic around tick 1500, burned through by
    // 2500, and by 5500 every survivor's immunity had lapsed with nothing left
    // to catch — one epidemic in the demo's entire history. A standing
    // reservoir is what makes disease a recurring pressure, which is what the
    // step asks it to be.
    spilloverChance: 0.00035,
  }),
  // Sociality (see systems/SocialSystem.js and social/dominance.js). Herds are
  // a *label* propagated between neighbours, never a stored roster: animals in
  // sight of each other converge on the smallest group id around, so herds
  // merge and split without any structural operation. Alarm spreads one
  // neighbour-hop per tick, which is what makes a wave of panic cross a herd
  // visibly instead of the whole population reacting at once.
  //
  // Measured over 15k ticks on five seeds against a control with the social
  // *behaviours* switched off (`herdWeight` 0, `defendWeight` 0,
  // `hunting.defenderWeight` 0, `maxAlarmHops` 0):
  //
  //   sociality off   3/5 seeds with both species alive, grazers  0–320
  //                   (one seed lost the grazers outright), stalkers 4–23
  //   sociality on    5/5 seeds with both species alive, grazers 34–135,
  //                   stalkers 4–19
  //
  // The direction was not what I expected going in: herding gathers prey into
  // clusters a predator can find, which ought to *raise* predation. The net
  // measured effect is the opposite — sociality **stabilises** the system,
  // trading a much lower peak grazer population for never losing them. Both
  // halves of that are worth having; a demo that oscillates 0–320 is one bad
  // seed from an empty world.
  social: Object.freeze({
    groupRadius: 6, // how far conspecifics count each other as groupmates
    // ⚠⚠ **Whether a species may herd at a radius of its own** (BEHAVIOR-PLAN P1).
    // Six cells is right for a gazelle and too small to coordinate a wildebeest
    // aggregation, so a species may declare `behavior.herdRadius` and widen the
    // one thing that decides its **centre of mass** — never the label, never
    // `adults`. `social/herding.js` is the argument for that line; the short
    // version is that `adults` feeds collective vigilance and mobbing, so widening
    // it would make the large grazers harder to kill as a side effect of a
    // cohesion change.
    //
    // ⚠ Here rather than in `behavior` by the phase-8 rule: a species block beats
    // the config, so an off switch inside one could not switch anything off.
    // `false` restores the single-radius world exactly, which is what makes it the
    // reproducible control (`--set=social.perSpeciesRadius=false`).
    //
    // ⚠ It gates the **consumer**, not the walk. `PerceptionSystem` always sizes
    // the shared neighbour list to cover the widest declared herd, because the
    // list is transient, never serialized, and gated by distance at every consumer
    // — so a longer one costs time and cannot change an answer.
    perSpeciesRadius: true,
    // ⚠⚠ **24 since 2026-07-30 (phase 13), and the decision took a measurement
    // that reframed the question.** PLAN-SPECIES §7 asked "is 12 the wrong cap for
    // wildebeest?" and deferred it to batch 3. Measured there, `maxGroupSize` 12
    // against 24 over 3 seeds × 15 000 ticks left every one of the eight species'
    // populations **identical to the digit** — because the herd label has *no
    // behavioural consumer at all*. Herding steers at a centroid built from
    // neighbours, mobbing and collective defense count `adults` from the same
    // neighbour summary, and the alarm travels by proximity: none of them reads
    // `groupId`. The label is a **statistic and a projection** (metrics' herd-size
    // distribution, the entity inspector), so this cap decides what a herd is
    // *reported* to be and nothing else.
    //
    // So it was raised on reporting grounds rather than tuned: at 12 a herd of
    // thirty wildebeest was reported as three herds, and 13.7% of label samples
    // sat at the cap (measured 2026-07-30, 3000 ticks × 2 seeds). It is still a
    // bound rather than a licence — one label must not be able to swallow the
    // population — which is why it is 24 and not removed.
    maxGroupSize: 24,
    // Hops a label survives from its root. Not a size limit — it is what lets a
    // herd *split*: plain min-id propagation only moves labels downward, so the
    // half of a torn herd without the root would keep the old label forever.
    maxGroupHops: 3,
    // ⚠ Counted against **groupmates**, not against members: an animal needs
    // this many *others* in range before it carries a label at all, so at 2 the
    // smallest herd that exists is **three** animals and a pair is nothing. That
    // is the intended behaviour; the name reads the other way, which is worth
    // knowing before wondering why two animals standing together have no label.
    minGroupSize: 2, // a lone animal is not a herd of one
    alarmRadius: 6, // how far panic carries per hop
    alarmTicks: 25, // how long an animal keeps running after being told
    // Hops a warning survives from whoever actually saw the predator. This is
    // the load-bearing number: without a cap, alarmed animals re-alarm the
    // neighbours who alarmed them and the panic becomes self-sustaining — the
    // first cut left 106 of 119 grazers permanently fleeing. At 2 hops the wave
    // reaches ~3 herd-radii from the sighting and then dies.
    maxAlarmHops: 2,
  }),
  // Cover concealment (see perception/concealment.js). PLAN-SPECIES.md §3.12,
  // phase 14 — the mechanism the leopard is built on, and DOCS A18's answer.
  //
  // ⚠⚠ **Not the same thing as `parenting.concealment`**, and the two are worth
  // separating in your head before reading either. That one is *neonatal*
  // concealment: a total exemption, a hiding calf on sheltering ground is not
  // reported as prey at all. This one is a **range discount** that applies to
  // every animal in the world: standing in brush, you are picked out at 45% of
  // the distance you would be in the open. The systems call them
  // `neonatalConcealment` and `coverConcealment` so the code never has to be
  // read twice to tell which is which.
  //
  // ⚠ **No per-species half at all**, which is why this section holds a bare
  // switch rather than following the field-beside-a-section shape: how well brush
  // hides a body is a fact about the brush, not about the animal. The
  // per-*terrain* values are terrain data and live in `TerrainGrid`. What makes
  // this a leopard mechanism rather than a global nerf is that species *choose*
  // where to stand (`habitat`), and the leopard is the only one that chooses cover.
  concealment: Object.freeze({
    // False restores the phase-13 world exactly: no cell is read, no range is
    // discounted, and sight is binary again. The measured control.
    enabled: true,
    // How much of the terrain's concealment applies, 0–1. A dial on the mechanism
    // rather than on any one terrain — the terrain table is a physical statement
    // and this is the tuning layer on top of it. 1 takes cover's 0.55 at face
    // value; 0 is the same world as `enabled: false` but still pays the lookup,
    // which is why the switch exists as well.
    strength: 1,
    // ⚠ **The second half, on its own switch** — the lesson phase 11 paid for and
    // phase 12 applied in advance: two mechanisms shipped together confound each
    // other's measurement, so the cells are separable before anyone needs them to
    // be. `enabled` is the *detection* half (a concealed animal is picked out at
    // shorter range); this is the *approach* half (an ambush predator steps
    // through cover on its way to prey, rather than walking straight at it).
    // False keeps the discount and takes away the stalk's detour.
    approach: true,
  }),
  // Seasonal breeding windows (see mating/breeding.js). PLAN-SPECIES.md §3.11,
  // phase 12.
  //
  // ⚠ **A section holding one switch, and it has to be its own section.** The
  // window is per-species biology and belongs in `reproduction` — where it is —
  // but `reproduction` is a species block, so an `enabled` inside it would be
  // overridable by the very species being switched off. Same shape as
  // `cooperation` and `mobbing`, and by now the standing pattern.
  //
  // Inert until a species declares `reproduction.breedingWindow`, which is `null`
  // for all six. The wildebeest arrives in phase 13.
  // Elevation and climbing (see locomotion/climbing.js). A67, phase T2 of
  // TREES-FLIGHT-VULTURE-PLAN.md.
  //
  // An animal is on the ground (0) or up a tree (1). ⚠ **A flag, not a
  // coordinate**: no distance, no spatial index entry, and no perception read
  // changes with it. It gates exactly two things — whether a predator and a
  // target can reach each other, and whether a cached carcass can be fed on —
  // and it is emphatically **not** in perception's visibility gate, which is
  // A63's trap (a condition there gates mate choice and guardianship too).
  //
  // ⚠ This is the world-level **switch**, and it has to live here rather than in
  // a species block, because a species block beats the config (DOCS §8). The
  // biology beside it is the per-species `climbs` field, which no species
  // declares yet — so with `enabled: true` and an empty roster of climbers the
  // mechanism is still exactly the identity, and both halves were proved
  // byte-identical before either moved.
  climbing: Object.freeze({
    enabled: true,
    // ⚠⚠ **The reproducible control for kill caching, and it has to be here.**
    // The biology is `behavior.cacheWeight`, which lives in a **species block** —
    // and a species block *beats* the config (DOCS §8), so
    // `--set=behavior.cacheWeight=0` would be silently overridden by the
    // leopard's own 1.2 and the "off" arm would measure the mechanism against
    // itself. That is the exact trap phase 8 lost an afternoon to with
    // `aging.hiddenUntil`, and it was nearly shipped again here: the mechanism
    // fired in the demo before anyone noticed it could not be switched off.
    //
    // Separate from `enabled` on purpose, so the two halves of vertical refuge
    // can be measured apart: resting above competitors is fidelity that does no
    // measurable work (nothing hunts a leopard), while caching a kill is the
    // half that changes who eats.
    caching: true,
  }),
  // Flight (see locomotion/flight.js). Phase F1 of TREES-FLIGHT-VULTURE-PLAN.md.
  //
  // A **movement mode, not a simulation of flight**: faster travel, wider sight,
  // cheap distance, and the terrain speed modifier bypassed. There is no
  // altitude, no thermal, no takeoff cost and no flapping budget — `vulture.md`
  // asks for all four and the plan declines all four, because each of them is a
  // stored state or a second field on a mechanism whose whole claim is that it is
  // four numbers at four chokepoints that already exist.
  //
  // ⚠ This is the world-level **switch**, for the same reason `climbing.enabled`
  // is: a species block beats the config (DOCS §8), so an `enabled` inside the
  // per-species `flight` field could never switch anything off. The biology is
  // that field — `{ speedMultiplier, visionMultiplier, moveCostFactor }` — which
  // the vulture declares in phase F2 and nothing else does.
  //
  // ⚠ It has **no tuning of its own, deliberately**. Every number flight applies
  // is per-species, because "how much faster is it on the wing" is a fact about
  // the animal and there is no world-level version of it to default from. A
  // section holding one switch is the standing shape here (`breeding`,
  // `cooperation`, `mobbing`), and this is another.
  flight: Object.freeze({
    // False ⇒ nothing ever leaves the ground whatever it declares: the measured
    // control. Costs one comparison per animal per tick when true, since
    // `flyingFor` short-circuits on the species before touching the action.
    enabled: true,
  }),
  breeding: Object.freeze({
    // False ⇒ every species breeds year-round whatever it declares: the measured
    // control. Costs nothing when true either — a null window skips the test.
    enabled: true,
  }),
  // Heterospecific association (see social/association.js). PLAN-SPECIES.md
  // §3.16, phase 12.
  //
  // ⚠ **A third thing in the neighbourhood that is not the other two.** `social`
  // is who I am standing with *of my own kind*; `groups` is who I belong to;
  // this is who I am willing to stand with that is **not** my own kind. A gazelle
  // in a wildebeest herd is in none of that herd's labels and none of its records,
  // and is still standing in it.
  //
  // The biology — which species, and how strongly — is the always-per-species
  // `association` field, one weight per partner species keyed by id, in the shape
  // `habitat` uses for terrain. What lives here is the machinery and the two
  // switches, for the phase-8 reason that a species block beats the config and an
  // off switch inside one cannot switch anything off.
  //
  // ⚠ **No shipped species declares an association**, so this is inert by
  // construction: `SocialSystem` builds the declaring-species map once per world
  // and its neighbour loop is unchanged when that map is empty. The wildebeest and
  // zebra arrive in batch 3 (phase 13) and are what the weights get tuned against —
  // declaring one now would be fitting a parameter to a world with nothing to
  // associate with.
  association: Object.freeze({
    // False ⇒ no species associates with anything, whatever it declares: the
    // measured control, in the pattern every mechanism since migration ships.
    enabled: true,
    // ⚠ **The second switch is not decoration.** Association does two things — it
    // moves the herd centre an animal steers at, and it lets an associate's alarm
    // carry — and a co-attracted animal is usually also a co-alarmed one. Phase 11
    // paid for that lesson: two mechanisms shipped together confound each other's
    // measurement, and the uncontrolled comparison read *backwards* while both
    // were working perfectly (§10.2). This splits the cells before anybody needs
    // them split. False keeps the attraction and leaves warnings conspecific.
    sharesAlarm: true,
  }),
  // Persistent social groups (see world/GroupRegistry.js and
  // systems/GroupSystem.js). PLAN-SPECIES.md §3.8.
  //
  // ⚠ **This is a second sociality mechanism, deliberately separate from the
  // `social` block above, and the two must never be confused.** A herd label is
  // positional — who I happen to be standing with — and is recomputed every tick
  // by propagation. A group *record* is an identity that survives separation:
  // a lion pride, a hyena clan, a zebra band. Two animals fifty units apart are
  // in the same clan and in different herds, and both statements are true.
  // `SocialSystem` owns `groupId`; `GroupSystem` owns `groupRecordId`. Nothing
  // writes both.
  //
  // ⚠ **No shipped species sets `forms: true`**, so this is inert in the demo by
  // construction — the schema and the mechanism arriving ahead of the roster
  // that needs them, exactly as `disease` did at Step 29 and `feeding` /
  // `hunting` / `behavior` did earlier the same day. The first consumer is the
  // clan-forming carnivore of batch 1 (PLAN-SPECIES.md §10.1).
  //
  // The fields split into two kinds and it is worth knowing which is which:
  // `enabled`, `updateInterval`, and `maxGroups` are **world-level** (one store,
  // one schedule); the rest are per-species defaults a species file overrides in
  // its own `groups` block, the same way `territory` and `migration` work.
  groups: Object.freeze({
    // The reproducible control, in the pattern every mechanism since migration
    // ships: off means the system is never registered, so a sweep can measure
    // the mechanism against a world that genuinely lacks it rather than against
    // a hand-assembled one.
    enabled: true,
    updateInterval: 1, // membership changes slowly, but the no-forming-species
    // early-out already makes this free; stagger it if a long roster changes that
    maxGroups: 64, // structural bound on the store. Full means a new group is
    // **refused**, never that a living one is evicted — a stated limit in the
    // spirit of `forgotten` in the tombstone registry
    joinRadius: 6, // how close two animals must be to found or join
    maxMembers: 8, // hard cap on one group
    minMembers: 2, // below this the record dissolves; a lone animal is not a
    // group of one, exactly as `social.minGroupSize` says of a herd
    // Which sex leaves its natal group when it disperses. Natal dispersal is
    // already a bounded outward walk (`beginDispersal`), so sex-biased dispersal
    // costs no new state and no new clock — it is that event, filtered by sex,
    // and it is what makes a female-cored pride expressible. `'none'` keeps
    // everyone; `'both'` empties the natal group of every disperser.
    leavingSex: 'male',
    // A dependent juvenile takes its guardian's group. The guardian is the
    // parent that gestated, so matrilineal descent falls out with no sex
    // conditional anywhere.
    inheritFromGuardian: true,
    // ⚠⚠ A64 (DOCS §1.1), fixed 2026-07-31. `true` restores the pre-fix world
    // exactly — the measured control — in which a dispersing animal was removed
    // from its group on one tick and re-admitted by the ordinary proximity join
    // on the next, for the whole dispersal window. It cost ~3400 spurious
    // membership events per 6000-tick run and inflated every group-churn figure
    // taken before that date. Left as a switch rather than deleted so the arm
    // stays re-runnable, in the pattern every measured mechanism here ships.
    rejoinWhileDispersing: false,
  }),
  // How a founding cohort is *arranged* on the ground, against `demo.founding`,
  // which says only how many of each there are. Two sections, two questions:
  // `demo.founding` is the roster, `cohorts` is the arrangement.
  //
  // ⚠⚠ **This adds no social mechanism, and that is the whole design.** Founders
  // used to be placed independently at uniform random over the map, so a lion
  // pride began as eight animals scattered across 160×120 units and the world's
  // social structure had to reassemble itself from nothing. Both mechanisms that
  // make animals social are already seeded by *proximity*: `SocialSystem`
  // recomputes the herd label every tick from neighbours within `groupRadius`,
  // and `GroupSystem` founds a persistent record from two unattached
  // conspecifics within `groups.joinRadius`. So placing a cohort in clusters
  // gives herds on tick 1 and real prides, clans and bands on tick 1, with no
  // new entity field, no protocol change, and no third way to create a group.
  //
  // ⚠ Writing `groupId` or `groupRecordId` from the fixture was considered and
  // rejected: DOCS §9 — a system writing both fields is "a roster pretending to
  // be a label, which is the worst of both" — and it would bypass the registry's
  // `maxGroups` / `maxMembers` reconciliation to produce, one tick early, the
  // records the registry produces anyway.
  //
  // Two kinds of field again: `clustered` and `placementAttempts` are
  // **world-level**; `groupSize` and `spread` are the fallback for a species
  // that declares no `cohort` block of its own.
  cohorts: Object.freeze({
    // The reproducible control, in the pattern every mechanism since migration
    // ships. ⚠ World-level rather than a species field by the rule in DOCS §8: a
    // species block *beats* the config, so an "off" arm living in one could not
    // switch anything off. `false` reproduces the pre-2026-08-04 world exactly —
    // `groupSize` resolves to 1, the offset draw is skipped, and the `worldgen`
    // stream sees the identical sequence — which is what makes the off arm a
    // byte-identical proof rather than an argument, and what makes
    // `--set=cohorts.clustered=… --controlSet=…` a one-command A/B (§20).
    //
    // ⚠⚠ **On since 2026-08-04, and the gate it passed is not a clean win** —
    // read A80 before treating this number as settled. Ten seeds × 15 000 ticks
    // put every species over the bar and the lion up on 8 of 10 seeds, but every
    // other species' mean is a coin flip in its per-seed ordering (D41), and it
    // costs the leopard a seed. The honest summary is that clustering makes the
    // world *start* the way it was going to end up: measured over six seeds,
    // group counts and sizes converge on the scattered world's by tick 10 000
    // (7.5 × 5.3 against 7.8 × 5.3). What it buys is the first ten thousand
    // ticks, in which a scattered world has no societies at all.
    clustered: true,
    groupSize: 1, // one animal per cluster: independent placement, as before
    spread: 5, // radius in world units around a cluster's anchor
    // Rejection budget for one animal's offset before it falls back to the
    // anchor, which `passableSpawnPosition` already proved passable. Bounded so
    // a cluster anchored beside a lake cannot spin, and so the C1 invariant
    // (founders never start inside rock) holds without a second global draw.
    placementAttempts: 12,
  }),
  // Season and weather (see world/Environment.js and systems/WeatherSystem.js).
  // The year is compressed exactly as lifespan is: a tick is ~1 in-world minute,
  // so a literal year would be 525,600 ticks and no demo run would ever reach
  // winter. At 8000 ticks a year, each season is 2000 ticks and an animal lives
  // roughly 1.5 years against the compressed `aging.maxAge`.
  environment: Object.freeze({
    ticksPerYear: 8000,
    spellTicks: 400, // how long one weather state holds before re-rolling
    meanTemperature: 14, // °C, annual mean
    // °C: summer peaks ~23, winter troughs ~5. Measured — at an amplitude of 14
    // the bare seasons alone pushed animals outside their comfort band all
    // winter and predators died out in 3 of 5 seeds; at 11 both species survive
    // in 4 of 5. It also models better: the *weather* is what bites (snow at
    // −6, drought at +5 on top of the season), rather than winter being
    // uniformly lethal.
    //
    // ⚠⚠ **11 → 9 on 2026-08-01, and this time against a stated criterion rather
    // than a survival count.** At 11 the bare seasonal cycle is 3…25 °C, which
    // still sits outside somebody's comfort band at both ends — and the cost of
    // that is not an occasional hard winter, it is a **standing tax**:
    // thermoregulation measured at **40.1% of the leopard's entire energy budget**,
    // 23.7% of the wildebeest's and 22.8% of the gazelle's, with the leopard
    // stressed on 23% of its animal-ticks. It produced 59 exposure deaths across
    // three seeds against 14 starvations, **47 of them sound adults**, and not one
    // of them had a storm on it. A healthy animal in ordinary weather should get
    // hungry, not die.
    //
    // The criterion: the **intersection of every species' comfort band** is
    // 5…24 °C (the vulture's `comfortMin: 5` and the leopard's `comfortMax: 24`),
    // so an amplitude at or below 9.5 around a mean of 14 puts the *bare seasons*
    // inside every band in the roster. 9 gives 5…23 and leaves the weather doing
    // exactly the job the note above says it should: snow takes winter to −1,
    // drought takes summer to 28, and a storm is −10 on top of either. ⚠ This
    // changes an energy sink for every animal in the world, so it is swept, not
    // assumed — see DOCS §1.1 A67 and §9 Metabolism.
    temperatureAmplitude: 9,
  }),
  // Carcasses and decay (see systems/CarcassSystem.js). A body is a resource on
  // a clock: it passes through decay stages, its flesh is worth less at each
  // one, and it leaves the world when it is either eaten clean or fully rotted.
  // Whatever mass is left when it goes returns to the cell as biomass, closing
  // the death→nutrient loop opened in Step 6.
  // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4) — verdicts:
  //   decayTicks           flat, and **open**. A 600 kg body rots on exactly the
  //                        same clock as a 6 kg one, which is wrong in both
  //                        directions: the big body should feed scavengers for
  //                        longer, and the small one should vanish sooner. Left
  //                        flat because it is inert at today's 4–45 kg spread and
  //                        because changing it changes a food source, which by
  //                        DOCS §15 needs its own multi-seed sweep. Revisit with
  //                        the first heavy species (batch 2).
  //   nutrientReturn       correctly flat — a fraction of mass, so it scales by
  //                        construction. What was *not* correct was where it
  //                        landed; see `nutrientSpreadRadius` below.
  carcass: Object.freeze({
    decayTicks: 3000, // death to fully rotted (~2 in-world days)
    nutrientReturn: 0.5, // biomass returned per unit of remaining edible mass
    // ⚠ How far that return may spill into neighbouring cells. It used to go
    // into the death cell alone, and `VegetationGrid.addAt` clamps to the cell's
    // carrying capacity and **discards the rest** — so the death→nutrient loop
    // leaked for every animal above the reference mass. Measured 2026-07-28
    // against `capacity: 8`: a 30 kg grazer loses ~1 of ~9 (invisible, which is
    // why it stood), a 45 kg stalker loses ~60%, and a 600 kg animal would lose
    // nearly all of it. Spilling is also the truer model — one cell is a single
    // stride, and a large body enriches a patch. Rings are walked outward in a
    // fixed order with no randomness; anything that still will not fit is
    // genuinely lost, which bounds the work. **0 restores the old single-cell
    // behaviour**, and is the control this was measured against.
    nutrientSpreadRadius: 4,
    updateInterval: 5, // decay stages are coarse; no need to check every tick
    // Carcass possession and kill theft (see predation/possession.js).
    // PLAN-SPECIES.md §3.9.
    //
    // ⚠ **Unlike the rest of phase 4, this is not inert.** The demo already has
    // two carnivores contending for the same bodies, and until now they
    // contended only through entity id order — the lower id ate first. That is
    // a real energy-source change, so it ships behind a switch and was swept
    // against it on ten seeds; the numbers are in DOCS §9 Carcasses.
    //
    // The rules are short. An animal that feeds on a body claims it. Another
    // carnivore either feeds beside the holder (same group record — a clan
    // shares a kill), takes it by contest if it is stronger, or picks at the
    // edge for `possessionShare` of its normal intake. Possession is held by
    // **presence**, so a holder that walks away simply stops holding it and no
    // timer has to expire to say so.
    possessionEnabled: true,
    possessionRange: 2, // how close the holder must still be for its claim to stand
    // ⚠ What a bystander still gets. The first version of this was **0** —
    // strict exclusion — and ten seeds said no: stalker survival 9/10 → 6/10,
    // with their deaths moving from `age` to `starvation` and `dehydration`.
    // The cause was not carrion lost to theft (per-capita carrion barely moved)
    // but *young* stalkers being locked out by weight of numbers: `dominanceOf`
    // halves for immaturity, so a subadult scores below a well-fed adult corvid,
    // and the demo runs ~80 corvids to ~7 stalkers. Recruitment failed and the
    // population aged out. A share is also the truer model — a vulture at an
    // occupied kill gets scraps, not nothing — and the holder still takes four
    // times what a bystander does, which is what possession is *for*. **0
    // restores strict exclusion**, and is the measured variant above.
    possessionShare: 0.25,
    // Fights over a body are the mildest of the three: a beaten challenger has
    // lost nothing but a meal, and the resident keeps eating. Contests draw
    // from their own `possession` stream so a carcass fight cannot shift the
    // `social` sequence that mate contests and territory disputes share.
    possessionEscalationChance: 0.25,
    possessionFightSeverity: 0.18,
    possessionWinnerInjuryFraction: 0.4,
  }),
  // Lineage across removal (see world/lineage.js). Carcasses are the first
  // things ever removed from the world, so parent/offspring references can now
  // point at something that is gone. The world remembers the recently dead so
  // a family tree stays readable, and says "forgotten" rather than failing
  // silently once a tombstone is evicted.
  lineage: Object.freeze({
    maxTombstones: 256,
  }),
  // Injury and healing (see injury/injuries.js and systems/InjurySystem.js).
  // A failed capture usually leaves the prey wounded rather than untouched, and
  // occasionally hurts the predator. A wound halves nothing on its own — it
  // scales speed and feeding by its severity — but because the hunting system
  // reads prey condition, being injured also makes an animal easier to catch.
  // Healing is slow and paid for in energy, and an animal too hungry to spare
  // it does not heal at all.
  // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4) — verdicts. ⚠ **This section is
  // the largest one still open**, and it is not a species block:
  //   healthDamage       flat health lost per unit of wound severity, charged
  //   speedPenalty       against `maxHealth` (species data). So a tougher animal
  //   feedPenalty        already survives more by declaring a bigger `maxHealth`,
  //                      and severity is a 0–1 fraction rather than an absolute.
  //                      The ratio is therefore already expressible — but nothing
  //                      lets a rhino be *harder to wound in the first place*,
  //                      only better at surviving the wound. That is the real gap
  //                      and it wants `injury` to become a species block, not a
  //                      scaling rule. Deferred to the batch that needs it
  //                      (buffalo/rhino, PLAN-SPECIES.md batch 2/5).
  //   preyInjuryChance   correctly flat; `predatorInjuryChance` is **already
  //   predatorInjuryChance mass-aware** at the call site, scaled by
  //                      defender/attacker mass ratio in `trampleChance`.
  injury: Object.freeze({
    healRatePerTick: 0.0015, // severity closed per tick (~230 ticks for a 0.35 wound)
    healEnergyCost: 20, // energy per unit of severity closed
    healEnergyFloor: 0.3, // below this energy fraction, no healing happens
    healthPerSeverity: 60, // health regained per unit of severity closed
    speedPenalty: 0.5, // speed lost at full impairment
    feedPenalty: 0.5, // intake lost at full impairment
    edibleMassFraction: 0.6,
    // Applied by the hunting system when a capture attempt fails.
    preyInjuryChance: 0.55,
    preyInjurySeverity: 0.35,
    predatorInjuryChance: 0.08, // scaled by how heavy the prey is
    predatorInjurySeverity: 0.25,
    healthDamage: 60, // health lost per unit of severity when the wound lands
  }),
  // Predation (see systems/HuntingSystem.js). A hunt is resolved in stages —
  // detect, evaluate, stalk, chase, capture-or-escape, feed, recover — and the
  // capture probability comes from the two animals' relative speed, remaining
  // sprint, and the prey's condition, never from a flat roll. The floor and
  // ceiling exist so nothing is ever untouchable or ever certain prey.
  // ⚠ A **species block** since 2026-07-28, so two predators can differ in how
  // they capture. Resolved off the **hunter**, except `edibleMassFraction`, which
  // describes the body that died and so resolves off the prey.
  //
  // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4) — verdicts:
  //   captureRange         correctly flat, and per-species if a long-limbed
  //                        animal should lunge from further.
  //   captureStaminaCost   flat, and **the one still open**. It is an absolute
  //                        cost against a 0–`maxStamina` budget, so with
  //                        `maxStamina` per-species the ratio is expressible —
  //                        but no species varies `maxStamina` yet, so at batch 2
  //                        (a 180 kg lion beside a 60 kg hyena) re-check whether
  //                        this wants scaling or whether `maxStamina` should
  //                        carry it. Recorded rather than guessed.
  //   baseCaptureChance    correctly unscaled: the odds already read *relative*
  //   staminaWeight        speed, stamina and condition, so mass enters through
  //   vulnerabilityWeight  the animals' own traits rather than through a constant.
  //   failedHuntEnergyCost flat, and correctly so per unit of body — but it is
  //                        charged against `maxEnergy`, which is species data, so
  //                        a big predator already pays proportionally less. Fine.
  //   defenderWeight       correctly flat — a defender's value is that it is
  //   maxDefenders         another pair of eyes, which does not scale with mass.
  //                        (Mass *does* enter, via `trampleChance` below.)
  hunting: Object.freeze({
    captureRange: 1.2, // distance at which the predator lunges
    baseCaptureChance: 0.28, // chance between two evenly matched, fresh animals
    minCaptureChance: 0.02,
    maxCaptureChance: 0.9,
    staminaWeight: 0.6, // how much the remaining sprint budget tilts the odds
    vulnerabilityWeight: 0.8, // how much a wounded or half-grown prey tilts them
    failedHuntEnergyCost: 4, // a miss is expensive; hunting is a gamble
    captureStaminaCost: 12, // the lunge itself, win or lose
    edibleMassFraction: 0.6, // carcass edible mass from a kill
    // Cooperative defense (Step 23). Adult groupmates standing around the prey
    // shave the odds with diminishing returns, capped so a large herd is never
    // untouchable; a parent actively interposing counts double and makes the
    // attempt genuinely dangerous for the predator.
    defenderWeight: 0.12,
    maxDefenders: 4,
    defenderInjuryBonus: 2.5, // how much likelier a guarded kill is to hurt the hunter
    // ⚠ Resolves off the **prey**, joining `edibleMassFraction` as the second
    // field in this block that does. Escape used to be about top speed and
    // nothing else — `captureChance` reads the speed ratio, the stamina edge,
    // vulnerability, and shielding — so a prey animal could only get away by
    // being *faster*, never by turning better. This is that missing term, and
    // it is the whole realistic ask (PLAN-SPECIES.md §3.15): acceleration and
    // turn radius are not representable without a trajectory model this engine
    // deliberately does not have, and stotting needs a predator that reads a
    // per-prey signal. One divide, in a function that already exists.
    //
    // 1 is **exactly** the identity — `x / 1 === x` — so this is inert until a
    // species declares otherwise, which is the point: a gazelle's agility is a
    // fact about the gazelle and arrives with it (phase 7).
    agility: 1,
    // Cooperative hunting (see predation/cooperation.js). PLAN-SPECIES.md §3.7,
    // phase 10 — the mirror of the cooperative-defense weights above: each other
    // hunter committed to the same quarry raises the capture odds, capped, as
    // each defender lowers them.
    //
    // ⚠ **0 is exactly the identity** (`1 + 0 × n === 1`) and it switches the
    // whole mechanism off for the species, adoption included, so nothing is
    // walked and nothing is scored. That is deliberate and it is what §9 demands:
    // a cooperative capture only pays when the prey is too large for one hunter,
    // so the term is **built at phase 10 and tuned at phase 11** against the lion
    // and the 600 kg buffalo that justify it. A single hyena takes a 30 kg
    // gazelle solo, as a real one does — fitting this number to that case would
    // mean re-tuning it twice.
    //
    // ⚠ The world-level off switch is `config.cooperation.enabled`, **not** a
    // field in here: this is a species block, and a species block beats the
    // config (DOCS §8), so an `enabled` here could not switch off a species that
    // declared its own.
    cooperationWeight: 0,
    maxAttackers: 3, // diminishing returns by cap, exactly as `maxDefenders` is
  }),
  // Cooperative hunting — the world-level half (see predation/cooperation.js).
  // PLAN-SPECIES.md §3.7, phase 10.
  //
  // The biology (`hunting.cooperationWeight`) is per-species; the switch and the
  // geometry are here, for the phase-8 reason that a species block beats the
  // config and an off switch inside one cannot switch anything off. Same shape as
  // `forage` and `habitat` (phase 9), and now the standing pattern for any
  // per-species mechanism that needs a reproducible control.
  cooperation: Object.freeze({
    // False ⇒ no bonus and no adoption whatever any species declares: the
    // measured control. Costs nothing when true either, since every shipped
    // species leaves `cooperationWeight` at 0.
    enabled: true,
    range: 6, // how close another hunter must be to the quarry to be in on the kill
    // How far a joining hunter will commit to a quarry it has not necessarily
    // seen itself. ⚠ A stated stand-in of the same kind as A42 (the forage cue
    // reaching 18 units against a perception radius of 6): an animal that watches
    // a clanmate break into a run knows roughly what it is running at.
    joinRange: 12,
  }),
  // Mobbing — prey that turns on the predator (see predation/mobbing.js). DOCS
  // A33, PLAN-SPECIES.md §3.7, phase 10.
  //
  // ⚠⚠ **There is no `mob` action.** Mobbing is the *groupmate* half of `defend`,
  // which DOCS §7 Decision has described as "a predator is on kin or a groupmate"
  // since Step 23 while only the kin half was implemented. So the candidate set
  // is exactly the size it was, the effect lands on `shielding` and
  // `trampleChance` (products that already exist), and nothing new competes with
  // foraging — which is the most expensive lesson in this project, applied in
  // advance rather than paid for again.
  //
  // Inert until a species declares `behavior.mobWeight`, which is 0 for all four.
  // The buffalo is what this is for, and it arrives in phase 11.
  mobbing: Object.freeze({
    enabled: true, // false ⇒ no ward is ever looked for: the measured control
    // How many adult groupmates an animal needs nearby before it will turn on a
    // predator. One buffalo facing a lion is a dead buffalo; a mob is a *number*
    // of animals, and this is the threshold that makes it collective. Read off
    // the social summary, so it costs no walk.
    minMobbers: 2,
    range: 6, // how close the animal under attack must be to be worth going to
  }),
  // Prey eligibility (see predation/predation.js). Which *individuals* a
  // predator will commit to, as opposed to which species it hunts —
  // `preySpeciesIds` has never had a size or age gate on it, so a predator
  // would take any listed species at any size.
  //
  // ⚠ The ratios read `bodyMass`, not `adultMass`, which is what makes
  // age-structured prey selection free: a calf is under a ceiling its mother is
  // over, with no life-stage conditional anywhere and nothing new stored.
  //
  // ⚠ **Both bounds ship as `null`, meaning no bound at all**, and the
  // comparison is then never made — exactly the identity rather than
  // approximately it (D16). That is deliberate. The demo is a knife edge, and
  // any ratio tight enough to be interesting would stop a subadult stalker
  // (bodyMass ~25 kg while it grows toward 45) taking an adult grazer (up to
  // ~34 kg) — a large ecological change bought for a roster with nothing to
  // spend it on. The species that need ratios declare them when they arrive:
  // a leopard taking calves, a lion taking buffalo at real risk, an adult rhino
  // taking nothing at all.
  predation: Object.freeze({
    maxPreyMassRatio: null, // heaviest prey, as a multiple of the hunter's own mass
    minPreyMassRatio: null, // lightest prey worth the sprint
    // ⚠ How dangerous heavy prey is allowed to get. `HuntingSystem` already
    // scales the hunter's injury chance by `defenderMass / attackerMass`; this
    // is the cap on that term, which was a bare `2` in the code until
    // 2026-07-28. Default 2 is **exactly** what it replaced, so this is a magic
    // number becoming species data rather than a behaviour change. A buffalo's
    // hunter raises it; nothing today touches it.
    riskyMassRatio: 2,
  }),
  // Sprinting (see systems/MovementSystem.js and MetabolismSystem.js). Chases
  // and escapes trade stamina for speed; stamina recovers whenever an animal is
  // not sprinting, which is what makes a failed chase cost a predator time as
  // well as energy.
  locomotion: Object.freeze({
    sprintMultiplier: 1.6, // speed while sprinting
    sprintStaminaCost: 2.5, // stamina per sprinting tick (~40 ticks from full)
    staminaRecoveryPerTick: 0.6, // regained per non-sprinting tick (~165 to refill)
    // Thermoregulation (Step 19). Charged as energy, so a cold snap kills by
    // burning an animal out — which is what hypothermia is. Cover halves it.
    thermalCostFactor: 0.06, // energy per °C outside the species' comfort band
    shelterRelief: 0.55, // fraction of that stress cover removes
    // ⚠⚠ **`exposureStressThreshold` was deleted on 2026-08-01, not retuned.** It
    // was 0.35 °C — the stress at which an energy death was *called* exposure —
    // while `shelterStressThreshold` below, the stress at which an animal will
    // actually walk to cover, was 2 °C. Measured on seed 1, **127 709
    // animal-ticks** sat in that gap: cold enough to be recorded as having frozen
    // to death, not cold enough to have any reason to do something about it. Two
    // numbers for one fact, and the label was the one that lied. `MetabolismSystem`
    // now reads `shelterStressThreshold` for both (D11: one rule, one home).
    //
    // ⚠ `shelterWeight` moved to `behavior` on 2026-07-28 — how hard the weather
    // pulls an animal toward cover is biology, and nothing but the decision
    // system read it. The two below stayed: they are °C thresholds describing
    // *when the pull engages at all*, which is machinery shared by every animal.
    shelterStressThreshold: 2, // °C of stress before moving is worth it — and before a death reads as `exposure`
    shelterStressSpan: 10, // °C at which that pull is at full strength
    // ⚠⚠ **What the weather does depends on the condition of the animal it finds**
    // (2026-08-01). Exposure was killing sound adults four times as often as
    // starvation did, which is the wrong shape for an ecosystem: an animal in its
    // prime does not freeze in ordinary weather, it gets hungry. See §9
    // Metabolism for the mechanism and the measurement.
    //
    // `exposureFrailty` is how much a wound or an illness multiplies the
    // thermoregulation cost — the one direction in which exposure *should* bite,
    // and 0 restores a flat cost as the control. `exposureFloorFraction` is the
    // reserve fraction the thermal charge alone may not take a **sound adult**
    // below; it still pays and still ends up hungry, but the weather can no longer
    // be the blow that empties it, so it dies of the food it then fails to find.
    // 0 restores the pre-2026-08-01 behaviour and is the arm this was measured
    // against. Calves, subadults, senescent animals, the wounded and the sick are
    // all unfloored and can still freeze.
    exposureFrailty: 1.5,
    exposureFloorFraction: 0.05,
    // Soft per-cell crowding cap. A number N refuses a step INTO a world cell
    // that already holds N living animals — the same treatment a wall or a
    // thicket edge gets, so a blocked animal simply turns and re-commits. It
    // never traps: moving *out* of, or *within*, an over-full cell is always
    // allowed, and carcasses do not count (a scavenger can still stand on the
    // body it is eating). `null` disables it entirely (movement unconstrained,
    // the pre-2026-07-24 behaviour).
    //
    // Default 2: every pairwise interaction (predation, mating, courtship,
    // provisioning) involves exactly two animals and its distance gates are
    // satisfied by adjacent cells, so N = 2 costs no behaviour — verified across
    // four seeds, every species surviving and every death cause still firing —
    // while stopping the literal stacking the uncapped model allows (measured up
    // to ~20 animals in one 1×1 cell, ~10% of animal-ticks in cells holding more
    // than two). It is a real ecological change, not a no-op: it perturbs
    // per-seed outcomes by the same magnitude as re-rolling the seed, with no
    // systematic direction.
    // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4): **open, and body-blind.** One
    // cell is one world unit — a short stride — so "two occupants" means two
    // 6 kg vultures exactly as much as two 600 kg buffalo, and the second of
    // those is already generous. The honest fix is an occupancy *cost* per
    // animal rather than a headcount, which is a real change to a measured
    // knife edge (the cap shifted demo populations ±15–55% when it landed) and
    // so belongs with the first heavy species, not here.
    maxOccupantsPerCell: 2,
  }),
  // Bounded, decaying spatial memory (see memory/memories.js and
  // systems/MemorySystem.js). Animals remember where they ate, drank, searched
  // in vain, and met danger. Decay rates are per kind and deliberately unequal:
  // a grass patch may already be grazed out and "nothing here" expires fastest
  // because vegetation regrows, while a lake **never moves** — so water does not
  // fade at all, and a place an animal drank is remembered for good.
  memory: Object.freeze({
    maxMemories: 8, // hard cap per animal (also enforced in memory/memories.js)
    forgetBelow: 0.05, // strength at which a memory is dropped entirely
    updateInterval: 5, // decay runs every N ticks, scaled so the rate is unchanged
    decay: Object.freeze({
      food: 0.004, //   ~250 ticks
      water: 0, //      never — a lake does not move (see memory/memories.js)
      barren: 0.006, // ~170 ticks
      danger: 0.001, // ~1000 ticks
    }),
  }),
  // Population metrics (see metrics/metrics.js and systems/MetricsSystem.js).
  // Pure observation: aggregates the population into distributions, rates, and
  // selection differentials, and writes no organism state. Staggered, because
  // a full aggregate is an O(N) pass and a summary view needs nothing like
  // tick resolution.
  metrics: Object.freeze({
    windowTicks: 500, // how far back births and deaths are counted
    historyLength: 120, // bounded time-series samples kept (≈ 6000 ticks)
    updateInterval: 50,
  }),
  // Heredity (see traits/genetics.js). Founders sample a genome; every animal
  // born in-world inherits one allele per locus from each parent, with a chance
  // of mutation. Expression charges antagonistic traits against each other
  // (bigger costs speed, faster costs efficiency, bolder costs caution) —
  // without that, selection would ratchet every trait toward its maximum.
  genetics: Object.freeze({
    mutationRate: 0.08, // chance an inherited allele is perturbed
    mutationStep: 0.12, // largest single perturbation
  }),
  // Individual variation (see traits/traits.js). Each animal's traits are
  // sampled once at birth as multipliers around the species mean; `spread` is
  // the half-width of each trait's triangular distribution, so 0.15 means
  // roughly ±15% at the extremes and most individuals much nearer average.
  // Behavioural traits vary more widely than physiological ones — a herd's
  // temperaments differ more visibly than its body plans. Since Step 20 this
  // spread seeds the *founding* genomes; everything after inherits.
  traits: Object.freeze({
    spread: Object.freeze({
      size: 0.18,
      speed: 0.15,
      metabolicEfficiency: 0.12,
      boldness: 0.3,
      caution: 0.3,
      exploration: 0.4,
      reproductiveInvestment: 0.2,
      // Mate choice (Step 22). Behavioural, so it varies widely like the other
      // temperaments — and it needs real variance for choosiness itself to be
      // selectable rather than a constant wearing a trait's clothes.
      choosiness: 0.3,
    }),
  }),
  // Parental care (see systems/ParentingSystem.js). A newborn depends on the
  // parent that carried it: it is provisioned with that parent's energy while
  // it stays close, is weaned at `weaningAge`, and disperses when it outgrows
  // the juvenile stage (`aging.juvenileUntil`, so the two never drift apart).
  // Care is a real cost to the parent — the transfer is lossy and the parent
  // stops giving at its own reserve floor.
  parenting: Object.freeze({
    // ⚠ **The reproducible control for neonatal concealment** (§3.14), in the
    // pattern every mechanism since migration ships. It has to live *here*, at
    // world level, and not be `aging.hiddenUntil: 0` — because a species block
    // **beats** the config (DOCS §8), so zeroing the config default leaves the
    // gazelle's own 120 standing and the "off" arm silently stays on. That is
    // exactly what happened on the first attempt to measure this, and the guard
    // that caught it is the reason this switch exists.
    //
    // False makes the whole stage vanish regardless of what any species declares:
    // no calf hides, no mother tends, and perception never asks whether anything
    // is concealed.
    concealment: true,
    weaningAge: 250, // ticks; provisioning ends here (well before independence)
    provisionRange: 2.0, // guardian must be this close to feed the juvenile
    provisionRate: 0.5, // energy drawn from the guardian per tick
    provisionEfficiency: 0.8, // fraction of it that reaches the juvenile
    parentMinEnergyFraction: 0.35, // guardian never provisions below this
    juvenileMaxEnergyFraction: 0.85, // juvenile stops taking above this
  }),
  // Aging, growth, life stages (see systems/AgingSystem.js). Ages are in
  // ticks; the demo lifespan is deliberately compressed so growth, stage
  // transitions, and age death are observable (a realistic lifespan under the
  // tick ≈ 1-minute convention would be far larger — reachable via the speed
  // multiplier). `adultMass` is supplied from the species at registration.
  aging: Object.freeze({
    birthMass: 5, // kg at birth
    maturityAge: 1000, // reaches adult mass by this age
    juvenileUntil: 400,
    subadultUntil: 1000,
    adultUntil: 6000, // adult until here, then senescent
    senescentMortalityPerTick: 0.001, // base death prob at senescence onset
    mortalityRamp: 8, // prob grows to base×(1+ramp) by maxAge
    maxAge: 12000, // death certain by here
    edibleMassFraction: 0.6,
    // Neonatal concealment (2026-07-29, PLAN-SPECIES.md §3.14). Age below which
    // a still-bonded, still-unweaned juvenile **lies hidden** instead of
    // following its guardian: it stays put, does not forage, and — if it is on
    // sheltering ground — is not reported as prey at all. See
    // `parenting/hiding.js` for the predicates and the `tend` action in
    // `DecisionSystem` for the other half, which is the mother's reason to come
    // back (A34).
    //
    // ⚠ **0 means no hidden stage, and it is exactly the identity** rather than
    // approximately it: `age < 0` is false for every animal that has ever
    // existed, so a species that says nothing here is untouched by any of it,
    // and the whole mechanism is one species' opt-in (D16, D30).
    hiddenUntil: 0,
  }),
  // Hydration / thirst (see systems/HydrationSystem.js). Animals dehydrate
  // each tick and drink at water cells; sustained dehydration damages health
  // and can kill. Water is terrain-bound (one or more lakes), so seeking water
  // is a spatially distinct behaviour from grazing.
  hydration: Object.freeze({
    // Re-tuned in Step 15, once animals could remember where they drank. Memory
    // helps but does not make thirst free: measured over 15k ticks on five
    // seeds, raising this from 0.02 to 0.035 roughly tripled visible
    // water-seeking behaviour (2.9k → 8.6k action-ticks) for a modest cost in
    // population (58 → 46 survivors, 26 → 31 dehydration deaths). 0.04 and
    // above bought little extra behaviour for markedly worse survival.
    // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4) — verdicts, so nobody re-derives
    // them. This whole block is per-species already, so a heavy animal states its
    // own numbers rather than needing a scaling rule:
    //   dehydrationRate    per-species. Correctly *not* mass-scaled: a large body
    //                      dries out more slowly per unit of reserve, but the
    //                      reserve is `maxHydration`, which is species data too.
    //   drinkRate          per-species, and the one to watch — it is a flat
    //                      refill against a 0–`maxHydration` tank, so a 600 kg
    //                      animal takes exactly as long to drink as a 6 kg one.
    //                      Left flat deliberately: with `maxHydration` also
    //                      per-species the ratio is already expressible, and
    //                      scaling both would double-count.
    //   drinkRange         correctly flat. It is a reach, not a rate; a bigger
    //                      animal standing at a lake is not meaningfully further
    //                      from it. ⚠ Sole owner of this value since 2026-07-28 —
    //                      the decision system reads it from here.
    //   dehydrationDamage  per-species; scales with nothing, by choice.
    dehydrationRate: 0.035, // hydration lost per tick
    drinkRate: 5, // hydration restored per tick while drinking
    drinkRange: 1.5, // within this distance of water → can drink
    dehydrationDamage: 0.5, // health lost per tick while hydration is 0
    edibleMassFraction: 0.6, // carcass edible mass on a dehydration death
  }),
  // Herbivory (see systems/FeedingSystem.js). An animal choosing to eat
  // removes up to `intakeRate` biomass from its cell each tick and assimilates
  // it to energy at `energyPerBiomass × efficiency`. Multiple eaters on a cell
  // contend deterministically in ascending entity-id order.
  // ⚠ A **species block** since 2026-07-28, so a browser and a grazer can differ
  // in what they get out of the same ground.
  //
  // MASS AUDIT 2026-07-28 (PLAN-SPECIES.md §4) — verdicts:
  //   intakeRate           **scaled** (fixed 2026-07-28). Was flat, so a 600 kg
  //                        animal would have cropped a cell at a 30 kg one's
  //                        rate — the same latent bug `fleshIntakeRate` had at
  //                        Step 29 (D22), left open on the herbivore side because
  //                        every herbivore was one size.
  //                        ⚠ **Not inert in the demo.** The *species* sits at
  //                        `referenceMass`, but an individual's `bodyMass` is its
  //                        `adultMass` (species mass × the heritable `size`
  //                        trait) walked up a growth curve — measured on seed 42:
  //                        5.1–33.7 kg, mass factors 0.265–1.092, so a half-grown
  //                        grazer eats ~40% less than before. Correct rather than
  //                        a regression (metabolism already scaled cost the same
  //                        way, so juveniles were being subsidised), but it is a
  //                        change to an energy source, so `massScaleIntake: false`
  //                        restores the flat behaviour as a measured control.
  //   fleshIntakeRate      **scaled** already (Step 29, the corvid).
  //   energyPerBiomass     correctly flat — the energy density of grass is a
  //   energyPerMass        property of the food, not of the animal eating it.
  //   efficiency           per-species, correctly unscaled: assimilation is a
  //   carnivoreEfficiency  digestive trait, and a ruminant's advantage is a
  //                        species fact rather than a function of mass.
  //   carcassRange         correctly flat. A reach, not a rate.
  feeding: Object.freeze({
    intakeRate: 0.6, // biomass units eaten per tick per animal, ×(mass/reference)^0.75
    massScaleIntake: true, // false = the pre-2026-07-28 flat rate (the control)
    energyPerBiomass: 10, // energy units per biomass unit
    efficiency: 0.6, // fraction of food energy assimilated (≤ 1)
    // Carnivore feeding (Step 16): flesh is far denser than grass and is
    // assimilated more efficiently, so a predator eats rarely and in bulk.
    fleshIntakeRate: 1.5, // edible mass eaten per tick
    energyPerMass: 12, // energy units per unit of edible mass
    carnivoreEfficiency: 0.75,
    carcassRange: 1.5, // how far a carnivore reaches for a carcass
  }),
  // Forage guilds — grass maturity (see habitat/forage.js).
  // PLAN-SPECIES.md §3.3, phase 9.
  //
  // A species states `forage: { preferredBiomass, span }` — the tallest grass it
  // still does well on, in the same biomass units as `feeding.intakeRate` — and the
  // three grazers of the African roster stack into the real grazing succession from
  // two numbers apiece: zebra take the tall coarse sward, wildebeest the regrowth
  // behind them, gazelle the short green flush behind them. Zero new state, and not
  // even a new grid read: **standing crop is grass height**, so the biomass field
  // already carries the axis.
  //
  // ⚠ PLAN-SPECIES §3.3 proposed the *ratio* `biomass / capacity` instead. It was
  // built, measured, and rejected — a ratio knows nothing about absolute abundance,
  // so in a low-capacity world every ungrazed cell reads as rank grass, and the
  // sparse-forage selection sandbox lost the gazelle outright. See
  // `habitat/forage.js`.
  //
  // ⚠ **The off switch has to live here and not in `feeding`.** `feeding` is a
  // species block, and a species block *beats* the config (DOCS §8) — so an
  // `enabled: false` inside one would leave the gazelle's own preference standing
  // and the "off" arm would silently stay on. That is exactly what happened to
  // phase 8's first A/B (`aging.hiddenUntil`), and it is why `forage` is an
  // always-per-species *field* beside this global section, in the shape of
  // `migration` and `groups` rather than of a block.
  forage: Object.freeze({
    // False makes every cell exactly neutral whatever any species declares: no
    // quality is computed and the world is the phase-8 world. The measured control
    // this change was gated against — twice, since the first two designs failed it.
    enabled: true,
    // Quality of the coarsest forage in the world, as a fraction of the best.
    //
    // ⚠ **A floor rather than 0, deliberately: preference is a discount, never a
    // veto.** The utility it multiplies is already scaled by hunger, so a
    // comfortable animal moves on from rank grass and a starving one eats it — at
    // 0 a short-grass grazer would starve standing on food in a green spring, which
    // is a cliff, not a preference.
    //
    // ⚠ **0.55 rather than 0.3, and the difference was measured** — two ten-seed
    // gates against the same mechanism-off control (2026-07-29):
    //
    //   floor 0.30   gazelle  9/10 seeds, mean 59.8 · stalker 8/10 · hyena 7/10 · vulture 102.6
    //   floor 0.55   gazelle  8/10 seeds, mean 94.3 · stalker 9/10 · hyena 9/10 · vulture 119.1
    //   control      gazelle 10/10 seeds, mean 81.5 · stalker 9/10 · hyena 10/10 · vulture 133.5
    //
    // At 0.55 the gazelle mean is *above* the control's and the two carnivores are
    // level with it; at 0.30 every species is materially down. ⚠ The one thing the
    // softer setting does not buy back is the last seed or two of gazelle survival —
    // it lost seeds 7 and 10 late (t13291, t14275) where 0.30 lost seed 8 — and D14's
    // rule is that a one-seed difference on a population whose control range is
    // 15–184 is the signature of noise, not of the parameter. Recorded rather than
    // tuned against.
    qualityFloor: 0.55,
  }),
  // Habitat preference (see habitat/habitat.js). DOCS A49, PLAN-SPECIES.md §3.4,
  // phase 9. One weight per terrain name — 1 neutral, above attracts, below
  // repels, unnamed neutral — declared as an always-per-species `habitat` field
  // for the same reason `forage` is (see above).
  //
  // ⚠ Consumed at **one** chokepoint, the long-range cue, and the two others §3.4
  // named were declined on measurement rather than on taste: scaling `rest` by the
  // ground underfoot would have been born near-inert (rest is 0.8–1.6% of
  // animal-ticks, measured 2026-07-29), and weighting the home range would turn a
  // measurement into a preference. See habitat/habitat.js.
  habitat: Object.freeze({
    enabled: true, // false = every terrain neutral for every species (the control)
    // How hard the habitat drift may bend a wander heading, and the weight
    // difference that counts as a full-strength signal. ⚠ It **bends** whichever
    // need-cue won rather than competing with it (see systems/MigrationSystem.js),
    // so the pull toward food keeps exactly the strength it had and only its
    // direction leans; the cap is how far it may lean. Unlike the forage and water
    // cues this one is *not* throttled by a need — habitat preference is what an
    // animal acts on when nothing is urgent, which is precisely the case those two
    // cues fall silent in.
    biasWeight: 0.35,
    cueReference: 0.3,
  }),
  // ⚠ **`behavior` and `decision` are one mechanism split in two** (2026-07-28,
  // PLAN-SPECIES.md §3.1). Both are consumed by `systems/DecisionSystem.js`; the
  // split is about *ownership*, not about which system reads them.
  //
  //   `behavior`  what this animal wants, and how it weighs competing needs.
  //               A **species block** — a skittish gazelle and a bold buffalo are
  //               different animals, and a lion and a leopard sit at opposite
  //               ends of `herdWeight`, which is the single number separating a
  //               pride from a solitary cat.
  //   `decision`  the machinery of committing to and executing a choice —
  //               commitment windows, geometry probes, thresholds on other
  //               parameters. **Global**, and deliberately so.
  //
  // The line matters more than where exactly it falls. Handing a species file
  // `minCommitTicks` or `fleeLookahead` would let it change how the *engine*
  // works rather than what the animal is like, and once one species tunes those
  // the demo stops being one world with N animals in it and becomes N
  // separately-tuned simulations sharing a map. A field can be moved across the
  // line later; erasing the line cannot be undone.
  behavior: Object.freeze({
    hungerWeight: 1.0,
    thirstWeight: 1.0, // thirst competes with hunger; whichever need is greater wins
    restBias: 0.3, // rest attractiveness, scaled by fullness
    wanderBias: 0.35, // baseline exploration utility
    explorationRate: 0.05, // chance to wander regardless of utilities
    mateWeight: 0.55, // seeking a mate when reproductively ready
    followWeight: 0.7, // a dependent juvenile keeping up with its guardian
    // Neonatal concealment (2026-07-29, PLAN-SPECIES.md §3.14). The two halves of
    // the hidden-fawn stage, and they pull in opposite directions on purpose.
    //
    // `hideWeight` is how strongly a hidden calf stays put. It must clear every
    // discretionary want (wander 0.35, herd 0.6, rest ~0.3) and every *directed*
    // one it would otherwise have, because lying still is the whole behaviour —
    // but it must lose to `flee`, because a fawn that has actually been found
    // should bolt rather than die where it lies.
    //
    // ⚠ `tendWeight` is the interesting one: it is the **A34 experiment**. DOCS
    // A34 records that site fidelity is near-inert because it competes with
    // foraging and has no reason, and names the lever — "give patrol a reason:
    // food worth returning to, or a den." A hungry hidden calf is that reason,
    // and the weight is deliberately *scaled by how hungry the calf is*, so it
    // is zero for a full calf and urgent for a starving one. That is what stops
    // it becoming another behaviour that either never fires or always wins.
    hideWeight: 1.0,
    tendWeight: 1.6,
    // Predation (Step 16). Fleeing outranks everything — a grazing animal that
    // spots a predator stops grazing — and grows more urgent the closer the
    // threat. Hunting is gated on real hunger and a usable sprint budget, so a
    // fed or exhausted predator leaves prey alone.
    fleeWeight: 2.0,
    // Sociality (Step 23). Herding is deliberately weak — it ranks below every
    // real need, so a hungry animal grazes its way out of the group and a fed
    // one drifts back in, which is what makes a herd loose and living rather
    // than a rigid formation. Defending young outranks even fleeing, because an
    // adult that has decided to stand over its juvenile has decided not to run.
    herdWeight: 0.6,
    herdDistance: 2.0, // inside this there is nothing to close
    defendWeight: 2.6,
    defendRange: 5.0, // how far an adult will go to interpose
    // Mobbing (A33, phase 10): how urgently an adult turns on a predator that has
    // committed to a *groupmate*, as opposed to `defendWeight`, which is the same
    // action triggered by its own young. Two numbers because they are two
    // different risks — a parent's calf is worth more to it than a herdmate is —
    // and one action, because standing and facing a predator is one behaviour.
    //
    // ⚠ **0 for every shipped species, and 0 means the mechanism never runs**:
    // no ward is looked for and no grid is touched. A mobbing species wants this
    // *above* `fleeWeight` (2.0) or it will run instead, which is the whole
    // point — mobbing competes with fleeing, never with foraging. The buffalo
    // arrives in phase 11 and is what it will be tuned against.
    mobWeight: 0,
    // Caching a kill in a tree (phase T3). ⚠ **0 for every species but the
    // leopard**, and the whole expression short-circuits on it, so this is one
    // comparison and then nothing for the rest of the roster — the shape
    // `mobWeight` and `cooperationWeight` both have.
    //
    // Scaled by `1 - hunger` where it is read, so it never needs a threshold:
    // a comfortable cat secures the kill, a desperate one eats it. The weight
    // is sized against `eat` (`eatBias` 0.2 + hunger), not against the other
    // behaviour weights.
    cacheWeight: 0,
    // Territory (Step 24). Patrolling is what an animal does *instead of*
    // wandering aimlessly, so it sits just above wander and below everything
    // else; retreating off a rival's ground beats settling down on it but never
    // beats eating, drinking, or running.
    patrolWeight: 0.55, // must clear `wanderBias` (0.35) — patrol replaces wander
    retreatWeight: 0.7,
    huntWeight: 1.4,
    stalkDiscount: 0.8, // stalking is worth slightly less than committing
    chaseRange: 4.0, // inside this, stalking becomes a sprint
    minHungerToHunt: 0.25,
    minHuntStamina: 15,
    // Memory (Step 15) is a fallback for what the animal cannot see, so it is
    // weighted below the senses: a remembered patch may already be grazed out.
    recallWeight: 0.8, // remembered need vs. the same need in plain sight
    dangerRadius: 6, // how wide a berth to give somewhere remembered as dangerous
    // Moved out of `locomotion` 2026-07-28: how hard the weather pulls an animal
    // toward cover is biology (a thick coat cares less), and nothing but the
    // decision system read it. ⚠ `shelterRelief` did **not** move — it is shared
    // with metabolism through the `thermalStress` chokepoint precisely so the
    // system that charges for stress and the one that decides to walk out of it
    // cannot drift, and splitting it per-species would break that.
    shelterWeight: 0.9, // how strongly the weather pulls an animal toward cover
  }),
  // Utility-based action selection (see systems/DecisionSystem.js). What remains
  // here is machinery: how long a commitment holds, how far a geometry probe
  // looks, and thresholds defined against *other* parameters. See the note above
  // `behavior` for why these are global.
  decision: Object.freeze({
    eatBias: 0.2, // bonus to eat when standing on food (so eat beats seek there)
    drinkBias: 0.2, // bonus to drink when at water
    // Mate choice (Step 22): quality forfeited per unit of distance when the
    // choosing sex picks which perceived candidate to walk toward. Small, so a
    // slightly better mate a few cells further off is worth the walk and a
    // marginally better one at the edge of perception is not.
    mateDistanceWeight: 0.04,
    followDistance: 1.5, // inside this distance there is nothing to close
    // ⚠⚠ **A32's last named lever, built, measured, and shipped at zero —
    // because it is not the lever** (phase 10). An adult only interposes for a
    // juvenile *nearer the predator than it is*; DOCS A32 named relaxing that
    // test as the one remaining candidate after territory and the hidden-fawn
    // stage both failed to move it. This is the relaxation, in world units: how
    // much further from the predator than itself a parent will tolerate its calf
    // being and still step in.
    //
    // Measured 2026-07-30, demo, 2000 ticks × seeds 1/2/42, `entity.defended`
    // events: strict 1/1/0 · slack 2 → 0/1/0 · slack 6 → 0/1/1 · **no test at
    // all** (slack ∞) → 0/1/1. Removing the clause outright does not move the
    // thing it was blamed for, so relaxing it part-way certainly does not — and
    // slack 2 still perturbed the demo enough to flip a phase-9 single-seed
    // assertion. A knob that changes the world and buys nothing ships at its
    // identity.
    //
    // The measurement that replaced the diagnosis is in DOCS §1.2 A32: predators
    // commit to a juvenile in only 6–9% of hunter-ticks, and in **1–4 of those
    // per 2000 ticks** is a living parent within the 6 units it would need to
    // perceive the predator at all. The ceiling is a handful of opportunities per
    // 2000 ticks before any geometry test runs, so no geometry test can be the
    // fix. Kept as a knob, at 0, because a slow heavy species (buffalo, phase 11)
    // has a real reason to want one and this is now the measured way to ask.
    interposeSlack: 0,
    // ⚠ **Which calf a parent defends: the one the predator is actually going
    // for** (phase 10). Nothing checked this before, so a mother could stand over
    // the calf nearest the threat while the hunter closed on a different animal —
    // a defense with no attempt to affect. One O(1) read of the hunter's
    // `huntTargetId`, and it is the *same* predicate mobbing uses to pick its
    // ward, which is what keeps the two halves of `defend` consistent.
    //
    // ⚠ Measured effect in the demo: **within noise** (2000 ticks × 3 seeds moved
    // one gazelle on one seed), for the reason above — the case it corrects is
    // itself rare. It ships on anyway because it is the more correct rule and
    // because the species it will matter for is the buffalo cow in phase 11.
    // `false` is the pre-phase-10 behaviour and the control it was swept against.
    defendTargeted: true,
    // Edge-aware fleeing. A prey driven toward a world edge runs ALONG it rather
    // than smearing into the corner (`fleeWallMargin` is how close to an edge
    // that kicks in); a prey walled into a true corner or terrain pocket judges
    // open room out to `fleeLookahead` and breaks past the predator when no
    // safer heading has room left. These fix the residual edge/corner
    // congregation the movement system's wall-reflection (C8) could not: flee
    // re-commits every tick, so the escape has to be boundary-honest at the
    // decision layer, not patched one step later. `fleeWallMargin: 0` restores
    // the pre-fix "straight away from the threat" behaviour.
    fleeWallMargin: 6,
    fleeLookahead: 8,
    // ⚠⚠ **Obstacle deflection for directed actions** (2026-08-01) — the same
    // wall-awareness as the two lines above, for the ten actions that never had
    // it. `seekWater`, `recallWater`, `seekFood`, `recallFood`, `seekMate`,
    // `followParent`, `tend`, `shelter`, `leaveThicket` and `stalk` all aim
    // straight at a target and re-commit every tick, which meant the movement
    // system's "blocked → turn around → re-commit" recovery was thrown away
    // wholesale: an animal aimed at water through a rock re-aimed at the same
    // rock until it died. Only `flee` and `wander` were ever exempt, because one
    // computes an `escapeHeading` and the other reads its previous intent.
    //
    // Measured on seed 1, 5600 ticks, blocked-and-immobile share of directed
    // animal-ticks: demo defaults **15.6%** before, and at `rocks=6 thickets=8`
    // **40.6%**, with unbroken stalls of 372 and 964 ticks respectively — the
    // latter holding `seekWater` at 0% hydration. The refusal was crowding 45.8%
    // / rock 35.3% / thicket 16.0% in the demo world. See DOCS §9 Decision.
    //
    // `detourEnabled: false` restores the pre-fix behaviour exactly and is the
    // control arm; `detourCommitTicks` is how long a chosen way-around is held
    // (shorter and the animal alternates into and away from the obstacle;
    // longer and it walks past its target), and `detourLookahead` is how far
    // open room is judged, in world units.
    detourEnabled: true,
    detourCommitTicks: 6,
    detourLookahead: 6,
    // How many range radii the patrol pull ramps over before reaching full
    // strength, and the most consequential number in this step. **Patrolling
    // competes with wandering**, and wandering is how an animal finds the next
    // patch of food once it has eaten this one — so an animal that keeps going
    // home keeps not finding food. Measured over 15k ticks on five seeds:
    //
    //   patrol effectively off (or ramped over 6 radii)  4/5 seeds alive,
    //                                                    grazers 52–165
    //   ramped over 1.5 radii                            2/5, grazers  6–162
    //   ramped over 3 radii                              2/5, grazers 13–148
    //
    // (For reference, with the whole territory layer inert the demo is 5/5, so
    // marking and disputes cost about one seed and routine patrolling cost two
    // more.) At 6 the behaviour still exists — an animal that ends up six range
    // radii from home does turn round — but it never fires in normal foraging,
    // which is the only setting this two-species demo can afford. The mechanism
    // is exercised at a tighter ramp in test/territory.test.js.
    //
    // ⚠ Global rather than per-species deliberately: it is a *shape* on
    // `territory.rangeRadius` (which is already per-species), so a wide-ranging
    // animal already patrols over more ground without restating this.
    patrolSpanFactor: 6,
    // Must sit **below** `territory.markStrength` (0.35): a cell holding a
    // single fresh mark is exactly at that value and starts decaying
    // immediately, so a threshold equal to it meant newly marked ground did not
    // read as occupied at all. A threshold on another parameter, so it belongs
    // beside the thing it is a threshold on — see D11.
    intrusionThreshold: 0.2,
    huntCooldownTicks: 60, // recovery pause after a capture attempt
    recallRange: 60, // furthest a remembered place is worth walking to
    recallDistanceWeight: 0.15, // how sharply distance discounts a memory
    // ⚠ **Two values used to be restated here** with comments saying they
    // matched their real home, which is exactly the shape D11 warns about: when
    // one parameter must equal another, two copies is the failure case, not the
    // neutral one. Both now live in one place, and the decision system reads
    // them from there, so a species that changes one changes both halves at
    // once:
    //   `drinkRange`   → `hydration` (a species block). Drifted, the two produce
    //                    an animal that decides it is at water and is then
    //                    refused the drink — or stands at the lake and never
    //                    chooses to drink.
    //   `carcassRange` → `feeding` (a species block). Drifted, a carnivore
    //                    decides it is on a carcass and then cannot reach it.
    minCommitTicks: 8,
    commitTickSpan: 16,
    wanderJitter: 0.5,
  }),
  // Demo *scenario* selection only (how many to spawn, which species). All
  // biology moved to species definitions (config/species/*); no per-animal
  // tuning lives here anymore.
  demo: Object.freeze({
    // The founding roster: which species the demo world starts with and how
    // many of each, walked in order. From Step 29 this is a *list*, not a pair
    // of hardcoded species slots — adding a species to the world is a line
    // here, which is what makes "a species is config, not code" checkable
    // rather than merely claimed.
    //
    // ⚠⚠ **This is the `ngorongoro-500-10x` roster (2026-08-04)**, and it is a
    // different *kind* of number from the roster it replaced. The old counts
    // (gazelle 120, leopard 8, vulture 10, hyena 6, buffalo 35, lion 8,
    // wildebeest 30, zebra 15 — 222 animals on 160×120) were a **tuned knife
    // edge**: each one swept on ten seeds against a control until the world
    // survived, which is why the notes below read as sweep results. These are
    // instead **the real Ngorongoro Crater's census, scaled** — the herbivore
    // ratios are the crater's, the map is the crater at 10× (332×280 cells
    // against ~332 km²), and the shape is its rim (`terrain.roundness: 4`). The
    // provenance is observation, not a sweep.
    //
    // ⚠⚠ **Swept on 2026-08-04 (10 seeds × 15 000 ticks) and it does NOT hold the
    // old bar — deliberately.** The reading, final populations, mean across seeds:
    //
    //   gazelle 169.5 (10/10 seeds)   wildebeest 168.0 (10/10)
    //   zebra   147.2 (10/10)         buffalo     96.5 (10/10)
    //   lion     17.1 (10/10)         hyena        3.4 (7/10)
    //   leopard   0.1 (1/10)          vulture      4.7 (1/10)
    //
    // The four grazers and the lion are robust; **the leopard is gone on 9 of 10
    // seeds and the vulture on 9 of 10** (its one surviving seed carries 47 birds,
    // so the layer works where it takes hold at all), and the hyena persists thin.
    // Under the old doctrine that is a failed gate and these counts would have
    // been re-tuned until it passed.
    //
    // ⚠ **The doctrine changed with this roster, by decision (2026-08-04): the
    // demo is no longer maintained as a knife edge.** Adding mechanism now takes
    // priority over holding every species alive on every seed, so `npm run sweep`
    // is a *reading* to record rather than a bar to pass. What it must never
    // become is a reading nobody takes — see §20 and A81, which carry this result
    // and what would move it (the obvious lever is founder counts: 3 leopards and
    // 5 vultures on a map ~4.8× the old one are very few animals).
    //
    // ⚠ Order is load-bearing and matches the preset file exactly: founders are
    // walked in this order, so ids, spawn order and every downstream random draw
    // depend on it. Booting the demo and loading `ngorongoro-500-10x` must
    // produce the same world, and a reordered roster silently breaks that.
    //
    // §1.4 D14 still applies: five seeds cannot resolve a one-seed difference
    // here, so re-measure on ten before changing any of them.
    founding: Object.freeze([
      // The three-tier grazing succession, at crater ratios: wildebeest are the
      // most numerous animal in the real caldera, and the gazelle — the tuned
      // demo's dominant herbivore at 120 — is now the *smallest* of the four
      // cohorts. ⚠ **Herbivore intake is mass-scaled, so a count is not a
      // headcount**: a 200 kg wildebeest eats 4.15× a gazelle and a 300 kg zebra
      // 5.62×, so this roster's demand on the grass field is several times the
      // old one's even before the map's own area is counted.
      Object.freeze({ speciesId: 'herbivore.gazelle', count: 60 }),
      Object.freeze({ speciesId: 'herbivore.wildebeest', count: 219 }),
      Object.freeze({ speciesId: 'herbivore.zebra', count: 97 }),
      // ⚠ **Buffalo is a density, not an appetite.** Mobbing needs
      // `mobbing.minMobbers` adults within six units of the animal under attack,
      // so a herd thin enough to graze alone cannot defend itself however well
      // the mechanism resolves — measured at 20 buffalo on the old 160×120 map,
      // mobbing reached **zero** capture attempts. 97 is well clear of that
      // count, but density is what the mechanism actually reads and this map is
      // ~4.8× the area, so the margin is smaller than the number suggests.
      Object.freeze({ speciesId: 'herbivore.buffalo', count: 97 }),
      // The leopard: solitary, and deliberately rare in the crater. It declares
      // no group size, so `config.cohorts` scatters it where the lion is founded
      // as prides (see ACTION-ITEMS A80 for what clustering costs it).
      Object.freeze({ speciesId: 'predator.leopard', count: 3 }),
      // ⚠ The pride, and the same density argument as the buffalo: cooperative
      // capture is counted from lions committed to one quarry, which needs lions
      // near each other. On the old map 8 was the count at which cooperation
      // fired at all.
      Object.freeze({ speciesId: 'predator.lion', count: 10 }),
      // An obligate scavenger, added in Step 29 with no engine changes
      // whatsoever — a carnivore that declares no prey, so it can only eat what
      // is already dead. Small, because carrion is a thin and unreliable living,
      // and since phase V1 a flyer, so it reaches the leopard's cached kills.
      Object.freeze({ speciesId: 'scavenger.vulture', count: 5 }),
      // A facultative scavenger that hunts gazelle and steals kills, and the
      // first species in the world to form persistent groups (PLAN-SPECIES.md
      // phase 7). On the old roster it was swept on ten seeds × 15 000 ticks
      // against a hyena-free control, and the first sweep **failed** — see the
      // species file for why. It cost the stalker three seeds in ten there and
      // held the gazelle at about two thirds of its hyena-free abundance; on a
      // roster where the gazelle is no longer the dominant grazer, that reading
      // does not transfer.
      Object.freeze({ speciesId: 'scavenger.hyena', count: 9 }),
    ]),
  }),
});

/**
 * Merge configuration overrides over a base config, one level deep per
 * section. Returns a new plain (unfrozen, serializable) object.
 * @param {object} base
 * @param {object} [overrides]
 */
export function mergeConfig(base, overrides = {}) {
  const merged = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(overrides ?? {})]);
  for (const key of keys) {
    const baseValue = base[key];
    const overrideValue = overrides?.[key];
    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isObject(baseValue) || isObject(overrideValue)) {
      merged[key] = { ...(baseValue ?? {}), ...(overrideValue ?? {}) };
    } else {
      merged[key] = overrideValue ?? baseValue;
    }
  }
  return merged;
}
