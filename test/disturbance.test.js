import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { DisturbanceSystem, IGNITION_DRAWS } from '../src/simulation/systems/DisturbanceSystem.js';
import { VegetationSystem } from '../src/simulation/systems/VegetationSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import {
  DisturbanceKinds,
  covers,
  disturbanceAt,
  effectsFor,
  isActive,
  speedScaleAt,
  temperatureShiftAt,
} from '../src/simulation/disturbance/disturbances.js';
import { thermalStress } from '../src/simulation/world/Environment.js';
import { MemoryKinds } from '../src/simulation/memory/memories.js';
import { InjuryKinds } from '../src/simulation/injury/injuries.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { buildFullSnapshot, buildDeltaSnapshot, applyDeltaSnapshot } from '../src/protocol/snapshots.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.gazelle');

function genomeWith(overrides = {}) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [overrides[locus] ?? 1, overrides[locus] ?? 1]]));
}

function sandbox({ seed = 4, config = {} } = {}) {
  return new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
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

/** Place a disturbance directly, so a test measures effects rather than the RNG. */
function ignite(engine, { kind = DisturbanceKinds.FIRE, x = 32, y = 32, radius = 8, ticks = 300 } = {}) {
  const disturbance = {
    id: engine.world.nextDisturbanceId++,
    kind,
    x,
    y,
    radius,
    startedTick: engine.clock.tick,
    until: engine.clock.tick + ticks,
  };
  engine.world.disturbances.push(disturbance);
  return disturbance;
}

/** Total biomass over a cell rectangle. */
function biomassIn(engine, { minX, minY, maxX, maxY }) {
  let sum = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) sum += engine.world.vegetation.biomassAt(x, y);
  }
  return sum;
}

describe('disturbances: the record and its geometry', () => {
  const fire = { id: 1, kind: DisturbanceKinds.FIRE, x: 30, y: 30, radius: 5, startedTick: 0, until: 100 };

  test('a disturbance covers a disc, and nothing outside it', () => {
    assert.equal(covers(fire, 30, 30), true, 'the centre');
    assert.equal(covers(fire, 34.9, 30), true, 'just inside');
    assert.equal(covers(fire, 35.1, 30), false, 'just outside');
    // The diagonal is the case a naive bounding-box test gets wrong.
    assert.equal(covers(fire, 34, 34), false, 'the corner of the bounding box is not inside the disc');
  });

  test('an empty list is answered without touching geometry at all', () => {
    // The early exit is not an optimization detail — `speedModifierAt` runs for
    // every moving animal every tick, and the demo has nothing running most of
    // the time. Pinned so a refactor cannot quietly make quiet ticks expensive.
    assert.equal(disturbanceAt([], 5, 5), null);
    assert.equal(speedScaleAt([], 5, 5), 1);
    assert.equal(temperatureShiftAt([], 5, 5), 0);
  });

  test('effects come from the table, and clear ground is unaffected', () => {
    const flood = { ...fire, kind: DisturbanceKinds.FLOOD };
    assert.equal(speedScaleAt([flood], 30, 30), effectsFor(DisturbanceKinds.FLOOD).speedScale);
    assert.equal(speedScaleAt([flood], 0, 0), 1, 'outside is ordinary ground');
    const storm = { ...fire, kind: DisturbanceKinds.STORM };
    assert.equal(temperatureShiftAt([storm], 30, 30), effectsFor(DisturbanceKinds.STORM).temperatureShift);
    assert.equal(temperatureShiftAt([storm], 0, 0), 0);
  });

  test('overlaps take the first match rather than stacking', () => {
    // Stacking multiplicatively would let an unlucky pair produce a combination
    // neither kind describes.
    const flood = { ...fire, kind: DisturbanceKinds.FLOOD };
    const storm = { ...fire, id: 2, kind: DisturbanceKinds.STORM };
    assert.equal(speedScaleAt([flood, storm], 30, 30), effectsFor(DisturbanceKinds.FLOOD).speedScale);
  });

  test('a disturbance is over on the tick it says it is', () => {
    assert.equal(isActive(fire, 99), true);
    assert.equal(isActive(fire, 100), false);
  });
});

