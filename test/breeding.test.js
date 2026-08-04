/**
 * Seasonal breeding windows (PLAN-SPECIES.md §3.11, phase 12) — a species that
 * only conceives at one time of year.
 *
 * The mechanism is one comparison against `yearProgress`, so most of what is
 * worth testing is not the comparison:
 *
 *   1. **The identity is exact.** A species with no window is not gated by a
 *      window that happens to cover the year — the test is never made (D16), and
 *      the demo is byte-identical with the switch off.
 *   2. ⚠ **A window may wrap the year boundary.** A rut running from late autumn
 *      into early spring is the normal case, not an edge case, and a mechanism
 *      that could not express it would push every species' season away from the
 *      boundary for reasons that are purely arithmetic.
 *   3. **It gates the chooser and nothing else** — not the suitor, not gestation,
 *      not a pregnancy already carried.
 *   4. ⚠⚠ **Birth synchrony is asserted as an emergent fact**, because that is the
 *      whole claim of §3.11: nothing anywhere synchronizes births, and a
 *      compressed conception window plus a constant gestation produces a calving
 *      season by itself. The test measures where the *births* land, not where the
 *      matings do.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { ReproductionSystem, isReproductivelyReady } from '../src/simulation/systems/ReproductionSystem.js';
import { WeatherSystem } from '../src/simulation/systems/WeatherSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { EventTypes } from '../src/simulation/events/EventTypes.js';
import { yearProgress } from '../src/simulation/world/Environment.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { DEFAULT_BREEDING, breedingWindowOf, inBreedingWindow } from '../src/simulation/mating/breeding.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;

/** A short year, so a test can watch two of them go by. */
const TICKS_PER_YEAR = 400;
/** Second quarter of the year: ticks 100–199 of every 400. */
const WINDOW = Object.freeze({ startFraction: 0.25, endFraction: 0.5 });
const GESTATION = 40;

/** Breeds whenever it can, like every species shipped today. */
const YEAR_ROUND = Object.freeze({
  id: 'test.yearround',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 30,
  baseSpeed: 1.0,
  maxEnergy: 100,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 6 }),
  comfortMin: 2,
  comfortMax: 27,
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 400 }),
  // Free matings and a short gestation, so a test can watch several breeding
  // cycles without a feeding system to pay for them. `acceptanceThreshold: 0`
  // takes mate *choice* out of the picture: this suite is about the calendar.
  reproduction: Object.freeze({
    gestationTicks: GESTATION,
    cooldownTicks: 20,
    suitorCooldownTicks: 5,
    matingEnergyCost: 0,
    birthEnergyCost: 0,
    acceptanceThreshold: 0,
  }),
  initialEnergyFraction: Object.freeze({ min: 0.9, max: 1 }),
});

/** The same animal with a rut: it conceives in the second quarter of the year. */
const SEASONAL = Object.freeze({
  ...YEAR_ROUND,
  id: 'test.seasonal',
  reproduction: Object.freeze({ ...YEAR_ROUND.reproduction, breedingWindow: WINDOW }),
});

/** And one whose window straddles the year boundary, which is the normal shape. */
const WINTER_RUT = Object.freeze({
  ...YEAR_ROUND,
  id: 'test.winterrut',
  reproduction: Object.freeze({
    ...YEAR_ROUND.reproduction,
    breedingWindow: Object.freeze({ startFraction: 0.9, endFraction: 0.1 }),
  }),
});

const SPECIES = [YEAR_ROUND, SEASONAL, WINTER_RUT];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

const resolved = (id) => new SpeciesRegistry(SPECIES, CONFIG).require(id);

function sandbox({ seed = 11, config = {}, breedingEnabled = true } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 32, height: 32 },
      terrain: { ...FLAT_TERRAIN },
      environment: { ...CONFIG.environment, ticksPerYear: TICKS_PER_YEAR },
      ...config,
    },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  // Weather is what rewrites `world.environment` each tick, so it is what makes
  // the year turn at all — the season is a pure function of the tick, but
  // somebody has to publish it.
  engine.registerSystem(new WeatherSystem(engine.config.environment));
  engine.registerSystem(new ReproductionSystem({ ...engine.config.reproduction, breedingEnabled }));
  return engine;
}

function spawn(engine, speciesId, sex, overrides = {}) {
  const species = engine.species.require(speciesId);
  const g = genome();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId,
    heading: 0,
    lifeStage: 'adult',
    age: 2000,
    sex,
    genome: g,
    traits: expressGenome(g),
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy,
    maxHealth: species.maxHealth,
    health: species.maxHealth,
    maxHydration: species.maxHydration,
    hydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return engine.world.entities.get(id);
}

