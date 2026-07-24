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
import { diseaseSeverity } from '../disease/disease.js';

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
   * @param {number} [options.updateInterval]
   */
  constructor({ sprintMultiplier = 1.6, sprintStaminaCost = 2.5, injurySpeedPenalty = 0.5, diseaseSpeedPenalty = 0.45, updateInterval = 1 } = {}) {
    super({ id: 'movement.execute', phase: 'movement', priority: 0, updateInterval });
    this.sprintMultiplier = sprintMultiplier;
    this.sprintStaminaCost = sprintStaminaCost;
    this.diseaseSpeedPenalty = diseaseSpeedPenalty;
    this.injurySpeedPenalty = injurySpeedPenalty;
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
      const pace = sprinting ? this.sprintMultiplier : 1;
      // An injured animal limps (Step 17): `impairment` is the cached total
      // severity of its wounds, so this is one multiply, not a list walk.
      const injured = 1 - entity.impairment * this.injurySpeedPenalty;
      // Illness slows an animal the same way a wound does (Step 25), and the
      // two stack — a sick, mauled animal is in real trouble. Derived from the
      // compartment on read, so it can never disagree with the disease state.
      const ill = 1 - diseaseSeverity(entity, this.diseaseSpeedPenalty);
      const step = entity.speed * pace * injured * ill * world.speedModifierAt(entity.x, entity.y);

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

      // Thicket is passable but a crawl, so an animal treats its edge as a wall
      // and turns away. Two exceptions, and *only* two: it is already inside one
      // (so it can push back out rather than being trapped), or the decision
      // system has explicitly marked this step a **break-in** (`intent.breakThicket`).
      // The decision system sets that flag in exactly two situations, both of
      // last resort: a *cornered* flee with no open ground left to skirt to, and
      // an animal in acute need pushing through a thin band toward water or food
      // just beyond it (the corner-lake case). Merely fleeing is no longer enough
      // to drive an animal into cover (A18): a pursuer that is not itself cornered
      // stops at the edge, and so does the prey until it must juke inside. Standing
      // still (eat/rest/drink) never triggers this — only a committed step does.
      const refusesThicket =
        world.isThicketAt(targetX, targetY) &&
        !world.isThicketAt(entity.x, entity.y) &&
        intent.breakThicket !== true;

      if (world.isPassableAt(targetX, targetY) && !refusesThicket) {
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
        entity.lastMoveDistance = 0;
        intent.heading = normalizeAngle(intent.heading + Math.PI);
        intent.ttl = 0;
        entity.heading = intent.heading;
      }
    }
  }
}
