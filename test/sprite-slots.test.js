import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeSpriteSlots,
  allSlotIds,
  slotIdForEntity,
  groundSlotAt,
  slotIdForFeature,
  slotIdForDisturbance,
  slotIdForMemory,
  spriteForSlot,
} from '../src/renderer/app/rendering/SpriteSlots.js';
import {
  SPECIES_APPEARANCE,
  KIND_APPEARANCE,
  CARCASS_DECAY_APPEARANCE,
  TERRAIN_APPEARANCE,
  VEGETATION_APPEARANCE,
  FEATURE_APPEARANCE,
  DISTURBANCE_APPEARANCE,
  MEMORY_APPEARANCE,
  DRACULA_COLORS,
  resolveAppearance,
} from '../src/renderer/app/rendering/EntityAppearance.js';
import { groundAppearanceAt } from '../src/renderer/app/rendering/AsciiGridRenderer.js';

function slotById() {
  const map = new Map();
  for (const group of describeSpriteSlots()) {
    for (const slot of group.slots) map.set(slot.slotId, slot);
  }
  return map;
}

describe('sprite slots: registry coverage', () => {
  // The same guarantee the legend tests give: every registry entry reaches the
  // editor, so a species (or terrain, or event of ground) cannot exist without
  // a slot to assign a sprite to.
  test('every species yields young/grown × male/female slots', () => {
    const ids = new Set(allSlotIds());
    for (const speciesId of Object.keys(SPECIES_APPEARANCE)) {
      for (const age of ['young', 'grown']) {
        for (const sex of ['male', 'female']) {
          assert.ok(ids.has(`species:${speciesId}:${age}:${sex}`), `${speciesId} ${age} ${sex}`);
        }
      }
    }
  });

  test('the unmapped-species fallback yields four slots', () => {
    const ids = new Set(allSlotIds());
    for (const age of ['young', 'grown']) {
      for (const sex of ['male', 'female']) {
        assert.ok(ids.has(`kind:animal:${age}:${sex}`));
      }
    }
  });

  test('every carcass decay stage has a slot', () => {
    const ids = new Set(allSlotIds());
    CARCASS_DECAY_APPEARANCE.forEach((_, stage) => {
      assert.ok(ids.has(`carcass:${stage}`), `stage ${stage}`);
    });
  });

  test('every terrain except the unknown fallback has a slot', () => {
    const ids = new Set(allSlotIds());
    for (const name of Object.keys(TERRAIN_APPEARANCE)) {
      if (name === 'unknown') {
        assert.ok(!ids.has(`terrain:${name}`), 'unknown terrain is fallback-only, not a slot');
      } else {
        assert.ok(ids.has(`terrain:${name}`), name);
      }
    }
  });

  test('every vegetation level, feature, disturbance, and memory kind has a slot', () => {
    const ids = new Set(allSlotIds());
    VEGETATION_APPEARANCE.forEach((appearance, level) => {
      if (appearance) assert.ok(ids.has(`vegetation:${level}`), `vegetation ${level}`);
    });
    for (const kind of Object.keys(FEATURE_APPEARANCE)) assert.ok(ids.has(`feature:${kind}`), kind);
    for (const kind of Object.keys(DISTURBANCE_APPEARANCE)) assert.ok(ids.has(`disturbance:${kind}`), kind);
    for (const kind of Object.keys(MEMORY_APPEARANCE)) assert.ok(ids.has(`memory:${kind}`), kind);
  });

  test('plant and unknown kinds have slots', () => {
    const ids = new Set(allSlotIds());
    assert.ok(ids.has('kind:plant'));
    assert.ok(ids.has('unknown'));
  });

  test('slot ids are unique and every color token is a Dracula value', () => {
    const ids = allSlotIds();
    assert.equal(new Set(ids).size, ids.length);
    for (const group of describeSpriteSlots()) {
      for (const slot of group.slots) {
        assert.ok(slot.colorToken in DRACULA_COLORS, `${slot.slotId} → ${slot.colorToken}`);
        assert.equal(typeof slot.glyph, 'string');
        assert.ok(slot.glyph.length >= 1);
        assert.equal(typeof slot.label, 'string');
      }
    }
  });

  // ⚠ The slot vocabulary is the sprite config's compatibility surface: a
  // persisted mapping is keyed by these strings, and validation drops unknown
  // keys rather than migrating them. Growing the list is fine (a new species
  // adds slots); renaming or removing one orphans saved assignments, which is
  // what this snapshot makes deliberate rather than accidental.
  // Snapshot regenerated 2026-08-04 for the African roster (phase 7/14 renames
  // plus the batch-2/3 species) and the tree terrain — the grazer/stalker/
  // corvid slots went with their species ids, which is exactly the orphaning
  // this test exists to make deliberate: saved configs keyed by the old ids
  // drop those assignments on load.
  test('the slot vocabulary is stable', () => {
    const expected = [
      'carcass:0', 'carcass:1', 'carcass:2', 'carcass:3',
      'disturbance:fire', 'disturbance:flood', 'disturbance:storm',
      'feature:burrow', 'feature:trail',
      'kind:animal:grown:female', 'kind:animal:grown:male',
      'kind:animal:young:female', 'kind:animal:young:male',
      'kind:plant',
      'memory:barren', 'memory:danger', 'memory:food', 'memory:water',
      'species:herbivore.buffalo:grown:female', 'species:herbivore.buffalo:grown:male',
      'species:herbivore.buffalo:young:female', 'species:herbivore.buffalo:young:male',
      'species:herbivore.elephant:grown:female', 'species:herbivore.elephant:grown:male',
      'species:herbivore.elephant:young:female', 'species:herbivore.elephant:young:male',
      'species:herbivore.gazelle:grown:female', 'species:herbivore.gazelle:grown:male',
      'species:herbivore.gazelle:young:female', 'species:herbivore.gazelle:young:male',
      'species:herbivore.rhino:grown:female', 'species:herbivore.rhino:grown:male',
      'species:herbivore.rhino:young:female', 'species:herbivore.rhino:young:male',
      'species:herbivore.wildebeest:grown:female', 'species:herbivore.wildebeest:grown:male',
      'species:herbivore.wildebeest:young:female', 'species:herbivore.wildebeest:young:male',
      'species:herbivore.zebra:grown:female', 'species:herbivore.zebra:grown:male',
      'species:herbivore.zebra:young:female', 'species:herbivore.zebra:young:male',
      'species:predator.leopard:grown:female', 'species:predator.leopard:grown:male',
      'species:predator.leopard:young:female', 'species:predator.leopard:young:male',
      'species:predator.lion:grown:female', 'species:predator.lion:grown:male',
      'species:predator.lion:young:female', 'species:predator.lion:young:male',
      'species:scavenger.hyena:grown:female', 'species:scavenger.hyena:grown:male',
      'species:scavenger.hyena:young:female', 'species:scavenger.hyena:young:male',
      'species:scavenger.vulture:grown:female', 'species:scavenger.vulture:grown:male',
      'species:scavenger.vulture:young:female', 'species:scavenger.vulture:young:male',
      'terrain:cover', 'terrain:deep_water', 'terrain:ground', 'terrain:outOfBounds',
      'terrain:rock', 'terrain:thicket', 'terrain:tree', 'terrain:water',
      'unknown',
      'vegetation:1', 'vegetation:2', 'vegetation:3', 'vegetation:4',
    ];
    assert.deepEqual([...allSlotIds()].sort(), expected);
  });
});

