import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { DiseaseSystem } from '../src/simulation/systems/DiseaseSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { isReproductivelyReady } from '../src/simulation/systems/ReproductionSystem.js';
import {
  DiseaseStates,
  clearImmunity,
  diseaseSeverity,
  infect,
  isInfectious,
  isSusceptible,
  isSymptomatic,
  recover,
} from '../src/simulation/disease/disease.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { computeMetrics } from '../src/simulation/metrics/metrics.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.gazelle');
const STALKER = getSpecies('predator.stalker');

function genomeWith(overrides = {}) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [overrides[locus] ?? 1, overrides[locus] ?? 1]]));
}

function sandbox({ seed = 4, config = {} } = {}) {
  return new SimulationEngine({
    seed,
    config: { world: { width: 64, height: 64 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 }, ...config },
  });
}

function spawn(engine, overrides = {}) {
  const species = overrides.speciesId === STALKER.id ? STALKER : GRAZER;
  const genome = overrides.genome ?? genomeWith();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: species.id,
    heading: 0,
    lifeStage: 'adult',
    sex: Sexes.FEMALE,
    genome,
    traits: expressGenome(genome),
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy,
    maxHealth: species.maxHealth,
    health: species.maxHealth,
    maxHydration: species.maxHydration,
    hydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** Disease only, with spillover off so tests control every infection. */
function diseaseEngine(params = {}, config = {}) {
  const engine = sandbox({ config });
  engine.registerSystem(new DiseaseSystem({ ...CONFIG.disease, spilloverChance: 0, ...params }));
  return engine;
}

describe('disease: the compartments', () => {
  test('an animal starts susceptible, and the predicates agree', () => {
    const animal = { diseaseState: DiseaseStates.SUSCEPTIBLE };
    assert.equal(isSusceptible(animal), true);
    assert.equal(isInfectious(animal), false);
    assert.equal(isSymptomatic(animal), false);
  });

  test('an incubating animal is infectious and looks perfectly healthy', () => {
    // The load-bearing choice of the whole step. If only visibly sick animals
    // could transmit, avoidance would be a complete defence and an outbreak
    // would be a non-event.
    const animal = { diseaseState: DiseaseStates.SUSCEPTIBLE };
    infect(animal, 100, 250);
    assert.equal(animal.diseaseState, DiseaseStates.INCUBATING);
    assert.equal(isInfectious(animal), true, 'it spreads');
    assert.equal(isSymptomatic(animal), false, 'and shows nothing');
    assert.equal(diseaseSeverity(animal, 0.5), 0, 'so it is not impaired either');
    assert.equal(animal.diseaseUntil, 350);
  });

  test('a symptomatic animal is infectious, visible, and impaired', () => {
    const animal = { diseaseState: DiseaseStates.SYMPTOMATIC };
    assert.equal(isInfectious(animal), true);
    assert.equal(isSymptomatic(animal), true);
    assert.equal(diseaseSeverity(animal, 0.5), 0.5);
  });

  test('recovery grants immunity, and immunity lapses', () => {
    const animal = { diseaseState: DiseaseStates.SYMPTOMATIC };
    recover(animal, 500, 3000);
    assert.equal(animal.diseaseState, DiseaseStates.RECOVERED);
    assert.equal(isSusceptible(animal), false, 'immune for now');
    assert.equal(isInfectious(animal), false);
    assert.equal(animal.diseaseUntil, 3500);
    clearImmunity(animal, 3500);
    assert.equal(isSusceptible(animal), true, 'and susceptible again — outbreaks can recur');
  });

  test('you cannot catch what you already have, or are immune to', () => {
    for (const state of [DiseaseStates.INCUBATING, DiseaseStates.SYMPTOMATIC, DiseaseStates.RECOVERED]) {
      const animal = { diseaseState: state };
      assert.equal(infect(animal, 1, 250), false, `${state} is not susceptible`);
      assert.equal(animal.diseaseState, state, 'and is left alone');
    }
  });
});

describe('disease: progression', () => {
  test('an animal walks the whole course on schedule', () => {
    const engine = diseaseEngine({ incubationTicks: 20, symptomaticTicks: 30, immunityTicks: 40, mortalityPerTick: 0, sickHealthDrain: 0 });
    const id = spawn(engine, { x: 10, y: 10 });
    const animal = engine.world.entities.get(id);
    infect(animal, 0, 20);

    engine.step(19);
    assert.equal(animal.diseaseState, DiseaseStates.INCUBATING, 'still incubating at 19');
    engine.step(1);
    assert.equal(animal.diseaseState, DiseaseStates.SYMPTOMATIC, 'symptoms at 20');
    engine.step(29);
    assert.equal(animal.diseaseState, DiseaseStates.SYMPTOMATIC);
    engine.step(1);
    assert.equal(animal.diseaseState, DiseaseStates.RECOVERED, 'recovered at 50');
    engine.step(40);
    assert.equal(animal.diseaseState, DiseaseStates.SUSCEPTIBLE, 'and susceptible again at 90');
  });

  test('being ill costs health, and enough of it kills', () => {
    const engine = diseaseEngine({ incubationTicks: 1, symptomaticTicks: 100_000, mortalityPerTick: 0, sickHealthDrain: 1 });
    const id = spawn(engine, { x: 10, y: 10 });
    const animal = engine.world.entities.get(id);
    infect(animal, 0, 1);
    engine.step(2);
    assert.equal(animal.diseaseState, DiseaseStates.SYMPTOMATIC);
    const health = animal.health;
    engine.step(10);
    assert.ok(animal.health < health, 'losing ground while ill');
    engine.step(200);
    assert.equal(animal.alive, false, 'and it can kill');
    assert.equal(animal.deathCause, 'disease');
    assert.equal(animal.kind, 'carcass', 'through the same carcass path as everything else');
  });

  test('the draw budget per sick tick is fixed, however it turns out', () => {
    const streamAfter = (mortalityPerTick) => {
      const engine = diseaseEngine({ incubationTicks: 1, symptomaticTicks: 500, mortalityPerTick, sickHealthDrain: 0 });
      const id = spawn(engine, { x: 10, y: 10 });
      infect(engine.world.entities.get(id), 0, 1);
      engine.step(5);
      return engine.serializeRandomStreams().disease;
    };
    assert.equal(streamAfter(0), streamAfter(1e-9), 'surviving and (nearly) dying cost the same draws');
  });
});

describe('disease: transmission', () => {
  test('it spreads to a neighbour in contact range, and names the source', () => {
    const engine = diseaseEngine({ transmissionChance: 1, transmissionRadius: 3 });
    const carrier = spawn(engine, { x: 10, y: 10 });
    const neighbour = spawn(engine, { x: 11, y: 10 });
    infect(engine.world.entities.get(carrier), 0, CONFIG.disease.incubationTicks);
    const before = engine.events.lastSeq;
    engine.step(1);

    assert.equal(engine.world.entities.get(neighbour).diseaseState, DiseaseStates.INCUBATING);
    const infected = engine.eventsSince(before).find((e) => e.type === 'entity.infected');
    assert.equal(infected.entityId, neighbour);
    assert.equal(infected.sourceId, carrier, 'the chain is traceable');
  });

  test('…and not beyond it', () => {
    const engine = diseaseEngine({ transmissionChance: 1, transmissionRadius: 3 });
    const carrier = spawn(engine, { x: 10, y: 10 });
    const distant = spawn(engine, { x: 40, y: 40 });
    infect(engine.world.entities.get(carrier), 0, CONFIG.disease.incubationTicks);
    engine.step(20);
    assert.equal(engine.world.entities.get(distant).diseaseState, DiseaseStates.SUSCEPTIBLE);
  });

  test('an incubating animal infects others while looking healthy', () => {
    // Stated as its own test because it is the property everything else about
    // this step depends on.
    const engine = diseaseEngine({ transmissionChance: 1, transmissionRadius: 3, incubationTicks: 500 });
    const carrier = spawn(engine, { x: 10, y: 10 });
    const neighbour = spawn(engine, { x: 11, y: 10 });
    infect(engine.world.entities.get(carrier), 0, 500);
    engine.step(1);
    assert.equal(isSymptomatic(engine.world.entities.get(carrier)), false, 'nothing to see');
    assert.equal(engine.world.entities.get(neighbour).diseaseState, DiseaseStates.INCUBATING, 'and yet');
  });

  test('it does not cross species', () => {
    const engine = diseaseEngine({ transmissionChance: 1, transmissionRadius: 3 });
    const carrier = spawn(engine, { x: 10, y: 10 });
    const predator = spawn(engine, { x: 11, y: 10, speciesId: STALKER.id });
    infect(engine.world.entities.get(carrier), 0, CONFIG.disease.incubationTicks);
    engine.step(20);
    assert.equal(engine.world.entities.get(predator).diseaseState, DiseaseStates.SUSCEPTIBLE);
  });

  test('the immune and the already-infected are not re-infected', () => {
    const engine = diseaseEngine({ transmissionChance: 1, transmissionRadius: 3 });
    const carrier = spawn(engine, { x: 10, y: 10 });
    const immune = spawn(engine, { x: 11, y: 10 });
    infect(engine.world.entities.get(carrier), 0, CONFIG.disease.incubationTicks);
    recover(engine.world.entities.get(immune), 0, 5000);
    engine.step(20);
    assert.equal(engine.world.entities.get(immune).diseaseState, DiseaseStates.RECOVERED);
  });

  test('with nobody infectious, the cost does not scale with the population', () => {
    // The performance shape: only *infectious* animals query the grid, so
    // transmission costs track prevalence rather than population (§1.4 C6 is
    // already carrying two full neighbour walks; this step deliberately did not
    // add a third).
    //
    // Asserted through the stream rather than by timing: if transmission spent
    // draws per animal, two populations of very different sizes would end up in
    // different stream states after the same number of ticks. They do not,
    // because with nobody infectious the only draws are the two flat ones
    // spillover spends per tick — regardless of how many animals exist.
    const streamAfter = (count) => {
      const engine = diseaseEngine();
      for (let i = 0; i < count; i += 1) spawn(engine, { x: 5 + (i % 20) * 2, y: 5 + Math.floor(i / 20) * 2 });
      engine.step(50);
      return engine.serializeRandomStreams().disease;
    };
    assert.equal(streamAfter(20), streamAfter(400), 'twenty animals and four hundred cost the same');
  });

  test('spillover reintroduces the disease at a flat two draws a tick', () => {
    const engine = sandbox();
    engine.registerSystem(new DiseaseSystem({ ...CONFIG.disease, spilloverChance: 1 }));
    for (let i = 0; i < 5; i += 1) spawn(engine, { x: 10 + i * 10, y: 10 });
    engine.step(1);
    const infected = [...engine.world.entities.all()].filter((e) => !isSusceptible(e));
    assert.equal(infected.length, 1, 'exactly one fresh case, however big the population');
  });
});

describe('disease: what being ill costs', () => {
  test('a symptomatic animal moves slower', () => {
    const distanceFor = (sick) => {
      const engine = sandbox({ config: { vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 } } });
      engine.registerSystem(new MovementSystem({ ...CONFIG.locomotion, diseaseSpeedPenalty: CONFIG.disease.speedPenalty }));
      const id = spawn(engine, { x: 10, y: 10 });
      const animal = engine.world.entities.get(id);
      if (sick) animal.diseaseState = DiseaseStates.SYMPTOMATIC;
      animal.moveIntent = { heading: 0, ttl: 50, moving: true, sprint: false };
      const start = animal.x;
      engine.step(10);
      return animal.x - start;
    };
    assert.ok(distanceFor(true) < distanceFor(false), 'illness slows it');
  });

  test('a symptomatic animal does not breed; an incubating one does', () => {
    const params = { minEnergyFraction: 0.5, cooldownTicks: 100 };
    const base = {
      kind: 'animal', alive: true, lifeStage: 'adult', gestationUntil: null,
      energy: 100, maxEnergy: 100, lastMatedTick: null, sex: Sexes.FEMALE,
    };
    assert.equal(isReproductivelyReady({ ...base, diseaseState: DiseaseStates.SUSCEPTIBLE }, 500, params), true);
    assert.equal(
      isReproductivelyReady({ ...base, diseaseState: DiseaseStates.INCUBATING }, 500, params),
      true,
      'the disease travels through ordinary life rather than being quarantined by a rule',
    );
    assert.equal(isReproductivelyReady({ ...base, diseaseState: DiseaseStates.SYMPTOMATIC }, 500, params), false);
  });

  test('a herd leaves a visibly sick member behind, but embraces an incubating one', () => {
    // Social avoidance without a new movement action: the sick animal is simply
    // not counted in the herd's centre of mass, so the group's pull leads away
    // from it. And because it only works on *symptoms*, the carrier that looks
    // fine is still in the middle of the herd — which is how the outbreak
    // spreads at all.
    const engine = sandbox();
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new SocialSystem(CONFIG.social));
    const healthy = spawn(engine, { x: 20, y: 20 });
    for (let i = 0; i < 3; i += 1) spawn(engine, { x: 21 + i * 0.5, y: 20 });
    const sick = spawn(engine, { x: 20.5, y: 20 });
    const hidden = spawn(engine, { x: 20.5, y: 20.5 });
    engine.world.entities.get(sick).diseaseState = DiseaseStates.SYMPTOMATIC;
    engine.world.entities.get(hidden).diseaseState = DiseaseStates.INCUBATING;
    engine.step(2);

    const summary = engine.world.social.get(healthy);
    const counted = summary.groupmates;
    // Five neighbours exist; the symptomatic one is not among those counted.
    assert.equal(counted, 4, `the sick animal is not part of the herd (counted ${counted} of 5)`);
    assert.equal(engine.world.social.get(sick).groupmates, 5, 'though it can still see them');
  });
});

