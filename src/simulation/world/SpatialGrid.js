/**
 * Uniform spatial hash grid for local neighbor queries.
 *
 * Cell size is a simulation tuning parameter (query locality), completely
 * unrelated to any rendering tile size. The grid is derived state: it is
 * rebuilt from entity positions on load rather than serialized.
 *
 * Query results are sorted by ascending entity id so callers observe a
 * deterministic order independent of internal bucket layout.
 */

/**
 * Bucket keys are packed integers rather than `"x:y"` strings (Step 30): a
 * radius query touches every cell in its bounding box, and building a string
 * per cell allocated once per visit in the hottest loop in the engine. The
 * packing is injective for cell coordinates in ±`KEY_BIAS`, which at the
 * default cell size covers a world millions of units across — far beyond any
 * world the engine builds — and the product stays well inside `Number`'s
 * exact-integer range. Bucket layout is internal either way: results are
 * sorted by id, so no caller can observe the change.
 */
const KEY_BIAS = 1 << 20;
const KEY_STRIDE = 1 << 21;

/** Shared numeric comparator, so a query does not allocate a closure per call. */
function ascending(a, b) {
  return a - b;
}

/**
 * ⚠⚠ **The sort was 68% of `queryRadius`, and `queryRadius` was 14.3% of the
 * whole engine** (profiled 2026-08-07, demo at tick 2000+). Not the cell walk,
 * not the distance tests — `Array.prototype.sort(ascending)`, which calls back
 * into JS once per comparison. Measured on a captured tick of real neighbour
 * queries (249 queries, mean 30 ids, p90 68):
 *
 * | variant                          | ms/tick |
 * | -------------------------------- | ------: |
 * | gather only, no sort, no result  |   0.276 |
 * | push + `sort(ascending)` (was)   |   1.166 |
 * | scratch + typed sort (is)        |   0.545–0.570 |
 *
 * A `TypedArray`'s parameterless `sort()` is numeric and native, so it never
 * re-enters JS. Gathering into a reused buffer also drops the incremental
 * growth of a pushed array. Together: **~2.0× on the query**, and one
 * allocation per call instead of one plus its regrowth.
 *
 * ⚠ **Insertion sort and a skip-if-already-sorted guard were both measured and
 * both rejected**: insertion was *slower* (0.636), and the sorted-check won only
 * 9% (0.523) for a second loop and a branch — 52 of 249 queries came back
 * already ascending, which is not enough to pay for it. The simple thing is
 * within noise of the clever ones.
 *
 * ⚠ **`Int32Array` rather than `Float64Array`**, which was 0.635–0.662 against
 * 0.545–0.570 — a real gap, ranges clear of each other. The cost of that choice
 * is that ids above 2³¹−1 would wrap **silently**, so `insert` refuses them
 * loudly instead (see `MAX_INDEXABLE_ID`). The check is one comparison on a cold
 * path, not in the query.
 */
let scratch = new Int32Array(256);

/**
 * ⚠ The scratch is module-level and shared by every grid in the process, which
 * is safe for one reason and only that reason: **no caller code runs between
 * the gather and the copy out.** The window is a cell walk, a native sort and a
 * copy — all of it inside `queryRadius`, none of it re-entrant. A future variant
 * that yields ids to a callback *during* the walk would break this, and would
 * have to take a per-depth buffer instead.
 */
function scratchFor(capacity) {
  if (capacity <= scratch.length) return scratch;
  let size = scratch.length;
  while (size < capacity) size *= 2;
  const grown = new Int32Array(size);
  // ⚠ The ids gathered so far have to come with it. Growing mid-walk and
  // returning an empty buffer loses every id found before the boundary, and it
  // does so *silently* — the query still returns the right count, padded with
  // zeros. No demo world reaches 256 neighbours (the widest measured is ~80), so
  // this is covered by a sandbox test rather than by anything that would notice
  // on its own.
  grown.set(scratch);
  scratch = grown;
  return scratch;
}

/**
 * The largest entity id the `Int32Array` scratch can hold without wrapping.
 * Entity ids are a monotonic counter that rides through save/load
 * (`EntityManager.#nextId`), so nothing structurally bounds them — reaching this
 * would take ~2×10⁹ spawns, which no run will, but a wrap would corrupt query
 * order *silently* and that is the failure mode this codebase least wants (§2.3).
 */
export const MAX_INDEXABLE_ID = 2 ** 31 - 1;

export class SpatialGrid {
  #cellSize;
  /** @type {Map<number, Map<number, {x: number, y: number}>>} bucket key → id → position */
  #cells = new Map();
  /** @type {Map<number, {x: number, y: number}>} the same position objects, by id */
  #positions = new Map();

