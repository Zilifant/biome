/**
 * Heterospecific association (PLAN-SPECIES.md §3.16, phase 12) — standing with
 * animals that are not your own kind.
 *
 * The mechanism is small; what needs pinning is the **line it must not cross**.
 * Association moves a herd's centre of mass and carries an alarm, and it is not
 * allowed to touch a single thing that counts bodies — not the herd label, not
 * `groupmates`, not `adults`, and therefore not the mob. A version that quietly
 * merged the counts would look right in a demo and be wrong everywhere it
 * mattered: two species sharing one label makes every per-species herd metric
 * meaningless, and a mob is a number of animals *of the species being hunted*.
 *
 * So the suite is organized around four claims:
 *
 *   1. **A species that declares nothing is exactly unaffected**, and the world
 *      switch restores that for one that does (D16/D30) — asserted against the
 *      demo, byte for byte.
 *   2. **What association does**: a weighted centre of mass, a weaker pull, and
 *      an associate's warning carrying across the species boundary.
 *   3. **What it deliberately does not do**: labels, counts, mobs, and the
 *      *other* species (association is directional — declaring it is not
 *      agreeing to it).
 *   4. **The animal acts on it.** §1.2's standing complaint is mechanisms that
 *      are correct and never do visible work, so the last block runs the decision
 *      system and asserts a follower actually herds toward company it is not
 *      related to.
 *
 * ⚠⚠ **A fifth claim arrived with BEHAVIOR-PLAN P3 (2026-08-05), and it is about
 * the line *between* two numbers rather than the line the four above defend.**
 * `associationPull` says how hard an animal holds to company of another kind, which
 * A61 recorded as inexpressible: the weight is an exchange rate between bodies and
 * cancels out of the mean when only the other kind is standing there. Three things
 * need pinning, and each has a mutation behind it:
 *
 *   - **The pull is not the weight.** They are the same shape over the same species
 *     ids in the same loop, so `HOLDER` declares 0.5 and 0.4 — an engine that read
 *     one where it should read the other is invisible against a species declaring
 *     the same number twice. Same hazard `MIXER` exists for in `herding.test.js`.
 *   - **It is spent on the distance, never on the utility.** Scaling `herdWeight`
 *     is inert for a bold animal and fires for a timid one (A61's measurement), so
 *     the assertions are about *at what drift* an animal bothers, not how much.
 *   - **Both readers of that distance move together.** The `herd` utility and
 *     `#intentFor`'s cohesion term read the same number; the second is pinned
 *     through the resulting heading, because a split there fails nothing else.
 *
 * ⚠ Mutation-tested 2026-08-05: ten deliberate breakages, every one caught.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { DEFAULT_MOBBING, mobWardFor } from '../src/simulation/predation/mobbing.js';
import {
  CONSPECIFIC_PULL,
  DEFAULT_ASSOCIATION,
  associationOf,
  associationPullFor,
  associationPullOf,
  associationPullsIn,
  associationWeightFor,
  associationsIn,
} from '../src/simulation/social/association.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;

/** The big grazer that gets followed. It has no opinion about any of this. */
const GIANT = Object.freeze({
  id: 'test.giant',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 200,
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

/** A third grazer nobody has declared anything about. */
const STRANGER = Object.freeze({ ...GIANT, id: 'test.stranger', bodyMass: 150 });

/** The small grazer that stands with the big one. Half a conspecific's worth. */
const FOLLOWER = Object.freeze({
  ...GIANT,
  id: 'test.follower',
  bodyMass: 30,
  association: Object.freeze({ [GIANT.id]: 0.5 }),
});

/**
 * ⚠ The same follower, saying **how hard** it holds on as well as how much of a
 * body a giant is worth (P3). It is the only difference from `FOLLOWER`, which makes
 * the pair a one-number A/B; at 0.4 its tolerated drift from a giant's centre is
 * `herdDistance / 0.4` — two and a half times what it tolerates from its own kind.
 *
 * ⚠⚠ **0.4 rather than 0.5, and that is the `MIXER` lesson from P2 applied in
 * advance.** The association weight beside it is 0.5. Declaring the same number for
 * both would make an engine that read the *weight* where it should read the pull
 * indistinguishable from a correct one — the two live in the same loop over the
 * same species ids, so only a species declaring two different values can catch the
 * collision.
 */
const HOLDER = Object.freeze({
  ...FOLLOWER,
  id: 'test.holder',
  associationPull: Object.freeze({ [GIANT.id]: 0.4 }),
});

/** The same animal, mobbing, so "an associate is not a mobber" can be asserted. */
const MOBBING_FOLLOWER = Object.freeze({
  ...FOLLOWER,
  id: 'test.mobber',
  behavior: Object.freeze({ mobWeight: 2.4 }),
});

/** Hunts the giant and *only* the giant, so a follower can never see a threat itself. */
const HUNTER = Object.freeze({
  id: 'test.hunter',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze([GIANT.id, MOBBING_FOLLOWER.id]),
  bodyMass: 60,
  baseSpeed: 1.4,
  maxEnergy: 120,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 6 }),
  comfortMin: 0,
  comfortMax: 30,
  matePreference: Object.freeze({ trait: 'speed', span: 0.3, conditionWeight: 0.5 }),
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});

