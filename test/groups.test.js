/**
 * Persistent social groups (PLAN-SPECIES.md §3.8, phase 3).
 *
 * Most of this suite **invents** a clan-forming species and runs it through a
 * real engine — exactly as the species schema proves itself by inventing a
 * browser. That is the honest test of the claim: the mechanism has to work for a
 * species declared entirely in data, or it is not a species mechanism. It was
 * also, from phase 3 to phase 6, the *only* way to test it, because nothing
 * shipped declared `groups.forms`.
 *
 * ⚠ **That changed on 2026-07-29**: the hyena (phase 7) is the first shipped
 * species to form clans, so the last group of tests below asserts the mechanism
 * in the **demo world** rather than in a sandbox — clans founded, membership
 * outliving the herd label, and carcasses taken off their holders.
 *
 * The assertions are on the **mechanism**, never on a population outcome (D1):
 * a record founded, a member joined, a membership that outlived a separation,
 * a group that dissolved when its members died. A registry that quietly never
 * founded a second clan would sail through any survival gate, which is why
 * PLAN-SPECIES.md §9 asks for exactly these to be asserted directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { GroupRegistry, groupsOf } from '../src/simulation/world/GroupRegistry.js';
import { GroupSystem } from '../src/simulation/systems/GroupSystem.js';
import { SocialSystem } from '../src/simulation/systems/SocialSystem.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../src/simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../src/simulation/systems/MovementSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { createDemoSimulation, restoreDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  captureSimulationState,
  restoreSimulationState,
  SAVE_FORMAT_VERSION,
} from '../src/simulation/persistence/SimulationSerializer.js';
import { FLAT_TERRAIN } from './helpers/flatTerrain.js';

const CONFIG = new SimulationEngine().config;

/**
 * A species that forms clans — declared here, in data, with no engine change of
 * any kind. Everything it does not state falls back to the config, so the file
 * reads as a list of what makes this animal unusual, which is one item.
 */
const CLAN = Object.freeze({
  id: 'test.clan',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze([]),
  bodyMass: 40,
  baseSpeed: 1.2,
  maxEnergy: 120,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  // Reaches at least as far as `joinRadius`, so the shared neighbourhood buffer
  // is usable. `SOLO_SIGHTED` below deliberately does not, to exercise the
  // grid-query fallback.
  perception: Object.freeze({ radius: 8 }),
  comfortMin: 0,
  comfortMax: 30,
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 0, dispersalTicks: 500 }),
  groups: Object.freeze({ forms: true, joinRadius: 6, maxMembers: 4, minMembers: 2, leavingSex: Sexes.MALE }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1 }),
});

/** The same animal, but too short-sighted to reuse perception's neighbour walk. */
const SHORT_SIGHTED = Object.freeze({ ...CLAN, id: 'test.myopic', perception: Object.freeze({ radius: 3 }) });

/** The same animal with clan formation switched off — the control. */
const LONER = Object.freeze({ ...CLAN, id: 'test.loner', groups: Object.freeze({ forms: false }) });

const GRAZER = getSpecies('herbivore.gazelle');

function neutralGenome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/**
 * Teach one engine about an invented species.
 *
 * The roster is a static import list by design (§1.4 A50 — runtime species
 * authoring is out of scope), so a test that wants a species the demo does not
 * ship replaces the engine's resolved registry. Both handles are set because
 * they are meant to be the same object: systems read `world.species`, and
 * setup/serialization read `engine.species`.
 */
function withSpecies(engine, ...definitions) {
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...definitions], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  return registry;
}

function sandbox({ seed = 5, config = {}, species = [CLAN], systems = true } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: {
      world: { width: 64, height: 64 },
      terrain: { ...FLAT_TERRAIN },
      ...config,
    },
  });
  withSpecies(engine, ...species);
  if (systems) {
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    engine.registerSystem(new GroupSystem(engine.config.groups));
  }
  return engine;
}

