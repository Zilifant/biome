/**
 * Snapshot and delta contract.
 *
 * A full snapshot is the complete externally-visible state at one tick. A
 * delta describes the change between two consecutive snapshot points plus
 * the domain events emitted in between. Entities in snapshots expose ONLY
 * the fields in PUBLIC_ENTITY_FIELDS — internal engine records never leak,
 * and snapshot consumers can mutate what they receive freely.
 *
 * This first version favors correctness over compression: `updated` entries
 * are complete public entity objects, not field patches.
 */
import { PROTOCOL_VERSION } from './protocolVersion.js';

export const SnapshotKinds = Object.freeze({
  FULL: 'snapshot.full',
  DELTA: 'snapshot.delta',
});

export const PUBLIC_ENTITY_FIELDS = Object.freeze([
  'id',
  'kind',
  'speciesId',
  'x',
  'y',
  'heading',
  'age',
  'energyFraction',
  'hydrationFraction',
  'bodyMass',
  'healthFraction',
  'lifeStage',
  'action',
  'alive',
]);

function cloneEntity(entity) {
  const cloned = {};
  for (const field of PUBLIC_ENTITY_FIELDS) {
    cloned[field] = entity[field];
  }
  return cloned;
}

function entityChanged(a, b) {
  for (const field of PUBLIC_ENTITY_FIELDS) {
    if (a[field] !== b[field]) return true;
  }
  return false;
}

/**
 * Build a full snapshot message from engine snapshot data
 * (see SimulationEngine#getSnapshotData).
 *
 * @param {{simulationId: string, tick: number, lastEventSeq: number,
 *          world: {width: number, height: number}, entities: object[]}} data
 */
export function buildFullSnapshot(data) {
  const snapshot = {
    protocolVersion: PROTOCOL_VERSION,
    kind: SnapshotKinds.FULL,
    simulationId: data.simulationId,
    tick: data.tick,
    lastEventSeq: data.lastEventSeq,
    world: { width: data.world.width, height: data.world.height },
    entities: data.entities.map(cloneEntity),
  };
  // Terrain is static: carried by full snapshots (and the terrain query), never
  // by deltas. Cloned so each snapshot owns its terrain (the engine memoizes a
  // single projection and shares it by reference); no internal Uint8Array
  // leaks. Omitted when the producer supplies none.
  if (data.terrain) {
    snapshot.terrain = structuredClone(data.terrain);
  }
  // Vegetation biomass, quantized to integer levels and RLE-encoded. Carried in
  // full by full snapshots; deltas carry only changed cells (see below).
  if (data.vegetation) {
    snapshot.vegetation = structuredClone(data.vegetation);
  }
  return snapshot;
}

/**
 * Decode a vegetation RLE projection into a flat row-major level array.
 * @param {{runs: Array<[number, number]>}} vegetation
 * @returns {number[]}
 */
export function decodeVegetationRuns(vegetation) {
  const levels = [];
  for (const [level, count] of vegetation.runs) {
    for (let i = 0; i < count; i += 1) levels.push(level);
  }
  return levels;
}

/**
 * Re-encode a flat level array into RLE runs (inverse of decodeVegetationRuns).
 * @param {number[]} levels
 * @returns {Array<[number, number]>}
 */
function encodeVegetationRuns(levels) {
  const runs = [];
  if (levels.length === 0) return runs;
  let currentLevel = levels[0];
  let count = 0;
  for (const level of levels) {
    if (level === currentLevel) {
      count += 1;
    } else {
      runs.push([currentLevel, count]);
      currentLevel = level;
      count = 1;
    }
  }
  runs.push([currentLevel, count]);
  return runs;
}

/**
 * Sparse vegetation change list between two projections: [cellIndex, newLevel]
 * for every cell whose quantized level changed. Uses the revision stamp to skip
 * the O(cells) diff entirely when biomass did not change since the base.
 * @param {object} previousVegetation
 * @param {object} nextVegetation
 * @returns {{revision: number, changes: Array<[number, number]>} | null}
 */
function diffVegetation(previousVegetation, nextVegetation) {
  if (!nextVegetation) return null;
  if (previousVegetation && previousVegetation.revision === nextVegetation.revision) {
    return { revision: nextVegetation.revision, changes: [] };
  }
  const nextLevels = decodeVegetationRuns(nextVegetation);
  const previousLevels = previousVegetation ? decodeVegetationRuns(previousVegetation) : null;
  const changes = [];
  for (let i = 0; i < nextLevels.length; i += 1) {
    if (!previousLevels || previousLevels[i] !== nextLevels[i]) {
      changes.push([i, nextLevels[i]]);
    }
  }
  return { revision: nextVegetation.revision, changes };
}

