/**
 * Lineage across removal (Step 18) — the answer to §1.4 ⚠ C2.
 *
 * Until carcasses started disappearing, nothing was ever removed from the
 * world, so every `parents` / `offspring` / `guardianId` reference trivially
 * resolved and "parentage references remain valid" was a free invariant. Once
 * a carcass decays away that stops being true, and the choice is between
 * pretending otherwise and being honest about it.
 *
 * The policy is: **be honest, with a memory**. Every removal leaves a bounded
 * tombstone — who it was, what killed it, when — and lineage lookups report one
 * of four states rather than a bare null:
 *
 *   alive     — the entity is still walking around
 *   carcass   — dead, but its body is still in the world
 *   dead      — gone, but we remember it existed and what killed it
 *   forgotten — gone long enough that the tombstone was evicted
 *
 * `forgotten` is the important one: it is a *stated* limit rather than a lookup
 * that silently fails. A test asserting "no dangling references" would pass
 * vacuously once everything is forgotten, so the tests assert the reported
 * status is *accurate* instead — an id that resolves to a live entity must
 * never be reported dead, and vice versa.
 *
 * Behaviourally nothing here is load-bearing: the parenting, hunting, and
 * reproduction systems already tolerated a missing referent before this step
 * (an orphaned juvenile, an abandoned chase, a birth with one parent gone).
 * This exists so an *observer* can still read a family tree.
 */

/** What a lineage reference resolves to. */
export const LineageStatus = Object.freeze({
  ALIVE: 'alive',
  CARCASS: 'carcass',
  DEAD: 'dead',
  FORGOTTEN: 'forgotten',
});

/** How many of the recently dead the world remembers. Structural bound. */
export const MAX_TOMBSTONES = 256;

/**
 * Remember an entity that is being removed from the world. Called from the one
 * place removals are flushed, so no removal path can skip it.
 *
 * @param {import('./World.js').World} world
 * @param {object} entity the entity being removed
 * @param {number} tick
 * @param {number} [maxTombstones]
 */
export function recordTombstone(world, entity, tick, maxTombstones = MAX_TOMBSTONES) {
  const tombstones = world.tombstones;
  tombstones.set(entity.id, {
    id: entity.id,
    speciesId: entity.speciesId,
    cause: entity.deathCause ?? null,
    diedTick: entity.diedTick ?? null,
    removedTick: tick,
  });
  // Insertion-ordered Map: the oldest key is the first one out.
  while (tombstones.size > maxTombstones) {
    const oldest = tombstones.keys().next();
    if (oldest.done) break;
    tombstones.delete(oldest.value);
  }
}

/**
 * Resolve one lineage reference to a status the caller can act on or display.
 *
 * @param {import('./World.js').World} world
 * @param {number} id
 * @returns {{id: number, status: string, speciesId?: string, cause?: string|null, diedTick?: number|null}}
 */
export function lookupLineage(world, id) {
  const entity = world.entities.get(id);
  if (entity) {
    return {
      id,
      status: entity.alive ? LineageStatus.ALIVE : LineageStatus.CARCASS,
      speciesId: entity.speciesId,
    };
  }
  const tombstone = world.tombstones.get(id);
  if (tombstone) {
    return {
      id,
      status: LineageStatus.DEAD,
      speciesId: tombstone.speciesId,
      cause: tombstone.cause,
      diedTick: tombstone.diedTick,
    };
  }
  return { id, status: LineageStatus.FORGOTTEN };
}

/**
 * Resolve a list of ids (a `parents` or `offspring` array) for inspection.
 * @param {import('./World.js').World} world
 * @param {number[]} ids
 */
export function lookupLineageList(world, ids) {
  return ids.map((id) => lookupLineage(world, id));
}
