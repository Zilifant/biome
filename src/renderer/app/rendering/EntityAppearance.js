/**
 * Renderer-owned ASCII appearance registry.
 *
 * Glyphs and colors exist ONLY here — the simulation and protocol know
 * nothing about presentation. Colors are expressed as Dracula theme tokens
 * (resolved to CSS custom properties by the canvas renderer, with the exact
 * hex fallbacks below for tests and non-DOM use). Strict ASCII only.
 *
 * To add a species: add one entry to SPECIES_APPEARANCE. Nothing in the
 * grid-rendering algorithm changes.
 */

/** Exact Dracula Classic values, keyed by token. Token → CSS var is `--dracula-<token>`. */
export const DRACULA_COLORS = Object.freeze({
  'background': '#282A36',
  'current-line': '#6272A4',
  'selection': '#44475A',
  'foreground': '#F8F8F2',
  'comment': '#6272A4',
  'red': '#FF5555',
  'orange': '#FFB86C',
  'yellow': '#F1FA8C',
  'green': '#50FA7B',
  'cyan': '#8BE9FD',
  'purple': '#BD93F9',
  'pink': '#FF79C6',
  'background-lighter': '#424450',
  'background-light': '#343746',
  'background-dark': '#21222C',
  'background-darker': '#191A21',
  'bright-red': '#FF6E6E',
  'bright-green': '#69FF94',
  'bright-yellow': '#FFFFA5',
  'bright-purple': '#D6ACFF',
  'bright-pink': '#FF92DF',
  'bright-cyan': '#A4FFFF',
  'bright-white': '#FFFFFF',
});

/**
 * @typedef {object} Appearance
 * @property {string} glyph single ASCII character (see resolveAppearance for the
 *        life-stage case transform)
 * @property {boolean} [italic] true when the glyph is drawn in italic (female)
 * @property {string} colorToken key into DRACULA_COLORS
 * @property {number} priority higher wins when a cell has multiple occupants
 * @property {string} label human-readable category for the inspector
 */

/**
 * Life stages the engine reports (see AgingSystem: juvenile, subadult, adult,
 * senescent). "Mature" folds the two grown stages together — an animal that has
 * finished growing, whether or not it has aged past its prime. It is what letter
 * case encodes on the grid (see resolveAppearance).
 */
const MATURE_STAGES = Object.freeze(new Set(['adult', 'senescent']));

/**
 * Whether a life stage is drawn UPPERCASE (a grown animal) rather than lowercase.
 * An unknown or absent stage reads as not-yet-grown, so a newer engine's stage
 * name simply draws lowercase rather than throwing.
 * @param {string | undefined | null} lifeStage
 * @returns {boolean}
 */
export function isMatureStage(lifeStage) {
  return MATURE_STAGES.has(lifeStage);
}

/** Defaults by protocol `kind`. */
export const KIND_APPEARANCE = Object.freeze({
  animal: Object.freeze({ glyph: 'a', colorToken: 'yellow', priority: 50, label: 'animal' }),
  plant: Object.freeze({ glyph: '"', colorToken: 'green', priority: 20, label: 'plant' }),
});

/**
 * Species-specific overrides (renderer-only knowledge). Keyed by the protocol
 * `speciesId`; add an entry to give a species its own glyph/color without
 * touching the grid-rendering algorithm.
 *
 * **The whole African roster has an entry, not only the species that exist.**
 * That is deliberate (PLAN-SPECIES §7, phase 6): a species batch is meant to be
 * a *config* change, and a species the engine can found but the renderer draws
 * as a bare `a` would make every batch a renderer change too. The scheme is
 * assigned once, here, so it can be assigned *coherently* — glyph by common
 * name, colour by trophic family, priority in bands — rather than one letter at
 * a time against whatever is left.
 *
 * ⚠ Terrain already owns `cyan` (water), `green` (thicket), `comment` (cover),
 * and `background-lighter` (rock), which is why the rhino and elephant take
 * `bright-*` variants rather than the obvious grey and blue.
 *
 * Priority bands: carnivores 60+ (a hunt reads as the hunter's glyph rather
 * than disappearing behind the animal it is standing on), herbivores 50–55,
 * obligate scavenger 45 — *below* prey, because a bird on a carcass should not
 * hide the more informative glyph of the two.
 */
