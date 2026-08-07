/**
 * Predation structure (PLAN-SPECIES.md phase 4): prey eligibility by mass,
 * the agility term in `captureChance`, and carcass possession.
 *
 * ⚠ Two of the three are **inert by construction** — the shipped roster states
 * no mass ratios and no agility, and their defaults are exactly the identity —
 * so, as with the species schema and the group registry, they are proved here
 * against species invented in the test file. The third, possession, is the one
 * change in this phase that a shipped world can actually feel, and it is the
 * only one that was swept.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom, deriveSeed } from '../src/simulation/random/SeededRandom.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { FeedingSystem } from '../src/simulation/systems/FeedingSystem.js';
import { HuntingSystem } from '../src/simulation/systems/HuntingSystem.js';
import { GroupSystem } from '../src/simulation/systems/GroupSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { isEligiblePrey, maxPreyMassFor, minPreyMassFor } from '../src/simulation/predation/predation.js';
import { holderOf, isAvailableTo, mayFeedFreely, outranks } from '../src/simulation/predation/possession.js';
import { dominanceOf } from '../src/simulation/social/dominance.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;
const STALKER = getSpecies('predator.leopard');
const CORVID = getSpecies('scavenger.vulture');

/** Teach one engine about invented species (the roster is a static import list, A50). */
function withSpecies(engine, ...definitions) {
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...definitions], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return registry;
}

function sandbox({ seed = 4, config = {} } = {}) {
  return new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { ...FLAT_TERRAIN },
      ...config,
    },
  });
}

