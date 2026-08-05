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
  // ⚠ **Not a generator count, and the reason it is here anyway** (2026-08-04).
  // `roundness` carves everything outside an ellipse to impassable rock, and the
  // demo now ships at 4 — so a sandbox that inherited the default got a rim, and
  // a suite spawning an animal at (20, 20) in a 44×44 world was placing it in the
  // sea. Same failure mode as the trees above: a terrain quantity that was zero
  // by default stopped being zero, and the sandboxes never said they wanted a
  // rectangle because they had never had to.
  roundness: 0,
  lakes: 0,
  ridges: 0,
  thickets: 0,
  coverPatchDensity: 0,
  treeGroves: 0,
  treeSingles: 0,
});
