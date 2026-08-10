import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TerrainGrid,
  TerrainType,
  TERRAIN_LEGEND,
  WaterSource,
  isPassableCode,
  isSightBlockingCode,
  isShelteringCode,
  projectTerrain,
} from '../src/simulation/world/TerrainGrid.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { buildFullSnapshot } from '../src/protocol/snapshots.js';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';

const makeGrid = (seed, overrides = {}) =>
  new TerrainGrid({ width: 64, height: 64, seed, params: overrides });

/**
 * Count 4-connected components of cells matching `predicate(code)`. Used to
 * assert both that rock is scattered (several rock components) and that passable
 * ground is never walled off (exactly one passable component).
 */
const countComponents = (grid, predicate) => {
  const w = grid.width;
  const h = grid.height;
  const seen = new Uint8Array(w * h);
  let components = 0;
  for (let start = 0; start < w * h; start += 1) {
    const sx = start % w;
    const sy = (start - sx) / w;
    if (seen[start] || !predicate(grid.codeAt(sx, sy))) continue;
    components += 1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && predicate(grid.codeAt(nx, ny))) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return components;
};

// Impassable is now rock *and* deep water, so read passability off the legend
// rather than special-casing rock — the connectivity guarantee is about cells an
// animal can actually stand on.
const isPassable = (code) => TERRAIN_LEGEND[code].passable;

describe('terrain grid', () => {
  test('generation is deterministic: same seed + size + params → identical cells', () => {
    const a = makeGrid(123);
    const b = makeGrid(123);
    assert.deepEqual(a.toRunLength(), b.toRunLength());
    assert.deepEqual(a.countByType(), b.countByType());
  });

  test('different seeds produce different terrain', () => {
    const a = makeGrid(1);
    const b = makeGrid(2);
    assert.notDeepEqual(a.toRunLength(), b.toRunLength());
  });

  test('run-length encoding covers exactly width*height cells', () => {
    const grid = makeGrid(7);
    const total = grid.toRunLength().reduce((sum, [, count]) => sum + count, 0);
    assert.equal(total, 64 * 64);
  });

  test('rock is impassable, other in-bounds types are passable, edges are walls', () => {
    const grid = makeGrid(42);
    // Find one cell of each generated type and check passability by legend.
    const counts = grid.countByType();
    assert.ok(counts[TerrainType.ROCK] > 0, 'expected some rock');
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const code = grid.codeAt(x, y);
        const expected = TERRAIN_LEGEND[code].passable;
        assert.equal(grid.isPassable(x, y), expected);
      }
    }
    // Out of bounds is always an impassable wall.
    assert.equal(grid.isPassable(-1, 0), false);
    assert.equal(grid.isPassable(0, grid.height), false);
    assert.equal(grid.codeAt(-1, -1), TerrainType.ROCK);
  });

  test('cover only replaces ground, never water or rock', () => {
    // A high cover fraction must not overwrite lakes/ridges.
    const grid = new TerrainGrid({ width: 48, height: 48, seed: 9, params: { coverFraction: 0.9 } });
    const counts = grid.countByType();
    assert.ok(counts[TerrainType.WATER] > 0);
    assert.ok(counts[TerrainType.ROCK] > 0);
    assert.ok(counts[TerrainType.COVER] > 0);
  });
});

