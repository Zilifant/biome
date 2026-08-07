/**
 * Utility-based action selection (Step 8).
 *
 * Each tick, every living animal scores a small fixed set of candidate actions
 * from its hunger and perception, then commits to the best one. This replaces
 * the random wander that used to live in the movement system: decisions choose
 * WHAT to do and set the movement intent; the movement system merely executes
 * it. Actions:
 *   - defend       — a predator is on kin or a groupmate; stand and face it
 *                    (the groupmate half is mobbing, added phase 10 — see
 *                    predation/mobbing.js for why it is not its own action)
 *   - flee         — a predator is in sight; sprint away (outranks everything)
 *   - herd         — drifted from the herd's centre; close up and fall in line
 *   - retreat      — standing on a rival's marked ground; get off it
 *   - patrol       — outside its own home range; head back to familiar ground
 *   - stalk        — prey sighted but out of range; close at a walk
 *   - chase        — prey within range; sprint (the hunting system resolves it)
 *   - eat          — standing on a food cell (consumption itself is Step 9)
 *   - seekFood     — food perceived nearby; head toward it (subsumes "approach")
 *   - recallFood   — nothing in sight, but it remembers eating somewhere
 *   - recallWater  — nothing in sight, but it remembers drinking somewhere
 *   - shelter      — the weather is biting; head for cover
 *   - seekMate     — reproductively ready; close on the best candidate in sight
 *   - followParent — a dependent juvenile keeping up with its guardian
 *   - hide         — a newborn too young to follow; lie still and wait (§3.14)
 *   - tend         — go back to a hidden calf that is getting hungry (§3.14)
 *   - rest         — stay put (attractive when satiated, never near danger)
 *   - wander       — undirected exploration with a committed heading
 *
 * ⚠ Since phase 9 the two food actions are discounted by the species' **grass
 * maturity** preference (`habitat/forage.js`) — the first thing in this system that
 * is non-monotonic in biomass: more grass is no longer automatically better. It
 * scales the hunger drive rather than the whole utility, so hunger still overrides
 * it.
 *
 * ⚠ Phase 10 added **no action at all**, deliberately, and the two mechanisms it
 * did add are the reason the list above is unchanged: mobbing became the
 * groupmate half of `defend` (which DOCS §7 has described as "kin *or a
 * groupmate*" since Step 23), and cooperative hunting became a different *target*
 * for the `stalk`/`chase` a predator already had. Both effects land on products
 * that already exist — `shielding`, `trampleChance`, `captureChance` — which is
 * the phase-9 rule generalized: a preference chooses a direction and a need sets
 * the strength; nothing new gets a seat at the utility table.
 *
 * ⚠ `hide` and `tend` are the **first new actions in six steps**, and the bar
 * they had to clear is DOCS §9 Decision's rule that four consecutive steps
 * deliberately added none — a new movement behaviour competes with foraging, and
 * foraging must win. These two do not compete with it: `hide` belongs to an
 * unweaned calf that does not forage at all, and `tend` fires only for a parent
 * whose calf is actually hungry. Both are gated on `aging.hiddenUntil`, which is
 * 0 for every species that does not ask for them.
 *
 * ⚠ Phase F1 added **no action either**, and for the same reason phase 10 did
 * not: flight is a *pace* on the intent — the shape `intent.sprint` already had —
 * decided from the action the animal has already chosen. `entity.flying` is
 * written here and nowhere else (see `locomotion/flight.js`), which is why this
 * system's ownership list grew a field and the list above did not grow a line.
 *
 * Runs in the `decision` phase (after perception, before movement). Ownership:
 * writes `action`, `actionTarget`, `utilityBreakdown`, **`flying`**, and
 * `moveIntent`; reads
 * `world.perception`, physiology, vegetation (its standing crop, as both food and
 * maturity — phase 9), bounded `memories` (Step 15),
 * and the `boldness` / `caution` / `exploration` / `choosiness` traits (the last
 * via mating/mateChoice.js, which the reproduction system shares), plus
 * `world.social` and alarm state (Step 23). It also writes `defendingId`, the
 * animal it has decided to stand over, which the hunting system reads.
 * Determinism: exactly two
 * draws per animal per tick on the `decision` stream (an exploration/tiebreak
 * roll and a candidate wander heading), regardless of which action wins.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { isReproductivelyReady } from './ReproductionSystem.js';
import { bestRemembered, isNearDanger, MemoryKinds } from '../memory/memories.js';
import { thermalStress } from '../world/Environment.js';
import { bestMateCandidate, isChooser, matePreferenceFor } from '../mating/mateChoice.js';
import { DEFAULT_BREEDING } from '../mating/breeding.js';
import { DEFAULT_CONCEALMENT, concealedApproach, stalksFromCover } from '../perception/concealment.js';
import { isKin } from '../social/dominance.js';
import { CONSPECIFIC_PULL } from '../social/association.js';
import { holdsClaim, territoryOf } from './TerritorySystem.js';
import { blendHeadings } from '../migration/migration.js';
import { DEFAULT_POSSESSION, isAvailableTo, reachesCarcass } from '../predation/possession.js';
import { canClimb, isAloft } from '../locomotion/climbing.js';
import { flyingFor } from '../locomotion/flight.js';
import { DEFAULT_COOPERATION, adoptedPrey, approachPoint } from '../predation/cooperation.js';
import { DEFAULT_MOBBING, mobWardFor } from '../predation/mobbing.js';
import { DEFAULT_CHARGE, chargeWeightOf, pursuitTicksOf } from '../predation/charge.js';
import { isHiding, hiddenUntilFor } from '../parenting/hiding.js';
import { forageOf, forageQualityAt, NEUTRAL_QUALITY } from '../habitat/forage.js';
import { normalizeStepRules, stepLength, stepRefused } from '../locomotion/steps.js';
import { herdPackingFloor } from '../social/herding.js';


const TWO_PI = Math.PI * 2;

function normalizeAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class DecisionSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.hungerWeight]
   * @param {number} [options.eatBias]
   * @param {number} [options.restBias]
   * @param {number} [options.wanderBias]
   * @param {number} [options.explorationRate]
   * @param {number} [options.mateWeight] pull toward a mate when reproductively ready
   * @param {number} [options.mateDistanceWeight] mate quality forfeited per unit of distance
   * @param {number} [options.followWeight] pull toward a dependent's guardian
   * @param {number} [options.followDistance] no need to follow inside this range
   * @param {number} [options.recallWeight] how much a memory counts against sight
   * @param {number} [options.recallRange] furthest a remembered place is worth walking to
   * @param {number} [options.recallDistanceWeight] how sharply distance discounts a memory
   * @param {number} [options.dangerRadius] how wide a berth to give remembered danger
   * @param {number} [options.shelterWeight] pull toward cover when the weather bites
   * @param {number} [options.shelterStressThreshold] °C of stress before it is worth moving
   * @param {number} [options.shelterStressSpan] °C at which that pull is at full strength
   * @param {number} [options.shelterRelief] fraction of stress cover removes (matches metabolism)
   * @param {number} [options.fleeWeight] urgency of escaping a perceived predator
   * @param {number} [options.herdWeight] pull back toward the herd's centre
   * @param {number} [options.herdDistance] no need to close up inside this range
   * @param {number} [options.defendWeight] urgency of facing a threat to kin
   * @param {number} [options.defendRange] how far an adult will go to interpose
   * @param {number} [options.patrolWeight] pull back toward its own home range
   * @param {number} [options.patrolSpanFactor] range radii the pull ramps over
   * @param {number} [options.retreatWeight] pull off a rival's marked ground
   * @param {number} [options.intrusionThreshold] claim strength that counts as occupied
   * @param {number} [options.huntWeight] how strongly hunger drives a predator to hunt
   * @param {number} [options.stalkDiscount] stalking's utility relative to chasing
   * @param {number} [options.chaseRange] distance at which stalking becomes a sprint
   * @param {number} [options.minHungerToHunt] a fed predator does not bother
   * @param {number} [options.minHuntStamina] nor does an exhausted one
   * @param {number} [options.huntCooldownTicks] recovery pause after an attempt
   * @param {number} [options.minCommitTicks]
   * @param {number} [options.commitTickSpan]
   * @param {number} [options.wanderJitter]
   * @param {number} [options.foodMinLevel] vegetation level that counts as food
   * @param {number} [options.updateInterval]
   */
  constructor({
    hungerWeight = 1.0,
    thirstWeight = 1.0,
    eatBias = 0.2,
    drinkBias = 0.2,
    restBias = 0.3,
    wanderBias = 0.35,
    explorationRate = 0.05,
    drinkRange = 1.5,
    mateWeight = 0.55,
    mateDistanceWeight = 0.04,
    followWeight = 0.7,
    followDistance = 1.5,
    // Neonatal concealment (PLAN-SPECIES.md §3.14). `hideWeight` is how firmly a
    // hidden calf stays put; `tendWeight` is how hard a hungry one pulls its
    // mother back.
    hideWeight = 1.0,
    tendWeight = 1.6,
    // ⚠ Both belong to `config.parenting` and are wired in from there, never
    // restated — the same D11 discipline as `drinkRange` and `carcassRange`.
    // `provisionRange` is how close she must get to feed it, so it is exactly
    // the distance at which `tend` has nothing left to close;
    // `parentMinEnergyFraction` is the floor below which she would not provision
    // even if she arrived, so below it the trip is pointless.
    provisionRange = 2.0,
    parentMinEnergyFraction = 0.35,
    // ⚠ The world-level off switch, from `config.parenting.concealment`. It is
    // *not* `aging.hiddenUntil: 0`, because a species block beats the config
    // (DOCS §8) — so the config default cannot switch off a species that declares
    // its own. Held as an instance field so an off world pays nothing at all.
    neonatalConcealment = true,
    fleeWeight = 2.0,
    herdWeight = 0.5,
    herdDistance = 3.0,
    // ⚠ The geometric floor under the number above, from `config.social`
    // (2026-08-06). 0 is off and restores the pre-fix arithmetic exactly; see
    // `social/herding.js` for why the floor is derived from the occupancy cap
    // rather than being a constant of its own.
    herdPackingSlack = 0,
    defendWeight = 2.6,
    defendRange = 5.0,
    // A32's last named lever (phase 10): how much further from the predator than
    // itself an adult will tolerate its calf being and still interpose. ⚠ Ships
    // at **0** — the strict test it has always had — because removing the clause
    // entirely was measured not to move A32 at all. See the config for the
    // numbers. `defendTargeted` is the change that did ship: defend the calf the
    // hunter has actually committed to.
    interposeSlack = 0,
    defendTargeted = true,
    patrolWeight = 0.55,
    patrolSpanFactor = 1.5,
    retreatWeight = 0.7,
    intrusionThreshold = 0.35,
    // An animal caught in a thicket heads back out rather than crawling around
    // in it — unless a predator is within `thicketRefugeRadius`, in which case
    // the thicket is cover and it stays. The weight sits above idle behaviour
    // (wander/rest/patrol/herd) and below every real need and directed goal, so
    // a hungry, thirsty, or hunted animal still does the more urgent thing (and
    // those goals lead out of the thicket anyway, since nothing grows or drinks
    // in one). `thicketExitRadius` bounds the search for a way out.
    leaveThicketWeight = 0.6,
    thicketRefugeRadius = 5,
    thicketExitRadius = 12,
    // Acute hunger or thirst (fraction depleted at or above this) suspends the
    // territorial pulls — patrol back to a home range and retreat off a rival's
    // ground. A starving or dehydrating animal that a home range keeps dragging
    // back to the same empty quarter of the map dies there; letting need win
    // frees it to follow the long-range forage/water cue somewhere new.
    needOverridesTerritory = 0.5,
    // With that same unmet need and no directional cue to follow, a wander
    // strikes out in longer, straighter excursions (`rangingCommitBonus` extra
    // commit ticks, jitter scaled by `rangingJitterScale`) so the animal covers
    // new ground instead of re-searching the patch it is standing in. Inert once
    // a migration drift gives it a direction, and for a fed, watered animal.
    rangingThreshold = 0.5,
    rangingCommitBonus = 16,
    rangingJitterScale = 0.4,
    // A thirsty/hungry animal will crawl through a **thin** thicket band to reach
    // water or food just beyond it — the corner-lake case, where the only water
    // is ringed by thicket and refusing the crawl means dying at its edge. Gated
    // hard so it is never a shortcut into deep cover: the need must be at least
    // `thicketReachNeed` and the resource within `thicketReachDistance` cells (a
    // thin band, not a march to death across a crawl at 0.1 speed).
    thicketReachNeed = 0.45,
    thicketReachDistance = 4,
    // How far a climber will haul a kill to reach a tree (phase T3). ⚠ Short
    // on purpose: a cat that drags a carcass across the map is not caching, it
    // is commuting, and the whole point is securing the kill *before* the
    // scavengers arrive. Machinery rather than biology, so it lives in
    // `config.decision` and not in the species block beside `cacheWeight`
    // (DOCS §9 Decision: what an animal wants is biology, how far a search
    // ring reaches is not).
    cacheHaulDistance = 5,
    // The world-level switch for caching, from `config.climbing.caching` (see
    // there for why it cannot live beside `cacheWeight` in the species block).
    caching = true,
    // The world-level switch for flight, from `config.flight.enabled` (phase F1).
    // ⚠ Defaults to **false** here, unlike `caching` above, because this system's
    // constructor options are also the fallback for a test that builds it by
    // hand: a mechanism whose off switch is the default cannot be turned on by
    // accident, and the composition root wires the real value in one place.
    flight = false,
    huntWeight = 1.4,
    stalkDiscount = 0.8,
    chaseRange = 4.0,
    minHungerToHunt = 0.25,
    minHuntStamina = 15,
    huntCooldownTicks = 60,
    carcassRange = 1.5,
    // Carcass possession (see predation/possession.js). Only the two fields the
    // *predicate* needs — this system never resolves a contest, it only declines
    // to steer an animal at a body it would be refused. Wired from the same
    // `config.carcass` home the feeding system reads.
    possessionEnabled = DEFAULT_POSSESSION.enabled,
    possessionRange = DEFAULT_POSSESSION.range,
    possessionShare = DEFAULT_POSSESSION.share,
    // ⚠ Default to the pre-P7 behaviour, so a system built with no options is the
    // old system; `config.carcass` carries what the demo runs on.
    possessionBackingEnabled = DEFAULT_POSSESSION.backingEnabled,
    possessionBackingRange = DEFAULT_POSSESSION.backingRange,
    // Cooperative action (phase 10, PLAN-SPECIES.md §3.7). Two world-level
    // switches, wired from `config.cooperation` and `config.mobbing` — ⚠ *not*
    // from `hunting` or `behavior`, which are species blocks a species overrides
    // (DOCS §8), so a switch inside one could not switch anything off. The
    // per-species halves (`hunting.cooperationWeight`, `behavior.mobWeight`) are
    // 0 for every shipped species, which makes both mechanisms cost one property
    // read and nothing else.
    cooperationEnabled = DEFAULT_COOPERATION.enabled,
    cooperationJoinRange = DEFAULT_COOPERATION.joinRange,
    // ⚠ Both default to the pre-P4 behaviour, so a system built with no options is
    // the old system — every test that constructs one directly keeps meaning what
    // it meant. `config.cooperation` carries what the demo actually runs on.
    cooperationJoinStalks = DEFAULT_COOPERATION.joinStalks,
    cooperationApproachSpread = DEFAULT_COOPERATION.approachSpread,
    cooperationApproachRadius = DEFAULT_COOPERATION.approachRadius,
    mobbingEnabled = DEFAULT_MOBBING.enabled,
    mobbingMinMobbers = DEFAULT_MOBBING.minMobbers,
    mobbingRange = DEFAULT_MOBBING.range,
    // The charge and the pursuit after it (BEHAVIOR-PLAN P9). ⚠ A third global
    // section for the third time and the same reason, and the two numbers here are
    // **bounds rather than preferences**: a species that declares
    // `behavior.chargeWeight` is declaring an action that outranks fleeing, so how
    // much stamina it must keep back and how long it may pursue are not things a
    // species file gets to raise. See `predation/charge.js`.
    chargeEnabled = DEFAULT_CHARGE.enabled,
    chargeStaminaFraction = DEFAULT_CHARGE.staminaFraction,
    maxPursuitTicks = DEFAULT_CHARGE.maxPursuitTicks,
    shelterWeight = 0.9,
    shelterStressThreshold = 2,
    shelterStressSpan = 10,
    shelterRelief = 0.55,
    recallWeight = 0.8,
    recallRange = 60,
    recallDistanceWeight = 0.15,
    dangerRadius = 6,
    reproduction = { minEnergyFraction: 0.7, cooldownTicks: 800 },
    // ⚠ **How close is close enough to stop walking** (2026-08-06), wired from
    // `config.reproduction` — `ReproductionSystem`'s own number, so the distance
    // this system stops seeking at and the distance that system starts pairing at
    // cannot drift apart by half an edit (D11, and the same wiring `drinkRange` and
    // `carcassRange` get for exactly this reason).
    matingRange = 2.0,
    // Seasonal breeding (phase 12, PLAN-SPECIES.md §3.11). ⚠ From
    // `config.breeding`, the global section that owns the switch — the window
    // itself is per-species and lives in the `reproduction` block, which a species
    // overrides, so the switch could not live there (DOCS §8). This system only
    // reads the answer: whether an animal is worth walking to a mate for.
    breedingEnabled = DEFAULT_BREEDING.enabled,
    // Cover concealment (phase 14, PLAN-SPECIES.md §3.12). This system reads only
    // the *approach* half — an ambush predator steps through cover on its way to
    // prey — while perception reads the detection half. One switch, from
    // `config.concealment`, so an off arm turns off both.
    coverConcealment = DEFAULT_CONCEALMENT.enabled && DEFAULT_CONCEALMENT.approach,
    minCommitTicks = 8,
    commitTickSpan = 16,
    wanderJitter = 0.5,
    // ⚠ How much of the migration drift reaches a wander already under way, from
    // `config.migration` (2026-08-06, A71). 0 is the pre-fix behaviour exactly.
    holdBiasScale = 0,
    foodMinLevel = 1,
    // Forage guilds (phase 9, PLAN-SPECIES.md §3.3). ⚠ Both wired from
    // `config.forage`, which is *not* a species block — an off switch inside one
    // could not switch anything off (DOCS §8). `foragePreference: false` restores
    // the phase-8 world exactly: no cell is scored and no quality is computed.
    foragePreference = true,
    forageQualityFloor = 0.55,
    // How close to a world edge (world units) a fleeing animal starts running
    // ALONG the wall rather than straight into it (option 3). A few steps, so
    // the correction only bites when pinning is imminent and open-field flight
    // is untouched. 0 restores the pre-fix "straight away from the threat"
    // behaviour, which is how the change is measured against its own control.
    fleeWallMargin = 6,
    // How far ahead (world units) a cornered animal judges "open room" when it
    // has to break past a predator (option 5). Roughly a sprint's worth of
    // horizon; larger sees more escape routes at more grid reads.
    fleeLookahead = 8,
    // ⚠⚠ **Obstacle deflection for directed actions** (2026-08-01) — the half of
    // the wall-awareness above that `flee` has had since Step 8 and every other
    // directed action never did. `false` restores the pre-fix behaviour exactly
    // (walk straight at the target, stop dead at the first obstacle) and is the
    // control this was measured against.
    detourEnabled = true,
    detourCommitTicks = 6,
    detourLookahead = 6,
    // The step probe must ask the movement system's own question, so it needs
    // the movement system's own numbers. Wired from `config.locomotion`,
    // `config.injury` and `config.disease` — their one home — rather than
    // restated here, the same D11 discipline as `drinkRange` and `carcassRange`.
    sprintMultiplier = undefined,
    injurySpeedPenalty = undefined,
    diseaseSpeedPenalty = undefined,
    maxOccupantsPerCell = null,
    updateInterval = 1,
  } = {}) {
    super({ id: 'decision', phase: 'decision', priority: 0, updateInterval });
    this.hungerWeight = hungerWeight;
    this.thirstWeight = thirstWeight;
    this.eatBias = eatBias;
    this.drinkBias = drinkBias;
    this.restBias = restBias;
    this.wanderBias = wanderBias;
    this.explorationRate = explorationRate;
    this.drinkRange = drinkRange;
    this.mateWeight = mateWeight;
    this.mateDistanceWeight = mateDistanceWeight;
    this.followWeight = followWeight;
    this.followDistance = followDistance;
    this.hideWeight = hideWeight;
    this.tendWeight = tendWeight;
    this.provisionRange = provisionRange;
    this.parentMinEnergyFraction = parentMinEnergyFraction;
    this.neonatalConcealment = neonatalConcealment;
    this.fleeWeight = fleeWeight;
    this.herdWeight = herdWeight;
    this.herdDistance = herdDistance;
    this.herdPackingSlack = herdPackingSlack;
    this.defendWeight = defendWeight;
    this.defendRange = defendRange;
    this.interposeSlack = interposeSlack;
    this.defendTargeted = defendTargeted;
    this.patrolWeight = patrolWeight;
    this.patrolSpanFactor = patrolSpanFactor;
    this.retreatWeight = retreatWeight;
    this.intrusionThreshold = intrusionThreshold;
    this.leaveThicketWeight = leaveThicketWeight;
    this.thicketRefugeRadius = thicketRefugeRadius;
    this.thicketExitRadius = thicketExitRadius;
    this.needOverridesTerritory = needOverridesTerritory;
    this.rangingThreshold = rangingThreshold;
    this.rangingCommitBonus = rangingCommitBonus;
    this.rangingJitterScale = rangingJitterScale;
    this.thicketReachNeed = thicketReachNeed;
    this.thicketReachDistance = thicketReachDistance;
    this.cacheHaulDistance = cacheHaulDistance;
    this.caching = caching;
    this.flight = flight;
    this.huntWeight = huntWeight;
    this.stalkDiscount = stalkDiscount;
    this.chaseRange = chaseRange;
    this.minHungerToHunt = minHungerToHunt;
    this.minHuntStamina = minHuntStamina;
    this.huntCooldownTicks = huntCooldownTicks;
    this.carcassRange = carcassRange;
    this.possession = Object.freeze({
      ...DEFAULT_POSSESSION,
      enabled: possessionEnabled,
      range: possessionRange,
      share: possessionShare,
      backingEnabled: possessionBackingEnabled,
      backingRange: possessionBackingRange,
    });
    this.cooperation = Object.freeze({
      ...DEFAULT_COOPERATION,
      enabled: cooperationEnabled,
      joinRange: cooperationJoinRange,
      joinStalks: cooperationJoinStalks,
      approachSpread: cooperationApproachSpread,
      approachRadius: cooperationApproachRadius,
    });
    this.mobbing = Object.freeze({
      ...DEFAULT_MOBBING,
      enabled: mobbingEnabled,
      minMobbers: mobbingMinMobbers,
      range: mobbingRange,
    });
    this.charge = Object.freeze({
      ...DEFAULT_CHARGE,
      enabled: chargeEnabled,
      staminaFraction: chargeStaminaFraction,
      maxPursuitTicks,
    });
    this.shelterWeight = shelterWeight;
    this.shelterStressThreshold = shelterStressThreshold;
    this.shelterStressSpan = shelterStressSpan;
    this.shelterRelief = shelterRelief;
    this.recallWeight = recallWeight;
    this.recallRange = recallRange;
    this.recallDistanceWeight = recallDistanceWeight;
    this.dangerRadius = dangerRadius;
    this.reproduction = reproduction;
    this.matingRange = matingRange;
    this.breedingEnabled = breedingEnabled;
    this.coverConcealment = coverConcealment;
    this.minCommitTicks = minCommitTicks;
    this.commitTickSpan = commitTickSpan;
    this.wanderJitter = wanderJitter;
    this.holdBiasScale = holdBiasScale;
    this.foodMinLevel = foodMinLevel;
    this.foragePreference = foragePreference;
    this.forageQualityFloor = forageQualityFloor;
    this.fleeWallMargin = fleeWallMargin;
    this.fleeLookahead = fleeLookahead;
    this.detourEnabled = detourEnabled;
    this.detourCommitTicks = detourCommitTicks;
    this.detourLookahead = detourLookahead;
    this.stepRules = normalizeStepRules({
      sprintMultiplier,
      injurySpeedPenalty,
      diseaseSpeedPenalty,
      maxOccupantsPerCell,
    });
  }

  update(world, context) {
    const random = context.random('decision');
    // Where in the year the world is, hoisted out of the animal loop because it
    // is one number for the whole tick (phase 12, §3.11). `null` when seasonal
    // breeding is off or the world has no environment, which skips the window
    // test rather than evaluating one — the same identity discipline as a null
    // prey-mass ratio.
    const yearProgress = this.breedingEnabled ? (world.environment?.yearProgress ?? null) : null;
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // Two draws, always (fixed budget → deterministic stream).
      const roll = random.next();
      const candidateHeading = random.next() * TWO_PI;

      // Resolved species (Step 29): one Map.get, reused for diet, mate
      // preference, the territory block below — and, from 2026-07-28, the
      // `behavior` block: what this animal *wants*, as opposed to the machinery
      // of choosing, which stays global on `this`. The lookup was already being
      // paid for, so per-species behaviour costs no extra Map.get; only the
      // property loads go polymorphic across species records.
      const species = world.species.get(entity.speciesId);
      const behavior = species?.behavior ?? this;
      const perceived = world.perception.get(entity.id) ?? null;
      const hunger = clamp01(1 - entity.energy / entity.maxEnergy);
      const thirst = clamp01(1 - entity.hydration / entity.maxHydration);
      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      // What counts as food depends on the species' diet (Step 16): grass under
      // your feet if you graze, a carcass within reach if you do not. Both then
      // flow through the same `eat` / `seekFood` actions — eating is eating.
      const carnivore = species?.diet === 'carnivore';
      // ⚠ A body somebody stronger is standing over is not food (2026-07-28,
      // PLAN-SPECIES.md §3.9). This *must* be the same predicate the feeding
      // system applies, or the animal walks to a carcass and is then refused it
      // — and, worse, keeps choosing `eat` while starving on the spot, because
      // nothing else would ever outscore a carcass at its feet. One predicate in
      // `predation/possession.js`, two readers, exactly as `carcassRange` and
      // `drinkRange` were each fixed to have one home (D11).
      //
      // Known limit, stated rather than discovered later: perception reports
      // only the *nearest* carcass, so an animal turned away from a held body
      // does not fall back to a further free one this tick. It wanders and finds
      // it later, which is the same shallow-perception bargain the rest of the
      // system makes; widening it would mean ranking carcasses inside the
      // hottest loop in the engine.
      const carcass = this.#availableCarcass(world, entity, perceived, carnivore);
      // ⚠ Per-species since 2026-07-28, and it must be the *same* threshold
      // perception used to pick `nearestFood` — otherwise an animal walks to a
      // cell its senses called food and then declines to eat it, or stands on
      // one it never perceived. One field, two readers, one source.
      // ⚠ `carcassRange` reads from the **`feeding`** block, its one home since
      // 2026-07-28. It used to be restated in `config.decision` with a comment
      // reading "(matches feeding)" — the same D11 shape `drinkRange` had. Drift
      // them and a carnivore decides it is on a carcass and then cannot reach it.
      const carcassRange = species?.feeding?.carcassRange ?? this.carcassRange;
      const onFood = carnivore
        ? carcass !== null && carcass.distance <= carcassRange
        : world.vegetation.levelAt(cellX, cellY) >= (species?.perception?.foodMinLevel ?? this.foodMinLevel);
      const nearestFood = carnivore ? carcass : (perceived?.nearestFood ?? null);
      // Forage guilds (2026-07-29, PLAN-SPECIES.md §3.3, phase 9). **Which
      // maturity of grass this animal wants**, as a discount on how much it wants
      // to eat — one for the cell underfoot and one for the cell it can see.
      //
      // ⚠ It scales the **hunger drive** and not the whole utility, which is what
      // makes it a preference rather than a refusal: `eatBias` still stands, the
      // drive it discounts already rises with hunger, and the floor is above zero,
      // so a comfortable animal walks off rank grass and a starving one eats it.
      // Measured shape at the shipped `qualityFloor: 0.55`: on the rankest grass in
      // the world, an animal a fifth down (hunger 0.2) scores `0.2 + 0.2 × 0.55 =
      // 0.31` against wander's ~0.35 and walks on, while one at hunger 0.4 scores
      // 0.42 and eats. So the preference decides where a comfortable animal grazes
      // and stops mattering as the animal gets hungry. That is the whole mechanism.
      //
      // ⚠ Deliberately **not** applied to `recallFood`: a memory records *where*
      // the animal fed, not what the grass was like, and the patch has been growing
      // or being grazed ever since. Discounting a remembered place by today's crop
      // would be reading the world through a memory, which is precisely the thing
      // memory is not (DOCS §9 Memory).
      //
      // Carnivores are exempt by construction — their food is a carcass, and
      // `forageOf` is null for a species that declares no preference, which is
      // every species but the gazelle.
      const forage = this.foragePreference && !carnivore ? forageOf(species) : null;
      const forageQualityHere =
        forage !== null && onFood ? forageQualityAt(world, cellX, cellY, forage, this.forageQualityFloor) : NEUTRAL_QUALITY;
      const forageQualityThere =
        forage !== null && nearestFood !== null
          ? forageQualityAt(world, nearestFood.cellX, nearestFood.cellY, forage, this.forageQualityFloor)
          : NEUTRAL_QUALITY;
      const nearestWater = perceived?.nearestWater ?? null;
      // ⚠ Read from the **`hydration`** block, which is where `drinkRange`
      // actually lives and what `HydrationSystem` reads. It used to be declared
      // in `config.decision` as well, with a comment saying "matches hydration" —
      // two copies of one number, guaranteed to drift the moment a species
      // wanted its own. Drifted, they produce an animal that decides it is at
      // water and is then refused the drink, or the reverse: it stands at the
      // lake and never chooses to drink. One field, one owner.
      const atWater = nearestWater !== null && nearestWater.distance <= (species?.hydration?.drinkRange ?? this.drinkRange);
      // Mate choice (Step 22). A ready animal heads for a perceived candidate of
      // the opposite sex — and *which* one is where preference becomes visible:
      // the choosing sex walks toward the best animal it can see rather than the
      // closest, and pays for that in the ground it covers. Whether the pair
      // actually mates is still the reproduction system's call.
      // ⚠ The season gates *going looking* as well as pairing, because both read
      // this one predicate (phase 12). Without it a female out of season would
      // walk to a male she is going to refuse — the same drift `foodMinLevel` and
      // `drinkRange` each had when two systems held their own copy of a rule.
      const mateCandidate = isReproductivelyReady(entity, context.tick, species?.reproduction ?? this.reproduction, yearProgress)
        ? bestMateCandidate(perceived?.mateCandidates ?? [], (id) => world.entities.get(id), {
            preference: matePreferenceFor(species),
            distanceWeight: this.mateDistanceWeight,
            assess: isChooser(entity),
          })
        : null;
      // A dependent juvenile is pulled toward its guardian, more strongly the
      // further it has drifted — half weight the moment it loses contact,
      // rising to full weight at the edge of perception, so keeping up always
      // outranks aimless wandering but never outranks real hunger or thirst.
      // Only a guardian it can currently perceive counts (Step 13).
      const guardian = perceived?.guardian ?? null;
      // Neonatal concealment (2026-07-29, PLAN-SPECIES.md §3.14). A calf young
      // enough to hide does not follow, does not wander, and does not seek: it
      // lies still and waits to be nursed. ⚠ **A suppression, not a new
      // mechanism** — `hiding` switches three existing behaviours off, and the
      // only positive term is staying put. Inert for every species that leaves
      // `aging.hiddenUntil` at 0, which is all of them but the gazelle.
      const hiding = this.neonatalConcealment && isHiding(entity, species);
      const followPull =
        !hiding && guardian && guardian.distance > this.followDistance
          ? this.#followUtility(guardian, perceived, behavior)
          : 0;
      // An unweaned juvenile lives on its guardian's provisioning and does not
      // graze at all — that is what makes the dependency real rather than
      // decorative. Its whole agenda is drinking, resting, and keeping up.
      const nursing = entity.guardianId !== null && !entity.weaned;
      // ⚠ The mother's half, and the whole reason this phase is separate: an
      // unweaned calf eats **only** what its guardian provisions, so a calf that
      // no longer follows starves unless she comes back to it. This is DOCS A34's
      // named lever — "give patrol a reason" — cashed in: the reason is a hungry
      // dependent, and the pull is scaled by *its* hunger rather than being a
      // constant, so a full calf exerts none and a starving one outranks her own
      // foraging. She will not walk to a calf she cannot feed (her own energy
      // floor is the same one `ParentingSystem` provisions above), because that
      // would be a trip that helps neither of them.
      // ⚠ Named `hiddenCalf`, not `ward`: `ward` in this scope is already the
      // juvenile an adult is *interposing over* (`#wardToDefend`, below), and two
      // different dependents under one name in one 300-line scope is how D9-style
      // bugs are written.
      const hiddenCalf = this.#hiddenWard(world, entity, species);
      const tendPull = hiddenCalf ? behavior.tendWeight * hiddenCalf.need : 0;

      // Memory (Step 15): when nothing edible or drinkable is in sight, an
      // animal falls back on where it has been. Recall is strictly weaker than
      // sight — a remembered patch may already be grazed out — so it only
      // competes once perception has come up empty.
      const recalledFood =
        !nursing && !onFood && !nearestFood ? this.#recall(entity, MemoryKinds.FOOD, behavior) : null;
      const recalledWater = !atWater && !nearestWater ? this.#recall(entity, MemoryKinds.WATER, behavior) : null;
      // Somewhere it remembers as dangerous is no place to settle down.
      const nearDanger = behavior.dangerRadius > 0 && isNearDanger(entity, entity.x, entity.y, behavior.dangerRadius);

      // Weather (Step 19). An animal paying to hold its body temperature has a
      // reason to walk to cover — and none at all once it is already there, so
      // the pull is gated on actually being out in it.
      const stress = thermalStress(world, entity, this.shelterRelief);
      // ⚠ `nearestShelter`, not `nearestCover` (2026-08-01). It used to be the
      // nearest COVER *terrain* cell while the stress it answers takes its relief
      // from `world.isShelteredAt` — cover **or thicket or a burrow** — so an
      // animal freezing beside a thicket was told there was nowhere to go. One
      // rule, one definition, and perception is the other reader (§9 Perception).
      const cover = perceived?.nearestShelter ?? null;
      const wantsShelter = stress >= this.shelterStressThreshold && cover !== null && !world.isShelteredAt(entity.x, entity.y);

      // Predation (Step 16). Fleeing overrides everything — a grazing animal
      // that notices a predator stops grazing — and gets more urgent the
      // closer the threat is. Hunting is gated on the predator actually being
      // hungry, and on having the stamina to make the attempt worthwhile.
      // A predator anywhere in sight is alarming; how close it is decides how
      // alarming. Half weight at the edge of perception rising to full weight
      // at contact — the same shape as following a parent, and for the same
      // reason: a threat that scored zero at the boundary would let a hungry
      // animal keep grazing while a predator walked up to it.
      const threat = perceived?.nearestThreat ?? null;
      const fleeUrgency = threat
        ? behavior.fleeWeight * (0.5 + 0.5 * (1 - clamp01(threat.distance / (perceived.radius || 1))))
        : 0;
      // Sociality (Step 23). An animal that cannot see the predator itself but
      // has been alarmed by a neighbour runs anyway, away from where it was
      // told the threat is. This is what turns one animal's sighting into a
      // herd's stampede — and why the alarm carries a position and not just a
      // flag, since panic with no direction is just milling about.
      const alarmed = entity.alarmedUntil !== null && context.tick < entity.alarmedUntil && entity.alarmSource !== null;
      const alarmFlee = !threat && alarmed ? behavior.fleeWeight * 0.75 : 0;
      // Herding: close up when the animal has drifted off the local centre of
      // its group. Scaled by (2 − boldness) exactly as `rest` is, so the same
      // trait that makes an animal roam also makes it a looser herd member —
      // no new trait needed for temperament to show up in social behaviour.
      // ⚠ **The centre may be a mixed-species one** (phase 12, PLAN-SPECIES.md
      // §3.16), and this line is deliberately unchanged by that. The whole of an
      // association weight is spent *inside* the centroid — an associate counts
      // as a fraction of a body — so scaling the pull by it as well would charge
      // the animal twice for one fact. Measured, and it is not a nicety: at
      // `herdWeight` 0.6 a second discount of 0.5 caps the pull at 0.30 against a
      // `wanderBias` of 0.35, so it could never win and the mechanism was born
      // inert across most of its own range (see social/association.js).
      const social = world.social.get(entity.id) ?? null;
      const drift = social?.centroid
        ? Math.hypot(social.centroid.x - entity.x, social.centroid.y - entity.y)
        : 0;
      // ⚠⚠ **What a declared association pull buys, and the only place it is
      // spent** (BEHAVIOR-PLAN P3, closing A61). The weight above decides *where*
      // mixed company puts the centre; this decides how close to it this animal
      // insists on standing. A gazelle holding to wildebeest at 0.55 tolerates 3.6
      // units of drift from a herd of them and 2.0 from its own — "half attached to
      // them, fully attached to my own", which was not expressible until there were
      // two numbers.
      //
      // ⚠ **The distance, not the weight**, and A61 is why: scaling `herdWeight`
      // puts the pull either side of `wanderBias` depending on the animal's
      // heritable boldness, so a smooth-looking parameter becomes a threshold
      // keyed on a trait — inert for bold animals across most of its range. The
      // distance has no comparison to lose. It is also monotone, and it is directly
      // measurable as the distance a follower settles at.
      //
      // ⚠ `pullScale` is exactly 1 for every species that declares no pull and for
      // every animal standing alone, and `x / 1` is `x` for every finite double, so
      // this line is bit-for-bit what it was for all but the declaring species.
      // ⚠⚠ **And then it is floored by what the herd can physically do**
      // (2026-08-06). The declared distance is biology — how close this animal
      // *wants* to stand — and the floor is geometry: a herd of this many bodies
      // cannot stand closer than the occupancy cap allows, so asking it to is a
      // request the movement system refuses every tick for the rest of the
      // animal's life. `max` rather than a replacement, because a species that
      // declares a **wider** distance than the floor means it, and a small herd
      // (where the floor is under 2.0) keeps exactly the arithmetic it had.
      //
      // ⚠ The pull scale divides the *declared* number only. A gazelle holding
      // loosely to a wildebeest herd tolerates more drift than it would from its
      // own kind — that is a preference — but it is standing in the same crowd as
      // everyone else, and the crowd's geometry is not a matter of preference.
      // Flooring the scaled number instead would silently let the association
      // weight buy its way under a bound it has nothing to do with (A61's shape:
      // one declaration, spent in exactly one place).
      const herdDistance = Math.max(
        behavior.herdDistance / (social?.pullScale ?? CONSPECIFIC_PULL),
        herdPackingFloor(social?.centroidWeight ?? 0, this.stepRules.maxOccupantsPerCell, this.herdPackingSlack),
      );
      const herdPull =
        social?.centroid && drift > herdDistance
          ? behavior.herdWeight * (2 - entity.traits.boldness) * clamp01((drift - herdDistance) / Math.max(herdDistance, 1e-6))
          : 0;

      // Defense (§1.4 A11). An adult stands its ground when the predator is
      // going for its own young or a groupmate's, rather than saving itself.
      // It never outranks its own direct danger by much, and juveniles never do
      // it — a half-grown animal facing a stalker is not brave, it is prey.
      //
      // ⚠ **Mobbing is the second half of this action, not a new one** (A33,
      // phase 10). DOCS §7 has described `defend` as "kin *or a groupmate*" since
      // Step 23 and only the kin half was ever built; `mobWardFor` is the other
      // half, and it reuses the intent, the field, and the slot in the utility
      // table. Two weights because they are two different risks — a parent's own
      // calf is worth more to it than a herdmate is — and kin wins when both
      // apply, so a mother never abandons her calf for the herd. `mobWeight` is 0
      // for every shipped species, which makes the second call free (it leaves on
      // its first comparison) and this line exactly what it was.
      const kinWard = this.#wardToDefend(world, entity, perceived, behavior);
      const mobWard = kinWard ? null : mobWardFor(world, entity, threat, behavior, this.mobbing, social);
      const ward = kinWard ?? mobWard;
      // ⚠⚠ **The pursuit (BEHAVIOR-PLAN P9), and it belongs in the *utility***. A
      // ttl on the `defend` intent would do nothing at all: `#intentFor` is called
      // fresh from the winning action every tick, so the moment `defendUrgency`
      // reaches 0 another action wins and overwrites the intent. What outlives the
      // ward is a commitment the **scoring** reads — which is what makes a herd
      // drive a predator off rather than stopping the tick it breaks contact.
      //
      // ⚠⚠ **`threat === null` is the guard that makes "flee still wins" structural
      // rather than a comparison between two weights.** `defendWeight` and
      // `mobWeight` both outrank `fleeWeight`, so a commitment that merely held
      // `defend` open would hold it open against a *second* predator too. A pursuit
      // is by definition about something you can no longer see: the instant a threat
      // is perceived again the commitment is out of the running and the ordinary
      // machinery decides on the current geometry. See `predation/charge.js`.
      const chargeWeight = this.charge.enabled ? chargeWeightOf(species) : 0;
      const pursuing =
        ward === null &&
        threat === null &&
        chargeWeight > 0 &&
        entity.defendUntil !== null &&
        context.tick < entity.defendUntil &&
        entity.defendThreatX !== null;
      const defendUrgency = kinWard
        ? behavior.defendWeight
        : mobWard
          ? behavior.mobWeight
          : pursuing
            ? chargeWeight
            : 0;

      // Territory (Step 24). Two pulls, both read from state the territory
      // system already wrote — one O(1) grid lookup and four numbers on the
      // entity, no search of any kind.
      //
      // `patrol` is **site fidelity**, and it is what makes a home range a
      // range rather than a statistic: an animal that has wandered outside its
      // own settled area heads back toward it, which reinforces the very
      // summary that produced the pull. That feedback loop is the mechanism by
      // which a range settles at all.
      //
      // `retreat` is avoidance: standing on ground somebody else has marked is
      // uncomfortable, so get off it. A territorial animal weighs this more —
      // it has ground of its own to be on — but even a non-defender gives a
      // strong claim a wide berth.
      const territory = territoryOf(species);
      const homeRange = entity.homeRange;
      const rangeDrift =
        territory && homeRange ? Math.hypot(entity.x - homeRange.x, entity.y - homeRange.y) : 0;
      const rangeLimit = territory ? territory.rangeRadius : 0;
      // Acute hunger or thirst suspends both territorial pulls: an animal that
      // needs food or water more than it needs to be on its own ground follows
      // the long-range cue somewhere new rather than being dragged home to the
      // quarter of the map it is starving or drying out in (this is what let a
      // thirsty stalker circle its range until it died on a corner-lake seed).
      const acuteNeed = Math.max(hunger, thirst) >= this.needOverridesTerritory;
      // The ramp spans *half* the range radius, not all of it. Spanning the
      // full radius meant patrol only reached full strength at twice the range
      // — so an animal one range-width from home still preferred to wander,
      // and site fidelity did nothing until it was already lost.
      const patrolSpan = Math.max(rangeLimit * this.patrolSpanFactor, 1e-6);
      // Only a species that *defends* ground goes back to it. Measured: giving
      // the pull to grazers as well collapsed the demo from 5/5 seeds with both
      // species alive to 2/5, and the reason is worth stating because it is not
      // obvious — patrolling competes with **wandering**, and wandering is how
      // a grazer finds the next patch once it has eaten this one. A herd animal
      // pulled back to a 14-unit range starves inside it, and the predators go
      // with the prey. Site fidelity is a real thing for an animal that holds
      // ground; for one that follows food it is a liability, so the home range
      // stays descriptive (measured, inspectable) and pulls on nothing.
      const patrolPull =
        territory?.defends && homeRange && rangeDrift > rangeLimit && !acuteNeed
          ? behavior.patrolWeight * clamp01((rangeDrift - rangeLimit) / patrolSpan)
          : 0;
      const claimOwner = territory ? world.scent.ownerAt(entity.x, entity.y) : 0;
      // ⚠⚠ **A pride-mate's ground is not somebody else's** (A60, PREDATOR-PLAN P6).
      // This read `claimOwner !== entity.id`, which is what made a social species
      // unable to hold ground at all: `retreat` moved a lion off any marked cell,
      // pride-mate included, so a pride with `defends: true` scattered itself and
      // cooperative hunting measured **zero shared-quarry ticks in 8 000**. The
      // predicate is shared with `TerritorySystem` rather than spelled out twice —
      // the decision system asking "should I leave" and the territory system asking
      // "should I fight" must not be able to disagree (D11).
      const intruding =
        !holdsClaim(world, entity, claimOwner) &&
        world.scent.strengthAt(entity.x, entity.y) >= this.intrusionThreshold;
      // Retreating needs somewhere to retreat *to*. An animal too young to have
      // settled a range has nowhere, so it simply tolerates the ground it is
      // on — which is also the honest behaviour, and which is why this guard is
      // a condition rather than a null check further down. (Without it a
      // newborn standing on a claim steered at a null target and crashed the
      // tick; rare enough that only a 16 000-tick run found it.)
      const retreatPull = intruding && homeRange && !acuteNeed ? behavior.retreatWeight * (territory.defends ? 1 : 0.5) : 0;
      // Cooperative hunting (phase 10, PLAN-SPECIES.md §3.7). A predator with
      // nothing of its own in sight joins a hunt a conspecific has already
      // committed to — which is what makes several hunters converge on **one**
      // animal instead of each picking its own, and is the half of "lions hunt
      // together" that is about *which* quarry rather than about the odds.
      //
      // ⚠ Gated on the species' own `cooperationWeight`, which is 0 for all four
      // shipped species: this is one property read and then nothing. And gated on
      // having no prey of its own, so joining can only ever *add* a hunter to a
      // hunt, never take one off a hunt it could have won alone.
      const prey = perceived?.nearestPrey ?? this.#joinedHunt(world, entity, context, carnivore ? species : null);
      const recovering = entity.lastHuntTick !== null && context.tick - entity.lastHuntTick < this.huntCooldownTicks;
      const willHunt =
        prey !== null && !recovering && hunger >= behavior.minHungerToHunt && entity.stamina > behavior.minHuntStamina;
      // Two stages, both visible in `action`: close quietly, then commit. The
      // moment the prey bolts, stalking is pointless — a walking predator can
      // never catch a sprinting grazer — so a fleeing target forces the sprint
      // regardless of range.
      const chasing = willHunt && (prey.distance <= behavior.chaseRange || prey.fleeing === true);

      // Individual variation (Step 14): a cautious animal acts on hunger and
      // thirst sooner (it keeps a bigger reserve), while a bold one prefers
      // covering ground to sitting still — both real trade-offs, since roaming
      // finds food and water but costs energy.
      const { boldness, caution, exploration } = entity.traits;
      const hungerDrive = behavior.hungerWeight * hunger * caution;
      const thirstDrive = behavior.thirstWeight * thirst * caution;

      // Getting out of a thicket (A18). An animal standing in one heads for the
      // nearest open cell rather than crawling around at thicket speed — unless a
      // predator is within a few spaces, in which case the thicket is refuge and
      // it stays (flee/hunt logic takes over anyway). The exit scan runs only for
      // the few animals actually in thicket, so it is free on open ground.
      // ⚠⚠ **Caching a kill** (phase T3) — the one action this plan adds, and the
      // bar it had to clear is DOCS §9 Decision's most expensive rule: a new
      // movement behaviour competes with foraging, and foraging must win.
      //
      // What it competes with is **`eat`, for one animal, for a few ticks, on the
      // carcass it is already standing on** — it delays its own meal to secure
      // it, which is a trade-off the animal is making with itself rather than a
      // new claim on a foraging animal's attention. Every other animal in the
      // world scores it 0 on the first comparison (`cacheWeight` is 0 for every
      // species but the leopard, and the whole expression short-circuits there).
      //
      // ⚠ **The hunger term is what keeps it from being a way to starve.** It is
      // `1 - hunger`, so a comfortable cat secures the kill and a desperate one
      // eats it: at the shipped weight a leopard at hunger 0.3 scores 0.84
      // against `eat`'s 0.5, and at hunger 0.8 scores 0.24 against `eat`'s 1.0.
      // The animal changes its mind on its own, with no threshold to tune.
      const cacheWeight = this.caching && carnivore ? (behavior.cacheWeight ?? 0) : 0;
      const cacheTarget =
        cacheWeight > 0 && onFood && carcass !== null && canClimb(species) && !isAloft(world.entities.get(carcass.id))
          ? nearestTreeCell(world, entity.x, entity.y, this.cacheHaulDistance)
          : null;

      const inThicket = world.isThicketAt(entity.x, entity.y);
      const predatorNear = threat !== null && threat.distance <= this.thicketRefugeRadius;
      const thicketExit =
        inThicket && !predatorNear ? nearestOpenCell(world, entity.x, entity.y, this.thicketExitRadius) : null;

      const utilities = {
        defend: defendUrgency,
        flee: Math.max(fleeUrgency, alarmFlee),
        herd: herdPull,
        retreat: retreatPull,
        patrol: patrolPull,
        chase: chasing ? behavior.huntWeight * hunger : 0,
        stalk: willHunt && !chasing ? behavior.huntWeight * hunger * behavior.stalkDiscount : 0,
        drink: atWater ? this.drinkBias + thirstDrive : 0,
        seekWater: nearestWater && !atWater ? thirstDrive : 0,
        cache: cacheTarget ? cacheWeight * (1 - hunger) : 0,
        eat: onFood && !nursing ? this.eatBias + hungerDrive * forageQualityHere : 0,
        seekFood: nearestFood && !onFood && !nursing ? hungerDrive * forageQualityThere : 0,
        recallWater: recalledWater ? thirstDrive * behavior.recallWeight : 0,
        recallFood: recalledFood ? hungerDrive * behavior.recallWeight : 0,
        shelter: wantsShelter ? behavior.shelterWeight * clamp01(stress / this.shelterStressSpan) : 0,
        followParent: followPull,
        // Lying still, and going back to one that is. Both are gated on
        // `aging.hiddenUntil`, so both are exactly 0 for every species that does
        // not declare a hidden stage.
        hide: hiding ? behavior.hideWeight : 0,
        tend: tendPull,
        // ⚠⚠ **Nothing to seek once you have arrived** (2026-08-06). `seekMate`
        // used to score its full weight whenever a candidate was perceived, at any
        // distance including zero — so an animal standing **on** a mate it will
        // never be accepted by kept "seeking" it forever. The ethologist's shape
        // for this is unmistakable and it appeared in every world:
        // `seekMate for 120 ticks with no progress (dist 0.6→0.0), 193 refused
        // steps` — an animal that arrived, could get no closer, and never
        // re-targeted.
        //
        // ⚠ **The seeker cannot observe why it was refused, and that is the point.**
        // Pairing is `ReproductionSystem`'s decision and it can decline for reasons
        // that are invisible from here — the partner is not `#eligible`, is inside
        // `contestCooldownTicks`, or simply lost the quality comparison. So the
        // honest gate is not "did it work" (unknowable) but "is walking closer still
        // capable of helping" (pure geometry). Inside `matingRange` it is not: the
        // reproduction system already sees this pair every tick.
        //
        // ⚠ Suppressing the *action* leaves the animal in place rather than driving
        // it away — it falls through to whatever it would otherwise do, mostly
        // grazing and wandering within a cell or two, and `ReproductionSystem` pairs
        // them the moment its own gates open. It also frees the ~120 ticks that a
        // stalled seeker spent walking into an occupied cell, which is where those
        // refused steps were coming from.
        seekMate: mateCandidate && mateCandidate.distance > this.matingRange ? behavior.mateWeight : 0,
        leaveThicket: thicketExit ? this.leaveThicketWeight : 0,
        rest: nearDanger ? 0 : behavior.restBias * (1 - Math.max(hunger, thirst)) * (2 - boldness),
        wander: behavior.wanderBias * boldness,
      };

      // Exploration overrides utilities occasionally; otherwise pick the best,
      // ties broken by a fixed action order (survival needs first).
      const action = roll < behavior.explorationRate * exploration ? 'wander' : argmaxUtility(utilities);

      entity.action = action;
      entity.utilityBreakdown = utilities;
      // ⚠⚠ **Flight is a pace on the intent, and this is the only line in the
      // engine that writes it** (phase F1). It is decided *from* the action, so
      // it belongs immediately after the action is settled and before
      // `#intentFor` — which probes `stepLength` for its detour ladder and would
      // otherwise measure a walking step for an animal about to fly.
      //
      // Written unconditionally for every animal, including `false`: the flag
      // outlives its tick only if some path skips it, and a stale `flying: true`
      // would be a bird still enjoying the wing after `config.flight.enabled`
      // was turned off. `flyingFor` short-circuits on the switch and then on the
      // species, so a roster that declares no flier pays one comparison here.
      //
      // ⚠ Not an entry in the utility table above, and not eligible to become
      // one. DOCS §9 Decision: a new movement behaviour competes with foraging
      // and foraging must win. This competes with nothing — the animal has
      // already chosen what to do.
      entity.flying = flyingFor(world, entity, species, this.flight);
      // The prey this predator has committed to — the hunting system reads it
      // to resolve capture attempts, and only ever reads it.
      entity.huntTargetId = action === 'chase' || action === 'stalk' ? prey.id : null;
      // The body this animal is dragging, owned here exactly as `huntTargetId`
      // is and read by the movement system exactly as `huntTargetId` is read by
      // the hunting system. ⚠ An **id on the entity** rather than a lookup in
      // `MovementSystem`, so that system never learns what possession or a
      // carcass is — it drags whatever it is told it is dragging.
      entity.cacheTargetId = action === 'cache' ? carcass.id : null;
      // seekMate, followParent, tend, chase/stalk, and defend steer toward
      // another animal's position rather than a cell; herding steers at the
      // group's centre of mass, which is a position but nobody's in particular.
      // ⚠ `hide` is deliberately absent: it is stationary, so it has no target
      // at all (see `#intentFor`).
      let followed = null;
      if (action === 'seekMate') followed = mateCandidate.candidate;
      else if (action === 'tend') followed = hiddenCalf;
      else if (action === 'followParent') followed = guardian;
      else if (action === 'chase') followed = prey;
      // ⚠⚠ **A stalker aims at a flank point when others are on the same quarry**
      // (PREDATOR-PLAN P4) — the nearest legal thing to flanking, and it is
      // deliberately on the *target* rather than on the heading: bending the
      // heading makes a stalker circle instead of converge. See
      // `predation/approachPoint` for the geometry and for why encirclement is not
      // expressible here at all.
      //
      // ⚠ Never for a `chase`. A committed sprint goes at the animal, not past it;
      // fanning out at the moment of the strike would be a way of missing.
      //
      // ⚠ Gated on the species' own `cooperationWeight` before anything is walked —
      // the same gate `#joinedHunt` uses — so this is one property read for the six
      // species that do not cooperate, and `approachPoint` is exactly the identity
      // for a lone stalker even when they do.
      else if (action === 'stalk') {
        followed =
          carnivore && (species.hunting?.cooperationWeight ?? 0) > 0
            ? approachPoint(world, entity, prey, this.cooperation)
            : prey;
      }
      // ⚠ The threat while it can be seen, and **the place it was last seen** while
      // a pursuit is running (P9) — which is the whole reason the position is
      // remembered rather than only the ttl: by the time the commitment matters the
      // threat object is gone, and `#intentFor` needs somewhere to point.
      else if (action === 'defend') followed = threat ?? { x: entity.defendThreatX, y: entity.defendThreatY };
      // ⚠ `herdDistance` rides along with the drift for the same reason the drift
      // does: `#intentFor`'s cohesion term is the *second* reader of that number,
      // and an animal that decided to close up at one distance and then steered by
      // another would be wrong in a way no test would catch (D11). Carrying the
      // one value that was actually used is how the two stay consistent rather than
      // how they are kept in step.
      else if (action === 'herd') followed = { ...social.centroid, heading: social.heading, drift, herdDistance };
      // Both `patrol` and `retreat` head for the animal's own ground: patrolling
      // because it has drifted off it, retreating because it is standing on
      // somebody else's. An animal with no range yet simply has nowhere to
      // retreat to, and the utilities above never fire for it.
      else if (action === 'patrol' || action === 'retreat') followed = homeRange;
      const target = followed
        ? // Spread rather than rebuild: `herd` carries the group's mean heading
          // and this animal's drift alongside the position, and a literal that
          // listed only the coordinates silently dropped them — which turned
          // the cohesion weight into NaN, the heading into NaN, and left
          // herding animals standing perfectly still.
          { ...followed, cellX: Math.floor(followed.x), cellY: Math.floor(followed.y), x: followed.x, y: followed.y }
        : action === 'seekFood'
          ? nearestFood
          : action === 'seekWater'
            ? nearestWater
            : action === 'recallFood'
              ? recalledFood.memory
              : action === 'recallWater'
                ? recalledWater.memory
                : action === 'shelter'
                  ? cover
                  : action === 'leaveThicket'
                    ? thicketExit
                    : action === 'cache'
                      ? cacheTarget
                      : null;
      entity.actionTarget = target
        ? { cellX: target.cellX ?? Math.floor(target.x), cellY: target.cellY ?? Math.floor(target.y) }
        : null;
      // What to run away from: the predator if it can see one, otherwise the
      // place a neighbour's alarm said one was.
      const fleeFrom = threat ?? (alarmed ? entity.alarmSource : null);
      // The animal this one is standing over, so the hunting system can read the
      // defense and an observer can see it. Owned here, like `huntTargetId`.
      //
      // ⚠ **Written before `#intentFor` since P9, and the ordering is load-bearing.**
      // That method decides whether a defender charges or walks, and the one case it
      // must refuse is an animal standing over *itself* — the hunted animal facing
      // its attacker (phase 11). This field is how it asks, so it has to hold this
      // tick's answer by the time the question is put. ⚠ Null during a pursuit: the
      // animal is following a predator, not standing over anybody, and `mobbersFor`
      // counts exactly the animals standing over a prey right now.
      entity.defendingId = action === 'defend' ? (ward?.id ?? null) : null;
      entity.moveIntent = this.#intentFor(world, action, entity, target, roll, candidateHeading, fleeFrom, behavior);
      // ⚠⚠ **The commitment, written from the action rather than from the score**
      // (P9). Three states and every animal of a declaring species passes through
      // exactly one of them each tick, so a stale commitment cannot outlive its tick
      // — the `entity.flying` lesson, applied to state that is *supposed* to outlive
      // its cue and therefore needs its clearing path stated all the harder.
      //
      // ⚠ A species that declares no `chargeWeight` is never written at all and
      // keeps `createEntity`'s nulls for life, which is what makes the off arm
      // byte-identical rather than merely equivalent.
      if (chargeWeight > 0) {
        if (action === 'defend' && threat !== null) {
          // Defending something it can see: the clock restarts from *this* sighting
          // and the remembered position is refreshed, so a pursuit always begins
          // from where the threat actually was last.
          entity.defendUntil = context.tick + pursuitTicksOf(species, this.charge.maxPursuitTicks);
          entity.defendThreatX = threat.x;
          entity.defendThreatY = threat.y;
        } else if (action !== 'defend') {
          // It chose something else — grazing, running, going back to the herd. The
          // commitment is dropped rather than left to expire, because an animal that
          // gave up the chase is not still on it.
          entity.defendUntil = null;
          entity.defendThreatX = null;
          entity.defendThreatY = null;
        }
        // The third state is the pursuit itself (`defend` with nothing in sight),
        // which leaves the commitment exactly as it is so that it expires on the
        // schedule the last sighting set.
      }
    }
  }

  /**
   * The dependent young this adult should stand over, or null (§1.4 A11).
   *
   * Kin recognition (§1.4 A15) with a real reader at last, and it reads the
   * *authoritative* lineage lists rather than any remembered or scented signal:
   * `offspring` is sparse (a handful per lifetime) and every id is an O(1)
   * lookup, so this is cheaper than a grid query and cannot be wrong. An adult
   * defends when its own juvenile is nearer the predator than it is — that is
   * what "interpose" means, and it is also what keeps an adult from abandoning
   * its own escape for a cub that is already behind it.
   *
   * ⚠⚠ **That ordering test is A32's named lever, and phase 10 measured it not to
   * be the constraint.** `interposeSlack` widens it — the calf may be that much
   * *further* from the predator than the parent and still be defended — and it
   * ships at **0**, the strict test, because removing the clause entirely moved
   * nothing: `entity.defended` measured 0/1/1 over 2000 ticks on seeds 1/2/42
   * against the strict test's 1/1/0, while still perturbing the demo. The real
   * scarcity is upstream of this method: predators commit to a **juvenile** in
   * only 6–9% of hunter-ticks, and in 1–4 of those per 2000 ticks is a living
   * parent within perception of the hunt (DOCS §1.2 A32). The knob stays because a
   * slow, heavy species has a real reason to want one, and this is the measured
   * way to ask for it.
   *
   * Only adults do this. A half-grown animal facing a stalker is not brave.
   *
   * @param {import('../world/World.js').World} world
   * @param {object} entity
   * @param {object|null} perceived
   */
  #wardToDefend(world, entity, perceived, behavior) {
    const threat = perceived?.nearestThreat ?? null;
    if (!threat) return null;
    if (entity.lifeStage !== 'adult' && entity.lifeStage !== 'senescent') return null;
    if (!Array.isArray(entity.offspring) || entity.offspring.length === 0) return null;

    // ⚠ **Which animal the predator has actually committed to** (phase 10). The
    // whole of A32 turned out to hinge on this: a parent could defend a calf
    // nothing was hunting while the predator closed on something else, and the
    // defense then had no attempt to affect. One O(1) lookup, and only for an
    // adult that has a threat in view and young of its own.
    const hunted = this.defendTargeted ? (world.entities.get(threat.id)?.huntTargetId ?? null) : null;
    const ownDistance = Math.hypot(entity.x - threat.x, entity.y - threat.y);
    let best = null;
    let bestDistance = Infinity;
    for (const childId of entity.offspring) {
      const child = world.entities.get(childId);
      if (!child || !child.alive || child.kind !== 'animal') continue;
      if (child.lifeStage !== 'juvenile') continue;
      const exposure = Math.hypot(child.x - threat.x, child.y - threat.y);
      if (exposure > behavior.defendRange) continue;
      // A calf the predator is *going for* is defended whatever the geometry
      // says; any other calf still has to be about as exposed as the parent.
      if (childId !== hunted && exposure >= ownDistance + this.interposeSlack) continue;
      if (childId === hunted) return child;
      if (exposure < bestDistance) {
        bestDistance = exposure;
        best = child;
      }
    }
    return best;
  }

  /**
   * The quarry a conspecific is already chasing, for a predator that has none of
   * its own — or null (phase 10, PLAN-SPECIES.md §3.7).
   *
   * ⚠ **Three disqualifying questions before any work happens**, in cheapening
   * order, which is what keeps this free for the whole shipped roster: is this a
   * carnivore, does its species cooperate at all, and did perception publish a
   * neighbourhood *this* tick. Only then is the neighbour walk read — and it is
   * the walk perception already made (§1.4 C6), never a new grid query, exactly
   * as the sociality system reuses it.
   *
   * The staleness check is a skip rather than a fallback: joining a hunt is
   * discretionary, so an engine that staggers perception simply does not join on
   * the ticks it has no fresh neighbourhood, which is a far better answer than a
   * second grid walk for an optional behaviour.
   *
   * @param {import('../world/World.js').World} world @param {object} entity
   * @param {object} context @param {object|null} species resolved, or null for a herbivore
   */
  #joinedHunt(world, entity, context, species) {
    if (species === null || !this.cooperation.enabled) return null;
    if (!((species.hunting?.cooperationWeight ?? 0) > 0)) return null;
    if (world.neighbourhoodTick !== context.tick) return null;
    // ⚠ The shared walk can reach further than this animal senses (BEHAVIOR-PLAN
    // P0), so the perception radius goes with it: joining a pride-mate's hunt
    // needs a pride-mate you can actually see.
    return adoptedPrey(
      world,
      entity,
      world.neighbourhood.get(entity.id),
      this.cooperation,
      world.perception.get(entity.id)?.radius ?? Infinity,
    );
  }

  /**
   * The perceived carcass this animal could actually eat, or null.
   *
   * Costs a herbivore nothing (it never gets here) and a carnivore one O(1)
   * entity lookup on the ticks it can see a body at all — the perception record
   * carries the id but not the possessor, deliberately, since resolving one
   * inside the neighbour walk would put a lookup in the hottest loop in the
   * engine for a fact only carnivores read.
   *
   * @param {import('../world/World.js').World} world
   * @param {object} entity @param {object|null} perceived @param {boolean} carnivore
   */
  #availableCarcass(world, entity, perceived, carnivore) {
    const seen = carnivore ? (perceived?.nearestCarcass ?? null) : null;
    if (seen === null) return seen;
    const carcass = world.entities.get(seen.id);
    if (!carcass) return null;
    // ⚠ **Reachability is asked before, and independently of, the possession
    // switch** (phase T2). A body cached in a tree is out of a non-climber's
    // reach whether or not anything is contending for it — and if this were
    // inside the `possessionEnabled` guard below, a world with possession off
    // would walk a hyena to a cache the feeding system then refuses, leaving it
    // choosing `eat` and starving on the spot. That is the exact D11 failure the
    // possession predicates were split out to prevent, one switch removed.
    if (!reachesCarcass(world, carcass, entity)) return null;
    if (!this.possession.enabled) return seen;
    return isAvailableTo(world, carcass, entity, this.possession) ? seen : null;
  }

  /**
   * The remembered place of a kind most worth walking to right now, or null.
   * @param {object} entity @param {string} kind
   */
  #recall(entity, kind, behavior) {
    return bestRemembered(entity, kind, {
      x: entity.x,
      y: entity.y,
      maxDistance: this.recallRange,
      distanceWeight: this.recallDistanceWeight,
      dangerRadius: behavior.dangerRadius,
    });
  }

  /**
   * Utility of closing the gap to a perceived guardian: half the follow weight
   * as soon as the juvenile is out of contact range, ramping to full weight at
   * the edge of what it can perceive (beyond which the parent is simply lost).
   * @param {{distance: number}} guardian
   * @param {{radius: number}} perceived
   */
  #followUtility(guardian, perceived, behavior) {
    const span = Math.max(perceived.radius - this.followDistance, 1e-6);
    const drift = clamp01((guardian.distance - this.followDistance) / span);
    return behavior.followWeight * (0.5 + 0.5 * drift);
  }

  /**
   * The hidden dependent this animal should go back to, or null.
   *
   * ⚠ **This is knowledge beyond perception, and it is a stated stand-in rather
   * than an oversight** — the same shape as A42 (the forage cue reaching 18 units
   * against a perception radius of 6) and declared here for the same reason. A
   * mother knows where she left her fawn, and since a hiding fawn does not move,
   * the place she left it *is* where it is. Reading its live position is
   * therefore the cheapest honest expression of a remembered place: no new field,
   * no new memory kind, nothing to serialize, and nothing that can go stale.
   * The one case where the two diverge is a fawn that has been found and bolted,
   * and a mother tracking a bolting calf is not the objectionable part.
   *
   * ⚠ It is **not** a scan. `offspring` is a bounded sparse list already on the
   * entity, and each lookup is O(1) by id — the same access `ParentingSystem`
   * and kin recognition already make, so no new traversal enters the hot path.
   * The whole method returns immediately for the overwhelming majority of
   * animals, which have no offspring at all.
   *
   * @returns {{x: number, y: number, need: number} | null}
   */
  #hiddenWard(world, entity, species) {
    // ⚠ First: does this species even have a hidden stage? One field read, and
    // it makes the whole method free for every species that says nothing — the
    // same "ask the cheapest disqualifying question first" shape as
    // `GroupSystem`'s no-group-forming-species early-out.
    if (!this.neonatalConcealment || hiddenUntilFor(species) <= 0) return null;
    const offspring = entity.offspring;
    if (!offspring || offspring.length === 0) return null;
    // A parent below its own provisioning floor cannot feed anyone; walking to a
    // calf it must refuse would be a trip that helps neither of them.
    if (entity.maxEnergy > 0 && entity.energy / entity.maxEnergy <= this.parentMinEnergyFraction) return null;
    let best = null;
    for (const childId of offspring) {
      const child = world.entities.get(childId);
      if (!child || child.kind !== 'animal' || !child.alive) continue;
      // Its guardian must be *this* animal — an offspring being raised by the
      // other parent is not this one's responsibility.
      if (child.guardianId !== entity.id) continue;
      if (!isHiding(child, world.species.get(child.speciesId) ?? species)) continue;
      const distance = Math.hypot(child.x - entity.x, child.y - entity.y);
      // Already close enough to provision: there is nothing to close, exactly as
      // `followDistance` means for a following juvenile.
      if (distance <= this.provisionRange) continue;
      const need = child.maxEnergy > 0 ? clamp01(1 - child.energy / child.maxEnergy) : 0;
      // The hungriest one wins; ties by ascending id, which `offspring` already is.
      if (best === null || need > best.need) best = { x: child.x, y: child.y, need };
    }
    return best;
  }

  #intentFor(world, action, entity, target, roll, candidateHeading, fleeFrom, behavior) {
    switch (action) {
      case 'eat':
      case 'drink':
      case 'rest':
      // ⚠ `hide` belongs here and nowhere else: lying still *is* the behaviour,
      // so it must produce a non-moving intent. Putting it in the fallthrough
      // group below — which is the natural-looking place for a bond action
      // beside `followParent` — would make a hidden calf walk, which is the
      // exact opposite of the mechanism (and is D9's shape: a `case` added to
      // the wrong fallthrough chain).
      case 'hide':
        // Stationary: keep a heading for facing, but do not move.
        return { heading: entity.moveIntent?.heading ?? candidateHeading, ttl: 0, moving: false, sprint: false };
      case 'flee': {
        // Away from the threat — or from wherever the alarm said it was, for an
        // animal that never saw it — at a sprint, but made aware of the world's
        // edges AND of thicket so a driven prey runs ALONG a wall (or a thicket
        // edge) rather than smearing into it and pinning in the corner (option
        // 3). This re-commits every tick, so fixing it at the movement layer's
        // one-step reflection was never enough — the decision has to pick a
        // boundary-honest heading in the first place. `escapeHeading` is the seam
        // options 4 (soft edge repulsion) and 5 (cornered break-past) extend.
        //
        // Thicket is treated as a wall to skirt *unless* the animal is already
        // inside one (then it is refuge to move through). If, after skirting,
        // the only heading left points into thicket, the animal is cornered —
        // its last choice is to juke into cover, so mark the break-in for the
        // movement system (which otherwise refuses a fleeing step into thicket).
        const avoidThicket = !world.isThicketAt(entity.x, entity.y);
        const heading = escapeHeading(
          world, entity.x, entity.y, fleeFrom.x, fleeFrom.y, this.fleeWallMargin, this.fleeLookahead, avoidThicket,
        );
        const breakThicket =
          avoidThicket && world.isThicketAt(entity.x + Math.cos(heading), entity.y + Math.sin(heading));
        return { heading, ttl: 1, moving: true, sprint: true, breakThicket };
      }
      case 'defend': {
        // Toward the threat — at a walk for an interposing parent, because this is
        // interposing and an adult that arrives out of breath defends nothing.
        //
        // ⚠⚠ **A species that declares `behavior.chargeWeight` sprints instead**
        // (BEHAVIOR-PLAN P9), and the reason is that every mechanical effect of
        // defending is *positional*: `shielding` and the `defenderInjuryBonus` both
        // count who is standing there when the attempt resolves, so arriving sooner
        // is the whole of what a heavy animal's mass is worth. See
        // `predation/charge.js`.
        //
        // ⚠ **Two refusals, and neither is tidiness.** An animal standing over
        // *itself* — the hunted one facing its attacker since phase 11 — must not
        // charge: it would close the distance its predator has to cover and spend
        // the stamina `captureChance` is about to read, an own goal on both terms.
        // And an animal below its stamina reserve walks, so a charge can never leave
        // it with nothing for the flee a second predator would ask of it.
        const heading = Math.atan2(target.y - entity.y, target.x - entity.x);
        const charging =
          this.charge.enabled &&
          (behavior.chargeWeight ?? 0) > 0 &&
          entity.defendingId !== entity.id &&
          entity.stamina >= entity.maxStamina * this.charge.staminaFraction;
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: charging };
      }
      case 'chase': {
        // Committed pursuit: sprint at the prey's current position.
        const heading = Math.atan2(target.y - entity.y, target.x - entity.x);
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: true };
      }
      case 'herd': {
        // Cohesion *and* alignment, which is what makes it group movement
        // rather than a huddle: steer partly at the group's centre of mass and
        // partly along the direction the group is already going, weighted by
        // how far off-centre this animal has drifted. An animal barely adrift
        // mostly falls in line; one well outside mostly cuts back in.
        const toCentre = Math.atan2(target.y - entity.y, target.x - entity.x);
        const along = target.heading;
        // ⚠ **The distance the *utility* used, carried on the target** (P3): a
        // declared `associationPull` widens it, and this is the second of the two
        // places that read it. The fallback is the species number rather than a
        // guess, so a target built without one degrades to the pre-P3 arithmetic
        // instead of to `NaN` — which is what a missing field did to this exact
        // expression once before (see the target literal's own note).
        const herdDistance = target.herdDistance ?? behavior.herdDistance;
        const cohesion = clamp01((target.drift - herdDistance) / Math.max(herdDistance, 1e-6));
        const heading =
          along === null
            ? toCentre
            : Math.atan2(
                cohesion * Math.sin(toCentre) + (1 - cohesion) * Math.sin(along),
                cohesion * Math.cos(toCentre) + (1 - cohesion) * Math.cos(along),
              );
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: false };
      }
      case 'patrol':
      case 'retreat': {
        // Straight at its own range centre, at a walk. A separate case rather
        // than a member of the fallthrough group below because the target here
        // is a bare {x, y} with no cell — and because §1.4 D9 is what happens
        // when you add a `case` into a fallthrough chain.
        const heading = Math.atan2(target.y - entity.y, target.x - entity.x);
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: false };
      }
      case 'seekFood':
      case 'seekWater':
      case 'seekMate':
      case 'followParent':
      // Walking back to a hidden calf is an ordinary directed walk toward a
      // position, exactly like following a guardian in the other direction.
      case 'tend':
      case 'recallFood':
      case 'recallWater':
      case 'shelter':
      case 'leaveThicket':
      // Hauling a kill to a tree is an ordinary directed walk toward a cell —
      // the load it is dragging is the movement system's business, not the
      // heading's. ⚠ It belongs in this group and not beside `chase`: it walks,
      // it deflects around obstacles like any other directed action, and it must
      // never sprint (a cat towing a carcass is not sprinting).
      case 'cache':
      case 'stalk': {
        // Cell targets aim at the cell centre; a mate target carries an exact
        // position.
        const tx = target.x ?? target.cellX + 0.5;
        const ty = target.y ?? target.cellY + 0.5;
        let heading = Math.atan2(ty - entity.y, tx - entity.x);
        // ⚠⚠ **The concealed approach** (phase 14, PLAN-SPECIES.md §3.12). An
        // ambush predator does not walk openly at its prey: it steps through cover
        // where cover is on the way. Only for a species that declares it wants
        // cover (`habitat.cover > 1`, which is the leopard and nothing else), only
        // while stalking, and it falls straight back to the direct bearing when no
        // sampled step is better hidden — so this is a handful of grid reads on the
        // rare tick a cat is closing, and exactly nothing for everybody else.
        //
        // It is here rather than in `stalk`'s *utility* on purpose: what changes is
        // which way the animal steps, not whether stalking is worth doing. That
        // keeps it out of the utility table, which is the rule this project has
        // paid for more than once (DOCS §9 Decision).
        //
        // ⚠ The species is looked up **here** rather than passed in: `#intentFor`
        // already takes eight arguments, and D28 is this file's own record of what
        // one more can cost. Inside the branch it is a single `Map.get` on the rare
        // tick an ambush predator is actually stalking, and nothing at all on every
        // other action — which is cheaper than a parameter every caller pays for.
        if (action === 'stalk' && this.coverConcealment && stalksFromCover(world.species.get(entity.speciesId))) {
          heading = concealedApproach(world, entity, heading, entity.speed);
        }
        // ⚠⚠ **Deflection around an obstacle** (2026-08-01), and the thing that
        // makes every action in this group able to fail and recover rather than
        // only fail. `flee` has been boundary-honest since Step 8 —
        // `escapeHeading`'s along-wall glide — while these ten walked straight at
        // their target and stopped dead at the first rock, thicket edge or full
        // cell, forever, because the movement system's turn-around lands on an
        // intent this branch replaces wholesale every tick.
        //
        // Two states, and the movement system's `ttl = 0` on a block is what
        // keeps them exclusive:
        //   * **just refused** — probe a small fixed ladder of offsets and commit
        //     to the best one that is actually steppable;
        //   * **mid-detour** — hold that heading for `detourCommitTicks`, exactly
        //     as `wander` holds a commitment, so the animal slides *along* the
        //     obstacle instead of alternating into and away from it every tick.
        //
        // Pure geometry and grid reads, no draws, so the two-draw budget and
        // determinism hold. It costs nothing at all on a tick that was not
        // blocked and is not already detouring, which is ~85% of directed
        // animal-ticks in the demo and ~60% at rocks=6 thickets=8.
        let detour = null;
        let ttl = 1;
        if (this.detourEnabled) {
          const prior = entity.moveIntent;
          if (prior?.refused === true) {
            const deflected = detourHeading(world, entity, heading, this.detourLookahead, this.stepRules);
            if (deflected !== null) {
              heading = deflected;
              detour = action;
              ttl = this.detourCommitTicks;
            } else if (crowdLocked(world, entity, heading, this.stepRules)) {
              // ⚠⚠ **Blocked by bodies, with nowhere to deflect to** (2026-08-06).
              // `detourHeading` is a wall-follow, and a wall-follow is the right
              // model for rock: the obstacle is static, so sliding along it gets
              // you past it. A **crowd** is not static and is not only in front of
              // you — an animal in the middle of a packed herd has bodies on every
              // side, every ladder offset is refused, and the null return then
              // leaves it re-committing to its direct bearing and being refused
              // again, every tick, for as long as the crowd holds. Measured at
              // **9.3%** of wildebeest animal-ticks before the packing floor above.
              //
              // Standing still for the tick is the honest intent: there is no
              // heading that can be taken, so claiming one is a lie the movement
              // system has to catch. It also *helps* — a non-moving animal is not
              // pushing inward, so a jam loosens from the inside instead of every
              // member re-committing into it together.
              //
              // ⚠ It reports `moving: false` rather than a refusal, which is the
              // distinction `MovementSystem` already draws for an animal in a tree:
              // a refusal means "an obstacle to deflect around" and the deflection
              // is exactly what has just been established not to exist.
              //
              // ⚠⚠ **`crowdLocked` is on the intent because the metric cannot see
              // this any other way.** A refused step is visible as `refused` on the
              // intent the movement system turned around; an animal that never
              // committed one is indistinguishable from an animal that chose to
              // stand and eat. Without this flag the *fix* would have hidden the
              // symptom from the instrument added to watch for it — a jam would
              // read as a **fall** in the refusal rate. Same shape as A83's clean
              // report from a detector that could not see the mechanism.
              return { heading: normalizeAngle(heading), ttl: 1, moving: false, sprint: false, crowdLocked: true };
            }
          } else if (prior?.detour === action && prior.ttl > 0 && prior.moving === true) {
            heading = prior.heading;
            detour = action;
            ttl = prior.ttl - 1;
          }
        }
        // A desperate animal pushes through a thin thicket band to reach water or
        // food just beyond it (the corner-lake case). Only for the resource-seeking
        // actions, only when the need is real and the resource is a few cells away
        // (a thin band, not deep cover), and only when the next step actually lands
        // in thicket — otherwise the movement system refuses the crawl, and the
        // animal dies of thirst at the water's edge.
        const seekingWater = action === 'seekWater' || action === 'recallWater';
        const seekingFood = action === 'seekFood' || action === 'recallFood';
        // ⚠ **`shelter` joined this gate on 2026-08-01, and it had to.** A thicket
        // is sheltering ground (`world.isShelteredAt`) and perception now says so,
        // but the movement system refuses a step into one — so without this the
        // fix above would only walk an animal to the edge of the cover it needs
        // and stop it there, which is the corner-lake failure with a different
        // resource. The need is thermal stress against the same threshold the
        // action engages at, normalized over `shelterStressSpan`, so the same
        // "a real need, a thin band, and close by" test decides all three.
        const seekingShelter = action === 'shelter';
        let breakThicket = false;
        if (seekingWater || seekingFood || seekingShelter) {
          const need = seekingWater
            ? entity.maxHydration > 0 ? 1 - entity.hydration / entity.maxHydration : 0
            : seekingShelter
              ? clamp01(thermalStress(world, entity, this.shelterRelief) / this.shelterStressSpan)
              : entity.maxEnergy > 0 ? 1 - entity.energy / entity.maxEnergy : 0;
          const distance = Math.hypot(tx - entity.x, ty - entity.y);
          breakThicket =
            need >= this.thicketReachNeed &&
            distance <= this.thicketReachDistance &&
            world.isThicketAt(entity.x + Math.cos(heading), entity.y + Math.sin(heading));
        }
        // Stalking closes at a walk — spending the sprint budget before the
        // prey is even in range is how a predator loses a chase.
        return { heading: normalizeAngle(heading), ttl, moving: true, sprint: false, breakThicket, detour };
      }
      case 'wander':
      default: {
        const intent = entity.moveIntent;
        // ⚠ **A live detour commitment is honoured here too, and that is
        // deliberate** (2026-08-01). An animal that gives up on `seekWater`
        // half-way around a rock arrives in this branch still holding the
        // detour's heading and ttl, and the continuation path below carries it
        // (jittered) until the commitment runs out — so it finishes going *round*
        // the obstacle rather than immediately striking out into the face of it.
        // The mechanism is the ttl this branch already reads; the only thing that
        // changed is that a directed intent's ttl can now exceed 1. Nothing is
        // needed to make this work, which is why there is a comment here instead
        // of a guard: the next person to read `intent.ttl` in this branch should
        // know a detour can be what set it.
        //
        // Ranging: an animal with an unmet need (hunger or thirst) and no
        // migration drift to point it anywhere strikes out in longer, straighter
        // excursions rather than milling — it covers new ground instead of
        // re-searching the patch it is standing in, which is what a stalker
        // circling one corner of the map until it dies of thirst needed. Gated
        // hard: off entirely once a drift gives it a direction (the drift is the
        // better cue), and off for a fed, watered animal, so the A34 lesson holds
        // — this only lengthens a wander that was already aimless and failing.
        const need = Math.max(
          entity.maxEnergy > 0 ? 1 - entity.energy / entity.maxEnergy : 0,
          entity.maxHydration > 0 ? 1 - entity.hydration / entity.maxHydration : 0,
        );
        // ⚠⚠ **The herd's consensus stands *in place of* this animal's own drift
        // while it is live** (BEHAVIOR-PLAN P8) — one conditional, and deliberately
        // **not a fourth blend** onto the heading below. `HerdConsensusSystem`
        // (priority −3) has already pooled the migration drifts of everyone sharing
        // this animal's herd label and handed each member the same answer, so
        // blending the two would be averaging a number with its own average and
        // would leave the strengths summing to nothing meaningful. Replacing keeps
        // one drift in the channel and lets the commitment do what it is for: the
        // strength survives with the heading, so a herd keeps going after the
        // gradient that started it has flattened.
        //
        // ⚠ The **ttl is owned and enforced by that system**, which clears both
        // fields when a commitment lapses, so the question here is the same
        // one-null-check `trailHeading` gets rather than a second reading of the
        // clock (D11). ⚠ Its `updateInterval` is therefore also the resolution of
        // the expiry: a commitment ends at the next consensus tick, not necessarily
        // on the tick it fell due.
        //
        // ⚠ Null for every species that declares no `behavior.consensusWeight`,
        // which is six of the eight, and for every animal of the other two that is
        // alone, dispersing, or in a herd that could not agree — so this is one null
        // comparison and then exactly the expression it has been since Step 26.
        const consensus = entity.herdHeading !== null;
        const drift = consensus ? entity.herdHeading : entity.migrationHeading;
        const driftStrength = consensus ? entity.herdStrength : entity.migrationStrength;
        const roaming = need >= this.rangingThreshold && driftStrength <= 1e-6;
        if (!intent || !intent.moving || intent.ttl <= 0) {
          // Migration (Step 26) enters here and **only** here. A fresh wander
          // commitment is the one heading in the whole system that was going to
          // be arbitrary, so bending it costs nothing that was doing any work —
          // which is exactly why migration is not an action (§1.4 A34, and see
          // migration/migration.js). At strength 0 `blendHeadings` returns
          // `candidateHeading` untouched, so an animal with no reason to be
          // going anywhere behaves precisely as it did before this step.
          //
          // The commitment is what turns a shallow local cue into real
          // distance: the heading is held for 8–24 ticks and re-picked toward
          // the same gradient while it persists, so an animal migrates by
          // drifting rather than by routing. Nothing here searches.
          // Blended in turn onto the same arbitrary heading, and all weak: where
          // the better ground is (Step 26), where the band this animal has lost
          // contact with went (P7), and that a worn trail is an easier way to
          // walk (Step 28). Sequential rather than summed because each blend
          // already interpolates toward its target.
          //
          // ⚠ `drift` is the **effective** one, resolved above: the herd's agreed
          // heading while a commitment is live (P8), this animal's own migration
          // heading otherwise. The consensus *replaces* this channel rather than
          // adding a fourth, and it is resolved once so the ranging gate and this
          // blend cannot disagree about whether the animal has somewhere to be.
          const withDrift = drift === null ? candidateHeading : blendHeadings(candidateHeading, drift, driftStrength);
          // ⚠ **Three drifts now, and the order is an argument** (BEHAVIOR-PLAN P7).
          // Reunion sits between them because it answers the same question the
          // forage drift does — *where* to go — while the trail answers *how to get
          // there*, and where you are going outranks how you get there. It is a
          // third blend rather than a fourth channel: `herd` is an action and this
          // only bends a wander, so a rally applies exactly when there was no local
          // centroid worth steering at (see `GroupSystem#rally`).
          //
          // ⚠⚠ The null check is not defensive tidiness. `blendHeadings` calls
          // `clamp01`, and `clamp01(undefined)` returns `undefined`, which makes the
          // blend NaN, `normalizeAngle(NaN)` NaN, and `entity.x = NaN`
          // **permanently** — the animal then vanishes from every spatial query for
          // the rest of the run. Written exactly the way `trailHeading` is, and
          // backed by the `createEntity` defaults.
          const rally = entity.rallyHeading;
          const withRally = rally === null ? withDrift : blendHeadings(withDrift, rally, entity.rallyStrength);
          const trail = entity.trailHeading;
          return {
            heading: trail === null ? withRally : blendHeadings(withRally, trail, entity.trailStrength),
            ttl: this.minCommitTicks + (roaming ? this.rangingCommitBonus : 0) + Math.floor(roll * this.commitTickSpan),
            moving: true,
            sprint: false,
          };
        }
        // ⚠⚠ **The drift reaches a wander already under way too** (2026-08-06,
        // A71). This branch — a *held* commitment, jittered — is where a wandering
        // animal spends 7 to 23 ticks out of every 8 to 24, and until now it was
        // the one path in the system that never looked at `migrationHeading` at
        // all. So a cue documented as "0.5 × thirst, harder the thirstier" was
        // applied **once per commitment** and ignored in between, which against a
        // lake covering ~1.5% of the map is not enough to cross one. That is A65's
        // shape — the recovery written where nobody reads it — and it is why
        // "died of thirst having NEVER perceived water" was the largest class in
        // the ethologist's report while the mechanism meant to prevent it was
        // switched on and apparently working.
        //
        // ⚠ Scaled well below the fresh-commitment blend, because the commitment is
        // doing real work: an animal migrates by *drifting* toward a cue rather than
        // routing to it (A34 — migration is not an action, and this is the edit that
        // could quietly make it one). At `holdBiasScale` 0 this is exactly the
        // expression it has been since Step 26, which is what makes the control arm
        // reproducible rather than merely close.
        const held = normalizeAngle(
          intent.heading + (roll - 0.5) * this.wanderJitter * (roaming ? this.rangingJitterScale : 1),
        );
        return {
          heading:
            drift === null || this.holdBiasScale <= 0
              ? held
              : blendHeadings(held, drift, driftStrength * this.holdBiasScale),
          ttl: intent.ttl - 1,
          moving: true,
          sprint: false,
        };
      }
    }
  }
}

