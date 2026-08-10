/**
 * **Wet ground** (2026-08-09) — one static distance-to-water field, three claims:
 * grass beside water grows *taller*, grass far from water grows *back slower*, and
 * a species can prefer one end of that gradient or the other.
 *
 * ⚠ **No simulation ticks except where a claim is about ticks.** The field is a
 * pure function of terrain, the capacity term is read off a freshly built grid,
 * and only the regrowth and the habitat-drift tests advance anything — the whole
 * file is well under a second (CLAUDE.md's tick budget).
 *
 * The organising claim is the identity discipline the phase-9 tests established
 * (D16, D30): **a world with no water is exactly unaffected**, in the strongest
 * available form — byte-identical vegetation against a build with the mechanism
 * switched off. That is what makes it safe for this to ship on by default while
 * every hand-built sandbox in the suite keeps asserting what it always did.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { MigrationSystem } from '../src/simulation/systems/MigrationSystem.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { TerrainGrid, TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { VegetationGrid } from '../src/simulation/world/VegetationGrid.js';
import { DEFAULT_WETNESS_PARAMS, buildWetnessField } from '../src/simulation/world/wetness.js';
import { NEUTRAL_WEIGHT, wetPreferenceOf, wetnessWeight } from '../src/simulation/habitat/habitat.js';
import { habitatGradient } from '../src/simulation/migration/migration.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;
const BUFFALO = getSpecies('herbivore.buffalo');
const GAZELLE = getSpecies('herbivore.gazelle');
const WILDEBEEST = getSpecies('herbivore.wildebeest');
const ZEBRA = getSpecies('herbivore.zebra');

/**
 * A hand-painted terrain, which is a **stub** rather than a `TerrainGrid`.
 *
 * ⚠ Deliberate, and worth a line: a real grid is generated from a seed and has no
 * public writer — which is the right design and useless for pinning the shape of a
 * distance ramp, where the whole point is knowing exactly where the water is.
 * `buildWetnessField` and `VegetationGrid` between them read `width`, `height` and
 * `codeAt` and nothing else, so this is the whole contract. The generated-terrain
 * cases below (the marsh, and the engine-level drift) use the real thing.
 */
function painted({ width = 48, height = 24 }, paint = () => TerrainType.GROUND) {
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) cells[y * width + x] = paint(x, y) ?? TerrainType.GROUND;
  }
  return {
    width,
    height,
    codeAt: (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? TerrainType.ROCK : cells[y * width + x]),
  };
}

/** Dry ground everywhere, which is the off state the whole suite runs in. */
function bare(size = { width: 48, height: 24 }) {
  return painted(size);
}

/** A shallow channel down column 0 and dry ground east of it. */
function waterColumn(size = { width: 48, height: 24 }, column = 0, code = TerrainType.WATER) {
  return painted(size, (x) => (x === column ? code : TerrainType.GROUND));
}

