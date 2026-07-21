import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, ZOOM_LEVELS } from '../src/renderer/app/rendering/Camera.js';
import { createProjection, worldCellOf, occupantsInCell } from '../src/renderer/app/rendering/GridProjection.js';
import {
  resolveAppearance,
  compareOccupants,
  topOccupant,
  DRACULA_COLORS,
  UNKNOWN_APPEARANCE,
  CARCASS_APPEARANCE,
  CARCASS_DECAY_APPEARANCE,
  SPECIES_APPEARANCE,
  TERRAIN_APPEARANCE,
  FEATURE_APPEARANCE,
  DISTURBANCE_APPEARANCE,
  MEMORY_APPEARANCE,
} from '../src/renderer/app/rendering/EntityAppearance.js';
import { structureSignature, describeSections, entityRef, linkifyIds } from '../src/renderer/app/ui/InspectorView.js';
import { describeLegend } from '../src/renderer/app/ui/Legend.js';
import { matchWatched, WATCHABLE } from '../src/renderer/app/ui/Watchlist.js';

describe('entity appearance', () => {
  test('appearance lookup is deterministic and species-aware', () => {
    const grazer = { kind: 'animal', speciesId: 'herbivore.grazer', alive: true };
    const first = resolveAppearance(grazer);
    const second = resolveAppearance({ ...grazer });
    assert.equal(first, second, 'repeated lookups return the identical cached object');
    assert.equal(first.glyph, 'g');
    assert.equal(first.colorToken, 'yellow');
    assert.equal(resolveAppearance({ kind: 'plant', speciesId: 'demo.grass', alive: true }).glyph, '"');
  });

  test('glyphs differ across categories, so color is never the only distinction', () => {
    const glyphs = [
      resolveAppearance({ kind: 'animal', speciesId: 'herbivore.grazer', alive: true }).glyph,
      resolveAppearance({ kind: 'plant', speciesId: 'demo.grass', alive: true }).glyph,
      resolveAppearance({ kind: 'animal', speciesId: 'herbivore.grazer', alive: false }).glyph,
      resolveAppearance({ kind: 'mystery', speciesId: 'x', alive: true }).glyph,
    ];
    assert.equal(new Set(glyphs).size, glyphs.length, `expected distinct glyphs, got ${glyphs}`);
    for (const glyph of glyphs) {
      assert.equal(glyph.length, 1);
      assert.ok(glyph.charCodeAt(0) < 128, 'strict ASCII only');
    }
  });

  test('dead animals become carcasses; unknown kinds and species fall back', () => {
    assert.equal(resolveAppearance({ kind: 'animal', speciesId: 'herbivore.grazer', alive: false }), CARCASS_APPEARANCE);
    assert.equal(resolveAppearance({ kind: 'levitating.rock', speciesId: 'whatever', alive: true }), UNKNOWN_APPEARANCE);
    const unknownSpecies = resolveAppearance({ kind: 'animal', speciesId: 'not.mapped', alive: true });
    assert.equal(unknownSpecies.glyph, 'a', 'unmapped species fall back to the kind default');
  });

  test('appearance color tokens all resolve to exact Dracula values', () => {
    for (const entity of [
      { kind: 'animal', speciesId: 'herbivore.grazer', alive: true },
      { kind: 'plant', speciesId: 'demo.grass', alive: true },
      { kind: 'animal', speciesId: 'herbivore.grazer', alive: false },
      { kind: 'nope', speciesId: '', alive: true },
    ]) {
      const { colorToken } = resolveAppearance(entity);
      assert.match(DRACULA_COLORS[colorToken], /^#[0-9A-F]{6}$/);
    }
  });

  test('multiple occupants order deterministically: living animal > carcass > plant, ties by id', () => {
    const plant = { id: 5, kind: 'plant', speciesId: 'demo.grass', alive: true };
    const carcass = { id: 4, kind: 'animal', speciesId: 'herbivore.grazer', alive: false };
    const animalOld = { id: 2, kind: 'animal', speciesId: 'herbivore.grazer', alive: true };
    const animalNew = { id: 9, kind: 'animal', speciesId: 'herbivore.grazer', alive: true };
    const sorted = [plant, carcass, animalNew, animalOld].sort(compareOccupants);
    assert.deepEqual(sorted.map((entity) => entity.id), [2, 9, 4, 5]);
    assert.equal(topOccupant([plant, carcass, animalNew]).id, 9);
    assert.equal(topOccupant([plant, carcass]).id, 4);
  });
});

describe('grid projection', () => {
  const camera = { centerX: 64, centerY: 64, cellSize: 16 };
  const viewport = { width: 800, height: 600 };

  test('world cells project to integer-aligned screen cells and back', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    // The camera center cell lands mid-viewport.
    const { px, py } = projection.cellToScreen(64, 64);
    assert.ok(Math.abs(px + 8 - viewport.width / 2) <= 16, `center cell x near mid-viewport, got ${px}`);
    assert.ok(Math.abs(py + 8 - viewport.height / 2) <= 16, `center cell y near mid-viewport, got ${py}`);
    assert.equal(px, Math.round(px), 'integer pixel alignment');
    // Round trip: every screen pixel inside the cell maps back to it.
    for (const [dx, dy] of [[0, 0], [15, 15], [8, 3]]) {
      const cell = projection.cellAtScreen(px + dx, py + dy);
      assert.deepEqual(cell, { cellX: 64, cellY: 64 });
    }
    // Neighboring cells are exactly one cellSize apart (no drift).
    const next = projection.cellToScreen(65, 64);
    assert.equal(next.px - px, 16);
  });

  test('screen-to-world selection matches what is drawn at that pixel', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    const entity = { x: 70.9, y: 60.2 };
    const cell = worldCellOf(entity, { width: 128, height: 128 });
    assert.deepEqual(cell, { cellX: 70, cellY: 60 });
    const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
    assert.deepEqual(projection.cellAtScreen(px + 5, py + 5), cell);
  });

  test('entities clamped to the world border display in the last cell', () => {
    const world = { width: 128, height: 128 };
    assert.deepEqual(worldCellOf({ x: 128, y: 0 }, world), { cellX: 127, cellY: 0 });
    assert.deepEqual(worldCellOf({ x: 0, y: 128 }, world), { cellX: 0, cellY: 127 });
  });

  test('visible bounds cover the viewport plus margin', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    const cells = projection.visibleCellBounds();
    assert.ok(cells.maxCellX - cells.minCellX >= viewport.width / camera.cellSize - 1);
    const bounds = projection.visibleWorldBounds(2);
    assert.equal(bounds.minX, cells.minCellX - 2);
    assert.equal(bounds.maxY, cells.maxCellY + 1 + 2);
  });

  test('occupantsInCell returns exactly the entities whose cell matches', () => {
    const world = { width: 128, height: 128 };
    const entities = [
      { id: 1, x: 10.2, y: 10.9 },
      { id: 2, x: 10.8, y: 10.1 },
      { id: 3, x: 11.0, y: 10.5 }, // next cell over
    ];
    assert.deepEqual(occupantsInCell(entities, 10, 10, world).map((entity) => entity.id), [1, 2]);
  });
});

