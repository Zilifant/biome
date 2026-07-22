/**
 * Shared Playwright fixture and helpers for the renderer UI suite.
 *
 * `test` extends the base test so every context serves the app from disk
 * (offline, no server) and an `appPage` fixture hands back a page already booted
 * in fixture mode and painted. Canvas assertions go through `readRegion` /
 * `countColor`, since a `<canvas>` grid is opaque to DOM queries — `getImageData`
 * is the only way to see what was actually drawn.
 */
import { test as base, expect, chromium } from '@playwright/test';
import { installAppRoutes, LAUNCH_OPTIONS, APP_ORIGIN } from './serveApp.js';

export { expect };

const CONTEXT_OPTIONS = {
  baseURL: APP_ORIGIN,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
};

/** True when an error is a single-process Chromium startup crash, not a test failure. */
function isBrowserCrash(error) {
  return /has been closed|Target (page|closed)|browserContext|crashed|Timeout .* exceeded/i.test(String(error?.message));
}

/**
 * Launch a single-process browser, open one context+page, and drive it all the
 * way to a rendered fixture-mode app — retrying the whole sequence when the
 * browser is stillborn.
 *
 * Two constraints shape this:
 *  - Under the sandbox a single-process browser is intermittently stillborn
 *    (it can't reach macOS graphics/XPC services and dies during startup), so
 *    each attempt may fail at launch/navigation. A fresh instance almost always
 *    works, so we retry until one renders.
 *  - A single-process browser reliably serves exactly one context+page, so we
 *    never create a throwaway probe — the page we render is the page the test
 *    uses.
 */
async function launchRenderedPage(attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let browser;
    try {
      browser = await chromium.launch(LAUNCH_OPTIONS);
      const context = await browser.newContext(CONTEXT_OPTIONS);
      await installAppRoutes(context);
      const page = await context.newPage();
      await gotoFixture(page);
      return { browser, page };
    } catch (error) {
      lastError = error;
      if (browser) await browser.close().catch(() => {});
      // A genuine app/render failure should surface immediately, not be retried
      // eight times; only retry the sandbox's stillborn-browser crashes.
      if (!isBrowserCrash(error)) throw error;
    }
  }
  throw lastError;
}

export const test = base.extend({
  // A page booted in offline fixture mode and rendered, on a fresh per-test
  // single-process browser. The browser lifecycle is owned here (not via the
  // built-in fixtures) so the launch retry can re-run the full navigate+render.
  appPage: async ({}, use) => {
    const { browser, page } = await launchRenderedPage();
    try {
      await use(page);
    } finally {
      await browser.close().catch(() => {});
    }
  },
});

/** Navigate to the app in offline fixture mode and wait until it has painted. */
export async function gotoFixture(page) {
  await page.goto('/?mode=fixture', { waitUntil: 'load' });
  await waitForRender(page);
}

/**
 * Resolve once the store has applied the fixture snapshot (status bar shows a
 * positive entity count) and the grid canvas has actually drawn something (more
 * than one distinct colour in a corner sample).
 */
export async function waitForRender(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('status-entities');
      return !!el && /^\d+$/.test(el.textContent.trim()) && Number(el.textContent) > 0;
    },
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => {
      const c = document.getElementById('biome-canvas');
      if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 80), Math.min(c.height, 80)).data;
      const first = (d[0] << 16) | (d[1] << 8) | d[2];
      for (let i = 4; i < d.length; i += 4) if (((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) !== first) return true;
      return false;
    },
    { timeout: 15000 },
  );
}

/** Dracula tokens the renderer draws with, as [r,g,b]. */
export const COLORS = Object.freeze({
  selection: [68, 71, 90], // #44475A — the selected-cell fill
  brightYellow: [255, 255, 165], // #FFFFA5 — selection/hover corner brackets
  purple: [189, 147, 249], // #BD93F9 — the old canvas focus border
});

/**
 * Raw RGBA bytes of a canvas region, read with `getImageData`. Coordinates are
 * canvas pixels; at deviceScaleFactor 1 they equal CSS offsets from the canvas
 * top-left, which is what the mouse helpers use.
 * @returns {Promise<number[]>}
 */
export async function readRegion(page, x, y, w, h) {
  return page.evaluate(
    ({ x, y, w, h }) => Array.from(document.getElementById('biome-canvas').getContext('2d').getImageData(x, y, w, h).data),
    { x, y, w, h },
  );
}

/** Count pixels in an RGBA byte array within `tol` (per channel) of `target`. */
export function countColor(data, [r, g, b], tol = 26) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) <= tol && Math.abs(data[i + 1] - g) <= tol && Math.abs(data[i + 2] - b) <= tol) n += 1;
  }
  return n;
}

/** The canvas cursor as the browser computes it (static `none`, `move` while dragging). */
export async function canvasCursor(page) {
  return page.evaluate(() => getComputedStyle(document.getElementById('biome-canvas')).cursor);
}

/** Viewport point for a CSS offset within the grid canvas, for mouse helpers. */
export async function gridViewportPoint(page, cssX, cssY) {
  const box = await page.locator('#biome-canvas').boundingBox();
  return { x: box.x + cssX, y: box.y + cssY };
}
