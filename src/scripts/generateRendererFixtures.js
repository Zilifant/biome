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
/**
 * ⚠ **Long enough that the world has a history, which is a correctness
 * requirement rather than a nicety.** It was 10 for a long time, and 10 ticks is
 * a world where nothing has happened yet: no lion is grown, so nothing has
 * marked any ground, so the **territory layer** (protocol v37) drew literally
 * nothing offline and the browser suite could not see it at all. The same
 * argument the 2026-08-04 regeneration made for keeping three vultures airborne
 * — a fixture that cannot show a feature cannot test one.
 *
 * At 2400 the demo has a lion pride holding ground, three leopards holding their
 * own, two hyena clans, fifty banded zebra and a handful of animals in the air.
 *
 * ⚠⚠ **It is not free, and the cost lands on the browser suite rather than on
 * disk.** The committed set is the same ~2 MB it always was (the event batch is
 * bounded below, and the snapshot barely moves) and the world is barely bigger —
 * 256 entities against 263. What a mature world has that a ten-tick one does not
 * is **1130 cells of worn ground** and a live disturbance, and rendering those
 * every frame is enough to tip `tests-ui`'s already-fragile browser teardown over
 * in a sandboxed shell. Measured 2026-08-08: `event-log-refs.spec.js` is green in
 * **546 ms** against the ten-tick fixtures and hangs for **three 30 s teardowns**
 * against these — never on an assertion, always on `Tearing down "live"`. The
 * suite's failure count in a sandbox went **9 → 14**, all of it that same hang
 * (DOCS §14 already records the hang as an environment limit, and the three real
 * assertion failures in `status-marks.spec.js` are unchanged). The trade was made
 * knowingly: a fixture that cannot show a feature cannot test one, and the
 * territory layer is invisible at ten ticks.
 */
const WARMUP_TICKS = 2400;

const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/fixtures');
mkdirSync(outputDir, { recursive: true });

/**
 * ⚠⚠ **The event types the renderer's log *drops*, and the reason this list is
 * duplicated here rather than imported.** `RendererStore` keeps `LASTING` events
 * and trims `PASSING` ones hard, so a delta made entirely of movement renders an
 * **empty** event log. This script is simulation-side and may not import from
 * `src/renderer` (`test/renderer-boundaries.test.js` guards the boundary in the
 * other direction, and reaching across it here would make the rule a matter of
 * taste), so the list is restated. Keep it in step with `EventCatalog.js` — the
 * guard below fails loudly if it drifts far enough to matter.
 */
const PASSING_EVENT_TYPES = new Set([
  'entity.moved',
  'entity.fed',
  'entity.provisioned',
  'entity.alarmed',
  'environment.feature',
]);

/**
 * How many log-worthy, entity-naming events the committed delta must carry.
 *
 * ⚠⚠ **This exists because the fixture went to zero and took four browser tests
 * with it** (2026-08-09). `WARMUP_TICKS` was picked for a world whose year was
 * 8000 ticks; when the year halved, tick 2400 landed somewhere else entirely and
 * the delta came out holding **one** keepable event — then, after a regeneration,
 * none. The browser suite reads the offline event log to find something to click
 * on, so an empty log is not a cosmetic fixture problem, it is four tests failing
 * on a selector with no hint of why.
 *
 * The fix is not a better constant. A fixed tick cannot promise anything about
 * what happened on it, so the tick is **searched for** instead: warm up, then walk
 * forward until a delta carries enough to fill a log. Deterministic (same seed,
 * same search) and self-describing — if the world ever stops producing such a
 * tick, this throws instead of quietly committing a fixture that cannot test what
 * it is for. The generator's own rule, one level up: *a fixture that cannot show a
 * feature cannot test one.*
 */
const REQUIRED_LOG_EVENTS = 3;
const MAX_SEARCH_TICKS = 600;

const engine = createDemoSimulation({ seed: FIXTURE_SEED });
engine.step(WARMUP_TICKS);

const keepableIn = (events) =>
  events.filter((event) => !PASSING_EVENT_TYPES.has(event.type) && event.entityId !== undefined).length;

let fullSnapshot = buildFullSnapshot(engine.getSnapshotData());
let nextSnapshot;
let delta;
let searched = 0;
for (;;) {
  engine.step(1);
  nextSnapshot = buildFullSnapshot(engine.getSnapshotData());
  delta = buildDeltaSnapshot(fullSnapshot, nextSnapshot, engine.eventsSince(fullSnapshot.lastEventSeq));
  if (keepableIn(delta.events) >= REQUIRED_LOG_EVENTS) break;
  searched += 1;
  if (searched > MAX_SEARCH_TICKS) {
    throw new Error(
      `no tick in ${WARMUP_TICKS}..${WARMUP_TICKS + MAX_SEARCH_TICKS} produced a delta with ` +
        `${REQUIRED_LOG_EVENTS} log-worthy entity events — the offline event log would be empty, ` +
        'and the browser suite reads it to find something to click on',
    );
  }
  fullSnapshot = nextSnapshot; // walk the base forward with the search
}
console.log(
  `fixture delta at tick ${delta.tick} (warm-up ${WARMUP_TICKS} + ${searched}): ` +
    `${keepableIn(delta.events)} log-worthy events of ${delta.events.length}`,
);

/**
 * ⚠ **The most recent events, not every event the bus still holds.** With a
 * ten-tick warm-up those two were the same thing; at 2400 they are 7300 events
 * and 2 MB of committed JSON, which grows with the warm-up forever and is not
 * what the fixture is *for* — the offline log needs enough history to scroll and
 * filter, and the store bounds its own buffer anyway (`RendererStore`, per
 * tier). The tail is the useful end: it is the one that describes the world the
 * snapshot beside it actually shows.
 */
const RECENT_EVENTS = 2500;
const history = engine.eventsSince(0);
const eventBatch = buildEventBatch(history.slice(-RECENT_EVENTS), {
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
