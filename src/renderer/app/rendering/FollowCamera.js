/**
 * Following an animal without shaking the map.
 *
 * ⚠⚠ **The camera used to track the animal's reported float position while the
 * grid drew it at its floored cell**, and those are two different motions. An
 * animal moving 0.6 of a cell slid the *whole map* by 0.6 of a cell while its
 * own glyph stayed put, and then the glyph jumped a whole cell back the other
 * way when the floor ticked over. They cancel on average and disagree on every
 * frame, so at speed — deltas are capped at 20/s — the map shimmered twenty
 * times a second around a stationary animal.
 *
 * Two ideas fix it, and this module is both of them, pure:
 *
 * 1. **A deadzone.** The camera holds still while the followed animal is
 *    anywhere in a box around the middle of the viewport, and only moves when
 *    it leaves. Most ticks therefore move nothing at all.
 * 2. **A glide.** When it does move, it eases to the new centre over a couple
 *    of hundred milliseconds on the wall clock instead of teleporting a cell at
 *    a time.
 *
 * ⚠ It does **not** interpolate the animal (P7). The glyph still steps cell to
 * cell — what changes is that it now steps inside a still viewport rather than
 * standing still inside a moving one.
 */

/**
 * How much of the viewport the deadzone box spans, in each axis. At 0.5 the
 * animal can drift a quarter of a screen from the middle before the view
 * follows.
 *
 * ⚠ **This is the lever, and it is bounded on both sides.** Too small and a
 * walking animal drags the camera constantly, which is the defect this module
 * exists to remove; too large and the animal is at the edge of the screen with
 * nothing ahead of it. A gazelle's `baseSpeed` is 1.2 cells/tick, so a *running*
 * animal crosses a 12-cell half-box in ~10 ticks however this is tuned: the
 * deadzone buys stillness for a grazing animal, and buys a smooth single-
 * direction move for a sprinting one.
 */
export const FOLLOW_DEADZONE_FRACTION = 0.5;

/** The smallest box worth having, in cells, for a very narrow grid column. */
export const FOLLOW_MIN_BOX_CELLS = 6;

/**
 * Glide pace and its clamps.
 *
 * ⚠⚠ **Per screen pixel, not per cell — and that is a fix, not a preference**
 * _(2026-08-10)_. Both of these were per *cell* first, which made the glide a
 * different animation at every zoom: the deadzone is a share of the viewport, so
 * a recentre is always ~a quarter of the screen, but that same quarter-screen is
 * 15 cells at the 10px floor and 4 cells at 32px. The reported symptom was the
 * far end of it — see `GLIDE_SNAP_VIEWPORTS` — but the pacing was wrong all the
 * way along: the identical move on screen took 270 ms zoomed out and 120 ms
 * zoomed in. **A viewer watches pixels.**
 *
 * ⚠ Roughly doubled on 2026-08-10 on the report that the moves were abrupt.
 * At the default zoom a recentre was ~170 ms and is now ~330 ms.
 */
export const GLIDE_MS_PER_PIXEL = 2.2;
export const GLIDE_MIN_MS = 240;
/**
 * ⚠ **The ceiling is what stops the camera falling behind, and it was measured
 * rather than guessed** _(2026-08-10)_. It binds only on moves longer than
 * `GLIDE_MAX_MS / GLIDE_MS_PER_PIXEL` ≈ 236px — which an ordinary recentre
 * never reaches on a normal grid, and a *catch-up* move always does. At 32× the
 * host sends 2 ticks every 62.5 ms, so a fast animal is repeatedly re-targeted
 * before the previous move lands and the camera trails it. Worst distance from
 * the middle of the screen, as a share of the half-viewport (>1.0 = off the
 * edge), 2000 ticks, `smallDemo` seed 42, 900×800 grid at 16px:
 *
 * | ceiling | vulture | leopard | gazelle |
 * | ------: | ------: | ------: | ------: |
 * |  640 ms |    1.19 |    1.05 |    0.97 |
 * |  520 ms |    1.01 |    0.88 |    0.81 |
 * |  420 ms |    0.84 |    0.73 |    0.67 |
 *
 * 640 put the two fastest animals off the edge of the view at top speed. 520 is
 * the value that keeps the doubled pacing for every move a viewer actually
 * watches and buys the catch-up back. ⚠ At 1× and 8× none of this matters —
 * every species sits at 0.61–0.67 whatever the ceiling.
 */
