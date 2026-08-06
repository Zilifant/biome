/**
 * Protocol v34 — the social mechanisms BEHAVIOR-PLAN built become inspectable.
 *
 * Nothing new rides in a bulk snapshot here; every addition is **inspection-only**,
 * which is the standing bulk-vs-inspection test (DOCS §11) coming out the other way
 * from v32 and v33. A consensus heading, a rally drift, a pursuit deadline and a
 * pull scale are all one-animal questions asked of one animal at a time, and three
 * of the four are null for the overwhelming majority of the world — exactly the
 * shape that belongs behind `GET /api/entities/:id`.
 *
 * What v34 adds, and why each one is not merely a field:
 *
 *   - `group.centre` / `group.leaderId` — **derived on read**, from `memberIds`,
 *     because `GroupRegistry` stores neither and says why: where a group is changes
 *     every tick, and standing is derived, never stored.
 *   - `social.consensus` (P8), `social.rally` (P7), `social.charge` (P9) — the three
 *     steering commitments this plan added. ⚠ Two of them **outlive their own cue**,
 *     which is precisely why they need projecting: by the time a pursuit matters,
 *     `defendingId` has already gone null and there is nothing else left to look at.
 *   - `social.nearby.pullScale` (P3) and `social.nearby.bandmates` (P7) — the two
 *     numbers on the social summary that decide a behaviour and were invisible.
 *   - the `groups` metrics aggregate gains **spread** and **capacity/saturated**.
 *
 * ⚠ The assertions here are on the **projection**, not on the mechanisms — each of
 * those has its own suite (`consensus.test.js`, `groups.test.js`,
 * `cooperation.test.js`, `association.test.js`) and a projection test that re-proved
 * them would fail for two unrelated reasons. Where a live demo carries the state
 * densely enough to be reliable (a consensus is held by ~300 wildebeest and buffalo,
 * a rally by a handful) the value is read off a real run; where it is rare by
 * construction (a pursuit fires ~25 ticks in 4000, and not at all before tick 2300)
 * the field is set directly and the mechanism's own suite is cited.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS } from '../src/simulation/config/species/index.js';
import { GroupSystem } from '../src/simulation/systems/GroupSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { computeMetrics } from '../src/simulation/metrics/metrics.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';
import fullSnapshotFixture from '../src/renderer/fixtures/example-full-snapshot.json' with { type: 'json' };
import deltaFixture from '../src/renderer/fixtures/example-delta.json' with { type: 'json' };
import eventsFixture from '../src/renderer/fixtures/example-events.json' with { type: 'json' };

const SEED = 42;

/**
 * A band-forming species declared entirely in data — the same idiom
 * `groups.test.js` uses, and for the same reason: a group mechanism that only
 * works for a shipped species is not a group mechanism.
 *
 * `leadAgeWeight: 0.5` is deliberately **neither 0 nor 1 nor a value that
 * saturates anything**: at 0 `leadershipOf` is `dominanceOf` exactly and the
 * seniority term could be deleted with every test still green, and at 1 the term
 * is indistinguishable from any other multiply of the same sign. At 0.5 a
 * senescent animal scores 0.85 × 1.5 = 1.275 against a prime adult's 1.0 — the
 * ordering `dominanceOf` gets backwards is *reversed* rather than softened, and
 * deleting the term flips the answer.
 */
const BAND = Object.freeze({
  id: 'test.band',
  kind: 'animal',
  diet: 'herbivore',
  preySpeciesIds: Object.freeze([]),
  bodyMass: 40,
  baseSpeed: 1.2,
  maxEnergy: 120,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 8 }),
  comfortMin: 0,
  comfortMax: 30,
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 0, dispersalTicks: 500 }),
  groups: Object.freeze({ forms: true, joinRadius: 8, maxMembers: 6, minMembers: 2, leavingSex: Sexes.MALE }),
  behavior: Object.freeze({ leadAgeWeight: 0.5 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/** The same animal whose societies do *not* follow their elders — the control arm. */
const PEERS = Object.freeze({ ...BAND, id: 'test.peers', behavior: Object.freeze({}) });

function neutralGenome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

function sandbox({ seed = 5, config = {}, species = [BAND] } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 64, height: 64 }, terrain: { ...FLAT_TERRAIN }, ...config },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...species], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  engine.registerSystem(new PerceptionSystem(engine.config.perception));
  engine.registerSystem(new GroupSystem(engine.config.groups));
  return engine;
}

