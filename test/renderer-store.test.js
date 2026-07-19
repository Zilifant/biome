import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RendererStore,
  RendererProtocolError,
  StoreDesyncError,
  SUPPORTED_PROTOCOL_VERSION,
} from '../src/renderer/app/state/RendererStore.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/fixtures');
const loadFixture = (name) => JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));

/** Minimal synthetic protocol messages for focused cases. */
const entity = (id, overrides = {}) => ({
  id,
  kind: 'animal',
  speciesId: 'demo.grazer',
  x: 10,
  y: 10,
  heading: 0,
  age: 1,
  energyFraction: 0.5,
  alive: true,
  ...overrides,
});

const snapshot = (overrides = {}) => ({
  protocolVersion: SUPPORTED_PROTOCOL_VERSION,
  kind: 'snapshot.full',
  simulationId: 'demo-1',
  tick: 5,
  lastEventSeq: 10,
  world: { width: 64, height: 64 },
  entities: [entity(1), entity(2, { x: 20 })],
  ...overrides,
});

const delta = (overrides = {}) => ({
  protocolVersion: SUPPORTED_PROTOCOL_VERSION,
  kind: 'snapshot.delta',
  simulationId: 'demo-1',
  baseTick: 5,
  tick: 6,
  created: [],
  updated: [],
  removed: [],
  events: [],
  lastEventSeq: 10,
  ...overrides,
});

/** A small 3x2 terrain projection: ground/water/rock across two rows. */
const terrainProjection = () => ({
  width: 3,
  height: 2,
  cellTypes: [
    { code: 0, name: 'ground', passable: true },
    { code: 1, name: 'water', passable: true },
    { code: 2, name: 'rock', passable: false },
  ],
  encoding: 'rle-row-major',
  // row 0: ground, water, rock ; row 1: rock, ground, ground
  runs: [
    [0, 1],
    [1, 1],
    [2, 2],
    [0, 2],
  ],
});

describe('renderer store: terrain', () => {
  test('decodes the RLE terrain into a row-major cell lookup', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, terrain: terrainProjection() }));
    assert.equal(store.terrainNameAt(0, 0), 'ground');
    assert.equal(store.terrainNameAt(1, 0), 'water');
    assert.equal(store.terrainNameAt(2, 0), 'rock');
    assert.equal(store.terrainNameAt(0, 1), 'rock');
    assert.equal(store.terrainNameAt(2, 1), 'ground');
    // Out-of-bounds and absent terrain both report null (renderer draws edges).
    assert.equal(store.terrainNameAt(3, 0), null);
    assert.equal(store.terrainNameAt(-1, 0), null);
  });

  test('a snapshot without terrain clears any previously decoded terrain', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, terrain: terrainProjection() }));
    assert.ok(store.terrain);
    store.applyFullSnapshot(snapshot());
    assert.equal(store.terrain, null);
    assert.equal(store.terrainNameAt(0, 0), null);
  });

  test('malformed terrain runs (wrong cell count) are rejected', () => {
    const store = new RendererStore();
    const bad = terrainProjection();
    bad.runs = [[0, 1]]; // covers 1 of 6 cells
    assert.throws(() => store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, terrain: bad })), /terrain runs cover/);
  });
});

/** A 3x2 vegetation projection with levels 0..4. */
const vegetationProjection = (revision = 1) => ({
  width: 3,
  height: 2,
  maxLevel: 4,
  revision,
  encoding: 'rle-row-major',
  // row 0: 0,1,2 ; row 1: 4,0,3
  runs: [
    [0, 1],
    [1, 1],
    [2, 1],
    [4, 1],
    [0, 1],
    [3, 1],
  ],
});

