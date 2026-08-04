# biome renderer — Reference Documentation

The browser ASCII grid renderer for the biome simulation: a dark Dracula-themed
monospace character grid, one glyph per world cell, discrete cell updates, and
compact information-dense panels. It is a **pure consumer of the protocol** — it
speaks the versioned message shapes over a transport and imports nothing from the
engine, server, or protocol code.

This document is the consolidated reference for the renderer subsystem: what it
is, how it is built, why it is shaped the way it is, and **what is still open**.
It supersedes `PLAN-RENDERER.md` (the linear phase roadmap, now A–C and F
complete) and `HANDOFF-RENDERER.md` (the session-handoff summary) as the place to
look things up. Those two remain as the historical record — every measurement
here is traceable to a dated completion note there — but nothing in this document
depends on reading them.

It is the renderer's counterpart to the repository's [`DOCS.md`](../../DOCS.md),
and it observes the same division of labour that file describes: the engine plan
advances the _simulation_, this one advances what can be _seen and steered_.

- **[`README-RENDERER.md`](README-RENDERER.md)** is the operational companion:
  how to run, the controls, and what the renderer does with **each protocol
  layer** newest-first. This document does not restate the per-layer detail —
  read that file for "what happens to a v22 `groupId`"; read this one for the
  architecture, the panel model, the conventions, the open work, and the
  reasoning.
- **Open work is collected in §1**, and also appears in the repository-wide flat
  list [`ACTION-ITEMS.md`](../../ACTION-ITEMS.md). ⚠ The two must be updated
  together.

---

## How to read this document

Measurements carry their date. Anything undated is a claim about the code as it
stands, not a reading. A dated figure is a record of what was true when it was
taken — the demo world it was measured in keeps changing underneath these
numbers, so re-measure rather than inherit.

### Current state (as of 2026-08-04)

|                     |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Phases complete     | **A, B, C, F** — Phase D (stepping back) undecided                                                                                   |
| Tests               | renderer 96 in `renderer-view.test.js`, plus the store/transport/sprite/editor suites; 13 spec files in `tests-ui`                                      |
| Protocol understood | **32** (`SUPPORTED_PROTOCOL_VERSION`), matching the engine                                                                           |
| Coverage            | every protocol layer through v32 is drawn or inspectable — `elevation` (v31) and `flying` (v32) are both **status marks** (§9)        |
| Species scheme      | **all ten roster species have a glyph** (§9), **eight of them shipped** — and no renderer code was written for any of the last four  |
| Fixtures            | current — v32, all **eight** shipped species, and **10 of 231 entities airborne** so fixture mode shows the flying mark offline; ⚠ due on every **roster** change, not only a protocol bump (§10) |
| Status marks        | **seven**, in three shape families — dot (condition), diamond (state), chevron (place). ⚠ The chevron arrived 2026-08-04 with flight  |
| Zoom levels         | 10–32px; 10px is a floor, not a default                                                                                              |
| Git                 | uncommitted (the user handles git)                                                                                                   |

Verify with `npm test`, then `npm run dev` and open `http://localhost:3000`.
`?mode=fixture` replays the committed fixtures offline — but see P6 (§1.4) before
relying on it.

---

## 1. Action items (open work)

> The repository-wide flat list is [`ACTION-ITEMS.md`](../../ACTION-ITEMS.md),
> which carries these renderer items without the reasoning and beside the
> engine's. This section is the one that carries the evidence and reasoning.
> ⚠ **They must be updated together** — closing an item, or opening one, means
> editing both.

Items keep the `P`/`E` identifiers they have in `PLAN-RENDERER.md` §4, so
cross-references in code and history keep resolving.

### 1.1 Unverified

- **⚠ The `»` flying mark has never been seen in a browser** _(2026-08-04)_. Its
  geometry is asserted through the canvas stub — twelve vertices, apex centred and
  above the mark's midpoint, cyan — and the legend row is asserted from the
  registry, but nothing has drawn it on a real canvas at a real zoom. The specific
  claim that needs a browser is **legibility at the 10px floor**, where the pair of
  chevrons is expected to fuse into one small wedge (§9); the thickness is floored
  at a whole pixel for exactly that reason and the floor is untested visually.
  ⚠ `tests-ui/status-marks.spec.js` now names `flying` and `up a tree` in the
  legend list, so the browser suite *will* cover the legend half on its next run —
  it could not be run in the environment this shipped from (no port binding), which
  is why this item exists rather than a green tick.

- **⚠ P9 — The inspector popover's _placement and hosting_ have never been driven
  in a browser.** Its pure logic is tested and its wiring was reviewed (which
  caught two real bugs — see §11), but popover positioning, edge-flipping,
  dragging, and the dock/float path have not been exercised by a real DOM.
  ⚠ **Narrowed 2026-07-28**: `tests-ui` now opens the popover, checks it against
  axe, and confirms a drag never opens it — and the `<details>` toggle path is
  covered _for the metrics panel_ (`metrics.spec.js`), including surviving a
  full rebuild. So this is no longer "no browser automation exists"; it is four
  specific interactions nobody has written a spec for. The clicks that would
  settle it: select a cell near the right edge (flip), drag the header (pin),
  press dock then float, expand Genome and reload (persistence).

### 1.2 Undecided — Phase D (stepping backward)

**"Decrement by N ticks" has no meaning yet**, and the choice is a real one
before it is an implementation. The engine only moves forward: there is no
reverse command and `validateCommand` requires `ticks >= 1`. Three recorded
options:

