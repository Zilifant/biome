/**
 * Deterministic demo fixture: a small world with generic wandering animals,
 * seeded terrain, and a cell-level vegetation biomass field, driven by the
 * temporary scaffolding systems plus vegetation regrowth. Used by the server,
 * the headless script, the renderer fixture generator, and the tests. Same
 * seed ⇒ same world, always.
 *
 * Vegetation is now the cell biomass layer, not plant entities — the earlier
 * inert `demo.grass` entities were removed in Step 3.
 */
import { SimulationEngine } from '../simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../simulation/systems/FeedingSystem.js';
import { HydrationSystem } from '../simulation/systems/HydrationSystem.js';
import { MetabolismSystem } from '../simulation/systems/MetabolismSystem.js';
import { AgingSystem, bodyMassForAge, lifeStageForAge } from '../simulation/systems/AgingSystem.js';
import { ReproductionSystem } from '../simulation/systems/ReproductionSystem.js';
import { ParentingSystem } from '../simulation/systems/ParentingSystem.js';
import { VegetationSystem } from '../simulation/systems/VegetationSystem.js';
import { MemorySystem } from '../simulation/systems/MemorySystem.js';
import { HuntingSystem } from '../simulation/systems/HuntingSystem.js';
import { InjurySystem } from '../simulation/systems/InjurySystem.js';
import { CarcassSystem } from '../simulation/systems/CarcassSystem.js';
import { WeatherSystem } from '../simulation/systems/WeatherSystem.js';
import { MetricsSystem } from '../simulation/systems/MetricsSystem.js';
import { SocialSystem } from '../simulation/systems/SocialSystem.js';
import { GroupSystem } from '../simulation/systems/GroupSystem.js';
import { MigrationSystem } from '../simulation/systems/MigrationSystem.js';
import { DisturbanceSystem } from '../simulation/systems/DisturbanceSystem.js';
import { EngineeringSystem } from '../simulation/systems/EngineeringSystem.js';
import { TerritorySystem } from '../simulation/systems/TerritorySystem.js';
import { DiseaseSystem } from '../simulation/systems/DiseaseSystem.js';
import { infect } from '../simulation/disease/disease.js';
import { getSpecies } from '../simulation/config/species/index.js';
import { defaultSimulationConfig } from '../simulation/config/defaultSimulationConfig.js';
import { FOUNDING_ROLE_ALIASES } from '../protocol/commands.js';
import { sampleGenome, expressGenome } from '../simulation/traits/genetics.js';
import { Sexes } from '../simulation/mating/mateChoice.js';
import { createEngineFromSave } from '../simulation/persistence/SimulationSerializer.js';

const TWO_PI = Math.PI * 2;

/**
 * Register the demo systems. Restoring a demo save requires registering
 * exactly these systems, so keep this the single source. Execution order is
 * decided by the scheduler (phase → priority → id), not registration order.
 * @param {SimulationEngine} engine
 */
