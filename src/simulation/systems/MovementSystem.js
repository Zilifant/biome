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
 * Ownership: writes `x`, `y`, `heading`, `lastMoveDistance`, **`elevation`**,
 * drains `stamina` while sprinting (the metabolism system recovers it), and (on
 * a block) adjusts `moveIntent`. No randomness — determinism lives in the
 * decision system's committed heading. No global scans.
 *
 * ⚠ **`elevation` is written here and nowhere else** (phase T2). This is the
 * system that turns a decision into a position, and being up a tree is a
 * position; putting the write anywhere else would give the field two owners,
 * which DOCS §5 forbids outright. See `locomotion/climbing.js` for what
 * elevation gates — and, more importantly, for what it deliberately does not.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { normalizeStepRules, stepLength, stepRefused } from '../locomotion/steps.js';
import { CANOPY, elevationFor } from '../locomotion/climbing.js';

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
  constructor({ sprintMultiplier = 1.6, sprintStaminaCost = 2.5, injurySpeedPenalty = 0.5, diseaseSpeedPenalty = 0.45, maxOccupantsPerCell = null, climbing = false, cacheHaulReach = 1.5, updateInterval = 1 } = {}) {
    super({ id: 'movement.execute', phase: 'movement', priority: 0, updateInterval });
    // Elevation (phase T2). ⚠ The world-level switch, from `config.climbing` —
    // it cannot live in a species block, because a species block beats the
    // config (DOCS §8). Off, every animal is on the ground and this system is
    // exactly what it was.
    this.climbing = climbing;
    // How close a hauled carcass must stay to the animal dragging it (phase
    // T3). Matched to `feeding.carcassRange` by the composition root, since
    // it is the same reach: what you can eat from, you can drag.
    this.cacheHaulReach = cacheHaulReach;
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

  /**
   * Drag the carcass this animal is hauling to its own position, and hoist it
   * into the canopy once it is standing under a tree (phase T3).
   *
   * ⚠ **The arrival test is the hauler's own cell, not a distance to the target
   * cell**, and that is deliberate: the decision system picks the tree, the
   * animal walks to it through whatever detours the terrain forces, and the only
   * thing that decides "arrived" is standing on a tree. So a cat that ends up
   * under a *different* tree on the way has still cached its kill, which is the
   * honest outcome rather than a bug.
   *
   * ⚠ The carcass is dropped rather than dragged if it has drifted out of reach —
   * something took it, or the hauler was pushed off it — and the decision system
   * re-decides from scratch next tick. There is no stuck state to clear.
   */
  #haul(world, entity) {
    const carcass = world.entities.get(entity.cacheTargetId);
    if (!carcass || carcass.kind !== 'carcass') return;
    if (Math.hypot(carcass.x - entity.x, carcass.y - entity.y) > this.cacheHaulReach) return;
    world.moveEntity(carcass, entity.x, entity.y, carcass.heading);
    // ⚠ The hauler stays on the ground — `cache` is deliberately not one of the
    // actions that keep a climber aloft (see `locomotion/climbing.js`), because
    // an animal in the canopy does not step and a mid-haul climb would freeze
    // the haul. It hoists the body and remains below it; being *able* to climb
    // is what lets it feed there afterwards.
    if (world.isTreeAt(entity.x, entity.y)) carcass.elevation = CANOPY;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      // Elevation (phase T2), and this system owns the field because it is the
      // one that already turns "what I decided" into "where I am". ⚠ Derived
      // fresh from the action and the ground underfoot rather than stored as a
      // transition, so there is no climbing state to get stuck in and no timer
      // to expire — the same discipline that keeps possession held by presence.
      // `elevationFor` short-circuits on the switch and then on `climbs`, so for
      // a roster that declares no climber this is one comparison per animal.
      if (this.climbing) {
        entity.elevation = elevationFor(world, entity, world.species.get(entity.speciesId), true);
      }
      const intent = entity.moveIntent;
      if (!intent || !intent.moving) {
        entity.lastMoveDistance = 0;
        continue;
      }
      // ⚠ **An animal in a tree does not step, whatever its intent says.** It
      // reads as "not moving" rather than as a refused step: a refusal sets
      // `intent.refused`, which the decision system takes as an obstacle to
      // deflect around (A65), and there is no obstacle here — the animal simply
      // chose to be where it is. Coming down is choosing to go somewhere, which
      // `elevationFor` has already resolved above.
      if (entity.elevation === CANOPY) {
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
        // Hauling a kill (phase T3). ⚠ **The first thing in this engine that ever
        // moves a carcass**, which is why it goes through `world.moveEntity` like
        // every other position change — the spatial grid is what scavenging
        // queries, and a body dragged behind the index would be invisible to
        // everything looking for it. Nothing else about a carcass changes: it
        // decays on the same clock and returns the same nutrients.
        if (this.climbing && entity.cacheTargetId !== null) this.#haul(world, entity);
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
