/**
 * Canvas 2D ASCII grid renderer.
 *
 * Draw order per frame: background → terrain glyphs → entity glyphs →
 * remembered-place markers → selection/follow overlays. One monospace glyph
 * per cell, integer-aligned, device-pixel-ratio aware. No sprites, gradients,
 * shadows, or decorative animation — discrete cell changes only.
 *
 * Colors come from the Dracula CSS custom properties on the document root,
 * with the exact hex fallbacks from EntityAppearance for safety.
 */
import { createProjection, worldCellOf } from './GridProjection.js';
import {
  resolveAppearance,
  compareOccupants,
  DRACULA_COLORS,
  TERRAIN_APPEARANCE,
  resolveTerrainAppearance,
  resolveVegetationAppearance,
  resolveDisturbanceAppearance,
  resolveFeatureAppearance,
  resolveMemoryAppearance,
  statusesOf,
  fadesUnderOccupant,
  OCCUPIED_ALPHA,
} from './EntityAppearance.js';

const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * What a cell's ground looks like, in the protocol's own precedence: cells
 * beyond the world edge, then vegetation where a cell carries any, then the
 * terrain beneath it. Shared by the terrain pass and the selection overlay so
 * the two can never disagree about what is under a selected cell. Exported so
 * an alternative grid renderer (SpriteGridRenderer) shares the same precedence
 * rather than re-deriving it.
 * @param {import('../state/RendererStore.js').RendererStore} store
 * @param {number} cellX @param {number} cellY
 * @param {{width: number, height: number} | null} world
 */
export function groundAppearanceAt(store, cellX, cellY, world) {
  const inWorld = world && cellX >= 0 && cellY >= 0 && cellX < world.width && cellY < world.height;
  if (!inWorld) return TERRAIN_APPEARANCE.outOfBounds;
  const vegetation = resolveVegetationAppearance(store.vegetationLevelAt(cellX, cellY));
  if (vegetation) return vegetation;
  const name = store.terrainNameAt(cellX, cellY);
  return name ? resolveTerrainAppearance(name) : TERRAIN_APPEARANCE.ground;
}

