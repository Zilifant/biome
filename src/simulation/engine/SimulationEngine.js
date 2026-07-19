/**
 * The authoritative, headless, deterministic simulation engine.
 *
 * The engine owns all simulation state and advances ONLY via synchronous
 * step() calls — it holds no timers and knows nothing about wall-clock
 * time, transports, or rendering. Determinism contract: identical config +
 * seed + ordered commands + tick count ⇒ identical state, every time.
 *
 * Tick pipeline (one step):
 *   1. clock advances to tick T
 *   2. queued commands are applied and flushed (visible to all systems of T)
 *   3. phases run in order: environment → perception → decision → movement →
 *      interaction → physiology → lifecycle → cleanup → observation
 *   4. deferred entity spawns/removals flush after `cleanup`, so
 *      `observation` systems always see the settled post-tick state
 */
import { SimulationClock } from './SimulationClock.js';
import { SystemScheduler, PHASES } from './SystemScheduler.js';
import { World } from '../world/World.js';
import { projectTerrain } from '../world/TerrainGrid.js';
import { projectVegetation } from '../world/VegetationGrid.js';
import { DomainEventBus } from '../events/DomainEventBus.js';
import { EventTypes } from '../events/EventTypes.js';
import { CommandProcessor } from '../commands/CommandProcessor.js';
import { SeededRandom, deriveSeed } from '../random/SeededRandom.js';
import { defaultSimulationConfig, mergeConfig } from '../config/defaultSimulationConfig.js';

const CLEANUP_PHASE = 'cleanup';

/** @param {import('../world/EntityManager.js').Entity} entity */
function publicEntityView(entity) {
  return {
    id: entity.id,
    kind: entity.kind,
    speciesId: entity.speciesId,
    x: entity.x,
    y: entity.y,
    heading: entity.heading,
    age: entity.age,
    energyFraction: entity.maxEnergy > 0 ? entity.energy / entity.maxEnergy : 0,
    hydrationFraction: entity.maxHydration > 0 ? entity.hydration / entity.maxHydration : 0,
    bodyMass: entity.bodyMass,
    healthFraction: entity.maxHealth > 0 ? entity.health / entity.maxHealth : 0,
    lifeStage: entity.lifeStage,
    action: entity.action,
    alive: entity.alive,
  };
}

export class SimulationEngine {
  /** @type {Map<string, SeededRandom>} */
  #randomStreams = new Map();
  /** @type {object | null} memoized terrain projection (terrain is static) */
  #terrainProjection = null;
  /** @type {object | null} memoized vegetation projection, keyed by revision */
  #vegetationProjection = null;
  #vegetationProjectionRevision = -1;

  /**
   * @param {object} [options]
   * @param {number} [options.seed]
   * @param {object} [options.config] overrides merged over defaults
   * @param {string} [options.simulationId]
   */
  constructor({ seed = 1, config = {}, simulationId } = {}) {
    this.seed = seed >>> 0;
    this.simulationId = simulationId ?? `sim-${this.seed}`;
    this.config = mergeConfig(defaultSimulationConfig, config);
    this.clock = new SimulationClock();
    // Terrain and vegetation are derived from dedicated stream seeds so their
    // generation never shifts other streams, and regenerate identically on
    // load. (Vegetation biomass is also persisted, since feeding will make it
    // no longer reproducible from the seed alone.)
    this.world = new World({
      ...this.config.world,
      terrainSeed: deriveSeed(this.seed, 'terrain'),
      terrain: this.config.terrain,
      vegetationSeed: deriveSeed(this.seed, 'vegetation'),
      vegetation: this.config.vegetation,
    });
    this.scheduler = new SystemScheduler();
    this.events = new DomainEventBus({ maxBufferedEvents: this.config.events.maxBufferedEvents });
    this.commands = new CommandProcessor(this);
  }

  get tick() {
    return this.clock.tick;
  }

  get entityCount() {
    return this.world.entities.count;
  }

  /**
   * Named deterministic random stream, created lazily from the root seed.
   * A system consuming more values from its own stream never shifts the
   * sequences of other streams.
   * @param {string} name
   * @returns {SeededRandom}
   */
  randomStream(name) {
    let stream = this.#randomStreams.get(name);
    if (!stream) {
      stream = new SeededRandom(deriveSeed(this.seed, name));
      this.#randomStreams.set(name, stream);
    }
    return stream;
  }

  /** @param {object} system see SystemScheduler#register */
  registerSystem(system) {
    this.scheduler.register(system);
    return this;
  }

  /**
   * Submit an engine command (entity.spawn / entity.remove). Applied at the
   * next tick boundary.
   * @param {object} command
   * @returns {object} structured command result
   */
  submitCommand(command) {
    return this.commands.submit(command);
  }

