/**
 * Renderer entry point. Composes the store, transports, canvas renderer,
 * and UI panels, choosing live or fixture mode from the URL:
 *
 *   /            → live (WebSocket stream + HTTP queries)
 *   /?mode=fixture or /?fixture=1 → offline replay of committed fixtures
 */
import { RendererStore } from './state/RendererStore.js';
import { RendererApp } from './RendererApp.js';
import { WebSocketRendererTransport } from './transports/WebSocketRendererTransport.js';
import { HttpRendererTransport } from './transports/HttpRendererTransport.js';
import { FixtureRendererTransport } from './transports/FixtureRendererTransport.js';
import { StatusPanel } from './ui/StatusPanel.js';
import { EntityInspector } from './ui/EntityInspector.js';
import { MetricsPanel } from './ui/MetricsPanel.js';
import { EventLog } from './ui/EventLog.js';
import { Controls } from './ui/Controls.js';

const params = new URLSearchParams(window.location.search);
const fixtureMode = params.get('mode') === 'fixture' || params.get('fixture') === '1';

async function loadFixtureFiles() {
  const [snapshot, delta, eventsBatch] = await Promise.all([
    fetch('/renderer/fixtures/example-full-snapshot.json').then((response) => response.json()),
    fetch('/renderer/fixtures/example-delta.json').then((response) => response.json()),
    fetch('/renderer/fixtures/example-events.json').then((response) => response.json()),
  ]);
  return { snapshot, delta, eventsBatch };
}

const store = new RendererStore();
const http = fixtureMode ? null : new HttpRendererTransport();
const transport = fixtureMode
  ? new FixtureRendererTransport({ loadFixtures: loadFixtureFiles })
  : new WebSocketRendererTransport({
      url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
    });

const canvas = document.getElementById('biome-canvas');
const appRef = { current: null };
const ui = {
  statusPanel: new StatusPanel(document.getElementById('status-bar')),
  inspector: new EntityInspector(document.getElementById('inspector-panel'), {
    onCycle: () => appRef.current.cycleSelection(),
    onFollowToggle: () => appRef.current.toggleFollow(),
  }),
  metricsPanel: new MetricsPanel(document.getElementById('metrics-panel')),
  eventLog: new EventLog(document.getElementById('event-log-panel'), {
    onFilterChanged: () => ui.eventLog.render(store),
  }),
  controls: null,
};
ui.controls = new Controls(document.getElementById('controls-panel'), {
  onCommand: async (command) => {
    const result = await appRef.current.sendCommand(command);
    return result;
  },
  onRecenter: () => appRef.current.recenter(),
  onReconnect: () => appRef.current.reconnect(),
});

const app = new RendererApp({
  store,
  transport,
  http,
  canvas,
  ui,
  mode: fixtureMode ? 'fixture' : 'live',
});
appRef.current = app;
app.start();
