import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { HuntingSystem } from '../src/simulation/systems/HuntingSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import { getSpecies, SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { MemoryKinds } from '../src/simulation/memory/memories.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.grazer');
// The predator/prey relation now lives on the resolved registry (Step 29).
const REGISTRY = new SpeciesRegistry(SPECIES_DEFINITIONS, {});
const hunts = (a, b) => REGISTRY.hunts(a, b);
const STALKER = getSpecies('predator.stalker');

/** Bare open ground, so nothing but the two animals is in play. */
function sandbox({ seed = 3, size = 44, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: size, height: size }, terrain: { lakes: 0, ridges: 0, coverPatchDensity: 0 } },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawn(engine, species, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: species.id,
    heading: 0,
    lifeStage: 'adult',
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy * 0.5,
    maxHealth: species.maxHealth,
    maxHydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** Predator and prey adjacent, with the predator already committed to a chase. */
function lunge(engine, { predator = {}, prey = {} } = {}) {
  const predatorId = spawn(engine, STALKER, { x: 20, y: 20, ...predator });
  const preyId = spawn(engine, GRAZER, { x: 20.8, y: 20, ...prey });
  engine.world.entities.get(predatorId).action = 'chase';
  engine.world.entities.get(predatorId).huntTargetId = preyId;
  return { predatorId, preyId };
}

describe('predation: the species relation', () => {
  test('the predator/prey relation is data, read in both directions', () => {
    assert.equal(hunts(STALKER.id, GRAZER.id), true);
    assert.equal(hunts(GRAZER.id, STALKER.id), false, 'grazers do not hunt');
    assert.equal(hunts(GRAZER.id, GRAZER.id), false, 'nor each other');
    assert.equal(hunts('nonexistent.species', GRAZER.id), false, 'unknown species hunt nothing');
  });

  test('perception reports what I hunt and what hunts me, from the grid alone', () => {
    const engine = sandbox({ systems: [new PerceptionSystem(CONFIG.perception)] });
    const predatorId = spawn(engine, STALKER, { x: 20, y: 20 });
    const preyId = spawn(engine, GRAZER, { x: 23, y: 20 });
    const farId = spawn(engine, GRAZER, { x: 40, y: 40 }); // beyond perception
    engine.step(1);

    const predatorView = engine.world.perception.get(predatorId);
    assert.equal(predatorView.nearestPrey.id, preyId, 'the predator sees prey');
    assert.equal(predatorView.nearestThreat, null, 'and nothing that hunts it');

    const preyView = engine.world.perception.get(preyId);
    assert.equal(preyView.nearestThreat.id, predatorId, 'the prey sees the threat');
    assert.equal(preyView.nearestPrey, null, 'and has no prey of its own');

    assert.equal(engine.world.perception.get(farId).nearestThreat, null, 'detection is bounded by the radius');
  });
});

describe('predation: capture odds come from relative state', () => {
  const system = new HuntingSystem(CONFIG.hunting);
  const animal = (overrides) => ({
    speed: 1.2,
    stamina: 100,
    maxStamina: 100,
    health: 100,
    maxHealth: 100,
    bodyMass: 30,
    adultMass: 30,
    ...overrides,
  });

  test('a faster predator is likelier to catch, a faster prey likelier to escape', () => {
    const evenly = system.captureChance(animal({ speed: 1.2 }), animal({ speed: 1.2 }));
    const fastPredator = system.captureChance(animal({ speed: 1.8 }), animal({ speed: 1.2 }));
    const fastPrey = system.captureChance(animal({ speed: 1.2 }), animal({ speed: 1.8 }));
    assert.ok(fastPredator > evenly, 'speed advantage helps the hunter');
    assert.ok(fastPrey < evenly, 'and hurts it');
  });

  test('a tired predator does worse; a tired prey does worse still', () => {
    const fresh = system.captureChance(animal({}), animal({}));
    const tiredPredator = system.captureChance(animal({ stamina: 5 }), animal({}));
    const tiredPrey = system.captureChance(animal({}), animal({ stamina: 5 }));
    assert.ok(tiredPredator < fresh, 'an exhausted predator loses the last strides');
    assert.ok(tiredPrey > fresh, 'an exhausted prey cannot keep away');
  });

  test('a wounded or half-grown animal is easier prey', () => {
    const healthy = system.captureChance(animal({}), animal({}));
    const wounded = system.captureChance(animal({}), animal({ health: 20 }));
    const juvenile = system.captureChance(animal({}), animal({ bodyMass: 8, adultMass: 30 }));
    assert.ok(wounded > healthy, 'injury raises the odds');
    assert.ok(juvenile > healthy, 'so does not being grown yet');
  });

  test('the odds are always a real gamble — never zero, never certain', () => {
    const untouchable = system.captureChance(animal({ speed: 0.1, stamina: 0 }), animal({ speed: 9, stamina: 100 }));
    const doomed = system.captureChance(animal({ speed: 9 }), animal({ speed: 0.1, stamina: 0, health: 1, bodyMass: 1 }));
    assert.ok(untouchable >= CONFIG.hunting.minCaptureChance, 'nothing is ever safe');
    assert.ok(doomed <= CONFIG.hunting.maxCaptureChance, 'nothing is ever certain');
  });
});

describe('predation: capture and escape', () => {
  test('a successful capture kills the prey and leaves a carcass to eat', () => {
    // Odds forced to certainty so the outcome is about consequences, not luck.
    const engine = sandbox({ systems: [new HuntingSystem({ ...CONFIG.hunting, baseCaptureChance: 10 })] });
    const { predatorId, preyId } = lunge(engine);
    const before = engine.events.lastSeq;
    engine.step(1);

    const prey = engine.world.entities.get(preyId);
    assert.equal(prey.alive, false, 'the prey died');
    assert.equal(prey.kind, 'carcass', 'and became a carcass in place');
    assert.ok(prey.edibleMass > 0, 'with edible mass on it');

    const events = engine.eventsSince(before);
    const hunted = events.find((e) => e.type === 'entity.hunted');
    assert.equal(hunted.entityId, predatorId);
    assert.equal(hunted.targetId, preyId);
    assert.equal(hunted.captured, true);
    assert.ok(hunted.chance > 0, 'the odds are reported, not hidden');
    assert.ok(events.some((e) => e.type === 'entity.killed' && e.predatorId === predatorId));
    assert.ok(events.some((e) => e.type === 'entity.died' && e.cause === 'predation'));
  });

  test('a failed hunt costs the predator energy and teaches the prey the place is dangerous', () => {
    const engine = sandbox({ systems: [new HuntingSystem({ ...CONFIG.hunting, baseCaptureChance: 0, minCaptureChance: 0 })] });
    const { predatorId, preyId } = lunge(engine);
    const energyBefore = engine.world.entities.get(predatorId).energy;
    const before = engine.events.lastSeq;
    engine.step(1);

    const predator = engine.world.entities.get(predatorId);
    const prey = engine.world.entities.get(preyId);
    assert.equal(prey.alive, true, 'the prey got away');
    assert.equal(predator.energy, energyBefore - CONFIG.hunting.failedHuntEnergyCost, 'the miss was paid for');
    assert.ok(
      prey.memories.some((m) => m.kind === MemoryKinds.DANGER),
      'and the prey now remembers this place as dangerous',
    );
    assert.ok(engine.eventsSince(before).some((e) => e.type === 'entity.escaped' && e.predatorId === predatorId));
  });

  test('the lunge costs stamina and starts the recovery pause either way', () => {
    const engine = sandbox({ systems: [new HuntingSystem({ ...CONFIG.hunting, baseCaptureChance: 0, minCaptureChance: 0 })] });
    const { predatorId } = lunge(engine);
    engine.step(1);
    const predator = engine.world.entities.get(predatorId);
    assert.equal(predator.stamina, STALKER.maxStamina - CONFIG.hunting.captureStaminaCost);
    assert.equal(predator.lastHuntTick, 1, 'the cooldown clock started');
  });

  test('no attempt is made from out of range', () => {
    const engine = sandbox({ systems: [new HuntingSystem({ ...CONFIG.hunting, baseCaptureChance: 10 })] });
    const { preyId } = lunge(engine, { prey: { x: 26, y: 20 } }); // well beyond captureRange
    engine.step(1);
    assert.equal(engine.world.entities.get(preyId).alive, true, 'still closing, no lunge yet');
  });
});

describe('predation: sprinting and stamina', () => {
  test('sprinting is faster than walking and spends the sprint budget', () => {
    const engine = sandbox({ systems: [new MovementSystem(CONFIG.locomotion)] });
    const walkerId = spawn(engine, GRAZER, { x: 10, y: 10 });
    const sprinterId = spawn(engine, GRAZER, { x: 10, y: 30 });
    engine.world.entities.get(walkerId).moveIntent = { heading: 0, ttl: 5, moving: true, sprint: false };
    engine.world.entities.get(sprinterId).moveIntent = { heading: 0, ttl: 5, moving: true, sprint: true };
    engine.step(1);

    const walker = engine.world.entities.get(walkerId);
    const sprinter = engine.world.entities.get(sprinterId);
    assert.ok(sprinter.x - 10 > walker.x - 10, 'the sprinter covered more ground');
    assert.equal(walker.stamina, GRAZER.maxStamina, 'walking is free');
    assert.equal(sprinter.stamina, GRAZER.maxStamina - CONFIG.locomotion.sprintStaminaCost, 'sprinting is not');
  });

  test('an exhausted animal drops back to a walk mid-chase', () => {
    const engine = sandbox({ systems: [new MovementSystem(CONFIG.locomotion)] });
    const id = spawn(engine, GRAZER, { x: 10, y: 10, stamina: 0 });
    engine.world.entities.get(id).moveIntent = { heading: 0, ttl: 5, moving: true, sprint: true };
    engine.step(1);
    const entity = engine.world.entities.get(id);
    assert.ok(Math.abs(entity.x - 10 - GRAZER.baseSpeed) < 1e-9, 'moved at walking pace, not sprint pace');
    assert.equal(entity.stamina, 0, 'and could not spend what it did not have');
  });

  test('stamina recovers only while not sprinting', () => {
    const engine = sandbox({ systems: [new MetabolismSystem({ ...CONFIG.metabolism, ...CONFIG.locomotion })] });
    const id = spawn(engine, GRAZER, { x: 10, y: 10, stamina: 50 });
    engine.step(10);
    const entity = engine.world.entities.get(id);
    assert.ok(entity.stamina > 50, `recovered while resting (${entity.stamina})`);
    assert.ok(entity.stamina <= entity.maxStamina, 'never past full');
  });
});

describe('predation: prey flee and predators pursue', () => {
  function chaseEngine(seed = 3) {
    return sandbox({
      seed,
      systems: [
        new PerceptionSystem(CONFIG.perception),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new MovementSystem(CONFIG.locomotion),
        new HuntingSystem(CONFIG.hunting),
      ],
    });
  }

  test('prey drop everything and run when a predator comes into view', () => {
    const engine = chaseEngine();
    const preyId = spawn(engine, GRAZER, { x: 20, y: 20, energy: 10 }); // hungry: would rather eat
    spawn(engine, STALKER, { x: 23, y: 20, energy: 20 });
    engine.step(1);
    const prey = engine.world.entities.get(preyId);
    assert.equal(prey.action, 'flee', 'fleeing outranks even a hungry animal grazing');
    assert.ok(prey.moveIntent.sprint, 'and it sprints');
    // Running directly away from the predator, which is to its +x side.
    assert.ok(Math.cos(prey.moveIntent.heading) < 0, 'away from the threat, not toward it');
  });

  test('a hungry predator stalks at distance and commits to a sprint up close', () => {
    const engine = chaseEngine();
    const predatorId = spawn(engine, STALKER, { x: 20, y: 20, energy: 20 }); // hungry
    spawn(engine, GRAZER, { x: 26, y: 20 }); // seen, but beyond chaseRange
    engine.step(1);
    assert.equal(engine.world.entities.get(predatorId).action, 'stalk', 'closes quietly at range');
    assert.equal(engine.world.entities.get(predatorId).moveIntent.sprint, false, 'saving the sprint budget');

    const close = chaseEngine();
    const closeId = spawn(close, STALKER, { x: 20, y: 20, energy: 20 });
    spawn(close, GRAZER, { x: 22, y: 20 }); // within chaseRange
    close.step(1);
    assert.equal(close.world.entities.get(closeId).action, 'chase', 'commits when close');
    assert.equal(close.world.entities.get(closeId).moveIntent.sprint, true);
    assert.ok(close.world.entities.get(closeId).huntTargetId !== null, 'and has a committed target');
  });

  test('a fed predator leaves prey alone', () => {
    const engine = chaseEngine();
    const predatorId = spawn(engine, STALKER, { x: 20, y: 20, energy: STALKER.maxEnergy });
    spawn(engine, GRAZER, { x: 22, y: 20 });
    engine.step(1);
    const predator = engine.world.entities.get(predatorId);
    assert.ok(predator.action !== 'chase' && predator.action !== 'stalk', `a full predator does not hunt (${predator.action})`);
    assert.equal(predator.huntTargetId, null);
  });

  test('an exhausted predator does not start a hunt it cannot finish', () => {
    const engine = chaseEngine();
    const predatorId = spawn(engine, STALKER, { x: 20, y: 20, energy: 20, stamina: 1 });
    spawn(engine, GRAZER, { x: 22, y: 20 });
    engine.step(1);
    assert.equal(engine.world.entities.get(predatorId).huntTargetId, null);
  });
});

describe('predation: carnivores feed on carcasses', () => {
  test('a predator eats its kill, and the carcass is consumed as it does', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem(CONFIG.perception),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new FeedingSystem(CONFIG.feeding),
      ],
    });
    const predatorId = spawn(engine, STALKER, { x: 20, y: 20, energy: 20 });
    // A carcass right where the predator stands.
    const carcassId = engine.world.entities.queueSpawn({
      kind: 'carcass',
      speciesId: GRAZER.id,
      x: 20.2,
      y: 20,
      alive: false,
      edibleMass: 18,
    });
    engine.applyDeferredEntityChanges(0);

    const energyBefore = engine.world.entities.get(predatorId).energy;
    const massBefore = engine.world.entities.get(carcassId).edibleMass;
    engine.step(1);

    const predator = engine.world.entities.get(predatorId);
    const carcass = engine.world.entities.get(carcassId);
    assert.equal(predator.action, 'eat', 'a carcass in reach is food to a carnivore');
    assert.ok(predator.energy > energyBefore, 'it gained energy');
    assert.ok(carcass.edibleMass < massBefore, 'and the carcass lost mass');
  });

  test('a herbivore standing on the same carcass ignores it', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem(CONFIG.perception),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new FeedingSystem(CONFIG.feeding),
      ],
    });
    const grazerId = spawn(engine, GRAZER, { x: 20, y: 20, energy: 10 });
    const carcassId = engine.world.entities.queueSpawn({
      kind: 'carcass',
      speciesId: GRAZER.id,
      x: 20.2,
      y: 20,
      alive: false,
      edibleMass: 18,
    });
    engine.applyDeferredEntityChanges(0);
    engine.step(1);
    assert.equal(engine.world.entities.get(carcassId).edibleMass, 18, 'diet decides what counts as food');
    assert.ok(engine.world.entities.get(grazerId).alive);
  });
});

