/**
 * The map-layer switchboard, and the first layer on it.
 *
 * ⚠ **This is the half of the social layer node cannot test.** The geometry is
 * pure and covered in `renderer-view.test.js`, but "switching it on puts an
 * outline on the canvas" is a claim about a real browser painting real pixels —
 * and a `<canvas>` is opaque to DOM queries, so `getImageData` is the only way
 * to see what was actually drawn. The colour counted is the **band's**
 * (`bright-cyan`), because the committed fixtures hold zebra bands — see the two
 * ⚠ notes below for what that colour is *not* unique against.
 */
import { test, expect, readRegion, countColor, waitForRender, SNAPSHOT } from './helpers/app.js';

/** #A4FFFF — a band's outline, and also the rut diamond. */
const BAND = [164, 255, 255];

/**
 * ⚠ **Tight.** The default tolerance of 26 cannot tell `bright-cyan` (#A4FFFF)
 * from `cyan` (#8BE9FD): they are 25 apart in the red channel, so every water
 * glyph on screen counted as an outline and the layer looked switched on before
 * it was. Ten separates the two and still absorbs the antialiasing on a stroke.
 */
const TOLERANCE = 10;

/**
 * How much of the middle of the grid is band-coloured right now.
 *
 * ⚠ **A window rather than the whole canvas, and that is a correctness fix, not
 * a saving.** Reading every pixel of a 558×792 canvas ships 1.7M numbers back
 * over the debug protocol and takes seconds, so an `expect.poll` around it got
 * *one* sample inside its timeout — which raced the animation frame and read the
 * canvas as it had been before the toggle. The layer looked broken when what was
 * broken was the measurement. The band is panned to the centre, so a window
 * there sees it.
 */
async function bandPixels(page) {
  const box = await page.locator('#biome-canvas').boundingBox();
  const data = await readRegion(page, Math.floor(box.width / 2) - 100, Math.floor(box.height / 2) - 80, 200, 160);
  return countColor(data, BAND, TOLERANCE);
}

/**
 * The centre of the biggest **zebra** band in the committed fixtures — the world
 * is 332×280 and the camera starts in the middle of it, where there may well be
 * nothing but grass.
 *
 * ⚠ **The species matters, because the colour asserted on is the species'
 * group's.** The first version of this took whichever record was nearest the
 * middle of the map, which is a hyena *clan* — drawn bright-pink — so the cyan
 * pixels the test counted came from whatever bands happened to be at the edge of
 * the viewport, and a cell of camera drift flipped it between hundreds and none.
 * The lesson is the general one: point the camera at the thing being asserted,
 * not at something near it.
 */
function aBandsCentre() {
  const members = SNAPSHOT.entities.filter(
    (entity) => entity.groupRecordId != null && entity.kind === 'animal' && entity.speciesId === 'herbivore.zebra',
  );
  expect(members.length, 'the fixtures hold at least one zebra band').toBeGreaterThan(0);
  const sizes = new Map();
  for (const entity of members) sizes.set(entity.groupRecordId, (sizes.get(entity.groupRecordId) ?? 0) + 1);
  const [biggest] = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const band = members.filter((entity) => entity.groupRecordId === biggest);
  return {
    x: band.reduce((sum, entity) => sum + entity.x, 0) / band.length,
    y: band.reduce((sum, entity) => sum + entity.y, 0) / band.length,
  };
}

/** Walk the camera onto a world point with the keyboard pan (Shift is ten cells). */
async function panTo(page, target) {
  const cameraAt = async () => {
    const text = await page.locator('#status-bar').innerText();
    const [, x, y] = text.match(/cam (-?[\d.]+),(-?[\d.]+)/);
    return { x: Number(x), y: Number(y) };
  };
  for (let step = 0; step < 200; step += 1) {
    const camera = await cameraAt();
    const dx = target.x - camera.x;
    const dy = target.y - camera.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const fast = Math.max(Math.abs(dx), Math.abs(dy)) > 12 ? 'Shift+' : '';
    if (Math.abs(dx) >= 2) await page.keyboard.press(`${fast}${dx > 0 ? 'ArrowRight' : 'ArrowLeft'}`);
    if (Math.abs(dy) >= 2) await page.keyboard.press(`${fast}${dy > 0 ? 'ArrowDown' : 'ArrowUp'}`);
  }
}

test.describe('map layers', () => {
  test('the panel lists every layer, off, with its key', async ({ appPage: page }) => {
    const social = page.locator('input[data-layer="social"]');
    await expect(social).toBeVisible();
    await expect(social).not.toBeChecked();
    // The key is generated from the appearance registry, so it says what the
    // outlines mean without the legend having to be open.
    await expect(page.locator('#layers-panel .layer-key')).toContainText('band');
    await expect(page.locator('#layers-panel .layer-key')).toContainText('pride');
  });

  test('switching the social layer on draws outlines, and off removes them', async ({ appPage: page }) => {
    // Put a real band on screen first: the camera starts in the middle of a
    // 332×280 world, which is mostly grass. The canvas has to be focused for the
    // keyboard pan, and Escape drops the selection the focusing click made.
    await page.locator('#biome-canvas').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Escape');
    await panTo(page, aBandsCentre());
    await page.waitForTimeout(200);

    // ⚠ Measured as a *change*, not as an absolute. The rut diamond is
    // bright-cyan too (`STATUS_APPEARANCE`), so a fixture world with a female in
    // season on screen has some of this colour before the layer is switched on —
    // and an outline is hundreds of pixels against a mark's handful.
    const before = await bandPixels(page);

    await page.locator('input[data-layer="social"]').check();
    await expect
      .poll(async () => await bandPixels(page), { message: 'the band outlines appear', timeout: 5000 })
      .toBeGreaterThan(before + 100);

    await page.locator('input[data-layer="social"]').uncheck();
    await expect
      .poll(async () => await bandPixels(page), { message: 'and go again', timeout: 5000 })
      .toBeLessThanOrEqual(before);
  });

  test('a switched-on layer survives a reload', async ({ appPage: page }) => {
    await page.locator('input[data-layer="social"]').check();
    await page.reload({ waitUntil: 'load' });
    await waitForRender(page);
    await expect(page.locator('input[data-layer="social"]')).toBeChecked();
  });

  test('the panel folds up like every other panel in the sidebar', async ({ appPage: page }) => {
    const section = page.locator('#layers-panel');
    await section.locator('h2').click();
    await expect(section).toHaveClass(/collapsed/);
    await expect(page.locator('input[data-layer="social"]')).toBeHidden();
    await section.locator('h2').click();
    await expect(page.locator('input[data-layer="social"]')).toBeVisible();
  });
});
