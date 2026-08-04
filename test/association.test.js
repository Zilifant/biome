/**
 * Heterospecific association (PLAN-SPECIES.md §3.16, phase 12) — standing with
 * animals that are not your own kind.
 *
 * The mechanism is small; what needs pinning is the **line it must not cross**.
 * Association moves a herd's centre of mass and carries an alarm, and it is not
 * allowed to touch a single thing that counts bodies — not the herd label, not
 * `groupmates`, not `adults`, and therefore not the mob. A version that quietly
 * merged the counts would look right in a demo and be wrong everywhere it
 * mattered: two species sharing one label makes every per-species herd metric
 * meaningless, and a mob is a number of animals *of the species being hunted*.
 *
 * So the suite is organized around four claims:
 *
 *   1. **A species that declares nothing is exactly unaffected**, and the world
 *      switch restores that for one that does (D16/D30) — asserted against the
 *      demo, byte for byte.
 *   2. **What association does**: a weighted centre of mass, a weaker pull, and
 *      an associate's warning carrying across the species boundary.
 *   3. **What it deliberately does not do**: labels, counts, mobs, and the
 *      *other* species (association is directional — declaring it is not
 *      agreeing to it).
 *   4. **The animal acts on it.** §1.2's standing complaint is mechanisms that
 *      are correct and never do visible work, so the last block runs the decision
 *      system and asserts a follower actually herds toward company it is not
 *      related to.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { DEFAULT_MOBBING, mobWardFor } from '../src/simulation/predation/mobbing.js';
import {
  DEFAULT_ASSOCIATION,
  associationOf,
  associationWeightFor,
  associationsIn,
} from '../src/simulation/social/association.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;

/** The big grazer that gets followed. It has no opinion about any of this. */
const GIANT = Object.freeze({
  id: 'test.giant',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 200,
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
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/** A third grazer nobody has declared anything about. */
const STRANGER = Object.freeze({ ...GIANT, id: 'test.stranger', bodyMass: 150 });

/** The small grazer that stands with the big one. Half a conspecific's worth. */
const FOLLOWER = Object.freeze({
  ...GIANT,
  id: 'test.follower',
  bodyMass: 30,
  association: Object.freeze({ [GIANT.id]: 0.5 }),
});

/** The same animal, mobbing, so "an associate is not a mobber" can be asserted. */
const MOBBING_FOLLOWER = Object.freeze({
  ...FOLLOWER,
  id: 'test.mobber',
  behavior: Object.freeze({ mobWeight: 2.4 }),
});

/** Hunts the giant and *only* the giant, so a follower can never see a threat itself. */
const HUNTER = Object.freeze({
  id: 'test.hunter',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze([GIANT.id, MOBBING_FOLLOWER.id]),
  bodyMass: 60,
  baseSpeed: 1.4,
  maxEnergy: 120,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 6 }),
  comfortMin: 0,
  comfortMax: 30,
  matePreference: Object.freeze({ trait: 'speed', span: 0.3, conditionWeight: 0.5 }),
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});

const SPECIES = [GIANT, STRANGER, FOLLOWER, MOBBING_FOLLOWER, HUNTER];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/** Teach one engine about the invented species (the roster is a static import, A50). */
function withSpecies(engine) {
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return registry;
}

/**
 * Flat ground and no grass: the only things in play are who is standing where and
 * what they are willing to stand next to. Herding is the weakest utility there
 * is, so a field with food in it would (rightly) outrank it.
 */
function sandbox({ seed = 5, config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { ...FLAT_TERRAIN },
      vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 },
      ...config,
    },
  });
  withSpecies(engine);
  return engine;
}

/** Perception + sociality: the minimum the summary needs. */
function socialSandbox({ seed = 5, config = {}, association = {} } = {}) {
  const engine = sandbox({ seed, config });
  engine.registerSystem(new PerceptionSystem(CONFIG.perception));
  engine.registerSystem(
    new SocialSystem({
      ...CONFIG.social,
      associationEnabled: association.enabled ?? CONFIG.association.enabled,
      associationSharesAlarm: association.sharesAlarm ?? CONFIG.association.sharesAlarm,
    }),
  );
  return engine;
}

