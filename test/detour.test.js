/**
 * Obstacle deflection for directed actions (2026-08-01).
 *
 * The defect: `flee` has been boundary-honest since Step 8 (`escapeHeading`) and
 * `wander` recovers from a block by reading its previous intent, but the ten
 * *directed* actions rebuilt their intent from `atan2(target - self)` every tick
 * and threw the movement system's "blocked → turn around → re-commit" recovery
 * away. An animal aimed at water through a rock re-aimed at the same rock until
 * it died of thirst — measured at 15.6% of directed animal-ticks blocked and
 * immobile on the demo, 40.6% at rocks=6 thickets=8, with unbroken stalls of 372
 * and 964 ticks.
 *
 * These assert the *mechanism* rather than a population outcome (DOCS §15): that
 * a blocked animal gets a takeable heading, that the heading it gets is one the
 * movement system will accept, and that with the mechanism switched off the same
 * animal stalls exactly as it used to.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detourHeading } from '../src/simulation/systems/DecisionSystem.js';
import { stepRefused, normalizeStepRules, stepLength } from '../src/simulation/locomotion/steps.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { recordMemory, MemoryKinds } from '../src/simulation/memory/memories.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const TWO_PI = Math.PI * 2;
const deg = (r) => (((r % TWO_PI) + TWO_PI) % TWO_PI) * (180 / Math.PI);
const GRAZER = getSpecies('herbivore.gazelle');
const RULES = normalizeStepRules({});

function angleGapDeg(a, b) {
  const d = Math.abs(deg(a) - deg(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * A minimal world stand-in, the same shape `escape-heading.test.js` uses: bounds,
 * a passability predicate, and the two lookups `stepRefused` and `stepLength`
 * need. With no crowding cap the grid and entity manager are never touched.
 */
function mockWorld(width, height, blocked = () => false) {
  return {
    width,
    height,
    isPassableAt: (x, y) => !blocked(x, y),
    isThicketAt: () => false,
    speedModifierAt: () => 1,
    cellOf: (x, y) => ({ cellX: Math.floor(x), cellY: Math.floor(y) }),
  };
}

const mover = (x, y) => ({ id: 1, x, y, speed: 1, impairment: 0, disease: null });

describe('detourHeading: geometry', () => {
  test('a wall dead ahead is stepped around, not into', () => {
    // A north–south wall at x >= 64; the animal at 63.5 wants due east.
    const world = mockWorld(128, 128, (x) => x >= 64 && x < 66);
    const h = detourHeading(world, mover(63.5, 64), 0, 6, RULES);
    assert.notEqual(h, null, 'a way around must be found');
    // Due east is refused, so the detour must turn substantially off it...
    assert.ok(angleGapDeg(h, 0) > 30, `expected a real deflection, got ${deg(h).toFixed(1)}°`);
    // ...and whatever it picked must itself be takeable, which is the whole
    // contract between this and the movement system.
    const step = stepLength(world, mover(63.5, 64), false, RULES);
    const tx = 63.5 + Math.cos(h) * step;
    const ty = 64 + Math.sin(h) * step;
    assert.equal(stepRefused(world, mover(63.5, 64), tx, ty, false, null), false);
  });

  test('⚠ a symmetric obstacle resolves the same way every time, so the animal wall-follows', () => {
    // Nothing in the geometry distinguishes north from south here. If the tie
    // broke differently from tick to tick the animal would alternate and stay
    // put — which is the failure this ladder's fixed order exists to prevent.
    const world = mockWorld(128, 128, (x) => x >= 64 && x < 66);
    const first = detourHeading(world, mover(63.5, 64), 0, 6, RULES);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(detourHeading(world, mover(63.5, 64), 0, 6, RULES), first, 'the same block must give the same way around');
    }
  });

  test('walled in on every side, it gives up and returns null rather than inventing a heading', () => {
    const world = mockWorld(128, 128, (x, y) => !(x > 63 && x < 65 && y > 63 && y < 65));
    assert.equal(detourHeading(world, mover(64, 64), 0, 6, RULES), null);
  });

  test('it prefers the way around that still makes progress over turning back', () => {
    // A wall to the east with a gap: north-east is open, so a 45° shave should
    // beat a 135° retreat even though both are takeable.
    const world = mockWorld(128, 128, (x, y) => x >= 64 && x < 66 && y >= 60 && y < 68);
    const h = detourHeading(world, mover(63.5, 67.5), 0, 6, RULES);
    assert.notEqual(h, null);
    assert.ok(Math.cos(h) >= 0 || angleGapDeg(h, 0) <= 90, `expected a forward-leaning detour, got ${deg(h).toFixed(1)}°`);
  });
});