export const SPECIES_APPEARANCE = Object.freeze({
  // ---- shipped today ----
  // ⚠ `supersededBy` names the roster entry a shipped species is renamed into,
  // so the pairing is mechanical rather than folklore — it is what lets two
  // species share a glyph without that being a collision, and
  // `renderer-view.test.js` checks both halves. **The entry is deleted in the
  // phase that does the rename**: the grazer's and corvid's went at phase 7
  // (2026-07-29) when they became the gazelle and the vulture, and the
  // stalker's goes at phase 14 when it becomes the leopard.
  'predator.stalker': Object.freeze({
    glyph: 's',
    colorToken: 'red',
    priority: 60,
    label: 'stalker',
    supersededBy: 'predator.leopard',
  }),

  // ---- the roster (PLAN-SPECIES §7) ----
  // ⚠ The gazelle keeps the grazer's `g`/`yellow`/50 exactly, so batch 1 is
  // indistinguishable on screen from today's demo except for the carnivore that
  // arrives with it — which is what makes a visual regression obvious.
  'herbivore.gazelle': Object.freeze({
    glyph: 'g',
    colorToken: 'yellow',
    priority: 50,
    label: 'gazelle',
  }),
  'herbivore.wildebeest': Object.freeze({
    glyph: 'w',
    colorToken: 'bright-yellow',
    priority: 51,
    label: 'wildebeest',
  }),
  'herbivore.zebra': Object.freeze({
    glyph: 'z',
    colorToken: 'foreground',
    priority: 52,
    label: 'zebra',
  }),
  'herbivore.buffalo': Object.freeze({
    glyph: 'b',
    colorToken: 'orange',
    priority: 53,
    label: 'buffalo',
  }),
  'herbivore.rhino': Object.freeze({
    glyph: 'r',
    colorToken: 'bright-cyan',
    priority: 54,
    label: 'rhino',
  }),
  'herbivore.elephant': Object.freeze({
    glyph: 'e',
    colorToken: 'bright-purple',
    priority: 55,
    label: 'elephant',
  }),
  // `l` goes to the lion, so the leopard takes `p` for *panther*.
  'predator.leopard': Object.freeze({
    glyph: 'p',
    colorToken: 'bright-red',
    priority: 60,
    label: 'leopard',
  }),
  // Between the two cats, as in life: a clan displaces a leopard from a kill
  // and yields to a pride.
  'scavenger.hyena': Object.freeze({
    glyph: 'h',
    colorToken: 'pink',
    priority: 61,
    label: 'hyena',
  }),
  'predator.lion': Object.freeze({
    glyph: 'l',
    colorToken: 'red',
    priority: 62,
    label: 'lion',
  }),
  // Keeps the corvid's glyph and rank — the obligate-scavenger niche is
  // unchanged by the rename, and so is what it looks like on the grid.
  'scavenger.vulture': Object.freeze({
    glyph: 'v',
    colorToken: 'purple',
    priority: 45,
    label: 'vulture',
  }),
});

/**
 * What to call a species in the UI.
 *
 * ⚠ **The engine never sends a label**, and that is deliberate rather than an
 * omission: species definitions hold biology, and a display name is
 * presentation, which lives here (DOCS §19). But from protocol v29 the host
 * publishes its *roster*, so the renderer can be handed an id it has no
 * appearance entry for — a species added to the engine before anyone got round
 * to giving it a glyph. Falling back to the id's last segment means such a
 * species is still nameable, still controllable, and visibly unstyled rather
 * than invisible.
 *
 * @param {string} speciesId
 * @returns {string}
 */
