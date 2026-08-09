/**
 * World roundness (2026-08-02): the map's outline, from a plain rectangle at
 * level 0 to an inscribed ellipse at MAX_ROUNDNESS.
 *
 * The shape is a superellipse (`|x/a|^n + |y/b|^n = 1`), which is what lets one
 * level control the whole family: n → ∞ is the rectangle, n = 2 is the exact
 * ellipse. ⚠ A corner-radius formulation cannot reach the asked-for endpoint —
 * on a 160×120 map a maximal corner radius gives a *stadium* (flat sides,
 * semicircular ends), never an oval — so the endpoint is asserted directly
 * against the ellipse equation rather than trusted.
 *
 * These assert the *mechanism* (DOCS §15): that the outline is the curve it
 * claims to be, that nothing later in generation writes outside it, that the
 * connectivity guarantee still holds within it, and that level 0 leaves every
 * existing world byte-identical.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TerrainGrid,
  TerrainType,
  MAX_ROUNDNESS,
  ROUNDNESS_EXPONENTS,
  isOutsideShape,
  isPassableCode,
} from '../src/simulation/world/TerrainGrid.js';
import { createDemoSimulation, buildDemoConfig } from '../src/fixtures/createDemoSimulation.js';
import { defaultSimulationConfig } from '../src/simulation/config/defaultSimulationConfig.js';
import { validateCommand } from '../src/protocol/validation.js';
import { CommandTypes } from '../src/protocol/commands.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const W = 160;
const H = 120;

/** Every passable cell of a grid, as a flat list of [x, y]. */
function passableCells(grid) {
  const out = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.isPassable(x, y)) out.push([x, y]);
    }
  }
  return out;
}

/** Count of 4-connected components among passable cells. */
function passableComponents(grid) {
  const w = grid.width;
  const h = grid.height;
  const seen = new Uint8Array(w * h);
  let components = 0;
  for (let start = 0; start < w * h; start += 1) {
    const sx = start % w;
    const sy = (start - sx) / w;
    if (seen[start] || !grid.isPassable(sx, sy)) continue;
    components += 1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      const push = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (seen[j] || !grid.isPassable(nx, ny)) return;
        seen[j] = 1;
        stack.push(j);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
  }
  return components;
}

describe('roundness: the shape itself', () => {
  test('level 0 is the full rectangle — no cell is outside it', () => {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        assert.equal(isOutsideShape(x, y, W, H, 0), false, `(${x},${y}) should be inside a rectangle`);
      }
    }
  });

  test('level MAX is exactly the inscribed ellipse', () => {
    // The claim is the equation, so the equation is what is compared — not a
    // sampled count that would also pass for a rounded rectangle.
    const a = W / 2;
    const b = H / 2;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const nx = (x + 0.5 - a) / a;
        const ny = (y + 0.5 - b) / b;
        assert.equal(
          isOutsideShape(x, y, W, H, MAX_ROUNDNESS),
          nx * nx + ny * ny > 1,
          `(${x},${y}) disagrees with the ellipse`,
        );
      }
    }
  });

  test('a square world at max roundness is a circle: the corners go, the axes stay', () => {
    const size = 128;
    const mid = size / 2;
    assert.equal(isOutsideShape(0, 0, size, size, MAX_ROUNDNESS), true, 'the corner is cut');
    assert.equal(isOutsideShape(size - 1, size - 1, size, size, MAX_ROUNDNESS), true);
    assert.equal(isOutsideShape(mid, 0, size, size, MAX_ROUNDNESS), false, 'the top of the circle stays');
    assert.equal(isOutsideShape(0, mid, size, size, MAX_ROUNDNESS), false, 'and its left edge');
  });

  test('the corners round off monotonically as the level rises', () => {
    // The mechanism's whole claim is "more roundness, more rounding". Asserted
    // as an ordering across all five levels rather than at the endpoints, so a
    // non-monotonic middle (a mis-ordered exponent table) cannot slip through.
    const inside = [];
    for (let level = 0; level <= MAX_ROUNDNESS; level += 1) {
      let n = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          if (!isOutsideShape(x, y, W, H, level)) n += 1;
        }
      }
      inside.push(n);
    }
    assert.equal(inside[0], W * H, 'level 0 keeps every cell');
    for (let level = 1; level <= MAX_ROUNDNESS; level += 1) {
      assert.ok(
        inside[level] < inside[level - 1],
        `level ${level} (${inside[level]}) should keep fewer cells than ${level - 1} (${inside[level - 1]})`,
      );
    }
    // π/4 of the bounding box, the known area of an inscribed ellipse.
    const ellipseShare = inside[MAX_ROUNDNESS] / (W * H);
    assert.ok(
      Math.abs(ellipseShare - Math.PI / 4) < 0.005,
      `max roundness should keep ~π/4 of the box, kept ${ellipseShare.toFixed(4)}`,
    );
  });

  test('levels are whole steps: out-of-range and fractional inputs clamp rather than throw', () => {
    assert.equal(isOutsideShape(0, 0, W, H, -3), false, 'below the scale is level 0');
    assert.equal(
      isOutsideShape(0, 0, W, H, MAX_ROUNDNESS + 9),
      isOutsideShape(0, 0, W, H, MAX_ROUNDNESS),
      'above the scale is the top level',
    );
    assert.equal(ROUNDNESS_EXPONENTS.length, MAX_ROUNDNESS + 1, 'five levels, 0..4');
  });
});

