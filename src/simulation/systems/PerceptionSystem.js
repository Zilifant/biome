/**
 * Local perception (Step 7).
 *
 * Each tick, every living animal builds a bounded summary of what it can sense
 * within its species' perception radius: nearby animals (via the spatial
 * index), its parent if it still depends on one (Step 13), the nearest animal
 * it hunts and the nearest one that hunts it (Step 16), and the nearest food
 * cell, water cell, and obstacle (via a local scan of the cell
 * neighborhood). Perception is strictly local — an animal never reads global
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
import { SPECIES, hunts } from '../config/species/index.js';
import { TerrainType } from '../world/TerrainGrid.js';

export class PerceptionSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultRadius] radius for species without one
   * @param {number} [options.foodMinLevel] vegetation level that counts as food
   * @param {number} [options.updateInterval]
   */
  constructor({ defaultRadius = 5, foodMinLevel = 1, updateInterval = 1 } = {}) {
    super({ id: 'perception', phase: 'perception', priority: 0, updateInterval });
    this.defaultRadius = defaultRadius;
    this.foodMinLevel = foodMinLevel;
  }

  update(world) {
    const perception = world.perception;
    perception.clear();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const radius = SPECIES[entity.speciesId]?.perceptionRadius ?? this.defaultRadius;
      perception.set(entity.id, this.#perceive(world, entity, radius));
    }
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
      if (hunts(entity.speciesId, other.speciesId) && (nearestPrey === null || distance < nearestPrey.distance)) {
        // `fleeing` is visible to the hunter: prey that has bolted is running,
        // and a predator that keeps walking will never close the gap again.
        nearestPrey = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y, fleeing: other.action === 'flee' };
      }
      if (hunts(other.speciesId, entity.speciesId) && (nearestThreat === null || distance < nearestThreat.distance)) {
        nearestThreat = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y };
      }
    }

    // --- Cell features: a local scan of the radius neighborhood (bounded, not
    // global). Nearest food (vegetation ≥ threshold), water, and obstacle.
    const { cellX, cellY } = world.cellOf(entity.x, entity.y);
    const r = Math.ceil(radius);
    let nearestFood = null;
    let nearestWater = null;
    let nearestObstacle = null;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const cx = cellX + dx;
        const cy = cellY + dy;
        const ddx = cx + 0.5 - entity.x;
        const ddy = cy + 0.5 - entity.y;
        const distSquared = ddx * ddx + ddy * ddy;
        if (distSquared > radiusSquared) continue;

        const level = world.vegetation.levelAt(cx, cy);
        if (level >= this.foodMinLevel && (nearestFood === null || distSquared < nearestFood.distSquared)) {
          nearestFood = { cellX: cx, cellY: cy, distSquared, level };
        }
        const code = world.terrain.codeAt(cx, cy);
        if (code === TerrainType.WATER && (nearestWater === null || distSquared < nearestWater.distSquared)) {
          nearestWater = { cellX: cx, cellY: cy, distSquared };
        }
        if (!world.terrain.isPassable(cx, cy) && (nearestObstacle === null || distSquared < nearestObstacle.distSquared)) {
          nearestObstacle = { cellX: cx, cellY: cy, distSquared };
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
      nearestFood: finalizeCell(nearestFood),
      nearestWater: finalizeCell(nearestWater),
      nearestObstacle: finalizeCell(nearestObstacle),
    };
  }
}

/** Convert an internal {distSquared} cell record to a public {distance} one. */
function finalizeCell(record) {
  if (record === null) return null;
  const { distSquared, ...rest } = record;
  return { ...rest, distance: Math.sqrt(distSquared) };
}