const SPECIES = [GIANT, STRANGER, FOLLOWER, HOLDER, MOBBING_FOLLOWER, HUNTER];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/** Teach one engine about the invented species (the roster is a static import, A50). */
function withSpecies(engine) {
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return registry;
}

/**
 * Flat ground and no grass: the only things in play are who is standing where and
 * what they are willing to stand next to. Herding is the weakest utility there
 * is, so a field with food in it would (rightly) outrank it.
 */
function sandbox({ seed = 5, config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { ...FLAT_TERRAIN },
      vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 },
      ...config,
    },
  });
  withSpecies(engine);
  return engine;
}

/** Perception + sociality: the minimum the summary needs. */
function socialSandbox({ seed = 5, config = {}, association = {} } = {}) {
  const engine = sandbox({ seed, config });
  engine.registerSystem(new PerceptionSystem(CONFIG.perception));
  engine.registerSystem(
    new SocialSystem({
      ...CONFIG.social,
      associationEnabled: association.enabled ?? CONFIG.association.enabled,
      associationSharesAlarm: association.sharesAlarm ?? CONFIG.association.sharesAlarm,
      associationScalesPull: association.scalesPull ?? CONFIG.association.scalesPull,
    }),
  );
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

describe('association: what a species declares', () => {
  const resolved = (id) => new SpeciesRegistry(SPECIES, CONFIG).require(id);

  test('a species with no association has none, and an empty one is the same as none', () => {
    assert.equal(associationOf(resolved(GIANT.id)), null);
    assert.equal(associationOf(undefined), null);
    assert.equal(associationOf({ association: {} }), null, 'an empty map is null, so callers have one test');
    assert.equal(associationOf({ association: { 'test.x': 0 } }), null, 'and so is a weight of zero');
    assert.deepEqual(associationOf(resolved(FOLLOWER.id)), { [GIANT.id]: 0.5 });
  });

  test('an unnamed species is worth exactly nothing, not a neutral 1', () => {
    // ⚠ The opposite convention to `habitat`, where an unnamed terrain is neutral
    // (1). There, the weights modulate ground the animal is walking on anyway;
    // here they decide whether another animal exists for this purpose at all, and
    // the default has to be "no".
    const weights = associationOf(resolved(FOLLOWER.id));
    assert.equal(associationWeightFor(weights, GIANT.id), 0.5);
    assert.equal(associationWeightFor(weights, STRANGER.id), 0);
    assert.equal(associationWeightFor(null, GIANT.id), 0);
  });

  test('the declaring-species map holds only the species that declare', () => {
    const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], CONFIG);
    const declaring = associationsIn(registry);
    assert.deepEqual(
      [...declaring.keys()].sort(),
      [MOBBING_FOLLOWER.id, FOLLOWER.id, HOLDER.id, 'herbivore.gazelle', 'herbivore.wildebeest'].sort(),
      'the invented followers, and the shipped species that declare one',
    );
    // ⚠ The claim the early-out rests on, and two phases have narrowed it: the map
    // is *small*, not empty. It held nothing at all until the gazelle declared an
    // association (phase 13) and the wildebeest joined it at P3; what still matters
    // is that every species not in it takes the untouched branch, which is six of
    // the eight shipped.
    const shipped = associationsIn(new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG));
    assert.deepEqual([...shipped.keys()].sort(), ['herbivore.gazelle', 'herbivore.wildebeest']);
  });
});

describe('association: the herd centre', () => {
  test('an associate moves the centre of mass, at its declared weight', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, GIANT.id, { x: 34, y: 30 });
    spawn(engine, GIANT.id, { x: 34, y: 34 });
    engine.step(1);

    const summary = summaryOf(engine, follower);
    assert.equal(summary.associates, 2);
    assert.equal(summary.groupmates, 0, 'and not one of them is a groupmate');
    // ⚠ Their midpoint, *not* somewhere half way between the follower and them:
    // the weight is an exchange rate between bodies, so with only one species
    // present it cancels out of the mean entirely. What it decides is whose
    // centre wins in mixed company (below).
    assert.equal(summary.centroid.x, 34);
    assert.equal(summary.centroid.y, 32);
  });

  test('a mixed group weights the two kinds against each other', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, FOLLOWER.id, { x: 32, y: 30 });
    spawn(engine, GIANT.id, { x: 34, y: 30 });
    engine.step(1);

    const summary = summaryOf(engine, follower);
    assert.equal(summary.groupmates, 1);
    assert.equal(summary.associates, 1);
    // (1×32 + 0.5×34) / 1.5 — nearer its own kind than to the giant, which is the
    // whole meaning of a weight below 1 and the only place it has any effect.
    assert.ok(Math.abs(summary.centroid.x - (32 + 2 / 3)) < 1e-9, `centroid ${summary.centroid.x}`);
  });

  test('a species that declares nothing sees nothing, standing in the same crowd', () => {
    // ⚠ Association is **directional**. The giant is surrounded by followers and
    // is alone, because it never said otherwise — which is what the association
    // actually looks like in the field, and is one declaration rather than two.
    const engine = socialSandbox();
    const giant = spawn(engine, GIANT.id, { x: 30, y: 30 });
    spawn(engine, FOLLOWER.id, { x: 31, y: 30 });
    spawn(engine, FOLLOWER.id, { x: 30, y: 31 });
    engine.step(1);

    const summary = summaryOf(engine, giant);
    assert.equal(summary.associates, 0);
    assert.equal(summary.groupmates, 0);
    assert.equal(summary.centroid, null, 'nothing to steer at');
  });

  test('a species it did not name is still nobody', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, STRANGER.id, { x: 31, y: 30 });
    engine.step(1);
    assert.equal(summaryOf(engine, follower).associates, 0);
    assert.equal(summaryOf(engine, follower).centroid, null);
  });
});

