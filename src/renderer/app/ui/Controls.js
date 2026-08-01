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

import { WATCHABLE, loadWatchlist, saveWatchlist } from "./Watchlist.js";
import { speciesLabel } from "../rendering/EntityAppearance.js";

/**
 * Selectable tick rates, slowest first. Stepped through with the `«` / `»`
 * buttons rather than picked from a list: speed is something you nudge while
 * watching, and a dropdown makes you look away from the grid to change it.
 */
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

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

/** Matches the protocol's MAX_SEED (unsigned 32-bit), restated for the same reason. */
const MAX_SEED = 0xffffffff;

/**
 * World-composition bounds, restated from the protocol's MAX_* (the renderer
 * imports nothing from `src/protocol`; the host validates regardless). The
 * maxima are deliberately high — a ~1M-cell world, tens of thousands of
 * founders — so the fields can push the sim to its performance ceiling without
 * letting through a value certain to be refused.
 */
const MIN_WORLD_DIMENSION = 16;
const MAX_WORLD_DIMENSION = 1024;
/**
 * ⚠ **Per species, not per role, since protocol v29.** This panel used to carry
 * three hardcoded number fields — Herbivores, Predators, Scavengers — which is
 * the renderer knowing engine concepts it was only ever handed by coincidence,
 * and which stops being *true* the moment one species is both predator and
 * scavenger. The fields are now generated from the roster the host publishes on
 * `/api/status`, so this client never hardcodes a species list again.
 */
const MAX_FOUNDING_PER_SPECIES = 20000;
const MAX_FOUNDING_TOTAL = 30000;

/**
 * Terrain prevalence is an abstract 0..MAX scale (matching the protocol's
 * MAX_TERRAIN_PREVALENCE), not a count: 0 is none of that terrain at all, the
 * top of the scale crowds out open grazing ground, and the host maps the level
 * to generator formation counts. Offered as a dropdown rather than a free number
 * because the scale is small and unitless.
 */
const MAX_TERRAIN_PREVALENCE = 10;

/**
 * Default world composition, restated so the restart fields open on the demo's
 * actual starting values. The host still applies its own defaults for any field
 * a command omits; these only prefill the inputs. Keep in step with
 * `defaultSimulationConfig.world`, `.demo.founding`, and the protocol's
 * DEFAULT_TERRAIN_PREVALENCE.
 */
const DEFAULTS = Object.freeze({
  width: 128,
  height: 128,
  rocks: 2,
  thickets: 2,
});

/**
 * A `<select>` for a terrain-prevalence level (0..MAX_TERRAIN_PREVALENCE), with
 * `selected` chosen. A dropdown rather than a number field: the scale is small,
 * unitless, and reads better as a labelled list of steps.
 * @param {string} id @param {number} selected @param {string} ariaLabel
 * @returns {string}
 */
function prevalenceSelect(id, selected, ariaLabel) {
  const options = Array.from(
    { length: MAX_TERRAIN_PREVALENCE + 1 },
    (_, level) => {
      const label =
        level === 0
          ? "0 (none)"
          : level === MAX_TERRAIN_PREVALENCE
            ? `${level} (most)`
            : String(level);
      return `<option value="${level}"${level === selected ? " selected" : ""}>${label}</option>`;
    },
  ).join("");
  return `<select id="${id}" aria-label="${ariaLabel}">${options}</select>`;
}

/**
 * A species id (`herbivore.gazelle`) as a DOM id fragment. Dots are legal in an
 * `id` attribute but not in a plain CSS selector, and these fields are looked up
 * by selector in the UI suite.
 * @param {string} speciesId
 */
function cssId(speciesId) {
  return String(speciesId).replace(/[^a-zA-Z0-9]+/g, "-");
}

/** Minimal escaping for text that reaches innerHTML — the roster is host data. */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

