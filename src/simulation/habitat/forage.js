/**
 * Forage guilds — grass maturity as a preference (PLAN-SPECIES.md §3.3, phase 9).
 *
 * Until now "food" was a single number per cell: biomass, and more of it was
 * always better. That is enough for one grazer and hopeless for three. The real
 * Serengeti pattern is a **grazing succession** — zebra crop the tall coarse
 * sward, wildebeest take the regrowth behind them, gazelle take the short green
 * flush behind *them* — and each tier's feeding is what creates the next tier's
 * habitat. Two species that eat the same grass at the same rate in the same
 * places do not coexist (§2); two that want different *maturities* of the same
 * grass do.
 *
 * ⚠ **The maturity axis costs no new state at all**, which is why this is the best
 * cost-to-realism trade in the plan: **standing crop is maturity.** A cell holding
 * a lot of biomass is tall, rank, low-quality grass; a cell holding little is
 * short, freshly regrowing, high-quality forage. No new grid, no new field, no
 * save-format change, and — because every consumer already reads `biomassAt` — not
 * one extra grid read.
 *
 * ⚠⚠ **PLAN-SPECIES §3.3 proposed the *ratio* `biomass / capacity` instead, and
 * that version was built, measured, and rejected.** The reasoning for the ratio was
 * good (it normalizes away per-cell fertility, so a rich cell and a poor one both
 * freshly cropped read alike) and it failed for a reason the plan could not have
 * seen: a ratio knows nothing about absolute abundance, so **in a low-capacity
 * world every ungrazed cell reads as rank grass**. The sparse-forage selection
 * sandbox (`vegetation.capacity: 1.0`) holds at most one biomass unit per cell —
 * genuinely a lawn — and under the ratio the gazelle discounted the only food in
 * that world and went **extinct inside 5000 ticks**, breaking a shipped scenario
 * (`test/metrics.test.js`). Standing crop degrades the safe way instead: a poor
 * world has no coarse grass in it, so nothing is discounted.
 *
 * It is also the physically truer proxy. Two cells holding the same standing crop
 * are the same height of grass whatever their potential; the ratio insisted one of
 * them was rank because its ceiling was lower.
 *
 * ⚠ **This makes forage preference NON-MONOTONIC in biomass for the first time**,
 * and everything that assumed "more grass is better" had to be checked. Two
 * readers existed; they were treated differently on purpose:
 *
 *   - **The migration forage gradient is rescored through this module.** It
 *     samples a ring of directions and steers toward the better ground, so left
 *     against raw biomass it would aim a short-grass grazer at exactly the rank
 *     sward it does not want — the animal would oscillate. ⚠ Only its
 *     *direction* is scored: see `forageGradient` for why scoring the strength
 *     too inverted the animal's motivation.
 *   - **Perception's nearest-food scan is deliberately left monotonic.** It
 *     answers "the nearest cell with something on it", and turning it into "the
 *     best-scoring cell nearby" would mean scoring every candidate rather than
 *     only cells nearer than the best so far — in the hottest loop in the engine,
 *     which D28 records costing 12% of a tick for one extra *argument*. So an
 *     animal still walks to the nearest grass and then decides whether it is
 *     worth eating, which is the same shallow-perception bargain the
 *     nearest-carcass rule already makes.
 *
 * **Preference is a discount, never a veto.** `quality` bottoms out at
 * `qualityFloor` rather than 0, so the worst-matched grass in the world is still
 * worth something and a starving animal still eats it — the utility it multiplies
 * is scaled by hunger, so preference decides where a *comfortable* animal grazes
 * and hunger overrides it. A hard window would have produced a species that
 * starves standing on food in a green spring, which is not a preference, it is a
 * cliff.
 *
 * ⚠ **A species that states no `forage` field is exactly unaffected** — the
 * quality is `1`, no vegetation cell is read, and no arithmetic happens (D16).
 * The world-level off switch is `config.forage.enabled`, and it deliberately does
 * **not** live in the `feeding` species block: a species block *beats* the config
 * (DOCS §8), so an off switch inside one cannot switch anything off. That is the
 * trap phase 8 fell into with `aging.hiddenUntil` and it is why `forage` is an
 * always-per-species field beside a global section, following `migration` and
 * `groups` rather than the block pattern.
 */

/** Quality of a cell to an animal with no maturity preference. Exactly 1. */
export const NEUTRAL_QUALITY = 1;

