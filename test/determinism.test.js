import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

/** Run a demo simulation with a fixed command script and capture final state. */
function runScripted(seed) {
  const engine = createDemoSimulation({ seed });
  engine.step(25);
  const spawnResult = engine.submitCommand({
    type: 'entity.spawn',
    entity: { kind: 'animal', speciesId: 'demo.grazer', x: 10, y: 10, energy: 50 },
  });
  assert.equal(spawnResult.ok, true);
  engine.step(10);
  const removeResult = engine.submitCommand({ type: 'entity.remove', entityId: spawnResult.entityId });
  assert.equal(removeResult.ok, true);
  engine.step(25);
  return captureSimulationState(engine);
}

describe('determinism', () => {
  test('identical seeds and identical ordered commands produce identical state', () => {
    const first = runScripted(1234);
    const second = runScripted(1234);
    assert.deepEqual(first, second);
  });

  test('two seeded 2000-tick runs are byte-identical (baseline determinism guard)', () => {
    const first = createDemoSimulation({ seed: 42 });
    const second = createDemoSimulation({ seed: 42 });
    first.step(2000);
    second.step(2000);
    assert.equal(
      JSON.stringify(captureSimulationState(first)),
      JSON.stringify(captureSimulationState(second)),
    );
  });

  test('different seeds produce different state', () => {
    const first = createDemoSimulation({ seed: 1 });
    const second = createDemoSimulation({ seed: 2 });
    first.step(20);
    second.step(20);
    const firstEntities = JSON.stringify(captureSimulationState(first).entities);
    const secondEntities = JSON.stringify(captureSimulationState(second).entities);
    assert.notEqual(firstEntities, secondEntities);
  });

  test('random streams are independent: extra draws on one stream do not shift another', () => {
    const engineA = createDemoSimulation({ seed: 7 });
    const engineB = createDemoSimulation({ seed: 7 });
    // Consume extra values from an unrelated stream on engineB only.
    const scratch = engineB.randomStream('some-future-system');
    for (let i = 0; i < 100; i += 1) scratch.next();
    engineA.step(30);
    engineB.step(30);
    assert.deepEqual(
      captureSimulationState(engineA).entities,
      captureSimulationState(engineB).entities,
    );
  });

  test('benchmark-style: several thousand demo ticks advance without waiting on real time', () => {
    const engine = createDemoSimulation({ seed: 7 });
    const startedAt = performance.now();
    engine.step(5000);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(engine.tick, 5000);
    // Entities are never removed (carcasses persist) and reproduction adds
    // more, so the total only ever grows from the founding cohort.
    assert.ok(engine.entityCount >= engine.config.demo.animalCount);
    // Generous bound — this is a smoke check that headless stepping is fast,
    // not a strict performance assertion.
    assert.ok(elapsedMs < 30000, `5000 ticks took ${elapsedMs}ms`);
  });
});
