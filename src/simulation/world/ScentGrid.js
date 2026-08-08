/**
 * Territorial claims as a coarse cell layer (Step 24).
 *
 * A territory is not a shape anyone draws. It is **whatever ground an animal
 * has marked most recently and most strongly**, and it exists only as two
 * numbers per cell: who claims it, and how fresh that claim is. Everything the
 * step asks for falls out of that pair rather than being modelled separately:
 *
 *   - **marking** writes a claim at the animal's own position;
 *   - **avoidance** is an O(1) lookup — whose ground am I standing on?
 *   - **conflict** happens when someone stands on a claim that is not theirs;
 *   - **territory loss** is a stronger claim overwriting a weaker one;
 *   - **occupation of vacant areas** needs no rule at all: when an animal stops
 *     marking (because it died, or moved on), its claims fade to nothing and
 *     the next animal through writes its own.
 *
 * Deliberately **coarser than the world grid** (`cellSize`, default 4). A
 * territory is a coarse-grained thing — an animal's range spans dozens of world
 * cells — so a per-world-cell layer would spend sixteen times the memory to
 * store the same information at a resolution nothing reads. At the demo's
 * 128×128 that is 32×32 = 1024 claim cells; even at 1024² it is 65,536.
 *
 * Two parallel typed arrays rather than an array of objects, for the same
 * reason `VegetationGrid` uses one: this is a field, not a collection of
 * records. Owner `0` means unclaimed (entity ids start at 1, so zero is free
 * as a sentinel).
 *
 * Ownership: written only by `TerritorySystem` (marking, decay, and the
 * transfer that follows a lost dispute). Read by the decision system for
 * avoidance. Persisted, because a map of who holds what cannot be recovered
 * from the seed once animals have been walking around on it.
 */

export const DEFAULT_TERRITORY_PARAMS = Object.freeze({
  cellSize: 4, // world cells per claim cell
  decayPerTick: 0.0025, // claim strength lost per tick (~400 ticks to fade out)
  markStrength: 1, // strength a fresh mark writes
  claimFloor: 0.05, // below this a claim is dropped entirely
  decayInterval: 10, // decay runs every N ticks, scaled so the rate is unchanged
});

export class ScentGrid {
  #width;
  #height;
  #cellSize;
  /** @type {Int32Array} owning entity id per claim cell; 0 = unclaimed */
  #owner;
  /** @type {Float32Array} claim strength per claim cell, 0…1 */
  #strength;
  #revision = 0;
  /**
   * A second revision that moves **only when a cell changes hands**.
   *
   * ⚠ `#revision` moves on every mark and every decay sweep, which is several
   * times a tick forever — it is the right stamp for "has anything about this
   * layer changed", and it is useless for the one consumer that only cares
   * *who* holds what: the renderer projection (A36). Ownership is the rare
   * event, strength is the constant one, and separating them is what lets a
   * delta carry territory on the ticks a boundary actually moves rather than on
   * all of them. Same judgement `FeatureGrid` makes between wear and what wear
   * *means*.
   */
  #ownerRevision = 0;

