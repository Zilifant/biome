/**
 * Reproduction (Step 12), with sexes and mate choice (Step 22).
 *
 * A receptive female assesses the eligible males within `matingRange` and pairs
 * with the best of them **if he clears the standard she is currently holding**
 * — a standard that starts at her heritable choosiness and declines the longer
 * she goes unmated (see mating/mateChoice.js, which owns the whole preference
 * model and explains why this simulation has sexes at all). Both pay a mating
 * energy cost, she gestates, and after `gestationTicks` gives birth to a
 * juvenile placed just behind her, carrying both parent ids. Nothing guarantees
 * a replacement rate — births emerge from encounters, choice, energy, and
 * lifespan, so populations may grow, shrink, or die out.
 *
 * The two sexes clear different bars, which is the asymmetry the whole thing
 * rests on: she must be near-full and waits out a long cooldown because she
 * pays for the pregnancy; he needs far less and recovers quickly because he
 * pays for one mating. So males are usually available and females usually are
 * not, and it is females that males are effectively competing for.
 *
 * Runs in the `interaction` phase (after movement, so pairing uses this tick's
 * positions; before metabolism, so the costs are charged the same tick).
 * Mate search is grid-local (`queryRadius`), never a global pairwise scan
 * (invariant 17). Ownership: writes the reproductive fields
 * (`gestationUntil`, `pendingMateId`, `lastMatedTick`, `mateSearchSince`,
 * `lastCourtship`), appends to each parent's `offspring` list, spends `energy`,
 * and creates offspring at the deferred-spawn boundary. The newborn's
 * `guardianId` is part of its spawn definition; the parenting system (Step 13)
 * owns it thereafter. Mating, assessment, and gestation timing use no
 * randomness at all — quality is a pure function of traits and condition; the
 * only draws are the newborn's inheritance (`genetics` stream) and its sex (the
 * `sex` stream), one each per birth.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';
import { inheritGenome, expressGenome } from '../traits/genetics.js';
import {
  acceptanceThreshold,
  drawSex,
  isChooser,
  mateQuality,
  matePreferenceFor,
} from '../mating/mateChoice.js';
import { FightInjuryKinds, dominanceOf, resolveContest } from '../social/dominance.js';
import { DEFAULT_BREEDING, breedingWindowOf, inBreedingWindow } from '../mating/breeding.js';
import { isSymptomatic } from '../disease/disease.js';

/**
 * Reproductive readiness — the single source of truth, shared by the
 * reproduction system (which pairs animals) and the decision system (which
 * decides whether to go looking for a mate), so the rule never drifts.
 *
 * The bar depends on the role (Step 22): the gestating sex must be well fed and
 * off a long cooldown, the seeking sex needs much less of both. That difference
 * is not a tuning convenience — it is the investment asymmetry that makes
 * choosing worth anything.
 *
 * ⚠ **And, from phase 12, on the time of year** — but only for the gestating sex,
 * and only for a species that declares a `breedingWindow` (see `mating/breeding.js`
 * for why the seeking sex is deliberately left ready year-round). `yearProgress` is
 * `null` when the caller has no clock or the mechanism is switched off, which skips
 * the test entirely rather than evaluating a window that covers the year.
 *
 * @param {object} entity
 * @param {number} tick
 * @param {{minEnergyFraction: number, cooldownTicks: number,
 *   suitorMinEnergyFraction?: number, suitorCooldownTicks?: number,
 *   breedingWindow?: {startFraction: number, endFraction: number}|null}} params
 * @param {number|null} [yearProgress] fraction of the year elapsed, or null for no season
 */
