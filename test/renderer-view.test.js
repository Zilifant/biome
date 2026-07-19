import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, ZOOM_LEVELS } from '../src/renderer/app/rendering/Camera.js';
import { createProjection, worldCellOf, occupantsInCell } from '../src/renderer/app/rendering/GridProjection.js';
import {
  resolveAppearance,
  compareOccupants,
  topOccupant,
  DRACULA_COLORS,
  UNKNOWN_APPEARANCE,
  CARCASS_APPEARANCE,
} from '../src/renderer/app/rendering/EntityAppearance.js';

describe('entity appearance', () => {
  test('appearance lookup is deterministic and species-aware', () => {
    const grazer = { kind: 'animal', speciesId: 'herbivore.grazer', alive: true };
    const first = resolveAppearance(grazer);
    const second = resolveAppearance({ ...grazer });
    assert.equal(first, second, 'repeated lookups return the identical cached object');
    assert.equal(first.glyph, 'g');
    assert.equal(first.colorToken, 'yellow');
    assert.equal(resolveAppearance({ kind: 'plant', speciesId: 'demo.grass', alive: true }).glyph, '"');
  });

  test('glyphs differ across categories, so color is never the only distinction', () => {
    const glyphs = [
      resolveAppearance({ kind: 'animal', speciesId: 'herbivore.grazer', alive: true }).glyph,
      resolveAppearance({ kind: 'plant', speciesId: 'demo.grass', alive: true }).glyph,
      resolveAppearance({ kind: 'animal', speciesId: 'herbivore.grazer', alive: false }).glyph,
      resolveAppearance({ kind: 'mystery', speciesId: 'x', alive: true }).glyph,
    ];
    assert.equal(new Set(glyphs).size, glyphs.length, `expected distinct glyphs, got ${glyphs}`);
    for (const glyph of glyphs) {
      assert.equal(glyph.length, 1);
      assert.ok(glyph.charCodeAt(0) < 128, 'strict ASCII only');
    }
  });

  test('dead animals become carcasses; unknown kinds and species fall back', () => {
    assert.equal(resolveAppearance({ kind: 'animal', speciesId: 'herbivore.grazer', alive: false }), CARCASS_APPEARANCE);
    assert.equal(resolveAppearance({ kind: 'levitating.rock', speciesId: 'whatever', alive: true }), UNKNOWN_APPEARANCE);
    const unknownSpecies = resolveAppearance({ kind: 'animal', speciesId: 'not.mapped', alive: true });
    assert.equal(unknownSpecies.glyph, 'a', 'unmapped species fall back to the kind default');
  });

  test('appearance color tokens all resolve to exact Dracula values', () => {
    for (const entity of [
      { kind: 'animal', speciesId: 'herbivore.grazer', alive: true },
      { kind: 'plant', speciesId: 'demo.grass', alive: true },
      { kind: 'animal', speciesId: 'herbivore.grazer', alive: false },
      { kind: 'nope', speciesId: '', alive: true },
    ]) {
      const { colorToken } = resolveAppearance(entity);
      assert.match(DRACULA_COLORS[colorToken], /^#[0-9A-F]{6}$/);
    }
  });

  test('multiple occupants order deterministically: living animal > carcass > plant, ties by id', () => {
    const plant = { id: 5, kind: 'plant', speciesId: 'demo.grass', alive: true };
    const carcass = { id: 4, kind: 'animal', speciesId: 'herbivore.grazer', alive: false };
    const animalOld = { id: 2, kind: 'animal', speciesId: 'herbivore.grazer', alive: true };
    const animalNew = { id: 9, kind: 'animal', speciesId: 'herbivore.grazer', alive: true };
    const sorted = [plant, carcass, animalNew, animalOld].sort(compareOccupants);
    assert.deepEqual(sorted.map((entity) => entity.id), [2, 9, 4, 5]);
    assert.equal(topOccupant([plant, carcass, animalNew]).id, 9);
    assert.equal(topOccupant([plant, carcass]).id, 4);
  });
});

describe('grid projection', () => {
  const camera = { centerX: 64, centerY: 64, cellSize: 16 };
  const viewport = { width: 800, height: 600 };

  test('world cells project to integer-aligned screen cells and back', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    // The camera center cell lands mid-viewport.
    const { px, py } = projection.cellToScreen(64, 64);
    assert.ok(Math.abs(px + 8 - viewport.width / 2) <= 16, `center cell x near mid-viewport, got ${px}`);
    assert.ok(Math.abs(py + 8 - viewport.height / 2) <= 16, `center cell y near mid-viewport, got ${py}`);
    assert.equal(px, Math.round(px), 'integer pixel alignment');
    // Round trip: every screen pixel inside the cell maps back to it.
    for (const [dx, dy] of [[0, 0], [15, 15], [8, 3]]) {
      const cell = projection.cellAtScreen(px + dx, py + dy);
      assert.deepEqual(cell, { cellX: 64, cellY: 64 });
    }
    // Neighboring cells are exactly one cellSize apart (no drift).
    const next = projection.cellToScreen(65, 64);
    assert.equal(next.px - px, 16);
  });

  test('screen-to-world selection matches what is drawn at that pixel', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    const entity = { x: 70.9, y: 60.2 };
    const cell = worldCellOf(entity, { width: 128, height: 128 });
    assert.deepEqual(cell, { cellX: 70, cellY: 60 });
    const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
    assert.deepEqual(projection.cellAtScreen(px + 5, py + 5), cell);
  });

  test('entities clamped to the world border display in the last cell', () => {
    const world = { width: 128, height: 128 };
    assert.deepEqual(worldCellOf({ x: 128, y: 0 }, world), { cellX: 127, cellY: 0 });
    assert.deepEqual(worldCellOf({ x: 0, y: 128 }, world), { cellX: 0, cellY: 127 });
  });

  test('visible bounds cover the viewport plus margin', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    const cells = projection.visibleCellBounds();
    assert.ok(cells.maxCellX - cells.minCellX >= viewport.width / camera.cellSize - 1);
    const bounds = projection.visibleWorldBounds(2);
    assert.equal(bounds.minX, cells.minCellX - 2);
    assert.equal(bounds.maxY, cells.maxCellY + 1 + 2);
  });

  test('occupantsInCell returns exactly the entities whose cell matches', () => {
    const world = { width: 128, height: 128 };
    const entities = [
      { id: 1, x: 10.2, y: 10.9 },
      { id: 2, x: 10.8, y: 10.1 },
      { id: 3, x: 11.0, y: 10.5 }, // next cell over
    ];
    assert.deepEqual(occupantsInCell(entities, 10, 10, world).map((entity) => entity.id), [1, 2]);
  });
});

