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
- **Sprite mode**: `http://localhost:3000/?renderer=sprite` draws sprites from
  a spritesheet in place of glyphs (composable with fixture mode:
  `?mode=fixture&renderer=sprite`). See "Sprite mode" below — with no sheet
  supplied it falls back to the glyphs, so it is always safe to open.

**[`DOCS-RENDERER.md`](DOCS-RENDERER.md) is the reference documentation** —
architecture, the selection and panel model, the conventions, and **§1: every
open item**. This file (`README-RENDERER.md`) is the operational companion: how
to run, the controls, and what the renderer does with each protocol layer.
`PLAN-RENDERER.md` is the now-complete phase roadmap, kept for provenance (why
and when a decision was made); `HANDOFF-RENDERER.md` is the superseded handoff
summary. All sit beside this file.

## UI tests

Browser-level tests live in [`tests-ui/`](../../tests-ui/) (Playwright), separate
from the engine's `node --test` suite:

```bash
npm run test:ui           # headless; runs offline, no server, no prompts
npm run test:ui:headed    # watch in a window
```

**When you add or change a UI feature, add or update a test there.** Two
fixtures cover the two cases: `appPage` (offline fixture mode — layout, panels,
canvas rendering, selection/hover/drag) and `live` (a mocked host — for controls
that send commands, exposing the `commands` the UI emitted and a `push` that
sends a frame *down* the socket, which is how a spec drives the world forward:
a delta that kills an animal, a batch of events, a recovery snapshot). The canvas is
tested by sampling pixels, since it is opaque to DOM queries. See
[`tests-ui/README-TESTS.md`](../../tests-ui/README-TESTS.md) for how it runs offline and how
to write a test.

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
    EventCatalog.js           every event type: label, group, and retention tier
  rendering/
    Camera.js                 center + cell size, pan/zoom math (pure)
    GridProjection.js         world → cell → screen-pixel projection (pure)
    EntityAppearance.js       ASCII glyph/color/priority registry (pure)
    MapLayers.js              which data layers exist, and which are switched on (pure)
    SocialLayer.js            the social layer: grouping, bubble geometry, the shared outline painter
    TerritoryLayer.js         the territory layer: claim cells grouped by pride, clan or holder
    AsciiGridRenderer.js      Canvas 2D drawing: terrain → entities → social layer → overlays
  transports/
    RendererTransport.js      transport contract + normalized event types
    WebSocketRendererTransport.js  live stream, backoff reconnect, epoch guard
    HttpRendererTransport.js  REST queries, command fallback, recovery snapshots
    FixtureRendererTransport.js    offline replay of committed fixtures
  ui/
    StatusPanel.js            connection/tick/entities/camera/zoom bar, and the last command's result
    CellDetail.js             pure description of one cell's ground (terrain, forage, wear, disturbances)
    InspectorView.js          what the inspector says: ground + occupants, protocol fields, and the collapsible sections
    InspectorPanel.js         where the inspector is: floating popover anchored to the cell, or docked in the sidebar
    LayerPanel.js             one checkbox per map layer, and the key to what each draws
    Legend.js                 the key to the grid, generated from the appearance registries
    MetricsPanel.js           population histograms, generations, selection differentials (polled), one collapsible section per species
    EventLog.js               domain-event feed with one filter per event type
    Watchlist.js              which events are worth auto-pausing on (pure)
    Controls.js               transport bar: run/speed/step, auto-pause toggles, restart
    collapsible.js            click a panel's h2 header to minimize it (state in localStorage)
    columnResize.js           drag or arrow-key a column edge to widen it (state in localStorage)
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

Events are deduplicated by `seq` and retained in a buffer bounded **per tier**:
milestones (`lasting` — births, deaths, kills, outbreaks, storms) keep 20 000,
the per-tick chatter (`passing` — movement, feeding, provisioning, alarm, worn
ground) keeps 400. `state/EventCatalog.js` assigns the tier. The split is a
frequency judgement: over 1000 demo ticks the five passing types were **99.2% of
127 464 events**, so one shared bound meant a kill scrolled out of the log about
a tick after it happened. A full snapshot clears the buffer only when the
`simulationId` changes — a restart, whose events also number from 1 again, so the
dedupe watermark resets with it; a recovery snapshot for the same simulation
keeps the log. Delta application records each updated entity's
`previousPosition` — renderer-owned annotation so optional interpolation can be
added later without protocol or store changes.

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
The first herbivore, `herbivore.gazelle`, maps to `g`/yellow. Nothing in the
grid-rendering algorithm changes. `colorToken` must be a key of
`DRACULA_COLORS` (rendered from the `--dracula-<token>` CSS variable).

**The whole planned species roster already has an entry**, not only the three
species the engine ships — gazelle, wildebeest, zebra, buffalo, rhino, elephant,
leopard, lion, hyena, and vulture (PLAN-SPECIES §7). Glyph by common name,
colour by trophic family, priority in bands: carnivores 60+, herbivores 50–55,
obligate scavenger 45. Assigning the scheme in one pass is what keeps it
coherent, and it is what lets a species batch be a config change rather than a
config change and a renderer change. ⚠ A shipped species that is renamed into a
roster entry later carries a `supersededBy` naming its successor — which is why
two entries may share a letter — and the old entry is **deleted** in the phase
that does the rename. Grazer → gazelle and corvid → vulture went that way on
2026-07-29, and `predator.stalker` → `predator.leopard` on 2026-07-30 — ⚠ which was
the last one, so **no entry carries `supersededBy` today**. The field and its two
tests stay: the next rename needs them, and a scheme deleted the moment it empties
has to be rediscovered.

