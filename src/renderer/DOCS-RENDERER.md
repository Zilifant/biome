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

### Current state (as of 2026-07-24)

|                     |                                                            |
| ------------------- | ---------------------------------------------------------- |
| Phases complete     | **A, B, C, F** — Phase D (stepping back) undecided         |
| Tests               | renderer 94, runner 18 (of 725 repo-wide); 24 in `tests-ui` |
| Protocol understood | **28** (`SUPPORTED_PROTOCOL_VERSION`), matching the engine |
| Coverage            | every protocol layer through v28 is drawn or inspectable   |
| Zoom levels         | 10–32px; 10px is a floor, not a default                    |
| Git                 | uncommitted (the user handles git)                         |

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

- **⚠ P9 — The inspector popover has never been driven in a browser.** Its pure
  logic is tested and its wiring was reviewed (which caught two real bugs — see
  §11), but popover positioning, edge-flipping, dragging, and the `<details>`
  toggle path have not been exercised by a real DOM. There is no browser
  automation here, and a hand-rolled DOM stub would test the stub more than the
  code. This is the one part of Phase B standing on review rather than evidence.
  The clicks that would settle it: select a cell near the right edge (flip), drag
  the header (pin), press dock then float, expand Genome and reload (persistence).

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

### 1.4 Tooling and docs

- **P6 / E3 — Fixture mode has no inspection or metrics data at all** (`http` is
  `null` there), so the inspector shows ground and bulk fields but no sections
  offline, and the metrics panel is empty. Closing it means adding an
  `entity.inspection` fixture to `scripts/generateRendererFixtures.js`. More
  annoying now that collapsible sections are the bulk of the panel.
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
  transports/
    RendererTransport.js      transport contract + normalized event types
    WebSocketRendererTransport.js  live stream, backoff reconnect, epoch guard
    HttpRendererTransport.js  REST queries, command fallback, recovery snapshots
    FixtureRendererTransport.js    offline replay of committed fixtures
  ui/
    StatusPanel.js            connection/tick/entities/camera/zoom bar
    CellDetail.js             pure description of one cell's ground
    InspectorView.js          what the inspector says (ground + occupants + sections)
    InspectorPanel.js         where the inspector is (floating popover or docked sidebar)
    Legend.js                 the key to the grid, generated from the registries
    MetricsPanel.js           population histograms, generations, selection differentials
    EventLog.js               domain-event feed, one filter per event type
    Watchlist.js              which events are worth auto-pausing on (pure)
    Controls.js               transport bar: run/speed/step, auto-pause toggles, restart
  styles/
    dracula.css               the Dracula Classic palette (single source of color)
    renderer.css              layout and panel styling
fixtures/                     committed protocol messages for offline development
```

Drawing is isolated in `AsciiGridRenderer` behind `draw({ store, camera })` plus
the pure projection/appearance modules. A future WebGL/DOM/terminal renderer
replaces that one class; the store, transports, protocol, and engine are
untouched — the engine never knows a renderer exists.

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
a filter scan over that full buffer is 0.014 ms. Keeping *everything* is what is
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
event vocabulary (29 boxes: 28 types plus a catch-all), so it lives in a
`<details>` that **starts closed on every load**, with `N of 29` in its summary
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

Verified live rather than only against fixtures: after 3043 ticks the default
feed held births and deaths back to **t483**, where the previous 150-event bound
kept roughly one tick's worth. ⚠ It keeps everything it *receives* — a long
coalesced step still drops events in the host's outbox before they ever arrive
(P12).

### Clickable ids

Every `#123` in the inspector and event log is a button that selects and centres
that animal. ⚠ **Escape before you linkify.** Event-log lines are plain text
containing `<` and `>` (`<until t1205>`), so `linkifyIds(escapeHtml(text))` is the
only safe order; the reverse lets an event's own punctuation become markup.
Tested. The herd id is linkable too — a `groupId` _is_ an animal's id — but the
animal it names may have died and left the label behind, in which case the click
reports "not in view" rather than navigating.

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

### Restart with a seed (protocol v28)

`simulation.restart { seed?, width?, height?, herbivores?, predators?, scavengers?, rocks?, thickets? }`,
a runner-level command. A restart is the one change that cannot be a delta — no
shared ids, tick, or `simulationId` — so the runner emits its own `restart` event
and the WebSocket transport broadcasts a **full snapshot**, and the store
_replaces_ its state.