export function speciesLabel(speciesId) {
  const known = SPECIES_APPEARANCE[speciesId]?.label;
  if (known) return known;
  const tail = String(speciesId ?? '').split('.').pop();
  return tail || String(speciesId ?? '');
}

/**
 * Dead animals render as carcasses, and a carcass visibly rots (protocol v17).
 * The ramp is indexed by the `decayStage` the snapshot carries: a fresh body is
 * a bold `%`, and by the time it is bare remains it is a faint `.` — so a
 * scavenger's route between fading marks reads at a glance.
 */
export const CARCASS_DECAY_APPEARANCE = Object.freeze([
  Object.freeze({ glyph: '%', colorToken: 'orange', priority: 40, label: 'carcass (fresh)' }),
  Object.freeze({ glyph: '%', colorToken: 'red', priority: 40, label: 'carcass (ripe)' }),
  Object.freeze({ glyph: ';', colorToken: 'comment', priority: 40, label: 'carcass (dry)' }),
  Object.freeze({ glyph: '.', colorToken: 'comment', priority: 40, label: 'remains' }),
]);

/** Fresh carcass; the default when no decay stage is known. */
export const CARCASS_APPEARANCE = CARCASS_DECAY_APPEARANCE[0];

/** Anything the renderer does not recognize. */
export const UNKNOWN_APPEARANCE = Object.freeze({ glyph: '?', colorToken: 'purple', priority: 30, label: 'unknown' });

/**
 * Terrain appearance, keyed by the protocol legend's renderer-neutral cell
 * name. Codes and passability are authoritative (from the snapshot legend);
 * glyph and color are renderer-owned. `outOfBounds` covers cells beyond the
 * world edge; `unknown` covers any legend name this renderer doesn't map yet.
 */
export const TERRAIN_APPEARANCE = Object.freeze({
  ground: Object.freeze({ glyph: '.', colorToken: 'selection' }),
  water: Object.freeze({ glyph: '~', colorToken: 'cyan' }),
  rock: Object.freeze({ glyph: '#', colorToken: 'background-lighter' }),
  cover: Object.freeze({ glyph: ',', colorToken: 'comment' }),
  deep_water: Object.freeze({ glyph: '≈', colorToken: 'cyan' }),
  thicket: Object.freeze({ glyph: '♣', colorToken: 'green' }),
  outOfBounds: Object.freeze({ glyph: '#', colorToken: 'background-lighter' }),
  unknown: Object.freeze({ glyph: '.', colorToken: 'selection' }),
});

/**
 * Appearance for a terrain cell name from the snapshot legend.
 * @param {string} name
 * @returns {{glyph: string, colorToken: string}}
 */
export function resolveTerrainAppearance(name) {
  return TERRAIN_APPEARANCE[name] ?? TERRAIN_APPEARANCE.unknown;
}

/**
 * Vegetation density ramp, indexed by quantized level (0..maxLevel). Level 0
 * means bare (draw the terrain underneath); levels 1+ draw a green `.`/`,`/`"`
 * density ramp over the ground. Renderer-owned — the protocol only sends the
 * integer level.
 */
export const VEGETATION_APPEARANCE = Object.freeze([
  null, // 0 — bare: fall through to terrain
  Object.freeze({ glyph: '.', colorToken: 'green' }),
  Object.freeze({ glyph: ',', colorToken: 'green' }),
  Object.freeze({ glyph: '"', colorToken: 'green' }),
  Object.freeze({ glyph: '"', colorToken: 'bright-green' }),
]);

/**
 * Appearance for a vegetation level, or null when the cell is bare (level 0)
 * or the level is unknown (renderer draws terrain instead).
 * @param {number} level
 * @returns {{glyph: string, colorToken: string} | null}
 */
export function resolveVegetationAppearance(level) {
  return VEGETATION_APPEARANCE[level] ?? (level > 0 ? VEGETATION_APPEARANCE.at(-1) : null);
}

