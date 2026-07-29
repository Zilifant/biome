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
 * ⚠ **Carcass contention stopped being a queue on 2026-07-28.** A body now has a
 * holder (`possessorId`), and a second carnivore either feeds beside it — same
 * group record, so a clan shares a kill — waits, or takes it by contest. See
 * `predation/possession.js` for the rules and why possession is held by presence
 * rather than by a timer.
 *
 * Ownership: writes `energy` (gain, clamped to `maxEnergy`), vegetation biomass
 * (decrement via `VegetationGrid.consumeAt`), and `carcass.possessorId`; records
 * where the animal ate — or failed to (Step 15); emits `entity.fed`. Randomness:
 * **three draws per possession contest** on the dedicated `possession` stream,
 * whatever the outcome, and none at all otherwise. No global scans.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { recordMemory, forgetMemory, MemoryKinds, MAX_MEMORIES } from '../memory/memories.js';
import { CarcassSystem } from './CarcassSystem.js';
import { diseaseSeverity } from '../disease/disease.js';
import { DEFAULT_POSSESSION, holderOf, mayFeedFreely, outranks } from '../predation/possession.js';
import { dominanceOf, resolveContest } from '../social/dominance.js';
import { MAX_INJURIES } from '../injury/injuries.js';

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
    massScaleIntake = true,
    injuryFeedPenalty = 0.5,
    diseaseFeedPenalty = 0.3,
    // Carcass possession (see predation/possession.js). Held as one object
    // rather than five scalars because the predicates take it whole, and
    // `DecisionSystem` holds the identical object — the two must ask the same
    // question or an animal walks to a body it is then refused (D11).
    possessionEnabled = DEFAULT_POSSESSION.enabled,
    possessionRange = DEFAULT_POSSESSION.range,
    possessionShare = DEFAULT_POSSESSION.share,
    possessionEscalationChance = DEFAULT_POSSESSION.escalationChance,
    possessionFightSeverity = DEFAULT_POSSESSION.fightInjurySeverity,
    possessionWinnerInjuryFraction = DEFAULT_POSSESSION.fightWinnerInjuryFraction,
    injuryHealthDamage = 60,
    maxInjuries = MAX_INJURIES,
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
    this.massScaleIntake = massScaleIntake;
    this.injuryFeedPenalty = injuryFeedPenalty;
    this.diseaseFeedPenalty = diseaseFeedPenalty;
    this.possession = Object.freeze({
      enabled: possessionEnabled,
      range: possessionRange,
      share: possessionShare,
      escalationChance: possessionEscalationChance,
      fightInjurySeverity: possessionFightSeverity,
      fightWinnerInjuryFraction: possessionWinnerInjuryFraction,
    });
    this.injuryHealthDamage = injuryHealthDamage;
    this.maxInjuries = maxInjuries;
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
      const species = world.species.get(entity.speciesId);
      if (species?.diet === 'carnivore') {
        this.#eatCarcass(world, context, entity, species);
        continue;
      }

      // `feeding` is a species block from 2026-07-28, so a browser and a grazer
      // can differ in what they get out of the same cell. Falls back to `this`
      // for an unknown species, like every other per-species read.
      const params = species?.feeding ?? this;
      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      // Don't overeat past satiation: cap intake by the energy deficit as well.
      const deficit = entity.maxEnergy - entity.energy;
      const maxUsefulBiomass = deficit / (params.energyPerBiomass * params.efficiency);
      // A wounded animal feeds badly (Step 17), which is how an injury turns
      // into a slow slide rather than a one-off cost.
      //
      // ⚠ Intake is **mass-scaled**, exactly as the carnivore branch below has
      // been since Step 29. Until 2026-07-28 this branch was flat, so a 600 kg
      // buffalo would have cropped a cell at precisely a 30 kg gazelle's rate —
      // the same latent bug `fleshIntakeRate` had (D22), still open on the
      // herbivore side because every herbivore was one size.
      //
      // ⚠ **This is not inert in the demo**, and the tempting assumption that it
      // is cost an hour: the *species* sits at `referenceMass`, but an
      // individual's `bodyMass` is its `adultMass` (species mass × the heritable
      // `size` trait) walked up a growth curve. Measured on seed 42's founding
      // cohort: bodyMass 5.1–33.7 kg, so mass factors of **0.265–1.092**. A
      // half-grown grazer now eats ~40% less than it did.
      //
      // That is the correct model rather than a regression — metabolism already
      // scales cost by the same mass on the same exponent, so before this a
      // juvenile ate a full adult ration while paying a juvenile's upkeep, and
      // was quietly subsidised. It is still a change to an energy source, so it
      // ships behind `massScaleIntake` for a reproducible control (DOCS §14).
      const rate =
        params.intakeRate *
        (this.massScaleIntake ? this.#massScale(entity, species) : 1) *
        (1 - entity.impairment * this.injuryFeedPenalty) *
        (1 - diseaseSeverity(entity, this.diseaseFeedPenalty));
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

      const gain = removed * params.energyPerBiomass * params.efficiency;
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
  #eatCarcass(world, context, entity, species) {
    const params = species?.feeding ?? this;
    const deficit = entity.maxEnergy - entity.energy;
    if (deficit <= 0) return;

    let carcass = null;
    let bestDistance = Infinity;
    for (const otherId of world.grid.queryRadius(entity.x, entity.y, params.carcassRange)) {
      const other = world.entities.get(otherId);
      if (!other || other.kind !== 'carcass' || other.edibleMass <= 0) continue;
      const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        carcass = other;
      }
    }
    if (!carcass) return;

    // Possession (2026-07-28, PLAN-SPECIES.md §3.9). Until now several
    // carnivores on one body contended only through entity id order — the lower
    // id ate first and the rest took the remainder, which is not competition,
    // it is a queue. Now the body has a holder, and this animal either feeds
    // beside it, waits, or takes it.
    const holder = holderOf(world, carcass, this.possession);
    let share = 1;
    if (!mayFeedFreely(holder, entity)) {
      if (outranks(entity, holder)) {
        // A challenge. Exactly three draws whatever happens, on the possession
        // stream's own sequence, so a fight over a body cannot shift the `social`
        // stream that mate contests and territory disputes share.
        const result = resolveContest(entity, holder, context.random('possession'), {
          escalationChance: this.possession.escalationChance,
          fightInjurySeverity: this.possession.fightInjurySeverity,
          winnerInjuryFraction: this.possession.fightWinnerInjuryFraction,
          injuryHealthDamage: this.injuryHealthDamage,
          tick: context.tick,
          maxInjuries: this.maxInjuries,
        });
        // Dominance decided it before the draws were spent, so the challenger
        // wins by construction — but read the result rather than assuming it, so
        // the two can never drift apart.
        if (result.winner.id !== entity.id) share = this.possession.share;
        else {
          // Kill theft, published with both scores rather than as a bare fact —
          // the same discipline `entity.contested` and `entity.disputed` follow,
          // because dominance decided it and there are no odds to report.
          context.emit(EventTypes.ENTITY_ROBBED, {
            entityId: entity.id,
            victimId: holder.id,
            carcassId: carcass.id,
            dominance: dominanceOf(entity),
            victimDominance: dominanceOf(holder),
            escalated: result.escalated,
            injured: result.injured,
          });
        }
      } else {
        // ⚠ **Scraps, not exclusion, and the difference was measured.** An
        // outmatched animal does not challenge — dominance decides a contest, so
        // it would be choosing to lose and risking a wound for it — but neither
        // is it sent away with nothing. Strict exclusion cost the demo three
        // seeds of predator survival by locking *young* stalkers out of bodies
        // held by adult corvids (`dominanceOf` halves for immaturity, and the
        // demo runs ~80 corvids to ~7 stalkers); see `predation/possession.js`.
        share = this.possession.share;
      }
      if (!(share > 0)) return;
    }

    // Freshness matters (Step 18): a fresh kill is a windfall, old remains are
    // barely worth the walk. One shared definition, in CarcassSystem.
    const freshness = CarcassSystem.yieldFor(carcass);
    const energyPerUnit = params.energyPerMass * params.carnivoreEfficiency * freshness;
    const maxUseful = energyPerUnit > 0 ? deficit / energyPerUnit : 0;
    // ⚠ Intake is **mass-scaled** (Step 29). Until a third carnivore existed
    // this was a flat rate, so a 4 kg scavenger stripped a carcass exactly as
    // fast as a 45 kg predator — invisible while every carnivore was the same
    // size, and immediately decisive once one was not. Scaled on the same
    // allometric exponent metabolism already uses, so a big animal eats faster
    // *and* burns more, and the reference-mass animal is unchanged.
    //
    // ⚠ `share` is the possession term: 1 for the holder, its groupmates, and
    // whoever just took the body off them, and `possession.share` for a
    // bystander picking at the edge. At 1 it is exactly the identity, so a body
    // nobody is standing over is eaten at precisely the old rate.
    const rate =
      params.fleshIntakeRate *
      share *
      this.#massScale(entity, species) *
      (1 - entity.impairment * this.injuryFeedPenalty) *
      (1 - diseaseSeverity(entity, this.diseaseFeedPenalty));
    const taken = Math.min(rate, carcass.edibleMass, maxUseful);
    if (taken <= 0) return;

    carcass.edibleMass -= taken;
    // ⚠ Claimed by **eating**, and only once a bite actually landed. The act is
    // the claim, so there is no separate "take possession" step for a future
    // caller to forget — and an animal that reached a body but took nothing off
    // it (satiated, or the last scrap went to a lower id this tick) has not
    // taken it from anybody.
    //
    // ⚠ Guarded on `enabled` even though nothing *reads* the field when
    // possession is off. The switch is the control this change was measured
    // against, and a control that leaves a different value in the save is not
    // the old world — it is the old world plus a field. Writing it anyway cost
    // nothing behaviourally and would have made every "identical to before"
    // claim in this phase quietly false (D30).
    //
    // ⚠ And only a full share claims: an animal picking scraps at the edge of
    // somebody else's kill has not taken it, so the claim cannot pass back and
    // forth between the holder and the bystanders it is holding off.
    if (this.possession.enabled && share === 1) carcass.possessorId = entity.id;
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
   *
   * ⚠ Read from the **`metabolism`** block, not `feeding`, and per species —
   * because that is where `referenceMass` and `massScalingExponent` live and
   * where `MetabolismSystem` reads them. Until 2026-07-28 this used the
   * constructor's copy, so a species that overrode `metabolism.referenceMass`
   * would have changed what it *burns* without changing what it can *take in* —
   * a silent asymmetry between two halves of one allometry.
   *
   * @param {object} entity @param {object | null} species
   */
  #massScale(entity, species) {
    const referenceMass = species?.metabolism?.referenceMass ?? this.referenceMass;
    const exponent = species?.metabolism?.massScalingExponent ?? this.massScalingExponent;
    if (!(referenceMass > 0) || !(entity.bodyMass > 0)) return 1;
    return (entity.bodyMass / referenceMass) ** exponent;
  }
}