describe('detour: an animal blocked from what it is walking to gets around it', () => {
  /**
   * A world with rock and no water, one thirsty grazer, and a *remembered*
   * waterhole on the far side of a rock. The memory drives `recallWater` without
   * needing real water terrain, so the obstacle can be placed exactly.
   *
   * `explorationRate: 0` because the 5% exploration roll is the one thing that
   * could shake a stalled animal loose by luck — with it on, the control arm
   * would sometimes escape and the test would measure the roll, not the fix.
   */
  function scenario({ detourEnabled }) {
    const engine = new SimulationEngine({
      seed: 7,
      config: {
        world: { width: 64, height: 64 },
        terrain: { ...FLAT_TERRAIN },
      },
    });
    engine.registerSystem(new PerceptionSystem({ defaultRadius: 6 }));
    engine.registerSystem(
      new DecisionSystem({ explorationRate: 0, detourEnabled, maxOccupantsPerCell: null }),
    );
    engine.registerSystem(new MovementSystem({ maxOccupantsPerCell: null }));
    return engine;
  }

  /** A rock pillar the animal has to get around, stamped through the engine's own terrain. */
  function blockColumn(engine, cellX, fromY, toY) {
    const world = engine.world;
    const original = world.isPassableAt.bind(world);
    world.isPassableAt = (x, y) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx === cellX && cy >= fromY && cy <= toY) return false;
      return original(x, y);
    };
  }

  function spawnThirsty(engine) {
    const id = engine.world.entities.queueSpawn({
      kind: 'animal',
      speciesId: GRAZER.id,
      x: 29.5,
      y: 32.5,
      heading: 0,
      lifeStage: 'adult',
      sex: 'male',
      bodyMass: GRAZER.bodyMass,
      adultMass: GRAZER.bodyMass,
      speed: GRAZER.baseSpeed,
      maxEnergy: GRAZER.maxEnergy,
      energy: GRAZER.maxEnergy,
      maxHealth: GRAZER.maxHealth,
      maxHydration: GRAZER.maxHydration,
      hydration: 5, // parched: `recallWater` outscores everything discretionary
      maxStamina: GRAZER.maxStamina,
      stamina: GRAZER.maxStamina,
    });
    engine.applyDeferredEntityChanges(0);
    const entity = engine.world.entities.get(id);
    // A waterhole remembered on the *far* side of the pillar.
    recordMemory(entity, MemoryKinds.WATER, 38, 32, 0, 8);
    return entity;
  }

  /** Runs the world and reports both outcomes that matter: did it get past, and how long did it stand still. */
  function run(engine, entity, ticks) {
    let longestStall = 0;
    let stall = 0;
    let furthestX = entity.x;
    let last = { x: entity.x, y: entity.y };
    for (let t = 0; t < ticks; t += 1) {
      engine.step(1);
      const moved = Math.hypot(entity.x - last.x, entity.y - last.y);
      last = { x: entity.x, y: entity.y };
      stall = moved < 0.02 ? stall + 1 : 0;
      if (stall > longestStall) longestStall = stall;
      if (entity.x > furthestX) furthestX = entity.x;
    }
    return { longestStall, furthestX };
  }

  const WALL_X = 31; // a wall tall enough that straight east is never takeable

  test('with deflection on, it works its way around the wall and reaches the remembered water', () => {
    const engine = scenario({ detourEnabled: true });
    blockColumn(engine, WALL_X, 20, 44);
    const entity = spawnThirsty(engine);
    const { furthestX, longestStall } = run(engine, entity, 120);
    assert.ok(furthestX > WALL_X + 2, `expected it past the wall at x=${WALL_X}; furthest was ${furthestX.toFixed(1)}`);
    assert.ok(longestStall < 20, `it should never be pinned for long; longest stall was ${longestStall} ticks`);
  });

  test('⚠ with deflection off, the same animal never gets past — the defect, pinned', () => {
    const engine = scenario({ detourEnabled: false });
    blockColumn(engine, WALL_X, 20, 44);
    const entity = spawnThirsty(engine);
    const { furthestX, longestStall } = run(engine, entity, 120);
    assert.ok(furthestX <= WALL_X, `the pre-fix behaviour never crosses the wall; it reached ${furthestX.toFixed(1)}`);
    assert.ok(longestStall >= 20, `and it stands still against it; longest stall was only ${longestStall} ticks`);
  });
});

describe('stepRefused: one predicate, two readers', () => {
  test('impassable terrain refuses a step', () => {
    const world = mockWorld(64, 64, (x) => x >= 32);
    assert.equal(stepRefused(world, mover(31.5, 10), 32.5, 10, false, null), true);
    assert.equal(stepRefused(world, mover(31.5, 10), 30.5, 10, false, null), false);
  });

  test('a thicket edge refuses a step in, unless the animal is already inside or cleared to break in', () => {
    const world = { ...mockWorld(64, 64), isThicketAt: (x) => x >= 32 };
    const outside = mover(31.5, 10);
    assert.equal(stepRefused(world, outside, 32.5, 10, false, null), true, 'refused from outside');
    assert.equal(stepRefused(world, outside, 32.5, 10, true, null), false, 'breakThicket clears it');
    const inside = mover(32.5, 10);
    assert.equal(stepRefused(world, inside, 33.5, 10, false, null), false, 'already inside: free to move');
  });
});
