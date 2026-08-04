/**
 * Sprite-mode configuration: the spritesheet constants, the assignment map,
 * and its persistence.
 *
 * ── The spritesheet constants ────────────────────────────────────────────────
 * SHEET below is the one place per-sheet geometry is set. Using a different
 * spritesheet means editing these values — they are deliberately code
 * constants, not editor inputs. The conventional place for the sheet itself is
 * `src/renderer/app/assets/spritesheet.png` (served at SHEET.url); no sheet is
 * committed — sprite mode falls back to ASCII glyphs until one is supplied
 * there or loaded in the sprite editor.
 *
 * ── The persisted config ─────────────────────────────────────────────────────
 * Assignments (slot → sheet cell + optional tint), the canvas background, and
 * an optional editor-loaded sheet (as a data: URL) persist as one versioned
 * JSON object in localStorage. The sprite editor writes it; the sprite
 * renderer reads it at startup. A valid stored config overrides the default;
 * anything invalid falls back rather than half-applying. Export/Import in the
 * editor round-trips the same object, which is how a finished mapping is
 * shared or committed as a new default.
 *
 * Renderer-owned, like every appearance decision (invariant 20): none of this
 * exists in the engine or the protocol.
 */
import { allSlotIds } from "./SpriteSlots.js";

/**
 * Per-sheet geometry — edit these to match the spritesheet in use.
 * - spriteWidth / spriteHeight: pixel size of one sprite (need not be square)
 * - gap: pixels between grid columns/rows
 * - margin: pixels above and left of the grid before the first sprite
 */
export const SHEET = Object.freeze({
  url: "/renderer/app/assets/spritesheet.png",
  spriteWidth: 12,
  spriteHeight: 12,
  gap: 1,
  margin: 1,
});

export const SPRITE_CONFIG_KEY = "biome.sprites.config.v1";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The starting config: nothing assigned, theme background, conventional sheet. */
export const DEFAULT_SPRITE_CONFIG = Object.freeze({
  version: 1,
  /** null → the Dracula background token, as in ASCII mode. */
  canvasBackground: null,
  /** Editor-loaded sheet as a data: URL, overriding SHEET.url. null → SHEET.url. */
  sheetDataUrl: null,
  /** slot id → {col, row, tint}; an absent slot falls back to its ASCII glyph. */
  assignments: Object.freeze({}),
});

function normalizedAssignment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const col = Number(raw.col);
  const row = Number(raw.row);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0)
    return null;
  const tint =
    typeof raw.tint === "string" && HEX_COLOR.test(raw.tint)
      ? raw.tint.toUpperCase()
      : null;
  return Object.freeze({ col, row, tint });
}

/**
 * Normalize a raw (parsed but untrusted) config, or return null when it is not
 * usable at all. Individually bad pieces are dropped rather than fatal:
 * assignments keyed by slot ids this build does not know disappear (a renamed
 * slot degrades to "unassigned" rather than to an unremovable ghost), and a
 * malformed tint or background becomes null. Pure — node-testable.
 * @param {unknown} raw
 * @returns {object | null}
 */
export function validateSpriteConfig(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
  const known = new Set(allSlotIds());
  const assignments = {};
  for (const [slotId, value] of Object.entries(raw.assignments ?? {})) {
    if (!known.has(slotId)) continue;
    const assignment = normalizedAssignment(value);
    if (assignment) assignments[slotId] = assignment;
  }
  const background =
    typeof raw.canvasBackground === "string" &&
    HEX_COLOR.test(raw.canvasBackground)
      ? raw.canvasBackground.toUpperCase()
      : null;
  const sheetDataUrl =
    typeof raw.sheetDataUrl === "string" &&
    raw.sheetDataUrl.startsWith("data:image/")
      ? raw.sheetDataUrl
      : null;
  return Object.freeze({
    version: 1,
    canvasBackground: background,
    sheetDataUrl,
    assignments: Object.freeze(assignments),
  });
}

/**
 * The active sprite config: a valid stored one, else the default. Never
 * throws, never half-applies a corrupt store.
 * @returns {object}
 */
export function loadSpriteConfig() {
  try {
    const raw = globalThis.localStorage?.getItem(SPRITE_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return validateSpriteConfig(parsed) ?? DEFAULT_SPRITE_CONFIG;
  } catch {
    return DEFAULT_SPRITE_CONFIG;
  }
}

/** @param {object} config a config that came out of validateSpriteConfig */
export function saveSpriteConfig(config) {
  try {
    globalThis.localStorage?.setItem(SPRITE_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Remembering is a convenience; failing to remember is not an error. (A
    // data:-URL sheet can also exceed the storage quota — Export still works.)
  }
}

/** Forget the stored config, returning to the committed default. */
export function resetSpriteConfig() {
  try {
    globalThis.localStorage?.removeItem(SPRITE_CONFIG_KEY);
  } catch {
    // Nothing to do; the default applies either way.
  }
}