- **D1 — Don't offer it.** Label the control `Advance N`. Zero cost, honest.
- **D2 — Renderer-side review buffer** _(the plan's recommendation)_. A bounded
  ring (~300 ticks) of state the renderer has already received, scrubbed
  read-only behind a loud `REVIEW t1234` badge with a "return to live" button. No
  protocol change, no engine change, and it does not violate the §3 corollary —
  re-displaying authoritative output already received is allowed; synthesizing a
  state is not. Two limits to state in the UI rather than hide: only what this
  client has seen since connecting, and bulk-snapshot fields only (inspection
  detail is not buffered).
- **D3 — True engine rewind.** The persistence layer already supports it — a ring
  of `captureSimulationState` in the runner, restore the nearest, replay forward
  deterministically. Exact, and resuming genuinely continues from there. Costs a
  new `simulation.rewind` command, a protocol version bump, memory for the save
  ring, and a forced full-snapshot resync for every client. **This belongs in the
  engine plan as its own numbered step, not here** — it changes the protocol and
  the host.

⚠ Whatever D does, **it must never display a past tick as though it were the
present** (P5).

### 1.3 Known limitations

- **P1 — Per-cell territory ownership is not shown.** The protocol carries a
  claim only via a selected animal's `territory.standingOn`, not as a projected
  layer. Blocked on engine item A36 (the claim layer would need to earn its
  per-snapshot cost). `CellDetail` stays silent about ownership rather than
  guessing.
- **P5 — The renderer cannot show a tick it never received, and cannot move the
  engine backward at all.** Resolved by whatever Phase D decides; currently
  stated in the UI rather than worked around.
- **⚠ P12 — A coalesced delta is ~95% event payload**, and a step long enough to
  overrun the bounded outbox drops events: ~77 000 emitted at 500 ticks, **8 810
  delivered**. World state stays exact; the _narration_ of how it got there does
  not. Inherent to a bounded outbox rather than something coalescing introduced,
  but coalescing is what makes it easy to hit. The honest fix, if it ever
  matters, is for a long step to send _no_ events rather than a truncated set —
  which is a protocol question, not a renderer one.
- **P13 — A large advance blocks the host's event loop for its whole duration**
  (~1.4 ms/tick at demo scale), so 10 000 ticks is ~14 s unresponsive. UI
  defaults stay under a second; a genuinely long run belongs in
  `npm run headless`.
- **P11 — The inspection poll runs at a fixed 2 s** whether the simulation is
  paused or running at 8×. It is wall-clock, not tick-driven. The run state is now
  known, so backing it off while paused is a two-line change; left undone because
  re-fetching identical data is cheap and the complexity is not obviously worth
  it.
- **P8 — The whole world is streamed.** Bounded region subscription awaits
  region-scoped deltas in the protocol; `requestSnapshot(bounds)` is isolated for
  when they exist.
- **P7 — No interpolation between ticks** — entities jump cell-to-cell each
  authoritative tick. By design for v1; `previousPosition` is already tracked so
  it can be added without a protocol or store change.
- **P2 — The 6px and 8px zoom levels are gone**, so a 128-cell world no longer
  fits the viewport at minimum zoom. Drag-to-pan is the compensation, and a
  minimap was judged not worth it for one world size.
- **P14 — The legend stays glyph-based in sprite mode.** `LegendPanel` is built
  once from the registries and knows nothing about sprite assignments; in
  sprite mode it still describes the glyphs, which remain the fallback truth
  for every unassigned slot. Showing assigned-sprite thumbnails would need the
  legend to become config-aware and re-renderable.
- **P15 — A sprite tint is a flat silhouette only.** `source-atop` replaces the
  sprite's colours with one fill, matching the single-colour glyph aesthetic. A
  shading-preserving mode (`multiply` + `destination-in`) is a deliberate
  non-feature until someone wants tinted sprites that keep their art.
- **P16 — Sprites ignore `heading` and `action`.** Both already ride in every
  bulk snapshot unused; directional or pose sprite variants would be an
  additive slot-id suffix (the vocabulary is append-only), not a rework. Not
  built — v1 mirrors the glyph channels exactly.
- **P17 — The status mark for a flying animal blinks, because the state genuinely
  changes every ~19 animal-ticks.** Flight is derived from the chosen action, and
  an animal alternating between a travelling action and a contact one is
  alternately airborne and grounded — measured at **52 ground↔air transitions per
  1000 vulture animal-ticks** (3 seeds × 6000 ticks) *after* the action
  classification was corrected; it was 289 before, which was a different problem
  and is fixed (see the engine's `locomotion/flight.js`). The mark is therefore
  honest and slightly restless. Nothing here can fix it: the renderer portrays
  authoritative output, and the engine-side lever is `flight.takeoffCost`,
  deliberately unbuilt. Worth knowing before reading a blinking `»` as a rendering
  fault.

### 1.4 Tooling and docs

- **P6 / E3 — Fixture mode has no inspection or metrics data at all** (`http` is
  `null` there), so the inspector shows ground and bulk fields but no sections
  offline, and the metrics panel is empty. Closing it means adding an
  `entity.inspection` fixture to `scripts/generateRendererFixtures.js`. More
  annoying now that collapsible sections are the bulk of the panel. ⚠ **More conspicuous since 2026-08-01**, when population moved into a column of its own: offline that column is now a whole empty panel rather than an empty section of a shared sidebar.
- **⚠ P14 — The `/api/metrics` payload is 383 KB at eight species, and the
  species dimension is not what makes it that** _(opened 2026-07-28 with the
  per-species sections)_. ✅ **Measured 2026-07-30 at batch 3**, which is what this
  item asked for. The report splits **347 KB of bounded history (91%) against
  36 KB of current metrics (9%)**, and a species block is ~4.4 KB of which 3.2 KB
  is eight trait histograms. ⚠ **So the server-side species filter the species plan
  proposed is the wrong lever**: it attacks the 9%, and the client wants every
  species' counts for its legend anyway. The payload is
  `historyLength × species × ~355 bytes` plus `species × ~4.4 KB`, polled every
  3 s — the history is 120 points of eight trait _means_ per species, and its
  levers are fewer points, fewer traits in `summarizeForHistory`, or a delta
  encoding. Left open with the diagnosis corrected rather than fixed: on a
  localhost poll it is not yet a defect, and the roster grows by two more species
  at most (engine A68). Collapsing the panel changed what is _drawn_, not what is
  _fetched_, so the collapsible work never touched this.

- **E4 — Keep the three docs current _with_ each change**, not after it —
  `README-RENDERER.md` (what it is), `PLAN-RENDERER.md` (what was planned and
  why), `HANDOFF-RENDERER.md` (where it stands), and now this file. An ongoing
  discipline; R13 is what happens otherwise.

### 1.5 Closed, and recorded so they are not re-opened

Every `R`-item from the 2026-07-20 audit, and two `P`-items closed since:

| #   | What it was                                                                                             | Closed by                                                                   |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R1  | Only entities were inspectable; clicking ground cleared the selection                                   | Phase A — selection is a cell                                               |
| R2  | The inspector was a fixed 300px sidebar rendering all 14 sections unconditionally                       | Phase B — anchored popover, progressive disclosure                          |
| R3  | The inspector did `innerHTML = …` on every store change, destroying scroll and collapse state each tick | B4 — the two-pass split (§5)                                                |
| R4  | Inspection detail fetched once per selection, then went stale                                           | B5 — poll while open                                                        |
| R5  | Nothing showed whether the simulation was running; `Space` acted on a guess                             | C1 — run state from the server                                              |
| R6  | `Step` was hardcoded to `{ ticks: 1 }` and _failed_ on a running sim                                    | C2/C3 — arbitrary N, auto-pause first                                       |
| R7  | Backward stepping did not exist                                                                         | Phase D (still undecided — §1.2)                                            |
| R8  | No legend for ~25 glyph meanings                                                                        | B7 — generated from the appearance registries                               |
| R9  | Minimum zoom was 6px, not a reliable click target                                                       | A2 — 10px floor                                                             |
| R10 | Pan was keyboard-only                                                                                   | A2 — drag-to-pan                                                            |
| R11 | `#123` references were inert text                                                                       | B6 — clickable ids                                                          |
| R12 | Fixture mode has `http === null`, so inspection and metrics are empty                                   | still open as P6/E3 (§1.4)                                                  |
| R13 | `README-RENDERER.md` was stale by three protocol layers                                                 | E4 — kept current since                                                     |
| P3  | Inspection-derived sections rebuilt structurally on every payload                                       | B5 — absolutes patched as values, sections reconciled per id                |
| P4  | Manual steps above ~50 ticks flooded the socket                                                         | C4 — one delta per step, 19× fewer bytes                                    |
| P10 | The section open-set is global rather than per-species/kind                                             | _Intended_ — a viewer's interest is in a _kind of question_, not one animal |
| E1  | Pure-function coverage for `CellDetail` and the structure signature                                     | Landed with the phases they test (`renderer-view.test.js`)                  |
| E2  | Controls state machine: paused/running reflection and auto-pause-then-step ordering                     | Landed with Phase C (`renderer-view.test.js`, `runner.test.js`)             |
| E5  | Whether `renderer-boundaries.test.js` needed anything new                                               | No-op — all of this lives inside `app/`                                     |

---

## 2. Architecture

The renderer is fully self-contained in `app/`. It imports **nothing** from
`src/simulation/`, `src/server/`, or `src/protocol/` — it speaks the versioned
protocol purely as message shapes over a transport, and declares the version it
understands (`SUPPORTED_PROTOCOL_VERSION` in `app/state/RendererStore.js`).
`test/renderer-boundaries.test.js` fails the build if any renderer import reaches
outside `app/`.

It consumes only: full snapshots, deltas, domain-event batches, entity
inspections, status reports, and structured command results. It owns only
presentation state: camera, zoom, selection, follow target, panel state,
glyph/color mappings, connection state, and previous/current render projections.

```text
app/
  main.js                     entry: URL mode selection, composition
  RendererApp.js              orchestration, rAF loop, input, desync recovery
  state/
    RendererStore.js          normalized authoritative-output store, validation
    DeltaApplier.js           pure delta application over the entity map
    EventCatalog.js           every event type: label, group, retention tier (pure)
  rendering/
    Camera.js                 center + cell size, pan/zoom math (pure)
    GridProjection.js         world → cell → screen-pixel projection (pure)
    EntityAppearance.js       ASCII glyph/color/priority registry (pure)
    AsciiGridRenderer.js      Canvas 2D drawing: terrain → entities → overlays
    SpriteGridRenderer.js     the same drawing from a spritesheet (?renderer=sprite)
    SpriteSlots.js            slot vocabulary bridging the registries to sprites (pure)
    SpriteConfig.js           SHEET geometry constants + assignment persistence
  editor/
    EditorState.js            the sprite editor's state machine (pure)
    SheetPanel.js             the spritesheet with its grid overlaid, click → (col,row)
    SlotsPanel.js             every slot with its glyph, thumbnails, tints
    editorMain.js             /sprite-editor.html entry: composition + config lifecycle
  transports/
    RendererTransport.js      transport contract + normalized event types
    WebSocketRendererTransport.js  live stream, backoff reconnect, epoch guard
    HttpRendererTransport.js  REST queries, command fallback, recovery snapshots
    FixtureRendererTransport.js    offline replay of committed fixtures
  ui/
    StatusPanel.js            connection/tick/entities/camera/zoom bar, and the last command's result
    CellDetail.js             pure description of one cell's ground
    InspectorView.js          what the inspector says (ground + occupants + sections)
    InspectorPanel.js         where the inspector is (floating popover or docked sidebar)
    Legend.js                 the key to the grid, generated from the registries
    MetricsPanel.js           population histograms and trends, one collapsible section per species
    EventLog.js               domain-event feed, one filter per event type
    Watchlist.js              which events are worth auto-pausing on (pure)
    Controls.js               transport bar: run/speed/step, auto-pause toggles, restart
    collapsible.js            click a panel's h2 header to minimize it (localStorage)
    columnResize.js           drag or arrow-key a column edge to widen it (localStorage)
  styles/
    dracula.css               the Dracula Classic palette (single source of color)
    renderer.css              layout and panel styling
fixtures/                     committed protocol messages for offline development
```

Drawing is isolated behind the grid-renderer contract — `resize(w, h, dpr)`,
`cssWidth`/`cssHeight`, `draw({ store, camera, ... })` — plus the pure
projection/appearance modules. `RendererApp` takes a `createGridRenderer`
factory (default `AsciiGridRenderer`); `?renderer=sprite` is that seam in use,
swapping in `SpriteGridRenderer`, and a future WebGL/DOM/terminal renderer is
one more factory. The store, transports, protocol, and engine are untouched —
the engine never knows a renderer exists. A renderer with async assets (the
spritesheet) calls `app.requestRedraw()` when they arrive rather than blocking
`start()`.

---

## 3. Invariants — inherited, never violate

These restate the engine's architectural invariants from the renderer's side.
They are the reason this subsystem never reaches for a shortcut through the
engine.

1. **The renderer portrays authoritative output.** It never computes ecological
   outcomes, never advances simulation time, never mutates organism state.
2. **All external change is a protocol command** on a transport. There is no
   other channel.
3. **Everything drawn comes from snapshots, deltas, domain events, or inspection
   responses.** No invented fields, ever — if the protocol does not send it, it
   does not appear.
4. **Glyphs and colors live only in `EntityAppearance.js`.** The simulation
   stores none.
5. **`app/` imports nothing outside itself.** Enforced mechanically.
6. **Camera and viewport never affect simulation fidelity.**
7. **Rendering frequency is independent of tick frequency.**

⚠ **A corollary that governs Phase D:** the renderer may re-display authoritative
output it has already received, but it may never _synthesize_ a state the
simulation did not report.

⚠ **The renderer may not be random, and that is load-bearing.**
`renderer-boundaries.test.js` bans `Math.random` in `app/` because presentation
must be reproducible from its inputs. When "restart with a random seed" needed a
die rolled, the answer was that **the host rolls it** — `simulation.restart` with
no seed picks one server-side and reports it back, so the renderer only ever
passes a number it was given or typed. If you find yourself wanting randomness in
`app/`, that is the shape of the fix.

---

## 4. The store and transports

`RendererStore.applyFullSnapshot` **replaces** render state; `applyDelta` updates
it (created / updated / removed + carried events). The store validates protocol
version and message shape, and detects desynchronization: a delta whose
`baseTick` does not match the current tick, that references unknown entities, or
that belongs to another simulation throws `StoreDesyncError`; deltas at or before
the current tick are dropped as stale (reconnect protection). On desync
`RendererApp` requests a fresh **full** snapshot (HTTP in live mode, the recorded
snapshot in fixture mode) rather than guessing.

Bounded region snapshots (`/api/snapshot?minX=…`) exist in the protocol but are
not used to hydrate the store, because v1 deltas are world-global — a partial
store would immediately desync. Viewport-bounded subscription is isolated in
`requestSnapshot(bounds)` for when region deltas exist (P8).

Events are deduplicated by `seq` and retained in a buffer bounded **per tier**
rather than overall: `lasting` events (every milestone — births, deaths, kills,
outbreaks, storms) keep 20 000, `passing` ones (movement, feeding, provisioning,
alarm, worn ground) keep 400. `state/EventCatalog.js` assigns the tier and
`renderer-view.test.js` checks it against the protocol's own `EventTypes`, so an
event type cannot exist without one.

⚠ **The split is a frequency judgement, not an importance one**, and the numbers
are the whole argument. Measured over 1000 demo ticks (seed 42, 2026-07-24):
**127 464 events, of which the five passing types were 99.2%** — `entity.moved`
alone was 121 078. The remaining 1043 milestones are ~1.04 per tick, so 20 000 of
them is ~19 000 ticks of history for a few megabytes, while retaining even a
hundred ticks of movement buys nothing anyone reads. A single shared bound is
what made a kill scroll out of the log ~1 tick after it happened.

Driven at demo rates (126 passing + 1 lasting per tick) the steady state at the
ceiling measured **20 527 events buffered after 7.62 M ingested, 2.8 MB of heap,
0.075 ms/tick** to buffer and trim, holding the last 20 000 ticks of milestones;
a filter scan over that full buffer is 0.014 ms. Keeping _everything_ is what is
not on offer — at ~127 events/tick and ~163 bytes each, an hour at 8× is
gigabytes. Trimming is
amortized the same way `DomainEventBus` does it on the engine side — a tier
overflows by a whole cap before the buffer is rebuilt — so the guarantee is a
floor of the cap and a ceiling of twice it, not an exact length.

⚠ **A full snapshot clears the log only when the `simulationId` changes.** A
recovery snapshot for the same simulation keeps it (the log is exactly what
survived the gap); a restart drops it, because nothing in it describes the new
world and its `#123` links would name animals that never existed there. That
clear also resets the dedupe watermark — **a restarted simulation numbers its
events from 1 again**, so keeping the old high-water seq silently swallowed every
event of the new world. Invisible until retention got long enough to notice.

Delta application records each updated entity's `previousPosition` —
renderer-owned annotation so optional interpolation (P7) can be added later
without protocol or store changes.

### The store remembers what each id was, alive

Beside the entity map the store keeps a **bounded map of last living forms** —
`{ id, kind, speciesId, sex, lifeStage, alive: true }` per id, held long after
the animal is gone. It exists because **an event is about a moment and an entity
is about now**, and the event log resolves its references through it (§5).

- **Protocol fields only.** What they _look like_ stays `EntityAppearance`'s
  alone (§3, invariant 4); the store gained a memory, not a glyph.
- ⚠ **Written only when the identity changes**, which for an animal is at birth
  and at each life stage. This runs against every entity of every delta —
  thousands per tick — so a record per update would be a per-tick allocation for
  a fact that changes three times in a life.
- **A carcass is never recorded.** It is not a form anything was seen _in_; it
  is what is left, and the animal is the point.
- **Bounded at the `lasting` event cap**, and trimmed the same amortized way: an
  id is worth remembering exactly as long as some retained event can still name
  it. Dropping a still-living animal costs nothing — it is in `entities`, so it
  resolves from there.
- ⚠ **Cleared exactly where the event log is** — on the `simulationId` changing,
  never on a recovery snapshot. A new world reuses the same small integers, so
  keeping them would draw a lion's glyph beside whatever animal is `#7` now.

**Three transports** implement one contract: WebSocket (live stream, backoff
reconnect, epoch guard), HTTP (REST queries, command fallback, recovery
snapshots), and Fixture (offline replay of committed messages). Fixture mode
never pretends to be live — the status bar shows an orange FIXTURE badge and
simulation commands are disabled.

---

## 5. Selection, the inspector, and the event feed

### The cell is the unit of selection

`store.selection` is `{ cellX, cellY, entityIds, activeId }`, where `entityIds`
may be empty and `activeId` may be **null**. Clicking bare ground selects the
ground and reports it — terrain and its authoritative passability, quantized
forage, any trail or burrow worn into it, and any disturbance whose circle covers
it — rather than clearing the selection. An empty cell is still marked on the
grid, its ground glyph redrawn in the selection colour so it never reads as a
hole in the map. `Esc` clears to null.

⚠ **Clicking bare ground is a selection, not a clear.** Anything reading
`selection.activeId` must tolerate null; `getEntity(null)` returns null, which is
why most call sites survived the change untouched.

`app/ui/CellDetail.js` is a **pure** function `describeCell(store, cellX, cellY)`
returning a plain description object (terrain, vegetation, feature, disturbances,
occupants); the inspector only formats it. It reports `inWorld: false` beyond the
world edge rather than throwing or inventing ground. It filters disturbances by
**the same circle test the grid renderer draws with**, so what the panel claims
covers a cell and what is drawn over it can never disagree.

Because every cell is now a click target, the minimum zoom is **10px** and there
is deliberately **no click tolerance**: making the target bigger is honest,
whereas guessing which neighbouring cell was meant would let the selected cell
disagree with the cell drawn under the cursor.

### One view, two hosts

`InspectorPanel` owns _where_ the inspector is (a floating popover anchored to the
clicked cell, or docked in the sidebar) and `InspectorView` owns _what it says_.
Both hosts render the same view object — docking is a change of host, not a
different panel. The fourteen section formatters return `{ id, title, badge,
body }` rather than finished HTML precisely so presentation is the view's
decision, not theirs; forking them would mean maintaining ~500 lines twice.

It is deliberately **not a modal**. `role="dialog"` describes it, but focus is
never trapped and the grid behind it stays live — the whole point is to watch an
animal while the simulation runs. Dragging the header **pins** it implicitly:
having deliberately placed the panel, having it jump away on the next click is
not helpful.

⚠ **The view owns its container and overwrites it wholesale on a structural
rebuild** (`container.innerHTML = …`). A control placed _inside_ that container
survives exactly until the next selection and then vanishes. This bit once: the
docked "float" button was inserted into the view's container and had to move out
into its own header beside `.dock-body`. **Controls go beside the view, never in
it.**

⚠ **`mount()` is called repeatedly** — every dock and undock. Listeners are bound
once per host through a `WeakSet` for exactly that reason; an unguarded
`addEventListener` there stacks one handler per remount, and the symptom (a toggle
firing five times) looks nothing like the cause.

### Two passes: values are patched, shapes are rebuilt

The inspector is re-rendered on every store change — once per authoritative tick.
A full `innerHTML` rebuild at that cadence destroys scroll position, text
selection, and any collapse state. So rendering is split into three update paths,
and ⚠ **putting a value in the wrong one fails silently:**

| Path                              | For                                         | Symptom of getting it wrong                          |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `liveFields` + a `data-live` span | any value that changes per tick or per poll | the row freezes at its build-time value              |
| `#patchSections` (automatic)      | section bodies and badges                   | — reconciled by content hash                         |
| `structureSignature`              | anything that can **appear or vanish**      | patching a node that does not exist: nothing happens |

The rule: **values are patched, shapes are rebuilt.** The structural pass runs
only when the _shape_ of what is shown changes — a different cell, different
occupants, a new inspection payload, or an optional row appearing or
disappearing. The signature errs toward rebuilding, so a mistake there costs a
wasted rebuild rather than a wrong display — prefer that direction.

⚠ **A fresh inspection payload for the same animal must _not_ change the
signature**, or B5's two-second polling resets the panel — resetting scroll and
collapse state. There is a test asserting exactly that.

⚠ **Values that change under a _stationary_ selection are easy to miss.** Grass
grows, ground wears, and a fire counts down while nobody moves — those ground rows
were baked in at build time from Phase A until B5 caught it. If a value comes from
the _world_ rather than from the _selection_, it is a live field.

`structureSignature` and `describeSections` are both **exported**, unusually for
private details of one panel, because they _are_ the mechanism: whether the panel
survives a tick is decided entirely there, they are pure, and the repo has **no
DOM test dependency**, so a thing that can only be tested through the DOM
effectively cannot be tested.

### Progressive disclosure

Default open: identity, condition, current action, ground. Collapsed `<details>`:
genome, traits, memories, family, herd, range, migration, disease, mate choice,
utilities, perception. Which sections a viewer expands is remembered in
`localStorage` (`biome.inspector.openSections`) and re-applied on every rebuild —
renderer-owned presentation state, which is why it lives in the browser rather
than the store.

**Formatters return sections, not HTML.** `section(id, title, badge, body)`, or
**`null` when the protocol sent nothing** — an absent section beats an empty
expandable row. The `id` keys the remembered open-set _and_ the reconciliation,
so it must be stable.

### Polling the selection

Inspection is a query rather than a stream, so while the panel is open the
renderer re-fetches the active entity every ~2 s — one entity, cancelled the
moment the selection changes, going empty, or closing, and a late reply for a
since-deselected animal is discarded. Without it the utilities, perception,
memories, and stamina of a selected animal froze at click time while the animal
carried on acting.

### The event feed asks which events, not how many

The feed shows **one checkbox per event type**, off by default except births and
deaths. It replaced a single "show routine" toggle that split the world in two —
five noisy types on one side, twenty-three on the other — which answered the
wrong question: someone watching an outbreak wants infections and nothing else,
and no single switch could give them that. The list is as long as the protocol's
event vocabulary (32 boxes: 31 types plus a catch-all), so it lives in a
`<details>` that **starts closed on every load**, with `N of 32` in its summary
and `all` / `none` / `births & deaths` to set the whole list at once.

- **Every event type is in the list**, and a test imports the protocol's
  `EventTypes` to prove it — the renderer may not import `src/protocol/`, so the
  catalog is a hand-copy and that test is what keeps the copy honest. A type the
  engine no longer emits fails the same test.
- **An unrecognized type falls under a catch-all** (`*other`, which cannot
  collide with a real type) rather than becoming invisible. A newer engine's new
  event is reachable through one checkbox instead of needing a renderer release.
- The selection is remembered in `localStorage` (`biome.eventLog.types`), and an
  empty **stored** set means "show me nothing" and is honoured — only an absent
  or unreadable one falls back to births and deaths.
- Retention is a **separate** axis from the filter (§4). A `passing` type says so
  beside its checkbox ("frequent · kept briefly"), because ticking `movement` and
  finding only the last few ticks of it is otherwise a mystery.
- ⚠ **Every line is headed by one character, and no two types share one.** The
  mark is the only part of a line that is scannable in a column of a hundred, so
  it lives in the **catalog** — beside the label, the group, and the retention
  tier — rather than inside `formatEvent`, which is what let it drift in the
  first place: `!!` (sickened), `++` (cured), `::` / `..` (a feature forming and
  lost), `*!` / `*.`, `vs`, `[]`, and `=>` were all two columns wide, while `+`
  meant _both_ a birth and an injury healing, `!` both a wound and an alarm
  call, `~` three different things, and `?` both a courtship and the unknown
  fallback. `formatEvent` now returns only the body and `describeEvent`
  assembles the line, so a formatter cannot invent a mark; two tests enforce one
  character and no duplicates. ⚠ The two events whose _wording_ also collided
  are now distinguished as well — an injury healing is `_ healed`, a disease
  recovery `^ recovered` — because a prefix nobody can decode is no better than
  a shared one.

Verified live rather than only against fixtures: after 3043 ticks the default
feed held births and deaths back to **t483**, where the previous 150-event bound
kept roughly one tick's worth. ⚠ It keeps everything it _receives_ — a long
coalesced step still drops events in the host's outbox before they ever arrive
(P12).

### The metrics panel is one collapsed row per species

⚠ **A sparkline's width is the history's length, which is not a number this
panel chooses.** At 120 samples the population chart was 120 unbreakable block
characters in a 300px column: it ran past the edge, took the species name and
the living count with it, and got worse every time the column was narrowed. Two
things fix it, and both are needed:

- **The chart is resampled to the space available**, by bucket mean, rather than
  drawn one sample per column. Downsampled rather than truncated to the most
  recent N, because the shape of the _whole_ history is what the row is for — a
  population that doubled and crashed reads as that at any width. Fewer samples
  than columns (early in a run) are drawn one-to-one and simply end, leaving the
  line short rather than stretching four points across the panel. ⚠ Buckets are
  laid out by proportion so the last one is never a short remainder, which would
  be a spike at the right-hand end of every chart.
- ⚠ **A sparkline uses its own ramp, with no blank rung.** The block ramp is
  shared with the trait _histograms_, where a blank bottom rung is right — a bin
  with no animals in it is genuinely empty. A sparkline has no zero: every
  column has a sample, so scaling `min → max` onto that ramp drew the window's
  **minimum** as blank. A steady population came out as a line of nothing
  (`min === max`, so every sample is the minimum) and `41,41,41,40` came out as
  `███ `, where losing one animal of 41 is indistinguishable from the species
  disappearing. `TREND_LEVELS` is the same ramp minus the blank, so a trend's
  low point is `▁` and a flat series reads as "no change" rather than as no
  population.
- **The width is measured, not assumed.** The column is user-resizable and the
  font is whatever `ui-monospace` resolves to, so `MetricsPanel` measures one
  block character with a hidden probe (the block glyphs, not a digit — a font
  that renders them at a different advance would mis-measure every chart) and
  divides the column by it. A `ResizeObserver` re-renders on a column drag,
  guarded on the _character count_ so it fires once per column of change rather
  than once per pointer move.

The chart sits on its own line under the species name, **inside the
`<summary>`** so it survives the section being collapsed — collapsed, the trend
is the overview, not the count. The in-row trend sparklines (traits, disease)
get a third of the same budget, since they share their line with numbers and are
the identical defect one click deeper. `overflow: hidden` on the chart is the
backstop: a mis-measurement then costs a clipped chart rather than a column of
text pushed off the edge.

`MetricsPanel` renders a full section per species — trait histograms with
sparklines, herds, disease, home range, generations, births and deaths. That
reads at three species and is unusable at ten, so **each species is a collapsed
`<details>`** whose summary is the species' own grid glyph, its name, its living
count, and the population sparkline. Collapsed, the panel is finally an
_overview_; expanded, it is what it always was. The open-set lives in
`localStorage` (`biome.metrics.openSpecies`) exactly as the inspector's does.

Three things about it are easy to get wrong:

- ⚠ **The panel rewrites its whole `innerHTML` on every poll**, so the `open`
  attribute is re-applied from the remembered set on each render, and the
  `toggle` listener is bound **once, on the container, in the capture phase** —
  `toggle` does not bubble, and a listener bound to the sections themselves would
  be destroyed by the next poll. Driven in a browser rather than reviewed
  (`tests-ui/metrics.spec.js`): expand, wait for a real rebuild, assert it is
  still open _and_ that the toggle still works.
- ⚠ **The trend sparklines were quadratic in species count.** `history.map((s) =>
s.species.find(…))` sat _inside_ a per-species, per-trait loop, so the cost was
  `historyLength × species² × traits` — ~7.5k comparisons at three species and
  ~84k at ten, on every render. `indexHistory` now buckets the history by
  `speciesId` once; it is exported and tested for the usual reason (there is no
  DOM test dependency, so the mechanism has to be a pure function to be testable
  at all), including an assertion that it draws the _same_ sparkline the `find`
  version did.
- **A persistent group count (v29) appears only for a species that has one.**
  It is a separate row from `herds`, because the two are separate mechanisms — a
  herd label is who an animal is standing with, a group record is who it belongs
  to — and it is absent rather than `0` in a world where nothing forms clans,
  which is every world today. It appears by itself the first time one does.

### Clickable ids

Every id in the inspector and event log is a button that selects and centres
that animal. **In the event log the `#` is replaced by the animal's own glyph**,
in its own colour and sex style — `g412`, `P97` — so a line says what it is about
before it is read, and the mark you then hunt for on the grid is the same mark.
`linkifyIds` takes an optional resolver for that; the log backs it with the
store's **remembered living forms** (§4), and an id this client never saw alive
falls back to `#412`. Four details worth knowing:

- ⚠ **A reference resolves against what the animal _was_, not what its id is
  now**, and the difference is the whole reason the store remembers. Resolving
  against `getEntity` alone produced `> hunt p122 → %65 caught`: the prey was
  already a carcass in the very delta that carried the hunt, so the line about
  the hunt wore the glyph of the body — and `#65` a few hundred ticks later when
  the body decayed away. The line never changed; what it was resolved against
  did. A record of a hunt that cannot say what was hunted is the panel reporting
  the present tense over a past one.

- ⚠ **The colour rides on a CSS custom property (`--ref-color`), not on
  `color`.** An inline `color` outranks any stylesheet rule, so the `:hover`
  cyan would simply never fire — the reference would be species-coloured and
  dead to the touch. A `tests-ui` spec drives the hover, because a cascade
  question can only be answered by a browser.
- **The inspector keeps `#`.** Its references are mostly to animals in a
  lineage — parents, offspring, a guardian — many of them dead and unresolvable,
  and a panel that showed glyphs for some and `#` for others would read as a
  bug.
- **A carcass resolves like anything else**, so a `%412` in the log is telling
  you the animal is a body now.

⚠ **Escape before you linkify.** Event-log lines are plain text
containing `<` and `>` (`<until t1205>`), so `linkifyIds(escapeHtml(text))` is the
only safe order; the reverse lets an event's own punctuation become markup.
Tested. The herd id is linkable too — a `groupId` _is_ an animal's id — but the
animal it names may have died and left the label behind, in which case the click
reports "not in view" rather than navigating.

### The four columns, and why they resize

The page is one CSS grid: **events · grid · population · sidebar**, with the
controls, the inspector dock, and the legend in the last of them. Population left
the sidebar because a panel of per-species sections and a panel of controls were
competing for one narrow strip, and whichever you were reading was the one
scrolled out of sight. Collapsing the species sections (above) made that panel an
overview; giving it a column is what makes the overview visible at the same time
as the controls.

**Every column can be widened** by dragging the edge that faces the grid, or by
focusing that edge and using the arrow keys (Shift for a bigger step, Home or a
double-click to reset). `ui/columnResize.js` writes one custom property per
column on the document root and the grid does the rest, so nothing about a panel
changes when its column does. Widths are remembered in `localStorage` beside the
collapsed-panel set — renderer-owned presentation state, exactly like the
inspector's open sections.

Four things here are load-bearing:

- ⚠ **The default width is the minimum.** Each column was sized to the narrowest
  thing it has to show without wrapping, so dragging below it would break the
  panel rather than merely shrink it. A drag only ever widens, and the grid gives
  up the room. ⚠ The numbers are stated in **both** `renderer.css` (as the custom
  property fallbacks, since CSS lays the page out before any module runs) and
  `RESIZABLE_COLUMNS`; a disagreement shows up as a column that jumps on the
  first drag.
- ⚠ **Every child of `#main` is placed explicitly.** The handles overlay the
  columns rather than taking tracks of their own, so they are placed by hand —
  and a grid with _some_ items placed by hand auto-places the rest into whatever
  cells are left. That put each aside one track right of where it belonged and
  pushed the sidebar onto a second row, which halved every column's height: the
  page still looked roughly right while half of it could not be clicked (§11).
- **The grid canvas is watched, not the window.** Dragging a column changes the
  viewport without any window `resize`, so `RendererApp` observes
  `#viewport-wrap` with a `ResizeObserver` and the window listener is only the
  fallback. ⚠ Observing the _wrapper_ rather than the canvas is what keeps it
  from looping — the wrapper is sized by the grid, and resizing the canvas inside
  it cannot change it back.
- **The handle is a real widget.** `role="separator"`, focusable, with
  `aria-valuenow` / `min` / `max` kept current — because a focusable separator
  without them is an axe violation, and more to the point every other control
  here has a keyboard path (pan, zoom, speed, follow), so a mouse-only column
  edge would be the exception.

The three panel columns share one `.panel-column` rule rather than a rule per
id. That is what let the population panel move columns without touching its own
styling, and it is the same reasoning as theming form controls by type (§10):
**a panel should behave identically wherever it is put.**

---

## 6. Controls and run state

⚠ **Report host state, never remember it.** Whether the world is moving is the one
thing a viewer cannot read off the grid — a paused simulation and a quiet one look
identical — so the status bar states it (`RUNNING 4x` / `PAUSED`), and all of it
comes from the **host**. `/api/status` is polled on the metrics timer and every
command result carries the new `paused` / `speed`, so the poll is the source of
truth and the results only stop it lagging behind your own click. `paused: null`
means "not yet known" and renders as `…` rather than guessing a default.

The previous version remembered what _this_ client had asked for, which was wrong
the moment anything else touched the simulation — and the symptom was Space doing
the opposite of what the button said. Any future control over host state belongs
in that same shape.

**Stepping pauses first.** `simulation.step` is refused outright while the
runner's timer is going, so the step controls send `simulation.pause`, await
`ok`, then step — two existing commands in sequence, entirely renderer-side. No
engine change.

**A large step arrives as one delta, not N** (see §7). A 500-tick step measured 1
message and 1382 KiB against 300 messages and 26 742 KiB tick-by-tick — 19× fewer
bytes and 300× fewer messages.

⚠ **A poll must not fight the user.** The seed field is not written back while it
has focus, or a poll landing mid-typing overwrites what you were entering.
Anything that both polls and accepts input needs the same guard.

### One command line, in the status bar, always about the current command

Every report about a command — a client-side refusal, a structured `ok` with the
tick it landed on, a desync warning, a protocol error, what an auto-pause stopped
for — is written to a single element at the right-hand end of the status bar.
`StatusPanel` owns it; `Controls.setStatus` is a pass-through to a callback, and
`RendererApp` writes to the panel directly.

Two things about it are the design rather than the plumbing:

- ⚠ **Sending clears the last report**, in `RendererApp.sendCommand` — the one
  chokepoint every command passes through, which is why the clear lives there
  rather than at each of the callers that later write a result. A message
  outlives what it described otherwise, and a red "step failed" still on screen
  three commands later reads as the state **right now** rather than as history.
- **It moved out of the controls panel**, where it was the last child of a
  section that folds up — so the one time a viewer most wants to know why
  nothing happened, the answer was hidden with the buttons that had failed. In
  the status bar it sits beside the run state it usually explains.

---

## 7. Steering the world (Phase F)

Three capabilities about steering rather than seeing, requested directly after
Phase C.

### Pause on notable events

`app/ui/Watchlist.js` maps twelve viewer-facing categories onto engine event
types; `RendererApp` checks each arriving delta and sends the ordinary pause
command on a match, then reports what stopped it and jumps the camera there. This
is renderer _policy_ over authoritative output — the engine emits the events it
always did. `matchWatched` is pure, so the whole policy is testable without a DOM.

⚠ **It pauses _just after_ the event, not at it.** The delta for that tick is
already applied and the pause is a round trip on top, so at 1× you stop on the
next tick and at high speed you may overshoot. Exact stopping would be a
breakpoint inside the runner, which is a protocol change.

**Frequencies are not intuitive**, so the hints say which are frequent. Measured
over ~480 demo ticks: courtship 79, migration 44, mating 34, conflict 14, disease
10, injury 6, death 5, kills 4, birth 1, disturbance 1, season 1. "Pause on
courtship" stops you every few ticks. All twelve fire against the real engine,
which is the check that no toggle is decorative.

### Restart with a seed (protocol v29)

`simulation.restart { seed?, width?, height?, founding?, rocks?, thickets? }`,
a runner-level command. A restart is the one change that cannot be a delta — no
shared ids, tick, or `simulationId` — so the runner emits its own `restart` event
and the WebSocket transport broadcasts a **full snapshot**, and the store
_replaces_ its state.

⚠ **The renderer stopped speaking in roles at v29, and that is the whole point of
the bump.** This panel used to carry three hardcoded number fields — Herbivores,
Predators, Scavengers — which is the renderer knowing engine concepts it was only
ever handed by coincidence, and which stop being _true_ the moment one species is
both predator and scavenger. It now builds **one field per species** from the
roster the host publishes on `/api/status` (`species: [{ id, defaultCount }]`),
and sends `founding: [{ speciesId, count }]`. Three consequences for anyone
working here:

- **The fields are generated, so `setSpecies` is called from status polling** —
  and rebuilds only when the roster actually changes, or a viewer typing a count
  would have the field replaced underneath them every poll interval.
- **A species with no `SPECIES_APPEARANCE` entry still gets a field**, labelled
  from its id by `speciesLabel`. A roster this build has never seen is exactly
  the case publishing the roster was for; hiding it would put the world beyond
  reach of the control that exists to compose it. What to _call_ a species stays
  renderer-side — the host sends ids and counts, never labels.
- ⚠ **An empty roster is not "use your defaults"**, it is "found nothing". So the
  field is omitted entirely until the host has said what its species are.

The v28 role fields are still accepted by the host for one version and are
translated by `buildDemoConfig`; the renderer no longer sends them. **Terrain
prevalence is an abstract
`0..MAX_TERRAIN_PREVALENCE` level, not a count** — 0 is none of that terrain,
`DEFAULT_TERRAIN_PREVALENCE` (2) reproduces the demo's own terrain, and the top
crowds out open grazing ground — and `buildDemoConfig` maps it linearly through
the default to the generator's `terrain.ridges` (rock) and `terrain.thickets`
formation counts, so the renderer never has to know a formation from a cell.
Bounds are the protocol's (`MAX_WORLD_DIMENSION`, `MAX_FOUNDING_PER_SPECIES`
and `MAX_FOUNDING_TOTAL`,
`MAX_TERRAIN_PREVALENCE` in `commands.js`), chosen high enough to reach the sim's
performance ceiling — a ~1M-cell world, tens of thousands of founders — without
an out-of-memory or a non-terminating build. An explicit `0` clears a species or
a terrain type. The renderer drops its
selection, inspection detail, and follow target rather than leaving them pointing
at animals that no longer exist; the run state (paused, speed) belongs to the host
and survives.

⚠ **The host picks the random seed, never the client** — see §3. Omitting the seed
asks for any world and the result reports which one it chose; that number lands in
the seed field, which is what makes "replay this one" simply naming the seed you
were handed. The first attempt had the renderer rolling the die and the boundary
guard caught it. F2 also moved that guard to strip comments before scanning
(matching the engine's, so a scan that fires on prose explaining the rule cannot
train people to word around it), verified by injecting a real `Math.random()` and
confirming the guard still failed.

### Speed as a ladder

`«` / `»` and `[` / `]` step 0.25x–32x, replacing the dropdown: speed is nudged
while watching, whereas a select made you look away from the grid.

---

## 8. Coalesced manual steps (the one server-side change)

`SimulationRunner.stepManually` used to loop `#tickOnce`, and each iteration built
a full snapshot and emitted a `tick` broadcast to every client — so `Advance 500`
built 500 snapshots and flooded the socket with 500 deltas. C4 changed the runner
to step N and emit **one** delta spanning the first snapshot to the last.

This is the only change Phase C made outside `src/renderer/`, and it needed no
protocol change: `eventsSince(previous.lastEventSeq)` already covers the whole
window, so only the emit cadence moved. `#tickOnce` and `stepManually` now share
one `#emitSince(previous)`. It is safe because a delta is a **diff between two
snapshots, not a replay** — an animal born and eaten inside the window is simply
absent from both ends — which is asserted in `test/runner.test.js` (a coalesced
run and a tick-by-tick one end byte-identical).

The cost it exposes is P12 (§1.3): the delta is ~95% event payload against a
bounded outbox, so a long step drops events while keeping world state exact.

---

## 9. Appearance and the legend

`EntityAppearance.js` is the **only** place glyphs and colours exist. Lookup
order: `carcass` kind (or a dead animal) → carcass `%` orange; species override;
kind default; unknown `?`. Priorities resolve multi-occupant cells
deterministically (living animal 50 > carcass 40 > unknown 30 > plant 20; ties by
ascending id); the selected entity draws as an overlay above everything. Glyphs
are strict ASCII and differ across categories, so colour is never the only
distinction.

**Age and sex are two independent glyph channels** on top of the species letter,
so a herd's structure reads straight off the grid:

- **Letter case is age** — a mature animal (`lifeStage` adult or senescent) is
  UPPERCASE, an immature one (juvenile or subadult) lowercase: `g`/`G`, `s`/`S`,
  `v`/`V`. An absent or unrecognized stage reads as not-yet-grown (lowercase),
  so a newer engine's stage name never throws.
- **Italic is sex** — a female is drawn in italic, a male (or an animal with no
  sex) upright. `resolveAppearance` sets an `italic` flag; `AsciiGridRenderer`
  keeps an upright and an italic font and switches per glyph, resetting to
  upright before the terrain and overlay passes.

Colour still says species and priority still decides who wins a shared cell, so
both are additions rather than substitutions; a hunt reads as the predator
whatever the ages and sexes involved. Case and italic are **animal-only** — a
carcass, plant, or unknown kind keeps its base glyph exactly.

**Draw order is deliberate and layered:** kill flash → terrain → worn ground
(features) → disturbances → memory marks / home-range ring → entities →
brackets (herd, family, hunt) → selection overlay → status marks. The rule throughout is that the more permanent
and less urgent a thing is, the further under it is drawn: worn ground is the most
permanent thing on the map and the least urgent to see; an animal caught in a fire
must stay visible, which is the whole point of watching it get caught.

### A kill flashes its cell, for one tick

**A cell where something was killed on the tick being displayed is filled red**,
behind everything else in it. A successful hunt otherwise has no sign on the grid
at all beyond a `%` appearing among the glyphs, which on a moving map is no sign
at all — and the kill is the single most watchable thing this simulation does.

- ⚠ **The cell comes from the _body_, not from the event.** `entity.killed`
  carries `{ entityId, predatorId }` and no position, but the prey becomes a
  carcass at the death site in the same delta — so the cell is a store lookup
  rather than a protocol change. An id that is somehow already gone contributes
  nothing rather than a guessed cell.
- **It lasts exactly as long as the tick does.** `RendererApp` reads the event
  buffer _backwards_ and stops at the first event from an earlier tick, so the
  flash is present while that tick is on screen and gone with the next delta —
  and a pause holds it. ⚠ That also gives the right answer for a coalesced
  step: kills from earlier ticks inside the window are not from _this_ tick and
  are not flashed, where the naive read would paint the screen red after
  `Advance 500`.
- **Behind everything.** The ground glyph, the carcass, and any bracket all draw
  over it — a flash that covered them would hide the thing it is pointing at.

⚠ **The occupant scan happens before the first pass, not between two of them.**
A cell with something standing in it draws its _fading layers_ at
`OCCUPIED_ALPHA` (20%), which means the ground and feature passes both have to
know where the entities are — so `draw` resolves the visible occupants once, up
front, and all three passes read that one map.

Which layers give way is `fadesUnderOccupant`, and the split is a judgement
about what a layer is **for**:

| Gives way to an occupant                                                 | Stays solid                       |
| ------------------------------------------------------------------------ | --------------------------------- |
| forage (every level), water and deep water, **thicket**, trails, burrows | ground, rock, cover, disturbances |

- ⚠ **`OCCUPIED_ALPHA` is 0: a covered layer is not drawn at all.** It was 20%
  first, on the argument that a herd would otherwise punch holes in the grass it
  is grazing — and watching it, the holes are not the problem. Two glyphs in one
  10px cell is a smudge at _any_ opacity that leaves the lower one visible, the
  occupant is always the thing worth reading, and the ground is one click away in
  the inspector, which reports the _cell_ rather than the animal. The constant
  stays as the knob this decision turns; at 0 the renderer skips the draw
  outright rather than drawing something invisible.
- **A reading of the cell gives way; the hard shape of the map does not.**
  Forage, water, thicket, and worn ground are facts _about_ a cell — how much
  there is to eat, whether it is wet, whether it is thick enough to hide in,
  what has walked here — and an animal standing there is the more urgent fact.
  Rock and cover are the map itself; a disturbance stays solid because an animal
  caught in a fire is the whole point of watching it get caught. ⚠ Thicket is on
  the giving-way side precisely because it is the layer animals are most often
  _inside_: a `♣` and a `g` in one cell was the hardest collision on the map to
  read.
- ⚠ **The test is identity, never a glyph comparison.** Three different layers
  draw `.` — bare ground, the sparsest forage, and a trail — and two of the
  three fade. Only the identity of the frozen registry entry says which layer
  produced the answer, which is why `FADING_LAYERS` is a `Set` of the entries
  themselves.
- **Any occupant, carcass included.** A body lying in the grass hides that
  cell's forage exactly as a standing animal does, and the `%` is the glyph
  worth reading either way. (This started out living-animals-only, on the
  argument that a carcass is part of the ground's story; watching it, the
  distinction bought nothing and the inconsistency was the thing you noticed.)

### Status is a mark, not a tint

**A status is a small dot or diamond in the upper-left corner of the cell**, and
the animal's glyph keeps its own colour. Hurt and ill used to _tint_ the species
letter, which cost the two things a letter is for: a purple `g` no longer says
"gazelle" at a glance, and the two tints could not both be shown, so an animal
that was ill _and_ hurt looked exactly like one that was only ill. A mark beside
the glyph is additive — the letter still says species, the colour still says
species, and any number of conditions can ride along.

`STATUS_APPEARANCE` is the registry, and the legend is generated from it:

| Mark            | Status         | From                                    |
| --------------- | -------------- | --------------------------------------- |
| ● orange        | hurt           | `healthFraction < HURT_HEALTH_FRACTION` |
| ● purple        | visibly ill    | `diseaseState === 'symptomatic'`        |
| ◆ pink          | carrying young | `gestating` (protocol v30)              |
| ◆ bright-cyan   | in rut         | `seekingMate` (protocol v30)            |
| ◆ bright-white  | dispersing     | `dispersing`                            |
| ◆ bright-green  | up a tree      | `elevation === 1` (protocol v31)        |
| » (up) cyan     | flying         | `flying` (protocol v32)                 |

- **Shape is the family and colour is the identity.** A `dot` says something is
  _wrong_ with this animal; a `diamond` says something is _happening_ in its
  life; a `chevron` says **where** it is — on the wing rather than on the ground.
  Colour does the rest, and no two statuses share one, which a test enforces.
- ⚠ **The shape channel went from two values to three on 2026-08-04, and the
  reason it was allowed to is that "where" is a third kind of fact.** The channel
  was capped at two on the argument that two shapes is all 10px can carry, and
  that argument still holds: at the zoom floor the `»`'s pair of chevrons fuses
  into one small wedge. It is admitted anyway because an upward wedge still reads
  as _up_ at the floor, and because **colour is the channel that actually has to
  carry a mark at 10px** — which is what the no-shared-colour test is protecting.
  This is not an invitation to a fourth shape.
- ⚠ **`flying` is drawn cyan, which is the water reservation, and that is
  deliberate rather than an oversight.** A status is a small mark in the cell's
  _upper-left corner_, never a fill and never a glyph colour, so it cannot be
  read as the terrain it shares a hue with; `bright-cyan` is the rut diamond, so
  the two are a shade apart as well as a shape apart.
- ⚠ **The mark geometry is `paintStatusMark`, exported from `AsciiGridRenderer`
  and shared with the sprite renderer** — it used to be two copies kept identical
  by hand, with a comment saying so, and the third shape is precisely what would
  have made that silent: a `chevron` added to one copy draws a diamond in the
  other with nothing failing. Colour resolution stays each renderer's own.
- ⚠ **An animal in several statuses shows them one at a time**, `STATUS_CYCLE_MS`
  (500 ms) each, in registry order. Drawing all of them at once is the obvious
  alternative and it is worse at every zoom this renderer offers: four marks in
  a 10px cell is a smudge, and the corner is the only place a mark can go
  without covering the glyph it belongs to.
- ⚠ **The cycle runs on the wall clock, not the tick stream**, so a _paused_
  world still cycles — which is exactly when someone is reading the marks. The
  phase is `floor(now / STATUS_CYCLE_MS)` computed in the rAF loop;
  `AsciiGridRenderer.hasCyclingStatus` reports whether the last frame drew
  anything mid-cycle, and the loop marks itself dirty on a phase change **only
  then**, so a still, unremarkable world costs no frames at all. This is
  invariant 7 (rendering frequency is independent of tick frequency) being used
  rather than merely respected.
- ⚠ **The status pass is drawn last, after the selection overlay.** The
  selection paints a filled rect over its whole cell, so a mark drawn earlier
  vanished the moment you clicked the animal you were watching — which is when
  you are looking hardest. It rides slightly over the corner bracket arms for
  the same reason: two pixels of bracket are recoverable, a hidden condition is
  not.
- ⚠ An **incubating** animal is deliberately unmarked even though the protocol
  sends its state — the whole disease model rests on a carrier being invisible,
  and marking one would hand the viewer information no animal in the world has.
- **Only living animals.** A carcass has no condition and no life left to be in
  the middle of.

⚠ **`seekingMate` is the chooser's state, so the rut marker is female-side.**
The engine deliberately leaves the seeking sex ready year-round (see the engine's
`mating/breeding.js`), so a male marker would be permanently lit and would say
nothing at all. What the mark means is "receptive and in the market", which for a
species with a breeding window is its season — and that is the thing worth
watching, since a compressed conception window is a compressed calving window a
gestation later.

### The roster has glyphs before it has species (2026-07-28)

`SPECIES_APPEARANCE` carries an entry for **all ten** species the engine planned
to have, which at the time was three shipped and seven imagined. **Eight now
ship**; the two still unwritten are the rhino and the elephant, and both are
deferred (engine A68). Two reasons for assigning them all at once, and the second
is the load-bearing one:

- **The scheme is coherent because it was assigned in one pass.** Glyph by common
  name, colour by trophic family, priority in bands — carnivores 60+ so a hunt
  reads as the hunter, herbivores 50–55, the obligate scavenger at 45. Assigned
  one species at a time it would have become whatever letters were left.
  ⚠ Terrain already owns `cyan`, `green`, `comment`, and `background-lighter`,
  which is why the rhino and elephant take `bright-*` variants.
- **A species batch stays a config change.** The engine can found a species the
  moment its config file exists; without an entry here it would draw as a bare
  `a` and be nameless in the metrics and restart panels, so every batch would be
  a renderer release too. This is the same reasoning as v29's host-published
  roster, one step earlier.

⚠ **The gazelle keeps the grazer's `g`/`yellow`/50 exactly**, so the first
species batch is visually identical to today's demo apart from the carnivore that
arrives with it — which is what would make a visual regression obvious.

⚠ **A transitional entry carries `supersededBy`**, naming the roster entry it is
renamed into. That field is why two entries may share a letter without it being a
collision — they never coexist in a world — and `renderer-view.test.js` enforces
both halves: a shared glyph must be a supersession, and a `supersededBy` must name
an entry that exists. The old entry is **deleted** in the phase that does the
rename, and the test is the checklist. ⚠ **As of 2026-07-30 (phase 14) there are no
transitional entries left** — the stalker's went when it became the leopard, which
was the last planned rename. Nothing about the scheme was removed with it.

⚠ **The scheme paid for itself one phase later, and the evidence is a
non-event.** Phase 7 (2026-07-29) renamed the grazer to the gazelle and the
corvid to the vulture, and added the hyena. The renderer's entire share of that
was deleting the two superseded entries: the hyena arrived with a glyph, a
colour, a legend row, a metrics section, and a restart field, and **not one line
of renderer code was written for it**. That is what "a species batch is a config
change" has to mean in practice.

✅ **It then held for four more species and one more rename, which is the claim
actually tested.** The lion and buffalo (phase 11), the wildebeest and zebra
(phase 13), and the leopard (phase 14) each arrived with everything above already
in place; the renderer's total share across those three batches was **deleting the
stalker's `supersededBy` entry** and regenerating the fixtures. ⚠ The one thing
that did _not_ come for free is the fixtures — see §10, and note that unlike a
missing glyph, a stale fixture fails nothing.

**The legend is generated, never written.** `describeLegend()` reads the
appearance registries, so adding a species updates it for free and it cannot drift
from what the grid draws. ⚠ **No row carries a note, and no group does either.**
The legend is a key, not a manual: "young / grown" against each of ten species
was one sentence ten times, and once the per-row glosses were gone the rest read
as clutter — including the paragraph explaining that several statuses take
turns, which is a thing to notice on the grid rather than to read here. ⚠ The
female row shows **both** cases (`g/G`, italic), like the row above it: a single
`g` there read as "the female form is the young one", which is the one reading
that case-is-age and italic-is-sex being independent channels rules out.

**It opens expanded.** A key you have to go and find is a key nobody reads, and
the panel is the last one in the sidebar — the cost of it being open is scrolling
past it, and the cost of it being shut was two dozen glyph meanings nobody could
look up. Four tests enforce that every registry entry (every
species in both its young and grown case, every terrain, feature, disturbance,
memory kind, and carcass stage) reaches it and that every colour token is a real
Dracula value — and that every **status** reaches it carrying the shape the grid
draws it with. The bracket overlays and the **age/sex key** (`young / grown` and
the italic `female` row) are the hand-written part, because they describe how a
glyph is _cased, styled, or bracketed_ rather than which glyph is drawn. ⚠ The
statuses are _not_ hand-written any more: they were, as two "condition tint"
rows, and a registry that the legend reads is what stops the next one being
forgotten here.

**Sprite mode rides on the registries, never beside them.** `?renderer=sprite`
swaps in `SpriteGridRenderer` (same pass order, same store reads). Every
drawable thing is a **slot** with a stable string id
(`species:herbivore.gazelle:grown:female`, `terrain:water`, `carcass:1`, …),
enumerated from the appearance registries by `SpriteSlots.js` exactly as the
legend is generated — so a species added to `SPECIES_APPEARANCE` gains its four
slots (age × sex) with no sprite-side change, and `test/sprite-slots.test.js`
holds the same coverage guarantee the legend tests do. Resolution mirrors
`resolveAppearance` / `groundAppearanceAt` (the latter now exported and
shared), and an **unassigned slot draws its ASCII glyph**, so a partial mapping
or a missing sheet still renders everything. Assignments, tints, and the canvas
background persist under `biome.sprites.config.v1` (validated on load; unknown
slot ids are dropped, not fatal); sheet geometry is code constants in
`SpriteConfig.js`'s `SHEET` block. A tint is a flat silhouette (the sprite's
alpha, one fill). Condition and life-state ride as the same corner **status
marks** as ASCII mode (`statusesOf`, cycling on `statusPhase`, and from
2026-08-04 the *same geometry* — `paintStatusMark`, exported from
`AsciiGridRenderer`, because the two copies it replaced were kept identical by
hand and a third shape is exactly what would have separated them) — never a
recolour, and incubating stays unmarked; fading ground layers give way beneath
an occupant's sprite (`fadesUnderOccupant` is an identity test on the registry
entry `groundAppearanceAt` returns, shared by both renderers); the kill flash
fills the cell behind everything. Mappings are made in `/sprite-editor.html`
(`editor/`), whose interaction flow is pure and node-tested in
`EditorState.js`. ⚠ **Slot ids are the config's compatibility surface** — the
vocabulary is append-only, and a snapshot test pins it.

