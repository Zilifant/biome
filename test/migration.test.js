import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { MigrationSystem } from '../src/simulation/systems/MigrationSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { ParentingSystem } from '../src/simulation/systems/ParentingSystem.js';
import { TerritorySystem } from '../src/simulation/systems/TerritorySystem.js';
import {
  SAMPLE_DIRECTIONS,
  beginDispersal,
  blendHeadings,
  forageGradient,
  isDispersing,
  migrationOf,
} from '../src/simulation/migration/migration.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { LifeEventTypes } from '../src/simulation/systems/lifeEvents.js';
import { buildFullSnapshot } from '../src/protocol/snapshots.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.grazer');
const STALKER = getSpecies('predator.stalker');
const TWO_PI = Math.PI * 2;

function genomeWith(overrides = {}) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [overrides[locus] ?? 1, overrides[locus] ?? 1]]));
}

/** A flat, featureless world: no lakes, ridges, or cover, so vegetation is the only signal. */
function sandbox({ seed = 3, config = {} } = {}) {
  return new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { lakes: 0, ridges: 0, coverPatchDensity: 0 },
      ...config,
    },
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
    traits: overrides.traits ?? expressGenome(genome),
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

/** Strip the vegetation field bare, so a test can paint exactly the signal it means to test. */
function clearVegetation(engine) {
  const { width, height } = engine.world.vegetation;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      engine.world.vegetation.consumeAt(x, y, Number.MAX_SAFE_INTEGER);
    }
  }
}

/** Fill a rectangle of cells to (at most) their carrying capacity. */
function paintVegetation(engine, { minX, minY, maxX, maxY }, amount = 1000) {
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      engine.world.vegetation.addAt(x, y, amount);
    }
  }
}

