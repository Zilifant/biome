/**
 * The sprite editor's state machine — pure transitions over plain state, no
 * DOM, no storage. editorMain.js owns the wiring: it calls a transition, saves
 * the resulting config, and re-renders. Keeping the flow here means the whole
 * assignment interaction (select a slot, pick a sprite, tint it, clear it) is
 * node-testable, the same "describe, then render" shape as CellDetail and the
 * legend.
 *
 * State shape:
 *   {
 *     config: <a config out of validateSpriteConfig>,
 *     selectedSlotId: string | null,   // the slot being edited
 *     selectedSprite: {col, row} | null // a sheet cell picked with no slot
 *   }
 *
 * Either order works: picking a slot then a sprite assigns on the sprite
 * click; picking a sprite first parks it in `selectedSprite` and assigns on
 * the slot click.
 */
import { validateSpriteConfig, DEFAULT_SPRITE_CONFIG } from '../rendering/SpriteConfig.js';

/** @returns {object} the editor's opening state over a loaded config */
export function initialState(config = DEFAULT_SPRITE_CONFIG) {
  return Object.freeze({
    config: validateSpriteConfig(config) ?? DEFAULT_SPRITE_CONFIG,
    selectedSlotId: null,
    selectedSprite: null,
  });
}

function withConfig(state, configPatch) {
  const config = validateSpriteConfig({ ...state.config, ...configPatch });
  // A transition can only produce a valid config; if it somehow cannot, keep
  // the state we have rather than half-applying.
  return config ? Object.freeze({ ...state, config }) : state;
}

/**
 * Select a slot to edit. If a sprite was picked first, the assignment lands
 * now (keeping any tint the slot already carried); selecting the same slot
 * again deselects it.
 */
export function selectSlot(state, slotId) {
  if (slotId === state.selectedSlotId && !state.selectedSprite) {
    return Object.freeze({ ...state, selectedSlotId: null });
  }
  if (state.selectedSprite) {
    const next = assign(state, slotId, state.selectedSprite);
    return Object.freeze({ ...next, selectedSlotId: slotId, selectedSprite: null });
  }
  return Object.freeze({ ...state, selectedSlotId: slotId });
}

/**
 * Pick a sheet cell. With a slot selected the assignment lands immediately;
 * with none it is parked so the next slot click assigns it.
 */
export function pickSprite(state, col, row) {
  if (state.selectedSlotId) {
    return assign(state, state.selectedSlotId, { col, row });
  }
  return Object.freeze({ ...state, selectedSprite: { col, row } });
}

function assign(state, slotId, { col, row }) {
  const existing = state.config.assignments[slotId];
  return withConfig(state, {
    assignments: {
      ...state.config.assignments,
      // A re-assignment keeps the tint: the colour choice belongs to the
      // slot, not to the particular sprite that had it.
      [slotId]: { col, row, tint: existing?.tint ?? null },
    },
  });
}

/**
 * Set (or clear, with null) the selected slot's tint. No-op without a
 * selected, assigned slot — a tint decorates an assignment.
 */
export function setTint(state, tint) {
  const slotId = state.selectedSlotId;
  const assignment = slotId ? state.config.assignments[slotId] : null;
  if (!assignment) return state;
  return withConfig(state, {
    assignments: { ...state.config.assignments, [slotId]: { ...assignment, tint } },
  });
}

/** Remove the selected slot's assignment entirely (back to the glyph). */
export function clearAssignment(state) {
  const slotId = state.selectedSlotId;
  if (!slotId || !state.config.assignments[slotId]) return state;
  const assignments = { ...state.config.assignments };
  delete assignments[slotId];
  return withConfig(state, { assignments });
}

/** Set (or clear, with null) the simulation canvas background colour. */
export function setBackground(state, hex) {
  return withConfig(state, { canvasBackground: hex });
}

/** Use an editor-loaded sheet (data: URL), or null to return to SHEET.url. */
export function setSheetDataUrl(state, dataUrl) {
  return withConfig(state, { sheetDataUrl: dataUrl });
}

/**
 * Replace the whole config from imported JSON text. Returns the same state
 * (and `ok: false`) when the text is not a usable config — an import must
 * never half-apply.
 * @returns {{state: object, ok: boolean}}
 */
export function importConfig(state, jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { state, ok: false };
  }
  const config = validateSpriteConfig(parsed);
  if (!config) return { state, ok: false };
  return {
    state: Object.freeze({ ...state, config, selectedSlotId: null, selectedSprite: null }),
    ok: true,
  };
}

/** Back to the committed default (nothing assigned). */
export function resetToDefault(state) {
  return Object.freeze({
    ...state,
    config: DEFAULT_SPRITE_CONFIG,
    selectedSlotId: null,
    selectedSprite: null,
  });
}