**Dracula palette.** `styles/dracula.css` defines the exact Dracula Classic values
as CSS custom properties; `EntityAppearance.DRACULA_COLORS` mirrors them for
canvas/test use. Derived shades may only mix these values or apply opacity.
Semantics: green = plants/success, red = death/danger/failure, orange =
carcass/warnings/fixture, yellow = animals, bright-yellow = selection, purple =
unknown/headings, cyan = water (reserved)/follow marker, comment blue = secondary
text.

For what the renderer does with each individual protocol layer (terrain,
vegetation, hunts, heredity, territory, disease, migration, …), see
[`README-RENDERER.md`](README-RENDERER.md) — "Protocol layers".

---

## 10. Conventions that are easy to miss

These are load-bearing and cost real time to rediscover. Most have their own ⚠ in
the sections above; collected here as a checklist.

- **Describe, then render.** Anything worth testing is a pure function over the
  store returning a plain object — `CellDetail.describeCell` is the model,
  `structureSignature` and `describeSections` are exported for the same reason.
  The repo has no DOM test dependency, so design outward from a pure core.
- **Never invent a field.** If the protocol does not send it, the panel says
  nothing. `resolveFeatureAppearance` and `resolveMemoryAppearance` return `null`
  for kinds this build has not heard of, and `terrainPassableAt` returns `null`
  (not `false`) outside the terrain — "not told" and "impassable" are different
  facts — so a newer engine cannot break an older renderer.