describe('disturbances: lifecycle', () => {
  function lifecycleEngine(options = {}) {
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ...options }));
    return engine;
  }

  test('the draw budget is fixed, whatever the outcome', () => {
    // The convention is that a system spends the same draws regardless of what
    // happens. Proved by running two worlds whose ignition outcomes differ
    // completely — one can never ignite because the active list is capped at
    // zero — and asserting the `disturbance` stream lands in the same place.
    const igniting = lifecycleEngine({ ignitionChance: 1, updateInterval: 50 });
    const barren = lifecycleEngine({ ignitionChance: 1, updateInterval: 50, maxActive: 0 });
    igniting.step(500);
    barren.step(500);

    assert.ok(igniting.world.disturbances.length > 0, 'one world really did ignite');
    assert.equal(barren.world.disturbances.length, 0, 'and the other really did not');
    assert.deepEqual(
      captureSimulationState(barren).randomStreams.disturbance,
      captureSimulationState(igniting).randomStreams.disturbance,
      'both spent the same draws',
    );
  });

  test('an ignition check spends exactly IGNITION_DRAWS', () => {
    const engine = lifecycleEngine({ ignitionChance: 0, updateInterval: 50 });
    const stream = engine.randomStream('disturbance');
    let draws = 0;
    const realNext = stream.next.bind(stream);
    stream.next = () => {
      draws += 1;
      return realNext();
    };
    engine.step(50); // exactly one check
    assert.equal(draws, IGNITION_DRAWS);
    engine.step(50); // exactly one more
    assert.equal(draws, IGNITION_DRAWS * 2);
  });

  test('a disturbance is announced when it starts and once when it stops', () => {
    const engine = lifecycleEngine({ ignitionChance: 0 });
    const fire = ignite(engine, { ticks: 40 });

    const started = [];
    const settled = [];
    for (let i = 0; i < 80; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      // Collected tick by tick — §1.4 D13: `eventsSince` after a long step
      // measures what survived the bounded outbox, not what happened.
      for (const e of engine.eventsSince(before)) {
        if (e.type === 'environment.disturbed') started.push(e);
        if (e.type === 'environment.settled') settled.push(e);
      }
    }
    assert.equal(started.length, 0, 'this one was placed by hand, not ignited');
    assert.equal(settled.length, 1, 'announced exactly once, not every tick after it ended');
    assert.equal(settled[0].disturbanceId, fire.id);
    assert.equal(settled[0].durationTicks, 40, 'and says how long it actually lasted');
    assert.equal(engine.world.disturbances.length, 0, 'and is gone from the world');
  });

  test('the active list is capped', () => {
    const engine = lifecycleEngine({ ignitionChance: 1, updateInterval: 10, maxActive: 2, minDurationTicks: 5000, maxDurationTicks: 6000 });
    engine.step(400);
    assert.equal(engine.world.disturbances.length, 2, 'never exceeds maxActive');
  });

  test('nothing ever starts on ground an animal could not stand on', () => {
    // Asserted as an invariant over many ignitions in a world that actually has
    // water and rock, rather than by contriving one position — a fire on a lake
    // is the kind of thing that looks fine until someone watches it.
    const engine = new SimulationEngine({ seed: 9, config: { world: { width: 96, height: 96 } } });
    // Short-lived so the cap does not throttle the sample: what is being
    // measured is *where* they start, and that needs many of them.
    engine.registerSystem(
      new DisturbanceSystem({
        ...CONFIG.disturbance,
        ignitionChance: 1,
        updateInterval: 5,
        minDurationTicks: 4,
        maxDurationTicks: 6,
      }),
    );
    const seen = [];
    for (let i = 0; i < 600; i += 1) {
      engine.step(1);
      for (const d of engine.world.disturbances) {
        if (!seen.some((s) => s.id === d.id)) seen.push({ ...d });
      }
    }
    assert.ok(seen.length > 5, `enough ignitions to mean something (${seen.length})`);
    for (const d of seen) {
      assert.ok(engine.world.isPassableAt(d.x, d.y), `disturbance ${d.id} started on passable ground`);
    }
  });

  test('disabled is completely inert', () => {
    const engine = lifecycleEngine({ enabled: false, ignitionChance: 1, updateInterval: 10 });
    engine.step(500);
    assert.equal(engine.world.disturbances.length, 0);
    assert.equal(engine.world.nextDisturbanceId, 1, 'not even an id was consumed');
  });

  test('a world can be given only some kinds', () => {
    const engine = lifecycleEngine({ ignitionChance: 1, updateInterval: 10, kinds: [DisturbanceKinds.FLOOD] });
    engine.step(300);
    assert.ok(engine.world.disturbances.length > 0);
    for (const d of engine.world.disturbances) assert.equal(d.kind, DisturbanceKinds.FLOOD);
  });
});

