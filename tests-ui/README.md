# Renderer UI tests (Playwright)

Browser-level tests for the ASCII renderer — layout, panels, grid interaction,
and accessibility. Separate from the engine's `node --test` suite (`npm test`);
this is a different runner with different concerns.

```bash
npm run test:ui           # run headless
npm run test:ui:headed    # watch it in a real window
npm run test:ui:report    # open the last HTML report
```

## How it runs offline, with no per-run permissions

Two constraints shaped the setup, both from the command sandbox:

1. **No web server.** The sandbox forbids binding a port, so there is no dev
   server. `helpers/serveApp.js` fulfils every request from disk via Playwright
   request interception, mirroring `src/server/createServer.js`'s static mounts
   (`/renderer/* → src/renderer/*`, `/ → public/index.html`). The app is driven
   in **fixture mode** (`?mode=fixture`), which replays the committed JSON
   fixtures and needs no live backend.
2. **Single-process Chromium.** Multi-process Chromium can't register its macOS
   Mach rendezvous service inside the sandbox and dies on launch, so the browser
   runs with `--single-process` (see `LAUNCH_OPTIONS` in `helpers/serveApp.js`).
   That mode is officially discouraged and is *intermittently stillborn* under
   the sandbox, so `helpers/app.js` launches a fresh browser per test and
   **retries the whole launch+render** until one comes up healthy; a single
   browser reliably serves exactly one context+page, so tests never share one.

The upshot: `npm run test:ui` runs entirely inside the sandbox, so it is
auto-allowed and prompts for nothing.

_Fallback:_ if single-process ever proves too flaky, set
`"sandbox": { "enabled": false }` in `.claude/settings.json` and drop the
`--single-process` arg — standard multi-process Chromium is rock-solid but runs
unsandboxed.

## Writing a test

Use the `appPage` fixture — a page already booted in fixture mode and painted:

```js
import { test, expect } from './helpers/app.js';

test('…', async ({ appPage: page }) => {
  await expect(page.locator('#events-column')).toBeVisible();
});
```

### Asserting on the canvas

The grid is a `<canvas>`, invisible to DOM queries, so read pixels with
`readRegion` + `countColor` (from `helpers/app.js`). `COLORS` holds the Dracula
tokens the renderer draws with. Prefer **relative** checks (a region changed
after an action, or a colour's pixel count rose) over exact single-pixel matches
— antialiasing makes exact matches brittle, and some Dracula greys sit close
together (use a tight tolerance when matching the selection grey).

## Fixtures and determinism

State comes from the committed renderer fixtures
(`src/renderer/fixtures/*.json`), regenerated with `npm run fixtures:renderer`.
Tests assert on shape and behaviour, not exact counts, so a fixture regen does
not break them. Viewport and device-scale are pinned in the config for stable
geometry and pixel reads.

## Accessibility

`accessibility.spec.js` runs axe-core and fails on any serious/critical
violation **except `color-contrast`**, which is disabled: the Dracula `comment`
token (dimmed secondary text) is ~3.35:1 on the dark background across the whole
theme. That is a real, pre-existing shortcoming worth its own pass, not a
per-panel regression — everything else axe flags still fails the suite.

## Artifacts

`test-results/`, `playwright-report/`, and `blob-report/` are git-ignored.
Any committed visual baselines would live under `tests-ui/**/-snapshots/`.
