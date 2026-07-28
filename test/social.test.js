import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SeededRandom } from '../src/simulation/random/SeededRandom.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { HuntingSystem } from '../src/simulation/systems/HuntingSystem.js';
import { FightInjuryKinds, dominanceOf, isKin, resolveContest } from '../src/simulation/social/dominance.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { computeMetrics } from '../src/simulation/metrics/metrics.js';
import { getSpecies } from '../src/simulation/config/species/index.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { buildFullSnapshot, PUBLIC_ENTITY_FIELDS } from '../src/protocol/snapshots.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';

const CONFIG = new SimulationEngine().config;
const GRAZER = getSpecies('herbivore.grazer');
const STALKER = getSpecies('predator.stalker');

function genomeWith(overrides = {}) {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [overrides[locus] ?? 1, overrides[locus] ?? 1]]));
}

function sandbox({ seed = 1, systems = [], config = {} } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
      ...config,
    },
  });
  for (const system of systems) engine.registerSystem(system);
  return engine;
}

function spawn(engine, overrides = {}) {
  const species = overrides.speciesId === STALKER.id ? STALKER : GRAZER;
  const genome = overrides.genome ?? genomeWith();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId: species.id,
    heading: 0,
    lifeStage: 'adult',
    sex: Sexes.FEMALE,
    genome,
    traits: overrides.traits ?? expressGenome(genome),
    bodyMass: species.bodyMass,
    adultMass: species.bodyMass,
    speed: species.baseSpeed,
    maxEnergy: species.maxEnergy,
    energy: species.maxEnergy,
    maxHealth: species.maxHealth,
    health: species.maxHealth,
    maxHydration: species.maxHydration,
    hydration: species.maxHydration,
    maxStamina: species.maxStamina,
    stamina: species.maxStamina,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

/** Perception + social, the minimum needed for groups and alarm. */
function socialEngine(options = {}) {
  const engine = sandbox({ seed: 3, config: options.config });
  engine.registerSystem(new PerceptionSystem(CONFIG.perception));
  engine.registerSystem(new SocialSystem({ ...CONFIG.social, ...options.social }));
  return engine;
}

/** A line of animals `spacing` apart, so hop distance is exactly controllable. */
function spawnLine(engine, count, { x = 5, y = 20, spacing = 3, ...overrides } = {}) {
  return Array.from({ length: count }, (_, i) => spawn(engine, { x: x + i * spacing, y, ...overrides }));
}

describe('social: dominance is derived, not stored', () => {
  test('mass, condition, soundness, boldness, and maturity all move it', () => {
    const base = { kind: 'animal', alive: true, lifeStage: 'adult', bodyMass: 30, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, impairment: 0, traits: { boldness: 1 } };
    const baseline = dominanceOf(base);
    assert.ok(dominanceOf({ ...base, bodyMass: 45 }) > baseline, 'heavier wins');
    assert.ok(dominanceOf({ ...base, energy: 20 }) < baseline, 'starving loses');
    assert.ok(dominanceOf({ ...base, health: 30 }) < baseline, 'sick loses');
    assert.ok(dominanceOf({ ...base, impairment: 0.6 }) < baseline, 'wounded loses');
    assert.ok(dominanceOf({ ...base, traits: { boldness: 1.4 } }) > baseline, 'bold presses its claim');
    assert.ok(dominanceOf({ ...base, lifeStage: 'juvenile' }) < baseline, 'half-grown animals do not contest adults');
    assert.equal(dominanceOf({ ...base, alive: false }), 0, 'the dead have no standing');
    assert.equal(dominanceOf(null), 0);
  });

  test('a wounded animal loses standing it can heal back — nothing is stored', () => {
    // The point of deriving rather than storing: rank is a fact about the
    // animal now, so it moves with the animal. A rank you cannot lose by being
    // mauled is a title, not a rank.
    const animal = { kind: 'animal', alive: true, lifeStage: 'adult', bodyMass: 30, energy: 100, maxEnergy: 100, health: 100, maxHealth: 100, impairment: 0, traits: { boldness: 1 } };
    const healthy = dominanceOf(animal);
    animal.impairment = 0.5;
    animal.health = 50;
    const hurt = dominanceOf(animal);
    animal.impairment = 0;
    animal.health = 100;
    assert.ok(hurt < healthy);
    assert.equal(dominanceOf(animal), healthy, 'and comes straight back when it heals');
  });
});

describe('social: kin recognition', () => {
  test('parents, offspring, and siblings are kin; strangers are not', () => {
    const parent = { id: 1, parents: [], offspring: [2, 3] };
    const child = { id: 2, parents: [1, 9], offspring: [] };
    const sibling = { id: 3, parents: [1, 9], offspring: [] };
    const halfSibling = { id: 4, parents: [1, 8], offspring: [] };
    const stranger = { id: 5, parents: [6, 7], offspring: [] };

    assert.equal(isKin(parent, child), true, 'parent → child');
    assert.equal(isKin(child, parent), true, 'and symmetrically');
    assert.equal(isKin(child, sibling), true, 'full siblings share both parents');
    assert.equal(isKin(child, halfSibling), true, 'half siblings share one');
    assert.equal(isKin(child, stranger), false);
    assert.equal(isKin(child, child), false, 'nobody is their own kin');
    assert.equal(isKin(child, null), false);
  });

  test('recognition reads the authoritative lineage, so it needs no memory kind', () => {
    // §1.4 A15 deferred a `kin` memory because nothing read it. This is the
    // reader — and it reads `parents` / `offspring` directly, which is why a
    // decaying copy would still be duplicated state rather than a new fact.
    const engine = sandbox();
    const mother = spawn(engine, { x: 10, y: 10 });
    const child = spawn(engine, { x: 11, y: 10, parents: [mother], lifeStage: 'juvenile' });
    engine.world.entities.get(mother).offspring.push(child);
    assert.equal(isKin(engine.world.entities.get(mother), engine.world.entities.get(child)), true);
    const stranger = spawn(engine, { x: 12, y: 10 });
    assert.equal(isKin(engine.world.entities.get(mother), engine.world.entities.get(stranger)), false);
  });
});

describe('social: contests and fights', () => {
  const PARAMS = {
    escalationChance: 0.35,
    fightInjurySeverity: 0.22,
    winnerInjuryFraction: 0.4,
    injuryHealthDamage: 60,
    tick: 10,
  };
  const fighter = (id, bodyMass) => ({
    id,
    kind: 'animal',
    alive: true,
    lifeStage: 'adult',
    bodyMass,
    energy: 100,
    maxEnergy: 100,
    health: 100,
    maxHealth: 100,
    impairment: 0,
    injuries: [],
    traits: { boldness: 1 },
  });

  test('the stronger animal wins — there is no roll to lose', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const big = fighter(1, 45);
      const small = fighter(2, 20);
      const { winner } = resolveContest(big, small, new SeededRandom(seed), PARAMS);
      assert.equal(winner.id, big.id, `seed ${seed}: dominance decided it`);
    }
  });

  test('ties resolve to the lower id, so identical animals are deterministic', () => {
    const a = fighter(7, 30);
    const b = fighter(3, 30);
    const { winner } = resolveContest(a, b, new SeededRandom(1), PARAMS);
    assert.equal(winner.id, 3);
  });

  test('the draw budget is fixed at three, whatever happens', () => {
    const stateAfter = (aMass, bMass) => {
      const random = new SeededRandom(5);
      resolveContest(fighter(1, aMass), fighter(2, bMass), random, PARAMS);
      return random.getState();
    };
    // A walkover and a dead heat must cost the same draws, or the `social`
    // stream shifts with the outcome and determinism goes with it.
    assert.equal(stateAfter(45, 12), stateAfter(30, 30));
  });

  test('an even contest escalates far more often than a lopsided one', () => {
    let evenFights = 0;
    let lopsidedFights = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      if (resolveContest(fighter(1, 30), fighter(2, 30), new SeededRandom(seed), PARAMS).escalated) evenFights += 1;
      if (resolveContest(fighter(1, 50), fighter(2, 10), new SeededRandom(seed), PARAMS).escalated) lopsidedFights += 1;
    }
    assert.ok(evenFights > lopsidedFights * 2, `even ${evenFights} vs lopsided ${lopsidedFights}`);
    assert.ok(evenFights > 0 && evenFights < 300, 'and it is neither never nor always');
  });

  test('a fight wounds the loser, and costs the winner something too', () => {
    // Seeded to a run that escalates, so the assertion is about what a fight
    // does rather than about whether one happened.
    let outcome = null;
    let big;
    let small;
    for (let seed = 1; seed <= 50 && !outcome?.escalated; seed += 1) {
      big = fighter(1, 32);
      small = fighter(2, 30);
      outcome = resolveContest(big, small, new SeededRandom(seed), PARAMS);
    }
    assert.ok(outcome.escalated, 'found an escalating seed');
    assert.ok(small.impairment > 0, 'the loser is hurt');
    assert.ok(small.health < 100, 'and it cost real health');
    assert.equal(small.injuries[0].kind, FightInjuryKinds.BATTLE, 'a fight wound, not a bite');
    assert.ok(big.impairment > 0, 'winning a fight is not the same as being unhurt');
    assert.ok(big.impairment < small.impairment, 'but the winner comes off better');
  });

  test('a contest that only yields injures nobody', () => {
    const big = fighter(1, 60);
    const small = fighter(2, 8);
    const { escalated } = resolveContest(big, small, new SeededRandom(11), PARAMS);
    assert.equal(escalated, false, 'a rival that outmatched is not worth bleeding for');
    assert.equal(big.impairment, 0);
    assert.equal(small.impairment, 0);
  });
});

