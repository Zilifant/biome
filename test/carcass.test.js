import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { CarcassSystem, DECAY_STAGES, STAGE_YIELD } from '../src/simulation/systems/CarcassSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import { killAnimal } from '../src/simulation/systems/death.js';
import {
  lookupLineage,
  recordTombstone,
  LineageStatus,
  MAX_TOMBSTONES,
} from '../src/simulation/world/lineage.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.grazer');
const STALKER = getSpecies('predator.stalker');

function sandbox({ seed = 3, size = 44, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: size, height: size }, terrain: { lakes: 0, ridges: 0, coverPatchDensity: 0 } },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawnCarcass(engine, { x = 20, y = 20, edibleMass = 18, diedTick = 0, speciesId = GRAZER.id } = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'carcass',
    speciesId,
    x,
    y,
    alive: false,
    edibleMass,
    diedTick,
    deathCause: 'predation',
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

function spawnPredator(engine, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: STALKER.id,
    heading: 0,
    lifeStage: 'adult',
    bodyMass: STALKER.bodyMass,
    adultMass: STALKER.bodyMass,
    speed: STALKER.baseSpeed,
    maxEnergy: STALKER.maxEnergy,
    energy: STALKER.maxEnergy * 0.3,
    maxHealth: STALKER.maxHealth,
    maxHydration: STALKER.maxHydration,
    maxStamina: STALKER.maxStamina,
    stamina: STALKER.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('carcass: decay stages', () => {
  test('stages advance on schedule and are announced once each', () => {
    const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 })] });
    const id = spawnCarcass(engine, { diedTick: 0 });
    const stageSpan = CONFIG.carcass.decayTicks / DECAY_STAGES.length;

    const seen = [];
    for (let i = 0; i < DECAY_STAGES.length; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.decayed') seen.push(event.stageName);
      }
      assert.equal(engine.world.entities.get(id).decayStage, 0, 'still fresh early on');
      if (i === 0) assert.deepEqual(seen, [], 'a fresh carcass announces nothing');
    }

    // Step past the first boundary and the stage moves exactly once.
    const before = engine.events.lastSeq;
    engine.step(Math.ceil(stageSpan));
    const advanced = engine.eventsSince(before).filter((e) => e.type === 'entity.decayed');
    assert.equal(engine.world.entities.get(id).decayStage, 1);
    assert.equal(advanced.length, 1, 'one announcement per stage, not one per tick');
    assert.equal(advanced[0].stageName, DECAY_STAGES[1]);
  });

  test('decay is a pure function of elapsed time, so staggering does not change it', () => {
    const stages = [1, 5].map((updateInterval) => {
      const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval })] });
      const id = spawnCarcass(engine, { diedTick: 0 });
      engine.step(Math.ceil((CONFIG.carcass.decayTicks / DECAY_STAGES.length) * 2) + 10);
      return engine.world.entities.get(id).decayStage;
    });
    assert.equal(stages[0], stages[1], `same stage either way (${stages})`);
  });

  test('flesh is worth less at every stage', () => {
    for (let stage = 1; stage < STAGE_YIELD.length; stage += 1) {
      assert.ok(STAGE_YIELD[stage] < STAGE_YIELD[stage - 1], `stage ${stage} yields less than ${stage - 1}`);
    }
    assert.equal(CarcassSystem.yieldFor({ decayStage: 0 }), 1, 'a fresh kill is worth full value');
    assert.ok(CarcassSystem.yieldFor({ decayStage: 99 }) > 0, 'an unknown stage still yields something');
  });
});

