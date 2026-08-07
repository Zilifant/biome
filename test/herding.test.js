/**
 * The herd radius, the neighbour walk that feeds it, and the band affinity that
 * weights it (BEHAVIOR-PLAN P0 + P1 + P2).
 *
 * Three changes to one expression, and the suite is organized around the lines
 * each is not allowed to cross.
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
 * **P2** made a bandmate worth more than a stranger of the same species — the
 * group record's first consumer that moves an animal. Its claims are that the band
 * dominates the centre, that the headcounts (`groupmates`, `adults`) stay
 * headcounts, and that it does **not** collide with the heterospecific weight in
 * `association.js`, which shares the same slot.
 *
 * ⚠ The centroid's **denominator** is the subtle half and has its own block. Two
 * radii mean the numerator and the headcount can come from different sets, and
 * weights mean the numerator is no longer a plain sum — a weighted mean divided by
 * the wrong total is not a mean at all, but a point scaled away from the origin by
 * however far the two disagree.
 *
 * ⚠⚠ **Mutation-tested 2026-08-05, and one assertion was written because of it.**
 * Four deliberate breakages were introduced and every one must fail this file:
 * unweighting the conspecific numerator (2 fail), returning the denominator to a
 * headcount (2), treating every conspecific as a bandmate (3), and letting the band
 * weight leak onto heterospecifics (1). ⚠ That last one passed at first — an
 * associate with *no* declared association is dropped on the species comparison
 * before any band weight could reach it, so only a species declaring **both** rates
 * can catch the collision. That is what `MIXER` exists for.
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
import { herdPackingFloor, herdRadiiIn, herdRadiusOf } from '../src/simulation/social/herding.js';
import { bandAffinitiesIn, bandAffinityOf, bandWorthFor } from '../src/simulation/social/banding.js';
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

/**
 * A banding grazer (P2): a bandmate is worth four bodies, a stranger a quarter of
 * one. Deliberately lopsided so a centroid built the wrong way is off by a distance
 * a test can see rather than by a rounding error.
 */
const BANDED = Object.freeze({
  ...PLAIN,
  id: 'test.banded',
  groups: Object.freeze({ forms: true }),
  behavior: Object.freeze({ sameBandWeight: 4, otherBandWeight: 0.25 }),
});

/** The same animal with parity weights — the identity arm for band affinity. */
const UNBANDED = Object.freeze({
  ...PLAIN,
  id: 'test.unbanded',
  groups: Object.freeze({ forms: true }),
  behavior: Object.freeze({ sameBandWeight: 1, otherBandWeight: 1 }),
});

/**
 * ⚠ A grazer that declares **both** exchange rates — a band affinity and a
 * heterospecific association. It exists for one assertion: the two must not
 * overwrite each other. Without it the "conspecific-only" claim is untestable,
 * because a heterospecific with *no* association is dropped on the species
 * comparison before any band weight could reach it — so the only arrangement that
 * can catch a leak is one where the associate is genuinely being weighted.
 */
const MIXER = Object.freeze({
  ...PLAIN,
  id: 'test.mixer',
  groups: Object.freeze({ forms: true }),
  behavior: Object.freeze({ sameBandWeight: 4, otherBandWeight: 0.25 }),
  association: Object.freeze({ 'test.unbanded': 0.9 }),
});

