/**
 * Flight — a **pace on the intent**, not an action (phase F1 of
 * TREES-FLIGHT-VULTURE-PLAN.md).
 *
 * `intent.sprint` has always been a pace flag the movement system executes, and
 * this is the same shape one level up: `entity.flying` is decided by the decision
 * system from the action it has *already* chosen, executed by movement, and read
 * by perception and metabolism. It is emphatically **not** a simulation of
 * flight — no altitude, no thermals, no takeoff economics, no flapping budget
 * (`vulture.md` §Aerial movement asks for all four and this plan declines all
 * four). What it is, is four numbers at four chokepoints that already exist:
 * faster travel, wider sight, cheap distance, terrain-independent movement.
 *
 * ⚠⚠ **Flying is not an action, for the reason climbing is not one.** DOCS §9
 * Decision's most expensive rule is that a new movement behaviour competes with
 * foraging and foraging must win — patrol cost the demo two seeds in five. So
 * there is no `fly` entry in the utility table, nothing to score, and nothing to
 * tie-break. The animal decides *what to do* exactly as it always did, and this
 * module answers the separate question of whether it does that on the wing.
 *
 * ⚠ **The rule has one home and several readers** — the `steps.js` and
 * `possession.js` pattern. `stepLength`, `stepRefused`, `#perceive`,
 * `MetabolismSystem` and `predation.js` all read `entity.flying`; only
 * `DecisionSystem` writes it, and it writes it *every* tick for *every* animal,
 * so the flag can never outlive the switch that produced it.
 *
 * ⚠ **Perception runs before decision in the tick**, so the wider sight radius is
 * read one tick after the flight state is written. That is a one-tick lag, it is
 * harmless, and it is written down here rather than discovered: the alternative —
 * deciding flight in the perception phase — puts an action-shaped choice in the
 * wrong system.
 *
 * Ownership: nothing. This module writes no state, emits no events, and rolls
 * nothing; every predicate is pure.
 */
import { isAloft } from './climbing.js';

/**
 * The actions a capable animal does on the wing: **the ones that are about
 * covering ground.** That is the criterion, and the membership below is derived
 * from it rather than enumerated by taste.
 *
 * ⚠ **Everything absent is done standing on the ground, and the absences are the
 * design.** `eat`, `drink`, `rest`, `hide`, `seekMate`, `defend` and `cache` are
 * resolved at contact or at a standstill, and an animal that has to *be
 * somewhere* to do a thing has to land to do it. That is what makes flight a
 * travel mode rather than a general improvement: a flier is faster, further-seeing
 * and cheaper to run precisely while it is not eating, drinking, breeding, resting
 * or fighting over a body.
 *
 * ⚠⚠ **`herd`, `retreat`, `leaveThicket`, `followParent` and `tend` were added on
 * measurement, and the measurement is worth keeping.** The plan enumerated six
 * travelling actions and six grounded ones and left these five unclassified; built
 * to the letter of that list, the vulture flipped ground↔air **289 times per 1000
 * animal-ticks** — roughly every third tick — and the transitions were dominated by
 * one pair: `herd` (grounded) against `wander` (flying), the two lowest-utility
 * discretionary actions, which trade places constantly for a bird drifting near
 * its own kind. So the plan's *prediction* that "a wander commitment carries the
 * flight state with it" was wrong, because the **action** is re-chosen every tick
 * even when the heading is committed. All five are directed travel toward a
 * position by the plan's own criterion, and classifying them that way is both the
 * honest reading and what collapses the flicker (to ~30 per 1000). ⚠ The named
 * lever if it ever climbs again is `flight.takeoffCost`, and it is deliberately
 * *not* built: charging for a transition is a new mechanism, and the transitions
 * here were a classification bug wearing an energetics costume.
 *
 * ⚠ **`stalk`, `chase` and `flee` stay grounded, deliberately.** The first two are
 * resolved at contact, and an aerial pursuit would be a second mechanism wearing
 * this one's clothes — nothing in the roster hunts on the wing. `flee` is the
 * subtle one: a flying animal is not eligible prey, so it has no `nearestThreat`
 * to run from, and the action is nearly unreachable for a flier. Leaving it on the
 * ground also keeps `escapeHeading`'s wall-and-thicket geometry meaningful, which
 * airborne it would not be.
 */
const FLYING_ACTIONS = new Set([
  // Undirected and resource-directed travel.
  'wander',
  'seekFood',
  'recallFood',
  'seekWater',
  'recallWater',
  'patrol',
  // Directed travel toward a position that is not a contact resolution.
  'herd',
  'retreat',
  'leaveThicket',
  'followParent',
  'tend',
]);

