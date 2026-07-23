import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { TerrainGrid, TerrainType, TERRAIN_LEGEND } from '../src/simulation/world/TerrainGrid.js';

const TWO_PI = Math.PI * 2;
function angleGapDeg(a, b) {
  const norm = (r) => ((r % TWO_PI) + TWO_PI) % TWO_PI;
  let d = Math.abs((norm(a) - norm(b)) * (180 / Math.PI)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Centroid of the shallow-water cells, the drinkable ring an animal aims for. */
function shallowWaterCentroid(terrain) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      if (terrain.codeAt(x, y) === TerrainType.WATER) { sx += x; sy += y; n += 1; }
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n, n } : null;
}

describe('deep water: an impassable core inside a shallow drinkable ring', () => {
  test('a lake has both shallow water and a deep, impassable core', () => {
    const grid = new TerrainGrid({ width: 128, height: 128, seed: 42, params: {} });
    const counts = grid.countByType();
    const shallow = counts[TerrainType.WATER];
    const deep = counts[TerrainType.DEEP_WATER];
    assert.ok(shallow > 0, 'expected a shallow-water ring');
    assert.ok(deep > 0, 'expected a deep-water core');
    // The core is smaller than the ring around it (deepFraction < 1), and both
    // together are the lake.
    assert.ok(deep < shallow, `deep core (${deep}) should be smaller than the shallow ring (${shallow})`);
    // Deep water is impassable by the legend; shallow water is not.
    assert.equal(TERRAIN_LEGEND[TerrainType.DEEP_WATER].passable, false);
    assert.equal(TERRAIN_LEGEND[TerrainType.WATER].passable, true);
    assert.equal(grid.isPassable(...deepCell(grid)), false);
  });

  test('every deep-water cell is enclosed by water, never touching land directly', () => {
    // The whole point of the ring: an animal can never step from land straight
    // into deep water — there is always shallow water (or more deep water)
    // between them. So no deep cell has a passable *ground/cover* neighbour.
    const grid = new TerrainGrid({ width: 128, height: 128, seed: 7, params: {} });
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (grid.codeAt(x, y) !== TerrainType.DEEP_WATER) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const code = grid.codeAt(x + dx, y + dy);
          const isLand = code === TerrainType.GROUND || code === TerrainType.COVER;
          assert.ok(!isLand, `deep water at (${x},${y}) touches land — no shallow ring there`);
        }
      }
    }
  });

  test('lakeDeepFraction 0 leaves a fully shallow lake (no deep water)', () => {
    const grid = new TerrainGrid({ width: 128, height: 128, seed: 42, params: { lakeDeepFraction: 0 } });
    const counts = grid.countByType();
    assert.ok(counts[TerrainType.WATER] > 0, 'still a lake');
    assert.equal(counts[TerrainType.DEEP_WATER], 0, 'no deep core when disabled');
  });
});

function deepCell(grid) {
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.codeAt(x, y) === TerrainType.DEEP_WATER) return [x, y];
    }
  }
  throw new Error('no deep water generated');
}

describe('world.nearestWater: the long-range water bearing', () => {
  test('points toward the lake, with distance falling as you approach', () => {
    const engine = new SimulationEngine({ seed: 42 });
    const world = engine.world;
    const lake = shallowWaterCentroid(world.terrain);
    assert.ok(lake, 'demo world has a lake');

    // From a far land corner, the bearing should point roughly at the lake.
    const far = world.nearestWater(4, 4);
    assert.ok(far, 'a land cell has a water bearing');
    const toLake = Math.atan2(lake.y - 4, lake.x - 4);
    assert.ok(angleGapDeg(far.heading, toLake) < 35, `bearing ${far.heading} should aim at the lake ${toLake}`);

    // Stepping toward the lake shortens the reported distance.
    const near = world.nearestWater((4 + lake.x) / 2, (4 + lake.y) / 2);
    assert.ok(near.distance < far.distance, 'closer to the lake ⇒ smaller distance');
  });

  test('is null in a world with no water', () => {
    const engine = new SimulationEngine({ seed: 42, config: { terrain: { lakes: 0 } } });
    assert.equal(engine.world.nearestWater(30, 30), null);
  });
});