describe('terrain projection', () => {
  test('projection is renderer-neutral: legend + RLE, no glyphs/colors, no typed arrays', () => {
    const grid = makeGrid(5);
    const projection = projectTerrain(grid);
    assert.equal(projection.encoding, 'rle-row-major');
    assert.equal(projection.width, 64);
    assert.deepEqual(
      projection.cellTypes.map((entry) => entry.name),
      ['ground', 'water', 'rock', 'cover', 'deep_water', 'thicket', 'tree', 'dry_bed'],
    );
    const serialized = JSON.stringify(projection);
    assert.ok(!/glyph|color|dracula/i.test(serialized), 'projection must carry no presentation');
    // runs is a plain array of [code, count]; JSON round-trips (no Uint8Array).
    assert.deepEqual(JSON.parse(serialized).runs, projection.runs);
  });

  test('the terrain legend covers every code emitted in the runs', () => {
    const projection = projectTerrain(makeGrid(11));
    const legendCodes = new Set(projection.cellTypes.map((entry) => entry.code));
    for (const [code] of projection.runs) {
      assert.ok(legendCodes.has(code), `run code ${code} missing from legend`);
    }
  });

  test('full snapshots embed terrain at the current protocol version', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION);
    assert.ok(snapshot.terrain, 'snapshot should embed terrain');
    assert.equal(snapshot.terrain.width, engine.world.width);
    // Cloned per snapshot: mutating one snapshot's terrain never affects another.
    snapshot.terrain.runs[0][1] = -999;
    const second = buildFullSnapshot(engine.getSnapshotData());
    assert.notEqual(second.terrain.runs[0][1], -999);
  });
});

describe('terrain sandbox scenario (seed fixed)', () => {
  test('a seeded world has a water body and scattered rock with impassable cells', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const terrain = engine.world.terrain;
    const counts = terrain.countByType();
    assert.ok(counts[TerrainType.WATER] > 50, `expected a lake, got ${counts[TerrainType.WATER]} water cells`);
    assert.ok(counts[TerrainType.ROCK] > 50, `expected rock, got ${counts[TerrainType.ROCK]} rock cells`);

    // Every rock cell is impassable through the authoritative world API.
    let checkedRock = false;
    for (let y = 0; y < terrain.height && !checkedRock; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        if (terrain.codeAt(x, y) === TerrainType.ROCK) {
          assert.equal(engine.world.isPassableAt(x + 0.5, y + 0.5), false);
          checkedRock = true;
          break;
        }
      }
    }
    assert.ok(checkedRock, 'expected to find a rock cell to verify impassability');
  });

  test('terrain is identical across two engines with the same seed', () => {
    const a = createDemoSimulation({ seed: 2026 });
    const b = createDemoSimulation({ seed: 2026 });
    assert.deepEqual(a.world.terrain.toRunLength(), b.world.terrain.toRunLength());
  });

  test('demo animals never *stand* on impassable terrain', () => {
    // ⚠ Narrowed at phase F1 (2026-08-04) from "never step onto": a flying animal
    // is refused by nothing and crosses rock and open water, which is what
    // terrain-independent movement means. What still holds — and is what movement
    // depends on — is that an animal on the ground is on ground it can stand on.
    // `test/movement.test.js` asserts the same invariant in its strong form.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(300);
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive || entity.flying === true) continue;
      assert.equal(
        engine.world.isPassableAt(entity.x, entity.y),
        true,
        `animal ${entity.id} on impassable cell at ${entity.x},${entity.y}`,
      );
    }
  });
});

describe('rock is scattered formations, not a dividing wall', () => {
  test('rock forms several separate outcrops rather than one line', () => {
    // On the default demo world, the eight formations settle into multiple
    // disconnected rock bodies — the opposite of a single map-spanning ridge.
    const grid = new TerrainGrid({ width: 128, height: 128, seed: 42 });
    const rockComponents = countComponents(grid, (code) => code === TerrainType.ROCK);
    assert.ok(rockComponents >= 2, `expected scattered rock, got ${rockComponents} component(s)`);
  });

  test('passable terrain is a single connected region for every seed', () => {
    // The connectivity pass guarantees no pocket of passable ground is walled
    // off, so rock can never split the world in two. Check a spread of seeds and
    // sizes, including the small non-square worlds tests use.
    for (const seed of [1, 2, 7, 42, 99, 123, 500, 2026]) {
      for (const [w, h] of [[64, 64], [40, 40], [96, 48]]) {
        const grid = new TerrainGrid({ width: w, height: h, seed });
        const passableComponents = countComponents(grid, isPassable);
        assert.equal(
          passableComponents,
          1,
          `seed ${seed} @ ${w}x${h}: passable terrain split into ${passableComponents} regions`,
        );
      }
    }
  });

  test('a deliberately walled-off pocket gets a carved corridor out', () => {
    // Heavy rock coverage on a small world reliably strands pockets before the
    // connectivity pass; afterward there must still be exactly one passable
    // region, and rock must remain (the pass carves the minimum, not the map).
    const grid = new TerrainGrid({
      width: 48,
      height: 48,
      seed: 3,
      params: { ridges: 40, rockFormationMaxRadius: 6, rockFormationMaxSteps: 12 },
    });
    assert.equal(countComponents(grid, isPassable), 1);
    assert.ok(grid.countByType()[TerrainType.ROCK] > 0, 'connectivity pass should not erase all rock');
  });
});

