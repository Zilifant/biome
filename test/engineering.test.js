import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { FeatureGrid } from '../src/simulation/world/FeatureGrid.js';
import { EngineeringSystem } from '../src/simulation/systems/EngineeringSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { MetabolismSystem } from '../src/simulation/systems/MetabolismSystem.js';
import {
  FeatureKinds,
  effectsFor,
  sheltersAt,
  speedScaleAt,
  trailGradient,
} from '../src/simulation/engineering/features.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { buildFullSnapshot, buildDeltaSnapshot, applyDeltaSnapshot } from '../src/protocol/snapshots.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;
const ENG = CONFIG.engineering;
const GRAZER = getSpecies('herbivore.gazelle');

function genomeWith(overrides = {}) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [overrides[locus] ?? 1, overrides[locus] ?? 1]]));
}

function sandbox({ seed = 5, config = {} } = {}) {
  return new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { ...FLAT_TERRAIN },
      ...config,
    },
  });
}

function spawn(engine, overrides = {}) {
  const genome = overrides.genome ?? genomeWith();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: GRAZER.id,
    heading: 0,
    lifeStage: 'adult',
    sex: Sexes.FEMALE,
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
    hydration: GRAZER.maxHydration,
    maxStamina: GRAZER.maxStamina,
    stamina: GRAZER.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** Wear a cell until it becomes a feature, the way traffic would. */
function wearIn(grid, cellX, cellY, kind = FeatureKinds.TRAIL, threshold = ENG.threshold) {
  let result = null;
  for (let i = 0; i < 200 && result !== 'promoted'; i += 1) {
    result = grid.wear(cellX, cellY, kind, ENG.trailWearPerUnit, threshold, ENG.maxWear);
  }
  return result;
}

describe('engineering: the feature grid', () => {
  function grid() {
    return new FeatureGrid({ width: 32, height: 32, params: ENG });
  }

  test('a single pass wears ground without making anything of it', () => {
    // The whole claim of the step is that *repeated* activity reshapes the
    // world. One crossing must not be enough, or the claim is false.
    const g = grid();
    assert.equal(g.wear(4, 4, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear), 'changed');
    assert.equal(g.featureCount, 0, 'walked over, not worn in');
    assert.equal(g.trackedCells, 1, 'but the ground remembers it happened');
  });

  test('repeated use makes a feature, and says so exactly once', () => {
    const g = grid();
    let promotions = 0;
    for (let i = 0; i < 60; i += 1) {
      if (g.wear(4, 4, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear) === 'promoted') {
        promotions += 1;
      }
    }
    assert.equal(promotions, 1, 'announced on the transition, not on every crossing after it');
    assert.equal(g.featureCount, 1);
    assert.equal(g.at(4, 4).kind, FeatureKinds.TRAIL);
  });

  test('unused ground fades, and a feature is lost once', () => {
    const g = grid();
    wearIn(g, 4, 4);
    assert.equal(g.featureCount, 1);

    let lost = [];
    for (let i = 0; i < 200 && g.trackedCells > 0; i += 1) {
      lost = lost.concat(g.decay(ENG.decayPerTick * ENG.decayInterval, ENG.threshold * ENG.demoteFraction, ENG.floor));
    }
    assert.equal(g.featureCount, 0, 'it faded');
    assert.equal(g.trackedCells, 0, 'and was eventually forgotten entirely');
    assert.equal(lost.length, 1, 'reported once');
    assert.deepEqual(lost[0], { cellX: 4, cellY: 4, kind: FeatureKinds.TRAIL });
  });

  test('a feature survives a dip below the promotion threshold', () => {
    // The hysteresis band, pinned. Without it a cell sitting near the threshold
    // flaps across it every decay tick — one demo run produced 9569 trails
    // formed and 9081 lost, which is a flickering world rather than a world
    // with trails in it (§1.4 D20).
    const g = grid();
    wearIn(g, 4, 4);
    const demoteBelow = ENG.threshold * ENG.demoteFraction;

    // Decay to just under the *promotion* threshold but above the demotion one.
    while (g.at(4, 4).wear >= ENG.threshold) g.decay(0.01, demoteBelow, ENG.floor);
    assert.ok(g.at(4, 4).wear < ENG.threshold, 'below where it was promoted');
    assert.ok(g.at(4, 4).wear > demoteBelow, 'but still inside the band');
    assert.equal(g.featureCount, 1, 'and still a trail');

    while (g.trackedCells > 0 && g.at(4, 4) && g.at(4, 4).wear > demoteBelow) g.decay(0.01, demoteBelow, ENG.floor);
    assert.equal(g.featureCount, 0, 'lost only once it fell out the bottom of the band');
  });

  test('a different kind has to wear the old one away first', () => {
    const g = grid();
    wearIn(g, 4, 4, FeatureKinds.TRAIL);
    const worn = g.at(4, 4).wear;

    g.wear(4, 4, FeatureKinds.BURROW, 0.1, ENG.threshold, ENG.maxWear);
    assert.equal(g.at(4, 4).kind, FeatureKinds.TRAIL, 'not flipped on contact');
    assert.ok(g.at(4, 4).wear < worn, 'worn down instead');

    for (let i = 0; i < 50; i += 1) g.wear(4, 4, FeatureKinds.BURROW, 0.1, ENG.threshold, ENG.maxWear);
    assert.equal(g.at(4, 4).kind, FeatureKinds.BURROW, 'and taken over once worn away');
  });

  test('tracking is capped, and says so rather than growing', () => {
    const g = new FeatureGrid({ width: 32, height: 32, params: { ...ENG, maxCells: 4 } });
    for (let i = 0; i < 20; i += 1) g.wear(i, 0, FeatureKinds.TRAIL, 0.1, ENG.threshold, ENG.maxWear);
    assert.equal(g.trackedCells, 4, 'the cap is a real limit');
    // Ground already tracked keeps accumulating even when the map is full.
    const before = g.at(0, 0).wear;
    g.wear(0, 0, FeatureKinds.TRAIL, 0.1, ENG.threshold, ENG.maxWear);
    assert.ok(g.at(0, 0).wear > before);
  });

  test('wear is capped, so a much-used trail does not become unfadeable', () => {
    const g = grid();
    for (let i = 0; i < 500; i += 1) g.wear(4, 4, FeatureKinds.TRAIL, 0.1, ENG.threshold, 1);
    assert.equal(g.at(4, 4).wear, 1);
  });

  test('features are listed in cell order, not in the order they were made', () => {
    // Iteration order is deterministic by rule everywhere in this engine, and a
    // Map iterates by insertion — which would make the payload depend on who
    // walked where first.
    const g = grid();
    wearIn(g, 20, 20);
    wearIn(g, 2, 2);
    wearIn(g, 11, 5);
    const listed = g.features().map((f) => [f.cellX, f.cellY]);
    assert.deepEqual(listed, [
      [2, 2],
      [11, 5],
      [20, 20],
    ]);
  });

  test('the revision moves when a feature appears, not when ground is merely walked on', () => {
    // This is what keeps the layer nearly free to project: wear is written by
    // every moving animal every tick, and only promotion changes what it means.
    const g = grid();
    g.wear(4, 4, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear);
    const quiet = g.revision;
    g.wear(4, 4, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear);
    g.wear(9, 9, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear);
    assert.equal(g.revision, quiet, 'walking about changes nothing');
    wearIn(g, 4, 4);
    assert.ok(g.revision > quiet, 'forming a trail does');
  });
});

describe('engineering: what a feature does', () => {
  test('a trail is quicker to cross and a burrow is shelter — and neither is until it is one', () => {
    const engine = sandbox();
    const features = engine.world.features;
    assert.equal(speedScaleAt(features, 10, 10), 1, 'unworn ground is ordinary ground');
    assert.equal(sheltersAt(features, 10, 10), false);

    // Scuffed but not worn in: still nothing.
    features.wear(10, 10, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear);
    assert.equal(speedScaleAt(features, 10, 10), 1, 'a single pass is not a trail');

    wearIn(features, 10, 10, FeatureKinds.TRAIL);
    assert.equal(speedScaleAt(features, 10, 10), effectsFor(FeatureKinds.TRAIL).speedScale);
    assert.ok(effectsFor(FeatureKinds.TRAIL).speedScale > 1, 'packed ground is faster');
    assert.equal(sheltersAt(features, 10, 10), false, 'but it is not shelter');

    wearIn(features, 20, 20, FeatureKinds.BURROW);
    assert.equal(sheltersAt(features, 20, 20), true);
  });

  test('a trail reaches the movement system through the chokepoint it already used', () => {
    // The point of landing this in `world.speedModifierAt` is that nothing else
    // had to change: the movement system does not know trails exist.
    const engine = sandbox();
    const plain = engine.world.speedModifierAt(10.5, 10.5);
    wearIn(engine.world.features, 10, 10, FeatureKinds.TRAIL);
    assert.equal(engine.world.speedModifierAt(10.5, 10.5), plain * effectsFor(FeatureKinds.TRAIL).speedScale);
    assert.equal(engine.world.speedModifierAt(30.5, 30.5), plain, 'and only there');
  });

  test('a burrow shelters through the chokepoint the weather already used', () => {
    const engine = sandbox();
    assert.equal(engine.world.isShelteredAt(20.5, 20.5), false);
    wearIn(engine.world.features, 20, 20, FeatureKinds.BURROW);
    assert.equal(engine.world.isShelteredAt(20.5, 20.5), true, 'thermoregulation gets this for free');
  });

  test('the trail gradient points at the nearest worn path, and at nothing in an unworn world', () => {
    const engine = sandbox();
    const features = engine.world.features;
    assert.equal(trailGradient(features, 32, 32, { radius: 4 }), null, 'nothing to be drawn to');

    // A trail due east of the animal.
    wearIn(features, 36, 32, FeatureKinds.TRAIL);
    const gradient = trailGradient(features, 32.5, 32.5, { radius: 4 });
    assert.ok(gradient, 'found it');
    assert.ok(Math.abs(Math.atan2(Math.sin(gradient.heading), Math.cos(gradient.heading))) < 1e-9, 'due east');
    assert.ok(gradient.strength > 0);
  });

  test('an animal already on a trail is not pulled anywhere', () => {
    // The strength is a *difference*, so standing on the best ground produces
    // no pull — the same property Step 26's forage gradient has.
    const engine = sandbox();
    const features = engine.world.features;
    wearIn(features, 32, 32, FeatureKinds.TRAIL);
    for (let i = 0; i < 200; i += 1) {
      features.wear(32, 32, FeatureKinds.TRAIL, 0.1, ENG.threshold, ENG.maxWear);
    }
    wearIn(features, 36, 32, FeatureKinds.TRAIL);
    assert.equal(trailGradient(features, 32.5, 32.5, { radius: 4 }), null, 'nowhere better to be');
  });

  test('a burrow does not attract; only a trail does', () => {
    const engine = sandbox();
    wearIn(engine.world.features, 36, 32, FeatureKinds.BURROW);
    assert.equal(trailGradient(engine.world.features, 32.5, 32.5, { radius: 4 }), null);
  });
});

describe('engineering: the system', () => {
  function engineeringEngine(options = {}) {
    const engine = sandbox();
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    engine.registerSystem(new EngineeringSystem({ ...ENG, ...options }));
    return engine;
  }

  test('an animal walking wears the ground it walks on', () => {
    // ⚠ This is the test that would have caught the phase bug. The first cut ran
    // in `environment`, where `lastMoveDistance` is always 0 because the
    // metabolism system consumed and zeroed it in the previous tick's
    // `physiology` — so it wore nothing at all, silently.
    const engine = engineeringEngine();
    spawn(engine, { x: 32, y: 32 });
    engine.step(40);
    assert.ok(engine.world.features.trackedCells > 0, 'the ground remembers being walked on');
  });

  test('wear is per unit of distance, not per tick spent standing in a cell', () => {
    // A slow animal covering a third of a cell should not wear it as much as a
    // fast one crossing it — the first version charged a flat amount per tick
    // and paved 7% of the map.
    const fast = sandbox();
    fast.registerSystem(new EngineeringSystem(ENG));
    const fastId = spawn(fast, { x: 32, y: 32 });
    fast.world.entities.get(fastId).lastMoveDistance = 1.2;
    fast.step(1);

    const slow = sandbox();
    slow.registerSystem(new EngineeringSystem(ENG));
    const slowId = spawn(slow, { x: 32, y: 32 });
    slow.world.entities.get(slowId).lastMoveDistance = 0.4;
    slow.step(1);

    assert.ok(
      fast.world.features.at(32, 32).wear > slow.world.features.at(32, 32).wear * 2,
      'three times the distance wears roughly three times as much',
    );
  });

  test('a resting animal digs instead of wearing', () => {
    const engine = sandbox();
    engine.registerSystem(new EngineeringSystem(ENG));
    const id = spawn(engine, { x: 20, y: 20 });
    const entity = engine.world.entities.get(id);
    entity.action = 'rest';
    entity.lastMoveDistance = 0;
    engine.step(1);
    assert.equal(engine.world.features.at(20, 20).kind, FeatureKinds.BURROW);
  });

  test('digging is slower than wearing, so one nap is not a burrow', () => {
    const engine = sandbox();
    engine.registerSystem(new EngineeringSystem(ENG));
    const id = spawn(engine, { x: 20, y: 20 });
    const entity = engine.world.entities.get(id);
    entity.action = 'rest';
    entity.lastMoveDistance = 0;
    engine.step(1);
    assert.equal(engine.world.features.featureCount, 0, 'sitting down once digs nothing');
  });

  test('forming and losing a feature are announced, and nothing in between is', () => {
    const engine = sandbox();
    engine.registerSystem(new EngineeringSystem({ ...ENG, decayInterval: 5 }));
    const id = spawn(engine, { x: 20, y: 20 });
    const entity = engine.world.entities.get(id);

    const events = [];
    const collect = () => {
      const before = engine.events.lastSeq;
      engine.step(1);
      events.push(...engine.eventsSince(before).filter((e) => e.type === 'environment.feature'));
    };

    // Wear it in, then keep walking on it.
    for (let i = 0; i < 60; i += 1) {
      entity.lastMoveDistance = 1;
      collect();
    }
    const formed = events.filter((e) => e.state === 'formed');
    assert.equal(formed.length, 1, 'announced once, not every tick it is used');
    assert.equal(formed[0].kind, FeatureKinds.TRAIL);
    assert.equal(formed[0].cellX, 20);

    // Now abandon it.
    entity.lastMoveDistance = 0;
    entity.action = 'wander';
    for (let i = 0; i < 900; i += 1) collect();
    const lost = events.filter((e) => e.state === 'lost');
    assert.equal(lost.length, 1, 'and lost once');
  });

  test('the system draws no randomness', () => {
    const withEng = sandbox();
    withEng.registerSystem(new EngineeringSystem(ENG));
    const id = spawn(withEng, { x: 32, y: 32 });
    withEng.world.entities.get(id).lastMoveDistance = 1;
    withEng.step(30);
    assert.ok(withEng.world.features.trackedCells > 0, 'it really did something');

    const without = sandbox();
    spawn(without, { x: 32, y: 32 });
    without.step(30);
    assert.deepEqual(captureSimulationState(withEng).randomStreams, captureSimulationState(without).randomStreams);
  });

  test('disabled is completely inert', () => {
    const engine = engineeringEngine({ enabled: false });
    spawn(engine, { x: 32, y: 32 });
    engine.step(200);
    assert.equal(engine.world.features.trackedCells, 0);
    assert.equal(engine.world.features.featureCount, 0);
  });

  test('a trail bends an aimless wander toward it', () => {
    // The step's demonstration: a trail must bias later movement, not merely be
    // quicker underfoot. Asserted on the heading distribution rather than on
    // where animals ended up, for the reasons §1.4 D15 records.
    function eastwardness(withTrail) {
      const engine = sandbox({ seed: 11 });
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
      engine.registerSystem(new EngineeringSystem({ ...ENG, driftInterval: 1 }));

      if (withTrail) {
        // A well-worn path due east, beyond the animals' own footprints.
        for (let y = 28; y <= 36; y += 1) {
          for (let i = 0; i < 60; i += 1) {
            engine.world.features.wear(36, y, FeatureKinds.TRAIL, 0.1, ENG.threshold, ENG.maxWear);
          }
        }
      }
      const ids = [];
      for (let i = 0; i < 16; i += 1) ids.push(spawn(engine, { x: 32.5, y: 28.5 + (i % 8), energy: 90 }));

      let sum = 0;
      let n = 0;
      for (let t = 0; t < 200; t += 1) {
        engine.step(1);
        for (const id of ids) {
          const entity = engine.world.entities.get(id);
          if (entity.action !== 'wander' || !entity.moveIntent) continue;
          sum += Math.cos(entity.moveIntent.heading);
          n += 1;
        }
      }
      assert.ok(n > 300, `enough wander commitments to measure (${n})`);
      return sum / n;
    }

    const pulled = eastwardness(true);
    const control = eastwardness(false);
    assert.ok(Math.abs(control) < 0.12, `an unbiased walk has no direction (got ${control.toFixed(3)})`);
    assert.ok(pulled > control + 0.1, `the trail pulled them east (${pulled.toFixed(3)} vs ${control.toFixed(3)})`);
  });
});

describe('engineering: protocol, persistence, and the demo', () => {
  test('features ride in snapshots and are revision-gated in deltas', () => {
    const engine = sandbox();
    engine.registerSystem(new EngineeringSystem(ENG));
    wearIn(engine.world.features, 12, 12, FeatureKinds.TRAIL);

    const base = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(base.features.cells.length, 1);
    assert.deepEqual(
      { cellX: base.features.cells[0].cellX, cellY: base.features.cells[0].cellY, kind: base.features.cells[0].kind },
      { cellX: 12, cellY: 12, kind: FeatureKinds.TRAIL },
    );

    // A tick where nothing forms or fades carries no feature payload at all.
    const previous = engine.getSnapshotData();
    engine.step(1);
    const quiet = buildDeltaSnapshot(previous, engine.getSnapshotData(), []);
    assert.equal(quiet.features, undefined, 'unchanged features cost a delta nothing');
    assert.deepEqual(applyDeltaSnapshot(base, quiet).features.cells, base.features.cells, 'and persist through it');

    // A tick where one forms does.
    const beforeNew = engine.getSnapshotData();
    wearIn(engine.world.features, 40, 40, FeatureKinds.TRAIL);
    engine.step(1);
    const changed = buildDeltaSnapshot(beforeNew, engine.getSnapshotData(), []);
    assert.ok(changed.features, 'a new trail is carried');
    assert.equal(changed.features.cells.length, 2);
  });

  test('scuffed ground is never projected — only what became something', () => {
    const engine = sandbox();
    engine.registerSystem(new EngineeringSystem(ENG));
    for (let i = 0; i < 30; i += 1) {
      engine.world.features.wear(i, 5, FeatureKinds.TRAIL, ENG.trailWearPerUnit, ENG.threshold, ENG.maxWear);
    }
    assert.equal(engine.world.features.trackedCells, 30, 'plenty of scuffed ground');
    assert.equal(buildFullSnapshot(engine.getSnapshotData()).features.cells.length, 0, 'and none of it projected');
  });

  test('worn ground survives save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 13 });
    // Step until something has actually been worn in, so the save has features
    // in it — otherwise this passes by saving nothing (§1.4 D5).
    let guard = 0;
    while (engine.world.features.featureCount === 0 && guard < 8000) {
      engine.step(1);
      guard += 1;
    }
    assert.ok(engine.world.features.featureCount > 0, 'a feature existed when the save was taken');

    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));
    assert.ok(saved.features.cells.length > 0, 'and it is in the save');

    const restored = restoreDemoSimulation(saved);
    assert.equal(restored.world.features.featureCount, engine.world.features.featureCount);
    assert.deepEqual(restored.world.features.serialize(), engine.world.features.serialize());

    engine.step(400);
    restored.step(400);
    const summarize = (e) => [...e.world.entities.all()].map((en) => [en.id, en.x, en.y]);
    assert.deepEqual(summarize(restored), summarize(engine), 'a restored run is not merely similar');
    assert.deepEqual(restored.world.features.serialize(), engine.world.features.serialize());
  });

  test('the demo wears trails into the ground', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const seen = { formed: 0, lost: 0 };
    let peak = 0;
    for (let i = 0; i < 6000; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type !== 'environment.feature') continue;
        seen[e.state === 'formed' ? 'formed' : 'lost'] += 1;
      }
      if (engine.world.features.featureCount > peak) peak = engine.world.features.featureCount;
    }
    assert.ok(seen.formed > 0, 'ground was worn in');
    assert.ok(seen.lost > 0, 'and abandoned ground faded again');
    assert.ok(peak > 10, `trails are a visible thing, not a curiosity (peak ${peak})`);
    // The cap is a bound, not a target: the demo should sit far below it.
    assert.ok(engine.world.features.trackedCells < ENG.maxCells, 'nowhere near the tracking cap');
  });

  test('disabling engineering leaves the demo exactly as Step 27 left it', () => {
    const engine = createDemoSimulation({ seed: 42, config: { engineering: { enabled: false } } });
    const events = [];
    for (let i = 0; i < 1500; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      events.push(...engine.eventsSince(before).filter((e) => e.type === 'environment.feature'));
    }
    assert.equal(events.length, 0);
    assert.equal(engine.world.features.trackedCells, 0);
    for (const entity of engine.world.entities.all()) {
      assert.equal(entity.trailStrength, 0, `entity ${entity.id} felt no trail`);
    }
  });

  test('the demo stays deterministic with engineering in it', () => {
    const a = createDemoSimulation({ seed: 64 });
    const b = createDemoSimulation({ seed: 64 });
    a.step(900);
    b.step(900);
    assert.deepEqual(captureSimulationState(b), captureSimulationState(a));
  });
});
