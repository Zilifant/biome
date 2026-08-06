/**
 * Genetics over long runs — split out of `genetics.test.js` on 2026-08-05.
 *
 * ⚠ **This file exists for the scheduler, not for the reader**; see
 * `aging.slow.test.js` for the full argument. `node --test` parallelizes across
 * *files* and never within one, and these two blocks were **538 s** of a 930 s
 * suite (the inheritance sandbox 224 s, the protocol/persistence block 315 s).
 *
 * ⚠ Note the inheritance sandbox is **not** a demo test — it is a sandbox that
 * breeds for thousands of ticks. `.slow.test.js` names the cost, not the world,
 * which is why it is the right suffix for both blocks.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import {
  GENOME_LOCI,
  expressGenome,
  genotypeOf,
} from '../src/simulation/traits/genetics.js';
import { ReproductionSystem } from '../src/simulation/systems/ReproductionSystem.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import { smallDemo } from './helpers/smallDemo.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.gazelle');

/** A genome with every locus fixed at one value — useful for exact assertions. */
function uniformGenome(value) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [value, value]]));
}

function sandbox({ seed = 1, systems = [], config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 32, height: 32 }, terrain: { ...FLAT_TERRAIN }, ...config },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawnAdult(engine, overrides = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: GRAZER.id,
    heading: 0,
    lifeStage: 'adult',
    bodyMass: GRAZER.bodyMass,
    adultMass: GRAZER.bodyMass,
    speed: GRAZER.baseSpeed,
    maxEnergy: GRAZER.maxEnergy,
    energy: GRAZER.maxEnergy,
    maxHealth: GRAZER.maxHealth,
    maxHydration: GRAZER.maxHydration,
    maxStamina: GRAZER.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('genetics: inheritance sandbox', () => {
  test('offspring resemble their parents across a lineage', () => {
    // ⚠ Per-species from Step 29: these reach the *config* so the species
    // registry resolves with them; a species' own block beats system options.
    const reproduction = {
      ...CONFIG.reproduction,
      gestationTicks: 2,
      cooldownTicks: 5,
      minEnergyFraction: 0.1,
      // Mate choice off: this sandbox is about what a genome does at birth,
      // and a female holding out for a better male would only add noise.
      acceptanceThreshold: 0,
      suitorMinEnergyFraction: 0.1,
      suitorCooldownTicks: 5,
    };
    const engine = sandbox({
      config: { reproduction },
      systems: [
        new ReproductionSystem({ ...reproduction, birthMass: CONFIG.aging.birthMass, genetics: CONFIG.genetics }),
      ],
    });

    // Two parents at opposite ends of the size range, repeatedly bred.
    const small = uniformGenome(0.7);
    const large = uniformGenome(1.35);
    spawnAdult(engine, { x: 10, y: 10, sex: 'female', genome: small, traits: expressGenome(small) });
    spawnAdult(engine, { x: 11, y: 10, sex: 'male', genome: large, traits: expressGenome(large) });

    engine.step(120);
    const children = [...engine.world.entities.all()].filter((e) => e.parents.length > 0);
    assert.ok(children.length >= 3, `the pair bred (${children.length} offspring)`);

    // Every child sits inside the parental range for size, not scattered
    // around the species mean — that is the difference between inheritance and
    // the Step 14 resampling this replaced.
    const { mutationStep } = CONFIG.genetics;
    for (const child of children) {
      const size = genotypeOf(child.genome).size;
      assert.ok(size >= 0.7 - mutationStep - 1e-9 && size <= 1.35 + mutationStep + 1e-9, `child size ${size} within range`);
    }
    const mean = children.reduce((a, c) => a + genotypeOf(c.genome).size, 0) / children.length;
    assert.ok(mean > 0.8 && mean < 1.3, `offspring cluster between the parents (mean ${mean.toFixed(3)})`);
  });

  test('in the demo, offspring traits track their parents rather than the species mean', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(9000);

    const rows = [];
    for (const child of engine.world.entities.all()) {
      if (child.parents.length === 0) continue;
      const parents = child.parents.map((id) => engine.world.entities.get(id)).filter(Boolean);
      if (parents.length === 0) continue;
      rows.push({
        child: genotypeOf(child.genome).size,
        midparent: parents.reduce((a, p) => a + genotypeOf(p.genome).size, 0) / parents.length,
      });
    }
    assert.ok(rows.length >= 20, `enough parent-offspring pairs to measure (${rows.length})`);

    const meanX = rows.reduce((a, r) => a + r.midparent, 0) / rows.length;
    const meanY = rows.reduce((a, r) => a + r.child, 0) / rows.length;
    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (const r of rows) {
      cov += (r.midparent - meanX) * (r.child - meanY);
      varX += (r.midparent - meanX) ** 2;
      varY += (r.child - meanY) ** 2;
    }
    const correlation = cov / Math.sqrt(varX * varY);
    // Qualitative resemblance, as the step asks — not exact equality. Mendelian
    // sampling and mutation both pull this below 1 on purpose.
    assert.ok(correlation > 0.25, `parent-offspring size correlation is real (r = ${correlation.toFixed(3)})`);
  });
});