export const GLIDE_MAX_MS = 520;

/**
 * Beyond this — as a multiple of the viewport's *smaller* side — a move is a
 * jump, not a pan: a re-follow across the map, or an animal the store moved a
 * long way in one coalesced delta. Gliding that is a scenic tour of ground
 * nobody asked to see.
 *
 * ⚠⚠ **This was 40 *cells* and that was the bug behind "zoomed far out, the map
 * re-adjusts almost instantly."** At the 10px floor a wide grid shows 120 cells,
 * so the deadzone's own half-width is ~30 cells and an ordinary recentre easily
 * cleared 40 — every routine follow move took the teleport branch. Whether a
 * move is a pan or a jump is a question about the *screen*: one viewport is one
 * viewport at every zoom level. At 16px on a 600px grid this is ~37 cells, so
 * the old threshold was right for exactly one zoom level and wrong either side.
 */
export const GLIDE_SNAP_VIEWPORTS = 1;

/** Below this, a "move" is not one. Guards a forced recentre that is already centred. */
const NEGLIGIBLE_CELLS = 0.01;

/**
 * The centre of the cell an entity is drawn in.
 *
 * ⚠ **Follow what is drawn, not what is reported.** Aiming at `entity.x` puts
 * the camera on a fraction that changes every tick, so a camera that has just
 * recentred is already fractionally wrong on the next one — the original defect
 * in miniature, surviving the deadzone.
 * @param {{x: number, y: number}} position
 */
export function cellCentreOf(position) {
  return { x: Math.floor(position.x) + 0.5, y: Math.floor(position.y) + 0.5 };
}

/**
 * Keep a camera centre inside the world.
 *
 * ⚠ Lives here rather than in `Camera` because the follow planner has to know
 * where a move will actually *end up* before deciding whether it is a move at
 * all, and `Camera.clampToWorld` mutates. `Camera` delegates to this, so there
 * is one copy of the rule (§10).
 * @param {number} x @param {number} y
 * @param {{width: number, height: number} | null} world
 */
export function clampCentreToWorld(x, y, world) {
  if (!world) return { x, y };
  return {
    x: Math.min(Math.max(x, 0), world.width),
    y: Math.min(Math.max(y, 0), world.height),
  };
}

/**
 * Half the deadzone box, in cells, for one axis.
 * @param {number} viewportPx CSS pixels along this axis
 * @param {number} cellSize CSS pixels per cell
 */
function halfBoxCells(viewportPx, cellSize) {
  const visibleCells = viewportPx / cellSize;
  // Never let the box reach the edge of the screen: an animal exactly on the
  // boundary would be half off the viewport with no warning that it is leaving.
  const ceiling = Math.max(0, visibleCells / 2 - 1);
  const ideal = (visibleCells * FOLLOW_DEADZONE_FRACTION) / 2;
  return Math.min(Math.max(ideal, FOLLOW_MIN_BOX_CELLS / 2), ceiling);
}

/**
 * The deadzone half-extents in cells. Derived from the *zoom*, so the box is a
 * constant share of what the viewer can see rather than a constant number of
 * cells — zooming in narrows it in world terms, which is what "keep it roughly
 * centred" means at any scale.
 * @param {number} cellSize
 * @param {number} viewportWidth CSS pixels
 * @param {number} viewportHeight CSS pixels
 */
export function followBox(cellSize, viewportWidth, viewportHeight) {
  return {
    halfX: halfBoxCells(viewportWidth, cellSize),
    halfY: halfBoxCells(viewportHeight, cellSize),
  };
}

/**
 * Where the camera should go to keep following, or `null` for "stay exactly
 * where you are" — which is the answer most ticks.
 *
 * ⚠ **A move recentres fully; it does not nudge the animal back to the edge of
 * the box.** Edge-nudging is the cheap version and it degenerates straight back
 * into per-tick jitter: once the animal is against the boundary, every single
 * tick moves the camera by exactly that tick's motion. Recentring buys a whole
 * half-box of runway before the next move.
 *
 * @param {object} options
 * @param {{centerX: number, centerY: number, cellSize: number}} options.camera
 * @param {number} options.viewportWidth CSS pixels
 * @param {number} options.viewportHeight
 * @param {{x: number, y: number}} options.target where the camera would sit
 * @param {{width: number, height: number} | null} [options.world]
 * @param {boolean} [options.ignoreDeadzone] recentre even from inside the box
 *        (the `C` key: "put it back in the middle, now")
 * @returns {{x: number, y: number, distance: number, snap: boolean} | null}
 */
