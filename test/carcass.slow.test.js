/**
 * Carcasses against the demo world — split out of `carcass.test.js` on 2026-08-05.
 *
 * ⚠ **This file exists for the scheduler, not for the reader**; see
 * `aging.slow.test.js` for the full argument. In short: `node --test`
 * parallelizes across *files* and never within one, and this block was **492 s**
 * of a 930 s suite. The `.slow.test.js` suffix means "runs the demo world for
 * thousands of ticks", which is also what `npm run test:fast` skips. The tests
 * below are the ones that were in `carcass.test.js`, moved verbatim.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { smallDemo } from './helpers/smallDemo.js';

const CONFIG = new SimulationEngine().config;

describe('carcass: protocol, persistence, and the demo', () => {
  test('decayStage rides in bulk snapshots so the renderer can ramp its glyph', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('decayStage'));
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.equal(typeof entity.decayStage, 'number');
      if (entity.alive) assert.equal(entity.decayStage, 0, 'living animals are always stage 0');
      assert.ok(!('edibleMass' in entity), 'absolute mass stays inspection-only');
    }
  });

  test('carcasses stop accumulating — the demo reaches a steady state', () => {
    // ⚠ **Recalibrated 2026-07-30 (phase 10), and the reason is worth keeping.**
    // This used to sample the standing count every *hundredth* tick and assert
    // that the count at tick 9000 was no higher than the highest sample — which
    // is an assertion about where the sampling happened to land, not about the
    // world. A phase-10 trajectory shift flipped it while the standing count
    // stayed in exactly the same band (final 98 → 111 against sampled peaks of
    // 117 → 110). Both arms describe the same steady state; only one of them
    // happened to end on a sample.
    //
    // What the test means is that bodies leave the world as fast as they arrive,
    // so it now says that directly: the count **falls** repeatedly over the run
    // (a world that accumulated would climb monotonically), and far more entities
    // have been removed than are standing. Neither depends on a sampling stride.
    //
    // ⚠⚠ **The window went 9000 → 15 000 ticks on 2026-08-04, and the reason is
    // a finding rather than a calibration.** In the ngorongoro demo the standing
    // carcass count is still *climbing* at tick 9000 — the old window ends inside
    // the transient, where the honest reading is that removal has not caught up
    // yet (152 removed against 204 standing). Measured on seed 42, cumulative
    // removed against standing: 177/314 at t10 000, 362/324 at t12 000, 607/284
    // at t14 000, 818/303 at t16 000. The peak is ~364 around t11 000 and it
    // oscillates in the 180–320 band thereafter, so the steady state is real —
    // it just arrives later and holds several times as many bodies in a world
    // ~4.8× the area with ~2.3× the founders. Lengthening the run was the only
    // change that keeps the claim the same claim; the alternative on offer was to
    // weaken the assertion until the transient satisfied it. See A81 — this world
    // has not been through the ten-seed gate, and this is the first measurement
    // that says so from inside the suite.
    const engine = createDemoSimulation({ seed: 42 });
    let removed = 0;
    let drops = 0;
    let previous = 0;
    const standingNow = () => [...engine.world.entities.all()].filter((e) => e.kind === 'carcass').length;
    for (let tick = 0; tick < 15000; tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.removed') removed += 1;
      }
      const standing = standingNow();
      if (standing < previous) drops += 1;
      previous = standing;
    }
    assert.ok(removed > 0, 'carcasses are actually leaving the world');
    const standing = standingNow();
    assert.ok(drops > 0, `the standing carcass count is bounded, not monotonic (${drops} falls)`);
    assert.ok(removed > standing, `removal keeps pace: ${removed} removed against ${standing} standing`);
    assert.ok(engine.world.tombstones.size <= CONFIG.lineage.maxTombstones, 'tombstones stay bounded');
  });

  test('carcass state and tombstones survive save/load; the run continues identically', () => {
    const engine = smallDemo({ seed: 42 });
    engine.step(4000);
    const saved = captureSimulationState(engine);
    assert.ok(saved.tombstones.length > 0, 'something has been forgotten by now');

    const restored = restoreDemoSimulation(saved);
    assert.equal(restored.world.tombstones.size, engine.world.tombstones.size, 'tombstones round-trip');
    assert.deepEqual(
      [...restored.world.entities.all()].map((e) => ({ id: e.id, decayStage: e.decayStage, diedTick: e.diedTick })),
      [...engine.world.entities.all()].map((e) => ({ id: e.id, decayStage: e.decayStage, diedTick: e.diedTick })),
    );
    engine.step(400);
    restored.step(400);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('decay keeps the demo deterministic', () => {
    const a = smallDemo({ seed: 42 });
    const b = smallDemo({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