describe('social: herds form, merge, and dissolve', () => {
  test('animals in sight of each other converge on one label', () => {
    const engine = socialEngine();
    const ids = spawnLine(engine, 5, { spacing: 2 });
    engine.step(3);
    const labels = new Set(ids.map((id) => engine.world.entities.get(id).groupId));
    assert.equal(labels.size, 1, 'one herd');
    assert.notEqual([...labels][0], null);
  });

  test('a lone animal is not a herd of one', () => {
    const engine = socialEngine();
    const loner = spawn(engine, { x: 5, y: 5 });
    spawn(engine, { x: 50, y: 50 });
    engine.step(3);
    assert.equal(engine.world.entities.get(loner).groupId, null);
  });

  test('two separated herds keep separate labels, and merge on contact', () => {
    const engine = socialEngine();
    const west = spawnLine(engine, 3, { x: 5, y: 20, spacing: 2 });
    const east = spawnLine(engine, 3, { x: 40, y: 20, spacing: 2 });
    engine.step(3);
    const westLabel = engine.world.entities.get(west[0]).groupId;
    const eastLabel = engine.world.entities.get(east[0]).groupId;
    assert.notEqual(westLabel, eastLabel, 'far apart ⇒ separate herds');

    // Walk the eastern herd over to the western one.
    for (const id of east) {
      const animal = engine.world.entities.get(id);
      engine.world.moveEntity(animal, animal.x - 33, animal.y);
    }
    engine.step(5);
    const merged = new Set([...west, ...east].map((id) => engine.world.entities.get(id).groupId));
    assert.equal(merged.size, 1, 'contact merges them');
    assert.equal([...merged][0], Math.min(westLabel, eastLabel), 'onto the smaller label — symmetric, no negotiation');
  });

  test('a herd that splits dissolves into separate labels', () => {
    const engine = socialEngine();
    const ids = spawnLine(engine, 6, { x: 20, y: 20, spacing: 1.5 });
    engine.step(3);
    assert.equal(new Set(ids.map((id) => engine.world.entities.get(id).groupId)).size, 1);

    for (const id of ids.slice(3)) {
      const animal = engine.world.entities.get(id);
      engine.world.moveEntity(animal, animal.x + 30, animal.y);
    }
    engine.step(5);
    const west = engine.world.entities.get(ids[0]).groupId;
    const east = engine.world.entities.get(ids[5]).groupId;
    assert.notEqual(west, east, 'out of sight, out of herd');
  });

  test('the group cap holds even when a crowd joins in one tick', () => {
    // The cap is checked against a *live* tally. Checking a snapshot taken
    // before the pass let 23 animals pile into a group capped at 12, because
    // they all saw the same under-cap label in the same tick.
    const engine = socialEngine({ social: { maxGroupSize: 5 } });
    const ids = spawnLine(engine, 20, { x: 20, y: 20, spacing: 0.4 });
    engine.step(6);
    const sizes = new Map();
    for (const id of ids) {
      const label = engine.world.entities.get(id).groupId;
      if (label !== null) sizes.set(label, (sizes.get(label) ?? 0) + 1);
    }
    for (const [label, size] of sizes) {
      assert.ok(size <= 5, `group #${label} has ${size}, cap is 5`);
    }
    assert.ok(sizes.size >= 2, 'a crowd over the cap becomes several herds, not one');
  });

  test('different species never share a herd', () => {
    const engine = socialEngine();
    const grazers = spawnLine(engine, 3, { x: 20, y: 20, spacing: 1.5 });
    const stalkers = spawnLine(engine, 3, { x: 21, y: 20.5, spacing: 1.5, speciesId: STALKER.id });
    engine.step(3);
    const grazerLabel = engine.world.entities.get(grazers[0]).groupId;
    for (const id of stalkers) {
      assert.notEqual(engine.world.entities.get(id).groupId, grazerLabel);
    }
  });

  test('the summary is transient and local — a roster is never built', () => {
    const engine = socialEngine();
    const ids = spawnLine(engine, 4, { x: 20, y: 20, spacing: 1.5 });
    engine.step(2);
    const summary = engine.world.social.get(ids[0]);
    assert.equal(summary.groupmates, 3, 'counted, not listed');
    assert.ok(!('members' in summary), 'no membership list anywhere');
    assert.ok(summary.centroid && Number.isFinite(summary.centroid.x));
    // Transient: cleared and rebuilt, exactly like perception.
    const saved = captureSimulationState(engine);
    assert.ok(!JSON.stringify(saved).includes('"centroid"'), 'the summary is never serialized');
  });
});

