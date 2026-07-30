/**
 * Cooperative action (PLAN-SPECIES.md §3.7, phase 10) — group hunting, mobbing,
 * and what A32 turned out to be.
 *
 * Three mechanisms, one shape, and the shape is the point: **neither new
 * mechanism adds an action, a heading, or a competitor in the utility table.**
 * Cooperative hunting gives the `stalk`/`chase` a predator already had a
 * different *target*, mobbing is the groupmate half of the `defend` DOCS §7 has
 * described since Step 23, and both effects land on products that already exist
 * (`captureChance`, `trampleChance`). The tests are organized around the claims
 * that matter:
 *
 *   1. **A species that declares nothing is exactly unaffected**, and the world
 *      switches restore that state for one that does (D16/D30). The demo is
 *      asserted byte-identical with both mechanisms off, which is the only honest
 *      way to ship two mechanisms nothing in the roster uses yet.
 *   2. **Each half resolves correctly** — who counts as a co-attacker, whom a
 *      mobber stands over, and what that does to the odds.
 *   3. ⚠ **A32 is measured rather than claimed.** The lever DOCS A32 named
 *      (relaxing "nearer the predator than I am") is here as `interposeSlack`,
 *      and it ships at 0 because removing the test outright does not move the
 *      thing it was blamed for. What is asserted below is the mechanism, not a
 *      demo outcome the measurement does not support.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { HuntingSystem } from '../src/simulation/systems/HuntingSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { EventTypes } from '../src/simulation/events/EventTypes.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  DEFAULT_COOPERATION,
  adoptedPrey,
  attackersFor,
  cooperationBonus,
  huntsTogether,
} from '../src/simulation/predation/cooperation.js';
import { DEFAULT_MOBBING, mobWardFor, mobbersFor } from '../src/simulation/predation/mobbing.js';

const CONFIG = new SimulationEngine().config;

/** Plain prey: it runs, and it has no opinion about anything. */
const HERD_ANIMAL = Object.freeze({
  id: 'test.herd',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 200,
  baseSpeed: 1.1,
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

/** The same animal, but it turns on a predator that has gone for a herdmate. */
const MOBBER = Object.freeze({
  ...HERD_ANIMAL,
  id: 'test.mobber',
  // ⚠ Above `fleeWeight` (2.0) or it would simply run — mobbing competes with
  // fleeing, which is the whole reason it is safe to add (§3.7).
  behavior: Object.freeze({ mobWeight: 2.4 }),
});

/** A solitary predator: it hunts, and it hunts alone. */
const LONE_HUNTER = Object.freeze({
  id: 'test.lone',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze([HERD_ANIMAL.id, MOBBER.id]),
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

/** The same predator, in a pride. */
const PACK_HUNTER = Object.freeze({
  ...LONE_HUNTER,
  id: 'test.pack',
  hunting: Object.freeze({ cooperationWeight: 0.4, maxAttackers: 3 }),
});

const SPECIES = [HERD_ANIMAL, MOBBER, LONE_HUNTER, PACK_HUNTER];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/** Teach one engine about the invented species (the roster is a static import, A50). */
function withSpecies(engine, definitions) {
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...definitions], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return registry;
}

/** Flat, featureless ground, so the only thing in play is who is standing where. */
function sandbox({ seed = 7, config = {}, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
      ...config,
    },
  });
  withSpecies(engine, SPECIES);
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawn(engine, speciesId, { energyFraction = 0.5, ...overrides } = {}) {
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
  return engine.world.entities.get(id);
}

/** Perception + sociality + decision, wired exactly as the demo fixture wires them. */
function decisionSystems(engine) {
  engine.registerSystem(new PerceptionSystem({ ...engine.config.perception }));
  engine.registerSystem(new SocialSystem(engine.config.social));
  engine.registerSystem(
    new DecisionSystem({
      ...engine.config.decision,
      ...engine.config.behavior,
      foodMinLevel: engine.config.perception.foodMinLevel,
      drinkRange: engine.config.hydration.drinkRange,
      carcassRange: engine.config.feeding.carcassRange,
      cooperationEnabled: engine.config.cooperation.enabled,
      cooperationJoinRange: engine.config.cooperation.joinRange,
      mobbingEnabled: engine.config.mobbing.enabled,
      mobbingMinMobbers: engine.config.mobbing.minMobbers,
      mobbingRange: engine.config.mobbing.range,
    }),
  );
  return engine;
}

describe('cooperative hunting: the count', () => {
  test('a co-attacker is a conspecific committed to the same quarry, and nothing else', () => {
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const hunter = spawn(engine, PACK_HUNTER.id, { x: 30.5, y: 30 });
    const mate = spawn(engine, PACK_HUNTER.id, { x: 31.5, y: 30, huntTargetId: prey.id });
    const stranger = spawn(engine, LONE_HUNTER.id, { x: 31, y: 30.5, huntTargetId: prey.id });
    const idler = spawn(engine, PACK_HUNTER.id, { x: 29, y: 30 });
    const elsewhere = spawn(engine, PACK_HUNTER.id, { x: 29, y: 31, huntTargetId: idler.id });
    // Distance is measured from the quarry: a clanmate across the map is not in
    // on the kill, however committed it is.
    const distant = spawn(engine, PACK_HUNTER.id, {
      x: 30 + DEFAULT_COOPERATION.range + 2,
      y: 30,
      huntTargetId: prey.id,
    });

    assert.equal(attackersFor(engine.world, hunter, prey, DEFAULT_COOPERATION), 1, 'only the one on this quarry');
    assert.equal(huntsTogether(hunter, mate), true);
    assert.equal(huntsTogether(hunter, stranger), false, 'a different species is not a pride');
    assert.equal(elsewhere.huntTargetId, idler.id, 'and the one on another target stays uncounted');
    assert.equal(distant.huntTargetId, prey.id, 'even though it is on the same quarry');
  });

  test('“conspecific” tightens to “same group record” for a hunter that has one', () => {
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const hunter = spawn(engine, PACK_HUNTER.id, { x: 30.5, y: 30, groupRecordId: 4 });
    const clanmate = spawn(engine, PACK_HUNTER.id, { x: 31, y: 30, huntTargetId: prey.id, groupRecordId: 4 });
    const outsider = spawn(engine, PACK_HUNTER.id, { x: 31, y: 30.5, huntTargetId: prey.id, groupRecordId: 9 });

    assert.equal(attackersFor(engine.world, hunter, prey, DEFAULT_COOPERATION), 1, 'the clanmate only');
    assert.equal(huntsTogether(hunter, outsider), false);
    // The reverse: an unattached hunter joins anybody's hunt.
    hunter.groupRecordId = null;
    assert.equal(attackersFor(engine.world, hunter, prey, DEFAULT_COOPERATION), 2);
    assert.equal(clanmate.groupRecordId, 4, 'and nothing was written to say so');
  });

  test('the world switch turns the count off whatever a species declares', () => {
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const hunter = spawn(engine, PACK_HUNTER.id, { x: 30.5, y: 30 });
    spawn(engine, PACK_HUNTER.id, { x: 31, y: 30, huntTargetId: prey.id });
    const off = { ...DEFAULT_COOPERATION, enabled: false };
    assert.equal(attackersFor(engine.world, hunter, prey, off), 0);
  });
});

describe('cooperative hunting: the odds', () => {
  const packHunting = () => new SpeciesRegistry(SPECIES, CONFIG).require(PACK_HUNTER.id).hunting;
  const loneHunting = () => new SpeciesRegistry(SPECIES, CONFIG).require(LONE_HUNTER.id).hunting;

  test('the bonus is exactly 1 with nobody else on it, or at weight 0', () => {
    // D16's identity discipline: "off" must be the identity rather than close to
    // it, or a supposedly inert mechanism moves the last decimal of every hunt.
    assert.equal(cooperationBonus(0, packHunting()), 1);
    assert.equal(cooperationBonus(3, loneHunting()), 1, 'a species that does not cooperate never gets one');
    assert.equal(cooperationBonus(1, packHunting()), 1.4);
    assert.equal(cooperationBonus(9, packHunting()), 1 + 0.4 * 3, 'capped at maxAttackers');
  });

  test('a hunt with company is likelier to succeed, and a solitary hunter is unaffected', () => {
    const engine = sandbox();
    const hunting = new HuntingSystem(engine.config.hunting);
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const pack = spawn(engine, PACK_HUNTER.id, { x: 30.5, y: 30 });
    const lone = spawn(engine, LONE_HUNTER.id, { x: 30.5, y: 30.5 });
    const preyParams = engine.species.require(HERD_ANIMAL.id).hunting;

    const alone = hunting.captureChance(pack, prey, undefined, packHunting(), preyParams, 0);
    const together = hunting.captureChance(pack, prey, undefined, packHunting(), preyParams, 2);
    assert.ok(together > alone, `${together} > ${alone}`);
    assert.equal(
      hunting.captureChance(lone, prey, undefined, loneHunting(), preyParams, 2),
      hunting.captureChance(lone, prey, undefined, loneHunting(), preyParams, 0),
      'company changes nothing for a species that does not cooperate',
    );
  });
});

describe('cooperative hunting: joining a hunt', () => {
  /**
   * A chase already under way, with a second predator close enough to see the
   * chaser but **not** the quarry — which is the case joining exists for. With
   * the quarry inside its own perception radius it would simply have prey of its
   * own and never reach this code.
   */
  function chaseInProgress(speciesId, config = {}) {
    const engine = decisionSystems(sandbox({ config }));
    const joiner = spawn(engine, speciesId, { x: 20, y: 20, energyFraction: 0.2 });
    const chaser = spawn(engine, speciesId, { x: 25, y: 20, energyFraction: 0.2 });
    const quarry = spawn(engine, HERD_ANIMAL.id, { x: 28, y: 20 });
    chaser.action = 'chase';
    chaser.huntTargetId = quarry.id;
    return { engine, joiner, chaser, quarry };
  }

  test('a pack hunter with nothing in sight joins a clanmate’s chase', () => {
    const { engine, joiner, quarry } = chaseInProgress(PACK_HUNTER.id);
    assert.ok(
      Math.hypot(quarry.x - joiner.x, quarry.y - joiner.y) > engine.species.require(PACK_HUNTER.id).perception.radius,
      'the quarry really is beyond what the joiner can perceive',
    );
    engine.step(1);
    assert.equal(joiner.huntTargetId, quarry.id, 'it committed to somebody else’s quarry');
    assert.equal(joiner.action, 'stalk', 'and closes at a walk, since the quarry is far off');
  });

  test('a solitary hunter does not, and neither does anyone with the switch off', () => {
    const lone = chaseInProgress(LONE_HUNTER.id);
    lone.engine.step(1);
    assert.equal(lone.joiner.huntTargetId, null, 'a species that does not cooperate hunts alone');

    const off = chaseInProgress(PACK_HUNTER.id, { cooperation: { enabled: false } });
    off.engine.step(1);
    assert.equal(off.joiner.huntTargetId, null, 'and the world switch is a real off switch');
  });

  test('⚠ only a committed chase is joinable — a stalk is not yet a hunt', () => {
    const { engine, joiner, chaser } = chaseInProgress(PACK_HUNTER.id);
    chaser.action = 'stalk';
    engine.step(1);
    assert.equal(joiner.huntTargetId, null);
  });

  test('joining never takes a hunter off prey of its own', () => {
    const engine = decisionSystems(sandbox());
    const joiner = spawn(engine, PACK_HUNTER.id, { x: 20, y: 20, energyFraction: 0.2 });
    const own = spawn(engine, HERD_ANIMAL.id, { x: 22, y: 20 });
    const chaser = spawn(engine, PACK_HUNTER.id, { x: 24, y: 20, energyFraction: 0.2 });
    const quarry = spawn(engine, HERD_ANIMAL.id, { x: 27, y: 20 });
    chaser.action = 'chase';
    chaser.huntTargetId = quarry.id;
    engine.step(1);
    assert.equal(joiner.huntTargetId, own.id, 'perception’s own answer wins');
  });

  test('the quarry has to still be alive, and within joining distance', () => {
    const engine = sandbox();
    const joiner = spawn(engine, PACK_HUNTER.id, { x: 20, y: 20 });
    const chaser = spawn(engine, PACK_HUNTER.id, { x: 25, y: 20, action: 'chase' });
    const quarry = spawn(engine, HERD_ANIMAL.id, { x: 28, y: 20 });
    chaser.huntTargetId = quarry.id;
    const neighbours = [chaser.id, 5];
    assert.equal(adoptedPrey(engine.world, joiner, neighbours, DEFAULT_COOPERATION)?.id, quarry.id);

    quarry.alive = false;
    assert.equal(adoptedPrey(engine.world, joiner, neighbours, DEFAULT_COOPERATION), null);
    quarry.alive = true;
    quarry.x = 20 + DEFAULT_COOPERATION.joinRange + 1;
    assert.equal(adoptedPrey(engine.world, joiner, neighbours, DEFAULT_COOPERATION), null);
  });
});

describe('mobbing: who stands, and when', () => {
  /**
   * A hunter committed to one animal of a herd, with a second herd member close
   * enough to see it — the geometry mobbing is about. `company` is how many extra
   * adults are standing with the mobber, which is what `minMobbers` counts.
   */
  function underAttack({ speciesId = MOBBER.id, company = 2, config = {} } = {}) {
    const engine = decisionSystems(sandbox({ config }));
    const ward = spawn(engine, speciesId, { x: 30, y: 30 });
    const mobber = spawn(engine, speciesId, { x: 31, y: 30 });
    for (let i = 0; i < company; i += 1) spawn(engine, speciesId, { x: 31 + i * 0.5, y: 31 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 32, y: 30, energyFraction: 0.2 });
    hunter.action = 'chase';
    hunter.huntTargetId = ward.id;
    return { engine, ward, mobber, hunter };
  }

  test('an adult turns on a predator that has committed to a herdmate', () => {
    const { engine, ward, mobber } = underAttack();
    engine.step(1);
    assert.equal(mobber.action, 'defend', 'it stands rather than runs');
    assert.equal(mobber.defendingId, ward.id, 'over the animal being hunted');
    assert.equal(ward.action, 'flee', '⚠ and the one being hunted still runs — it is not part of its own mob');
  });

  test('a species that does not mob runs, in exactly the same geometry', () => {
    const { engine, mobber } = underAttack({ speciesId: HERD_ANIMAL.id });
    engine.step(1);
    assert.equal(mobber.action, 'flee');
    assert.equal(mobber.defendingId, null);
  });

  test('one animal is not a mob', () => {
    const { engine, mobber } = underAttack({ company: 0 });
    engine.step(1);
    assert.equal(mobber.action, 'flee', 'below minMobbers it saves itself');
  });

  test('the world switch turns it off whatever the species declares', () => {
    const { engine, mobber } = underAttack({ config: { mobbing: { enabled: false } } });
    engine.step(1);
    assert.equal(mobber.action, 'flee');
  });

  test('⚠ a predator that has not committed to anybody is not mobbed', () => {
    // What keeps mobbing from being a standing posture — and what keeps it from
    // ever competing with foraging, which is the rule that governs new behaviour
    // in this system (DOCS §9 Decision).
    const { engine, mobber, hunter } = underAttack();
    hunter.huntTargetId = null;
    engine.step(1);
    assert.notEqual(mobber.action, 'defend');
  });

  test('the ward resolves through one predicate, with the parts stated', () => {
    const engine = sandbox();
    const ward = spawn(engine, MOBBER.id, { x: 30, y: 30 });
    const mobber = spawn(engine, MOBBER.id, { x: 31, y: 30 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 32, y: 30, huntTargetId: ward.id });
    const behavior = engine.species.require(MOBBER.id).behavior;
    const threat = { id: hunter.id, distance: 1 };
    const social = { adults: 2 };

    assert.equal(mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, social)?.id, ward.id);
    assert.equal(
      mobWardFor(engine.world, mobber, threat, engine.species.require(HERD_ANIMAL.id).behavior, DEFAULT_MOBBING, social),
      null,
      'no mobWeight, no mechanism',
    );
    assert.equal(
      mobWardFor(engine.world, mobber, { id: hunter.id, distance: 99 }, behavior, DEFAULT_MOBBING, social),
      null,
      'a threat beyond defendRange is somebody else’s problem',
    );
    hunter.huntTargetId = mobber.id;
    assert.equal(
      mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, social),
      null,
      '⚠ the animal being hunted is not part of its own mob',
    );
    hunter.huntTargetId = ward.id;
    mobber.lifeStage = 'juvenile';
    assert.equal(mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, social), null, 'juveniles never mob');
  });
});

