/**
 * Versioned save/load for the simulation engine.
 *
 * A save contains everything needed to continue deterministically: tick,
 * random stream states, world configuration, full entity state (including
 * deferred spawn/removal queues), the event outbox, pending deterministic
 * commands, and descriptors of the registered systems (used to verify the
 * restoring code registered the same systems).
 *
 * The spatial grid is NOT saved — it is derived state and is rebuilt from
 * entity positions on restore. Terrain is likewise derived: it regenerates
 * deterministically from the saved seed + config (config.terrain) in the
 * engine constructor, so no terrain grid is stored. Vegetation biomass IS
 * saved: it evolves over time and will be grazed (Step 9), so it is not
 * reproducible from the seed alone.
 *
 * Systems themselves are code, not data: the caller must register the same
 * systems on the target engine before restoring (see createEngineFromSave).
 *
 * Version history:
 *   1 — initial format.
 *   2 — terrain layer added (Step 2). Terrain is derived, so no field was
 *       added, but pre-terrain (v1) saves are explicitly invalidated: their
 *       entities were placed with no notion of impassable cells and could sit
 *       on now-blocked terrain. No committed saves existed, so no migration
 *       path is provided — v1 saves must be regenerated.
 *   3 — vegetation biomass added (Step 3), stored under `vegetation`. Older
 *       saves lack it and are invalidated; regenerate them.
 *   4 — entity physiology fields added (Step 4): bodyMass, speed, health,
 *       maxHealth. They round-trip automatically (EntityManager serializes
 *       whole records), but v3 saves lack them and are invalidated.
 *   5 — locomotion `moveIntent` added to entity records (Step 5). Needed for
 *       deterministic wander continuation across save/load; v4 saves lack it
 *       and are invalidated.
 *   6 — metabolism fields added (Step 6): lastMoveDistance, lowEnergy,
 *       edibleMass; dead animals become `carcass`-kind entities. v5 saves lack
 *       these and are invalidated.
 *   7 — decision fields added (Step 8): action, actionTarget, utilityBreakdown,
 *       and moveIntent gains `moving`. v6 saves lack these and are invalidated.
 *   8 — hydration fields added (Step 10): hydration, maxHydration. v7 saves
 *       lack these and are invalidated.
 *   9 — life stage added (Step 11): `lifeStage`; the demo `LifecycleSystem`
 *       was replaced by `AgingSystem`, so system descriptors also changed. v8
 *       saves lack the field / register different systems and are invalidated.
 *  10 — reproduction fields added (Step 12): parents, gestationUntil,
 *       pendingMateId, lastMatedTick, plus the new `ReproductionSystem`
 *       descriptor. v9 saves are invalidated.
 *  11 — parenting and life-history fields added (Step 13): offspring,
 *       guardianId, weaned, lifeEvents, plus the new `ParentingSystem`
 *       descriptor. v10 saves lack the fields and register a different system
 *       lineup, so they are invalidated; regenerate them.
 *  12 — individual variation added (Step 14): per-entity `traits` and the
 *       trait-derived `adultMass`. Both are sampled once at birth and cannot
 *       be recovered from the seed alone once a population has turned over, so
 *       they are persisted; v11 saves lack them and are invalidated.
 *  13 — bounded spatial memory added (Step 15): per-entity `memories`, plus the
 *       new `MemorySystem` descriptor. What an animal has learned is not
 *       derivable from the seed, so it is persisted; v12 saves lack the field
 *       and register a different system lineup, so they are invalidated.
 *  14 — predation added (Step 16): per-entity `stamina`/`maxStamina`,
 *       `huntTargetId`, `lastHuntTick`, a second species in the demo, and the
 *       new `HuntingSystem` descriptor. v13 saves lack the fields and register
 *       a different system lineup, so they are invalidated.
 *  15 — injuries added (Step 17): per-entity `injuries` and the derived
 *       `impairment`, plus the new `InjurySystem` descriptor. A wound and how
 *       far it has healed cannot be recovered from the seed, so both persist;
 *       v14 saves lack them and register a different system lineup, so they
 *       are invalidated.
 *  16 — carcass decay added (Step 17→18): per-entity `diedTick`, `deathCause`,
 *       `decayStage`, the new `CarcassSystem` descriptor, and a new top-level
 *       `tombstones` block. This is the first format where entities are
 *       *removed* from the world, so the tombstone registry is part of the
 *       saved state — without it a restored run would forget different animals
 *       than the original. v15 saves are invalidated.
 *  17 — season and weather added (Step 19): a top-level `environment` block and
 *       the new `WeatherSystem` descriptor. The season is a pure function of
 *       the tick, but the *weather* is a held stochastic state, so it must be
 *       stored — recomputing it would need the whole roll history. v16 saves
 *       are invalidated.
 *  18 — heredity added (Step 20): a per-entity `genome`, from which `traits`
 *       are now expressed rather than sampled. The genome is the heritable
 *       state and cannot be recovered from the seed once a population has
 *       turned over, so it persists; v17 saves lack it and are invalidated.
 *  19 — evolutionary observation added (Step 21): a per-entity `generation`,
 *       the new `MetricsSystem` descriptor, and a bounded `metricsHistory`.
 *       The metrics *report* is derived and deliberately not saved — it is
 *       recomputed on the next metrics tick — but the history is, so a chart
 *       survives a restore. v18 saves are invalidated.
 *  20 — sexes and mate choice added (Step 22): a per-entity `sex` (fixed for
 *       life), `mateSearchSince` (how long this animal has been receptive,
 *       which is what makes a choosy one's standard decline), and
 *       `lastCourtship`. Genomes also gained a `choosiness` locus. None of it
 *       is recoverable from the seed once a population has turned over — and a
 *       v19 population has no sexes at all, so its animals could never pair.
 *       v19 saves are invalidated.
 *  21 — sociality added (Step 23): a per-entity `groupId` (the herd label),
 *       `alarmedUntil` / `alarmSource`, `lastContestTick`, `defendingId`, and
 *       the new `SocialSystem` descriptor. The label has to persist because it
 *       is the *only* social state there is — the group summary, like
 *       perception, is transient and rebuilt on the next tick, and dominance is
 *       derived on read. v20 saves lack the fields and register a different
 *       system lineup, so they are invalidated.
 *  22 — territories added (Step 24): a per-entity `homeRange` (the running
 *       summary of where an animal lives) and `lastMarkTick`, a new top-level
 *       `scent` block holding the claim layer, and the `TerritorySystem`
 *       descriptor. Both are evolved state: a map of who holds what ground, and
 *       an average built from a walk nobody recorded, cannot be recovered from
 *       the seed. v21 saves are invalidated.
 *  23 — disease added (Step 25): per-entity `diseaseState`, `diseaseSince`, and
 *       `diseaseUntil`, plus the new `DiseaseSystem` descriptor. Who is
 *       currently carrying what, and how far through it they are, is exactly
 *       the kind of thing no seed can reproduce once a population has been
 *       exposed. v22 saves are invalidated.
 *  24 — migration added (Step 26): per-entity `migrationHeading` /
 *       `migrationStrength` (the drift a wander is steered by),
 *       `dispersalHeading` / `dispersalUntil` (a juvenile's bounded outward
 *       walk), `settledX` / `settledY` (where it last lived), plus the new
 *       `MigrationSystem` descriptor. The drift is *derived* from the vegetation
 *       field and would normally be rebuilt rather than saved — but habitat
 *       evaluation is staggered, so a restore would run up to `updateInterval`
 *       ticks on a stale null and diverge from an uninterrupted run. Two numbers
 *       are cheaper than the divergence. v23 saves are invalidated.
 *  25 — local disturbances added (Step 27): a top-level `disturbances` list and
 *       `nextDisturbanceId`, plus the new `DisturbanceSystem` descriptor. The
 *       records are the *only* state the mechanism has — every effect is derived
 *       from them on read — so saving them restores slow ground, cold air, and
 *       an ongoing fire all at once, and saving nothing else would be wrong in
 *       the same three ways. Note that the vegetation a fire already destroyed
 *       rides in the existing `vegetation` block, since it is simply gone. v24
 *       saves are invalidated.
 *  26 — ecosystem engineering added (Step 28): a top-level `features` block (the
 *       sparse map of worn cells) and the new `EngineeringSystem` descriptor.
 *       Ground worn down over thousands of ticks is the clearest case yet of
 *       state no seed can reproduce: it is the accumulated record of where
 *       animals have actually walked and slept. Note the per-entity
 *       `trailHeading` / `trailStrength` ride along automatically, as the
 *       migration drift does, and for the same reason — the drift is recomputed
 *       on a stagger, so a restore running on a stale null would diverge. v25
 *       saves are invalidated.
 */
