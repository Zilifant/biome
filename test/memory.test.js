import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import {
  recordMemory,
  forgetMemory,
  bestRemembered,
  isNearDanger,
  MemoryKinds,
  MAX_MEMORIES,
} from '../src/simulation/memory/memories.js';
import { MemorySystem } from '../src/simulation/systems/MemorySystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { HydrationSystem } from '../src/simulation/systems/HydrationSystem.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import { smallDemo } from './helpers/smallDemo.js';

const CONFIG = new SimulationEngine().config;

/** Bare open ground: no lake, no ridge, no cover. */
function sandbox({ seed = 3, size = 44, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: size, height: size }, terrain: { ...FLAT_TERRAIN } },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

/** Strip every cell's biomass except one patch. */
function isolateFoodPatch(engine, patchX, patchY) {
  for (let cellY = 0; cellY < engine.world.terrain.height; cellY += 1) {
    for (let cellX = 0; cellX < engine.world.terrain.width; cellX += 1) {
      if (cellX !== patchX || cellY !== patchY) engine.world.vegetation.consumeAt(cellX, cellY, Number.MAX_SAFE_INTEGER);
    }
  }
  return engine.world.vegetation.biomassAt(patchX, patchY);
}

function spawnAnimal(engine, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.gazelle',
    heading: 0,
    lifeStage: 'adult',
    bodyMass: 30,
    speed: 1.2,
    maxEnergy: 100,
    energy: 100,
    maxHealth: 100,
    maxHydration: 100,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('memory: the bound holds', () => {
  test('an animal never remembers more than the cap, dropping the faintest first', () => {
    const entity = { memories: [] };
    for (let i = 0; i < MAX_MEMORIES; i += 1) recordMemory(entity, MemoryKinds.FOOD, i, 0, i);
    assert.equal(entity.memories.length, MAX_MEMORIES);

    // Make one memory clearly the faintest, then overflow the list.
    entity.memories[3].strength = 0.1;
    recordMemory(entity, MemoryKinds.FOOD, 99, 99, 100);
    assert.equal(entity.memories.length, MAX_MEMORIES, 'still capped');
    assert.ok(
      entity.memories.some((m) => m.cellX === 99),
      'the new place was remembered',
    );
    assert.ok(
      !entity.memories.some((m) => m.cellX === 3 && m.strength === 0.1),
      'the faintest memory was the one lost',
    );
  });

  test('re-experiencing a place refreshes it instead of filling the list', () => {
    const entity = { memories: [] };
    for (let tick = 0; tick < 500; tick += 1) recordMemory(entity, MemoryKinds.FOOD, 7, 7, tick);
    assert.equal(entity.memories.length, 1, 'standing in one patch cannot flood memory');
    assert.equal(entity.memories[0].strength, 1, 'and keeps it vivid');
    assert.equal(entity.memories[0].tick, 499);
  });

  test('the same cell is remembered separately per kind', () => {
    const entity = { memories: [] };
    recordMemory(entity, MemoryKinds.FOOD, 4, 4, 1);
    recordMemory(entity, MemoryKinds.WATER, 4, 4, 1);
    assert.equal(entity.memories.length, 2);
  });

  test('forgetMemory removes exactly one kind at one cell', () => {
    const entity = { memories: [] };
    recordMemory(entity, MemoryKinds.FOOD, 4, 4, 1);
    recordMemory(entity, MemoryKinds.WATER, 4, 4, 1);
    assert.equal(forgetMemory(entity, MemoryKinds.FOOD, 4, 4), true);
    assert.deepEqual(
      entity.memories.map((m) => m.kind),
      [MemoryKinds.WATER],
    );
    assert.equal(forgetMemory(entity, MemoryKinds.FOOD, 4, 4), false, 'forgetting twice is harmless');
  });
});

describe('memory: fading', () => {
  test('memories weaken and are eventually forgotten entirely', () => {
    const engine = sandbox({ systems: [new MemorySystem({ ...CONFIG.memory, updateInterval: 1 })] });
    const id = spawnAnimal(engine, { x: 10, y: 10 });
    const entity = engine.world.entities.get(id);
    recordMemory(entity, MemoryKinds.FOOD, 5, 5, 0);

    engine.step(50);
    const faded = entity.memories[0].strength;
    assert.ok(faded < 1 && faded > 0, `partly faded (${faded})`);

    engine.step(400);
    assert.equal(entity.memories.length, 0, 'forgotten once too faint');
  });

  test('water never fades at all — a lake does not move, so a drinking spot is remembered for good', () => {
    const engine = sandbox({ systems: [new MemorySystem({ ...CONFIG.memory, updateInterval: 1 })] });
    const entity = engine.world.entities.get(spawnAnimal(engine, { x: 10, y: 10 }));
    recordMemory(entity, MemoryKinds.WATER, 5, 5, 0);
    engine.step(5000); // far longer than any other memory would survive
    assert.equal(entity.memories.length, 1, 'the water memory is still held');
    assert.equal(entity.memories[0].strength, 1, 'and at full strength — water does not decay');
  });

  test('water outlasts food, and "nothing here" fades fastest — lakes do not move', () => {
    const engine = sandbox({ systems: [new MemorySystem({ ...CONFIG.memory, updateInterval: 1 })] });
    const id = spawnAnimal(engine, { x: 10, y: 10 });
    const entity = engine.world.entities.get(id);
    for (const kind of [MemoryKinds.FOOD, MemoryKinds.WATER, MemoryKinds.BARREN, MemoryKinds.DANGER]) {
      recordMemory(entity, kind, 5, 5, 0);
    }
    engine.step(100);
    const strength = Object.fromEntries(entity.memories.map((m) => [m.kind, m.strength]));
    assert.ok(strength.water > strength.danger, 'water is the most durable memory');
    assert.ok(strength.danger > strength.food, 'danger outlasts a grass patch');
    assert.ok(strength.food > strength.barren, 'and "nothing here" expires soonest of all');
  });

  test('staggering the memory system does not change how fast memories fade', () => {
    const rates = [1, 5].map((updateInterval) => {
      const engine = sandbox({ systems: [new MemorySystem({ ...CONFIG.memory, updateInterval })] });
      const entity = engine.world.entities.get(spawnAnimal(engine, { x: 10, y: 10 }));
      recordMemory(entity, MemoryKinds.FOOD, 5, 5, 0);
      engine.step(100);
      return entity.memories[0].strength;
    });
    assert.ok(Math.abs(rates[0] - rates[1]) < 1e-9, `decay is interval-independent (${rates})`);
  });
});

describe('memory: choosing what to recall', () => {
  const at = (x, y) => ({ x, y, maxDistance: 100 });

  test('a vivid memory far away loses to a fainter one close by', () => {
    const entity = { memories: [], x: 0, y: 0 };
    recordMemory(entity, MemoryKinds.FOOD, 40, 0, 0); // vivid, distant
    const near = recordMemory(entity, MemoryKinds.FOOD, 2, 0, 0);
    near.strength = 0.4; // faint, close
    const best = bestRemembered(entity, MemoryKinds.FOOD, at(0.5, 0.5));
    assert.equal(best.memory.cellX, 2, 'walked to the near one');
  });

  test('places beyond recall range are not considered', () => {
    const entity = { memories: [] };
    recordMemory(entity, MemoryKinds.FOOD, 80, 0, 0);
    assert.equal(bestRemembered(entity, MemoryKinds.FOOD, { x: 0, y: 0, maxDistance: 10 }), null);
  });

  test('a remembered place near remembered danger is not recalled', () => {
    const entity = { memories: [] };
    recordMemory(entity, MemoryKinds.FOOD, 10, 10, 0);
    assert.ok(bestRemembered(entity, MemoryKinds.FOOD, { ...at(0.5, 0.5), dangerRadius: 6 }), 'safe to begin with');

    recordMemory(entity, MemoryKinds.DANGER, 11, 10, 0);
    assert.equal(
      bestRemembered(entity, MemoryKinds.FOOD, { ...at(0.5, 0.5), dangerRadius: 6 }),
      null,
      'the patch is now too close to somewhere frightening',
    );
    assert.ok(
      bestRemembered(entity, MemoryKinds.FOOD, { ...at(0.5, 0.5), dangerRadius: 0 }),
      'and is recalled again if danger is not being avoided',
    );
    assert.equal(isNearDanger(entity, 11.5, 10.5, 2), true);
    assert.equal(isNearDanger(entity, 40, 40, 2), false);
  });
});

describe('memory: what an animal learns', () => {
  test('eating records the place; finding it bare replaces that with "nothing here"', () => {
    const engine = sandbox({ systems: [new FeedingSystem({ ...CONFIG.feeding, maxMemories: 8 })] });
    isolateFoodPatch(engine, 20, 20);
    const id = spawnAnimal(engine, { x: 20.5, y: 20.5, energy: 10, action: 'eat' });
    const entity = engine.world.entities.get(id);

    engine.step(1);
    const food = entity.memories.find((m) => m.kind === MemoryKinds.FOOD);
    assert.ok(food, 'remembered eating here');
    assert.deepEqual([food.cellX, food.cellY], [20, 20]);

    // Graze it to nothing, then keep trying — the memory must correct itself.
    engine.world.vegetation.consumeAt(20, 20, Number.MAX_SAFE_INTEGER);
    entity.action = 'eat';
    engine.step(1);
    assert.ok(!entity.memories.some((m) => m.kind === MemoryKinds.FOOD), 'stopped believing it is a patch');
    assert.ok(
      entity.memories.some((m) => m.kind === MemoryKinds.BARREN && m.cellX === 20),
      'and remembers the wasted trip',
    );
  });

  test('drinking records where the water was', () => {
    const engine = new SimulationEngine({ seed: 3, config: { world: { width: 40, height: 40 } } });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new HydrationSystem({ ...CONFIG.hydration, maxMemories: 8 }));
    // Find a real water cell in the generated lake and stand next to it.
    let water = null;
    for (let cellY = 0; cellY < 40 && !water; cellY += 1) {
      for (let cellX = 0; cellX < 40 && !water; cellX += 1) {
        if (engine.world.terrain.codeAt(cellX, cellY) === 1) water = { cellX, cellY };
      }
    }
    assert.ok(water, 'the sandbox world has a lake');
    const id = spawnAnimal(engine, { x: water.cellX + 0.5, y: water.cellY + 0.5, action: 'drink', hydration: 50 });
    engine.step(1);
    const entity = engine.world.entities.get(id);
    assert.ok(
      entity.memories.some((m) => m.kind === MemoryKinds.WATER),
      'remembered drinking',
    );
  });

  test('newborns start with a blank map — an animal learns its own world', () => {
    const engine = createDemoSimulation({ seed: 42 });
    for (const entity of engine.world.entities.all()) {
      assert.deepEqual(entity.memories, [], 'founders begin knowing nothing');
    }
    engine.step(400);
    const learned = [...engine.world.entities.all()].filter((e) => e.memories.length > 0);
    assert.ok(learned.length > 0, 'and learn by living');
  });
});

