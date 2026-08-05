/**
 * Renderer entry point. Composes the store, transports, canvas renderer,
 * and UI panels, choosing live or fixture mode from the URL:
 *
 *   /            → live (WebSocket stream + HTTP queries)
 *   /?mode=fixture or /?fixture=1 → offline replay of committed fixtures
 *   /?renderer=sprite → sprites from the configured spritesheet instead of
 *                       glyphs (composable with fixture mode); mappings are
 *                       made in /sprite-editor.html
 */
import { RendererStore } from './state/RendererStore.js';
import { RendererApp } from './RendererApp.js';
import { SpriteGridRenderer } from './rendering/SpriteGridRenderer.js';
import { loadSpriteConfig } from './rendering/SpriteConfig.js';
import { WebSocketRendererTransport } from './transports/WebSocketRendererTransport.js';
import { HttpRendererTransport } from './transports/HttpRendererTransport.js';
import { FixtureRendererTransport } from './transports/FixtureRendererTransport.js';
import { StatusPanel } from './ui/StatusPanel.js';
import { LegendPanel } from './ui/Legend.js';
import { InspectorPanel } from './ui/InspectorPanel.js';
import { MetricsPanel } from './ui/MetricsPanel.js';
import { LayerPanel } from './ui/LayerPanel.js';
import { EventLog } from './ui/EventLog.js';
import { Controls } from './ui/Controls.js';
import { makeSectionsCollapsible } from './ui/collapsible.js';
import { makeColumnsResizable } from './ui/columnResize.js';

const params = new URLSearchParams(window.location.search);
const fixtureMode = params.get('mode') === 'fixture' || params.get('fixture') === '1';
const spriteMode = params.get('renderer') === 'sprite';

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
if (spriteMode) {
  // The base label describes monospace characters; in sprite mode say what is
  // actually drawn.
  canvas.setAttribute(
    'aria-label',
    'Sprite grid view of the biome simulation. Animals and terrain are drawn as sprites from a spritesheet; use the inspector panel for a text description of the selected entity.'
  );
}
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
  // Which data layers are drawn over the map. Built once from the registry and
  // never re-rendered; the app asks it what is on when a frame needs to know,
  // and a toggle only has to throw away what was traced for the last one.
  layerPanel: new LayerPanel(document.getElementById('layers-panel'), {
    onChange: () => appRef.current?.invalidateLayers(),
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
  // The command result is drawn in the status bar, beside the run state it
  // explains — this panel reports, the status bar shows.
  onStatus: (text, kind) => ui.statusPanel.setCommandStatus(text, kind),
});

// Each h2-headed panel folds up when its header is clicked (the Legend is
// already a <details>, so it is not listed here).
makeSectionsCollapsible([
  document.getElementById('controls-panel'),
  document.getElementById('layers-panel'),
  document.getElementById('metrics-panel'),
  document.getElementById('event-log-panel'),
]);

// Each aside can be widened by dragging its inner edge. The default width is
// also the minimum, so a drag only ever makes a column wider; a double-click on
// the handle puts it back. The app watches the grid wrapper with a
// ResizeObserver, so no callback is needed to keep the canvas fitted.
makeColumnsResizable();

const app = new RendererApp({
  store,
  transport,
  http,
  canvas,
  ui,
  mode: fixtureMode ? 'fixture' : 'live',
  // The grid-renderer seam: sprite mode swaps in the spritesheet renderer,
  // which repaints via requestRedraw once its sheet finishes loading. appRef
  // is assigned before the image can resolve, so the optional chain is safe.
  createGridRenderer: spriteMode
    ? (element) =>
        new SpriteGridRenderer(element, {
          config: loadSpriteConfig(),
          onAtlasReady: () => appRef.current?.requestRedraw(),
        })
    : undefined,
});
appRef.current = app;
app.start();
