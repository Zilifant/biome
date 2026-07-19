import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialGrid } from '../src/simulation/world/SpatialGrid.js';

describe('spatial grid', () => {
  test('insert and queryCell', () => {
    const grid = new SpatialGrid(10);
    grid.insert(1, 5, 5);
    grid.insert(2, 15, 5);
    grid.insert(3, 5, 15);
    assert.deepEqual(grid.queryCell(0, 0), [1]);
    assert.deepEqual(grid.queryCell(1, 0), [2]);
    assert.deepEqual(grid.queryCell(0, 1), [3]);
    assert.deepEqual(grid.queryCell(9, 9), []);
    assert.equal(grid.size, 3);
  });

  test('queryRadius returns exactly the entities within euclidean range, across cells', () => {
    const grid = new SpatialGrid(10);
    grid.insert(1, 5, 5);
    grid.insert(2, 12, 5); // different cell, distance 7 from (5,5)
    grid.insert(3, 50, 50); // far away
    grid.insert(4, 5, 13); // distance 8
    assert.deepEqual(grid.queryRadius(5, 5, 1), [1]);
    assert.deepEqual(grid.queryRadius(5, 5, 7), [1, 2]);
    assert.deepEqual(grid.queryRadius(5, 5, 8.5), [1, 2, 4]);
    assert.deepEqual(grid.queryRadius(5, 5, 100), [1, 2, 3, 4]);
    assert.deepEqual(grid.queryRadius(200, 200, 5), []);
  });

  test('move relocates entities between cells and updates query results', () => {
    const grid = new SpatialGrid(10);
    grid.insert(1, 5, 5);
    grid.move(1, 5, 5, 25, 5);
    assert.deepEqual(grid.queryCell(0, 0), []);
    assert.deepEqual(grid.queryCell(2, 0), [1]);
    assert.deepEqual(grid.queryRadius(25, 5, 1), [1]);
    // Move within the same cell keeps precise positions for radius checks.
    grid.move(1, 25, 5, 29, 5);
    assert.deepEqual(grid.queryCell(2, 0), [1]);
    assert.deepEqual(grid.queryRadius(25, 5, 1), []);
    assert.deepEqual(grid.queryRadius(29, 5, 1), [1]);
  });

  test('remove deletes entities from the index', () => {
    const grid = new SpatialGrid(10);
    grid.insert(1, 5, 5);
    grid.insert(2, 6, 6);
    assert.equal(grid.remove(1), true);
    assert.deepEqual(grid.queryCell(0, 0), [2]);
    assert.deepEqual(grid.queryRadius(5, 5, 5), [2]);
    assert.equal(grid.size, 1);
    assert.equal(grid.remove(1), false);
  });

  test('negative coordinates land in negative cells', () => {
    const grid = new SpatialGrid(10);
    grid.insert(1, -3, -3);
    assert.deepEqual(grid.queryCell(-1, -1), [1]);
    assert.deepEqual(grid.queryRadius(0, 0, 5), [1]);
  });

  test('misuse is rejected', () => {
    const grid = new SpatialGrid(10);
    grid.insert(1, 0, 0);
    assert.throws(() => grid.insert(1, 5, 5), /already in the spatial grid/);
    assert.throws(() => grid.move(99, 0, 0, 1, 1), /not in the spatial grid/);
    assert.throws(() => new SpatialGrid(0), /positive/);
  });
});
