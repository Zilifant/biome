/**
 * Canvas 2D sprite grid renderer — the alternative to AsciiGridRenderer,
 * selected with `?renderer=sprite`.
 *
 * Same contract (resize / cssWidth / cssHeight / draw), same draw order, same
 * store reads, same projection — only what lands in each cell differs: where a
 * slot (see SpriteSlots.js) has a spritesheet assignment, the sprite is drawn;
 * anywhere it does not, the exact ASCII glyph is drawn instead, so a partial
 * mapping (or a missing sheet) still renders everything.
 *
 * The spritesheet loads asynchronously; frames drawn before it arrives use the
 * glyph fallback, and `onAtlasReady` lets the app mark the grid dirty for a
 * repaint when it lands. Sprites are blitted through a per-(sprite, tint,
 * cell size) offscreen tile cache built at device-pixel resolution with image
 * smoothing off, so pixel art stays crisp at every zoom level.
 *
 * A tint (from the editor, or the hurt/sick condition, or the selection
 * highlight) recolours the sprite as a flat silhouette — the sprite's alpha
 * with one fill — matching the single-colour ASCII aesthetic and keeping the
 * condition tints unambiguous. An untinted sprite keeps its own sheet colours.
 */
import { createProjection, worldCellOf } from './GridProjection.js';
import {
  resolveAppearance,
  compareOccupants,
  DRACULA_COLORS,
  resolveDisturbanceAppearance,
  resolveFeatureAppearance,
  resolveMemoryAppearance,
  resolveColorToken,
} from './EntityAppearance.js';
import { groundAppearanceAt } from './AsciiGridRenderer.js';
import {
  slotIdForEntity,
  groundSlotAt,
  slotIdForFeature,
  slotIdForDisturbance,
  slotIdForMemory,
  spriteForSlot,
} from './SpriteSlots.js';
import { SHEET, loadSpriteConfig } from './SpriteConfig.js';

const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/** Tile-cache ceiling: slots × zoom levels × a few tints in practice. */
const TILE_CACHE_MAX = 512;

export class SpriteGridRenderer {
  #canvas;
  #context;
  #cssWidth = 0;
  #cssHeight = 0;
  #devicePixelRatio = 1;
  /** @type {Map<string, string>} theme token → resolved color */
  #colors = new Map();
  #config;
  #onAtlasReady;
  /** @type {HTMLImageElement | null} */
  #atlas = null;
  #atlasReady = false;
  /** @type {Map<string, HTMLCanvasElement>} `col,row,tint,cellSize` → tile */
  #tiles = new Map();

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {object} [options.config] a config out of loadSpriteConfig/validateSpriteConfig
   * @param {() => void} [options.onAtlasReady] called when the sheet finishes
   *        loading — the app uses it to mark the grid dirty (requestRedraw)
   */
  constructor(canvas, { config = loadSpriteConfig(), onAtlasReady = () => {} } = {}) {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
    this.#config = config;
    this.#onAtlasReady = onAtlasReady;
    this.#loadAtlas(config.sheetDataUrl ?? SHEET.url);
  }

  get cssWidth() {
    return this.#cssWidth;
  }

  get cssHeight() {
    return this.#cssHeight;
  }

