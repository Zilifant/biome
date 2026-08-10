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
  // scattered canopy), lightly concealing (0.4), and no grass grows in its cell.
  // What it shares with thicket is shade, and what it adds is somewhere to be
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
  // Dry bed: the cracked pan a lake, pond, stream or marsh pool leaves behind
  // when the dry season drains it (SEASON-PLAN.md §4.4, 2026-08-09). Ordinary
  // walkable ground in every mechanical respect — it is the *visibility* of the
  // dry season, not a new behaviour.
  //
  // ⚠⚠ **A new code, against the standing preference not to add one.** The marsh
  // (TERRAIN-PLAN §2) was deliberately composed from existing codes because it
  // could be, and DOCS §7 records the bill a new code carries: a protocol bump, an
  // entry in all five terrain-keyed tables, a renderer glyph, and one habitat
  // weight per species. A dry bed cannot be composed — it is precisely the thing
  // that is neither water nor ordinary ground — and without it **the dry season is
  // invisible on the map**: the stream would not dry up, it would cease to have
  // ever existed. Watching the water go is the whole feature.
  //
  // ⚠ It is *not* the mechanism. What drains the map is the dry-season terrain
  // map; this is the code that map writes.
  DRY_BED: 7,
});

/**
 * **Which feature a water cell came from** (SEASON-PLAN.md D3, 2026-08-09) — a
 * parallel `Uint8Array` beside `#cells`, written by the generation passes as they
 * stamp.
 *
 * ⚠⚠ **This exists because the finished grid cannot answer the question, and the
 * dry season has to.** Once `#generate` returns, a `WATER` cell from the stream, a
 * marsh pool, a pond and the lake's shallow ring are the same byte — but the dry
 * season treats all four differently (the stream dries completely, a pond shrinks,
 * the lake inverts, the marsh mostly dries). The alternative was to recover
 * provenance after the fact by connected components and distance transforms, which
 * is guesswork about something the generator knew for certain and threw away.
 *
 * ⚠ **It costs no randomness and no draws.** Every value here is written beside a
 * cell write that already happens, so every seeded world generates precisely the
 * terrain it did before this existed — which is what `test/determinism.test.js`
 * holds it to.
 *
 * ⚠ **Derived and never serialized**, like the grid it shadows and like
 * `world.wetness`. It regenerates from the seed on load (DOCS §7).
 *
 * **The invariant, asserted in `test/terrain.test.js`:** a cell's source is
 * non-`NONE` *if and only if* the cell is `WATER` or `DEEP_WATER`. Every pass that
 * can overwrite water with something else — rock is the one that does — must clear
 * it, which is why the tag is written by `#stampDisc` itself rather than by its
 * callers.
 */
