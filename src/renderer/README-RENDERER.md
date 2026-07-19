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
    EntityInspector.js        occupants, protocol fields, action + utilities, perception, events
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

**To show a new protocol-visible field in the inspector**: once the
simulation protocol actually provides the field on snapshot entities or
`entity.inspection` responses, add one `<div class="field">` row in
`EntityInspector#render`. Do not invent fields the protocol doesn't send.

## Controls

| Input | Action (all renderer-local except commands) |
| --- | --- |
| Arrow keys / WASD | Pan camera (Shift = 10 cells) |
| `+` / `-`, mouse wheel | Zoom (wheel is anchored near the cursor) |
| Click | Select cell occupants (highest priority active) |
| Tab | Cycle occupants of the selected cell |
| F | Follow / unfollow the selected entity (camera-only) |
| C | Recenter camera |
| Esc | Clear selection |
| Space | Pause/resume via protocol command (live mode) |
| Buttons | Pause, Resume, Step, speed — protocol commands; Recenter, Reconnect/Replay |

Following moves the camera, never the entity. Camera movement sends nothing
to the simulation.

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

## Known limitations

- No interpolation: entities jump cell-to-cell each authoritative tick (by
  design for v1; `previousPosition` is already tracked for later).
- The whole world state is streamed; bounded subscriptions await
  region-scoped deltas in the protocol.
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
- Inspector's absolute energy is fetched once per selection (live mode) and
  labeled with its tick; the percentage updates live from deltas.
- Fixture playback covers one delta (ticks 10 → 11); use Replay to loop.
