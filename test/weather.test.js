import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom } from '../src/simulation/random/SeededRandom.js';
import {
  SEASONS,
  WEATHER,
  seasonAt,
  yearProgress,
  baseTemperatureAt,
  describeEnvironment,
  rollWeather,
  thermalStress,
} from '../src/simulation/world/Environment.js';
import { WeatherSystem } from '../src/simulation/systems/WeatherSystem.js';
import { VegetationSystem } from '../src/simulation/systems/VegetationSystem.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { buildFullSnapshot, buildDeltaSnapshot, applyDeltaSnapshot } from '../src/protocol/snapshots.js';

const CONFIG = new SimulationEngine().config;
const ENV = CONFIG.environment;
const GRAZER = getSpecies('herbivore.gazelle');

function sandbox({ seed = 3, size = 44, systems = [], config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: size, height: size }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 }, ...config },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawnGrazer(engine, overrides = {}) {
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
    stamina: GRAZER.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('weather: the seasonal cycle', () => {
  test('the year turns through all four seasons in order and repeats', () => {
    const seen = [];
    for (let i = 0; i < SEASONS.length; i += 1) {
      seen.push(seasonAt(i * (ENV.ticksPerYear / SEASONS.length) + 10, ENV.ticksPerYear));
    }
    assert.deepEqual(seen, [...SEASONS]);
    assert.equal(seasonAt(ENV.ticksPerYear + 10, ENV.ticksPerYear), SEASONS[0], 'the next year starts over');
    assert.ok(yearProgress(ENV.ticksPerYear, ENV.ticksPerYear) < 1e-9, 'the year wraps cleanly');
  });

  test('season is a pure function of the tick, so it needs no stored history', () => {
    for (const tick of [0, 137, 4001, 79_999]) {
      assert.equal(seasonAt(tick, ENV.ticksPerYear), seasonAt(tick, ENV.ticksPerYear));
      assert.equal(
        seasonAt(tick, ENV.ticksPerYear),
        seasonAt(tick + ENV.ticksPerYear * 3, ENV.ticksPerYear),
        'the same point in any year is the same season',
      );
    }
  });

  test('temperature peaks in midsummer and troughs in midwinter', () => {
    const at = (progress) => baseTemperatureAt(progress * ENV.ticksPerYear, ENV);
    const midSummer = at(0.375);
    const midWinter = at(0.875);
    const midSpring = at(0.125);
    const midAutumn = at(0.625);

    assert.ok(midSummer > midSpring && midSummer > midAutumn, 'summer is the warmest');
    assert.ok(midWinter < midSpring && midWinter < midAutumn, 'winter is the coldest');
    assert.ok(Math.abs(midSummer - (ENV.meanTemperature + ENV.temperatureAmplitude)) < 1e-6, 'peak is mean + amplitude');
    assert.ok(Math.abs(midWinter - (ENV.meanTemperature - ENV.temperatureAmplitude)) < 1e-6, 'trough is mean − amplitude');
    // And the seasons those extremes fall in really are named that.
    assert.equal(seasonAt(0.375 * ENV.ticksPerYear, ENV.ticksPerYear), 'summer');
    assert.equal(seasonAt(0.875 * ENV.ticksPerYear, ENV.ticksPerYear), 'winter');
  });
});

describe('weather: spells', () => {
  test('each season draws the weather it should, and only that', () => {
    const random = new SeededRandom(11);
    const byseason = {};
    for (const season of SEASONS) {
      byseason[season] = new Set();
      for (let i = 0; i < 500; i += 1) byseason[season].add(rollWeather(season, random));
    }
    assert.ok(byseason.winter.has('snow'), 'it snows in winter');
    assert.ok(!byseason.summer.has('snow'), 'and never in summer');
    assert.ok(byseason.summer.has('drought'), 'droughts are a summer thing');
    assert.ok(!byseason.winter.has('drought'), 'not a winter one');
    for (const season of SEASONS) {
      for (const weather of byseason[season]) assert.ok(WEATHER.includes(weather), `unknown weather ${weather}`);
    }
  });

  test('one draw per roll, whatever it returns', () => {
    const a = new SeededRandom(5);
    const b = new SeededRandom(5);
    rollWeather('winter', a);
    rollWeather('summer', b); // different odds, same number of draws
    assert.equal(a.getState(), b.getState());
  });

  test('a spell holds, then re-rolls on schedule', () => {
    const engine = sandbox({ systems: [new WeatherSystem({ ...ENV, spellTicks: 50 })] });
    engine.step(1);
    const first = engine.world.environment.weather;
    let changesWithinSpell = 0;
    for (let tick = 2; tick < 50; tick += 1) {
      engine.step(1);
      if (engine.world.environment.weather !== first) changesWithinSpell += 1;
    }
    assert.equal(changesWithinSpell, 0, 'weather holds for the whole spell');
  });

  test('season and weather turns are announced; temperature drift is not', () => {
    const engine = sandbox({ systems: [new WeatherSystem({ ...ENV, spellTicks: 50 })] });
    const before = engine.events.lastSeq;
    engine.step(200);
    const events = engine.eventsSince(before).filter((e) => e.type === 'environment.changed');
    assert.ok(events.length > 0, 'something turned over');
    assert.ok(events.length < 200, 'but not once per tick — temperature drifts silently');
    for (const event of events) {
      assert.ok(SEASONS.includes(event.season));
      assert.ok(WEATHER.includes(event.weather));
      assert.ok(event.season !== event.previousSeason || event.weather !== event.previousWeather);
    }
  });
});

describe('weather: vegetation responds to the season', () => {
  test('the land browns off in winter and greens up again in spring', () => {
    const engine = sandbox({
      size: 32,
      systems: [new WeatherSystem(ENV), new VegetationSystem({ ...CONFIG.vegetation, updateInterval: 1 })],
    });
    // Let it settle at summer capacity first.
    engine.clock.setTick(Math.floor(0.375 * ENV.ticksPerYear));
    engine.step(400);
    const summer = engine.world.vegetation.totalBiomass();

    // Jump to midwinter and let the dieback run.
    engine.clock.setTick(Math.floor(0.875 * ENV.ticksPerYear));
    engine.step(600);
    const winter = engine.world.vegetation.totalBiomass();
    assert.ok(winter < summer * 0.75, `winter is visibly sparser (${Math.round(winter)} vs ${Math.round(summer)})`);

    // And back around to spring.
    engine.clock.setTick(Math.floor(1.125 * ENV.ticksPerYear));
    engine.step(1200);
    assert.ok(engine.world.vegetation.totalBiomass() > winter, 'spring brings it back');
  });

  test('scaling growth alone would not do it — the seasonal ceiling is what causes dieback', () => {
    const engine = sandbox({ size: 24, systems: [new VegetationSystem({ ...CONFIG.vegetation, updateInterval: 1 })] });
    engine.step(300); // settle at full capacity
    const settled = engine.world.vegetation.totalBiomass();

    // A slower growth rate cannot shrink a field already at its ceiling…
    engine.world.vegetation.grow({ growthRate: 0.0001, seedFloor: 0 });
    assert.ok(engine.world.vegetation.totalBiomass() >= settled - 1e-3, 'growth rate alone changes nothing');

    // …but lowering the ceiling does.
    engine.world.vegetation.grow({ growthRate: 0.08, seedFloor: 0.08, capacityScale: 0.3 });
    assert.ok(engine.world.vegetation.totalBiomass() < settled, 'the ceiling is the lever');
  });

  test('growth stays monotonic at full capacity, as it always has', () => {
    const engine = sandbox({ size: 24 });
    let previous = engine.world.vegetation.totalBiomass();
    for (let i = 0; i < 40; i += 1) {
      engine.world.vegetation.grow({ growthRate: 0.08, seedFloor: 0.08 });
      const now = engine.world.vegetation.totalBiomass();
      assert.ok(now >= previous - 1e-5, 'no dieback without a seasonal ceiling');
      previous = now;
    }
  });
});

describe('weather: thermal stress and shelter', () => {
  // A minimal world still needs a species registry: a comfort band is species
  // data (Step 29), so `thermalStress` has nowhere else to read it from.
  const registry = new SpeciesRegistry(SPECIES_DEFINITIONS, new SimulationEngine().config);
  const world = (temperature, sheltered = false) => ({
    environment: { temperature },
    isShelteredAt: () => sheltered,
    species: registry,
  });
  const grazer = { speciesId: GRAZER.id, x: 0, y: 0 };

  test('stress is zero inside the comfort band and grows outside it', () => {
    assert.equal(thermalStress(world((GRAZER.comfortMin + GRAZER.comfortMax) / 2), grazer, 0), 0);
    assert.equal(thermalStress(world(GRAZER.comfortMin - 5), grazer, 0), 5, 'cold');
    assert.equal(thermalStress(world(GRAZER.comfortMax + 3), grazer, 0), 3, 'heat');
  });

  test('cover takes the edge off', () => {
    const exposed = thermalStress(world(GRAZER.comfortMin - 10, false), grazer, 0.55);
    const sheltered = thermalStress(world(GRAZER.comfortMin - 10, true), grazer, 0.55);
    assert.ok(sheltered < exposed, `shelter helps (${sheltered} vs ${exposed})`);
    assert.ok(sheltered > 0, 'but does not make winter disappear');
  });

  test('holding body temperature costs energy, and cold burns an animal out as exposure', () => {
    const engine = sandbox({
      systems: [new MetabolismSystem({ ...CONFIG.metabolism, ...CONFIG.locomotion })],
    });
    const warmId = spawnGrazer(engine, { x: 10, y: 10 });
    const coldId = spawnGrazer(engine, { x: 12, y: 10 });

    engine.world.environment = { ...engine.world.environment, temperature: (GRAZER.comfortMin + GRAZER.comfortMax) / 2 };
    engine.step(20);
    const comfortableSpend = GRAZER.maxEnergy - engine.world.entities.get(warmId).energy;

    engine.world.environment = { ...engine.world.environment, temperature: GRAZER.comfortMin - 20 };
    const before = engine.world.entities.get(coldId).energy;
    engine.step(20);
    const coldSpend = before - engine.world.entities.get(coldId).energy;
    assert.ok(coldSpend > comfortableSpend, `the cold costs more (${coldSpend.toFixed(3)} vs ${comfortableSpend.toFixed(3)})`);

    // ⚠⚠ **This assertion was inverted on 2026-08-01, deliberately** (A67). It
    // used to run a sound adult down to nothing in deep cold and assert it died
    // of `exposure`. That is exactly the behaviour that turned out to be wrong:
    // measured over three demo seeds, exposure killed **47 sound adults** against
    // the world's 14 starvations, none of them in a storm, because
    // thermoregulation was a standing 23–40% tax on the energy budget rather than
    // an event. A healthy adult in bad weather should get hungry, not freeze.
    //
    // So the rule is now conditional on the animal, and both arms are asserted
    // here — a floor the weather cannot charge through for a sound adult, and no
    // floor at all for one that is wounded or ill.
    const soundId = spawnGrazer(engine, { x: 20, y: 10, energy: 0.5 });
    const seq = engine.events.lastSeq;
    engine.step(30);
    const soundDeath = engine.eventsSince(seq).find((e) => e.type === 'entity.died' && e.entityId === soundId);
    assert.ok(soundDeath, 'it still dies — the weather made it burn what it had');
    assert.equal(soundDeath.cause, 'starvation', 'but a sound adult starves rather than freezing');

    // The same cold, the same reserve, on an animal carrying a wound: the thermal
    // charge is multiplied by its frailty and nothing floors it, so this one does
    // freeze — which is where exposure is supposed to bite.
    const hurtId = spawnGrazer(engine, { x: 24, y: 10, energy: 0.5, impairment: 0.5 });
    const seq2 = engine.events.lastSeq;
    engine.step(30);
    const hurtDeath = engine.eventsSince(seq2).find((e) => e.type === 'entity.died' && e.entityId === hurtId);
    assert.ok(hurtDeath, 'the wounded one died too');
    assert.equal(hurtDeath.cause, 'exposure', 'and for it the cold is what did it');
  });

  test('⚠ a wound makes the same weather cost more — exposure worsens what is already wrong', () => {
    const engine = sandbox({
      systems: [new MetabolismSystem({ ...CONFIG.metabolism, ...CONFIG.locomotion })],
    });
    // Well fed, so the sound animal's floor never engages and the two are being
    // compared on the charge itself rather than on the clamp.
    const soundId = spawnGrazer(engine, { x: 10, y: 10 });
    const hurtId = spawnGrazer(engine, { x: 14, y: 10, impairment: 0.5 });
    engine.world.environment = { ...engine.world.environment, temperature: GRAZER.comfortMin - 10 };
    engine.step(20);
    const soundSpend = GRAZER.maxEnergy - engine.world.entities.get(soundId).energy;
    const hurtSpend = GRAZER.maxEnergy - engine.world.entities.get(hurtId).energy;
    assert.ok(hurtSpend > soundSpend, `a wounded animal pays more for the same cold (${hurtSpend.toFixed(3)} vs ${soundSpend.toFixed(3)})`);
  });

  test('⚠ a death is only called exposure when the animal was cold enough to have acted on it', () => {
    // The old `exposureStressThreshold` (0.35 C) fired well below the stress at
    // which an animal will walk to cover (2 C), so 127 709 animal-ticks on seed 1
    // sat in a band where a death was recorded as freezing and the animal had no
    // reason to move. One threshold now serves both.
    const engine = sandbox({
      systems: [new MetabolismSystem({ ...CONFIG.metabolism, ...CONFIG.locomotion })],
    });
    // 1 C below the band: enough to charge for, not enough to act on.
    const id = spawnGrazer(engine, { x: 10, y: 10, energy: 0.5, impairment: 0.5 });
    engine.world.environment = { ...engine.world.environment, temperature: GRAZER.comfortMin - 1 };
    const seq = engine.events.lastSeq;
    engine.step(30);
    const died = engine.eventsSince(seq).find((e) => e.type === 'entity.died' && e.entityId === id);
    assert.ok(died, 'it died');
    assert.equal(died.cause, 'starvation', 'below the threshold the animal acts on, it is not exposure');
  });

  test('an animal out in the weather heads for cover; a comfortable one does not', () => {
    // Terrain is written only at world construction, so this uses the cover the
    // generator actually produced rather than editing the map.
    const build = (temperature) => {
      const engine = sandbox({
        size: 48,
        config: { terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 3 } },
        systems: [
          new PerceptionSystem(CONFIG.perception),
          new DecisionSystem({
            ...CONFIG.decision,
            foodMinLevel: 1,
            shelterWeight: CONFIG.locomotion.shelterWeight,
            shelterStressThreshold: CONFIG.locomotion.shelterStressThreshold,
            shelterStressSpan: CONFIG.locomotion.shelterStressSpan,
            shelterRelief: CONFIG.locomotion.shelterRelief,
          }),
        ],
      });
      // Stand the animal a couple of cells from a real cover cell, but not on it.
      let spot = null;
      for (let cellY = 1; cellY < 47 && !spot; cellY += 1) {
        for (let cellX = 3; cellX < 47 && !spot; cellX += 1) {
          if (engine.world.terrain.codeAt(cellX, cellY) !== TerrainType.COVER) continue;
          if (engine.world.terrain.codeAt(cellX - 2, cellY) === TerrainType.COVER) continue;
          spot = { x: cellX - 2 + 0.5, y: cellY + 0.5 };
        }
      }
      assert.ok(spot, 'the generated world has a cover patch to shelter in');
      const id = spawnGrazer(engine, spot);
      assert.equal(engine.world.isShelteredAt(spot.x, spot.y), false, 'and the animal starts out in the open');
      engine.world.environment = { ...engine.world.environment, temperature };
      engine.step(1);
      return engine.world.entities.get(id);
    };

    const freezing = build(GRAZER.comfortMin - 15);
    assert.equal(freezing.action, 'shelter', 'out in a cold snap, it goes for cover');
    assert.ok(freezing.actionTarget, 'with a target');

    const mild = build((GRAZER.comfortMin + GRAZER.comfortMax) / 2);
    assert.notEqual(mild.action, 'shelter', 'a comfortable animal has no reason to');
  });

  test('⚠⚠ a thicket is shelter, and perception says so — it used to report COVER only', () => {
    // The gap this pins: `world.isShelteredAt` counts cover, **thicket**, and a
    // burrow, and `thermalStress` takes its relief from that — while perception
    // filled the one shelter cue an animal has by testing `code === COVER`. On
    // seed 1 that hid 953 thicket cells behind 615 of cover, and 15.4% of all
    // "cold and out in the open" animal-ticks had sheltering ground inside the
    // animal's own perception radius and were told there was none (D11: one rule,
    // two readers, and the readers disagreed).
    const engine = sandbox({
      size: 48,
      config: { terrain: { lakes: 0, ridges: 0, coverPatchDensity: 0, thickets: 4 } },
      systems: [new PerceptionSystem(CONFIG.perception)],
    });
    const world = engine.world;
    let spot = null;
    for (let cellY = 2; cellY < 46 && !spot; cellY += 1) {
      for (let cellX = 4; cellX < 46 && !spot; cellX += 1) {
        if (world.terrain.codeAt(cellX, cellY) !== TerrainType.THICKET) continue;
        // Stand it two cells off, on open ground, with no cover anywhere near —
        // so the only thing that can fill the cue is the thicket itself.
        if (world.isShelteredAt(cellX - 2 + 0.5, cellY + 0.5)) continue;
        spot = { x: cellX - 2 + 0.5, y: cellY + 0.5 };
      }
    }
    assert.ok(spot, 'the generated world has a thicket to shelter in');
    assert.equal(world.terrain.countByType()[TerrainType.COVER] ?? 0, 0, 'and no cover at all, so the cue can only be the thicket');
    const id = spawnGrazer(engine, spot);
    engine.step(1);
    const perceived = world.perception.get(id);
    assert.ok(perceived.nearestShelter, 'the thicket is reported as shelter');
    assert.equal(
      world.isShelteredAt(perceived.nearestShelter.cellX + 0.5, perceived.nearestShelter.cellY + 0.5),
      true,
      'and what is reported is genuinely shelter by the one definition that decides it',
    );
  });
});

