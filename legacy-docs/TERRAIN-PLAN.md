# Plan — water features: small lakes, a stream, and a marsh

**Status: written and implemented 2026-08-08.** Three additions to the terrain
generator, in the order they build on each other:

1. **Small lakes** — a configurable number of ponds beside the main lake, fully
   shallow, default **1**.
2. **A stream** — a meandering shallow channel that runs across the map, edge to
   edge, cutting through whatever it meets.
3. **A marsh** — a wetland covering a user-set **percentage of the map**:
   shallow water interspersed with trees, thickets and tall grass.

Written against [`DOCS.md`](DOCS.md) §7 Terrain (the generator and its ordering
rules), §4 (determinism and fixed draw budgets), §11 (the protocol's world
composition fields), §12 (change discipline), and §14 (what a test may boot).

⚠ This plan deliberately adds **no new terrain code**. Everything below is
composed from the seven that exist. §2 says why.

---

## 1. What is already true, and therefore constrains all three

Four properties of the generator are load-bearing here, and all three features
are shaped by them rather than by preference:

- **The passes are ordered so that a later pass cannot move an earlier one.**
  Lakes → rock → cover → thicket → trees → connectivity. Every pass added since
  the original three has gone in *late* for exactly this reason: the draws it
  spends can never shift the map that already exists.
- **A disabled feature must spend no draws at all.** `#scatterTrees` returns
  before its first draw at zero counts, which is what made trees provably inert
  when they shipped. Every new pass here does the same, and each one's off state
  is stated in its section.
- **Out-of-bounds and the rounded exterior are already handled by one guard.**
  `#stampDisc` refuses to write past the coast, so a lake near the rim is clipped
  by the coastline rather than punched through it. Every new pass writes through
  the same guard and inherits that.
- **Connectivity is guaranteed after the fact, over impassable cells only.**
  Shallow water, thicket and tree are all passable, so nothing added here can
  strand ground. Only `DEEP_WATER` could, and nothing added here places it.

---

## 2. ⚠⚠ No `MARSH` terrain code — the one decision the rest depends on

A marsh looks like a new terrain code and must not be one.

| option | verdict |
| --- | --- |
| **compose from existing codes** (chosen) | A marsh is *already* expressible: shallow `WATER` for the pools, `THICKET` for the reed beds, `TREE` for the standing timber, `COVER` for tall grass. Every consumer — movement, perception, shelter, vegetation, the renderer, the protocol — reads it correctly on the day it ships, with **zero engine code** |
| a `MARSH` code | A protocol bump for the code itself, a branch in every table keyed by terrain (`SPEED_MODIFIER_BY_CODE`, `CONCEALMENT_BY_CODE`, `SHELTERING_BY_CODE`, `PASSABLE_BY_CODE`, vegetation suitability), a renderer glyph and colour, and — per §7's own warning — **one habitat weight per species per new code**, or the marsh silently shrinks every grazer's preferred range (**A79** is still open from the last time a code was added) |
| a second grid (`WetnessGrid`) | The standing rule from §9 Perception: **nothing in the cell scan may consult a second grid**. That measurement was +56% of a tick |

**Tall grass is `COVER`**, and that is not a compromise: cover is already "low
brush and tall grass", it already shelters from the weather, it already conceals
more than a tree, and `VegetationGrid` already gives it **1.35× the carrying
capacity of open ground** (`coverSuitability`). Tall grass that grows more grass
is what the marsh needs, and it exists.

**The cost of the choice, stated rather than discovered later:** a marsh is not
addressable. Nothing can ask "is this cell marsh?", no metric can report marsh
occupancy, and the region exists only as an arrangement of ordinary cells once
generation ends. If a later phase needs marsh *identity* — a disease vector, a
species that only breeds in wetland — that is when a code or a flag layer earns
its cost, and not before.

---

## 3. Phase W1 — small lakes

**One new pass**, `#carveSmallLakes`, placed **immediately after `#carveLakes`
and before rock**. Not at the end, and the reason is the layering rather than the
draws: rock is stamped over water today, so an outcrop can sit on a lake shore
and clip it. A pond placed after rock would sit *on top of* an outcrop and read
as water on a hilltop.

