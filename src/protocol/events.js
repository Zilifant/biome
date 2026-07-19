/**
 * Domain event contract.
 *
 * Events describe simulation facts ("an entity died"), never presentation
 * ("play death animation"). Glyphs, colors, sounds, and animations are the
 * renderer's own mapping from these facts.
 *
 * Every event has: { seq, tick, type, ...payload }. `seq` is a global,
 * gap-free sequence number; consumers use it to request "events since".
 */
import { PROTOCOL_VERSION } from './protocolVersion.js';

export const EventTypes = Object.freeze({
  ENTITY_CREATED: 'entity.created', // { entityId, kind, speciesId, x, y }
  ENTITY_MOVED: 'entity.moved', //     { entityId, from: {x, y}, to: {x, y} }
  ENTITY_DIED: 'entity.died', //       { entityId, cause }
  ENTITY_REMOVED: 'entity.removed', // { entityId }
  ENTITY_FED: 'entity.fed', //         { entityId, cell: {cellX, cellY}, amount }
  ENTITY_MATED: 'entity.mated', //     { entityId, partnerId, gestationUntil }
  ENTITY_BORN: 'entity.born', //       { entityId, parents: [id, id] }
  ENTITY_PROVISIONED: 'entity.provisioned', // { entityId, guardianId, amount }
  // Predation (Step 16). `entity.hunted` reports one capture attempt and the
  // odds it was made at, so an observer can see that a hunt is resolved from
  // the two animals' state rather than a flat roll; `escaped` and `killed`
  // report which way it went (a kill also emits `entity.died` with cause
  // `predation`).
  ENTITY_HUNTED: 'entity.hunted', //   { entityId, targetId, chance, captured }
  ENTITY_ESCAPED: 'entity.escaped', // { entityId, predatorId }
  ENTITY_KILLED: 'entity.killed', //   { entityId, predatorId }
  // Injury (Step 17). A wound that does not kill still costs the animal speed,
  // feeding, and — because hunting reads condition — safety.
  ENTITY_INJURED: 'entity.injured', //     { entityId, injury, severity, sourceId }
  ENTITY_RECOVERED: 'entity.recovered', // { entityId, injury }
  // Decay (Step 18). A carcass announces each stage it passes through; when it
  // is finally gone the usual `entity.removed` follows.
  ENTITY_DECAYED: 'entity.decayed', // { entityId, stage, stageName, edibleMass }
  // A milestone in one animal's life history. `event` is a life-event type
  // (weaned | dispersed | orphaned); consumers must tolerate unknown ones.
  ENTITY_LIFE_EVENT: 'entity.lifeEvent', //    { entityId, event, guardianId }
});

/**
 * Wrap a list of domain events in a versioned batch message.
 * @param {object[]} events
 * @param {object} [meta]
 * @param {string|null} [meta.simulationId]
 * @param {number|null} [meta.tick] tick at which the batch was produced
 */
export function buildEventBatch(events, { simulationId = null, tick = null } = {}) {
  const cloned = events.map((event) => structuredClone(event));
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'events.batch',
    simulationId,
    tick,
    firstSeq: cloned.length > 0 ? cloned[0].seq : null,
    lastSeq: cloned.length > 0 ? cloned[cloned.length - 1].seq : null,
    events: cloned,
  };
}