describe('disturbances: what they do', () => {
  test('a fire takes the standing crop inside its region and nothing outside it', () => {
    // "Effects bounded to the region" is an explicit acceptance criterion, so
    // the control rectangle is asserted as hard as the burnt one.
    // Ignited through the system, so this exercises the real scour path rather
    // than a hand-rolled copy of it.
    const engine = sandbox({ seed: 6 });
    engine.registerSystem(
      new DisturbanceSystem({
        ...CONFIG.disturbance,
        kinds: [DisturbanceKinds.FIRE],
        ignitionChance: 1,
        updateInterval: 1,
        minRadius: 8,
        maxRadius: 8,
      }),
    );
    const totalBefore = engine.world.vegetation.totalBiomass();
    engine.step(1);

    const fire = engine.world.disturbances[0];
    assert.ok(fire, 'something ignited');
    assert.ok(engine.world.vegetation.totalBiomass() < totalBefore, 'it burned something');

    // Every cell outside the disc is untouched — the acceptance criterion is
    // "effects bounded to the region", so the boundary is what gets asserted.
    const control = new SimulationEngine({
      seed: 6,
      config: { world: { width: 64, height: 64 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 } },
    });
    let burntOutside = 0;
    let burntInside = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const lost = control.world.vegetation.biomassAt(x, y) - engine.world.vegetation.biomassAt(x, y);
        if (lost <= 1e-6) continue;
        if (covers(fire, x + 0.5, y + 0.5)) burntInside += 1;
        else burntOutside += 1;
      }
    }
    assert.ok(burntInside > 0, 'cells inside the region lost forage');
    assert.equal(burntOutside, 0, 'and not one cell outside it did');
  });

  test('a fire destroys forage, and the land grows back', () => {
    // The demonstration scenario. Recovery is asserted against an unburnt
    // control region in the same world, so seasonal growth cannot be mistaken
    // for recovery.
    const engine = sandbox({ seed: 4 });
    const { growthRate, seedFloor, diebackRate, updateInterval } = CONFIG.vegetation;
    engine.registerSystem(new VegetationSystem({ growthRate, seedFloor, diebackRate, updateInterval }));
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    engine.step(400); // let the field fill in

    const burnt = { minX: 26, minY: 26, maxX: 38, maxY: 38 };
    const control = { minX: 0, minY: 0, maxX: 12, maxY: 12 };
    const before = biomassIn(engine, burnt);
    const controlBefore = biomassIn(engine, control);

    // Placed and scoured at a known centre, so the measurement is about
    // recovery rather than about where the RNG put the fire.
    const fire = ignite(engine, { x: 32, y: 32, radius: 8, ticks: 100 });
    for (let y = 24; y <= 40; y += 1) {
      for (let x = 24; x <= 40; x += 1) {
        if (!covers(fire, x + 0.5, y + 0.5)) continue;
        const standing = engine.world.vegetation.biomassAt(x, y);
        if (standing > 0) engine.world.vegetation.consumeAt(x, y, standing * effectsFor(DisturbanceKinds.FIRE).vegetationLoss);
      }
    }

    const scorched = biomassIn(engine, burnt);
    assert.ok(scorched < before * 0.4, `most of the forage is gone (${scorched.toFixed(0)} of ${before.toFixed(0)})`);

    engine.step(600);
    const recovered = biomassIn(engine, burnt);
    assert.ok(recovered > before * 0.9, `and it grew back (${recovered.toFixed(0)} of ${before.toFixed(0)})`);
    assert.ok(
      Math.abs(biomassIn(engine, control) - controlBefore) < controlBefore * 0.1,
      'while the unburnt control barely moved — so this is recovery, not a season turning',
    );
  });

  test('an animal caught in a fire is burned, remembers the place, and can die there', () => {
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0, burnInterval: 5 }));
    ignite(engine, { x: 32, y: 32, radius: 6, ticks: 400 });
    const insideId = spawn(engine, { x: 32, y: 32 });
    const outsideId = spawn(engine, { x: 5, y: 5 });

    engine.step(30);
    const inside = engine.world.entities.get(insideId);
    assert.ok(inside.impairment > 0, 'burned');
    assert.ok(inside.injuries.some((i) => i.kind === InjuryKinds.BURN), 'and the wound says how');
    assert.ok(
      inside.memories.some((m) => m.kind === MemoryKinds.DANGER),
      'and it learned the place is dangerous — which is the whole of the avoidance behaviour',
    );
    assert.ok(inside.health < GRAZER.maxHealth, 'and it is hurt');

    const outside = engine.world.entities.get(outsideId);
    assert.equal(outside.impairment, 0, 'an animal outside the region is untouched');
    assert.equal(outside.health, GRAZER.maxHealth);
    assert.equal(outside.memories.length, 0);

    // Mortality, only inside. Standing in a fire long enough is fatal.
    engine.step(300);
    const died = engine.world.entities.get(insideId);
    assert.equal(died.alive, false, 'staying in a fire kills');
    assert.equal(died.deathCause, 'disturbance');
    assert.equal(engine.world.entities.get(outsideId).alive, true, 'mortality is bounded to the region too');
  });

  test('a burn is reported once per interval, not once per tick', () => {
    // §1.4 C3: event volume is a budget. An animal in a 400-tick fire should
    // not produce 400 injury events.
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0, burnInterval: 25 }));
    ignite(engine, { x: 32, y: 32, radius: 6, ticks: 400 });
    spawn(engine, { x: 32, y: 32 });

    const burns = [];
    for (let i = 0; i < 100; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      burns.push(...engine.eventsSince(before).filter((e) => e.type === 'entity.injured' && e.injury === InjuryKinds.BURN));
    }
    assert.ok(burns.length <= 5, `at most one per 25 ticks (got ${burns.length})`);
    assert.ok(burns.length >= 3, 'but it really is burning');
    assert.equal(burns[0].sourceId, null, 'nobody did this to it');
  });

  test('a flood slows an animal down, and stops doing so when it drains', () => {
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    const clear = engine.world.speedModifierAt(32, 32);
    const flood = ignite(engine, { kind: DisturbanceKinds.FLOOD, x: 32, y: 32, radius: 8, ticks: 20 });

    const wading = engine.world.speedModifierAt(32, 32);
    assert.ok(wading < clear, `wading is slower (${wading} vs ${clear})`);
    assert.equal(wading, clear * effectsFor(DisturbanceKinds.FLOOD).speedScale);
    assert.equal(engine.world.speedModifierAt(2, 2), clear, 'ground outside is unaffected');

    engine.step(25);
    assert.equal(engine.world.disturbances.length, 0, 'the flood drained');
    assert.equal(
      engine.world.speedModifierAt(32, 32),
      clear,
      'and the ground is ordinary again — no un-flooding pass was needed, because nothing was ever written',
    );
    assert.ok(flood.radius > 0);
  });

  test('an animal can always struggle out of a flood', () => {
    // Deliberately slow rather than impassable: the movement system refuses
    // impassable target cells, so a region of them would wall an animal in with
    // no way out. This pins the reason.
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    ignite(engine, { kind: DisturbanceKinds.FLOOD, x: 32, y: 32, radius: 10, ticks: 5000 });
    const id = spawn(engine, { x: 32, y: 32 });

    engine.step(600);
    const entity = engine.world.entities.get(id);
    const travelled = Math.hypot(entity.x - 32, entity.y - 32);
    assert.ok(travelled > 2, `it moved rather than being walled in (${travelled.toFixed(1)} units)`);
    assert.equal(entity.alive, true, 'and a flood does not kill on contact');
  });

  test('a storm makes it colder where it is, and only where it is', () => {
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    const insideId = spawn(engine, { x: 32, y: 32 });
    const outsideId = spawn(engine, { x: 4, y: 4 });
    // Cold enough that the shift pushes the inside animal out of its band.
    engine.world.environment = { ...engine.world.environment, temperature: GRAZER.comfortMin + 1 };
    ignite(engine, { kind: DisturbanceKinds.STORM, x: 32, y: 32, radius: 8, ticks: 100 });

    const inside = thermalStress(engine.world, engine.world.entities.get(insideId), 0);
    const outside = thermalStress(engine.world, engine.world.entities.get(outsideId), 0);
    assert.equal(outside, 0, 'outside the storm the weather is what it was');
    assert.ok(inside > 0, `inside it, the animal is paying to stay warm (${inside.toFixed(1)}°C of stress)`);
  });
});

