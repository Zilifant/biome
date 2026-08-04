import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET,
  SPRITE_CONFIG_KEY,
  DEFAULT_SPRITE_CONFIG,
  validateSpriteConfig,
  loadSpriteConfig,
  saveSpriteConfig,
  resetSpriteConfig,
} from '../src/renderer/app/rendering/SpriteConfig.js';
import { allSlotIds } from '../src/renderer/app/rendering/SpriteSlots.js';

describe('sprite config: sheet constants', () => {
  test('geometry constants are sane integers', () => {
    assert.ok(Number.isInteger(SHEET.spriteWidth) && SHEET.spriteWidth >= 1);
    assert.ok(Number.isInteger(SHEET.spriteHeight) && SHEET.spriteHeight >= 1);
    assert.ok(Number.isInteger(SHEET.gap) && SHEET.gap >= 0);
    assert.ok(Number.isInteger(SHEET.margin) && SHEET.margin >= 0);
    assert.ok(SHEET.url.startsWith('/renderer/'));
    assert.ok(Object.isFrozen(SHEET));
  });
});

describe('sprite config: validation', () => {
  const someSlot = allSlotIds()[0];

  test('the default config validates to itself', () => {
    const validated = validateSpriteConfig(DEFAULT_SPRITE_CONFIG);
    assert.deepEqual(validated, DEFAULT_SPRITE_CONFIG);
  });

  test('garbage is rejected outright', () => {
    for (const raw of [null, undefined, 42, 'config', [], {}, { version: 2 }, { version: '1' }]) {
      assert.equal(validateSpriteConfig(raw), null, JSON.stringify(raw));
    }
  });

  test('a well-formed assignment survives, normalized and frozen', () => {
    const validated = validateSpriteConfig({
      version: 1,
      assignments: { [someSlot]: { col: 2, row: 3, tint: '#ff79c6' } },
    });
    assert.deepEqual(validated.assignments[someSlot], { col: 2, row: 3, tint: '#FF79C6' });
    assert.ok(Object.isFrozen(validated));
    assert.ok(Object.isFrozen(validated.assignments));
  });

  test('unknown slot ids are dropped, not fatal', () => {
    const validated = validateSpriteConfig({
      version: 1,
      assignments: {
        [someSlot]: { col: 0, row: 0 },
        'species:extinct.mammoth:grown:male': { col: 1, row: 1 },
      },
    });
    assert.deepEqual(Object.keys(validated.assignments), [someSlot]);
  });

  test('malformed assignments are dropped; malformed tints become null', () => {
    const validated = validateSpriteConfig({
      version: 1,
      assignments: {
        [someSlot]: { col: 1.5, row: 0 },
      },
    });
    assert.equal(validated.assignments[someSlot], undefined);

    const negatives = validateSpriteConfig({
      version: 1,
      assignments: { [someSlot]: { col: -1, row: 0 } },
    });
    assert.equal(negatives.assignments[someSlot], undefined);

    const badTint = validateSpriteConfig({
      version: 1,
      assignments: { [someSlot]: { col: 0, row: 0, tint: 'red' } },
    });
    assert.deepEqual(badTint.assignments[someSlot], { col: 0, row: 0, tint: null });
  });

  test('background must be #RRGGBB; sheet override must be a data:image URL', () => {
    assert.equal(validateSpriteConfig({ version: 1, canvasBackground: 'purple' }).canvasBackground, null);
    assert.equal(validateSpriteConfig({ version: 1, canvasBackground: '#123' }).canvasBackground, null);
    assert.equal(
      validateSpriteConfig({ version: 1, canvasBackground: '#191a21' }).canvasBackground,
      '#191A21'
    );
    assert.equal(validateSpriteConfig({ version: 1, sheetDataUrl: 'https://x/sheet.png' }).sheetDataUrl, null);
    assert.equal(
      validateSpriteConfig({ version: 1, sheetDataUrl: 'data:image/png;base64,AAAA' }).sheetDataUrl,
      'data:image/png;base64,AAAA'
    );
  });
});

describe('sprite config: persistence', () => {
  // node:test has no DOM; stand in a minimal localStorage the way the
  // renderer's own storage helpers expect to find it on globalThis.
  let backing;
  beforeEach(() => {
    backing = new Map();
    globalThis.localStorage = {
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => backing.set(key, String(value)),
      removeItem: (key) => backing.delete(key),
    };
  });
  afterEach(() => {
    delete globalThis.localStorage;
  });

  test('load falls back to the default with nothing stored', () => {
    assert.deepEqual(loadSpriteConfig(), DEFAULT_SPRITE_CONFIG);
  });

  test('save → load round-trips a valid config', () => {
    const someSlot = allSlotIds()[0];
    const config = validateSpriteConfig({
      version: 1,
      canvasBackground: '#101010',
      assignments: { [someSlot]: { col: 4, row: 1, tint: null } },
    });
    saveSpriteConfig(config);
    assert.deepEqual(loadSpriteConfig(), config);
  });

  test('a corrupt store falls back rather than half-applying', () => {
    backing.set(SPRITE_CONFIG_KEY, '{not json');
    assert.deepEqual(loadSpriteConfig(), DEFAULT_SPRITE_CONFIG);
    backing.set(SPRITE_CONFIG_KEY, JSON.stringify({ version: 99 }));
    assert.deepEqual(loadSpriteConfig(), DEFAULT_SPRITE_CONFIG);
  });

  test('reset forgets the stored config', () => {
    backing.set(SPRITE_CONFIG_KEY, JSON.stringify(DEFAULT_SPRITE_CONFIG));
    resetSpriteConfig();
    assert.equal(backing.has(SPRITE_CONFIG_KEY), false);
  });

  test('a missing localStorage is not an error', () => {
    delete globalThis.localStorage;
    assert.deepEqual(loadSpriteConfig(), DEFAULT_SPRITE_CONFIG);
    saveSpriteConfig(DEFAULT_SPRITE_CONFIG);
    resetSpriteConfig();
  });
});
