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
  // { seed?, width?, height?, founding?: [{speciesId, count}], rocks?, thickets? }
  // ⚠ v29 replaced the per-role counts with a roster. `herbivores` /
  // `predators` / `scavengers` are still accepted as **deprecated aliases** for
  // one version; see FOUNDING_ROLE_ALIASES below.
  SIMULATION_RESTART: 'simulation.restart', //     rebuild the world
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

/**
 * ⚠ **The founding roster stopped being three role counts at v29.**
 *
 * Until then `simulation.restart` took `herbivores`, `predators`, and
 * `scavengers`, which quietly assumed a bijection between a role and a species.
 * That was only ever true by coincidence, and the roster this protocol is being
 * grown for breaks it outright: a hyena is both predator and scavenger, and
 * there is no third box to put it in. Splitting a role's count across its
 * species host-side would have kept v28 and would have been exactly the lie the
 * bump exists to stop — the UI would still be offering a control whose label was
 * false.
 *
 * So restart now takes `founding: [{ speciesId, count }]`, and the **host
 * publishes its roster** on the status report so a client can build one field
 * per species from what it is told rather than from what it was compiled with.
 *
 * Bounds are per species and in total. The total is the sum of the three old
 * per-role maxima, so the ceiling is exactly what it was; the per-species cap is
 * the old herbivore one, since any single species may now be the numerous one.
 */
export const MAX_FOUNDING_PER_SPECIES = 20000;
export const MAX_FOUNDING_TOTAL = 30000;

/**
 * ⚠ **Deprecated, accepted for one version.** The v28 role fields, mapped to the
 * species that filled them in the demo. A command carrying these is translated
 * host-side (see `buildDemoConfig`) so nothing in flight breaks at the bump; a
 * command carrying both a `founding` roster and a role field is refused rather
 * than silently preferring one, because there is no reading of that which is not
 * a guess.
 *
 * ⚠ This is the **one** place a species id may appear in `src/protocol`, and it
 * exists only to retire. Delete it — and the alias handling in `validation.js`
 * and `buildDemoConfig` — at v30.
 */
export const FOUNDING_ROLE_ALIASES = Object.freeze({
  herbivores: 'herbivore.grazer',
  predators: 'predator.stalker',
  scavengers: 'scavenger.corvid',
});

/** @deprecated v29 — use MAX_FOUNDING_PER_SPECIES. Kept for the alias path. */
export const MAX_FOUNDING_HERBIVORES = 20000;
/** @deprecated v29 */
export const MAX_FOUNDING_PREDATORS = 5000;
/** @deprecated v29 */
export const MAX_FOUNDING_SCAVENGERS = 5000;

/**
 * `rocks` and `thickets` are abstract **prevalence** levels, not counts: how
 * much of the new world the terrain type takes up. 0 is none at all and
 * MAX_TERRAIN_PREVALENCE is dense enough to crowd out open grazing ground. The
 * mapping from a level to actual generator formation counts lives host-side (see
 * buildDemoConfig), so the protocol stays in terms the UI can offer directly.
 * The demo's default terrain is DEFAULT_TERRAIN_PREVALENCE on this scale.
 */
export const MAX_TERRAIN_PREVALENCE = 10;
export const DEFAULT_TERRAIN_PREVALENCE = 2;

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