/** Shortest signed angular difference, for asserting "points roughly that way". */
function angleBetween(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

describe('migration: the drift itself', () => {
  // At weight 0 this returns the base heading *untouched*, and that is the
  // property the whole step rests on: migration is off unless the world says
  // otherwise, so an animal with no reason to go anywhere behaves exactly as it
  // did before Step 26. Asserted first because everything else assumes it.
  test('blending is inert at zero weight and total at full weight', () => {
    assert.equal(blendHeadings(1.2, 3.0, 0), 1.2, 'zero weight changes nothing');
    assert.equal(blendHeadings(1.2, 3.0, 1), 3.0, 'full weight is the bias');
    // Out-of-range weights are clamped rather than extrapolated.
    assert.equal(blendHeadings(1.2, 3.0, -5), 1.2);
    assert.equal(blendHeadings(1.2, 3.0, 5), 3.0);
  });

  // Averaging 350° and 10° as plain numbers gives 180° — pointing exactly
  // backwards. Interpolating the vectors is what makes the wrap point safe, and
  // this pins it, because the symptom (an animal that migrates the wrong way
  // only when the gradient happens to straddle east) is miserable to find later.
  test('blending goes the short way around the circle', () => {
    const near = blendHeadings((350 * Math.PI) / 180, (10 * Math.PI) / 180, 0.5);
    assert.ok(angleBetween(near, 0) < 1e-9, `expected ~0 rad, got ${near}`);
    const quarter = blendHeadings(0, Math.PI / 2, 0.5);
    assert.ok(angleBetween(quarter, Math.PI / 4) < 1e-9, 'halfway between E and N is NE');
  });

  test('exactly opposed headings at half weight keep the base rather than returning a null direction', () => {
    // The vectors cancel to (0, 0); atan2(0, 0) is 0, which would silently point
    // every such animal due east.
    const blended = blendHeadings(Math.PI / 2, -Math.PI / 2, 0.5);
    assert.ok(angleBetween(blended, Math.PI / 2) < 1e-9, 'fell back to the base heading');
  });
});

describe('migration: habitat evaluation', () => {
  test('a flat world produces no pull at all', () => {
    const engine = sandbox();
    clearVegetation(engine);
    const id = spawn(engine, { x: 32, y: 32 });
    const entity = engine.world.entities.get(id);
    assert.equal(forageGradient(engine.world, entity, { cueRadius: 18, reference: 4 }), null);
  });

  test('nowhere better than here produces no pull either', () => {
    const engine = sandbox();
    clearVegetation(engine);
    // Rich under the animal, bare everywhere else: it is already home.
    paintVegetation(engine, { minX: 30, minY: 30, maxX: 34, maxY: 34 });
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    assert.equal(forageGradient(engine.world, entity, { cueRadius: 18, reference: 4 }), null);
  });

  test('the gradient points at the rich ground, and its strength scales with how much better it is', () => {
    const engine = sandbox();
    clearVegetation(engine);
    // A rich band due east of the animal, covering both sample points on that ray.
    paintVegetation(engine, { minX: 38, minY: 20, maxX: 56, maxY: 44 });
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);

    const strong = forageGradient(engine.world, entity, { cueRadius: 18, reference: 4 });
    assert.ok(strong, 'found a direction');
    assert.ok(angleBetween(strong.heading, 0) < 1e-9, `expected due east, got ${strong.heading}`);
    assert.ok(strong.strength > 0, 'a real pull');

    // Same field, a reference an order of magnitude larger: the same difference
    // now reads as a much weaker signal. Strength is a *ratio*, not a distance.
    const weak = forageGradient(engine.world, entity, { cueRadius: 18, reference: 40 });
    assert.equal(weak.heading, strong.heading, 'same direction');
    assert.ok(weak.strength < strong.strength, 'weaker against a larger reference');
  });

  test('strength is capped at 1 however much better the far ground is', () => {
    const engine = sandbox();
    clearVegetation(engine);
    paintVegetation(engine, { minX: 38, minY: 20, maxX: 56, maxY: 44 });
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);
    const gradient = forageGradient(engine.world, entity, { cueRadius: 18, reference: 0.001 });
    assert.equal(gradient.strength, 1);
  });

  test('evaluation is a fixed number of O(1) reads, whatever the world holds', () => {
    // The step's performance guarantee, asserted rather than asserted-about: the
    // gradient never touches the spatial grid (§1.4 C6 owes Step 30 the folding
    // of the two neighbour walks that already exist, and this step adds none),
    // and it reads the vegetation field exactly SAMPLE_DIRECTIONS × 2 times.
    const engine = sandbox();
    const id = spawn(engine, { x: 32.5, y: 32.5 });
    const entity = engine.world.entities.get(id);

    let reads = 0;
    const grid = engine.world.vegetation;
    const realBiomassAt = grid.biomassAt.bind(grid);
    grid.biomassAt = (x, y) => {
      reads += 1;
      return realBiomassAt(x, y);
    };
    let spatialQueries = 0;
    const spatial = engine.world.spatial;
    for (const method of ['queryRadius', 'queryCell', 'queryRect']) {
      if (typeof spatial?.[method] === 'function') {
        const real = spatial[method].bind(spatial);
        spatial[method] = (...args) => {
          spatialQueries += 1;
          return real(...args);
        };
      }
    }

    forageGradient(engine.world, entity, { cueRadius: 18, reference: 4 });
    assert.equal(reads, SAMPLE_DIRECTIONS * 2 + 1, 'one read per sample point, plus the cell underfoot');
    assert.equal(spatialQueries, 0, 'no spatial query of any kind');
  });
});

