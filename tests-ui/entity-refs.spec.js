import { test, expect } from './helpers/app.js';

/**
 * Every `#123` in the event log and inspector is a button that selects and
 * centres that entity (RendererApp.selectEntity). Regression guard: that path
 * once threw `ReferenceError: worldCellOf is not defined` because the helper was
 * used but never imported, so clicking any in-view entity id crashed.
 */
test.describe('entity id references are navigable', () => {
  test('clicking an entity id in the event log selects it without throwing', async ({ appPage: page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // Show routine events too, so the log reliably contains entity-id refs
    // (moves and feeding both name the entity).
    await page.locator('#event-log-moves').check();
    const refs = page.locator('#event-log-list [data-entity]');
    await expect(refs.first()).toBeVisible();

    // Click a handful; at least one references an entity that is in view and must
    // open the inspector, and none may throw.
    const count = Math.min(await refs.count(), 5);
    let inspectorOpened = false;
    for (let i = 0; i < count; i += 1) {
      await refs.nth(i).click();
      if (await page.locator('.inspector-popover').isVisible()) inspectorOpened = true;
    }

    expect(errors).toEqual([]);
    expect(inspectorOpened, 'clicking an in-view entity id should open the inspector').toBe(true);
  });
});
