import { test, expect, SNAPSHOT } from './helpers/app.js';

/**
 * A log line is about a moment; an entity is about now.
 *
 * The reported symptom: `> hunt p122 → %65 caught (55%)`, because by the time
 * the line was drawn its prey was already a carcass — and `> hunt p123 → #4
 * missed` once the body had decayed out of the world entirely. The line never
 * changed; what it was resolved against did. The store now keeps the last form
 * each id was seen alive in, and this drives the whole path in a browser: kill
 * an animal, then remove it, and watch the reference stay what it was.
 */
test.describe('event log references outlive the animal', () => {
  /** The first living animal in the committed snapshot — the one we will kill. */
  const prey = SNAPSHOT.entities.find((entity) => entity.kind === 'animal' && entity.alive !== false);
  const predator = SNAPSHOT.entities.find(
    (entity) => entity.kind === 'animal' && entity.alive !== false && entity.id !== prey.id,
  );

  const delta = (baseTick, overrides) => ({
    type: 'snapshot.delta',
    payload: {
      protocolVersion: SNAPSHOT.protocolVersion,
      kind: 'snapshot.delta',
      simulationId: SNAPSHOT.simulationId,
      baseTick,
      tick: baseTick + 1,
      created: [],
      updated: [],
      removed: [],
      events: [],
      lastEventSeq: (SNAPSHOT.lastEventSeq ?? 0) + baseTick + 1,
      ...overrides,
    },
  });

  test('a killed animal keeps its own glyph, and keeps it after the carcass is gone', async ({
    live: { page, push },
  }) => {
    // Kills are off by default; ask for them.
    await page.locator('#event-log-filters > summary').click();
    await page.locator('input[data-event-type="entity.killed"]').check();

    const base = SNAPSHOT.tick;
    const ref = page.locator(`#event-log-list [data-entity="${prey.id}"]`);

    // Tick 1: the kill. The prey arrives back in the same delta as a carcass,
    // which is exactly the window the old code resolved in.
    await push(
      delta(base, {
        updated: [{ ...prey, kind: 'carcass', alive: false, decayStage: 0 }],
        events: [
          {
            seq: (SNAPSHOT.lastEventSeq ?? 0) + 1,
            tick: base + 1,
            type: 'entity.killed',
            entityId: prey.id,
            predatorId: predator.id,
          },
        ],
      }),
    );

    await expect(ref).toBeVisible();
    const living = await ref.innerText();
    expect(living, 'the reference wears the animal, not the carcass it became').not.toContain('%');
    expect(living, 'and not the bare-id fallback').not.toContain('#');
    expect(living).toBe(`${living[0]}${prey.id}`);

    // Tick 2: the body decays out of the world. The line is unchanged, so the
    // reference must be too — this is where it used to fall back to `#65`.
    await push(delta(base + 1, { removed: [prey.id] }));
    await expect(page.locator('#status-tick')).toHaveText(String(base + 2));
    await expect(ref).toHaveText(living);
  });
});