export class Controls {
  #els;
  #callbacks;
  #runState = { paused: null, speed: 1 };
  /** The roster the founder fields were last built from, so polling is idempotent. */
  #speciesSignature = null;
  /** The last `setEnabled` call, re-applied to founder fields built after it. */
  #enabled = { enabled: true, reason: "" };
  /** Watchable ids to auto-pause on, remembered across reloads. @type {Set<string>} */
  #watching = loadWatchlist();

  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   * @param {(command: object) => Promise<object>} callbacks.onCommand
   * @param {(ticks: number) => Promise<object>} callbacks.onStep pause-then-step (C3)
   * @param {() => Promise<object>} callbacks.onToggleRun
   * @param {(command: object) => Promise<object>} callbacks.onRestart rebuild the world
   * @param {() => void} callbacks.onRecenter
   * @param {() => void} callbacks.onReconnect
   * @param {(text: string, kind: 'ok' | 'warn' | 'bad') => void} callbacks.onStatus
   *        report the result of a command (drawn in the status bar, not here)
   */
  constructor(container, callbacks) {
    this.#callbacks = callbacks;
    container.innerHTML = `
      <h2>Controls</h2>
      <div class="control-row">
        <button type="button" id="ctl-run" class="run-toggle">…</button>
        <button type="button" id="ctl-slower" title="Slower ([)">&laquo;</button>
        <span id="ctl-speed-value" class="speed-value" aria-live="polite">1x</span>
        <button type="button" id="ctl-faster" title="Faster (])">&raquo;</button>
      </div>
      <div class="control-row">
        <span class="dim">step</span>
        ${STEP_SIZES.map((ticks) => `<button type="button" data-step="${ticks}">+${ticks}</button>`).join("")}
        <input type="number" id="ctl-step-n" min="1" max="${MAX_STEP_TICKS}" step="1" value="500" aria-label="Ticks to advance" />
        <button type="button" id="ctl-advance">go</button>
      </div>
      <div class="control-row">
        <button type="button" id="ctl-recenter">Recenter (C)</button>
        <button type="button" id="ctl-reconnect">Reconnect</button>
      </div>
      <details class="inspector-section" id="ctl-watch-section">
        <summary><span class="section-title">Pause on</span> <span class="section-badge" id="ctl-watch-count">nothing</span></summary>
        <div class="section-body">
          <p class="hint">Stops the simulation just after the next one happens.</p>
          ${WATCHABLE.map(
            (entry) => `
            <label class="watch-row">
              <input type="checkbox" data-watch="${entry.id}" />
              <span>${entry.label}${entry.hint ? ` <span class="dim">${entry.hint}</span>` : ""}</span>
            </label>`,
          ).join("")}
        </div>
      </details>
      <details class="inspector-section">
        <summary><span class="section-title">New World</span> <span class="section-badge"> from seed</span></summary>
        <div class="section-body">
          <div class="control-row">
            <label for="ctl-seed" class="dim">Seed</label>
            <input type="number" id="ctl-seed" min="0" max="${MAX_SEED}" step="1" aria-label="Simulation seed" />
            <button type="button" id="ctl-restart">Restart</button>
          </div>
          <div class="control-row">
            <button type="button" id="ctl-restart-random">Random</button>
            <button type="button" id="ctl-restart-same">Replay Current</button>
          </div>
          <div class="control-row">
            <label for="ctl-world-w" class="dim">World</label>
            <input type="number" id="ctl-world-w" min="${MIN_WORLD_DIMENSION}" max="${MAX_WORLD_DIMENSION}" step="1" value="${DEFAULTS.width}" aria-label="World width" />
            <span class="dim">×</span>
            <input type="number" id="ctl-world-h" min="${MIN_WORLD_DIMENSION}" max="${MAX_WORLD_DIMENSION}" step="1" value="${DEFAULTS.height}" aria-label="World height" />
          </div>
          <div id="ctl-founding"><p class="hint">Waiting for the host's species list…</p></div>
          <p class="hint">How much of the map is rock or thicket rather than open grazing ground — 0 is none, ${MAX_TERRAIN_PREVALENCE} crowds it out.</p>
          <div class="control-row">
            <label for="ctl-rocks" class="dim">Rocks</label>
            ${prevalenceSelect("ctl-rocks", DEFAULTS.rocks, "Rock prevalence")}
          </div>
          <div class="control-row">
            <label for="ctl-thickets" class="dim">Thickets</label>
            ${prevalenceSelect("ctl-thickets", DEFAULTS.thickets, "Thicket prevalence")}
          </div>
        </div>
      </details>`;
    this.#els = {
      run: container.querySelector("#ctl-run"),
      slower: container.querySelector("#ctl-slower"),
      faster: container.querySelector("#ctl-faster"),
      speedValue: container.querySelector("#ctl-speed-value"),
      stepN: container.querySelector("#ctl-step-n"),
      advance: container.querySelector("#ctl-advance"),
      steps: [...container.querySelectorAll("[data-step]")],
      recenter: container.querySelector("#ctl-recenter"),
      reconnect: container.querySelector("#ctl-reconnect"),
      watches: [...container.querySelectorAll("[data-watch]")],
      watchCount: container.querySelector("#ctl-watch-count"),
      seed: container.querySelector("#ctl-seed"),
      restart: container.querySelector("#ctl-restart"),
      restartRandom: container.querySelector("#ctl-restart-random"),
      restartSame: container.querySelector("#ctl-restart-same"),
      worldW: container.querySelector("#ctl-world-w"),
      worldH: container.querySelector("#ctl-world-h"),
      founding: container.querySelector("#ctl-founding"),
      rocks: container.querySelector("#ctl-rocks"),
      thickets: container.querySelector("#ctl-thickets"),
    };

