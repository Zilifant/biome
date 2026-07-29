/**
 * Population metrics panel (protocol v20).
 *
 * Presentation only. Every number here is computed by the engine's metrics
 * query — this file decides how to draw a histogram, not what the distribution
 * is. It performs no ecological arithmetic of its own beyond scaling bars to
 * the widest bin, which is a layout concern.
 *
 * Metrics are fetched on an interval rather than pushed per tick: histograms
 * for every trait of every species would dwarf the entity array in a per-tick
 * payload, and a summary view does not need tick resolution.
 *
 * **One collapsed `<details>` per species.** The panel renders a full section
 * per species — trait histograms, herds, disease, home range — which reads
 * fine at three species and makes the sidebar unusable at ten
 * (PLAN-SPECIES §7). Collapsed, each species is one line: its grid glyph, its
 * name, how many are alive, and the population trend — which is the overview
 * the panel never had. The open-set is remembered, exactly as the inspector's
 * sections are.
 */

import { SPECIES_APPEARANCE, KIND_APPEARANCE, speciesLabel } from '../rendering/EntityAppearance.js';

/** Trait rows worth showing; the rest are available in the raw query. */
const SHOWN_TRAITS = ['size', 'speed', 'metabolicEfficiency', 'boldness'];

/** Blocks used to draw a histogram bar, lightest to fullest. */
const BAR_LEVELS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Species a viewer has expanded, remembered across reloads. */
const OPEN_SPECIES_KEY = 'biome.metrics.openSpecies';

/**
 * Read the remembered open-set. Presentation state, so it lives in localStorage
 * rather than the store — and a browser that refuses storage must degrade to
 * "nothing expanded" rather than breaking the panel.
 * @returns {Set<string>}
 */
