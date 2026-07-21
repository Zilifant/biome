# biome renderer — development plan

The renderer's counterpart to the repository's `PLAN.md`: a linear, numbered
sequence of phases with completion notes, carried-forward issues (§4), and the
conventions for continuing the work. `HANDOFF-RENDERER.md` is the short version
for picking it back up; `README-RENDERER.md` documents what the renderer *is*
once a phase has landed.

This plan covers `src/renderer/` only. It is deliberately separate from
`PLAN.md`, whose Steps 1–29 built the engine and whose Step 30 is measured
performance optimization: the engine plan advances the *simulation*, and this one
advances what can be *seen and steered* in it. Where a phase needs a change
outside `src/renderer/`, it says so explicitly and in one place (C4 and D3 are
the only two).

Measurements and readings here are dated. Anything undated is a claim about the
code as it stands, not a measurement.

---

## 1. Audit — the renderer as inspected on 2026-07-20

Inspected: the full `src/renderer/app/` tree, `public/index.html`,
`src/renderer/fixtures/`, `src/protocol/{commands,validation,queries}.js`,
`src/server/SimulationRunner.js`, `src/server/transports/`, and the four renderer
test suites (`renderer-view`, `renderer-store`, `renderer-transport`,
`renderer-boundaries`).

### 1.1 What is complete

Every protocol layer through **v27** is drawn or inspectable. The renderer is
not behind the engine on coverage.

| Layer | Where | Status |
| --- | --- | --- |
| Terrain, vegetation density ramp | `AsciiGridRenderer` terrain pass | complete |
| Worn ground — trails, burrows (v27) | `AsciiGridRenderer` feature pass | complete |
| Disturbances — fire, flood, storm (v26) | `AsciiGridRenderer` disturbance pass | complete |
| Entities, sex-by-case, hurt/sick tint, carcass decay ramp | `EntityAppearance` | complete, all three species |
| Memory marks, home-range ring, herd/family/hunt brackets | `AsciiGridRenderer` overlay pass | complete |
| Inspector: 14 sections incl. migration (v25), disease, genome | `EntityInspector` | complete |
| Event log: every emitted event type formatted | `EventLog` | complete |
| Population metrics, per-sex selection differentials | `MetricsPanel` | complete |
| Live + fixture transports, desync recovery, epoch guard | `transports/` | complete |

The architectural boundary holds: nothing in `app/` imports from
`src/simulation/`, `src/server/`, or `src/protocol/`, and
`test/renderer-boundaries.test.js` fails the build if that changes.

### 1.2 Defects and gaps found

| Id | Finding | Phase |
| --- | --- | --- |
| **R1** | Only entities are inspectable. Clicking empty ground *clears* the selection, so terrain, vegetation level, worn ground, and the disturbance burning a cell are all drawn but unreachable — despite every value already being in the store | A |
| **R2** | The inspector is a fixed 300px sidebar rendering all 14 sections unconditionally. Information-complete and unreadable | B |
| **R3** | The inspector does `container.innerHTML = …` on *every* store change, i.e. once per tick. Scroll position, text selection, and any collapse state are destroyed each second | **B4 (blocking)** |
| **R4** | Inspection detail is fetched once per selection and then goes stale. Utilities, perception, memories, stamina, and hunt target freeze at selection time while the animal keeps acting | B5 |
| **R5** | Nothing shows whether the simulation is running. `#simPaused` is fetched once at startup and updated only by commands this client sends, so `Space` acts on a guess that can be wrong | C1 |
| **R6** | `Step` is hardcoded to `{ ticks: 1 }` though the protocol allows 10 000, and it *fails* with `simulation-running` unless already paused — so the button prints a red error on a running sim | C2, C3 |
| **R7** | Backward stepping does not exist and cannot be faked cheaply | D |
| **R8** | No legend. ~25 distinct glyph meanings are on screen and nothing says what any of them mean | B7 |
| **R9** | The minimum zoom level was 6px per cell, which is not a reliable click target | **A2** |
| **R10** | The view pans by keyboard only — no drag-to-pan | **A2** |
| **R11** | `#123` references in the event log and inspector are inert text | B6 |
| **R12** | Fixture mode has `http === null`, so inspection detail *and* metrics are permanently empty — the tooltip cannot be developed offline | E3 |
| **R13** | `README-RENDERER.md` was stale by three steps: its limitations list stopped at v24 and never mentioned migration, disturbances, or features | E4 |

