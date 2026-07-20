/**
 * Heredity (Step 20) — what Step 14's phenotype seam was built for.
 *
 * Step 14 gave every animal a set of trait multipliers sampled fresh around the
 * species mean. This replaces that sampling with **inheritance**: an animal now
 * carries a genome, its traits are *expressed* from that genome, and its
 * offspring get their genome from their parents. Nothing downstream changed —
 * every system still reads `entity.traits` exactly as before — which is the
 * whole point of having put the seam in early.
 *
 * The model, deliberately the simplest thing that makes recombination mean
 * something:
 *
 *   - **Diploid, one locus per trait.** Each locus holds two alleles, both
 *     plain numbers centred on 1.
 *   - **Additive expression.** The raw value of a trait is the mean of its two
 *     alleles, so a heterozygote sits between its parents rather than picking a
 *     side. No dominance — that is a different model, not a missing feature.
 *   - **Independent assortment.** A child takes one allele per locus from each
 *     parent, chosen independently per locus. That is real recombination:
 *     siblings differ.
 *   - **Mutation** perturbs an inherited allele by a small step.
 *
 * And crucially, **tradeoffs**. Without them selection has nothing to push
 * against and every trait would simply ratchet toward its maximum: bigger,
 * faster, bolder, all at once, forever. Expression therefore charges some
 * traits against others (see `TRADEOFFS`), so a genome coding for a huge animal
 * expresses less speed than the same speed genotype would give at average size.
 * You cannot have everything.
 *
 * Nothing here is a *system*. Inheritance happens at one instant — the moment
 * of birth — and the reproduction system already owns that instant, so this is
 * a module it calls rather than a scheduled pass that would have to hunt for
 * newborns.
 */
import { TRAIT_NAMES, NEUTRAL_TRAITS } from './traits.js';

/** Loci, one per heritable trait. Same order as TRAIT_NAMES → determinism. */
export const GENOME_LOCI = TRAIT_NAMES;

/**
 * Antagonistic pairs. `trait` is scaled down as `against` rises above average,
 * so investment in one is paid for out of the other.
 *
 * These are the three that are biologically legible and that the existing
 * systems already make matter:
 *   - mass costs speed (a bigger animal is slower for the same genotype)
 *   - speed costs efficiency (a fast animal runs hot)
 *   - boldness costs caution (you cannot be both reckless and careful)
 */
export const TRADEOFFS = Object.freeze([
  Object.freeze({ trait: 'speed', against: 'size', strength: 0.5 }),
  Object.freeze({ trait: 'metabolicEfficiency', against: 'speed', strength: 0.4 }),
  Object.freeze({ trait: 'caution', against: 'boldness', strength: 0.6 }),
]);

/** An allele can never reach zero — several traits divide by their value. */
const MIN_ALLELE = 0.05;
/** Expressed traits are clamped to the same floor for the same reason. */
const MIN_TRAIT = 0.05;

/** The genome of an exactly average individual: every allele at 1. */
export const NEUTRAL_GENOME = Object.freeze(
  Object.fromEntries(GENOME_LOCI.map((locus) => [locus, Object.freeze([1, 1])])),
);

/**
 * Sample a founding genome — an animal with no parents. Both alleles at each
 * locus are drawn independently around the species mean, using the same
 * triangular shape Step 14 used for traits, so a founding population looks
 * exactly as it did before heredity existed.
 *
 * Fixed draw budget: 4 per locus (two alleles × two draws each).
 *
 * @param {import('../random/SeededRandom.js').SeededRandom} random the `genetics` stream
 * @param {Record<string, number>} spread half-width per locus
 * @returns {Record<string, [number, number]>}
 */
export function sampleGenome(random, spread = {}) {
  const genome = {};
  for (const locus of GENOME_LOCI) {
    const width = spread[locus] ?? 0;
    genome[locus] = [drawAllele(random, width), drawAllele(random, width)];
  }
  return genome;
}

