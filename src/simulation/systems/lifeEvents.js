/**
 * Bounded per-entity life history (Step 13; deferred from Step 6, §1.4 A4).
 *
 * An entity keeps a short list of the significant things that happened to it —
 * born, birthed, weaned, dispersed, orphaned, died — so a single animal's life
 * can be read end to end in the inspector without the engine storing a
 * tick-by-tick history of every organism (observation roadmap, PLAN §10).
 *
 * The list is append-only through this one helper and hard-capped at
 * MAX_LIFE_EVENTS entries; the oldest entries fall off first. Like
 * `killAnimal` in death.js, this is a shared mutation helper rather than a
 * system: several systems record life events, and keeping the append and the
 * bound in one place is what makes the cap trustworthy.
 */

/**
 * Hard cap on retained life events per entity. A structural bound (it exists
 * to stop unbounded memory growth over long runs), not a tuning knob, so it
 * lives here rather than in the simulation config.
 */
export const MAX_LIFE_EVENTS = 12;

/** Life-event types recorded today. Consumers must tolerate unknown types. */
export const LifeEventTypes = Object.freeze({
  BORN: 'born', //           this animal was born (newborn's own record)
  BIRTHED: 'birthed', //     this animal produced an offspring
  WEANED: 'weaned', //       provisioning by the guardian ended
  DISPERSED: 'dispersed', // left the guardian at maturity
  ORPHANED: 'orphaned', //   the guardian died before independence
  DIED: 'died', //           carries the cause
});

/**
 * Append one life event to an entity's bounded history.
 * @param {object} entity
 * @param {number} tick
 * @param {string} type one of LifeEventTypes
 * @param {object} [data] small extra facts (e.g. { cause }, { entityId })
 */
export function recordLifeEvent(entity, tick, type, data = null) {
  if (!Array.isArray(entity.lifeEvents)) entity.lifeEvents = [];
  entity.lifeEvents.push(data ? { tick, type, ...data } : { tick, type });
  const overflow = entity.lifeEvents.length - MAX_LIFE_EVENTS;
  if (overflow > 0) entity.lifeEvents.splice(0, overflow);
}