/**
 * Falloff span used when a species names a `preferredBiomass` and no span. Wide
 * rather than narrow: a guild boundary is a gradient, and a narrow one is how you
 * get an animal that refuses almost every cell in the world.
 */
export const DEFAULT_SPAN = 4;

/**
 * The maturity preference of a species, or null when it has none.
 *
 * Reads the always-per-species `forage` field, in the shape of `migrationOf` and
 * `territoryOf`. A species that omits it — or names no `preferredBiomass` — gets
 * null, which every consumer below treats as the identity.
 *
 * `span` is named after `matePreference.span` and means the same thing: the
 * deviation at which the signal saturates.
 *
 * @param {{forage?: {preferredBiomass?: number|null, span?: number}}} [species]
 * @returns {{preferredBiomass: number, span: number} | null}
 */
export function forageOf(species) {
  const forage = species?.forage;
  const preferredBiomass = forage?.preferredBiomass;
  if (typeof preferredBiomass !== 'number') return null;
  const span = forage.span ?? DEFAULT_SPAN;
  return span > 0 ? { preferredBiomass, span } : null;
}

/**
 * How well a cell's grass maturity suits this animal, in `[floor, 1]`.
 *
 * **One-sided: grass at or below `preferredBiomass` is ideal, and quality falls off
 * only above it**, reaching the floor `span` further on. So the axis is really a
 * *tolerance of coarse growth* — how tall and rank a sward this animal can still
 * make a living on — with a zebra tolerant of nearly anything and a gazelle of very
 * little.
 *
 * ⚠ **A symmetric window was built first and measured worse.** It read better on
 * paper — a mown lawn has no bite for a gazelle either — and it was wrong twice
 * over:
 *
 *   - **It double-counts scarcity.** A nearly-bare cell already gives an animal
 *     almost nothing, because `consumeAt` can only return the biomass that is
 *     there. Discounting the *utility* of eating on it as well charges the animal
 *     twice for one fact.
 *   - **It punished exactly the ground a food-limited world lives on.** Measured
 *     2026-07-29: with the two-sided window the demo gazelle sat at quality ~0.53
 *     for most of its life, because a herd grazes its own patch down and then
 *     stands in the halo — and the ten-seed gate came back **3/10 seeds** for the
 *     gazelle against 10/10 for the control, taking the stalker and the hyena down
 *     with it.
 *
 * The other half of the succession does not need the low side at all, which is
 * what makes one-sidedness a modelling gain rather than a compromise: a 300 kg
 * zebra cannot live on a cropped sward because **mass-scaled intake** already says
 * so — its per-tick appetite is larger than a short cell can supply — so the
 * engine expresses "too big for this pasture" without a preference term.
 *
 * ⚠ **Season needs no term here, and that is a consequence of using standing crop
 * rather than a ratio.** Winter lowers the ceiling the whole field grows toward, so
 * every cell holds less and the world genuinely *is* shorter — a low-preference
 * grazer is content in winter, which is right, and the countervailing fact that
 * there is less of it is already carried by the biomass itself.
 *
 * @param {number} biomass standing crop of the cell, in biomass units
 * @param {{preferredBiomass: number, span: number} | null} preference
 * @param {number} floor quality of the coarsest forage (`config.forage.qualityFloor`)
 * @returns {number}
 */
export function forageQuality(biomass, preference, floor) {
  if (preference === null) return NEUTRAL_QUALITY;
  const excess = biomass - preference.preferredBiomass;
  if (excess <= 0) return NEUTRAL_QUALITY;
  const offset = excess / preference.span;
  return NEUTRAL_QUALITY - (NEUTRAL_QUALITY - floor) * (offset > 1 ? 1 : offset);
}

/**
 * `forageQuality` for a cell, reading the standing crop from the vegetation field.
 *
 * ⚠ Returns 1 **without touching the grid** when the species has no preference,
 * so a roster that states none pays exactly nothing — the same identity discipline
 * as `predation`'s null ratios.
 *
 * @param {import('../world/World.js').World} world
 * @param {number} cellX @param {number} cellY
 * @param {{preferredBiomass: number, span: number} | null} preference
 * @param {number} floor
 * @returns {number}
 */
export function forageQualityAt(world, cellX, cellY, preference, floor) {
  if (preference === null) return NEUTRAL_QUALITY;
  return forageQuality(world.vegetation.biomassAt(cellX, cellY), preference, floor);
}