- **Share the geometry, do not restate it.** `CellDetail` uses the same
  disturbance circle test the grid draws with, and the same `occupantsInCell` the
  selection uses; `groundAppearanceAt` and `paintStatusMark` are exported from
  `AsciiGridRenderer` so the terrain pass, the selection overlay and **both grid
  renderers** resolve ground and draw marks identically. What a panel claims and
  what is drawn can never disagree. ⚠ **"Kept identical by hand" is the smell**:
  the sprite renderer's status mark carried exactly that comment for weeks, and it
  came due the moment the shape channel grew a third value — a `chevron` added to
  one copy would have drawn a diamond in the other with nothing failing. A comment
  promising two things agree is a request for a shared function.
- **A per-tick cost is a real budget, and the store notifies on every change.**
  The inspector rebuild (R3), B5's polling, and C4's snapshot flood were each one.
  `store.setFollowedEntity(null)` inside a pointermove handler re-renders every
  panel at pointer rate; it is guarded to fire once per drag. Look for that shape
  before adding a store write to any high-frequency handler.
- **Appearance stays in `EntityAppearance.js`.** Adding a species is one entry
  there and nothing else; the legend enforces the rule by being generated from it.
- **A new status is one entry in `STATUS_APPEARANCE`** — a shape, a colour, a
  label, a note, and a predicate over **bulk-snapshot** fields. The grid mark,
  the legend row, and the cycling all follow from it. ⚠ The predicate must read
  a bulk field: an inspection-only fact is known for the _selected_ animal
  alone, so a status built on one would appear and vanish as the selection
  moved.
