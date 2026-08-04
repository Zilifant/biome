import { SeededRandom } from '../random/SeededRandom.js';
import { defaultSimulationConfig } from '../config/defaultSimulationConfig.js';

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
  // Tree: standing canopy over open ground — a grove, a pair, or a lone tree on
  // grassland. ⚠ **Deliberately the opposite of thicket in every property but
  // shelter**: barely slower to cross (0.9), *not* sight-blocking (you see past a
  // scattered canopy), lightly concealing (0.4), and it still grows grass under
  // it. What it shares with thicket is shade, and what it adds is somewhere to be
  // *above* — see TREES-FLIGHT-VULTURE-PLAN.md phase T2.
  //
  // ⚠ A terrain code rather than an entity (A3) or a second sparse grid, and the
  // reason is a measurement rather than a preference: the perception cell scan is
  // the hottest loop in the engine and **may not consult a second grid** (one
  // `sheltersAt` call there cost +56% of a tick). As terrain, a tree is one array
  // index at every chokepoint that already exists — and, because `habitat`
  // weights are keyed by this legend's own names, `habitat: { tree: … }` starts
  // working the moment the legend below has the entry, with no engine change.
  //
  // Static, like thicket: it does not grow, is not eaten, and has no woody floor.
  // The growing, browsable version is still A51.
  TREE: 6,
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
  Object.freeze({ code: TerrainType.TREE, name: 'tree', passable: true }),
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
 * ⚠ **A tree is 0.4, and staying under 1 is the load-bearing part.** A scattered
 * canopy hides less than a stand of brush does, and — because `SIGHT_BLOCKING_BY_CODE`
 * is derived as `>= 1` — a value under 1 means the raycast's boolean array is
 * unchanged and `hasLineOfSight` costs exactly what it did. That is phase 14's
 * discipline held rather than restated: opacity is the *top* of this scale, never
 * a second pass over it.
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
  0.4, //  tree — a canopy and a trunk break an outline; you still see straight past
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
 * Which terrain breaks the weather (2026-08-01). Cover is low brush and thicket
 * is a dense stand; both of them are somewhere to be in a cold snap, and neither
 * of them is the *only* shelter in the world — a burrow is shelter an animal
 * made, and that lives on the feature grid rather than here (`World.isShelteredAt`
 * is the definition that folds the two together).
 *
 * ⚠ **A tree joined them, and it is the one tree property that moves
 * populations.** Shade and a rain break are the whole reason a tree is worth
 * standing under, and exposure is the second-leading cause of death in this
 * world — so this single array entry, and not the concealment or the speed, is
 * what the phase's ten-seed gate is actually measuring.
 *
 * ⚠ **A table rather than a pair of comparisons, because perception reads it per
 * cell.** The shelter cue is filled inside the (2r+1)² scan that is the hottest
 * loop in the engine (§1.4 C6): the first cut of A68 asked
 * `code === COVER || code === THICKET || sheltersAt(features, …)` there and cost
 * **62% of a tick** at large-5k (129 → 210 ms), almost all of it the cross-module
 * call that could not be inlined. One array index restores it. This is D28's
 * lesson in a different disguise, and it is the second time this exact loop has
 * charged for a change that looked free.
 */
const SHELTERING_CODES = new Set([TerrainType.COVER, TerrainType.THICKET, TerrainType.TREE]);

export const SHELTERING_BY_CODE = Uint8Array.from(
  TERRAIN_LEGEND.map((entry) => (SHELTERING_CODES.has(entry.code) ? 1 : 0)),
);

/**
 * Whether a terrain code shelters from the weather, for callers that already
 * have the code. ⚠ Terrain only — a caller that wants the whole answer (burrows
 * included) must ask `World.isShelteredAt`, which is the one definition the
 * thermal relief and the `shelter` action both read.
 * @param {number} code
 * @returns {boolean}
 */
export function isShelteringCode(code) {
  return SHELTERING_BY_CODE[code] === 1;
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
  // ⚠ Tree is 0.9, and being *close to 1* is deliberate. A thicket is avoided
  // because it is slow (the movement system treats its edge as a wall); a tree
  // must not be, or the same machinery would make animals turn away from the
  // canopy this layer exists to put them under. Walking under a tree is walking.
  0.9, // tree — open woodland floor: roots and shade, not an obstacle
]);

/**
 * Generation parameters used when a caller supplies none — the fallback for a
 * `TerrainGrid` built directly (the tests do this) rather than through a
 * configured `World`.
 *
 * ⚠ **This is the config's terrain block, re-exported — not a second copy.**
 * Until 2026-08-02 it was a hand-maintained duplicate: ten keys restated with
 * identical values, and seven (`lakeDeepFraction`, the six thicket params)
 * present *only* here, so the demo's thicket count was unreachable from the
 * config and absent from every save file. Each param is documented at its one
 * home in `config/defaultSimulationConfig.js`; add new ones there.
 */
