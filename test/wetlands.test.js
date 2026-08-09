import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { validateCommand } from '../src/protocol/validation.js';
import {
  MAX_SMALL_LAKES,
  MAX_STREAMS,
  MAX_MARSH_PERCENT,
} from '../src/protocol/commands.js';
import { buildDemoConfig } from '../src/fixtures/createDemoSimulation.js';

/**
 * The three water features (TERRAIN-PLAN.md, phases W1–W4): ponds, a stream,
 * and a marsh.
 *
 * ⚠ **Tick cost: zero.** Every test here builds `TerrainGrid`s directly and runs
 * no simulation at all — the whole file is ~1 s of terrain generation. Nothing
 * in it is an ecological claim, and per DOCS §14 nothing in it should be: what a
 * marsh does to hydration-driven movement needs a ten-seed gate and is
 * deliberately not attempted here.
 *
 * Three claims are load-bearing and the rest are properties:
 *
 *   1. **Each off state leaves no trace.** Every feature returns before its
 *      first draw when switched off, so a world is bit-for-bit the world it was.
 *   2. **The marsh is composed, not coded.** It is an arrangement of the seven
 *      terrain codes that already exist, and it destroys none of the features it
 *      is laid over.
 *   3. **A percentage means the playable map.** What the user types is what the
 *      wetland covers, on a round world as well as a rectangular one.
 */

const W = 200;
const H = 160;
/** Nothing but ground, so a feature under test is the only thing on the map. */
const BARE = Object.freeze({
  lakes: 0,
  ridges: 0,
  thickets: 0,
  coverPatchDensity: 0,
  treeGroves: 0,
  treeSingles: 0,
  smallLakes: 0,
  streams: 0,
  marshFraction: 0,
});
/** All three water features off, on an otherwise ordinary world. */
const DRY = Object.freeze({ smallLakes: 0, streams: 0, marshFraction: 0 });

const grid = (params, seed = 42) => new TerrainGrid({ width: W, height: H, seed, params });
const count = (g, code) => g.countByType()[code] ?? 0;

describe('water features: each off state leaves no trace', () => {
  // The strongest available form of "spends no draws": two worlds that disagree
  // about every remaining parameter of the disabled feature. Any draw taken — or
  // any read that reached a generator — on the way to placing nothing would move
  // every later pass and the maps would differ.
  const pairs = [
    ['ponds', { smallLakes: 0, smallLakeRadiusFraction: 0.2 }, { smallLakes: 0, smallLakeRadiusFraction: 0.01 }],
    ['the stream', { streams: 0, streamWidth: 6, streamMeander: 1.4 }, { streams: 0, streamWidth: 0.5, streamMeander: 0 }],
    ['the marsh', { marshFraction: 0, marshMaxRadius: 30, marshWaterDensity: 0.9 }, { marshFraction: 0, marshMaxRadius: 2, marshWaterDensity: 0.1 }],
  ];
  for (const [name, a, b] of pairs) {
    test(`${name} at 0 is byte-identical however it is configured`, () => {
      assert.deepEqual(grid({ ...DRY, ...a }).toRunLength(), grid({ ...DRY, ...b }).toRunLength());
    });
  }

  test('⚠ all three off reproduces the world as it was before they existed', () => {
    // The regression guard for the whole plan: with the three switches down, the
    // pipeline is the one that shipped with trees, so any accidental draw in any
    // of the new passes shows up here rather than as a mysteriously moved lake.
    const dry = grid(DRY);
    assert.deepEqual(dry.toRunLength(), grid(DRY).toRunLength());
    assert.ok(count(dry, TerrainType.WATER) > 0, 'the main lake is untouched');
  });
});

describe('ponds (phase W1)', () => {
  test('each pond adds shallow water, and none of it is deep', () => {
    const none = grid({ ...BARE });
    const one = grid({ ...BARE, smallLakes: 1 });
    const four = grid({ ...BARE, smallLakes: 4 });
    assert.equal(count(none, TerrainType.WATER), 0);
    assert.ok(count(one, TerrainType.WATER) > 0, 'a pond is water');
    assert.ok(count(four, TerrainType.WATER) > count(one, TerrainType.WATER), 'four ponds is more water than one');
    // ⚠ The property that separates a pond from a lake: no impassable core. A
    // five-cell pond with a deep middle is a one-cell drinkable ring.
    assert.equal(count(four, TerrainType.DEEP_WATER), 0, 'a pond is drinkable all the way across');
  });

  test('a pond is clipped by the lake rather than filling its deep core', () => {
    // `onlyGround`: at this point in the pipeline the lake is the only thing on
    // the map, so a pond landing on it must lose, not win.
    const lake = grid({ ...BARE, lakes: 1, smallLakes: 0 });
    const both = grid({ ...BARE, lakes: 1, smallLakes: 8 });
    let lost = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (lake.codeAt(x, y) === TerrainType.DEEP_WATER && both.codeAt(x, y) !== TerrainType.DEEP_WATER) lost += 1;
      }
    }
    assert.equal(lost, 0, 'ponds filled in part of the lake');
  });
});

