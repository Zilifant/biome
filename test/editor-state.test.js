import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  initialState,
  selectSlot,
  pickSprite,
  setTint,
  clearAssignment,
  setBackground,
  setSheetDataUrl,
  importConfig,
  resetToDefault,
} from '../src/renderer/app/editor/EditorState.js';
import { DEFAULT_SPRITE_CONFIG } from '../src/renderer/app/rendering/SpriteConfig.js';
import { allSlotIds } from '../src/renderer/app/rendering/SpriteSlots.js';

const [SLOT_A, SLOT_B] = allSlotIds();

describe('editor state: the assignment flow', () => {
  test('select a slot, then pick a sprite → assignment lands', () => {
    let state = initialState();
    state = selectSlot(state, SLOT_A);
    assert.equal(state.selectedSlotId, SLOT_A);
    state = pickSprite(state, 3, 1);
    assert.deepEqual(state.config.assignments[SLOT_A], { col: 3, row: 1, tint: null });
    // The slot stays selected for tinting or re-picking.
    assert.equal(state.selectedSlotId, SLOT_A);
  });

  test('pick a sprite first, then a slot → same assignment, either order works', () => {
    let state = initialState();
    state = pickSprite(state, 2, 5);
    assert.deepEqual(state.selectedSprite, { col: 2, row: 5 });
    assert.equal(Object.keys(state.config.assignments).length, 0);
    state = selectSlot(state, SLOT_B);
    assert.deepEqual(state.config.assignments[SLOT_B], { col: 2, row: 5, tint: null });
    assert.equal(state.selectedSprite, null);
  });

  test('re-assigning keeps the tint; the colour belongs to the slot', () => {
    let state = selectSlot(initialState(), SLOT_A);
    state = pickSprite(state, 0, 0);
    state = setTint(state, '#FF79C6');
    state = pickSprite(state, 4, 4);
    assert.deepEqual(state.config.assignments[SLOT_A], { col: 4, row: 4, tint: '#FF79C6' });
  });

  test('selecting the same slot again deselects it', () => {
    let state = selectSlot(initialState(), SLOT_A);
    state = selectSlot(state, SLOT_A);
    assert.equal(state.selectedSlotId, null);
  });

  test('tint requires a selected, assigned slot', () => {
    const state = initialState();
    assert.equal(setTint(state, '#FFFFFF'), state);
    const selectedUnassigned = selectSlot(state, SLOT_A);
    assert.equal(setTint(selectedUnassigned, '#FFFFFF'), selectedUnassigned);
  });

  test('setTint(null) returns the sprite to its sheet colours', () => {
    let state = selectSlot(initialState(), SLOT_A);
    state = pickSprite(state, 1, 1);
    state = setTint(state, '#50FA7B');
    state = setTint(state, null);
    assert.equal(state.config.assignments[SLOT_A].tint, null);
  });

  test('clearAssignment removes the slot entirely (back to the glyph)', () => {
    let state = selectSlot(initialState(), SLOT_A);
    state = pickSprite(state, 1, 1);
    state = clearAssignment(state);
    assert.equal(state.config.assignments[SLOT_A], undefined);
    // Clearing an unassigned slot is a no-op, not an error.
    assert.equal(clearAssignment(state), state);
  });
});

describe('editor state: background, sheet, import/export, reset', () => {
  test('background sets and clears', () => {
    let state = setBackground(initialState(), '#101820');
    assert.equal(state.config.canvasBackground, '#101820');
    state = setBackground(state, null);
    assert.equal(state.config.canvasBackground, null);
  });

  test('an editor-loaded sheet is carried as a data: URL', () => {
    let state = setSheetDataUrl(initialState(), 'data:image/png;base64,AAAA');
    assert.equal(state.config.sheetDataUrl, 'data:image/png;base64,AAAA');
    state = setSheetDataUrl(state, null);
    assert.equal(state.config.sheetDataUrl, null);
  });

  test('import replaces the config wholesale; garbage never half-applies', () => {
    let state = selectSlot(initialState(), SLOT_A);
    state = pickSprite(state, 9, 9);

    const good = importConfig(
      state,
      JSON.stringify({
        version: 1,
        canvasBackground: '#0B0D12',
        assignments: { [SLOT_B]: { col: 1, row: 2, tint: null } },
      })
    );
    assert.equal(good.ok, true);
    assert.deepEqual(Object.keys(good.state.config.assignments), [SLOT_B]);
    assert.equal(good.state.config.canvasBackground, '#0B0D12');
    assert.equal(good.state.selectedSlotId, null);

    for (const text of ['{not json', JSON.stringify({ version: 7 }), '42']) {
      const bad = importConfig(good.state, text);
      assert.equal(bad.ok, false);
      assert.equal(bad.state, good.state);
    }
  });

  test('reset returns to the committed default and drops selection', () => {
    let state = selectSlot(initialState(), SLOT_A);
    state = pickSprite(state, 1, 1);
    state = resetToDefault(state);
    assert.deepEqual(state.config, DEFAULT_SPRITE_CONFIG);
    assert.equal(state.selectedSlotId, null);
    assert.equal(state.selectedSprite, null);
  });

  test('transitions never mutate prior states', () => {
    const first = initialState();
    const second = pickSprite(selectSlot(first, SLOT_A), 2, 2);
    assert.equal(Object.keys(first.config.assignments).length, 0);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(second.config));
  });
});
