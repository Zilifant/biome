import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { TerrainGrid, TerrainType, TERRAIN_LEGEND } from '../src/simulation/world/TerrainGrid.js';

describe('thicket: terrain properties', () => {
  const grid = new TerrainGrid({ width: 128, height: 128, seed: 42, params: {} });
  const thicket = firstCell(grid, TerrainType.THICKET);

  test('passable, but a crawl (extremely slow) — you can enter, you just barely move', () => {
    assert.equal(TERRAIN_LEGEND[TerrainType.THICKET].passable, true);
    assert.equal(grid.isPassable(...thicket), true);
    assert.ok(grid.speedModifierAt(...thicket) <= 0.15, `expected a crawl, got ${grid.speedModifierAt(...thicket)}`);
  });

  test('blocks line of sight', () => {
    assert.equal(grid.blocksSightAt(...thicket), true);
  });

  test('shelters from the weather and reads as thicket through the world chokepoints', () => {
    // The engine derives its own terrain seed, so find the thicket in *its*
    // terrain rather than the standalone grid above.
    const engine = new SimulationEngine({ seed: 42 });
    const cell = firstCell(engine.world.terrain, TerrainType.THICKET);
    assert.equal(engine.world.isShelteredAt(cell[0] + 0.5, cell[1] + 0.5), true);
    assert.equal(engine.world.isThicketAt(cell[0] + 0.5, cell[1] + 0.5), true);
    assert.equal(engine.world.blocksSightAt(cell[0] + 0.5, cell[1] + 0.5), true);
  });

  test('placed in clumps, more prevalent than rock', () => {
    const counts = grid.countByType();
    assert.ok(counts[TerrainType.THICKET] > 0, 'thickets exist');
    assert.ok(
      counts[TerrainType.THICKET] > counts[TerrainType.ROCK],
      `thicket (${counts[TerrainType.THICKET]}) should be more prevalent than rock (${counts[TerrainType.ROCK]})`,
    );
  });

  test('no thickets when disabled', () => {
    const flat = new TerrainGrid({ width: 128, height: 128, seed: 42, params: { thickets: 0 } });
    assert.equal(flat.countByType()[TerrainType.THICKET], 0);
  });
});

function firstCell(grid, code) {
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) if (grid.codeAt(x, y) === code) return [x, y];
  }
  throw new Error(`no cell of code ${code}`);
}

/** A thicket cell with an open-ground cell immediately to its west, for entry tests. */
function thicketWithGroundApproach(grid) {
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 1; x < grid.width; x += 1) {
      if (grid.codeAt(x, y) === TerrainType.THICKET && grid.codeAt(x - 1, y) === TerrainType.GROUND) {
        return { thicket: { x, y }, ground: { x: x - 1, y } };
      }
    }
  }
  throw new Error('no thicket with a ground approach');
}

describe('thicket: avoided unless it is the last choice', () => {
  function movementEngine() {
    const engine = new SimulationEngine({ seed: 42 });
    engine.registerSystem(new MovementSystem());
    return engine;
  }
  // Aim an animal due east, straight at a thicket cell one step away.
  function place(engine, ground, thicket, action) {
    const id = engine.world.entities.queueSpawn({
      kind: 'animal',
      speciesId: 'herbivore.grazer',
      x: ground.x + 0.5,
      y: ground.y + 0.5,
      bodyMass: 30,
      speed: 1.2,
      action,
      moveIntent: { heading: 0, ttl: 5, moving: true, sprint: action === 'flee' },
      stamina: 100,
      maxStamina: 100,
    });
    engine.applyDeferredEntityChanges(0);
    return engine.world.entities.get(id);
  }

  test('a non-fleeing animal turns away at the thicket edge rather than entering', () => {
    const engine = movementEngine();
    const { thicket, ground } = thicketWithGroundApproach(engine.world.terrain);
    const animal = place(engine, ground, thicket, 'wander');
    engine.step(1);
    // It did not step into the thicket cell...
    assert.ok(!engine.world.isThicketAt(animal.x, animal.y), `should not have entered the thicket (at ${animal.x},${animal.y})`);
    // ...and the block turned its heading around (≈ π), so it re-heads next tick.
    assert.ok(Math.abs(Math.abs(animal.heading) - Math.PI) < 0.2, `expected a turn-around, heading ${animal.heading}`);
  });

  test('a fleeing animal dives into the thicket (cover is worth the slog)', () => {
    const engine = movementEngine();
    const { thicket, ground } = thicketWithGroundApproach(engine.world.terrain);
    const animal = place(engine, ground, thicket, 'flee');
    engine.step(1);
    assert.ok(engine.world.isThicketAt(animal.x, animal.y), 'fleeing prey enters the thicket for refuge');
  });

  test('an animal already inside can push its way back out', () => {
    const engine = movementEngine();
    const { thicket } = thicketWithGroundApproach(engine.world.terrain);
    // Start inside the thicket, heading back west toward the ground approach.
    const id = engine.world.entities.queueSpawn({
      kind: 'animal',
      speciesId: 'herbivore.grazer',
      x: thicket.x + 0.5,
      y: thicket.y + 0.5,
      bodyMass: 30,
      speed: 1.2,
      action: 'wander',
      moveIntent: { heading: Math.PI, ttl: 5, moving: true, sprint: false },
    });
    engine.applyDeferredEntityChanges(0);
    const animal = engine.world.entities.get(id);
    const startX = animal.x;
    engine.step(1);
    assert.ok(animal.x < startX, 'moved west, out of the thicket, rather than being trapped');
  });
});