describe('association: an attraction, never a membership', () => {
  test('a herd label never crosses the species boundary', () => {
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    const giants = [
      spawn(engine, GIANT.id, { x: 31, y: 30 }),
      spawn(engine, GIANT.id, { x: 30, y: 31 }),
      spawn(engine, GIANT.id, { x: 31, y: 31 }),
    ];
    engine.step(3);

    assert.equal(follower.groupId, null, 'standing in a herd it can never be a member of');
    const label = giants[0].groupId;
    assert.notEqual(label, null, 'while the giants have a herd of their own');
    for (const giant of giants) assert.equal(giant.groupId, label);
  });

  test('two followers keep their own label in the middle of somebody else’s herd', () => {
    const engine = socialSandbox();
    const followers = [
      spawn(engine, FOLLOWER.id, { x: 30, y: 30 }),
      spawn(engine, FOLLOWER.id, { x: 30.5, y: 30 }),
      spawn(engine, FOLLOWER.id, { x: 31, y: 30 }),
    ];
    const giants = [
      spawn(engine, GIANT.id, { x: 30, y: 31 }),
      spawn(engine, GIANT.id, { x: 30.5, y: 31 }),
      spawn(engine, GIANT.id, { x: 31, y: 31 }),
    ];
    engine.step(3);

    const theirs = followers[0].groupId;
    assert.notEqual(theirs, null);
    for (const follower of followers) assert.equal(follower.groupId, theirs);
    for (const giant of giants) assert.notEqual(giant.groupId, theirs, 'one crowd, two herds');
  });

  test('⚠ an associate is not a mobber, however many of them are standing there', () => {
    // The failure this guards against is silent and expensive: `mobbing.minMobbers`
    // reads `adults` off this summary, so counting associates there would let a
    // herd of the wrong species convince an animal to turn and face a predator
    // that none of them will help with.
    const engine = socialSandbox();
    const mobber = spawn(engine, MOBBING_FOLLOWER.id, { x: 30, y: 30 });
    const hunter = spawn(engine, HUNTER.id, { x: 31.5, y: 30 });
    spawn(engine, GIANT.id, { x: 30.5, y: 30 });
    spawn(engine, GIANT.id, { x: 29.5, y: 30 });
    spawn(engine, GIANT.id, { x: 30, y: 29.5 });
    engine.step(1);

    const summary = summaryOf(engine, mobber);
    assert.equal(summary.associates, 3, 'three big animals right beside it');
    assert.equal(summary.adults, 0, 'and no adults of its own kind at all');
    hunter.huntTargetId = mobber.id;
    const behavior = engine.species.require(MOBBING_FOLLOWER.id).behavior;
    const threat = { id: hunter.id, distance: 1.5 };
    assert.equal(
      mobWardFor(engine.world, mobber, threat, behavior, DEFAULT_MOBBING, summary),
      null,
      'so there is no mob to be part of',
    );
  });
});

describe('association: shared vigilance', () => {
  /**
   * A hunter the follower is not on the menu for, close enough for a giant to see
   * and too far for the follower — so any alarm the follower ends up carrying can
   * only have come across the species boundary.
   */
  function sighting(association = {}) {
    const engine = socialSandbox({ association });
    const hunter = spawn(engine, HUNTER.id, { x: 20, y: 30 });
    const giant = spawn(engine, GIANT.id, { x: 25, y: 30 });
    const follower = spawn(engine, FOLLOWER.id, { x: 29, y: 30 });
    const stranger = spawn(engine, STRANGER.id, { x: 29, y: 31 });
    engine.step(2);
    return { engine, hunter, giant, follower, stranger };
  }

  test('an associate’s warning carries; a stranger’s does not', () => {
    const { engine, giant, follower, stranger } = sighting();
    assert.notEqual(engine.world.perception.get(giant.id).nearestThreat, null, 'the giant sees it');
    assert.equal(engine.world.perception.get(follower.id).nearestThreat, null, 'the follower cannot');
    assert.notEqual(follower.alarmedUntil, null, 'and is running anyway');
    assert.equal(follower.alarmSource.hops, 1, 'one hop, from the animal that actually saw it');
    assert.equal(stranger.alarmedUntil, null, 'while the species that declared nothing grazes on');
  });

  test('the vigilance half has its own switch, and it leaves the attraction alone', () => {
    // ⚠ The lever phase 11 wished it had: two mechanisms that arrive together
    // confound each other, so the cells are separable before anyone needs them to
    // be (§10.2's 2×2).
    const { engine, follower } = sighting({ sharesAlarm: false });
    assert.equal(follower.alarmedUntil, null, 'no warning crosses');
    assert.equal(summaryOf(engine, follower).associates, 1, 'and it is still standing with the giant');
  });

  test('the whole mechanism off is the same world as declaring nothing', () => {
    const { engine, follower } = sighting({ enabled: false });
    const summary = summaryOf(engine, follower);
    assert.equal(follower.alarmedUntil, null);
    assert.equal(summary.associates, 0);
    assert.equal(summary.centroid, null);
  });
});

