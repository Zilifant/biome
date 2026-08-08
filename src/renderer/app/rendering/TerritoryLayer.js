/**
 * The **territory layer**: a solid, rounded outline around the ground each pride
 * and clan holds — and around a solitary holder's own claim — drawn from the
 * engine's claim layer rather than from where the animals happen to be standing.
 *
 * It is the social layer's counterpart and deliberately its twin to look at: the
 * same tracing, the same painter, the same rounded lane just inside a cell edge,
 * the same colour per group kind. What differs is what the outline is *around*.
 * A social bubble wraps a set of animals; a territory wraps a set of **claims**,
 * so a pride's territory stays where its ground is when the pride walks off it.
 * Seeing both at once — a purple bubble a long way outside its purple ground —
 * is the whole reason they share a design language.
 *
 * ## What it reads
 *
 * `store.territory` (protocol v37): who holds each **coarse** claim cell, from
 * the engine's `ScentGrid`. Ownership only; the freshness half of a claim is
 * what the mechanism runs on and is not projected.
 *
 * ⚠ **A claim names an animal, and the group is derived — never stored.** That
 * is not a renderer shortcut, it is the engine's own rule: `holdsClaim` in
 * `systems/TerritorySystem.js` decides "is this my side's ground" by looking the
 * owner up and reading its **live** `groupRecordId`, precisely so there is no
 * second copy of membership to go stale. This module does the same thing with
 * the same two facts, both of them bulk-snapshot fields, so what is drawn and
 * what the engine acts on cannot disagree.
 *
 * ⚠ **The owner must be alive**, again matching `holdsClaim`. A dead lion's
 * marks linger in the grid until they decay, and drawing them would show a pride
 * holding ground that the next animal through is free to take. Ground whose
 * holder this client cannot see (dead, decayed, or never received) is simply not
 * drawn — never guessed at, and never attributed to whoever is standing on it.
 *
 * ## The shape of a territory
 *
 * 1. **The claim cells one side holds**, grouped by `groupRecordId` where the
 *    holder has one and by the holder itself where it does not.
 * 2. **Holes filled**, per connected blob — the same rule the social layer
 *    keeps, and for the same reason: a pocket of ground a claim has faded off
 *    inside a territory is coarse-grid noise, and drawing it as a second loop
 *    reads as a bug rather than as a fact.
 * 3. **No corridors.** This is the one place the two layers deliberately part
 *    company. An arm between two blobs of a herd wraps an animal that has
 *    wandered off; an arm between two blobs of a *territory* would draw a claim
 *    over ground nobody has marked, which is precisely the thing this layer is
 *    for showing the absence of. Two patches of held ground are two outlines.
 *
 * ⚠ **Everything is traced at claim-cell resolution and scaled afterwards**,
 * which is where the budget goes. A claim cell is `cellSize` world cells across
 * (4 today), so tracing in claim space touches **16× fewer cells** than the same
 * area in world space — and the result is exact rather than approximate, because
 * a claim boundary only ever falls on a claim-cell edge anyway. In a world whose
 * width is not a multiple of `cellSize` the last column of claim cells reaches a
 * cell or two past the map, and so can an outline; that is the projection's own
 * ragged edge showing through, not a rounding error here.
 */
import { SOCIAL_GROUP_APPEARANCE, SPECIES_APPEARANCE, recordGroupKind, speciesLabel } from './EntityAppearance.js';
import { keyCellX, keyCellY, outlineRegion, traceOutline } from './SocialLayer.js';

/**
 * The lane a territory outline runs in. Ring 0 is the outermost — the same lane
 * the herd label uses — because a territory is the outermost containment there
 * is: it is the ground a group is somewhere inside. The two can never land on
 * one boundary in practice (a claim edge is a multiple of `cellSize` cells and a
 * herd's is not), and where they came close the colour still separates them.
 */
export const TERRITORY_RING = 0;

/**
 * Colour and label for one holder's ground.
 *
 * A record's territory takes its **group's** colour, so a pride's ground and the
 * pride's own bubble are the same purple — that identity is the point, and it is
 * why this reads `SOCIAL_GROUP_APPEARANCE` rather than inventing a palette. A
 * lone holder takes its **species'** colour instead: there is no group to name,
 * and the leopard's red ground beside a lion pride's purple says which animal
 * marked it without a legend.
 *
 * @param {object} owner a public entity from a snapshot or delta
 * @returns {{kind: string, colorToken: string, label: string}}
 */
export function territoryAppearanceOf(owner) {
  if (owner.groupRecordId != null) {
    const kind = recordGroupKind(owner.speciesId);
    const appearance = SOCIAL_GROUP_APPEARANCE[kind] ?? SOCIAL_GROUP_APPEARANCE.group;
    return { kind, colorToken: appearance.colorToken, label: `${appearance.label} territory` };
  }
  const species = SPECIES_APPEARANCE[owner.speciesId];
  return {
    kind: 'holder',
    // A species this build has never heard of still gets ground it can be seen
    // holding, in the fallback the rest of the renderer uses for one.
    colorToken: species?.colorToken ?? SOCIAL_GROUP_APPEARANCE.group.colorToken,
    label: `${speciesLabel(owner.speciesId)} territory`,
  };
}

