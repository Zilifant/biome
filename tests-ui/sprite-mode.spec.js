/**
 * Sprite mode (`?renderer=sprite`) in offline fixture mode.
 *
 * With nothing configured, sprite mode must render the world on the ASCII
 * glyph fallback — no sheet is committed, so that is the out-of-the-box state.
 * With a config seeded into localStorage (a data:-URL sheet built in-page, so
 * no binary fixture is committed either), assigned slots must draw sprites and
 * the configured canvas background must show through.
 *
 * Assertions are relative pixel counts, per the suite convention — never exact
 * single-pixel matches.
 */
import { test, expect, readRegion, countColor, COLORS, waitForRender, gridViewportPoint } from './helpers/app.js';

/** A signature sprite colour that is deliberately not in the Dracula palette. */
const MAGENTA = [255, 0, 255];
/** A background deliberately far from the Dracula background (#282A36). */
const BACKGROUND = [10, 90, 40];

/**
 * Build a tiny spritesheet in-page (one solid magenta 16×16 sprite at col 0,
 * row 0 — matching the SHEET geometry constants), store a sprite config using
 * it, and reload so the app boots with it.
 */
async function seedSpriteConfig(page, { assignments }) {
  await page.evaluate(
    ({ assignmentSlots, backgroundHex }) => {
      const sheet = document.createElement('canvas');
      sheet.width = 16;
      sheet.height = 16;
      const ctx = sheet.getContext('2d');
      // A transparent 2px border keeps the canvas multi-coloured even when
      // every visible cell draws this sprite — waitForRender's paint check
      // needs more than one distinct colour in its corner sample.
      ctx.fillStyle = '#FF00FF';
      ctx.fillRect(2, 2, 12, 12);
      const entries = {};
      for (const slotId of assignmentSlots) {
        entries[slotId] = { col: 0, row: 0, tint: null };
      }
      localStorage.setItem(
        'biome.sprites.config.v1',
        JSON.stringify({
          version: 1,
          canvasBackground: backgroundHex,
          sheetDataUrl: sheet.toDataURL('image/png'),
          assignments: entries,
        })
      );
    },
    { assignmentSlots: assignments, backgroundHex: '#0A5A28' }
  );
  await page.reload({ waitUntil: 'load' });
  await waitForRender(page);
}

test.describe('sprite mode', () => {
  test('boots and paints on the glyph fallback when nothing is configured', async ({ spritePage: page }) => {
    // waitForRender already proved the canvas painted more than one colour.
    await expect(page.locator('#biome-canvas')).toHaveAttribute('aria-label', /Sprite grid view/);
    // The fallback draws glyphs, so no sprite signature colour is present.
    const data = await readRegion(page, 0, 0, 200, 200);
    expect(countColor(data, MAGENTA, 10)).toBe(0);
  });

  test('assigned ground slots draw sprites and the configured background shows', async ({ spritePage: page }) => {
    // Cover every ground slot so the whole visible grid becomes sprite tiles.
    const groundSlots = [
      'terrain:ground', 'terrain:water', 'terrain:rock', 'terrain:cover',
      'terrain:deep_water', 'terrain:thicket', 'terrain:outOfBounds',
      'vegetation:1', 'vegetation:2', 'vegetation:3', 'vegetation:4',
    ];
    const before = await readRegion(page, 200, 200, 100, 100);
    expect(countColor(before, MAGENTA, 10)).toBe(0);

    await seedSpriteConfig(page, { assignments: groundSlots });

    const region = await readRegion(page, 200, 200, 100, 100);
    // Ground tiles fill their cells, so the sample is dominated by the sprite
    // colour — a fraction is left to entities, features, and rounding.
    expect(countColor(region, MAGENTA, 10)).toBeGreaterThan(4000);
  });

  test('the configured canvas background shows between glyphs when only entities keep sprites', async ({ spritePage: page }) => {
    // Assign nothing: the background fill is the only configured change, and
    // it shows in the gaps the fallback glyphs leave inside each cell.
    await seedSpriteConfig(page, { assignments: [] });
    const region = await readRegion(page, 200, 200, 100, 100);
    expect(countColor(region, BACKGROUND, 26)).toBeGreaterThan(1000);
  });

  test('selection still marks the clicked cell', async ({ spritePage: page }) => {
    const point = await gridViewportPoint(page, 400, 300);
    await page.mouse.click(point.x, point.y);
    const region = await readRegion(page, 400 - 20, 300 - 20, 40, 40);
    expect(countColor(region, COLORS.selection, 6)).toBeGreaterThan(50);
  });
});
