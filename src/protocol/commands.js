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
  ENTITY_SPAWN: 'entity.spawn', //                { entity: {...} }
  ENTITY_REMOVE: 'entity.remove', //              { entityId }
});

export const RUNNER_COMMAND_TYPES = new Set([
  CommandTypes.SIMULATION_PAUSE,
  CommandTypes.SIMULATION_RESUME,
  CommandTypes.SIMULATION_SET_SPEED,
  CommandTypes.SIMULATION_STEP,
]);

export const ENGINE_COMMAND_TYPES = new Set([
  CommandTypes.ENTITY_SPAWN,
  CommandTypes.ENTITY_REMOVE,
]);

/** Protocol-visible entity categories. `carcass` is produced by starvation/
 * predation death (an animal that became a carcass); it is included here so it
 * is a recognized kind (and spawnable for tests). */
export const ENTITY_KINDS = Object.freeze(['animal', 'plant', 'carcass']);

export const MAX_SPEED_MULTIPLIER = 64;
export const MAX_MANUAL_STEP_TICKS = 10000;

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
