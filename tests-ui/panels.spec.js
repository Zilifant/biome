import { test, expect, waitForRender } from './helpers/app.js';

// A representative body element per panel, hidden when the panel is collapsed.
const PANELS = [
  { id: 'controls-panel', body: '#ctl-run' },
  { id: 'metrics-panel', body: '#metrics-panel .hint' },
  { id: 'event-log-panel', body: '#event-log-list' },
];

test.describe('minimizable panels', () => {
  for (const { id, body } of PANELS) {
    test(`#${id} collapses and restores on header click`, async ({ appPage: page }) => {
      const section = page.locator(`#${id}`);
      const header = section.locator('h2');

      await expect(section).not.toHaveClass(/collapsed/);
      await expect(page.locator(body)).toBeVisible();

      await header.click();
      await expect(section).toHaveClass(/collapsed/);
      await expect(page.locator(body)).toBeHidden();

      await header.click();
      await expect(section).not.toHaveClass(/collapsed/);
      await expect(page.locator(body)).toBeVisible();
    });
  }

  test('the header marker flips between "-" (open) and "+" (collapsed)', async ({ appPage: page }) => {
    const marker = () =>
      page.evaluate(() => getComputedStyle(document.querySelector('#controls-panel h2'), '::before').content);

    expect(await marker()).toContain('-');
    await page.locator('#controls-panel h2').click();
    expect(await marker()).toContain('+');
  });

  test('a collapsed panel stays collapsed across a reload (localStorage)', async ({ appPage: page }) => {
    await page.locator('#metrics-panel h2').click();
    await expect(page.locator('#metrics-panel')).toHaveClass(/collapsed/);

    await page.reload({ waitUntil: 'load' });
    await waitForRender(page);

    await expect(page.locator('#metrics-panel')).toHaveClass(/collapsed/);
  });
});
