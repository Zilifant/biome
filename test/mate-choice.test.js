import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom } from '../src/simulation/random/SeededRandom.js';
import {
  GESTATING_SEX,
  SEX_VALUES,
  Sexes,
  acceptanceThreshold,
  bestMateCandidate,
  drawSex,
  isChooser,
  mateQuality,
  matePreferenceFor,
} from '../src/simulation/mating/mateChoice.js';
import { ReproductionSystem } from '../src/simulation/systems/ReproductionSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { GENOME_LOCI, expressGenome, genotypeOf } from '../src/simulation/traits/genetics.js';
import { computeMetrics } from '../src/simulation/metrics/metrics.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { validateCommand } from '../src/protocol/validation.js';
import { CommandTypes, SEXES } from '../src/protocol/commands.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const CONFIG = new SimulationEngine().config;
// Resolved species (Step 29): the accessors take a resolved record, not an id.
const REGISTRY = new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG);
const GRAZER = getSpecies('herbivore.gazelle');
const PREFERENCE = GRAZER.matePreference;

/** A genome with every locus fixed at one value, then one locus overridden. */
function genomeWith(overrides = {}) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [overrides[locus] ?? 1, overrides[locus] ?? 1]]));
}

function sandbox({ seed = 1, systems = [], config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 32, height: 32 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 }, ...config },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawnAdult(engine, overrides = {}) {
  const genome = overrides.genome ?? genomeWith();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: GRAZER.id,
    heading: 0,
    lifeStage: 'adult',
    x: 10,
    y: 10,
    genome,
    traits: overrides.traits ?? expressGenome(genome),
    bodyMass: GRAZER.bodyMass,
    adultMass: GRAZER.bodyMass,
    speed: GRAZER.baseSpeed,
    maxEnergy: GRAZER.maxEnergy,
    energy: GRAZER.maxEnergy,
    maxHealth: GRAZER.maxHealth,
    health: GRAZER.maxHealth,
    maxHydration: GRAZER.maxHydration,
    maxStamina: GRAZER.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** A plain candidate record for the pure quality/threshold functions. */
function candidate(overrides = {}) {
  return {
    traits: expressGenome(genomeWith()),
    energy: 100,
    maxEnergy: 100,
    health: 100,
    maxHealth: 100,
    impairment: 0,
    ...overrides,
  };
}

/** Reproduction-only engine, so pairing can be checked tick by tick. */
/**
 * A reproduction sandbox.
 *
 * ⚠ Reproductive parameters are **per-species** from Step 29, so they are passed
 * as *config* here rather than as system options: the config is what the species
 * registry resolves against, and a species' own block beats anything the system
 * was constructed with. Passing `gestationTicks` to the system alone would be
 * silently ignored for any animal whose species the registry knows — which is
 * every animal in these tests.
 */
function repro(params = {}) {
  const reproduction = { ...CONFIG.reproduction, gestationTicks: 50, ...params };
  return sandbox({
    config: { reproduction },
    systems: [
      new ReproductionSystem({
        ...reproduction,
        birthMass: CONFIG.aging.birthMass,
        genetics: CONFIG.genetics,
      }),
    ],
  });
}

describe('mate choice: sexes', () => {
  test('the sexes are the protocol vocabulary, and one of them gestates', () => {
    assert.deepEqual([...SEX_VALUES], [...SEXES], 'the engine and the protocol agree on the vocabulary');
    assert.ok(SEXES.includes(GESTATING_SEX), 'the gestating sex is a real sex');
    assert.equal(isChooser({ sex: GESTATING_SEX }), true);
    assert.equal(isChooser({ sex: Sexes.MALE }), false);
    // An animal with no sex is not a chooser and can never pair — spawning one
    // is legal (it just never breeds) rather than an error.
    assert.equal(isChooser({ sex: null }), false);
    assert.equal(isChooser({}), false);
  });

  test('sex is drawn from its own stream, deterministically and near-evenly', () => {
    const a = new SeededRandom(11);
    const b = new SeededRandom(11);
    const drawsA = Array.from({ length: 200 }, () => drawSex(a));
    const drawsB = Array.from({ length: 200 }, () => drawSex(b));
    assert.deepEqual(drawsA, drawsB, 'same stream state ⇒ same sexes');
    for (const sex of drawsA) assert.ok(SEXES.includes(sex));
    const females = drawsA.filter((s) => s === Sexes.FEMALE).length;
    assert.ok(females > 70 && females < 130, `roughly balanced (${females}/200)`);
  });

  test('the founding cohorts are dealt balanced sexes rather than drawn', () => {
    const engine = createDemoSimulation({ seed: 42 });
    for (const speciesId of [engine.config.demo.speciesId, engine.config.demo.predatorSpeciesId]) {
      const cohort = [...engine.world.entities.all()].filter((e) => e.speciesId === speciesId);
      const females = cohort.filter((e) => e.sex === Sexes.FEMALE).length;
      assert.equal(females * 2, cohort.length, `${speciesId} founds an even sex ratio`);
      for (const entity of cohort) assert.ok(SEXES.includes(entity.sex), 'every founder has a sex');
    }
  });
});

describe('mate choice: what makes a good mate', () => {
  test('an above-average display scores higher than a below-average one', () => {
    const big = candidate({ traits: expressGenome(genomeWith({ size: 1.2 })) });
    const average = candidate();
    const small = candidate({ traits: expressGenome(genomeWith({ size: 0.8 })) });
    assert.ok(mateQuality(big, PREFERENCE) > mateQuality(average, PREFERENCE));
    assert.ok(mateQuality(average, PREFERENCE) > mateQuality(small, PREFERENCE));
  });

  test('condition counts, which is what keeps the display honest', () => {
    const displayed = expressGenome(genomeWith({ size: 1.2 }));
    const healthy = candidate({ traits: displayed });
    // The same genes, in a body that cannot back them up.
    const starving = candidate({ traits: displayed, energy: 20 });
    const wounded = candidate({ traits: displayed, health: 40, impairment: 0.5 });
    assert.ok(mateQuality(starving, PREFERENCE) < mateQuality(healthy, PREFERENCE), 'a starving animal is a poorer bet');
    assert.ok(mateQuality(wounded, PREFERENCE) < mateQuality(healthy, PREFERENCE), 'so is a mauled one');

    // A condition gap outweighs a *modest* display advantage: a half-starved
    // animal that is only slightly above average scores below a healthy
    // average one.
    const marginal = candidate({ traits: expressGenome(genomeWith({ size: 1.05 })), energy: 20 });
    assert.ok(mateQuality(marginal, PREFERENCE) < mateQuality(candidate(), PREFERENCE));

    // But it does not outweigh a *large* one — at `conditionWeight` 0.4 a
    // starving animal near the top of the size range still outscores a healthy
    // average one. That is the model being honest about itself rather than a
    // gap in it: it is the handicap reading of the signal (only a genuinely
    // good animal grows that big at all), and pinning it here means anyone who
    // later retunes the weight finds out here rather than in a five-seed sweep.
    assert.ok(mateQuality(starving, PREFERENCE) > mateQuality(candidate(), PREFERENCE));
  });

  test('quality stays in 0…1, saturating past the preference span', () => {
    const extremes = [0.01, 0.5, 1, 1.5, 5].map((size) =>
      mateQuality(candidate({ traits: expressGenome(genomeWith({ size })) }), PREFERENCE),
    );
    for (const q of extremes) assert.ok(q >= 0 && q <= 1, `quality ${q} in range`);
    const far = mateQuality(candidate({ traits: expressGenome(genomeWith({ size: 5 })) }), PREFERENCE);
    const beyond = mateQuality(candidate({ traits: expressGenome(genomeWith({ size: 50 })) }), PREFERENCE);
    assert.equal(far, beyond, 'the signal saturates rather than running away');
  });

  test('a species with no declared preference judges on condition alone', () => {
    const big = candidate({ traits: expressGenome(genomeWith({ size: 1.3 })) });
    const small = candidate({ traits: expressGenome(genomeWith({ size: 0.7 })) });
    assert.equal(mateQuality(big, null), mateQuality(small, null), 'no display, no discrimination');
    assert.ok(mateQuality(candidate({ energy: 30 }), null) < mateQuality(candidate(), null), 'condition still counts');
  });

  test('each species declares its own display, read generically', () => {
    assert.equal(matePreferenceFor(REGISTRY.get('herbivore.gazelle')).trait, 'size');
    assert.equal(matePreferenceFor(REGISTRY.get('predator.leopard')).trait, 'speed');
    assert.equal(matePreferenceFor(REGISTRY.get('nope.unknown')), null, 'an unknown species degrades to no preference');
  });
});

describe('mate choice: the cost of being choosy', () => {
  const PARAMS = { baseThreshold: 0.7, patienceTicks: 400 };

  test('a choosier animal holds a higher standard', () => {
    const picky = { traits: { choosiness: 1.4 }, mateSearchSince: 100 };
    const easy = { traits: { choosiness: 0.6 }, mateSearchSince: 100 };
    assert.ok(acceptanceThreshold(picky, 100, PARAMS) > acceptanceThreshold(easy, 100, PARAMS));
  });

  test('the standard falls to nothing as the animal goes unmated', () => {
    const chooser = { traits: { choosiness: 1 }, mateSearchSince: 0 };
    const start = acceptanceThreshold(chooser, 0, PARAMS);
    const middle = acceptanceThreshold(chooser, 200, PARAMS);
    const end = acceptanceThreshold(chooser, 400, PARAMS);
    assert.ok(Math.abs(start - 0.7) < 1e-9, 'starts at the base standard');
    assert.ok(middle < start && middle > end, 'declines monotonically');
    assert.equal(end, 0, 'and reaches zero rather than deadlocking');
    assert.equal(acceptanceThreshold(chooser, 10_000, PARAMS), 0, 'never goes negative');
  });

  test('an animal that has not started searching is held to the full standard', () => {
    const chooser = { traits: { choosiness: 1 }, mateSearchSince: null };
    assert.ok(Math.abs(acceptanceThreshold(chooser, 5000, PARAMS) - 0.7) < 1e-9);
  });
});

describe('mate choice: who an animal walks toward', () => {
  const resolve = (entities) => (id) => entities.get(id) ?? null;

  function twoCandidates() {
    const near = { id: 1, ...candidate({ traits: expressGenome(genomeWith({ size: 0.75 })) }) };
    const far = { id: 2, ...candidate({ traits: expressGenome(genomeWith({ size: 1.25 })) }) };
    return new Map([
      [1, near],
      [2, far],
    ]);
  }

  test('the choosing sex walks past a poor neighbour toward a better animal', () => {
    const entities = twoCandidates();
    const seen = [
      { id: 1, distance: 1 },
      { id: 2, distance: 4 },
    ];
    const best = bestMateCandidate(seen, resolve(entities), {
      preference: PREFERENCE,
      distanceWeight: CONFIG.decision.mateDistanceWeight,
      assess: true,
    });
    assert.equal(best.candidate.id, 2, 'the better mate wins despite being further off');
  });

  test('…but not across the meadow: distance still discounts quality', () => {
    const entities = twoCandidates();
    const seen = [
      { id: 1, distance: 1 },
      { id: 2, distance: 400 },
    ];
    const best = bestMateCandidate(seen, resolve(entities), {
      preference: PREFERENCE,
      distanceWeight: CONFIG.decision.mateDistanceWeight,
      assess: true,
    });
    assert.equal(best.candidate.id, 1, 'a far better mate very far away is not worth the walk');
  });

  test('the seeking sex takes the nearest and assesses nothing', () => {
    const entities = twoCandidates();
    const seen = [
      { id: 1, distance: 1 },
      { id: 2, distance: 4 },
    ];
    const best = bestMateCandidate(seen, resolve(entities), {
      preference: PREFERENCE,
      distanceWeight: CONFIG.decision.mateDistanceWeight,
      assess: false,
    });
    assert.equal(best.candidate.id, 1, 'nearest wins');
  });

  test('no candidates, or candidates that have since gone, resolve to nothing', () => {
    const empty = bestMateCandidate([], resolve(new Map()), { preference: PREFERENCE, distanceWeight: 0.04, assess: true });
    assert.equal(empty, null);
    const gone = bestMateCandidate([{ id: 9, distance: 1 }], resolve(new Map()), {
      preference: PREFERENCE,
      distanceWeight: 0.04,
      assess: true,
    });
    assert.equal(gone, null, 'a dangling perception entry is skipped, not crashed on');
  });

  test('perception offers a bounded set of opposite-sex adults', () => {
    const engine = sandbox({ systems: [new PerceptionSystem({ ...CONFIG.perception, maxMateCandidates: 3 })] });
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    // Five males in range, one female, and one juvenile male.
    for (let i = 0; i < 5; i += 1) spawnAdult(engine, { x: 10 + 0.4 * (i + 1), y: 10, sex: Sexes.MALE });
    spawnAdult(engine, { x: 10.1, y: 10, sex: Sexes.FEMALE });
    spawnAdult(engine, { x: 10.2, y: 10, sex: Sexes.MALE, lifeStage: 'juvenile' });
    engine.step(1);

    const perceived = engine.world.perception.get(her);
    assert.equal(perceived.mateCandidates.length, 3, 'capped at maxMateCandidates');
    for (const seen of perceived.mateCandidates) {
      const other = engine.world.entities.get(seen.id);
      assert.equal(other.sex, Sexes.MALE, 'opposite sex only');
      assert.equal(other.lifeStage, 'adult', 'adults only');
    }
    const distances = perceived.mateCandidates.map((c) => c.distance);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b), 'nearest first');
  });

  test('a ready chooser heads for the best candidate it can see', () => {
    const engine = sandbox({
      systems: [
        new PerceptionSystem(CONFIG.perception),
        new DecisionSystem({
          ...CONFIG.decision,
          foodMinLevel: CONFIG.perception.foodMinLevel,
          reproduction: CONFIG.reproduction,
        }),
      ],
      // No vegetation, so nothing outranks looking for a mate.
      config: { vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 } },
    });
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    const runt = spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 0.75 }) });
    const prize = spawnAdult(engine, { x: 13, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 1.25 }) });
    engine.step(1);

    const she = engine.world.entities.get(her);
    assert.equal(she.action, 'seekMate', 'she is looking for a mate');
    const prizeEntity = engine.world.entities.get(prize);
    assert.equal(she.actionTarget.cellX, Math.floor(prizeEntity.x), 'aimed at the better male');
    assert.notEqual(she.actionTarget.cellX, Math.floor(engine.world.entities.get(runt).x));
  });
});

