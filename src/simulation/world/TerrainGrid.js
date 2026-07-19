import { SeededRandom } from '../random/SeededRandom.js';

/**
 * Static terrain layer: one cell code per world cell, generated once at world
 * init from a seed and simple parameters, then never mutated (ownership:
 * written only at construction). Backed by a Uint8Array so it can migrate
 * toward struct-of-arrays storage later without an API change.
 *
 * Terrain carries no presentation: codes and a passability flag are
 * authoritative; glyphs and colors are the renderer's business (a legend maps
 * codes to names, and the renderer maps names to appearance).
 */

/** Cell codes. The numeric values are part of the protocol legend. */
export const TerrainType = Object.freeze({
  GROUND: 0,
  WATER: 1,
  ROCK: 2,
  COVER: 3,
});

/**
 * Legend indexed by code: renderer-neutral name + authoritative passability.
 * Only ROCK blocks movement in this step; water becomes behaviorally distinct
 * when hydration lands (PLAN Step 10).
 * @type {ReadonlyArray<{code: number, name: string, passable: boolean}>}
 */
export const TERRAIN_LEGEND = Object.freeze([
  Object.freeze({ code: TerrainType.GROUND, name: 'ground', passable: true }),
  Object.freeze({ code: TerrainType.WATER, name: 'water', passable: true }),
  Object.freeze({ code: TerrainType.ROCK, name: 'rock', passable: false }),
  Object.freeze({ code: TerrainType.COVER, name: 'cover', passable: true }),
]);

const PASSABLE_BY_CODE = TERRAIN_LEGEND.map((entry) => entry.passable);

/**
 * Per-code traversal speed multiplier (authoritative movement cost, not
 * presentation). Ground is unimpeded; wading water and pushing through cover
 * are slower; rock is impassable so its value is unused. Indexed by
 * TerrainType code.
 */
const SPEED_MODIFIER_BY_CODE = Object.freeze([
  1, // ground
  0.5, // water
  0, // rock (impassable)
  0.6, // cover
]);

export const DEFAULT_TERRAIN_PARAMS = Object.freeze({
  lakes: 1,
  lakeRadiusFraction: 0.14,
  ridges: 1,
  ridgeThickness: 2,
  // Cover grows in clumps, not per-cell noise: patches keep the run-length
  // encoding compact on large worlds (per-cell scatter fragmented it into
  // ~1 run per cell). Density is patches per 1000 cells.
  coverPatchDensity: 1.5,
  coverPatchRadius: 3,
});

export class TerrainGrid {
  #width;
  #height;
  /** @type {Uint8Array} row-major, length width*height */
  #cells;