describe('the wetness field (world/wetness.js)', () => {
  test('a world with no water has no field at all, and that is the off state', () => {
    // ⚠ The load-bearing case. "Everywhere is maximally dry" would have halved
    // regrowth in every FLAT_TERRAIN sandbox in the suite; null means nobody who
    // did not ask for a wetland gets one.
    assert.equal(buildWetnessField(bare()), null);
  });

  test('the explicit switch and a zero range are the same off state', () => {
    const terrain = waterColumn();
    assert.equal(buildWetnessField(terrain, { enabled: false }), null);
    assert.equal(buildWetnessField(terrain, { range: 0 }), null);
    assert.notEqual(buildWetnessField(terrain), null, 'and with water it exists');
  });

  test('wetness is 1 out to fullDistance, then falls monotonically to 0', () => {
    const terrain = waterColumn();
    const field = buildWetnessField(terrain, { fullDistance: 3, range: 10 });
    const at = (x) => field[12 * terrain.width + x];

    for (let x = 0; x <= 3; x += 1) assert.equal(at(x), 1, `cell ${x} is inside the fully-wet band`);
    for (let x = 4; x <= 12; x += 1) {
      assert.ok(at(x) < at(x - 1), `wetness falls from ${x - 1} to ${x}`);
      assert.ok(at(x) > 0, `and is still positive at ${x}`);
    }
    assert.equal(at(13), 0, 'and is exactly dry at fullDistance + range, not asymptotic to it');
    assert.equal(at(30), 0);
  });

  test('deep water wets its shore too — this is not the drinking field', () => {
    // ⚠ The one place this deliberately differs from World#nearestWater, which
    // floods walkable ground from shallow water only because it answers "where can
    // I drink". A lake core wets the ground beside it whether or not it is a ford.
    const terrain = waterColumn({ width: 48, height: 24 }, 0, TerrainType.DEEP_WATER);
    const field = buildWetnessField(terrain, { fullDistance: 2, range: 8 });
    assert.notEqual(field, null);
    assert.equal(field[12 * 48 + 2], 1, 'two cells from a deep lake is fully wet');
  });

  test('rock does not block it, because damp ground is not a walk', () => {
    const terrain = painted({ width: 48, height: 24 }, (x) =>
      x === 0 ? TerrainType.WATER : x === 1 ? TerrainType.ROCK : TerrainType.GROUND,
    );
    const field = buildWetnessField(terrain, { fullDistance: 3, range: 10 });
    assert.equal(field[12 * 48 + 2], 1, 'the cell behind the ridge is still two tiles from water');
  });

  test('the ramp is round, not a diamond or a square', () => {
    // A 4-connected flood would make the wet band a diamond and an 8-connected
    // step count would make it a square; the field carries source coordinates so
    // the distance it ramps on is Euclidean. Diagonal and axial neighbours at the
    // same true distance must read the same.
    const terrain = painted({ width: 41, height: 41 }, (x, y) =>
      x === 20 && y === 20 ? TerrainType.WATER : TerrainType.GROUND,
    );
    const field = buildWetnessField(terrain, { fullDistance: 0, range: 20 });
    const at = (x, y) => field[y * 41 + x];
    assert.equal(at(24, 20), at(20, 24), 'four cells east reads as four cells south');
    assert.ok(at(23, 23) < at(24, 20), '⚠ and three-and-three is further away than four-and-nothing');
  });

  test('the shipped defaults are the ones the request was phrased in', () => {
    assert.equal(DEFAULT_WETNESS_PARAMS.fullDistance, 3, '"within 2–3 tiles of water"');
    assert.equal(CONFIG.wetness.fullDistance, 3);
    assert.equal(CONFIG.wetness.enabled, true, 'and it ships on');
  });
});