describe('association: the animal acts on it', () => {
  function decisionSandbox(options = {}) {
    const engine = socialSandbox(options);
    engine.registerSystem(
      new DecisionSystem({
        ...engine.config.decision,
        ...engine.config.behavior,
        foodMinLevel: engine.config.perception.foodMinLevel,
      }),
    );
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    return engine;
  }

  test('a straggler closes on company of another species', () => {
    // The whole claim of §3.16 in one measurement: a gazelle can be pulled toward
    // a wildebeest herd. Run against the identical world with the mechanism off,
    // because a single animal in an empty field wanders and the null result is a
    // random walk rather than a stationary one.
    const distanceAfter = (association) => {
      const engine = decisionSandbox({ association });
      const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
      const giants = [];
      for (let i = 0; i < 4; i += 1) giants.push(spawn(engine, GIANT.id, { x: 34 + (i % 2), y: 30 + i * 0.5 }));
      engine.step(200);
      const cx = giants.reduce((sum, g) => sum + g.x, 0) / giants.length;
      const cy = giants.reduce((sum, g) => sum + g.y, 0) / giants.length;
      return Math.hypot(follower.x - cx, follower.y - cy);
    };
    const together = distanceAfter({});
    const apart = distanceAfter({ enabled: false });
    assert.ok(together < apart, `stayed with them (${together.toFixed(1)} vs ${apart.toFixed(1)} without)`);
  });

  test('⚠ company of another species pulls exactly as hard, at the same distance', () => {
    // Not an oversight — the finding that shaped the mechanism. The first cut
    // scaled this pull by the weight *as well*, which charges the animal twice for
    // one fact (the §3.3 error) and, measured, left every weight below ~0.58
    // unable to beat `wanderBias` at all: a 0.5 follower held station no better
    // than one with association switched off. The weight lives in the centroid and
    // nowhere else, and this test is what says so.
    //
    // ⚠ **It is also P3's pull-1 arm and must stay exactly as it is.** `FOLLOWER`
    // declares a weight and no `associationPull`, which is the shipped wildebeest's
    // shape; the block below is the same measurement for `HOLDER`, which declares
    // both. If this ever starts failing, the pull has leaked back onto the weight.
    const pull = (companyId) => {
      const engine = decisionSandbox();
      const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
      spawn(engine, companyId, { x: 34, y: 30 });
      spawn(engine, companyId, { x: 34, y: 30.5 });
      engine.step(1);
      return follower.utilityBreakdown.herd;
    };
    const own = pull(FOLLOWER.id);
    const other = pull(GIANT.id);
    assert.ok(own > 0, `its own kind pulls (${own})`);
    assert.equal(other, own, 'and so does a herd it is merely standing with');
  });
});

