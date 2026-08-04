/**
 * Protocol v31 — elevation in bulk snapshots.
 *
 * One small integer, `elevation`, on animals **and carcasses**: 0 on the ground,
 * 1 up a tree. Projected on the argument `diseaseState` and `gestating` each
 * made — a renderer cannot show what it cannot see, and "the leopard is in the
 * tree and the hyenas are underneath it" is the one visible consequence of the
 * whole elevation mechanism. Leaving it inspection-only would have made the
 * phase's result invisible on the grid.
 *
 * ⚠ Unlike v30's pair this is **stored** rather than derived, and that is not a
 * regression from the D30 discipline: elevation is not a function of anything
 * else the engine already maintains, it is a fact about where an animal *is*.
 * What keeps it safe is that exactly one system writes it (`MovementSystem`),
 * which is the same guarantee position itself has.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { PUBLIC_ENTITY_FIELDS, buildFullSnapshot, buildDeltaSnapshot } from '../src/protocol/snapshots.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { CANOPY, GROUND } from '../src/simulation/locomotion/climbing.js';
import fullSnapshotFixture from '../src/renderer/fixtures/example-full-snapshot.json' with { type: 'json' };
import deltaFixture from '../src/renderer/fixtures/example-delta.json' with { type: 'json' };
import eventsFixture from '../src/renderer/fixtures/example-events.json' with { type: 'json' };

const SEED = 42;

describe('protocol v31: elevation rides in bulk snapshots', () => {
  test('the version moved, and the renderer and fixtures moved with it', () => {
    // ⚠ D31: `SUPPORTED_PROTOCOL_VERSION` must move in the same commit, and the
    // committed fixtures with it. The v29 bump shipped with this comparison
    // written against *itself*, so a stale renderer and three stale fixtures
    // passed — hence comparing both against the live constant.
    assert.ok(PROTOCOL_VERSION >= 31, `elevation shipped at v31, protocol is at ${PROTOCOL_VERSION}`);
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks the current protocol');
    for (const [name, fixture] of Object.entries({ fullSnapshotFixture, deltaFixture, eventsFixture })) {
      assert.equal(fixture.protocolVersion, PROTOCOL_VERSION, `${name} was regenerated for this version`);
    }
  });

  test('elevation is a public entity field, and every entity carries one', () => {
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('elevation'));
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(200);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(snapshot.entities.length > 0, 'there is a world to look at');
    for (const entity of snapshot.entities) {
      assert.equal(typeof entity.elevation, 'number', `entity ${entity.id} has an elevation`);
      assert.ok(entity.elevation === GROUND || entity.elevation === CANOPY, 'and it is one of the two levels');
    }
  });

  test('⚠ every entity is on the ground in a world with no climbing species', () => {
    // The inertness claim, asserted through the protocol rather than inferred:
    // no shipped species declares `climbs`, so the field is uniformly 0 and the
    // projection costs a delta nothing it was not already costing.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(600);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const aloft = snapshot.entities.filter((entity) => entity.elevation !== GROUND);
    assert.deepEqual(aloft, [], 'nothing leaves the ground until a species says it can');
  });

  test('a change in elevation dirties a delta, so a climb is watchable', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(100);
    const before = buildFullSnapshot(engine.getSnapshotData());
    // Put one animal up a tree by hand — no species climbs yet, and the point
    // here is the *projection*, not the behaviour that would produce it.
    const climber = engine.world.entities.all().find((entity) => entity.kind === 'animal' && entity.alive);
    climber.elevation = CANOPY;
    const after = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(before, after);
    const updated = delta.updated.find((entity) => entity.id === climber.id);
    assert.ok(updated, 'the animal that went up is in the delta');
    assert.equal(updated.elevation, CANOPY);
  });
});
