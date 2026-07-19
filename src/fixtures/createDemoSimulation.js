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
  engine.registerSystem(new MovementSystem());
  engine.registerSystem(new FeedingSystem({ ...engine.config.feeding, maxMemories: engine.config.memory.maxMemories }));
  engine.registerSystem(
    new ReproductionSystem({
      ...engine.config.reproduction,
      birthMass: engine.config.aging.birthMass,
      traitSpread: engine.config.traits.spread,
    }),
  );
  engine.registerSystem(new ParentingSystem(engine.config.parenting));
  engine.registerSystem(new MetabolismSystem(engine.config.metabolism));
  engine.registerSystem(new HydrationSystem({ ...engine.config.hydration, maxMemories: engine.config.memory.maxMemories }));
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

/** @param {SimulationEngine} engine */
function populateDemoWorld(engine) {
  const random = engine.randomStream('worldgen');
  const { animalCount, speciesId } = engine.config.demo;
  const species = getSpecies(speciesId);
  // Initial ages come from a separate stream so adding them never shifts the
  // worldgen positions (which the `worldgen` stream draws in a fixed order).
  const ageRandom = engine.randomStream('demogen.age');
  // Traits come from their own stream too, so the founding population's
  // individuality never shifts positions or ages (and vice versa).
  const traitRandom = engine.randomStream('traits');
  const traitSpread = engine.config.traits.spread;
  for (let i = 0; i < animalCount; i += 1) {
    const { x, y } = passableSpawnPosition(engine, random);
    const heading = random.float(0, TWO_PI);
    const energy = species.maxEnergy * random.float(species.initialEnergyFraction.min, species.initialEnergyFraction.max);
    // Spread initial ages across juvenile→adult so the starting population
    // isn't synchronized and shows a mix of life stages; body mass follows the
    // growth curve for the age.
    const age = Math.floor(ageRandom.float(0, 1500));
    // Every founder is an individual (Step 14): its own adult size, speed, and
    // temperament, all resolved from the species mean at creation.
    const traits = sampleTraits(traitRandom, traitSpread);
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
      energy,
      maxHealth: species.maxHealth,
      health: species.maxHealth,
      maxHydration: species.maxHydration,
      hydration: species.maxHydration, // start fully hydrated (no extra draw)
    });
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
