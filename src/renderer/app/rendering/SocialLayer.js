/**
 * The **social layer**: a solid, rounded outline around every group of
 * associated animals on the map — each herd, band, clan and pride at once,
 * rather than the selected animal's groupmates alone.
 *
 * Everything above `paintSocialLayer` is pure geometry over plain objects: no
 * canvas, no store, no DOM. That is deliberate and it is the only way this is
 * testable at all (§10, "describe, then render") — the interesting part of this
 * module is the shape of a bubble, and a shape you can only see is a shape
 * nobody can assert.
 *
 * ## What is drawn, and from what
 *
 * Two protocol fields, both of them bulk-snapshot facts about *every* animal:
 *
 * - `groupId` — the **herd label** (v22). Who this animal is standing with,
 *   recomputed by the engine every tick from local propagation.
 * - `groupRecordId` — the **record** (v33). Which pride, clan or band it belongs
 *   to, which survives its members walking apart.
 *
 * ⚠ **They overlap on purpose, and the overlap is the interesting part.** A zebra
 * is in a band *and* in whatever herd is standing around it, so it ends up inside
 * two outlines in two colours — which is exactly the distinction DOCS §9 draws
 * between a label and a record, drawn instead of explained. The two run in
 * different **rings** (`SOCIAL_GROUP_APPEARANCE`) so they nest rather than
 * coincide: the label outside, the records it contains inside it.
 *
 * ## The shape of a bubble
 *
 * A group is a set of cells, and the outline is the boundary of that set:
 *
 * 1. **The cells its members are standing in**, deduplicated.
 * 2. **Padded by one cell** (`BUBBLE_PADDING`), which is what turns a scatter of
 *    animals into a bubble: neighbours two cells apart merge into one blob, and
 *    the border sits a cell clear of the glyphs instead of cutting between them.
 * 3. **Holes filled**, per connected blob — a ring of animals standing around a
 *    gap is one group, and drawing the gap as a second loop reads as a hole in
 *    the herd rather than as the herd.
 * 4. **Blobs joined by one-cell-wide corridors**, along a minimum spanning tree
 *    over the closest pair of members in each pair of blobs. This is the "the
 *    bubble can extend out in a one-cell path" part: an animal that has wandered
 *    off is still wrapped, by an arm rather than by inflating the whole group's
 *    outline to cover the ground in between.
 *
 * ⚠ **A corridor longer than `MAX_CORRIDOR_CELLS` is not drawn**, and the far
 * member is outlined on its own in the same colour instead. This is a frame
 * budget rather than a nicety: a corridor costs a cell per step, and a dispersing
 * animal can be most of a map away — an unbounded arm would trace hundreds of
 * cells for a group nobody is looking at. An island in the group's colour is also
 * the more honest picture of an animal that is nowhere near its clan.
 */
import { worldCellOf } from './GridProjection.js';
import { SOCIAL_GROUP_APPEARANCE, recordGroupKind } from './EntityAppearance.js';

/**
 * How far a group's outline stands off from the cells its members occupy, in
 * cells. One is what makes the border a *bubble* — at zero it traces the animals
 * themselves and reads as a shape cut around glyphs.
 */
export const BUBBLE_PADDING = 1;

/**
 * The longest one-cell corridor drawn to reach an outlying member. Beyond it the
 * member keeps its outline and loses its arm (see the header note).
 */
export const MAX_CORRIDOR_CELLS = 48;

/**
 * The smallest membership that gets an outline. A bubble around one animal says
 * nothing its own glyph does not — and the engine's own rules agree twice over: a
 * herd label needs three animals to exist and a record dissolves below two.
 */
export const MIN_GROUP_MEMBERS = 2;

/**
 * A cell packed into one number, which is what the regions and boundary maps are
 * keyed by.
 *
 * ⚠ **Numbers rather than `"x,y"` strings, and the difference is measurable.**
 * This module allocates a key per cell, per neighbour test, per boundary edge —
 * at demo scale ~2800 region cells across ~60 groups, every tick — and on the
 * committed fixture the string-keyed version measured **6.5 ms** for a
 * whole-map pass against **3.5 ms** for this one. `KEY_SPAN` clears
 * `MAX_WORLD_DIMENSION` (5120) by two orders of magnitude and `KEY_ORIGIN`
 * leaves room for a bubble padded past the world's edge, so the product stays an
 * exact integer well inside a double.
 */