import { SimulationEngine } from '../engine/SimulationEngine.js';

export const SAVE_FORMAT_VERSION = 26;

/**
 * Capture a deep, plain-data save of the engine's complete state.
 * Call between step() calls (never re-entrantly from inside a system).
 * @param {SimulationEngine} engine
 */
export function captureSimulationState(engine) {
  return structuredClone({
    formatVersion: SAVE_FORMAT_VERSION,
    simulationId: engine.simulationId,
    seed: engine.seed,
    tick: engine.tick,
    config: engine.config,
    randomStreams: engine.serializeRandomStreams(),
    entities: engine.world.entities.serialize(),
    tombstones: engine.world.serializeTombstones(),
    environment: { ...engine.world.environment },
    // Active local disturbances (Step 27), plus the id counter. Both are
    // genuinely evolved state: where a fire started and how long it has left to
    // burn is not recoverable from the seed, and a counter that restarted would
    // reissue the id of something still running.
    disturbances: engine.world.disturbances.map((d) => ({ ...d })),
    nextDisturbanceId: engine.world.nextDisturbanceId,
    // Worn ground (Step 28). Ground animals wore down over thousands of ticks
    // is the definition of evolved state — nothing about it is recoverable from
    // the seed, and a restore that forgot it would erase every trail in the
    // world at the moment of loading.
    features: engine.world.features.serialize(),
    // The report itself is derived and recomputed on the next metrics tick;
    // only the bounded history is stored, so a chart survives a restore.
    metricsHistory: engine.world.metricsHistory,
    vegetation: engine.world.vegetation.serialize(),
    scent: engine.world.scent.serialize(),
    events: engine.events.serialize(),
    pendingCommands: engine.commands.serialize(),
    systems: engine.scheduler.describeSystems(),
  });
}

