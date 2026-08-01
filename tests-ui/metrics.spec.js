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

/**
 * The population sparkline sits on its own line under the species name, inside
 * the `<summary>` so it survives the section being collapsed — and it is sized
 * to the column rather than to the history's length.
 *
 * ⚠ This is the bug it exists for: a sparkline is one character per sample, so
 * 120 samples is 120 unbreakable columns in a 300px panel. It ran past the
 * edge, took the species name and the living count with it, and got worse every
 * time the column was narrowed. Only a browser can answer whether it fits.
 */
test.describe('the population sparkline fits its column', () => {
  const trend = (page) => page.locator('#metrics-panel details[data-species] .metrics-trend').first();

  test('it is on its own line under the name, and stays when the section collapses', async ({ live: { page } }) => {
    const section = page.locator('#metrics-panel details[data-species]').first();
    await expect(trend(page)).toBeVisible();
    await expect(section).not.toHaveAttribute('open', /.*/);

    // Its own line: below the name, and starting at the left edge rather than
    // beside it.
    const name = await section.locator('.section-title').boundingBox();
    const chart = await trend(page).boundingBox();
    expect(chart.y).toBeGreaterThan(name.y);
    expect(chart.x).toBeLessThanOrEqual(name.x);

    // And still there expanded, where the detail rows are.
    await section.locator('summary').click();
    await expect(trend(page)).toBeVisible();
  });

  test('it never runs past the column, at any width', async ({ live: { page } }) => {
    // ⚠ Measured as **content** against the box, not box against panel. The
    // element is `overflow: hidden`, so its bounding box fits the column no
    // matter how long the chart inside it is — an assertion on the box passes
    // just as happily with a 120-character chart clipped at the edge, which is
    // exactly the bug. `scrollWidth > clientWidth` is the state that says
    // something was cut off.
    const fits = async () =>
      trend(page).evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(await fits(), 'fits at the default width').toBe(true);

    // Widen the column, then narrow it back to its minimum. The chart is
    // re-rendered from the same history each time.
    // ⚠ The handle is re-measured per drag: widening the column *moves* it, so
    // a cached position aims the second drag at empty space — and the test then
    // reports "the chart did not contract" when nothing was ever dragged.
    const drag = async (dx) => {
      const handle = await page.locator('.col-resizer[data-resize="population-column"]').boundingBox();
      const y = handle.y + handle.height / 2;
      await page.mouse.move(handle.x + 3, y);
      await page.mouse.down();
      await page.mouse.move(handle.x + 3 + dx / 2, y);
      await page.mouse.move(handle.x + 3 + dx, y);
      await page.mouse.up();
    };
    await drag(-260);
    await expect.poll(fits, { timeout: 4000 }).toBe(true);
    const wide = (await trend(page).boundingBox()).width;

    await drag(400); // back to the minimum
    await expect.poll(fits, { timeout: 4000 }).toBe(true);
    expect((await trend(page).boundingBox()).width, 'the chart contracted with the column').toBeLessThan(wide);
  });
});