describe('social: alarm spreads locally and stops', () => {
  /** A line of grazers with a stalker parked at one end. */
  function alarmWorld(social = {}) {
    const engine = socialEngine({ social });
    // Spaced just inside the 6-unit alarm radius, so "one hop" is one animal.
    const line = spawnLine(engine, 8, { x: 10, y: 20, spacing: 5 });
    const predator = spawn(engine, { x: 8, y: 20, speciesId: STALKER.id });
    return { engine, line, predator };
  }

  test('alarm reaches neighbours the predator is invisible to', () => {
    const { engine, line } = alarmWorld();
    engine.step(6);
    const alarmed = line.filter((id) => engine.world.entities.get(id).alarmedUntil !== null);
    assert.ok(alarmed.length > 1, 'more than just the one that can see it');
  });

  test('…but stops after maxAlarmHops, so it is never global', () => {
    // The property that matters. Without the hop cap this mechanism is a chain
    // reaction: alarmed animals re-alarm whoever alarmed them and the panic
    // never runs out of fuel (it left 106 of 119 demo grazers permanently
    // fleeing on the first cut).
    const { engine, line } = alarmWorld({ maxAlarmHops: 1 });
    engine.step(40);
    const hops = line.map((id) => engine.world.entities.get(id).alarmSource?.hops ?? null);
    for (const hop of hops) {
      if (hop !== null) assert.ok(hop <= 1, `no alarm travelled further than 1 hop (saw ${hop})`);
    }
    const far = line.slice(4).filter((id) => engine.world.entities.get(id).alarmedUntil !== null);
    assert.equal(far.length, 0, 'the far end of the line never hears about it');
  });

  test('a bigger hop budget reaches further, and the counter says how far', () => {
    const reach = (maxAlarmHops) => {
      const { engine, line } = alarmWorld({ maxAlarmHops });
      engine.step(40);
      return line.filter((id) => engine.world.entities.get(id).alarmedUntil !== null).length;
    };
    assert.ok(reach(3) > reach(1), 'three hops carries further than one');
  });

  test('an animal that sees the predator itself reports zero hops', () => {
    const { engine, line } = alarmWorld();
    engine.step(3);
    const firstHand = line
      .map((id) => engine.world.entities.get(id))
      .filter((a) => a.alarmSource?.hops === 0);
    assert.ok(firstHand.length > 0, 'somebody saw it with their own eyes');
  });

  test('alarm expires once the threat is gone', () => {
    const { engine, line, predator } = alarmWorld();
    engine.step(5);
    assert.ok(line.some((id) => engine.world.entities.get(id).alarmedUntil !== null), 'panic started');
    engine.world.entities.queueRemove(predator);
    engine.applyDeferredEntityChanges(engine.tick);
    // Long enough to cover both the few ticks the wave takes to run out of hops
    // *and* the full alarm timer that the last re-warning refreshed.
    engine.step(CONFIG.social.alarmTicks * 2 + 10);
    const stillAlarmed = line.filter((id) => engine.world.entities.get(id).alarmedUntil !== null);
    assert.equal(stillAlarmed.length, 0, 'and it stops, rather than running forever');
  });

  test('the event fires on the transition into panic, not every tick of it', () => {
    const { engine, line } = alarmWorld();
    const before = engine.events.lastSeq;
    engine.step(60);
    const alarms = engine.eventsSince(before).filter((e) => e.type === 'entity.alarmed');
    assert.ok(alarms.length > 0, 'alarms are reported');
    assert.ok(alarms.length < line.length * 60, `bounded (${alarms.length} over 60 ticks for ${line.length} animals)`);
    assert.ok(alarms.some((a) => a.sourceId === null), 'somebody saw it first-hand');
    assert.ok(alarms.some((a) => a.sourceId !== null), 'and somebody was told');
  });
});

