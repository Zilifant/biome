/**
 * Express host around the simulation. Express is ONLY a host: it wires the
 * demo engine, the real-time runner, the HTTP/WebSocket transports, and the
 * static status page together. No simulation logic lives at this layer.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createDemoSimulation, buildDemoConfig } from '../fixtures/createDemoSimulation.js';
import { SimulationRunner } from './SimulationRunner.js';
import { createHttpRouter } from './transports/HttpTransport.js';
import { PresetStore } from './PresetStore.js';
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

/**
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.tickIntervalMs]
 * @param {string} [options.presetDirectory] where world presets are stored
 * @returns {{app: import('express').Express, httpServer: import('node:http').Server,
 *            runner: SimulationRunner, engine: import('../simulation/engine/SimulationEngine.js').SimulationEngine,
 *            listen: (port?: number) => Promise<import('node:net').AddressInfo>, close: () => Promise<void>}}
 */
export function createServer({
  seed = Number(process.env.SIM_SEED ?? 42),
  tickIntervalMs = Number(process.env.SIM_TICK_MS ?? 1000),
  presetDirectory = process.env.SIM_PRESET_DIR ?? defaultPresetDir,
} = {}) {
  const engine = createDemoSimulation({ seed });
  // The runner can rebuild the world on a `simulation.restart` command, but it
  // must not know how a world is *composed* — that is the fixture's job, and
  // the whole point of the demo being a fixture. So the host hands it a factory.
  const runner = new SimulationRunner({
    engine,
    tickIntervalMs,
    createEngine: (nextSeed, options) =>
      createDemoSimulation({ seed: nextSeed, config: buildDemoConfig(options ?? {}) }),
  });

  // Presets are host state, not simulation state — the runner neither knows nor
  // needs to know that they exist (see PresetStore).
  const presets = new PresetStore({ directory: presetDirectory });

  const app = express();
  app.use(express.json());
  app.use('/api', createHttpRouter(runner, { presets }));
  app.use('/renderer', express.static(rendererDir));
  app.use(express.static(publicDir));

  const httpServer = http.createServer(app);
  const webSocketTransport = attachWebSocketTransport({ httpServer, runner });

  return {
    app,
    httpServer,
    runner,
    engine,
    presets,
    listen(port = Number(process.env.PORT ?? 3000)) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => resolve(/** @type {import('node:net').AddressInfo} */ (httpServer.address())));
      });
    },
    async close() {
      runner.stop();
      webSocketTransport.close();
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
}
