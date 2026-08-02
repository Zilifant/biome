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
// Frailty (2026-08-01): what the weather costs depends on what is already wrong
// with the animal. Derived from the compartment on read, exactly as the movement
// system reads it, so it can never disagree with the disease state.
import { diseaseSeverity } from '../disease/disease.js';

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
   * @param {number} [options.shelterStressThreshold] °C at which the weather is "biting":
   *        the one threshold both the `shelter` drive and the exposure label read
   * @param {number} [options.exposureFrailty] how much a wound or an illness
   *        multiplies the thermoregulation cost
   * @param {number} [options.exposureFloorFraction] the reserve fraction the
   *        weather alone may not take a sound adult below
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
    // ⚠⚠ **One threshold, read by the behaviour and by the death label**
    // (2026-08-01). There used to be two: `shelterStressThreshold` (2 °C) decided
    // when an animal would walk to cover, and a separate `exposureStressThreshold`
    // (0.35 °C) decided when an energy death was *called* exposure. Measured on
    // seed 1, **127 709 animal-ticks** sat in the gap — cold enough to be recorded
    // as freezing to death, not cold enough for the animal to have any reason to
    // do something about it. A label that fires where the behaviour does not is a
    // label that lies, so there is now one number with one home (D11).
    shelterStressThreshold = 2,
    exposureFrailty = 1.5,
    exposureFloorFraction = 0.05,
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
    this.shelterStressThreshold = shelterStressThreshold;
    this.exposureFrailty = exposureFrailty;
    this.exposureFloorFraction = exposureFloorFraction;
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

      // Per-species bioenergetics (Step 29, closing §1.4 B3). Until now every
      // animal paid the grazer's basal rate and the grazer's cost per unit of
      // travel, whatever it was. One `Map.get` of a pre-resolved, pre-frozen
      // record — no merging or defaulting in the loop, per the step's
      // performance note.
      const params = world.species.get(entity.speciesId)?.metabolism ?? this;
      // A more efficient individual (Step 14) burns proportionally less for the
      // same mass and the same distance travelled.
      const massFactor = (entity.bodyMass / params.referenceMass) ** params.massScalingExponent / entity.traits.metabolicEfficiency;
      const basalCost = params.basalRate * massFactor;
      const moveCost = params.moveCostFactor * entity.lastMoveDistance * massFactor;
      // Holding body temperature against the weather (Step 19). Cover shelters
      // an animal from part of the swing, which is what makes seeking it worth
      // the walk. Charged as energy, so cold kills by burning an animal out —
      // which is what hypothermia actually is.
      const stress = this.thermalStress(world, entity);
      // ⚠⚠ **What the weather does depends on the condition of the animal it
      // finds** (2026-08-01). Measured before this: 3 seeds × 6000 ticks of the
      // demo produced **59 exposure deaths, 47 of them sound adults** — four times
      // the world's starvation deaths — and *none* of them had a storm on them.
      // Thermoregulation was 40% of a leopard's entire energy budget and ~23% of a
      // gazelle's, so it was not an event killing animals, it was a standing tax
      // that a healthy animal could not out-earn. That is the wrong shape: an
      // adult in its prime does not freeze to death in ordinary weather, it gets
      // hungry.
      //
      // Two changes, both here, because this is the one place the weather turns
      // into a number:
      //
      //   * **Frailty.** A wound or an illness makes an animal worse at holding
      //     its own temperature, so the cost is multiplied by what is already
      //     wrong with it. This is where exposure *should* bite, and it is the
      //     only place the multiplier is above 1.
      //   * **A floor for a sound adult.** The thermal charge alone may not take
      //     an animal in good condition below `exposureFloorFraction` of its
      //     reserve. It still pays, it still ends up hungry, and basal cost and
      //     travel can still empty it — but then it starved, which is the honest
      //     cause. Cold weather now kills a healthy adult only by way of the food
      //     it could not find.
      //
      // ⚠ A *sound adult* is `lifeStage === 'adult'` with no wound and no illness.
      // A calf, a subadult, a senescent animal, a wounded one and a sick one all
      // keep the old behaviour and can still freeze — which is both what the
      // ecology wants and what makes the `exposure` cause mean something when it
      // does appear.
      const frailtyOf = entity.impairment + diseaseSeverity(entity, 1);
      const sound = frailtyOf <= 0 && entity.lifeStage === 'adult';
      let thermalCost = this.thermalCostFactor * stress * massFactor * (1 + this.exposureFrailty * Math.min(1, frailtyOf));
      if (sound && thermalCost > 0) {
        const floor = this.exposureFloorFraction * entity.maxEnergy;
        thermalCost = Math.max(0, Math.min(thermalCost, entity.energy - basalCost - moveCost - floor));
      }
      entity.lastMoveDistance = 0; // consumed; movement re-records it next tick

      // Stamina recovers whenever the animal did not sprint this tick — the
      // "recover" stage of the hunt pipeline, and what makes a failed chase
      // cost a predator time as well as energy. The movement system is the
      // only thing that spends it.
      if (entity.stamina < entity.maxStamina) {
        entity.stamina = Math.min(entity.maxStamina, entity.stamina + this.staminaRecoveryPerTick);
      }

      entity.energy = Math.max(0, entity.energy - basalCost - moveCost - thermalCost);
      entity.lowEnergy = entity.energy < params.lowEnergyFraction * entity.maxEnergy;

      if (entity.energy <= 0) {
        // Same mechanism either way — an empty animal dies — but an animal that
        // burned out while fighting the weather died of exposure, not hunger,
        // and saying so is the difference between a readable ecosystem and a
        // pile of identical "starvation" events.
        // ⚠⚠ **Two conditions, and the second one is what makes the label true.**
        // The first is the same threshold the `shelter` drive engages at, so
        // "exposure" can only name a death the animal had a reason to try to
        // avoid. The second is `!sound`: a sound adult's thermal charge was
        // floored above zero, so the weather demonstrably was *not* the blow that
        // emptied it — basal cost and travel were, and that is starvation with a
        // cold wind on it. Without this clause the floor still let 2 of 3 seeds'
        // sound adults die "of exposure" on a charge they had been protected
        // from, which is the same lying label in the other direction.
        const cause = stress >= this.shelterStressThreshold && !sound ? 'exposure' : 'starvation';
        killAnimal(entity, cause, entity.bodyMass * params.edibleMassFraction, context.emit, context.tick);
      }
    }
  }
}