const KEY_SPAN = 1 << 21;
const KEY_ORIGIN = 1 << 10;
const cellKey = (cellX, cellY) => (cellX + KEY_ORIGIN) * KEY_SPAN + (cellY + KEY_ORIGIN);
const keyCellX = (key) => Math.floor(key / KEY_SPAN) - KEY_ORIGIN;
const keyCellY = (key) => (key % KEY_SPAN) - KEY_ORIGIN;
/** Ascending, so anything derived from a cell set is independent of arrival order. */
const byKey = (a, b) => a - b;

/**
 * Which groups each animal belongs to, as `{ key, kind }` pairs. Exported so the
 * two membership dimensions are named in one place rather than spelled out at
 * each call site.
 *
 * ⚠ **A herd label is keyed by species as well as by id.** Labels are conspecific
 * (DOCS §9) but the id is an animal's id, so two species could in principle carry
 * the same number; keying on the pair means a gazelle can never be enrolled into
 * a wildebeest's outline. A record id is globally unique and needs no such care.
 *
 * @param {object} entity a public entity from a snapshot or delta
 * @returns {Array<{key: string, kind: string}>}
 */
export function membershipsOf(entity) {
  const memberships = [];
  if (entity.groupId != null) {
    memberships.push({ key: `herd:${entity.speciesId}:${entity.groupId}`, kind: 'herd' });
  }
  if (entity.groupRecordId != null) {
    memberships.push({ key: `record:${entity.groupRecordId}`, kind: recordGroupKind(entity.speciesId) });
  }
  return memberships;
}

/**
 * Every cell within `padding` of a member cell, clamped to the world.
 * @param {Array<{cellX: number, cellY: number}>} cells
 * @param {{width: number, height: number} | null} world
 * @param {number} [padding]
 * @returns {Set<number>}
 */
function padCells(cells, world, padding = BUBBLE_PADDING) {
  const region = new Set();
  for (const cell of cells) {
    for (let dy = -padding; dy <= padding; dy += 1) {
      for (let dx = -padding; dx <= padding; dx += 1) {
        const x = cell.cellX + dx;
        const y = cell.cellY + dy;
        if (world && (x < 0 || y < 0 || x >= world.width || y >= world.height)) continue;
        region.add(cellKey(x, y));
      }
    }
  }
  return region;
}

/**
 * Split a cell set into orthogonally connected blobs, each with its bounds.
 * @param {Set<number>} region
 * @returns {Array<{cells: Set<number>, minX: number, minY: number, maxX: number, maxY: number}>}
 */
function connectedBlobs(region) {
  const seen = new Set();
  const blobs = [];
  // Sorted so the blob order — and therefore everything derived from it — does
  // not depend on the order entities arrived in.
  for (const key of [...region].sort(byKey)) {
    if (seen.has(key)) continue;
    const cells = new Set();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const queue = [key];
    seen.add(key);
    // ⚠ Bound once per blob rather than per cell. This is the innermost loop of
    // the whole layer, and a closure — or a table of offsets — allocated per cell
    // was measurably most of its cost. Packing puts `x + 1` a whole `KEY_SPAN`
    // away and `y + 1` next door, so a neighbour is arithmetic on the key.
    const visit = (neighbour) => {
      if (region.has(neighbour) && !seen.has(neighbour)) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    };
    while (queue.length > 0) {
      const current = queue.pop();
      cells.add(current);
      const cellX = keyCellX(current);
      const cellY = keyCellY(current);
      if (cellX < minX) minX = cellX;
      if (cellY < minY) minY = cellY;
      if (cellX > maxX) maxX = cellX;
      if (cellY > maxY) maxY = cellY;
      visit(current + KEY_SPAN);
      visit(current - KEY_SPAN);
      visit(current + 1);
      visit(current - 1);
    }
    blobs.push({ cells, minX, minY, maxX, maxY });
  }
  return blobs;
}

