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
  // Deep water: the impassable core of a lake, leaving a shallow `WATER` ring at
  // the edge that is the only place an animal can reach to drink (swimming is
  // future work). Impassable like rock, but semantically water — a distinct code
  // so the renderer and the perception/obstacle logic can tell the two apart.
  DEEP_WATER: 4,
  // Thicket: a dense stand of tall brush / small trees. Passable but so slow to
  // push through that an animal only does so as a last resort (see the movement
  // system), it blocks line of sight, and it shelters from the weather — a
  // spatial refuge (A18). The static MVP of the dynamic shrub layer (A50); it
  // does not grow, is not eaten, and is placed in clumps like rock.
  THICKET: 5,
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
  Object.freeze({ code: TerrainType.DEEP_WATER, name: 'deep_water', passable: false }),
  Object.freeze({ code: TerrainType.THICKET, name: 'thicket', passable: true }),
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
 * How much each terrain code hides what is standing in it, 0 (plain sight) to 1
 * (invisible), indexed by code.
 *
 * ⚠⚠ **This replaced a boolean array on 2026-07-30 (phase 14, PLAN-SPECIES.md
 * §3.12), and the boolean is now derived from it.** The old comment here said
 * sight-blocking was "a property of its own… and (later) cover could conceal
 * without stopping anything" — this is that later. Opacity turns out to be the
 * *end* of the concealment scale rather than a separate fact, so there is one
 * table and `blocksSightAt` is `concealment >= 1`. Two things follow, and both
 * are the reason it is shaped this way:
 *
 *   - **The boolean cannot drift from the scale**, because it is built from it
 *     below rather than written twice.
 *   - **The raycast keeps its boolean array**, so `hasLineOfSight` — the hottest
 *     thing that reads any of this — does exactly the array read and branch it
 *     did before. Grading sight cost the raycast nothing.
 *
 * ⚠ **Cover is 0.55, not 1**, and that is the whole mechanism: a stand of low
 * brush does not stop you seeing *through* it, it stops you picking out the
 * animal crouched *in* it. Thicket and rock are 1 — you see neither through nor
 * into them — which is exactly what the booleans said before.
 *
 * Reads go through `world.concealmentAt`, the chokepoint built to fold in
 * non-terrain concealment (a fire's smoke, a future shrub layer) the way
 * `speedModifierAt` folds in disturbances, so nothing here is specific to brush.
 */
const CONCEALMENT_BY_CODE = Object.freeze([
  0, //    ground — nothing to hide behind
  0, //    water — a shallow margin hides nothing
  1, //    rock — opaque
  0.55, // cover — low brush: it hides a crouching cat, not a standing herd
  0, //    deep water — see across it
  1, //    thicket — tall, dense; opaque
]);

/**
 * Which terrain codes block line of sight, indexed by code. **Derived** from the
 * concealment scale above: total concealment *is* opacity, so the two can never
 * disagree. Kept as its own boolean array because the raycast reads it per cell.
 */
const SIGHT_BLOCKING_BY_CODE = Object.freeze(CONCEALMENT_BY_CODE.map((value) => value >= 1));

/**
 * Whether a terrain code blocks line of sight, for callers that already have the
 * code. `codeAt` reports ROCK out of bounds and ROCK is opaque, so the world
 * edge blocks sight without a separate bounds guard.
 * @param {number} code
 * @returns {boolean}
 */
export function isSightBlockingCode(code) {
  return SIGHT_BLOCKING_BY_CODE[code];
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
  0, // deep water (impassable)
  0.1, // thicket — passable, but a crawl; an animal only pushes through to escape
]);

