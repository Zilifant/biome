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
import { CANOPY, GROUND, canClimb } from '../src/simulation/locomotion/climbing.js';
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

  test('⚠ only a declared climber, or a body one cached, is ever off the ground', () => {
    // ⚠ **This asserted "nothing is ever aloft" at phase T2, and was designed to
    // be replaced here**: that was the inertness claim, and T3 spends it by
    // making the leopard a climber. The durable invariant is narrower and more
    // useful — nothing gets off the ground *by accident*. An animal aloft must
    // be a species that declared `climbs`, and a carcass aloft must be one a
    // climber hauled there. Anything else is elevation leaking.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(2000);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      if (entity.elevation === GROUND) continue;
      const species = engine.world.species.get(entity.speciesId);
      assert.ok(
        entity.kind === 'carcass' || canClimb(species),
        `${entity.kind} ${entity.id} (${entity.speciesId}) is aloft and cannot climb`,
      );
    }
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
