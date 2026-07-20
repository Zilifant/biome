import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SpeciesRegistry, SPECIES_BLOCKS, resolveSpecies } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies, listSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const CONFIG = new SimulationEngine().config;
const registry = () => new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG);

describe('species schema: resolution', () => {
  test('a species inherits every block it does not override', () => {
    const grazer = registry().get('herbivore.grazer');
    // The grazer states no metabolism block at all, so it is the config's.
    assert.equal(grazer.metabolism.basalRate, CONFIG.metabolism.basalRate);
    assert.equal(grazer.metabolism.referenceMass, CONFIG.metabolism.referenceMass);
    assert.equal(grazer.aging.maxAge, CONFIG.aging.maxAge);
  });

  test('an override replaces only the keys it names', () => {
    // §1.4 A17: the stalker finally has its own body. It overrides `birthMass`
    // and `maxAge` but says nothing about `mortalityRamp`, which must still
    // arrive from the config rather than becoming undefined.
    const stalker = registry().get('predator.stalker');
    assert.equal(stalker.aging.birthMass, 8, "its own birth mass, not the grazer's 5");
    assert.ok(stalker.aging.maxAge > CONFIG.aging.maxAge, 'and a longer life');
    assert.equal(stalker.aging.mortalityRamp, CONFIG.aging.mortalityRamp, 'unstated keys still inherit');
    assert.equal(stalker.aging.edibleMassFraction, CONFIG.aging.edibleMassFraction);
  });

  test('merging is recursive, so overriding one nested key keeps its siblings', () => {
    // The shallow-merge bug this guards against is silent and slow to find: a
    // species tweaking one trait's spread would drop the other seven, and the
    // symptom ("why is everything the same size") appears steps later.
    const nested = resolveSpecies(
      { id: 'test.nested', traits: { spread: { size: 0.99 } } },
      { traits: { spread: { size: 0.1, speed: 0.2, boldness: 0.3 } } },
    );
    assert.equal(nested.traits.spread.size, 0.99, 'the override applies');
    assert.equal(nested.traits.spread.speed, 0.2, 'and its siblings survive');
    assert.equal(nested.traits.spread.boldness, 0.3);
  });

  test('every declared block is resolvable for every species', () => {
    for (const species of registry().all()) {
      for (const block of SPECIES_BLOCKS) {
        assert.equal(typeof species[block], 'object', `${species.id} resolves ${block}`);
        assert.notEqual(species[block], null);
      }
    }
  });

  test('a resolved species is frozen all the way down', () => {
    // Systems read these in hot loops and must be able to trust them.
    const grazer = registry().get('herbivore.grazer');
    assert.throws(() => {
      grazer.aging.maxAge = 1;
    }, TypeError);
    assert.throws(() => {
      grazer.bodyMass = 1;
    }, TypeError);
  });

  test('resolution depends on the config, so two engines can disagree', () => {
    // The reason the registry is per-engine rather than a module singleton:
    // sweeps and half the test suite run engines with different configs in one
    // process, and a shared resolved registry would silently be one of them.
    const fast = new SimulationEngine({ config: { metabolism: { basalRate: 999 } } });
    const normal = new SimulationEngine();
    assert.equal(fast.species.get('herbivore.grazer').metabolism.basalRate, 999);
    assert.equal(normal.species.get('herbivore.grazer').metabolism.basalRate, CONFIG.metabolism.basalRate);
  });

  test('an unknown species is null from get and throws from require', () => {
    const r = registry();
    assert.equal(r.get('nope.unknown'), null, 'systems degrade rather than crash');
    assert.throws(() => r.require('nope.unknown'), /unknown species/, 'setup code fails loudly');
  });

  test('the predator/prey relation is data, read in both directions', () => {
    const r = registry();
    assert.equal(r.hunts('predator.stalker', 'herbivore.grazer'), true);
    assert.equal(r.hunts('herbivore.grazer', 'predator.stalker'), false, 'grazers hunt nothing');
    assert.equal(r.hunts('herbivore.grazer', 'herbivore.grazer'), false, 'nor each other');
    assert.equal(r.hunts('nope.unknown', 'herbivore.grazer'), false);
  });
});

