/**
 * Kill caching (phase T3 of TREES-FLIGHT-VULTURE-PLAN.md) — the half of vertical
 * refuge that does measurable work.
 *
 * A leopard that has killed on a comfortable stomach drags the body to the
 * nearest tree and hoists it, where only a climber can reach it. This closes the
 * limitation `predatorLeopard.js` has stated since phase 14: *"this leopard
 * cannot protect a kill from the hyena clan."*
 *
 * ⚠ `cache` is the **one new action** in this plan, and the bar DOCS §9 Decision
 * sets is that a new movement behaviour competes with foraging and foraging must
 * win. What it competes with is `eat`, for one animal, on the carcass it is
 * already standing on — so the tests below pin the *crossover*: hungry eats,
 * comfortable caches. That is the property that keeps it from being a way to
 * starve, and it needs no threshold.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { CANOPY, GROUND } from '../src/simulation/locomotion/climbing.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const LEOPARD = getSpecies('predator.leopard');
const HYENA = getSpecies('scavenger.hyena');

function sandbox({ seed = 5, config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 48, height: 48 }, terrain: { ...FLAT_TERRAIN }, ...config },
  });
  engine.registerSystem(new PerceptionSystem({ ...engine.config.perception }));
  engine.registerSystem(
    new DecisionSystem({
      ...engine.config.decision,
      ...engine.config.behavior,
      carcassRange: engine.config.feeding.carcassRange,
      drinkRange: engine.config.hydration.drinkRange,
      caching: engine.config.climbing.enabled && engine.config.climbing.caching,
      ...(config.decisionOptions ?? {}),
    }),
  );
  engine.registerSystem(
    new MovementSystem({
      ...engine.config.locomotion,
      climbing: engine.config.climbing.enabled,
      cacheHaulReach: engine.config.feeding.carcassRange,
    }),
  );
  return engine;
}

/** A strip of trees down x = 14, so a hauler always has somewhere to go. */
function plantTrees(engine, cellX) {
  const terrain = engine.world.terrain;
  const real = terrain.codeAt.bind(terrain);
  terrain.codeAt = (x, y) => (x === cellX ? TerrainType.TREE : real(x, y));
}

function spawnAnimal(engine, species, { x, y, energyFraction = 0.9 }) {
  const g = Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: species.id,
    x,
    y,
    heading: 0,
    lifeStage: 'adult',
    age: 3000,
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
  });
  engine.applyDeferredEntityChanges(0);
  return engine.world.entities.get(id);
}

function spawnCarcass(engine, { x, y, edibleMass = 40 }) {
  const id = engine.world.entities.queueSpawn({
    kind: 'carcass',
    speciesId: 'herbivore.gazelle',
    x,
    y,
    edibleMass,
    decayStage: 0,
    diedTick: 0,
    alive: false,
  });
  engine.applyDeferredEntityChanges(0);
  return engine.world.entities.get(id);
}

describe('caching: when a leopard chooses it', () => {
  test('a comfortable cat caches, and a starving one eats — the crossover, not a threshold', () => {
    const results = [];
    for (const energyFraction of [0.9, 0.1]) {
      const engine = sandbox();
      plantTrees(engine, 14);
      const cat = spawnAnimal(engine, LEOPARD, { x: 10.5, y: 10.5, energyFraction });
      spawnCarcass(engine, { x: 10.5, y: 10.5 });
      engine.step(1);
      results.push(cat.action);
    }
    assert.equal(results[0], 'cache', 'a fed leopard secures the kill first');
    assert.equal(results[1], 'eat', '⚠ a starving one eats where it stands — this is what stops it starving');
  });

  test('nothing caches without a tree in reach', () => {
    const engine = sandbox(); // no trees at all
    const cat = spawnAnimal(engine, LEOPARD, { x: 10.5, y: 10.5 });
    spawnCarcass(engine, { x: 10.5, y: 10.5 });
    engine.step(1);
    assert.notEqual(cat.action, 'cache');
  });

  test('and a species that cannot climb never does, however fed it is', () => {
    const engine = sandbox();
    plantTrees(engine, 14);
    const hyena = spawnAnimal(engine, HYENA, { x: 10.5, y: 10.5 });
    spawnCarcass(engine, { x: 10.5, y: 10.5 });
    engine.step(1);
    assert.notEqual(hyena.action, 'cache', 'a hyena has nowhere to put it');
  });

  test('⚠ the world-level switch turns it off — the species block cannot', () => {
    // ⚠⚠ The reason this switch exists at all: `cacheWeight` lives in the
    // leopard's `behavior` **block**, and a species block beats the config
    // (DOCS §8), so `config.behavior.cacheWeight = 0` would be overridden by the
    // leopard's own 1.2 and the "off" arm would measure the mechanism against
    // itself. That trap was nearly shipped here — the mechanism was firing in
    // the demo before anyone checked it could be switched off.
    const engine = sandbox({ config: { climbing: { enabled: true, caching: false } } });
    plantTrees(engine, 14);
    const cat = spawnAnimal(engine, LEOPARD, { x: 10.5, y: 10.5 });
    spawnCarcass(engine, { x: 10.5, y: 10.5 });
    engine.step(1);
    assert.notEqual(cat.action, 'cache');
  });
});