describe('mobbing: what it costs the hunter', () => {
  function standoff() {
    const engine = sandbox();
    const hunting = new HuntingSystem(engine.config.hunting);
    const prey = spawn(engine, MOBBER.id, { x: 30, y: 30 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 30.5, y: 30 });
    const mob = [
      spawn(engine, MOBBER.id, { x: 31, y: 30, defendingId: prey.id }),
      spawn(engine, MOBBER.id, { x: 30, y: 31, defendingId: prey.id }),
    ];
    return { engine, hunting, prey, hunter, mob };
  }

  test('the mob is found from `defendingId`, which is already written and already saved', () => {
    const { engine, prey, mob } = standoff();
    const found = mobbersFor(engine.world, prey, null, DEFAULT_MOBBING);
    assert.deepEqual(
      found.map((entity) => entity.id),
      mob.map((entity) => entity.id),
      'in ascending id order, like every other collection',
    );
    mob[0].defendingId = null;
    assert.equal(mobbersFor(engine.world, prey, null, DEFAULT_MOBBING).length, 1);
  });

  test('a mobbed prey is harder to take, and taking it is more dangerous', () => {
    const { engine, hunting, prey, hunter, mob } = standoff();
    const params = engine.species.require(LONE_HUNTER.id).hunting;
    const preyParams = engine.species.require(MOBBER.id).hunting;
    const defenders = hunting.defendersFor(engine.world, prey);
    assert.equal(defenders.mob.length, 2, 'the hunting system sees the mob');

    const mobbed = hunting.captureChance(hunter, prey, defenders, params, preyParams);
    const alone = hunting.captureChance(hunter, prey, { count: defenders.count, guardian: null, mob: [] }, params, preyParams);
    assert.ok(mobbed < alone, `${mobbed} < ${alone}`);
    assert.equal(mob.length, 2);
  });

  test('a species that does not mob costs nothing to ask about', () => {
    // The prey's own weight is the gate, so `defendersFor` never touches the grid
    // for the four shipped species — the reason this whole phase is free.
    const engine = sandbox();
    const hunting = new HuntingSystem(engine.config.hunting);
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    spawn(engine, HERD_ANIMAL.id, { x: 31, y: 30, defendingId: prey.id });
    const queried = [];
    const realQuery = engine.world.grid.queryRadius.bind(engine.world.grid);
    engine.world.grid.queryRadius = (...args) => {
      queried.push(args);
      return realQuery(...args);
    };
    assert.deepEqual(hunting.defendersFor(engine.world, prey).mob, []);
    assert.equal(queried.length, 0, 'no grid query at all');
  });

  test('every mobber is reported through `entity.defended`, which is what that event means', () => {
    // ⚠ No new event type and no protocol bump: `entity.defended` is "an adult
    // putting itself between a predator and a groupmate or its own young", and a
    // mobber is exactly that. (Contrast `entity.contested`, where reuse *would*
    // have made the UI lie — a carcass fight is not a fight over a mate.)
    const engine = sandbox({ systems: [] });
    const hunting = new HuntingSystem(engine.config.hunting);
    engine.registerSystem(hunting);
    const prey = spawn(engine, MOBBER.id, { x: 30, y: 30 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 30.5, y: 30 });
    spawn(engine, MOBBER.id, { x: 31, y: 30, defendingId: prey.id });
    spawn(engine, MOBBER.id, { x: 30, y: 31, defendingId: prey.id });
    hunter.action = 'chase';
    hunter.huntTargetId = prey.id;

    const before = engine.events.lastSeq;
    engine.step(1);
    const defended = [...engine.eventsSince(before)].filter((e) => e.type === EventTypes.ENTITY_DEFENDED);
    assert.equal(defended.length, 2, 'one per mobber');
    for (const event of defended) {
      assert.equal(event.wardId, prey.id);
      assert.equal(event.threatId, hunter.id);
    }
  });
});