  /** @param {number} cellSize */
  constructor(cellSize) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError(`cellSize must be a positive number, got ${cellSize}`);
    }
    this.#cellSize = cellSize;
  }

  get cellSize() {
    return this.#cellSize;
  }

  /** Number of indexed entities. */
  get size() {
    return this.#positions.size;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{cellX: number, cellY: number}}
   */
  cellCoords(x, y) {
    return { cellX: Math.floor(x / this.#cellSize), cellY: Math.floor(y / this.#cellSize) };
  }

  #key(cellX, cellY) {
    return (cellX + KEY_BIAS) * KEY_STRIDE + (cellY + KEY_BIAS);
  }

  /**
   * Buckets hold `id → position`, sharing the very same position object as
   * `#positions`, so a radius query reads each candidate's coordinates straight
   * out of the bucket instead of doing a second hash lookup per candidate
   * (Step 30). Sharing the object rather than copying it is what keeps `move`
   * a single in-place write.
   */
  #addToCell(entityId, x, y, position) {
    const { cellX, cellY } = this.cellCoords(x, y);
    const key = this.#key(cellX, cellY);
    let cell = this.#cells.get(key);
    if (!cell) {
      cell = new Map();
      this.#cells.set(key, cell);
    }
    cell.set(entityId, position);
  }

  #removeFromCell(entityId, x, y) {
    const { cellX, cellY } = this.cellCoords(x, y);
    const key = this.#key(cellX, cellY);
    const cell = this.#cells.get(key);
    if (cell) {
      cell.delete(entityId);
      if (cell.size === 0) this.#cells.delete(key);
    }
  }

  /**
   * @param {number} entityId
   * @param {number} x
   * @param {number} y
   */
  insert(entityId, x, y) {
    if (this.#positions.has(entityId)) {
      throw new Error(`entity ${entityId} is already in the spatial grid`);
    }
    // Refused here, on the cold path, so the hot path can keep a 32-bit scratch
    // without a per-id guard. See `MAX_INDEXABLE_ID`.
    if (!Number.isInteger(entityId) || entityId < 0 || entityId > MAX_INDEXABLE_ID) {
      throw new RangeError(
        `entity id must be an integer in [0, ${MAX_INDEXABLE_ID}] to be indexed, got ${entityId}`,
      );
    }
    const position = { x, y };
    this.#addToCell(entityId, x, y, position);
    this.#positions.set(entityId, position);
  }

  /**
   * Move an indexed entity. The grid's own position record is authoritative;
   * the old coordinates are accepted for API symmetry.
   * @param {number} entityId
   * @param {number} _oldX
   * @param {number} _oldY
   * @param {number} newX
   * @param {number} newY
   */
  move(entityId, _oldX, _oldY, newX, newY) {
    const position = this.#positions.get(entityId);
    if (!position) {
      throw new Error(`entity ${entityId} is not in the spatial grid`);
    }
    const oldCell = this.cellCoords(position.x, position.y);
    const newCell = this.cellCoords(newX, newY);
    if (oldCell.cellX !== newCell.cellX || oldCell.cellY !== newCell.cellY) {
      this.#removeFromCell(entityId, position.x, position.y);
      this.#addToCell(entityId, newX, newY, position);
    }
    position.x = newX;
    position.y = newY;
  }

  /**
   * @param {number} entityId
   * @returns {boolean} true if the entity was indexed
   */
  remove(entityId) {
    const position = this.#positions.get(entityId);
    if (!position) return false;
    this.#removeFromCell(entityId, position.x, position.y);
    this.#positions.delete(entityId);
    return true;
  }

  /**
   * Entity ids within euclidean `radius` of (x, y), sorted ascending.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {number[]}
   */
  queryRadius(x, y, radius) {
    const radiusSquared = radius * radius;
    const cellSize = this.#cellSize;
    const cells = this.#cells;
    const minCellX = Math.floor((x - radius) / cellSize);
    const maxCellX = Math.floor((x + radius) / cellSize);
    const minCellY = Math.floor((y - radius) / cellSize);
    const maxCellY = Math.floor((y + radius) / cellSize);
    // Ids are gathered into the shared scratch rather than a pushed array, and
    // sorted natively rather than through a comparator — see the note on
    // `scratch` for the measurements that decided both.
    let buffer = scratch;
    let count = 0;
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      // The key packing is linear in cellY, so a row costs one multiply and
      // then an increment per cell rather than a key build per cell.
      const rowBase = (cellX + KEY_BIAS) * KEY_STRIDE + KEY_BIAS;
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const cell = cells.get(rowBase + cellY);
        if (cell === undefined) continue;
        for (const [entityId, position] of cell) {
          const dx = position.x - x;
          const dy = position.y - y;
          if (dx * dx + dy * dy <= radiusSquared) {
            if (count === buffer.length) buffer = scratchFor(count + 1);
            buffer[count] = entityId;
            count += 1;
          }
        }
      }
    }
    // Ascending id is the contract; a query that found at most one entity is
    // already in that order. `TypedArray#sort` with no argument is numeric, so
    // this is the same order the comparator produced.
    if (count > 1) buffer.subarray(0, count).sort();
    const results = new Array(count);
    for (let i = 0; i < count; i += 1) results[i] = buffer[i];
    return results;
  }

  /**
   * Entity ids inside one grid cell, sorted ascending.
   * @param {number} cellX
   * @param {number} cellY
   * @returns {number[]}
   */
  queryCell(cellX, cellY) {
    const cell = this.#cells.get(this.#key(cellX, cellY));
    return cell ? [...cell.keys()].sort(ascending) : [];
  }

  clear() {
    this.#cells.clear();
    this.#positions.clear();
  }
}
