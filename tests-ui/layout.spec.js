import { test, expect, waitForRender } from './helpers/app.js';

test.describe('layout', () => {
  test('four columns, left to right: events, grid, population, sidebar', async ({ appPage: page }) => {
    // The event log has its own column on the left; population moved out of the
    // sidebar into a column of its own between the grid and the sidebar.
    await expect(page.locator('#events-column #event-log-panel')).toHaveCount(1);
    await expect(page.locator('#sidebar #event-log-panel')).toHaveCount(0);
    await expect(page.locator('#population-column #metrics-panel')).toHaveCount(1);
    await expect(page.locator('#sidebar #metrics-panel')).toHaveCount(0);

    const events = await page.locator('#events-column').boundingBox();
    const canvas = await page.locator('#biome-canvas').boundingBox();
    const population = await page.locator('#population-column').boundingBox();
    const sidebar = await page.locator('#sidebar').boundingBox();
    expect(events.x).toBeLessThan(canvas.x);
    expect(canvas.x).toBeLessThan(population.x);
    expect(population.x).toBeLessThan(sidebar.x);
  });

  test('the sidebar holds controls, legend, and the inspector dock', async ({ appPage: page }) => {
    for (const id of ['controls-panel', 'legend-panel', 'inspector-panel']) {
      await expect(page.locator(`#sidebar #${id}`)).toHaveCount(1);
    }
  });

  test('the status bar reports fixture mode and the fixture world', async ({ appPage: page }) => {
    await expect(page.locator('#status-mode')).toHaveText('FIXTURE');
    await expect(page.locator('#status-run')).toHaveText('REPLAY');
    // Exact counts drift when fixtures are regenerated; assert shape, not value.
    await expect(page.locator('#status-entities')).toHaveText(/^\d+$/);
    await expect(page.locator('#status-tick')).toHaveText(/^\d+$/);
  });
});

/**
 * Column widths. The default width is also the minimum — each column is sized to
 * the narrowest thing it has to show — so a drag only ever widens, and the
 * handle's double-click puts it back.
 */
test.describe('resizable columns', () => {
  /** Drag a column's handle by `dx` CSS pixels. */
  async function dragHandle(page, columnId, dx) {
    const handle = await page.locator(`.col-resizer[data-resize="${columnId}"]`).boundingBox();
    const y = handle.y + handle.height / 2;
    const x = handle.x + handle.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // More than one move: a single jump can be coalesced into the press.
    await page.mouse.move(x + dx / 2, y);
    await page.mouse.move(x + dx, y);
    await page.mouse.up();
  }

  const width = (page, id) => page.locator(`#${id}`).boundingBox().then((box) => box.width);

  test('dragging the events column edge widens it, and the grid gives up the room', async ({ appPage: page }) => {
    const before = await width(page, 'events-column');
    const canvasBefore = (await page.locator('#biome-canvas').boundingBox()).width;

    await dragHandle(page, 'events-column', 120);

    await expect.poll(() => width(page, 'events-column')).toBeGreaterThan(before + 80);
    // The canvas is re-fitted to the wrapper (a ResizeObserver, since no window
    // resize fires), so the grid does not keep drawing at its old size.
    await expect.poll(async () => (await page.locator('#biome-canvas').boundingBox()).width).toBeLessThan(canvasBefore);
  });

  test('the two right-hand columns widen leftward', async ({ appPage: page }) => {
    for (const id of ['population-column', 'sidebar']) {
      const before = await width(page, id);
      await dragHandle(page, id, -100);
      await expect.poll(() => width(page, id)).toBeGreaterThan(before + 60);
    }
  });

  test('a column cannot be dragged below its default, which is its minimum', async ({ appPage: page }) => {
    const before = await width(page, 'sidebar');
    await dragHandle(page, 'sidebar', 200); // toward the sidebar: narrower
    expect(await width(page, 'sidebar')).toBe(before);
  });

  test('the handle is a focusable separator that arrow keys move', async ({ appPage: page }) => {
    // Every other control here has a keyboard path — panning, zoom, speed,
    // follow — so a column edge only a mouse can move would be the exception.
    const handle = page.locator('.col-resizer[data-resize="events-column"]');
    const before = await width(page, 'events-column');
    await handle.focus();
    await expect(handle).toHaveAttribute('aria-valuenow', String(Math.round(before)));

    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => width(page, 'events-column')).toBeGreaterThan(before);
    await expect(handle).not.toHaveAttribute('aria-valuenow', String(Math.round(before)));

    await page.keyboard.press('Home');
    await expect.poll(() => width(page, 'events-column')).toBe(before);
  });

  test('a width survives a reload, and a double-click on the handle resets it', async ({ appPage: page }) => {
    const before = await width(page, 'events-column');
    await dragHandle(page, 'events-column', 120);
    const widened = await width(page, 'events-column');

    await page.reload({ waitUntil: 'load' });
    await waitForRender(page);
    expect(Math.abs((await width(page, 'events-column')) - widened)).toBeLessThan(2);

    await page.locator('.col-resizer[data-resize="events-column"]').dblclick();
    await expect.poll(() => width(page, 'events-column')).toBe(before);
  });
});