describe('mate choice: pairing', () => {
  test('only an opposite-sex pair mates', () => {
    for (const [a, b] of [
      [Sexes.FEMALE, Sexes.FEMALE],
      [Sexes.MALE, Sexes.MALE],
      [null, null],
      [Sexes.FEMALE, null],
    ]) {
      const engine = repro({ acceptanceThreshold: 0 });
      const first = spawnAdult(engine, { x: 10, y: 10, sex: a });
      const second = spawnAdult(engine, { x: 11, y: 10, sex: b });
      engine.step(5);
      assert.equal(engine.world.entities.get(first).gestationUntil, null, `${a}+${b} did not pair`);
      assert.equal(engine.world.entities.get(second).gestationUntil, null);
    }
  });

  test('the female gestates, even when the male has the lower id', () => {
    const engine = repro({ acceptanceThreshold: 0 });
    // He is spawned first, so he holds the lower id — under the pre-Step-22
    // rule ("the lower id gestates") this would have made him pregnant.
    const him = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.MALE });
    const her = spawnAdult(engine, { x: 11, y: 10, sex: Sexes.FEMALE });
    assert.ok(him < her, 'the male really does have the lower id');
    engine.step(1);
    assert.equal(engine.world.entities.get(him).gestationUntil, null, 'he does not gestate');
    assert.ok(engine.world.entities.get(her).gestationUntil > 0, 'she does');
    assert.equal(engine.world.entities.get(her).pendingMateId, him);
  });

  test('a female takes the best male present, not the nearest', () => {
    // One suitor at a time is the case where *her* preference is the only
    // thing operating. With two males present, Step 23's male–male contest
    // runs first and decides who she is offered at all — see the pipeline test
    // below, and `#chooseMate` in the decision system for the steering half.
    const engine = repro({ acceptanceThreshold: 0 });
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    const runt = spawnAdult(engine, { x: 10.2, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 0.75 }), bodyMass: 20 });
    const prize = spawnAdult(engine, { x: 11.5, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 1.25 }), bodyMass: 40 });
    engine.step(1);
    assert.equal(engine.world.entities.get(her).pendingMateId, prize, 'she paired with the better male');
    assert.equal(engine.world.entities.get(runt).lastMatedTick, null, 'the nearer one went unmated');
  });

  test('male–male competition decides who she is offered, and she still chooses', () => {
    // The Step 23 interaction, pinned deliberately: contests gate *access* and
    // female choice gates *acceptance*, and neither silently overrides the
    // other. The first cut of this suite assumed choice alone decided it, and
    // the assertion broke the moment contests landed — which is the honest
    // signal that the pipeline had grown a stage, not that either stage is wrong.
    const engine = repro();
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    // Heavier ⇒ more dominant, and bigger ⇒ more attractive: the same animal
    // wins both stages, so acceptance is the outcome.
    const strong = spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, bodyMass: 44, genome: genomeWith({ size: 1.3 }) });
    const weak = spawnAdult(engine, { x: 10.4, y: 10, sex: Sexes.MALE, bodyMass: 18, genome: genomeWith({ size: 0.7 }) });
    const before = engine.events.lastSeq;
    engine.step(1);

    const contested = engine.eventsSince(before).find((e) => e.type === 'entity.contested');
    assert.ok(contested, 'the rivals contested');
    assert.equal(contested.winnerId, strong, 'the heavier animal won access');
    assert.ok(contested.dominance !== contested.opponentDominance, 'and the scores say why');
    assert.equal(engine.world.entities.get(weak).lastContestTick, 1, 'the loser was driven off');
    assert.equal(engine.world.entities.get(her).pendingMateId, strong, 'she then accepted the winner');
  });

  test('a poor male is rejected where a good one is accepted, at the same standard', () => {
    const setup = (size) => {
      const engine = repro();
      const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
      spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size }) });
      engine.step(1);
      return engine.world.entities.get(her).lastCourtship;
    };
    const poor = setup(0.7);
    const good = setup(1.35);
    assert.equal(poor.accepted, false, 'the poor male is turned down');
    assert.equal(good.accepted, true, 'the good one is not');
    assert.ok(good.quality > poor.quality);
    assert.ok(Math.abs(good.threshold - poor.threshold) < 1e-9, 'both were held to the same standard');
  });

  test('choosiness costs time: a picky female waits longer for the same male', () => {
    const waitFor = (choosiness) => {
      const engine = repro();
      const her = spawnAdult(engine, {
        x: 10,
        y: 10,
        sex: Sexes.FEMALE,
        traits: { ...expressGenome(genomeWith()), choosiness },
      });
      // A male who is nothing special — the interesting case, since a superb
      // one would be taken instantly by anyone.
      spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, energy: GRAZER.maxEnergy * 0.85 });
      for (let t = 1; t <= 500; t += 1) {
        engine.step(1);
        if (engine.world.entities.get(her).lastMatedTick !== null) return t;
      }
      return Infinity;
    };
    const picky = waitFor(1.3);
    const easy = waitFor(0.7);
    assert.ok(easy < picky, `the less choosy female mates sooner (${easy} vs ${picky} ticks)`);
    assert.ok(Number.isFinite(picky), 'but the choosy one still mates — the standard decays');
  });

  test('nobody holds out forever: even a poor male is eventually accepted', () => {
    const engine = repro({ choosinessPatienceTicks: 100 });
    const her = spawnAdult(engine, {
      x: 10,
      y: 10,
      sex: Sexes.FEMALE,
      traits: { ...expressGenome(genomeWith()), choosiness: 1.5 },
    });
    spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 0.6 }), energy: 60 });
    engine.step(1);
    assert.equal(engine.world.entities.get(her).lastCourtship.accepted, false, 'rejected at first');
    engine.step(150);
    assert.ok(engine.world.entities.get(her).lastMatedTick !== null, 'accepted once the standard ran out');
  });

  test('the search clock starts when she becomes receptive and stops when she is not', () => {
    const engine = repro({ acceptanceThreshold: 0, gestationTicks: 5 });
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE, energy: GRAZER.maxEnergy * 0.5 });
    spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE });
    engine.step(1);
    assert.equal(engine.world.entities.get(her).mateSearchSince, null, 'under-fed ⇒ not searching');
    engine.world.entities.get(her).energy = GRAZER.maxEnergy;
    engine.step(1);
    // She is receptive this tick, and (with choice off) mates immediately, which
    // clears the clock again.
    assert.equal(engine.world.entities.get(her).mateSearchSince, null, 'cleared on mating');
    assert.ok(engine.world.entities.get(her).gestationUntil > 0);
  });
});

