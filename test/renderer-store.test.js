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
import { describeCell } from '../src/renderer/app/ui/CellDetail.js';

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

/** A 2x2 claim grid, four world cells across each, held by #7 and #9. */
const territoryProjection = (revision = 1) => ({
  width: 2,
  height: 2,
  cellSize: 4,
  revision,
  encoding: 'rle-row-major',
  runs: [[7, 1], [0, 2], [9, 1]],
});

describe('renderer store: territory (v37)', () => {
  test('decodes the claim layer into a row-major owner lookup', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ territory: territoryProjection() }));
    assert.equal(store.territory.cellSize, 4);
    assert.deepEqual([...store.territory.owners], [7, 0, 0, 9]);
  });

  test('⚠ owner ids are not truncated to a byte', () => {
    // These cells name *somebody*. An eight-bit lane would alias animal #260's
    // ground onto animal #4's, which is a wrong picture rather than a crash.
    const store = new RendererStore();
    const wide = { ...territoryProjection(), runs: [[260, 4]] };
    store.applyFullSnapshot(snapshot({ territory: wide }));
    assert.deepEqual([...store.territory.owners], [260, 260, 260, 260]);
  });

  test('applies sparse territory deltas in place', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ territory: territoryProjection(1) }));
    store.applyDelta(delta({ territory: { width: 2, height: 2, cellSize: 4, revision: 2, changes: [[1, 7], [3, 0]] } }));
    assert.deepEqual([...store.territory.owners], [7, 7, 0, 0]);
    assert.equal(store.territory.revision, 2);
  });

  test('⚠ a delta that omits territory means nothing changed hands, not that nothing is claimed', () => {
    // The revision gate makes omission the common case by a wide margin, so
    // treating it as an empty layer would blink every territory off the map on
    // every ordinary tick.
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ territory: territoryProjection(1) }));
    store.applyDelta(delta());
    assert.deepEqual([...store.territory.owners], [7, 0, 0, 9]);
  });

  test('a snapshot without territory clears it', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ territory: territoryProjection() }));
    assert.ok(store.territory);
    store.applyFullSnapshot(snapshot());
    assert.equal(store.territory, null);
  });

  test('malformed territory runs (wrong cell count) are rejected', () => {
    const store = new RendererStore();
    const bad = { ...territoryProjection(), runs: [[7, 1]] }; // covers 1 of 4 cells
    assert.throws(() => store.applyFullSnapshot(snapshot({ territory: bad })), /territory runs cover/);
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
    // ⚠ Read off the fixture rather than hardcoded. The warm-up moved from 10 to
    // 2400 ticks when the territory layer needed a world old enough to have one
    // (see `scripts/generateRendererFixtures.js`), and a literal here is a test
    // that fails on the regeneration rather than on a defect.
    assert.equal(store.tick, fixtureSnapshot.tick);
    assert.equal(store.entityCount, fixtureSnapshot.entities.length);
    store.applyEventBatch(fixtureEvents);
    const eventCountAfterBatch = store.events.length;
    const result = store.applyDelta(fixtureDelta);
    assert.equal(result.applied, true);
    assert.equal(store.tick, fixtureSnapshot.tick + 1);
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
    // ⚠ `terrainStale` joined the result at SEASON-PLAN D8: terrain is static
    // *per season* now, so a delta reports the map's revision and the store says
    // when the one it decoded went out of date. False here — this fixture never
    // changes season.
    assert.deepEqual(result, { applied: true, terrainStale: false, created: 1, updated: 0, removed: 0 });
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

  test('per-tick chatter is bounded and the newest of it is kept', () => {
    // Trimming is amortized — a tier overflows by a whole cap before the buffer
    // is rebuilt — so the guarantee is a floor and a ceiling, not an exact size.
    const store = new RendererStore({ maxPassingEvents: 5 });
    store.applyFullSnapshot(snapshot());
    const events = Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, tick: 1, type: 'entity.moved', entityId: 1 }));
    store.applyEventBatch(events);
    assert.ok(store.events.length >= 5 && store.events.length <= 10, `kept ${store.events.length}`);
    assert.equal(store.events.at(-1).seq, 40, 'the newest event is always kept');
    assert.deepEqual(
      store.events.map((event) => event.seq),
      [...store.events].sort((a, b) => a.seq - b.seq).map((event) => event.seq),
      'the buffer stays seq-ascending',
    );
  });

  test('a milestone outlives the chatter that buried it', () => {
    // The whole point of two tiers: a birth is still in the log after enough
    // movement to have flushed a single shared buffer many times over.
    const store = new RendererStore({ maxPassingEvents: 5, maxLastingEvents: 100 });
    store.applyFullSnapshot(snapshot());
    store.applyEventBatch([{ seq: 1, tick: 1, type: 'entity.born', entityId: 7 }]);
    store.applyEventBatch(
      Array.from({ length: 500 }, (_, i) => ({ seq: i + 2, tick: 2, type: 'entity.moved', entityId: 1 })),
    );
    assert.ok(
      store.events.some((event) => event.type === 'entity.born' && event.entityId === 7),
      'the birth should survive 500 moves',
    );
  });

  test('milestones are bounded too, so a long run cannot grow without limit', () => {
    const store = new RendererStore({ maxLastingEvents: 10 });
    store.applyFullSnapshot(snapshot());
    store.applyEventBatch(
      Array.from({ length: 200 }, (_, i) => ({ seq: i + 1, tick: 1, type: 'entity.died', entityId: i })),
    );
    assert.ok(store.events.length <= 20, `kept ${store.events.length}`);
    assert.equal(store.events.at(-1).seq, 200);
  });

  test('a restart clears the log, but a recovery snapshot does not', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot());
    store.applyEventBatch([{ seq: 9, tick: 1, type: 'entity.born', entityId: 1 }]);

    // Same simulation: this is a resync after a gap, and the log is exactly
    // what survived it.
    store.applyFullSnapshot(snapshot({ tick: 40 }));
    assert.equal(store.events.length, 1);

    // Different simulation: nothing in the log describes this world, and its
    // event seqs start over — keeping the old watermark would swallow every
    // event the new world emits until it passed the old one.
    store.applyFullSnapshot(snapshot({ simulationId: 'sim-restarted' }));
    assert.equal(store.events.length, 0);
    store.applyEventBatch([{ seq: 1, tick: 1, type: 'entity.born', entityId: 1 }]);
    assert.equal(store.events.length, 1);
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

