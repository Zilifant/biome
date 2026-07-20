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
 */

/** Trait rows worth showing; the rest are available in the raw query. */
const SHOWN_TRAITS = ['size', 'speed', 'metabolicEfficiency', 'boldness'];

/** Blocks used to draw a histogram bar, lightest to fullest. */
const BAR_LEVELS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

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

export class MetricsPanel {
  #container;

  /** @param {HTMLElement} container */
  constructor(container) {
    this.#container = container;
    container.innerHTML = '<h2>Population</h2><p class="hint">Waiting for metrics…</p>';
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
    const { metrics, history } = report;

    const sections = metrics.species
      .map((species) => {
        const trendFor = (trait) =>
          drawTrend(history.map((sample) => sample.species.find((s) => s.speciesId === species.speciesId)?.traits[trait]));
        const populationTrend = drawTrend(
          history.map((sample) => sample.species.find((s) => s.speciesId === species.speciesId)?.living),
        );

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

        return `
          <h3>${escapeHtml(species.speciesId)} <span class="dim">${species.living} alive ${populationTrend}</span></h3>
          ${sexes}
          <div class="field"><span>generation</span><span>mean ${species.generation.mean?.toFixed(2) ?? '–'} <span class="dim">max ${species.generation.max ?? '–'}</span></span></div>
          <div class="field"><span>offspring each</span><span>mean ${species.reproductiveSuccess.mean?.toFixed(2) ?? '–'} <span class="dim">max ${species.reproductiveSuccess.max ?? '–'}</span></span></div>
          <div class="field"><span>births / deaths</span><span>${species.births} / ${species.deaths} <span class="dim">last ${metrics.windowTicks}t</span></span></div>
          ${traitRows}`;
      })
      .join('');

    this.#container.innerHTML = `
      <h2>Population <span class="dim">t${metrics.tick}</span></h2>
      ${sections}
      <p class="hint">histogram spans ${metrics.metricsRange ?? '0.5–1.5'} · S = breeder mean − adult mean, then by sex</p>`;
  }
}
