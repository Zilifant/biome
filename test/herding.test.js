/**
 * The herd radius, and the neighbour walk that feeds it (BEHAVIOR-PLAN P0 + P1).
 *
 * Two changes with one seam between them, and the suite is organized around the
 * lines each is not allowed to cross.
 *
 * **P0** split one number into two. `world.neighbourhood` used to be the
 * perception radius by construction — the grid query *was* the gate on everything
 * downstream — and it is now a separate, never-smaller radius so a species whose
 * herd is wider than its eyes can still be served out of the one shared walk
 * (§1.4 C6). Everything perception itself reports has to be gated back down, and
 * the three consumers of the raw list have to gate too. So the claims are: the
 * list gets wider, **the summary does not**, and nothing that reads the list
 * reads past its own radius.
 *
 * **P1** let a species declare `behavior.herdRadius`. The claim that matters is
 * the one it *refuses*: it moves the **centre of mass** and nothing else — not the
 * herd label, not `groupmates`, not `adults`, and therefore not collective
 * vigilance or mobbing. `social/herding.js` is the argument; this is the pin.
 *
 * ⚠ The centroid's **denominator** is the subtle half and has its own block. Two
 * radii mean the numerator and the headcount can come from different sets, and a
 * weighted mean divided by the wrong total is not a mean — it is a point scaled
 * away from the origin, silently, by however far the two disagree.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { herdRadiiIn, herdRadiusOf } from '../src/simulation/social/herding.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;

/**
 * A grazer with ordinary eyes and an ordinary herd — the control arm, and the
 * shape every species in this file is a variation on. ⚠ Invented here rather than
 * borrowed from the roster, because the mechanism has to work for a species
 * declared entirely in data or it is not a species mechanism (the `groups.test.js`
 * `CLAN` idiom).
 */
const PLAIN = Object.freeze({
  id: 'test.plain',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 40,
  baseSpeed: 1.0,
  maxEnergy: 100,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 6 }),
  comfortMin: 2,
  comfortMax: 27,
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/** The same animal, herding at eleven cells — nearly twice what it can see. */
const WIDE = Object.freeze({
  ...PLAIN,
  id: 'test.wide',
  behavior: Object.freeze({ herdRadius: 11 }),
});

/**
 * ⚠ The identity arm: a declaration that names the world's own radius. It runs the
 * whole per-species code path and must come out exactly where `PLAIN` does, which
 * is what proves the new path *reduces* to the old one rather than merely
 * resembling it.
 */
const SAME = Object.freeze({
  ...PLAIN,
  id: 'test.same',
  behavior: Object.freeze({ herdRadius: CONFIG.social.groupRadius }),
});

const SPECIES = [PLAIN, WIDE, SAME];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/** Flat ground, no grass, and the invented roster taught to one engine (A50). */
function sandbox({ seed = 7, config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 96, height: 96 },
      terrain: { ...FLAT_TERRAIN },
      vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 },
      ...config,
    },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return engine;
}

/** Perception + sociality: the minimum a summary needs. */
function socialSandbox({ seed = 7, config = {}, perception = {}, social = {} } = {}) {
  const engine = sandbox({ seed, config });
  engine.registerSystem(new PerceptionSystem({ ...CONFIG.perception, ...perception }));
  engine.registerSystem(new SocialSystem({ ...CONFIG.social, ...social }));
  return engine;
}

function spawn(engine, speciesId, overrides = {}) {
  const species = engine.species.require(speciesId);
  const g = genome();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId,
    heading: 0,
    lifeStage: 'adult',
    age: 2000,
    sex: Sexes.FEMALE,
    genome: g,
    traits: expressGenome(g),
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy * 0.8,
    maxHealth: species.maxHealth,
    health: species.maxHealth,
    maxHydration: species.maxHydration,
    hydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return engine.world.entities.get(id);
}

const summaryOf = (engine, entity) => engine.world.social.get(entity.id);

