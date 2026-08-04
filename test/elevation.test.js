/**
 * Elevation and climbing (A67, phase T2 of TREES-FLIGHT-VULTURE-PLAN.md).
 *
 * Three claims, and the third is the one that would otherwise be discovered as a
 * population number three subsystems from its cause:
 *
 *   1. **A treed animal is out of reach**, in both directions — it is not prey
 *      and it is not a threat — and a carcass cached in a tree feeds climbers
 *      and nobody else.
 *   2. **Climbing is not an action.** It has no utility, competes with nothing,
 *      and is derived every tick from the action the animal already chose.
 *   3. ⚠⚠ **Everything else about being seen is untouched** — mate candidates,
 *      guardians, the neighbour list. That is **A63**, and it is asserted here
 *      rather than trusted, because phase 14 added a condition to perception's
 *      shared gate for exactly this kind of reason and sterilised the species it
 *      was written for.
 *
 * The mechanism is asserted directly rather than through a survival number: no
 * shipped species declares `climbs`, so nothing here can be demonstrated by
 * running the demo and looking at populations (§20 step 4).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { CANOPY, GROUND, canClimb, elevationFor, shareElevation } from '../src/simulation/locomotion/climbing.js';
import { isEligiblePrey, isReachablePrey } from '../src/simulation/predation/predation.js';
import { reachesCarcass, isAvailableTo, DEFAULT_POSSESSION } from '../src/simulation/predation/possession.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

/** A cat that climbs and hunts the grazer below. */
const CLIMBER = Object.freeze({
  id: 'test.climber',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze(['test.grazer']),
  climbs: true,
  bodyMass: 60,
  baseSpeed: 1.3,
  maxEnergy: 160,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 10 }),
  comfortMin: -3,
  comfortMax: 24,
  matePreference: Object.freeze({ trait: 'speed', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/** The same animal, grounded — the control for every "because it climbs" claim. */
const GROUNDLING = Object.freeze({ ...CLIMBER, id: 'test.groundling', climbs: undefined });

/** Something for the climber to hunt, and something to be hunted by. */
const GRAZER = Object.freeze({
  ...CLIMBER,
  id: 'test.grazer',
  diet: 'herbivore',
  preySpeciesIds: Object.freeze([]),
  climbs: undefined,
  bodyMass: 30,
});

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

function sandbox({ seed = 3, config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 64, height: 64 }, terrain: { ...FLAT_TERRAIN }, ...config },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, CLIMBER, GROUNDLING, GRAZER], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return engine;
}