---

## 2. Invariants (inherited; never violate)

These restate `PLAN.md` §2 from the renderer's side. They are the reason this
plan never reaches for a shortcut through the engine.

1. **The renderer portrays authoritative output.** It never computes ecological
   outcomes, never advances simulation time, never mutates organism state.
2. **All external change is a protocol command** on a transport. There is no
   other channel.
3. **Everything drawn comes from snapshots, deltas, domain events, or
   inspection responses.** No invented fields, ever — if the protocol does not
   send it, it does not appear.
4. **Glyphs and colors live only in `EntityAppearance.js`.** The simulation
   stores none.
5. **`app/` imports nothing outside itself.** Enforced mechanically.
6. **Camera and viewport never affect simulation fidelity.**
7. **Rendering frequency is independent of tick frequency.**

A corollary that governs Phase D: the renderer may re-display authoritative
output it has already received, but it may never *synthesize* a state the
simulation did not report.

---

## 3. Phases

Ordering: **B4 → A1–A3 → B1–B3 → C1–C3 → B7 → C4 → D → E.** B4 comes first
because every tooltip behaviour depends on the panel surviving a tick; C4 can
land any time before the step cap is raised.

---

### Phase A — The cell becomes the unit of inspection

#### Objective

Make everything on screen inspectable by making *selection* a cell rather than
an entity, and make a cell a reliable click target.

#### Why this phase comes now

R1 is the largest gap between what the renderer draws and what it will tell you
about, and it is almost entirely local work: the store already holds terrain
names, passability codes, vegetation levels, feature wear, and active
disturbances. Phase B's tooltip needs something to *show* for empty ground, so
the data model has to exist first.

#### A1 — Selection is a cell

`RendererStore.selection` becomes
`{ cellX, cellY, entityIds, activeId }` where `entityIds` may be empty and
`activeId` may be `null`. `selectCell` never clears on empty ground; `Esc` still
clears to `null`. Consumers that read `selection.activeId` already tolerate
`null` (`getEntity(null)` returns `null`), so the change is additive at every
call site except the inspector.

The grid marks the selected *cell* whether or not anything is standing in it —
selection is now a place, and a place you clicked but cannot see marked is a
bug.

#### A2 — A cell is a reliable click target

Raise the zoom floor: `ZOOM_LEVELS` becomes `[10, 12, 14, 16, 20, 24, 28, 32]`
(was `[6, 8, …]`). 10px is the smallest cell that is a comfortable click target
and still resolves a monospace glyph. `DEFAULT_CELL_SIZE` stays 16.

This trades away the two widest zoom levels, so a 128-cell world no longer fits
in a typical viewport at minimum zoom. The view must therefore be fully
pannable, which it is by keyboard but not by mouse. Add **drag-to-pan**:
pointer-down/move/up on the canvas, with a small movement threshold so a click
still selects and a drag never does. `Camera.panByPixels` carries the arithmetic
so it stays pure and testable.

Deliberately *not* done: a click tolerance that selects a near-miss occupant.
Making the target bigger is honest; guessing which neighbouring cell was meant
is not, and it would make the selected cell disagree with the cell drawn under
the cursor.

#### A3 — `CellDetail`: a described cell

New `app/ui/CellDetail.js`, a **pure** function `describeCell(store, cellX,
cellY)` returning a plain description object:

```text
{ cellX, cellY, inWorld,
  terrain:      { name, passable } | null,
  vegetation:   { level, maxLevel },
  feature:      { kind, wear } | null,
  disturbances: [{ id, kind, radius, until, ticksRemaining }],
  occupantIds:  number[] }
```

No DOM, no formatting, no store mutation — which is exactly what lets
`renderer-view.test.js` cover empty ground, a worn cell, and a cell inside a
fire without a browser. `RendererStore` gains `terrainPassableAt` to expose the
passability the legend already decodes but never surfaced.

#### Tests

Camera zoom floor and pixel panning; `describeCell` over out-of-bounds ground,
plain ground, a vegetated cell, a trail cell, a cell inside a disturbance, and a
multi-occupant cell.

#### Acceptance criteria