**The hyena needed no renderer change at all**, which is what the scheme was
for: it was founded, named, glyphed, and legended the moment its config file
existed.

**Age and sex are two independent glyph channels** on top of the species letter.
**Letter case is age**: a mature animal (`lifeStage` adult or senescent) is
UPPERCASE, an immature one (juvenile or subadult) lowercase — `g`/`G` gazelle,
`p`/`P` leopard. **Italic is sex**: a female is drawn in italic, a male (or an
animal the protocol sends with `sex: null`) upright. Colour still says species
and priority still decides who wins a shared cell, so both are additions rather
than substitutions; a hunt reads as the predator either way, and a herd's age and
sex structure reads off the grid at a glance. An absent or unrecognized life
stage reads as not-yet-grown (lowercase). Both channels are animal-only — a
carcass, plant, or unknown kind keeps its base glyph.

## Status marks

**A hurt, ill, carrying, rutting, dispersing, treed or flying animal carries a
small mark in the upper-left corner of its cell** — a **dot** when something is
wrong with it, a **diamond** when something is happening in its life, a
**chevron** for where it is:

| Mark | Means | |
| --- | --- | --- |
| ● orange | hurt | below 70% health |
| ● purple | visibly ill | a carrier looks healthy |
| ◆ pink | carrying young | until she gives birth |
| ◆ bright-cyan | in rut | receptive, looking for a mate |
| ◆ bright-white | dispersing | a juvenile leaving its natal range |
| ◆ bright-green | up a tree | a climber resting, or a kill cached out of reach |
| » cyan, pointing up | flying | on the wing, which is where a vulture travels |

⚠ **The chevron pair is a `»` rotated to point up**, and it is the only mark in
the legend the panel can only approximate: a legend row is text, and text cannot
rotate. The character it shows is the one the mark is drawn from.

The animal's glyph keeps its own colour. Hurt and ill used to *tint* it, which
cost the two things a letter is for: a purple `g` no longer says "gazelle" at a
glance, and only one condition could ever be shown — an animal that was ill *and*
hurt looked exactly like one that was only ill.

⚠ **An animal in several statuses shows them one at a time, half a second each**,
because four marks in a 10px cell is a smudge. The turn is taken on the **wall
clock**, so the cycle keeps running while the simulation is paused — which is
when someone is most likely to be reading the marks. It costs nothing when
nothing is cycling: the renderer redraws on a phase change only if the last frame
actually drew a multi-status animal.

**A kill fills its cell red for exactly one tick**, behind the body and
everything else in that cell. `entity.killed` carries no position, but the prey
becomes a carcass at the death site in the same delta, so the cell is a lookup
rather than a protocol change — and the flash is gone with the next delta, held
by a pause, and deliberately absent for kills inside a long coalesced step (they
did not happen on *this* tick, and painting them would redden the screen after
`Advance 500`).

Adding one is a single entry in `STATUS_APPEARANCE` (shape, colour, label, note,
and a predicate over bulk-snapshot fields); the legend row and the cycling follow
from it. ⚠ The predicate has to read a **bulk** field — an inspection-only fact
is known for the selected animal alone, so a status built on one would appear and
vanish as the selection moved.

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

## Map layers

**A layer is a reading of the whole map, switched on and off from the Layers
panel in the sidebar.** It is not one of the grid's own passes — terrain,
forage, worn ground, animals are the world and are never toggleable — and it is
not one of the *selected animal's* overlays, which appear and vanish with the
selection. A layer is a fact about **everything at once**, drawn from projected
world state, worth seeing sometimes and in the way the rest of the time — where
the thing a layer must not be is a fact about *one* animal, which is what makes
it a layer rather than an overlay.

Layers default to **off**, are remembered in `localStorage`
(`biome.layers.enabled`), and cost exactly nothing while off — nothing is
computed, nothing is drawn. Adding one is an entry in
`rendering/MapLayers.js` (id, label, note, default) plus whatever module draws
it; the panel row and the remembered set follow from the entry.

### Social (protocol v22 + v33)

**Every group of associated animals is wrapped in a solid, rounded outline**, one
colour per kind of group:

| Outline | Group | From |
| --- | --- | --- |
| ▢ comment blue | herd | `groupId`, the fission–fusion label |
| ▢ bright-cyan | band | `groupRecordId` on a zebra |
| ▢ bright-pink | clan | `groupRecordId` on a hyena |
| ▢ bright-purple | pride | `groupRecordId` on a lion |
| ▢ bright-green | family | `groupRecordId` on an elephant (roster, not yet shipped) |
| ▢ bright-white | group | a record whose species this build has no name for |

⚠ **An animal can be inside two outlines at once, and that is the point.** The
engine models sociality twice (DOCS §9): the herd label is who an animal is
standing with *now*, the record is who it belongs to. So a zebra band shows up
inside the herd its members happen to be standing in, in a different colour. The
label always runs on the **outer** ring and every record inside it, because that
is the containment the world actually has — bands are what a herd is made of.

The shape is built in `rendering/SocialLayer.js`, all of it pure and tested in
`test/renderer-view.test.js`:

1. the cells the members are standing in, **padded by one cell**, which is what
   makes it a bubble rather than a shape cut around glyphs;
2. **holes filled**, so a ring of animals standing around a gap is one outline
   and not a donut;
3. blobs joined by **one-cell-wide arms** along a spanning tree, so an animal
   that has wandered off is still wrapped without inflating the group's whole
   outline to cover the ground in between.