describe('sprite slots: entity resolution mirrors resolveAppearance', () => {
  test('slot glyph/italic agree with resolveAppearance across the animal matrix', () => {
    const slots = slotById();
    const speciesIds = [...Object.keys(SPECIES_APPEARANCE), 'future.newcomer'];
    const lifeStages = ['juvenile', 'subadult', 'adult', 'senescent', null, 'metamorph'];
    const sexes = ['male', 'female', null];
    for (const speciesId of speciesIds) {
      for (const lifeStage of lifeStages) {
        for (const sex of sexes) {
          const entity = { kind: 'animal', speciesId, alive: true, lifeStage, sex };
          const slot = slots.get(slotIdForEntity(entity));
          assert.ok(slot, `no slot for ${speciesId}/${lifeStage}/${sex}`);
          const appearance = resolveAppearance(entity);
          assert.equal(slot.glyph, appearance.glyph, slot.slotId);
          assert.equal(Boolean(slot.italic), Boolean(appearance.italic), slot.slotId);
          assert.equal(slot.colorToken, appearance.colorToken, slot.slotId);
        }
      }
    }
  });

  test('carcasses and dead animals resolve to decay-stage slots', () => {
    const slots = slotById();
    for (const stage of [0, 1, 2, 3]) {
      const entity = { kind: 'carcass', decayStage: stage };
      const slot = slots.get(slotIdForEntity(entity));
      assert.equal(slot.glyph, resolveAppearance(entity).glyph);
    }
    // A dead animal renders as a carcass whatever its kind field says…
    assert.equal(slotIdForEntity({ kind: 'animal', alive: false, decayStage: 1 }), 'carcass:1');
    // …and an out-of-range stage clamps to remains, exactly as the ramp does.
    assert.equal(slotIdForEntity({ kind: 'carcass', decayStage: 9 }), 'carcass:3');
  });

  test('plants, unknown kinds, and absent kinds resolve like the ASCII path', () => {
    assert.equal(slotIdForEntity({ kind: 'plant' }), 'kind:plant');
    assert.equal(slotIdForEntity({ kind: 'mineral' }), 'unknown');
    assert.equal(slotIdForEntity({}), 'unknown');
    assert.ok(KIND_APPEARANCE.plant);
  });
});

