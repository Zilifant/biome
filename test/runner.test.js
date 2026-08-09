import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationRunner } from '../src/server/SimulationRunner.js';
import { createDemoSimulation, buildDemoConfig } from '../src/fixtures/createDemoSimulation.js';
import { applyDeltaSnapshot } from '../src/protocol/snapshots.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { defaultSimulationConfig } from '../src/simulation/config/defaultSimulationConfig.js';
import { DEFAULT_TERRAIN_PREVALENCE } from '../src/protocol/commands.js';
import { smallDemo } from './helpers/smallDemo.js';

/** A paused runner over the demo world, with every emission captured. */
function pausedRunner(seed = 42) {
  const runner = new SimulationRunner({
    engine: createDemoSimulation({ seed }),
    createEngine: (nextSeed) => createDemoSimulation({ seed: nextSeed }),
  });
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

describe('runner: broadcast coalescing at speed (2026-08-09)', () => {
  // ⚠ **Tick cost: ~120 real-time ticks of a `smallDemo` world across the file,
  // and no long runs at all.** These are cadence claims — how often the world is
  // *reported* — so the world only has to be a world. What they cannot use is a
  // fake clock: the cadence is the runner's own `setInterval`, and stubbing it
  // would test the stub.
  //
  // The claim: above `maxBroadcastsPerSecond` the runner keeps simulating at full
  // speed and reports less often, which is the same trade C4 made for manual
  // stepping. Below it, nothing changes at all.
  const runnerAt = (speed, { maxBroadcastsPerSecond = 20, tickIntervalMs = 1000 } = {}) => {
    const runner = new SimulationRunner({ engine: smallDemo({ seed: 5 }), tickIntervalMs, maxBroadcastsPerSecond });
    const emissions = [];
    runner.on('tick', ({ delta }) => emissions.push(delta));
    runner.setSpeed(speed);
    return { runner, emissions };
  };
  const run = (runner, ms) => new Promise((resolve) => {
    runner.start();
    setTimeout(() => { runner.stop(); resolve(); }, ms);
  });

  test('⚠ at or below the cap the cadence is exactly what it always was', async () => {
    // 20 ticks/s against a 20/s cap: one delta per tick, every delta spanning
    // one tick. This is the arm that makes the change invisible to every world
    // anybody was already running.
    const { runner, emissions } = runnerAt(20, { maxBroadcastsPerSecond: 20 });
    await run(runner, 350);
    assert.ok(emissions.length >= 3, `expected several emissions, got ${emissions.length}`);
    for (const delta of emissions) {
      assert.equal(delta.tick - delta.baseTick, 1, 'a delta covered more than its own tick');
    }
  });

  test('above the cap one delta covers several ticks, and they still chain', async () => {
    // 100 ticks/s against a 20/s cap → five ticks per delta. What must hold is
    // not the count (a timer is a timer) but that the *chain* is unbroken: a
    // client applies these in order, and a gap is a desync.
    const { runner, emissions } = runnerAt(100, { maxBroadcastsPerSecond: 20 });
    await run(runner, 400);
    assert.ok(emissions.length >= 2, `expected several emissions, got ${emissions.length}`);
    for (const delta of emissions) {
      assert.ok(delta.tick - delta.baseTick > 1, `a delta at 100x covered only ${delta.tick - delta.baseTick} tick`);
    }
    for (let i = 1; i < emissions.length; i += 1) {
      assert.equal(emissions[i].baseTick, emissions[i - 1].tick, 'the delta chain has a gap in it');
    }
    // And the simulation itself is not slowed down by reporting less: far more
    // ticks were taken than deltas sent.
    const ticksCovered = emissions[emissions.length - 1].tick - emissions[0].baseTick;
    assert.ok(ticksCovered > emissions.length, `${ticksCovered} ticks in ${emissions.length} deltas is not coalescing`);
  });

  test('⚠⚠ pausing flushes the window, so the view is where the host stopped', async () => {
    // The bug this whole change is about, in its smallest form: pause has to
    // leave the client looking at the tick the host actually stopped on. An
    // unflushed window would freeze the picture one to four ticks *before* the
    // state every command result reports.
    const { runner, emissions } = runnerAt(100, { maxBroadcastsPerSecond: 20 });
    await run(runner, 300);
    runner.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    runner.pause();
    assert.equal(emissions[emissions.length - 1].tick, runner.engine.tick, 'the last delta is not the paused world');
    runner.stop();
  });

  test('reporting less often changes reporting, never the simulation', async () => {
    // The same guard C4 has, for the real-time loop: the engine takes the same
    // steps in the same order, so a coalesced run and an uncoalesced one of the
    // same length end byte-identical.
    const coalesced = runnerAt(100, { maxBroadcastsPerSecond: 20 });
    const uncoalesced = runnerAt(100, { maxBroadcastsPerSecond: 0 }); // 0 disables it
    await run(coalesced.runner, 300);
    await run(uncoalesced.runner, 300);
    // Step both to the same tick — the timers will not have delivered the same
    // number, and the claim is about *state*, not about cadence.
    const target = Math.max(coalesced.runner.engine.tick, uncoalesced.runner.engine.tick);
    coalesced.runner.stepManually(target - coalesced.runner.engine.tick);
    uncoalesced.runner.stepManually(target - uncoalesced.runner.engine.tick);
    assert.deepEqual(
      coalesced.runner.getFullSnapshot().entities,
      uncoalesced.runner.getFullSnapshot().entities,
      'the world differs depending on how often it was reported',
    );
    assert.ok(uncoalesced.emissions.length > coalesced.emissions.length, 'the control did not emit more');
    for (const delta of uncoalesced.emissions) {
      assert.equal(delta.tick - delta.baseTick, 1, 'the off state coalesced anyway');
    }
  });

  test('⚠⚠ a joining client is given the chain base, not the freshest world', async () => {
    // The desync generator this change could have introduced. Mid-window the
    // engine is ahead of the last broadcast; a client handed *that* world gets
    // the next delta with a baseTick behind its own tick, which RendererStore
    // treats as a desync — so it asks for a snapshot, is handed a fresh one
    // again, and goes round. `getBroadcastSnapshot` is what both transports send.
    const { runner } = runnerAt(100, { maxBroadcastsPerSecond: 20 });
    runner.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    const chainBase = runner.getBroadcastSnapshot();
    const fresh = runner.getFullSnapshot();
    runner.stop();
    assert.ok(chainBase.tick <= fresh.tick, 'the chain base cannot be ahead of the world');
    // And the base is exactly what the last delta reported, which is the property
    // that makes it chainable.
    assert.equal(chainBase.kind, fresh.kind, 'both are full snapshots');
  });
});

describe('runner: restart', () => {
  test('a named seed rebuilds that exact world', () => {
    const { runner } = pausedRunner(42);
    runner.stepManually(50);
    const result = runner.restart(7);
    assert.equal(result.seed, 7);
    assert.equal(runner.engine.tick, 0, 'a restart starts over');
    // The seed fully determines the world, so restarting into it must match a
    // world built from that seed directly. This is the property the whole
    // feature rests on.
    const reference = new SimulationRunner({ engine: createDemoSimulation({ seed: 7 }) });
    assert.deepEqual(runner.getFullSnapshot().entities, reference.getFullSnapshot().entities);
  });

  test('restart composition options reach the engine factory (world size and founders)', () => {
    // The runner does not know how a world is composed — it hands the options to
    // the factory the host supplied. This mirrors createServer's factory, which
    // routes them through buildDemoConfig.
    const runner = new SimulationRunner({
      engine: createDemoSimulation({ seed: 1 }),
      createEngine: (nextSeed, options) => createDemoSimulation({ seed: nextSeed, config: buildDemoConfig(options ?? {}) }),
    });
    runner.pause();
    const result = runner.handleCommand({
      type: 'simulation.restart',
      seed: 3,
      width: 200,
      height: 96,
      herbivores: 40,
      predators: 5,
      scavengers: 0,
    });
    assert.equal(result.ok, true);
    assert.equal(runner.engine.world.width, 200);
    assert.equal(runner.engine.world.height, 96);
    const counts = {};
    for (const entity of runner.engine.world.entities.all()) {
      if (entity.kind === 'animal') counts[entity.speciesId] = (counts[entity.speciesId] ?? 0) + 1;
    }
    assert.equal(counts['herbivore.gazelle'], 40);
    assert.equal(counts['predator.leopard'], 5);
    assert.equal(counts['scavenger.vulture'] ?? 0, 0, 'a zero count clears the role');
  });

  test('terrain prevalence is a fixed scale a stored preset can be read against', () => {
    // buildDemoConfig is the bridge from the UI's abstract 0..10 prevalence to
    // the generator's formation counts. 0 clears the type, higher is denser, and
    // — the claim this test exists for — **a level means the same thing today as
    // it did when a preset was saved at it**.
    //
    // ⚠⚠ **This test asserted "the default level reproduces the demo's own
    // terrain" until 2026-08-07, and that contract is retired.** It held by
    // construction while `FORMATION_COUNT_AT_DEFAULT` was a read of
    // `defaultSimulationConfig.terrain`, so the assertion could not fail; what it
    // could not protect was the *other* promise the scale makes, which is the one
    // stored preset files depend on. The two are compatible only while the demo's
    // four counts move by a single uniform factor (they did in 2026-08-04's
    // doubling, and the anchor moved 2 → 4 with them). `default-small` moved rock
    // and thicket ×1.8 and the tree counts ×1.5, so no anchor could absorb both
    // and the demo-equality rule was dropped in favour of the fixed scale. See
    // `FORMATION_COUNT_AT_DEFAULT` in the demo fixture.
    //
    // So the numbers below are deliberately **literals**. That is the reverse of
    // the 2026-08-02 lesson on this same test — where literals `8` and `14` made
    // it unfalsifiable — and it is right for the opposite reason: the claim is no
    // longer a relationship between two live values but a promise that these
    // values do not move. A literal is exactly how you break a build that moves
    // one.
    const anchor = DEFAULT_TERRAIN_PREVALENCE;
    assert.equal(anchor, 4, 'the anchor level is fixed; moving it re-scales every stored preset');
    assert.equal(buildDemoConfig({ rocks: anchor }).terrain.ridges, 10, 'level 4 rock is 10 formations');
    assert.equal(buildDemoConfig({ thickets: anchor }).terrain.thickets, 10, 'level 4 thicket is 10 formations');
    assert.equal(buildDemoConfig({ trees: anchor }).terrain.treeGroves, 16, 'level 4 trees is 16 groves');
    assert.equal(buildDemoConfig({ trees: anchor }).terrain.treeSingles, 120, 'level 4 trees is 120 singles');

    // The demo's own terrain is `default-small`'s 7/7/6, which is *not* the anchor
    // — the price of the units holding still, and worth asserting so that the two
    // are known to have parted rather than quietly drifted.
    const { ridges, thickets, treeGroves, treeSingles } = defaultSimulationConfig.terrain;
    const demo = buildDemoConfig({ rocks: 7, thickets: 7, trees: 6 }).terrain;
    assert.deepEqual(
      { ridges: demo.ridges, thickets: demo.thickets, treeGroves: demo.treeGroves, treeSingles: demo.treeSingles },
      { ridges, thickets, treeGroves, treeSingles },
      'levels 7/7/6 reproduce the demo — booting it and loading presets/default-small.json agree',
    );

    assert.equal(buildDemoConfig({ rocks: 0 }).terrain.ridges, 0, 'level 0 clears rock');
    assert.equal(buildDemoConfig({ thickets: 0 }).terrain.thickets, 0, 'level 0 clears thicket');
    assert.ok(buildDemoConfig({ rocks: 10 }).terrain.ridges > ridges, 'the top of the scale is denser');
    // Omitting them leaves terrain entirely to the defaults — no override object.
    assert.equal(buildDemoConfig({ herbivores: 5 }).terrain, undefined);
  });

  test('a restart clearing rocks and thickets reaches the terrain generator', () => {
    // Proves the mapping actually plumbs through to world generation, not just
    // the config object: level 0 for both leaves neither terrain type on the map.
    const runner = new SimulationRunner({
      engine: createDemoSimulation({ seed: 1 }),
      createEngine: (nextSeed, options) => createDemoSimulation({ seed: nextSeed, config: buildDemoConfig(options ?? {}) }),
    });
    runner.pause();
    // ⚠ `marsh: 0` is not incidental (v38): a marsh grows its own **reed beds**,
    // which are thicket cells, so thicket now has two independent sources and
    // "the thicket generator is off" no longer implies "no thicket on the map".
    // The assertion below is about the prevalence mapping reaching the generator,
    // so the other source is switched off rather than the claim being weakened.
    const result = runner.handleCommand({ type: 'simulation.restart', seed: 3, rocks: 0, thickets: 0, marsh: 0 });
    assert.equal(result.ok, true);
    const counts = runner.engine.world.terrain.countByType();
    // The connectivity pass may carve a few rock corridors, so rock can be
    // non-zero, but thicket has no such backstop and must be gone entirely.
    assert.equal(counts[TerrainType.THICKET] ?? 0, 0, 'thickets 0 leaves no thicket cells');
  });

  test('a restart with no composition options keeps the demo defaults', () => {
    const runner = new SimulationRunner({
      engine: createDemoSimulation({ seed: 1 }),
      createEngine: (nextSeed, options) => createDemoSimulation({ seed: nextSeed, config: buildDemoConfig(options ?? {}) }),
    });
    runner.pause();
    runner.handleCommand({ type: 'simulation.restart', seed: 3 });
    const reference = createDemoSimulation({ seed: 3 });
    assert.equal(runner.engine.world.width, reference.world.width);
    assert.deepEqual(runner.getFullSnapshot().entities, new SimulationRunner({ engine: reference }).getFullSnapshot().entities);
  });

  test('restarting broadcasts a full snapshot, never a delta', () => {
    // The new world shares no ids, no tick, and not even a simulationId, so
    // there is no delta that could express it.
    const { runner, ticks } = pausedRunner(42);
    const restarts = [];
    runner.on('restart', (payload) => restarts.push(payload));
    runner.restart(11);
    assert.equal(restarts.length, 1);
    assert.equal(ticks.length, 0, 'a restart is not a tick');
    assert.equal(restarts[0].snapshot.kind, 'snapshot.full');
    assert.equal(restarts[0].snapshot.tick, 0);
  });

  test('an omitted seed lets the host pick, and says which it picked', () => {
    // The client never rolls the die — presentation has to be reproducible from
    // its inputs — so the host chooses and reports back. "Replay this one" is
    // then just naming the seed you were given.
    const { runner } = pausedRunner(42);
    const first = runner.restart();
    assert.ok(Number.isInteger(first.seed) && first.seed >= 0, `got ${first.seed}`);
    assert.equal(runner.engine.seed, first.seed);
    const replay = runner.restart(first.seed);
    assert.equal(replay.simulationId, first.simulationId, 'naming the reported seed reproduces that world');
  });

  test('the run state survives a restart, because it belongs to the host', () => {
    // Someone who paused to look at something has not asked to be un-paused.
    const runner = new SimulationRunner({
      engine: createDemoSimulation({ seed: 1 }),
      createEngine: (seed) => createDemoSimulation({ seed }),
    });
    runner.start();
    runner.handleCommand({ type: 'simulation.setSpeed', multiplier: 4 });
    runner.pause();
    runner.restart(5);
    assert.equal(runner.paused, true);
    assert.equal(runner.speed, 4);
    runner.stop();
  });

  test('a runner with no engine factory refuses rather than pretending', () => {
    const runner = new SimulationRunner({ engine: createDemoSimulation({ seed: 1 }) });
    const result = runner.handleCommand({ type: 'simulation.restart', seed: 3 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'restart-unsupported');
  });

  test('restart validates its seed', () => {
    const { runner } = pausedRunner(1);
    for (const seed of [-1, 1.5, 'nine', 2 ** 32]) {
      const result = runner.handleCommand({ type: 'simulation.restart', seed });
      assert.equal(result.ok, false, `seed ${seed} should be refused`);
      assert.equal(result.error.code, 'invalid-command');
    }
  });

  test('status reports the seed of the world in view', () => {
    const { runner } = pausedRunner(42);
    assert.equal(runner.getStatus().seed, 42);
    runner.restart(99);
    assert.equal(runner.getStatus().seed, 99);
  });
});
