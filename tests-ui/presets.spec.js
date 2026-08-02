/**
 * World presets in the restart panel.
 *
 * These run in mocked live mode against a small in-memory preset host, because
 * the thing worth testing is the *round trip*: that saving sends the fields the
 * panel actually holds, and that loading puts them back. A fixture-mode test
 * could only assert that the controls exist.
 *
 * ⚠ The panel deliberately does **not** restart on load — it fills the fields
 * and waits for Restart — so the last test here asserts the absence of a
 * command, which is the whole safety property of the design.
 */
import { test, expect, gotoLive, MOCK_SPECIES } from './helpers/app.js';

/**
 * Serve `/api/presets*` from an in-memory map. Registered *after* `gotoLive`, so
 * it takes precedence over that helper's catch-all for every later request.
 * @returns {Promise<Map<string, object>>} the store, so a test can inspect it
 */
async function installPresetHost(page) {
  const stored = new Map();
  const json = (body, status = 200) => ({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
  const slugOf = (name) =>
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  await page.route('**/api/presets**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const match = pathname.match(/\/api\/presets\/(.+)$/);
    const slug = match ? decodeURIComponent(match[1]) : null;

    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      const record = { name: body.name, slug: slugOf(body.name), savedAt: '2026-08-02T00:00:00.000Z', world: body.world };
      stored.set(record.slug, record);
      await route.fulfill(json({ ok: true, preset: record }));
      return;
    }
    if (request.method() === 'DELETE') {
      const removed = stored.delete(slug);
      await route.fulfill(json({ ok: true, removed }));
      return;
    }
    if (slug) {
      const found = stored.get(slug);
      await route.fulfill(
        found
          ? json({ ok: true, preset: found })
          : json({ ok: false, error: { code: 'preset-not-found', message: `no preset named "${slug}"` } }, 404),
      );
      return;
    }
    await route.fulfill(json({ ok: true, presets: [...stored.values()] }));
  });
  return stored;
}

/** Open the restart section, which ships collapsed. */
async function openRestart(page) {
  const details = page.locator('#ctl-restart-panel, details:has(#ctl-world-w)').first();
  if ((await details.count()) > 0 && !(await details.evaluate((node) => node.open))) {
    await details.locator('summary').first().click();
  }
}

test.describe('world presets', () => {
  test('the preset controls are present and labelled', async ({ appPage: page }) => {
    await openRestart(page);
    await expect(page.locator('#ctl-preset')).toBeAttached();
    await expect(page.locator('#ctl-preset-name')).toBeAttached();
    for (const id of ['#ctl-preset-save', '#ctl-preset-load', '#ctl-preset-delete']) {
      await expect(page.locator(id)).toBeAttached();
    }
    // With no host behind it (fixture mode) the dropdown says so rather than
    // showing an error — the startup listing is deliberately quiet.
    await expect(page.locator('#ctl-preset')).toHaveText(/none saved/);
  });

  test('saving sends the panel\'s own fields, and the preset appears in the list', async ({ appPage: page }) => {
    await gotoLive(page);
    const stored = await installPresetHost(page);
    await openRestart(page);

    await page.fill('#ctl-world-w', '96');
    await page.fill('#ctl-world-h', '64');
    await page.selectOption('#ctl-roundness', '4');
    await page.fill('#ctl-seed', '1234');
    await page.fill(`#ctl-founding-${MOCK_SPECIES[0].replace(/[^a-zA-Z0-9]+/g, '-')}`, '7');

    await page.fill('#ctl-preset-name', 'My Island');
    await page.click('#ctl-preset-save');

    await expect(page.locator('#ctl-preset option')).toHaveText(['My Island']);
    expect(stored.size).toBe(1);
    const saved = stored.get('my-island');
    expect(saved.world.width).toBe(96);
    expect(saved.world.height).toBe(64);
    expect(saved.world.roundness).toBe(4);
    expect(saved.world.seed).toBe(1234);
    expect(saved.world.founding).toContainEqual({ speciesId: MOCK_SPECIES[0], count: 7 });
  });

  test('loading puts every field back, including a founder count changed since', async ({ appPage: page }) => {
    await gotoLive(page);
    await installPresetHost(page);
    await openRestart(page);

    const grazerField = `#ctl-founding-${MOCK_SPECIES[0].replace(/[^a-zA-Z0-9]+/g, '-')}`;
    await page.fill('#ctl-world-w', '96');
    await page.selectOption('#ctl-roundness', '3');
    await page.fill(grazerField, '11');
    await page.fill('#ctl-preset-name', 'Saved World');
    await page.click('#ctl-preset-save');
    await expect(page.locator('#ctl-preset option')).toHaveText(['Saved World']);

    // Move everything away from what was saved.
    await page.fill('#ctl-world-w', '512');
    await page.selectOption('#ctl-roundness', '0');
    await page.fill(grazerField, '999');

    await page.click('#ctl-preset-load');
    await expect(page.locator('#ctl-world-w')).toHaveValue('96');
    await expect(page.locator('#ctl-roundness')).toHaveValue('3');
    await expect(page.locator(grazerField)).toHaveValue('11');
  });

  test('⚠ loading fills the fields but never rebuilds the world on its own', async ({ appPage: page }) => {
    const { commands } = await gotoLive(page);
    await installPresetHost(page);
    await openRestart(page);

    await page.fill('#ctl-preset-name', 'Quiet');
    await page.click('#ctl-preset-save');
    await expect(page.locator('#ctl-preset option')).toHaveText(['Quiet']);

    const before = commands.filter((command) => command?.type === 'simulation.restart').length;
    await page.click('#ctl-preset-load');
    await expect(page.locator('#ctl-preset-name')).toHaveValue('Quiet');
    const after = commands.filter((command) => command?.type === 'simulation.restart').length;
    expect(after).toBe(before);

    // ...and Restart still works, sending exactly one.
    await page.click('#ctl-restart');
    await expect
      .poll(() => commands.filter((command) => command?.type === 'simulation.restart').length)
      .toBe(before + 1);
  });

  test('deleting removes it from the list', async ({ appPage: page }) => {
    await gotoLive(page);
    const stored = await installPresetHost(page);
    await openRestart(page);

    await page.fill('#ctl-preset-name', 'Disposable');
    await page.click('#ctl-preset-save');
    await expect(page.locator('#ctl-preset option')).toHaveText(['Disposable']);

    await page.click('#ctl-preset-delete');
    await expect(page.locator('#ctl-preset')).toHaveText(/none saved/);
    expect(stored.size).toBe(0);
  });
});
