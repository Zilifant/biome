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
  // Sex (Step 22). Bulk-projected: it is one short string, fixed for life (so
  // it never dirties a delta after the entity is created), and it is what lets
  // the renderer show a herd's sexes at a glance — which is how mate choice
  // becomes something you can watch rather than only read about. `null` on
  // anything unsexed.
  'sex',
  // Herd label (Step 23). Bulk-projected because a herd you cannot see is not
  // a visible result: the renderer highlights the selected animal's group from
  // it. Just a number (or null), and it changes rarely, so it barely touches
  // delta size. Nothing about *who else* is in the group is projected — there
  // is no roster anywhere to project.
  'groupId',
  // Persistent-group membership (v33). The *record* beside the label above:
  // `groupId` is who this animal is standing with, `groupRecordId` is which
  // pride, clan or band it belongs to — an identity that survives the members
  // walking apart. `null` on anything unattached, which is most of the world.
  //
  // ⚠ **This was deliberately inspection-only until v33, and what changed is the
  // consumer rather than the field.** The standing test (§11) is "does it change
  // rarely, and does it matter for one animal at a time" — and the second half
  // stopped being true the moment a renderer wanted to outline *every* group on
  // the map at once. A layer over the whole world cannot be assembled from a
  // query about one animal: inspection answers "which pride is this lion in",
  // and "where is each pride" is a different question that only a bulk field can
  // answer. Same argument `diseaseState`, `elevation` and `flying` each made in
  // turn — a renderer cannot show what it cannot see.
  //
  // Cheap by construction, and cheaper than either of the last two bumps: one
  // small integer with exactly one writer (`GroupSystem`), changing only when an
  // animal joins, leaves, or its record dissolves — measured at ~107 membership
  // events per 6000-tick demo run after A64, against `flying`'s 8–24 ticks per
  // change. It is `null` for every entity in a world where nothing forms
  // records, so it dirties no delta it was not already dirtying.
  'groupRecordId',
  // Disease (Step 25). Bulk-projected because a symptomatic animal has to be
  // visible on the grid for an outbreak to be watchable at all — and because
  // the *incubating* value being projected too is the honest thing: the
  // protocol does not hide who is carrying it, the renderer simply cannot make
  // an animal look ill before it is.
  'diseaseState',
  // Dispersal (Step 26). One boolean, true for a bounded spell twice in a
  // lifetime at most, so it costs a delta nothing — and without it the step's
  // visible result is not visible: a juvenile walking out of its natal range
  // looks exactly like a juvenile wandering unless the protocol says which it
  // is. The *forage* drift is deliberately not here; it is a continuous number
  // that would dirty a delta for every animal every tick, and it is inspection
  // detail rather than something to draw.
  'dispersing',
  // Reproductive state (Step 30). Two booleans, bulk-projected for the reason
  // `diseaseState` is: a renderer that cannot see them cannot show them, and
  // "which females are carrying" and "who is in season" are the two facts that
  // make a rut and a calving season *watchable* rather than only inferable from
  // a birth several hundred ticks later. Both are derived on read from fields
  // the reproduction system already maintains every tick — no new state, and no
  // per-tick cost beyond the copy.
  //
  // ⚠ `seekingMate` is the *chooser's* state, so it is a female-side fact: the
  // engine deliberately leaves the seeking sex ready year-round (see
  // `mating/breeding.js`), which means a male marker would be permanently on
  // and say nothing. Named for what it is rather than for "rut", so the field
  // cannot be read as a claim the engine does not make.
  'gestating',
  'seekingMate',
  'action',
  'alive',
  // Carcass decay (Step 18). Bulk-projected because the renderer ramps the
  // carcass glyph from it; 0 on everything living.
  'decayStage',
  // Elevation (v31, phase T2). 0 on the ground, 1 up a tree — and on carcasses
  // as well as animals, because a cached kill is the state worth seeing most.
  //
  // Bulk-projected on the same argument `diseaseState` and `gestating` made:
  // **a renderer cannot show what it cannot see**, and "the leopard is in the
  // tree and the hyenas are underneath it" is the single most legible thing
  // this mechanism produces. Inspection-only would have made the one visible
  // consequence of the phase invisible.
  //
  // Cheap by construction: one small integer that changes rarely (an animal
  // goes up or comes down, not every tick) and is 0 for every entity in a world
  // with no climbing species, so it dirties no delta it was not already
  // dirtying.
  'elevation',
  // Flight (v32, phase F1). One boolean: whether this animal is on the wing.
  //
  // Projected on the same argument `elevation` made one version earlier — **a
  // renderer cannot show what it cannot see** — and the case is if anything
  // stronger here, because being airborne is the *only* outward sign of the
  // mechanism. A flying vulture is faster, sees further and pays less per unit of
  // travel, and every one of those is invisible on a grid; whether it is in the
  // air is not, and it is what makes "the birds are up" readable at a glance.
  //
  // ⚠ Cheap, but not free in the way `elevation` was: this changes more often
  // than an animal climbs a tree — a wander commitment carries it for 8–24 ticks —
  // so it dirties a delta on each transition. The measurement to watch is
  // therefore ground↔air transitions per animal per 1000 ticks, which is the same
  // number flicker is judged on (see `locomotion/flight.js`). False on every
  // entity in a world with no flying species, so it dirties nothing there.
  'flying',
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
  // Season and weather (Step 19): a handful of scalars, so both full snapshots
  // and deltas carry it whole rather than diffing it.
  if (data.environment) {
    snapshot.environment = { ...data.environment };
  }
  // Active local disturbances (Step 27): a bounded list of small records, so
  // both full snapshots and deltas carry it whole rather than diffing it — the
  // same call the environment block gets, and for the same reason. This is a
  // *list of circles*, not a per-cell layer, which is why it can ride in every
  // message where the territorial claim grid (§1.4 A36) cannot.
  if (data.disturbances) {
    snapshot.disturbances = data.disturbances.map((d) => ({ ...d }));
  }
  // Ground animals have worn (Step 28): only the cells deep enough to *be*
  // something, with a `revision` that moves when that set changes rather than
  // when wear does — so deltas carry it on the rare tick a trail forms or fades
  // and never on the constant ticks animals merely walk about.
  if (data.features) {
    snapshot.features = { revision: data.features.revision, cells: data.features.cells.map((c) => ({ ...c })) };
  }
  // Who holds each coarse claim cell (Step 24's ground, projected at last — A36,
  // v37). RLE row-major over the *claim* grid, which is `cellSize` world cells
  // across, and owner ids only: the freshness half of a claim is what the
  // mechanism runs on and is not a thing to draw.
  //
  // ⚠ This is the layer the disturbance note above says cannot ride in every
  // message, and what changed is the encoding rather than the judgement. A
  // per-*world*-cell claim layer could not; a coarse grid where almost every
  // cell is `0` compresses to a few dozen runs, and its ownership revision means
  // a delta carries it only when a boundary actually moves.
  if (data.territory) {
    snapshot.territory = {
      width: data.territory.width,
      height: data.territory.height,
      cellSize: data.territory.cellSize,
      revision: data.territory.revision,
      encoding: data.territory.encoding,
      runs: data.territory.runs.map((run) => [...run]),
    };
  }
  return snapshot;
}

