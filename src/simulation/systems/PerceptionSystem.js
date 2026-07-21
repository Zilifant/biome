/**
 * Local perception (Step 7).
 *
 * Each tick, every living animal builds a bounded summary of what it can sense
 * within its species' perception radius: nearby animals (via the spatial
 * index), its parent if it still depends on one (Step 13), the nearest animal
 * it hunts and the nearest one that hunts it (Step 16), a bounded set of
 * possible mates (Step 22), and the nearest food cell, water cell, and obstacle
 * (via a local scan of the cell neighborhood). Perception is strictly local — an animal never reads global
 * world state (invariant 17): neighbors come from `SpatialGrid.queryRadius`,
 * and cell features from a radius-bounded scan.
 *
 * The summaries live in `world.perception` (a transient Map keyed by entity
 * id, rebuilt every tick, never serialized). Nothing acts on perception yet —
 * the decision system (Step 8) consumes it; for now it is inspection-only.
 *
 * Ownership: writes `world.perception`; reads the spatial grid, terrain, and
 * vegetation. No randomness.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { TerrainType, isPassableCode } from '../world/TerrainGrid.js';

export class PerceptionSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultRadius] radius for species without one
   * @param {number} [options.foodMinLevel] vegetation level that counts as food
   * @param {number} [options.updateInterval]
   */
  constructor({ defaultRadius = 5, foodMinLevel = 1, maxMateCandidates = 6, updateInterval = 1 } = {}) {
    super({ id: 'perception', phase: 'perception', priority: 0, updateInterval });
    this.defaultRadius = defaultRadius;
    this.foodMinLevel = foodMinLevel;
    this.maxMateCandidates = maxMateCandidates;
  }

  update(world, context) {
    const perception = world.perception;
    perception.clear();
    world.neighbourhood.clear();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const radius = world.species.get(entity.speciesId)?.perception?.radius ?? this.defaultRadius;
      perception.set(entity.id, this.#perceive(world, entity, radius));
    }
    // Stamped last, so a consumer that reads a half-built map on some future
    // reordering sees a stale tick rather than a partial neighbourhood.
    world.neighbourhoodTick = context?.tick ?? null;
  }

  /**
   * @param {import('../world/World.js').World} world
   * @param {object} entity
   * @param {number} radius
   */
  #perceive(world, entity, radius) {
    const radiusSquared = radius * radius;

    // --- Animals: sub-quadratic via the spatial grid (already radius-filtered).
    let animalCount = 0;
    let nearestAnimal = null;
    let guardian = null;
    let nearestPrey = null;
    let nearestThreat = null;
    let nearestCarcass = null;
    /** @type {Array<{id: number, distance: number, x: number, y: number, sex: string}>} */
    const mateCandidates = [];
    // The living animals seen on this walk, flat as [id, distance, …], handed to
    // the social system so it need not repeat the walk (§1.4 C6). Recorded in
    // grid order, which is ascending id.
    /** @type {number[]} */
    const neighbours = [];
    for (const otherId of world.grid.queryRadius(entity.x, entity.y, radius)) {
      if (otherId === entity.id) continue;
      const other = world.entities.get(otherId);
      if (!other) continue;
      // Carcasses are what a carnivore actually eats (Step 16), so they are
      // sensed alongside the living.
      if (other.kind === 'carcass') {
        if (other.edibleMass > 0) {
          const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
          if (nearestCarcass === null || distance < nearestCarcass.distance) {
            const cell = world.cellOf(other.x, other.y);
            nearestCarcass = {
              id: otherId,
              distance,
              x: other.x,
              y: other.y,
              cellX: cell.cellX,
              cellY: cell.cellY,
              edibleMass: other.edibleMass,
            };
          }
        }
        continue;
      }
      if (other.kind !== 'animal' || !other.alive) continue;
      const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
      neighbours.push(otherId, distance);
      animalCount += 1;
      if (nearestAnimal === null || distance < nearestAnimal.distance) {
        // speciesId lets behaviour distinguish conspecifics (e.g. mate seeking).
        nearestAnimal = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y };
      }
      // A dependent juvenile can only follow a parent it can actually sense
      // (Step 13) — the bond gives no magic knowledge of where the parent is.
      if (otherId === entity.guardianId) {
        guardian = { id: otherId, distance, x: other.x, y: other.y };
      }
      // Predation (Step 16), read from the species relation in both
      // directions in this one pass: what I hunt, and what hunts me.
      if (world.species.hunts(entity.speciesId, other.speciesId) && (nearestPrey === null || distance < nearestPrey.distance)) {
        // `fleeing` is visible to the hunter: prey that has bolted is running,
        // and a predator that keeps walking will never close the gap again.
        nearestPrey = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y, fleeing: other.action === 'flee' };
      }
      if (world.species.hunts(other.speciesId, entity.speciesId) && (nearestThreat === null || distance < nearestThreat.distance)) {
        nearestThreat = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y };
      }
      // Mate choice (Step 22): sensing a possible mate is sensing, so the
      // candidate set is gathered here in the pass that is already running.
      // Whether any of them is *good enough* is not perception's business —
      // that is scored from traits and condition by mating/mateChoice.js, which
      // the decision and reproduction systems both call. Adults of the opposite
      // sex only; the list is trimmed to the nearest few below, so a crowded
      // cell cannot make this grow.
      if (
        other.speciesId === entity.speciesId &&
        other.lifeStage === 'adult' &&
        other.sex !== null &&
        entity.sex !== null &&
        other.sex !== entity.sex
      ) {
        mateCandidates.push({ id: otherId, distance, x: other.x, y: other.y, sex: other.sex });
      }
    }
    // Nearest first, ties by ascending id (grid queries already return ids in
    // ascending order, and sort is stable) — so the trim is deterministic.
    if (mateCandidates.length > this.maxMateCandidates) {
      mateCandidates.sort((a, b) => a.distance - b.distance);
      mateCandidates.length = this.maxMateCandidates;
    }
    world.neighbourhood.set(entity.id, neighbours);

    // --- Cell features: a local scan of the radius neighborhood (bounded, not
    // global). Nearest food (vegetation ≥ threshold), water, and obstacle.
    //
    // This is the hottest loop in the engine (§1.4 C6): it runs (2r+1)² times
    // per animal per tick, so everything below is about making one cell cheap
    // rather than about visiting fewer of them. Four things earn their keep,
    // and none of them changes which cell wins:
    //
    //   * The row's x-span is computed from the circle instead of testing every
    //     cell in the bounding box — the corners are ~21% of a square and were
    //     visited only to be rejected. The exact `distSquared > radiusSquared`
    //     guard is *kept*, so a cell on the boundary is still decided by the
    //     same comparison as before rather than by the span arithmetic.
    //   * Terrain is read once per cell and passability derived from the code
    //     (see `isPassableCode`), rather than reading the cell a second time.
    //   * The "is this nearer than the best so far" test comes first, because it
    //     is a register compare, and the grid reads it guards are not. Both
    //     operands are pure, so the reordering is invisible.
    //   * The best-so-far is held in plain numbers and the four result objects
    //     are built once at the end, so a scan that improves its answer twenty
    //     times allocates nothing rather than twenty short-lived records. An
    //     unset best is `Infinity`, which fails `<` exactly as the old `null`
    //     check did.
    const { cellX, cellY } = world.cellOf(entity.x, entity.y);
    const r = Math.ceil(radius);
    const terrain = world.terrain;
    const vegetation = world.vegetation;
    const foodMinLevel = this.foodMinLevel;
    const entityX = entity.x;
    const entityY = entity.y;
    let foodDist = Infinity;
    let foodX = 0;
    let foodY = 0;
    let foodLevel = 0;
    let waterDist = Infinity;
    let waterX = 0;
    let waterY = 0;
    let obstacleDist = Infinity;
    let obstacleX = 0;
    let obstacleY = 0;
    let coverDist = Infinity;
    let coverX = 0;
    let coverY = 0;
    for (let dy = -r; dy <= r; dy += 1) {
      const cy = cellY + dy;
      const ddy = cy + 0.5 - entityY;
      const remaining = radiusSquared - ddy * ddy;
      if (remaining < 0) continue; // whole row lies outside the circle
      // |ddx| ≤ √remaining ⇒ cx ∈ [entityX − √remaining − 0.5, entityX + √remaining − 0.5].
      // Widened by one cell each way so float rounding can never narrow the
      // span past a cell the exact guard would have accepted.
      const span = Math.sqrt(remaining);
      const minCx = Math.max(cellX - r, Math.floor(entityX - span - 1.5));
      const maxCx = Math.min(cellX + r, Math.ceil(entityX + span - 0.5) + 1);
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const ddx = cx + 0.5 - entityX;
        const distSquared = ddx * ddx + ddy * ddy;
        if (distSquared > radiusSquared) continue;

        if (distSquared < foodDist) {
          const level = vegetation.levelAt(cx, cy);
          if (level >= foodMinLevel) {
            foodDist = distSquared;
            foodX = cx;
            foodY = cy;
            foodLevel = level;
          }
        }
        const wantWater = distSquared < waterDist;
        const wantObstacle = distSquared < obstacleDist;
        // Shelter from the weather (Step 19) — the same scan, one more test.
        const wantCover = distSquared < coverDist;
        if (!wantWater && !wantObstacle && !wantCover) continue;
        const code = terrain.codeAt(cx, cy);
        if (wantWater && code === TerrainType.WATER) {
          waterDist = distSquared;
          waterX = cx;
          waterY = cy;
        }
        if (wantObstacle && !isPassableCode(code)) {
          obstacleDist = distSquared;
          obstacleX = cx;
          obstacleY = cy;
        }
        if (wantCover && code === TerrainType.COVER) {
          coverDist = distSquared;
          coverX = cx;
          coverY = cy;
        }
      }
    }

    return {
      radius,
      animalCount,
      nearestAnimal,
      guardian,
      nearestPrey,
      nearestThreat,
      nearestCarcass,
      mateCandidates,
      nearestFood:
        foodDist === Infinity
          ? null
          : { cellX: foodX, cellY: foodY, level: foodLevel, distance: Math.sqrt(foodDist) },
      nearestWater: cellRecord(waterX, waterY, waterDist),
      nearestObstacle: cellRecord(obstacleX, obstacleY, obstacleDist),
      nearestCover: cellRecord(coverX, coverY, coverDist),
    };
  }
}

/**
 * A public nearest-cell record, or null when the scan found nothing. Key order
 * matches what the old `{...rest, distance}` spread produced, since these
 * records are projected to entity inspection.
 */
function cellRecord(cellX, cellY, distSquared) {
  if (distSquared === Infinity) return null;
  return { cellX, cellY, distance: Math.sqrt(distSquared) };
}
