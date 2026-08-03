import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { validateCommand } from '../src/protocol/validation.js';
import { parseBoundsQuery } from '../src/protocol/queries.js';
import {
  buildFullSnapshot,
  buildDeltaSnapshot,
  applyDeltaSnapshot,
  PUBLIC_ENTITY_FIELDS,
} from '../src/protocol/snapshots.js';
import { buildEventBatch } from '../src/protocol/events.js';
import { MIN_WORLD_DIMENSION, MAX_WORLD_DIMENSION } from '../src/protocol/commands.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';

describe('command validation', () => {
  const malformed = [
    null,
    'entity.spawn',
    { type: 42 },
    { type: 'unknown.command' },
    { type: 'simulation.setSpeed' },
    { type: 'simulation.setSpeed', multiplier: 0 },
    { type: 'simulation.setSpeed', multiplier: 'fast' },
    { type: 'simulation.step', ticks: 0 },
    { type: 'simulation.step', ticks: 2.5 },
    { type: 'entity.spawn' },
    { type: 'entity.spawn', entity: { kind: 'dragon', speciesId: 's', x: 1, y: 1 } },
    { type: 'entity.spawn', entity: { kind: 'animal', speciesId: '', x: 1, y: 1 } },
    { type: 'entity.spawn', entity: { kind: 'animal', speciesId: 's', x: 'here', y: 1 } },
    { type: 'entity.spawn', entity: { kind: 'animal', speciesId: 's', x: 1, y: Infinity } },
    { type: 'entity.remove' },
    { type: 'entity.remove', entityId: -1 },
    { type: 'entity.remove', entityId: 1.5 },
    { type: 'simulation.restart', seed: -1 },
    // ⚠ Derived, not restated. These read `width: 8` / `height: 4096` against a
    // 1024 ceiling until 2026-08-03, and the second silently stopped testing
    // anything the moment the cap was raised past 4096 — a bound-check case that
    // no longer sits outside the bound is a row that passes for the wrong
    // reason. Same lesson as the terrain-prevalence test (DOCS §19).
    { type: 'simulation.restart', width: MIN_WORLD_DIMENSION - 1 },
    { type: 'simulation.restart', height: MAX_WORLD_DIMENSION + 1 },
    { type: 'simulation.restart', width: 128.5 },
    { type: 'simulation.restart', herbivores: -1 },
    { type: 'simulation.restart', predators: 999999 },
    { type: 'simulation.restart', scavengers: 2.5 },
  ];

  test('malformed commands are rejected with structured errors', () => {
    for (const command of malformed) {
      const result = validateCommand(command);
      assert.equal(result.ok, false, `expected rejection: ${JSON.stringify(command)}`);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.every((error) => typeof error.message === 'string'));
    }
  });

  test('well-formed commands are accepted', () => {
    const wellFormed = [
      { type: 'simulation.pause' },
      { type: 'simulation.resume' },
      { type: 'simulation.setSpeed', multiplier: 2 },
      { type: 'simulation.step', ticks: 5 },
      { type: 'entity.spawn', entity: { kind: 'plant', speciesId: 'demo.grass', x: 1, y: 2 } },
      { type: 'entity.remove', entityId: 123 },
      { type: 'simulation.restart' },
      { type: 'simulation.restart', seed: 7 },
      { type: 'simulation.restart', seed: 7, width: 256, height: 128, herbivores: 300, predators: 20, scavengers: 0 },
      { type: 'simulation.restart', width: 16, height: 1024 }, // the exact bounds are inclusive
      { type: 'simulation.restart', herbivores: 20000, predators: 5000, scavengers: 5000 },
    ];
    for (const command of wellFormed) {
      assert.equal(validateCommand(command).ok, true, `expected acceptance: ${JSON.stringify(command)}`);
    }
  });

  test('engine rejects malformed and non-engine commands with structured results', () => {
    const engine = createDemoSimulation({ seed: 1 });
    const invalid = engine.submitCommand({ type: 'entity.spawn', entity: { kind: 'animal' } });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'invalid-command');
    const runnerOnly = engine.submitCommand({ type: 'simulation.pause' });
    assert.equal(runnerOnly.ok, false);
    assert.equal(runnerOnly.error.code, 'unsupported-command');
  });
});

describe('bounds parsing', () => {
  test('absent bounds are allowed, partial or malformed bounds are rejected', () => {
    assert.deepEqual(parseBoundsQuery({}), { ok: true, bounds: null });
    assert.equal(parseBoundsQuery({ minX: '0' }).ok, false);
    assert.equal(parseBoundsQuery({ minX: '0', minY: '0', maxX: 'wide', maxY: '5' }).ok, false);
    assert.equal(parseBoundsQuery({ minX: '9', minY: '0', maxX: '5', maxY: '5' }).ok, false);
    assert.deepEqual(parseBoundsQuery({ minX: '0', minY: '1', maxX: '10', maxY: '11' }), {
      ok: true,
      bounds: { minX: 0, minY: 1, maxX: 10, maxY: 11 },
    });
  });
});