function spawn(engine, { speciesId = CLAN.id, ...overrides } = {}) {
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

/** The one record in the world, asserted to be the only one. */
function soleGroup(engine) {
  const all = engine.world.groups.all();
  assert.equal(all.length, 1, `exactly one group exists (found ${all.length})`);
  return all[0];
}

const entity = (engine, id) => engine.world.entities.get(id);

describe('group registry: the bounded store', () => {
  test('founding keeps members ascending and hands out monotonic ids', () => {
    const registry = new GroupRegistry({ maxGroups: 4 });
    const first = registry.found('a', [9, 3, 7], 100);
    assert.deepEqual(first.memberIds, [3, 7, 9], 'members are ascending, whatever order they arrived in');
    assert.equal(first.founderId, 3);
    assert.equal(first.foundedTick, 100);
    const second = registry.found('a', [11, 12], 101);
    assert.ok(second.id > first.id, 'ids climb');
    assert.deepEqual(
      registry.all().map((r) => r.id),
      [first.id, second.id],
      'and iteration is by ascending id',
    );
  });

  test('a dissolved id is never reused', () => {
    // The same discipline as entity ids (invariant 12), and it is what makes a
    // stale reference safe: it can resolve to nothing, never to the wrong clan.
    const registry = new GroupRegistry();
    const first = registry.found('a', [1, 2], 0);
    registry.dissolve(first.id);
    const second = registry.found('a', [3, 4], 1);
    assert.notEqual(second.id, first.id);
    assert.equal(registry.get(first.id), null, 'the old id resolves to nothing at all');
  });

  test('a full store refuses to found rather than evicting a living group', () => {
    // ⚠ The stated-limit rule. Evicting would silently delete a group whose
    // members are all still walking around — the failure the tombstone
    // registry's `forgotten` exists to avoid.
    const registry = new GroupRegistry({ maxGroups: 2 });
    const kept = registry.found('a', [1, 2], 0);
    registry.found('a', [3, 4], 0);
    assert.equal(registry.full, true);
    assert.equal(registry.found('a', [5, 6], 0), null, 'refused');
    assert.equal(registry.size, 2);
    assert.notEqual(registry.get(kept.id), null, 'and the existing group is untouched');
  });

  test('join respects the member cap and keeps the list sorted', () => {
    const registry = new GroupRegistry();
    const record = registry.found('a', [5], 0);
    assert.equal(registry.join(record.id, 2, 3), true);
    assert.equal(registry.join(record.id, 9, 3), true);
    assert.deepEqual(record.memberIds, [2, 5, 9]);
    assert.equal(registry.join(record.id, 11, 3), false, 'the cap is a real cap');
    assert.equal(registry.join(record.id, 5, 9), false, 'and nobody joins twice');
  });

  test('prune is how the registry follows the world', () => {
    const registry = new GroupRegistry();
    const record = registry.found('a', [1, 2, 3], 0);
    const dropped = registry.prune(record.id, (id) => id !== 2);
    assert.deepEqual(dropped, [2]);
    assert.deepEqual(record.memberIds, [1, 3]);
  });

  test('serialize/restore round-trips the records and the id counter', () => {
    const registry = new GroupRegistry();
    const first = registry.found('a', [1, 2], 7);
    registry.found('b', [3, 4], 8);
    registry.dissolve(first.id);
    const saved = JSON.parse(JSON.stringify(registry.serialize()));

    const restored = new GroupRegistry();
    restored.restore(saved);
    assert.deepEqual(restored.serialize(), registry.serialize());
    // ⚠ The counter matters as much as the records: a restored registry that
    // restarted at 1 would reissue an id something still refers to.
    assert.ok(restored.found('c', [9], 9).id > first.id, 'the counter survived');
    // And the restored copy is deep: mutating it must not reach back into the
    // save, which is the bug `structuredClone` in the serializer exists for.
    restored.join(restored.ids()[0], 99, 8);
    assert.deepEqual(saved.records[0].memberIds, [3, 4]);
  });

  test('a species that declares no group block forms none', () => {
    assert.equal(groupsOf(getSpecies('herbivore.gazelle'))?.forms, false);
    assert.equal(groupsOf({ id: 'x' }), null, 'silence means no persistent groups');
    assert.equal(groupsOf(null), null);
  });
});

describe('persistent groups: founding, joining, and leaving', () => {
  test('two conspecifics in range found one group, not two', () => {
    const engine = sandbox();
    const a = spawn(engine, { x: 20, y: 20 });
    const b = spawn(engine, { x: 22, y: 20 });
    engine.step(1);

    const group = soleGroup(engine);
    assert.deepEqual(group.memberIds, [a, b].sort((p, q) => p - q));
    assert.equal(group.speciesId, CLAN.id);
    assert.equal(entity(engine, a).groupRecordId, group.id);
    assert.equal(entity(engine, b).groupRecordId, group.id);
  });

  test('two animals too far apart found nothing', () => {
    const engine = sandbox();
    spawn(engine, { x: 5, y: 5 });
    spawn(engine, { x: 40, y: 40 });
    engine.step(5);
    assert.equal(engine.world.groups.size, 0, 'proximity is required to meet');
  });

  test('a newcomer joins the existing group rather than founding a rival', () => {
    const engine = sandbox();
    spawn(engine, { x: 20, y: 20 });
    spawn(engine, { x: 22, y: 20 });
    engine.step(1);
    const c = spawn(engine, { x: 24, y: 20 });
    engine.step(1);

    const group = soleGroup(engine);
    assert.equal(group.memberIds.length, 3);
    assert.equal(entity(engine, c).groupRecordId, group.id);
  });

  test('the member cap holds, and the animal it refuses stays unattached', () => {
    const engine = sandbox();
    // maxMembers is 4 on this species; the fifth animal has nobody unattached
    // in range to found with either, so it simply stays out.
    const ids = [0, 1, 2, 3, 4].map((i) => spawn(engine, { x: 20 + i, y: 20 }));
    engine.step(3);
    const group = soleGroup(engine);
    assert.equal(group.memberIds.length, 4);
    const unattached = ids.filter((id) => entity(engine, id).groupRecordId === null);
    assert.equal(unattached.length, 1, 'exactly one animal is left out');
  });

  test('the grid fallback finds neighbours when perception is too short-sighted', () => {
    // ⚠ Perception's buffer is only usable when its radius reaches at least as
    // far as ours; a shorter list would silently drop neighbours. This species
    // sees 3 and joins at 6, so the fallback query is the only path — and the
    // outcome must be the same.
    const engine = sandbox({ species: [SHORT_SIGHTED] });
    const a = spawn(engine, { speciesId: SHORT_SIGHTED.id, x: 20, y: 20 });
    const b = spawn(engine, { speciesId: SHORT_SIGHTED.id, x: 25, y: 20 });
    engine.step(1);
    const group = soleGroup(engine);
    assert.deepEqual(group.memberIds, [a, b].sort((p, q) => p - q));
  });

  test('⚠ membership survives separation, while the herd label does not', () => {
    // The headline claim, and the one thing a herd label structurally cannot do.
    // Both mechanisms run in this world at once; they are asked the same
    // question after the animals walk apart and give different answers, which is
    // exactly why both exist.
    const engine = sandbox();
    engine.registerSystem(new SocialSystem(engine.config.social));
    // Four, because a herd label needs `minGroupSize` *groupmates* to exist at
    // all — so three must be left behind for the label half of the contrast to
    // still be there after one walks off. That threshold is itself part of the
    // point: a herd can stop existing, and a clan cannot.
    const ids = [0, 1, 2, 3].map((i) => spawn(engine, { x: 20 + i, y: 20 }));
    engine.step(2);

    const group = soleGroup(engine);
    const [stayA, stayB, , leaver] = ids;
    assert.notEqual(entity(engine, stayA).groupId, null, 'they start in one herd');
    assert.equal(entity(engine, stayA).groupId, entity(engine, leaver).groupId);

    // Forty units away: out of sight, out of the herd, still in the clan.
    engine.world.moveEntity(entity(engine, leaver), 20, 60);
    engine.step(10);

    assert.equal(entity(engine, leaver).groupId, null, 'the herd label is gone — a herd is proximity');
    assert.notEqual(entity(engine, stayA).groupId, null, 'the two left behind still have one');
    assert.equal(entity(engine, stayA).groupId, entity(engine, stayB).groupId);

    assert.equal(engine.world.groups.size, 1, 'and the record never noticed');
    assert.deepEqual(engine.world.groups.get(group.id).memberIds, [...ids].sort((p, q) => p - q));
    for (const id of ids) assert.equal(entity(engine, id).groupRecordId, group.id);
  });

  test('two groups that meet stay two groups', () => {
    // Labels merge on contact because a label *is* proximity. A persistent
    // identity that dissolved into whichever clan it walked past would not be
    // persistent, so merging is deliberately not implemented.
    const engine = sandbox();
    const a = spawn(engine, { x: 10, y: 10 });
    const b = spawn(engine, { x: 12, y: 10 });
    const c = spawn(engine, { x: 50, y: 50 });
    const d = spawn(engine, { x: 52, y: 50 });
    engine.step(1);
    assert.equal(engine.world.groups.size, 2);
    const [first, second] = engine.world.groups.all();

    for (const id of [c, d]) engine.world.moveEntity(entity(engine, id), 11, 11);
    engine.step(5);

    assert.equal(engine.world.groups.size, 2, 'still two');
    assert.deepEqual(engine.world.groups.get(first.id).memberIds, [a, b].sort((p, q) => p - q));
    assert.deepEqual(engine.world.groups.get(second.id).memberIds, [c, d].sort((p, q) => p - q));
  });
});

describe('persistent groups: inheritance, dispersal, and dissolution', () => {
  test('a dependent juvenile inherits its guardian’s group', () => {
    // Matrilineal with no sex conditional anywhere: the guardian is the parent
    // that gestated, so descent through the mother falls out of `guardianId`.
    const engine = sandbox();
    const mother = spawn(engine, { x: 20, y: 20 });
    spawn(engine, { x: 22, y: 20 });
    engine.step(1);
    const group = soleGroup(engine);

    const calf = spawn(engine, {
      x: 20.5,
      y: 20,
      lifeStage: 'juvenile',
      guardianId: mother,
      weaned: false,
      sex: Sexes.MALE,
    });
    engine.step(1);
    assert.equal(entity(engine, calf).groupRecordId, group.id, 'born into its mother’s clan');
    assert.equal(engine.world.groups.size, 1, 'and it founded nothing of its own');
  });

  test('a dependent juvenile whose guardian has no group founds nothing', () => {
    const engine = sandbox();
    const mother = spawn(engine, { x: 20, y: 20 });
    const calf = spawn(engine, { x: 20.5, y: 20, lifeStage: 'juvenile', guardianId: mother, weaned: false });
    engine.step(3);
    assert.equal(engine.world.groups.size, 0, 'a dependent does not found with its own guardian');
    assert.equal(entity(engine, calf).groupRecordId, null);
  });

  test('a dispersing male leaves his natal group; a dispersing female stays', () => {
    // Sex-biased natal dispersal costs no new state and no new clock — it is the
    // existing bounded outward walk, filtered by sex, and it is what makes a
    // female-cored group expressible.
    const engine = sandbox();
    const females = [spawn(engine, { x: 20, y: 20 }), spawn(engine, { x: 21, y: 20 })];
    const son = spawn(engine, { x: 22, y: 20, sex: Sexes.MALE });
    engine.step(1);
    const group = soleGroup(engine);
    assert.equal(group.memberIds.length, 3);

    entity(engine, son).dispersalUntil = engine.tick + 200;
    entity(engine, females[1]).dispersalUntil = engine.tick + 200;
    engine.step(1);

    assert.equal(entity(engine, son).groupRecordId, null, 'he walks out');
    assert.equal(entity(engine, females[1]).groupRecordId, group.id, 'she does not');
    assert.deepEqual(engine.world.groups.get(group.id).memberIds, [...females].sort((p, q) => p - q));
  });

  test('⚠ a disperser stays out for his whole walk rather than flapping (A64)', () => {
    // ⚠⚠ The regression test for A64, and the gap it closes is *one tick wide*.
    // The test above steps exactly once and proves he leaves — which he always
    // did. The entire bug lived on the **next** tick, when the ordinary
    // proximity join found him still standing beside the family he had just
    // walked out of and put him straight back, because `isDispersing` is a
    // window and nothing recorded that he had already gone. Leaving was tested;
    // *having left* was not. In the demo that cost 901 membership changes in
    // 2430 ticks for one lion, against its own `dispersalTicks: 900`.
    //
    // This sandbox registers no movement, so he stays at (22,20) beside them for
    // the whole walk — the join is as tempting as it can possibly be.
    const engine = sandbox();
    const females = [spawn(engine, { x: 20, y: 20 }), spawn(engine, { x: 21, y: 20 })];
    const son = spawn(engine, { x: 22, y: 20, sex: Sexes.MALE });
    engine.step(1);
    const group = soleGroup(engine);
    assert.equal(group.memberIds.length, 3);

    entity(engine, son).dispersalUntil = engine.tick + 200;
    let changes = 0;
    let previous = entity(engine, son).groupRecordId;
    for (let i = 0; i < 100; i += 1) {
      engine.step(1);
      const current = entity(engine, son).groupRecordId ?? null;
      if (current !== previous) changes += 1;
      previous = current;
    }

    assert.equal(changes, 1, 'he leaves once — not once every other tick');
    assert.equal(entity(engine, son).groupRecordId, null, 'and is still out at the end of the walk');
    assert.deepEqual(engine.world.groups.get(group.id).memberIds, [...females].sort((p, q) => p - q));
  });

  test('a disperser joins again once his walk is over', () => {
    // The other half, and the reason the fix is a gate on the *window* rather
    // than a permanent mark: dispersal ends, and an animal that has arrived
    // somewhere is an ordinary unattached animal again. Without this the fix
    // would read as "dispersers never group again", which is a different and
    // much worse bug.
    const engine = sandbox();
    spawn(engine, { x: 20, y: 20 });
    spawn(engine, { x: 21, y: 20 });
    const son = spawn(engine, { x: 22, y: 20, sex: Sexes.MALE });
    engine.step(1);
    const group = soleGroup(engine);

    entity(engine, son).dispersalUntil = engine.tick + 10;
    engine.step(5);
    assert.equal(entity(engine, son).groupRecordId, null, 'out while the walk is on');

    engine.step(10); // past `dispersalUntil`
    assert.equal(entity(engine, son).groupRecordId, group.id, 'and back in once it is over');
  });

  test('`groups.rejoinWhileDispersing: true` restores the pre-fix flapping — the measured control', () => {
    // ⚠ D30: an off switch must leave no trace, and the arm A64 was measured
    // against has to stay re-runnable or the measurement cannot be repeated.
    // This pins the control's behaviour so it cannot rot into a no-op switch
    // that quietly reports the fixed world as the control.
    const engine = sandbox({ config: { groups: { rejoinWhileDispersing: true } } });
    spawn(engine, { x: 20, y: 20 });
    spawn(engine, { x: 21, y: 20 });
    const son = spawn(engine, { x: 22, y: 20, sex: Sexes.MALE });
    engine.step(1);
    soleGroup(engine);

    entity(engine, son).dispersalUntil = engine.tick + 200;
    let changes = 0;
    let previous = entity(engine, son).groupRecordId;
    for (let i = 0; i < 20; i += 1) {
      engine.step(1);
      const current = entity(engine, son).groupRecordId ?? null;
      if (current !== previous) changes += 1;
      previous = current;
    }
    assert.ok(changes > 5, `the control flaps (saw ${changes} changes in 20 ticks)`);
  });

  test('`leavingSex: none` keeps everybody', () => {
    const stay = Object.freeze({ ...CLAN, id: 'test.stay', groups: Object.freeze({ ...CLAN.groups, leavingSex: 'none' }) });
    const engine = sandbox({ species: [stay] });
    const a = spawn(engine, { speciesId: stay.id, x: 20, y: 20 });
    const b = spawn(engine, { speciesId: stay.id, x: 21, y: 20, sex: Sexes.MALE });
    engine.step(1);
    const group = soleGroup(engine);
    entity(engine, b).dispersalUntil = engine.tick + 200;
    engine.step(2);
    assert.deepEqual(engine.world.groups.get(group.id).memberIds, [a, b].sort((p, q) => p - q));
  });

  test('a group falling below its minimum dissolves and releases its survivor', () => {
    // ⚠ **At `dissolveGraceTicks: 0`, which is the pre-P5a engine.** The shipped
    // config now holds a short record for a while first (see the hysteresis block
    // below); this test is the control arm, and it is what says the grace is a
    // *delay* rather than a change of rule.
    const engine = sandbox({ config: { groups: { ...CONFIG.groups, dissolveGraceTicks: 0 } } });
    const a = spawn(engine, { x: 20, y: 20 });
    const b = spawn(engine, { x: 21, y: 20 });
    engine.step(1);
    const group = soleGroup(engine);

    entity(engine, b).alive = false;
    engine.step(1);

    assert.equal(engine.world.groups.get(group.id), null, 'a clan of one is not a clan');
    assert.equal(engine.world.groups.size, 0);
    assert.equal(entity(engine, a).groupRecordId, null, 'and the survivor is released, not left dangling');
  });

  test('a group whose members are removed outright is reclaimed', () => {
    // The registry follows the world by filtering rather than by being told, so
    // a removal path it has never heard of still cannot leave a phantom clan.
    // ⚠ Grace 0 for the same reason as above — this is about *reclamation*, not
    // about when it happens.
    const engine = sandbox({ config: { groups: { ...CONFIG.groups, dissolveGraceTicks: 0 } } });
    const a = spawn(engine, { x: 20, y: 20 });
    const b = spawn(engine, { x: 21, y: 20 });
    engine.step(1);
    assert.equal(engine.world.groups.size, 1);

    engine.world.entities.queueRemove(a);
    engine.world.entities.queueRemove(b);
    engine.applyDeferredEntityChanges(engine.tick);
    engine.step(1);
    assert.equal(engine.world.groups.size, 0);
  });

  test('a carcass keeps its last membership but is dropped from the roster', () => {
    // Both halves are deliberate: the roster is the living clan, and the body's
    // field is a fact about who it was, exactly as `deathCause` is.
    const engine = sandbox();
    const ids = [0, 1, 2].map((i) => spawn(engine, { x: 20 + i, y: 20 }));
    engine.step(1);
    const group = soleGroup(engine);

    const dead = entity(engine, ids[2]);
    dead.alive = false;
    dead.kind = 'carcass';
    engine.step(1);

    assert.equal(engine.world.groups.get(group.id).memberIds.includes(ids[2]), false, 'off the roster');
    assert.equal(dead.groupRecordId, group.id, 'the body still remembers whose it was');
  });

  test('the store refuses new clans when it is full, and nobody is evicted', () => {
    const engine = sandbox({ config: { groups: { ...CONFIG.groups, maxGroups: 2 } } });
    const pairs = [
      [5, 5],
      [25, 5],
      [45, 5],
    ];
    const ids = pairs.flatMap(([x, y]) => [spawn(engine, { x, y }), spawn(engine, { x: x + 1, y })]);
    engine.step(3);

    assert.equal(engine.world.groups.size, 2, 'the bound holds');
    const unattached = ids.filter((id) => entity(engine, id).groupRecordId === null);
    assert.equal(unattached.length, 2, 'the refused pair stays unattached rather than displacing anyone');
  });
});

describe('persistent groups: the two mechanisms stay apart', () => {
  test('the group system never writes a herd label', () => {
    // Ownership, asserted rather than trusted: run the registry with no social
    // system at all and `groupId` must stay exactly as spawned.
    const engine = sandbox();
    const ids = [0, 1, 2].map((i) => spawn(engine, { x: 20 + i, y: 20 }));
    engine.step(5);
    assert.equal(engine.world.groups.size, 1, 'the records did form');
    for (const id of ids) {
      assert.equal(entity(engine, id).groupId, null, 'and no herd label was invented');
      assert.equal(entity(engine, id).groupHops, null);
    }
  });

  test('the social system never writes a group record', () => {
    const engine = sandbox({ systems: false });
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    engine.registerSystem(new SocialSystem(engine.config.social));
    const ids = [0, 1, 2].map((i) => spawn(engine, { x: 20 + i, y: 20 }));
    engine.step(5);
    assert.notEqual(entity(engine, ids[0]).groupId, null, 'the labels did form');
    assert.equal(engine.world.groups.size, 0, 'and no record was');
    for (const id of ids) assert.equal(entity(engine, id).groupRecordId, null);
  });

  test('⚠ the demo founds real clans, and only the clan-forming species is in one', () => {
    // ⚠ **This test asserted the exact opposite until 2026-07-29**: from phase 3
    // to phase 6 nothing shipped declared `groups.forms`, so the registry was
    // wholly inert and the test said so (DOCS A55). The hyena is the species it
    // was built for, and this is where the mechanism stops being carried by an
    // invented species and starts being exercised by the demo world.
    //
    // PLAN-SPECIES §9 asks for exactly this to be asserted **directly** rather
    // than inferred from a survival number — a registry that quietly never
    // founded a second clan would sail through any population gate.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1500);

    assert.ok(engine.world.groups.size > 0, 'the demo world holds live clans');
    // ⚠ **Asserted against what the roster *declares*, not against a species
    // name** — since 2026-07-30 there are two: the hyena clan and the lion pride
    // (phase 11). Hardcoding "only the hyena" made this fail the moment a second
    // social carnivore shipped, which is the incidental-roster trap D1 records;
    // the invariant is that a record's species opted in and a label-only species
    // never carries one.
    const forming = new Set(engine.species.all().filter((s) => s.groups?.forms).map((s) => s.id));
    assert.ok(forming.size >= 2, 'the roster has more than one group-forming species to keep apart');
    const clans = engine.world.groups.all();
    // ⚠⚠ **This read `memberIds.length >= 2` — "a clan of one is not a clan" —
    // until 2026-08-07, and it was wrong from the day A56 was fixed.**
    // `groups.dissolveGraceTicks: 300` (BEHAVIOR-PLAN P5a, 2026-08-05) exists
    // precisely so that a record held below `minMembers` is *not* destroyed on the
    // spot: without it a pair that drifted apart dissolved on the tick it
    // separated and re-founded on the tick it met again, and an identity that
    // "survives separation" survived it for one tick. So a record of one is a
    // legal, deliberate state for up to 300 ticks, and asserting it can never
    // happen contradicted the mechanism the same repo had just built.
    //
    // It passed for two days by luck — no record on seed 42 happened to be inside
    // its grace window at tick 1500 in the crater world. On `default-small` one
    // is: hyena record 21, one member, below min since tick 1261 with 61 ticks
    // still to run. The claim the test should make is not "never one" but "one
    // only while the grace clock says so", which is what it now asserts.
    const grace = engine.config.groups.dissolveGraceTicks;
    for (const record of clans) {
      assert.ok(forming.has(record.speciesId), `${record.speciesId} declares groups.forms`);
      if (record.memberIds.length >= engine.config.groups.minMembers) continue;
      assert.notEqual(
        record.belowMinSince,
        null,
        `${record.speciesId} record ${record.id} is under strength with no dissolve clock running`,
      );
      const held = engine.clock.tick - record.belowMinSince;
      assert.ok(
        held <= grace,
        `${record.speciesId} record ${record.id} has ${record.memberIds.length} member(s) and has been under strength for ${held} ticks, past the ${grace}-tick grace`,
      );
    }
    // And the grace is a window, not a licence: an under-strength record is the
    // rare exception in a healthy world, never the normal state of the registry.
    const underStrength = clans.filter((r) => r.memberIds.length < engine.config.groups.minMembers).length;
    assert.ok(
      underStrength < clans.length / 2,
      `${underStrength} of ${clans.length} records are under strength — the registry is flapping, not gracing`,
    );
    // Membership belongs to those species alone: no gazelle, buffalo, stalker, or
    // vulture carries a record, which is the half of §3.8 that keeps the two
    // mechanisms apart.
    for (const e of engine.world.entities.all()) {
      if (e.groupRecordId !== null) {
        assert.ok(forming.has(e.speciesId), `${e.speciesId} #${e.id} must not carry a record`);
      }
    }
    // And the herd labels are alive and well beside it — the control that proves
    // the positional mechanism was not disturbed by the record one.
    const labelled = [...engine.world.entities.all()].filter((e) => e.alive && e.groupId !== null);
    assert.ok(labelled.length > 0, 'gazelle are still herding');
  });

  test('⚠ a clan outlives the herd label, in the demo rather than in a sandbox', () => {
    // The claim that justifies the whole registry: a clan is an identity that
    // survives separation, which a positional label cannot represent. The
    // sandbox above proves the mechanism; this proves the *demo* produces it —
    // a live clan whose members no longer share a herd label, i.e. animals the
    // label mechanism has already given up on and the record has not.
    const engine = createDemoSimulation({ seed: 42 });
    let spanning = null;
    for (let t = 0; t < 1500 && !spanning; t += 1) {
      engine.step(1);
      for (const record of engine.world.groups.all()) {
        const labels = new Set(record.memberIds.map((id) => engine.world.entities.get(id)?.groupId));
        if (labels.size > 1) spanning = { tick: engine.tick, id: record.id, labels: [...labels] };
      }
    }
    assert.ok(spanning, 'a clan should at some point span more than one herd label');
  });

  test('kill theft happens in the demo, not only in a two-animal sandbox', () => {
    // The hyena's defining behaviour and the reason it, rather than the lion, is
    // in batch 1: cooperative *hunting* cannot be shown against 30 kg prey, but
    // contested *possession* can, because the contested resource is the carcass.
    //
    // ⚠⚠ **The seed here is a hostage to the demo's trajectory and has now moved
    // twice** (§1.4 D1, and the reason written up beside the identical fish in
    // `protocol-v29.test.js`): this waits for an emergent event, so any behavioural
    // change moves where grazers die and therefore where scavengers meet over a
    // body. P1 pushed seed 42's first theft out past this window and the test moved
    // to seed 2; P3 gave the wildebeest an association with the zebra and pushed
    // **seed 2** out to 1901, while pulling 42 back in. Re-measured 2026-08-05 with
    // P3 landed, first theft by seed: **42→971**, 1→1297, 2→1901, 3→311, 7→392,
    // 13→1355 — every seed thefts, and 8–16 of them inside 3000 ticks.
    //
    // ⚠ Re-measure that row before concluding theft has broken. The failure mode
    // this test has is *late*, never absent, and the two are not the same finding.
    const engine = createDemoSimulation({ seed: 42 });
    let robbed = 0;
    let seq = 0;
    for (let t = 0; t < 1500; t += 1) {
      engine.step(1);
      for (const event of engine.events.since(seq)) {
        seq = Math.max(seq, event.seq);
        if (event.type === 'entity.robbed') robbed += 1;
      }
    }
    assert.ok(robbed > 0, `a carcass should be taken off its holder at least once (saw ${robbed})`);
  });
});

/**
 * BEHAVIOR-PLAN P5a — dissolution hysteresis, closing **A56**.
 *
 * `minMembers: 2` makes a pair a group and a lone animal not one, so a record that
 * lost a member dissolved on that tick and its survivor re-founded on meeting
 * somebody — an identity that "survives separation" surviving it for exactly one
 * tick. A short record now carries `belowMinSince` and is destroyed only if it is
 * *still* short `dissolveGraceTicks` later.
 *
 * ⚠ The two properties that make this a delay rather than a leak are the ones with
 * their own tests here: the clock is **idempotent** (a record that stays short must
 * not keep restarting it, or it never dissolves at all) and it is **cleared on
 * recovery** (a record that comes back to strength and later drops again gets a
 * fresh full grace, not the remains of the old one).
 */
describe('persistent groups: dissolution hysteresis (P5a)', () => {
  const GRACE = 40;
  const held = (seed = 5) => sandbox({ seed, config: { groups: { ...CONFIG.groups, dissolveGraceTicks: GRACE } } });

  /** A pair, founded, with one of them then killed off. Returns the record id. */
  function widowed(engine) {
    const a = spawn(engine, { x: 20, y: 20 });
    const b = spawn(engine, { x: 21, y: 20 });
    engine.step(1);
    const group = soleGroup(engine);
    entity(engine, b).alive = false;
    return { group: group.id, survivor: a };
  }

  test('a record below its minimum is held, and dissolves on the tick the grace expires', () => {
    const engine = held();
    const { group, survivor } = widowed(engine);

    engine.step(1);
    assert.notEqual(engine.world.groups.get(group), null, 'not dissolved on the tick it dropped');
    assert.equal(entity(engine, survivor).groupRecordId, group, 'and the survivor is still a member');
    assert.equal(engine.world.groups.get(group).belowMinSince, engine.tick, 'the clock started');

    engine.step(GRACE - 1);
    assert.notEqual(engine.world.groups.get(group), null, `still held at grace − 1 (tick ${engine.tick})`);

    engine.step(1);
    assert.equal(engine.world.groups.get(group), null, 'and gone on the tick the grace expires');
    assert.equal(entity(engine, survivor).groupRecordId, null, 'the survivor is released, as it always was');
  });

  test('⚠ the clock is idempotent — a record that stays short still dissolves', () => {
    // The failure this guards is the opposite of a leak-free one: if the reconcile
    // pass reset `belowMinSince` every tick it was short, the record would be held
    // **forever** and the store would fill with widows. Stepping well past the
    // grace in one go is what catches it.
    const engine = held();
    const { group } = widowed(engine);
    engine.step(GRACE * 3);
    assert.equal(engine.world.groups.get(group), null, 'a permanent hold is not a grace period');
    assert.equal(engine.world.groups.size, 0);
  });

  test('coming back to strength stops the clock, and a later drop starts a fresh one', () => {
    const engine = held();
    const a = spawn(engine, { x: 20, y: 20 });
    const b = spawn(engine, { x: 21, y: 20 });
    engine.step(1);
    const group = soleGroup(engine).id;

    // Short for most of a grace period, then a third animal walks up and joins.
    entity(engine, b).alive = false;
    engine.step(GRACE - 5);
    assert.equal(engine.world.groups.get(group).belowMinSince !== null, true, 'the clock is running');
    spawn(engine, { x: 21, y: 20 });
    // ⚠ Two ticks, not one: reconcile runs *before* the entity pass, so the tick a
    // newcomer joins is a tick on which the record was still short when it was
    // inspected. The clock stops on the next pass. That ordering is the same one
    // P2's band affinity reads last tick's membership through.
    engine.step(2);
    assert.equal(engine.world.groups.get(group).belowMinSince, null, 'back at strength, the clock stops');

    // It must now survive longer than the *remains* of the first grace would allow.
    const rejoined = engine.world.groups.get(group).memberIds.filter((id) => id !== a);
    for (const id of rejoined) entity(engine, id).alive = false;
    engine.step(1);
    const restarted = engine.world.groups.get(group).belowMinSince;
    assert.equal(restarted, engine.tick, 'the second drop starts its own clock, now');
    engine.step(GRACE - 1);
    assert.notEqual(engine.world.groups.get(group), null, 'and gets a full grace of its own');
    engine.step(1);
    assert.equal(engine.world.groups.get(group), null);
  });

  test('⚠ grace 0 is the pre-P5a engine to the tick, not merely close to it', () => {
    // What makes the mechanism's control arm reproducible: the clock starts and
    // expires on the same tick, so the old dissolution rule is recoverable exactly.
    const engine = sandbox({ config: { groups: { ...CONFIG.groups, dissolveGraceTicks: 0 } } });
    const { group } = widowed(engine);
    engine.step(1);
    assert.equal(engine.world.groups.get(group), null);
  });

  test('belowMinSince round-trips, and a restored world dissolves on the same tick', () => {
    // ⚠ Records serialize **whole** and have no `createEntity` equivalent to
    // default a missing field, so a save that dropped this would restore a record
    // whose clock reads `undefined` — and `tick - undefined` is NaN, which is never
    // past the grace. That record would never dissolve at all. Hence v32.
    const engine = held();
    const { group } = widowed(engine);
    engine.step(3);
    const since = engine.world.groups.get(group).belowMinSince;
    assert.equal(typeof since, 'number');

    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));
    assert.equal(saved.formatVersion, SAVE_FORMAT_VERSION);
    // Rebuilt by hand, in this file's established idiom: the restoring engine has
    // to be taught the invented species before the loader's unknown-species check.
    const restored = new SimulationEngine({
      seed: saved.seed,
      config: saved.config,
      simulationId: saved.simulationId,
    });
    withSpecies(restored, CLAN);
    restored.registerSystem(new PerceptionSystem(restored.config.perception));
    restored.registerSystem(new GroupSystem(restored.config.groups));
    restoreSimulationState(restored, saved);
    assert.equal(restored.world.groups.get(group).belowMinSince, since, 'the clock survived the save');

    // And it expires where it would have: same remaining ticks, both ways.
    engine.step(GRACE - 3);
    restored.step(GRACE - 3);
    assert.notEqual(engine.world.groups.get(group), null);
    assert.equal(restored.world.groups.get(group) === null, false, 'neither has dissolved yet');
    engine.step(1);
    restored.step(1);
    assert.equal(engine.world.groups.get(group), null);
    assert.equal(restored.world.groups.get(group), null, 'and both dissolve on the same tick');
  });
});

