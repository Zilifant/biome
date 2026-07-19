import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom } from '../src/simulation/random/SeededRandom.js';
import { sampleTraits, TRAIT_NAMES, NEUTRAL_TRAITS } from '../src/simulation/traits/traits.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import { AgingSystem } from '../src/simulation/systems/AgingSystem.js';
import { ReproductionSystem } from '../src/simulation/systems/ReproductionSystem.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

const GRAZER = getSpecies('herbivore.grazer');

/** Traits equal to the species average except for the named overrides. */
function traits(overrides = {}) {
  return { ...NEUTRAL_TRAITS, ...overrides };
}

/** Bare open ground, so a hand-placed food patch is the only food anywhere. */
function sandbox({ seed = 3, size = 44, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: size, height: size }, terrain: { lakes: 0, ridges: 0, coverPatchDensity: 0 } },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

/** Strip every cell's biomass except one patch, so "food" is a known place. */
function isolateFoodPatch(engine, patchX, patchY) {
  for (let cellY = 0; cellY < engine.world.terrain.height; cellY += 1) {
    for (let cellX = 0; cellX < engine.world.terrain.width; cellX += 1) {
      if (cellX !== patchX || cellY !== patchY) engine.world.vegetation.consumeAt(cellX, cellY, Number.MAX_SAFE_INTEGER);
    }
  }
  return engine.world.vegetation.biomassAt(patchX, patchY);
}

