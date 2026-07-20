/**
 * Migration and dispersal (Step 26) — movement at a larger scale than a step.
 *
 * The whole step turns on one decision, and it is a decision about *shape*
 * rather than about biology: **migration is not an action.** §1.4 A34 is the
 * evidence — Step 24's `patrol` gave animals a routine reason to move and cost
 * the demo two seeds in five, because any new movement action competes with
 * `wander`, and wandering is how a grazing animal finds its next meal. Step 25
 * took the lesson and implemented illness-avoidance as a *subtraction* from an
 * existing mechanism rather than a new one.
 *
 * So this step adds nothing to the utility table. Instead it **steers the
 * aimless ticks**: `wander` already picks a fresh random heading whenever its
 * commitment runs out, and that heading is the only thing migration touches.
 * The consequences are worth stating, because they are why this shape was
 * chosen:
 *
 *   - Foraging cannot lose. An animal that can *see* food still runs `seekFood`;
 *     one that remembers food still runs `recallFood`. Migration only ever
 *     replaces a *random* heading with a *directed* one, so it spends no tick
 *     that was doing anything useful.
 *   - At zero strength the behaviour is bit-identical to Step 25. The mechanism
 *     is off unless the world says otherwise, which makes it measurable against
 *     itself rather than against a re-tuned control.
 *   - Long-range movement comes from **commitment, not from range**. The cue is
 *     local and shallow; the wander commitment holds a heading for 8–24 ticks
 *     and re-picks the same direction while the gradient persists. A weak
 *     gradient integrated over a long walk carries an animal a long way, which
 *     is how an animal migrates without a map — and it is why no part of this
 *     file searches, plans, or routes (the step's explicit out-of-scope).
 *
 * Two drives, both expressed through that one channel:
 *
 *   1. **Forage gradient** — sample a fixed ring of directions, walk toward the
 *      better ground. Recolonization falls out of this rather than being built:
 *      an emptied region is ungrazed, so its biomass climbs back to capacity and
 *      it becomes the *best* thing on the compass. Nothing anywhere knows a
 *      region was emptied.
 *   2. **Natal dispersal** — a juvenile that has outgrown its guardian leaves,
 *      holding an outward heading for a bounded spell whatever the forage says.
 *      That override is the point: dispersal is not foraging, it is leaving.
 *
 * Randomness: **none at all.** Sampling is deterministic, and a dispersal
 * heading is derived from geometry (straight out from the natal centre), so this
 * step adds not one draw to any stream — the cheapest possible answer to the
 * fixed-draw-budget convention, and it means migration cannot shift another
 * system's sequence even in principle.
 */

const TWO_PI = Math.PI * 2;

/**
 * Directions sampled per habitat evaluation. Fixed and small: this is the
 * step's "bounded, no global search" guarantee expressed as a constant, so the
 * cost of an evaluation cannot vary with population, world size, or season.
 */
export const SAMPLE_DIRECTIONS = 8;

/**
 * Points sampled along each direction. Two rather than one because a single
 * cell at the end of a ray is a coin flip — the vegetation field is fertile per
 * cell, so one bare cell in a rich direction would read as a bare direction.
 * Sampling the midpoint too smooths the ray without making the evaluation
 * meaningfully dearer (16 O(1) grid reads, staggered).
 */
const SAMPLES_PER_RAY = 2;

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

/** The migration block of a species, or null if it declares none. */
export function migrationOf(species) {
  return species?.migration ?? null;
}

/**
 * The direction of better forage, judged from a fixed ring of samples.
 *
 * ⚠ **The modelling assumption, stated rather than buried.** `cueRadius` is
 * deliberately *beyond* the animal's perception radius, so this is not something
 * the animal can see — it stands in for the coarse long-range cues a real
 * grazer has and this world does not simulate (the smell of green ground, the
 * lie of the land, the direction other animals are coming from). It is the same
 * kind of honest convenience as Step 25's environmental spillover (§1.4 A39):
 * a cheap stand-in for a mechanism that is out of scope. Two things keep it from
 * becoming clairvoyance — the strength is a *difference*, so a flat world
 * produces no pull at all, and the caller caps it well below 1, so it biases a
 * wander rather than aiming it.
 *
 * Cost: `SAMPLE_DIRECTIONS × SAMPLES_PER_RAY` O(1) grid reads, no spatial query
 * of any kind. Deliberately *not* a neighbour walk — §1.4 C6 already owes Step
 * 30 the folding of perception and sociality, and this step does not add a
 * third one.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity
 * @param {object} options
 * @param {number} options.cueRadius how far out the coarse cue reaches
 * @param {number} options.reference biomass difference that counts as a full-strength signal
 * @returns {{heading: number, strength: number} | null} null when nowhere is better
 */
