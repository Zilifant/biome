# biome

A deterministic, headless, animal-centered ecosystem simulation engine, plus
a versioned protocol through which a browser ASCII renderer (and any other
client) observes and steers it. The engine is the product; Express is only a
host.

`PLAN.md` is the development roadmap: a linear, numbered sequence of steps
with completion notes, carried-forward issues (§1.4), and the execution
protocol for continuing the work. Steps 1–27 are done; Step 28 is next.
`HANDOFF.md` is the short version for picking the work back up.

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
`GET /api/entities/:id`, `GET /api/metrics`, `POST /api/commands`. WebSocket at `/ws` (full
snapshot on connect, then per-tick deltas carrying domain events; commands
accepted).

Opening `http://localhost:3000` serves the **ASCII renderer** — a
Dracula-themed, Canvas-2D character grid client that consumes the protocol
over WebSocket/HTTP. `?mode=fixture` runs it offline against the committed
fixtures. The renderer is a fully separate subsystem (`src/renderer/app/`)
that imports nothing from the simulation, server, or protocol code; see
`src/renderer/README-RENDERER.md` for its controls, architecture, and appearance
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
   ├── Systems          (weather, vegetation, perception, memory, social,
   │                     decision, movement, feeding, hunting, reproduction,
   │                     parenting, territory, migration, disturbance,
   │                     metabolism, hydration, injury, disease, carcass,
   │                     aging, metrics)
   ├── Environment      (season, weather, temperature — the one global state)
   ├── Genetics         (diploid genome → expressed traits, with tradeoffs)
   ├── Metrics          (derived population aggregates; writes no state)
   ├── Memory           (bounded, decaying places each animal has learned)
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

Everything a client sees carries `protocolVersion` (currently `26`) and is
built by `src/protocol/`:

- **Commands** (`commands.js`, `validation.js`): `simulation.pause`,
  `simulation.resume`, `simulation.setSpeed`, `simulation.step` (host-level,
  applied by the runner) and `entity.spawn`, `entity.remove` (engine-level,
  queued and applied at the next tick boundary). Results are structured
  `{ ok, ... }` or `{ ok: false, error: { code, message } }`.
- **Snapshots** (`snapshots.js`): full snapshots expose only
  `PUBLIC_ENTITY_FIELDS` (id, kind, speciesId, x, y, heading, age,
  energyFraction, hydrationFraction, bodyMass, healthFraction, lifeStage, sex,
  groupId, diseaseState, dispersing, action, alive, decayStage) — internal records never leak, and every snapshot
  is freshly cloned. Absolute energy/hydration/health and speed, the action target, the
  utility breakdown, the perception summary, the individual's `traits` and
  `adultMass`, its `genome` / `genotype` / parent traits, its bounded
  `memories`, its `injuries` and derived
  `impairment`, its `stamina` and hunt target, its carcass detail, its
  `mateChoice` block (what its species reads in a mate, its own choosiness, the
  standard it is currently holding, and the last animal it sized up), its
  `social` block (herd, *derived* dominance, alarm state, who it is defending),
  its `territory` block (home range, drift from it, ground held, whose claim it
  is standing on), its `disease` block (compartment, whether it is infectious —
  which is *not* the same as whether it looks ill — and how far through it is),
  its `migration` block (the drift it is currently being steered by, beside the
  live habitat reading that drift was computed from, so a bias is checkable
  rather than mysterious), and the family/life-history block (resolved `lineage`, parenting state, bounded
  `lifeEvents`) are inspection-only (`GET /api/entities/:id`). Full snapshots also embed a static **terrain** block
  (`{ width, height, cellTypes, encoding: 'rle-row-major', runs }`) —
  renderer-neutral cell codes + a legend with authoritative passability, RLE
  encoded. Full snapshots also embed a **vegetation** block (quantized biomass
  levels `0..maxLevel`, RLE, with a `revision`). Both full snapshots and deltas
  also carry the active **disturbances** — a bounded list of
  `{ id, kind, x, y, radius, startedTick, until }` circles, carried whole rather
  than diffed because there are never many; an **empty** list is the message
  that everything has stopped, not the absence of one. Region-bounded snapshots
  supported.