/**
 * Add the cells a blob encloses but does not contain, so a ring of animals draws
 * as one outline rather than as a donut.
 *
 * Flood-filled inward from a one-cell margin around the blob's own bounds:
 * anything the flood cannot reach is enclosed. Bounded by the blob, which is
 * bounded by its members — a padded group of at most a few dozen animals — so
 * this never walks the map.
 * @param {{cells: Set<number>, minX: number, minY: number, maxX: number, maxY: number}} blob
 * @param {Set<number>} region mutated: enclosed cells are added
 */
function fillHoles(blob, region) {
  // A blob that fills its own bounding box has nothing to enclose, and that is
  // the common case by a wide margin: one animal's padded square, or two
  // standing together. Checking it costs a multiplication and skips the flood
  // for most blobs on the map.
  if (blob.cells.size === (blob.maxX - blob.minX + 1) * (blob.maxY - blob.minY + 1)) return;
  const minX = blob.minX - 1;
  const minY = blob.minY - 1;
  const maxX = blob.maxX + 1;
  const maxY = blob.maxY + 1;
  const outside = new Set();
  const queue = [cellKey(minX, minY)];
  outside.add(cellKey(minX, minY));
  const visit = (x, y) => {
    if (x < minX || y < minY || x > maxX || y > maxY) return;
    const key = cellKey(x, y);
    if (outside.has(key) || blob.cells.has(key)) return;
    outside.add(key);
    queue.push(key);
  };
  while (queue.length > 0) {
    const current = queue.pop();
    const cellX = keyCellX(current);
    const cellY = keyCellY(current);
    visit(cellX + 1, cellY);
    visit(cellX - 1, cellY);
    visit(cellX, cellY + 1);
    visit(cellX, cellY - 1);
  }
  for (let y = blob.minY; y <= blob.maxY; y += 1) {
    for (let x = blob.minX; x <= blob.maxX; x += 1) {
      const key = cellKey(x, y);
      if (!blob.cells.has(key) && !outside.has(key)) {
        blob.cells.add(key);
        region.add(key);
      }
    }
  }
}

/**
 * The cells one corridor covers: an L-shaped, one-cell-wide path between two
 * cells, along x first and then y. Deterministic by construction — the same two
 * cells always produce the same arm, whichever order they are given in matters
 * only in which leg comes first, and both legs are drawn.
 * @param {{cellX: number, cellY: number}} from
 * @param {{cellX: number, cellY: number}} to
 * @returns {number[]} packed cell keys
 */
function corridorCells(from, to) {
  const cells = [];
  const stepX = Math.sign(to.cellX - from.cellX);
  const stepY = Math.sign(to.cellY - from.cellY);
  let x = from.cellX;
  let y = from.cellY;
  while (x !== to.cellX) {
    x += stepX;
    cells.push(cellKey(x, y));
  }
  while (y !== to.cellY) {
    y += stepY;
    cells.push(cellKey(x, y));
  }
  return cells;
}

/** Manhattan distance, which is also the length of the L-path between two cells. */
function manhattan(a, b) {
  return Math.abs(a.cellX - b.cellX) + Math.abs(a.cellY - b.cellY);
}

/**
 * The cell region one group's outline encloses: its members, padded, holes
 * filled, blobs joined by corridors. Pure, deterministic, and independent of the
 * camera — the region is in world cells, so it is computed once per tick rather
 * than once per frame.
 *
 * @param {Array<{cellX: number, cellY: number}>} memberCells cells with a member
 *        in them; duplicates are fine
 * @param {{width: number, height: number} | null} world
 * @param {{padding?: number, maxCorridor?: number}} [options]
 * @returns {Set<number>} packed cell keys (see `cellKey`)
 */
