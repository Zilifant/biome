## State at handoff

**As of 2026-07-20.** The renderer's counterpart to the repository's
`HANDOFF.md`. Every figure below is a reading taken on a date, not a standing
fact — `PLAN-RENDERER.md` keeps the historical ones beside the phase that took
them.

|                       |                                                              |
| --------------------- | ------------------------------------------------------------ |
| Phases complete       | A, B1–B4 — **B5 (poll while open) and B7 (legend) next**      |
| Tests                 | 629 passing / 0 failing, 164 suites (renderer: 68 / 14)      |
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
**B1–B3 then landed on top of it**: the inspector is now a floating popover
anchored to the clicked cell (dockable into the sidebar), with everything below
the identity block collapsed into remembered `<details>` sections.

⚠ **The popover has not been driven in a browser.** Its pure logic is tested and
its wiring was reviewed — which caught two real bugs — but positioning,
flipping, dragging, and the `<details>` toggle path stand on review rather than
evidence (P9). If you have a browser open, that is the first thing worth
clicking through: select a cell near the right edge (flip), drag the header
(pin), press dock then float, expand Genome and reload (persistence).

What remains in Phase B is **B5** (re-fetch inspection while the panel is open,
so utilities and perception stop being frozen at selection time) and **B7** (the
legend, still the highest value per line of code in the plan).

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

⚠ **Adding a row to the inspector means touching two places.** `liveFields` if
the value changes tick to tick, and `structureSignature` if the row can appear
or vanish. Miss the signature and you patch a node that does not exist (silently
nothing); miss `liveFields` and the row freezes at its build-time value
(silently stale). The signature errs toward rebuilding, so a mistake there costs
a wasted rebuild rather than a wrong display — prefer that direction.

⚠ **The view owns its container and overwrites it wholesale.** A structural
rebuild is `container.innerHTML = …`, so anything you put *inside* the view's
host survives until the next selection and then vanishes. This bit once already:
the docked "float" button was inserted into the view's container and had to move
out into its own header beside `.dock-body`. Controls go beside the view, never
in it.

⚠ **`mount()` is called repeatedly** — every dock and undock. Listeners are
bound once per host through a `WeakSet` for exactly that reason; adding an
unguarded `addEventListener` there stacks one handler per remount, and the
symptom (a toggle firing five times) looks nothing like the cause.

**Formatters return sections, not HTML.** `section(id, title, badge, body)`, or
`null` when the protocol sent nothing — an absent section beats an empty
expandable row. The `id` keys the remembered open-set, so it must be stable.
`describeSections` assembles them and is pure, which is what makes the whole
collapsible layer testable without a DOM.

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

## Next phase specifics (B5 and B7, then Phase C)

- ⚠ **B5 (polling inspection while open) is where P3 gets tested.** A new
  inspection payload changes `structureSignature` (its `tick` is in there), so
  every poll is a **full structural rebuild** — free at one fetch per selection,
  possibly not at one every two seconds with a section expanded. If it flickers,
  the fix is to split the signature so inspection-derived sections rebuild
  independently of the identity block, not to slow the poll.
- **B5 should cancel on close and on selection change**, or a fast clicker
  stacks intervals — the same shape as the `mount()` bug above.
- **B7 (legend) is unblocked and cheap.** Generate it *from* the appearance
  registries so it cannot drift from what is drawn; that is the whole reason the
  registries are the single source of glyphs. It fits naturally as one more
  collapsed section, or as its own sidebar panel.
- **Phase C's transport bar** replaces `Controls.js` wholesale. C1 (poll
  `/api/status`) is the one that removes a live wrong-answer: `#simPaused` in
  `RendererApp` is fetched once at startup and Space acts on that guess.
- ⚠ **C4 before raising the step cap.** See P4 below.

## Things deliberately left undone

Recorded in `PLAN-RENDERER.md` §4 with reasoning; the ones most likely to matter
next:

- **⚠ P4** — manual steps above ~50 ticks flood the socket, because
  `SimulationRunner.stepManually` emits one full snapshot and one delta *per
  tick*. Cap the UI until C4 coalesces them. C4 is server-side and needs no
  protocol change.
- **⚠ P1** — per-cell territory ownership is not shown, and cannot be without
  the claim layer being projected (`PLAN.md` §1.4 **A36**).
- **⚠ P9** — the popover's DOM behaviour is unverified in a browser; see above.
- **P6** — fixture mode has no inspection or metrics data at all, so the panel
  shows ground and bulk fields but no sections at all offline (E3). More
  annoying now that sections are the bulk of the panel.
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
