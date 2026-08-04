/**
 * Elevation — being *above* the ground rather than on it (A67, phase T2 of
 * TREES-FLIGHT-VULTURE-PLAN.md).
 *
 * **A flag, not a coordinate.** `entity.elevation` is 0 (ground) or 1 (canopy),
 * and nothing about the world's geometry changes with it: no third axis, no
 * height in the distance calculations, no elevation in the spatial index. A67
 * predicted this would need "an entity elevation dimension threaded through
 * perception, movement, and predation" and deferred it, possibly permanently, on
 * that cost. The reason it is affordable now is that A67 also named the escape:
 * *"revisit only if 'cached out of reach' can be one more possession state rather
 * than a new axis."* It can, and this is that.
 *
 * ⚠⚠ **The gates are on predation and possession — never on perception.** That
 * is **A63** and it is not a stylistic preference: everything one animal knows
 * about another comes through one test in `PerceptionSystem`, so a condition
 * added *there* gates prey, threats, **mate candidates**, a juvenile's guardian
 * and territorial rivals all at once. Phase 14 learned this by sterilising the
 * leopard — the species the mechanism was written for — and the failure presented
 * as a population number three subsystems from the cause. So:
 *
 *   - a treed animal is **not eligible prey** and **not a threat** (both
 *     directions, in `predation/predation.js`, beside the mass ratios that
 *     already resolve per pair on the rare true case);
 *   - a canopy carcass is **unreachable** to a non-climber
 *     (`predation/possession.js`, the predicate the decision system and the
 *     feeding system already share, so an animal can never walk to a cache it is
 *     then refused);
 *   - a treed animal **does not step** and **is not burnt**;
 *   - and it still sees, is seen, courts, is courted, and can be somebody's
 *     guardian. A leopard up a tree is visibly up a tree.
 *
 * **Climbing is not an action.** It has no entry in the utility table and
 * competes with nothing — DOCS §9 Decision's hardest-won rule is that a new
 * movement behaviour competes with foraging and foraging must win. What decides
 * elevation is the action the animal *already* chose: a climber that chose to
 * rest, shelter, hide, or flee while standing under a tree is up it, and one
 * that chose to go anywhere is not.
 *
 * Ownership: `entity.elevation` is written by **`MovementSystem` only** (which
 * already owns the intent→position step); everything else reads it. No
 * randomness — every predicate here is pure.
 */

/** On the ground. The default for everything, including every carcass. */
export const GROUND = 0;
/** Up a tree: out of reach of anything that cannot climb. */
export const CANOPY = 1;

/**
 * The actions that keep a climber aloft once it is standing under a tree.
 *
 * ⚠ **`flee` is in the list and it is the reason the list exists.** Going up is
 * what a leopard does about a competitor it cannot fight, so the escape has to
 * end somewhere — and `flee` is already the action with a heading rule attached
 * (`escapeHeading`), which is where phase T3 aims a fleeing climber at a tree.
 * The rest are the ways of staying put: an animal that has chosen to rest,
 * shelter, or lie hidden under a tree has chosen to be in it.
 *
 * Everything absent from this list descends, which is the important half: an
 * animal that wants food, water, a mate, or anywhere at all comes down first.
 */
const CANOPY_ACTIONS = new Set(['rest', 'shelter', 'hide', 'flee']);

/**
 * Whether this species can leave the ground at all.
 *
 * ⚠ An always-per-species **field**, like `crypsis` — not a `SPECIES_BLOCKS`
 * block. A species block *beats* the config, so an `enabled` inside one could
 * never switch the mechanism off (DOCS §8); the biology lives here and the
 * reproducible control lives in `config.climbing`.
 *
 * @param {object|null|undefined} species resolved species record
 * @returns {boolean}
 */
export function canClimb(species) {
  return species?.climbs === true;
}

/** Whether this entity is currently off the ground. Safe for carcasses. */
export function isAloft(entity) {
  return entity?.elevation === CANOPY;
}

/**
 * Whether two entities are on the same level, and therefore able to reach each
 * other at all.
 *
 * ⚠ Written as "both aloft or both grounded" rather than as a check on one side,
 * because the relation is symmetric in every consumer: a ground predator cannot
 * reach a treed animal, **and** a treed predator cannot reach a ground one. The
 * second half is what stops a leopard ambushing from a branch, which it should
 * not be able to do — an elevation flag carries no height, so there is no line of
 * attack downward to model.
 */
export function shareElevation(a, b) {
  return isAloft(a) === isAloft(b);
}

/**
 * The elevation this animal should be at, given where it is standing and what it
 * has decided to do.
 *
 * Pure, and evaluated fresh every tick rather than stored as a transition — the
 * same judgement that keeps dominance, possession, and every disturbance effect
 * derived on read. There is no "climbing" state to get stuck in and no timer to
 * expire; an animal is in a tree exactly while the three conditions hold.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity
 * @param {object|null|undefined} species resolved species record
 * @param {boolean} enabled the world-level switch (`config.climbing.enabled`)
 * @returns {0|1}
 */
export function elevationFor(world, entity, species, enabled) {
  if (!enabled || !canClimb(species)) return GROUND;
  if (!CANOPY_ACTIONS.has(entity.action)) return GROUND;
  return world.isTreeAt(entity.x, entity.y) ? CANOPY : GROUND;
}
