/**
 * Structural validation for protocol messages arriving from the outside
 * world. Every transport and the engine's command processor validate through
 * these functions before anything touches simulation state.
 *
 * Validation results are { ok, errors } where errors is a list of
 * { path, message } objects.
 */
import {
  CommandTypes,
  ENTITY_KINDS,
  MAX_FOUNDING_HERBIVORES,
  MAX_FOUNDING_PREDATORS,
  MAX_FOUNDING_SCAVENGERS,
  MAX_MANUAL_STEP_TICKS,
  MAX_SEED,
  MAX_SPEED_MULTIPLIER,
  MAX_WORLD_DIMENSION,
  MIN_WORLD_DIMENSION,
  SEXES,
} from './commands.js';

/**
 * @typedef {{path: string, message: string}} ValidationError
 * @typedef {{ok: boolean, errors: ValidationError[]}} ValidationResult
 */

/** @returns {ValidationResult} */
function result(errors) {
  return { ok: errors.length === 0, errors };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireFiniteNumber(value, path, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path, message: 'must be a finite number' });
    return false;
  }
  return true;
}

/**
 * Validate a field that is optional but, when present, must be an integer in
 * [min, max]. Pushes one error and returns false on a violation; a missing
 * field is silently accepted.
 */
function validateOptionalIntInRange(value, path, min, max, errors) {
  if (value === undefined) return true;
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push({ path, message: `must be an integer in [${min}, ${max}]` });
    return false;
  }
  return true;
}

function validateSpawnEntity(entity, errors) {
  if (!isPlainObject(entity)) {
    errors.push({ path: 'entity', message: 'must be an object' });
    return;
  }
  if (!ENTITY_KINDS.includes(entity.kind)) {
    errors.push({ path: 'entity.kind', message: `must be one of: ${ENTITY_KINDS.join(', ')}` });
  }
  if (typeof entity.speciesId !== 'string' || entity.speciesId.length === 0) {
    errors.push({ path: 'entity.speciesId', message: 'must be a non-empty string' });
  }
  requireFiniteNumber(entity.x, 'entity.x', errors);
  requireFiniteNumber(entity.y, 'entity.y', errors);
  if (entity.heading !== undefined) requireFiniteNumber(entity.heading, 'entity.heading', errors);
  if (entity.energy !== undefined && requireFiniteNumber(entity.energy, 'entity.energy', errors) && entity.energy < 0) {
    errors.push({ path: 'entity.energy', message: 'must be >= 0' });
  }
  if (entity.maxEnergy !== undefined && requireFiniteNumber(entity.maxEnergy, 'entity.maxEnergy', errors) && entity.maxEnergy <= 0) {
    errors.push({ path: 'entity.maxEnergy', message: 'must be > 0' });
  }
  if (entity.bodyMass !== undefined && requireFiniteNumber(entity.bodyMass, 'entity.bodyMass', errors) && entity.bodyMass <= 0) {
    errors.push({ path: 'entity.bodyMass', message: 'must be > 0' });
  }
  if (entity.speed !== undefined && requireFiniteNumber(entity.speed, 'entity.speed', errors) && entity.speed < 0) {
    errors.push({ path: 'entity.speed', message: 'must be >= 0' });
  }
  if (entity.health !== undefined && requireFiniteNumber(entity.health, 'entity.health', errors) && entity.health < 0) {
    errors.push({ path: 'entity.health', message: 'must be >= 0' });
  }
  if (entity.maxHealth !== undefined && requireFiniteNumber(entity.maxHealth, 'entity.maxHealth', errors) && entity.maxHealth <= 0) {
    errors.push({ path: 'entity.maxHealth', message: 'must be > 0' });
  }
  if (entity.hydration !== undefined && requireFiniteNumber(entity.hydration, 'entity.hydration', errors) && entity.hydration < 0) {
    errors.push({ path: 'entity.hydration', message: 'must be >= 0' });
  }
  if (entity.maxHydration !== undefined && requireFiniteNumber(entity.maxHydration, 'entity.maxHydration', errors) && entity.maxHydration <= 0) {
    errors.push({ path: 'entity.maxHydration', message: 'must be > 0' });
  }
  // Sex is optional (an unsexed spawn simply never breeds), but if it is given
  // it has to be one the engine understands — a typo'd sex would silently
  // produce an animal no mate search can ever match.
  if (entity.sex !== undefined && entity.sex !== null && !SEXES.includes(entity.sex)) {
    errors.push({ path: 'entity.sex', message: `must be one of: ${SEXES.join(', ')}` });
  }
}

