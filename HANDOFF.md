# Handoff — 2026-07-23 session

This supersedes [`legacy-docs/HANDOFF.md`](legacy-docs/HANDOFF.md) as the current
session handoff. It records what this session **learned and did not build** — the
open ideas and findings. Everything that *shipped* is documented where it lives
(pointers below), so this file deliberately does not repeat it.

The session began with one symptom — **grazers congregating at map edges and
especially corners** — and turned into a broader investigation of the
predator/prey spatial distribution and the world's terrain.

---

## What shipped (documented elsewhere — pointers only)

| Change | Where it's documented |
| --- | --- |
| Edge-aware fleeing (`escapeHeading`: slide along walls, break past when cornered, charge-past in a terrain dead-end) | DOCS §7 Decision; §1.6 C8 follow-up |
| Deep-water lake cores + a shallow drinkable ring | DOCS §7 Terrain |
| Long-range thirst cue (`world.nearestWater` + migration water drift) | DOCS §7 Migration |
| Line of sight in perception (generic `blocksSightAt` opacity chokepoint; rock opaque) | DOCS §7 Perception, Chokepoints |
| **Thicket** terrain — static refuge MVP (blocks sight, shelters, passable-but-avoided) | DOCS §7 Terrain; ACTION-ITEMS A18/A51 |
| Forage **edge-taper** — built, unit-tested, **disabled by default** (measurement declined it for congregation) | DOCS §7 Vegetation |
| Dynamic shrub layer — **plan only** | ACTION-ITEMS A51; DOCS §1.3 A51 |

⚠ **All of the above is uncommitted on `main`** (the user handles git). It stacks
on top of the earlier deep-water/flee work in the same working tree.

---

## The core finding (context for everything below)

Measured, not guessed:

- **Predators cause the edge bias.** With predators removed, grazers distribute
  ~uniformly (mean radius from centre ~47 vs ~50 for a true uniform). With them,
  the herd sits in the outer ring (mean radius ~60–63). The bounded map plus
  flee-directly-away funnels prey to the boundary; the periphery is the only
  structurally low-predation zone the geometry creates.
- **The acute pinning is now fixed** (edge-aware flee): smearing on the 2-cell
  edge band fell ~×3 → ~×1.5, and jamming into the corner *point* (within 4u)
  collapsed ~×4–9 → ~×1.5.
- **The residual is broad outer-ring occupancy** — mean radius ~57–62, the centre
  underpopulated (central quarter ~7% vs 25% uniform). This is a
  herd-distribution/predator-pressure effect, **not** flee-pinning, so more
  prey-side flee tweaks will not move it much.
- **Terrain barely moves the distribution with current mechanics.** Even a
  completely flat map keeps prey at mean radius ~60; piling on rock + cover only
  reached ~59. Thicket (this session) helps a little via LOS + refuge (~11%
  concealment, edge/corner eased slightly) but is not a full fix.
- **Three attack surfaces** for the residual: (a) stop flight funnelling to the
  periphery, (b) make the periphery not-the-safest, (c) build a competing
  low-risk zone in the interior. Everything below maps to one of these.

---

## Open ideas — reducing the residual edge/corner gathering (NOT built)

Ranked by leverage-per-effort. None of these is in the other docs.

1. **Flee toward the herd / interior, not just away from the threat** *(highest
   leverage, cheap, decision-layer)*. Today `flee` is "away from predator"
   (wall-aware). Blend in a capped pull toward the herd centroid or open interior,
   so escape paths **curve inward** instead of terminating at a wall. Attacks the
   funnel (surface a) directly. Risk: if the herd is behind the prey a naive blend
   flees *toward* the predator — needs a weighted, capped term. This is the single
   most direct lever left for the outer-ring residual.

2. **Predator break-off / disengagement** *(high leverage, hunting/decision
   layer)*. The edge is where flight *ends* and predators can't capitalise. If a
   predator gives up a chase after N ticks or when it goes cold, prey aren't
   shoved all the way to the boundary (surface b). Ties directly to A18.

