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
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { isEligiblePrey, maxPreyMassFor, minPreyMassFor } from '../src/simulation/predation/predation.js';
import { holderOf, isAvailableTo, mayFeedFreely, outranks } from '../src/simulation/predation/possession.js';
import { dominanceOf } from '../src/simulation/social/dominance.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';

const CONFIG = new SimulationEngine().config;
const STALKER = getSpecies('predator.stalker');
const CORVID = getSpecies('scavenger.corvid');

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
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
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
    speciesId: 'herbivore.grazer',
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

  test('the shipped roster states no ratios, so nothing is gated today', () => {
    const engine = createDemoSimulation({ seed: 42 });
    for (const species of engine.species.all()) {
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
    const ox = Object.freeze({ ...getSpecies('herbivore.grazer'), id: 'test.ox', bodyMass: 200 });

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
    const ox = Object.freeze({ ...getSpecies('herbivore.grazer'), id: 'test.ox2', bodyMass: 200 });

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
      preySpeciesIds: Object.freeze(['herbivore.grazer']),
      predation: Object.freeze({ minPreyMassRatio: 0.3 }),
    });
    const engine = sandbox();
    withSpecies(engine, cat);
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    const hunter = spawnOf(engine, cat.id, { x: 20, y: 20, bodyMass: 180, adultMass: 180 });
    spawnOf(engine, 'herbivore.grazer', { x: 21, y: 20, bodyMass: 30, adultMass: 30 });
    const big = spawnOf(engine, 'herbivore.grazer', { x: 23, y: 20, bodyMass: 60, adultMass: 60 });
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
      ...getSpecies('herbivore.grazer'),
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
