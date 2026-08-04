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
  // ---- the roster (PLAN-SPECIES §7) ----
  // ⚠ **`supersededBy` has no entries left, and that is the scheme working
  // rather than the scheme being abandoned.** It named the roster entry a shipped
  // species would be renamed into, so two species could share a glyph without
  // that being a collision — and the rule was always that **the entry is deleted
  // in the phase that does the rename**. The grazer's and the corvid's went at
  // phase 7 (2026-07-29) when they became the gazelle and the vulture; the
  // stalker's went at **phase 14** (2026-07-30) when it became the leopard, which
  // was the last one. The field, its handling, and `renderer-view.test.js`'s
  // check of it all stay: the next rename needs them, and a scheme that is
  // deleted the moment it is empty has to be rediscovered.
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
  // A spade beside the thicket's club, and the pairing is the point: the two
  // woody layers read as one family at a glance, and the taller one gets the
  // brighter green. Scattered trees are the sparsest layer on the map, so the
  // glyph has to survive being a single cell in an ocean of grass.
  tree: Object.freeze({ glyph: '♠', colorToken: 'bright-green' }),
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
  Object.freeze({ glyph: ':', colorToken: 'green' }),
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
  trail: Object.freeze({ glyph: '.', colorToken: 'orange' }),
  burrow: Object.freeze({ glyph: 'O', colorToken: 'comment' }),
});

/** Appearance for a feature kind, or null for one this renderer predates. */
export function resolveFeatureAppearance(kind) {
  return FEATURE_APPEARANCE[kind] ?? null;
}

/**
 * The layers that give way to whatever is standing on them: **forage, water,
 * trails, and burrows**. Drawn at `OCCUPIED_ALPHA` in any cell an entity
 * occupies (see `AsciiGridRenderer`) — both glyphs land in the same cell and the
 * occupant's is the informative one, so a full-strength `"` behind a `g` reads
 * as a two-character smear while a faded one still says the animal is standing
 * in deep grass.
 *
 * ⚠ **Membership is a judgement about what a layer is _for_, not about how
 * often it is drawn.** These are readings *of* a cell — how much there is to
 * eat, whether it is wet, what has walked here, whether it is thick enough to
 * hide in. What stays solid is the *hard* shape of the map: rock and cover, and
 * disturbances, because an animal caught in a fire is the whole point of being
 * able to watch it get caught.
 *
 * ⚠ Thicket is in the list precisely because it is the layer animals are most
 * often *inside*: a `♣` and a `g` in the same 10px cell is the collision this
 * mechanism exists for, and a herd in cover was the hardest thing on the map to
 * read.
 *
 * ⚠ **Tree is in it for the same reason, twice over.** An animal *under* a tree
 * is the ordinary case, and an animal *up* one is what the whole layer exists
 * to make watchable — a `♠` drawn over either would hide exactly the thing
 * worth seeing.
 */
const FADING_LAYERS = new Set([
  ...VEGETATION_APPEARANCE.filter(Boolean),
  TERRAIN_APPEARANCE.water,
  TERRAIN_APPEARANCE.deep_water,
  TERRAIN_APPEARANCE.thicket,
  TERRAIN_APPEARANCE.tree,
  FEATURE_APPEARANCE.trail,
  FEATURE_APPEARANCE.burrow,
]);

/**
 * Whether this ground layer gives way to an occupant standing on it.
 *
 * ⚠ **An identity test, never a glyph comparison.** The layers share glyphs —
 * `.` is bare ground, the sparsest forage, *and* a trail — so only the identity
 * of the frozen registry entry says which layer produced the answer.
 * @param {{glyph: string, colorToken: string} | null} appearance
 * @returns {boolean}
 */
export function fadesUnderOccupant(appearance) {
  return FADING_LAYERS.has(appearance);
}

/**
 * Opacity of a fading layer in a cell something is standing in.
 *
 * **Zero: the layer is not drawn there at all.** It was 20% first, on the
 * argument that a herd would otherwise punch holes in the grass it is grazing —
 * and watching it, the holes are not the problem. Two glyphs in one 10px cell is
 * a smudge at *any* opacity that leaves the lower one visible, the occupant is
 * always the thing worth reading, and the ground it is standing on is one click
 * away in the inspector, which reports the cell rather than the animal.
 *
 * Kept as a constant rather than deleted along with the branch: it is the knob
 * this decision turns, and the next person to disagree should be able to turn it
 * back rather than rebuild the mechanism. ⚠ At 0 the renderer skips the draw
 * outright instead of drawing something invisible.
 */