function spawn(engine, { speciesId = BAND.id, ...overrides } = {}) {
  const species = engine.species.require(speciesId);
  const genome = neutralGenome();
  const id = engine.world.entities.queueSpawn({
    kind: 'animal',
    speciesId,
    heading: 0,
    lifeStage: 'adult',
    sex: Sexes.FEMALE,
    genome,
    traits: expressGenome(genome),
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
    x: 20,
    y: 20,
    ...overrides,
  });
  engine.applyDeferredEntityChanges(0);
  return id;
}

describe('protocol v34: the version, the renderer, and the fixtures', () => {
  test('all three moved together, asserted against the live constants', () => {
    // ⚠ D31, and against the *constants* rather than literals: the v29 bump
    // shipped this comparison written against itself, and a stale renderer plus
    // three stale fixtures sailed through it.
    assert.ok(
      PROTOCOL_VERSION >= 34,
      `the social inspection blocks shipped at v34, protocol is at ${PROTOCOL_VERSION}`,
    );
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks the current protocol');
    for (const [name, fixture] of Object.entries({ fullSnapshotFixture, deltaFixture, eventsFixture })) {
      assert.equal(fixture.protocolVersion, PROTOCOL_VERSION, `${name} was regenerated for this version`);
    }
  });
});

describe('v34 inspection: a group’s centre and its leader are derived on read', () => {
  test('the centre is the plain mean of its living members, hand-checked', () => {
    const engine = sandbox();
    const ids = [spawn(engine, { x: 20, y: 20 }), spawn(engine, { x: 24, y: 20 }), spawn(engine, { x: 22, y: 26 })];
    engine.step(2);
    const record = engine.world.groups.all()[0];
    assert.ok(record, 'the three of them founded one band');
    assert.equal(record.memberIds.length, 3);
    const details = engine.getEntityDetails(ids[0]);
    const members = record.memberIds.map((id) => engine.world.entities.get(id));
    const expectedX = members.reduce((sum, m) => sum + m.x, 0) / members.length;
    const expectedY = members.reduce((sum, m) => sum + m.y, 0) / members.length;
    assert.ok(details.group.centre, 'the block carries a centre');
    assert.equal(details.group.centre.x, expectedX);
    assert.equal(details.group.centre.y, expectedY);
  });

  test('⚠⚠ the centre survives the rally being switched off, because it is not read out of world.groupCentres', () => {
    // The trap this block exists to avoid. `world.groupCentres` is rebuilt by
    // `GroupSystem#rally` and **only** when `config.groups.rallyEnabled`, so a
    // block that read it would report null for every group in the suite's own
    // rally control arm — a mechanism switch silently deleting an unrelated
    // observation. Both arms are asserted, because "it works with the rally on"
    // is what a version that read the map would also say.
    for (const rallyEnabled of [true, false]) {
      const engine = sandbox({ config: { groups: { rallyEnabled } } });
      spawn(engine, { x: 20, y: 20 });
      spawn(engine, { x: 23, y: 21 });
      engine.step(2);
      const record = engine.world.groups.all()[0];
      assert.ok(record, `a band forms with rallyEnabled=${rallyEnabled}`);
      assert.equal(
        engine.world.groupCentres.size,
        rallyEnabled ? 1 : 0,
        `the rally map is populated only when the rally runs (rallyEnabled=${rallyEnabled})`,
      );
      const centre = engine.getEntityDetails(record.memberIds[0]).group.centre;
      assert.ok(centre, `inspection still reports a centre with rallyEnabled=${rallyEnabled}`);
      assert.ok(Number.isFinite(centre.x) && Number.isFinite(centre.y));
    }
  });

  test('a member that died this tick is not averaged into where the band is', () => {
    // A record is reconciled once per tick, so a body can still be listed. Its
    // position is where the band *was*, and averaging it in would report the past.
    const engine = sandbox();
    const ids = [spawn(engine, { x: 20, y: 20 }), spawn(engine, { x: 20, y: 20 }), spawn(engine, { x: 22, y: 20 })];
    engine.step(2);
    const record = engine.world.groups.all()[0];
    assert.ok(record.memberIds.includes(ids[2]), 'all three enrolled while they were together');
    // Now walk the third one away. Membership survives separation — that is the
    // whole claim the registry makes — so it is still listed and still moves the
    // centre, right up until it stops being alive.
    const wanderer = engine.world.entities.get(ids[2]);
    engine.world.moveEntity(wanderer, 60, 20);
    const before = engine.getEntityDetails(ids[0]).group.centre;
    assert.ok(before.x > 20, 'a separated member still counts toward where its band is');
    const corpse = engine.world.entities.get(ids[2]);
    corpse.alive = false;
    corpse.kind = 'carcass';
    const after = engine.getEntityDetails(ids[0]).group.centre;
    assert.equal(after.x, 20, 'the centre is the two living members');
    assert.equal(after.y, 20);
    assert.ok(after.x < before.x, 'and the body was genuinely pulling it before');
  });

  test('leaderId is the strongest member, and a species that follows its elders picks the old cow', () => {
    // Two identical bodies, one prime adult and one senescent. `dominanceOf`
    // discounts the senescent one to 0.85 — right for a shoving match, backwards
    // for who a herd follows — so this is the assertion that `leadershipOf`'s
    // seniority term is actually being spent here. ⚠ Delete the term and the
    // `test.band` arm returns the adult, which is the mutation this pins.
    const engine = sandbox({ species: [BAND, PEERS] });
    for (const speciesId of [BAND.id, PEERS.id]) {
      const prime = spawn(engine, { speciesId, x: 30, y: 30, lifeStage: 'adult' });
      const elder = spawn(engine, { speciesId, x: 32, y: 30, lifeStage: 'senescent' });
      engine.step(2);
      const details = engine.getEntityDetails(prime);
      assert.ok(details.group, `${speciesId} founded a band`);
      const expected = speciesId === BAND.id ? elder : prime;
      assert.equal(
        details.group.leaderId,
        expected,
        speciesId === BAND.id
          ? 'a species declaring leadAgeWeight follows the senescent animal'
          : 'a species declaring none follows the prime adult, exactly as dominanceOf orders them',
      );
    }
  });

  test('nothing is stored: inspecting every animal leaves the world byte-identical', () => {
    // The derived-on-read claim, asserted rather than commented. ⚠ Compared as
    // strings, never `deepEqual`, which exhausts a 4 GB heap on two entity graphs.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(300);
    const before = JSON.stringify(captureSimulationState(engine));
    let inspected = 0;
    for (const entity of [...engine.world.entities.all()]) {
      const details = engine.getEntityDetails(entity.id);
      assert.ok(details, `entity ${entity.id} is inspectable`);
      inspected += 1;
    }
    assert.ok(inspected > 100, 'there was a world to walk');
    assert.equal(JSON.stringify(captureSimulationState(engine)), before, 'inspection wrote nothing');
  });
});

