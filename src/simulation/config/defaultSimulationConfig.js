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
  // Carcasses and decay (see systems/CarcassSystem.js). A body is a resource on
  // a clock: it passes through decay stages, its flesh is worth less at each
  // one, and it leaves the world when it is either eaten clean or fully rotted.
  // Whatever mass is left when it goes returns to the cell as biomass, closing
  // the death→nutrient loop opened in Step 6.
  carcass: Object.freeze({
    decayTicks: 3000, // death to fully rotted (~2 in-world days)
    nutrientReturn: 0.5, // biomass returned per unit of remaining edible mass
    updateInterval: 5, // decay stages are coarse; no need to check every tick
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
  }),
  // Sprinting (see systems/MovementSystem.js and MetabolismSystem.js). Chases
  // and escapes trade stamina for speed; stamina recovers whenever an animal is
  // not sprinting, which is what makes a failed chase cost a predator time as
  // well as energy.
  locomotion: Object.freeze({
    sprintMultiplier: 1.6, // speed while sprinting
    sprintStaminaCost: 2.5, // stamina per sprinting tick (~40 ticks from full)
    staminaRecoveryPerTick: 0.6, // regained per non-sprinting tick (~165 to refill)
  }),
  // Bounded, decaying spatial memory (see memory/memories.js and
  // systems/MemorySystem.js). Animals remember where they ate, drank, searched
  // in vain, and met danger. Decay rates are per kind and deliberately unequal:
  // a lake stays put, a grass patch may already be grazed out, and "nothing
  // here" expires fastest because vegetation regrows.
  memory: Object.freeze({
    maxMemories: 8, // hard cap per animal (also enforced in memory/memories.js)
    forgetBelow: 0.05, // strength at which a memory is dropped entirely
    updateInterval: 5, // decay runs every N ticks, scaled so the rate is unchanged
    decay: Object.freeze({
      food: 0.004, //   ~250 ticks
      water: 0.0008, // ~1250 ticks
      barren: 0.006, // ~170 ticks
      danger: 0.001, // ~1000 ticks
    }),
  }),
  // Individual variation (see traits/traits.js). Each animal's traits are
  // sampled once at birth as multipliers around the species mean; `spread` is
  // the half-width of each trait's triangular distribution, so 0.15 means
  // roughly ±15% at the extremes and most individuals much nearer average.
  // Behavioural traits vary more widely than physiological ones — a herd's
  // temperaments differ more visibly than its body plans. Step 20 replaces
  // this sampling with inheritance and moves the ranges into a genetics layer.
  traits: Object.freeze({
    spread: Object.freeze({
      size: 0.18,
      speed: 0.15,
      metabolicEfficiency: 0.12,
      boldness: 0.3,
      caution: 0.3,
      exploration: 0.4,
      reproductiveInvestment: 0.2,
    }),
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
    // Re-tuned in Step 15, once animals could remember where they drank. Memory
    // helps but does not make thirst free: measured over 15k ticks on five
    // seeds, raising this from 0.02 to 0.035 roughly tripled visible
    // water-seeking behaviour (2.9k → 8.6k action-ticks) for a modest cost in
    // population (58 → 46 survivors, 26 → 31 dehydration deaths). 0.04 and
    // above bought little extra behaviour for markedly worse survival.
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
  feeding: Object.freeze({
    intakeRate: 0.6, // biomass units eaten per tick per animal
    energyPerBiomass: 10, // energy units per biomass unit
    efficiency: 0.6, // fraction of food energy assimilated (≤ 1)
    // Carnivore feeding (Step 16): flesh is far denser than grass and is
    // assimilated more efficiently, so a predator eats rarely and in bulk.
    fleshIntakeRate: 1.5, // edible mass eaten per tick
    energyPerMass: 12, // energy units per unit of edible mass
    carnivoreEfficiency: 0.75,
    carcassRange: 1.5, // how far a carnivore reaches for a carcass
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
    // Predation (Step 16). Fleeing outranks everything — a grazing animal that
    // spots a predator stops grazing — and grows more urgent the closer the
    // threat. Hunting is gated on real hunger and a usable sprint budget, so a
    // fed or exhausted predator leaves prey alone.
    fleeWeight: 2.0,
    huntWeight: 1.4,
    stalkDiscount: 0.8, // stalking is worth slightly less than committing
    chaseRange: 4.0, // inside this, stalking becomes a sprint
    minHungerToHunt: 0.25,
    minHuntStamina: 15,
    huntCooldownTicks: 60, // recovery pause after a capture attempt
    carcassRange: 1.5, // how close a carnivore must be to eat (matches feeding)
    // Memory (Step 15) is a fallback for what the animal cannot see, so it is
    // weighted below the senses: a remembered patch may already be grazed out.
    recallWeight: 0.8, // remembered need vs. the same need in plain sight
    recallRange: 60, // furthest a remembered place is worth walking to
    recallDistanceWeight: 0.15, // how sharply distance discounts a memory
    dangerRadius: 6, // how wide a berth to give somewhere remembered as dangerous
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
    animalCount: 120,
    speciesId: 'herbivore.grazer',
    // Predators (Step 16, re-tuned in Step 18). These counts are measured, not
    // guessed. Step 18 changed the economics fundamentally: before carcasses
    // decayed, the ever-growing pile of bodies was a free larder that kept
    // predators fed without hunting, and the old 60/4 balance quietly depended
    // on it. With decay on, predators must actually hunt, and at those small
    // numbers the system is bistable — 1–3 predators starve out, 4 wipe the
    // grazers out. Scaling both cohorts up is what restores a real cycle:
    // measured over 15k ticks on five seeds, 120/8 leaves both species alive in
    // all five (roughly 74–255 grazers against 4–13 predators). Nothing
    // enforces that balance — it emerges from encounter rates, capture odds,
    // carcass availability, and lifespan.
    predatorCount: 8,
    predatorSpeciesId: 'predator.stalker',
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
