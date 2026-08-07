# Working in this repo

**Read `DOCS.md` before making changes.** §14 is testing, §13 performance,
§1 open work.

## ⚠ Do not run `npm test` in an edit loop

The suite is **CPU-bound on simulation ticks**, not on test count: ~237 000
ticks at 7–23 ms each. A full run is **47 min on 4 cores** (~11 min on 10).
Running it after every edit is the single largest waste of time available
in this project.

Climb this ladder, and stop at the first rung that answers your question:

| rung                        | command                                                                |              cost |
| --------------------------- | ---------------------------------------------------------------------- | ----------------: |
| one test                    | `node --test --test-name-pattern="the exact name" test/x.test.js`      |            ~0.3 s |
| one file                    | `node --test test/x.test.js`                                           |            ~2.5 s |
| a few files                 | `node --test test/a.test.js test/b.test.js`                            |           seconds |
| a file minus its demo block | `node --test --test-skip-pattern='(demo\|persistence)' test/x.test.js` |              ~1 s |
| the fast tier               | `npm run test:fast`                                                    | ~15 min (4 cores) |
| everything                  | `npm test`                                                             | ~47 min (4 cores) |

✅ **The rule:** iterate on rungs 1–4. Run `npm run test:fast` when the change
is complete. Run `npm test` **once**, before committing or claiming a phase
done — and treat a green fast tier as _not yet done_, because the demo,
persistence and determinism suites it skips are exactly where cross-cutting
regressions land.

⛔ **Never** run the full suite "to see where I am". Run the one file you
just changed.

## ⚠⚠ `--test-skip-pattern` must come BEFORE the file arguments

Verified 2026-08-07. `node --test --test-skip-pattern='demo' test/weather.test.js`
runs in **1.0 s**. Move the flag after the filename and it is **silently
ignored** — the same command runs the full 13-minute file and still exits 0.
Nothing warns you. Also: skipped tests are dropped from the `# tests` count
rather than reported as `# skipped`, so a lower count is expected.

## Writing tests: choose the world by the claim

Read the header of `test/helpers/smallDemo.js` before adding any test that
boots a world. In short:

- ✅ **`smallDemo()`** — determinism guards, save/load round trips, stream
  independence, protocol projection. Machinery claims. 3.9× cheaper.
- ✅ **A hand-built sandbox** — anything about one system. Cheapest of all,
  and most new tests belong here.
- ⛔ **`createDemoSimulation()`** — only for genuinely ecological claims
  ("the demo sustains both species"). There the demo _is_ the claim, and
  shrinking it silently changes what is asserted.

⚠ **If you use the full demo, say why in a comment on the line.** It is the
expensive choice and the reviewer cannot tell an ecological claim from an
unconsidered default without being told.

## ⚠ State the tick cost of a test you add

Ticks × seeds is the whole cost model. `cooperation.test.js`'s batch-2 sweep
is 6 seeds × 6000 demo ticks = **36 000 ticks (~4 min of CPU) in one test** —
a deliberate, documented call, but the most expensive single decision in the
suite. Widening a seed list or a horizon is a budget decision: record the
tick count and the reason in the test, and in the DOCS entry for the phase.

## ⚠ A change to the engine's per-tick cost is a change to the whole suite

Measured 2026-08-07: between the social phases (P5–P10) the full demo went
**16.6–18.2 s → 23.0–23.2 s per 1000 ticks at tick 3000** (non-overlapping
ranges, interleaved per `BENCHMARK.md`) — ~1.32×. The same tests got **1.33×
slower**, and the suite grew 31.5 → 47.4 min with only 5.7 min of that being
newly added tests. Nobody noticed until the suite felt slow.

**A phase that touches a hot path must record a per-tick reading in
`BENCHMARK.md`** — interleaved against HEAD, in one session, per that file's
own protocol. ⚠ Measure at a **mature** world (step 3000 first, then time
1000 ticks). A cold 1000-tick measurement misses cost that only appears once
groups form, and will tell you a real 32% regression is flat.
