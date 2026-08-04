/**
 * Founding cohort placement (`config.cohorts`, 2026-08-04).
 *
 * Founders used to be placed independently at uniform random over the whole map,
 * so a lion pride began as eight animals scattered across 160×120 units and every
 * social structure in the world had to reassemble itself from nothing.
 *
 * ⚠⚠ **The claim under test is not "animals start closer together".** It is that
 * placing them together is *sufficient* — that the two mechanisms which already
 * own sociality both read proximity, so clustering the founders produces real
 * herds and real prides, clans and bands on the first tick without this feature
 * writing a single social field. So the load-bearing assertions here are the
 * ones in "the social mechanisms pick it up": a `groupId` this suite never wrote
 * and a `world.groups` record this suite never founded.
 *
 * Every assertion is on the **mechanism**, never on a population outcome (D1),
 * and each one that could drift is stated against its own control arm rather
 * than against a remembered number (D40 — run the arm that should not be able to
 * change the number). The leopard is that arm and it lives inside the clustered
 * world: it declares no `cohort` block, so it is placed identically either way.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { getSpecies } from '../src/simulation/config/species/index.js';

const SEEDS = [1, 2, 42];

/** The demo world with clustering forced on or off, everything else default. */
function world(seed, clustered) {
  return createDemoSimulation({ seed, config: { cohorts: { clustered } } });
}

/** Living animals of one species, in creation order. */
function cohortOf(engine, speciesId) {
  return [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.speciesId === speciesId);
}

/** Mean distance from each animal of a cohort to its nearest conspecific. */
function meanNearestNeighbour(animals) {
  if (animals.length < 2) return null;
  let total = 0;
  for (const a of animals) {
    let best = Infinity;
    for (const b of animals) {
      if (b.id === a.id) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < best) best = d;
    }
    total += best;
  }
  return total / animals.length;
}

describe('cohorts: off is the previous world, exactly', () => {
  test('the default config ships clustering on', () => {
    // Flipped 2026-08-04 after the ten-seed gate (A80). ⚠ The gate passed on its
    // stated bar rather than cleanly — see the config comment and DOCS §9.
    const engine = createDemoSimulation({ seed: 42 });
    assert.equal(engine.config.cohorts.clustered, true);
  });

  test('the off arm still reproduces the pre-clustering world exactly', () => {
    // The proof that the switch is a true no-op rather than an argument: with
    // `groupSize` resolving to 1 the offset draw never happens, so the
    // `worldgen` stream sees the identical sequence and every downstream stream
    // is untouched. This is §20 step 1 in a test rather than in a session log.
    //
    // ⚠ Held as a **digest recorded while the default was still off** rather than
    // as a live comparison, because the thing being compared against no longer
    // exists in the tree once `clustered` ships true. It is the same reason the
    // renderer keeps committed fixtures: a baseline you can still generate is
    // not a baseline. If this fails, founding placement moved for a world that
    // asked for none — which is the one change here that would be a defect.
    const EXPECTED = new Map([
      [1, '962914c27f1e6f24'],
      [2, '85c45ea7d8a245fb'],
      [42, 'e7894e1ca8ee0408'],
    ]);
    for (const seed of SEEDS) {
      const digest = createHash('sha256')
        .update([...world(seed, false).world.entities.all()].map((e) => `${e.speciesId}:${e.x},${e.y}`).join('|'))
        .digest('hex')
        .slice(0, 16);
      assert.equal(digest, EXPECTED.get(seed), `seed ${seed}: unclustered founding placement moved`);
    }
  });

  test('a species with no cohort block is drawn from the same distribution in both arms', () => {
    // The leopard declares none, deliberately — a solitary ambush predator that
    // defends ground against its own kind. That makes it the null control living
    // inside the clustered arm (D40): the one cohort the mechanism should not be
    // able to move, and therefore the one that says whether the rest of the world
    // moved it.
    //
    // ⚠⚠ **Its actual coordinates do change, and the reason is worth knowing.**
    // Every cohort draws from the one shared `worldgen` stream in roster order,
    // and a clustered gazelle cohort spends a different number of draws than a
    // scattered one — so every cohort placed after it lands somewhere else. What
    // is invariant is the *procedure* (one uniform anchor per animal, no offset
    // draw) and therefore the distribution, which is what the control needs to
    // be. Asserting bit-identity here would need a stream per cohort, and that
    // would cost the byte-identical off arm above, which is worth more.
    //
    // Pooled over ten seeds, because eight animals on a 160×120 map is a noisy
    // nearest-neighbour statistic and a per-seed assertion would be tuning it.
    const pooled = (clustered, speciesId) => {
      let total = 0;
      for (let seed = 1; seed <= 10; seed += 1) total += meanNearestNeighbour(cohortOf(world(seed, clustered), speciesId));
      return total / 10;
    };
    const leopard = pooled(true, 'predator.leopard') / pooled(false, 'predator.leopard');
    assert.ok(leopard > 0.75 && leopard < 1.25, `the leopard moved: nearest-neighbour ratio ${leopard.toFixed(3)}`);
    // And the contrast, in the same units, so the tolerance above is visibly a
    // noise band rather than a band wide enough to hide the effect.
    const gazelle = pooled(true, 'herbivore.gazelle') / pooled(false, 'herbivore.gazelle');
    assert.ok(gazelle < 0.4, `the gazelle did not cluster: nearest-neighbour ratio ${gazelle.toFixed(3)}`);
  });
});