export function registerDemoSystems(engine) {
  const { growthRate, seedFloor, diebackRate, updateInterval } = engine.config.vegetation;
  engine.registerSystem(new WeatherSystem(engine.config.environment));
  engine.registerSystem(new VegetationSystem({ growthRate, seedFloor, diebackRate, updateInterval }));
  // Priority 10 in `environment`: after weather (-10), before vegetation growth
  // (0), so a fire burns the field before the same tick regrows it.
  engine.registerSystem(
    new DisturbanceSystem({
      ...engine.config.disturbance,
      edibleMassFraction: engine.config.metabolism.edibleMassFraction,
      maxMemories: engine.config.memory.maxMemories,
    }),
  );
  // Priority 20 in `environment`: last of the environment systems, and before
  // the `movement` phase whose results it reads next tick.
  engine.registerSystem(new EngineeringSystem(engine.config.engineering));
  engine.registerSystem(
    new PerceptionSystem({
      ...engine.config.perception,
      // Whether a hidden calf on sheltering ground is invisible to a hunter
      // (PLAN-SPECIES.md §3.14). Wired from `config.parenting`, its one home, and
      // read by this system and the decision system — ⚠ **not** expressible as
      // `aging.hiddenUntil: 0`, which a species overrides (DOCS §8).
      concealment: engine.config.parenting.concealment,
    }),
  );
  engine.registerSystem(new MemorySystem(engine.config.memory));
  // Runs at priority -10 in the `decision` phase, i.e. ahead of the decision
  // system, which consumes the group summary it builds.
  engine.registerSystem(new SocialSystem(engine.config.social));
  // Priority -8: after the herd labels are settled, before anything that would
  // score an action on membership. ⚠ Different mechanism from the line above —
  // `SocialSystem` owns the positional label, this owns the persistent record
  // (PLAN-SPECIES.md §3.8). Skipped entirely when disabled, which is the
  // reproducible control the first clan-forming species will be measured
  // against. Inert either way today: no shipped species forms persistent groups,
  // so the system returns on its first branch every tick.
  if (engine.config.groups.enabled) {
    engine.registerSystem(new GroupSystem(engine.config.groups));
  }
  // Priority -5: after sociality, still ahead of the decision system. It writes
  // no action — only the drift the decision system folds into a wander. Skipped
  // entirely when migration is disabled, which (with `disperses` below) is the
  // Step 25 control the step was measured against.
  if (engine.config.migration.enabled) {
    engine.registerSystem(
      new MigrationSystem({
        ...engine.config.migration,
        // Grass maturity and habitat (phase 9). Both cues are scored inside this
        // system, and both switches are wired from the global sections that own
        // them — ⚠ *not* from a species block, which a species overrides (DOCS §8).
        // The forage half rescores the existing gradient; the habitat half is a
        // third drift through the same `migrationHeading` field.
        foragePreference: engine.config.forage.enabled,
        forageQualityFloor: engine.config.forage.qualityFloor,
        habitatPreference: engine.config.habitat.enabled,
        habitatBiasWeight: engine.config.habitat.biasWeight,
        habitatCueReference: engine.config.habitat.cueReference,
      }),
    );
  }
  engine.registerSystem(
    new DecisionSystem({
      // ⚠ **Two config sections, one system.** `behavior` is what an animal
      // wants (a species block, resolved per-animal inside the system);
      // `decision` is the machinery of choosing (global). Both are spread here
      // because the system's own fields are the fallback for an animal whose
      // species is unknown — see the note above `behavior` in the config.
      ...engine.config.decision,
      ...engine.config.behavior,
      // Values that live in *another* species block and are read per-species at
      // decision time. Wired from their real home so there is no second copy to
      // drift (D11) — the system's copy is only the unknown-species fallback.
      foodMinLevel: engine.config.perception.foodMinLevel,
      // Forage guilds (PLAN-SPECIES.md §3.3): whether `eat` and `seekFood` are
      // discounted by how well a cell's grass maturity suits the species, and how
      // little the worst-matched grass is worth. From `config.forage`, which is
      // global precisely so the off switch cannot be overridden by a species.
      foragePreference: engine.config.forage.enabled,
      forageQualityFloor: engine.config.forage.qualityFloor,
      drinkRange: engine.config.hydration.drinkRange,
      carcassRange: engine.config.feeding.carcassRange,
      // Carcass possession lives in `config.carcass` and is read by two systems
      // — this one asks whether a body is worth walking to, the feeding system
      // whether it may be eaten. One config home, two wired readers, exactly as
      // `foodMinLevel` is wired into both perception and decision.
      possessionEnabled: engine.config.carcass.possessionEnabled,
      possessionRange: engine.config.carcass.possessionRange,
      possessionShare: engine.config.carcass.possessionShare,
      // Cooperative action (PLAN-SPECIES.md §3.7, phase 10). Two switches from
      // the two global sections that own them — ⚠ *not* from `hunting` or
      // `behavior`, which are species blocks a species overrides, so a switch
      // inside one is not a switch (DOCS §8). This system reads the joining half
      // of cooperation and the whole trigger for mobbing; `HuntingSystem` below
      // reads the halves that change the odds.
      cooperationEnabled: engine.config.cooperation.enabled,
      cooperationJoinRange: engine.config.cooperation.joinRange,
      mobbingEnabled: engine.config.mobbing.enabled,
      mobbingMinMobbers: engine.config.mobbing.minMobbers,
      mobbingRange: engine.config.mobbing.range,
      // Neonatal concealment (PLAN-SPECIES.md §3.14): the `tend` action asks
      // whether a mother is close enough to feed her hidden calf and whether she
      // has anything to give, and both answers belong to `ParentingSystem`. Wired
      // from their one home rather than restated, exactly as `drinkRange` is.
      provisionRange: engine.config.parenting.provisionRange,
      parentMinEnergyFraction: engine.config.parenting.parentMinEnergyFraction,
      concealment: engine.config.parenting.concealment,
      // Weather machinery: the °C thresholds stay global, and `shelterRelief` is
      // shared with metabolism through the `thermalStress` chokepoint so the
      // system that charges for stress and the one that walks out of it cannot
      // drift. (`shelterWeight` itself moved into `behavior`.)
      shelterStressThreshold: engine.config.locomotion.shelterStressThreshold,
      shelterStressSpan: engine.config.locomotion.shelterStressSpan,
      shelterRelief: engine.config.locomotion.shelterRelief,
      reproduction: {
        minEnergyFraction: engine.config.reproduction.minEnergyFraction,
        cooldownTicks: engine.config.reproduction.cooldownTicks,
        suitorMinEnergyFraction: engine.config.reproduction.suitorMinEnergyFraction,
        suitorCooldownTicks: engine.config.reproduction.suitorCooldownTicks,
      },
    }),
  );
  engine.registerSystem(
    new MovementSystem({
      ...engine.config.locomotion,
      injurySpeedPenalty: engine.config.injury.speedPenalty,
      diseaseSpeedPenalty: engine.config.disease.speedPenalty,
    }),
  );
  engine.registerSystem(
    new FeedingSystem({
      ...engine.config.feeding,
      referenceMass: engine.config.metabolism.referenceMass,
      massScalingExponent: engine.config.metabolism.massScalingExponent,
      injuryFeedPenalty: engine.config.injury.feedPenalty,
      diseaseFeedPenalty: engine.config.disease.feedPenalty,
      maxMemories: engine.config.memory.maxMemories,
      possessionEnabled: engine.config.carcass.possessionEnabled,
      possessionRange: engine.config.carcass.possessionRange,
      possessionShare: engine.config.carcass.possessionShare,
      possessionEscalationChance: engine.config.carcass.possessionEscalationChance,
      possessionFightSeverity: engine.config.carcass.possessionFightSeverity,
      possessionWinnerInjuryFraction: engine.config.carcass.possessionWinnerInjuryFraction,
      injuryHealthDamage: engine.config.injury.healthDamage,
    }),
  );
  engine.registerSystem(
    new ReproductionSystem({
      ...engine.config.reproduction,
      birthMass: engine.config.aging.birthMass,
      genetics: engine.config.genetics,
      injuryHealthDamage: engine.config.injury.healthDamage,
    }),
  );
  engine.registerSystem(
    new HuntingSystem({
      ...engine.config.hunting,
      preyInjuryChance: engine.config.injury.preyInjuryChance,
      preyInjurySeverity: engine.config.injury.preyInjurySeverity,
      predatorInjuryChance: engine.config.injury.predatorInjuryChance,
      predatorInjurySeverity: engine.config.injury.predatorInjurySeverity,
      injuryHealthDamage: engine.config.injury.healthDamage,
      maxMemories: engine.config.memory.maxMemories,
      // From `config.predation`, its one home. The hunting system only needs the
      // risk cap; the mass ratios are read per-species by perception.
      riskyMassRatio: engine.config.predation.riskyMassRatio,
      // Cooperative action, the odds half (phase 10): how many other hunters
      // count as being in on this kill, and how far around the prey a mob is
      // gathered from. The weights themselves are per-species —
      // `hunting.cooperationWeight` here and `behavior.mobWeight` in the decision
      // system — and both are 0 for every species in this world.
      cooperationEnabled: engine.config.cooperation.enabled,
      cooperationRange: engine.config.cooperation.range,
      mobbingEnabled: engine.config.mobbing.enabled,
      mobbingRange: engine.config.mobbing.range,
    }),
  );
  engine.registerSystem(
    new ParentingSystem({ ...engine.config.parenting, disperses: engine.config.migration.enabled }),
  );
  // After movement (so it marks where the animal actually ended up) and after
  // hunting and mating (so a fight over ground cannot pre-empt one over a mate).
  engine.registerSystem(
    new TerritorySystem({ ...engine.config.territory, injuryHealthDamage: engine.config.injury.healthDamage }),
  );
  engine.registerSystem(
    new MetabolismSystem({
      ...engine.config.metabolism,
      staminaRecoveryPerTick: engine.config.locomotion.staminaRecoveryPerTick,
      thermalCostFactor: engine.config.locomotion.thermalCostFactor,
      shelterRelief: engine.config.locomotion.shelterRelief,
      exposureStressThreshold: engine.config.locomotion.exposureStressThreshold,
    }),
  );
  engine.registerSystem(new HydrationSystem({ ...engine.config.hydration, maxMemories: engine.config.memory.maxMemories }));
  engine.registerSystem(new InjurySystem(engine.config.injury));
  engine.registerSystem(new DiseaseSystem(engine.config.disease));
  engine.registerSystem(new CarcassSystem(engine.config.carcass));
  // Adult mass comes from the species; the rest of the life curve from config.
  // No species' `adultMass` is baked in any more (Step 29, §1.4 A17): the
  // aging system reads each animal's own species block, and the config values
  // it is constructed with are only the fallback for an unknown species.
  engine.registerSystem(new AgingSystem(engine.config.aging));
  engine.registerSystem(new MetricsSystem(engine.config.metrics));
}

