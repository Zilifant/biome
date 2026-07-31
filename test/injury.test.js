import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import {
  applyInjury,
  totalSeverity,
  refreshImpairment,
  InjuryKinds,
  MAX_INJURIES,
  HEALED_BELOW,
} from '../src/simulation/injury/injuries.js';
import { InjurySystem } from '../src/simulation/systems/InjurySystem.js';
import { HuntingSystem } from '../src/simulation/systems/HuntingSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { LifeEventTypes } from '../src/simulation/systems/lifeEvents.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.gazelle');
const STALKER = getSpecies('predator.leopard');

function sandbox({ seed = 3, size = 44, systems = [], hunting = null } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: size, height: size },
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
      ...(hunting ? { hunting } : {}),
    },
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
    energy: species.maxEnergy,
    maxHealth: species.maxHealth,
    maxHydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('injury: the bound and the derived total', () => {
  test('impairment is the summed severity, clamped to 1', () => {
    const entity = { injuries: [], impairment: 0 };
    applyInjury(entity, InjuryKinds.WOUND, 0.3, 1);
    assert.ok(Math.abs(entity.impairment - 0.3) < 1e-9);
    applyInjury(entity, InjuryKinds.WOUND, 0.4, 2);
    assert.ok(Math.abs(entity.impairment - 0.7) < 1e-9, 'wounds stack');
    applyInjury(entity, InjuryKinds.TRAMPLE, 0.9, 3);
    assert.equal(entity.impairment, 1, 'and are capped at crippled');
    assert.equal(totalSeverity(entity), 1);
  });

  test('past the cap, damage is folded in rather than dropped', () => {
    const entity = { injuries: [], impairment: 0 };
    for (let i = 0; i < MAX_INJURIES; i += 1) applyInjury(entity, InjuryKinds.WOUND, 0.1, i);
    assert.equal(entity.injuries.length, MAX_INJURIES);
    const before = totalSeverity(entity);

    applyInjury(entity, InjuryKinds.WOUND, 0.2, 99);
    assert.equal(entity.injuries.length, MAX_INJURIES, 'still capped');
    assert.ok(totalSeverity(entity) > before, 'but the animal is genuinely worse off');
  });

  test('a scratch too small to matter is not recorded', () => {
    const entity = { injuries: [], impairment: 0 };
    assert.equal(applyInjury(entity, InjuryKinds.WOUND, HEALED_BELOW / 2, 1), null);
    assert.equal(entity.injuries.length, 0);
  });

  test('refreshImpairment recomputes from the list, so it cannot drift', () => {
    const entity = { injuries: [{ kind: 'wound', severity: 0.5, tick: 1 }], impairment: 999 };
    assert.ok(Math.abs(refreshImpairment(entity) - 0.5) < 1e-9);
    entity.injuries.length = 0;
    assert.equal(refreshImpairment(entity), 0);
  });
});

describe('injury: penalties while wounded', () => {
  test('a wounded animal limps', () => {
    const engine = sandbox({ systems: [new MovementSystem({ ...CONFIG.locomotion, injurySpeedPenalty: CONFIG.injury.speedPenalty })] });
    const healthyId = spawn(engine, GRAZER, { x: 10, y: 10 });
    const hurtId = spawn(engine, GRAZER, { x: 10, y: 30 });
    applyInjury(engine.world.entities.get(hurtId), InjuryKinds.WOUND, 0.6, 0);
    for (const id of [healthyId, hurtId]) {
      engine.world.entities.get(id).moveIntent = { heading: 0, ttl: 5, moving: true, sprint: false };
    }
    engine.step(1);
    const healthy = engine.world.entities.get(healthyId);
    const hurt = engine.world.entities.get(hurtId);
    assert.ok(hurt.x - 10 < healthy.x - 10, `the injured animal covered less ground (${hurt.x - 10} vs ${healthy.x - 10})`);
  });

  test('a wounded herbivore feeds worse', () => {
    const engine = sandbox({
      systems: [new FeedingSystem({ ...CONFIG.feeding, injuryFeedPenalty: CONFIG.injury.feedPenalty })],
    });
    const healthyId = spawn(engine, GRAZER, { x: 10.5, y: 10.5, energy: 10, action: 'eat' });
    const hurtId = spawn(engine, GRAZER, { x: 30.5, y: 30.5, energy: 10, action: 'eat' });
    applyInjury(engine.world.entities.get(hurtId), InjuryKinds.WOUND, 0.8, 0);
    const before = { healthy: engine.world.entities.get(healthyId).energy, hurt: engine.world.entities.get(hurtId).energy };
    engine.step(1);
    const healthyGain = engine.world.entities.get(healthyId).energy - before.healthy;
    const hurtGain = engine.world.entities.get(hurtId).energy - before.hurt;
    assert.ok(healthyGain > 0 && hurtGain > 0, 'both ate something');
    assert.ok(hurtGain < healthyGain, `the injured animal got less (${hurtGain.toFixed(3)} vs ${healthyGain.toFixed(3)})`);
  });

  test('an injury makes an animal easier to catch, through the existing capture odds', () => {
    const system = new HuntingSystem(CONFIG.hunting);
    const predator = { speed: 1.35, stamina: 100, maxStamina: 100, health: 100, maxHealth: 100, bodyMass: 45, adultMass: 45 };
    const healthy = { speed: 1.2, stamina: 100, maxStamina: 100, health: 100, maxHealth: 100, bodyMass: 30, adultMass: 30 };
    const wounded = { ...healthy, health: 55 };
    assert.ok(system.captureChance(predator, wounded) > system.captureChance(predator, healthy));
  });
});

