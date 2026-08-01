import { test, expect } from './helpers/app.js';

/**
 * Command-driven controls, tested in live mode against a mocked host (see the
 * `live` fixture). The renderer's job at this boundary is to emit the right
 * protocol command; `commands` records what it sent. This is the template for
 * testing any new control that steers the simulation.
 */
test.describe('controls send commands (live, mocked host)', () => {
  test('live mode renders a world and enables the controls', async ({ live: { page } }) => {
    await expect(page.locator('#status-mode')).toHaveText('LIVE');
    await expect(page.locator('#status-entities')).toHaveText(/^\d+$/);
    await expect(page.locator('#ctl-run')).toBeEnabled();
  });

  test('pausing sends simulation.pause', async ({ live: { page, commands } }) => {
    const before = commands.length;
    await page.locator('#ctl-run').click();
    await expect.poll(() => commands.slice(before).map((c) => c.type)).toContain('simulation.pause');
  });

  test('the speed ladder sends simulation.setSpeed with a higher multiplier', async ({ live: { page, commands } }) => {
    const before = commands.length;
    await page.locator('#ctl-faster').click();
    await expect.poll(() => commands.slice(before).find((c) => c.type === 'simulation.setSpeed')?.multiplier).toBeGreaterThan(1);
  });

  test('the founder fields are built from the roster the host publishes', async ({ live: { page } }) => {
    // ⚠ Protocol v29. The panel used to carry three hardcoded fields named for
    // roles; it now generates one per species from `/api/status`, so this
    // asserts the *source* of the fields rather than their existence — a panel
    // that hardcoded the same three would pass a mere presence check.
    const restartSection = page.locator('#controls-panel details').filter({ has: page.locator('#ctl-restart') });
    await restartSection.locator('summary').click();
    await expect(page.locator('#ctl-founding input[data-species]')).toHaveCount(3);
    await expect(page.locator('#ctl-founding-herbivore-gazelle')).toHaveValue('120');
    // Labelled from the renderer's own appearance registry, never from the host:
    // what to call a species is presentation.
    await expect(page.locator('#ctl-founding')).toContainText('gazelle');
    await expect(page.locator('#ctl-herbivores')).toHaveCount(0);
  });

  test('restart sends the seed, world size, and a founding roster', async ({ live: { page, commands } }) => {
    // The restart controls sit in a collapsed <details> — open it, then fill in
    // a distinctive world and submit.
    const restartSection = page.locator('#controls-panel details').filter({ has: page.locator('#ctl-restart') });
    await restartSection.locator('summary').click();
    await expect(page.locator('#ctl-founding input[data-species]')).toHaveCount(3);

    await page.locator('#ctl-seed').fill('7');
    await page.locator('#ctl-world-w').fill('200');
    await page.locator('#ctl-world-h').fill('150');
    await page.locator('#ctl-founding-herbivore-gazelle').fill('40');
    await page.locator('#ctl-founding-predator-leopard').fill('5');
    await page.locator('#ctl-founding-scavenger-vulture').fill('0');

    const before = commands.length;
    await page.locator('#ctl-restart').click();

    await expect.poll(() => commands.slice(before).find((c) => c.type === 'simulation.restart')).toMatchObject({
      type: 'simulation.restart',
      seed: 7,
      width: 200,
      height: 150,
      founding: [
        { speciesId: 'herbivore.gazelle', count: 40 },
        { speciesId: 'predator.leopard', count: 5 },
        { speciesId: 'scavenger.vulture', count: 0 },
      ],
    });
  });

  test('an out-of-range world size is refused client-side and sends nothing', async ({ live: { page, commands } }) => {
    const restartSection = page.locator('#controls-panel details').filter({ has: page.locator('#ctl-restart') });
    await restartSection.locator('summary').click();

    await page.locator('#ctl-world-w').fill('8'); // below the minimum

    const before = commands.length;
    await page.locator('#ctl-restart').click();

    await expect(page.locator('#command-status')).toContainText(/width/i);
    expect(commands.slice(before).some((c) => c.type === 'simulation.restart')).toBe(false);
  });
});

/**
 * The command line reports the command that is current. It lives in the status
 * bar rather than at the foot of the controls panel, where it was invisible
 * exactly when that panel was folded up — and it is cleared the moment another
 * command goes out, so it never captions a command that has been superseded.
 */
test.describe('the command status line', () => {
  test('it is in the status bar, not in the controls panel', async ({ live: { page } }) => {
    await expect(page.locator('#status-bar #command-status')).toHaveCount(1);
    await expect(page.locator('#controls-panel #command-status')).toHaveCount(0);
  });

  test('a command reports its result there', async ({ live: { page } }) => {
    await page.locator('#ctl-run').click();
    await expect(page.locator('#command-status')).toContainText(/simulation\.pause ok/);
  });

  test('the next command clears the last report before replacing it', async ({ live: { page } }) => {
    // A client-side refusal, which sends nothing and therefore cannot be
    // overwritten by a result — so if it is gone, it was *cleared*.
    const restartSection = page.locator('#controls-panel details').filter({ has: page.locator('#ctl-restart') });
    await restartSection.locator('summary').click();
    await page.locator('#ctl-world-w').fill('8');
    await page.locator('#ctl-restart').click();
    await expect(page.locator('#command-status')).toContainText(/width/i);

    await page.locator('#ctl-run').click();
    await expect(page.locator('#command-status')).not.toContainText(/width/i);
  });
});
