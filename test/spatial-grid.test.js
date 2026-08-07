import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialGrid, MAX_INDEXABLE_ID } from '../src/simulation/world/SpatialGrid.js';

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

  // ⚠ The two guards below cover the query's `Int32Array` scratch, which nothing
  // in a demo world exercises: the biggest neighbour query measured on the demo
  // returns ~80 ids against a 256-entry starting buffer, and ids never approach
  // 2³¹. Both are sandbox tests — 0 simulation ticks.
  test('an id too large for the query scratch is refused at insert, not silently wrapped', () => {
    const grid = new SpatialGrid(10);
    assert.throws(() => grid.insert(MAX_INDEXABLE_ID + 1, 0, 0), /must be an integer in/);
    assert.throws(() => grid.insert(1.5, 0, 0), /must be an integer in/);
    assert.throws(() => grid.insert(-1, 0, 0), /must be an integer in/);
    // The boundary itself is indexable, and answers a query like any other id.
    grid.insert(MAX_INDEXABLE_ID, 0, 0);
    assert.deepEqual(grid.queryRadius(0, 0, 1), [MAX_INDEXABLE_ID]);
  });

  test('a query wider than the scratch buffer still returns every id, in order', () => {
    // 900 co-located entities against a 256-entry starting buffer, so the gather
    // grows it twice. Inserted in descending id so a returned-in-insertion-order
    // bug cannot pass by luck.
    const grid = new SpatialGrid(10);
    const expected = [];
    for (let id = 900; id >= 1; id -= 1) {
      grid.insert(id, 5 + (id % 7) * 0.01, 5);
      expected.push(id);
    }
    expected.sort((a, b) => a - b);
    assert.deepEqual(grid.queryRadius(5, 5, 5), expected);
    // And the grown buffer is reusable: a later, smaller query is unaffected by
    // the stale ids sitting past its own length.
    assert.deepEqual(grid.queryRadius(500, 500, 5), []);
  });
});
