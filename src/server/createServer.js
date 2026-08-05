/**
 * Express host around the simulation. Express is ONLY a host: it wires the
 * demo engine, the real-time runner, the HTTP/WebSocket transports, and the
 * static status page together. No simulation logic lives at this layer.
 *
 * ⚠ **The host serves one world per visitor** (`SessionRegistry`), not one world
 * shared by everyone. Nothing below this layer changed to make that true: a
 * `SimulationRunner` always owned its own engine, timer, and run state, and this
 * file simply used to build exactly one. See `SessionRegistry.js` for the
 * lifecycle rules and `publicLimits.js` for why a public host caps what a
 * command may ask for.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDemoSimulation, buildDemoConfig } from '../fixtures/createDemoSimulation.js';
import { SimulationRunner } from './SimulationRunner.js';
import { createHttpRouter } from './transports/HttpTransport.js';
import { PresetStore } from './PresetStore.js';
import { SessionRegistry } from './SessionRegistry.js';
import { readSessionId, sessionCookieHeader, SESSION_COOKIE } from './sessionCookie.js';
import { resolvePublicLimits } from './publicLimits.js';
import { attachWebSocketTransport } from './transports/WebSocketTransport.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
// The renderer is a separate client-side system; the host only serves its
// static files (ES modules, styles, protocol fixtures). No renderer code runs
// on the server and nothing here imports it.
const rendererDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer');
// World presets live beside the project rather than inside `src`: they are user
// data the host reads and writes at runtime, and they are meant to be opened,
// edited, and committed by hand.
const defaultPresetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../presets');

/** The one page that must not reach the public: the sprite editor. */
const EDITOR_PAGE = '/sprite-editor.html';

/**
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.tickIntervalMs]
 * @param {string} [options.presetDirectory] where world presets are stored
 * @param {boolean} [options.admin] unlock the sprite editor, preset writes, and
 *        the protocol's own (un-narrowed) limits. Defaults to `BIOME_ADMIN=1`.
 * @param {number} [options.maxSessions]
 * @param {number} [options.idleMs]
 */