describe('vegetation on wet and dry ground', () => {
  /** A grid over a hand-painted terrain, with the field built the way World does. */
  function gridOver(terrain, params = {}, wetnessParams = {}) {
    const wetness = buildWetnessField(terrain, { ...CONFIG.wetness, ...wetnessParams });
    return new VegetationGrid({ terrain, seed: 7, params: { ...CONFIG.vegetation, ...params }, wetness });
  }

  test('grass beside water grows TALLER — the ceiling is scaled, not the rate', () => {
    const terrain = waterColumn({ width: 64, height: 8 });
    const grid = gridOver(terrain);

    // Per-cell fertility is a draw, so compare like for like: the same cell with
    // and without the bonus isolates the multiplier exactly.
    const dryGrid = gridOver(terrain, { wetCapacityBonus: 0 });
    const bonus = CONFIG.vegetation.wetCapacityBonus;
    assert.ok(bonus > 0, 'the bonus ships on');

    const wetCell = grid.capacityAt(2, 4);
    assert.ok(
      Math.abs(wetCell - dryGrid.capacityAt(2, 4) * (1 + bonus)) < 1e-4,
      'a cell two tiles from water carries the full bonus',
    );
    assert.ok(
      Math.abs(grid.capacityAt(60, 4) - dryGrid.capacityAt(60, 4)) < 1e-4,
      'and a cell out on the dry plain carries none of it',
    );
    assert.ok(wetCell > grid.capacityAt(60, 4), 'so the sward by the water is the taller one');
  });

  test('grass far from water grows back SLOWER — the rate is scaled, not the ceiling', () => {
    const terrain = waterColumn({ width: 64, height: 8 });
    const grid = gridOver(terrain);
    assert.equal(grid.growthScaleAt(2, 4), 1, 'wet ground regrows at full speed');
    assert.ok(
      Math.abs(grid.growthScaleAt(60, 4) - CONFIG.vegetation.dryGrowthScale) < 1e-6,
      'and the dry plain at dryGrowthScale',
    );

    // ⚠ The claim is about *recovery*, which is the only thing a rate can model
    // (season learned the same lesson in the other direction): graze two cells
    // bare, regrow both, and the wet one comes back further in the same ticks.
    grid.consumeAt(2, 4, 1e6);
    grid.consumeAt(60, 4, 1e6);
    for (let i = 0; i < 20; i += 1) grid.grow({ growthRate: 0.08, seedFloor: 0.08 });
    assert.ok(grid.biomassAt(2, 4) > grid.biomassAt(60, 4), 'the wet cell recovers faster');
  });

  test('a waterless world is byte-identical to one built with the mechanism off', () => {
    // ⚠⚠ The strongest form of "every existing sandbox is untouched": not "close
    // enough", but the same numbers out of the same draws.
    const terrain = bare({ width: 32, height: 32 });
    const on = new VegetationGrid({ terrain, seed: 11, params: CONFIG.vegetation, wetness: buildWetnessField(terrain, CONFIG.wetness) });
    const off = new VegetationGrid({ terrain, seed: 11, params: CONFIG.vegetation, wetness: null });
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        assert.equal(on.capacityAt(x, y), off.capacityAt(x, y));
        assert.equal(on.biomassAt(x, y), off.biomassAt(x, y));
        assert.equal(on.growthScaleAt(x, y), 1);
      }
    }
  });

  test('neither term spends a draw, so a watered world seeds the same biomass', () => {
    // The point of making both terms pure functions of position: turning the
    // wetland on does not shift the vegetation RNG sequence by one call, so the
    // *initial* field is identical and only the ceiling it grows toward moves.
    const terrain = waterColumn({ width: 32, height: 32 });
    const wetness = buildWetnessField(terrain, CONFIG.wetness);
    const on = new VegetationGrid({ terrain, seed: 11, params: CONFIG.vegetation, wetness });
    const off = new VegetationGrid({ terrain, seed: 11, params: CONFIG.vegetation, wetness: null });
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) assert.equal(on.biomassAt(x, y), off.biomassAt(x, y));
    }
    assert.ok(on.capacityAt(2, 2) > off.capacityAt(2, 2), 'the ceiling did move, though');
  });

  test('an unsuitable cell stays unsuitable however wet it is', () => {
    const terrain = painted({ width: 16, height: 8 }, (x, y) => {
      if (x === 0) return TerrainType.WATER;
      if (x === 2 && y === 4) return TerrainType.ROCK;
      if (x === 3 && y === 4) return TerrainType.TREE;
      return TerrainType.GROUND;
    });
    const grid = gridOver(terrain);
    assert.equal(grid.capacityAt(2, 4), 0, 'a rock beside a stream is still a rock');
    assert.equal(grid.capacityAt(3, 4), 0, 'and a tree cell still grows no grass');
  });
});

describe('a save carries none of this, and does not need to', () => {
  test('the field and both multipliers rebuild from the seed on load', () => {
    // ⚠ Terrain is regenerated rather than stored (§7), and everything here is a
    // pure function of terrain — so the save format did not change and must not.
    // ⚠⚠ This is asserted here rather than left to `test/persistence.test.js`
    // because that file boots the demo, and the claim is about a grid.
    const config = { world: { width: 64, height: 48 }, terrain: { ...FLAT_TERRAIN, lakes: 1, marshFraction: 0.1 } };
    const original = new SimulationEngine({ seed: 9, config });
    for (let i = 0; i < 40; i += 1) original.world.vegetation.grow({ growthRate: 0.08, seedFloor: 0.08 });

    const saved = JSON.parse(JSON.stringify(original.world.vegetation.serialize()));
    assert.equal(saved.wetness, undefined, 'the field is not in the save');
    assert.equal(saved.capacity, undefined, 'nor is the capacity it scales');

    const restored = new SimulationEngine({ seed: 9, config });
    restored.world.vegetation.restore(saved);
    let wet = 0;
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        assert.equal(restored.world.wetnessAt(x, y), original.world.wetnessAt(x, y));
        assert.equal(restored.world.vegetation.capacityAt(x, y), original.world.vegetation.capacityAt(x, y));
        assert.equal(restored.world.vegetation.growthScaleAt(x, y), original.world.vegetation.growthScaleAt(x, y));
        assert.equal(restored.world.vegetation.biomassAt(x, y), original.world.vegetation.biomassAt(x, y));
        if (original.world.wetnessAt(x, y) > 0) wet += 1;
      }
    }
    assert.ok(wet > 0, 'and the world under test actually had a wetland in it');
  });
});