describe('camera', () => {
  test('panning moves the center by whole cells and clamps to world bounds', () => {
    const camera = new Camera({ centerX: 5, centerY: 5, cellSize: 16 });
    camera.panByCells(3, -2);
    assert.equal(camera.centerX, 8);
    assert.equal(camera.centerY, 3);
    camera.panByCells(-100, -100);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.equal(camera.centerX, 0);
    assert.equal(camera.centerY, 0);
    camera.centerOn(999, 999);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.deepEqual([camera.centerX, camera.centerY], [128, 128]);
  });

  test('zoom steps through the fixed levels and stops at the ends', () => {
    const camera = new Camera({ cellSize: ZOOM_LEVELS[0] });
    assert.equal(camera.zoomOut(), false, 'cannot zoom below the smallest level');
    assert.equal(camera.zoomIn(), true);
    assert.equal(camera.cellSize, ZOOM_LEVELS[1]);
    const top = new Camera({ cellSize: ZOOM_LEVELS.at(-1) });
    assert.equal(top.zoomIn(), false, 'cannot zoom above the largest level');
  });

  test('anchored zoom keeps the anchor point in the same screen cell', () => {
    const camera = new Camera({ centerX: 64, centerY: 64, cellSize: 16 });
    const viewport = { width: 800, height: 600 };
    const anchor = { x: 80.5, y: 50.5 };
    const before = createProjection(camera, viewport.width, viewport.height);
    const screenBefore = before.cellToScreen(Math.floor(anchor.x), Math.floor(anchor.y));
    camera.zoomAt(anchor.x, anchor.y, 1);
    const after = createProjection(camera, viewport.width, viewport.height);
    // The world point under the old screen position must still be the anchor's cell.
    const cellAfter = after.cellAtScreen(screenBefore.px + 8, screenBefore.py + 8);
    assert.ok(Math.abs(cellAfter.cellX - Math.floor(anchor.x)) <= 1, `anchor drifted to ${cellAfter.cellX}`);
    assert.ok(Math.abs(cellAfter.cellY - Math.floor(anchor.y)) <= 1, `anchor drifted to ${cellAfter.cellY}`);
    assert.equal(camera.cellSize, 20);
  });

  test('cell size snaps to supported zoom levels', () => {
    assert.equal(new Camera({ cellSize: 15 }).cellSize, 14);
    assert.equal(Camera.snapCellSize(1000), ZOOM_LEVELS.at(-1));
  });

  test('no zoom level is smaller than a reliable click target', () => {
    // Every cell is selectable now, bare ground included, so a cell that is
    // hard to hit is a broken control rather than a merely small one.
    assert.equal(Math.min(...ZOOM_LEVELS), 10);
    assert.equal(Camera.snapCellSize(1), 10, 'snapping never drops below the floor');
  });

  test('pixel panning moves the camera opposite the drag, scaled by zoom', () => {
    const camera = new Camera({ centerX: 50, centerY: 50, cellSize: 10 });
    // Dragging right by one cell's width reveals what is to the left.
    camera.panByPixels(10, 0);
    assert.equal(camera.centerX, 49);
    // The same drag at double the zoom covers half the world distance.
    const zoomed = new Camera({ centerX: 50, centerY: 50, cellSize: 20 });
    zoomed.panByPixels(10, 0);
    assert.equal(zoomed.centerX, 49.5);
    // Fractional, so a drag does not stutter cell to cell.
    zoomed.panByPixels(0, 5);
    assert.equal(zoomed.centerY, 49.75);
  });
});

