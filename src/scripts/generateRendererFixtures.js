/**
 * Regenerates the committed renderer-development fixtures in
 * src/renderer/fixtures/ from a fixed seed. Run via:
 *   npm run fixtures:renderer
 *
 * The fixtures let a renderer be developed entirely offline: a full
 * snapshot, the delta produced by the following tick, and the domain-event
 * history of the run so far.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoSimulation } from '../fixtures/createDemoSimulation.js';
import { buildFullSnapshot, buildDeltaSnapshot } from '../protocol/snapshots.js';
import { buildEventBatch } from '../protocol/events.js';

const FIXTURE_SEED = 42;
const WARMUP_TICKS = 10;

const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/fixtures');
mkdirSync(outputDir, { recursive: true });

const engine = createDemoSimulation({ seed: FIXTURE_SEED });
engine.step(WARMUP_TICKS);

const fullSnapshot = buildFullSnapshot(engine.getSnapshotData());

engine.step(1);
const nextSnapshot = buildFullSnapshot(engine.getSnapshotData());
const delta = buildDeltaSnapshot(fullSnapshot, nextSnapshot, engine.eventsSince(fullSnapshot.lastEventSeq));

const eventBatch = buildEventBatch(engine.eventsSince(0), {
  simulationId: engine.simulationId,
  tick: engine.tick,
});

const files = [
  ['example-full-snapshot.json', fullSnapshot],
  ['example-delta.json', delta],
  ['example-events.json', eventBatch],
];
for (const [name, data] of files) {
  const filePath = path.join(outputDir, name);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${filePath}`);
}