export function isReproductivelyReady(entity, tick, params, yearProgress = null) {
  const { minEnergyFraction, cooldownTicks, suitorMinEnergyFraction, suitorCooldownTicks } = params;
  const gestates = isChooser(entity);
  const energyBar = gestates ? minEnergyFraction : (suitorMinEnergyFraction ?? minEnergyFraction);
  const cooldown = gestates ? cooldownTicks : (suitorCooldownTicks ?? cooldownTicks);
  return (
    entity.kind === 'animal' &&
    entity.alive &&
    entity.lifeStage === 'adult' &&
    // Out of season she is simply not receptive — the same shape as being on
    // cooldown, and it reaches the decision system through this one predicate, so
    // she does not go looking for a mate she would refuse.
    (yearProgress === null || !gestates || inBreedingWindow(yearProgress, breedingWindowOf(params))) &&
    // A visibly ill animal does not breed (Step 25). Incubating ones do, which
    // is deliberate: the disease travels through the population's ordinary life
    // rather than being quarantined by a rule.
    !isSymptomatic(entity) &&
    entity.gestationUntil === null &&
    entity.energy >= energyBar * entity.maxEnergy &&
    (entity.lastMatedTick === null || tick - entity.lastMatedTick >= cooldown)
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
   * @param {number} [options.cooldownTicks] the gestating sex's refractory period
   * @param {number} [options.suitorMinEnergyFraction] the seeking sex's energy bar
   * @param {number} [options.suitorCooldownTicks] the seeking sex's refractory period
   * @param {number} [options.acceptanceThreshold] base quality a chooser insists on
   * @param {number} [options.choosinessPatienceTicks] ticks over which that standard falls to zero
   * @param {number} [options.contestEscalationChance] chance an even contest becomes a fight
   * @param {number} [options.contestCooldownTicks] how long a beaten rival keeps away
   * @param {number} [options.fightInjurySeverity] severity of the loser's wound
   * @param {number} [options.fightWinnerInjuryFraction] how much of it the winner also takes
   * @param {number} [options.injuryHealthDamage] health lost per unit of severity
   * @param {number} [options.birthOffset]
   * @param {number} [options.birthMass] newborn body mass (from the aging curve)
   * @param {boolean} [options.breedingEnabled] whether a species' breeding window is honoured
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
    suitorMinEnergyFraction = 0.45,
    suitorCooldownTicks = 200,
    acceptanceThreshold: baseAcceptanceThreshold = 0.72,
    choosinessPatienceTicks = 400,
    contestEscalationChance = 0.35,
    contestCooldownTicks = 60,
    fightInjurySeverity = 0.22,
    fightWinnerInjuryFraction = 0.4,
    injuryHealthDamage = 60,
    birthOffset = 1.0,
    birthMass = 5,
    // Seasonal breeding (phase 12, PLAN-SPECIES.md §3.11). ⚠ Wired from
    // `config.breeding`, a global section — *not* from `reproduction`, which is a
    // species block a species overrides, so a switch inside one could not switch
    // anything off (DOCS §8). The window itself is per-species biology and does
    // live in that block.
    breedingEnabled = DEFAULT_BREEDING.enabled,
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
    this.suitorMinEnergyFraction = suitorMinEnergyFraction;
    this.suitorCooldownTicks = suitorCooldownTicks;
    this.acceptanceThreshold = baseAcceptanceThreshold;
    this.choosinessPatienceTicks = choosinessPatienceTicks;
    this.contestEscalationChance = contestEscalationChance;
    this.contestCooldownTicks = contestCooldownTicks;
    this.fightInjurySeverity = fightInjurySeverity;
    this.fightWinnerInjuryFraction = fightWinnerInjuryFraction;
    this.injuryHealthDamage = injuryHealthDamage;
    this.birthOffset = birthOffset;
    this.birthMass = birthMass;
    this.breedingEnabled = breedingEnabled;
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

      const species = world.species.get(entity.speciesId);
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
      // `parents[0]` is always the parent that carried the pregnancy.
      const parents = mateId === null ? [entity.id] : [entity.id, mateId];
      // Sex (Step 22) is drawn on its own stream, one draw per birth, so adding
      // it never shifted the `genetics` sequence — and so a run with a different
      // birth history cannot desynchronize inheritance.
      const sex = drawSex(context.random('sex'));
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
        // The *newborn's own species* birth mass (Step 29). This was the last
        // place §1.4 A17 survived: a cub of any species was born at the one
        // global `birthMass`, whatever body it was going to grow into.
        bodyMass: world.species.get(entity.speciesId)?.aging?.birthMass ?? this.birthMass,
        adultMass: (species?.bodyMass ?? entity.adultMass) * traits.size,
        genome,
        traits,
        sex,
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

      entity.energy = Math.max(0, entity.energy - this.#params(world, entity).birthEnergyCost * investment);
      entity.gestationUntil = null;
      entity.pendingMateId = null;
      context.emit(EventTypes.ENTITY_BORN, { entityId: offspringId, parents, sex });
    }
  }

  /**
   * Receptive females assess the males in range and pair with the best one that
   * clears their current standard.
   *
   * Only the gestating sex drives this loop: it is the one whose consent
   * actually gates a pregnancy, so making it the initiator keeps a mating from
   * being resolved twice from opposite ends. A rejection is not a no-op — it is
   * recorded and emitted, because "she looked him over and walked on" is a
   * behaviour an observer should be able to see, not infer.
   */
  #matings(world, context) {
    const matedThisTick = new Set();
    for (const entity of world.entities.all()) {
      if (!isChooser(entity) || matedThisTick.has(entity.id)) continue;
      if (!this.#eligible(world, entity, context.tick)) {
        // Not receptive: the search clock stops, so a female who spends a
        // gestation unavailable starts her next search at full standards.
        entity.mateSearchSince = null;
        continue;
      }
      // Receptive from this tick onward — the clock the declining threshold
      // reads, and the concrete form of "choosiness costs time".
      if (entity.mateSearchSince === null) entity.mateSearchSince = context.tick;

      const preference = matePreferenceFor(world.species.get(entity.speciesId));
      /** @type {object[]} */
      const suitors = [];
      for (const otherId of world.grid.queryRadius(entity.x, entity.y, this.matingRange)) {
        if (otherId === entity.id || matedThisTick.has(otherId)) continue;
        const other = world.entities.get(otherId);
        // A partner must be a sexed conspecific of the *other* role. Testing
        // `other.sex !== entity.sex` alone would let an unsexed animal (a
        // hand-spawned one, or an externally submitted `entity.spawn`) count as
        // a mate, since `null !== 'female'`.
        if (!other || other.speciesId !== entity.speciesId) continue;
        if (other.sex === null || isChooser(other)) continue;
        if (!this.#eligible(world, other, context.tick)) continue;
        // A rival beaten here very recently is still keeping its distance.
        if (other.lastContestTick !== null && context.tick - other.lastContestTick < this.contestCooldownTicks) continue;
        suitors.push(other);
      }
      if (suitors.length === 0) continue;

      // Male–male competition (Step 23), the other half of sexual selection.
      // Step 22 gave the female a choice; this decides who she gets a choice
      // *about*. Rivals contest for access and the losers are driven off, so
      // what reaches her is the animal that could hold the ground — but she
      // still has to accept him, which is why both mechanisms stay visible
      // instead of one silently overriding the other.
      const contested = suitors.length > 1 ? this.#contest(suitors, context) : suitors;

      let best = null;
      let bestQuality = -1;
      for (const other of contested) {
        const quality = mateQuality(other, preference);
        // Strictly greater, over ids in ascending order: ties go to the lowest id.
        if (quality > bestQuality) {
          bestQuality = quality;
          best = other;
        }
      }
      if (best === null) continue;

      const threshold = acceptanceThreshold(entity, context.tick, {
        baseThreshold: this.acceptanceThreshold,
        patienceTicks: this.choosinessPatienceTicks,
      });
      const accepted = bestQuality >= threshold;
      // Report the *verdict*, not the re-checking. A female standing beside a
      // male reassesses him every tick — her standard is falling, so she must —
      // but emitting that every tick produced ~1.7 events per tick across the demo,
      // which is pure noise competing for the bounded retention window (§1.4
      // C3). One event when she sizes up someone new, and one when her answer
      // changes, is the whole story: "looked over #57, walked on" then later
      // "looked over #57, accepted".
      const previous = entity.lastCourtship;
      const worthReporting =
        previous === null || previous.candidateId !== best.id || previous.accepted !== accepted;
      entity.lastCourtship = {
        tick: context.tick,
        candidateId: best.id,
        quality: bestQuality,
        threshold,
        accepted,
      };
      if (worthReporting) {
        context.emit(EventTypes.ENTITY_COURTED, {
          entityId: entity.id,
          candidateId: best.id,
          quality: bestQuality,
          threshold,
          accepted,
        });
      }
      if (!accepted) continue;

      // Pair: both pay the mating cost, she carries the pregnancy.
      const repro = this.#params(world, entity);
      entity.energy = Math.max(0, entity.energy - repro.matingEnergyCost);
      best.energy = Math.max(0, best.energy - repro.matingEnergyCost);
      entity.lastMatedTick = context.tick;
      best.lastMatedTick = context.tick;
      entity.pendingMateId = best.id;
      entity.gestationUntil = context.tick + repro.gestationTicks;
      entity.mateSearchSince = null;
      matedThisTick.add(entity.id);
      matedThisTick.add(best.id);
      context.emit(EventTypes.ENTITY_MATED, {
        entityId: entity.id,
        partnerId: best.id,
        gestationUntil: entity.gestationUntil,
        quality: bestQuality,
      });
    }
  }

  /**
   * Rivals contest for access; the winner stays, the losers are driven off.
   *
   * Resolved pairwise down the list rather than as an all-against-all bracket:
   * the current holder is challenged by each newcomer in turn, which is one
   * contest per extra suitor (linear, never quadratic) and reads correctly as
   * a stallion being challenged one at a time. Contests use the shared
   * `resolveContest` helper, so a fight here injures exactly as a fight
   * anywhere else does (§1.4 A19).
   *
   * @param {object[]} suitors at least two, in ascending id order
   * @returns {object[]} the single suitor left standing
   */
  #contest(suitors, context) {
    const random = context.random('social');
    let holder = suitors[0];
    for (let i = 1; i < suitors.length; i += 1) {
      const challenger = suitors[i];
      const { winner, loser, escalated, injured } = resolveContest(holder, challenger, random, {
        escalationChance: this.contestEscalationChance,
        fightInjurySeverity: this.fightInjurySeverity,
        winnerInjuryFraction: this.fightWinnerInjuryFraction,
        injuryHealthDamage: this.injuryHealthDamage,
        tick: context.tick,
      });
      loser.lastContestTick = context.tick;
      context.emit(EventTypes.ENTITY_CONTESTED, {
        entityId: holder.id,
        opponentId: challenger.id,
        winnerId: winner.id,
        dominance: dominanceOf(holder),
        opponentDominance: dominanceOf(challenger),
        escalated,
        injured,
      });
      // Only the two animals in this contest can have been hurt by it, so they
      // resolve from the locals — no lookup, and no way to report a wound on
      // someone who was not there.
      for (const id of injured) {
        const hurt = id === winner.id ? winner : loser;
        recordLifeEvent(hurt, context.tick, LifeEventTypes.INJURED, { injury: FightInjuryKinds.BATTLE });
        context.emit(EventTypes.ENTITY_INJURED, {
          entityId: hurt.id,
          injury: FightInjuryKinds.BATTLE,
          severity: hurt.impairment,
          sourceId: hurt === winner ? loser.id : winner.id,
        });
      }
      holder = winner;
    }
    return [holder];
  }

  /**
   * Per-species reproductive parameters (Step 29), falling back to this
   * system's config for a species the registry does not know. The resolved
   * block is already merged and frozen, so this is one `Map.get`.
   * @param {import('../world/World.js').World} world @param {object} entity
   */
  #params(world, entity) {
    return world.species.get(entity.speciesId)?.reproduction ?? this;
  }

  /**
   * Where in the year this world is, or null when the season must not gate
   * breeding — the mechanism switched off, or a world with no environment at all
   * (a hand-built test world). Read off `world.environment`, which `WeatherSystem`
   * rewrites every tick in the `environment` phase, ahead of both this system
   * (`interaction`) and the decision system (`decision`). One property read, and
   * `null` skips the window test entirely (§3.11).
   * @param {import('../world/World.js').World} world
   * @returns {number|null}
   */
  #yearProgress(world) {
    return this.breedingEnabled ? (world.environment?.yearProgress ?? null) : null;
  }

  /** @param {import('../world/World.js').World} world @param {object} entity @param {number} tick */
  #eligible(world, entity, tick) {
    return isReproductivelyReady(entity, tick, this.#params(world, entity), this.#yearProgress(world));
  }

  /** Public readiness view for inspection (mirrors #eligible). */
  readinessFor(world, entity, tick) {
    const breedingWindow = this.breedingEnabled ? breedingWindowOf(this.#params(world, entity)) : null;
    return {
      ready: this.#eligible(world, entity, tick),
      gestating: entity.gestationUntil !== null,
      gestationUntil: entity.gestationUntil,
      lastMatedTick: entity.lastMatedTick,
      // Null for a species that breeds year-round, which is every species today.
      // Reported so "she is not ready" can be told from "she is not ready *yet*"
      // without the observer having to know the tick maths (invariant 19).
      inBreedingSeason:
        breedingWindow === null ? null : inBreedingWindow(world.environment?.yearProgress ?? 0, breedingWindow),
    };
  }
}
