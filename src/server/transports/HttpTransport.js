/**
 * HTTP transport adapter. Translates HTTP requests to runner/protocol calls
 * and back — no simulation logic lives here, and nothing engine-internal is
 * exposed.
 *
 * ⚠ **Every route reads its runner off the request**, never off a captured
 * variable, because the host serves one world per visitor (`SessionRegistry`).
 * That is the only structural change this file needed: the routes themselves
 * are unchanged, since a route was always "ask *a* runner and project the
 * answer" and never "ask *the* runner".
 */
import express from 'express';
import { buildStatusReport, buildEntityInspection, buildTerrainResponse, parseBoundsQuery, buildMetricsReport } from '../../protocol/queries.js';
import { formatErrors } from '../../protocol/validation.js';
import { CommandTypes } from '../../protocol/commands.js';
import { checkCommand, guardedCommandHandler } from '../publicLimits.js';

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
 * @param {object} [options]
 * @param {import('../SessionRegistry.js').SessionRegistry} options.sessions
 * @param {import('../PresetStore.js').PresetStore} [options.presets] omit to serve no preset routes
 * @param {object | null} [options.limits] public command ceiling; null = unlimited
 * @param {boolean} [options.admin] when false, preset writes are refused
 * @returns {import('express').Router}
 */
export function createHttpRouter({ sessions, presets, limits = null, admin = false } = {}) {
  const router = express.Router();

  /**
   * The runner for this request's session, **built on first use**.
   *
   * ⚠ Returns null once the host is at capacity, having already answered 503.
   * Every route below must therefore bail on null rather than assume a runner —
   * the alternative is attaching a stranger to somebody else's world, which is
   * exactly the bug this whole layer exists to prevent.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  function runnerFor(req, res) {
    const session = sessions.resolve(/** @type {any} */ (req).sessionId);
    if (!session) {
      res.status(503).json({
        ok: false,
        error: { code: 'server-full', message: 'too many simulations are running right now; try again shortly' },
      });
      return null;
    }
    return session.runner;
  }

  router.get('/status', (req, res) => {
    const runner = runnerFor(req, res);
    if (!runner) return;
    res.json(buildStatusReport(runner.getStatus()));
  });

  router.get('/snapshot', (req, res) => {
    const parsed = parseBoundsQuery(req.query);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: { code: 'invalid-bounds', message: formatErrors(parsed.errors) } });
      return;
    }
    const runner = runnerFor(req, res);
    if (!runner) return;
    res.json(runner.getFullSnapshot({ bounds: parsed.bounds }));
  });

  router.get('/terrain', (req, res) => {
    const runner = runnerFor(req, res);
    if (!runner) return;
    res.json(buildTerrainResponse({ simulationId: runner.engine.simulationId, terrain: runner.getTerrain() }));
  });

  router.get('/metrics', (req, res) => {
    const runner = runnerFor(req, res);
    if (!runner) return;
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
    const runner = runnerFor(req, res);
    if (!runner) return;
    const entity = runner.inspectEntity(entityId);
    const body = buildEntityInspection({
      simulationId: runner.engine.simulationId,
      tick: runner.engine.tick,
      entity,
    });
    res.status(entity ? 200 : 404).json(body);
  });

  router.post('/commands', (req, res) => {
    const runner = runnerFor(req, res);
    if (!runner) return;
    // The public ceiling is checked here rather than inside the runner: what a
    // deployment can afford is a host fact, not a simulation one.
    const result = guardedCommandHandler(runner, limits)(req.body);
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
  //
  // ⚠ **Reads are public; writes are admin-only.** Presets are a single store
  // shared by every visitor — unlike a world, they are *not* per-session — so on
  // a public host an open write route lets any visitor overwrite or delete the
  // worlds every other visitor sees. Curating them is an operator act.
  if (presets) {
    // ⚠ **A public host lists only the worlds it will actually build.** The
    // preset directory is the operator's, and it may well hold worlds far above
    // the public ceiling — the committed Ngorongoro studies run to 4700×3950 and
    // 10 000 founders, which is what the ceiling exists to refuse. Offering
    // those to a visitor would be offering a button that always fails, so the
    // list is filtered by the same check the command path applies. An operator
    // (admin, no limits) sees everything.
    router.get('/presets', (_req, res, next) => {
      handlePreset(res, async () => {
        const all = await presets.list();
        const runnable = all.filter(
          (preset) => checkCommand({ type: CommandTypes.SIMULATION_RESTART, ...preset.world }, limits) === null,
        );
        return { ok: true, presets: runnable };
      }).catch(next);
    });

    router.get('/presets/:slug', (req, res, next) => {
      handlePreset(res, async () => ({ ok: true, preset: await presets.read(req.params.slug) })).catch(next);
    });

    const requireAdmin = (_req, res, next) => {
      if (admin) return next();
      res.status(403).json({
        ok: false,
        error: { code: 'read-only-presets', message: 'this host serves presets read-only' },
      });
    };

    // Save under a name, letting the host derive the slug.
    //
    // ⚠ This route exists so the **renderer never has to slugify**. The slug
    // rules are a security boundary (see `presetSlug`), and a second copy of
    // them in client code — which may not import from `src/server` — is a copy
    // that can drift from the one that actually guards the filesystem. A client
    // that already knows a preset's slug uses PUT below; one that only has a
    // name the person typed uses this.
    router.post('/presets', requireAdmin, (req, res, next) => {
      handlePreset(res, async () => {
        const saved = await presets.save({ name: req.body?.name, world: req.body?.world });
        return { ok: true, preset: saved };
      }).catch(next);
    });

    router.put('/presets/:slug', requireAdmin, (req, res, next) => {
      handlePreset(res, async () => {
        // The slug in the path is authoritative for *where* it is stored; the
        // body's `name` is the human label. A body naming a different preset
        // would otherwise write to a path the caller did not address.
        const name = typeof req.body?.name === 'string' && req.body.name.length > 0 ? req.body.name : req.params.slug;
        const saved = await presets.save({ name, slug: req.params.slug, world: req.body?.world });
        return { ok: true, preset: saved };
      }).catch(next);
    });

    router.delete('/presets/:slug', requireAdmin, (req, res, next) => {
      handlePreset(res, async () => ({ ok: true, removed: await presets.remove(req.params.slug) })).catch(next);
    });
  }

  return router;
}
