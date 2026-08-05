/**
 * WebSocket transport adapter.
 *
 * Message envelope (transport-level; payloads are protocol messages):
 *   server → client:
 *     { type: 'snapshot.full',  payload: <full snapshot> }   on connect
 *     { type: 'snapshot.delta', payload: <delta> }           every tick;
 *         the delta carries the tick's domain events in payload.events
 *     { type: 'command.result', requestId, payload: <result> }
 *     { type: 'error',          payload: { code, message } }
 *   client → server:
 *     { type: 'command', requestId?, command: <protocol command> }
 *
 * All WebSocket specifics stay in this file — the engine and the protocol
 * definitions know nothing about it.
 *
 * ⚠ **A frame goes to one socket, never to `wss.clients`.** Each connection is
 * bound to its own visitor's runner (`SessionRegistry`), so there is no such
 * thing as "the" tick to broadcast; listeners are registered per socket against
 * that socket's runner and torn down with it. Broadcasting is what made every
 * visitor share one world, and it is the only thing in this file that changed.
 */
import { WebSocketServer } from 'ws';
import { readSessionId } from '../sessionCookie.js';
import { guardedCommandHandler } from '../publicLimits.js';

const MessageTypes = Object.freeze({
  SNAPSHOT_FULL: 'snapshot.full',
  SNAPSHOT_DELTA: 'snapshot.delta',
  COMMAND: 'command',
  COMMAND_RESULT: 'command.result',
  ERROR: 'error',
});

function send(socket, type, payload, extra = {}) {
  socket.send(JSON.stringify({ type, payload, ...extra }));
}

/**
 * @param {object} options
 * @param {import('node:http').Server} options.httpServer
 * @param {import('../SessionRegistry.js').SessionRegistry} options.sessions
 * @param {object | null} [options.limits] public command ceiling; null = unlimited
 * @param {string} [options.path]
 */
export function attachWebSocketTransport({ httpServer, sessions, limits = null, path = '/ws' }) {
  const wss = new WebSocketServer({
    server: httpServer,
    path,
    // These are large JSON frames — a full snapshot carries terrain, vegetation
    // and every public entity — and they compress well. Worth the CPU on a host
    // paying for egress.
    perMessageDeflate: true,
  });

  wss.on('connection', (socket, request) => {
    // The upgrade request carries the same cookie the HTTP routes read, which is
    // why neither renderer transport had to learn that sessions exist.
    const id = readSessionId(request.headers.cookie);
    const session = id ? sessions.resolve(id) : null;
    if (!session) {
      // Either no cookie (the page is always fetched over HTTP first, so this
      // is a non-browser client) or the host is full. Say so and close, rather
      // than silently attaching them to somebody else's world.
      send(socket, MessageTypes.ERROR, {
        code: id ? 'server-full' : 'no-session',
        message: id ? 'too many simulations are running right now' : 'load the page over HTTP first to obtain a session',
      });
      socket.close();
      return;
    }

    const runner = session.runner;
    const handleCommand = guardedCommandHandler(runner, limits);

    // Attaching starts the world if this is its first observer.
    sessions.attachSocket(session, socket);

    send(socket, MessageTypes.SNAPSHOT_FULL, runner.getFullSnapshot());

    const onTick = ({ delta }) => {
      if (socket.readyState === socket.OPEN) {
        send(socket, MessageTypes.SNAPSHOT_DELTA, delta);
      }
    };
    // A restarted world shares no ids, no tick, and not even a simulationId with
    // the old one, so there is no delta that could express it — the client is
    // sent a full snapshot instead. Clients already handle this: the store
    // *replaces* its state on a full snapshot.
    const onRestart = ({ snapshot }) => {
      if (socket.readyState === socket.OPEN) {
        send(socket, MessageTypes.SNAPSHOT_FULL, snapshot);
      }
    };
    runner.on('tick', onTick);
    runner.on('restart', onRestart);

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, MessageTypes.ERROR, { code: 'invalid-json', message: 'message must be JSON' });
        return;
      }
      if (message?.type !== MessageTypes.COMMAND) {
        send(socket, MessageTypes.ERROR, { code: 'unsupported-message-type', message: `unsupported message type "${message?.type}"` });
        return;
      }
      const result = handleCommand(message.command);
      send(socket, MessageTypes.COMMAND_RESULT, result, { requestId: message.requestId ?? null });
    });

    socket.on('close', () => {
      runner.off('tick', onTick);
      runner.off('restart', onRestart);
      // Freezes the world once nobody is left watching it; the world is kept
      // until the registry reaps it, so a reload resumes where it left off.
      sessions.detachSocket(session, socket);
    });
  });

  return {
    wss,
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
