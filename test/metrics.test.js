import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import {
  computeMetrics,
  describe as describeSample,
  histogram,
  summarizeForHistory,
  HISTOGRAM_BINS,
} from '../src/simulation/metrics/metrics.js';
import { MetricsSystem } from '../src/simulation/systems/MetricsSystem.js';
import { TRAIT_NAMES } from '../src/simulation/traits/traits.js';
import { expressGenome, GENOME_LOCI } from '../src/simulation/traits/genetics.js';
import { killAnimal } from '../src/simulation/systems/death.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { buildMetricsReport } from '../src/protocol/queries.js';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot } from '../src/protocol/snapshots.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.grazer');

function uniformGenome(value) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [value, value]]));
}

function sandbox({ seed = 1, systems = [] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 32, height: 32 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 } },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawn(engine, overrides = {}) {
  const genome = overrides.genome ?? uniformGenome(1);
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: GRAZER.id,
    x: 5,
    y: 5,
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
    genome,
    traits: overrides.traits ?? expressGenome(genome),
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('metrics: the summary primitives', () => {
  test('describe reports mean, spread, and extremes — and nulls for an empty sample', () => {
    const summary = describeSample([1, 2, 3, 4]);
    assert.equal(summary.count, 4);
    assert.equal(summary.mean, 2.5);
    assert.equal(summary.min, 1);
    assert.equal(summary.max, 4);
    assert.ok(Math.abs(summary.stdev - Math.sqrt(1.25)) < 1e-12);

    const empty = describeSample([]);
    assert.deepEqual(empty, { count: 0, mean: null, stdev: null, min: null, max: null });
  });

  test('histograms have fixed bins, count everything, and clamp outliers in', () => {
    const values = [0.1, 0.6, 1.0, 1.4, 9.9];
    const result = histogram(values);
    assert.equal(result.bins.length, HISTOGRAM_BINS);
    assert.equal(
      result.bins.reduce((a, b) => a + b, 0),
      values.length,
      'nothing is dropped, however extreme',
    );
    assert.ok(result.bins[0] >= 1, 'the low outlier landed in the first bin');
    assert.ok(result.bins.at(-1) >= 1, 'the high outlier landed in the last');
  });
});

describe('metrics: aggregates match a brute-force count', () => {
  test('population, life stages, and generations match the entities themselves', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3000);
    const report = computeMetrics(engine.world, { tick: engine.tick, windowTicks: 500 });

    const all = [...engine.world.entities.all()];
    assert.equal(report.totalEntities, all.length);
    assert.equal(report.carcasses, all.filter((e) => e.kind === 'carcass').length);

    for (const species of report.species) {
      const living = all.filter((e) => e.speciesId === species.speciesId && e.alive && e.kind === 'animal');
      assert.equal(species.living, living.length, `${species.speciesId} living count`);

      for (const stage of Object.keys(species.lifeStages)) {
        assert.equal(
          species.lifeStages[stage],
          living.filter((e) => e.lifeStage === stage).length,
          `${species.speciesId} ${stage}`,
        );
      }
      if (living.length > 0) {
        const meanGeneration = living.reduce((a, e) => a + e.generation, 0) / living.length;
        assert.ok(Math.abs(species.generation.mean - meanGeneration) < 1e-12, 'mean generation');
        assert.equal(species.generation.max, Math.max(...living.map((e) => e.generation)));

        const meanOffspring = living.reduce((a, e) => a + e.offspring.length, 0) / living.length;
        assert.ok(Math.abs(species.reproductiveSuccess.mean - meanOffspring) < 1e-12, 'mean offspring');

        for (const trait of TRAIT_NAMES) {
          const values = living.map((e) => e.traits[trait]);
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          assert.ok(Math.abs(species.traits[trait].phenotype.mean - mean) < 1e-12, `${trait} mean`);
          assert.equal(
            species.traits[trait].histogram.bins.reduce((a, b) => a + b, 0),
            living.length,
            `${trait} histogram counts everyone`,
          );
        }
      }
    }
  });

  test('birth and death rates are derived from state, and respect the window', () => {
    const engine = sandbox();
    const old = spawn(engine, { age: 5000 });
    const young = spawn(engine, { age: 10 });
    engine.clock.setTick(1000);

    // A death inside the window, and one long before it.
    const recent = spawn(engine, { age: 3000 });
    const ancient = spawn(engine, { age: 3000 });
    killAnimal(engine.world.entities.get(recent), 'age', 5, () => {}, 900);
    killAnimal(engine.world.entities.get(ancient), 'age', 5, () => {}, 100);

    const report = computeMetrics(engine.world, { tick: 1000, windowTicks: 500 });
    const species = report.species[0];
    assert.equal(species.births, 1, 'only the animal young enough to be born inside the window');
    assert.equal(species.deaths, 1, 'only the carcass stamped inside the window');
    assert.deepEqual(species.deathsByCause, { age: 1 });
    assert.ok(engine.world.entities.get(old) && engine.world.entities.get(young));
  });

  test('the selection differential is breeder mean minus adult mean, and null when unknowable', () => {
    const engine = sandbox();
    // Two adults that bred, well above average for size; two that did not.
    spawn(engine, { genome: uniformGenome(1.3), offspring: [901] });
    spawn(engine, { genome: uniformGenome(1.3), offspring: [902] });
    spawn(engine, { genome: uniformGenome(0.7) });
    spawn(engine, { genome: uniformGenome(0.7) });

    const report = computeMetrics(engine.world, { tick: 10, windowTicks: 500 });
    const size = report.species[0].traits.size;
    // Breeders average 1.3, all adults average 1.0 → S = +0.3.
    assert.ok(Math.abs(size.selectionDifferential - 0.3) < 1e-9, `S = ${size.selectionDifferential}`);

    const barren = sandbox();
    spawn(barren, { genome: uniformGenome(1) });
    const none = computeMetrics(barren.world, { tick: 10, windowTicks: 500 });
    assert.equal(none.species[0].traits.size.selectionDifferential, null, 'nothing has bred: honestly unknown');
  });
});

