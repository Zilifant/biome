/**
 * Neonatal concealment — the hidden-fawn stage (PLAN-SPECIES.md §3.14, phase 8).
 *
 * Three claims, and they are tested separately because two of them are cheap
 * suppressions and the third is the interesting one:
 *
 *   1. A calf young enough to hide **stays put** instead of following.
 *   2. A calf hidden **on sheltering ground** is not reported as prey.
 *   3. Its mother **comes back to it when it gets hungry** — which is DOCS A34's
 *      named lever ("give patrol a reason") cashed in, and the half without which
 *      the other two starve the calf to death.
 *
 * Plus the two that keep the mechanism honest: it is **exactly inert** for a
 * species that declares no hidden stage, and `config.parenting.concealment`
 * switches the whole thing off world-wide — ⚠ which `aging.hiddenUntil: 0`
 * cannot do, because a species block beats the config (DOCS §8). That trap fired
 * for real while measuring this phase.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { isHiding, isConcealed, hiddenUntilFor } from '../src/simulation/parenting/hiding.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { FeatureKinds } from '../src/simulation/engineering/features.js';

const CONFIG = new SimulationEngine().config;
const GAZELLE = getSpecies('herbivore.gazelle');

/** A species that hides its young, declared entirely in data. */
const HIDER = Object.freeze({
  ...GAZELLE,
  id: 'test.hider',
  aging: Object.freeze({ hiddenUntil: 100 }),
});

/** The same animal with no hidden stage — the species-level control. */
const NON_HIDER = Object.freeze({ ...GAZELLE, id: 'test.plain', aging: Object.freeze({ hiddenUntil: 0 }) });

/** Something that eats them, so the perception side has a point of view. */
const HUNTER = Object.freeze({
  ...getSpecies('predator.stalker'),
  id: 'test.hunter',
  preySpeciesIds: Object.freeze(['test.hider', 'test.plain']),
});

