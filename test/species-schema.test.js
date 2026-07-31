import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SpeciesRegistry, SPECIES_BLOCKS, resolveSpecies } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies, listSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { stripComments, removeDemoFoundingRoster } from './helpers/sourceScan.js';

const CONFIG = new SimulationEngine().config;
const registry = () => new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG);

describe('species schema: resolution', () => {
  test('a species inherits every block it does not override', () => {
    const grazer = registry().get('herbivore.gazelle');
    // The grazer states no metabolism block at all, so it is the config's.
    assert.equal(grazer.metabolism.basalRate, CONFIG.metabolism.basalRate);
    assert.equal(grazer.metabolism.referenceMass, CONFIG.metabolism.referenceMass);
    assert.equal(grazer.aging.maxAge, CONFIG.aging.maxAge);
  });

  test('an override replaces only the keys it names', () => {
    // §1.4 A17: the stalker finally has its own body. It overrides `birthMass`
    // and `maxAge` but says nothing about `mortalityRamp`, which must still
    // arrive from the config rather than becoming undefined.
    const stalker = registry().get('predator.leopard');
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
    const grazer = registry().get('herbivore.gazelle');
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
    assert.equal(fast.species.get('herbivore.gazelle').metabolism.basalRate, 999);
    assert.equal(normal.species.get('herbivore.gazelle').metabolism.basalRate, CONFIG.metabolism.basalRate);
  });

  test('an unknown species is null from get and throws from require', () => {
    const r = registry();
    assert.equal(r.get('nope.unknown'), null, 'systems degrade rather than crash');
    assert.throws(() => r.require('nope.unknown'), /unknown species/, 'setup code fails loudly');
  });

  test('the predator/prey relation is data, read in both directions', () => {
    const r = registry();
    assert.equal(r.hunts('predator.leopard', 'herbivore.gazelle'), true);
    assert.equal(r.hunts('herbivore.gazelle', 'predator.leopard'), false, 'grazers hunt nothing');
    assert.equal(r.hunts('herbivore.gazelle', 'herbivore.gazelle'), false, 'nor each other');
    assert.equal(r.hunts('nope.unknown', 'herbivore.gazelle'), false);
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
  // these files *discusses* grazers and stalkers at length. The stripper is
  // shared with the other two source scans and pinned by `source-scan.test.js` —
  // ⚠ it used to be a two-regex line that read `config/species/*` inside a `//`
  // comment as opening a block comment and went blind across 600 lines of
  // config, which is most of where a leaked id would ever hide.
  const DEMO_CONFIG = join('config', 'defaultSimulationConfig.js');

  /**
   * Read a source file as the scan should see it: comments gone, and — for the
   * demo config alone — the `demo.founding` roster excised, because a scenario
   * definition naming its species is the one legitimate use of an id outside
   * `config/species/`. Everything else in that file stays scanned.
   */
  const scannableSource = (file) => {
    const source = stripComments(readFileSync(file, 'utf8'));
    return file.endsWith(DEMO_CONFIG) ? removeDemoFoundingRoster(source) : source;
  };

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
      const source = scannableSource(file);
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
      const source = scannableSource(file);
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
      // ⚠ A cohort at 0 is declared but not founded — the measurement-gate
      // position a new species sits in while it is being swept (§9), and the
      // state that must leave no trace. "Founded and then died" is the failure
      // this test is for; "never founded" is not.
      if (cohort.count === 0) {
        assert.ok(!living[cohort.speciesId], `${cohort.speciesId} is founded at 0 and must not exist`);
        continue;
      }
      assert.ok(living[cohort.speciesId] > 0, `${cohort.speciesId} is still alive at 3000 ticks`);
    }
    assert.ok(Object.keys(living).length >= 3, 'three species coexist');
  });

  test('a scavenger hunts nothing and is feared by nothing — from data alone', () => {
    // The scavenger's entire implementation is an empty `preySpeciesIds`. This
    // asserts both directions of that, because the relation is read both ways.
    const engine = createDemoSimulation({ seed: 42 });
    const corvid = engine.species.require('scavenger.vulture');
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
        if (hunter?.speciesId === 'scavenger.vulture') hunts.push(e);
      }
    }
    assert.deepEqual(hunts, [], 'the hunting pipeline never fires for a species with no prey');
  });
});