describe('mate choice: what an observer can see', () => {
  test('a courtship reports the quality, the standard, and the verdict', () => {
    const engine = repro();
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    const him = spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 0.7 }) });
    const before = engine.events.lastSeq;
    engine.step(1);
    const courted = engine.eventsSince(before).find((e) => e.type === 'entity.courted');
    assert.ok(courted, 'entity.courted emitted');
    assert.equal(courted.entityId, her);
    assert.equal(courted.candidateId, him);
    assert.equal(courted.accepted, false);
    assert.ok(courted.quality < courted.threshold, 'the numbers explain the verdict');
  });

  test('re-checking the same male every tick is not re-reported', () => {
    // She reassesses him every tick because her standard is falling — but the
    // log should carry the verdict, not the arithmetic (§1.4 C3: event volume
    // competes for the bounded retention window).
    const engine = repro({ choosinessPatienceTicks: 100_000 });
    spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE, traits: { ...expressGenome(genomeWith()), choosiness: 2 } });
    spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 0.6 }) });
    const before = engine.events.lastSeq;
    engine.step(200);
    const courtships = engine.eventsSince(before).filter((e) => e.type === 'entity.courted');
    assert.equal(courtships.length, 1, `one rejection, not two hundred (got ${courtships.length})`);
  });

  test('the demo keeps courtship volume far below the routine per-tick events', () => {
    // Collected tick by tick, deliberately. Stepping 3000 at once and then
    // asking `eventsSince` measures event **retention**, not emission — the
    // outbox is bounded, so a run that emits 200k movement events has long
    // since trimmed everything but the tail. This test used to do that and
    // passed only because a courtship happened to land in the surviving window;
    // Step 23's alarms and contests shortened that window and it started
    // reporting zero courtships in a run that had 280 of them.
    const engine = createDemoSimulation({ seed: 42 });
    let courtships = 0;
    let routine = 0;
    for (let tick = 0; tick < 3000; tick += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const event of engine.eventsSince(before)) {
        if (event.type === 'entity.courted') courtships += 1;
        if (event.type === 'entity.moved' || event.type === 'entity.fed') routine += 1;
      }
    }
    assert.ok(courtships > 0, 'courtship does happen');
    assert.ok(courtships < 3000, `well under one per tick (${courtships} in 3000)`);
    assert.ok(courtships * 20 < routine, `and far below the routine traffic (${courtships} vs ${routine})`);
  });

  test('inspection exposes the basis of the choice, and hands back copies', () => {
    const engine = repro();
    const her = spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size: 0.7 }) });
    engine.step(1);

    const details = engine.getEntityDetails(her);
    assert.equal(details.sex, Sexes.FEMALE);
    assert.equal(details.mateChoice.preference.trait, 'size', 'what she reads');
    assert.equal(typeof details.mateChoice.choosiness, 'number', 'how hard she weighs it');
    assert.ok(details.mateChoice.threshold > 0, 'the standard she is holding');
    assert.equal(details.mateChoice.searchingTicks, 0);
    assert.equal(details.mateChoice.lastCourtship.accepted, false);

    // Inspection must never hand out a reference into engine state.
    details.mateChoice.lastCourtship.accepted = true;
    assert.equal(engine.world.entities.get(her).lastCourtship.accepted, false);
  });

  test('sex rides in bulk snapshots; the rest of mate choice does not', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(50);
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('sex'));
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const animal = snapshot.entities.find((e) => e.kind === 'animal');
    assert.ok(SEXES.includes(animal.sex), 'every animal reports a sex');
    for (const entity of snapshot.entities) {
      assert.ok(!('mateChoice' in entity), 'preference detail stays inspection-only');
      assert.ok(!('lastCourtship' in entity));
      assert.ok(!('mateSearchSince' in entity));
      assert.ok(!('traits' in entity));
    }
  });

  test('a spawn command with an unknown sex is rejected', () => {
    const spawn = (sex) => ({
      type: CommandTypes.ENTITY_SPAWN,
      entity: { kind: 'animal', speciesId: GRAZER.id, x: 1, y: 1, sex },
    });
    assert.equal(validateCommand(spawn(Sexes.FEMALE)).ok, true);
    assert.equal(validateCommand(spawn(undefined)).ok, true, 'omitting it is allowed');
    assert.equal(validateCommand(spawn(null)).ok, true);
    const bad = validateCommand(spawn('femal'));
    assert.equal(bad.ok, false);
    assert.equal(bad.errors[0].path, 'entity.sex');
  });
});

