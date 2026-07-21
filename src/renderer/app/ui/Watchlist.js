/**
 * Auto-pause: stop the simulation when something worth watching happens.
 *
 * A demo tick is a second long and most of what makes this world interesting —
 * a kill, a courtship, a birth, a fire starting — happens in one tick somewhere
 * you were not looking. Watching for it by eye means either staring at the event
 * log or missing it. So the renderer watches the event stream and pauses.
 *
 * This is **renderer policy over authoritative output**, not simulation logic:
 * the engine emits the same events it always did, and the renderer responds by
 * sending the ordinary `simulation.pause` command. Nothing new enters the
 * protocol and no ecological decision is made here.
 *
 * ⚠ It pauses *just after* the event, not at it. The event arrives with the
 * delta for a tick already applied, and the pause is a round trip on top of
 * that, so at 1x you stop on the next tick and at 16x you may overshoot several.
 * Pausing exactly at the event would mean a breakpoint inside the runner —
 * genuinely more precise, and a protocol change rather than a renderer feature.
 *
 * Pure: `matchWatched` decides, and the caller acts.
 *
 * Frequencies measured on the demo over ~480 ticks (2026-07-20), because "pause
 * on courtship" sounds rare and is not: courtship fired 79 times and migration
 * 44, against 4 kills, 1 birth, and 1 disturbance. The hints say so — a toggle
 * that stops the simulation every few ticks is a surprise worth spoiling.
 */

/**
 * What can be watched, in the order the toggles are shown. Grouped by what a
 * viewer would call the thing rather than by event type, so "predation" is one
 * checkbox covering the kill rather than three covering the pipeline.
 *
 * @type {ReadonlyArray<{id: string, label: string, types: string[], hint: string}>}
 */
export const WATCHABLE = Object.freeze([
  { id: 'predation', label: 'a kill', types: ['entity.killed'], hint: 'a hunt that succeeded' },
  { id: 'escape', label: 'an escape', types: ['entity.escaped'], hint: 'a hunt that failed' },
  { id: 'courtship', label: 'courtship', types: ['entity.courted'], hint: 'frequent — every few ticks' },
  { id: 'mating', label: 'mating', types: ['entity.mated'], hint: 'frequent' },
  { id: 'birth', label: 'a birth', types: ['entity.born'], hint: '' },
  { id: 'death', label: 'any death', types: ['entity.died'], hint: 'including old age and starvation' },
  { id: 'disturbance', label: 'fire / flood / storm', types: ['environment.disturbed'], hint: 'when one starts' },
  { id: 'disease', label: 'an animal sickens', types: ['entity.sickened'], hint: 'the carrier was infectious before this' },
  { id: 'conflict', label: 'a contest', types: ['entity.contested', 'entity.disputed'], hint: 'over a mate or over ground' },
  { id: 'injury', label: 'an injury', types: ['entity.injured'], hint: '' },
  { id: 'migration', label: 'an animal moves house', types: ['entity.migrated'], hint: 'frequent' },
  { id: 'season', label: 'season or weather turns', types: ['environment.changed'], hint: '' },
]);

/** Event type → the watchable id that covers it. */
const COVERED_BY = new Map(WATCHABLE.flatMap((entry) => entry.types.map((type) => [type, entry])));

/**
 * The first watched event in a batch, or null.
 *
 * First rather than "most interesting": a tick can carry a kill *and* the death
 * it caused, and picking between them would be inventing a hierarchy the engine
 * does not have. The events arrive in the order the engine emitted them, which
 * is the order they happened.
 *
 * @param {Array<{type: string, entityId?: number}>} events
 * @param {Set<string>} enabledIds watchable ids currently switched on
 * @returns {{event: object, watchable: {id: string, label: string}} | null}
 */
export function matchWatched(events, enabledIds) {
  if (!enabledIds || enabledIds.size === 0) return null;
  for (const event of events ?? []) {
    const watchable = COVERED_BY.get(event?.type);
    if (watchable && enabledIds.has(watchable.id)) return { event, watchable };
  }
  return null;
}

/** Watch selections a viewer has made, remembered across reloads. */
const WATCH_KEY = 'biome.controls.watch';

/** @returns {Set<string>} */
export function loadWatchlist() {
  try {
    const raw = globalThis.localStorage?.getItem(WATCH_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    // Drop ids this build no longer knows, so a renamed watchable degrades to
    // "not watched" rather than to a checkbox that can never be unticked.
    return new Set(ids.filter((id) => WATCHABLE.some((entry) => entry.id === id)));
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} ids */
export function saveWatchlist(ids) {
  try {
    globalThis.localStorage?.setItem(WATCH_KEY, JSON.stringify([...ids]));
  } catch {
    // Remembering is a convenience; failing to remember is not an error.
  }
}
