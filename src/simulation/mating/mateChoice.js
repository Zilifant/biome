/**
 * Mate choice and sexual selection (Step 22).
 *
 * Two things land here, and the first one is a modelling decision the plan
 * explicitly left open: **this simulation has sexes.**
 *
 * Until now either adult could initiate and the lower entity id carried the
 * pregnancy (§1.4 A9) — an arbitrary rule that worked only because nothing
 * cared who was who. Sexual selection cares. It needs an *asymmetry in
 * reproductive investment*: one sex whose output is limited by resources and
 * time (it gestates, it provisions, it can raise only so many young) and one
 * whose output is limited by access to the first. Without that asymmetry there
 * is no principled reason for either party to be choosy, and "mate choice"
 * degenerates into two animals filtering each other for no stake. So:
 *
 *   - **Females gestate, and therefore females choose.** The cost of a bad
 *     mate is a whole gestation for her and one mating for him.
 *   - **Males are the seeking sex.** Cheap matings, a short refractory period,
 *     and a lower energy bar to clear — so at any moment most males are
 *     available and most females are not, which is what makes females the
 *     scarce resource males effectively compete for.
 *
 * Notice what that does to the birth rate: nothing, to first order. Under the
 * old rule a mating consumed *both* adults for a full cooldown to produce one
 * pregnancy; now it consumes one female and leaves the male free, so the number
 * of pregnancies per adult per cooldown is unchanged. What does change is that
 * a female now needs a *male* in range rather than any adult — which is exactly
 * the pressure that makes choosing matter.
 *
 * The second thing is the preference itself, split deliberately in two:
 *
 *   - **What is preferred is a species fact** (`species.matePreference`) — the
 *     displayed trait, how sharply it discriminates, and how much plain
 *     condition counts. Data on the species, read generically, so no system
 *     branches on a species name.
 *   - **How hard it is weighed is the individual's heritable `choosiness`** —
 *     so the *strength* of sexual selection evolves rather than being asserted
 *     by a constant I picked.
 *
 * And choosiness costs. A female who rejects what is in front of her keeps
 * burning energy, keeps aging, and keeps being huntable, all while not
 * pregnant. That cost is made concrete by a **declining acceptance threshold**:
 * her standard starts high and falls to nothing over `patienceTicks`, so a
 * choosy animal waits longer for a better mate and a very choosy one may run
 * out of season entirely. This is the classic sequential-search rule, and it is
 * what keeps the mechanism from deadlocking a small population: nobody holds
 * out forever, they just hold out for different lengths of time.
 *
 * Nothing here is a system. Assessment happens at the instant two animals are
 * in range, and the reproduction system already owns that instant — same
 * convention as `killAnimal`, `recordMemory`, `applyInjury`, `inheritGenome`.
 * There is no randomness: quality is a pure function of traits and condition.
 */
import { SEXES } from '../../protocol/commands.js';

/** @type {{FEMALE: 'female', MALE: 'male'}} */
export const Sexes = Object.freeze({ FEMALE: 'female', MALE: 'male' });

/**
 * The sex that carries the pregnancy — and therefore the sex that chooses.
 * A single model-wide fact rather than species data: declaring it per species
 * when every species would set it identically is the "over-generalized
 * abstraction" the risk register warns about. Step 29 can make it data if a
 * species ever needs the other answer.
 */
export const GESTATING_SEX = Sexes.FEMALE;

/** All valid sexes, single-sourced from the protocol vocabulary. */
export const SEX_VALUES = SEXES;

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Draw a sex. One draw, on its own stream, so adding sex determination never
 * shifted the `genetics` sequence.
 * @param {import('../random/SeededRandom.js').SeededRandom} random the `sex` stream
 */
export function drawSex(random) {
  return random.next() < 0.5 ? Sexes.FEMALE : Sexes.MALE;
}

/** Whether this animal is the sex that gestates, and so the one that assesses. */
export function isChooser(entity) {
  return entity?.sex === GESTATING_SEX;
}

/**
 * The mate preference of a species, or null if it declares none (in which case
 * every candidate is judged on condition alone).
 * @param {string} speciesId
 */
export function matePreferenceFor(species) {
  return species?.matePreference ?? null;
}

