/**
 * Individual variation (Step 14) — the phenotype seam.
 *
 * Every animal carries a fixed set of trait multipliers, sampled once when it
 * comes into existence and never written again. Each is centred on 1.0, so a
 * trait of 1.0 means "exactly the species average" and the whole system
 * degrades cleanly to the pre-Step-14 behaviour when traits are neutral.
 *
 * Every trait has a real consequence — none is decoration:
 *
 * | trait                  | what it changes                                    |
 * | ---------------------- | -------------------------------------------------- |
 * | size                   | adult body mass → metabolic cost, carcass mass      |
 * | speed                  | locomotion speed → foraging reach, movement cost    |
 * | metabolicEfficiency    | divides the energy burn → starvation resistance     |
 * | boldness               | roaming vs. resting → range covered vs. energy kept |
 * | caution                | how early hunger and thirst outweigh everything     |
 * | exploration            | how often it ignores its own utility ranking        |
 * | reproductiveInvestment | energy put into each offspring, and its cost        |
 * | choosiness             | how good a mate must be before it is accepted       |
 *
 * These are deliberately trade-offs rather than upgrades: a bold animal finds
 * more food and spends more energy; a heavily investing parent produces
 * better-provisioned young at a higher price per birth; a choosy one gets a
 * better mate but breeds later, and may not breed at all. Since Step 20 they
 * are inherited — expressed from a genome rather than sampled — while keeping
 * the same `traits` shape that systems already read.
 *
 * Ownership: `traits` is written once at creation and is read-only afterwards.
 */

/** Trait names, in a fixed order (sampling order → determinism). */
export const TRAIT_NAMES = Object.freeze([
  'size',
  'speed',
  'metabolicEfficiency',
  'boldness',
  'caution',
  'exploration',
  'reproductiveInvestment',
  // Mate choice (Step 22): the acceptance threshold multiplier. Unlike the
  // three antagonistic pairs in genetics.js, choosiness needs no artificial
  // tradeoff — its cost is behavioural (a choosy animal breeds later, or not at
  // all), which is a better brake than an arbitrary one.
  'choosiness',
]);

/**
 * The "exactly average" individual. Frozen and shared: every entity spawned
 * without explicit traits (hand-built test animals, externally submitted
 * `entity.spawn` commands) points at this one object, so the neutral case
 * costs no memory and cannot be mutated by accident.
 */
export const NEUTRAL_TRAITS = Object.freeze(Object.fromEntries(TRAIT_NAMES.map((name) => [name, 1])));

/** A multiplier can never reach zero — metabolic efficiency divides by it. */
const MIN_TRAIT = 0.05;

/**
 * Sample one individual's traits around the species average.
 *
 * Each trait takes two draws and sums them, giving a triangular distribution
 * peaked at 1.0: most individuals sit near the species mean and extremes are
 * rare, which is what "variation around a type" should look like. The draw
 * count is fixed (2 × TRAIT_NAMES.length) regardless of the values drawn, so
 * the stream stays deterministic.
 *
 * @param {import('../random/SeededRandom.js').SeededRandom} random the `traits` stream
 * @param {Record<string, number>} spread half-width per trait; missing → no variation
 * @returns {Record<string, number>}
 */
export function sampleTraits(random, spread = {}) {
  const traits = {};
  for (const name of TRAIT_NAMES) {
    const width = spread[name] ?? 0;
    const triangular = random.next() + random.next() - 1; // (-1, 1), peaked at 0
    traits[name] = Math.max(MIN_TRAIT, 1 + triangular * width);
  }
  return traits;
}
