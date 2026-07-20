/**
 * Eating (Step 9, extended Step 16): animals that chose to eat convert what
 * their species can digest into energy — herbivores strip biomass from the cell
 * they stand on, carnivores strip edible mass off a carcass within reach. The
 * branch is on the species' declared `diet`, never on its name. This closes the survival loop —
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
import { CarcassSystem } from './CarcassSystem.js';
import { diseaseSeverity } from '../disease/disease.js';

export class FeedingSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.intakeRate] biomass eaten per tick per animal
   * @param {number} [options.energyPerBiomass] energy per biomass unit
   * @param {number} [options.efficiency] assimilation fraction (≤ 1)
   * @param {number} [options.fleshIntakeRate] carcass mass eaten per tick (carnivores)
   * @param {number} [options.energyPerMass] energy per unit of edible mass
   * @param {number} [options.carnivoreEfficiency] assimilation fraction for flesh
   * @param {number} [options.carcassRange] how far a carnivore reaches for a carcass
   * @param {number} [options.referenceMass] mass at which intake is the stated rate
   * @param {number} [options.massScalingExponent] allometric exponent, shared with metabolism
   * @param {number} [options.injuryFeedPenalty] intake lost at full impairment
   * @param {number} [options.maxMemories] cap on remembered places per animal
   * @param {number} [options.updateInterval]
   */
  constructor({
    intakeRate = 0.6,
    energyPerBiomass = 10,
    efficiency = 0.6,
    fleshIntakeRate = 1.5,
    energyPerMass = 12,
    carnivoreEfficiency = 0.75,
    carcassRange = 1.5,
    referenceMass = 30,
    massScalingExponent = 0.75,
    injuryFeedPenalty = 0.5,
    diseaseFeedPenalty = 0.3,
    maxMemories = MAX_MEMORIES,
    updateInterval = 1,
  } = {}) {
    super({ id: 'feeding', phase: 'interaction', priority: 0, updateInterval });
    this.intakeRate = intakeRate;
    this.energyPerBiomass = energyPerBiomass;
    this.efficiency = efficiency;
    this.fleshIntakeRate = fleshIntakeRate;
    this.energyPerMass = energyPerMass;
    this.carnivoreEfficiency = carnivoreEfficiency;
    this.carcassRange = carcassRange;
    this.referenceMass = referenceMass;
    this.massScalingExponent = massScalingExponent;
    this.injuryFeedPenalty = injuryFeedPenalty;
    this.diseaseFeedPenalty = diseaseFeedPenalty;
    this.maxMemories = maxMemories;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      // An unweaned juvenile lives on its guardian's provisioning (Step 13) and
      // never grazes; the decision system will not choose `eat` for one, and
      // this guard keeps that true no matter how the action was set.
      if (entity.kind !== 'animal' || !entity.alive || entity.action !== 'eat') continue;
      if (entity.guardianId !== null && !entity.weaned) continue;

      // What "eat" means depends on the species' declared diet, never on its
      // name (Step 16). A carnivore eats flesh off a carcass; everyone else
      // grazes the cell it stands on.
      if (world.species.get(entity.speciesId)?.diet === 'carnivore') {
        this.#eatCarcass(world, context, entity);
        continue;
      }

      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      // Don't overeat past satiation: cap intake by the energy deficit as well.
      const deficit = entity.maxEnergy - entity.energy;
      const maxUsefulBiomass = deficit / (this.energyPerBiomass * this.efficiency);
      // A wounded animal feeds badly (Step 17), which is how an injury turns
      // into a slow slide rather than a one-off cost.
      const rate = this.intakeRate * (1 - entity.impairment * this.injuryFeedPenalty) * (1 - diseaseSeverity(entity, this.diseaseFeedPenalty));
      const desired = Math.min(rate, maxUsefulBiomass);
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

  /**
   * Carnivore feeding (Step 16): strip edible mass from the nearest carcass in
   * reach and assimilate it. Carcasses are found through the spatial grid, not
   * a global scan, and the search radius is the same short reach a grazer has
   * to its own cell. General scavenging and decay are Step 18.
   */
  #eatCarcass(world, context, entity) {
    const deficit = entity.maxEnergy - entity.energy;
    if (deficit <= 0) return;

    let carcass = null;
    let bestDistance = Infinity;
    for (const otherId of world.grid.queryRadius(entity.x, entity.y, this.carcassRange)) {
      const other = world.entities.get(otherId);
      if (!other || other.kind !== 'carcass' || other.edibleMass <= 0) continue;
      const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        carcass = other;
      }
    }
    if (!carcass) return;

    // Freshness matters (Step 18): a fresh kill is a windfall, old remains are
    // barely worth the walk. One shared definition, in CarcassSystem.
    const freshness = CarcassSystem.yieldFor(carcass);
    const energyPerUnit = this.energyPerMass * this.carnivoreEfficiency * freshness;
    const maxUseful = energyPerUnit > 0 ? deficit / energyPerUnit : 0;
    // ⚠ Intake is **mass-scaled** (Step 29). Until a third carnivore existed
    // this was a flat rate, so a 4 kg scavenger stripped a carcass exactly as
    // fast as a 45 kg predator — invisible while every carnivore was the same
    // size, and immediately decisive once one was not. Scaled on the same
    // allometric exponent metabolism already uses, so a big animal eats faster
    // *and* burns more, and the reference-mass animal is unchanged.
    const rate =
      this.fleshIntakeRate *
      this.#massScale(entity) *
      (1 - entity.impairment * this.injuryFeedPenalty) *
      (1 - diseaseSeverity(entity, this.diseaseFeedPenalty));
    const taken = Math.min(rate, carcass.edibleMass, maxUseful);
    if (taken <= 0) return;

    carcass.edibleMass -= taken;
    entity.energy = Math.min(entity.maxEnergy, entity.energy + taken * energyPerUnit);
    const { cellX, cellY } = world.cellOf(carcass.x, carcass.y);
    // A kill site is worth remembering, like any other place it fed well.
    recordMemory(entity, MemoryKinds.FOOD, cellX, cellY, context.tick, this.maxMemories);
    context.emit(EventTypes.ENTITY_FED, {
      entityId: entity.id,
      cell: { cellX, cellY },
      amount: taken,
      carcassId: carcass.id,
      freshness,
    });
  }
  /**
   * How fast an animal of this size eats, relative to a reference-mass animal.
   * Shares metabolism's exponent deliberately: an animal that burns more
   * because it is bigger should also be able to take more in.
   * @param {object} entity
   */
  #massScale(entity) {
    if (!(this.referenceMass > 0) || !(entity.bodyMass > 0)) return 1;
    return (entity.bodyMass / this.referenceMass) ** this.massScalingExponent;
  }
}
