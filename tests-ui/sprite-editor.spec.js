/**
 * The sprite editor page: slot list completeness, the assignment flow
 * (glyph → sprite), tinting, background, persistence, reset, and export.
 *
 * The spritesheet is built in-page as a data: URL (a two-sprite grid laid out
 * from the SHEET geometry constants, so the test tracks whatever geometry the
 * renderer is configured for) and stored in the config, the same path a
 * user's "Load PNG…" takes — so no binary fixture is committed.
 */
import { test, expect } from './helpers/app.js';
import { allSlotIds } from '../src/renderer/app/rendering/SpriteSlots.js';
import { SHEET } from '../src/renderer/app/rendering/SpriteConfig.js';

const CONFIG_KEY = 'biome.sprites.config.v1';

/** Store a config whose sheet is a two-sprite data: URL, then boot with it. */
async function seedSheet(page, extraConfig = {}) {
  await page.evaluate(
    ({ key, extra, geometry }) => {
      const { spriteWidth, spriteHeight, gap, margin } = geometry;
      const sheet = document.createElement('canvas');
      sheet.width = margin + 2 * (spriteWidth + gap);
      sheet.height = margin + spriteHeight + gap;
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#FF00FF';
      ctx.fillRect(margin + 2, margin + 2, spriteWidth - 4, spriteHeight - 4);
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(margin + spriteWidth + gap + 2, margin + 2, spriteWidth - 4, spriteHeight - 4);
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, sheetDataUrl: sheet.toDataURL('image/png'), assignments: {}, ...extra })
      );
    },
    { key: CONFIG_KEY, extra: extraConfig, geometry: SHEET }
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#slots-panel .slot-row');
  await page.waitForSelector('.sheet-canvas:not([hidden])');
}

async function storedConfig(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), CONFIG_KEY);
}

/** Click the centre of sheet cell (col, row) at the editor's 4× default zoom. */
async function clickSheetCell(page, col, row) {
  const box = await page.locator('.sheet-canvas').boundingBox();
  const ZOOM = 4;
  const cx = (SHEET.margin + col * (SHEET.spriteWidth + SHEET.gap) + SHEET.spriteWidth / 2) * ZOOM;
  const cy = (SHEET.margin + row * (SHEET.spriteHeight + SHEET.gap) + SHEET.spriteHeight / 2) * ZOOM;
  await page.mouse.click(box.x + cx, box.y + cy);
}

test.describe('sprite editor', () => {
  test('every slot renders, grouped, with its glyph', async ({ editorPage: page }) => {
    const rows = page.locator('#slots-panel .slot-row');
    await expect(rows).toHaveCount(allSlotIds().length);
    // Spot-check one row of each channel: grown female gazelle is an italic G.
    const gazelle = page.locator('[data-slot-id="species:herbivore.gazelle:grown:female"] .slot-glyph');
    await expect(gazelle).toHaveText('G');
    await expect(gazelle).toHaveCSS('font-style', 'italic');
    // The committed default sheet loads, so the sheet canvas (not the
    // how-to-supply-one empty state) is showing.
    await expect(page.locator('.sheet-canvas')).toBeVisible();
    await expect(page.locator('.sheet-empty')).toBeHidden();
  });

  test('select a glyph, then a sprite → the assignment persists; tint via swatch; clear via button', async ({ editorPage: page }) => {
    await seedSheet(page);
    const slotId = 'species:herbivore.gazelle:grown:female';
    await page.locator(`[data-slot-id="${slotId}"]`).click();
    await clickSheetCell(page, 1, 0);
    let config = await storedConfig(page);
    expect(config.assignments[slotId]).toEqual({ col: 1, row: 0, tint: null });

    // Tint from the Dracula swatches (first swatch = background #282A36).
    await page.locator('#tint-swatches .swatch').first().click();
    config = await storedConfig(page);
    expect(config.assignments[slotId].tint).toBe('#282A36');

    // No tint → back to sheet colors.
    await page.locator('#tint-clear').click();
    config = await storedConfig(page);
    expect(config.assignments[slotId].tint).toBe(null);

    // The assignment survives a reload.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#slots-panel .slot-row');
    config = await storedConfig(page);
    expect(config.assignments[slotId]).toEqual({ col: 1, row: 0, tint: null });

    // Clear assignment → back to the glyph.
    await page.locator(`[data-slot-id="${slotId}"]`).click();
    await page.locator('#assignment-clear').click();
    config = await storedConfig(page);
    expect(config.assignments[slotId]).toBeUndefined();
  });

  test('picking a sprite first, then a glyph, also assigns', async ({ editorPage: page }) => {
    await seedSheet(page);
    await clickSheetCell(page, 0, 0);
    await expect(page.locator('#editor-status')).toContainText('in hand');
    await page.locator('[data-slot-id="terrain:water"]').click();
    const config = await storedConfig(page);
    expect(config.assignments['terrain:water']).toEqual({ col: 0, row: 0, tint: null });
  });

  test('canvas background: swatch sets it, default clears it', async ({ editorPage: page }) => {
    await seedSheet(page);
    await page.locator('#background-swatches .swatch').last().click();
    let config = await storedConfig(page);
    expect(config.canvasBackground).toBe('#FFFFFF'); // bright-white is last
    await page.locator('#background-clear').click();
    config = await storedConfig(page);
    expect(config.canvasBackground).toBe(null);
  });

  test('reset forgets the stored config', async ({ editorPage: page }) => {
    await seedSheet(page);
    await page.locator('[data-slot-id="terrain:ground"]').click();
    await clickSheetCell(page, 0, 0);
    expect(await storedConfig(page)).not.toBe(null);
    await page.locator('#config-reset').click();
    expect(await storedConfig(page)).toBe(null);
  });

  test('export downloads the config as valid JSON', async ({ editorPage: page }) => {
    await seedSheet(page);
    await page.locator('[data-slot-id="terrain:ground"]').click();
    await clickSheetCell(page, 1, 0);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#config-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('sprite-config.json');
    const text = await new Response(await download.createReadStream()).text();
    const exported = JSON.parse(text);
    expect(exported.version).toBe(1);
    expect(exported.assignments['terrain:ground']).toEqual({ col: 1, row: 0, tint: null });
  });
});
