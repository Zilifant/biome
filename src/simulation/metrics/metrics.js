/**
 * Evolutionary observation (Step 21) — making Milestone E legible.
 *
 * Everything here is *derived*: it reads the population and computes summaries,
 * and writes nothing back. No organism state is touched, no behaviour changes.
 * That is the whole contract — selection has to emerge from survival and
 * reproduction, and a metrics layer that nudged anything would be measuring
 * itself.
 *
 * Two things are worth explaining because they are easy to get subtly wrong:
 *
 *   - **Rates are derived from state, not from events.** Births in a window are
 *     the animals young enough to have been born inside it; deaths are the
 *     carcasses stamped with a `diedTick` inside it. Reading the event bus
 *     instead would couple metrics to retention (events are bounded and get
 *     trimmed) and would double-count on replay.
 *   - **The selection differential** is the classic one: the mean trait among
 *     adults that actually reproduced, minus the mean among all adults. A
 *     positive value means breeders are above average for that trait, which is
 *     selection *in progress* rather than a claim about what will happen. It is
 *     computed, never scripted.
 *
 * Everything is O(N) in the population — one pass, no pairwise work — and every
 * output is bounded: fixed bins per histogram, fixed traits per species.
 */
import { SPECIES } from '../config/species/index.js';
import { TRAIT_NAMES } from '../traits/traits.js';
import { genotypeOf } from '../traits/genetics.js';

/** Bins per trait histogram, and the range they span. */
export const HISTOGRAM_BINS = 9;
export const HISTOGRAM_MIN = 0.5;
export const HISTOGRAM_MAX = 1.5;

/**
 * Bucket values into fixed bins. Renderer-neutral: counts plus the range they
 * cover, never glyphs or widths.
 * @param {number[]} values
 */
export function histogram(values) {
  const bins = new Array(HISTOGRAM_BINS).fill(0);
  const span = (HISTOGRAM_MAX - HISTOGRAM_MIN) / HISTOGRAM_BINS;
  for (const value of values) {
    const index = Math.floor((value - HISTOGRAM_MIN) / span);
    bins[Math.min(HISTOGRAM_BINS - 1, Math.max(0, index))] += 1;
  }
  return { min: HISTOGRAM_MIN, max: HISTOGRAM_MAX, bins };
}

/** Mean, spread, and extremes of a sample. Empty samples report nulls. */
export function describe(values) {
  if (values.length === 0) return { count: 0, mean: null, stdev: null, min: null, max: null };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const mean = sum / values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  return { count: values.length, mean, stdev: Math.sqrt(variance / values.length), min, max };
}

/**
 * Aggregate the whole population into a metrics report.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} options
 * @param {number} options.tick
 * @param {number} options.windowTicks how far back births/deaths are counted
 * @returns {object} plain, JSON-safe aggregates
 */
export function computeMetrics(world, { tick, windowTicks }) {
  /** @type {Map<string, object>} */
  const bySpecies = new Map();
  const ensure = (speciesId) => {
    let bucket = bySpecies.get(speciesId);
    if (!bucket) {
      bucket = {
        speciesId,
        living: 0,
        lifeStages: { juvenile: 0, subadult: 0, adult: 0, senescent: 0 },
        generations: [],
        offspringCounts: [],
        traitValues: Object.fromEntries(TRAIT_NAMES.map((name) => [name, []])),
        genotypeValues: Object.fromEntries(TRAIT_NAMES.map((name) => [name, []])),
        // Adults, split by whether they have actually reproduced — the two
        // samples a selection differential is the difference between.
        breederTraits: Object.fromEntries(TRAIT_NAMES.map((name) => [name, []])),
        adultTraits: Object.fromEntries(TRAIT_NAMES.map((name) => [name, []])),
        births: 0,
        deaths: 0,
        deathsByCause: {},
      };
      bySpecies.set(speciesId, bucket);
    }
    return bucket;
  };

  let carcasses = 0;
  const windowStart = tick - windowTicks;

  for (const entity of world.entities.all()) {
    const bucket = ensure(entity.speciesId);

    if (entity.kind === 'carcass') {
      carcasses += 1;
      if (entity.diedTick !== null && entity.diedTick > windowStart) {
        bucket.deaths += 1;
        const cause = entity.deathCause ?? 'unknown';
        bucket.deathsByCause[cause] = (bucket.deathsByCause[cause] ?? 0) + 1;
      }
      continue;
    }
    if (entity.kind !== 'animal' || !entity.alive) continue;

    bucket.living += 1;
    if (entity.lifeStage in bucket.lifeStages) bucket.lifeStages[entity.lifeStage] += 1;
    bucket.generations.push(entity.generation);
    bucket.offspringCounts.push(entity.offspring.length);
    // Young enough to have been born inside the window.
    if (entity.age < windowTicks) bucket.births += 1;

    const genotype = genotypeOf(entity.genome);
    for (const name of TRAIT_NAMES) {
      bucket.traitValues[name].push(entity.traits[name]);
      bucket.genotypeValues[name].push(genotype[name]);
      if (entity.lifeStage === 'adult' || entity.lifeStage === 'senescent') {
        bucket.adultTraits[name].push(entity.traits[name]);
        if (entity.offspring.length > 0) bucket.breederTraits[name].push(entity.traits[name]);
      }
    }
  }

  const species = [...bySpecies.values()]
    .sort((a, b) => (a.speciesId < b.speciesId ? -1 : a.speciesId > b.speciesId ? 1 : 0))
    .map((bucket) => ({
      speciesId: bucket.speciesId,
      diet: SPECIES[bucket.speciesId]?.diet ?? null,
      living: bucket.living,
      lifeStages: { ...bucket.lifeStages },
      generation: describe(bucket.generations),
      reproductiveSuccess: describe(bucket.offspringCounts),
      births: bucket.births,
      deaths: bucket.deaths,
      deathsByCause: { ...bucket.deathsByCause },
      traits: Object.fromEntries(
        TRAIT_NAMES.map((name) => [
          name,
          {
            phenotype: describe(bucket.traitValues[name]),
            genotype: describe(bucket.genotypeValues[name]),
            histogram: histogram(bucket.traitValues[name]),
            // Positive ⇒ the animals that bred are above the adult average for
            // this trait. Null when nothing has bred yet — an honest "unknown"
            // rather than a misleading zero.
            selectionDifferential: selectionDifferential(bucket.breederTraits[name], bucket.adultTraits[name]),
          },
        ]),
      ),
    }));

  return {
    tick,
    windowTicks,
    totalEntities: world.entities.count,
    carcasses,
    species,
  };
}

/** Mean among breeders minus mean among all adults, or null if unknowable. */
function selectionDifferential(breeders, adults) {
  if (breeders.length === 0 || adults.length === 0) return null;
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  return mean(breeders) - mean(adults);
}

/**
 * The handful of scalars worth keeping a time series of, extracted from a full
 * report. Kept deliberately small: a bounded history of *everything* would be
 * the "complete tick-by-tick history" the observation roadmap forbids.
 * @param {object} report
 */
export function summarizeForHistory(report) {
  return {
    tick: report.tick,
    species: report.species.map((entry) => ({
      speciesId: entry.speciesId,
      living: entry.living,
      generation: entry.generation.mean,
      traits: Object.fromEntries(TRAIT_NAMES.map((name) => [name, entry.traits[name].phenotype.mean])),
    })),
  };
}
