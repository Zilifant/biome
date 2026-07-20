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
import { recordTombstone, lookupLineageList, lookupLineage } from '../world/lineage.js';
import { genotypeOf } from '../traits/genetics.js';
import { acceptanceThreshold, matePreferenceFor } from '../mating/mateChoice.js';
import { dominanceOf } from '../social/dominance.js';

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
    sex: entity.sex,
    groupId: entity.groupId,
    action: entity.action,
    alive: entity.alive,
    decayStage: entity.decayStage,
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
        // The one chokepoint every removal passes through, so nothing can leave
        // the world unremembered (Step 18, §1.4 C2).
        recordTombstone(this.world, entity, tick, this.config.lineage.maxTombstones);
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
      environment: { ...this.world.environment },
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
      stamina: entity.stamina,
      maxStamina: entity.maxStamina,
      lowEnergy: entity.lowEnergy,
      edibleMass: entity.edibleMass,
      // Predation state (Step 16) — inspection-only. `huntTargetId` is what
      // makes a pursuit legible: an observer can see which animal a predator
      // has committed to, not just that it is moving.
      huntTargetId: entity.huntTargetId,
      lastHuntTick: entity.lastHuntTick,
      // Injuries (Step 17) — inspection-only, worst first, and already capped
      // by the injury helper. `impairment` is the derived total the movement
      // and feeding systems act on, exposed so the penalty is legible rather
      // than something a viewer has to infer from a limping animal.
      injuries: [...entity.injuries].sort((a, b) => b.severity - a.severity).map((i) => ({ ...i })),
      impairment: entity.impairment,
      // Carcass detail (Step 18). `decayStage` is also in bulk snapshots (the
      // renderer ramps its glyph from it); the absolute mass is inspection-only,
      // like every other absolute quantity.
      decayStage: entity.decayStage,
      diedTick: entity.diedTick,
      deathCause: entity.deathCause,
      // Individual variation (Step 14) — inspection-only. `adultMass` is the
      // size this individual grows toward, so a juvenile's eventual build is
      // readable long before it gets there.
      traits: { ...entity.traits },
      adultMass: entity.adultMass,
      // Heredity (Step 20) — inspection-only. Genotype beside phenotype is what
      // makes a tradeoff legible: a genome coding for a big animal expresses
      // less speed, and seeing both numbers explains the gap rather than
      // leaving it mysterious. Parent traits come from whichever parents are
      // still in the world; the rest carry their lineage status (Step 18).
      genome: Object.fromEntries(Object.entries(entity.genome).map(([locus, alleles]) => [locus, [...alleles]])),
      genotype: genotypeOf(entity.genome),
      parentTraits: entity.parents.map((id) => {
        const parent = this.world.entities.get(id);
        return parent
          ? { id, status: parent.alive ? 'alive' : 'carcass', traits: { ...parent.traits } }
          : { ...lookupLineage(this.world, id), traits: null };
      }),
      // Bounded spatial memory (Step 15) — inspection-only, strongest first, so
      // what an animal is currently acting on reads at the top. Copied, and
      // already capped by the memory helper, so this can never be large.
      memories: [...entity.memories].sort((a, b) => b.strength - a.strength).map((m) => ({ ...m })),
      // Decision detail — inspection-only (bulk snapshots carry only `action`).
      actionTarget: entity.actionTarget,
      utilityBreakdown: entity.utilityBreakdown,
      // Reproduction detail — inspection-only. Lineage ids are resolved rather
      // than handed over raw (Step 18): now that carcasses are removed, a
      // reference can point at something alive, something dead we still
      // remember, or something the world has forgotten — and saying which is
      // more honest than a bare id the caller cannot look up.
      parents: [...entity.parents],
      lineage: {
        parents: lookupLineageList(this.world, entity.parents),
        offspring: lookupLineageList(this.world, entity.offspring),
      },
      reproState: {
        gestating: entity.gestationUntil !== null,
        gestationUntil: entity.gestationUntil,
        lastMatedTick: entity.lastMatedTick,
      },
      // Mate choice (Step 22) — inspection-only. The *basis* of the choice, not
      // just its outcome: what this species reads in a mate, how hard this
      // individual weighs it, the standard it is holding right now (which falls
      // as it goes unmated), and the last animal it actually sized up. Without
      // the threshold beside the quality, a rejection looks arbitrary.
      mateChoice: {
        preference: matePreferenceFor(entity.speciesId),
        choosiness: entity.traits.choosiness ?? null,
        searchingSince: entity.mateSearchSince,
        searchingTicks: entity.mateSearchSince === null ? null : this.clock.tick - entity.mateSearchSince,
        threshold:
          entity.mateSearchSince === null
            ? null
            : acceptanceThreshold(entity, this.clock.tick, {
                baseThreshold: this.config.reproduction.acceptanceThreshold,
                patienceTicks: this.config.reproduction.choosinessPatienceTicks,
              }),
        lastCourtship: entity.lastCourtship ? { ...entity.lastCourtship } : null,
      },
      // Sociality (Step 23) — inspection-only apart from the `groupId` label.
      // `dominance` is *derived* on read rather than stored: there is no pecking
      // order in state, so an animal's standing shifts as it grows, starves, and
      // heals. The group summary is this tick's local view (how many groupmates
      // are actually in range, and how far off their centre this animal has
      // drifted), which is the thing herding steers on — not a roster, because
      // no roster exists anywhere.
      social: {
        groupId: entity.groupId,
        dominance: dominanceOf(entity),
        alarmed: entity.alarmedUntil !== null && this.clock.tick < entity.alarmedUntil,
        alarmedUntil: entity.alarmedUntil,
        alarmSource: entity.alarmSource ? { ...entity.alarmSource } : null,
        defendingId: entity.defendingId,
        lastContestTick: entity.lastContestTick,
        nearby: (() => {
          const summary = this.world.social.get(entityId);
          if (!summary) return null;
          return {
            groupmates: summary.groupmates,
            adults: summary.adults,
            nearestDistance: summary.nearestDistance,
            drift: summary.centroid ? Math.hypot(summary.centroid.x - entity.x, summary.centroid.y - entity.y) : null,
          };
        })(),
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