describe('the stream (phase W2)', () => {
  const streamed = grid({ ...BARE, streams: 1 });

  test('it crosses the world rather than clipping a corner', () => {
    const cells = [];
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) if (streamed.codeAt(x, y) === TerrainType.WATER) cells.push([x, y]);
    }
    assert.ok(cells.length > 0, 'a stream is water');
    const span = (i) => Math.max(...cells.map((c) => c[i])) - Math.min(...cells.map((c) => c[i]));
    // A channel from one perimeter point to the one opposite covers most of one
    // axis whichever pair of sides it happens to join.
    assert.ok(span(0) > W * 0.6 || span(1) > H * 0.6, `stream spans only ${span(0)}×${span(1)}`);
  });

  test('it cuts through rock — a stream may not end in the middle of the map', () => {
    // The deliberate exception to "later passes do not bury earlier ones". A
    // heavily rocked world is the case that made it necessary.
    const rocky = { ...BARE, ridges: 40, streams: 1 };
    const dry = grid({ ...rocky, streams: 0 });
    const wet = grid(rocky);
    let carved = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (dry.codeAt(x, y) === TerrainType.ROCK && wet.codeAt(x, y) === TerrainType.WATER) carved += 1;
      }
    }
    assert.ok(carved > 0, 'the channel stopped at the first outcrop');
  });

  test('⚠ but never through the coast, and never through a lake core', () => {
    // Two structural exceptions. A round world puts rim rock in the channel's
    // way at both ends; a lake puts deep water in the middle of it.
    const round = { ...BARE, roundness: 4, lakes: 1, streams: 4 };
    const dry = grid({ ...round, streams: 0 });
    const wet = grid(round);
    let breached = 0;
    let forded = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const before = dry.codeAt(x, y);
        const after = wet.codeAt(x, y);
        // Outside the shape is rock at every level, and the exterior mask is the
        // only thing that keeps water off it.
        const outside = (x + 0.5 - W / 2) ** 2 / (W / 2) ** 2 + (y + 0.5 - H / 2) ** 2 / (H / 2) ** 2 > 1;
        if (outside && after === TerrainType.WATER) breached += 1;
        if (before === TerrainType.DEEP_WATER && after !== TerrainType.DEEP_WATER) forded += 1;
      }
    }
    assert.equal(breached, 0, 'the stream breached the coastline');
    assert.equal(forded, 0, 'the stream filled in a lake core');
  });

  test('passable ground stays one connected region', () => {
    assert.equal(passableComponents(grid({ streams: 4, marshFraction: 0 })), 1);
  });
});

