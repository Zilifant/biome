/**
 * Forage guilds and habitat preference (PLAN-SPECIES.md §3.3 and §3.4, phase 9;
 * DOCS A49).
 *
 * Two mechanisms, one phase, and one shared shape: a species says what *ground*
 * it wants — which maturity of grass, which terrain — and existing chokepoints
 * read the answer. Both are switchable at world level, and the tests below are
 * organized around the three claims that matter:
 *
 *   1. **A species that declares nothing is exactly unaffected**, and the switches
 *      restore that state for one that does. This is the identity discipline D16
 *      and D30 record, and it is what makes the phase measurable against itself.
 *   2. **The preference is a discount, never a veto** — a starving animal still
 *      eats grass it dislikes. A hard window would starve a short-grass grazer in
 *      a green spring, which is a cliff rather than a preference.
 *   3. **It is not inert** (§1.2, A34, A57). The mechanism is asserted to change
 *      what the *demo* animals actually do, not merely to resolve correctly —
 *      because "implemented, tested, and never fires" is a failure mode this
 *      project has shipped more than once.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MigrationSystem } from '../src/simulation/systems/MigrationSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { forageGradient, habitatGradient, SAMPLE_DIRECTIONS } from '../src/simulation/migration/migration.js';
import {
  DEFAULT_SPAN,
  NEUTRAL_QUALITY,
  forageOf,
  forageQuality,
  forageQualityAt,
} from '../src/simulation/habitat/forage.js';
import { NEUTRAL_WEIGHT, habitatOf, habitatWeightForCode } from '../src/simulation/habitat/habitat.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;
/** The demo's own habitat cue reference, read rather than restated (D11). */
const HABITAT_CUE_REFERENCE = CONFIG.habitat.cueReference;
const GAZELLE = getSpecies('herbivore.gazelle');
const BUFFALO = getSpecies('herbivore.buffalo');

/** A grazer that wants the short flush, stated in data and nothing else. */
const SHORT_GRASS = Object.freeze({
  id: 'test.shortgrass',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 30,
  baseSpeed: 1.2,
  maxEnergy: 100,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 6 }),
  comfortMin: 2,
  comfortMax: 27,
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: true, tracksWater: false, cueRadius: 18, dispersalTicks: 400 }),
  forage: Object.freeze({ preferredBiomass: 2, span: 3 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/**
 * The same animal able to live on the tall coarse sward — the other end of the
 * guild. ⚠ Its preference is *tolerance*, not a taste for rank grass: the falloff
 * is one-sided, so this species discriminates hardly at all. What keeps a big
 * tolerant grazer off a cropped sward is mass-scaled intake, not a preference.
 */
const TALL_GRASS = Object.freeze({
  ...SHORT_GRASS,
  id: 'test.tallgrass',
  forage: Object.freeze({ preferredBiomass: 9, span: 3 }),
});

/** The same animal with no preference at all — the control species. */
const ANY_GRASS = Object.freeze({ ...SHORT_GRASS, id: 'test.anygrass', forage: undefined });

/** A cover animal, with the cue radius its preference needs to act through. */
const COVER_DWELLER = Object.freeze({
  ...ANY_GRASS,
  id: 'test.coverdweller',
  habitat: Object.freeze({ ground: 0.7, cover: 1.6 }),
});

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/** Teach one engine about an invented species (the roster is a static import, A50). */
function withSpecies(engine, ...definitions) {
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...definitions], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return registry;
}

/** A flat, featureless world, so the only signal is the one a test paints. */
function sandbox({ seed = 4, config = {}, species = [SHORT_GRASS, TALL_GRASS, ANY_GRASS, COVER_DWELLER] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { ...FLAT_TERRAIN },
      ...config,
    },
  });
  withSpecies(engine, ...species);
  return engine;
}

