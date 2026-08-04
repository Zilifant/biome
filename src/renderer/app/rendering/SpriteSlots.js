/**
 * Sprite slot vocabulary — the bridge between the ASCII appearance registries
 * and a sprite-mode assignment. A *slot* is a stable string id for one thing
 * the grid can draw (a grown female grazer, the water terrain, forage level 3,
 * a fresh carcass, …). The sprite editor assigns a spritesheet cell to a slot;
 * the sprite renderer resolves an entity or ground cell to a slot and looks the
 * assignment up.
 *
 * Everything here is enumerated FROM the registries in EntityAppearance.js,
 * never hand-listed — the same non-drift principle as the generated legend. A
 * species added there gains its four slots (young/grown × male/female) here and
 * in the editor for free.
 *
 * ⚠ Slot ids are the sprite config's compatibility surface: a persisted or
 * exported mapping is keyed by them. Renaming one orphans assignments (they are
 * dropped by config validation, not migrated), so treat the vocabulary as
 * append-only.
 *
 * Pure module: no DOM, no canvas, no store mutation — node-testable like
 * CellDetail and the legend.
 */
import {
  SPECIES_APPEARANCE,
  KIND_APPEARANCE,
  CARCASS_DECAY_APPEARANCE,
  UNKNOWN_APPEARANCE,
  TERRAIN_APPEARANCE,
  VEGETATION_APPEARANCE,
  FEATURE_APPEARANCE,
  DISTURBANCE_APPEARANCE,
  MEMORY_APPEARANCE,
  isMatureStage,
} from './EntityAppearance.js';

/** The two age values letter case encodes, as slot-id segments. */
const AGES = Object.freeze(['young', 'grown']);
/** The two sex values italic encodes, as slot-id segments. */
const SEXES = Object.freeze(['male', 'female']);

/**
 * @typedef {object} SpriteSlot
 * @property {string} slotId stable id, e.g. `species:herbivore.grazer:grown:female`
 * @property {string} glyph the ASCII glyph this slot replaces (case applied)
 * @property {boolean} [italic] whether the ASCII glyph is drawn italic (female)
 * @property {string} colorToken the glyph's Dracula token (fallback drawing)
 * @property {string} label human-readable name for the editor
 * @property {string} [note] editor-facing hint (e.g. "selected animal only")
 */

/** One animal slot per (base appearance, age, sex), glyph case/italic applied. */
function animalSlot(idPrefix, base, age, sex) {
  const glyph = age === 'grown' ? base.glyph.toUpperCase() : base.glyph.toLowerCase();
  return {
    slotId: `${idPrefix}:${age}:${sex}`,
    glyph,
    italic: sex === 'female',
    colorToken: base.colorToken,
    label: `${base.label} (${age} ${sex})`,
  };
}

function animalSlotsFor(idPrefix, base) {
  const slots = [];
  for (const age of AGES) {
    for (const sex of SEXES) {
      slots.push(animalSlot(idPrefix, base, age, sex));
    }
  }
  return slots;
}

/**
 * Every slot the editor offers, grouped for display the way the legend groups
 * its entries. Pure — returns plain data; the editor renders it.
 * @returns {Array<{title: string, slots: SpriteSlot[]}>}
 */
export function describeSpriteSlots() {
  const groups = [];

  const animals = [];
  for (const [speciesId, base] of Object.entries(SPECIES_APPEARANCE)) {
    animals.push(...animalSlotsFor(`species:${speciesId}`, base));
  }
  animals.push(
    ...animalSlotsFor('kind:animal', { ...KIND_APPEARANCE.animal, label: 'unmapped species' })
  );
  groups.push({ title: 'Animals', slots: animals });

  groups.push({
    title: 'Other entities',
    slots: [
      {
        slotId: 'kind:plant',
        glyph: KIND_APPEARANCE.plant.glyph,
        colorToken: KIND_APPEARANCE.plant.colorToken,
        label: KIND_APPEARANCE.plant.label,
      },
      {
        slotId: 'unknown',
        glyph: UNKNOWN_APPEARANCE.glyph,
        colorToken: UNKNOWN_APPEARANCE.colorToken,
        label: 'unknown kind',
      },
    ],
  });

  groups.push({
    title: 'Remains',
    slots: CARCASS_DECAY_APPEARANCE.map((appearance, stage) => ({
      slotId: `carcass:${stage}`,
      glyph: appearance.glyph,
      colorToken: appearance.colorToken,
      label: appearance.label,
    })),
  });

  groups.push({
    title: 'Ground',
    slots: Object.entries(TERRAIN_APPEARANCE)
      .filter(([name]) => name !== 'unknown')
      .map(([name, appearance]) => ({
        slotId: `terrain:${name}`,
        glyph: appearance.glyph,
        colorToken: appearance.colorToken,
        label: name === 'outOfBounds' ? 'beyond the world edge' : name.replace('_', ' '),
      })),
  });

  groups.push({
    title: 'Forage',
    slots: VEGETATION_APPEARANCE.flatMap((appearance, level) =>
      appearance
        ? [
            {
              slotId: `vegetation:${level}`,
              glyph: appearance.glyph,
              colorToken: appearance.colorToken,
              label: `forage ${level}`,
            },
          ]
        : []
    ),
  });

  groups.push({
    title: 'Worn ground',
    slots: Object.entries(FEATURE_APPEARANCE).map(([kind, appearance]) => ({
      slotId: `feature:${kind}`,
      glyph: appearance.glyph,
      colorToken: appearance.colorToken,
      label: kind,
    })),
  });

  groups.push({
    title: 'Disturbances',
    slots: Object.entries(DISTURBANCE_APPEARANCE).map(([kind, appearance]) => ({
      slotId: `disturbance:${kind}`,
      glyph: appearance.glyph,
      colorToken: appearance.colorToken,
      label: kind,
    })),
  });

  groups.push({
    title: 'Remembered places',
    slots: Object.entries(MEMORY_APPEARANCE).map(([kind, appearance]) => ({
      slotId: `memory:${kind}`,
      glyph: appearance.glyph,
      colorToken: appearance.colorToken,
      label: `remembered ${kind}`,
      note: 'selected animal only',
    })),
  });

  return groups;
}

