# biome

A deterministic, headless, animal-centered ecosystem simulation engine, plus
a versioned protocol through which a browser ASCII renderer (and any other
client) observes and steers it. The engine is the product; Express is only a
host.

`PLAN.md` is the development roadmap: a linear, numbered sequence of steps
with completion notes, carried-forward issues (§1.4), and the execution
protocol for continuing the work. Steps 1–12 are done; Step 13 is next.

## Install and run

```bash
npm install
npm run dev        # Express + WebSocket host with auto-restart (nodemon)
```

| Command | Purpose |
| --- | --- |
| `npm start` | Run the server without nodemon |
| `npm run headless -- --ticks=5000 --seed=42` | Advance the simulation as fast as possible, no server |
| `npm run benchmark` | Deterministic performance baseline across entity counts (see `BENCHMARK.md`) |
| `npm test` / `npm run test:watch` | Run the `node:test` suite |
| `npm run fixtures:renderer` | Regenerate the committed renderer protocol fixtures |

Environment variables for the server: `PORT` (default 3000), `SIM_SEED`
(default 42), `SIM_TICK_MS` (default 1000).

HTTP API: `GET /api/status`, `GET /api/snapshot`
(`?minX=&minY=&maxX=&maxY=` for a region), `GET /api/terrain`,
`GET /api/entities/:id`, `POST /api/commands`. WebSocket at `/ws` (full
snapshot on connect, then per-tick deltas carrying domain events; commands
accepted).

Opening `http://localhost:3000` serves the **ASCII renderer** — a
Dracula-themed, Canvas-2D character grid client that consumes the protocol
over WebSocket/HTTP. `?mode=fixture` runs it offline against the committed
fixtures. The renderer is a fully separate subsystem (`src/renderer/app/`)
that imports nothing from the simulation, server, or protocol code; see
`src/renderer/README.md` for its controls, architecture, and appearance
configuration. The host serves it statically at `/renderer`.

## Architecture

```text
Browser ASCII Renderer               src/renderer/app (separate subsystem)
   │
   │ commands / snapshots / deltas / events / queries
   ▼
Versioned Simulation Protocol        src/protocol
   │
   ▼
Transport Adapter                    src/server/transports (HTTP, WebSocket)
   │
   ▼
SimulationRunner (wall-clock host)   src/server
   │ engine.step() ~1/sec
   ▼
Headless Simulation Engine           src/simulation
   │
   ├── Scheduler        (phase + priority ordered systems)
   ├── World State      (entities, terrain, vegetation)
   ├── Spatial Grid     (uniform grid for local queries)
   ├── Systems          (vegetation, perception, decision, movement,
   │                     feeding, reproduction, metabolism, hydration, aging)
   ├── Deterministic Randomness (seeded named streams)
   └── Persistence      (versioned save/load)
```

Dependency arrows only ever point downward-right in this table; nothing in a
lower layer knows about a higher one:

| Directory | Responsibility | May import |
| --- | --- | --- |
| `src/protocol/` | The versioned contract: commands, snapshots, deltas, event batches, queries, validation | nothing |
| `src/simulation/` | The deterministic domain engine | `src/protocol` |
| `src/server/` | Real-time hosting and transports | simulation, protocol |
| `src/fixtures/` | Deterministic world setup (demo) | simulation |
| `src/scripts/` | Headless entry points (headless run, benchmark, fixture generation) | fixtures, protocol, simulation |
| `src/renderer/` | Browser ASCII renderer + committed protocol fixtures | nothing (speaks the protocol as messages only) |
| `test/` | `node:test` suites | everything |

## Engine lifecycle and tick model

The engine holds **no timers**. It advances only when someone calls
`engine.step()` / `engine.step(n)` — the `SimulationRunner` does so about
once per second in the server, while tests and `npm run headless` step as
fast as the CPU allows. One step is one authoritative tick:

1. The clock advances to tick `T`.
2. Queued commands (spawn/remove) are applied and flushed, in submission
   order — they are part of the deterministic input.
3. Phases run in fixed order:
   `environment → perception → decision → movement → interaction →
   physiology → lifecycle → cleanup → observation`.
   Within a phase, systems run by ascending `priority`, tie-broken by `id`.
   A system with `updateInterval: N` runs only when `T % N === 0` — this is
   how expensive systems stagger their cost (vegetation regrowth runs every
   5 ticks; perception and aging support it too).
4. Deferred entity spawns/removals flush after `cleanup`, so `observation`
   systems always see the settled state of the tick.

The runner's pause/resume/speed only change *when* ticks happen, never what
a tick computes. Renderer interpolation between ticks is a client concern.

### Time and units

One authoritative tick represents **~1 in-world minute** (so a day is ~1440
ticks); the real-time runner ticks once per second at speed 1. These four
clocks are deliberately distinct and must never be conflated: one simulation
tick, one real-world second, one rendered frame, one in-world minute. The
convention lives in `config.time` (`tickMinutes`, `runnerTickMs`) as
documentation only — it never affects tick math. World coordinates are
continuous units where 1 unit = 1 grid cell; the full unit model (mass,
energy, hydration, temperature, …) is defined in `PLAN.md §3`.

