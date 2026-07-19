/**
 * Deterministic pseudorandom number generation for the simulation.
 *
 * All randomness inside the simulation domain MUST flow through this class;
 * the global, unseeded random API is forbidden in simulation code (enforced
 * by a source-scan test).
 *
 * Streams: `deriveSeed(rootSeed, name)` produces an independent child seed
 * from a root seed and a stream name, so each system can consume random
 * values from its own stream. A system drawing more (or fewer) values then
 * never shifts the sequence observed by unrelated systems.
 */

const TWO_POW_32 = 2 ** 32;

/**
 * Derive a deterministic child seed from a root seed and a stream name.
 * FNV-1a over `<rootSeed>/<name>`.
 *
 * @param {number} rootSeed
 * @param {string} streamName
 * @returns {number} unsigned 32-bit seed
 */
export function deriveSeed(rootSeed, streamName) {
  let hash = 0x811c9dc5;
  const input = `${rootSeed >>> 0}/${streamName}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class SeededRandom {
  /** @param {number} seed */
  constructor(seed) {
    if (!Number.isFinite(seed)) {
      throw new TypeError('SeededRandom seed must be a finite number');
    }
    /** @type {number} unsigned 32-bit root seed of this stream */
    this.seed = seed >>> 0;
    /** @type {number} unsigned 32-bit mutable generator state */
    this.state = this.seed;
  }

  /**
   * Next float in [0, 1). Mulberry32.
   * @returns {number}
   */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
  }

  /**
   * Integer in [min, max], both inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(min, max) requires integers with min <= max, got ${min}, ${max}`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * Float in [min, max).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  float(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * True with the given probability. Always consumes exactly one value.
   * @param {number} probability in [0, 1]
   * @returns {boolean}
   */
  chance(probability) {
    return this.next() < probability;
  }

  /**
   * Uniformly pick one element. Always consumes exactly one value.
   * @template T
   * @param {T[]} array non-empty
   * @returns {T}
   */
  pick(array) {
    if (!Array.isArray(array) || array.length === 0) {
      throw new RangeError('pick(array) requires a non-empty array');
    }
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Create an independent stream derived from this stream's seed and a name.
   * @param {string} name
   * @returns {SeededRandom}
   */
  deriveStream(name) {
    return new SeededRandom(deriveSeed(this.seed, name));
  }

  /** @returns {number} serializable generator state */
  getState() {
    return this.state;
  }

  /** @param {number} state previously captured via getState() */
  setState(state) {
    if (!Number.isFinite(state)) {
      throw new TypeError('SeededRandom state must be a finite number');
    }
    this.state = state >>> 0;
  }
}
