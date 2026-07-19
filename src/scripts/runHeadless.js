/**
 * Standalone headless run: advances the demo simulation as fast as possible,
 * with no server, no renderer, and no real-time pacing.
 *
 * Usage:
 *   npm run headless -- --ticks=5000 --seed=42 --report-every=500
 */
import { createDemoSimulation } from '../fixtures/createDemoSimulation.js';

function parseArgs(argv) {
  const options = { ticks: 1000, seed: 42, reportEvery: 100 };
  for (const arg of argv) {
    const match = /^--(ticks|seed|report-every)=(\d+)$/.exec(arg);
    if (!match) {
      console.error(`unknown argument: ${arg}`);
      console.error('usage: runHeadless.js [--ticks=N] [--seed=N] [--report-every=N]');
      process.exit(1);
    }
    const key = match[1] === 'report-every' ? 'reportEvery' : match[1];
    options[key] = Number(match[2]);
  }
  return options;
}

const { ticks, seed, reportEvery } = parseArgs(process.argv.slice(2));
const engine = createDemoSimulation({ seed });

console.log(`biome headless run — simulationId=${engine.simulationId} seed=${seed} ticks=${ticks}`);
console.log(`world ${engine.world.width}x${engine.world.height}, ${engine.entityCount} initial entities`);

const startedAt = performance.now();
let remaining = ticks;
while (remaining > 0) {
  const chunk = Math.min(remaining, reportEvery);
  engine.step(chunk);
  remaining -= chunk;
  console.log(`tick ${String(engine.tick).padStart(6)} | entities ${String(engine.entityCount).padStart(4)} | lastEventSeq ${engine.events.lastSeq}`);
}
const elapsedSeconds = (performance.now() - startedAt) / 1000;

const rate = elapsedSeconds > 0 ? Math.round(ticks / elapsedSeconds) : Infinity;
console.log(`done: ${ticks} ticks in ${elapsedSeconds.toFixed(3)}s (~${rate} ticks/sec)`);
console.log(`final: tick=${engine.tick} entities=${engine.entityCount} lastEventSeq=${engine.events.lastSeq}`);