⚠ **An arm longer than `MAX_CORRIDOR_CELLS` (48) is not drawn** and the far
member keeps an island outline in the group's colour. That is a frame budget — a
dispersing animal can be most of a map away — and the more honest picture besides.

The same design language as the selection's corner brackets, deliberately: same
lane just inside the cell edge, same one-pixel stroke. What distinguishes them is
that a social outline is **solid and rounded** where a selection bracket is four
square corner arms — a whole box for a whole group, corners for one cell.

⚠ **Tracing is the most expensive thing this renderer computes**, so two things
bound it: only groups whose members' bounding box touches the viewport are traced
(the whole box, so a group straddling the screen still draws the arm that crosses
it), and the result is memoized on `(tick, viewport)` — every other reason a
frame is drawn reuses it. Measured on the committed fixture (500 entities, ~60
groups): **3.5 ms for the whole map, 0.36 ms for a viewport's worth.**

### Territory (protocol v37)

**The ground each pride and clan holds is wrapped in the same solid, rounded
outline, in the same colour as the group itself.** A leopard, which belongs to
nothing, gets its own ground outlined in its species' colour instead.

It is the social layer's twin on purpose, and the difference between them is the
feature: **a social bubble wraps a set of animals, a territory wraps a set of
claims.** A pride's ground stays where it is when the pride walks off it, so a
purple bubble a long way outside its own purple boundary is a pride away from
home — which is a thing you can watch rather than read about.

- **It reads the claim layer, not the animals.** `store.territory` (v37) carries
  who holds each **coarse** claim cell — `cellSize` world cells across, 4 in
  today's engine — and nothing about how fresh the claim is.
- ⚠ **A claim names an animal, and the group is derived on read, never stored.**
  That is the engine's own rule rather than a renderer shortcut: `holdsClaim` in
  `systems/TerritorySystem.js` asks "is this my *side's* ground" by looking the
  owner up and reading its live `groupRecordId`, precisely so there is no second
  copy of membership to go stale. `rendering/TerritoryLayer.js` does the same
  thing from the same two bulk fields.
- ⚠ **The owner must be alive**, again matching `holdsClaim`. A dead lion's marks
  linger until they decay, and drawing them would show a pride holding ground it
  has already lost. Ground whose holder this client cannot see is not drawn —
  never guessed at, and never attributed to whoever is standing on it.
- ⚠ **No arms.** Two patches of held ground are two outlines. An arm between two
  blobs of a *herd* wraps an animal that wandered off; an arm between two blobs
  of a territory would draw a claim over ground nobody has marked, which is
  exactly what this layer exists to show the absence of. Holes are still filled,
  as they are for a bubble.
- **Traced at claim resolution and scaled afterwards**, which is 16× fewer cells
  at `cellSize` 4 and exact rather than approximate — a claim boundary only ever
  falls on a claim-cell edge. In a world whose width is not a multiple of
  `cellSize` an outline can reach a cell or two past the map, which is the
  projection's own ragged edge showing through.

