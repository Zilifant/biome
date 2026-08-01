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
 * ⚠ **`prefix` is one character, and no two entries share one.** It is the mark
 * the event log puts at the head of every line, and it is the only part of a
 * line that is scannable at a glance in a column of a hundred — so a prefix that
 * is two characters wide (`!!`, `++`, `::`) buys nothing and costs the
 * alignment, and a prefix shared by two event types (an injury and an alarm
 * both `!`, a birth and a recovery both `+`) makes the mark meaningless where it
 * matters most. `renderer-view.test.js` enforces both halves: one character, and
 * unique across the catalog.
 *
 * Mnemonic where a character allows it — `*` a new life, `x` a death, `X` a
 * death with an author, `%` the carcass glyph, `@` a new address, `>` a pursuit,
 * `/` a break away, `!` a wound, `?` a question asked, `&` two joined, `{`/`}` a
 * clan forming and dissolving, `#` ground gone dense with fire or flood, `.` the
 * faintest mark in the set for the most frequent event there is. The catch-all
 * takes the backtick: the one mark that says this build has no name for what it
 * is showing.
 *
 * ⚠ These marks are a **separate namespace from the grid's glyphs** and do not
 * track them. `:` was picked when it was the trail glyph and stayed put when the
 * trail became `.`; chasing the grid would mean renumbering the whole set every
 * time a glyph is retuned, for a mnemonic nobody reads twice.
 *
 * @type {ReadonlyArray<{type: string, label: string, group: string, hint: string, prefix: string, retention: string}>}
 */
export const EVENT_CATALOG = Object.freeze(
  [
    // ---- life and death ----
    { type: 'entity.born', label: 'births', group: 'Life', hint: '', prefix: '*' },
    { type: 'entity.died', label: 'deaths', group: 'Life', hint: 'any cause', prefix: 'x' },
    { type: 'entity.lifeEvent', label: 'weaning, dispersal, orphaning', group: 'Life', hint: '', prefix: '|' },
    { type: 'entity.migrated', label: 'an animal moves house', group: 'Life', hint: '', prefix: '@' },
    { type: 'entity.created', label: 'entities appearing', group: 'Life', hint: 'plants regrowing too', prefix: '+' },
    { type: 'entity.removed', label: 'entities leaving the world', group: 'Life', hint: '', prefix: '-' },
    { type: 'entity.decayed', label: 'carcasses decaying', group: 'Life', hint: '', prefix: '%' },

    // ---- predation ----
    { type: 'entity.killed', label: 'kills', group: 'Predation', hint: '', prefix: 'X' },
    { type: 'entity.hunted', label: 'hunt attempts', group: 'Predation', hint: 'with the odds', prefix: '>' },
    { type: 'entity.escaped', label: 'escapes', group: 'Predation', hint: '', prefix: '/' },
    { type: 'entity.injured', label: 'injuries', group: 'Predation', hint: '', prefix: '!' },
    // ⚠ Not `+`: an injury healing and a birth are both good news and were both
    // `+`, which is exactly the collision the one-character rule exists to stop.
    { type: 'entity.recovered', label: 'injuries healing', group: 'Predation', hint: '', prefix: '_' },

    // ---- courtship ----
    { type: 'entity.courted', label: 'courtship', group: 'Courtship', hint: 'accepted and rejected', prefix: '?' },
    { type: 'entity.mated', label: 'matings', group: 'Courtship', hint: '', prefix: '&' },

    // ---- disease ----
    // A progression in weight: a carrier is a faint mark, symptoms are a heavier
    // one, and recovery lifts.
    { type: 'entity.infected', label: 'infections', group: 'Disease', hint: 'before any symptoms show', prefix: "'" },
    { type: 'entity.sickened', label: 'animals falling ill', group: 'Disease', hint: '', prefix: '"' },
    { type: 'entity.cured', label: 'animals recovering', group: 'Disease', hint: '', prefix: '^' },

    // ---- conflict and care ----
    // ⚠ Three contests, three labels, and they are not interchangeable. The
    // engine emits a separate type for each because dominance settles all three
    // but an observer cares which one they are watching — and a carcass fight
    // filed under "contests over a mate" would be the UI lying, which is the
    // thing protocol v29 exists to stop.
    { type: 'entity.contested', label: 'contests over a mate', group: 'Conflict', hint: '', prefix: '<' },
    { type: 'entity.disputed', label: 'disputes over ground', group: 'Conflict', hint: '', prefix: '[' },
    { type: 'entity.robbed', label: 'carcasses stolen', group: 'Conflict', hint: 'with both dominance scores', prefix: '$' },
    { type: 'entity.defended', label: 'an adult defending another', group: 'Conflict', hint: '', prefix: ')' },
    { type: 'entity.alarmed', label: 'alarm calls', group: 'Conflict', hint: '', prefix: '(', retention: PASSING },

    // ---- persistent groups ----
    // ⚠ Not herds. A herd is the positional `groupId` that rides in every
    // snapshot and needs no event because the state is always there; these are
    // the *records* — prides, clans, bands — which change rarely and whose
    // beginning and end are milestones worth keeping.
    { type: 'entity.grouped', label: 'joining a pride or clan', group: 'Conflict', hint: 'founding one too', prefix: '{' },
    { type: 'entity.ungrouped', label: 'leaving a pride or clan', group: 'Conflict', hint: 'and clans dissolving', prefix: '}' },

    // ---- the world ----
    { type: 'environment.changed', label: 'season and weather turning', group: 'World', hint: '', prefix: '~' },
    { type: 'environment.disturbed', label: 'fire / flood / storm starting', group: 'World', hint: '', prefix: '#' },
    { type: 'environment.settled', label: 'a disturbance ending', group: 'World', hint: '', prefix: ';' },
    { type: 'environment.feature', label: 'trails and burrows', group: 'World', hint: '', prefix: ':', retention: PASSING },

    // ---- the constant business of being alive ----
    // ⚠ `entity.moved` takes the faintest mark in the set on purpose: it is
    // 95% of everything the engine emits, and a loud prefix on it drowns the
    // milestones sharing the column.
    { type: 'entity.moved', label: 'movement', group: 'Routine', hint: '', prefix: '.', retention: PASSING },
    { type: 'entity.fed', label: 'feeding', group: 'Routine', hint: '', prefix: '=', retention: PASSING },
    { type: 'entity.provisioned', label: 'young being fed', group: 'Routine', hint: '', prefix: ',', retention: PASSING },

    // Not an event type: whatever a newer engine emits that this build cannot name.
    { type: OTHER_EVENTS, label: 'anything else', group: 'Routine', hint: 'events this build cannot name', prefix: '`' },
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
 * The one-character mark the log puts at the head of a line of this type.
 *
 * An unnamed type gets the catch-all's mark, for the same reason it gets the
 * catch-all's checkbox: a newer engine's event should read as "something this
 * build cannot name" rather than as nothing at all.
 * @param {string} type
 * @returns {string}
 */
export function prefixFor(type) {
  return (BY_TYPE.get(type) ?? BY_TYPE.get(OTHER_EVENTS)).prefix;
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
