/**
 * A right-sized demo world, for claims that do not depend on how big the world is.
 *
 * ⚠⚠ **Read the rule before using this, because it is easy to use somewhere it
 * quietly changes what a test asserts.**
 *
 * The suite is CPU-bound on simulation ticks — ~237 000 of them at ~7 ms each
 * (DOCS §14) — and the single largest reason is that dozens of tests reach for
 * `createDemoSimulation()` and get the full `ngorongoro-500-10x` world: 332×280,
 * ~500 founders. Measured 2026-08-05, 1000 ticks: **6.2 s** for that world against
 * **1.6 s** for the one below, i.e. **3.9×**.
 *
 * ✅ **Legitimate for:** determinism guards (`two runs are byte-identical`),
 * save/load round trips (`the restored run continues identically`), stream
 * independence, and protocol projection — every claim whose truth is a property of
 * the *machinery* rather than of the population. Two engines either agree byte for
 * byte or they do not, and five hundred animals do not make that more true than
 * sixty.
 *
 * ⛔ **Never for an ecological claim.** `the demo sustains both species`,
 * `carcasses stop accumulating`, `the demo shows all four stages` — there the demo
 * *is* the claim, and shrinking the world silently changes what is being asserted
 * into something nobody chose. Those tests are expensive because they are doing
 * the thing they say, and they stay expensive.
 *
 * ⚠ **It is a smaller world, not a different one.** The roster, the ratios, the
 * species definitions, the systems and the config are the demo's; only the founding
 * *counts* and the map are scaled. So a test that passes here is exercising the
 * same code paths in the same order — which is the whole basis for the swap being
 * safe. ⚠ Counts floor at 1 rather than 0, so no species silently vanishes from a
 * roster a test may be counting on.
 *
 * ⚠ **A save from this world restores into this world**, with no extra argument:
 * `captureSimulationState` stores the config verbatim and `restoreDemoSimulation`
 * rebuilds from it, so a round-trip test needs no second call to this helper.
 *
 * ⚠ **The 160×120 map is the pre-2026-08-04 demo's**, chosen so the scaled roster
 * sits at a comparable density rather than rattling around in an empty crater —
 * density is what drives perception, sociality and predation, and a sparse world
 * would exercise them *less*, which is the one way a smaller world could weaken a
 * test without anyone noticing.
 */
import { SimulationEngine } from '../../src/simulation/engine/SimulationEngine.js';
import { createDemoSimulation } from '../../src/fixtures/createDemoSimulation.js';

/** Share of the demo's founding counts this world keeps. */
export const SMALL_DEMO_SCALE = 0.3;

const DEFAULTS = new SimulationEngine().config;

/** The config override, resolved once — it is a pure function of the demo's own. */
export const SMALL_DEMO_CONFIG = Object.freeze({
  world: Object.freeze({ width: 160, height: 120 }),
  demo: Object.freeze({
    founding: Object.freeze(
      DEFAULTS.demo.founding.map((cohort) =>
        Object.freeze({ ...cohort, count: Math.max(1, Math.round(cohort.count * SMALL_DEMO_SCALE)) }),
      ),
    ),
  }),
});

/**
 * The demo world at ~30% of its founding roster on a 160×120 map.
 *
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {object} [options.config] merged over the small-world config, for a test
 *        that also needs to switch a mechanism off
 * @returns {SimulationEngine}
 */
export function smallDemo({ seed = 42, config = {} } = {}) {
  return createDemoSimulation({ seed, config: { ...SMALL_DEMO_CONFIG, ...config } });
}
