import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationRunner } from '../src/server/SimulationRunner.js';
import { createDemoSimulation, buildDemoConfig } from '../src/fixtures/createDemoSimulation.js';
import { applyDeltaSnapshot } from '../src/protocol/snapshots.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { defaultSimulationConfig } from '../src/simulation/config/defaultSimulationConfig.js';
import { DEFAULT_TERRAIN_PREVALENCE } from '../src/protocol/commands.js';

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

  test('terrain prevalence maps to formation counts, the default level being the demo', () => {
    // buildDemoConfig is the bridge from the UI's abstract 0..10 prevalence to
    // the generator's formation counts. Level 2 (the demo's default) reproduces
    // the demo's own terrain, 0 clears the type, and higher is denser.
    //
    // ⚠ Asserted against the config, not against literals. This read
    // `.ridges, 8` and `.thickets, 14` until 2026-08-02, which could not fail
    // the way the test name claims: retuning the demo's terrain broke the
    // "level N == the demo" contract while leaving 8 === 8 true, so the test
    // went on passing. The relationship is the claim, so the relationship is
    // what gets compared.
    // ⚠ The **level** was a literal `2` for the same reason until 2026-08-04,
    // when the anchor moved to 4 with the ngorongoro demo — so it too now comes
    // from its one home rather than from a number that used to be right.
    const { ridges, thickets } = defaultSimulationConfig.terrain;
    const demoLevel = DEFAULT_TERRAIN_PREVALENCE;
    assert.equal(buildDemoConfig({ rocks: demoLevel }).terrain.ridges, ridges, 'the default level of rock == demo default');
    assert.equal(
      buildDemoConfig({ thickets: demoLevel }).terrain.thickets,
      thickets,
      'the default level of thicket == demo default',
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
    const result = runner.handleCommand({ type: 'simulation.restart', seed: 3, rocks: 0, thickets: 0 });
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