function spawnIndividual(engine, { x, y, individual = {}, ...overrides }) {
  const t = traits(individual);
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: GRAZER.id,
    x,
    y,
    heading: 0,
    lifeStage: 'adult',
    traits: t,
    adultMass: GRAZER.bodyMass * t.size,
    bodyMass: GRAZER.bodyMass * t.size,
    speed: GRAZER.baseSpeed * t.speed,
    maxEnergy: GRAZER.maxEnergy,
    energy: GRAZER.maxEnergy,
    maxHealth: GRAZER.maxHealth,
    maxHydration: GRAZER.maxHydration,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('traits: sampling', () => {
  test('every named trait is sampled, centred on the species average', () => {
    const spread = Object.fromEntries(TRAIT_NAMES.map((name) => [name, 0.2]));
    const random = new SeededRandom(11);
    const samples = Array.from({ length: 400 }, () => sampleTraits(random, spread));
    for (const name of TRAIT_NAMES) {
      const values = samples.map((s) => s[name]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      assert.ok(Math.abs(mean - 1) < 0.03, `${name} mean ${mean} should sit near 1`);
      assert.ok(Math.min(...values) >= 1 - 0.2, `${name} stays within the spread`);
      assert.ok(Math.max(...values) <= 1 + 0.2, `${name} stays within the spread`);
      // Actually varies — a trait that never moves would be decoration.
      assert.ok(Math.max(...values) - Math.min(...values) > 0.15, `${name} varies`);
    }
  });

  test('sampling is deterministic for a seed, and zero spread means no variation', () => {
    const spread = Object.fromEntries(TRAIT_NAMES.map((name) => [name, 0.25]));
    assert.deepEqual(sampleTraits(new SeededRandom(7), spread), sampleTraits(new SeededRandom(7), spread));
    assert.deepEqual(sampleTraits(new SeededRandom(7), {}), NEUTRAL_TRAITS);
  });

  test('the draw budget is fixed, so trait sampling never shifts its own stream', () => {
    const wide = Object.fromEntries(TRAIT_NAMES.map((name) => [name, 0.5]));
    const a = new SeededRandom(5);
    const b = new SeededRandom(5);
    sampleTraits(a, wide);
    sampleTraits(b, {}); // different values, same number of draws
    assert.equal(a.getState(), b.getState());
  });

  test('an entity created without traits is exactly average', () => {
    const engine = sandbox();
    const id = engine.world.entities.queueSpawn({ kind: 'animal', speciesId: GRAZER.id, x: 5, y: 5 });
    engine.applyDeferredEntityChanges(0);
    const entity = engine.world.entities.get(id);
    assert.deepEqual(entity.traits, NEUTRAL_TRAITS);
    assert.equal(entity.adultMass, null, 'falls back to the species mean in the aging system');
    assert.throws(() => {
      entity.traits.speed = 2;
    }, 'the shared neutral set is frozen');
  });
});

describe('traits: demonstration scenario — the faster individual reaches food first', () => {
  /** Two animals equidistant from one food patch, differing only in speed. */
  function race(seed) {
    const engine = sandbox({
      seed,
      systems: [
        new PerceptionSystem(new SimulationEngine().config.perception),
        new DecisionSystem({ ...new SimulationEngine().config.decision, foodMinLevel: 1 }),
        new MovementSystem(),
        new FeedingSystem(new SimulationEngine().config.feeding),
      ],
    });
    const patch = { x: 22, y: 22 };
    const biomass = isolateFoodPatch(engine, patch.x, patch.y);
    assert.ok(biomass > 0, 'the patch has food');
    // Placed inside the species' perception radius so both actually see the
    // patch, equidistant from it, and hungry enough to go straight for it.
    const swift = spawnIndividual(engine, { x: 17.5, y: 22.5, energy: 8, individual: { speed: 1.3 } });
    const slow = spawnIndividual(engine, { x: 27.5, y: 22.5, energy: 8, individual: { speed: 0.7 } });
    return { engine, swift, slow, patch };
  }

  test('the swifter animal arrives and eats before the slower one', () => {
    const { engine, swift, slow, patch } = race(3);
    assert.ok(
      engine.world.entities.get(swift).speed > engine.world.entities.get(slow).speed,
      'the speed trait resolved into a real speed difference',
    );

    let swiftAte = null;
    let slowAte = null;
    // Closest approach, sampled as they go: once the patch is grazed bare there
    // is no food left anywhere and both animals wander off again, so where they
    // end up says nothing about whether they went for it.
    const closest = { [swift]: Infinity, [slow]: Infinity };
    for (let tick = 1; tick <= 60 && (swiftAte === null || slowAte === null); tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const id of [swift, slow]) {
        const entity = engine.world.entities.get(id);
        closest[id] = Math.min(closest[id], Math.hypot(entity.x - (patch.x + 0.5), entity.y - (patch.y + 0.5)));
      }
      for (const event of engine.eventsSince(before)) {
        if (event.type !== 'entity.fed') continue;
        if (event.entityId === swift) swiftAte ??= tick;
        if (event.entityId === slow) slowAte ??= tick;
      }
    }
    assert.ok(swiftAte !== null, 'the swift animal reached the patch and fed');
    assert.ok(slowAte === null || swiftAte < slowAte, `swift fed at t${swiftAte}, slow at t${slowAte}`);

    // Both genuinely headed for the patch — the swifter one simply got there
    // first, which is the whole point of the trait.
    for (const id of [swift, slow]) {
      assert.ok(closest[id] < 5, `#${id} closed on the patch (closest ${closest[id].toFixed(1)})`);
    }
  });

  test('the race outcome is deterministic', () => {
    const first = race(3);
    const second = race(3);
    first.engine.step(40);
    second.engine.step(40);
    assert.deepEqual(captureSimulationState(first.engine).entities, captureSimulationState(second.engine).entities);
  });
});

describe('traits: physiological consequences', () => {
  test('a metabolically efficient individual keeps more energy for the same life', () => {
    const engine = sandbox({ systems: [new MetabolismSystem(new SimulationEngine().config.metabolism)] });
    const efficient = spawnIndividual(engine, { x: 10, y: 10, individual: { metabolicEfficiency: 1.25 } });
    const wasteful = spawnIndividual(engine, { x: 12, y: 10, individual: { metabolicEfficiency: 0.75 } });
    engine.step(300);
    const a = engine.world.entities.get(efficient).energy;
    const b = engine.world.entities.get(wasteful).energy;
    assert.ok(a > b, `efficient kept ${a.toFixed(2)}, wasteful ${b.toFixed(2)}`);
  });

  test('a larger individual grows to a bigger adult and pays more to run', () => {
    const config = new SimulationEngine().config;
    const engine = sandbox({
      systems: [new AgingSystem({ ...config.aging, adultMass: GRAZER.bodyMass }), new MetabolismSystem(config.metabolism)],
    });
    const big = spawnIndividual(engine, { x: 10, y: 10, individual: { size: 1.3 }, bodyMass: config.aging.birthMass, age: 0 });
    const small = spawnIndividual(engine, { x: 12, y: 10, individual: { size: 0.7 }, bodyMass: config.aging.birthMass, age: 0 });
    engine.step(config.aging.maturityAge);
    const bigger = engine.world.entities.get(big);
    const smaller = engine.world.entities.get(small);
    assert.ok(bigger.bodyMass > smaller.bodyMass, 'grew to different adult sizes');
    assert.ok(Math.abs(bigger.bodyMass - GRAZER.bodyMass * 1.3) < 1e-6, 'reached its own adult mass, not the species mean');
    assert.ok(bigger.energy < smaller.energy, 'and the bigger animal burned more energy getting there');
  });
});

describe('traits: behavioural consequences', () => {
  function decisionOnly(individual, energy) {
    const config = new SimulationEngine().config;
    const engine = sandbox({
      systems: [
        new PerceptionSystem({ defaultRadius: 8, foodMinLevel: 1 }),
        new DecisionSystem({ ...config.decision, foodMinLevel: 1 }),
      ],
    });
    const id = spawnIndividual(engine, { x: 22, y: 22, energy, individual });
    engine.step(1);
    return engine.world.entities.get(id);
  }

  test('a bold individual prefers covering ground; a timid one prefers resting', () => {
    const bold = decisionOnly({ boldness: 1.3 }, GRAZER.maxEnergy);
    const timid = decisionOnly({ boldness: 0.7 }, GRAZER.maxEnergy);
    assert.ok(bold.utilityBreakdown.wander > timid.utilityBreakdown.wander, 'bolder animals value roaming more');
    assert.ok(bold.utilityBreakdown.rest < timid.utilityBreakdown.rest, 'and value sitting still less');
  });

  test('a cautious individual acts on the same hunger sooner', () => {
    const half = GRAZER.maxEnergy * 0.5;
    const cautious = decisionOnly({ caution: 1.3 }, half);
    const carefree = decisionOnly({ caution: 0.7 }, half);
    const hungerDrive = (entity) => Math.max(entity.utilityBreakdown.eat, entity.utilityBreakdown.seekFood);
    assert.ok(hungerDrive(cautious) > hungerDrive(carefree), 'the same hunger weighs more heavily on a cautious animal');
  });

  test('trait multipliers of 1.0 reproduce the pre-trait behaviour exactly', () => {
    const config = new SimulationEngine().config;
    const neutral = decisionOnly({}, GRAZER.maxEnergy * 0.5);
    assert.equal(neutral.utilityBreakdown.wander, config.decision.wanderBias);
    // Standing on open ground vegetation at half energy: eatBias + hunger×1.
    const expectedEat = config.decision.eatBias + config.decision.hungerWeight * 0.5;
    assert.ok(Math.abs(neutral.utilityBreakdown.eat - expectedEat) < 1e-9, `eat ${neutral.utilityBreakdown.eat} vs ${expectedEat}`);
  });
});

describe('traits: reproductive investment', () => {
  function birthWith(investment) {
    const config = new SimulationEngine().config;
    const engine = sandbox({
      systems: [new ReproductionSystem({ ...config.reproduction, gestationTicks: 2, birthMass: config.aging.birthMass })],
    });
    const parentEnergy = GRAZER.maxEnergy;
    const mother = spawnIndividual(engine, { x: 20, y: 20, energy: parentEnergy, individual: { reproductiveInvestment: investment } });
    spawnIndividual(engine, { x: 21, y: 20, energy: parentEnergy, individual: { reproductiveInvestment: investment } });
    engine.step(4);
    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(child, 'a child was born');
    return { child, mother: engine.world.entities.get(mother) };
  }

  test('a heavily investing parent produces a better-stocked newborn, and pays for it', () => {
    const generous = birthWith(1.3);
    const frugal = birthWith(0.7);
    assert.ok(generous.child.energy > frugal.child.energy, 'the newborn starts with more');
    assert.ok(generous.mother.energy < frugal.mother.energy, 'and the parent has less left');
  });

  test('a newborn draws its own traits rather than copying its parent', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(6000);
    const born = [...engine.world.entities.all()].filter((e) => e.parents.length > 0);
    assert.ok(born.length > 1, 'the demo produced offspring');
    for (const child of born) {
      for (const name of TRAIT_NAMES) assert.equal(typeof child.traits[name], 'number');
      assert.ok(child.adultMass > 0, 'each has its own adult size');
    }
    // Inheritance is Step 20; for now offspring vary independently of parents.
    const distinct = new Set(born.map((e) => e.traits.size.toFixed(6)));
    assert.ok(distinct.size > 1, 'offspring are not clones of one another');
  });
});