describe('social: herding behaviour', () => {
  function herdEngine(overrides = {}) {
    const engine = sandbox({
      seed: 4,
      // No food anywhere, so nothing outranks the social pull; herding is
      // deliberately the weakest utility there is, and a fed animal in a
      // grassy field would rather graze — which is the point of it being weak.
      // ⚠ Behaviour overrides go through the **config**, not the constructor:
      // `behavior` is a species block since 2026-07-28, and a resolved species
      // beats anything a system was built with (DOCS §8, D23).
      config: {
        vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 },
        behavior: { ...CONFIG.behavior, ...overrides },
      },
    });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new SocialSystem(CONFIG.social));
    engine.registerSystem(
      new DecisionSystem({ ...engine.config.decision, ...engine.config.behavior, foodMinLevel: CONFIG.perception.foodMinLevel }),
    );
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    return engine;
  }

  test('a straggler holds station with the herd instead of drifting off', () => {
    // Against a control, and over a long run, because the gap *oscillates*: the
    // pull only engages past `herdDistance`, so a herded animal settles into a
    // band around the group rather than converging on its centre. Asserting a
    // strict decrease over a short window would be asserting the phase of that
    // oscillation, which is exactly the kind of thing §1.4 D1 warns about.
    const run = (herdWeight) => {
      const engine = herdEngine({ herdWeight });
      for (let i = 0; i < 5; i += 1) spawn(engine, { x: 20 + (i % 2), y: 20 + i * 0.5 });
      const straggler = spawn(engine, { x: 23.5, y: 21 });
      engine.step(300);
      // Measured against the herd's *current* centre, not a fixed point: the
      // herd moves as a unit, so a fixed reference makes a straggler that kept
      // up with a herd that walked away look like a failure.
      const others = [...engine.world.entities.all()].filter((e) => e.id !== straggler);
      const cx = others.reduce((a, e) => a + e.x, 0) / others.length;
      const cy = others.reduce((a, e) => a + e.y, 0) / others.length;
      const me = engine.world.entities.get(straggler);
      return Math.hypot(me.x - cx, me.y - cy);
    };
    const herded = run(CONFIG.behavior.herdWeight);
    const adrift = run(0);
    assert.ok(herded < adrift, `kept up (${herded.toFixed(1)} vs ${adrift.toFixed(1)} without herding)`);
    assert.ok(herded < CONFIG.social.groupRadius * 2, 'and stayed in the same postcode as the herd');
  });

  test('an animal that loses contact is gone — herding has no memory', () => {
    // The honest limit of a purely local mechanism, pinned rather than hidden.
    // Beyond `groupRadius` there are no groupmates to steer toward, so a herd
    // can lose a member for good. Nothing remembers a group it used to be in;
    // that would need the spatial memory of Step 15 to learn *animals* rather
    // than places, which nothing has asked for yet.
    const engine = herdEngine();
    for (let i = 0; i < 5; i += 1) spawn(engine, { x: 20 + (i % 2), y: 20 + i * 0.5 });
    const lost = spawn(engine, { x: 20 + CONFIG.social.groupRadius + 4, y: 21 });
    engine.step(2);
    const animal = engine.world.entities.get(lost);
    assert.equal(animal.groupId, null, 'out of range ⇒ no herd');
    assert.equal(animal.utilityBreakdown.herd, 0, 'and nothing pulling it back');
  });

  test('herding loses to every real need', () => {
    const engine = herdEngine();
    for (let i = 0; i < 5; i += 1) spawn(engine, { x: 20 + (i % 2), y: 20 + i * 0.5 });
    // A straggler with a predator on it. Fleeing has to win, or a herd would
    // drown its own members' survival — and unlike thirst, danger always has an
    // outlet, so this tests the ranking rather than the availability of water.
    const straggler = spawn(engine, { x: 26, y: 21 });
    spawn(engine, { x: 27.5, y: 21, speciesId: STALKER.id });
    engine.step(2);
    const animal = engine.world.entities.get(straggler);
    assert.equal(animal.action, 'flee', `chose ${animal.action} over running`);
    assert.ok(animal.utilityBreakdown.herd > 0, 'it did want to close up — it just wanted to live more');
  });

  test('a bolder animal is a looser herd member', () => {
    const utilityFor = (boldness) => {
      const engine = herdEngine();
      for (let i = 0; i < 5; i += 1) spawn(engine, { x: 20 + (i % 2), y: 20 + i * 0.5 });
      const outlier = spawn(engine, {
        x: 25.5,
        y: 21,
        traits: { ...expressGenome(genomeWith()), boldness },
      });
      engine.step(2);
      return engine.world.entities.get(outlier).utilityBreakdown.herd;
    };
    assert.ok(utilityFor(1.4) < utilityFor(0.6), 'the same trait that makes an animal roam loosens its herd ties');
  });
});