describe('disease: condition recovery (§1.4 A20)', () => {
  test('health lost to anything at all now heals, not just wounds', () => {
    // The asymmetry this closes: injuries healed from Step 17, but health lost
    // to thirst never came back, so a once-thirsty animal carried the damage
    // for life while a mauled one mended.
    const engine = diseaseEngine();
    const id = spawn(engine, { x: 10, y: 10, health: 40 });
    const animal = engine.world.entities.get(id);
    assert.equal(animal.injuries.length, 0, 'no wound — this is bare damage');
    engine.step(100);
    assert.ok(animal.health > 40, `it mends (${animal.health.toFixed(1)})`);
    engine.step(5000);
    assert.equal(animal.health, animal.maxHealth, 'all the way back, eventually');
  });

  test('a starving animal does not mend, and a sick one does not either', () => {
    const engine = diseaseEngine();
    const hungry = spawn(engine, { x: 10, y: 10, health: 40, energy: 5 });
    const ill = spawn(engine, { x: 30, y: 30, health: 40 });
    engine.world.entities.get(ill).diseaseState = DiseaseStates.SYMPTOMATIC;
    engine.world.entities.get(ill).diseaseUntil = 100_000;
    engine.step(200);
    assert.equal(engine.world.entities.get(hungry).health, 40, 'mending is work, and it cannot afford it');
    assert.ok(engine.world.entities.get(ill).health <= 40, 'and illness is not the time for it');
  });
});