describe('renderer store: vegetation', () => {
  test('decodes vegetation levels into a row-major lookup', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, vegetation: vegetationProjection() }));
    assert.equal(store.vegetationLevelAt(0, 0), 0);
    assert.equal(store.vegetationLevelAt(1, 0), 1);
    assert.equal(store.vegetationLevelAt(2, 0), 2);
    assert.equal(store.vegetationLevelAt(0, 1), 4);
    assert.equal(store.vegetationLevelAt(2, 1), 3);
    assert.equal(store.vegetationLevelAt(9, 9), 0); // out of bounds
  });

  test('applies sparse vegetation deltas in place', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, vegetation: vegetationProjection(1) }));
    const result = store.applyDelta(
      delta({ vegetation: { revision: 2, changes: [[0, 3], [4, 2]] } }),
    );
    assert.equal(result.applied, true);
    assert.equal(store.vegetationLevelAt(0, 0), 3); // index 0 changed 0 -> 3
    assert.equal(store.vegetationLevelAt(1, 1), 2); // index 4 changed 0 -> 2
    assert.equal(store.vegetationLevelAt(1, 0), 1); // unchanged
    assert.equal(store.vegetation.revision, 2);
  });

  test('an empty vegetation change set leaves levels untouched', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, vegetation: vegetationProjection(5) }));
    store.applyDelta(delta({ vegetation: { revision: 5, changes: [] } }));
    assert.equal(store.vegetationLevelAt(0, 1), 4);
  });

  test('a snapshot without vegetation clears it', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, vegetation: vegetationProjection() }));
    assert.ok(store.vegetation);
    store.applyFullSnapshot(snapshot());
    assert.equal(store.vegetation, null);
    assert.equal(store.vegetationLevelAt(0, 0), 0);
  });

  test('malformed vegetation runs (wrong cell count) are rejected', () => {
    const store = new RendererStore();
    const bad = vegetationProjection();
    bad.runs = [[1, 2]]; // covers 2 of 6 cells
    assert.throws(
      () => store.applyFullSnapshot(snapshot({ world: { width: 3, height: 2 }, vegetation: bad })),
      /vegetation runs cover/,
    );
  });
});

describe('renderer store: snapshots', () => {
  test('a full snapshot replaces authoritative render state', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    assert.equal(store.tick, 5);
    assert.equal(store.simulationId, 'demo-1');
    assert.deepEqual(store.world, { width: 64, height: 64 });
    assert.equal(store.entityCount, 2);
    assert.equal(store.getEntity(1).x, 10);
    // A later snapshot fully replaces, not merges.
    store.applyFullSnapshot(snapshot({ tick: 9, entities: [entity(3)] }));
    assert.equal(store.entityCount, 1);
    assert.equal(store.getEntity(1), null);
    assert.equal(store.getEntity(3).id, 3);
  });

  test('the committed fixture snapshot and delta apply cleanly', () => {
    const store = new RendererStore();
    const fixtureSnapshot = loadFixture('example-full-snapshot.json');
    const fixtureDelta = loadFixture('example-delta.json');
    const fixtureEvents = loadFixture('example-events.json');
    store.applyFullSnapshot(fixtureSnapshot);
    assert.equal(store.tick, 10);
    assert.equal(store.entityCount, fixtureSnapshot.entities.length);
    store.applyEventBatch(fixtureEvents);
    const eventCountAfterBatch = store.events.length;
    const result = store.applyDelta(fixtureDelta);
    assert.equal(result.applied, true);
    assert.equal(store.tick, 11);
    // The delta's events were already in the batch — dedupe by seq, no dupes.
    assert.equal(store.events.length, eventCountAfterBatch);
  });

  test('store state is cloned from messages, not referenced', () => {
    const store = new RendererStore();
    const message = snapshot();
    store.applyFullSnapshot(message);
    message.entities[0].x = 999;
    assert.equal(store.getEntity(1).x, 10);
  });

  test('snapshots missing required fields are rejected as malformed', () => {
    const store = new RendererStore();
    assert.throws(() => store.applyFullSnapshot(snapshot({ world: undefined })), RendererProtocolError);
    assert.throws(() => store.applyFullSnapshot(snapshot({ entities: 'nope' })), RendererProtocolError);
    assert.throws(() => store.applyFullSnapshot(snapshot({ tick: -1 })), RendererProtocolError);
  });
});

