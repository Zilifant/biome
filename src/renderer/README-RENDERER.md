# biome ASCII renderer

A browser-based ASCII grid renderer for the biome simulation, in the visual
tradition of classic roguelike / Dwarf Fortress-style interfaces: a dark
Dracula-themed monospace character grid, one glyph per world cell, discrete
cell updates, and compact information-dense panels.

> **Invariant: the renderer portrays authoritative simulation output. It
> does not participate in ecological simulation.** It never computes
> ecological outcomes, never advances simulation time, and never mutates
> organism state — all external change is sent as protocol commands, and
> everything drawn comes from snapshots, deltas, and domain events.

## Running

```bash
npm install
npm run dev            # then open http://localhost:3000
```

- **Live mode** (default): streams from the running simulation over
  WebSocket (`/ws`), with HTTP (`/api/...`) for inspection and recovery.
- **Fixture mode**: `http://localhost:3000/?mode=fixture` (or `?fixture=1`)
  replays the committed protocol fixtures in `fixtures/` — no simulation
  involved. The status bar shows an orange FIXTURE badge, simulation
  commands are disabled, and the Reconnect button becomes "Replay". Fixture
  mode never pretends to be live.

`PLAN-RENDERER.md` is this subsystem's development roadmap — phases, completion
notes, and carried-forward issues; `HANDOFF-RENDERER.md` is the short version for
picking the work back up. Both sit beside this file.

## Architectural boundary

The renderer is fully self-contained in `app/`. It imports **nothing** from
`src/simulation/`, `src/server/`, or `src/protocol/` — it speaks the
versioned protocol purely as message shapes over a transport, and declares
the version it understands (`SUPPORTED_PROTOCOL_VERSION` in
`app/state/RendererStore.js`). `test/renderer-boundaries.test.js` enforces
this mechanically: any renderer import reaching outside `app/` fails CI.

The renderer consumes only: full snapshots, deltas, domain-event batches,
entity inspections, status reports, and structured command results. It owns
only presentation state: camera, zoom, selection, follow target, panel
state, glyph/color mappings, connection state, and previous/current render
projections. Camera position and visibility never affect simulation
fidelity.

## File responsibilities

```text
app/
  main.js                     entry: URL mode selection, composition
  RendererApp.js              orchestration, rAF loop, input, desync recovery
  state/
    RendererStore.js          normalized authoritative-output store, validation
    DeltaApplier.js           pure delta application over the entity map
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
    CellDetail.js             pure description of one cell's ground (terrain, forage, wear, disturbances)
    InspectorView.js          what the inspector says: ground + occupants, protocol fields, and the collapsible sections
    InspectorPanel.js         where the inspector is: floating popover anchored to the cell, or docked in the sidebar
    Legend.js                 the key to the grid, generated from the appearance registries
    MetricsPanel.js           population histograms, generations, selection differentials (polled)
    EventLog.js               bounded domain-event list (moves filtered by default)
    Controls.js               protocol-command buttons + camera buttons
  styles/
    dracula.css               the Dracula Classic palette (single source of color)
    renderer.css              layout and panel styling
fixtures/                     committed protocol messages for offline development
```

## Snapshot and delta handling

`RendererStore.applyFullSnapshot` **replaces** render state;
`applyDelta` updates it (created/updated/removed + carried events). The
store validates protocol version and message shape, and detects
desynchronization: a delta whose `baseTick` doesn't match the current tick,
that references unknown entities, or that belongs to another simulation
throws `StoreDesyncError`; deltas at or before the current tick are dropped
as stale (reconnect protection). On desync `RendererApp` requests a fresh
**full** snapshot (HTTP in live mode, the recorded snapshot in fixture
mode) rather than guessing. Bounded region snapshots
(`/api/snapshot?minX=...`) exist in the protocol, but are not used to
hydrate the store because v1 deltas are world-global — a partial store
would immediately desync. Viewport-bounded subscription is isolated in
`requestSnapshot(bounds)` for when region deltas exist.

Events are deduplicated by `seq` and retained in a bounded buffer (default
150). Delta application records each updated entity's `previousPosition` —
renderer-owned annotation so optional interpolation can be added later
without protocol or store changes.

