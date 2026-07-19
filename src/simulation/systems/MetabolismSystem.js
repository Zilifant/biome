/**
 * Bioenergetics (Step 6): every living animal pays a basal energy cost each
 * tick plus a movement cost proportional to the distance it travelled, both
 * scaled by body mass. When stored energy hits zero the animal starves: it
 * dies in place and becomes a carcass (edible mass ∝ body mass) that later
 * scavenging (Step 18) will consume.
 *
 * Runs in the `physiology` phase, after `movement`, so the movement system has
 * already recorded this tick's travelled distance on `entity.lastMoveDistance`
 * (which this system consumes and resets — robust to staggered movement).
 *
 * Ownership: writes `energy`, `lowEnergy`, recovers `stamina` (Step 16), and —
 * on death — `alive`, `kind`, `edibleMass`. Reads the `metabolicEfficiency`
 * trait. No randomness
 * (deterministic arithmetic); no global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { killAnimal } from './death.js';

export class MetabolismSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.basalRate]
   * @param {number} [options.moveCostFactor]
   * @param {number} [options.referenceMass]
   * @param {number} [options.massScalingExponent]
   * @param {number} [options.lowEnergyFraction]
   * @param {number} [options.edibleMassFraction]
   * @param {number} [options.staminaRecoveryPerTick] sprint budget regained when not sprinting
   * @param {number} [options.updateInterval]
   */
  constructor({
    basalRate = 0.04,
    moveCostFactor = 0.02,
    referenceMass = 30,
    massScalingExponent = 0.75,
    lowEnergyFraction = 0.25,
    edibleMassFraction = 0.6,
    staminaRecoveryPerTick = 0.6,
    updateInterval = 1,
  } = {}) {
    super({ id: 'metabolism', phase: 'physiology', priority: 0, updateInterval });
    this.basalRate = basalRate;
    this.moveCostFactor = moveCostFactor;
    this.referenceMass = referenceMass;
    this.massScalingExponent = massScalingExponent;
    this.lowEnergyFraction = lowEnergyFraction;
    this.edibleMassFraction = edibleMassFraction;
    this.staminaRecoveryPerTick = staminaRecoveryPerTick;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // A more efficient individual (Step 14) burns proportionally less for the
      // same mass and the same distance travelled.
      const massFactor = (entity.bodyMass / this.referenceMass) ** this.massScalingExponent / entity.traits.metabolicEfficiency;
      const basalCost = this.basalRate * massFactor;
      const moveCost = this.moveCostFactor * entity.lastMoveDistance * massFactor;
      entity.lastMoveDistance = 0; // consumed; movement re-records it next tick

      // Stamina recovers whenever the animal did not sprint this tick — the
      // "recover" stage of the hunt pipeline, and what makes a failed chase
      // cost a predator time as well as energy. The movement system is the
      // only thing that spends it.
      if (entity.stamina < entity.maxStamina) {
        entity.stamina = Math.min(entity.maxStamina, entity.stamina + this.staminaRecoveryPerTick);
      }

      entity.energy = Math.max(0, entity.energy - basalCost - moveCost);
      entity.lowEnergy = entity.energy < this.lowEnergyFraction * entity.maxEnergy;

      if (entity.energy <= 0) {
        // Starve: die in place and become a carcass (identity preserved).
        killAnimal(entity, 'starvation', entity.bodyMass * this.edibleMassFraction, context.emit, context.tick);
      }
    }
  }
}
