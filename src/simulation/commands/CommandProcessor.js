/**
 * Deterministic command intake for the engine.
 *
 * submit() validates a command against the protocol, queues it, and returns
 * a structured result immediately (including the reserved entity id for
 * spawns). Queued commands are applied at the START of the next tick, in
 * submission order — commands are therefore part of the deterministic input
 * sequence: same commands + same submission order = same outcome.
 *
 * Only ENGINE_COMMAND_TYPES are accepted here; wall-clock commands
 * (pause/resume/speed) belong to the host runner.
 */
import { validateCommand, formatErrors } from '../../protocol/validation.js';
import { CommandTypes, ENGINE_COMMAND_TYPES, okResult, errorResult } from '../../protocol/commands.js';

export class CommandProcessor {
  #engine;
  /** @type {Array<{command: object, entityId: number}>} */
  #pending = [];

  /** @param {import('../engine/SimulationEngine.js').SimulationEngine} engine */
  constructor(engine) {
    this.#engine = engine;
  }

  get pendingCount() {
    return this.#pending.length;
  }

  /**
   * Validate and queue a command.
   * @param {object} command
   * @returns {object} structured command result
   */
  submit(command) {
    const validation = validateCommand(command);
    if (!validation.ok) {
      return errorResult('invalid-command', formatErrors(validation.errors));
    }
    if (!ENGINE_COMMAND_TYPES.has(command.type)) {
      return errorResult('unsupported-command', `command "${command.type}" is not applied by the simulation engine`);
    }
    const appliedAtTick = this.#engine.tick + 1;
    switch (command.type) {
      case CommandTypes.ENTITY_SPAWN: {
        const entityId = this.#engine.world.entities.reserveId();
        this.#pending.push({ command: structuredClone(command), entityId });
        return okResult({ entityId, appliedAtTick });
      }
      case CommandTypes.ENTITY_REMOVE: {
        this.#pending.push({ command: structuredClone(command), entityId: command.entityId });
        return okResult({ entityId: command.entityId, appliedAtTick });
      }
      default:
        return errorResult('unsupported-command', `unhandled engine command "${command.type}"`);
    }
  }

  /**
   * Apply all queued commands at a tick boundary and flush the resulting
   * entity changes so they are visible to every system of this tick.
   * Called by the engine only.
   * @param {number} tick
   */
  applyPending(tick) {
    if (this.#pending.length === 0) return;
    const pending = this.#pending;
    this.#pending = [];
    const world = this.#engine.world;
    for (const { command, entityId } of pending) {
      if (command.type === CommandTypes.ENTITY_SPAWN) {
        const definition = { ...command.entity };
        definition.x = world.clampX(definition.x);
        definition.y = world.clampY(definition.y);
        world.entities.queueSpawn(definition, entityId);
      } else if (command.type === CommandTypes.ENTITY_REMOVE) {
        if (world.entities.has(entityId)) {
          world.entities.queueRemove(entityId);
        }
      }
    }
    this.#engine.applyDeferredEntityChanges(tick);
  }

  serialize() {
    return this.#pending.map((entry) => structuredClone(entry));
  }

  /** @param {ReturnType<CommandProcessor['serialize']>} pending */
  restore(pending) {
    this.#pending = pending.map((entry) => structuredClone(entry));
  }
}