describe('migration: what steers a wander', () => {
  // `updateInterval: 1` throughout this block: habitat evaluation is staggered
  // in the demo (that is the performance story), but a test of *what* the
  // evaluation decides should not also be a test of *when* it runs. The stagger
  // has its own test below.
  function driftEngine({ seed = 3 } = {}) {
    const engine = sandbox({ seed });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
    return engine;
  }

  test('habitat evaluation is staggered', () => {
    const engine = sandbox();
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 10 }));
    clearVegetation(engine);
    paintVegetation(engine, { minX: 38, minY: 20, maxX: 56, maxY: 44 });
    const id = spawn(engine, { x: 32.5, y: 32.5, energy: 5 });

    engine.step(1);
    assert.equal(engine.world.entities.get(id).migrationStrength, 0, 'nothing evaluated off-schedule');
    engine.step(9); // now at tick 10
    assert.ok(engine.world.entities.get(id).migrationStrength > 0, 'evaluated on schedule');
  });

  test('a hungry animal drifts toward better ground; a fed one does not', () => {
    const engine = driftEngine();
    clearVegetation(engine);
    paintVegetation(engine, { minX: 38, minY: 20, maxX: 56, maxY: 44 });

    const hungryId = spawn(engine, { x: 32.5, y: 32.5, energy: 10 });
    const fedId = spawn(engine, { x: 32.5, y: 40.5, energy: GRAZER.maxEnergy });
    engine.step(1);

    const hungry = engine.world.entities.get(hungryId);
    const fed = engine.world.entities.get(fedId);
    assert.ok(hungry.migrationStrength > 0, 'a hungry animal has somewhere to be');
    assert.ok(angleBetween(hungry.migrationHeading, 0) < 1e-9, 'and it is east, where the grass is');
    assert.equal(fed.migrationStrength, 0, 'a full animal is going nowhere');
  });

  test('the drift is a bias, not a beeline', () => {
    // Deliberately pinning the *magnitude*, because the whole A34 argument is
    // that a strong new pull breaks the demo. If a future retune pushes this
    // toward 1 the mechanism has stopped being a bias, and that should fail
    // here rather than five seeds into a sweep.
    const engine = driftEngine();
    clearVegetation(engine);
    paintVegetation(engine, { minX: 38, minY: 20, maxX: 56, maxY: 44 });
    const id = spawn(engine, { x: 32.5, y: 32.5, energy: 1 });
    engine.step(1);
    const entity = engine.world.entities.get(id);
    assert.ok(entity.migrationStrength <= CONFIG.migration.biasWeight, 'never exceeds the configured cap');
    assert.ok(CONFIG.migration.biasWeight < 1, 'and the cap itself leaves randomness in charge');
  });

  test('a species that does not track forage gets no drift from grass it cannot eat', () => {
    const engine = driftEngine();
    clearVegetation(engine);
    paintVegetation(engine, { minX: 38, minY: 20, maxX: 56, maxY: 44 });
    const id = spawn(engine, { speciesId: STALKER.id, x: 32.5, y: 32.5, energy: 10 });
    engine.step(1);
    const stalker = engine.world.entities.get(id);
    assert.equal(migrationOf(STALKER.id).tracksForage, false);
    assert.equal(stalker.migrationStrength, 0, 'a stalker does not follow the grass');
  });

  test('migration draws no randomness whatsoever', () => {
    // The convention is a *fixed* draw budget; this step's answer is zero, which
    // means it cannot shift another system's sequence even in principle. Asserted
    // by comparing every stream's state across a step with the system registered
    // and a step without it.
    // updateInterval 1 so the system actually runs during the five ticks —
    // at the demo's stagger it would never fire and the test would pass by
    // measuring nothing (§1.4 D5).
    const withMigration = sandbox();
    withMigration.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    const migratingId = spawn(withMigration, { x: 32.5, y: 32.5, energy: 10 });
    withMigration.step(5);
    assert.notEqual(
      withMigration.world.entities.get(migratingId).migrationStrength,
      0,
      'the system really did evaluate — otherwise this asserts nothing',
    );

    const without = sandbox();
    spawn(without, { x: 32.5, y: 32.5, energy: 10 });
    without.step(5);

    assert.deepEqual(
      captureSimulationState(withMigration).randomStreams,
      captureSimulationState(without).randomStreams,
      'no stream advanced',
    );
  });

  test('wander headings are biased toward better ground; without migration they are not', () => {
    // This asserts the **mechanism** — the headings actually chosen — rather
    // than where the animals ended up, and the reason is worth recording.
    //
    // Two earlier cuts of this test measured position and both were bad tests.
    // The first painted a bare desert with a rich band beyond it: the control
    // reached it just as fast, because a random walk crosses a small box easily
    // and because a cue reaching 18 units reads *nothing* across bare ground —
    // it was measuring diffusion and would have passed with migration deleted.
    // The second used a smooth ramp, where the effect was real but only ~1 unit,
    // because the drift is deliberately gentle (`biasWeight` 0.5 × hunger ×
    // gradient) and over 15 units diffusion simply dominates it. Migration's
    // effect on *position* is cumulative and shows over long runs and long
    // distances; pinning a small displacement in a sandbox would be pinning
    // noise (§1.4 D1, D7).
    //
    // What is crisp, and what the code actually promises, is the direction an
    // aimless animal picks. Mean cos(heading) over many wander commitments is 0
    // for a random walk and positive when the gradient points east.
    function meanEastwardness(migrationEnabled) {
      const engine = sandbox({ seed: 11 });
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      if (migrationEnabled) engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
      engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));

      clearVegetation(engine);
      // Rich ground due east, inside the 18-unit cue and well outside the
      // 6-unit perception radius, so `seekFood` can never be what steers them.
      paintVegetation(engine, { minX: 44, minY: 0, maxX: 63, maxY: 63 });
      const ids = [];
      for (let i = 0; i < 16; i += 1) ids.push(spawn(engine, { x: 32.5, y: 2.5 + i * 4, energy: 30 }));

      // No movement system: the animals hold station and keep re-deciding, which
      // isolates the heading choice from everything downstream of it.
      let sum = 0;
      let n = 0;
      for (let t = 0; t < 300; t += 1) {
        engine.step(1);
        for (const id of ids) {
          const entity = engine.world.entities.get(id);
          if (entity.action !== 'wander' || !entity.moveIntent) continue;
          sum += Math.cos(entity.moveIntent.heading);
          n += 1;
        }
      }
      assert.ok(n > 500, `enough wander commitments to measure (${n})`);
      return sum / n;
    }

    const drifted = meanEastwardness(true);
    const control = meanEastwardness(false);
    assert.ok(Math.abs(control) < 0.1, `an unbiased walk has no direction (got ${control.toFixed(3)})`);
    assert.ok(drifted > 0.15, `migration steers east (got ${drifted.toFixed(3)})`);
  });
});