const SPECIES = [PLAIN, WIDE, SAME, BANDED, UNBANDED, MIXER];

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

  test('⚠ and it still lands on the herd when the bodies are weighted unequally', () => {
    // The P1 fix made numerator and denominator agree across two *radii*; P2 makes
    // the numerator weighted as well. Six animals at one point, three of them worth
    // four bodies and three worth a quarter — a mean that divides by anything but
    // the total weight lands somewhere else entirely.
    // ⚠ 44,44 rather than 45,45: `BANDED` keeps the ordinary six-cell radius, and
    // 45,45 is 7.07 away — outside it. This test is about the weights, so the
    // geometry has to stay inside the radius or it silently tests nothing.
    const engine = socialSandbox();
    const focus = spawn(engine, BANDED.id, { x: 40, y: 40, groupRecordId: 1 });
    for (let i = 0; i < 3; i += 1) spawn(engine, BANDED.id, { x: 44, y: 44, groupRecordId: 1 });
    for (let i = 0; i < 3; i += 1) spawn(engine, BANDED.id, { x: 44, y: 44, groupRecordId: 2 });
    engine.step(1);
    const { centroid } = summaryOf(engine, focus);
    assert.ok(centroid, 'the company is inside the herd radius');
    assert.ok(Math.abs(centroid.x - 44) < 1e-9, `x ${centroid.x} — every body is at 44`);
    assert.ok(Math.abs(centroid.y - 44) < 1e-9, `y ${centroid.y} — every body is at 44`);
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

describe('banding: what a species declares (P2)', () => {
  test('parity is not a declaration, and neither is nonsense', () => {
    assert.deepEqual(bandAffinityOf(BANDED), { same: 4, other: 0.25 });
    assert.equal(bandAffinityOf(UNBANDED), null, '1 and 1 *is* the unweighted behaviour');
    assert.equal(bandAffinityOf(PLAIN), null);
    assert.equal(bandAffinityOf(undefined), null);
    // ⚠ Zero is legal — "contributes no position" is a coherent thing to want.
    assert.deepEqual(bandAffinityOf({ behavior: { otherBandWeight: 0 } }), { same: 1, other: 0 });
    // ⚠⚠ Negative is refused rather than clamped: it reads as "push away", a
    // weighted mean cannot do that, and it can drive the denominator through zero
    // into an animal parked at NaN forever. See social/banding.js.
    assert.equal(bandAffinityOf({ behavior: { sameBandWeight: -2 } }), null);
    assert.equal(bandAffinityOf({ behavior: { otherBandWeight: Infinity } }), null);
    assert.equal(bandAffinityOf({ behavior: { sameBandWeight: 'lots' } }), null);
  });

  test('an unattached animal is parity, never a discount', () => {
    const affinity = { same: 4, other: 0.25 };
    assert.equal(bandWorthFor(affinity, 1, 1), 4, 'my band');
    assert.equal(bandWorthFor(affinity, 1, 2), 0.25, 'somebody else’s band');
    assert.equal(bandWorthFor(affinity, 1, null), 1, 'unattached is not a rival');
    assert.equal(bandWorthFor(affinity, null, 2), 1, 'and neither am I, if I have no band');
    assert.equal(bandWorthFor(null, 1, 2), 1, 'no declaration, no effect');
  });

  test('the world map holds only the species that declare one', () => {
    const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], CONFIG);
    const map = bandAffinitiesIn(registry);
    assert.ok(map.has(BANDED.id));
    assert.equal(map.has(UNBANDED.id), false);
    assert.equal(map.has(PLAIN.id), false);
    assert.equal(bandAffinitiesIn(undefined).size, 0);
  });

  test('the shipped roster declares it on the band-forming grazer', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const map = bandAffinitiesIn(engine.species);
    assert.deepEqual([...map.keys()], ['herbivore.zebra'], 'the zebra, and only the zebra so far');
    const zebra = map.get('herbivore.zebra');
    assert.ok(zebra.same > 1 && zebra.other > 0 && zebra.other < 1, 'a preference and a discount, both positive');
    // ⚠ And it is a species that actually forms records — a band affinity on a
    // species whose `groupRecordId` is always null would be inert by construction.
    assert.equal(engine.species.get('herbivore.zebra').groups.forms, true);
  });
});