/**
 * BEHAVIOR-PLAN P5b/P5c — the store's capacity, and the buffalo's cow–calf core.
 */
describe('persistent groups: capacity and the buffalo core (P5b, P5c)', () => {
  test('⚠ the store is nowhere near full in the demo, and the cap is provable rather than hopeful', () => {
    // At the cap `found()` returns null, `#joinOrFound` returns, and there is **no
    // event, no metric and no log** — a bound that binds does not look like a
    // bound, it looks like the feature intermittently not working. So the headroom
    // is asserted rather than assumed.
    const engine = createDemoSimulation({ seed: 42 });
    let peak = 0;
    for (let t = 0; t < 1500; t += 1) {
      engine.step(1);
      if (engine.world.groups.size > peak) peak = engine.world.groups.size;
    }
    assert.ok(peak > 0, 'the demo founds records at all');
    assert.ok(
      peak < engine.world.groups.maxGroups,
      `peak ${peak} concurrent records against a cap of ${engine.world.groups.maxGroups}`,
    );
    // The bound the raise was argued from: worst case is one record per
    // `minMembers` animals of the forming species.
    let forming = 0;
    const formingIds = new Set(engine.species.all().filter((s) => s.groups?.forms).map((s) => s.id));
    for (const e of engine.world.entities.all()) {
      if (e.kind === 'animal' && e.alive && formingIds.has(e.speciesId)) forming += 1;
    }
    assert.ok(
      engine.world.groups.maxGroups >= Math.ceil(forming / CONFIG.groups.minMembers),
      `the cap (${engine.world.groups.maxGroups}) covers the worst case for ${forming} group-forming animals`,
    );
  });

  test('⚠ raising the cap changed nothing, which is what makes it defensive rather than corrective', () => {
    // 64 → 192 is insurance against a silent failure, not a fix for one: the cap
    // never bound, so the old value produces the identical world. If this ever
    // starts failing, the cap *is* binding and the silence above matters.
    const run = (maxGroups) => {
      const engine = createDemoSimulation({ seed: 42, config: { groups: { ...CONFIG.groups, maxGroups } } });
      engine.step(400);
      return JSON.stringify(captureSimulationState(engine).entities);
    };
    assert.equal(run(64), run(192));
  });

  test('the buffalo declares a core, and its founding herds enrol whole', () => {
    // ⚠ `maxMembers: 16` against `cohort.groupSize: 12`: a founding herd of twelve
    // placed inside `joinRadius` of each other must enrol as **one** record, or the
    // registry looks like it is splitting a herd it never held.
    const engine = createDemoSimulation({ seed: 42 });
    const buffalo = engine.species.require('herbivore.buffalo');
    assert.equal(buffalo.groups.forms, true);
    assert.ok(buffalo.groups.maxMembers >= buffalo.cohort.groupSize, 'the cap fits a founding herd');

    engine.step(2);
    const records = engine.world.groups.all().filter((r) => r.speciesId === 'herbivore.buffalo');
    assert.ok(records.length > 0, 'the buffalo forms records in the demo');
    for (const record of records) {
      assert.ok(record.memberIds.length <= buffalo.groups.maxMembers);
      for (const id of record.memberIds) {
        assert.equal(engine.world.entities.get(id).speciesId, 'herbivore.buffalo', 'a record is single-species');
      }
    }
  });

  test('⚠ the core is matrilineal by construction — a calf takes its guardian’s record', () => {
    // The whole of 5c: `inheritFromGuardian` puts a calf in its guardian's record
    // and the guardian is the parent that gestated, so descent is matrilineal with
    // **no sex conditional anywhere**. Asserted in a sandbox because the demo's
    // buffalo breed too slowly to guarantee a dependent calf at any given tick —
    // 15 births in 9000 ticks, measured 2026-08-05.
    const engine = sandbox();
    const cow = spawn(engine, { x: 20, y: 20 });
    const aunt = spawn(engine, { x: 21, y: 20 });
    engine.step(1);
    const group = soleGroup(engine).id;

    const calf = spawn(engine, { x: 20, y: 20, lifeStage: 'juvenile', bodyMass: 8, guardianId: cow, sex: Sexes.MALE });
    engine.step(1);
    assert.equal(entity(engine, calf).groupRecordId, group, 'the calf is in its mother’s record');
    assert.deepEqual(
      engine.world.groups.get(group).memberIds,
      [cow, aunt, calf].sort((p, q) => p - q),
    );

    // And the bull leaves when it disperses — the other half, and also free: it is
    // `leavingSex` filtering an event that already existed.
    entity(engine, calf).guardianId = null;
    entity(engine, calf).dispersalUntil = engine.tick + 100;
    engine.step(1);
    assert.equal(entity(engine, calf).groupRecordId, null, 'a dispersing male leaves the cow group');
    assert.deepEqual(engine.world.groups.get(group).memberIds, [cow, aunt].sort((p, q) => p - q));
  });

  test('⚠ giving the buffalo a record changed no animal, because nothing reads one yet', () => {
    // The honest scope of 5c. `groupRecordId` is read by carcass possession,
    // cooperative hunting, and P2's band affinity — a herbivore that scavenges
    // nothing, hunts nothing and declares no band affinity is touched by none of
    // them. This is state that P7's rally heading will consume; today it is a
    // roster nobody acts on, exactly as the zebra's was before P2.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(400);
    let attached = 0;
    for (const e of engine.world.entities.all()) {
      if (e.speciesId === 'herbivore.buffalo' && e.alive && e.groupRecordId !== null) attached += 1;
    }
    assert.ok(attached > 0, 'the buffalo really are enrolled');
  });
});

