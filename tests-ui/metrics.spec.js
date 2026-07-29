import { test, expect, MOCK_SPECIES } from './helpers/app.js';

/**
 * The metrics panel renders one collapsible `<details>` per species. That has to
 * survive the panel rewriting its whole `innerHTML` on every poll — which is the
 * failure mode R3 records for the inspector and P9 records as the reason
 * `<details>` behaviour is worth driving in a real browser rather than reviewing.
 *
 * These run in mocked live mode: fixture mode has no `http`, so the panel is
 * empty offline (P6/E3).
 */
test.describe('per-species metrics sections', () => {
  const sections = (page) => page.locator('#metrics-panel details[data-species]');

  test('one collapsed section per species, each showing its grid glyph and count', async ({ live: { page } }) => {
    await expect(sections(page)).toHaveCount(MOCK_SPECIES.length);
    for (const speciesId of MOCK_SPECIES) {
      const section = page.locator(`#metrics-panel details[data-species="${speciesId}"]`);
      // Collapsed by default: at ten species an expanded sidebar is unusable.
      await expect(section).not.toHaveAttribute('open', /.*/);
      await expect(section.locator('.metrics-glyph')).toBeVisible();
      await expect(section.locator('.section-badge')).toContainText('alive');
      // The body exists but is hidden until the section is opened.
      await expect(section.locator('.section-body')).toBeHidden();
    }
  });

  test('an expanded section survives the panel rebuilding itself on the next poll', async ({ live: { page } }) => {
    const section = sections(page).first();
    await section.locator('summary').click();
    await expect(section.locator('.section-body')).toBeVisible();

    // Mark the current element, then wait for the poll to replace it. The mark
    // vanishing is what proves the panel really did rebuild rather than the
    // assertion passing on a stale DOM node.
    await page.evaluate(() => document.querySelector('#metrics-panel details').setAttribute('data-rebuilt-check', '1'));
    await expect(page.locator('#metrics-panel details[data-rebuilt-check]')).toHaveCount(0, { timeout: 10_000 });

    await expect(sections(page).first().locator('.section-body')).toBeVisible();
    // And the toggle still works afterwards, which a listener lost to the
    // rewrite would not — the listener is on the container for that reason.
    await sections(page).first().locator('summary').click();
    await expect(sections(page).first().locator('.section-body')).toBeHidden();
  });

  test('what a viewer expanded is remembered across a reload', async ({ live: { page } }) => {
    const speciesId = MOCK_SPECIES[1];
    await page.locator(`#metrics-panel details[data-species="${speciesId}"] summary`).click();
    await expect(page.locator(`#metrics-panel details[data-species="${speciesId}"] .section-body`)).toBeVisible();

    await page.reload({ waitUntil: 'load' });

    await expect(page.locator(`#metrics-panel details[data-species="${speciesId}"] .section-body`)).toBeVisible();
    // Only that one — the open-set is a set, not a global "expand everything".
    await expect(page.locator(`#metrics-panel details[data-species="${MOCK_SPECIES[0]}"] .section-body`)).toBeHidden();
  });
});
