import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { ReproductionSystem, isReproductivelyReady } from '../src/simulation/systems/ReproductionSystem.js';
import { lookupLineage, LineageStatus } from '../src/simulation/world/lineage.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import { smallDemo } from './helpers/smallDemo.js';

const PARAMS = {
  matingRange: 2.0,
  minEnergyFraction: 0.7,
  matingEnergyCost: 8,
  gestationTicks: 50,
  birthEnergyCost: 15,
  offspringEnergyFraction: 0.6,
  cooldownTicks: 800,
  birthOffset: 1.0,
  birthMass: 5,
  // Mate choice is deliberately switched off in this suite (Step 22). These
  // tests are about pairing, gestation, cost, and timing; a declining
  // acceptance threshold would make their exact-tick assertions depend on
  // courtship too, and a test that fails for two reasons tells you neither.
  // A threshold of 0 is "accept anyone", i.e. the pre-Step-22 rule. Choice has
  // its own suite (test/mate-choice.test.js). The suitor bars are set equal to
  // the chooser's for the same reason: this suite tests one gate, not two.
  acceptanceThreshold: 0,
  suitorMinEnergyFraction: 0.7,
  suitorCooldownTicks: 800,
};

/** Engine with only reproduction, so pairing/gestation can be checked exactly. */
function reproEngine(params = {}) {
  // ⚠ Reproductive parameters are per-species from Step 29, so they go in the
  // *config* (which the species registry resolves against) as well as into the
  // system. A species' own block beats the system's constructor options.
  const reproduction = { ...PARAMS, ...params };
  const engine = new SimulationEngine({
    seed: 1,
    config: { world: { width: 32, height: 32 }, terrain: { ...FLAT_TERRAIN }, reproduction },
  });
  engine.registerSystem(new ReproductionSystem(reproduction));
  return engine;
}

/**
 * One adult. `sex` defaults to female (the gestating sex since Step 22), so a
 * pair is spawned as `spawnAdult(...)` then `spawnAdult(..., { sex: 'male' })`
 * — an unsexed pair can no longer mate at all, by design.
 */