/**
 * A passable position for a founding animal (§1.4 C1). Births have always
 * placed newborns on passable cells; founders used to be able to start inside
 * rock and walk out via the movement guard. Rejection sampling keeps the draw
 * order deterministic; the deterministic scan is the fallback for a world with
 * almost no open ground.
 * @param {SimulationEngine} engine
 * @param {import('../simulation/random/SeededRandom.js').SeededRandom} random
 */
function passableSpawnPosition(engine, random) {
  const { width, height } = engine.world;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const x = random.float(0, width);
    const y = random.float(0, height);
    if (engine.world.isPassableAt(x, y)) return { x, y };
  }
  for (let cellY = 0; cellY < engine.world.terrain.height; cellY += 1) {
    for (let cellX = 0; cellX < engine.world.terrain.width; cellX += 1) {
      if (engine.world.terrain.isPassable(cellX, cellY)) return { x: cellX + 0.5, y: cellY + 0.5 };
    }
  }
  throw new Error('the world has no passable cell to spawn on');
}

/**
 * Queue one founding cohort of a species. Every founder is an individual
 * (Step 14): its own adult size, speed, and temperament, resolved from the
 * species mean at creation.
 * @param {SimulationEngine} engine
 * @param {object} species
 * @param {number} count
 * @param {{position: Function, age: Function, genome: Function}} draw
 */
