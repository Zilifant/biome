import { test, expect, waitForRender } from './helpers/app.js';

/**
 * The event feed's filters: one checkbox per event type, folded away by default
 * because the list is as long as the protocol's event vocabulary. What matters
 * here is what a viewer sees before touching anything (births and deaths, and a
 * closed list), and that ticking a box actually changes the feed and is
 * remembered.
 *
 * The committed fixtures contain no births or deaths, which is why the default
 * feed is empty offline — a fact this suite relies on rather than works around.
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
    // Nothing in the fixtures is a birth or a death, so the default feed is empty.
    await expect(page.locator('#event-log-list li')).toHaveCount(0);

    await page.locator(`${filters} > summary`).click();
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
