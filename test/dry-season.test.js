/**
 * The dry-season map (SEASON-PLAN.md D5) — the phase where the world actually
 * drains.
 *
 * ⚠⚠ **What is being tested is a *second reading* of the terrain, not a mutation
 * of it.** DOCS §7's rule is that terrain is derived and unsaved so nothing may
 * mutate it; the dry map keeps that rule by being computed from the seed exactly
 * as the wet map is, and regenerated identically on load. A season chooses which
 * of the two the world is looking at. Several tests below exist purely to hold
 * that distinction: the round trip is byte-identical, the off state allocates
 * nothing, and a restored save is drained before anything reads a cell.
 *
 * Sandbox-tier throughout except the three that need the demo's own terrain,
 * which is the map the feature is actually about.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, TerrainType, WaterSource } from '../src/simulation/world/TerrainGrid.js';
import { VegetationGrid } from '../src/simulation/world/VegetationGrid.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { WeatherSystem } from '../src/simulation/systems/WeatherSystem.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { phaseAt } from '../src/simulation/world/Environment.js';
// ⚠ Imported under a different name: `Environment.js` exports a `PHASES` too, and
// that one is the four phases of the *year*. These are the tick's system phases.
import { PHASES as SYSTEM_PHASES } from '../src/simulation/engine/SystemScheduler.js';
import { buildFullSnapshot, buildDeltaSnapshot } from '../src/protocol/snapshots.js';
import { RendererStore } from '../src/renderer/app/state/RendererStore.js';
import { smallDemo } from './helpers/smallDemo.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import { evictStranded } from '../src/simulation/world/stranding.js';

const CONFIG = new SimulationEngine().config;
const ENV = CONFIG.environment;

/** A world with all four water features, big enough that each leaves a mark. */
const watery = (seed, overrides = {}) =>
  new TerrainGrid({
    width: 96,
    height: 96,
    seed,
    params: { lakes: 1, smallLakes: 2, streams: 1, marshFraction: 0.08, ...overrides },
  });

/** Every cell index whose provenance is `source`. */
const cellsFrom = (grid, source) => {
  const found = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.waterSourceAt(x, y) === source) found.push([x, y]);
    }
  }
  return found;
};

describe('the dry map: the four rules', () => {
  test('the stream dries completely', () => {
    const grid = watery(3);
    const stream = cellsFrom(grid, WaterSource.STREAM);
    assert.ok(stream.length > 0, `the world has a stream (${stream.length} cells)`);
    grid.setSeason('dry');
    for (const [x, y] of stream) {
      assert.equal(grid.codeAt(x, y), TerrainType.DRY_BED, `stream cell ${x},${y} still holds water`);
    }
  });

  test('a pond draws down to 75% of its area rather than vanishing', () => {
    // ⚠ A wider pond than the demo's, deliberately. At `smallLakeRadiusFraction`
    // 0.045 on a 96-cell world a pond is ~4 cells across and rasterizes to about a
    // dozen cells, where "75% of the area" is two or three cells either way and
    // the measurement is quantization rather than the rule. This asks the question
    // at a size where the answer means something.
    const grid = watery(3, { smallLakeRadiusFraction: 0.12 });
    const pond = cellsFrom(grid, WaterSource.POND);
    assert.ok(pond.length > 20, `the world has ponds worth measuring (${pond.length} cells)`);
    grid.setSeason('dry');
    let held = 0;
    for (const [x, y] of pond) {
      if (grid.codeAt(x, y) === TerrainType.WATER) held += 1;
      else assert.equal(grid.codeAt(x, y), TerrainType.DRY_BED);
    }
    // ⚠ The band is wide on purpose. The rule scales a *disc*, and the cells it
    // keeps are the ones a clipped, rasterized pond happens to have inside the
    // shrunk radius — a pond cut in half by the coast or by the lake keeps a
    // different share of itself than a whole one does. What must hold is that a
    // pond draws down substantially and **does not disappear**, which is the
    // decision this rule encodes; the exact fraction is geometry.
    const share = held / pond.length;
    assert.ok(share > 0.35 && share < 0.95, `a pond draws down but survives (${held}/${pond.length} = ${share.toFixed(2)})`);
  });

  test('⚠⚠ the lake inverts: the ring dries and the impassable core becomes drinkable', () => {
    // The ecological heart of the feature. The one water in this world an animal
    // cannot reach becomes the only one it can.
    const grid = watery(3, { lakeDeepFraction: 0.55 });
    const ring = cellsFrom(grid, WaterSource.LAKE);
    const core = cellsFrom(grid, WaterSource.LAKE_CORE);
    assert.ok(ring.length > 0 && core.length > 0, `a lake with both (${ring.length} ring, ${core.length} core)`);
    for (const [x, y] of core) assert.equal(grid.isPassable(x, y), false, 'the core is unreachable in the wet season');

    grid.setSeason('dry');
    for (const [x, y] of ring) assert.equal(grid.codeAt(x, y), TerrainType.DRY_BED, `ring cell ${x},${y} did not dry`);
    for (const [x, y] of core) {
      assert.equal(grid.codeAt(x, y), TerrainType.WATER, `core cell ${x},${y} did not become shallow`);
      assert.equal(grid.isPassable(x, y), true, 'and an animal can now reach it');
    }
    assert.equal(grid.countByType()[TerrainType.DEEP_WATER], 0, 'no deep water survives the dry season');
  });

  test('the marsh keeps a minority of its pools', () => {
    const grid = watery(3);
    const pools = cellsFrom(grid, WaterSource.MARSH);
    assert.ok(pools.length > 50, `the marsh has pools worth counting (${pools.length})`);
    grid.setSeason('dry');
    let held = 0;
    for (const [x, y] of pools) {
      const code = grid.codeAt(x, y);
      assert.ok(code === TerrainType.WATER || code === TerrainType.DRY_BED);
      if (code === TerrainType.WATER) held += 1;
    }
    // `marshDryRetention` is 0.18 and this is a per-cell draw, so the realized
    // share is binomial around it — a band rather than the number, with the
    // sample size stated: n is the pool count above.
    const share = held / pools.length;
    assert.ok(share > 0.1 && share < 0.28, `about a fifth of the pools hold (${held}/${pools.length} = ${share.toFixed(3)})`);
  });

  test('nothing that is not water changes at all', () => {
    // The dry season drains water. It does not move rock, fell trees, or clear
    // thicket — and the switch statement that would let it is one missing
    // `break` away.
    const grid = watery(5);
    const before = [];
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) before.push(grid.codeAt(x, y));
    }
    grid.setSeason('dry');
    let i = 0;
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1, i += 1) {
        const wet = before[i];
        if (wet === TerrainType.WATER || wet === TerrainType.DEEP_WATER) continue;
        assert.equal(grid.codeAt(x, y), wet, `dry land at ${x},${y} changed from ${wet}`);
      }
    }
  });
});

