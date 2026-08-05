/**
 * One world per visitor.
 *
 * ⚠ **The engine and the runner were always per-world; only the *host* assumed
 * there was one.** `SimulationRunner` holds its own engine, its own timer, and
 * its own run state, and `createServer` simply happened to build exactly one of
 * them and let every socket broadcast from it. So isolating visitors needs no
 * change to the engine, the runner, the protocol, or the renderer — it needs a
 * map, and a rule for when an entry is born and when it dies. That is this file.
 *
 * A session is keyed by an opaque cookie value. It is deliberately **not** an
 * account: there is no login, nothing is persisted, and a visitor who clears
 * their cookie is simply a new visitor with a new world.
 *
 * ── Why sessions stop ticking ────────────────────────────────────────────────
 * The load-bearing rule here is that **a session with no open socket does not
 * tick**. A visitor closing a tab is the common case, not the exception, and a
 * runner left running would burn a CPU slice once a second forever for an
 * audience of nobody. So the registry starts a runner when its first socket
 * connects and stops it when its last one leaves; the world is *kept* (a
 * reconnect within the idle window resumes the same world at the same tick) but
 * it is frozen while unobserved. Freezing is safe precisely because the engine
 * holds no timers and wall-clock time never influences a tick — a world that sat
 * still for ten minutes is byte-identical to one that did not.
 *
 * Sessions are then reaped once they have been socketless for `idleMs`, which is
 * what bounds memory rather than CPU.
 */
import { randomUUID } from 'node:crypto';

/** How long a socketless session keeps its world before it is discarded. */
export const DEFAULT_IDLE_MS = 10 * 60 * 1000;

/**
 * ⚠ A much shorter fuse for a session **no socket has ever joined**.
 *
 * A browser visitor opens a socket within a second of loading the page, so a
 * session that has sat unobserved for a minute is almost certainly not a person
 * — it is a crawler, a health check, or a bare `curl` that was handed a cookie
 * and never came back. Those must not be able to hold worlds against the cap for
 * ten minutes at a time, which is how a stream of cookie-less requests would
 * otherwise fill the registry and start turning real visitors away.
 */
export const DEFAULT_UNOBSERVED_IDLE_MS = 60 * 1000;

/** How often the reaper looks for expired sessions. */
export const DEFAULT_SWEEP_MS = 60 * 1000;

/**
 * ⚠ A ceiling on *concurrent worlds*, not on visitors. Past it, new visitors are
 * refused politely rather than every existing session degrading — a server that
 * accepts everyone and ticks nobody on time is worse than one that says it is
 * full.
 */
export const DEFAULT_MAX_SESSIONS = 50;

export class SessionRegistry {
  /** @type {Map<string, {id: string, runner: import('./SimulationRunner.js').SimulationRunner, sockets: Set<object>, lastSeen: number}>} */
  #sessions = new Map();
  #createRunner;
  #idleMs;
  #unobservedIdleMs;
  #maxSessions;
  /** @type {ReturnType<typeof setInterval> | null} */
  #sweeper = null;

  /**
   * @param {object} options
   * @param {() => import('./SimulationRunner.js').SimulationRunner} options.createRunner
   *        builds a fresh, **stopped** runner; the host owns world composition,
   *        so the registry never learns what a world is made of.
   * @param {number} [options.idleMs]
   * @param {number} [options.unobservedIdleMs]
   * @param {number} [options.maxSessions]
   * @param {number} [options.sweepMs]
   */
  constructor({
    createRunner,
    idleMs = DEFAULT_IDLE_MS,
    unobservedIdleMs = DEFAULT_UNOBSERVED_IDLE_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    sweepMs = DEFAULT_SWEEP_MS,
  }) {
    this.#createRunner = createRunner;
    this.#idleMs = idleMs;
    this.#unobservedIdleMs = unobservedIdleMs;
    this.#maxSessions = maxSessions;
    this.#sweeper = setInterval(() => this.sweep(), sweepMs);
    // The sweeper must never be the reason the process stays alive.
    this.#sweeper.unref?.();
  }

  get size() {
    return this.#sessions.size;
  }

  /** Every live session id, for diagnostics. */
  ids() {
    return [...this.#sessions.keys()];
  }

  /** A fresh, unguessable session id. */
  static newId() {
    return randomUUID();
  }

  /**
   * The session for `id`, creating one if this is a new visitor.
   *
   * Returns null when the server is at capacity and `id` is not already known —
   * an existing visitor is never evicted to make room for a new one, since
   * taking a world away from somebody watching it is a worse failure than
   * turning away somebody who has not started.
   *
   * @param {string} id
   * @returns {{id: string, runner: object, sockets: Set<object>, lastSeen: number} | null}
   */
  resolve(id) {
    const existing = this.#sessions.get(id);
    if (existing) {
      existing.lastSeen = Date.now();
      return existing;
    }
    if (this.#sessions.size >= this.#maxSessions) return null;
    const session = {
      id,
      runner: this.#createRunner(),
      sockets: new Set(),
      lastSeen: Date.now(),
      /** Has a socket ever joined? Decides which idle fuse applies. */
      observed: false,
      /**
       * ⚠ Exempt from reaping. Exactly one session is: the host's own default
       * (`server.runner`), which `npm start` starts and the test suite drives
       * directly. No socket ever joins it, so the unobserved fuse would
       * otherwise stop it a minute after boot — silently, and only for the
       * world the operator is looking at in the logs.
       */
      pinned: false,
    };
    this.#sessions.set(id, session);
    return session;
  }

  /**
   * Attach a socket, starting the world if this is the first observer.
   * @param {object} session
   * @param {object} socket
   */
  attachSocket(session, socket) {
    session.sockets.add(socket);
    session.lastSeen = Date.now();
    session.observed = true;
    if (!session.runner.started) session.runner.start();
  }

  /**
   * Detach a socket, freezing the world once nobody is watching.
   *
   * ⚠ The world is kept, not destroyed: a reload is a detach immediately
   * followed by an attach, and dropping the world there would mean a refresh
   * silently restarted the simulation the visitor was watching.
   * @param {object} session
   * @param {object} socket
   */
  detachSocket(session, socket) {
    session.sockets.delete(socket);
    session.lastSeen = Date.now();
    if (session.sockets.size === 0) session.runner.stop();
  }

  /** Discard one session and its world. */
  dispose(id) {
    const session = this.#sessions.get(id);
    if (!session) return false;
    session.runner.stop();
    this.#sessions.delete(id);
    return true;
  }

  /**
   * Discard every session that has had no socket for longer than `idleMs`.
   * @param {number} [now]
   * @returns {number} how many were reaped
   */
  sweep(now = Date.now()) {
    let reaped = 0;
    for (const [id, session] of this.#sessions) {
      if (session.pinned || session.sockets.size > 0) continue;
      const fuse = session.observed ? this.#idleMs : this.#unobservedIdleMs;
      if (now - session.lastSeen < fuse) continue;
      this.dispose(id);
      reaped += 1;
    }
    return reaped;
  }

  /** Stop everything; the registry is unusable afterwards. */
  closeAll() {
    if (this.#sweeper !== null) {
      clearInterval(this.#sweeper);
      this.#sweeper = null;
    }
    for (const id of [...this.#sessions.keys()]) this.dispose(id);
  }
}
