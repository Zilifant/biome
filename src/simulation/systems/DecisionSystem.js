/**
 * Utility-based action selection (Step 8).
 *
 * Each tick, every living animal scores a small fixed set of candidate actions
 * from its hunger and perception, then commits to the best one. This replaces
 * the random wander that used to live in the movement system: decisions choose
 * WHAT to do and set the movement intent; the movement system merely executes
 * it. Actions:
 *   - eat      — standing on a food cell (consumption itself is Step 9)
 *   - seekFood — food perceived nearby; head toward it (subsumes "approach")
 *   - rest     — stay put (attractive when satiated)
 *   - wander   — undirected exploration with a committed heading
 *
 * Runs in the `decision` phase (after perception, before movement). Ownership:
 * writes `action`, `actionTarget`, `utilityBreakdown`, and `moveIntent`; reads
 * `world.perception`, physiology, and vegetation. Determinism: exactly two
 * draws per animal per tick on the `decision` stream (an exploration/tiebreak
 * roll and a candidate wander heading), regardless of which action wins.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { isReproductivelyReady } from './ReproductionSystem.js';

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
      const onFood = world.vegetation.levelAt(cellX, cellY) >= this.foodMinLevel;
      const nearestFood = perceived?.nearestFood ?? null;
      const nearestWater = perceived?.nearestWater ?? null;
      const atWater = nearestWater !== null && nearestWater.distance <= this.drinkRange;
      // A perceived conspecific is a mate candidate when this animal is ready;
      // whether the pair actually mates is the reproduction system's call.
      const nearestAnimal = perceived?.nearestAnimal ?? null;
      const mateCandidate =
        nearestAnimal && nearestAnimal.speciesId === entity.speciesId && isReproductivelyReady(entity, context.tick, this.reproduction)
          ? nearestAnimal
          : null;

      const utilities = {
        drink: atWater ? this.drinkBias + this.thirstWeight * thirst : 0,
        seekWater: nearestWater && !atWater ? this.thirstWeight * thirst : 0,
        eat: onFood ? this.eatBias + this.hungerWeight * hunger : 0,
        seekFood: nearestFood && !onFood ? this.hungerWeight * hunger : 0,
        seekMate: mateCandidate ? this.mateWeight : 0,
        rest: this.restBias * (1 - Math.max(hunger, thirst)),
        wander: this.wanderBias,
      };

      // Exploration overrides utilities occasionally; otherwise pick the best,
      // ties broken by a fixed action order (survival needs first).
      const action = roll < this.explorationRate ? 'wander' : argmaxUtility(utilities);

      entity.action = action;
      entity.utilityBreakdown = utilities;
      // seekMate steers toward another animal's position rather than a cell.
      const target =
        action === 'seekFood'
          ? nearestFood
          : action === 'seekWater'
            ? nearestWater
            : action === 'seekMate'
              ? { cellX: Math.floor(mateCandidate.x), cellY: Math.floor(mateCandidate.y), x: mateCandidate.x, y: mateCandidate.y }
              : null;
      entity.actionTarget = target ? { cellX: target.cellX, cellY: target.cellY } : null;
      entity.moveIntent = this.#intentFor(action, entity, target, roll, candidateHeading);
    }
  }

  #intentFor(action, entity, target, roll, candidateHeading) {
    switch (action) {
      case 'eat':
      case 'drink':
      case 'rest':
        // Stationary: keep a heading for facing, but do not move.
        return { heading: entity.moveIntent?.heading ?? candidateHeading, ttl: 0, moving: false };
      case 'seekFood':
      case 'seekWater':
      case 'seekMate': {
        // Cell targets aim at the cell centre; a mate target carries an exact
        // position.
        const tx = target.x ?? target.cellX + 0.5;
        const ty = target.y ?? target.cellY + 0.5;
        const heading = Math.atan2(ty - entity.y, tx - entity.x);
        return { heading: normalizeAngle(heading), ttl: 1, moving: true };
      }
      case 'wander':
      default: {
        const intent = entity.moveIntent;
        if (!intent || !intent.moving || intent.ttl <= 0) {
          return { heading: candidateHeading, ttl: this.minCommitTicks + Math.floor(roll * this.commitTickSpan), moving: true };
        }
        return { heading: normalizeAngle(intent.heading + (roll - 0.5) * this.wanderJitter), ttl: intent.ttl - 1, moving: true };
      }
    }
  }
}

/** Highest-utility action; ties broken by a fixed, deterministic order. */
function argmaxUtility(utilities) {
  const order = ['drink', 'eat', 'seekWater', 'seekFood', 'seekMate', 'rest', 'wander'];
  let best = order[0];
  for (const action of order) {
    if (utilities[action] > utilities[best]) best = action;
  }
  return best;
}
