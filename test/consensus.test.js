/**
 * Herd movement consensus and leadership (BEHAVIOR-PLAN.md P8).
 *
 * ⚠⚠ **This is the herd label's first behavioural consumer**, and DOCS §9 has said
 * it had none since 2026-07-30 — measured, not assumed (`maxGroupSize` 12 against
 * 24 left all eight species' populations identical to the digit). Everything social
 * that moves an animal before this reads *neighbours*; nothing read `groupId`.
 *
 * The mechanism: the animals of one label pool their migration drifts into a single
 * heading, hold it for `consensus.commitTicks` whatever their own cues do next, and
 * the decision system steers a fresh `wander` by it **in place of** the migration
 * drift. So the claims below, in order:
 *
 *   1. **The arithmetic** — a circular mean, and its denominator counts every free
 *      member rather than only the ones with something to say.
 *   2. **The three-clause re-decision rule**, which is what makes the herd decide
 *      *together* instead of producing a rolling average of whoever expired today.
 *      ⚠ Clause 3 (a joiner adopts what the herd already agreed) has its own block,
 *      because it is the one that is easy to omit and the one that propagates a
 *      front through a herd that is growing.
 *   3. **`atan2(0, 0)`** — a herd whose cues cancelled must get *no* consensus, not
 *      a valid-looking heading due east.
 *   4. **The commitment outlives the cue**, and the strength does not climb.
 *   5. **The guards**: a disperser is left alone, a species that declares nothing
 *      is never touched, and every field is cleared on every path.
 *   6. **Leadership**, which is derived and stored nowhere, and is spent in exactly
 *      one place: the centre of mass a separated band member rallies toward.
 *
 * ⚠⚠ **Mutation-tested 2026-08-06, and one of the seven survived the first pass.**
 * Every one of these deliberate breakages must fail this file: deleting the
 * `RESULTANT_EPSILON` guard (2 fail), dropping clause 3 so a joiner re-decides
 * instead of adopting (1), dropping the `herdCommitLabel` half of the committed test
 * (2), re-charging the species weight onto an adopted standing strength (1),
 * counting only contributors in the denominator (1), deleting the dispersal gate
 * (1), and returning `dominanceOf` from `leadershipOf` (2).
 *
 * ⚠ **The double charge is the one that got through**, and it is the fourth phase
 * running with this exact shape (`MIXER` for P2, `HOLDER` for P3, `worth *=
 * calfWeight` for P4). At `consensusWeight: 1` charging the weight twice is `× 1`
 * and invisible; at 5 both arms saturate against `maxStrength` and it is invisible
 * again. Only a weight that is neither catches it, which is what `HALF` exists for.
 *
 * ⚠ The dispersal one is the P7 trap in P8's clothes: the animal a dispersal gate
 * protects has to be one that *reaches* the gate, which here means one that is
 * dispersing **and** still carries a herd label.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { GroupSystem } from '../src/simulation/systems/GroupSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { HerdConsensusSystem } from '../src/simulation/systems/HerdConsensusSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  captureSimulationState,
  restoreSimulationState,
} from '../src/simulation/persistence/SimulationSerializer.js';
import {
  RESULTANT_EPSILON,
  consensusOf,
  consensusWeightOf,
  consensusWeightsIn,
} from '../src/simulation/social/consensus.js';
import { dominanceOf, leadAgeWeightOf, leadershipOf } from '../src/simulation/social/dominance.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;

/**
 * A plain grazer that says nothing about consensus — the control arm, and the
 * species six of the eight shipped ones are. ⚠ Invented here rather than borrowed
 * from the roster, because the mechanism has to work for a species declared
 * entirely in data or it is not a species mechanism (the `groups.test.js` `CLAN`
 * idiom, and `herding.test.js`'s `PLAIN`).
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
  perception: Object.freeze({ radius: 8 }),
  comfortMin: 2,
  comfortMax: 27,
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/** The same animal, agreeing with its herd at the reference weight. */
const AGREES = Object.freeze({ ...PLAIN, id: 'test.agrees', behavior: Object.freeze({ consensusWeight: 1 }) });

/** ⚠ The same animal declaring the identity — a weight of 0 is *no declaration*. */
const REFUSES = Object.freeze({ ...PLAIN, id: 'test.refuses', behavior: Object.freeze({ consensusWeight: 0 }) });

/** A herd that pulls far harder than its own evidence, so `maxStrength` has to bite. */
const ZEALOT = Object.freeze({ ...PLAIN, id: 'test.zealot', behavior: Object.freeze({ consensusWeight: 5 }) });

/**
 * ⚠ A herd that leans on its neighbours only half as hard as its own nose — and it
 * exists for one assertion, in the way `MIXER` does in `herding.test.js`. At weight
 * 1 a strength that is charged the species weight **twice** is indistinguishable
 * from one charged it once, and at 5 both arms are pinned to `maxStrength`. Only a
 * weight that is neither 1 nor large enough to saturate can catch the double
 * charge, and a joiner adopting a standing consensus is where it would happen.
 */
