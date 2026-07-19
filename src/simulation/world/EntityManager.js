/**
 * Owns all entity records and entity identity.
 *
 * Entities are plain data objects (composition over inheritance) held in a
 * Map keyed by a stable, monotonically increasing numeric id. Ids are never
 * reused. The flat record layout is an implementation detail behind the
 * engine API and can later migrate toward struct-of-arrays / typed arrays
 * without changing public snapshots.
 *
 * Structural changes (create/remove) are deferred: systems queue them and
 * the engine flushes the queues at explicit lifecycle boundaries, so no
 * entity appears or disappears while a system is iterating.
 */

/**
 * @typedef {object} Entity
 * @property {number} id
 * @property {string} kind protocol-visible category, e.g. "animal" | "plant"
 * @property {string} speciesId
 * @property {number} x
 * @property {number} y
 * @property {number} heading radians in [0, 2π)
 * @property {boolean} alive
 * @property {number} age in ticks
 * @property {number} energy
 * @property {number} maxEnergy
 * @property {number} bodyMass kilograms
 * @property {number} speed world units per tick
 * @property {number} health
 * @property {number} maxHealth
 * @property {number} hydration
 * @property {number} maxHydration
 * @property {string} lifeStage juvenile | subadult | adult | senescent
 * @property {number[]} parents parent entity ids ([] for the founding population)
 * @property {number | null} gestationUntil tick the pregnancy comes to term
 * @property {number | null} pendingMateId the other parent, recorded at mating
 * @property {number | null} lastMatedTick for the mating cooldown
 * @property {{heading: number, ttl: number, moving: boolean} | null} moveIntent movement intent
 * @property {number} lastMoveDistance distance travelled this tick (movement → metabolism)
 * @property {boolean} lowEnergy set by metabolism when energy is low
 * @property {number} edibleMass carcass edible mass (0 while alive)
 * @property {string} action current chosen action (decision system)
 * @property {{cellX: number, cellY: number} | null} actionTarget target cell of the action
 * @property {Record<string, number> | null} utilityBreakdown scored action utilities
 */

/**
 * @param {number} id
 * @param {object} definition
 * @returns {Entity}
 */
function createEntity(id, definition) {
  const maxEnergy = definition.maxEnergy ?? 100;
  const maxHealth = definition.maxHealth ?? 100;
  const maxHydration = definition.maxHydration ?? 100;
  return {
    id,
    kind: definition.kind,
    speciesId: definition.speciesId,
    x: definition.x,
    y: definition.y,
    heading: definition.heading ?? 0,
    alive: definition.alive ?? true,
    age: definition.age ?? 0,
    energy: definition.energy ?? maxEnergy,
    maxEnergy,
    // Physiology / locomotion (Step 4). Ownership: bodyMass and speed are set
    // at spawn from the species definition and are read-only for now; health
    // is written by lifecycle/injury systems in later steps.
    bodyMass: definition.bodyMass ?? 1,
    speed: definition.speed ?? 1,
    health: definition.health ?? maxHealth,
    maxHealth,
    // Hydration (Step 10). Owned by the hydration system; parallels energy.
    hydration: definition.hydration ?? maxHydration,
    maxHydration,
    // Life stage (Step 11). Owned by the aging system, derived from age.
    lifeStage: definition.lifeStage ?? 'adult',
    // Reproduction (Step 12). Owned by the reproduction system. `parents` holds
    // the two parent ids for animals that were born in-world (empty for the
    // founding population); ids stay valid because entities are never removed.
    parents: definition.parents ?? [],
    gestationUntil: definition.gestationUntil ?? null,
    pendingMateId: definition.pendingMateId ?? null,
    lastMatedTick: definition.lastMatedTick ?? null,
    // Locomotion intent (Step 5, extended Step 8): a heading, a countdown of
    // ticks to hold it, and whether the animal is moving this tick. Owned by
    // the decision system (movement executes it); null until first decision.
    moveIntent: definition.moveIntent ?? null,
    // Decision (Step 8): current chosen action, its target cell (if any), and
    // the scored utility breakdown. Owned by the decision system; consumed by
    // movement (and feeding, Step 9). Recomputed every tick.
    action: definition.action ?? 'wander',
    actionTarget: definition.actionTarget ?? null,
    utilityBreakdown: definition.utilityBreakdown ?? null,
    // Metabolism (Step 6). `lastMoveDistance` carries the tick's travelled
    // distance from the movement system to the metabolism system (reset after
    // it is charged). `lowEnergy` is set by metabolism. `edibleMass` is 0 for
    // the living and set when the entity becomes a carcass.
    lastMoveDistance: definition.lastMoveDistance ?? 0,
    lowEnergy: definition.lowEnergy ?? false,
    edibleMass: definition.edibleMass ?? 0,
  };
}