describe('injury: healing', () => {
  test('wounds close over time, cost energy, and restore health', () => {
    const engine = sandbox({ systems: [new InjurySystem(CONFIG.injury)] });
    const id = spawn(engine, GRAZER, { x: 10, y: 10, health: 70 });
    const entity = engine.world.entities.get(id);
    applyInjury(entity, InjuryKinds.WOUND, 0.3, 0);
    const energyBefore = entity.energy;

    engine.step(50);
    assert.ok(entity.injuries[0].severity < 0.3, 'the wound is closing');
    assert.ok(entity.energy < energyBefore, 'healing was paid for');
    assert.ok(entity.health > 70, 'and health came back');
    assert.ok(entity.impairment < 0.3, 'impairment fell with it');
  });

  test('an animal too hungry to spare the energy does not heal at all', () => {
    const engine = sandbox({ systems: [new InjurySystem(CONFIG.injury)] });
    const starving = spawn(engine, GRAZER, { x: 10, y: 10, energy: GRAZER.maxEnergy * 0.1 });
    const fed = spawn(engine, GRAZER, { x: 20, y: 10, energy: GRAZER.maxEnergy });
    for (const id of [starving, fed]) applyInjury(engine.world.entities.get(id), InjuryKinds.WOUND, 0.3, 0);
    engine.step(30);
    assert.equal(engine.world.entities.get(starving).injuries[0].severity, 0.3, 'no energy, no mending');
    assert.ok(engine.world.entities.get(fed).injuries[0].severity < 0.3, 'the fed animal healed');
  });

  test('a healed wound is dropped, announced, and written into the life history', () => {
    const engine = sandbox({ systems: [new InjurySystem(CONFIG.injury)] });
    const id = spawn(engine, GRAZER, { x: 10, y: 10 });
    const entity = engine.world.entities.get(id);
    applyInjury(entity, InjuryKinds.WOUND, 0.05, 0);
    const before = engine.events.lastSeq;

    engine.step(40);
    assert.equal(entity.injuries.length, 0, 'fully recovered');
    assert.equal(entity.impairment, 0);
    const recovered = engine.eventsSince(before).find((e) => e.type === 'entity.recovered');
    assert.ok(recovered, 'recovery announced');
    assert.equal(recovered.injury, InjuryKinds.WOUND);
    assert.ok(entity.lifeEvents.some((e) => e.type === LifeEventTypes.RECOVERED));
  });

  test('a wound severe enough to empty an animal kills it, with cause "injury"', () => {
    const engine = sandbox({ systems: [new InjurySystem(CONFIG.injury)] });
    const id = spawn(engine, GRAZER, { x: 10, y: 10, health: 5 });
    const entity = engine.world.entities.get(id);
    applyInjury(entity, InjuryKinds.WOUND, 0.9, 0);
    entity.health = 0; // the wound took everything it had
    const before = engine.events.lastSeq;

    engine.step(1);
    assert.equal(entity.alive, false);
    assert.equal(entity.kind, 'carcass');
    assert.ok(entity.edibleMass > 0);
    const died = engine.eventsSince(before).find((e) => e.type === 'entity.died');
    assert.equal(died.cause, 'injury');
  });
});