The optional world-composition fields (dimensions, per-role founder counts, and
terrain prevalence) were added additively — omitting them reproduces the original
behaviour, so the protocol version did not move. The layering is deliberate: the
**renderer** speaks in roles (herbivores/predators/scavengers) and abstract
terrain prevalence (rocks/thickets) and validates against restated bounds; the
**runner** stays ignorant of world composition and hands the options to the
engine factory the host gave it; `createServer`'s factory routes them through
`buildDemoConfig`, which is the single place that maps a role to its species id
(`herbivore.grazer`, `predator.stalker`, `scavenger.corvid`) and turns a count
into a `config.demo.founding` override. **Terrain prevalence is an abstract
`0..MAX_TERRAIN_PREVALENCE` level, not a count** — 0 is none of that terrain,
`DEFAULT_TERRAIN_PREVALENCE` (2) reproduces the demo's own terrain, and the top
crowds out open grazing ground — and `buildDemoConfig` maps it linearly through
the default to the generator's `terrain.ridges` (rock) and `terrain.thickets`
formation counts, so the renderer never has to know a formation from a cell.
Bounds are the protocol's (`MAX_WORLD_DIMENSION`, `MAX_FOUNDING_*`,
`MAX_TERRAIN_PREVALENCE` in `commands.js`), chosen high enough to reach the sim's
performance ceiling — a ~1M-cell world, tens of thousands of founders — without
an out-of-memory or a non-terminating build. An explicit `0` clears a role
(`?? count`, not `|| count`) or a terrain type. The renderer drops its
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

**Draw order is deliberate and layered:** terrain → worn ground (features) →
disturbances → memory marks / home-range ring → entities → brackets (herd,
family, hunt) → selection overlay. The rule throughout is that the more permanent
and less urgent a thing is, the further under it is drawn: worn ground is the most
permanent thing on the map and the least urgent to see; an animal caught in a fire
must stay visible, which is the whole point of watching it get caught.

**Two condition tints ride on `healthFraction` / `diseaseState`** without any new
bulk fields: a living animal below `HURT_HEALTH_FRACTION` is drawn hurt, and a
**symptomatic** animal is tinted purple (taking precedence, since an outbreak
crossing a herd is the thing worth seeing). ⚠ An **incubating** animal is
deliberately _not_ tinted even though the protocol sends its state — the whole
disease model rests on a carrier being invisible, and colouring one would hand the
viewer information no animal in the world has. `resolveColorToken` is kept separate
from `resolveAppearance` so the glyph (a cached species fact) and the tint (a
moment-to-moment condition) stay independent.

**The legend is generated, never written.** `describeLegend()` reads the
appearance registries, so adding a species updates it for free and it cannot drift
from what the grid draws. Four tests enforce that every registry entry (every
species in both its young and grown case, every terrain, feature, disturbance,
memory kind, and carcass stage) reaches it and that every colour token is a real
Dracula value. The condition tints, the bracket overlays, and the **age/sex
key** (`young / grown` and the italic `female` row) are the hand-written part,
because they describe how a glyph is _cased, styled, or coloured_ rather than
which glyph is drawn.

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
  selection uses; `groundAppearanceAt` exists in `AsciiGridRenderer` so the
  terrain pass and the selection overlay resolve ground identically. What a panel
  claims and what is drawn can never disagree.
- **A per-tick cost is a real budget, and the store notifies on every change.**
  The inspector rebuild (R3), B5's polling, and C4's snapshot flood were each one.
  `store.setFollowedEntity(null)` inside a pointermove handler re-renders every
  panel at pointer rate; it is guarded to fire once per drag. Look for that shape
  before adding a store write to any high-frequency handler.
- **Appearance stays in `EntityAppearance.js`.** Adding a species is one entry
  there and nothing else; the legend enforces the rule by being generated from it.
- **A new event type is one entry in `EventCatalog.js`** — label, group, and a
  retention tier — and it appears in the filter list, in the store's retention
  policy, and in the test that checks the list against the protocol. A type added
  to the engine and not to the catalog fails that test rather than quietly
  landing in the `*other` bucket.
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
- ⚠ **Verify against a live simulation, not only fixtures.** The committed
  fixtures predate several protocol layers, so `features[].wear` and
  `disturbances[].until` had never been exercised by a renderer test. Running the
  server and feeding a real `/api/snapshot` through the store is the check that
  would have caught it.
- **Update the four documents with the change, not after it** (E4).

---

## 11. Failure patterns worth remembering

Every one of these cost real time. Recorded as patterns, not anecdotes.

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

- **⚠ A `sed -i` NUL byte in a file with box-drawing characters.** See §10. The
  insidious part is that the code still ran and `node --check` still passed, so the
  corruption was invisible until `grep` refused to search the file.

- **A long coalesced step drops events, and now there is a number for it.** ~77 000
  emitted, 8 810 delivered at 500 ticks (P12). World state exact, narration
  truncated. Inherent to a bounded outbox; coalescing just makes it easy to hit.

- **Measure event frequencies before shipping a toggle.** "Pause on courtship"
  sounds rare and fires every few ticks (79 in ~480). The hints say which are
  frequent because the intuition is wrong.

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
  the legend changes — the legend reads the registry.
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
- **To replace the Canvas renderer:** implement a new `draw({ store, camera })`;
  the store, transports, protocol, and engine are untouched.
- **Never invent a field**, and keep all appearance in `EntityAppearance.js` (§10).