export function socialRegion(memberCells, world, { padding = BUBBLE_PADDING, maxCorridor = MAX_CORRIDOR_CELLS } = {}) {
  const region = padCells(memberCells, world, padding);
  if (region.size === 0) return region;
  const blobs = connectedBlobs(region);
  for (const blob of blobs) fillHoles(blob, region);
  if (blobs.length < 2) return region;

  // Which blob each member cell landed in, so a corridor is drawn between the
  // two *animals* that are closest rather than between two padding cells — the
  // arm then leaves and arrives at a member, which is what it is for.
  //
  // ⚠ **Sorted, and this is the line that makes the layer deterministic.** The
  // spanning tree below keeps the first pair at the shortest distance, so ties —
  // which are common, since a group is a handful of animals on a lattice — were
  // being broken by the order the entities happened to arrive in. Two clients
  // watching the same tick drew the same groups with different arms, and one
  // client drew a different arm after a reconnect. Nothing about the picture was
  // wrong; it just was not a function of the world alone (§3: presentation is
  // reproducible from its inputs).
  const unique = new Map();
  for (const cell of memberCells) unique.set(cellKey(cell.cellX, cell.cellY), cell);
  const sortedMembers = [...unique.keys()].sort(byKey);
  /** @type {Array<Array<{cellX: number, cellY: number}>>} */
  const membersByBlob = blobs.map(() => []);
  for (const key of sortedMembers) {
    const index = blobs.findIndex((blob) => blob.cells.has(key));
    if (index >= 0) membersByBlob[index].push(unique.get(key));
  }

  // Prim's algorithm over the blobs, joining the nearest unconnected one each
  // time. Blob counts are small (a group is at most a few dozen animals), so the
  // O(n²) form is the right one — and an explicit spanning tree is what keeps
  // the arms to one per outlying blob instead of one per pair.
  const connected = [0];
  const remaining = blobs.map((_, index) => index).slice(1);
  while (remaining.length > 0) {
    let bestDistance = Infinity;
    let bestPair = null;
    let bestIndex = 0;
    for (let r = 0; r < remaining.length; r += 1) {
      for (const inTree of connected) {
        for (const from of membersByBlob[inTree]) {
          for (const to of membersByBlob[remaining[r]]) {
            const distance = manhattan(from, to);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestPair = [from, to];
              bestIndex = r;
            }
          }
        }
      }
    }
    const [joined] = remaining.splice(bestIndex, 1);
    connected.push(joined);
    // ⚠ The blob still joins the tree when the corridor is refused, or the loop
    // would never terminate — it simply joins it unconnected on screen. What is
    // dropped is the arm, never the outline.
    if (bestPair && bestDistance <= maxCorridor) {
      for (const key of corridorCells(bestPair[0], bestPair[1])) region.add(key);
    }
  }
  return region;
}

/**
 * Trace the boundary of a cell region as closed loops of corner points, in cell
 * units (so a point is a lattice corner, not a pixel).
 *
 * Every boundary edge is emitted **directed so the region lies to its right**,
 * then chained end-to-start into loops. The direction convention is what makes
 * two things fall out for free: an enclosed hole comes back wound the other way,
 * and "inward" is always one fixed rotation — which is what `insetLoop` needs.
 *
 * ⚠ **Where two blobs touch at a single corner the walk turns right first.** Both
 * a right and a left turn are available at such a pinch; turning right keeps
 * hugging the blob the walk is already on and yields two loops that meet at a
 * point. Turning left would fuse them into one self-crossing loop — the same
 * outline, drawn as a bow tie.
 *
 * @param {Set<number> | Iterable<number>} region packed cell keys
 * @returns {Array<Array<{x: number, y: number}>>} closed loops; the last point is
 *          not repeated
 */
