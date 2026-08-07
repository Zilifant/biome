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
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { EventTypes } from '../src/simulation/events/EventTypes.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  DEFAULT_COOPERATION,
  adoptedPrey,
  approachPoint,
  attackersFor,
  cooperationBonus,
  huntsTogether,
} from '../src/simulation/predation/cooperation.js';
import { DEFAULT_MOBBING, mobWardFor, mobbersFor } from '../src/simulation/predation/mobbing.js';
import { DEFAULT_CHARGE, chargeWeightOf, pursuitTicksOf } from '../src/simulation/predation/charge.js';
import { restoreSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;
const LION = getSpecies('predator.lion');
const BUFFALO = getSpecies('herbivore.buffalo');

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
  // ⚠ A literal for the last one: `CHARGER` is declared below this, and the
  // predator/prey relation is read in *both* directions — a species is only a threat
  // to an animal this list names, so a charging species missing from it would
  // perceive no predator and the whole P9 block would test nothing.
  preySpeciesIds: Object.freeze([HERD_ANIMAL.id, MOBBER.id, 'test.charger']),
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

/**
 * A mobber that presses the attack home (BEHAVIOR-PLAN P9): it sprints to the animal
 * under attack rather than walking, and goes on defending for a bounded spell after
 * the hunter has broken contact.
 *
 * ⚠⚠ **It is the buffalo's arrangement, number for number, and every part of that is
 * load-bearing.** `fleeWeight: 1.0` (a heavy animal that does not bolt) is what makes
 * two of the assertions below capable of failing at all:
 *
 *   - At the config's 2.0, `alarmFlee` is 1.5 and no `chargeWeight` a sane species
 *     would declare could ever run a pursuit — the block would test a mechanism that
 *     never fires. (That is not hypothetical: the shipped weight was 0.7 against a
 *     0.75 alarm for an afternoon, and it was silently inert.)
 *   - At the config's 2.0, `flee` also beats any pursuit on the weights alone, so the
 *     guard that stops a pursuit suppressing `flee` could be **deleted with every
 *     test still green**. At 1.0 a predator 5.5 cells away scores 0.54 against the
 *     pursuit's 0.9 — the weights say keep chasing, and only the guard says otherwise.
 */
const CHARGER = Object.freeze({
  ...HERD_ANIMAL,
  id: 'test.charger',
  behavior: Object.freeze({ mobWeight: 2.4, fleeWeight: 1.0, chargeWeight: 0.9, pursuitTicks: 20 }),
});

const SPECIES = [HERD_ANIMAL, MOBBER, CHARGER, LONE_HUNTER, PACK_HUNTER];

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
      terrain: { ...FLAT_TERRAIN },
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
function decisionSystems(engine, decision = {}) {
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
      // ⚠ Coordinated stalking (P4), wired here for exactly the reason the charge's
      // three bounds are: the system's own defaults are the *pre-P4* behaviour, so
      // a test that set these in its config and not here would silently measure the
      // old mechanism. This helper's own comment below says so about P9 and it was
      // still the first thing P4 got wrong.
      cooperationJoinStalks: engine.config.cooperation.joinStalks,
      cooperationApproachSpread: engine.config.cooperation.approachSpread,
      cooperationApproachRadius: engine.config.cooperation.approachRadius,
      mobbingEnabled: engine.config.mobbing.enabled,
      mobbingMinMobbers: engine.config.mobbing.minMobbers,
      mobbingRange: engine.config.mobbing.range,
      // ⚠ The charge's three bounds (P9), wired from `config.charge` exactly as the
      // demo fixture wires them — without this a test that switches the mechanism
      // off in its config would find the system still running on the defaults.
      chargeEnabled: engine.config.charge.enabled,
      chargeStaminaFraction: engine.config.charge.staminaFraction,
      maxPursuitTicks: engine.config.charge.maxPursuitTicks,
      ...decision,
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

  test('⚠⚠ a stalk is joinable too since P4 — and was deliberately not before', () => {
    // ⚠⚠ **This test asserted the opposite until 2026-08-07, and the reversal is
    // the point of PREDATOR-PLAN P4.** It read "only a committed chase is joinable
    // — a stalk is not yet a hunt", which was phase 10's deliberate rule and is
    // exactly what the brief now asks to be lifted: a pride cannot converge on a
    // quarry *before a member has entered `chase`* if a stalk is not joinable.
    //
    // Both arms are asserted, because the old rule is still the reproducible
    // control and `joinStalks: false` has to keep meaning what it meant.
    const joined = chaseInProgress(PACK_HUNTER.id);
    joined.chaser.action = 'stalk';
    joined.engine.step(1);
    assert.equal(joined.joiner.huntTargetId, joined.quarry.id, 'a stalk is joinable with the flag on');

    // ⚠ The helper's `config` is the **engine** config, and `decisionSystems`
    // wires the system from it — so the off arm is stated where the world states
    // it, not as a system option the fixture would not have used.
    const control = chaseInProgress(PACK_HUNTER.id, { cooperation: { joinStalks: false } });
    control.chaser.action = 'stalk';
    control.engine.step(1);
    assert.equal(control.joiner.huntTargetId, null, 'and is not with it off');
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

  test('⚠ and the pride-mate has to be one this animal can actually see', () => {
    // BEHAVIOR-PLAN P0. This function reads the *shared* neighbour walk, which may
    // now reach past the senses that filled it, and it has never tested how far
    // away the neighbour is — only its quarry. Until P0 the query radius was that
    // gate; the radius argument is what replaces it. It is a no-op for the shipped
    // roster (no predator declares a herd radius) and is asserted anyway, because
    // the day one does is not the day to find this out.
    const engine = sandbox();
    const joiner = spawn(engine, PACK_HUNTER.id, { x: 20, y: 20 });
    const chaser = spawn(engine, PACK_HUNTER.id, { x: 25, y: 20, action: 'chase' });
    const quarry = spawn(engine, HERD_ANIMAL.id, { x: 28, y: 20 });
    chaser.huntTargetId = quarry.id;
    const neighbours = [chaser.id, 5]; // the chaser is five units off

    assert.equal(
      adoptedPrey(engine.world, joiner, neighbours, DEFAULT_COOPERATION, 6)?.id,
      quarry.id,
      'inside the senses, the hunt is joinable',
    );
    assert.equal(
      adoptedPrey(engine.world, joiner, neighbours, DEFAULT_COOPERATION, 4),
      null,
      'on the shared list but out of sight: no hunt to join',
    );
    // ⚠ And the default is the old behaviour exactly, which is what keeps every
    // other call in this file (and every world without a wide-herd predator)
    // reading as it did.
    assert.equal(adoptedPrey(engine.world, joiner, neighbours, DEFAULT_COOPERATION)?.id, quarry.id);
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
    // ⚠ And so does the target, since phase 11: a fleeing animal is carried away
    // from the herd by the chase, and the capture then happens where no mobber
    // can reach it (measured: 0 mobbed attempts in 12 000 tick-seeds).
    assert.equal(ward.action, 'defend', 'the hunted animal turns and faces too');
    assert.equal(ward.defendingId, ward.id, 'standing its ground is defending itself');
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
      mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, social)?.id,
      mobber.id,
      '⚠ the animal being hunted stands its ground — phase 11 measured that a fleeing target separates from its herd, so no mob ever reaches the attempt',
    );
    hunter.huntTargetId = ward.id;
    mobber.lifeStage = 'juvenile';
    assert.equal(mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, social), null, 'juveniles never mob');
  });
});

