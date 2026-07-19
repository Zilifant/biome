/**
 * Predation (Step 16) — the capture-or-escape stage of the hunt.
 *
 * The pipeline is deliberately spread across the systems that already own each
 * part, rather than collapsed into one opaque roll:
 *
 *   detect   → perception reports the nearest animal that hunts you and the
 *              nearest one you hunt (`nearestThreat` / `nearestPrey`)
 *   evaluate → the decision system gates hunting on hunger, stamina, and the
 *              post-attempt cooldown, and gives prey a `flee` action that
 *              outranks everything else it might be doing
 *   approach → `stalk` closes at a walk, conserving the sprint budget
 *   chase    → `chase` sprints, and the movement system spends stamina for it
 *   capture  → **this system**: inside `captureRange`, one attempt whose
 *              probability comes from the two animals' relative state
 *   feed     → the kill becomes a carcass; the feeding system's carnivore
 *              branch eats it
 *   recover  → stamina regenerates in the metabolism system, and
 *              `lastHuntTick` keeps the predator from re-attacking instantly
 *
 * The capture roll is a roll, but the *probability* is not a constant: it is
 * the predator's effective speed against the prey's, weighted by how much
 * sprint each has left, and by how vulnerable the prey is (wounded, or not yet
 * grown). A fresh adult grazer with a head start usually gets away; a tired or
 * half-grown one usually does not.
 *
 * Runs in the `interaction` phase at priority 5 — after feeding (0) and before
 * reproduction (10), so a kill this tick is available to eat and a killed
 * animal cannot also mate. Exactly three draws per attempt on the `hunting`
 * stream (capture, then a wound roll for each animal), regardless of outcome.
 *
 * Ownership: writes `lastHuntTick` on the predator, kills prey via the shared
 * `killAnimal` helper, wounds survivors via the shared `applyInjury` helper
 * (Step 17), and records the attack site in the prey's memory as `danger`.
 * Reads `huntTargetId` (the decision system owns it). No global scans — the
 * target is resolved by id.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { killAnimal } from './death.js';
import { recordMemory, MemoryKinds, MAX_MEMORIES } from '../memory/memories.js';
import { applyInjury, InjuryKinds, MAX_INJURIES } from '../injury/injuries.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';

export class HuntingSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.captureRange] distance at which an attempt happens
   * @param {number} [options.baseCaptureChance] chance between evenly matched animals
   * @param {number} [options.minCaptureChance] floor, so nothing is ever untouchable
   * @param {number} [options.maxCaptureChance] ceiling, so nothing is ever certain
   * @param {number} [options.staminaWeight] how much the sprint budget tilts the odds
   * @param {number} [options.vulnerabilityWeight] how much a weakened prey tilts them
   * @param {number} [options.failedHuntEnergyCost] energy a missed attempt burns
   * @param {number} [options.captureStaminaCost] stamina the lunge itself costs
   * @param {number} [options.edibleMassFraction] carcass edible mass fraction
   * @param {number} [options.preyInjuryChance] chance an escaping prey is wounded
   * @param {number} [options.preyInjurySeverity] how bad such a wound is
   * @param {number} [options.predatorInjuryChance] chance the prey hurts its attacker
   * @param {number} [options.predatorInjurySeverity]
   * @param {number} [options.injuryHealthDamage] health lost per unit of severity
   * @param {number} [options.maxInjuries]
   * @param {number} [options.maxMemories]
   * @param {number} [options.updateInterval]
   */
  constructor({
    captureRange = 1.2,
    baseCaptureChance = 0.28,
    minCaptureChance = 0.02,
    maxCaptureChance = 0.9,
    staminaWeight = 0.6,
    vulnerabilityWeight = 0.8,
    failedHuntEnergyCost = 4,
    captureStaminaCost = 12,
    edibleMassFraction = 0.6,
    preyInjuryChance = 0.55,
    preyInjurySeverity = 0.35,
    predatorInjuryChance = 0.08,
    predatorInjurySeverity = 0.25,
    injuryHealthDamage = 60,
    maxInjuries = MAX_INJURIES,
    maxMemories = MAX_MEMORIES,
    updateInterval = 1,
  } = {}) {
    super({ id: 'hunting', phase: 'interaction', priority: 5, updateInterval });
    this.captureRange = captureRange;
    this.baseCaptureChance = baseCaptureChance;
    this.minCaptureChance = minCaptureChance;
    this.maxCaptureChance = maxCaptureChance;
    this.staminaWeight = staminaWeight;
    this.vulnerabilityWeight = vulnerabilityWeight;
    this.failedHuntEnergyCost = failedHuntEnergyCost;
    this.captureStaminaCost = captureStaminaCost;
    this.edibleMassFraction = edibleMassFraction;
    this.preyInjuryChance = preyInjuryChance;
    this.preyInjurySeverity = preyInjurySeverity;
    this.predatorInjuryChance = predatorInjuryChance;
    this.predatorInjurySeverity = predatorInjurySeverity;
    this.injuryHealthDamage = injuryHealthDamage;
    this.maxInjuries = maxInjuries;
    this.maxMemories = maxMemories;
  }

  /**
   * Maybe wound `victim` with an already-drawn value, so the caller controls
   * the draw budget and the stream advances identically whether or not anyone
   * actually gets hurt.
   */
  #wound(victim, kind, chance, severityScale, source, context, roll) {
    if (roll >= chance) return;

    // Severity scales with how much of the roll was "used up": a marginal hit
    // grazes, a decisive one mauls.
    const severity = severityScale * (0.4 + 0.6 * (1 - roll / Math.max(chance, 1e-6)));
    const injury = applyInjury(victim, kind, severity, context.tick, this.maxInjuries);
    if (!injury) return;

    victim.health = Math.max(0, victim.health - severity * this.injuryHealthDamage);
    recordLifeEvent(victim, context.tick, LifeEventTypes.INJURED, { injury: kind });
    context.emit(EventTypes.ENTITY_INJURED, {
      entityId: victim.id,
      injury: kind,
      severity,
      sourceId: source.id,
    });
  }

  update(world, context) {
    const random = context.random('hunting');
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      if (entity.action !== 'chase' || entity.huntTargetId === null) continue;

      const prey = world.entities.get(entity.huntTargetId);
      if (!prey || !prey.alive || prey.kind !== 'animal') continue;

      const distance = Math.hypot(prey.x - entity.x, prey.y - entity.y);
      if (distance > this.captureRange) continue; // still closing; no attempt yet

      // One attempt: a lunge, whichever way it goes. The draw budget is fixed
      // at three per attempt (capture, then the two injury rolls) so the
      // hunting stream never shifts with the outcome.
      const chance = this.captureChance(entity, prey);
      const captured = random.next() < chance;
      const preyRoll = random.next();
      const predatorRoll = random.next();
      entity.lastHuntTick = context.tick;
      entity.stamina = Math.max(0, entity.stamina - this.captureStaminaCost);
      const { cellX, cellY } = world.cellOf(prey.x, prey.y);

      context.emit(EventTypes.ENTITY_HUNTED, {
        entityId: entity.id,
        targetId: prey.id,
        chance,
        captured,
      });

      if (captured) {
        killAnimal(prey, 'predation', prey.bodyMass * this.edibleMassFraction, context.emit, context.tick);
        context.emit(EventTypes.ENTITY_KILLED, { entityId: prey.id, predatorId: entity.id });
      } else {
        // A miss costs the predator real energy, and teaches the prey that this
        // is a bad place to be — the writer the `danger` memory kind (Step 15)
        // was waiting for.
        entity.energy = Math.max(0, entity.energy - this.failedHuntEnergyCost);
        recordMemory(prey, MemoryKinds.DANGER, cellX, cellY, context.tick, this.maxMemories);
        context.emit(EventTypes.ENTITY_ESCAPED, { entityId: prey.id, predatorId: entity.id });

        // "Escaped" rarely means unscathed (Step 17). The prey usually carries
        // something away from a lunge that connected but did not hold, and a
        // big enough animal can hurt its attacker on the way out — which is
        // what makes hunting a gamble in both directions.
        this.#wound(prey, InjuryKinds.WOUND, this.preyInjuryChance, this.preyInjurySeverity, entity, context, preyRoll);
        const trampleChance = this.predatorInjuryChance * Math.min(2, prey.bodyMass / Math.max(entity.bodyMass, 1e-6));
        this.#wound(entity, InjuryKinds.TRAMPLE, trampleChance, this.predatorInjurySeverity, prey, context, predatorRoll);
      }
    }
  }

  /**
   * Probability that this predator takes this prey, from their relative state.
   * Public so tests and inspection can read the odds rather than infer them.
   *
   * @param {object} predator @param {object} prey
   * @returns {number} probability in [minCaptureChance, maxCaptureChance]
   */
  captureChance(predator, prey) {
    // Raw speed, before either has spent anything.
    const speedRatio = prey.speed > 0 ? predator.speed / prey.speed : 2;

    // Whoever has more sprint left is winning the last few strides.
    const predatorFresh = predator.maxStamina > 0 ? predator.stamina / predator.maxStamina : 0;
    const preyFresh = prey.maxStamina > 0 ? prey.stamina / prey.maxStamina : 0;
    const staminaEdge = 1 + this.staminaWeight * (predatorFresh - preyFresh);

    // A wounded animal, or one that has not finished growing, is easier caught.
    const healthFraction = prey.maxHealth > 0 ? prey.health / prey.maxHealth : 1;
    const grown = prey.adultMass > 0 ? Math.min(1, prey.bodyMass / prey.adultMass) : 1;
    const vulnerability = 1 + this.vulnerabilityWeight * ((1 - healthFraction) + (1 - grown)) * 0.5;

    const chance = this.baseCaptureChance * speedRatio * staminaEdge * vulnerability;
    return Math.min(this.maxCaptureChance, Math.max(this.minCaptureChance, chance));
  }
}