  /**
   * Advance the simulation synchronously.
   * @param {number} [ticks]
   * @returns {number} the tick after stepping
   */
  step(ticks = 1) {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new RangeError(`step(ticks) requires a non-negative integer, got ${ticks}`);
    }
    for (let i = 0; i < ticks; i += 1) {
      this.#stepOnce();
    }
    return this.clock.tick;
  }

  #stepOnce() {
    const tick = this.clock.advance();
    this.commands.applyPending(tick);
    const context = this.#createSystemContext(tick);
    for (const phase of PHASES) {
      this.scheduler.runPhase(phase, tick, this.world, context);
      if (phase === CLEANUP_PHASE) {
        this.applyDeferredEntityChanges(tick);
      }
    }
  }

  #createSystemContext(tick) {
    return {
      tick,
      config: this.config,
      random: (streamName) => this.randomStream(streamName),
      emit: (type, payload) => this.events.emit(type, tick, payload),
      queueSpawn: (definition) => this.world.entities.queueSpawn(definition),
      queueRemove: (entityId) => this.world.entities.queueRemove(entityId),
    };
  }

  /**
   * Flush deferred entity spawns/removals, keeping the spatial index in sync
   * and emitting entity.created / entity.removed events. Called by the
   * engine at tick boundaries; fixtures also call it once after populating
   * the initial world (tick 0).
   * @param {number} [tick]
   */
  applyDeferredEntityChanges(tick = this.clock.tick) {
    this.world.entities.flush({
      onCreated: (entity) => {
        this.world.insertIntoGrid(entity);
        this.events.emit(EventTypes.ENTITY_CREATED, tick, {
          entityId: entity.id,
          kind: entity.kind,
          speciesId: entity.speciesId,
          x: entity.x,
          y: entity.y,
        });
      },
      onRemoved: (entity) => {
        this.world.removeFromGrid(entity);
        this.events.emit(EventTypes.ENTITY_REMOVED, tick, { entityId: entity.id });
      },
    });
  }

  /**
   * Externally-visible state for snapshot building. Returns fresh plain
   * objects only — never internal entity records.
   * @param {object} [options]
   * @param {{minX: number, minY: number, maxX: number, maxY: number} | null} [options.bounds]
   */
  getSnapshotData({ bounds = null } = {}) {
    const entities = [];
    for (const entity of this.world.entities.all()) {
      if (
        bounds &&
        (entity.x < bounds.minX || entity.x > bounds.maxX || entity.y < bounds.minY || entity.y > bounds.maxY)
      ) {
        continue;
      }
      entities.push(publicEntityView(entity));
    }
    return {
      simulationId: this.simulationId,
      tick: this.clock.tick,
      lastEventSeq: this.events.lastSeq,
      world: { width: this.world.width, height: this.world.height },
      entities,
      terrain: this.getTerrainData(),
      vegetation: this.getVegetationData(),
    };
  }

  /**
   * Renderer-neutral terrain projection (codes + legend, RLE). Terrain is
   * static, so this is computed once and shared by reference — attaching it to
   * every per-tick snapshot costs nothing. Callers must treat it as read-only.
   * @returns {object}
   */
  getTerrainData() {
    if (this.#terrainProjection === null) {
      this.#terrainProjection = projectTerrain(this.world.terrain);
    }
    return this.#terrainProjection;
  }

  /**
   * Renderer-neutral vegetation projection (quantized levels, RLE + revision).
   * Memoized by the vegetation grid's revision, so on ticks where biomass did
   * not change (regrowth is staggered, no grazing) it is reused for free.
   * Callers must treat it as read-only.
   * @returns {object}
   */
  getVegetationData() {
    const revision = this.world.vegetation.revision;
    if (this.#vegetationProjection === null || this.#vegetationProjectionRevision !== revision) {
      this.#vegetationProjection = projectVegetation(this.world.vegetation);
      this.#vegetationProjectionRevision = revision;
    }
    return this.#vegetationProjection;
  }

  /**
   * Public inspection view of one entity, or null.
   * @param {number} entityId
   */
  getEntityDetails(entityId) {
    const entity = this.world.entities.get(entityId);
    if (!entity) return null;
    return {
      ...publicEntityView(entity),
      energy: entity.energy,
      maxEnergy: entity.maxEnergy,
      hydration: entity.hydration,
      maxHydration: entity.maxHydration,
      health: entity.health,
      maxHealth: entity.maxHealth,
      speed: entity.speed,
      lowEnergy: entity.lowEnergy,
      edibleMass: entity.edibleMass,
      // Decision detail — inspection-only (bulk snapshots carry only `action`).
      actionTarget: entity.actionTarget,
      utilityBreakdown: entity.utilityBreakdown,
      // Reproduction detail — inspection-only.
      parents: [...entity.parents],
      reproState: {
        gestating: entity.gestationUntil !== null,
        gestationUntil: entity.gestationUntil,
        lastMatedTick: entity.lastMatedTick,
      },
      // Family and life history (Step 13) — inspection-only, both bounded:
      // `offspring` is sparse (a handful per lifetime) and `lifeEvents` is
      // hard-capped, so neither can grow without limit.
      offspring: [...entity.offspring],
      parentingState: {
        guardianId: entity.guardianId,
        dependent: entity.guardianId !== null,
        weaned: entity.weaned,
      },
      lifeEvents: entity.lifeEvents.map((event) => ({ ...event })),
      // Transient perception summary (null if not yet computed or not an
      // animal). Inspection-only — never in bulk snapshots.
      perception: this.world.perception.get(entityId) ?? null,
    };
  }

  /** @param {number} sinceSeq */
  eventsSince(sinceSeq) {
    return this.events.since(sinceSeq);
  }

  /** Serialization support (used by SimulationSerializer). */
  serializeRandomStreams() {
    const states = {};
    for (const [name, stream] of this.#randomStreams) {
      states[name] = stream.getState();
    }
    return states;
  }

  /** @param {Record<string, number>} states */
  restoreRandomStreams(states) {
    this.#randomStreams.clear();
    for (const [name, state] of Object.entries(states)) {
      const stream = new SeededRandom(deriveSeed(this.seed, name));
      stream.setState(state);
      this.#randomStreams.set(name, stream);
    }
  }
}