describe('the dry map: the invariants that make it safe', () => {
  test('⚠⚠ every cell passable in the wet season is passable in the dry one', () => {
    // Drying only ever *adds* connectivity — shallow water becomes a passable bed,
    // deep water becomes passable shallows — so `#ensureConnectivity`'s guarantee
    // holds on the dry map without running the pass twice.
    //
    // ⚠⚠ **This comment used to end "and no animal can be stranded by a season
    // change. That is the claim; this is the check." It was not the check.** This
    // asserts the *safe* direction. The dangerous one is its converse — a cell the
    // dry map opens and the wet map closes again — and the lake core is exactly
    // that: `LAKE_CORE` is `DEEP_WATER` when wet and shallow `WATER` when dry, so
    // animals walk in to drink and the returning wet season seals them inside.
    // Measured on the demo before anything was done about it: 30 and 39 animals
    // caught at one turn on two seeds, 24 and 20 of them dead before the map let
    // go. The converse now has its own suite below, and the strand has a fix
    // (`world/stranding.js`) — but the pair is the lesson: **a stated claim and
    // the assertion under it drifted apart, and the comment was the confident
    // half.**
    for (const seed of [1, 2, 3, 5, 7]) {
      const grid = watery(seed);
      const wetPassable = [];
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) if (grid.isPassable(x, y)) wetPassable.push([x, y]);
      }
      grid.setSeason('dry');
      for (const [x, y] of wetPassable) {
        assert.ok(grid.isPassable(x, y), `seed ${seed}: ${x},${y} was passable when wet and is not when dry`);
      }
    }
  });

  test('a full wet → dry → wet cycle returns the map exactly where it started', () => {
    const grid = watery(11);
    const start = grid.toRunLength();
    grid.setSeason('dry');
    assert.notDeepEqual(grid.toRunLength(), start, 'the dry map is genuinely different');
    grid.setSeason('wet');
    assert.deepEqual(grid.toRunLength(), start, 'and the wet map is byte-identical to where it began');
  });

  test('⚠ the off state allocates nothing and turns nothing', () => {
    const on = watery(11);
    const off = watery(11, { dryTerrain: false });
    // The generated world is identical either way: the dry pass reads the wet map
    // and writes a separate array, and it is the last pass in the generator, so
    // the draws it does not spend cannot shift anything.
    assert.deepEqual(off.toRunLength(), on.toRunLength());
    assert.equal(off.hasDryMap, false);
    assert.equal(on.hasDryMap, true);
    // And asking for the dry season does nothing rather than failing.
    assert.equal(off.setSeason('dry'), false, 'the swap reports that nothing moved');
    assert.equal(off.season, 'wet');
    assert.deepEqual(off.toRunLength(), on.toRunLength(), 'still the wet map');
  });

  test('the revision moves only when the active map does', () => {
    // The engine memoizes a projection of the terrain and needs to know when that
    // memo went stale. Terrain is static *per season*, which is a weaker promise
    // than "static" and is why this number exists.
    const grid = watery(2);
    assert.equal(grid.revision, 0);
    assert.equal(grid.setSeason('wet'), false, 'already wet');
    assert.equal(grid.revision, 0, 'a no-op does not bump it');
    assert.equal(grid.setSeason('dry'), true);
    assert.equal(grid.revision, 1);
    assert.equal(grid.setSeason('dry'), false, 'idempotent');
    assert.equal(grid.revision, 1);
  });

  test('two grids from the same seed drain identically', () => {
    const a = watery(21);
    const b = watery(21);
    a.setSeason('dry');
    b.setSeason('dry');
    assert.deepEqual(a.toRunLength(), b.toRunLength());
  });
});

