/**
 * Query contract: status reports, entity inspection, and parsing of
 * region-bounds query parameters (used by snapshot region queries).
 */
import { PROTOCOL_VERSION } from './protocolVersion.js';
import { validateBounds } from './validation.js';

export const QueryKinds = Object.freeze({
  STATUS: 'status',
  ENTITY_INSPECTION: 'entity.inspection',
  TERRAIN: 'terrain',
  METRICS: 'metrics',
});

/**
 * Wrap a terrain projection (codes + legend, RLE) in a versioned message.
 * Full snapshots already embed terrain; this query is for explicit fetch and
 * recovery without a full snapshot.
 * @param {object} options
 * @param {string} options.simulationId
 * @param {object} options.terrain terrain projection from the engine
 */
export function buildTerrainResponse({ simulationId, terrain }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: QueryKinds.TERRAIN,
    simulationId,
    terrain,
  };
}

/**
 * Wrap a population metrics report in a versioned message (Step 21).
 *
 * Aggregates only — counts, distributions, and rates. Never per-organism
 * histories (observation roadmap, PLAN §10), and never presentation: the
 * histogram is bin counts and a range, and the renderer decides how to draw it.
 *
 * @param {object} options
 * @param {string} options.simulationId
 * @param {object|null} options.metrics latest report, or null before the first
 * @param {object[]} [options.history] bounded time series
 */
export function buildMetricsReport({ simulationId, metrics, history = [] }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: QueryKinds.METRICS,
    simulationId,
    available: metrics != null,
    metrics: metrics != null ? structuredClone(metrics) : null,
    history: structuredClone(history),
  };
}

/**
 * Wrap a host status object in a versioned status message.
 * @param {object} status
 */
export function buildStatusReport(status) {
  return { protocolVersion: PROTOCOL_VERSION, kind: QueryKinds.STATUS, ...structuredClone(status) };
}

/**
 * Build an entity inspection response.
 * @param {object} options
 * @param {string} options.simulationId
 * @param {number} options.tick
 * @param {object|null} options.entity public entity details or null when not found
 */
export function buildEntityInspection({ simulationId, tick, entity }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: QueryKinds.ENTITY_INSPECTION,
    simulationId,
    tick,
    found: entity != null,
    entity: entity != null ? structuredClone(entity) : null,
  };
}

/**
 * Parse optional bounds from string query parameters (e.g. an HTTP query).
 * All four of minX, minY, maxX, maxY must be present, or none.
 *
 * @param {Record<string, unknown>} params
 * @returns {{ok: true, bounds: {minX: number, minY: number, maxX: number, maxY: number} | null}
 *          |{ok: false, errors: import('./validation.js').ValidationError[]}}
 */
export function parseBoundsQuery(params) {
  const keys = ['minX', 'minY', 'maxX', 'maxY'];
  const present = keys.filter((key) => params[key] !== undefined && params[key] !== '');
  if (present.length === 0) {
    return { ok: true, bounds: null };
  }
  if (present.length !== keys.length) {
    return { ok: false, errors: [{ path: 'bounds', message: 'provide all of minX, minY, maxX, maxY or none' }] };
  }
  const bounds = {};
  const errors = [];
  for (const key of keys) {
    const value = Number(params[key]);
    if (!Number.isFinite(value)) {
      errors.push({ path: `bounds.${key}`, message: 'must be a finite number' });
    }
    bounds[key] = value;
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const validation = validateBounds(bounds);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, bounds };
}