- **A new event type is one entry in `EventCatalog.js`** — label, group, and a
  retention tier — and it appears in the filter list, in the store's retention
  policy, and in the test that checks the list against the protocol. A type added
  to the engine and not to the catalog fails that test rather than quietly
  landing in the `*other` bucket.
- ⚠ **A bar graph pads with U+00A0, never a space.** A histogram or sparkline
  is one word to the browser, so an ordinary space inside it is a line-break
  opportunity: a bar with an empty bin wrapped there and the rest of the
  distribution appeared on the next line, reading as two bars. Same advance
  width in a monospace font, so nothing about the alignment changes. It applies
  to any drawn-with-characters figure — `MetricsPanel.BAR_LEVELS` and the
  inspector's centred trait bar are both tested for it.
- ⚠ **Do not rely on grid auto-placement in `#main`.** Some of its children are
  placed by hand (the drag handles overlay columns), and a grid that places some
  items explicitly auto-places the rest around them. Give every child its
  `grid-column` and `grid-row` (§8a).
- **Style a panel by what it is, not where it is.** `.panel-column` covers all
  three columns, so a panel can be moved between them without a CSS change —
  which is exactly what moving population out of the sidebar needed.
- ⚠ **Theme form controls by _type_, not by id.** `renderer.css` styles
  `input[type='number']`, `input[type='text']`, `select`, and `button` with
  shared selectors, so a new control is themed the moment it is added. The
  world-composition inputs were once styled through per-id rules
  (`#ctl-seed`, `#ctl-step-n`) and every field added afterwards rendered as a
  bare white browser widget in a dark panel until it was noticed. Reach for a
  per-id rule only for something genuinely specific to that one control (a fixed
  width), never for the base look.
