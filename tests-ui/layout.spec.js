import { test, expect, waitForRender } from './helpers/app.js';

test.describe('layout', () => {
  test('five columns, left to right: events, inspector, grid, population, sidebar', async ({ appPage: page }) => {
    // The event log has its own column on the left; population moved out of the
    // sidebar into a column of its own between the grid and the sidebar; and the
    // inspector (2026-08-09) got the mirror of that on the left.
    await expect(page.locator('#events-column #event-log-panel')).toHaveCount(1);
    await expect(page.locator('#sidebar #event-log-panel')).toHaveCount(0);
    await expect(page.locator('#population-column #metrics-panel')).toHaveCount(1);
    await expect(page.locator('#sidebar #metrics-panel')).toHaveCount(0);
    await expect(page.locator('#inspector-column #inspector-panel')).toHaveCount(1);
    await expect(page.locator('#sidebar #inspector-panel')).toHaveCount(0);

    const events = await page.locator('#events-column').boundingBox();
    const inspector = await page.locator('#inspector-column').boundingBox();
    const canvas = await page.locator('#biome-canvas').boundingBox();
    const population = await page.locator('#population-column').boundingBox();
    const sidebar = await page.locator('#sidebar').boundingBox();
    expect(events.x).toBeLessThan(inspector.x);
    expect(inspector.x).toBeLessThan(canvas.x);
    expect(canvas.x).toBeLessThan(population.x);
    expect(population.x).toBeLessThan(sidebar.x);
  });

  test('the sidebar holds controls and the legend', async ({ appPage: page }) => {
    for (const id of ['controls-panel', 'legend-panel']) {
      await expect(page.locator(`#sidebar #${id}`)).toHaveCount(1);
    }
  });

  test('⚠ the inspector starts docked, and floating it gives the grid the room back', async ({ appPage: page }) => {
    // Docked is the default since 2026-08-09: the panel is read while the world
    // runs, and floating it puts it over the very thing it describes. Floating
    // must **collapse the track**, not merely hide the aside — a hidden grid
    // item still holds its column open, which would leave a dead gutter.
    const column = page.locator('#inspector-column');
    await expect(column).toBeVisible();
    const gridBefore = (await page.locator('#viewport-wrap').boundingBox()).width;

    await page.locator('#inspector-column [data-panel="dock"]').click();
    await expect(column).toBeHidden();
    // ⚠ The popover is *not* asserted visible here: with nothing selected it is
    // correctly hidden, because visibility is derived from `store.selection`
    // rather than from a flag of the panel's own. Floating is about where the
    // panel lives; whether it is showing is a different question.
    const gridAfter = (await page.locator('#viewport-wrap').boundingBox()).width;
    expect(gridAfter).toBeGreaterThan(gridBefore + 100);
    // ⚠ The return trip is not asserted here, and that is a fact about the panel
    // rather than a gap: the popover — and so its dock button — is only shown
    // when something is selected, because visibility is derived from
    // `store.selection`. Re-docking is exercised where a selection exists.
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