- `smallLakes` (count, default **1**), `smallLakeRadiusFraction` (default 0.045
  of the smaller map dimension, against the main lake's 0.14).
- **Fully shallow — no deep core.** `lakeDeepFraction` is not applied. A pond
  with an impassable middle is a ring three cells wide, and the deep core exists
  to make a *large* lake something an animal walks around rather than through.
- **Draw budget: 3 per pond** — x, y, and a radius jitter — matching
  `#carveLakes` exactly.
- **Off state:** `smallLakes: 0` returns before the first draw, so a world
  generates byte-for-byte what it did before this pass existed.

---

## 4. Phase W2 — the stream

**One new pass**, `#carveStreams`, placed **after trees and before
connectivity** — the latest possible point, so its draws shift nothing and it
erodes a finished map.

- A stream starts at a point on the map's perimeter chosen by one draw and runs
  to the **antipodal point**, so it crosses the whole world rather than clipping
  a corner. Each step stamps a shallow-water disc of radius `streamWidth`
  (default 1.1 → a channel ~3 cells across) and turns by a drawn angle of up to
  `streamMeander` radians off the bearing to its target, so the course wanders
  without ever losing the plot.
- ⚠ **It cuts through what it meets** — ground, cover, thicket, trees, and
  **rock**. A stream that stopped at the first outcrop would end in the middle of
  the map, which is the one thing a stream may not do. Cutting rock makes a
  gorge, and since shallow water is passable it can only ever *add* connectivity,
  never remove it.
- ⚠ **Two exceptions, both structural.** It never writes past the coast (the
  exterior guard, so a stream reaching the rim simply ends at the sea), and it
  never overwrites `DEEP_WATER` — a lake core is not a ford, and letting a
  channel fill it in would quietly delete the one impassable water feature in the
  world. Running *into* a lake is fine and looks right: the channel arrives at
  the shallows and stops.
- **Draw budget: 1 for the start point + 1 per step** (the meander). The step
  count is geometric, not drawn, and is capped so a pathological bearing cannot
  loop forever.
- **Off state:** `streams: 0` returns before the first draw.

---

## 5. Phase W3 — the marsh

**One new pass**, `#growMarsh`, placed **last of the placement passes**, after
the stream and before connectivity. It is the only pass whose size is expressed
as an **area target** rather than a count, because that is what was asked for: a
percentage of the map.

**Where it goes.** ⚠ A marsh anchored on dry ground is a swamp in a desert. The
anchor is drawn from the world's existing **shallow-water cells** — a lake shore
or a bank of the stream — collected in one no-draw scan. With no water anywhere
(a lakeless test world) it falls back to a drawn position, and **both draws are
spent either way** so the fallback cannot shift the stream.

**How big.** `marshFraction` × the *playable* cell count (the rounded shape's
interior, not the bounding box — a 5% marsh should mean 5% of the world an animal
can stand in). The footprint grows as a random walk of discs from the anchor,
marking a mask, until the mask covers the target or a step cap is hit.

**What it contains.** Every `GROUND` or `COVER` cell in the footprint gets **one
draw**, and that draw picks from four cumulative bands:

| band | default | code |
| --- | ---: | --- |
| standing water | 0.30 | `WATER` (shallow — drinkable, passable at 0.5) |
| tall grass | 0.34 | `COVER` |
| reed bed / scrub | 0.14 | `THICKET` |
| standing timber | 0.10 | `TREE`, planted through `#plantTree` so the **spacing rule holds inside the marsh** |
| open ground | 0.12 | left alone |

⚠ **It writes on `GROUND` and `COVER` only.** Rock outcrops, lakes, deep water,
and the thickets and trees already standing there survive inside the footprint —
which is what an island in a wetland is, and means the marsh can be laid over any
map without destroying its features.

- **Draw budget: 2 (anchor position) + 1 (anchor index) + 2 per walk step
  (radius, heading) + 1 per footprint cell.**
- **Off state:** `marshFraction: 0` returns before the first draw.

⚠ **Known ecological consequence, recorded and not tuned around:** a marsh is
mostly *drinkable water*, and hydration pressure is one of the things that moves
animals around this world. A 5% marsh is a large, permanently available water
source that is not the lake. This plan does not measure that — the request was
explicitly for the terrain, and §13's re-baselining rules mean an ecological
claim needs a ten-seed gate, which is a separate piece of work.

---

## 6. Phase W4 — making all three user-configurable

All three are settings a user picks when building a world, so they take the same
route the existing terrain controls take:

`Controls.js` (the panel) → `simulation.restart` command → `validation.js` →
`SimulationRunner` → `buildDemoConfig` → `config.terrain` → `TerrainGrid`.

Three new optional restart fields:

| field | range | default | kind |
| --- | --- | ---: | --- |
| `smallLakes` | 0..`MAX_SMALL_LAKES` (12) | 1 | a **count**, passed through verbatim |
| `streams` | 0..`MAX_STREAMS` (4) | 1 | a **count**, passed through verbatim |
| `marsh` | 0..`MAX_MARSH_PERCENT` (40) | 5 | a **percent**, divided by 100 host-side |

⚠ **Counts and a percent, not prevalence levels**, and that is a deliberate break
from `rocks`/`thickets`/`trees`. Those three are abstractions *over* a generator
quantity, so the protocol can stay in UI terms while the host retunes freely. "How
many ponds" and "how much of the map is marsh" are not abstractions over anything
— they are the settings themselves, which is exactly the argument `roundness`
already makes for passing a level through unmapped.

**This changes the command shape, so `PROTOCOL_VERSION` bumps 37 → 38**, the
renderer's `SUPPORTED_PROTOCOL_VERSION` moves with it in the same commit (D31),
and the renderer fixtures are regenerated. The preset store's `WORLD_FIELDS`
gains the three names; presets are additive, so a preset saved without them keeps
loading and the host's defaults fill in.

---

## 7. Test plan

**All of it is terrain generation — no simulation ticks at all**, so the whole
file costs milliseconds and none of the CLAUDE.md tick budget. One new file,
`test/wetlands.test.js`, hand-building `TerrainGrid`s directly.

1. **Three off states leave no trace.** Each feature at 0 against a world that
   disagrees about every one of its other parameters: identical run-length
   encodings. This is the strongest available form of "spends no draws".
2. **Small lakes** add shallow water and never a deep core.
3. **The stream** spans the map (its water reaches both halves), never breaches
   the exterior, never fills deep water, and leaves passable ground connected.
4. **The marsh** hits its area target within tolerance, contains all four of
   water/cover/thicket/tree, never overwrites rock or deep water, keeps trees
   spaced, and keeps passable ground connected.
5. **The protocol**: the three fields validate at their bounds, are refused
   outside them, and `buildDemoConfig` maps each to the right generator param
   (including the percent → fraction division).

---

## 8. Risks

- ⚠ **The water table.** Three features all add drinkable water; nothing here
  measures what that does to hydration-driven movement. Recorded in §5.
- ⚠ **The stream cuts rock.** It can open a corridor through an outcrop that the
  connectivity pass would otherwise have had to carve. This is harmless for the
  guarantee (it only ever adds connectivity) but it does mean rock formations are
  no longer the only thing that decides where the map is walkable.
- ⚠ **A marsh percentage is a percentage of the *playable* area**, and roundness
  changes what that is. A 5% marsh on a level-4 world is 5% of 0.785 of the
  bounding box. This is the right reading and it is easy to misread later.

---

## 9. As built — what this plan got wrong

All three phases shipped as designed. Four things the plan did not see, kept here
because each is the kind of mistake that recurs:

**1. ⚠⚠ The water features needed their own RNG stream, and the plan never
considered one.** §1 treated pass *ordering* as the whole of the interference
problem, which is true when a feature ships once and is never touched again — and
false for a knob a user turns. Ponds run early (for the layering reason in §3),
so on the single `terrain` stream "one more pond" regenerated every rock
formation, cover patch, stand and tree on the map. The fix is one line
(`random.deriveStream('water')`) and it is what DOCS §4's named streams have
always been for; the tell that it was needed was **a control panel**, not a
generator.

**2. ⚠⚠ Only the last pass can promise to change nothing else, and trees lost
that promise.** A separate stream buys independence of *draws*, not of *outcome*:
every pass writes the same grid, so a marsh consumes ground a tree would have
been planted on however independent its draws are. `test/trees.test.js` had
compared a wooded world to a treeless one cell by cell since T1 — a comparison
that only worked because trees were last — and it now holds the water off to keep
asserting the same thing. **The generalisation:** "placed last, so it disturbs
nothing" is not a property a pass keeps. It is a property of a *position*, and it
transfers to whatever is added after it.

**3. ⚠ The marsh's area target was wrong twice, in opposite ways.** The plan said
"`marshFraction` × the playable cell count", which is two mistakes in one line.
(a) The marsh anchors on a shore, so its basin overlaps the lake it grew from —
counting *every* footprint cell meant a 5% marsh spent a third of its area on
water that was already there. It counts **convertible** cells (ground and cover)
instead. (b) A quarter of this world is rock, so a tether basin sized to hold
`target` *cells* holds far fewer than `target` convertible ones, and a 30% marsh
came out at **21%**. The basin is now divided by the map's land share, and (c)
because a land-share estimate is still an estimate, the tether **grows** when the
walk stalls. ⚠⚠ The first version of (c) *exited* on a stall and made the
shortfall worse — **a stall usually means the walk is standing in ground it
already marked, not that the map is full**, and after each widening it takes many
small steps to reach open ground, every one of which reads as another stall. ⚠
All three were invisible at the 5% default and only showed up when the setting
was pushed — **a percentage is a claim, and a claim about a big number is easier
to check than one about a small one.**

**4. ⚠ Thicket now has two independent sources**, which the plan did not think to
mention and a test found immediately: the marsh's reed beds are thicket cells, so
`thickets: 0` no longer implies "no thicket on the map".
`test/runner.test.js`'s prevalence assertion had to say `marsh: 0` to keep
measuring the thicket generator rather than the sum of two generators. **Any
composed feature does this** — the marsh also became a second source of trees, of
cover and of shallow water, and each of those is a test somebody may yet write.