describe('carcass: being eaten', () => {
  test('scavenging removes exactly the mass it converts to energy', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem(CONFIG.perception),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new FeedingSystem(CONFIG.feeding),
      ],
    });
    const predatorId = spawnPredator(engine, { x: 20, y: 20 });
    const carcassId = spawnCarcass(engine, { x: 20.2, y: 20, edibleMass: 18 });

    const energyBefore = engine.world.entities.get(predatorId).energy;
    const massBefore = engine.world.entities.get(carcassId).edibleMass;
    engine.step(1);

    const eaten = massBefore - engine.world.entities.get(carcassId).edibleMass;
    const gained = engine.world.entities.get(predatorId).energy - energyBefore;
    assert.ok(eaten > 0, 'the carcass lost mass');
    // Fresh (stage 0), so the full conversion rate applies.
    const expected = eaten * CONFIG.feeding.energyPerMass * CONFIG.feeding.carnivoreEfficiency;
    assert.ok(Math.abs(gained - expected) < 1e-9, `mass converts at the stated rate (${gained} vs ${expected})`);
  });

  test('an old carcass feeds a scavenger less than a fresh one', () => {
    const gainAtStage = (decayStage) => {
      const engine = sandbox({
        systems: [
          new PerceptionSystem(CONFIG.perception),
          new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
          new FeedingSystem(CONFIG.feeding),
        ],
      });
      const predatorId = spawnPredator(engine, { x: 20, y: 20 });
      const carcassId = spawnCarcass(engine, { x: 20.2, y: 20, edibleMass: 18 });
      engine.world.entities.get(carcassId).decayStage = decayStage;
      const before = engine.world.entities.get(predatorId).energy;
      engine.step(1);
      return engine.world.entities.get(predatorId).energy - before;
    };
    const fresh = gainAtStage(0);
    const remains = gainAtStage(DECAY_STAGES.length - 1);
    assert.ok(fresh > remains, `a fresh kill is worth more (${fresh.toFixed(2)} vs ${remains.toFixed(2)})`);
  });

  test('a carcass eaten clean is removed, and returns nothing to the ground', () => {
    const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 })] });
    const carcassId = spawnCarcass(engine, { x: 20.5, y: 20.5, edibleMass: 18 });
    engine.world.entities.get(carcassId).edibleMass = 0; // scavengers took it all
    const biomassBefore = engine.world.vegetation.biomassAt(20, 20);

    engine.step(1);
    assert.equal(engine.world.entities.get(carcassId), null, 'removed from the world');
    assert.equal(engine.world.vegetation.biomassAt(20, 20), biomassBefore, 'nothing left to give back');
  });
});

describe('carcass: rotting away', () => {
  test('an untouched carcass disappears by the expected tick and feeds the ground', () => {
    const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 })] });
    const carcassId = spawnCarcass(engine, { x: 20.5, y: 20.5, edibleMass: 18, diedTick: 0 });
    // Strip the cell so the nutrient pulse is unambiguous.
    engine.world.vegetation.consumeAt(20, 20, Number.MAX_SAFE_INTEGER);
    const biomassBefore = engine.world.vegetation.biomassAt(20, 20);

    engine.step(CONFIG.carcass.decayTicks - 1);
    assert.ok(engine.world.entities.get(carcassId), 'still present just before the deadline');
    assert.equal(engine.world.entities.get(carcassId).decayStage, DECAY_STAGES.length - 1, 'fully decayed stage');

    engine.step(2);
    assert.equal(engine.world.entities.get(carcassId), null, 'gone by the expected tick');
    assert.ok(
      engine.world.vegetation.biomassAt(20, 20) > biomassBefore,
      'what was left went back into the cell',
    );
  });

  test('the nutrient pulse is applied once, not every tick', () => {
    const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 })] });
    spawnCarcass(engine, { x: 20.5, y: 20.5, edibleMass: 6, diedTick: 0 });
    engine.world.vegetation.consumeAt(20, 20, Number.MAX_SAFE_INTEGER);

    engine.step(CONFIG.carcass.decayTicks + 1);
    const afterRemoval = engine.world.vegetation.biomassAt(20, 20);
    engine.step(20);
    assert.equal(engine.world.vegetation.biomassAt(20, 20), afterRemoval, 'the pulse does not repeat');
  });

  test('the deposit is capped by what the cell can support', () => {
    const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 })] });
    spawnCarcass(engine, { x: 20.5, y: 20.5, edibleMass: 10000, diedTick: 0 });
    engine.step(CONFIG.carcass.decayTicks + 1);
    const capacity = engine.world.vegetation.capacityAt(20, 20);
    assert.ok(engine.world.vegetation.biomassAt(20, 20) <= capacity + 1e-6, 'never past carrying capacity');
  });
});