describe('the dry bed, now that something generates one (the D4 deferrals)', () => {
  /** A cell that is a dry bed in the dry season, with its grid left in that season. */
  const aDryBed = (seed = 3) => {
    const grid = watery(seed);
    grid.setSeason('dry');
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (grid.codeAt(x, y) === TerrainType.DRY_BED) return { grid, x, y };
      }
    }
    throw new Error('no dry bed in this world');
  };

  test('⚠⚠ a dry bed costs exactly what open ground costs to walk on', () => {
    // **The trap this guards**: the movement system treats a slow cell's edge as a
    // wall, so any "loose sand" discount would make animals turn away from the
    // drained channel — which is the one ground in a dry-season world that still
    // grows grass, and therefore exactly where the mechanism needs them to walk.
    // This is the tree's `0.9` lesson (DOCS §7) held rather than re-learned.
    // Deferred from D4, where nothing generated a bed to measure.
    const { grid, x, y } = aDryBed();
    assert.equal(grid.speedModifierAt(x, y), 1);
    assert.equal(grid.isPassable(x, y), true);
    assert.equal(grid.blocksSightAt(x, y), false);
    assert.equal(grid.concealmentAt(x, y), 0);
  });

  test('⚠⚠ grass grows on a dry bed exactly as it does on open ground', () => {
    // The mechanism's most interesting consequence, and the other D4 deferral: the
    // bed sits at wetness 1 in the *wet-season* field — it is by definition where
    // the water was — so once the dry season ties the regrowth rate to wetness
    // (D7), the drained channel keeps growing while the open plain stops. None of
    // that works unless the bed is *suitable* in the first place, which is this.
    const { grid, x, y } = aDryBed();
    const vegetation = new VegetationGrid({ terrain: grid, seed: 7, params: CONFIG.vegetation });
    assert.ok(vegetation.capacityAt(x, y) > 0, 'a dry bed carries grass');

    // Against the same cell in a world where it is still water, which carries none.
    const wet = watery(3);
    const wetVegetation = new VegetationGrid({ terrain: wet, seed: 7, params: CONFIG.vegetation });
    assert.equal(wet.codeAt(x, y), TerrainType.WATER, 'the same cell is water in the wet season');
    assert.equal(wetVegetation.capacityAt(x, y), 0, 'and water grows nothing');
  });
});

describe('the dry map in a running world', () => {
  test('the map turns with the season, and turns back', () => {
    const engine = new SimulationEngine({
      seed: 4,
      config: { world: { width: 96, height: 96 }, terrain: { lakes: 1, smallLakes: 2, streams: 1, marshFraction: 0.08 } },
    });
    engine.registerSystem(new WeatherSystem(ENV));
    const terrain = engine.world.terrain;

    engine.step(1);
    assert.equal(engine.world.environment.season, 'wet');
    assert.equal(terrain.season, 'wet');
    const wetWater = terrain.countByType()[TerrainType.WATER];

    // Halfway through the year is the start of the dry season.
    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    assert.equal(engine.world.environment.season, 'dry');
    assert.equal(terrain.season, 'dry', 'the map drained with it');
    assert.ok(terrain.countByType()[TerrainType.DRY_BED] > 0, 'and there are beds to show for it');
    assert.ok(terrain.countByType()[TerrainType.WATER] < wetWater, 'with less water than the wet season had');

    // And round again.
    engine.clock.setTick(ENV.ticksPerYear + 10);
    engine.step(1);
    assert.equal(engine.world.environment.season, 'wet');
    assert.equal(terrain.season, 'wet');
    assert.equal(terrain.countByType()[TerrainType.WATER], wetWater, 'the water came back exactly');
  });

  test('⚠ the season is settled before anything in the tick reads a cell', () => {
    // `WeatherSystem` runs at priority −10 of `environment`, which is the first
    // phase — so no system can see a map from the wrong season. Asserted against
    // the phase list rather than by inspection, since the ordering is what makes
    // it true.
    assert.equal(SYSTEM_PHASES[0], 'environment');
    const system = new WeatherSystem(ENV);
    assert.equal(system.phase, 'environment');
    assert.ok(system.priority < 0, 'and ahead of anything else in that phase');
  });

  test('a world restored mid-dry-season is already drained, before it is stepped', () => {
    // ⚠ The season is a pure function of the saved tick, so nothing extra is
    // stored — but the map has to be *set* on restore rather than on the first
    // tick, because a caller is entitled to inspect a restored world without
    // stepping it, and a round trip that reported different terrain for one tick
    // is the drift §12 exists to prevent.
    const engine = smallDemo({ seed: 42 });
    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    assert.equal(engine.world.terrain.season, 'dry');

    const restored = restoreDemoSimulation(captureSimulationState(engine));
    assert.equal(restored.world.environment.season, 'dry');
    assert.equal(restored.world.terrain.season, 'dry', 'restored drained, without a single tick');
    assert.deepEqual(restored.world.terrain.toRunLength(), engine.world.terrain.toRunLength());
  });

  test('⚠⚠ the water bearing field is rebuilt when the map drains, not memoized across it', () => {
    // **The bug this pins, because it shipped for an hour and broke three test
    // files at once.** `nearestWater` floods a bearing field from the drinkable
    // cells and memoizes it forever, on the strength of "terrain never changes".
    // Once it does, that memo is a lie — and the way it *presented* was a
    // save/load divergence, not a wrong bearing: the original world built its
    // field during the wet season and kept it, while a world restored
    // mid-dry-season built the same field lazily from the **drained** map. The two
    // then disagreed about where the water was and every animal diverged from
    // there, surfacing as a `deepStrictEqual` failure eighty entities deep in
    // `test/injury.test.js`. Exactly how the `bandmates` stale-read presented at
    // save v35, and the same lesson: a cache keyed on an assumption outlives the
    // assumption.
    // ⚠ Sampled across the map rather than at one point: plenty of cells keep the
    // same nearest water through the drawdown (the lake is still roughly where it
    // was), so a single probe proves nothing either way.
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const probes = [];
    for (let x = 4; x < engine.world.width; x += 7) {
      for (let y = 4; y < engine.world.height; y += 7) probes.push([x + 0.5, y + 0.5]);
    }
    const bearingsOf = (world) => probes.map(([x, y]) => JSON.stringify(world.nearestWater(x, y)));
    const wet = bearingsOf(engine.world);

    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    assert.equal(engine.world.terrain.season, 'dry');
    const dry = bearingsOf(engine.world);
    const moved = dry.filter((bearing, i) => bearing !== wet[i]).length;
    assert.ok(moved > 0, `the field followed the water down (${moved}/${probes.length} probes changed)`);

    // And the round trip the failure actually showed up as.
    const restored = restoreDemoSimulation(captureSimulationState(engine));
    assert.deepEqual(bearingsOf(restored.world), dry, 'a restored world agrees with the one it was saved from');
  });

  test('the terrain projection follows the season rather than being memoized forever', () => {
    // ⚠ The engine memoized this on the strength of "terrain is static". It is
    // static *per season*, so the memo is keyed on `terrain.revision`.
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const wet = engine.getTerrainData();
    assert.equal(engine.getTerrainData(), wet, 'still memoized within a season');

    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    const dry = engine.getTerrainData();
    assert.notEqual(dry, wet, 'a new projection after the season turned');
    assert.notDeepEqual(dry.runs, wet.runs, 'and it describes a different map');
    assert.equal(engine.getTerrainData(), dry, 'memoized again until the next turn');
  });
});