describe('social: defending young', () => {
  function defenceEngine() {
    const engine = sandbox({ seed: 5, config: { vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 } } });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new SocialSystem(CONFIG.social));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));
    return engine;
  }

  /** A mother, her juvenile between her and a stalker. */
  function family(engine, { motherX = 20 } = {}) {
    const mother = spawn(engine, { x: motherX, y: 20 });
    const calf = spawn(engine, { x: 22, y: 20, lifeStage: 'juvenile', bodyMass: 8, parents: [mother] });
    engine.world.entities.get(mother).offspring.push(calf);
    const stalker = spawn(engine, { x: 23.5, y: 20, speciesId: STALKER.id });
    return { mother, calf, stalker };
  }

  test('a mother stands over her calf instead of running (§1.4 A11)', () => {
    const engine = defenceEngine();
    const { mother, calf } = family(engine);
    engine.step(1);
    const she = engine.world.entities.get(mother);
    assert.equal(she.action, 'defend', 'she defends rather than flees');
    assert.equal(she.defendingId, calf, 'and the protocol says over whom');
  });

  test('she runs when the calf is behind her, not in front', () => {
    // "Interposing" means being between them. An adult does not abandon its own
    // escape for a juvenile that is already safer than it is.
    const engine = defenceEngine();
    const mother = spawn(engine, { x: 23, y: 20 });
    const calf = spawn(engine, { x: 15, y: 20, lifeStage: 'juvenile', bodyMass: 8, parents: [mother] });
    engine.world.entities.get(mother).offspring.push(calf);
    spawn(engine, { x: 24.5, y: 20, speciesId: STALKER.id });
    engine.step(1);
    assert.equal(engine.world.entities.get(mother).action, 'flee');
  });

  test('a juvenile never defends, and a stranger is not defended', () => {
    const engine = defenceEngine();
    // A juvenile with a threatened juvenile "offspring" — impossible in world,
    // but it pins that the maturity gate is what stops it, not the lineage.
    const young = spawn(engine, { x: 20, y: 20, lifeStage: 'juvenile', bodyMass: 8 });
    const other = spawn(engine, { x: 22, y: 20, lifeStage: 'juvenile', bodyMass: 8, parents: [young] });
    engine.world.entities.get(young).offspring.push(other);
    spawn(engine, { x: 23.5, y: 20, speciesId: STALKER.id });
    engine.step(1);
    assert.notEqual(engine.world.entities.get(young).action, 'defend');

    const engine2 = defenceEngine();
    const adult = spawn(engine2, { x: 20, y: 20 });
    spawn(engine2, { x: 22, y: 20, lifeStage: 'juvenile', bodyMass: 8 }); // no kin link
    spawn(engine2, { x: 23.5, y: 20, speciesId: STALKER.id });
    engine2.step(1);
    assert.notEqual(engine2.world.entities.get(adult).action, 'defend', 'somebody else’s calf is not defended');
  });
});

