import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureRendererTransport } from '../src/renderer/app/transports/FixtureRendererTransport.js';
import { WebSocketRendererTransport } from '../src/renderer/app/transports/WebSocketRendererTransport.js';
import { RendererStore } from '../src/renderer/app/state/RendererStore.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/fixtures');
const loadFixtures = async () => ({
  snapshot: JSON.parse(readFileSync(path.join(fixturesDir, 'example-full-snapshot.json'), 'utf8')),
  delta: JSON.parse(readFileSync(path.join(fixturesDir, 'example-delta.json'), 'utf8')),
  eventsBatch: JSON.parse(readFileSync(path.join(fixturesDir, 'example-events.json'), 'utf8')),
});

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('fixture transport', () => {
  test('replays connection, snapshot, event batch, delta, and completion notice in order', async () => {
    const transport = new FixtureRendererTransport({ loadFixtures, deltaDelayMs: 0 });
    const received = [];
    transport.subscribe((event) => received.push(event));
    await transport.connect();
    await nextTick();
    assert.deepEqual(
      received.map((event) => event.type),
      ['connection', 'snapshot', 'events', 'delta', 'notice'],
    );
    assert.equal(received[0].state, 'fixture', 'labels itself as fixture, never pretends to be live');
    assert.equal(received[1].snapshot.kind, 'snapshot.full');
    assert.equal(received[2].batch.kind, 'events.batch');
    assert.equal(received[3].delta.kind, 'snapshot.delta');
  });

  test('drives the renderer store end to end: snapshot then delta advances the tick', async () => {
    const transport = new FixtureRendererTransport({ loadFixtures, deltaDelayMs: 0 });
    const store = new RendererStore();
    transport.subscribe((event) => {
      if (event.type === 'snapshot') store.applyFullSnapshot(event.snapshot);
      if (event.type === 'events') store.applyEventBatch(event.batch);
      if (event.type === 'delta') store.applyDelta(event.delta);
    });
    const { delta } = await loadFixtures();
    await transport.connect();
    await nextTick();
    // ⚠ Read off the fixture rather than hardcoded. The warm-up moved from 10 to
    // 2400 ticks when the territory layer needed a world old enough to have one
    // (see `scripts/generateRendererFixtures.js`), and a literal here is a test
    // that fails on the regeneration rather than on a defect.
    assert.equal(store.tick, delta.tick);
    assert.ok(store.entityCount > 0);
    assert.ok(store.events.length > 0);
  });

  test('rejects simulation commands with a structured fixture-mode error', async () => {
    const transport = new FixtureRendererTransport({ loadFixtures, deltaDelayMs: 0 });
    const result = await transport.sendCommand({ type: 'simulation.pause' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'fixture-mode');
  });

  test('requestSnapshot re-serves an independent copy of the recorded snapshot for recovery', async () => {
    const transport = new FixtureRendererTransport({ loadFixtures, deltaDelayMs: 0 });
    await transport.connect();
    const first = await transport.requestSnapshot();
    assert.equal(first.kind, 'snapshot.full');
    first.entities[0].x = -1;
    const second = await transport.requestSnapshot();
    assert.notEqual(second.entities[0].x, -1);
  });

  test('disconnect cancels pending delta playback', async () => {
    const transport = new FixtureRendererTransport({ loadFixtures, deltaDelayMs: 50 });
    const received = [];
    transport.subscribe((event) => received.push(event.type));
    await transport.connect();
    transport.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(!received.includes('delta'), 'no delta after disconnect');
  });
});

/** Minimal fake WebSocket to test frame routing without a network. */
class FakeWebSocket {
  static instances = [];
  readyState = 0;
  sent = [];
  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

describe('websocket transport', () => {
  test('routes envelope frames to normalized transport events', () => {
    FakeWebSocket.instances = [];
    const transport = new WebSocketRendererTransport({ url: 'ws://test/ws', WebSocketImpl: FakeWebSocket });
    const received = [];
    transport.subscribe((event) => received.push(event));
    transport.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'snapshot.full', payload: { kind: 'snapshot.full', tick: 1 } });
    socket.receive({ type: 'snapshot.delta', payload: { kind: 'snapshot.delta', tick: 2 } });
    socket.receive({ type: 'error', payload: { code: 'x', message: 'boom' } });
    const types = received.map((event) => event.type);
    assert.deepEqual(types, ['connection', 'connection', 'snapshot', 'delta', 'notice']);
    assert.equal(received[0].state, 'connecting');
    assert.equal(received[1].state, 'connected');
  });

  test('command results resolve the matching pending command promise', async () => {
    FakeWebSocket.instances = [];
    const transport = new WebSocketRendererTransport({ url: 'ws://test/ws', WebSocketImpl: FakeWebSocket });
    transport.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const pending = transport.sendCommand({ type: 'simulation.pause' });
    await nextTick();
    const sentFrame = socket.sent[0];
    assert.equal(sentFrame.type, 'command');
    assert.equal(sentFrame.command.type, 'simulation.pause');
    socket.receive({ type: 'command.result', requestId: sentFrame.requestId, payload: { ok: true, paused: true } });
    const result = await pending;
    assert.deepEqual(result, { ok: true, paused: true });
  });

  test('frames from a superseded socket are never applied', () => {
    FakeWebSocket.instances = [];
    const transport = new WebSocketRendererTransport({ url: 'ws://test/ws', WebSocketImpl: FakeWebSocket });
    const received = [];
    transport.subscribe((event) => received.push(event));
    transport.connect();
    const staleSocket = FakeWebSocket.instances[0];
    staleSocket.open();
    transport.connect(); // supersedes the first socket
    staleSocket.receive({ type: 'snapshot.full', payload: {} });
    assert.ok(!received.some((event) => event.type === 'snapshot'), 'stale frame was dropped');
    transport.disconnect();
  });

  test('commands fail fast with a structured error when not connected', async () => {
    const transport = new WebSocketRendererTransport({ url: 'ws://test/ws', WebSocketImpl: FakeWebSocket });
    const result = await transport.sendCommand({ type: 'simulation.pause' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'not-connected');
  });
});