/**
 * Ground animals wore (protocol v27). Renderer-owned: the protocol sends a
 * cell, a kind, and a depth, and says nothing about how any of it should look.
 *
 * Drawn over terrain and vegetation but under disturbances and entities — worn
 * ground is the most permanent thing on the map and the least urgent to see.
 */
export const FEATURE_APPEARANCE = Object.freeze({
  trail: Object.freeze({ glyph: ':', colorToken: 'orange' }),
  burrow: Object.freeze({ glyph: 'o', colorToken: 'comment' }),
});

/** Appearance for a feature kind, or null for one this renderer predates. */
export function resolveFeatureAppearance(kind) {
  return FEATURE_APPEARANCE[kind] ?? null;
}

/**
 * Local disturbances (protocol v26). Renderer-owned, like every other
 * appearance here: the protocol sends a kind, a centre, and a radius, and says
 * nothing about how any of it should look.
 *
 * Drawn *over* terrain and vegetation but under entities, because a disturbance
 * is something happening to the ground rather than something standing on it —
 * and an animal caught in one has to stay visible, which is the whole point of
 * being able to watch it get caught.
 */
export const DISTURBANCE_APPEARANCE = Object.freeze({
  fire: Object.freeze({ glyph: '^', colorToken: 'orange' }),
  flood: Object.freeze({ glyph: '~', colorToken: 'cyan' }),
  storm: Object.freeze({ glyph: '*', colorToken: 'purple' }),
});

/** Appearance for a disturbance kind, or null for one this renderer predates. */
export function resolveDisturbanceAppearance(kind) {
  return DISTURBANCE_APPEARANCE[kind] ?? null;
}

/**
 * Marks for the places an animal remembers (protocol v14). These are drawn
 * only for the selected entity — one animal's private map of the world, not
 * world state — and faded by the memory's strength. Renderer-owned: the
 * protocol sends only a kind, a cell, and a strength.
 */
export const MEMORY_APPEARANCE = Object.freeze({
  food: Object.freeze({ glyph: '"', colorToken: 'bright-green' }),
  water: Object.freeze({ glyph: '~', colorToken: 'bright-cyan' }),
  barren: Object.freeze({ glyph: 'x', colorToken: 'comment' }),
  danger: Object.freeze({ glyph: '!', colorToken: 'red' }),
});

/**
 * Marker for a remembered place, or null for a kind this renderer does not
 * map yet (a newer engine may send kinds this build has never heard of).
 * @param {string} kind
 * @returns {{glyph: string, colorToken: string} | null}
 */
export function resolveMemoryAppearance(kind) {
  return MEMORY_APPEARANCE[kind] ?? null;
}

/**
 * Health fraction below which a living animal is drawn in a hurt tone. Injuries
 * themselves are inspection-only (protocol v16), but `healthFraction` has been
 * in every bulk snapshot since Step 4 — so the grid can show that an animal is
 * in poor condition without the protocol carrying anything new.
 */
export const HURT_HEALTH_FRACTION = 0.7;

/** Renderer-owned colour for a living animal that is visibly hurt. */
export const HURT_COLOR_TOKEN = 'orange';

/**
 * Renderer-owned colour for a visibly ill animal (protocol v24). Takes
 * precedence over the hurt tint: an outbreak crossing a herd is the thing worth
 * seeing, and a sick animal is usually losing health anyway, so the two tints
 * would otherwise fight over the same animals.
 *
 * Only `symptomatic` is tinted, even though the protocol also sends
 * `incubating`. That is deliberate rather than an oversight: the whole model
 * rests on a carrier being *invisible*, and colouring one would hand the viewer
 * information no animal in the world has.
 */
export const SICK_COLOR_TOKEN = 'purple';