/** Flat list of every slot id, for config validation and tests. */
export function allSlotIds() {
  return describeSpriteSlots().flatMap((group) => group.slots.map((slot) => slot.slotId));
}

/**
 * The slot an entity draws from — mirroring resolveAppearance's branch
 * structure exactly, so a sprite and its fallback glyph can never disagree
 * about what an entity is. Priority and top-occupant choice stay with
 * compareOccupants; this only names the winner.
 * @param {{kind?: string, speciesId?: string, alive?: boolean, decayStage?: number, sex?: string|null, lifeStage?: string|null}} entity
 * @returns {string}
 */
export function slotIdForEntity(entity) {
  const kind = entity?.kind ?? 'unknown';
  const alive = entity?.alive !== false;
  if (kind === 'carcass' || (!alive && kind === 'animal')) {
    const stage = entity?.decayStage ?? 0;
    const maxStage = CARCASS_DECAY_APPEARANCE.length - 1;
    const clamped = stage >= 0 && stage <= maxStage ? stage : maxStage;
    return `carcass:${clamped}`;
  }
  if (kind === 'animal' && alive) {
    const speciesId = entity?.speciesId ?? '';
    const prefix = SPECIES_APPEARANCE[speciesId] ? `species:${speciesId}` : 'kind:animal';
    const age = isMatureStage(entity?.lifeStage) ? 'grown' : 'young';
    const sex = entity?.sex === 'female' ? 'female' : 'male';
    return `${prefix}:${age}:${sex}`;
  }
  return KIND_APPEARANCE[kind] ? `kind:${kind}` : 'unknown';
}

/**
 * The slot a ground cell draws from, sharing groundAppearanceAt's precedence
 * (out-of-bounds → tree → vegetation where a cell carries any → terrain).
 * Returns null where the ASCII path would fall back to the `unknown` terrain
 * appearance — an unmapped terrain name has no slot, and the sprite renderer
 * draws the fallback glyph instead.
 * @param {import('../state/RendererStore.js').RendererStore} store
 * @param {number} cellX @param {number} cellY
 * @param {{width: number, height: number} | null} world
 * @returns {string | null}
 */
export function groundSlotAt(store, cellX, cellY, world) {
  const inWorld = world && cellX >= 0 && cellY >= 0 && cellX < world.width && cellY < world.height;
  if (!inWorld) return 'terrain:outOfBounds';
  const name = store.terrainNameAt(cellX, cellY);
  // Keep the tree visible through the grass that grows beneath it, matching
  // groundAppearanceAt. Without this branch sprite mode would select a
  // vegetation slot while its fallback glyph selected the tree slot.
  if (name === 'tree') return 'terrain:tree';
  const level = store.vegetationLevelAt(cellX, cellY);
  if (VEGETATION_APPEARANCE[level] ?? (level > 0 ? VEGETATION_APPEARANCE.at(-1) : null)) {
    return `vegetation:${Math.min(level, VEGETATION_APPEARANCE.length - 1)}`;
  }
  if (!name) return 'terrain:ground';
  return name !== 'unknown' && TERRAIN_APPEARANCE[name] ? `terrain:${name}` : null;
}

/** Slot id for a feature kind, or null for one this renderer predates. */
export function slotIdForFeature(kind) {
  return FEATURE_APPEARANCE[kind] ? `feature:${kind}` : null;
}

/** Slot id for a disturbance kind, or null for one this renderer predates. */
export function slotIdForDisturbance(kind) {
  return DISTURBANCE_APPEARANCE[kind] ? `disturbance:${kind}` : null;
}

/** Slot id for a memory kind, or null for one this renderer predates. */
export function slotIdForMemory(kind) {
  return MEMORY_APPEARANCE[kind] ? `memory:${kind}` : null;
}

/**
 * The sprite assigned to a slot, or null when the slot is unassigned (the
 * renderer then falls back to the ASCII glyph).
 * @param {{assignments?: Record<string, {col: number, row: number, tint: string | null}>}} config
 * @param {string | null} slotId
 * @returns {{col: number, row: number, tint: string | null} | null}
 */
export function spriteForSlot(config, slotId) {
  if (!slotId) return null;
  return config?.assignments?.[slotId] ?? null;
}