- ⚠ **Do not run BSD `sed -i` over `InspectorView.js`.** It holds multi-byte
  box-drawing characters (`▮ ▯ ▰ ─ █`) for the trait and severity bars, and a
  `sed` pass has already written a **NUL byte** into a template literal there.
  `file(1)` then reports the source as binary and `grep` silently refuses to
  search it — while `node --check` passes and the code runs. Use a text-aware
  editor.
- ⚠ **A protocol change means regenerating the fixtures.**
  `SUPPORTED_PROTOCOL_VERSION` is checked on _every_ message, so a bump without
  `npm run fixtures:renderer` leaves fixture mode refusing everything as
  unsupported.
- ⚠⚠ **So does a change to the demo _roster_, and that half of the rule was
  unwritten until phase 13.** A fixture is a recording of a world, not only of a
  message shape — so a species added or renamed without a regeneration leaves
  fixture mode describing a world the engine no longer runs, and **nothing fails**,
  because the fixtures still carry the right protocol version. It went unnoticed
  for three batches: the committed fixtures still held the _batch-1_ world (no
  lion, no buffalo) while the demo shipped eight species, so offline development
  could not see half of them — including two whose glyphs §9 had assigned in
  advance precisely so a species batch would need nothing here. ⚠ Expect a UI spec
  to move with the regeneration: `tests-ui/event-filters.spec.js` assumed the
  fixtures contain no births or deaths, which stopped being true once eight
  species and 24% more animals meant something dies inside the warm-up.