export function createServer({
  seed = Number(process.env.SIM_SEED ?? 42),
  tickIntervalMs = Number(process.env.SIM_TICK_MS ?? 1000),
  presetDirectory = process.env.SIM_PRESET_DIR ?? defaultPresetDir,
  admin = process.env.BIOME_ADMIN === '1',
  maxSessions,
  idleMs,
} = {}) {
  const limits = admin ? null : resolvePublicLimits(process.env);

  // Every session builds its world the same way the single-world host used to.
  // The registry never learns what a world is *made of* — it calls this.
  const createRunner = () =>
    new SimulationRunner({
      engine: createDemoSimulation({ seed }),
      tickIntervalMs,
      // The runner can rebuild the world on a `simulation.restart` command, but it
      // must not know how a world is *composed* — that is the fixture's job, and
      // the whole point of the demo being a fixture. So the host hands it a factory.
      createEngine: (nextSeed, options) =>
        createDemoSimulation({ seed: nextSeed, config: buildDemoConfig(options ?? {}) }),
    });

  const sessions = new SessionRegistry({
    createRunner,
    ...(maxSessions === undefined ? {} : { maxSessions }),
    ...(idleMs === undefined ? {} : { idleMs }),
  });

  // ⚠ One eagerly-built session, exposed below as `server.runner` / `server.engine`.
  // It is what `npm start` runs and what the test suite drives directly. Its id
  // is random rather than a well-known string, so no visitor can join it by
  // guessing; a caller that means to address it sends `server.sessionCookie`.
  const defaultSessionId = SessionRegistry.newId();
  const defaultSession = sessions.resolve(defaultSessionId);
  // No socket ever joins it, so without this the idle sweep would stop it a
  // minute after boot — silently, and only for the world the operator sees.
  defaultSession.pinned = true;

  // Presets are host state, not simulation state — the runner neither knows nor
  // needs to know that they exist (see PresetStore).
  const presets = new PresetStore({ directory: presetDirectory });

  const app = express();
  // Render (like any platform proxy) terminates TLS in front of us, so the
  // request's own protocol is http; trust the forwarding headers instead.
  app.set('trust proxy', 1);
  app.use(express.json());

  // ⚠ **Liveness, and deliberately nothing else.** Registered before the session
  // middleware so it neither reads nor mints a cookie: a platform health check
  // arrives every few seconds and keeps no cookies, so pointing one at a route
  // that resolves a session would build and then reap a whole engine — terrain,
  // vegetation, and a founding population — on every ping, forever. It reports
  // the process, not a world, which is exactly what a health check should ask.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, sessions: sessions.size });
  });

  // Issue a session cookie to anyone who does not have one, and record which id
  // this request speaks for.
  //
  // ⚠ **Naming a session is not the same as building one.** This middleware runs
  // on every request including static files, and building a world here would
  // mean a crawler that fetches `/` a hundred times without keeping cookies
  // leaves a hundred idle engines behind — filling the cap and turning real
  // visitors away. So the world is built lazily, by the first route that
  // actually needs one (see `runnerFor` in HttpTransport) and by the socket.
  // A browser costs exactly one: it is handed a cookie with the page and
  // presents it on `/api/status` and `/ws` a moment later.
  app.use((req, res, next) => {
    const existing = readSessionId(req.headers.cookie);
    const id = existing ?? SessionRegistry.newId();
    if (!existing) res.setHeader('Set-Cookie', sessionCookieHeader(id, req.secure));
    req.sessionId = id;
    next();
  });

  app.use('/api', createHttpRouter({ sessions, presets, limits, admin }));

  // ⚠ The sprite editor is admin-only, and blocking the *page* is what blocks
  // the editor: it is the only entry point, nothing links to it, and the main
  // view never loads it. Its modules under /renderer stay served because they
  // are part of the renderer; without this page they compose nothing.
  //
  // Registered before the static handler, since express.static would otherwise
  // answer first.
  app.get(EDITOR_PAGE, (_req, res, next) => {
    if (admin) return next();
    res.status(404).type('text/plain').send('Not found');
  });

  app.use('/renderer', express.static(rendererDir));
  app.use(express.static(publicDir));

  const httpServer = http.createServer(app);
  const webSocketTransport = attachWebSocketTransport({ httpServer, sessions, limits });

  return {
    app,
    httpServer,
    sessions,
    presets,
    limits,
    admin,
    /**
     * A `Cookie` header addressing the default session, so a caller can direct
     * HTTP requests at the same world `server.runner` exposes. Without it every
     * cookie-less request is a *new* visitor with a new world — which is the
     * point of the change, and the thing that surprises a test written against
     * the single-world host.
     */
    sessionCookie: `${SESSION_COOKIE}=${defaultSessionId}`,
    /** The default session's runner — what `npm start` drives and tests hold. */
    get runner() {
      return defaultSession.runner;
    },
    /** Follows the runner across a restart, which replaces the engine. */
    get engine() {
      return defaultSession.runner.engine;
    },
    listen(port = Number(process.env.PORT ?? 3000)) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => resolve(/** @type {import('node:net').AddressInfo} */ (httpServer.address())));
      });
    },
    async close() {
      webSocketTransport.close();
      sessions.closeAll();
      await new Promise((resolve) => httpServer.close(() => resolve(undefined)));
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.runner.start();
  const address = await server.listen();
  console.log(`biome simulation server listening on http://localhost:${address.port}`);
  console.log(`simulationId=${server.engine.simulationId} seed=${server.engine.seed} tickIntervalMs=${server.runner.baseTickIntervalMs}`);
  console.log(
    server.admin
      ? 'admin mode: sprite editor and preset writes are ENABLED, no public limits'
      : `public mode: sprite editor and preset writes disabled; limits ${JSON.stringify(server.limits)}`,
  );

  // Render sends SIGTERM on every deploy. Without this, each deploy drops open
  // sockets mid-frame instead of closing them.
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received; closing ${server.sessions.size} session(s)`);
      server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
}
