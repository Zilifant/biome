/**
 * Command and camera controls. Simulation-affecting buttons send protocol
 * commands through the transport (never mutate anything directly) and are
 * disabled in fixture mode. Camera buttons are renderer-local.
 */

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

export class Controls {
  #els;
  #callbacks;

  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   * @param {(command: object) => Promise<object>} callbacks.onCommand
   * @param {() => void} callbacks.onRecenter
   * @param {() => void} callbacks.onReconnect
   */
  constructor(container, callbacks) {
    this.#callbacks = callbacks;
    container.innerHTML = `
      <h2>Controls</h2>
      <div class="control-row">
        <button type="button" id="ctl-pause">Pause</button>
        <button type="button" id="ctl-resume">Resume</button>
        <button type="button" id="ctl-step">Step</button>
      </div>
      <div class="control-row">
        <label for="ctl-speed">speed</label>
        <select id="ctl-speed">${SPEED_OPTIONS.map((speed) => `<option value="${speed}" ${speed === 1 ? 'selected' : ''}>${speed}x</option>`).join('')}</select>
      </div>
      <div class="control-row">
        <button type="button" id="ctl-recenter">Recenter (C)</button>
        <button type="button" id="ctl-reconnect">Reconnect</button>
      </div>
      <p id="command-status" class="command-status" aria-live="polite"></p>`;
    this.#els = {
      pause: container.querySelector('#ctl-pause'),
      resume: container.querySelector('#ctl-resume'),
      step: container.querySelector('#ctl-step'),
      speed: container.querySelector('#ctl-speed'),
      recenter: container.querySelector('#ctl-recenter'),
      reconnect: container.querySelector('#ctl-reconnect'),
      status: container.querySelector('#command-status'),
    };
    this.#els.pause.addEventListener('click', () => this.#send({ type: 'simulation.pause' }));
    this.#els.resume.addEventListener('click', () => this.#send({ type: 'simulation.resume' }));
    this.#els.step.addEventListener('click', () => this.#send({ type: 'simulation.step', ticks: 1 }));
    this.#els.speed.addEventListener('change', () =>
      this.#send({ type: 'simulation.setSpeed', multiplier: Number(this.#els.speed.value) }),
    );
    this.#els.recenter.addEventListener('click', () => callbacks.onRecenter());
    this.#els.reconnect.addEventListener('click', () => callbacks.onReconnect());
  }

  async #send(command) {
    const result = await this.#callbacks.onCommand(command);
    this.showResult(command, result);
  }

  /**
   * @param {object | null} command
   * @param {object} result structured protocol command result
   */
  showResult(command, result) {
    if (result?.ok) {
      const label = command?.type ?? 'command';
      this.setStatus(`${label} ok${result.tick !== undefined ? ` (tick ${result.tick})` : ''}`, 'ok');
    } else {
      this.setStatus(`${command?.type ?? 'command'} failed: ${result?.error?.message ?? 'unknown error'}`, 'bad');
    }
  }

  /** @param {string} text @param {'ok' | 'warn' | 'bad'} [kind] */
  setStatus(text, kind = 'ok') {
    this.#els.status.textContent = text;
    this.#els.status.className = `command-status ${kind}`;
  }

  /**
   * Disable simulation commands when they cannot work (fixture mode).
   * @param {boolean} enabled
   * @param {string} [reason]
   */
  setSimulationCommandsEnabled(enabled, reason = '') {
    for (const element of [this.#els.pause, this.#els.resume, this.#els.step, this.#els.speed]) {
      element.disabled = !enabled;
      element.title = enabled ? '' : reason;
    }
  }

  /** @param {string} label */
  setReconnectLabel(label) {
    this.#els.reconnect.textContent = label;
  }
}
