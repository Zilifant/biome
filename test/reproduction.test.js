import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { ReproductionSystem, isReproductivelyReady } from '../src/simulation/systems/ReproductionSystem.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const PARAMS = {
  matingRange: 2.0,
  minEnergyFraction: 0.7,
  matingEnergyCost: 8,
  gestationTicks: 50,
  birthEnergyCost: 15,
  offspringEnergyFraction: 0.6,
  cooldownTicks: 800,
  birthOffset: 1.0,
  birthMass: 5,
};

/** Engine with only reproduction, so pairing/gestation can be checked exactly. */
function reproEngine(params = {}) {
  const engine = new SimulationEngine({
    seed: 1,
    config: { world: { width: 32, height: 32 }, terrain: { lakes: 0, ridges: 0 } },
  });
  engine.registerSystem(new ReproductionSystem({ ...PARAMS, ...params }));
  return engine;
}

function spawnAdult(engine, x, y, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.grazer',
    x,
    y,
    heading: 0,
    lifeStage: 'adult',
    bodyMass: 30,
    maxEnergy: 100,
    energy: 90,
    maxHealth: 100,
    maxHydration: 100,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('reproduction: eligibility gating', () => {
  test('two well-fed adults in range mate; both pay the cost and enter cooldown', () => {
    const engine = reproEngine();
    const a = spawnAdult(engine, 10, 10, { energy: 90 });
    const b = spawnAdult(engine, 11, 10, { energy: 90 });
    const before = engine.events.lastSeq;
    engine.step(1);
    const ea = engine.world.entities.get(a);
    const eb = engine.world.entities.get(b);
    assert.equal(ea.energy, 82, 'initiator paid the mating cost');
    assert.equal(eb.energy, 82, 'partner paid the mating cost');
    assert.equal(ea.lastMatedTick, 1);
    assert.equal(eb.lastMatedTick, 1);
    // The lower id carries the pregnancy.
    assert.equal(ea.gestationUntil, 1 + PARAMS.gestationTicks);
    assert.equal(eb.gestationUntil, null);
    assert.equal(ea.pendingMateId, b);
    const mated = engine.eventsSince(before).find((e) => e.type === 'entity.mated');
    assert.deepEqual([mated.entityId, mated.partnerId], [a, b]);
  });

  test('juveniles and subadults never mate (maturity gate)', () => {
    const engine = reproEngine();
    const a = spawnAdult(engine, 10, 10, { lifeStage: 'juvenile', energy: 100 });
    const b = spawnAdult(engine, 11, 10, { lifeStage: 'subadult', energy: 100 });
    engine.step(5);
    assert.equal(engine.world.entities.get(a).gestationUntil, null);
    assert.equal(engine.world.entities.get(b).gestationUntil, null);
  });

  test('under-fed adults never mate (energy gate)', () => {
    const engine = reproEngine();
    const a = spawnAdult(engine, 10, 10, { energy: 50 }); // below 70% threshold
    const b = spawnAdult(engine, 11, 10, { energy: 50 });
    engine.step(5);
    assert.equal(engine.world.entities.get(a).gestationUntil, null);
    assert.equal(engine.world.entities.get(b).gestationUntil, null);
  });

  test('adults out of range never mate', () => {
    const engine = reproEngine();
    const a = spawnAdult(engine, 5, 5);
    const b = spawnAdult(engine, 25, 25); // far beyond matingRange
    engine.step(5);
    assert.equal(engine.world.entities.get(a).gestationUntil, null);
    assert.equal(engine.world.entities.get(b).gestationUntil, null);
  });

  test('the cooldown prevents immediate re-mating', () => {
    const engine = reproEngine({ gestationTicks: 1 });
    const a = spawnAdult(engine, 10, 10, { energy: 100 });
    spawnAdult(engine, 11, 10, { energy: 100 });
    engine.step(1); // mate
    const firstMated = engine.world.entities.get(a).lastMatedTick;
    engine.step(20); // gestation ends, but cooldown (800) blocks re-mating
    assert.equal(engine.world.entities.get(a).lastMatedTick, firstMated, 'did not mate again');
  });

  test('isReproductivelyReady is the single shared rule', () => {
    const entity = { kind: 'animal', alive: true, lifeStage: 'adult', gestationUntil: null, energy: 80, maxEnergy: 100, lastMatedTick: null };
    const params = { minEnergyFraction: 0.7, cooldownTicks: 800 };
    assert.equal(isReproductivelyReady(entity, 100, params), true);
    assert.equal(isReproductivelyReady({ ...entity, lifeStage: 'juvenile' }, 100, params), false);
    assert.equal(isReproductivelyReady({ ...entity, energy: 60 }, 100, params), false);
    assert.equal(isReproductivelyReady({ ...entity, gestationUntil: 500 }, 100, params), false);
    assert.equal(isReproductivelyReady({ ...entity, lastMatedTick: 99 }, 100, params), false);
  });
});

describe('reproduction: gestation and birth', () => {
  test('birth happens exactly at term, with valid parent ids and a juvenile newborn', () => {
    const engine = reproEngine();
    const a = spawnAdult(engine, 10, 10);
    const b = spawnAdult(engine, 11, 10);
    engine.step(1); // mate at tick 1 → term at tick 51
    assert.equal(engine.entityCount, 2, 'no offspring yet');
    engine.step(PARAMS.gestationTicks - 1); // tick 50 — still gestating
    assert.equal(engine.entityCount, 2);
    const before = engine.events.lastSeq;
    engine.step(1); // tick 51 — birth
    assert.equal(engine.entityCount, 3, 'offspring born exactly at term');

    const born = engine.eventsSince(before).find((e) => e.type === 'entity.born');
    assert.ok(born, 'entity.born emitted');
    assert.deepEqual(born.parents, [a, b]);
    const child = engine.world.entities.get(born.entityId);
    assert.deepEqual(child.parents, [a, b]);
    assert.equal(child.lifeStage, 'juvenile');
    assert.equal(child.age, 0);
    assert.equal(child.bodyMass, PARAMS.birthMass);
    assert.equal(child.energy, 100 * PARAMS.offspringEnergyFraction);
    // Parent refs point at real entities (never removed ⇒ always valid).
    for (const parentId of child.parents) assert.ok(engine.world.entities.get(parentId));
    // Gestation cleared and the birth cost paid.
    const mother = engine.world.entities.get(a);
    assert.equal(mother.gestationUntil, null);
    assert.equal(mother.pendingMateId, null);
    assert.equal(mother.energy, 82 - PARAMS.birthEnergyCost);
  });

  test('the newborn is placed on a passable cell near the parent', () => {
    const engine = reproEngine();
    spawnAdult(engine, 10, 10);
    spawnAdult(engine, 11, 10);
    engine.step(1 + PARAMS.gestationTicks);
    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(engine.world.isPassableAt(child.x, child.y), 'newborn on passable terrain');
    assert.ok(Math.hypot(child.x - 10, child.y - 10) <= PARAMS.birthOffset + 1e-9);
  });
});

describe('reproduction: demo integration', () => {
  test('the demo produces births with valid parentage, renewing the population', () => {
    const engine = createDemoSimulation({ seed: 42 });
    let births = 0;
    let firstBirth = null;
    for (let t = 0; t < 3000; t += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type === 'entity.born') {
          births += 1;
          firstBirth ??= e;
        }
      }
    }
    assert.ok(births > 0, 'expected births in the demo');
    assert.equal(firstBirth.parents.length, 2);
    // Every parent reference in the world resolves to a real entity.
    for (const entity of engine.world.entities.all()) {
      for (const parentId of entity.parents) {
        assert.ok(engine.world.entities.get(parentId), `dangling parent ref ${parentId}`);
      }
    }
    // Population renewed beyond the founding cohort.
    assert.ok(engine.entityCount > engine.config.demo.animalCount);
  });

  test('reproduction keeps the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(1500);
    b.step(1500);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('inspection exposes parents and reproductive state', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1200);
    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(child, 'expected a born animal');
    const details = engine.getEntityDetails(child.id);
    assert.deepEqual(details.parents, child.parents);
    assert.ok('reproState' in details);
    assert.equal(typeof details.reproState.gestating, 'boolean');
  });
});
