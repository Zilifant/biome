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
    const founded = engine.config.demo.founding.reduce((sum, f) => sum + f.count, 0);
    assert.ok(engine.entityCount >= founded);
    // Generous bound — this is a smoke check that headless stepping is fast,
    // not a strict performance assertion.
    // ⚠ 30 000 until 2026-08-04, when the demo became the ngorongoro world:
    // ~4.8× the map and ~2.3× the founders is **7.6 ms/tick** where the old demo
    // was ~1 (measured uncontended: 5000 ticks in 37.9 s, so the old bound now
    // fails on an idle machine). Raised rather than deleted, because the claim it
    // makes is still the one worth making — the engine holds no timer, so 5000
    // ticks take CPU time and not 5000 seconds. It stays far under the runner's
    // one-second authoritative tick.
    //
    // ⚠ 120 000 until 2026-08-05, when BEHAVIOR-PLAN P1 gave the wildebeest and
    // the buffalo a herd radius of 11. Measured back-to-back on this seed: 42.2 s
    // before, 62.6 s after (+48%, and with 12% *fewer* animals alive — the cost is
    // the clumping the feature exists to produce; see BENCHMARK.md). That alone
    // fits, but `node --test` runs files in parallel, and under that contention
    // the same run took **136 s** and failed. This is a smoke check on a wall
    // clock competing with a dozen sibling processes, so the bound has to clear
    // the contended case or it is a coin flip rather than an assertion — while
    // still being ~20× under the 5000 seconds a timer-driven engine would need,
    // which is the whole of what it claims.
    assert.ok(elapsedMs < 240000, `5000 ticks took ${elapsedMs}ms`);
  });
});
