/**
 * Deterministic performance baseline for the simulation engine.
 *
 * Runs the demo world headless (no server, no renderer, no real-time pacing)
 * across several entity-count scenarios and reports wall-clock cost per tick.
 * This is the Step 1 baseline every later step compares against; it is NOT a
 * pass/fail CI gate (timing is machine-dependent — see BENCHMARK.md).
 *
 * Usage:
 *   npm run benchmark
 *   node src/scripts/benchmark.js --ticks=2000 --seed=42 --json
 *
 * Determinism note: it also verifies that two identical runs of the first
 * scenario produce byte-identical serialized state, so a benchmark run
 * doubles as a determinism smoke check.
 */
import { createDemoSimulation } from '../fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../simulation/persistence/SimulationSerializer.js';

/**
 * Scenarios scale the animal population and world size (vegetation is a
 * per-cell field, so world size drives its cost). The demo lifecycle starves
 * animals over time, so we record start and end entity counts and measure the
 * whole run's tick cost.
 * Predators scale with the herd (Step 16) at roughly the demo's ratio, so the
 * benchmark exercises a mixed population rather than a herbivore-only world.
 *
 * ⚠ **The lion and buffalo joined every scenario on 2026-07-30** (phase 11), at
 * the demo's own 120:35:8:8:10:6 ratio — which is **+30% animals** in every
 * scenario and, more to the point, animals that are 600 kg. Figures taken before
 * that date describe a different world twice over: a smaller one, and one whose
 * heaviest animal was 60 kg. large-5k was re-baselined with them.
 *
 * ⚠ **The hyena joined every scenario on 2026-07-29** (PLAN-SPECIES.md phase 7),
 * at the demo's own 120:8:10:6 ratio. Two consequences, both deliberate:
 * every scenario now carries ~4% more animals, so **figures taken before that
 * date are not comparable** and large-5k was re-baselined; and `GroupSystem`
 * finally does real work here — it early-outs when no species forms groups, so
 * until now the benchmark measured a world where the registry was free. A
 * roster that does not match the demo's is a benchmark that has stopped
 * describing it, which is why this list moves with every species batch.
 * @type {Array<{name: string, world: object, founding: Array<{speciesId: string, count: number}>}>}
 */
const SCENARIOS = [
  { name: 'demo-default', world: { width: 128, height: 128 }, founding: [
      { speciesId: 'herbivore.gazelle', count: 120 },
      { speciesId: 'herbivore.buffalo', count: 35 },
      { speciesId: 'predator.stalker', count: 8 },
      { speciesId: 'predator.lion', count: 8 },
      { speciesId: 'scavenger.vulture', count: 10 },
      { speciesId: 'scavenger.hyena', count: 6 },
    ] },
  { name: 'small-100', world: { width: 256, height: 256 }, founding: [
      { speciesId: 'herbivore.gazelle', count: 100 },
      { speciesId: 'herbivore.buffalo', count: 29 },
      { speciesId: 'predator.stalker', count: 7 },
      { speciesId: 'predator.lion', count: 7 },
      { speciesId: 'scavenger.vulture', count: 8 },
      { speciesId: 'scavenger.hyena', count: 5 },
    ] },
  { name: 'medium-1k', world: { width: 512, height: 512 }, founding: [
      { speciesId: 'herbivore.gazelle', count: 1000 },
      { speciesId: 'herbivore.buffalo', count: 292 },
      { speciesId: 'predator.stalker', count: 67 },
      { speciesId: 'predator.lion', count: 67 },
      { speciesId: 'scavenger.vulture', count: 80 },
      { speciesId: 'scavenger.hyena', count: 50 },
    ] },
  { name: 'large-5k', world: { width: 1024, height: 1024 }, founding: [
      { speciesId: 'herbivore.gazelle', count: 5000 },
      { speciesId: 'herbivore.buffalo', count: 1458 },
      { speciesId: 'predator.stalker', count: 333 },
      { speciesId: 'predator.lion', count: 333 },
      { speciesId: 'scavenger.vulture', count: 400 },
      { speciesId: 'scavenger.hyena', count: 250 },
    ] },
];

function parseArgs(argv) {
  const options = { ticks: 2000, seed: 42, json: false };
  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const match = /^--(ticks|seed)=(\d+)$/.exec(arg);
    if (!match) {
      console.error(`unknown argument: ${arg}`);
      console.error('usage: benchmark.js [--ticks=N] [--seed=N] [--json]');
      process.exit(1);
    }
    options[match[1]] = Number(match[2]);
  }
  return options;
}

/**
 * @param {{name: string, world: object, founding: Array<{speciesId: string, count: number}>}} scenario
 * @param {number} seed
 * @param {number} ticks
 */
function runScenario(scenario, seed, ticks) {
  const config = {
    world: scenario.world,
    demo: { founding: scenario.founding },
  };
  const engine = createDemoSimulation({ seed, config });
  const startEntities = engine.entityCount;

  // Warm up briefly so JIT steady-state, not first-call cost, dominates.
  const warmup = Math.min(50, ticks);
  engine.step(warmup);

  const measuredTicks = ticks - warmup;
  const startedAt = performance.now();
  engine.step(measuredTicks);
  const elapsedMs = performance.now() - startedAt;

  const msPerTick = elapsedMs / measuredTicks;
  return {
    scenario: scenario.name,
    world: `${scenario.world.width}x${scenario.world.height}`,
    startEntities,
    endEntities: engine.entityCount,
    measuredTicks,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    msPerTick: Number(msPerTick.toFixed(4)),
    ticksPerSec: Math.round(1000 / msPerTick),
  };
}

/** Two identical runs must serialize byte-for-byte identically. */
function verifyDeterminism(seed) {
  const a = createDemoSimulation({ seed });
  const b = createDemoSimulation({ seed });
  a.step(2000);
  b.step(2000);
  return JSON.stringify(captureSimulationState(a)) === JSON.stringify(captureSimulationState(b));
}

const { ticks, seed, json } = parseArgs(process.argv.slice(2));
const deterministic = verifyDeterminism(seed);
const results = SCENARIOS.map((scenario) => runScenario(scenario, seed, ticks));

const environment = {
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  seed,
  ticksPerScenario: ticks,
  deterministic,
};

if (json) {
  console.log(JSON.stringify({ environment, results }, null, 2));
} else {
  console.log(`biome benchmark — node ${environment.node} on ${environment.platform}`);
  console.log(`seed=${seed} ticks/scenario=${ticks} determinism(2000 ticks)=${deterministic ? 'OK' : 'FAILED'}`);
  console.log('');
  const header = ['scenario', 'world', 'start→end ent', 'ms/tick', 'ticks/sec'];
  console.log(header.map((h, i) => h.padEnd([16, 12, 16, 10, 10][i])).join(''));
  for (const r of results) {
    const row = [
      r.scenario.padEnd(16),
      r.world.padEnd(12),
      `${r.startEntities}→${r.endEntities}`.padEnd(16),
      String(r.msPerTick).padEnd(10),
      String(r.ticksPerSec).padEnd(10),
    ];
    console.log(row.join(''));
  }
}

if (!deterministic) {
  console.error('\nDETERMINISM CHECK FAILED — two identical seeded runs diverged.');
  process.exit(1);
}
