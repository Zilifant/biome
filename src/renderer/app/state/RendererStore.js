/**
 * Renderer-local normalized store of authoritative simulation output.
 *
 * The store holds a PROJECTION of what the simulation reported — full
 * snapshots replace it, deltas update it, domain events append to a bounded
 * buffer. It never invents biological state, never advances simulation
 * time, and never mutates authoritative values (entity records are cloned
 * on ingest; positions are stored as the raw floats the protocol sent).
 *
 * Desync policy: a delta whose baseTick does not match the current tick, or
 * that references unknown entities, throws StoreDesyncError — the caller
 * must recover by requesting a fresh full snapshot, never by guessing.
 * Deltas older than the current tick are ignored as stale (e.g. after a
 * reconnect + snapshot replaced state mid-stream).
 */
import { findMissingDeltaEntities, applyDeltaToEntities } from './DeltaApplier.js';

/** The protocol version this renderer understands. */
export const SUPPORTED_PROTOCOL_VERSION = 13;

/** Fatal contract problems (wrong version, malformed message). */
export class RendererProtocolError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RendererProtocolError';
    this.code = code;
  }
}

/** Recoverable stream problems: request a full snapshot to resynchronize. */
export class StoreDesyncError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreDesyncError';
  }
}

function requireFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RendererProtocolError('malformed-message', `${label} must be a finite number`);
  }
}

/**
 * Decode a protocol terrain projection (legend + RLE) into a fast row-major
 * lookup. Throws on malformed input rather than guessing.
 * @param {object} terrain
 */
function decodeTerrain(terrain) {
  if (!terrain || !Array.isArray(terrain.cellTypes) || !Array.isArray(terrain.runs)) {
    throw new RendererProtocolError('malformed-message', 'terrain requires cellTypes and runs');
  }
  if (!Number.isInteger(terrain.width) || !Number.isInteger(terrain.height)) {
    throw new RendererProtocolError('malformed-message', 'terrain requires integer width and height');
  }
  const nameByCode = [];
  const passableByCode = [];
  for (const entry of terrain.cellTypes) {
    nameByCode[entry.code] = entry.name;
    passableByCode[entry.code] = entry.passable;
  }
  const total = terrain.width * terrain.height;
  const codes = new Uint8Array(total);
  let offset = 0;
  for (const [code, count] of terrain.runs) {
    for (let i = 0; i < count; i += 1) codes[offset + i] = code;
    offset += count;
  }
  if (offset !== total) {
    throw new RendererProtocolError('malformed-message', `terrain runs cover ${offset} cells, expected ${total}`);
  }
  return { width: terrain.width, height: terrain.height, codes, nameByCode, passableByCode };
}

/**
 * Decode a protocol vegetation projection (RLE quantized levels) into a fast
 * row-major lookup. Throws on malformed input rather than guessing.
 * @param {object} vegetation
 */
function decodeVegetation(vegetation) {
  if (!vegetation || !Array.isArray(vegetation.runs)) {
    throw new RendererProtocolError('malformed-message', 'vegetation requires runs');
  }
  if (!Number.isInteger(vegetation.width) || !Number.isInteger(vegetation.height)) {
    throw new RendererProtocolError('malformed-message', 'vegetation requires integer width and height');
  }
  const total = vegetation.width * vegetation.height;
  const levels = new Uint8Array(total);
  let offset = 0;
  for (const [level, count] of vegetation.runs) {
    for (let i = 0; i < count; i += 1) levels[offset + i] = level;
    offset += count;
  }
  if (offset !== total) {
    throw new RendererProtocolError('malformed-message', `vegetation runs cover ${offset} cells, expected ${total}`);
  }
  return {
    width: vegetation.width,
    height: vegetation.height,
    maxLevel: vegetation.maxLevel ?? 0,
    revision: vegetation.revision ?? 0,
    levels,
  };
}

function checkVersionAndKind(message, expectedKind) {
  if (message === null || typeof message !== 'object') {
    throw new RendererProtocolError('malformed-message', `${expectedKind} must be an object`);
  }
  if (message.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    throw new RendererProtocolError(
      'unsupported-protocol-version',
      `protocol version ${message.protocolVersion} is not supported (renderer speaks ${SUPPORTED_PROTOCOL_VERSION})`,
    );
  }
  if (message.kind !== expectedKind) {
    throw new RendererProtocolError('malformed-message', `expected kind "${expectedKind}", got "${message.kind}"`);
  }
}

export class RendererStore {
  /** @type {Map<number, object>} */
  entities = new Map();
  /** @type {object[]} bounded, seq-ascending domain event buffer */
  events = [];
  #maxEvents;
  #listeners = new Set();
  /** highest event seq ever placed in the buffer (dedupe guard) */
  #lastBufferedEventSeq = 0;

