import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem, hasLineOfSight } from '../src/simulation/systems/PerceptionSystem.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

/** Engine with only the perception system, for controlled scenarios. */
function perceptionEngine(radius = 5) {
  const engine = new SimulationEngine({ seed: 1, config: { world: { width: 64, height: 64 } } });
  engine.registerSystem(new PerceptionSystem({ defaultRadius: radius, foodMinLevel: 1, updateInterval: 1 }));
  return engine;
}

function spawn(engine, x, y, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'test.animal', // not in the registry → uses defaultRadius
    x,
    y,
    bodyMass: 30,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('perception: nearby animals', () => {
  test('perceives exactly the animals within radius, nearest first, excluding self', () => {
    const engine = perceptionEngine(5);
    const focus = spawn(engine, 30, 30);
    const near = spawn(engine, 32, 30); // distance 2
    const mid = spawn(engine, 30, 34); // distance 4
    const far = spawn(engine, 30, 40); // distance 10 — out of radius 5
    engine.step(1);
    const p = engine.world.perception.get(focus);
    assert.equal(p.animalCount, 2, 'sees near and mid, not far or self');
    assert.equal(p.nearestAnimal.id, near);
    assert.ok(Math.abs(p.nearestAnimal.distance - 2) < 1e-9);
    // Ground truth check against the spatial grid (radius filter).
    const gridIds = engine.world.grid.queryRadius(30, 30, 5).filter((id) => id !== focus);
    assert.deepEqual(gridIds.sort(), [near, mid].sort());
    assert.ok(!gridIds.includes(far));
  });

  test('dead animals (carcasses) are not perceived as animals', () => {
    const engine = perceptionEngine(5);
    const focus = spawn(engine, 30, 30);
    const other = spawn(engine, 31, 30);
    engine.world.entities.get(other).kind = 'carcass';
    engine.world.entities.get(other).alive = false;
    engine.step(1);
    assert.equal(engine.world.perception.get(focus).animalCount, 0);
  });
});

describe('perception: cell features', () => {
  test('finds the nearest food cell (vegetation ≥ threshold) within radius', () => {
    const engine = perceptionEngine(6);
    const focus = spawn(engine, 20, 20);
    // Ground-truth the nearest food cell by scanning the same neighborhood.
    engine.step(1);
    const p = engine.world.perception.get(focus);
    if (p.nearestFood) {
      // The reported cell really has vegetation ≥ 1 and is within radius.
      assert.ok(engine.world.vegetation.levelAt(p.nearestFood.cellX, p.nearestFood.cellY) >= 1);
      assert.ok(p.nearestFood.distance <= 6 + 1e-9);
      // No closer qualifying cell exists in the neighborhood.
      let closest = Infinity;
      for (let dy = -6; dy <= 6; dy += 1) {
        for (let dx = -6; dx <= 6; dx += 1) {
          const cx = 20 + dx;
          const cy = 20 + dy;
          const d = Math.hypot(cx + 0.5 - 20, cy + 0.5 - 20);
          if (d <= 6 && engine.world.vegetation.levelAt(cx, cy) >= 1) closest = Math.min(closest, d);
        }
      }
      assert.ok(Math.abs(p.nearestFood.distance - closest) < 1e-9);
    }
  });

  test('finds nearest water and obstacle when present in range', () => {
    // Perception-only engine on the demo terrain (seed 42 has water + rock),
    // so the animal does not move and perceived cells can be cross-checked
    // against a manual scan of the same, stable position.
    const engine = new SimulationEngine({ seed: 42, config: { world: { width: 128, height: 128 } } });
    engine.registerSystem(new PerceptionSystem({ defaultRadius: 8, foodMinLevel: 1, updateInterval: 1 }));
    // Place the animal next to a known water cell so water is definitely in range.
    let water = null;
    for (let y = 0; y < engine.world.terrain.height && !water; y += 1) {
      for (let x = 0; x < engine.world.terrain.width; x += 1) {
        if (engine.world.terrain.codeAt(x, y) === TerrainType.WATER) {
          water = { x, y };
          break;
        }
      }
    }
    const px = water.x + 2.5;
    const py = water.y + 0.5;
    const id = spawn(engine, px, py);
    engine.step(1);
    const p = engine.world.perception.get(id);

    // Manual scan against the same (unmoved) position, using the system's exact
    // squared-distance comparison to avoid float boundary disagreement.
    const r = Math.ceil(p.radius);
    const { cellX, cellY } = engine.world.cellOf(px, py);
    let expectWater = null;
    let expectObstacle = null;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const cx = cellX + dx;
        const cy = cellY + dy;
        const ds = (cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2;
        if (ds > p.radius * p.radius) continue;
        if (engine.world.terrain.codeAt(cx, cy) === TerrainType.WATER && (expectWater === null || ds < expectWater)) expectWater = ds;
        if (!engine.world.terrain.isPassable(cx, cy) && (expectObstacle === null || ds < expectObstacle)) expectObstacle = ds;
      }
    }
    assert.ok(p.nearestWater, 'water should be in range');
    assert.ok(Math.abs(p.nearestWater.distance - Math.sqrt(expectWater)) < 1e-9);
    assert.equal(!!p.nearestObstacle, expectObstacle !== null);
    if (p.nearestObstacle) assert.ok(Math.abs(p.nearestObstacle.distance - Math.sqrt(expectObstacle)) < 1e-9);
  });
});

