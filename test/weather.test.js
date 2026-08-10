import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom } from '../src/simulation/random/SeededRandom.js';
import {
  PHASES,
  SEASONS,
  WEATHER,
  phaseAt,
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
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import { smallDemo } from './helpers/smallDemo.js';

const CONFIG = new SimulationEngine().config;
const ENV = CONFIG.environment;
const GRAZER = getSpecies('herbivore.gazelle');

function sandbox({ seed = 3, size = 44, systems = [], config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: size, height: size }, terrain: { ...FLAT_TERRAIN }, ...config },
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
  test('the year turns through all four phases in order and repeats', () => {
    const seen = [];
    for (let i = 0; i < PHASES.length; i += 1) {
      seen.push(phaseAt(i * (ENV.ticksPerYear / PHASES.length) + 10, ENV.ticksPerYear));
    }
    assert.deepEqual(seen, [...PHASES]);
    assert.equal(phaseAt(ENV.ticksPerYear + 10, ENV.ticksPerYear), PHASES[0], 'the next year starts over');
    assert.ok(yearProgress(ENV.ticksPerYear, ENV.ticksPerYear) < 1e-9, 'the year wraps cleanly');
  });

  test('a season is a pair of phases — the wet half, then the dry half', () => {
    assert.deepEqual([...SEASONS], ['wet', 'dry']);
    const quarter = ENV.ticksPerYear / PHASES.length;
    const seasonOf = (i) => seasonAt(i * quarter + 10, ENV.ticksPerYear);
    assert.deepEqual([seasonOf(0), seasonOf(1), seasonOf(2), seasonOf(3)], ['wet', 'wet', 'dry', 'dry']);
    // The two are consistent by construction rather than by two tables: every
    // phase resolves to the season its name starts with.
    for (let i = 0; i < PHASES.length; i += 1) {
      assert.ok(PHASES[i].startsWith(seasonOf(i)), `${PHASES[i]} belongs to ${seasonOf(i)}`);
    }
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

  test('seasonProgress runs across the half-year season, phaseProgress across the quarter', () => {
    // ⚠ `seasonProgress` changed meaning with the wet/dry conversion: it used to
    // be position within the quarter, which is now `phaseProgress`. Both are in
    // the protocol, so this pins which is which.
    const at = (progress) => describeEnvironment(progress * ENV.ticksPerYear, 'clear', ENV);
    const midWetLate = at(0.375);
    assert.equal(midWetLate.season, 'wet');
    assert.equal(midWetLate.phase, 'wetLate');
    assert.ok(Math.abs(midWetLate.seasonProgress - 0.75) < 1e-9, 'three quarters through the wet season');
    assert.ok(Math.abs(midWetLate.phaseProgress - 0.5) < 1e-9, 'and halfway through its second phase');

    const startOfDry = at(0.5);
    assert.equal(startOfDry.season, 'dry');
    assert.equal(startOfDry.phase, 'dryEarly');
    assert.ok(startOfDry.seasonProgress < 1e-9, 'the dry season starts over at 0');
  });

  test('⚠ the bare year never leaves any species comfort band — temperature is not a mechanism here', () => {
    // The wet/dry conversion cut `temperatureAmplitude` 9 → 2 deliberately: this
    // world's pressure is water and grass, not cold. That is a *claim about every
    // species at once*, so it is asserted against the roster rather than against
    // one animal — the intersection of every comfort band is what the amplitude
    // was chosen against (SEASON-PLAN.md §2.3).
    const registry = new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG);
    let warmestFloor = -Infinity;
    let coolestCeiling = Infinity;
    for (const definition of SPECIES_DEFINITIONS) {
      const species = registry.get(definition.id);
      if (species.comfortMin !== undefined) warmestFloor = Math.max(warmestFloor, species.comfortMin);
      if (species.comfortMax !== undefined) coolestCeiling = Math.min(coolestCeiling, species.comfortMax);
    }
    const peak = ENV.meanTemperature + ENV.temperatureAmplitude;
    const trough = ENV.meanTemperature - ENV.temperatureAmplitude;
    assert.ok(trough >= warmestFloor, `the coldest bare tick (${trough}) is above every floor (${warmestFloor})`);
    assert.ok(peak <= coolestCeiling, `the warmest bare tick (${peak}) is below every ceiling (${coolestCeiling})`);

    // Weather still moves it, and must not move it out either: drought is the
    // biggest shift the odds can produce now that snow never falls.
    const drought = describeEnvironment(0.875 * ENV.ticksPerYear, 'drought', ENV).temperature;
    const rain = describeEnvironment(0.375 * ENV.ticksPerYear, 'rain', ENV).temperature;
    assert.ok(drought <= coolestCeiling, `a drought (${drought.toFixed(1)}) is still inside every band`);
    assert.ok(rain >= warmestFloor, `and so is rain (${rain.toFixed(1)})`);
  });

  test('temperature still peaks and troughs where the sinusoid says, at its reduced amplitude', () => {
    const at = (progress) => baseTemperatureAt(progress * ENV.ticksPerYear, ENV);
    const peak = at(0.375);
    const trough = at(0.875);
    assert.ok(Math.abs(peak - (ENV.meanTemperature + ENV.temperatureAmplitude)) < 1e-6, 'peak is mean + amplitude');
    assert.ok(Math.abs(trough - (ENV.meanTemperature - ENV.temperatureAmplitude)) < 1e-6, 'trough is mean − amplitude');
    assert.ok(peak > at(0.125) && peak > at(0.625), 'the peak is the peak');
    // ⚠ The phase shift was left at 0.125, so the warmest point is still the
    // middle of the year's second quarter — which is now late in the *wet*
    // season rather than midsummer. At an amplitude of 2 it no longer matters
    // where the swing lands, which is why the shift was not moved.
    assert.equal(phaseAt(0.375 * ENV.ticksPerYear, ENV.ticksPerYear), 'wetLate');
    assert.equal(phaseAt(0.875 * ENV.ticksPerYear, ENV.ticksPerYear), 'dryLate');
  });
});

