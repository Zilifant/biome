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
    const results = [];
    const radiusSquared = radius * radius;
    const cellSize = this.#cellSize;
    const cells = this.#cells;
    const minCellX = Math.floor((x - radius) / cellSize);
    const maxCellX = Math.floor((x + radius) / cellSize);
    const minCellY = Math.floor((y - radius) / cellSize);
    const maxCellY = Math.floor((y + radius) / cellSize);
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
          if (dx * dx + dy * dy <= radiusSquared) results.push(entityId);
        }
      }
    }
    // Ascending id is the contract; a query that found at most one entity is
    // already in that order.
    return results.length > 1 ? results.sort(ascending) : results;
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
