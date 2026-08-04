/**
 * Flight as a movement mode (phase F1 of TREES-FLIGHT-VULTURE-PLAN.md).
 *
 * Four claims, and the fourth is the one that would otherwise be found as a bird
 * standing in the middle of a lake:
 *
 *   1. **Flight is a pace, not an action.** It has no utility, competes with
 *      nothing, and is derived every tick from the action already chosen.
 *   2. **Four effects at four chokepoints that already existed** — faster travel
 *      with the terrain modifier bypassed, a wider sight radius, cheaper
 *      distance, and nothing refusing the step.
 *   3. **A flying animal is out of reach**, in both directions: not prey, taking
 *      none, and not burnt.
 *   4. ⚠⚠ **The landing invariant.** A flying animal's step is refused by
 *      nothing, so it can end a tick over rock or deep water — and "a grounded
 *      animal is on passable ground" still has to hold. It does, because
 *      `flyingFor` keeps an animal airborne while the ground beneath it is
 *      impassable, whatever it chose to do.
 *
 * ⚠ Asserted directly rather than through a population, because at F1 no shipped
 * species declares `flight` (§20 step 4). The test species below is what makes
 * the mechanism observable at all; the vulture arrives in F2.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import {
  DEFAULT_FLIGHT,
  canFly,
  flightOf,
  flyingFor,
  isAirborne,
  isOffGround,
} from '../src/simulation/locomotion/flight.js';
import { CANOPY } from '../src/simulation/locomotion/climbing.js';
import { stepLength, stepRefused, normalizeStepRules } from '../src/simulation/locomotion/steps.js';
import { isEligiblePrey, isReachablePrey } from '../src/simulation/predation/predation.js';
import { SPECIES_BLOCKS } from '../src/simulation/config/species/schema.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

/** A bird: fast on the wing, far-sighted on the wing, cheap on the wing. */
const BIRD = Object.freeze({
  id: 'test.bird',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze([]),
  flight: Object.freeze({ speedMultiplier: 2, visionMultiplier: 1.5, moveCostFactor: 0.5 }),
  bodyMass: 6,
  baseSpeed: 1,
  maxEnergy: 60,
  maxHealth: 60,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 8 }),
  comfortMin: 5,
  comfortMax: 32,
  matePreference: Object.freeze({ trait: 'speed', span: 0.35, conditionWeight: 0.8 }),
  territory: Object.freeze({ defends: false, rangeRadius: 30, settleTicks: 600 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 500 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});

/** The same animal, wingless — the control for every "because it flies" claim. */
const WALKER = Object.freeze({ ...BIRD, id: 'test.walker', flight: undefined });

/** Something a bird could be mistaken for prey by, and vice versa. */
const RAPTOR = Object.freeze({
  ...BIRD,
  id: 'test.raptor',
  preySpeciesIds: Object.freeze(['test.bird']),
  bodyMass: 40,
});

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

function sandbox({ seed = 7, config = {}, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 64, height: 64 }, terrain: { ...FLAT_TERRAIN }, ...config },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, BIRD, WALKER, RAPTOR], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  for (const system of systems) engine.registerSystem(system);
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

/**
 * The first cell of a given terrain code, as a continuous centre position.
 *
 * ⚠ A *real* cell in a sandbox generated to contain some, rather than a stubbed
 * `codeAt`: `isPassable` and `speedModifierAt` read the cell array directly (they
 * are the hot path), so overriding the accessor would produce a cell that is a
 * thicket to `isThicketAt` and open ground to everything this suite is testing.
 */
function findCell(engine, code) {
  const terrain = engine.world.terrain;
  for (let cellY = 0; cellY < terrain.height; cellY += 1) {
    for (let cellX = 0; cellX < terrain.width; cellX += 1) {
      if (terrain.codeAt(cellX, cellY) === code) return { x: cellX + 0.5, y: cellY + 0.5 };
    }
  }
  throw new Error(`the sandbox has no cell of terrain code ${code}`);
}

