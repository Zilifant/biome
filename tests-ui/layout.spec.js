import { test, expect } from './helpers/app.js';

test.describe('layout', () => {
  test('the event log has its own column, left of the grid and the sidebar', async ({ appPage: page }) => {
    // The event log moved out of the sidebar into a dedicated left column.
    await expect(page.locator('#events-column #event-log-panel')).toHaveCount(1);
    await expect(page.locator('#sidebar #event-log-panel')).toHaveCount(0);

    const events = await page.locator('#events-column').boundingBox();
    const canvas = await page.locator('#biome-canvas').boundingBox();
    const sidebar = await page.locator('#sidebar').boundingBox();
    expect(events.x).toBeLessThan(canvas.x);
    expect(canvas.x).toBeLessThan(sidebar.x);
  });

  test('the sidebar holds controls, legend, metrics, and the inspector dock', async ({ appPage: page }) => {
    for (const id of ['controls-panel', 'legend-panel', 'metrics-panel', 'inspector-panel']) {
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
