/**
 * Protocol v32 — flight in bulk snapshots.
 *
 * One boolean, `flying`. Projected on the same argument `elevation` made at v31
 * and `gestating` at v30 — **a renderer cannot show what it cannot see** — and the
 * case is stronger here than for either, because being airborne is the *only*
 * outward sign the mechanism has. Flying makes an animal faster, wider-seeing and
 * cheaper to run, and every one of those is invisible on a grid.
 *
 * ⚠ Two bumps in two days is the honest price of two separately-attributable
 * changes, and it is cheap: a version number, a test file, and regenerated
 * fixtures. Folding `flying` into v31 would have made "which version added which
 * field" unanswerable, and v31 had already shipped.
 *
 * ⚠ This field changes far more often than `elevation` does — a wander
 * commitment carries it for 8–24 ticks rather than for a whole rest — so unlike
 * v31 it has a real per-delta cost, and the number that bounds it is ground↔air
 * transitions per animal per 1000 ticks (see `locomotion/flight.js`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { PUBLIC_ENTITY_FIELDS, buildFullSnapshot, buildDeltaSnapshot } from '../src/protocol/snapshots.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { canFly } from '../src/simulation/locomotion/flight.js';
import { statusesOf } from '../src/renderer/app/rendering/EntityAppearance.js';
import fullSnapshotFixture from '../src/renderer/fixtures/example-full-snapshot.json' with { type: 'json' };
import deltaFixture from '../src/renderer/fixtures/example-delta.json' with { type: 'json' };
import eventsFixture from '../src/renderer/fixtures/example-events.json' with { type: 'json' };

const SEED = 42;

describe('protocol v32: flight rides in bulk snapshots', () => {
  test('the version moved, and the renderer and fixtures moved with it', () => {
    // ⚠ D31: `SUPPORTED_PROTOCOL_VERSION` must move in the same commit, and the
    // committed fixtures with it. Asserted against the *live* constant rather
    // than a literal, because the v29 bump shipped with this comparison written
    // against itself and a stale renderer plus three stale fixtures passed.
    assert.ok(PROTOCOL_VERSION >= 32, `flight shipped at v32, protocol is at ${PROTOCOL_VERSION}`);
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks the current protocol');
    for (const [name, fixture] of Object.entries({ fullSnapshotFixture, deltaFixture, eventsFixture })) {
      assert.equal(fixture.protocolVersion, PROTOCOL_VERSION, `${name} was regenerated for this version`);
    }
  });

  test('flying is a public entity field, and every entity carries a boolean', () => {
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('flying'));
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(200);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(snapshot.entities.length > 0, 'there is a world to look at');
    for (const entity of snapshot.entities) {
      assert.equal(typeof entity.flying, 'boolean', `entity ${entity.id} says whether it is flying`);
    }
  });

  test('⚠ only a declared flier is ever airborne, and never a carcass', () => {
    // The durable invariant, in the shape v31's became: nothing leaves the ground
    // *by accident*. Anything else is the flag leaking — and a carcass has no
    // wings, which is the difference from `elevation` (a cached body is aloft).
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(2000);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    let airborne = 0;
    for (const entity of snapshot.entities) {
      if (!entity.flying) continue;
      airborne += 1;
      assert.equal(entity.kind, 'animal', `a ${entity.kind} is flying`);
      assert.ok(canFly(engine.world.species.get(entity.speciesId)), `${entity.speciesId} is flying and has no wings`);
    }
    // ⚠ Not an inertness claim any more: the vulture flies from phase F2, so a
    // demo with none of its birds in the air after 2000 ticks would mean the
    // mechanism has stopped firing.
    assert.ok(airborne > 0, 'the demo has birds and they are using their wings');
  });

  test('⚠ and the renderer marks a bird straight off the snapshot, which is why it is projected', () => {
    // The whole justification for a bulk field is "a renderer cannot show what it
    // cannot see", and that claim is only true end to end: a *projected* entity
    // has to satisfy the appearance registry's predicate. Asserted here rather
    // than in the renderer suite because only this side has a live world — the
    // renderer's own tests use hand-built entities and cannot catch a field that
    // never arrives (which is exactly how v31 shipped `elevation` as `undefined`).
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(600);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const bird = snapshot.entities.find((entity) => entity.flying === true);
    assert.ok(bird, 'some bird is on the wing after 600 ticks');
    assert.deepEqual(statusesOf(bird).map((status) => status.id).includes('flying'), true);
  });

  test('a change in flight dirties a delta, so a takeoff is watchable', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(100);
    const grounded = engine.world.entities
      .all()
      .find((entity) => entity.kind === 'animal' && entity.alive && entity.flying === false);
    const before = buildFullSnapshot(engine.getSnapshotData());
    grounded.flying = true;
    const after = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(before, after);
    const updated = delta.updated.find((entity) => entity.id === grounded.id);
    assert.ok(updated, 'the animal that took off is in the delta');
    assert.equal(updated.flying, true);
  });
});