describe('the dry map in the demo world', () => {
  // ⚠ `createDemoSimulation` rather than `smallDemo`: this is a claim about the
  // shipped map's own hydrology — how much of *this* world's water survives its
  // dry season — and shrinking the world changes the thing being measured.
  test('the demo loses roughly three quarters of its drinkable water', () => {
    // Measured 2026-08-09 across these five seeds, wet → dry drinkable cells:
    //   seed 4: 1994 → 644 (3.10×)   seed 1: 1227 → 273 (4.49×)
    //   seed 2: 1808 → 528 (3.42×)   seed 3: 1945 → 541 (3.60×)
    //   seed 5: 1779 → 434 (4.10×)
    // Mean 1751 → 484, a 3.6× reduction — which matches the D0 projection of 480
    // from the census, so the rules do what §4.3 said they would.
    //
    // ⚠ **n=5, and the spread is the interesting part rather than the mean.** Seed
    // 1 is the world with no lake at all (SEASON-PLAN §1.1), and it is the harshest
    // both before and after. The bar below is loose because this is a description
    // of the shipped map, not a tuning target.
    const ratios = [];
    for (const seed of [4, 1, 2, 3, 5]) {
      const terrain = createDemoSimulation({ seed }).world.terrain;
      const wet = terrain.countByType()[TerrainType.WATER];
      terrain.setSeason('dry');
      const dry = terrain.countByType()[TerrainType.WATER];
      assert.ok(dry > 0, `seed ${seed} keeps some water through the dry season (${dry} cells)`);
      ratios.push(wet / dry);
    }
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    assert.ok(mean > 2.5 && mean < 5.5, `the dry season is a real drawdown (${mean.toFixed(2)}× mean, n=5)`);
  });

  test('a demo year drains and refills without the world coming apart', () => {
    // The end-to-end shape: step a full year of the shipped world and watch the
    // map turn twice. What this is really guarding is that nothing downstream —
    // movement, perception, hydration — throws when the ground under it changes.
    const engine = smallDemo({ seed: 42 });
    const seasons = new Set();
    const seen = new Set();
    for (let tick = 0; tick < ENV.ticksPerYear; tick += 1) {
      engine.step(1);
      seasons.add(engine.world.terrain.season);
      seen.add(`${engine.world.environment.season}:${engine.world.terrain.season}`);
    }
    assert.deepEqual(seasons, new Set(['wet', 'dry']), 'the map spent time in both seasons');
    // ⚠ The environment and the map never disagree — the pairing set should hold
    // exactly two entries, not four.
    assert.deepEqual(seen, new Set(['wet:wet', 'dry:dry']));
    assert.ok(engine.entityCount > 0, 'and the world is still running');
    // Sanity on where the year ended, so a change to the calendar shows up here
    // rather than as a mysterious season count.
    assert.equal(phaseAt(engine.clock.tick, ENV.ticksPerYear), 'wetEarly');
  });
});

describe('the wetness fields: two of them, for two different questions (D6)', () => {
  test('⚠⚠ the habitat cue follows the water down; the vegetation mask does not', () => {
    // **The subtlest decision in the whole feature.** Two consumers read "how wet
    // is this ground" and they want different answers:
    //
    //   - `wetnessAt` — what the habitat cue reads, for a species' `wetPreference`.
    //     That is about where an animal wants to *stand*, so it must follow the
    //     water down as the map drains.
    //   - `wetnessWet` — what vegetation is built from. The dry season's rule is
    //     "grass grows where the water **was**", so this one must *not* move: a
    //     dried river bed keeps damp soil, and that is what makes the drained
    //     channel the last good grazing in the world.
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const reference = engine.world.wetnessWet;
    const wetActive = engine.world.wetness;
    assert.equal(wetActive, reference, 'in the wet season the two coincide');

    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    assert.equal(engine.world.terrain.season, 'dry');
    assert.equal(engine.world.wetnessWet, reference, 'the vegetation mask never moved');
    assert.notEqual(engine.world.wetness, reference, 'but the cue is reading a different field');
    assert.equal(engine.world.wetness, engine.world.wetnessDry);

    // And the dry field really is drier: the map holds a quarter of the water.
    const mean = (field) => field.reduce((sum, v) => sum + v, 0) / field.length;
    assert.ok(
      mean(engine.world.wetnessDry) < mean(reference),
      `the drained map is drier ground (${mean(engine.world.wetnessDry).toFixed(3)} against ${mean(reference).toFixed(3)})`,
    );
  });

  test('every layer turns in the same instant, or none does', () => {
    // `World.setSeason` exists as one call precisely so terrain, wetness, the
    // water bearing field and vegetation cannot get out of step. This is that
    // claim, stated as the thing that would break if any of them found its own
    // trigger instead.
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    for (const season of ['dry', 'wet', 'dry']) {
      engine.world.setSeason(season);
      assert.equal(engine.world.terrain.season, season);
      assert.equal(engine.world.vegetation.season, season);
      assert.equal(engine.world.wetness, season === 'dry' ? engine.world.wetnessDry : engine.world.wetnessWet);
    }
  });
});