describe('mate choice: metrics see the sexes', () => {
  test('sex counts and per-sex differentials match a brute-force pass', () => {
    const engine = sandbox();
    // A rigged population: among males, only the big ones have bred; among
    // females, only the small ones have. So the differential must come out
    // positive for males and negative for females — which a pooled figure
    // would largely cancel out, and which is exactly why it is split.
    const make = (sex, size, offspring) =>
      spawnAdult(engine, { sex, genome: genomeWith({ size }), offspring, x: 5, y: 5 });
    make(Sexes.MALE, 1.3, [1]);
    make(Sexes.MALE, 1.2, [2]);
    make(Sexes.MALE, 0.8, []);
    make(Sexes.MALE, 0.7, []);
    make(Sexes.FEMALE, 0.8, [3]);
    make(Sexes.FEMALE, 1.3, []);

    const report = computeMetrics(engine.world, { tick: 10, windowTicks: 100 });
    const grazer = report.species.find((s) => s.speciesId === GRAZER.id);
    assert.deepEqual(grazer.sexes, { female: 2, male: 4 });

    const animals = [...engine.world.entities.all()];
    const mean = (list) => list.reduce((a, e) => a + e.traits.size, 0) / list.length;
    for (const sex of SEXES) {
      const adults = animals.filter((e) => e.sex === sex);
      const breeders = adults.filter((e) => e.offspring.length > 0);
      const expected = mean(breeders) - mean(adults);
      const actual = grazer.traits.size.selectionDifferentialBySex[sex];
      assert.ok(Math.abs(actual - expected) < 1e-9, `${sex} differential ${actual} vs ${expected}`);
    }
    assert.ok(grazer.traits.size.selectionDifferentialBySex.male > 0, 'big males bred');
    assert.ok(grazer.traits.size.selectionDifferentialBySex.female < 0, 'small females bred');
  });

  test('a sex with no breeders reports null rather than a misleading zero', () => {
    const engine = sandbox();
    spawnAdult(engine, { sex: Sexes.MALE, offspring: [1], x: 5, y: 5 });
    spawnAdult(engine, { sex: Sexes.FEMALE, x: 6, y: 5 });
    const report = computeMetrics(engine.world, { tick: 10, windowTicks: 100 });
    const grazer = report.species.find((s) => s.speciesId === GRAZER.id);
    assert.equal(grazer.traits.size.selectionDifferentialBySex.female, null);
    assert.equal(typeof grazer.traits.size.selectionDifferentialBySex.male, 'number');
  });
});