describe('migration: natal dispersal', () => {
  test('leaving home takes an outward heading, clears the range, and reports where it left', () => {
    const engine = sandbox();
    const id = spawn(engine, { x: 40, y: 30, homeRange: { x: 30, y: 30, radius: 5, samples: 100 } });
    const entity = engine.world.entities.get(id);

    const natal = beginDispersal(entity, 100, 400);
    assert.deepEqual(natal, { x: 30, y: 30 }, 'reported the centre it is leaving');
    // Due east: the animal is east of the centre, so "outward" is east.
    assert.ok(angleBetween(entity.dispersalHeading, 0) < 1e-9, 'heading points away from home');
    assert.equal(entity.dispersalUntil, 500);
    assert.equal(entity.homeRange, null, 'no longer lives where it was born');
    assert.equal(isDispersing(entity, 499), true);
    assert.equal(isDispersing(entity, 500), false, 'the walk is bounded');
  });

  test('an animal sitting exactly on its natal centre keeps the heading it had', () => {
    // There is no outward direction from a point, and atan2(0, 0) would send
    // every such animal due east in lockstep.
    const engine = sandbox();
    const id = spawn(engine, { x: 30, y: 30, heading: 2.5, homeRange: { x: 30, y: 30, radius: 5, samples: 100 } });
    const entity = engine.world.entities.get(id);
    beginDispersal(entity, 0, 400);
    assert.ok(angleBetween(entity.dispersalHeading, 2.5) < 1e-9);
  });

  test('zero ticks is completely inert — the control path', () => {
    const engine = sandbox();
    const range = { x: 30, y: 30, radius: 5, samples: 100 };
    const id = spawn(engine, { x: 40, y: 30, homeRange: range });
    const entity = engine.world.entities.get(id);
    const natal = beginDispersal(entity, 100, 0);
    assert.deepEqual(natal, { x: 30, y: 30 }, 'still reports the centre');
    assert.equal(entity.dispersalUntil, null, 'but nothing was started');
    assert.equal(entity.homeRange, range, 'and the range is untouched');
  });

  test('dispersal outranks the forage gradient', () => {
    // A disperser walks *past* good ground. If it turned back at the first green
    // patch it would never leave, which is the whole reason this is an override
    // rather than another term in a sum.
    const engine = sandbox();
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    clearVegetation(engine);
    paintVegetation(engine, { minX: 0, minY: 20, maxX: 26, maxY: 44 }); // rich to the WEST
    const id = spawn(engine, { x: 32.5, y: 32.5, energy: 5 });
    const entity = engine.world.entities.get(id);
    beginDispersal(entity, engine.clock.tick, 400); // heading EAST (no range → keeps heading 0)
    engine.step(1);

    const after = engine.world.entities.get(id);
    assert.ok(angleBetween(after.migrationHeading, 0) < 1e-9, 'still walking east, away from the grass');
    assert.equal(after.migrationStrength, CONFIG.migration.dispersalWeight);
  });

  test('a juvenile that outgrows its guardian leaves the natal range for real', () => {
    const engine = sandbox({ seed: 5 });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    engine.registerSystem(new ParentingSystem({ ...CONFIG.parenting, disperses: true }));

    const guardianId = spawn(engine, { x: 32, y: 32 });
    const juvenileId = spawn(engine, {
      x: 32,
      y: 32,
      lifeStage: 'juvenile',
      guardianId,
      weaned: true,
      homeRange: { x: 32, y: 32, radius: 3, samples: 500 },
    });

    engine.step(1);
    const before = engine.events.lastSeq;
    engine.world.entities.get(juvenileId).lifeStage = 'subadult';
    engine.step(1);

    const dispersed = engine.eventsSince(before).find((e) => e.type === 'entity.lifeEvent' && e.event === 'dispersed');
    assert.ok(dispersed, 'dispersal announced');
    assert.equal(dispersed.x, 32, 'and carries the natal centre');
    assert.equal(dispersed.y, 32);

    const juvenile = engine.world.entities.get(juvenileId);
    assert.ok(juvenile.lifeEvents.some((e) => e.type === LifeEventTypes.DISPERSED && e.x === 32));
    assert.ok(isDispersing(juvenile, engine.clock.tick), 'and it is walking');

    // Now let it walk. The claim is spatial, so it is measured in distance.
    engine.step(CONFIG.migration.updateInterval + migrationOf(GRAZER.id).dispersalTicks);
    const settled = engine.world.entities.get(juvenileId);
    const travelled = Math.hypot(settled.x - 32, settled.y - 32);
    assert.ok(travelled > 20, `left the natal range (got ${travelled.toFixed(1)} units)`);
  });

  test('orphaning does not disperse — an orphan has enough problems', () => {
    // §1.4 A12 keeps orphan mercy deliberately; sending an orphan walking as
    // well would move two variables at once.
    const engine = sandbox();
    engine.registerSystem(new ParentingSystem({ ...CONFIG.parenting, disperses: true }));
    const guardianId = spawn(engine, { x: 20, y: 20 });
    const juvenileId = spawn(engine, {
      x: 20,
      y: 20,
      lifeStage: 'juvenile',
      guardianId,
      homeRange: { x: 20, y: 20, radius: 3, samples: 100 },
    });
    engine.world.entities.get(guardianId).alive = false;
    engine.step(1);

    const juvenile = engine.world.entities.get(juvenileId);
    assert.equal(juvenile.guardianId, null, 'bond broken');
    assert.equal(juvenile.dispersalUntil, null, 'but not sent walking');
    assert.notEqual(juvenile.homeRange, null, 'and it still lives where it did');
  });
});

