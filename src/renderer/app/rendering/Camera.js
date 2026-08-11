/**
 * Renderer-local camera: a center point in world coordinates plus a cell
 * size in CSS pixels. Purely presentational — moving or zooming the camera
 * never sends anything to the simulation and never affects simulation
 * fidelity. One world unit is one grid cell.
 */
import { clampCentreToWorld, glideAt, startGlide } from './FollowCamera.js';

/**
 * Supported cell sizes in CSS pixels. The floor is 10px: below that a cell
 * stops being a reliable click target, and since every cell is now selectable
 * — bare ground included — an unhittable cell is a broken control rather than
 * a merely small one. The cost is that a large world no longer fits the
 * viewport at minimum zoom, which is what drag-panning is for.
 */
export const ZOOM_LEVELS = Object.freeze([10, 12, 14, 16, 20, 24, 28, 32]);
export const DEFAULT_CELL_SIZE = 16;

export class Camera {
  /**
   * A move in progress, or null. Held here rather than in `RendererApp` for
   * one reason: there are six places that move this camera, and a glide left
   * running under a drag fights the pointer. State beside the mutators cannot
   * be forgotten at one of six call sites — §11's whole theme is what "kept
   * consistent by hand" costs later.
   * @type {{fromX: number, fromY: number, toX: number, toY: number,
   *         startMs: number | null, durationMs: number} | null}
   */
  #glide = null;

  /**
   * @param {object} [options]
   * @param {number} [options.centerX] world coordinate
   * @param {number} [options.centerY] world coordinate
   * @param {number} [options.cellSize] CSS pixels per world cell
   */
  constructor({ centerX = 0, centerY = 0, cellSize = DEFAULT_CELL_SIZE } = {}) {
    this.centerX = centerX;
    this.centerY = centerY;
    this.cellSize = Camera.snapCellSize(cellSize);
  }

  /** Nearest supported zoom level. @param {number} size */
  static snapCellSize(size) {
    let best = ZOOM_LEVELS[0];
    for (const level of ZOOM_LEVELS) {
      if (Math.abs(level - size) < Math.abs(best - size)) best = level;
    }
    return best;
  }

  /**
   * Pan by whole world cells.
   * @param {number} dxCells
   * @param {number} dyCells
   */
  panByCells(dxCells, dyCells) {
    this.cancelGlide();
    this.centerX += dxCells;
    this.centerY += dyCells;
  }

  /**
   * Pan by screen pixels (drag-to-pan). Dragging moves the *world* with the
   * pointer, so the camera travels the opposite way — a drag to the right
   * reveals what is to the left. Fractional, unlike `panByCells`: a pointer
   * drag that snapped to whole cells would stutter.
   * @param {number} dxPixels pointer movement, screen pixels
   * @param {number} dyPixels
   */
  panByPixels(dxPixels, dyPixels) {
    this.cancelGlide();
    this.centerX -= dxPixels / this.cellSize;
    this.centerY -= dyPixels / this.cellSize;
  }

  /** @param {number} x @param {number} y */
  centerOn(x, y) {
    this.cancelGlide();
    this.centerX = x;
    this.centerY = y;
  }

  /**
   * Ease to (x, y) instead of jumping there — the follow camera's move.
   * Retargets from wherever the camera is *now*, so a second target arriving
   * mid-move continues from the current position rather than restarting the
   * curve, which reads as a hitch.
   * @param {number} x @param {number} y
   */
  glideTo(x, y) {
    // ⚠ The zoom is part of the pacing: a move is timed by how far it travels
    // on *screen*, so the same visual move takes the same time at 10px and 32px.
    this.#glide = startGlide(this.centerX, this.centerY, x, y, this.cellSize);
  }

  /** Whether a glide is still running. */
  get gliding() {
    return this.#glide !== null;
  }

  /** Stop where we are. Every mutator on this class calls it. */
  cancelGlide() {
    this.#glide = null;
  }

  /**
   * Advance a glide to the frame's timestamp.
   *
   * ⚠ Returns false the moment there is nothing to do, and clears the glide on
   * the frame it finishes — a still world must cost no frames at all, which is
   * the same discipline `hasCyclingStatus` keeps for the status marks.
   * @param {number} now milliseconds, from `requestAnimationFrame`
   * @returns {boolean} true if the camera moved this frame
   */
  advance(now) {
    if (!this.#glide) return false;
    this.#glide.startMs ??= now;
    const { x, y, done } = glideAt(this.#glide, now);
    this.centerX = x;
    this.centerY = y;
    if (done) this.#glide = null;
    return true;
  }

  /** @returns {boolean} true if the zoom level changed */
  zoomIn() {
    return this.#stepZoom(1);
  }

  /** @returns {boolean} true if the zoom level changed */
  zoomOut() {
    return this.#stepZoom(-1);
  }

  #stepZoom(direction) {
    const index = ZOOM_LEVELS.indexOf(this.cellSize);
    const next = ZOOM_LEVELS[index + direction];
    if (next === undefined) return false;
    // A zoom is already a jump; sliding on top of one reads as a fault. The
    // follow target is re-evaluated against the new zoom by the caller.
    this.cancelGlide();
    this.cellSize = next;
    return true;
  }

  /**
   * Zoom keeping the given world point fixed on screen (mouse-wheel zoom
   * anchored near the cursor).
   * @param {number} worldX
   * @param {number} worldY
   * @param {1 | -1} direction
   * @returns {boolean} true if the zoom level changed
   */
  zoomAt(worldX, worldY, direction) {
    const oldSize = this.cellSize;
    const changed = direction > 0 ? this.zoomIn() : this.zoomOut();
    if (!changed) return false;
    const ratio = oldSize / this.cellSize;
    this.centerX = worldX - (worldX - this.centerX) * ratio;
    this.centerY = worldY - (worldY - this.centerY) * ratio;
    return true;
  }

  /**
   * Keep the camera center inside the world when bounds are known.
   *
   * ⚠ Deliberately does **not** cancel a glide: a glide's endpoints are clamped
   * when it is created, so every eased point between them is already in bounds,
   * and clamping the interpolant would bend the curve near a map edge.
   * @param {{width: number, height: number} | null} world
   */
  clampToWorld(world) {
    if (!world) return;
    const clamped = clampCentreToWorld(this.centerX, this.centerY, world);
    this.centerX = clamped.x;
    this.centerY = clamped.y;
  }
}
