import { test, expect, waitForRender } from './helpers/app.js';

/**
 * The event feed's filters: one checkbox per event type, folded away by default
 * because the list is as long as the protocol's event vocabulary. What matters
 * here is what a viewer sees before touching anything (births and deaths, and a
 * closed list), and that ticking a box actually changes the feed and is
 * remembered.
 *
 * ⚠ **The fixtures used to contain no births or deaths at all**, and this suite
 * relied on the default feed being *empty* offline. Batch 3 (2026-07-30) ended
 * that: eight species and 24% more animals means something dies inside the
 * fixture's warm-up. Nothing about the filters changed — the assumption was about
 * the data, so it is now stated as a property of the feed (every visible row is a
 * ticked type) rather than as a count that happened to be zero.
 */
test.describe('event feed filters', () => {
  const filters = '#event-log-filters';

  test('the filter list starts minimized, showing births and deaths', async ({ appPage: page }) => {
    await expect(page.locator(filters)).not.toHaveAttribute('open', /.*/);
    await expect(page.locator('#event-log-filter-count')).toHaveText(/^2 of \d+$/);

    await page.locator(`${filters} > summary`).click();
    await expect(page.locator('input[data-event-type="entity.born"]')).toBeChecked();
    await expect(page.locator('input[data-event-type="entity.died"]')).toBeChecked();
    await expect(page.locator('input[data-event-type="entity.moved"]')).not.toBeChecked();
  });

  test('ticking a type shows exactly that type, and only it', async ({ appPage: page }) => {
    // The default two types are births and deaths, so whatever is on screen before
    // anything is touched must be one of those — a handful of lines in the current
    // fixtures, and none at all in the ones this suite was written against.
    for (const text of await page.locator('#event-log-list li').allTextContents()) {
      expect(text, 'the default feed is births and deaths').toMatch(/born|died/);
    }

    await page.locator(`${filters} > summary`).click();
    await page.locator('input[data-event-type="entity.born"]').uncheck();
    await page.locator('input[data-event-type="entity.died"]').uncheck();
    await page.locator('input[data-event-type="entity.moved"]').check();

    const lines = page.locator('#event-log-list li');
    await expect(lines.first()).toBeVisible();
    for (const text of await lines.allTextContents()) {
      expect(text, 'only the ticked type may appear').toContain('moved');
    }
  });

  test('the choice survives a reload', async ({ appPage: page }) => {
    await page.locator(`${filters} > summary`).click();
    await page.locator('#event-log-none').click();
    await expect(page.locator('#event-log-filter-count')).toHaveText('nothing');
    await page.locator('input[data-event-type="entity.created"]').check();

    await page.reload({ waitUntil: 'load' });
    await waitForRender(page);

    await expect(page.locator('#event-log-filter-count')).toHaveText(/^1 of \d+$/);
    // Closed again on load: the list is long, and reopening it is one click.
    await expect(page.locator(filters)).not.toHaveAttribute('open', /.*/);
    await expect(page.locator('#event-log-list li').first()).toContainText('created');
  });

  test('"all" and "births & deaths" set the whole list at once', async ({ appPage: page }) => {
    await page.locator(`${filters} > summary`).click();
    const boxes = page.locator('input[data-event-type]');
    const total = await boxes.count();

    await page.locator('#event-log-all').click();
    await expect(page.locator('#event-log-filter-count')).toHaveText(`${total} of ${total}`);
    await expect(page.locator('input[data-event-type="entity.moved"]')).toBeChecked();

    await page.locator('#event-log-default').click();
    await expect(page.locator('#event-log-filter-count')).toHaveText(`2 of ${total}`);
    await expect(page.locator('input[data-event-type="entity.born"]')).toBeChecked();
    await expect(page.locator('input[data-event-type="entity.moved"]')).not.toBeChecked();
  });
});
