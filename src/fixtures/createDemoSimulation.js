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
import { getSpecies } from '../simulation/config/species/index.js';
import { sampleTraits } from '../simulation/traits/traits.js';
import { createEngineFromSave } from '../simulation/persistence/SimulationSerializer.js';

const TWO_PI = Math.PI * 2;

/**
 * Register the demo systems. Restoring a demo save requires registering
 * exactly these systems, so keep this the single source. Execution order is
 * decided by the scheduler (phase → priority → id), not registration order.
 * @param {SimulationEngine} engine
 */
export function registerDemoSystems(engine) {
  const { growthRate, seedFloor, updateInterval } = engine.config.vegetation;
  engine.registerSystem(new VegetationSystem({ growthRate, seedFloor, updateInterval }));
  engine.registerSystem(new PerceptionSystem(engine.config.perception));
  engine.registerSystem(new MemorySystem(engine.config.memory));
  engine.registerSystem(
    new DecisionSystem({
      ...engine.config.decision,
      foodMinLevel: engine.config.perception.foodMinLevel,
      reproduction: {
        minEnergyFraction: engine.config.reproduction.minEnergyFraction,
        cooldownTicks: engine.config.reproduction.cooldownTicks,
      },
    }),
  );
  engine.registerSystem(
    new MovementSystem({ ...engine.config.locomotion, injurySpeedPenalty: engine.config.injury.speedPenalty }),
  );
  engine.registerSystem(
    new FeedingSystem({
      ...engine.config.feeding,
      injuryFeedPenalty: engine.config.injury.feedPenalty,
      maxMemories: engine.config.memory.maxMemories,
    }),
  );
  engine.registerSystem(
    new ReproductionSystem({
      ...engine.config.reproduction,
      birthMass: engine.config.aging.birthMass,
      traitSpread: engine.config.traits.spread,
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
    }),
  );
  engine.registerSystem(new ParentingSystem(engine.config.parenting));
  engine.registerSystem(
    new MetabolismSystem({ ...engine.config.metabolism, staminaRecoveryPerTick: engine.config.locomotion.staminaRecoveryPerTick }),
  );
  engine.registerSystem(new HydrationSystem({ ...engine.config.hydration, maxMemories: engine.config.memory.maxMemories }));
  engine.registerSystem(new InjurySystem(engine.config.injury));
  engine.registerSystem(new CarcassSystem(engine.config.carcass));
  // Adult mass comes from the species; the rest of the life curve from config.
  const species = getSpecies(engine.config.demo.speciesId);
  engine.registerSystem(new AgingSystem({ ...engine.config.aging, adultMass: species.bodyMass }));
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
 * @param {{position: Function, age: Function, traits: Function}} draw
 */
function spawnCohort(engine, species, count, draw) {
  for (let i = 0; i < count; i += 1) {
    const { x, y, heading, energyFraction } = draw.position();
    // Ages are spread across juvenile→adult so no cohort is synchronized;
    // body mass follows the growth curve toward this individual's adult size.
    const age = draw.age();
    const traits = draw.traits();
    const adultMass = species.bodyMass * traits.size;
    engine.world.entities.queueSpawn({
      kind: species.kind,
      speciesId: species.id,
      x,
      y,
      heading,
      age,
      traits,
      adultMass,
      bodyMass: bodyMassForAge(age, { birthMass: engine.config.aging.birthMass, adultMass, maturityAge: engine.config.aging.maturityAge }),
      lifeStage: lifeStageForAge(age, engine.config.aging),
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
  const { animalCount, speciesId, predatorCount, predatorSpeciesId } = engine.config.demo;
  // Initial ages and traits come from their own streams, so adding either never
  // shifts the worldgen positions (which draw in a fixed order).
  const ageRandom = engine.randomStream('demogen.age');
  const traitRandom = engine.randomStream('traits');
  const traitSpread = engine.config.traits.spread;

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
    traits: () => sampleTraits(traitRandom, traitSpread),
  });

  const prey = getSpecies(speciesId);
  spawnCohort(engine, prey, animalCount, draw(prey));
  if (predatorCount > 0) {
    const predator = getSpecies(predatorSpeciesId);
    spawnCohort(engine, predator, predatorCount, draw(predator));
  }
  // Flush so the initial population exists at tick 0, with entity.created events.
  engine.applyDeferredEntityChanges(0);
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