/**
 * Decode a territory RLE projection into a flat row-major owner-id array.
 * @param {{runs: Array<[number, number]>}} territory
 * @returns {number[]}
 */
export function decodeTerritoryRuns(territory) {
  const owners = [];
  for (const [ownerId, count] of territory.runs) {
    for (let i = 0; i < count; i += 1) owners.push(ownerId);
  }
  return owners;
}

/** Re-encode a flat owner array into RLE runs (inverse of decodeTerritoryRuns). */
function encodeTerritoryRuns(owners) {
  const runs = [];
  if (owners.length === 0) return runs;
  let currentOwner = owners[0];
  let count = 0;
  for (const owner of owners) {
    if (owner === currentOwner) {
      count += 1;
    } else {
      runs.push([currentOwner, count]);
      currentOwner = owner;
      count = 1;
    }
  }
  runs.push([currentOwner, count]);
  return runs;
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
 * Sparse territory change list between two projections: `[cellIndex, ownerId]`
 * for every claim cell that changed hands.
 *
 * ⚠ **Gated on the ownership revision, and that gate is the feature.** A claim's
 * *strength* changes on every mark and every decay sweep and is not projected at
 * all, so the overwhelmingly common answer here is `null` — no territory block
 * on the delta, no bytes, no diff walked. Only a tick where a boundary actually
 * moved pays for the O(claim cells) comparison, and a claim grid is `cellSize²`
 * times smaller than the world.
 *
 * The base is **zeros** when the previous snapshot carried no territory or a
 * differently-shaped one, so a delta is always applicable to what it was built
 * against without a second message shape for the first one.
 *
 * @param {object | undefined} previousTerritory
 * @param {object | undefined} nextTerritory
 * @returns {{width: number, height: number, cellSize: number, revision: number,
 *            changes: Array<[number, number]>} | null}
 */
function diffTerritory(previousTerritory, nextTerritory) {
  if (!nextTerritory) return null;
  if (previousTerritory && previousTerritory.revision === nextTerritory.revision) return null;
  const nextOwners = decodeTerritoryRuns(nextTerritory);
  const sameShape =
    previousTerritory &&
    previousTerritory.width === nextTerritory.width &&
    previousTerritory.height === nextTerritory.height;
  const previousOwners = sameShape ? decodeTerritoryRuns(previousTerritory) : null;
  const changes = [];
  for (let i = 0; i < nextOwners.length; i += 1) {
    const before = previousOwners ? previousOwners[i] : 0;
    if (before !== nextOwners[i]) changes.push([i, nextOwners[i]]);
  }
  return {
    width: nextTerritory.width,
    height: nextTerritory.height,
    cellSize: nextTerritory.cellSize,
    revision: nextTerritory.revision,
    changes,
  };
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
  if (next.environment) {
    delta.environment = { ...next.environment };
  }
  // Carried whenever the producer supplies it — including as an empty list,
  // which is the message that everything has stopped. Omitting it when empty
  // would leave a renderer drawing a fire that went out.
  if (next.disturbances) {
    delta.disturbances = next.disturbances.map((d) => ({ ...d }));
  }
  // Revision-gated, exactly as vegetation is: an unchanged feature set costs a
  // delta nothing at all, which matters because this layer is *written* every
  // tick even though it rarely changes what it means.
  if (next.features && next.features.revision !== previous.features?.revision) {
    delta.features = { revision: next.features.revision, cells: next.features.cells.map((c) => ({ ...c })) };
  }
  const territory = diffTerritory(previous.territory, next.territory);
  if (territory) {
    delta.territory = territory;
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
  // Season and weather ride whole on the delta, so the reconstruction simply
  // takes the newer one (falling back to the base when a delta omits it).
  if (delta.environment || fullSnapshot.environment) {
    reconstructed.environment = { ...(delta.environment ?? fullSnapshot.environment) };
  }
  // Disturbances likewise. `??` rather than `||` deliberately: an empty array is
  // falsy-adjacent enough to invite the bug where a delta saying "nothing is
  // burning any more" is discarded in favour of the base snapshot's fire.
  const disturbances = delta.disturbances ?? fullSnapshot.disturbances;
  if (disturbances) {
    reconstructed.disturbances = disturbances.map((d) => ({ ...d }));
  }
  // Features persist from the base snapshot when a delta omits them, which is
  // the common case — the revision gate means "omitted" states that nothing
  // formed or faded, not that there is nothing there.
  const features = delta.features ?? fullSnapshot.features;
  if (features) {
    reconstructed.features = { revision: features.revision, cells: features.cells.map((c) => ({ ...c })) };
  }
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
  // Territory: the same shape as vegetation one step coarser. A delta that omits
  // it says no cell changed hands, so the base carries forward untouched — which
  // is the common case by a wide margin.
  if (fullSnapshot.territory || delta.territory) {
    const base = fullSnapshot.territory ?? null;
    const shape = delta.territory ?? base;
    const sameShape = base && shape.width === base.width && shape.height === base.height;
    const owners = sameShape ? decodeTerritoryRuns(base) : new Array(shape.width * shape.height).fill(0);
    if (delta.territory) {
      for (const [index, ownerId] of delta.territory.changes) {
        owners[index] = ownerId;
      }
    }
    reconstructed.territory = {
      width: shape.width,
      height: shape.height,
      cellSize: shape.cellSize,
      revision: shape.revision,
      encoding: base?.encoding ?? 'rle-row-major',
      runs: encodeTerritoryRuns(owners),
    };
  }
  return reconstructed;
}
