import { SeededRandom } from '../random/SeededRandom.js';
import { TerrainType } from './TerrainGrid.js';

/**
 * Cell-level vegetation biomass — grass and low cover as a continuous field,
 * not thousands of plant entities (invariant 17). One Float32Array of biomass
 * per world cell, plus a static per-cell carrying capacity derived from
 * terrain suitability and a seeded fertility field.
 *
 * Ownership: biomass is written only by `VegetationSystem` (logistic regrowth)
 * and by feeding (`consumeAt`, Step 9). Every mutation bumps `revision` so the
 * snapshot projection and per-tick deltas can be gated cheaply.
 *
 * Suitability (which cells can grow anything) is authoritative and derived
 * from terrain: rock and water support no vegetation.
 */

const EPSILON = 1e-6;

export const DEFAULT_VEGETATION_PARAMS = Object.freeze({
  capacity: 8, // reference biomass of a fully grown suitability-1 cell
  growthRate: 0.08, // logistic rate per vegetation update
  seedFloor: 0.08, // colonization term so grazed/bare suitable cells regrow
  initialFraction: 0.5, // initial biomass as a fraction of capacity (× random)
  minFertility: 0.55, // per-cell fertility varies in [minFertility, 1]
  coverSuitability: 1.35, // cover terrain is more fertile than open ground
  quantizeLevels: 4, // biomass projects to integer levels 0..quantizeLevels
});

/**
 * Terrain suitability multiplier for vegetation. Rock and water grow nothing.
 * @param {number} terrainCode
 * @param {number} coverSuitability
 */
function suitabilityFor(terrainCode, coverSuitability) {
  switch (terrainCode) {
    case TerrainType.GROUND:
      return 1;
    case TerrainType.COVER:
      return coverSuitability;
    default:
      return 0; // water, rock
  }
}

export class VegetationGrid {
  #width;
  #height;
  /** @type {Float32Array} biomass per cell */
  #biomass;
  /** @type {Float32Array} static per-cell carrying capacity (0 where unsuitable) */
  #capacityPerCell;
  #capacity;
  #maxLevel;
  #revision = 0;

  /**
   * @param {object} options
   * @param {import('./TerrainGrid.js').TerrainGrid} options.terrain
   * @param {number} options.seed deterministic vegetation seed
   * @param {object} [options.params]
   */
  constructor({ terrain, seed, params = {} }) {
    const merged = { ...DEFAULT_VEGETATION_PARAMS, ...params };
    this.#width = terrain.width;
    this.#height = terrain.height;
    this.#capacity = merged.capacity;
    this.#maxLevel = merged.quantizeLevels;
    const total = this.#width * this.#height;
    this.#biomass = new Float32Array(total);
    this.#capacityPerCell = new Float32Array(total);
    this.#seed(new SeededRandom(seed), terrain, merged);
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get maxLevel() {
    return this.#maxLevel;
  }

  get revision() {
    return this.#revision;
  }

  #index(cellX, cellY) {
    return cellY * this.#width + cellX;
  }

