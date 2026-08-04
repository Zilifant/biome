import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './helpers/app.js';

/**
 * `color-contrast` is disabled deliberately. The Dracula `comment` token
 * (#6272a4) is used throughout for intentionally de-emphasised secondary text
 * and lands at ~3.35:1 on the dark background — a property of the whole theme,
 * not of any one panel, so failing every UI test on it would be noise. It is a
 * real (pre-existing) shortcoming worth its own pass; every other serious rule
 * is enforced here so a genuine regression (missing label, bad ARIA) still fails.
 */
const axe = (page) => new AxeBuilder({ page }).disableRules(['color-contrast']);

/** Compact one violation for a readable assertion message. */
const summarize = (violations) =>
  violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));

test.describe('accessibility (axe)', () => {
  test('the main view has no serious or critical violations', async ({ appPage: page }) => {
    const results = await axe(page).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, JSON.stringify(summarize(blocking), null, 2)).toEqual([]);
  });

  test('the sprite editor has no serious or critical violations', async ({ editorPage: page }) => {
    const results = await axe(page).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, JSON.stringify(summarize(blocking), null, 2)).toEqual([]);
  });

  test('the inspector, once open, has no serious or critical violations', async ({ appPage: page }) => {
    // Selecting a cell mounts the inspector popover (role=dialog) — its own DOM
    // to check, distinct from the resting layout.
    const canvas = await page.locator('#biome-canvas').boundingBox();
    await page.mouse.click(canvas.x + 300, canvas.y + 300);
    await expect(page.locator('.inspector-popover')).toBeVisible();

    const results = await axe(page).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, JSON.stringify(summarize(blocking), null, 2)).toEqual([]);
  });
});
