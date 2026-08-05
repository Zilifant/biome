/**
 * The key to the grid.
 *
 * There are around two dozen distinct glyph meanings on screen — four terrain
 * types, a vegetation ramp, worn ground, disturbances, a carcass decay ramp,
 * three species (each with an age case and a sex style), and one animal's
 * remembered places — and until now nothing anywhere said what any of them
 * meant.
 *
 * **Generated from the appearance registries, never written out by hand.**
 * That is the whole design: `EntityAppearance.js` is the single source of
 * glyphs and colours, so a legend that reads from it cannot drift from what is
 * actually drawn, and adding a species updates the legend for free. A
 * hand-maintained legend would be wrong within one step.
 *
 * `describeLegend` is pure and returns plain data; only `LegendPanel` touches
 * the DOM.
 */
import {
  SPECIES_APPEARANCE,
  KIND_APPEARANCE,
  TERRAIN_APPEARANCE,
  VEGETATION_APPEARANCE,
  FEATURE_APPEARANCE,
  DISTURBANCE_APPEARANCE,
  CARCASS_DECAY_APPEARANCE,
  MEMORY_APPEARANCE,
  UNKNOWN_APPEARANCE,
  STATUS_APPEARANCE,
  SOCIAL_GROUP_APPEARANCE,
} from '../rendering/EntityAppearance.js';

/**
 * The character that stands in for each status-mark shape the canvas draws.
 *
 * Keyed by the registry's own `shape` values, so a new shape that forgets a row
 * here falls back to the dot rather than rendering `undefined` — and the legend
 * test, which compares every status's glyph against this table, is what says so
 * out loud.
 */
export const STATUS_SHAPE_GLYPHS = Object.freeze({ dot: '●', diamond: '◆', chevron: '»' });

/**
 * @typedef {object} LegendEntry
 * @property {string} glyph
 * @property {string} colorToken
 * @property {string} label
 * @property {boolean} [italic] render the glyph in italic (the female channel)
 */

/**
 * Every glyph the grid can draw, grouped for reading.
 * @returns {Array<{title: string, entries: LegendEntry[]}>}
 */
export function describeLegend() {
  /** @type {LegendEntry[]} */
  const animals = [];
  for (const [, appearance] of Object.entries(SPECIES_APPEARANCE)) {
    // Age is drawn by letter case (lowercase young, UPPERCASE grown), so a
    // species is shown as both — which is what makes a herd's age structure
    // readable at a glance. The base glyph is the lowercase form.
    //
    // ⚠ No note beside it. "young / grown" against every one of ten species is
    // the same sentence ten times, and the `g/G` pair says it already — the
    // *explanation* has its own row in "Age & sex" below, which is where a
    // reader who does not recognize the pair will look.
    const young = appearance.glyph;
    const grown = appearance.glyph.toUpperCase();
    animals.push({
      glyph: young === grown ? young : `${young}/${grown}`,
      colorToken: appearance.colorToken,
      label: appearance.label,
    });
  }
  animals.push({
    glyph: KIND_APPEARANCE.animal.glyph,
    colorToken: KIND_APPEARANCE.animal.colorToken,
    label: 'unmapped species',
  });
  animals.push({
    glyph: UNKNOWN_APPEARANCE.glyph,
    colorToken: UNKNOWN_APPEARANCE.colorToken,
    label: UNKNOWN_APPEARANCE.label,
  });

  const ground = Object.entries(TERRAIN_APPEARANCE)
    // `unknown` and `outOfBounds` are fallbacks rather than terrain a viewer
    // needs to recognize; the edge of the world explains itself.
    .filter(([name]) => name !== 'unknown' && name !== 'outOfBounds')
    .map(([name, appearance]) => ({ glyph: appearance.glyph, colorToken: appearance.colorToken, label: name }));

  const forage = VEGETATION_APPEARANCE.flatMap((appearance, level) =>
    appearance ? [{ glyph: appearance.glyph, colorToken: appearance.colorToken, label: `forage ${level}` }] : [],
  );

  const worn = Object.entries(FEATURE_APPEARANCE).map(([kind, appearance]) => ({
    glyph: appearance.glyph,
    colorToken: appearance.colorToken,
    label: kind,
  }));

  const events = Object.entries(DISTURBANCE_APPEARANCE).map(([kind, appearance]) => ({
    glyph: appearance.glyph,
    colorToken: appearance.colorToken,
    label: kind,
  }));

  const remains = CARCASS_DECAY_APPEARANCE.map((appearance) => ({
    glyph: appearance.glyph,
    colorToken: appearance.colorToken,
    label: appearance.label,
  }));

  // Statuses are marks in the corner of a cell rather than glyphs, so the legend
  // stands in the nearest character for the shape the canvas draws. Generated
  // from the registry for the same reason everything else here is: a status
  // added to the grid and forgotten in the legend is a mark nobody can read.
  //
  // ⚠ `»` is an approximation and the only one in this panel: the canvas draws
  // that character's pair of chevrons **rotated to point up**, and a legend row
  // is text, which cannot rotate. It is the right approximation anyway — it is
  // the character the mark is derived from, and the colour beside it is what a
  // viewer actually matches against the grid.
  const statuses = STATUS_APPEARANCE.map((status) => ({
    glyph: STATUS_SHAPE_GLYPHS[status.shape] ?? STATUS_SHAPE_GLYPHS.dot,
    colorToken: status.colorToken,
    label: status.label,
  }));

  // The social layer's outlines. `▢` for a rounded box, because that is what the
  // canvas draws — a solid rounded outline around a group of animals, where the
  // selection's `[]` brackets are four corner arms around one cell. The two use
  // the same design language deliberately, so the character has to distinguish
  // them: a whole box for a whole group, corners for a single cell.
  //
  // ⚠ Every kind is listed, including the ones no shipped species forms yet
  // (`family`, and the `group` fallback). The registry is what the grid draws
  // from, and a legend that filtered it by today's roster would need editing
  // every time the roster moved — the same reason the species rows list all ten.
  const social = Object.values(SOCIAL_GROUP_APPEARANCE).map((appearance) => ({
    glyph: '▢',
    colorToken: appearance.colorToken,
    label: appearance.label,
  }));

  const memories = Object.entries(MEMORY_APPEARANCE).map(([kind, appearance]) => ({
    glyph: appearance.glyph,
    colorToken: appearance.colorToken,
    label: `remembered ${kind}`,
  }));

  return [
    { title: 'Animals', entries: animals },
    { title: 'Age & sex', entries: SEX_AGE_ENTRIES },
    { title: 'Status', entries: statuses },
    { title: 'Remains', entries: remains },
    { title: 'Ground', entries: ground },
    { title: 'Forage', entries: forage },
    { title: 'Worn ground', entries: worn },
    { title: 'Disturbances', entries: [...events, ...MOMENT_ENTRIES] },
    { title: 'Social layer', entries: social },
    { title: 'Selected animal only', entries: [...memories, ...OVERLAY_ENTRIES] },
  ];
}

