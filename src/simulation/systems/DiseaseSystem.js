/**
 * Disease (Step 25) — transmission, progression, and the recovery of condition.
 *
 * **Transmission is driven by the infectious, not by everybody.** The obvious
 * shape — every animal looks around for a sick neighbour — would be a third
 * full neighbour walk per animal per tick, on top of perception's and
 * sociality's (§1.4 C6, already flagged twice). Instead only *infectious*
 * animals query the grid, so the cost is proportional to **prevalence** rather
 * than to population: nothing at all between outbreaks, and a brief rise during
 * one. That is also the more faithful direction — a pathogen spreads outward
 * from a host, it is not sought out by the healthy.
 *
 * Transmission is within a species. A pathogen adapted to a grazer is not the
 * same pathogen as one adapted to a stalker, and cross-species spillover is its
 * own subject; the two species simply carry the disease independently.
 *
 * The compartments and why an incubating animal is both infectious and
 * invisible are explained in disease/disease.js. The consequence here is that
 * avoidance can only ever be late.
 *
 * This system also owns **condition recovery**, which closes §1.4 A20. Wounds
 * healed (Step 17) but health lost to thirst never came back, so a once-thirsty
 * animal carried the damage for life while a mauled one mended — an asymmetry
 * that was invisible until injuries could heal and conspicuous ever since. A
 * step about recovering from illness is the right place for it: a healthy,
 * well-fed animal now slowly regains health from *any* source of damage. It
 * lives here rather than in the injury system because injury healing is paid
 * for per unit of wound severity, and this is the baseline underneath it.
 *
 * Runs in the `physiology` phase. Ownership: writes `diseaseState`,
 * `diseaseSince`, `diseaseUntil`, and `health`; kills through the shared
 * `killAnimal`. Randomness: the `disease` stream — one draw per
 * (infectious animal, susceptible neighbour) pair, plus one per symptomatic
 * animal per tick for mortality.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { killAnimal } from './death.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';
import {
  DiseaseStates,
  clearImmunity,
  infect,
  isInfectious,
  isSusceptible,
  isSymptomatic,
  recover,
} from '../disease/disease.js';

export class DiseaseSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.transmissionRadius] how close contact must be
   * @param {number} [options.transmissionChance] per-contact, per-tick infection chance
   * @param {number} [options.incubationTicks] infectious but symptom-free
   * @param {number} [options.symptomaticTicks] visibly ill
   * @param {number} [options.immunityTicks] how long recovery protects
   * @param {number} [options.mortalityPerTick] chance a symptomatic animal dies each tick
   * @param {number} [options.sickHealthDrain] health lost per symptomatic tick
   * @param {number} [options.healthRecoveryPerTick] baseline health regained when well (§1.4 A20)
   * @param {number} [options.recoveryEnergyFraction] energy floor below which nothing heals
   * @param {number} [options.edibleMassFraction]
   * @param {number} [options.spilloverChance] per-tick chance of a fresh case from the environment
   * @param {number} [options.updateInterval]
   */
  constructor({
    transmissionRadius = 2.5,
    transmissionChance = 0.02,
    incubationTicks = 250,
    symptomaticTicks = 200,
    immunityTicks = 3000,
    mortalityPerTick = 0.0004,
    sickHealthDrain = 0.03,
    healthRecoveryPerTick = 0.02,
    recoveryEnergyFraction = 0.5,
    edibleMassFraction = 0.6,
    spilloverChance = 0.00035,
    updateInterval = 1,
  } = {}) {
    super({ id: 'disease', phase: 'physiology', priority: 15, updateInterval });
    this.transmissionRadius = transmissionRadius;
    this.transmissionChance = transmissionChance;
    this.incubationTicks = incubationTicks;
    this.symptomaticTicks = symptomaticTicks;
    this.immunityTicks = immunityTicks;
    this.mortalityPerTick = mortalityPerTick;
    this.sickHealthDrain = sickHealthDrain;
    this.healthRecoveryPerTick = healthRecoveryPerTick;
    this.recoveryEnergyFraction = recoveryEnergyFraction;
    this.edibleMassFraction = edibleMassFraction;
    this.spilloverChance = spilloverChance;
  }

  update(world, context) {
    const random = context.random('disease');

    // Progression first, so an animal that becomes symptomatic this tick is
    // already visible to everything that reacts to symptoms.
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      this.#progress(entity, context, random);
      if (!entity.alive) continue;
      this.#recoverCondition(entity);
    }

    // Then transmission, from the infectious outward.
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive || !isInfectious(entity)) continue;
      this.#spread(world, entity, context, random);
    }

    this.#spillover(world, context, random);
  }

  /**
   * A fresh case from outside the population.
   *
   * Without this the pathogen goes **extinct** the moment its last carrier
   * recovers, and the demo gets exactly one epidemic in its history: measured,
   * the seeded outbreak peaked at 68 symptomatic around tick 1500, burned
   * through by 2500, and by 5500 every survivor's immunity had lapsed and there
   * was nothing left to catch. A standing environmental reservoir — the
   * ecological norm, and the reason most real diseases are not one-time events —
   * is what makes this a recurring pressure rather than a single incident.
   *
   * Two draws per tick, flat, whatever the population: one for whether a
   * spillover happens at all, one for who it lands on. Rolling per animal would
   * have been an O(N) pass through the stream for an event this rare.
   */
  #spillover(world, context, random) {
    const roll = random.next();
    const pick = random.next(); // drawn unconditionally — fixed budget
    if (roll >= this.spilloverChance) return;

    const susceptible = [];
    for (const entity of world.entities.all()) {
      if (entity.kind === 'animal' && entity.alive && isSusceptible(entity)) susceptible.push(entity);
    }
    if (susceptible.length === 0) return;
    const victim = susceptible[Math.min(susceptible.length - 1, Math.floor(pick * susceptible.length))];
    if (!infect(victim, context.tick, this.incubationTicks)) return;
    recordLifeEvent(victim, context.tick, LifeEventTypes.INFECTED, { entityId: null });
    context.emit(EventTypes.ENTITY_INFECTED, { entityId: victim.id, sourceId: null });
  }

  /** Advance one animal through its compartment schedule. */
  #progress(entity, context, random) {
    if (entity.diseaseUntil === null || context.tick < entity.diseaseUntil) {
      // Still in the current stage — but a symptomatic animal is losing ground
      // the whole time, and may not last it out.
      if (isSymptomatic(entity)) this.#suffer(entity, context, random);
      return;
    }

    switch (entity.diseaseState) {
      case DiseaseStates.INCUBATING:
        entity.diseaseState = DiseaseStates.SYMPTOMATIC;
        entity.diseaseSince = context.tick;
        entity.diseaseUntil = context.tick + this.symptomaticTicks;
        recordLifeEvent(entity, context.tick, LifeEventTypes.SICKENED);
        context.emit(EventTypes.ENTITY_SICKENED, { entityId: entity.id });
        break;
      case DiseaseStates.SYMPTOMATIC:
        recover(entity, context.tick, this.immunityTicks);
        recordLifeEvent(entity, context.tick, LifeEventTypes.CURED);
        context.emit(EventTypes.ENTITY_CURED, { entityId: entity.id, immuneUntil: entity.diseaseUntil });
        break;
      case DiseaseStates.RECOVERED:
        // Immunity lapses, and the animal rejoins the susceptible pool. This is
        // what lets an outbreak recur instead of burning through once.
        clearImmunity(entity, context.tick);
        break;
      default:
        break;
    }
  }

  /** A symptomatic animal loses health, and may die of it. */
  #suffer(entity, context, random) {
    const roll = random.next(); // drawn unconditionally: fixed budget per sick tick
    entity.health = Math.max(0, entity.health - this.sickHealthDrain);
    if (entity.health <= 0 || roll < this.mortalityPerTick) {
      killAnimal(entity, 'disease', entity.bodyMass * this.edibleMassFraction, context.emit, context.tick);
    }
  }

  /**
   * Baseline condition recovery (§1.4 A20).
   *
   * Health returns slowly to an animal that is neither ill nor starving. This
   * is what makes damage from *any* source — thirst, exposure, a fight, a
   * predator — eventually mendable, rather than wounds healing while everything
   * else scarred permanently. Gated on energy, like injury healing, because
   * mending is work: an animal too hungry to spare it does not mend.
   */
  #recoverCondition(entity) {
    if (this.healthRecoveryPerTick <= 0) return;
    if (isSymptomatic(entity)) return;
    if (entity.health >= entity.maxHealth) return;
    if (entity.energy < this.recoveryEnergyFraction * entity.maxEnergy) return;
    entity.health = Math.min(entity.maxHealth, entity.health + this.healthRecoveryPerTick);
  }

  /**
   * Pass the disease to susceptible conspecifics in contact range.
   *
   * The grid query happens **per infectious animal**, so between outbreaks this
   * loop does not run at all. Neighbours arrive in ascending id order, and one
   * draw is spent per susceptible contact whatever the result, so the stream
   * never shifts with the outcome.
   */
  #spread(world, carrier, context, random) {
    for (const otherId of world.grid.queryRadius(carrier.x, carrier.y, this.transmissionRadius)) {
      if (otherId === carrier.id) continue;
      const other = world.entities.get(otherId);
      if (!other || other.kind !== 'animal' || !other.alive) continue;
      if (other.speciesId !== carrier.speciesId) continue;
      if (!isSusceptible(other)) continue;

      const roll = random.next();
      if (roll >= this.transmissionChance) continue;
      if (!infect(other, context.tick, this.incubationTicks)) continue;
      recordLifeEvent(other, context.tick, LifeEventTypes.INFECTED, { entityId: carrier.id });
      context.emit(EventTypes.ENTITY_INFECTED, { entityId: other.id, sourceId: carrier.id });
    }
  }
}