- **Deltas**: `created` / `updated` (complete public entities) / `removed`
  (ids) plus the domain events of the window; `applyDeltaSnapshot` is the
  reference application algorithm. Deltas never carry terrain (it is static);
  they carry vegetation as a sparse `{ revision, changes: [[cellIndex,
  level]] }` list, gated by the revision so unchanged ticks cost nothing.
- **Events** (`events.js`): `entity.created`, `entity.moved`,
  `entity.died` (with a `cause`: `starvation`, `dehydration`, `age`,
  `predation`, `injury`, `exposure`, `disease`, `disturbance`),
  `entity.removed`, `entity.fed` (`{ entityId, cell, amount }`),
  `entity.mated` (`{ entityId, partnerId, quality }`), `entity.courted`
  (`{ entityId, candidateId, quality, threshold, accepted }` — the standard is
  reported beside the score, so a rejection is checkable rather than arbitrary),
  `entity.born` (`{ entityId, parents, sex }`), `entity.alarmed`
  (`{ entityId, sourceId, hops, x, y }` — `hops` is how far the warning has
  travelled from whoever actually saw the predator, so a wave of panic is
  readable), `entity.contested` (`{ entityId, opponentId, winnerId, dominance,
  opponentDominance, escalated }` — both scores, because dominance decides it and
  there is no roll to report), `entity.disputed` (the same, over ground, plus how
  many cells actually changed hands — the part an observer could not otherwise
  see), `entity.defended`, `entity.hunted`
  (`{ entityId, targetId, chance, captured }` — the odds are reported, not
  hidden), `entity.killed`, `entity.escaped`, `entity.injured`
  (`{ entityId, injury, severity, sourceId }`), `entity.recovered`,
  `entity.decayed`, `environment.changed`
  (`{ season, weather, temperature, … }` — the one world-level event, emitted
  on a turn rather than every tick), `entity.provisioned`
  (`{ entityId, guardianId, amount }`), `entity.migrated`
  (`{ entityId, from, to, distance, reason }` — an animal has moved *house*: its
  home range has shifted a full range radius from where it last lived, which is a
  different claim from "it walked a long way", and `reason` says whether it was
  following forage or still walking out from where it was born), and
  `entity.lifeEvent`
  (`{ entityId, event, guardianId, x?, y? }` — `weaned` | `dispersed` |
  `orphaned`; a dispersal carries the natal centre it is leaving),
  `environment.disturbed` (`{ disturbanceId, kind, x, y, radius, until }`) and
  `environment.settled` (the same, plus `durationTicks` — how long it *actually*
  lasted, the one fact that is gone once the record is). Nothing is emitted per
  tick while a disturbance runs; the region rides in every snapshot instead, so
  a fire costs the event budget exactly two events for its whole life
  — facts with `{ seq, tick }`, never presentation instructions. A dead animal
  (whatever the cause) becomes a `carcass`-kind entity **in place** — a kind
  change carried as a delta update, not a removal. It is removed later, once
  eaten clean or fully decayed, which is why lineage references resolve through
  a bounded tombstone registry rather than being assumed valid (see "Death
  feeds the world" below).
- **Queries** (`queries.js`): status reports, entity inspection (includes a
  transient **perception** summary — nearest food/water/obstacle + nearby
  animals, inspection-only to bound size), terrain (`GET /api/terrain`),
  population **metrics** (`GET /api/metrics` — aggregates only, never
  per-organism histories), bounds parsing.

## Persistence

`captureSimulationState(engine)` produces a versioned, JSON-safe save
(`SAVE_FORMAT_VERSION`, currently `25`) with tick, random stream states,
config, all entity state (including deferred queues), vegetation biomass, the
season/weather record, the tombstone registry, the bounded metrics history, the
event outbox, pending commands, and system descriptors. The migration drift is
saved rather than rebuilt, unusually for derived state: habitat evaluation is
staggered, so a restore would otherwise run on a stale value until the next
evaluation and diverge from an uninterrupted run.
`createEngineFromSave(saved, { registerSystems })` restores it; a restored
simulation continues **identically** to an uninterrupted one (tested).

Derived state is *not* saved and is rebuilt on load: the spatial grid, the
terrain layer (regenerated from the seed + `config.terrain`), per-entity
perception summaries, and the metrics report (recomputed on the next metrics
tick — only its bounded history persists). Restoring verifies the save format version and that the
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

See `src/renderer/README-RENDERER.md`. Short version: depend only on the protocol
and a transport, treat snapshots as authoritative, map entity data to glyphs
yourself, interpolate between authoritative ticks at your own frame rate,
and develop offline against the committed fixtures in
`src/renderer/fixtures/`.

## What exists today

**Substrate:** deterministic engine, clock, phased scheduler, entity manager
with stable ids and deferred mutation, spatial grid, seeded random streams,
bounded domain events, command queue, snapshots/deltas/queries, versioned
save/load, HTTP + WebSocket host, headless runner, benchmark, the browser
ASCII renderer, committed fixtures, and 561 tests.

**World:** seeded terrain (ground / water / impassable rock / cover, with
per-type traversal costs), a cell-level vegetation biomass field that grows
logistically toward a terrain-derived capacity, and a turning year — season,
temperature, and weather spells that modulate both.

**Two species.** The world holds a **grazer** and the **stalker** that hunts
it. Both come from configured species definitions (`config/species/*` — biology
only, never glyphs or colors; looked up by id, never branched on by name), and
the predator/prey relation is itself data on the species (`preySpeciesIds`),
read in both directions — so no system anywhere branches on a species name.

No two animals are identical. Each carries trait multipliers fixed for life —
size, speed, metabolic efficiency, boldness, caution, exploration, reproductive
investment, and choosiness — and every one changes something real: a bold animal
covers more ground and burns more energy; a heavily investing parent raises
better-stocked young at a higher price per birth; a choosy one gets a better
mate but breeds later.

Those traits are **inherited**. Each animal carries a diploid genome
(`traits/genetics.js`) with one locus per trait; a founder's is sampled, but
everything born in-world takes one allele per locus from each parent and may
mutate. Expression is additive, so a child sits between its parents rather than
picking a side, and siblings differ because assortment is per locus. Crucially,
expression also charges **antagonistic traits against each other** — bigger
costs speed, faster costs efficiency, bolder costs caution — because without
that, selection would simply ratchet every trait toward its maximum forever.
The inspector shows genotype beside phenotype, and where they differ is exactly
where a tradeoff is being paid.

Their full loop is implemented:

| System | Phase | What it does |
| --- | --- | --- |
| `WeatherSystem` | environment | Turns the year: season and temperature from the tick, weather drawn in spells |
| `VegetationSystem` | environment | Logistic growth toward a *seasonally scaled* capacity, so the land browns off in winter and greens up in spring (staggered) |
| `PerceptionSystem` | perception | Bounded local sense of nearest food/water/obstacle, nearby animals, and its own parent, via the spatial grid — never global reads |
| `MemorySystem` | perception | Fades each remembered place on its own schedule and forgets it once too faint (staggered) |
| `HuntingSystem` | interaction | Resolves a capture attempt from the two animals' relative speed, stamina, and condition; a kill leaves a carcass, a miss costs energy and teaches the prey the place is dangerous |
| `DecisionSystem` | decision | Scores `flee` / `chase` / `stalk` / `eat` / `seekFood` / `drink` / `seekWater` / `recallFood` / `recallWater` / `followParent` / `seekMate` / `rest` / `wander` from hunger, thirst, readiness, dependency, perception, memory, temperament, and threat; sets the movement intent. `seekMate` steers toward the *best* candidate in sight, not the nearest |
| `MovementSystem` | movement | Executes the intent: terrain-aware stepping, slowed by cover/water and by injury, refuses impassable cells; sprints for chases and escapes, spending stamina |
| `FeedingSystem` | interaction | Converts what the species' diet allows into energy — grass from the cell for herbivores, edible mass from a carcass for carnivores — remembering where it ate (or found nothing) |
| `ReproductionSystem` | interaction | A receptive female sizes up the males in range and takes the best one that clears the standard she is holding; she gestates and births a juvenile carrying both parent ids |
| `ParentingSystem` | interaction | Provisions unweaned juveniles from the guardian's own energy, weans them, and breaks the bond at maturity or on the guardian's death |
| `MetabolismSystem` | physiology | Mass-scaled basal + movement + thermoregulation energy cost, divided by individual efficiency; recovers stamina when not sprinting; starvation or exposure → carcass |
| `HydrationSystem` | physiology | Dehydration, drinking at water (remembering where), health damage → carcass |
| `InjurySystem` | physiology | Closes wounds over time at an energy cost, restoring health; an animal too hungry to spare the energy does not heal. Health exhausted → carcass |
| `CarcassSystem` | physiology | Ages a body through decay stages, removes it once eaten clean or fully rotted, and returns what is left to the cell as biomass |
| `AgingSystem` | lifecycle | Growth along a stage curve (juvenile → subadult → adult → senescent) toward the individual's own adult size, and death of old age |
| `SocialSystem` | decision | Propagates herd labels between neighbours, summarizes each animal's local group, and carries alarm outward hop by hop |
| `TerritorySystem` | interaction | Accumulates each animal's home range in place, marks ground for the species that hold it, and settles disputes over ground by dominance |
| `MigrationSystem` | decision | Reads the forage gradient around each animal and keeps a drift heading current; sends juveniles walking out of the range they were born in. Writes no action — the decision system folds the drift into `wander` (staggered) |
| `DisturbanceSystem` | environment | Raises fires, floods, and storms as bounded regions on a clock, burns the forage inside one once, hurts whatever is standing in it, and drops the record when it ends. Every other effect is derived from that record on read |
| `DiseaseSystem` | physiology | Runs the compartments, spreads infection outward from the infectious, and slowly mends the condition of animals that are well |
| `MetricsSystem` | observation | Aggregates trait distributions, generations, reproductive success, and selection differentials (staggered; writes no organism state) |

The result is a **multi-generational, self-sustaining population** with a
complete life cycle: an animal is born, is fed by the parent that bore it, is
weaned, disperses at maturity, grazes and drinks, grows, breeds in its turn,
ages, and dies — and each of those milestones is readable in its own bounded
life history. The demo holds a roughly steady population with births
balancing age deaths. Nothing enforces that balance — it emerges from
reproductive cost, parental investment, lifespan, and food availability. The
demo lifespan is deliberately compressed so growth, stage transitions, and age
death are observable in a short run.

Juvenile dependency is real, not decorative: an unweaned juvenile does not
graze at all. It lives on energy transferred from its guardian (at a
transfer loss, and never below the guardian's own reserve floor), which is why
it follows the parent it can perceive. An orphan is weaned on the spot and
must fend for itself.

**A hunt is a pipeline, never one opaque roll.** A stalker detects prey
through the spatial grid, evaluates whether it is hungry and rested enough to
bother, closes at a walk (`stalk`) to save its sprint budget, commits to a
sprint (`chase`) once close — or the moment its quarry bolts, since a walking
predator can never catch a running grazer — and inside striking range makes one
attempt whose probability comes from the two animals' relative speed, remaining
stamina, and the prey's condition. A kill leaves a carcass the predator feeds
on; a miss costs it real energy and teaches the prey that this place is
dangerous. Prey drop everything and run the moment a predator comes into view.
Stamina is what actually decides most chases: both sides trade it for speed and
recover it only at rest.

The demo holds both species in a genuine oscillation rather than a fixed
balance — measured over 20k ticks on five seeds, roughly 24–111 grazers against
1–9 stalkers, with neither side wiped out. Nothing enforces that; it emerges
from encounter rates, capture odds, and lifespan, and it is a knife edge (see
`config.demo` for the measured sweep behind the founding counts).

**Disease travels ahead of its own symptoms.** An animal that has caught
something spreads it for a couple of hundred ticks while looking perfectly
healthy, and only then visibly sickens — slower, feeding badly, unable to breed,
and left out of its herd's centre of mass so the group drifts away from it. That
ordering is the whole model. If only visibly sick animals could transmit,
avoidance would be a complete defence and an outbreak would be a non-event; a
herd would shun the one obvious case and carry on. Because the carrier looks
fine, avoidance is always late, and the density that herding creates becomes a
real cost rather than a free benefit.

Recovery grants immunity, but immunity **wanes** — so a population that has been
through an epidemic slowly becomes susceptible again, and with a fresh case
arriving from outside now and then, disease is a standing pressure rather than a
single event in the demo's history. The compartment counts are the outbreak
curve, and they are in the metrics: watching *infectious* run well ahead of
*visibly sick* is watching the mechanism work. Transmission costs nothing
between outbreaks, because only infectious animals ever look around.

**Animals live somewhere, and some of them own it.** Every animal carries a
*home range* that is nothing more than a running average of where it has
actually been — a centre and a typical distance from it, four numbers updated in
place, with no record of the path that produced them. Nobody sets the radius: a
resident's tightens, a rover's widens, and an animal that moves house drags its
range along behind it.

A **territory** is a separate thing, and only some species have one. It is a
mark on the ground — a coarse layer holding who claims each patch and how fresh
the claim is — and everything else follows from that pair of numbers. Avoidance
is a lookup. Conflict is standing on somebody else's claim. Losing a territory
is a stronger claim overwriting a weaker one. And ground whose owner has died or
moved on needs no rule at all: the claim simply fades and the next animal
through writes its own. Taking *occupied* ground wears the resident's claim down
rather than overwriting it, which is what makes a boundary settle where two
animals' marking rates balance instead of wherever the last passer-by stood.
When an intruder meets an owner who is present to object, they contest — the
same dominance contest that settles a mating rivalry — and the loser hands over
everything it held at once.

Grazers have ranges; stalkers hold ground. That difference — living somewhere
versus owning it — is the distinction the whole mechanism turns on.

**And animals move house.** Migration here is deliberately **not something an
animal decides to do** — there is no `migrate` action, and nothing was added to
the utility table. An animal that can see food still goes to the food; one that
remembers food still walks back to it. What migration touches is the one heading
in the whole system that was going to be arbitrary anyway: when a wander
commitment runs out and the animal picks a fresh random direction, that direction
is bent toward better forage. Foraging therefore cannot lose to it, because it
never spends a tick that was doing anything else — the hard-won lesson of the
previous step, where a competing movement behaviour cost the demo two seeds in
five.

The cue is shallow and local — eight directions sampled, no search, no route, no
map. Distance comes from **commitment** instead: a heading is held for a dozen or
so ticks and re-chosen the same way while the gradient persists, so a weak
preference integrated over a long walk carries an animal a long way. That is how
an animal migrates without knowing where it is going.

Nothing in it is seasonal, and nothing in it knows what a season is. Season
arrives through the grass: a green spring flattens the gradient to nothing and
animals scatter, while a grazed-out winter sharpens it and they concentrate onto
the ground that still carries forage. **Recolonization is not implemented at
all** — nothing anywhere knows a region was emptied. Ground that nobody is eating
simply grows back to capacity and becomes the best thing on the compass, so
animals drift into it. The behaviour the step wanted is a consequence of the
mechanism rather than a feature beside it.

**Leaving home is the one thing that overrides all of that.** A juvenile that
outgrows its guardian takes an outward heading — straight out from the centre of
the range it grew up in, so it costs no randomness — and holds it for a bounded
spell whatever the forage says, because an animal that turned back at the first
green patch would never leave. Its home range is *cleared* at the same moment,
which is what makes dispersal spatial rather than bookkeeping: a range is a
running average of where an animal has been, so a juvenile that kept its natal
one would spend its life being drawn back to its mother's ground. In the demo,
young grazers end up a median of **70 units** from where they were born, on a map
128 across.

**Sometimes the land turns on them.** A fire, a flood, or a storm arrives as a
bounded region on a clock — a few numbers saying where it is, how wide, and when
it stops — and *everything it does is read off that record rather than written
into the world*. That is the whole design. A flooded cell is never marked
flooded; it is slow **while a flood covers it**, and the instant the record
expires it is ordinary ground again. There is no un-flooding pass to forget, and
no way to leave the world stuck half-changed. Terrain itself is never touched:
it regenerates from the seed on load, so an edit to it would quietly disappear
the first time anyone reloaded a save.

The one thing that really is destroyed is grass, because burnt grass should not
come back when the fire goes out — it should *grow back*, and the vegetation
already knows how. A fire takes the standing crop inside its circle once, and
recovery is simply logistic regrowth doing what it always does. Measured: a
radius-8 fire removes about four fifths of a region's forage, which is back to
99% of where it started within 300 ticks while unburnt ground a map away barely
moves.

And **no animal was taught to flee**. Nothing was added to the utility table at
all — that lesson has been learned twice now. A burnt region is simply ground
that stopped being worth anything, so the forage drift carries animals off it,
and a fire writes the same kind of `danger` memory a failed hunt does, which
animals already refuse to rest near. When the grass returns, the drift brings
them back. Displacement, avoidance, and recolonization are all behaviour that
already existed; this only gave it a reason. What being caught in one *does* add
is the first hazard in the world that can wound an animal — until now, only a
predator or a rival could.

It is deliberately a small pressure. A disturbance covers about one percent of
the map and something is running maybe a quarter of the time, so across ten
seeds it produces hundreds of burns and a handful of deaths without visibly
moving the population — local and sublethal, the same shape disease turned out
to have. An earlier version had something burning or flooding 91% of the time,
which was not a disturbance regime but a climate, and it had a subtler cost than
over-pressuring the demo: nothing ever finished recovering, so the recovery you
were supposed to be able to watch never happened.

**Animals form herds, and a herd is a label rather than a roster.** Nothing
anywhere holds a membership list: animals in sight of each other converge on a
shared group id by taking the smallest one they can see, so herds form, merge on
contact, and split apart again from one local neighbour query each — never a
per-pair structure. Two bounds keep it honest, and both were added after
watching the unbounded version misbehave. Every herd label carries its distance
in hops from the animal whose id it is, so a herd torn in half cannot keep
pretending to be one; and every **alarm** carries its distance in hops from
whoever actually saw the predator, so panic crosses a herd as a wave and then
stops instead of becoming a chain reaction that never runs out of fuel. An
animal that has been warned but has seen nothing itself still runs — away from
where it was *told* the danger was.

Herding is deliberately the weakest thing an animal can want. It loses to
hunger, thirst, weather and predators, which is what makes a herd loose and
living: animals graze their way out of it and drift back in. A bold animal is a
looser member, because the same trait that makes it roam makes it care less.

**Standing is derived, not stored.** There is no pecking order anywhere in
state — an animal's dominance is read off what it is right now: its mass, its
condition, its wounds, its temperament. So it falls when an animal is mauled and
returns when it heals, which is the point of not storing it. Where it bites is
**male–male competition**: rivals around the same female contest for access, and
the stronger simply wins — the event reports both scores rather than odds,
because there is no roll. What chance governs is whether the loser yields or
they fight, and that is likeliest between animals too evenly matched for either
to back down. A fight wounds both, the loser worse. Together with mate choice
this makes both halves of sexual selection real: **competition decides who she
is offered, and she still decides whether to take him.**

**A herd is also a defence.** Adult groupmates standing around an animal make it
measurably harder to catch — collective vigilance, with diminishing returns and
a cap, so a large herd is never untouchable. A parent that puts itself between a
predator and its own calf counts for more, and makes the attempt genuinely
dangerous for the hunter. Which calf is *its own* comes from the lineage lists
themselves; recognition here is ancestry, not a scent. Measured over five seeds,
sociality does not simply make prey safer — it makes the whole system steadier,
trading a much lower peak grazer population for never losing them.

**There are two sexes, and one of them chooses.** Females gestate; males clear a
much lower energy bar and a much shorter refractory period, because they pay for
one mating rather than a pregnancy. That asymmetry is the whole basis of mate
choice — without a difference in what a bad mate *costs*, neither party has a
reason to be choosy. It leaves the birth rate roughly where it was (the old
rule consumed both partners for a full cooldown to make one pregnancy; this one
consumes only the female), while making a female need a *male* in range rather
than merely another adult.

What she reads is a species fact — grazers display **size**, stalkers display
**speed** — half signal and half plain condition, since an animal cannot fake
being well fed. How hard she weighs it is her own heritable **choosiness**, so
the strength of sexual selection evolves rather than being a constant. And it
costs: her standard starts high and falls to nothing as she goes unmated, so
holding out for better spends breeding time she cannot get back, and nobody
holds out forever. Watch one long enough and you can see the whole thing — a
female turning down four males in turn and then settling for the fourth once her
standard has dropped below him. Because grazers are selected for size while size
also costs speed and burns energy, sexual and natural selection genuinely pull
against each other here.

**Selection is measured, not asserted.** A `MetricsSystem` runs in the
`observation` phase and aggregates the population into trait distributions
(with histograms), generation depth, reproductive success, birth and death
rates by cause, and a **selection differential** per trait — the mean among
adults that actually bred, minus the mean among all adults, reported both
overall and **per sex**. That split is what separates the two kinds of
selection: a mate preference moves only the sex being chosen, while natural
selection moves both together. In the demo it reads exactly that way — the
differential on size runs positive among male grazers and flat among females.
It writes no
organism state whatsoever; a test runs the demo with and without it and asserts
the populations are byte-identical, because a metrics layer that nudged
anything would be measuring itself. Rates are derived from state (ages and
death ticks) rather than from the event bus, so they cannot double-count on
replay or drift when events are trimmed. Available at `GET /api/metrics` —
a query rather than per-tick state, since histograms for every trait of every
species would dwarf the entity array.

**The year turns.** Season and baseline temperature are pure functions of the
tick — no stored history, so they reproduce exactly across a save or a fresh
run — while the weather is a stochastic spell that holds for a while and then
re-rolls with season-dependent odds: snow only in winter, drought only in
summer, rain mostly at the shoulders. Both feed one small record that
everything downstream reads. Crucially, the season scales what the land can
*hold*, not just how fast it grows: scaling the growth rate alone leaves a
field already at capacity stubbornly green, so winter shrinks the ceiling and
biomass dies back toward it. Animals pay energy to hold their body temperature
outside their species' comfort band, cover takes roughly half the edge off
(which is why they walk to it), and an animal that burns out fighting the cold
dies of `exposure` rather than `starvation` — the same mechanism, an accurate
label.

**Death feeds the world.** A body is a resource on a clock: it passes through
decay stages, its flesh is worth progressively less at each one, and it leaves
the world when it is either eaten clean or fully rotted — returning whatever is
left to the cell as biomass, so the animal that grazed there ends up feeding
the grass. Carcasses are the first things ever *removed* from the world, which
means a parent or offspring reference can now point at something that is gone.
Rather than let those silently dangle, the world keeps a bounded record of the
recently dead: a lineage reference resolves to `alive`, `carcass`, `dead` (gone,
but we remember who it was and what killed it), or `forgotten` (evicted from
that record). `forgotten` is a stated limit, not a failed lookup.

**Surviving is not the same as being unhurt.** A prey animal that escapes a
lunge usually carries something away from it, and a big enough grazer can hurt
its attacker on the way out. A wound scales an animal's speed and its feeding
rate by how bad it is, and — because the hunting system reads condition — makes
it easier to catch next time. Wounds close slowly and are paid for in energy,
so an animal too hungry to spare it does not heal at all: being injured and
being starved compound each other. Enough damage kills, through the same
health-exhaustion path as thirst.

Animals also **learn where things are**. Each one keeps at most eight
remembered places — where it ate, where it drank, where it searched and found
nothing — and each fades on its own schedule, water slowest (a lake does not
move) and "nothing here" fastest (grass grows back). When nothing edible or
drinkable is in sight, an animal walks back to somewhere it remembers instead
of wandering blindly; memory is deliberately weighted below the senses, since
a remembered patch may already have been grazed out. Finding a remembered
patch bare replaces the memory with a "nothing here" mark, so an animal's map
corrects itself. A failed hunt writes a `danger` memory at the attack site,
and animals both avoid recalling places near one and refuse to rest there.

## Not built yet

Ecosystem engineering, a config-driven species schema (beyond today's two
hand-written species), and profile-driven optimization toward tens of thousands
of animals.

`PLAN.md` sequences all of these as Steps 28–30, and §1.4 records the
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