Run `npm run benchmark` for the current performance baseline; see
`BENCHMARK.md`.

## Determinism rules

- Identical config + seed + ordered commands + tick count ⇒ identical state.
- `Math.random()` is banned in `src/simulation` and `src/protocol` (a test
  greps for it). All randomness comes from `SeededRandom` streams obtained
  via `context.random(streamName)` — named streams are derived from the root
  seed, so one system drawing more values never shifts another system's
  sequence.
- Iteration order is deterministic everywhere: entities iterate in creation
  order, spatial queries return ids sorted ascending, scheduler order is
  explicit.
- Wall-clock time, `Date.now()`, and timers must never influence simulation
  state.

## State ownership

- The engine owns all authoritative state. External consumers change it only
  through commands and observe it only through snapshots, deltas, and domain
  events.
- Systems may mutate fields of existing entities but must not structurally
  create/remove entities mid-iteration; they call `context.queueSpawn()` /
  `context.queueRemove()`, and the engine flushes at safe boundaries
  (`EntityManager` defers, `SimulationEngine.applyDeferredEntityChanges`
  flushes, keeping the spatial grid and `entity.created`/`entity.removed`
  events in sync).
- Position changes go through `world.moveEntity()` so the spatial index can
  never drift from entity state.
- The event bus is an outbox for observers, not an internal dispatch bus —
  systems call each other directly in hot paths. Event retention is bounded
  (`config.events.maxBufferedEvents`); consumers that fall behind
  resynchronize from a full snapshot.

## Protocol overview

Everything a client sees carries `protocolVersion` (currently `11`) and is
built by `src/protocol/`:

- **Commands** (`commands.js`, `validation.js`): `simulation.pause`,
  `simulation.resume`, `simulation.setSpeed`, `simulation.step` (host-level,
  applied by the runner) and `entity.spawn`, `entity.remove` (engine-level,
  queued and applied at the next tick boundary). Results are structured
  `{ ok, ... }` or `{ ok: false, error: { code, message } }`.
- **Snapshots** (`snapshots.js`): full snapshots expose only
  `PUBLIC_ENTITY_FIELDS` (id, kind, speciesId, x, y, heading, age,
  energyFraction, hydrationFraction, bodyMass, healthFraction, lifeStage,
  action, alive) — internal records never leak, and every snapshot is freshly
  cloned. Absolute energy/hydration/health and speed, the action target, the
  utility breakdown, and the perception summary are inspection-only
  (`GET /api/entities/:id`). Full snapshots also embed a static **terrain** block
  (`{ width, height, cellTypes, encoding: 'rle-row-major', runs }`) —
  renderer-neutral cell codes + a legend with authoritative passability, RLE
  encoded. Full snapshots also embed a **vegetation** block (quantized biomass
  levels `0..maxLevel`, RLE, with a `revision`). Region-bounded snapshots
  supported.
- **Deltas**: `created` / `updated` (complete public entities) / `removed`
  (ids) plus the domain events of the window; `applyDeltaSnapshot` is the
  reference application algorithm. Deltas never carry terrain (it is static);
  they carry vegetation as a sparse `{ revision, changes: [[cellIndex,
  level]] }` list, gated by the revision so unchanged ticks cost nothing.
- **Events** (`events.js`): `entity.created`, `entity.moved`,
  `entity.died` (with a `cause`: `starvation`, `dehydration`, `age`),
  `entity.removed`, `entity.fed` (`{ entityId, cell, amount }`),
  `entity.mated` (`{ entityId, partnerId }`), `entity.born`
  (`{ entityId, parents }`) — facts with `{ seq, tick }`,
  never presentation instructions. A dead animal (whatever the cause) becomes
  a `carcass`-kind entity **in place** — a kind change carried as a delta
  update, not a removal. Nothing is ever removed from the world yet, which is
  why parent/lineage ids stay valid (see `PLAN.md` §1.4 C2).
- **Queries** (`queries.js`): status reports, entity inspection (includes a
  transient **perception** summary — nearest food/water/obstacle + nearby
  animals, inspection-only to bound size), terrain (`GET /api/terrain`),
  bounds parsing.

## Persistence

`captureSimulationState(engine)` produces a versioned, JSON-safe save
(`SAVE_FORMAT_VERSION`, currently `10`) with tick, random stream states,
config, all entity state (including deferred queues), vegetation biomass, the
event outbox, pending commands, and system descriptors.
`createEngineFromSave(saved, { registerSystems })` restores it; a restored
simulation continues **identically** to an uninterrupted one (tested).

Derived state is *not* saved and is rebuilt on load: the spatial grid, the
terrain layer (regenerated from the seed + `config.terrain`), and per-entity
perception summaries. Restoring verifies the save format version and that the
same systems are registered, so a changed system lineup can't silently load an
old save. The version history — and which step invalidated which format — is
documented in `SimulationSerializer.js`.

