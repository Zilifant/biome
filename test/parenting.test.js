import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { ParentingSystem } from '../src/simulation/systems/ParentingSystem.js';
import { ReproductionSystem } from '../src/simulation/systems/ReproductionSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { AgingSystem } from '../src/simulation/systems/AgingSystem.js';
import { recordLifeEvent, MAX_LIFE_EVENTS, LifeEventTypes } from '../src/simulation/systems/lifeEvents.js';
import { lookupLineage, LineageStatus } from '../src/simulation/world/lineage.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

const PARENTING = {
  weaningAge: 50,
  provisionRange: 2.0,
  provisionRate: 0.5,
  provisionEfficiency: 0.8,
  parentMinEnergyFraction: 0.35,
  juvenileMaxEnergyFraction: 0.85,
};

/** Open ground, no lakes or ridges, so distances are the only thing at play. */
function parentingEngine({ config = {}, ...params } = {}) {
  const engine = new SimulationEngine({
    seed: 1,
    config: { world: { width: 32, height: 32 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 }, ...config },
  });
  engine.registerSystem(new ParentingSystem({ ...PARENTING, ...params }));
  return engine;
}

function spawn(engine, definition) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: 'herbivore.grazer',
    heading: 0,
    maxEnergy: 100,
    maxHealth: 100,
    maxHydration: 100,
    ...definition,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** A guardian and its dependent juvenile, placed `gap` apart. */
function family(engine, { gap = 1, juvenile = {}, guardian = {} } = {}) {
  const guardianId = spawn(engine, { x: 10, y: 10, lifeStage: 'adult', bodyMass: 30, energy: 90, ...guardian });
  const juvenileId = spawn(engine, {
    x: 10 + gap,
    y: 10,
    lifeStage: 'juvenile',
    bodyMass: 5,
    age: 0,
    energy: 50,
    guardianId,
    weaned: false,
    ...juvenile,
  });
  return { guardianId, juvenileId };
}

describe('parenting: provisioning', () => {
  test('a guardian in range transfers energy to its unweaned juvenile, at a loss', () => {
    const engine = parentingEngine();
    const { guardianId, juvenileId } = family(engine, { gap: 1 });
    engine.step(1);
    const guardian = engine.world.entities.get(guardianId);
    const juvenile = engine.world.entities.get(juvenileId);
    assert.equal(guardian.energy, 90 - PARENTING.provisionRate, 'guardian paid the full draw');
    assert.equal(juvenile.energy, 50 + PARENTING.provisionRate * PARENTING.provisionEfficiency, 'juvenile got the lossy share');
  });

  test('an out-of-range juvenile is not provisioned', () => {
    const engine = parentingEngine();
    const { guardianId, juvenileId } = family(engine, { gap: 5 });
    engine.step(3);
    assert.equal(engine.world.entities.get(guardianId).energy, 90);
    assert.equal(engine.world.entities.get(juvenileId).energy, 50);
  });

  test('a guardian at its reserve floor stops provisioning rather than starving itself', () => {
    const engine = parentingEngine();
    const { guardianId, juvenileId } = family(engine, { gap: 1, guardian: { energy: 35 } });
    engine.step(5);
    assert.equal(engine.world.entities.get(guardianId).energy, 35, 'guardian kept its floor');
    assert.equal(engine.world.entities.get(juvenileId).energy, 50, 'nothing transferred');
  });

  test('a full juvenile costs its guardian nothing', () => {
    const engine = parentingEngine();
    const { guardianId, juvenileId } = family(engine, { gap: 1, juvenile: { energy: 90 } });
    engine.step(5);
    assert.equal(engine.world.entities.get(guardianId).energy, 90);
    assert.equal(engine.world.entities.get(juvenileId).energy, 90);
  });

  test('provisioning emits entity.provisioned naming both animals', () => {
    const engine = parentingEngine();
    const { guardianId, juvenileId } = family(engine, { gap: 1 });
    const before = engine.events.lastSeq;
    engine.step(1);
    const event = engine.eventsSince(before).find((e) => e.type === 'entity.provisioned');
    assert.ok(event, 'entity.provisioned emitted');
    assert.equal(event.entityId, juvenileId);
    assert.equal(event.guardianId, guardianId);
    assert.ok(event.amount > 0);
  });
});

