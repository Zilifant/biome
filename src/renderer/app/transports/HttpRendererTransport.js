/**
 * HTTP transport over the host's REST endpoints. Used alongside the
 * WebSocket transport for entity inspection, status, command fallback, and
 * full-snapshot recovery after a detected desynchronization.
 */
import { RendererTransport, TransportEvents } from './RendererTransport.js';

export class HttpRendererTransport extends RendererTransport {
  #baseUrl;
  #fetch;

  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] '' for same-origin
   * @param {typeof fetch} [options.fetchImpl] injectable for tests
   */
  constructor({ baseUrl = '', fetchImpl } = {}) {
    super();
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /** Verifies reachability by fetching status once. */
  async connect() {
    try {
      const status = await this.getStatus();
      this.emit({ type: TransportEvents.CONNECTION, state: 'connected', detail: 'http' });
      return status;
    } catch (error) {
      this.emit({ type: TransportEvents.CONNECTION, state: 'disconnected', detail: String(error) });
      throw error;
    }
  }

  async #getJson(path) {
    const response = await this.#fetch(`${this.#baseUrl}${path}`);
    const body = await response.json();
    return body;
  }

  /** @returns {Promise<object>} protocol status report */
  async getStatus() {
    return this.#getJson('/api/status');
  }

  /**
   * @param {{minX: number, minY: number, maxX: number, maxY: number} | null} [bounds]
   * @returns {Promise<object>} protocol snapshot.full
   */
  async requestSnapshot(bounds = null) {
    const query = bounds
      ? `?minX=${encodeURIComponent(bounds.minX)}&minY=${encodeURIComponent(bounds.minY)}` +
        `&maxX=${encodeURIComponent(bounds.maxX)}&maxY=${encodeURIComponent(bounds.maxY)}`
      : '';
    return this.#getJson(`/api/snapshot${query}`);
  }

  /**
   * @param {number} entityId
   * @returns {Promise<object>} protocol entity.inspection (found may be false)
   */
  async requestEntity(entityId) {
    return this.#getJson(`/api/entities/${encodeURIComponent(entityId)}`);
  }

  /**
   * Fetch the terrain projection explicitly. Full snapshots already embed
   * terrain, so this is only for tools or diagnostics.
   * @returns {Promise<object>} protocol terrain response
   */
  async requestTerrain() {
    return this.#getJson('/api/terrain');
  }

  /**
   * @param {object} command protocol command
   * @returns {Promise<object>} structured command result
   */
  async sendCommand(command) {
    const response = await this.#fetch(`${this.#baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    return response.json();
  }
}