function spawn(engine, speciesId, overrides = {}) {
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
    energy: species.maxEnergy * 0.8,
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

const summaryOf = (engine, entity) => engine.world.social.get(entity.id);

describe('association: what a species declares', () => {
  const resolved = (id) => new SpeciesRegistry(SPECIES, CONFIG).require(id);

  test('a species with no association has none, and an empty one is the same as none', () => {
    assert.equal(associationOf(resolved(GIANT.id)), null);
    assert.equal(associationOf(undefined), null);
    assert.equal(associationOf({ association: {} }), null, 'an empty map is null, so callers have one test');
    assert.equal(associationOf({ association: { 'test.x': 0 } }), null, 'and so is a weight of zero');
    assert.deepEqual(associationOf(resolved(FOLLOWER.id)), { [GIANT.id]: 0.5 });
  });

  test('an unnamed species is worth exactly nothing, not a neutral 1', () => {
    // ⚠ The opposite convention to `habitat`, where an unnamed terrain is neutral
    // (1). There, the weights modulate ground the animal is walking on anyway;
    // here they decide whether another animal exists for this purpose at all, and
    // the default has to be "no".
    const weights = associationOf(resolved(FOLLOWER.id));
    assert.equal(associationWeightFor(weights, GIANT.id), 0.5);
    assert.equal(associationWeightFor(weights, STRANGER.id), 0);
    assert.equal(associationWeightFor(null, GIANT.id), 0);
  });

  test('the declaring-species map holds only the species that declare', () => {
    const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], CONFIG);
    const declaring = associationsIn(registry);
    assert.deepEqual(
      [...declaring.keys()].sort(),
      [MOBBING_FOLLOWER.id, FOLLOWER.id, 'herbivore.gazelle'].sort(),
      'the invented followers, and the one shipped species that declares one',
    );
    // ⚠ The claim the early-out rests on, and batch 3 narrowed it: the map is
    // *small*, not empty. It held nothing at all until the gazelle declared an
    // association (phase 13); what still matters is that every species not in it
    // takes the untouched branch, which is seven of the eight shipped.
    const shipped = associationsIn(new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG));
    assert.deepEqual([...shipped.keys()], ['herbivore.gazelle']);
  });
});

describe('association: the herd centre', () => {
  test('an associate moves the centre of mass, at its declared weight', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, GIANT.id, { x: 34, y: 30 });
    spawn(engine, GIANT.id, { x: 34, y: 34 });
    engine.step(1);

    const summary = summaryOf(engine, follower);
    assert.equal(summary.associates, 2);
    assert.equal(summary.groupmates, 0, 'and not one of them is a groupmate');
    // ⚠ Their midpoint, *not* somewhere half way between the follower and them:
    // the weight is an exchange rate between bodies, so with only one species
    // present it cancels out of the mean entirely. What it decides is whose
    // centre wins in mixed company (below).
    assert.equal(summary.centroid.x, 34);
    assert.equal(summary.centroid.y, 32);
  });

  test('a mixed group weights the two kinds against each other', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, FOLLOWER.id, { x: 32, y: 30 });
    spawn(engine, GIANT.id, { x: 34, y: 30 });
    engine.step(1);

    const summary = summaryOf(engine, follower);
    assert.equal(summary.groupmates, 1);
    assert.equal(summary.associates, 1);
    // (1×32 + 0.5×34) / 1.5 — nearer its own kind than to the giant, which is the
    // whole meaning of a weight below 1 and the only place it has any effect.
    assert.ok(Math.abs(summary.centroid.x - (32 + 2 / 3)) < 1e-9, `centroid ${summary.centroid.x}`);
  });

  test('a species that declares nothing sees nothing, standing in the same crowd', () => {
    // ⚠ Association is **directional**. The giant is surrounded by followers and
    // is alone, because it never said otherwise — which is what the association
    // actually looks like in the field, and is one declaration rather than two.
    const engine = socialSandbox();
    const giant = spawn(engine, GIANT.id, { x: 30, y: 30 });
    spawn(engine, FOLLOWER.id, { x: 31, y: 30 });
    spawn(engine, FOLLOWER.id, { x: 30, y: 31 });
    engine.step(1);

    const summary = summaryOf(engine, giant);
    assert.equal(summary.associates, 0);
    assert.equal(summary.groupmates, 0);
    assert.equal(summary.centroid, null, 'nothing to steer at');
  });

  test('a species it did not name is still nobody', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, STRANGER.id, { x: 31, y: 30 });
    engine.step(1);
    assert.equal(summaryOf(engine, follower).associates, 0);
    assert.equal(summaryOf(engine, follower).centroid, null);
  });
});