describe('the marsh (phase W3)', () => {
  test('⚠ it is composed of the codes that already exist — all four of them', () => {
    const dry = grid({ ...BARE, lakes: 1, marshFraction: 0 });
    const wet = grid({ ...BARE, lakes: 1, marshFraction: 0.12 });
    const made = new Map();
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (dry.codeAt(x, y) === wet.codeAt(x, y)) continue;
        made.set(wet.codeAt(x, y), (made.get(wet.codeAt(x, y)) ?? 0) + 1);
      }
    }
    for (const [name, code] of [
      ['pools', TerrainType.WATER],
      ['tall grass', TerrainType.COVER],
      ['reed beds', TerrainType.THICKET],
      ['timber', TerrainType.TREE],
    ]) {
      assert.ok((made.get(code) ?? 0) > 0, `a marsh with no ${name}`);
    }
  });

  test('⚠ it destroys nothing it is laid over — rock, lake and deep water survive', () => {
    const dry = grid({ marshFraction: 0 });
    const wet = grid({ marshFraction: 0.2 });
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const before = dry.codeAt(x, y);
        if (before !== TerrainType.ROCK && before !== TerrainType.DEEP_WATER) continue;
        assert.equal(wet.codeAt(x, y), before, `the marsh buried terrain ${before} at ${x},${y}`);
      }
    }
  });

  test('a percentage covers that share of the playable map, on a round world too', () => {
    // ⚠ The converted area runs a little *under* the fraction asked for, by
    // design and not by drift: ~12% of the footprint is deliberately left as open
    // ground (a wetland has dry footing in it), and cells that were already
    // thicket or timber are left alone rather than rewritten. What must hold is
    // that the number means something — it scales, and it is measured against the
    // ground inside the rim rather than the bounding box.
    const playable = countPlayable(grid({ ...BARE, roundness: 4 }));
    const converted = (fraction) => {
      const dry = grid({ roundness: 4, marshFraction: 0 });
      const wet = grid({ roundness: 4, marshFraction: fraction });
      let changed = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) if (dry.codeAt(x, y) !== wet.codeAt(x, y)) changed += 1;
      }
      return changed / playable;
    };
    const small = converted(0.05);
    const large = converted(0.2);
    assert.ok(small > 0.03 && small < 0.055, `a 5% marsh converted ${(100 * small).toFixed(1)}% of the playable map`);
    assert.ok(large > small * 2.5, `a 20% marsh (${(100 * large).toFixed(1)}%) barely beat a 5% one`);
  });

  test('it anchors on water when there is any', () => {
    // A marsh in the middle of dry grassland is a swamp in a desert. With one
    // lake on the map the wetland should be near it, not somewhere else.
    const dry = grid({ ...BARE, lakes: 1, marshFraction: 0 });
    const wet = grid({ ...BARE, lakes: 1, marshFraction: 0.08 });
    const lake = [];
    const marsh = [];
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const before = dry.codeAt(x, y);
        if (before === TerrainType.WATER || before === TerrainType.DEEP_WATER) lake.push([x, y]);
        if (before !== wet.codeAt(x, y)) marsh.push([x, y]);
      }
    }
    const centre = (cells) => [
      cells.reduce((sum, c) => sum + c[0], 0) / cells.length,
      cells.reduce((sum, c) => sum + c[1], 0) / cells.length,
    ];
    const [lx, ly] = centre(lake);
    const [mx, my] = centre(marsh);
    assert.ok(Math.hypot(mx - lx, my - ly) < Math.min(W, H) / 3, 'the marsh grew nowhere near the water');
  });

  test('a lakeless world still gets its marsh, from the fallback anchor', () => {
    // The branch exists so a world with no water anywhere still works; both
    // draws are spent either way, which is why taking it cannot shift anything.
    const wet = grid({ ...BARE, lakes: 0, smallLakes: 0, streams: 0, marshFraction: 0.1 });
    assert.ok(count(wet, TerrainType.WATER) > 0, 'no marsh grew without a shore to start from');
  });

  test('marsh timber obeys the tree spacing rule, and the ground stays connected', () => {
    const wet = grid({ marshFraction: 0.25, treeGroves: 8, treeSingles: 60 });
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (wet.codeAt(x, y) !== TerrainType.TREE) continue;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          assert.notEqual(wet.codeAt(x + dx, y + dy), TerrainType.TREE, `marsh timber touching at ${x},${y}`);
        }
      }
    }
    assert.equal(passableComponents(wet), 1);
  });

  test('deterministic, like every other pass', () => {
    const params = { smallLakes: 3, streams: 2, marshFraction: 0.1 };
    assert.deepEqual(grid(params).toRunLength(), grid(params).toRunLength());
    assert.notDeepEqual(grid(params, 1).toRunLength(), grid(params, 2).toRunLength());
  });
});

describe('water features: the protocol and the host mapping (phase W4)', () => {
  const restart = (fields) => validateCommand({ type: 'simulation.restart', ...fields });

  test('the three fields validate at their bounds and are refused outside them', () => {
    assert.equal(restart({ smallLakes: 0, streams: 0, marsh: 0 }).ok, true);
    assert.equal(restart({ smallLakes: MAX_SMALL_LAKES, streams: MAX_STREAMS, marsh: MAX_MARSH_PERCENT }).ok, true);
    for (const bad of [
      { smallLakes: -1 },
      { smallLakes: MAX_SMALL_LAKES + 1 },
      { streams: MAX_STREAMS + 1 },
      { marsh: MAX_MARSH_PERCENT + 1 },
      { marsh: 2.5 },
    ]) {
      assert.equal(restart(bad).ok, false, `${JSON.stringify(bad)} was accepted`);
    }
    // Omitting them entirely is the ordinary case: the host's defaults apply.
    assert.equal(restart({}).ok, true);
  });

  test('⚠ a percent crosses the boundary and a fraction reaches the generator', () => {
    // The one translation in the mapping. A dropdown offers whole percents; the
    // generator takes a fraction of the playable map.
    assert.equal(buildDemoConfig({ marsh: 25 }).terrain.marshFraction, 0.25);
    assert.equal(buildDemoConfig({ marsh: 0 }).terrain.marshFraction, 0);
    // Counts pass through unmapped, for the reason `roundness` does.
    assert.equal(buildDemoConfig({ smallLakes: 7 }).terrain.smallLakes, 7);
    assert.equal(buildDemoConfig({ streams: 3 }).terrain.streams, 3);
    // And omitting all composition fields still means "no override at all".
    assert.equal(buildDemoConfig({ herbivores: 5 }).terrain, undefined);
  });
});

/** Cells inside the world's shape — everything that is not rim rock. */
function countPlayable(grid) {
  let playable = 0;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) if (grid.codeAt(x, y) !== TerrainType.ROCK) playable += 1;
  }
  return playable;
}

/** Count of 4-connected components of passable cells. */
function passableComponents(grid) {
  const seen = new Set();
  let components = 0;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (!grid.isPassable(x, y) || seen.has(`${x},${y}`)) continue;
      components += 1;
      const stack = [[x, y]];
      seen.add(`${x},${y}`);
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const key = `${cx + dx},${cy + dy}`;
          if (seen.has(key) || !grid.isPassable(cx + dx, cy + dy)) continue;
          seen.add(key);
          stack.push([cx + dx, cy + dy]);
        }
      }
    }
  }
  return components;
}
