# Working in this repo

**Read `DOCS.md` before making changes.** §14 is testing, §13 performance,
§1 open work.

## How to report back: plain words, exact names

Explain findings the way you would to a smart colleague who does **not** know
this codebase — short sentences, no jargon, no ceremony — but **keep the section
headings**. Headings are how a long answer stays scannable; the prose underneath
them is what should get simpler.

**Plain language for the _mechanism_, exact names for the _code_.** Those are not
in tension, and dropping either one ruins the answer:

- ⛔ "Tuned the cooperative defence threshold" — unfalsifiable, unsearchable.
- ⛔ "Set `DEFAULT_MOBBING.minMobbers = 1` in `predation/mobbing.js`" — accurate
  and says nothing about what changed in the world.
- ✅ "Buffalo wouldn't fight back because the rule said _wait for 2 other adults_
  — but a lion hunt separates its target from the herd, so that count was checked
  at the one moment it could never be true. `mobbing.minMobbers: 2 → 1`."

Always give the reader something they can grep: `mobWeight`,
`mobbing.range: 6 → 9`, `predation/mobbing.js`, `A100`. Write value changes as
`old → new`, and put measurements in a small table rather than a sentence.

⚠ **Say what you did _not_ establish, in the same plain register.** "That 20%
comes from only 20 attacks, so read it as the bottom of the range, not as exactly
20%" belongs in the answer. So does "the flaky test passes now, but not because I
fixed it." A confident summary that hides its own sample size is the failure mode
this section exists to prevent — this project's documentation is unusually honest
about what it has not measured, and a report should match.

## Know what a run costs — and it is not what this file used to say

⚠⚠ **Re-measured 2026-08-09 and the old numbers were wrong by ~10×.** This file
said `npm test` was **47 min on 4 cores (~11 min on 10)**. On this machine, after
the `persistence.test.js` fix (**A99**), it is **~4m20s** — timed five times,
range 4m13s–4m25s. `test:fast` read "~15 min" and is **2m35s**. Two causes, and
both matter: the 47 min predates a machine change, and `persistence.test.js` used
to OOM and hang forever, so for the two days before A99 **no full-suite timing was
even obtainable**.

| rung                        | command                                                                |  measured |
| --------------------------- | ---------------------------------------------------------------------- | --------: |
| one test                    | `node --test --test-name-pattern="the exact name" test/x.test.js`      |    ~0.3 s |
| one file (sandbox tests)    | `node --test test/wetness.test.js`                                     |    ~0.2 s |
| one file (typical)          | `node --test test/engineering.test.js`                                 |    ~2.5 s |
| a file minus its demo block | `node --test --test-skip-pattern='(demo\|persistence)' test/x.test.js` |      ~1 s |
| ⚠ a demo-backed file        | `node --test test/cooperation.test.js`                                 | **2m05s** |
| the fast tier               | `npm run test:fast`                                                    |     2m35s |
| everything                  | `npm test`                                                             | **4m20s** |

✅ **The rule, loosened.** Iterate on rungs 1–4 while editing. Beyond that,
**`npm test` is now cheap enough to just run** — it is only ~1.7× the fast tier,
and it is the one that covers the demo, persistence and determinism suites where
cross-cutting regressions actually land. Prefer it over `test:fast` whenever a
change is complete, and do not treat it as a once-per-phase ceremony.

⛔ Still not after every edit: 4m20s × 20 edits is an afternoon. Run the file you
just changed.

⚠ Re-time this table if it starts feeling wrong. It was stale for long enough to
shape how everyone worked around it, which cost far more than the runs would have.

## ⚠⚠ The expensive thing is a measurement sweep, not a test run

This is the inversion the numbers above create, and it is the one to internalise.
Measured across the mobbing investigation (**A100**): **8 tuning probes cost
22m10s** against **8m42s for two full `npm test` runs**. The suite was the cheap
part by 2.5×.

A probe that sweeps the demo is 6 seeds × 6000 ticks = **36 000 ticks ≈ 2m05s**,
the same budget §"State the tick cost" flags as the most expensive single decision
in the suite. Four rules, each from a specific waste in that session:

- **Decide every number you need _before_ the run.** One 4m15s probe existed only
  to re-collect population counts left out of an earlier one.
- **Put multiple arms in one process** when the parameter is config-level
  (`mobbing.minMobbers`, `mobbing.range`). Three arms in one run cost 6m10s;
  separately they would have cost the same plus three world builds.
  ⚠ Species fields (`behavior.mobWeight`, `behavior.defendRange`) are frozen at
  import, so those genuinely need one process per value — plan for it.
- **Stop when a lever saturates.** `mobbing.range: 9 → 12` returned byte-identical
  counts: 2m07s to learn nothing. Two points that agree means stop, not extrapolate.
- **Start with the fewest seeds that could answer the question.** The first probe
  used 3 seeds and 69s to establish "0%, and the gate failing is upstream of the
  weights" — which was enough to direct everything after it.

⚠ And **report the sample size with the result**. A 6-seed sweep of a rare event
(20 lion-on-buffalo attacks total) has a wide interval either side; saying "20%"
without "n=20" invites the next person to tune against noise.

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
is 6 seeds × 6000 demo ticks = **36 000 ticks in one test** — a deliberate,
documented call, but the most expensive single decision in the suite. Widening a
seed list or a horizon is a budget decision: record the tick count and the reason
in the test, and in the DOCS entry for the phase.

⚠ **Re-measured 2026-08-09: that sweep is ~2m05s, not the ~4 min this line used
to claim** — the same ~2× overstatement as the suite timings above, and from the
same stale baseline. The _decision_ it describes is unchanged; only the price is.

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