// Obstacle-deflection tuning (2026-08-01). The ladder a blocked directed step
// tries, in order — see `detourHeading` for why the order is behaviour. Shallow
// offsets first so an animal shaves past an obstacle it barely clipped rather
// than turning broadside to it; the ± pairs are what make a symmetric obstacle
// resolve the same way every tick instead of oscillating.
const DETOUR_OFFSETS = Object.freeze([
  Math.PI / 4, -Math.PI / 4, // 45°  — shave past
  Math.PI / 2, -Math.PI / 2, // 90°  — slide along the face
  (3 * Math.PI) / 4, -(3 * Math.PI) / 4, // 135° — back out of a pocket
]);
// How much a detour is allowed to win on open room alone rather than on progress
// toward the target. Same shape and same value as `ESCAPE_AWAY_BIAS`: at 0.5 a
// heading that turns away needs twice the room of one that still closes, so
// backing out of a pocket happens only when the shallow ways past are walled.
const DETOUR_PROGRESS_BIAS = 0.5;

// Cornered break-past (option 5) tuning. Fixed and small so a flee decision
// costs the same whatever the world looks like — the perf convention the rest
// of the decision system holds to. `ESCAPE_SAMPLES` directions are probed,
// each in `ESCAPE_PROBE_STEP` increments out to the caller's lookahead.
const ESCAPE_SAMPLES = 16;
const ESCAPE_PROBE_STEP = 2;
// A heading that edges toward the predator must clear this much more open
// ground than a safe one to be chosen (multiplicative). It is what keeps a
// cornered animal from charging until hugging the wall has genuinely run out of
// room: at 0.5 a toward-predator break needs 2× the room of the safest
// heading, so open flight never charges and a map corner rarely does — but a
// prey walled into a terrain pocket, with the predator in the only gap, will.
const ESCAPE_AWAY_BIAS = 0.5;
// A heading that stays clear all the way to the horizon is worth more than one
// that dead-ends at a wall the same distance on — it is the difference between a
// way out and a deeper pocket. Without this, straight-line room rewards running
// into the closed end of a cul-de-sac; with it, the prey favours the direction
// that actually leads to open ground, which is what makes the break-past find
// the exit rather than the back wall.
const ESCAPE_OPEN_BONUS = 1.5;

