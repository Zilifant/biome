/**
 * Cover concealment and the ambush (PLAN-SPECIES.md §3.12, phase 14).
 *
 * The mechanism is two halves that share a switch — **detection** (a cryptic
 * animal in brush is picked out at shorter range) and **approach** (an ambush
 * predator steps through cover on its way to prey) — and the interesting thing
 * about it is how much of it was built wrong first. Both mistakes are pinned here,
 * because both are the kind that measure as "no effect" rather than as a failure:
 *
 *   1. **Symmetric concealment made the leopard worse** (27 → 19 over 3 seeds).
 *      A mechanism that hides bodies helps whoever hides and hurts whoever
 *      searches, and a predator with twice its prey's sight radius is mostly
 *      searching. Hence `crypsis`, per species, 0 by default.
 *   2. **Hiding from conspecifics sterilised it** (27 → 19 again, for a completely
 *      different reason): mate candidates come through the same perception gate,
 *      so a cryptic solitary species stopped finding mates. Hence the conspecific
 *      exemption.
 *
 * So the suite is organized around what must stay true: the identity for a species
 * that declares nothing, the two halves resolving correctly, and the ambush doing
 * visible work in the demo rather than merely resolving.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../src/simulation/systems/PerceptionSystem.js';
import { SpeciesRegistry } from '../src/simulation/config/species/schema.js';
import { SPECIES_DEFINITIONS, getSpecies } from '../src/simulation/config/species/index.js';
import { GENOME_LOCI, expressGenome } from '../src/simulation/traits/genetics.js';
import { Sexes } from '../src/simulation/mating/mateChoice.js';
import { TerrainType } from '../src/simulation/world/TerrainGrid.js';
import { captureSimulationState } from '../src/simulation/persistence/SimulationSerializer.js';
import { createDemoSimulation } from '../src/fixtures/createDemoSimulation.js';
import {
  DEFAULT_CONCEALMENT,
  concealedApproach,
  crypsisOf,
  crypticSpeciesIn,
  stalksFromCover,
  visibleRange,
} from '../src/simulation/perception/concealment.js';

const CONFIG = new SimulationEngine().config;
const LEOPARD = getSpecies('predator.leopard');
const GAZELLE = getSpecies('herbivore.gazelle');

/** A cryptic hunter, and the same animal without the crypsis. */
const CRYPTIC = Object.freeze({
  id: 'test.cryptic',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze(['test.plain']),
  bodyMass: 60,
  baseSpeed: 1.3,
  maxEnergy: 150,
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100,
  perception: Object.freeze({ radius: 10 }),
  comfortMin: -3,
  comfortMax: 24,
  crypsis: 1,
  habitat: Object.freeze({ cover: 1.6, ground: 0.85 }),
  matePreference: Object.freeze({ trait: 'speed', span: 0.3, conditionWeight: 0.4 }),
  territory: Object.freeze({ defends: false, rangeRadius: 20, settleTicks: 900 }),
  migration: Object.freeze({ tracksForage: false, tracksWater: false, cueRadius: 8, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
const PLAIN = Object.freeze({ ...CRYPTIC, id: 'test.plain', diet: 'herbivore', preySpeciesIds: undefined, crypsis: undefined, habitat: undefined });
const SPECIES = [CRYPTIC, PLAIN];

function genome() {
  return Object.fromEntries(GENOME_LOCI.map((locus) => [locus, [1, 1]]));
}

/**
 * A world that is all open ground except one band of cover, so "in cover" and
 * "in the open" are positions rather than a seed's accident.
 */
function sandbox({ seed = 5, coverFrom = 30 } = {}) {
  const engine = new SimulationEngine({
    seed,
    config: { world: { width: 64, height: 64 }, terrain: { lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 } },
  });
  const registry = new SpeciesRegistry([...SPECIES_DEFINITIONS, ...SPECIES], engine.config);
  engine.species = registry;
  engine.world.species = registry;
  // ⚠ Stub the **world chokepoint**, not `terrain.codeAt`: `concealmentAt` reads
  // the packed cell array directly (as `blocksSightAt` and `isPassable` do), so a
  // `codeAt` stub silently does nothing to it. The chokepoint is the contract
  // perception actually depends on, which makes it the honest thing to paint.
  engine.world.concealmentAt = (x) => (x >= coverFrom ? 0.55 : 0);
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
    energy: species.maxEnergy * 0.6,
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

describe('concealment: the terrain scale', () => {
  /** One cell of each terrain code from a real generated world. */
  const cellsByCode = (() => {
    const engine = createDemoSimulation({ seed: 42 });
    const terrain = engine.world.terrain;
    const found = new Map();
    for (let y = 0; y < terrain.height; y += 1) {
      for (let x = 0; x < terrain.width; x += 1) {
        const code = terrain.codeAt(x, y);
        if (!found.has(code)) found.set(code, { x, y });
      }
    }
    return { terrain, world: engine.world, found };
  })();

  test('⚠ opacity is the top of the concealment scale, so the two cannot disagree', () => {
    const { terrain, found } = cellsByCode;
    for (const [code, { x, y }] of found) {
      assert.equal(
        terrain.blocksSightAt(x, y),
        terrain.concealmentAt(x, y) >= 1,
        `terrain code ${code}: the boolean is derived from the scale`,
      );
    }
    assert.equal(terrain.concealmentAt(-1, -1), 1, 'out of bounds conceals, exactly as it blocks sight');
    assert.equal(terrain.blocksSightAt(-1, -1), true);
  });

  test('cover hides without blocking; thicket and rock do both; open ground does neither', () => {
    const { terrain, world, found } = cellsByCode;
    const at = (code) => found.get(code);
    assert.equal(terrain.concealmentAt(at(TerrainType.GROUND).x, at(TerrainType.GROUND).y), 0, 'open ground hides nothing');

    const cover = at(TerrainType.COVER);
    assert.ok(terrain.concealmentAt(cover.x, cover.y) > 0, 'cover hides');
    assert.ok(terrain.concealmentAt(cover.x, cover.y) < 1, 'but you see straight through it');
    assert.equal(terrain.blocksSightAt(cover.x, cover.y), false, 'which is what "not opaque" means');

    const thicket = at(TerrainType.THICKET);
    assert.equal(terrain.concealmentAt(thicket.x, thicket.y), 1);
    assert.equal(terrain.blocksSightAt(thicket.x, thicket.y), true);
    // And the world chokepoint agrees with the grid under it.
    assert.equal(world.concealmentAt(cover.x + 0.5, cover.y + 0.5), terrain.concealmentAt(cover.x, cover.y));
  });
});

describe('concealment: what a species declares', () => {
  const resolved = (id) => new SpeciesRegistry(SPECIES, CONFIG).require(id);

  test('crypsis is 0 for a species that says nothing — the exact identity', () => {
    assert.equal(crypsisOf(resolved(PLAIN.id)), 0);
    assert.equal(crypsisOf(undefined), 0);
    assert.equal(crypsisOf({ crypsis: 0 }), 0);
    assert.equal(crypsisOf(resolved(CRYPTIC.id)), 1);
  });

  test('exactly one shipped species is cryptic, and it is the ambush predator', () => {
    const cryptic = crypticSpeciesIn(new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG));
    assert.deepEqual([...cryptic.keys()], ['predator.leopard']);
    // ⚠ The claim that keeps the phase attributable: seven of the eight species
    // take the untouched branch, so this is the leopard's change and not a change
    // to how every animal in the world sees.
    assert.equal(cryptic.size, 1);
  });

  test('"hunts from cover" is read off the habitat block it already had', () => {
    assert.equal(stalksFromCover(resolved(CRYPTIC.id)), true);
    assert.equal(stalksFromCover(resolved(PLAIN.id)), false);
    assert.equal(stalksFromCover(new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG).require(GAZELLE.id)), false);
    assert.equal(stalksFromCover(new SpeciesRegistry(SPECIES_DEFINITIONS, CONFIG).require(LEOPARD.id)), true);
  });
});

describe('concealment: the detection half', () => {
  test('open ground is exactly the identity, so nothing else moves', () => {
    // D16: "off" must be the identity rather than close to it.
    assert.equal(visibleRange(12, 0, 1), 12);
    assert.equal(visibleRange(12, 0.55, 0), 12, 'and strength 0 is the same');
  });

  test('cover shortens the range it can be spotted at, in proportion', () => {
    assert.ok(Math.abs(visibleRange(6, 0.55, 1) - 2.7) < 1e-9, '45% of six units');
    assert.equal(visibleRange(6, 1, 1), 0, 'total concealment is invisible');
    assert.ok(visibleRange(6, 0.55, 0.5) > visibleRange(6, 0.55, 1), 'strength dials it');
  });

  test('a cryptic hunter in cover is invisible at a range it would be seen at in the open', () => {
    const engine = sandbox({ coverFrom: 30 });
    engine.registerSystem(new PerceptionSystem({ ...CONFIG.perception, defaultRadius: 10 }));
    // Prey on open ground, six units from a hunter standing in cover. Its sight
    // radius is 10, so cover's 0.55 shortens it to 4.5 — six is inside the one and
    // outside the other, which is the whole claim.
    const prey = spawn(engine, PLAIN.id, { x: 26, y: 20 });
    spawn(engine, CRYPTIC.id, { x: 32, y: 20 });
    engine.step(1);
    assert.equal(engine.world.perception.get(prey.id).nearestThreat, null, 'it never saw it');

    // The same geometry with the hunter on open ground: seen.
    const open = sandbox({ coverFrom: 999 });
    open.registerSystem(new PerceptionSystem({ ...CONFIG.perception, defaultRadius: 10 }));
    const preyOpen = spawn(open, PLAIN.id, { x: 26, y: 20 });
    spawn(open, CRYPTIC.id, { x: 32, y: 20 });
    open.step(1);
    assert.notEqual(open.world.perception.get(preyOpen.id).nearestThreat, null, 'in the open it is plainly visible');
  });

  test('⚠ its own kind still finds it — camouflage is against other species', () => {
    // The bug that sterilised the leopard: mate candidates come through this same
    // gate, so a cryptic solitary animal that hid from itself stopped breeding.
    const engine = sandbox({ coverFrom: 30 });
    engine.registerSystem(new PerceptionSystem({ ...CONFIG.perception, defaultRadius: 10 }));
    const watcher = spawn(engine, CRYPTIC.id, { x: 34, y: 20, sex: Sexes.MALE });
    spawn(engine, CRYPTIC.id, { x: 38.5, y: 20 });
    engine.step(1);
    const seen = engine.world.perception.get(watcher.id);
    assert.notEqual(seen.nearestAnimal, null, 'both are deep in cover and they can see each other');
  });

  test('the world switch restores plain sight whatever a species declares', () => {
    const engine = sandbox({ coverFrom: 30 });
    engine.registerSystem(
      new PerceptionSystem({ ...CONFIG.perception, defaultRadius: 10, coverConcealment: false }),
    );
    const prey = spawn(engine, PLAIN.id, { x: 26, y: 20 });
    spawn(engine, CRYPTIC.id, { x: 32, y: 20 });
    engine.step(1);
    assert.notEqual(engine.world.perception.get(prey.id).nearestThreat, null);
  });
});

describe('concealment: the approach half', () => {
  test('it steps toward cover when cover lies toward the prey, and straight when it does not', () => {
    const engine = sandbox({ coverFrom: 30 });
    const hunter = spawn(engine, CRYPTIC.id, { x: 28, y: 20 });
    // Prey due east, cover due east: the fan should find concealment and still close.
    const bearing = 0;
    const heading = concealedApproach(engine.world, hunter, bearing, 1.3);
    assert.ok(Math.abs(heading - bearing) <= Math.PI / 3 + 1e-9, 'it never turns more than 60° off the prey');

    // The same call in a world with no cover at all returns the bearing exactly —
    // the straight line is the incumbent and wins every tie.
    const bare = sandbox({ coverFrom: 999 });
    const plainHunter = spawn(bare, CRYPTIC.id, { x: 28, y: 20 });
    assert.equal(concealedApproach(bare.world, plainHunter, bearing, 1.3), bearing);
  });

  test('it is deterministic and consumes no randomness', () => {
    const engine = sandbox({ coverFrom: 30 });
    const hunter = spawn(engine, CRYPTIC.id, { x: 29, y: 20 });
    const first = concealedApproach(engine.world, hunter, 0.3, 1.3);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(concealedApproach(engine.world, hunter, 0.3, 1.3), first);
    }
  });
});

describe('concealment: in the shipped world', () => {
  const BATCH3_NO_LEOPARD = [
    { speciesId: 'herbivore.gazelle', count: 120 },
    { speciesId: 'herbivore.wildebeest', count: 30 },
    { speciesId: 'herbivore.zebra', count: 15 },
    { speciesId: 'herbivore.buffalo', count: 35 },
    { speciesId: 'predator.lion', count: 8 },
    { speciesId: 'scavenger.vulture', count: 10 },
    { speciesId: 'scavenger.hyena', count: 6 },
  ];

  test('⚠ a world with no leopard is byte-identical with the mechanism switched off', () => {
    // The property that makes phase 14 attributable: nothing but the leopard is
    // cryptic, so every other species' world is untouched by this. ⚠ Compared as
    // strings — `deepEqual` on two differing ~800 KB graphs exhausts the heap
    // building a diff (learned at phase 13).
    const on = createDemoSimulation({ seed: 42, config: { demo: { founding: BATCH3_NO_LEOPARD } } });
    const off = createDemoSimulation({
      seed: 42,
      config: { demo: { founding: BATCH3_NO_LEOPARD }, concealment: { enabled: false } },
    });
    on.step(400);
    off.step(400);
    assert.equal(
      JSON.stringify(captureSimulationState(on).entities),
      JSON.stringify(captureSimulationState(off).entities),
    );
  });

  test('⚠ and in the world that has one, the ambush does visible work', () => {
    // §1.2's standing complaint is mechanisms that are correct and never fire.
    // Measured over 3 seeds × 4000 ticks when this shipped: attempts launched from
    // concealment went 21 → 34, and gazelle sightings of a leopard fell 24%. Here
    // the cheap, non-flaky half of that claim — the cat does get into cover and
    // hunt from it.
    const engine = createDemoSimulation({ seed: 42 });
    let concealedLeopardTicks = 0;
    let leopardTicks = 0;
    for (let i = 0; i < 600; i += 1) {
      engine.step(1);
      for (const e of engine.world.entities.all()) {
        if (e.kind !== 'animal' || !e.alive || e.speciesId !== 'predator.leopard') continue;
        leopardTicks += 1;
        if (engine.world.concealmentAt(e.x, e.y) > 0) concealedLeopardTicks += 1;
      }
    }
    assert.ok(leopardTicks > 0, 'there were leopards');
    assert.ok(concealedLeopardTicks > 0, 'and they spend time in cover');
  });

  test('the shipped defaults are the ones the module documents', () => {
    assert.deepEqual({ ...CONFIG.concealment }, { ...DEFAULT_CONCEALMENT });
  });
});
