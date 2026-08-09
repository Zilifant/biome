import { test, expect, readRegion, countColor, canvasCursor, gridViewportPoint, COLORS, floatInspector } from './helpers/app.js';

// A point well inside the grid, away from its edges.
//
// ⚠ **Derived from the canvas, not hard-coded** (2026-08-09). These were the
// literals 300,300, which sat inside the canvas until the inspector took a
// column of its own and the map narrowed — at a 1440-px window the grid is now
// ~264 px wide, so the "cell well inside the grid" was off the canvas entirely
// and every hover and click in this file silently did nothing. A coordinate into
// a canvas whose size depends on the panel layout has to be computed from that
// canvas.
const gridPoint = async (page) => {
  const box = await page.locator('#biome-canvas').boundingBox();
  return { gx: Math.round(box.width * 0.45), gy: Math.round(box.height * 0.4) };
};

test.describe('grid interaction', () => {
  test('the grid shows a crosshair cursor; hovering a cell draws yellow brackets that clear on leave', async ({
    appPage: page,
  }) => {
    // A crosshair aims at the cell the pointer is over; the hover brackets frame it.
    expect(await canvasCursor(page)).toBe('crosshair');

    // Baseline: pointer parked over the sidebar, so the grid cell is unmarked.
    const parkAway = async () => {
      const sidebar = await page.locator('#sidebar').boundingBox();
      await page.mouse.move(sidebar.x + 20, sidebar.y + 20);
    };
    await parkAway();
    const { gx: GX, gy: GY } = await gridPoint(page);
    const baselineYellow = countColor(await readRegion(page, GX - 9, GY - 9, 18, 18), COLORS.brightYellow);

    // Hover the cell → yellow bracket pixels appear on it.
    const point = await gridViewportPoint(page, GX, GY);
    await page.mouse.move(point.x, point.y);
    await expect
      .poll(async () => countColor(await readRegion(page, GX - 9, GY - 9, 18, 18), COLORS.brightYellow))
      .toBeGreaterThan(baselineYellow);

    // Leaving the grid clears them again.
    await parkAway();
    await expect
      .poll(async () => countColor(await readRegion(page, GX - 9, GY - 9, 18, 18), COLORS.brightYellow))
      .toBeLessThanOrEqual(baselineYellow);
  });

  test('dragging pans the camera with a move cursor and never selects', async ({ appPage: page }) => {
    const camBefore = await page.locator('#status-camera').textContent();
    const { gx: GX, gy: GY } = await gridPoint(page);
    const from = await gridViewportPoint(page, GX, GY);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 70, from.y + 45, { steps: 6 });

    await expect(page.locator('#biome-canvas')).toHaveClass(/dragging/);
    expect(await canvasCursor(page)).toBe('move');

    await page.mouse.up();

    // Camera moved…
    await expect.poll(async () => page.locator('#status-camera').textContent()).not.toBe(camBefore);
    // …and a drag never opens the inspector. ⚠ Asked to float first: the panel
    // docks by default now, and a docked panel is always "visible".
    await expect(page.locator('.inspector-popover')).toBeHidden();
    await expect(page.locator('#biome-canvas')).not.toHaveClass(/dragging/);
  });

  test('clicking selects a cell (grey fill + inspector); the grey fill is selection-only', async ({ appPage: page }) => {
    await floatInspector(page);
    const { gx: GX, gy: GY } = await gridPoint(page);
    const point = await gridViewportPoint(page, GX, GY);
    await page.mouse.click(point.x, point.y);

    const popover = page.locator('.inspector-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.popover-title')).toHaveText(/^cell \d+,\d+$/);

    // The selected cell carries the grey selection fill… A tight tolerance is
    // needed: #44475A sits close to the dark background greys, so a loose match
    // finds selection-coloured pixels on unselected ground too.
    const SELECTION_TOL = 6;
    await expect
      .poll(async () => countColor(await readRegion(page, GX - 7, GY - 7, 14, 14), COLORS.selection, SELECTION_TOL))
      .toBeGreaterThan(0);
    // …but a different, unselected cell does not.
    // ⚠ A cell *back* from the probe, not 80px forward: the grid is narrower than
    // it was and forward ran off the canvas, which reads as "no selection colour"
    // for the wrong reason and would pass even if the fill leaked everywhere.
    expect(countColor(await readRegion(page, Math.max(0, GX - 60), GY, 14, 14), COLORS.selection, SELECTION_TOL)).toBe(0);
  });

  test('Escape clears the selection and leaves no focus border on the map', async ({ appPage: page }) => {
    await floatInspector(page);
    const { gx: GX, gy: GY } = await gridPoint(page);
    const point = await gridViewportPoint(page, GX, GY);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.inspector-popover')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.inspector-popover')).toBeHidden();
    // The old bug: Esc flipped :focus-visible on and painted a purple border.
    // The canvas must show no focus outline even while focused.
    const outline = await page.evaluate(() => {
      const c = document.getElementById('biome-canvas');
      c.focus();
      return getComputedStyle(c).outlineStyle;
    });
    expect(outline).toBe('none');
  });
});