describe('herding: what a species declares', () => {
  test('a herd radius is a number, and anything else is no declaration at all', () => {
    assert.equal(herdRadiusOf({ behavior: { herdRadius: 11 } }), 11);
    assert.equal(herdRadiusOf(PLAIN), null, 'saying nothing is null, not a default');
    assert.equal(herdRadiusOf(undefined), null);
    assert.equal(herdRadiusOf({ behavior: {} }), null);
    // Nonsense is refused rather than propagated into a grid query.
    assert.equal(herdRadiusOf({ behavior: { herdRadius: 0 } }), null);
    assert.equal(herdRadiusOf({ behavior: { herdRadius: -4 } }), null);
    assert.equal(herdRadiusOf({ behavior: { herdRadius: Infinity } }), null);
    assert.equal(herdRadiusOf({ behavior: { herdRadius: 'wide' } }), null);
  });

  test('the world map holds only the species that declare one', () => {
    const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], CONFIG);
    const radii = herdRadiiIn(registry);
    assert.equal(radii.get(WIDE.id), 11);
    assert.equal(radii.get(SAME.id), CONFIG.social.groupRadius);
    assert.equal(radii.has(PLAIN.id), false, 'a species that says nothing is absent, not present at the default');
    assert.equal(herdRadiiIn(undefined).size, 0, 'and no registry is an empty map rather than a throw');
  });

  test('the shipped roster declares it where the brief asked and nowhere else', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const radii = herdRadiiIn(engine.species);
    assert.deepEqual(
      [...radii.keys()].sort(),
      ['herbivore.buffalo', 'herbivore.wildebeest'],
      'the two large-aggregation grazers, and only those',
    );
    for (const [id, radius] of radii) {
      assert.ok(radius > CONFIG.social.groupRadius, `${id} declares a radius that is actually wider`);
    }
  });
});

describe('herding: the neighbour walk is not the perception radius (P0)', () => {
  test('the shared list reaches a herd radius the senses do not', () => {
    const engine = socialSandbox();
    const focus = spawn(engine, WIDE.id, { x: 40, y: 40 });
    const seen = spawn(engine, WIDE.id, { x: 44, y: 40 }); // 4 — inside the eyes
    const unseen = spawn(engine, WIDE.id, { x: 49, y: 40 }); // 9 — herd only
    const gone = spawn(engine, WIDE.id, { x: 55, y: 40 }); // 15 — beyond both
    engine.step(1);

    const list = engine.world.neighbourhood.get(focus.id);
    const ids = list.filter((_, i) => i % 2 === 0);
    assert.deepEqual(ids.sort((a, b) => a - b), [seen.id, unseen.id], 'the walk carries the herd, not the world');
    assert.equal(engine.world.neighbourhoodRadius.get(focus.id), 11, 'and it reports the radius it walked');

    // ⚠ The summary is unmoved. This is the line P0 exists to draw: what an
    // animal hands on to sociality is wider than what it can see, and every
    // perception answer is still gated at `radius`.
    const perceived = engine.world.perception.get(focus.id);
    assert.equal(perceived.radius, 6, 'the senses are the species\' own, untouched');
    assert.equal(perceived.animalCount, 1, 'it perceives one animal, not two');
    assert.equal(perceived.nearestAnimal.id, seen.id);
    assert.equal(engine.world.entities.get(gone.id).id, gone.id, 'and the far one exists — it is simply nowhere');
  });

  test('a species that declares nothing walks exactly the radius it always did', () => {
    const engine = socialSandbox();
    const focus = spawn(engine, PLAIN.id, { x: 40, y: 40 });
    spawn(engine, PLAIN.id, { x: 44, y: 40 });
    spawn(engine, PLAIN.id, { x: 49, y: 40 });
    engine.step(1);
    assert.equal(engine.world.neighbourhoodRadius.get(focus.id), 6);
    const ids = engine.world.neighbourhood.get(focus.id).filter((_, i) => i % 2 === 0);
    const expected = engine.world.grid.queryRadius(40, 40, 6).filter((id) => id !== focus.id);
    assert.deepEqual(ids, expected, 'the list is the grid query it has always been');
  });

  test('the floor serves world-level consumers without touching what is sensed', () => {
    // The alarm and the join range are world-level radii, so a short-sighted
    // species would otherwise send the social and group systems off to walk the
    // grid a second time — the cost §1.4 C6 removed. The floor is what the
    // composition root wires; it must not widen perception itself.
    const engine = socialSandbox({ perception: { minNeighbourRadius: 10 } });
    const focus = spawn(engine, PLAIN.id, { x: 40, y: 40 });
    const far = spawn(engine, PLAIN.id, { x: 48, y: 40 }); // 8 — past the eyes
    engine.step(1);
    assert.equal(engine.world.neighbourhoodRadius.get(focus.id), 10);
    assert.ok(
      engine.world.neighbourhood.get(focus.id).includes(far.id),
      'the floor put it on the shared list',
    );
    assert.equal(engine.world.perception.get(focus.id).animalCount, 0, 'and perception still cannot see it');
  });

  test('⚠ a carcass past the senses is on nobody\'s nose', () => {
    // This branch never had a distance gate of its own — the query radius was it —
    // so widening the walk without adding one silently extends every scavenger's
    // and cacher's reach.
    const engine = socialSandbox();
    const focus = spawn(engine, WIDE.id, { x: 40, y: 40 });
    const body = spawn(engine, WIDE.id, { x: 49, y: 40 }); // 9 — inside the herd walk
    body.kind = 'carcass';
    body.alive = false;
    body.edibleMass = 25;
    engine.step(1);
    assert.equal(engine.world.perception.get(focus.id).nearestCarcass, null, 'nine cells away, six-cell eyes');

    body.x = 44; // 4 — now inside them
    engine.step(1);
    assert.equal(engine.world.perception.get(focus.id).nearestCarcass?.id, body.id);
  });

  test('the walked radius is transient and never serialized', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(5);
    const saved = captureSimulationState(engine);
    assert.ok(!('neighbourhoodRadius' in saved), 'it is derived from where everyone is standing');
    assert.ok(saved.entities.entities.every((e) => !('neighbourhoodRadius' in e)));
  });

  test('a wide-herd species still reuses the shared walk rather than starting a second one', () => {
    // The reuse check compares the *neighbour* radius; reading the perception
    // radius there would drop precisely the species the widening was built for
    // back onto its own grid query, which is a silent performance regression no
    // behavioural test would catch.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(2);
    const needed = Math.max(CONFIG.social.groupRadius, CONFIG.social.alarmRadius);
    for (const animal of engine.world.entities.all()) {
      if (animal.kind !== 'animal' || !animal.alive) continue;
      const walked = engine.world.neighbourhoodRadius.get(animal.id);
      const herd = herdRadiusOf(engine.species.get(animal.speciesId)) ?? 0;
      assert.ok(
        walked >= Math.max(needed, herd),
        `${animal.speciesId} walked ${walked}, short of the ${Math.max(needed, herd)} sociality asks for`,
      );
    }
  });
});

