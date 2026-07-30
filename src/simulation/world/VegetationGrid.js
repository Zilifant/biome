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
  // Edge forage taper (off here; the demo world turns it on). Carrying capacity
  // ramps from 0 at the map boundary up to full over an inland band, so grazers
  // have a productive interior to be in rather than a uniformly green map right
  // up to the wall — the habitat half of the edge-congregation fix, paired with
  // edge-aware fleeing. See buildEdgeTaper below for the shape (gradual,
  // slightly irregular, and rounded harder at the corners).
  edgeTaperFraction: 0, // band width as a fraction of the smaller map dimension; 0 = no taper
  edgeTaperIrregularity: 0.4, // coastline wobble, as a fraction of the band width
  edgeTaperCornerBoost: 1.5, // extra corner-rounding radius (× band width); 0 = square corners
  edgeTaperMinDimension: 96, // maps smaller than this get no taper (keeps test sandboxes untouched)
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

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smooth 0→1 ramp with zero slope at both ends (Hermite). */
function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Coherent value noise on a coarse lattice, bilinearly interpolated with a
 * smooth fade — enough to wobble a coastline without the static look of
 * per-cell white noise, and far cheaper than gradient noise. Values in [-1, 1].
 * @param {import('../random/SeededRandom.js').SeededRandom} random
 * @param {number} res lattice cells per axis (low → long, smooth waves)
 */
function makeValueNoise(random, res) {
  const stride = res + 1;
  const grid = new Float32Array(stride * stride);
  for (let i = 0; i < grid.length; i += 1) grid[i] = random.float(-1, 1);
  return (x, y, width, height) => {
    const gx = (x / width) * res;
    const gy = (y / height) * res;
    const x0 = Math.min(res - 1, Math.max(0, Math.floor(gx)));
    const y0 = Math.min(res - 1, Math.max(0, Math.floor(gy)));
    const tx = smoothstep01(gx - x0);
    const ty = smoothstep01(gy - y0);
    const at = (ix, iy) => grid[iy * stride + ix];
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

/**
 * A per-cell carrying-capacity multiplier in [0, 1] that tapers forage off the
 * map's edges, or `null` when the taper is disabled or the map is too small to
 * bother. It is the habitat half of the edge-congregation fix: grazers pushed to
 * the boundary find nothing to eat there, so the productive interior is where
 * they want to be, rather than the map being uniformly green up to the wall.
 *
 * Three shape choices, all deliberate:
 *
 *   - **Gradual.** Capacity ramps from 0 at the boundary to full over an inland
 *     band (`edgeTaperFraction` of the smaller dimension) via `smoothstep`, so
 *     there is a forage gradient to drift up rather than a green/barren cliff.
 *   - **Slightly irregular.** Each edge's distance is nudged by low-frequency
 *     coherent noise, so the productive coastline wobbles instead of being a
 *     perfect rectangle — which also reads naturally once the world becomes an
 *     irregular island.
 *   - **Rounder at the corners.** The two axis tapers are *multiplied*, so a
 *     corner (inside both bands) is suppressed far more than a straight edge; a
 *     `edgeTaperCornerBoost` radial term carves the corners back further still.
 *     A right-angle corner is both the worst predator trap and the least
 *     island-like shape, so it is rounded off hardest on purpose.
 *
 * The noise draws from a dedicated stream, so enabling the taper never shifts
 * the vegetation grid's own per-cell RNG sequence.
 *
 * @param {{width:number,height:number,seed:number,params:object}} options
 * @returns {((x:number, y:number) => number) | null}
 */
export function buildEdgeTaper({ width, height, seed, params }) {
  const fraction = params.edgeTaperFraction ?? 0;
  const minDim = Math.min(width, height);
  if (!(fraction > 0) || minDim < (params.edgeTaperMinDimension ?? 0)) return null;

  const band = Math.max(1, fraction * minDim);
  const irregular = (params.edgeTaperIrregularity ?? 0) * band;
  const cornerBoost = Math.max(0, params.edgeTaperCornerBoost ?? 0);
  const noiseRandom = new SeededRandom((seed ^ 0x5f356495) >>> 0);
  const noiseX = makeValueNoise(noiseRandom, 5);
  const noiseY = makeValueNoise(noiseRandom, 5);

  return (x, y) => {
    const dx = Math.min(x, width - 1 - x);
    const dy = Math.min(y, height - 1 - y);
    const fx = smoothstep01((dx + noiseX(x, y, width, height) * irregular) / band);
    const fy = smoothstep01((dy + noiseY(x, y, width, height) * irregular) / band);
    let t = fx * fy;
    if (cornerBoost > 0) {
      // Extra corner rounding: a quarter-disc of low forage carved out of each
      // corner, using the true (un-wobbled) corner distance so the rounding is
      // stable while the coastline around it wanders.
      t *= smoothstep01(Math.hypot(dx, dy) / (band * cornerBoost));
    }
    return clamp01(t);
  };
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
    // Built from a dedicated stream so its noise never shifts the per-cell
    // fertility/biomass draws below; null when disabled or the map is too small.
    const taper = buildEdgeTaper({ width: this.#width, height: this.#height, seed, params: merged });
    this.#seed(new SeededRandom(seed), terrain, merged, taper);
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
   * Seed static carrying capacity (terrain suitability × per-cell fertility ×
   * optional edge taper) and an initial biomass field. Two draws per cell, fixed
   * order → seeded and deterministic.
   *
   * The taper multiplies the *stored* capacity but not the draw decision: both
   * draws still happen exactly when `suitability > 0`, as before, so turning the
   * taper on shifts no part of the RNG stream — only the capacity and initial
   * biomass values in the edge band change. Initial biomass is clamped to the
   * tapered capacity so an edge cell never starts above what it can sustain.
   */
  #seed(random, terrain, params, taper) {
    for (let y = 0; y < this.#height; y += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        const i = this.#index(x, y);
        const suitability = suitabilityFor(terrain.codeAt(x, y), params.coverSuitability);
        const fertility = random.float(params.minFertility, 1);
        const baseCapacity = suitability > 0 ? this.#capacity * suitability * fertility : 0;
        const capacity = taper !== null && baseCapacity > 0 ? baseCapacity * taper(x, y) : baseCapacity;
        this.#capacityPerCell[i] = capacity;
        this.#biomass[i] = baseCapacity > 0 ? Math.min(capacity, baseCapacity * random.float(0, params.initialFraction)) : 0;
      }
    }
    this.#revision += 1;
  }

  /**
   * Raw biomass at a cell (0 when out of bounds).
   *
   * ⚠ Since phase 9 this is read as **two** facts rather than one: how much forage
   * a cell holds, and — because standing crop *is* grass height — how mature and
   * coarse that forage is. `habitat/forage.js` turns the second reading into a
   * per-species preference, so the whole forage-guild mechanism needed no new
   * storage and no new grid read (PLAN-SPECIES.md §3.3).
   */
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