function spawn(engine, definition) {
  const id = engine.world.entities.queueSpawn({ kind: 'animal', lifeStage: 'adult', heading: 0, ...definition });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** An animal built from a species, so dominance and capture odds read sensibly. */
function spawnOf(engine, speciesId, overrides = {}) {
  const species = engine.species.require(speciesId);
  return spawn(engine, {
    speciesId,
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy * 0.3,
    maxHealth: species.maxHealth,
    health: species.maxHealth,
    maxHydration: species.maxHydration,
    hydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
}

function spawnCarcass(engine, { x = 20, y = 20, edibleMass = 40, ...rest } = {}) {
  const id = engine.world.entities.queueSpawn({
    kind: 'carcass',
    speciesId: 'herbivore.gazelle',
    x,
    y,
    alive: false,
    edibleMass,
    decayStage: 0,
    diedTick: 0,
    ...rest,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

const entity = (engine, id) => engine.world.entities.get(id);

describe('predation: prey eligibility by mass', () => {
  test('an unstated bound is no bound at all, and is exactly the identity', () => {
    const hunter = { bodyMass: 45 };
    assert.equal(maxPreyMassFor(hunter, null), Infinity);
    assert.equal(minPreyMassFor(hunter, null), 0);
    assert.equal(maxPreyMassFor(hunter, { maxPreyMassRatio: null }), Infinity);
    assert.equal(isEligiblePrey(hunter, { bodyMass: 4000 }, null), true, 'no ratio ⇒ nothing is excluded');
  });

  test('a species states its ratios or inherits no bound at all', () => {
    // ⚠ Until 2026-07-29 this asserted that *nothing* in the roster stated a
    // ratio — the schema arriving ahead of the species that needed it. The hyena
    // (phase 7) is that species and is the first to declare one, so the claim
    // moves from "nobody bounds anything" to the one that stays true as the
    // roster grows: an undeclared bound is `null`, which skips the comparison
    // entirely rather than approximating it.
    const engine = createDemoSimulation({ seed: 42 });
    const hyena = engine.species.require('scavenger.hyena');
    assert.equal(hyena.predation.maxPreyMassRatio, 1.0, 'a solo hyena takes prey up to its own mass');
    // ⚠ **The floor is asserted as what it admits, not as its value** (D1). It
    // read `=== 0.08` until 2026-08-07, which made a roster number into a test —
    // and when PREDATOR-PLAN lowered every hunter's floor so predators would take
    // the small easy animals in reach, this failed without anything being wrong.
    // The claim that survives is the one the number exists to make: a floor
    // exists, it lets the hunter take the calves of the species on its own list,
    // and it still refuses something too small to be worth a sprint.
    assert.ok(hyena.predation.minPreyMassRatio > 0, 'a hyena has a floor at all');
    const floor = minPreyMassFor({ bodyMass: hyena.bodyMass }, hyena.predation);
    for (const preyId of hyena.preySpeciesIds) {
      const prey = engine.species.require(preyId);
      assert.ok(floor < prey.aging.birthMass, `a hyena's floor (${floor} kg) refuses a newborn ${preyId}`);
    }
    assert.ok(floor > engine.species.require('scavenger.hyena').aging.birthMass * 0.9, 'and is not zero in disguise');
    // ⚠⚠ **This asserted the opposite until 2026-08-07, and the reversal is the
    // point of PREDATOR-PLAN P3.** It read "3.5 × 180 kg is above a 600 kg buffalo,
    // which is what lets a lion *start* a hunt cooperation then improves the odds
    // of" — a ceiling shaped around **A59**, the limitation that eligibility is
    // resolved per animal in perception and cannot know whether help is at hand.
    // P3 closes A59, so the solo ceiling now says what it means: a **lone** lion
    // refuses an adult buffalo, and its `groupPreyMassRatio` is what admits one.
    const lion = engine.species.require('predator.lion');
    const buffalo = engine.species.require('herbivore.buffalo');
    assert.ok(lion.predation.maxPreyMassRatio * lion.bodyMass < buffalo.bodyMass, 'a lone lion refuses an adult buffalo');
    assert.ok(lion.predation.groupPreyMassRatio * lion.bodyMass > buffalo.bodyMass, 'and a pride does not');
    assert.equal(lion.predation.riskyMassRatio, 3, 'and it accepts more risk than the default 2 for doing it');

    // The claim that survives a growing roster: a bound is either **stated** by
    // the species that needs it or **absent**, and absent means `null`, which
    // skips the comparison entirely rather than approximating it (D16).
    const declares = (species) => species.predation.maxPreyMassRatio !== null || species.predation.minPreyMassRatio !== null;
    assert.deepEqual(
      engine.species.all().filter(declares).map((s) => s.id).sort(),
      ['predator.leopard', 'predator.lion', 'scavenger.hyena'],
      'only the species with a reason to bound their prey do — the three that hunt something they must not take whole',
    );
    for (const species of engine.species.all()) {
      if (declares(species)) continue;
      assert.equal(species.predation.maxPreyMassRatio, null, `${species.id} states no ceiling`);
      assert.equal(species.predation.minPreyMassRatio, null, `${species.id} states no floor`);
      assert.equal(species.predation.riskyMassRatio, 2, `${species.id} inherits the old hardcoded cap`);
    }
  });

  test('⚠ calf targeting falls out of one ratio, because the gate reads bodyMass', () => {
    // The whole claim of §3.6: a predator takes the young of a species whose
    // adults it cannot, with no life-stage conditional anywhere and nothing new
    // stored. Both animals below are the *same species*; only their current mass
    // differs, exactly as it would along the growth curve.
    const cat = Object.freeze({
      ...STALKER,
      id: 'test.cat',
      preySpeciesIds: Object.freeze(['test.ox']),
      predation: Object.freeze({ maxPreyMassRatio: 0.6 }),
    });
    const ox = Object.freeze({ ...getSpecies('herbivore.gazelle'), id: 'test.ox', bodyMass: 200 });

    const engine = sandbox();
    withSpecies(engine, cat, ox);
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    const hunter = spawnOf(engine, cat.id, { x: 20, y: 20 });
    const cow = spawnOf(engine, ox.id, { x: 21, y: 20, bodyMass: 200, adultMass: 200 });
    const calf = spawnOf(engine, ox.id, { x: 22, y: 20, bodyMass: 20, adultMass: 200, lifeStage: 'juvenile' });
    engine.step(1);

    // 0.6 × 45 kg = 27 kg: the calf is under it and the cow is far over.
    const seen = engine.world.perception.get(hunter);
    assert.equal(seen.nearestPrey?.id, calf, 'it commits to the calf, though the cow is nearer');
    // ⚠ And the relation itself is untouched — the gate is *outside* `hunts()`,
    // which is the busiest predicate in the engine and was left exactly as cheap
    // as it was (D24).
    assert.equal(engine.species.hunts(cat.id, ox.id), true, 'the species relation still says yes');
    assert.equal(isEligiblePrey(entity(engine, hunter), entity(engine, cow), cat.predation), false);
    assert.equal(isEligiblePrey(entity(engine, hunter), entity(engine, calf), cat.predation), true);
  });

  test('an animal too big to be taken stops treating the hunter as a threat', () => {
    // The mirror of the gate, and the reason it belongs in perception rather
    // than in the hunt: an adult rhino that fled from a leopard for life would
    // be a worse model than one that never noticed it.
    const cat = Object.freeze({
      ...STALKER,
      id: 'test.cat2',
      preySpeciesIds: Object.freeze(['test.ox2']),
      predation: Object.freeze({ maxPreyMassRatio: 0.6 }),
    });
    const ox = Object.freeze({ ...getSpecies('herbivore.gazelle'), id: 'test.ox2', bodyMass: 200 });

    const engine = sandbox();
    withSpecies(engine, cat, ox);
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    const hunter = spawnOf(engine, cat.id, { x: 20, y: 20 });
    const cow = spawnOf(engine, ox.id, { x: 21, y: 20, bodyMass: 200, adultMass: 200 });
    const calf = spawnOf(engine, ox.id, { x: 22, y: 20, bodyMass: 20, adultMass: 200 });
    engine.step(1);

    assert.equal(engine.world.perception.get(cow).nearestThreat, null, 'the cow ignores it');
    assert.equal(engine.world.perception.get(calf).nearestThreat?.id, hunter, 'the calf does not');
  });

  test('a mass floor stops a big predator bothering with something tiny', () => {
    const cat = Object.freeze({
      ...STALKER,
      id: 'test.cat3',
      bodyMass: 180,
      preySpeciesIds: Object.freeze(['herbivore.gazelle']),
      predation: Object.freeze({ minPreyMassRatio: 0.3 }),
    });
    const engine = sandbox();
    withSpecies(engine, cat);
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    const hunter = spawnOf(engine, cat.id, { x: 20, y: 20, bodyMass: 180, adultMass: 180 });
    spawnOf(engine, 'herbivore.gazelle', { x: 21, y: 20, bodyMass: 30, adultMass: 30 });
    const big = spawnOf(engine, 'herbivore.gazelle', { x: 23, y: 20, bodyMass: 60, adultMass: 60 });
    engine.step(1);
    // 0.3 × 180 = 54 kg, so the 30 kg animal is beneath notice.
    assert.equal(engine.world.perception.get(hunter).nearestPrey?.id, big);
  });
});

describe('predation: agility', () => {
  const hunting = new HuntingSystem();
  const predator = { speed: 1.35, stamina: 100, maxStamina: 100, bodyMass: 45 };
  const prey = { speed: 1.2, stamina: 100, maxStamina: 100, bodyMass: 30, health: 100, maxHealth: 100, adultMass: 30 };

  test('the default is exactly the identity, not approximately', () => {
    // D16: if a feature's safety argument is "at the default it does nothing",
    // assert `===` on the untouched value rather than a tolerance.
    const withBlock = hunting.captureChance(predator, prey, undefined, hunting, { ...hunting, agility: 1 });
    assert.equal(withBlock, hunting.captureChance(predator, prey));
  });

  test('an agile prey is caught less often, in exact proportion', () => {
    const base = hunting.captureChance(predator, prey);
    const agile = hunting.captureChance(predator, prey, undefined, hunting, { ...hunting, agility: 2 });
    assert.ok(base > hunting.minCaptureChance && base < hunting.maxCaptureChance, 'the clamps are not in play');
    assert.ok(Math.abs(agile - base / 2) < 1e-12, `${agile} is half of ${base}`);
  });

  test('⚠ agility resolves off the prey, not the hunter', () => {
    // It sits in the `hunting` block, which otherwise describes the animal doing
    // the hunting — the same asymmetry `edibleMassFraction` already has, and the
    // one that is easiest to wire backwards.
    const base = hunting.captureChance(predator, prey);
    const agileHunter = hunting.captureChance(predator, prey, undefined, { ...hunting, agility: 5 }, hunting);
    assert.equal(agileHunter, base, "a predator's own agility does not help it catch things");
  });
});

describe('predation: how dangerous heavy prey is', () => {
  test('riskyMassRatio caps the hunter’s injury risk, and 2 is what it replaced', () => {
    // The old code capped `defenderMass / attackerMass` at a bare 2. Asserting
    // the identity at the default and the effect at 0 pins both ends without
    // exposing the internal term: at 0 the trample chance is 0, so a predator
    // that always gets hurt never does.
    const heavy = Object.freeze({
      ...getSpecies('herbivore.gazelle'),
      id: 'test.heavy',
      bodyMass: 300,
      hunting: Object.freeze({ agility: 1 }),
    });
    const safeCat = Object.freeze({
      ...STALKER,
      id: 'test.safecat',
      preySpeciesIds: Object.freeze(['test.heavy']),
      predation: Object.freeze({ riskyMassRatio: 0 }),
    });
    const boldCat = Object.freeze({ ...safeCat, id: 'test.boldcat', predation: Object.freeze({ riskyMassRatio: 2 }) });

    const injuriesFor = (cat) => {
      const engine = sandbox({ seed: 9 });
      withSpecies(engine, heavy, cat);
      engine.registerSystem(
        new HuntingSystem({
          ...CONFIG.hunting,
          // Force the miss-and-wound path: never capture, always trample.
          maxCaptureChance: 0,
          minCaptureChance: 0,
          predatorInjuryChance: 1,
          predatorInjurySeverity: 0.5,
          riskyMassRatio: CONFIG.predation.riskyMassRatio,
        }),
      );
      const hunter = spawnOf(engine, cat.id, { x: 20, y: 20, action: 'chase' });
      const target = spawnOf(engine, heavy.id, { x: 20.5, y: 20, bodyMass: 300, adultMass: 300 });
      entity(engine, hunter).huntTargetId = target;
      engine.step(1);
      return entity(engine, hunter).injuries.length;
    };

    assert.equal(injuriesFor(safeCat), 0, 'a cap of 0 makes even a 300 kg animal harmless');
    assert.ok(injuriesFor(boldCat) > 0, 'the default cap leaves it dangerous');
  });
});

/** Perception + decision + feeding: the minimum for a contested carcass. */
function carcassEngine({ seed = 4, config = {}, species = [] } = {}) {
  const engine = sandbox({ seed, config });
  if (species.length > 0) withSpecies(engine, ...species);
  engine.registerSystem(new PerceptionSystem(engine.config.perception));
  engine.registerSystem(
    new FeedingSystem({
      ...engine.config.feeding,
      referenceMass: engine.config.metabolism.referenceMass,
      massScalingExponent: engine.config.metabolism.massScalingExponent,
      possessionEnabled: engine.config.carcass.possessionEnabled,
      possessionRange: engine.config.carcass.possessionRange,
      possessionShare: engine.config.carcass.possessionShare,
      possessionEscalationChance: engine.config.carcass.possessionEscalationChance,
      possessionFightSeverity: engine.config.carcass.possessionFightSeverity,
      possessionWinnerInjuryFraction: engine.config.carcass.possessionWinnerInjuryFraction,
      injuryHealthDamage: engine.config.injury.healthDamage,
    }),
  );
  return engine;
}

describe('predation: carcass possession', () => {
  test('feeding claims the body, and the claim is one field', () => {
    const engine = carcassEngine();
    const carcass = spawnCarcass(engine);
    const eater = spawnOf(engine, CORVID.id, { x: 20.5, y: 20, action: 'eat' });
    assert.equal(entity(engine, carcass).possessorId, null, 'a fresh body is unclaimed');
    engine.step(1);
    assert.equal(entity(engine, carcass).possessorId, eater, 'the act of eating is the claim');
  });

  test('⚠ the weaker animal gets scraps, not nothing, and does not contest', () => {
    // Dominance decides a contest — there is no roll to lose — so an outmatched
    // challenger would be choosing to lose and risking a wound for it. But it is
    // not sent away empty either: strict exclusion was measured and cost the
    // demo three seeds of predator survival (see `possession.js`). Two identical
    // animals make the arithmetic exact — same mass, same species, so the only
    // difference between them is who holds the body.
    const engine = carcassEngine();
    const carcass = spawnCarcass(engine);
    const holder = spawnOf(engine, CORVID.id, { x: 20.4, y: 20, action: 'eat', energy: 1 });
    const bystander = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, action: 'eat', energy: 1 });
    engine.step(1);
    assert.equal(entity(engine, carcass).possessorId, holder, 'the lower id claimed it');

    const gained = (id, before) => entity(engine, id).energy - before;
    const holderBefore = entity(engine, holder).energy;
    const bystanderBefore = entity(engine, bystander).energy;
    engine.step(1);
    const share = CONFIG.carcass.possessionShare;
    assert.ok(gained(bystander, bystanderBefore) > 0, 'it eats');
    assert.ok(
      Math.abs(gained(bystander, bystanderBefore) - gained(holder, holderBefore) * share) < 1e-9,
      `the bystander takes exactly ${share} of the holder's rate`,
    );
    assert.equal(entity(engine, carcass).possessorId, holder, 'and picking scraps is not a claim');
  });

  test('`possessionShare: 0` restores strict exclusion, the measured variant', () => {
    const engine = carcassEngine({
      config: { carcass: { ...CONFIG.carcass, possessionShare: 0 } },
    });
    const carcass = spawnCarcass(engine);
    spawnOf(engine, CORVID.id, { x: 20.4, y: 20, action: 'eat', energy: 1 });
    const bystander = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, action: 'eat', energy: 1 });
    engine.step(1);
    const before = entity(engine, bystander).energy;
    engine.step(1);
    assert.equal(entity(engine, bystander).energy, before, 'nothing at all');
    void carcass;
  });

  test('a stronger arrival takes the body, which is the whole of kill theft', () => {
    const engine = carcassEngine();
    const carcass = spawnCarcass(engine);
    // The corvid has the lower id, so it claims first and is then displaced.
    const corvid = spawnOf(engine, CORVID.id, { x: 20.4, y: 20, action: 'eat' });
    const stalker = spawnOf(engine, STALKER.id, { x: 20.6, y: 20, action: 'eat' });
    assert.ok(dominanceOf(entity(engine, stalker)) > dominanceOf(entity(engine, corvid)));

    engine.step(1);
    assert.equal(entity(engine, carcass).possessorId, stalker, 'taken on the tick it arrived');

    // The thief holds it from here: the former owner is down to scraps, and the
    // body does not pass back and forth.
    const corvidBefore = entity(engine, corvid).energy;
    const stalkerBefore = entity(engine, stalker).energy;
    engine.step(1);
    const corvidGain = entity(engine, corvid).energy - corvidBefore;
    const stalkerGain = entity(engine, stalker).energy - stalkerBefore;
    assert.equal(entity(engine, carcass).possessorId, stalker, 'and it stays taken');
    assert.ok(stalkerGain > corvidGain * 4, `the holder eats far more (${stalkerGain} vs ${corvidGain})`);
  });

  test('possession is held by presence: a holder that walks away loses it', () => {
    // ⚠ No timer, and deliberately so — presence answers the question without
    // storing anything, and a claim that no longer holds cannot get stuck.
    const engine = carcassEngine();
    const carcass = spawnCarcass(engine);
    const stalker = spawnOf(engine, STALKER.id, { x: 20.4, y: 20, action: 'eat' });
    const corvid = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, action: 'eat' });
    engine.step(1);
    assert.equal(holderOf(engine.world, entity(engine, carcass), { enabled: true, range: 2 })?.id, stalker);

    engine.world.moveEntity(entity(engine, stalker), 40, 40);
    assert.equal(holderOf(engine.world, entity(engine, carcass), { enabled: true, range: 2 }), null);
    const before = entity(engine, corvid).energy;
    engine.step(1);
    assert.ok(entity(engine, corvid).energy > before, 'the body is free again');
    assert.equal(entity(engine, carcass).possessorId, corvid, 'and the scavenger claims it');
  });

  test('a dead holder holds nothing', () => {
    const engine = carcassEngine();
    const carcass = spawnCarcass(engine);
    const stalker = spawnOf(engine, STALKER.id, { x: 20.4, y: 20, action: 'eat' });
    const corvid = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, action: 'eat' });
    engine.step(1);
    entity(engine, stalker).alive = false;
    const before = entity(engine, corvid).energy;
    engine.step(1);
    assert.ok(entity(engine, corvid).energy > before);
  });

  test('⚠ groupmates share a kill instead of contesting it', () => {
    // The first real payoff of the group registry (§3.8): one clan member takes
    // the body and the rest simply eat, which is what a clan displacing a lone
    // predator actually looks like. Read off the holder's live membership, so
    // there is no second copy of it on the carcass.
    const engine = carcassEngine();
    const carcass = spawnCarcass(engine);
    const big = spawnOf(engine, STALKER.id, { x: 20.4, y: 20, action: 'eat', groupRecordId: 7 });
    const small = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, action: 'eat', groupRecordId: 7 });
    engine.step(1);
    const beforeSmall = entity(engine, small).energy;
    engine.step(1);
    assert.ok(entity(engine, small).energy > beforeSmall, 'a clanmate eats beside the holder');

    // And the predicate says exactly that, for the record.
    const holder = holderOf(engine.world, entity(engine, carcass), { enabled: true, range: 2 });
    assert.equal(mayFeedFreely(holder, entity(engine, small)), true);
    assert.equal(outranks(entity(engine, small), holder), false, 'it certainly did not win it');
    void big;
  });

  test('a real clan, formed by the group system, shares a body', () => {
    // End to end rather than by setting the field: phase 3 founds the record,
    // phase 4 reads it.
    const clan = Object.freeze({
      ...CORVID,
      id: 'test.clan.scavenger',
      groups: Object.freeze({ forms: true, joinRadius: 6, maxMembers: 4, minMembers: 2 }),
    });
    const engine = carcassEngine({ species: [clan] });
    engine.registerSystem(new GroupSystem(engine.config.groups));
    const carcass = spawnCarcass(engine);
    const first = spawnOf(engine, clan.id, { x: 20.4, y: 20, action: 'eat' });
    const second = spawnOf(engine, clan.id, { x: 20.6, y: 20, action: 'eat' });
    engine.step(1);
    assert.notEqual(entity(engine, first).groupRecordId, null, 'the clan formed');
    assert.equal(entity(engine, first).groupRecordId, entity(engine, second).groupRecordId);

    const before = entity(engine, second).energy;
    engine.step(1);
    assert.ok(entity(engine, second).energy > before, 'and both of them eat');
  });

  test('disabled, contention is exactly the old id-ordered queue', () => {
    const engine = carcassEngine({ config: { carcass: { ...CONFIG.carcass, possessionEnabled: false } } });
    const carcass = spawnCarcass(engine);
    const stalker = spawnOf(engine, STALKER.id, { x: 20.4, y: 20, action: 'eat' });
    const corvid = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, action: 'eat' });
    engine.step(2);
    assert.ok(entity(engine, stalker).energy > 0);
    assert.ok(entity(engine, corvid).energy > CORVID.maxEnergy * 0.3, 'both fed, as before');
    assert.equal(entity(engine, carcass).possessorId, null, 'and nothing was ever claimed');
  });

  test('a contest spends exactly three draws, on its own stream', () => {
    // The fixed-draw-budget convention (DOCS §4), and a dedicated stream so a
    // fight over a body cannot shift the `social` sequence that mate contests
    // and territory disputes already share.
    const engine = carcassEngine({ seed: 77 });
    spawnCarcass(engine);
    spawnOf(engine, CORVID.id, { x: 20.4, y: 20, action: 'eat' });
    spawnOf(engine, STALKER.id, { x: 20.6, y: 20, action: 'eat' });
    engine.step(1); // exactly one takeover

    const reference = new SeededRandom(deriveSeed(engine.seed, 'possession'));
    for (let i = 0; i < 3; i += 1) reference.next();
    assert.equal(engine.randomStream('possession').getState(), reference.getState());
    assert.equal(
      Object.keys(engine.serializeRandomStreams()).includes('social'),
      false,
      'the social stream was never touched',
    );
  });

  test('an uncontested meal spends no draws at all', () => {
    const engine = carcassEngine({ seed: 77 });
    spawnCarcass(engine);
    spawnOf(engine, STALKER.id, { x: 20.5, y: 20, action: 'eat' });
    engine.step(5);
    const untouched = new SeededRandom(deriveSeed(engine.seed, 'possession'));
    assert.equal(engine.randomStream('possession').getState(), untouched.getState());
  });
});