describe('disease: protocol, metrics, and persistence', () => {
  test('the compartment rides in bulk snapshots; the detail does not', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(800);
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('diseaseState'));
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.ok(!('disease' in entity), 'the detail stays inspection-only');
      assert.ok(!('diseaseUntil' in entity));
    }
    const states = new Set(snapshot.entities.map((e) => e.diseaseState));
    assert.ok(states.has('susceptible'), 'the demo projects compartments');
  });

  test('inspection spells out infectious separately from symptomatic', () => {
    const engine = diseaseEngine();
    const id = spawn(engine, { x: 10, y: 10 });
    infect(engine.world.entities.get(id), 0, 500);
    engine.step(1);
    const details = engine.getEntityDetails(id);
    assert.equal(details.disease.state, DiseaseStates.INCUBATING);
    assert.equal(details.disease.infectious, true);
    assert.equal(details.disease.symptomatic, false, 'the two are not the same, and the protocol says so');
    assert.equal(details.disease.severity, 0);
  });

  test('metrics report the outbreak curve, checked against the entities', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1500);
    const report = computeMetrics(engine.world, { tick: 1500, windowTicks: 500 });
    const grazer = report.species.find((s) => s.speciesId === GRAZER.id);
    const living = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive && e.speciesId === GRAZER.id);
    for (const state of Object.values(DiseaseStates)) {
      assert.equal(grazer.disease[state], living.filter((e) => e.diseaseState === state).length, state);
    }
    assert.equal(
      grazer.disease.infectious,
      living.filter((e) => isInfectious(e)).length,
      'infectious counts the invisible carriers too — reporting only the visible would understate it',
    );
  });

  test('the demo stays deterministic with disease in play', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(1200);
    b.step(1200);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('disease state survives save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1500);
    const saved = captureSimulationState(engine);
    const restored = restoreDemoSimulation(saved);

    const carrier = [...engine.world.entities.all()].find((e) => e.diseaseState !== DiseaseStates.SUSCEPTIBLE);
    assert.ok(carrier, 'the demo had somebody mid-course to round-trip');
    const copy = restored.world.entities.get(carrier.id);
    assert.equal(copy.diseaseState, carrier.diseaseState);
    assert.equal(copy.diseaseUntil, carrier.diseaseUntil);

    engine.step(300);
    restored.step(300);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });
});