/**
 * BEHAVIOR-PLAN P7 — band rally drift, i.e. reunion.
 *
 * ⚠⚠ **This is the first thing in the world that makes a group record move an
 * animal on its own account.** P2's band affinity re-weights *neighbours*, so it
 * makes a band that is together stay together and can do nothing at all for one
 * that has scattered — there is nobody left in range to weight. This is that other
 * half, and it is the reason the record has existed since phase 3.
 *
 * It writes a **drift, never an action** (the `MigrationSystem` pattern): a fresh
 * `wander` commitment is the one heading in the engine that was going to be
 * arbitrary, so bending it costs nothing that was doing any work. Four phases have
 * recorded what happens to a movement behaviour that competes with foraging.
 *
 * The claims, in the order they are pinned below: it fires only when the band is
 * genuinely out of contact, it is bounded, a **disperser is left alone**, and the
 * pair actually reunites.
 */
describe('persistent groups: band rally drift (P7)', () => {
  /** Perception + social + groups + decision + movement: the whole chain a drift needs. */
  function rallySandbox({ seed = 5, rallyEnabled = true, groups = {} } = {}) {
    const engine = sandbox({
      seed,
      systems: false,
      config: { vegetation: { ...CONFIG.vegetation, initialFraction: 0, growthRate: 0, seedFloor: 0 } },
    });
    engine.registerSystem(new PerceptionSystem(engine.config.perception));
    engine.registerSystem(new SocialSystem(engine.config.social));
    engine.registerSystem(new GroupSystem({ ...engine.config.groups, rallyEnabled, ...groups }));
    engine.registerSystem(
      new DecisionSystem({ ...engine.config.decision, ...engine.config.behavior, foodMinLevel: engine.config.perception.foodMinLevel }),
    );
    engine.registerSystem(new MovementSystem(engine.config.locomotion));
    return engine;
  }

  /** A founded pair, then torn `apart` units apart along +x. */
  function torn(engine, apart) {
    const a = spawn(engine, { x: 40, y: 40 });
    const b = spawn(engine, { x: 42, y: 40 });
    engine.step(2);
    assert.equal(engine.world.groups.size, 1, 'the pair founded a record');
    engine.world.moveEntity(entity(engine, b), 40 + apart, 40);
    return { a, b };
  }

  test('a member standing with its band is not rallying at all', () => {
    const engine = rallySandbox();
    const a = spawn(engine, { x: 40, y: 40 });
    spawn(engine, { x: 42, y: 40 });
    engine.step(3);
    const me = entity(engine, a);
    assert.ok(engine.world.social.get(a).bandmates > 0, 'its bandmate is in range');
    assert.equal(me.rallyHeading, null);
    assert.equal(me.rallyStrength, 0);
  });

  test('a separated member is pointed at its band, and both ends of the pair are', () => {
    const engine = rallySandbox();
    const { a, b } = torn(engine, 20);
    // ⚠ Read the positions *before* the step, not the literals they were spawned
    // at: the pair has already wandered for two ticks. `GroupSystem` runs at
    // priority −8 and movement in the next phase, so the heading it writes is
    // computed from exactly these coordinates — which makes the expectation exact
    // rather than approximate.
    const [A, B] = [entity(engine, a), entity(engine, b)];
    const before = { ax: A.x, ay: A.y, bx: B.x, by: B.y };
    engine.step(1);

    const cx = (before.ax + before.bx) / 2;
    const cy = (before.ay + before.by) / 2;
    assert.equal(engine.world.social.get(a).bandmates, 0, 'out of contact');
    assert.ok(
      Math.abs(A.rallyHeading - Math.atan2(cy - before.ay, cx - before.ax)) < 1e-9,
      'pointed at the centre of its own record',
    );
    // The centre is the midpoint, so the two ends face each other — the whole of
    // what makes this a *reunion* rather than one animal chasing another.
    const opposed = Math.abs(Math.abs(A.rallyHeading - B.rallyHeading) - Math.PI);
    assert.ok(opposed < 1e-9, `the two ends face each other (${A.rallyHeading} vs ${B.rallyHeading})`);
    assert.equal(A.rallyStrength, CONFIG.groups.rallyStrength);
  });

  test('⚠ beyond the range the band is genuinely lost, and nothing is written', () => {
    // Every other drift cue in the engine is bounded by a sense; a heading toward a
    // centre two hundred units away is knowledge no animal has, and mechanically it
    // is A34 in a new suit — an animal walking across the map ignoring forage.
    const engine = rallySandbox({ groups: { rallyRange: 10 } });
    const { a } = torn(engine, 30);
    engine.step(1);
    assert.equal(entity(engine, a).rallyHeading, null, '15 from a centre 10 units of range away');
    assert.equal(entity(engine, a).rallyStrength, 0);
  });

  test('⚠ the drift is cleared the moment the band is back in contact', () => {
    // A field not rewritten on some path outlives its tick — the `entity.flying`
    // lesson. Every animal of a forming species is cleared and then re-set.
    const engine = rallySandbox();
    const { a, b } = torn(engine, 20);
    engine.step(1);
    assert.notEqual(entity(engine, a).rallyHeading, null, 'it was rallying');
    engine.world.moveEntity(entity(engine, b), 41, 40);
    engine.step(2);
    assert.equal(entity(engine, a).rallyHeading, null, 'and stops the moment they are together');
    assert.equal(entity(engine, a).rallyStrength, 0);
  });

  test('⚠⚠ a dispersing animal is left alone — A64 must not be undone at the movement layer', () => {
    // Dispersal wins outright at strength 0.9 and is how a young animal leaves
    // home. A rally blended onto it would drag it back toward the band it is
    // walking out of. ⚠ Counted over 100 ticks rather than asserted on one, which
    // is the test shape whose absence *caused* A64.
    //
    // ⚠⚠ **The disperser here is FEMALE, and that is the entire point of the
    // arrangement.** A mutation that deleted this gate passed the first version of
    // this test, which used a male: under `leavingSex: 'male'` a dispersing male has
    // already left its record in the membership pass, so the rally loop drops it on
    // the `groupRecordId === null` check and never reaches the gate — the gate was
    // unreachable and the test could not tell. The animal the gate actually protects
    // is the one dispersal *keeps*: a dispersing female still holds her membership
    // while walking out of her natal range. Same hazard shape as `MIXER` in
    // `herding.test.js` — only one arrangement can catch it.
    const engine = rallySandbox();
    const { a, b } = torn(engine, 20);
    const disperser = entity(engine, b);
    disperser.sex = Sexes.FEMALE;
    disperser.dispersalUntil = engine.tick + 200;
    let rallied = 0;
    let held = 0;
    for (let i = 0; i < 100; i += 1) {
      engine.step(1);
      if (disperser.rallyStrength > 0 || disperser.rallyHeading !== null) rallied += 1;
      if (disperser.groupRecordId !== null) held += 1;
    }
    assert.equal(rallied, 0, `a disperser never rallies (${rallied} of 100 ticks)`);
    assert.ok(held > 90, `and she kept her membership throughout (${held} of 100 ticks) — the gate was reachable`);

    // ⚠⚠ **And the animal left behind pins the interaction between this phase and
    // P5a**, which is not obvious in either file alone. The disperser's departure
    // takes the record below `minMembers`, and before P5a that record would have
    // dissolved on the next tick and released the survivor. It does not: the grace
    // clock holds it, so the survivor is still a member 100 ticks later — and it
    // still does not rally, because it is now the record's *only* living member,
    // so the centre it would steer at is exactly where it is standing. That is the
    // degenerate case the zero-distance guard exists for, and without the guard it
    // would be `atan2(0, 0)` — a valid-looking heading due east, and a survivor
    // marching off across the map for no reason.
    const survivor = entity(engine, a);
    assert.notEqual(survivor.groupRecordId, null, 'P5a is holding the record rather than dissolving it');
    assert.equal(survivor.rallyHeading, null, 'and a band of one has nowhere to rally to');
  });

  test('⚠⚠ a torn band reunites, and without the drift it mostly does not', () => {
    // The claim the phase exists for. ⚠ Three seeds, because a single-seed
    // reunion measurement is a measurement of the seed: the control arm happens to
    // re-meet by random walk on some of them (2 of 5 in the exploratory run), which
    // is exactly why the assertion is on the *mean* and on the on-arm's
    // consistency rather than on any one pair of numbers.
    const closest = (rallyEnabled, seed) => {
      const engine = rallySandbox({ seed, rallyEnabled });
      const { a, b } = torn(engine, 20);
      let nearest = Infinity;
      for (let i = 0; i < 400; i += 1) {
        engine.step(1);
        const [A, B] = [entity(engine, a), entity(engine, b)];
        if (!A?.alive || !B?.alive) break;
        nearest = Math.min(nearest, Math.hypot(A.x - B.x, A.y - B.y));
      }
      return nearest;
    };
    const seeds = [5, 7, 11];
    const on = seeds.map((seed) => closest(true, seed));
    const off = seeds.map((seed) => closest(false, seed));
    for (const [i, seed] of seeds.entries()) {
      assert.ok(on[i] < CONFIG.groups.joinRadius, `seed ${seed} reunites within join range (${on[i].toFixed(1)})`);
    }
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    assert.ok(
      mean(on) < mean(off),
      `and closer than the control (${mean(on).toFixed(1)} against ${mean(off).toFixed(1)})`,
    );
  });

  test('the world switch writes nothing at all', () => {
    const engine = rallySandbox({ rallyEnabled: false });
    const { a, b } = torn(engine, 20);
    engine.step(5);
    for (const id of [a, b]) {
      assert.equal(entity(engine, id).rallyHeading, null);
      assert.equal(entity(engine, id).rallyStrength, 0);
    }
    assert.equal(engine.world.groupCentres.size, 0, 'and derives no centres');
  });

  test('⚠ the fields default to a heading of null and a strength of zero', () => {
    // The NaN landmine, pinned at its source. `clamp01(undefined)` is `undefined`,
    // which makes `blendHeadings` NaN, which makes `entity.x` NaN **permanently** —
    // the animal then vanishes from every spatial query for the rest of the run.
    const engine = rallySandbox();
    const fresh = entity(engine, spawn(engine, { x: 10, y: 10 }));
    assert.equal(fresh.rallyHeading, null);
    assert.equal(fresh.rallyStrength, 0);
  });

  test('the group centres are transient and never serialized', () => {
    // `GroupRegistry`'s header is explicit that a record holds no centre: where a
    // group *is* changes every tick and is a pure function of where its members
    // are, so a stored one is a cache that can go stale against its own inputs.
    const engine = rallySandbox();
    torn(engine, 20);
    engine.step(2);
    assert.ok(engine.world.groupCentres.size > 0, 'they are derived');
    const saved = captureSimulationState(engine);
    assert.ok(!('groupCentres' in saved), 'and nowhere in the save');
    for (const record of saved.groups.records) {
      assert.ok(!('x' in record) && !('centre' in record), 'a record still has no centre');
    }
  });

  test('⚠ nobody ends up at NaN, asserted across a whole demo rather than a sandbox', () => {
    // The failure mode this phase's NaN path produces is silent and permanent, so
    // it is worth one brute-force sweep of a real world.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(600);
    for (const e of engine.world.entities.all()) {
      if (e.kind !== 'animal') continue;
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `#${e.id} is at (${e.x}, ${e.y})`);
      assert.ok(Number.isFinite(e.rallyStrength), `#${e.id} has a non-finite rally strength`);
      assert.ok(e.rallyHeading === null || Number.isFinite(e.rallyHeading), `#${e.id} has a NaN rally heading`);
    }
  });
});

