/**
 * Following an animal must not shake the map.
 *
 * The reported symptom, at speed: the whole grid jittered around the followed
 * animal. The camera sat on the animal's *reported float position* while the
 * grid drew it at its *floored cell*, so every delta slid the map by a fraction
 * of a cell and then jumped the glyph a whole cell back the other way — twenty
 * times a second at the broadcast cap.
 *
 * ⚠ **The deadzone is what a browser has to prove.** Its arithmetic is pure and
 * covered in `renderer-view.test.js`, but "a real delta arriving does not move
 * the real camera" runs through the store, the app's follow path, the animation
 * frame and the status bar, and only a browser holds all four at once. The
 * camera's own readout is the probe: it is the one place the renderer states
 * where the camera actually is.
 *
 * ⚠ What is **not** asserted anywhere: that the move *looks* smooth. The second
 * test proves a glide arrives exactly and stops; whether it eases pleasantly is
 * a judgement for `npm run dev`.
 */
import { test, expect, SNAPSHOT } from './helpers/app.js';

/** The animal we drive. Any living one will do — it gets teleported into place. */
const TARGET = SNAPSHOT.entities.find((entity) => entity.kind === 'animal' && entity.alive !== false);

/**
 * The centre of the world, which is where the app points the camera on its
 * first snapshot — and an empty cell in the committed fixture, so the click
 * that selects it can only select our animal.
 */
const HOME = { x: SNAPSHOT.world.width / 2 + 0.5, y: SNAPSHOT.world.height / 2 + 0.5 };

/** The default zoom, in CSS pixels per cell — what the deadzone is measured against. */
const CELL_SIZE = 16;

const delta = (baseTick, updated) => ({
  type: 'snapshot.delta',
  payload: {
    protocolVersion: SNAPSHOT.protocolVersion,
    kind: 'snapshot.delta',
    simulationId: SNAPSHOT.simulationId,
    baseTick,
    tick: baseTick + 1,
    created: [],
    updated,
    removed: [],
    events: [],
    lastEventSeq: (SNAPSHOT.lastEventSeq ?? 0) + baseTick + 1,
  },
});

/**
 * Put the animal under the middle of the canvas, select it, and follow it.
 * Returns the camera readout locator and the deadzone's half-width in cells.
 */
async function followAtCentre(page, push, baseTick) {
  await push(delta(baseTick, [{ ...TARGET, x: HOME.x, y: HOME.y }]));
  await expect(page.locator('#status-tick')).toHaveText(String(baseTick + 1));

  const canvas = page.locator('#biome-canvas');
  const box = await canvas.boundingBox();
  // ⚠ Half a cell off the exact centre on purpose: the canvas centre pixel sits
  // on a cell boundary whose rounding depends on the canvas being an even
  // number of pixels wide, so clicking it is a coin flip between two cells.
  await canvas.click({ position: { x: box.width / 2 + CELL_SIZE / 2, y: box.height / 2 + CELL_SIZE / 2 } });
  const followButton = page.locator('button[data-action="follow"]');
  // The button exists only when an entity is active, so this is also the proof
  // that the click landed on our animal rather than on bare ground.
  await expect(followButton).toHaveText('Follow (F)');
  await page.keyboard.press('f');
  await expect(followButton).toHaveText('Unfollow (F)');

  return { camera: page.locator('#status-camera'), halfBoxCells: ((box.width / CELL_SIZE) * 0.5) / 2 };
}

test.describe('the follow camera', () => {
  test('holds still while the animal moves inside the box, then recentres', async ({ live: { page, push } }) => {
    const base = SNAPSHOT.tick;
    const { camera, halfBoxCells } = await followAtCentre(page, push, base);

    const before = await camera.textContent();
    expect(before).toBe(`${Math.floor(HOME.x)},${Math.floor(HOME.y)}`);

    // Three ticks, striding as far as the box allows. ⚠ Derived from the
    // measured canvas rather than hardcoded, and then asserted: the grid column
    // is ~254px at this viewport, so the box is under four cells and a fixed
    // two-cell stride walked straight out of it. A test that walks out of the
    // box is measuring the recentre it was written to rule out.
    const steps = 3;
    const stride = Math.max(1, Math.floor((halfBoxCells - 0.5) / steps));
    expect(steps * stride + 0.5, 'the animal must stay inside the box for this test to mean anything')
      .toBeLessThan(halfBoxCells);

    for (let step = 1; step <= steps; step += 1) {
      await push(delta(base + step, [{ ...TARGET, x: HOME.x + step * stride, y: HOME.y }]));
      // The tick and the camera are written by the same `#updatePanels`, so a
      // tick that has landed means the camera reading is that tick's.
      await expect(page.locator('#status-tick')).toHaveText(String(base + step + 1));
      expect(await camera.textContent(), `the map moved on tick ${step} — this is the jitter`).toBe(before);
    }

    // Out of the box, and the camera goes to the cell the animal is drawn in.
    const away = Math.floor(halfBoxCells) + 4;
    await push(delta(base + steps + 1, [{ ...TARGET, x: HOME.x + away, y: HOME.y }]));
    await expect(camera).toHaveText(`${Math.floor(HOME.x + away)},${Math.floor(HOME.y)}`);
  });

  test('a glide arrives exactly on the target and stops there', async ({ live: { page, push } }) => {
    // ⚠ The suite runs with `reducedMotion: 'reduce'`, under which the camera
    // snaps and no glide ever runs. Turning it off is what puts the eased path
    // — and its termination — under test at all. If a browser ignored this, the
    // camera would snap and the assertion below would still hold; the test
    // would prove less, but it would not flake.
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    const base = SNAPSHOT.tick;
    const { camera, halfBoxCells } = await followAtCentre(page, push, base);

    const away = Math.floor(halfBoxCells) + 6;
    await push(delta(base + 1, [{ ...TARGET, x: HOME.x + away, y: HOME.y }]));
    // Auto-retried, so the ~300ms of easing is absorbed. What this catches is a
    // glide that stops short, overshoots, or never ends.
    await expect(camera).toHaveText(`${Math.floor(HOME.x + away)},${Math.floor(HOME.y)}`);
  });
});