describe('v34 inspection: the commitments that outlive their cue', () => {
  test('social.consensus reports the heading, the deadline, and the label it was made in', () => {
    // Read off a real run: the demo's wildebeest and buffalo declare
    // `consensusWeight`, and ~300 animals hold a live commitment at any moment, so
    // this is dense state rather than a rare event fished for in a window.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(600);
    const committed = [...engine.world.entities.all()]
      
      .filter((entity) => entity.kind === 'animal' && entity.alive && entity.herdHeading !== null);
    assert.ok(committed.length > 20, `the demo holds live consensus commitments (found ${committed.length})`);
    for (const entity of committed.slice(0, 25)) {
      const consensus = engine.getEntityDetails(entity.id).social.consensus;
      assert.ok(consensus, `entity ${entity.id} holds a commitment and reports one`);
      assert.equal(consensus.heading, entity.herdHeading);
      assert.equal(consensus.strength, entity.herdStrength);
      assert.equal(consensus.until, entity.herdCommitUntil);
      // ⚠ The fourth field, and the one a reader would otherwise have to infer: a
      // commitment is made *in* a herd, so an animal that has since walked into
      // another one is being steered by a heading its current herd never agreed.
      // With `social.groupId` beside it that is visible as a disagreement.
      assert.equal(consensus.label, entity.herdCommitLabel);
      assert.ok(Number.isFinite(consensus.heading), 'a heading, not a NaN');
    }
    const uncommitted = [...engine.world.entities.all()]
      
      .find((entity) => entity.kind === 'animal' && entity.alive && entity.herdHeading === null);
    assert.ok(uncommitted, 'six of the eight species declare no consensusWeight at all');
    assert.equal(engine.getEntityDetails(uncommitted.id).social.consensus, null, 'and they report null, not zeroes');
  });

  test('a commitment held over from a herd the animal has left is visible as a disagreement', () => {
    const engine = sandbox();
    const id = spawn(engine, { x: 20, y: 20 });
    engine.step(1);
    const entity = engine.world.entities.get(id);
    entity.groupId = 7;
    entity.herdHeading = 1.25;
    entity.herdStrength = 0.4;
    entity.herdCommitUntil = 500;
    entity.herdCommitLabel = 3;
    const social = engine.getEntityDetails(id).social;
    assert.equal(social.groupId, 7, 'the herd it is standing in');
    assert.equal(social.consensus.label, 3, 'the herd it agreed with');
    assert.notEqual(social.consensus.label, social.groupId, 'and the two disagreeing is the readable fact');
  });

  test('social.charge reports a pursuit, which is the one state nothing else can show', () => {
    // ⚠ Set directly, deliberately. A pursuit fires ~25 ticks in 4000 in the demo
    // and not at all before tick ~2300 (P9's own measurement), so a test that
    // waited for one would be a slow way to be flaky. That the fields are
    // *written* is `cooperation.test.js`'s 14 assertions; this is that they are
    // *projected* — and it matters precisely because `defendingId` has already
    // gone null by the time a pursuit is what is happening.
    const engine = sandbox();
    const id = spawn(engine);
    engine.step(1);
    const entity = engine.world.entities.get(id);
    assert.equal(engine.getEntityDetails(id).social.charge, null, 'no commitment, no block');
    entity.defendUntil = 42;
    entity.defendThreatX = 11.5;
    entity.defendThreatY = 8.25;
    const charge = engine.getEntityDetails(id).social.charge;
    assert.deepEqual(charge, { until: 42, threat: { x: 11.5, y: 8.25 } });
    assert.equal(engine.getEntityDetails(id).social.defendingId, null, 'and the ward is already gone, which is the point');
  });

  test('social.rally reports the drift back to a lost band, and nearby.bandmates is the gate that decided it', () => {
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(600);
    const separated = [...engine.world.entities.all()]
      
      .filter((entity) => entity.kind === 'animal' && entity.alive && entity.rallyHeading !== null);
    assert.ok(separated.length > 0, `somebody has lost contact with its band (found ${separated.length})`);
    for (const entity of separated) {
      const social = engine.getEntityDetails(entity.id).social;
      assert.equal(social.rally.heading, entity.rallyHeading);
      assert.equal(social.rally.strength, entity.rallyStrength);
      // The gate `GroupSystem` reads: a rally is written only for a member with no
      // bandmate contributing to its centroid, so the two fields agree by
      // construction and a reader can see *why* the drift exists.
      assert.equal(social.nearby.bandmates, 0, 'a rallying animal has no bandmate in its centroid');
    }
    const together = [...engine.world.entities.all()]
      
      .find((entity) => entity.kind === 'animal' && entity.alive && engine.world.social.get(entity.id)?.bandmates > 0);
    assert.ok(together, 'and most band members are with their band');
    const socialTogether = engine.getEntityDetails(together.id).social;
    assert.equal(socialTogether.rally, null, 'who therefore has no rally drift');
    assert.ok(socialTogether.nearby.bandmates > 0);
  });
});

