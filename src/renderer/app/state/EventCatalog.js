/**
 * The event vocabulary, in one place: every domain event type this renderer
 * knows, what to call it in the filter list, and how long it is worth keeping.
 *
 * Two consumers, one list. `EventLog` builds a checkbox per entry (so the
 * filter list cannot silently omit an event type the engine emits), and
 * `RendererStore` reads `retention` to decide which events survive in the
 * buffer and which are dropped within a few ticks.
 *
 * ⚠ Restated rather than imported. The renderer speaks the protocol as message
 * shapes and imports nothing from `src/protocol/` (§3), so this list is a copy
 * of `EventTypes` by hand — `renderer-view.test.js` imports both and fails if
 * the two ever disagree, which is what makes the copy safe.
 *
 * **Retention is a frequency judgement, not an importance one.** Measured over
 * 1000 demo ticks (seed 42, 128x128, 2026-07-24): 127 464 events, of which
 * `entity.moved` alone was 121 078 and the five `passing` types together were
 * 99.2%. The remaining 1043 — every birth, death, kill, courtship, outbreak and
 * storm in those thousand ticks — is about one event per tick, which is what
 * makes keeping them for tens of thousands of ticks affordable and keeping the
 * movement stream for even a hundred ticks not.
 */

/** Kept for as long as the buffer allows: rare, and each one is a milestone. */
export const LASTING = 'lasting';
/** Dropped within a few ticks: emitted per animal per tick, and the *state* it
 *  describes already rides in every snapshot. */
export const PASSING = 'passing';

/**
 * The catch-all filter id for event types this build has never heard of. Not a
 * real event type — the `*` cannot collide with one — so a newer engine's new
 * event is reachable through one checkbox instead of being invisible until the
 * renderer is taught about it.
 */
export const OTHER_EVENTS = '*other';

/**
 * Every filterable event, in the order the checkboxes are shown. Grouped by
 * what a viewer would call the subject rather than by emitting system.
 *
 * @type {ReadonlyArray<{type: string, label: string, group: string, hint: string, retention: string}>}
 */
export const EVENT_CATALOG = Object.freeze(
  [
    // ---- life and death ----
    { type: 'entity.born', label: 'births', group: 'Life', hint: '' },
    { type: 'entity.died', label: 'deaths', group: 'Life', hint: 'any cause' },
    { type: 'entity.lifeEvent', label: 'weaning, dispersal, orphaning', group: 'Life', hint: '' },
    { type: 'entity.migrated', label: 'an animal moves house', group: 'Life', hint: '' },
    { type: 'entity.created', label: 'entities appearing', group: 'Life', hint: 'plants regrowing too' },
    { type: 'entity.removed', label: 'entities leaving the world', group: 'Life', hint: '' },
    { type: 'entity.decayed', label: 'carcasses decaying', group: 'Life', hint: '' },

    // ---- predation ----
    { type: 'entity.killed', label: 'kills', group: 'Predation', hint: '' },
    { type: 'entity.hunted', label: 'hunt attempts', group: 'Predation', hint: 'with the odds' },
    { type: 'entity.escaped', label: 'escapes', group: 'Predation', hint: '' },
    { type: 'entity.injured', label: 'injuries', group: 'Predation', hint: '' },
    { type: 'entity.recovered', label: 'injuries healing', group: 'Predation', hint: '' },

    // ---- courtship ----
    { type: 'entity.courted', label: 'courtship', group: 'Courtship', hint: 'accepted and rejected' },
    { type: 'entity.mated', label: 'matings', group: 'Courtship', hint: '' },

    // ---- disease ----
    { type: 'entity.infected', label: 'infections', group: 'Disease', hint: 'before any symptoms show' },
    { type: 'entity.sickened', label: 'animals falling ill', group: 'Disease', hint: '' },
    { type: 'entity.cured', label: 'animals recovering', group: 'Disease', hint: '' },

    // ---- conflict and care ----
    // ⚠ Three contests, three labels, and they are not interchangeable. The
    // engine emits a separate type for each because dominance settles all three
    // but an observer cares which one they are watching — and a carcass fight
    // filed under "contests over a mate" would be the UI lying, which is the
    // thing protocol v29 exists to stop.
    { type: 'entity.contested', label: 'contests over a mate', group: 'Conflict', hint: '' },
    { type: 'entity.disputed', label: 'disputes over ground', group: 'Conflict', hint: '' },
    { type: 'entity.robbed', label: 'carcasses stolen', group: 'Conflict', hint: 'with both dominance scores' },
    { type: 'entity.defended', label: 'an adult defending another', group: 'Conflict', hint: '' },
    { type: 'entity.alarmed', label: 'alarm calls', group: 'Conflict', hint: '', retention: PASSING },

    // ---- persistent groups ----
    // ⚠ Not herds. A herd is the positional `groupId` that rides in every
    // snapshot and needs no event because the state is always there; these are
    // the *records* — prides, clans, bands — which change rarely and whose
    // beginning and end are milestones worth keeping.
    { type: 'entity.grouped', label: 'joining a pride or clan', group: 'Conflict', hint: 'founding one too' },
    { type: 'entity.ungrouped', label: 'leaving a pride or clan', group: 'Conflict', hint: 'and clans dissolving' },

    // ---- the world ----
    { type: 'environment.changed', label: 'season and weather turning', group: 'World', hint: '' },
    { type: 'environment.disturbed', label: 'fire / flood / storm starting', group: 'World', hint: '' },
    { type: 'environment.settled', label: 'a disturbance ending', group: 'World', hint: '' },
    { type: 'environment.feature', label: 'trails and burrows', group: 'World', hint: '', retention: PASSING },

    // ---- the constant business of being alive ----
    { type: 'entity.moved', label: 'movement', group: 'Routine', hint: '', retention: PASSING },
    { type: 'entity.fed', label: 'feeding', group: 'Routine', hint: '', retention: PASSING },
    { type: 'entity.provisioned', label: 'young being fed', group: 'Routine', hint: '', retention: PASSING },

    // Not an event type: whatever a newer engine emits that this build cannot name.
    { type: OTHER_EVENTS, label: 'anything else', group: 'Routine', hint: 'events this build cannot name' },
  ].map((entry) => Object.freeze({ retention: LASTING, ...entry })),
);