describe('renderer store: what an animal looked like alive', () => {
  // An event is about a moment; an entity is about now. The log said
  // `> hunt p122 → %65 caught` — its prey was already a carcass by the time the
  // line was drawn, and `#65` once the body decayed away. The store keeps the
  // last living form of every id so a past line can still name a past animal.
  const gazelle = (id, overrides = {}) =>
    entity(id, { speciesId: 'herbivore.gazelle', sex: 'female', lifeStage: 'juvenile', ...overrides });

  test('an animal is remembered as it was alive, through death and removal', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ entities: [gazelle(65)] }));
    assert.equal(store.rememberedAnimal(65).speciesId, 'herbivore.gazelle');

    // It grows up: the remembered form follows while it is alive.
    store.applyDelta(delta({ updated: [gazelle(65, { lifeStage: 'adult' })] }));
    assert.equal(store.rememberedAnimal(65).lifeStage, 'adult');

    // It is killed — the same id arrives back as a carcass — and then decays
    // out of the world entirely. Neither may overwrite what it was.
    store.applyDelta(delta({ baseTick: 6, tick: 7, updated: [entity(65, { kind: 'carcass', alive: false, decayStage: 1 })] }));
    assert.equal(store.getEntity(65).kind, 'carcass');
    assert.deepEqual(
      { speciesId: store.rememberedAnimal(65).speciesId, lifeStage: store.rememberedAnimal(65).lifeStage, sex: store.rememberedAnimal(65).sex },
      { speciesId: 'herbivore.gazelle', lifeStage: 'adult', sex: 'female' },
    );

    store.applyDelta(delta({ baseTick: 7, tick: 8, removed: [65] }));
    assert.equal(store.getEntity(65), null);
    assert.equal(store.rememberedAnimal(65).speciesId, 'herbivore.gazelle');
  });

  test('an id never seen alive is null rather than a guess', () => {
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ entities: [entity(9, { kind: 'carcass', alive: false })] }));
    assert.equal(store.rememberedAnimal(9), null, 'a carcass is not a form anything was seen in');
    assert.equal(store.rememberedAnimal(404), null);
  });

  test('a restart forgets them, because the new world reuses the same ids', () => {
    // Exactly where the event log is cleared, and for the same reason: keeping
    // them would draw a lion beside whatever animal happens to be #1 now.
    const store = new RendererStore();
    store.applyFullSnapshot(snapshot({ entities: [gazelle(1)] }));
    assert.ok(store.rememberedAnimal(1));

    store.applyFullSnapshot(snapshot({ simulationId: 'demo-2', entities: [] }));
    assert.equal(store.rememberedAnimal(1), null);

    // A *recovery* snapshot of the same world keeps them, as it keeps the log.
    store.applyFullSnapshot(snapshot({ simulationId: 'demo-2', entities: [gazelle(4)] }));
    store.applyFullSnapshot(snapshot({ simulationId: 'demo-2', tick: 9, entities: [] }));
    assert.ok(store.rememberedAnimal(4));
  });

  test('the memory is bounded, and dropping a living one costs nothing', () => {
    const store = new RendererStore({ maxRememberedAnimals: 4 });
    for (let id = 1; id <= 40; id += 1) {
      store.applyFullSnapshot(snapshot({ tick: id, entities: [gazelle(id)] }));
    }
    // Amortized like the event buffer: a whole cap of overflow before the trim.
    let remembered = 0;
    for (let id = 1; id <= 40; id += 1) if (store.rememberedAnimal(id)) remembered += 1;
    assert.ok(remembered <= 8, `expected the memory bounded near its cap, kept ${remembered}`);
    assert.ok(remembered >= 4, `expected at least a cap-worth kept, kept ${remembered}`);
    // The most recent are the ones kept — the oldest first-seen go first.
    assert.ok(store.rememberedAnimal(40), 'the newest is remembered');
  });
});

