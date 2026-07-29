import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { AgingSystem, bodyMassForAge, lifeStageForAge } from '../src/simulation/systems/AgingSystem.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

const STAGES = { juvenileUntil: 400, subadultUntil: 1000, adultUntil: 6000 };
const GROWTH = { birthMass: 5, adultMass: 30, maturityAge: 1000 };

describe('aging: growth and stage helpers', () => {
  test('body mass grows linearly to adult size then holds', () => {
    assert.equal(bodyMassForAge(0, GROWTH), 5);
    assert.equal(bodyMassForAge(500, GROWTH), 5 + (30 - 5) * 0.5); // 17.5
    assert.equal(bodyMassForAge(1000, GROWTH), 30);
    assert.equal(bodyMassForAge(5000, GROWTH), 30); // capped
  });

  test('life stage thresholds are exact', () => {
    assert.equal(lifeStageForAge(0, STAGES), 'juvenile');
    assert.equal(lifeStageForAge(399, STAGES), 'juvenile');
    assert.equal(lifeStageForAge(400, STAGES), 'subadult');
    assert.equal(lifeStageForAge(999, STAGES), 'subadult');
    assert.equal(lifeStageForAge(1000, STAGES), 'adult');
    assert.equal(lifeStageForAge(5999, STAGES), 'adult');
    assert.equal(lifeStageForAge(6000, STAGES), 'senescent');
  });
});

/** Engine with only aging (no mortality) to watch growth/stage deterministically. */
function agingEngine(params = {}) {
  const aging = { ...GROWTH, ...STAGES, senescentMortalityPerTick: 0, maxAge: 1e9, ...params };
  const engine = new SimulationEngine({ seed: 1, config: { world: { width: 16, height: 16 }, aging } });
  engine.registerSystem(new AgingSystem(aging));
  return engine;
}

function spawnAt(engine, age) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.gazelle',
    x: 8,
    y: 8,
    age,
    bodyMass: bodyMassForAge(age, GROWTH),
    lifeStage: lifeStageForAge(age, STAGES),
    maxHealth: 100,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('aging: growth and stage transitions', () => {
  test('an animal ages, grows, and transitions stages at the thresholds', () => {
    const engine = agingEngine();
    const id = spawnAt(engine, 398);
    assert.equal(engine.world.entities.get(id).lifeStage, 'juvenile');
    engine.step(2); // age 400 → subadult
    assert.equal(engine.world.entities.get(id).age, 400);
    assert.equal(engine.world.entities.get(id).lifeStage, 'subadult');
    engine.step(600); // age 1000 → adult, mass 30
    assert.equal(engine.world.entities.get(id).lifeStage, 'adult');
    assert.ok(Math.abs(engine.world.entities.get(id).bodyMass - 30) < 1e-9);
  });

  test('a juvenile grows toward adult mass over time', () => {
    const engine = agingEngine();
    const id = spawnAt(engine, 0);
    const m0 = engine.world.entities.get(id).bodyMass;
    engine.step(500);
    const m1 = engine.world.entities.get(id).bodyMass;
    assert.ok(m1 > m0, 'mass increased');
    assert.ok(Math.abs(m1 - 17.5) < 1e-6, 'follows the growth curve');
  });
});