describe('flight: the predicate', () => {
  test('a species flies only if it declares a block, and the block is a per-species field', () => {
    const engine = sandbox();
    assert.equal(canFly(engine.species.require(BIRD.id)), true);
    assert.equal(canFly(engine.species.require(WALKER.id)), false);
    assert.equal(flightOf(engine.species.require(WALKER.id)), null);
    // ⚠⚠ `flight` must NOT be a SPECIES_BLOCK. It is an object and therefore
    // looks exactly like one, but a species block beats the config (DOCS §8), so
    // listing it would let any declaring species override
    // `config.flight.enabled: false` and leave the mechanism with no control.
    assert.ok(!SPECIES_BLOCKS.includes('flight'), 'flight is a field beside a switch, not a block');
  });

  test('an unstated multiplier is the identity, so `flight: {}` flies and gains nothing', () => {
    assert.deepEqual(DEFAULT_FLIGHT, { speedMultiplier: 1, visionMultiplier: 1, moveCostFactor: 1 });
  });

  test('flight is derived from the action: travelling is on the wing, contact is on the ground', () => {
    const engine = sandbox();
    const bird = spawn(engine, { speciesId: BIRD.id, x: 10.5, y: 10.5 });
    const species = engine.species.require(BIRD.id);
    for (const action of [
      'wander', 'seekFood', 'recallFood', 'seekWater', 'recallWater', 'patrol',
      // ⚠ These five are directed travel toward a position, and they were added
      // on measurement: with `herd` grounded, a vulture flipped ground↔air 289
      // times per 1000 animal-ticks, almost all of it `herd` against `wander`.
      'herd', 'retreat', 'leaveThicket', 'followParent', 'tend',
    ]) {
      bird.action = action;
      assert.equal(flyingFor(engine.world, bird, species, true), true, `${action} is done on the wing`);
    }
    // ⚠ The absences are the design: a flier is faster and further-sighted
    // exactly while it is not eating, drinking, breeding, resting or fighting
    // over a body. `stalk`/`chase`/`flee` are contact actions, and an aerial
    // pursuit would be a second mechanism wearing this one's clothes.
    for (const action of ['eat', 'drink', 'rest', 'hide', 'seekMate', 'defend', 'cache', 'stalk', 'chase', 'flee']) {
      bird.action = action;
      assert.equal(flyingFor(engine.world, bird, species, true), false, `${action} is done on the ground`);
    }
  });

  test('and only for a flier, and only with the switch on', () => {
    const engine = sandbox();
    const bird = spawn(engine, { speciesId: BIRD.id, x: 10.5, y: 10.5, action: 'wander' });
    const walker = spawn(engine, { speciesId: WALKER.id, x: 12.5, y: 10.5, action: 'wander' });
    assert.equal(flyingFor(engine.world, bird, engine.species.require(BIRD.id), true), true);
    assert.equal(flyingFor(engine.world, bird, engine.species.require(BIRD.id), false), false, 'switch off');
    assert.equal(flyingFor(engine.world, walker, engine.species.require(WALKER.id), true), false, 'no wings');
  });

  test('⚠⚠ the landing invariant: over ground it cannot stand on, it stays up whatever it chose', () => {
    const engine = sandbox({ config: { terrain: { ...FLAT_TERRAIN, ridges: 6 } } });
    const rock = findCell(engine, TerrainType.ROCK);
    const open = findCell(engine, TerrainType.GROUND);
    const bird = spawn(engine, { speciesId: BIRD.id, ...rock, action: 'rest' });
    const species = engine.species.require(BIRD.id);
    // `rest` is a grounded action, and there is no ground here.
    assert.equal(flyingFor(engine.world, bird, species, true), true, 'it cannot land on rock');
    bird.x = open.x;
    bird.y = open.y;
    assert.equal(flyingFor(engine.world, bird, species, true), false, 'and comes down over open ground');
  });
});