/**
 * The charge, and the pursuit after it (BEHAVIOR-PLAN P9).
 *
 * Mobbing is entirely **reactive**: it exists only while a perceived predator is
 * committed to a groupmate, so a lion that thinks better of the hunt is not driven
 * off — it simply stops being mobbed, and every defender goes back to grazing on the
 * same tick. Two halves are added here and they are two halves of one behaviour: a
 * defender **sprints** rather than walks, and its `defend` keeps scoring for a
 * bounded spell after the ward is gone, steering at where the threat was last seen.
 *
 * ⚠⚠ **The commitment lives in the *utility*, and a ttl on the intent is the trap
 * the plan names.** `#intentFor` is called fresh from the winning action every tick,
 * so a `defend` intent with `ttl: 20` commits to nothing at all: the moment
 * `defendUrgency` reaches 0 another action wins and overwrites it. What persists is
 * `defendUntil` plus the remembered position, read by the scoring.
 *
 * ⚠⚠ **Mutation-tested 2026-08-06, and all six were caught.** Every one of these
 * deliberate breakages fails this block: deleting the `threat === null` guard (1
 * fail), deleting the self-ward refusal in the sprint (1), deleting the stamina
 * reserve (1), dropping the world's clamp on `pursuitTicks` (2), not clearing the
 * commitment when the animal chooses something else (3), and not refreshing the
 * remembered position while the threat is still visible (1).
 *
 * ⚠ **The `threat === null` guard is the one that had to be *arranged* to be
 * testable**, and it is the sixth phase running with that shape (`MIXER`, `HOLDER`,
 * `worth *= calfWeight`, P7's dispersal gate, P8's double charge). On a species with
 * the config's `fleeWeight: 2.0` it is unreachable: flee wins on the weights alone,
 * so deleting the guard changes no answer anywhere. `CHARGER` carries the buffalo's
 * own 1.0 so that the guard is the only thing deciding.
 */