describe('social: cooperative defense', () => {
  const hunting = new HuntingSystem({ ...CONFIG.hunting });

  function preyWith({ adults = 0, guardian = null } = {}) {
    return {
      id: 2,
      kind: 'animal',
      alive: true,
      speed: GRAZER.baseSpeed,
      stamina: 100,
      maxStamina: 100,
      health: 100,
      maxHealth: 100,
      bodyMass: 30,
      adultMass: 30,
      parents: [],
      _adults: adults,
      _guardian: guardian,
    };
  }
  const predator = { id: 1, kind: 'animal', alive: true, speed: STALKER.baseSpeed, stamina: 100, maxStamina: 100, bodyMass: 45 };

  test('company makes an animal harder to catch, with diminishing returns', () => {
    const alone = hunting.captureChance(predator, preyWith(), { count: 0, guardian: null });
    const two = hunting.captureChance(predator, preyWith(), { count: 2, guardian: null });
    const many = hunting.captureChance(predator, preyWith(), { count: 50, guardian: null });
    assert.ok(two < alone, 'a couple of adults nearby already helps');
    assert.ok(many < two, 'more helps more');
    const capped = hunting.captureChance(predator, preyWith(), { count: CONFIG.hunting.maxDefenders, guardian: null });
    assert.equal(many, capped, 'but the benefit is capped — a big herd is not untouchable');
    assert.ok(many >= CONFIG.hunting.minCaptureChance, 'and the floor still applies');
  });

  test('a parent actively interposing counts for more than a bystander', () => {
    const bystander = hunting.captureChance(predator, preyWith(), { count: 1, guardian: null });
    const guarded = hunting.captureChance(predator, preyWith(), { count: 1, guardian: { id: 3, bodyMass: 30 } });
    assert.ok(guarded < bystander, 'being stood over beats being stood near');
  });

  test('defenders are read from state that already exists — no new scan', () => {
    const engine = sandbox();
    const mother = spawn(engine, { x: 20, y: 20 });
    const calf = spawn(engine, { x: 20.5, y: 20, lifeStage: 'juvenile', bodyMass: 8, parents: [mother] });
    engine.world.social.set(calf, { groupmates: 3, adults: 2, centroid: null, heading: null, nearestDistance: 1 });
    engine.world.entities.get(mother).defendingId = calf;

    const found = hunting.defendersFor(engine.world, engine.world.entities.get(calf));
    assert.equal(found.count, 2, 'adults come from the social summary the social system already built');
    assert.equal(found.guardian.id, mother, 'the guardian comes from the sparse parents list');

    // A parent that is merely nearby, not defending, is not a defender.
    engine.world.entities.get(mother).defendingId = null;
    assert.equal(hunting.defendersFor(engine.world, engine.world.entities.get(calf)).guardian, null);
  });
});