/**
 * Clear distance ahead of (px,py) along heading `h`, out to `lookahead`,
 * stopping at the first off-map or impassable cell. This is the terrain
 * awareness that readies the escape logic for the restrictive terrain to come:
 * a prey backed against a rock reads it exactly as it reads a map edge, so the
 * same break-past logic covers both without a special case.
 *
 * @param {{width:number,height:number,isPassableAt:Function}} world
 */
function roomAhead(world, px, py, h, lookahead, avoidThicket = false) {
  const dx = Math.cos(h);
  const dy = Math.sin(h);
  for (let d = ESCAPE_PROBE_STEP; d <= lookahead; d += ESCAPE_PROBE_STEP) {
    const x = px + dx * d;
    const y = py + dy * d;
    if (x < 0 || x > world.width || y < 0 || y > world.height || !world.isPassableAt(x, y)) {
      return d - ESCAPE_PROBE_STEP;
    }
    // A thicket edge reads as a wall to a fleeing animal that is not already
    // inside one, so the along-wall glide and the break-past both route along
    // thicket the way they route along rock — the animal skirts the edge and
    // only breaks in when nothing open is left. Off (the default) when the
    // animal is already in thicket, so it can still compute a way out.
    if (avoidThicket && world.isThicketAt(x, y)) {
      return d - ESCAPE_PROBE_STEP;
    }
  }
  return lookahead;
}