function spawn(engine, { speciesId = SHORT_GRASS.id, energyFraction = 0.5, ...overrides } = {}) {
  const species = engine.species.require(speciesId);
  const g = genome();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId,
    heading: 0,
    lifeStage: 'adult',
    age: 2000,
    sex: Sexes.FEMALE,
    genome: g,
    traits: expressGenome(g),
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy * energyFraction,
    maxHealth: species.maxHealth,
    health: species.maxHealth,
    maxHydration: species.maxHydration,
    hydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** Set one cell's standing crop, clamped to what the cell can hold. */
function setBiomass(engine, cellX, cellY, amount) {
  const vegetation = engine.world.vegetation;
  vegetation.consumeAt(cellX, cellY, Number.MAX_SAFE_INTEGER);
  vegetation.addAt(cellX, cellY, amount);
  return vegetation.biomassAt(cellX, cellY);
}

/**
 * Replace the vegetation field's biomass reader with a function of `x`, so a
 * gradient test states the standing crop it means to test instead of inferring it
 * from seeded fertility. The same stubbing `migration.test.js` uses to count grid
 * reads.
 */
function paintZones(engine, biomass) {
  engine.world.vegetation.biomassAt = (cellX) => biomass(cellX);
}

/** Perception + decision, wired exactly as the fixture wires them. */
function decisionSystems(engine) {
  engine.registerSystem(new PerceptionSystem({ ...engine.config.perception, neonatalConcealment: engine.config.parenting.concealment }));
  engine.registerSystem(
    new DecisionSystem({
      ...engine.config.decision,
      ...engine.config.behavior,
      foodMinLevel: engine.config.perception.foodMinLevel,
      drinkRange: engine.config.hydration.drinkRange,
      carcassRange: engine.config.feeding.carcassRange,
      foragePreference: engine.config.forage.enabled,
      forageQualityFloor: engine.config.forage.qualityFloor,
      neonatalConcealment: engine.config.parenting.concealment,
    }),
  );
}

/** The `eat` utility of one animal standing on a cell of a given standing crop. */
function eatUtilityAt(biomass, { speciesId = SHORT_GRASS.id, energyFraction = 0.6, config = {} } = {}) {
  const engine = sandbox({ config });
  decisionSystems(engine);
  const id = spawn(engine, { speciesId, energyFraction, x: 32.5, y: 32.5 });
  setBiomass(engine, 32, 32, biomass);
  engine.step(1);
  const entity = engine.world.entities.get(id);
  return { eat: entity.utilityBreakdown.eat, wander: entity.utilityBreakdown.wander, action: entity.action };
}

function angleBetween(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

describe('forage guilds: the maturity axis', () => {
  test('quality is one-sided: ideal at and below the preference, floored a span above it', () => {
    const preference = { preferredBiomass: 3, span: 4 };
    const near = (actual, expected, what) =>
      assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: expected ~${expected}, got ${actual}`);
    assert.equal(forageQuality(3, preference, 0.25), 1, 'exactly what it wants');
    assert.equal(forageQuality(1, preference, 0.25), 1, 'and shorter still is just as good');
    // ⚠ The low side is flat *on purpose*, and it is the correction of a symmetric
    // window that was built first: a nearly-bare cell already gives an animal
    // almost nothing, because `consumeAt` can only hand back the biomass that is
    // there, so discounting the utility as well charges it twice for one fact. The
    // two-sided version cost the demo seven seeds in ten (see habitat/forage.js).
    assert.equal(forageQuality(0, preference, 0.25), 1, 'bare ground is not *disliked*, just empty');
    near(forageQuality(7, preference, 0.25), 0.25, 'a span above → the floor');
    assert.equal(forageQuality(50, preference, 0.25), 0.25, 'never below the floor, however rank the cell');
    // Monotonic above the peak, which is what makes it a preference rather than a
    // threshold.
    assert.ok(forageQuality(4, preference, 0.25) > forageQuality(5, preference, 0.25));
  });

  test('a tolerant grazer accepts what a fastidious one discounts', () => {
    // ⚠ Stated as tolerance rather than as opposite tastes, which is what the
    // one-sided falloff actually gives: the tall-grass species is *indifferent*
    // where the short-grass one is fussy. The other half of the succession — a big
    // grazer unable to make a living on a cropped sward — is already carried by
    // mass-scaled intake (`feeding.intakeRate` × (mass/reference)^0.75), so it needs
    // no preference term and gets none.
    const short = forageOf(new SpeciesRegistry([SHORT_GRASS], CONFIG).get(SHORT_GRASS.id));
    const tall = forageOf(new SpeciesRegistry([TALL_GRASS], CONFIG).get(TALL_GRASS.id));
    const floor = CONFIG.forage.qualityFloor;
    assert.ok(forageQuality(2, short, floor) > forageQuality(8, short, floor), 'the flush beats the sward for a gazelle');
    assert.equal(forageQuality(8, tall, floor), forageQuality(2, tall, floor), 'and a tolerant grazer sees no difference');
    assert.ok(forageQuality(8, tall, floor) > forageQuality(8, short, floor), 'rank grass is worth more to the tolerant one');
  });

  test('⚠ a poor world holds no coarse grass, so nothing in it is discounted', () => {
    // The failure that rejected the ratio the plan proposed. `biomass / capacity`
    // reads every ungrazed cell as rank whatever the world's productivity, so in the
    // sparse-forage selection sandbox (`vegetation.capacity: 1.0`) the gazelle
    // discounted the only food there was and went extinct inside 5000 ticks.
    // Standing crop degrades the safe way, and this pins it.
    const engine = sandbox({ config: { vegetation: { capacity: 1 } } });
    const preference = forageOf(engine.species.require(SHORT_GRASS.id));
    let worst = 1;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        engine.world.vegetation.addAt(x, y, 1e6); // every cell grown out to its ceiling
        worst = Math.min(worst, forageQualityAt(engine.world, x, y, preference, CONFIG.forage.qualityFloor));
      }
    }
    assert.equal(worst, NEUTRAL_QUALITY, 'a lawn is a lawn, however full it is');
  });

  test('a species that declares nothing has no preference, and no preference is exactly the identity', () => {
    const registry = new SpeciesRegistry([ANY_GRASS, SHORT_GRASS], CONFIG);
    assert.equal(forageOf(registry.get(ANY_GRASS.id)), null, 'no forage field, no preference');
    assert.equal(forageOf(undefined), null, 'nor for an unknown species');
    assert.equal(forageOf({ forage: { preferredBiomass: 3, span: 0 } }), null, 'a zero span is no preference');
    // ⚠ `1` exactly, and reached without touching the grid — the D16 identity that
    // lets a roster which states nothing be provably unchanged.
    assert.equal(forageQuality(9, null, 0.3), NEUTRAL_QUALITY);
    const engine = sandbox();
    let reads = 0;
    const vegetation = engine.world.vegetation;
    const realBiomassAt = vegetation.biomassAt.bind(vegetation);
    vegetation.biomassAt = (...args) => {
      reads += 1;
      return realBiomassAt(...args);
    };
    assert.equal(forageQualityAt(engine.world, 10, 10, null, 0.3), NEUTRAL_QUALITY);
    assert.equal(reads, 0, 'a species with no preference does not even read the field');
    assert.equal(forageOf(registry.get(SHORT_GRASS.id)).span, 3, 'a stated span is used');
    assert.equal(
      forageOf({ forage: { preferredBiomass: 5 } }).span,
      DEFAULT_SPAN,
      'and an unstated one falls back to a deliberately wide default',
    );
  });
});

describe('forage guilds: what it changes about eating', () => {
  test('rank grass is worth less to a short-grass grazer than the flush is', () => {
    const flush = eatUtilityAt(1.5);
    const rank = eatUtilityAt(1e6); // grown out to whatever the cell can hold
    assert.ok(flush.eat > rank.eat, `flush ${flush.eat} > rank ${rank.eat}`);
  });

  test('at the same hunger it settles on the flush and moves on from the sward', () => {
    // ⚠ `energyFraction: 0.8`, i.e. mildly peckish, and the number matters: the
    // discount is *scaled by hunger*, so which action wins depends on how hungry the
    // animal is. That is the mechanism, not a fragility — a hungrier animal eats the
    // rank grass (the test below), and at `forage.qualityFloor: 0.55` the crossover
    // sits around a fifth of a tank.
    assert.equal(eatUtilityAt(1.5, { energyFraction: 0.8 }).action, 'eat', 'settles on grass it likes');
    assert.equal(eatUtilityAt(1e6, { energyFraction: 0.8 }).action, 'wander', 'moves on from grass it does not');
  });

  test('a tolerant grazer stays and eats where the fastidious one moves on', () => {
    assert.equal(eatUtilityAt(1e6, { speciesId: TALL_GRASS.id, energyFraction: 0.8 }).action, 'eat');
    assert.equal(eatUtilityAt(1e6, { speciesId: SHORT_GRASS.id, energyFraction: 0.8 }).action, 'wander');
  });

  test('⚠ preference is a discount, never a veto: a starving animal eats grass it dislikes', () => {
    // The property that keeps a guild from being a cliff. A hard window would
    // produce a short-grass grazer that starves standing on food in a green spring,
    // and the floor plus the hunger scaling is what prevents it.
    const desperate = eatUtilityAt(1e6, { energyFraction: 0.05 });
    assert.equal(desperate.action, 'eat', 'hunger overrides taste');
    assert.ok(desperate.eat > desperate.wander, `${desperate.eat} > ${desperate.wander}`);
  });

  test('a species with no preference is unaffected by how mature the grass is', () => {
    const flush = eatUtilityAt(1.5, { speciesId: ANY_GRASS.id });
    const rank = eatUtilityAt(1e6, { speciesId: ANY_GRASS.id });
    assert.equal(flush.eat, rank.eat, 'every cell is worth the same to it');
  });

  test('⚠ the off switch is honoured even for a species that declares a preference', () => {
    // The phase-8 lesson, asserted rather than trusted: an off switch has to sit
    // *outside* anything a species overrides, or the "off" arm silently stays on.
    // `config.forage` is global for exactly this reason (DOCS §8).
    const off = { forage: { enabled: false } };
    const flush = eatUtilityAt(1.5, { config: off });
    const rank = eatUtilityAt(1e6, { config: off });
    assert.equal(flush.eat, rank.eat, 'switched off, the two cells are identical again');
    assert.equal(flush.eat, eatUtilityAt(1.5, { speciesId: ANY_GRASS.id }).eat, 'and identical to no preference at all');
  });
});

describe('forage guilds: the long-range cue', () => {
  test('⚠ the gradient steers by preference, not by biomass — the non-monotonic case', () => {
    // The reader PLAN-SPECIES §3.3 warned about. Two directions: a rank sward east
    // (7 biomass, well past this species' 2 + 3, so quality is at the floor) and
    // mid regrowth west (3, inside the falloff). On raw biomass east wins; scored,
    // west is the better ground, and an animal that steered east while preferring
    // west would oscillate.
    const engine = sandbox();
    // ⚠ The field is *stubbed* rather than painted, and the reason is worth
    // keeping: per-cell fertility varies 0.55–1, so painting every cell to the same
    // depth leaves biomass uneven, and "the richest direction" becomes whichever ray
    // happened to sample fertile ground. The first draft of this test did exactly
    // that and asserted a heading it had no right to expect.
    paintZones(engine, (x) => (x >= 38 ? 7 : x <= 26 ? 3 : 1));
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const preference = forageOf(engine.species.require(SHORT_GRASS.id));

    const raw = forageGradient(engine.world, entity, { cueRadius: 18, reference: 4 });
    assert.ok(raw, 'unscored, there is a pull');
    assert.ok(angleBetween(raw.heading, 0) < 1e-9, 'and it points east, at the most grass');

    // ⚠ A floor stated here rather than read from the config: this is a unit test of
    // the *function*, and inheriting the demo's tuning would make it re-break every
    // time that is re-tuned (it did, when `qualityFloor` moved 0.3 → 0.55).
    const scored = forageGradient(engine.world, entity, {
      cueRadius: 18,
      reference: 4,
      forage: preference,
      qualityFloor: 0.2,
    });
    assert.ok(scored, 'scored, there is still a pull');
    // Westward rather than due west: the zones are bands in `x`, so the west,
    // north-west, and south-west rays all sample the same preferred ground and
    // which spoke wins a tie is not the claim. That it points *away from the most
    // grass in the world* is.
    assert.ok(Math.cos(scored.heading) < -0.5, `expected westward, got ${scored.heading}`);
  });

  test('rank grass still beats a bare halo: the score is a product, not a veto', () => {
    // A third of seven mouthfuls beats all of half of one, and an animal that
    // walked away from the only real food in sight because it was overgrown would
    // be starving on principle.
    const engine = sandbox();
    // Rank grass east, a grazed-out halo everywhere else: the maturity is ideal to
    // the west and there is nothing there to eat.
    paintZones(engine, (x) => (x >= 38 ? 9 : 0.1));
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const scored = forageGradient(engine.world, entity, {
      cueRadius: 18,
      reference: 4,
      forage: forageOf(engine.species.require(SHORT_GRASS.id)),
      qualityFloor: 0.2,
    });
    assert.ok(scored, 'there is a pull');
    assert.ok(angleBetween(scored.heading, 0) < 1e-9, 'and it points at the food');
  });

  test('⚠ among directions that all hold rank grass, it picks the least rank one', () => {
    // The other half of non-monotonicity, and the reason `test/migration.test.js`
    // now passes `foragePreference: false` in its two single-spoke tests. When every
    // eastward ray holds grass past what a gazelle wants, "better ground" is no
    // longer one spoke: the animal spreads across the rays, taking whichever is least
    // overgrown. Measured 2026-07-29, that took the mean eastwardness of a painted
    // sandbox from ~0.2 to 0.114 — still clearly eastward, no longer due east.
    const engine = sandbox();
    // Rank everywhere to the east, ranker still to the north-east.
    paintZones(engine, (x) => (x >= 44 ? 9 : x >= 36 ? 6 : 0));
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const preference = forageOf(engine.species.require(SHORT_GRASS.id));

    const raw = forageGradient(engine.world, entity, { cueRadius: 18, reference: 4 });
    const scored = forageGradient(engine.world, entity, {
      cueRadius: 18,
      reference: 4,
      forage: preference,
      qualityFloor: 0.2,
    });
    assert.ok(raw && scored, 'both find a direction');
    assert.ok(Math.cos(scored.heading) > 0, 'still eastward, toward the food');
    // ⚠ And the *strength* is the raw biomass difference, unchanged by the scoring —
    // the split that keeps a preference from quietly weakening the forage cue.
    assert.ok(scored.strength > 0.5, `a full-strength pull, got ${scored.strength}`);
  });

  test('scoring by preference costs the ring no extra grid read at all', () => {
    // ⚠ The performance claim of using standing crop rather than a ratio: the
    // biomass this loop already reads is *both* terms, so a species with a
    // preference reads exactly the same cells as one without — the budget
    // `migration.test.js` pins, unchanged.
    const engine = sandbox();
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const vegetation = engine.world.vegetation;
    const realBiomassAt = vegetation.biomassAt.bind(vegetation);
    const countReads = (options) => {
      let reads = 0;
      vegetation.biomassAt = (...args) => {
        reads += 1;
        return realBiomassAt(...args);
      };
      forageGradient(engine.world, entity, { cueRadius: 18, reference: 4, ...options });
      vegetation.biomassAt = realBiomassAt;
      return reads;
    };
    const plain = countReads({ forage: null });
    const scored = countReads({ forage: forageOf(engine.species.require(SHORT_GRASS.id)), qualityFloor: 0.3 });
    assert.equal(plain, SAMPLE_DIRECTIONS * 2 + 1, 'one read per sample point, plus the cell underfoot');
    assert.equal(scored, plain, 'and scoring adds none');
  });
});

describe('habitat preference (A49)', () => {
  test('a weight is per terrain name; an unnamed terrain and an absent block are neutral', () => {
    const registry = new SpeciesRegistry([COVER_DWELLER, ANY_GRASS], CONFIG);
    const weights = habitatOf(registry.get(COVER_DWELLER.id));
    assert.equal(habitatWeightForCode(TerrainType.COVER, weights), 1.6);
    assert.equal(habitatWeightForCode(TerrainType.GROUND, weights), 0.7);
    assert.equal(habitatWeightForCode(TerrainType.WATER, weights), NEUTRAL_WEIGHT, 'unnamed terrain is neutral');
    assert.equal(habitatOf(registry.get(ANY_GRASS.id)), null, 'no habitat field, no preference');
    assert.equal(habitatWeightForCode(TerrainType.COVER, null), NEUTRAL_WEIGHT, 'and no preference is neutral');
  });

  test('the gradient points at preferred ground, and nowhere when the ground is uniform', () => {
    const engine = sandbox();
    const id = spawn(engine, { speciesId: COVER_DWELLER.id, x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const weights = habitatOf(engine.species.require(COVER_DWELLER.id));

    // A featureless sandbox is all ground: liking cover is no reason to go
    // anywhere, because there is none.
    assert.equal(habitatGradient(engine.world, entity, { cueRadius: 18, reference: 0.3, weights }), null);

    // Cover to the east — the same shape as the forage gradient's rich band.
    const terrain = engine.world.terrain;
    const realCodeAt = terrain.codeAt.bind(terrain);
    terrain.codeAt = (x, y) => (x > 36 ? TerrainType.COVER : realCodeAt(x, y));
    const pull = habitatGradient(engine.world, entity, { cueRadius: 18, reference: 0.3, weights });
    assert.ok(pull, 'found a direction');
    assert.ok(angleBetween(pull.heading, 0) < 1e-9, `expected due east, got ${pull.heading}`);
    assert.ok(pull.strength > 0 && pull.strength <= 1, 'a real, bounded pull');
  });

  test('⚠ a preference with no cue radius has nowhere to act, and says so by returning null', () => {
    // Three of the four shipped species set `cueRadius: 0` deliberately. Stated in
    // a test as well as in prose, because "declared a habitat and nothing happened"
    // is otherwise a puzzle rather than a documented limit.
    const engine = sandbox();
    const id = spawn(engine, { speciesId: COVER_DWELLER.id, x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const weights = habitatOf(engine.species.require(COVER_DWELLER.id));
    assert.equal(habitatGradient(engine.world, entity, { cueRadius: 0, reference: 0.3, weights }), null);
    assert.equal(habitatGradient(engine.world, entity, { cueRadius: 18, reference: 0.3, weights: null }), null);
  });

  test('a satisfied animal drifts toward the habitat it prefers, which no other cue would move it toward', () => {
    // ⚠ The reason habitat is *not* throttled by a need: hunger and thirst silence
    // the forage and water cues, and a satisfied animal is exactly the one that
    // acts on where it would rather be. This animal is full, watered, and tracks
    // no forage — so before phase 9 it had no drift at all.
    const engine = sandbox({ species: [COVER_DWELLER] });
    engine.registerSystem(
      new MigrationSystem({
        ...engine.config.migration,
        updateInterval: 1,
        habitatPreference: engine.config.habitat.enabled,
        habitatBiasWeight: engine.config.habitat.biasWeight,
        habitatCueReference: engine.config.habitat.cueReference,
      }),
    );
    const terrain = engine.world.terrain;
    const realCodeAt = terrain.codeAt.bind(terrain);
    terrain.codeAt = (x, y) => (x > 36 ? TerrainType.COVER : realCodeAt(x, y));

    const id = spawn(engine, { speciesId: COVER_DWELLER.id, energyFraction: 1, x: 32.5, y: 32.5 });
    engine.step(1);
    const entity = engine.world.entities.get(id);
    assert.ok(entity.migrationStrength > 0, 'a full animal has a reason to move after all');
    assert.ok(angleBetween(entity.migrationHeading, 0) < 1e-9, 'toward the cover');
    assert.ok(
      entity.migrationStrength <= engine.config.habitat.biasWeight + 1e-9,
      'and never harder than the cap, which sits below the forage cue',
    );
  });

  test('the off switch removes the drift entirely', () => {
    const engine = sandbox({ species: [COVER_DWELLER], config: { habitat: { enabled: false } } });
    engine.registerSystem(
      new MigrationSystem({
        ...engine.config.migration,
        updateInterval: 1,
        habitatPreference: engine.config.habitat.enabled,
      }),
    );
    const terrain = engine.world.terrain;
    const realCodeAt = terrain.codeAt.bind(terrain);
    terrain.codeAt = (x, y) => (x > 36 ? TerrainType.COVER : realCodeAt(x, y));
    const id = spawn(engine, { speciesId: COVER_DWELLER.id, energyFraction: 1, x: 32.5, y: 32.5 });
    engine.step(1);
    assert.equal(engine.world.entities.get(id).migrationStrength, 0);
  });

  test('the habitat ring is a fixed number of O(1) reads, like the forage ring', () => {
    const engine = sandbox();
    const id = spawn(engine, { speciesId: COVER_DWELLER.id, x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const terrain = engine.world.terrain;
    const realCodeAt = terrain.codeAt.bind(terrain);
    let reads = 0;
    terrain.codeAt = (x, y) => {
      reads += 1;
      return realCodeAt(x, y);
    };
    habitatGradient(engine.world, entity, {
      cueRadius: 18,
      reference: 0.3,
      weights: habitatOf(engine.species.require(COVER_DWELLER.id)),
    });
    assert.equal(reads, SAMPLE_DIRECTIONS * 2 + 1, 'one read per sample point, plus the cell underfoot');
  });
});

describe('forage guilds and habitat: not inert in the demo', () => {
  // §1.2's standing complaint is mechanisms that are implemented, tested, correct,
  // and never do visible work — A34 and A57 both. So the claim here is about the
  // *demo gazelle*, measured, rather than about resolution.
  //
  // ⚠ **Pooled over three seeds since 2026-07-30 (phase 10), and the reason is a
  // near miss worth recording.** Both claims were asserted on seed 42 alone at
  // 1500 ticks, and the cover-share margin there is the thinnest of any seed
  // (4.2% against 4.6%, where seeds 1 and 2 run a full point apart). A phase-10
  // change that fires a handful of times per thousand ticks was enough to reverse
  // it — not by weakening the mechanism, which held on the other two seeds and on
  // seed 42 at 3000 ticks, but by reshuffling one seed's trajectory. A claim about
  // a mechanism should not turn on which seed it was measured at, so it is now
  // pooled, and each seed's numbers ride in the failure message so a real
  // regression is still diagnosable from one run.
  const SEEDS = [1, 2, 42];

  function grazedCrop(seed, config) {
    const engine = createDemoSimulation({ seed, config });
    const world = engine.world;
    let total = 0;
    let ticks = 0;
    let coverTicks = 0;
    let animalTicks = 0;
    let grazerTicks = 0;
    let grazerThicket = 0;
    let grazerCued = 0;
    for (let t = 0; t < 1500; t += 1) {
      engine.step(1);
      for (const entity of world.entities.all()) {
        if (entity.kind !== 'animal' || !entity.alive) continue;
        const { cellX, cellY } = world.cellOf(entity.x, entity.y);
        const code = world.terrain.codeAt(cellX, cellY);
        // ⚠ The three *big* grazers, not every grazer: batch 3 put four species
        // on the same open ground and the ground share stopped being a clean
        // signal (see the test below), so the claim moved to thicket — and there
        // the gazelle has nothing to lose, sitting at 0.18% with the cue either
        // way, while the animals that arrived with a wide `cueRadius` have real
        // thicket time for the preference to take off them.
        if (entity.speciesId !== GAZELLE.id) {
          grazerTicks += 1;
          if (code === TerrainType.THICKET) grazerThicket += 1;
          // ⚠ **Does the cue have anything to say here?** Not where the animal
          // ended up — see the test below for why every occupancy claim this
          // suite has made expired. A non-null gradient means there is ground
          // within the cue radius this species prefers to the ground it is on,
          // which is the mechanism being *live* rather than merely wired.
          const species = world.species.get(entity.speciesId);
          const migration = species?.migration;
          if (
            habitatGradient(world, entity, {
              cueRadius: migration?.cueRadius ?? 0,
              reference: HABITAT_CUE_REFERENCE,
              weights: habitatOf(species),
            }) !== null
          ) {
            grazerCued += 1;
          }
          continue;
        }
        animalTicks += 1;
        if (code === TerrainType.COVER) coverTicks += 1;
        if (entity.action !== 'eat') continue;
        total += world.vegetation.biomassAt(cellX, cellY);
        ticks += 1;
      }
    }
    return { crop: total, eatTicks: ticks, coverTicks, animalTicks, grazerTicks, grazerThicket, grazerCued };
  }

  /** Both arms over every seed, summed — computed once and shared by both tests. */
  const arms = (() => {
    const both = { on: [], off: [], habitatOff: [] };
    for (const seed of SEEDS) {
      both.on.push(grazedCrop(seed, {}));
      both.off.push(grazedCrop(seed, { forage: { enabled: false }, habitat: { enabled: false } }));
      // ⚠ A third arm, added at phase 13: the habitat claim needs habitat switched
      // off and **forage left on**. Measuring it against the both-off arm compares
      // worlds whose animals also eat differently, which is fine for the forage
      // claim above (that arm is its control) and quietly wrong for this one.
      both.habitatOff.push(grazedCrop(seed, { habitat: { enabled: false } }));
    }
    const pool = (runs) => ({
      meanCrop: runs.reduce((sum, r) => sum + r.crop, 0) / Math.max(1, runs.reduce((sum, r) => sum + r.eatTicks, 0)),
      eatTicks: runs.reduce((sum, r) => sum + r.eatTicks, 0),
      coverShare:
        runs.reduce((sum, r) => sum + r.coverTicks, 0) / Math.max(1, runs.reduce((sum, r) => sum + r.animalTicks, 0)),
      grazerThicket: runs.reduce((sum, r) => sum + r.grazerThicket, 0),
      grazerTicks: runs.reduce((sum, r) => sum + r.grazerTicks, 0),
      grazerCued: runs.reduce((sum, r) => sum + r.grazerCued, 0),
      perSeed: runs,
    });
    return { on: pool(both.on), off: pool(both.off), habitatOff: pool(both.habitatOff) };
  })();

  /** `seed 1: 9.1% · seed 2: 5.1% · seed 42: 4.2%` — the detail behind a pooled claim. */
  const bySeed = (runs, value) => SEEDS.map((seed, i) => `seed ${seed}: ${value(runs.perSeed[i])}`).join(' · ');

  test('the gazelle grazes shorter grass with the guild on than with it off', () => {
    const { on, off } = arms;
    assert.ok(on.eatTicks > 300 && off.eatTicks > 300, 'both arms did plenty of eating');
    assert.ok(
      on.meanCrop < off.meanCrop - 0.3,
      `mean standing crop where it fed: ${on.meanCrop.toFixed(2)} on against ${off.meanCrop.toFixed(2)} off\n` +
        `  on  ${bySeed(on, (r) => (r.crop / Math.max(1, r.eatTicks)).toFixed(2))}\n` +
        `  off ${bySeed(off, (r) => (r.crop / Math.max(1, r.eatTicks)).toFixed(2))}`,
    );
  });

  test('⚠ and the habitat cue is live in the demo — but its occupancy effect is not measurable', () => {
    // ⚠⚠ **This assertion has now been moved three times, and none of the three
    // was a regression.** The history is the point, because the fix this time is
    // meant to end it:
    //
    //   1. The *gazelle's cover share*, until phase 11 added a second grazer and
    //      reversed it — a 600 kg buffalo with its own open-ground preference
    //      grazes the ground both want and pushes the smaller animal to the
    //      margin.
    //   2. The *buffalo's open-ground share*, until phase 13 put four grazers on
    //      that same ground and flattened it (78.0→79.9% buffalo, 88.3→89.7%
    //      gazelle, but 82.9→79.6% wildebeest and 80.9→74.9% zebra).
    //   3. The *grazers' thicket share*, chosen at phase 13 as the axis with
    //      "headroom and no contest" — 0.25–0.43% down to 0.05–0.18%. ⚠ That
    //      headroom is **gone**, and trees did not take it: obstacle deflection
    //      (A65, 2026-08-01) did, by stopping animals stalling against thicket
    //      edges at all. Measured 2026-08-03 with the cue *off*, thicket
    //      occupancy is **0.087%** treeless and **0.071%** wooded — both at the
    //      floor, so the arms differ by noise and which way they land is a coin
    //      flip. It passed on HEAD by a hair and trees tipped it over.
    //
    // ⚠⚠ **Every one of those three was a claim about where a species ends up,
    // and that is what keeps expiring** — an occupancy share is only a signal
    // while nothing else is competing for the same ground or removing the
    // pressure that put animals on it. Two replacements were tried here and
    // measured before either was written down:
    //
    //   * *Mean `habitat` weight of the cell underfoot.* **Rejected on
    //     evidence.** On clean HEAD it is 1.1103 with the cue on against 1.1146
    //     off — the wrong way, on every seed. The cue bends a *wander*, and an
    //     animal that wanders further crosses more of everything, so this
    //     measures travel as much as taste.
    //   * *Thicket share at higher statistics.* Also gone: 6 seeds × 3000 ticks
    //     in the wooded demo reads **0.041% on against 0.027% off**, reversed
    //     and with per-seed values spanning 0.001–0.115%.
    //
    // ⚠ **So this half no longer asserts an effect, and that is a finding rather
    // than a weakened test.** What it asserts instead is that the mechanism is
    // *live*: that there is, routinely, ground within a grazer's cue radius that
    // its own weights prefer to the ground it is standing on. If the cue were
    // unwired, mis-resolved, or handed a species with no radius, this goes to
    // zero — which is the regression worth catching. The effect it *used* to
    // demonstrate is recorded in DOCS §1.2 as open, in A34's shape: a real
    // mechanism whose demo-scale effect cannot presently be separated from noise.
    const { on } = arms;
    assert.ok(on.grazerTicks > 5000, 'there were grazers to measure');
    const share = on.grazerCued / on.grazerTicks;
    assert.ok(
      share > 0.02,
      `the habitat cue found preferable ground on only ${(100 * share).toFixed(2)}% of grazer-ticks\n` +
        `  ${bySeed(on, (r) => `${((100 * r.grazerCued) / Math.max(1, r.grazerTicks)).toFixed(2)}%`)}`,
    );
  });
});