describe('metrics: the system', () => {
  test('metrics are written on the stagger, and the history stays bounded', () => {
    const engine = sandbox({ systems: [new MetricsSystem({ ...CONFIG.metrics, updateInterval: 10, historyLength: 4 })] });
    spawn(engine, {});
    assert.equal(engine.world.metrics, null, 'nothing before the first aggregation');

    engine.step(10);
    assert.ok(engine.world.metrics, 'aggregated on the interval');
    assert.equal(engine.world.metrics.tick, 10);

    engine.step(100);
    assert.equal(engine.world.metricsHistory.length, 4, 'history is capped');
    const ticks = engine.world.metricsHistory.map((s) => s.tick);
    assert.deepEqual([...ticks].sort((a, b) => a - b), ticks, 'and stays in order, oldest dropped first');
  });

  test('metrics write no organism state — observation cannot perturb what it observes', () => {
    const withMetrics = createDemoSimulation({ seed: 42 });
    const without = createDemoSimulation({ seed: 42, config: { metrics: { updateInterval: 1_000_000 } } });
    withMetrics.step(600);
    without.step(600);
    assert.deepEqual(
      captureSimulationState(withMetrics).entities,
      captureSimulationState(without).entities,
      'running the metrics system changes nothing about the population',
    );
  });

  test('the history summary stays small — no per-organism records', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(300);
    const sample = summarizeForHistory(engine.world.metrics);
    assert.deepEqual(Object.keys(sample).sort(), ['species', 'tick']);
    for (const entry of sample.species) {
      // The exact key list is the point of this assertion, not incidental: the
      // history is the one thing that grows with *time*, so anything added to a
      // sample multiplies by 120 retained samples. `infectious` (Step 25) is one
      // integer and earns it by being the outbreak curve — the thing the disease
      // step exists to make visible over time.
      assert.deepEqual(Object.keys(entry).sort(), ['generation', 'infectious', 'living', 'speciesId', 'traits']);
      assert.equal(Object.keys(entry.traits).length, TRAIT_NAMES.length);
    }
  });
});

