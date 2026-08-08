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
        // ⚠⚠ **Whether animals can actually take the steps they commit to**
        // (2026-08-06), and this block exists because its absence cost a species.
        // A cohesion change packed wildebeest tighter than
        // `locomotion.maxOccupantsPerCell` permits; **37.5%** of their steps were
        // refused against 4.7% before it, they starved standing on forage, and the
        // population fell 57% — with no metric, no event and no failing test
        // anywhere in the engine, because nothing had ever reported a refusal. The
        // sweep gate passed it: every species was alive at the final checkpoint.
        //
        // Three counters, because they answer three different questions and the
        // third is the one that is easy to lose. `committed` is how many animals
        // asked to move at all; `refused` is how many were turned around by
        // terrain, a thicket edge or a full cell; `crowdLocked` is how many were so
        // hemmed in by other animals that the decision system did not commit a step
        // in the first place — those never reach `committed`, so a jam that the
        // crowd-lock branch handles would otherwise show up as the refusal rate
        // going *down*.
        committed: 0,
        refused: 0,
        crowdLocked: 0,
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
    // ⚠ Read from the intent the movement system has already resolved this tick —
    // this system runs in the `observation` phase and movement in `movement`, so
    // `refused` is this tick's answer rather than last tick's. ⚠ A refused intent
    // is still a committed one (`moving` stays true through the turn-around), so
    // `refused` is a subset of `committed` and the fraction below is well formed.
    const intent = entity.moveIntent;
    if (intent?.moving === true) bucket.committed += 1;
    if (intent?.refused === true) bucket.refused += 1;
    if (intent?.crowdLocked === true) bucket.crowdLocked += 1;
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
      // ⚠ **A rate at this sample tick, not a total over the run** — the same
      // instantaneous reading `living` and `grouped` beside it are, and for the
      // same reason: nothing here holds per-animal history. `refusedFraction` is
      // null rather than 0 when nothing committed a step, because "no animal tried
      // to move" and "every animal moved freely" are opposite facts and a zero
      // would report the first as the second.
      //
      // ⚠ **What healthy looks like, measured on the demo (seed 2, t2000–4200):**
      // 3–5% refused for every species. The regression this block was added for ran
      // wildebeest at **37.5%**, so the signal is nearly an order of magnitude clear
      // of the noise — unlike the two detectors A83 measured and declined to build,
      // where the headroom was 0.017.
      locomotion: {
        committed: bucket.committed,
        refused: bucket.refused,
        crowdLocked: bucket.crowdLocked,
        refusedFraction: bucket.committed > 0 ? bucket.refused / bucket.committed : null,
      },
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
    // Persistent groups (v29). ⚠ Not the `grouping` block on each species above
    // — that summarizes *herd labels*, which are positional and recomputed every
    // tick. This is the record store: how many prides or clans exist and how big
    // they are, how tightly they hold together, and whether the store is full.
    // ⚠ The sentence that used to close this comment — "zero in every world
    // today, because no shipped species forms one" — has been false since the
    // hyena arrived at phase 7; four species form records now (lion, hyena,
    // zebra, buffalo). See `groupMetrics` for the rest.
    groups: world.groups ? groupMetrics(world) : null,
    species,
  };
}