export const WaterSource = Object.freeze({
  NONE: 0,
  /** The lake's shallow ring — what dries first, leaving a pan. */
  LAKE: 1,
  /** The lake's impassable core — what survives, and becomes the dry season's water. */
  LAKE_CORE: 2,
  POND: 3,
  STREAM: 4,
  /** A marsh pool. */
  MARSH: 5,
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
  Object.freeze({ code: TerrainType.DRY_BED, name: 'dry_bed', passable: true }),
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
  // ⚠ Dry bed is 0, and staying **under 1** is the load-bearing part, exactly as
  // it is for the tree: `SIGHT_BLOCKING_BY_CODE` is derived as `>= 1`, so any
  // value below it leaves the raycast's boolean array byte-identical and
  // `hasLineOfSight` costs precisely what it did. A drained channel is open
  // ground — there is nothing in it to hide behind.
  0, //    dry bed — a bare pan hides nothing
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
  // ⚠⚠ **Dry bed is 1.0, and the temptation to make it 0.8 for "loose sand" is
  // the trap the tree's own 0.9 exists to record: slow ground is *avoided*
  // ground.** The movement system treats a slow cell's edge as a wall, so a
  // cheaper dry bed would make animals turn away from the drained channel — which
  // is the one place in the dry-season world that still grows grass, and therefore
  // the exact place the mechanism needs them to walk to. A dried river bed is
  // walkable; it is water's *absence*, not an obstacle.
  1, // dry bed — walking on a dry bed is walking
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
 * Cells a companion tree may grow on, given the spacing rule: every offset whose
 * Chebyshev distance from the seed is `spacing` or `spacing + 1` — as close as
 * the rule allows, and one ring further. At the shipped spacing of 2 that is the
 * 40 cells 2–3 away, which is what a "clump" of trees means here (2026-08-08).
 *
 * ⚠ **The order is *behaviour* rather than style**: a companion pick is an index
 * into this list, so reordering it changes which side of a lone tree its pair
 * grows on for every seed in the project. Row-major over the bounding square,
 * and it stays that way.
 *
 * Cached per spacing because it is rebuilt once per world at most.
 * @type {Map<number, ReadonlyArray<readonly [number, number]>>}
 */
const CLUMP_OFFSETS = new Map();

function clumpOffsets(spacing) {
  const cached = CLUMP_OFFSETS.get(spacing);
  if (cached !== undefined) return cached;
  const outer = spacing + 1;
  const offsets = [];
  for (let dy = -outer; dy <= outer; dy += 1) {
    for (let dx = -outer; dx <= outer; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < spacing) continue;
      offsets.push(Object.freeze([dx, dy]));
    }
  }
  const frozen = Object.freeze(offsets);
  CLUMP_OFFSETS.set(spacing, frozen);
  return frozen;
}

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
  /**
   * The **active** map, row-major, length width*height — whichever of
   * `#cellsWet` / `#cellsDry` the current season points at. Every read below
   * indexes this, so a season change is a pointer assignment and the hot loops
   * cost exactly what they always did.
   * @type {Uint8Array}
   */
  #cells;
  /** The generated map: the world with water in it. @type {Uint8Array} */
  #cellsWet;
  /**
   * The same world drained, or **null** when `terrain.dryTerrain` is off — in
   * which case no second array is allocated, no draws are spent building it, and
   * `setSeason` can do nothing. That is the reproducible off state.
   * @type {Uint8Array|null}
   */
  #cellsDry = null;
  /** Which map is active. @type {'wet'|'dry'} */
  #season = 'wet';
  /**
   * Bumped whenever the active map changes, so a consumer that memoized a
   * projection of it (the engine does) can tell that it is stale. ⚠ Terrain used
   * to be memoizable forever on the strength of "terrain is static"; it is still
   * static *per season*, which is a weaker promise and needs a number.
   */
  #revision = 0;
  /**
   * Which water feature each cell came from, in `WaterSource` values, row-major
   * beside `#cells`. `NONE` everywhere that is not water. See `WaterSource`.
   * @type {Uint8Array}
   */
  #waterSource;
  /**
   * Every pond's drawn geometry, in the order `#carveSmallLakes` placed them.
   *
   * ⚠ **Recorded rather than recovered.** A pond dries to a smaller pond, which
   * needs its *centre* and *radius* — and a disc's centre is not something you can
   * read back off a grid where the disc has been clipped by a coast, a lake, or an
   * outcrop. The generator has both numbers for free at the moment it draws them.
   * @type {Array<{cx: number, cy: number, r: number}>}
   */
  #ponds = [];
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
    this.#cellsWet = this.#cells;
    this.#waterSource = new Uint8Array(width * height); // all NONE (0)
    this.#generate(new SeededRandom(seed), { ...DEFAULT_TERRAIN_PARAMS, ...params });
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  /** Which seasonal map is active, `'wet'` or `'dry'`. */
  get season() {
    return this.#season;
  }

  /** Bumped on every season change; `0` for a world that has never changed season. */
  get revision() {
    return this.#revision;
  }

  /** Whether this world has a dry map at all (`terrain.dryTerrain`). */
  get hasDryMap() {
    return this.#cellsDry !== null;
  }

  /**
   * Point the grid at a season's map. **O(1)** — one comparison and one pointer
   * assignment — which is the whole reason the dry map is precomputed rather than
   * derived on the fly.
   *
   * ⚠ Idempotent and safe to call every tick, which is what `WeatherSystem` does:
   * the season is a pure function of the tick, so having the one system that owns
   * the environment assert it each tick is cheaper than tracking transitions and
   * cannot drift after a load.
   *
   * ⚠ A world with no dry map (the off state, or any sandbox that never asked for
   * one) silently stays wet. That is deliberate: "drain the map" is a thing a
   * world opts into, and a caller should not have to check first.
   *
   * @param {'wet'|'dry'} season
   * @returns {boolean} whether the active map actually changed
   */
  setSeason(season) {
    const next = season === 'dry' && this.#cellsDry !== null ? 'dry' : 'wet';
    if (next === this.#season) return false;
    this.#season = next;
    this.#cells = next === 'dry' ? this.#cellsDry : this.#cellsWet;
    this.#revision += 1;
    return true;
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

  /**
   * Terrain code at a cell **in a named season**, whichever season is active.
   *
   * ⚠ Built for one caller and worth naming it: `VegetationGrid` has to know what
   * a cell will be in *both* seasons at construction time, because a drained
   * channel grows grass and the water it replaces does not — so the two capacity
   * arrays are keyed on different terrain, not merely on different multipliers.
   * Asking it to flip the world's season and flip it back would have been the
   * alternative, and a constructor that mutates the thing it is reading is a worse
   * trade than one small accessor.
   *
   * Out of bounds is ROCK, exactly as `codeAt` reports it.
   * @param {number} cellX @param {number} cellY @param {'wet'|'dry'} season
   * @returns {number}
   */
  codeAtSeason(cellX, cellY, season) {
    if (!this.#inBounds(cellX, cellY)) return TerrainType.ROCK;
    const cells = season === 'dry' && this.#cellsDry !== null ? this.#cellsDry : this.#cellsWet;
    return cells[this.#index(cellX, cellY)];
  }

  /**
   * Which water feature this cell came from, as a `WaterSource` value.
   * `WaterSource.NONE` for anything that is not water, and for out of bounds.
   *
   * ⚠ This is **generation provenance, not a terrain property**. Nothing in the
   * tick reads it — it exists so the dry-season map can apply a different rule to
   * a stream than to a lake shore (SEASON-PLAN.md §4.3). Behaviour keyed on "is
   * this water" belongs on the terrain code.
   * @param {number} cellX @param {number} cellY
   * @returns {number}
   */
  waterSourceAt(cellX, cellY) {
    if (!this.#inBounds(cellX, cellY)) return WaterSource.NONE;
    return this.#waterSource[this.#index(cellX, cellY)];
  }

  /** Count of cells per `WaterSource`, for tests and metrics. @returns {number[]} */
  countByWaterSource() {
    const counts = new Array(Object.keys(WaterSource).length).fill(0);
    for (let i = 0; i < this.#waterSource.length; i += 1) counts[this.#waterSource[i]] += 1;
    return counts;
  }

  /**
   * Every pond's drawn centre and radius, in placement order — a copy, so a
   * caller cannot reach into generation state.
   * @returns {Array<{cx: number, cy: number, r: number}>}
   */
  ponds() {
    return this.#ponds.map((pond) => ({ ...pond }));
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
    // ⚠⚠ **The three water features draw from their own stream** (§4: a system
    // drawing more or fewer values must never shift the sequence an unrelated
    // one observes). They are the first passes here that a *user* turns up and
    // down from the panel, and one of them — ponds — has to run early for
    // layering reasons, so on a single stream "one more pond" would have
    // regenerated every rock formation, cover patch, stand and tree on the map.
    // Deriving costs the parent nothing (`deriveStream` hashes the root seed,
    // not the current state), so this shifts no existing seed by itself.
    //
    // ⚠ What a separate stream does **not** buy is independence of *outcome*.
    // Every pass writes the same grid, so a marsh still consumes ground a tree
    // would have been planted on. Only the last pass in the pipeline can promise
    // to change nothing else, and that promise now belongs to the marsh.
    const water = random.deriveStream('water');
    this.#buildExterior(params);
    this.#carveLakes(random, params);
    // Ponds immediately after the lakes and *before* rock, unlike every other
    // pass added since — and the reason is the layering rather than the draws.
    // Rock is stamped over water, so an outcrop can sit on a shore and clip it;
    // a pond placed at the end of the pipeline would sit on top of an outcrop
    // and read as water on a hilltop.
    this.#carveSmallLakes(water, params);
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
    // Water features last, in the order water actually arrives: a stream erodes
    // the finished map, and the marsh spreads over whatever the stream leaves.
    // Both are the latest possible point in the pipeline, so their draws shift
    // nothing before them and each is provably inert at its off setting.
    this.#carveStreams(water, params);
    this.#growMarsh(water, params);
    // Run last, so the guarantee holds over the finished map: every passable
    // cell reaches every other passable cell without crossing rock. Thicket is
    // passable, so it neither strands ground nor is carved through.
    this.#ensureConnectivity();
    // ⚠⚠ **After connectivity, not before**, and the ordering is a consequence
    // rather than a preference: `#ensureConnectivity` carves rock into ground, and
    // a dry map copied before it would be missing those corridors. Copying after
    // means the dry map inherits a world that is already connected — and since
    // drying only ever *adds* connectivity (shallow water → passable bed, deep
    // water → passable shallows), the guarantee holds on the dry map without
    // running the pass a second time. `test/dry-season.test.js` asserts exactly
    // that rather than trusting it.
    this.#buildDryMap(water, params);
  }

  /**
   * The dry-season map: the same world with the water drawn down, built once at
   * construction as a **pure deterministic function of the wet map** and never
   * touched again.
   *
   * ⚠⚠ **This is what lets a season change a `Uint8Array` without violating "terrain
   * is derived and unsaved, so nothing may mutate it" (DOCS §7).** Nothing here is
   * a mutation of the generated world — it is a second reading of it, computed from
   * the seed exactly as the first was, and regenerated identically on load. What a
   * season does is choose which of the two the world is currently looking at.
   *
   * **The four rules** (SEASON-PLAN.md §4.3), each keyed on the provenance tag
   * because the finished grid cannot tell one kind of water from another:
   *
   *   1. **The stream dries completely** — a channel is the first thing to go.
   *   2. **A pond shrinks to `dryPondAreaScale` of its area**, so the radius is
   *      scaled by its square root. It draws down, it does not vanish.
   *   3. **The lake inverts**: the shallow ring dries to a pan and the impassable
   *      core becomes shallow water. The one water in this world an animal cannot
   *      currently reach becomes the only one it can.
   *   4. **The marsh keeps `marshDryRetention` of its pools**, drawn per cell.
   *
   * ⚠ **The one pass that spends draws is the marsh, and it is free because this
   * runs last.** `#generate` documents that only the final pass can promise to
   * change nothing else; that promise used to belong to the marsh and now belongs
   * here. So every existing seed generates precisely the wet map it always did,
   * however many values this spends — which is what `test/determinism.test.js` and
   * the D3 byte-identity test hold it to.
   *
   * ⚠ **At `dryTerrain: false` it returns before allocating anything**, so the off
   * state costs neither the array nor the draws.
   *
   * @param {import('../random/SeededRandom.js').SeededRandom} random
   * @param {object} params
   */
  #buildDryMap(random, params) {
    if (params.dryTerrain === false) return; // the off state: no map, no draws, no trace

    const dry = Uint8Array.from(this.#cellsWet);
    // Pond cells inside a shrunk disc survive. ⚠ **Area, not radius** — "75% of its
    // size" is 75% of the water left, so the radius scales by √0.75 ≈ 0.866. The
    // masks are built first because ponds may overlap: a cell survives if it is
    // inside *any* pond's shrunk disc, which a per-pond loop over cells could not
    // express without re-checking every pond per cell.
    const areaScale = clamp01(params.dryPondAreaScale ?? 0);
    const radiusScale = Math.sqrt(areaScale);
    const keepPond = new Uint8Array(this.#cellsWet.length);
    for (const pond of this.#ponds) {
      const r = pond.r * radiusScale;
      if (!(r > 0)) continue;
      const rSquared = r * r;
      const minX = Math.max(0, Math.floor(pond.cx - r));
      const maxX = Math.min(this.#width - 1, Math.ceil(pond.cx + r));
      const minY = Math.max(0, Math.floor(pond.cy - r));
      const maxY = Math.min(this.#height - 1, Math.ceil(pond.cy + r));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x - pond.cx;
          const dy = y - pond.cy;
          if (dx * dx + dy * dy <= rSquared) keepPond[this.#index(x, y)] = 1;
        }
      }
    }

    // ⚠ One draw per **marsh pool**, in row-major order, and only for marsh pools —
    // so the number of values spent is a property of the map rather than of the
    // rules, and the three deterministic features cost nothing.
    const retention = clamp01(params.marshDryRetention ?? 0);
    for (let i = 0; i < dry.length; i += 1) {
      switch (this.#waterSource[i]) {
        case WaterSource.STREAM:
          dry[i] = TerrainType.DRY_BED;
          break;
        case WaterSource.POND:
          dry[i] = keepPond[i] === 1 ? TerrainType.WATER : TerrainType.DRY_BED;
          break;
        case WaterSource.LAKE:
          dry[i] = TerrainType.DRY_BED;
          break;
        case WaterSource.LAKE_CORE:
          dry[i] = TerrainType.WATER;
          break;
        case WaterSource.MARSH:
          dry[i] = random.next() < retention ? TerrainType.WATER : TerrainType.DRY_BED;
          break;
        default:
          break; // not water: the dry map is the wet map here
      }
    }
    this.#cellsDry = dry;
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
   *
   * ⚠ **`source` is written on every cell this writes, including the `NONE` of a
   * rock or cover stamp**, and that is the whole reason the tag lives here rather
   * than in the callers. Rock is stamped *over* water — an outcrop on a shore
   * clips the lake — so a rock pass that only wrote cells would leave the drowned
   * cell still tagged `LAKE`, and the dry season would try to dry an outcrop. The
   * rule "whoever writes the cell owns the tag" makes that unrepresentable.
   */
  #stampDisc(cx, cy, r, code, onlyGround = false, source = WaterSource.NONE) {
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
          if (!onlyGround || this.#cells[idx] === TerrainType.GROUND) {
            this.#cells[idx] = code;
            this.#waterSource[idx] = source;
          }
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
      this.#stampDisc(cx, cy, r, TerrainType.WATER, false, WaterSource.LAKE);
      // A deep, impassable core leaves a shallow ring at the water's edge — the
      // only reach an animal has to drink. Stamped with the same centre and the
      // already-drawn radius, so it adds no draw and shifts nothing downstream;
      // only the cells change. `onlyGround` is false so it overwrites the
      // shallow water it sits inside.
      //
      // ⚠ The core is tagged apart from the ring because the dry season **inverts
      // them**: the ring dries to a pan and the core — the one water in this world
      // an animal cannot currently reach — becomes shallow enough to drink from.
      if (deepFraction > 0) {
        this.#stampDisc(cx, cy, r * deepFraction, TerrainType.DEEP_WATER, false, WaterSource.LAKE_CORE);
      }
    }
  }

  /**
   * Ponds: `smallLakes` discs of shallow water, much smaller than the lake and
   * **fully shallow**.
   *
   * ⚠ **No deep core, deliberately.** `lakeDeepFraction` exists to make a large
   * lake something an animal walks *around* — the drinkable part is the ring at
   * its edge. A pond of five cells with an impassable middle is a ring one cell
   * wide, which is a hazard rather than a water source. A pond is drinkable all
   * the way across.
   *
   * ⚠ `onlyGround`, unlike `#carveLakes`. At this point in the pipeline the only
   * non-ground cells are the lake and the rim, so this says exactly one thing: a
   * pond landing on the lake is clipped by it rather than filling its deep core
   * in with shallow water.
   *
   * **Draw budget: 3 per pond** — position and a radius jitter — matching
   * `#carveLakes`. At `smallLakes: 0` it returns before the first one.
   */
  #carveSmallLakes(random, params) {
    const count = Math.max(0, Math.round(params.smallLakes ?? 0));
    if (count === 0) return; // the off state: no draws, no trace
    const radius = (params.smallLakeRadiusFraction ?? 0) * Math.min(this.#width, this.#height);
    for (let n = 0; n < count; n += 1) {
      const cx = random.int(0, this.#width - 1);
      const cy = random.int(0, this.#height - 1);
      const r = radius * random.float(0.7, 1.15);
      this.#stampDisc(cx, cy, r, TerrainType.WATER, true, WaterSource.POND);
      // ⚠ Recorded even when the stamp wrote nothing — a pond drawn entirely past
      // the coast or on top of the lake leaves no cells at all, and the dry pass
      // must find no pond cells inside its disc rather than find no disc. Keeping
      // the record makes "this pond contributed nothing" a measurable outcome
      // instead of an absence. Measured at D0: 1 seed in 5 has a pond of 0 cells.
      this.#ponds.push({ cx, cy, r });
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
   * ⚠⚠ **No two trees touch** (2026-08-08). Probability alone still produced
   * thicket-shaped blobs — at density 0.4 roughly a fifth of grove cells had a
   * neighbouring tree, and the eye reads a run of adjacent cells as one solid
   * mass however scattered the disc is on average. `treeSpacing` makes the
   * separation a rule instead of a hope: no tree may be planted within
   * `treeSpacing - 1` cells of another, so a *dense* stand is now many trees each
   * 2–3 cells from the next. Both passes go through `#plantTree`, so the rule
   * holds across groves, singles, companions and the boundary where two passes
   * overlap — the one place where "each pass is sparse" would not have.
   *
   * ⚠ `treeSpacing: 1` imposes nothing (a tree's own cell is the only cell it
   * needs) and is the reproducible off state for the rule, distinct from
   * `treeGroves: 0, treeSingles: 0`, which is the off state for the *layer* and
   * still spends no draws at all.
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

    const spacing = Math.max(1, Math.round(params.treeSpacing ?? 1));
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
        this.#scatterDisc(random, cx, cy, r, density, spacing);
        const angle = random.float(0, Math.PI * 2);
        const stepLen = r * drift;
        cx += Math.cos(angle) * stepLen;
        cy += Math.sin(angle) * stepLen;
      }
    }

    // Lone trees, and the loose pairs and triplets that read as one tree with
    // its offspring a little way off. The companion sits `spacing`..`spacing + 1`
    // cells away rather than on an 8-neighbour (2026-08-08), so a "clump" is a
    // few trees with grass between them instead of a solid two- or three-cell
    // blob — the smallest version of the same rule the groves follow.
    const offsets = clumpOffsets(spacing);
    const clusterMax = Math.max(0, Math.round(params.treeClusterMax ?? 0));
    // ⚠ **Seeds are all planted before any companion is.** A companion occupies
    // ground, and under the spacing rule an occupied cell *rejects* a later tree
    // that lands beside it — so planting companions inline would let
    // `treeClusterMax` decide where the lone trees are, not merely whether they
    // have company.
    // Deferring the companions keeps clumping a strictly additive setting, which
    // is what makes a "no clumps" control the same world without clumps. The
    // *draws* stay interleaved and in their original order, so the stream is
    // untouched by the reordering of the planting.
    const pending = [];
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
      const first = random.int(0, offsets.length - 1);
      const second = random.int(0, offsets.length - 1);
      if (!this.#plantTree(cellX, cellY, spacing)) continue; // no room here
      for (let c = 0; c < companions && c < 2; c += 1) {
        const [dx, dy] = offsets[c === 0 ? first : second];
        pending.push(cellX + dx, cellY + dy);
      }
    }
    for (let i = 0; i < pending.length; i += 2) {
      this.#plantTree(pending[i], pending[i + 1], spacing);
    }
  }

  /**
   * Turn a fraction of the open cells inside a disc into trees. The bounding-box
   * walk and the exterior guard are `#stampDisc`'s, deliberately — only the fill
   * rule differs.
   *
   * ⚠ The spacing rejection happens **after** the draw, so the fixed draw budget
   * in `#scatterTrees`'s header still holds: a grove spends exactly one draw per
   * open cell it considers, whether or not that cell ends up wooded.
   */
  #scatterDisc(random, cx, cy, r, density, spacing) {
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
        if (random.next() < density) this.#plantTree(x, y, spacing);
      }
    }
  }

  /**
   * Plant one tree on open ground, if the spacing rule leaves room. Returns
   * whether anything was planted, so the caller can skip a clump whose seed cell
   * was water, rock, already wooded, or too close to a tree.
   *
   * `spacing` is the minimum Chebyshev distance between two trees: 1 is no rule
   * at all (a tree needs only its own cell) and 2 — the shipped value — forbids
   * the eight touching cells, so the nearest another tree can stand is two cells
   * away. The scan is `(2·spacing − 1)²` cells and runs once per world at
   * generation, never in a tick.
   */
  #plantTree(cellX, cellY, spacing = 1) {
    if (!this.#inBounds(cellX, cellY)) return false;
    const idx = this.#index(cellX, cellY);
    if (this.#exterior !== null && this.#exterior[idx] === 1) return false;
    if (this.#cells[idx] !== TerrainType.GROUND) return false;
    if (this.#hasTreeWithin(cellX, cellY, spacing - 1)) return false;
    this.#cells[idx] = TerrainType.TREE;
    return true;
  }

  /**
   * Whether any tree stands within `reach` cells (Chebyshev) of a cell. The
   * spacing rule has exactly one implementation, shared by the two passes that
   * plant trees — the scattered ones and the marsh's timber — because a rule
   * enforced in two places is a rule with two behaviours.
   */
  #hasTreeWithin(cellX, cellY, reach) {
    if (reach <= 0) return false;
    const minX = Math.max(0, cellX - reach);
    const maxX = Math.min(this.#width - 1, cellX + reach);
    const minY = Math.max(0, cellY - reach);
    const maxY = Math.min(this.#height - 1, cellY + reach);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.#cells[this.#index(x, y)] === TerrainType.TREE) return true;
      }
    }
    return false;
  }

  /**
   * A point on the bounding box's perimeter, parameterised by `t` in [0, 1)
   * running clockwise from the top-left corner. Used only by the stream, where
   * the point half a perimeter away is the far side of the world — which is what
   * makes a channel cross the map rather than clip a corner.
   *
   * ⚠ The *bounding box*, not the rounded shape. A start point outside the coast
   * writes nothing (the exterior guard), so on a round world the channel simply
   * begins where it reaches the shore, which is where a river reaching the sea
   * should begin.
   *
   * @param {number} t @returns {[number, number]}
   */
  #perimeterPoint(t) {
    const w = this.#width - 1;
    const h = this.#height - 1;
    let d = t * 2 * (w + h);
    if (d < w) return [d, 0];
    d -= w;
    if (d < h) return [w, d];
    d -= h;
    if (d < w) return [w - d, h];
    d -= w;
    return [0, h - d];
  }

  /**
   * Streams: a meandering shallow channel from one side of the world to the
   * other. Each step stamps a disc of shallow water and turns by a drawn angle
   * off the bearing to its target, so the course wanders without losing the plot.
   *
   * ⚠ **It cuts through what it meets, rock included.** A stream that stopped at
   * the first outcrop would end in the middle of the map, which is the one thing
   * a stream may not do; through rock it is a gorge. This can only ever *add*
   * connectivity — shallow water is passable — so the guarantee `#ensureConnectivity`
   * makes is untouched, and the corridor it opens is one the carve would
   * otherwise have had to make.
   *
   * ⚠ **Two exceptions, both structural.** It never writes past the coast (so a
   * channel reaching the rim ends at the sea rather than breaching it), and it
   * never overwrites `DEEP_WATER`: a lake core is not a ford, and a channel
   * filling it in would quietly delete the only impassable water in the world.
   * Running *into* a lake is fine and looks right — the channel arrives at the
   * shallows and stops mattering.
   *
   * **Draw budget: 1 for the start point, then 1 per step.** The step count is
   * geometry, not a draw, and is capped so no bearing can loop forever.
   * ⚠ `streamMeander` is clamped below π/2 because that is what guarantees
   * termination: every step keeps a positive component toward the target, so the
   * walk converges however much it wanders.
   */
  #carveStreams(random, params) {
    const count = Math.max(0, Math.round(params.streams ?? 0));
    if (count === 0) return; // the off state: no draws, no trace
    const width = Math.max(0.5, params.streamWidth ?? 1);
    const meander = Math.min(Math.max(0, params.streamMeander ?? 0), Math.PI / 2 - 0.05);
    const stepLength = Math.max(0.5, params.streamStepLength ?? 1);
    // Generous: the shortest crossing is one diagonal, and a meandering course
    // is longer than a straight one but not four times the map's girth longer.
    const maxSteps = Math.ceil((4 * (this.#width + this.#height)) / stepLength);
    for (let n = 0; n < count; n += 1) {
      const start = random.next();
      let [x, y] = this.#perimeterPoint(start);
      const [targetX, targetY] = this.#perimeterPoint((start + 0.5) % 1);
      for (let s = 0; s < maxSteps; s += 1) {
        this.#stampChannel(x, y, width);
        const dx = targetX - x;
        const dy = targetY - y;
        if (dx * dx + dy * dy <= stepLength * stepLength) break; // arrived
        const angle = Math.atan2(dy, dx) + (random.next() * 2 - 1) * meander;
        x += Math.cos(angle) * stepLength;
        y += Math.sin(angle) * stepLength;
      }
    }
  }

  /**
   * Stamp one disc of the stream bed. `#stampDisc`'s walk and exterior guard,
   * with the one rule that is the stream's own: deep water is left alone.
   *
   * ⚠⚠ **The channel also refuses to re-tag the lake's shallow ring, and that
   * guard is invisible on today's map.** A stream running into the lake walks over
   * cells that are already `WATER`, so writing `WATER` over them changes no cell —
   * which is exactly why this was safe to leave unguarded until provenance
   * existed. It is not safe now: retagging that strip `STREAM` would make it dry
   * *completely* in the dry season, punching a dry channel straight through a lake
   * shore that should merely have receded. **The cells are byte-identical either
   * way**, which is what lets D3 claim it changed no terrain.
   */
  #stampChannel(cx, cy, r) {
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
        if (this.#cells[idx] === TerrainType.DEEP_WATER) continue; // a lake core is not a ford
        if (this.#waterSource[idx] === WaterSource.LAKE) continue; // arriving at the lake, not carving it
        this.#cells[idx] = TerrainType.WATER;
        this.#waterSource[idx] = WaterSource.STREAM;
      }
    }
  }

  /**
   * The marsh: a wetland covering `marshFraction` of the **playable** map —
   * shallow pools threaded through tall grass, reed beds and standing timber.
   *
   * ⚠⚠ **It is composed from the terrain codes that already exist and is not one
   * of them**, which is the decision the whole feature rests on (TERRAIN-PLAN.md
   * §2). `WATER` is the pools, `COVER` the tall grass — cover already carries
   * 1.35× the grass capacity of open ground, so tall grass that grows more grass
   * needs no new code — `THICKET` the reed beds, and `TREE` the timber. Every
   * consumer in the engine reads a marsh correctly on the day it ships, with no
   * new branch anywhere. **The cost, stated rather than discovered later:** a
   * marsh is not *addressable*. Nothing can ask "is this cell marsh?", no metric
   * can report marsh occupancy, and once generation ends the region exists only
   * as an arrangement of ordinary cells.
   *
   * ⚠ **The anchor is drawn from the world's existing shallow water** — a lake
   * shore or a bank of the stream — because a marsh anchored on dry ground is a
   * swamp in a desert. With no water anywhere (a lakeless test world) it falls
   * back to a drawn position, and **all three draws are spent either way**, so
   * which branch runs cannot shift the stream.
   *
   * ⚠ **Fraction of the *playable* area, not of the bounding box.** A 5% marsh
   * should mean 5% of the world an animal can stand in; on a level-4 round world
   * that is 5% of 0.785 of the rectangle. The footprint then grows until it
   * holds that many *convertible* cells — see `#markDisc` for why counting any
   * other way makes the number mean less than it says.
   *
   * ⚠ **It writes on `GROUND` and `COVER` only.** Rock, lakes, deep water, and
   * the thickets and trees already standing there survive inside the footprint —
   * an outcrop in a wetland is an island, and the marsh can be laid over any map
   * without destroying its features.
   *
   * **Draw budget: 3 for the anchor, 2 per walk step, and 1 per footprint cell.**
   * At `marshFraction: 0` it returns before the first one.
   */
  #growMarsh(random, params) {
    const fraction = clamp01(params.marshFraction ?? 0);
    const target = Math.round(fraction * this.#playableCellCount());
    if (target <= 0) return; // the off state: no draws, no trace

    // Every shallow-water cell, collected without a draw — the map is already
    // finished, so this is a scan of what is there rather than a decision.
    const shores = [];
    let convertible = 0;
    for (let i = 0; i < this.#cells.length; i += 1) {
      const code = this.#cells[i];
      if (code === TerrainType.WATER) shores.push(i);
      if (code === TerrainType.GROUND || code === TerrainType.COVER) convertible += 1;
    }
    // ⚠ Both the fallback position and the shore pick are drawn unconditionally.
    // Spending them only in the branch that uses them would make "is there water
    // in this world?" shift the stream for everything downstream.
    const fallbackX = random.int(0, this.#width - 1);
    const fallbackY = random.int(0, this.#height - 1);
    const pick = random.next();
    let anchorX = fallbackX;
    let anchorY = fallbackY;
    if (shores.length > 0) {
      const idx = shores[Math.min(shores.length - 1, Math.floor(pick * shores.length))];
      anchorX = idx % this.#width;
      anchorY = Math.floor(idx / this.#width);
    }

    // The footprint: a random walk of discs from the anchor, tethered to a basin
    // whose radius is set by the area asked for. ⚠ The tether is what keeps a
    // marsh a *basin* rather than a snake wandering off the map — beyond it the
    // heading is the bearing home plus the same drawn jitter, so the walk turns
    // back without spending a different number of draws.
    const mask = new Uint8Array(this.#cells.length);
    const minR = Math.max(1, params.marshMinRadius ?? 1);
    const maxR = Math.max(minR, params.marshMaxRadius ?? minR);
    const drift = params.marshDrift ?? 1;
    // ⚠ The basin is sized against the **land** the walk will find inside it,
    // not against its own area, and the difference is the second thing the first
    // version got wrong. A quarter of this world is rock and some of the rest is
    // lake, so a basin holding `target` *cells* holds far fewer than `target`
    // convertible ones — a 30% marsh came out at 21%. Dividing by the land share
    // makes the tether scale with how much of the map is wettable, so the marsh
    // keeps the same compact shape at every fraction instead of only at small
    // ones. The floor keeps a nearly-landless world from asking for infinity.
    const landShare = Math.max(0.05, convertible / Math.max(1, this.#playableCellCount()));
    const basin = Math.sqrt(target / (Math.PI * landShare)) * 1.35;
    const maxSteps = 200 + target; // a backstop, never the binding constraint
    let cx = anchorX;
    let cy = anchorY;
    let covered = 0;
    // ⚠⚠ **The basin grows when the walk runs out of ground, and measuring made
    // that necessary.** A tether sized from the land share is an *estimate*, and
    // on a good half of seeds the walk marks everything convertible inside it and
    // then wanders in circles marking nothing — so a marsh asked for 20% of the
    // map quietly delivered less. Widening the reach after a run of fruitless
    // steps is what a wetland short of room actually does, and it makes the
    // percentage a promise rather than a hope. Termination is still guaranteed:
    // the reach grows geometrically, so it passes the map's own diagonal in a
    // bounded number of expansions and the walk stops there — which is the
    // honest answer for a world with less wettable land than was asked for.
    const diagonal = Math.hypot(this.#width, this.#height);
    let reach = basin;
    let stalled = 0;
    for (let s = 0; s < maxSteps && covered < target; s += 1) {
      const r = random.float(minR, maxR);
      const added = this.#markDisc(mask, cx, cy, r);
      covered += added;
      if (added > 0) {
        stalled = 0;
      } else {
        stalled += 1;
        if (stalled >= 40) {
          stalled = 0;
          // ⚠ Capped, not broken out of. An early exit here is what the first
          // attempt did, and it made the shortfall *worse*: a stall usually means
          // the walk is standing in ground it has already marked, not that the
          // map is full, and after each widening it takes many small steps to
          // reach open ground — every one of which reads as another stall. The
          // step backstop is what terminates this loop; the reach only decides
          // how far the tether lets it look.
          reach = Math.min(reach * 1.25, diagonal);
        }
      }
      const jitter = random.float(-Math.PI, Math.PI);
      const home = Math.atan2(anchorY - cy, anchorX - cx);
      const dx = cx - anchorX;
      const dy = cy - anchorY;
      const angle = dx * dx + dy * dy > reach * reach ? home + jitter * 0.25 : jitter;
      const stepLength = r * drift;
      cx += Math.cos(angle) * stepLength;
      cy += Math.sin(angle) * stepLength;
    }

    // Fill it. One draw per footprint cell, against four cumulative bands; what
    // is left over stays open ground, so the wetland has dry footing in it.
    const water = clamp01(params.marshWaterDensity ?? 0);
    const grass = water + clamp01(params.marshGrassDensity ?? 0);
    const thicket = grass + clamp01(params.marshThicketDensity ?? 0);
    const timber = thicket + clamp01(params.marshTreeDensity ?? 0);
    const spacing = Math.max(1, Math.round(params.treeSpacing ?? 1));
    for (let y = 0; y < this.#height; y += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        const idx = this.#index(x, y);
        if (mask[idx] === 0) continue;
        const code = this.#cells[idx];
        if (code !== TerrainType.GROUND && code !== TerrainType.COVER) continue;
        const roll = random.next();
        if (roll < water) {
          this.#cells[idx] = TerrainType.WATER;
          this.#waterSource[idx] = WaterSource.MARSH;
        } else if (roll < grass) this.#cells[idx] = TerrainType.COVER;
        else if (roll < thicket) this.#cells[idx] = TerrainType.THICKET;
        // ⚠ Marsh timber obeys the same spacing rule as every other tree, so a
        // wetland cannot do what groves are forbidden from doing. A cell whose
        // neighbours are already wooded simply stays as it is.
        else if (roll < timber && !this.#hasTreeWithin(x, y, spacing - 1)) {
          this.#cells[idx] = TerrainType.TREE;
        }
      }
    }
  }

  /**
   * Mark the in-bounds, non-exterior cells of a disc in `mask`, returning how
   * many newly marked cells the marsh can actually *convert* — open ground and
   * cover.
   *
   * ⚠ **Counting convertible cells rather than marked ones is what makes the
   * percentage mean anything**, and the first version got it wrong. The marsh
   * anchors on a shore, so its basin overlaps the lake it grew from; counting
   * every marked cell meant a 5% marsh spent a third of its area on water that
   * was already there and came out visibly smaller than asked for. The sea past
   * the coast is excluded for the same reason, one step earlier.
   */
  #markDisc(mask, cx, cy, r) {
    const rSquared = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.#width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.#height - 1, Math.ceil(cy + r));
    let added = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > rSquared) continue;
        const idx = this.#index(x, y);
        if (this.#exterior !== null && this.#exterior[idx] === 1) continue; // past the coast
        if (mask[idx] === 1) continue;
        mask[idx] = 1;
        const code = this.#cells[idx];
        if (code === TerrainType.GROUND || code === TerrainType.COVER) added += 1;
      }
    }
    return added;
  }

  /** Cells inside the world's shape — the whole grid at roundness 0. No draws. */
  #playableCellCount() {
    const total = this.#width * this.#height;
    if (this.#exterior === null) return total;
    let outside = 0;
    for (let i = 0; i < this.#exterior.length; i += 1) outside += this.#exterior[i];
    return total - outside;
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
        if (PASSABLE_BY_CODE[cells[cur]]) continue;
        // ⚠ **"Impassable" is rock *or deep water*, so this can carve a corridor
        // straight through a lake's core** — rare, but reachable, and it is the one
        // place in the generator where a water cell becomes dry ground. The tag has
        // to be cleared with it or the dry-season pass would find a `LAKE_CORE`
        // tag on a cell of open grass and refill it. Same rule as `#stampDisc`:
        // whoever writes the cell owns the tag.
        cells[cur] = TerrainType.GROUND;
        this.#waterSource[cur] = WaterSource.NONE;
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
