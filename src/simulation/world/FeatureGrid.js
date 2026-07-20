/**
 * Marks animals leave on the ground (Step 28) — trails and burrows.
 *
 * **Sparse, not a field.** Vegetation and the claim layer are dense arrays
 * because every cell has a value; worn ground is the opposite — a handful of
 * cells out of the whole map carry anything at all, and the step's own note says
 * feature writes are sparse and local. So this is a `Map` from cell index to a
 * kind and an amount of wear, which makes a write O(1), makes decay proportional
 * to the number of *worn* cells rather than the size of the world, and costs
 * nothing whatsoever on a map nobody has walked on yet.
 *
 * **Wear is the only state.** There is no "is a trail" flag: a cell is a trail
 * when its wear is at or above the threshold and stops being one when it falls
 * below, so the feature and the thing that produced it can never disagree
 * (dominance, disease severity, and every disturbance effect are derived the
 * same way). That also makes the whole lifecycle — appear, deepen, fade — one
 * number moving in two directions.
 *
 * **One kind per cell, and a different kind has to erode it first.** This is the
 * `ScentGrid.mark` rule reused deliberately rather than reinvented: writing a
 * burrow onto a well-worn trail does not flip it, it wears the trail down, and
 * only takes the cell once it has worn it away. Trampling a burrow flat is
 * exactly what erosion means, and it keeps a cell from flickering between kinds
 * on alternate ticks.
 *
 * **Bounded, and it says so.** At most `maxCells` are tracked; once full, new
 * ground is simply not recorded until decay frees a slot. That is a stated limit
 * in the same spirit as `forgotten` in the tombstone registry — a bound you can
 * read rather than an unbounded structure that happens to stay small. In
 * practice decay keeps the map far below the cap, because a cell crossed once
 * fades within a few dozen ticks and only repeatedly-used ground accumulates.
 *
 * Ownership: written only by `EngineeringSystem`. Read by `world.speedModifierAt`
 * (a trail is packed ground) and `world.isShelteredAt` (a burrow is shelter).
 * Persisted, because ground animals wore down over thousands of ticks cannot be
 * recovered from the seed.
 */

export const DEFAULT_FEATURE_PARAMS = Object.freeze({
  maxCells: 8192, // hard cap on tracked worn cells
  floor: 0.02, // wear below this is forgotten entirely
});

export class FeatureGrid {
  #width;
  #height;
  /** @type {Map<number, {kind: string, wear: number}>} cell index → wear record */
  #cells = new Map();
  #maxCells;
  /** Cells currently at or above the promotion threshold. */
  #promoted = 0;
  /**
   * Bumped only when the **promoted** set changes — a cell crossing the
   * threshold in either direction — and deliberately *not* on every wear write.
   * Wear is written by every moving animal every tick; if that bumped the
   * revision, the projection would be dirty on every tick forever and deltas
   * would carry the whole feature list constantly. Promotion is rare, so this
   * makes the layer nearly free to project.
   */
  #revision = 0;