describe('renderer store: deltas', () => {
  test('deltas create entities', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    const result = store.applyDelta(delta({ created: [entity(7, { x: 33 })] }));
    assert.deepEqual(result, { applied: true, created: 1, updated: 0, removed: 0 });
    assert.equal(store.tick, 6);
    assert.equal(store.getEntity(7).x, 33);
  });

  test('deltas update entities and record the previous position for future interpolation', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    store.applyDelta(delta({ updated: [entity(1, { x: 11.5, age: 2 })] }));
    const updated = store.getEntity(1);
    assert.equal(updated.x, 11.5);
    assert.equal(updated.age, 2);
    assert.deepEqual(updated.previousPosition, { x: 10, y: 10 });
  });

  test('deltas remove entities', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    store.applyDelta(delta({ removed: [2] }));
    assert.equal(store.getEntity(2), null);
    assert.equal(store.entityCount, 1);
  });

  test('out-of-order deltas throw StoreDesyncError; stale deltas are ignored', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot()); // tick 5
    // A delta from the future (missed tick 6) is out of order.
    assert.throws(() => store.applyDelta(delta({ baseTick: 6, tick: 7 })), StoreDesyncError);
    // A delta at or before the current tick is stale, not fatal.
    assert.deepEqual(store.applyDelta(delta({ baseTick: 4, tick: 5 })), { applied: false, reason: 'stale' });
    assert.equal(store.tick, 5);
    // A delta before any snapshot is a desync.
    const empty = new RendererStore();
    assert.throws(() => empty.applyDelta(delta()), StoreDesyncError);
  });

  test('deltas referencing unknown entities throw StoreDesyncError without mutating', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    assert.throws(() => store.applyDelta(delta({ updated: [entity(99)] })), StoreDesyncError);
    assert.throws(() => store.applyDelta(delta({ removed: [98] })), StoreDesyncError);
    assert.equal(store.tick, 5, 'a rejected delta must not advance the tick');
    assert.equal(store.entityCount, 2);
  });

  test('deltas from a different simulation throw StoreDesyncError', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    assert.throws(() => store.applyDelta(delta({ simulationId: 'other-sim', baseTick: 5, tick: 6 })), StoreDesyncError);
  });
});

describe('renderer store: protocol version and events', () => {
  test('unsupported protocol versions are rejected everywhere', () => {
    const store = new RendererStore();
    const wrongVersion = SUPPORTED_PROTOCOL_VERSION + 1;
    assert.throws(
      () => store.applyFullSnapshot(snapshot({ protocolVersion: wrongVersion })),
      (error) => error instanceof RendererProtocolError && error.code === 'unsupported-protocol-version',
    );
    store.applyFullSnapshot(snapshot());
    assert.throws(() => store.applyDelta(delta({ protocolVersion: wrongVersion })), RendererProtocolError);
    assert.throws(
      () => store.applyEventBatch({ protocolVersion: wrongVersion, kind: 'events.batch', events: [] }),
      RendererProtocolError,
    );
  });

  test('event retention is bounded and keeps the newest events', () => {
    const store = new RendererStore({ maxEvents: 5 });
    store.applyFullSnapshot(snapshot());
    const events = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, tick: 1, type: 'entity.moved', entityId: 1 }));
    store.applyEventBatch(events);
    assert.equal(store.events.length, 5);
    assert.deepEqual(
      store.events.map((event) => event.seq),
      [8, 9, 10, 11, 12],
    );
  });

  test('events are deduplicated by seq across batches and deltas', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    store.applyEventBatch([
      { seq: 11, tick: 6, type: 'entity.died', entityId: 1 },
      { seq: 12, tick: 6, type: 'entity.removed', entityId: 1 },
    ]);
    store.applyDelta(delta({ removed: [1], events: [{ seq: 12, tick: 6, type: 'entity.removed', entityId: 1 }], lastEventSeq: 12 }));
    assert.equal(store.events.filter((event) => event.seq === 12).length, 1);
  });

  test('eventsForEntity returns newest-first events mentioning the entity', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    store.applyEventBatch([
      { seq: 11, tick: 6, type: 'entity.moved', entityId: 1 },
      { seq: 12, tick: 6, type: 'entity.moved', entityId: 2 },
      { seq: 13, tick: 7, type: 'entity.died', entityId: 1 },
    ]);
    const events = store.eventsForEntity(1);
    assert.deepEqual(events.map((event) => event.seq), [13, 11]);
  });

  test('getEntitiesInBounds filters by authoritative position', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot()); // entities at x=10 and x=20
    const inBounds = store.getEntitiesInBounds({ minX: 0, minY: 0, maxX: 15, maxY: 64 });
    assert.deepEqual(inBounds.map((entityRecord) => entityRecord.id), [1]);
  });
});