export const DEFAULT_TERRAIN_PARAMS = defaultSimulationConfig.terrain;

/**
 * Highest `roundness` level. The scale is 0..MAX_ROUNDNESS inclusive — five
 * levels, not a continuous knob, for the same reason `rocks` and `thickets` are
 * levels: the UI offers a dropdown and the config stays in whole steps.
 */
export const MAX_ROUNDNESS = 4;

/**
 * Roundness level → superellipse exponent, `|x/a|^n + |y/b|^n = 1`.
 *
 * The Lamé family is the whole reason this is one number rather than a corner
 * radius: n → ∞ is the rectangle, n = 2 is the exact ellipse, and everything
 * between is a squircle. A corner-radius formulation cannot reach the requested
 * endpoint — on a 160×120 map a maximal corner radius gives a *stadium* (flat
 * sides, semicircular ends), not an oval. Here level 4 is a true ellipse
 * inscribed in the world bounds, which on a non-square map is the oval asked
 * for.
 *
 * ⚠ Level 0 is `Infinity`, and it is not merely "a very square rectangle": it
 * short-circuits the carve entirely, so a level-0 world is byte-identical to a
 * world generated before roundness existed. That is what makes this switchable
 * groundwork rather than a change to every existing seed (DOCS §14: every
 * mechanism ships with a reproducible off state).
 *
 * Usable area as a fraction of the bounding box, by level: 1.000, 0.978, 0.927,
 * 0.873, 0.785 (the last being π/4, the ellipse).
 */
export const ROUNDNESS_EXPONENTS = Object.freeze([Infinity, 8, 4, 2.8, 2]);

/** Clamp an arbitrary input into [0, 1]. */
function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The eight cells touching a cell, in a fixed order. Used only by tree clumping,
 * where the order is *behaviour* rather than style: a companion pick is an index
 * into this list, so reordering it changes which side of a lone tree its pair
 * grows on for every seed in the project.
 */
const NEIGHBOUR_OFFSETS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
  Object.freeze([1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, 1]),
  Object.freeze([-1, -1]),
]);

/** Clamp an arbitrary input to a whole roundness level in 0..MAX_ROUNDNESS. */
function clampRoundness(roundness) {
  const level = Math.round(roundness ?? 0);
  if (!Number.isFinite(level) || level <= 0) return 0;
  return level > MAX_ROUNDNESS ? MAX_ROUNDNESS : level;
}

/**
 * Whether a cell falls outside the world's rounded shape, and is therefore not
 * part of the playable map.
 *
 * Exported because the shape must have exactly one definition (§19): the grid
 * carves it, and the tests assert against it. Anything that later needs to ask
 * "is this inside the world?" — a spawner, a renderer overlay — reads it here
 * rather than re-deriving the curve.
 *
 * Measured from cell *centres*, so the extreme rows and columns of a level-0
 * world sit just inside the boundary rather than exactly on it.
 *
 * @param {number} cellX
 * @param {number} cellY
 * @param {number} width
 * @param {number} height
 * @param {number} roundness 0..MAX_ROUNDNESS
 * @returns {boolean}
 */
export function isOutsideShape(cellX, cellY, width, height, roundness) {
  const exponent = ROUNDNESS_EXPONENTS[clampRoundness(roundness)];
  if (!Number.isFinite(exponent)) return false; // level 0 — the full rectangle
  const halfW = width / 2;
  const halfH = height / 2;
  const nx = Math.abs((cellX + 0.5 - halfW) / halfW);
  const ny = Math.abs((cellY + 0.5 - halfH) / halfH);
  return nx ** exponent + ny ** exponent > 1;
}