const HALF = Object.freeze({ ...PLAIN, id: 'test.half', behavior: Object.freeze({ consensusWeight: 0.5 }) });

/**
 * A band-forming animal whose societies follow their elders — the buffalo's shape,
 * for the leadership half. Its record is what `groups.leadWeight` weights.
 */
const MATRIARCH = Object.freeze({
  ...PLAIN,
  id: 'test.matriarch',
  groups: Object.freeze({ forms: true, joinRadius: 6, maxMembers: 8, minMembers: 2 }),
  behavior: Object.freeze({ leadAgeWeight: 0.5 }),
});

/** The same band with no opinion about age — leadership is then plain dominance. */
const PEERS = Object.freeze({ ...MATRIARCH, id: 'test.peers', behavior: Object.freeze({}) });

const SPECIES = [PLAIN, AGREES, REFUSES, ZEALOT, HALF, MATRIARCH, PEERS];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/** Flat ground, no grass, and the invented roster taught to one engine (A50). */
function sandbox({ seed = 7, config = {}, species = SPECIES } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 96, height: 96 },
      terrain: { ...FLAT_TERRAIN },
      vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 },
      ...config,
    },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...species], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return engine;
}

/**
 * Perception + sociality + consensus.
 *
 * ⚠ **`MigrationSystem` is deliberately absent**, and that is what makes every
 * number below exact rather than approximate: the cue this system aggregates is
 * written by hand, so a test states the disagreement it wants instead of arranging
 * a vegetation field that might produce one. `updateInterval: 1` for the same
 * reason — the shipped 5 is a re-decision *cadence*, not part of the arithmetic.
 */
function consensusSandbox({ seed = 7, config = {}, consensus = {}, decision = false } = {}) {
  const engine = sandbox({ seed, config });
  engine.registerSystem(new PerceptionSystem(CONFIG.perception));
  engine.registerSystem(new SocialSystem(CONFIG.social));
  engine.registerSystem(new HerdConsensusSystem({ ...CONFIG.consensus, updateInterval: 1, ...consensus }));
  if (decision) {
    engine.registerSystem(
      new DecisionSystem({ ...CONFIG.decision, ...CONFIG.behavior, foodMinLevel: CONFIG.perception.foodMinLevel }),
    );
  }
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

/**
 * A herd of `cues.length` animals in a line three cells apart, each carrying the
 * migration drift it is given. Three cells keeps every pair inside
 * `social.groupRadius` for the sizes used here, so one label covers the line.
 */
function herd(engine, cues, { speciesId = AGREES.id, x = 40, y = 40, spacing = 3, ...overrides } = {}) {
  return cues.map((cue, i) =>
    spawn(engine, speciesId, {
      x: x + i * spacing,
      y,
      migrationHeading: cue.heading ?? null,
      migrationStrength: cue.strength ?? 0,
      ...overrides,
    }),
  );
}

describe('consensus: what a species declares', () => {
  test('a weight is a positive number, and anything else is no declaration at all', () => {
    assert.equal(consensusWeightOf({ behavior: { consensusWeight: 1.4 } }), 1.4);
    assert.equal(consensusWeightOf(PLAIN), 0, 'saying nothing is zero, and zero means never touched');
    assert.equal(consensusWeightOf(REFUSES), 0, 'and so is declaring the identity out loud');
    assert.equal(consensusWeightOf(undefined), 0);
    assert.equal(consensusWeightOf({ behavior: {} }), 0);
    assert.equal(consensusWeightOf({ behavior: { consensusWeight: -1 } }), 0);
    assert.equal(consensusWeightOf({ behavior: { consensusWeight: Infinity } }), 0);
    assert.equal(consensusWeightOf({ behavior: { consensusWeight: 'lots' } }), 0);
  });

  test('the world map holds only the species that declare one', () => {
    const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], CONFIG);
    const weights = consensusWeightsIn(registry);
    assert.equal(weights.get(AGREES.id), 1);
    assert.equal(weights.get(ZEALOT.id), 5);
    assert.equal(weights.has(PLAIN.id), false, 'a species that says nothing is absent, not present at zero');
    assert.equal(weights.has(REFUSES.id), false);
    assert.equal(consensusWeightsIn(undefined).size, 0, 'and no registry is an empty map rather than a throw');
  });

  test('the shipped roster declares it where the brief asked and nowhere else', () => {
    const engine = createDemoSimulation({ seed: 42 });
    const weights = consensusWeightsIn(engine.species);
    assert.deepEqual(
      [...weights.keys()].sort(),
      ['herbivore.buffalo', 'herbivore.wildebeest'],
      'the two large-aggregation grazers, and only those',
    );
    // ⚠ The wildebeest is the species the mechanism was built for and holds hardest;
    // the buffalo organizes its life around water and must not outvote its own thirst.
    assert.ok(weights.get('herbivore.wildebeest') > weights.get('herbivore.buffalo'));
  });

  test('the system sits between the drift it reads and the decision that consumes it', () => {
    // ⚠ Not decoration: at a priority above `MigrationSystem`'s −5 it would
    // aggregate last tick's drift, and below `DecisionSystem`'s 0 it would publish a
    // heading nothing reads.
    const system = new HerdConsensusSystem(CONFIG.consensus);
    assert.equal(system.phase, 'decision');
    assert.ok(system.priority > -5 && system.priority < 0, `priority ${system.priority}`);
  });
});

