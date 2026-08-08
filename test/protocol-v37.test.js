/**
 * Protocol v37 — the territorial claim layer is projected, closing §1.4 A36.
 *
 * A36 stood open on "a per-cell ownership layer in every snapshot would rival
 * vegetation for something that changes far more slowly", and what closed it was
 * projecting **less** of the layer rather than compressing it harder: owner ids
 * only, over the coarse claim grid, behind a revision that moves when a cell
 * changes hands. This file asserts the three halves of that argument a test can
 * hold — the shape, the gate, and the round trip. `territory.test.js` holds the
 * engine-side ones (the projection's memoization, and that nothing moved onto the
 * entity); the layer that *draws* it is `renderer-view.test.js`'s "the territory
 * layer".
 *
 * ⚠ **Tick cost: 2600 `smallDemo` ticks (~2.5 s), on one engine shared by every
 * test here.** The world is `smallDemo` because every claim in this file is about
 * the *machinery* — the projection covers the grid, the gate holds, a delta
 * reproduces the next snapshot — which is exactly what that helper's header lists
 * as legitimate. It is shared because the 2400-tick settle is the whole cost and
 * repeating it per test would be four of them: nothing here mutates the world
 * except the one test that steps it, which is the last to run and says so.
 * The settle itself is not negotiable — at ten ticks no lion is grown, so nothing
 * has marked any ground and there is no layer to assert anything about.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import {
  buildFullSnapshot,
  buildDeltaSnapshot,
  applyDeltaSnapshot,
  decodeTerritoryRuns,
} from '../src/protocol/snapshots.js';
import { smallDemo } from './helpers/smallDemo.js';
import fullSnapshotFixture from '../src/renderer/fixtures/example-full-snapshot.json' with { type: 'json' };
import deltaFixture from '../src/renderer/fixtures/example-delta.json' with { type: 'json' };
import eventsFixture from '../src/renderer/fixtures/example-events.json' with { type: 'json' };

const SEED = 42;
/** Long enough for a lion to be grown and to have marked ground. */
const SETTLE_TICKS = 2400;

let settled = null;
/** The shared world, built on first use so the file costs nothing when filtered out. */
function world() {
  if (settled === null) {
    settled = smallDemo({ seed: SEED });
    settled.step(SETTLE_TICKS);
  }
  return settled;
}

describe('protocol v37: the version and the renderer agree', () => {
  test('the version moved, and the renderer and fixtures moved with it', () => {
    assert.ok(PROTOCOL_VERSION >= 37, `the claim layer shipped at v37, protocol is at ${PROTOCOL_VERSION}`);
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks the current protocol');
    for (const [name, fixture] of Object.entries({ fullSnapshotFixture, deltaFixture, eventsFixture })) {
      assert.equal(fixture.protocolVersion, PROTOCOL_VERSION, `${name} was regenerated for this version`);
    }
  });

  test('⚠ the committed fixture actually holds a territory, which is what makes it testable at all', () => {
    // At the ten-tick warm-up this fixture had for years, no lion is grown, so
    // nothing had marked any ground: the layer drew nothing offline and the
    // browser suite could not see it. The warm-up moved to 2400 for exactly this,
    // and a fixture that quietly went back to being empty would take
    // `tests-ui/layers.spec.js` with it and look like a rendering fault.
    const { territory } = fullSnapshotFixture;
    assert.ok(territory, 'the fixture carries the claim layer');
    const claimed = territory.runs.filter(([ownerId]) => ownerId !== 0).reduce((total, [, count]) => total + count, 0);
    assert.ok(claimed > 0, 'and somebody holds ground in it');
    const byId = new Map(fullSnapshotFixture.entities.map((entity) => [entity.id, entity]));
    const holders = territory.runs.map(([ownerId]) => byId.get(ownerId)).filter(Boolean);
    assert.ok(
      holders.some((owner) => owner.speciesId === 'predator.lion' && owner.groupRecordId != null),
      'including a lion pride, which is what the territory layer is drawn to show',
    );
  });
});

describe('protocol v37: what the claim layer projects', () => {
  test('ownership only, over the coarse claim grid, covering it exactly', () => {
    const engine = world();
    const { territory } = buildFullSnapshot(engine.getSnapshotData());

    assert.equal(territory.encoding, 'rle-row-major');
    assert.equal(territory.cellSize, engine.world.scent.cellSize, 'the grid states its own resolution');
    assert.equal(territory.width, engine.world.scent.width);
    assert.equal(territory.height, engine.world.scent.height);
    // ⚠ Coarser than the world, which is half the cost argument: a claim is a
    // coarse-grained thing, and a per-world-cell layer would spend `cellSize²`
    // times the payload to say the same thing at a resolution nothing reads.
    assert.ok(territory.width < engine.world.width, 'the claim grid is coarser than the world grid');

    // The other half: a claim is two numbers and only one of them is projected.
    assert.ok(!('strength' in territory), 'freshness stays inside the engine');

    const owners = decodeTerritoryRuns(territory);
    assert.equal(owners.length, territory.width * territory.height, 'the runs cover the grid exactly');
    let claimed = 0;
    for (let cellY = 0; cellY < territory.height; cellY += 1) {
      for (let cellX = 0; cellX < territory.width; cellX += 1) {
        const owner = owners[cellY * territory.width + cellX];
        assert.equal(
          owner,
          engine.world.scent.ownerAt(cellX * territory.cellSize, cellY * territory.cellSize),
          `claim cell ${cellX},${cellY} says what the grid says`,
        );
        if (owner !== 0) claimed += 1;
      }
    }
    // Otherwise every assertion above is satisfied by an empty grid, which is
    // the failure the settle exists to prevent.
    assert.ok(claimed > 0, 'somebody holds ground after the settle');
  });

  test('⚠ a mutation of the projection cannot reach the engine', () => {
    const engine = world();
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const before = engine.world.scent.ownerAt(0, 0);
    snapshot.territory.runs[0][0] = 999999;
    assert.equal(engine.world.scent.ownerAt(0, 0), before, 'the snapshot owns its own runs');
  });

  // ⚠ Runs last and steps the shared world 200 ticks further. Nothing above
  // depends on the tick it is left on; anything added below must not either.
  test('the gate holds, and a delta reproduces the next snapshot’s territory exactly', () => {
    // The claim layer is *written* constantly — every mark refreshes a cell and
    // every decay sweep weakens one — and almost none of that moves a boundary.
    // If deltas carried it on those ticks the layer would not have been worth
    // projecting, which is precisely what A36 was open on.
    const engine = world();
    let previous = buildFullSnapshot(engine.getSnapshotData());
    let carried = 0;
    const window = 200;
    for (let i = 0; i < window; i += 1) {
      engine.step(1);
      const next = buildFullSnapshot(engine.getSnapshotData());
      const delta = buildDeltaSnapshot(previous, next, engine.eventsSince(previous.lastEventSeq));
      if (delta.territory) carried += 1;
      // Both branches are exercised many times over the window rather than once
      // by luck: a delta that carries the layer, and one that omits it.
      assert.deepEqual(applyDeltaSnapshot(previous, delta).territory, next.territory, `tick ${i}`);
      previous = next;
    }
    assert.ok(carried > 0, 'boundaries do move — measured 30 of 200 in this world');
    assert.ok(carried < window, `and most ticks move none (carried ${carried}/${window})`);
  });
});