/** One allele: triangular around 1, so extremes are rare. Two draws. */
function drawAllele(random, width) {
  const triangular = random.next() + random.next() - 1; // (-1, 1), peaked at 0
  return Math.max(MIN_ALLELE, 1 + triangular * width);
}

/**
 * Build a child's genome from its parents.
 *
 * One allele per locus from each parent, picked independently — so two children
 * of the same pair are not clones of each other — then each inherited allele
 * gets a chance to mutate. A single-parent birth (no mate recorded) draws both
 * alleles from that one parent.
 *
 * Fixed draw budget: 4 per locus (two picks, two mutation rolls), whatever
 * happens, so the `genetics` stream never shifts with the outcome.
 *
 * @param {Array<Record<string, [number, number]>>} parentGenomes one or two
 * @param {import('../random/SeededRandom.js').SeededRandom} random the `genetics` stream
 * @param {object} [options]
 * @param {number} [options.mutationRate] chance an inherited allele mutates
 * @param {number} [options.mutationStep] largest single mutation
 * @returns {Record<string, [number, number]>}
 */
export function inheritGenome(parentGenomes, random, { mutationRate = 0.08, mutationStep = 0.12 } = {}) {
  const sources = parentGenomes.filter(Boolean);
  if (sources.length === 0) return structuredClone(NEUTRAL_GENOME);
  const first = sources[0];
  const second = sources[1] ?? sources[0];

  const genome = {};
  for (const locus of GENOME_LOCI) {
    const fromFirst = pickAllele(first[locus], random.next());
    const fromSecond = pickAllele(second[locus], random.next());
    genome[locus] = [
      mutate(fromFirst, random.next(), mutationRate, mutationStep),
      mutate(fromSecond, random.next(), mutationRate, mutationStep),
    ];
  }
  return genome;
}

/** One of a parent's two alleles at a locus. */
function pickAllele(pair, roll) {
  if (!Array.isArray(pair) || pair.length === 0) return 1;
  return roll < 0.5 ? pair[0] : (pair[1] ?? pair[0]);
}

/**
 * Perturb an allele if the roll falls inside the mutation window. The
 * magnitude is read off where in that window the roll landed, so one draw
 * decides both whether and how much — keeping the budget fixed.
 */
function mutate(allele, roll, mutationRate, mutationStep) {
  if (roll >= mutationRate || mutationRate <= 0) return allele;
  const position = roll / mutationRate; // 0…1 within the window
  return Math.max(MIN_ALLELE, allele + (position - 0.5) * 2 * mutationStep);
}

/**
 * Express a genome as the trait multipliers every system already reads.
 *
 * Two stages: additive expression (the mean of each locus's alleles), then the
 * tradeoffs, which charge some traits against others. The tradeoffs are applied
 * from the *raw* values rather than sequentially, so the order of the table
 * cannot change the result.
 *
 * @param {Record<string, [number, number]>} genome
 * @returns {Record<string, number>} phenotype, the `traits` record
 */
export function expressGenome(genome) {
  if (!genome) return { ...NEUTRAL_TRAITS };

  const raw = {};
  for (const locus of GENOME_LOCI) {
    const pair = genome[locus];
    raw[locus] = Array.isArray(pair) && pair.length > 0 ? (pair[0] + (pair[1] ?? pair[0])) / 2 : 1;
  }

  const traits = { ...raw };
  for (const { trait, against, strength } of TRADEOFFS) {
    if (!(trait in traits)) continue;
    traits[trait] = Math.max(MIN_TRAIT, raw[trait] * (1 - strength * (raw[against] - 1)));
  }
  return traits;
}

/**
 * The raw, pre-tradeoff values a genome codes for. Inspection-only: showing
 * genotype beside phenotype is what makes a tradeoff legible rather than a
 * mysterious discrepancy.
 * @param {Record<string, [number, number]>} genome
 */
export function genotypeOf(genome) {
  const raw = {};
  for (const locus of GENOME_LOCI) {
    const pair = genome?.[locus];
    raw[locus] = Array.isArray(pair) && pair.length > 0 ? (pair[0] + (pair[1] ?? pair[0])) / 2 : 1;
  }
  return raw;
}
