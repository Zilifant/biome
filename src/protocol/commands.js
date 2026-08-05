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
  // { seed?, width?, height?, founding?: [{speciesId, count}], rocks?, thickets?, trees?, roundness? }
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
 * Chosen to let a caller push the engine toward its performance ceiling without
 * an out-of-memory or a runaway build: founder spawning always terminates
 * (rejection sampling falls back to a deterministic scan) and the runner ticks
 * on a wall clock, so a heavy world slows the tick rather than wedging the host.
 * They are the guardrails, not recommendations; a caller combining both maxima
 * on the same world will find it very slow, just not broken.
 *
 * ⚠ **Raised from 1024 to 5120 on 2026-08-03** to admit landscape-scale worlds —
 * the Ngorongoro presets model a real crater at 4700×3950. The old ceiling was
 * set for "a ~1M-cell world … typed arrays in the tens of MB", and that
 * description no longer holds, so here is what was actually measured (seed 42,
 * roundness 4, 10 000 founders) rather than an estimate:
 *
 * |         world |      cells | build |  per tick |   RSS |
 * | ------------: | ---------: | ----: | --------: | ----: |
 * |     1050×885  |      929 k | 131ms |      10ms | 154MB |
 * |    1485×1250  |     1.86 M | 169ms |     192ms | 282MB |
 * |    4700×3950  |     18.6 M | 856ms |     280ms | 565MB |
 *
 * So the top of the scale is **hundreds of MB, not tens**, and a tick costs a
 * few hundred ms — still inside the runner's 1 s default, so such a world runs
 * in real time at 1× and merely falls behind at high speed multipliers. The
 * square of the new maximum (5120² ≈ 26 M cells) is the worst case and was not
 * measured; it extrapolates to roughly 800 MB. ⚠ A host that cannot afford that
 * should bound it there rather than here — this is the protocol's outer limit,
 * and a deployment's budget is not the protocol's business.
 */
export const MIN_WORLD_DIMENSION = 16;
export const MAX_WORLD_DIMENSION = 5120;

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
 *
 * ⚠ **And batch 1 made it a lie, exactly as v29 predicted it would.** The world
 * now holds *two* scavengers, and `scavengers:` can only name one of them — it
 * points at the vulture because that is the species the v28 field meant, so a v28
 * client asking for "20 scavengers" silently founds no hyena at all. That is the
 * closest thing to a defect this map can have, and it is the argument for
 * deleting it on schedule rather than teaching it to split a count: splitting
 * would be the host inventing a roster the client never asked for, which is the
 * specific lie v29 exists to stop.
 */
export const FOUNDING_ROLE_ALIASES = Object.freeze({
  herbivores: 'herbivore.gazelle',
  predators: 'predator.leopard',
  scavengers: 'scavenger.vulture',
});

/** @deprecated v29 — use MAX_FOUNDING_PER_SPECIES. Kept for the alias path. */
export const MAX_FOUNDING_HERBIVORES = 20000;
/** @deprecated v29 */
export const MAX_FOUNDING_PREDATORS = 5000;
/** @deprecated v29 */
export const MAX_FOUNDING_SCAVENGERS = 5000;

/**
 * `rocks`, `thickets` and `trees` are abstract **prevalence** levels, not counts:
 * how much of the new world the terrain type takes up. 0 is none at all and
 * MAX_TERRAIN_PREVALENCE is dense enough to crowd out open grazing ground. The
 * mapping from a level to actual generator formation counts lives host-side (see
 * buildDemoConfig), so the protocol stays in terms the UI can offer directly.
 * The demo's default terrain is DEFAULT_TERRAIN_PREVALENCE on this scale.
 *
 * ⚠ **`trees` is one level driving two generator quantities** — grove count and
 * lone-tree count — which is exactly why the abstraction is worth having: the UI
 * offers "how wooded", and how that divides between woodland and scattered trees
 * stays a host-side modelling decision the protocol never learns.
 */
export const MAX_TERRAIN_PREVALENCE = 10;
/**
 * ⚠ **2 until 2026-08-04, now 4.** The constant means "the level that reproduces
 * the demo's own terrain", and the demo became a denser world on that date (see
 * `defaultSimulationConfig.terrain`). Moving the anchor with it is what keeps the
 * *other* promise this scale makes: a preset saved at level 4 against the old
 * defaults still generates exactly the terrain it was saved with, because the
 * host's mapping is linear through this anchor and both ends doubled together.
 * Leaving it at 2 would have silently doubled every stored preset's terrain.
 */
export const DEFAULT_TERRAIN_PREVALENCE = 4;

/**
 * `roundness` is the world's *shape*, 0..MAX_ROUNDNESS: 0 is the plain
 * rectangle the world has always been, MAX_ROUNDNESS is an ellipse inscribed in
 * `width` × `height` (a circle when they are equal), and the levels between
 * round the corners off progressively. Everything outside the shape is
 * impassable.
 *
 * ⚠ Unlike `rocks` and `thickets` this is **not** a prevalence abstraction over
 * some generator quantity — the level is the setting, and the host stores it
 * verbatim. It is five levels rather than a continuous ratio so the UI can offer
 * a dropdown, matching the terrain controls beside it.
 */
export const MAX_ROUNDNESS = 4;
/** 0 (the plain rectangle) until 2026-08-04; the demo is now the crater's rim. */
export const DEFAULT_ROUNDNESS = 4;

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