function spawn(engine, { speciesId, x, y, ...overrides }) {
  const species = engine.species.require(speciesId);
  const g = genome();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId,
    x,
    y,
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
    energy: species.maxEnergy * 0.5,
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

/** Paint one cell as a tree, since a flat sandbox has none. */
function plantTree(engine, cellX, cellY) {
  const terrain = engine.world.terrain;
  const real = terrain.codeAt.bind(terrain);
  terrain.codeAt = (x, y) => (x === cellX && y === cellY ? TerrainType.TREE : real(x, y));
}

describe('elevation: the predicates', () => {
  test('a species climbs only if it says so, and `climbs` is a bare per-species field', () => {
    const engine = sandbox();
    assert.equal(canClimb(engine.species.require(CLIMBER.id)), true);
    assert.equal(canClimb(engine.species.require(GROUNDLING.id)), false);
    // ⚠ Every shipped species is a groundling — the mechanism is inert until one
    // declares otherwise, which is what makes T2 measurable against itself.
    for (const species of engine.species.all()) {
      if (species.id.startsWith('test.')) continue;
      assert.equal(canClimb(species), false, `${species.id} must not climb yet`);
    }
  });

  test('sharing an elevation is symmetric — a treed hunter cannot reach the ground either', () => {
    const ground = { elevation: GROUND };
    const canopy = { elevation: CANOPY };
    assert.equal(shareElevation(ground, ground), true);
    assert.equal(shareElevation(canopy, canopy), true);
    assert.equal(shareElevation(ground, canopy), false);
    assert.equal(shareElevation(canopy, ground), false);
  });

  test('elevation is derived from the action, so a climber only goes up for a reason', () => {
    const engine = sandbox();
    plantTree(engine, 10, 10);
    const cat = spawn(engine, { speciesId: CLIMBER.id, x: 10.5, y: 10.5 });
    const species = engine.species.require(CLIMBER.id);
    // The actions that keep it aloft, and a sample of those that do not.
    for (const action of ['rest', 'shelter', 'hide', 'flee']) {
      cat.action = action;
      assert.equal(elevationFor(engine.world, cat, species, true), CANOPY, `${action} keeps it up the tree`);
    }
    for (const action of ['wander', 'seekFood', 'eat', 'drink', 'seekMate', 'stalk', 'chase']) {
      cat.action = action;
      assert.equal(elevationFor(engine.world, cat, species, true), GROUND, `${action} brings it down`);
    }
  });

  test('and only over a tree, and only for a climber, and only with the switch on', () => {
    const engine = sandbox();
    plantTree(engine, 10, 10);
    const world = engine.world;
    const onTree = spawn(engine, { speciesId: CLIMBER.id, x: 10.5, y: 10.5 });
    const offTree = spawn(engine, { speciesId: CLIMBER.id, x: 20.5, y: 20.5 });
    const grounded = spawn(engine, { speciesId: GROUNDLING.id, x: 10.5, y: 10.5 });
    for (const entity of [onTree, offTree, grounded]) entity.action = 'rest';
    assert.equal(elevationFor(world, onTree, engine.species.require(CLIMBER.id), true), CANOPY);
    assert.equal(elevationFor(world, offTree, engine.species.require(CLIMBER.id), true), GROUND, 'no tree, no canopy');
    assert.equal(elevationFor(world, grounded, engine.species.require(GROUNDLING.id), true), GROUND, 'cannot climb');
    assert.equal(elevationFor(world, onTree, engine.species.require(CLIMBER.id), false), GROUND, 'switch off');
  });
});

describe('elevation: what it gates', () => {
  test('a treed animal is neither prey nor threat, in both directions', () => {
    const hunter = { elevation: GROUND, bodyMass: 60 };
    const prey = { elevation: GROUND, bodyMass: 30 };
    assert.equal(isEligiblePrey(hunter, prey, null), true);
    assert.equal(isReachablePrey(hunter, prey), true);

    prey.elevation = CANOPY;
    assert.equal(isEligiblePrey(hunter, prey, null), false, 'a treed animal is not prey');
    assert.equal(isReachablePrey(hunter, prey), false);

    // ⚠ And the mirror: an elevation flag carries no height, so there is no
    // ambush *from* a branch. A treed predator has to come down.
    hunter.elevation = CANOPY;
    prey.elevation = GROUND;
    assert.equal(isEligiblePrey(hunter, prey, null), false, 'a treed hunter reaches nothing below');
  });

  test('a cached carcass feeds climbers and nobody else', () => {
    const engine = sandbox();
    const cached = { kind: 'carcass', elevation: CANOPY, edibleMass: 40, x: 10, y: 10, possessorId: null };
    const onGround = { ...cached, elevation: GROUND };
    const cat = spawn(engine, { speciesId: CLIMBER.id, x: 10.5, y: 10.5 });
    const thief = spawn(engine, { speciesId: GROUNDLING.id, x: 10.5, y: 10.5 });

    assert.equal(reachesCarcass(engine.world, cached, cat), true, 'the climber gets at its cache');
    assert.equal(reachesCarcass(engine.world, cached, thief), false, '⚠ the clan does not');
    assert.equal(reachesCarcass(engine.world, onGround, thief), true, 'and an ordinary body is fair game');
  });

  test('⚠ the decision system and the feeding system agree about a cache, whatever possession says', () => {
    // D11: if these two disagree the animal walks to a body it is then refused
    // and starves choosing `eat`. `isAvailableTo` folds reachability in, so the
    // answer is the same with possession on and off.
    const engine = sandbox();
    const cached = { kind: 'carcass', elevation: CANOPY, edibleMass: 40, x: 10, y: 10, possessorId: null };
    const thief = spawn(engine, { speciesId: GROUNDLING.id, x: 10.5, y: 10.5 });
    for (const enabled of [true, false]) {
      const possession = { ...DEFAULT_POSSESSION, enabled };
      assert.equal(isAvailableTo(engine.world, cached, thief, possession), false, `possession enabled=${enabled}`);
    }
  });

  test('an animal in the canopy does not step, and coming down is choosing to go somewhere', () => {
    const engine = sandbox();
    plantTree(engine, 10, 10);
    engine.registerSystem(new MovementSystem({ climbing: true }));
    const cat = spawn(engine, { speciesId: CLIMBER.id, x: 10.5, y: 10.5 });

    cat.action = 'rest';
    cat.moveIntent = { heading: 0, ttl: 5, moving: true, sprint: false };
    engine.step(1);
    assert.equal(cat.elevation, CANOPY, 'it went up');
    assert.equal(cat.x, 10.5, 'and did not move while up there');
    assert.equal(cat.lastMoveDistance, 0);
    // ⚠ Not a *refused* step: a refusal sets `intent.refused`, which the decision
    // system reads as an obstacle to deflect around (A65). There is no obstacle.
    assert.notEqual(cat.moveIntent.refused, true);

    cat.action = 'wander';
    engine.step(1);
    assert.equal(cat.elevation, GROUND, 'it came down');
    assert.notEqual(cat.x, 10.5, 'and moved');
  });
});

describe('⚠⚠ elevation: A63 — what it must NOT gate', () => {
  test('a treed animal is still seen, still a mate candidate, and still a guardian', () => {
    // ⚠ This is the regression guard the phase owes. Everything an animal knows
    // about another comes through one test in `PerceptionSystem`; a condition
    // added *there* gates mate choice and guardianship as well as predation, and
    // the failure reads as a population number rather than as an error. Phase 14
    // shipped that bug and the leopard population fell 27 → 19.
    const engine = sandbox();
    engine.registerSystem(new PerceptionSystem({ ...engine.config.perception }));
    const cat = spawn(engine, { speciesId: CLIMBER.id, x: 10.5, y: 10.5, sex: Sexes.FEMALE });
    const mate = spawn(engine, { speciesId: CLIMBER.id, x: 12.5, y: 10.5, sex: Sexes.MALE });
    const cub = spawn(engine, { speciesId: CLIMBER.id, x: 11.5, y: 10.5, lifeStage: 'juvenile', age: 100 });
    cub.guardianId = cat.id;

    const seenFrom = (id) => engine.world.perception.get(id);
    engine.step(1);
    const before = seenFrom(cub.id);
    assert.ok(before.guardian, 'the cub can see its mother on the ground');
    assert.ok(seenFrom(cat.id).mateCandidates.some((c) => c.id === mate.id), 'and she can see a mate');

    // Now put her up a tree and change nothing else.
    cat.elevation = CANOPY;
    engine.step(1);
    assert.ok(seenFrom(cub.id).guardian, '⚠ a treed mother is still a findable guardian');
    assert.ok(
      seenFrom(cat.id).mateCandidates.some((c) => c.id === mate.id),
      '⚠ and still finds a mate — a cryptic solitary species that hid from itself stopped breeding at phase 14',
    );
    assert.ok(seenFrom(mate.id).nearestAnimal, 'and is still simply visible');
  });

  test('but she is no longer huntable, which is the whole mechanism', () => {
    const engine = sandbox();
    engine.registerSystem(new PerceptionSystem({ ...engine.config.perception }));
    const cat = spawn(engine, { speciesId: CLIMBER.id, x: 10.5, y: 10.5 });
    const grazer = spawn(engine, { speciesId: GRAZER.id, x: 12.5, y: 10.5 });

    engine.step(1);
    assert.equal(engine.world.perception.get(cat.id).nearestPrey?.id, grazer.id, 'it hunts the grazer');
    assert.equal(engine.world.perception.get(grazer.id).nearestThreat?.id, cat.id, 'and the grazer fears it');

    grazer.elevation = CANOPY;
    engine.step(1);
    assert.equal(engine.world.perception.get(cat.id).nearestPrey, null, 'a treed grazer is not prey');
    assert.equal(engine.world.perception.get(grazer.id).nearestThreat, null, 'and has nothing to fear');
  });
});