describe('persistent groups: determinism and persistence', () => {
  test('forming clans changes nothing about the animals, and draws no randomness', () => {
    // The strongest statement of this phase's inertness: the *only* difference
    // between a world whose species forms clans and one whose species does not is
    // the registry itself. Nothing reads membership yet, and this system draws no
    // values, so both worlds must be identical animal for animal and stream for
    // stream — the fixed-draw-budget assertion in its strictest form.
    const build = (definition) => {
      const engine = sandbox({ seed: 17, species: [definition] });
      const speciesId = definition.id;
      for (let i = 0; i < 6; i += 1) spawn(engine, { speciesId, x: 20 + i, y: 20 + (i % 2) });
      engine.step(50);
      return engine;
    };
    const clans = build(CLAN);
    const loners = build(LONER);

    const animals = (engine) =>
      [...engine.world.entities.all()].map((e) => [e.id, e.x, e.y, e.heading, e.energy, e.groupId, e.action]);
    assert.deepEqual(animals(clans), animals(loners), 'the animals are indistinguishable');
    assert.deepEqual(clans.serializeRandomStreams(), loners.serializeRandomStreams(), 'and so are the streams');
    // Two clans, not one: six animals against a `maxMembers` of 4 fills the
    // first and the leftovers found the second, which is the cap doing its job.
    assert.equal(clans.world.groups.size, 2, 'only the registry differs');
    assert.equal(loners.world.groups.size, 0);
  });

  test('two runs with clans are byte-identical', () => {
    const run = () => {
      const engine = sandbox({ seed: 23 });
      for (let i = 0; i < 5; i += 1) spawn(engine, { x: 18 + i, y: 30 });
      engine.step(60);
      return captureSimulationState(engine);
    };
    assert.deepEqual(run(), run());
  });

  test('groups survive save/load, and the run continues identically', () => {
    const engine = sandbox({ seed: 11 });
    for (let i = 0; i < 4; i += 1) spawn(engine, { x: 18 + i, y: 30 });
    engine.step(20);
    assert.equal(engine.world.groups.size, 1, 'there is something to save');

    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));
    assert.equal(saved.formatVersion, SAVE_FORMAT_VERSION);
    assert.equal(saved.groups.records.length, 1, 'the registry is in the save');

    // Rebuilt by hand rather than through `createEngineFromSave`, because the
    // restoring engine has to be taught the invented species before the loader's
    // unknown-species check runs — which is that check doing its job.
    const restored = new SimulationEngine({
      seed: saved.seed,
      config: saved.config,
      simulationId: saved.simulationId,
    });
    withSpecies(restored, CLAN);
    restored.registerSystem(new PerceptionSystem(restored.config.perception));
    restored.registerSystem(new GroupSystem(restored.config.groups));
    restoreSimulationState(restored, saved);

    assert.deepEqual(restored.world.groups.serialize(), engine.world.groups.serialize());

    engine.step(30);
    restored.step(30);
    const summarize = (e) => [
      e.world.groups.serialize(),
      [...e.world.entities.all()].map((en) => [en.id, en.x, en.y, en.groupRecordId]),
    ];
    assert.deepEqual(summarize(restored), summarize(engine), 'a restored clan world continues identically');
  });

  test('a save is refused if the group-forming species is unknown to the loader', () => {
    // §5.8's rule applied to this step: not worried about old saves must mean
    // *fails loudly*, not degrades quietly. An engine that has never heard of
    // `test.clan` would otherwise restore a registry full of records referring to
    // animals whose biology it resolves from global config.
    const engine = sandbox({ seed: 3 });
    spawn(engine, { x: 20, y: 20 });
    spawn(engine, { x: 21, y: 20 });
    engine.step(2);
    const saved = JSON.parse(JSON.stringify(captureSimulationState(engine)));

    const naive = new SimulationEngine({ seed: saved.seed, config: saved.config, simulationId: saved.simulationId });
    naive.registerSystem(new PerceptionSystem(naive.config.perception));
    naive.registerSystem(new GroupSystem(naive.config.groups));
    assert.throws(() => restoreSimulationState(naive, saved), /unknown species/);
  });

  test('the demo save carries real clan records and round-trips them', () => {
    // ⚠ Until 2026-07-29 this asserted `records: []` — the registry was inert in
    // the demo, so the save could only ever prove it *serialized nothing*. With
    // the hyena founding clans, the demo exercises the real path: records with
    // members, written and read back.
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(1500);
    const saved = captureSimulationState(engine);
    assert.ok(saved.groups.records.length > 0, 'the demo save carries clans');
    assert.ok(saved.groups.nextId > 1, 'and the id counter has moved');
    assert.equal(saved.config.groups.enabled, true);
    assert.equal(saved.config.groups.maxGroups, CONFIG.groups.maxGroups);

    const restored = restoreDemoSimulation(saved);
    assert.equal(restored.world.groups.size, engine.world.groups.size);
    assert.deepEqual(
      restored.world.groups.all().map((r) => ({ id: r.id, members: [...r.memberIds] })),
      engine.world.groups.all().map((r) => ({ id: r.id, members: [...r.memberIds] })),
      'membership survives a save/load exactly',
    );
    // The gazelle is the control: it declares `forms: false` explicitly, so the
    // absence is a statement in its file rather than an omission.
    assert.equal(engine.species.require(GRAZER.id).groups.forms, false);
  });
});

