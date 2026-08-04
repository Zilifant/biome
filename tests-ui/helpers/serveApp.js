/**
 * Offline app server for Playwright, via request interception — no HTTP server,
 * no port bind (which the command sandbox forbids anyway). Every request to the
 * test origin is fulfilled from the repo on disk, mirroring the static mounts in
 * `src/server/createServer.js`:
 *
 *   /renderer/<path>  →  src/renderer/<path>
 *   /                 →  public/index.html
 *   /<path>           →  public/<path>
 *
 * The app is exercised in fixture mode (`?mode=fixture`), which reads the
 * committed JSON fixtures and needs no live backend — so nothing here touches
 * `/api` or `/ws`. A live-mode bridge (real engine in-process) is a later phase.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The fake origin the app is served from. Kept off any real TLD. */
export const APP_HOST = 'app.test';
export const APP_ORIGIN = `http://${APP_HOST}`;

/**
 * Chromium launch options that run under the command sandbox. `--single-process`
 * is the essential one (multi-process Chromium can't register its Mach service
 * and dies on launch); the rest keep it headless-friendly. Shared by the config
 * and the per-test browser fixture so there is one source of truth.
 */
export const LAUNCH_OPTIONS = Object.freeze({
  chromiumSandbox: false,
  args: ['--single-process', '--no-sandbox', '--disable-gpu'],
  // Some sandboxes provide a system Chromium instead of Playwright's own
  // download (e.g. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD environments). Point
  // PW_CHROMIUM_EXECUTABLE at it to use it; unset, Playwright resolves its
  // managed browser as usual.
  ...(process.env.PW_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
    : {}),
});

// ES modules must be served with a JS MIME type or the browser refuses to run
// them; the rest match what a static file server would send.
const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/**
 * Map a URL pathname to the file on disk that `createServer` would serve.
 * @param {string} pathname
 * @param {string} [root]
 * @returns {string} absolute file path
 */
export function resolveStaticFile(pathname, root = REPO_ROOT) {
  const clean = decodeURIComponent(pathname.split('?')[0].split('#')[0]);
  if (clean === '/' || clean === '') return path.join(root, 'public', 'index.html');
  if (clean.startsWith('/renderer/')) return path.join(root, 'src', clean.slice('/'.length));
  return path.join(root, 'public', clean.slice('/'.length));
}

/**
 * Install the interception route on a Playwright browser context. All requests
 * to APP_HOST are served from disk; anything else is left alone (there should be
 * nothing else in fixture mode).
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{root?: string}} [options]
 */
export async function installAppRoutes(context, { root = REPO_ROOT } = {}) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== APP_HOST) {
      await route.continue();
      return;
    }
    const file = resolveStaticFile(url.pathname, root);
    try {
      const body = await readFile(file);
      await route.fulfill({
        status: 200,
        contentType: MIME_BY_EXT[path.extname(file)] ?? 'application/octet-stream',
        body,
      });
    } catch {
      await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
    }
  });
}