describe('inspector structure signature (the per-tick rebuild guard)', () => {
  // The panel is re-rendered on every store change — once per authoritative
  // tick. A full rebuild at that cadence destroys scroll position, text
  // selection, and section open/closed state, so the signature decides whether
  // the markup can be patched in place instead. These tests are the acceptance
  // criterion for that: the shape must be stable across an ordinary tick, and
  // must move the moment a row could appear or vanish.
  const store = { followedEntityId: null, eventsForEntity: () => [] };
  const selection = { cellX: 4, cellY: 7, entityIds: [1], activeId: 1 };
  const animal = (overrides = {}) => ({
    id: 1,
    x: 4.2,
    y: 7.9,
    heading: 0.5,
    age: 100,
    bodyMass: 30,
    energyFraction: 0.5,
    healthFraction: 1,
    alive: true,
    lifeStage: 'adult',
    action: 'wander',
    ...overrides,
  });
  const cell = { inWorld: true, terrain: { name: 'ground' }, feature: null, disturbances: [] };
  const sign = (active, detail = null, groundCell = cell, sel = selection) =>
    structureSignature(store, sel, active, detail, groundCell);

  test('an ordinary tick does not change the shape', () => {
    // Everything a delta moves: position, age, energy, health, hydration.
    const before = sign(animal());
    const after = sign(animal({ x: 5.1, y: 8.4, age: 101, energyFraction: 0.42, healthFraction: 0.9 }));
    assert.equal(before, after, 'moving values must patch in place, never rebuild');
  });

  test('an action changing does not rebuild, but gaining one does', () => {
    // The action row exists either way, so switching action is a patch...
    assert.equal(sign(animal({ action: 'eat' })), sign(animal({ action: 'flee' })));
    // ...but an animal that had no action row now needs one.
    assert.notEqual(sign(animal({ action: undefined })), sign(animal({ action: 'eat' })));
  });

  test('an optional row appearing changes the shape', () => {
    // Patching a node that does not exist yet is how this breaks.
    assert.notEqual(sign(animal()), sign(animal({ hydrationFraction: 0.8 })));
    assert.notEqual(sign(animal()), sign(animal({ lifeStage: undefined })));
    assert.notEqual(sign(animal()), sign(animal({ sex: 'female' })));
  });

  test('a new selection, occupant, or inspection payload changes the shape', () => {
    assert.notEqual(sign(animal()), sign(animal(), null, cell, { ...selection, cellX: 9 }));
    assert.notEqual(sign(animal()), sign(animal(), null, cell, { ...selection, entityIds: [1, 2] }));
    assert.notEqual(sign(animal()), sign(animal(), { entity: { id: 1 }, tick: 12 }));
  });

  test('a fresher inspection payload does NOT change the shape', () => {
    // This is what makes B5's polling viable: re-fetching the same animal's
    // inspection every couple of seconds brings new *numbers* on the same rows,
    // and rebuilding for that would throw away scroll position and collapse
    // every section the viewer had opened. New numbers patch; new rows rebuild.
    assert.equal(
      sign(animal(), { entity: { id: 1 }, tick: 12 }),
      sign(animal(), { entity: { id: 1 }, tick: 13 }),
    );
    // ...but a payload that changes which rows exist still rebuilds.
    assert.notEqual(
      sign(animal(), { entity: { id: 1, edibleMass: 0 }, tick: 12 }),
      sign(animal(), { entity: { id: 1, edibleMass: 4.2 }, tick: 12 }),
    );
    assert.notEqual(
      sign(animal(), { entity: { id: 1, reproState: { gestating: true } }, tick: 12 }),
      sign(animal(), { entity: { id: 1, reproState: { gestating: false, lastMatedTick: 9 } }, tick: 12 }),
    );
  });

  test('a section appearing or vanishing changes the shape', () => {
    // Section *contents* are patched in place, so the id set has to be part of
    // the shape — otherwise a new section would have nowhere to be written.
    const withInjury = { injuries: [{ kind: 'gash', severity: 0.3, tick: 4 }], impairment: 0.1 };
    const detailSign = (detail) =>
      structureSignature(store, selection, animal(), { entity: { id: 1, ...detail }, tick: 12 }, cell,
        describeSections({ id: 1, ...detail }, animal()).map((s) => s.id));
    assert.notEqual(detailSign({}), detailSign(withInjury));
    assert.equal(detailSign(withInjury), detailSign(withInjury));
  });

  test('ground changing under a stationary selection changes the shape', () => {
    // Grass grows and fires arrive while the selection sits still.
    assert.notEqual(sign(animal()), sign(animal(), null, { ...cell, feature: { kind: 'trail', wear: 0.5 } }));
    assert.notEqual(sign(animal()), sign(animal(), null, { ...cell, disturbances: [{ kind: 'fire' }] }));
  });

  test('an empty cell is a stable shape too', () => {
    const empty = { cellX: 4, cellY: 7, entityIds: [], activeId: null };
    assert.equal(sign(null, null, cell, empty), sign(null, null, cell, empty));
    assert.notEqual(sign(null, null, cell, empty), sign(animal()));
  });
});

