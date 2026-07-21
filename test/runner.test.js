import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationRunner } from '../src/server/SimulationRunner.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { applyDeltaSnapshot } from '../src/protocol/snapshots.js';

/** A paused runner over the demo world, with every emission captured. */
function pausedRunner(seed = 42) {
  const runner = new SimulationRunner({ engine: createDemoSimulation({ seed }) });
  const ticks = [];
  runner.on('tick', (payload) => ticks.push(payload));
  runner.pause();
  return { runner, ticks };
}

describe('runner: manual stepping', () => {
  test('a multi-tick step emits one delta, not one per tick', () => {
    // Every emission builds a full snapshot and broadcasts to every client, so
    // a 200-tick step used to mean 200 snapshots and 200 deltas for a jump the
    // viewer experiences as a single move.
    const { runner, ticks } = pausedRunner();
    const startTick = runner.engine.tick;
    runner.stepManually(200);
    assert.equal(ticks.length, 1, 'one emission for the whole run');
    assert.equal(runner.engine.tick, startTick + 200, 'the engine still took every step');
    assert.equal(ticks[0].delta.baseTick, startTick);
    assert.equal(ticks[0].delta.tick, startTick + 200);
  });

  test('single steps still emit one delta each', () => {
    const { runner, ticks } = pausedRunner();
    runner.stepManually();
    runner.stepManually(1);
    assert.equal(ticks.length, 2);
    assert.equal(ticks[1].delta.baseTick, ticks[0].delta.tick, 'deltas chain without a gap');
  });

  test('a step of zero or less does nothing at all', () => {
    const { runner, ticks } = pausedRunner();
    const startTick = runner.engine.tick;
    runner.stepManually(0);
    assert.equal(ticks.length, 0);
    assert.equal(runner.engine.tick, startTick);
  });

  test('coalescing changes reporting, never the simulation', () => {
    // The engine takes the same steps in the same order either way, so the two
    // runs must end byte-identical. This is the guard that C4 stayed a
    // *transport* optimization and never became a simulation change.
    const coalesced = pausedRunner(7);
    coalesced.runner.stepManually(120);

    const perTick = pausedRunner(7);
    for (let i = 0; i < 120; i += 1) perTick.runner.stepManually(1);

    assert.equal(coalesced.runner.engine.tick, perTick.runner.engine.tick);
    assert.deepEqual(
      coalesced.runner.getFullSnapshot().entities,
      perTick.runner.getFullSnapshot().entities,
      'the world is identical whichever way it was stepped',
    );
  });

  test('a coalesced delta applies cleanly to a client at the base tick', () => {
    // A delta is a diff between two snapshots rather than a replay, so an
    // animal born and eaten inside the window is simply absent from both ends.
    // Applying the coalesced delta must land on exactly the same world as the
    // snapshot taken after the run.
    const { runner, ticks } = pausedRunner(3);
    const before = runner.getFullSnapshot();
    runner.stepManually(150);
    const applied = applyDeltaSnapshot(before, ticks[0].delta);
    const authoritative = runner.getFullSnapshot();
    assert.equal(applied.tick, authoritative.tick);
    assert.deepEqual(
      [...applied.entities].sort((a, b) => a.id - b.id),
      [...authoritative.entities].sort((a, b) => a.id - b.id),
      'applying the delta reproduces the authoritative world',
    );
  });

  test('stepping is refused while the simulation is running', () => {
    // Unchanged by C4, and the reason the renderer auto-pauses first (C3).
    const runner = new SimulationRunner({ engine: createDemoSimulation({ seed: 1 }) });
    runner.start();
    const result = runner.handleCommand({ type: 'simulation.step', ticks: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'simulation-running');
    runner.stop();
  });

  test('status reports the run state a client steers by', () => {
    // C1 replaces the renderer's locally-guessed paused flag with this.
    const runner = new SimulationRunner({ engine: createDemoSimulation({ seed: 1 }) });
    assert.equal(runner.getStatus().paused, false);
    runner.pause();
    assert.equal(runner.getStatus().paused, true);
    runner.handleCommand({ type: 'simulation.setSpeed', multiplier: 4 });
    assert.equal(runner.getStatus().speed, 4);
    runner.handleCommand({ type: 'simulation.resume' });
    assert.equal(runner.getStatus().paused, false);
    runner.stop();
  });
});
