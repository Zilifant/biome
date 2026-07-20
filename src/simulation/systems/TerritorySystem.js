/**
 * Territories and home ranges (Step 24) — emergent, never prescribed.
 *
 * Nothing here draws a boundary or assigns anyone a plot. Two mechanisms run,
 * and every behaviour the step asks for is a consequence of them rather than a
 * feature built beside them:
 *
 *   1. **A home range is a running summary of where an animal has been.**
 *      An exponentially-weighted centroid plus the mean distance from it —
 *      four numbers, updated in O(1) per tick. That is deliberate: the step's
 *      performance note rules out occupancy history, and a decaying mean *is*
 *      "repeated-use area" without storing a single past position. An animal
 *      that keeps returning somewhere tightens its range around it; one that
 *      leaves drags it along and it widens. Site fidelity is then just the
 *      decision system steering back toward that centre (`patrol`), which
 *      reinforces the summary that produced it — the feedback loop is the whole
 *      point, and it is why a range *settles* rather than merely existing.
 *
 *   2. **A claim is a mark on the ground** (see world/ScentGrid.js). Marking
 *      writes it, decay removes it, and a stronger mark overwrites a weaker
 *      one. Avoidance, conflict, territory loss, and the occupation of vacant
 *      ground all fall out of that one pair of numbers per cell.
 *
 * **Disputes are with the claim, not with a search.** When a territorial animal
 * finds itself on ground someone else holds, it looks up the owner — an O(1)
 * grid read plus an O(1) id lookup, no spatial query anywhere — and:
 *
 *   - if the owner is dead or far away, the intruder simply marks over it, and
 *     the ground changes hands as fast as it can wear the old claim down. That
 *     is occupation of a vacated area, needing no rule of its own;
 *   - if the owner is close enough to answer, they contest, decided by the same
 *     `resolveContest` that settles mating rivalries (§1.4 A19's writer). The
 *     loser yields **every cell it held** on the spot, which is what makes
 *     losing a territory something you can watch rather than a slow fade.
 *
 * Runs in the `interaction` phase at priority 30 — after movement, so the
 * position it marks is where the animal actually ended the tick, and after
 * hunting, parenting, and reproduction, so a fight over ground cannot pre-empt
 * a fight over a mate. Ownership: writes `homeRange`, `lastMarkTick`, and the
 * scent grid; reads positions and the species' `territory` block. Randomness:
 * only what `resolveContest` draws, on the shared `social` stream.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { FightInjuryKinds, dominanceOf, resolveContest } from '../social/dominance.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';

/** The territory block of a species, or null if it declares none. */
export function territoryOf(species) {
  return species?.territory ?? null;
}

