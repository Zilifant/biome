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
import { SpeciesRegistry } from '../config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../config/species/index.js';
import { recordTombstone, lookupLineageList, lookupLineage } from '../world/lineage.js';
import { genotypeOf } from '../traits/genetics.js';
import { acceptanceThreshold, matePreferenceFor } from '../mating/mateChoice.js';
import { dominanceOf } from '../social/dominance.js';
import { territoryOf } from '../systems/TerritorySystem.js';
import { diseaseSeverity, isInfectious, isSymptomatic } from '../disease/disease.js';
import { forageGradient, isDispersing, migrationOf } from '../migration/migration.js';
import { disturbanceAt, projectDisturbances } from '../disturbance/disturbances.js';
import { projectFeatures } from '../engineering/features.js';

const CLEANUP_PHASE = 'cleanup';

/**
 * @param {import('../world/EntityManager.js').Entity} entity
 * @param {number} tick needed only for `dispersing`, which is derived from the
 *   clock rather than stored — the same "derive rather than store" rule disease
 *   severity and dominance follow, so the flag can never outlive the walk.
 */
function publicEntityView(entity, tick) {
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
    diseaseState: entity.diseaseState,
    dispersing: isDispersing(entity, tick),
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
  /** @type {object | null} memoized feature projection, keyed by revision */
  #featureProjection = null;
  #featureProjectionRevision = -1;

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
    // Species resolve against the config, so the registry is built here (where
    // the config exists) and handed to the world rather than being a module
    // singleton — two engines with different configs must not share one.
    this.species = new SpeciesRegistry(SPECIES_DEFINITIONS, this.config);
    this.world = new World({
      ...this.config.world,
      species: this.species,
      terrainSeed: deriveSeed(this.seed, 'terrain'),
      terrain: this.config.terrain,
      vegetationSeed: deriveSeed(this.seed, 'vegetation'),
      vegetation: this.config.vegetation,
      territory: this.config.territory,
      engineering: this.config.engineering,
      groups: this.config.groups,
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
      entities.push(publicEntityView(entity, this.clock.tick));
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
      disturbances: projectDisturbances(this.world.disturbances),
      features: this.getFeatureData(),
    };
  }

  /**
   * Renderer-neutral projection of worn ground, memoized by the feature grid's
   * revision. Because that revision only moves when a cell crosses the
   * threshold, this is reused for free on the overwhelming majority of ticks —
   * animals write wear constantly and change what it *means* rarely.
   * Callers must treat it as read-only.
   * @returns {object}
   */
  getFeatureData() {
    const revision = this.world.features.revision;
    if (this.#featureProjection === null || this.#featureProjectionRevision !== revision) {
      this.#featureProjection = projectFeatures(this.world.features);
      this.#featureProjectionRevision = revision;
    }
    return this.#featureProjection;
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
   * The species this world knows, with the founding count the scenario gives
   * each one — the roster a host publishes so a client never has to be compiled
   * with one (protocol v29, PLAN-SPECIES.md §6).
   *
   * ⚠ Ids and counts only, never labels or glyphs. What to *call* a species is
   * presentation and belongs to the renderer (§19); what the engine can say is
   * which species exist and how many of each this scenario starts with.
   *
   * @returns {Array<{id: string, defaultCount: number}>}
   */
  getSpeciesRoster() {
    const founding = new Map(
      (this.config.demo?.founding ?? []).map(({ speciesId, count }) => [speciesId, count]),
    );
    // Every *known* species, not just the founded ones: a species the scenario
    // starts with none of is still one a caller may ask for, and a roster that
    // hid it would make it unreachable through the UI.
    return this.species.ids().map((id) => ({ id, defaultCount: founding.get(id) ?? 0 }));
  }

  /**
   * Public inspection view of one entity, or null.
   * @param {number} entityId
   */
  getEntityDetails(entityId) {
    const entity = this.world.entities.get(entityId);
    if (!entity) return null;
    return {
      ...publicEntityView(entity, this.clock.tick),
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
      // Who is standing over this body (v29; see predation/possession.js).
      // Inspection-only: it changes rarely and matters for one carcass at a
      // time, which is the standing test for what stays out of the bulk
      // snapshot. Without it a viewer sees a scavenger stop eating for no
      // stated reason, which is what A54 was open about.
      possessorId: entity.possessorId ?? null,
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
        preference: matePreferenceFor(this.world.species.get(entity.speciesId)),
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
      // Territory (Step 24) — inspection-only. The home range is four numbers,
      // not a trajectory: an animal's settled centre and how far it typically
      // strays from it, both accumulated in O(1) per tick. `standingOn` is the
      // O(1) claim lookup the avoidance behaviour reads, exposed so "it is
      // avoiding this ground" is checkable rather than inferred, and `holding`
      // is how much ground this animal actually owns.
      territory: (() => {
        const species = territoryOf(this.world.species.get(entity.speciesId));
        const owner = this.world.scent.ownerAt(entity.x, entity.y);
        return {
          defends: species?.defends ?? false,
          rangeRadius: species?.rangeRadius ?? null,
          homeRange: entity.homeRange ? { ...entity.homeRange } : null,
          drift: entity.homeRange ? Math.hypot(entity.x - entity.homeRange.x, entity.y - entity.homeRange.y) : null,
          holding: species?.defends ? this.world.scent.countFor(entity.id) : 0,
          standingOn: { ownerId: owner, strength: this.world.scent.strengthAt(entity.x, entity.y), own: owner === entity.id },
          lastMarkTick: entity.lastMarkTick,
        };
      })(),
      // Migration (Step 26) — inspection-only apart from the `dispersing` flag.
      // The `drift` block is what the animal is *currently* being steered by,
      // and it is reported beside the live `habitat` reading it was computed
      // from so a bias is checkable rather than mysterious — the same reasoning
      // that puts a courtship's threshold beside its quality. `habitat` is
      // recomputed here rather than cached: it is 16 O(1) grid reads for one
      // animal on demand, and a cached copy would be stale between staggers.
      // `settled` is where this animal last lived, which is the baseline the
      // `entity.migrated` event fires against.
      migration: (() => {
        const species = migrationOf(this.world.species.get(entity.speciesId));
        const habitat =
          species?.tracksForage
            ? forageGradient(this.world, entity, {
                cueRadius: species.cueRadius,
                reference: this.config.migration.cueReference,
              })
            : null;
        return {
          tracksForage: species?.tracksForage ?? false,
          cueRadius: species?.cueRadius ?? null,
          dispersing: isDispersing(entity, this.clock.tick),
          dispersalUntil: entity.dispersalUntil,
          dispersalHeading: entity.dispersalHeading,
          drift: entity.migrationHeading === null ? null : { heading: entity.migrationHeading, strength: entity.migrationStrength },
          habitat: habitat ? { ...habitat } : null,
          settled: entity.settledX === null ? null : { x: entity.settledX, y: entity.settledY },
        };
      })(),
      // Disturbances (Step 27) — inspection-only, and *only* the one covering
      // this animal. The active list already rides in every snapshot, so
      // repeating it here would be duplication; what inspection adds is the
      // answer to "is this animal standing in it?", which is otherwise a
      // geometry problem the caller has to solve for itself.
      caughtIn: (() => {
        const caught = disturbanceAt(this.world.disturbances, entity.x, entity.y);
        return caught ? { ...caught } : null;
      })(),
      // Disease (Step 25) — the compartment itself rides in bulk snapshots (an
      // outbreak has to be watchable); this is the detail. `infectious` is
      // spelled out rather than left to be inferred, because the whole point of
      // the model is that it does not match `symptomatic`.
      disease: {
        state: entity.diseaseState,
        since: entity.diseaseSince,
        until: entity.diseaseUntil,
        infectious: isInfectious(entity),
        symptomatic: isSymptomatic(entity),
        severity: diseaseSeverity(entity, this.config.disease.speedPenalty),
      },
      // Sociality (Step 23) — inspection-only apart from the `groupId` label.
      // `dominance` is *derived* on read rather than stored: there is no pecking
      // order in state, so an animal's standing shifts as it grows, starves, and
      // heals. The group summary is this tick's local view (how many groupmates
      // are actually in range, and how far off their centre this animal has
      // drifted), which is the thing herding steers on — not a roster, because
      // no roster exists anywhere.
      // Persistent group membership (v29; see world/GroupRegistry.js). ⚠ A
      // different thing from `social.groupId` below, and the pair is the whole
      // point: the label there is who this animal is standing with *now*, and
      // this is who it belongs to — an identity that survives them walking
      // apart. Reported as the record rather than a bare id, because "which
      // pride is this lion in" is only answerable if you can see who else is in
      // it. `memberIds` is bounded by `groups.maxMembers`, so this cannot be
      // large. Null for the overwhelming majority of animals, which is honest:
      // most species form no persistent groups at all.
      group: (() => {
        const record = this.world.groups.get(entity.groupRecordId);
        if (!record) return null;
        return {
          id: record.id,
          speciesId: record.speciesId,
          size: record.memberIds.length,
          memberIds: [...record.memberIds],
          founderId: record.founderId,
          foundedTick: record.foundedTick,
        };
      })(),
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