describe('consensus: the arithmetic of a shared heading', () => {
  test('a resultant with no length is no heading, not a heading due east', () => {
    // ⚠⚠ `Math.atan2(0, 0)` is 0 — a valid-looking heading pointing due east, which
    // is how a whole wildebeest herd ends up marching into the sunrise. The guard is
    // the only thing between that and this function's callers.
    assert.equal(consensusOf(0, 0, 4), null);
    assert.equal(consensusOf(0, 0, 0), null, 'and an empty label has nothing to resolve');
    assert.equal(consensusOf(1, 1, 0), null);
    // The residue two exactly opposed cues actually leave, which is not zero.
    const residue = Math.sin(0) * 0.5 + Math.sin(Math.PI) * 0.5;
    assert.ok(residue > 0 && residue < RESULTANT_EPSILON, `${residue} is floating-point dust, not a direction`);
    assert.equal(consensusOf(residue, 0, 2), null);
  });

  test('a coherent set gives its own heading back at its own mean strength', () => {
    const both = consensusOf(Math.sin(0) * 0.4 * 2, Math.cos(0) * 0.4 * 2, 2);
    assert.ok(Math.abs(both.heading - 0) < 1e-12);
    assert.ok(Math.abs(both.strength - 0.4) < 1e-12, 'agreement returns the mean strength unscaled');
  });

  test('disagreement costs strength, which is where the decay comes from', () => {
    // Three cues at 0 and one at π, all at 0.4: the resultant is 0.8 over four
    // contributors. No decay term anywhere — reversal *is* disagreement.
    const sumCos = 0.4 * 3 - 0.4;
    const mixed = consensusOf(0, sumCos, 4);
    assert.ok(Math.abs(mixed.strength - 0.2) < 1e-12, `${mixed.strength}`);
    assert.ok(Math.abs(mixed.heading - 0) < 1e-12, 'and the majority still sets the direction');
  });

  test('a herd agrees on one heading, and it is the circular mean of its cues', () => {
    const engine = consensusSandbox();
    const [a, b, c] = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: Math.PI / 2, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ]);
    engine.step(1);
    assert.notEqual(a.groupId, null, 'the line is one herd label');
    assert.equal(a.groupId, c.groupId);
    // sumSin 0.4, sumCos 0.8 ⇒ atan2(0.4, 0.8), and hypot/3 for the strength.
    const heading = Math.atan2(0.4, 0.8);
    const strength = Math.hypot(0.4, 0.8) / 3;
    for (const member of [a, b, c]) {
      assert.ok(Math.abs(member.herdHeading - heading) < 1e-9, `${member.herdHeading} against ${heading}`);
      assert.ok(Math.abs(member.herdStrength - strength) < 1e-9, `${member.herdStrength} against ${strength}`);
    }
    assert.equal(a.herdCommitUntil, engine.tick + CONFIG.consensus.commitTicks);
    assert.equal(a.herdCommitLabel, a.groupId, 'and the commitment records which herd made it');
  });

  test('⚠ an animal with no cue is a vote for staying put, not an abstention', () => {
    // The denominator decision. Two animals pulling at 0.6 and two with nothing to
    // say give 1.2 over **four**, not over two — so a satisfied herd is not marched
    // across the map at full strength by its one hungry member.
    const engine = consensusSandbox();
    const [a] = herd(engine, [
      { heading: 0, strength: 0.6 },
      { heading: 0, strength: 0.6 },
      {},
      {},
    ]);
    engine.step(1);
    assert.ok(Math.abs(a.herdStrength - 0.3) < 1e-9, `${a.herdStrength} — 1.2 over four, not over two`);
  });

  test('the species weight prices it, and `maxStrength` is a ceiling rather than a hope', () => {
    const engine = consensusSandbox();
    const [a] = herd(engine, [{ heading: 0, strength: 0.4 }, { heading: 0, strength: 0.4 }, { heading: 0, strength: 0.4 }]);
    engine.step(1);
    assert.ok(Math.abs(a.herdStrength - 0.4) < 1e-9, 'at weight 1 a coherent herd drifts at its own mean strength');

    const zealous = consensusSandbox();
    const [z] = herd(zealous, [{ heading: 0, strength: 0.4 }, { heading: 0, strength: 0.4 }, { heading: 0, strength: 0.4 }], {
      speciesId: ZEALOT.id,
    });
    zealous.step(1);
    assert.equal(z.herdStrength, CONFIG.consensus.maxStrength, '5 × 0.4 is 2.0, and the cap is what ships');
  });

  test('⚠⚠ a herd whose cues cancel gets no consensus at all', () => {
    // The `atan2(0, 0)` trap, arranged so it is genuinely reachable: **exactly**
    // opposed cues at equal strength, not merely different ones. Without the
    // resultant guard these four commit to `atan2(1.2e-16, 0)` — due *north* — at a
    // strength of 3e-17, which is not a wander that happens to be unbent: it is a
    // live commitment that suppresses the migration drift it replaced for sixty
    // ticks while steering by floating-point dust.
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 0, strength: 0.5 },
      { heading: Math.PI, strength: 0.5 },
      { heading: 0, strength: 0.5 },
      { heading: Math.PI, strength: 0.5 },
    ]);
    engine.step(1);
    assert.notEqual(members[0].groupId, null, 'the label formed — this is disagreement, not solitude');
    for (const member of members) {
      assert.equal(member.herdHeading, null, 'no consensus');
      assert.equal(member.herdStrength, 0);
      assert.equal(member.herdCommitUntil, null, 'and nothing to expire');
    }
  });
});

