/**
 * Forgetting (Step 15).
 *
 * The other half of `memory/memories.js`: recording a place is done by
 * whichever system experienced it (feeding, drinking, and from Step 16
 * whatever frightens an animal), while this system does the fading. Every
 * remembered place loses strength on its own schedule and drops out of the
 * list once it gets too faint, so an animal's map of the world stays small and
 * current without anyone pruning it explicitly.
 *
 * Runs in the `perception` phase at priority 10 — after perception has been
 * rebuilt and before the decision system reads either, so decisions always see
 * memories that have already aged this tick and never a stale entry that
 * should have expired.
 *
 * Staggering is the point of the `updateInterval` here (invariant 16): decay is
 * multiplied by the interval, so running every 5 ticks fades memories at the
 * same real rate as running every tick, for a fifth of the cost.
 *
 * Ownership: writes `memories[]` (strength and eviction only — never inserts).
 * No randomness, no global scans, no allocation in the common case.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { DEFAULT_DECAY } from '../memory/memories.js';

export class MemorySystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {Record<string, number>} [options.decay] strength lost per tick, per kind
   * @param {number} [options.forgetBelow] strength at which a memory is dropped
   * @param {number} [options.updateInterval]
   */
  constructor({ decay = DEFAULT_DECAY, forgetBelow = 0.05, updateInterval = 5 } = {}) {
    super({ id: 'memory', phase: 'perception', priority: 10, updateInterval });
    this.decay = { ...DEFAULT_DECAY, ...decay };
    this.forgetBelow = forgetBelow;
  }

  update(world) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const memories = entity.memories;
      if (memories.length === 0) continue;

      // Walk backwards so removing an expired memory cannot skip its neighbour.
      for (let i = memories.length - 1; i >= 0; i -= 1) {
        const memory = memories[i];
        memory.strength -= (this.decay[memory.kind] ?? 0) * this.updateInterval;
        if (memory.strength < this.forgetBelow) memories.splice(i, 1);
      }
    }
  }
}