describe('predation: demonstration scenario and the demo', () => {
  test('predation sandbox: the same pairing both succeeds and fails, and the kill is eaten', () => {
    // One fixed scenario run at two capture-odds settings — the variants the
    // step asks for. Everything else, including the seed, is identical.
    const outcome = (baseCaptureChance) => {
      const engine = sandbox({
        systems: [
          new PerceptionSystem(CONFIG.perception),
          new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
          new MovementSystem(CONFIG.locomotion),
          new HuntingSystem({ ...CONFIG.hunting, baseCaptureChance }),
          new FeedingSystem(CONFIG.feeding),
        ],
      });
      const predatorId = spawn(engine, STALKER, { x: 20, y: 20, energy: 20 });
      spawn(engine, GRAZER, { x: 23, y: 20, stamina: 20 }); // already winded
      const seen = { stalk: false, chase: false, flee: false, hunted: 0, killed: 0, escaped: 0, ate: false };
      for (let tick = 0; tick < 60; tick += 1) {
        const before = engine.events.lastSeq;
        engine.step(1);
        for (const entity of engine.world.entities.all()) {
          if (entity.action === 'stalk') seen.stalk = true;
          if (entity.action === 'chase') seen.chase = true;
          if (entity.action === 'flee') seen.flee = true;
        }
        for (const event of engine.eventsSince(before)) {
          if (event.type === 'entity.hunted') seen.hunted += 1;
          if (event.type === 'entity.killed') seen.killed += 1;
          if (event.type === 'entity.escaped') seen.escaped += 1;
          if (event.type === 'entity.fed' && event.entityId === predatorId) seen.ate = true;
        }
      }
      return seen;
    };

    const certain = outcome(10);
    const hopeless = outcome(0);
    // Pursuit itself happens either way.
    for (const seen of [certain, hopeless]) {
      assert.ok(seen.chase, 'the predator committed to a chase');
      assert.ok(seen.flee, 'the prey ran');
      assert.ok(seen.hunted > 0, 'an attempt was made');
    }
    assert.ok(certain.killed > 0, 'the favourable variant produced a kill');
    assert.ok(certain.ate, 'and the predator fed on the carcass');
    assert.equal(hopeless.killed, 0, 'the unfavourable variant produced none');
    assert.ok(hopeless.escaped > 0, 'the prey escaped instead');
  });

  test('the demo sustains both species: hunts happen, and neither side is wiped out', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const seen = { hunted: 0, killed: 0, escaped: 0 };
    const actions = new Set();
    for (let tick = 0; tick < 8000; tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.hunted') seen.hunted += 1;
        if (event.type === 'entity.killed') seen.killed += 1;
        if (event.type === 'entity.escaped') seen.escaped += 1;
      }
      for (const entity of engine.world.entities.all()) {
        if (entity.alive) actions.add(entity.action);
      }
    }
    assert.ok(seen.hunted > 0, 'hunts were attempted');
    assert.ok(seen.killed > 0, 'some succeeded');
    assert.ok(seen.escaped > 0, 'and some failed');
    for (const action of ['stalk', 'chase', 'flee']) {
      assert.ok(actions.has(action), `the demo shows ${action}`);
    }
    const alive = [...engine.world.entities.all()].filter((e) => e.alive);
    assert.ok(alive.some((e) => e.speciesId === 'predator.stalker'), 'predators persisted');
    assert.ok(alive.some((e) => e.speciesId === 'herbivore.grazer'), 'and so did their prey');
  });

  test('predation state is inspection-only and stays out of bulk snapshots', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(200);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      for (const field of ['stamina', 'huntTargetId', 'lastHuntTick']) {
        assert.ok(!(field in entity), `${field} must not ride in bulk snapshots`);
      }
    }
    assert.ok(!PUBLIC_ENTITY_FIELDS.includes('stamina'));
    // `action` already carries stalk/chase/flee, which is how a viewer sees a hunt.
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('action'));
    const predator = [...engine.world.entities.all()].find((e) => e.speciesId === 'predator.stalker');
    const details = engine.getEntityDetails(predator.id);
    assert.equal(typeof details.stamina, 'number');
    assert.ok('huntTargetId' in details);
  });

  test('predation keeps the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('the hunting stream is independent of the others', () => {
    const a = createDemoSimulation({ seed: 55 });
    const b = createDemoSimulation({ seed: 55 });
    const scratch = b.randomStream('unrelated');
    for (let i = 0; i < 50; i += 1) scratch.next();
    a.step(500);
    b.step(500);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
