/**
 * Movement execution (Step 5, restructured Step 8).
 *
 * This system no longer chooses headings — the decision system (Step 8) sets
 * `entity.moveIntent = { heading, ttl, moving }`, and this system merely
 * executes it: if the animal wants to move, it steps along the heading, scaled
 * by `speed` and the terrain traversal modifier, refusing impassable cells. On
 * a blocked step it turns the intent around and expires its commitment so the
 * decision system re-commits next tick. Distance travelled is recorded for the
 * metabolism system.
 *
 * An intent may ask for a sprint (Step 16): chases and escapes move faster and
 * spend `stamina` to do it, and fall back to a walk once that budget is gone.
 * Injuries (Step 17) cut the step in the other direction — a wounded animal
 * limps, whether it is walking or sprinting.
 *
 * Ownership: writes `x`, `y`, `heading`, `lastMoveDistance`, drains `stamina`
 * while sprinting (the metabolism system recovers it), and (on a block) adjusts
 * `moveIntent`. No randomness — determinism lives in the decision system's
 * committed heading. No global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { normalizeStepRules, stepLength, stepRefused } from '../locomotion/steps.js';

const TWO_PI = Math.PI * 2;

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

export class MovementSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.sprintMultiplier] speed multiplier while sprinting
   * @param {number} [options.sprintStaminaCost] stamina spent per sprinting tick
   * @param {number} [options.injurySpeedPenalty] speed lost at full impairment
   * @param {number|null} [options.maxOccupantsPerCell] refuse a step into a cell
   *        already holding this many living animals; null disables the cap
   * @param {number} [options.updateInterval]
   */
  constructor({ sprintMultiplier = 1.6, sprintStaminaCost = 2.5, injurySpeedPenalty = 0.5, diseaseSpeedPenalty = 0.45, maxOccupantsPerCell = null, updateInterval = 1 } = {}) {
    super({ id: 'movement.execute', phase: 'movement', priority: 0, updateInterval });
    this.sprintMultiplier = sprintMultiplier;
    this.sprintStaminaCost = sprintStaminaCost;
    this.diseaseSpeedPenalty = diseaseSpeedPenalty;
    this.injurySpeedPenalty = injurySpeedPenalty;
    // A finite, positive cap turns the crowding check on; anything else is "off".
    this.maxOccupantsPerCell =
      typeof maxOccupantsPerCell === 'number' && maxOccupantsPerCell > 0 ? maxOccupantsPerCell : null;
    // ⚠ **What a step is, and when it is refused, moved to `locomotion/steps.js`
    // on 2026-08-01** — because the decision system now *probes* a step before
    // committing a heading (see `detourHeading`), and two copies of this
    // rule would drift into an animal that deflects onto a heading this system
    // then refuses. Same one-predicate-two-readers shape as `possession.js`.
    // The fields above are kept as the system's own record of its tuning.
    this.stepRules = normalizeStepRules({
      sprintMultiplier,
      injurySpeedPenalty,
      diseaseSpeedPenalty,
      maxOccupantsPerCell,
    });
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const intent = entity.moveIntent;
      if (!intent || !intent.moving) {
        entity.lastMoveDistance = 0;
        continue;
      }

      // Sprinting (Step 16) buys speed with stamina, and only while there is
      // stamina to spend — an exhausted animal drops back to a walk mid-chase,
      // which is what decides most hunts.
      const sprinting = intent.sprint === true && entity.stamina > 0;
      if (sprinting) {
        entity.stamina = Math.max(0, entity.stamina - this.sprintStaminaCost);
      }
      // Base speed, scaled by pace, by what is wrong with the animal (an injury
      // limps it, an illness slows it, and the two stack), and by the ground it
      // is standing on. `stepLength` owns that arithmetic so the decision
      // system's probe measures the same step this one takes.
      const step = stepLength(world, entity, sprinting, this.stepRules);

      // Reflect the heading off any world wall this step would cross, so an
      // animal aimed off-map turns back inward instead of sliding along the edge
      // (C8). Clamping the target used to pin it to the boundary: the clamped
      // cell is still passable, so it moved there and stayed, and animals spent
      // ~half their time in the 2-cell edge band. Reflection is a bounce — flip
      // the offending velocity component and re-derive the heading — and the new
      // heading is committed so it keeps leading away rather than re-aiming at
      // the wall next tick.
      let heading = intent.heading;
      let dx = Math.cos(heading) * step;
      let dy = Math.sin(heading) * step;
      let bounced = false;
      if (entity.x + dx < 0 || entity.x + dx > world.width) { dx = -dx; bounced = true; }
      if (entity.y + dy < 0 || entity.y + dy > world.height) { dy = -dy; bounced = true; }
      if (bounced) heading = normalizeAngle(Math.atan2(dy, dx));
      const targetX = world.clampX(entity.x + dx);
      const targetY = world.clampY(entity.y + dy);

      // The three ways a step fails — impassable terrain, a thicket edge the
      // animal has not been cleared to break into, and a full cell — all live in
      // `stepRefused`. Thicket is passable but a crawl, so an animal treats its
      // edge as a wall unless it is already inside one (and can push back out) or
      // the decision system has explicitly marked this step a **break-in**
      // (`intent.breakThicket`), which it does in exactly two last-resort
      // situations: a *cornered* flee with no open ground left to skirt to, and
      // an animal in acute need pushing through a thin band toward water or food
      // just beyond it (the corner-lake case). The crowding cap gates *entry*
      // only, so moving within a full cell or out of one is always allowed.
      // Standing still (eat/rest/drink) never reaches here — only a committed
      // step does.
      if (!stepRefused(world, entity, targetX, targetY, intent.breakThicket === true, this.maxOccupantsPerCell)) {
        const from = { x: entity.x, y: entity.y };
        world.moveEntity(entity, targetX, targetY, heading);
        entity.lastMoveDistance = Math.hypot(entity.x - from.x, entity.y - from.y);
        if (bounced) intent.heading = heading;
        context.emit(EventTypes.ENTITY_MOVED, {
          entityId: entity.id,
          from,
          to: { x: entity.x, y: entity.y },
        });
      } else {
        // Blocked: turn around and expire the commitment so the decision
        // system re-commits a fresh heading next tick.
        //
        // ⚠⚠ **`refused` is the whole reason a blocked seeker ever gets free**
        // (2026-08-01). The turn-around above only ever worked for `wander`,
        // which reads the previous intent; every *directed* action builds a fresh
        // intent from `atan2(target - self)` each tick and threw this recovery
        // away, so an animal aimed at water through a rock re-aimed at the same
        // rock forever. Measured before the fix, seed 1 demo: 15.6% of directed
        // animal-ticks were blocked-and-immobile, with runs of up to 372
        // consecutive ticks holding `seekWater` at 6% hydration; at rocks=6
        // thickets=8, 40.6% and runs of 964. The flag is what lets the decision
        // system see the block and deflect around it.
        //
        // Safe to set without ever clearing: `#intentFor` allocates a **new**
        // intent object on every branch on every tick, so this one can never be
        // read a second time. A branch that starts reusing an intent object must
        // clear it.
        entity.lastMoveDistance = 0;
        intent.heading = normalizeAngle(intent.heading + Math.PI);
        intent.ttl = 0;
        intent.refused = true;
        entity.heading = intent.heading;
      }
    }
  }
}