/**
 * Colour token for an entity as drawn, taking condition into account. Kept
 * separate from `resolveAppearance` so the glyph (a species fact) and the tint
 * (a moment-to-moment condition) stay independently cacheable.
 * @param {{alive?: boolean, healthFraction?: number}} entity
 * @param {{colorToken: string}} appearance
 * @returns {string}
 */
export function resolveColorToken(entity, appearance) {
  if (entity?.alive !== false && entity?.diseaseState === 'symptomatic') return SICK_COLOR_TOKEN;
  const hurt =
    entity?.alive !== false &&
    typeof entity?.healthFraction === 'number' &&
    entity.healthFraction < HURT_HEALTH_FRACTION;
  return hurt ? HURT_COLOR_TOKEN : appearance.colorToken;
}

const cache = new Map();

/**
 * Deterministic appearance lookup for an entity. Cached per
 * (kind, speciesId, alive, decayStage, sex, mature) — repeated lookups return
 * the same object. `decayStage` only varies for carcasses and both `sex` and
 * maturity take a handful of values, so the cache stays small.
 *
 * A living animal carries two independent display channels on top of its
 * species glyph, so a herd's age and sex structure reads straight off the grid:
 *
 * - **Letter case is age** — a mature animal (adult or senescent) is UPPERCASE,
 *   an immature one (juvenile or subadult) lowercase.
 * - **Italic is sex** — a female is drawn in italic; a male (or an animal with
 *   no sex) upright. `italic` rides on the appearance for the canvas and legend
 *   to honour; nothing else about the glyph changes.
 *
 * Colour still says species and priority still decides who wins a shared cell,
 * so both channels are additions rather than substitutions. A plant, a carcass,
 * or an unknown kind keeps its base glyph exactly — case and italic are
 * animal-only.
 *
 * @param {{kind?: string, speciesId?: string, alive?: boolean, decayStage?: number, sex?: string|null, lifeStage?: string|null}} entity
 * @returns {Appearance}
 */
export function resolveAppearance(entity) {
  const kind = entity?.kind ?? 'unknown';
  const speciesId = entity?.speciesId ?? '';
  const alive = entity?.alive !== false;
  const decayStage = kind === 'carcass' ? (entity?.decayStage ?? 0) : 0;
  const sex = entity?.sex ?? '';
  const mature = isMatureStage(entity?.lifeStage);
  const key = `${kind}|${speciesId}|${alive}|${decayStage}|${sex}|${mature}`;
  let appearance = cache.get(key);
  if (!appearance) {
    if (kind === 'carcass' || (!alive && kind === 'animal')) {
      appearance = CARCASS_DECAY_APPEARANCE[decayStage] ?? CARCASS_DECAY_APPEARANCE.at(-1);
    } else if (kind === 'animal' && alive) {
      const base = SPECIES_APPEARANCE[speciesId] ?? KIND_APPEARANCE[kind] ?? UNKNOWN_APPEARANCE;
      const glyph = mature ? base.glyph.toUpperCase() : base.glyph.toLowerCase();
      const italic = sex === 'female';
      appearance =
        glyph !== base.glyph || italic ? Object.freeze({ ...base, glyph, italic }) : base;
    } else {
      appearance = SPECIES_APPEARANCE[speciesId] ?? KIND_APPEARANCE[kind] ?? UNKNOWN_APPEARANCE;
    }
    cache.set(key, appearance);
  }
  return appearance;
}

/**
 * Deterministic display-priority ordering for cell occupants: higher
 * appearance priority first, ties broken by ascending entity id. (The
 * selected entity is handled as an overlay, above everything.)
 * @param {object} a @param {object} b
 */
export function compareOccupants(a, b) {
  const priorityDiff = resolveAppearance(b).priority - resolveAppearance(a).priority;
  return priorityDiff !== 0 ? priorityDiff : a.id - b.id;
}

/**
 * The occupant whose glyph a cell displays.
 * @param {object[]} occupants non-empty
 */
export function topOccupant(occupants) {
  return [...occupants].sort(compareOccupants)[0];
}
