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
 * ⚠ Since phase 10 the same product carries **who is standing with each animal**,
 * from both sides: co-attackers raise the odds (`predation/cooperation.js`) and a
 * mob lowers them and makes the attempt dangerous (`predation/mobbing.js`). Both
 * are gated on a per-species weight that is 0 for every shipped species, so both
 * are exactly the identity — the demo is byte-identical with them switched off.
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
import { attackersFor, cooperationBonus, DEFAULT_COOPERATION } from '../predation/cooperation.js';
import { mobbersFor, DEFAULT_MOBBING } from '../predation/mobbing.js';

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
   * @param {number} [options.agility] how much better than its speed the prey turns (prey-resolved)
   * @param {number} [options.riskyMassRatio] cap on how dangerous heavy prey gets (from `config.predation`)
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
    agility = 1,
    riskyMassRatio = 2,
    preyInjuryChance = 0.55,
    preyInjurySeverity = 0.35,
    predatorInjuryChance = 0.08,
    predatorInjurySeverity = 0.25,
    injuryHealthDamage = 60,
    defenderWeight = 0.12,
    maxDefenders = 4,
    defenderInjuryBonus = 2.5,
    // Cooperative action (phase 10). Both are world-level sections of their own
    // — `config.cooperation` and `config.mobbing` — rather than fields of the
    // `hunting` species block, because a species block beats the config and an
    // off switch inside one cannot switch anything off (DOCS §8). The per-species
    // halves are `hunting.cooperationWeight` and `behavior.mobWeight`, both 0.
    cooperationEnabled = DEFAULT_COOPERATION.enabled,
    cooperationRange = DEFAULT_COOPERATION.range,
    mobbingEnabled = DEFAULT_MOBBING.enabled,
    mobbingRange = DEFAULT_MOBBING.range,
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
    this.agility = agility;
    // From `config.predation`, not `config.hunting` — wired in by the composition
    // root so there is one home for it (D11) and this is only the fallback for a
    // species the registry does not know.
    this.riskyMassRatio = riskyMassRatio;
    this.preyInjuryChance = preyInjuryChance;
    this.preyInjurySeverity = preyInjurySeverity;
    this.predatorInjuryChance = predatorInjuryChance;
    this.predatorInjurySeverity = predatorInjurySeverity;
    this.injuryHealthDamage = injuryHealthDamage;
    this.defenderWeight = defenderWeight;
    this.maxDefenders = maxDefenders;
    this.defenderInjuryBonus = defenderInjuryBonus;
    // Held as frozen objects so the predicates take one argument rather than
    // three, exactly as `possession` is in the decision and feeding systems.
    this.cooperation = Object.freeze({ ...DEFAULT_COOPERATION, enabled: cooperationEnabled, range: cooperationRange });
    this.mobbing = Object.freeze({ ...DEFAULT_MOBBING, enabled: mobbingEnabled, range: mobbingRange });
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

      // `hunting` is a species block from 2026-07-28: how an animal captures is
      // the **predator's** biology, so this resolves off the hunter. Falls back
      // to the system's own options for an unknown species, like every other
      // per-species read. The injury fields stay on `this` — they come from
      // `config.injury`, not `config.hunting`, and are not part of the block.
      const params = world.species.get(entity.speciesId)?.hunting ?? this;

      const distance = Math.hypot(prey.x - entity.x, prey.y - entity.y);
      if (distance > params.captureRange) continue; // still closing; no attempt yet

      // Cooperative defense (Step 23). Two separate things, and they are worth
      // keeping separate: adult groupmates standing around the prey make the
      // attempt harder for everyone (collective vigilance — a stalker cannot
      // watch six directions), while an adult that has actively chosen to
      // `defend` this particular animal is worth more than any of them.
      // ⚠ Since phase 10 this also carries the **mob**: the animals that have
      // actively chosen to stand over this one, which is `defend` reached by a
      // groupmate trigger rather than a kin one (see predation/mobbing.js). Empty
      // for every shipped species, since all four leave `behavior.mobWeight` at 0.
      const defenders = this.defendersFor(world, prey);
      // ⚠ Two blocks, two owners. `params` is the **hunter's** — how you capture
      // is your biology. `preyParams` is the **prey's**, and carries the two
      // fields in this block that describe the animal being eaten rather than
      // the one eating: `edibleMassFraction` (how much of a body is meat) and,
      // from 2026-07-28, `agility` (how well it turns). Resolved once here
      // rather than twice below, since an attempt needs both.
      const preyParams = world.species.get(prey.speciesId)?.hunting ?? this;
      // Cooperative hunting (phase 10, PLAN-SPECIES.md §3.7) — the mirror of the
      // defense above, counted from the hunter's side. ⚠ Gated on the hunter's own
      // weight first, so a species that does not cooperate never touches the grid:
      // every shipped species leaves `cooperationWeight` at 0, which makes this
      // exactly the identity and exactly free.
      const attackers =
        (params.cooperationWeight ?? 0) > 0 ? attackersFor(world, entity, prey, this.cooperation) : 0;
      const chance = this.captureChance(entity, prey, defenders, params, preyParams, attackers);
      const captured = random.next() < chance;
      const preyRoll = random.next();
      const predatorRoll = random.next();
      entity.lastHuntTick = context.tick;
      entity.stamina = Math.max(0, entity.stamina - params.captureStaminaCost);
      const { cellX, cellY } = world.cellOf(prey.x, prey.y);

      context.emit(EventTypes.ENTITY_HUNTED, {
        entityId: entity.id,
        targetId: prey.id,
        chance,
        captured,
        // Reported alongside the odds for the same reason the odds are reported
        // at all: an observer should be able to see *why* this hunt was hard.
        defenders: defenders.count,
        guarded: defenders.guardian !== null,
      });
      // ⚠ **A mobber reports through `entity.defended`, and that is not a
      // stretched meaning of the event — it is the one it was given.** The type
      // means "an adult putting itself between a predator and a groupmate or its
      // own young", and the renderer labels it "an adult defending another": a
      // buffalo standing over a herdmate is exactly that. So mobbing needs no new
      // event type and no protocol bump, which is the opposite of the
      // `entity.contested` case, where reusing a type *would* have made the UI
      // lie (a carcass fight is not a fight over a mate).
      if (defenders.guardian !== null) {
        context.emit(EventTypes.ENTITY_DEFENDED, {
          entityId: defenders.guardian.id,
          wardId: prey.id,
          threatId: entity.id,
        });
      }
      // Bounded by the number that actually moved the odds, so a crowd cannot
      // turn one attempt into an event storm (§1.4 C3).
      for (let i = 0; i < defenders.mob.length && i < params.maxDefenders; i += 1) {
        context.emit(EventTypes.ENTITY_DEFENDED, {
          entityId: defenders.mob[i].id,
          wardId: prey.id,
          threatId: entity.id,
        });
      }

      if (captured) {
        // ⚠ `edibleMassFraction` reads off the **prey**, not the hunter. It sits
        // in the `hunting` block, but what it describes is how much of a body is
        // meat — a fact about the animal that died, not about what killed it.
        // Identical today (nothing overrides it); the distinction matters the
        // first time two prey species differ in build.
        killAnimal(prey, 'predation', prey.bodyMass * preyParams.edibleMassFraction, context.emit, context.tick);
        context.emit(EventTypes.ENTITY_KILLED, { entityId: prey.id, predatorId: entity.id });
      } else {
        // A miss costs the predator real energy, and teaches the prey that this
        // is a bad place to be — the writer the `danger` memory kind (Step 15)
        // was waiting for.
        entity.energy = Math.max(0, entity.energy - params.failedHuntEnergyCost);
        recordMemory(prey, MemoryKinds.DANGER, cellX, cellY, context.tick, this.maxMemories);
        context.emit(EventTypes.ENTITY_ESCAPED, { entityId: prey.id, predatorId: entity.id });

        // "Escaped" rarely means unscathed (Step 17). The prey usually carries
        // something away from a lunge that connected but did not hold, and a
        // big enough animal can hurt its attacker on the way out — which is
        // what makes hunting a gamble in both directions.
        this.#wound(prey, InjuryKinds.WOUND, this.preyInjuryChance, this.preyInjurySeverity, entity, context, preyRoll);
        // A defended kill is dangerous to attempt: a parent standing over its
        // young is far likelier to hurt the attacker than the young itself is.
        // Same roll, so the draw budget stays at three.
        const guardian = defenders.guardian;
        // The heaviest animal standing in the way, which since phase 10 may be a
        // mobber rather than a parent — a lion that presses a hunt into a buffalo
        // herd is answering to the *herd's* mass, not to the calf's.
        let defenderMass = guardian ? Math.max(prey.bodyMass, guardian.bodyMass) : prey.bodyMass;
        for (const mobber of defenders.mob) {
          if (mobber.bodyMass > defenderMass) defenderMass = mobber.bodyMass;
        }
        // ⚠ The cap on that ratio was a bare `2` until 2026-07-28 and is now
        // `predation.riskyMassRatio`, resolved off the **hunter** — how much
        // risk this predator's build lets it take on. Default 2, so this is a
        // magic number becoming species data rather than a change: it is what
        // a lion taking buffalo raises, and the hook PLAN-SPECIES.md §3.6 named
        // rather than a new mechanism.
        const riskCap = world.species.get(entity.speciesId)?.predation?.riskyMassRatio ?? this.riskyMassRatio;
        // ⚠ One active defender is **exactly** `defenderInjuryBonus`, which is
        // what this expression was before mobbing existed — written this way
        // rather than as `1 + (bonus − 1) × n` precisely so the single-guardian
        // case stays bit-identical (that form is only exact for some values of
        // `bonus`, and an inertness proof cannot rest on which).
        const active = Math.min(params.maxDefenders, (guardian ? 1 : 0) + defenders.mob.length);
        const injuryBonus = active === 0 ? 1 : params.defenderInjuryBonus + (active - 1) * (params.defenderInjuryBonus - 1);
        const trampleChance =
          this.predatorInjuryChance *
          Math.min(riskCap, defenderMass / Math.max(entity.bodyMass, 1e-6)) *
          injuryBonus;
        this.#wound(entity, InjuryKinds.TRAMPLE, trampleChance, this.predatorInjurySeverity, guardian ?? prey, context, predatorRoll);
      }
    }
  }

  /**
   * Who is standing with this prey animal (Step 23).
   *
   * Both halves are free of new scans. The adult-groupmate count is read
   * straight off the social summary the social system already built this tick,
   * and the active guardian is found by walking the prey's own sparse `parents`
   * list — kin recognition through the authoritative lineage, not a search.
   *
   * ⚠ **The third field is the mob** (phase 10): animals with no kin claim on
   * this one that have chosen to stand over it anyway. It is found by the one
   * signal a mob has — `defendingId`, which the decision system already writes —
   * and it costs a radius query around the prey **only** when the prey's species
   * declares `behavior.mobWeight`. Every shipped species leaves that at 0, so this
   * returns the same two fields it always did, from the same two reads.
   *
   * @param {import('../world/World.js').World} world @param {object} prey
   * @returns {{count: number, guardian: object|null, mob: object[]}}
   */
  defendersFor(world, prey) {
    const summary = world.social?.get(prey.id) ?? null;
    const count = Math.min(this.maxDefenders, summary?.adults ?? 0);
    let guardian = null;
    for (const parentId of prey.parents ?? []) {
      const parent = world.entities.get(parentId);
      if (!parent || !parent.alive || parent.kind !== 'animal') continue;
      // Only a parent that has actually chosen to stand over *this* animal
      // counts — being nearby is the group effect above, not a defense.
      if (parent.defendingId === prey.id) {
        guardian = parent;
        break;
      }
    }
    const mobs = (world.species?.get(prey.speciesId)?.behavior?.mobWeight ?? 0) > 0;
    const mob = mobs ? mobbersFor(world, prey, guardian, this.mobbing) : EMPTY_MOB;
    return { count, guardian, mob };
  }

  /**
   * Probability that this predator takes this prey, from their relative state
   * and who is standing with it. Public so tests and inspection can read the
   * odds rather than infer them.
   *
   * `hunting` is a species block from 2026-07-28, so two predators can differ in
   * how they capture. The resolved block arrives as `params` rather than being
   * looked up here, for two reasons: this method has no `world` to look it up
   * *from*, and defaulting to `this` keeps every direct caller — a dozen tests
   * that construct the system with custom odds — meaning exactly what it says.
   * ⚠ That is the D23 trap avoided rather than re-sprung: a species block beating
   * a constructor option is how 23 tests once kept compiling and stopped
   * meaning anything.
   *
   * @param {object} predator @param {object} prey
   * @param {{count: number, guardian: object|null}} [defenders]
   * @param {object} [params] resolved per-species `hunting` block for the **hunter**; defaults to the system's own
   * @param {object} [preyParams] the same block resolved for the **prey**, which
   *        is where `agility` lives; defaults to the hunter's, so a direct
   *        caller that supplies neither still gets the system's own numbers
   * @param {number} [attackers] other hunters committed to the same quarry
   *        (phase 10). 0 — the default, and what every shipped species produces —
   *        makes the cooperation term exactly 1
   * @returns {number} probability in [minCaptureChance, maxCaptureChance]
   */
  captureChance(predator, prey, defenders = NO_DEFENDERS, params = this, preyParams = params, attackers = 0) {
    // Raw speed, before either has spent anything.
    const speedRatio = prey.speed > 0 ? predator.speed / prey.speed : 2;

    // Whoever has more sprint left is winning the last few strides.
    const predatorFresh = predator.maxStamina > 0 ? predator.stamina / predator.maxStamina : 0;
    const preyFresh = prey.maxStamina > 0 ? prey.stamina / prey.maxStamina : 0;
    const staminaEdge = 1 + params.staminaWeight * (predatorFresh - preyFresh);

    // A wounded animal, or one that has not finished growing, is easier caught.
    const healthFraction = prey.maxHealth > 0 ? prey.health / prey.maxHealth : 1;
    const grown = prey.adultMass > 0 ? Math.min(1, prey.bodyMass / prey.adultMass) : 1;
    const vulnerability = 1 + params.vulnerabilityWeight * ((1 - healthFraction) + (1 - grown)) * 0.5;

    // Company (Step 23). Each adult standing nearby shaves the odds, with
    // diminishing returns capped at `maxDefenders` — a herd of forty is not
    // forty times safer than a herd of four, and an uncapped term would make a
    // large herd untouchable, which is the sort of accidental invulnerability
    // the min/max clamps exist to prevent. A parent actively interposing counts
    // for more than a bystander, because it is between the predator and the
    // prey rather than merely present.
    // ⚠ A **mobber counts exactly as an interposing parent does** (phase 10), and
    // for the same reason: it is between the predator and the prey rather than
    // merely present. The capped `active` count is what keeps a herd of forty
    // from being untouchable, and with an empty mob this is the expression it was
    // before mobbing existed, term for term.
    const bystanders = Math.min(params.maxDefenders, defenders.count ?? 0);
    const active = Math.min(params.maxDefenders, (defenders.guardian ? 1 : 0) + (defenders.mob?.length ?? 0));
    const shielding = 1 / (1 + params.defenderWeight * (bystanders + 2 * active));

    // Agility (PLAN-SPECIES.md §3.15). Everything above this line is about
    // *speed*: the raw ratio, who has sprint left, whether the prey is sound.
    // A gazelle's living is not made on speed but on turning better than the
    // thing behind it, and until now there was no term for that at all. This is
    // it — one divide, resolved off the **prey**, since manoeuvre is the animal
    // being chased. ⚠ At the default of 1 this is exactly the identity
    // (`x / 1 === x`), which is the guarantee D16 asks of any "at zero it does
    // nothing" claim.
    const agility = preyParams.agility ?? 1;
    // Company on the hunter's side (phase 10, PLAN-SPECIES.md §3.7) — the mirror
    // of `shielding`, and the term that makes a pride different from several
    // adjacent independent predators. ⚠ Exactly 1 at `cooperationWeight: 0` or
    // with nobody else on the quarry, which is every hunt in the shipped world, so
    // the product is bit-identical until a species asks for it.
    const cooperation = cooperationBonus(attackers, params);
    const chance =
      (params.baseCaptureChance * speedRatio * staminaEdge * vulnerability * shielding * cooperation) / agility;
    return Math.min(params.maxCaptureChance, Math.max(params.minCaptureChance, chance));
  }
}

/** One shared empty mob, so the common answer allocates nothing. */
const EMPTY_MOB = Object.freeze([]);
/** The default for a direct caller that supplies no defenders at all. */
const NO_DEFENDERS = Object.freeze({ count: 0, guardian: null, mob: EMPTY_MOB });