describe('parenting: weaning, dispersal, and orphaning', () => {
  test('provisioning stops at the weaning age, and the juvenile keeps its parent', () => {
    const engine = parentingEngine();
    // Aging drives `age`, which is what weaning keys off.
    engine.registerSystem(new AgingSystem({ ...engine.config.aging, adultMass: 30 }));
    const { guardianId, juvenileId } = family(engine, { gap: 1 });
    const before = engine.events.lastSeq;
    engine.step(PARENTING.weaningAge + 5);
    const juvenile = engine.world.entities.get(juvenileId);
    assert.equal(juvenile.weaned, true, 'weaned');
    assert.equal(juvenile.guardianId, guardianId, 'still bonded after weaning');
    const weaned = engine.eventsSince(before).filter((e) => e.type === 'entity.lifeEvent' && e.event === 'weaned');
    assert.equal(weaned.length, 1, 'weaning is announced exactly once');
    // The guardian paid for exactly the ticks before weaning, and no more.
    const guardianEnergy = engine.world.entities.get(guardianId).energy;
    engine.step(20);
    assert.equal(engine.world.entities.get(guardianId).energy, guardianEnergy, 'no provisioning after weaning');
  });

  test('outgrowing the juvenile stage clears the bond (dispersal)', () => {
    const engine = parentingEngine();
    const { juvenileId } = family(engine, { gap: 1 });
    engine.step(1);
    assert.notEqual(engine.world.entities.get(juvenileId).guardianId, null);
    const before = engine.events.lastSeq;
    engine.world.entities.get(juvenileId).lifeStage = 'subadult';
    engine.step(1);
    const juvenile = engine.world.entities.get(juvenileId);
    assert.equal(juvenile.guardianId, null, 'dispersed');
    const dispersed = engine.eventsSince(before).find((e) => e.type === 'entity.lifeEvent' && e.event === 'dispersed');
    assert.ok(dispersed, 'dispersal announced');
    assert.ok(juvenile.lifeEvents.some((e) => e.type === LifeEventTypes.DISPERSED), 'recorded in the life history');
  });

  test('a juvenile whose guardian dies is orphaned, and may then feed itself', () => {
    const engine = parentingEngine();
    const { guardianId, juvenileId } = family(engine, { gap: 1 });
    engine.step(1);
    const guardian = engine.world.entities.get(guardianId);
    guardian.alive = false;
    guardian.kind = 'carcass';
    const before = engine.events.lastSeq;
    engine.step(1);
    const juvenile = engine.world.entities.get(juvenileId);
    assert.equal(juvenile.guardianId, null, 'bond cleared');
    assert.equal(juvenile.weaned, true, 'an orphan is on its own and may graze');
    const orphaned = engine.eventsSince(before).find((e) => e.type === 'entity.lifeEvent' && e.event === 'orphaned');
    assert.ok(orphaned, 'orphaning announced');
    assert.equal(orphaned.guardianId, guardianId);
  });
});

