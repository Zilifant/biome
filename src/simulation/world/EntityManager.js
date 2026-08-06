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
import { NEUTRAL_TRAITS } from '../traits/traits.js';
import { NEUTRAL_GENOME } from '../traits/genetics.js';

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
 * @property {Array<{kind: string, severity: number, tick: number}>} injuries bounded wounds (Step 17)
 * @property {number} impairment derived total injury severity, 0…1
 * @property {number} stamina sprint budget (Step 16)
 * @property {number} maxStamina
 * @property {number | null} huntTargetId prey this predator is pursuing
 * @property {number | null} lastHuntTick tick of the last capture attempt
 * @property {string} lifeStage juvenile | subadult | adult | senescent
 * @property {Array<{kind: string, cellX: number, cellY: number, tick: number, strength: number}>} memories bounded, decaying places
 * @property {Record<string, [number, number]>} genome diploid alleles, fixed at birth
 * @property {Record<string, number>} traits expressed phenotype, derived from the genome
 * @property {number | null} adultMass mass this individual grows toward, or
 *   null to use the species mean (kg)
 * @property {number[]} parents parent entity ids ([] for the founding population)
 * @property {number[]} offspring ids of this entity's own offspring (sparse)
 * @property {number} generation 0 for founders, parent's + 1 for the born
 * @property {number | null} guardianId the parent this juvenile depends on
 * @property {boolean} weaned whether parental provisioning has ended
 * @property {number | null} groupId herd label (Step 23); null when not in one
 * @property {number | null} groupHops distance in hops to the herd's root
 * @property {number | null} groupRecordId persistent-group membership — a
 *   reference into `world.groups`, not a herd label (see world/GroupRegistry.js)
 * @property {number | null} alarmedUntil tick this animal stops being alarmed
 * @property {{x: number, y: number} | null} alarmSource where the threat was
 * @property {number | null} lastContestTick tick of the last dominance contest
 * @property {{x: number, y: number, radius: number, samples: number} | null}
 *   homeRange bounded running summary of where this animal lives (Step 24)
 * @property {number | null} lastMarkTick tick it last marked ground
 * @property {number | null} migrationHeading direction it is drifting (Step 26)
 * @property {number} migrationStrength how hard, 0…1 (0 = no drift at all)
 * @property {number | null} dispersalHeading outward heading held after leaving home
 * @property {number | null} dispersalUntil tick that outward walk ends
 * @property {number | null} settledX centre of the range it last lived in
 * @property {number | null} settledY
 * @property {string} diseaseState susceptible | incubating | symptomatic | recovered
 * @property {number | null} diseaseSince tick the current stage began
 * @property {number | null} diseaseUntil tick the current stage ends
 * @property {Array<{tick: number, type: string}>} lifeEvents bounded life history
 * @property {string | null} sex 'female' | 'male' (Step 22); null for non-animals
 * @property {number | null} gestationUntil tick the pregnancy comes to term
 * @property {number | null} pendingMateId the other parent, recorded at mating
 * @property {number | null} lastMatedTick for the mating cooldown
 * @property {number | null} mateSearchSince tick this animal became receptive
 * @property {{tick: number, candidateId: number, quality: number,
 *   threshold: number, accepted: boolean} | null} lastCourtship last assessment
 * @property {{heading: number, ttl: number, moving: boolean, breakThicket?: boolean, refused?: boolean, detour?: string|null} | null} moveIntent
 *            movement intent. ⚠ `refused` is written by the movement system when
 *            a step is blocked and read by the decision system on the next tick
 *            to deflect around the obstacle; `detour` names the action a
 *            way-around is committed for, so the commitment cannot leak into a
 *            different one. Both are optional and absent means false — a save
 *            written before 2026-08-01 loads and behaves identically, since
 *            every intent is rebuilt from scratch on the first tick anyway.
 * @property {number} lastMoveDistance distance travelled this tick (movement → metabolism)
 * @property {boolean} lowEnergy set by metabolism when energy is low
 * @property {number} edibleMass carcass edible mass (0 while alive)
 * @property {number | null} diedTick tick this animal died (drives decay)
 * @property {string | null} deathCause what killed it (carried into the tombstone)
 * @property {number} decayStage index into DECAY_STAGES (carcasses only)
 * @property {number | null} possessorId the animal holding this carcass, if any
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
  const maxStamina = definition.maxStamina ?? 100;
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
    // Stamina (Step 16): the sprint budget. Drained by the movement system
    // when an animal sprints (chasing or fleeing) and recovered by the
    // metabolism system when it does not — the same two-writer accumulator
    // pattern as energy. `huntTargetId` is the prey a predator has committed
    // to, owned by the decision system; `lastHuntTick` gates the recovery
    // pause after a capture attempt.
    stamina: definition.stamina ?? maxStamina,
    maxStamina,
    huntTargetId: definition.huntTargetId ?? null,
    // The carcass this animal is hauling to a tree (phase T3), owned by the
    // decision system and read by movement — the same shape as `huntTargetId`
    // above, and null for every animal that is not a caching climber.
    cacheTargetId: definition.cacheTargetId ?? null,
    lastHuntTick: definition.lastHuntTick ?? null,
    // Elevation (phase T2): 0 on the ground, 1 up a tree. A **flag, not a
    // coordinate** — nothing about distance, the spatial index, or the world's
    // geometry knows about it; it gates predation and carcass access and nothing
    // else. Owned by `MovementSystem`; see `locomotion/climbing.js` for why the
    // gates are there and emphatically not in perception (A63). Carcasses carry
    // it too, which is what "a kill cached out of reach" is.
    elevation: definition.elevation ?? 0,
    // Flight (phase F1): whether this animal is currently on the wing. A **pace
    // flag, not a state machine** — the shape `intent.sprint` already had, derived
    // fresh every tick from the action the animal chose (see
    // `locomotion/flight.js`). Owned by `DecisionSystem`, read by movement,
    // perception, metabolism and predation. False for everything that does not
    // declare a `flight` block, and for a flier that has landed.
    //
    // ⚠ Independent of `elevation` above, and the two can never both be set: the
    // actions that keep a climber aloft are the standing-still ones and the
    // actions that put a flier on the wing are the travelling ones.
    flying: definition.flying ?? false,
    // Life stage (Step 11). Owned by the aging system, derived from age.
    lifeStage: definition.lifeStage ?? 'adult',
    // Individual variation (Step 14). Sampled once by whoever creates the
    // animal and read-only thereafter; an entity spawned without traits shares
    // the frozen neutral set (exactly average). `adultMass` is the one
    // trait-derived value worth precomputing — the aging system reads it every
    // tick to grow the animal toward its own adult size, falling back to the
    // species mean when an entity was created without one.
    // Genetics (Step 20). The genome is the heritable thing; `traits` is what
    // it expresses, and every system still reads only `traits`. Both are
    // written once at creation and read-only after.
    genome: definition.genome ?? NEUTRAL_GENOME,
    traits: definition.traits ?? NEUTRAL_TRAITS,
    adultMass: definition.adultMass ?? null,
    // Reproduction (Step 12). Owned by the reproduction system. `parents` holds
    // the two parent ids for animals that were born in-world (empty for the
    // founding population); ids stay valid because entities are never removed.
    parents: definition.parents ?? [],
    gestationUntil: definition.gestationUntil ?? null,
    pendingMateId: definition.pendingMateId ?? null,
    lastMatedTick: definition.lastMatedTick ?? null,
    // Sex and mate choice (Step 22). `sex` is fixed for life — drawn at birth,
    // dealt out to the founders — and is the one reproductive field that is
    // never written again; null means "not a sexed animal", which consumers
    // must tolerate. `mateSearchSince` is when this animal became receptive,
    // and is what makes a choosy one's standard decline as it waits;
    // `lastCourtship` is the last assessment it made, kept purely so the choice
    // is inspectable rather than something an observer has to infer.
    sex: definition.sex ?? null,
    mateSearchSince: definition.mateSearchSince ?? null,
    lastCourtship: definition.lastCourtship ?? null,
    // Parenting (Step 13). `offspring` is the sparse inverse of `parents`,
    // appended at birth. `guardianId` is the parent a dependent juvenile
    // follows and is provisioned by — set once in the newborn's spawn
    // definition, then owned (and cleared at weaning-independence or on the
    // guardian's death) by the parenting system. Founders have no guardian and
    // are therefore already weaned.
    offspring: definition.offspring ?? [],
    // Lineage depth (Step 21): founders are generation 0, everything born
    // in-world is one deeper than its deepest parent. Written once at birth.
    generation: definition.generation ?? 0,
    guardianId: definition.guardianId ?? null,
    weaned: definition.weaned ?? definition.guardianId == null,
    // Sociality (Step 23). `groupId` is a herd *label*, not a roster — it is
    // written by the social system through local propagation, and nothing
    // anywhere holds the membership. `alarmedUntil`/`alarmSource` carry panic
    // that reached this animal from a neighbour rather than from its own eyes.
    // `lastContestTick` is the brief exclusion a beaten rival serves.
    groupId: definition.groupId ?? null,
    // Hops from this animal to the herd's root — the animal whose id the label
    // is. Bounded, and what lets a split herd shed a stale label.
    groupHops: definition.groupHops ?? null,
    // ⚠ **Not the same thing as `groupId`, and the difference is the point.**
    // The label above is positional and is recomputed every tick by propagation;
    // this is a reference into `world.groups`, the persistent-group registry, and
    // it changes only when the animal explicitly joins or leaves (see
    // world/GroupRegistry.js). An animal can be far from every groupmate and
    // still be in the group — that is what "identity that survives separation"
    // means, and it is why a lion pride cannot be a herd label. Written only by
    // `GroupSystem`, which never touches `groupId`; null for every species that
    // does not form persistent groups, which today is all of them. A carcass
    // keeps its last membership, as it keeps its `deathCause`: both are facts
    // about who it was.
    groupRecordId: definition.groupRecordId ?? null,
    alarmedUntil: definition.alarmedUntil ?? null,
    alarmSource: definition.alarmSource ?? null,
    lastContestTick: definition.lastContestTick ?? null,
    // Home range (Step 24). Four numbers, not a trajectory: an exponentially
    // weighted centroid of where this animal has actually been, plus its mean
    // distance from that centre. Bounded by construction — the step's
    // performance note rules out occupancy history, and this is the summary
    // that replaces it. Null until the animal has lived somewhere.
    homeRange: definition.homeRange ?? null,
    lastMarkTick: definition.lastMarkTick ?? null,
    // Migration and dispersal (Step 26; see migration/migration.js). Six flat
    // scalars, deliberately not an object: `serialize` shallow-copies entities,
    // so a nested block would be shared by reference between a save and the
    // live world. `migrationHeading`/`migrationStrength` are the drift the
    // decision system folds into a wander — at strength 0 the animal behaves
    // exactly as it did before this step. `dispersalHeading`/`dispersalUntil`
    // are a juvenile's bounded outward walk after it leaves its guardian.
    // `settledX`/`settledY` mark where this animal last *lived*, so "it has
    // moved house" can be noticed once rather than re-derived every tick.
    migrationHeading: definition.migrationHeading ?? null,
    migrationStrength: definition.migrationStrength ?? 0,
    dispersalHeading: definition.dispersalHeading ?? null,
    dispersalUntil: definition.dispersalUntil ?? null,
    settledX: definition.settledX ?? null,
    settledY: definition.settledY ?? null,
    // Worn ground (Step 28). The direction of the nearest trail worth stepping
    // onto, and how hard it pulls — the same channel as the migration drift
    // above, folded into the same wander heading, and zero when there is no
    // trail nearby (which is most of the time and most of the world).
    trailHeading: definition.trailHeading ?? null,
    trailStrength: definition.trailStrength ?? 0,
    // Reunion with a persistent group (BEHAVIOR-PLAN P7). The third pair on the
    // same channel as the two above: a direction toward the centre of the record
    // this animal belongs to, written only when it has drifted out of contact with
    // every one of its bandmates, and folded into the same wander heading.
    //
    // ⚠⚠ **The defaults are load-bearing, not tidiness.** `blendHeadings` calls
    // `clamp01`, and `clamp01(undefined)` returns `undefined` — both its
    // comparisons are false — which makes the blend `NaN`, which makes
    // `normalizeAngle(NaN)` `NaN`, which makes `entity.x = NaN` **permanently**, at
    // which point the animal disappears from every spatial query in the world and
    // never comes back. A null heading and a zero strength are what stop an
    // unwritten field from ever reaching that path, and `DecisionSystem`
    // null-checks the heading besides.
    rallyHeading: definition.rallyHeading ?? null,
    rallyStrength: definition.rallyStrength ?? 0,
    // Disease (Step 25; see disease/disease.js). Three fields hold the whole
    // compartmental state: which compartment, when it was entered, and when it
    // ends. Severity is *derived* from the compartment rather than stored, so
    // the two can never drift apart.
    diseaseState: definition.diseaseState ?? 'susceptible',
    diseaseSince: definition.diseaseSince ?? null,
    diseaseUntil: definition.diseaseUntil ?? null,
    // The animal this one has decided to stand over, owned by the decision
    // system exactly as `huntTargetId` is, and read by hunting.
    defendingId: definition.defendingId ?? null,
    // Bounded life history (see systems/lifeEvents.js).
    lifeEvents: definition.lifeEvents ?? [],
    // Injuries (Step 17; see injury/injuries.js). `impairment` is the cached
    // total severity, kept beside the list so the movement and feeding hot
    // loops read one number instead of walking the list every tick.
    injuries: definition.injuries ?? [],
    impairment: definition.impairment ?? 0,
    // Bounded, decaying spatial memory (Step 15; see memory/memories.js).
    // Written by whichever system experienced the place, faded and evicted by
    // the memory system. Newborns start with none — an animal learns its world.
    memories: definition.memories ?? [],
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
    // Death and decay (Step 18). `diedTick` starts the decay clock and
    // `deathCause` follows the entity into its tombstone when it is finally
    // removed, so lineage can still say what happened to it.
    diedTick: definition.diedTick ?? null,
    deathCause: definition.deathCause ?? null,
    decayStage: definition.decayStage ?? 0,
    // Carcass possession (2026-07-28; see predation/possession.js). Which animal
    // is currently standing over this body — 0 for the living, and the whole of
    // the mechanism, since possession is held by **presence** rather than by a
    // stored clock and group-held possession is read off the holder's own
    // `groupRecordId`. Written only by `FeedingSystem`, and only by the act of
    // eating: a claim that no longer holds simply reads as absent, so nothing
    // has to go around clearing it when an animal dies or walks away.
    possessorId: definition.possessorId ?? null,
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