describe('weather: spells', () => {
  test('each phase draws the weather it should, and only that', () => {
    const random = new SeededRandom(11);
    const byPhase = {};
    for (const phase of PHASES) {
      byPhase[phase] = new Set();
      for (let i = 0; i < 500; i += 1) byPhase[phase].add(rollWeather(phase, random));
    }
    // ⚠ It never snows anywhere. The state is kept in `WEATHER` so old saves
    // load and the renderer keeps its tone key, but a wet/dry world has no
    // winter for it to fall in — so this is asserted for every phase, not just
    // one, because "zero odds" is the whole of the claim.
    for (const phase of PHASES) assert.ok(!byPhase[phase].has('snow'), `no snow in ${phase}`);
    assert.ok(byPhase.dryLate.has('drought'), 'droughts are a dry-season thing');
    assert.ok(byPhase.dryEarly.has('drought'), 'in both of its phases');
    assert.ok(!byPhase.wetEarly.has('drought'), 'and the wet flush has none at all');
    assert.ok(byPhase.wetEarly.has('rain'), 'which is when it rains');
    for (const phase of PHASES) {
      for (const weather of byPhase[phase]) assert.ok(WEATHER.includes(weather), `unknown weather ${weather}`);
    }
  });

  test('one draw per roll, whatever it returns', () => {
    const a = new SeededRandom(5);
    const b = new SeededRandom(5);
    rollWeather('dryLate', a);
    rollWeather('wetEarly', b); // different odds, same number of draws
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

  test('season, phase and weather turns are announced; temperature drift is not', () => {
    const engine = sandbox({ systems: [new WeatherSystem({ ...ENV, spellTicks: 50 })] });
    const before = engine.events.lastSeq;
    engine.step(200);
    const events = engine.eventsSince(before).filter((e) => e.type === 'environment.changed');
    assert.ok(events.length > 0, 'something turned over');
    assert.ok(events.length < 200, 'but not once per tick — temperature drifts silently');
    for (const event of events) {
      assert.ok(SEASONS.includes(event.season));
      assert.ok(PHASES.includes(event.phase));
      assert.ok(WEATHER.includes(event.weather));
      assert.ok(
        event.season !== event.previousSeason ||
          event.phase !== event.previousPhase ||
          event.weather !== event.previousWeather,
      );
    }
  });

  test('⚠ a phase turning is announced even though the season did not change', () => {
    // A season is two phases, so `wetEarly → wetLate` changes what the grass
    // does while `season` still reads `wet`. Watching only the season would drop
    // half the year's turnovers.
    const engine = sandbox({ systems: [new WeatherSystem(ENV)] });
    const quarter = ENV.ticksPerYear / PHASES.length;
    engine.clock.setTick(quarter - 2);
    const before = engine.events.lastSeq;
    engine.step(4);
    const turned = engine
      .eventsSince(before)
      .filter((e) => e.type === 'environment.changed' && e.phase !== e.previousPhase);
    assert.equal(turned.length, 1, 'exactly one phase turn was announced');
    assert.equal(turned[0].previousPhase, 'wetEarly');
    assert.equal(turned[0].phase, 'wetLate');
    assert.equal(turned[0].season, turned[0].previousSeason, 'and the season did not change with it');
  });
});

describe('weather: vegetation responds to the season', () => {
  // Vegetation under a **fixed** phase and a **fixed** weather state. Both tests
  // below need that: with `WeatherSystem` running, the wet phases draw rain 42–55%
  // of the time and the dry ones draw drought 30–50%, so a comparison between two
  // phases would be measuring the weather as much as the season. The weather's own
  // bite is asserted separately, at the end.
  const vegetationSandbox = ({ size = 32, progress, weather = 'clear', graze = false }) => {
    const engine = sandbox({ size, systems: [new VegetationSystem({ ...CONFIG.vegetation, updateInterval: 1 })] });
    const { vegetation, terrain } = engine.world;
    if (graze) {
      for (let y = 0; y < terrain.height; y += 1) {
        for (let x = 0; x < terrain.width; x += 1) vegetation.consumeAt(x, y, Number.MAX_SAFE_INTEGER);
      }
    }
    engine.world.environment = describeEnvironment(progress * ENV.ticksPerYear, weather, ENV);
    return engine;
  };

  test('the wet flush regrows a grazed field faster than the rest of the year does', () => {
    // ⚠⚠ **This replaced "the land browns off in winter", and the replacement is
    // the point rather than a rename.** A four-season year browned the whole map
    // off through a global `capacityModifier`; a wet/dry year deliberately does
    // not, because its dry season has to leave the riparian strip alone and stop
    // the open plain regrowing — which one global scalar cannot say. So the only
    // *global* seasonal signal left is the wet season's flush
    // (`PHASE_GROWTH.wetEarly` 1.35 against 1.0 everywhere else), and that is what
    // this pins. The per-cell half arrives with the dry map; until then the dry
    // season genuinely does very little, and a test claiming otherwise would be
    // claiming a mechanism that is not built yet.
    //
    // ⚠⚠ **30 ticks, and the horizon is load-bearing rather than arbitrary.** The
    // flush trades a *rate* (1.35) against a *ceiling* (`PHASE_CAPACITY.wetEarly`
    // 0.9 against 1.0), and which of the two wins depends entirely on how far the
    // field is from saturating. Measured on this sandbox, seed 3:
    //
    //   ticks    10     20     30     50     80    120    200
    //   ratio  2.06   2.36   2.53   1.87   1.01   0.90   0.90
    //
    // — the flush is 2.5× ahead while the field is climbing and 10% *behind* once
    // both have saturated, because at that point only the ceiling is left. That is
    // the same rate-versus-ceiling distinction `VegetationGrid.grow` documents,
    // and it is why "spring grows more grass" has to be measured on a grazed field
    // rather than a settled one.
    const regrowth = (progress) => {
      const engine = vegetationSandbox({ progress, graze: true });
      engine.step(30);
      return engine.world.vegetation.totalBiomass();
    };
    const flush = regrowth(0.125); // mid `wetEarly`
    const settled = regrowth(0.625); // mid `dryEarly`
    assert.ok(flush > settled * 1.5, `the wet flush comes back faster (${Math.round(flush)} vs ${Math.round(settled)})`);
  });

  test('the dry season does not brown the map off — grass stops growing, it does not die back', () => {
    // The decision this pins: a field standing at capacity when the dry season
    // arrives keeps standing there. Nothing removes it but grazing, which is the
    // requested mechanism — "should not grow at all" rather than "should die".
    const engine = vegetationSandbox({ size: 24, progress: 0.25 }); // `wetLate`
    engine.step(400);
    const settled = engine.world.vegetation.totalBiomass();

    engine.world.environment = describeEnvironment(0.75 * ENV.ticksPerYear, 'clear', ENV); // `dryLate`
    engine.step(600);
    const dry = engine.world.vegetation.totalBiomass();
    assert.equal(engine.world.environment.season, 'dry');
    assert.ok(dry >= settled * 0.99, `the dry season leaves standing grass standing (${Math.round(dry)} vs ${Math.round(settled)})`);
  });

  test('⚠ a drought still bites, and that is the division of labour', () => {
    // The dry season is the floor; a drought spell is a bad patch within it. So
    // the season alone must not brown the map off (above) while a drought must —
    // otherwise the two would be the same mechanism wearing different names, and
    // merging them is what `Environment.js` refuses to do.
    const engine = vegetationSandbox({ size: 24, progress: 0.75 }); // `dryLate`, clear
    engine.step(400);
    const clear = engine.world.vegetation.totalBiomass();

    engine.world.environment = describeEnvironment(0.75 * ENV.ticksPerYear, 'drought', ENV);
    engine.step(600);
    const drought = engine.world.vegetation.totalBiomass();
    assert.ok(drought < clear * 0.8, `a drought shrinks what the land holds (${Math.round(drought)} vs ${Math.round(clear)})`);
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
        config: { terrain: { ...FLAT_TERRAIN, coverPatchDensity: 3 } },
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
      config: { terrain: { ...FLAT_TERRAIN, thickets: 4 } },
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

  test('a full year of the demo passes through both seasons and all four phases, in order', () => {
    // ⚠ `smallDemo`, not `createDemoSimulation` — and it changed on purpose. The
    // old version of this test asserted a *vegetation* peak and trough, which is
    // an ecological claim the full demo had to carry. What survives the wet/dry
    // conversion is a claim about the **calendar**, which is machinery, and
    // machinery claims belong in the cheap world (DOCS §14, 3.9× cheaper).
    //
    // The vegetation half of it does not simply move here: a wet/dry year has no
    // global dieback at all, so there is no seasonal biomass swing left to
    // assert. The per-cell version arrives with the dry map.
    const engine = smallDemo({ seed: 42 });
    const phaseOrder = [];
    const seasonsSeen = new Set();
    for (let tick = 0; tick < ENV.ticksPerYear; tick += 1) {
      engine.step(1);
      const { season, phase } = engine.world.environment;
      seasonsSeen.add(season);
      if (phaseOrder[phaseOrder.length - 1] !== phase) phaseOrder.push(phase);
    }
    assert.deepEqual(seasonsSeen, new Set(SEASONS), 'the year passed through both seasons');
    // ⚠ Five entries for four phases, and the fifth is the assertion: the loop
    // steps *into* tick `ticksPerYear`, which is the first tick of the next year,
    // so the cycle closing back onto `wetEarly` is observed rather than assumed.
    assert.deepEqual(phaseOrder, [...PHASES, PHASES[0]], 'through the four phases in order, then the year starts over');
  });

  test('⚠ the season and the weather never stress an animal — only a storm can', () => {
    // ⚠⚠ **This assertion is inverted from the one it replaces, deliberately.**
    // It used to require that the demo "puts animals under real thermal stress".
    // The wet/dry conversion cut `temperatureAmplitude` 9 → 2 precisely so that
    // it does not: this world's pressure is water and grass. So the claim worth
    // holding is now the opposite one, and it is stronger for being exact rather
    // than emergent — no fishing for a rare event in a fixed window (DOCS §14).
    //
    // A storm is a *disturbance*, −10 °C on top of the global temperature, and it
    // is the only thing left that can push an animal out of band. That is what
    // keeps the shelter machinery live; the behavioural half is asserted in the
    // controlled sandbox above, which sets the temperature directly.
    const engine = smallDemo({ seed: 42 });
    let peakStress = 0;
    let coldest = Infinity;
    let warmest = -Infinity;
    for (let tick = 0; tick < ENV.ticksPerYear; tick += 1) {
      engine.step(1);
      const { temperature } = engine.world.environment;
      coldest = Math.min(coldest, temperature);
      warmest = Math.max(warmest, temperature);
      if (tick % 50 !== 0) continue;
      // ⚠ Skip any animal standing in a disturbance — a storm is the exemption
      // this test exists to carve out, and `thermalStress` folds it in.
      for (const entity of engine.world.entities.all()) {
        if (!entity.alive) continue;
        if (engine.world.disturbances?.length) continue;
        peakStress = Math.max(peakStress, thermalStress(engine.world, entity, CONFIG.locomotion.shelterRelief));
      }
    }
    assert.equal(peakStress, 0, `no animal was stressed by the weather alone (peak ${peakStress.toFixed(2)}°C)`);
    assert.ok(warmest - coldest > 0, `the temperature does still move (${coldest.toFixed(1)}…${warmest.toFixed(1)}°C)`);
  });

  test('the environment survives save/load and the run continues identically', () => {
    const engine = smallDemo({ seed: 42 });
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
    const a = smallDemo({ seed: 42 });
    const b = smallDemo({ seed: 42 });
    a.step(2000);
    b.step(2000);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);

    const c = smallDemo({ seed: 55 });
    const d = smallDemo({ seed: 55 });
    const scratch = d.randomStream('unrelated');
    for (let i = 0; i < 50; i += 1) scratch.next();
    c.step(500);
    d.step(500);
    assert.deepEqual(c.world.environment, d.world.environment);
  });
});