- ⚠ **Verify against a live simulation, not only fixtures.** The committed
  fixtures predate several protocol layers, so `features[].wear` and
  `disturbances[].until` had never been exercised by a renderer test. Running the
  server and feeding a real `/api/snapshot` through the store is the check that
  would have caught it.
- **Update the four documents with the change, not after it** (E4).

---

## 11. Failure patterns worth remembering

Every one of these cost real time. Recorded as patterns, not anecdotes.

- ⚠ **A duplicate annotated as a duplicate is still a duplicate, and it comes due
  the first time the thing it copies grows.** `SpriteGridRenderer#drawStatusMark`
  was a line-for-line copy of the ASCII renderer's, carrying the comment "kept
  identical to AsciiGridRenderer's, since the marks are the shared status
  language" — an accurate description of a latent bug. Adding a third shape
  (`chevron`, 2026-08-04) to one copy would have drawn a diamond in the other with
  **nothing failing**, in the mode fewest people run. The fix was the one the
  comment was asking for: one exported `paintStatusMark`, two callers, colour
  resolution left to each. **When you write "kept identical to X", extract it
  instead** — the comment is the design telling you what it wants.

- **A `switch`-free but equally silent trap: the wrong update path.** A value in
  the wrong one of the three panel update paths (§5) fails _silently_ — a live
  value in the structural pass freezes; a structural change treated as a live
  value patches a node that does not exist and does nothing. The signature errs
  toward rebuilding precisely so mistakes cost a wasted rebuild rather than a wrong
  display.

