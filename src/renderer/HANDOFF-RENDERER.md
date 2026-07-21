## State at handoff

**As of 2026-07-20.** The renderer's counterpart to the repository's
`HANDOFF.md`. Every figure below is a reading taken on a date, not a standing
fact — `PLAN-RENDERER.md` keeps the historical ones beside the phase that took
them.

|                       |                                                              |
| --------------------- | ------------------------------------------------------------ |
| Phases complete       | A (cell selection), B4 (per-tick rebuild) — B1–B3 next        |
| Tests                 | 624 passing / 0 failing, 163 suites (renderer: 63 / 13)      |
| Protocol understood   | 27 (`SUPPORTED_PROTOCOL_VERSION`), matching the engine        |
| Zoom levels           | 10–32px; 10px is a floor, not a default                       |
| Git                   | uncommitted, as with Steps 26–29 (the user handles git)       |

Verify with: `npm test`, then `npm run dev` and open `http://localhost:3000`.
`?mode=fixture` replays the committed fixtures offline — but see the fixture
gap below before relying on it.

## Where the work stands

**Phase A and B4 landed together**, in that order, because B4 was a prerequisite
rather than a nicety: the inspector rebuilt itself from scratch on every store
change, which is once per tick, and nothing built on top of it could keep state.

What that means for the next phase: **the panel now survives a tick**, so the
collapsible sections and anchored popover of B1–B3 have somewhere to live.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

⚠ **Adding a row to the inspector means touching two places.** `liveFields` if
the value changes tick to tick, and `structureSignature` if the row can appear
or vanish. Miss the signature and you patch a node that does not exist (silently
nothing); miss `liveFields` and the row freezes at its build-time value
(silently stale). The signature errs toward rebuilding, so a mistake there costs
a wasted rebuild rather than a wrong display — prefer that direction.

⚠ **Selection is a cell, not an entity.** `store.selection` is
`{ cellX, cellY, entityIds, activeId }` where `entityIds` may be empty and
`activeId` may be **null**. Anything reading `selection.activeId` must tolerate
null; `getEntity(null)` returns null, which is why most call sites survived the
change untouched. Clicking bare ground is a selection, not a clear.

**Describe, then render.** Anything worth testing is a pure function over the
store returning a plain object — `CellDetail.describeCell` is the model, and
`structureSignature` is exported for exactly this reason. The repo has **no DOM
test dependency** (devDependencies is just nodemon), so a thing that can only be
tested through the DOM effectively cannot be tested. Design outward from a pure
core.

**Never invent a field.** If the protocol does not send it, the panel says
nothing. `resolveFeatureAppearance` and `resolveMemoryAppearance` return `null`
for kinds this build has not heard of, so a newer engine cannot break an older
renderer. `terrainPassableAt` returns `null` rather than `false` outside the
terrain for the same reason: "not told" and "impassable" are different facts.

⚠ **A per-tick cost is a real budget, and the store notifies on every change.**
`store.setFollowedEntity(null)` inside a pointermove handler re-renders every
panel at pointer rate; it is guarded to fire once per drag. Look for that shape
before adding a store write to any high-frequency handler.

**Share the geometry, do not restate it.** `CellDetail` uses the same
disturbance circle test the grid draws with, and the same `occupantsInCell` the
selection uses, so what a panel claims and what is drawn can never disagree.
`groundAppearanceAt` exists in `AsciiGridRenderer` for the same reason — the
terrain pass and the selection overlay resolve ground identically.

**Glyphs and colors live only in `EntityAppearance.js`.** Adding a species is
one entry there and nothing else. Phase B7's legend is to be *generated* from
those registries precisely so the rule enforces itself.

⚠ **Verify against a live simulation, not only fixtures.** The committed
fixtures predate several protocol layers, so `features[].wear` and
`disturbances[].until` had never been exercised by a renderer test. Running the
server and feeding a real `/api/snapshot` through the store found nothing
broken, but it is the check that would have.

## Next phase specifics (B1–B3, the tooltip)

- **B4 is done, so start from the panel that exists.** `EntityInspector.render`
  already takes a described cell as its third argument and already separates
  structure from values. B1's job is to split *presentation* out of it
  (`InspectorView` rendering into any host), not to rewrite the 14 section
  formatters — those are correct and were not touched.
- **Mount twice, fork nothing.** The popover and the sidebar are two hosts for
  one view. Forking the formatters is ~500 lines maintained in parallel.
- **`#viewport-wrap` is already `position: relative`**, so the popover has an
  anchor without touching the layout.
- **`Esc` already clears the selection**; make it close the popover too rather
  than inventing a second key.
- **Section open/closed state goes in `localStorage`** — renderer-local
  presentation state, which the store has no business holding.
- ⚠ **B5 (polling inspection while open) needs B4 to hold up under a faster
  cadence than one fetch per selection.** See P3 in `PLAN-RENDERER.md` §4: the
  inspection-derived blocks still rebuild structurally when a payload arrives,
  which is free today and may not be at 2s.

## Things deliberately left undone

Recorded in `PLAN-RENDERER.md` §4 with reasoning; the ones most likely to matter
next:

- **⚠ P4** — manual steps above ~50 ticks flood the socket, because
  `SimulationRunner.stepManually` emits one full snapshot and one delta *per
  tick*. Cap the UI until C4 coalesces them. C4 is server-side and needs no
  protocol change.
- **⚠ P1** — per-cell territory ownership is not shown, and cannot be without
  the claim layer being projected (`PLAN.md` §1.4 **A36**).
- **P6** — fixture mode has no inspection or metrics data at all, so the tooltip
  cannot be developed offline (E3). Worth doing *before* B1–B3 if the work is
  going to be done away from a running server.
- **P2** — the 6px and 8px zoom levels are gone; a 128-cell world no longer fits
  the viewport at minimum zoom. Drag-panning is the compensation, and a minimap
  was judged not worth it for one world size.
- **P5** — the renderer cannot show a tick it never received, and cannot move
  the engine backward at all. Phase D decides between saying so (D2, the
  recommendation) and a true engine rewind (D3, which belongs in `PLAN.md` as
  its own step since it changes the protocol).
- **P7** — no interpolation between ticks; `previousPosition` is tracked for it.
- **P8** — the whole world is streamed; bounded subscription awaits
  region-scoped deltas.