describe('parenting: dependent juveniles follow and do not graze', () => {
  /** Perception + decision + movement + feeding + parenting on open ground. */
  function followEngine() {
    const engine = new SimulationEngine({
      seed: 5,
      config: { world: { width: 40, height: 40 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 } },
    });
    engine.registerSystem(new PerceptionSystem({ defaultRadius: 8, foodMinLevel: 1 }));
    engine.registerSystem(new DecisionSystem({ ...engine.config.decision, foodMinLevel: 1 }));
    engine.registerSystem(new MovementSystem());
    engine.registerSystem(new FeedingSystem(engine.config.feeding));
    engine.registerSystem(new ParentingSystem(PARENTING));
    return engine;
  }

  test('a juvenile that has drifted from its guardian chooses followParent and closes the gap', () => {
    const engine = followEngine();
    const guardianId = spawn(engine, { x: 20, y: 20, lifeStage: 'adult', bodyMass: 30, energy: 90, speed: 0 });
    const juvenileId = spawn(engine, {
      x: 25, y: 20, lifeStage: 'juvenile', bodyMass: 5, energy: 50, speed: 1.2, guardianId, weaned: false,
    });
    engine.step(1);
    const juvenile = engine.world.entities.get(juvenileId);
    assert.equal(juvenile.action, 'followParent', 'a drifted dependent goes after its parent');
    const before = Math.hypot(juvenile.x - 20, juvenile.y - 20);
    engine.step(2);
    const after = Math.hypot(juvenile.x - 20, juvenile.y - 20);
    assert.ok(after < before, `closed the gap (${before.toFixed(2)} → ${after.toFixed(2)})`);
  });

  test('a nursing juvenile never grazes; after weaning it does', () => {
    const engine = followEngine();
    const guardianId = spawn(engine, { x: 20, y: 20, lifeStage: 'adult', bodyMass: 30, energy: 90, speed: 0 });
    const juvenileId = spawn(engine, {
      x: 20, y: 20, lifeStage: 'juvenile', bodyMass: 5, energy: 10, speed: 0, guardianId, weaned: false,
    });
    // Grow real food under both animals so grazing is genuinely available.
    for (let i = 0; i < 30; i += 1) engine.world.vegetation.grow({ growthRate: 0.3, seedFloor: 0.2 });
    const biomassBefore = engine.world.vegetation.biomassAt(20, 20);

    engine.step(5);
    const nursing = engine.world.entities.get(juvenileId);
    assert.notEqual(nursing.action, 'eat', 'a nursing juvenile does not choose to eat');
    assert.equal(engine.world.vegetation.biomassAt(20, 20), biomassBefore, 'and removes no biomass');

    // Wean it, and the same animal on the same cell now feeds itself.
    nursing.weaned = true;
    engine.step(3);
    assert.ok(engine.world.vegetation.biomassAt(20, 20) < biomassBefore, 'a weaned juvenile grazes');
  });
});

describe('parenting: life history', () => {
  test('the life-event log is bounded and drops the oldest entries first', () => {
    const entity = { lifeEvents: [] };
    for (let i = 0; i < MAX_LIFE_EVENTS + 5; i += 1) recordLifeEvent(entity, i, 'birthed', { entityId: i });
    assert.equal(entity.lifeEvents.length, MAX_LIFE_EVENTS, 'hard cap holds');
    assert.equal(entity.lifeEvents[0].tick, 5, 'oldest entries fell off');
    assert.equal(entity.lifeEvents.at(-1).tick, MAX_LIFE_EVENTS + 4);
  });

  test('death closes the life history with its cause', () => {
    const engine = parentingEngine();
    const aging = { ...engine.config.aging, adultMass: 30 };
    engine.registerSystem(new AgingSystem(aging));
    // One tick short of the age at which death is certain.
    const id = spawn(engine, { x: 5, y: 5, bodyMass: 30, age: aging.maxAge - 1, energy: 50 });
    engine.step(1);
    const entity = engine.world.entities.get(id);
    assert.equal(entity.alive, false);
    const died = entity.lifeEvents.at(-1);
    assert.equal(died.type, LifeEventTypes.DIED);
    assert.equal(died.cause, 'age');
  });

  test('a newborn records "born" and both parents record "birthed" plus the offspring id', () => {
    // ⚠ Per-species from Step 29: reproduction params must reach the *config*
    // so the species registry resolves with them — a species' own block beats
    // anything the system was constructed with.
    const reproduction = {
      gestationTicks: 2,
      minEnergyFraction: 0.7,
      // Mate choice off — this test is about the life-history record a birth
      // writes, not about who was willing to breed with whom.
      acceptanceThreshold: 0,
    };
    const engine = parentingEngine({ config: { reproduction } });
    engine.registerSystem(
      new ReproductionSystem({ ...engine.config.reproduction, ...reproduction, birthMass: 5 }),
    );
    const a = spawn(engine, { x: 10, y: 10, lifeStage: 'adult', sex: 'female', bodyMass: 30, energy: 95 });
    const b = spawn(engine, { x: 11, y: 10, lifeStage: 'adult', sex: 'male', bodyMass: 30, energy: 95 });
    engine.step(4);

    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(child, 'a child was born');
    assert.equal(child.guardianId, a, 'bonded to the parent that carried it');
    assert.equal(child.weaned, false, 'newborns start unweaned');
    assert.deepEqual(child.lifeEvents[0].type, LifeEventTypes.BORN);
    for (const parentId of [a, b]) {
      const parent = engine.world.entities.get(parentId);
      assert.ok(parent.offspring.includes(child.id), `parent #${parentId} records the offspring`);
      assert.ok(parent.lifeEvents.some((e) => e.type === LifeEventTypes.BIRTHED && e.entityId === child.id));
    }
  });
});