describe('vegetation in the dry season (D7)', () => {
  /**
   * Split the demo's growable ground by the **wet-season** field: the riparian
   * strip (where the water was) against the open plain.
   */
  const classify = (engine) => {
    const { terrain } = engine.world;
    const riparian = [];
    const plain = [];
    for (let y = 0; y < terrain.height; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        const dryCode = terrain.codeAtSeason(x, y, 'dry');
        if (dryCode !== TerrainType.GROUND && dryCode !== TerrainType.DRY_BED) continue;
        const wetness = engine.world.wetnessWet[y * terrain.width + x];
        if (wetness > 0.9) riparian.push([x, y]);
        else if (wetness < 0.05) plain.push([x, y]);
      }
    }
    return { riparian, plain };
  };

  const totalOver = (engine, cells) =>
    cells.reduce((sum, [x, y]) => sum + engine.world.vegetation.biomassAt(x, y), 0);

  const stripBare = (engine, cells) => {
    for (const [x, y] of cells) engine.world.vegetation.consumeAt(x, y, Number.MAX_SAFE_INTEGER);
  };

  test('⚠⚠ in the dry season the plain does not grow back and the old channel does', () => {
    // **The request, end to end**: "vegetation near where water was should grow at
    // a normal rate; vegetation not near where water was should not grow at all."
    //
    // Measured on the demo, seed 4 — 5183 riparian cells against 16 623 of plain,
    // each grazed to bare and then given 300 ticks:
    //
    //     wet season   riparian 0 → 29 321   plain 0 → 78 052
    //     dry season   riparian 0 → 29 601   plain 0 →     12
    //
    // The plain regrows **12 biomass across sixteen thousand cells** — zero to any
    // reading — while the channel comes back at the rate it always did. ⚠ And note
    // the riparian figure barely moves between seasons: that is "a normal rate,
    // *not* the boosted one" showing up as the absence of a difference.
    //
    // ⚠ `createDemoSimulation`, not `smallDemo`: this is a claim about the shipped
    // map's own hydrology, and the riparian/plain split is a property of that map.
    const engine = createDemoSimulation({ seed: 4 });
    const { riparian, plain } = classify(engine);
    assert.ok(riparian.length > 500 && plain.length > 5000, `${riparian.length} riparian, ${plain.length} plain`);

    const regrowth = (tick) => {
      engine.clock.setTick(tick);
      engine.step(1); // let the weather system settle the season
      stripBare(engine, riparian);
      stripBare(engine, plain);
      engine.step(300);
      return { riparian: totalOver(engine, riparian), plain: totalOver(engine, plain), season: engine.world.environment.season };
    };

    const wet = regrowth(400);
    assert.equal(wet.season, 'wet');
    assert.ok(wet.plain > 1000, `the plain regrows in the wet season (${wet.plain.toFixed(0)})`);

    const dry = regrowth(2400);
    assert.equal(dry.season, 'dry');
    assert.ok(dry.riparian > wet.riparian * 0.8, `the channel still comes back (${dry.riparian.toFixed(0)})`);
    assert.ok(dry.plain < wet.plain * 0.01, `the plain does not (${dry.plain.toFixed(0)} against ${wet.plain.toFixed(0)})`);
  });

  test('the riparian ceiling drops to normal — "not the boosted rate"', () => {
    // The other half of the request, and the half the regrowth test above cannot
    // see: what changes is the *ceiling*, so it shows up in capacity rather than in
    // 300 ticks of growth. `wetCapacityBonus` 0.6 → 0 means grass beside the old
    // channel tops out at 1× rather than 1.6×.
    // ⚠ **Only cells that grow in *both* seasons**, which is narrower than
    // `classify`'s riparian set and has to be. That set includes the channel
    // itself — cells that are `WATER` in the wet season and `DRY_BED` in the dry
    // one — and those have a wet-season capacity of exactly zero. Summing over
    // them compares "no grass at all" against "grass", which drowns the 1.6× this
    // test is looking for: measured that way the ratio comes out at 1.06.
    const engine = createDemoSimulation({ seed: 4 });
    const { terrain } = engine.world;
    const riparian = classify(engine).riparian.filter(
      ([x, y]) => terrain.codeAtSeason(x, y, 'wet') === TerrainType.GROUND,
    );
    assert.ok(riparian.length > 200, `${riparian.length} cells of damp ground that is ground in both seasons`);
    const capacityOver = () => riparian.reduce((sum, [x, y]) => sum + engine.world.vegetation.capacityAt(x, y), 0);

    const wet = capacityOver();
    engine.world.setSeason('dry');
    const dry = capacityOver();
    const ratio = wet / dry;
    const bonus = engine.config.vegetation.wetCapacityBonus;
    // These cells are at wetness ~1, so the ratio should land near `1 + bonus`.
    assert.ok(
      ratio > 1 + bonus * 0.8 && ratio < 1 + bonus * 1.2,
      `the wet-season ceiling is about ${(1 + bonus).toFixed(2)}× the dry one (measured ${ratio.toFixed(3)})`,
    );
  });

  test('a drained channel grows grass where there was none', () => {
    const engine = createDemoSimulation({ seed: 4 });
    const { terrain } = engine.world;
    const beds = [];
    for (let y = 0; y < terrain.height && beds.length < 200; y += 1) {
      for (let x = 0; x < terrain.width && beds.length < 200; x += 1) {
        if (terrain.codeAtSeason(x, y, 'dry') === TerrainType.DRY_BED) beds.push([x, y]);
      }
    }
    assert.ok(beds.length > 0, 'the map has beds');
    for (const [x, y] of beds) assert.equal(engine.world.vegetation.capacityAt(x, y), 0, 'water grows nothing');

    engine.world.setSeason('dry');
    for (const [x, y] of beds) assert.ok(engine.world.vegetation.capacityAt(x, y) > 0, `the bed at ${x},${y} grows grass`);

    // And it actually fills in, from nothing, over the dry season.
    engine.clock.setTick(Math.floor(0.55 * ENV.ticksPerYear));
    const before = totalOver(engine, beds);
    engine.step(600);
    assert.equal(engine.world.environment.season, 'dry');
    assert.ok(totalOver(engine, beds) > before, 'the drained channel greens up');
  });

  test('⚠ the off state: the map still drains, and grass behaves exactly as it always did', () => {
    const control = createDemoSimulation({
      seed: 4,
      config: { vegetation: { drySeason: { enabled: false } } },
    });
    const capacities = (engine) => {
      const out = [];
      for (let y = 0; y < engine.world.terrain.height; y += 4) {
        for (let x = 0; x < engine.world.terrain.width; x += 4) out.push(engine.world.vegetation.capacityAt(x, y));
      }
      return out;
    };
    const wet = capacities(control);
    control.world.setSeason('dry');
    assert.equal(control.world.terrain.season, 'dry', 'the map still drains');
    assert.deepEqual(capacities(control), wet, 'but the grass does not know it');
  });

  test('⚠ adding a whole second season shifted no draw at all', () => {
    // The claim that lets D7 land on every existing seed: the seasonal arrays are
    // arithmetic on top of a fertility field drawn once, so a world with the dry
    // season on seeds precisely the biomass a world with it off does.
    const on = createDemoSimulation({ seed: 4 });
    const off = createDemoSimulation({ seed: 4, config: { vegetation: { drySeason: { enabled: false } } } });
    assert.deepEqual(on.world.vegetation.serialize(), off.world.vegetation.serialize());
  });

  test('the arrays round-trip wet → dry → wet', () => {
    const engine = createDemoSimulation({ seed: 4 });
    const sample = () => {
      const out = [];
      for (let y = 0; y < engine.world.terrain.height; y += 5) {
        for (let x = 0; x < engine.world.terrain.width; x += 5) out.push(engine.world.vegetation.capacityAt(x, y));
      }
      return out;
    };
    const start = sample();
    engine.world.setSeason('dry');
    assert.notDeepEqual(sample(), start);
    engine.world.setSeason('wet');
    assert.deepEqual(sample(), start);
  });
});

