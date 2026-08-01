/**
 * Shared Playwright fixture and helpers for the renderer UI suite.
 *
 * `test` extends the base test so every context serves the app from disk
 * (offline, no server) and an `appPage` fixture hands back a page already booted
 * in fixture mode and painted. Canvas assertions go through `readRegion` /
 * `countColor`, since a `<canvas>` grid is opaque to DOM queries — `getImageData`
 * is the only way to see what was actually drawn.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, chromium } from '@playwright/test';
import { installAppRoutes, LAUNCH_OPTIONS, APP_ORIGIN, REPO_ROOT } from './serveApp.js';

export { expect };

/** The committed full snapshot, used to render a world in mocked live mode. */
export const SNAPSHOT = JSON.parse(readFileSync(path.join(REPO_ROOT, 'src/renderer/fixtures/example-full-snapshot.json'), 'utf8'));
const PROTOCOL_VERSION = SNAPSHOT.protocolVersion;

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
async function launchAndNavigate(navigate, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let browser;
    try {
      browser = await chromium.launch(LAUNCH_OPTIONS);
      const context = await browser.newContext(CONTEXT_OPTIONS);
      await installAppRoutes(context);
      const page = await context.newPage();
      const extra = await navigate(page);
      return { browser, page, extra };
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
    const { browser, page } = await launchAndNavigate(gotoFixture);
    try {
      await use(page);
    } finally {
      await browser.close().catch(() => {});
    }
  },

  // Live mode against a mocked host: the WebSocket delivers the fixture snapshot
  // (so a world renders and controls are live) and captures the commands the UI
  // sends. Provides `{ page, commands, push }` — `commands` is the array of
  // protocol commands the UI has emitted so far (the way to test that a control
  // sends the right thing), and `push` sends a frame *down* the socket, which is
  // how a test drives the world forward: a delta that kills an animal, a batch
  // of events, a recovery snapshot. Commands travel over the WS in live mode
  // (HTTP is only a fallback), so the mock echoes a `command.result` to each.
  live: async ({}, use) => {
    const { browser, page, extra } = await launchAndNavigate(gotoLive);
    try {
      await use({ page, commands: extra.commands, push: extra.push });
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
 * Navigate to the app in live mode against a mocked host, and wait until the
 * mocked world has painted. Returns the `commands` array the mock appends to as
 * the UI emits protocol commands.
 */
export async function gotoLive(page) {
  const commands = [];
  const push = await installLiveMocks(page, commands);
  await page.goto('/', { waitUntil: 'load' });
  await waitForRender(page);
  return { commands, push };
}

/**
 * Mock the host in live mode. The WebSocket sends the snapshot on connect and
 * records commands (echoing a result so the UI's pending promise resolves); the
 * REST endpoints return benign canned data so status polling and recovery never
 * error. Page-level routes take precedence over the context's static file server.
 */
/** Species ids the mocked host reports, in the order it reports them. */
export const MOCK_SPECIES = ['herbivore.gazelle', 'predator.leopard', 'scavenger.vulture'];

/**
 * A canned `metrics` query response with real structure rather than an empty
 * species list — the metrics panel renders one collapsible section per species,
 * and an empty roster leaves nothing for a test to open. Numbers are arbitrary;
 * only the shape matters, and it mirrors `buildMetricsReport`.
 */
function metricsReport() {
  const trait = (mean) => ({
    phenotype: { mean, stdev: 0.1 },
    histogram: { bins: [1, 3, 6, 3, 1] },
    selectionDifferential: 0.01,
    selectionDifferentialBySex: { female: 0.02, male: -0.01 },
  });
  const species = MOCK_SPECIES.map((speciesId, index) => ({
    speciesId,
    living: 40 - index * 10,
    sexes: { female: 20 - index * 5, male: 20 - index * 5 },
    grouping: { groups: 3, size: { mean: 4.5, max: 8 }, solitary: 2 },
    disease: { infectious: 1, symptomatic: 0, recovered: 3 },
    homeRange: { settled: 5, radius: { mean: 12.5 } },
    generation: { mean: 1.5, max: 3 },
    reproductiveSuccess: { mean: 0.8, max: 4 },
    births: 3,
    deaths: 2,
    traits: { size: trait(1), speed: trait(1.05), metabolicEfficiency: trait(0.98), boldness: trait(1.02) },
  }));
  const tick = SNAPSHOT.tick ?? 0;
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'metrics',
    simulationId: SNAPSHOT.simulationId ?? 'test-live',
    available: true,
    metrics: {
      tick,
      windowTicks: 500,
      metricsRange: '0.5–1.5',
      territory: { claimed: 120, cells: 1024, holders: 4 },
      groups: null,
      species,
    },
    // ⚠ A *full* bounded history (120 samples, as the host sends), not three.
    // The sparklines are one character per sample until they are resampled, so
    // three points is a three-character chart — under which "the chart fits the
    // column" is true of any column and the test that asserts it is measuring
    // nothing. The counts rise and fall so the line has a shape to draw.
    history: Array.from({ length: 120 }, (_, step) => ({
      tick: tick - (119 - step) * 50,
      species: species.map((entry) => ({
        speciesId: entry.speciesId,
        living: entry.living + Math.round(10 * Math.sin(step / 9)),
        generation: 1.5,
        traits: {
          size: 1 + step / 400,
          speed: 1.05,
          metabolicEfficiency: 0.98,
          boldness: 1.02 - step / 500,
        },
        infectious: 1 + (step % 5),
      })),
    })),
  };
}

async function installLiveMocks(page, commands) {
  const json = (body) => ({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  // ⚠ `species` is the protocol-v29 roster the host publishes, and the restart
  // panel builds its founder fields from it — so a mocked host that omits it
  // leaves the panel permanently waiting, which is the failure a test would
  // otherwise report as "the field does not exist".
  const status = () => ({
    protocolVersion: PROTOCOL_VERSION,
    running: true,
    paused: false,
    speed: 1,
    tick: SNAPSHOT.tick ?? 0,
    seed: 42,
    simulationId: SNAPSHOT.simulationId ?? 'test-live',
    species: [
      { id: 'herbivore.gazelle', defaultCount: 120 },
      { id: 'predator.leopard', defaultCount: 8 },
      { id: 'scavenger.vulture', defaultCount: 10 },
    ],
  });
  const commandResult = (command) => ({ protocolVersion: PROTOCOL_VERSION, ok: true, tick: SNAPSHOT.tick ?? 0, seed: command?.seed ?? 42, simulationId: SNAPSHOT.simulationId ?? 'test-live', paused: command?.type === 'simulation.pause', speed: command?.multiplier ?? 1 });

  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/api/commands')) {
      let command = {};
      try {
        command = route.request().postDataJSON();
      } catch {
        // no body
      }
      commands.push(command);
      await route.fulfill(json(commandResult(command)));
    } else if (pathname.endsWith('/api/status')) {
      await route.fulfill(json(status()));
    } else if (pathname.includes('/api/snapshot')) {
      await route.fulfill(json(SNAPSHOT));
    } else if (pathname.includes('/api/metrics')) {
      await route.fulfill(json(metricsReport()));
    } else if (pathname.includes('/api/entities/')) {
      await route.fulfill(json({ protocolVersion: PROTOCOL_VERSION, found: false }));
    } else {
      await route.fulfill(json({ protocolVersion: PROTOCOL_VERSION, ok: true }));
    }
  });

  /** @type {any} the live socket, so a test can drive the world forward */
  let socket = null;
  await page.routeWebSocket('**/ws', (ws) => {
    socket = ws;
    // Render a world immediately.
    ws.send(JSON.stringify({ type: 'snapshot.full', payload: SNAPSHOT }));
    // Capture commands and acknowledge them so the UI does not time out.
    ws.onMessage((message) => {
      let frame;
      try {
        frame = JSON.parse(typeof message === 'string' ? message : message.toString());
      } catch {
        return;
      }
      if (frame?.type === 'command') {
        commands.push(frame.command);
        ws.send(JSON.stringify({ type: 'command.result', requestId: frame.requestId, payload: commandResult(frame.command) }));
      }
    });
  });

  // Send a frame down the socket the app is listening on. The world only moves
  // when a test says so, which is what makes a test about *what happened over
  // time* — an animal dying, then decaying away — possible at all.
  return (frame) => {
    if (!socket) throw new Error('the mocked WebSocket has not connected yet');
    socket.send(JSON.stringify(frame));
  };
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

/** The canvas cursor as the browser computes it (`crosshair` at rest, `move` while dragging). */
export async function canvasCursor(page) {
  return page.evaluate(() => getComputedStyle(document.getElementById('biome-canvas')).cursor);
}

/** Viewport point for a CSS offset within the grid canvas, for mouse helpers. */
export async function gridViewportPoint(page, cssX, cssY) {
  const box = await page.locator('#biome-canvas').boundingBox();
  return { x: box.x + cssX, y: box.y + cssY };
}
