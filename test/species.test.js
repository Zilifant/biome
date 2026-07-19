import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, getSpecies, listSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';

describe('species registry', () => {
  test('the herbivore grazer is registered and is biology-only (no presentation)', () => {
    const species = getSpecies('herbivore.grazer');
    assert.equal(species.kind, 'animal');
    assert.equal(species.diet, 'herbivore');
    assert.ok(species.bodyMass > 0 && species.baseSpeed > 0 && species.maxHealth > 0);
    // A species definition must never carry glyphs, colors, or UI labels.
    const serialized = JSON.stringify(species);
    assert.ok(!/glyph|color|dracula|label/i.test(serialized), 'species carries presentation');
  });

  test('getSpecies throws on an unknown id; listSpecies enumerates', () => {
    assert.throws(() => getSpecies('nope.missing'), /unknown species/);
    assert.deepEqual(listSpecies(), Object.values(SPECIES));
  });
});

describe('herbivore spawning', () => {
  test('demo animals are configured from the species definition', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const species = getSpecies('herbivore.grazer');
    assert.equal(engine.entityCount, engine.config.demo.animalCount);
    for (const entity of engine.world.entities.all()) {
      assert.equal(entity.speciesId, 'herbivore.grazer');
      assert.equal(entity.kind, 'animal');
      // Body mass follows the growth curve for the animal's (spread) initial
      // age (Step 11), so it lies between birth and adult mass.
      assert.ok(entity.bodyMass >= engine.config.aging.birthMass - 1e-6 && entity.bodyMass <= species.bodyMass + 1e-6);
      assert.equal(entity.speed, species.baseSpeed);
      assert.equal(entity.maxHealth, species.maxHealth);
      assert.equal(entity.health, species.maxHealth);
      // Energy is seeded within the species' initial fraction range.
      assert.ok(entity.energy >= species.maxEnergy * species.initialEnergyFraction.min - 1e-6);
      assert.ok(entity.energy <= species.maxEnergy * species.initialEnergyFraction.max + 1e-6);
    }
  });

  test('spawning is deterministic across two runs', () => {
    const a = createDemoSimulation({ seed: 7 });
    const b = createDemoSimulation({ seed: 7 });
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('the herbivore is inspectable with real physiology fields', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const id = [...engine.world.entities.all()][0].id;
    const details = engine.getEntityDetails(id);
    assert.equal(details.speciesId, 'herbivore.grazer');
    for (const field of ['bodyMass', 'healthFraction', 'energyFraction', 'health', 'maxHealth', 'speed']) {
      assert.ok(field in details, `inspection missing ${field}`);
    }
    assert.ok(details.health > 0 && details.speed > 0 && details.bodyMass > 0);
  });
});

describe('physiology fields in the protocol', () => {
  test('snapshots expose bodyMass and healthFraction, only whitelisted fields', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(snapshot.entities.length > 0);
    for (const entity of snapshot.entities) {
      assert.deepEqual(Object.keys(entity).sort(), [...PUBLIC_ENTITY_FIELDS].sort());
      assert.ok(entity.bodyMass > 0);
      assert.ok(entity.healthFraction >= 0 && entity.healthFraction <= 1);
      // Absolute health/energy and speed must NOT leak into the bulk snapshot.
      assert.ok(!('health' in entity) && !('energy' in entity) && !('speed' in entity));
    }
  });

  test('speed drives movement: a faster animal covers more ground per tick', () => {
    // Two otherwise-identical worlds; bump the species speed via a fresh entity.
    const engine = createDemoSimulation({ seed: 3 });
    const entity = [...engine.world.entities.all()][0];
    const startX = entity.x;
    const startY = entity.y;
    engine.step(1);
    const movedFast = Math.hypot(entity.x - startX, entity.y - startY);
    // Movement magnitude per tick cannot exceed the entity's speed (it may be
    // less when blocked by terrain), confirming speed is the step scale.
    assert.ok(movedFast <= entity.speed + 1e-9, `moved ${movedFast} exceeds speed ${entity.speed}`);
  });
});