/**
 * The two per-animal display channels, written by hand because they describe how
 * a species glyph is *cased and styled* rather than which glyph is drawn — there
 * is no registry entry to read them from. Case is age, italic is sex; the gazelle
 * glyph stands in as the example. See EntityAppearance.resolveAppearance.
 * @type {LegendEntry[]}
 */
const SEX_AGE_ENTRIES = Object.freeze([
  { glyph: 'g/G', colorToken: 'yellow', label: 'young / grown' },
  // ⚠ Both cases here too, and italic. The row is a *sample of the same thing*
  // the row above shows — one `g` read as "the female form is the young one",
  // which is the one reading the two channels being independent rules out.
  { glyph: 'g/G', colorToken: 'yellow', label: 'female', italic: true },
]);

/**
 * Marks that are a filled *cell* rather than a glyph, so there is no registry
 * to read them from. `█` stands in for the fill.
 * @type {LegendEntry[]}
 */
const MOMENT_ENTRIES = Object.freeze([{ glyph: '█', colorToken: 'red', label: 'killed here, this tick' }]);

/** @type {LegendEntry[]} */
const OVERLAY_ENTRIES = Object.freeze([
  { glyph: '[]', colorToken: 'bright-yellow', label: 'selected' },
  { glyph: '[]', colorToken: 'cyan', label: 'followed' },
  { glyph: '[]', colorToken: 'red', label: 'hunted by this animal' },
  { glyph: '[]', colorToken: 'pink', label: 'its guardian and offspring' },
  { glyph: '[]', colorToken: 'comment', label: 'its groupmates' },
  { glyph: '+', colorToken: 'purple', label: 'its home range' },
]);

export class LegendPanel {
  /** @param {HTMLElement} container */
  constructor(container) {
    const groups = describeLegend()
      .map(
        (group) => `
        <h3>${group.title}</h3>
        <div class="legend-grid">
          ${group.entries
            .map(
              (entry) => `
            <span class="legend-glyph" style="color: var(--dracula-${entry.colorToken})${entry.italic ? '; font-style: italic' : ''}">${entry.glyph}</span>
            <span class="legend-label">${entry.label}</span>`,
            )
            .join('')}
        </div>`,
      )
      .join('');
    container.innerHTML = `
      <details class="inspector-section legend-root" open>
        <summary><span class="section-title">Legend</span> <span class="section-badge">what the glyphs mean</span></summary>
        <div class="section-body">${groups}</div>
      </details>`;
  }
}