describe('telling a connected viewer that the map changed (D8)', () => {
  test('⚠⚠ the revision rides on every delta, because a client can only notice a change', () => {
    // Terrain is carried by full snapshots and never by deltas, so without this a
    // viewer that joined in the wet season would keep drawing the wet map for the
    // rest of the run — with every other layer correct around it.
    //
    // ⚠ **Unconditional, unlike every other optional block on a delta.** Sending
    // it only when it moved would make "absent" mean two things — nothing
    // changed, or this producer does not report terrain — and a client cannot
    // tell those apart.
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const first = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(typeof first.terrainRevision, 'number');

    engine.step(1);
    const second = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(first, second, engine.eventsSince(first.lastEventSeq));
    assert.equal(delta.terrainRevision, second.terrainRevision, 'carried even when nothing moved');
  });

  test('the revision moves exactly when the season turns', () => {
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const wet = buildFullSnapshot(engine.getSnapshotData());

    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    const dry = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(engine.world.environment.season, 'dry');
    assert.notEqual(dry.terrainRevision, wet.terrainRevision, 'the number moved');
    assert.notDeepEqual(dry.terrain.runs, wet.terrain.runs, 'and it moved because the map did');
  });

  test('a store that decoded the wet map reports the drained one as stale', () => {
    // The renderer's half: the store cannot fetch a terrain from inside a pure
    // state transition, so it *reports* staleness and the app requests a fresh
    // full snapshot — the same recovery a desync already uses.
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const wet = buildFullSnapshot(engine.getSnapshotData());
    const store = new RendererStore();
    store.applyFullSnapshot(wet);
    assert.equal(store.terrainRevision, wet.terrainRevision);

    // A delta within the season: nothing stale.
    engine.step(1);
    const same = buildFullSnapshot(engine.getSnapshotData());
    let result = store.applyDelta(buildDeltaSnapshot(wet, same, []));
    assert.equal(result.terrainStale, false, 'no season change, no refetch');

    // A delta across the season boundary: stale, and the old map is still drawn.
    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    const drained = buildFullSnapshot(engine.getSnapshotData());
    result = store.applyDelta(buildDeltaSnapshot(same, drained, []));
    assert.equal(result.terrainStale, true, 'the store noticed');
    assert.ok(store.terrain, '⚠ and kept drawing the map it has — a stale shoreline beats a blank grid');

    // Applying the full snapshot is what actually fixes it.
    store.applyFullSnapshot(drained);
    assert.equal(store.terrainRevision, drained.terrainRevision);
    assert.equal(store.applyDelta(buildDeltaSnapshot(drained, drained, [])).applied, false, 'stale delta ignored');
  });

  test('a host that reports no revision is not treated as permanently stale', () => {
    // An older or simpler producer omits the field entirely. "Absent" must read
    // as "this host does not report terrain changes", not as "refetch forever".
    const engine = smallDemo({ seed: 42 });
    engine.step(1);
    const base = buildFullSnapshot(engine.getSnapshotData());
    engine.step(1);
    const next = buildFullSnapshot(engine.getSnapshotData());
    const delta = buildDeltaSnapshot(base, next, []);
    delete base.terrainRevision;
    delete delta.terrainRevision;

    const store = new RendererStore();
    store.applyFullSnapshot(base);
    assert.equal(store.terrainRevision, null);
    assert.equal(store.applyDelta(delta).terrainStale, false);
  });
});