  #loadAtlas(url) {
    const image = new Image();
    image.onload = () => {
      this.#atlas = image;
      this.#atlasReady = true;
      this.#tiles.clear();
      this.#onAtlasReady();
    };
    image.onerror = () => {
      // No sheet is a supported state (none is committed): everything draws
      // as glyphs, exactly as ASCII mode would. Say why, once, rather than
      // failing silently or loudly.
      console.warn(`sprite mode: no spritesheet at ${url}; drawing glyph fallback`);
    };
    image.src = url;
  }

  /**
   * Fit the drawing surface to its element size at the device pixel ratio.
   * @param {number} cssWidth @param {number} cssHeight @param {number} devicePixelRatio
   */
  resize(cssWidth, cssHeight, devicePixelRatio = 1) {
    this.#cssWidth = Math.max(1, Math.floor(cssWidth));
    this.#cssHeight = Math.max(1, Math.floor(cssHeight));
    this.#canvas.width = Math.floor(this.#cssWidth * devicePixelRatio);
    this.#canvas.height = Math.floor(this.#cssHeight * devicePixelRatio);
    this.#canvas.style.width = `${this.#cssWidth}px`;
    this.#canvas.style.height = `${this.#cssHeight}px`;
    this.#context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    if (devicePixelRatio !== this.#devicePixelRatio) {
      // Tiles are built at device resolution, so a DPR change stales them all.
      this.#devicePixelRatio = devicePixelRatio;
      this.#tiles.clear();
    }
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
   * The cached tile for one sprite at one cell size with one tint (null =
   * the sprite's own sheet colours), or null when the assignment points past
   * the sheet's edge — a stale mapping against a smaller sheet must not throw.
   * @param {{col: number, row: number}} assignment
   * @param {string | null} tint
   * @param {number} cellSize
   * @returns {HTMLCanvasElement | null}
   */
  #tile(assignment, tint, cellSize) {
    const key = `${assignment.col},${assignment.row},${tint ?? ''},${cellSize}`;
    let tile = this.#tiles.get(key);
    if (tile) return tile;

    const { spriteWidth, spriteHeight, gap, margin } = SHEET;
    const sx = margin + assignment.col * (spriteWidth + gap);
    const sy = margin + assignment.row * (spriteHeight + gap);
    if (sx + spriteWidth > this.#atlas.naturalWidth || sy + spriteHeight > this.#atlas.naturalHeight) {
      return null;
    }

    const size = Math.max(1, Math.round(cellSize * this.#devicePixelRatio));
    tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const ctx = tile.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // Cells are square but sprites need not be (12×8 is fine): scale to fit,
    // preserving aspect, centred — never stretched.
    const scale = Math.min(size / spriteWidth, size / spriteHeight);
    const dw = Math.max(1, Math.round(spriteWidth * scale));
    const dh = Math.max(1, Math.round(spriteHeight * scale));
    const dx = Math.floor((size - dw) / 2);
    const dy = Math.floor((size - dh) / 2);
    ctx.drawImage(this.#atlas, sx, sy, spriteWidth, spriteHeight, dx, dy, dw, dh);
    if (tint) {
      // Flat silhouette: one fill clipped to the sprite's alpha.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (this.#tiles.size >= TILE_CACHE_MAX) this.#tiles.clear();
    this.#tiles.set(key, tile);
    return tile;
  }

  /**
   * Draw the sprite assigned to a slot at a cell, if there is one. Returns
   * false when the slot is unassigned, the sheet has not loaded, or the
   * assignment falls off the sheet — the caller then draws the ASCII glyph.
   * `forcedTint` overrides the assignment's tint (condition and selection
   * colours); undefined means "use the assignment's own tint".
   */
  #drawSprite(slotId, px, py, cellSize, forcedTint = undefined) {
    if (!this.#atlasReady) return false;
    const assignment = spriteForSlot(this.#config, slotId);
    if (!assignment) return false;
    const tint = forcedTint === undefined ? assignment.tint : forcedTint;
    const tile = this.#tile(assignment, tint, cellSize);
    if (!tile) return false;
    const ctx = this.#context;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, px, py, cellSize, cellSize);
    return true;
  }

  /** The ASCII fallback: one glyph, exactly as AsciiGridRenderer draws it. */
  #drawGlyph(glyph, colorToken, px, py, cellSize, italic = false) {
    const ctx = this.#context;
    const fontSize = Math.max(cellSize - 2, 5);
    ctx.font = `${italic ? 'italic ' : ''}${fontSize}px ${MONO_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.#color(colorToken);
    ctx.fillText(glyph, px + cellSize / 2, py + cellSize / 2);
  }

  /**
   * Draw one frame. Pure read of the store — same signature, same pass order,
   * and same store reads as AsciiGridRenderer.draw; see that method for the
   * meaning of each option.
   */
  draw({ store, camera, familyIds = [], memories = [], huntTargetId = null, groupId = null, homeRange = null, hoverCell = null }) {
    const ctx = this.#context;
    const projection = createProjection(camera, this.#cssWidth, this.#cssHeight);
    const { cellSize } = projection;
    const world = store.world;

    ctx.fillStyle = this.#config.canvasBackground ?? this.#color('background');
    ctx.fillRect(0, 0, this.#cssWidth, this.#cssHeight);

    // --- Terrain + vegetation pass.
    const cells = projection.visibleCellBounds();
    for (let cellY = cells.minCellY; cellY <= cells.maxCellY; cellY += 1) {
      for (let cellX = cells.minCellX; cellX <= cells.maxCellX; cellX += 1) {
        const { px, py } = projection.cellToScreen(cellX, cellY);
        const slotId = groundSlotAt(store, cellX, cellY, world);
        if (!this.#drawSprite(slotId, px, py, cellSize)) {
          const appearance = groundAppearanceAt(store, cellX, cellY, world);
          this.#drawGlyph(appearance.glyph, appearance.colorToken, px, py, cellSize);
        }
      }
    }

    // --- Feature pass: trails and burrows, over the ground, under everything
    // that happens on it.
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
      const { px, py } = projection.cellToScreen(feature.cellX, feature.cellY);
      if (!this.#drawSprite(slotIdForFeature(feature.kind), px, py, cellSize)) {
        this.#drawGlyph(appearance.glyph, appearance.colorToken, px, py, cellSize);
      }
    }

    // --- Disturbance pass: the same centre-of-cell circle test as
    // CellDetail.covers, so the panel and the grid never disagree.
    for (const disturbance of store.disturbances ?? []) {
      const appearance = resolveDisturbanceAppearance(disturbance.kind);
      if (!appearance) continue;
      const slotId = slotIdForDisturbance(disturbance.kind);
      const minCellX = Math.max(cells.minCellX, Math.floor(disturbance.x - disturbance.radius));
      const maxCellX = Math.min(cells.maxCellX, Math.ceil(disturbance.x + disturbance.radius));
      const minCellY = Math.max(cells.minCellY, Math.floor(disturbance.y - disturbance.radius));
      const maxCellY = Math.min(cells.maxCellY, Math.ceil(disturbance.y + disturbance.radius));
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const dx = cellX + 0.5 - disturbance.x;
          const dy = cellY + 0.5 - disturbance.y;
          if (dx * dx + dy * dy > disturbance.radius * disturbance.radius) continue;
          const { px, py } = projection.cellToScreen(cellX, cellY);
          if (!this.#drawSprite(slotId, px, py, cellSize)) {
            this.#drawGlyph(appearance.glyph, appearance.colorToken, px, py, cellSize);
          }
        }
      }
    }

    // --- Entity pass: highest-priority occupant per cell, via the same
    // compareOccupants ordering as ASCII mode.
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
      // Condition beats decoration: when the hurt/sick tint fires (it differs
      // from the species token), it overrides the assignment's tint so an
      // outbreak reads the same in sprites as in glyphs. Incubating stays
      // invisible — that judgement lives in resolveColorToken, inherited here.
      const conditionToken = resolveColorToken(entity, appearance);
      const forcedTint =
        conditionToken !== appearance.colorToken ? this.#color(conditionToken) : undefined;
      if (!this.#drawSprite(slotIdForEntity(entity), px, py, cellSize, forcedTint)) {
        this.#drawGlyph(appearance.glyph, conditionToken, px, py, cellSize, appearance.italic);
      }
    }

    // --- Overlay pass: remembered places, faded with the memory itself.
    for (const memory of memories) {
      const appearance = resolveMemoryAppearance(memory.kind);
      if (!appearance) continue;
      const { px, py } = projection.cellToScreen(memory.cellX, memory.cellY);
      ctx.globalAlpha = 0.25 + 0.55 * Math.max(0, Math.min(1, memory.strength));
      if (!this.#drawSprite(slotIdForMemory(memory.kind), px, py, cellSize)) {
        this.#drawGlyph(appearance.glyph, appearance.colorToken, px, py, cellSize);
      }
      ctx.globalAlpha = 1;
    }
    // Home range ring — an overlay mark, not a slot; identical to ASCII mode.
    if (homeRange && homeRange.radius > 0.5) {
      ctx.globalAlpha = 0.45;
      const steps = Math.max(12, Math.min(64, Math.round(homeRange.radius * 3)));
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        const cellX = Math.floor(homeRange.x + Math.cos(angle) * homeRange.radius);
        const cellY = Math.floor(homeRange.y + Math.sin(angle) * homeRange.radius);
        const { px, py } = projection.cellToScreen(cellX, cellY);
        this.#drawGlyph('.', 'purple', px, py, cellSize);
      }
      const centre = projection.cellToScreen(Math.floor(homeRange.x), Math.floor(homeRange.y));
      this.#drawGlyph('+', 'purple', centre.px, centre.py, cellSize);
      ctx.globalAlpha = 1;
    }
    const activeId = store.selection?.activeId;
    // Herd, family, and hunt marks — brackets, exactly as in ASCII mode.
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
    // Selection: grey fill, brackets, and the occupant (or ground) put back on
    // top in the selection colour — as a bright-yellow-tinted sprite where one
    // is assigned, the bright-yellow glyph where not.
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
      const highlight = this.#color('bright-yellow');
      const slotId = selected
        ? slotIdForEntity(selected)
        : groundSlotAt(store, selectedCell.cellX, selectedCell.cellY, world);
      if (!this.#drawSprite(slotId, px, py, cellSize, highlight)) {
        const appearance = selected
          ? resolveAppearance(selected)
          : groundAppearanceAt(store, selectedCell.cellX, selectedCell.cellY, world);
        this.#drawGlyph(appearance.glyph, 'bright-yellow', px, py, cellSize, appearance.italic);
      }
    }
    const followed = store.followedEntityId != null ? store.getEntity(store.followedEntityId) : null;
    if (followed && followed.id !== activeId) {
      const cell = worldCellOf(followed, world);
      const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
      this.#drawBrackets(px, py, cellSize, this.#color('cyan'));
    }
    if (
      hoverCell &&
      !(selectedCell && hoverCell.cellX === selectedCell.cellX && hoverCell.cellY === selectedCell.cellY)
    ) {
      const { px, py } = projection.cellToScreen(hoverCell.cellX, hoverCell.cellY);
      this.#drawBrackets(px, py, cellSize, this.#color('bright-yellow'));
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
