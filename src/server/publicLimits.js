/**
 * Public resource ceilings for a shared, anonymous deployment.
 *
 * ⚠ **The protocol's maxima are sized for a local single-user dev tool.** A
 * 5120×5120 world, 30 000 founders, 64× speed, and a 10 000-tick blocking
 * advance all exist so one operator can "push the sim to its performance
 * ceiling" on their own machine. That is the right ceiling there and the wrong
 * one on a public host, where every visitor holds *their own* engine (see
 * `SessionRegistry`) and a single request can take the whole Node process down
 * with it — a long `simulation.step` is synchronous, so it stalls every other
 * visitor's ticks, not just its own.
 *
 * So this module is a *second, lower* ceiling applied per session before the
 * command reaches the runner. It never widens what the protocol allows: a
 * command refused by `validateCommand` is still refused. It only narrows.
 *
 * ⚠ It deliberately lives at the **host** layer, not in `src/protocol`. What a
 * deployment can afford is an operational fact about a box, not part of the
 * versioned contract — a client that talks to a generous host and a stingy one
 * must not need two protocol versions. Refusals therefore come back in the
 * protocol's ordinary `errorResult` shape, which the renderer's status bar
 * already knows how to display, so this costs the client nothing.
 */
import { CommandTypes, errorResult } from '../protocol/commands.js';

/** Read a positive integer from the environment, falling back when unset/absurd. */
function envInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * The default public ceiling. Chosen to keep a session's tick well under a
 * millisecond or two at demo scale (`README.md` measures 1.01 ms/tick for a
 * 128×128 world of ~188 entities), so dozens of concurrent visitors fit one
 * small instance.
 */
export const DEFAULT_PUBLIC_LIMITS = Object.freeze({
  maxWorldDimension: 256,
  maxFoundingTotal: 600,
  maxSpeedMultiplier: 8,
  maxStepTicks: 500,
});

/**
 * Resolve the ceiling from the environment.
 *
 * `admin` returns `null`, which means *no host ceiling at all* — the protocol's
 * own maxima are the only limit, exactly as when running locally. That is the
 * whole point of the flag: the operator keeps the tool they had.
 *
 * @param {object} [env]
 * @returns {object | null} null when unlimited (admin)
 */
export function resolvePublicLimits(env = process.env) {
  if (env.BIOME_ADMIN === '1') return null;
  return Object.freeze({
    maxWorldDimension: envInt(env.BIOME_MAX_WORLD_DIMENSION, DEFAULT_PUBLIC_LIMITS.maxWorldDimension),
    maxFoundingTotal: envInt(env.BIOME_MAX_FOUNDING_TOTAL, DEFAULT_PUBLIC_LIMITS.maxFoundingTotal),
    maxSpeedMultiplier: envInt(env.BIOME_MAX_SPEED, DEFAULT_PUBLIC_LIMITS.maxSpeedMultiplier),
    maxStepTicks: envInt(env.BIOME_MAX_STEP_TICKS, DEFAULT_PUBLIC_LIMITS.maxStepTicks),
  });
}

/**
 * Total founders a restart command asks for, across either spelling.
 *
 * ⚠ Both the v29 `founding` roster and the deprecated role aliases are counted,
 * because a ceiling that only knew the new spelling would be trivially bypassed
 * by using the old one — and validation still accepts the old one for another
 * version.
 *
 * Returns null when the command names no founders at all, which must read as
 * "use the host's defaults" rather than as a total of zero.
 * @param {object} command
 * @returns {number | null}
 */
function requestedFounders(command) {
  let total = null;
  if (Array.isArray(command.founding)) {
    total = 0;
    for (const entry of command.founding) {
      const count = Number(entry?.count);
      if (Number.isFinite(count)) total += count;
    }
  }
  for (const field of ['herbivores', 'predators', 'scavengers']) {
    const count = Number(command[field]);
    if (Number.isFinite(count)) total = (total ?? 0) + count;
  }
  return total;
}

/**
 * Check one command against the ceiling.
 *
 * ⚠ Returns an **error result** to send back, or `null` when the command is
 * allowed — deliberately not a boolean, so the reason a request was refused is
 * carried to the client rather than reconstructed there. Pure: it reads the
 * command and the limits and touches no state, so it is testable without a
 * server.
 *
 * @param {object} command a command that has already passed `validateCommand`
 * @param {object | null} limits from `resolvePublicLimits`; null disables checking
 * @returns {object | null} an `errorResult` to return, or null to proceed
 */
export function checkCommand(command, limits) {
  if (!limits || !command || typeof command !== 'object') return null;

  switch (command.type) {
    case CommandTypes.SIMULATION_SET_SPEED: {
      if (Number(command.multiplier) > limits.maxSpeedMultiplier) {
        return errorResult(
          'speed-limit',
          `this host allows speeds up to ${limits.maxSpeedMultiplier}x`,
        );
      }
      return null;
    }
    case CommandTypes.SIMULATION_STEP: {
      // The expensive one: `stepManually` is synchronous, so a long advance
      // blocks every session on this process, not only the one that asked.
      if (Number(command.ticks ?? 1) > limits.maxStepTicks) {
        return errorResult(
          'step-limit',
          `this host advances at most ${limits.maxStepTicks} ticks at once`,
        );
      }
      return null;
    }
    case CommandTypes.SIMULATION_RESTART: {
      for (const field of ['width', 'height']) {
        if (command[field] !== undefined && Number(command[field]) > limits.maxWorldDimension) {
          return errorResult(
            'world-size-limit',
            `this host builds worlds up to ${limits.maxWorldDimension}×${limits.maxWorldDimension}`,
          );
        }
      }
      const founders = requestedFounders(command);
      if (founders !== null && founders > limits.maxFoundingTotal) {
        return errorResult(
          'founding-limit',
          `this host founds at most ${limits.maxFoundingTotal} animals`,
        );
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Wrap a runner's `handleCommand` with the ceiling.
 *
 * ⚠ The guard runs *before* the runner sees the command, so a refused command
 * never touches world state — which is what makes this safe to apply to a live
 * session rather than something that has to be checked at world-build time.
 *
 * @param {import('./SimulationRunner.js').SimulationRunner} runner
 * @param {object | null} limits
 * @returns {(command: object) => object}
 */
export function guardedCommandHandler(runner, limits) {
  return (command) => checkCommand(command, limits) ?? runner.handleCommand(command);
}
