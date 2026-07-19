/**
 * Bounded, decaying spatial memory (Step 15).
 *
 * An animal remembers a handful of *places*: where it ate, where it drank,
 * where it searched and found nothing, and where something dangerous happened.
 * Each memory fades on its own schedule and is forgotten when it gets too
 * faint, so an animal's picture of the world is always small, current, and
 * personal — never a global index it could not plausibly hold.
 *
 * Two hard guarantees, both load-bearing for the risk register's "unbounded
 * memory growth" row:
 *   - at most `maxMemories` entries per animal, ever;
 *   - re-experiencing a place refreshes the existing entry instead of adding
 *     one, so standing in a food patch for 200 ticks cannot fill the list.
 *
 * Like `recordLifeEvent` and `killAnimal`, insertion lives in one shared
 * helper rather than a system: feeding, drinking, and (from Step 16) whatever
 * frightens an animal all record memories, and keeping the append and the cap
 * together is what makes the cap trustworthy. The `MemorySystem` owns the
 * other half — decay and eviction.
 */

/** What a remembered place meant to the animal. */
export const MemoryKinds = Object.freeze({
  FOOD: 'food', //     ate here
  WATER: 'water', //   drank here
  BARREN: 'barren', // looked for food here and found none
  DANGER: 'danger', // something dangerous happened here (written from Step 16)
});

/** Hard cap on remembered places per animal. Structural, not a tuning knob. */
export const MAX_MEMORIES = 8;

/**
 * How fast each kind fades, in strength per tick. The differences are the
 * point: a lake stays where it is, so water is worth remembering ten times
 * longer than a grass patch that may already have been grazed out, while
 * "nothing here" expires fastest of all because vegetation regrows.
 */
export const DEFAULT_DECAY = Object.freeze({
  [MemoryKinds.FOOD]: 0.004, //    ~250 ticks
  [MemoryKinds.WATER]: 0.0008, //  ~1250 ticks
  [MemoryKinds.BARREN]: 0.006, //  ~170 ticks
  [MemoryKinds.DANGER]: 0.001, //  ~1000 ticks
});

/**
 * Record a place, or refresh it if the animal already remembers it.
 *
 * @param {object} entity
 * @param {string} kind one of MemoryKinds
 * @param {number} cellX
 * @param {number} cellY
 * @param {number} tick
 * @param {number} [maxMemories]
 * @returns {object} the stored memory
 */
export function recordMemory(entity, kind, cellX, cellY, tick, maxMemories = MAX_MEMORIES) {
  if (!Array.isArray(entity.memories)) entity.memories = [];
  const memories = entity.memories;

  // Already known? Refresh it — this is what keeps repeated experience of one
  // place from consuming the whole list.
  let weakestIndex = 0;
  for (let i = 0; i < memories.length; i += 1) {
    const memory = memories[i];
    if (memory.kind === kind && memory.cellX === cellX && memory.cellY === cellY) {
      memory.strength = 1;
      memory.tick = tick;
      return memory;
    }
    if (memory.strength < memories[weakestIndex].strength) weakestIndex = i;
  }

  const memory = { kind, cellX, cellY, tick, strength: 1 };
  if (memories.length < maxMemories) {
    memories.push(memory);
  } else {
    // Full: the faintest memory is the one worth losing. A linear scan of a
    // list capped at 8 is constant time in everything but name.
    memories[weakestIndex] = memory;
  }
  return memory;
}

/**
 * Drop every memory of one kind at one cell — used when a place turns out not
 * to be what the animal remembered (a food patch grazed bare).
 * @param {object} entity @param {string} kind @param {number} cellX @param {number} cellY
 * @returns {boolean} whether anything was forgotten
 */
export function forgetMemory(entity, kind, cellX, cellY) {
  const memories = entity.memories;
  if (!Array.isArray(memories)) return false;
  const index = memories.findIndex((m) => m.kind === kind && m.cellX === cellX && m.cellY === cellY);
  if (index === -1) return false;
  memories.splice(index, 1);
  return true;
}

/**
 * The most worthwhile remembered place of a kind, judged by strength discounted
 * by how far the animal would have to walk — a vivid memory across the map
 * loses to a fainter one nearby. Places the animal remembers as dangerous
 * poison everything within `dangerRadius` of them.
 *
 * @param {object} entity
 * @param {string} kind
 * @param {object} options
 * @param {number} options.x current position
 * @param {number} options.y
 * @param {number} options.maxDistance ignore anything further than this
 * @param {number} [options.distanceWeight] how sharply distance discounts strength
 * @param {number} [options.dangerRadius] avoid recalling places this near remembered danger
 * @returns {{memory: object, distance: number} | null}
 */
export function bestRemembered(entity, kind, { x, y, maxDistance, distanceWeight = 0.15, dangerRadius = 0 }) {
  const memories = entity.memories;
  if (!Array.isArray(memories) || memories.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const memory of memories) {
    if (memory.kind !== kind) continue;
    const distance = Math.hypot(memory.cellX + 0.5 - x, memory.cellY + 0.5 - y);
    if (distance > maxDistance) continue;
    if (dangerRadius > 0 && isNearDanger(entity, memory.cellX + 0.5, memory.cellY + 0.5, dangerRadius)) continue;
    const score = memory.strength / (1 + distance * distanceWeight);
    if (score > bestScore) {
      bestScore = score;
      best = { memory, distance };
    }
  }
  return best;
}

/**
 * Whether a point sits within `radius` of somewhere the animal remembers as
 * dangerous.
 * @param {object} entity @param {number} x @param {number} y @param {number} radius
 */
export function isNearDanger(entity, x, y, radius) {
  const memories = entity.memories;
  if (!Array.isArray(memories)) return false;
  for (const memory of memories) {
    if (memory.kind !== MemoryKinds.DANGER) continue;
    if (Math.hypot(memory.cellX + 0.5 - x, memory.cellY + 0.5 - y) <= radius) return true;
  }
  return false;
}
