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
 * Three drives, all expressed through that one channel:
 *
 *   1. **Forage gradient** — sample a fixed ring of directions, walk toward the
 *      better ground. Recolonization falls out of this rather than being built:
 *      an emptied region is ungrazed, so its biomass climbs back to capacity and
 *      it becomes the *best* thing on the compass. Nothing anywhere knows a
 *      region was emptied. ⚠ Since phase 9 the ring is scored through the species'
 *      **grass-maturity preference**, so "better ground" is no longer the same
 *      thing as "more grass" (`habitat/forage.js`).
 *   2. **Habitat gradient** (phase 9) — the same ring shape asking which *terrain*
 *      this species prefers, so an open-plain animal drifts out of cover. Its own
 *      function, because it is normalized in different units and throttled by a
 *      different thing; see `habitatGradient`.
 *   3. **Natal dispersal** — a juvenile that has outgrown its guardian leaves,
 *      holding an outward heading for a bounded spell whatever the forage says.
 *      That override is the point: dispersal is not foraging, it is leaving.
 *
 * Randomness: **none at all.** Sampling is deterministic, and a dispersal
 * heading is derived from geometry (straight out from the natal centre), so this
 * step adds not one draw to any stream — the cheapest possible answer to the
 * fixed-draw-budget convention, and it means migration cannot shift another
 * system's sequence even in principle.
 */

import { forageQuality } from '../habitat/forage.js';
import { habitatWeightForCode, wetnessWeight } from '../habitat/habitat.js';

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
 * @param {{preferredBiomass: number, span: number} | null} [options.forage]
 *        the species' grass-maturity preference (phase 9), or null for none
 * @param {number} [options.qualityFloor] worst-matched forage as a fraction of the best
 * @returns {{heading: number, strength: number} | null} null when nowhere is better
 */
export function forageGradient(world, entity, { cueRadius, reference, forage = null, qualityFloor = 0 }) {
  if (!(cueRadius > 0) || !(reference > 0)) return null;

  // Grass maturity (phase 9, PLAN-SPECIES.md §3.3). ⚠ **This is the reader the
  // plan warned about**: a gradient scored on raw biomass steers a short-grass
  // grazer at exactly the rank sward it does not want, and an animal steering
  // toward maximum biomass while preferring less of it oscillates.
  //
  // ⚠⚠ **The preference chooses the direction; raw biomass sets the strength**,
  // and the split is the correction of a first cut that scored both from
  // `biomass × quality`. That version inverted the animal's motivation: quality is
  // ≤ 1, so it *shrank* the difference between here and there, and an animal
  // surrounded by grass it disliked ended up with almost no reason to move — when
  // it is precisely the animal that should be moving. Measured 2026-07-29, it took
  // the gazelle's drift from 0.35 to 0.105 in `test/migration.test.js`'s sandbox
  // and the demo's gazelle to **3/10 seeds** on the ten-seed gate.
  //
  // So the two questions are answered separately, in the units each belongs in:
  //
  //   - **which way** — the best *effective* forage (`biomass × quality`), which
  //     is what makes the cue non-monotonic in biomass at all;
  //   - **how hard** — the raw biomass difference, in the units `reference` was
  //     always stated in, so a species with a preference is pulled toward better
  //     ground exactly as strongly as one without.
  //
  // With no preference the quality is exactly 1, the two scores coincide, and the
  // whole ring is arithmetically identical to what it was — which is what makes
  // the phase-8 world reproducible from `config.forage.enabled: false` (D16, D30).
  // ⚠ And because maturity *is* the standing crop, the scoring needs **no extra
  // grid read**: the biomass this loop already reads is both terms.
  const here = world.cellOf(entity.x, entity.y);
  const hereRaw = world.vegetation.biomassAt(here.cellX, here.cellY);
  const hereValue = hereRaw * forageQuality(hereRaw, forage, qualityFloor);

  let bestValue = hereValue;
  let bestRaw = hereRaw;
  let bestHeading = null;
  for (let i = 0; i < SAMPLE_DIRECTIONS; i += 1) {
    const heading = (i * TWO_PI) / SAMPLE_DIRECTIONS;
    const dx = Math.cos(heading);
    const dy = Math.sin(heading);
    let total = 0;
    let raw = 0;
    for (let step = 1; step <= SAMPLES_PER_RAY; step += 1) {
      // Sample at cueRadius/2 and cueRadius. `cellOf` clamps to the grid, so a
      // ray pointing off the edge reads the edge cell — no invented wall, and
      // no invented attraction either.
      const distance = (cueRadius * step) / SAMPLES_PER_RAY;
      const cell = world.cellOf(entity.x + dx * distance, entity.y + dy * distance);
      const cellRaw = world.vegetation.biomassAt(cell.cellX, cell.cellY);
      raw += cellRaw;
      total += cellRaw * forageQuality(cellRaw, forage, qualityFloor);
    }
    const value = total / SAMPLES_PER_RAY;
    if (value > bestValue) {
      bestValue = value;
      bestRaw = raw / SAMPLES_PER_RAY;
      bestHeading = heading;
    }
  }

  // Nowhere on the compass beats the ground underfoot: no pull. This is the
  // common case in a uniformly green spring, and it is why the mechanism costs
  // the demo nothing when there is nothing to migrate toward.
  if (bestHeading === null) return null;
  // ⚠ And a known, stated limit of splitting the two questions: the best-*quality*
  // direction can hold less grass than the ground underfoot, in which case there
  // is no pull. That is a grazer standing on a rank patch with the flush nearby,
  // and what moves it is the other half of the mechanism — `eat` is discounted, so
  // it wanders rather than grazing (see `habitat/forage.js`).
  const strength = clamp01((bestRaw - hereRaw) / reference);
  return strength > 0 ? { heading: bestHeading, strength } : null;
}