describe('consensus: the re-decision rule', () => {
  test('the commitment outlives the cue that made it', () => {
    // The claim the phase exists for. The gradient is *deleted* rather than
    // weakened, so nothing but the commitment could be holding the heading.
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 1, strength: 0.4 },
      { heading: 1, strength: 0.4 },
      { heading: 1, strength: 0.4 },
    ]);
    engine.step(1);
    assert.ok(Math.abs(members[0].herdHeading - 1) < 1e-9);
    for (const member of members) {
      member.migrationHeading = null;
      member.migrationStrength = 0;
    }
    engine.step(CONFIG.consensus.commitTicks - 2);
    for (const member of members) {
      assert.ok(Math.abs(member.herdHeading - 1) < 1e-9, 'still marching on a cue that no longer exists');
      assert.ok(Math.abs(member.herdStrength - 0.4) < 1e-9, 'and at the strength it agreed on');
    }
    // ...and then it ends, because there is nothing left to agree about.
    engine.step(2);
    assert.equal(members[0].herdHeading, null);
    assert.equal(members[0].herdCommitLabel, null);
  });

  test('⚠⚠ a member joining mid-commitment adopts what the herd already agreed', () => {
    // Clause 3, and it is the one that is easy to omit: without it a wildebeest
    // walking into a marching herd keeps walking its own way, and a front can never
    // be larger than the group that founded it.
    //
    // ⚠ The arrangement is what makes the clause reachable. The joiner arrives
    // **after** the commitment was formed, and its own cue points somewhere else
    // entirely — so "adopted" and "re-decided" are different answers rather than the
    // same number reached two ways.
    const engine = consensusSandbox();
    const founders = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ]);
    engine.step(3);
    assert.ok(Math.abs(founders[0].herdHeading - 0) < 1e-9);

    const joiner = spawn(engine, AGREES.id, {
      x: 40 + 3 * 3,
      y: 40,
      migrationHeading: Math.PI / 2,
      migrationStrength: 0.4,
    });
    engine.step(2);
    assert.equal(joiner.groupId, founders[0].groupId, 'it is in the herd');
    assert.ok(Math.abs(joiner.herdHeading - 0) < 1e-9, `adopted the herd's heading, not its own (${joiner.herdHeading})`);
    assert.ok(Math.abs(joiner.herdStrength - 0.4) < 1e-9, 'and its strength, copied rather than re-priced');
    assert.ok(joiner.herdCommitUntil > founders[0].herdCommitUntil, 'with a fresh ttl of its own');
    assert.ok(Math.abs(founders[0].herdHeading - 0) < 1e-9, 'and the founders were not disturbed by it');
  });

  test('⚠⚠ an adopted strength is copied, not re-priced — the double charge', () => {
    // ⚠ **This arrangement exists because the plain one cannot see the bug.** The
    // species weight is charged once, where the fresh consensus is computed; an
    // adopting joiner must take the number as it stands. At `consensusWeight: 1` a
    // second charge is `× 1` and invisible, and at 5 both arms saturate against
    // `maxStrength` and are invisible again — so the fixture's number has to be one
    // that is neither. `HALF` is 0.5, which makes the founders' 0.2 into 0.1 if the
    // weight is spent twice. (Mutation-tested: the first version of this block used
    // `AGREES` and the double charge sailed through it.)
    const engine = consensusSandbox();
    const founders = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ], { speciesId: HALF.id });
    engine.step(3);
    assert.ok(Math.abs(founders[0].herdStrength - 0.2) < 1e-9, `0.4 × 0.5 (${founders[0].herdStrength})`);

    const joiner = spawn(engine, HALF.id, {
      x: 40 + 3 * 3,
      y: 40,
      migrationHeading: Math.PI / 2,
      migrationStrength: 0.4,
    });
    engine.step(2);
    assert.equal(joiner.groupId, founders[0].groupId);
    assert.ok(Math.abs(joiner.herdStrength - 0.2) < 1e-9, `copied, not re-priced to 0.1 (${joiner.herdStrength})`);
  });

  test('⚠ a commitment belongs to a herd, so walking into another one re-decides it', () => {
    // The `herdCommitLabel` half of the committed test. An animal carrying a live
    // ttl from a herd it has left must not go on holding that herd's heading —
    // otherwise the label it is actually standing in can never reach it.
    const engine = consensusSandbox();
    const east = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ]);
    const north = herd(engine, [
      { heading: Math.PI / 2, strength: 0.4 },
      { heading: Math.PI / 2, strength: 0.4 },
      { heading: Math.PI / 2, strength: 0.4 },
    ], { x: 70, y: 70 });
    engine.step(1);
    assert.notEqual(east[0].groupId, north[0].groupId, 'two herds, two labels');
    assert.ok(Math.abs(north[0].herdHeading - Math.PI / 2) < 1e-9, 'deciding separately');

    // Move one animal from the northbound herd into the eastbound one, still well
    // inside its old commitment.
    const walker = north[2];
    engine.world.moveEntity(walker, 40 + 3 * 3, 40);
    engine.step(2);
    assert.equal(walker.groupId, east[0].groupId, 'it has joined the other herd');
    assert.ok(Math.abs(walker.herdHeading - 0) < 1e-9, `and took its heading (${walker.herdHeading})`);
  });

  test('the strength does not climb tick over tick in a static world', () => {
    // The positive-feedback check. A herd that fed its own consensus back into its
    // own consensus would ratchet: n animals agreeing perfectly is the best possible
    // input to any formula that sums them. The fresh consensus is computed **only**
    // from migration cues, which this system never writes, so there is no path from
    // `herdStrength` back to `herdStrength`.
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 0.7, strength: 0.4 },
      { heading: 0.7, strength: 0.4 },
      { heading: 0.7, strength: 0.4 },
      { heading: 0.7, strength: 0.4 },
    ]);
    let peak = 0;
    for (let i = 0; i < CONFIG.consensus.commitTicks * 4; i += 1) {
      engine.step(1);
      for (const member of members) peak = Math.max(peak, member.herdStrength);
    }
    assert.ok(Math.abs(peak - 0.4) < 1e-9, `four commitment cycles later it is still 0.4, not ${peak}`);
  });

  test('the consensus decays when the gradient reverses under it', () => {
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ]);
    engine.step(1);
    const agreed = members[0].herdStrength;
    assert.ok(Math.abs(agreed - 0.4) < 1e-9);

    members[3].migrationHeading = Math.PI;
    // ⚠ Past the commitment, or this measures nothing: while it is live the herd is
    // *supposed* to ignore the reversal, which is the previous test's claim.
    engine.step(CONFIG.consensus.commitTicks);
    assert.ok(Math.abs(members[0].herdStrength - 0.2) < 1e-9, `${members[0].herdStrength} — one of four turned round`);
    assert.ok(members[0].herdStrength < agreed, 'the herd holds its direction less hard than it did');
  });
});