describe('herding: a wider herd is a wider centre of mass, and nothing else (P1)', () => {
  /** Focus plus `count` conspecifics in a line, `gap` apart, starting at `from`. */
  function line(engine, speciesId, { from = 8, gap = 0, count = 2 } = {}) {
    const focus = spawn(engine, speciesId, { x: 40, y: 40 });
    const others = [];
    for (let i = 0; i < count; i += 1) others.push(spawn(engine, speciesId, { x: 40 + from + i * gap, y: 40 }));
    return { focus, others };
  }

  test('company beyond the group radius is company, if the species says so', () => {
    const engine = socialSandbox();
    const { focus } = line(engine, WIDE.id, { from: 8, gap: 1 }); // 8 and 9: past 6, inside 11
    engine.step(1);
    const summary = summaryOf(engine, focus);
    assert.ok(summary.centroid, 'there is a centre to steer at');
    assert.ok(Math.abs(summary.centroid.x - 48.5) < 1e-9, 'and it is the mean of the two of them');
    assert.equal(summary.centroid.y, 40);
  });

  test('and for a species that says nothing, it is not', () => {
    const engine = socialSandbox();
    const { focus } = line(engine, PLAIN.id, { from: 8, gap: 1 });
    engine.step(1);
    assert.equal(summaryOf(engine, focus).centroid, null, 'six cells is six cells');
  });

  test('⚠ the label, the groupmates and the adults all stay on the world radius', () => {
    // The refusal, and the reason for it: `adults` is what collective vigilance
    // and `mobbing.minMobbers` count, so widening it would make this animal
    // harder to kill as a side effect of a cohesion change.
    const engine = socialSandbox();
    const focus = spawn(engine, WIDE.id, { x: 40, y: 40 });
    spawn(engine, WIDE.id, { x: 48, y: 40 }); // 8 — in the herd, not in the group
    spawn(engine, WIDE.id, { x: 49, y: 40 }); // 9 — the same
    engine.step(2);
    const summary = summaryOf(engine, focus);
    assert.equal(summary.groupmates, 0, 'nobody is a groupmate at eight cells');
    assert.equal(summary.adults, 0, 'so nobody is a defender either');
    assert.equal(summary.nearestDistance, null);
    assert.equal(engine.world.entities.get(focus.id).groupId, null, 'and no label forms');
    assert.ok(summary.centroid, 'while the centre of mass is exactly what changed');
  });

  test('the demo\'s wide-herd grazers count defenders at the world radius', () => {
    // The same claim against the real roster, brute-forced rather than trusted:
    // whatever the wildebeest and buffalo now steer at, `adults` is still the
    // adults within `social.groupRadius`.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(3);
    let checked = 0;
    for (const animal of engine.world.entities.all()) {
      if (animal.kind !== 'animal' || !animal.alive) continue;
      if (herdRadiusOf(engine.species.get(animal.speciesId)) === null) continue;
      let expected = 0;
      for (const other of engine.world.entities.all()) {
        if (other.id === animal.id || other.kind !== 'animal' || !other.alive) continue;
        if (other.speciesId !== animal.speciesId) continue;
        if (other.lifeStage !== 'adult' && other.lifeStage !== 'senescent') continue;
        if (Math.hypot(other.x - animal.x, other.y - animal.y) > CONFIG.social.groupRadius) continue;
        expected += 1;
      }
      const summary = engine.world.social.get(animal.id);
      // ⚠ Symptomatic animals are excluded from the summary before any of this,
      // so a brute-force count can only ever be an upper bound in a world with
      // disease in it. Assert that direction rather than equality.
      assert.ok(
        summary.adults <= expected,
        `${animal.speciesId} counted ${summary.adults} adults against at most ${expected} inside the group radius`,
      );
      checked += 1;
    }
    assert.ok(checked > 0, 'the roster really does contain a wide-herd species');
  });

  test('the world switch turns it off, and a species cannot turn it back on', () => {
    const on = socialSandbox();
    const { focus: wide } = line(on, WIDE.id, { from: 8, gap: 1 });
    on.step(1);
    assert.ok(summaryOf(on, wide).centroid, 'on, the declaration bites');

    const off = socialSandbox({ social: { perSpeciesRadius: false } });
    const { focus: narrowed } = line(off, WIDE.id, { from: 8, gap: 1 });
    off.step(1);
    assert.equal(summaryOf(off, narrowed).centroid, null, 'off, it herds at the world radius like everything else');
  });

  test('⚠ declaring the world radius is the identity, not a near-miss', () => {
    // The strongest inertness claim available without a copy of the old engine:
    // the per-species path, exercised in full, produces the byte-identical world
    // the single-radius path does.
    const run = (speciesId) => {
      const engine = socialSandbox({ seed: 11 });
      for (let i = 0; i < 6; i += 1) spawn(engine, speciesId, { x: 40 + (i % 3), y: 40 + Math.floor(i / 3) });
      engine.step(120);
      const state = captureSimulationState(engine);
      // The species id is the one thing that legitimately differs.
      return JSON.stringify(state).split(speciesId).join('test.species');
    };
    assert.equal(run(SAME.id), run(PLAIN.id), 'a declared six is the six it always was');
  });
});