describe('perception: locality and determinism', () => {
  test('perception is bounded: a distant animal is never in the summary', () => {
    const engine = perceptionEngine(4);
    const focus = spawn(engine, 10, 10);
    spawn(engine, 60, 60); // far corner
    engine.step(1);
    assert.equal(engine.world.perception.get(focus).animalCount, 0);
  });

  test('per-species radius from the registry overrides the default', () => {
    const engine = new SimulationEngine({ seed: 1, config: { world: { width: 64, height: 64 } } });
    engine.registerSystem(new PerceptionSystem({ defaultRadius: 3 }));
    const id = engine.world.entities.queueSpawn({ kind: 'animal', speciesId: 'herbivore.gazelle', x: 30, y: 30, bodyMass: 30 });
    engine.applyDeferredEntityChanges(0);
    engine.step(1);
    assert.equal(engine.world.perception.get(id).radius, 6); // herbivore.gazelle perceptionRadius
  });

  test('perception summaries are transient and not serialized', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(5);
    const saved = captureSimulationState(engine);
    assert.ok(!('perception' in saved));
    // Entity records carry no perceived summary either.
    assert.ok(saved.entities.entities.every((e) => !('perceived' in e) && !('perception' in e)));
  });

  test('perception is deterministic across two runs', () => {
    const a = createDemoSimulation({ seed: 13 });
    const b = createDemoSimulation({ seed: 13 });
    a.step(40);
    b.step(40);
    const pa = [...a.world.perception.entries()];
    const pb = [...b.world.perception.entries()];
    assert.deepEqual(pa, pb);
  });
});

describe('perception in inspection', () => {
  test('getEntityDetails exposes a perception summary for a living animal', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(2);
    const id = [...engine.world.entities.all()].find((e) => e.alive).id;
    const details = engine.getEntityDetails(id);
    assert.ok(details.perception, 'inspection should include perception');
    assert.equal(typeof details.perception.animalCount, 'number');
    assert.ok('nearestFood' in details.perception && 'nearestWater' in details.perception);
  });
});

/**
 * ⚠⚠ **A scavenger's nose reaches further than its eyes** (**A102**, 2026-08-10)
 * — `perception.carrionRadius`.
 *
 * **The gap it closes.** A scavenger in this world could reach a carcass exactly
 * three ways: see it inside its own `radius`, remember a place *it personally*
 * had fed, or join a **conspecific's** hunt. There was no fourth. A hyena cannot
 * perceive a lion in any actionable way — no cat has `scavenger.hyena` on its
 * prey list so `threatens` is false, the hyena hunts no cat so the species
 * relation is false the other way, and `nearestAnimal` is written by this system
 * and read by nothing. So it had no way to know a hunt was even happening: a body
 * appeared, and it learned of it only if it happened to be standing within 13
 * cells with clear sight. Measured: carrion was in a hyena's perception on
 * **14.8–23.3%** of its ticks and it could do nothing to raise that.
 *
 * ⚠ The most important test here is the **negative** one: a nose must not extend
 * anything else. The shared perception gate is A63 — prey, threats, mates and a
 * juvenile's guardian all pass through it — so a change made carelessly there
 * shows up as a population number three subsystems away.
 */