describe('disturbances: protocol, persistence, and the demo', () => {
  test('the active regions ride in snapshots and deltas, and a delta reproduces them', () => {
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    ignite(engine, { x: 20, y: 20, radius: 7, ticks: 500 });

    const base = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(base.disturbances.length, 1);
    assert.equal(base.disturbances[0].kind, DisturbanceKinds.FIRE);
    assert.equal(base.disturbances[0].radius, 7);

    const previous = engine.getSnapshotData();
    engine.step(1);
    const delta = buildDeltaSnapshot(previous, engine.getSnapshotData(), []);
    const reconstructed = applyDeltaSnapshot(base, delta);
    assert.deepEqual(reconstructed.disturbances, buildFullSnapshot(engine.getSnapshotData()).disturbances);
  });

  test('a delta saying "nothing is burning any more" clears the region', () => {
    // The `??` guard: an empty list is the *message*, not the absence of one.
    // Treating it as falsy would leave a renderer drawing a fire that went out.
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    ignite(engine, { x: 20, y: 20, radius: 7, ticks: 2 });
    const base = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(base.disturbances.length, 1);

    const previous = engine.getSnapshotData();
    engine.step(3);
    const delta = buildDeltaSnapshot(previous, engine.getSnapshotData(), []);
    assert.deepEqual(delta.disturbances, [], 'the delta carries the empty list');
    assert.deepEqual(applyDeltaSnapshot(base, delta).disturbances, [], 'and applying it clears the fire');
  });

  test('inspection says whether this animal is standing in it', () => {
    const engine = sandbox();
    engine.registerSystem(new DisturbanceSystem({ ...CONFIG.disturbance, ignitionChance: 0 }));
    ignite(engine, { x: 32, y: 32, radius: 6, ticks: 500 });
    const insideId = spawn(engine, { x: 32, y: 32 });
    const outsideId = spawn(engine, { x: 4, y: 4 });
    engine.step(1);

    assert.equal(engine.getEntityDetails(insideId).caughtIn.kind, DisturbanceKinds.FIRE);
    assert.equal(engine.getEntityDetails(outsideId).caughtIn, null);
  });

  test('an active disturbance survives save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 13 });
    // Step until something is actually running, so the save has one in it —
    // otherwise this test passes by saving nothing (§1.4 D5).
    let guard = 0;
    while (engine.world.disturbances.length === 0 && guard < 6000) {
      engine.step(1);
      guard += 1;
    }
    assert.ok(engine.world.disturbances.length > 0, 'a disturbance was running when the save was taken');

    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));
    assert.ok(saved.disturbances.length > 0, 'and it is in the save');
    assert.ok(saved.nextDisturbanceId > 1, 'along with the id counter, so a restore cannot reissue an id');

    const restored = restoreDemoSimulation(saved);
    assert.deepEqual(restored.world.disturbances, engine.world.disturbances);

    engine.step(500);
    restored.step(500);
    const summarize = (e) => [...e.world.entities.all()].map((en) => [en.id, en.x, en.y, en.health, en.impairment]);
    assert.deepEqual(summarize(restored), summarize(engine), 'a restored run is not merely similar');
    assert.deepEqual(restored.world.disturbances, engine.world.disturbances);
  });

  test('the demo raises disturbances, hurts animals with them, and lets the land recover', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const started = {};
    let settled = 0;
    let burns = 0;
    for (let i = 0; i < 6000; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) {
        if (e.type === 'environment.disturbed') started[e.kind] = (started[e.kind] ?? 0) + 1;
        if (e.type === 'environment.settled') settled += 1;
        if (e.type === 'entity.injured' && e.injury === InjuryKinds.BURN) burns += 1;
      }
    }
    const total = Object.values(started).reduce((a, b) => a + b, 0);
    assert.ok(total > 0, 'disturbances happen');
    assert.ok(settled > 0, 'and they end — the land is not permanently disturbed');
    assert.ok(burns > 0, 'and animals really are caught in them');
    assert.ok(engine.world.disturbances.length <= CONFIG.disturbance.maxActive, 'never more than the cap');
  });

  test('disabling disturbances leaves the demo exactly as Step 26 left it', () => {
    const engine = createDemoSimulation({ seed: 42, config: { disturbance: { enabled: false } } });
    const events = [];
    for (let i = 0; i < 2000; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      events.push(
        ...engine.eventsSince(before).filter((e) => e.type === 'environment.disturbed' || e.type === 'environment.settled'),
      );
    }
    assert.equal(events.length, 0);
    assert.equal(engine.world.disturbances.length, 0);
    for (const entity of engine.world.entities.all()) {
      assert.ok(
        !entity.injuries?.some((i) => i.kind === InjuryKinds.BURN),
        `entity ${entity.id} was never burned`,
      );
    }
  });

  test('the demo stays deterministic with disturbances in it', () => {
    const a = createDemoSimulation({ seed: 31 });
    const b = createDemoSimulation({ seed: 31 });
    a.step(900);
    b.step(900);
    assert.deepEqual(captureSimulationState(b), captureSimulationState(a));
  });
});