describe('persistent groups: the lion is one pride (PREDATOR-PLAN P1)', () => {
  // ⚠⚠ **This is temporary and the tests say so.** Multiple prides and male
  // coalitions come back when there are lion behaviours to support them; until
  // then the world is simpler with one pride, and these assertions are what stops
  // that being a hope. See `config/species/predatorLion.js` for the reasoning.
  //
  // ⚠ **Sandbox, not the demo.** Every claim here is about one system deciding
  // membership, which is the cheapest world that can state it (CLAUDE.md). The
  // *founded* world — one record over the whole roster on tick 1 — is asserted in
  // `test/cohorts.test.js`, which is where founding placement lives.
  const LION = getSpecies('predator.lion');

  test('the three fields that make one pride are all data, and each is load-bearing', () => {
    // Stated as three separate assertions rather than a deepEqual, because each
    // one carries a different half of the mechanism and a reader who finds this
    // failing needs to know which half moved.
    //
    // 1. A cluster larger than any roster ⇒ one anchor ⇒ one record on tick 1.
    assert.ok(LION.cohort.groupSize > 60, 'the founding cluster must exceed any roster');
    // 2. Nothing removes a living member. The config's `'male'` is what made the
    //    pride female-cored, and giving that up is what "temporary" costs.
    assert.equal(LION.groups.leavingSex, 'none');
    assert.notEqual(CONFIG.groups.leavingSex, 'none', 'the world default still disperses a sex');
    // 3. The record has room for the population to grow into. A record at its cap
    //    refuses joiners *silently* (`found()` returns null, nothing is emitted),
    //    so a cap that binds would look like the feature intermittently failing.
    assert.ok(LION.groups.maxMembers >= LION.cohort.groupSize);
    assert.ok(LION.groups.maxMembers <= CONFIG.groups.maxGroups);
  });

  test('a pride keeps every member: cubs inherit it and a dispersing male does not leave', () => {
    // ~4 ticks. The dispersal window is asserted by setting `dispersalUntil`
    // directly rather than by running an animal to maturity: `#dispersingOut`
    // reads exactly that field through `isDispersing`, so a bounded window is the
    // whole of what the membership rule sees, and growing a cub up would spend
    // 2600 ticks to arrive at the same boolean.
    const engine = sandbox({ species: [LION] });
    const founders = [0, 1, 2].map((i) => spawn(engine, { speciesId: LION.id, x: 20 + i, y: 20 }));
    engine.step(1);
    const pride = soleGroup(engine);
    assert.deepEqual([...pride.memberIds], [...founders].sort((a, b) => a - b));

    // A cub takes its guardian's record — `inheritFromGuardian`, the config
    // default, untouched by this phase.
    const cub = spawn(engine, {
      speciesId: LION.id,
      lifeStage: 'juvenile',
      guardianId: founders[0],
      x: 20,
      y: 20,
    });
    engine.step(1);
    assert.equal(entity(engine, cub).groupRecordId, pride.id, 'a cub is born into the pride');

    // ⚠ The half `leavingSex: 'none'` buys. Under the config's `'male'` this
    // animal would leave on the next tick and be barred from rejoining for the
    // whole window (A64); here nothing removes it at all.
    const male = spawn(engine, { speciesId: LION.id, sex: Sexes.MALE, x: 21, y: 20 });
    engine.step(1);
    assert.equal(entity(engine, male).groupRecordId, pride.id);
    entity(engine, male).dispersalUntil = engine.tick + 500;
    engine.step(1);
    assert.equal(entity(engine, male).groupRecordId, pride.id, 'a dispersing male keeps its pride');
    assert.equal(engine.world.groups.all().length, 1, 'and no second pride is founded');
  });

  test('⚠ one pride is the founded world, not an invariant over every history', () => {
    // The honest limit, asserted so it is a known property rather than a
    // surprise: nothing in `GroupSystem` knows this species wants one record.
    // Two lions placed beyond `groups.joinRadius` of each other found two prides,
    // and records never merge (rule 6), so they stay two. This is what the species
    // file means by "an initial condition plus no departures".
    const engine = sandbox({ species: [LION] });
    const near = [0, 1].map((i) => spawn(engine, { speciesId: LION.id, x: 10 + i, y: 10 }));
    const far = [0, 1].map((i) => spawn(engine, { speciesId: LION.id, x: 50 + i, y: 50 }));
    engine.step(1);
    const records = engine.world.groups.all();
    assert.equal(records.length, 2, 'two clusters beyond the join radius are two prides');
    assert.notEqual(entity(engine, near[0]).groupRecordId, entity(engine, far[0]).groupRecordId);
  });
});