## Adding a simulation system

1. Create a class extending `SimulationSystem` (or a plain object) in
   `src/simulation/systems/` with `{ id, phase, priority, updateInterval }`
   and `update(world, context)`.
2. Use only `context.random('your-stream')` for randomness,
   `context.queueSpawn/queueRemove` for structural changes,
   `world.moveEntity` for movement, and `context.emit(type, payload)` for
   observable facts (add new event types to `src/protocol/events.js`).
3. Register it in the fixture/composition root
   (`registerDemoSystems` today). Saves record system descriptors, so a
   changed system lineup won't silently restore old saves.
4. Test determinism: two runs with the same seed must match.

## Building a renderer

See `src/renderer/README.md`. Short version: depend only on the protocol
and a transport, treat snapshots as authoritative, map entity data to glyphs
yourself, interpolate between authoritative ticks at your own frame rate,
and develop offline against the committed fixtures in
`src/renderer/fixtures/`.

## What exists today

**Substrate:** deterministic engine, clock, phased scheduler, entity manager
with stable ids and deferred mutation, spatial grid, seeded random streams,
bounded domain events, command queue, snapshots/deltas/queries, versioned
save/load, HTTP + WebSocket host, headless runner, benchmark, the browser
ASCII renderer, committed fixtures, and 193 tests.

**World:** seeded terrain (ground / water / impassable rock / cover, with
per-type traversal costs) and a cell-level vegetation biomass field that grows
logistically toward a terrain-derived capacity.

**The herbivore.** Animals are one configured species (`config/species/*` —
biology only, never glyphs or colors; looked up by id, never branched on by
name). Their full loop is implemented:

| System | Phase | What it does |
| --- | --- | --- |
| `VegetationSystem` | environment | Logistic regrowth toward per-cell capacity (staggered) |
| `PerceptionSystem` | perception | Bounded local sense of nearest food/water/obstacle + nearby animals, via the spatial grid — never global reads |
| `DecisionSystem` | decision | Scores `eat` / `seekFood` / `drink` / `seekWater` / `seekMate` / `rest` / `wander` from hunger, thirst, readiness, and perception; sets the movement intent |
| `MovementSystem` | movement | Executes the intent: terrain-aware stepping, slowed by cover/water, refuses impassable cells |
| `FeedingSystem` | interaction | Removes biomass from the cell and assimilates it to energy; deterministic contention among co-located eaters |
| `ReproductionSystem` | interaction | Pairs well-fed adults in range, gestates, births a juvenile carrying both parent ids |
| `MetabolismSystem` | physiology | Mass-scaled basal + movement energy cost; starvation → carcass |
| `HydrationSystem` | physiology | Dehydration, drinking at water, health damage → carcass |
| `AgingSystem` | lifecycle | Growth along a stage curve (juvenile → subadult → adult → senescent) and death of old age |

The result is a **multi-generational, self-sustaining population**: animals
graze and drink, spend energy, grow, mature, reproduce, age, and die, and the
demo holds a roughly steady population with births balancing age deaths.
Nothing enforces that balance — it emerges from reproductive cost, lifespan,
and food availability. The demo lifespan is deliberately compressed so growth,
stage transitions, and age death are observable in a short run.

## Not built yet

Parenting and juvenile dependency, individual variation, memory/learning,
predators and escape, injury and healing, carcass decay and scavenging,
weather and seasons, genetics and inheritance, evolutionary metrics, mate
choice, social groups, territory, disease, migration, disturbances, ecosystem
engineering, multiple species, and profile-driven optimization toward tens of
thousands of animals.

`PLAN.md` sequences all of these as Steps 13–30, and §1.4 records the
deviations and open issues carried forward from the completed steps.

## Architectural invariants (do not violate)

1. The engine runs without a renderer.
2. The engine owns authoritative state.
3. The engine never references presentation concepts (glyphs, colors,
   cameras, animation, DOM, canvas).
4. The renderer never directly mutates simulation state.
5. External changes enter only through commands.
6. Observable outcomes leave only through snapshots, deltas, queries, and
   domain events.
7. Rendering frequency is independent of the simulation tick frequency.
8. Camera/viewport position never affects simulation fidelity.
9. All randomness is seeded and reproducible; `Math.random()` is banned in
   the domain.
10. System execution order is explicit and deterministic.
11. Internal data layout never leaks through the public protocol.
12. Expensive systems must support staggered update intervals
    (`updateInterval`).

Several of these are enforced mechanically:

- `test/engine.test.js` — source scan of `src/simulation` and `src/protocol`
  for forbidden imports/APIs (Express, `ws`, DOM, `Math.random`).
- `test/renderer-boundaries.test.js` — the renderer imports nothing from the
  simulation, server, or protocol, and no relative import escapes
  `src/renderer/app/`; the simulation stores no glyphs or colors.
- `test/protocol.test.js` — snapshots hold no references to internal mutable
  engine state and expose only whitelisted fields.
- `test/determinism.test.js` — two seeded runs are byte-identical.
