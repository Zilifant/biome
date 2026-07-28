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
   * @param {number} [options.nutrientSpreadRadius] how far the return may spill; 0 = one cell
   * @param {number} [options.updateInterval] decay is staggered; stages are coarse
   */
  constructor({ decayTicks = 3000, nutrientReturn = 0.5, nutrientSpreadRadius = 4, updateInterval = 5 } = {}) {
    super({ id: 'carcass', phase: 'physiology', priority: 20, updateInterval });
    this.decayTicks = decayTicks;
    this.nutrientReturn = nutrientReturn;
    this.nutrientSpreadRadius = nutrientSpreadRadius;
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
        this.#returnNutrients(world, entity);
      }
      entity.edibleMass = 0;
      context.queueRemove(entity.id);
    }
  }

  /**
   * Put a rotted carcass's remaining mass back into the ground, spilling into
   * neighbouring cells when the death cell cannot hold it all.
   *
   * ⚠ **This used to be a single `addAt`, and `addAt` clamps to the cell's
   * carrying capacity and discards the rest** — so the closing half of the
   * death→nutrient loop (Step 6) silently leaked for anything bigger than the
   * reference animal. Measured 2026-07-28 against `vegetation.capacity: 8`: a
   * 30 kg grazer returns ~9 biomass into one cell and loses ~1, which is why
   * nobody noticed; a 45 kg stalker loses about **60%**, and that has been true
   * since Step 16. A 600 kg animal would lose nearly all of it.
   *
   * Spilling outward is also the better model, not just the bigger number: a
   * cell is one world unit — a short stride — and a large body plainly enriches
   * a patch rather than a single square. Cells are visited in Chebyshev rings,
   * row-major within each ring, so the order is fixed and no randomness is
   * involved. Whatever will not fit inside `nutrientSpreadRadius` is genuinely
   * lost, which is an honest bound rather than an unbounded search.
   *
   * `nutrientSpreadRadius: 0` restores the exact pre-2026-07-28 single-cell
   * behaviour, so the change has a reproducible control (DOCS §14).
   *
   * @returns {number} biomass actually returned
   */
  #returnNutrients(world, entity) {
    let remaining = entity.edibleMass * this.nutrientReturn;
    const { cellX, cellY } = world.cellOf(entity.x, entity.y);
    let returned = world.vegetation.addAt(cellX, cellY, remaining);
    remaining -= returned;

    for (let r = 1; remaining > 1e-6 && r <= this.nutrientSpreadRadius; r += 1) {
      for (let dy = -r; dy <= r && remaining > 1e-6; dy += 1) {
        for (let dx = -r; dx <= r && remaining > 1e-6; dx += 1) {
          // The ring at Chebyshev distance r — the cells the inner rings missed.
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const added = world.vegetation.addAt(cellX + dx, cellY + dy, remaining);
          remaining -= added;
          returned += added;
        }
      }
    }
    return returned;
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
