/**
 * Offline transport that replays the committed renderer fixtures, so the
 * renderer can be developed and demonstrated with no simulation running.
 *
 * Playback: connection state 'fixture' → full snapshot → historical event
 * batch → (after a short delay) the recorded delta → a completion notice.
 * It clearly labels itself as fixture mode and never pretends to be live:
 * simulation commands are rejected with a structured error.
 *
 * Fixture data is injected via `loadFixtures` (fetch in the browser, file
 * reads in tests) — this module itself is browser-independent.
 */
import { RendererTransport, TransportEvents } from './RendererTransport.js';

export class FixtureRendererTransport extends RendererTransport {
  #loadFixtures;
  #deltaDelayMs;
  /** @type {{snapshot: object, delta: object, eventsBatch: object} | null} */
  #fixtures = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;

  /**
   * @param {object} options
   * @param {() => Promise<{snapshot: object, delta: object, eventsBatch: object}>} options.loadFixtures
   * @param {number} [options.deltaDelayMs] pause before replaying the delta
   */
  constructor({ loadFixtures, deltaDelayMs = 1500 }) {
    super();
    this.#loadFixtures = loadFixtures;
    this.#deltaDelayMs = deltaDelayMs;
  }

  async connect() {
    this.disconnect();
    this.emit({ type: TransportEvents.CONNECTION, state: 'fixture', detail: 'replaying committed fixtures' });
    try {
      this.#fixtures = await this.#loadFixtures();
    } catch (error) {
      this.emit({ type: TransportEvents.CONNECTION, state: 'disconnected', detail: `fixture load failed: ${error}` });
      return;
    }
    this.emit({ type: TransportEvents.SNAPSHOT, snapshot: this.#fixtures.snapshot });
    this.emit({ type: TransportEvents.EVENTS, batch: this.#fixtures.eventsBatch });
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.emit({ type: TransportEvents.DELTA, delta: this.#fixtures.delta });
      this.emit({
        type: TransportEvents.NOTICE,
        level: 'info',
        message: 'fixture playback complete — reconnect to replay',
      });
    }, this.#deltaDelayMs);
  }

  disconnect() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Fixture mode cannot steer a simulation; commands fail loudly instead of
   * pretending.
   * @param {object} command
   */
  async sendCommand(command) {
    return {
      ok: false,
      error: {
        code: 'fixture-mode',
        message: `fixture mode is offline replay; command "${command?.type}" was not sent to any simulation`,
      },
    };
  }

  /** Recovery in fixture mode re-serves the recorded snapshot. */
  async requestSnapshot() {
    return this.#fixtures ? structuredClone(this.#fixtures.snapshot) : null;
  }
}
