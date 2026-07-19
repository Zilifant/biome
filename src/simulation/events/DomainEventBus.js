/**
 * Bounded buffer of domain events with a global, gap-free sequence number.
 *
 * The bus is an outbox, not a dispatch mechanism: systems call each other
 * directly (or through queues) in hot paths; events exist so external
 * observers can learn what happened. Retention is bounded — when the buffer
 * overflows, the oldest events are dropped and consumers that fell behind
 * must resynchronize from a full snapshot.
 *
 * Trimming is amortized O(1) per emit: the buffer is allowed to overflow by
 * up to one `maxBufferedEvents`-sized chunk, then the oldest chunk is dropped
 * in bulk. A per-emit front `splice` would be O(maxBufferedEvents) once full,
 * which is catastrophic for systems emitting many events per tick (e.g. one
 * move event per animal). The guaranteed retention floor is still
 * `maxBufferedEvents`; the buffer holds at most `2 * maxBufferedEvents`.
 */
export class DomainEventBus {
  /** @type {object[]} contiguous by seq */
  #events = [];
  #lastSeq = 0;
  #maxBufferedEvents;
  #trimAt;

  /**
   * @param {object} [options]
   * @param {number} [options.maxBufferedEvents]
   */
  constructor({ maxBufferedEvents = 5000 } = {}) {
    if (!Number.isInteger(maxBufferedEvents) || maxBufferedEvents < 1) {
      throw new RangeError('maxBufferedEvents must be a positive integer');
    }
    this.#maxBufferedEvents = maxBufferedEvents;
    // Trim only once the overflow reaches a full chunk, so the O(n) splice
    // runs once per `maxBufferedEvents` emits (amortized O(1) per emit).
    this.#trimAt = maxBufferedEvents * 2;
  }

  /** Highest sequence number ever emitted. */
  get lastSeq() {
    return this.#lastSeq;
  }

  get bufferedCount() {
    return this.#events.length;
  }

  /**
   * Emit a domain event. Payload fields are merged into the event object.
   * @param {string} type
   * @param {number} tick
   * @param {object} [payload]
   * @returns {object} the emitted event
   */
  emit(type, tick, payload = {}) {
    this.#lastSeq += 1;
    const event = { seq: this.#lastSeq, tick, type, ...payload };
    this.#events.push(event);
    if (this.#events.length >= this.#trimAt) {
      this.#events.splice(0, this.#events.length - this.#maxBufferedEvents);
    }
    return event;
  }

  /**
   * Events with seq > sinceSeq, oldest first. If the requested range has
   * been trimmed from the buffer, returns what remains (consumers detect the
   * gap by comparing the first returned seq with sinceSeq + 1).
   * @param {number} sinceSeq
   * @returns {object[]}
   */
  since(sinceSeq) {
    if (this.#events.length === 0) return [];
    const firstSeq = this.#events[0].seq;
    const startIndex = Math.max(0, sinceSeq - firstSeq + 1);
    return this.#events.slice(startIndex);
  }

  serialize() {
    return {
      lastSeq: this.#lastSeq,
      events: this.#events.map((event) => ({ ...event })),
    };
  }

  /** @param {ReturnType<DomainEventBus['serialize']>} saved */
  restore(saved) {
    this.#lastSeq = saved.lastSeq;
    this.#events = saved.events.map((event) => ({ ...event }));
  }
}
