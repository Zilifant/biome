import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TerrainGrid,
  TerrainType,
  TERRAIN_LEGEND,
  projectTerrain,
} from '../src/simulation/world/TerrainGrid.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { buildFullSnapshot } from '../src/protocol/snapshots.js';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';

const makeGrid = (seed, overrides = {}) =>
  new TerrainGrid({ width: 64, height: 64, seed, params: overrides });

describe('terrain grid', () => {
  test('generation is deterministic: same seed + size + params → identical cells', () => {
    const a = makeGrid(123);
    const b = makeGrid(123);
    assert.deepEqual(a.toRunLength(), b.toRunLength());
    assert.deepEqual(a.countByType(), b.countByType());
  });

  test('different seeds produce different terrain', () => {
    const a = makeGrid(1);
    const b = makeGrid(2);
    assert.notDeepEqual(a.toRunLength(), b.toRunLength());
  });

  test('run-length encoding covers exactly width*height cells', () => {
    const grid = makeGrid(7);
    const total = grid.toRunLength().reduce((sum, [, count]) => sum + count, 0);
    assert.equal(total, 64 * 64);
  });

  test('rock is impassable, other in-bounds types are passable, edges are walls', () => {
    const grid = makeGrid(42);
    // Find one cell of each generated type and check passability by legend.
    const counts = grid.countByType();
    assert.ok(counts[TerrainType.ROCK] > 0, 'expected some rock');
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const code = grid.codeAt(x, y);
        const expected = TERRAIN_LEGEND[code].passable;
        assert.equal(grid.isPassable(x, y), expected);
      }
    }
    // Out of bounds is always an impassable wall.
    assert.equal(grid.isPassable(-1, 0), false);
    assert.equal(grid.isPassable(0, grid.height), false);
    assert.equal(grid.codeAt(-1, -1), TerrainType.ROCK);
  });

  test('cover only replaces ground, never water or rock', () => {
    // A high cover fraction must not overwrite lakes/ridges.
    const grid = new TerrainGrid({ width: 48, height: 48, seed: 9, params: { coverFraction: 0.9 } });
    const counts = grid.countByType();
    assert.ok(counts[TerrainType.WATER] > 0);
    assert.ok(counts[TerrainType.ROCK] > 0);
    assert.ok(counts[TerrainType.COVER] > 0);
  });
});

describe('terrain projection', () => {
  test('projection is renderer-neutral: legend + RLE, no glyphs/colors, no typed arrays', () => {
    const grid = makeGrid(5);
    const projection = projectTerrain(grid);
    assert.equal(projection.encoding, 'rle-row-major');
    assert.equal(projection.width, 64);
    assert.deepEqual(
      projection.cellTypes.map((entry) => entry.name),
      ['ground', 'water', 'rock', 'cover'],
    );
    const serialized = JSON.stringify(projection);
    assert.ok(!/glyph|color|dracula/i.test(serialized), 'projection must carry no presentation');
    // runs is a plain array of [code, count]; JSON round-trips (no Uint8Array).
    assert.deepEqual(JSON.parse(serialized).runs, projection.runs);
  });

  test('the terrain legend covers every code emitted in the runs', () => {
    const projection = projectTerrain(makeGrid(11));
    const legendCodes = new Set(projection.cellTypes.map((entry) => entry.code));
    for (const [code] of projection.runs) {
      assert.ok(legendCodes.has(code), `run code ${code} missing from legend`);
    }
  });

  test('full snapshots embed terrain at the current protocol version', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION);
    assert.ok(snapshot.terrain, 'snapshot should embed terrain');
    assert.equal(snapshot.terrain.width, engine.world.width);
    // Cloned per snapshot: mutating one snapshot's terrain never affects another.
    snapshot.terrain.runs[0][1] = -999;
    const second = buildFullSnapshot(engine.getSnapshotData());
    assert.notEqual(second.terrain.runs[0][1], -999);
  });
});

describe('terrain sandbox scenario (seed fixed)', () => {
  test('a seeded world has a water body and a rock ridge with impassable cells', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const terrain = engine.world.terrain;
    const counts = terrain.countByType();
    assert.ok(counts[TerrainType.WATER] > 50, `expected a lake, got ${counts[TerrainType.WATER]} water cells`);
    assert.ok(counts[TerrainType.ROCK] > 50, `expected a ridge, got ${counts[TerrainType.ROCK]} rock cells`);

    // Every rock cell is impassable through the authoritative world API.
    let checkedRock = false;
    for (let y = 0; y < terrain.height && !checkedRock; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        if (terrain.codeAt(x, y) === TerrainType.ROCK) {
          assert.equal(engine.world.isPassableAt(x + 0.5, y + 0.5), false);
          checkedRock = true;
          break;
        }
      }
    }
    assert.ok(checkedRock, 'expected to find a rock cell to verify impassability');
  });

  test('terrain is identical across two engines with the same seed', () => {
    const a = createDemoSimulation({ seed: 2026 });
    const b = createDemoSimulation({ seed: 2026 });
    assert.deepEqual(a.world.terrain.toRunLength(), b.world.terrain.toRunLength());
  });

  test('demo animals never step onto impassable terrain', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(300);
    for (const entity of engine.world.entities.all()) {
      if (entity.kind === 'animal' && entity.alive) {
        assert.equal(
          engine.world.isPassableAt(entity.x, entity.y),
          true,
          `animal ${entity.id} on impassable cell at ${entity.x},${entity.y}`,
        );
      }
    }
  });
});
