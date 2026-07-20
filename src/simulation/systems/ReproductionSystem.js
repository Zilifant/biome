/**
 * Reproduction (Step 12): the first population-renewal mechanism.
 *
 * Two adult conspecifics that are within `matingRange`, well fed, not already
 * gestating, and off cooldown pair up. Both pay a mating energy cost; the
 * initiator (deterministically the lower entity id) gestates, and after
 * `gestationTicks` gives birth to a juvenile placed just behind it, carrying
 * both parent ids. Nothing guarantees a replacement rate — births emerge from
 * encounters, energy, and lifespan, so populations may grow, shrink, or die
 * out.
 *
 * Runs in the `interaction` phase (after movement, so pairing uses this tick's
 * positions; before metabolism, so the costs are charged the same tick).
 * Mate search is grid-local (`queryRadius`), never a global pairwise scan
 * (invariant 17). Ownership: writes the reproductive fields
 * (`gestationUntil`, `pendingMateId`, `lastMatedTick`), appends to each
 * parent's `offspring` list, spends `energy`, and creates offspring at the
 * deferred-spawn boundary. The newborn's `guardianId` is part of its spawn
 * definition; the parenting system (Step 13) owns it thereafter. Mating and
 * gestation timing use no randomness at all — they are fully determined by
 * encounters and the fixed gestation; the only draws are the newborn's
 * inheritance (Step 20), on the separate `genetics` stream.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { SPECIES } from '../config/species/index.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';
import { inheritGenome, expressGenome } from '../traits/genetics.js';

/**
 * Reproductive readiness — the single source of truth, shared by the
 * reproduction system (which pairs animals) and the decision system (which
 * decides whether to go looking for a mate), so the rule never drifts.
 * @param {object} entity
 * @param {number} tick
 * @param {{minEnergyFraction: number, cooldownTicks: number}} params
 */
export function isReproductivelyReady(entity, tick, { minEnergyFraction, cooldownTicks }) {
  return (
    entity.kind === 'animal' &&
    entity.alive &&
    entity.lifeStage === 'adult' &&
    entity.gestationUntil === null &&
    entity.energy >= minEnergyFraction * entity.maxEnergy &&
    (entity.lastMatedTick === null || tick - entity.lastMatedTick >= cooldownTicks)
  );
}