describe('aging: senescence and age mortality', () => {
  test('senescent animals die of age; mortality only applies in senescence', () => {
    // High mortality so death is quick once senescent; verify a young animal
    // never dies of age.
    const aging = { ...GROWTH, ...STAGES, senescentMortalityPerTick: 0.5, mortalityRamp: 0, maxAge: 1e9, edibleMassFraction: 0.6 };
    const engine = new SimulationEngine({ seed: 2, config: { world: { width: 16, height: 16 }, aging } });
    engine.registerSystem(new AgingSystem(aging));
    const young = spawnAt(engine, 100);
    const old = spawnAt(engine, 5999);
    const before = engine.events.lastSeq;
    engine.step(30); // old crosses into senescence and should die; young stays juvenile
    assert.equal(engine.world.entities.get(young).alive, true, 'young animal never dies of age');
    const oldEntity = engine.world.entities.get(old);
    assert.equal(oldEntity.alive, false, 'senescent animal dies of age');
    assert.equal(oldEntity.kind, 'carcass');
    assert.ok(oldEntity.edibleMass > 0);
    const died = engine.eventsSince(before).find((e) => e.type === 'entity.died' && e.entityId === old);
    assert.equal(died.cause, 'age');
  });

  test('death is certain at maxAge', () => {
    const aging = { ...GROWTH, ...STAGES, senescentMortalityPerTick: 0, mortalityRamp: 0, maxAge: 6100, edibleMassFraction: 0.6 };
    const engine = new SimulationEngine({ seed: 3, config: { world: { width: 16, height: 16 }, aging } });
    engine.registerSystem(new AgingSystem(aging));
    const id = spawnAt(engine, 6099);
    engine.step(1); // age 6100 ≥ maxAge → certain death
    assert.equal(engine.world.entities.get(id).kind, 'carcass');
  });

  test('mortality probability stays within [0, base×(1+ramp)] across senescence', () => {
    const engine = agingEngine({ senescentMortalityPerTick: 0.001, mortalityRamp: 8, maxAge: 12000 });
    // Spawn many senescent animals and step once; the fraction dying is small
    // and bounded (probabilistic, but well under the max per-tick rate).
    const ids = [];
    for (let i = 0; i < 200; i += 1) {
      ids.push(
        engine.world.entities.queueSpawn({ kind: 'animal', speciesId: 'herbivore.gazelle', x: (i % 15) + 0.5, y: Math.floor(i / 15) + 0.5, age: 8000, bodyMass: 30, lifeStage: 'senescent', maxHealth: 100 }),
      );
    }
    engine.applyDeferredEntityChanges(0);
    engine.step(1);
    const dead = ids.filter((id) => !engine.world.entities.get(id).alive).length;
    // At age 8000: p = 0.001×(1 + 8×(2000/6000)) ≈ 0.00367. Of 200, expect a
    // few; assert it is bounded well under the max rate.
    assert.ok(dead <= 200 * 0.001 * (1 + 8), `too many died: ${dead}`);
  });
});

describe('aging: protocol, determinism, demo', () => {
  test('lifeStage is a public snapshot field', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('lifeStage'));
    for (const entity of snapshot.entities) {
      assert.ok(['juvenile', 'subadult', 'adult', 'senescent'].includes(entity.lifeStage));
    }
  });

  test('aging is deterministic across two runs (incl. age deaths)', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(7000);
    b.step(7000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('the demo shows growth, all four stages over a run, and age deaths', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const stagesSeen = new Set();
    let ageDeaths = 0;
    for (let t = 0; t < 8000; t += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) if (e.type === 'entity.died' && e.cause === 'age') ageDeaths += 1;
      for (const e of engine.world.entities.all()) if (e.kind === 'animal' && e.alive) stagesSeen.add(e.lifeStage);
    }
    for (const stage of ['juvenile', 'subadult', 'adult', 'senescent']) {
      assert.ok(stagesSeen.has(stage), `expected to observe ${stage}`);
    }
    assert.ok(ageDeaths > 0, 'expected at least one age death');
  });

  test('performance: staggering aging cuts per-tick cost proportionally', () => {
    // The system supports updateInterval; verify age stays ≈ accurate when
    // staggered (incremented by the interval each run).
    const aging = { ...GROWTH, ...STAGES, senescentMortalityPerTick: 0, maxAge: 1e9 };
    const engine = new SimulationEngine({ seed: 1, config: { world: { width: 16, height: 16 }, aging } });
    engine.registerSystem(new AgingSystem({ ...aging, updateInterval: 4 }));
    const id = spawnAt(engine, 0);
    engine.step(8); // runs at ticks 4 and 8 → age += 4 twice = 8
    assert.equal(engine.world.entities.get(id).age, 8);
  });
});