/**
 * Heading for an animal fleeing a threat, made aware of the world's edges and
 * terrain. Three behaviours, in escalating desperation, all from one honest
 * starting instinct ("straight away from the threat"):
 *
 *   1. **Open flight.** Nothing blocks the away-heading — take it. The common
 *      case, and kept O(1)-cheap: one room probe and done.
 *   2. **Along-wall glide (option 3).** The away-heading points into a nearby
 *      world edge, so drop the component that goes through it and run *along*
 *      the wall instead of smearing into it — provided that glide has room.
 *   3. **Cornered break-past (option 5).** The glide is itself walled off (a map
 *      corner, or a rock hard against the wall). Choose by trading open room
 *      against staying away from the predator, sampling every direction. When
 *      every safer heading is blocked, the only direction left with room is the
 *      gap the predator is standing in — so a truly cornered animal breaks
 *      *past* it rather than stand still to be caught. That charge is not a
 *      special case; it is what this scoring does when nothing safer survives,
 *      which is why it will keep working when terrain gets restrictive.
 *
 * Pure geometry and grid reads — no draws — so the decision system's fixed
 * two-draw budget per animal per tick is untouched and determinism holds.
 * `margin` 0 disables wall-awareness entirely and returns "straight away".
 *
 * @param {{width:number,height:number,isPassableAt:Function}} world
 * @param {number} px @param {number} py fleeing animal's position
 * @param {number} fromX @param {number} fromY what it is fleeing
 * @param {number} margin world-units from an edge at which wall-awareness bites
 * @param {number} lookahead how far ahead room is judged
 * @param {boolean} [avoidThicket] treat thicket as a wall to skirt (a fleeing
 *        animal not already inside one), so it runs along the edge rather than
 *        diving into the crawl — and only breaks in when nothing open remains
 * @returns {number} committed escape heading, normalized to [0, 2π)
 */
