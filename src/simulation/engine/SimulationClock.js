/**
 * Authoritative tick counter. The clock knows nothing about wall-clock time;
 * real-time pacing is owned by the host (SimulationRunner). One tick is one
 * authoritative simulation step, regardless of how fast it is executed.
 */
export class SimulationClock {
  #tick = 0;

  /** @returns {number} current tick (0 before the first step) */
  get tick() {
    return this.#tick;
  }

  /**
   * Advance by exactly one tick.
   * @returns {number} the new tick number
   */
  advance() {
    this.#tick += 1;
    return this.#tick;
  }

  /**
   * Restore the tick counter from a save.
   * @param {number} tick
   */
  setTick(tick) {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new RangeError(`tick must be a non-negative integer, got ${tick}`);
    }
    this.#tick = tick;
  }
}
