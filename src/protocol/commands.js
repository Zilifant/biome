/**
 * Command contract. Commands are the ONLY way external consumers change
 * simulation state.
 *
 * Two application points, both part of the versioned contract:
 *  - RUNNER commands are wall-clock concerns applied by the real-time host
 *    (pause, resume, speed, manual step). They never change the deterministic
 *    outcome of a given number of ticks.
 *  - ENGINE commands are queued and applied by the engine at the next tick
 *    boundary, in submission order, so they are part of the deterministic
 *    input sequence.
 */
import { PROTOCOL_VERSION } from './protocolVersion.js';

export const CommandTypes = Object.freeze({
  SIMULATION_PAUSE: 'simulation.pause',
  SIMULATION_RESUME: 'simulation.resume',
  SIMULATION_SET_SPEED: 'simulation.setSpeed', // { multiplier }
  SIMULATION_STEP: 'simulation.step', //          { ticks } (only while paused)
  SIMULATION_RESTART: 'simulation.restart', //     { seed?, width?, height?, herbivores?, predators?, scavengers? } rebuild the world
  ENTITY_SPAWN: 'entity.spawn', //                { entity: {...} }
  ENTITY_REMOVE: 'entity.remove', //              { entityId }
});

export const RUNNER_COMMAND_TYPES = new Set([
  CommandTypes.SIMULATION_PAUSE,
  CommandTypes.SIMULATION_RESUME,
  CommandTypes.SIMULATION_SET_SPEED,
  CommandTypes.SIMULATION_STEP,
  CommandTypes.SIMULATION_RESTART,
]);

export const ENGINE_COMMAND_TYPES = new Set([
  CommandTypes.ENTITY_SPAWN,
  CommandTypes.ENTITY_REMOVE,
]);

/** Protocol-visible entity categories. `carcass` is produced by starvation/
 * predation death (an animal that became a carcass); it is included here so it
 * is a recognized kind (and spawnable for tests). */
export const ENTITY_KINDS = Object.freeze(['animal', 'plant', 'carcass']);

/**
 * Protocol-visible sexes (Step 22). Part of the contract rather than a
 * simulation detail, because `sex` rides in every bulk snapshot — the renderer
 * draws it, so it needs a vocabulary it can rely on. Non-animals (and animals
 * created without one) carry `null`, which consumers must tolerate.
 */
export const SEXES = Object.freeze(['female', 'male']);

export const MAX_SPEED_MULTIPLIER = 64;
/** Seeds are unsigned 32-bit, matching the engine's `seed >>> 0`. */
export const MAX_SEED = 0xffffffff;
export const MAX_MANUAL_STEP_TICKS = 10000;

/**
 * Bounds for the optional world-composition fields on `simulation.restart`.
 * Chosen to let a caller push the engine toward its performance ceiling — a
 * ~1M-cell world and tens of thousands of founders — without an out-of-memory
 * or a runaway build: terrain/vegetation layers are typed arrays that stay in
 * the tens of MB at the maximum dimension, founder spawning always terminates
 * (rejection sampling falls back to a deterministic scan), and the runner ticks
 * on a wall clock so a heavy world slows the tick rather than wedging the host.
 * They are the guardrails, not recommendations; a caller combining both maxima
 * on the same world will find it very slow, just not broken.
 */
export const MIN_WORLD_DIMENSION = 16;
export const MAX_WORLD_DIMENSION = 1024;
export const MAX_FOUNDING_HERBIVORES = 20000;
export const MAX_FOUNDING_PREDATORS = 5000;
export const MAX_FOUNDING_SCAVENGERS = 5000;

/**
 * Successful command result.
 * @param {object} [fields] command-specific result fields
 */
export function okResult(fields = {}) {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, ...fields };
}

/**
 * Failed command result.
 * @param {string} code stable machine-readable error code
 * @param {string} message human-readable explanation
 */
export function errorResult(code, message) {
  return { protocolVersion: PROTOCOL_VERSION, ok: false, error: { code, message } };
}