export class ReproductionSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.matingRange]
   * @param {number} [options.minEnergyFraction]
   * @param {number} [options.matingEnergyCost]
   * @param {number} [options.gestationTicks]
   * @param {number} [options.birthEnergyCost]
   * @param {number} [options.offspringEnergyFraction]
   * @param {number} [options.cooldownTicks]
   * @param {number} [options.birthOffset]
   * @param {number} [options.birthMass] newborn body mass (from the aging curve)
   * @param {object} [options.genetics] mutation rate and step (see traits/genetics.js)
   * @param {number} [options.updateInterval]
   */
  constructor({
    matingRange = 2.0,
    minEnergyFraction = 0.7,
    matingEnergyCost = 8,
    gestationTicks = 600,
    birthEnergyCost = 15,
    offspringEnergyFraction = 0.6,
    cooldownTicks = 800,
    birthOffset = 1.0,
    birthMass = 5,
    genetics = {},
    updateInterval = 1,
  } = {}) {
    super({ id: 'reproduction', phase: 'interaction', priority: 10, updateInterval });
    this.matingRange = matingRange;
    this.minEnergyFraction = minEnergyFraction;
    this.matingEnergyCost = matingEnergyCost;
    this.gestationTicks = gestationTicks;
    this.birthEnergyCost = birthEnergyCost;
    this.offspringEnergyFraction = offspringEnergyFraction;
    this.cooldownTicks = cooldownTicks;
    this.birthOffset = birthOffset;
    this.birthMass = birthMass;
    this.genetics = genetics;
  }

  update(world, context) {
    this.#births(world, context);
    this.#matings(world, context);
  }

  /** Deliver any pregnancies that have come to term. */
  #births(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      if (entity.gestationUntil === null || context.tick < entity.gestationUntil) continue;

      const species = SPECIES[entity.speciesId];
      const mateId = entity.pendingMateId;
      // Place the newborn just behind the parent, falling back to the parent's
      // own (necessarily passable) position if that spot is blocked.
      let x = world.clampX(entity.x - Math.cos(entity.heading) * this.birthOffset);
      let y = world.clampY(entity.y - Math.sin(entity.heading) * this.birthOffset);
      if (!world.isPassableAt(x, y)) {
        x = entity.x;
        y = entity.y;
      }

      const maxEnergy = species?.maxEnergy ?? entity.maxEnergy;
      const parents = mateId === null ? [entity.id] : [entity.id, mateId];
      // Heredity (Step 20): the newborn's genome comes from its parents —
      // one allele per locus from each, then mutation — and its traits are
      // expressed from that genome rather than drawn fresh. The carrying
      // parent's `reproductiveInvestment` still sets how much it puts into
      // this offspring: a better-stocked newborn for a higher birth cost.
      const parentGenomes = parents.map((id) => world.entities.get(id)?.genome).filter(Boolean);
      const genome = inheritGenome(parentGenomes, context.random('genetics'), this.genetics);
      const traits = expressGenome(genome);
      const investment = entity.traits.reproductiveInvestment;
      const offspringId = context.queueSpawn({
        kind: 'animal',
        speciesId: entity.speciesId,
        x,
        y,
        heading: entity.heading,
        age: 0,
        lifeStage: 'juvenile',
        bodyMass: this.birthMass,
        adultMass: (species?.bodyMass ?? entity.adultMass) * traits.size,
        genome,
        traits,
        speed: (species?.baseSpeed ?? entity.speed) * traits.speed,
        maxEnergy,
        energy: Math.min(maxEnergy, maxEnergy * this.offspringEnergyFraction * investment),
        maxHealth: species?.maxHealth ?? entity.maxHealth,
        health: species?.maxHealth ?? entity.maxHealth,
        maxHydration: species?.maxHydration ?? entity.maxHydration,
        hydration: species?.maxHydration ?? entity.maxHydration,
        parents,
        // One deeper than the deepest parent (Step 21) — so "generation" is
        // lineage depth, not a global cohort counter.
        generation: Math.max(...parents.map((id) => world.entities.get(id)?.generation ?? 0)) + 1,
        // Parenting (Step 13): the newborn depends on the parent that carried
        // it. The bond is part of the spawn definition; from here on it is the
        // parenting system's to hold and to break.
        guardianId: entity.id,
        weaned: false,
        lifeEvents: [{ tick: context.tick, type: LifeEventTypes.BORN }],
      });

      // The sparse inverse of `parents`, recorded on whichever parents still
      // exist (ids stay valid because entities are never removed).
      for (const parentId of parents) {
        const parent = world.entities.get(parentId);
        if (!parent) continue;
        parent.offspring.push(offspringId);
        recordLifeEvent(parent, context.tick, LifeEventTypes.BIRTHED, { entityId: offspringId });
      }

      entity.energy = Math.max(0, entity.energy - this.birthEnergyCost * investment);
      entity.gestationUntil = null;
      entity.pendingMateId = null;
      context.emit(EventTypes.ENTITY_BORN, { entityId: offspringId, parents });
    }
  }

  /** Pair eligible adults that are close enough this tick. */
  #matings(world, context) {
    const matedThisTick = new Set();
    for (const entity of world.entities.all()) {
      if (matedThisTick.has(entity.id) || !this.#eligible(entity, context.tick)) continue;

      for (const otherId of world.grid.queryRadius(entity.x, entity.y, this.matingRange)) {
        if (otherId === entity.id || matedThisTick.has(otherId)) continue;
        const other = world.entities.get(otherId);
        if (!other || other.speciesId !== entity.speciesId) continue;
        if (!this.#eligible(other, context.tick)) continue;

        // Pair: both pay the cost; the initiator (lower id, since entities are
        // iterated in ascending id order) carries the pregnancy.
        entity.energy = Math.max(0, entity.energy - this.matingEnergyCost);
        other.energy = Math.max(0, other.energy - this.matingEnergyCost);
        entity.lastMatedTick = context.tick;
        other.lastMatedTick = context.tick;
        entity.pendingMateId = other.id;
        entity.gestationUntil = context.tick + this.gestationTicks;
        matedThisTick.add(entity.id);
        matedThisTick.add(other.id);
        context.emit(EventTypes.ENTITY_MATED, {
          entityId: entity.id,
          partnerId: other.id,
          gestationUntil: entity.gestationUntil,
        });
        break;
      }
    }
  }

  /** @param {object} entity @param {number} tick */
  #eligible(entity, tick) {
    return isReproductivelyReady(entity, tick, {
      minEnergyFraction: this.minEnergyFraction,
      cooldownTicks: this.cooldownTicks,
    });
  }

  /** Public readiness view for inspection (mirrors #eligible). */
  readinessFor(entity, tick) {
    return {
      ready: this.#eligible(entity, tick),
      gestating: entity.gestationUntil !== null,
      gestationUntil: entity.gestationUntil,
      lastMatedTick: entity.lastMatedTick,
    };
  }
}