- **A half-working feature hides better than a broken one.** Ground rows (forage,
  wear, a fire's countdown) were baked in at build time from Phase A and silently
  went stale under a stationary selection — everything _else_ in the panel updated,
  so the panel looked like it worked. B5 caught it only because polling forced the
  question. If a value comes from the world rather than the selection, it is live.

- **Two wiring bugs from one root cause — the view overwrites its container.**
  (1) The docked "float" control was inserted inside the view's container and
  survived only until the next selection. (2) `mount()` added listeners per call,
  so dock/undock cycles stacked them — five cycles, five writes of the open-set per
  toggle. Both caught in review, not by a test; both fixed by keeping controls
  outside the view's host and binding listeners once per host via a `WeakSet`.

- **Highlight and numbers must describe the same tick.** The utilities block
  highlighted the _live_ action while the utility numbers came from the inspection
  tick, so a highlight could caption numbers that described a different decision.
  It now reads the inspection payload's own `action` — more correct _and_ cheaper,
  since the live value would also force a structural rebuild every time an animal
  changed its mind.

- **Escape before you linkify.** Reversing the order lets an event's own `<` and
  `>` become markup. Tested.

- **A tight bound was hiding a bug, and relaxing it exposed one.** The event
  dedupe watermark was never reset on a restart, and a restarted simulation
  numbers its events from 1 — so every event of the new world was dropped as
  already-seen. Nobody saw it, because the old world's 150 events aged out within
  a tick or two and an empty log after a restart looks like a quiet world. The
  fix is two lines in `applyFullSnapshot`; the lesson is that a small buffer can
  make a correctness bug read as ordinary churn.

- **⚠ A half-placed CSS grid looks right and cannot be clicked.** Adding the
  column drag handles to `#main` without giving them a `grid-row` auto-placed
  them into a _second_ row, which halved every column's height and left the
  panels' content laid out below the box that was supposed to clip it. Nothing
  looked obviously broken in a screenshot; what failed was three specs that
  click things — including one whose message named `#main` as the element
  intercepting the click, which is the tell. ⚠ **The fix is not the handle's
  `grid-row`, it is placing every child explicitly**: the first attempt set the
  row on the handles alone and made it _worse_, because the asides were still
  auto-placed and now had to route around three occupied cells.

- **⚠ A view of the past resolved against the present.** Every `#123` in the
  event log was resolved through `getEntity`, which answers _now_ — so a line
  recording a hunt drew its prey as the carcass it had become in that same
  delta, and as a bare `#` once the body decayed away. Nothing was stale and
  nothing threw; the line said something true about an id and false about the
  event. ⚠ **The tell is a panel whose content is historical and whose lookups
  are live**, and the fix is a renderer-side memory rather than a protocol
  change — the log's own retention already says how long that memory has to
  last. The regression test drives it end to end (kill, then remove) and was
  checked against the old code, because a test for a lookup that _usually_
  succeeds passes vacuously.

- **A prefix vocabulary drifts unless something owns it.** The event log's line
  marks were written inline in `formatEvent`, one `case` at a time, and ended up
  with seven two-character marks and four characters each meaning two different
  things — while every individual line still looked fine. Moving the mark into
  `EventCatalog` beside the label and the retention tier made the collision
  _checkable_, and the check is two assertions. The general shape: **a value
  chosen per-case in a long `switch` has no invariant; the same value in a table
  has one.**

- **⚠ A `sed -i` NUL byte in a file with box-drawing characters.** See §10. The
  insidious part is that the code still ran and `node --check` still passed, so the
  corruption was invisible until `grep` refused to search the file.

- **A long coalesced step drops events, and now there is a number for it.** ~77 000
  emitted, 8 810 delivered at 500 ticks (P12). World state exact, narration
  truncated. Inherent to a bounded outbox; coalescing just makes it easy to hit.

- **Measure event frequencies before shipping a toggle.** "Pause on courtship"
  sounds rare and fires every few ticks (79 in ~480). The hints say which are
  frequent because the intuition is wrong.

- **A cheap inner lookup is only cheap at today's N.** The metrics sparklines did
  a linear `find` over the history inside a per-species, per-trait loop —
  invisible at three species, ~84k comparisons per render at ten. Nothing about
  the code changed to make it wrong; the roster did. It was found by reading for
  it ahead of the species that would expose it, and fixed with the collapsible
  work rather than rediscovered as jank — which is the same "audit for it in
  advance" move the engine's mass audit is.

---

## 12. Phase history

The renderer was built in lettered phases after the engine reached a
demonstrable state, each leaving it runnable and its coverage current with the
protocol. This table is the index; the design reasoning is folded into §2–§9
above, and the full dated completion notes live in `PLAN-RENDERER.md`.

| Phase     | What it added                                                                                                                                  | Protocol | Status   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | :------: | -------- |
| **A**     | Selection becomes a **cell**, not an entity — ground is inspectable; 10px zoom floor; drag-to-pan; pure `CellDetail`                           |    —     | Complete |
| **B4**    | The **two-pass** inspector: values patched, shapes rebuilt, so the panel survives a tick (a blocking prerequisite for everything else in B)    |    —     | Complete |
| **B1–B3** | One view, two hosts (floating popover + docked sidebar); anchored/draggable/pinnable popover; progressive disclosure with a persisted open-set |    —     | Complete |
| **B5–B7** | Poll the selected entity while open; clickable `#123` ids; a legend generated from the appearance registries                                   |    —     | Complete |
| **C1–C3** | Run state polled from the host, not remembered; a transport bar; stepping auto-pauses first                                                    |    —     | Complete |
| **C4**    | The runner coalesces a multi-tick step into **one** delta (the only server-side change)                                                        |    —     | Complete |
| **F1–F3** | Auto-pause on watched events; restart-with-seed; speed as a `«`/`»` ladder                                                                     | **v28**  | Complete |
| **D**     | Stepping backward — **undecided** between D1/D2/D3 (§1.2)                                                                                      |    —     | Open     |
| **E**     | Fixtures and docs — E3 (an inspection fixture) is the one with value left (§1.4)                                                               |    —     | Partial  |

Ordering was **B4 → A → B1–B3 → C1–C3 → B7 → C4 → D → E**, with F added after C
on direct request. B4 came first because every tooltip behaviour depends on the
panel surviving a tick.

---

## 13. Extending the renderer

- **To add a species glyph:** one entry in `SPECIES_APPEARANCE` keyed by the
  protocol `speciesId`, e.g.
  `'predator.fox': { glyph: 'f', colorToken: 'orange', priority: 55, label: 'fox' }`.
  `colorToken` must be a key of `DRACULA_COLORS`. Nothing in the grid algorithm or
  the legend changes — the legend reads the registry. **Check first: the ten
  planned roster species already have entries** (§9), so a species batch usually
  needs nothing here.
- **To retire a renamed species:** delete the entry carrying `supersededBy` once
  the engine stops shipping that id. Its successor is already in the registry with
  the glyph it inherits; the tests in `renderer-view.test.js` are the checklist.
- **To show a new protocol-visible field:** once the protocol actually provides
  it, add one `<div class="field">` row to the relevant formatter in
  `InspectorView.js`. ⚠ Two follow-ups fail silently: if the row can appear or
  disappear, add it to `structureSignature`; if the value changes per tick, add it
  to `liveFields` with a `data-live` key (§5).
- **To add a whole section:** return `section(id, title, badge, body)` from a
  formatter — `null` when the protocol sent nothing — and add it to
  `describeSections`. The `id` keys the remembered open-set, so it must be stable.
- **To add an event type the engine now emits:** one entry in `EVENT_CATALOG`
  (`type`, `label`, `group`, and `retention` — `PASSING` only if it arrives many
  times a tick), plus a `case` in `EventLog.formatEvent` for a line better than
  the generic fallback. The checkbox, the retention tier, and the filter count
  all follow from the entry.
- **To add a status mark:** one entry in `STATUS_APPEARANCE` — `shape`
  (`dot` for a condition, `diamond` for a state, `chevron` for where the animal
  is), a `colorToken` no other status uses, a label, and `applies(entity)` over
  bulk-snapshot fields. The legend row and the cycling come for free. If the fact
  is not in a bulk snapshot yet, that is a protocol change first (v30, v31 and v32
  are each exactly that: `gestating`/`seekingMate`, `elevation`, and `flying`
  projected so a rut, a treed leopard and a bird on the wing could be marked at
  all). ⚠ A **new shape** is three edits rather than one — the registry, the
  `STATUS_SHAPE_GLYPHS` table in `Legend.js`, and `paintStatusMark`'s path — and
  the bar for adding one is high: see §9, the channel is at its useful limit.
- **To replace the Canvas renderer:** implement a new `draw({ store, camera })`;
  the store, transports, protocol, and engine are untouched.
- **To use a different spritesheet:** edit the `SHEET` constants at the top of
  `rendering/SpriteConfig.js` (sprite width/height, gap, margin, url), drop the
  PNG at `src/renderer/app/assets/spritesheet.png` (or load it in the editor),
  and assign sprites in `/sprite-editor.html`. To commit a finished mapping as
  the default, Export it there and fold the JSON into `DEFAULT_SPRITE_CONFIG`.
- **To replace the Canvas renderer:** implement the grid-renderer contract
  (`resize(w, h, dpr)`, `cssWidth`/`cssHeight`, `draw({ store, camera, ... })`)
  and pass a `createGridRenderer` factory to `RendererApp` from `main.js` —
  exactly how `SpriteGridRenderer` is wired; the store, transports, protocol,
  and engine are untouched. Async assets repaint via `app.requestRedraw()`.
- **Never invent a field**, and keep all appearance in `EntityAppearance.js` (§10).
