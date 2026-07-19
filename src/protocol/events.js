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