describe('the marsh is the wettest ground on the map, with no MARSH code', () => {
  test('a generated marsh reads at full wetness without anything knowing what a marsh is', () => {
    // ⚠ TERRAIN-PLAN.md §2 refused a `MARSH` terrain code and recorded the cost:
    // "a marsh is not addressable". This is the answer — a marsh is 30% pools by
    // construction, so *being near water* addresses it, and so does a lake shore,
    // which is ecologically the right grouping anyway.
    const terrain = new TerrainGrid({
      width: 96,
      height: 96,
      seed: 3,
      params: { ...FLAT_TERRAIN, marshFraction: 0.12 },
    });
    const field = buildWetnessField(terrain, CONFIG.wetness);
    assert.notEqual(field, null, 'the marsh made its own water');

    let marshLike = 0;
    let fullyWet = 0;
    for (let y = 0; y < 96; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const code = terrain.codeAt(x, y);
        if (code !== TerrainType.COVER && code !== TerrainType.THICKET) continue;
        marshLike += 1;
        if (field[y * 96 + x] === 1) fullyWet += 1;
      }
    }
    assert.ok(marshLike > 50, `the marsh laid down cover and reed beds (${marshLike})`);
    assert.ok(fullyWet / marshLike > 0.9, `and ≥90% of it is fully wet (${fullyWet}/${marshLike})`);
  });
});