describe('predation: the decision and feeding systems agree', () => {
  /**
   * ⚠ The failure this guards against is specific and nasty: if the decision
   * system thought a held carcass was food and the feeding system refused it,
   * the animal would choose `eat` every tick — nothing outscores a meal at your
   * feet — and starve standing on a body it could not touch. One predicate, two
   * readers (D11).
   */
  const decisionEngine = (share) => {
    const engine = sandbox({ seed: 12 });
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    engine.registerSystem(
      new DecisionSystem({
        ...engine.config.decision,
        ...engine.config.behavior,
        foodMinLevel: engine.config.perception.foodMinLevel,
        drinkRange: engine.config.hydration.drinkRange,
        carcassRange: engine.config.feeding.carcassRange,
        possessionEnabled: engine.config.carcass.possessionEnabled,
        possessionRange: engine.config.carcass.possessionRange,
        possessionShare: share,
      }),
    );
    return engine;
  };

  test('with a share, a held body is still worth walking to', () => {
    const engine = decisionEngine(CONFIG.carcass.possessionShare);
    const carcass = spawnCarcass(engine);
    const stalker = spawnOf(engine, STALKER.id, { x: 20.3, y: 20, energy: 10 });
    const corvid = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, energy: 6 });
    entity(engine, carcass).possessorId = stalker;
    engine.step(1);
    assert.equal(entity(engine, corvid).action, 'eat', 'scraps are food');
  });

  test('⚠ under strict exclusion it is not, or the animal starves standing on it', () => {
    // The failure this guards against: if the decision system called a held body
    // food and the feeding system refused it, the animal would choose `eat`
    // every tick — nothing outscores a meal at your feet — and die there. The
    // predicate is shared precisely so that cannot happen at any `share`.
    const engine = decisionEngine(0);
    const carcass = spawnCarcass(engine);
    const stalker = spawnOf(engine, STALKER.id, { x: 20.3, y: 20, energy: 10 });
    const corvid = spawnOf(engine, CORVID.id, { x: 20.6, y: 20, energy: 6 });
    entity(engine, carcass).possessorId = stalker;

    engine.step(1);
    // One body, two hungry carnivores, two different answers.
    assert.equal(entity(engine, stalker).action, 'eat', 'the holder eats');
    assert.notEqual(entity(engine, corvid).action, 'eat', 'the scavenger does not commit to a body it cannot have');
    const strict = { enabled: true, range: 2, share: 0 };
    assert.equal(isAvailableTo(engine.world, entity(engine, carcass), entity(engine, corvid), strict), false);

    // Free the body and it becomes food again on the very next tick.
    engine.world.moveEntity(entity(engine, stalker), 40, 40);
    engine.step(1);
    assert.equal(entity(engine, corvid).action, 'eat');
  });
});

