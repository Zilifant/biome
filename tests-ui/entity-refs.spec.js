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

    // Show every event type, so the log reliably contains entity-id refs — the
    // default filter is births and deaths, which a short run may not produce.
    await page.locator('#event-log-filters > summary').click();
    await page.locator('#event-log-all').click();
    const refs = page.locator('#event-log-list [data-entity]');
    await expect(refs.first()).toBeVisible();

    // Click a handful; at least one references an entity that is in view and must
    // open the inspector, and none may throw.
    // ⚠ The inspector docks by default, so "did it open" is about the docked
    // column now — the popover only appears when a viewer asks it to float.
    const count = Math.min(await refs.count(), 5);
    let inspectorOpened = false;
    for (let i = 0; i < count; i += 1) {
      await refs.nth(i).click();
      if ((await page.locator('#inspector-column .dock-body details[data-section]').count()) > 0) inspectorOpened = true;
    }

    expect(errors).toEqual([]);
    expect(inspectorOpened, 'clicking an in-view entity id should open the inspector').toBe(true);
  });

  /**
   * A reference in the event log wears the animal's own glyph and colour, so a
   * line says what it is about before you read it. ⚠ The colour rides on a
   * custom property rather than an inline `color`, because an inline
   * declaration would outrank the `:hover` rule and kill the cyan hover — which
   * is a CSS cascade question, and therefore only answerable in a browser.
   */
  test('a reference is drawn in its species colour and still turns cyan on hover', async ({ appPage: page }) => {
    await page.locator('#event-log-filters > summary').click();
    await page.locator('#event-log-all').click();
    const ref = page.locator('#event-log-list [data-entity]').first();
    await expect(ref).toBeVisible();

    // The glyph replaces the `#`, so the label is `<glyph><id>` — never `#123`.
    await expect(ref).toHaveText(/^[A-Za-z%?][0-9]+$/);
    const resting = await ref.evaluate((el) => getComputedStyle(el).color);
    expect(resting, 'a reference is not drawn in the default cyan').not.toBe('rgb(139, 233, 253)');

    await ref.hover();
    await expect
      .poll(() => ref.evaluate((el) => getComputedStyle(el).textDecorationLine))
      .toBe('underline');
    expect(await ref.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(164, 255, 255)'); // bright-cyan
  });
});
