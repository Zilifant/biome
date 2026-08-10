import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  captureSimulationState,
  restoreSimulationState,
  SAVE_FORMAT_VERSION,
} from '../src/simulation/persistence/SimulationSerializer.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';

/**
 * Assert two whole simulation states match, **without letting `assert` build the
 * failure message** (2026-08-09).
 *
 * ⚠⚠ **`assert.deepEqual` on two captured states is a 4 GB out-of-memory crash,
 * and it took the whole suite down for two days before anyone traced it.** A
 * captured demo state is ~2.5 MB of JSON — a couple of hundred animals with dozens
 * of fields each. The *comparison* is cheap; it is the **diff `node:assert` renders
 * when the comparison fails** that is not. It clones and re-clones both object
 * graphs and allocates until the heap ceiling: **4 GB in ~3 s**, measured. Worse,
 * on a machine already under memory pressure the dying process wedges in an
 * uninterruptible exit that `SIGKILL` cannot clear — 21 unkillable processes
 * accumulated over two days, and only a reboot removed them. `node --test` then
 * waits forever for a result that never comes, so **the suite never finishes** —
 * which is a different and much worse failure than a slow suite.
 *
 * ⚠ `assert.equal(JSON.stringify(a), JSON.stringify(b))` is **not** the fix, and it
 * is the obvious thing to reach for: `assert` renders a diff for two mismatched
 * 2.5 MB *strings* as well. The output has to be bounded by construction, so this
 * compares the serialized forms itself and, on a mismatch, walks the two trees and
 * reports **only the first `MAX_REPORTED_DIFFS` differing paths**.
 *
 * ⚠ The walk is authoritative, not the string compare: `JSON.stringify` is
 * key-order sensitive and `deepEqual` is not, so a stringify mismatch that the walk
 * cannot explain is key order only, and passes. The fast path exists because the
 * states are equal in the overwhelming majority of runs.
 *
 * ✅ **This is a guard, not a fix.** The divergence it now reports legibly is a real
 * save/load bug (**A99**), and this assertion is what makes it debuggable.
 */
const MAX_REPORTED_DIFFS = 12;

function collectDifferences(actual, expected, path, out) {
  if (out.length >= MAX_REPORTED_DIFFS || Object.is(actual, expected)) return;
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const ta = typeOf(actual);
  const te = typeOf(expected);
  if (ta !== te) {
    out.push(`${path}: type ${ta} vs ${te}`);
    return;
  }
  if (ta === 'array') {
    if (actual.length !== expected.length) out.push(`${path}.length: ${actual.length} vs ${expected.length}`);
    for (let i = 0; i < Math.min(actual.length, expected.length); i += 1) {
      collectDifferences(actual[i], expected[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (ta === 'object') {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      collectDifferences(actual[key], expected[key], `${path}.${key}`, out);
    }
    return;
  }
  out.push(`${path}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
}

/** @param {object} actual @param {object} expected @param {string} [message] */
function assertSameState(actual, expected, message = 'simulation state') {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  const differences = [];
  collectDifferences(actual, expected, 'state', differences);
  if (differences.length === 0) return; // key order only — `deepEqual` would pass
  const capped = differences.length >= MAX_REPORTED_DIFFS ? ` (first ${MAX_REPORTED_DIFFS})` : '';
  assert.fail(`${message} differs${capped}:\n  ${differences.join('\n  ')}`);
}

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
    assertSameState(captureSimulationState(restored), captureSimulationState(original), 'restored vs original');

    // And both equal an uninterrupted run of the same length.
    const uninterrupted = createDemoSimulation({ seed: 99 });
    uninterrupted.step(70);
    assertSameState(captureSimulationState(uninterrupted), captureSimulationState(original), 'uninterrupted vs original');
  });

  test('pending deterministic commands survive save/load', () => {
    const original = createDemoSimulation({ seed: 11 });
    original.step(5);
    const spawn = original.submitCommand({
      type: 'entity.spawn',
      // ⚠ Was `demo.grazer` until 2026-08-09 — an id renamed out of the roster
      // long ago. It survived because `assertKnownSpecies` checked entities and
      // pendingSpawns but not `pendingCommands`, so a queued spawn naming an
      // unknown species sailed past the guard written to catch exactly that (A99).
      // With the guard closed this test would now (correctly) throw, so it names a
      // real species — which is what it always meant to do.
      entity: { kind: 'animal', speciesId: 'herbivore.gazelle', x: 30, y: 30, energy: 80 },
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
    assertSameState(captureSimulationState(restored), captureSimulationState(original), 'restored vs original');
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

  test('⚠⚠ …including one hiding in a queued command, the third door (A99)', () => {
    // ⚠⚠ **The guard above checked two of the three places a `speciesId` can be
    // in a save, and the gap was invisible because it failed the way the guard
    // exists to prevent.** Entities and `pendingSpawns` were checked;
    // `pendingCommands` was not — so a save whose queued `entity.spawn` named an
    // unknown species restored without a murmur and spawned an animal with no
    // biology on the next tick. Different physics, no error anywhere.
    //
    // ⚠ How it stayed hidden: this very file spawned `demo.grazer` — an id renamed
    // out of the roster long ago — in the test above this one, and nothing ever
    // complained. The stale id was not the cause of anything; it was the *evidence*
    // that the door was open, sitting in the suite unread.
    //
    // ⚠ The three shapes differ, which is how one got missed: an entity carries
    // `speciesId` directly, a pending spawn nests it under `definition`, and a
    // queued command nests it under `command.entity`. Three spellings of one
    // concept.
    const engine = createDemoSimulation({ seed: 1 });
    const spawn = engine.submitCommand({
      type: 'entity.spawn',
      entity: { kind: 'animal', speciesId: 'herbivore.rhino', x: 30, y: 30, energy: 80 },
    });
    assert.equal(spawn.ok, true, 'the command queues — validation is not the species registry');
    const saved = captureSimulationState(engine);
    assert.equal(saved.pendingCommands.length, 1, 'and it rides in the save');
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