describe('cell description', () => {
  /** A 3x2 world with terrain, vegetation, a trail, and a fire. */
  const describedWorld = () => {
    const store = new RendererStore();
    store.applyFullSnapshot(
      snapshot({
        world: { width: 3, height: 2 },
        entities: [entity(1, { x: 1.4, y: 0.9 }), entity(2, { x: 1.8, y: 0.2 }), entity(3, { x: 2.5, y: 1.5 })],
        terrain: terrainProjection(),
        vegetation: vegetationProjection(),
        features: { revision: 1, cells: [{ cellX: 0, cellY: 1, kind: 'trail', wear: 0.62 }] },
        disturbances: [{ id: 7, kind: 'fire', x: 2.5, y: 0.5, radius: 1, startedTick: 3, until: 25 }],
      }),
    );
    return store;
  };

  test('describes bare ground: terrain, passability, and forage level', () => {
    const cell = describeCell(describedWorld(), 1, 0);
    assert.equal(cell.inWorld, true);
    assert.deepEqual(cell.terrain, { name: 'water', passable: true });
    assert.deepEqual(cell.vegetation, { level: 1, maxLevel: 4 });
    assert.equal(cell.feature, null);
  });

  test('impassable terrain is reported as such, not as unknown', () => {
    const cell = describeCell(describedWorld(), 2, 0);
    assert.deepEqual(cell.terrain, { name: 'rock', passable: false });
  });

  test('cells beyond the world edge are described, not thrown on', () => {
    const cell = describeCell(describedWorld(), -1, 99);
    assert.equal(cell.inWorld, false);
    assert.equal(cell.terrain, null);
    assert.equal(cell.vegetation.level, 0);
    assert.deepEqual(cell.occupantIds, []);
  });

  test('worn ground is reported with its kind and depth', () => {
    const cell = describeCell(describedWorld(), 0, 1);
    assert.deepEqual(cell.feature, { kind: 'trail', wear: 0.62 });
  });

  test('a disturbance is reported on the cells it actually covers', () => {
    const store = describedWorld(); // fire at (2.5, 0.5) radius 1, tick 5
    const inside = describeCell(store, 2, 0);
    assert.equal(inside.disturbances.length, 1);
    assert.equal(inside.disturbances[0].kind, 'fire');
    assert.equal(inside.disturbances[0].ticksRemaining, 20, 'until 25 from tick 5');
    // The edge is inclusive, and measured from the cell centre — cell (1,0)'s
    // centre sits at exactly the radius. This is the same test the grid draws
    // with, which is the point: what the panel claims covers a cell and what is
    // drawn over it can never disagree.
    assert.equal(describeCell(store, 1, 0).disturbances.length, 1, 'covered at exactly the radius');
    // Cell (0,0) centre is 2.5 units away, well outside.
    assert.deepEqual(describeCell(store, 0, 0).disturbances, []);
  });

  test('occupants are the entities whose grid cell is exactly this one', () => {
    const store = describedWorld();
    assert.deepEqual(describeCell(store, 1, 0).occupantIds, [1, 2]);
    assert.deepEqual(describeCell(store, 2, 1).occupantIds, [3]);
    assert.deepEqual(describeCell(store, 0, 0).occupantIds, []);
  });

  test('terrainPassableAt distinguishes unknown ground from impassable ground', () => {
    const store = describedWorld();
    assert.equal(store.terrainPassableAt(2, 0), false, 'rock is impassable');
    assert.equal(store.terrainPassableAt(0, 0), true, 'ground is passable');
    assert.equal(store.terrainPassableAt(99, 99), null, 'outside terrain is unknown, not impassable');
  });
});