/** A pair standing together, which is all a mating needs. */
function pair(engine, speciesId, at = { x: 16, y: 16 }) {
  const female = spawn(engine, speciesId, Sexes.FEMALE, at);
  const male = spawn(engine, speciesId, Sexes.MALE, { x: at.x + 0.5, y: at.y });
  return { female, male };
}

describe('breeding windows: what a species declares', () => {
  test('no window is the identity, and so is a degenerate one', () => {
    assert.equal(breedingWindowOf(resolved(YEAR_ROUND.id).reproduction), null);
    assert.equal(breedingWindowOf(undefined), null);
    assert.equal(breedingWindowOf({ breedingWindow: { startFraction: 0.3, endFraction: 0.3 } }), null);
    assert.equal(breedingWindowOf({ breedingWindow: { startFraction: 0.3 } }), null, 'half a window is none');
    assert.equal(breedingWindowOf({ breedingWindow: { startFraction: 'spring', endFraction: 1 } }), null);
    assert.deepEqual(breedingWindowOf(resolved(SEASONAL.id).reproduction), { ...WINDOW });
  });

  test('⚠ a zero-width window means year-round, not a sterile species', () => {
    // The safe reading of a config typo. "Breeds on exactly one instant of the
    // year" quietly extinguishes a species over ten seeds and looks like an
    // ecological result; year-round is visibly wrong the moment anyone checks.
    assert.equal(inBreedingWindow(0.3, breedingWindowOf({ breedingWindow: { startFraction: 0.3, endFraction: 0.3 } })), true);
    assert.equal(inBreedingWindow(0.9, breedingWindowOf({ breedingWindow: { startFraction: 0.3, endFraction: 0.3 } })), true);
  });

  test('fractions outside [0, 1) fold into the year rather than being rejected', () => {
    // ⚠ Asserted on the *answer*, not on a normalized record, because there is no
    // normalized record: `breedingWindowOf` hands back the species' own frozen
    // object so that a per-animal-per-tick call allocates nothing, and the folding
    // happens on read.
    const wrapped = breedingWindowOf({ breedingWindow: { startFraction: 1.25, endFraction: -0.5 } });
    assert.equal(inBreedingWindow(0.3, wrapped), true, 'reads as 0.25 → 0.5');
    assert.equal(inBreedingWindow(0.7, wrapped), false);
  });

  test('the window handed back is the species’ own object, not a copy', () => {
    // The allocation-free path, pinned: this is reached once per animal per tick
    // from the decision system, and the schema's rule is that config indirection
    // adds no per-tick allocation.
    const reproduction = resolved(SEASONAL.id).reproduction;
    assert.equal(breedingWindowOf(reproduction), reproduction.breedingWindow);
  });

  test('the window is half-open, and it may wrap the year', () => {
    const summer = { startFraction: 0.25, endFraction: 0.5 };
    assert.equal(inBreedingWindow(0.25, summer), true, 'closed at the start');
    assert.equal(inBreedingWindow(0.49, summer), true);
    assert.equal(inBreedingWindow(0.5, summer), false, 'open at the end');
    assert.equal(inBreedingWindow(0.0, summer), false);

    const winter = { startFraction: 0.9, endFraction: 0.1 };
    assert.equal(inBreedingWindow(0.95, winter), true);
    assert.equal(inBreedingWindow(0.05, winter), true, 'and across the boundary');
    assert.equal(inBreedingWindow(0.5, winter), false);
    assert.equal(inBreedingWindow(0.5, null), true, 'no window is always in season');
  });
});

describe('breeding windows: who is gated', () => {
  const params = () => resolved(SEASONAL.id).reproduction;
  const adult = (sex) => ({
    kind: 'animal',
    alive: true,
    lifeStage: 'adult',
    sex,
    gestationUntil: null,
    energy: 100,
    maxEnergy: 100,
    lastMatedTick: null,
    diseaseState: null,
  });

  test('the gestating sex is out of season; the seeking sex never is', () => {
    // ⚠ Stated as a limit rather than left to be found: a rut is a fact about
    // both sexes, but conception is what a window is *for*, and gating the male
    // would stop him competing for females about to become receptive.
    assert.equal(isReproductivelyReady(adult(Sexes.FEMALE), 100, params(), 0.3), true, 'in season');
    assert.equal(isReproductivelyReady(adult(Sexes.FEMALE), 100, params(), 0.8), false, 'out of it');
    assert.equal(isReproductivelyReady(adult(Sexes.MALE), 100, params(), 0.8), true, 'he is ready anyway');
  });

  test('a caller with no clock is not gated at all', () => {
    // The identity that keeps every existing caller — and every hand-built test
    // world with no environment — exactly as it was.
    assert.equal(isReproductivelyReady(adult(Sexes.FEMALE), 100, params()), true);
    assert.equal(isReproductivelyReady(adult(Sexes.FEMALE), 100, params(), null), true);
  });

  test('a species with no window is in season at every point of the year', () => {
    const open = resolved(YEAR_ROUND.id).reproduction;
    for (const progress of [0, 0.25, 0.5, 0.75, 0.999]) {
      assert.equal(isReproductivelyReady(adult(Sexes.FEMALE), 100, open, progress), true, `at ${progress}`);
    }
  });
});