describe('banding: the band drives the centre of mass (P2)', () => {
  /** Two overlapping bands of `n`, interleaved so neither owns a side of the field. */
  function twoBands(engine, speciesId, n = 3) {
    const mine = [];
    const theirs = [];
    for (let i = 0; i < n; i += 1) {
      mine.push(spawn(engine, speciesId, { x: 38 + i, y: 40, groupRecordId: 1 }));
      theirs.push(spawn(engine, speciesId, { x: 42 + i, y: 40, groupRecordId: 2 }));
    }
    return { mine, theirs };
  }

  test('a member steers at its own band, not at the aggregation it is standing in', () => {
    const engine = socialSandbox();
    const { mine } = twoBands(engine, BANDED.id);
    engine.step(1);
    // Band 1 sits at x 38,39,40 and band 2 at 42,43,44. Unweighted, the focus
    // animal's centre would be the mean of the other five (~41.4). Weighted, its
    // two bandmates dominate.
    const centroid = summaryOf(engine, mine[0]).centroid;
    assert.ok(centroid.x < 40, `steers toward its own band, not the middle (x ${centroid.x.toFixed(2)})`);

    const flat = socialSandbox();
    const control = twoBands(flat, UNBANDED.id);
    flat.step(1);
    const flatCentroid = summaryOf(flat, control.mine[0]).centroid;
    assert.ok(flatCentroid.x > 40, `and parity weights do not (x ${flatCentroid.x.toFixed(2)})`);
  });

  test('two overlapping bands are drawn to two different points', () => {
    // ⚠ The honest claim, and it is *differential attraction* rather than
    // separation: nothing repels. Each band's members steer at their own centre,
    // so the two centres are distinct — which is what makes the bands pull apart.
    const engine = socialSandbox();
    const { mine, theirs } = twoBands(engine, BANDED.id);
    engine.step(1);
    const a = summaryOf(engine, mine[0]).centroid;
    const b = summaryOf(engine, theirs[0]).centroid;
    assert.ok(a.x < b.x, `the two bands steer at different points (${a.x.toFixed(2)} vs ${b.x.toFixed(2)})`);
  });

  test('⚠ the headcounts stay headcounts', () => {
    // Weighting `adults` would turn a cohesion knob into a predation one: it is
    // what collective vigilance and `mobbing.minMobbers` count.
    const engine = socialSandbox();
    const { mine } = twoBands(engine, BANDED.id);
    engine.step(1);
    const summary = summaryOf(engine, mine[0]);
    assert.equal(summary.groupmates, 5, 'five other bodies, whatever they are worth');
    assert.equal(summary.adults, 5, 'and five adults');
    assert.ok(Math.abs(summary.nearestDistance - 1) < 1e-9, 'nearest is a distance, not a weight');
  });

  test('band affinity is conspecific-only', () => {
    // A record is single-species, so "in a different band" cannot be said about
    // another species — and saying it would be a second heterospecific weight
    // fighting the declared one in association.js.
    const engine = socialSandbox();
    const focus = spawn(engine, BANDED.id, { x: 40, y: 40, groupRecordId: 1 });
    spawn(engine, UNBANDED.id, { x: 43, y: 40, groupRecordId: 2 });
    engine.step(1);
    // No association is declared between them, so the other species is skipped
    // entirely and there is nobody left to build a centre from.
    assert.equal(summaryOf(engine, focus).centroid, null, 'another species is not a discounted bandmate');
  });

  test('⚠⚠ and an associate keeps its declared weight, not the out-of-band discount', () => {
    // The sharp version of the claim above, and the one that actually fails if the
    // two exchange rates are ever refactored into competing branches: an associate
    // with a *different* `groupRecordId` must be worth its association weight
    // (0.9), never `otherBandWeight` (0.25). With a single neighbour the weight
    // cancels out of the mean, so this needs two — one of each kind, at a distance
    // the arithmetic can distinguish.
    const engine = socialSandbox();
    const focus = spawn(engine, MIXER.id, { x: 40, y: 40, groupRecordId: 1 });
    spawn(engine, MIXER.id, { x: 38, y: 40, groupRecordId: 1 }); // bandmate, worth 4
    spawn(engine, UNBANDED.id, { x: 44, y: 40, groupRecordId: 2 }); // associate, worth 0.9
    engine.step(1);

    const summary = summaryOf(engine, focus);
    const expected = (38 * 4 + 44 * 0.9) / (4 + 0.9);
    assert.ok(
      Math.abs(summary.centroid.x - expected) < 1e-9,
      `centroid ${summary.centroid.x.toFixed(4)} vs ${expected.toFixed(4)} — the associate is weighted by the association`,
    );
    assert.equal(summary.groupmates, 1, 'the associate is not a groupmate');
    assert.equal(summary.associates, 1, 'it is company, counted separately');
  });

  test('the world switch turns it off, and a species cannot turn it back on', () => {
    const off = socialSandbox({ social: { bandAffinity: false } });
    const { mine } = twoBands(off, BANDED.id);
    off.step(1);
    assert.ok(summaryOf(off, mine[0]).centroid.x > 40, 'off, every conspecific is worth one body');
  });

  test('⚠⚠ a bandmate’s calf carries both weights, multiplied — not the calf weight alone', () => {
    // ⚠ **This test exists because its absence let a mutation through.** P4's calf
    // weight lands in the same slot as the band affinity, and `worth = calfWeight`
    // instead of `worth *= calfWeight` is invisible unless a calf is standing there
    // with a band weight already on it — in every other arrangement the body it
    // replaces is worth exactly 1. Same hazard `MIXER` exists for, one phase later.
    //
    // "In my band" and "cannot look after itself" are two independent facts about
    // one animal, each spent once inside the centroid, so a bandmate's calf is worth
    // `sameBandWeight × calfWeight` — 4 × 3 here. That is composition, not the
    // double charge D34 forbids, which is one fact charged in two places.
    const engine = socialSandbox({ social: { calfWeight: 3 } });
    const focus = spawn(engine, BANDED.id, { x: 40, y: 40, groupRecordId: 1 });
    spawn(engine, BANDED.id, { x: 36, y: 40, groupRecordId: 1, lifeStage: 'juvenile', guardianId: 9_999, age: 300 });
    spawn(engine, BANDED.id, { x: 44, y: 40, groupRecordId: 2 });
    engine.step(1);

    const composed = (36 * 4 * 3 + 44 * 0.25) / (4 * 3 + 0.25);
    const replaced = (36 * 3 + 44 * 0.25) / (3 + 0.25);
    const { centroid } = summaryOf(engine, focus);
    assert.ok(
      Math.abs(centroid.x - composed) < 1e-9,
      `centroid ${centroid.x.toFixed(4)} vs ${composed.toFixed(4)} — ${replaced.toFixed(4)} would mean the calf weight replaced the band weight`,
    );
  });

  test('⚠ declaring parity is the identity, not a near-miss', () => {
    // The same proof P1 uses: the weighted path, exercised in full, produces the
    // byte-identical world the unweighted one does.
    const run = (speciesId) => {
      const engine = socialSandbox({ seed: 13 });
      for (let i = 0; i < 6; i += 1) {
        spawn(engine, speciesId, { x: 40 + (i % 3), y: 40 + Math.floor(i / 3), groupRecordId: 1 + (i % 2) });
      }
      engine.step(120);
      return JSON.stringify(captureSimulationState(engine)).split(speciesId).join('test.species');
    };
    assert.equal(run(UNBANDED.id), run(PLAIN.id), 'parity weights are the pre-P2 arithmetic');
  });
});

