/**
 * Top status bar: connection state, mode, simulation identity, tick, entity
 * count, season/weather, camera position, and zoom. Plain DOM, text-first
 * (connection state is announced via aria-live).
 */

/** Renderer-owned tone per weather state; unknown states get no emphasis. */
const WEATHER_TONE = Object.freeze({ drought: 'warn', snow: 'ok', rain: '', clear: '' });
export class StatusPanel {
  #els;

  /** @param {HTMLElement} container */
  constructor(container) {
    container.innerHTML = `
      <span class="status-item"><span class="status-label">link</span> <span id="status-connection" aria-live="polite">disconnected</span></span>
      <span class="status-item"><span id="status-mode" class="mode-badge">LIVE</span></span>
      <span class="status-item"><span class="status-label">sim</span> <span id="status-sim">–</span></span>
      <span class="status-item"><span class="status-label">tick</span> <span id="status-tick">–</span></span>
      <span class="status-item"><span class="status-label">entities</span> <span id="status-entities">–</span></span>
      <span class="status-item"><span class="status-label">season</span> <span id="status-season">–</span></span>
      <span class="status-item"><span class="status-label">cam</span> <span id="status-camera">–</span></span>
      <span class="status-item"><span class="status-label">cell</span> <span id="status-zoom">–</span></span>
    `;
    this.#els = {
      connection: container.querySelector('#status-connection'),
      mode: container.querySelector('#status-mode'),
      sim: container.querySelector('#status-sim'),
      tick: container.querySelector('#status-tick'),
      entities: container.querySelector('#status-entities'),
      season: container.querySelector('#status-season'),
      camera: container.querySelector('#status-camera'),
      zoom: container.querySelector('#status-zoom'),
    };
  }

  /**
   * @param {import('../state/RendererStore.js').RendererStore} store
   * @param {import('../rendering/Camera.js').Camera} camera
   */
  update(store, camera) {
    const { state, detail } = store.connection;
    this.#els.connection.textContent = detail ? `${state} (${detail})` : state;
    this.#els.connection.className =
      state === 'connected' || state === 'fixture' ? 'ok' : state === 'connecting' || state === 'reconnecting' ? 'warn' : 'bad';
    this.#els.mode.textContent = store.mode === 'fixture' ? 'FIXTURE' : 'LIVE';
    this.#els.mode.classList.toggle('mode-fixture', store.mode === 'fixture');
    this.#els.sim.textContent = store.simulationId ?? '–';
    this.#els.tick.textContent = store.tick >= 0 ? String(store.tick) : '–';
    this.#els.entities.textContent = String(store.entityCount);
    // Season, weather, and temperature (protocol v18). Renderer-owned wording;
    // the protocol sends bare names and a number.
    const environment = store.environment;
    this.#els.season.textContent = environment
      ? `${environment.season} · ${environment.weather} · ${environment.temperature.toFixed(1)}°C`
      : '–';
    this.#els.season.className = environment ? WEATHER_TONE[environment.weather] ?? '' : '';
    this.#els.camera.textContent = `${Math.floor(camera.centerX)},${Math.floor(camera.centerY)}`;
    this.#els.zoom.textContent = `${camera.cellSize}px`;
  }
}