describe('consensus: the guards', () => {
  test('⚠⚠ a dispersing animal is left alone — A64 must not be undone at the movement layer', () => {
    // ⚠⚠ **The arrangement is the whole test, and P7 recorded why.** A dispersal
    // gate can only be proved by an animal that actually *reaches* it: here that
    // means one still carrying a herd label while it walks out, which is what a
    // young animal leaving a herd it grew up in looks like for the first hundred
    // ticks. `MigrationSystem` writes its outward heading into `migrationHeading` at
    // `dispersalWeight: 0.9` — so an ungated consensus would both drag the herd's
    // heading toward wherever its young are leaving to *and* replace that animal's
    // dispersal heading with the herd's, walking it straight back in.
    //
    // ⚠ Counted over 100 ticks rather than asserted on one, which is the test shape
    // whose absence caused A64.
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ]);
    const disperser = members[3];
    disperser.dispersalUntil = engine.tick + 200;
    disperser.migrationHeading = Math.PI;
    disperser.migrationStrength = 0.9;

    let committed = 0;
    let labelled = 0;
    for (let i = 0; i < 100; i += 1) {
      engine.step(1);
      if (disperser.herdHeading !== null || disperser.herdCommitUntil !== null) committed += 1;
      if (disperser.groupId !== null) labelled += 1;
    }
    assert.equal(committed, 0, `a disperser never commits (${committed} of 100 ticks)`);
    assert.ok(labelled > 90, `and it kept its label throughout (${labelled} of 100) — the gate was reachable`);
    // ⚠ And its cue never reached the herd either, which is the other half: the
    // three that stayed are still agreed on 0 at their own strength rather than on
    // some average that includes an outward-bound animal pulling due west.
    assert.ok(Math.abs(members[0].herdHeading - 0) < 1e-9, `${members[0].herdHeading}`);
    assert.ok(Math.abs(members[0].herdStrength - 0.4) < 1e-9, `${members[0].herdStrength}`);
  });

  test('a species that declares nothing is never written at all', () => {
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ], { speciesId: PLAIN.id });
    engine.step(5);
    assert.notEqual(members[0].groupId, null, 'it has a herd — it simply has no opinion about where it is going');
    for (const member of members) {
      assert.equal(member.herdHeading, null);
      assert.equal(member.herdStrength, 0);
      assert.equal(member.herdCommitUntil, null);
      assert.equal(member.herdCommitLabel, null);
    }
  });

  test('⚠ every field is cleared when the herd is gone, on every path', () => {
    // A field not rewritten on some path outlives its tick — the `entity.flying`
    // lesson, and P7 clears before it sets for the same reason.
    const engine = consensusSandbox();
    const members = herd(engine, [
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
      { heading: 0, strength: 0.4 },
    ]);
    engine.step(1);
    assert.notEqual(members[0].herdHeading, null, 'it was committed');
    engine.world.moveEntity(members[0], 5, 5);
    engine.step(2);
    assert.equal(members[0].groupId, null, 'alone now');
    assert.equal(members[0].herdHeading, null);
    assert.equal(members[0].herdStrength, 0);
    assert.equal(members[0].herdCommitUntil, null);
    assert.equal(members[0].herdCommitLabel, null);
  });

  test('⚠ the fields default to a heading of null and a strength of zero', () => {
    // The `clamp01(undefined)` landmine: an unwritten strength reaches
    // `blendHeadings`, makes the blend NaN, and parks the animal at NaN forever.
    const engine = sandbox();
    const animal = spawn(engine, PLAIN.id, { x: 10, y: 10 });
    assert.equal(animal.herdHeading, null);
    assert.equal(animal.herdStrength, 0);
    assert.equal(animal.herdCommitUntil, null);
    assert.equal(animal.herdCommitLabel, null);
  });
});

