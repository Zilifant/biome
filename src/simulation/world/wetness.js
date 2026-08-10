import { TerrainType } from './TerrainGrid.js';

/**
 * **How wet the ground is**, as a static per-cell number in `[0, 1]` derived from
 * distance to the nearest water cell (2026-08-09).
 *
 * One field, two consumers, and that is the whole reason it is a module of its own
 * rather than a private detail of either:
 *
 *   - `VegetationGrid` grows **taller** grass on wet ground (a carrying-capacity
 *     multiplier) and grows it **slower** on dry ground (a growth-rate multiplier);
 *   - `habitatGradient` lets a species prefer wet ground or dry, through the same
 *     long-range cue that already carries its terrain preference.
 *
 * ⚠⚠ **This is how "a marsh" becomes addressable without a `MARSH` terrain code**,
 * which `TERRAIN-PLAN.md` §2 rejected and this does not re-open. A marsh is 30%
 * shallow-water pools by construction, so *every* cell of one is within a tile or
 * two of standing water and reads at wetness 1 — while a lake shore and a stream
 * bank read the same, because ecologically they are the same thing. The field says
 * "near water", the marsh generator makes the wettest ground on the map, and
 * nothing had to learn what a marsh is.
 *
 * ⚠ **It is a *terrain*-derived field, so it is not serialized.** Terrain
 * regenerates from the seed on load (DOCS §7), and so does this — like the
 * `nearestWater` bearing field in `World.js`, and unlike the biomass it scales.
 *
 * ⚠ **No randomness at all.** This is a pure function of the terrain grid, which is
 * what lets it ship *on* without shifting one draw of any RNG stream: every seeded
 * world generates the same terrain, the same vegetation draws, and the same
 * everything else it did before. What changes is the capacity those draws are
 * multiplied into.
 */

/**
 * ⚠ **Both distances are in cells, and `fullDistance` is the number the request
 * was phrased in** — "within 2–3 tiles of water". At 3 the fully-wet band is the
 * marsh, the lake shore, and a channel about 9 cells across around a 3-cell
 * stream, which is what a riparian strip looks like from above.
 */
export const DEFAULT_WETNESS_PARAMS = Object.freeze({
  enabled: true,
  fullDistance: 3, // cells at or inside this distance from water are fully wet
  range: 18, // wetness falls 1 → 0 over this many further cells
});

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smooth 1→0 ramp with zero slope at both ends, so there is no visible band edge. */
function falloff(t) {
  const x = clamp01(t);
  return 1 - x * x * (3 - 2 * x);
}

const INFINITY_COST = 1e20;

/**
 * The exact squared-Euclidean distance transform of one row or column
 * (Felzenszwalb & Huttenlocher's lower-envelope algorithm), in place over `f`.
 *
 * ⚠⚠ **A breadth-first flood carrying source coordinates was written first, and it
 * is wrong in a way that only shows up on a straight edge.** The flood visits cells
 * in *Chebyshev* order, so a cell three east of a north–south channel can be
 * reached by a diagonal step carrying a source three cells off to one side — and
 * the "3 tiles from water" band came out at a true distance of 4.24, ragged along
 * every shore in the world. It measured 0.96 where the whole point was 1. This is
 * exact, and it is still one linear pass per axis.
 *
 * @param {Float64Array} f costs in, squared distances out
 * @param {number} n length
 * @param {Int32Array} v scratch: parabola vertices
 * @param {Float64Array} z scratch: envelope intersections
 * @param {Float64Array} out scratch: results
 */
function distanceTransform1d(f, n, v, z, out) {
  let k = 0;
  v[0] = 0;
  z[0] = -INFINITY_COST;
  z[1] = INFINITY_COST;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INFINITY_COST;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
  for (let q = 0; q < n; q += 1) f[q] = out[q];
}

/**
 * A `Float32Array` of per-cell wetness in `[0, 1]`, row-major over the terrain
 * grid — or **`null`** when the mechanism is off, mis-parameterized, or the world
 * holds no water at all.
 *
 * ⚠⚠ **`null` on a waterless world is load-bearing, not a degenerate case.** "How
 * far is this from water" has no answer where there is no water, and the
 * alternative reading — *everywhere* is maximally dry — would have quietly halved
 * grass regrowth in every hand-built sandbox in the suite, none of which asked for
 * a wetland and most of which spread `FLAT_TERRAIN` (`lakes: 0, streams: 0,
 * marshFraction: 0`). Same failure the trees and the water features each caused
 * once already; the fix is that a world with nothing to be near is exactly
 * unaffected, and every consumer treats `null` as the identity.
 *
 * **Sources are `WATER` *and* `DEEP_WATER`.** This is not `buildWaterField`, which
 * answers "where can I drink" and therefore floods walkable ground from shallow
 * water only. Wetness is a physical fact about the ground, and a lake's impassable
 * core wets its shore exactly as the shallow ring does.
 *
 * ⚠ **The flood ignores passability**, for the same reason: a cell two tiles from a
 * stream is damp whether or not a rock ridge stands between them. That is the one
 * deliberate difference from `buildWaterField`, stated here because the two
 * functions otherwise look like duplicates of each other.
 *
 * **Cost:** an exact Euclidean distance transform — two linear passes over the
 * grid (columns, then rows), once, at world construction. O(cells), no
 * randomness, and no per-tick cost of any kind afterwards: what the simulation
 * reads is an array.
 *
 * @param {import('./TerrainGrid.js').TerrainGrid} terrain
 * @param {{enabled?: boolean, fullDistance?: number, range?: number}} [params]
 * @returns {Float32Array | null}
 */
export function buildWetnessField(terrain, params = {}) {
  const merged = { ...DEFAULT_WETNESS_PARAMS, ...params };
  if (merged.enabled === false || !(merged.range > 0)) return null;
  const full = Math.max(0, merged.fullDistance ?? 0);
  const range = merged.range;

  const W = terrain.width;
  const H = terrain.height;
  const n = W * H;
  const cost = new Float64Array(n);
  let water = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const code = terrain.codeAt(x, y);
      const isWater = code === TerrainType.WATER || code === TerrainType.DEEP_WATER;
      if (isWater) water += 1;
      cost[y * W + x] = isWater ? 0 : INFINITY_COST;
    }
  }
  if (water === 0) return null; // no water: nothing to be near, so the field is inert

  const span = Math.max(W, H);
  const line = new Float64Array(span);
  const out = new Float64Array(span);
  const v = new Int32Array(span);
  const z = new Float64Array(span + 1);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) line[y] = cost[y * W + x];
    distanceTransform1d(line, H, v, z, out);
    for (let y = 0; y < H; y += 1) cost[y * W + x] = line[y];
  }
  const field = new Float32Array(n);
  for (let y = 0; y < H; y += 1) {
    const row = y * W;
    for (let x = 0; x < W; x += 1) line[x] = cost[row + x];
    distanceTransform1d(line, W, v, z, out);
    for (let x = 0; x < W; x += 1) {
      const distance = Math.sqrt(line[x]);
      field[row + x] = distance <= full ? 1 : falloff((distance - full) / range);
    }
  }
  return field;
}
