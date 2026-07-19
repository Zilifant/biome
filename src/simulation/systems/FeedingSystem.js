/**
 * Herbivory (Step 9): animals that chose to eat remove biomass from the cell
 * they stand on and assimilate it to energy. This closes the survival loop —
 * move → perceive → decide → eat → gain energy → spend (metabolism) → live or
 * die.
 *
 * Runs in the `interaction` phase (after movement, before metabolism), so an
 * animal that decided to eat has already stayed put and its intake this tick
 * offsets the basal cost charged later the same tick. Multiple eaters on one
 * cell contend deterministically: entities are processed in ascending id order
 * (creation order), so earlier ids eat first and later ones get whatever
 * biomass remains.
 *
 * Ownership: writes `energy` (gain, clamped to `maxEnergy`) and vegetation
 * biomass (decrement via `VegetationGrid.consumeAt`), and records where the
 * animal ate — or failed to (Step 15); emits `entity.fed`. No randomness, no
 * global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { recordMemory, forgetMemory, MemoryKinds, MAX_MEMORIES } from '../memory/memories.js';

export class FeedingSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.intakeRate] biomass eaten per tick per animal
   * @param {number} [options.energyPerBiomass] energy per biomass unit
   * @param {number} [options.efficiency] assimilation fraction (≤ 1)
   * @param {number} [options.maxMemories] cap on remembered places per animal
   * @param {number} [options.updateInterval]
   */
  constructor({ intakeRate = 0.6, energyPerBiomass = 10, efficiency = 0.6, maxMemories = MAX_MEMORIES, updateInterval = 1 } = {}) {
    super({ id: 'feeding', phase: 'interaction', priority: 0, updateInterval });
    this.intakeRate = intakeRate;
    this.energyPerBiomass = energyPerBiomass;
    this.efficiency = efficiency;
    this.maxMemories = maxMemories;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      // An unweaned juvenile lives on its guardian's provisioning (Step 13) and
      // never grazes; the decision system will not choose `eat` for one, and
      // this guard keeps that true no matter how the action was set.
      if (entity.kind !== 'animal' || !entity.alive || entity.action !== 'eat') continue;
      if (entity.guardianId !== null && !entity.weaned) continue;

      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      // Don't overeat past satiation: cap intake by the energy deficit as well.
      const deficit = entity.maxEnergy - entity.energy;
      const maxUsefulBiomass = deficit / (this.energyPerBiomass * this.efficiency);
      const desired = Math.min(this.intakeRate, maxUsefulBiomass);
      if (desired <= 0) continue;

      const removed = world.vegetation.consumeAt(cellX, cellY, desired);
      if (removed <= 0) {
        // Came here to eat and found nothing (Step 15): remember the cell as
        // barren and stop believing it is a food patch, so the animal does not
        // walk straight back to it.
        forgetMemory(entity, MemoryKinds.FOOD, cellX, cellY);
        recordMemory(entity, MemoryKinds.BARREN, cellX, cellY, context.tick, this.maxMemories);
        continue;
      }

      const gain = removed * this.energyPerBiomass * this.efficiency;
      entity.energy = Math.min(entity.maxEnergy, entity.energy + gain);
      // Ate well here — worth coming back to (Step 15).
      recordMemory(entity, MemoryKinds.FOOD, cellX, cellY, context.tick, this.maxMemories);
      context.emit(EventTypes.ENTITY_FED, {
        entityId: entity.id,
        cell: { cellX, cellY },
        amount: removed,
      });
    }
  }
}