function spawnAdult(engine, x, y, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.gazelle',
    x,
    y,
    heading: 0,
    lifeStage: 'adult',
    sex: 'female',
    bodyMass: 30,
    maxEnergy: 100,
    energy: 90,
    maxHealth: 100,
    maxHydration: 100,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** A female and a male, adjacent and both ready. */
function spawnPair(engine, overrides = {}) {
  return [
    spawnAdult(engine, 10, 10, { sex: 'female', ...overrides }),
    spawnAdult(engine, 11, 10, { sex: 'male', ...overrides }),
  ];
}

describe('reproduction: eligibility gating', () => {
  test('two well-fed adults in range mate; both pay the cost and enter cooldown', () => {
    const engine = reproEngine();
    const [a, b] = spawnPair(engine, { energy: 90 });
    const before = engine.events.lastSeq;
    engine.step(1);
    const ea = engine.world.entities.get(a);
    const eb = engine.world.entities.get(b);
    assert.equal(ea.energy, 82, 'initiator paid the mating cost');
    assert.equal(eb.energy, 82, 'partner paid the mating cost');
    assert.equal(ea.lastMatedTick, 1);
    assert.equal(eb.lastMatedTick, 1);
    // The female carries the pregnancy (Step 22 — it used to be the lower id).
    assert.equal(ea.gestationUntil, 1 + PARAMS.gestationTicks);
    assert.equal(eb.gestationUntil, null);
    assert.equal(ea.pendingMateId, b);
    const mated = engine.eventsSince(before).find((e) => e.type === 'entity.mated');
    assert.deepEqual([mated.entityId, mated.partnerId], [a, b]);
  });

  test('juveniles and subadults never mate (maturity gate)', () => {
    const engine = reproEngine();
    const [a, b] = [
      spawnAdult(engine, 10, 10, { sex: 'female', lifeStage: 'juvenile', energy: 100 }),
      spawnAdult(engine, 11, 10, { sex: 'male', lifeStage: 'subadult', energy: 100 }),
    ];
    engine.step(5);
    assert.equal(engine.world.entities.get(a).gestationUntil, null);
    assert.equal(engine.world.entities.get(b).gestationUntil, null);
  });

  test('under-fed adults never mate (energy gate)', () => {
    const engine = reproEngine();
    const [a, b] = spawnPair(engine, { energy: 50 }); // below the 70% threshold
    engine.step(5);
    assert.equal(engine.world.entities.get(a).gestationUntil, null);
    assert.equal(engine.world.entities.get(b).gestationUntil, null);
  });

  test('adults out of range never mate', () => {
    const engine = reproEngine();
    const a = spawnAdult(engine, 5, 5, { sex: 'female' });
    const b = spawnAdult(engine, 25, 25, { sex: 'male' }); // far beyond matingRange
    engine.step(5);
    assert.equal(engine.world.entities.get(a).gestationUntil, null);
    assert.equal(engine.world.entities.get(b).gestationUntil, null);
  });

  test('the cooldown prevents immediate re-mating', () => {
    const engine = reproEngine({ gestationTicks: 1 });
    const [a] = spawnPair(engine, { energy: 100 });
    engine.step(1); // mate
    const firstMated = engine.world.entities.get(a).lastMatedTick;
    engine.step(20); // gestation ends, but cooldown (800) blocks re-mating
    assert.equal(engine.world.entities.get(a).lastMatedTick, firstMated, 'did not mate again');
  });

  test('isReproductivelyReady is the single shared rule', () => {
    const entity = { kind: 'animal', alive: true, lifeStage: 'adult', gestationUntil: null, energy: 80, maxEnergy: 100, lastMatedTick: null };
    const params = { minEnergyFraction: 0.7, cooldownTicks: 800 };
    assert.equal(isReproductivelyReady(entity, 100, params), true);
    assert.equal(isReproductivelyReady({ ...entity, lifeStage: 'juvenile' }, 100, params), false);
    assert.equal(isReproductivelyReady({ ...entity, energy: 60 }, 100, params), false);
    assert.equal(isReproductivelyReady({ ...entity, gestationUntil: 500 }, 100, params), false);
    assert.equal(isReproductivelyReady({ ...entity, lastMatedTick: 99 }, 100, params), false);

    // Since Step 22 the bar depends on the role: the gestating sex must be well
    // fed and off a long cooldown, the seeking sex needs far less of both. That
    // asymmetry is the point, not a tuning convenience — so it is asserted.
    const sexed = { ...params, suitorMinEnergyFraction: 0.45, suitorCooldownTicks: 200 };
    const lean = { ...entity, energy: 50 };
    assert.equal(isReproductivelyReady({ ...lean, sex: 'female' }, 100, sexed), false, 'a lean female is not ready');
    assert.equal(isReproductivelyReady({ ...lean, sex: 'male' }, 100, sexed), true, 'the same male is');
    const recent = { ...entity, lastMatedTick: 600 };
    assert.equal(isReproductivelyReady({ ...recent, sex: 'female' }, 1000, sexed), false, 'she is still on cooldown');
    assert.equal(isReproductivelyReady({ ...recent, sex: 'male' }, 1000, sexed), true, 'he has recovered');
    // With no suitor bars given, both roles fall back to the one rule.
    assert.equal(isReproductivelyReady({ ...lean, sex: 'male' }, 100, params), false);
  });
});

describe('reproduction: gestation and birth', () => {
  test('birth happens exactly at term, with valid parent ids and a juvenile newborn', () => {
    const engine = reproEngine();
    const [a, b] = spawnPair(engine);
    engine.step(1); // mate at tick 1 → term at tick 51
    assert.equal(engine.entityCount, 2, 'no offspring yet');
    engine.step(PARAMS.gestationTicks - 1); // tick 50 — still gestating
    assert.equal(engine.entityCount, 2);
    const before = engine.events.lastSeq;
    engine.step(1); // tick 51 — birth
    assert.equal(engine.entityCount, 3, 'offspring born exactly at term');

    const born = engine.eventsSince(before).find((e) => e.type === 'entity.born');
    assert.ok(born, 'entity.born emitted');
    assert.deepEqual(born.parents, [a, b]);
    const child = engine.world.entities.get(born.entityId);
    assert.deepEqual(child.parents, [a, b]);
    assert.equal(child.lifeStage, 'juvenile');
    assert.equal(child.age, 0);
    assert.equal(child.bodyMass, PARAMS.birthMass);
    assert.equal(child.energy, 100 * PARAMS.offspringEnergyFraction);
    // Parent refs point at real entities (never removed ⇒ always valid).
    for (const parentId of child.parents) assert.ok(engine.world.entities.get(parentId));
    // Gestation cleared and the birth cost paid.
    const mother = engine.world.entities.get(a);
    assert.equal(mother.gestationUntil, null);
    assert.equal(mother.pendingMateId, null);
    assert.equal(mother.energy, 82 - PARAMS.birthEnergyCost);
  });

  test('the newborn is placed on a passable cell near the parent', () => {
    const engine = reproEngine();
    spawnPair(engine);
    engine.step(1 + PARAMS.gestationTicks);
    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(engine.world.isPassableAt(child.x, child.y), 'newborn on passable terrain');
    assert.ok(Math.hypot(child.x - 10, child.y - 10) <= PARAMS.birthOffset + 1e-9);
  });
});

describe('reproduction: demo integration', () => {
  test('the demo produces births with valid parentage, renewing the population', () => {
    const engine = createDemoSimulation({ seed: 42 });
    let births = 0;
    let firstBirth = null;
    for (let t = 0; t < 3000; t += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type === 'entity.born') {
          births += 1;
          firstBirth ??= e;
        }
      }
    }
    assert.ok(births > 0, 'expected births in the demo');
    assert.equal(firstBirth.parents.length, 2);
    // Every parent reference resolves to an accurate status (§1.4 C2). Before
    // Step 18 nothing was ever removed, so this was trivially "resolves to a
    // real entity"; now it has to tolerate the dead without going vacuous.
    for (const entity of engine.world.entities.all()) {
      for (const parentId of entity.parents) {
        const resolved = lookupLineage(engine.world, parentId);
        const present = engine.world.entities.get(parentId);
        assert.equal(
          present != null,
          resolved.status === LineageStatus.ALIVE || resolved.status === LineageStatus.CARCASS,
          `parent #${parentId} reported ${resolved.status} but ${present ? 'is' : 'is not'} in the world`,
        );
      }
    }
    // Population renewed beyond the founding cohort.
    assert.ok(engine.entityCount > engine.config.demo.founding.reduce((n, f) => n + f.count, 0));
  });

  test('reproduction keeps the demo deterministic', () => {
    const a = smallDemo({ seed: 42 });
    const b = smallDemo({ seed: 42 });
    a.step(1500);
    b.step(1500);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('inspection exposes parents and reproductive state', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1200);
    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(child, 'expected a born animal');
    const details = engine.getEntityDetails(child.id);
    assert.deepEqual(details.parents, child.parents);
    assert.ok('reproState' in details);
    assert.equal(typeof details.reproState.gestating, 'boolean');
  });
});