  /**
   * @param {object} options
   * @param {number} options.width world cells across
   * @param {number} options.height
   * @param {object} [options.params]
   */
  constructor({ width, height, params = {} }) {
    const merged = { ...DEFAULT_FEATURE_PARAMS, ...params };
    this.#width = width;
    this.#height = height;
    this.#maxCells = merged.maxCells;
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get revision() {
    return this.#revision;
  }

  /** How many cells carry any wear at all. */
  get trackedCells() {
    return this.#cells.size;
  }

  /** How many cells are currently deep enough to count as a feature. */
  get featureCount() {
    return this.#promoted;
  }

  #index(cellX, cellY) {
    if (cellX < 0 || cellY < 0 || cellX >= this.#width || cellY >= this.#height) return -1;
    return cellY * this.#width + cellX;
  }

  /** The wear record at a cell, or null. Treat as read-only. */
  at(cellX, cellY) {
    const index = this.#index(cellX, cellY);
    return index === -1 ? null : (this.#cells.get(index) ?? null);
  }

  /**
   * Add wear of a kind to a cell.
   *
   * @param {number} cellX @param {number} cellY
   * @param {string} kind
   * @param {number} amount
   * @param {number} threshold wear at which the cell becomes a feature
   * @param {number} [cap] most wear a cell may hold
   * @returns {'promoted' | 'changed' | null} 'promoted' the tick it becomes a feature
   */
  wear(cellX, cellY, kind, amount, threshold, cap = 1) {
    const index = this.#index(cellX, cellY);
    if (index === -1 || !(amount > 0)) return null;

    const existing = this.#cells.get(index);
    if (existing === undefined) {
      // New ground. The cap is a real limit, not a soft one: when the map is
      // full, ground simply is not tracked until decay frees a slot.
      if (this.#cells.size >= this.#maxCells) return null;
      const wear = Math.min(cap, amount);
      const feature = wear >= threshold;
      this.#cells.set(index, { kind, wear, feature });
      if (feature) {
        this.#promoted += 1;
        this.#revision += 1;
        return 'promoted';
      }
      return 'changed';
    }

    if (existing.kind === kind) {
      existing.wear = Math.min(cap, existing.wear + amount);
    } else {
      // A different kind has to wear this one away first (the ScentGrid rule).
      const remaining = existing.wear - amount;
      if (remaining > 0) {
        existing.wear = remaining;
      } else {
        existing.kind = kind;
        existing.wear = Math.min(cap, -remaining);
      }
    }

    if (!existing.feature && existing.wear >= threshold) {
      existing.feature = true;
      this.#promoted += 1;
      this.#revision += 1;
      return 'promoted';
    }
    return 'changed';
  }

  /**
   * Fade every worn cell. Called on an interval with the elapsed ticks folded
   * in, so staggering changes the cost and not the rate — the same trick the
   * memory, vegetation, and territory systems use.
   *
   * O(worn cells), not O(world). A map nobody has walked on costs nothing.
   *
   * ⚠ **Demotion uses a lower threshold than promotion**, and that hysteresis is
   * load-bearing rather than polish. Without it a cell sitting near the
   * threshold crosses back and forth on alternate decay ticks: the first working
   * version produced **9569 trails formed and 9081 lost** in one run, which is
   * not a world with trails in it, it is a world flickering. Each flap also
   * costs two domain events and a revision bump, so the projection churned as
   * well. Storing which side of the band a cell is on is a deliberate exception
   * to "derive rather than store" — with hysteresis the state genuinely depends
   * on history, and that is exactly what a derived value cannot express.
   *
   * @param {number} amount wear to remove
   * @param {number} demoteBelow wear at which a feature stops being one
   * @param {number} [floor] wear below which a cell is forgotten entirely
   * @returns {Array<{cellX: number, cellY: number, kind: string}>} cells that stopped being features
   */
  decay(amount, demoteBelow, floor = DEFAULT_FEATURE_PARAMS.floor) {
    if (!(amount > 0) || this.#cells.size === 0) return [];
    const lost = [];
    for (const [index, record] of this.#cells) {
      record.wear -= amount;
      const gone = record.wear <= floor;
      if (gone) this.#cells.delete(index);
      if (record.feature && (gone || record.wear < demoteBelow)) {
        record.feature = false;
        this.#promoted -= 1;
        this.#revision += 1;
        lost.push({ cellX: index % this.#width, cellY: Math.floor(index / this.#width), kind: record.kind });
      }
    }
    return lost;
  }

  /**
   * Every cell deep enough to count as a feature, in ascending cell order.
   *
   * Ascending rather than insertion order because this feeds the protocol
   * projection, and iteration order everywhere in this engine is deterministic
   * by rule. A `Map` iterates in insertion order, which would make the payload
   * depend on the history of who walked where first.
   *
   * @returns {Array<{cellX: number, cellY: number, kind: string, wear: number}>}
   */
  features() {
    const out = [];
    for (const [index, record] of this.#cells) {
      if (!record.feature) continue;
      out.push({
        index,
        cellX: index % this.#width,
        cellY: Math.floor(index / this.#width),
        kind: record.kind,
        wear: record.wear,
      });
    }
    out.sort((a, b) => a.index - b.index);
    return out.map(({ cellX, cellY, kind, wear }) => ({ cellX, cellY, kind, wear }));
  }

  /** Serializable plain data. Worn ground is evolved state, not seed-derived. */
  serialize() {
    const cells = [];
    // The `feature` flag is saved rather than recomputed: with hysteresis it
    // records which side of the band a cell is on, which a threshold comparison
    // cannot recover.
    for (const [index, record] of this.#cells) cells.push([index, record.kind, record.wear, record.feature ? 1 : 0]);
    cells.sort((a, b) => a[0] - b[0]);
    return { width: this.#width, height: this.#height, cells, revision: this.#revision, promoted: this.#promoted };
  }

  /** @param {ReturnType<FeatureGrid['serialize']>} saved */
  restore(saved) {
    this.#cells = new Map();
    if (!saved) return;
    for (const [index, kind, wear, feature] of saved.cells ?? []) {
      this.#cells.set(index, { kind, wear, feature: feature === 1 });
    }
    this.#revision = saved.revision ?? 0;
    this.#promoted = saved.promoted ?? 0;
  }
}