describe('roundness: generation respects the outline', () => {
  test('every cell outside the shape is impassable, at every level', () => {
    for (let level = 1; level <= MAX_ROUNDNESS; level += 1) {
      for (const seed of [42, 7]) {
        const grid = new TerrainGrid({ width: W, height: H, seed, params: { roundness: level } });
        for (let y = 0; y < H; y += 1) {
          for (let x = 0; x < W; x += 1) {
            if (!isOutsideShape(x, y, W, H, level)) continue;
            assert.equal(
              grid.isPassable(x, y),
              false,
              `level ${level} seed ${seed}: (${x},${y}) is outside the shape but passable`,
            );
          }
        }
      }
    }
  });

  test('⚠ a lake near the rim is clipped by the coast, not punched through it', () => {
    // The regression this guards: `#stampDisc` writes WATER unconditionally
    // (`onlyGround: false`, so a deep core can overwrite its own shallows), so
    // without the exterior check a lake rolled near the edge would carve
    // passable water straight through the outline. Many seeds, because where the
    // lake lands is a draw.
    for (let seed = 1; seed <= 40; seed += 1) {
      const grid = new TerrainGrid({ width: W, height: H, seed, params: { roundness: MAX_ROUNDNESS } });
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          if (!isOutsideShape(x, y, W, H, MAX_ROUNDNESS)) continue;
          const code = grid.codeAt(x, y);
          assert.equal(code, TerrainType.ROCK, `seed ${seed}: (${x},${y}) outside the shape is ${code}`);
        }
      }
    }
  });

  test('⚠ connectivity is preserved *within* the shape, without tunnelling through the sea', () => {
    // The corridor carve walks through rock, and the rim is rock — so an
    // unmasked search would reconnect two pockets by carving a causeway around
    // the outside, destroying the shape to satisfy the guarantee. Both halves
    // are asserted: one component, and no ground outside.
    for (let seed = 1; seed <= 12; seed += 1) {
      const grid = new TerrainGrid({
        width: W,
        height: H,
        seed,
        // Heavy rock, so stranded pockets actually occur and the carve has work
        // to do. At the demo's 5 formations this path rarely runs at all.
        params: { roundness: MAX_ROUNDNESS, ridges: 60 },
      });
      assert.equal(passableComponents(grid), 1, `seed ${seed}: the playable map should be one piece`);
      for (const [x, y] of passableCells(grid)) {
        assert.equal(
          isOutsideShape(x, y, W, H, MAX_ROUNDNESS),
          false,
          `seed ${seed}: carved a passable cell at (${x},${y}), outside the shape`,
        );
      }
    }
  });

  test('the playable area shrinks with the level, and animals only ever spawn inside it', () => {
    for (const level of [0, MAX_ROUNDNESS]) {
      const engine = createDemoSimulation({ seed: 42, config: { terrain: { roundness: level } } });
      for (const entity of engine.world.entities.all()) {
        if (entity.kind !== 'animal') continue;
        const { cellX, cellY } = engine.world.cellOf(entity.x, entity.y);
        assert.equal(
          isOutsideShape(cellX, cellY, engine.world.width, engine.world.height, level),
          false,
          `level ${level}: ${entity.id} spawned outside the world at (${entity.x}, ${entity.y})`,
        );
        assert.equal(isPassableCode(engine.world.terrain.codeAt(cellX, cellY)), true);
      }
    }
  });

  test('a rounded world still runs, and its animals stay inside the shape', () => {
    const engine = createDemoSimulation({ seed: 42, config: { terrain: { roundness: MAX_ROUNDNESS } } });
    engine.step(400);
    let living = 0;
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || entity.alive === false) continue;
      living += 1;
      // ⚠ **Grounded animals only, from phase F1.** Roundness carves the corners
      // to *rock* rather than shrinking the world, and flight ignores impassable
      // terrain by design — so a vulture crosses a rounded corner exactly as it
      // crosses a ridge or a lake, and cannot land in one. Exempting fliers here
      // is the same narrowing `test/movement.test.js` and `test/terrain.test.js`
      // took, and the alternative — teaching flight about a world *shape* — would
      // be a second notion of the map's edge beside the terrain.
      if (entity.flying === true) continue;
      const { cellX, cellY } = engine.world.cellOf(entity.x, entity.y);
      assert.equal(
        isOutsideShape(cellX, cellY, engine.world.width, engine.world.height, MAX_ROUNDNESS),
        false,
        `${entity.id} walked outside the world to (${entity.x}, ${entity.y})`,
      );
    }
    assert.ok(living > 0, 'the world should still be populated after 400 ticks');
  });
});