export function escapeHeading(world, px, py, fromX, fromY, margin, lookahead, avoidThicket = false) {
  const away = Math.atan2(py - fromY, px - fromX);
  // Wall-awareness off: the honest "straight away from the threat" instinct,
  // unmodified. This is the pre-fix control the change is measured against.
  if (!(margin > 0)) return normalizeAngle(away);

  // Options 1 & 3: keep the away-heading, but drop any component pointing into a
  // nearby world edge so it glides along the wall. With no edge in range this
  // leaves the away-heading untouched (open flight).
  let ax = px - fromX;
  let ay = py - fromY;
  if (px < margin && ax < 0) ax = 0;
  if (px > world.width - margin && ax > 0) ax = 0;
  if (py < margin && ay < 0) ay = 0;
  if (py > world.height - margin && ay > 0) ay = 0;
  if (ax !== 0 || ay !== 0) {
    const glide = normalizeAngle(Math.atan2(ay, ax));
    // Take it only if the glide is clear all the way to the horizon. A glide
    // that dead-ends short — the along-wall run into a corner, or terrain hard
    // up against the wall — falls through to the break-past, which weighs it
    // against every other direction instead of committing to it blindly.
    if (roomAhead(world, px, py, glide, lookahead, avoidThicket) >= lookahead) return glide;
  }

  // Option 5: cornered. Score every sampled heading by how much open room it
  // has — bonused when that room runs unobstructed to the horizon, discounted
  // for pointing toward the predator — and take the best. The away-discount is
  // multiplicative, so a heading only wins by charging the predator's gap when
  // every safer heading has run out of room: the escalation to a charge is what
  // the scoring already does, not a separate branch, which is why it will hold
  // up when terrain gets restrictive enough to make the gap the only way out.
  let best = away;
  let bestScore = -Infinity;
  for (let i = 0; i < ESCAPE_SAMPLES; i += 1) {
    const h = away + (i / ESCAPE_SAMPLES) * TWO_PI;
    const room = roomAhead(world, px, py, h, lookahead, avoidThicket);
    if (room <= 0) continue;
    const awayN = (Math.cos(h - away) + 1) / 2; // 1 = straight away, 0 = straight at it
    const open = room >= lookahead ? ESCAPE_OPEN_BONUS : 1;
    const score = room * (ESCAPE_AWAY_BIAS + (1 - ESCAPE_AWAY_BIAS) * awayN) * open;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return normalizeAngle(best);
}

/**
 * A heading around the obstacle that just refused a directed step, or `null`
 * when nothing is steppable and the animal should keep its direct bearing (the
 * pre-2026-08-01 behaviour, so this can never be worse than not trying).
 *
 * Each candidate is judged on two things and nothing else: whether the very next
 * step is actually *takeable* — asked through `stepRefused`, the movement
 * system's own predicate, so a heading this returns can never be one that system
 * then refuses — and how much open room lies along it, biased toward the offsets
 * that still make progress toward the target. That is `escapeHeading`'s scoring
 * with the target's bearing in place of the threat's, which is DOCS §9
 * Decision's rule about checking whether the behaviour you want is already
 * described by something here and merely unimplemented on one branch.
 *
 * ⚠ **The offsets are a fixed, symmetric, ordered ladder, and that is what makes
 * this a wall-follow rather than a jitter.** A symmetric obstacle scores its two
 * sides identically; the tie goes to the first offset listed, every tick, so the
 * animal keeps choosing the *same* side and slides along the obstacle instead of
 * alternating. Reordering `DETOUR_OFFSETS` re-derives which way animals go around
 * rocks — it is behaviour, not style. ±180° is deliberately absent: the movement
 * system already turns a blocked animal around and it never helped.
 *
 * Pure geometry and grid reads — no draws — so the decision system's fixed
 * two-draw budget per animal per tick is untouched and determinism holds. Cost is
 * at most `DETOUR_OFFSETS.length` step probes and that many `roomAhead` walks,
 * paid only on the tick a directed step was actually refused.
 *
 * @param {{width:number,height:number,isPassableAt:Function,isThicketAt:Function,cellOf:Function,speedModifierAt:Function}} world
 * @param {object} entity the blocked animal, at its current position
 * @param {number} direct bearing straight at the target
 * @param {number} lookahead how far ahead open room is judged, in world units
 * @param {import('../locomotion/steps.js').DEFAULT_STEP_RULES} stepRules
 * @returns {number | null} a committed detour heading, or null
 */
export function detourHeading(world, entity, direct, lookahead, stepRules) {
  const step = stepLength(world, entity, false, stepRules);
  // An animal already standing in thicket must not read thicket as a wall, or it
  // would score every way out at zero room and stay in the crawl — the same
  // exemption `escapeHeading` makes for a prey already inside cover.
  const avoidThicket = !world.isThicketAt(entity.x, entity.y);
  let best = null;
  let bestScore = 0;
  for (const offset of DETOUR_OFFSETS) {
    const h = direct + offset;
    const tx = entity.x + Math.cos(h) * step;
    const ty = entity.y + Math.sin(h) * step;
    if (tx < 0 || tx > world.width || ty < 0 || ty > world.height) continue;
    // `breakThicket` is false here on purpose: a detour is a way *around*, and
    // pushing into cover stays the last resort the thicket-reach gate owns.
    if (stepRefused(world, entity, tx, ty, false, stepRules.maxOccupantsPerCell)) continue;
    const room = roomAhead(world, entity.x, entity.y, h, lookahead, avoidThicket);
    if (room <= 0) continue;
    const toward = (Math.cos(offset) + 1) / 2; // 1 = straight on, 0 = straight back
    const score = room * (DETOUR_PROGRESS_BIAS + (1 - DETOUR_PROGRESS_BIAS) * toward);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best === null ? null : normalizeAngle(best);
}

/**
 * Whether the thing that just refused every way out was **other animals** rather
 * than the ground (2026-08-06).
 *
 * Asked only on the path where `detourHeading` has already returned `null` — every
 * offset on the ladder refused — so it answers one question: would any of them
 * have been takeable if the occupancy cap were lifted? Yes means the animal is
 * boxed in by bodies and the right intent is to stand still; no means it is in a
 * genuine terrain pocket, which is `escapeHeading`'s documented wide-concave-pocket
 * limit (A66) and is deliberately left exactly as it was.
 *
 * ⚠ **The same ladder, the same predicate, the same order.** It re-probes
 * `DETOUR_OFFSETS` through `stepRefused` with the cap passed as `null`, so the
 * comparison is against the *identical* question the deflection just asked minus
 * one term. Re-deriving "is this crowding?" from a fresh cell count would be a
 * second opinion about a rule that already has one home (D11, and the reason
 * `steps.js` exists at all).
 *
 * ⚠ It costs at most `DETOUR_OFFSETS.length` grid-free predicate calls — no
 * `roomAhead` walk, no `cellFull` query, since the cap is what is being removed —
 * and only on a tick that was blocked *and* undeflectable, which is well under 1%
 * of animal-ticks in a healthy world. Pure geometry and terrain reads, no draws.
 *
 * @param {object} world
 * @param {object} entity the blocked animal, at its current position
 * @param {number} direct bearing straight at the target
 * @param {import('../locomotion/steps.js').DEFAULT_STEP_RULES} stepRules
 * @returns {boolean}
 */
export function crowdLocked(world, entity, direct, stepRules) {
  // Nothing to be locked by: with no cap, occupancy never refused anything, so a
  // universal refusal was terrain and this is the identity.
  if (stepRules.maxOccupantsPerCell === null) return false;
  const step = stepLength(world, entity, false, stepRules);
  for (const offset of DETOUR_OFFSETS) {
    const h = direct + offset;
    const tx = entity.x + Math.cos(h) * step;
    const ty = entity.y + Math.sin(h) * step;
    if (tx < 0 || tx > world.width || ty < 0 || ty > world.height) continue;
    if (!stepRefused(world, entity, tx, ty, false, null)) return true;
  }
  return false;
}

/**
 * The nearest passable, non-thicket cell to a position — where an animal caught
 * in a thicket heads to get back out. A ring-by-ring outward scan, so it returns
 * the closest exit and stops the moment it finds one; bounded by `maxRadius` and
 * only ever called for the handful of animals actually standing in thicket, so
 * it costs nothing on open ground. Pure grid reads, no draws — determinism and
 * the decision system's fixed draw budget are untouched.
 *
 * @param {{cellOf: Function, isPassableAt: Function, isThicketAt: Function}} world
 * @param {number} x @param {number} y
 * @param {number} maxRadius rings to search outward (cells)
 * @returns {{cellX: number, cellY: number} | null} nearest open cell, or null
 */
function nearestOpenCell(world, x, y, maxRadius) {
  const { cellX, cellY } = world.cellOf(x, y);
  for (let r = 1; r <= maxRadius; r += 1) {
    let best = null;
    let bestDistance = Infinity;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        // The shell of this ring only — inner rings were searched already.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cellX + dx;
        const gy = cellY + dy;
        const cx = gx + 0.5;
        const cy = gy + 0.5;
        if (!world.isPassableAt(cx, cy) || world.isThicketAt(cx, cy)) continue;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { cellX: gx, cellY: gy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * The nearest cell with a tree on it, or null — where a climber hauls a kill to
 * (phase T3).
 *
 * `nearestOpenCell`'s ring walk with one predicate swapped, deliberately rather
 * than generalized into a shared scanner: the two differ in what they are
 * looking for and in nothing else, and a `predicate` parameter would put a
 * closure call inside a grid scan for the sake of nine shared lines.
 *
 * Bounded by `maxRadius` and reached only by a climber standing on an uncached
 * kill — a handful of animal-ticks per thousand — so it costs the rest of the
 * world nothing. Pure grid reads, no draws.
 *
 * @param {{cellOf: Function, isTreeAt: Function}} world
 * @param {number} x @param {number} y
 * @param {number} maxRadius rings to search outward (cells)
 * @returns {{cellX: number, cellY: number} | null}
 */
function nearestTreeCell(world, x, y, maxRadius) {
  const { cellX, cellY } = world.cellOf(x, y);
  for (let r = 1; r <= maxRadius; r += 1) {
    let best = null;
    let bestDistance = Infinity;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cellX + dx;
        const gy = cellY + dy;
        if (!world.isTreeAt(gx + 0.5, gy + 0.5)) continue;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { cellX: gx, cellY: gy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Highest-utility action; ties broken by a fixed, deterministic order. */
function argmaxUtility(utilities) {
  const order = [
    // Survival first: nothing outranks getting away, and a committed chase
    // outranks a predator's other appetites. Defending young sits *above*
    // fleeing, and only above it — an adult that has decided to stand over its
    // juvenile has, by definition, decided not to run.
    'defend',
    'flee',
    'chase',
    'drink',
    // Securing a kill before eating it (phase T3). ⚠ Above `eat` only as a
    // *tie*-break — which of the two actually wins is decided by the utilities,
    // where `cache` scales with `1 - hunger` and `eat` with hunger, so a hungry
    // cat eats and a comfortable one hauls. Below `drink` and everything above
    // it: an animal does not secure its larder while dying of thirst.
    'cache',
    'eat',
    'seekWater',
    'seekFood',
    // Memory is the fallback for what the animal cannot currently see, so it
    // ranks below the senses and above everything discretionary.
    'recallWater',
    'recallFood',
    // Getting out of the weather beats discretionary activity, but never beats
    // hunger, thirst, or a predator.
    'shelter',
    'stalk',
    // The two halves of the hidden-fawn stage sit with `followParent`, because
    // all three are the parental bond expressing itself: keeping up, lying still,
    // and coming back. ⚠ `tend` is above `followParent` on purpose — an adult
    // with a starving hidden calf and a guardian of its own (a subadult still
    // bonded) should go to the calf.
    'tend',
    'followParent',
    'hide',
    'seekMate',
    // Getting out of a thicket beats every discretionary/idle behaviour below
    // (an animal should not sit crawling in cover once the danger has passed),
    // but loses to every real need and directed goal above — those lead out of
    // the thicket anyway, since nothing grows or drinks in one.
    'leaveThicket',
    // Keeping up with the herd is discretionary — it loses to every real need,
    // which is what makes a hungry animal willing to graze its way out of the
    // group and a fed one drift back into it.
    'herd',
    // Getting off a rival's ground beats settling down on it, but never beats
    // eating, drinking, or running.
    'retreat',
    'rest',
    // Patrolling is what an animal does *instead of* wandering aimlessly — the
    // lowest-ranked directed action there is, and deliberately just above the
    // undirected one it replaces.
    'patrol',
    'wander',
  ];
  let best = order[0];
  for (const action of order) {
    if (utilities[action] > utilities[best]) best = action;
  }
  return best;
}
