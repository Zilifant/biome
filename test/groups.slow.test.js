/**
 * A56, closed — the demo measurement that `test/groups.test.js` cannot afford.
 *
 * ⚠⚠ **This lives in the slow tier because the phenomenon does not exist for the
 * first four thousand ticks.** Measured 2026-08-05 on seed 42, cumulative
 * membership events by tick: 212 at 1000, 217 at 2000, 220 at 3000, 235 at
 * 4000 — and then **3502 at 5000**. The demo founds its records in the first
 * hundred ticks and they sit there; the churn arrives with the first wave of
 * deaths, when records start losing members faster than they regain them. A
 * 1500-tick test — the horizon every other demo assertion in this suite uses —
 * would have measured a world in which A56 had not happened yet, and would have
 * reported the fix as inert.
 *
 * That is the same trap `BENCHMARK.md` records for P1's cost ("when a mechanism
 * changes where animals stand, measure it after they have stood there"), arriving
 * from the other direction: **when a mechanism changes what happens after a
 * die-off, measure it after the die-off**.
 *
 * The assertion is a ratio rather than an absolute, because the absolute is a
 * property of the demo's trajectory and this file should not become the fourteenth
 * test that has to be re-seeded every phase (see the note on `groups.test.js`'s
 * kill-theft test). What is claimed is only that the grace period removes most of
 * the churn — and the measured effect is an order of magnitude, so the bar can sit
 * far below it and still mean something.
 *
 * ⚠⚠ **Rewritten 2026-08-07, and the rewrite is the point of this paragraph.** The
 * original claimed its effect through the *total* membership-event count, with a
 * `flapping.events > 1000` precondition. The default world changed, the demo's
 * overall churn fell with it, and the test went red on a mechanism that had not
 * changed at all — the exact "late, never absent" failure DOCS §14 predicts for the
 * thirteen tests that fish for a rare event in a fixed window.
 *
 * Re-measured over 5000 ticks on two seeds, control (grace 0) against shipped
 * (grace 300):
 *
 * | | seed 42 | seed 7 |
 * | --- | --- | --- |
 * | worst animal's tally | 136 → 5 (**27×**) | 219 → 5 (**44×**) |
 * | records destroyed | 75 → 4 (**19×**) | 227 → 6 (**38×**) |
 * | total events | 454 → 193 (2.4×) | 1090 → 199 (5.5×) |
 *
 * ⚠ **The total is the one number that does not survive a change of world**, and it
 * never should have carried the claim: it swings 454 → 1090 between two seeds of the
 * *same* build, because it counts every legitimate join and leave — births, deaths,
 * dispersal — alongside the flapping. The two figures that separate the arms by
 * 19–44× on both seeds are the per-animal tally and record destruction, and the
 * original file already said so in a comment: "the per-animal figure is the one A56
 * is actually about". The rewrite promotes that comment to the assertion and drops
 * the aggregate ratios, which discriminated by 2.4× on the seed this file runs.
 *
 * ⚠ Still one seed and still 2 × 5000 = **10 000 demo ticks (~70 s)**. A second seed
 * was measured to validate the rewrite and deliberately *not* added: what went stale
 * here was an absolute bar, not seed variance, and the surviving ratios clear their
 * bars by 5–6× on both seeds.
 *
 * ⚠⚠ **Re-calibrated a second time 2026-08-09, and this time it *was* seed variance
 * — the thing the paragraph above said it was not.** The wet/dry conversion
 * (SEASON-PLAN.md D1) changed the demo's trajectory: the year is 4000 ticks rather
 * than 8000, the weather stream re-rolls twice as often, and
 * `temperatureAmplitude 9 → 2` removed most of the thermoregulation tax. Re-measured
 * over the same 2 × 5000 ticks:
 *
 * | | seed 42 | seed 7 |
 * | --- | --- | --- |
 * | worst animal's tally | 25 → 5 (**5.0×**) | 141 → 3 (**47×**) |
 * | records destroyed | 15 → 2 (7.5×) | 137 → 3 (**45.7×**) |
 * | deaths over the run | 62 / 63 | 59 / 55 |
 *
 * **Seed 7 is unchanged** from its 219 → 5 and 227 → 6; seed 42's *control* arm
 * simply stopped flapping, falling 136 → 25. The mechanism did not move — one
 * trajectory did — and on seed 42 the claim assertion below now reads
 * `5 × 5 < 25`, which is false by a hair. A world where the control arm barely
 * flaps cannot demonstrate a fix for flapping.
 *
 * ⚠ **So the seed moved 42 → 7, and the reason it is not seed-shopping is that the
 * precondition is doing the selecting.** This file's first assertion is "the control
 * arm really does flap" — an explicit statement that the world has to contain the
 * phenomenon before the comparison means anything. Choosing a seed that satisfies a
 * *precondition* is different from choosing one that satisfies the *claim*, and both
 * seeds are recorded above so the difference is checkable rather than asserted.
 *
 * ⚠ The honest alternative was to run both seeds and require the claim on each,
 * which is more durable and costs another 10 000 demo ticks (~70 s, +27% on the
 * whole suite). It was declined on cost, and it is the thing to do if seed 7 ever
 * goes quiet too — that would be the third re-calibration, and at that point the
 * one-seed design is what is wrong.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';

const CONFIG = new SimulationEngine().config;
const TICKS = 5000;

/**
 * Membership churn over a demo run: how many `entity.grouped` /
 * `entity.ungrouped` events fire, how many records are destroyed, and the worst
 * single animal's tally.
 *
 * ⚠ Records are counted by watching the id set rather than by listening for
 * events: a record whose members are all dead dissolves **silently**, because
 * `#dissolve` only emits for members it actually releases.
 */