3. **Openness-aware bedding** *(medium-high, decision-layer)*. Scale `rest`/settle
   utility by local openness — escape routes with room in several directions (an
   omnidirectional version of `escapeHeading`'s `roomAhead` probe). A corner has
   two walls and scores worst, so prey stop *choosing* to sit there. Realistic and
   targets the metric directly.

4. **Convex island shape** *(the corner-specific fix, not map-wrapping)*. Corners
   run ~×5–6 vs edges ~×1.5 in the data; a rounded, convex coastline with **no
   L-corners** removes the worst offender. Paired with the edge-aware flee already
   shipped, prey slide along a smooth coast with no dead-end. ⚠ **Bays, inlets and
   peninsulas are concave — they recreate corners**, so the outline has to stay
   convex. This is the user's stated island direction; the forage edge-taper
   (built, disabled) is groundwork for it.

5. **Anchor predator territories off the edges** *(medium)*. Stalkers already hold
   territory (`rangeRadius: 26`). Bias their settlement toward the interior or
   specific terrain so the *periphery* has higher predator density, not lower —
   inverting the "edge = refuge" logic (surface b).

6. **More / distributed interior anchors** *(cheap, compounding)*. The single lake
   now draws a congregation ring (thirst cue — validated this session). Several
   smaller lakes, or forage patches, plus herd cohesion give multiple interior
   hubs that compete with the edge pull (surface c). Note this session's water
   finding: thirst was *weak* (animals sat ~55% hydrated, 39–72% beyond
   `recallRange` of the one lake) until the long-range cue was added; more/closer
   water compounds it.

7. **Innate edge aversion** *(cheapest, least principled)*. A mild "exposed with a
   wall at my back" repulsion in wander/rest. Directly targets the metric but reads
   as artificial if overdone; reach for #1/#3 first.

---

## Settled this session (decisions not to build)

- **Cover-as-refuge via opacity: no.** Making the existing low `COVER` (brush)
  block sight was considered and rejected — a grazer is too big to hide behind
  tall grass. That is *why* the **thicket** (a tall, dense stand) was introduced as
  the sight-blocking terrain instead. Cover remains transparent on purpose.
- **Forage edge-taper as a congregation fix: no** (kept as island groundwork,
  disabled). It shapes the map but does not thin edge/corner crowding — removing
  edge forage makes the barren margin a *predator-light refuge* fleeing prey run
  *to*, and it halves grazer carrying capacity. Full reasoning in DOCS §7
  Vegetation.

---

## Other open threads

- **`escapeHeading` limitation.** In a *wide* concave terrain pocket whose exit is
  farther than `fleeLookahead`, local room-probing can't tell a diagonal that
  merely stays clear within the horizon from one that leads out, so a cornered prey
  may pick the wrong way. Deferred until restrictive terrain exists to tune
  against; the tight dead-end (the reliable case) is covered.
  `test/escape-heading.test.js` pins current behaviour.
- **A51 dynamic shrub layer.** The growing/grazable/maturing superset of the static
  thicket — full plan in ACTION-ITEMS.md (5 phases, gated behind `shrub.enabled`,
  measured via config override). The static thicket is its shipped MVP.
- **Benchmarks not re-run.** Line of sight adds ~+8% engine time on the demo
  (raycasts, measured); the thicket movement rule and water field are negligible.
  `BENCHMARK.md`'s large-5k figures predate all of this session's changes and were
  not re-measured.
- **Config levers added this session** (for the next person tuning): `decision.
  fleeWallMargin` / `fleeLookahead`, `perception.lineOfSight`, `migration.
  waterBiasWeight`, `vegetation.edgeTaperFraction` (0 = off), `terrain.
  lakeDeepFraction`, `terrain.thickets` (+ radius/steps/drift). All have sensible
  defaults; the taper is the only one shipped off.

---

## Recommended next step

If the goal stays "get prey off the outskirts," the two highest-signal moves are
**#1 flee-toward-herd/interior** and **#2 predator break-off** — both attack the
funnel at the decision/hunting layer with no new mechanic, and target the residual
the flee and refuge work left behind. For the *corners* specifically, **#4 convex
island shape** is the durable fix (short of map-wrapping). Prototype one, measure
edge/corner occupancy and the predator/prey knife-edge (5/5 survival across seeds),
same as every change this session.