describe('camera', () => {
  test('panning moves the center by whole cells and clamps to world bounds', () => {
    const camera = new Camera({ centerX: 5, centerY: 5, cellSize: 16 });
    camera.panByCells(3, -2);
    assert.equal(camera.centerX, 8);
    assert.equal(camera.centerY, 3);
    camera.panByCells(-100, -100);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.equal(camera.centerX, 0);
    assert.equal(camera.centerY, 0);
    camera.centerOn(999, 999);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.deepEqual([camera.centerX, camera.centerY], [128, 128]);
  });

  test('zoom steps through the fixed levels and stops at the ends', () => {
    const camera = new Camera({ cellSize: ZOOM_LEVELS[0] });
    assert.equal(camera.zoomOut(), false, 'cannot zoom below the smallest level');
    assert.equal(camera.zoomIn(), true);
    assert.equal(camera.cellSize, ZOOM_LEVELS[1]);
    const top = new Camera({ cellSize: ZOOM_LEVELS.at(-1) });
    assert.equal(top.zoomIn(), false, 'cannot zoom above the largest level');
  });

  test('anchored zoom keeps the anchor point in the same screen cell', () => {
    const camera = new Camera({ centerX: 64, centerY: 64, cellSize: 16 });
    const viewport = { width: 800, height: 600 };
    const anchor = { x: 80.5, y: 50.5 };
    const before = createProjection(camera, viewport.width, viewport.height);
    const screenBefore = before.cellToScreen(Math.floor(anchor.x), Math.floor(anchor.y));
    camera.zoomAt(anchor.x, anchor.y, 1);
    const after = createProjection(camera, viewport.width, viewport.height);
    // The world point under the old screen position must still be the anchor's cell.
    const cellAfter = after.cellAtScreen(screenBefore.px + 8, screenBefore.py + 8);
    assert.ok(Math.abs(cellAfter.cellX - Math.floor(anchor.x)) <= 1, `anchor drifted to ${cellAfter.cellX}`);
    assert.ok(Math.abs(cellAfter.cellY - Math.floor(anchor.y)) <= 1, `anchor drifted to ${cellAfter.cellY}`);
    assert.equal(camera.cellSize, 20);
  });

  test('cell size snaps to supported zoom levels', () => {
    assert.equal(new Camera({ cellSize: 15 }).cellSize, 14);
    assert.equal(Camera.snapCellSize(1000), ZOOM_LEVELS.at(-1));
  });
});
