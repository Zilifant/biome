import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  captureSimulationState,
  restoreSimulationState,
  SAVE_FORMAT_VERSION,
} from '../src/simulation/persistence/SimulationSerializer.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';

describe('persistence', () => {
  test('save/load preserves deterministic continuation, including across JSON', () => {
    const original = createDemoSimulation({ seed: 99 });
    original.step(30);
    const saved = JSON.parse(JSON.stringify(captureSimulationState(original)));
    const restored = restoreDemoSimulation(saved);

    assert.equal(restored.tick, 30);
    assert.equal(restored.entityCount, original.entityCount);

    original.step(40);
    restored.step(40);
    assert.deepEqual(captureSimulationState(restored), captureSimulationState(original));

    // And both equal an uninterrupted run of the same length.
    const uninterrupted = createDemoSimulation({ seed: 99 });
    uninterrupted.step(70);
    assert.deepEqual(captureSimulationState(uninterrupted), captureSimulationState(original));
  });

  test('pending deterministic commands survive save/load', () => {
    const original = createDemoSimulation({ seed: 11 });
    original.step(5);
    const spawn = original.submitCommand({
      type: 'entity.spawn',
      entity: { kind: 'animal', speciesId: 'demo.grazer', x: 30, y: 30, energy: 80 },
    });
    assert.equal(spawn.ok, true);
    // Save BEFORE the command has been applied.
    const saved = captureSimulationState(original);
    assert.equal(saved.pendingCommands.length, 1);
    const restored = restoreDemoSimulation(saved);

    original.step(10);
    restored.step(10);
    assert.equal(original.world.entities.has(spawn.entityId), true);
    assert.equal(restored.world.entities.has(spawn.entityId), true);
    assert.deepEqual(captureSimulationState(restored), captureSimulationState(original));
  });

  test('the spatial index is rebuilt correctly on load', () => {
    const original = createDemoSimulation({ seed: 21 });
    original.step(12);
    const restored = restoreDemoSimulation(captureSimulationState(original));
    assert.equal(restored.world.grid.size, restored.entityCount);
    for (const entity of restored.world.entities.all()) {
      assert.deepEqual(restored.world.grid.queryRadius(entity.x, entity.y, 0.001), [
        ...original.world.grid.queryRadius(entity.x, entity.y, 0.001),
      ]);
    }
  });

  test('unsupported save format versions are rejected', () => {
    const engine = createDemoSimulation({ seed: 1 });
    const saved = captureSimulationState(engine);
    saved.formatVersion = SAVE_FORMAT_VERSION + 999;
    assert.throws(() => restoreDemoSimulation(saved), /unsupported save format version/);
  });

  test('restoring onto an engine with different systems is rejected', () => {
    const engine = createDemoSimulation({ seed: 1 });
    const saved = captureSimulationState(engine);
    const bare = new SimulationEngine({ seed: saved.seed, config: saved.config, simulationId: saved.simulationId });
    assert.throws(() => restoreSimulationState(bare, saved), /systems do not match/);
  });

  test('⚠ a save naming a species this build does not know is refused, not silently degraded', () => {
    // Save compatibility is asymmetric: adding a species is fine, renaming or
    // removing one is not. Without this guard `world.species.get()` returns
    // null, every system falls back to global config defaults, and the run
    // continues with different physics and no error anywhere — the worst
    // possible failure mode, and one a species rename walks straight into.
    const engine = createDemoSimulation({ seed: 1 });
    const saved = captureSimulationState(engine);
    const victim = saved.entities.entities.find((e) => e.speciesId);
    // ⚠ A species id this build genuinely does not know — and it has to be
    // re-picked when the roster grows into it. This read `herbivore.wildebeest`
    // until batch 3 shipped one (2026-07-30), at which point the guard under test
    // correctly stopped throwing and the test failed for the best possible reason.
    // `herbivore.rhino` is the next name down PLAN-SPECIES §10.4's list.
    victim.speciesId = 'herbivore.rhino'; // a plausible future rename
    assert.throws(() => restoreDemoSimulation(saved), /unknown species: herbivore\.rhino/);
  });

  test('a save is a deep copy — mutating it never touches the live engine', () => {
    const engine = createDemoSimulation({ seed: 1 });
    const saved = captureSimulationState(engine);
    const firstId = saved.entities.entities[0].id;
    saved.entities.entities[0].x = 424242;
    assert.notEqual(engine.world.entities.get(firstId).x, 424242);
  });
});
