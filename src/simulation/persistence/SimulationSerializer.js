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
 */
import { SimulationEngine } from '../engine/SimulationEngine.js';

export const SAVE_FORMAT_VERSION = 13;

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
    vegetation: engine.world.vegetation.serialize(),
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
  engine.world.rebuildSpatialIndex();
  engine.world.vegetation.restore(saved.vegetation);
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