describe('wet-versus-dry as a habitat preference', () => {
  test('the roster splits, and the buffalo is the wet end of it', () => {
    assert.equal(wetPreferenceOf(BUFFALO), 1.5, 'the buffalo wants the wetland');
    assert.equal(wetPreferenceOf(GAZELLE), 0.7);
    assert.equal(wetPreferenceOf(WILDEBEEST), 0.7);
    assert.equal(wetPreferenceOf(ZEBRA), 0.8, '⚠ the mildest of the three: it eats the tall sward');
    assert.equal(wetPreferenceOf(getSpecies('predator.lion')), NEUTRAL_WEIGHT, 'and a species stating nothing is neutral');
    assert.equal(wetPreferenceOf(undefined), NEUTRAL_WEIGHT);
  });

  test('the weight interpolates by wetness, so dry ground is neutral for everyone', () => {
    assert.equal(wetnessWeight(0, 1.5), 1, '⚠ on the dry plain even the buffalo has no opinion');
    assert.equal(wetnessWeight(0, 0.7), 1);
    assert.equal(wetnessWeight(1, 1.5), 1.5);
    assert.ok(Math.abs(wetnessWeight(0.5, 1.5) - 1.25) < 1e-9, 'and it is a gradient to climb, not a step');
  });

  test('⚠ it is a key beside `habitat`, not inside it', () => {
    // The associationPull rule (schema.js) a second time: `habitat` is keyed by the
    // terrain legend's own names, so a wetness entry in it would be indistinguishable
    // from a typo'd terrain name — accepted, ignored, and never diagnosed.
    for (const species of [BUFFALO, GAZELLE, WILDEBEEST, ZEBRA]) {
      assert.equal(species.habitat.wetness, undefined, `${species.id} keeps habitat terrain-keyed`);
      assert.equal(typeof species.wetPreference, 'number');
    }
  });

  test('the buffalo drifts toward the water and the gazelle away from it', () => {
    // ⚠ Not inert (§1.2, A34): the same animal on the same cell of the same world
    // is pulled in opposite directions by nothing but this number.
    const engine = new SimulationEngine({
      seed: 4,
      config: { world: { width: 96, height: 48 }, terrain: { ...FLAT_TERRAIN } },
    });
    // ⚠ A wetland down the west edge, installed as a field rather than generated
    // as terrain. `World.wetnessAt` reads `world.wetness` and nothing else, so this
    // is the real chokepoint with a known gradient behind it — and the terrain
    // stays flat, which is what leaves the *terrain* half of the cue at exactly
    // neutral and this number the only thing that can move the animal.
    const geometry = waterColumn({ width: 96, height: 48 }, 0);
    engine.world.wetness = buildWetnessField(geometry, CONFIG.wetness);

    const entity = { x: 20, y: 24 };
    const options = { cueRadius: 18, reference: CONFIG.habitat.cueReference, weights: null };
    const wet = habitatGradient(engine.world, entity, { ...options, wetPreference: 1.5 });
    const dry = habitatGradient(engine.world, entity, { ...options, wetPreference: 0.7 });

    assert.ok(wet !== null && dry !== null, 'both have somewhere they would rather be');
    assert.ok(Math.abs(Math.cos(wet.heading) + 1) < 0.35, 'the wet-seeker heads west, toward the water');
    assert.ok(Math.abs(Math.cos(dry.heading) - 1) < 0.35, 'and the dry-seeker heads east, away from it');
  });

  test('a neutral species reads no wetness at all, and a waterless world is inert', () => {
    const engine = new SimulationEngine({
      seed: 4,
      config: { world: { width: 64, height: 64 }, terrain: { ...FLAT_TERRAIN } },
    });
    assert.equal(engine.world.wetness, null, 'no water, no field');
    assert.equal(engine.world.wetnessAt(10, 10), 0);
    const entity = { x: 32, y: 32 };
    const base = { cueRadius: 18, reference: CONFIG.habitat.cueReference, weights: null };
    assert.equal(habitatGradient(engine.world, entity, base), null, 'neutral and no terrain weights: no call to make');
    assert.equal(
      habitatGradient(engine.world, entity, { ...base, wetPreference: 1.5 }),
      null,
      'and a wetland animal in a world with no wetland has nowhere better to be',
    );
  });

  test('the world switch turns the whole thing off in one place', () => {
    const off = new SimulationEngine({
      seed: 4,
      config: { world: { width: 64, height: 32 }, terrain: { ...FLAT_TERRAIN, lakes: 1 }, wetness: { enabled: false } },
    });
    assert.equal(off.world.wetness, null, 'no field for the habitat cue');
    assert.equal(off.world.vegetation.growthScaleAt(1, 1), 1, 'and none of the vegetation terms');
    const on = new SimulationEngine({
      seed: 4,
      config: { world: { width: 64, height: 32 }, terrain: { ...FLAT_TERRAIN, lakes: 1 } },
    });
    assert.notEqual(on.world.wetness, null, 'the same world with the switch left alone has one');
  });

  test('MigrationSystem gates the axis and passes the species number through', () => {
    const system = new MigrationSystem({ wetnessPreference: false });
    assert.equal(system.wetnessPreference, false);
    assert.equal(new MigrationSystem().wetnessPreference, true, 'on by default, like the habitat half');
  });
});

describe('the succession still reads across the wetland', () => {
  test('the buffalo tolerates the tall wet sward and the other three do not', () => {
    // ⚠ The correction the wetland forced: at the old `preferredBiomass: 8` the
    // buffalo's habitat half would have walked it into the marsh and its forage
    // half would have discounted every cell there. The numbers below are what stop
    // the two halves of one animal from disagreeing.
    const tallest = CONFIG.vegetation.capacity * CONFIG.vegetation.coverSuitability * (1 + CONFIG.vegetation.wetCapacityBonus);
    assert.ok(tallest > 17, `wet cover tops out around ${tallest.toFixed(1)} biomass`);
    assert.ok(BUFFALO.forage.preferredBiomass >= 13, 'the buffalo eats it');
    for (const species of [GAZELLE, WILDEBEEST, ZEBRA]) {
      assert.ok(
        species.forage.preferredBiomass + species.forage.span < tallest,
        `${species.id} bottoms out below it, so the tall wet sward is buffalo food`,
      );
    }
  });
});