export class TerritorySystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.markInterval] ticks between an animal's marks
   * @param {number} [options.markStrength] strength a fresh mark writes
   * @param {number} [options.decayPerTick] claim strength lost per tick
   * @param {number} [options.decayInterval] how often decay runs (rate-compensated)
   * @param {number} [options.claimFloor] strength below which a claim is dropped
   * @param {number} [options.disputeRange] how close an owner must be to answer
   * @param {number} [options.disputeCooldownTicks] pause between disputes
   * @param {number} [options.contestEscalationChance]
   * @param {number} [options.fightInjurySeverity]
   * @param {number} [options.fightWinnerInjuryFraction]
   * @param {number} [options.injuryHealthDamage]
   * @param {number} [options.updateInterval]
   */
  constructor({
    markInterval = 20,
    markStrength = 0.35,
    decayPerTick = 0.0025,
    decayInterval = 10,
    claimFloor = 0.05,
    disputeRange = 8,
    disputeCooldownTicks = 120,
    contestEscalationChance = 0.3,
    fightInjurySeverity = 0.2,
    fightWinnerInjuryFraction = 0.4,
    injuryHealthDamage = 60,
    updateInterval = 1,
  } = {}) {
    super({ id: 'territory', phase: 'interaction', priority: 30, updateInterval });
    this.markInterval = markInterval;
    this.markStrength = markStrength;
    this.decayPerTick = decayPerTick;
    this.decayInterval = decayInterval;
    this.claimFloor = claimFloor;
    this.disputeRange = disputeRange;
    this.disputeCooldownTicks = disputeCooldownTicks;
    this.contestEscalationChance = contestEscalationChance;
    this.fightInjurySeverity = fightInjurySeverity;
    this.fightWinnerInjuryFraction = fightWinnerInjuryFraction;
    this.injuryHealthDamage = injuryHealthDamage;
  }

  update(world, context) {
    // Decay first and staggered, with the elapsed ticks folded in so the
    // interval changes the cost and not the rate — the same trick the memory
    // and vegetation systems use.
    if (context.tick % this.decayInterval === 0) {
      world.scent.decay(this.decayPerTick * this.decayInterval, this.claimFloor);
    }

    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const territory = territoryOf(world.species.get(entity.speciesId));
      if (!territory) continue;

      this.#accumulateRange(entity, territory);

      // Only species that defend ground touch the claim layer at all. A grazer
      // has a home range and no territory, which is the difference between
      // living somewhere and owning it.
      if (!territory.defends) continue;
      if (entity.lifeStage !== 'adult' && entity.lifeStage !== 'senescent') continue;

      this.#claim(world, entity, context);
    }
  }

  /**
   * Fold this tick's position into the animal's running home range.
   *
   * `settleTicks` is the memory of the average: a large value means the range
   * moves slowly and reflects a long history, which is what "settled" means.
   * The radius tracks mean distance from the centre, so it widens for a rover
   * and tightens for a resident — nobody sets it.
   */
  #accumulateRange(entity, territory) {
    const alpha = 1 / Math.max(1, territory.settleTicks);
    const range = entity.homeRange;
    if (range === null) {
      entity.homeRange = { x: entity.x, y: entity.y, radius: 0, samples: 1 };
      return;
    }
    range.x += alpha * (entity.x - range.x);
    range.y += alpha * (entity.y - range.y);
    const distance = Math.hypot(entity.x - range.x, entity.y - range.y);
    range.radius += alpha * (distance - range.radius);
    range.samples += 1;
  }

  /** Mark the ground underfoot, disputing it first if somebody else holds it. */
  #claim(world, entity, context) {
    const holder = world.scent.ownerAt(entity.x, entity.y);
    if (holder !== 0 && holder !== entity.id) {
      // Somebody else's ground. Whether that costs anything depends entirely on
      // whether they are here to say so.
      const owner = world.entities.get(holder);
      const present =
        owner &&
        owner.alive &&
        owner.kind === 'animal' &&
        Math.hypot(owner.x - entity.x, owner.y - entity.y) <= this.disputeRange;
      if (present && this.#offCooldown(entity, context.tick) && this.#offCooldown(owner, context.tick)) {
        this.#dispute(world, entity, owner, context);
        return; // the dispute settles the ground; no marking on top of it
      }
      // Undefended: wear the claim down and take it. No special case for "the
      // owner is dead" — a dead animal simply never turns up to object.
    }

    if (entity.lastMarkTick !== null && context.tick - entity.lastMarkTick < this.markInterval) return;
    entity.lastMarkTick = context.tick;
    world.scent.mark(entity.x, entity.y, entity.id, this.markStrength);
  }

  #offCooldown(entity, tick) {
    return entity.lastContestTick === null || tick - entity.lastContestTick >= this.disputeCooldownTicks;
  }

  /**
   * Two residents, one piece of ground. Decided by dominance exactly as a
   * mating rivalry is — same helper, same fixed three-draw budget, same
   * escalation model — and the loser hands over everything it held.
   */
  #dispute(world, challenger, owner, context) {
    const random = context.random('social');
    const { winner, loser, escalated, injured } = resolveContest(challenger, owner, random, {
      escalationChance: this.contestEscalationChance,
      fightInjurySeverity: this.fightInjurySeverity,
      winnerInjuryFraction: this.fightWinnerInjuryFraction,
      injuryHealthDamage: this.injuryHealthDamage,
      tick: context.tick,
    });
    challenger.lastContestTick = context.tick;
    owner.lastContestTick = context.tick;

    // Losing a territory is losing *the territory*, not this cell. A resident
    // that is beaten on its own ground has been shown it cannot hold it.
    const yielded = world.scent.transfer(loser.id, winner.id);
    world.scent.mark(challenger.x, challenger.y, winner.id, this.markStrength);

    context.emit(EventTypes.ENTITY_DISPUTED, {
      entityId: challenger.id,
      ownerId: owner.id,
      winnerId: winner.id,
      dominance: dominanceOf(challenger),
      ownerDominance: dominanceOf(owner),
      escalated,
      cellsTransferred: yielded,
    });
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
  }
}
