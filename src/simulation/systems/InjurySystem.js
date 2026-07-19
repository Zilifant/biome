/**
 * Healing (Step 17) — the other half of `injury/injuries.js`.
 *
 * Inflicting an injury is done by whatever caused it (a failed capture today;
 * hazards and fights later). This system does the recovery: every tick an
 * injured animal that can afford it spends energy to close its wounds a little,
 * regaining health as it does, until the injury fades entirely. An animal too
 * hungry to spare the energy simply does not heal — being wounded and being
 * starved compound each other, which is what makes an injury dangerous rather
 * than merely inconvenient.
 *
 * Death from injury goes through the same `health <= 0` path as dehydration:
 * the wound takes health when it lands, and if that empties the animal it dies
 * with cause `injury`.
 *
 * Runs in the `physiology` phase at priority 10 — after metabolism and
 * hydration, so healing is charged against the energy the animal actually has
 * left this tick.
 *
 * Ownership: writes `injuries[]` (severity and removal only — never inflicts),
 * `impairment`, `health`, and spends `energy`. Emits `entity.recovered` and
 * records the recovery in the animal's life history. No randomness, no scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { killAnimal } from './death.js';
import { refreshImpairment, HEALED_BELOW } from '../injury/injuries.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';

export class InjurySystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.healRatePerTick] severity closed per tick
   * @param {number} [options.healEnergyCost] energy per unit of severity healed
   * @param {number} [options.healEnergyFloor] energy fraction below which healing stops
   * @param {number} [options.healthPerSeverity] health regained per unit healed
   * @param {number} [options.edibleMassFraction] carcass edible mass fraction
   * @param {number} [options.updateInterval]
   */
  constructor({
    healRatePerTick = 0.0015,
    healEnergyCost = 20,
    healEnergyFloor = 0.3,
    healthPerSeverity = 60,
    edibleMassFraction = 0.6,
    updateInterval = 1,
  } = {}) {
    super({ id: 'injury', phase: 'physiology', priority: 10, updateInterval });
    this.healRatePerTick = healRatePerTick;
    this.healEnergyCost = healEnergyCost;
    this.healEnergyFloor = healEnergyFloor;
    this.healthPerSeverity = healthPerSeverity;
    this.edibleMassFraction = edibleMassFraction;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // A wound that has already emptied an animal kills it, whoever inflicted
      // it — the same path dehydration takes.
      if (entity.health <= 0) {
        killAnimal(entity, 'injury', entity.bodyMass * this.edibleMassFraction, context.emit, context.tick);
        continue;
      }
      if (entity.injuries.length === 0) continue;

      // Healing is paid for. Too hungry to spare the energy means too hungry to
      // mend, so an injured animal that cannot feed stays injured.
      if (entity.energy < this.healEnergyFloor * entity.maxEnergy) continue;

      const healed = this.healRatePerTick * this.updateInterval;
      let closed = 0;
      for (let i = entity.injuries.length - 1; i >= 0; i -= 1) {
        const injury = entity.injuries[i];
        const before = injury.severity;
        injury.severity -= healed;
        closed += before - Math.max(0, injury.severity);
        if (injury.severity <= HEALED_BELOW) {
          entity.injuries.splice(i, 1);
          recordLifeEvent(entity, context.tick, LifeEventTypes.RECOVERED, { injury: injury.kind });
          context.emit(EventTypes.ENTITY_RECOVERED, { entityId: entity.id, injury: injury.kind });
        }
      }

      if (closed > 0) {
        entity.energy = Math.max(0, entity.energy - closed * this.healEnergyCost);
        entity.health = Math.min(entity.maxHealth, entity.health + closed * this.healthPerSeverity);
      }
      refreshImpairment(entity);
    }
  }
}
