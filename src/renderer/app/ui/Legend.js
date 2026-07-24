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
  HURT_COLOR_TOKEN,
  SICK_COLOR_TOKEN,
} from '../rendering/EntityAppearance.js';

/**
 * @typedef {object} LegendEntry
 * @property {string} glyph
 * @property {string} colorToken
 * @property {string} label
 * @property {string} [note] why it looks like that, when that is not obvious
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
    const young = appearance.glyph;
    const grown = appearance.glyph.toUpperCase();
    animals.push({
      glyph: young === grown ? young : `${young}/${grown}`,
      colorToken: appearance.colorToken,
      label: appearance.label,
      note: young === grown ? '' : 'young / grown',
    });
  }
  animals.push({
    glyph: KIND_APPEARANCE.animal.glyph,
    colorToken: KIND_APPEARANCE.animal.colorToken,
    label: 'unmapped species',
    note: 'a species this renderer predates',
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

  const remains = CARCASS_DECAY_APPEARANCE.map((appearance, stage) => ({
    glyph: appearance.glyph,
    colorToken: appearance.colorToken,
    label: appearance.label,
    note: stage === 0 ? 'rots as it ages' : '',
  }));

  const memories = Object.entries(MEMORY_APPEARANCE).map(([kind, appearance]) => ({
    glyph: appearance.glyph,
    colorToken: appearance.colorToken,
    label: `remembered ${kind}`,
  }));

  return [
    { title: 'Animals', entries: animals },
    { title: 'Age & sex', entries: SEX_AGE_ENTRIES },
    { title: 'Condition', entries: CONDITION_ENTRIES },
    { title: 'Remains', entries: remains },
    { title: 'Ground', entries: ground },
    { title: 'Forage', entries: forage },
    { title: 'Worn ground', entries: worn },
    { title: 'Disturbances', entries: events },
    { title: 'Selected animal only', entries: [...memories, ...OVERLAY_ENTRIES] },
  ];
}

/**
 * Tints and marks that are not glyphs of their own. These are the one part of
 * the legend written by hand, because they describe how a glyph is *coloured*
 * or *bracketed* rather than which glyph is drawn — there is no registry entry
 * to read them from. The colour tokens still come from the appearance module.
 * @type {LegendEntry[]}
 */
const CONDITION_ENTRIES = Object.freeze([
  { glyph: '▪', colorToken: HURT_COLOR_TOKEN, label: 'hurt', note: 'below 70% health' },
  { glyph: '▪', colorToken: SICK_COLOR_TOKEN, label: 'visibly ill', note: 'a carrier looks healthy' },
]);

/**
 * The two per-animal display channels, written by hand because they describe how
 * a species glyph is *cased and styled* rather than which glyph is drawn — there
 * is no registry entry to read them from. Case is age, italic is sex; the grazer
 * glyph stands in as the example. See EntityAppearance.resolveAppearance.
 * @type {LegendEntry[]}
 */
const SEX_AGE_ENTRIES = Object.freeze([
  { glyph: 'g/G', colorToken: 'yellow', label: 'young / grown', note: 'lowercase / UPPERCASE' },
  { glyph: 'g', colorToken: 'yellow', label: 'female', note: 'italic', italic: true },
]);

/** @type {LegendEntry[]} */
const OVERLAY_ENTRIES = Object.freeze([
  { glyph: '[]', colorToken: 'bright-yellow', label: 'selected' },
  { glyph: '[]', colorToken: 'cyan', label: 'followed' },
  { glyph: '[]', colorToken: 'red', label: 'hunted by this animal' },
  { glyph: '[]', colorToken: 'pink', label: 'its guardian and offspring' },
  { glyph: '[]', colorToken: 'comment', label: 'its groupmates' },
  { glyph: '+', colorToken: 'purple', label: 'its home range', note: 'ring at the range radius' },
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
            <span class="legend-label">${entry.label}${entry.note ? ` <span class="dim">${entry.note}</span>` : ''}</span>`,
            )
            .join('')}
        </div>`,
      )
      .join('');
    container.innerHTML = `
      <details class="inspector-section legend-root">
        <summary><span class="section-title">Legend</span> <span class="section-badge">what the glyphs mean</span></summary>
        <div class="section-body">${groups}</div>
      </details>`;
  }
}
