import { test, expect, SNAPSHOT, readRegion, countColor } from './helpers/app.js';

/**
 * Status marks: a small dot, diamond, or up-pointing double chevron in the
 * upper-left corner of a cell, saying that the animal standing there is hurt,
 * ill, carrying, in season, dispersing, up a tree, or on the wing.
 *
 * ⚠ **The cycling is the part only a browser can answer.** An animal in several
 * statuses shows them one at a time on a *wall* clock, so it keeps turning over
 * while the simulation is paused — which is precisely when someone is reading
 * the marks. Nothing about that is visible to a node test: it is a property of
 * the rAF loop, and the proof is that the canvas changes while the world does
 * not.
 */
test.describe('status marks', () => {
  /** Two Dracula tokens the marks use and nothing else on screen does. */
  const PINK = [255, 121, 198]; // carrying young
  const ORANGE = [255, 184, 108]; // hurt

  // ⚠ The animal nearest the middle of the world, not merely the first one: the
  // camera opens centred, and a mark on an animal outside the viewport is a
  // test that fails for a reason that has nothing to do with status marks.
  const centre = { x: SNAPSHOT.world.width / 2, y: SNAPSHOT.world.height / 2 };
  const animal = SNAPSHOT.entities
    .filter((entity) => entity.kind === 'animal' && entity.alive !== false)
    .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];

  const delta = (baseTick, updated, events = []) => ({
    type: 'snapshot.delta',
    payload: {
      protocolVersion: SNAPSHOT.protocolVersion,
      kind: 'snapshot.delta',
      simulationId: SNAPSHOT.simulationId,
      baseTick,
      tick: baseTick + 1,
      created: [],
      updated,
      removed: [],
      events,
      lastEventSeq: (SNAPSHOT.lastEventSeq ?? 0) + baseTick + 1,
    },
  });

  /**
   * The middle of the grid as raw bytes — a box around the canvas centre, which
   * is where the camera opens and therefore where our animal is.
   *
   * ⚠ A box rather than the whole canvas, and that is not only speed: reading
   * 1440x800 pixels over CDP takes long enough that sampling a 0.5s cycle
   * *aliases*, and the test then reports "the second mark never appeared" when
   * what happened is that every sample landed on the first one.
   */
  const SAMPLE = 240;
  const gridBytes = async (page) => {
    const box = await page.locator('#biome-canvas').boundingBox();
    const x = Math.floor(box.width / 2 - SAMPLE / 2);
    const y = Math.floor(box.height / 2 - SAMPLE / 2);
    return readRegion(page, x, y, SAMPLE, SAMPLE);
  };

  test('a status paints its colour on the grid, and the glyph keeps its own', async ({ live: { page, push } }) => {
    // ⚠ Measured against a *baseline* rather than against zero. The hyena is
    // pink and the buffalo orange, so "there is pink on the grid" is a claim
    // about the fixture world rather than about the mark — and the fixtures are
    // regenerated whenever the roster changes.
    const before = countColor(await gridBytes(page), PINK);

    await push(delta(SNAPSHOT.tick, [{ ...animal, gestating: true }]));
    await expect(page.locator('#status-tick')).toHaveText(String(SNAPSHOT.tick + 1));

    await expect.poll(async () => countColor(await gridBytes(page), PINK)).toBeGreaterThan(before);
  });

  test('two statuses take turns while the simulation is paused', async ({ live: { page, push } }) => {
    const basePink = countColor(await gridBytes(page), PINK);
    const baseOrange = countColor(await gridBytes(page), ORANGE);

    await push(delta(SNAPSHOT.tick, [{ ...animal, gestating: true, healthFraction: 0.1 }]));
    await expect(page.locator('#status-tick')).toHaveText(String(SNAPSHOT.tick + 1));

    // The world is now completely still — the mocked host sends nothing more —
    // so any change on the canvas is the cycle and nothing else.
    const marks = async () => {
      const bytes = await gridBytes(page);
      return { pink: countColor(bytes, PINK) > basePink, orange: countColor(bytes, ORANGE) > baseOrange };
    };
    await expect.poll(async () => (await marks()).pink, { timeout: 4000 }).toBe(true);
    await expect.poll(async () => (await marks()).orange, { timeout: 4000 }).toBe(true);

    // ...and never both at once: one mark per cell, taking turns.
    for (let sample = 0; sample < 8; sample += 1) {
      const { pink, orange } = await marks();
      expect(pink && orange, 'a cell shows one status at a time').toBe(false);
    }
  });

  test('a kill flashes its cell red for that tick, and only that tick', async ({ live: { page, push } }) => {
    const RED = [255, 85, 85];
    const before = countColor(await gridBytes(page), RED);

    // The prey dies where it stood: the body arrives in the same delta as the
    // event, which is what lets the renderer find the cell without the protocol
    // carrying one.
    await push(
      delta(SNAPSHOT.tick, [{ ...animal, kind: 'carcass', alive: false, decayStage: 0 }], [
        { seq: (SNAPSHOT.lastEventSeq ?? 0) + 1, tick: SNAPSHOT.tick + 1, type: 'entity.killed', entityId: animal.id, predatorId: animal.id + 1 },
      ]),
    );
    await expect.poll(async () => countColor(await gridBytes(page), RED)).toBeGreaterThan(before);

    // The next tick clears it: a moment, not a layer. Nothing else about the
    // world changes here, so the red going away is the flash expiring.
    await push(delta(SNAPSHOT.tick + 1, []));
    await expect.poll(async () => countColor(await gridBytes(page), RED)).toBe(before);
  });

  test('the legend names every mark, and is open to be read', async ({ appPage: page }) => {
    // Open by default: a key you have to go and find is a key nobody reads.
    const legend = page.locator('#legend-panel details');
    await expect(legend).toHaveAttribute('open', /.*/);
    await expect(legend).toContainText('Status');
    // ⚠ Every label in the registry, listed explicitly rather than derived: this
    // spec cannot import from `app/` any more cheaply than the node suite can, and
    // the point of naming them here is that a status added to the grid and
    // forgotten in the legend fails *in a browser* too. `up a tree` arrived with
    // protocol v31 and `flying` with v32.
    for (const label of ['hurt', 'visibly ill', 'carrying young', 'in rut', 'dispersing', 'up a tree', 'flying']) {
      await expect(legend).toContainText(label);
    }
    await expect(legend).toContainText('killed here, this tick');
  });
});
