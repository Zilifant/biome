import { EntityManager } from './EntityManager.js';
import { SpatialGrid } from './SpatialGrid.js';
import { TerrainGrid, TerrainType } from './TerrainGrid.js';
import { VegetationGrid } from './VegetationGrid.js';
import { initialEnvironment } from './Environment.js';
import { ScentGrid } from './ScentGrid.js';
import { speedScaleAt } from '../disturbance/disturbances.js';
import { FeatureGrid } from './FeatureGrid.js';
import { SpeciesRegistry } from '../config/species/schema.js';
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
   * Whether the cell at a continuous position gives shelter from the weather
   * (Step 19). Cover is the only sheltering terrain today; keeping the test
   * here rather than in a system means "what counts as shelter" has one home.
   * @param {number} x @param {number} y
   * @returns {boolean}
   */
  isShelteredAt(x, y) {
    const { cellX, cellY } = this.cellOf(x, y);
    if (this.terrain.codeAt(cellX, cellY) === TerrainType.COVER) return true;
    // A burrow is shelter an animal made (Step 28). Landing it here rather than
    // in the metabolism system means thermoregulation and the `shelter` action
    // both pick it up for free, and neither of them knows the difference between
    // a thicket and a hole in the ground.
    return sheltersAt(this.features, cellX, cellY);
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
