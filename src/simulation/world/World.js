import { EntityManager } from './EntityManager.js';
import { SpatialGrid } from './SpatialGrid.js';
import { TerrainGrid, TerrainType, isShelteringCode } from './TerrainGrid.js';
import { VegetationGrid } from './VegetationGrid.js';
import { initialEnvironment } from './Environment.js';
import { ScentGrid } from './ScentGrid.js';
import { speedScaleAt } from '../disturbance/disturbances.js';
import { FeatureGrid } from './FeatureGrid.js';
import { SpeciesRegistry } from '../config/species/schema.js';
import { GroupRegistry } from './GroupRegistry.js';
import { speedScaleAt as featureSpeedScaleAt, sheltersAt } from '../engineering/features.js';

/**
 * The world aggregates entity storage, the spatial index, the static terrain
 * layer, the vegetation biomass layer, and the world's static configuration
 * (dimensions). Positions are continuous coordinates in [0, width] x
 * [0, height]; movement is clamped at the borders.
 *
 * World knows nothing about ticks, systems, commands, or the protocol.
 */
export class World {
  /**
   * @param {object} config
   * @param {number} config.width
   * @param {number} config.height
   * @param {number} [config.cellSize]
   * @param {number} [config.terrainSeed] deterministic terrain seed (from the engine)
   * @param {object} [config.terrain] terrain generation parameters
   * @param {number} [config.vegetationSeed] deterministic vegetation seed
   * @param {object} [config.vegetation] vegetation parameters
   */
  constructor(config) {
    if (!Number.isFinite(config?.width) || config.width <= 0 || !Number.isFinite(config?.height) || config.height <= 0) {
      throw new RangeError('world config requires positive width and height');
    }
    this.config = Object.freeze({ ...config });
    // Resolved species (Step 29): every species merged against the config
    // defaults and deep-frozen, once, at construction. Systems read biology
    // from here — `world.species.get(entity.speciesId)` — which is one Map.get
    // and no allocation, because the step's performance note rules out doing
    // config indirection in a hot loop.
    this.species = config.species ?? new SpeciesRegistry([], {});
    this.entities = new EntityManager();
    this.grid = new SpatialGrid(config.cellSize ?? 8);
    // Terrain uses integer cell dimensions; world width/height are already
    // whole numbers for the demo, but floor defensively.
    this.terrain = new TerrainGrid({
      width: Math.floor(config.width),
      height: Math.floor(config.height),
      seed: (config.terrainSeed ?? 0) >>> 0,
      params: config.terrain ?? {},
    });
    // Territorial claims (Step 24): a coarse who-holds-what layer, deliberately
    // lower resolution than the world grid. Written only by the territory
    // system; persisted, since a map of claims cannot be recovered from a seed.
    this.scent = new ScentGrid({
      worldWidth: config.width,
      worldHeight: config.height,
      params: config.territory ?? {},
    });
    // Vegetation suitability is derived from terrain, so terrain comes first.
    this.vegetation = new VegetationGrid({
      terrain: this.terrain,
      seed: (config.vegetationSeed ?? 0) >>> 0,
      params: config.vegetation ?? {},
    });
    // Transient per-entity perception summaries, rebuilt each tick by the
    // perception system. Derived state — never serialized (like the spatial
    // grid); empty until the first perception tick after construction/load.
    /** @type {Map<number, object>} */
    this.perception = new Map();
    // Transient per-entity social summaries (Step 23) — groupmates in range,
    // their centre of mass and mean heading. Rebuilt each tick by the social
    // system, exactly like `perception`, and never serialized: the only social
    // state that persists is the `groupId` label on the entity itself.
    /** @type {Map<number, object>} */
    this.social = new Map();
    // The living animals each animal has within its perception radius, and how
    // far away they are — the raw result of the neighbour walk the perception
    // system already performs, kept so the social system does not have to walk
    // the same neighbourhood a second time (Step 30, §1.4 C6). Transient and
    // never serialized, exactly like `perception` and `social`.
    //
    // Kept beside the perception summary rather than inside it because the
    // summary is projected to inspection: this is an internal scratch buffer
    // and must not leak through the protocol (invariant 11). Each entry is a
    // flat `[id, distance, id, distance, …]` array in ascending-id order, which
    // is the order `SpatialGrid.queryRadius` guarantees.
    /** @type {Map<number, number[]>} */
    this.neighbourhood = new Map();
    // The tick `neighbourhood` was built on. A consumer must check this: the
    // perception system supports `updateInterval`, so on a staggered tick the
    // map holds a stale neighbourhood and the consumer has to walk the grid
    // itself. Null until the first perception tick.
    /** @type {number|null} */
    this.neighbourhoodTick = null;
    // Persistent social groups (PLAN-SPECIES.md §3.8). ⚠ A *different* mechanism
    // from the herd label on the entity: `groupId` is positional and recomputed
    // every tick, while a record here is an identity that survives separation —
    // a pride, a clan, a band. Bounded, written only by `GroupSystem`, and
    // persisted, since who belongs to whom is evolved state no seed reproduces.
    // Empty in every world today: no shipped species forms persistent groups.
    this.groups = new GroupRegistry({ maxGroups: config.groups?.maxGroups });
    // Bounded memory of entities that have left the world (Step 18). Written at
    // the engine's removal chokepoint; see world/lineage.js for why this exists
    // and what "forgotten" means. Insertion-ordered, so eviction is FIFO.
    /** @type {Map<number, object>} */
    this.tombstones = new Map();
    // Season and weather (Step 19) — the only genuinely global state in the
    // world. Owned by the weather system; everything else reads it. Derived
    // from the tick + one stochastic weather state, so it is restored by
    // replaying the weather stream rather than stored piecemeal.
    // Derived population metrics (Step 21). Written only by the metrics system
    // and never read back by anything that affects behaviour. The report itself
    // is recomputed on the next metrics tick after a load; the bounded history
    // is persisted, since a chart that resets on every restore is useless.
    /** @type {object | null} */
    this.metrics = null;
    /** @type {object[]} */
    this.metricsHistory = [];
    this.environment = initialEnvironment(config.environment ?? { ticksPerYear: 8000, meanTemperature: 14, temperatureAmplitude: 14 });
    // Active local disturbances (Step 27) — fires, floods, storms. A bounded
    // list of small records, capped by the disturbance system, and the *only*
    // state the mechanism has: every effect (slower ground, colder air, burnt
    // grass) is derived from these on read rather than written into the world
    // and undone later, which is why a disturbance cannot leave the world
    // half-changed when it ends. Terrain is never touched — it is static and
    // regenerated from the seed on load, so an edit to it would silently vanish
    // on restore.
    /** @type {object[]} */
    this.disturbances = [];
    // Counter for disturbance ids, on the world rather than the system so it
    // survives a save (a fresh system restarting at 1 would reissue the id of
    // something still burning).
    this.nextDisturbanceId = 1;
    // Ground animals have worn (Step 28) — trails and burrows. Sparse rather
    // than a field: a handful of cells out of the whole map carry anything, so
    // a world nobody has walked on costs nothing. Written only by
    // `EngineeringSystem`; read through the two chokepoints below.
    this.features = new FeatureGrid({
      width: this.terrain.width,
      height: this.terrain.height,
      params: config.engineering ?? {},
    });
    // Note there is deliberately no threshold here. Whether a cell *is* a
    // feature is stored on the cell (see FeatureGrid: hysteresis makes it
    // depend on history, not just on wear), so the read chokepoints below ask
    // the cell rather than comparing against a number that would have to be
    // kept in step with the system's copy.
  }

