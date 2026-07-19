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
 * trait and the global environment (Step 19). No randomness
 * (deterministic arithmetic); no global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { killAnimal } from './death.js';
import { thermalStress } from '../world/Environment.js';

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
   * @param {number} [options.thermalCostFactor] energy per °C outside comfort
   * @param {number} [options.shelterRelief] fraction of thermal stress cover removes
   * @param {number} [options.exposureStressThreshold] °C of stress that makes a death exposure
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
    thermalCostFactor = 0.06,
    shelterRelief = 0.55,
    exposureStressThreshold = 0.35,
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
    this.thermalCostFactor = thermalCostFactor;
    this.shelterRelief = shelterRelief;
    this.exposureStressThreshold = exposureStressThreshold;
  }

  /**
   * Convenience wrapper over the shared definition in `world/Environment.js`,
   * bound to this system's shelter relief. Public so tests can read the same
   * number the energy cost is computed from.
   *
   * @param {import('../world/World.js').World} world
   * @param {object} entity
   * @returns {number} degrees of stress, 0 when comfortable
   */
  thermalStress(world, entity) {
    return thermalStress(world, entity, this.shelterRelief);
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // A more efficient individual (Step 14) burns proportionally less for the
      // same mass and the same distance travelled.
      const massFactor = (entity.bodyMass / this.referenceMass) ** this.massScalingExponent / entity.traits.metabolicEfficiency;
      const basalCost = this.basalRate * massFactor;
      const moveCost = this.moveCostFactor * entity.lastMoveDistance * massFactor;
      // Holding body temperature against the weather (Step 19). Cover shelters
      // an animal from part of the swing, which is what makes seeking it worth
      // the walk. Charged as energy, so cold kills by burning an animal out —
      // which is what hypothermia actually is.
      const stress = this.thermalStress(world, entity);
      const thermalCost = this.thermalCostFactor * stress * massFactor;
      entity.lastMoveDistance = 0; // consumed; movement re-records it next tick

      // Stamina recovers whenever the animal did not sprint this tick — the
      // "recover" stage of the hunt pipeline, and what makes a failed chase
      // cost a predator time as well as energy. The movement system is the
      // only thing that spends it.
      if (entity.stamina < entity.maxStamina) {
        entity.stamina = Math.min(entity.maxStamina, entity.stamina + this.staminaRecoveryPerTick);
      }

      entity.energy = Math.max(0, entity.energy - basalCost - moveCost - thermalCost);
      entity.lowEnergy = entity.energy < this.lowEnergyFraction * entity.maxEnergy;

      if (entity.energy <= 0) {
        // Same mechanism either way — an empty animal dies — but an animal that
        // burned out while fighting the weather died of exposure, not hunger,
        // and saying so is the difference between a readable ecosystem and a
        // pile of identical "starvation" events.
        const cause = stress >= this.exposureStressThreshold ? 'exposure' : 'starvation';
        killAnimal(entity, cause, entity.bodyMass * this.edibleMassFraction, context.emit, context.tick);
      }
    }
  }
}
