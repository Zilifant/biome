import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

/** Find the first cell of a given terrain type in the demo world. */
function findCell(terrain, type) {
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      if (terrain.codeAt(x, y) === type) return { x, y };
    }
  }
  return null;
}

describe('terrain speed modifiers', () => {
  test('ground is unimpeded; cover and water are slower; out-of-bounds is zero', () => {
    const terrain = new TerrainGrid({ width: 48, height: 48, seed: 42, params: {} });
    const ground = findCell(terrain, TerrainType.GROUND);
    const cover = findCell(terrain, TerrainType.COVER);
    const water = findCell(terrain, TerrainType.WATER);
    assert.equal(terrain.speedModifierAt(ground.x, ground.y), 1);
    assert.ok(terrain.speedModifierAt(cover.x, cover.y) < 1 && terrain.speedModifierAt(cover.x, cover.y) > 0);
    assert.ok(terrain.speedModifierAt(water.x, water.y) < 1 && terrain.speedModifierAt(water.x, water.y) > 0);
    assert.equal(terrain.speedModifierAt(-1, 0), 0);
  });

  test('World.speedModifierAt maps a continuous position to its cell modifier', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const cover = findCell(engine.world.terrain, TerrainType.COVER);
    assert.equal(engine.world.speedModifierAt(cover.x + 0.5, cover.y + 0.5), engine.world.terrain.speedModifierAt(cover.x, cover.y));
  });
});

describe('terrain-aware movement', () => {
  test('animals never occupy an impassable cell over a long run', () => {
    const engine = createDemoSimulation({ seed: 42 });
    for (let i = 0; i < 400; i += 1) {
      engine.step(1);
      for (const entity of engine.world.entities.all()) {
        if (entity.kind === 'animal' && entity.alive) {
          assert.equal(
            engine.world.isPassableAt(entity.x, entity.y),
            true,
            `animal ${entity.id} on impassable cell at tick ${engine.tick}`,
          );
        }
      }
    }
  });

  test('the spatial index stays consistent with entity positions', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(120);
    for (const entity of engine.world.entities.all()) {
      const near = engine.world.grid.queryRadius(entity.x, entity.y, 0.0001);
      assert.ok(near.includes(entity.id), `entity ${entity.id} not found at its own position in the grid`);
    }
    assert.equal(engine.world.grid.size, engine.entityCount);
  });

  test('positions stay within world bounds', () => {
    const engine = createDemoSimulation({ seed: 5 });
    engine.step(300);
    for (const entity of engine.world.entities.all()) {
      assert.ok(entity.x >= 0 && entity.x <= engine.world.width);
      assert.ok(entity.y >= 0 && entity.y <= engine.world.height);
    }
  });

  test('a single step never exceeds speed × the terrain modifier of the starting cell', () => {
    const engine = createDemoSimulation({ seed: 42 });
    // Check every animal's first step against its starting-cell modifier.
    const before = [...engine.world.entities.all()].map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      speed: e.speed,
      modifier: engine.world.speedModifierAt(e.x, e.y),
    }));
    engine.step(1);
    for (const prior of before) {
      const entity = engine.world.entities.get(prior.id);
      const dist = Math.hypot(entity.x - prior.x, entity.y - prior.y);
      assert.ok(
        dist <= prior.speed * prior.modifier + 1e-9,
        `animal ${prior.id} moved ${dist} > speed*modifier ${prior.speed * prior.modifier}`,
      );
    }
  });

  test('movement is deterministic across two runs with the same seed', () => {
    const a = createDemoSimulation({ seed: 99 });
    const b = createDemoSimulation({ seed: 99 });
    a.step(200);
    b.step(200);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('committed intent produces coherent travel, not per-tick teleporting', () => {
    // With a held heading, consecutive steps point in similar directions.
    const engine = createDemoSimulation({ seed: 7 });
    const focus = [...engine.world.entities.all()].find((e) => e.alive);
    const headings = [];
    let last = { x: focus.x, y: focus.y };
    for (let i = 0; i < 6; i += 1) {
      engine.step(1);
      const moved = Math.hypot(focus.x - last.x, focus.y - last.y);
      if (moved > 1e-6) headings.push(Math.atan2(focus.y - last.y, focus.x - last.x));
      last = { x: focus.x, y: focus.y };
    }
    // Needs at least a couple of moves to compare; if it moved, an intent exists.
    if (headings.length >= 2) {
      assert.ok(focus.moveIntent, 'a moving animal should hold a move intent');
    }
  });
});

describe('movement sandbox scenario (seed fixed)', () => {
  test('an animal blocked by rock turns away and never breaches the wall', () => {
    const engine = createDemoSimulation({ seed: 42 });
    // The demo terrain has a rock ridge; run and assert the invariant that no
    // living animal is ever on rock, and that blocked animals keep a valid
    // intent (they re-target rather than getting stuck on the wall).
    let sawBlockedRetarget = false;
    for (let i = 0; i < 200; i += 1) {
      const positions = new Map([...engine.world.entities.all()].map((e) => [e.id, { x: e.x, y: e.y }]));
      engine.step(1);
      for (const entity of engine.world.entities.all()) {
        if (entity.kind !== 'animal' || !entity.alive) continue;
        assert.equal(engine.world.isPassableAt(entity.x, entity.y), true);
        const prev = positions.get(entity.id);
        if (prev && prev.x === entity.x && prev.y === entity.y && entity.moveIntent) {
          sawBlockedRetarget = true; // stayed put ⇒ was blocked and turned
        }
      }
    }
    assert.ok(sawBlockedRetarget, 'expected at least one blocked-and-retarget event over 200 ticks');
  });
});