/**
 * Every territory on the map, ready to draw: its kind, its colour, and the loops
 * of its outline **in world-cell units** (so the painter needs to know nothing
 * about claim cells).
 *
 * ⚠ **`visible` is a real budget and it is applied per group**, exactly as the
 * social layer applies it: a territory whose whole claim box is off screen is
 * never traced. It is a weaker cull than the social layer's for a reason worth
 * knowing — a pride's ground can span a third of the map, so a group that is
 * *partly* visible pays for all of it. What makes that affordable is the claim
 * grid's coarseness, not this test.
 *
 * @param {{width: number, height: number, cellSize: number, owners: Int32Array} | null} territory
 *        the decoded claim layer from the store
 * @param {Map<number, object> | null} entities the store's entity map, for
 *        resolving an owner id to its species and record
 * @param {{visible?: {minCellX: number, minCellY: number, maxCellX: number, maxCellY: number} | null}} [options]
 *        ⚠ no `world`, unlike `describeSocialGroups`: the claim grid carries its
 *        own bounds, and clamping a claim cell to the world would cut a
 *        territory short of the projection that produced it
 * @returns {Array<{key: string, kind: string, colorToken: string, ring: number,
 *          label: string, holders: number, claimCells: number,
 *          loops: Array<Array<{x: number, y: number}>>,
 *          bounds: {minCellX: number, minCellY: number, maxCellX: number, maxCellY: number}}>}
 */
export function describeTerritories(territory, entities, options = {}) {
  if (!territory || !entities) return [];
  const visible = options.visible ?? null;
  const claimSize = Math.max(1, territory.cellSize);
  const claimBounds = { width: territory.width, height: territory.height };
  /** @type {Map<string, {kind: string, colorToken: string, label: string,
   *          holders: Set<number>, cells: Array<{cellX: number, cellY: number}>,
   *          minCellX: number, minCellY: number, maxCellX: number, maxCellY: number}>} */
  const sides = new Map();
  for (let index = 0; index < territory.owners.length; index += 1) {
    const ownerId = territory.owners[index];
    if (ownerId === 0) continue;
    const owner = entities.get(ownerId);
    // Unresolvable or dead: the claim is fading ground nobody holds (see the
    // header). Not drawn, not guessed at.
    if (!owner || owner.kind !== 'animal' || owner.alive === false) continue;
    const key = owner.groupRecordId != null ? `record:${owner.groupRecordId}` : `holder:${ownerId}`;
    let side = sides.get(key);
    if (!side) {
      side = {
        ...territoryAppearanceOf(owner),
        holders: new Set(),
        cells: [],
        minCellX: Infinity,
        minCellY: Infinity,
        maxCellX: -Infinity,
        maxCellY: -Infinity,
      };
      sides.set(key, side);
    }
    const cellX = index % territory.width;
    const cellY = Math.floor(index / territory.width);
    side.holders.add(ownerId);
    side.cells.push({ cellX, cellY });
    if (cellX < side.minCellX) side.minCellX = cellX;
    if (cellY < side.minCellY) side.minCellY = cellY;
    if (cellX > side.maxCellX) side.maxCellX = cellX;
    if (cellY > side.maxCellY) side.maxCellY = cellY;
  }

  const described = [];
  for (const [key, side] of sides) {
    // The claim box in world cells, which is what `visible` is measured in.
    if (
      visible &&
      ((side.maxCellX + 1) * claimSize - 1 < visible.minCellX ||
        side.minCellX * claimSize > visible.maxCellX ||
        (side.maxCellY + 1) * claimSize - 1 < visible.minCellY ||
        side.minCellY * claimSize > visible.maxCellY)
    ) {
      continue;
    }
    // ⚠ `padding: 0` and `maxCorridor: 0`: a claim cell *is* area, so there is
    // nothing to inflate into a bubble, and held ground in two places is two
    // territories rather than one with an arm between them.
    const region = outlineRegion(side.cells, claimBounds, { padding: 0, maxCorridor: 0 });
    const loops = traceOutline(region);
    if (loops.length === 0) continue;
    let minCellX = Infinity;
    let minCellY = Infinity;
    let maxCellX = -Infinity;
    let maxCellY = -Infinity;
    for (const packed of region) {
      const cellX = keyCellX(packed);
      const cellY = keyCellY(packed);
      if (cellX < minCellX) minCellX = cellX;
      if (cellY < minCellY) minCellY = cellY;
      if (cellX > maxCellX) maxCellX = cellX;
      if (cellY > maxCellY) maxCellY = cellY;
    }
    described.push({
      key,
      kind: side.kind,
      colorToken: side.colorToken,
      ring: TERRITORY_RING,
      label: side.label,
      holders: side.holders.size,
      claimCells: region.size,
      // Claim-cell corners are world-cell corners `claimSize` apart, so the
      // whole scaling is one multiply per point — done here rather than in the
      // painter, which then draws territories and social bubbles identically
      // because both arrive in world cells.
      loops: loops.map((loop) => loop.map((point) => ({ x: point.x * claimSize, y: point.y * claimSize }))),
      bounds: {
        minCellX: minCellX * claimSize,
        minCellY: minCellY * claimSize,
        maxCellX: (maxCellX + 1) * claimSize - 1,
        maxCellY: (maxCellY + 1) * claimSize - 1,
      },
    });
  }
  // A stable order, so what is drawn over what is a function of the world and
  // not of the order claims were walked in. Ties cannot happen — the key is
  // unique per side — but the sort is written the same way the social layer's is
  // so the two cannot drift.
  described.sort((a, b) => a.ring - b.ring || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return described;
}