describe('consensus: what the decision system does with it', () => {
  test('⚠ a wander is steered by the herd’s heading in place of the animal’s own', () => {
    // ⚠⚠ **A deterministic single-tick heading claim, and that is a finding rather
    // than a weaker test** (P4, DOCS §9): a steering mechanism measured by where
    // animals end up is measuring the seed. Both arms draw the identical wander
    // candidate — this system draws nothing on any stream — so the only difference
    // between them is which drift the blend was given.
    const steer = (speciesId) => {
      const engine = consensusSandbox({ seed: 4, decision: true });
      // ⚠ Packed one cell apart on purpose: at three the animal on the end is
      // further from its herd's centre than `behavior.herdDistance`, `herd` wins the
      // utility table, and the arm measures a cohesion steer rather than a wander.
      const [focus] = herd(engine, [
        { heading: 0, strength: 0.5 },
        { heading: Math.PI / 2, strength: 0.5 },
        { heading: Math.PI / 2, strength: 0.5 },
        { heading: Math.PI / 2, strength: 0.5 },
      ], { speciesId, spacing: 1 });
      engine.step(1);
      assert.equal(focus.action, 'wander', 'the arm is only meaningful if it is wandering');
      return focus;
    };
    const agreeing = steer(AGREES.id);
    const alone = steer(PLAIN.id);
    // The herd is three-quarters northbound, so the consensus is well north of this
    // animal's own due-east cue, and its wander must have been bent that way.
    assert.ok(agreeing.herdHeading > 1.0, `the consensus points north (${agreeing.herdHeading})`);
    assert.ok(
      agreeing.moveIntent.heading > alone.moveIntent.heading,
      `steered by the herd (${agreeing.moveIntent.heading.toFixed(4)}) rather than by its own nose (${alone.moveIntent.heading.toFixed(4)})`,
    );
  });

  test('⚠ it replaces the migration drift rather than joining the queue behind it', () => {
    // There are three blends onto a fresh wander — drift, rally, trail — and this is
    // not a fourth. With the consensus live the animal's own `migrationHeading` must
    // have no effect whatsoever, which is checkable by moving it and seeing nothing
    // happen.
    const engine = consensusSandbox({ seed: 11, decision: true });
    const [focus] = herd(engine, [
      { heading: 0, strength: 0.5 },
      { heading: Math.PI / 2, strength: 0.5 },
      { heading: Math.PI / 2, strength: 0.5 },
      { heading: Math.PI / 2, strength: 0.5 },
    ], { spacing: 1 });
    engine.step(1);
    const committedHeading = focus.herdHeading;
    const committedStrength = focus.herdStrength;
    assert.ok(committedHeading !== null);

    // ⚠ Rewrite the animal's own cue *after* the commitment exists, hard and in the
    // opposite direction. If `migrationHeading` were still being blended in behind
    // the consensus, twenty ticks at strength 0.9 would be impossible to miss.
    focus.migrationHeading = -Math.PI / 2;
    focus.migrationStrength = 0.9;
    for (let i = 0; i < 20; i += 1) engine.step(1);
    assert.ok(Math.abs(focus.herdHeading - committedHeading) < 1e-9, 'the commitment is untouched by the cue it replaced');
    assert.ok(Math.abs(focus.herdStrength - committedStrength) < 1e-9);
    // And what actually steers is the commitment: a fresh wander bends toward the
    // herd's northbound heading, never toward this animal's own southbound cue.
    let north = 0;
    for (let i = 0; i < 40; i += 1) {
      engine.step(1);
      if (focus.action === 'wander' && Math.sin(focus.moveIntent.heading) > 0) north += 1;
    }
    assert.ok(north > 20, `bent north with the herd rather than south with its own nose (${north} of 40)`);
  });
});