  /** Cell coordinates containing a continuous position, clamped to the grid. */
  cellOf(x, y) {
    return {
      cellX: Math.min(Math.max(Math.floor(x), 0), this.terrain.width - 1),
      cellY: Math.min(Math.max(Math.floor(y), 0), this.terrain.height - 1),
    };
  }

  /**
   * Terrain traversal speed multiplier at a continuous position (1 =
   * unimpeded, lower = slower). Authoritative movement cost.
   * @param {number} x @param {number} y
   * @returns {number}
   */
  speedModifierAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    // Disturbances (Step 27) fold in here rather than anywhere else, because
    // this is the single chokepoint the movement system already asks — so
    // wading through a flood is the same kind of fact as pushing through cover,
    // and no system needs to learn about disturbances to be slowed by one.
    // `speedScaleAt` costs one length check when nothing is happening, which is
    // most of the demo's history.
    //
    // Worn ground (Step 28) folds in at the same chokepoint and for the same
    // reason: packed earth being quicker to cross is the same kind of fact as
    // cover being slower, so no system needs to know a trail exists to be
    // carried along one. Also free on a map nobody has worn down.
    return (
      this.terrain.speedModifierAt(cellX, cellY) *
      speedScaleAt(this.disturbances, x, y) *
      featureSpeedScaleAt(this.features, cellX, cellY)
    );
  }

  get width() {
    return this.config.width;
  }

  get height() {
    return this.config.height;
  }

  /**
   * Whether an entity may occupy the cell containing a continuous position.
   * The authoritative movement-validity check (terrain ownership stays here,
   * never in the renderer).
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  isPassableAt(x, y) {
    const cellX = Math.min(Math.max(Math.floor(x), 0), this.terrain.width - 1);
    const cellY = Math.min(Math.max(Math.floor(y), 0), this.terrain.height - 1);
    return this.terrain.isPassable(cellX, cellY);
  }

  /**
   * Whether line of sight is blocked at a continuous position — the single
   * chokepoint perception raycasts against. Terrain opacity today (only rock is
   * opaque; deep water is impassable but transparent), and the one place to fold
   * in non-terrain blockers later — a fire's smoke, a future wall — exactly as
   * `speedModifierAt` folds in disturbances and worn ground, so no system has to
   * learn a new source of concealment to be hidden by one. Nothing here is
   * specific to rock.
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  blocksSightAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    return this.terrain.blocksSightAt(cellX, cellY);
  }

  /**
   * How well the ground at a continuous position hides an animal standing on it,
   * 0 (plain sight) to 1 (invisible) — the graded form of `blocksSightAt`, and
   * the chokepoint perception discounts its detection range by (PLAN-SPECIES.md
   * §3.12, phase 14).
   *
   * ⚠ **"Hidden *in*" is a different question from "hidden *behind*"**, and this
   * world answers them in two places on purpose: `blocksSightAt` is asked about
   * the cells *between* two animals (the raycast), this is asked about the cell
   * the target is standing *on*. Low brush is 0.55 here and transparent there —
   * you see straight through a stand of it and still fail to pick out the cat
   * crouched in the middle. They meet at 1: total concealment is opacity, which
   * is why the terrain's boolean is derived from its concealment scale.
   *
   * The one place to fold in non-terrain concealment later — smoke from a fire,
   * the A51 shrub layer — exactly as `speedModifierAt` folds in disturbances and
   * worn ground, so no system has to learn a new source of cover to be hidden by
   * one.
   * @param {number} x @param {number} y
   * @returns {number}
   */
  concealmentAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    return this.terrain.concealmentAt(cellX, cellY);
  }

  /**
   * Whether a continuous position is inside a thicket — passable ground so slow
   * to cross that the movement system only lets an animal push in when it is
   * fleeing (or already inside, so it can push back out). The one predicate that
   * turns "extremely slow" into "avoided unless it is the last choice".
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  isThicketAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    return this.terrain.codeAt(cellX, cellY) === TerrainType.THICKET;
  }

  /**
   * Whether a continuous position stands under a tree — the ground a climber can
   * leave (phase T2, `locomotion/climbing.js`).
   *
   * ⚠ Deliberately the same shape as `isThicketAt` rather than something
   * cleverer, and for the same reason: one predicate, one home, several readers.
   * A tree is not otherwise special to any system — it is passable, it grows
   * grass, and it shelters like anything else — so this exists only to answer
   * "can an animal be *above* here", which is a question no existing chokepoint
   * was asking.
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  isTreeAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    return this.terrain.codeAt(cellX, cellY) === TerrainType.TREE;
  }

  /**
   * Whether the cell at a continuous position gives shelter from the weather
   * (Step 19). Cover is the only sheltering terrain today; keeping the test
   * here rather than in a system means "what counts as shelter" has one home.
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  isShelteredAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    // Cover (low brush) and thicket (a dense stand) both break the weather.
    // ⚠ Through `isShelteringCode` rather than a pair of comparisons here, so
    // that "which terrain shelters" has one definition and the perception cue
    // (which fills the only shelter *cue* an animal has) cannot drift from the
    // relief the thermal cost actually applies. That drift was A68.
    if (isShelteringCode(this.terrain.codeAt(cellX, cellY))) return true;
    // A burrow is shelter an animal made (Step 28). Landing it here rather than
    // in the metabolism system means thermoregulation and the `shelter` action
    // both pick it up for free, and neither of them knows the difference between
    // a thicket and a hole in the ground.
    return sheltersAt(this.features, cellX, cellY);
  }

  /**
   * Direction and straight-line distance from a continuous position to the
   * nearest drinkable (shallow) water cell, or null if the world has no water.
   * Backed by a bearing field flooded once from the static terrain (lakes do not
   * move), so this is an O(1) lookup after the first call — transient, like
   * `perception`, and never serialized (it rebuilds from the regenerated terrain
   * on load).
   *
   * This is the long-range analogue of *perceiving* water: the coarse "smell of
   * water on the wind" a real animal has and this world does not otherwise model,
   * and the cue the migration system steers a thirsty wander by. The field floods
   * only through passable cells from shallow-water sources, so it always points a
   * walkable way to the shallow ring — never at the impassable deep core.
   * @param {number} x @param {number} y
   * @returns {{heading: number, distance: number} | null}
   */
  nearestWater(x, y) {
    if (this._waterField === undefined) this._waterField = buildWaterField(this.terrain);
    const field = this._waterField;
    if (field === null) return null;
    const { cellX, cellY } = this.cellOf(x, y);
    const i = cellY * this.terrain.width + cellX;
    const sx = field.srcX[i];
    if (sx < 0) return null;
    const dx = sx + 0.5 - x;
    const dy = field.srcY[i] + 0.5 - y;
    return { heading: Math.atan2(dy, dx), distance: Math.hypot(dx, dy) };
  }

  /** @param {number} x */
  clampX(x) {
    return Math.min(Math.max(x, 0), this.width);
  }

  /** @param {number} y */
  clampY(y) {
    return Math.min(Math.max(y, 0), this.height);
  }

  /**
   * Move an entity, keeping the spatial index in sync. The only sanctioned
   * way to change an entity's position after creation.
   * @param {import('./EntityManager.js').Entity} entity
   * @param {number} x
   * @param {number} y
   * @param {number} [heading]
   */
  moveEntity(entity, x, y, heading = entity.heading) {
    const newX = this.clampX(x);
    const newY = this.clampY(y);
    this.grid.move(entity.id, entity.x, entity.y, newX, newY);
    entity.x = newX;
    entity.y = newY;
    entity.heading = heading;
  }

  /** @param {import('./EntityManager.js').Entity} entity */
  insertIntoGrid(entity) {
    this.grid.insert(entity.id, entity.x, entity.y);
  }

  /** @param {import('./EntityManager.js').Entity} entity */
  removeFromGrid(entity) {
    this.grid.remove(entity.id);
  }

  /** Serializable view of the tombstone registry (Step 18). */
  serializeTombstones() {
    return [...this.tombstones.values()].map((tombstone) => ({ ...tombstone }));
  }

  /** @param {Array<object>} saved */
  restoreTombstones(saved = []) {
    this.tombstones = new Map(saved.map((tombstone) => [tombstone.id, { ...tombstone }]));
  }

  /** Rebuild the spatial index from entity positions (after a load). */
  rebuildSpatialIndex() {
    this.grid.clear();
    for (const entity of this.entities.all()) {
      this.grid.insert(entity.id, entity.x, entity.y);
    }
  }
}