describe('inspector sections (progressive disclosure)', () => {
  // Sections are what the tooltip collapses. A formatter whose data the
  // protocol did not send must produce no section at all — an empty expandable
  // row is worse than an absent one, and inventing a field is worse than both.
  const ids = (sections) => sections.map((s) => s.id);

  test('an entity with no inspection payload has no sections', () => {
    assert.deepEqual(describeSections(null, { action: 'wander' }), []);
  });

  test('only the sections the protocol actually populated appear', () => {
    const detail = {
      injuries: [{ kind: 'gash', severity: 0.4, tick: 12 }],
      impairment: 0.2,
      memories: [{ kind: 'food', cellX: 3, cellY: 4, strength: 0.8, tick: 9 }],
    };
    assert.deepEqual(ids(describeSections(detail, null)), ['injuries', 'memories']);
  });

  test('recent events become a section, and no events becomes none', () => {
    assert.deepEqual(ids(describeSections(null, null, [{ tick: 3, type: 'entity.fed' }])), ['events']);
    assert.deepEqual(ids(describeSections(null, null, [])), []);
  });

  test('section ids are unique and stable, since they key the remembered open-set', () => {
    const detail = {
      injuries: [{ kind: 'gash', severity: 0.4, tick: 1 }],
      impairment: 0.1,
      memories: [{ kind: 'water', cellX: 1, cellY: 1, strength: 0.5, tick: 1 }],
      traits: { size: 1.1 },
      genome: { size: [1.0, 1.2] },
      genotype: { size: 1.1 },
      disease: { state: 'infectious', infectious: true, severity: 0 },
      social: { groupId: 4, dominance: 12 },
      territory: { homeRange: { x: 1, y: 2, radius: 3 } },
      migration: { drift: { heading: 0, strength: 0.4 } },
      mateChoice: { choosiness: 0.5, preference: { trait: 'size' } },
      perception: { radius: 8, animalCount: 2 },
      utilityBreakdown: { eat: 0.7 },
      action: 'eat',
    };
    const sections = describeSections(detail, { action: 'eat' }, [{ tick: 2, type: 'entity.moved' }]);
    assert.equal(new Set(ids(sections)).size, sections.length, `duplicate ids in ${ids(sections)}`);
    // Every section carries a title and a non-empty body, or it should not exist.
    for (const entry of sections) {
      assert.ok(entry.title.length > 0, `${entry.id} has no title`);
      assert.ok(entry.body.length > 0, `${entry.id} has an empty body`);
    }
  });

  test('the utilities highlight follows the inspection tick, not the live action', () => {
    // The utility numbers were computed on the inspection tick, so highlighting
    // an action the animal has since switched to would caption them wrongly.
    const detail = { utilityBreakdown: { eat: 0.9, flee: 0.2 }, action: 'eat' };
    const [utilities] = describeSections(detail, { action: 'flee' });
    assert.match(utilities.body, /▸ eat/);
    assert.doesNotMatch(utilities.body, /▸ flee/);
  });
});