export class AsciiGridRenderer {
  #canvas;
  #context;
  #cssWidth = 0;
  #cssHeight = 0;
  /** @type {Map<string, string>} theme token → resolved color */
  #colors = new Map();
  /** whether the last frame drew an animal with more than one status */
  #hasCyclingStatus = false;

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
  }

  get cssWidth() {
    return this.#cssWidth;
  }

  get cssHeight() {
    return this.#cssHeight;
  }

  /**
   * Fit the drawing surface to its element size at the device pixel ratio.
   * @param {number} cssWidth
   * @param {number} cssHeight
   * @param {number} devicePixelRatio
   */
  resize(cssWidth, cssHeight, devicePixelRatio = 1) {
    this.#cssWidth = Math.max(1, Math.floor(cssWidth));
    this.#cssHeight = Math.max(1, Math.floor(cssHeight));
    this.#canvas.width = Math.floor(this.#cssWidth * devicePixelRatio);
    this.#canvas.height = Math.floor(this.#cssHeight * devicePixelRatio);
    this.#canvas.style.width = `${this.#cssWidth}px`;
    this.#canvas.style.height = `${this.#cssHeight}px`;
    this.#context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  #color(token) {
    let resolved = this.#colors.get(token);
    if (!resolved) {
      const fromTheme =
        typeof getComputedStyle === 'function'
          ? getComputedStyle(document.documentElement).getPropertyValue(`--dracula-${token}`).trim()
          : '';
      resolved = fromTheme || DRACULA_COLORS[token] || DRACULA_COLORS.foreground;
      this.#colors.set(token, resolved);
    }
    return resolved;
  }

  /**
   * Draw one frame. Pure read of the store — nothing here mutates
   * authoritative state.
   * @param {object} options
   * @param {import('../state/RendererStore.js').RendererStore} options.store
   * @param {import('./Camera.js').Camera} options.camera
   * @param {number[]} [options.familyIds] relatives of the selected entity, to
   *        mark so a parent and its dependants can be picked out of a crowd
   * @param {Array<{kind: string, cellX: number, cellY: number, strength: number}>} [options.memories]
   *        places the selected entity remembers, drawn as faint markers
   * @param {number | null} [options.huntTargetId] the prey the selected predator
   *        has committed to, marked so a pursuit is legible mid-chase
   * @param {number | null} [options.groupId] the selected animal's herd label
   *        (protocol v22), so its groupmates can be picked out of a crowd
   * @param {{x: number, y: number, radius: number} | null} [options.homeRange]
   *        the selected animal's settled range (protocol v23), drawn as a ring
   * @param {{cellX: number, cellY: number} | null} [options.hoverCell]
   *        the cell under the pointer, framed in yellow corner brackets (the
   *        crosshair cursor aims at it) — grey fill stays selection-only
   * @param {number} [options.statusPhase] which status a multi-status animal is
   *        showing right now. A wall-clock counter, not a tick: see
   *        `hasCyclingStatus`
   * @param {Array<{cellX: number, cellY: number}>} [options.killCells] cells
   *        where something was killed on **this** tick, flashed red
   */
  draw({ store, camera, familyIds = [], memories = [], huntTargetId = null, groupId = null, homeRange = null, hoverCell = null, statusPhase = 0, killCells = [] }) {
    const ctx = this.#context;
    const projection = createProjection(camera, this.#cssWidth, this.#cssHeight);
    const { cellSize } = projection;
    const world = store.world;

    ctx.fillStyle = this.#color('background');
    ctx.fillRect(0, 0, this.#cssWidth, this.#cssHeight);

    const fontSize = Math.max(cellSize - 2, 5);
    // Two fonts, one italic: a female animal is drawn in italic (see
    // EntityAppearance.resolveAppearance). Everything else — terrain, features,
    // overlays — uses the upright font, so passes reset to it before drawing.
    const uprightFont = `${fontSize}px ${MONO_STACK}`;
    const italicFont = `italic ${fontSize}px ${MONO_STACK}`;
    ctx.font = uprightFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const half = cellSize / 2;

    // --- Kill flash. A cell where something was killed **this tick** is filled
    // red behind everything else, so a hunt that succeeded is impossible to
    // miss on a grid where the only other sign is a `%` appearing among the
    // glyphs. It lasts exactly as long as the tick does — the next delta clears
    // it, and a pause holds it — which is what makes it a *moment* rather than
    // another layer to read.
    //
    // ⚠ Behind everything: the ground glyph, the carcass, and any bracket are
    // all drawn over it. A flash that covered them would hide the very thing it
    // is pointing at.
    const killFill = this.#color('red');
    for (const cell of killCells) {
      const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
      ctx.fillStyle = killFill;
      ctx.fillRect(px, py, cellSize, cellSize);
    }

    // --- Occupants, resolved before anything is drawn. The entity pass below
    // needs the highest-priority occupant per cell, and the ground and feature
    // passes need to know which cells are occupied at all so they can fade what
    // is underneath — so the scan happens once, here, and all three read it.
    const cells = projection.visibleCellBounds();
    const visible = store.getEntitiesInBounds(projection.visibleWorldBounds(1));
    /** @type {Map<string, object>} cell key → top occupant */
    const topByCell = new Map();
    for (const entity of visible) {
      const cell = worldCellOf(entity, world);
      const key = `${cell.cellX},${cell.cellY}`;
      const current = topByCell.get(key);
      if (!current || compareOccupants(entity, current) < 0) {
        topByCell.set(key, entity);
      }
    }
    // Any occupant fades the ground, a carcass included: a body lying in the
    // grass hides that cell's forage exactly as an animal standing in it does,
    // and the `%` is the glyph worth reading either way.
    const occupied = (cellX, cellY) => topByCell.has(`${cellX},${cellY}`);

    // --- Terrain + vegetation pass. Terrain cell types come from the snapshot
    // legend; where a cell carries vegetation (level > 0), the green density
    // glyph is drawn over the ground instead. Cells beyond the world edge get
    // the out-of-bounds glyph.
    //
    // ⚠ A *fading* layer is not drawn at all in an occupied cell — forage,
    // water, and thicket here, trails and burrows in the pass below. Which
    // layers those are, and why the rest of the terrain is not among them, is
    // `fadesUnderOccupant`; how completely they give way is `OCCUPIED_ALPHA`,
    // which is 0 today and was 20% first (EntityAppearance has the argument).
    for (let cellY = cells.minCellY; cellY <= cells.maxCellY; cellY += 1) {
      for (let cellX = cells.minCellX; cellX <= cells.maxCellX; cellX += 1) {
        const appearance = groundAppearanceAt(store, cellX, cellY, world);
        const covered = occupied(cellX, cellY) && fadesUnderOccupant(appearance);
        if (covered && OCCUPIED_ALPHA === 0) continue;
        const { px, py } = projection.cellToScreen(cellX, cellY);
        if (covered) ctx.globalAlpha = OCCUPIED_ALPHA;
        ctx.fillStyle = this.#color(appearance.colorToken);
        ctx.fillText(appearance.glyph, px + half, py + half);
        if (covered) ctx.globalAlpha = 1;
      }
    }

    // --- Feature pass (protocol v27): trails and burrows, drawn over the
    // ground and under everything that happens on it. The projection carries
    // only cells deep enough to *be* something, so this walks a short list
    // rather than the grid, and is empty on a world nobody has worn down.
    for (const feature of store.features ?? []) {
      const appearance = resolveFeatureAppearance(feature.kind);
      if (!appearance) continue;
      if (
        feature.cellX < cells.minCellX ||
        feature.cellX > cells.maxCellX ||
        feature.cellY < cells.minCellY ||
        feature.cellY > cells.maxCellY
      ) {
        continue;
      }
      const covered = occupied(feature.cellX, feature.cellY) && fadesUnderOccupant(appearance);
      if (covered && OCCUPIED_ALPHA === 0) continue;
      const { px, py } = projection.cellToScreen(feature.cellX, feature.cellY);
      if (covered) ctx.globalAlpha = OCCUPIED_ALPHA;
      ctx.fillStyle = this.#color(appearance.colorToken);
      ctx.fillText(appearance.glyph, px + half, py + half);
      if (covered) ctx.globalAlpha = 1;
    }

    // --- Disturbance pass (protocol v26): fires, floods, and storms drawn over
    // the ground and under the animals. A bounded list of circles, so this
    // walks the visible cells of each active region rather than the whole grid,
    // and costs nothing at all when nothing is happening.
    for (const disturbance of store.disturbances ?? []) {
      const appearance = resolveDisturbanceAppearance(disturbance.kind);
      if (!appearance) continue;
      const minCellX = Math.max(cells.minCellX, Math.floor(disturbance.x - disturbance.radius));
      const maxCellX = Math.min(cells.maxCellX, Math.ceil(disturbance.x + disturbance.radius));
      const minCellY = Math.max(cells.minCellY, Math.floor(disturbance.y - disturbance.radius));
      const maxCellY = Math.min(cells.maxCellY, Math.ceil(disturbance.y + disturbance.radius));
      ctx.fillStyle = this.#color(appearance.colorToken);
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const dx = cellX + 0.5 - disturbance.x;
          const dy = cellY + 0.5 - disturbance.y;
          if (dx * dx + dy * dy > disturbance.radius * disturbance.radius) continue;
          const { px, py } = projection.cellToScreen(cellX, cellY);
          ctx.fillText(appearance.glyph, px + half, py + half);
        }
      }
    }

    // --- Entity pass: the highest-priority occupant per cell, resolved above.
    for (const [key, entity] of topByCell) {
      const [cellX, cellY] = key.split(',').map(Number);
      const { px, py } = projection.cellToScreen(cellX, cellY);
      const appearance = resolveAppearance(entity);
      // ⚠ No condition tint. A hurt or ill animal used to be *recoloured*,
      // which spent the one channel that says which species it is; condition
      // now rides as a corner mark instead (the status pass, last).
      ctx.fillStyle = this.#color(appearance.colorToken);
      ctx.font = appearance.italic ? italicFont : uprightFont;
      ctx.fillText(appearance.glyph, px + half, py + half);
    }
    ctx.font = uprightFont;

    // --- Overlay pass: remembered places first (they sit under everything —
    // they are the selected animal's private map, not world state), then family
    // links, then selection highlight and follow marker on top.
    for (const memory of memories) {
      const appearance = resolveMemoryAppearance(memory.kind);
      if (!appearance) continue;
      const { px, py } = projection.cellToScreen(memory.cellX, memory.cellY);
      // Fade with the memory itself, so forgetting is visible.
      ctx.globalAlpha = 0.25 + 0.55 * Math.max(0, Math.min(1, memory.strength));
      ctx.fillStyle = this.#color(appearance.colorToken);
      ctx.fillText(appearance.glyph, px + half, py + half);
      ctx.globalAlpha = 1;
    }
    // Home range (protocol v23), drawn first and faintest of all the overlays:
    // it is the widest and least specific thing on screen, and it is the one
    // piece of an animal's state that is genuinely a *place* rather than a
    // relationship. A ring of faint marks at the range radius rather than a
    // filled disc, so it frames the ground without obscuring what is on it —
    // and the centre marked, because "where this animal lives" is the number
    // the simulation actually keeps.
    if (homeRange && homeRange.radius > 0.5) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = this.#color('purple');
      const steps = Math.max(12, Math.min(64, Math.round(homeRange.radius * 3)));
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        const cellX = Math.floor(homeRange.x + Math.cos(angle) * homeRange.radius);
        const cellY = Math.floor(homeRange.y + Math.sin(angle) * homeRange.radius);
        const { px, py } = projection.cellToScreen(cellX, cellY);
        ctx.fillText('.', px + half, py + half);
      }
      const centre = projection.cellToScreen(Math.floor(homeRange.x), Math.floor(homeRange.y));
      ctx.fillText('+', centre.px + half, centre.py + half);
      ctx.globalAlpha = 1;
    }
    const activeId = store.selection?.activeId;
    // Herd (protocol v22). Drawn only for the selected animal's group, and
    // under the family/hunt marks, because it is the loosest of the three
    // relationships: a groupmate is company, not kin. There is no group *roster*
    // in the protocol — this is a scan of the visible entities for a matching
    // label, which is the same thing the engine does and for the same reason.
    if (groupId != null) {
      for (const entity of visible) {
        if (entity.id === activeId || entity.groupId !== groupId) continue;
        const cell = worldCellOf(entity, world);
        const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
        this.#drawBrackets(px, py, cellSize, this.#color('comment'));
      }
    }
    for (const familyId of familyIds) {
      if (familyId === activeId) continue;
      const relative = store.getEntity(familyId);
      if (!relative) continue;
      const cell = worldCellOf(relative, world);
      const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
      this.#drawBrackets(px, py, cellSize, this.#color('pink'));
    }
    if (huntTargetId != null && huntTargetId !== activeId) {
      const quarry = store.getEntity(huntTargetId);
      if (quarry) {
        const cell = worldCellOf(quarry, world);
        const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
        this.#drawBrackets(px, py, cellSize, this.#color('red'));
      }
    }
    // Selection is a *cell*, so the mark is drawn on the cell whether or not
    // anything is standing in it — a place you clicked but cannot see marked
    // reads as a click that did not register. The occupant's glyph is redrawn
    // in the selection colour on top, when there is one.
    const selected = activeId != null ? store.getEntity(activeId) : null;
    const selectedCell = selected
      ? worldCellOf(selected, world)
      : store.selection
        ? { cellX: store.selection.cellX, cellY: store.selection.cellY }
        : null;
    if (selectedCell) {
      const { px, py } = projection.cellToScreen(selectedCell.cellX, selectedCell.cellY);
      ctx.fillStyle = this.#color('selection');
      ctx.fillRect(px, py, cellSize, cellSize);
      this.#drawBrackets(px, py, cellSize, this.#color('bright-yellow'));
      // The fill covers whatever was drawn beneath, so put it back in the
      // selection colour: the occupant if there is one, otherwise the ground
      // itself — an empty selected cell must not read as a hole in the map.
      const appearance = selected ? resolveAppearance(selected) : groundAppearanceAt(store, selectedCell.cellX, selectedCell.cellY, world);
      ctx.fillStyle = this.#color('bright-yellow');
      ctx.font = appearance.italic ? italicFont : uprightFont;
      ctx.fillText(appearance.glyph, px + half, py + half);
      ctx.font = uprightFont;
    }
    const followed = store.followedEntityId != null ? store.getEntity(store.followedEntityId) : null;
    if (followed && followed.id !== activeId) {
      const cell = worldCellOf(followed, world);
      const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
      this.#drawBrackets(px, py, cellSize, this.#color('cyan'));
    }
    // Hover mark, drawn last so it sits above everything: yellow corner brackets
    // on the cell under the pointer (the crosshair cursor aims within them).
    // Skipped when it coincides with the selected cell, which already carries
    // brackets (over its grey fill) — the grey fill is deliberately selection-only.
    if (
      hoverCell &&
      !(selectedCell && hoverCell.cellX === selectedCell.cellX && hoverCell.cellY === selectedCell.cellY)
    ) {
      const { px, py } = projection.cellToScreen(hoverCell.cellX, hoverCell.cellY);
      this.#drawBrackets(px, py, cellSize, this.#color('bright-yellow'));
    }

    // --- Status pass (protocol v30 for two of them): a small mark in the
    // upper-left corner of any cell whose animal is hurt, ill, carrying,
    // in season, or dispersing.
    //
    // ⚠ **Drawn after everything, including the selection fill**, which paints
    // over its whole cell — a mark drawn before it would vanish the moment you
    // clicked the animal you were watching, which is exactly when you are
    // looking hardest. It rides slightly over the corner bracket arms for the
    // same reason: a two-pixel arm is recoverable, a hidden condition is not.
    //
    // One mark per *cell*, belonging to the occupant whose glyph is drawn —
    // the same rule the grid follows everywhere else. Several statuses on one
    // animal take turns rather than crowding the corner (see `statusPhase`).
    this.#hasCyclingStatus = false;
    for (const [key, entity] of topByCell) {
      const statuses = statusesOf(entity);
      if (statuses.length === 0) continue;
      if (statuses.length > 1) this.#hasCyclingStatus = true;
      const status = statuses[statusPhase % statuses.length];
      const [cellX, cellY] = key.split(',').map(Number);
      const { px, py } = projection.cellToScreen(cellX, cellY);
      this.#drawStatusMark(px, py, cellSize, status);
    }
  }

  /**
   * Whether the frame just drawn holds an animal with more than one status —
   * i.e. whether anything on screen is mid-cycle and the view has to be redrawn
   * when the phase turns over. Read by `RendererApp`, which owns the clock.
   *
   * ⚠ This is the whole reason the cycle can run while the simulation is
   * paused: it is a property of the *drawing*, not of the tick stream, so a
   * still world still animates.
   */
  get hasCyclingStatus() {
    return this.#hasCyclingStatus;
  }

  /**
   * A filled dot or diamond in the cell's upper-left corner.
   *
   * Sized from the cell rather than fixed, so it stays proportionate across the
   * 10–32px zoom range, and floored at 1.5px because below that a dot and a
   * diamond are the same three pixels and the shape channel stops meaning
   * anything.
   */
  #drawStatusMark(px, py, cellSize, status) {
    const ctx = this.#context;
    const radius = Math.max(1.5, cellSize * 0.13);
    const cx = px + radius + 1;
    const cy = py + radius + 1;
    ctx.fillStyle = this.#color(status.colorToken);
    ctx.beginPath();
    if (status.shape === 'diamond') {
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx + radius, cy);
      ctx.lineTo(cx, cy + radius);
      ctx.lineTo(cx - radius, cy);
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /** Corner brackets so selection is visible without relying on color alone. */
  #drawBrackets(px, py, cellSize, color) {
    const ctx = this.#context;
    const arm = Math.max(2, Math.floor(cellSize / 4));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = px + 0.5;
    const y0 = py + 0.5;
    const x1 = px + cellSize - 0.5;
    const y1 = py + cellSize - 0.5;
    ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0);
    ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm);
    ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1);
    ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm);
    ctx.stroke();
  }
}