describe('metrics: selection sandbox', () => {
  /**
   * A world where efficiency is the thing that matters: scarce food, fast
   * generations, no predators, no seasons, and genetic variance concentrated in
   * `metabolicEfficiency`. The prediction is directional only — an inefficient
   * animal burns its reserves faster, so it should breed less and die sooner.
   */
  function selectionWorld(seed) {
    return createDemoSimulation({
      seed,
      config: {
        world: { width: 36, height: 36 },
        terrain: { lakes: 1, ridges: 0, thickets: 0, coverPatchDensity: 0.5 },
        demo: { founding: [{ speciesId: 'herbivore.grazer', count: 70 }] },
        // Sparse food and an expensive body are the pressure, retuned in Step 22
        // (from capacity 1.4 at the default basal rate of 0.04). The old
        // settings barely applied one: breaking the deaths down by cause showed
        // they were *entirely* age deaths across all five seeds — nothing was
        // starving, so efficiency hardly touched survival, and the assertion
        // rose in 4 of 5 seeds essentially by drift. It passed because it was
        // pinned to one of the four.
        //
        // Note how the pressure actually works here, because it is not the
        // obvious way: even now almost nobody starves. Efficiency pays through
        // the *breeding gate* — an efficient animal sits above the 60 %-energy
        // threshold more of the time, so it breeds more often. That is fecundity
        // selection rather than viability selection, and it is worth naming so
        // the next reader does not go looking for starvation deaths that are
        // not there.
        vegetation: { capacity: 1.0, growthRate: 0.05 },
        // Doubling the resting cost is what makes efficiency worth having.
        metabolism: { basalRate: 0.08, moveCostFactor: 0.02, referenceMass: 30, massScalingExponent: 0.75, lowEnergyFraction: 0.25, edibleMassFraction: 0.6 },
        aging: {
          birthMass: 5,
          maturityAge: 150,
          juvenileUntil: 90,
          subadultUntil: 150,
          adultUntil: 900,
          maxAge: 1400,
          senescentMortalityPerTick: 0.006,
          mortalityRamp: 8,
          edibleMassFraction: 0.6,
        },
        reproduction: {
          gestationTicks: 90,
          cooldownTicks: 180,
          minEnergyFraction: 0.6,
          matingRange: 2.0,
          matingEnergyCost: 8,
          birthEnergyCost: 12,
          offspringEnergyFraction: 0.6,
          birthOffset: 1.0,
          // Mate choice off (Step 22). This world exists to show *natural*
          // selection — sparse food favouring metabolic efficiency — and
          // grazers now sexually select on **size**, which is a second force
          // pulling on a different trait. Leaving it on would make the test
          // measure two things at once, which is precisely what the near-clonal
          // trait spread below already goes out of its way to avoid.
          //
          // With choice off and the sharper pressure above, mean efficiency
          // rises in 5 of 5 seeds (42, 7, 13, 99, 2024) rather than the 4 of 5
          // the old settings managed — so this is not a fixture bent until it
          // passed, it is one that now measures what it claims on four seeds it
          // was never tuned against.
          acceptanceThreshold: 0,
        },
        parenting: { weaningAge: 45, provisionRange: 2, provisionRate: 0.5, provisionEfficiency: 0.8, parentMinEnergyFraction: 0.35, juvenileMaxEnergyFraction: 0.85 },
        // Variance where the pressure is; everything else near-clonal, so the
        // measurement is not confounded by other traits drifting.
        traits: {
          spread: {
            size: 0.04,
            speed: 0.04,
            metabolicEfficiency: 0.32,
            boldness: 0.04,
            caution: 0.04,
            exploration: 0.04,
            reproductiveInvestment: 0.04,
          },
        },
        genetics: { mutationRate: 0.05, mutationStep: 0.04 },
        // No seasons: a cycling food supply would confound the signal.
        environment: { ticksPerYear: 1_000_000, spellTicks: 100_000, meanTemperature: 14, temperatureAmplitude: 0 },
        metrics: { windowTicks: 500, historyLength: 200, updateInterval: 50 },
      },
    });
  }

  const meanEfficiency = (engine) => {
    const species = engine.world.metrics?.species.find((s) => s.speciesId === GRAZER.id);
    return species?.traits.metabolicEfficiency.genotype.mean ?? null;
  };

  /**
   * ⚠ This test used to assert that mean metabolic efficiency **rises** here.
   * It does not, and measurement in Step 23 showed it never reliably did — it
   * passed because it was pinned to seed 42. See §1.4 A31; the directional claim
   * is recorded as an unmet Step 21 acceptance criterion rather than quietly
   * dropped, and it is deliberately *not* re-asserted here on a luckier seed.
   *
   * What was measured, over seven seeds (42, 7, 13, 99, 2024, 5, 77) at 5000
   * ticks: the trait moved up in 3 and down in 4, with an across-seed mean
   * change of −0.0002 — i.e. no signal at all. The mean selection differential
   * was *negative* in five of the seven, and its sign did not even correlate
   * with the direction the trait went.
   *
   * The cause is now understood, and it is a property of the metric rather than
   * a bug in it. The differential compares breeders against **all** adults, and
   * in this world roughly **71% of adults are breeders** — a short cooldown
   * against a long adult life means almost everyone eventually breeds, so the
   * two samples are nearly the same set and the difference between them is
   * structurally near zero. A selection differential can only see selection
   * when reproduction is actually limiting.
   *
   * Tightening the breeding gate does make it visible (at `minEnergyFraction`
   * 0.9 the breeder share falls to 3–17% and the differential grows by an order
   * of magnitude) — but every setting tried that made reproduction limiting also
   * drove this population extinct inside 5000 ticks. A world that demonstrates
   * the claim needs to be built rather than tuned, which is Step 21 scenario 9's
   * work and not Step 23's.
   *
   * So this asserts what the fixture genuinely shows: generations turn over, the
   * machinery reports a live distribution, and the trait is free to move. No
   * direction is claimed.
   */
  test('the selection machinery reports a live, moving trait distribution', () => {
    const engine = selectionWorld(42);
    engine.step(50);
    const start = meanEfficiency(engine);
    assert.ok(start !== null, 'metrics available');

    engine.step(5000);
    const end = meanEfficiency(engine);
    const grazer = engine.world.metrics.species.find((s) => s.speciesId === GRAZER.id);

    assert.ok(grazer.living > 0, 'the population survived to be measured');
    assert.ok(grazer.generation.max >= 2, `several generations passed (max depth ${grazer.generation.max})`);
    assert.ok(Math.abs(end - start) > 1e-4, `the distribution moved (${start.toFixed(4)} → ${end.toFixed(4)})`);
    assert.equal(typeof grazer.traits.metabolicEfficiency.selectionDifferential, 'number', 'and the differential is computed');
    assert.ok(grazer.traits.metabolicEfficiency.histogram.bins.reduce((a, b) => a + b, 0) === grazer.living);
  });

  test('selection is emergent: nothing writes traits after birth', () => {
    // If any system nudged traits, an animal's genome and its expressed traits
    // would drift apart. They must stay exactly consistent for life.
    const engine = selectionWorld(7);
    engine.step(1500);
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal') continue;
      assert.deepEqual(entity.traits, expressGenome(entity.genome), `#${entity.id} traits still express its genome`);
    }
  });
});

