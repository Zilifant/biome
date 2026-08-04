import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom } from '../src/simulation/random/SeededRandom.js';
import {
  GENOME_LOCI,
  TRADEOFFS,
  NEUTRAL_GENOME,
  sampleGenome,
  inheritGenome,
  expressGenome,
  genotypeOf,
} from '../src/simulation/traits/genetics.js';
import { NEUTRAL_TRAITS, TRAIT_NAMES } from '../src/simulation/traits/traits.js';
import { ReproductionSystem } from '../src/simulation/systems/ReproductionSystem.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.gazelle');
const WIDE = Object.fromEntries(GENOME_LOCI.map((locus) => [locus, 0.25]));

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

describe('genetics: the genome', () => {
  test('there is one locus per heritable trait, diploid', () => {
    assert.deepEqual([...GENOME_LOCI], [...TRAIT_NAMES], 'every trait is heritable');
    const genome = sampleGenome(new SeededRandom(3), WIDE);
    for (const locus of GENOME_LOCI) {
      assert.equal(genome[locus].length, 2, `${locus} has two alleles`);
      for (const allele of genome[locus]) assert.ok(allele > 0, 'alleles are positive');
    }
  });

  test('sampling is deterministic per seed, and zero spread gives the neutral genome', () => {
    assert.deepEqual(sampleGenome(new SeededRandom(7), WIDE), sampleGenome(new SeededRandom(7), WIDE));
    assert.deepEqual(sampleGenome(new SeededRandom(7), {}), NEUTRAL_GENOME);
  });

  test('a neutral genome expresses exactly the neutral phenotype', () => {
    assert.deepEqual(expressGenome(NEUTRAL_GENOME), { ...NEUTRAL_TRAITS });
    assert.deepEqual(expressGenome(null), { ...NEUTRAL_TRAITS }, 'a missing genome degrades gracefully');
  });

  test('expression is additive: a heterozygote lands between its alleles', () => {
    const genome = { ...uniformGenome(1), size: [0.8, 1.2] };
    assert.ok(Math.abs(genotypeOf(genome).size - 1.0) < 1e-9, 'the mean of the two alleles');
  });
});

describe('genetics: tradeoffs', () => {
  test('every tradeoff names traits that actually exist', () => {
    for (const { trait, against, strength } of TRADEOFFS) {
      assert.ok(GENOME_LOCI.includes(trait), `${trait} is a real locus`);
      assert.ok(GENOME_LOCI.includes(against), `${against} is a real locus`);
      assert.ok(strength > 0, 'and the tradeoff bites');
    }
  });

  test('investing in one trait is paid for out of another', () => {
    for (const { trait, against } of TRADEOFFS) {
      const average = expressGenome(uniformGenome(1));
      // Same genotype for `trait`; the only difference is a high `against`.
      const costly = expressGenome({ ...uniformGenome(1), [against]: [1.4, 1.4] });
      assert.ok(
        costly[trait] < average[trait],
        `a high ${against} genotype expresses less ${trait} (${costly[trait].toFixed(3)} vs ${average[trait].toFixed(3)})`,
      );
    }
  });

  test('genotype and phenotype differ exactly where a tradeoff applies', () => {
    const genome = { ...uniformGenome(1), size: [1.4, 1.4] };
    const genotype = genotypeOf(genome);
    const phenotype = expressGenome(genome);
    assert.ok(Math.abs(genotype.size - phenotype.size) < 1e-9, 'size itself is not traded against anything');
    assert.ok(phenotype.speed < genotype.speed, 'but the speed it expresses is cut by being big');
  });

  test('tradeoffs read from raw values, so the table order cannot change the result', () => {
    // size → speed → metabolicEfficiency is a chain; if they were applied
    // sequentially the middle term would double-count.
    const genome = { ...uniformGenome(1), size: [1.3, 1.3], speed: [1.3, 1.3] };
    const raw = genotypeOf(genome);
    const phenotype = expressGenome(genome);
    const expectedEfficiency = 1 * (1 - 0.4 * (raw.speed - 1));
    assert.ok(
      Math.abs(phenotype.metabolicEfficiency - expectedEfficiency) < 1e-9,
      'efficiency is charged against the raw speed genotype, not the expressed one',
    );
  });

  test('expressed traits never reach zero — several systems divide by them', () => {
    const extreme = expressGenome(uniformGenome(0.05));
    const opposite = expressGenome({ ...uniformGenome(3), speed: [0.05, 0.05] });
    for (const value of [...Object.values(extreme), ...Object.values(opposite)]) {
      assert.ok(value > 0, `expressed ${value} must stay positive`);
    }
  });
});

