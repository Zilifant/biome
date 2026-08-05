/**
 * Protocol v33 — persistent-group membership in bulk snapshots.
 *
 * One nullable integer, `groupRecordId`: which pride, clan or band an animal
 * belongs to. It has existed since v29 as an inspection-only **block** (the
 * record whole, for one animal at a time), and what changed at v33 is the
 * question being asked. Inspection answers "which pride is this lion in"; a
 * renderer drawing the social layer asks "where is every pride", and no number
 * of one-animal queries assembles that.
 *
 * ⚠ That is the standing bulk-vs-inspection test (DOCS §11) being *met*, not
 * waived: the rule is "per-tick and cheap", and this field changes only when an
 * animal joins, leaves, or its record dissolves — which A64 measured at ~107
 * events per 6000-tick run. It is cheaper per delta than `flying`, which v32
 * admitted on the same argument one version earlier.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { PUBLIC_ENTITY_FIELDS, buildFullSnapshot, buildDeltaSnapshot } from '../src/protocol/snapshots.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { describeSocialGroups } from '../src/renderer/app/rendering/SocialLayer.js';
import fullSnapshotFixture from '../src/renderer/fixtures/example-full-snapshot.json' with { type: 'json' };
import deltaFixture from '../src/renderer/fixtures/example-delta.json' with { type: 'json' };
import eventsFixture from '../src/renderer/fixtures/example-events.json' with { type: 'json' };

const SEED = 42;

describe('protocol v33: group membership rides in bulk snapshots', () => {
  test('the version moved, and the renderer and fixtures moved with it', () => {
    // ⚠ D31, and asserted against the *live* constants rather than literals: the
    // v29 bump shipped this comparison written against itself and a stale
    // renderer plus three stale fixtures passed.
    assert.ok(PROTOCOL_VERSION >= 33, `group membership shipped at v33, protocol is at ${PROTOCOL_VERSION}`);
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks the current protocol');
    for (const [name, fixture] of Object.entries({ fullSnapshotFixture, deltaFixture, eventsFixture })) {
      assert.equal(fixture.protocolVersion, PROTOCOL_VERSION, `${name} was regenerated for this version`);
    }
  });

  test('groupRecordId is a public field, and every entity carries a value for it', () => {
    // ⚠ The v31 failure in one assertion: a field in the whitelist and not in the
    // projection literal arrives with its key present and `undefined` inside, and
    // nothing anywhere errors. `null` is the answer for an unattached animal;
    // absent is not an answer at all.
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('groupRecordId'));
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(200);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(snapshot.entities.length > 0, 'there is a world to look at');
    for (const entity of snapshot.entities) {
      const value = entity.groupRecordId;
      assert.ok(value === null || typeof value === 'number', `entity ${entity.id} reports its record as ${value}`);
    }
  });

  test('a projected id names a record that actually exists, and its members agree', () => {
    // The durable invariant: the projection is a *view* of the registry, so a
    // snapshot can never disagree with it about who is in what. This is the check
    // that would fail if the field were ever written by anything but GroupSystem.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(600);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    let attached = 0;
    for (const entity of snapshot.entities) {
      if (entity.groupRecordId === null) continue;
      if (entity.kind !== 'animal') continue;
      attached += 1;
      const record = engine.world.groups.get(entity.groupRecordId);
      assert.ok(record, `entity ${entity.id} names record ${entity.groupRecordId}, which does not exist`);
      assert.ok(record.memberIds.includes(entity.id), `record ${record.id} does not list member ${entity.id}`);
      assert.equal(record.speciesId, entity.speciesId, 'a record holds one species');
    }
    // Three species form records in the demo (lion, hyena, zebra), so an empty
    // result here means the mechanism stopped firing rather than that the field
    // is quiet — the same claim v32 makes about birds being in the air.
    assert.ok(attached > 0, 'the demo founds real prides, clans and bands');
  });

  test('joining or leaving a group dirties a delta, so the outline moves', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(300);
    const member = engine.world.entities
      .all()
      .find((entity) => entity.kind === 'animal' && entity.alive && entity.groupRecordId !== null);
    assert.ok(member, 'someone is in a group after 300 ticks');
    const before = buildFullSnapshot(engine.getSnapshotData());
    const wasIn = member.groupRecordId;
    member.groupRecordId = null;
    const after = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(before, after);
    const updated = delta.updated.find((entity) => entity.id === member.id);
    assert.ok(updated, 'the animal that left is in the delta');
    assert.equal(updated.groupRecordId, null);
    member.groupRecordId = wasIn;
  });

  test('⚠ and the renderer outlines a real group straight off the snapshot, which is why it is projected', () => {
    // The whole justification for a bulk field is "a renderer cannot show what it
    // cannot see", and the claim is only true end to end. Asserted here rather
    // than in the renderer suite because only this side has a live world: the
    // renderer's own tests build entities by hand and cannot catch a field that
    // never arrives.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(400);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const groups = describeSocialGroups(snapshot.entities, snapshot.world);
    const records = groups.filter((group) => group.key.startsWith('record:'));
    assert.ok(records.length > 0, 'the social layer finds the demo’s records');
    assert.ok(
      groups.some((group) => group.key.startsWith('herd:')),
      'and the herd labels beside them, which is the overlap the layer is for',
    );
    for (const group of records) {
      assert.ok(group.loops.length > 0, `${group.key} traced an outline`);
      assert.ok(['pride', 'clan', 'band', 'family', 'group'].includes(group.kind), `${group.key} is a ${group.kind}`);
    }
  });
});