describe('cohorts: placement', () => {
  test('founders never spawn on impassable terrain (§1.4 C1)', () => {
    // The invariant `passableSpawnPosition` was written for, restated against
    // the offset draw — which is why `positionNear` falls back to the anchor
    // rather than to a fresh global position.
    for (const seed of [1, 7, 42, 99]) {
      const engine = world(seed, true);
      for (const entity of engine.world.entities.all()) {
        assert.ok(
          engine.world.isPassableAt(entity.x, entity.y),
          `seed ${seed}: ${entity.speciesId} ${entity.id} spawned at (${entity.x}, ${entity.y})`,
        );
      }
    }
  });

  test('founders stay inside the world bounds', () => {
    const engine = world(42, true);
    for (const entity of engine.world.entities.all()) {
      assert.ok(entity.x >= 0 && entity.x <= engine.world.width, `x ${entity.x} out of bounds`);
      assert.ok(entity.y >= 0 && entity.y <= engine.world.height, `y ${entity.y} out of bounds`);
    }
  });

  test('a clustered cohort starts far closer to itself than a scattered one', () => {
    // Stated as a ratio against the same cohort in the control arm, not against
    // a remembered distance: the number depends on the map size and the roster,
    // both of which have moved before and will again.
    for (const seed of SEEDS) {
      const off = meanNearestNeighbour(cohortOf(world(seed, false), 'herbivore.gazelle'));
      const on = meanNearestNeighbour(cohortOf(world(seed, true), 'herbivore.gazelle'));
      assert.ok(on < off / 2, `seed ${seed}: clustered gazelle nearest-neighbour ${on} against ${off} scattered`);
    }
  });

  test('a cohort is placed in the number of clusters its group size implies', () => {
    // Counted by single-linkage over the species' own spread: a cluster is a set
    // of founders reachable from each other, which is the same shape the herd
    // label uses and so the same thing the mechanism will see.
    const engine = world(42, true);
    for (const speciesId of ['herbivore.gazelle', 'herbivore.wildebeest', 'predator.lion']) {
      const { cohort } = getSpecies(speciesId);
      const animals = cohortOf(engine, speciesId);
      const expected = Math.ceil(animals.length / cohort.groupSize);
      const seen = new Set();
      let clusters = 0;
      for (const start of animals) {
        if (seen.has(start.id)) continue;
        clusters += 1;
        const queue = [start];
        seen.add(start.id);
        while (queue.length > 0) {
          const current = queue.pop();
          for (const other of animals) {
            if (seen.has(other.id)) continue;
            if (Math.hypot(other.x - current.x, other.y - current.y) > cohort.spread * 2) continue;
            seen.add(other.id);
            queue.push(other);
          }
        }
      }
      // ⚠ Not an equality: two anchors can land near each other, and a cluster
      // beside a lake packs tighter than its spread. The claim is that the
      // roster is placed as a handful of groups rather than as N singletons.
      assert.ok(clusters <= expected + 1, `${speciesId}: ${clusters} clusters against ~${expected} expected`);
      assert.ok(clusters < animals.length / 2, `${speciesId}: ${clusters} clusters is not a grouping of ${animals.length}`);
    }
  });
});