/**
 * The identity, in every axis. A species that declares a `flight` block stating
 * only some of these gets 1 for the rest — so `flight: {}` is a bird that can
 * fly and gains nothing by it, which is the honest reading and a useful control.
 */
export const DEFAULT_FLIGHT = Object.freeze({
  speedMultiplier: 1,
  visionMultiplier: 1,
  moveCostFactor: 1,
});

/**
 * The species' flight record, or null if it does not fly.
 *
 * ⚠ An always-per-species **field**, like `climbs` and `crypsis` — deliberately
 * *not* a member of `SPECIES_BLOCKS`. A species block beats the config (DOCS §8),
 * so a `flight` block would merge over `config.flight` and any species declaring
 * its own would override `enabled: false`, leaving the mechanism with no
 * reproducible control. The biology lives here; the switch lives in
 * `config.flight`.
 *
 * @param {object|null|undefined} species resolved species record
 * @returns {object|null}
 */
export function flightOf(species) {
  return species?.flight ?? null;
}

/**
 * Whether this species can leave the ground under its own power at all.
 * Capability is the *presence* of the block, so adding a flier is a config edit.
 *
 * @param {object|null|undefined} species
 * @returns {boolean}
 */
export function canFly(species) {
  return flightOf(species) !== null;
}

/** Whether this entity is currently on the wing. Safe for carcasses. */
export function isAirborne(entity) {
  return entity?.flying === true;
}

/**
 * Whether this entity is out of the reach of whatever is happening on the
 * ground — up a tree **or** on the wing.
 *
 * The two refuges are different mechanisms with one consequence, and folding
 * them into one predicate here is what stops the consequence being spelled
 * differently in each reader (D11). Its one caller today is the disturbance
 * system: a grass fire runs underneath a treed animal, and just as plainly
 * underneath a flying one.
 */
export function isOffGround(entity) {
  return isAloft(entity) || isAirborne(entity);
}

/** How much faster this species travels on the wing. 1 for everything else. */
export function flightSpeedMultiplier(species) {
  return species?.flight?.speedMultiplier ?? DEFAULT_FLIGHT.speedMultiplier;
}

/** How much further this species sees on the wing. 1 for everything else. */
export function flightVisionMultiplier(species) {
  return species?.flight?.visionMultiplier ?? DEFAULT_FLIGHT.visionMultiplier;
}

/** What a unit of travel costs on the wing, relative to walking it. */
export function flightMoveCostFactor(species) {
  return species?.flight?.moveCostFactor ?? DEFAULT_FLIGHT.moveCostFactor;
}

/**
 * Whether this animal should be on the wing, given where it is standing and what
 * it has decided to do.
 *
 * Pure, and evaluated fresh every tick rather than stored as a transition — the
 * same judgement `elevationFor` makes about being up a tree, and for the same
 * reason: there is no takeoff state to get stuck in and no timer to expire. An
 * animal is flying exactly while the conditions hold.
 *
 * ⚠⚠ **The impassable clause is what keeps the landing invariant true by
 * construction.** A flying animal's step is refused by nothing, so it can end a
 * tick over rock or deep water; if the *action* alone decided flight, the next
 * tick's `eat` or `rest` would put it standing inside a cliff. Instead, an animal
 * over ground it cannot stand on stays airborne whatever it chose, and comes down
 * on the first tick it is over ground it can — so **"a grounded animal is on
 * passable ground" holds without a single guard anywhere else in the engine.**
 *
 * ⚠ Short-circuits on the world switch and then on the species, so a roster that
 * declares no flier pays one comparison per animal per tick.
 *
 * ⚠ **The one oddity the impassable clause leaves behind, measured rather than
 * waved away:** a stationary action produces a non-moving intent, so an animal
 * held airborne over water or rock can be *motionless in the air* until it chooses
 * to travel again. Measured on the demo (seeds 1 and 42, 3000 ticks): **0.02–0.05%
 * of airborne animal-ticks, in unbroken runs of at most 4–5 ticks**, and the
 * actions are `drink` and `eat` — a bird at a lake edge whose own cell is the water
 * it is drinking from. That is close enough to correct behaviour to leave alone,
 * and it is self-limiting in any case: hunger and thirst rise, and every action
 * they favour travels.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity
 * @param {object|null|undefined} species resolved species record
 * @param {boolean} enabled the world-level switch (`config.flight.enabled`)
 * @returns {boolean}
 */
export function flyingFor(world, entity, species, enabled) {
  if (!enabled || !canFly(species)) return false;
  if (FLYING_ACTIONS.has(entity.action)) return true;
  return !world.isPassableAt(entity.x, entity.y);
}