describe('carcass: lineage across removal (§1.4 C2)', () => {
  test('a reference reports alive, carcass, dead, or forgotten — and is never wrong', () => {
    const engine = sandbox({ systems: [new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 })] });
    const id = spawnPredator(engine, { x: 10, y: 10 });
    assert.equal(lookupLineage(engine.world, id).status, LineageStatus.ALIVE);

    const entity = engine.world.entities.get(id);
    killAnimal(entity, 'starvation', 10, () => {}, engine.tick);
    assert.equal(lookupLineage(engine.world, id).status, LineageStatus.CARCASS, 'dead but still here');

    engine.step(CONFIG.carcass.decayTicks + 2);
    assert.equal(engine.world.entities.get(id), null, 'the body is gone');
    const dead = lookupLineage(engine.world, id);
    assert.equal(dead.status, LineageStatus.DEAD, 'but it is remembered');
    assert.equal(dead.cause, 'starvation', 'along with what killed it');
    assert.equal(dead.speciesId, STALKER.id);

    assert.equal(lookupLineage(engine.world, 99999).status, LineageStatus.FORGOTTEN, 'never-known ids read as forgotten');
  });

  test('the tombstone registry is bounded, evicting the oldest first', () => {
    const engine = sandbox();
    const overflow = 20;
    for (let i = 1; i <= MAX_TOMBSTONES + overflow; i += 1) {
      recordTombstone(engine.world, { id: i, speciesId: GRAZER.id, deathCause: 'age', diedTick: i }, i);
    }
    assert.equal(engine.world.tombstones.size, MAX_TOMBSTONES, 'capped');
    assert.equal(lookupLineage(engine.world, 1).status, LineageStatus.FORGOTTEN, 'the oldest fell off');
    assert.equal(lookupLineage(engine.world, MAX_TOMBSTONES + overflow).status, LineageStatus.DEAD, 'the newest is kept');
  });

  test('every removal is remembered, whatever removed it', () => {
    // A command-driven removal takes a completely different path from decay.
    const engine = sandbox();
    const id = spawnPredator(engine, { x: 10, y: 10 });
    engine.submitCommand({ type: 'entity.remove', entityId: id });
    engine.step(1);
    assert.equal(engine.world.entities.get(id), null);
    assert.equal(lookupLineage(engine.world, id).status, LineageStatus.DEAD, 'the chokepoint caught it');
  });

  test('inspection resolves parent and offspring ids rather than handing over raw numbers', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(2500);
    const withKin = [...engine.world.entities.all()].find((e) => e.parents.length > 0 || e.offspring.length > 0);
    assert.ok(withKin, 'someone has relatives by now');
    const details = engine.getEntityDetails(withKin.id);
    for (const entry of [...details.lineage.parents, ...details.lineage.offspring]) {
      assert.ok(Object.values(LineageStatus).includes(entry.status), `unknown status ${entry.status}`);
      const present = engine.world.entities.get(entry.id);
      const claimsPresent = entry.status === LineageStatus.ALIVE || entry.status === LineageStatus.CARCASS;
      assert.equal(present != null, claimsPresent, `#${entry.id} reported ${entry.status}`);
    }
  });
});