- [x] Clicking empty ground selects it and reports the ground
- [x] The selected cell is marked whether or not it is occupied
- [x] Minimum cell size is 10px
- [x] The view drag-pans; a click still selects and a drag never does
- [x] `describeCell` is pure and covered

#### Out of scope

Per-cell territory ownership. The protocol exposes a claim only through a
selected animal's `territory.standingOn` — see `PLAN.md` §1.4 **A36**, where
projecting the claim layer was deliberately deferred. `CellDetail` reports what
the protocol sends and stays silent about ownership.

#### Completion notes — 2026-07-20

Landed with B4 (below). `ZOOM_LEVELS` is `[10, 12, 14, 16, 20, 24, 28, 32]`;
`DEFAULT_CELL_SIZE` unchanged at 16. Drag-to-pan uses a 4px threshold measured
from pointer-down, and suppresses the click that would otherwise follow a drag —
without that suppression every pan ended by selecting whatever the pointer
happened to stop over, which is the bug this threshold exists to prevent rather
than a hypothetical.

`describeCell` reports `inWorld: false` for cells beyond the world edge rather
than throwing or inventing ground, so panning past the border is a described
state like any other. The disturbance list is filtered by the same circle test
the grid renderer draws with (`dx² + dy² ≤ r²` against the cell *centre*), so
what the tooltip claims covers a cell and what is drawn over it can never
disagree.

`terrainPassableAt` returns `null` (not `false`) outside the terrain, keeping
"unknown" distinct from "impassable" — a distinction the legend already makes
and the renderer was throwing away.

**Verified against a live simulation on 2026-07-20**, not only against synthetic
fixtures, because the shapes this reads (`features.cells[].wear`,
`disturbances[].until`) had never been exercised by renderer tests. Sweeping all
16 384 cells of the demo world produced no throw, and every in-world cell
returned terrain. On a real radius-14.06 flood, `describeCell` reported coverage
on **622 cells against a circle area of 621.4** — agreement that close is the
check that the panel's circle test and the grid's are the same test, which was
the point of sharing it. `ticksRemaining` read 371 at tick 834 against
`until: 1205`.

---

### Phase B — Tooltip presentation

#### Objective

Turn a 60-row sidebar dump into an anchored, readable, progressively disclosed
tooltip that survives a running simulation.

#### B4 — Stop rebuilding the panel every tick *(blocking prerequisite)*

Split the inspector into two passes:

- **Structural pass** — builds the HTML. Runs only when the *shape* of what is
  displayed changes: a different cell, different occupants, a different active
  entity, a newly arrived inspection payload, or an optional row appearing or
  disappearing. Caches references to every volatile node.
- **Patch pass** — runs on every tick. Writes `textContent` and `className` into
  the cached nodes for the ~10 values that come from bulk snapshots (position,
  heading, age, mass, energy/hydration/health fractions, action, life stage,
  alive).

A structure signature decides between them. Volatile values are marked in the
HTML with `data-live="<key>"`, so the patch pass is a single
`querySelectorAll` at build time and a map write per tick.

One subtlety worth stating, because it is not obvious: the utilities block
highlights the *chosen* action, and it previously read that from the live bulk
field while the utility numbers came from the inspection tick. Those two can
disagree, and using the live value would also force a structural rebuild every
time an animal changed its mind. The highlight now reads the inspection
payload's own `action`, which is both more correct — the highlight and the
numbers describe the same tick — and cheaper.

#### B1 — One view, two mounts

Split data from presentation: `CellDetail` describes, and a single
`InspectorView` renders that description into any host element. Mount it in the
anchored popover and (optionally) the sidebar. Do **not** fork the 14 section
formatters; that is 500 lines maintained twice.

#### B2 — The popover

Anchored in `#viewport-wrap` (already `position: relative`) at the clicked
cell's screen pixel, flipped to stay in view, draggable, with a pin toggle so it
survives while the simulation runs. `role="dialog"`, focus management, `Esc`
closes and clears — the same key as today, so the habit transfers.

#### B3 — Progressive disclosure

Default open: identity, condition, current action, ground. Collapsed
`<details>`: genome, traits, memories, family, herd, range, migration, disease,
mate choice, utilities, perception. Persist the open-set in `localStorage`, so a
viewer who always wants genome open gets it.

#### B5 — Poll inspection while open