export function forageGradient(world, entity, { cueRadius, reference }) {
  if (!(cueRadius > 0) || !(reference > 0)) return null;

  const here = world.cellOf(entity.x, entity.y);
  const hereValue = world.vegetation.biomassAt(here.cellX, here.cellY);

  let bestValue = hereValue;
  let bestHeading = null;
  for (let i = 0; i < SAMPLE_DIRECTIONS; i += 1) {
    const heading = (i * TWO_PI) / SAMPLE_DIRECTIONS;
    const dx = Math.cos(heading);
    const dy = Math.sin(heading);
    let total = 0;
    for (let step = 1; step <= SAMPLES_PER_RAY; step += 1) {
      // Sample at cueRadius/2 and cueRadius. `cellOf` clamps to the grid, so a
      // ray pointing off the edge reads the edge cell — no invented wall, and
      // no invented attraction either.
      const distance = (cueRadius * step) / SAMPLES_PER_RAY;
      const cell = world.cellOf(entity.x + dx * distance, entity.y + dy * distance);
      total += world.vegetation.biomassAt(cell.cellX, cell.cellY);
    }
    const value = total / SAMPLES_PER_RAY;
    if (value > bestValue) {
      bestValue = value;
      bestHeading = heading;
    }
  }

  // Nowhere on the compass beats the ground underfoot: no pull. This is the
  // common case in a uniformly green spring, and it is why the mechanism costs
  // the demo nothing when there is nothing to migrate toward.
  if (bestHeading === null) return null;
  return { heading: bestHeading, strength: clamp01((bestValue - hereValue) / reference) };
}

/**
 * Begin natal dispersal — a shared mutation helper in the established pattern
 * (`killAnimal`, `recordLifeEvent`, `infect`), called by the parenting system at
 * the one instant a bond ends.
 *
 * Two things happen, and the second matters more than the first:
 *
 *   - the animal takes an outward heading, derived from geometry rather than
 *     drawn, so this costs no randomness: straight out from the centre of the
 *     range it grew up in. An animal sitting exactly on that centre has no
 *     outward direction, so it keeps the heading it already had;
 *   - its **home range is cleared**. That is what makes dispersal spatial rather
 *     than bookkeeping: Step 24's range is a running average of where an animal
 *     has been, so a juvenile that keeps its natal range spends its life being
 *     pulled back toward its mother's ground. Clearing it lets the range
 *     re-accumulate wherever the animal actually settles, which is the whole
 *     meaning of leaving home.
 *
 * The natal centre is not stored on the entity — it is recorded in the life
 * event by the caller, where it is already bounded and already inspectable.
 * Storing it here would be a second copy of a fact that has a home.
 *
 * @param {object} entity
 * @param {number} tick
 * @param {number} ticks how long the outward heading is held
 * @returns {{x: number, y: number} | null} the natal centre it is leaving, if it had one
 */
export function beginDispersal(entity, tick, ticks) {
  const natal = entity.homeRange ? { x: entity.homeRange.x, y: entity.homeRange.y } : null;
  if (!(ticks > 0)) return natal;

  const outward =
    natal && (natal.x !== entity.x || natal.y !== entity.y)
      ? Math.atan2(entity.y - natal.y, entity.x - natal.x)
      : (entity.moveIntent?.heading ?? entity.heading ?? 0);

  entity.dispersalHeading = normalizeAngle(outward);
  entity.dispersalUntil = tick + ticks;
  // Leaving home means no longer living there. The range rebuilds from the
  // first tick after this one, wherever the animal ends up.
  entity.homeRange = null;
  return natal;
}

/** Whether an animal is still holding its outward dispersal heading. */
export function isDispersing(entity, tick) {
  return entity.dispersalUntil !== null && tick < entity.dispersalUntil;
}

/**
 * Blend a heading toward a bias by weight, the short way around the circle.
 *
 * Interpolating the *vectors* rather than the angles is what makes this
 * correct at the wrap point: averaging 350° and 10° as numbers gives 180°,
 * which points exactly backwards.
 *
 * ⚠ The endpoints return their input **untouched**, and that is load-bearing
 * rather than tidy. The step's safety property is that at zero strength an
 * animal behaves exactly as it did at Step 25 — but a fed animal standing on a
 * real gradient carries a non-null heading at strength 0, so it does come
 * through here. Normalizing it returned 1.2000000000000002 for 1.2, a one-ulp
 * difference that is nonetheless a different heading, compounding over 15 000
 * ticks into a different run. Both callers already pass normalized angles (a
 * wander candidate is `random.next() * 2π`; a gradient heading is a fixed
 * fraction of 2π; a dispersal heading is normalized when it is stored), so
 * there is nothing to normalize at the endpoints anyway.
 *
 * @param {number} base @param {number} bias @param {number} weight 0…1
 */
export function blendHeadings(base, bias, weight) {
  const w = clamp01(weight);
  if (w <= 0) return base;
  if (w >= 1) return bias;
  const x = (1 - w) * Math.cos(base) + w * Math.cos(bias);
  const y = (1 - w) * Math.sin(base) + w * Math.sin(bias);
  // Exactly opposed headings at weight 0.5 cancel to a zero vector with no
  // meaningful direction; keep the base rather than returning atan2(0, 0).
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return normalizeAngle(base);
  return normalizeAngle(Math.atan2(y, x));
}