describe('roundness: the off state', () => {
  test('⚠ level 0 is a true no-op — the carve writes nothing at all', () => {
    // D30, the standing rule: an off switch must leave no trace.
    //
    // ⚠ **Restated 2026-08-04.** This used to compare level 0 against a grid
    // built with *no* roundness param, which was the same world only while the
    // default was 0 — the demo now ships at 4, so that comparison had become
    // "off differs from on", which is not the claim. The claim is that the carve
    // leaves no trace, and a world whose every other terrain generator is off
    // says it directly: if the carve ran at all at level 0 — even writing rock it
    // then read back — there would be rock on an otherwise empty map.
    for (const seed of [42, 7, 13]) {
      // ⚠ `FLAT_TERRAIN` rather than a literal since 2026-08-08. The literal was
      // one of the ~25 copies that helper exists to retire, and the water
      // features are what proved the point again: "every other generator is off"
      // stopped being what this list said the moment three more shipped. The
      // helper is the one place that has to be kept true.
      const bare = { ...FLAT_TERRAIN };
      const off = new TerrainGrid({ width: W, height: H, seed, params: { ...bare, roundness: 0 } });
      assert.equal(off.countByType()[TerrainType.ROCK] ?? 0, 0, `seed ${seed}: level 0 wrote rock`);
      // ...and the carve does run when it is asked to, so the assertion above is
      // evidence of an off switch rather than of a dead mechanism.
      const on = new TerrainGrid({ width: W, height: H, seed, params: { ...bare, roundness: MAX_ROUNDNESS } });
      assert.ok((on.countByType()[TerrainType.ROCK] ?? 0) > 0, `seed ${seed}: the carve did nothing at all`);
    }
  });

  test('the shipped default is the demo, and level 0 is still the control', () => {
    // ⚠ 0 until 2026-08-04, when the demo became the ngorongoro crater and the
    // rim became part of it. The no-op above is what "every existing seed can
    // still generate the world it always did" now rests on: ask for 0 and you
    // get the rectangle, exactly as before.
    assert.equal(defaultSimulationConfig.terrain.roundness, MAX_ROUNDNESS);
  });
});

describe('roundness: the protocol and the host mapping', () => {
  test('buildDemoConfig passes the level straight through, unmapped', () => {
    // ⚠ Unlike rocks/thickets it is *not* run through the prevalence mapping:
    // the level is the setting on both sides, so translating it would be a
    // translation between a scale and itself.
    assert.equal(buildDemoConfig({ roundness: 3 }).terrain.roundness, 3);
    assert.equal(buildDemoConfig({ roundness: 0 }).terrain.roundness, 0);
    // And it composes with the terrain fields rather than replacing them.
    const both = buildDemoConfig({ roundness: 2, rocks: 0 });
    assert.equal(both.terrain.roundness, 2);
    assert.equal(both.terrain.ridges, 0);
    // Omitting it leaves terrain entirely to the defaults — no override object.
    assert.equal(buildDemoConfig({ herbivores: 5 }).terrain, undefined);
  });

  test('the protocol accepts the scale and refuses everything off it', () => {
    const restart = (fields) => validateCommand({ type: CommandTypes.SIMULATION_RESTART, ...fields });
    for (let level = 0; level <= MAX_ROUNDNESS; level += 1) {
      assert.equal(restart({ roundness: level }).ok, true, `level ${level} should be accepted`);
    }
    assert.equal(restart({}).ok, true, 'omitting it is fine — it is optional');
    for (const bad of [-1, MAX_ROUNDNESS + 1, 1.5, '2', null]) {
      const result = restart({ roundness: bad });
      assert.equal(result.ok, false, `${JSON.stringify(bad)} should be refused`);
      assert.equal(result.errors[0].path, 'roundness');
    }
  });
});