## ASCII appearance configuration

`app/rendering/EntityAppearance.js` is the only place glyphs and colors
exist. Lookup order: `carcass` kind (or a dead animal) → carcass `%` orange;
species override; kind default; unknown `?`. A starved animal arrives as a
`carcass`-kind entity (protocol v5) carrying `edibleMass` in its inspection
detail. Priorities resolve multi-occupant cells deterministically (living
animal 50 > carcass 40 > unknown 30 > plant 20; ties by ascending id); the
selected entity is drawn as an overlay above everything. Glyphs are strict
ASCII and differ across categories, so color is never the only distinction.

**To add a species glyph**: add one entry to `SPECIES_APPEARANCE` keyed by the
protocol `speciesId`, e.g.
`'predator.fox': { glyph: 'f', colorToken: 'orange', priority: 55, label: 'fox' }`.
The first herbivore, `herbivore.grazer`, maps to `g`/yellow. Nothing in the
grid-rendering algorithm changes. `colorToken` must be a key of
`DRACULA_COLORS` (rendered from the `--dracula-<token>` CSS variable).

**Sex is drawn by letter case** (protocol v21): lowercase female, uppercase
male — `g`/`G` grazer, `s`/`S` stalker — via an optional `glyphBySex` map on the
appearance entry. Colour still says species and priority still decides who wins
a shared cell, so a hunt reads as the predator either way; case is a third,
independent channel, which is what lets a herd's composition read off the grid
at a glance. A species with no `glyphBySex`, or an animal the protocol sends
with `sex: null`, simply keeps its base glyph.

**To show a new protocol-visible field in the inspector**: once the simulation
protocol actually provides the field, add one `<div class="field">` row to the
relevant formatter in `InspectorView.js`. Do not invent fields the protocol
doesn't send. Two follow-ups are easy to miss and both fail silently:

- if the row can **appear or disappear**, add it to `structureSignature`, or the
  panel will patch a node that does not exist yet;
- if the value **changes per tick**, add it to `liveFields` and give the span a
  `data-live` key, or it will freeze at its build-time value.

**To add a whole new section**: return `section(id, title, badge, body)` from a
formatter — `null` when the protocol sent nothing, so the section does not exist
rather than appearing empty — and add it to `describeSections`. The `id` keys
the remembered open/closed state, so it must be stable.

## Controls

| Input | Action (all renderer-local except commands) |
| --- | --- |
| Drag | Pan camera (cancels follow; a drag never selects) |
| Arrow keys / WASD | Pan camera (Shift = 10 cells) |
| `+` / `-`, mouse wheel | Zoom (wheel is anchored near the cursor) |
| Click | Select a cell — ground included (highest-priority occupant active) |
| Click `#123` | Select and centre that entity, from the inspector or event log |
| Tab | Cycle occupants of the selected cell |
| F | Follow / unfollow the selected entity (camera-only) |
| C | Recenter camera |
| Esc | Clear selection |
| Space | Pause/resume via protocol command (live mode) |
| Buttons | Pause, Resume, Step, speed — protocol commands; Recenter, Reconnect/Replay |

Following moves the camera, never the entity. Camera movement sends nothing
to the simulation.

**The cell is the unit of selection, not the entity.** Clicking bare ground
selects the ground and reports it — terrain and its authoritative passability,
quantized forage, any trail or burrow worn into it, and any disturbance whose
circle covers it — rather than clearing the selection. An empty cell is still
marked on the grid, with its ground glyph redrawn in the selection colour so it
never reads as a hole in the map. `app/ui/CellDetail.js` is a **pure** function
over the store that returns that description; the inspector only formats it.

Because every cell is now a click target, the smallest zoom level is **10px**
(it was 6px). A large world therefore no longer fits the viewport at minimum
zoom, which is what drag-panning is for. There is deliberately no click
tolerance: making the target bigger is honest, whereas guessing which
neighbouring cell was meant would let the selected cell disagree with the cell
drawn under the cursor.

## The inspector: one view, two hosts

