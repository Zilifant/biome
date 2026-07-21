/**
 * Describe one world cell from the renderer's store.
 *
 * Pure: no DOM, no formatting, no store mutation. It reads the layers the
 * protocol already sends — terrain, vegetation, worn ground, active
 * disturbances — and returns a plain description object for a view to render.
 * That split is what lets the interesting cases (out of bounds, a trail, a cell
 * inside a fire) be tested without a browser.
 *
 * It reports only what the protocol sends. Notably absent is which animal
 * *claims* this ground: the claim layer is not projected (PLAN.md §1.4 A36),
 * and a selected animal's `territory.standingOn` answers that for one animal
 * rather than for a cell. Saying nothing is the honest option.
 */
import { occupantsInCell } from '../rendering/GridProjection.js';

/**
 * @typedef {object} CellDescription
 * @property {number} cellX
 * @property {number} cellY
 * @property {boolean} inWorld false for cells beyond the world edge
 * @property {{name: string, passable: boolean | null} | null} terrain
 * @property {{level: number, maxLevel: number}} vegetation quantized biomass
 * @property {{kind: string, wear: number} | null} feature worn ground, if any
 * @property {Array<{id: number, kind: string, radius: number, until: number,
 *                   ticksRemaining: number | null}>} disturbances covering this cell
 * @property {number[]} occupantIds entities standing in this cell, unordered
 */

/**
 * Whether a disturbance circle covers a cell. Deliberately the same test the
 * grid renderer draws with — measured from the cell *centre* — so what the
 * inspector claims covers a cell and what is drawn over it can never disagree.
 * @param {{x: number, y: number, radius: number}} disturbance
 * @param {number} cellX @param {number} cellY
 */
function covers(disturbance, cellX, cellY) {
  const dx = cellX + 0.5 - disturbance.x;
  const dy = cellY + 0.5 - disturbance.y;
  return dx * dx + dy * dy <= disturbance.radius * disturbance.radius;
}

/**
 * Describe a world cell.
 * @param {import('../state/RendererStore.js').RendererStore} store
 * @param {number} cellX
 * @param {number} cellY
 * @returns {CellDescription}
 */
export function describeCell(store, cellX, cellY) {
  const world = store.world;
  const inWorld =
    world !== null && cellX >= 0 && cellY >= 0 && cellX < world.width && cellY < world.height;

  const terrainName = store.terrainNameAt(cellX, cellY);
  const terrain = terrainName ? { name: terrainName, passable: store.terrainPassableAt(cellX, cellY) } : null;

  const feature = (store.features ?? []).find((f) => f.cellX === cellX && f.cellY === cellY) ?? null;

  const disturbances = (store.disturbances ?? [])
    .filter((disturbance) => covers(disturbance, cellX, cellY))
    .map((disturbance) => ({
      id: disturbance.id,
      kind: disturbance.kind,
      radius: disturbance.radius,
      until: disturbance.until,
      // The tick is authoritative; how long is left is arithmetic on two
      // numbers the protocol sent, which is presentation rather than ecology.
      ticksRemaining: typeof disturbance.until === 'number' && store.tick >= 0 ? Math.max(0, disturbance.until - store.tick) : null,
    }));

  return {
    cellX,
    cellY,
    inWorld,
    terrain,
    vegetation: { level: store.vegetationLevelAt(cellX, cellY), maxLevel: store.vegetation?.maxLevel ?? 0 },
    feature: feature ? { kind: feature.kind, wear: feature.wear } : null,
    disturbances,
    // Same cell test the grid draws with, rather than a second copy of the
    // clamping rule — an entity on the far border displays in the last cell.
    occupantIds: occupantsInCell(store.entities.values(), cellX, cellY, world).map((entity) => entity.id),
  };
}