/**
 * The direction of more suitable *ground*, judged from the same ring of samples
 * (habitat preference — DOCS A49, PLAN-SPECIES.md §3.4, phase 9).
 *
 * The forage gradient's sibling, and deliberately a **second** ring rather than
 * one more factor inside the first. Three reasons, in order of how much they
 * matter:
 *
 *   - **They are normalized in different units.** A forage difference is measured
 *     in biomass against `cueReference: 4`; a habitat difference is measured in
 *     dimensionless weights against a reference of a few tenths. Multiplying them
 *     into one score would have made one arm's tuning depend on the other's.
 *   - **They are throttled differently, and that is the biology.** The forage and
 *     water cues are scaled by hunger and thirst, so they fall silent for a
 *     satisfied animal — which is exactly the animal that acts on where it would
 *     rather *be*. Habitat is therefore not need-gated (see `MigrationSystem`).
 *   - **A species can have one without the other.** Every carnivore in the roster
 *     tracks no forage at all.
 *
 * ⚠ The cost is 16 more O(1) grid reads per evaluation for a species that states
 * a preference, on a system whose `updateInterval` is 10 — and exactly nothing for
 * one that does not, since the caller does not call this at all. Still no spatial
 * query, still no randomness.
 *
 * ⚠ **Since 2026-08-09 the ground is judged on two axes, not one**: which terrain
 * code it is, and how *wet* it is (`world.wetnessAt`, a static field flooded from
 * the map's water — see `world/wetness.js`). That is what lets the roster split
 * across a wetland gradient the terrain codes cannot express, since a marsh, a
 * shore and an arid plain are all the same handful of codes. The second axis costs
 * a second grid read per sample and is **skipped entirely** for a species whose
 * `wetPreference` is the neutral 1, which is every species that says nothing.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity
 * @param {object} options
 * @param {number} options.cueRadius how far out the coarse cue reaches
 * @param {number} options.reference weight difference that counts as full strength
 * @param {Record<string, number>} options.weights the species' per-terrain weights
 * @param {number} [options.wetPreference] 1 neutral, >1 seeks wet ground, <1 dry
 * @returns {{heading: number, strength: number} | null} null when nowhere is better
 */
export function habitatGradient(world, entity, { cueRadius, reference, weights, wetPreference = 1 }) {
  const readsWetness = wetPreference !== 1;
  // ⚠ A species may now state a wetness preference and no terrain weights at all,
  // so `weights === null` is no longer on its own a reason to have no opinion.
  if (!(cueRadius > 0) || !(reference > 0) || (weights === null && !readsWetness)) return null;

  const terrain = world.terrain;
  // ⚠ Scored inline at both call sites rather than through a local helper, and it
  // is the one place in this function worth a comment: a closure here would be one
  // allocation per animal per evaluation, in a function whose whole cost model is
  // "16 O(1) reads and nothing else" (D28's discipline, and the reason the
  // perception scan holds its best-so-far in plain numbers).
  const here = world.cellOf(entity.x, entity.y);
  let hereValue = habitatWeightForCode(terrain.codeAt(here.cellX, here.cellY), weights);
  if (readsWetness) hereValue *= wetnessWeight(world.wetnessAt(here.cellX, here.cellY), wetPreference);

  let bestValue = hereValue;
  let bestHeading = null;
  for (let i = 0; i < SAMPLE_DIRECTIONS; i += 1) {
    const heading = (i * TWO_PI) / SAMPLE_DIRECTIONS;
    const dx = Math.cos(heading);
    const dy = Math.sin(heading);
    let total = 0;
    for (let step = 1; step <= SAMPLES_PER_RAY; step += 1) {
      const distance = (cueRadius * step) / SAMPLES_PER_RAY;
      const cell = world.cellOf(entity.x + dx * distance, entity.y + dy * distance);
      let value = habitatWeightForCode(terrain.codeAt(cell.cellX, cell.cellY), weights);
      if (readsWetness) value *= wetnessWeight(world.wetnessAt(cell.cellX, cell.cellY), wetPreference);
      total += value;
    }
    const value = total / SAMPLES_PER_RAY;
    if (value > bestValue) {
      bestValue = value;
      bestHeading = heading;
    }
  }

  // Already standing on the best ground the compass can see: no pull at all,
  // which for an animal on its preferred terrain is most of the time.
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