/**
 * The packing floor (2026-08-06) — the number P1 left behind.
 *
 * ⚠⚠ **These tests exist because the mechanism above shipped half a change.**
 * `herdRadius` widened *who* makes the centre of mass and nothing widened the
 * distance an animal insists on standing within of it, so two hundred wildebeest
 * closed on one point until `locomotion.maxOccupantsPerCell` refused 37.5% of
 * their steps and they starved standing on forage. Every assertion here is about
 * the arithmetic rather than about a population: the floor is pure, and a
 * population reading of it would be measuring the seed (D14).
 */
describe('herding: a herd may not be asked to stand closer than it can fit (2026-08-06)', () => {
  test('the floor is the radius that holds the herd at the occupancy cap, times the slack', () => {
    // Hand-checked against the closed form rather than against the function: n
    // bodies at c per cell need n/c cells, and a disc of that area has radius
    // sqrt(n / (π c)). At slack 2 a herd of 100 at a cap of 2 wants ~7.98 units.
    const closedForm = (n, c, slack) => slack * Math.sqrt(n / (Math.PI * c));
    for (const [n, c, slack] of [
      [100, 2, 2],
      [16, 2, 2],
      [8, 2, 2],
      [50, 4, 1],
      [12, 1, 3],
    ]) {
      assert.ok(
        Math.abs(herdPackingFloor(n, c, slack) - closedForm(n, c, slack)) < 1e-12,
        `floor(${n}, ${c}, ${slack}) is the closed form`,
      );
    }
  });

  test('⚠ at slack 2 it reproduces A83’s measured table of how tightly real bands stand', () => {
    // The geometric calibration. A83 measured the *minimum* mean distance from
    // centre a healthy record reaches, by member count, over 7000 ticks; a uniform
    // disc of radius R has a mean radius of (2/3)R, so each is a disc of 1.5× it.
    //
    // ⚠ This pins the *geometry* at the shipped slack of 2. It is what says the
    // number is calibrated rather than chosen — and it is the assertion that would
    // fail first if somebody lowered the slack to quiet the herd consensus, which
    // was measured, tempting on one seed, and worse on three. See
    // `social/herding.js`.
    //
    // ⚠ The claim is deliberately weak — within 25% from eight members up — because
    // the measurement is of real animals on a grid and the formula is of a disc.
    // A tighter bound here would be overfitting to six numbers.
    const measuredMeanDistance = [[8, 1.39], [12, 1.49], [16, 2.01]];
    for (const [members, mean] of measuredMeanDistance) {
      const observedRadius = 1.5 * mean;
      const floor = herdPackingFloor(members, 2, 2);
      assert.ok(
        Math.abs(floor - observedRadius) / observedRadius < 0.25,
        `at ${members} members the floor (${floor.toFixed(2)}) is near what real bands do (${observedRadius.toFixed(2)})`,
      );
    }
  });

  test('⚠⚠ slack 0 is the control arm and returns exactly zero', () => {
    // The whole point of the switch: `max(declared, 0)` is the declared number for
    // every finite double, so an arm with the floor off is the pre-fix arithmetic
    // bit-for-bit rather than merely close to it.
    assert.equal(herdPackingFloor(500, 2, 0), 0);
    assert.equal(herdPackingFloor(500, 2, -1), 0, 'and a negative slack is off, not inverted');
  });

  test('no crowding cap means nothing to derive a floor from', () => {
    // `maxOccupantsPerCell: null` *is* the cap being switched off, and a floor
    // derived from a bound that does not exist would be a number invented here.
    assert.equal(herdPackingFloor(500, null, 2), 0);
    assert.equal(herdPackingFloor(500, 0, 2), 0);
  });

  test('a lone animal has no packing problem', () => {
    // Guarded at `<= 1` rather than `< 2` because the input is a *weight*, not a
    // headcount: a gazelle holding to a wildebeest herd contributes a fraction.
    assert.equal(herdPackingFloor(0, 2, 2), 0);
    assert.equal(herdPackingFloor(1, 2, 2), 0);
    assert.ok(herdPackingFloor(1.5, 2, 2) > 0, 'and a fractional herd above the unit does');
  });

  test('it rises with the herd and falls with the cap, monotonically', () => {
    // Monotone in both arguments is the property that makes it safe to tune: there
    // is no herd size at which asking for more room gives you less.
    let previous = 0;
    for (const n of [2, 4, 8, 16, 32, 64, 128, 256]) {
      const floor = herdPackingFloor(n, 2, 2);
      assert.ok(floor > previous, `a herd of ${n} needs more room than one of half that`);
      previous = floor;
    }
    assert.ok(herdPackingFloor(64, 4, 2) < herdPackingFloor(64, 2, 2), 'a looser cap needs less room');
  });

  test('⚠ the social summary publishes the weight the floor is a function of', () => {
    // The floor is only as good as its input, and the input has to be the *same*
    // number the centroid is divided by — a headcount here and a weighted sum there
    // is the mistake P1's own accumulator note records making.
    const engine = socialSandbox();
    spawn(engine, WIDE.id, { x: 40, y: 40 });
    spawn(engine, WIDE.id, { x: 44, y: 40 });
    const focus = spawn(engine, WIDE.id, { x: 48, y: 40 });
    engine.step(1);
    const summary = summaryOf(engine, focus);
    assert.equal(summary.centroidWeight, 2, 'two conspecifics inside the herd radius');
    assert.ok(summary.centroid, 'and they are the centre it steers at');
  });

  test('an animal standing alone reports a weight of zero, matching its null centroid', () => {
    const engine = socialSandbox();
    const alone = spawn(engine, WIDE.id, { x: 40, y: 40 });
    engine.step(1);
    const summary = summaryOf(engine, alone);
    assert.equal(summary.centroidWeight, 0);
    assert.equal(summary.centroid, null, 'the two agree — there is nobody to be held by');
  });
});