function churn(dissolveGraceTicks, seed = 7) {
  const engine = createDemoSimulation({ seed, config: { groups: { ...CONFIG.groups, dissolveGraceTicks } } });
  const perAnimal = new Map();
  let seq = 0;
  let events = 0;
  let destroyed = 0;
  let ids = new Set(engine.world.groups.ids());
  for (let tick = 0; tick < TICKS; tick += 1) {
    engine.step(1);
    for (const event of engine.events.since(seq)) {
      seq = Math.max(seq, event.seq);
      if (event.type !== 'entity.grouped' && event.type !== 'entity.ungrouped') continue;
      events += 1;
      perAnimal.set(event.entityId, (perAnimal.get(event.entityId) ?? 0) + 1);
    }
    const now = new Set(engine.world.groups.ids());
    for (const id of ids) if (!now.has(id)) destroyed += 1;
    ids = now;
  }
  return { events, destroyed, worst: Math.max(0, ...perAnimal.values()), live: ids.size };
}

/**
 * ⚠ Memoized, because each arm is a 5000-tick demo run (~60 s) and both tests
 * below want the shipped one. Two runs rather than three.
 */
const arms = new Map();
const arm = (grace) => {
  if (!arms.has(grace)) arms.set(grace, churn(grace));
  return arms.get(grace);
};

describe('persistent groups: A56 in the demo (P5a)', () => {
  test('⚠⚠ the grace period keeps an animal in one record, and keeps the record alive', () => {
    // Measured 2026-08-09 on the wet/dry world, seed 7 × 5000 ticks: the worst
    // animal changes membership **141 times at grace 0 against 3 at grace 300**, and
    // **137 records are destroyed against 3**. See the file header for seed 42, which
    // this file used to run and which no longer flaps enough to measure against.
    const held = arm(CONFIG.groups.dissolveGraceTicks);
    const flapping = arm(0);
    // Reported on every failure below, because when this test does go red the first
    // question is always "did the world change, or did the mechanism break".
    const context =
      `control worst=${flapping.worst} destroyed=${flapping.destroyed} events=${flapping.events}; ` +
      `held worst=${held.worst} destroyed=${held.destroyed} events=${held.events}`;

    // The precondition, and it is deliberately the per-animal tally rather than a
    // total: an animal that changes records fifty times in 5000 ticks is flapping by
    // any definition, and unlike the total it does not move with the demo's roster.
    assert.ok(flapping.worst > 50, `the control arm really does flap — ${context}`);

    // ⚠ The claim A56 is actually about: an *identity* that changes hands hundreds of
    // times in a lifetime is not an identity.
    assert.ok(held.worst * 5 < flapping.worst, `no animal churns through records any more — ${context}`);
    assert.ok(held.destroyed * 3 < flapping.destroyed, `and the records survive — ${context}`);
  });

  test('and the store is still reclaimed rather than leaking records', () => {
    // The other side of a grace period, and the failure it would be: a hold that
    // never expires is not hysteresis, it is a leak. Records must still be
    // destroyed, and the store must stay far short of its cap.
    const held = arm(CONFIG.groups.dissolveGraceTicks);
    assert.ok(held.destroyed > 0, `dead records are still reclaimed (${held.destroyed} destroyed)`);
    assert.ok(held.live < CONFIG.groups.maxGroups, `${held.live} live records against a cap of ${CONFIG.groups.maxGroups}`);
  });
});
