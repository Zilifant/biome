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

  // ⚠⚠ **Removed 2026-08-05: `benchmark-style: several thousand demo ticks
  // advance without waiting on real time`.** It ran the demo 5000 ticks with a
  // stopwatch and asserted the wall clock stayed under a bound — 92 s, and the
  // bound had been raised twice (30 s → 120 s → 240 s) because it was really
  // tracking *performance drift*, not the claim it was named for.
  //
  // ⚠ **What went with it.** The claim was that the engine holds **no timer**: a
  // tick is a step of computation, so 5000 of them cost seconds rather than the
  // 5000 seconds a real-time-coupled engine would need. That is a ~1000×
  // signal and nothing else in the suite watches for it, so the tripwire against
  // anyone adding a sleep, a timer, or a wall-clock wait inside `src/simulation`
  // is now gone. Invariant 9 and the `Date.now()` ban in DOCS §4 still *state* the
  // rule; no test enforces it.
  //
  // ⚠ If it returns, it should assert the two things separately — ticks completed,
  // and a generous ceiling on a much shorter run. Conflating a 1000× tripwire with
  // a few-percent performance number is what made it need three bounds in a year.
});