export function planFollow({ camera, viewportWidth, viewportHeight, target, world = null, ignoreDeadzone = false }) {
  if (!ignoreDeadzone) {
    const { halfX, halfY } = followBox(camera.cellSize, viewportWidth, viewportHeight);
    const inside =
      Math.abs(target.x - camera.centerX) <= halfX && Math.abs(target.y - camera.centerY) <= halfY;
    if (inside) return null;
  }
  const clamped = clampCentreToWorld(target.x, target.y, world);
  const distance = Math.hypot(clamped.x - camera.centerX, clamped.y - camera.centerY);
  // ⚠ After clamping, not before: at a world edge the camera may already be as
  // close as it is allowed to get, and asking for that move every tick would be
  // a glide restarted twenty times a second that never goes anywhere.
  if (distance < NEGLIGIBLE_CELLS) return null;
  const snapBeyondPx = Math.min(viewportWidth, viewportHeight) * GLIDE_SNAP_VIEWPORTS;
  return { x: clamped.x, y: clamped.y, distance, snap: distance * camera.cellSize > snapBeyondPx };
}

/**
 * How long a move of this length should take.
 * @param {number} distanceCells
 * @param {number} cellSize CSS pixels per cell — the whole point: the same move
 *        on screen takes the same time at every zoom level
 */
export function glideDuration(distanceCells, cellSize) {
  return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, distanceCells * cellSize * GLIDE_MS_PER_PIXEL));
}

/**
 * A glide, ready to be advanced.
 *
 * ⚠ **It does not carry a start time.** The first `glideAt` that sees `startMs`
 * as null stamps it, so the clock is always the animation frame's own — nothing
 * here reads a clock of its own, and a glide created between frames does not
 * lose the milliseconds it waited.
 * @param {number} fromX @param {number} fromY @param {number} toX @param {number} toY
 * @param {number} cellSize CSS pixels per cell, for the pacing
 */
export function startGlide(fromX, fromY, toX, toY, cellSize) {
  const distance = Math.hypot(toX - fromX, toY - fromY);
  return { fromX, fromY, toX, toY, startMs: null, durationMs: glideDuration(distance, cellSize) };
}

/**
 * Off the mark briskly, settling at the end.
 *
 * ⚠ **Quadratic rather than cubic** _(2026-08-10, with the slowdown)_. Cubic
 * leaves at three times the average speed, and that opening lurch is most of
 * what reads as "jarring" when the moves come often; quadratic leaves at twice.
 * ⛔ **Ease-*in*-out is the obvious way to soften the start further and it is
 * wrong here**: a retarget mid-flight rebuilds the curve from zero velocity, so
 * the camera would visibly stall at the seam — and at high speed, retargeting
 * mid-flight is the normal case rather than the exception.
 */
const easeOut = (t) => 1 - (1 - t) ** 2;

/**
 * Where a glide is at `now`, and whether it is over.
 * @param {{fromX: number, fromY: number, toX: number, toY: number,
 *          startMs: number | null, durationMs: number}} glide
 * @param {number} now milliseconds, from the animation frame
 */
export function glideAt(glide, now) {
  const startMs = glide.startMs ?? now;
  const elapsed = now - startMs;
  const t = glide.durationMs > 0 ? elapsed / glide.durationMs : 1;
  // ⚠ The end is written exactly, not interpolated to 1: `from + (to - from) *
  // 1` is not bit-identical to `to`, and a camera that stops a millionth of a
  // cell short leaves the projection's rounded pixel offset one off forever.
  if (t >= 1) return { x: glide.toX, y: glide.toY, done: true };
  const eased = easeOut(Math.max(0, t));
  return {
    x: glide.fromX + (glide.toX - glide.fromX) * eased,
    y: glide.fromY + (glide.toY - glide.fromY) * eased,
    done: false,
  };
}