export class EntityManager {
  /** @type {Map<number, Entity>} */
  #entities = new Map();
  #nextId = 1;
  /** @type {Array<{id: number, definition: object}>} */
  #pendingSpawns = [];
  /** @type {Set<number>} */
  #pendingRemovals = new Set();

  /**
   * Reserve a stable id without creating the entity yet. Used by the command
   * processor so a spawn command's result can report the id immediately.
   * @returns {number}
   */
  reserveId() {
    const id = this.#nextId;
    this.#nextId += 1;
    return id;
  }

  /**
   * Queue an entity for creation at the next flush.
   * @param {object} definition
   * @param {number} [reservedId] previously reserved via reserveId()
   * @returns {number} the entity id
   */
  queueSpawn(definition, reservedId = null) {
    const id = reservedId ?? this.reserveId();
    this.#pendingSpawns.push({ id, definition: { ...definition } });
    return id;
  }

  /**
   * Queue an entity for removal at the next flush.
   * @param {number} entityId
   */
  queueRemove(entityId) {
    this.#pendingRemovals.add(entityId);
  }

  /**
   * Apply queued removals, then queued spawns. Only the engine calls this,
   * at safe lifecycle boundaries. A queued spawn that was also queued for
   * removal before ever being flushed is dropped silently.
   *
   * @param {object} [callbacks]
   * @param {(entity: Entity) => void} [callbacks.onCreated]
   * @param {(entity: Entity) => void} [callbacks.onRemoved]
   */
  flush({ onCreated, onRemoved } = {}) {
    if (this.#pendingRemovals.size > 0) {
      for (const id of this.#pendingRemovals) {
        const entity = this.#entities.get(id);
        if (entity) {
          this.#entities.delete(id);
          onRemoved?.(entity);
        } else {
          const spawnIndex = this.#pendingSpawns.findIndex((spawn) => spawn.id === id);
          if (spawnIndex !== -1) this.#pendingSpawns.splice(spawnIndex, 1);
        }
      }
      this.#pendingRemovals.clear();
    }
    if (this.#pendingSpawns.length > 0) {
      const spawns = this.#pendingSpawns;
      this.#pendingSpawns = [];
      for (const { id, definition } of spawns) {
        const entity = createEntity(id, definition);
        this.#entities.set(id, entity);
        onCreated?.(entity);
      }
    }
  }

  /** @param {number} id */
  get(id) {
    return this.#entities.get(id) ?? null;
  }

  /** @param {number} id */
  has(id) {
    return this.#entities.has(id);
  }

  get count() {
    return this.#entities.size;
  }

  get pendingSpawnCount() {
    return this.#pendingSpawns.length;
  }

  get pendingRemovalCount() {
    return this.#pendingRemovals.size;
  }

  /**
   * Iterate all entities in stable creation order.
   * @returns {IterableIterator<Entity>}
   */
  all() {
    return this.#entities.values();
  }

  /** Serializable plain-data view of all entity state, including queues. */
  serialize() {
    return {
      nextId: this.#nextId,
      entities: [...this.#entities.values()].map((entity) => ({ ...entity })),
      pendingSpawns: this.#pendingSpawns.map(({ id, definition }) => ({ id, definition: { ...definition } })),
      pendingRemovals: [...this.#pendingRemovals],
    };
  }

  /** @param {ReturnType<EntityManager['serialize']>} saved */
  restore(saved) {
    this.#entities = new Map();
    this.#nextId = saved.nextId;
    for (const entity of saved.entities) {
      this.#entities.set(entity.id, { ...entity });
    }
    this.#pendingSpawns = (saved.pendingSpawns ?? []).map(({ id, definition }) => ({ id, definition: { ...definition } }));
    this.#pendingRemovals = new Set(saved.pendingRemovals ?? []);
  }
}