  simulationId = null;
  protocolVersion = null;
  tick = -1;
  lastEventSeq = 0;
  /** @type {{width: number, height: number} | null} */
  world = null;
  /**
   * Decoded terrain layer, or null before a snapshot supplies one. `codes` is
   * a row-major Uint8Array (fast O(1) cell lookup); `nameByCode` /
   * `passableByCode` come from the snapshot legend.
   * @type {{width: number, height: number, codes: Uint8Array,
   *         nameByCode: string[], passableByCode: boolean[]} | null}
   */
  terrain = null;
  /**
   * Decoded vegetation layer, or null before a snapshot supplies one. `levels`
   * is a row-major Uint8Array of quantized biomass levels (0..maxLevel);
   * updated in place by deltas.
   * @type {{width: number, height: number, maxLevel: number, revision: number,
   *         levels: Uint8Array} | null}
   */
  vegetation = null;
  connection = { state: 'disconnected', detail: '' };
  /** 'live' | 'fixture' */
  mode = 'live';
  /** @type {{entityIds: number[], activeId: number} | null} */
  selection = null;
  /** @type {number | null} */
  followedEntityId = null;

  /**
   * @param {object} [options]
   * @param {number} [options.maxEvents] bounded event retention
   */
  constructor({ maxEvents = 150 } = {}) {
    this.#maxEvents = maxEvents;
  }

  /**
   * @param {(change: {type: string}) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(type) {
    for (const listener of this.#listeners) listener({ type });
  }

  get entityCount() {
    return this.entities.size;
  }

  /** @param {string} state @param {string} [detail] */
  setConnection(state, detail = '') {
    this.connection = { state, detail };
    this.#emit('connection');
  }

  /** @param {'live' | 'fixture'} mode */
  setMode(mode) {
    this.mode = mode;
    this.#emit('mode');
  }

  /** @param {{entityIds: number[], activeId: number} | null} selection */
  setSelection(selection) {
    this.selection = selection;
    this.#emit('selection');
  }

  /** @param {number | null} entityId */
  setFollowedEntity(entityId) {
    this.followedEntityId = entityId;
    this.#emit('follow');
  }