describe('mate choice: determinism and persistence', () => {
  test('assessment consumes no randomness at all', () => {
    // Quality is a pure function of traits and condition, so a run in which a
    // female rejects a male must leave every stream exactly where a run in
    // which she accepts one does. Otherwise choice would shift every other
    // system's sequence — the fixed-draw-budget rule, applied to a system whose
    // budget is zero.
    const streamsAfter = (size) => {
      const engine = repro();
      spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
      spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE, genome: genomeWith({ size }) });
      engine.step(1);
      return engine.serializeRandomStreams();
    };
    assert.deepEqual(streamsAfter(0.7), streamsAfter(1.35), 'rejecting and accepting cost the same draws');
  });

  test('a birth draws its sex from the sex stream, leaving genetics untouched', () => {
    const engine = repro({ acceptanceThreshold: 0, gestationTicks: 2 });
    spawnAdult(engine, { x: 10, y: 10, sex: Sexes.FEMALE });
    spawnAdult(engine, { x: 11, y: 10, sex: Sexes.MALE });
    engine.step(1);
    const geneticsBefore = engine.randomStream('genetics').getState();
    const sexBefore = engine.randomStream('sex').getState();
    engine.step(3); // birth
    const child = [...engine.world.entities.all()].find((e) => e.parents.length === 2);
    assert.ok(child, 'a child was born');
    assert.ok(SEXES.includes(child.sex), 'and it has a sex');
    assert.notEqual(engine.randomStream('sex').getState(), sexBefore, 'drawn from the sex stream');
    assert.notEqual(engine.randomStream('genetics').getState(), geneticsBefore, 'inheritance still on its own');
  });

  test('the demo stays deterministic with sexes and choice in play', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(1500);
    b.step(1500);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('sex, search clock, and last courtship survive save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(2500);
    const saved = captureSimulationState(engine);
    const restored = restoreDemoSimulation(saved);

    const courted = [...engine.world.entities.all()].find((e) => e.lastCourtship !== null);
    assert.ok(courted, 'the demo produced at least one courtship to round-trip');
    const copy = restored.world.entities.get(courted.id);
    assert.equal(copy.sex, courted.sex);
    assert.equal(copy.mateSearchSince, courted.mateSearchSince);
    assert.deepEqual(copy.lastCourtship, courted.lastCourtship);

    engine.step(300);
    restored.step(300);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });
});

