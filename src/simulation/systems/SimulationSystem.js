/**
 * Optional base class for simulation systems.
 *
 * A system is any object with { id, phase, update(world, context) } plus
 * optional { priority, updateInterval } — the scheduler also accepts plain
 * objects. This class only provides constructor validation and a helpful
 * error when update() is not implemented.
 *
 * State-ownership rules for every system:
 *  - Systems may read world state and mutate fields of existing entities.
 *  - Systems must NOT structurally add/remove entities directly; they use
 *    context.queueSpawn(...) / context.queueRemove(...) and the engine
 *    applies those at a safe lifecycle boundary.
 *  - Systems draw randomness only from context.random(streamName).
 *  - Systems announce observable facts via context.emit(type, payload).
 */
export class SimulationSystem {
  /**
   * @param {object} options
   * @param {string} options.id unique system id
   * @param {string} options.phase one of the scheduler PHASES
   * @param {number} [options.priority] lower runs earlier within the phase
   * @param {number} [options.updateInterval] run every N ticks (default 1)
   */
  constructor({ id, phase, priority = 0, updateInterval = 1 }) {
    this.id = id;
    this.phase = phase;
    this.priority = priority;
    this.updateInterval = updateInterval;
  }

  /**
   * @param {import('../world/World.js').World} _world
   * @param {object} _context
   */
  update(_world, _context) {
    throw new Error(`system "${this.id}" must implement update(world, context)`);
  }
}