describe('the charge, and the pursuit after it (P9)', () => {
  /**
   * A hunter committed to one animal of a herd, with a charger beside it. Returns
   * the pieces plus `breakOff`, which is what a predator giving up looks like from
   * the defender's side: the quarry dropped **and** the animal out of perception.
   */
  function underCharge({ speciesId = CHARGER.id, company = 2, config = {}, ...overrides } = {}) {
    const engine = decisionSystems(sandbox({ config }));
    const ward = spawn(engine, speciesId, { x: 30, y: 30 });
    const mobber = spawn(engine, speciesId, { x: 31, y: 30, ...overrides });
    for (let i = 0; i < company; i += 1) spawn(engine, speciesId, { x: 31 + i * 0.5, y: 31 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 32, y: 30, energyFraction: 0.2 });
    hunter.action = 'chase';
    hunter.huntTargetId = ward.id;
    const breakOff = () => {
      hunter.huntTargetId = null;
      hunter.action = 'wander';
      engine.world.moveEntity(hunter, 60, 60);
    };
    return { engine, ward, mobber, hunter, breakOff };
  }

  test('a weight is a positive number, and anything else is no declaration at all', () => {
    assert.equal(chargeWeightOf(CHARGER), 0.9);
    assert.equal(chargeWeightOf(MOBBER), 0, 'mobbing without charging is a species that says nothing here');
    assert.equal(chargeWeightOf(undefined), 0);
    assert.equal(chargeWeightOf({ behavior: { chargeWeight: -1 } }), 0);
    assert.equal(chargeWeightOf({ behavior: { chargeWeight: Infinity } }), 0);
    assert.equal(chargeWeightOf({ behavior: { chargeWeight: 'hard' } }), 0);
  });

  test('⚠ a pursuit is bounded by the world, not by the species', () => {
    // The bound has to be world-level or it is not a bound: `defend` outranks
    // `flee` for the species that declare it, so the duration is a safety
    // parameter rather than a preference.
    assert.equal(pursuitTicksOf(CHARGER, DEFAULT_CHARGE.maxPursuitTicks), 20);
    assert.equal(pursuitTicksOf({ behavior: { pursuitTicks: 9999 } }, 40), 40, 'a species cannot raise the ceiling');
    assert.equal(pursuitTicksOf(CHARGER, 5), 5);
    assert.equal(pursuitTicksOf(MOBBER, 40), 0, 'saying nothing is charge-but-do-not-follow');
    assert.equal(pursuitTicksOf({ behavior: { pursuitTicks: -3 } }, 40), 0);
    assert.equal(pursuitTicksOf(undefined, 40), 0);
  });

  test('a defender charges, and the same animal without the weight walks', () => {
    const charged = underCharge();
    charged.engine.step(1);
    assert.equal(charged.mobber.action, 'defend');
    assert.equal(charged.mobber.moveIntent.sprint, true, 'it sprints to the animal under attack');

    const walked = underCharge({ speciesId: MOBBER.id });
    walked.engine.step(1);
    assert.equal(walked.mobber.action, 'defend', 'the control still defends');
    assert.equal(walked.mobber.moveIntent.sprint, false, '...at the walk it always did');
  });

  test('⚠⚠ the animal being hunted stands its ground rather than charging its own attacker', () => {
    // Since phase 11 a mobbing species' *target* turns and faces, because a fleeing
    // target separates from its herd. Turning that stand into a sprint would close
    // the distance the predator has to cover **and** spend the stamina
    // `captureChance` is about to read (`staminaEdge`) — an own goal on both terms.
    const { engine, ward, mobber, hunter } = underCharge();
    hunter.huntTargetId = mobber.id;
    engine.step(1);
    assert.equal(mobber.action, 'defend', 'it stands');
    assert.equal(mobber.defendingId, mobber.id, 'over itself');
    assert.equal(mobber.moveIntent.sprint, false, '⚠ and does not charge');
    assert.equal(ward.action, 'defend', 'while the herdmate coming to its aid...');
    assert.equal(ward.moveIntent.sprint, true, '...does charge');
  });

  test('⚠ a defender below its stamina reserve defends at a walk', () => {
    // The reserve is what it has left for the flee a second predator would ask of
    // it, and a charge must never be able to spend it all.
    const { engine, mobber } = underCharge({ stamina: 10 });
    engine.step(1);
    assert.equal(mobber.action, 'defend', 'it still defends');
    assert.equal(mobber.moveIntent.sprint, false, 'it simply cannot charge');

    const rested = underCharge({ stamina: 100 * DEFAULT_CHARGE.staminaFraction });
    rested.engine.step(1);
    assert.equal(rested.mobber.moveIntent.sprint, true, 'and exactly at the reserve it can');
  });

  test('the world switch turns it off whatever the species declares', () => {
    const { engine, mobber } = underCharge({ config: { charge: { ...DEFAULT_CHARGE, enabled: false } } });
    engine.step(1);
    assert.equal(mobber.action, 'defend');
    assert.equal(mobber.moveIntent.sprint, false);
    assert.equal(mobber.defendUntil, null, 'and no commitment is formed');
  });

  test('⚠⚠ the commitment outlives the ward, and expires on its own schedule', () => {
    const { engine, mobber, breakOff } = underCharge();
    engine.step(1);
    assert.equal(mobber.action, 'defend');
    assert.equal(mobber.defendUntil, engine.tick + 20, 'the clock is set from the sighting');
    assert.equal(mobber.defendThreatX, 32, 'and so is the place');
    assert.equal(mobber.defendThreatY, 30);

    breakOff();
    // Nineteen more ticks of pursuing something it can no longer see.
    let pursued = 0;
    for (let i = 0; i < 19; i += 1) {
      engine.step(1);
      if (mobber.action === 'defend') pursued += 1;
    }
    assert.equal(pursued, 19, `it kept after the predator (${pursued} of 19 ticks)`);
    assert.equal(mobber.defendingId, null, '⚠ standing over nobody — it is following, not shielding');

    engine.step(1);
    assert.notEqual(mobber.action, 'defend', 'and then the commitment runs out');
    assert.equal(mobber.defendUntil, null, 'and is cleared rather than left to dangle');
    assert.equal(mobber.defendThreatX, null);
  });

  test('⚠ it steers at the place the threat was last seen', () => {
    // The reason a *position* is remembered and not only a clock: by the time the
    // commitment matters the threat object is gone and there is nothing to point at.
    const { engine, mobber, hunter, breakOff } = underCharge();
    engine.step(1);
    engine.world.moveEntity(hunter, 31, 34); // still visible: the memory must follow it
    engine.step(1);
    assert.ok(Math.abs(mobber.defendThreatX - 31) < 1e-9, 'refreshed while it can be seen');
    assert.ok(Math.abs(mobber.defendThreatY - 34) < 1e-9);

    breakOff();
    engine.step(1);
    assert.equal(mobber.action, 'defend');
    const expected = Math.atan2(34 - mobber.y, 31 - mobber.x);
    assert.ok(
      Math.abs(mobber.moveIntent.heading - expected) < 1e-9,
      `${mobber.moveIntent.heading} against ${expected} — at the last sighting, not at (32,30)`,
    );
  });

  test('⚠ giving up on the chase clears the commitment rather than leaving it to expire', () => {
    const { engine, mobber, breakOff } = underCharge();
    engine.step(1);
    assert.notEqual(mobber.defendUntil, null);
    breakOff();
    // Starve it: `eat` outscores a 0.7 pursuit long before the clock runs out, which
    // is the A34 discipline holding — a pursuit is something a comfortable animal
    // does and a hungry one gives up.
    mobber.energy = 0;
    engine.step(1);
    assert.notEqual(mobber.action, 'defend', 'hunger won');
    assert.equal(mobber.defendUntil, null, 'and the animal is not still on a chase it abandoned');
    assert.equal(mobber.defendThreatX, null);
    assert.equal(mobber.defendThreatY, null);
  });

  test('⚠⚠ flee still wins against a second threat, and the guard is the only reason', () => {
    // ⚠⚠ **The arrangement is the test, and `CHARGER`'s `fleeWeight: 1.0` is the
    // load-bearing part of it.** On a species with the config's 2.0 this proves
    // nothing: flee beats any sane pursuit on the weights alone, so the guard could
    // be deleted with every assertion still green. At the buffalo's own 1.0 a
    // predator 5.5 cells away scores 0.54 against the pursuit's 0.9 — the *weights*
    // say keep chasing, and only "a perceived threat cancels the pursuit outright"
    // says otherwise.
    // ⚠ Fed to the brim on purpose: at the harness's default half-energy `eat`
    // scores 0.7 and wins on its own, which would make this block pass while saying
    // nothing about fleeing at all.
    const { engine, mobber, breakOff } = underCharge({ energyFraction: 1 });
    engine.step(1);
    assert.equal(mobber.action, 'defend');
    breakOff();
    engine.step(1);
    assert.equal(mobber.action, 'defend', 'the pursuit is running');

    // A second predator, uncommitted (so no fresh mob forms), and far enough that
    // its flee urgency is *below* the pursuit's weight.
    const second = spawn(engine, LONE_HUNTER.id, { x: mobber.x + 5.5, y: mobber.y, energyFraction: 0.9 });
    second.huntTargetId = null;
    engine.step(1);
    const urgency = 1.0 * (0.5 + 0.5 * (1 - 5.5 / 6));
    assert.ok(urgency < 0.9, `the weights favour the pursuit (${urgency.toFixed(3)} against 0.9)`);
    assert.equal(mobber.action, 'flee', 'and it runs anyway');
    assert.equal(mobber.defendUntil, null, 'the commitment is dropped, not merely outscored');
  });

  test('⚠ pursuitTicks 0 is its own arm — charge in, do not follow', () => {
    // ⚠ Arranged through the **world ceiling** rather than a fourth species: the two
    // are the same statement (`pursuitTicksOf` takes the smaller), and this is the
    // arm that also proves the ceiling is the thing being read.
    const engine = decisionSystems(sandbox(), { maxPursuitTicks: 0 });
    const ward = spawn(engine, CHARGER.id, { x: 30, y: 30 });
    const mobber = spawn(engine, CHARGER.id, { x: 31, y: 30 });
    for (let i = 0; i < 2; i += 1) spawn(engine, CHARGER.id, { x: 31 + i * 0.5, y: 31 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 32, y: 30, energyFraction: 0.2 });
    hunter.huntTargetId = ward.id;
    engine.step(1);
    assert.equal(mobber.action, 'defend');
    assert.equal(mobber.moveIntent.sprint, true, 'it still charges');
    assert.equal(mobber.defendUntil, engine.tick, 'and its commitment is already over');
    hunter.huntTargetId = null;
    engine.world.moveEntity(hunter, 60, 60);
    engine.step(1);
    assert.notEqual(mobber.action, 'defend', 'so nothing follows');
  });

  test('a species that declares nothing is never written at all', () => {
    const { engine, mobber } = underCharge({ speciesId: MOBBER.id });
    engine.step(3);
    assert.equal(mobber.action, 'defend', 'it mobs exactly as it did');
    assert.equal(mobber.defendUntil, null);
    assert.equal(mobber.defendThreatX, null);
    assert.equal(mobber.defendThreatY, null);
  });

  test('the shipped roster declares it where the brief asked and nowhere else', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const charging = engine.species.all().filter((s) => chargeWeightOf(s) > 0).map((s) => s.id);
    assert.deepEqual(charging, ['herbivore.buffalo'], 'the animal mobbing was built for, and only it');
    const buffalo = engine.species.get('herbivore.buffalo');
    // ⚠⚠ **Above its own `alarmFlee`, and that is a finding rather than a taste.**
    // The two compete by construction — an alarm-flee fires exactly when no threat
    // is perceived, which is exactly what a pursuit is for — and every pursuit begins
    // inside `social.alarmTicks` of the predator that caused it. Below this product
    // the mechanism forms commitments and never once acts on one, which is what the
    // shipped 0.7 did for an afternoon.
    assert.ok(
      chargeWeightOf(buffalo) > buffalo.behavior.fleeWeight * 0.75,
      'a pursuit can outlast the alarm that necessarily accompanies it',
    );
    // ⚠ And under `eat` for a hungry animal, so a pursuit is what a comfortable
    // buffalo does and a hungry one gives up — the A34 discipline, with no threshold.
    assert.ok(chargeWeightOf(buffalo) < CONFIG.decision.eatBias + buffalo.behavior.hungerWeight);
  });

  test('a commitment survives a save, and the run continues identically (persistence)', () => {
    const build = () => decisionSystems(sandbox({ seed: 4 }));
    const engine = build();
    const ward = spawn(engine, CHARGER.id, { x: 30, y: 30 });
    const mobber = spawn(engine, CHARGER.id, { x: 31, y: 30 });
    for (let i = 0; i < 2; i += 1) spawn(engine, CHARGER.id, { x: 31 + i * 0.5, y: 31 });
    const hunter = spawn(engine, LONE_HUNTER.id, { x: 32, y: 30, energyFraction: 0.2 });
    hunter.huntTargetId = ward.id;
    engine.step(1);
    assert.notEqual(mobber.defendUntil, null);
    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));

    const restored = build();
    const registry = restored.species;
    restoreSimulationState(restored, saved);
    restored.species = registry;
    restored.world.species = registry;
    const same = restored.world.entities.get(mobber.id);
    for (const field of ['defendUntil', 'defendThreatX', 'defendThreatY']) {
      assert.equal(same[field], mobber[field], `${field} round-trips`);
    }
    // ⚠ Entities serialize whole, so a missing field fails *silently* — which is why
    // this steps both worlds on rather than only checking the load did not throw.
    engine.world.moveEntity(hunter, 60, 60);
    restored.world.moveEntity(restored.world.entities.get(hunter.id), 60, 60);
    hunter.huntTargetId = null;
    restored.world.entities.get(hunter.id).huntTargetId = null;
    engine.step(10);
    restored.step(10);
    assert.equal(
      JSON.stringify(captureSimulationState(restored).entities),
      JSON.stringify(captureSimulationState(engine).entities),
      'and the restored run continues identically',
    );
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

describe('cooperative action: inert wherever the declaring species is not', () => {
  // ⚠ **This block used to assert the demo byte-identical with both mechanisms
  // off, and phase 11 took that reading away** — exactly as phase 9 warned it
  // would: "take it while the roster still states nothing, because once a species
  // declares a weight the arms diverge by design". The lion declares
  // `hunting.cooperationWeight` and the buffalo `behavior.mobWeight`, so the demo
  // is now *supposed* to differ.
  //
  // What survives is the claim that still means something: a world without the
  // declaring species is untouched by either mechanism, down to the byte. That is
  // what makes the incumbent species' numbers still comparable across a phase
  // boundary, and it is the property that would break silently if a future species
  // picked up a weight without anyone noticing.
  //
  // ⚠⚠ **The hyena left this world on 2026-08-07 (PREDATOR-PLAN P5), which is the
  // second time this block has had to give ground and for the same reason.** It
  // now declares `hunting.cooperationWeight` — the phase's whole point, since the
  // brief asks hyenas to hunt cooperatively — so a world containing one is no
  // longer a world the mechanism cannot touch. ⚠ It passed for one run anyway,
  // because six hyenas over 400 ticks happened not to join a hunt; the sibling
  // roster test below is what actually caught the change, exactly as its own
  // comment predicted it would.
  const NO_COOPERATORS = [
    { speciesId: 'herbivore.gazelle', count: 120 },
    { speciesId: 'predator.leopard', count: 8 },
    { speciesId: 'scavenger.vulture', count: 10 },
  ];

  test('⚠ a world holding no declaring species is byte-identical with both mechanisms off', () => {
    const on = createDemoSimulation({ seed: 42, config: { demo: { founding: NO_COOPERATORS } } });
    const off = createDemoSimulation({
      seed: 42,
      config: { demo: { founding: NO_COOPERATORS }, cooperation: { enabled: false }, mobbing: { enabled: false } },
    });
    on.step(400);
    off.step(400);
    assert.deepEqual(captureSimulationState(on).entities, captureSimulationState(off).entities);
  });

  test('exactly one species declares each weight, and it is the one the mechanism was built for', () => {
    // ⚠ Stated as a test rather than as a comment, because the byte-identity
    // above becomes a *false* claim the moment another species picks up a weight
    // — and the failure would read as a determinism bug rather than as the roster
    // change it actually was.
    const registry = new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG);
    const cooperates = registry.all().filter((s) => s.hunting.cooperationWeight > 0).map((s) => s.id);
    const mobs = registry.all().filter((s) => s.behavior.mobWeight > 0).map((s) => s.id);
    // ⚠ **The hyena joined on 2026-08-07 (PREDATOR-PLAN P5)** — the brief asks that
    // hyenas hunt cooperatively within their clan, and "this can share logic with
    // lions" turned out to be one field. ⚠⚠ This test did exactly what its comment
    // above says it exists for: it failed on the roster change rather than letting
    // the sibling byte-identity claim above fail later and read as a determinism
    // bug. Keep it derived from the registry, and keep updating it here.
    assert.deepEqual(cooperates, ['predator.lion', 'scavenger.hyena'], 'a pride and a clan');
    assert.deepEqual(mobs, ['herbivore.buffalo'], 'a buffalo herd, and nothing else');
    // And the mobbing species must want to stand more than it wants to run, or
    // the mechanism can never win the decision it competes in.
    const buffalo = registry.require('herbivore.buffalo');
    assert.ok(buffalo.behavior.mobWeight > buffalo.behavior.fleeWeight, 'mobbing outranks fleeing for a mobbing species');
  });
});