describe('genetics: inheritance', () => {
  const parentA = uniformGenome(0.7);
  const parentB = uniformGenome(1.3);

  test('a child takes one allele per locus from each parent', () => {
    // No mutation, so every allele must be traceable to a parent.
    const child = inheritGenome([parentA, parentB], new SeededRandom(5), { mutationRate: 0 });
    for (const locus of GENOME_LOCI) {
      const [first, second] = child[locus];
      assert.ok(Math.abs(first - 0.7) < 1e-9, `${locus}: first allele came from parent A`);
      assert.ok(Math.abs(second - 1.3) < 1e-9, `${locus}: second allele came from parent B`);
    }
  });

  test('offspring land inside the parental envelope, plus at most one mutation step', () => {
    const random = new SeededRandom(9);
    const { mutationStep } = CONFIG.genetics;
    for (let i = 0; i < 200; i += 1) {
      const child = inheritGenome([parentA, parentB], random, CONFIG.genetics);
      for (const locus of GENOME_LOCI) {
        for (const allele of child[locus]) {
          assert.ok(allele >= 0.7 - mutationStep - 1e-9, `${locus} allele ${allele} below the envelope`);
          assert.ok(allele <= 1.3 + mutationStep + 1e-9, `${locus} allele ${allele} above the envelope`);
        }
      }
    }
  });

  test('siblings differ — recombination assorts each locus independently', () => {
    // Heterozygous parents are the only way to see recombination at all: with
    // homozygous parents every child is identical no matter which allele is
    // picked, so this would pass vacuously.
    const hetA = Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [0.6, 0.9]]));
    const hetB = Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1.2, 1.5]]));
    const random = new SeededRandom(11);
    const siblings = Array.from({ length: 8 }, () => inheritGenome([hetA, hetB], random, { mutationRate: 0 }));

    const distinct = new Set(siblings.map((genome) => JSON.stringify(genome)));
    assert.ok(distinct.size > 1, 'two children of the same pair are not clones');

    // And the assortment is per locus, not one coin flip for the whole genome:
    // some sibling somewhere inherits a different allele at one locus than at
    // another, which a whole-genome pick could never produce.
    const mixed = siblings.some((genome) => new Set(GENOME_LOCI.map((l) => genome[l][0])).size > 1);
    assert.ok(mixed, 'loci assort independently');

    // Every allele still traces to the right parent.
    for (const genome of siblings) {
      for (const locus of GENOME_LOCI) {
        assert.ok([0.6, 0.9].includes(genome[locus][0]), `${locus} first allele came from parent A`);
        assert.ok([1.2, 1.5].includes(genome[locus][1]), `${locus} second allele came from parent B`);
      }
    }
  });

  test('the same parents and the same stream state produce the same child', () => {
    const one = inheritGenome([parentA, parentB], new SeededRandom(21), CONFIG.genetics);
    const two = inheritGenome([parentA, parentB], new SeededRandom(21), CONFIG.genetics);
    assert.deepEqual(one, two);
  });

  test('the draw budget is fixed, whatever the mutation outcome', () => {
    const mutating = new SeededRandom(4);
    const never = new SeededRandom(4);
    inheritGenome([parentA, parentB], mutating, { mutationRate: 1, mutationStep: 0.5 });
    inheritGenome([parentA, parentB], never, { mutationRate: 0 });
    assert.equal(mutating.getState(), never.getState(), 'the genetics stream never shifts with the outcome');
  });

  test('mutation is bounded and, at rate zero, absent entirely', () => {
    const unmutated = inheritGenome([parentA, parentA], new SeededRandom(6), { mutationRate: 0 });
    for (const locus of GENOME_LOCI) {
      for (const allele of unmutated[locus]) assert.ok(Math.abs(allele - 0.7) < 1e-9);
    }
    const mutated = inheritGenome([parentA, parentA], new SeededRandom(6), { mutationRate: 1, mutationStep: 0.1 });
    for (const locus of GENOME_LOCI) {
      for (const allele of mutated[locus]) {
        assert.ok(Math.abs(allele - 0.7) <= 0.1 + 1e-9, 'no single mutation exceeds the step');
      }
    }
  });

  test('a single-parent birth still produces a valid genome', () => {
    const child = inheritGenome([parentA], new SeededRandom(8), CONFIG.genetics);
    for (const locus of GENOME_LOCI) assert.equal(child[locus].length, 2);
    const orphaned = inheritGenome([], new SeededRandom(8), CONFIG.genetics);
    assert.deepEqual(orphaned, NEUTRAL_GENOME, 'with no parents at all, an average genome');
  });
});

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
    const engine = createDemoSimulation({ seed: 42 });
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
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);

    const c = createDemoSimulation({ seed: 55 });
    const d = createDemoSimulation({ seed: 55 });
    const scratch = d.randomStream('unrelated');
    for (let i = 0; i < 50; i += 1) scratch.next();
    c.step(600);
    d.step(600);
    assert.deepEqual(captureSimulationState(c).entities, captureSimulationState(d).entities);
  });
});
