/**
 * Population metrics (Step 21).
 *
 * Runs in the `observation` phase — the last phase of the tick, after deferred
 * spawns and removals have flushed — so it always sees the settled state and
 * never a half-applied one. Staggered, because a full aggregate is an O(N) pass
 * and nothing needs it every tick.
 *
 * Ownership: writes `world.metrics` (the latest report) and appends to a
 * bounded history. It reads organism state and writes none of it back, which is
 * the point: selection has to emerge from survival and reproduction, and a
 * metrics layer that touched anything would be measuring itself.
 *
 * No randomness, no events. The report is fetched through the `metrics` query
 * rather than pushed per tick — histograms for every trait of every species
 * would dwarf the entity array in a per-tick payload, and a summary view does
 * not need tick resolution.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { computeMetrics, summarizeForHistory } from '../metrics/metrics.js';

export class MetricsSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.windowTicks] how far back births/deaths are counted
   * @param {number} [options.historyLength] bounded time-series samples kept
   * @param {number} [options.updateInterval] aggregation cadence
   */
  constructor({ windowTicks = 500, historyLength = 120, updateInterval = 50 } = {}) {
    super({ id: 'metrics', phase: 'observation', priority: 0, updateInterval });
    this.windowTicks = windowTicks;
    this.historyLength = historyLength;
  }

  update(world, context) {
    const report = computeMetrics(world, { tick: context.tick, windowTicks: this.windowTicks });
    world.metrics = report;

    // A bounded series of a few scalars — enough to draw a trend, far short of
    // the per-organism histories the observation roadmap rules out.
    world.metricsHistory.push(summarizeForHistory(report));
    const overflow = world.metricsHistory.length - this.historyLength;
    if (overflow > 0) world.metricsHistory.splice(0, overflow);
  }
}