describe('consensus: leadership is derived, and stored nowhere', () => {
  test('at the identity it is dominance to the digit', () => {
    const animal = { kind: 'animal', alive: true, lifeStage: 'adult', bodyMass: 40, energy: 80, maxEnergy: 100, health: 100, maxHealth: 100, impairment: 0, traits: { boldness: 1 } };
    assert.equal(leadershipOf(animal, 0), dominanceOf(animal));
    assert.equal(leadershipOf(animal), dominanceOf(animal), 'and saying nothing is the identity');
    assert.equal(leadershipOf({ ...animal, alive: false }, 0.5), 0, 'the dead lead nobody');
    assert.equal(leadershipOf(null, 0.5), 0);
  });

  test('⚠⚠ an age weight reverses the ordering dominance gets backwards', () => {
    // The whole reason this function exists. `dominanceOf`'s maturity term is 0.85
    // for a senescent animal, which is right for a shoving match and wrong for who a
    // herd follows — the animal that knows where the water is in a bad year is the
    // old cow.
    const base = { kind: 'animal', alive: true, bodyMass: 40, energy: 80, maxEnergy: 100, health: 100, maxHealth: 100, impairment: 0, traits: { boldness: 1 } };
    const prime = { ...base, lifeStage: 'adult' };
    const old = { ...base, lifeStage: 'senescent' };
    assert.ok(dominanceOf(old) < dominanceOf(prime), 'a shoving match still goes the other way');
    assert.ok(leadershipOf(old, 0.5) > leadershipOf(prime, 0.5), 'and the herd still follows her');
    // 0.85 × 1.5 against 1.0 — a 27.5% edge, not a rounding error.
    assert.ok(Math.abs(leadershipOf(old, 0.5) / leadershipOf(prime, 0.5) - 1.275) < 1e-9);
    assert.equal(leadershipOf(prime, 0.5), dominanceOf(prime), '⚠ seniority is senescent or nothing');
  });

  test('a declared age weight is a positive number and nothing else', () => {
    assert.equal(leadAgeWeightOf(MATRIARCH), 0.5);
    assert.equal(leadAgeWeightOf(PEERS), 0, 'saying nothing is the identity');
    assert.equal(leadAgeWeightOf(undefined), 0);
    assert.equal(leadAgeWeightOf({ behavior: { leadAgeWeight: -1 } }), 0);
    assert.equal(leadAgeWeightOf({ behavior: { leadAgeWeight: 'old' } }), 0);
  });

  test('⚠ a band’s centre leans toward the animals it would follow, and at 0 it is the plain mean', () => {
    // The seam P7 left open on purpose, closed here. ⚠ The two members differ in
    // **mass**, because two identical animals have identical standing and a
    // leadership weight would then be untestable — the same "make the fixture's
    // numbers different" rule `MIXER` and P4's `worth *= calfWeight` exist for.
    const centre = (leadWeight) => {
      const engine = sandbox({ seed: 3 });
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      engine.registerSystem(new GroupSystem({ ...CONFIG.groups, rallyEnabled: true, leadWeight }));
      // ⚠ Inside `joinRadius` (6), or there is no record to have a centre.
      const light = spawn(engine, PEERS.id, { x: 40, y: 40, bodyMass: 10 });
      const heavy = spawn(engine, PEERS.id, { x: 44, y: 40, bodyMass: 40 });
      engine.step(2);
      assert.equal(engine.world.groups.size, 1, 'the pair founded a record');
      assert.equal(light.groupRecordId, heavy.groupRecordId);
      return engine.world.groupCentres.get(light.groupRecordId).x;
    };
    assert.equal(centre(0), 42, 'the identity is exactly the midpoint P7 shipped');
    // Weights are `1 + leadWeight × (score / best in this record)`: 1.5 for the heavy
    // animal, 1 + 0.5 × (10/40) = 1.125 for the light one.
    const expected = (40 * 1.125 + 44 * 1.5) / 2.625;
    assert.ok(Math.abs(centre(0.5) - expected) < 1e-9, `${centre(0.5)} against ${expected}`);
    assert.ok(centre(0.5) > 42, 'and it leans toward the animal a band would follow');
  });

  test('⚠ a declared age weight reaches the centre, and nothing anywhere stores a leader', () => {
    const centre = (speciesId) => {
      const engine = sandbox({ seed: 3 });
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      engine.registerSystem(new GroupSystem({ ...CONFIG.groups, rallyEnabled: true, leadWeight: 0.5 }));
      const prime = spawn(engine, speciesId, { x: 40, y: 40, lifeStage: 'adult' });
      const old = spawn(engine, speciesId, { x: 44, y: 40, lifeStage: 'senescent' });
      engine.step(2);
      const record = engine.world.groups.get(prime.groupRecordId);
      // The record holds a roster and nothing else — no leader, no rank, no history.
      assert.deepEqual(Object.keys(record).sort(), ['belowMinSince', 'foundedTick', 'founderId', 'id', 'memberIds', 'speciesId']);
      assert.equal(old.groupRecordId, prime.groupRecordId);
      return engine.world.groupCentres.get(prime.groupRecordId).x;
    };
    assert.ok(centre(MATRIARCH.id) > centre(PEERS.id), 'the old cow pulls her band toward herself');
    assert.ok(centre(PEERS.id) < 42, 'while a band with no opinion about age leans toward the prime adult');
    assert.ok(centre(MATRIARCH.id) > 42, 'and one that has an opinion leans the other way');
  });
});

