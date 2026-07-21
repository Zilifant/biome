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
import { LegendPanel } from './ui/Legend.js';
import { InspectorPanel } from './ui/InspectorPanel.js';
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
  // The inspector floats over the grid, anchored to the cell you clicked, and
  // can be docked into the sidebar instead. Both are hosts for one view.
  inspector: new InspectorPanel({
    floatingHost: document.getElementById('viewport-wrap'),
    dockHost: document.getElementById('inspector-panel'),
    callbacks: {
      onCycle: () => appRef.current.cycleSelection(),
      onFollowToggle: () => appRef.current.toggleFollow(),
      onClose: () => appRef.current.clearSelection(),
      onSelectEntity: (entityId) => appRef.current.selectEntity(entityId),
    },
  }),
  // The legend is generated from the appearance registries and never changes
  // after construction, so it is built once and not given to the app to render.
  legendPanel: new LegendPanel(document.getElementById('legend-panel')),
  metricsPanel: new MetricsPanel(document.getElementById('metrics-panel')),
  eventLog: new EventLog(document.getElementById('event-log-panel'), {
    onFilterChanged: () => ui.eventLog.render(store),
    onSelectEntity: (entityId) => appRef.current.selectEntity(entityId),
  }),
  controls: null,
};
ui.controls = new Controls(document.getElementById('controls-panel'), {
  onCommand: async (command) => {
    const result = await appRef.current.sendCommand(command);
    return result;
  },
  // Stepping pauses first, so the button never fails on a running simulation.
  onStep: (ticks) => appRef.current.stepTicks(ticks),
  onToggleRun: () => appRef.current.toggleRun(),
  onRestart: (command) => appRef.current.restart(command),
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