function spawnCohort(engine, species, count, draw) {
  for (let i = 0; i < count; i += 1) {
    const { x, y, heading, energyFraction } = draw.position();
    // Ages are spread across juvenile→adult so no cohort is synchronized;
    // body mass follows the growth curve toward this individual's adult size.
    const age = draw.age();
    // Founders have no parents, so their genome is sampled rather than
    // inherited (Step 20); every later generation descends from these.
    const genome = draw.genome();
    const traits = expressGenome(genome);
    const adultMass = species.bodyMass * traits.size;
    engine.world.entities.queueSpawn({
      kind: species.kind,
      speciesId: species.id,
      x,
      y,
      heading,
      age,
      genome,
      traits,
      // Founding sexes alternate rather than being drawn (Step 22). A founding
      // cohort is scenario setup, not biology — the same judgement that spreads
      // founder ages across life stages so no cohort is synchronized. Drawing
      // them would put an 8-strong predator cohort one unlucky seed away from a
      // sex ratio that cannot breed, which would be a measurement artifact and
      // not an ecological finding. Everything born in-world draws its sex.
      sex: i % 2 === 0 ? Sexes.FEMALE : Sexes.MALE,
      adultMass,
      // The species' own growth curve and life stages (Step 29). This used to
      // read the global `config.aging`, which is precisely how a stalker cub
      // came to be born at the grazer's birth mass (§1.4 A17).
      bodyMass: bodyMassForAge(age, { birthMass: species.aging.birthMass, adultMass, maturityAge: species.aging.maturityAge }),
      lifeStage: lifeStageForAge(age, species.aging),
      speed: species.baseSpeed * traits.speed,
      maxEnergy: species.maxEnergy,
      energy: species.maxEnergy * energyFraction,
      maxHealth: species.maxHealth,
      health: species.maxHealth,
      maxHydration: species.maxHydration,
      hydration: species.maxHydration, // start fully hydrated (no extra draw)
      maxStamina: species.maxStamina,
      stamina: species.maxStamina,
    });
  }
}