describe('breeding windows: in a running world', () => {
  /**
   * Every event of one type over a run, as fractions of the year. Read from the
   * engine's own bounded buffer rather than by subscribing, which is how the rest
   * of the suite reads events — and it is drained as it goes, so a long run cannot
   * silently lose the early half of the answer to the retention bound.
   */
  function yearFractionsOf(engine, type, ticks) {
    const at = [];
    // From wherever the buffer already stands, not from zero: one test starts
    // counting part way through a run and must not be handed events it ran past.
    let seq = engine.eventsSince(0).at(-1)?.seq ?? 0;
    for (let i = 0; i < ticks; i += 1) {
      engine.step(1);
      for (const event of engine.eventsSince(seq)) {
        seq = Math.max(seq, event.seq);
        if (event.type === type) at.push(yearProgress(event.tick, TICKS_PER_YEAR));
      }
    }
    return at;
  }

  /** Conception ticks over `ticks`, as fractions of the year. */
  function conceptions(speciesId, { ticks = TICKS_PER_YEAR * 2, breedingEnabled = true } = {}) {
    const engine = sandbox({ breedingEnabled });
    pair(engine, speciesId);
    return yearFractionsOf(engine, EventTypes.ENTITY_MATED, ticks);
  }

  test('a seasonal species conceives only inside its window', () => {
    const at = conceptions(SEASONAL.id);
    assert.ok(at.length >= 2, `it did breed (${at.length} matings)`);
    for (const progress of at) {
      assert.ok(inBreedingWindow(progress, WINDOW), `conceived at ${progress.toFixed(3)}, outside the window`);
    }
  });

  test('a wrapped window works across the year boundary', () => {
    const at = conceptions(WINTER_RUT.id);
    assert.ok(at.length >= 2, `it did breed (${at.length} matings)`);
    const window = { startFraction: 0.9, endFraction: 0.1 };
    for (const progress of at) {
      assert.ok(inBreedingWindow(progress, window), `conceived at ${progress.toFixed(3)}`);
    }
    assert.ok(
      at.some((p) => p >= 0.9) && at.some((p) => p < 0.1),
      'and on both sides of it',
    );
  });

  test('the same species breeds year-round with the mechanism switched off', () => {
    const at = conceptions(SEASONAL.id, { breedingEnabled: false });
    assert.ok(at.some((p) => !inBreedingWindow(p, WINDOW)), 'the window is not being honoured');
  });

  test('a species with no window breeds right through the year', () => {
    const at = conceptions(YEAR_ROUND.id);
    assert.ok(at.some((p) => !inBreedingWindow(p, WINDOW)), 'and is not accidentally seasonal');
  });

  test('⚠⚠ birth synchrony emerges: nothing synchronizes it', () => {
    // The whole claim of §3.11. No mechanism anywhere groups births; they land
    // where they land because conception is compressed and gestation is constant,
    // so the calving season is the rut shifted by `gestationTicks` and nothing
    // else had to be built.
    const engine = sandbox();
    pair(engine, SEASONAL.id);
    const births = yearFractionsOf(engine, EventTypes.ENTITY_BORN, TICKS_PER_YEAR * 2);

    assert.ok(births.length >= 2, `calves were born (${births.length})`);
    const offset = GESTATION / TICKS_PER_YEAR;
    const calving = { startFraction: WINDOW.startFraction + offset, endFraction: WINDOW.endFraction + offset };
    for (const progress of births) {
      assert.ok(inBreedingWindow(progress, calving), `born at ${progress.toFixed(3)}, outside the calving season`);
    }
    // And the season is genuinely narrow — a quarter of the year, not the year.
    const spread = Math.max(...births) - Math.min(...births);
    assert.ok(spread < 0.3, `all within a quarter of the year (${spread.toFixed(3)})`);
  });

  test('a pregnancy carried past the window’s end is still delivered', () => {
    // The window gates conception, never gestation. A rule that could end a
    // pregnancy at the season boundary would be a different and much worse
    // mechanism, and this is what stops one being added by accident.
    const engine = sandbox();
    const { female } = pair(engine, SEASONAL.id);
    // Conceive late enough that the birth falls outside the window.
    engine.step(Math.round(TICKS_PER_YEAR * WINDOW.endFraction) - 5);
    assert.notEqual(female.gestationUntil, null, 'pregnant, just before the season closes');
    const born = yearFractionsOf(engine, EventTypes.ENTITY_BORN, GESTATION + 5);
    assert.equal(born.length, 1, 'the calf arrives out of season');
    assert.ok(!inBreedingWindow(born[0], WINDOW), 'and it really is out of season');
  });

  test('out of season she does not go looking either', () => {
    // The reason the gate lives in `isReproductivelyReady` rather than in the
    // reproduction system: the decision system reads the same predicate, so a
    // female out of season does not walk to a male she is going to refuse. Two
    // copies of that rule would drift, exactly as `drinkRange` did (D11).
    const seekMateUtility = (tick) => {
      const engine = sandbox();
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      engine.registerSystem(
        new DecisionSystem({
          ...engine.config.decision,
          ...engine.config.behavior,
          foodMinLevel: CONFIG.perception.foodMinLevel,
          breedingEnabled: true,
        }),
      );
      // Far enough apart that she has to walk, near enough to perceive him.
      const female = spawn(engine, SEASONAL.id, Sexes.FEMALE, { x: 16, y: 16 });
      spawn(engine, SEASONAL.id, Sexes.MALE, { x: 20, y: 16 });
      engine.clock.setTick(tick);
      engine.step(1);
      return female.utilityBreakdown.seekMate;
    };
    assert.ok(seekMateUtility(Math.round(TICKS_PER_YEAR * 0.3)) > 0, 'in season she goes to him');
    assert.equal(seekMateUtility(Math.round(TICKS_PER_YEAR * 0.8)), 0, 'out of season she does not');
  });

  test('she enters the window at full choosiness', () => {
    // Not built — it falls out of the search clock stopping while she is not
    // receptive, which is what `mateSearchSince = null` already did for a female
    // who spent a gestation unavailable.
    const engine = sandbox();
    const { female } = pair(engine, SEASONAL.id);
    engine.step(Math.round(TICKS_PER_YEAR * 0.8));
    assert.equal(female.mateSearchSince, null, 'no standard has been eroding all year');
  });
});