describe('cohorts: the social mechanisms pick it up unaided', () => {
  test('herd labels exist on the first tick, and far more of them than when scattered', () => {
    // ⚠ This is the whole feature. Nothing in `config.cohorts` writes `groupId`
    // — `SocialSystem` derives it every tick from neighbours within
    // `social.groupRadius`, and clustering only puts bodies there.
    for (const seed of SEEDS) {
      const on = world(seed, true);
      const off = world(seed, false);
      on.step(1);
      off.step(1);
      const labelled = (engine) =>
        cohortOf(engine, 'herbivore.gazelle').filter((e) => e.groupId !== null).length;
      const total = cohortOf(on, 'herbivore.gazelle').length;
      assert.ok(labelled(on) > total / 2, `seed ${seed}: only ${labelled(on)} of ${total} gazelle in a herd on tick 1`);
      assert.ok(labelled(on) > labelled(off), `seed ${seed}: ${labelled(on)} labelled against ${labelled(off)} scattered`);
    }
  });

  test('a forming species founds real records on the first tick', () => {
    // The persistent half, and the one a herd label structurally cannot give:
    // `GroupSystem` founds a record from two unattached conspecifics within
    // `groups.joinRadius`. These are identities that will survive the animals
    // walking apart — none of which this suite, or the fixture, wrote.
    for (const seed of SEEDS) {
      const engine = world(seed, true);
      engine.step(1);
      const records = engine.world.groups.all();
      for (const speciesId of ['predator.lion', 'scavenger.hyena', 'herbivore.zebra']) {
        const mine = records.filter((r) => r.speciesId === speciesId);
        assert.ok(mine.length >= 2, `seed ${seed}: ${speciesId} founded ${mine.length} records on tick 1`);
        for (const record of mine) {
          assert.ok(record.memberIds.length >= 2, `${speciesId} record ${record.id} has ${record.memberIds.length} members`);
        }
      }
    }
  });

  test('clustering founds strictly more groups on tick 1 than scattering does', () => {
    for (const seed of SEEDS) {
      const on = world(seed, true);
      const off = world(seed, false);
      on.step(1);
      off.step(1);
      assert.ok(
        on.world.groups.all().length > off.world.groups.all().length,
        `seed ${seed}: ${on.world.groups.all().length} records against ${off.world.groups.all().length} scattered`,
      );
    }
  });

  test('no founding cluster exceeds the registry cap it is placed under', () => {
    // A founding cluster larger than `groups.maxMembers` would place animals
    // together that the registry then refuses to enrol, which reads as a bug in
    // the registry rather than as the arithmetic it is. Asserted against the
    // config so it cannot drift apart from it.
    const engine = world(42, true);
    const { maxMembers } = engine.config.groups;
    for (const speciesId of ['predator.lion', 'scavenger.hyena', 'herbivore.zebra']) {
      const { cohort } = getSpecies(speciesId);
      assert.ok(cohort.groupSize <= maxMembers, `${speciesId} founds clusters of ${cohort.groupSize} against a cap of ${maxMembers}`);
    }
  });
});

describe('cohorts: the switch cannot be overridden by a species', () => {
  test('no species declares `clustered`', () => {
    // DOCS §8: a species block beats the config, so an "off" arm living in one
    // could not switch anything off. The biology (`groupSize`, `spread`) is
    // per-species; the switch is world-level and stays that way.
    for (const speciesId of ['herbivore.gazelle', 'predator.lion', 'scavenger.hyena', 'herbivore.zebra']) {
      const { cohort } = getSpecies(speciesId);
      assert.ok(cohort !== undefined, `${speciesId} declares no cohort block`);
      assert.equal(cohort.clustered, undefined, `${speciesId} declares clustered, which the config must own`);
    }
  });

  test('clustering off ignores every species cohort block', () => {
    // Not merely that the world is unchanged, but that it is unchanged *because*
    // the resolution never reaches the species — the gazelle declares a group
    // size of 20 and is still placed one per anchor, which is visible as a
    // nearest-neighbour distance the clustered arm gets nowhere near.
    assert.ok(getSpecies('herbivore.gazelle').cohort.groupSize > 1, 'the gazelle declares a real group size');
    const off = meanNearestNeighbour(cohortOf(world(42, false), 'herbivore.gazelle'));
    const on = meanNearestNeighbour(cohortOf(world(42, true), 'herbivore.gazelle'));
    assert.ok(off > on * 3, `the off arm clustered anyway: ${off} against ${on}`);
  });
});