describe('batch 2: the two mechanisms in the demo world', () => {
  // ⚠ **PLAN-SPECIES §9 asks for this directly rather than through populations**,
  // and phase 7 is why: a registry that quietly never founded a second clan would
  // still pass a survival gate. The same is true here — a lion pride that never
  // once hunted together, and a buffalo herd that never once stood its ground,
  // would leave every population number looking perfectly reasonable.
  //
  // ⚠⚠ **The two mechanisms confound each other, and the first version of this
  // test was fooled by it.** A co-attacked buffalo is very often also a mobbed
  // one, so comparing "attempts with company" against "attempts alone" compares
  // cells that differ in *two* ways at once — and it read backwards (0.330 with
  // company against 0.391 alone) while both mechanisms were working perfectly.
  // The claim is therefore made inside a 2×2: company against alone **among
  // unmobbed attempts**, and mobbed against unmobbed **among solo attempts**.
  // ⚠⚠ **Seed 1 was replaced by seed 2 on 2026-07-31, because it contributed
  // nothing to the cell this block's central claim is about.** The A64 group fix
  // moved the demo's trajectory and this failed on `soloMobbed.n >= 3`.
  //
  // It was not a regression, and the thing that settles that is the *odds*
  // rather than the counts: measured against a `groups.rejoinWhileDispersing`
  // control on the old seeds, mobbed odds were **0.243 against 0.420 unmobbed in
  // both arms**, and `coopMobbed` was n=8 at 0.284 in both. Every claim here held
  // identically; only the sample size moved.
  //
  // ⚠ And the sample was never really there. Solo-hunter attempts that are *also*
  // mobbed are the rarest of the four cells, and **seed 1 produces zero of them**
  // — so the old pair totalled exactly 3 against a threshold of exactly 3, and
  // any change to the demo tips it. That is a tripwire, not a property of the
  // mechanism (DOCS §1.4: a single-seed assertion about the demo is an assertion
  // about a *trajectory*).
  //
  // Seed 2 produces 7, taking the cell to **n=9** for the same two-seed runtime —
  // a margin instead of a coin flip, at no cost to the suite. ⚠ The claim was
  // checked to hold at every cumulative total across seeds 1, 42, 2, 3 and 7
  // before this pair was chosen, so this is a better-sampled cell rather than a
  // seed picked for its answer.
  //
  // ⚠⚠ **Widened again on 2026-08-01, and the tripwire fired exactly as predicted
  // above.** A67 (thermoregulation stopped being a standing tax on sound adults)
  // moved the demo's trajectory and `[42, 2]` fell to **n=2** on a threshold of 3.
  // Same story as before: not a regression, and the odds are what settle it —
  // re-measured per seed on the new world, `soloMobbed` runs 0.18–0.44 against a
  // `soloClean` of 0.37–0.48 everywhere it has any sample at all.
  //
  // Following this block's own method rather than inventing one: the two claims
  // were checked at **every cumulative total** across 42, 2, 3, 7, 1, 5 first.
  // Mobbing holds at all six; cooperation fails on seed 42 *alone* (0.419 against
  // 0.434, n=8) and holds from the second seed on — which is the same "one seed is
  // a trajectory" point one more time. `[42, 2, 3, 5]` takes the thin cell to
  // **n=7** with both claims holding at each step, so this is again a
  // better-sampled cell and not a seed picked for its answer. It costs the suite
  // two more demo runs; the alternative is a 3-attempt sample deciding whether
  // mobbing works.
  // ⚠⚠ **Widened a third time on 2026-08-06, and the tripwire fired exactly as
  // predicted above — for the fourth time.** BEHAVIOR-PLAN P9 gave the buffalo a
  // charge and a pursuit, which moves the demo's trajectory, and `[42, 2, 3, 5]`
  // fell to **n=2** on a threshold of 3. Same story every time: not a regression,
  // and the *odds* are what settle it. Re-measured cumulatively across 42, 2, 3, 5,
  // 1, 7, 11, 13 — the method this block already uses — `soloMobbed` runs
  // **0.204–0.224 against a `soloClean` of 0.363–0.371 at every cumulative total it
  // has a sample at**, and the cooperation claim holds at all eight.
  //
  // ⚠ **The two extra seeds are chosen for sample size, and this time with room to
  // spare.** `[42, 2, 3, 5, 1]` would clear the bar at n=5; `[42, 2, 3, 5, 1, 7]`
  // takes it to **n=10 against a threshold of 3**, which is the first time this cell
  // has had a margin rather than a coin flip. It costs the suite two more demo runs,
  // and the alternative is re-tuning this list on every phase that touches a
  // buffalo. ⚠ Note what the thin cell actually is: a **solo** lion attempt that is
  // *also* mobbed is the rarest of the four, and nothing about mobbing being rare in
  // the demo has changed — see DOCS §1.2 A33.
  const SEEDS = [42, 2, 3, 5, 1, 7];
  const TICKS = 6000;

  const observed = (() => {
    const cell = () => ({ n: 0, kills: 0, chance: 0 });
    const seen = {
      lionKills: new Map(),
      soloClean: cell(),
      coopClean: cell(),
      soloMobbed: cell(),
      coopMobbed: cell(),
      buffaloStandTicks: 0,
      buffaloMobTicks: 0,
      lionTrampled: 0,
      prideTicks: 0,
    };
    for (const seed of SEEDS) {
      const engine = createDemoSimulation({ seed });
      const world = engine.world;
      for (let t = 0; t < TICKS; t += 1) {
        const before = engine.events.lastSeq;
        engine.step(1);
        for (const event of engine.eventsSince(before)) {
          if (event.type === EventTypes.ENTITY_INJURED && event.injury === 'trample') {
            if (world.entities.get(event.entityId)?.speciesId === LION.id) seen.lionTrampled += 1;
          }
          if (event.type === EventTypes.ENTITY_KILLED) {
            const prey = world.entities.get(event.entityId);
            const hunter = world.entities.get(event.predatorId);
            if (hunter?.speciesId === LION.id && prey) {
              seen.lionKills.set(prey.speciesId, (seen.lionKills.get(prey.speciesId) ?? 0) + 1);
            }
          }
          if (event.type !== EventTypes.ENTITY_HUNTED) continue;
          const hunter = world.entities.get(event.entityId);
          if (hunter?.speciesId !== LION.id) continue;
          const prey = world.entities.get(event.targetId);
          if (!prey) continue;
          // The two counts the hunting system itself made, recomputed from the
          // state the attempt was resolved against.
          let attackers = 0;
          let mobbers = 0;
          for (const other of world.entities.all()) {
            if (other.kind !== 'animal' || other.id === hunter.id || !other.alive) continue;
            if (Math.hypot(other.x - prey.x, other.y - prey.y) > 6) continue;
            if (other.speciesId === LION.id && other.huntTargetId === event.targetId) attackers += 1;
            if (other.defendingId === event.targetId) mobbers += 1;
          }
          const bucket = seen[(attackers > 0 ? 'coop' : 'solo') + (mobbers > 0 ? 'Mobbed' : 'Clean')];
          bucket.n += 1;
          bucket.chance += event.chance;
          if (event.captured) bucket.kills += 1;
        }
        for (const entity of world.entities.all()) {
          if (entity.kind !== 'animal' || !entity.alive) continue;
          if (entity.speciesId === LION.id && entity.groupRecordId !== null) seen.prideTicks += 1;
          if (entity.speciesId !== BUFFALO.id || entity.action !== 'defend') continue;
          if (entity.defendingId === entity.id) seen.buffaloStandTicks += 1;
          else seen.buffaloMobTicks += 1;
        }
      }
    }
    return seen;
  })();

  /** Mean capture chance in a cell — the deterministic product, not the draw. */
  const odds = (cell) => cell.chance / Math.max(1, cell.n);
  const show = (label, cell) =>
    `${label} ${odds(cell).toFixed(3)} (${cell.n} attempts, ${cell.kills} taken)`;

  test('lions and hyenas partition the prey base by mass, rather than competing for it', () => {
    // ⚠ The whole reason the lion lists only buffalo: perception reports the
    // *nearest* eligible prey (A58), so a lion that would also take gazelle spends
    // its life on gazelle — measured at 2 buffalo attempts in 4000 ticks — and
    // batch 2 then demonstrates nothing. §2's competitive-exclusion case, avoided
    // by a mass partition rather than by tuning.
    assert.ok(observed.lionKills.get(BUFFALO.id) > 0, 'the pride kills buffalo');
    assert.equal(observed.lionKills.get('herbivore.gazelle'), undefined, 'and never a gazelle');
  });

  test('a pride exists between sightings, and hunting together pays', () => {
    assert.ok(observed.prideTicks > 0, 'the group registry founds prides');
    const alone = observed.soloClean;
    const company = observed.coopClean;
    assert.ok(company.n >= 5 && alone.n >= 5, `enough of each to compare (${alone.n} alone, ${company.n} with company)`);
    // ⚠ The odds, not the outcomes: a demo run yields a few dozen attempts and at
    // that sample size the captured *rate* is a coin flip. `chance` is the
    // deterministic product the mechanism multiplies.
    assert.ok(
      odds(company) > odds(alone),
      `${show('mean capture chance with a pride-mate', company)} against ${show('alone', alone)}`,
    );
  });

  test('a buffalo herd stands its ground, and a hunt it stands against is a worse hunt', () => {
    assert.ok(observed.buffaloStandTicks > 0, 'the hunted buffalo turns and faces');
    assert.ok(observed.buffaloMobTicks > 0, 'and herdmates come to it');
    const mobbed = observed.soloMobbed;
    const unmobbed = observed.soloClean;
    assert.ok(mobbed.n >= 3, `attempts are resolved against a mob (${mobbed.n})`);
    assert.ok(
      odds(mobbed) < odds(unmobbed),
      `${show('mean capture chance against a mob', mobbed)} against ${show('unmobbed', unmobbed)}`,
    );
  });

  test('⚠ and hunting a 600 kg animal hurts: lions are trampled', () => {
    // `predation.riskyMassRatio: 3` is what lets a buffalo's mass reach the
    // hunter's injury odds at all — the config's 2 would clip it to the danger of
    // a 360 kg animal. This is "takes buffalo at real risk" as a number.
    assert.ok(observed.lionTrampled > 0, 'the risk term fires in the demo');
  });
});