export const DEFAULT_TERRAIN_PARAMS = Object.freeze({
  lakes: 1,
  lakeRadiusFraction: 0.14,
  // Fraction of a lake's radius that is deep (impassable) water at its centre,
  // leaving a shallow drinkable ring of the remaining radius. 0 disables it (a
  // fully shallow lake). See #carveLakes.
  lakeDeepFraction: 0.55,
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
  // Thicket stands, placed exactly like rock formations (a short random walk of
  // overlapping discs, organic outline) but **more prevalent** than rock and on
  // open ground only. `thickets` is the formation count (0 disables). See
  // #carveThicketFormations.
  thickets: 14,
  thicketMinRadius: 1.5,
  thicketMaxRadius: 4,
  thicketMinSteps: 2,
  thicketMaxSteps: 7,
  thicketDrift: 1,
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

  /**
   * Whether the cell blocks line of sight. Out-of-bounds is ROCK, which is
   * opaque, so the world edge blocks sight without a separate guard.
   * @param {number} cellX @param {number} cellY
   * @returns {boolean}
   */
  blocksSightAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return true;
    return SIGHT_BLOCKING_BY_CODE[this.#cells[this.#index(cellX, cellY)]];
  }

  /**
   * How well the cell hides an animal standing in it, 0 (plain sight) to 1
   * (invisible). Out-of-bounds is ROCK, which is 1 — so the world edge conceals
   * exactly as it blocks sight, with no separate guard.
   *
   * ⚠ This is about being *seen in* a cell, not about seeing *through* one. The
   * two coincide only at 1, which is why `blocksSightAt` is the `>= 1` end of
   * this scale and not a separate fact (PLAN-SPECIES.md §3.12, phase 14).
   * @param {number} cellX @param {number} cellY
   * @returns {number}
   */
  concealmentAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return 1;
    return CONCEALMENT_BY_CODE[this.#cells[this.#index(cellX, cellY)]];
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
    // Thickets last of the placement steps (before connectivity), so their draws
    // never shift lakes, rock, or cover — the existing map is unchanged and
    // thicket is simply added on top of open ground.
    this.#carveThicketFormations(random, params);
    // Run last, so the guarantee holds over the finished map: every passable
    // cell reaches every other passable cell without crossing rock. Thicket is
    // passable, so it neither strands ground nor is carved through.
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
    const deepFraction = params.lakeDeepFraction ?? 0;
    for (let n = 0; n < params.lakes; n += 1) {
      const cx = random.int(0, this.#width - 1);
      const cy = random.int(0, this.#height - 1);
      const r = radius * random.float(0.7, 1.15);
      this.#stampDisc(cx, cy, r, TerrainType.WATER);
      // A deep, impassable core leaves a shallow ring at the water's edge — the
      // only reach an animal has to drink. Stamped with the same centre and the
      // already-drawn radius, so it adds no draw and shifts nothing downstream;
      // only the cells change. `onlyGround` is false so it overwrites the
      // shallow water it sits inside.
      if (deepFraction > 0) this.#stampDisc(cx, cy, r * deepFraction, TerrainType.DEEP_WATER);
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
   * Thicket stands, grown exactly like rock formations — a short random walk of
   * overlapping discs — but on **open ground only** (`onlyGround`), so a stand
   * never buries a lake, rock, or an existing cover patch, and more of them than
   * rock. Passable but sight-blocking and near-impassable to move through; the
   * generation is identical in shape to rock, which is why an animal reads a
   * thicket as a soft obstacle rather than a wall.
   */
  #carveThicketFormations(random, params) {
    const count = Math.max(0, Math.round(params.thickets ?? 0));
    const minR = Math.max(0.5, params.thicketMinRadius);
    const maxR = Math.max(minR, params.thicketMaxRadius);
    const minSteps = Math.max(1, Math.round(params.thicketMinSteps));
    const maxSteps = Math.max(minSteps, Math.round(params.thicketMaxSteps));
    const drift = params.thicketDrift;
    for (let n = 0; n < count; n += 1) {
      let cx = random.float(0, this.#width);
      let cy = random.float(0, this.#height);
      const steps = random.int(minSteps, maxSteps);
      for (let s = 0; s < steps; s += 1) {
        const r = random.float(minR, maxR);
        this.#stampDisc(cx, cy, r, TerrainType.THICKET, true);
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