describe('memory: demonstration scenario — returning to a patch out of sight', () => {
  test('an animal that cannot see the patch walks back to it from memory', () => {
    const engine = sandbox({
      systems: [
        // Deliberately near-blind: perception radius 1, so nothing that follows
        // can be explained by the animal simply seeing the food.
        new PerceptionSystem({ defaultRadius: 1, foodMinLevel: 1 }),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new MovementSystem(),
        new FeedingSystem({ ...CONFIG.feeding, maxMemories: 8 }),
        new MemorySystem(CONFIG.memory),
      ],
    });
    isolateFoodPatch(engine, 20, 20);
    // An unknown species id so the perception radius above actually applies.
    const id = spawnAnimal(engine, { x: 20.5, y: 20.5, speciesId: 'test.nearsighted', energy: 20, action: 'eat' });
    const entity = engine.world.entities.get(id);

    // Learn the patch by eating at it.
    engine.step(1);
    assert.ok(
      entity.memories.some((m) => m.kind === MemoryKinds.FOOD && m.cellX === 20 && m.cellY === 20),
      'learned the patch',
    );

    // Carry it well away — far beyond anything it could perceive — and let
    // perception rebuild at the new spot before judging what it can see.
    engine.world.moveEntity(entity, 32.5, 20.5);
    entity.energy = 15; // hungry
    engine.step(1);
    assert.equal(engine.world.perception.get(id)?.nearestFood ?? null, null, 'nothing edible in sight from here');
    assert.equal(entity.action, 'recallFood', 'chose to act on memory');
    assert.deepEqual(entity.actionTarget, { cellX: 20, cellY: 20 }, 'aimed at the remembered patch');

    const startDistance = Math.hypot(entity.x - 20.5, entity.y - 20.5);
    let closest = startDistance;
    for (let tick = 0; tick < 40; tick += 1) {
      engine.step(1);
      closest = Math.min(closest, Math.hypot(entity.x - 20.5, entity.y - 20.5));
    }
    assert.ok(closest < 1.5, `walked back to the patch (${startDistance.toFixed(1)} → ${closest.toFixed(1)})`);
  });

  test('with the memory forgotten, the same animal does not go back', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem({ defaultRadius: 1, foodMinLevel: 1 }),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new MovementSystem(),
        new MemorySystem(CONFIG.memory),
      ],
    });
    isolateFoodPatch(engine, 20, 20);
    const id = spawnAnimal(engine, { x: 32.5, y: 20.5, speciesId: 'test.nearsighted', energy: 15 });
    const entity = engine.world.entities.get(id);
    engine.step(1);
    // Same position, same hunger, same blindness — only the memory is missing.
    assert.notEqual(entity.action, 'recallFood', 'nothing remembered, nothing to recall');
    assert.equal(entity.actionTarget, null);
  });
});