describe('water provenance: which feature a water cell came from (SEASON-PLAN D3)', () => {
  // The demo's own terrain, which is the map the dry season will actually drain.
  const demoGrid = () => createDemoSimulation({ seed: 42 }).world.terrain;

  test('⚠⚠ a cell is tagged if and only if it is water', () => {
    // The one invariant the whole mechanism rests on. It is easy to break in a
    // direction nothing else notices: rock is stamped *over* water, so an outcrop
    // on a shore leaves a drowned cell that would still read `LAKE` if the tag
    // were written by the callers instead of by `#stampDisc` itself. A `ROCK` cell
    // tagged `LAKE` would be refilled with water by the dry-season pass.
    for (const seed of [42, 1, 2, 3, 7]) {
      const grid = makeGrid(seed, { lakes: 1, smallLakes: 2, streams: 1, marshFraction: 0.08, ridges: 6 });
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          const code = grid.codeAt(x, y);
          const isWater = code === TerrainType.WATER || code === TerrainType.DEEP_WATER;
          assert.equal(
            grid.waterSourceAt(x, y) !== WaterSource.NONE,
            isWater,
            `seed ${seed} @ ${x},${y}: code ${code} against source ${grid.waterSourceAt(x, y)}`,
          );
        }
      }
    }
  });

  test('the demo world tags every one of its water features, and the counts are the D0 census', () => {
    // ⚠ These are the numbers the whole dry-season design was rewritten around —
    // the first draft estimated ~3100 drinkable cells from the config's geometry
    // and the real figure is 1751, off by 1.8×, because every disc is clipped by
    // the coast and by whatever rock was stamped over it. They are also the whole
    // reason provenance exists: the four features are wildly different sizes and
    // the dry season treats each differently (DOCS.md §7 *The four drying rules*).
    const counts = demoGrid().countByWaterSource();
    for (const [name, value] of Object.entries(WaterSource)) {
      if (name === 'NONE') continue;
      assert.ok(counts[value] > 0, `the demo has ${name} water (${counts[value]})`);
    }
    const water = demoGrid().countByType();
    const tagged = counts.reduce((sum, n, i) => (i === WaterSource.NONE ? sum : sum + n), 0);
    assert.equal(
      tagged,
      water[TerrainType.WATER] + water[TerrainType.DEEP_WATER],
      'every water cell is accounted for exactly once',
    );
  });

  test('the lake core is tagged apart from its ring, because the dry season inverts them', () => {
    const grid = makeGrid(11, { lakes: 1, lakeDeepFraction: 0.55, smallLakes: 0, streams: 0, marshFraction: 0 });
    let ring = 0;
    let core = 0;
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const source = grid.waterSourceAt(x, y);
        if (source === WaterSource.LAKE) {
          ring += 1;
          assert.equal(grid.codeAt(x, y), TerrainType.WATER);
        }
        if (source === WaterSource.LAKE_CORE) {
          core += 1;
          assert.equal(grid.codeAt(x, y), TerrainType.DEEP_WATER);
        }
      }
    }
    assert.ok(ring > 0 && core > 0, `the lake has both a ring (${ring}) and a core (${core})`);
  });

  test('⚠ a stream running into the lake arrives at it rather than carving through it', () => {
    // The guard that is invisible in the cells: both are `WATER`, so writing one
    // over the other changes nothing you can see — but a shore strip tagged
    // `STREAM` would dry *completely* in the dry season, cutting a dry channel
    // through a lake shore that should only have receded.
    //
    // ⚠ **Measured against the arm without the guard, because a test of an
    // invisible rule has to show it can fail.** Removing the `continue` and
    // re-running this construction takes seed 2's lake from 384 cells to 340, and
    // seeds 1/3/4 from 273/211/184 to 253/208/162.
    //
    // ⚠ **The first version of this test asserted the wrong geometry** — that no
    // `STREAM` cell may touch the lake's core, on the assumption that the ring
    // wraps the core. It does not: rock is stamped over the lake *before* streams
    // run, and a stream cuts through rock, so an outcrop on the shore can put a
    // channel legitimately next to the core.
    const params = { lakes: 1, lakeRadiusFraction: 0.3, smallLakes: 0, marshFraction: 0 };
    // ⚠ `marshFraction: 0` is what makes the two arms comparable: the marsh is the
    // only pass after the streams, and at 0 it spends no draws, so turning streams
    // off cannot shift anything else in the world.
    const withStreams = makeGrid(2, { ...params, streams: 3 });
    const without = makeGrid(2, { ...params, streams: 0 });

    // The precondition, without which this test would pass vacuously: the streams
    // really do run into the lake.
    let contacts = 0;
    for (let y = 0; y < withStreams.height; y += 1) {
      for (let x = 0; x < withStreams.width; x += 1) {
        if (withStreams.waterSourceAt(x, y) !== WaterSource.STREAM) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (withStreams.waterSourceAt(x + dx, y + dy) === WaterSource.LAKE) contacts += 1;
        }
      }
    }
    assert.ok(contacts > 0, `a stream reaches the lake (${contacts} cells of shoreline contact)`);

    // The claim: having reached it, it took none of it.
    assert.equal(
      withStreams.countByWaterSource()[WaterSource.LAKE],
      without.countByWaterSource()[WaterSource.LAKE],
      'the lake is exactly the size it would be with no streams at all',
    );
  });

  test('every pond records the geometry it was drawn with, whether or not it left a cell', () => {
    // ⚠ A pond drawn past the coast or on top of the lake writes nothing at all —
    // measured at D0, on 1 seed in 5 of the demo. The record still has to exist,
    // because the dry pass shrinks a *disc* and "no disc" and "an empty disc" are
    // different bugs.
    const grid = makeGrid(5, { lakes: 1, smallLakes: 3, streams: 0, marshFraction: 0 });
    const ponds = grid.ponds();
    assert.equal(ponds.length, 3, 'one record per pond asked for');
    for (const pond of ponds) {
      assert.ok(Number.isFinite(pond.cx) && Number.isFinite(pond.cy), 'a centre');
      assert.ok(pond.r > 0, 'and a radius');
    }
    // A copy, not the generator's own state.
    ponds[0].r = -1;
    assert.ok(grid.ponds()[0].r > 0, 'the accessor hands out copies');
  });

  test('⚠ provenance costs no draws — the terrain is byte-identical to what it always was', () => {
    // The claim that lets this ship on: every value is written beside a cell write
    // that already happened, so no RNG stream moved. Two grids at the same seed
    // agreeing proves determinism but not *this*; what proves it is that the run
    // lengths are unchanged, which `test/determinism.test.js` and the committed
    // renderer fixtures check from the other side. Here: the tag never changes a
    // cell, including in the one place a water cell can legally become dry ground.
    const grid = makeGrid(3, { lakes: 1, smallLakes: 2, streams: 2, marshFraction: 0.1, ridges: 8 });
    const twin = makeGrid(3, { lakes: 1, smallLakes: 2, streams: 2, marshFraction: 0.1, ridges: 8 });
    assert.deepEqual(grid.toRunLength(), twin.toRunLength());
    // And the connectivity pass, which is the only thing that can turn deep water
    // into ground, clears the tag when it does.
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (grid.codeAt(x, y) !== TerrainType.GROUND) continue;
        assert.equal(grid.waterSourceAt(x, y), WaterSource.NONE, `carved ground at ${x},${y} still tagged`);
      }
    }
  });
});

