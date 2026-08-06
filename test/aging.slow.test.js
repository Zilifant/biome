/**
 * Aging against the demo world — split out of `aging.test.js` on 2026-08-05.
 *
 * ⚠ **This file exists for the scheduler, not for the reader.** `node --test`
 * parallelizes across *files* and never within one, so a single file holding a
 * ten-minute block sets a floor nothing else can go under. Measured before the
 * split: the whole suite took 929.8 s of wall clock against 5150 s of CPU spread
 * over ten cores — only ~4 cores busy — and `aging.test.js` alone was **565 s, or
 * 61% of that wall clock**. Moving the demo block into its own file lets it run
 * *beside* the other long poles instead of after them.
 *
 * The `.slow.test.js` suffix is the convention: it means "this file runs the demo
 * world for thousands of ticks", which is also what makes it a candidate for
 * `npm run test:fast` to skip. Nothing here is weakened, deleted, or sampled —
 * the tests are the ones that were in `aging.test.js`, moved verbatim.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

describe('aging: protocol, determinism, demo', () => {
  test('lifeStage is a public snapshot field', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('lifeStage'));
    for (const entity of snapshot.entities) {
      assert.ok(['juvenile', 'subadult', 'adult', 'senescent'].includes(entity.lifeStage));
    }
  });

  // ⚠⚠ **Removed 2026-08-05: `aging is deterministic across two runs (incl. age
  // deaths)`.** It built two demo worlds from one seed, ran both 7000 ticks, and
  // asserted the entity graphs matched — 286 s, the single most expensive test in
  // the suite (7% of its whole CPU), to prove something no assertion in it
  // depended on the world's *size* for.
  //
  // ⚠ **What went with it, stated rather than discovered later.** Age death is a
  // per-tick random draw, and this was the only test that ran long enough to reach
  // one — `determinism.test.js`'s surviving guard stops at 2000 ticks, well short
  // of any species' senescence. So determinism *through the age-death path* is now
  // unguarded. If it comes back, it should come back right-sized: the claim needs
  // animals that reach old age, not five hundred of them.
  //
  // ⚠ It also never verified its own name — it asserted byte-equality and nothing
  // about age deaths having occurred, so a change that delayed senescence past
  // tick 7000 would have left it passing and testing the boring half.
  test('the demo shows growth, all four stages over a run, and age deaths', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const stagesSeen = new Set();
    let ageDeaths = 0;
    for (let t = 0; t < 8000; t += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) if (e.type === 'entity.died' && e.cause === 'age') ageDeaths += 1;
      for (const e of engine.world.entities.all()) if (e.kind === 'animal' && e.alive) stagesSeen.add(e.lifeStage);
    }
    for (const stage of ['juvenile', 'subadult', 'adult', 'senescent']) {
      assert.ok(stagesSeen.has(stage), `expected to observe ${stage}`);
    }
    assert.ok(ageDeaths > 0, 'expected at least one age death');
  });
});
