/**
 * Utility-based action selection (Step 8).
 *
 * Each tick, every living animal scores a small fixed set of candidate actions
 * from its hunger and perception, then commits to the best one. This replaces
 * the random wander that used to live in the movement system: decisions choose
 * WHAT to do and set the movement intent; the movement system merely executes
 * it. Actions:
 *   - defend       — a predator is on kin or a groupmate; stand and face it
 *   - flee         — a predator is in sight; sprint away (outranks everything)
 *   - herd         — drifted from the herd's centre; close up and fall in line
 *   - stalk        — prey sighted but out of range; close at a walk
 *   - chase        — prey within range; sprint (the hunting system resolves it)
 *   - eat          — standing on a food cell (consumption itself is Step 9)
 *   - seekFood     — food perceived nearby; head toward it (subsumes "approach")
 *   - recallFood   — nothing in sight, but it remembers eating somewhere
 *   - recallWater  — nothing in sight, but it remembers drinking somewhere
 *   - shelter      — the weather is biting; head for cover
 *   - seekMate     — reproductively ready; close on the best candidate in sight
 *   - followParent — a dependent juvenile keeping up with its guardian
 *   - rest         — stay put (attractive when satiated, never near danger)
 *   - wander       — undirected exploration with a committed heading
 *
 * Runs in the `decision` phase (after perception, before movement). Ownership:
 * writes `action`, `actionTarget`, `utilityBreakdown`, and `moveIntent`; reads
 * `world.perception`, physiology, vegetation, bounded `memories` (Step 15),
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
import { SPECIES } from '../config/species/index.js';
import { bestRemembered, isNearDanger, MemoryKinds } from '../memory/memories.js';
import { thermalStress } from '../world/Environment.js';
import { bestMateCandidate, isChooser, matePreferenceFor } from '../mating/mateChoice.js';
import { isKin } from '../social/dominance.js';


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
    fleeWeight = 2.0,
    herdWeight = 0.5,
    herdDistance = 3.0,
    defendWeight = 2.6,
    defendRange = 5.0,
    huntWeight = 1.4,
    stalkDiscount = 0.8,
    chaseRange = 4.0,
    minHungerToHunt = 0.25,
    minHuntStamina = 15,
    huntCooldownTicks = 60,
    carcassRange = 1.5,
    shelterWeight = 0.9,
    shelterStressThreshold = 2,
    shelterStressSpan = 10,
    shelterRelief = 0.55,
    recallWeight = 0.8,
    recallRange = 60,
    recallDistanceWeight = 0.15,
    dangerRadius = 6,
    reproduction = { minEnergyFraction: 0.7, cooldownTicks: 800 },
    minCommitTicks = 8,
    commitTickSpan = 16,
    wanderJitter = 0.5,
    foodMinLevel = 1,
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
    this.fleeWeight = fleeWeight;
    this.herdWeight = herdWeight;
    this.herdDistance = herdDistance;
    this.defendWeight = defendWeight;
    this.defendRange = defendRange;
    this.huntWeight = huntWeight;
    this.stalkDiscount = stalkDiscount;
    this.chaseRange = chaseRange;
    this.minHungerToHunt = minHungerToHunt;
    this.minHuntStamina = minHuntStamina;
    this.huntCooldownTicks = huntCooldownTicks;
    this.carcassRange = carcassRange;
    this.shelterWeight = shelterWeight;
    this.shelterStressThreshold = shelterStressThreshold;
    this.shelterStressSpan = shelterStressSpan;
    this.shelterRelief = shelterRelief;
    this.recallWeight = recallWeight;
    this.recallRange = recallRange;
    this.recallDistanceWeight = recallDistanceWeight;
    this.dangerRadius = dangerRadius;
    this.reproduction = reproduction;
    this.minCommitTicks = minCommitTicks;
    this.commitTickSpan = commitTickSpan;
    this.wanderJitter = wanderJitter;
    this.foodMinLevel = foodMinLevel;
  }

  update(world, context) {
    const random = context.random('decision');
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // Two draws, always (fixed budget → deterministic stream).
      const roll = random.next();
      const candidateHeading = random.next() * TWO_PI;

      const perceived = world.perception.get(entity.id) ?? null;
      const hunger = clamp01(1 - entity.energy / entity.maxEnergy);
      const thirst = clamp01(1 - entity.hydration / entity.maxHydration);
      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      // What counts as food depends on the species' diet (Step 16): grass under
      // your feet if you graze, a carcass within reach if you do not. Both then
      // flow through the same `eat` / `seekFood` actions — eating is eating.
      const carnivore = SPECIES[entity.speciesId]?.diet === 'carnivore';
      const carcass = perceived?.nearestCarcass ?? null;
      const onFood = carnivore
        ? carcass !== null && carcass.distance <= this.carcassRange
        : world.vegetation.levelAt(cellX, cellY) >= this.foodMinLevel;
      const nearestFood = carnivore ? carcass : (perceived?.nearestFood ?? null);
      const nearestWater = perceived?.nearestWater ?? null;
      const atWater = nearestWater !== null && nearestWater.distance <= this.drinkRange;
      // Mate choice (Step 22). A ready animal heads for a perceived candidate of
      // the opposite sex — and *which* one is where preference becomes visible:
      // the choosing sex walks toward the best animal it can see rather than the
      // closest, and pays for that in the ground it covers. Whether the pair
      // actually mates is still the reproduction system's call.
      const mateCandidate = isReproductivelyReady(entity, context.tick, this.reproduction)
        ? bestMateCandidate(perceived?.mateCandidates ?? [], (id) => world.entities.get(id), {
            preference: matePreferenceFor(entity.speciesId),
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
      const followPull = guardian && guardian.distance > this.followDistance ? this.#followUtility(guardian, perceived) : 0;
      // An unweaned juvenile lives on its guardian's provisioning and does not
      // graze at all — that is what makes the dependency real rather than
      // decorative. Its whole agenda is drinking, resting, and keeping up.
      const nursing = entity.guardianId !== null && !entity.weaned;

      // Memory (Step 15): when nothing edible or drinkable is in sight, an
      // animal falls back on where it has been. Recall is strictly weaker than
      // sight — a remembered patch may already be grazed out — so it only
      // competes once perception has come up empty.
      const recalledFood =
        !nursing && !onFood && !nearestFood ? this.#recall(entity, MemoryKinds.FOOD) : null;
      const recalledWater = !atWater && !nearestWater ? this.#recall(entity, MemoryKinds.WATER) : null;
      // Somewhere it remembers as dangerous is no place to settle down.
      const nearDanger = this.dangerRadius > 0 && isNearDanger(entity, entity.x, entity.y, this.dangerRadius);

      // Weather (Step 19). An animal paying to hold its body temperature has a
      // reason to walk to cover — and none at all once it is already there, so
      // the pull is gated on actually being out in it.
      const stress = thermalStress(world, entity, this.shelterRelief);
      const cover = perceived?.nearestCover ?? null;
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
        ? this.fleeWeight * (0.5 + 0.5 * (1 - clamp01(threat.distance / (perceived.radius || 1))))
        : 0;
      // Sociality (Step 23). An animal that cannot see the predator itself but
      // has been alarmed by a neighbour runs anyway, away from where it was
      // told the threat is. This is what turns one animal's sighting into a
      // herd's stampede — and why the alarm carries a position and not just a
      // flag, since panic with no direction is just milling about.
      const alarmed = entity.alarmedUntil !== null && context.tick < entity.alarmedUntil && entity.alarmSource !== null;
      const alarmFlee = !threat && alarmed ? this.fleeWeight * 0.75 : 0;
      // Defense (§1.4 A11). An adult stands its ground when the predator is
      // going for its own young or a groupmate's, rather than saving itself.
      // It never outranks its own direct danger by much, and juveniles never do
      // it — a half-grown animal facing a stalker is not brave, it is prey.
      const ward = this.#wardToDefend(world, entity, perceived);
      const defendUrgency = ward ? this.defendWeight : 0;
      // Herding: close up when the animal has drifted off the local centre of
      // its group. Scaled by (2 − boldness) exactly as `rest` is, so the same
      // trait that makes an animal roam also makes it a looser herd member —
      // no new trait needed for temperament to show up in social behaviour.
      const social = world.social.get(entity.id) ?? null;
      const drift = social?.centroid
        ? Math.hypot(social.centroid.x - entity.x, social.centroid.y - entity.y)
        : 0;
      const herdPull =
        social?.centroid && drift > this.herdDistance
          ? this.herdWeight * (2 - entity.traits.boldness) * clamp01((drift - this.herdDistance) / Math.max(this.herdDistance, 1e-6))
          : 0;
      const prey = perceived?.nearestPrey ?? null;
      const recovering = entity.lastHuntTick !== null && context.tick - entity.lastHuntTick < this.huntCooldownTicks;
      const willHunt =
        prey !== null && !recovering && hunger >= this.minHungerToHunt && entity.stamina > this.minHuntStamina;
      // Two stages, both visible in `action`: close quietly, then commit. The
      // moment the prey bolts, stalking is pointless — a walking predator can
      // never catch a sprinting grazer — so a fleeing target forces the sprint
      // regardless of range.
      const chasing = willHunt && (prey.distance <= this.chaseRange || prey.fleeing === true);

      // Individual variation (Step 14): a cautious animal acts on hunger and
      // thirst sooner (it keeps a bigger reserve), while a bold one prefers
      // covering ground to sitting still — both real trade-offs, since roaming
      // finds food and water but costs energy.
      const { boldness, caution, exploration } = entity.traits;
      const hungerDrive = this.hungerWeight * hunger * caution;
      const thirstDrive = this.thirstWeight * thirst * caution;

      const utilities = {
        defend: defendUrgency,
        flee: Math.max(fleeUrgency, alarmFlee),
        herd: herdPull,
        chase: chasing ? this.huntWeight * hunger : 0,
        stalk: willHunt && !chasing ? this.huntWeight * hunger * this.stalkDiscount : 0,
        drink: atWater ? this.drinkBias + thirstDrive : 0,
        seekWater: nearestWater && !atWater ? thirstDrive : 0,
        eat: onFood && !nursing ? this.eatBias + hungerDrive : 0,
        seekFood: nearestFood && !onFood && !nursing ? hungerDrive : 0,
        recallWater: recalledWater ? thirstDrive * this.recallWeight : 0,
        recallFood: recalledFood ? hungerDrive * this.recallWeight : 0,
        shelter: wantsShelter ? this.shelterWeight * clamp01(stress / this.shelterStressSpan) : 0,
        followParent: followPull,
        seekMate: mateCandidate ? this.mateWeight : 0,
        rest: nearDanger ? 0 : this.restBias * (1 - Math.max(hunger, thirst)) * (2 - boldness),
        wander: this.wanderBias * boldness,
      };

      // Exploration overrides utilities occasionally; otherwise pick the best,
      // ties broken by a fixed action order (survival needs first).
      const action = roll < this.explorationRate * exploration ? 'wander' : argmaxUtility(utilities);

      entity.action = action;
      entity.utilityBreakdown = utilities;
      // The prey this predator has committed to — the hunting system reads it
      // to resolve capture attempts, and only ever reads it.
      entity.huntTargetId = action === 'chase' || action === 'stalk' ? prey.id : null;
      // seekMate, followParent, chase/stalk, and defend steer toward another
      // animal's position rather than a cell; herding steers at the group's
      // centre of mass, which is a position but nobody's in particular.
      const followed =
        action === 'seekMate'
          ? mateCandidate.candidate
          : action === 'followParent'
            ? guardian
            : action === 'chase' || action === 'stalk'
              ? prey
              : action === 'defend'
                ? threat
                : action === 'herd'
                  ? { ...social.centroid, heading: social.heading, drift }
                  : null;
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
                  : null;
      entity.actionTarget = target
        ? { cellX: target.cellX ?? Math.floor(target.x), cellY: target.cellY ?? Math.floor(target.y) }
        : null;
      // What to run away from: the predator if it can see one, otherwise the
      // place a neighbour's alarm said one was.
      const fleeFrom = threat ?? (alarmed ? entity.alarmSource : null);
      entity.moveIntent = this.#intentFor(action, entity, target, roll, candidateHeading, fleeFrom);
      // The animal this one is standing over, so the hunting system can read the
      // defense and an observer can see it. Owned here, like `huntTargetId`.
      entity.defendingId = action === 'defend' ? ward.id : null;
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
   * Only adults do this. A half-grown animal facing a stalker is not brave.
   *
   * @param {import('../world/World.js').World} world
   * @param {object} entity
   * @param {object|null} perceived
   */
  #wardToDefend(world, entity, perceived) {
    const threat = perceived?.nearestThreat ?? null;
    if (!threat) return null;
    if (entity.lifeStage !== 'adult' && entity.lifeStage !== 'senescent') return null;
    if (!Array.isArray(entity.offspring) || entity.offspring.length === 0) return null;

    const ownDistance = Math.hypot(entity.x - threat.x, entity.y - threat.y);
    let best = null;
    let bestDistance = Infinity;
    for (const childId of entity.offspring) {
      const child = world.entities.get(childId);
      if (!child || !child.alive || child.kind !== 'animal') continue;
      if (child.lifeStage !== 'juvenile') continue;
      const exposure = Math.hypot(child.x - threat.x, child.y - threat.y);
      if (exposure > this.defendRange || exposure >= ownDistance) continue;
      if (exposure < bestDistance) {
        bestDistance = exposure;
        best = child;
      }
    }
    return best;
  }

  /**
   * The remembered place of a kind most worth walking to right now, or null.
   * @param {object} entity @param {string} kind
   */
  #recall(entity, kind) {
    return bestRemembered(entity, kind, {
      x: entity.x,
      y: entity.y,
      maxDistance: this.recallRange,
      distanceWeight: this.recallDistanceWeight,
      dangerRadius: this.dangerRadius,
    });
  }

  /**
   * Utility of closing the gap to a perceived guardian: half the follow weight
   * as soon as the juvenile is out of contact range, ramping to full weight at
   * the edge of what it can perceive (beyond which the parent is simply lost).
   * @param {{distance: number}} guardian
   * @param {{radius: number}} perceived
   */
  #followUtility(guardian, perceived) {
    const span = Math.max(perceived.radius - this.followDistance, 1e-6);
    const drift = clamp01((guardian.distance - this.followDistance) / span);
    return this.followWeight * (0.5 + 0.5 * drift);
  }

  #intentFor(action, entity, target, roll, candidateHeading, fleeFrom) {
    switch (action) {
      case 'eat':
      case 'drink':
      case 'rest':
        // Stationary: keep a heading for facing, but do not move.
        return { heading: entity.moveIntent?.heading ?? candidateHeading, ttl: 0, moving: false, sprint: false };
      case 'flee': {
        // Straight away from the threat — or from wherever the alarm said it
        // was, for an animal that never saw it — at a sprint.
        const heading = Math.atan2(entity.y - fleeFrom.y, entity.x - fleeFrom.x);
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: true };
      }
      case 'defend': {
        // Toward the threat, but at a walk: this is interposing, not charging,
        // and an adult that arrives out of breath defends nothing.
        const heading = Math.atan2(target.y - entity.y, target.x - entity.x);
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: false };
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
        const cohesion = clamp01((target.drift - this.herdDistance) / Math.max(this.herdDistance, 1e-6));
        const heading =
          along === null
            ? toCentre
            : Math.atan2(
                cohesion * Math.sin(toCentre) + (1 - cohesion) * Math.sin(along),
                cohesion * Math.cos(toCentre) + (1 - cohesion) * Math.cos(along),
              );
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: false };
      }
      case 'seekFood':
      case 'seekWater':
      case 'seekMate':
      case 'followParent':
      case 'recallFood':
      case 'recallWater':
      case 'shelter':
      case 'stalk': {
        // Cell targets aim at the cell centre; a mate target carries an exact
        // position.
        const tx = target.x ?? target.cellX + 0.5;
        const ty = target.y ?? target.cellY + 0.5;
        const heading = Math.atan2(ty - entity.y, tx - entity.x);
        // Stalking closes at a walk — spending the sprint budget before the
        // prey is even in range is how a predator loses a chase.
        return { heading: normalizeAngle(heading), ttl: 1, moving: true, sprint: false };
      }
      case 'wander':
      default: {
        const intent = entity.moveIntent;
        if (!intent || !intent.moving || intent.ttl <= 0) {
          return {
            heading: candidateHeading,
            ttl: this.minCommitTicks + Math.floor(roll * this.commitTickSpan),
            moving: true,
            sprint: false,
          };
        }
        return {
          heading: normalizeAngle(intent.heading + (roll - 0.5) * this.wanderJitter),
          ttl: intent.ttl - 1,
          moving: true,
          sprint: false,
        };
      }
    }
  }
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
    'followParent',
    'seekMate',
    // Keeping up with the herd is discretionary — it loses to every real need,
    // which is what makes a hungry animal willing to graze its way out of the
    // group and a fed one drift back into it.
    'herd',
    'rest',
    'wander',
  ];
  let best = order[0];
  for (const action of order) {
    if (utilities[action] > utilities[best]) best = action;
  }
  return best;
}