Re-fetch the selected entity's inspection every ~2s while the tooltip is open;
cancel on close. One entity, bounded, and it is what turns the tooltip from a
static dump into something you can watch an animal think in. Requires B4 — a
per-poll rebuild would flicker worse than the per-tick one.

#### B6 — Clickable ids

`#123` in the event log and inspector becomes a button that selects and centres
that entity. Cheap, and it makes lineage, hunts, and contests navigable.

#### B7 — Legend

A collapsible legend generated **from** the appearance registries
(`SPECIES_APPEARANCE`, `TERRAIN_APPEARANCE`, `VEGETATION_APPEARANCE`,
`FEATURE_APPEARANCE`, `DISTURBANCE_APPEARANCE`, `CARCASS_DECAY_APPEARANCE`,
`MEMORY_APPEARANCE`), so it cannot drift from what is drawn. Highest value per
line of code in this plan.

#### Acceptance criteria

- [x] **B4**: collapse state, scroll position, and text selection survive a tick
- [ ] The tooltip is anchored, draggable, pinnable, and keyboard-closable
- [ ] Sections are collapsible and their state persists across reloads
- [ ] A legend exists and is generated from the appearance registries
- [ ] Selected-entity detail refreshes while the tooltip is open

#### Completion notes — 2026-07-20 (B4 only)

The structure signature turned out to need the *presence* of every optional row,
not just the selection identity — an animal gaining an `action` or a
`hydrationFraction` changes the row count, and patching a node that does not
exist yet is how this class of optimization usually breaks. Signature mismatches
fall back to a full rebuild, so a missed field is a wasted rebuild rather than a
stale display.

`structureSignature` is **exported**, which is unusual for what is otherwise a
private detail of one panel. It is exported because it *is* the mechanism:
whether the panel survives a tick is decided entirely there, it is a pure
function, and testing it needs no DOM — the repo has no DOM test dependency and
this did not justify adding one. `test/renderer-view.test.js` asserts the shape
is stable across an ordinary tick (position, age, energy, health all moving) and
unstable the moment a row could appear or vanish.

One correctness fix rode along rather than being a pure optimization: the
utilities block highlighted the *live* action while the utility numbers came
from the inspection tick, so a highlight could caption numbers that described a
different decision. It now reads the inspection payload's own `action`.

---

### Phase C — Simulation controls

#### Objective

Make the run state visible and true, and make stepping arbitrary rather than
one tick at a time.

#### C1 — Run state from the server, not from memory

Poll `/api/status` on the existing metrics timer and update from every command
result (they already return `paused` and `speed`). Delete the `#simPaused`
guess. Show `RUNNING`/`PAUSED` and the speed in the status bar.

#### C2 — A transport bar

A single `⏸`/`▶` toggle reflecting *server* state, `+1` / `+10` / `+100`, a
numeric field with `Advance N`, and the speed select driven by server state
rather than a hardcoded default.

#### C3 — Auto-pause before stepping

Send `simulation.pause`, await `ok`, then `simulation.step`. Renderer-side
sequencing of two existing commands; the Step button stops failing on a running
simulation. No engine change.

#### C4 — Coalesce large manual steps *(server-side; the one change outside `src/renderer/`)*

`SimulationRunner.stepManually` loops `#tickOnce`, and each iteration builds a
full snapshot and emits a `tick` that the WebSocket transport broadcasts to
every client. `Advance 500` therefore builds 500 full snapshots and floods the
socket with 500 deltas.

Fix in the runner: step N, then emit **one** delta spanning the first snapshot to
the last. `eventsSince(previous.lastEventSeq)` already covers the whole window,
so no protocol change and no version bump is needed — only the runner's emit
cadence moves. Until this lands, cap the UI at ~50 ticks per press.

#### Acceptance criteria

- [ ] The status bar shows run state and speed, sourced from the server
- [ ] Stepping works on a running simulation without an error
- [ ] `Advance N` accepts an arbitrary N within the protocol's limit
- [ ] A large advance produces one delta, not N

---

### Phase D — Stepping backward

#### Objective

Decide, and then implement, what "decrement by N ticks" means for an engine that
only moves forward. The protocol has no reverse command and
`validateCommand` requires `ticks >= 1`.

Three options, recorded because the choice is a real one:

**D1 — Don't offer it.** Label the control `Advance N`. Zero cost, honest.

