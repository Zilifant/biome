/**
 * Dominance, kinship, and contests (Step 23).
 *
 * Three things live here because they are all *judgements about a pair of
 * animals made at one instant*, and the systems that need them already own that
 * instant — the same convention as `killAnimal`, `recordMemory`, `applyInjury`,
 * `inheritGenome`, and `mateQuality`.
 *
 * **Dominance is derived, not stored.** There is no pecking order in state, no
 * remembered history of who beat whom — that is the "complex politics" this step
 * puts out of scope, and it would also be a per-pair structure, which invariant
 * 17 rules out. Instead an animal's dominance is read off what it *is* right
 * now: how big it is, how good a condition it is in, how hurt it is, and how
 * bold. Every one of those already matters elsewhere, so nothing here invents a
 * new axis of quality. The consequence is that dominance shifts as an animal
 * grows, starves, and heals, which is what you want: a rank you cannot lose by
 * being mauled is not a rank, it is a title.
 *
 * **Kin recognition** (§1.4 A15) is finally given a reader here. Step 15
 * deliberately left kinship out of the decaying spatial memories because
 * `parents` / `offspring` are already exact, already sparse, and already
 * persisted — a fading copy would have duplicated authoritative state for no
 * consumer. Defense is that consumer, and it reads the authoritative lists
 * directly. That is the whole mechanism: recognition is lineage, not a scent.
 *
 * **A fight is the escalation of a contest, not its default.** Two animals
 * compare; the weaker usually yields, because yielding is cheap and fighting is
 * not. Only when they are closely matched — when neither has an obvious reason
 * to back down — does it escalate, and then the loser (and sometimes the
 * winner) takes a real injury. That makes fights the second writer of injuries
 * (§1.4 A19), after failed hunts.
 */
import { applyInjury, InjuryKinds, MAX_INJURIES } from '../injury/injuries.js';

/** Injury kinds fights produce. Extends the Step 17 vocabulary. */
export const FightInjuryKinds = Object.freeze({
  /** Taken in a contest with a rival. */
  BATTLE: 'battle',
});

/**
 * How much weight an animal throws around, from state that already matters.
 *
 * Mass dominates (it is the thing a shoving match actually measures), scaled by
 * condition — a big starving animal loses to a smaller fed one — and by
 * boldness, since willingness to press a claim is part of winning it. Juveniles
 * and subadults are discounted hard: half-grown animals do not contest adults.
 *
 * Deterministic and side-effect free.
 *
 * @param {object} entity
 * @returns {number} a positive score; only comparisons between animals matter
 */
export function dominanceOf(entity) {
  if (!entity || entity.kind !== 'animal' || !entity.alive) return 0;
  const energy = entity.maxEnergy > 0 ? entity.energy / entity.maxEnergy : 0;
  const health = entity.maxHealth > 0 ? entity.health / entity.maxHealth : 0;
  const condition = 0.5 + 0.5 * (0.5 * energy + 0.5 * health);
  const sound = 1 - Math.min(1, Math.max(0, entity.impairment ?? 0));
  const boldness = entity.traits?.boldness ?? 1;
  const maturity = entity.lifeStage === 'adult' ? 1 : entity.lifeStage === 'senescent' ? 0.85 : 0.5;
  return Math.max(0, entity.bodyMass * condition * sound * boldness * maturity);
}

/**
 * Whether two animals are close kin — parent, offspring, or full/half sibling.
 *
 * Reads the authoritative lineage lists rather than any remembered or inferred
 * signal, and both are sparse (a handful of ids per lifetime), so this is a
 * couple of small array scans, never a lineage walk. Deliberately one
 * generation deep in each direction: grandparents and cousins would need the
 * tombstone registry, which is bounded at 256 (§1.4 A22) and would make the
 * answer depend on how recently someone died.
 *
 * @param {object} a @param {object} b
 * @returns {boolean}
 */
export function isKin(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.parents?.includes(b.id) || b.parents?.includes(a.id)) return true;
  const aParents = a.parents ?? [];
  const bParents = b.parents ?? [];
  for (const parent of aParents) {
    if (bParents.includes(parent)) return true; // shares a parent ⇒ sibling
  }
  return false;
}

/**
 * Resolve a contest between two animals.
 *
 * The stronger animal wins — this is not a coin flip, and the *odds are not
 * even reported*, because there are none: dominance decides it. What chance
 * governs is whether the loser simply yields or the two of them actually fight,
 * and that is highest when they are evenly matched. A rival twice your size is
 * not worth bleeding for.
 *
 * Fixed draw budget: **three** draws, always (escalation, loser wound, winner
 * wound), whatever the outcome, so the stream never shifts with the result.
 *
 * @param {object} a
 * @param {object} b
 * @param {import('../random/SeededRandom.js').SeededRandom} random the `social` stream
 * @param {object} options
 * @param {number} options.escalationChance chance an evenly-matched contest becomes a fight
 * @param {number} options.fightInjurySeverity severity of the loser's wound
 * @param {number} options.winnerInjuryFraction how much of that the winner also takes
 * @param {number} options.injuryHealthDamage health lost per unit of severity
 * @param {number} options.tick
 * @param {number} [options.maxInjuries]
 * @returns {{winner: object, loser: object, escalated: boolean, injured: number[]}}
 */
export function resolveContest(a, b, random, options) {
  const {
    escalationChance,
    fightInjurySeverity,
    winnerInjuryFraction,
    injuryHealthDamage,
    tick,
    maxInjuries = MAX_INJURIES,
  } = options;

  // Draw first, branch after (the fixed-budget rule).
  const escalationRoll = random.next();
  const loserRoll = random.next();
  const winnerRoll = random.next();

  const aScore = dominanceOf(a);
  const bScore = dominanceOf(b);
  // Ties go to the lower id, so two identical animals resolve deterministically.
  const aWins = aScore > bScore || (aScore === bScore && a.id < b.id);
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;

  // How closely matched they are, 0 (walkover) … 1 (dead heat). An outmatched
  // animal backs down; equals dig in.
  const total = aScore + bScore;
  const parity = total > 0 ? 1 - Math.abs(aScore - bScore) / total : 1;
  const escalated = escalationRoll < escalationChance * parity;

  const injured = [];
  if (escalated) {
    // The severity of what the loser takes scales with how hard it was pressed;
    // the winner takes a fraction of the same, because winning a fight is not
    // the same as being unhurt.
    const severity = fightInjurySeverity * (0.5 + 0.5 * parity);
    if (wound(loser, severity, loserRoll, injuryHealthDamage, tick, maxInjuries)) injured.push(loser.id);
    if (wound(winner, severity * winnerInjuryFraction, winnerRoll, injuryHealthDamage, tick, maxInjuries)) {
      injured.push(winner.id);
    }
  }
  return { winner, loser, escalated, injured };
}

/**
 * Apply a fight wound, scaled by an already-drawn roll so the caller owns the
 * draw budget. Returns whether anything actually landed.
 */
function wound(entity, severity, roll, injuryHealthDamage, tick, maxInjuries) {
  // The roll spreads severity across a range rather than gating it: a fight
  // that happened always costs something, it is only a question of how much.
  const scaled = severity * (0.5 + 0.5 * roll);
  const injury = applyInjury(entity, FightInjuryKinds.BATTLE, scaled, tick, maxInjuries);
  if (!injury) return false;
  entity.health = Math.max(0, entity.health - scaled * injuryHealthDamage);
  return true;
}

/** Re-exported so callers need one import for the injury vocabulary. */
export { InjuryKinds };
