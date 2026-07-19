/**
 * Deterministic, phase-ordered system scheduler.
 *
 * Execution order is fully explicit: phases run in the fixed PHASES order,
 * and within a phase systems run sorted by ascending priority, then by id
 * (lexicographic) as a tiebreaker. Registration order never affects
 * execution order.
 *
 * Systems may declare `updateInterval: N` to run only on ticks where
 * `tick % N === 0`, which is how expensive future systems (perception,
 * decision-making, vegetation growth, ...) will stagger their cost.
 */

export const PHASES = Object.freeze([
  'environment',
  'perception',
  'decision',
  'movement',
  'interaction',
  'physiology',
  'lifecycle',
  'cleanup',
  'observation',
]);

/**
 * @typedef {object} SystemDescriptor
 * @property {string} id
 * @property {string} phase
 * @property {number} priority
 * @property {number} updateInterval
 */

export class SystemScheduler {
  /** @type {Map<string, Array<{id: string, phase: string, priority: number, updateInterval: number, system: {update: Function}}>>} */
  #systemsByPhase = new Map();
  /** @type {Set<string>} */
  #systemIds = new Set();

  constructor() {
    for (const phase of PHASES) {
      this.#systemsByPhase.set(phase, []);
    }
  }

  /**
   * Register a system. Accepts SimulationSystem instances or any plain object
   * with { id, phase, update(world, context) } and optional
   * { priority, updateInterval }.
   */
  register(system) {
    if (!system || typeof system.update !== 'function') {
      throw new TypeError('a system must provide an update(world, context) function');
    }
    if (typeof system.id !== 'string' || system.id.length === 0) {
      throw new TypeError('a system must have a non-empty string id');
    }
    if (this.#systemIds.has(system.id)) {
      throw new Error(`a system with id "${system.id}" is already registered`);
    }
    if (!PHASES.includes(system.phase)) {
      throw new RangeError(`unknown phase "${system.phase}" for system "${system.id}"`);
    }
    const priority = system.priority ?? 0;
    const updateInterval = system.updateInterval ?? 1;
    if (!Number.isFinite(priority)) {
      throw new TypeError(`system "${system.id}" priority must be a finite number`);
    }
    if (!Number.isInteger(updateInterval) || updateInterval < 1) {
      throw new RangeError(`system "${system.id}" updateInterval must be a positive integer`);
    }

    this.#systemIds.add(system.id);
    const entries = this.#systemsByPhase.get(system.phase);
    entries.push({ id: system.id, phase: system.phase, priority, updateInterval, system });
    entries.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** @param {string} id */
  hasSystem(id) {
    return this.#systemIds.has(id);
  }

  /**
   * Run all systems of one phase that are due on this tick.
   * @param {string} phase
   * @param {number} tick
   * @param {import('../world/World.js').World} world
   * @param {object} context per-tick system context created by the engine
   */
  runPhase(phase, tick, world, context) {
    const entries = this.#systemsByPhase.get(phase);
    if (!entries) {
      throw new RangeError(`unknown phase "${phase}"`);
    }
    for (const entry of entries) {
      if (tick % entry.updateInterval !== 0) continue;
      entry.system.update(world, context);
    }
  }

  /**
   * Descriptors of all registered systems in execution order.
   * Used for persistence validation and tests.
   * @returns {SystemDescriptor[]}
   */
  describeSystems() {
    const descriptors = [];
    for (const phase of PHASES) {
      for (const { id, priority, updateInterval } of this.#systemsByPhase.get(phase)) {
        descriptors.push({ id, phase, priority, updateInterval });
      }
    }
    return descriptors;
  }
}