describe('injury: a failed hunt leaves marks', () => {
  /** Predator and prey adjacent, predator committed, capture impossible. */
  /**
   * ⚠ The two kinds of override go different ways round, and it matters.
   *
   * Capture odds (`baseCaptureChance`, `minCaptureChance`) live in
   * `config.hunting`, which became a **species block** on 2026-07-28 — so a
   * resolved species beats anything the system is constructed with (DOCS §8),
   * and they have to go through the config. The injury odds come from
   * `config.injury`, are not part of that block, and still configure the old way.
   *
   * Getting this wrong is D23, and it bit here first: with the odds passed as
   * constructor options the species' 0.28 silently won over the fixture's 0 and
   * 10, so "a successful capture" stopped capturing — and, worse, the *failed*
   * hunts in this file were only failing by luck.
   */
  function failedHunt({ baseCaptureChance = 0, minCaptureChance = 0, ...injuryOverrides } = {}) {
    const engine = sandbox({ hunting: { baseCaptureChance, minCaptureChance } });
    engine.registerSystem(
      new HuntingSystem({
        ...engine.config.hunting,
        preyInjuryChance: CONFIG.injury.preyInjuryChance,
        preyInjurySeverity: CONFIG.injury.preyInjurySeverity,
        predatorInjuryChance: CONFIG.injury.predatorInjuryChance,
        predatorInjurySeverity: CONFIG.injury.predatorInjurySeverity,
        injuryHealthDamage: CONFIG.injury.healthDamage,
        ...injuryOverrides,
      }),
    );
    const predatorId = spawn(engine, STALKER, { x: 20, y: 20 });
    const preyId = spawn(engine, GRAZER, { x: 20.8, y: 20 });
    engine.world.entities.get(predatorId).action = 'chase';
    engine.world.entities.get(predatorId).huntTargetId = preyId;
    return { engine, predatorId, preyId };
  }

  test('prey that get away are usually wounded, losing health and speed', () => {
    // Certainty here is about consequences, not luck — the odds themselves are
    // covered by the demo integration test below.
    const { engine, preyId, predatorId } = failedHunt({ preyInjuryChance: 1 });
    const before = engine.events.lastSeq;
    engine.step(1);

    const prey = engine.world.entities.get(preyId);
    assert.equal(prey.alive, true, 'it escaped');
    assert.equal(prey.injuries.length, 1, 'but not unscathed');
    assert.equal(prey.injuries[0].kind, InjuryKinds.WOUND);
    assert.ok(prey.impairment > 0);
    assert.ok(prey.health < GRAZER.maxHealth, 'the wound took health');

    const injured = engine.eventsSince(before).find((e) => e.type === 'entity.injured');
    assert.equal(injured.entityId, preyId);
    assert.equal(injured.sourceId, predatorId, 'the event names who did it');
    assert.ok(prey.lifeEvents.some((e) => e.type === LifeEventTypes.INJURED));
  });

  test('a lucky prey escapes untouched', () => {
    const { engine, preyId } = failedHunt({ preyInjuryChance: 0, predatorInjuryChance: 0 });
    engine.step(1);
    const prey = engine.world.entities.get(preyId);
    assert.equal(prey.injuries.length, 0);
    assert.equal(prey.health, GRAZER.maxHealth);
  });

  test('prey can hurt their attacker on the way out', () => {
    // ⚠ **2, not 1, and the reason is the mechanism under test.** `trampleChance`
    // is the configured chance scaled by `defenderMass / attackerMass` — a light
    // animal cannot hurt a heavy one much — so against a 60 kg leopard a 30 kg
    // gazelle halves it. At 1 this was a coin flip that happened to land, and it
    // stopped landing when the leopard's mass went 45 → 60 at phase 14. 2 × 0.5 is
    // certainty, which is what the test means.
    const { engine, predatorId } = failedHunt({ predatorInjuryChance: 2 });
    engine.step(1);
    const predator = engine.world.entities.get(predatorId);
    assert.equal(predator.injuries.length, 1, 'hunting is a gamble in both directions');
    assert.equal(predator.injuries[0].kind, InjuryKinds.TRAMPLE);
  });

  test('a successful capture wounds nobody — the prey is simply dead', () => {
    const { engine, preyId, predatorId } = failedHunt({ baseCaptureChance: 10, preyInjuryChance: 1, predatorInjuryChance: 1 });
    engine.step(1);
    assert.equal(engine.world.entities.get(preyId).alive, false);
    assert.equal(engine.world.entities.get(preyId).injuries.length, 0);
    assert.equal(engine.world.entities.get(predatorId).injuries.length, 0);
  });

  test('the hunting stream spends the same draws whether or not anyone is hurt', () => {
    const outcomes = [1, 0].map((chance) => {
      const { engine } = failedHunt({ preyInjuryChance: chance, predatorInjuryChance: chance });
      engine.step(1);
      return engine.randomStream('hunting').getState();
    });
    assert.equal(outcomes[0], outcomes[1], 'a fixed draw budget keeps the stream aligned');
  });
});