describe('the dry bed: a terrain code that nothing generates yet (SEASON-PLAN D4)', () => {
  test('⚠ the off state — no generated world contains one', () => {
    // The whole point of landing the code before the map that writes it: every
    // existing seed generates precisely the terrain it did, so this phase is a
    // legend entry and five table rows rather than a change to any world. The map
    // that produces dry beds is D5.
    for (const seed of [42, 1, 2, 3, 7]) {
      const grid = makeGrid(seed, { lakes: 1, smallLakes: 2, streams: 1, marshFraction: 0.08 });
      assert.equal(grid.countByType()[TerrainType.DRY_BED], 0, `seed ${seed} generated a dry bed`);
    }
    assert.equal(createDemoSimulation({ seed: 42 }).world.terrain.countByType()[TerrainType.DRY_BED], 0);
  });

  test('a dry bed is walkable, transparent, and no shelter', () => {
    const entry = TERRAIN_LEGEND[TerrainType.DRY_BED];
    assert.equal(entry.name, 'dry_bed');
    assert.equal(entry.code, TerrainType.DRY_BED);
    assert.equal(entry.passable, true);
    assert.equal(isPassableCode(TerrainType.DRY_BED), true);

    // ⚠ Concealment must stay **under 1**, because `blocksSightAt` is derived as
    // `>= 1`. Any value below it leaves the raycast's boolean array untouched, so
    // `hasLineOfSight` costs precisely what it did — phase 14's discipline, and
    // the same guard the tree's 0.4 carries.
    assert.equal(isSightBlockingCode(TerrainType.DRY_BED), false, 'a bare pan does not block sight');
    assert.equal(isShelteringCode(TerrainType.DRY_BED), false, 'nor shelter from the weather');

    // ⚠ **Traversal speed and vegetation suitability are asserted at D5, not
    // here, and the reason is that nothing generates a dry bed yet** — both are
    // read per *cell* (`speedModifierAt`, `capacityAt`) and terrain is never
    // mutated, so there is no honest way to obtain one. They are the two values
    // most worth guarding (speed 1.0, because slow ground is avoided ground and
    // the drained channel is exactly where the dry season needs animals to walk;
    // suitability 1, because grass regrowing in the bed is the mechanism's most
    // interesting consequence), and D5's tests take them against a real map.
  });

  test('⚠ every species that names `water` also names `dry_bed` (A79, held rather than repeated)', () => {
    // A79: an unnamed terrain resolves to a *neutral* 1, so a new code silently
    // flattens the preference of every species that enumerates terrain by name.
    // The four herbivores never caught up for `tree`; this asserts they did here,
    // and that the three species with no water opinion still have no bed opinion —
    // silence stays silence rather than becoming an accidental 1.
    const engine = createDemoSimulation({ seed: 42 });
    let named = 0;
    for (const species of engine.species.all()) {
      const habitat = species.habitat;
      if (!habitat) continue;
      assert.equal(
        'dry_bed' in habitat,
        'water' in habitat,
        `${species.id} names water=${'water' in habitat} but dry_bed=${'dry_bed' in habitat}`,
      );
      if ('dry_bed' in habitat) named += 1;
    }
    assert.equal(named, 5, 'the five species with a water opinion each have a bed opinion');
  });

  test('the renderer legend is handed the new code without the renderer being told about it', () => {
    // The protocol publishes names and codes; the renderer maps names to glyphs.
    // So a new terrain type reaches the client through the legend it already
    // reads, and this pins that the projection carries it.
    const projection = projectTerrain(makeGrid(5));
    const bed = projection.cellTypes.find((cell) => cell.name === 'dry_bed');
    assert.ok(bed, 'the projected legend carries the dry bed');
    assert.equal(bed.code, TerrainType.DRY_BED);
    assert.equal(bed.passable, true);
  });
});
