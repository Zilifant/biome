import { SimulationSystem } from './SimulationSystem.js';

/**
 * Grows the cell-level vegetation biomass field via logistic regrowth toward
 * each cell's terrain-derived carrying capacity. Runs in the `environment`
 * phase and is staggered by `updateInterval` — vegetation changes slowly, so
 * it need not run every tick (invariant 16; the largest cell loop in the
 * simulation).
 *
 * Ownership: writes only `world.vegetation` biomass (regrowth); reads the
 * global environment for the seasonal growth modifier. Consumption is a
 * separate concern (feeding, Step 9). No randomness — regrowth is
 * deterministic; the seeded variation lives in the initial field and per-cell
 * capacity.
 */
export class VegetationSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.growthRate]
   * @param {number} [options.seedFloor]
   * @param {number} [options.updateInterval]
   */
  constructor({ growthRate = 0.08, seedFloor = 0.08, diebackRate = 0.04, updateInterval = 5 } = {}) {
    super({ id: 'vegetation.growth', phase: 'environment', priority: 0, updateInterval });
    this.growthRate = growthRate;
    this.seedFloor = seedFloor;
    this.diebackRate = diebackRate;
  }

  update(world) {
    // Season and weather scale growth (Step 19): a wet spring greens the map,
    // a drought stalls it, and under snow nothing grows at all.
    const environment = world.environment;
    const modifier = environment?.growthModifier ?? 1;
    const capacityScale = environment?.capacityModifier ?? 1;
    world.vegetation.grow({
      growthRate: this.growthRate * modifier,
      seedFloor: this.seedFloor * modifier,
      capacityScale,
      diebackRate: this.diebackRate,
    });
  }
}
