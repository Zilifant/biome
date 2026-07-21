## State at handoff

**As of 2026-07-20.** The renderer's counterpart to the repository's
`HANDOFF.md`. Every figure below is a reading taken on a date, not a standing
fact — `PLAN-RENDERER.md` keeps the historical ones beside the phase that took
them.

|                       |                                                              |
| --------------------- | ------------------------------------------------------------ |
| Phases complete       | **A, B, C complete** — Phase D (stepping back) is next         |
| Tests                 | 645 passing / 0 failing, 167 suites (renderer 77, runner 7)  |
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

**B5–B7 completed Phase B**: the selected animal's detail now re-fetches every
two seconds while the panel is open, every `#123` in the inspector and event log
selects and centres that animal, and the legend is generated from the appearance
registries.

B5 is the one to understand before touching the panel, because it changed how
rendering works rather than adding to it. Polling every two seconds was only
viable once a fresh payload stopped counting as a change of *shape* — see the
next section.

**C1–C4 completed Phase C.** Run state is polled from the host rather than
remembered, `Controls.js` was replaced with a transport bar, stepping pauses
first, and — the one change outside `src/renderer/` — the runner coalesces a
multi-tick step into a single delta. `test/runner.test.js` is new and is where
the server-side behaviour is pinned.

What remains is **Phase D** (stepping backward), which is a decision before it
is an implementation: D1 don't offer it, **D2 a renderer-side review buffer
(recommended)**, D3 a true engine rewind that belongs in `PLAN.md` as its own
step because it changes the protocol. Then **Phase E** (fixtures and docs), of
which E3 is the one with real value left.

## Conventions that are easy to miss

These are load-bearing and cost real time to rediscover.

⚠ **The panel has three update paths, and putting a value in the wrong one
fails silently.** In increasing order of cost:

| Path | For | Symptom of getting it wrong |
| --- | --- | --- |
| `liveFields` + a `data-live` span | any value that changes per tick or per poll | the row freezes at its build-time value |
| `#patchSections` (automatic) | section bodies and badges | — reconciled by content hash |
| `structureSignature` | anything that can **appear or vanish** | patching a node that does not exist: nothing happens |

The rule: **values are patched, shapes are rebuilt.** The signature errs toward
rebuilding, so a mistake there costs a wasted rebuild rather than a wrong
display — prefer that direction. A fresh inspection payload for the same animal
must *not* change the signature, or B5's polling resets the panel every two
seconds; there is a test asserting exactly that.

⚠ **Values that change under a *stationary* selection are easy to miss.** Grass
grows, ground wears, and a fire counts down while nobody moves — those ground
rows were baked in at build time from Phase A until B5 caught it. If a value
comes from the world rather than from the selection, it is a live field.

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
expandable row. The `id` keys the remembered open-set *and* the reconciliation,
so it must be stable. `describeSections` assembles them and is pure, which is
what makes the whole collapsible layer testable without a DOM.

**The legend is generated, never written.** `describeLegend()` reads the
appearance registries, so adding a species updates it for free and it cannot
drift from what the grid draws. Four tests enforce that every registry entry
reaches it — if you add a registry, add it to `describeLegend` and to those
tests, or the legend quietly stops being complete.

⚠ **Escape before you linkify.** Event-log lines are plain text containing `<`
and `>` (`<until t1205>`), so `linkifyIds(escapeHtml(text))` is the only safe
order. The reverse lets an event's own punctuation become markup. Tested.

⚠ **Do not run BSD `sed -i` over `InspectorView.js`.** It holds multi-byte
box-drawing characters (`▮ ▯ ▰ ─ █`) for the trait and severity bars, and a
`sed` pass has already written a **NUL byte** into a template literal there.
`file(1)` then reports the source as binary and `grep` silently refuses to
search it — while `node --check` passes and the code runs. Use a text-aware
editor.

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

⚠ **Report host state, never remember it.** `#runState` in `RendererApp` is
whatever `/api/status` last said, topped up from the `paused`/`speed` that every
command result carries. `paused: null` means "not yet known" and renders as `…`.
The previous version remembered what *this* client had asked for, which was
wrong the moment anything else touched the simulation — and the symptom was
Space doing the opposite of what the button said. Any future control over host
state belongs in that same shape.

⚠ **A poll must not fight the user.** The speed `<select>` is not written back
while it has focus, or a poll landing mid-interaction yanks the dropdown out
from under the pointer. Anything else that both polls and accepts input needs
the same guard.

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

## Next phase specifics (Phase D — stepping backward)

**Decide before implementing.** The engine only moves forward; there is no
reverse command and `validateCommand` requires `ticks >= 1`.

- **D2 is the recommendation**: a bounded ring (~300 ticks) of state the
  renderer has already received, scrubbed read-only behind a loud `REVIEW t1234`
  badge with a "return to live" button. No protocol change, no engine change,
  and it does not violate the §2 corollary — re-displaying authoritative output
  already received is allowed; synthesizing a state is not. State its two limits
  in the UI rather than hiding them: only what this client has seen since
  connecting, and bulk snapshot fields only (inspection detail is not buffered).
- **D3 (true engine rewind) belongs in `PLAN.md`, not here.** The persistence
  layer already supports it — ring of `captureSimulationState`, restore nearest,
  replay forward — but it needs a new command, a protocol version bump, and a
  forced full-snapshot resync for every client. That is an engine step.
- ⚠ **Whatever D does, it must not look live.** The one thing the renderer must
  never do is show a past tick as though it were the present.

After D, **Phase E** is mostly bookkeeping except **E3** (an `entity.inspection`
fixture), which is what would make the panel developable offline — and that
matters more now that sections are the bulk of it.

- **P11 is still open and now cheap.** The run state is known, so backing the
  inspection poll off while paused is a two-line change; it was left undone
  because re-fetching identical data is cheap and the complexity is not
  obviously worth it. Judgement call, not an oversight.

## Things deliberately left undone

Recorded in `PLAN-RENDERER.md` §4 with reasoning; the ones most likely to matter
next:

- **⚠ P12** — a coalesced delta is ~95% event payload, and a step long enough to
  overrun the bounded outbox drops events: ~77 000 emitted at 500 ticks, 8 810
  delivered. World state stays exact; the narration does not. If it ever
  matters, the honest fix is for a long step to send *no* events rather than a
  truncated set — which is a protocol question, not a renderer one.
- **P13** — a large advance blocks the host for its whole run (~1.4 ms/tick), so
  10 000 ticks is ~14 s unresponsive. The UI's defaults stay under a second; a
  genuinely long run belongs in `npm run headless`.
- **⚠ P1** — per-cell territory ownership is not shown, and cannot be without
  the claim layer being projected (`PLAN.md` §1.4 **A36**).
- **⚠ P9** — the popover's DOM behaviour is unverified in a browser; see above.
- **P6** — fixture mode has no inspection or metrics data at all, so the panel
  shows ground and bulk fields but no sections at all offline (E3). More
  annoying now that sections are the bulk of the panel.
- **P11** — the inspection poll runs at a fixed 2s whether the simulation is
  paused or running at 8×. Deliberate (it is a UI refresh, not an observation),
  but revisit with C1.
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