describe('flight: the four effects', () => {
  test('faster travel, and the terrain modifier is bypassed rather than replaced', () => {
    const engine = sandbox({ config: { terrain: { ...FLAT_TERRAIN, thickets: 6 } } });
    const thicket = findCell(engine, TerrainType.THICKET);
    const open = findCell(engine, TerrainType.GROUND);
    const rules = normalizeStepRules({ ...engine.config.locomotion });
    const bird = spawn(engine, { speciesId: BIRD.id, ...thicket, impairment: 0 });

    const crawling = stepLength(engine.world, bird, false, rules);
    bird.flying = true;
    const flying = stepLength(engine.world, bird, false, rules);
    // Standing in a thicket, walking is a crawl; on the wing there is no thicket.
    assert.ok(crawling < bird.speed, 'a thicket slows a walking animal');
    assert.equal(flying, bird.speed * BIRD.flight.speedMultiplier, 'and does not slow a flying one at all');

    // The same claim over open ground, where the modifier is 1: the multiplier is
    // the only difference, so "bypassed" is not hiding a speed change.
    bird.x = open.x;
    bird.y = open.y;
    bird.flying = false;
    const walking = stepLength(engine.world, bird, false, rules);
    bird.flying = true;
    assert.equal(stepLength(engine.world, bird, false, rules), walking * BIRD.flight.speedMultiplier);
  });

  test('nothing refuses the step — no rock, no thicket edge, no crowding cap', () => {
    const engine = sandbox({ config: { terrain: { ...FLAT_TERRAIN, ridges: 6, thickets: 6 } } });
    const rock = findCell(engine, TerrainType.ROCK);
    const thicket = findCell(engine, TerrainType.THICKET);
    const open = findCell(engine, TerrainType.GROUND);
    const bird = spawn(engine, { speciesId: BIRD.id, ...open });

    // All three refusals, each in turn, and then none of them.
    assert.equal(stepRefused(engine.world, bird, rock.x, rock.y, false, null), true, 'rock refuses a walker');
    assert.equal(stepRefused(engine.world, bird, thicket.x, thicket.y, false, null), true, 'so does a thicket edge');
    // A neighbour in the animal's own cell, so the crowding cap has something to
    // bite on for a step *into* it from just outside.
    const crowd = { x: open.x + 1.2, y: open.y };
    spawn(engine, { speciesId: WALKER.id, ...crowd });
    assert.equal(stepRefused(engine.world, bird, crowd.x, crowd.y, false, 1), true, 'and a full cell');

    bird.flying = true;
    assert.equal(stepRefused(engine.world, bird, rock.x, rock.y, false, 1), false, 'airborne: no rock');
    assert.equal(stepRefused(engine.world, bird, thicket.x, thicket.y, false, 1), false, 'no thicket edge');
    assert.equal(stepRefused(engine.world, bird, crowd.x, crowd.y, false, 1), false, 'no crowding cap in the sky');
  });

  test('a wider sight radius, resolved inside #perceive from the flag and the species', () => {
    const engine = sandbox({ systems: [new PerceptionSystem({ ...engine0Perception() })] });
    const bird = spawn(engine, { speciesId: BIRD.id, x: 32.5, y: 32.5 });
    // Far enough away to be outside the ground radius (8) and inside the flying
    // one (8 × 1.5 = 12).
    const distant = spawn(engine, { speciesId: WALKER.id, x: 42.5, y: 32.5 });

    engine.step(1);
    assert.equal(engine.world.perception.get(bird.id).radius, 8, 'grounded, it sees its declared radius');
    assert.equal(engine.world.perception.get(bird.id).nearestAnimal, null, 'and not that far');

    // ⚠ Perception runs *before* decision, so the flag it reads was written last
    // tick. Setting it by hand here is what the decision system would have done
    // on the previous tick, which is the one-tick lag stated in flight.js.
    bird.flying = true;
    engine.step(1);
    assert.equal(engine.world.perception.get(bird.id).radius, 12, 'on the wing it sees half again as far');
    assert.equal(engine.world.perception.get(bird.id).nearestAnimal?.id, distant.id);
  });

  test('cheap distance: the same travel costs less on the wing, and basal cost is untouched', () => {
    const cost = (flying) => {
      const engine = sandbox({ systems: [new MetabolismSystem({ ...defaultMetabolism() })] });
      const bird = spawn(engine, { speciesId: BIRD.id, x: 20.5, y: 20.5 });
      bird.flying = flying;
      bird.lastMoveDistance = 10;
      const before = bird.energy;
      engine.step(1);
      return before - bird.energy;
    };
    const walked = cost(false);
    const flown = cost(true);
    assert.ok(flown < walked, `flying 10 units (${flown}) is cheaper than walking it (${walked})`);
    // Basal cost is charged either way, so the saving is on the *travel* term
    // alone — nothing here pretends to model the energetics of flapping.
    const basal = (() => {
      const engine = sandbox({ systems: [new MetabolismSystem({ ...defaultMetabolism() })] });
      const bird = spawn(engine, { speciesId: BIRD.id, x: 20.5, y: 20.5 });
      const before = bird.energy;
      engine.step(1);
      return before - bird.energy;
    })();
    const travelWalked = walked - basal;
    const travelFlown = flown - basal;
    assert.ok(
      Math.abs(travelFlown - travelWalked * BIRD.flight.moveCostFactor) < 1e-9,
      'the travel term scales by moveCostFactor exactly',
    );
  });
});