Clicking a cell opens a **popover** anchored beside it, floating over the grid.
Its header drags, and dragging **pins** it — having deliberately placed the
panel, having it jump away on the next click is not helpful. `dock` moves it
into the sidebar instead; `float` brings it back; `×` or Esc closes it and
clears the selection.

`InspectorPanel` owns *where* the inspector is and `InspectorView` owns *what it
says*, and the two hosts render the same view object — docking is a change of
host, not a different panel. Forking the view would mean maintaining fourteen
section formatters in parallel, which is why the formatters return
`{ id, title, badge, body }` rather than finished HTML: presentation is the
view's decision, not theirs.

It is deliberately **not a modal**. `role="dialog"` describes it, but focus is
never trapped and the grid behind it stays live — the whole point is to watch an
animal while the simulation runs, so panning, zooming, and stepping keep
working. A focus trap would make the inspector fight the thing it exists to
inspect.

**The selected animal's detail stays fresh.** Inspection is a query rather than
a stream, so while the panel is open the renderer re-fetches the active entity
every two seconds — one entity, cancelled the moment the selection changes.
Without it the utilities, perception, memories, and stamina of a selected animal
froze at the instant it was clicked while the animal carried on acting, which
made the most interesting part of the panel the least trustworthy. The
percentages come from deltas and update every tick; the absolutes are labelled
with the tick they were read at.

**Every `#123` is a way into the grid.** Ids in the inspector and the event log
select and centre that animal — so a birth, a hunt, a contest, or a lineage can
be followed rather than read as a number and hunted for by eye. The event log's
lines are plain text containing `<` and `>` of their own, so they are escaped
first and linkified second; reversing that would let an event's own punctuation
become markup.

**Sections are collapsed by default.** An animal carries fourteen sections'
worth of biology — genome, traits, memories, herd, range, migration, mate
choice, disease, injuries, family, utilities, perception — and showing all of it
at once was the readability problem this replaced. What stays open is identity,
condition, action, and the ground. Which sections a viewer expands is remembered
in `localStorage` (`biome.inspector.openSections`) and re-applied on every
rebuild, so expanding Genome once keeps it expanded across selections and
reloads. That is renderer-owned presentation state, which is why it lives in the
browser rather than in the store.

## Panel rendering: two passes

The inspector is re-rendered on every store change — once per authoritative
tick. A full `innerHTML` rebuild at that cadence destroys scroll position, text
selection, and (once sections become collapsible) any open/closed state a viewer
has set. So rendering is split:

- the **structural** pass builds the markup, and runs only when the *shape* of
  what is shown changes — a different cell, different occupants, a new
  inspection payload, or an optional row appearing or disappearing;
- the **patch** pass runs every tick and writes only the ~10 bulk-snapshot values
  into nodes cached at build time, marked in the HTML with `data-live="<key>"`.

`structureSignature` decides between them and is exported precisely because it
*is* the mechanism — it is pure, so `renderer-view.test.js` covers it without a
DOM. `describeSections` is exported for the same reason. When in doubt the panel
rebuilds: a missed signature field costs one wasted rebuild, while a missed field
in `liveFields` would silently show a stale number.

Section *contents* are reconciled rather than rebuilt: `#patchSections` replaces
only the bodies and badges whose HTML actually changed, so an inspection poll
touches the two or three sections that moved and leaves the rest — and their
open/closed state — alone. The section **id set** is part of the signature,
since a section that has just appeared has nowhere to be patched into.

One consequence worth knowing before editing: **the view owns its container and
overwrites it wholesale on a structural rebuild.** A control placed inside that
container survives exactly until the next selection — which is why the docked
header sits outside the view's `.dock-body` rather than inside it.

⚠ **Do not run BSD `sed -i` over `InspectorView.js`.** It contains multi-byte
box-drawing characters (`▮ ▯ ▰ ─ █`) for the trait and severity bars, and a
`sed` pass has already written a NUL byte into a template literal here — which
`file(1)` reports as a binary file and `grep` refuses to search, while
`node --check` still passes and the code still runs.

## The legend

