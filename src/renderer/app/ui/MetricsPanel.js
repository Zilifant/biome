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

/**
 * Blocks used to draw a histogram bar, lightest to fullest.
 *
 * ⚠ **The empty rung belongs to histograms only** — see `TREND_LEVELS`. It is a
 * NO-BREAK SPACE (U+00A0), not a plain space, and it has to stay one. A histogram is a single word as far as the browser is
 * concerned, and an ordinary space in the middle of it is a line-break
 * opportunity — so a bar with an empty bin wrapped there and the second half of
 * the distribution appeared on the next line, silently misreading as two bars.
 * It is the same advance width in a monospace font, so nothing about the
 * alignment changes.
 */
export const BAR_LEVELS = ['\u00a0', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * The rungs a **sparkline** may use: the same ramp without its blank.
 *
 * ⚠ **A histogram has a zero and a sparkline does not**, and sharing one ramp
 * between them made the trends lie. A bin with no animals in it should be blank
 * — that is what `BAR_LEVELS[0]` is for — but every column of a trend *has* a
 * sample, and scaling `min → max` onto a ramp whose bottom rung is blank drew
 * the window's minimum as empty space. A steady population came out as a line
 * of nothing (`min === max`, so every sample is the minimum), and `41,41,41,40`
 * came out as `███ `, where losing one animal of 41 is indistinguishable from
 * the species disappearing.
 *
 * So a trend's lowest sample is `▁` and blank never appears in one. A flat
 * series draws a flat `▁▁▁▁`, which reads as "no change" rather than as no
 * population.
 */
export const TREND_LEVELS = Object.freeze(BAR_LEVELS.slice(1));

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

/**
 * Sparkline of one scalar across the bounded history, at most `width`
 * characters wide.
 *
 * ⚠ **A sparkline is one character per sample, so its width is the history's
 * length — which is a number this panel does not choose.** At 120 samples it is
 * 120 columns of unbreakable block characters in a 300px column: it ran past
 * the edge, took the species name and the living count with it, and got worse
 * every time the column was narrowed. So the series is *resampled* to the space
 * available rather than drawn one-to-one.
 *
 * **Downsampled by bucket mean, not truncated to the last N.** The whole point
 * of the row is the shape of the whole history — a population that doubled and
 * crashed reads as that at any width, where the most recent 30 samples read as
 * whatever the last few minutes did. Fewer samples than columns is the other
 * case, early in a run: those are drawn one-to-one and simply end, leaving the
 * rest of the line empty rather than stretching four points across the column.
 *
 * @param {Array<number | undefined>} values
 * @param {number} width columns available, from the panel's own measurement
 * @returns {string}
 */
export function drawTrend(values, width = Infinity) {
  const usable = values.filter((v) => typeof v === 'number');
  if (usable.length < 2 || width < 2) return '';
  const samples = usable.length <= width ? usable : bucketMeans(usable, Math.floor(width));
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min || 1;
  // ⚠ TREND_LEVELS, not BAR_LEVELS: a sparkline has no zero, so its lowest
  // sample is the shortest *visible* bar rather than a blank.
  return samples
    .map((v) => TREND_LEVELS[Math.min(TREND_LEVELS.length - 1, Math.round(((v - min) / span) * (TREND_LEVELS.length - 1)))])
    .join('');
}

/**
 * `values` reduced to exactly `count` numbers, each the mean of its bucket.
 *
 * Buckets are laid out by proportion rather than by a fixed size, so the last
 * one is never a short remainder — `history % width` is almost never zero, and
 * a final bucket averaging two samples where the others average five is a spike
 * at the right-hand end of every chart.
 * @param {number[]} values @param {number} count
 * @returns {number[]}
 */
function bucketMeans(values, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * values.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / count));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += values[j];
    out.push(sum / (end - start));
  }
  return out;
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

/**
 * Horizontal space a sparkline cannot use: the section's own padding either
 * side, plus a character's worth of slack so a rounding error cannot be what
 * pushes a line past the edge.
 */