describe('herding: the centroid\'s denominator', () => {
  /**
   * ⚠⚠ The regression this block exists for. Until P1 every conspecific
   * contributed exactly `1` to the position sums *and* lived inside the same gate
   * as `groupmates`, so a headcount was the total weight behind the mean. Two
   * radii break both halves: divide a numerator gathered over `herdRadius` by a
   * headcount gathered over `groupRadius` and the result is not a mean — it is a
   * point scaled away from the origin by the ratio of the two counts, silently,
   * and on a map this size that is tens of units of error in a number that steers
   * every herding animal.
   */
  test('the centre of a herd is on the herd, however the two radii fall', () => {
    const engine = socialSandbox();
    const focus = spawn(engine, WIDE.id, { x: 40, y: 40 });
    // Three inside the group radius, three only inside the herd radius. With a
    // headcount denominator this comes out at twice the distance from the origin.
    const company = [
      { x: 43, y: 40 },
      { x: 40, y: 43 },
      { x: 44, y: 44 },
      { x: 48, y: 40 },
      { x: 40, y: 49 },
      { x: 47, y: 47 },
    ];
    for (const at of company) spawn(engine, WIDE.id, at);
    engine.step(1);

    const summary = summaryOf(engine, focus);
    const meanX = company.reduce((a, c) => a + c.x, 0) / company.length;
    const meanY = company.reduce((a, c) => a + c.y, 0) / company.length;
    assert.ok(Math.abs(summary.centroid.x - meanX) < 1e-9, `centroid x ${summary.centroid.x} vs mean ${meanX}`);
    assert.ok(Math.abs(summary.centroid.y - meanY) < 1e-9, `centroid y ${summary.centroid.y} vs mean ${meanY}`);
    // And it is genuinely the mixed case — the bug only shows when they disagree.
    assert.equal(summary.groupmates, 3, 'three of the six are groupmates');
  });

  test('a centroid never lands outside the animals that made it', () => {
    // The scaling failure states itself: a mean of positions is inside their
    // bounding box, and the broken denominator puts it outside.
    const engine = socialSandbox();
    const focus = spawn(engine, WIDE.id, { x: 40, y: 40 });
    for (const at of [{ x: 45, y: 45 }, { x: 47, y: 46 }, { x: 49, y: 44 }]) spawn(engine, WIDE.id, at);
    engine.step(1);
    const { centroid } = summaryOf(engine, focus);
    assert.ok(centroid.x >= 45 && centroid.x <= 49, `x ${centroid.x} inside [45, 49]`);
    assert.ok(centroid.y >= 44 && centroid.y <= 46, `y ${centroid.y} inside [44, 46]`);
  });
});