describe('association: an attraction, never a membership', () => {
  test('a herd label never crosses the species boundary', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    const giants = [
      spawn(engine, GIANT.id, { x: 31, y: 30 }),
      spawn(engine, GIANT.id, { x: 30, y: 31 }),
      spawn(engine, GIANT.id, { x: 31, y: 31 }),
    ];
    engine.step(3);

    assert.equal(follower.groupId, null, 'standing in a herd it can never be a member of');
    const label = giants[0].groupId;
    assert.notEqual(label, null, 'while the giants have a herd of their own');
    for (const giant of giants) assert.equal(giant.groupId, label);
  });

  test('two followers keep their own label in the middle of somebody else’s herd', () => {
    const engine = socialSandbox();
    const followers = [
      spawn(engine, FOLLOWER.id, { x: 30, y: 30 }),
      spawn(engine, FOLLOWER.id, { x: 30.5, y: 30 }),
      spawn(engine, FOLLOWER.id, { x: 31, y: 30 }),
    ];
    const giants = [
      spawn(engine, GIANT.id, { x: 30, y: 31 }),
      spawn(engine, GIANT.id, { x: 30.5, y: 31 }),
      spawn(engine, GIANT.id, { x: 31, y: 31 }),
    ];
    engine.step(3);

    const theirs = followers[0].groupId;
    assert.notEqual(theirs, null);
    for (const follower of followers) assert.equal(follower.groupId, theirs);
    for (const giant of giants) assert.notEqual(giant.groupId, theirs, 'one crowd, two herds');
  });

  test('⚠ an associate is not a mobber, however many of them are standing there', () => {
    // The failure this guards against is silent and expensive: `mobbing.minMobbers`
    // reads `adults` off this summary, so counting associates there would let a
    // herd of the wrong species convince an animal to turn and face a predator
    // that none of them will help with.
    const engine = socialSandbox();
    const mobber = spawn(engine, MOBBING_FOLLOWER.id, { x: 30, y: 30 });
    const hunter = spawn(engine, HUNTER.id, { x: 31.5, y: 30 });
    spawn(engine, GIANT.id, { x: 30.5, y: 30 });
    spawn(engine, GIANT.id, { x: 29.5, y: 30 });
    spawn(engine, GIANT.id, { x: 30, y: 29.5 });
    engine.step(1);

    const summary = summaryOf(engine, mobber);
    assert.equal(summary.associates, 3, 'three big animals right beside it');
    assert.equal(summary.adults, 0, 'and no adults of its own kind at all');
    hunter.huntTargetId = mobber.id;
    const behavior = engine.species.require(MOBBING_FOLLOWER.id).behavior;
    const threat = { id: hunter.id, distance: 1.5 };
    assert.equal(
      mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, summary),
      null,
      'so there is no mob to be part of',
    );
  });
});

describe('association: shared vigilance', () => {
  /**
   * A hunter the follower is not on the menu for, close enough for a giant to see
   * and too far for the follower — so any alarm the follower ends up carrying can
   * only have come across the species boundary.
   */
  function sighting(association = {}) {
    const engine = socialSandbox({ association });
    const hunter = spawn(engine, HUNTER.id, { x: 20, y: 30 });
    const giant = spawn(engine, GIANT.id, { x: 25, y: 30 });
    const follower = spawn(engine, FOLLOWER.id, { x: 29, y: 30 });
    const stranger = spawn(engine, STRANGER.id, { x: 29, y: 31 });
    engine.step(2);
    return { engine, hunter, giant, follower, stranger };
  }

  test('an associate’s warning carries; a stranger’s does not', () => {
    const { engine, giant, follower, stranger } = sighting();
    assert.notEqual(engine.world.perception.get(giant.id).nearestThreat, null, 'the giant sees it');
    assert.equal(engine.world.perception.get(follower.id).nearestThreat, null, 'the follower cannot');
    assert.notEqual(follower.alarmedUntil, null, 'and is running anyway');
    assert.equal(follower.alarmSource.hops, 1, 'one hop, from the animal that actually saw it');
    assert.equal(stranger.alarmedUntil, null, 'while the species that declared nothing grazes on');
  });

  test('the vigilance half has its own switch, and it leaves the attraction alone', () => {
    // ⚠ The lever phase 11 wished it had: two mechanisms that arrive together
    // confound each other, so the cells are separable before anyone needs them to
    // be (§10.2's 2×2).
    const { engine, follower } = sighting({ sharesAlarm: false });
    assert.equal(follower.alarmedUntil, null, 'no warning crosses');
    assert.equal(summaryOf(engine, follower).associates, 1, 'and it is still standing with the giant');
  });

  test('the whole mechanism off is the same world as declaring nothing', () => {
    const { engine, follower } = sighting({ enabled: false });
    const summary = summaryOf(engine, follower);
    assert.equal(follower.alarmedUntil, null);
    assert.equal(summary.associates, 0);
    assert.equal(summary.centroid, null);
  });
});