describe('mate choice: the sexual-selection sandbox', () => {
  /**
   * The demonstration scenario. A world where the only thing that varies is
   * size, and the only thing acting on it is who gets chosen: plenty of food
   * (so natural selection is not also pushing size around through starvation),
   * no predators, no seasons, fast generations.
   *
   * The measurement is deliberately **comparative**: the same world is run with
   * choice on and with choice off (`acceptanceThreshold: 0`, i.e. the
   * pre-Step-22 rule of taking whoever is there). Asserting only that size rose
   * would prove nothing — size drifts, and a run is one sample. Asserting that
   * it rose *more with choice than without* isolates the mechanism, and the
   * per-sex differential says which sex it acted on. Direction only, as the
   * step asks; no magnitudes are pinned.
   *
   * 3200 ticks is deliberate, and the reason is Step 21's: the signal comes
   * from *generations elapsed*, not from population size. With no predators and
   * abundant food this world grows without bound — 60 founders reach ~570 by
   * tick 3200 but ~3300 by 6000, and the run time goes 5s → 237s for a measured
   * effect that is already unambiguous at three generations (size +0.074 with
   * choice against +0.021 without). Running longer buys nothing but minutes.
   */
  function selectionRun({ acceptance, seed, ticks = 3200 }) {
    const engine = createDemoSimulation({
      seed,
      config: {
        world: { width: 48, height: 48 },
        demo: { founding: [{ speciesId: 'herbivore.gazelle', count: 60 }] },
        // Abundant, fast-growing food and no weather: the point is to leave
        // mate choice as the loudest thing in the world, not to model a meadow.
        vegetation: { capacity: 14, growthRate: 0.3, minFertility: 0.9, initialFraction: 1 },
        environment: { ticksPerYear: 8000, temperatureAmplitude: 0, meanTemperature: 14 },
        // Hold the crowding cap off in this sandbox, the way weather and forage
        // variation are held off: the selection differential is a knife-edge
        // metric (§1.4 A31), and the demo's default per-cell cap is an unrelated
        // movement confound that should not be measured alongside mate choice.
        locomotion: { maxOccupantsPerCell: null },
        aging: { maturityAge: 300, juvenileUntil: 120, subadultUntil: 300, adultUntil: 2200, maxAge: 3000 },
        reproduction: { gestationTicks: 200, cooldownTicks: 400, minEnergyFraction: 0.6, acceptanceThreshold: acceptance },
        // Variation concentrated in the displayed trait, so nothing else drifts
        // into the measurement (§1.4 D5: make sure the fixture can show it).
        traits: { spread: { size: 0.3, speed: 0.02, metabolicEfficiency: 0.02, boldness: 0.05, caution: 0.05, exploration: 0.05, reproductiveInvestment: 0.05, choosiness: 0.2 } },
      },
    });
    const sizeOf = () => {
      const living = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive);
      return living.reduce((a, e) => a + genotypeOf(e.genome).size, 0) / living.length;
    };
    const before = sizeOf();
    const differentials = [];
    for (let t = 0; t < ticks; t += 1) {
      engine.step(1);
      if (t > 800 && t % 400 === 0) {
        const report = computeMetrics(engine.world, { tick: t, windowTicks: 1000 });
        const d = report.species.find((s) => s.speciesId === GRAZER.id)?.traits.size.selectionDifferentialBySex;
        if (typeof d?.male === 'number') differentials.push(d);
      }
    }
    const mean = (pick) => differentials.reduce((a, d) => a + pick(d), 0) / (differentials.length || 1);
    return { before, after: sizeOf(), male: mean((d) => d.male), female: mean((d) => d.female) };
  }

  test('preferring large males makes the population larger, and choice is what does it', () => {
    const chosen = selectionRun({ acceptance: CONFIG.reproduction.acceptanceThreshold, seed: 42 });
    const control = selectionRun({ acceptance: 0, seed: 42 });

    assert.ok(chosen.after > chosen.before, `size rose under mate choice (${chosen.before.toFixed(3)} → ${chosen.after.toFixed(3)})`);
    assert.ok(
      chosen.after - chosen.before > control.after - control.before,
      `and rose further than without it (${(chosen.after - chosen.before).toFixed(4)} vs ${(control.after - control.before).toFixed(4)})`,
    );
    // The signature of *sexual* selection: it acts on the sex being chosen.
    assert.ok(chosen.male > 0, `breeding males are above average for size (S=${chosen.male.toFixed(4)})`);
    assert.ok(chosen.male > chosen.female, 'more so than breeding females, who are chosen for nothing');
    assert.ok(chosen.male > control.male, `and more than without choice (${chosen.male.toFixed(4)} vs ${control.male.toFixed(4)})`);
  });
});
