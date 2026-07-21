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
 */
import { WebSocketServer } from 'ws';

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
 * @param {import('../SimulationRunner.js').SimulationRunner} options.runner
 * @param {string} [options.path]
 */
export function attachWebSocketTransport({ httpServer, runner, path = '/ws' }) {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on('connection', (socket) => {
    send(socket, MessageTypes.SNAPSHOT_FULL, runner.getFullSnapshot());
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
      const result = runner.handleCommand(message.command);
      send(socket, MessageTypes.COMMAND_RESULT, result, { requestId: message.requestId ?? null });
    });
  });

  const onTick = ({ delta }) => {
    const frame = JSON.stringify({ type: MessageTypes.SNAPSHOT_DELTA, payload: delta });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  };
  runner.on('tick', onTick);

  // A restarted world shares no ids, no tick, and not even a simulationId with
  // the old one, so there is no delta that could express it — every client is
  // sent a full snapshot instead. Clients already handle this: the store
  // *replaces* its state on a full snapshot.
  const onRestart = ({ snapshot }) => {
    const frame = JSON.stringify({ type: MessageTypes.SNAPSHOT_FULL, payload: snapshot });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  };
  runner.on('restart', onRestart);

  return {
    wss,
    close() {
      runner.off('tick', onTick);
      runner.off('restart', onRestart);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
