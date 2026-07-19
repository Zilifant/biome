/**
 * Injuries (Step 17) — bounded, healing damage.
 *
 * An animal that survives something bad carries it for a while. Each injury
 * has a severity that fades as it heals, and while it lasts it makes the
 * animal slower and a less effective feeder — which in turn makes it easier to
 * catch, because the hunting system already reads prey condition. That loop is
 * the point: predation stops being instant-death-or-nothing and grows a middle
 * ground where a mauled grazer limps, eats badly, and is likelier to be caught
 * next time — or heals and gets away with it.
 *
 * `impairment` is the derived total (0 = unhurt, 1 = crippled), kept on the
 * entity so the movement and feeding systems can read one number in their hot
 * loops instead of walking the list every tick. It is recomputed here, in the
 * one place injuries are added or healed, so it can never drift.
 *
 * Like `recordMemory` and `recordLifeEvent`, inflicting is a shared helper
 * rather than a system: hunts, and later hazards and fights, all injure, and
 * keeping the append, the cap, and the derived total together is what makes
 * them trustworthy.
 */

/** Where an injury came from. Consumers must tolerate unknown kinds. */
export const InjuryKinds = Object.freeze({
  WOUND: 'wound', // clawed or bitten in a failed capture
  TRAMPLE: 'trample', // hurt by the animal it attacked
});

/** Hard cap on tracked injuries per animal. Structural, not a tuning knob. */
export const MAX_INJURIES = 4;

/** Severity at or below which an injury is considered healed and dropped. */
export const HEALED_BELOW = 0.02;

/**
 * Total severity across an animal's injuries, clamped to 1.
 * @param {object} entity
 * @returns {number} 0 (unhurt) … 1 (crippled)
 */
export function totalSeverity(entity) {
  const injuries = entity.injuries;
  if (!Array.isArray(injuries) || injuries.length === 0) return 0;
  let sum = 0;
  for (const injury of injuries) sum += injury.severity;
  return sum > 1 ? 1 : sum;
}

/**
 * Recompute the cached impairment total. Call after any change to the list.
 * @param {object} entity
 */
export function refreshImpairment(entity) {
  entity.impairment = totalSeverity(entity);
  return entity.impairment;
}

/**
 * Wound an animal. Returns the stored injury, or null if the severity was too
 * small to matter.
 *
 * When the list is full the new damage is folded into the *least* severe
 * existing injury rather than dropped — an animal that keeps getting hurt
 * should keep getting worse, and silently discarding damage at the cap would
 * make a badly mauled animal indistinguishable from a lightly scratched one.
 *
 * @param {object} entity
 * @param {string} kind one of InjuryKinds
 * @param {number} severity 0…1
 * @param {number} tick
 * @param {number} [maxInjuries]
 * @returns {object | null}
 */
export function applyInjury(entity, kind, severity, tick, maxInjuries = MAX_INJURIES) {
  if (!(severity > HEALED_BELOW)) return null;
  if (!Array.isArray(entity.injuries)) entity.injuries = [];
  const injuries = entity.injuries;

  let stored;
  if (injuries.length < maxInjuries) {
    stored = { kind, severity, tick };
    injuries.push(stored);
  } else {
    let weakest = injuries[0];
    for (const injury of injuries) {
      if (injury.severity < weakest.severity) weakest = injury;
    }
    weakest.severity = Math.min(1, weakest.severity + severity);
    weakest.tick = tick;
    stored = weakest;
  }
  refreshImpairment(entity);
  return stored;
}