describe('consensus: persistence and the off arm', () => {
  test('the world switch writes nothing at all, and the world is byte-identical without it', () => {
    // ⚠ Two independent off arms, and both are asserted: the system unregistered
    // (`config.consensus.enabled: false`) and every species declaring nothing.
    const run = (registered) => {
      const engine = sandbox({ seed: 12 });
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      engine.registerSystem(new SocialSystem(CONFIG.social));
      if (registered) engine.registerSystem(new HerdConsensusSystem({ ...CONFIG.consensus, updateInterval: 1 }));
      engine.registerSystem(
        new DecisionSystem({ ...CONFIG.decision, ...CONFIG.behavior, foodMinLevel: CONFIG.perception.foodMinLevel }),
      );
      herd(engine, [{ heading: 0, strength: 0.4 }, { heading: 1, strength: 0.4 }, { heading: 2, strength: 0.4 }], {
        speciesId: PLAIN.id,
      });
      engine.step(60);
      const state = captureSimulationState(engine);
      delete state.systems; // the lineup differs by construction; the world must not
      return JSON.stringify(state);
    };
    assert.equal(run(true), run(false), 'a roster that declares nothing runs the identical world');
  });

  test('a commitment survives a save, and the run continues identically (persistence)', () => {
    // Entities serialize whole, so a missing field fails *silently* — which is why
    // this asserts the values rather than only that the load did not throw.
    const build = (seed) => {
      const engine = sandbox({ seed });
      engine.registerSystem(new PerceptionSystem(CONFIG.perception));
      engine.registerSystem(new SocialSystem(CONFIG.social));
      engine.registerSystem(new HerdConsensusSystem({ ...CONFIG.consensus, updateInterval: 1 }));
      return engine;
    };
    const engine = build(21);
    const members = herd(engine, [
      { heading: 0.9, strength: 0.4 },
      { heading: 0.9, strength: 0.4 },
      { heading: 0.9, strength: 0.4 },
    ]);
    engine.step(3);
    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));
    const before = { ...members[0] };
    assert.ok(before.herdHeading !== null && before.herdCommitLabel !== null);

    const restored = build(21);
    const registry = restored.species;
    restoreSimulationState(restored, saved);
    restored.species = registry;
    restored.world.species = registry;
    const same = restored.world.entities.get(before.id);
    for (const field of ['herdHeading', 'herdStrength', 'herdCommitUntil', 'herdCommitLabel']) {
      assert.equal(same[field], before[field], `${field} round-trips`);
    }
    engine.step(20);
    restored.step(20);
    assert.equal(
      JSON.stringify(captureSimulationState(restored).entities),
      JSON.stringify(captureSimulationState(engine).entities),
      'and the restored run continues identically',
    );
  });

  test('the mechanism fires in the demo world, and nobody ends up at NaN (demo)', () => {
    // ⚠ Asserted on the demo rather than in a sandbox, because the sandbox cannot
    // tell you whether the shipped roster ever reaches this code — and a `NaN`
    // heading is silent: the animal simply leaves every spatial query forever.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    let committed = 0;
    let declaring = 0;
    const byLabel = new Map();
    for (const entity of engine.world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.y), `entity ${entity.id} is at a real place`);
      if (entity.herdHeading !== null) {
        assert.ok(Number.isFinite(entity.herdHeading) && Number.isFinite(entity.herdStrength));
        assert.ok(entity.herdStrength > 0 && entity.herdStrength <= CONFIG.consensus.maxStrength);
        committed += 1;
        const key = `${entity.speciesId}:${entity.groupId}`;
        if (!byLabel.has(key)) byLabel.set(key, new Set());
        byLabel.get(key).add(entity.herdHeading);
      }
      if (['herbivore.wildebeest', 'herbivore.buffalo'].includes(entity.speciesId)) declaring += 1;
    }
    assert.ok(committed > declaring * 0.5, `most of the declaring roster is committed (${committed} of ${declaring})`);
    // A front, not a smear: a label whose members hold many different headings is a
    // rolling average, which is exactly what the re-decision rule exists to refuse.
    const shared = [...byLabel.values()].filter((headings) => headings.size === 1).length;
    assert.ok(shared > byLabel.size * 0.5, `most labels hold one heading (${shared} of ${byLabel.size})`);
  });
});