describe('breeding windows: in the shipped world', () => {
  // ⚠ **This block used to assert the demo byte-identical with the mechanism off,
  // and batch 3 took that reading away**, exactly as phase 12 predicted: the
  // wildebeest declares a window, so the arms now diverge by design. What replaces
  // it is the claim that still holds.
  const BATCH2 = [
    { speciesId: 'herbivore.gazelle', count: 120 },
    { speciesId: 'herbivore.buffalo', count: 35 },
    { speciesId: 'predator.leopard', count: 8 },
    { speciesId: 'predator.lion', count: 8 },
    { speciesId: 'scavenger.vulture', count: 10 },
    { speciesId: 'scavenger.hyena', count: 6 },
  ];

  test('exactly one species breeds seasonally, and the rest breed year-round', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const seasonal = engine.species.all().filter((s) => breedingWindowOf(s.reproduction) !== null);
    assert.deepEqual(seasonal.map((s) => s.id), ['herbivore.wildebeest']);
    // ⚠ And its window wraps the year, which is the case the mechanism was built
    // to allow and the shipped roster now exercises.
    const rut = breedingWindowOf(seasonal[0].reproduction);
    assert.ok(rut.startFraction > rut.endFraction, 'late winter into early summer');
  });

  test('⚠ a world with no wildebeest is byte-identical with the mechanism switched off', () => {
    // ⚠ Strings rather than `deepEqual`: when these do differ, `deepEqual` builds a
    // diff of two ~650 KB object graphs and exhausts the heap before reporting.
    const on = createDemoSimulation({ seed: 42, config: { demo: { founding: BATCH2 } } });
    const off = createDemoSimulation({
      seed: 42,
      config: { demo: { founding: BATCH2 }, breeding: { enabled: false } },
    });
    on.step(400);
    off.step(400);
    assert.equal(
      JSON.stringify(captureSimulationState(on).entities),
      JSON.stringify(captureSimulationState(off).entities),
    );
  });

  test('the shipped defaults are the ones the module documents', () => {
    assert.deepEqual({ ...CONFIG.breeding }, { ...DEFAULT_BREEDING });
    assert.equal(CONFIG.reproduction.breedingWindow, null);
  });
});