/**
 * ⚠⚠ **The converse invariant, and the one the feature actually violates.**
 *
 * The suite above proves the dry map never *removes* passability. Nobody checked
 * whether it *adds* it — and `LAKE_CORE` does exactly that: `DEEP_WATER` and
 * impassable in the wet season, shallow drinkable `WATER` in the dry one. In a
 * drained world that core is often the only lake water left, so it pulls thirsty
 * animals in; then the season turns and every animal in it is standing on a cell
 * it cannot step off, because `stepRefused` gates on the destination and there is
 * no destination. It waits ~2000 ticks for the next dry season or it starves.
 *
 * Measured on the shipped demo before `world/stranding.js` existed, 2 seeds ×
 * 8000 ticks: **30 and 39** animals caught at the first `dry→wet` turn, **24 and
 * 20** dead before the map released them, held a mean of ~1490 ticks; **82% and
 * 81%** of every immobile run over 200 ticks was an animal standing in wet-season
 * deep water. After: **0 and 0** caught, 0 dead, and the only animals left over
 * the core are vultures, which fly.
 *
 * ⚠ These are sandbox-tier: a 96×96 world with one lake and nothing else, and
 * animals placed by hand rather than walked in. The strand is a property of the
 * terrain and the placement rule, not of the ecology.
 */