/**
 * How good a mate this candidate is, in 0…1, where 0.5 is an exactly average
 * individual in average condition.
 *
 * Two halves, and the split is the point. The **signal** is the species'
 * displayed trait relative to the species mean (traits centre on 1.0), and the
 * **condition** is the body actually carrying it — energy, health, and freedom
 * from injury. Condition is what keeps the signal honest: a starving, mauled
 * animal is a poor bet however good its genes, and an animal cannot fake being
 * well fed. There are no ornaments as separate state (explicitly out of scope);
 * the display is a trait the rest of the simulation already makes matter.
 *
 * @param {object} candidate
 * @param {{trait?: string|null, span?: number, conditionWeight?: number}|null} preference
 * @returns {number} 0…1
 */
export function mateQuality(candidate, preference) {
  const { trait = null, span = 0.3, conditionWeight = 0.4 } = preference ?? {};
  // Displayed trait, mapped so that a deviation of `span` saturates the scale.
  const displayed = trait ? (candidate.traits?.[trait] ?? 1) : 1;
  const signal = span > 0 ? clamp01(0.5 + (displayed - 1) / (2 * span)) : 0.5;
  const energy = candidate.maxEnergy > 0 ? candidate.energy / candidate.maxEnergy : 0;
  const health = candidate.maxHealth > 0 ? candidate.health / candidate.maxHealth : 0;
  const sound = 1 - clamp01(candidate.impairment ?? 0);
  const condition = clamp01((energy + health + sound) / 3);
  return clamp01((1 - conditionWeight) * signal + conditionWeight * condition);
}

/**
 * The quality a chooser insists on right now.
 *
 * Starts at `baseThreshold × choosiness` when she becomes receptive and falls
 * linearly to zero over `patienceTicks`. That decline *is* the cost model: the
 * longer she holds out, the more of her breeding window she has spent, so being
 * choosy buys a better mate with time she cannot get back. It also guarantees
 * the mechanism degrades gracefully — in a population where every male is poor,
 * everyone still eventually breeds rather than the species quietly going
 * extinct on a threshold I chose.
 *
 * @param {object} chooser
 * @param {number} tick
 * @param {{baseThreshold: number, patienceTicks: number}} params
 * @returns {number} 0…1
 */
export function acceptanceThreshold(chooser, tick, { baseThreshold, patienceTicks }) {
  const standard = baseThreshold * (chooser.traits?.choosiness ?? 1);
  if (patienceTicks <= 0) return clamp01(standard);
  const since = chooser.mateSearchSince;
  const waited = since === null || since === undefined ? 0 : Math.max(0, tick - since);
  return clamp01(standard * Math.max(0, 1 - waited / patienceTicks));
}

/**
 * Pick the most attractive of a set of candidates, discounted by how far away
 * each one is — a slightly better mate two cells further off is worth walking
 * to, a much better one across the meadow is not.
 *
 * Used by the decision system to steer (`seekMate` heads for the best perceived
 * candidate, not merely the nearest), which is where mate choice actually
 * becomes *visible*: a female walks past a scrawny neighbour toward a better
 * animal, and pays for it in the distance she covers.
 *
 * Deterministic: strictly-greater comparison over a distance-then-id ordered
 * candidate list, so ties resolve to the lowest entity id.
 *
 * @param {Array<{id: number, distance: number}>} candidates from perception
 * @param {(id: number) => object|null} resolve entity lookup
 * @param {object} options
 * @param {object|null} options.preference
 * @param {number} options.distanceWeight quality forfeited per unit of distance
 * @param {boolean} options.assess false ⇒ take the nearest (the seeking sex)
 * @returns {{candidate: object, quality: number, distance: number}|null}
 */
export function bestMateCandidate(candidates, resolve, { preference, distanceWeight, assess }) {
  let best = null;
  let bestScore = -Infinity;
  for (const seen of candidates) {
    const candidate = resolve(seen.id);
    if (!candidate) continue;
    const quality = mateQuality(candidate, preference);
    // The seeking sex does not assess — it closes on whatever is nearest, which
    // is the behavioural face of the same asymmetry.
    const score = assess ? quality - distanceWeight * seen.distance : -seen.distance;
    if (score > bestScore) {
      bestScore = score;
      best = { candidate, quality, distance: seen.distance };
    }
  }
  return best;
}
