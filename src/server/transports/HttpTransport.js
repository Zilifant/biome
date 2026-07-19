/**
 * HTTP transport adapter. Translates HTTP requests to runner/protocol calls
 * and back — no simulation logic lives here, and nothing engine-internal is
 * exposed.
 */
import express from 'express';
import { buildStatusReport, buildEntityInspection, buildTerrainResponse, parseBoundsQuery } from '../../protocol/queries.js';
import { formatErrors } from '../../protocol/validation.js';

/**
 * @param {import('../SimulationRunner.js').SimulationRunner} runner
 * @returns {import('express').Router}
 */
export function createHttpRouter(runner) {
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

  return router;
}