describe('species schema: per-species biology actually bites', () => {
  test('species age on their own curves, not one shared one', () => {
    // §1.4 A17: before Step 29 every animal was born at 5 kg and died at 12 000
    // ticks, because `aging` lived in global config.
    //
    // ⚠ This asserted `new Set(...).size === 3` — that *no two* species agree on
    // a birth mass or a lifespan. That is true at three species by accident, and
    // it is not the claim: the claim is that the axis varies at all. Two of ten
    // species may honestly share a lifespan, and D1's rule applies — assert the
    // invariant that survives biology changes, not the incidental outcome. Read
    // off the whole roster so it keeps covering species added later.
    const engine = createDemoSimulation({ seed: 42 });
    const roster = engine.species.all();
    assert.ok(roster.length >= 3, 'enough species for this to mean anything');

    const varies = (pick, label) => {
      const values = roster.map(pick);
      assert.ok(values.every((v) => typeof v === 'number' && v > 0), `every species states a ${label}: ${values}`);
      assert.ok(new Set(values).size > 1, `${label} varies across the roster, rather than one shared curve: ${values}`);
    };
    varies((s) => s.aging.birthMass, 'birth mass');
    varies((s) => s.aging.maxAge, 'lifespan');

    // And the mechanism behind it, not just its footprint: a species that states
    // an `aging` block gets its own numbers, and one that states none inherits.
    const stalker = engine.species.require('predator.leopard');
    const grazer = engine.species.require('herbivore.gazelle');
    assert.notEqual(stalker.aging.maxAge, CONFIG.aging.maxAge, 'an override wins over the config default');
    assert.equal(grazer.aging.maxAge, CONFIG.aging.maxAge, 'and a species that states nothing inherits it');
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

  test('`behavior` is a species block: a declared weight beats the global config', () => {
    // The point of splitting `config.decision` (2026-07-28): a species can now
    // say what it *wants*, not just what its body is like. Asserted on the
    // resolution rather than on an emergent population outcome, per D1 — a
    // skittish species is a fact about the record, and what it does with that
    // is the decision system's job, already covered elsewhere.
    const skittish = {
      id: 'herbivore.skittish',
      kind: 'animal',
      diet: 'herbivore',
      bodyMass: 20,
      behavior: Object.freeze({ fleeWeight: 9, herdWeight: 0.05 }),
    };
    const resolved = new SpeciesRegistry([skittish], CONFIG).get('herbivore.skittish');
    assert.equal(resolved.behavior.fleeWeight, 9, 'the override wins');
    assert.notEqual(CONFIG.behavior.fleeWeight, 9, 'and it genuinely differs from the default');
    // ⚠ The merge is recursive, so stating one weight must not drop the other
    // twenty-one — the bug `traits.spread` was shaped like.
    assert.equal(resolved.behavior.wanderBias, CONFIG.behavior.wanderBias, 'siblings are inherited, not dropped');
    assert.equal(Object.keys(resolved.behavior).length, Object.keys(CONFIG.behavior).length, 'the block is whole');
    // And the machinery half stayed global: a species cannot reach it at all.
    assert.equal(resolved.decision, undefined, 'a species does not get to retune the engine');
  });

  test('perception radius is a species block, not a bare scalar (§1.4 B4)', () => {
    const engine = createDemoSimulation({ seed: 42 });
    for (const species of engine.species.all()) {
      assert.equal(typeof species.perception.radius, 'number', `${species.id} has a perception block`);
      assert.equal(species.perceptionRadius, undefined, `${species.id} no longer uses the old scalar`);
    }
    // And the axis is genuinely in use — a stalker hunts by detection, a
    // scavenger finds bodies from further still, and a grazer sees least of all.
    //
    // ⚠ This asserted every radius was *distinct* (`new Set(radii).size ===
    // radii.length`). That holds at three species only because three animals
    // happened to need three radii; it is an over-constraint with no biological
    // content, and it fails the first time two species honestly agree — a 60 kg
    // leopard and a 60 kg hyena have every reason to see equally far. What the
    // block has to earn is that radius *varies*, not that no two agree.
    const radii = engine.species.all().map((s) => s.perception.radius);
    assert.ok(new Set(radii).size > 1, `perception radius varies across the roster: ${radii}`);
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
