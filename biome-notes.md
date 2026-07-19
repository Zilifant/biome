Deviations and issues flagged across Steps 1–12
A. Deliberately deferred / simplified scope

Step 2 — Terrain legend at terrain.cellTypes, not world.cellTypes.
Step 2 — Cover as clumped patches, not per-cell scatter (per-cell fragmented the RLE: 916 KB → 118 KB).
Step 3 — Individual tree/shrub entities omitted (plan marked optional).
Step 6 — Bounded lifeEvents list deferred → Step 13.
Step 7 — Renderer debug overlay of perceived cells deferred.
Step 8 — approachFood folded into seekFood (identical mechanics).
Step 8 — Action glyph tint deferred.
Step 10 — Optional drink event skipped (redundant with public action).
Step 12 — No sexes; lower id gestates → Step 22.
Step 12 — seekMate steers but doesn't assess mate quality → Step 22.
B. Config / structural debt
11. Step 4 — createDemoSimulation.js not renamed (churn); config.demo kept for scenario selection.
12. Steps 6/10/11 — Metabolism, hydration, aging params in global config, not per-species → Step 29.
13. Step 7 — Perception radius is per-species (registry) — an inconsistent pattern vs. #12 → Step 29 to unify.
14. Step 8 — utilityBreakdown persisted per entity (save-size risk at 25k) → Step 30.
15. Step 11 — age stored/incremented rather than birthTick-derived; staggering supported but unused.

C. Known behavioural limitations
16. ⚠ Steps 2/3/5 — Spawning still ignores terrain; animals can spawn on rock. Latent since Step 2, surfaced as 4 test failures in Step 11 when an RNG draw shifted positions.
17. ⚠ Step 12 — Parent refs are valid only because nothing is ever removed; Step 18 carcass decay breaks this.
18. Steps 1/9 — High per-tick event volume (entity.moved per animal, entity.fed per eater).
19. Step 10 — One lake + no memory ⇒ thirst deaths; mitigated by tuning dehydrationRate to 0.02 → real fix is Step 15.
20. Step 12 — Reproduction first exploded exponentially (8 → 1037); re-tuned to costly. Real checks are Steps 16/25.
21. Step 7 — Perception is the dominant per-tick cost (O(r²)) → Step 30.
22. Steps 5/9 — Current-cell terrain modifier; in-cell feeding (both deliberate).

D. Test/benchmark fragility
23. The determinism benchmark assertion was rewritten four times as biology landed.
24. seekWater is seed-dependent (test pinned to seed 7).
25. Float32 biomass required loosened tolerances (1e-5).
26. Bookkeeping bug found during this review: all twelve completed steps still read **Status:** Not started — only the checkboxes had been updated. Since the execution protocol keys off "the next incomplete step," this could have misled a future session into redoing Step 1.

Changes to PLAN.md
- Fixed the twelve **Status:** lines to Done.
- Added §1.4 "Carried-forward deviations and open issues" — the full list above as four tables (A–D), with ⚠ marking the two items that are real latent problems rather than deferred scope.
- Wired pointers into the inheriting steps: 13 (A4, ⚠C1), 15 (C4 + re-check the dehydration rate afterwards), 18 (⚠C2, called out as breaking a standing assumption, with the specific test that must not start passing vacuously), 22 (A9/A10), 29 (B1–B4 config debt), 30 (B5, B6, C3, C6 as profiling candidates).
- Added an "Observed status" table to the risk register recording which risks actually materialised with evidence — explosion and tick-budget overruns did (twice each, both contained), while determinism, boundary coupling, and duplication have held.