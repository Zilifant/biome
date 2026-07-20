/**
 * Aging, growth, and senescence (Step 11), replacing the demo lifecycle
 * scaffolding.
 *
 * Each tick every living animal ages, grows its body mass along a stage curve
 * toward adult size, and is assigned a life stage (juvenile → subadult →
 * adult → senescent). Senescent animals face a per-tick death probability that
 * ramps with age, so old animals die of age (cause `age`). Body mass feeds the
 * metabolism cost, so juveniles are cheaper to run; maturity (adult stage)
 * gates reproduction in Step 12.
 *
 * Runs in the `lifecycle` phase. Ownership: writes `age`, `bodyMass`,
 * `lifeStage`, and — on age death — kills via the shared helper. One draw per
 * living animal per update on the `aging` stream (mortality roll; a fixed
 * budget keeps the stream deterministic).
 */
import { SimulationSystem } from './SimulationSystem.js';
import { killAnimal } from './death.js';

/**
 * Body mass at a given age: linear growth from `birthMass` to `adultMass` over
 * `maturityAge`, then constant.
 * @param {number} age
 * @param {{birthMass: number, adultMass: number, maturityAge: number}} params
 */
export function bodyMassForAge(age, { birthMass, adultMass, maturityAge }) {
  const t = maturityAge > 0 ? Math.min(age / maturityAge, 1) : 1;
  return birthMass + (adultMass - birthMass) * t;
}

/**
 * Life stage for an age from the stage thresholds.
 * @param {number} age
 * @param {{juvenileUntil: number, subadultUntil: number, adultUntil: number}} params
 * @returns {'juvenile'|'subadult'|'adult'|'senescent'}
 */
export function lifeStageForAge(age, { juvenileUntil, subadultUntil, adultUntil }) {
  if (age < juvenileUntil) return 'juvenile';
  if (age < subadultUntil) return 'subadult';
  if (age < adultUntil) return 'adult';
  return 'senescent';
}

export class AgingSystem extends SimulationSystem {
  /** @type {{birthMass: number, adultMass: number, maturityAge: number}} */
  #growth;

  /**
   * @param {object} [options]
   * @param {number} [options.birthMass]
   * @param {number} [options.adultMass] adult body mass (from the species)
   * @param {number} [options.maturityAge]
   * @param {number} [options.juvenileUntil]
   * @param {number} [options.subadultUntil]
   * @param {number} [options.adultUntil]
   * @param {number} [options.senescentMortalityPerTick] base death prob at senescence onset
   * @param {number} [options.mortalityRamp] how much the prob grows across the senescent span
   * @param {number} [options.maxAge] age at which death is certain
   * @param {number} [options.edibleMassFraction]
   * @param {number} [options.updateInterval]
   */
  constructor({
    birthMass = 5,
    adultMass = 30,
    maturityAge = 1000,
    juvenileUntil = 400,
    subadultUntil = 1000,
    adultUntil = 6000,
    senescentMortalityPerTick = 0.001,
    mortalityRamp = 8,
    maxAge = 12000,
    edibleMassFraction = 0.6,
    updateInterval = 1,
  } = {}) {
    super({ id: 'aging', phase: 'lifecycle', priority: 0, updateInterval });
    // Fallback for an animal whose species the registry does not know. Every
    // real animal reads its species' own block instead (Step 29).
    this.defaults = Object.freeze({
      birthMass,
      adultMass,
      maturityAge,
      juvenileUntil,
      subadultUntil,
      adultUntil,
      senescentMortalityPerTick,
      mortalityRamp,
      maxAge,
      edibleMassFraction,
    });
    this.growth = { birthMass, adultMass, maturityAge };
    // Reused scratch for the per-entity growth curve. Every field is now
    // rewritten per animal (they vary by species as well as by individual), and
    // allocating a fresh object per animal per tick would be pure garbage in the
    // hot loop — which is exactly what the step's performance note rules out.
    this.#growth = { birthMass, adultMass, maturityAge };
    this.stages = { juvenileUntil, subadultUntil, adultUntil };
  }

  update(world, context) {
    const random = context.random('aging');
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      const roll = random.next(); // one draw always → deterministic budget
      // Per-species life history (Step 29, closing §1.4 A17 and part of B3).
      // This is the debt that was easiest to see and longest to carry: a
      // stalker cub was born at the grazer's 5 kg, grew on the grazer's curve,
      // and died of old age on the grazer's schedule — and the system was even
      // constructed with a single species' `adultMass` baked in. One `Map.get`
      // of a pre-resolved record replaces all of that.
      const params = world.species.get(entity.speciesId)?.aging ?? this.defaults;
      entity.age += this.updateInterval;
      // Each individual grows toward its own adult size (Step 14), precomputed
      // at birth from the species mean and its `size` trait. The scratch object
      // is reused rather than reallocated — see the constructor.
      this.#growth.birthMass = params.birthMass;
      this.#growth.maturityAge = params.maturityAge;
      this.#growth.adultMass = entity.adultMass ?? params.adultMass ?? this.defaults.adultMass;
      entity.bodyMass = bodyMassForAge(entity.age, this.#growth);
      entity.lifeStage = lifeStageForAge(entity.age, params);

      if (entity.lifeStage === 'senescent') {
        const p = this.#mortality(entity.age, params) * this.updateInterval;
        if (entity.age >= params.maxAge || roll < p) {
          killAnimal(entity, 'age', entity.bodyMass * params.edibleMassFraction, context.emit, context.tick);
        }
      }
    }
  }

  /**
   * Per-tick death probability in senescence, ramping from base to base×(1+ramp).
   * Takes the species' own aging block, so a long-lived predator ramps over its
   * own span rather than its prey's.
   */
  #mortality(age, params) {
    const span = params.maxAge - params.adultUntil;
    const t = span > 0 ? Math.min(Math.max((age - params.adultUntil) / span, 0), 1) : 1;
    return params.senescentMortalityPerTick * (1 + params.mortalityRamp * t);
  }
}