/**
 * The persistent-group store, summarized (v29; spread and capacity added at
 * BEHAVIOR-PLAN P10).
 *
 * ⚠ **Cohesion is a number here, not an impression.** `spread` is the mean
 * distance of a record's living members from that record's centre, averaged over
 * records — so a band that is walking as a body and one that has scattered across
 * forty units report differently, which nothing else in this world says. Bounded
 * by `maxGroups × maxMembers`, so it is a small fixed walk however large the
 * population gets.
 *
 * ⚠ The centre is the **plain** mean, where `GroupSystem#rally` steers at a
 * leadership-weighted variant of the same point. Weighting it here would make a
 * cohesion figure move with `config.groups.leadWeight`, which is a knob about a
 * different mechanism — the same reasoning that puts the plain mean in the
 * inspection block. ⚠ And it is derived here rather than read out of
 * `world.groupCentres`: that map is only rebuilt when `groups.rallyEnabled`, so
 * reading it would report nothing at all on the rally's own control arm.
 *
 * ⚠⚠ **`capacity` and `saturated` exist because the cap was silent.** At the cap
 * `found()` returns null and `#joinOrFound` returns, with no event, no metric and
 * no log — so a bound that binds does not look like a bound, it looks like the
 * feature intermittently not working (DOCS §9, and the open thread P5b left). This
 * is the metric that ends that. **It is a sample, and says so**: metrics run every
 * `updateInterval` ticks, so a store that fills and empties between two samples is
 * not counted. That is the stated limit rather than a claim of completeness —
 * counting *refusals* would need a cumulative counter, which is history rather than
 * state and would read differently after a restore. Peak concurrent records
 * measured 2026-08-06 is 37 against a cap of 192, so this reads `false` today,
 * which is the correct answer and is now checkable instead of assumed.
 *
 * Aggregates only, never a membership list: that would be the per-organism record
 * §11 rules out, and the inspector already answers the one-animal question.
 *
 * @param {import('../world/World.js').World} world
 */
function groupMetrics(world) {
  const records = world.groups.all();
  const spreads = [];
  for (const record of records) {
    let sumX = 0;
    let sumY = 0;
    const members = [];
    for (const id of record.memberIds) {
      const member = world.entities.get(id);
      // Living members only — a record is reconciled once per tick, so averaging
      // in a body that died this tick would measure where the band used to be.
      if (!member || member.kind !== 'animal' || !member.alive) continue;
      members.push(member);
      sumX += member.x;
      sumY += member.y;
    }
    // ⚠ A record of one is skipped rather than counted as a spread of 0. The
    // distance of an animal from itself is not a cohesion reading, and records do
    // sit at one member — `dissolveGraceTicks` holds a short record for 300 ticks
    // on purpose — so counting them would drag the mean toward zero exactly when
    // bands are falling apart, which is backwards.
    if (members.length < 2) continue;
    const centreX = sumX / members.length;
    const centreY = sumY / members.length;
    let total = 0;
    for (const member of members) total += Math.hypot(member.x - centreX, member.y - centreY);
    spreads.push(total / members.length);
  }
  return {
    count: world.groups.size,
    // The structural bound and whether this sample is against it.
    capacity: world.groups.maxGroups,
    saturated: world.groups.full,
    members: records.reduce((total, record) => total + record.memberIds.length, 0),
    size: describe(records.map((record) => record.memberIds.length)),
    // `count` includes records of one; this does not, so the two denominators are
    // reported rather than left to be assumed equal.
    spread: describe(spreads),
    // Per species, so "the clans are hyena clans" is answerable without
    // walking a roster. Ascending id order, like everything else here.
    bySpecies: records.reduce((counts, record) => {
      counts[record.speciesId] = (counts[record.speciesId] ?? 0) + 1;
      return counts;
    }, {}),
    // ⚠⚠ **Mean members per record, per species** (v36, PREDATOR-PLAN P8). The
    // count above says how many clans there are and this says how big they are,
    // which are different questions and the second one is the one P2 is judged by:
    // its rule solves clan *size* from the founder count and aims at 8–12, and a
    // roster that quietly drifted to pairs would read identically in `bySpecies`.
    //
    // ⚠ A separate map rather than a richer `bySpecies`, deliberately: the
    // renderer's metrics panel reads `bySpecies[id]` as a number, and changing its
    // shape to add a field would break a consumer to save a key.
    //
    // ⚠⚠ **Peak concurrent records is *not* here and is not an oversight.** It is
    // history rather than state — a maximum over time cannot be recomputed from the
    // world, so it would have to be accumulated and persisted, and would then read
    // differently after a restore. That is the same reason `saturated` above is a
    // sample rather than a count of refusals, stated in DOCS §9. Take a peak by
    // sampling this metric over a run, which is what a sweep already does.
    meanSizeBySpecies: (() => {
      const sums = {};
      for (const record of records) {
        const entry = (sums[record.speciesId] ??= { total: 0, records: 0 });
        entry.total += record.memberIds.length;
        entry.records += 1;
      }
      const means = {};
      for (const [speciesId, entry] of Object.entries(sums)) means[speciesId] = entry.total / entry.records;
      return means;
    })(),
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