  /**
   * @param {object} options
   * @param {number} options.width
   * @param {number} options.height
   * @param {number} options.seed deterministic terrain seed
   * @param {object} [options.params] generation parameters
   */
  constructor({ width, height, seed, params = {} }) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError('TerrainGrid requires positive integer width and height');
    }
    this.#width = width;
    this.#height = height;
    this.#cells = new Uint8Array(width * height); // all GROUND (0)
    this.#generate(new SeededRandom(seed), { ...DEFAULT_TERRAIN_PARAMS, ...params });
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  #index(cellX, cellY) {
    return cellY * this.#width + cellX;
  }

  #inBounds(cellX, cellY) {
    return cellX >= 0 && cellY >= 0 && cellX < this.#width && cellY < this.#height;
  }

  /**
   * Terrain code at a cell. Out-of-bounds cells report ROCK (the world edge is
   * a wall), so passability checks are safe without a separate bounds guard.
   * @param {number} cellX @param {number} cellY
   * @returns {number}
   */
  codeAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return TerrainType.ROCK;
    return this.#cells[this.#index(cellX, cellY)];
  }

  /** @param {number} cellX @param {number} cellY @returns {boolean} */
  isPassable(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return false;
    return PASSABLE_BY_CODE[this.#cells[this.#index(cellX, cellY)]];
  }

  /**
   * Traversal speed multiplier at a cell (1 = unimpeded). Out-of-bounds cells
   * report 0. Authoritative movement cost, read by the movement system.
   * @param {number} cellX @param {number} cellY
   * @returns {number}
   */
  speedModifierAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return 0;
    return SPEED_MODIFIER_BY_CODE[this.#cells[this.#index(cellX, cellY)]];
  }

  /** Count of cells per code, for tests and metrics. @returns {number[]} */
  countByType() {
    const counts = new Array(TERRAIN_LEGEND.length).fill(0);
    for (let i = 0; i < this.#cells.length; i += 1) counts[this.#cells[i]] += 1;
    return counts;
  }

  /**
   * Run-length encode the grid row-major: a flat list of [code, count] pairs.
   * Sum of counts equals width*height. Compact for the large contiguous
   * regions this generator produces.
   * @returns {Array<[number, number]>}
   */
  toRunLength() {
    const runs = [];
    let currentCode = this.#cells[0];
    let count = 0;
    for (let i = 0; i < this.#cells.length; i += 1) {
      const code = this.#cells[i];
      if (code === currentCode) {
        count += 1;
      } else {
        runs.push([currentCode, count]);
        currentCode = code;
        count = 1;
      }
    }
    runs.push([currentCode, count]);
    return runs;
  }

  // --- generation (deterministic; runs once) -------------------------------

  #set(cellX, cellY, code) {
    if (this.#inBounds(cellX, cellY)) this.#cells[this.#index(cellX, cellY)] = code;
  }

  #generate(random, params) {
    this.#carveLakes(random, params);
    this.#carveRidges(random, params);
    this.#growCoverPatches(random, params);
  }

  #carveLakes(random, params) {
    const radius = params.lakeRadiusFraction * Math.min(this.#width, this.#height);
    for (let n = 0; n < params.lakes; n += 1) {
      const cx = random.int(0, this.#width - 1);
      const cy = random.int(0, this.#height - 1);
      const r = radius * random.float(0.7, 1.15);
      const rSquared = r * r;
      const minX = Math.max(0, Math.floor(cx - r));
      const maxX = Math.min(this.#width - 1, Math.ceil(cx + r));
      const minY = Math.max(0, Math.floor(cy - r));
      const maxY = Math.min(this.#height - 1, Math.ceil(cy + r));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= rSquared) this.#set(x, y, TerrainType.WATER);
        }
      }
    }
  }

  #carveRidges(random, params) {
    const thickness = Math.max(1, Math.round(params.ridgeThickness));
    for (let n = 0; n < params.ridges; n += 1) {
      // A straight rock ridge from one point across the world, thickened
      // perpendicular to its direction.
      const horizontal = random.chance(0.5);
      if (horizontal) {
        const y0 = random.int(0, this.#height - 1);
        const slope = random.float(-0.3, 0.3);
        for (let x = 0; x < this.#width; x += 1) {
          const y = Math.round(y0 + slope * (x - this.#width / 2));
          for (let t = -Math.floor(thickness / 2); t <= Math.floor(thickness / 2); t += 1) {
            this.#set(x, y + t, TerrainType.ROCK);
          }
        }
      } else {
        const x0 = random.int(0, this.#width - 1);
        const slope = random.float(-0.3, 0.3);
        for (let y = 0; y < this.#height; y += 1) {
          const x = Math.round(x0 + slope * (y - this.#height / 2));
          for (let t = -Math.floor(thickness / 2); t <= Math.floor(thickness / 2); t += 1) {
            this.#set(x + t, y, TerrainType.ROCK);
          }
        }
      }
    }
  }

  #growCoverPatches(random, params) {
    // Clumped cover on ground cells only (lakes/ridges are preserved). Patch
    // count scales with world area so density is size-independent, and blobs
    // keep the run-length encoding compact.
    const area = this.#width * this.#height;
    const patches = Math.max(0, Math.round((params.coverPatchDensity * area) / 1000));
    const baseRadius = Math.max(1, params.coverPatchRadius);
    for (let n = 0; n < patches; n += 1) {
      const cx = random.int(0, this.#width - 1);
      const cy = random.int(0, this.#height - 1);
      const r = baseRadius * random.float(0.6, 1.2);
      const rSquared = r * r;
      const minX = Math.max(0, Math.floor(cx - r));
      const maxX = Math.min(this.#width - 1, Math.ceil(cx + r));
      const minY = Math.max(0, Math.floor(cy - r));
      const maxY = Math.min(this.#height - 1, Math.ceil(cy + r));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= rSquared && this.#cells[this.#index(x, y)] === TerrainType.GROUND) {
            this.#cells[this.#index(x, y)] = TerrainType.COVER;
          }
        }
      }
    }
  }
}

/**
 * Build the renderer-neutral terrain projection carried by full snapshots and
 * the terrain query. Codes + legend only — never glyphs or colors.
 * @param {TerrainGrid} terrain
 */
export function projectTerrain(terrain) {
  return {
    width: terrain.width,
    height: terrain.height,
    cellTypes: TERRAIN_LEGEND.map((entry) => ({ ...entry })),
    encoding: 'rle-row-major',
    runs: terrain.toRunLength(),
  };
}