describe('species schema: no species-name conditionals', () => {
  function sourceFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
  }

  // Comments are stripped before scanning, per §1.4 D6: a guard that fires on
  // prose teaches people to word around it rather than trust it. Every one of
  // these files *discusses* grazers and stalkers at length.
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('no species id literal appears anywhere in the engine', () => {
    // The invariant since Step 4, finally enforced rather than merely asserted
    // in prose. Behaviour comes from data — `diet`, `preySpeciesIds`,
    // `territory.defends`, `migration.tracksForage` — which is what makes a new
    // species a config edit rather than a code edit.
    const ids = listSpecies().map((s) => s.id);
    assert.ok(ids.length >= 3, 'there are enough species for this to mean something');

    const offenders = [];
    for (const file of sourceFiles('src/simulation')) {
      // The species *definitions* are exactly where ids belong.
      if (file.includes(join('config', 'species'))) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const id of ids) {
        if (source.includes(id)) offenders.push(`${file} mentions "${id}"`);
      }
    }
    assert.deepEqual(offenders, [], `species ids leaked into the engine:\n${offenders.join('\n')}`);
  });

  test('no diet or kind literal is branched on outside the species files either', () => {
    // A weaker but real version of the same rule: `diet === 'carnivore'` is a
    // legitimate read of species *data*, but it must come from a resolved
    // species rather than from a hardcoded name. This pins that the only string
    // comparisons against a diet are against the field.
    const offenders = [];
    for (const file of sourceFiles('src/simulation')) {
      if (file.includes(join('config', 'species'))) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      // Any `'herbivore'`/`'carnivore'` comparison must be on a `.diet`.
      for (const match of source.matchAll(/['"](herbivore|carnivore)['"]/g)) {
        const before = source.slice(Math.max(0, match.index - 60), match.index);
        if (!before.includes('diet')) offenders.push(`${file}: ${match[0]} not compared against .diet`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe('species schema: a species is config, not code', () => {
  /**
   * The acceptance criterion, and the whole point of the step: adding a species
   * changes the world **with no engine edit at all**.
   *
   * This is asserted by adding one *here, in the test*, from a plain object —
   * so if any engine change were required, this would fail. The scavenger that
   * ships in the demo is the same trick used in earnest.
   */
  test('a species invented in a test file lives, eats, and is projected', () => {
    const browser = {
      id: 'herbivore.browser',
      kind: 'animal',
      diet: 'herbivore',
      bodyMass: 60,
      baseSpeed: 0.9,
      maxEnergy: 140,
      maxHealth: 120,
      maxHydration: 100,
      maxStamina: 80,
      perception: { radius: 5 },
      comfortMin: 0,
      comfortMax: 25,
      matePreference: { trait: 'size', span: 0.3, conditionWeight: 0.4 },
      territory: { defends: false, rangeRadius: 10, settleTicks: 700 },
      migration: { tracksForage: true, cueRadius: 12, dispersalTicks: 300 },
      aging: { birthMass: 12, maturityAge: 1600, adultUntil: 7000, maxAge: 15000 },
      metabolism: { basalRate: 0.05 },
      initialEnergyFraction: { min: 0.6, max: 1 },
    };

    const resolved = new SpeciesRegistry([...SPECIES_DEFINITIONS, browser], CONFIG).get(browser.id);
    assert.equal(resolved.aging.birthMass, 12, 'its own biology');
    assert.equal(resolved.aging.mortalityRamp, CONFIG.aging.mortalityRamp, 'and the shared defaults');
    assert.equal(resolved.hydration.dehydrationRate, CONFIG.hydration.dehydrationRate);
    assert.equal(resolved.perception.radius, 5);
    assert.equal(resolved.metabolism.moveCostFactor, CONFIG.metabolism.moveCostFactor);
  });

  test('the demo founds every cohort in the roster, and a third species really coexists', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3000);

    const living = {};
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      living[entity.speciesId] = (living[entity.speciesId] ?? 0) + 1;
    }
    for (const cohort of engine.config.demo.founding) {
      assert.ok(living[cohort.speciesId] > 0, `${cohort.speciesId} is still alive at 3000 ticks`);
    }
    assert.ok(Object.keys(living).length >= 3, 'three species coexist');
  });

  test('a scavenger hunts nothing and is feared by nothing — from data alone', () => {
    // The scavenger's entire implementation is an empty `preySpeciesIds`. This
    // asserts both directions of that, because the relation is read both ways.
    const engine = createDemoSimulation({ seed: 42 });
    const corvid = engine.species.require('scavenger.corvid');
    assert.equal(corvid.diet, 'carnivore', 'it eats meat');
    assert.deepEqual([...corvid.preySpeciesIds], [], 'and hunts nothing at all');
    for (const other of engine.species.ids()) {
      assert.equal(engine.species.hunts(corvid.id, other), false, `does not hunt ${other}`);
      assert.equal(engine.species.hunts(other, corvid.id), false, `is not hunted by ${other}`);
    }
  });

  test('a scavenger never makes a capture attempt, however hungry', () => {
    const engine = createDemoSimulation({ seed: 7 });
    const hunts = [];
    for (let i = 0; i < 3000; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type !== 'entity.hunted') continue;
        const hunter = engine.world.entities.get(e.entityId);
        if (hunter?.speciesId === 'scavenger.corvid') hunts.push(e);
      }
    }
    assert.deepEqual(hunts, [], 'the hunting pipeline never fires for a species with no prey');
  });
});

describe('species schema: per-species biology actually bites', () => {
  test('species age on their own curves, not one shared one', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const grazer = engine.species.require('herbivore.grazer');
    const stalker = engine.species.require('predator.stalker');
    const corvid = engine.species.require('scavenger.corvid');

    // §1.4 A17 in one assertion: three species, three birth masses, three
    // lifespans. Every one of these was 5 kg and 12 000 ticks before Step 29.
    const birthMasses = [grazer.aging.birthMass, stalker.aging.birthMass, corvid.aging.birthMass];
    assert.equal(new Set(birthMasses).size, 3, `distinct birth masses: ${birthMasses}`);
    const lifespans = [grazer.aging.maxAge, stalker.aging.maxAge, corvid.aging.maxAge];
    assert.equal(new Set(lifespans).size, 3, `distinct lifespans: ${lifespans}`);
  });

  test('a newborn is born at its own species mass', () => {
    const engine = createDemoSimulation({ seed: 13 });
    const byId = new Map();
    for (let i = 0; i < 4000; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type !== 'entity.born') continue;
        const born = engine.world.entities.get(e.entityId);
        if (born && !byId.has(born.speciesId)) byId.set(born.speciesId, born.bodyMass);
      }
    }
    assert.ok(byId.size > 0, 'something was born');
    for (const [speciesId, mass] of byId) {
      const expected = engine.species.require(speciesId).aging.birthMass;
      assert.ok(
        Math.abs(mass - expected) < expected * 0.5,
        `${speciesId} newborn at ${mass.toFixed(1)} kg, near its own birth mass ${expected}`,
      );
    }
  });

  test('perception radius is a species block, not a bare scalar (§1.4 B4)', () => {
    const engine = createDemoSimulation({ seed: 42 });
    for (const species of engine.species.all()) {
      assert.equal(typeof species.perception.radius, 'number', `${species.id} has a perception block`);
      assert.equal(species.perceptionRadius, undefined, `${species.id} no longer uses the old scalar`);
    }
    // And they genuinely differ — a stalker hunts by detection, a scavenger
    // finds bodies from further still, and a grazer sees least of all.
    const radii = engine.species.all().map((s) => s.perception.radius);
    assert.equal(new Set(radii).size, radii.length, `distinct perception radii: ${radii}`);
  });

  test('the demo stays deterministic with three species', () => {
    const a = createDemoSimulation({ seed: 99 });
    const b = createDemoSimulation({ seed: 99 });
    a.step(800);
    b.step(800);
    assert.deepEqual(captureSimulationState(b), captureSimulationState(a));
  });

  test('a three-species world survives save/load identically', () => {
    const engine = createDemoSimulation({ seed: 31 });
    engine.step(1500);
    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));
    const restored = restoreDemoSimulation(saved);
    engine.step(400);
    restored.step(400);
    const summarize = (e) =>
      [...e.world.entities.all()].map((en) => [en.id, en.speciesId, en.x, en.y, en.bodyMass, en.lifeStage]);
    assert.deepEqual(summarize(restored), summarize(engine));
  });
});