/**
 * Nearest drinkable-water source per cell, by a breadth-first flood through
 * passable cells outward from every shallow-water cell. Each reached cell records
 * the coordinates of the nearest shallow-water cell (in graph distance), from
 * which `nearestWater` derives a bearing on read. Returns null when the terrain
 * has no shallow water at all.
 *
 * Sources are shallow `WATER` cells only, and the flood steps through passable
 * cells only — so deep water and rock are neither drinking spots nor stepped
 * across, and every passable cell ends up pointing a walkable way to a drink
 * (the connectivity guarantee means every passable cell reaches one). Pure
 * function of the static terrain: no randomness, computed once, cached.
 * @param {import('./TerrainGrid.js').TerrainGrid} terrain
 * @returns {{srcX: Int16Array, srcY: Int16Array} | null}
 */
function buildWaterField(terrain) {
  const W = terrain.width;
  const H = terrain.height;
  const n = W * H;
  const srcX = new Int16Array(n).fill(-1);
  const srcY = new Int16Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (terrain.codeAt(x, y) === TerrainType.WATER) {
        const i = y * W + x;
        srcX[i] = x;
        srcY[i] = y;
        queue[tail++] = i;
      }
    }
  }
  if (tail === 0) return null;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    const sx = srcX[i];
    const sy = srcY[i];
    if (x > 0 && srcX[i - 1] < 0 && terrain.isPassable(x - 1, y)) { srcX[i - 1] = sx; srcY[i - 1] = sy; queue[tail++] = i - 1; }
    if (x < W - 1 && srcX[i + 1] < 0 && terrain.isPassable(x + 1, y)) { srcX[i + 1] = sx; srcY[i + 1] = sy; queue[tail++] = i + 1; }
    if (y > 0 && srcX[i - W] < 0 && terrain.isPassable(x, y - 1)) { srcX[i - W] = sx; srcY[i - W] = sy; queue[tail++] = i - W; }
    if (y < H - 1 && srcX[i + W] < 0 && terrain.isPassable(x, y + 1)) { srcX[i + W] = sx; srcY[i + W] = sy; queue[tail++] = i + W; }
  }
  return { srcX, srcY };
}
