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
function churn(dissolveGraceTicks, seed = 42) {
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
  test('⚠⚠ the grace period removes most of the membership churn', () => {
    // Measured 2026-08-05, seed 42 × 5000 ticks: **3502 membership events and 1168
    // records destroyed at grace 0, against 313 and ~18 at grace 300** — with one
    // hyena changing membership 937 times in the control arm and 9 in the shipped
    // one. The bars below are deliberately an order of magnitude looser than that.
    const held = arm(CONFIG.groups.dissolveGraceTicks);
    const flapping = arm(0);

    assert.ok(flapping.events > 1000, `the control arm really does flap (${flapping.events} events)`);
    assert.ok(
      held.events * 3 < flapping.events,
      `the grace period cuts the churn (${held.events} events against ${flapping.events} without)`,
    );
    assert.ok(
      held.destroyed * 3 < flapping.destroyed,
      `and the records survive (${held.destroyed} destroyed against ${flapping.destroyed})`,
    );
    // ⚠ The per-animal figure is the one A56 is actually about: an *identity* that
    // changes hands hundreds of times in a lifetime is not an identity.
    assert.ok(
      held.worst * 5 < flapping.worst,
      `no animal churns through records any more (worst ${held.worst} against ${flapping.worst})`,
    );
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