/**
 * Restore a save into an engine that was constructed with the saved seed and
 * config and already has the same systems registered.
 * @param {SimulationEngine} engine
 * @param {ReturnType<typeof captureSimulationState>} saved
 * @returns {SimulationEngine} the same engine, restored
 */
export function restoreSimulationState(engine, saved) {
  if (saved?.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(`unsupported save format version: ${saved?.formatVersion} (expected ${SAVE_FORMAT_VERSION})`);
  }
  if (engine.simulationId !== saved.simulationId || engine.seed !== saved.seed) {
    throw new Error('engine identity does not match the save (construct it with the saved seed and simulationId)');
  }
  const currentSystems = JSON.stringify(engine.scheduler.describeSystems());
  const savedSystems = JSON.stringify(saved.systems);
  if (currentSystems !== savedSystems) {
    throw new Error('registered systems do not match the save; deterministic continuation is not possible');
  }
  engine.clock.setTick(saved.tick);
  engine.restoreRandomStreams(saved.randomStreams);
  engine.world.entities.restore(saved.entities);
  engine.world.restoreTombstones(saved.tombstones);
  if (saved.environment) engine.world.environment = { ...saved.environment };
  engine.world.disturbances = (saved.disturbances ?? []).map((d) => ({ ...d }));
  engine.world.nextDisturbanceId = saved.nextDisturbanceId ?? 1;
  engine.world.features.restore(saved.features);
  engine.world.metricsHistory = saved.metricsHistory ? structuredClone(saved.metricsHistory) : [];
  engine.world.metrics = null; // derived; the next metrics tick rebuilds it
  engine.world.rebuildSpatialIndex();
  engine.world.vegetation.restore(saved.vegetation);
  engine.world.scent.restore(saved.scent);
  engine.events.restore(saved.events);
  engine.commands.restore(saved.pendingCommands);
  return engine;
}

/**
 * Convenience: construct an engine from a save, register systems, restore.
 * @param {ReturnType<typeof captureSimulationState>} saved
 * @param {object} options
 * @param {(engine: SimulationEngine) => void} options.registerSystems must
 *        register exactly the systems that were registered when saving
 */
export function createEngineFromSave(saved, { registerSystems }) {
  const engine = new SimulationEngine({
    seed: saved.seed,
    config: saved.config,
    simulationId: saved.simulationId,
  });
  registerSystems?.(engine);
  return restoreSimulationState(engine, saved);
}
