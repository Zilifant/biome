/**
 * HTTP transport adapter. Translates HTTP requests to runner/protocol calls
 * and back — no simulation logic lives here, and nothing engine-internal is
 * exposed.
 */
import express from 'express';
import { buildStatusReport, buildEntityInspection, buildTerrainResponse, parseBoundsQuery, buildMetricsReport } from '../../protocol/queries.js';
import { formatErrors } from '../../protocol/validation.js';

/** PresetError codes → HTTP status. Anything unlisted is a 500. */
const PRESET_ERROR_STATUS = Object.freeze({
  'invalid-preset-name': 400,
  'invalid-preset-world': 400,
  'preset-not-found': 404,
  'preset-unreadable': 422,
  'preset-invalid': 422,
  'preset-unsupported': 422,
  'too-many-presets': 409,
});

/**
 * Run a preset handler, turning a `PresetError` into its status and leaving
 * anything else to bubble as a 500 — an unexpected failure should not be
 * flattened into a tidy 400 that hides it.
 * @param {import('express').Response} res
 * @param {() => Promise<object>} work
 */
async function handlePreset(res, work) {
  try {
    res.json(await work());
  } catch (error) {
    const code = /** @type {{code?: string}} */ (error)?.code;
    const status = PRESET_ERROR_STATUS[code];
    if (!status) throw error;
    res.status(status).json({ ok: false, error: { code, message: String(/** @type {Error} */ (error).message) } });
  }
}

/**
 * @param {import('../SimulationRunner.js').SimulationRunner} runner
 * @param {object} [options]
 * @param {import('../PresetStore.js').PresetStore} [options.presets] omit to serve no preset routes
 * @returns {import('express').Router}
 */
export function createHttpRouter(runner, { presets } = {}) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json(buildStatusReport(runner.getStatus()));
  });

  router.get('/snapshot', (req, res) => {
    const parsed = parseBoundsQuery(req.query);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: { code: 'invalid-bounds', message: formatErrors(parsed.errors) } });
      return;
    }
    res.json(runner.getFullSnapshot({ bounds: parsed.bounds }));
  });

  router.get('/terrain', (_req, res) => {
    res.json(buildTerrainResponse({ simulationId: runner.engine.simulationId, terrain: runner.getTerrain() }));
  });

  router.get('/metrics', (_req, res) => {
    res.json(
      buildMetricsReport({
        simulationId: runner.engine.simulationId,
        metrics: runner.engine.world.metrics,
        history: runner.engine.world.metricsHistory,
      }),
    );
  });

  router.get('/entities/:id', (req, res) => {
    const entityId = Number(req.params.id);
    if (!Number.isInteger(entityId) || entityId < 1) {
      res.status(400).json({ ok: false, error: { code: 'invalid-entity-id', message: 'entity id must be a positive integer' } });
      return;
    }
    const entity = runner.inspectEntity(entityId);
    const body = buildEntityInspection({
      simulationId: runner.engine.simulationId,
      tick: runner.engine.tick,
      entity,
    });
    res.status(entity ? 200 : 404).json(body);
  });

  router.post('/commands', (req, res) => {
    const result = runner.handleCommand(req.body);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // --- world presets -------------------------------------------------------
  //
  // ⚠ These read and write *stored* worlds; none of them touches the running
  // one. Loading a preset is deliberately two steps — the client fetches the
  // world here and then sends an ordinary `simulation.restart` — so that
  // commands remain the only path by which simulation state ever changes. A
  // convenience "apply this preset" route would be a second such path, and the
  // saving it offers is one HTTP call.
  if (presets) {
    router.get('/presets', (_req, res, next) => {
      handlePreset(res, async () => ({ ok: true, presets: await presets.list() })).catch(next);
    });

    router.get('/presets/:slug', (req, res, next) => {
      handlePreset(res, async () => ({ ok: true, preset: await presets.read(req.params.slug) })).catch(next);
    });

    // Save under a name, letting the host derive the slug.
    //
    // ⚠ This route exists so the **renderer never has to slugify**. The slug
    // rules are a security boundary (see `presetSlug`), and a second copy of
    // them in client code — which may not import from `src/server` — is a copy
    // that can drift from the one that actually guards the filesystem. A client
    // that already knows a preset's slug uses PUT below; one that only has a
    // name the person typed uses this.
    router.post('/presets', (req, res, next) => {
      handlePreset(res, async () => {
        const saved = await presets.save({ name: req.body?.name, world: req.body?.world });
        return { ok: true, preset: saved };
      }).catch(next);
    });

    router.put('/presets/:slug', (req, res, next) => {
      handlePreset(res, async () => {
        // The slug in the path is authoritative for *where* it is stored; the
        // body's `name` is the human label. A body naming a different preset
        // would otherwise write to a path the caller did not address.
        const name = typeof req.body?.name === 'string' && req.body.name.length > 0 ? req.body.name : req.params.slug;
        const saved = await presets.save({ name, slug: req.params.slug, world: req.body?.world });
        return { ok: true, preset: saved };
      }).catch(next);
    });

    router.delete('/presets/:slug', (req, res, next) => {
      handlePreset(res, async () => ({ ok: true, removed: await presets.remove(req.params.slug) })).catch(next);
    });
  }

  return router;
}