export function traceOutline(region) {
  const cells = region instanceof Set ? region : new Set(region);
  const has = (x, y) => cells.has(cellKey(x, y));
  /** @type {Map<number, Array<{from: {x: number, y: number}, to: {x: number, y: number}, dx: number, dy: number, used: boolean}>>} */
  const outgoing = new Map();
  const edges = [];
  const addEdge = (fromX, fromY, toX, toY) => {
    const edge = { from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, dx: Math.sign(toX - fromX), dy: Math.sign(toY - fromY), used: false };
    // Keyed by the edge's *start corner*, which is a lattice point rather than a
    // cell — the same packing works because the lattice is the cell grid offset
    // by nothing at all.
    const key = cellKey(fromX, fromY);
    const list = outgoing.get(key);
    if (list) list.push(edge);
    else outgoing.set(key, [edge]);
    edges.push(edge);
  };
  for (const key of [...cells].sort(byKey)) {
    const x = keyCellX(key);
    const y = keyCellY(key);
    // Clockwise around the cell in screen coordinates (y grows downward), so the
    // region is always on the right of travel.
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) addEdge(x, y + 1, x, y);
  }

  const loops = [];
  for (const start of edges) {
    if (start.used) continue;
    const points = [];
    let edge = start;
    while (edge && !edge.used) {
      edge.used = true;
      points.push(edge.from);
      const candidates = outgoing.get(cellKey(edge.to.x, edge.to.y)) ?? [];
      // Right turn, then straight, then left: at an ordinary corner only one of
      // them exists, and at a pinch the right turn is the one that keeps the
      // loop simple.
      const preferences = [
        [-edge.dy, edge.dx],
        [edge.dx, edge.dy],
        [edge.dy, -edge.dx],
      ];
      let next = null;
      for (const [dx, dy] of preferences) {
        next = candidates.find((candidate) => !candidate.used && candidate.dx === dx && candidate.dy === dy) ?? null;
        if (next) break;
      }
      edge = next;
    }
    if (points.length >= 4) loops.push(simplifyLoop(points));
  }
  return loops;
}

/** Drop points that sit in the middle of a straight run. */
function simplifyLoop(points) {
  const simplified = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const turns = (current.x - previous.x) * (next.y - current.y) !== (current.y - previous.y) * (next.x - current.x);
    if (turns) simplified.push(current);
  }
  return simplified;
}

/**
 * Move every edge of an axis-aligned closed loop `inset` units toward the region
 * it encloses, and return the corners of the result.
 *
 * All corners are right angles and `traceOutline` guarantees the region is on the
 * right of travel, so each shifted corner is one componentwise intersection of
 * two perpendicular lines — exact, rather than a general polygon offset. Works
 * unchanged on a hole's loop, which is wound the other way and therefore insets
 * the other way, which is the correct direction for a hole.
 *
 * @param {Array<{x: number, y: number}>} loop
 * @param {number} inset
 * @returns {Array<{x: number, y: number}>}
 */
export function insetLoop(loop, inset) {
  const count = loop.length;
  if (count < 4 || inset === 0) return loop;
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const previous = loop[(i - 1 + count) % count];
    const current = loop[i];
    const next = loop[(i + 1) % count];
    const inX = Math.sign(current.x - previous.x);
    const inY = Math.sign(current.y - previous.y);
    const outX = Math.sign(next.x - current.x);
    const outY = Math.sign(next.y - current.y);
    // "Right of travel" is the direction (dx, dy) rotated clockwise: (-dy, dx).
    const inOffsetX = -inY * inset;
    const inOffsetY = inX * inset;
    const outOffsetX = -outY * inset;
    const outOffsetY = outX * inset;
    result.push(
      inX !== 0
        ? { x: current.x + outOffsetX, y: current.y + inOffsetY }
        : { x: current.x + inOffsetX, y: current.y + outOffsetY },
    );
  }
  return result;
}

