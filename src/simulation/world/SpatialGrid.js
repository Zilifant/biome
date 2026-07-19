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
export class SpatialGrid {
  #cellSize;
  /** @type {Map<string, Set<number>>} */
  #cells = new Map();
  /** @type {Map<number, {x: number, y: number}>} */
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
    return `${cellX}:${cellY}`;
  }

  #addToCell(entityId, x, y) {
    const { cellX, cellY } = this.cellCoords(x, y);
    const key = this.#key(cellX, cellY);
    let cell = this.#cells.get(key);
    if (!cell) {
      cell = new Set();
      this.#cells.set(key, cell);
    }
    cell.add(entityId);
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
    this.#addToCell(entityId, x, y);
    this.#positions.set(entityId, { x, y });
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
      this.#addToCell(entityId, newX, newY);
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
    const minCellX = Math.floor((x - radius) / this.#cellSize);
    const maxCellX = Math.floor((x + radius) / this.#cellSize);
    const minCellY = Math.floor((y - radius) / this.#cellSize);
    const maxCellY = Math.floor((y + radius) / this.#cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const cell = this.#cells.get(this.#key(cellX, cellY));
        if (!cell) continue;
        for (const entityId of cell) {
          const position = this.#positions.get(entityId);
          const dx = position.x - x;
          const dy = position.y - y;
          if (dx * dx + dy * dy <= radiusSquared) results.push(entityId);
        }
      }
    }
    return results.sort((a, b) => a - b);
  }

  /**
   * Entity ids inside one grid cell, sorted ascending.
   * @param {number} cellX
   * @param {number} cellY
   * @returns {number[]}
   */
  queryCell(cellX, cellY) {
    const cell = this.#cells.get(this.#key(cellX, cellY));
    return cell ? [...cell].sort((a, b) => a - b) : [];
  }

  clear() {
    this.#cells.clear();
    this.#positions.clear();
  }
}