`app/ui/Legend.js` is the key to the grid, and it is **generated from the
appearance registries** rather than written out. That is the whole design:
`EntityAppearance.js` is the single source of glyphs and colours, so the legend
cannot drift from what is actually drawn, and adding a species updates the
legend for free. A hand-maintained legend would be wrong within one step.

`describeLegend()` is pure and returns plain data; `renderer-view.test.js`
asserts that every species (with both sex glyphs), every terrain type, feature,
disturbance, memory kind, and carcass decay stage reaches it, and that every
colour token is a real Dracula value. Only the condition tints and bracket
overlays are hand-written, because they describe how a glyph is *coloured* or
*bracketed* rather than which glyph is drawn, and have no registry to read from.

## Dracula palette

`app/styles/dracula.css` defines the exact Dracula Classic values as CSS
custom properties; `EntityAppearance.DRACULA_COLORS` mirrors them for
canvas/test use. Derived shades may only mix these values or apply opacity.
Semantics: green = plants/success, red = death/danger/failure, orange =
carcass/warnings/fixture, yellow = animals, bright-yellow = selection,
purple = unknown/headings, cyan = water (reserved)/follow marker, comment
blue = secondary text.

## Replacing the Canvas renderer later

Drawing is isolated in `AsciiGridRenderer` behind
`draw({ store, camera })` plus the pure projection/appearance modules. A
future WebGL/DOM/terminal renderer replaces that one class; the store,
transports, protocol, and simulation are untouched — the engine never knows
a renderer exists.

## Protocol layers, newest first

What the renderer does with each layer the protocol projects, and why. Open
gaps and deferrals live in `PLAN-RENDERER.md` §4 rather than here.

- Worn ground (protocol v27): trails and burrows arrive as a revision-gated
  sparse list (`{ revision, cells: [{ cellX, cellY, kind, wear }] }`) on both
  snapshots and deltas, and are drawn from `FEATURE_APPEARANCE` (`:` trail
  orange, `o` burrow grey) *over* terrain and *under* everything that happens on
  it — worn ground is the most permanent thing on the map and the least urgent
  to see. The projection carries only cells deep enough to *be* something, so
  the pass walks a short list rather than the grid and costs nothing on a world
  nobody has worn down. `environment.feature` is routine-filtered in the event
  log, because ground genuinely turns over and the state already rides in every
  snapshot.
- Disturbances (protocol v26): fires, floods, and storms ride whole in both
  snapshots and deltas as a bounded list of circles, so the renderer walks the
  visible cells of each active region rather than the whole grid, and costs
  nothing when nothing is happening. `DISTURBANCE_APPEARANCE` draws `^` fire,
  `~` flood, `*` storm over the ground and *under* the animals — a disturbance
  happens to the ground rather than standing on it, and an animal caught in one
  has to stay visible, which is the whole point of watching it get caught. An
  **empty** list is the message that everything has stopped, not the absence of
  one. The event log formats `environment.disturbed` / `environment.settled`,
  the latter with how long it actually lasted — the one fact that is gone once
  the record is.
- Migration (protocol v25) is inspection-only. The panel shows which way an
  animal is drifting and the live habitat reading that drift was computed from,
  beside each other for the same reason a courtship shows its threshold beside
  the quality: otherwise a bias is an arrow with no argument behind it. A
  dispersing juvenile is called out separately, because that drive *overrides*
  the habitat reading rather than competing with it, and showing both without
  saying which is winning would mislead.
- Disease (protocol v24). `diseaseState` rides in bulk snapshots so an outbreak
  is watchable, and a **symptomatic** animal is tinted purple — taking precedence
  over the hurt tint, since an outbreak crossing a herd is the thing worth
  seeing and a sick animal is usually losing health anyway. An **incubating**
  animal is deliberately *not* tinted even though the protocol sends its state:
  the whole model rests on a carrier being invisible, and colouring one would
  hand the viewer information no animal in the world has. The inspector panel
  spells out `infectious` separately from `symptomatic` for the same reason.

## Known limitations

- No interpolation: entities jump cell-to-cell each authoritative tick (by
  design for v1; `previousPosition` is already tracked for later).
- The whole world state is streamed; bounded subscriptions await
  region-scoped deltas in the protocol.