export class TerrainGrid {
  #width;
  #height;
  /** @type {Uint8Array} row-major, length width*height */
  #cells;
  /**
   * Cells outside the rounded outline (1 = outside), or null at roundness 0
   * where the world is the full rectangle and there is nothing to mask. Kept
   * after generation so no later pass can write into the sea.
   * @type {Uint8Array|null}
   */
  #exterior = null;

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
    // First, so every later step sees the finished outline: `#stampDisc` refuses
    // to write outside it (a lake near the rim is clipped by the coast rather
    // than punched through it) and `#ensureConnectivity` refuses to tunnel
    // through it. ⚠ It draws **no randomness** — the shape is pure geometry — so
    // adding it shifts no stream and a level-0 world is unchanged (§4).
    this.#buildExterior(params);
    this.#carveLakes(random, params);
    this.#carveRockFormations(random, params);
    this.#growCoverPatches(random, params);
    // Thickets last of the placement steps (before connectivity), so their draws
    // never shift lakes, rock, or cover — the existing map is unchanged and
    // thicket is simply added on top of open ground.
    this.#carveThicketFormations(random, params);
    // Trees after thickets, for exactly the same reason thickets come after
    // cover: the draws spent here can never shift a lake, a rock formation, a
    // cover patch or a stand, so every existing seed generates precisely the map
    // it did before trees existed and the layer is simply added on top of open
    // ground. ⚠ `#scatterTrees` spends **no draws at all** when both counts are
    // 0, which is what makes that claim provable rather than merely likely.
    this.#scatterTrees(random, params);
    // Run last, so the guarantee holds over the finished map: every passable
    // cell reaches every other passable cell without crossing rock. Thicket is
    // passable, so it neither strands ground nor is carved through.
    this.#ensureConnectivity();
  }

  /**
   * Carve the world down to its rounded outline: everything outside becomes
   * ROCK, and is remembered in `#exterior` so later passes leave it alone.
   *
   * ROCK rather than a new terrain code, deliberately. `codeAt` already reports
   * ROCK out of bounds, so the rim reads to every existing consumer — movement,
   * perception, the renderer, the protocol — exactly as the world edge always
   * has. A new "outside" code would mean a protocol bump and a branch in each of
   * them to say the same thing. ⚠ It is specifically *not* deep water: an ocean
   * rim would put drinkable shallows within reach of every coastal animal and
   * quietly retire the lake as the thing hydration is about.
   */
  #buildExterior(params) {
    const roundness = clampRoundness(params.roundness);
    if (roundness === 0) return; // rectangle: no mask, no carve, nothing changes
    const exterior = new Uint8Array(this.#width * this.#height);
    for (let y = 0; y < this.#height; y += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        if (!isOutsideShape(x, y, this.#width, this.#height, roundness)) continue;
        const idx = this.#index(x, y);
        exterior[idx] = 1;
        this.#cells[idx] = TerrainType.ROCK;
      }
    }
    this.#exterior = exterior;
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
          if (this.#exterior !== null && this.#exterior[idx] === 1) continue; // past the coast
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
   * Trees, in the two shapes savanna actually has them: **groves** of
   * semi-open woodland, and **lone trees, pairs and triplets** out on the
   * grassland.
   *
   * ⚠ **A grove is a scattered disc, not a filled one**, and that is the whole
   * difference between this and `#carveThicketFormations`. Reusing `#stampDisc`
   * would fill every cell in the walk and produce a solid stand — which is a
   * thicket with a different name and a different speed. Instead each open cell
   * inside the disc becomes a tree with probability `treeGroveDensity`, so the
   * canopy is broken and animals move and graze *through* it. That is what
   * "semi-open forest" means here.
   *
   * ⚠ **Both passes write onto GROUND only.** A grove never buries a lake, a
   * rock outcrop, a cover patch or a stand of thicket — trees fill the gaps in
   * the map that were open, which is also why they cannot affect connectivity
   * (they are passable, so the pass that follows has nothing to reconnect).
   *
   * ⚠ **Fixed draw budgets, in the house style.** A grove step spends 1 draw for
   * its radius, 1 for its heading, and 1 per *open* cell it considers. A single
   * spends 5 flat — position, companion count, and **two** companion picks
   * whatever the count turns out to be — so the stream lands in the same place
   * whether a lone tree turns out to be a lone tree or a triplet.
   */
  #scatterTrees(random, params) {
    const groves = Math.max(0, Math.round(params.treeGroves ?? 0));
    const singles = Math.max(0, Math.round(params.treeSingles ?? 0));
    // ⚠ Before the first draw, not after. This early return is the off switch
    // that leaves no trace (D30): with both counts at 0 the `terrain` stream is
    // untouched and the map is byte-identical to one generated before trees.
    if (groves === 0 && singles === 0) return;

    const density = clamp01(params.treeGroveDensity ?? 0);
    const minR = Math.max(0.5, params.treeGroveMinRadius);
    const maxR = Math.max(minR, params.treeGroveMaxRadius);
    const minSteps = Math.max(1, Math.round(params.treeGroveMinSteps));
    const maxSteps = Math.max(minSteps, Math.round(params.treeGroveMaxSteps));
    const drift = params.treeGroveDrift;
    for (let n = 0; n < groves; n += 1) {
      let cx = random.float(0, this.#width);
      let cy = random.float(0, this.#height);
      const steps = random.int(minSteps, maxSteps);
      for (let s = 0; s < steps; s += 1) {
        const r = random.float(minR, maxR);
        this.#scatterDisc(random, cx, cy, r, density);
        const angle = random.float(0, Math.PI * 2);
        const stepLen = r * drift;
        cx += Math.cos(angle) * stepLen;
        cy += Math.sin(angle) * stepLen;
      }
    }

    // Lone trees, and the pairs and triplets that read as one tree with its
    // offspring beside it. The companion is placed on an 8-neighbour rather than
    // anywhere nearby, so a "pair" is genuinely adjacent and the RLE stays as
    // compact as it can for a scattered layer.
    const clusterMax = Math.max(0, Math.round(params.treeClusterMax ?? 0));
    for (let n = 0; n < singles; n += 1) {
      const cellX = random.int(0, this.#width - 1);
      const cellY = random.int(0, this.#height - 1);
      // ⚠ Drawn unconditionally, including at `treeClusterMax: 0` where the
      // answer can only be 0. Skipping the draw there would make the *clumping
      // setting* shift the stream, so turning clumping off would move every lone
      // tree on the map instead of only removing its companions — and the
      // "no clumps" control would then be a different world rather than the same
      // one without clumps.
      const companions = random.int(0, clusterMax);
      // Always two picks, then apply the first `companions` of them — a fixed
      // budget, so how large a clump turns out to be cannot shift the stream.
      const first = random.int(0, NEIGHBOUR_OFFSETS.length - 1);
      const second = random.int(0, NEIGHBOUR_OFFSETS.length - 1);
      if (!this.#plantTree(cellX, cellY)) continue; // not open ground — nothing here
      const picks = [first, second];
      for (let c = 0; c < companions && c < picks.length; c += 1) {
        const [dx, dy] = NEIGHBOUR_OFFSETS[picks[c]];
        this.#plantTree(cellX + dx, cellY + dy);
      }
    }
  }

  /**
   * Turn a fraction of the open cells inside a disc into trees. The bounding-box
   * walk and the exterior guard are `#stampDisc`'s, deliberately — only the fill
   * rule differs.
   */
  #scatterDisc(random, cx, cy, r, density) {
    const rSquared = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.#width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.#height - 1, Math.ceil(cy + r));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > rSquared) continue;
        const idx = this.#index(x, y);
        if (this.#exterior !== null && this.#exterior[idx] === 1) continue; // past the coast
        // ⚠ The ground test comes *before* the draw, so the number of draws a
        // grove spends depends only on the geometry of its discs and on which
        // cells are open — both already fixed by the time this runs.
        if (this.#cells[idx] !== TerrainType.GROUND) continue;
        if (random.next() < density) this.#cells[idx] = TerrainType.TREE;
      }
    }
  }

  /**
   * Plant one tree on open ground. Returns whether anything was planted, so the
   * caller can skip a clump whose seed cell was water, rock, or already wooded.
   */
  #plantTree(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return false;
    const idx = this.#index(cellX, cellY);
    if (this.#exterior !== null && this.#exterior[idx] === 1) return false;
    if (this.#cells[idx] !== TerrainType.GROUND) return false;
    this.#cells[idx] = TerrainType.TREE;
    return true;
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
    //
    // ⚠ The exterior is excluded, and it has to be: this walks through rock, and
    // the rim *is* rock, so an unmasked BFS would happily route the shortest
    // corridor out around the coast and carve a ground causeway through the sea
    // — reconnecting the map by destroying its shape. Masking it here means a
    // pocket that can only be reached that way stays stranded, which is the
    // correct outcome; the guarantee below is scoped to the playable map.
    const exterior = this.#exterior;
    const blocked = exterior === null ? () => false : (i) => exterior[i] === 1;
    const dist = new Int32Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;
    for (let i = 0; i < n; i += 1) {
      if (comp[i] === mainId) { dist[i] = 0; queue[qTail++] = i; }
    }
    const visit = (from, to) => {
      if (dist[to] !== -1 || blocked(to)) return;
      dist[to] = dist[from] + 1;
      parent[to] = from;
      queue[qTail++] = to;
    };
    while (qHead < qTail) {
      const i = queue[qHead++];
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) visit(i, i - 1);
      if (x < w - 1) visit(i, i + 1);
      if (y > 0) visit(i, i - w);
      if (y < h - 1) visit(i, i + w);
    }

    // For each stranded component, carve the shortest corridor to the mainland:
    // take its cell nearest the mainland and follow the BFS parents back,
    // turning the intervening rock into ground.
    for (let id = 0; id < sizes.length; id += 1) {
      if (id === mainId) continue;
      let best = -1;
      for (let i = 0; i < n; i += 1) {
        if (comp[i] !== id) continue;
        // ⚠ `dist === -1` means "never reached", not "adjacent". Without this
        // guard the unreachable sentinel compares as nearer than every real
        // distance and wins the search, and the carve below then walks a
        // `parent` chain that was never written. Unreachable only became
        // possible when the exterior mask did.
        if (dist[i] === -1) continue;
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