describe('caching: hauling and hoisting', () => {
  test('the body travels with the hauler and ends up in the canopy', () => {
    const engine = sandbox();
    plantTrees(engine, 14);
    const cat = spawnAnimal(engine, LEOPARD, { x: 10.5, y: 10.5 });
    const carcass = spawnCarcass(engine, { x: 10.5, y: 10.5 });
    const startX = carcass.x;

    let hauledTicks = 0;
    for (let t = 0; t < 40 && carcass.elevation !== CANOPY; t += 1) {
      engine.step(1);
      if (cat.action === 'cache') hauledTicks += 1;
    }
    assert.ok(hauledTicks > 0, 'it spent ticks hauling');
    assert.ok(carcass.x > startX, 'the carcass moved with it');
    assert.equal(carcass.elevation, CANOPY, 'and was hoisted on arrival');
    assert.equal(cat.elevation, GROUND, '⚠ the hauler stays below — an animal aloft cannot step');
    // The carcass tracks the hauler, so they end up in the same cell.
    assert.ok(Math.hypot(carcass.x - cat.x, carcass.y - cat.y) <= engine.config.feeding.carcassRange);
  });

  test('the spatial index follows the body, or nothing could find it again', () => {
    // ⚠ Carcasses had never moved before this phase. A body dragged behind the
    // index would be invisible to every scavenging query — which is exactly what
    // looks up carcasses — so the haul goes through `world.moveEntity`.
    const engine = sandbox();
    plantTrees(engine, 14);
    const cat = spawnAnimal(engine, LEOPARD, { x: 10.5, y: 10.5 });
    const carcass = spawnCarcass(engine, { x: 10.5, y: 10.5 });
    for (let t = 0; t < 10; t += 1) engine.step(1);
    const found = [...engine.world.grid.queryRadius(carcass.x, carcass.y, 1)];
    assert.ok(found.includes(carcass.id), 'the grid knows where the body is now');
    assert.ok(cat.x !== 10.5, 'and the hauler has moved');
  });

  test('once cached, the leopard can still eat it and a hyena cannot', () => {
    const engine = sandbox();
    plantTrees(engine, 14);
    const cat = spawnAnimal(engine, LEOPARD, { x: 10.5, y: 10.5 });
    const carcass = spawnCarcass(engine, { x: 10.5, y: 10.5 });
    for (let t = 0; t < 40 && carcass.elevation !== CANOPY; t += 1) engine.step(1);
    assert.equal(carcass.elevation, CANOPY, 'precondition: it got cached');

    const hyena = spawnAnimal(engine, HYENA, { x: carcass.x, y: carcass.y, energyFraction: 0.2 });
    engine.step(1);
    assert.notEqual(hyena.action, 'eat', '⚠ the clan cannot reach it — the whole point of the phase');
    // And the cat, once hungry, still can: `reachesCarcass` asks what it *can*
    // do, not where it currently is.
    cat.energy = cat.maxEnergy * 0.1;
    engine.step(1);
    assert.equal(cat.action, 'eat', 'the climber feeds on its own cache');
  });
});