const TREND_GUTTER_PX = 20;

/** Enough columns to be a chart at all; below this the row draws none. */
const MIN_TREND_COLUMNS = 8;

export class MetricsPanel {
  #container;
  /** @type {Set<string>} */
  #openSpecies = loadOpenSpecies();
  /** The last report, so a column resize can re-render without a fresh poll. */
  #report = null;
  /** Columns the sparklines were last drawn at, so a resize is a no-op unless it changes them. */
  #columns = 0;
  /** Measured width of one monospace character, in CSS pixels. */
  #charWidth = 0;

  /** @param {HTMLElement} container */
  constructor(container) {
    this.#container = container;
    container.innerHTML = '<h2>Population</h2><p class="hint">Waiting for metrics…</p>';
    // ⚠ The panel is re-rendered when its *column* changes width, not only when
    // the metrics poll lands — a drag would otherwise leave the charts at the
    // old width for up to the poll interval. Guarded on the character count
    // rather than the pixel width, so the render happens once per column of
    // change instead of once per pointer move, and so a height change (a
    // section opening) cannot trigger one at all.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (this.#report && this.#trendColumns() !== this.#columns) this.render(this.#report);
      }).observe(container);
    }
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
   * How many characters of sparkline fit across this column right now.
   *
   * ⚠ Measured, not assumed. The column is user-resizable and the font is
   * whatever the platform's `ui-monospace` resolves to, so the only honest
   * answer comes from the browser — and a probe is cheap because the width of
   * one character is a constant per font, cached after the first render that
   * finds the panel laid out.
   */
  #trendColumns() {
    if (this.#charWidth === 0) this.#charWidth = this.#measureCharWidth();
    if (this.#charWidth === 0) return 0;
    const available = this.#container.clientWidth - TREND_GUTTER_PX;
    const columns = Math.floor(available / this.#charWidth);
    return columns >= MIN_TREND_COLUMNS ? columns : 0;
  }

  /**
   * The advance width of one block character, measured with a hidden probe.
   *
   * ⚠ The block glyphs, not a digit: a sparkline is drawn in `▁▂▃`, and a font
   * that renders those at a different advance than `0` would leave every chart
   * mis-measured by the difference. Returns 0 when the panel is not laid out
   * yet (a collapsed column, a hidden tab), which reads as "do not draw one
   * yet" rather than as a wrong number.
   */
  #measureCharWidth() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px';
    probe.textContent = '█'.repeat(40);
    this.#container.append(probe);
    const width = probe.getBoundingClientRect().width / 40;
    probe.remove();
    return width > 0 ? width : 0;
  }

  /**
   * @param {{available: boolean, metrics: object|null, history: object[]} | null} report
   *        the last `metrics` query response, if any
   */
  render(report) {
    this.#report = report;
    if (!report?.available || !report.metrics) {
      this.#container.innerHTML =
        '<h2>Population</h2><p class="hint">Metrics appear once the simulation has run a little.</p>';
      return;
    }
    const { metrics, history = [] } = report;
    const historyBySpecies = indexHistory(history);
    // One measurement for the whole render. The population chart gets the
    // column; the in-row charts share a line with numbers, so they get a third
    // of it — enough to read a direction, never enough to push the row it sits
    // in past the edge, which is the same defect one click deeper.
    const columns = this.#trendColumns();
    this.#columns = columns;
    const inlineColumns = Math.floor(columns / 3);

    const sections = metrics.species
      .map((species) => {
        const series = historyBySpecies.get(species.speciesId) ?? [];
        const trendFor = (trait) => drawTrend(series.map((sample) => sample.traits?.[trait]), inlineColumns);
        const populationTrend = drawTrend(series.map((sample) => sample.living), columns);

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
              inlineColumns,
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
            )}</span> <span class="section-badge">${species.living} alive</span>${
              populationTrend ? `<span class="metrics-trend dim">${populationTrend}</span>` : ''
            }</summary>
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
