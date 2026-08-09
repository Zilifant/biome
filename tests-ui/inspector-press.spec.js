import { test, expect } from './helpers/app.js';

/**
 * The inspector must not rewrite itself while a finger is down on it.
 *
 * ⚠ **This is a browser test because the bug only exists in a browser.** A
 * `click` is dispatched only when the press and the release land on the *same
 * node*; this panel rewrites its own container on every render, and at speed
 * that lands inside the ~100 ms a human click takes. Measured against a live
 * host on 2026-08-09 at 32×: the browser dispatched `pointerdown` and
 * `pointerup` on the button and **no `click` at all** — so the panel silently
 * stopped answering the mouse, and only the mouse. Nothing in a node test can
 * see that: every function involved is correct, no exception is thrown, and the
 * DOM ends up exactly as it should. What is missing is an *event*.
 *
 * The guard is written against the mechanism rather than the symptom — the
 * panel's markup must be **byte-identical across a held press** — because
 * reproducing the symptom needs a structural rebuild to land inside the press,
 * which is a race and would make the test flaky in both directions.
 */
test.describe('the inspector holds still while it is being clicked', () => {
  /** Select a cell that has an animal on it, so the panel has live rows. */
  const selectSomething = async (page) => {
    const refs = page.locator('#event-log-list [data-entity]');
    await expect(refs.first()).toBeVisible();
    for (let i = 0; i < Math.min(await refs.count(), 6); i += 1) {
      await refs.nth(i).click();
      if ((await page.locator('#inspector-column .dock-body [data-live]').count()) > 0) return true;
    }
    return false;
  };

  test('⚠⚠ a held press freezes the panel, and releasing it lets the panel catch up', async ({ appPage: page }) => {
    expect(await selectSomething(page), 'needed a selection with live fields').toBe(true);
    const body = page.locator('#inspector-column .dock-body');
    const markup = () => body.innerHTML();

    // Press and hold on the panel, then push the world along underneath it.
    const box = await body.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    // ⚠ `finally`, and it is not ceremony: a failed assertion between `down` and
    // `up` leaves the browser with a button held for the rest of the run, and
    // the symptom is a *teardown* timeout in whatever test comes next — which
    // reads as a flaky harness rather than as this test failing.
    let after;
    let held;
    await page.mouse.down();
    try {
      held = await markup();
      for (let i = 0; i < 5; i += 1) {
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await page.waitForTimeout(40);
      }
      after = await markup();
    } finally {
      await page.mouse.up();
    }
    expect(after, 'the panel rewrote itself under a held press').toBe(held);

    // And the deferral must not become a freeze: the panel is live again after.
    await page.waitForTimeout(100);
    await expect(body.locator('[data-live]').first()).toBeVisible();
  });

  test('a press released outside the panel still unfreezes it', async ({ appPage: page }) => {
    // The release listens on the document for exactly this: a press that ends
    // over the map still ends, and a panel left frozen would never update again.
    expect(await selectSomething(page), 'needed a selection with live fields').toBe(true);
    const body = page.locator('#inspector-column .dock-body');
    const box = await body.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    const canvas = await page.locator('#biome-canvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(100);
    // Still mounted, still rendering — the flag was cleared by the document.
    await expect(body.locator('[data-live]').first()).toBeVisible();
  });

  test('⚠⚠ a section opened stays open when the panel rebuilds under it', async ({ appPage: page }) => {
    // A second, separate failure from the lost click, and it survived the first
    // fix: a `<details>` is opened by the browser as the click's default action,
    // and the `toggle` event that reports it is **asynchronous**. Above ~4× a
    // rebuild lands first, replaces the element, and recreates it from an
    // open-set nothing has updated — measured 2026-08-09 at 8× and 32×, the
    // sequence is `click` → rebuild → rebuild… with **no `toggle` at all**, and
    // the section snaps shut the moment it is opened.
    //
    // The guard is that a rebuild preserves what the panel is *showing*: open a
    // section, force structural rebuilds, and it must still be open.
    expect(await selectSomething(page), 'needed a selection with live fields').toBe(true);
    const details = page.locator('#inspector-column details[data-section]').first();
    const wasOpen = await details.evaluate((el) => el.open);
    await details.locator('summary').click();
    await expect
      .poll(async () => details.evaluate((el) => el.open))
      .toBe(!wasOpen);

    // Now make the panel rebuild itself several times over.
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(50);
    }
    expect(await details.evaluate((el) => el.open), 'a rebuild reverted the section').toBe(!wasOpen);
  });

  test('clicking a control inside the panel takes effect', async ({ appPage: page }) => {
    // The symptom itself, at fixture pace: Follow toggles its own label, so the
    // effect is visible without reaching for the host.
    expect(await selectSomething(page), 'needed a selection with live fields').toBe(true);
    const follow = page.locator('#inspector-column [data-action="follow"]');
    if ((await follow.count()) === 0) test.skip(true, 'this selection has no active occupant to follow');
    const before = await follow.textContent();
    await follow.click();
    await expect(follow).not.toHaveText(before);
  });
});
