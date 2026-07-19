/**
 * Default simulation configuration. Configuration must stay plain,
 * JSON-serializable data — it is stored verbatim in save files.
 *
 * `demo` holds tuning for the temporary scaffolding systems and fixture; it
 * will be replaced by species/environment definitions as real systems land.
 */
export const defaultSimulationConfig = Object.freeze({
  world: Object.freeze({
    width: 128,
    height: 128,
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
  terrain: Object.freeze({
    lakes: 1,
    lakeRadiusFraction: 0.14,
    ridges: 1,
    ridgeThickness: 2,
    coverPatchDensity: 1.5,
    coverPatchRadius: 3,
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
    updateInterval: 5, // regrowth runs every N ticks (staggered)
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
    updateInterval: 1,
  }),
  // Reproduction (see systems/ReproductionSystem.js). Two adult conspecifics
  // within `matingRange`, both well fed and off cooldown, pair; the initiator
  // gestates and gives birth after `gestationTicks`. Nothing guarantees a
  // replacement rate — births emerge from encounters, energy, and lifespan.
  reproduction: Object.freeze({
    matingRange: 2.0, // distance within which two ready adults pair
    // Reproduction is deliberately expensive and slow: ~37 energy per offspring
    // and a ~2600-tick inter-birth interval against a ~5000-tick adult life.
    // These are cost parameters, not a population cap — with food abundant and
    // no predators yet (Step 16), the herbivore population still grows; cheaper
    // settings made it explode exponentially.
    minEnergyFraction: 0.8, // both parents must be at least this full
    matingEnergyCost: 12, // energy each parent spends at mating
    gestationTicks: 800, // delay from mating to birth
    birthEnergyCost: 25, // extra energy the gestating parent spends at birth
    offspringEnergyFraction: 0.6, // newborn energy as a fraction of its max
    cooldownTicks: 1800, // ticks before an animal may mate again
    birthOffset: 1.0, // how far behind the parent the newborn appears
  }),
  // Parental care (see systems/ParentingSystem.js). A newborn depends on the
  // parent that carried it: it is provisioned with that parent's energy while
  // it stays close, is weaned at `weaningAge`, and disperses when it outgrows
  // the juvenile stage (`aging.juvenileUntil`, so the two never drift apart).
  // Care is a real cost to the parent — the transfer is lossy and the parent
  // stops giving at its own reserve floor.
  parenting: Object.freeze({
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
  }),
  // Hydration / thirst (see systems/HydrationSystem.js). Animals dehydrate
  // each tick and drink at water cells; sustained dehydration damages health
  // and can kill. Water is terrain-bound (one or more lakes), so seeking water
  // is a spatially distinct behaviour from grazing.
  hydration: Object.freeze({
    // Gentle enough that most demo animals reach the lake in time (they have no
    // memory of water yet — Step 15 — so they rely on wandering into perception
    // range), while thirst still visibly diverts them to water.
    dehydrationRate: 0.02, // hydration lost per tick
    drinkRate: 5, // hydration restored per tick while drinking
    drinkRange: 1.5, // within this distance of water → can drink
    dehydrationDamage: 0.5, // health lost per tick while hydration is 0
    edibleMassFraction: 0.6, // carcass edible mass on a dehydration death
  }),
  // Herbivory (see systems/FeedingSystem.js). An animal choosing to eat
  // removes up to `intakeRate` biomass from its cell each tick and assimilates
  // it to energy at `energyPerBiomass × efficiency`. Multiple eaters on a cell
  // contend deterministically in ascending entity-id order.
  feeding: Object.freeze({
    intakeRate: 0.6, // biomass units eaten per tick per animal
    energyPerBiomass: 10, // energy units per biomass unit
    efficiency: 0.6, // fraction of food energy assimilated (≤ 1)
  }),
  // Utility-based action selection (see systems/DecisionSystem.js). Weights
  // score candidate actions from hunger and perception; `explorationRate` is
  // the chance to wander regardless (explore). Wander commitment mirrors the
  // former movement wander so paths stay coherent.
  decision: Object.freeze({
    hungerWeight: 1.0,
    thirstWeight: 1.0, // thirst competes with hunger; whichever need is greater wins
    eatBias: 0.2, // bonus to eat when standing on food (so eat beats seek there)
    drinkBias: 0.2, // bonus to drink when at water
    restBias: 0.3, // rest attractiveness, scaled by fullness
    wanderBias: 0.35, // baseline exploration utility
    mateWeight: 0.55, // seeking a mate when reproductively ready
    followWeight: 0.7, // a dependent juvenile keeping up with its guardian
    followDistance: 1.5, // inside this distance there is nothing to close
    explorationRate: 0.05, // chance to wander regardless of utilities
    drinkRange: 1.5, // within this distance of water → can drink (matches hydration)
    minCommitTicks: 8,
    commitTickSpan: 16,
    wanderJitter: 0.5,
  }),
  // Demo *scenario* selection only (how many to spawn, which species). All
  // biology moved to species definitions (config/species/*); no per-animal
  // tuning lives here anymore.
  demo: Object.freeze({
    animalCount: 8,
    speciesId: 'herbivore.grazer',
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
