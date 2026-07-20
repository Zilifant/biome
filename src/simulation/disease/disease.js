/**
 * Disease (Step 25) — a compartmental model, and one deliberate choice inside it.
 *
 * The compartments are the classic ones, with an important twist:
 *
 *   susceptible → incubating → symptomatic → recovered → (susceptible)
 *                      │              │
 *                      └──────────────┴──→ dead
 *
 * **An incubating animal is infectious and looks perfectly healthy.** That is
 * the choice, and everything interesting about this step follows from it. If
 * only visibly sick animals could transmit, avoidance would be a complete
 * defence and an outbreak would be a non-event — the herd would simply shun the
 * one sick animal and carry on. Because the disease travels ahead of its own
 * symptoms, avoidance is *late* by construction: by the time a herd can see who
 * is ill, it has already been standing next to them for a hundred ticks. That
 * is what makes density a real cost of the sociality Step 23 added, which is
 * exactly the pressure the plan asks this step to supply.
 *
 * **Immunity wanes.** Permanent immunity in a population that turns over every
 * few thousand ticks would mean one outbreak and then nothing, forever. A
 * finite immune period lets the disease come back once enough susceptibles have
 * been born or forgotten, which is what makes it a standing pressure rather
 * than a single event in the demo's history.
 *
 * Like `applyInjury` and `recordMemory`, the state transitions live in a shared
 * helper rather than being scattered: `DiseaseSystem` owns the schedule, but
 * `infect` is called from one place and the derived severity is computed in
 * one place, so the compartments cannot drift apart from their effects.
 */

/** The compartments. Consumers must tolerate unknown values. */
export const DiseaseStates = Object.freeze({
  SUSCEPTIBLE: 'susceptible',
  /** Carrying it, spreading it, and showing nothing. */
  INCUBATING: 'incubating',
  /** Visibly ill: slower, feeding badly, infertile, and avoided. */
  SYMPTOMATIC: 'symptomatic',
  /** Immune, for a while. */
  RECOVERED: 'recovered',
});

/** States in which an animal can pass the disease on. */
export function isInfectious(entity) {
  return entity?.diseaseState === DiseaseStates.INCUBATING || entity?.diseaseState === DiseaseStates.SYMPTOMATIC;
}

/** States in which an animal visibly has it — the only ones others can react to. */
export function isSymptomatic(entity) {
  return entity?.diseaseState === DiseaseStates.SYMPTOMATIC;
}

/** Whether this animal can currently be infected at all. */
export function isSusceptible(entity) {
  return entity?.diseaseState === DiseaseStates.SUSCEPTIBLE;
}

/**
 * How badly the disease is impairing this animal, 0…1.
 *
 * Derived from the compartment rather than stored, for the same reason
 * dominance is (Step 23): a value computed from the state cannot drift out of
 * step with it. Incubating animals are unaffected — that is what "looks
 * healthy" means — and symptomatic ones are impaired at a fixed severity, which
 * the movement and feeding systems read alongside injury `impairment`.
 *
 * @param {object} entity
 * @param {number} [symptomSeverity]
 * @returns {number}
 */
export function diseaseSeverity(entity, symptomSeverity = 0.5) {
  return isSymptomatic(entity) ? symptomSeverity : 0;
}

/**
 * Infect an animal, if it can be infected.
 *
 * @param {object} entity
 * @param {number} tick
 * @param {number} incubationTicks
 * @returns {boolean} whether it took
 */
export function infect(entity, tick, incubationTicks) {
  if (!isSusceptible(entity)) return false;
  entity.diseaseState = DiseaseStates.INCUBATING;
  entity.diseaseSince = tick;
  entity.diseaseUntil = tick + incubationTicks;
  return true;
}

/**
 * Move an animal into the recovered (immune) compartment.
 * @param {object} entity @param {number} tick @param {number} immunityTicks
 */
export function recover(entity, tick, immunityTicks) {
  entity.diseaseState = DiseaseStates.RECOVERED;
  entity.diseaseSince = tick;
  entity.diseaseUntil = tick + immunityTicks;
}

/** Return an animal to the susceptible pool (immunity lapsed). */
export function clearImmunity(entity, tick) {
  entity.diseaseState = DiseaseStates.SUSCEPTIBLE;
  entity.diseaseSince = tick;
  entity.diseaseUntil = null;
}