describe('association: the animal acts on it', () => {
  function decisionSandbox(options = {}) {
    const engine = socialSandbox(options);
    engine.registerSystem(
      new DecisionSystem({
        ...engine.config.decision,
        ...engine.config.behavior,
        foodMinLevel: engine.config.perception.foodMinLevel,
      }),
    );
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    return engine;
  }

  test('a straggler closes on company of another species', () => {
    // The whole claim of §3.16 in one measurement: a gazelle can be pulled toward
    // a wildebeest herd. Run against the identical world with the mechanism off,
    // because a single animal in an empty field wanders and the null result is a
    // random walk rather than a stationary one.
    const distanceAfter = (association) => {
      const engine = decisionSandbox({ association });
      const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
      const giants = [];
      for (let i = 0; i < 4; i += 1) giants.push(spawn(engine, GIANT.id, { x: 34 + (i % 2), y: 30 + i * 0.5 }));
      engine.step(200);
      const cx = giants.reduce((sum, g) => sum + g.x, 0) / giants.length;
      const cy = giants.reduce((sum, g) => sum + g.y, 0) / giants.length;
      return Math.hypot(follower.x - cx, follower.y - cy);
    };
    const together = distanceAfter({});
    const apart = distanceAfter({ enabled: false });
    assert.ok(together < apart, `stayed with them (${together.toFixed(1)} vs ${apart.toFixed(1)} without)`);
  });

  test('⚠ company of another species pulls exactly as hard, at the same distance', () => {
    // Not an oversight — the finding that shaped the mechanism. The first cut
    // scaled this pull by the weight *as well*, which charges the animal twice for
    // one fact (the §3.3 error) and, measured, left every weight below ~0.58
    // unable to beat `wanderBias` at all: a 0.5 follower held station no better
    // than one with association switched off. The weight lives in the centroid and
    // nowhere else, and this test is what says so.
    const pull = (companyId) => {
      const engine = decisionSandbox();
      const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
      spawn(engine, companyId, { x: 34, y: 30 });
      spawn(engine, companyId, { x: 34, y: 30.5 });
      engine.step(1);
      return follower.utilityBreakdown.herd;
    };
    const own = pull(FOLLOWER.id);
    const other = pull(GIANT.id);
    assert.ok(own > 0, `its own kind pulls (${own})`);
    assert.equal(other, own, 'and so does a herd it is merely standing with');
  });
});

describe('association: in the shipped world', () => {
  // ⚠ **This block used to assert the demo byte-identical with the mechanism off,
  // and batch 3 took that reading away** — exactly as phase 12 said it would:
  // "takeable now and not later; the moment batch 3 gives the gazelle an
  // association the two arms diverge by design." They do. What replaces it is the
  // narrower claim that still means something.
  const BATCH2 = [
    { speciesId: 'herbivore.gazelle', count: 120 },
    { speciesId: 'herbivore.buffalo', count: 35 },
    { speciesId: 'predator.leopard', count: 8 },
    { speciesId: 'predator.lion', count: 8 },
    { speciesId: 'scavenger.vulture', count: 10 },
    { speciesId: 'scavenger.hyena', count: 6 },
  ];

  test('exactly one species declares an association, and only over species that exist', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const declaring = engine.species.all().filter((species) => associationOf(species) !== null);
    assert.deepEqual(
      declaring.map((s) => s.id),
      ['herbivore.gazelle'],
      'the small grazer follows the big ones, and the relation is directional',
    );
    // A weight naming a species that does not exist is dead data that reads as
    // biology — the same failure a `preySpeciesIds` typo would be.
    const known = new Set(engine.species.ids());
    for (const partner of Object.keys(associationOf(declaring[0]))) {
      assert.ok(known.has(partner), `${partner} is not a species in this world`);
    }
  });

  test('⚠ a world with no wildebeest and no zebra is byte-identical with it switched off', () => {
    // The property that survives, and the one that would break silently: the
    // gazelle carries an association in every world now, so this is what says it
    // costs nothing where it has no partner — which is what keeps batch 2's
    // numbers comparable across the phase boundary.
    //
    // ⚠ Compared as strings rather than with `deepEqual`. When these two *do*
    // differ, `deepEqual` tries to build a readable diff of two ~650 KB object
    // graphs and exhausts a 4 GB heap before it can report anything (2026-07-30).
    // A string compare fails in one line, which is the difference between a test
    // that tells you what broke and one that kills the runner.
    const on = createDemoSimulation({ seed: 42, config: { demo: { founding: BATCH2 } } });
    const off = createDemoSimulation({
      seed: 42,
      config: { demo: { founding: BATCH2 }, association: { enabled: false, sharesAlarm: false } },
    });
    on.step(400);
    off.step(400);
    assert.equal(
      JSON.stringify(captureSimulationState(on).entities),
      JSON.stringify(captureSimulationState(off).entities),
    );
  });

  test('and in the world that does have them, it is doing something', () => {
    // §1.2's standing complaint is mechanisms that are correct and never fire.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    let associating = 0;
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      if ((engine.world.social.get(entity.id)?.associates ?? 0) > 0) associating += 1;
    }
    assert.ok(associating > 0, 'somebody is standing with another species');
  });

  test('the shipped defaults are the ones the module documents', () => {
    assert.deepEqual({ ...CONFIG.association }, { ...DEFAULT_ASSOCIATION });
  });
});