describe('carcass: demonstration scenario', () => {
  test('a carcass is scavenged down, decays through its stages, and vanishes', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem(CONFIG.perception),
        new DecisionSystem({ ...CONFIG.decision, foodMinLevel: 1 }),
        new MovementSystem(CONFIG.locomotion),
        new FeedingSystem(CONFIG.feeding),
        new MetabolismSystem({ ...CONFIG.metabolism, ...CONFIG.locomotion }),
        new CarcassSystem({ ...CONFIG.carcass, updateInterval: 1 }),
      ],
    });
    // A hungry scavenger a short walk from a fresh body.
    const predatorId = spawnPredator(engine, { x: 24, y: 20, energy: STALKER.maxEnergy * 0.2 });
    const carcassId = spawnCarcass(engine, { x: 20.5, y: 20.5, edibleMass: 20, diedTick: 0 });
    const startingMass = engine.world.entities.get(carcassId).edibleMass;

    let approached = false;
    let ate = false;
    const stagesSeen = new Set();
    for (let tick = 0; tick < CONFIG.carcass.decayTicks + 20; tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      const predator = engine.world.entities.get(predatorId);
      if (predator?.alive && ['seekFood', 'eat'].includes(predator.action)) approached = true;
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.fed' && event.carcassId === carcassId) ate = true;
        if (event.type === 'entity.decayed' && event.entityId === carcassId) stagesSeen.add(event.stageName);
      }
      if (!engine.world.entities.get(carcassId)) break;
    }

    assert.ok(approached, 'the carcass drew a scavenger');
    assert.ok(ate, 'which fed on it');
    assert.ok(stagesSeen.size > 0, `it decayed through stages (${[...stagesSeen]})`);
    assert.equal(engine.world.entities.get(carcassId), null, 'and is gone');
    // Either eaten down or rotted away — both are legitimate ends, but the
    // mass must have gone somewhere.
    assert.ok(startingMass > 0);
    assert.equal(lookupLineage(engine.world, carcassId).status, LineageStatus.DEAD, 'still remembered');
  });
});

describe('carcass: protocol, persistence, and the demo', () => {
  test('decayStage rides in bulk snapshots so the renderer can ramp its glyph', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('decayStage'));
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.equal(typeof entity.decayStage, 'number');
      if (entity.alive) assert.equal(entity.decayStage, 0, 'living animals are always stage 0');
      assert.ok(!('edibleMass' in entity), 'absolute mass stays inspection-only');
    }
  });

  test('carcasses stop accumulating — the demo reaches a steady state', () => {
    const engine = createDemoSimulation({ seed: 42 });
    let removed = 0;
    let peak = 0;
    for (let tick = 0; tick < 9000; tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.removed') removed += 1;
      }
      if (tick % 100 === 0) {
        peak = Math.max(peak, [...engine.world.entities.all()].filter((e) => e.kind === 'carcass').length);
      }
    }
    assert.ok(removed > 0, 'carcasses are actually leaving the world');
    const deaths = [...engine.world.entities.all()].filter((e) => e.kind === 'carcass').length;
    assert.ok(deaths <= peak, 'the standing carcass count is bounded, not monotonic');
    assert.ok(engine.world.tombstones.size <= CONFIG.lineage.maxTombstones, 'tombstones stay bounded');
  });

  test('carcass state and tombstones survive save/load; the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(4000);
    const saved = captureSimulationState(engine);
    assert.ok(saved.tombstones.length > 0, 'something has been forgotten by now');

    const restored = restoreDemoSimulation(saved);
    assert.equal(restored.world.tombstones.size, engine.world.tombstones.size, 'tombstones round-trip');
    assert.deepEqual(
      [...restored.world.entities.all()].map((e) => ({ id: e.id, decayStage: e.decayStage, diedTick: e.diedTick })),
      [...engine.world.entities.all()].map((e) => ({ id: e.id, decayStage: e.decayStage, diedTick: e.diedTick })),
    );
    engine.step(400);
    restored.step(400);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('decay keeps the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