describe('a season change that closes terrain over an animal', () => {
  const CAP = CONFIG.locomotion.maxOccupantsPerCell;

  /** A world with one lake big enough to have a deep core, and no other terrain. */
  function laked(seed = 3) {
    return new SimulationEngine({
      seed,
      config: {
        world: { width: 96, height: 96 },
        terrain: { ...FLAT_TERRAIN, lakes: 1, lakeDeepFraction: 0.55 },
      },
    });
  }

  /** Every cell the lake's impassable core occupies. */
  function coreCells(world) {
    const found = [];
    for (let y = 0; y < world.terrain.height; y += 1) {
      for (let x = 0; x < world.terrain.width; x += 1) {
        if (world.terrain.waterSourceAt(x, y) === WaterSource.LAKE_CORE) found.push([x, y]);
      }
    }
    return found;
  }

  function place(engine, cellX, cellY, overrides = {}) {
    const id = engine.world.entities.queueSpawn({
      kind: 'animal',
      speciesId: 'herbivore.gazelle',
      x: cellX + 0.5,
      y: cellY + 0.5,
      heading: 0,
      lifeStage: 'adult',
      ...overrides,
    });
    engine.applyDeferredEntityChanges(0);
    return engine.world.entities.get(id);
  }

  /** How many living animals stand in each cell, keyed `x,y`. */
  function occupancy(world) {
    const counts = new Map();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      const key = `${cellX},${cellY}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  test('⚠⚠ the dry map opens cells the wet map closes — the converse the suite above does not cover', () => {
    // The cause, stated as terrain rather than as behaviour. If this ever stops
    // being true the eviction below is dead code and should go with it.
    //
    // ⚠ The claim is an equality, not "some cell opens": the cells the dry map
    // opens are **exactly** the lake core, every seed. Rock stays rock, and there
    // is no other impassable code — so if a second inverting feature is ever added
    // this fails, which is the point. ⚠ Seed 7's lake is small enough to have no
    // core at all (0 cells), so the equality is 0 = 0 there and the run needs the
    // total to prove it measured anything.
    let opened = 0;
    for (const seed of [1, 2, 3, 5, 7]) {
      const grid = watery(seed);
      const closed = [];
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) if (!grid.isPassable(x, y)) closed.push([x, y]);
      }
      const core = cellsFrom(grid, WaterSource.LAKE_CORE);
      grid.setSeason('dry');
      const nowPassable = closed.filter(([x, y]) => grid.isPassable(x, y));
      assert.equal(
        nowPassable.length,
        core.length,
        `seed ${seed}: the cells the dry map opens are not exactly the lake core`,
      );
      opened += nowPassable.length;
    }
    assert.ok(opened > 0, 'no seed in this list has a lake core — the case has stopped being measured');
  });

  test('an animal the wet season closed over is put back on passable ground', () => {
    const engine = laked();
    const world = engine.world;
    const core = coreCells(world);
    assert.ok(core.length > 20, `the lake has a core worth standing in (${core.length} cells)`);

    world.setSeason('dry');
    const [cellX, cellY] = core[Math.floor(core.length / 2)];
    const animal = place(engine, cellX, cellY);
    assert.equal(world.isPassableAt(animal.x, animal.y), true, 'it could stand there while the map was drained');

    world.setSeason('wet');
    assert.equal(world.isPassableAt(animal.x, animal.y), false, 'and the returning water closed over it');

    assert.equal(evictStranded(world), 1);
    assert.equal(world.isPassableAt(animal.x, animal.y), true, 'now it is somewhere it can walk from');
  });

  test('⚠⚠ a core empties onto its rim without stacking more than the cap into a cell', () => {
    // **The reason this is a search rather than a clamp.** A lake core drains onto
    // the handful of shore cells nearest it, so evicting thirty animals to "the
    // closest passable cell" would put six or eight of them in one cell — trading
    // a trap for a jam, against the same `maxOccupantsPerCell` the movement system
    // would then have to unpick. Each eviction must see the occupancy the ones
    // before it created.
    const engine = laked();
    const world = engine.world;
    world.setSeason('dry');
    const core = coreCells(world);
    const placed = core.slice(0, 30).map(([cellX, cellY]) => place(engine, cellX, cellY));
    assert.equal(placed.length, 30);

    world.setSeason('wet');
    assert.equal(evictStranded(world), 30, 'every one of them was stranded and every one was moved');

    for (const animal of placed) {
      assert.equal(world.isPassableAt(animal.x, animal.y), true, `#${animal.id} is still in the lake`);
    }
    for (const [cell, count] of occupancy(world)) {
      assert.ok(count <= CAP, `cell ${cell} holds ${count} animals against a cap of ${CAP}`);
    }
  });

  test('⚠ a flier is left where it is, because it was never stuck', () => {
    // `flyingFor` puts a flier in the air whenever the cell under it is
    // impassable, so a vulture over the core can leave under its own power. The
    // trap probe recorded 704 vulture-ticks in the core and zero vulture deaths
    // there. Moving one would be a teleport that fixes nothing.
    const engine = laked();
    const world = engine.world;
    world.setSeason('dry');
    const [cellX, cellY] = coreCells(world)[5];
    const bird = place(engine, cellX, cellY, { speciesId: 'scavenger.vulture', flying: true });
    const where = { x: bird.x, y: bird.y };

    world.setSeason('wet');
    assert.equal(evictStranded(world), 0);
    assert.deepEqual({ x: bird.x, y: bird.y }, where);
  });

  test('an animal on ground it can walk from is not touched', () => {
    const engine = laked();
    const world = engine.world;
    // A corner of a `roundness: 0` world with one lake in it is open ground.
    const animal = place(engine, 2, 2);
    assert.equal(world.isPassableAt(animal.x, animal.y), true);
    world.setSeason('dry');
    world.setSeason('wet');
    assert.equal(evictStranded(world), 0, 'a season turn is not a reason to move anybody');
    assert.deepEqual({ x: animal.x, y: animal.y }, { x: 2.5, y: 2.5 });
  });

  test('⚠ over the cap beats walled in, when there is nowhere with room', () => {
    // Occupancy gates *entry* to a cell and never departure from it, so an
    // overfull cell drains on its own within a few ticks — while an animal left in
    // the water is the bug this exists to fix. So the search prefers room and
    // accepts a crowd rather than giving up. Forced here with a cap of 1 and every
    // cell within reach already taken.
    const engine = laked();
    const world = engine.world;
    const core = coreCells(world);
    // The core's rightmost cell, so its rim is inside a 3-cell scan. Taking the
    // middle instead would test something else entirely — nothing passable within
    // reach at all, which is the `null` case, not the crowded one.
    const [edgeX, edgeY] = core.reduce((best, cell) => (cell[0] > best[0] ? cell : best));
    const blocked = [];
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        if (world.isPassableAt(edgeX + dx + 0.5, edgeY + dy + 0.5)) blocked.push(place(engine, edgeX + dx, edgeY + dy));
      }
    }
    assert.ok(blocked.length > 0, 'the scan has somewhere to look, and it is full');

    world.setSeason('dry');
    const stuck = place(engine, edgeX, edgeY);
    world.setSeason('wet');
    assert.equal(world.isPassableAt(stuck.x, stuck.y), false);

    assert.equal(evictStranded(world, 1, 3), 1, 'it got out');
    assert.equal(world.isPassableAt(stuck.x, stuck.y), true);
    // ...and it is genuinely sharing, which is what "accepts a crowd" means.
    const { cellX, cellY } = world.cellOf(stuck.x, stuck.y);
    assert.ok(
      blocked.some((other) => {
        const cell = world.cellOf(other.x, other.y);
        return cell.cellX === cellX && cell.cellY === cellY;
      }),
      'it should have landed on top of a blocker, not found free ground the test meant to remove',
    );
  });

  test('two identical worlds evict identically', () => {
    // No draw is spent here and the scan order is fixed, so this is a property of
    // the code rather than of the streams — which is what lets the eviction sit in
    // a tick without `test/determinism.test.js` having anything to say about it.
    const positions = [3, 3].map((seed) => {
      const engine = laked(seed);
      const world = engine.world;
      world.setSeason('dry');
      for (const [cellX, cellY] of coreCells(world).slice(0, 20)) place(engine, cellX, cellY);
      world.setSeason('wet');
      evictStranded(world);
      return [...world.entities.all()].map((e) => `${e.id}:${e.x},${e.y}`);
    });
    assert.deepEqual(positions[0], positions[1]);
    assert.ok(positions[0].length === 20);
  });

  test('⚠⚠ the season turn itself does the evicting — the wiring, not just the function', () => {
    // The function above can be right and never called. This runs the real
    // `WeatherSystem` across a genuine `dry→wet` turn, which is the only thing
    // that proves an animal in a running world is ever looked at.
    const engine = laked();
    engine.registerSystem(new WeatherSystem(ENV));
    const world = engine.world;

    engine.clock.setTick(Math.floor(0.6 * ENV.ticksPerYear));
    engine.step(1);
    assert.equal(world.terrain.season, 'dry');
    const placed = coreCells(world).slice(0, 12).map(([cellX, cellY]) => place(engine, cellX, cellY));

    engine.clock.setTick(ENV.ticksPerYear + 10);
    engine.step(1);
    assert.equal(world.terrain.season, 'wet', 'the map filled back in');
    for (const animal of placed) {
      assert.equal(world.isPassableAt(animal.x, animal.y), true, `#${animal.id} was left in the lake by the turn`);
    }
    for (const [cell, count] of occupancy(world)) {
      assert.ok(count <= CAP, `cell ${cell} holds ${count} animals against a cap of ${CAP}`);
    }
  });
});