describe('flight: what it gates, and what it must not', () => {
  test('a bird on the wing is not prey, and takes none — both directions', () => {
    const hunter = { elevation: 0, flying: false, bodyMass: 40 };
    const prey = { elevation: 0, flying: false, bodyMass: 6 };
    assert.equal(isReachablePrey(hunter, prey), true);
    assert.equal(isEligiblePrey(hunter, prey, null), true);

    prey.flying = true;
    assert.equal(isReachablePrey(hunter, prey), false, 'a flying animal is not prey');
    assert.equal(isEligiblePrey(hunter, prey, null), false);

    prey.flying = false;
    hunter.flying = true;
    assert.equal(isReachablePrey(hunter, prey), false, '⚠ and a flying hunter takes nothing below it');
  });

  test('perception stops the hunt being started across the divide', () => {
    const engine = sandbox({ systems: [new PerceptionSystem({ ...engine0Perception() })] });
    const raptor = spawn(engine, { speciesId: RAPTOR.id, x: 20.5, y: 20.5 });
    const bird = spawn(engine, { speciesId: BIRD.id, x: 22.5, y: 20.5 });

    engine.step(1);
    assert.equal(engine.world.perception.get(raptor.id).nearestPrey?.id, bird.id);
    assert.equal(engine.world.perception.get(bird.id).nearestThreat?.id, raptor.id);

    bird.flying = true;
    engine.step(1);
    assert.equal(engine.world.perception.get(raptor.id).nearestPrey, null, 'it is up and away');
    assert.equal(engine.world.perception.get(bird.id).nearestThreat, null, 'and has nothing to fear');
  });

  test('off the ground is one predicate for two mechanisms — a tree and a wing', () => {
    // Its reader is the disturbance system: a grass fire runs underneath either.
    assert.equal(isOffGround({ elevation: CANOPY, flying: false }), true);
    assert.equal(isOffGround({ elevation: 0, flying: true }), true);
    assert.equal(isOffGround({ elevation: 0, flying: false }), false);
    assert.equal(isAirborne({ elevation: CANOPY }), false, 'up a tree is not on the wing');
  });

  test('⚠⚠ A63: a flying animal is still seen, still a mate candidate, still a guardian', () => {
    // The same regression guard elevation owes, for the same reason: everything
    // one animal knows about another comes through one test in perception, so a
    // condition added *there* gates reproduction too and the failure reads as a
    // population number three subsystems from the cause.
    const engine = sandbox({ systems: [new PerceptionSystem({ ...engine0Perception() })] });
    const hen = spawn(engine, { speciesId: BIRD.id, x: 20.5, y: 20.5, sex: Sexes.FEMALE });
    const cock = spawn(engine, { speciesId: BIRD.id, x: 22.5, y: 20.5, sex: Sexes.MALE });
    const chick = spawn(engine, { speciesId: BIRD.id, x: 21.5, y: 20.5, lifeStage: 'juvenile', age: 100 });
    chick.guardianId = hen.id;

    hen.flying = true;
    engine.step(1);
    assert.ok(engine.world.perception.get(chick.id).guardian, 'a flying mother is still a findable guardian');
    assert.ok(
      engine.world.perception.get(hen.id).mateCandidates.some((c) => c.id === cock.id),
      'and still finds a mate',
    );
    assert.ok(engine.world.perception.get(cock.id).nearestAnimal, 'and is still simply visible');
  });
});