describe('social: protocol, metrics, and persistence', () => {
  test('the herd label rides in bulk snapshots; nothing else social does', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(400);
    assert.ok(PUBLIC_ENTITY_FIELDS.includes('groupId'));
    const snapshot = buildFullSnapshot(engine.getSnapshotData());
    for (const entity of snapshot.entities) {
      assert.ok(!('social' in entity), 'the summary stays inspection-only');
      assert.ok(!('alarmedUntil' in entity));
      assert.ok(!('defendingId' in entity));
      assert.ok(!('members' in entity), 'there is no roster to leak');
    }
    assert.ok(snapshot.entities.some((e) => e.groupId !== null), 'herds actually form in the demo');
  });

  test('inspection exposes the herd, derived dominance, and alarm — as copies', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(400);
    const grouped = [...engine.world.entities.all()].find((e) => e.kind === 'animal' && e.alive && e.groupId !== null);
    assert.ok(grouped, 'somebody is in a herd');
    const details = engine.getEntityDetails(grouped.id);
    assert.equal(details.social.groupId, grouped.groupId);
    assert.ok(details.social.dominance > 0, 'dominance is derived on read');
    assert.equal(typeof details.social.alarmed, 'boolean');
    assert.ok(details.social.nearby.groupmates >= 1);

    details.social.alarmSource = { x: -1, y: -1 };
    const after = engine.getEntityDetails(grouped.id);
    assert.notDeepEqual(after.social.alarmSource, { x: -1, y: -1 }, 'inspection hands back copies');
  });

  test('metrics summarize herds without listing anyone', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(400);
    const report = computeMetrics(engine.world, { tick: 400, windowTicks: 500 });
    const grazer = report.species.find((s) => s.speciesId === GRAZER.id);

    // Checked against a brute-force pass over the entities themselves.
    const living = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive && e.speciesId === GRAZER.id);
    const counts = new Map();
    for (const a of living) if (a.groupId !== null) counts.set(a.groupId, (counts.get(a.groupId) ?? 0) + 1);
    assert.equal(grazer.grouping.groups, counts.size);
    assert.equal(grazer.grouping.grouped, living.filter((a) => a.groupId !== null).length);
    assert.equal(grazer.grouping.solitary, living.length - grazer.grouping.grouped);
    assert.equal(grazer.grouping.size.max, Math.max(...counts.values()));
    assert.ok(!JSON.stringify(grazer.grouping).includes('members'), 'summaries, not rosters');
  });

  test('the demo stays deterministic with sociality in play', () => {
    const a = createDemoSimulation({ seed: 42 });
    const b = createDemoSimulation({ seed: 42 });
    a.step(1200);
    b.step(1200);
    assert.deepEqual(captureSimulationState(a).entities, captureSimulationState(b).entities);
  });

  test('the herd label survives save/load and the run continues identically', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1500);
    const saved = captureSimulationState(engine);
    const restored = restoreDemoSimulation(saved);

    const grouped = [...engine.world.entities.all()].find((e) => e.groupId !== null);
    assert.ok(grouped, 'a herd existed to round-trip');
    assert.equal(restored.world.entities.get(grouped.id).groupId, grouped.groupId);
    // The *summary* is derived and deliberately not saved — it rebuilds on the
    // next social tick, exactly like perception and the spatial index.
    assert.equal(restored.world.social.size, 0, 'the transient summary is rebuilt, not restored');

    engine.step(300);
    restored.step(300);
    assert.deepEqual(captureSimulationState(restored).entities, captureSimulationState(engine).entities);
  });

  test('sociality does no global pairwise work', () => {
    // The invariant-17 guard. If group formation ever became O(N²) this is
    // where it would show: doubling the population at constant *density* must
    // roughly double the cost, not quadruple it.
    const measure = (count, size) => {
      const engine = socialEngine({ config: { world: { width: size, height: size } } });
      for (let i = 0; i < count; i += 1) {
        spawn(engine, { x: (i * 7.3) % (size - 1), y: (i * 3.1) % (size - 1) });
      }
      engine.step(3); // warm up
      const start = process.hrtime.bigint();
      engine.step(20);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    const small = measure(200, 64);
    const large = measure(800, 128); // 4× the animals at the same density
    assert.ok(large < small * 12, `scaling stayed near-linear (${small.toFixed(1)}ms → ${large.toFixed(1)}ms)`);
  });
});

