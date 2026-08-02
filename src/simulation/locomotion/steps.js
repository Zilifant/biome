/**
 * What a step is, and when it is refused — one module, two readers (2026-08-01).
 *
 * The movement system *executes* a step and the decision system now *probes*
 * one, and both have to ask exactly the same question or the animal deflects
 * onto a heading movement then refuses. That is the D11 shape this project has
 * already paid for three times (`drinkRange`, `foodMinLevel`, `carcassRange`):
 * two copies of one rule, guaranteed to drift the moment either side is tuned.
 * So the rule lives here, in the `possession.js` pattern — a predicate with one
 * home and two callers, neither of which owns it.
 *
 * ⚠ **The refusal order is the movement system's own, preserved exactly.**
 * Passability, then the thicket rule, then crowding. It short-circuits where the
 * original evaluated all three eagerly, which is invisible: every test is pure,
 * so skipping a grid query that could not have changed the answer changes no
 * answer and no draw. Determinism is untouched — nothing here rolls anything.
 *
 * Ownership: nothing. This module writes no state and emits no events; it reads
 * terrain, the spatial grid, and the entity's own condition.
 */
import { diseaseSeverity } from '../disease/disease.js';

/**
 * Tuning a step depends on, all of it already living in `config.locomotion`,
 * `config.injury` and `config.disease`. Held as one frozen record so a caller
 * passes a rules object rather than four loose numbers — the arity lesson from
 * `PerceptionSystem#perceive` (D28), applied before it costs anything.
 */
export const DEFAULT_STEP_RULES = Object.freeze({
  sprintMultiplier: 1.6,
  injurySpeedPenalty: 0.5,
  diseaseSpeedPenalty: 0.45,
  /** `null` disables the crowding cap entirely; only a finite positive turns it on. */
  maxOccupantsPerCell: null,
});

/**
 * Normalize loose constructor options into a frozen rules record.
 * @param {object} [options]
 * @returns {typeof DEFAULT_STEP_RULES}
 */
export function normalizeStepRules(options = {}) {
  const cap = options.maxOccupantsPerCell;
  return Object.freeze({
    sprintMultiplier: options.sprintMultiplier ?? DEFAULT_STEP_RULES.sprintMultiplier,
    injurySpeedPenalty: options.injurySpeedPenalty ?? DEFAULT_STEP_RULES.injurySpeedPenalty,
    diseaseSpeedPenalty: options.diseaseSpeedPenalty ?? DEFAULT_STEP_RULES.diseaseSpeedPenalty,
    maxOccupantsPerCell: typeof cap === 'number' && cap > 0 ? cap : null,
  });
}

/**
 * How far this animal moves on one committed tick: its base speed, scaled by
 * pace, by what is wrong with it, and by the ground it is standing on.
 *
 * ⚠ The terrain modifier is read at the animal's *current* position, not the
 * target's — stepping out of a thicket is a thicket-speed step. That is the
 * movement system's existing behaviour and moving it here preserves it.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity
 * @param {boolean} sprinting
 * @param {typeof DEFAULT_STEP_RULES} rules
 * @returns {number} world units
 */
export function stepLength(world, entity, sprinting, rules) {
  const pace = sprinting ? rules.sprintMultiplier : 1;
  const injured = 1 - entity.impairment * rules.injurySpeedPenalty;
  const ill = 1 - diseaseSeverity(entity, rules.diseaseSpeedPenalty);
  return entity.speed * pace * injured * ill * world.speedModifierAt(entity.x, entity.y);
}

/**
 * Whether a cell already holds the maximum number of living animals. Counted
 * through the spatial grid (never a global scan): a query radius of 1.5 safely
 * covers a 1x1 cell, then exact cell equality filters the rest out. The mover
 * itself and any carcasses are excluded.
 *
 * @param {import('../world/World.js').World} world
 * @param {number} cellX @param {number} cellY @param {number} moverId
 * @param {number|null} maxOccupantsPerCell
 * @returns {boolean}
 */
export function cellFull(world, cellX, cellY, moverId, maxOccupantsPerCell) {
  if (maxOccupantsPerCell === null) return false;
  let count = 0;
  for (const id of world.grid.queryRadius(cellX + 0.5, cellY + 0.5, 1.5)) {
    if (id === moverId) continue;
    const other = world.entities.get(id);
    if (!other || other.kind !== 'animal' || !other.alive) continue;
    const cell = world.cellOf(other.x, other.y);
    if (cell.cellX === cellX && cell.cellY === cellY && (count += 1) >= maxOccupantsPerCell) return true;
  }
  return false;
}

/**
 * Whether a step from this animal's position to (targetX, targetY) would be
 * refused. The three ways a step fails, in the order the movement system has
 * always evaluated them:
 *
 *   1. **Impassable terrain** — rock, deep water, off-map.
 *   2. **A thicket edge.** Passable but a crawl, so an animal treats it as a
 *      wall unless it is already inside one (and so can push back out) or the
 *      decision system has explicitly marked this step a break-in.
 *   3. **A full cell.** Occupancy only gates *entry*: moving within the current
 *      cell, or out of a full one, is always allowed.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity the mover, at its current position
 * @param {number} targetX @param {number} targetY
 * @param {boolean} breakThicket the intent's explicit last-resort break-in
 * @param {number|null} maxOccupantsPerCell
 * @returns {boolean}
 */
export function stepRefused(world, entity, targetX, targetY, breakThicket, maxOccupantsPerCell) {
  if (!world.isPassableAt(targetX, targetY)) return true;
  if (breakThicket !== true && world.isThicketAt(targetX, targetY) && !world.isThicketAt(entity.x, entity.y)) {
    return true;
  }
  if (maxOccupantsPerCell === null) return false;
  const here = world.cellOf(entity.x, entity.y);
  const there = world.cellOf(targetX, targetY);
  if (there.cellX === here.cellX && there.cellY === here.cellY) return false;
  return cellFull(world, there.cellX, there.cellY, entity.id, maxOccupantsPerCell);
}
