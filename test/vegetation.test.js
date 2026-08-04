import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { VegetationGrid, projectVegetation, encodeLevelRuns } from '../src/simulation/world/VegetationGrid.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { buildFullSnapshot, buildDeltaSnapshot, applyDeltaSnapshot } from '../src/protocol/snapshots.js';

const makeVegetation = (seed, params = {}) => {
  const terrain = new TerrainGrid({ width: 48, height: 48, seed, params: {} });
  return { terrain, vegetation: new VegetationGrid({ terrain, seed, params }) };
};

describe('vegetation grid', () => {
  test('generation is deterministic for the same seed', () => {
    const a = makeVegetation(123).vegetation;
    const b = makeVegetation(123).vegetation;
    assert.deepEqual(a.levels(), b.levels());
    assert.equal(a.totalBiomass(), b.totalBiomass());
  });

  test('nothing grows on water, rock, or trees (suitability zero)', () => {
    const { terrain, vegetation } = makeVegetation(42);
    // Grow to saturation, then confirm unsuitable cells stayed bare.
    for (let i = 0; i < 200; i += 1) vegetation.grow({ growthRate: 0.2, seedFloor: 0.1 });
    for (let y = 0; y < terrain.height; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        const code = terrain.codeAt(x, y);
        if (code === TerrainType.WATER || code === TerrainType.ROCK || code === TerrainType.TREE) {
          assert.equal(vegetation.biomassAt(x, y), 0, `growth on unsuitable cell ${x},${y}`);
          assert.equal(vegetation.levelAt(x, y), 0);
        }
      }
    }
  });

  test('regrowth is monotonic non-decreasing without grazing', () => {
    const { vegetation } = makeVegetation(7);
    let previous = vegetation.totalBiomass();
    for (let i = 0; i < 50; i += 1) {
      vegetation.grow({ growthRate: 0.1, seedFloor: 0.05 });
      const current = vegetation.totalBiomass();
      assert.ok(current >= previous - 1e-9, `biomass decreased at step ${i}: ${current} < ${previous}`);
      previous = current;
    }
  });

  test('grazed-to-bare suitable cells regrow (colonization seed floor)', () => {
    const { terrain, vegetation } = makeVegetation(11);
    // Find a suitable (ground/cover) cell and strip it bare.
    let target = null;
    for (let y = 0; y < terrain.height && !target; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        if (vegetation.capacityAt(x, y) > 0) {
          target = { x, y };
          break;
        }
      }
    }
    assert.ok(target, 'expected a suitable cell');
    vegetation.consumeAt(target.x, target.y, 1e9);
    assert.equal(vegetation.biomassAt(target.x, target.y), 0);
    for (let i = 0; i < 100; i += 1) vegetation.grow({ growthRate: 0.15, seedFloor: 0.1 });
    assert.ok(vegetation.biomassAt(target.x, target.y) > 0, 'bare suitable cell failed to regrow');
  });

  test('consumeAt removes up to the requested biomass and reports the amount', () => {
    const { terrain, vegetation } = makeVegetation(11);
    let target = null;
    for (let y = 0; y < terrain.height && !target; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        if (vegetation.biomassAt(x, y) > 1) target = { x, y };
        if (target) break;
      }
    }
    assert.ok(target, 'expected a vegetated cell');
    const before = vegetation.biomassAt(target.x, target.y);
    const removed = vegetation.consumeAt(target.x, target.y, 0.5);
    assert.ok(Math.abs(removed - 0.5) < 1e-6);
    assert.ok(Math.abs(vegetation.biomassAt(target.x, target.y) - (before - 0.5)) < 1e-6);
    // Cannot remove more than exists.
    const rest = vegetation.consumeAt(target.x, target.y, 1e9);
    assert.ok(Math.abs(rest - (before - 0.5)) < 1e-6);
    assert.equal(vegetation.biomassAt(target.x, target.y), 0);
  });

  test('mutations bump the revision', () => {
    const { vegetation } = makeVegetation(3);
    const r0 = vegetation.revision;
    vegetation.grow({ growthRate: 0.1, seedFloor: 0.05 });
    assert.ok(vegetation.revision > r0);
  });
});

describe('vegetation projection and RLE', () => {
  test('encodeLevelRuns round-trips and covers all cells', () => {
    const levels = [0, 0, 1, 1, 1, 4, 0];
    const runs = encodeLevelRuns(levels);
    assert.deepEqual(runs, [[0, 2], [1, 3], [4, 1], [0, 1]]);
    assert.equal(runs.reduce((sum, [, c]) => sum + c, 0), levels.length);
  });

  test('projection is renderer-neutral levels + revision, no presentation', () => {
    const { vegetation } = makeVegetation(5);
    const projection = projectVegetation(vegetation);
    assert.equal(projection.encoding, 'rle-row-major');
    assert.equal(projection.maxLevel, vegetation.maxLevel);
    assert.equal(typeof projection.revision, 'number');
    assert.ok(!/glyph|color/i.test(JSON.stringify(projection)));
    const total = projection.runs.reduce((sum, [, count]) => sum + count, 0);
    assert.equal(total, 48 * 48);
  });
});

describe('vegetation in the protocol (snapshots and deltas)', () => {
  test('full snapshots embed vegetation; deltas carry only changed cells', () => {
    const engine = createDemoSimulation({ seed: 42 });
    // Step across a vegetation update boundary so levels change.
    engine.step(4);
    const before = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(before.vegetation, 'full snapshot should embed vegetation');
    engine.step(6); // crosses at least one vegetation update (interval 5)
    const after = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(before, after, engine.eventsSince(before.lastEventSeq));
    assert.ok(delta.vegetation, 'delta should carry vegetation');
    // Sparse: far fewer changes than total cells.
    assert.ok(delta.vegetation.changes.length < before.vegetation.width * before.vegetation.height);
    // Applying the delta reproduces the next snapshot's vegetation exactly.
    const reconstructed = applyDeltaSnapshot(before, delta);
    assert.deepEqual(reconstructed.vegetation, after.vegetation);
  });

  test('no vegetation change between two snapshots yields an empty change set (revision gate)', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1);
    const a = buildFullSnapshot(engine.getSnapshotData());
    // A single tick that does not cross a vegetation update: revisions match.
    engine.step(1);
    const b = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(a, b, []);
    if (a.vegetation.revision === b.vegetation.revision) {
      assert.deepEqual(delta.vegetation.changes, []);
    }
  });
});
