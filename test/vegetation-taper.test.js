import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeTaper } from '../src/simulation/world/VegetationGrid.js';

const demoParams = {
  edgeTaperFraction: 0.18,
  edgeTaperIrregularity: 0.4,
  edgeTaperCornerBoost: 1.5,
  edgeTaperMinDimension: 64,
};

describe('buildEdgeTaper: enable/disable gating', () => {
  test('returns null when disabled (fraction 0)', () => {
    assert.equal(buildEdgeTaper({ width: 128, height: 128, seed: 1, params: { ...demoParams, edgeTaperFraction: 0 } }), null);
  });

  test('returns null on a map below the minimum dimension (test sandboxes untouched)', () => {
    assert.equal(buildEdgeTaper({ width: 40, height: 40, seed: 1, params: demoParams }), null);
    assert.notEqual(buildEdgeTaper({ width: 128, height: 128, seed: 1, params: demoParams }), null);
  });
});

describe('buildEdgeTaper: shape', () => {
  const taper = buildEdgeTaper({ width: 128, height: 128, seed: 42, params: demoParams });

  test('full capacity deep in the interior, ~zero at the edges', () => {
    assert.ok(taper(64, 64) > 0.99, `centre should be full, got ${taper(64, 64)}`);
    assert.ok(taper(0, 64) < 0.05, `edge should be ~0, got ${taper(0, 64)}`);
    assert.ok(taper(64, 127) < 0.05, `edge should be ~0, got ${taper(64, 127)}`);
  });

  test('it is a gradual ramp, not a cliff (monotone-ish inward from an edge)', () => {
    // Sampling straight in from the left edge at mid-height, capacity rises.
    const near = taper(3, 64);
    const mid = taper(14, 64);
    const deep = taper(30, 64);
    assert.ok(near < mid && mid < deep, `expected a rising ramp, got ${near.toFixed(2)} ${mid.toFixed(2)} ${deep.toFixed(2)}`);
  });

  test('corners are suppressed harder than straight edges at the same inset', () => {
    // Same distance from the boundary (~10 cells in), but one is a corner
    // (near two edges) and one is mid-edge (near one). The corner must be lower.
    const corner = taper(10, 10);
    const edge = taper(10, 64);
    assert.ok(corner < edge, `corner (${corner.toFixed(3)}) should be below edge (${edge.toFixed(3)})`);
    assert.ok(corner < 0.5 * edge, `corner should be rounded off much harder, got ${corner.toFixed(3)} vs ${edge.toFixed(3)}`);
  });

  test('the coastline is irregular, not a perfect rectangle', () => {
    // At a fixed inland depth along the top edge, capacity varies from column to
    // column — a straight taper would give a constant value here.
    const samples = [];
    for (let x = 20; x < 108; x += 8) samples.push(taper(x, 10));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    assert.ok(max - min > 0.1, `expected a wobbly coastline, spread was ${(max - min).toFixed(3)}`);
  });
});

describe('buildEdgeTaper: determinism', () => {
  test('same seed and params give the same field; a different seed differs', () => {
    const a = buildEdgeTaper({ width: 128, height: 128, seed: 42, params: demoParams });
    const b = buildEdgeTaper({ width: 128, height: 128, seed: 42, params: demoParams });
    const c = buildEdgeTaper({ width: 128, height: 128, seed: 43, params: demoParams });
    assert.equal(a(30, 12), b(30, 12));
    assert.notEqual(a(30, 12), c(30, 12)); // the irregular coastline is seed-dependent
  });
});