⚠ **Which species hold ground is engine data, and today that is the lion and the
leopard.** The hyena ships `territory.defends: false` — deliberately, as one of
the three axes keeping it from competing the leopard to extinction (see the
engine's `config/species/scavengerHyena.js`) — so **a clan currently outlines no
ground at all**. The layer names clans and draws them in the clan colour the
moment that changes; nothing here needs editing for it.

## Sprite mode and the sprite editor

`?renderer=sprite` swaps the ASCII canvas renderer for
`rendering/SpriteGridRenderer.js`: same draw order, same store reads, same
projection — only what lands in each cell differs. Every drawable thing (a
grown female gazelle, the water terrain, forage level 3, a fresh carcass, …) is
a **slot** with a stable string id, enumerated from the appearance registries
by `rendering/SpriteSlots.js` the same way the legend is generated. A slot with
a spritesheet assignment draws its sprite; **an unassigned slot draws its ASCII
glyph**, so a partial mapping — or no sheet at all — still renders everything.

**Supplying a spritesheet.** The sheet is a PNG grid of sprites on a
transparent background, addressed by (column, row). One is committed at
`src/renderer/app/assets/spritesheet.png`; its geometry — sprite width/height,
the gap between grid cells, and the top/left margin before the grid starts — is
set as **code constants** in the `SHEET` block at the top of
`rendering/SpriteConfig.js` (currently 12×12, gap 1, margin 1). To use a
different sheet, replace that file (editing the constants if its geometry
differs) or load one in the editor, which stores it as a `data:` URL with the
mapping. With no sheet reachable at all, sprite mode falls back to glyphs.

**The editor** at [`/sprite-editor.html`](/sprite-editor.html) is where sprites
are assigned: every slot with its glyph in a fixed reference column on the
left, the full spritesheet on the right with its grid overlaid — a sheet wider
than the viewport scrolls inside its own panel, so the glyph reference stays in
view. Click a slot, then click a sprite to assign
it. A slot can also carry a **tint** — picked from the native color input or
the Dracula palette swatches — which recolours the sprite as a flat silhouette
(its alpha, one fill), matching the single-colour glyph aesthetic; with no tint
the sprite keeps its own sheet colours. The editor also sets the **canvas
background colour** for the whole grid. Everything saves live to
`localStorage` (`biome.sprites.config.v1`) — reload the main view in sprite
mode to see it — and **Export** downloads the config as JSON (**Import** loads
one), which is how a finished mapping is shared or committed as a new default
(`DEFAULT_SPRITE_CONFIG` in `SpriteConfig.js`).

Everything that is not the glyph carries over from ASCII mode unchanged: the
**status marks** (hurt, ill, carrying, in rut, dispersing, up a tree, flying) are
the same corner dots, diamonds, and chevrons, cycling on the same wall clock — never a recolour, so the
sprite keeps saying species, and an incubating animal is still never marked;
fading ground layers give way beneath an occupant's sprite exactly as beneath
its glyph; the kill flash fills the cell behind everything; and the selection
redraws its cell's sprite in bright yellow exactly as it recolours a glyph.
Overlay marks — selection fill, corner brackets, status marks, the home-range
ring — stay vector-drawn in both modes.

## Controls

| Input                  | Action (all renderer-local except commands)                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Hover                  | Crosshair cursor over the grid; the cell under the pointer is framed in yellow corner brackets            |
| Drag                   | Pan camera (`move` cursor; cancels follow; a drag never selects)                                          |
| Arrow keys / WASD      | Pan camera (Shift = 10 cells)                                                                            |
| `+` / `-`, mouse wheel | Zoom (wheel is anchored near the cursor)                                                                 |
| Click                  | Select a cell — ground included (highest-priority occupant active); grey fill marks the selected cell    |
| Click `#123`           | Select and centre that entity, from the inspector or event log                                           |
| Tab                    | Cycle occupants of the selected cell                                                                     |
| F                      | Follow / unfollow the selected entity (camera-only)                                                      |
| C                      | Recenter camera                                                                                          |
| Esc                    | Clear selection                                                                                          |
| Space                  | Pause/resume via protocol command (live mode)                                                            |
| `[` / `]`              | Slower / faster (steps the speed ladder)                                                                 |
| Drag a column edge     | Widen that column (double-click the handle, or focus it and press Home, to reset)                        |
| Buttons                | Pause/resume, step `+1 / +10 / +100`, `Advance N`, speed — protocol commands; Recenter, Reconnect/Replay |

Following moves the camera, never the entity. Camera movement sends nothing
to the simulation.

**Numbers in the feed are short on purpose.** A ratio drops its leading zero —
`(.63 vs .58)`, not `(0.63 vs 0.58)` — since every one of them is below one and
the digit is two columns per number that say nothing, in lines already clipped at
the column edge. ⚠ Quantities keep theirs: `+0.70` kg and `+1.01` kg have to line
up against each other, and the `0` is what says which side of one it is on.

**The event feed.** One checkbox per event type, in a `<details>` that starts
closed on every load (the list is as long as the protocol's event vocabulary —
32 boxes, including a catch-all for types this build cannot name). Births and
deaths are on by default; `all` / `none` / `births & deaths` set the whole list,
and the choice is remembered in `localStorage`. Types that arrive many times a
tick say "frequent · kept briefly" beside the box, since those are the ones the
store drops within a few ticks.

**Every line is headed by one character, and no two event types share one.** The
mark is the only part of a log line that is scannable in a column of a hundred,
so it lives in `EventCatalog.js` beside the label and the retention tier rather
than inside the formatter — `*` a birth, `x` a death, `X` a kill, `%` a carcass
decaying, `>` a hunt, `!` an injury, `?` a courtship, `~` the weather turning,
`.` the movement chatter, `` ` `` anything this build cannot name. It used to be
whatever the formatter felt like: `!!` and `++` and `::` were two columns wide,
and `+` meant *both* a birth and an injury healing while `!` meant both a wound
and an alarm call. `renderer-view.test.js` enforces one character and no
duplicates, so a new event type cannot quietly reuse a mark.

**Layout.** Four columns: the event log on the left, the grid in the middle,
population next, and the controls, inspector, and legend in the sidebar on the
right. Population has a column of its own because a panel of per-species
histograms and a panel of controls were competing for one narrow strip, and the
one you were reading kept being the one scrolled out of sight.

Every panel minimizes — click its header (the Legend is a `<details>`, the rest
toggle a `collapsed` class via `collapsible.js`); the collapsed set is remembered
in `localStorage`.

**Every column can be widened** by dragging the edge facing the grid, or by
focusing that edge and pressing the arrow keys (Shift for a bigger step, Home to
reset; a double-click resets it too). ⚠ **The default width is also the
minimum** — each column is sized to the narrowest thing it has to show without
wrapping — so a drag only ever makes a column wider, and the grid gives up the
room. Widths are remembered in `localStorage` and re-clamped when the window
changes, since half a narrow window is not half a wide one.

## Run state is reported, not remembered

Whether the world is moving is the one thing a viewer cannot read off the
grid — a paused simulation and a quiet one look identical — so the status bar
states it: `RUNNING 4x` or `PAUSED`, with the play/pause button and speed select
showing the same thing.

All of it comes from the **host**. `/api/status` is polled on the metrics timer
and every command result carries the new `paused` / `speed`, so the poll is the
source of truth and the results are only what stop it lagging behind your own
click. Until the first reply lands the panel shows `…` rather than assuming a
default. This replaced a locally-remembered flag that was fetched once at
startup and updated only by commands _this_ client sent — which meant anything
else pausing the simulation left the renderer confidently wrong.

**The result of the last command is in the status bar**, at the right-hand end,
beside the run state it usually explains — a validation refusal, an `ok` with the
tick it landed on, a desync warning, or what an auto-pause stopped for. ⚠ It is
**cleared the moment another command is sent**, so a line here is always about
the command you just gave: a red "step failed" still on screen three commands
later reads as the state right now rather than as history. It used to sit at the
foot of the controls panel, where it was invisible exactly when that panel was
folded up.

**Stepping pauses first.** `simulation.step` is refused outright while the
runner's timer is going, so the step controls send `simulation.pause`, await it,
and then step — two existing commands in sequence, entirely renderer-side. A
step of N ticks arrives as **one** delta rather than N (see the host note in the
root `README.md`), so `Advance 500` is a single message.

**Speed is a ladder, nudged rather than picked.** `«` and `»` (or `[` and `]`)
step through 0.25x–32x, showing the current rate between them. A dropdown made
you look away from the grid to change speed, which is the one thing you are
trying not to do while watching something happen.

## Pause on…

Most of what makes this world interesting happens in one tick somewhere you were
not looking. The **Pause on** panel watches the event stream and stops the
simulation when something you ticked goes by — a kill, a birth, a fire starting,
an animal sickening — then reports what stopped it and jumps the camera there.

This is renderer _policy_ over authoritative output, not simulation logic: the
engine emits the events it always did, and the renderer replies with the
ordinary `simulation.pause` command. `Watchlist.js` holds the mapping and
`matchWatched` is pure, so the whole policy is testable without a DOM.

⚠ **It pauses just after the event, not at it.** The delta for that tick has
already been applied and the pause is a round trip on top, so at 1x you stop on
the next tick and at high speed you may overshoot several. Stopping exactly at
the event would mean a breakpoint inside the runner — more precise, and a
protocol change rather than a renderer feature.

Frequencies are not intuitive and the hints say so. Measured over ~480 demo
ticks: courtship fired 79 times and migration 44, against 4 kills, 1 birth, and
1 disturbance. "Pause on courtship" stops you every few ticks.

## Restarting the world

The **Restart** panel rebuilds the world from a seed (protocol v29). Name a seed
for a specific world, press **Random seed** to get any world, or **Replay this
one** to start the current seed over.

The panel also sets the **world size** (width × height), a **starting number for
each species**, and how prevalent **rocks** and **thickets** are. These describe
the world to build, so they apply to whichever restart button you press — the
seed only varies which world you get within those settings.

⚠ **The species fields are built from what the host says it has**, not from a
list compiled into the renderer. Until protocol v29 there were three fixed
fields — Herbivores, Predators, Scavengers — which was the UI claiming to know an
engine's roster, and which stops being *true* as soon as one species is both
predator and scavenger. The host now publishes its species on `/api/status` and
this panel grows a field per species from it, so a species added to the engine
appears here with no renderer change at all. A species the renderer has no glyph
for still gets a field, named from its id.

The number fields open on the demo's own founding counts, and their maxima are
deliberately high — up to a 1024×1024 world and tens of thousands of founders —
so you can push the sim to its performance ceiling; a world near both maxima runs
slowly but does not crash. **Rocks** and **thickets**
are dropdowns on a 0–10 prevalence scale, not counts: 0 puts none of that terrain
on the map, 10 crowds out open grazing ground, and the default of 2 reproduces
the demo's own terrain. Each field is validated against the same bounds the host
enforces, and an omitted field falls back to the host's default.

**The host picks the random seed, not the renderer.** Presentation has to be
reproducible from its inputs, and `Math.random` is banned in `app/` for the same
reason it is banned in the engine —
`test/renderer-boundaries.test.js` enforces it. So omitting the seed asks the
host for any world and the result reports which one it chose; that number lands
in the seed field, which is what makes "replay this one" simply naming the seed
you were already given.

A restart is the one change that cannot be a delta — the new world shares no
ids, no tick, and not even a `simulationId` — so the host broadcasts a full
snapshot and the store _replaces_ its state. The renderer drops its selection,
inspection detail, and follow target rather than leaving them pointing at
animals that no longer exist. The run state (paused, speed) belongs to the host
rather than the world and deliberately survives.

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

`InspectorPanel` owns _where_ the inspector is and `InspectorView` owns _what it
says_, and the two hosts render the same view object — docking is a change of
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

**In the event log an id wears its animal's own glyph** — `g412` in the gazelle's
yellow, `P97` in the leopard's bright red, italic where the animal is female —
rather than a `#`. A line then says *what* it is about before you read it, and
the thing you go looking for on the grid is the same mark in the same colour.
⚠ **The glyph is what the animal *was*, and stops following it.** A line about a
hunt is about the moment of the hunt: resolving it against the animal's current
state gave `> hunt p122 → %65 caught` — the prey was already a carcass in the
same delta that carried the event — and then `#65` once the body decayed out of
the world. The store keeps the last form every id was seen alive in, so the line
still names an animal however long ago it died. An id this client never saw alive
(one that died before it connected) keeps its `#`, which is the honest answer.
Hovering still underlines and turns cyan, whatever colour the reference is at
rest.

**Every id is a way into the grid.** Ids in the inspector and the event log
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

- the **structural** pass builds the markup, and runs only when the _shape_ of
  what is shown changes — a different cell, different occupants, a new
  inspection payload, or an optional row appearing or disappearing;
- the **patch** pass runs every tick and writes only the ~10 bulk-snapshot values
  into nodes cached at build time, marked in the HTML with `data-live="<key>"`.

`structureSignature` decides between them and is exported precisely because it
_is_ the mechanism — it is pure, so `renderer-view.test.js` covers it without a
DOM. `describeSections` is exported for the same reason. When in doubt the panel
rebuilds: a missed signature field costs one wasted rebuild, while a missed field
in `liveFields` would silently show a stale number.

Section _contents_ are reconciled rather than rebuilt: `#patchSections` replaces
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

**It opens expanded**, and no row carries an explanatory note: the legend is a
key, not a manual, and a key you have to go and find is a key nobody reads.

`describeLegend()` is pure and returns plain data; `renderer-view.test.js`
asserts that every species (in both its young and grown case), every terrain
type, feature, disturbance, memory kind, and carcass decay stage reaches it, and
that every colour token is a real Dracula value — and that every **status**
reaches it with the shape the grid draws, since a mark nobody can look up is a
mark nobody can read. The age/sex key (`young / grown` and the italic `female`
row) and the bracket overlays are the hand-written part, because they describe
how a glyph is _cased, styled, or bracketed_ rather than which glyph is drawn,
and have no registry to read from.

## Dracula palette

`app/styles/dracula.css` defines the exact Dracula Classic values as CSS
custom properties; `EntityAppearance.DRACULA_COLORS` mirrors them for
canvas/test use. Derived shades may only mix these values or apply opacity.
Semantics: green = plants/success, red = death/danger/failure, orange =
carcass/warnings/fixture, yellow = animals, bright-yellow = selection,
purple = unknown/headings, cyan = water (reserved)/follow marker, comment
blue = secondary text.

## Replacing the Canvas renderer

Drawing is isolated behind the grid-renderer contract — `resize(w, h, dpr)`,
`cssWidth`/`cssHeight`, and `draw({ store, camera, ... })` — plus the pure
projection/appearance modules. `RendererApp` takes a `createGridRenderer`
factory option (defaulting to `AsciiGridRenderer`), which is how sprite mode
swaps in `SpriteGridRenderer` from `main.js`; a future WebGL/DOM/terminal
renderer is one more factory. The store, transports, protocol, and simulation
are untouched — the engine never knows a renderer exists. A renderer with
async assets calls `app.requestRedraw()` when they arrive.

## Protocol layers, newest first

What the renderer does with each layer the protocol projects, and why. Open
gaps and deferrals live in [`DOCS-RENDERER.md`](DOCS-RENDERER.md) §1 rather than here.

- Territorial claims (protocol v37): the claim grid rides in full snapshots as
  RLE **owner ids** over the coarse claim cells, and in deltas as a sparse
  change list gated on an **ownership** revision — so an ordinary tick, where
  claims are merely refreshed and faded, carries nothing at all. The **territory
  layer** (see "Map layers") outlines the ground each pride, clan and lone holder
  marks. This closes the engine's A36 and this roadmap's P1, and it is the same
  argument v33 made one layer up: inspection answers "whose ground is this lion
  standing on", and "where is each pride's ground" is a different question that no
  number of one-animal queries assembles. ⚠ **Ownership only** — a claim's
  freshness is what the mechanism runs on, is the number that changes every tick,
  and is not a thing to draw. Measured over 1000 mature demo ticks: **445 bytes of
  a 320 KB full snapshot**, and **0.013% of delta bytes**, on the 377 ticks in
  1000 where anything changed hands.
- Sociality inspection (protocol v34): ⚠ **a layer the renderer speaks and does
  not yet show.** Everything v34 added is inspection-only — a group's derived
  `centre` and `leaderId`, the three steering commitments (`social.consensus`,
  `social.rally`, `social.charge`), and `social.nearby`'s `pullScale` and
  `bandmates` — so nothing arrives in a snapshot or a delta that the store has to
  handle, and the version constant plus a regenerated fixture set is the whole of
  what the bump asked of this side. Displaying any of it (a commitment arrow, a
  band centre, a leader mark) is an item for this roadmap, not something the engine
  plan left half-done.
- Persistent-group membership (protocol v33): `groupRecordId` rides in bulk
  snapshots, and the **social layer** (see "Map layers") outlines every pride,
  clan and band on the map beside every herd label. It had been inspection-only
  since v29 as a whole `group` block, and what changed is the question: a query
  about one animal answers "which pride is this lion in", and no number of those
  assembles "where is each pride". ⚠ Cheaper per delta than v32's `flying` — it
  moves only when an animal joins, leaves, or its record dissolves (~107 events
  per 6000-tick run) — and `null` on every entity in a world where nothing forms
  records.
- Flight (protocol v32): `flying` rides in bulk snapshots, and the grid marks it
  with a **cyan `»` rotated to point up** — the third status shape, which says
  *where* an animal is rather than what is wrong with it or what is happening to
  it. It was projected because being airborne is the *only* outward sign the
  mechanism has: flight makes an animal faster, wider-seeing and cheaper to run,
  and none of those is visible on a grid. ⚠ It changes far more often than
  `elevation` does — a wander commitment carries it 8–24 ticks — so unlike v31 it
  genuinely dirties deltas, which is why the engine measures ground↔air
  transitions per 1000 ticks.
- Elevation (protocol v31): `elevation` (0 ground, 1 canopy) rides in bulk
  snapshots on animals **and carcasses**, drawn as a bright-green diamond — a
  leopard resting above the hyenas, and a kill it has hauled up out of their
  reach. ⚠ It is the one status a **carcass** may carry, which is what
  `statusesOf`'s narrow `remains` flag exists for: a body's `healthFraction` is 0,
  so every other status would light up on a corpse.
- Reproductive state (protocol v30): `gestating` and `seekingMate` ride in bulk
  snapshots, and the grid marks both — a pink diamond for a female carrying, a
  bright-cyan one for an animal receptive and looking. They were added for
  exactly this: a rut and a calving season are inferable from a birth several
  hundred ticks later and *watchable* only if the state itself is projected.
  ⚠ Both are derived on read in the engine from fields the reproduction system
  already maintains (`gestationUntil`, `mateSearchSince`), so the projection
  stores nothing new. ⚠ `seekingMate` is the chooser's state and therefore
  female-side: the engine leaves the seeking sex ready year-round, so a male
  marker would be permanently lit and would say nothing.
- Species roster, founding by species, and the deferred projections (protocol
  v29): the host publishes `species: [{ id, defaultCount }]` on `/api/status` and
  the restart panel builds a field per species from it (see "Restarting the
  world"). Entity inspection gained a **`group`** block — the persistent-group
  record an animal belongs to, ⚠ *not* the herd label, which is the separate
  `social.groupId` and has always been there — and carcasses gained
  `possessorId`, the animal standing over the body. Three event types arrived
  with them: `entity.robbed` (a carcass taken off another carnivore),
  `entity.grouped`, and `entity.ungrouped`. ⚠ `entity.robbed` is deliberately not
  `entity.contested`, whose filter label is "contests over a mate" — the whole
  reason this version exists is that the UI must not lie.
- Worn ground (protocol v27): trails and burrows arrive as a revision-gated
  sparse list (`{ revision, cells: [{ cellX, cellY, kind, wear }] }`) on both
  snapshots and deltas, and are drawn from `FEATURE_APPEARANCE` (`.` trail
  orange, `O` burrow grey) _over_ terrain and _under_ everything that happens on
  it — worn ground is the most permanent thing on the map and the least urgent
  to see, and it fades to 20% under whatever is standing on it. The projection carries only cells deep enough to _be_ something, so
  the pass walks a short list rather than the grid and costs nothing on a world
  nobody has worn down. `environment.feature` is off by default in the event
  feed and kept only briefly, because ground genuinely turns over and the state
  already rides in every snapshot.
- Disturbances (protocol v26): fires, floods, and storms ride whole in both
  snapshots and deltas as a bounded list of circles, so the renderer walks the
  visible cells of each active region rather than the whole grid, and costs
  nothing when nothing is happening. `DISTURBANCE_APPEARANCE` draws `^` fire,
  `~` flood, `*` storm over the ground and _under_ the animals — a disturbance
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
  dispersing juvenile is called out separately, because that drive _overrides_
  the habitat reading rather than competing with it, and showing both without
  saying which is winning would mislead.
- Disease (protocol v24). `diseaseState` rides in bulk snapshots so an outbreak
  is watchable, and a **symptomatic** animal carries a purple status dot. (It
  used to *tint the glyph*, which spent the channel that says which species the
  animal is, and could not be shown at the same time as the hurt tint — see
  "Status marks" above.) An **incubating** animal is deliberately unmarked even
  though the protocol sends its state: the whole model rests on a carrier being
  invisible, and marking one would hand the viewer information no animal in the
  world has. The inspector panel spells out `infectious` separately from
  `symptomatic` for the same reason.

## Known limitations

- No interpolation: entities jump cell-to-cell each authoritative tick (by
  design for v1; `previousPosition` is already tracked for later).
- The whole world state is streamed; bounded subscriptions await
  region-scoped deltas in the protocol.
- **The cell description still says nothing about who owns the ground**, even
  though the claim layer is now projected (v37). The territory *layer* draws the
  boundaries; naming the holder in the inspector when you click a cell is a
  separate, small piece of work that has not been done.
- **A hyena clan outlines no territory**, because the hyena is not a territorial
  species in this engine (`territory.defends: false`, deliberately). The layer
  names and colours clans already; what is missing is engine data, not renderer
  code.
- A long manual step loses domain **events**, though never world state: the
  engine's outbox is bounded, so a 500-tick step emits ~77 000 events and the
  delta carries ~8 800. The jump is exact; the narration of how it happened is
  what a long advance gives up.
- A large advance blocks the host while it runs (~1.4 ms/tick at demo scale), so
  the controls stay well under a second by default. A genuinely long run belongs
  in `npm run headless`.
- There is no way to step **backward** — the engine only moves forward.
  [`DOCS-RENDERER.md`](DOCS-RENDERER.md) §1.2 weighs the options.
- Fixture mode has no inspection or metrics data at all (`http` is null there),
  so those panels are empty offline. [`DOCS-RENDERER.md`](DOCS-RENDERER.md) §1.4 (P6/E3).
- Fixture playback covers one delta (ticks 2400 → 2401); use Replay to loop.
- **At the 10px zoom floor the social layer's two rings fuse into one line.** The
  gap between them is a proportion of the cell, and at the floor that is a pixel
  and a half — so an animal in a band inside a herd reads as one outline in the
  band's colour rather than two. Legible as a group boundary, not as two of them;
  a zoom level up separates them. The same trade the `»` chevron makes at the same
  floor, for the same reason.
- The **flying** mark blinks, and that is the world rather than the renderer: an
  animal alternates between travelling (airborne) and contact (grounded) actions,
  measured at ~52 ground↔air transitions per 1000 vulture animal-ticks, so the
  mark honestly follows. [`DOCS-RENDERER.md`](DOCS-RENDERER.md) §1.3 (P17).

## Protocol layers, older

The rest of the layers, newest first. These are descriptions of what the
renderer does with each, not limitations — they sat under "Known limitations"
for several steps, which is how the section came to mix the two.

- Terrain is authoritative (protocol v2): full snapshots embed a terrain
  block (`{ width, height, cellTypes, encoding: 'rle-row-major', runs }`),
  also available at `GET /api/terrain`. The store decodes the RLE into a
  row-major cell lookup (`terrainNameAt`); the grid renderer maps each cell's
  legend name → glyph/color via `TERRAIN_APPEARANCE`
  (ground `.`, water `~`, deep water `≈`, rock `#`, cover `,`, thicket `♣`). Codes and passability are
  authoritative; glyphs/colors remain renderer-owned. Deltas never carry
  terrain (it is static).
- Vegetation is authoritative cell biomass (protocol v3): full snapshots
  embed a `vegetation` block (`{ width, height, maxLevel, revision,
encoding: 'rle-row-major', runs }`) of quantized biomass levels; deltas
  carry sparse `vegetation: { revision, changes: [[cellIndex, level]] }`. The
  store decodes to a row-major `Uint8Array` (`vegetationLevelAt`) and patches
  it in place from deltas. The grid renderer draws a green density ramp over
  the ground for levels 1+ via `VEGETATION_APPEARANCE`
  (`.` → `:` → `"` → bright `"`); level 0 shows the terrain beneath. ⚠ **A cell
  with something standing in it does not draw its covered layers at all** —
  forage, water, thicket, trails, and burrows. Both glyphs land in the same cell
  and the occupant's is the informative one, so a `"` behind a `g` reads as a
  two-character smear at any opacity that leaves it visible. (It was 20% first;
  the ground under an animal is one click away in the inspector, which reports
  the cell rather than the animal.) A carcass covers them exactly as an animal
  does: a body in the grass hides that cell's forage just the same. What is
  *not* covered is the hard shape of the map — ground, rock, cover — and
  disturbances, because an animal caught in a fire is the whole point of
  watching it get caught. ⚠ **Thicket is covered**, and it is the layer this
  matters most for: animals are most often *inside* it, and a `♣` behind a `g`
  was the hardest collision on the map to read. The demo no longer has plant
  entities — vegetation is the cell layer. Tree `T` remains reserved for future
  individual plants.
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
  preference moves only the sex being chosen. Each species is a **collapsed
  `<details>`** whose summary is its grid glyph, its name, how many are alive,
  and the population sparkline — a full section apiece reads at three species and
  makes the sidebar unusable at ten. What you expand is remembered
  (`biome.metrics.openSpecies`). ⚠ **The population sparkline is on its own line
  under the name and sized to the column**: a chart is one character per sample,
  so a 120-sample history was 120 unbreakable columns and pushed the name and
  the living count off the edge of a 300px panel. The panel measures the column
  and resamples the history into it (bucket means, so the whole history's shape
  survives), re-measuring when the column is dragged; a history shorter than the
  column is drawn one-to-one and simply ends. ⚠ A trend's lowest sample draws as
  `▁`, never as a blank: the blank rung belongs to the trait histograms, where an
  empty bin is genuinely empty, and lending it to a sparkline drew a steady
  population as a line of nothing. A persistent group count (protocol v29) appears
  beside the herd row for any species that forms clans or prides, and nowhere at
  all for a world with none.
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
  groupmates in `comment` grey, _under_ the family and hunt marks because a
  groupmate is company rather than kin. There is no group roster in the
  protocol; the renderer scans the visible entities for a matching label, which
  is exactly what the engine does and for the same reason. The Herd inspector
  panel shows the label, how many groupmates are in range, this animal's
  _derived_ dominance (unitless — only comparisons mean anything), whether it is
  panicking and how many hops from the sighting, and who it is defending.
  `entity.alarmed` is off by default in the event feed and kept only briefly,
  since a herd in view of a predator produces one per member.
- Mate choice (protocol v21) is inspection-only apart from `sex`, which rides in
  every bulk snapshot. The inspector panel shows what the species reads in a
  mate, this individual's choosiness, the standard it is holding right now
  (which falls as it goes unmated), and the last animal it sized up — with the
  quality _and_ the threshold, since a rejection with no visible standard just
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
- Injuries (protocol v16) are inspection-only, but the _grid_ still shows
  condition: a living animal below `HURT_HEALTH_FRACTION` carries an orange
  status dot, from the `healthFraction` that has been in every bulk snapshot
  since Step 4 — no protocol widening needed. The inspector
  lists each wound with a severity bar and the derived impairment percentage,
  and the event log formats `entity.injured` / `entity.recovered`.
- ⚠ **A kill flashes its cell red for that tick** (see "Status marks"), which is
  the only sign a hunt landed that survives a moving grid.
- Hunts (protocol v15) are readable without any new bulk fields: `stalk`,
  `chase`, and `flee` ride the existing public `action`, so a pursuit is
  visible in the grid from the glyphs alone. The event log formats
  `entity.hunted` with the capture odds the engine actually used, plus
  `entity.killed` / `entity.escaped`. While a predator is selected, its quarry
  is bracketed in red from the inspection payload's `huntTargetId`. The leopard
  is `P`/bright-red at priority 60, above prey, so a predator standing on its kill
  still reads as the predator.
- Remembered places (protocol v14) arrive in the same inspection payload: at
  most eight per animal, strongest first, each with a kind, a cell, and a
  fading strength. The inspector lists them with a strength bar, and while an
  animal is selected the grid marks its remembered cells with renderer-owned
  glyphs from `MEMORY_APPEARANCE` (`"` food, `~` water, `x` barren, `!`
  danger), alpha-faded by strength so forgetting is visible. These marks are
  drawn _under_ the entity and selection layers: they are one animal's private
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
