/**
 * Protocol v30 — reproductive state in bulk snapshots.
 *
 * Two booleans, `gestating` and `seekingMate`, projected for the reason
 * `diseaseState` was: a renderer that cannot see them cannot show them, and
 * "which females are carrying" and "who is in season" are the two facts that
 * make a rut and a calving season watchable rather than inferable from a birth
 * several hundred ticks later.
 *
 * ⚠ The whole point of the shape chosen here is that it adds **no state**: both
 * are derived on read from fields the reproduction system already maintains
 * every tick, exactly as `dispersing` is derived from the clock. A projection
 * that stored two more booleans on every entity would have to be kept in step
 * by every code path that changes either, which is the class of bug D30 is
 * about.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { PUBLIC_ENTITY_FIELDS, buildFullSnapshot } from '../src/protocol/snapshots.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';

const SEED = 42;

describe('protocol v30: reproductive state rides in bulk snapshots', () => {
  test('the version moved, and both fields are public', () => {
    // ⚠ **A floor, not an equality.** This suite is a record of what v30 added,
    // and the two fields below are its actual claim; pinning the live constant
    // to 30 made the *next* bump fail a test about reproductive state, which
    // says nothing about reproductive state. v31 (elevation) is what found it.
    assert.ok(PROTOCOL_VERSION >= 30, `reproductive state shipped at v30, and the protocol is at ${PROTOCOL_VERSION}`);
    for (const field of ['gestating', 'seekingMate']) {
      assert.ok(PUBLIC_ENTITY_FIELDS.includes(field), `${field} is a public entity field`);
    }
  });

  test('gestating follows the pregnancy, and nothing is stored to make it true', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(10);
    const animal = engine.world.entities.all().find((entity) => entity.kind === 'animal' && entity.alive);

    const before = engine.getSnapshotData().entities.find((entity) => entity.id === animal.id);
    assert.equal(before.gestating, false);

    // A pregnancy is `gestationUntil`, and that is the only thing the engine
    // records. The projection is a comparison, not a second copy of the truth.
    animal.gestationUntil = engine.tick + 600;
    assert.ok(!('gestating' in animal), 'the entity record itself gains no field');
    const during = engine.getSnapshotData().entities.find((entity) => entity.id === animal.id);
    assert.equal(during.gestating, true);

    animal.gestationUntil = null;
    const after = engine.getSnapshotData().entities.find((entity) => entity.id === animal.id);
    assert.equal(after.gestating, false, 'giving birth clears it with nothing to reset');
  });

  test('seekingMate follows the search clock, which is the season made visible', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(10);
    const animal = engine.world.entities.all().find((entity) => entity.kind === 'animal' && entity.alive);

    animal.mateSearchSince = null;
    assert.equal(engine.getSnapshotData().entities.find((e) => e.id === animal.id).seekingMate, false);
    animal.mateSearchSince = engine.tick;
    assert.ok(!('seekingMate' in animal), 'derived on read, like dispersing');
    assert.equal(engine.getSnapshotData().entities.find((e) => e.id === animal.id).seekingMate, true);
  });

  test('the demo actually produces both, so neither marker is decorative', () => {
    // ⚠ A projection nothing ever sets is indistinguishable from a broken one.
    // Ten ticks is enough for receptive females to be in the market; a
    // pregnancy needs a mating first, so this runs long enough for one.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(400);
    const entities = engine.getSnapshotData().entities;
    assert.ok(entities.some((entity) => entity.seekingMate), 'someone is looking for a mate');
    assert.ok(entities.some((entity) => entity.gestating), 'someone is carrying');
  });

  test('a full snapshot carries them through the protocol layer', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(400);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION, 'the builder stamps the live version');
    const carrying = snapshot.entities.find((entity) => entity.gestating);
    assert.ok(carrying, 'the projection survives the snapshot builder');
    assert.equal(typeof carrying.seekingMate, 'boolean', 'both are booleans, never undefined');
  });
});