describe('A32: the geometry, and what the measurement said about it', () => {
  /**
   * A parent, two of its juveniles, and a predator — the geometry `#wardToDefend`
   * scores. The `far` calf is further from the predator than the parent is, which
   * is the case the strict test refuses and `interposeSlack` admits.
   */
  function family({ config = {}, targeted = null } = {}) {
    const engine = decisionSystems(sandbox({ config }));
    const parent = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const near = spawn(engine, HERD_ANIMAL.id, { x: 31.5, y: 30, lifeStage: 'juvenile', age: 100, bodyMass: 20 });
    const far = spawn(engine, HERD_ANIMAL.id, { x: 29, y: 30, lifeStage: 'juvenile', age: 100, bodyMass: 20 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 33, y: 30, energyFraction: 0.2 });
    parent.offspring = [near.id, far.id];
    near.parents = [parent.id];
    far.parents = [parent.id];
    hunter.action = 'chase';
    hunter.huntTargetId = targeted === null ? null : targeted === 'far' ? far.id : near.id;
    return { engine, parent, near, far, hunter };
  }

  test('the strict test defends only a calf more exposed than the parent', () => {
    const { engine, parent, near } = family({ config: { decision: { interposeSlack: 0 } } });
    engine.step(1);
    assert.equal(parent.action, 'defend');
    assert.equal(parent.defendingId, near.id, 'the one between it and the predator');
  });

  test('⚠ `interposeSlack` is the lever DOCS A32 named, and it works as specified', () => {
    // It resolves exactly as intended — a calf up to `slack` further from the
    // predator than the parent is still defended. ⚠ What it does *not* do is move
    // A32 in the demo: with the clause removed entirely (slack ∞) `entity.defended`
    // measured 0/1/1 over 2000 ticks on three seeds against the strict 1/1/0.
    // That is why it ships at 0 and why the diagnosis in DOCS §1.2 moved off it.
    const engine = decisionSystems(sandbox({ config: { decision: { interposeSlack: 4 } } }));
    const parent = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const behind = spawn(engine, HERD_ANIMAL.id, { x: 28.5, y: 30, lifeStage: 'juvenile', age: 100, bodyMass: 20 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 31.5, y: 30, energyFraction: 0.2 });
    parent.offspring = [behind.id];
    behind.parents = [parent.id];
    hunter.action = 'chase';
    hunter.huntTargetId = behind.id;

    engine.step(1);
    assert.equal(parent.defendingId, behind.id, 'a calf behind the parent is now worth interposing for');
  });

  test('a parent defends the calf the hunter has actually committed to', () => {
    // The change that did ship. Without it the parent stands over whichever calf
    // is nearest the predator, which can be a calf nothing is hunting — a defense
    // with no attempt to affect, which is half of why A32 never fired.
    const { engine, parent, far } = family({ config: { decision: { interposeSlack: 0 } }, targeted: 'far' });
    engine.step(1);
    assert.equal(parent.defendingId, far.id);

    const untargeted = family({ config: { decision: { interposeSlack: 0, defendTargeted: false } }, targeted: 'far' });
    untargeted.engine.step(1);
    assert.equal(untargeted.parent.defendingId, untargeted.near.id, 'the pre-phase-10 rule, kept as the control');
  });

  test('kin outrank the herd: a mother with her own calf under threat does not mob', () => {
    const engine = decisionSystems(sandbox());
    const parent = spawn(engine, MOBBER.id, { x: 30, y: 30 });
    const calf = spawn(engine, MOBBER.id, { x: 31, y: 30, lifeStage: 'juvenile', age: 100, bodyMass: 20 });
    const herdmate = spawn(engine, MOBBER.id, { x: 29.5, y: 31 });
    spawn(engine, MOBBER.id, { x: 29, y: 31 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 32, y: 30, energyFraction: 0.2 });
    parent.offspring = [calf.id];
    calf.parents = [parent.id];
    hunter.action = 'chase';
    hunter.huntTargetId = herdmate.id;

    engine.step(1);
    assert.equal(parent.defendingId, calf.id, 'its own calf, not the herdmate the predator went for');
  });
});