  /**
   * @param {object} options
   * @param {number} options.worldWidth
   * @param {number} options.worldHeight
   * @param {object} [options.params]
   */
  constructor({ worldWidth, worldHeight, params = {} }) {
    const { cellSize } = { ...DEFAULT_TERRITORY_PARAMS, ...params };
    this.#cellSize = Math.max(1, Math.floor(cellSize));
    this.#width = Math.max(1, Math.ceil(worldWidth / this.#cellSize));
    this.#height = Math.max(1, Math.ceil(worldHeight / this.#cellSize));
    this.#owner = new Int32Array(this.#width * this.#height);
    this.#strength = new Float32Array(this.#width * this.#height);
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get cellSize() {
    return this.#cellSize;
  }

  get revision() {
    return this.#revision;
  }

  /** Moves only when some cell changes hands. See `#ownerRevision`. */
  get ownerRevision() {
    return this.#ownerRevision;
  }

  /**
   * Who holds each claim cell, row-major (0 = unclaimed). Read-only by
   * contract, exactly as `VegetationGrid.levels()` is — the projection below is
   * its only caller and it does not keep the reference.
   * @returns {Int32Array}
   */
  owners() {
    return this.#owner;
  }

  /** Claim-cell coordinates for a continuous world position, clamped. */
  cellOf(x, y) {
    const cx = Math.min(Math.max(Math.floor(x / this.#cellSize), 0), this.#width - 1);
    const cy = Math.min(Math.max(Math.floor(y / this.#cellSize), 0), this.#height - 1);
    return { cellX: cx, cellY: cy };
  }

  #index(cellX, cellY) {
    if (cellX < 0 || cellY < 0 || cellX >= this.#width || cellY >= this.#height) return -1;
    return cellY * this.#width + cellX;
  }

  /** Who claims the ground at a world position (0 = nobody). */
  ownerAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    const index = this.#index(cellX, cellY);
    return index === -1 ? 0 : this.#owner[index];
  }

  /** How strong the claim at a world position is, 0…1. */
  strengthAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    const index = this.#index(cellX, cellY);
    return index === -1 ? 0 : this.#strength[index];
  }

  /**
   * Mark ground for an owner.
   *
   * A mark by the current owner refreshes the claim. A mark by anyone else has
   * to **overcome** it: the incoming strength is reduced by what is already
   * there, so taking ground off a resident who keeps renewing it is slow, and
   * taking abandoned ground is instant. That single rule is what makes a
   * boundary sit where two animals' marking rates balance, rather than
   * wherever the last passer-by happened to stand.
   *
   * @param {number} x @param {number} y
   * @param {number} ownerId
   * @param {number} [strength] full strength of this mark
   * @returns {boolean} whether the cell changed hands
   */
  mark(x, y, ownerId, strength = DEFAULT_TERRITORY_PARAMS.markStrength) {
    const { cellX, cellY } = this.cellOf(x, y);
    const index = this.#index(cellX, cellY);
    if (index === -1 || ownerId <= 0) return false;

    const currentOwner = this.#owner[index];
    this.#revision += 1;
    if (currentOwner === ownerId || currentOwner === 0 || this.#strength[index] <= 0) {
      this.#owner[index] = ownerId;
      this.#strength[index] = Math.min(1, Math.max(this.#strength[index] * (currentOwner === ownerId ? 1 : 0), 0) + strength);
      if (currentOwner === ownerId) return false;
      this.#ownerRevision += 1;
      return true;
    }
    // Contested ground: the incoming mark erodes the resident's claim, and only
    // takes the cell once it has worn it away completely.
    const remaining = this.#strength[index] - strength;
    if (remaining > 0) {
      this.#strength[index] = remaining;
      return false;
    }
    this.#owner[index] = ownerId;
    this.#strength[index] = Math.min(1, -remaining);
    this.#ownerRevision += 1;
    return true;
  }

  /**
   * Hand every cell held by one owner to another (or to nobody, with 0). Used
   * when a dispute is lost — the loser does not merely stop marking, it yields
   * what it held on the spot, which is what makes losing a territory legible
   * rather than a slow fade nobody can see.
   *
   * O(cells) and deliberately rare: only a resolved dispute calls it.
   * @param {number} fromId @param {number} toId
   * @returns {number} cells transferred
   */
  transfer(fromId, toId) {
    if (fromId <= 0) return 0;
    let moved = 0;
    for (let i = 0; i < this.#owner.length; i += 1) {
      if (this.#owner[i] !== fromId) continue;
      this.#owner[i] = toId > 0 ? toId : 0;
      if (toId <= 0) this.#strength[i] = 0;
      moved += 1;
    }
    if (moved > 0) {
      this.#revision += 1;
      this.#ownerRevision += 1;
    }
    return moved;
  }

  /**
   * Fade every claim. Called on an interval with the elapsed ticks folded in,
   * so staggering changes the cost and not the rate.
   * @param {number} amount strength to remove
   * @param {number} [claimFloor] strength below which a claim is dropped
   */
  decay(amount, claimFloor = DEFAULT_TERRITORY_PARAMS.claimFloor) {
    if (!(amount > 0)) return;
    let dropped = 0;
    for (let i = 0; i < this.#strength.length; i += 1) {
      if (this.#owner[i] === 0) continue;
      const next = this.#strength[i] - amount;
      if (next <= claimFloor) {
        this.#owner[i] = 0;
        this.#strength[i] = 0;
        dropped += 1;
      } else {
        this.#strength[i] = next;
      }
    }
    this.#revision += 1;
    // ⚠ Only when a claim actually faded out. Every sweep weakens claims and
    // almost none of them end one, so gating the ownership stamp here is what
    // keeps the projection reusable across the ticks in between.
    if (dropped > 0) this.#ownerRevision += 1;
  }

  /** How many claim cells one owner holds. O(cells); for metrics and tests. */
  countFor(ownerId) {
    let held = 0;
    for (let i = 0; i < this.#owner.length; i += 1) {
      if (this.#owner[i] === ownerId) held += 1;
    }
    return held;
  }

  /** Total claimed cells and distinct holders. O(cells); metrics only. */
  summary() {
    const holders = new Set();
    let claimed = 0;
    for (let i = 0; i < this.#owner.length; i += 1) {
      if (this.#owner[i] === 0) continue;
      claimed += 1;
      holders.add(this.#owner[i]);
    }
    return { claimed, cells: this.#owner.length, holders: holders.size };
  }

  /** Serializable plain-data view (claims evolve; they are not seed-derived). */
  serialize() {
    return {
      cellSize: this.#cellSize,
      width: this.#width,
      height: this.#height,
      owner: Array.from(this.#owner),
      strength: Array.from(this.#strength),
      revision: this.#revision,
      ownerRevision: this.#ownerRevision,
    };
  }

  /** @param {ReturnType<ScentGrid['serialize']>} saved */
  restore(saved) {
    if (!saved) return;
    this.#owner = Int32Array.from(saved.owner ?? []);
    this.#strength = Float32Array.from(saved.strength ?? []);
    this.#revision = saved.revision ?? 0;
    // ⚠ **A save written before this field existed is still `formatVersion` 34
    // and still restores**, so the fallback is load-bearing rather than
    // defensive: the addition is a cache key, not state, and every reader that
    // matters treats a *higher* stamp as "re-derive". Falling back to the
    // general revision is therefore safe in the only direction that counts — a
    // projection memoized against it is invalidated once too often, never once
    // too seldom.
    this.#ownerRevision = saved.ownerRevision ?? saved.revision ?? 0;
  }
}

/**
 * Renderer-neutral projection of **who holds what**, carried by full snapshots
 * and patched by deltas (protocol v37, closing §1.4 A36).
 *
 * ⚠ **Ownership only — the strengths stay inside the engine.** Two numbers per
 * cell is what the *mechanism* needs; a viewer asked "whose ground is this" and
 * the answer is one of them. Projecting freshness as well would double the
 * payload to draw a fade nothing reads, and it is the number that changes every
 * tick, so it is also what would make the revision gate below worthless.
 *
 * RLE row-major over the coarse claim grid, exactly as vegetation is over the
 * world grid. It compresses hard for the reason the layer exists: most of the
 * map is unclaimed, so the common projection is a handful of runs of `0` around
 * a few blocks of one id.
 *
 * @param {ScentGrid} scent
 */
export function projectTerritory(scent) {
  const owners = scent.owners();
  const runs = [];
  if (owners.length > 0) {
    let currentOwner = owners[0];
    let count = 0;
    for (const owner of owners) {
      if (owner === currentOwner) {
        count += 1;
      } else {
        runs.push([currentOwner, count]);
        currentOwner = owner;
        count = 1;
      }
    }
    runs.push([currentOwner, count]);
  }
  return {
    width: scent.width,
    height: scent.height,
    cellSize: scent.cellSize,
    revision: scent.ownerRevision,
    encoding: 'rle-row-major',
    runs,
  };
}
