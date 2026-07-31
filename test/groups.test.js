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
      terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 },
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
    const engine = sandbox();
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
    const engine = sandbox();
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
    for (const record of clans) {
      assert.ok(forming.has(record.speciesId), `${record.speciesId} declares groups.forms`);
      assert.ok(record.memberIds.length >= 2, 'a clan of one is not a clan');
    }
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
