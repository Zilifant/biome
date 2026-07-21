/**
 * Real-time host around the headless engine.
 *
 * The runner — never the engine — owns wall-clock scheduling: it calls
 * engine.step() at approximately one tick per second (scaled by the speed
 * multiplier), builds protocol snapshots/deltas after each tick, and emits a
 * 'tick' event `{ snapshot, delta }` for transports to broadcast. It also
 * routes commands: wall-clock commands (pause/resume/setSpeed/step) are
 * handled here; entity commands are forwarded to the engine's deterministic
 * command queue.
 *
 * Pause/speed only change WHEN ticks happen, never what a tick computes, so
 * they cannot affect determinism.
 */
import { EventEmitter } from 'node:events';
import { PROTOCOL_VERSION } from '../protocol/protocolVersion.js';
import { buildFullSnapshot, buildDeltaSnapshot } from '../protocol/snapshots.js';
import { validateCommand, formatErrors } from '../protocol/validation.js';
import { CommandTypes, RUNNER_COMMAND_TYPES, MAX_SPEED_MULTIPLIER, okResult, errorResult } from '../protocol/commands.js';

const MIN_SPEED_MULTIPLIER = 0.1;

export class SimulationRunner extends EventEmitter {
  /** @type {ReturnType<typeof setInterval> | null} */
  #timer = null;
  #lastSnapshot;

  /**
   * @param {object} options
   * @param {import('../simulation/engine/SimulationEngine.js').SimulationEngine} options.engine
   * @param {number} [options.tickIntervalMs] base interval at speed 1
   */
  constructor({ engine, tickIntervalMs = 1000 }) {
    super();
    this.engine = engine;
    this.baseTickIntervalMs = tickIntervalMs;
    this.speed = 1;
    this.started = false;
    this.paused = false;
    this.#lastSnapshot = this.getFullSnapshot();
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (!this.paused) this.#schedule();
  }

  stop() {
    this.started = false;
    this.#clearTimer();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.#clearTimer();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.started) this.#schedule();
  }

  /** @param {number} multiplier clamped to [0.1, 64] */
  setSpeed(multiplier) {
    this.speed = Math.min(MAX_SPEED_MULTIPLIER, Math.max(MIN_SPEED_MULTIPLIER, multiplier));
    if (this.started && !this.paused) this.#schedule();
  }

  /**
   * Advance ticks immediately, without waiting for real time. Used while paused
   * and by tests.
   *
   * A multi-tick step emits **one** 'tick' event covering the whole run rather
   * than one per tick. Every emission builds a full snapshot and broadcasts a
   * delta to every connected client, so a 500-tick step used to build 500
   * snapshots and flood the socket with 500 deltas — for a jump the viewer
   * experiences as a single move. Coalescing is safe because a delta is a
   * *diff* between two snapshots, not a replay: an entity born and eaten inside
   * the window is simply absent from both ends, and `baseTick` still names the
   * tick the client is on.
   *
   * The engine is untouched by this — it takes the same number of steps in the
   * same order, so a coalesced run and a tick-by-tick one end in identical
   * state. Only the reporting cadence changes.
   *
   * ⚠ Domain events are the one real cost: the outbox is bounded
   * (`config.events.maxBufferedEvents`), so a step long enough to overrun it
   * drops the oldest events from the batch. The world state stays exact; the
   * *narration* of how it got there is what a long jump gives up.
   *
   * @param {number} [ticks]
   */
  stepManually(ticks = 1) {
    if (ticks < 1) return;
    const previous = this.#lastSnapshot;
    for (let i = 0; i < ticks; i += 1) {
      this.engine.step();
    }
    this.#emitSince(previous);
  }

  /**
   * Build and emit the delta from a base snapshot to the current state.
   * @param {object} previous snapshot to diff against
   */
  #emitSince(previous) {
    const snapshot = this.getFullSnapshot();
    const events = this.engine.eventsSince(previous.lastEventSeq);
    const delta = buildDeltaSnapshot(previous, snapshot, events);
    this.#lastSnapshot = snapshot;
    this.emit('tick', { snapshot, delta });
  }

  #schedule() {
    this.#clearTimer();
    const interval = Math.max(1, Math.round(this.baseTickIntervalMs / this.speed));
    this.#timer = setInterval(() => this.#tickOnce(), interval);
    this.#timer.unref?.();
  }

  #clearTimer() {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #tickOnce() {
    const previous = this.#lastSnapshot;
    this.engine.step();
    this.#emitSince(previous);
  }

  /**
   * Current full snapshot, optionally restricted to world-space bounds.
   * @param {object} [options]
   * @param {{minX: number, minY: number, maxX: number, maxY: number} | null} [options.bounds]
   */
  getFullSnapshot({ bounds = null } = {}) {
    return buildFullSnapshot(this.engine.getSnapshotData({ bounds }));
  }

  /** @param {number} entityId */
  inspectEntity(entityId) {
    return this.engine.getEntityDetails(entityId);
  }

  /** Renderer-neutral terrain projection (codes + legend, RLE). */
  getTerrain() {
    return this.engine.getTerrainData();
  }

  getStatus() {
    return {
      simulationId: this.engine.simulationId,
      protocolVersion: PROTOCOL_VERSION,
      tick: this.engine.tick,
      entityCount: this.engine.entityCount,
      running: this.started,
      paused: this.paused,
      speed: this.speed,
      baseTickIntervalMs: this.baseTickIntervalMs,
    };
  }

  /**
   * Validate and route any protocol command; returns a structured result.
   * @param {object} command
   */
  handleCommand(command) {
    const validation = validateCommand(command);
    if (!validation.ok) {
      return errorResult('invalid-command', formatErrors(validation.errors));
    }
    if (!RUNNER_COMMAND_TYPES.has(command.type)) {
      return this.engine.submitCommand(command);
    }
    switch (command.type) {
      case CommandTypes.SIMULATION_PAUSE:
        this.pause();
        return okResult({ paused: true, tick: this.engine.tick });
      case CommandTypes.SIMULATION_RESUME:
        this.resume();
        return okResult({ paused: false, tick: this.engine.tick });
      case CommandTypes.SIMULATION_SET_SPEED:
        this.setSpeed(command.multiplier);
        return okResult({ speed: this.speed });
      case CommandTypes.SIMULATION_STEP:
        if (this.started && !this.paused) {
          return errorResult('simulation-running', 'pause the simulation before stepping manually');
        }
        this.stepManually(command.ticks ?? 1);
        return okResult({ tick: this.engine.tick });
      default:
        return errorResult('unsupported-command', `unhandled runner command "${command.type}"`);
    }
  }
}
