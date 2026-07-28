import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PHASES } from '../src/simulation/engine/SystemScheduler.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { stripComments } from './helpers/sourceScan.js';

const spySystem = (id, phase, priority, calls, updateInterval = 1) => ({
  id,
  phase,
  priority,
  updateInterval,
  update: (_world, context) => calls.push({ id, tick: context.tick }),
});

describe('system scheduler', () => {
  test('systems run in stable phase order, then priority, then id', () => {
    const engine = new SimulationEngine({ seed: 1 });
    const calls = [];
    // Registered deliberately out of order.
    engine.registerSystem(spySystem('observe', 'observation', 0, calls));
    engine.registerSystem(spySystem('cleanup-late', 'cleanup', 10, calls));
    engine.registerSystem(spySystem('decision-z', 'decision', 5, calls));
    engine.registerSystem(spySystem('decision-tie-b', 'decision', 0, calls));
    engine.registerSystem(spySystem('decision-tie-a', 'decision', 0, calls));
    engine.registerSystem(spySystem('env', 'environment', 3, calls));
    engine.step();
    assert.deepEqual(
      calls.map((call) => call.id),
      ['env', 'decision-tie-a', 'decision-tie-b', 'decision-z', 'cleanup-late', 'observe'],
    );
  });

  test('phase list is explicit and complete', () => {
    assert.deepEqual([...PHASES], [
      'environment', 'perception', 'decision', 'movement', 'interaction',
      'physiology', 'lifecycle', 'cleanup', 'observation',
    ]);
  });

  test('update intervals run systems every N ticks only', () => {
    const engine = new SimulationEngine({ seed: 1 });
    const calls = [];
    engine.registerSystem(spySystem('every-tick', 'environment', 0, calls));
    engine.registerSystem(spySystem('every-3', 'environment', 1, calls, 3));
    engine.step(9);
    const every3Ticks = calls.filter((call) => call.id === 'every-3').map((call) => call.tick);
    const everyTick = calls.filter((call) => call.id === 'every-tick').map((call) => call.tick);
    assert.deepEqual(every3Ticks, [3, 6, 9]);
    assert.equal(everyTick.length, 9);
  });

  test('duplicate system ids and unknown phases are rejected', () => {
    const engine = new SimulationEngine({ seed: 1 });
    engine.registerSystem(spySystem('dup', 'environment', 0, []));
    assert.throws(() => engine.registerSystem(spySystem('dup', 'movement', 0, [])), /already registered/);
    assert.throws(() => engine.registerSystem(spySystem('bad', 'rendering', 0, [])), /unknown phase/);
  });
});

describe('entity lifecycle', () => {
  test('entity ids are stable, monotonic, and never reused', () => {
    const engine = new SimulationEngine({ seed: 1 });
    const definition = { kind: 'plant', speciesId: 'demo.grass', x: 5, y: 5 };
    const first = engine.world.entities.queueSpawn(definition);
    const second = engine.world.entities.queueSpawn(definition);
    engine.applyDeferredEntityChanges();
    engine.world.entities.queueRemove(first);
    engine.applyDeferredEntityChanges();
    const third = engine.world.entities.queueSpawn(definition);
    engine.applyDeferredEntityChanges();
    assert.equal(second, first + 1);
    assert.equal(third, second + 1);
    assert.equal(engine.world.entities.has(first), false);
    assert.equal(engine.world.entities.get(third).id, third);
  });

  test('spawn commands report the assigned id before the entity exists', () => {
    const engine = new SimulationEngine({ seed: 1 });
    const result = engine.submitCommand({
      type: 'entity.spawn',
      entity: { kind: 'animal', speciesId: 'demo.grazer', x: 3, y: 4 },
    });
    assert.equal(result.ok, true);
    assert.equal(engine.world.entities.has(result.entityId), false);
    engine.step();
    const entity = engine.world.entities.get(result.entityId);
    assert.equal(entity.x, 3);
    assert.equal(entity.alive, true);
  });

  test('deferred creation and removal are safe during system iteration', () => {
    const engine = new SimulationEngine({ seed: 1 });
    for (let i = 0; i < 3; i += 1) {
      engine.world.entities.queueSpawn({ kind: 'animal', speciesId: 'demo.grazer', x: i, y: i });
    }
    engine.applyDeferredEntityChanges();
    engine.registerSystem({
      id: 'churn',
      phase: 'interaction',
      update: (world, context) => {
        if (context.tick !== 1) return;
        for (const entity of world.entities.all()) {
          if (entity.kind === 'animal') context.queueRemove(entity.id);
          // Spawning while iterating must also be safe.
          context.queueSpawn({ kind: 'plant', speciesId: 'demo.grass', x: 1, y: 1 });
        }
      },
    });
    engine.step();
    const kinds = [...engine.world.entities.all()].map((entity) => entity.kind);
    assert.deepEqual(kinds, ['plant', 'plant', 'plant']);
    assert.equal(engine.world.grid.size, 3);
  });

  test('a spawn queued and removed before its flush never materializes', () => {
    const engine = new SimulationEngine({ seed: 1 });
    const id = engine.world.entities.queueSpawn({ kind: 'plant', speciesId: 'demo.grass', x: 1, y: 1 });
    engine.world.entities.queueRemove(id);
    engine.applyDeferredEntityChanges();
    assert.equal(engine.world.entities.has(id), false);
    assert.equal(engine.world.entities.count, 0);
  });
});

describe('engine independence', () => {
  test('the engine runs headless: demo world advances with no server or renderer involved', () => {
    const engine = createDemoSimulation({ seed: 3 });
    const initialCount = engine.entityCount;
    engine.step(50);
    assert.equal(engine.tick, 50);
    assert.ok(engine.entityCount > 0);
    assert.ok(initialCount > 0);
    const snapshot = engine.getSnapshotData();
    assert.equal(snapshot.entities.length, engine.entityCount);
  });

  test('simulation and protocol source never reference hosts, presentation, or Math.random', () => {
    // Strip comments before scanning. These patterns are about what the code
    // *does*, and prose that happens to contain "window." or "Math.random"
    // is not a boundary violation — a scan that fires on documentation trains
    // people to word around it rather than to trust it. ⚠ The stripper is shared
    // with the other two source scans and pinned by `source-scan.test.js`; the
    // two-regex version this replaced could be blinded by a `/*` inside a line
    // comment, and was.
    const roots = ['src/simulation', 'src/protocol'];
    const forbidden = [
      { pattern: /from\s+['"]express['"]/, label: 'express import' },
      { pattern: /from\s+['"]ws['"]/, label: 'ws import' },
      { pattern: /from\s+['"][^'"]*\/server\//, label: 'server-layer import' },
      { pattern: /from\s+['"][^'"]*\/renderer\//, label: 'renderer-layer import' },
      { pattern: /\bMath\.random\b/, label: 'Math.random' },
      { pattern: /\bdocument\.|\bwindow\.|\bnavigator\./, label: 'browser API' },
    ];
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    for (const root of roots) walk(path.join(projectRoot, root));
    assert.ok(files.length >= 15, 'expected to scan the simulation and protocol sources');
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const { pattern, label } of forbidden) {
        assert.ok(!pattern.test(source), `${path.relative(projectRoot, file)} contains forbidden ${label}`);
      }
    }
  });
});