describe('genetics: protocol, persistence, and determinism', () => {
  test('genome and genotype are inspection-only; only the phenotype drives behaviour', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(300);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      for (const field of ['genome', 'genotype', 'traits', 'parentTraits']) {
        assert.ok(!(field in entity), `${field} must not ride in bulk snapshots`);
      }
    }
    assert.ok(!PUBLIC_ENTITY_FIELDS.includes('genome'));

    const id = [...engine.world.entities.all()][0].id;
    const details = engine.getEntityDetails(id);
    for (const locus of GENOME_LOCI) {
      assert.equal(details.genome[locus].length, 2);
      assert.equal(typeof details.genotype[locus], 'number');
    }
    assert.ok(Array.isArray(details.parentTraits));
  });

  test('inspection shows parent traits where the parent survives, and a status where it does not', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(6000);
    const child = [...engine.world.entities.all()].find((e) => e.parents.length > 0);
    assert.ok(child, 'someone has parents');
    const details = engine.getEntityDetails(child.id);
    for (const entry of details.parentTraits) {
      if (entry.traits) {
        assert.ok(entry.status === 'alive' || entry.status === 'carcass', 'traits come with a present parent');
        assert.equal(typeof entry.traits.size, 'number');
      } else {
        assert.ok(entry.status === 'dead' || entry.status === 'forgotten', `unexpected status ${entry.status}`);
      }
    }
  });

  test('inspection returns copies — mutating them cannot reach the genome', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const id = [...engine.world.entities.all()][0].id;
    const before = engine.world.entities.get(id).genome.size[0];
    const details = engine.getEntityDetails(id);
    details.genome.size[0] = 99;
    assert.equal(engine.world.entities.get(id).genome.size[0], before);
  });

  test('genomes survive save/load and the run continues identically', () => {
    const engine = smallDemo({ seed: 42 });
    engine.step(4000);
    const saved = captureSimulationState(engine);
    const before = [...engine.world.entities.all()].map((e) => ({ id: e.id, genome: e.genome, traits: e.traits }));

    const restored = restoreDemoSimulation(saved);
    assert.deepEqual(
      [...restored.world.entities.all()].map((e) => ({ id: e.id, genome: e.genome, traits: e.traits })),
      before,
      'genomes round-trip exactly',
    );
    engine.step(400);
    restored.step(400);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('heredity keeps the demo deterministic, and its stream is independent', () => {
    const a = smallDemo({ seed: 42 });
    const b = smallDemo({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);

    const c = smallDemo({ seed: 55 });
    const d = smallDemo({ seed: 55 });
    const scratch = d.randomStream('unrelated');
    for (let i = 0; i < 50; i += 1) scratch.next();
    c.step(600);
    d.step(600);
    assert.deepEqual(captureSimulationState(c).entities, captureSimulationState(d).entities);
  });
});
