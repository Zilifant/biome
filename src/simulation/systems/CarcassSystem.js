/**
 * Carcasses and decay (Step 18) — closing the death→nutrient loop that Step 6
 * opened when animals first started dying in place.
 *
 * A carcass is a real resource with a clock on it. It passes through decay
 * stages as it ages, and its flesh is worth progressively less: a fresh kill is
 * a windfall, a dry one is barely worth crossing the map for. It leaves the
 * world when it is either eaten clean or fully rotted, and when it goes it puts
 * something back — a pulse of biomass into the cell it lay on, so the animal
 * that grazed there ends up feeding the grass.
 *
 * Runs in the `physiology` phase at priority 20 — after feeding (interaction)
 * has already taken its bite this tick, so nothing is ever removed out from
 * under a scavenger mid-meal. Removal itself is queued, not immediate, and the
 * engine flushes it after `cleanup` like every other structural change.
 *
 * This is where the world first *forgets* things (§1.4 ⚠ C2). The tombstone is
 * written by the engine's removal chokepoint, not here, so no removal path can
 * bypass it; see `world/lineage.js` for the policy.
 *
 * Ownership: writes `decayStage` and removes carcasses; adds biomass to the
 * vegetation grid on removal. No randomness — decay is a pure function of
 * elapsed time. No scans beyond the single entity pass.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';

/**
 * Decay stage names, coarsest possible. The protocol sends the integer index;
 * these exist so the legend and inspection can be read by a human.
 */
export const DECAY_STAGES = Object.freeze(['fresh', 'ripe', 'dry', 'remains']);

/**
 * Fraction of a carcass's nominal energy still available at each stage. A fresh
 * kill is worth the most; picking at old remains is nearly pointless, which is
 * what makes a predator prefer to hunt rather than live off the landscape.
 */
export const STAGE_YIELD = Object.freeze([1, 0.8, 0.5, 0.25]);

export class CarcassSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.decayTicks] ticks from death to fully rotted
   * @param {number} [options.nutrientReturn] biomass returned per kg of remaining mass
   * @param {number} [options.updateInterval] decay is staggered; stages are coarse
   */
  constructor({ decayTicks = 3000, nutrientReturn = 0.5, updateInterval = 5 } = {}) {
    super({ id: 'carcass', phase: 'physiology', priority: 20, updateInterval });
    this.decayTicks = decayTicks;
    this.nutrientReturn = nutrientReturn;
  }

  update(world, context) {
    const stageSpan = this.decayTicks / DECAY_STAGES.length;
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'carcass') continue;

      const elapsed = context.tick - (entity.diedTick ?? context.tick);
      const stage = Math.min(DECAY_STAGES.length - 1, Math.max(0, Math.floor(elapsed / stageSpan)));
      if (stage !== entity.decayStage) {
        entity.decayStage = stage;
        context.emit(EventTypes.ENTITY_DECAYED, {
          entityId: entity.id,
          stage,
          stageName: DECAY_STAGES[stage],
          edibleMass: entity.edibleMass,
        });
      }

      // Eaten clean, or rotted away. Either way it stops being a resource.
      if (entity.edibleMass > 0 && elapsed < this.decayTicks) continue;

      // What is left goes back into the ground. A carcass eaten to nothing
      // returns nothing — the scavengers already took it.
      if (entity.edibleMass > 0 && this.nutrientReturn > 0) {
        const { cellX, cellY } = world.cellOf(entity.x, entity.y);
        world.vegetation.addAt(cellX, cellY, entity.edibleMass * this.nutrientReturn);
      }
      entity.edibleMass = 0;
      context.queueRemove(entity.id);
    }
  }

  /**
   * How much energy a unit of this carcass's flesh is still worth. Public so
   * the feeding system and tests share one definition of freshness.
   * @param {object} carcass
   * @returns {number} multiplier in (0, 1]
   */
  static yieldFor(carcass) {
    return STAGE_YIELD[carcass.decayStage] ?? STAGE_YIELD[STAGE_YIELD.length - 1];
  }
}
