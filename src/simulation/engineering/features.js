/**
 * Ecosystem engineering (Step 28) — animals that change the ground they use.
 *
 * Two features, both **enumerated and specific**, because the step's explicit
 * out-of-scope is "a generic scriptable environment-modification engine":
 *
 *   - a **trail** is worn by repeated traffic, and packed ground is quicker to
 *     cross;
 *   - a **burrow** is dug by an animal that keeps resting in one spot, and a
 *     burrow is shelter.
 *
 * The shape is Step 27's, with one difference that is the whole point. A
 * disturbance is a record on a clock that *expires*; a feature has no clock at
 * all — it persists while it is used and fades when it is not. So the lifecycle
 * is **built → maintained → lost**, and "maintained" is not a mechanism, it is
 * just wear arriving faster than decay removes it. Nothing anywhere decides that
 * a trail should stay.
 *
 * **Both effects land on chokepoints that already exist**, which is why this
 * step adds no behaviour and no system had to learn what a feature is:
 * `world.speedModifierAt` already decides how fast ground is to cross, and
 * `world.isShelteredAt` already decides what counts as shelter — so a burrow is
 * picked up by thermoregulation and by the `shelter` action for free (Step 19),
 * and neither of them knows an animal dug it.
 *
 * The one genuinely new pull is that an animal drifts *onto* a nearby trail, and
 * even that is not an action: it feeds the same wander-heading blend Step 26
 * built for the forage gradient (§1.4 A34 — a new action competes with foraging
 * and loses). Without it a trail would be faster ground nobody sought, and the
 * step's own demonstration asks that a trail bias later movement.
 *
 * Effects are a **declarative table**, as disturbances are, so what a kind does
 * has one answer in one place.
 */

/** Feature kinds. Consumers must tolerate unknown ones. */
export const FeatureKinds = Object.freeze({
  TRAIL: 'trail',
  BURROW: 'burrow',
});

/**
 * What each kind does once its cell is worn deep enough.
 *
 * `speedScale` multiplies the terrain traversal modifier — above 1 for packed
 * ground. `shelters` marks kinds that count as cover for thermoregulation.
 * `attracts` is how hard a nearby cell of this kind bends an aimless wander;
 * only a trail pulls, because a burrow is somewhere an animal made for itself
 * rather than a public amenity (§1.4 A47).
 */
export const FEATURE_EFFECTS = Object.freeze({
  [FeatureKinds.TRAIL]: Object.freeze({
    // Packed earth, not a road. A quarter faster is enough to matter over a long
    // walk and small enough that a trail never becomes the only sane route.
    speedScale: 1.25,
    shelters: false,
    attracts: true,
  }),
  [FeatureKinds.BURROW]: Object.freeze({
    // Dug out and awkward underfoot; the shelter is the point, not the speed.
    speedScale: 0.9,
    shelters: true,
    attracts: false,
  }),
});

/** The effect row for a kind, or null if it is not one we know. */
export function effectsFor(kind) {
  return FEATURE_EFFECTS[kind] ?? null;
}

/**
 * Traversal speed multiplier from a feature at a cell (1 when there is none).
 *
 * The `featureCount` early exit matters as much as the disturbance one: this
 * sits inside `world.speedModifierAt`, which every moving animal calls every
 * tick, and a world nobody has worn down yet must cost nothing.
 *
 * @param {import('../world/FeatureGrid.js').FeatureGrid} features
 * @param {number} cellX @param {number} cellY
 */
export function speedScaleAt(features, cellX, cellY) {
  if (features.featureCount === 0) return 1;
  const record = features.at(cellX, cellY);
  if (record === null || !record.feature) return 1;
  return effectsFor(record.kind)?.speedScale ?? 1;
}

/**
 * Whether a feature at a cell gives shelter from the weather.
 * @param {import('../world/FeatureGrid.js').FeatureGrid} features
 * @param {number} cellX @param {number} cellY
 */
export function sheltersAt(features, cellX, cellY) {
  if (features.featureCount === 0) return false;
  const record = features.at(cellX, cellY);
  if (record === null || !record.feature) return false;
  return effectsFor(record.kind)?.shelters === true;
}

/**
 * The direction of the most worn attracting feature within `radius` cells, or
 * null when there is nothing worth stepping onto.
 *
 * Deliberately the same shape as Step 26's `forageGradient`: a fixed ring of
 * O(1) cell reads, no spatial query, and a strength that is a *difference* from
 * the ground underfoot — so an animal already on a trail feels no pull, and a
 * world with no trails produces nothing at all. §1.4 C6 still owes Step 30 two
 * neighbour walks rather than three; this adds none.
 *
 * @param {import('../world/FeatureGrid.js').FeatureGrid} features
 * @param {number} x @param {number} y world position
 * @param {object} options
 * @param {number} options.radius cells to look out to
 * @returns {{heading: number, strength: number} | null}
 */
export function trailGradient(features, x, y, { radius }) {
  if (features.featureCount === 0 || !(radius > 0)) return null;

  const hereCell = { cellX: Math.floor(x), cellY: Math.floor(y) };
  const here = features.at(hereCell.cellX, hereCell.cellY);
  const hereWear = here !== null && here.feature && effectsFor(here.kind)?.attracts ? here.wear : 0;

  let bestWear = hereWear;
  let bestHeading = null;
  const TWO_PI = Math.PI * 2;
  const SAMPLES = 8;
  for (let i = 0; i < SAMPLES; i += 1) {
    const heading = (i * TWO_PI) / SAMPLES;
    const cellX = Math.floor(x + Math.cos(heading) * radius);
    const cellY = Math.floor(y + Math.sin(heading) * radius);
    const record = features.at(cellX, cellY);
    if (record === null || !record.feature) continue;
    if (effectsFor(record.kind)?.attracts !== true) continue;
    if (record.wear > bestWear) {
      bestWear = record.wear;
      bestHeading = heading;
    }
  }

  if (bestHeading === null) return null;
  return { heading: bestHeading, strength: Math.min(1, bestWear - hereWear) };
}

/**
 * Renderer-neutral projection of the features deep enough to see.
 *
 * Only *promoted* cells are projected — scuffed ground that has not become
 * anything is internal bookkeeping, and projecting it would mean sending a list
 * that changes every tick as animals walk about.
 *
 * @param {import('../world/FeatureGrid.js').FeatureGrid} features
 */
export function projectFeatures(features) {
  return {
    revision: features.revision,
    cells: features.features().map((f) => ({
      cellX: f.cellX,
      cellY: f.cellY,
      kind: f.kind,
      // Rounded to two places: this is a depth cue for a renderer, and shipping
      // raw floats would make the payload churn on every write.
      wear: Math.round(f.wear * 100) / 100,
    })),
  };
}