describe('sprite slots: ground resolution agrees with groundAppearanceAt', () => {
  const world = { width: 4, height: 4 };
  function storeWith({ vegetation = () => 0, terrain = () => 'ground' } = {}) {
    return { vegetationLevelAt: vegetation, terrainNameAt: terrain };
  }

  test('out-of-bounds, vegetation, and terrain precedence match', () => {
    const slots = slotById();
    const cases = [
      { store: storeWith(), cellX: -1, cellY: 0 },
      { store: storeWith(), cellX: 0, cellY: 0 },
      { store: storeWith({ vegetation: () => 3 }), cellX: 1, cellY: 1 },
      { store: storeWith({ vegetation: () => 9 }), cellX: 1, cellY: 1 },
      { store: storeWith({ terrain: () => 'water' }), cellX: 2, cellY: 2 },
      { store: storeWith({ terrain: () => 'thicket' }), cellX: 2, cellY: 2 },
      { store: storeWith({ terrain: () => 'tree' }), cellX: 2, cellY: 2 },
      { store: storeWith({ terrain: () => null }), cellX: 3, cellY: 3 },
    ];
    for (const { store, cellX, cellY } of cases) {
      const slotId = groundSlotAt(store, cellX, cellY, world);
      const appearance = groundAppearanceAt(store, cellX, cellY, world);
      assert.ok(slotId, `expected a slot at ${cellX},${cellY}`);
      const slot = slots.get(slotId);
      assert.ok(slot, `unknown slot ${slotId}`);
      assert.equal(slot.glyph, appearance.glyph, slotId);
      assert.equal(slot.colorToken, appearance.colorToken, slotId);
    }
  });

  test('tree terrain uses the tree slot when its cell is bare', () => {
    const store = storeWith({ vegetation: () => 0, terrain: () => 'tree' });
    assert.equal(groundSlotAt(store, 0, 0, world), 'terrain:tree');
    assert.equal(groundAppearanceAt(store, 0, 0, world), TERRAIN_APPEARANCE.tree);
  });

  test('an unmapped terrain name has no slot (glyph fallback instead)', () => {
    const store = storeWith({ terrain: () => 'lava' });
    assert.equal(groundSlotAt(store, 0, 0, world), null);
    // The ASCII path draws the unknown-terrain fallback there.
    assert.equal(groundAppearanceAt(store, 0, 0, world), TERRAIN_APPEARANCE.unknown);
  });
});

describe('sprite slots: layer resolvers and lookup', () => {
  test('layer resolvers return null exactly where the ASCII resolvers do', () => {
    assert.equal(slotIdForFeature('trail'), 'feature:trail');
    assert.equal(slotIdForFeature('nest'), null);
    assert.equal(slotIdForDisturbance('fire'), 'disturbance:fire');
    assert.equal(slotIdForDisturbance('quake'), null);
    assert.equal(slotIdForMemory('danger'), 'memory:danger');
    assert.equal(slotIdForMemory('gossip'), null);
  });

  test('spriteForSlot reads assignments and tolerates absence', () => {
    const config = { assignments: { 'terrain:water': { col: 1, row: 2, tint: null } } };
    assert.deepEqual(spriteForSlot(config, 'terrain:water'), { col: 1, row: 2, tint: null });
    assert.equal(spriteForSlot(config, 'terrain:rock'), null);
    assert.equal(spriteForSlot(config, null), null);
    assert.equal(spriteForSlot(null, 'terrain:water'), null);
    assert.equal(spriteForSlot({}, 'terrain:water'), null);
  });
});