describe('metrics: protocol, persistence, and determinism', () => {
  test('the metrics query is aggregated only — no per-organism records', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(300);
    const report = buildMetricsReport({
      simulationId: engine.simulationId,
      metrics: engine.world.metrics,
      history: engine.world.metricsHistory,
    });
    assert.equal(report.protocolVersion, PROTOCOL_VERSION);
    assert.equal(report.kind, 'metrics');
    assert.equal(report.available, true);

    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('"entityId"') && !serialized.includes('"parents"'), 'no per-organism identity');
    for (const species of report.metrics.species) {
      assert.equal(typeof species.living, 'number');
      assert.ok(!('entities' in species), 'no entity list');
    }
  });

  test('metrics stay out of bulk snapshots — they are a query, not per-tick state', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(200);
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(!('metrics' in snapshot), 'histograms would dwarf the entity array');
  });

  test('the report is a copy — mutating it cannot reach world state', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(200);
    const report = buildMetricsReport({
      simulationId: engine.simulationId,
      metrics: engine.world.metrics,
      history: engine.world.metricsHistory,
    });
    report.metrics.species[0].living = -1;
    report.history.push({ tick: -1, species: [] });
    assert.notEqual(engine.world.metrics.species[0].living, -1);
    assert.ok(!engine.world.metricsHistory.some((s) => s.tick === -1));
  });

  test('the report is derived and rebuilt on load; the history survives', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(2000);
    const saved = captureSimulationState(engine);
    assert.ok(saved.metricsHistory.length > 0, 'the history is saved');
    assert.ok(!('metrics' in saved), 'the report itself is not — it is derived');

    const restored = restoreDemoSimulation(saved);
    assert.equal(restored.world.metrics, null, 'and starts empty after a load');
    assert.deepEqual(restored.world.metricsHistory, engine.world.metricsHistory, 'the history round-trips');

    restored.step(CONFIG.metrics.updateInterval + 1);
    assert.ok(restored.world.metrics, 'the next metrics tick rebuilds it');

    engine.step(CONFIG.metrics.updateInterval + 1);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('metrics keep the demo deterministic', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(1500);
    b.step(1500);
    assert.deepEqual(a.world.metrics, b.world.metrics);
    assert.deepEqual(a.world.metricsHistory, b.world.metricsHistory);
  });
});
