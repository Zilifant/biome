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
 * @property {string} glyph single ASCII character
 * @property {Record<string, string>} [glyphBySex] per-sex glyph override (protocol v21)
 * @property {string} colorToken key into DRACULA_COLORS
 * @property {number} priority higher wins when a cell has multiple occupants
 * @property {string} label human-readable category for the inspector
 */

/** Defaults by protocol `kind`. */
export const KIND_APPEARANCE = Object.freeze({
  animal: Object.freeze({ glyph: 'a', colorToken: 'yellow', priority: 50, label: 'animal' }),
  plant: Object.freeze({ glyph: '"', colorToken: 'green', priority: 20, label: 'plant' }),
});

/**
 * Species-specific overrides (renderer-only knowledge). Keyed by the protocol
 * `speciesId`; add an entry to give a species its own glyph/color without
 * touching the grid-rendering algorithm.
 */
export const SPECIES_APPEARANCE = Object.freeze({
  'herbivore.grazer': Object.freeze({
    glyph: 'g',
    glyphBySex: Object.freeze({ female: 'g', male: 'G' }),
    colorToken: 'yellow',
    priority: 50,
    label: 'grazer',
  }),
  // Predators outrank prey in a shared cell, so a hunt reads as the hunter's
  // glyph rather than disappearing behind the animal it is standing on.
  'predator.stalker': Object.freeze({
    glyph: 's',
    glyphBySex: Object.freeze({ female: 's', male: 'S' }),
    colorToken: 'red',
    priority: 60,
    label: 'stalker',
  }),
});

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
 * Colour token for an entity as drawn, taking condition into account. Kept
 * separate from `resolveAppearance` so the glyph (a species fact) and the tint
 * (a moment-to-moment condition) stay independently cacheable.
 * @param {{alive?: boolean, healthFraction?: number}} entity
 * @param {{colorToken: string}} appearance
 * @returns {string}
 */
export function resolveColorToken(entity, appearance) {
  const hurt =
    entity?.alive !== false &&
    typeof entity?.healthFraction === 'number' &&
    entity.healthFraction < HURT_HEALTH_FRACTION;
  return hurt ? HURT_COLOR_TOKEN : appearance.colorToken;
}

const cache = new Map();

/**
 * Deterministic appearance lookup for an entity. Cached per
 * (kind, speciesId, alive, decayStage, sex) — repeated lookups return the same
 * object. `decayStage` only varies for carcasses and `sex` takes three values,
 * so the cache stays small.
 *
 * Sex (protocol v21) is drawn by letter case — lowercase female, uppercase
 * male — so a herd's composition reads straight off the grid, which is what
 * makes mate choice something you can watch. Colour still says species, and a
 * species that maps no `glyphBySex` (or an animal with no sex) simply keeps its
 * base glyph.
 *
 * @param {{kind?: string, speciesId?: string, alive?: boolean, decayStage?: number, sex?: string|null}} entity
 * @returns {Appearance}
 */
export function resolveAppearance(entity) {
  const kind = entity?.kind ?? 'unknown';
  const speciesId = entity?.speciesId ?? '';
  const alive = entity?.alive !== false;
  const decayStage = kind === 'carcass' ? (entity?.decayStage ?? 0) : 0;
  const sex = entity?.sex ?? '';
  const key = `${kind}|${speciesId}|${alive}|${decayStage}|${sex}`;
  let appearance = cache.get(key);
  if (!appearance) {
    if (kind === 'carcass' || (!alive && kind === 'animal')) {
      appearance = CARCASS_DECAY_APPEARANCE[decayStage] ?? CARCASS_DECAY_APPEARANCE.at(-1);
    } else {
      const base = SPECIES_APPEARANCE[speciesId] ?? KIND_APPEARANCE[kind] ?? UNKNOWN_APPEARANCE;
      const sexed = base.glyphBySex?.[sex];
      appearance = sexed && sexed !== base.glyph ? Object.freeze({ ...base, glyph: sexed }) : base;
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