  /**
   * Replace authoritative render state with a full snapshot.
   * @param {object} snapshot protocol snapshot.full message
   */
  applyFullSnapshot(snapshot) {
    checkVersionAndKind(snapshot, 'snapshot.full');
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) {
      throw new RendererProtocolError('malformed-message', 'snapshot.tick must be a non-negative integer');
    }
    if (!snapshot.world) {
      throw new RendererProtocolError('malformed-message', 'snapshot.world is required');
    }
    requireFinite(snapshot.world.width, 'snapshot.world.width');
    requireFinite(snapshot.world.height, 'snapshot.world.height');
    if (!Array.isArray(snapshot.entities)) {
      throw new RendererProtocolError('malformed-message', 'snapshot.entities must be an array');
    }
    this.protocolVersion = snapshot.protocolVersion;
    this.simulationId = snapshot.simulationId;
    this.tick = snapshot.tick;
    this.lastEventSeq = snapshot.lastEventSeq ?? 0;
    this.world = { width: snapshot.world.width, height: snapshot.world.height };
    this.entities = new Map(snapshot.entities.map((entity) => [entity.id, { ...entity }]));
    // Terrain is static and carried by full snapshots; decode it once here.
    // Deltas never touch it. A snapshot without terrain clears it.
    this.terrain = snapshot.terrain ? decodeTerrain(snapshot.terrain) : null;
    // Vegetation is carried in full by full snapshots and patched by deltas.
    this.vegetation = snapshot.vegetation ? decodeVegetation(snapshot.vegetation) : null;
    // A snapshot may jump the event stream forward (recovery); events skipped
    // over are gone — never invent them, just move the dedupe watermark.
    this.#lastBufferedEventSeq = Math.max(this.#lastBufferedEventSeq, 0);
    this.#emit('snapshot');
  }

  /**
   * Terrain cell name at a world cell, or null when there is no terrain or the
   * cell is outside the terrain bounds.
   * @param {number} cellX @param {number} cellY
   * @returns {string | null}
   */
  terrainNameAt(cellX, cellY) {
    const terrain = this.terrain;
    if (!terrain || cellX < 0 || cellY < 0 || cellX >= terrain.width || cellY >= terrain.height) return null;
    return terrain.nameByCode[terrain.codes[cellY * terrain.width + cellX]] ?? null;
  }

  /**
   * Quantized vegetation level (0..maxLevel) at a world cell, or 0 when there
   * is no vegetation layer or the cell is out of bounds.
   * @param {number} cellX @param {number} cellY
   * @returns {number}
   */
  vegetationLevelAt(cellX, cellY) {
    const vegetation = this.vegetation;
    if (!vegetation || cellX < 0 || cellY < 0 || cellX >= vegetation.width || cellY >= vegetation.height) return 0;
    return vegetation.levels[cellY * vegetation.width + cellX];
  }

  /**
   * Apply a delta to authoritative render state.
   * @param {object} delta protocol snapshot.delta message
   * @returns {{applied: boolean, reason?: string, created?: number, updated?: number, removed?: number}}
   */
  applyDelta(delta) {
    checkVersionAndKind(delta, 'snapshot.delta');
    for (const field of ['created', 'updated', 'removed']) {
      if (!Array.isArray(delta[field])) {
        throw new RendererProtocolError('malformed-message', `delta.${field} must be an array`);
      }
    }
    if (!Number.isInteger(delta.tick) || !Number.isInteger(delta.baseTick)) {
      throw new RendererProtocolError('malformed-message', 'delta.tick and delta.baseTick must be integers');
    }
    if (this.tick < 0) {
      throw new StoreDesyncError('received a delta before any full snapshot');
    }
    if (delta.simulationId !== this.simulationId) {
      throw new StoreDesyncError(
        `delta belongs to simulation "${delta.simulationId}", store has "${this.simulationId}"`,
      );
    }
    if (delta.tick <= this.tick) {
      return { applied: false, reason: 'stale' };
    }
    if (delta.baseTick !== this.tick) {
      throw new StoreDesyncError(`out-of-order delta: baseTick ${delta.baseTick}, store is at tick ${this.tick}`);
    }
    const missing = findMissingDeltaEntities(this.entities, delta);
    if (missing.missingUpdated.length > 0 || missing.missingRemoved.length > 0) {
      throw new StoreDesyncError(
        `delta references unknown entities (updated: [${missing.missingUpdated}] removed: [${missing.missingRemoved}])`,
      );
    }
    const counts = applyDeltaToEntities(this.entities, delta);
    this.#applyVegetationChanges(delta.vegetation);
    this.tick = delta.tick;
    this.lastEventSeq = delta.lastEventSeq ?? this.lastEventSeq;
    if (Array.isArray(delta.events)) {
      this.#bufferEvents(delta.events);
    }
    this.#emit('delta');
    return { applied: true, ...counts };
  }

  /**
   * Patch the vegetation level grid in place from a delta's sparse changes.
   * @param {{revision: number, changes: Array<[number, number]>} | undefined} vegetation
   */
  #applyVegetationChanges(vegetation) {
    if (!vegetation || !this.vegetation || !Array.isArray(vegetation.changes)) return;
    for (const [index, level] of vegetation.changes) {
      if (index >= 0 && index < this.vegetation.levels.length) {
        this.vegetation.levels[index] = level;
      }
    }
    this.vegetation.revision = vegetation.revision ?? this.vegetation.revision;
  }

  /**
   * Append domain events from an events.batch message or a raw event array.
   * Events already buffered (by seq) are skipped, so delta-carried events and
   * batch-carried events never duplicate.
   * @param {object | object[]} batchOrEvents
   */
  applyEventBatch(batchOrEvents) {
    let events;
    if (Array.isArray(batchOrEvents)) {
      events = batchOrEvents;
    } else {
      checkVersionAndKind(batchOrEvents, 'events.batch');
      if (!Array.isArray(batchOrEvents.events)) {
        throw new RendererProtocolError('malformed-message', 'events.batch.events must be an array');
      }
      events = batchOrEvents.events;
    }
    this.#bufferEvents(events);
    this.#emit('events');
  }

  #bufferEvents(events) {
    for (const event of events) {
      if (typeof event?.seq === 'number' && event.seq <= this.#lastBufferedEventSeq) continue;
      this.events.push({ ...event });
      if (typeof event?.seq === 'number') this.#lastBufferedEventSeq = event.seq;
    }
    if (this.events.length > this.#maxEvents) {
      this.events.splice(0, this.events.length - this.#maxEvents);
    }
  }

  /** Forget everything (new connection, new simulation). */
  reset() {
    this.entities = new Map();
    this.events = [];
    this.#lastBufferedEventSeq = 0;
    this.simulationId = null;
    this.protocolVersion = null;
    this.tick = -1;
    this.lastEventSeq = 0;
    this.world = null;
    this.terrain = null;
    this.vegetation = null;
    this.selection = null;
    this.followedEntityId = null;
    this.#emit('reset');
  }

  /** @param {number} entityId */
  getEntity(entityId) {
    return this.entities.get(entityId) ?? null;
  }

  /**
   * Entities whose authoritative position lies inside the bounds (inclusive).
   * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
   * @returns {object[]}
   */
  getEntitiesInBounds(bounds) {
    const result = [];
    for (const entity of this.entities.values()) {
      if (entity.x >= bounds.minX && entity.x <= bounds.maxX && entity.y >= bounds.minY && entity.y <= bounds.maxY) {
        result.push(entity);
      }
    }
    return result;
  }

  /**
   * Most recent buffered events that mention an entity, newest first.
   * @param {number} entityId
   * @param {number} [limit]
   */
  eventsForEntity(entityId, limit = 8) {
    const matches = [];
    for (let i = this.events.length - 1; i >= 0 && matches.length < limit; i -= 1) {
      if (this.events[i].entityId === entityId) matches.push(this.events[i]);
    }
    return matches;
  }
}
