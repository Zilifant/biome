/**
 * Transport controls. Everything that changes the simulation goes out as a
 * protocol command on a transport — this panel never mutates anything directly,
 * and is disabled in fixture mode where there is nothing to steer. Camera
 * buttons are renderer-local.
 *
 * The run controls reflect the **host's** state rather than this client's last
 * intention (C1): the play/pause button, the speed select, and the status bar
 * are all driven by `setRunState`, which is fed by polling `/api/status` and by
 * the run state that every command result carries. A control that shows what
 * you last asked for rather than what is true is worse than no control.
 */

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8, 16];

/**
 * Fixed step sizes. 100 is the largest one-press jump: at demo scale a tick is
 * roughly a millisecond, so 100 lands instantly while 1000 is a visible stall —
 * the runner blocks on the whole run, and coalescing (C4) made that one message
 * rather than one per tick but did not make it asynchronous.
 */
const STEP_SIZES = [1, 10, 100];

/** Matches the protocol's MAX_MANUAL_STEP_TICKS, restated because the renderer
 * imports nothing from `src/protocol`. The host validates regardless; this is
 * only so the field cannot ask for something certain to be refused. */
const MAX_STEP_TICKS = 10000;

export class Controls {
  #els;
  #callbacks;
  #runState = { paused: null, speed: 1 };

  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   * @param {(command: object) => Promise<object>} callbacks.onCommand
   * @param {(ticks: number) => Promise<object>} callbacks.onStep pause-then-step (C3)
   * @param {() => Promise<object>} callbacks.onToggleRun
   * @param {() => void} callbacks.onRecenter
   * @param {() => void} callbacks.onReconnect
   */
  constructor(container, callbacks) {
    this.#callbacks = callbacks;
    container.innerHTML = `
      <h2>Controls</h2>
      <div class="control-row">
        <button type="button" id="ctl-run" class="run-toggle">…</button>
        <label for="ctl-speed" class="dim">speed</label>
        <select id="ctl-speed">${SPEED_OPTIONS.map((speed) => `<option value="${speed}" ${speed === 1 ? 'selected' : ''}>${speed}x</option>`).join('')}</select>
      </div>
      <div class="control-row">
        <span class="dim">step</span>
        ${STEP_SIZES.map((ticks) => `<button type="button" data-step="${ticks}">+${ticks}</button>`).join('')}
        <input type="number" id="ctl-step-n" min="1" max="${MAX_STEP_TICKS}" step="1" value="500" aria-label="Ticks to advance" />
        <button type="button" id="ctl-advance">go</button>
      </div>
      <div class="control-row">
        <button type="button" id="ctl-recenter">Recenter (C)</button>
        <button type="button" id="ctl-reconnect">Reconnect</button>
      </div>
      <p id="command-status" class="command-status" aria-live="polite"></p>`;
    this.#els = {
      run: container.querySelector('#ctl-run'),
      speed: container.querySelector('#ctl-speed'),
      stepN: container.querySelector('#ctl-step-n'),
      advance: container.querySelector('#ctl-advance'),
      steps: [...container.querySelectorAll('[data-step]')],
      recenter: container.querySelector('#ctl-recenter'),
      reconnect: container.querySelector('#ctl-reconnect'),
      status: container.querySelector('#command-status'),
    };

    this.#els.run.addEventListener('click', () => callbacks.onToggleRun());
    for (const button of this.#els.steps) {
      button.addEventListener('click', () => callbacks.onStep(Number(button.dataset.step)));
    }
    this.#els.advance.addEventListener('click', () => this.#advance());
    this.#els.stepN.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.#advance();
    });
    this.#els.speed.addEventListener('change', () =>
      this.#send({ type: 'simulation.setSpeed', multiplier: Number(this.#els.speed.value) }),
    );
    this.#els.recenter.addEventListener('click', () => callbacks.onRecenter());
    this.#els.reconnect.addEventListener('click', () => callbacks.onReconnect());
    this.setRunState(this.#runState);
  }

  #advance() {
    const ticks = Math.round(Number(this.#els.stepN.value));
    if (!Number.isFinite(ticks) || ticks < 1 || ticks > MAX_STEP_TICKS) {
      this.setStatus(`ticks must be a whole number in [1, ${MAX_STEP_TICKS}]`, 'bad');
      return;
    }
    this.#callbacks.onStep(ticks);
  }

  async #send(command) {
    const result = await this.#callbacks.onCommand(command);
    this.showResult(command, result);
  }

  /**
   * Reflect the host's run state. Called from polling and from command results,
   * so the button says what the simulation is actually doing — including when
   * something other than this client changed it.
   * @param {{paused: boolean | null, speed: number}} runState
   */
  setRunState(runState) {
    this.#runState = runState;
    const unknown = runState.paused === null;
    this.#els.run.textContent = unknown ? '…' : runState.paused ? '▶ Resume' : '⏸ Pause';
    this.#els.run.title = unknown ? 'waiting for the host' : 'Pause/resume (Space)';
    this.#els.run.classList.toggle('paused', runState.paused === true);
    // Stepping is only meaningful while paused, but the button stays enabled:
    // it pauses first (C3), which is the useful thing to do rather than an
    // error to report.
    if (document.activeElement !== this.#els.speed) {
      const option = SPEED_OPTIONS.find((speed) => speed === runState.speed);
      if (option !== undefined) this.#els.speed.value = String(option);
    }
  }

  /**
   * @param {object | null} command
   * @param {object} result structured protocol command result
   */
  showResult(command, result) {
    if (result?.ok) {
      const label = command?.type ?? 'command';
      const ticks = command?.ticks !== undefined ? ` ${command.ticks}` : '';
      this.setStatus(`${label}${ticks} ok${result.tick !== undefined ? ` (tick ${result.tick})` : ''}`, 'ok');
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
    for (const element of [this.#els.run, this.#els.speed, this.#els.stepN, this.#els.advance, ...this.#els.steps]) {
      element.disabled = !enabled;
      element.title = enabled ? '' : reason;
    }
  }

  /** @param {string} label */
  setReconnectLabel(label) {
    this.#els.reconnect.textContent = label;
  }
}
