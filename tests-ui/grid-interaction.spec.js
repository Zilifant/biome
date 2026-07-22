import { test, expect, readRegion, countColor, canvasCursor, gridViewportPoint, COLORS } from './helpers/app.js';

// A cell well inside the grid, away from the edges and the panels.
const GX = 300;
const GY = 300;

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
    const from = await gridViewportPoint(page, GX, GY);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 70, from.y + 45, { steps: 6 });

    await expect(page.locator('#biome-canvas')).toHaveClass(/dragging/);
    expect(await canvasCursor(page)).toBe('move');

    await page.mouse.up();

    // Camera moved…
    await expect.poll(async () => page.locator('#status-camera').textContent()).not.toBe(camBefore);
    // …and a drag never opens the inspector.
    await expect(page.locator('.inspector-popover')).toBeHidden();
    await expect(page.locator('#biome-canvas')).not.toHaveClass(/dragging/);
  });

  test('clicking selects a cell (grey fill + inspector); the grey fill is selection-only', async ({ appPage: page }) => {
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
    expect(countColor(await readRegion(page, GX + 80, GY, 14, 14), COLORS.selection, SELECTION_TOL)).toBe(0);
  });

  test('Escape clears the selection and leaves no focus border on the map', async ({ appPage: page }) => {
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