describe('association: how hard it holds on (P3, closing A61)', () => {
  const resolved = (id) => new SpeciesRegistry(SPECIES, CONFIG).require(id);

  test('a pull is a second declaration, and parity is not a declaration at all', () => {
    assert.deepEqual(associationPullOf(resolved(HOLDER.id)), { [GIANT.id]: 0.4 });
    assert.equal(associationPullOf(resolved(FOLLOWER.id)), null, 'a weight without a pull is no pull');
    assert.equal(associationPullOf(undefined), null);
    assert.equal(associationPullOf({ associationPull: {} }), null);
    // Parity *is* the unweighted behaviour, so it buys nobody a map entry
    // (`bandAffinityOf`'s precedent, and what the one-comparison early-out rests on).
    assert.equal(associationPullOf({ associationPull: { 'test.x': 1 } }), null);
    // ⚠ Zero is refused here where `otherBandWeight` accepts it: it divides into an
    // infinite tolerated distance, and "never close up on them" is what declining to
    // associate already says. Negative and non-finite reach the same division.
    assert.equal(associationPullOf({ associationPull: { 'test.x': 0 } }), null);
    assert.equal(associationPullOf({ associationPull: { 'test.x': -0.5 } }), null);
    assert.equal(associationPullOf({ associationPull: { 'test.x': Infinity } }), null);
    assert.equal(associationPullOf({ associationPull: { 'test.x': NaN } }), null);
    assert.equal(associationPullOf({ associationPull: { 'test.x': 'hard' } }), null);
    // One usable entry is a declaration even beside nonsense — the map is read per
    // partner, so the good half must survive.
    assert.deepEqual(associationPullOf({ associationPull: { a: 0, b: 0.4 } }), { a: 0, b: 0.4 });
  });

  test('⚠ an unnamed partner pulls like your own kind, the opposite of the weight', () => {
    // The two conventions face opposite ways and both are right. A species not named
    // in `association` is not somebody this animal stands with at all, so its weight
    // is 0; a species not named in `associationPull` is one it has already agreed to
    // stand with, so "nothing further to say" means "as hard as my own kind" — which
    // is exactly the pre-P3 behaviour.
    const pulls = associationPullOf(resolved(HOLDER.id));
    assert.equal(associationPullFor(pulls, GIANT.id), 0.4);
    assert.equal(associationWeightFor(associationOf(resolved(HOLDER.id)), GIANT.id), 0.5, 'and it is not the weight');
    assert.equal(associationPullFor(pulls, STRANGER.id), CONSPECIFIC_PULL);
    assert.equal(associationPullFor(null, GIANT.id), CONSPECIFIC_PULL);
    assert.equal(associationWeightFor(associationOf(resolved(HOLDER.id)), STRANGER.id), 0, 'while the weight says no');
    // A nonsense entry falls back to parity rather than to zero: a typo must not
    // silently detach an animal from company it declared it wanted.
    assert.equal(associationPullFor({ [GIANT.id]: -1 }, GIANT.id), CONSPECIFIC_PULL);
  });

  test('the world map holds only the species that declare one', () => {
    const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], CONFIG);
    const pulls = associationPullsIn(registry);
    assert.deepEqual([...pulls.keys()].sort(), [HOLDER.id, 'herbivore.gazelle'].sort());
    assert.equal(pulls.has(FOLLOWER.id), false, 'a weight is not a pull');
    assert.equal(associationPullsIn(undefined).size, 0, 'and no registry is an empty map rather than a throw');
  });
});

describe('association: pullScale, the number the pull is published as (P3)', () => {
  test('a herd of its own kind is exactly the unit', () => {
    const engine = socialSandbox();
    const holder = spawn(engine, HOLDER.id, { x: 30, y: 30 });
    spawn(engine, HOLDER.id, { x: 32, y: 30 });
    spawn(engine, HOLDER.id, { x: 30, y: 32 });
    engine.step(1);
    // Strict equality on purpose: `1.0` and not `0.999…` is what makes the herd
    // distance of a species standing with its own kind bit-for-bit what it was.
    assert.equal(summaryOf(engine, holder).pullScale, 1);
  });

  test('⚠⚠ an animal standing alone is 1, and the reason is not tidiness', () => {
    // `pullSum / weight` is `0 / 0` for an animal with nobody in range. NaN then
    // propagates into `utilities.herd`, `argmaxUtility` compares with `>`, and
    // `NaN > x` is false — so `herd` would be silently never chosen again, nothing
    // would throw, and the inspector would show `null`. This is that guard.
    const engine = socialSandbox();
    const alone = spawn(engine, HOLDER.id, { x: 30, y: 30 });
    engine.step(1);
    const summary = summaryOf(engine, alone);
    assert.equal(summary.centroid, null, 'genuinely alone');
    assert.equal(Number.isNaN(summary.pullScale), false, 'not NaN');
    assert.equal(summary.pullScale, 1);
  });

  test('company of another species scales it to exactly what the species declared', () => {
    const engine = socialSandbox();
    const holder = spawn(engine, HOLDER.id, { x: 30, y: 30 });
    spawn(engine, GIANT.id, { x: 33, y: 30 });
    spawn(engine, GIANT.id, { x: 33, y: 32 });
    engine.step(1);
    // Two giants, nothing else: the weight cancels out of the mean (that is A61)
    // and what is left is the pull itself — 0.4, and pointedly not the 0.5 weight
    // sitting beside it in the same species file.
    assert.equal(summaryOf(engine, holder).pullScale, 0.4);
  });

  test('mixed company is the contribution-weighted mean, not the mean of the species', () => {
    // ⚠ The claim that keeps `pullScale` honest: it is weighted by the same
    // contributions that built the centre, so one giant among gazelle barely moves
    // it. One conspecific at worth 1 pulling at 1, one giant at worth 0.5 pulling at
    // 0.4 ⇒ (1 + 0.2) / 1.5.
    const engine = socialSandbox();
    const holder = spawn(engine, HOLDER.id, { x: 30, y: 30 });
    spawn(engine, HOLDER.id, { x: 32, y: 30 });
    spawn(engine, GIANT.id, { x: 33, y: 30 });
    engine.step(1);
    const summary = summaryOf(engine, holder);
    assert.equal(summary.groupmates, 1);
    assert.equal(summary.associates, 1);
    const expected = (1 * 1 + 0.5 * 0.4) / (1 + 0.5);
    assert.ok(Math.abs(summary.pullScale - expected) < 1e-12, `pullScale ${summary.pullScale} vs ${expected}`);
  });

  test('a species that declares a weight and no pull is exactly 1, in any company', () => {
    // The shipped wildebeest's shape, and P3's in-world control arm.
    const engine = socialSandbox();
    const follower = spawn(engine, FOLLOWER.id, { x: 30, y: 30 });
    spawn(engine, GIANT.id, { x: 33, y: 30 });
    spawn(engine, GIANT.id, { x: 33, y: 32 });
    engine.step(1);
    const summary = summaryOf(engine, follower);
    assert.equal(summary.associates, 2, 'it really is standing in mixed company');
    assert.equal(summary.pullScale, 1);
  });

  test('the world switch turns it off, and a species cannot turn it back on', () => {
    const engine = socialSandbox({ association: { scalesPull: false } });
    const holder = spawn(engine, HOLDER.id, { x: 30, y: 30 });
    spawn(engine, GIANT.id, { x: 33, y: 30 });
    engine.step(1);
    const summary = summaryOf(engine, holder);
    assert.equal(summary.associates, 1, 'the attraction half is untouched');
    assert.equal(summary.pullScale, 1, 'and the pull half is gone');
  });
});