describe('weather: protocol, persistence, and the demo', () => {
  test('the environment rides in full snapshots and deltas, and deltas reproduce it', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(50);
    const first = buildFullSnapshot(engine.getSnapshotData());
    assert.ok(SEASONS.includes(first.environment.season));
    assert.equal(typeof first.environment.temperature, 'number');

    engine.step(1);
    const second = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(first, second, engine.eventsSince(first.lastEventSeq));
    assert.ok(delta.environment, 'the delta carries it');
    assert.deepEqual(applyDeltaSnapshot(first, delta).environment, second.environment, 'and reproduces it exactly');
  });

  test('a full year of the demo shows the vegetation peak and trough in the right seasons', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const bySeason = {};
    for (let tick = 0; tick < ENV.ticksPerYear; tick += 1) {
      engine.step(1);
      if (tick % 100 !== 0) continue;
      const season = engine.world.environment.season;
      (bySeason[season] ??= []).push(engine.world.vegetation.totalBiomass());
    }
    const mean = (season) => bySeason[season].reduce((a, b) => a + b, 0) / bySeason[season].length;
    for (const season of SEASONS) assert.ok(bySeason[season]?.length, `the year passed through ${season}`);
    assert.ok(mean('summer') > mean('winter'), 'summer is the green season');
    assert.ok(mean('autumn') > mean('winter'), 'and winter the sparse one');
    assert.ok(mean('winter') < mean('summer') * 0.75, 'by a visible margin');
  });

  test('the demo puts animals under real thermal stress, and they take cover', () => {
    // Deliberately *not* asserting exposure deaths here. A well-fed animal can
    // pay the thermoregulation bill indefinitely, so whether anyone actually
    // burns out is a population outcome that shifts with every tuning change
    // (§1.4 D1). The lethal path is asserted directly in the controlled
    // sandbox above; what the demo has to show is that the weather bites at
    // all, and that animals respond to it.
    const engine = createDemoSimulation({ seed: 42 });
    let sheltering = 0;
    let peakStress = 0;
    const seasonsSeen = new Set();
    for (let tick = 0; tick < ENV.ticksPerYear * 2; tick += 1) {
      engine.step(1);
      seasonsSeen.add(engine.world.environment.season);
      if (tick % 50 !== 0) continue;
      for (const entity of engine.world.entities.all()) {
        if (!entity.alive) continue;
        if (entity.action === 'shelter') sheltering += 1;
        peakStress = Math.max(peakStress, thermalStress(engine.world, entity, CONFIG.locomotion.shelterRelief));
      }
    }
    assert.equal(seasonsSeen.size, SEASONS.length, 'two full years passed through every season');
    assert.ok(peakStress > 0, `the weather pushed animals outside their comfort band (peak ${peakStress.toFixed(1)}°C)`);
    assert.ok(sheltering > 0, 'and they took cover from it');
  });

  test('the environment survives save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3000);
    const saved = captureSimulationState(engine);
    assert.ok(SEASONS.includes(saved.environment.season), 'the environment is saved');

    const restored = restoreDemoSimulation(saved);
    assert.deepEqual(restored.world.environment, engine.world.environment, 'including the held weather spell');
    engine.step(500);
    restored.step(500);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
    assert.deepEqual(restored.world.environment, engine.world.environment);
  });

  test('weather keeps the demo deterministic, and its stream is independent', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);

    const c = createDemoSimulation({ seed: 55 });
    const d = createDemoSimulation({ seed: 55 });
    const scratch = d.randomStream('unrelated');
    for (let i = 0; i < 50; i += 1) scratch.next();
    c.step(500);
    d.step(500);
    assert.deepEqual(c.world.environment, d.world.environment);
  });
});