describe('flight: the decision system owns the flag', () => {
  test('it is written every tick for every animal, so it cannot outlive the switch', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem({ ...engine0Perception() }),
        new DecisionSystem({ flight: false }),
      ],
    });
    const bird = spawn(engine, { speciesId: BIRD.id, x: 20.5, y: 20.5 });
    bird.flying = true; // a stale flag from a world where the switch was on
    engine.step(1);
    assert.equal(bird.flying, false, 'the switch being off clears it rather than leaving it');
  });

  test('with the switch on, a wandering bird takes off and a resting one lands', () => {
    // ⚠ **The action weights are set in `config.behavior`, not in the decision
    // system's constructor**, and the difference is DOCS §8 in miniature: the
    // system reads `species.behavior ?? this`, so a constructor option is only the
    // fallback for an *unknown* species and a declared one silently keeps the
    // config's value. Written the obvious way first, this test bent the knob it
    // was not holding and the bird wandered regardless — which is precisely the
    // failure the whole switch-in-a-section discipline exists to prevent.
    const world = (behavior) =>
      sandbox({
        config: { behavior },
        systems: [
          new PerceptionSystem({ ...engine0Perception() }),
          new DecisionSystem({ flight: true }),
          new MovementSystem({ ...defaultLocomotion() }),
        ],
      });

    const engine = world({ restBias: 0, wanderBias: 1, explorationRate: 0 });
    const bird = spawn(engine, { speciesId: BIRD.id, x: 20.5, y: 20.5 });
    engine.step(1);
    assert.equal(bird.action, 'wander', 'nothing else is on offer in an empty world');
    assert.equal(bird.flying, true, 'so it is on the wing');
    // ⚠ And it actually moved further than its own speed, which is the effect
    // arriving through the flag rather than only being written on it.
    assert.ok(bird.lastMoveDistance > bird.speed, `flew ${bird.lastMoveDistance} > speed ${bird.speed}`);

    // The other half, in a world where sitting still is what wins: it lands, and
    // stays landed. This is the whole reason flight cannot be a general
    // improvement — the actions worth doing on the ground are still done there.
    const still = world({ restBias: 10, wanderBias: 0, explorationRate: 0 });
    const perched = spawn(still, { speciesId: BIRD.id, x: 20.5, y: 20.5 });
    still.step(1);
    assert.equal(perched.action, 'rest');
    assert.equal(perched.flying, false, 'a resting bird is on the ground');
    assert.equal(perched.lastMoveDistance, 0);
  });

  test('flight adds no draw: the decision stream is untouched', () => {
    // The two-draw budget per animal per tick is what determinism rests on
    // (DOCS §4). `flyingFor` rolls nothing, so a world of fliers consumes exactly
    // the stream a world of walkers does.
    const streamAfter = (speciesId) => {
      const engine = sandbox({
        systems: [new PerceptionSystem({ ...engine0Perception() }), new DecisionSystem({ flight: true })],
      });
      spawn(engine, { speciesId, x: 20.5, y: 20.5 });
      engine.step(5);
      return engine.serializeRandomStreams().decision;
    };
    assert.deepEqual(streamAfter(BIRD.id), streamAfter(WALKER.id));
  });
});

/** The demo's perception options, without building a demo. */
function engine0Perception() {
  return new SimulationEngine({ seed: 1 }).config.perception;
}
function defaultMetabolism() {
  return new SimulationEngine({ seed: 1 }).config.metabolism;
}
function defaultLocomotion() {
  return new SimulationEngine({ seed: 1 }).config.locomotion;
}