  #inBounds(cellX, cellY) {
    return cellX >= 0 && cellY >= 0 && cellX < this.#width && cellY < this.#height;
  }

  /**
   * Seed static carrying capacity (terrain suitability × per-cell fertility)
   * and an initial biomass field. Two draws per cell, fixed order → seeded and
   * deterministic.
   */
  #seed(random, terrain, params) {
    for (let y = 0; y < this.#height; y += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        const i = this.#index(x, y);
        const suitability = suitabilityFor(terrain.codeAt(x, y), params.coverSuitability);
        const fertility = random.float(params.minFertility, 1);
        const capacity = suitability > 0 ? this.#capacity * suitability * fertility : 0;
        this.#capacityPerCell[i] = capacity;
        this.#biomass[i] = capacity > 0 ? capacity * random.float(0, params.initialFraction) : 0;
      }
    }
    this.#revision += 1;
  }

  /** Raw biomass at a cell (0 when out of bounds). */
  biomassAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return 0;
    return this.#biomass[this.#index(cellX, cellY)];
  }

  /** Static carrying capacity at a cell (0 where nothing grows). */
  capacityAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return 0;
    return this.#capacityPerCell[this.#index(cellX, cellY)];
  }

  /**
   * Quantized biomass level for projection: 0 when bare, else 1..maxLevel by
   * fraction of the reference capacity. Any nonzero biomass shows at level ≥ 1.
   * @param {number} cellX @param {number} cellY
   * @returns {number}
   */
  levelAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return 0;
    const biomass = this.#biomass[this.#index(cellX, cellY)];
    if (biomass <= EPSILON) return 0;
    const fraction = biomass / this.#capacity;
    return Math.min(this.#maxLevel, Math.max(1, Math.ceil(fraction * this.#maxLevel)));
  }

  /**
   * Logistic growth toward each cell's carrying capacity, called by
   * `VegetationSystem` and staggered by its update interval.
   *
   * `capacityScale` is the seasonal lever (Step 19). Scaling the growth *rate*
   * alone cannot make winter look like winter: a field already sitting at
   * capacity simply stops growing and stays green. Scaling the *target* is what
   * produces real dieback — biomass above the seasonal ceiling decays back down
   * toward it, so the map browns off in autumn and greens up in spring.
   *
   * At the default `capacityScale: 1` this is monotonic non-decreasing without
   * grazing, exactly as before.
   *
   * @param {object} params
   * @param {number} params.growthRate
   * @param {number} params.seedFloor
   * @param {number} [params.capacityScale] seasonal fraction of full capacity
   * @param {number} [params.diebackRate] how fast biomass above the ceiling falls
   */
  grow({ growthRate, seedFloor, capacityScale = 1, diebackRate = 0.04 }) {
    for (let i = 0; i < this.#biomass.length; i += 1) {
      const fullCapacity = this.#capacityPerCell[i];
      if (fullCapacity <= 0) continue;
      const capacity = fullCapacity * capacityScale;
      const biomass = this.#biomass[i];
      if (biomass > capacity) {
        // Above the season's ceiling: decay toward it rather than snapping, so
        // the change reads as a fade rather than a step.
        this.#biomass[i] = Math.max(capacity, biomass - diebackRate * (biomass - capacity));
        continue;
      }
      if (capacity <= 0 || biomass >= capacity) continue;
      const next = biomass + growthRate * (biomass + seedFloor) * (1 - biomass / capacity);
      this.#biomass[i] = Math.min(capacity, next);
    }
    this.#revision += 1;
  }

  /**
   * Remove up to `amount` biomass from a cell (feeding hook for Step 9).
   * @param {number} cellX @param {number} cellY @param {number} amount
   * @returns {number} biomass actually removed
   */
  consumeAt(cellX, cellY, amount) {
    if (!this.#inBounds(cellX, cellY) || amount <= 0) return 0;
    const i = this.#index(cellX, cellY);
    const removed = Math.min(this.#biomass[i], amount);
    if (removed > 0) {
      this.#biomass[i] -= removed;
      this.#revision += 1;
    }
    return removed;
  }

  /**
   * Add biomass to a cell, clamped to its carrying capacity (nutrient return
   * from a decayed carcass, Step 18). The counterpart of `consumeAt`; a cell
   * that cannot support more growth simply does not.
   * @param {number} cellX @param {number} cellY @param {number} amount
   * @returns {number} biomass actually added
   */
  addAt(cellX, cellY, amount) {
    if (!this.#inBounds(cellX, cellY) || amount <= 0) return 0;
    const i = this.#index(cellX, cellY);
    const capacity = this.#capacityPerCell[i];
    const added = Math.min(amount, Math.max(0, capacity - this.#biomass[i]));
    if (added > 0) {
      this.#biomass[i] += added;
      this.#revision += 1;
    }
    return added;
  }

  /** Total biomass, for tests and metrics. */
  totalBiomass() {
    let sum = 0;
    for (let i = 0; i < this.#biomass.length; i += 1) sum += this.#biomass[i];
    return sum;
  }

  /**
   * Row-major quantized levels as a plain number array (for RLE encoding and
   * diffing). Length width*height.
   * @returns {number[]}
   */
  levels() {
    const out = new Array(this.#width * this.#height);
    for (let y = 0; y < this.#height; y += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        out[this.#index(x, y)] = this.levelAt(x, y);
      }
    }
    return out;
  }

  serialize() {
    return { biomass: Array.from(this.#biomass), revision: this.#revision };
  }

  /** @param {ReturnType<VegetationGrid['serialize']>} saved */
  restore(saved) {
    this.#biomass = Float32Array.from(saved.biomass);
    this.#revision = saved.revision;
  }
}

/**
 * Encode a row-major level array as run-length pairs [level, count].
 * @param {number[]} levels
 * @returns {Array<[number, number]>}
 */
export function encodeLevelRuns(levels) {
  const runs = [];
  if (levels.length === 0) return runs;
  let currentLevel = levels[0];
  let count = 0;
  for (const level of levels) {
    if (level === currentLevel) {
      count += 1;
    } else {
      runs.push([currentLevel, count]);
      currentLevel = level;
      count = 1;
    }
  }
  runs.push([currentLevel, count]);
  return runs;
}

/**
 * Renderer-neutral vegetation projection carried by full snapshots.
 * @param {VegetationGrid} vegetation
 */
export function projectVegetation(vegetation) {
  return {
    width: vegetation.width,
    height: vegetation.height,
    maxLevel: vegetation.maxLevel,
    revision: vegetation.revision,
    encoding: 'rle-row-major',
    runs: encodeLevelRuns(vegetation.levels()),
  };
}