function loadOpenSpecies() {
  try {
    const raw = globalThis.localStorage?.getItem(OPEN_SPECIES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} open */
function saveOpenSpecies(open) {
  try {
    globalThis.localStorage?.setItem(OPEN_SPECIES_KEY, JSON.stringify([...open]));
  } catch {
    // Remembering is a convenience; failing to remember is not an error.
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One histogram as a row of blocks scaled to its own tallest bin. */
function drawHistogram(histogram) {
  const peak = Math.max(1, ...histogram.bins);
  return histogram.bins
    .map((count) => BAR_LEVELS[Math.min(BAR_LEVELS.length - 1, Math.round((count / peak) * (BAR_LEVELS.length - 1)))])
    .join('');
}

/** A signed value with a tone: positive is selection upward on that trait. */
function signed(value, digits = 3) {
  if (value === null || value === undefined) return '<span class="dim">–</span>';
  const tone = Math.abs(value) < 0.001 ? 'dim' : value > 0 ? 'ok' : 'warn';
  return `<span class="${tone}">${value >= 0 ? '+' : ''}${value.toFixed(digits)}</span>`;
}

/** Sparkline of one scalar across the bounded history. */
function drawTrend(values) {
  const usable = values.filter((v) => typeof v === 'number');
  if (usable.length < 2) return '';
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const span = max - min || 1;
  return usable
    .map((v) => BAR_LEVELS[Math.min(BAR_LEVELS.length - 1, Math.round(((v - min) / span) * (BAR_LEVELS.length - 1)))])
    .join('');
}

/**
 * The species' grid glyph, coloured as the grid colours it, so a row in this
 * panel and an animal on the map are recognizably the same thing. The base
 * (lowercase) form is used — case means age on the grid, and a population is
 * not an age. A species with no appearance entry falls back to the generic
 * animal glyph rather than vanishing.
 */
function speciesGlyph(speciesId) {
  const appearance = SPECIES_APPEARANCE[speciesId] ?? KIND_APPEARANCE.animal;
  return `<span class="metrics-glyph" style="color: var(--dracula-${appearance.colorToken})">${appearance.glyph}</span>`;
}

/**
 * Index the bounded history by species, once per render.
 *
 * ⚠ This exists to keep the panel linear in species count. The trends used to
 * be drawn with a `history.find(…)` *inside* a per-species, per-trait loop, so
 * the cost was `historyLength × species² × traits` — ~7.5k comparisons at three
 * species and ~84k at ten, on every render (PLAN-SPECIES §7). Samples that do
 * not mention a species are simply absent from its series, which is what the
 * old `undefined` slots amounted to: `drawTrend` discards non-numbers.
 *
 * Exported, unusually for a private detail of one panel, for the reason
 * `structureSignature` is: it *is* the mechanism, it is pure, and the repo has
 * no DOM test dependency — so a thing testable only through the panel is
 * effectively not testable at all.
 *
 * @param {Array<{species: Array<{speciesId: string}>}>} history
 * @returns {Map<string, object[]>}
 */
export function indexHistory(history) {
  const bySpecies = new Map();
  for (const sample of history) {
    for (const entry of sample.species ?? []) {
      const series = bySpecies.get(entry.speciesId);
      if (series) series.push(entry);
      else bySpecies.set(entry.speciesId, [entry]);
    }
  }
  return bySpecies;
}

export class MetricsPanel {
  #container;
  /** @type {Set<string>} */
  #openSpecies = loadOpenSpecies();

  /** @param {HTMLElement} container */
  constructor(container) {
    this.#container = container;
    container.innerHTML = '<h2>Population</h2><p class="hint">Waiting for metrics…</p>';
    // `toggle` does not bubble, so this listens in the capture phase — and on
    // the container, which survives the innerHTML rewrite every render does.
    container.addEventListener(
      'toggle',
      (event) => {
        const speciesId = event.target?.dataset?.species;
        if (!speciesId) return;
        if (event.target.open) this.#openSpecies.add(speciesId);
        else this.#openSpecies.delete(speciesId);
        saveOpenSpecies(this.#openSpecies);
      },
      true,
    );
  }

  /**
   * @param {{available: boolean, metrics: object|null, history: object[]} | null} report
   *        the last `metrics` query response, if any
   */
  render(report) {
    if (!report?.available || !report.metrics) {
      this.#container.innerHTML =
        '<h2>Population</h2><p class="hint">Metrics appear once the simulation has run a little.</p>';
      return;
    }
    const { metrics, history = [] } = report;
    const historyBySpecies = indexHistory(history);

    const sections = metrics.species
      .map((species) => {
        const series = historyBySpecies.get(species.speciesId) ?? [];
        const trendFor = (trait) => drawTrend(series.map((sample) => sample.traits?.[trait]));
        const populationTrend = drawTrend(series.map((sample) => sample.living));

        const traitRows = SHOWN_TRAITS.filter((trait) => species.traits[trait])
          .map((trait) => {
            const entry = species.traits[trait];
            const mean = entry.phenotype.mean;
            // The pooled differential, then the same figure within each sex —
            // which is the split that shows sexual selection, since a mate
            // preference moves only the sex being chosen while natural
            // selection moves both.
            const bySex = entry.selectionDifferentialBySex
              ? ` <span class="dim">f</span>${signed(entry.selectionDifferentialBySex.female, 2)}<span class="dim">/m</span>${signed(entry.selectionDifferentialBySex.male, 2)}`
              : '';
            return `<div class="field"><span>${escapeHtml(trait)}</span><span><span class="dim">${drawHistogram(entry.histogram)}</span> ${
              mean === null ? '–' : mean.toFixed(3)
            } <span class="dim">±${entry.phenotype.stdev?.toFixed(3) ?? '–'}</span> S ${signed(entry.selectionDifferential)}${bySex} <span class="dim">${trendFor(trait)}</span></span></div>`;
          })
          .join('');

        const sexes = species.sexes
          ? `<div class="field"><span>sexes</span><span>${species.sexes.female ?? 0} f / ${species.sexes.male ?? 0} m</span></div>`
          : '';
        // Herds are summarized, never listed — there is no roster in the engine
        // to list, and a membership list would be the per-organism record the
        // observation roadmap rules out.
        const grouping = species.grouping
          ? `<div class="field"><span>herds</span><span>${species.grouping.groups} <span class="dim">mean ${
              species.grouping.size.mean?.toFixed(1) ?? '–'
            }, max ${species.grouping.size.max ?? '–'} · ${species.grouping.solitary} alone</span></span></div>`
          : '';
        // ⚠ Persistent groups (v29) are a different mechanism from the herd
        // label above, so they get their own row rather than a second number on
        // that one: a herd is who this animal is standing with, a clan is who it
        // belongs to. Shown only for a species that has one — no shipped species
        // forms groups, so the row is absent everywhere today and appears by
        // itself the first time a clan-forming carnivore is founded.
        const clans = metrics.groups?.bySpecies?.[species.speciesId]
          ? `<div class="field"><span>clans</span><span>${metrics.groups.bySpecies[species.speciesId]} <span class="dim">persistent groups</span></span></div>`
          : '';

        const outbreak = species.disease
          ? `<div class="field"><span>disease</span><span>${species.disease.infectious} infectious <span class="dim">(${species.disease.symptomatic} visible) · ${species.disease.recovered} immune ${drawTrend(
              series.map((sample) => sample.infectious),
            )}</span></span></div>`
          : '';

        const ranges = species.homeRange
          ? `<div class="field"><span>home range</span><span>${species.homeRange.settled} settled <span class="dim">mean r ${
              species.homeRange.radius.mean?.toFixed(1) ?? '–'
            }</span></span></div>`
          : '';

        const open = this.#openSpecies.has(species.speciesId) ? ' open' : '';
        return `
          <details class="inspector-section" data-species="${escapeHtml(species.speciesId)}"${open}>
            <summary>${speciesGlyph(species.speciesId)} <span class="section-title">${escapeHtml(
              speciesLabel(species.speciesId),
            )}</span> <span class="section-badge">${species.living} alive ${populationTrend}</span></summary>
            <div class="section-body">
              ${sexes}
              ${grouping}
              ${clans}
              ${ranges}
              ${outbreak}
              <div class="field"><span>generation</span><span>mean ${species.generation.mean?.toFixed(2) ?? '–'} <span class="dim">max ${species.generation.max ?? '–'}</span></span></div>
              <div class="field"><span>offspring each</span><span>mean ${species.reproductiveSuccess.mean?.toFixed(2) ?? '–'} <span class="dim">max ${species.reproductiveSuccess.max ?? '–'}</span></span></div>
              <div class="field"><span>births / deaths</span><span>${species.births} / ${species.deaths} <span class="dim">last ${metrics.windowTicks}t</span></span></div>
              ${traitRows}
            </div>
          </details>`;
      })
      .join('');

    const territory = metrics.territory
      ? `<div class="field"><span>claimed ground</span><span>${Math.round((metrics.territory.claimed / metrics.territory.cells) * 100)}% <span class="dim">${metrics.territory.holders} holders</span></span></div>`
      : '';
    const groups = metrics.groups?.count
      ? `<div class="field"><span>groups</span><span>${metrics.groups.count} <span class="dim">${metrics.groups.members} members, mean ${
          metrics.groups.size?.mean?.toFixed(1) ?? '–'
        }</span></span></div>`
      : '';

    this.#container.innerHTML = `
      <h2>Population <span class="dim">t${metrics.tick}</span></h2>
      ${territory}
      ${groups}
      ${sections}
      <p class="hint">histogram spans ${metrics.metricsRange ?? '0.5–1.5'} · S = breeder mean − adult mean, then by sex</p>`;
  }
}
