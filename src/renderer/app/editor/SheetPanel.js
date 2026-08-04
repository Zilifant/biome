/**
 * The editor's spritesheet panel: the loaded sheet drawn at an integer zoom
 * with the grid overlaid from the SHEET geometry constants, hit-testing a
 * click to a (col, row), and highlights for the selected sprite and every
 * assigned cell. With no sheet loaded it shows how to supply one instead.
 *
 * Dumb on purpose: all state lives in EditorState; this renders it and
 * reports clicks.
 */
import { SHEET } from '../rendering/SpriteConfig.js';
import { DRACULA_COLORS } from '../rendering/EntityAppearance.js';

const ZOOMS = [2, 4, 8];

export class SheetPanel {
  #container;
  #onPick;
  #canvas;
  #emptyState;
  #zoomButtons;
  #zoom = 4;
  /** @type {HTMLImageElement | null} */
  #atlas = null;

  /**
   * @param {HTMLElement} container
   * @param {{onPick: (col: number, row: number) => void}} callbacks
   */
  constructor(container, { onPick }) {
    this.#container = container;
    this.#onPick = onPick;
    container.innerHTML = `
      <div class="sheet-toolbar">
        <span class="sheet-zoom-label" id="sheet-zoom-label">zoom</span>
        <span role="group" aria-labelledby="sheet-zoom-label">
          ${ZOOMS.map((z) => `<button type="button" data-zoom="${z}">${z}×</button>`).join('')}
        </span>
      </div>
      <div class="sheet-scroll">
        <canvas class="sheet-canvas" aria-label="Spritesheet grid. Click a sprite to pick it."></canvas>
        <p class="sheet-empty" hidden>
          No spritesheet loaded. Use “Load PNG…” below, or place one at
          <code>src/renderer/app/assets/spritesheet.png</code> and set its
          geometry in the <code>SHEET</code> constants in
          <code>src/renderer/app/rendering/SpriteConfig.js</code>.
        </p>
      </div>
    `;
    this.#canvas = container.querySelector('.sheet-canvas');
    this.#emptyState = container.querySelector('.sheet-empty');
    this.#zoomButtons = [...container.querySelectorAll('[data-zoom]')];
    for (const button of this.#zoomButtons) {
      button.addEventListener('click', () => {
        this.#zoom = Number(button.dataset.zoom);
        this.#renderCanvas();
      });
    }
    this.#canvas.addEventListener('click', (event) => {
      const cell = this.#cellAt(event);
      if (cell) this.#onPick(cell.col, cell.row);
    });
    this.#lastState = null;
  }

  #lastState;

  /** The sheet image to draw, or null when none is available. */
  setAtlas(atlas) {
    this.#atlas = atlas;
    this.#renderCanvas();
  }

  /** @param {object} state the editor state */
  render(state) {
    this.#lastState = state;
    this.#renderCanvas();
  }

  #cellAt(event) {
    if (!this.#atlas) return null;
    const rect = this.#canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.#zoom;
    const y = (event.clientY - rect.top) / this.#zoom;
    const { spriteWidth, spriteHeight, gap, margin } = SHEET;
    const col = Math.floor((x - margin) / (spriteWidth + gap));
    const row = Math.floor((y - margin) / (spriteHeight + gap));
    if (col < 0 || row < 0) return null;
    // Clicks in the gap between cells belong to nothing.
    const inCellX = x - margin - col * (spriteWidth + gap);
    const inCellY = y - margin - row * (spriteHeight + gap);
    if (inCellX >= spriteWidth || inCellY >= spriteHeight) return null;
    const sx = margin + col * (spriteWidth + gap);
    const sy = margin + row * (spriteHeight + gap);
    if (sx + spriteWidth > this.#atlas.naturalWidth || sy + spriteHeight > this.#atlas.naturalHeight) {
      return null;
    }
    return { col, row };
  }

  #cellOrigin(col, row) {
    const { spriteWidth, spriteHeight, gap, margin } = SHEET;
    return {
      x: (margin + col * (spriteWidth + gap)) * this.#zoom,
      y: (margin + row * (spriteHeight + gap)) * this.#zoom,
      w: spriteWidth * this.#zoom,
      h: spriteHeight * this.#zoom,
    };
  }

  #renderCanvas() {
    const atlas = this.#atlas;
    const hasSheet = Boolean(atlas);
    this.#canvas.hidden = !hasSheet;
    this.#emptyState.hidden = hasSheet;
    for (const button of this.#zoomButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.zoom) === this.#zoom));
    }
    if (!hasSheet) return;

    const ctx = this.#canvas.getContext('2d');
    this.#canvas.width = atlas.naturalWidth * this.#zoom;
    this.#canvas.height = atlas.naturalHeight * this.#zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    ctx.drawImage(atlas, 0, 0, this.#canvas.width, this.#canvas.height);

    // Grid overlay from the SHEET constants, so what the editor claims is a
    // cell is exactly what the renderer will cut out.
    const { spriteWidth, spriteHeight, gap, margin } = SHEET;
    const cols = Math.floor((atlas.naturalWidth - margin + gap) / (spriteWidth + gap));
    const rows = Math.floor((atlas.naturalHeight - margin + gap) / (spriteHeight + gap));
    ctx.strokeStyle = 'rgba(98, 114, 164, 0.6)'; // comment, translucent
    ctx.lineWidth = 1;
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        const { x, y, w, h } = this.#cellOrigin(col, row);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }

    const state = this.#lastState;
    if (!state) return;
    // Cells already assigned somewhere get a corner badge.
    ctx.fillStyle = DRACULA_COLORS.green;
    for (const assignment of Object.values(state.config.assignments)) {
      const { x, y } = this.#cellOrigin(assignment.col, assignment.row);
      ctx.fillRect(x + 1, y + 1, 4, 4);
    }
    // The sprite in hand: the parked pick, or the selected slot's assignment.
    const active = state.selectedSprite ?? (state.selectedSlotId ? state.config.assignments[state.selectedSlotId] : null);
    if (active) {
      const { x, y, w, h } = this.#cellOrigin(active.col, active.row);
      ctx.strokeStyle = DRACULA_COLORS['bright-yellow'];
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
  }
}