describe('v34 inspection: the pull scale a herd distance is divided by', () => {
  test('an animal standing alone reports exactly 1, not NaN', () => {
    // ⚠ The guard `SocialSystem` publishes and the reason it is load-bearing:
    // `0 / 0` is NaN, NaN loses every `argmaxUtility` comparison, and `herd` would
    // be silently never chosen again with nothing anywhere throwing. Through the
    // projection the symptom would be `pullScale: null`, so this is where a
    // regression would be *seen*.
    const engine = sandbox();
    const id = spawn(engine, { x: 10, y: 10 });
    engine.step(2);
    const nearby = engine.getEntityDetails(id).social.nearby;
    if (nearby) assert.equal(nearby.pullScale, 1, 'the unit, for an animal with nobody to hold to');
  });

  test('a declared pull is projected as itself, and every demo animal reports a finite one', () => {
    const engine = sandbox();
    const id = spawn(engine, { x: 20, y: 20 });
    engine.step(1);
    const summary = engine.world.social.get(id);
    if (summary) engine.world.social.set(id, { ...summary, pullScale: 0.55 });
    const projected = engine.getEntityDetails(id).social.nearby;
    if (projected) assert.equal(projected.pullScale, 0.55, 'projected as itself, not rounded or clamped');

    const demo = createDemoSimulation({ seed: SEED });
    demo.step(300);
    let seen = 0;
    for (const entity of [...demo.world.entities.all()]) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const nearby = demo.getEntityDetails(entity.id).social.nearby;
      if (!nearby) continue;
      seen += 1;
      assert.ok(
        Number.isFinite(nearby.pullScale) && nearby.pullScale > 0,
        `entity ${entity.id} reports pullScale ${nearby.pullScale}`,
      );
    }
    assert.ok(seen > 100, 'over a real population');
  });
});