describe('social: the herd sandbox', () => {
  /**
   * The demonstration scenario the step asks for: a seeded herd and a threat,
   * asserting cohesion and *local* alarm propagation with no global effect.
   *
   * Like Step 22's sandbox, the cohesion half is measured **against a control**
   * with herding switched off (`herdWeight: 0`), because "the animals ended up
   * near each other" proves nothing on its own — animals that all started near
   * each other will. What has to be shown is that they stay closer *than they
   * would have*.
   */
  function herdWorld({ herdWeight, seed = 9 }) {
    const engine = sandbox({
      seed,
      // Behaviour override through the config — see `herdEngine` above.
      config: {
        vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 },
        behavior: { ...CONFIG.behavior, herdWeight },
      },
    });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new SocialSystem(CONFIG.social));
    engine.registerSystem(
      new DecisionSystem({ ...engine.config.decision, ...engine.config.behavior, foodMinLevel: CONFIG.perception.foodMinLevel }),
    );
    engine.registerSystem(new MovementSystem(CONFIG.locomotion));
    for (let i = 0; i < 10; i += 1) {
      spawn(engine, { x: 30 + (i % 4) * 0.8, y: 30 + Math.floor(i / 4) * 0.8, heading: (i * Math.PI) / 5 });
    }
    return engine;
  }

  const spread = (engine) => {
    const animals = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive);
    const cx = animals.reduce((a, e) => a + e.x, 0) / animals.length;
    const cy = animals.reduce((a, e) => a + e.y, 0) / animals.length;
    return animals.reduce((a, e) => a + Math.hypot(e.x - cx, e.y - cy), 0) / animals.length;
  };

  test('a herd holds together, and it is herding that holds it', () => {
    const herded = herdWorld({ herdWeight: CONFIG.behavior.herdWeight });
    const control = herdWorld({ herdWeight: 0 });
    herded.step(400);
    control.step(400);
    const herdedSpread = spread(herded);
    const controlSpread = spread(control);
    assert.ok(
      herdedSpread < controlSpread,
      `the herd stayed tighter than the same animals without it (${herdedSpread.toFixed(1)} vs ${controlSpread.toFixed(1)})`,
    );
  });

  test('a threat alarms the near side of the herd and not the far side', () => {
    const engine = sandbox({
      seed: 11,
      config: { vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 } },
    });
    engine.registerSystem(new PerceptionSystem(CONFIG.perception));
    engine.registerSystem(new SocialSystem({ ...CONFIG.social, maxAlarmHops: 1 }));
    engine.registerSystem(new DecisionSystem({ ...CONFIG.decision, foodMinLevel: CONFIG.perception.foodMinLevel }));

    // A long line, so "near side" and "far side" are unambiguous, with the
    // stalker at one end only.
    const line = spawnLine(engine, 10, { x: 6, y: 30, spacing: 5 });
    spawn(engine, { x: 4, y: 30, speciesId: STALKER.id });
    engine.step(8);

    const alarmed = line.map((id) => engine.world.entities.get(id).alarmedUntil !== null);
    assert.ok(alarmed[0] || alarmed[1], 'the near end panics');
    assert.ok(
      alarmed.slice(5).every((a) => !a),
      'and the far end never hears about it — the effect is local, not global',
    );
    // And it is genuinely propagation, not everyone seeing the predator: at
    // least one alarmed animal was told rather than looking.
    const told = line
      .map((id) => engine.world.entities.get(id))
      .filter((a) => a.alarmSource !== null && a.alarmSource.hops > 0);
    assert.ok(told.length > 0, 'somebody was warned by a neighbour');
  });
});

describe('social: the shared neighbour walk (Step 30)', () => {
  // The social system reuses the neighbourhood the perception system already
  // walked (§1.4 C6). That is only sound if its own fallback walk would have
  // produced the same list, so this pins the two paths against each other
  // rather than trusting the argument in the comment. A future change to
  // perception's radius, its stagger, or the grid's ordering breaks this test
  // before it silently changes the demo.
  /**
   * The demo, optionally stale-dating the shared neighbourhood the instant
   * perception publishes it — which is exactly the state a *staggered*
   * perception system leaves behind, and forces the social system down its own
   * grid walk.
   */
  function demo({ fallback }) {
    const engine = createDemoSimulation({ seed: 42 });
    if (!fallback) return engine;
    let stamp = engine.world.neighbourhoodTick;
    Object.defineProperty(engine.world, 'neighbourhoodTick', {
      get: () => (stamp === null ? null : stamp - 1), // never equal to the current tick
      set: (value) => {
        stamp = value;
      },
      configurable: true,
    });
    return engine;
  }

  test('reusing perception\'s walk gives the same world as walking the grid again', () => {
    const shared = demo({ fallback: false });
    const fallback = demo({ fallback: true });
    shared.step(400);
    fallback.step(400);
    // The sabotage has to have taken, or this compares two identical runs.
    assert.notEqual(fallback.world.neighbourhoodTick, fallback.tick, 'the fallback engine really is walking the grid');
    assert.equal(shared.world.neighbourhoodTick, shared.tick, 'the shared engine really is reusing the walk');
    assert.equal(
      JSON.stringify(captureSimulationState(shared)),
      JSON.stringify(captureSimulationState(fallback)),
      'the optimization is a speed change only — 400 ticks of the demo agree byte for byte',
    );
  });

  test('the shared list really is the one being used', () => {
    // Guard against the test above passing because the fallback never engaged.
    const engine = demo({ fallback: false });
    engine.step(2);
    assert.equal(engine.world.neighbourhoodTick, engine.tick, 'perception stamps the neighbourhood it built');
    const animal = [...engine.world.entities.all()].find((e) => e.kind === 'animal' && e.alive);
    const shared = engine.world.neighbourhood.get(animal.id);
    assert.ok(Array.isArray(shared), 'every living animal gets a neighbour list');
    assert.equal(shared.length % 2, 0, 'the list is flat [id, distance, ...] pairs');
    // And it agrees with a fresh query at the same radius.
    const radius = engine.world.perception.get(animal.id).radius;
    const expected = engine.world.grid
      .queryRadius(animal.x, animal.y, radius)
      .filter((id) => {
        if (id === animal.id) return false;
        const other = engine.world.entities.get(id);
        return other && other.kind === 'animal' && other.alive;
      });
    assert.deepEqual(
      shared.filter((_, i) => i % 2 === 0),
      expected,
      'same ids, same ascending order as the grid query it replaces',
    );
  });
});