export const OCCUPIED_ALPHA = 0;

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
 * Health fraction below which a living animal counts as hurt. Injuries
 * themselves are inspection-only (protocol v16), but `healthFraction` has been
 * in every bulk snapshot since Step 4 — so the grid can show that an animal is
 * in poor condition without the protocol carrying anything new.
 */
export const HURT_HEALTH_FRACTION = 0.7;

/**
 * The statuses an animal can be marked with, in the order they cycle.
 *
 * ⚠ **A status is a mark in the corner of the cell, not a change to the glyph**,
 * and that is the whole point of this registry. Hurt and ill used to *tint* the
 * species letter, which cost the two things the letter is for: a purple `g` no
 * longer says "gazelle" at a glance, and the two tints could not both be shown,
 * so an animal that was ill *and* hurt looked exactly like one that was only
 * ill. A mark beside the glyph is additive — the letter keeps saying species,
 * the colour keeps saying species, and any number of conditions can ride along.
 *
 * `shape` distinguishes the two families and is deliberately only two values:
 *
 * - **`dot` — condition.** Something is wrong with this animal.
 * - **`diamond` — state.** Something is happening in its life. Not wrong, not
 *   permanent, and worth finding on the grid.
 *
 * Each carries its own colour, because shape alone is two bits and colour is
 * what makes a marker findable in a herd. ⚠ **An animal in several statuses
 * shows them one at a time, cycling every `STATUS_CYCLE_MS`** — see
 * `AsciiGridRenderer`. Drawing all of them at once was the alternative and it is
 * worse at every zoom this renderer offers: four marks in a 10px cell is a
 * smudge, and the corner is the only place they can go without covering the
 * glyph they belong to.
 *
 * Every predicate reads a **bulk-snapshot** field, so a status is true of every
 * animal on screen rather than only of the selected one. `gestating` and
 * `seekingMate` are what protocol v30 added for exactly this.
 *
 * @type {ReadonlyArray<{id: string, shape: 'dot' | 'diamond', colorToken: string,
 *        label: string, applies: (entity: object) => boolean}>}
 */
export const STATUS_APPEARANCE = Object.freeze([
  Object.freeze({
    id: 'hurt',
    shape: 'dot',
    colorToken: 'orange',
    label: 'hurt',
    applies: (entity) =>
      typeof entity.healthFraction === 'number' && entity.healthFraction < HURT_HEALTH_FRACTION,
  }),
  Object.freeze({
    id: 'ill',
    shape: 'dot',
    colorToken: 'purple',
    label: 'visibly ill',
    // ⚠ `incubating` is deliberately unmarked even though the protocol sends it:
    // the whole disease model rests on a carrier being invisible, and marking
    // one would hand the viewer information no animal in the world has.
    applies: (entity) => entity.diseaseState === 'symptomatic',
  }),
  Object.freeze({
    id: 'gestating',
    shape: 'diamond',
    colorToken: 'pink',
    label: 'carrying young',
    applies: (entity) => entity.gestating === true,
  }),
  Object.freeze({
    id: 'rut',
    shape: 'diamond',
    colorToken: 'bright-cyan',
    label: 'in rut',
    // ⚠ The engine leaves the *seeking* sex ready year-round and gates only the
    // chooser, so this marks the animals actually in the market. A male marker
    // would be permanently lit and would say nothing.
    applies: (entity) => entity.seekingMate === true,
  }),
  Object.freeze({
    id: 'dispersing',
    shape: 'diamond',
    colorToken: 'bright-white',
    label: 'dispersing',
    applies: (entity) => entity.dispersing === true,
  }),
]);

/** How long each status of a multi-status animal is shown before the next. */
export const STATUS_CYCLE_MS = 500;

/**
 * The statuses of one entity, in registry order.
 *
 * Living animals only: a carcass has no condition and no life left to be in the
 * middle of, and every one of these fields is either absent or meaningless on
 * one. Returns the shared empty array when there are none, which is the case
 * for almost every animal on almost every tick — this runs once per drawn cell
 * per frame, so the common answer must not allocate.
 *
 * @param {object} entity
 * @returns {ReadonlyArray<object>}
 */
export function statusesOf(entity) {
  if (entity?.kind !== 'animal' || entity.alive === false) return NO_STATUSES;
  let found = null;
  for (const status of STATUS_APPEARANCE) {
    if (!status.applies(entity)) continue;
    if (found === null) found = [status];
    else found.push(status);
  }
  return found ?? NO_STATUSES;
}

const NO_STATUSES = Object.freeze([]);

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
