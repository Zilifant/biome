/**
 * Local disturbances (Step 27) — fire, flood, and storm as bounded events.
 *
 * A disturbance is **six numbers and a kind**: where it is, how big it is, when
 * it started, and when it stops. Everything it does to the world is derived from
 * that record on read rather than written into the world and undone later, and
 * that single choice is what makes recovery almost free:
 *
 *   - a flooded cell is not *marked* flooded; it is slow **while a flood covers
 *     it**, and the moment the record expires it is ordinary ground again. There
 *     is no un-flooding pass, and no way for the world to get stuck half-flooded
 *     because a cleanup was missed;
 *   - terrain is never mutated. Terrain is static and regenerated from the seed
 *     on load (it is deliberately not saved), so a disturbance that edited it
 *     would silently vanish on restore. Disturbances are their own protocol
 *     layer instead, exactly as vegetation is.
 *
 * The one thing that *is* destructive is vegetation, because burnt grass should
 * not come back when the fire goes out — it should grow back, and Step 3's
 * logistic regrowth already does that. So a fire consumes biomass once, at
 * ignition, and recovery is the vegetation system doing what it always does.
 *
 * **Nothing here makes animals flee.** §1.4 A34 and D14 are the reason: a new
 * action competes with foraging, and foraging must win. Displacement is instead
 * two existing mechanisms doing their jobs — a burnt region is low-forage ground
 * that Step 26's drift carries animals *off*, and a fire writes a `danger`
 * memory (Step 15) at its centre, which animals already avoid resting near and
 * refuse to recall food from. Recolonization when the grass returns is likewise
 * Step 26's, unchanged and unextended. This step adds no behaviour at all; it
 * adds a reason for the behaviour that exists.
 *
 * Effects are a **declarative table** rather than a switch, so adding a kind is
 * a row rather than a code path — and so that "what does a flood do?" has one
 * answer in one place instead of being spread across the systems that ask.
 */

/** Disturbance kinds. Consumers must tolerate unknown ones. */
export const DisturbanceKinds = Object.freeze({
  FIRE: 'fire',
  FLOOD: 'flood',
  STORM: 'storm',
});

/**
 * What each kind does, in one table.
 *
 * `vegetationLoss` is the fraction of standing biomass destroyed at ignition
 * (once — see the module note). `speedScale` multiplies the terrain traversal
 * modifier while the animal is inside. `temperatureShift` is added to the
 * ambient temperature locally, so a storm bites through the *existing*
 * thermoregulation cost rather than needing a cost of its own. `burnSeverity`
 * (applied on an interval) and `healthPerTick` (continuous) are what being
 * caught in it does to an animal. `danger` marks the kinds worth remembering as
 * dangerous.
 *
 * Drought and severe winter are deliberately absent: both already exist as
 * **global weather states** (Step 19), and a local copy would be the same
 * mechanism at a different scale rather than a new one (§1.4 A44).
 */
export const DISTURBANCE_EFFECTS = Object.freeze({
  [DisturbanceKinds.FIRE]: Object.freeze({
    vegetationLoss: 0.95, // it burns; what little survives is the seed of the regrowth
    speedScale: 1,
    temperatureShift: 0,
    // ⚠ A burn is a **discrete wound on an interval**, not a per-tick drip, and
    // that is a correctness constraint rather than a style choice: `applyInjury`
    // discards anything at or below `HEALED_BELOW` (0.02), so a plausible-looking
    // 0.006 per tick recorded *no injury at all* while animals still burned to
    // death from the health damage below. Severity must clear that floor on the
    // tick it is applied.
    burnSeverity: 0.12,
    healthPerTick: 0.5,
    danger: true,
    // Short and violent. A fire that smouldered for a thousand ticks would be a
    // climate, not an event.
    durationScale: 0.5,
  }),
  [DisturbanceKinds.FLOOD]: Object.freeze({
    // Standing water drowns some of the sward but does not sterilize it.
    vegetationLoss: 0.4,
    // Wading, not drowning. Deliberately *slow* rather than impassable: an
    // animal that happened to be standing where a flood arrived would be walled
    // in by an impassable region and could never leave it, since the movement
    // system refuses impassable target cells. Slow ground it can struggle out
    // of is both kinder and more honest than a trap.
    speedScale: 0.35,
    temperatureShift: -3,
    burnSeverity: 0,
    healthPerTick: 0,
    danger: false,
    durationScale: 1.5, // water takes a while to go down
  }),
  [DisturbanceKinds.STORM]: Object.freeze({
    vegetationLoss: 0.1,
    speedScale: 0.7,
    // A storm's whole bite is thermal, and it lands on the metabolism system's
    // existing thermoregulation cost — an animal caught out in one pays to hold
    // its temperature and heads for cover, both already implemented (Step 19).
    temperatureShift: -10,
    burnSeverity: 0,
    healthPerTick: 0,
    danger: false,
    durationScale: 1,
  }),
});