/** @param {SimulationEngine} engine */
function populateDemoWorld(engine) {
  const random = engine.randomStream('worldgen');
  // Initial ages and genomes come from their own streams, so adding either
  // never shifts the worldgen positions (which draw in a fixed order).
  const ageRandom = engine.randomStream('demogen.age');
  const geneRandom = engine.randomStream('genetics');

  const draw = (species) => ({
    position: () => {
      const { x, y } = passableSpawnPosition(engine, random);
      return {
        x,
        y,
        heading: random.float(0, TWO_PI),
        energyFraction: random.float(species.initialEnergyFraction.min, species.initialEnergyFraction.max),
      };
    },
    age: () => Math.floor(ageRandom.float(0, 1500)),
    // Per-species trait spread (Step 29, §1.4 A13): how widely individuals of
    // *this* species vary, rather than one spread applied to every animal in
    // the world.
    genome: () => sampleGenome(geneRandom, species.traits.spread),
  });

  // The founding roster is scenario data, not code: a list of
  // `{ speciesId, count }` walked in order. Adding a species to the world is
  // therefore a config edit — which is the whole claim of this step, and is
  // what `test/species-schema.test.js` asserts by adding one.
  for (const { speciesId, count } of engine.config.demo.founding) {
    if (!(count > 0)) continue;
    const species = engine.species.require(speciesId);
    spawnCohort(engine, species, count, draw(species));
  }
  // Flush so the initial population exists at tick 0, with entity.created events.
  engine.applyDeferredEntityChanges(0);

  // Seed the outbreak (Step 25). One incubating animal is enough — the point is
  // that a disease *spreads*, not that it is handed out. Chosen by a dedicated
  // stream so adding it never shifted any other sequence, and deterministically
  // from the living population rather than by id, so it works whatever the
  // founding counts are.
  const { initialInfected, incubationTicks } = engine.config.disease;
  if (initialInfected > 0) {
    const patientRandom = engine.randomStream('disease.seed');
    const candidates = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive);
    for (let i = 0; i < initialInfected && candidates.length > 0; i += 1) {
      const index = Math.floor(patientRandom.float(0, candidates.length));
      const [patientZero] = candidates.splice(Math.min(index, candidates.length - 1), 1);
      infect(patientZero, 0, incubationTicks);
    }
  }
}

/**
 * ⚠ **Retired at protocol v29.** This used to be the bridge between a UI that
 * spoke in roles (`herbivores`, `predators`, `scavengers`) and a config keyed by
 * species id — a bijection that was only ever true by coincidence and that the
 * African roster breaks outright, since a hyena is both predator and scavenger.
 * The restart command now carries a `founding` roster and the host publishes its
 * species list, so nothing has to guess.
 *
 * What survives is the **alias map**, imported from the protocol where the
 * deprecated fields are defined, kept for exactly one version so a client still
 * sending v28 role counts is translated rather than broken. Delete both at v30.
 */

/**
 * Terrain-prevalence mapping. The restart panel offers `rocks` and `thickets` as
 * an abstract 0..MAX_TERRAIN_PREVALENCE level (DEFAULT_TERRAIN_PREVALENCE is the
 * demo's terrain); the generator wants a formation count. This is the one place
 * the two meet — the same shape as FOUNDING_ROLE_BY_SPECIES, keeping the UI and
 * protocol in "how much" while the config stays in "how many formations".
 *
 * The map is linear through the default: level DEFAULT_TERRAIN_PREVALENCE lands
 * on the demo's own formation count (rock 8, thicket 14 — kept in step with
 * defaultSimulationConfig.terrain.ridges and TerrainGrid's `thickets` default),
 * level 0 clears the terrain, and the top of the scale is several times the
 * default — enough discs that, after they overlap, the type dominates open
 * ground. The counts are restated here rather than imported so this file owns
 * the "level 2 == the demo you know" contract, exactly as DEFAULTS does in the
 * renderer's Controls.
 * @type {Record<'ridges'|'thickets', number>} config key → count at the default level
 */
const FORMATION_COUNT_AT_DEFAULT = Object.freeze({ ridges: 8, thickets: 14 });

