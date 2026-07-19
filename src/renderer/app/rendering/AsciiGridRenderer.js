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
  resolveMemoryAppearance,
  resolveColorToken,
} from './EntityAppearance.js';

const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export class AsciiGridRenderer {
  #canvas;
  #context;
  #cssWidth = 0;
  #cssHeight = 0;
  /** @type {Map<string, string>} theme token → resolved color */
  #colors = new Map();

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
   */
  draw({ store, camera, familyIds = [], memories = [], huntTargetId = null }) {
    const ctx = this.#context;
    const projection = createProjection(camera, this.#cssWidth, this.#cssHeight);
    const { cellSize } = projection;
    const world = store.world;

    ctx.fillStyle = this.#color('background');
    ctx.fillRect(0, 0, this.#cssWidth, this.#cssHeight);

    const fontSize = Math.max(cellSize - 2, 5);
    ctx.font = `${fontSize}px ${MONO_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const half = cellSize / 2;

    // --- Terrain + vegetation pass. Terrain cell types come from the snapshot
    // legend; where a cell carries vegetation (level > 0), the green density
    // glyph is drawn over the ground instead. Cells beyond the world edge get
    // the out-of-bounds glyph.
    const cells = projection.visibleCellBounds();
    for (let cellY = cells.minCellY; cellY <= cells.maxCellY; cellY += 1) {
      for (let cellX = cells.minCellX; cellX <= cells.maxCellX; cellX += 1) {
        const inWorld =
          world && cellX >= 0 && cellY >= 0 && cellX < world.width && cellY < world.height;
        let appearance;
        if (!inWorld) {
          appearance = TERRAIN_APPEARANCE.outOfBounds;
        } else {
          const vegetation = resolveVegetationAppearance(store.vegetationLevelAt(cellX, cellY));
          if (vegetation) {
            appearance = vegetation;
          } else {
            const name = store.terrainNameAt(cellX, cellY);
            appearance = name ? resolveTerrainAppearance(name) : TERRAIN_APPEARANCE.ground;
          }
        }
        const { px, py } = projection.cellToScreen(cellX, cellY);
        ctx.fillStyle = this.#color(appearance.colorToken);
        ctx.fillText(appearance.glyph, px + half, py + half);
      }
    }

    // --- Entity pass: highest-priority occupant per cell.
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
    for (const [key, entity] of topByCell) {
      const [cellX, cellY] = key.split(',').map(Number);
      const { px, py } = projection.cellToScreen(cellX, cellY);
      const appearance = resolveAppearance(entity);
      // A hurt animal is tinted (Step 17) from the `healthFraction` the
      // protocol already sends — injuries themselves stay inspection-only.
      ctx.fillStyle = this.#color(resolveColorToken(entity, appearance));
      ctx.fillText(appearance.glyph, px + half, py + half);
    }

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
    const activeId = store.selection?.activeId;
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
    const selected = activeId != null ? store.getEntity(activeId) : null;
    if (selected) {
      const cell = worldCellOf(selected, world);
      const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
      ctx.fillStyle = this.#color('selection');
      ctx.fillRect(px, py, cellSize, cellSize);
      this.#drawBrackets(px, py, cellSize, this.#color('bright-yellow'));
      const appearance = resolveAppearance(selected);
      ctx.fillStyle = this.#color('bright-yellow');
      ctx.fillText(appearance.glyph, px + half, py + half);
    }
    const followed = store.followedEntityId != null ? store.getEntity(store.followedEntityId) : null;
    if (followed && followed.id !== activeId) {
      const cell = worldCellOf(followed, world);
      const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
      this.#drawBrackets(px, py, cellSize, this.#color('cyan'));
    }
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
