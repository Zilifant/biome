/**
 * Getting animals out of terrain that closed over them (SEASON-PLAN D9, 2026-08-10).
 *
 * ⚠⚠ **The dry season opens a hole and the wet season fills it back in with the
 * animals still inside.** `TerrainGrid#buildDryMap` turns the lake's `LAKE_CORE`
 * — `DEEP_WATER`, impassable — into shallow `WATER` for the dry season, which is
 * the feature: the one water an animal could never reach becomes the only one
 * left. Animals accordingly walk into it to drink, because in a drained world it
 * is often the only lake water there is. Then the season turns, the core is deep
 * again, and every animal standing in it is on an impassable cell it cannot step
 * off. `stepRefused` gates on the *destination*, so there is no way out and no
 * mechanism that would ever produce one: the animal stands still until the next
 * dry season, roughly two thousand ticks later, or it starves where it stands.
 *
 * Measured on the shipped demo, 2 seeds × 8000 ticks, before this module existed:
 * **30 and 39 animals** caught at the first `dry→wet` turn, **24 and 20** of them
 * dead before the map let them go (21 and 18 of those by starvation), held for a
 * mean of ~1490 ticks. Four fifths of every immobile run over 200 ticks in those
 * runs was an animal standing in wet-season deep water.
 *
 * ⚠ **The test that should have caught it asserts the other direction.**
 * `test/dry-season.test.js` proves that every wet-passable cell is dry-passable
 * and states the claim as "no animal can be stranded by a season change" — but
 * drying only ever *adds* connectivity, so that is the safe direction. The strand
 * happens on `dry→wet`, and nothing checked it.
 *
 * **What this does.** On a season turn, any grounded animal left on an impassable
 * cell is moved to the nearest cell that is both passable and not already at
 * `locomotion.maxOccupantsPerCell`. That last clause is the whole reason this is a
 * scan rather than a one-line clamp: a lake core empties onto its own rim, so
 * without an occupancy check thirty animals would be stacked into the handful of
 * shore cells nearest them — trading a trap for a jam, and one the movement system
 * would then have to unpick against the same cap.
 *
 * ⚠ **Fliers are skipped, and that is not an optimization.** `flyingFor` already
 * puts a flier in the air whenever the cell under it is impassable, so a vulture
 * over the core was never stuck — the trap probe recorded 704 vulture-ticks in the
 * core and zero vulture deaths there. Evicting one would be a teleport that fixes
 * nothing.
 *
 * ⚠ **This is a relocation, not a rule about where animals may walk.** The
 * mechanism that lets an animal into the core in the first place is untouched, and
 * deliberately: the dry-season core *should* be drinkable. The right structural
 * fix is that a dry map must never make an impassable cell passable — keep the
 * core deep and shrink the lake's shallow ring instead — and this module is the
 * cheap correct-outcome version of it, not a replacement.
 *
 * Ownership: writes entity positions (through `world.moveEntity`, the sanctioned
 * path) and nothing else. Rolls nothing — the scan order is fixed, so two seeded
 * runs evict identically.
 */
import { cellFull } from '../locomotion/steps.js';

/**
 * How far out to look for somewhere to stand, in cells. A lake core is a disc of
 * a few hundred cells, so an animal at its centre has to cross its radius —
 * ~12 cells on the shipped demo at 429 core cells. 48 is that with a wide margin
 * and is only ever paid by an animal that is genuinely walled in.
 */
export const DEFAULT_STRAND_SCAN = 48;

/**
 * Move every grounded animal standing on impassable terrain to the nearest
 * passable cell with room in it.
 *
 * @param {import('./World.js').World} world
 * @param {number|null} [maxOccupantsPerCell] the crowding cap; defaults to the
 *        world's own `locomotion.maxOccupantsPerCell`. `null` disables the
 *        occupancy check entirely, matching `DEFAULT_STEP_RULES`.
 * @param {number} [maxScan] how many cells out to search
 * @returns {number} how many animals were moved
 */
export function evictStranded(world, maxOccupantsPerCell = capOf(world), maxScan = DEFAULT_STRAND_SCAN) {
  // Collected first, then sorted by id, then moved. ⚠ The sort is not cosmetic:
  // each eviction changes the occupancy the *next* one sees, so the order decides
  // who gets the nearest free cell. Entity-map order is already insertion order
  // and would almost certainly do, but "almost certainly deterministic" is not a
  // thing this project accepts in a path that moves animals (invariant 11).
  const stranded = [];
  for (const entity of world.entities.all()) {
    if (entity.kind !== 'animal' || !entity.alive) continue;
    if (entity.flying === true) continue; // already in the air; see the header
    if (world.isPassableAt(entity.x, entity.y)) continue;
    stranded.push(entity);
  }
  if (stranded.length === 0) return 0;
  stranded.sort((a, b) => a.id - b.id);

  let moved = 0;
  for (const entity of stranded) {
    const spot = nearestFreeCell(world, entity, maxOccupantsPerCell, maxScan);
    if (spot === null) continue;
    world.moveEntity(entity, spot.x, spot.y);
    moved += 1;
  }
  return moved;
}

/** The world's own crowding cap, normalized the way `normalizeStepRules` does. */
function capOf(world) {
  const cap = world.config?.locomotion?.maxOccupantsPerCell;
  return typeof cap === 'number' && cap > 0 ? cap : null;
}

/**
 * The nearest cell centre this animal can legally stand on.
 *
 * Searched as square rings at Chebyshev distance 1, 2, 3… which for a disc-shaped
 * lake core means radially outward — the shore, which is where an animal that
 * walked in from the shore should come back out. ⚠ Chebyshev rather than exact
 * Euclidean nearest: rings overlap in Euclidean distance from radius 3 outward, so
 * a true nearest-first order would need a sort per ring to buy a fraction of a
 * cell on a move that is already a teleport.
 *
 * ⚠⚠ **A full cell is remembered as a fallback rather than skipped forever.**
 * Being one over the cap for a few ticks is self-healing — occupancy gates *entry*
 * to a cell, never departure from one, so an overfull cell drains on its own —
 * while leaving an animal walled in reproduces the exact bug this module exists to
 * fix. So the search prefers room and accepts a crowd, and only returns `null` if
 * there is no passable cell at all within `maxScan`.
 *
 * @param {import('./World.js').World} world
 * @param {object} entity
 * @param {number|null} maxOccupantsPerCell
 * @param {number} maxScan
 * @returns {{x: number, y: number} | null}
 */
function nearestFreeCell(world, entity, maxOccupantsPerCell, maxScan) {
  const { cellX, cellY } = world.cellOf(entity.x, entity.y);
  let crowded = null;
  for (let r = 1; r <= maxScan; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        // The ring only — the interior was covered by a smaller r.
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const gx = cellX + dx;
        const gy = cellY + dy;
        // Out of bounds reads as ROCK, so `isPassableAt` is the whole check.
        const x = gx + 0.5;
        const y = gy + 0.5;
        if (!world.isPassableAt(x, y)) continue;
        if (!cellFull(world, gx, gy, entity.id, maxOccupantsPerCell)) return { x, y };
        if (crowded === null) crowded = { x, y };
      }
    }
  }
  return crowded;
}