describe('migration: recolonization', () => {
  test('animals move into empty ground because it is ungrazed, not because it is empty', () => {
    // Recolonization is not implemented anywhere — nothing in the engine knows a
    // region was vacated. It falls out of the forage gradient: ground nobody is
    // eating grows back to capacity and therefore becomes the best thing on the
    // compass. This asserts that consequence, which is the honest way to test an
    // emergent property.
    const engine = sandbox({ seed: 21 });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));

    clearVegetation(engine);
    // The whole east half is lush and holds not one animal; the west is bare and
    // crowded. No animal can see across the gap.
    paintVegetation(engine, { minX: 40, minY: 0, maxX: 63, maxY: 63 });
    const ids = [];
    for (let i = 0; i < 16; i += 1) ids.push(spawn(engine, { x: 8.5, y: 4.5 + i * 3.5, energy: 8 }));

    const emptied = () => ids.filter((id) => engine.world.entities.get(id).x >= 40).length;
    assert.equal(emptied(), 0, 'the region starts empty');
    engine.step(900);
    assert.ok(emptied() >= 4, `the empty region was recolonized (${emptied()} of ${ids.length} arrived)`);
  });
});

describe('migration: protocol, persistence, and the demo', () => {
  test('dispersal rides in bulk snapshots; the rest is inspection-only', () => {
    const engine = sandbox();
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    const id = spawn(engine, { x: 32, y: 32, homeRange: { x: 20, y: 32, radius: 4, samples: 100 } });
    beginDispersal(engine.world.entities.get(id), engine.clock.tick, 400);
    engine.step(1);

    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    const projected = snapshot.entities.find((e) => e.id === id);
    assert.equal(projected.dispersing, true, 'a walking juvenile is visible as one');
    assert.equal(projected.migrationHeading, undefined, 'the drift itself never leaks into bulk');
    assert.equal(projected.migrationStrength, undefined);

    const details = engine.getEntityDetails(id);
    assert.equal(details.migration.dispersing, true);
    assert.equal(details.migration.tracksForage, true);
    assert.equal(details.migration.cueRadius, migrationOf(GRAZER.id).cueRadius);
    assert.ok(details.migration.drift, 'the live drift is inspectable');
    assert.equal(details.migration.drift.strength, CONFIG.migration.dispersalWeight);
  });

  test('the dispersing flag is derived from the clock, so it cannot outlive the walk', () => {
    const engine = sandbox();
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    const id = spawn(engine, { x: 32, y: 32 });
    beginDispersal(engine.world.entities.get(id), engine.clock.tick, 5);
    engine.step(1);
    assert.equal(engine.getEntityDetails(id).dispersing, true);
    engine.step(10);
    assert.equal(engine.getEntityDetails(id).dispersing, false, 'expired without anyone clearing it');
  });

  test('moving house is announced once, on the changed verdict', () => {
    const engine = sandbox();
    engine.registerSystem(new MigrationSystem({ ...CONFIG.migration, updateInterval: 1 }));
    engine.registerSystem(new TerritorySystem(CONFIG.territory));
    const id = spawn(engine, { x: 10, y: 10 });
    engine.step(2);
    const entity = engine.world.entities.get(id);
    assert.equal(entity.settledX !== null, true, 'the first range seen becomes the baseline');

    // Teleport the range well past the species' range radius. (Moving the range
    // rather than the animal is the point: the event is about where an animal
    // *lives*, so an animal that walks a long way and comes back has not moved.)
    const collected = [];
    const rangeRadius = GRAZER.territory.rangeRadius;
    entity.homeRange.x += rangeRadius * 2;
    for (let i = 0; i < 40; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      collected.push(...engine.eventsSince(before).filter((e) => e.type === 'entity.migrated'));
    }
    // Collected tick by tick, per §1.4 D13 — `eventsSince` after a long step
    // measures what survived the bounded outbox, not what happened.
    assert.equal(collected.length, 1, 'announced exactly once, not every tick it held');
    assert.equal(collected[0].entityId, id);
    assert.ok(collected[0].distance >= rangeRadius);
    assert.equal(collected[0].reason, 'forage');
  });

  test('the demo disperses juveniles and relocates adults', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const seen = { migrated: 0, dispersed: 0, byReason: {} };
    for (let i = 0; i < 4000; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type === 'entity.migrated') {
          seen.migrated += 1;
          seen.byReason[e.reason] = (seen.byReason[e.reason] ?? 0) + 1;
        }
        if (e.type === 'entity.lifeEvent' && e.event === 'dispersed') seen.dispersed += 1;
      }
    }
    assert.ok(seen.dispersed > 0, 'juveniles left home');
    assert.ok(seen.migrated > 0, 'animals moved house');
    assert.ok(seen.byReason.dispersal > 0, 'some of it was dispersal');
    assert.ok(seen.byReason.forage > 0, 'and some of it was following the grass');
  });

  test('disabling migration leaves the demo exactly as Step 25 left it', () => {
    // The control the step was measured against, pinned so it stays a control.
    const engine = createDemoSimulation({ seed: 42, config: { migration: { enabled: false } } });
    const migrated = [];
    for (let i = 0; i < 1500; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      migrated.push(...engine.eventsSince(before).filter((e) => e.type === 'entity.migrated'));
    }
    assert.equal(migrated.length, 0, 'nothing migrates');
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal') continue;
      assert.equal(entity.migrationStrength, 0, `entity ${entity.id} has no drift`);
      assert.equal(entity.dispersalUntil, null, `entity ${entity.id} was never sent walking`);
    }
  });

  test('migration survives save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 7 });
    engine.step(1200);
    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));

    const restored = restoreDemoSimulation(saved);
    engine.step(400);
    restored.step(400);

    const summarize = (e) =>
      [...e.world.entities.all()].map((en) => [
        en.id,
        en.x,
        en.y,
        en.migrationHeading,
        en.migrationStrength,
        en.dispersalHeading,
        en.dispersalUntil,
        en.settledX,
        en.settledY,
      ]);
    assert.deepEqual(summarize(restored), summarize(engine), 'a restored run is not merely similar');
  });

  test('the demo stays deterministic with migration in it', () => {
    const a = createDemoSimulation({ seed: 99 });
    const b = createDemoSimulation({ seed: 99 });
    a.step(800);
    b.step(800);
    assert.deepEqual(captureSimulationState(b), captureSimulationState(a));
  });
});