describe('predation: the demo', () => {
  test('possession fires in the demo, and the control restores the old world exactly', () => {
    // ⚠ Unlike the rest of phase 4 this is *not* inert — the demo already had
    // two carnivores contending for the same bodies — which is why it ships
    // behind a switch and was swept against it.
    const held = (config) => {
      const engine = createDemoSimulation({ seed: 42, config });
      engine.step(900);
      return [...engine.world.entities.all()].filter((e) => e.kind === 'carcass' && e.possessorId !== null).length;
    };
    assert.ok(held({}) > 0, 'bodies are being claimed');
    assert.equal(held({ carcass: { possessionEnabled: false } }), 0, 'and the control claims none');
  });

  test('a possessed carcass survives save/load', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(900);
    const before = [...engine.world.entities.all()]
      .filter((e) => e.kind === 'carcass')
      .map((e) => [e.id, e.possessorId]);
    assert.ok(before.some(([, holder]) => holder !== null), 'there is something to lose');

    const saved = JSON.parse(JSON.stringify(engine.world.entities.serialize()));
    const restored = saved.entities.filter((e) => e.kind === 'carcass').map((e) => [e.id, e.possessorId]);
    assert.deepEqual(restored, before, 'the possessor rides in the entity record');
  });
});

describe('predation: the cooperative prey ceiling (PREDATOR-PLAN P3, closing A59)', () => {
  // ⚠⚠ **A59 has been open since 2026-07-30 with the words "this world can say
  // *a pride is better at it* but not *only a pride will try it*".** These are the
  // assertions that make the second sentence sayable. The mechanism is a second,
  // higher ceiling that applies when the hunter has band-mates at hand, and the
  // count it reads is one `SocialSystem` already published for every animal.
  //
  // ⚠⚠ **`backingForLargePrey` counts *others***, so 2 is a trio. Written out
  // because the field was called `groupSizeForLargePrey` for its first hour and
  // the integration test below built a pair and failed on it — the same trap
  // `social.minGroupSize` documents and cannot be renamed out of.
  const HUNTER = { bodyMass: 100 };
  const SOLO = { maxPreyMassRatio: 1.0, minPreyMassRatio: null, groupPreyMassRatio: 3.0, backingForLargePrey: 2 };

  test('both fields absent is exactly the old ceiling, not approximately', () => {
    // D16, the rule every mechanism here ships under: "off" must be the identity
    // rather than a near-identity, so the arm that measures the feature is a
    // proof and not an argument. Any backing at all, with nothing declared.
    for (const backing of [0, 1, 5, 99]) {
      assert.equal(maxPreyMassFor(HUNTER, { maxPreyMassRatio: 1.0 }, backing), 100);
      assert.equal(maxPreyMassFor(HUNTER, null, backing), Infinity);
      assert.equal(isEligiblePrey(HUNTER, { bodyMass: 250 }, { maxPreyMassRatio: 1.0 }, backing), false);
    }
  });

  test('the ceiling lifts at the declared backing and not before it', () => {
    assert.equal(maxPreyMassFor(HUNTER, SOLO, 0), 100);
    assert.equal(maxPreyMassFor(HUNTER, SOLO, 1), 100, 'one other animal is not enough');
    assert.equal(maxPreyMassFor(HUNTER, SOLO, 2), 300);
    assert.equal(maxPreyMassFor(HUNTER, SOLO, 9), 300, 'and it does not keep climbing');
    // The whole point, stated as the sentence A59 said could not be said.
    const quarry = { bodyMass: 250 };
    assert.equal(isEligiblePrey(HUNTER, quarry, SOLO, 1), false, 'a hunter short of backing refuses it');
    assert.equal(isEligiblePrey(HUNTER, quarry, SOLO, 2), true, 'a trio commits to it');
  });

  test('⚠ the floor does not move with the ceiling', () => {
    // A group makes a hunter willing to take on something *bigger*, never
    // something more trivial: `minPreyMassRatio` is about what is worth a sprint,
    // and company does not change that. Asserted because one function now takes a
    // `backing` argument and the other does not, which is easy to "tidy" later.
    const withFloor = { ...SOLO, minPreyMassRatio: 0.2 };
    assert.equal(minPreyMassFor(HUNTER, withFloor), 20);
    assert.equal(isEligiblePrey(HUNTER, { bodyMass: 10 }, withFloor, 5), false);
  });

  test('the shipped species state a group ceiling above their solo one', () => {
    // ⚠ Derived, never literal (D1): the *relation* is the claim. A group ceiling
    // at or below the solo one would be a field that can never change an answer,
    // which is D43 — the failure mode this phase was most at risk of, and was
    // caught by on its first draft.
    const engine = createDemoSimulation({ seed: 42 });
    const declaring = engine.species.all().filter((s) => s.predation?.groupPreyMassRatio !== null);
    assert.deepEqual(declaring.map((s) => s.id).sort(), ['predator.lion', 'scavenger.hyena']);
    for (const species of declaring) {
      const { groupPreyMassRatio, maxPreyMassRatio, backingForLargePrey } = species.predation;
      assert.ok(groupPreyMassRatio > maxPreyMassRatio, `${species.id}: a group ceiling that is not higher does nothing`);
      assert.ok(backingForLargePrey >= 2, `${species.id}: one animal is not a group`);
      // ⚠ And it must admit something that exists. A ceiling above the heaviest
      // animal in the world is the same dead field by another route — which is
      // exactly what the lion's first draft was, at 4.5 against a 600 kg buffalo.
      const reachable = engine.species
        .all()
        .filter((prey) => species.preySpeciesIds.includes(prey.id))
        .filter((prey) => prey.bodyMass > species.bodyMass * maxPreyMassRatio && prey.bodyMass <= species.bodyMass * groupPreyMassRatio);
      assert.ok(reachable.length > 0, `${species.id}: no prey lies between its solo and group ceilings`);
    }
  });

  test('⚠⚠ perception lifts the ceiling from the social summary, one tick late', () => {
    // ⚠ **The integration claim, and the ordering is the reason it needs two
    // ticks.** `PerceptionSystem` is in the `perception` phase and `SocialSystem`
    // at priority −10 of `decision`, which is *later in the same tick* — so the
    // `bandmates` count perception reads was written on the previous tick. That is
    // stated in `predation/predation.js` rather than discovered here, and this
    // test is what would fail if the ordering silently changed.
    //
    // ~4 ticks, sandbox. The species is the real hyena so the numbers are the
    // shipped ones rather than an invented pair.
    // ⚠ All three systems, and each is load-bearing: perception applies the
    // ceiling, `GroupSystem` makes the pair a *record*, and `SocialSystem` is what
    // counts the record-mates into `bandmates`. Without the third the count is
    // simply absent and the ceiling never lifts — which is what this test caught
    // on its first run, and is worth knowing before wiring it anywhere else.
    const engine = sandbox({ seed: 3 });
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    engine.registerSystem(new SocialSystem(engine.config.social));
    engine.registerSystem(new GroupSystem(engine.config.groups));
    const hyena = engine.species.require('scavenger.hyena');
    const solo = hyena.bodyMass * hyena.predation.maxPreyMassRatio;
    const grouped = hyena.bodyMass * hyena.predation.groupPreyMassRatio;
    const wildebeest = engine.species.require('herbivore.wildebeest');
    assert.ok(wildebeest.bodyMass > solo && wildebeest.bodyMass <= grouped, 'an adult wildebeest is the case');
    // One hyena and one grown wildebeest: out of reach.
    const lone = spawnOf(engine, 'scavenger.hyena', { x: 20, y: 20 });
    spawnOf(engine, 'herbivore.wildebeest', { x: 22, y: 20 });
    engine.step(2);
    assert.equal(engine.world.perception.get(lone).nearestPrey, null, 'a lone hyena sees no prey in a grown wildebeest');
    // Clanmates arrive. ⚠ **Two of them, because `backingForLargePrey` counts
    // others** — the hyena's 2 is a trio, and the first draft of this test built a
    // pair and failed. ⚠ And several ticks: one for `GroupSystem` to enrol them
    // into a record, one for `SocialSystem` to count it, one for perception to
    // read that count.
    spawnOf(engine, 'scavenger.hyena', { x: 21, y: 20 });
    spawnOf(engine, 'scavenger.hyena', { x: 20, y: 21 });
    engine.step(4);
    assert.ok(
      engine.world.social.get(lone).bandmates >= hyena.predation.backingForLargePrey,
      'the trio is a clan the social summary can see',
    );
    assert.ok(engine.world.perception.get(lone).nearestPrey !== null, 'and the clan commits to the wildebeest');
  });

  test('⚠ prey fears a group it would not fear alone, which is the other half', () => {
    // ⚠⚠ **Leaving this out would have been a real defect rather than an
    // omission.** Eligibility is read in both directions in one loop: a hunter
    // asking "what can I take" and a prey animal asking "what hunts me". If only
    // the first read the group ceiling, a wildebeest would be hunted by a clan it
    // never flees from — the exact asymmetry the threat branch's own comment in
    // `PerceptionSystem` exists to refuse, pointed the other way.
    const engine = sandbox({ seed: 3 });
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    engine.registerSystem(new SocialSystem(engine.config.social));
    engine.registerSystem(new GroupSystem(engine.config.groups));
    const grazer = spawnOf(engine, 'herbivore.wildebeest', { x: 22, y: 20 });
    spawnOf(engine, 'scavenger.hyena', { x: 20, y: 20 });
    engine.step(2);
    assert.equal(engine.world.perception.get(grazer).nearestThreat, null, 'a grown wildebeest ignores a lone hyena');
    spawnOf(engine, 'scavenger.hyena', { x: 21, y: 20 });
    spawnOf(engine, 'scavenger.hyena', { x: 20, y: 21 });
    engine.step(4);
    assert.ok(engine.world.perception.get(grazer).nearestThreat !== null, 'and fears the clan');
  });
});
