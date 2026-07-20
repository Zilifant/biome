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
 *     computed, never scripted. Since Step 22 it is also reported **per sex**,
 *     and that split matters more than it looks: sexual selection acts on the
 *     sex being chosen, so pooling the sexes dilutes the very signal it is
 *     there to detect — every female breeds on her own condition regardless of
 *     the trait males are picked for, and averaging her in washes the effect
 *     out.
 *
 * Everything is O(N) in the population — one pass, no pairwise work — and every
 * output is bounded: fixed bins per histogram, fixed traits per species.
 */
import { TRAIT_NAMES } from '../traits/traits.js';
import { genotypeOf } from '../traits/genetics.js';
import { SEX_VALUES } from '../mating/mateChoice.js';
import { DiseaseStates } from '../disease/disease.js';

/**
 * The cohorts a selection differential is computed within: the whole adult
 * population, and each sex on its own.
 */
const COHORTS = Object.freeze(['all', ...SEX_VALUES]);

/** An empty {cohort: {trait: []}} sample store. */
function emptyCohortSamples() {
  return Object.fromEntries(
    COHORTS.map((cohort) => [cohort, Object.fromEntries(TRAIT_NAMES.map((name) => [name, []]))]),
  );
}

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
        sexes: Object.fromEntries(SEX_VALUES.map((sex) => [sex, 0])),
        // Herd structure (Step 23). Counting label occurrences is O(N) and
        // yields group sizes without anything ever holding a roster — the same
        // reason the social system can cap group size without one.
        grouped: 0,
        groupCounts: new Map(),
        // Home ranges (Step 24): the radii of animals that have settled one.
        rangeRadii: [],
        settled: 0,
        // Disease (Step 25): the compartment counts, which *are* the outbreak
        // curve. Kept per species because the two carry it independently.
        diseaseStates: Object.fromEntries(Object.values(DiseaseStates).map((state) => [state, 0])),
        // Adults, split by whether they have actually reproduced — the two
        // samples a selection differential is the difference between — and
        // again by sex, because that is the split sexual selection lives in.
        breederTraits: emptyCohortSamples(),
        adultTraits: emptyCohortSamples(),
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
    if (entity.sex !== null && entity.sex in bucket.sexes) bucket.sexes[entity.sex] += 1;
    if (entity.diseaseState in bucket.diseaseStates) bucket.diseaseStates[entity.diseaseState] += 1;
    if (entity.homeRange !== null) {
      bucket.settled += 1;
      bucket.rangeRadii.push(entity.homeRange.radius);
    }
    if (entity.groupId !== null) {
      bucket.grouped += 1;
      bucket.groupCounts.set(entity.groupId, (bucket.groupCounts.get(entity.groupId) ?? 0) + 1);
    }
    bucket.generations.push(entity.generation);
    bucket.offspringCounts.push(entity.offspring.length);
    // Young enough to have been born inside the window.
    if (entity.age < windowTicks) bucket.births += 1;

    const genotype = genotypeOf(entity.genome);
    const breeding = entity.lifeStage === 'adult' || entity.lifeStage === 'senescent';
    // Its own sex's cohort, when it has one; 'all' always.
    const cohorts = entity.sex !== null && COHORTS.includes(entity.sex) ? ['all', entity.sex] : ['all'];
    for (const name of TRAIT_NAMES) {
      bucket.traitValues[name].push(entity.traits[name]);
      bucket.genotypeValues[name].push(genotype[name]);
      if (!breeding) continue;
      for (const cohort of cohorts) {
        bucket.adultTraits[cohort][name].push(entity.traits[name]);
        if (entity.offspring.length > 0) bucket.breederTraits[cohort][name].push(entity.traits[name]);
      }
    }
  }

  const species = [...bySpecies.values()]
    .sort((a, b) => (a.speciesId < b.speciesId ? -1 : a.speciesId > b.speciesId ? 1 : 0))
    .map((bucket) => ({
      speciesId: bucket.speciesId,
      diet: world.species.get(bucket.speciesId)?.diet ?? null,
      living: bucket.living,
      lifeStages: { ...bucket.lifeStages },
      sexes: { ...bucket.sexes },
      // Herds, summarized rather than enumerated: how many animals are in one
      // at all, how many herds there are, and the size distribution. Never a
      // membership list — that would be a per-organism record, which the
      // observation roadmap rules out, and it does not exist to be listed.
      grouping: {
        grouped: bucket.grouped,
        solitary: bucket.living - bucket.grouped,
        groups: bucket.groupCounts.size,
        size: describe([...bucket.groupCounts.values()]),
      },
      // Territory (Step 24). Radii summarized, never the ranges themselves —
      // a per-animal centre list would be exactly the per-organism record the
      // observation roadmap rules out, and the inspector already serves the
      // one-animal question.
      homeRange: { settled: bucket.settled, radius: describe(bucket.rangeRadii) },
      disease: {
        ...bucket.diseaseStates,
        // Infectious ≠ symptomatic, and reporting only the visible count would
        // understate an outbreak by exactly the animals driving it.
        infectious: bucket.diseaseStates[DiseaseStates.INCUBATING] + bucket.diseaseStates[DiseaseStates.SYMPTOMATIC],
      },
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
            selectionDifferential: selectionDifferential(bucket.breederTraits.all[name], bucket.adultTraits.all[name]),
            // The same figure within each sex (Step 22). Sexual selection acts
            // on the chosen sex, so this is where a mate preference shows up —
            // and where it can be told apart from natural selection, which
            // moves both sexes together.
            selectionDifferentialBySex: Object.fromEntries(
              SEX_VALUES.map((sex) => [
                sex,
                selectionDifferential(bucket.breederTraits[sex][name], bucket.adultTraits[sex][name]),
              ]),
            ),
          },
        ]),
      ),
    }));

  return {
    tick,
    windowTicks,
    totalEntities: world.entities.count,
    carcasses,
    // How much of the world is spoken for, and by how many holders. Cheap
    // (one pass over a coarse grid) and world-level rather than per-species,
    // because the claim layer does not distinguish them.
    territory: world.scent ? world.scent.summary() : null,
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
      infectious: entry.disease.infectious,
    })),
  };
}