**D2 — Renderer-side review buffer** *(recommended)*. The renderer keeps a
bounded ring (~300 ticks) of its own materialized state and scrubs back through
it read-only, behind a loud `REVIEW t1234` badge and a "return to live" button.
No protocol change, no engine change, no invariant violated: this is
re-displaying authoritative output already received, which §2's corollary
permits and which synthesizing a state would not. Limits, to be stated in the
UI rather than hidden: only what this client has seen since connecting, and bulk
snapshot fields only — inspection detail is not in the buffer.

**D3 — True engine rewind.** The persistence layer already supports it: keep a
ring of `captureSimulationState` saves in the runner, restore the nearest, and
replay forward deterministically to the target tick. Exact, and resuming
genuinely continues from there. Costs a new `simulation.rewind` command, a
protocol version bump, memory for the save ring, and a forced full-snapshot
resync for every connected client. **This belongs in `PLAN.md` as its own
numbered step, not here** — it changes the protocol and the host, and this plan
governs the renderer.

D2 delivers most of what the control means in practice at a small fraction of
D3's cost. Recommendation: ship D2; open D3 as an engine step if the difference
turns out to matter.

---

### Phase E — Tests, fixtures, docs

- **E1** — Pure-function coverage for `CellDetail` and the inspector's structure
  signature.
- **E2** — Controls state machine: paused/running reflection, and the
  auto-pause-then-step ordering.
- **E3** — Add an `entity.inspection` fixture to
  `scripts/generateRendererFixtures.js` so the tooltip is developable offline
  (R12). Fixture mode currently shows an empty inspector and empty metrics.
- **E4** — Keep `README-RENDERER.md`, this file, and `HANDOFF-RENDERER.md`
  current *with* each phase rather than after it. R13 is what happens otherwise.
- **E5** — `renderer-boundaries.test.js` needs nothing new; all of this lives
  inside `app/`.

---

## 4. Carried-forward deviations and open issues

| Id | From | Issue | Resolution |
| --- | --- | --- | --- |
| **P1** | A | Per-cell territory ownership is not shown — the protocol carries a claim only via a selected animal's `territory.standingOn` | Blocked on `PLAN.md` §1.4 **A36**; a claim layer would need to earn its per-snapshot cost |
| **P2** | A2 | Two zoom levels (6px, 8px) were removed, so a 128-cell world no longer fits a typical viewport at minimum zoom | Accepted; drag-to-pan is the compensation, and a minimap was judged not worth it for one world size |
| **P3** | B4 | The patch pass covers bulk-snapshot fields only; inspection-derived sections still rebuild structurally when a new payload arrives | Fine at the current fetch rate (once per selection). Revisit if B5's polling makes rebuilds visible |
| **P4** | C4 | Manual steps above ~50 ticks flood the socket until the runner coalesces them | Cap the UI until C4 lands |
| **P5** | D | The renderer cannot show a tick it never received (D2), and cannot move the engine backward at all (D3) | Stated in the UI rather than worked around |
| **P6** | E3 | Fixture mode has no inspection or metrics data at all | E3 |
| **P7** | — | No interpolation between ticks; entities jump cell-to-cell. `previousPosition` is tracked for it | By design for v1 |
| **P8** | — | The whole world is streamed; bounded subscription awaits region-scoped deltas | `requestSnapshot(bounds)` is isolated for when they exist |

---

## 5. Conventions for this work

- **Appearance stays in `EntityAppearance.js`.** A new glyph is one entry there
  and nothing else. B7's legend is generated from those registries precisely so
  the rule is self-enforcing.
- **Describe, then render.** Anything worth testing is a pure function over the
  store returning a plain object (`CellDetail` is the model). DOM code takes
  that object and does no arithmetic beyond layout.
- **Never invent a field.** If the protocol does not send it, the panel says
  nothing rather than guessing — `resolveFeatureAppearance` and
  `resolveMemoryAppearance` returning `null` for unknown kinds is the pattern: a
  newer engine must never break an older renderer.
- **A per-tick cost is a real budget.** The inspector rebuild (R3) was one; so is
  B5's polling and C4's snapshot flood. Measure before assuming.
- **Update the three documents with the change, not after it.**
  `README-RENDERER.md` says what the renderer *is*, this file says what is
  *planned and why*, `HANDOFF-RENDERER.md` says where the work *stands*.
