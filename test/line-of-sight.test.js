import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem, hasLineOfSight } from '../src/simulation/systems/PerceptionSystem.js';
import { TerrainGrid, TerrainType } from '../src/simulation/world/TerrainGrid.js';

/** A world stand-in whose only job is to report opacity for a set of cells. */
function opacityWorld(opaque = []) {
  const set = new Set(opaque.map(([x, y]) => `${x},${y}`));
  return { blocksSightAt: (x, y) => set.has(`${Math.floor(x)},${Math.floor(y)}`) };
}

describe('hasLineOfSight: the raycast', () => {
  test('an unobstructed line is visible', () => {
    assert.equal(hasLineOfSight(opacityWorld(), 0.5, 0.5, 5.5, 0.5), true);
    assert.equal(hasLineOfSight(opacityWorld(), 0.5, 0.5, 5.5, 5.5), true); // diagonal
  });

  test('an opaque cell on the line blocks it', () => {
    assert.equal(hasLineOfSight(opacityWorld([[3, 0]]), 0.5, 0.5, 5.5, 0.5), false); // horizontal
    assert.equal(hasLineOfSight(opacityWorld([[0, 5]]), 0.5, 0.5, 0.5, 9.5), false); // vertical
    assert.equal(hasLineOfSight(opacityWorld([[3, 3]]), 0.5, 0.5, 6.5, 6.5), false); // diagonal
  });

  test('the endpoints themselves are exempt — you can be seen next to a rock', () => {
    // Opaque at the viewer's own cell and at the target's own cell: still visible.
    assert.equal(hasLineOfSight(opacityWorld([[0, 0]]), 0.5, 0.5, 5.5, 0.5), true);
    assert.equal(hasLineOfSight(opacityWorld([[5, 0]]), 0.5, 0.5, 5.5, 0.5), true);
  });

  test('adjacent and same-cell targets are always visible (nothing between)', () => {
    assert.equal(hasLineOfSight(opacityWorld([[1, 0]]), 0.5, 0.5, 1.5, 0.5), true); // target cell exempt
    assert.equal(hasLineOfSight(opacityWorld([[0, 0]]), 0.3, 0.3, 0.7, 0.7), true); // same cell
  });
});

describe('terrain opacity: a distinct property from passability', () => {
  test('rock blocks sight; ground, cover, and (impassable) deep water do not', () => {
    const grid = new TerrainGrid({ width: 128, height: 128, seed: 42, params: {} });
    const find = (code) => {
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) if (grid.codeAt(x, y) === code) return [x, y];
      }
      return null;
    };
    assert.equal(grid.blocksSightAt(...find(TerrainType.ROCK)), true);
    assert.equal(grid.blocksSightAt(...find(TerrainType.GROUND)), false);
    // Deep water is impassable but transparent — you see straight across a lake.
    assert.equal(grid.blocksSightAt(...find(TerrainType.DEEP_WATER)), false);
    assert.equal(grid.isPassable(...find(TerrainType.DEEP_WATER)), false);
    // Out of bounds is ROCK, hence opaque.
    assert.equal(grid.blocksSightAt(-1, -1), true);
  });

  test('world.blocksSightAt is the chokepoint over continuous positions', () => {
    const engine = new SimulationEngine({ seed: 42 });
    const rock = firstCell(engine.world.terrain, TerrainType.ROCK);
    const ground = firstCell(engine.world.terrain, TerrainType.GROUND);
    assert.equal(engine.world.blocksSightAt(rock[0] + 0.5, rock[1] + 0.5), true);
    assert.equal(engine.world.blocksSightAt(ground[0] + 0.5, ground[1] + 0.5), false);
  });
});

function firstCell(terrain, code) {
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) if (terrain.codeAt(x, y) === code) return [x, y];
  }
  throw new Error(`no cell of code ${code}`);
}

/** Two positions on the same row flanking a rock, chosen so the rock is between them. */
function findBlockedPair(world, radius) {
  const { terrain } = world;
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      if (terrain.codeAt(x, y) !== TerrainType.ROCK) continue;
      for (let half = 1; half <= Math.floor(radius / 2); half += 1) {
        const a = { x: x - half + 0.5, y: y + 0.5 };
        const b = { x: x + half + 0.5, y: y + 0.5 };
        if (!hasLineOfSight(world, a.x, a.y, b.x, b.y)) return { a, b };
      }
    }
  }
  throw new Error('no rock configuration blocked a short horizontal line');
}

describe('perception: line of sight hides animals behind rock', () => {
  function engineWith(lineOfSight) {
    const engine = new SimulationEngine({ seed: 42, config: { world: { width: 128, height: 128 } } });
    engine.registerSystem(new PerceptionSystem({ defaultRadius: 8, foodMinLevel: 1, lineOfSight }));
    return engine;
  }
  function spawn(engine, x, y) {
    const id = engine.world.entities.queueSpawn({ kind: 'animal', speciesId: 'test.animal', x, y, bodyMass: 30 });
    engine.applyDeferredEntityChanges(0);
    return id;
  }

  test('an animal behind rock is a neighbour but is not seen', () => {
    const engine = engineWith(true);
    const { a, b } = findBlockedPair(engine.world, 8);
    const focus = spawn(engine, a.x, a.y);
    spawn(engine, b.x, b.y);
    engine.step(1);
    const p = engine.world.perception.get(focus);
    // Seen: no — the rock is on the line.
    assert.equal(p.nearestAnimal, null, 'the hidden animal is not perceived');
    // But still counted on the shared walk (neighbours / animalCount stay raw,
    // so herding and alarm — which are not strictly line-of-sight — are intact).
    assert.equal(p.animalCount, 1, 'it is still a neighbour on the shared walk');
    assert.equal(engine.world.neighbourhood.get(focus).length, 2, 'neighbour list is unfiltered [id, dist]');
  });

  test('with line of sight off, the same animal is seen straight through the rock', () => {
    const engine = engineWith(false);
    const { a, b } = findBlockedPair(engine.world, 8);
    const focus = spawn(engine, a.x, a.y);
    const other = spawn(engine, b.x, b.y);
    engine.step(1);
    assert.equal(engine.world.perception.get(focus).nearestAnimal.id, other, 'no LOS ⇒ sees through');
  });

  test('a clear line to a neighbour is seen', () => {
    const engine = engineWith(true);
    // Open ground far from the lake/rock: two animals a couple of cells apart.
    const focus = spawn(engine, 4, 64);
    const other = spawn(engine, 6, 64);
    engine.step(1);
    const p = engine.world.perception.get(focus);
    assert.equal(p.nearestAnimal?.id, other, 'an unobstructed neighbour is seen');
  });
});
