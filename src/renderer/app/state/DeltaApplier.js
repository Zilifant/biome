/**
 * Pure delta application over the renderer's normalized entity map.
 *
 * The renderer never computes ecological outcomes: applying a delta is pure
 * bookkeeping of what the authoritative simulation reported. The only
 * renderer-owned annotation added here is `previousPosition`, kept so an
 * optional interpolating renderer can be added later without touching the
 * protocol or the authoritative data.
 */

/**
 * Check a delta against the current entity map WITHOUT mutating anything.
 * Unknown updated/removed ids mean the store missed a delta and is
 * desynchronized.
 *
 * @param {Map<number, object>} entities
 * @param {{updated: object[], removed: number[]}} delta
 * @returns {{missingUpdated: number[], missingRemoved: number[]}}
 */
export function findMissingDeltaEntities(entities, delta) {
  return {
    missingUpdated: delta.updated.filter((entity) => !entities.has(entity.id)).map((entity) => entity.id),
    missingRemoved: delta.removed.filter((entityId) => !entities.has(entityId)),
  };
}

/**
 * Apply a validated delta to the entity map (mutates the map).
 * @param {Map<number, object>} entities
 * @param {{created: object[], updated: object[], removed: number[]}} delta
 * @returns {{created: number, updated: number, removed: number}}
 */
export function applyDeltaToEntities(entities, delta) {
  for (const entityId of delta.removed) {
    entities.delete(entityId);
  }
  for (const entity of delta.created) {
    entities.set(entity.id, { ...entity });
  }
  for (const entity of delta.updated) {
    const before = entities.get(entity.id);
    const record = { ...entity };
    if (before) {
      record.previousPosition = { x: before.x, y: before.y };
    }
    entities.set(entity.id, record);
  }
  return {
    created: delta.created.length,
    updated: delta.updated.length,
    removed: delta.removed.length,
  };
}
