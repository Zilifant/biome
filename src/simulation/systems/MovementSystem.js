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
 * Ownership: writes `x`, `y`, `heading`, `lastMoveDistance`, and (on a block)
 * adjusts `moveIntent`. No randomness — determinism lives in the decision
 * system's committed heading. No global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';

const TWO_PI = Math.PI * 2;

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

export class MovementSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.updateInterval]
   */
  constructor({ updateInterval = 1 } = {}) {
    super({ id: 'movement.execute', phase: 'movement', priority: 0, updateInterval });
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const intent = entity.moveIntent;
      if (!intent || !intent.moving) {
        entity.lastMoveDistance = 0;
        continue;
      }

      const step = entity.speed * world.speedModifierAt(entity.x, entity.y);
      const targetX = world.clampX(entity.x + Math.cos(intent.heading) * step);
      const targetY = world.clampY(entity.y + Math.sin(intent.heading) * step);

      if (world.isPassableAt(targetX, targetY)) {
        const from = { x: entity.x, y: entity.y };
        world.moveEntity(entity, targetX, targetY, intent.heading);
        entity.lastMoveDistance = Math.hypot(entity.x - from.x, entity.y - from.y);
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
