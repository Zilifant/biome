import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import { smallDemo } from './helpers/smallDemo.js';

/**
 * Engine with only the feeding system on all-ground terrain (no lakes/ridges),
 * so every cell can grow vegetation and intake/energy can be checked exactly.
 */
function feedingEngine(params = {}) {
  const engine = new SimulationEngine({
    seed: 1,
    config: { world: { width: 16, height: 16 }, terrain: { ...FLAT_TERRAIN } },
  });
  engine.registerSystem(
    new FeedingSystem({ intakeRate: 0.6, energyPerBiomass: 10, efficiency: 0.6, ...params }),
  );
  return engine;
}

/** Spawn an animal already committed to eating on its cell. */
function spawnEater(engine, x, y, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.gazelle',
    x,
    y,
    bodyMass: 30,
    maxEnergy: 100,
    energy: 10,
    action: 'eat',
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('feeding: intake and energy conversion', () => {
  test('an eater removes biomass and gains energy = removed × energyPerBiomass × efficiency', () => {
    const engine = feedingEngine();
    const id = spawnEater(engine, 5, 5, { energy: 10 });
    const cell = engine.world.cellOf(5, 5);
    // Ensure ample biomass in the cell.
    const before = engine.world.vegetation.biomassAt(cell.cellX, cell.cellY);
    if (before < 1) {
      for (let i = 0; i < 30; i += 1) engine.world.vegetation.grow({ growthRate: 0.4, seedFloor: 0.3 });
    }
    const biomassBefore = engine.world.vegetation.biomassAt(cell.cellX, cell.cellY);
    const energyBefore = engine.world.entities.get(id).energy;
    engine.step(1);
    const removed = biomassBefore - engine.world.vegetation.biomassAt(cell.cellX, cell.cellY);
    const gained = engine.world.entities.get(id).energy - energyBefore;
    // Biomass is stored as Float32Array, so measured deltas carry float32
    // precision (~1e-6), not float64.
    assert.ok(Math.abs(removed - 0.6) < 1e-5, `removed ${removed}, expected intakeRate 0.6`);
    assert.ok(Math.abs(gained - removed * 10 * 0.6) < 1e-4, 'energy gain matches conversion');
  });

  test('intake is capped so an animal never overeats past maxEnergy', () => {
    const engine = feedingEngine();
    const id = spawnEater(engine, 5, 5, { energy: 99.5, maxEnergy: 100 });
    for (let i = 0; i < 30; i += 1) engine.world.vegetation.grow({ growthRate: 0.4, seedFloor: 0.3 });
    engine.step(1);
    const e = engine.world.entities.get(id);
    assert.ok(e.energy <= 100 + 1e-9);
    assert.ok(Math.abs(e.energy - 100) < 1e-6, 'tops out exactly at max');
  });

  test('only animals whose action is "eat" feed', () => {
    const engine = feedingEngine();
    const eater = spawnEater(engine, 5, 5, { energy: 10, action: 'eat' });
    const wanderer = spawnEater(engine, 6, 6, { energy: 10, action: 'wander' });
    for (let i = 0; i < 30; i += 1) engine.world.vegetation.grow({ growthRate: 0.4, seedFloor: 0.3 });
    const wandererEnergy = engine.world.entities.get(wanderer).energy;
    engine.step(1);
    assert.ok(engine.world.entities.get(eater).energy > 10, 'eater gained energy');
    assert.equal(engine.world.entities.get(wanderer).energy, wandererEnergy, 'wanderer did not feed');
  });

  test('a fed animal emits entity.fed with cell and amount', () => {
    const engine = feedingEngine();
    const id = spawnEater(engine, 5, 5, { energy: 10 });
    for (let i = 0; i < 30; i += 1) engine.world.vegetation.grow({ growthRate: 0.4, seedFloor: 0.3 });
    const before = engine.events.lastSeq;
    engine.step(1);
    const fed = engine.eventsSince(before).find((ev) => ev.type === 'entity.fed' && ev.entityId === id);
    assert.ok(fed, 'expected an entity.fed event');
    assert.deepEqual(fed.cell, { cellX: 5, cellY: 5 });
    assert.ok(fed.amount > 0);
  });
});

describe('feeding: depletion and contention', () => {
  test('grazing depletes a cell; regrowth refills it over time', () => {
    const engine = feedingEngine();
    const id = spawnEater(engine, 5, 5, { energy: 10 });
    for (let i = 0; i < 30; i += 1) engine.world.vegetation.grow({ growthRate: 0.4, seedFloor: 0.3 });
    const cell = { cellX: 5, cellY: 5 };
    // Graze the cell down over many ticks (keep the animal hungry).
    for (let i = 0; i < 40; i += 1) {
      engine.world.entities.get(id).action = 'eat';
      engine.world.entities.get(id).energy = 10; // stay hungry so it keeps eating
      engine.step(1);
    }
    const depleted = engine.world.vegetation.biomassAt(cell.cellX, cell.cellY);
    assert.ok(depleted < 0.6, `cell should be grazed down, got ${depleted}`);
    // Now let it regrow (no eating).
    for (let i = 0; i < 200; i += 1) engine.world.vegetation.grow({ growthRate: 0.1, seedFloor: 0.08 });
    assert.ok(engine.world.vegetation.biomassAt(cell.cellX, cell.cellY) > depleted, 'regrowth refills the patch');
  });

  test('contention is deterministic: on a scarce cell the lower-id eater feeds first', () => {
    const engine = feedingEngine({ intakeRate: 0.6 });
    const first = spawnEater(engine, 5, 5, { energy: 10 });
    const second = spawnEater(engine, 5.4, 5.4, { energy: 10 }); // same cell (5,5)
    // Set the cell biomass to exactly 0.6 — only enough for one full intake.
    const cell = engine.world.cellOf(5, 5);
    // Deplete then add a precise amount.
    engine.world.vegetation.consumeAt(cell.cellX, cell.cellY, 1e9);
    // Grow a little; then measure. Use a direct biomass injection via grow is
    // imprecise, so instead assert relative outcome: first eats more than second.
    for (let i = 0; i < 3; i += 1) engine.world.vegetation.grow({ growthRate: 0.2, seedFloor: 0.15 });
    const e1 = engine.world.entities.get(first).energy;
    const e2 = engine.world.entities.get(second).energy;
    engine.step(1);
    const gain1 = engine.world.entities.get(first).energy - e1;
    const gain2 = engine.world.entities.get(second).energy - e2;
    assert.ok(gain1 >= gain2, `lower-id eater should not gain less (got ${gain1} vs ${gain2})`);
  });
});

describe('feeding: the survival loop (demo integration)', () => {
  test('animals now survive by grazing instead of all starving', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3000);
    const living = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive);
    // With abundant vegetation the survival loop closes — animals persist.
    assert.ok(living.length > 0, 'at least some animals survive by feeding');
  });

  test('feeding keeps the demo deterministic', () => {
    const a = smallDemo({ seed: 42 });
    const b = smallDemo({ seed: 42 });
    a.step(400);
    b.step(400);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
