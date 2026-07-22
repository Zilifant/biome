import { defineConfig } from '@playwright/test';
import { APP_ORIGIN, LAUNCH_OPTIONS } from './tests-ui/helpers/serveApp.js';

/**
 * Renderer UI test suite. Runs entirely offline and entirely inside the command
 * sandbox:
 *
 *  - No web server. The app is served from disk by Playwright request
 *    interception (see tests-ui/helpers/serveApp.js), so nothing binds a port.
 *  - Chromium launches with `--single-process`, which is the one mode that runs
 *    under the macOS seatbelt sandbox (multi-process Chromium can't register its
 *    Mach rendezvous service and dies on launch). It is officially discouraged
 *    and mildly slower, but it renders this app faithfully; if a test ever proves
 *    flaky because of it, the fallback is to set `sandbox.enabled: false` for
 *    this project in .claude/settings.json and drop these args.
 *
 * Separate from `npm test` (the node:test engine suite) on purpose — different
 * runner, different concerns.
 */
export default defineConfig({
  testDir: './tests-ui',
  testMatch: '**/*.spec.js',
  // The single-process browser is not built to be shared across parallel
  // contexts, so keep the suite sequential.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Backstop for the rare case a single-process browser dies mid-test, after the
  // launch-time health check in tests-ui/helpers/app.js has already passed.
  retries: 2,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: APP_ORIGIN,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The suite launches its own per-test browser (see tests-ui/helpers/app.js),
    // because a single-process browser is unstable when reused across tests.
    // These options apply to any default browser use and document the choice.
    launchOptions: LAUNCH_OPTIONS,
  },
  projects: [{ name: 'chromium' }],
});