describe('parenting: protocol, persistence, and the demo', () => {
  test('family and life history are inspection-only, never in bulk snapshots', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(5);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      for (const field of ['offspring', 'guardianId', 'weaned', 'lifeEvents', 'parentingState']) {
        assert.ok(!(field in entity), `${field} must not leak into bulk snapshots`);
      }
    }
    for (const field of ['offspring', 'guardianId', 'weaned', 'lifeEvents']) {
      assert.ok(!PUBLIC_ENTITY_FIELDS.includes(field));
    }
    const details = engine.getEntityDetails([...engine.world.entities.all()][0].id);
    assert.ok(Array.isArray(details.offspring));
    assert.ok(Array.isArray(details.lifeEvents));
    assert.equal(typeof details.parentingState.dependent, 'boolean');
  });

  test('inspection detail is a copy — mutating it cannot reach engine state', () => {
    const engine = parentingEngine();
    const { juvenileId } = family(engine, { gap: 1 });
    engine.step(1);
    const details = engine.getEntityDetails(juvenileId);
    details.lifeEvents.push({ tick: 999, type: 'forged' });
    details.offspring.push(4242);
    const entity = engine.world.entities.get(juvenileId);
    assert.ok(!entity.lifeEvents.some((e) => e.type === 'forged'));
    assert.ok(!entity.offspring.includes(4242));
  });

  test('the demo raises juveniles end to end: born → provisioned → weaned → dispersed', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const seen = { born: 0, provisioned: 0, weaned: 0, dispersed: 0 };
    for (let t = 0; t < 6000; t += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.born') seen.born += 1;
        if (event.type === 'entity.provisioned') seen.provisioned += 1;
        if (event.type === 'entity.lifeEvent' && event.event in seen) seen[event.event] += 1;
      }
    }
    assert.ok(seen.born > 0, 'the demo produced births');
    assert.ok(seen.provisioned > 0, 'juveniles were provisioned by their parents');
    assert.ok(seen.weaned > 0, 'juveniles were weaned');
    assert.ok(seen.dispersed > 0, 'juveniles dispersed at maturity');

    // Relationship references (§1.4 C2). Since Step 18 carcasses are removed,
    // so a parent id may point at something gone — but the *reported* status
    // must always be accurate. Asserting "everything resolves" here would pass
    // vacuously once the population turns over, so assert the resolution
    // instead: never claim alive for something missing, or forgotten for
    // something present.
    for (const entity of engine.world.entities.all()) {
      for (const id of [...entity.parents, ...entity.offspring]) {
        const resolved = lookupLineage(engine.world, id);
        const present = engine.world.entities.get(id);
        if (present) {
          assert.equal(
            resolved.status,
            present.alive ? LineageStatus.ALIVE : LineageStatus.CARCASS,
            `#${id} is in the world but reported ${resolved.status}`,
          );
        } else {
          assert.ok(
            resolved.status === LineageStatus.DEAD || resolved.status === LineageStatus.FORGOTTEN,
            `#${id} is gone but reported ${resolved.status}`,
          );
        }
      }
      // A guardian bond is different: the parenting system clears it the tick
      // after the guardian dies, so a *live* bond must point at a live animal.
      if (entity.guardianId !== null && entity.alive) {
        const guardian = engine.world.entities.get(entity.guardianId);
        assert.ok(guardian && guardian.alive, `#${entity.id} still bonded to a missing guardian`);
      }
      assert.ok(entity.lifeEvents.length <= MAX_LIFE_EVENTS, 'life history stays bounded');
    }
  });

  test('founding animals never spawn on impassable terrain (§1.4 C1)', () => {
    for (const seed of [1, 7, 42, 99]) {
      const engine = createDemoSimulation({ seed });
      for (const entity of engine.world.entities.all()) {
        assert.ok(engine.world.isPassableAt(entity.x, entity.y), `seed ${seed}: #${entity.id} spawned on impassable terrain`);
      }
    }
  });

  test('parenting keeps the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });
});