/**
 * Every social group on the map, ready to draw: its kind, its colour, and the
 * loops of its outline in cell units.
 *
 * ⚠ **Read from bulk-snapshot fields for every animal, never from the selection
 * or from inspection.** That is what makes this a *layer* rather than another
 * selected-animal overlay: nothing here is known about one animal more than
 * about any other, so switching it on says something about the whole map.
 *
 * Living animals only. A carcass keeps the `groupRecordId` it had — a fact about
 * who it was, exactly as `deathCause` is — and enrolling it would leave a group's
 * bubble stretched around a body long after the group had moved on.
 *
 * ⚠ **`visible` is a real budget, not a nicety.** Grouping is one pass over the
 * entities and is cheap; tracing a bubble is tens of Set operations per cell it
 * covers, and the demo world holds ~60 groups at once — **3.5 ms per tick**
 * measured over the committed fixture (500 entities, 2026-08-04), which is a
 * frame's whole allowance spent on groups nobody can see. Skipping a group whose
 * every member is off screen makes the layer cost what is *on* the screen, which
 * is the scaling law the rest of the renderer already follows (the terrain pass
 * walks visible cells, the entity query is viewport-bounded). The test is the
 * group's **whole** member bounding box against the viewport, so a group with one
 * animal above the view and one below still draws the arm that crosses it.
 *
 * @param {Iterable<object>} entities
 * @param {{width: number, height: number} | null} world
 * @param {{padding?: number, maxCorridor?: number, minMembers?: number,
 *          visible?: {minCellX: number, minCellY: number, maxCellX: number, maxCellY: number} | null}} [options]
 * @returns {Array<{key: string, kind: string, colorToken: string, ring: number,
 *          label: string, members: number, loops: Array<Array<{x: number, y: number}>>,
 *          bounds: {minCellX: number, minCellY: number, maxCellX: number, maxCellY: number}}>}
 */
