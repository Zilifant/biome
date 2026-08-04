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
import { isLastingEvent } from './EventCatalog.js';

/** The protocol version this renderer understands. */
export const SUPPORTED_PROTOCOL_VERSION = 31;

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
  /**
   * Bounded, seq-ascending domain event buffer. Bounded per *tier* rather than
   * overall (see `#trimEvents`): a milestone stays for tens of thousands of
   * ticks, the movement stream for a handful.
   * @type {object[]}
   */
  events = [];
  #maxLastingEvents;
  #maxPassingEvents;
  #lastingCount = 0;
  #passingCount = 0;
  #listeners = new Set();
  /** highest event seq ever placed in the buffer (dedupe guard) */
  #lastBufferedEventSeq = 0;
  /**
   * The last form in which each id was seen **alive**, as protocol fields —
   * `{ id, kind, speciesId, sex, lifeStage, alive: true }`. Bounded, and kept
   * long after the animal itself is gone.
   *
   * ⚠ This exists because **an event is about a moment, and an entity is about
   * now.** The log said `> hunt p122 → %65 caught`: by the time that line was
   * drawn its prey was a carcass, so the reference wore a `%`, and once the body
   * decayed away the same line fell back to `#65`. A record of a hunt that
   * cannot say what was hunted is the panel reporting the present tense over the
   * past one. Only protocol fields are kept — what they *look like* is still
   * `EntityAppearance`'s alone (§3, invariant 4).
   * @type {Map<number, object>}
   */
  #animalIdentities = new Map();
  #maxRememberedAnimals;

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
  /**
   * Season and weather (protocol v18), or null before a snapshot supplies it.
   * A handful of scalars carried whole by both snapshots and deltas.
   * @type {{season: string, weather: string, temperature: number} | null}
   */
  environment = null;
  /**
   * Active local disturbances (protocol v26): a bounded list of `{ id, kind, x,
   * y, radius, startedTick, until }` circles, carried whole by both snapshots
   * and deltas. Empty when nothing is happening — which is a *reported* state,
   * not an absent one.
   * @type {object[]}
   */
  disturbances = [];
  /**
   * Worn ground (protocol v27): the cells deep enough to be a trail or a
   * burrow. Revision-gated, so a delta carries it only on the rare tick one
   * forms or fades rather than on the constant ticks animals walk about.
   * @type {object[]}
   */
  features = [];
  connection = { state: 'disconnected', detail: '' };
  /** 'live' | 'fixture' */
  mode = 'live';
  /**
   * The selected *cell*, not the selected entity. A cell with nothing standing
   * in it is still a selection — terrain, vegetation, worn ground, and any
   * disturbance covering it are all things worth reporting, so clicking bare
   * ground selects the ground rather than clearing.
   *
   * `activeId` is null when the cell is empty; `entityIds` may be empty.
   * @type {{cellX: number, cellY: number, entityIds: number[], activeId: number | null} | null}
   */
  selection = null;
  /** @type {number | null} */
  followedEntityId = null;

  /**
   * Retention defaults. `lasting` holds ~19 000 demo ticks of milestones at the
   * measured ~1.04 lasting events per tick (§EventCatalog), which is hours of
   * watching at ordinary speeds, for a few megabytes. `passing` is deliberately
   * small: at ~126 per tick, even 400 is barely three ticks of movement — enough
   * to fill the visible log when that filter is on, and nowhere near enough to
   * cost anything.
   *
   * `maxRememberedAnimals` matches the `lasting` cap on purpose: an id is only
   * worth remembering for as long as some retained event can still name it, and
   * the milestone buffer is what decides that.
   *
   * @param {object} [options]
   * @param {number} [options.maxLastingEvents] retained milestones
   * @param {number} [options.maxPassingEvents] retained per-tick chatter
   * @param {number} [options.maxRememberedAnimals] ids whose living form is kept
   */
  constructor({ maxLastingEvents = 20000, maxPassingEvents = 400, maxRememberedAnimals = 20000 } = {}) {
    this.#maxLastingEvents = maxLastingEvents;
    this.#maxPassingEvents = maxPassingEvents;
    this.#maxRememberedAnimals = maxRememberedAnimals;
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

  /** @param {{cellX: number, cellY: number, entityIds: number[], activeId: number | null} | null} selection */
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
    // A snapshot from a *different* simulation is a new world (a restart):
    // nothing in the log describes it, and its `#123` links would name animals
    // that never existed here. A recovery snapshot for the same simulation is
    // the opposite case — the log is exactly what survived the gap — so the
    // buffer is cleared on the id changing, not on every snapshot.
    if (this.simulationId !== null && snapshot.simulationId !== this.simulationId) {
      this.events = [];
      this.#lastingCount = 0;
      this.#passingCount = 0;
      this.#lastBufferedEventSeq = 0;
      // ⚠ The remembered forms go with the log, and for the same reason its
      // links do: the new world reuses the same small integers, so keeping them
      // would draw a lion's glyph beside a gazelle that happens to be #7 now.
      this.#animalIdentities.clear();
    }
    this.protocolVersion = snapshot.protocolVersion;
    this.simulationId = snapshot.simulationId;
    this.tick = snapshot.tick;
    this.lastEventSeq = snapshot.lastEventSeq ?? 0;
    this.world = { width: snapshot.world.width, height: snapshot.world.height };
    this.entities = new Map(snapshot.entities.map((entity) => [entity.id, { ...entity }]));
    for (const entity of this.entities.values()) this.#rememberAnimal(entity);
    this.#trimRememberedAnimals();
    // Terrain is static and carried by full snapshots; decode it once here.
    // Deltas never touch it. A snapshot without terrain clears it.
    this.terrain = snapshot.terrain ? decodeTerrain(snapshot.terrain) : null;
    // Vegetation is carried in full by full snapshots and patched by deltas.
    this.vegetation = snapshot.vegetation ? decodeVegetation(snapshot.vegetation) : null;
    this.environment = snapshot.environment ? { ...snapshot.environment } : null;
    this.disturbances = Array.isArray(snapshot.disturbances) ? snapshot.disturbances.map((d) => ({ ...d })) : [];
    this.features = Array.isArray(snapshot.features?.cells) ? snapshot.features.cells.map((f) => ({ ...f })) : [];
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
   * Whether a world cell is passable, straight from the snapshot legend, or
   * `null` when there is no terrain or the cell is outside it.
   *
   * `null` rather than `false` on purpose: "we have not been told" and "an
   * animal cannot walk here" are different facts, and the legend already
   * distinguishes them. Passability is authoritative — the renderer reports it
   * and never derives movement from it.
   * @param {number} cellX @param {number} cellY
   * @returns {boolean | null}
   */
  terrainPassableAt(cellX, cellY) {
    const terrain = this.terrain;
    if (!terrain || cellX < 0 || cellY < 0 || cellX >= terrain.width || cellY >= terrain.height) return null;
    return terrain.passableByCode[terrain.codes[cellY * terrain.width + cellX]] ?? null;
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
    // Remembered before anything can bury it: an animal killed in *this* delta
    // arrives as an update turning it into a carcass, and the tick it was last
    // alive is the last chance to record what it was.
    for (const entity of delta.created) this.#rememberAnimal(entity);
    for (const entity of delta.updated) this.#rememberAnimal(entity);
    this.#trimRememberedAnimals();
    this.#applyVegetationChanges(delta.vegetation);
    if (delta.environment) this.environment = { ...delta.environment };
    // `Array.isArray` rather than a truthiness check: an empty list is the
    // message that everything has stopped, and treating it as "no update" would
    // leave a fire drawn on the grid after it went out.
    if (Array.isArray(delta.disturbances)) this.disturbances = delta.disturbances.map((d) => ({ ...d }));
    // Omitted means "nothing formed or faded", not "there is nothing" — the
    // revision gate is what makes omission the common case.
    if (Array.isArray(delta.features?.cells)) this.features = delta.features.cells.map((f) => ({ ...f }));
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
      if (isLastingEvent(event?.type)) this.#lastingCount += 1;
      else this.#passingCount += 1;
      if (typeof event?.seq === 'number') this.#lastBufferedEventSeq = event.seq;
    }
    this.#trimEvents();
  }

  /**
   * Drop the oldest events of whichever tier has overflowed, keeping the buffer
   * seq-ascending.
   *
   * Two caps rather than one because the two kinds of event have nothing in
   * common but their shape: 99% of what arrives is one animal moving one cell,
   * and letting that share a bound with births and deaths is what made the log
   * forget a kill thirty ticks after it happened. Keeping *everything* is not on
   * offer — at ~127 events/tick and ~163 bytes each, an hour at 8x is gigabytes.
   *
   * Trimming is amortized: a tier is allowed to overflow by a whole cap before
   * the buffer is rebuilt, so the O(n) pass runs once per cap-worth of events
   * rather than on every tick — the same bargain `DomainEventBus` makes on the
   * engine side, and for the same reason (one move event per animal per tick).
   */
  #trimEvents() {
    if (this.#lastingCount <= this.#maxLastingEvents * 2 && this.#passingCount <= this.#maxPassingEvents * 2) return;
    let dropLasting = Math.max(0, this.#lastingCount - this.#maxLastingEvents);
    let dropPassing = Math.max(0, this.#passingCount - this.#maxPassingEvents);
    const kept = [];
    for (const event of this.events) {
      if (isLastingEvent(event.type)) {
        if (dropLasting > 0) {
          dropLasting -= 1;
          this.#lastingCount -= 1;
          continue;
        }
      } else if (dropPassing > 0) {
        dropPassing -= 1;
        this.#passingCount -= 1;
        continue;
      }
      kept.push(event);
    }
    this.events = kept;
  }

  /**
   * Record the form an animal is in while it is alive, so a log line about it
   * can still say what it was after it dies.
   *
   * ⚠ **Allocation-free on an ordinary tick.** This runs for every entity in
   * every delta — a couple of thousand per tick at demo scale — so it writes
   * only when the *identity* has actually changed, which for an animal is at
   * birth and at each life stage. A record per update would be a per-tick
   * allocation for a fact that changes three times in a life.
   *
   * Only living animals are recorded. A carcass entity is not a form anything
   * was ever "in": it is what is left, and the whole point here is the animal.
   * @param {object} entity
   */
  #rememberAnimal(entity) {
    if (entity?.kind !== 'animal' || entity.alive === false) return;
    const known = this.#animalIdentities.get(entity.id);
    if (known && known.speciesId === entity.speciesId && known.lifeStage === (entity.lifeStage ?? null)) return;
    this.#animalIdentities.set(entity.id, {
      id: entity.id,
      kind: 'animal',
      alive: true,
      speciesId: entity.speciesId,
      sex: entity.sex ?? null,
      lifeStage: entity.lifeStage ?? null,
    });
  }

  /**
   * Drop the least recently *first seen* ids once the map has overflowed —
   * amortized over a whole cap, exactly as `#trimEvents` is and for the same
   * reason. Dropping a still-living animal costs nothing: it is still in
   * `entities`, so it resolves from there.
   */
  #trimRememberedAnimals() {
    if (this.#animalIdentities.size <= this.#maxRememberedAnimals * 2) return;
    let drop = this.#animalIdentities.size - this.#maxRememberedAnimals;
    for (const id of this.#animalIdentities.keys()) {
      if (drop-- <= 0) break;
      this.#animalIdentities.delete(id);
    }
  }

  /**
   * The last form this id was seen alive in, or null if this client never saw
   * it alive — after a reconnect, or for an animal that died before it
   * connected. Null is the honest answer there rather than a guess.
   * @param {number} entityId
   * @returns {object | null}
   */
  rememberedAnimal(entityId) {
    return this.#animalIdentities.get(entityId) ?? null;
  }

  /** Forget everything (new connection, new simulation). */
  reset() {
    this.entities = new Map();
    this.events = [];
    this.#animalIdentities.clear();
    this.#lastingCount = 0;
    this.#passingCount = 0;
    this.#lastBufferedEventSeq = 0;
    this.simulationId = null;
    this.protocolVersion = null;
    this.tick = -1;
    this.lastEventSeq = 0;
    this.world = null;
    this.terrain = null;
    this.vegetation = null;
    this.environment = null;
    this.disturbances = [];
    this.features = [];
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