/** type → catalog entry, for the O(1) lookups the log and the store both make. */
const BY_TYPE = new Map(EVENT_CATALOG.map((entry) => [entry.type, entry]));

/**
 * Whether an event is worth keeping for the long haul.
 *
 * An unrecognized type counts as lasting: it is presumed rare (nothing this
 * frequent exists that the renderer has not been taught about), and both tiers
 * are capped regardless, so guessing wrong costs older milestones rather than
 * unbounded memory.
 * @param {string} type
 * @returns {boolean}
 */
export function isLastingEvent(type) {
  return (BY_TYPE.get(type)?.retention ?? LASTING) === LASTING;
}

/**
 * The filter id covering an event type — itself when the catalog names it, and
 * the catch-all otherwise.
 * @param {string} type
 * @returns {string}
 */
export function filterIdFor(type) {
  return BY_TYPE.has(type) ? type : OTHER_EVENTS;
}

/**
 * What the log shows before anyone touches the filters. Births and deaths: the
 * two events that describe the population changing, and the ones a viewer
 * watching a world wants to be told about without asking.
 */
export const DEFAULT_EVENT_FILTER = Object.freeze(['entity.born', 'entity.died']);

/** Filter selections a viewer has made, remembered across reloads. */
const FILTER_KEY = 'biome.eventLog.types';

/**
 * The remembered filter, or the default when nothing has been remembered.
 *
 * ⚠ An empty *stored* set is a real answer ("show me nothing"), so it is
 * honoured; only an absent or unreadable one falls back to the default. Ids the
 * catalog no longer knows are dropped, so a renamed event degrades to unchecked
 * rather than to a checkbox that cannot exist.
 * @returns {Set<string>}
 */
export function loadEventFilter() {
  try {
    const raw = globalThis.localStorage?.getItem(FILTER_KEY);
    if (raw == null) return new Set(DEFAULT_EVENT_FILTER);
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return new Set(DEFAULT_EVENT_FILTER);
    return new Set(ids.filter((id) => BY_TYPE.has(id)));
  } catch {
    return new Set(DEFAULT_EVENT_FILTER);
  }
}

/** @param {Set<string>} ids */
export function saveEventFilter(ids) {
  try {
    globalThis.localStorage?.setItem(FILTER_KEY, JSON.stringify([...ids]));
  } catch {
    // Remembering is a convenience; failing to remember is not an error.
  }
}