- Per-cell **territory ownership is not shown**: the claim layer is not
  projected (`PLAN.md` §1.4 A36), and a selected animal's
  `territory.standingOn` answers that for one animal rather than for a cell. The
  cell description stays silent about ownership rather than guessing.
- Simulation controls are still minimal — one-tick stepping, and the run state
  in the status bar is a local guess rather than the server's. `PLAN-RENDERER.md`
  Phase C.
- Fixture mode has no inspection or metrics data at all (`http` is null there),
  so those panels are empty offline. `PLAN-RENDERER.md` E3.
- Fixture playback covers one delta (ticks 10 → 11); use Replay to loop.

## Protocol layers, older

The rest of the layers, newest first. These are descriptions of what the
renderer does with each, not limitations — they sat under "Known limitations"
for several steps, which is how the section came to mix the two.

- Terrain is authoritative (protocol v2): full snapshots embed a terrain
  block (`{ width, height, cellTypes, encoding: 'rle-row-major', runs }`),
  also available at `GET /api/terrain`. The store decodes the RLE into a
  row-major cell lookup (`terrainNameAt`); the grid renderer maps each cell's
  legend name → glyph/color via `TERRAIN_APPEARANCE`
  (ground `.`, water `~`, rock `#`, cover `,`). Codes and passability are
  authoritative; glyphs/colors remain renderer-owned. Deltas never carry
  terrain (it is static).
- Vegetation is authoritative cell biomass (protocol v3): full snapshots
  embed a `vegetation` block (`{ width, height, maxLevel, revision,
  encoding: 'rle-row-major', runs }`) of quantized biomass levels; deltas
  carry sparse `vegetation: { revision, changes: [[cellIndex, level]] }`. The
  store decodes to a row-major `Uint8Array` (`vegetationLevelAt`) and patches
  it in place from deltas. The grid renderer draws a green density ramp over
  the ground for levels 1+ via `VEGETATION_APPEARANCE`
  (`.` → `,` → `"` → bright `"`); level 0 shows the terrain beneath. The demo
  no longer has plant entities — vegetation is the cell layer. Tree `T`
  remains reserved for future individual plants.
- Inspector's absolute energy is re-fetched every ~2s while the panel is open
  (live mode) and labeled with the tick it was read at; the percentage updates
  every tick from deltas.
- Population metrics (protocol v20) come from `GET /api/metrics`, **polled on
  an interval** rather than streamed — histograms for every trait of every
  species would dwarf the per-tick payload, and a summary view needs nothing
  like tick resolution. `MetricsPanel` draws histograms, trends, and selection
  differentials from numbers the engine computed; the only arithmetic it does
  is scaling bars to the tallest bin, which is layout. Since protocol v21 it
  also shows the sex counts and the selection differential **split by sex**,
  which is the row that distinguishes sexual from natural selection: a mate
  preference moves only the sex being chosen.
- Territory (protocol v23) is inspection-only. The claim layer is deliberately
  **not** projected: a per-cell ownership map in every snapshot would rival the
  vegetation block for something that changes far more slowly and matters for
  one animal at a time. Instead the selected animal's home range is drawn as a
  faint purple ring at its radius with a `+` at the centre — a ring rather than
  a filled disc so it frames the ground without hiding what is standing on it,
  and drawn under every other overlay because it is the widest and least
  specific of them. The Range inspector panel adds the numbers: where it lives,
  how far it has strayed, how much ground it holds, and whose claim it is
  standing on.
- Sociality (protocol v22). `groupId` rides in bulk snapshots — a herd you
  cannot see is not a visible result — and selecting an animal brackets its
  groupmates in `comment` grey, *under* the family and hunt marks because a
  groupmate is company rather than kin. There is no group roster in the
  protocol; the renderer scans the visible entities for a matching label, which
  is exactly what the engine does and for the same reason. The Herd inspector
  panel shows the label, how many groupmates are in range, this animal's
  *derived* dominance (unitless — only comparisons mean anything), whether it is
  panicking and how many hops from the sighting, and who it is defending.
  `entity.alarmed` is filtered as routine by default, since a herd in view of a
  predator produces one per member.