describe('snapshots and deltas', () => {
  test('snapshots carry the protocol version and only public entity fields', () => {
    const engine = createDemoSimulation({ seed: 9 });
    engine.step(5);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION);
    assert.equal(snapshot.kind, 'snapshot.full');
    assert.equal(snapshot.tick, 5);
    assert.ok(snapshot.entities.length > 0);
    for (const entity of snapshot.entities) {
      assert.deepEqual(Object.keys(entity).sort(), [...PUBLIC_ENTITY_FIELDS].sort());
      assert.ok(entity.energyFraction >= 0 && entity.energyFraction <= 1);
    }
  });

  test('snapshots contain no references to internal mutable engine state', () => {
    const engine = createDemoSimulation({ seed: 9 });
    engine.step(2);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const target = snapshot.entities[0];
    const internal = engine.world.entities.get(target.id);
    target.x = 99999;
    target.alive = false;
    snapshot.world.width = -1;
    assert.notEqual(internal.x, 99999);
    assert.equal(internal.alive, true);
    assert.equal(engine.world.width > 0, true);
    // Two snapshot requests never share entity objects either.
    const again = buildFullSnapshot(engine.getSnapshotData());
    assert.notEqual(again.entities[0], snapshot.entities[0]);
  });

  test('bounded snapshot queries return only entities inside the region', () => {
    const engine = createDemoSimulation({ seed: 9 });
    const bounds = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
    const bounded = engine.getSnapshotData({ bounds });
    const full = engine.getSnapshotData();
    assert.ok(bounded.entities.length > 0);
    assert.ok(bounded.entities.length < full.entities.length);
    for (const entity of bounded.entities) {
      assert.ok(entity.x >= bounds.minX && entity.x <= bounds.maxX);
      assert.ok(entity.y >= bounds.minY && entity.y <= bounds.maxY);
    }
  });

  test('applying a delta to its base snapshot reproduces the next snapshot exactly', () => {
    const engine = createDemoSimulation({ seed: 5 });
    engine.step(3);
    const before = buildFullSnapshot(engine.getSnapshotData());
    // A newly spawned animal appears as a creation, then changes over time.
    const spawn = engine.submitCommand({
      type: 'entity.spawn',
      entity: { kind: 'animal', speciesId: 'herbivore.gazelle', x: 20, y: 20, energy: 80, maxEnergy: 100, bodyMass: 30 },
    });
    engine.step(2);
    const middle = buildFullSnapshot(engine.getSnapshotData());
    const deltaOne = buildDeltaSnapshot(before, middle, engine.eventsSince(before.lastEventSeq));
    assert.deepEqual(applyDeltaSnapshot(before, deltaOne), middle);
    assert.ok(deltaOne.created.some((entity) => entity.id === spawn.entityId), 'spawned entity appears in created');
    assert.ok(deltaOne.updated.length > 0, 'moving/feeding animals appear in updated');

    // Over the next window the animal moves/feeds/ages → appears in updated,
    // and the delta reconstructs the next snapshot exactly.
    engine.step(12);
    const after = buildFullSnapshot(engine.getSnapshotData());
    const deltaTwo = buildDeltaSnapshot(middle, after, engine.eventsSince(middle.lastEventSeq));
    assert.deepEqual(applyDeltaSnapshot(middle, deltaTwo), after);
    assert.ok(deltaTwo.updated.some((entity) => entity.id === spawn.entityId), 'the spawn changed and appears in updated');
  });

  test('a starvation carcass (kind change) reconstructs correctly through a delta', () => {
    // Controlled starvation (metabolism only, no feeding) so an animal reliably
    // dies and its animal→carcass kind change rides a delta `updated` entry.
    const engine = new SimulationEngine({ seed: 1, config: { world: { width: 16, height: 16 } } });
    engine.registerSystem(new MetabolismSystem({ basalRate: 0.04, edibleMassFraction: 0.6 }));
    const id = engine.world.entities.queueSpawn({ kind: 'animal', speciesId: 'herbivore.gazelle', x: 8, y: 8, bodyMass: 30, maxEnergy: 100, energy: 0.06 });
    engine.applyDeferredEntityChanges(0);
    engine.step(1);
    const before = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(before.entities.find((e) => e.id === id).kind, 'animal');
    engine.step(1); // energy hits 0 → carcass
    const after = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(before, after, engine.eventsSince(before.lastEventSeq));
    assert.deepEqual(applyDeltaSnapshot(before, delta), after);
    assert.ok(delta.updated.some((e) => e.id === id && e.kind === 'carcass'), 'carcass appears as an update');
    assert.ok(delta.events.some((e) => e.type === 'entity.died' && e.entityId === id && e.cause === 'starvation'));
  });

  test('delta event windows are exact: previous lastEventSeq exclusive, next inclusive', () => {
    const engine = createDemoSimulation({ seed: 5 });
    engine.step(2);
    const before = buildFullSnapshot(engine.getSnapshotData());
    engine.step(1);
    const after = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(before, after, engine.eventsSince(before.lastEventSeq));
    assert.ok(delta.events.length > 0);
    for (const event of delta.events) {
      assert.ok(event.seq > before.lastEventSeq && event.seq <= after.lastEventSeq);
    }
    const seqs = delta.events.map((event) => event.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'events arrive in seq order');
  });

  test('event batches are versioned and cloned', () => {
    const engine = createDemoSimulation({ seed: 5 });
    engine.step(1);
    const events = engine.eventsSince(0);
    const batch = buildEventBatch(events, { simulationId: engine.simulationId, tick: engine.tick });
    assert.equal(batch.protocolVersion, PROTOCOL_VERSION);
    assert.equal(batch.kind, 'events.batch');
    assert.equal(batch.firstSeq, 1);
    assert.equal(batch.lastSeq, engine.events.lastSeq);
    batch.events[0].type = 'tampered';
    assert.notEqual(engine.eventsSince(0)[0].type, 'tampered');
  });
});