describe('association: the pull is spent on the distance (P3)', () => {
  function decisionSandbox(options = {}) {
    const engine = socialSandbox(options);
    engine.registerSystem(
      new DecisionSystem({
        ...engine.config.decision,
        ...engine.config.behavior,
        foodMinLevel: engine.config.perception.foodMinLevel,
      }),
    );
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    return engine;
  }

  /** One animal of `speciesId` at a measured drift from a herd of giants. */
  function atDrift(speciesId, drift, options = {}) {
    const engine = decisionSandbox(options);
    const focus = spawn(engine, speciesId, { x: 30, y: 30 });
    // ⚠ Both on the same point, due east: the centroid is then that point whatever
    // the weights are, and every giant's *distance* is exactly `drift` — which
    // matters at 6, where a half-cell of spread would put them outside the herd
    // radius and quietly turn the test into an assertion about nothing.
    spawn(engine, GIANT.id, { x: 30 + drift, y: 30 });
    spawn(engine, GIANT.id, { x: 30 + drift, y: 30 });
    engine.step(1);
    return { engine, focus, summary: summaryOf(engine, focus) };
  }

  test('⚠⚠ a declared pull moves the distance at which an animal bothers', () => {
    // The whole of P3 in one comparison. `herdDistance` is 2 for both species and
    // the centroid is identical — the only difference is that `HOLDER` tolerates
    // `2 / 0.4 = 5` units of drift from a giant's centre and `FOLLOWER` tolerates 2.
    // At a drift of 3 that is the difference between herding and not.
    const loose = atDrift(HOLDER.id, 3);
    const tight = atDrift(FOLLOWER.id, 3);
    assert.ok(Math.abs(tight.summary.centroid.x - 33) < 1e-9, 'the same centre for both');
    assert.ok(Math.abs(loose.summary.centroid.x - 33) < 1e-9);
    assert.ok(tight.focus.utilityBreakdown.herd > 0, 'the tight one closes up');
    assert.equal(loose.focus.utilityBreakdown.herd, 0, 'and the loose one is content where it is');
  });

  test('and past its own wider distance it wants the herd again', () => {
    // Monotone, not a ceiling: a loose attachment is still an attachment. Six units
    // is past `HOLDER`'s tolerated five, so the pull is back — which is what makes
    // this a distance rather than an off switch.
    const { focus } = atDrift(HOLDER.id, 6);
    assert.ok(focus.utilityBreakdown.herd > 0, `herd ${focus.utilityBreakdown.herd}`);
  });

  test('⚠ it does nothing at all to how hard it holds to its own kind', () => {
    // "Half attached to them, **fully** attached to my own" — the half of A61 that
    // would be lost if the pull were read from the species rather than from the
    // company actually standing there.
    const engine = decisionSandbox();
    const holder = spawn(engine, HOLDER.id, { x: 30, y: 30 });
    spawn(engine, HOLDER.id, { x: 33, y: 29.5 });
    spawn(engine, HOLDER.id, { x: 33, y: 30.5 });

    const control = decisionSandbox();
    const follower = spawn(control, FOLLOWER.id, { x: 30, y: 30 });
    spawn(control, FOLLOWER.id, { x: 33, y: 29.5 });
    spawn(control, FOLLOWER.id, { x: 33, y: 30.5 });

    engine.step(1);
    control.step(1);
    assert.ok(follower.utilityBreakdown.herd > 0, 'both are three units off their own herd');
    assert.equal(holder.utilityBreakdown.herd, follower.utilityBreakdown.herd, 'and both close up identically');
  });

  test('⚠⚠ the intent steers by the same distance the decision used', () => {
    // D11, and it would never fail a behavioural test: `#intentFor`'s cohesion term
    // is the *second* reader of the herd distance, so leaving it on
    // `behavior.herdDistance` gives an animal that decides to close up at one
    // distance and steers by another — subtly wrong herding, no error anywhere.
    //
    // The signature is the blend. Cohesion is `(drift − d) / d`, so at a drift of 6
    // the widened `d = 5` gives 0.2 (mostly falling in with the herd's heading) and
    // the unwidened `d = 2` gives a clamped 1 (straight at the centre). The giants
    // are heading due north and the centre is due east, so the two answers are far
    // apart. `herdWeight` is lifted world-wide so `herd` actually wins in both arms;
    // it is the same lift on both sides.
    const heading = (association) => {
      const engine = decisionSandbox({
        association,
        config: { behavior: { ...CONFIG.behavior, herdWeight: 3 } },
      });
      const focus = spawn(engine, HOLDER.id, { x: 30, y: 30 });
      spawn(engine, GIANT.id, { x: 36, y: 30, heading: Math.PI / 2 });
      spawn(engine, GIANT.id, { x: 36, y: 30, heading: Math.PI / 2 });
      engine.step(1);
      assert.equal(focus.action, 'herd', 'the arm is only meaningful if it is herding');
      return focus.moveIntent.heading;
    };
    const widened = heading({});
    const unwidened = heading({ scalesPull: false });
    assert.ok(Math.abs(unwidened) < 1e-9, `steers straight at the centre when tight (${unwidened})`);
    const cohesion = (6 - 5) / 5;
    const expected = Math.atan2(1 - cohesion, cohesion);
    assert.ok(
      Math.abs(widened - expected) < 1e-9,
      `steers by the widened distance (${widened} vs ${expected}) — the cohesion term read the wrong number`,
    );
  });

  test('a loosely-held follower settles further out, and keeps up anyway', () => {
    // The behavioural claim, measured as an equilibrium rather than a snapshot: the
    // pull engages past a distance, so a held animal oscillates in a band around the
    // company rather than converging on it (the §1.4 D1 lesson). Mean distance over
    // the second half of the run, one animal, one switch, everything else identical.
    const settledDistance = (association) => {
      const engine = decisionSandbox({ association });
      const focus = spawn(engine, HOLDER.id, { x: 30, y: 30 });
      const company = [];
      for (let i = 0; i < 4; i += 1) company.push(spawn(engine, GIANT.id, { x: 34 + (i % 2), y: 30 + i * 0.5 }));
      let sum = 0;
      let samples = 0;
      for (let tick = 0; tick < 400; tick += 1) {
        engine.step(1);
        if (tick < 200) continue;
        const cx = company.reduce((a, g) => a + g.x, 0) / company.length;
        const cy = company.reduce((a, g) => a + g.y, 0) / company.length;
        sum += Math.hypot(focus.x - cx, focus.y - cy);
        samples += 1;
      }
      assert.equal(focus.alive, true, 'the follower survived the run');
      return sum / samples;
    };
    const loose = settledDistance({});
    const tight = settledDistance({ scalesPull: false });
    assert.ok(loose > tight, `settles further out (${loose.toFixed(2)} vs ${tight.toFixed(2)} unscaled)`);
    // ⚠ And it is still a follower: a pull below 1 is a longer leash, not a cut one.
    // Without the association at all it wanders off entirely.
    const adrift = (() => {
      const engine = decisionSandbox({ association: { enabled: false } });
      const focus = spawn(engine, HOLDER.id, { x: 30, y: 30 });
      const company = [];
      for (let i = 0; i < 4; i += 1) company.push(spawn(engine, GIANT.id, { x: 34 + (i % 2), y: 30 + i * 0.5 }));
      engine.step(400);
      const cx = company.reduce((a, g) => a + g.x, 0) / company.length;
      const cy = company.reduce((a, g) => a + g.y, 0) / company.length;
      return Math.hypot(focus.x - cx, focus.y - cy);
    })();
    assert.ok(loose < adrift, `still with them (${loose.toFixed(2)} against ${adrift.toFixed(2)} unattached)`);
  });
});