/** Kinds in a fixed order, so a seeded draw maps to a kind reproducibly. */
export const DISTURBANCE_KIND_ORDER = Object.freeze([
  DisturbanceKinds.FIRE,
  DisturbanceKinds.FLOOD,
  DisturbanceKinds.STORM,
]);

/** The effect row for a kind, or null if it is not one we know. */
export function effectsFor(kind) {
  return DISTURBANCE_EFFECTS[kind] ?? null;
}

/** Whether a disturbance covers a point. */
export function covers(disturbance, x, y) {
  const dx = x - disturbance.x;
  const dy = y - disturbance.y;
  return dx * dx + dy * dy <= disturbance.radius * disturbance.radius;
}

/**
 * The active disturbance covering a point, or null.
 *
 * Returns the *first* match in list order rather than blending overlaps. Two
 * disturbances on one cell is rare (the active list is capped in single digits),
 * and stacking their effects multiplicatively would let an unlucky pair produce
 * a combination neither kind describes — which is exactly the sort of thing that
 * is invisible until it is a bug report. First-match is boring and legible.
 *
 * @param {object[]} disturbances @param {number} x @param {number} y
 */
export function disturbanceAt(disturbances, x, y) {
  if (disturbances.length === 0) return null;
  for (const disturbance of disturbances) {
    if (covers(disturbance, x, y)) return disturbance;
  }
  return null;
}

/**
 * Traversal speed multiplier from disturbances at a point (1 when clear).
 *
 * The empty-list early exit matters: this sits inside `world.speedModifierAt`,
 * which every moving animal calls every tick, and the demo has no disturbance
 * running for most of its history. Quiet ticks cost one length check — the same
 * shape as Step 25's "transmission costs nothing between outbreaks".
 */
export function speedScaleAt(disturbances, x, y) {
  if (disturbances.length === 0) return 1;
  const disturbance = disturbanceAt(disturbances, x, y);
  return disturbance ? (effectsFor(disturbance.kind)?.speedScale ?? 1) : 1;
}

/** Local temperature offset from disturbances at a point (0 when clear). */
export function temperatureShiftAt(disturbances, x, y) {
  if (disturbances.length === 0) return 0;
  const disturbance = disturbanceAt(disturbances, x, y);
  return disturbance ? (effectsFor(disturbance.kind)?.temperatureShift ?? 0) : 0;
}

/** Whether a disturbance record is still running at a tick. */
export function isActive(disturbance, tick) {
  return tick < disturbance.until;
}

/**
 * Renderer-neutral projection of the active disturbances.
 *
 * Copies, and tiny by construction — the active list is capped, so this is a
 * handful of small records rather than a layer. That is why it can ride in every
 * snapshot where the territorial claim grid (§1.4 A36) cannot: a bounded list of
 * circles is not a per-cell field.
 *
 * @param {object[]} disturbances
 */
export function projectDisturbances(disturbances) {
  return disturbances.map((d) => ({
    id: d.id,
    kind: d.kind,
    x: d.x,
    y: d.y,
    radius: d.radius,
    startedTick: d.startedTick,
    until: d.until,
  }));
}