describe('legend', () => {
  // The legend's whole reason for being generated rather than written is that a
  // hand-maintained one goes stale the first time a species is added. These
  // tests are that guarantee: every registry entry must reach the legend.
  const allEntries = () => describeLegend().flatMap((group) => group.entries);

  test('every species reaches the legend, with both sexes when it has them', () => {
    for (const [speciesId, appearance] of Object.entries(SPECIES_APPEARANCE)) {
      const entry = allEntries().find((e) => e.label === appearance.label);
      assert.ok(entry, `${speciesId} is missing from the legend`);
      if (appearance.glyphBySex) {
        assert.match(entry.glyph, /\//, `${speciesId} should show both sexes`);
        assert.ok(entry.glyph.includes(appearance.glyphBySex.female));
        assert.ok(entry.glyph.includes(appearance.glyphBySex.male));
      }
    }
  });

  test('every terrain, feature, disturbance, and memory kind reaches the legend', () => {
    const labels = new Set(allEntries().map((e) => e.label));
    for (const name of Object.keys(TERRAIN_APPEARANCE)) {
      if (name === 'unknown' || name === 'outOfBounds') continue; // fallbacks, not terrain
      assert.ok(labels.has(name), `terrain "${name}" is missing from the legend`);
    }
    for (const kind of Object.keys(FEATURE_APPEARANCE)) {
      assert.ok(labels.has(kind), `feature "${kind}" is missing from the legend`);
    }
    for (const kind of Object.keys(DISTURBANCE_APPEARANCE)) {
      assert.ok(labels.has(kind), `disturbance "${kind}" is missing from the legend`);
    }
    for (const kind of Object.keys(MEMORY_APPEARANCE)) {
      assert.ok(labels.has(`remembered ${kind}`), `memory "${kind}" is missing from the legend`);
    }
  });

  test('every carcass decay stage reaches the legend', () => {
    const labels = new Set(allEntries().map((e) => e.label));
    for (const appearance of CARCASS_DECAY_APPEARANCE) {
      assert.ok(labels.has(appearance.label), `carcass stage "${appearance.label}" is missing`);
    }
  });

  test('every legend colour is a real Dracula token', () => {
    // The legend renders colours as `var(--dracula-<token>)`, so a token that
    // is not in the palette silently renders as inherited text.
    for (const entry of allEntries()) {
      assert.ok(DRACULA_COLORS[entry.colorToken], `unknown colour token "${entry.colorToken}" for ${entry.label}`);
    }
  });
});

describe('entity references', () => {
  test('ids become buttons carrying the entity id', () => {
    assert.match(entityRef(42), /data-entity="42"/);
    assert.match(entityRef(42), /#42/);
  });

  test('event text is escaped before it is linkified, not after', () => {
    // Event lines legitimately contain `<` and `>` — `<until t1205>`, `→`.
    // Linkifying first would let an event's own punctuation become markup.
    const line = '*! fire at 3,4 <until t1205> hit #7';
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = linkifyIds(escaped);
    assert.ok(!html.includes('<until'), 'raw angle brackets must not survive as markup');
    assert.match(html, /&lt;until t1205&gt;/);
    assert.match(html, /data-entity="7"/);
  });

  test('a tick reference is not mistaken for an entity id', () => {
    // `t1205` has no `#`, so it must stay plain text.
    assert.doesNotMatch(linkifyIds('ended at t1205'), /data-entity/);
  });
});

describe('auto-pause watchlist', () => {
  // Renderer policy over authoritative output: the engine emits what it always
  // did, and the renderer decides whether that is worth stopping for.
  const enabled = (...ids) => new Set(ids);

  test('nothing watched means nothing matches, whatever happens', () => {
    const events = [{ type: 'entity.killed', entityId: 3 }, { type: 'entity.born', entityId: 9 }];
    assert.equal(matchWatched(events, new Set()), null);
    assert.equal(matchWatched(events, null), null);
  });

  test('a watched event matches and reports which watchable caught it', () => {
    const match = matchWatched([{ type: 'entity.killed', entityId: 3 }], enabled('predation'));
    assert.equal(match.watchable.id, 'predation');
    assert.equal(match.event.entityId, 3);
  });

  test('an unwatched event is ignored even in a busy batch', () => {
    const events = [
      { type: 'entity.moved', entityId: 1 },
      { type: 'entity.fed', entityId: 2 },
      { type: 'entity.born', entityId: 3 },
    ];
    assert.equal(matchWatched(events, enabled('predation')), null);
    assert.equal(matchWatched(events, enabled('birth')).event.entityId, 3);
  });

  test('one watchable can cover several event types', () => {
    // A contest over a mate and a contest over ground are the same thing to a
    // viewer, so they are one checkbox.
    assert.equal(matchWatched([{ type: 'entity.disputed' }], enabled('conflict')).watchable.id, 'conflict');
    assert.equal(matchWatched([{ type: 'entity.contested' }], enabled('conflict')).watchable.id, 'conflict');
  });

  test('the first watched event wins, in the order the engine emitted them', () => {
    // A tick can carry a kill and the death it caused; picking between them
    // would invent a hierarchy the engine does not have.
    const events = [{ type: 'entity.killed', entityId: 5 }, { type: 'entity.died', entityId: 5 }];
    assert.equal(matchWatched(events, enabled('predation', 'death')).watchable.id, 'predation');
    assert.equal(matchWatched([...events].reverse(), enabled('predation', 'death')).watchable.id, 'death');
  });

  test('every watchable has a unique id and at least one event type', () => {
    // The id keys the remembered set and the checkbox, so a collision would
    // silently tie two toggles together.
    const ids = WATCHABLE.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids}`);
    for (const entry of WATCHABLE) {
      assert.ok(entry.types.length > 0, `${entry.id} watches nothing`);
      assert.ok(entry.label.length > 0, `${entry.id} has no label`);
    }
  });

  test('no event type is claimed by two watchables', () => {
    // Overlapping coverage would make which checkbox "caught" an event depend
    // on declaration order rather than on what the viewer asked for.
    const seen = new Map();
    for (const entry of WATCHABLE) {
      for (const type of entry.types) {
        assert.equal(seen.get(type), undefined, `${type} claimed by both ${seen.get(type)} and ${entry.id}`);
        seen.set(type, entry.id);
      }
    }
  });

  test('watched types are real event types the engine emits', () => {
    // Guards against a typo silently creating a checkbox that can never fire.
    const emitted = new Set([
      'entity.killed', 'entity.escaped', 'entity.courted', 'entity.mated', 'entity.born',
      'entity.died', 'environment.disturbed', 'entity.sickened', 'entity.contested',
      'entity.disputed', 'entity.injured', 'entity.migrated', 'environment.changed',
    ]);
    for (const entry of WATCHABLE) {
      for (const type of entry.types) {
        assert.ok(emitted.has(type), `"${type}" is not an event type this renderer expects`);
      }
    }
  });
});