describe('coordinated stalking (PREDATOR-PLAN P4)', () => {
  // ⚠⚠ **What is claimed here is approach from distinct bearings, and it is not
  // encirclement.** Encirclement and flanking as the brief asks for them are not
  // expressible in this engine at all — there is no repulsion anywhere, and a
  // weighted mean of positions cannot repel (DOCS §1.3). Every assertion below is
  // about *which quarry* several hunters commit to and *what bearing* each comes
  // in on. None is about a formation, and none should be added.
  //
  // ⚠ **The geometry is tested directly rather than through a live stalk**, and the
  // two reasons are worth writing down because both were found by trying:
  //
  //   1. `entity.actionTarget` keeps only `{cellX, cellY}` — the exact flank point
  //      is internal to `#intentFor` — so a live stalk cannot be measured to better
  //      than a cell.
  //   2. **A stalk does not last.** `chasing` is forced the moment the quarry
  //      bolts, and a prey animal that can see its hunter bolts on the next tick,
  //      so any world where a hunter is inside its own perception radius of the
  //      prey gives one tick of stalking and then a sprint. Building a world where
  //      that is not true means tuning two perception radii against each other,
  //      which would make the test about the radii.
  //
  // So the fan-out is asserted on `approachPoint` with commitments set by hand —
  // the cheapest world that states the claim — and the *joining* half, which is
  // about a decision rather than a geometry, is asserted live.

  /** Commit these hunters to this quarry, as the decision system would. */
  function commit(hunters, prey) {
    for (const hunter of hunters) hunter.huntTargetId = prey.id;
  }

  const bearingOf = (point, prey) => Math.atan2(point.y - prey.y, point.x - prey.x);

  test('a stalk is joinable, which a chase-only rule could never express', () => {
    // The brief: "a pride should be able to collectively decide to attack a prey
    // **before a member has entered `chase`**". With the pre-P4 rule the first
    // hunter had to be sprinting before anyone could join, so a converged pride was
    // always downstream of somebody's solo commitment.
    //
    // ⚠ Distances: the stalker is 5 from the quarry (outside `chaseRange` 4, inside
    // its own perception 6) so it stalks rather than chases; the joiner is 9 from
    // the quarry — beyond its own perception, so it cannot have found the prey
    // itself — and 4 from the stalker, so it can see the stalker.
    const engine = decisionSystems(sandbox());
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const stalker = spawn(engine, PACK_HUNTER.id, { x: 35, y: 30, energyFraction: 0.1 });
    const joiner = spawn(engine, PACK_HUNTER.id, { x: 39, y: 30, energyFraction: 0.1 });
    engine.step(1);
    assert.equal(stalker.action, 'stalk', 'the first hunter is stalking, not chasing');
    assert.equal(engine.world.perception.get(joiner.id).nearestPrey, null, 'the joiner cannot see the prey itself');
    assert.equal(joiner.huntTargetId, prey.id, 'and joins the stalk anyway');
  });

  test('⚠ `joinStalks: false` is the pre-P4 rule exactly', () => {
    // The reproducible control: same world, same tick, one flag.
    const engine = decisionSystems(sandbox(), { cooperationJoinStalks: false });
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const stalker = spawn(engine, PACK_HUNTER.id, { x: 35, y: 30, energyFraction: 0.1 });
    const joiner = spawn(engine, PACK_HUNTER.id, { x: 39, y: 30, energyFraction: 0.1 });
    engine.step(1);
    assert.equal(stalker.action, 'stalk');
    assert.equal(joiner.huntTargetId, null, 'a stalk is not joinable with the flag off');
  });

  test('co-stalkers aim on bearings spread around the quarry', () => {
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    // Three hunters bunched on one side: with no spread all three would aim at the
    // same point, which is what makes the separation below attributable to this
    // mechanism rather than to where they were standing.
    const pack = [
      spawn(engine, PACK_HUNTER.id, { x: 35, y: 30 }),
      spawn(engine, PACK_HUNTER.id, { x: 35, y: 30.2 }),
      spawn(engine, PACK_HUNTER.id, { x: 35.1, y: 29.8 }),
    ];
    commit(pack, prey);
    const cooperation = { ...CONFIG.cooperation };
    const bearings = pack.map((h) => bearingOf(approachPoint(engine.world, h, prey, cooperation), prey));
    const sorted = [...bearings].sort((a, b) => a - b);
    const spread = sorted[2] - sorted[0];
    // ⚠ Derived from the declared spread, never a literal: the mechanism fans the
    // outermost pair by exactly `approachSpread` about their own mean bearing, and
    // the three animals here start within 0.06 rad of each other.
    assert.ok(spread > cooperation.approachSpread * 0.9, `three co-stalkers only ${spread.toFixed(3)} rad apart`);
    for (const h of pack) {
      const point = approachPoint(engine.world, h, prey, cooperation);
      const distance = Math.hypot(point.x - prey.x, point.y - prey.y);
      assert.ok(Math.abs(distance - cooperation.approachRadius) < 1e-9, 'each aims at the approach radius');
    }
  });

  test('⚠ a lone stalker gets the quarry itself, unchanged and uncopied', () => {
    // The identity that makes the mechanism free when it is not being used, and the
    // one a later "tidy-up" of the geometry would most easily break. Object
    // identity, not just equal coordinates: the common path must not allocate.
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const hunter = spawn(engine, PACK_HUNTER.id, { x: 35, y: 30 });
    commit([hunter], prey);
    assert.equal(approachPoint(engine.world, hunter, prey, { ...CONFIG.cooperation }), prey);
  });

  test('⚠ zero spread and a disabled mechanism are both exactly the identity', () => {
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const pack = [spawn(engine, PACK_HUNTER.id, { x: 35, y: 30 }), spawn(engine, PACK_HUNTER.id, { x: 35, y: 30.2 })];
    commit(pack, prey);
    for (const cooperation of [
      { ...CONFIG.cooperation, approachSpread: 0 },
      { ...CONFIG.cooperation, enabled: false },
    ]) {
      assert.equal(approachPoint(engine.world, pack[0], prey, cooperation), prey);
    }
  });

  test('⚠ only animals hunting *together* are counted, so a stranger cannot fan a pride out', () => {
    // The same test `attackersFor` makes, and it has to be the same or two hunters
    // of different species on one carcass-to-be would spread each other.
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const hunter = spawn(engine, PACK_HUNTER.id, { x: 35, y: 30 });
    const stranger = spawn(engine, LONE_HUNTER.id, { x: 35, y: 30.2 });
    commit([hunter, stranger], prey);
    assert.equal(approachPoint(engine.world, hunter, prey, { ...CONFIG.cooperation }), prey, 'a different species is not a co-stalker');
  });

  test('⚠ the rank is derived every tick, never stored', () => {
    // Invariant 17 — no per-pair state — and the property that makes a fan-out
    // survive a stalker joining or dying without anything to keep in step. Removing
    // the middle hunter re-derives two ranks rather than leaving a hole.
    const engine = sandbox();
    const prey = spawn(engine, HERD_ANIMAL.id, { x: 30, y: 30 });
    const pack = [
      spawn(engine, PACK_HUNTER.id, { x: 35, y: 30 }),
      spawn(engine, PACK_HUNTER.id, { x: 35, y: 30.2 }),
      spawn(engine, PACK_HUNTER.id, { x: 35.1, y: 29.8 }),
    ];
    commit(pack, prey);
    const cooperation = { ...CONFIG.cooperation };
    // ⚠ **Watch the *middle* animal, not an extreme.** The offsets are normalized
    // to ±spread/2 at the ends whatever `n` is, so removing one extreme leaves the
    // other extreme's offset identical — the first version of this test dropped the
    // middle hunter and asserted the last one moved, which it does not, and the
    // test was wrong rather than the code. Removing an *extreme* is what promotes
    // the middle animal from offset 0 to an end.
    const middleBefore = bearingOf(approachPoint(engine.world, pack[1], prey, cooperation), prey);
    pack[0].alive = false;
    const middleAfter = bearingOf(approachPoint(engine.world, pack[1], prey, cooperation), prey);
    assert.notEqual(middleBefore, middleAfter, 'the middle hunter re-ranks when an end one drops');
    // And with only two left they are the two ends, symmetric about their own
    // bearings — nothing is left holding a rank from when there were three.
    const ends = [pack[1], pack[2]].map((h) => {
      const point = approachPoint(engine.world, h, prey, cooperation);
      return bearingOf(point, prey) - Math.atan2(h.y - prey.y, h.x - prey.x);
    });
    assert.ok(Math.abs(ends[0] + ends[1]) < 1e-9, `two survivors are not symmetric: ${ends.join(', ')}`);
  });
});