    this.#els.run.addEventListener("click", () => callbacks.onToggleRun());
    this.#els.slower.addEventListener("click", () => this.stepSpeed(-1));
    this.#els.faster.addEventListener("click", () => this.stepSpeed(1));
    for (const button of this.#els.steps) {
      button.addEventListener("click", () =>
        callbacks.onStep(Number(button.dataset.step)),
      );
    }
    this.#els.advance.addEventListener("click", () => this.#advance());
    this.#els.stepN.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.#advance();
    });
    this.#els.recenter.addEventListener("click", () => callbacks.onRecenter());
    this.#els.reconnect.addEventListener("click", () =>
      callbacks.onReconnect(),
    );

    for (const box of this.#els.watches) {
      box.checked = this.#watching.has(box.dataset.watch);
      box.addEventListener("change", () => {
        if (box.checked) this.#watching.add(box.dataset.watch);
        else this.#watching.delete(box.dataset.watch);
        saveWatchlist(this.#watching);
        this.#renderWatchCount();
      });
    }
    this.#renderWatchCount();

    this.#els.restart.addEventListener("click", () =>
      this.#restart(Math.round(Number(this.#els.seed.value))),
    );
    this.#els.seed.addEventListener("keydown", (event) => {
      if (event.key === "Enter")
        this.#restart(Math.round(Number(this.#els.seed.value)));
    });
    // The *host* picks a random seed, not the renderer: presentation has to be
    // reproducible from its inputs, and `Math.random` is banned here for the
    // same reason it is banned in the engine. Omitting the seed asks for any
    // world; the result says which one, and that number lands in the field —
    // so "replay this one" is just naming the seed you were already given.
    this.#els.restartRandom.addEventListener("click", () =>
      this.#restart(undefined),
    );
    this.#els.restartSame.addEventListener("click", () => {
      const current = Math.round(Number(this.#els.seed.value));
      this.#restart(Number.isFinite(current) ? current : undefined);
    });

    this.setRunState(this.#runState);
  }

  /** Watchable ids currently switched on, for the auto-pause check. */
  get watching() {
    return this.#watching;
  }

  /**
   * Build one founder field per species the host says it has (protocol v29).
   *
   * ⚠ Called from status polling, which repeats — so it rebuilds only when the
   * roster actually changes. Otherwise a viewer typing a count would have the
   * field replaced underneath them every poll interval, which is the sort of bug
   * that reads as "the number won't stick".
   *
   * A species with no appearance entry still gets a field, labelled from its id
   * (see `speciesLabel`): a roster this build has never seen is exactly the case
   * publishing the roster was for, and hiding it would put the world beyond
   * reach of the control that exists to compose it.
   *
   * @param {Array<{id: string, defaultCount: number}>} roster
   */
  setSpecies(roster) {
    if (!Array.isArray(roster)) return;
    const signature = roster.map((entry) => `${entry.id}:${entry.defaultCount}`).join("|");
    if (signature === this.#speciesSignature) return;
    this.#speciesSignature = signature;

    if (roster.length === 0) {
      this.#els.founding.innerHTML = `<p class="hint">The host reports no species.</p>`;
      this.#els.foundingInputs = [];
      return;
    }
    this.#els.founding.innerHTML = roster
      .map((entry) => {
        const id = `ctl-founding-${cssId(entry.id)}`;
        const label = speciesLabel(entry.id);
        return `
          <div class="control-row">
            <label for="${id}" class="dim">${escapeHtml(label)}</label>
            <input type="number" id="${id}" data-species="${escapeHtml(entry.id)}" min="0" max="${MAX_FOUNDING_PER_SPECIES}"
                   step="1" value="${Number(entry.defaultCount) || 0}" aria-label="Starting ${escapeHtml(label)}" />
          </div>`;
      })
      .join("");
    this.#els.foundingInputs = [
      ...this.#els.founding.querySelectorAll("[data-species]"),
    ];
    for (const input of this.#els.foundingInputs) {
      input.disabled = !this.#enabled.enabled;
      input.title = this.#enabled.enabled ? "" : this.#enabled.reason;
    }
  }

  #renderWatchCount() {
    const count = this.#watching.size;
    this.#els.watchCount.textContent =
      count === 0 ? "nothing" : `${count} event${count === 1 ? "" : "s"}`;
    this.#els.watchCount.className =
      count === 0 ? "section-badge" : "section-badge ok";
  }

  /**
   * Move one notch along the speed ladder. Clamped rather than wrapped — a
   * "faster" button that silently becomes "slowest" would be a trap.
   * @param {-1 | 1} direction
   */
  stepSpeed(direction) {
    const current = SPEED_OPTIONS.indexOf(this.#runState.speed);
    // An unrecognized speed (set by another client) lands on the nearest notch
    // rather than refusing to move.
    const from =
      current >= 0
        ? current
        : SPEED_OPTIONS.reduce(
            (best, speed, index) =>
              Math.abs(speed - this.#runState.speed) <
              Math.abs(SPEED_OPTIONS[best] - this.#runState.speed)
                ? index
                : best,
            0,
          );
    const next =
      SPEED_OPTIONS[
        Math.min(SPEED_OPTIONS.length - 1, Math.max(0, from + direction))
      ];
    if (next === this.#runState.speed) return;
    this.#send({ type: "simulation.setSpeed", multiplier: next });
  }

  /** @param {number | undefined} seed undefined lets the host pick one at random */
  #restart(seed) {
    if (
      seed !== undefined &&
      (!Number.isFinite(seed) || seed < 0 || seed > MAX_SEED)
    ) {
      this.setStatus(`seed must be a whole number in [0, ${MAX_SEED}]`, "bad");
      return;
    }
    // The world-composition fields apply to every restart (seeded, random, or
    // replay): they describe the world to build, and the seed only varies which
    // one within it. A blank or out-of-range field stops the restart with an
    // explanation rather than silently falling back.
    const composition = this.#compositionParams();
    if (!composition) return;
    const command = { type: "simulation.restart", ...composition };
    if (seed !== undefined) command.seed = seed;
    this.#callbacks.onRestart(command);
  }

  /**
   * Read and validate the world-composition fields. Returns
   * `{ width, height, rocks, thickets, founding? }` or null (after setting a
   * status message) if any field is out of range. Bounds mirror the host's; the
   * host validates again regardless.
   * @returns {object | null}
   */
  #compositionParams() {
    const fields = [
      ["width", this.#els.worldW, MIN_WORLD_DIMENSION, MAX_WORLD_DIMENSION],
      ["height", this.#els.worldH, MIN_WORLD_DIMENSION, MAX_WORLD_DIMENSION],
      // Prevalence dropdowns only offer valid levels, so the range check is a
      // formality — but it keeps every composition field validated the same way.
      ["rocks", this.#els.rocks, 0, MAX_TERRAIN_PREVALENCE],
      ["thickets", this.#els.thickets, 0, MAX_TERRAIN_PREVALENCE],
    ];
    const params = {};
    for (const [key, element, min, max] of fields) {
      const value = Math.round(Number(element.value));
      if (!Number.isFinite(value) || value < min || value > max) {
        this.setStatus(
          `${key} must be a whole number in [${min}, ${max}]`,
          "bad",
        );
        return null;
      }
      params[key] = value;
    }

    // The founding roster (v29). ⚠ Omitted entirely when the host has not told
    // us its species yet — sending an empty roster would mean "found nothing",
    // which is a real and very different request from "use your defaults".
    const inputs = this.#els.foundingInputs ?? [];
    if (inputs.length === 0) return params;
    const founding = [];
    let total = 0;
    for (const input of inputs) {
      const count = Math.round(Number(input.value));
      const label = speciesLabel(input.dataset.species);
      if (!Number.isFinite(count) || count < 0 || count > MAX_FOUNDING_PER_SPECIES) {
        this.setStatus(
          `${label} must be a whole number in [0, ${MAX_FOUNDING_PER_SPECIES}]`,
          "bad",
        );
        return null;
      }
      total += count;
      founding.push({ speciesId: input.dataset.species, count });
    }
    if (total > MAX_FOUNDING_TOTAL) {
      this.setStatus(
        `founders must total at most ${MAX_FOUNDING_TOTAL} (asked for ${total})`,
        "bad",
      );
      return null;
    }
    params.founding = founding;
    return params;
  }

  #advance() {
    const ticks = Math.round(Number(this.#els.stepN.value));
    if (!Number.isFinite(ticks) || ticks < 1 || ticks > MAX_STEP_TICKS) {
      this.setStatus(
        `ticks must be a whole number in [1, ${MAX_STEP_TICKS}]`,
        "bad",
      );
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
    this.#els.run.textContent = unknown
      ? "…"
      : runState.paused
        ? "▶ Resume"
        : "⏸ Pause";
    this.#els.run.title = unknown
      ? "waiting for the host"
      : "Pause/resume (Space)";
    this.#els.run.classList.toggle("paused", runState.paused === true);
    // Stepping is only meaningful while paused, but the button stays enabled:
    // it pauses first (C3), which is the useful thing to do rather than an
    // error to report.
    this.#els.speedValue.textContent = `${runState.speed}x`;
    this.#els.slower.disabled = runState.speed <= SPEED_OPTIONS[0];
    this.#els.faster.disabled = runState.speed >= SPEED_OPTIONS.at(-1);
  }

  /** Show the seed of the world currently being watched. @param {number} seed */
  setSeed(seed) {
    if (document.activeElement !== this.#els.seed)
      this.#els.seed.value = String(seed);
  }

  /**
   * @param {object | null} command
   * @param {object} result structured protocol command result
   */
  showResult(command, result) {
    if (result?.ok) {
      const label = command?.type ?? "command";
      const ticks = command?.ticks !== undefined ? ` ${command.ticks}` : "";
      this.setStatus(
        `${label}${ticks} ok${result.tick !== undefined ? ` (tick ${result.tick})` : ""}`,
        "ok",
      );
    } else {
      this.setStatus(
        `${command?.type ?? "command"} failed: ${result?.error?.message ?? "unknown error"}`,
        "bad",
      );
    }
  }

  /**
   * Say what the last command did. ⚠ The line itself lives in the **status
   * bar**, not in this panel: a result belongs beside the run state it explains,
   * and one at the foot of a collapsible panel is invisible exactly when the
   * panel is folded up. This panel only reports; `StatusPanel` owns the element
   * and `RendererApp` decides when a report has gone stale.
   * @param {string} text @param {'ok' | 'warn' | 'bad'} [kind]
   */
  setStatus(text, kind = "ok") {
    this.#callbacks.onStatus?.(text, kind);
  }

  /**
   * Disable simulation commands when they cannot work (fixture mode).
   * @param {boolean} enabled
   * @param {string} [reason]
   */
  setSimulationCommandsEnabled(enabled, reason = "") {
    for (const element of [
      this.#els.run,
      this.#els.slower,
      this.#els.faster,
      this.#els.stepN,
      this.#els.advance,
      this.#els.restart,
      this.#els.restartRandom,
      this.#els.restartSame,
      this.#els.seed,
      this.#els.worldW,
      this.#els.worldH,
      this.#els.rocks,
      this.#els.thickets,
      ...this.#els.steps,
      // ⚠ The founder fields are *generated* from the host's roster, so they may
      // not exist yet — and when they do arrive, `setSpecies` has to re-apply
      // whatever state this left, which is why it is remembered rather than
      // inferred. Fixture mode disables the panel before any roster exists.
      ...(this.#els.foundingInputs ?? []),
    ]) {
      element.disabled = !enabled;
      element.title = enabled ? "" : reason;
    }
    this.#enabled = { enabled, reason };
  }

  /** @param {string} label */
  setReconnectLabel(label) {
    this.#els.reconnect.textContent = label;
  }
}
