/**
 * Protocol v36 (PREDATOR-PLAN P8, 2026-08-07) — the two things the predator
 * phases made real and nothing could see.
 *
 * ⚠⚠ **Inspection, not projection.** Neither block is in a bulk snapshot: the
 * prey ceiling is per-animal detail and the clan sizes are an aggregate, and §11's
 * rule is that a snapshot carries what a renderer draws while an inspector answers
 * questions about one animal. What these buy is that "why did that hyena walk past
 * a zebra" and "because it was alone" stop being two inferences.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import fullSnapshotFixture from '../src/renderer/fixtures/example-full-snapshot.json' with { type: 'json' };

describe('protocol v36: the version and the renderer agree', () => {
  test('the engine, the renderer and the committed fixtures are all on one version', () => {
    // The check three stale fixtures once sailed through, kept at every bump.
    // ⚠ `>=`, matching every other version file here (v31–v34). It was `=== 36`
    // for one version, which is a test that fails on the *next* bump rather than
    // on a defect — and the two assertions below are the ones with content: what
    // this file guards is that the renderer and the fixtures moved together, not
    // which number they moved to.
    assert.ok(PROTOCOL_VERSION >= 36, `the prey ceiling shipped at v36, protocol is at ${PROTOCOL_VERSION}`);
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks what the engine emits');
    assert.equal(fullSnapshotFixture.protocolVersion, PROTOCOL_VERSION, 'the fixture was regenerated for this version');
  });
});

describe('protocol v36: the prey ceiling in force', () => {
  /** The first living animal of a species, after enough ticks to have a society. */
  function anyOf(engine, speciesId) {
    return [...engine.world.entities.all()].find((e) => e.speciesId === speciesId && e.alive && e.kind === 'animal');
  }

  test('a hunter reports both ceilings and which one it is actually under', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(30);
    const hyena = anyOf(engine, 'scavenger.hyena');
    const block = engine.getEntityDetails(hyena.id).predation;
    const species = getSpecies('scavenger.hyena');
    assert.ok(block, 'a hunter has a predation block');
    // ⚠ Derived from the species and the animal, never literals: this survives a
    // re-tuned ratio rather than breaking on one (D1).
    assert.equal(block.solo, hyena.bodyMass * species.predation.maxPreyMassRatio);
    assert.equal(block.group, hyena.bodyMass * species.predation.groupPreyMassRatio);
    assert.equal(block.floor, hyena.bodyMass * species.predation.minPreyMassRatio);
    assert.equal(block.needed, species.predation.backingForLargePrey);
    // The load-bearing field: the ceiling actually in force follows the backing.
    const expected = block.backing >= block.needed ? block.group : block.solo;
    assert.equal(block.ceiling, expected, 'the ceiling reported is the one the backing implies');
    assert.ok(block.group > block.solo, 'and a group ceiling that is not higher would say nothing');
  });

  test('⚠ an animal that hunts nothing reports nothing', () => {
    // The vulture is the case that matters: it is a carnivore with an **empty**
    // prey list, so a block here would invite the reading that it has a ceiling
    // rather than no prey at all.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(30);
    for (const speciesId of ['scavenger.vulture', 'herbivore.gazelle']) {
      const animal = anyOf(engine, speciesId);
      assert.equal(engine.getEntityDetails(animal.id).predation, null, `${speciesId} hunts nothing`);
    }
  });

  test('⚠ the backing reported is the one the ceiling was chosen by', () => {
    // ⚠⚠ Both are last tick's, because perception reads the social summary a phase
    // before `SocialSystem` rewrites it. Reporting a *fresh* count beside a stale
    // decision would be the more confusing of the two, and this asserts the pair
    // stays consistent rather than that the count is current.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(50);
    for (const speciesId of ['predator.lion', 'scavenger.hyena']) {
      const animal = anyOf(engine, speciesId);
      if (!animal) continue;
      const block = engine.getEntityDetails(animal.id).predation;
      const summary = engine.world.social.get(animal.id);
      assert.equal(block.backing, summary?.bandmates ?? 0, `${speciesId}: backing is the band count`);
    }
  });
});

describe('protocol v36: clan sizes in the metrics', () => {
  test('mean members per record is reported per species, beside the count', () => {
    // ⚠ The count says how many clans there are; this says how big they are, and
    // the second is what P2 is judged by — its rule solves clan *size* from the
    // founder count. A roster that drifted to pairs reads identically in `bySpecies`.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(60);
    const groups = engine.world.metrics.groups;
    assert.ok(groups.meanSizeBySpecies, 'the aggregate exists');
    assert.deepEqual(
      Object.keys(groups.meanSizeBySpecies).sort(),
      Object.keys(groups.bySpecies).sort(),
      'the two maps describe the same species',
    );
    for (const [speciesId, mean] of Object.entries(groups.meanSizeBySpecies)) {
      assert.ok(mean >= 1, `${speciesId} mean size ${mean}`);
      assert.ok(mean <= (getSpecies(speciesId).groups?.maxMembers ?? engine.config.groups.maxMembers));
    }
    // ⚠ And the two P1/P2 claims, read back out of the metrics rather than out of
    // the registry — a second, independent look at what those phases built.
    assert.equal(groups.bySpecies['predator.lion'], 1, 'one pride');
    assert.equal(
      groups.meanSizeBySpecies['scavenger.hyena'],
      getSpecies('scavenger.hyena').cohort.preferredGroupSize,
      'clans are the size P2 solves for',
    );
  });

  test('⚠ peak concurrent records is deliberately absent', () => {
    // Stated as a test so the omission is a decision rather than a gap: a maximum
    // over time cannot be recomputed from the world, so it would have to be
    // accumulated and persisted and would read differently after a restore. Same
    // reason `saturated` is a sample rather than a count of refusals (DOCS §9).
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(60);
    const groups = engine.world.metrics.groups;
    assert.equal(groups.peak, undefined);
    assert.equal(groups.peakBySpecies, undefined);
    assert.equal(typeof groups.saturated, 'boolean', 'what exists is the sample');
  });
});