- Mate choice (protocol v21) is inspection-only apart from `sex`, which rides in
  every bulk snapshot. The inspector panel shows what the species reads in a
  mate, this individual's choosiness, the standard it is holding right now
  (which falls as it goes unmated), and the last animal it sized up — with the
  quality *and* the threshold, since a rejection with no visible standard just
  looks capricious. `entity.courted` in the event log is formatted the same way,
  for the same reason `entity.hunted` shows its odds.
- Heredity (protocol v19) is inspection-only: the panel lists each locus with
  its two alleles, the genotype they average to, the phenotype actually
  expressed, and the same locus in whichever parents are still resolvable. The
  genotype→phenotype arrow is only drawn where the two differ, which is exactly
  where a tradeoff was paid — a mysterious gap made legible rather than hidden.
- Season and weather (protocol v18) ride whole on both full snapshots and
  deltas — a handful of scalars, so no diffing. The status bar shows
  `season · weather · temperature`, with a renderer-owned tone per weather
  state (`WEATHER_TONE`), and the event log formats `environment.changed`, the
  first world-level rather than per-entity event. The engine sends bare names
  and a number; all the wording is the renderer's.
- Carcasses rot visibly (protocol v17): `decayStage` rides in bulk snapshots,
  and `CARCASS_DECAY_APPEARANCE` ramps a fresh orange `%` down to faint
  `;` and `.` remains. The appearance cache is keyed on the stage as well, so
  the ramp costs nothing per frame. Absolute `edibleMass` stays
  inspection-only, like every other absolute quantity. The event log formats
  `entity.decayed`.
- Injuries (protocol v16) are inspection-only, but the *grid* still shows
  condition: a living animal below `HURT_HEALTH_FRACTION` is drawn in the hurt
  tone, using the `healthFraction` that has been in every bulk snapshot since
  Step 4 — no protocol widening needed. `resolveColorToken` is deliberately
  separate from `resolveAppearance` so the glyph (a species fact, cached) and
  the tint (a moment-to-moment condition) stay independent. The inspector
  lists each wound with a severity bar and the derived impairment percentage,
  and the event log formats `entity.injured` / `entity.recovered`.
- Hunts (protocol v15) are readable without any new bulk fields: `stalk`,
  `chase`, and `flee` ride the existing public `action`, so a pursuit is
  visible in the grid from the glyphs alone. The event log formats
  `entity.hunted` with the capture odds the engine actually used, plus
  `entity.killed` / `entity.escaped`. While a predator is selected, its quarry
  is bracketed in red from the inspection payload's `huntTargetId`. The stalker
  is `S`/red at priority 60, above prey, so a predator standing on its kill
  still reads as the predator.
- Remembered places (protocol v14) arrive in the same inspection payload: at
  most eight per animal, strongest first, each with a kind, a cell, and a
  fading strength. The inspector lists them with a strength bar, and while an
  animal is selected the grid marks its remembered cells with renderer-owned
  glyphs from `MEMORY_APPEARANCE` (`"` food, `~` water, `x` barren, `!`
  danger), alpha-faded by strength so forgetting is visible. These marks are
  drawn *under* the entity and selection layers: they are one animal's private
  map, not world state. An unmapped memory kind draws nothing rather than
  guessing, so a newer engine cannot break this renderer.
- Individual traits (protocol v13) arrive in the same inspection payload:
  seven multipliers around the species average, drawn as a centred bar per
  trait so above/below average reads without comparing numbers. Traits are
  fixed for an animal's life, so the panel only changes when the selection
  does.
- Family links and life history (protocol v12) come from the same
  `entity.inspection` fetch, not from bulk snapshots — relationships are
  deliberately inspection-only so per-tick payloads stay lean. The inspector
  renders parents, offspring, the guardian a dependent juvenile is following,
  and the animal's bounded life-event timeline (born, birthed, weaned,
  dispersed, orphaned, died). While an entity with relatives is selected, the
  grid marks its guardian and offspring with pink brackets, so a family group
  can be picked out of a crowd. Because the data is fetched per selection, the
  marks refresh when the selection changes rather than every tick.