describe('traits: protocol, persistence, and determinism', () => {
  test('traits are inspection-only and never leak into bulk snapshots', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(5);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.ok(!('traits' in entity) && !('adultMass' in entity), 'traits must not ride in bulk snapshots');
    }
    assert.ok(!PUBLIC_ENTITY_FIELDS.includes('traits'));
    const id = [...engine.world.entities.all()][0].id;
    const details = engine.getEntityDetails(id);
    for (const name of TRAIT_NAMES) assert.equal(typeof details.traits[name], 'number');
    assert.ok(details.adultMass > 0);
  });

  test('inspection returns a copy — mutating it cannot reach engine state', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const id = [...engine.world.entities.all()][0].id;
    const before = engine.world.entities.get(id).traits.speed;
    engine.getEntityDetails(id).traits.speed = 99;
    assert.equal(engine.world.entities.get(id).traits.speed, before);
  });

  test('traits survive save/load and the restored run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1500);
    const saved = captureSimulationState(engine);
    const traitsBefore = [...engine.world.entities.all()].map((e) => ({ id: e.id, traits: e.traits, adultMass: e.adultMass }));

    const restored = restoreDemoSimulation(saved);
    const traitsAfter = [...restored.world.entities.all()].map((e) => ({ id: e.id, traits: e.traits, adultMass: e.adultMass }));
    assert.deepEqual(traitsAfter, traitsBefore, 'traits round-trip exactly');

    engine.step(500);
    restored.step(500);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('individual variation keeps the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('the trait stream is independent: draining another stream changes nothing', () => {
    const a = createDemoSimulation({ seed: 55 });
    const b = createDemoSimulation({ seed: 55 });
    const scratch = b.randomStream('unrelated');
    for (let i = 0; i < 50; i += 1) scratch.next();
    a.step(300);
    b.step(300);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