describe('perception: finding a body by smell', () => {
  const RESOLVED = new SimulationEngine().world.species;
  const HYENA = RESOLVED.get('scavenger.hyena');
  const LEOPARD = RESOLVED.get('predator.leopard');

  /** A flat world with the real roster and the real perception wiring. */
  function scentEngine() {
    const engine = new SimulationEngine({
      seed: 7,
      config: { world: { width: 128, height: 128 }, terrain: { ...FLAT_TERRAIN } },
    });
    engine.registerSystem(new PerceptionSystem({ ...engine.config.perception }));
    return engine;
  }

  function place(engine, speciesId, x, y) {
    const species = RESOLVED.get(speciesId);
    const id = engine.world.entities.queueSpawn({
      kind: 'animal',
      speciesId,
      x,
      y,
      lifeStage: 'adult',
      bodyMass: species.bodyMass,
      adultMass: species.bodyMass,
    });
    engine.applyDeferredEntityChanges(0);
    return id;
  }

  function placeCarcass(engine, x, y) {
    const id = engine.world.entities.queueSpawn({ kind: 'carcass', speciesId: 'herbivore.gazelle', x, y, edibleMass: 20 });
    engine.applyDeferredEntityChanges(0);
    return id;
  }

  test('the shipped hyena declares a nose and nothing else in the roster does', () => {
    assert.ok(HYENA.perception.carrionRadius > HYENA.perception.radius, 'the nose must beat the eyes to do anything');
    for (const species of RESOLVED.all()) {
      if (species.id === HYENA.id) continue;
      assert.equal(species.perception.carrionRadius, null, `${species.id} grew a nose without anybody deciding to`);
    }
  });

  test('⚠⚠ a body past sight but inside the nose is found — and the same body is invisible without one', () => {
    // The two animals are the same mass and nearly the same eyesight, so the only
    // thing separating them is the declared field. Distance sits deliberately
    // between the two species' sight radii and the hyena's carrion radius.
    const engine = scentEngine();
    const beyondSight = Math.max(HYENA.perception.radius, LEOPARD.perception.radius) + 4;
    assert.ok(beyondSight < HYENA.perception.carrionRadius, 'the fixture must sit inside the nose to test it');
    const hyena = place(engine, 'scavenger.hyena', 40, 40);
    const leopard = place(engine, 'predator.leopard', 40, 80);
    placeCarcass(engine, 40 + beyondSight, 40);
    placeCarcass(engine, 40 + beyondSight, 80);
    engine.step(1);
    assert.ok(engine.world.perception.get(hyena).nearestCarcass, 'the hyena smells it');
    assert.equal(engine.world.perception.get(leopard).nearestCarcass, null, 'the leopard, at the same range, does not');
  });

  test('the nose has an edge — a body past `carrionRadius` is still not found', () => {
    const engine = scentEngine();
    const hyena = place(engine, 'scavenger.hyena', 40, 40);
    placeCarcass(engine, 40 + HYENA.perception.carrionRadius + 2, 40);
    engine.step(1);
    assert.equal(engine.world.perception.get(hyena).nearestCarcass, null);
  });

  test('⚠⚠ it extends carrion and nothing else — the A63 guard', () => {
    // A live gazelle is prey to a hyena and a mate candidate is its own kind;
    // both come through the shared gate that the carcass branch sits beside. At a
    // range the nose reaches and the eyes do not, both must still be unseen.
    const engine = scentEngine();
    const hyena = place(engine, 'scavenger.hyena', 40, 40);
    const beyondSight = HYENA.perception.radius + 5;
    place(engine, 'herbivore.gazelle', 40 + beyondSight, 40); // prey
    place(engine, 'scavenger.hyena', 40, 40 + beyondSight); // conspecific / mate candidate
    place(engine, 'predator.lion', 40 - beyondSight, 40); // the biggest thing around
    engine.step(1);
    const p = engine.world.perception.get(hyena);
    assert.equal(p.nearestPrey, null, 'prey is not smelled');
    assert.equal(p.animalCount, 0, 'and no living animal is sensed at all past the eyes');
    assert.equal(p.mateCandidates.length, 0);
  });

  test('⚠ smell goes around a rock, and sight does not', () => {
    // The second half of the one field, asserted rather than assumed — and the
    // fixture proves its own premise first, or it would pass on a clear line.
    const engine = new SimulationEngine({ seed: 11, config: { world: { width: 128, height: 128 } } });
    engine.registerSystem(new PerceptionSystem({ ...engine.config.perception }));
    assert.equal(engine.config.perception.lineOfSight, true, 'this test is meaningless with sight lines off');
    const world = engine.world;
    let rock = null;
    for (let y = 6; y < world.terrain.height - 6 && rock === null; y += 1) {
      for (let x = 6; x < world.terrain.width - 6; x += 1) {
        if (world.terrain.codeAt(x, y) === TerrainType.ROCK) { rock = [x, y]; break; }
      }
    }
    assert.ok(rock, 'the generated world has rock to hide behind');
    const [rx, ry] = rock;
    const near = [rx - 4 + 0.5, ry + 0.5];
    const far = [rx + 4 + 0.5, ry + 0.5];
    assert.equal(hasLineOfSight(world, ...near, ...far), false, 'the rock really is between them');

    const hyena = place(engine, 'scavenger.hyena', ...near);
    const leopard = place(engine, 'predator.leopard', ...near);
    placeCarcass(engine, ...far);
    engine.step(1);
    assert.ok(engine.world.perception.get(hyena).nearestCarcass, 'the hyena smells through the rock');
    assert.equal(engine.world.perception.get(leopard).nearestCarcass, null, 'the leopard, beside it, cannot see it');
  });
});