describe('association: in the shipped world', () => {
  // ⚠ **This block used to assert the demo byte-identical with the mechanism off,
  // and batch 3 took that reading away** — exactly as phase 12 said it would:
  // "takeable now and not later; the moment batch 3 gives the gazelle an
  // association the two arms diverge by design." They do. What replaces it is the
  // narrower claim that still means something.
  const BATCH2 = [
    { speciesId: 'herbivore.gazelle', count: 120 },
    { speciesId: 'herbivore.buffalo', count: 35 },
    { speciesId: 'predator.leopard', count: 8 },
    { speciesId: 'predator.lion', count: 8 },
    { speciesId: 'scavenger.vulture', count: 10 },
    { speciesId: 'scavenger.hyena', count: 6 },
  ];

  test('two species declare an association, and only over species that exist', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const declaring = engine.species.all().filter((species) => associationOf(species) !== null);
    assert.deepEqual(
      declaring.map((s) => s.id).sort(),
      ['herbivore.gazelle', 'herbivore.wildebeest'],
      'the small grazer follows the big ones and the middle tier follows the coarse feeder, both directionally',
    );
    // A weight naming a species that does not exist is dead data that reads as
    // biology — the same failure a `preySpeciesIds` typo would be.
    const known = new Set(engine.species.ids());
    for (const species of declaring) {
      for (const partner of Object.keys(associationOf(species))) {
        assert.ok(known.has(partner), `${partner} is not a species in this world`);
        assert.notEqual(partner, species.id, 'and nobody associates with itself');
      }
    }
  });

  test('⚠ a world with no wildebeest and no zebra is byte-identical with it switched off', () => {
    // The property that survives, and the one that would break silently: the
    // gazelle carries an association in every world now, so this is what says it
    // costs nothing where it has no partner — which is what keeps batch 2's
    // numbers comparable across the phase boundary.
    //
    // ⚠ Compared as strings rather than with `deepEqual`. When these two *do*
    // differ, `deepEqual` tries to build a readable diff of two ~650 KB object
    // graphs and exhausts a 4 GB heap before it can report anything (2026-07-30).
    // A string compare fails in one line, which is the difference between a test
    // that tells you what broke and one that kills the runner.
    const on = createDemoSimulation({ seed: 42, config: { demo: { founding: BATCH2 } } });
    const off = createDemoSimulation({
      seed: 42,
      config: { demo: { founding: BATCH2 }, association: { enabled: false, sharesAlarm: false } },
    });
    on.step(400);
    off.step(400);
    assert.equal(
      JSON.stringify(captureSimulationState(on).entities),
      JSON.stringify(captureSimulationState(off).entities),
    );
  });

  test('and in the world that does have them, it is doing something', () => {
    // §1.2's standing complaint is mechanisms that are correct and never fire.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    let associating = 0;
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      if ((engine.world.social.get(entity.id)?.associates ?? 0) > 0) associating += 1;
    }
    assert.ok(associating > 0, 'somebody is standing with another species');
  });

  test('the shipped defaults are the ones the module documents', () => {
    assert.deepEqual({ ...CONFIG.association }, { ...DEFAULT_ASSOCIATION });
  });

  test('the gazelle declares a pull, and only over species it actually stands with', () => {
    // A pull for a species this animal never associates with is dead data that reads
    // as biology: the loop only ever asks for the pull of a body it has already
    // decided to count, so such an entry could never be reached.
    const engine = createDemoSimulation({ seed: 42 });
    const pulls = associationPullsIn(engine.species);
    assert.deepEqual([...pulls.keys()], ['herbivore.gazelle'], 'the small grazer, and only it so far');
    const gazelle = engine.species.require('herbivore.gazelle');
    const weights = associationOf(gazelle);
    for (const [partner, pull] of Object.entries(associationPullOf(gazelle))) {
      assert.ok(weights[partner] > 0, `${partner} is a species the gazelle associates with`);
      assert.ok(pull > 0 && pull < 1, `${partner} is held to more loosely than its own kind (${pull})`);
    }
  });

  test('⚠ the wildebeest declares an association and no pull, which is P3’s control arm', () => {
    // Two species in one world, one on each side of the new field: the mechanism is
    // separable in the shipped roster and not only in the test sandbox.
    const engine = createDemoSimulation({ seed: 42 });
    const wildebeest = engine.species.require('herbivore.wildebeest');
    assert.deepEqual(associationOf(wildebeest), { 'herbivore.zebra': 0.5 });
    assert.equal(associationPullOf(wildebeest), null);
    assert.equal(associationOf(engine.species.require('herbivore.zebra')), null, 'and the zebra says nothing back');
  });

  test('and in the shipped world the pull is doing something', () => {
    // §1.2's standing complaint again: a mechanism that is correct and never fires.
    // Somebody must actually be standing in company it holds loosely.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    let scaled = 0;
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const summary = engine.world.social.get(entity.id);
      if (summary && summary.pullScale !== 1) scaled += 1;
      // ⚠ And nobody anywhere is at NaN — the 0/0 guard, asserted across a whole
      // world rather than only in the sandbox that provoked it.
      assert.equal(Number.isFinite(summary?.pullScale ?? 1), true, `${entity.id} has a non-finite pullScale`);
    }
    assert.ok(scaled > 0, 'somebody is holding loosely to company of another species');
  });

  test('⚠ a world with no wildebeest and no zebra is byte-identical with the pull switched off', () => {
    // The same property the block above pins for the whole mechanism, for the third
    // switch on its own: the gazelle carries a pull in every world now, and where its
    // partners do not exist it must cost exactly nothing. This is what keeps batch
    // 2's numbers comparable across the phase boundary a second time.
    const on = createDemoSimulation({ seed: 42, config: { demo: { founding: BATCH2 } } });
    const off = createDemoSimulation({
      seed: 42,
      config: { demo: { founding: BATCH2 }, association: { ...CONFIG.association, scalesPull: false } },
    });
    on.step(400);
    off.step(400);
    assert.equal(
      JSON.stringify(captureSimulationState(on).entities),
      JSON.stringify(captureSimulationState(off).entities),
    );
  });
});
