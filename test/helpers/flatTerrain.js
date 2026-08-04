/**
 * The featureless world most behavioural suites want to run in.
 *
 * ⚠ **This exists because "flat" was spelled out ~25 times and stopped being
 * true.** Every sandbox in the suite carried its own literal —
 * `{ lakes: 0, ridges: 0, thickets: 0, coverPatchDensity: 0 }` — which was
 * complete on the day it was written and silently incomplete the moment a new
 * terrain type arrived. Trees (2026-08-03) are what made that concrete: they
 * ship as a raw *count* rather than a density, exactly as `ridges` and
 * `thickets` do, so the demo's 60 lone trees landed unchanged in a 32×32
 * sandbox — **~12% of it**, against 2.5% of the demo world — and about twenty
 * suites quietly began testing a wooded map. Five of them noticed. The rest
 * passed, which is the worse outcome.
 *
 * So: one home for "no terrain at all", and a rule that comes with it —
 * **a new terrain generator quantity must be zeroed here in the same commit
 * that adds it.** That is the same discipline `DEFAULT_TERRAIN_PARAMS` already
 * has for the config (one home, re-exported, never a second copy).
 *
 * Spread it, and override what a suite actually wants:
 *
 *   terrain: { ...FLAT_TERRAIN }              // nothing at all
 *   terrain: { ...FLAT_TERRAIN, lakes: 1 }    // water and nothing else
 *   terrain: { ...FLAT_TERRAIN, thickets: 4 } // a stand to test against
 */
export const FLAT_TERRAIN = Object.freeze({
  lakes: 0,
  ridges: 0,
  thickets: 0,
  coverPatchDensity: 0,
  treeGroves: 0,
  treeSingles: 0,
});