/**
 * Diff two full snapshots of the same simulation into a delta.
 * @param {ReturnType<typeof buildFullSnapshot>} previous
 * @param {ReturnType<typeof buildFullSnapshot>} next
 * @param {object[]} [events] domain events with previous.lastEventSeq < seq <= next.lastEventSeq
 */
export function buildDeltaSnapshot(previous, next, events = []) {
  if (previous.simulationId !== next.simulationId) {
    throw new Error('cannot build a delta between snapshots of different simulations');
  }
  const previousById = new Map(previous.entities.map((entity) => [entity.id, entity]));
  const created = [];
  const updated = [];
  const removed = [];
  const nextIds = new Set();
  for (const entity of next.entities) {
    nextIds.add(entity.id);
    const before = previousById.get(entity.id);
    if (!before) {
      created.push(cloneEntity(entity));
    } else if (entityChanged(before, entity)) {
      updated.push(cloneEntity(entity));
    }
  }
  for (const entity of previous.entities) {
    if (!nextIds.has(entity.id)) removed.push(entity.id);
  }
  const delta = {
    protocolVersion: PROTOCOL_VERSION,
    kind: SnapshotKinds.DELTA,
    simulationId: next.simulationId,
    baseTick: previous.tick,
    tick: next.tick,
    created,
    updated,
    removed,
    events: events.map((event) => structuredClone(event)),
    lastEventSeq: next.lastEventSeq,
  };
  const vegetation = diffVegetation(previous.vegetation, next.vegetation);
  if (vegetation) {
    delta.vegetation = vegetation;
  }
  return delta;
}

/**
 * Reference implementation of delta application, for renderers and tests:
 * applying a delta to the full snapshot it was based on reproduces the next
 * full snapshot exactly.
 *
 * @param {ReturnType<typeof buildFullSnapshot>} fullSnapshot
 * @param {ReturnType<typeof buildDeltaSnapshot>} delta
 */
export function applyDeltaSnapshot(fullSnapshot, delta) {
  if (fullSnapshot.simulationId !== delta.simulationId) {
    throw new Error('delta belongs to a different simulation');
  }
  if (fullSnapshot.tick !== delta.baseTick) {
    throw new Error(`delta base tick ${delta.baseTick} does not match snapshot tick ${fullSnapshot.tick}`);
  }
  const removed = new Set(delta.removed);
  const updatedById = new Map(delta.updated.map((entity) => [entity.id, entity]));
  const entities = [];
  for (const entity of fullSnapshot.entities) {
    if (removed.has(entity.id)) continue;
    entities.push(cloneEntity(updatedById.get(entity.id) ?? entity));
  }
  for (const entity of delta.created) {
    entities.push(cloneEntity(entity));
  }
  const reconstructed = {
    protocolVersion: PROTOCOL_VERSION,
    kind: SnapshotKinds.FULL,
    simulationId: fullSnapshot.simulationId,
    tick: delta.tick,
    lastEventSeq: delta.lastEventSeq,
    world: { ...fullSnapshot.world },
    entities,
  };
  // Terrain is static and not carried by deltas, so it persists from the base
  // snapshot unchanged. Carrying it forward makes applying a delta reproduce
  // the next full snapshot exactly.
  if (fullSnapshot.terrain) {
    reconstructed.terrain = structuredClone(fullSnapshot.terrain);
  }
  // Vegetation: start from the base levels and apply the delta's changed cells,
  // then re-encode. Reproduces the next snapshot's vegetation exactly.
  if (fullSnapshot.vegetation) {
    const base = fullSnapshot.vegetation;
    const levels = delta.vegetation ? decodeVegetationRuns(base) : null;
    if (levels && delta.vegetation.changes.length > 0) {
      for (const [index, level] of delta.vegetation.changes) {
        levels[index] = level;
      }
    }
    reconstructed.vegetation = {
      width: base.width,
      height: base.height,
      maxLevel: base.maxLevel,
      revision: delta.vegetation ? delta.vegetation.revision : base.revision,
      encoding: base.encoding,
      runs: levels ? encodeVegetationRuns(levels) : structuredClone(base.runs),
    };
  }
  return reconstructed;
}
