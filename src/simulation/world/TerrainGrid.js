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
 * Passability of a terrain code, for callers that have already read the code.
 *
 * `codeAt` reports ROCK out of bounds and ROCK is impassable, so
 * `isPassableCode(terrain.codeAt(x, y))` is exactly `terrain.isPassable(x, y)`
 * — including at the world edge. A scan that needs both therefore reads the
 * cell once instead of twice (Step 30).
 *
 * @param {number} code
 * @returns {boolean}
 */
export function isPassableCode(code) {
  return PASSABLE_BY_CODE[code];
}

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
  // Rock is placed as irregular formations of varying size, not one straight
  // ridge. `ridges` is the formation count (0 disables rock); each formation is
  // a short random walk of overlapping discs whose radii and step count vary,
  // so no two are the same shape or size and none spans the map. See
  // #carveRockFormations.
  ridges: 8,
  rockFormationMinRadius: 1.5,
  rockFormationMaxRadius: 4,
  rockFormationMinSteps: 2,
  rockFormationMaxSteps: 7,
  rockFormationDrift: 1,
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

  #generate(random, params) {
    this.#carveLakes(random, params);
    this.#carveRockFormations(random, params);
    this.#growCoverPatches(random, params);
    // Run last, so the guarantee holds over the finished map: every passable
    // cell reaches every other passable cell without crossing rock.
    this.#ensureConnectivity();
  }

  /**
   * Fill a disc of `code` centered on (cx, cy) with radius r. When `onlyGround`
   * is set, only GROUND cells are overwritten (so cover never buries lakes or
   * rock). Shared by lakes, rock formations, and cover patches.
   */
  #stampDisc(cx, cy, r, code, onlyGround = false) {
    const rSquared = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.#width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.#height - 1, Math.ceil(cy + r));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rSquared) {
          const idx = this.#index(x, y);
          if (!onlyGround || this.#cells[idx] === TerrainType.GROUND) this.#cells[idx] = code;
        }
      }
    }
  }

  #carveLakes(random, params) {
    const radius = params.lakeRadiusFraction * Math.min(this.#width, this.#height);
    for (let n = 0; n < params.lakes; n += 1) {
      const cx = random.int(0, this.#width - 1);
      const cy = random.int(0, this.#height - 1);
      const r = radius * random.float(0.7, 1.15);
      this.#stampDisc(cx, cy, r, TerrainType.WATER);
    }
  }

  #carveRockFormations(random, params) {
    const count = Math.max(0, Math.round(params.ridges ?? 0));
    const minR = Math.max(0.5, params.rockFormationMinRadius);
    const maxR = Math.max(minR, params.rockFormationMaxRadius);
    const minSteps = Math.max(1, Math.round(params.rockFormationMinSteps));
    const maxSteps = Math.max(minSteps, Math.round(params.rockFormationMaxSteps));
    const drift = params.rockFormationDrift;
    for (let n = 0; n < count; n += 1) {
      // Each formation grows from a random start by stamping a chain of
      // overlapping discs whose center drifts a random direction each step. The
      // step count sets the formation's size and the drift makes its outline
      // irregular, so rock reads as scattered outcrops rather than a wall.
      let cx = random.float(0, this.#width);
      let cy = random.float(0, this.#height);
      const steps = random.int(minSteps, maxSteps);
      for (let s = 0; s < steps; s += 1) {
        const r = random.float(minR, maxR);
        this.#stampDisc(cx, cy, r, TerrainType.ROCK);
        const angle = random.float(0, Math.PI * 2);
        const stepLen = r * drift;
        cx += Math.cos(angle) * stepLen;
        cy += Math.sin(angle) * stepLen;
      }
    }
  }

  /**
   * Guarantee that all passable cells form a single 4-connected component, so no
   * pocket of passable ground is walled off by rock. Passable cells are labeled
   * into components; if more than one exists, every component but the largest is
   * linked to it by carving the shortest rock corridor (rock → ground) found by
   * a breadth-first search seeded from the main component. Deterministic:
   * components and their representatives are chosen in row-major / ascending-id
   * order, and the BFS expands neighbors in a fixed order.
   */
  #ensureConnectivity() {
    const w = this.#width;
    const h = this.#height;
    const n = w * h;
    const cells = this.#cells;
    const passable = (i) => PASSABLE_BY_CODE[cells[i]];

    // Label 4-connected components of passable cells.
    const comp = new Int32Array(n).fill(-1);
    const sizes = [];
    const stack = [];
    for (let start = 0; start < n; start += 1) {
      if (!passable(start) || comp[start] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      comp[start] = id;
      stack.push(start);
      while (stack.length > 0) {
        const i = stack.pop();
        size += 1;
        const x = i % w;
        const y = (i - x) / w;
        if (x > 0 && passable(i - 1) && comp[i - 1] === -1) { comp[i - 1] = id; stack.push(i - 1); }
        if (x < w - 1 && passable(i + 1) && comp[i + 1] === -1) { comp[i + 1] = id; stack.push(i + 1); }
        if (y > 0 && passable(i - w) && comp[i - w] === -1) { comp[i - w] = id; stack.push(i - w); }
        if (y < h - 1 && passable(i + w) && comp[i + w] === -1) { comp[i + w] = id; stack.push(i + w); }
      }
      sizes.push(size);
    }
    if (sizes.length <= 1) return;

    // The largest component is the mainland the others must reach (lowest id
    // wins a tie, for determinism).
    let mainId = 0;
    for (let id = 1; id < sizes.length; id += 1) {
      if (sizes[id] > sizes[mainId]) mainId = id;
    }

    // Multi-source BFS across the whole grid (stepping through any cell,
    // including rock) from every mainland cell, recording each cell's distance
    // to the mainland and the neighbor it was reached from.
    const dist = new Int32Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;
    for (let i = 0; i < n; i += 1) {
      if (comp[i] === mainId) { dist[i] = 0; queue[qTail++] = i; }
    }
    while (qHead < qTail) {
      const i = queue[qHead++];
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && dist[i - 1] === -1) { dist[i - 1] = dist[i] + 1; parent[i - 1] = i; queue[qTail++] = i - 1; }
      if (x < w - 1 && dist[i + 1] === -1) { dist[i + 1] = dist[i] + 1; parent[i + 1] = i; queue[qTail++] = i + 1; }
      if (y > 0 && dist[i - w] === -1) { dist[i - w] = dist[i] + 1; parent[i - w] = i; queue[qTail++] = i - w; }
      if (y < h - 1 && dist[i + w] === -1) { dist[i + w] = dist[i] + 1; parent[i + w] = i; queue[qTail++] = i + w; }
    }

    // For each stranded component, carve the shortest corridor to the mainland:
    // take its cell nearest the mainland and follow the BFS parents back,
    // turning the intervening rock into ground.
    for (let id = 0; id < sizes.length; id += 1) {
      if (id === mainId) continue;
      let best = -1;
      for (let i = 0; i < n; i += 1) {
        if (comp[i] !== id) continue;
        if (best === -1 || dist[i] < dist[best]) best = i;
      }
      if (best === -1) continue;
      for (let cur = best; cur !== -1 && dist[cur] > 0; cur = parent[cur]) {
        if (!PASSABLE_BY_CODE[cells[cur]]) cells[cur] = TerrainType.GROUND;
      }
    }
  }

  #growCoverPatches(random, params) {
    // Clumped cover on ground cells only (lakes/rock are preserved). Patch
    // count scales with world area so density is size-independent, and blobs
    // keep the run-length encoding compact.
    const area = this.#width * this.#height;
    const patches = Math.max(0, Math.round((params.coverPatchDensity * area) / 1000));
    const baseRadius = Math.max(1, params.coverPatchRadius);
    for (let n = 0; n < patches; n += 1) {
      const cx = random.int(0, this.#width - 1);
      const cy = random.int(0, this.#height - 1);
      const r = baseRadius * random.float(0.6, 1.2);
      this.#stampDisc(cx, cy, r, TerrainType.COVER, true);
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