describe('cooperative action: inert in the shipped world', () => {
  test('⚠ the demo is byte-identical with both mechanisms switched off', () => {
    // The claim this phase rests on: no shipped species declares
    // `hunting.cooperationWeight` or `behavior.mobWeight`, so both mechanisms
    // must leave *no trace at all* (D30) — not "no measurable difference", but
    // the same bytes. Take this reading while the roster still states nothing;
    // once a species declares a weight the arms diverge by design and the check
    // is no longer available (the same warning phase 9 recorded).
    const on = createDemoSimulation({ seed: 42 });
    const off = createDemoSimulation({ seed: 42, config: { cooperation: { enabled: false }, mobbing: { enabled: false } } });
    on.step(400);
    off.step(400);
    assert.deepEqual(captureSimulationState(on).entities, captureSimulationState(off).entities);
  });

  test('no shipped species declares either weight, which is what makes that true', () => {
    // ⚠ Stated as a test rather than as a comment, because the byte-identity
    // above would quietly become a *false* claim the moment one did — and the
    // failure would read as a determinism bug rather than as the roster change it
    // actually was.
    const registry = new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG);
    for (const species of registry.all()) {
      assert.equal(species.hunting.cooperationWeight, 0, `${species.id} hunts alone`);
      assert.equal(species.behavior.mobWeight, 0, `${species.id} does not mob`);
    }
  });
});