describe('memory: protocol, persistence, and determinism', () => {
  test('memories are inspection-only, strongest first, and returned as copies', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.ok(!('memories' in entity), 'memories must not ride in bulk snapshots');
    }
    assert.ok(!PUBLIC_ENTITY_FIELDS.includes('memories'));

    const remembering = [...engine.world.entities.all()].find((e) => e.memories.length > 1);
    assert.ok(remembering, 'some animal has learned a few places');
    const details = engine.getEntityDetails(remembering.id);
    for (let i = 1; i < details.memories.length; i += 1) {
      assert.ok(details.memories[i - 1].strength >= details.memories[i].strength, 'strongest first');
    }
    details.memories[0].strength = 99;
    details.memories.push({ kind: 'forged' });
    assert.notEqual(engine.world.entities.get(remembering.id).memories[0].strength, 99);
    assert.ok(!engine.world.entities.get(remembering.id).memories.some((m) => m.kind === 'forged'));
  });

  test('the demo stays within the cap and acts on what it remembers', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const actions = new Set();
    for (let tick = 0; tick < 4000; tick += 1) {
      engine.step(1);
      for (const entity of engine.world.entities.all()) {
        if (!entity.alive) continue;
        actions.add(entity.action);
        assert.ok(entity.memories.length <= CONFIG.memory.maxMemories, 'memory stays bounded');
      }
    }
    assert.ok(actions.has('recallWater'), `expected memory-driven water seeking, saw ${[...actions]}`);
  });

  test('memories survive save/load and the restored run continues identically', () => {
    const engine = smallDemo({ seed: 42 });
    engine.step(1200);
    const saved = captureSimulationState(engine);
    const before = [...engine.world.entities.all()].map((e) => ({ id: e.id, memories: e.memories }));
    assert.ok(before.some((e) => e.memories.length > 0), 'something was remembered by now');

    const restored = restoreDemoSimulation(saved);
    assert.deepEqual(
      [...restored.world.entities.all()].map((e) => ({ id: e.id, memories: e.memories })),
      before,
      'memories round-trip exactly',
    );
    engine.step(400);
    restored.step(400);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('memory keeps the demo deterministic', () => {
    const a = smallDemo({ seed: 42 });
    const b = smallDemo({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