/**
 * The prevalence level that reproduces the demo's own terrain. Restated here
 * rather than imported from the protocol (fixtures speak the simulation's
 * language, not the protocol's) — it must match the protocol's
 * DEFAULT_TERRAIN_PREVALENCE, which is what the renderer's dropdowns default to.
 */
const DEFAULT_TERRAIN_PREVALENCE = 2;

/**
 * Translate an abstract prevalence level into a generator formation count,
 * linear through the default level. Rounded to a whole formation count; a level
 * of 0 yields 0 (the type is disabled).
 * @param {number} level 0..MAX_TERRAIN_PREVALENCE
 * @param {number} countAtDefault formation count at DEFAULT_TERRAIN_PREVALENCE
 * @returns {number}
 */
function formationCountForPrevalence(level, countAtDefault) {
  return Math.round((level / DEFAULT_TERRAIN_PREVALENCE) * countAtDefault);
}

/**
 * Translate the optional world-composition fields of a `simulation.restart`
 * command into a config override merged over the demo defaults. Every field is
 * optional: an omitted dimension or role count keeps the default. Bounds are
 * the protocol's responsibility (validated before this runs); this only maps.
 * @param {{width?: number, height?: number, founding?: Array<{speciesId: string, count: number}>,
 *          herbivores?: number, predators?: number, scavengers?: number,
 *          rocks?: number, thickets?: number}} [options] `founding` is the v29
 *        roster; the three role counts are deprecated aliases (see below).
 * @returns {object} partial config for createDemoSimulation
 */
export function buildDemoConfig(options = {}) {
  const config = {};
  if (options.width !== undefined || options.height !== undefined) {
    config.world = {};
    if (options.width !== undefined) config.world.width = options.width;
    if (options.height !== undefined) config.world.height = options.height;
  }
  // Terrain prevalence maps to generator formation counts. `ridges` is rock's
  // formation count and `thickets` is the thicket count (see TerrainGrid); the
  // partial terrain block merges recursively over the defaults, so the other
  // terrain params are untouched.
  if (options.rocks !== undefined || options.thickets !== undefined) {
    config.terrain = {};
    if (options.rocks !== undefined) {
      config.terrain.ridges = formationCountForPrevalence(options.rocks, FORMATION_COUNT_AT_DEFAULT.ridges);
    }
    if (options.thickets !== undefined) {
      config.terrain.thickets = formationCountForPrevalence(options.thickets, FORMATION_COUNT_AT_DEFAULT.thickets);
    }
  }
  // ⚠ **A roster replaces the whole default roster; role aliases patch it.**
  // The two are deliberately different operations. `founding` is what the world
  // should be founded with, full stop — a species omitted from it gets none,
  // because "leave out the wildebeest" has to be expressible. The deprecated
  // role fields cannot mean that: they only ever named three counts, so they
  // override those three counts within the default roster and leave the rest
  // alone, which is exactly what they did at v28.
  if (Array.isArray(options.founding)) {
    config.demo = { founding: options.founding.map(({ speciesId, count }) => ({ speciesId, count: count ?? 0 })) };
    return config;
  }
  const roles = Object.entries(FOUNDING_ROLE_ALIASES).filter(([role]) => options[role] !== undefined);
  if (roles.length > 0) {
    const bySpecies = new Map(roles.map(([role, speciesId]) => [speciesId, options[role]]));
    config.demo = {
      founding: defaultSimulationConfig.demo.founding.map(({ speciesId, count }) => ({
        speciesId,
        // `?? count` (not `|| count`) so an explicit 0 clears a species.
        count: bySpecies.get(speciesId) ?? count,
      })),
    };
  }
  return config;
}

/**
 * Create a fully initialized demo simulation.
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {object} [options.config] overrides merged over defaults
 * @returns {SimulationEngine}
 */
export function createDemoSimulation({ seed = 42, config = {} } = {}) {
  const engine = new SimulationEngine({ seed, config, simulationId: `demo-${seed >>> 0}` });
  registerDemoSystems(engine);
  populateDemoWorld(engine);
  return engine;
}

/**
 * Restore a demo simulation from a save produced by captureSimulationState.
 * @param {object} saved
 * @returns {SimulationEngine}
 */
export function restoreDemoSimulation(saved) {
  return createEngineFromSave(saved, { registerSystems: registerDemoSystems });
}
