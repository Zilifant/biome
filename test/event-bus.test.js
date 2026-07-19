import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DomainEventBus } from '../src/simulation/events/DomainEventBus.js';

describe('domain event bus', () => {
  test('sequence numbers are gap-free and monotonic', () => {
    const bus = new DomainEventBus({ maxBufferedEvents: 10 });
    const first = bus.emit('a', 1);
    const second = bus.emit('b', 1);
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal(bus.lastSeq, 2);
  });

  test('retention is bounded: never drops below the floor, never exceeds 2x', () => {
    const max = 100;
    const bus = new DomainEventBus({ maxBufferedEvents: max });
    for (let i = 0; i < 10 * max; i += 1) {
      bus.emit('tick', i);
      assert.ok(bus.bufferedCount <= 2 * max, `buffer ${bus.bufferedCount} exceeded 2x bound`);
    }
    // Once well past the floor it always retains at least `max` newest events.
    assert.ok(bus.bufferedCount >= max, `buffer ${bus.bufferedCount} fell below floor`);
    assert.equal(bus.lastSeq, 10 * max);
  });

  test('since() returns the contiguous, seq-ordered tail after trimming', () => {
    const max = 50;
    const bus = new DomainEventBus({ maxBufferedEvents: max });
    for (let i = 0; i < 500; i += 1) bus.emit('e', i);
    const recent = bus.since(bus.lastSeq - 10);
    assert.equal(recent.length, 10);
    assert.deepEqual(
      recent.map((event) => event.seq),
      Array.from({ length: 10 }, (_, i) => bus.lastSeq - 9 + i),
    );
    // Requesting events older than what remains yields what is retained, and
    // the caller detects the gap via the first returned seq.
    const all = bus.since(0);
    assert.ok(all.length >= max);
    assert.ok(all[0].seq > 1, 'oldest events were trimmed');
  });

  test('emit stays fast when the buffer is full (amortized trim, not per-emit O(n))', () => {
    const bus = new DomainEventBus({ maxBufferedEvents: 5000 });
    for (let i = 0; i < 5000; i += 1) bus.emit('warm', i); // fill to the floor
    const started = performance.now();
    for (let i = 0; i < 200_000; i += 1) bus.emit('hot', i);
    const elapsed = performance.now() - started;
    // A per-emit front-splice makes this ~O(200k * 5k). Amortized trim keeps
    // it well under a second; generous bound to avoid machine-timing flakiness.
    assert.ok(elapsed < 2000, `200k emits took ${elapsed.toFixed(0)}ms (trim regressed to O(n) per emit)`);
  });

  test('serialize/restore round-trips buffered events and lastSeq', () => {
    const bus = new DomainEventBus({ maxBufferedEvents: 10 });
    bus.emit('a', 1, { entityId: 7 });
    bus.emit('b', 2);
    const saved = JSON.parse(JSON.stringify(bus.serialize()));
    const restored = new DomainEventBus({ maxBufferedEvents: 10 });
    restored.restore(saved);
    assert.equal(restored.lastSeq, 2);
    assert.deepEqual(restored.since(0), bus.since(0));
  });
});