function hidingEngine({ concealment = true, config = {} } = {}) {
  const engine = new SimulationEngine({
    seed: 3,
    config: {
      world: { width: 48, height: 48 },
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
      parenting: { concealment },
      ...config,
    },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, HIDER, NON_HIDER, HUNTER], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  engine.registerSystem(
    new PerceptionSystem({ ...engine.config.perception, concealment: engine.config.parenting.concealment }),
  );
  engine.registerSystem(
    new DecisionSystem({
      ...engine.config.decision,
      ...engine.config.behavior,
      foodMinLevel: engine.config.perception.foodMinLevel,
      drinkRange: engine.config.hydration.drinkRange,
      carcassRange: engine.config.feeding.carcassRange,
      provisionRange: engine.config.parenting.provisionRange,
      parentMinEnergyFraction: engine.config.parenting.parentMinEnergyFraction,
      concealment: engine.config.parenting.concealment,
      shelterStressThreshold: engine.config.locomotion.shelterStressThreshold,
      shelterStressSpan: engine.config.locomotion.shelterStressSpan,
      shelterRelief: engine.config.locomotion.shelterRelief,
      reproduction: {
        minEnergyFraction: engine.config.reproduction.minEnergyFraction,
        cooldownTicks: engine.config.reproduction.cooldownTicks,
      },
    }),
  );
  return engine;
}

function spawn(engine, definition) {
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: HIDER.id,
    heading: 0,
    maxEnergy: 100,
    energy: 90,
    maxHealth: 100,
    health: 100,
    maxHydration: 100,
    hydration: 100,
    maxStamina: 100,
    stamina: 100,
    bodyMass: 30,
    adultMass: 30,
    speed: 1.2,
    lifeStage: 'adult',
    age: 500,
    weaned: true,
    guardianId: null,
    offspring: [],
    ...definition,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** A mother and her newborn, `gap` apart, bonded both ways. */
function family(engine, { gap = 10, calf = {}, mother = {} } = {}) {
  const motherId = spawn(engine, { x: 20, y: 20, ...mother });
  const calfId = spawn(engine, {
    x: 20 + gap,
    y: 20,
    lifeStage: 'juvenile',
    age: 10,
    bodyMass: 5,
    energy: 60,
    weaned: false,
    ...calf,
  });
  const motherEntity = engine.world.entities.get(motherId);
  motherEntity.offspring = [calfId];
  engine.world.entities.get(calfId).guardianId = motherId;
  return { motherId, calfId };
}

const entity = (engine, id) => engine.world.entities.get(id);

/**
 * Make one cell shelter, by digging a burrow into it.
 *
 * ⚠ Terrain is derived and **never mutated** (invariant), so a test cannot paint
 * a cover patch under an animal. A burrow is the other thing `isShelteredAt`
 * counts, and it is genuine mutable state — so this is the honest way to put an
 * animal on sheltering ground. That the two are interchangeable here is the
 * chokepoint doing its job: concealment never learns what shelters, it only asks.
 */
function shelter(engine, cellX, cellY) {
  const threshold = engine.config.engineering.threshold;
  engine.world.features.wear(cellX, cellY, FeatureKinds.BURROW, 1, threshold);
  assert.ok(engine.world.isShelteredAt(cellX + 0.5, cellY + 0.5), 'the burrow should shelter its cell');
}

describe('the hidden stage: predicates', () => {
  test('a species that declares nothing has no hidden stage at all', () => {
    // Exactly the identity rather than approximately it (D16): the age test is
    // never even reached, so no animal of such a species can ever be hiding.
    assert.equal(hiddenUntilFor(undefined), 0);
    assert.equal(hiddenUntilFor({ aging: {} }), 0);
    const newborn = { age: 0, guardianId: 7, weaned: false };
    assert.equal(isHiding(newborn, { aging: { hiddenUntil: 0 } }), false);
    assert.equal(isHiding(newborn, undefined), false);
  });

  test('hiding needs youth, a guardian, and dependence — all three', () => {
    const species = { aging: { hiddenUntil: 100 } };
    assert.equal(isHiding({ age: 50, guardianId: 7, weaned: false }, species), true);
    assert.equal(isHiding({ age: 150, guardianId: 7, weaned: false }, species), false, 'too old');
    // An orphan must get up and fend for itself — `ParentingSystem` clears the
    // bond on the guardian's death, so this is what makes that automatic.
    assert.equal(isHiding({ age: 50, guardianId: null, weaned: false }, species), false, 'orphaned');
    // And a weaned animal feeds itself, so lying still would starve it.
    assert.equal(isHiding({ age: 50, guardianId: 7, weaned: true }, species), false, 'weaned');
  });

  test('concealment needs sheltering ground as well as hiding', () => {
    const engine = hidingEngine();
    const species = engine.species.require(HIDER.id);
    const open = { age: 10, guardianId: 1, weaned: false, x: 20.5, y: 20.5 };
    assert.equal(isHiding(open, species), true);
    assert.equal(isConcealed(engine.world, open, species), false, 'a fawn in the open is still visible');
    // ⚠ Terrain is derived and never mutated (invariant), so the test cannot
    // paint cover — it digs a burrow instead, which is the other thing
    // `isShelteredAt` counts. That the two are interchangeable here is the
    // chokepoint doing its job: concealment never learns what shelters.
    shelter(engine, 20, 20);
    assert.equal(isConcealed(engine.world, open, species), true);
  });
});

describe('the hidden stage: the calf stays put', () => {
  test('a hiding calf chooses `hide` instead of following its distant mother', () => {
    const engine = hidingEngine();
    const { calfId } = family(engine, { gap: 10 });
    engine.step(1);
    const calf = entity(engine, calfId);
    assert.equal(calf.action, 'hide');
    assert.equal(calf.moveIntent.moving, false, 'lying still is the whole behaviour');
    assert.ok(calf.utilityBreakdown.followParent === 0, 'and following is suppressed, not merely outscored');
  });

  test('the same calf, one tick past its hidden age, gets up and follows', () => {
    // The transition is the mechanism: same animal, same world, one field older.
    const engine = hidingEngine();
    const { calfId } = family(engine, { gap: 4, calf: { age: HIDER.aging.hiddenUntil + 1 } });
    engine.step(1);
    const calf = entity(engine, calfId);
    assert.equal(calf.action, 'followParent');
    assert.equal(calf.moveIntent.moving, true);
  });

  test('a hiding calf still runs from a predator it can actually see', () => {
    // Lying still must lose to fleeing. A fawn that has been found should bolt
    // rather than die where it lies, so `hideWeight` sits below `fleeWeight`.
    const engine = hidingEngine();
    const { calfId } = family(engine, { gap: 10 });
    spawn(engine, { speciesId: HUNTER.id, x: 30.5, y: 20, bodyMass: 45, adultMass: 45 });
    engine.step(1);
    assert.equal(entity(engine, calfId).action, 'flee');
  });

  test('a species with no hidden stage is untouched, animal for animal', () => {
    const engine = hidingEngine();
    const { calfId } = family(engine, { gap: 4, calf: { speciesId: NON_HIDER.id } });
    engine.step(1);
    const calf = entity(engine, calfId);
    assert.equal(calf.action, 'followParent');
    assert.equal(calf.utilityBreakdown.hide, 0);
    assert.equal(calf.utilityBreakdown.tend, 0);
  });
});

describe('the hidden stage: concealment from hunters', () => {
  test('a hunter perceives a fawn in the open and not one in cover', () => {
    const engine = hidingEngine();
    const { calfId } = family(engine, { gap: 3 });
    const hunterId = spawn(engine, { speciesId: HUNTER.id, x: 26.5, y: 20, bodyMass: 45, adultMass: 45 });
    engine.step(1);
    assert.equal(engine.world.perception.get(hunterId).nearestPrey?.id, calfId, 'seen in the open');

    // The same world with sheltering ground under the calf.
    const covered = hidingEngine();
    const { calfId: hiddenCalf } = family(covered, { gap: 3 });
    const covering = covered.world.entities.get(hiddenCalf);
    shelter(covered, Math.floor(covering.x), Math.floor(covering.y));
    const hunter2 = spawn(covered, { speciesId: HUNTER.id, x: 26.5, y: 20, bodyMass: 45, adultMass: 45 });
    covered.step(1);
    const seen = covered.world.perception.get(hunter2).nearestPrey;
    // ⚠ Not `null`: the mother is the same species and is still perfectly
    // visible three cells further out, so the hunter falls through to her. That
    // makes this the stronger assertion — the concealed calf is skipped
    // *specifically*, rather than perception having stopped working.
    assert.notEqual(seen?.id, hiddenCalf, 'the concealed calf is not the prey');
    assert.ok(seen, 'while the mother beyond it still is');
    assert.ok(seen.distance > 3, 'and she is the further animal');
  });

  test('⚠ the world-level switch is what turns concealment off, not the species field', () => {
    // The trap this test exists for: `aging.hiddenUntil: 0` in the *config* does
    // not disable a species that declares its own value, because a species block
    // beats the config (DOCS §8). Only `parenting.concealment` does.
    const stillOn = hidingEngine({ config: { aging: { hiddenUntil: 0 } } });
    assert.equal(stillOn.species.require(HIDER.id).aging.hiddenUntil, 100, 'the species value survives');

    const off = hidingEngine({ concealment: false });
    const { calfId } = family(off, { gap: 10 });
    off.step(1);
    const calf = off.world.entities.get(calfId);
    assert.notEqual(calf.action, 'hide', 'no calf hides in an off world');
    assert.equal(calf.utilityBreakdown.hide, 0);
  });
});

describe('the hidden stage: the mother comes back (A34)', () => {
  test('a hungry hidden calf pulls its mother back to it', () => {
    const engine = hidingEngine();
    // A calf far away and hungry: the pull scales with *its* need.
    const { motherId } = family(engine, { gap: 12, calf: { energy: 10 } });
    engine.step(1);
    const mother = entity(engine, motherId);
    assert.equal(mother.action, 'tend');
    assert.equal(mother.moveIntent.moving, true, 'and she actually walks');
    assert.ok(mother.utilityBreakdown.tend > 0);
  });

  test('a full calf exerts no pull at all', () => {
    // This is what stops `tend` becoming a behaviour that always wins: it is
    // scaled by the calf's hunger, so a fed calf is left to lie hidden.
    const engine = hidingEngine();
    const { motherId } = family(engine, { gap: 12, calf: { energy: 100 } });
    engine.step(1);
    assert.equal(entity(engine, motherId).utilityBreakdown.tend, 0);
    assert.notEqual(entity(engine, motherId).action, 'tend');
  });

  test('a starving mother does not walk to a calf she could not feed', () => {
    // She provisions only above `parentMinEnergyFraction`, so below it the trip
    // helps neither of them — the same floor, read from the same config home.
    const engine = hidingEngine();
    const floor = engine.config.parenting.parentMinEnergyFraction;
    const { motherId } = family(engine, {
      gap: 12,
      calf: { energy: 5 },
      mother: { energy: 100 * floor - 1 },
    });
    engine.step(1);
    assert.equal(entity(engine, motherId).utilityBreakdown.tend, 0);
  });

  test('she stops tending once she is close enough to provision', () => {
    const engine = hidingEngine();
    const { motherId } = family(engine, { gap: 1, calf: { energy: 10 } });
    engine.step(1);
    assert.equal(entity(engine, motherId).utilityBreakdown.tend, 0, 'nothing left to close');
  });

  test('an offspring being raised by the other parent is not her responsibility', () => {
    const engine = hidingEngine();
    const { motherId, calfId } = family(engine, { gap: 12, calf: { energy: 10 } });
    // Same offspring list, but the bond points at somebody else.
    entity(engine, calfId).guardianId = 999;
    engine.step(1);
    assert.equal(entity(engine, motherId).utilityBreakdown.tend, 0);
  });
});

describe('the hidden stage in the demo world', () => {
  test('gazelle fawns hide, and their mothers go back to them', () => {
    // The mechanism asserted where it actually lives, not only in a sandbox —
    // and both halves, because the calf half alone would starve them.
    const engine = createDemoSimulation({ seed: 42 });
    let hideTicks = 0;
    let tendTicks = 0;
    for (let t = 0; t < 1600; t += 1) {
      engine.step(1);
      for (const e of engine.world.entities.all()) {
        if (e.kind !== 'animal' || !e.alive) continue;
        if (e.action === 'hide') hideTicks += 1;
        if (e.action === 'tend') tendTicks += 1;
      }
    }
    assert.ok(hideTicks > 0, `fawns should hide (saw ${hideTicks} calf-ticks)`);
    assert.ok(tendTicks > 0, `mothers should return (saw ${tendTicks} adult-ticks)`);
  });

  test('only the gazelle has a hidden stage; every other species reads 0', () => {
    const engine = createDemoSimulation({ seed: 42 });
    assert.equal(hiddenUntilFor(engine.species.require('herbivore.gazelle')), 120);
    for (const id of ['predator.stalker', 'scavenger.vulture', 'scavenger.hyena']) {
      assert.equal(hiddenUntilFor(engine.species.require(id)), 0, `${id} declares no hidden stage`);
    }
  });

  test('no animal of a non-hiding species ever chooses hide or tend', () => {
    // The inertness claim, stated as what is actually checkable: the two new
    // utilities are present on every animal (one object shape in the hot loop, by
    // design) and are exactly 0 for anything without a hidden stage.
    const engine = createDemoSimulation({ seed: 7 });
    for (let t = 0; t < 600; t += 1) {
      engine.step(1);
      for (const e of engine.world.entities.all()) {
        if (e.kind !== 'animal' || !e.alive || e.speciesId === 'herbivore.gazelle') continue;
        assert.equal(e.utilityBreakdown.hide, 0, `${e.speciesId} #${e.id} scored hide`);
        assert.equal(e.utilityBreakdown.tend, 0, `${e.speciesId} #${e.id} scored tend`);
        assert.notEqual(e.action, 'hide');
        assert.notEqual(e.action, 'tend');
      }
    }
  });
});
