import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHeading } from '../src/simulation/systems/DecisionSystem.js';

const TWO_PI = Math.PI * 2;
const deg = (r) => (((r % TWO_PI) + TWO_PI) % TWO_PI) * (180 / Math.PI);

/** Angle between two headings, in degrees, in [0, 180]. */
function angleGapDeg(a, b) {
  let d = Math.abs(deg(a) - deg(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * A minimal world stand-in: bounds plus a passability predicate, which is all
 * `escapeHeading` reads. `blocked` marks whole regions impassable so a terrain
 * pocket can be built without a real TerrainGrid.
 */
function mockWorld(width, height, blocked = () => false) {
  return { width, height, isPassableAt: (x, y) => !blocked(x, y) };
}

describe('escapeHeading: open flight', () => {
  test('far from every edge, it runs straight away from the threat', () => {
    const world = mockWorld(128, 128);
    // Prey at centre, threat due west → escape due east (0°), untouched.
    const h = escapeHeading(world, 64, 64, 54, 64, 6, 8);
    assert.ok(angleGapDeg(h, 0) < 1e-6, `expected ~0°, got ${deg(h).toFixed(1)}°`);
  });

  test('margin 0 with open terrain reproduces straight-away exactly', () => {
    const world = mockWorld(128, 128);
    // Against the right edge, but with wall-awareness disabled (margin 0): the
    // result is the honest away-heading, the pre-fix control behaviour.
    const straight = Math.atan2(64 - 64, 126 - 116); // due east into the wall
    const h = escapeHeading(world, 126, 64, 116, 64, 0, 8);
    assert.ok(angleGapDeg(h, straight) < 1e-6, `expected ${deg(straight)}°, got ${deg(h)}°`);
  });
});

describe('escapeHeading: along-wall glide (option 3)', () => {
  test('driven straight at a wall, it glides along it instead of into it', () => {
    const world = mockWorld(128, 128);
    // Prey against the right edge, threat due west: away is due east (into the
    // wall). The escape must be vertical (along the wall), not into the edge.
    const h = escapeHeading(world, 126, 64, 116, 64, 6, 8);
    const eastGap = angleGapDeg(h, 0);
    assert.ok(eastGap > 45, `should not run east into the wall; got ${deg(h).toFixed(1)}°`);
    // Along the right wall means heading ~90° or ~270°.
    const alongWall = Math.min(angleGapDeg(h, Math.PI / 2), angleGapDeg(h, (3 * Math.PI) / 2));
    assert.ok(alongWall < 5, `expected an along-wall heading, got ${deg(h).toFixed(1)}°`);
  });

  test('the glide leans away from the threat, not toward it', () => {
    const world = mockWorld(128, 128);
    // Threat to the south-west of a prey on the right wall → glide should go
    // north (away from the threat's southerly position), i.e. ~90°.
    const h = escapeHeading(world, 126, 64, 116, 54, 6, 8);
    assert.ok(angleGapDeg(h, Math.PI / 2) < 20, `expected ~north glide, got ${deg(h).toFixed(1)}°`);
  });
});

describe('escapeHeading: cornered break-past (option 5)', () => {
  test('pinned in a map corner, it breaks out along an edge rather than freezing', () => {
    const world = mockWorld(128, 128);
    // Top-right corner, threat on the inward diagonal (south-west). Both away
    // components are walled off; the escape must still be a real heading that
    // leaves the corner (points meaningfully west and/or south along an edge).
    const h = escapeHeading(world, 126, 126, 116, 116, 6, 8);
    const towardCorner = angleGapDeg(h, Math.PI / 4); // 45° = into the corner
    assert.ok(towardCorner > 45, `should not head into the corner; got ${deg(h).toFixed(1)}°`);
    // It should have room in the chosen direction (west or south lead inward).
    const x = 126 + Math.cos(h) * 4;
    const y = 126 + Math.sin(h) * 4;
    assert.ok(x >= 0 && x <= 128 && y >= 0 && y <= 128, `escape leaves the map: (${x.toFixed(1)},${y.toFixed(1)})`);
  });
});

describe('escapeHeading: charge-past when terrain leaves no safer option', () => {
  test('in a tight dead-end with the threat in the only gap, it charges the gap', () => {
    // A narrow west-east tube, closed at the east end, with the threat sitting
    // in the western mouth. The tube is too thin to slip past sideways, so every
    // direction dead-ends within a step or two EXCEPT west — which runs straight
    // at the threat. Fleeing "away" is due east into the closed back wall, so
    // the prey must instead charge west, past the threat, or stand and be caught.
    const blocked = (x, y) => x < 40 || x > 70 || y <= 49 || y >= 51;
    const world = mockWorld(128, 128, blocked);
    const preyX = 66, preyY = 50;
    const threatX = 44, threatY = 50; // due west, in the mouth
    const h = escapeHeading(world, preyX, preyY, threatX, threatY, 6, 10);
    // The decisive property: the escape carries the prey WEST — toward and past
    // the threat, the only room that leads out — not east into the closed end.
    assert.ok(Math.cos(h) < -0.5, `expected a westward charge past the threat, got ${deg(h).toFixed(1)}°`);
    const x = preyX + Math.cos(h) * 4;
    const y = preyY + Math.sin(h) * 4;
    assert.ok(!blocked(x, y), `charge heading leads into rock: (${x.toFixed(1)},${y.toFixed(1)})`);
  });

  test('a roomy concave pocket is a known limitation (documented, not asserted)', () => {
    // When the true exit is farther than `fleeLookahead`, local room probing
    // cannot tell a diagonal that merely stays clear within the horizon from one
    // that actually leads out — so the prey may pick the wrong way in a WIDE
    // cul-de-sac. This is the exit-detection work deferred until restrictive
    // terrain exists to tune against; the assertion here only pins the current
    // behaviour so a future fix has a baseline to change deliberately.
    const blocked = (x, y) => x < 40 || x > 70 || y <= 40 || y >= 60;
    const world = mockWorld(128, 128, blocked);
    const h = escapeHeading(world, 66, 50, 44, 50, 6, 10);
    assert.ok(Number.isFinite(h), 'still returns a finite heading');
  });
});

describe('escapeHeading: determinism', () => {
  test('it is a pure function of its inputs (no draws, repeatable)', () => {
    const world = mockWorld(128, 128);
    const args = [world, 126, 126, 116, 116, 6, 8];
    const a = escapeHeading(...args);
    const b = escapeHeading(...args);
    assert.equal(a, b);
  });
});