/**
 * Validate any protocol command.
 * @param {unknown} command
 * @returns {ValidationResult}
 */
export function validateCommand(command) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (!isPlainObject(command)) {
    return result([{ path: '', message: 'command must be an object' }]);
  }
  if (typeof command.type !== 'string') {
    return result([{ path: 'type', message: 'command type must be a string' }]);
  }
  switch (command.type) {
    case CommandTypes.SIMULATION_PAUSE:
    case CommandTypes.SIMULATION_RESUME:
      break;
    case CommandTypes.SIMULATION_SET_SPEED:
      if (requireFiniteNumber(command.multiplier, 'multiplier', errors)) {
        if (command.multiplier <= 0 || command.multiplier > MAX_SPEED_MULTIPLIER) {
          errors.push({ path: 'multiplier', message: `must be in (0, ${MAX_SPEED_MULTIPLIER}]` });
        }
      }
      break;
    case CommandTypes.SIMULATION_STEP:
      if (command.ticks !== undefined) {
        if (!Number.isInteger(command.ticks) || command.ticks < 1 || command.ticks > MAX_MANUAL_STEP_TICKS) {
          errors.push({ path: 'ticks', message: `must be an integer in [1, ${MAX_MANUAL_STEP_TICKS}]` });
        }
      }
      break;
    case CommandTypes.SIMULATION_RESTART:
      // Seed is optional: omitting it restarts the *same* world from tick 0,
      // which is a different and equally useful request from "give me another
      // world". Either way the outcome is fully determined by the seed, so a
      // caller that wants a random world picks the number and can say which
      // one it got.
      if (command.seed !== undefined) {
        if (!Number.isInteger(command.seed) || command.seed < 0 || command.seed > MAX_SEED) {
          errors.push({ path: 'seed', message: `must be an integer in [0, ${MAX_SEED}]` });
        }
      }
      // Optional world composition: dimensions and per-role founder counts.
      // Each is independently optional; an omitted field keeps the demo default.
      // Bounds are the protocol's, so a hostile or fat-fingered field is refused
      // here rather than crashing the build (see MAX_* in commands.js).
      validateOptionalIntInRange(command.width, 'width', MIN_WORLD_DIMENSION, MAX_WORLD_DIMENSION, errors);
      validateOptionalIntInRange(command.height, 'height', MIN_WORLD_DIMENSION, MAX_WORLD_DIMENSION, errors);
      validateOptionalIntInRange(command.herbivores, 'herbivores', 0, MAX_FOUNDING_HERBIVORES, errors);
      validateOptionalIntInRange(command.predators, 'predators', 0, MAX_FOUNDING_PREDATORS, errors);
      validateOptionalIntInRange(command.scavengers, 'scavengers', 0, MAX_FOUNDING_SCAVENGERS, errors);
      break;
    case CommandTypes.ENTITY_SPAWN:
      validateSpawnEntity(command.entity, errors);
      break;
    case CommandTypes.ENTITY_REMOVE:
      if (!Number.isInteger(command.entityId) || command.entityId < 1) {
        errors.push({ path: 'entityId', message: 'must be a positive integer' });
      }
      break;
    default:
      errors.push({ path: 'type', message: `unknown command type "${command.type}"` });
  }
  return result(errors);
}

/**
 * Validate a rectangular world-space bounds object.
 * @param {unknown} bounds
 * @returns {ValidationResult}
 */
export function validateBounds(bounds) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (!isPlainObject(bounds)) {
    return result([{ path: 'bounds', message: 'must be an object' }]);
  }
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
    requireFiniteNumber(bounds[key], `bounds.${key}`, errors);
  }
  if (errors.length === 0) {
    if (bounds.minX > bounds.maxX) errors.push({ path: 'bounds.minX', message: 'minX must be <= maxX' });
    if (bounds.minY > bounds.maxY) errors.push({ path: 'bounds.minY', message: 'minY must be <= maxY' });
  }
  return result(errors);
}

/**
 * Join validation errors into a single human-readable message.
 * @param {ValidationError[]} errors
 */
export function formatErrors(errors) {
  return errors.map(({ path, message }) => (path ? `${path}: ${message}` : message)).join('; ');
}