export function describeSocialGroups(entities, world, options = {}) {
  const minMembers = options.minMembers ?? MIN_GROUP_MEMBERS;
  const padding = options.padding ?? BUBBLE_PADDING;
  const visible = options.visible ?? null;
  /** @type {Map<string, {kind: string, members: number, cells: Array<{cellX: number, cellY: number}>,
   *          minCellX: number, minCellY: number, maxCellX: number, maxCellY: number}>} */
  const groups = new Map();
  for (const entity of entities) {
    if (entity.kind !== 'animal' || entity.alive === false) continue;
    const memberships = membershipsOf(entity);
    if (memberships.length === 0) continue;
    const cell = worldCellOf(entity, world);
    for (const { key, kind } of memberships) {
      let group = groups.get(key);
      if (!group) {
        group = { kind, members: 0, cells: [], minCellX: Infinity, minCellY: Infinity, maxCellX: -Infinity, maxCellY: -Infinity };
        groups.set(key, group);
      }
      group.members += 1;
      group.cells.push(cell);
      if (cell.cellX < group.minCellX) group.minCellX = cell.cellX;
      if (cell.cellY < group.minCellY) group.minCellY = cell.cellY;
      if (cell.cellX > group.maxCellX) group.maxCellX = cell.cellX;
      if (cell.cellY > group.maxCellY) group.maxCellY = cell.cellY;
    }
  }

  const described = [];
  for (const [key, group] of groups) {
    if (group.members < minMembers) continue;
    if (
      visible &&
      (group.maxCellX + padding < visible.minCellX ||
        group.minCellX - padding > visible.maxCellX ||
        group.maxCellY + padding < visible.minCellY ||
        group.minCellY - padding > visible.maxCellY)
    ) {
      continue;
    }
    const appearance = SOCIAL_GROUP_APPEARANCE[group.kind] ?? SOCIAL_GROUP_APPEARANCE.group;
    const region = socialRegion(group.cells, world, options);
    const loops = traceOutline(region);
    if (loops.length === 0) continue;
    let minCellX = Infinity;
    let minCellY = Infinity;
    let maxCellX = -Infinity;
    let maxCellY = -Infinity;
    for (const key of region) {
      const cellX = keyCellX(key);
      const cellY = keyCellY(key);
      if (cellX < minCellX) minCellX = cellX;
      if (cellY < minCellY) minCellY = cellY;
      if (cellX > maxCellX) maxCellX = cellX;
      if (cellY > maxCellY) maxCellY = cellY;
    }
    described.push({
      key,
      kind: group.kind,
      colorToken: appearance.colorToken,
      ring: appearance.ring,
      label: appearance.label,
      members: group.members,
      loops,
      bounds: { minCellX, minCellY, maxCellX, maxCellY },
    });
  }
  // Outer rings first, and a stable key order within a ring: a record's outline
  // is drawn over the herd label's where they touch, which is the containment
  // the rings already say.
  described.sort((a, b) => a.ring - b.ring || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return described;
}

/**
 * How far inside the cell edge a ring's outline runs, in CSS pixels.
 *
 * Ring 0 sits half a pixel inside the boundary — the same lane the corner
 * brackets use, which is what makes the two read as one design language — and
 * each ring inward clears the last by a proportion of the cell, so the gap
 * survives the zoom range instead of closing up at 10px.
 *
 * ⚠ **Snapped so an odd-width stroke lands on a half-pixel**, which is the whole
 * reason this is a function rather than a constant. Cell corners are integer
 * pixel coordinates, so a 1px line centred on one straddles two pixel rows at
 * half opacity each: at the 10–16px zooms the outline came out as a grey smudge
 * rather than a line, with **no pixel actually its own colour** — which a UI test
 * counting pixels of the band's colour found before anyone's eyes did. The
 * corner brackets solved the same problem with their `+ 0.5` and this is that
 * rule generalized to any width.
 *
 * @param {number} ring
 * @param {number} cellSize
 * @param {number} lineWidth
 */
function ringInset(ring, cellSize, lineWidth) {
  const gap = Math.max(1.5, cellSize * 0.14);
  return Math.floor(lineWidth / 2 + ring * gap) + (lineWidth % 2 === 1 ? 0.5 : 0);
}

/**
 * Draw one closed loop as a rounded path.
 *
 * Each corner is an `arcTo` between the midpoints of its two edges, so the
 * radius can never exceed what the shorter edge has room for — the failure mode
 * of a fixed radius on a one-cell-wide corridor, where a full-size fillet would
 * overshoot the segment and turn the arm inside out.
 */
function traceRoundedPath(ctx, points, radius) {
  const count = points.length;
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  ctx.beginPath();
  const start = midpoint(points[count - 1], points[0]);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const half = Math.min(
      Math.hypot(current.x - previous.x, current.y - previous.y),
      Math.hypot(next.x - current.x, next.y - current.y),
    ) / 2;
    const to = midpoint(current, next);
    ctx.arcTo(current.x, current.y, to.x, to.y, Math.max(0.5, Math.min(radius, half)));
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * Paint the social layer.
 *
 * ⚠ **Shared by both grid renderers**, like `paintStatusMark` and
 * `groundAppearanceAt` — the geometry is the layer, and two copies of it kept
 * identical by hand is the failure §11 already records once. Colour resolution
 * stays each renderer's own: `resolveColor` takes a theme token, because the two
 * resolve tokens differently and neither should learn the other's way.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} options
 * @param {ReturnType<typeof describeSocialGroups>} options.groups
 * @param {{cellToScreen: (cellX: number, cellY: number) => {px: number, py: number}, cellSize: number}} options.projection
 * @param {{minCellX: number, minCellY: number, maxCellX: number, maxCellY: number}} options.visible
 *        the cells on screen; a group entirely outside them is skipped rather
 *        than traced into the void
 * @param {(colorToken: string) => string} options.resolveColor
 */
export function paintSocialLayer(ctx, { groups, projection, visible, resolveColor }) {
  if (!groups || groups.length === 0) return;
  const { cellSize } = projection;
  const origin = projection.cellToScreen(0, 0);
  const lineWidth = Math.max(1, Math.round(cellSize / 12));
  const radius = cellSize * 0.4;
  const previousJoin = ctx.lineJoin;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  for (const group of groups) {
    if (
      visible &&
      (group.bounds.maxCellX < visible.minCellX ||
        group.bounds.minCellX > visible.maxCellX ||
        group.bounds.maxCellY < visible.minCellY ||
        group.bounds.minCellY > visible.maxCellY)
    ) {
      continue;
    }
    ctx.strokeStyle = resolveColor(group.colorToken);
    const inset = ringInset(group.ring, cellSize, lineWidth);
    for (const loop of group.loops) {
      const pixels = loop.map((point) => ({
        x: origin.px + point.x * cellSize,
        y: origin.py + point.y * cellSize,
      }));
      traceRoundedPath(ctx, insetLoop(pixels, inset), radius);
    }
  }
  ctx.lineWidth = 1;
  ctx.lineJoin = previousJoin;
}
