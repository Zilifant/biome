/**
 * Hydration / thirst (Step 10).
 *
 * Every living animal dehydrates a little each tick. An animal that chose to
 * drink and is within `drinkRange` of a water cell restores hydration (net
 * gain, since drink rate far exceeds dehydration). Sustained dehydration
 * (hydration at zero) damages health, and when health is exhausted the animal
 * dies of dehydration and becomes a carcass.
 *
 * Water is terrain-bound (lakes), while food (vegetation) covers the ground,
 * so seeking water is a spatially distinct behaviour from grazing — animals
 * shuttle between the lake and the grass.
 *
 * Runs in the `physiology` phase (alongside metabolism, after movement/feeding
 * have positioned and fed the animal). Ownership: writes `hydration` and, on
 * severe dehydration, `health` (and kills via the shared helper), and records
 * where the animal drank (Step 15). Reads the perceived nearest water. No
 * randomness, no global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { killAnimal } from './death.js';
import { recordMemory, MemoryKinds, MAX_MEMORIES } from '../memory/memories.js';

export class HydrationSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.dehydrationRate] hydration lost per tick
   * @param {number} [options.drinkRate] hydration restored per tick while drinking
   * @param {number} [options.drinkRange] max distance to water to drink
   * @param {number} [options.dehydrationDamage] health lost per tick at zero hydration
   * @param {number} [options.edibleMassFraction] carcass edible mass fraction
   * @param {number} [options.maxMemories] cap on remembered places per animal
   * @param {number} [options.updateInterval]
   */
  constructor({
    dehydrationRate = 0.05,
    drinkRate = 5,
    drinkRange = 1.5,
    dehydrationDamage = 0.5,
    edibleMassFraction = 0.6,
    maxMemories = MAX_MEMORIES,
    updateInterval = 1,
  } = {}) {
    super({ id: 'hydration', phase: 'physiology', priority: 0, updateInterval });
    this.dehydrationRate = dehydrationRate;
    this.drinkRate = drinkRate;
    this.drinkRange = drinkRange;
    this.dehydrationDamage = dehydrationDamage;
    this.edibleMassFraction = edibleMassFraction;
    this.maxMemories = maxMemories;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // Per-species water economy (Step 29, §1.4 B3): a predator gets much of
      // its water from what it eats, so it dries out more slowly than the animal
      // it is eating. That was previously impossible to express.
      const params = world.species.get(entity.speciesId)?.hydration ?? this;
      let hydration = entity.hydration - params.dehydrationRate;
      if (entity.action === 'drink') {
        const nearestWater = world.perception.get(entity.id)?.nearestWater ?? null;
        if (nearestWater && nearestWater.distance <= params.drinkRange) {
          hydration += params.drinkRate;
          // Drank here (Step 15). Lakes do not move, so this is the memory an
          // animal can most safely act on long after the fact.
          recordMemory(entity, MemoryKinds.WATER, nearestWater.cellX, nearestWater.cellY, context.tick, this.maxMemories);
        }
      }
      entity.hydration = Math.min(entity.maxHydration, Math.max(0, hydration));

      if (entity.hydration <= 0) {
        entity.health = Math.max(0, entity.health - params.dehydrationDamage);
        if (entity.health <= 0) {
          killAnimal(entity, 'dehydration', entity.bodyMass * params.edibleMassFraction, context.emit, context.tick);
        }
      }
    }
  }
}
