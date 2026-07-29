import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

/**
 * A minimal engine with only the metabolism system — no movement, so
 * `lastMoveDistance` stays 0 and energy drains at the basal rate only, giving
 * an exact, hand-checkable trajectory.
 */
function metabolismOnlyEngine(params = {}) {
  const engine = new SimulationEngine({ seed: 1, config: { world: { width: 16, height: 16 } } });
  engine.registerSystem(
    new MetabolismSystem({
      basalRate: 0.04,
      moveCostFactor: 0.02,
      referenceMass: 30,
      massScalingExponent: 0.75,
      lowEnergyFraction: 0.25,
      edibleMassFraction: 0.6,
      ...params,
    }),
  );
  return engine;
}

function spawnAnimal(engine, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.gazelle',
    x: 8,
    y: 8,
    bodyMass: 30,
    maxEnergy: 100,
    energy: 1,
    maxHealth: 100,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('metabolism: basal energy cost', () => {
  test('a resting reference-mass animal drains exactly the basal rate per tick', () => {
    const engine = metabolismOnlyEngine();
    const id = spawnAnimal(engine, { energy: 1 });
    engine.step(1);
    assert.ok(Math.abs(engine.world.entities.get(id).energy - 0.96) < 1e-9);
    engine.step(1);
    assert.ok(Math.abs(engine.world.entities.get(id).energy - 0.92) < 1e-9);
  });

  test('basal cost scales with body mass (mass^exponent)', () => {
    const engine = metabolismOnlyEngine();
    const light = spawnAnimal(engine, { energy: 100, bodyMass: 30 }); // massFactor 1
    const heavy = spawnAnimal(engine, { energy: 100, bodyMass: 60 }); // massFactor 2^0.75
    engine.step(1);
    const lightDrain = 100 - engine.world.entities.get(light).energy;
    const heavyDrain = 100 - engine.world.entities.get(heavy).energy;
    assert.ok(Math.abs(lightDrain - 0.04) < 1e-9);
    assert.ok(Math.abs(heavyDrain - 0.04 * 2 ** 0.75) < 1e-9);
    assert.ok(heavyDrain > lightDrain, 'heavier animals burn more at rest');
  });
});

describe('metabolism: movement cost', () => {
  test('movement adds cost on top of basal, proportional to distance travelled', () => {
    const engine = metabolismOnlyEngine();
    const still = spawnAnimal(engine, { energy: 100 });
    const mover = spawnAnimal(engine, { energy: 100 });
    // Simulate a movement system having recorded travel this tick.
    engine.world.entities.get(mover).lastMoveDistance = 1.2;
    engine.step(1);
    const stillDrain = 100 - engine.world.entities.get(still).energy;
    const moverDrain = 100 - engine.world.entities.get(mover).energy;
    assert.ok(Math.abs(stillDrain - 0.04) < 1e-9);
    assert.ok(Math.abs(moverDrain - (0.04 + 0.02 * 1.2)) < 1e-9);
    assert.ok(moverDrain > stillDrain, 'movers deplete faster');
  });

  test('lastMoveDistance is consumed (reset to 0) after being charged', () => {
    const engine = metabolismOnlyEngine();
    const id = spawnAnimal(engine, { energy: 100 });
    engine.world.entities.get(id).lastMoveDistance = 2;
    engine.step(1);
    assert.equal(engine.world.entities.get(id).lastMoveDistance, 0);
  });
});

describe('metabolism: low-energy flag', () => {
  test('lowEnergy toggles when energy crosses the threshold fraction', () => {
    const engine = metabolismOnlyEngine();
    const id = spawnAnimal(engine, { energy: 26, maxEnergy: 100 }); // above 25%
    engine.step(1); // 25.96 -> still above 25
    assert.equal(engine.world.entities.get(id).lowEnergy, false);
    engine.world.entities.get(id).energy = 25.02;
    engine.step(1); // 24.98 -> below 25
    assert.equal(engine.world.entities.get(id).lowEnergy, true);
  });
});

describe('metabolism: starvation and carcass', () => {
  test('death occurs exactly when energy reaches zero, producing a carcass', () => {
    const engine = metabolismOnlyEngine();
    // energy 0.2 at basal 0.04 → dies on the 5th tick (0.2 - 5*0.04 = 0).
    const id = spawnAnimal(engine, { energy: 0.2, bodyMass: 30 });
    engine.step(4);
    let animal = engine.world.entities.get(id);
    assert.equal(animal.alive, true, 'alive after 4 ticks');
    assert.ok(Math.abs(animal.energy - 0.04) < 1e-9);
    engine.step(1);
    animal = engine.world.entities.get(id);
    assert.equal(animal.alive, false, 'dead on the 5th tick');
    assert.equal(animal.kind, 'carcass');
    assert.ok(Math.abs(animal.edibleMass - 30 * 0.6) < 1e-9, 'edible mass ∝ body mass');
    assert.equal(animal.lowEnergy, false);
  });

  test('a starvation death emits entity.died with cause "starvation"', () => {
    const engine = metabolismOnlyEngine();
    const id = spawnAnimal(engine, { energy: 0.04 });
    const before = engine.events.lastSeq;
    engine.step(1);
    const events = engine.eventsSince(before);
    const died = events.find((e) => e.type === 'entity.died' && e.entityId === id);
    assert.ok(died, 'expected an entity.died event');
    assert.equal(died.cause, 'starvation');
  });

  test('carcasses do not metabolize, age, or move further', () => {
    const engine = metabolismOnlyEngine();
    const id = spawnAnimal(engine, { energy: 0.04 });
    engine.step(1); // dies -> carcass
    const carcass = engine.world.entities.get(id);
    const snapshotBefore = JSON.stringify(carcass);
    engine.step(20);
    assert.equal(JSON.stringify(engine.world.entities.get(id)), snapshotBefore, 'carcass state is inert');
  });
});

describe('metabolism in the demo (integration)', () => {
  test('inspection exposes lowEnergy and edibleMass; demo animals sustain energy by feeding', () => {
    // Since Step 9 (feeding) closed the survival loop, demo animals no longer
    // starve — carcass creation is covered by the metabolism unit tests above.
    // Here we confirm metabolism + feeding integrate: the fields are inspectable
    // and animals sustain themselves over a long run.
    const engine = createDemoSimulation({ seed: 42 });
    const id = [...engine.world.entities.all()][0].id;
    const details = engine.getEntityDetails(id);
    assert.ok('lowEnergy' in details && 'edibleMass' in details);
    engine.step(2000);
    const living = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive);
    assert.ok(living.length > 0, 'animals sustain themselves by feeding');
    assert.ok(living.some((e) => e.energy > 50), 'well-fed animals maintain energy');
  });

  test('differential depletion: metabolism keeps the run deterministic', () => {
    const a = createDemoSimulation({ seed: 21 });
    const b = createDemoSimulation({ seed: 21 });
    a.step(500);
    b.step(500);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