describe('disease: the outbreak sandbox', () => {
  /**
   * The demonstration scenario: a dense group and one infected animal. The
   * assertions are the *shape* of an epidemic, not counts — it spreads beyond
   * patient zero, peaks, and then burns out as the survivors become immune.
   */
  function outbreakWorld() {
    const engine = sandbox({
      seed: 12,
      config: { vegetation: { ...CONFIG.vegetation, initialFraction: 1 } },
    });
    engine.registerSystem(
      new DiseaseSystem({ ...CONFIG.disease, spilloverChance: 0, mortalityPerTick: 0.0002, sickHealthDrain: 0.02 }),
    );
    // A tight cluster, so contact is guaranteed and the outbreak is about the
    // disease rather than about whether anyone met anyone.
    const ids = [];
    for (let i = 0; i < 24; i += 1) ids.push(spawn(engine, { x: 20 + (i % 6) * 0.8, y: 20 + Math.floor(i / 6) * 0.8 }));
    infect(engine.world.entities.get(ids[0]), 0, CONFIG.disease.incubationTicks);
    return { engine, ids };
  }

  const census = (engine, ids) => {
    const counts = { infectious: 0, symptomatic: 0, recovered: 0, susceptible: 0, dead: 0 };
    for (const id of ids) {
      const animal = engine.world.entities.get(id);
      if (!animal || !animal.alive) counts.dead += 1;
      else if (isSymptomatic(animal)) (counts.symptomatic += 1), (counts.infectious += 1);
      else if (isInfectious(animal)) counts.infectious += 1;
      else if (animal.diseaseState === DiseaseStates.RECOVERED) counts.recovered += 1;
      else counts.susceptible += 1;
    }
    return counts;
  };

  test('one case becomes an epidemic, peaks, and burns out', () => {
    const { engine, ids } = outbreakWorld();
    let peakInfectious = 0;
    let everSymptomatic = 0;
    for (let tick = 0; tick < 3000; tick += 1) {
      engine.step(1);
      const now = census(engine, ids);
      peakInfectious = Math.max(peakInfectious, now.infectious);
      everSymptomatic = Math.max(everSymptomatic, now.symptomatic);
    }
    const end = census(engine, ids);

    assert.ok(peakInfectious > 1, `it spread beyond patient zero (peak ${peakInfectious} of ${ids.length})`);
    assert.ok(everSymptomatic > 0, 'and animals visibly sickened');
    assert.ok(end.recovered + end.dead > 1, `the epidemic resolved (${end.recovered} recovered, ${end.dead} dead)`);
    assert.equal(end.symptomatic, 0, 'and burned out rather than running forever');
  });

  test('an isolated animal never catches it, however long the outbreak runs', () => {
    // Locality, asserted where it matters: transmission is contact, not a
    // population-wide roll.
    const { engine } = outbreakWorld();
    const hermit = spawn(engine, { x: 60, y: 60 });
    engine.step(3000);
    assert.equal(engine.world.entities.get(hermit).diseaseState, DiseaseStates.SUSCEPTIBLE);
  });
});