describe('injury: demonstration scenario', () => {
  test('an animal takes a nonfatal wound, is visibly slowed, then recovers on schedule', () => {
    const engine = sandbox({
      systems: [
        new MovementSystem({ ...CONFIG.locomotion, injurySpeedPenalty: CONFIG.injury.speedPenalty }),
        new InjurySystem(CONFIG.injury),
      ],
    });
    const id = spawn(engine, GRAZER, { x: 5, y: 20 });
    const entity = engine.world.entities.get(id);

    // Baseline: how far it travels in ten unhurt ticks.
    entity.moveIntent = { heading: 0, ttl: 999, moving: true, sprint: false };
    const startX = entity.x;
    engine.step(10);
    const healthyDistance = entity.x - startX;
    assert.ok(healthyDistance > 0);

    // Wound it, and the same ten ticks cover measurably less ground.
    const severity = 0.3;
    applyInjury(entity, InjuryKinds.WOUND, severity, engine.tick);
    entity.health -= severity * CONFIG.injury.healthDamage;
    assert.ok(entity.impairment > 0, 'it is impaired');
    const hurtStart = entity.x;
    entity.moveIntent = { heading: 0, ttl: 999, moving: true, sprint: false };
    engine.step(10);
    const hurtDistance = entity.x - hurtStart;
    assert.ok(hurtDistance < healthyDistance, `limping (${hurtDistance.toFixed(2)} vs ${healthyDistance.toFixed(2)})`);

    // Healing is not instant, and the arrival time is predictable from config:
    // severity has to fall from 0.3 to the HEALED_BELOW threshold.
    const expectedTicks = Math.ceil((severity - HEALED_BELOW) / CONFIG.injury.healRatePerTick);
    engine.step(Math.floor(expectedTicks * 0.5));
    assert.equal(entity.injuries.length, 1, 'still wounded halfway through');
    assert.ok(entity.impairment < severity, 'but mending');

    engine.step(expectedTicks); // comfortably past the predicted recovery
    assert.equal(entity.injuries.length, 0, `recovered by tick ${engine.tick}`);
    assert.equal(entity.impairment, 0);

    // And it moves like its old self again. Reset the position first — by now
    // it has walked the width of the sandbox and would clamp at the border.
    engine.world.moveEntity(entity, 5, 20);
    const healedStart = entity.x;
    entity.moveIntent = { heading: 0, ttl: 999, moving: true, sprint: false };
    engine.step(10);
    assert.ok(Math.abs(entity.x - healedStart - healthyDistance) < 1e-9, 'back to full speed');
  });
});

describe('injury: protocol, persistence, and the demo', () => {
  test('injuries are inspection-only; the grid sees only healthFraction', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(300);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.ok(!('injuries' in entity) && !('impairment' in entity), 'injuries stay out of bulk snapshots');
    }
    assert.ok(!PUBLIC_ENTITY_FIELDS.includes('injuries'));
    // The renderer tints from healthFraction, which was already projected.
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('healthFraction'));

    const id = [...engine.world.entities.all()][0].id;
    const details = engine.getEntityDetails(id);
    assert.ok(Array.isArray(details.injuries));
    assert.equal(typeof details.impairment, 'number');
  });

  test('inspection returns copies — mutating them cannot reach engine state', () => {
    const engine = sandbox({ systems: [new InjurySystem(CONFIG.injury)] });
    const id = spawn(engine, GRAZER, { x: 10, y: 10 });
    applyInjury(engine.world.entities.get(id), InjuryKinds.WOUND, 0.4, 0);
    const details = engine.getEntityDetails(id);
    details.injuries[0].severity = 99;
    details.injuries.push({ kind: 'forged', severity: 1 });
    const entity = engine.world.entities.get(id);
    assert.ok(Math.abs(entity.injuries[0].severity - 0.4) < 1e-9);
    assert.ok(!entity.injuries.some((i) => i.kind === 'forged'));
  });

  test('the demo wounds animals and heals them, staying within the cap', () => {
    const engine = createDemoSimulation({ seed: 42 });
    let injured = 0;
    let recovered = 0;
    for (let tick = 0; tick < 8000; tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.injured') injured += 1;
        if (event.type === 'entity.recovered') recovered += 1;
      }
      for (const entity of engine.world.entities.all()) {
        assert.ok(entity.injuries.length <= MAX_INJURIES, 'injuries stay bounded');
        assert.ok(entity.impairment >= 0 && entity.impairment <= 1, 'impairment stays in range');
      }
    }
    assert.ok(injured > 0, 'failed hunts wounded animals');
    assert.ok(recovered > 0, 'and some of them healed');
  });

  test('injuries survive save/load and the restored run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3000);
    const saved = captureSimulationState(engine);
    const before = [...engine.world.entities.all()].map((e) => ({ id: e.id, injuries: e.injuries, impairment: e.impairment }));

    const restored = restoreDemoSimulation(saved);
    assert.deepEqual(
      [...restored.world.entities.all()].map((e) => ({ id: e.id, injuries: e.injuries, impairment: e.impairment })),
      before,
      'injuries round-trip exactly',
    );
    engine.step(400);
    restored.step(400);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('injury keeps the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