describe('v34 metrics: band spread, and the cap that used to be silent', () => {
  test('spread is the mean member distance from its own record’s centre, hand-checked', () => {
    const engine = sandbox();
    spawn(engine, { x: 30, y: 30 });
    spawn(engine, { x: 34, y: 30 });
    engine.step(2);
    const report = computeMetrics(engine.world, { tick: engine.clock.tick, windowTicks: 500 });
    assert.equal(report.groups.count, 1);
    // Two animals four apart: the centre is between them and each is 2 away.
    assert.equal(report.groups.spread.count, 1, 'one record contributed a spread');
    assert.ok(Math.abs(report.groups.spread.mean - 2) < 1e-9, `mean spread is 2, got ${report.groups.spread.mean}`);
  });

  test('a tight band and a scattered one report different cohesion, which is the whole point', () => {
    const engine = sandbox();
    // Two records that cannot see each other, one packed and one strung out.
    spawn(engine, { x: 10, y: 10 });
    spawn(engine, { x: 11, y: 10 });
    spawn(engine, { x: 50, y: 50 });
    spawn(engine, { x: 56, y: 50 });
    engine.step(2);
    assert.equal(engine.world.groups.size, 2, 'two separate bands');
    const report = computeMetrics(engine.world, { tick: engine.clock.tick, windowTicks: 500 });
    assert.equal(report.groups.spread.count, 2);
    assert.ok(Math.abs(report.groups.spread.min - 0.5) < 1e-9, `the packed band, got ${report.groups.spread.min}`);
    assert.ok(Math.abs(report.groups.spread.max - 3) < 1e-9, `the strung-out one, got ${report.groups.spread.max}`);
    assert.ok(report.groups.spread.stdev > 0, 'and the two are distinguishable');
  });

  test('a record of one is not counted as a spread of zero', () => {
    // Records do sit at one member — `dissolveGraceTicks` holds a short one for 300
    // ticks on purpose — and the distance of an animal from itself is not a
    // cohesion reading. Counting it would drag the mean toward zero exactly when
    // bands are falling apart.
    const engine = sandbox();
    const ids = [spawn(engine, { x: 30, y: 30 }), spawn(engine, { x: 33, y: 30 })];
    engine.step(2);
    const record = engine.world.groups.all()[0];
    assert.equal(record.memberIds.length, 2);
    const corpse = engine.world.entities.get(ids[1]);
    corpse.alive = false;
    corpse.kind = 'carcass';
    const report = computeMetrics(engine.world, { tick: engine.clock.tick, windowTicks: 500 });
    assert.equal(report.groups.count, 1, 'the record still exists — it is on the grace clock');
    assert.equal(report.groups.spread.count, 0, 'but it contributes no spread');
    assert.equal(report.groups.spread.mean, null, 'and an empty sample reports null rather than 0');
  });

  test('⚠ the store’s capacity and saturation are reported, so a bound cap looks like one', () => {
    // The open thread P5b left: at the cap `found()` returns null with no event, no
    // metric and no log, so a bound that binds looks like the feature
    // intermittently not working. Asserted in both arms — a cap that never reads
    // `true` would be a flag nobody could trust.
    const roomy = sandbox();
    spawn(roomy, { x: 30, y: 30 });
    spawn(roomy, { x: 33, y: 30 });
    roomy.step(2);
    const spacious = computeMetrics(roomy.world, { tick: roomy.clock.tick, windowTicks: 500 });
    assert.equal(spacious.groups.capacity, roomy.world.groups.maxGroups);
    assert.ok(spacious.groups.count < spacious.groups.capacity);
    assert.equal(spacious.groups.saturated, false);

    const full = sandbox({ config: { groups: { maxGroups: 1 } } });
    spawn(full, { x: 10, y: 10 });
    spawn(full, { x: 11, y: 10 });
    spawn(full, { x: 50, y: 50 });
    spawn(full, { x: 51, y: 50 });
    full.step(2);
    const bound = computeMetrics(full.world, { tick: full.clock.tick, windowTicks: 500 });
    assert.equal(bound.groups.capacity, 1);
    assert.equal(bound.groups.count, 1, 'the second band was refused, silently, exactly as documented');
    assert.equal(bound.groups.saturated, true, 'and the refusal is now visible in one number');
  });

  test('the aggregate still enumerates nobody', () => {
    // §11: aggregates only. A membership list here would be the per-organism
    // record the observation roadmap rules out, and the inspector already answers
    // the one-animal question.
    const engine = createDemoSimulation({ seed: SEED });
    engine.step(200);
    const report = computeMetrics(engine.world, { tick: engine.clock.tick, windowTicks: 500 });
    const json = JSON.stringify(report.groups);
    assert.ok(!json.includes('memberIds'), 'no roster');
    assert.ok(report.groups.count > 0, 'over a world that really has records');
    assert.ok(report.groups.spread.mean > 0, 'and a real spread');
  });
});
