# Plan — trees, vertical refuge, flight, and the vulture

**Status: proposed. Nothing here is implemented.**

Four features, in the order they unblock each other:

1. **Trees** — a scattered woody layer that appears in groves, in pairs and
   triplets, and as lone trees on open grassland.
2. **Leopard tree use** — resting above competitors, and caching a kill where
   the hyena clan cannot reach it.
3. **A general flight mode** — a movement state, not a simulation of flight:
   faster travel, wider sight, cheap distance, terrain-independent.
4. **Vulture behaviour** — flight, roosting, and a carcass-discovery network,
   simplified to the level of behavioural complexity the other eight species
   already run at.

This document is written against [`DOCS.md`](DOCS.md) (the reference),
[`HANDOFF.md`](HANDOFF.md) (session state), [`ACTION-ITEMS.md`](ACTION-ITEMS.md)
(open work), and [`vulture.md`](vulture.md) (the species brief). It closes
**A67** (vertical refuge) in the narrow form A67 itself asks for, touches **A3**,
**A18**, **A49** and **A51**, and adds one new always-per-species field per
mechanism.

⚠ **Read §2 before §4.** Six of the constraints there have already cost this
project a phase each, and three of the four design decisions in §3 exist only
because of them.

---

## 1. What is in scope, and what is deliberately not

| In | Out, and why |
| --- | --- |
| Trees as a **terrain code** with concealment, shade, and a habitat name | Individual tree *entities* (A3). Nothing here needs a per-tree identity, and the perception scan may not consult a second grid (§2.2) |
| A two-valued **elevation** axis (`ground` / `canopy`) that gates **predation** and **carcass access** | A general 3D world, altitude bands, or elevation in the movement geometry. Elevation is a flag, not a coordinate |
| **Flight as a movement mode** — faster, wider-seeing, terrain-independent | Thermal soaring, altitude state, poor-thermal-conditions modulation, takeoff/flapping economics (`vulture.md` §Aerial movement). Explicitly simplified by the request |
| Leopard **rest** and **kill caching** in trees | Ambush *from* height. A treed cat cannot hunt (§3.2), which is the honest reading of a flag-not-a-coordinate elevation |
| Vulture **flight**, **tree roosting**, **follow-the-descending-bird** discovery, and a life-history pass | Cliffs, nest sites and nest fidelity (A34 says a site with no *reason* is inert); a beak-strength / tissue-specialization feeding hierarchy (§4.7 — possession already expresses it) |
| Trees as a restart/world-composition control beside `rocks` and `thickets` | A dynamic, growing, browsable shrub layer — that is still **A51**, and this plan does not build it (§8) |

⚠ **Trees here are static, like thicket.** They do not grow, are not eaten, and
have no woody floor. This is the same relationship the shipped `THICKET` terrain
has to A51: the static MVP of a dynamic layer. Building the dynamic layer first
would triple the size of this plan and none of the four features needs it.

---

## 2. The constraints this plan is shaped by

Each of these is a documented, paid-for lesson. They are listed first because
they eliminate most of the obvious designs.

### 2.1 A new movement behaviour competes with foraging, and foraging must win
DOCS §9 Decision. Patrol cost the demo two seeds in five. Consequence: **this
plan adds exactly one new action** (`cache`, §4.4), and it must clear the bar
`hide`/`tend` cleared — it belongs to an animal with no competing agenda at that
moment. Climbing, roosting, and flying are **not** actions: they are a state
transition, a habitat weight, and a pace flag on the intent respectively.

### 2.2 ⚠⚠ Nothing in the perception cell scan may consult a second grid
DOCS §9 Perception. One `sheltersAt(features, …)` call inside the (2r+1)² scan
cost **+56% of a whole tick** at large-5k. Consequence: **trees must be terrain**
(§3.1). A `TreeGrid` beside `FeatureGrid` would be architecturally tidy and
unaffordable — the shelter cue, the habitat gradient and the concealment lookup
all live in or beside that loop.

### 2.3 ⚠⚠ A perception gate is not a predation gate (A63)
Prey, threats, **mate candidates**, a juvenile's guardian and territorial rivals
all come through one test in `PerceptionSystem`. Cover concealment was added
there correctly and sterilised the leopard: its population fell 27 → 19 because
a cryptic solitary animal stopped finding mates, and the failure presented as a
tuning problem three subsystems away. Consequence: **elevation must not be
tested on the shared `continue`.** It goes on the two predation branches, inside
`predation/predation.js` (§3.2).

### 2.4 ⚠⚠ `PerceptionSystem#perceive` is arity-sensitive
One extra *argument* cost 12% of total engine time (D28). Consequence: a
flight-widened perception radius must be resolved **inside** `#perceive` from
the `entity` and `species` already passed. No new parameter, no second block
handed down.

### 2.5 An off switch cannot live in a species block
DOCS §8. A species block *beats* the config, so `config.flight.enabled: false`
would be overridden by any species declaring its own. Consequence: every
mechanism here puts its **switch in a global config section** and its **biology
in an always-per-species field** — the shape `forage`, `habitat`, `association`
and `crypsis` all have.

### 2.6 An off switch must leave no trace (D30), and inertness is proved, not assumed
DOCS §20. Consequence: every phase below ships **inert first** and is proved
**byte-identical** across seeds 1/2/42 at 1500 ticks before anything is turned
on. ⚠ Compare `JSON.stringify` output, never `deepEqual` — two ~650 KB entity
graphs that genuinely differ exhaust a 4 GB heap building a diff and report
nothing.

### 2.7 A fixed draw budget, and terrain draws are the whole map
DOCS §4. Tree placement runs **last among the placement steps**, after
`#carveThicketFormations` and before `#ensureConnectivity`, and spends **zero
draws** when the tree counts are 0 — so every existing seed's lakes, rock, cover
and thicket are bit-for-bit what they are today, and `trees: 0` is the control.
Flight, climbing and caching add **no draws at all**.

### 2.8 Measure the shift, never the state it leaves behind
DOCS §9 Feeding. The forage succession reads backwards in raw numbers. Every
claim in §6 is stated as a **difference against its own control on the same
seeds**, not as an after-state.

### 2.9 Other traps that will bite this specific work

- ⚠ **`test/habitat.test.js` has been moved twice by roster changes** and will
  move a third time: it currently asserts thicket avoidance, and trees are new
  ground several species will want.
- ⚠ **`npm run fixtures:renderer` is due on every terrain or roster change**, not
  only on a protocol bump.
- ⚠ **`SUPPORTED_PROTOCOL_VERSION` must move with `PROTOCOL_VERSION`** (D31),
  and `test/protocol-v30.test.js` is the pattern for the new one.
- ⚠ **A single-seed assertion about the demo is an assertion about a
  trajectory.** Expect two or three suites to break per phase without any
  regression having occurred.
- ⚠ **`git stash` reverts to HEAD, not to the previous phase.** Take inertness
  baselines against a copied tree if more than one phase is uncommitted.
- ⚠ **Budget a failed ten-seed gate per net-new mechanism**, not per plan.

---

## 3. Four decisions taken up front

### 3.1 Trees are a **terrain code**, not entities and not a second layer

`TerrainType.TREE = 6`, passable, generated in the same pass style as rock and
thicket.

**Why this and not the alternatives:**

| Option | Verdict |
| --- | --- |
| **Terrain code** (chosen) | Every chokepoint already reads terrain: `speedModifierAt`, `blocksSightAt` / `concealmentAt`, `isShelteredAt`, `SHELTERING_BY_CODE` in the hot scan. ⚠ And `habitat` weights are **keyed by the legend's own names**, so `habitat: { tree: 1.5 }` works with **zero engine code** the moment the legend has the entry. A tree is one `Uint8Array` value |
| A sparse `TreeGrid` like `FeatureGrid` | Rejected on §2.2 — the shelter cue and the habitat gradient would each need a second grid read per cell of the hottest loop in the engine |
| `plant`-kind entities (A3) | Rejected. Nothing needs per-tree identity, and every consumer would need a spatial query where it currently does an array index |
| Dynamic shrub layer (A51) | Deferred. Correct eventually; three phases of work before a leopard can sit in one |

**The cost of the choice, stated rather than discovered later:** terrain is
**static and unsaved**, regenerated from the seed on load. So a tree can never
grow, burn down, or be eaten. That is exactly A51's boundary, and it is why this
plan says trees are the thicket-shaped MVP of the woody layer rather than the
woody layer.

**Proposed cell properties** — all four are one array entry apiece, and all four
are *proposals to be measured*, not settled numbers:

| Property | Table | Proposed | Reasoning |
| --- | --- | ---: | --- |
| Passability | `TERRAIN_LEGEND` | **passable** | An animal walks under a tree |
| Speed | `SPEED_MODIFIER_BY_CODE` | **0.9** | Barely impeded; not a thicket |
| Concealment | `CONCEALMENT_BY_CODE` | **0.4** | Below cover's 0.55 — a scattered canopy hides less than a stand of brush. ⚠ Stays **under 1**, so `SIGHT_BLOCKING_BY_CODE` stays false and the raycast is untouched (the phase-14 discipline: opacity is the top of the scale, not a second pass) |
| Shelter | `SHELTERING_BY_CODE` | **1 (shelters)** | Shade and rain cover. ⚠ This is the one that will move populations — exposure is a leading death cause and A67's thermoregulation work is three days old. Expect it in the gate |

**Generation** — a new `#scatterTrees(random, params)`, running after
`#carveThicketFormations`, writing only onto `GROUND` (`onlyGround`-style), in
two passes so the requested shapes both exist:

- **Groves** — `treeGroves` random-walk discs like thicket formations, but each
  cell inside the disc converts with probability `treeGroveDensity` (~0.35–0.5).
  That is what makes a grove *semi-open woodland* rather than a solid stand; a
  solid disc would be a thicket wearing a different name.
- **Singles, pairs and triplets** — `treeSingles` scattered ground cells, each
  converting itself plus `0–2` of its passable 8-neighbours. One draw for the
  cell, one for the companion count, one per companion; a fixed budget per
  single so the stream is predictable.

⚠ **Both counts default to 0, and the method returns before its first
`random.next()` when they are.** That is the byte-identical control and it is
what makes §4.1's inertness proof possible at all.

**Composition control.** `trees` joins `rocks` and `thickets` as a 0–4
prevalence level in `src/protocol/commands.js`, mapped host-side in
`buildDemoConfig`'s `FORMATION_COUNT_AT_DEFAULT`, and offered by the renderer's
`Controls.js` beside the other two. The presets in `presets/` gain the field.

### 3.2 One **elevation** axis, two values, gated at predation and possession

`entity.elevation` — `0` ground, `1` canopy. A carcass carries it too.

**Where it is read, and where it is deliberately not:**

| Reader | Rule | Why there |
| --- | --- | --- |
| `predation/predation.js` (`isEligiblePrey`) | Elevations must match | ⚠ §2.3. This is a **predation** gate. It sits beside the mass ratios, which already resolve per pair on the rare true case, so mates / guardians / rivals / the neighbour list are untouched. Read in both directions for free: a treed leopard is not a threat, and a treed animal is not prey |
| `HuntingSystem` | An attempt is refused across elevations | Belt and braces at the point of resolution, and the place a stale committed `huntTargetId` is caught |
| `predation/possession.js` (`shareFor` / `isAvailableTo`) | A canopy carcass yields **0** to a non-climber | ⚠ **This is A67's own suggested framing** — "cached out of reach as one more possession state rather than a new axis" — and it lands on the one predicate the decision system and the feeding system already share, so an animal can never walk to a cache it is then refused (D11) |
| `MovementSystem` / `locomotion/steps.js` | A canopy animal does not step; its first moving intent descends it | One predicate, two readers, as `stepRefused` already is |
| `DisturbanceSystem` | A canopy animal is not burnt | One comparison, real fidelity |
| **`PerceptionSystem`'s shared gate** | ❌ **never** | §2.3 |

**Climbing is not an action.** A species with `climbs: true` standing on a tree
cell ascends when its chosen action is `rest`, `shelter`, or `flee`, and
descends the moment it chooses anything that travels. The transition is written
by **one** system (proposed: `MovementSystem`, which already owns the
intent→position step) and by nothing else.

⚠ **Fleeing into a tree needs a heading rule, not a utility.** The precedent is
exact: `stalk`'s concealed approach and `flee`'s `escapeHeading` are both
heading rules inside actions that already existed. A climber's `flee` biases
toward a tree cell within a few units, then ascends on arrival.

### 3.3 Flight is a **pace on the intent**, not an action

`intent.sprint` already exists as a pace flag the movement system executes.
Flight is the same shape: `entity.flying`, decided by the decision system from
the action it has already chosen, executed by movement, read by perception and
metabolism.

**The rule for when a capable animal flies** lives in one predicate
(`locomotion/flight.js`, the `steps.js` pattern — one home, several readers):

> Fly while the chosen action is a **travelling** one (`wander`, `seekFood`,
> `recallFood`, `seekWater`, `recallWater`, `patrol`); be on the ground for
> `eat`, `drink`, `rest`, `hide`, `seekMate`, `defend`, and anything resolved at
> contact. Fly regardless if the cell underneath is impassable — that is what
> keeps "a grounded animal is on passable ground" true by construction.

**What flying changes, each at a chokepoint that already exists:**

| Effect | Where | Note |
| --- | --- | --- |
| Faster travel | `stepLength` in `locomotion/steps.js` | × `flight.speedMultiplier`, and the terrain speed modifier is **bypassed** — that is "terrain-independent movement" for free |
| Nothing blocks it | `stepRefused` | Airborne: no rock, no thicket edge, no crowding cap. ⚠ It may only *land* on passable ground, which the predicate above guarantees |
| Wider sight | `#perceive` | `radius × flight.visionMultiplier`, resolved **inside** from `entity.flying` and the `species` already in hand (§2.4) |
| Cheap distance | `MetabolismSystem` | `moveCostFactor × flight.moveCostFactor` while airborne |
| Not prey, not burnt | `predation.js`, `DisturbanceSystem` | Same predicate as canopy elevation |

⚠ **Perception runs before decision in the tick**, so `entity.flying` is read
one tick after it is written. That is a one-tick lag on the sight radius, it is
harmless, and it must be written down rather than discovered — the alternative
(deciding flight in the perception phase) puts an action-shaped choice in the
wrong system.

⚠ **The sight radius is the performance risk in this whole plan.** The cell scan
is (2r+1)², so a vulture at radius 14 widened to 22 costs **~2.5×** on the
hottest loop in the engine, for the species that already has the widest radius
in the world. **The mitigation is to move the number, not to add one:** drop the
vulture's ground radius to ~9 and set `visionMultiplier` ~1.55, so a *flying*
vulture sees exactly the 14 it sees today and the world's maximum radius does
not move at all. Measure it either way (§6).

**Flicker.** Nothing charges for takeoff in v1. A wander heading is already
committed for 8–24 ticks, which should carry the flight state with it; the
measurement to take is **ground↔air transitions per animal per 1000 ticks**, and
the named lever if it is high is `flight.takeoffCost` — added then, not now.

### 3.4 The vulture's additions are reasons for machinery that exists

`vulture.md` asks for six things. Five need no new mechanism:

| `vulture.md` asks for | This plan's answer |
| --- | --- |
| Aerial movement | §3.3, generalized — not vulture-specific |
| Carcass discovery network ("watch other vultures descend") | The **`#joinedHunt` shape**, copied: a scavenger with no carcass of its own in sight adopts the carcass a conspecific has already committed to. No new action — it fills `seekFood`'s target (§4.7) |
| Feeding hierarchy | **Already built.** Possession, dominance, `possessionShare` and the contest are exactly "smaller birds wait until larger scavengers open or abandon a carcass". A beak-strength term is declined |
| Roosts and nests | Tree roosting = `habitat: { tree: … }` + the existing `rest`/`shelter` on a tree cell + §3.2's ascent. ⚠ Nest-site *fidelity* is declined: A34 measured `patrol` at 0–1 firings per 3000 ticks, and a nest with nothing at it is a place without a purpose |
| Slow life history | Config only, behind the §20 species gate (§4.8) |
| Communal feeding and roosting | Emergent from the herd label + the habitat pull + the discovery network. No group registry entry — the vulture's own file argues it is an aggregation, not a membership, and that reasoning still holds |

---

## 4. The phases

Each phase ships **inert first**, is proved byte-identical, then is turned on and
measured against its own control on the same seeds. The ordering is by
dependency, and every phase below is separately revertable.

### Phase T1 — the tree terrain type ✅ **SHIPPED 2026-08-03**

**As built.** Everything below shipped as planned; the four things the plan got
wrong are recorded at the end of this section, because that is the part worth
reading next time.

**Ships:** `TerrainType.TREE`, its four table entries, `#scatterTrees`, the
config params, the `trees` composition control, a renderer appearance, and
regenerated fixtures.

**Files:** `world/TerrainGrid.js` · `config/defaultSimulationConfig.js` ·
`protocol/commands.js` · `protocol/validation.js` · `fixtures/createDemoSimulation.js`
(`buildDemoConfig`) · `renderer/app/rendering/EntityAppearance.js`
(`TERRAIN_APPEARANCE`, and add the tree to `FADING_LAYERS` for the reason thicket
is in it — an animal in a tree is the collision that matters) ·
`renderer/app/ui/Controls.js` · `presets/*.json`.

**Off switch:** `terrain.treeGroves: 0, terrain.treeSingles: 0` — and no draws
spent when both are 0.

**Inertness proof:** seeds 1/2/42 × 1500 ticks, `JSON.stringify` byte-identical
to HEAD, with the terrain RLE identical too (this one is checkable directly, and
should be: a shifted `terrain` stream would be silent otherwise).

**Then turn it on and measure.** ⚠ **This phase is not a free addition and must
not be treated as one.** It adds sheltering ground and concealing ground to a
world whose leading death cause is dehydration and whose second is exposure, and
whose fawn-concealment rate (A57) tracks the sheltering fraction of the map
almost exactly. Predicted, so the measurement can contradict it: exposure deaths
down, A57's concealed-fawn fraction up, gazelle up slightly, leopard roughly
flat (it already has thicket).

**Gate:** the §20 ten-seed gate, plus `npm run benchmark` re-baselined
(prediction: flat — one more entry in four arrays, no new read).

#### As built — four things the plan got wrong

**Inertness held exactly.** Seeds 1/2/42 × 1500 ticks against a clean HEAD
checkout: state, terrain **and** vegetation hashes identical, entity counts
identical. Shipped at `treeGroves: 8, treeSingles: 60` = **2.45% of the map**.

**The gate passed** — 10/10 on every species but the gazelle at 9/10 (lost seed 1
at t14384). Full numbers in DOCS §7 Terrain.

1. ⚠ **The prediction was wrong in both directions.** The plan predicted
   "exposure deaths down, gazelle up slightly, leopard roughly flat". Exposure is
   not where the movement was; the **gazelle is down 20%** (60.7 against 76.1)
   and the leopard is the one that came out flat (−0.4). And the 3-seed
   exploratory sweep read gazelle −38% / leopard **+19%** — at ten seeds the
   first halved and the second reversed. D14 exactly: three seeds cannot resolve
   a population whose control range is 12–194.

2. ⚠⚠ **A structural artifact nobody predicted: adding terrain *removes*
   preferred habitat.** Every herbivore weights `ground` 1.1–1.2 and none names
   `tree`, so converting open ground to trees silently shrinks the preferred
   habitat of every grazer in the world. That is a general property of adding a
   terrain code to a world whose species enumerate terrain by name — **any**
   future terrain type has it. Naming `tree` in the species blocks is T3's work;
   doing it here would have confounded this gate.

3. ⚠ **Two draw-budget bugs, both found by tests rather than by review.** The
   companion-count draw was skipped at `treeClusterMax: 0`, so the *clumping
   setting* shifted the stream and turning clumping off moved every lone tree on
   the map. And `vegetation.treeSuitability` must stay **above 0**, because
   `#seed` draws initial biomass only where capacity is positive — a suitability
   of 0 would re-roll the entire vegetation field of every wooded seed.

4. ⚠⚠ **The benchmark reported +7.1%, twice, and it was drift.** An interleaved
   A/B/A said the tree was slower in both rounds; a second set minutes later had
   it *faster* than HEAD in both. The decisive measurement was trees-on against
   trees-off **in one binary and one process** (+1.3%, −4.2%, −0.5% — mixed, so
   no effect). See BENCHMARK.md: interleaving is not immunity to drift, and a
   cross-tree benchmark cannot separate "the code costs something" from "the
   world contains something".

**Collateral, and both were real findings rather than test churn:**

- **`test/habitat.test.js` moved a third time, and this time it could not be
  re-aimed.** Its thicket-avoidance claim was already at the noise floor on HEAD
  — A65's obstacle deflection had collapsed thicket occupancy months before trees
  arrived — and two replacement metrics were built and measured *worse than
  useless* (one reads backwards on clean HEAD). Opened as **A72**.
- **~25 test sandboxes silently stopped being featureless.** Tree counts are
  absolute, like `ridges` and `thickets`, so the demo's 60 lone trees landed
  unchanged in a 32×32 sandbox — **~12% of it**. Five suites noticed; the rest
  passed, which is worse. Fixed once in `test/helpers/flatTerrain.js`, with the
  rule that a new generator quantity is zeroed there in the same commit.

---

### Phase T2 — the elevation axis ✅ **SHIPPED 2026-08-03**

**As built.** Shipped as designed; the three corrections are at the end of the
section.

**Ships:** `entity.elevation` (and on carcasses), a `climbs` per-species field
with `config.climbing.enabled` as the switch, the ascent/descent transition, and
the three gates from §3.2. **No species declares `climbs` yet.**

**Files:** `world/EntityManager.js` (field default) ·
`predation/predation.js` · `predation/possession.js` · `systems/HuntingSystem.js` ·
`systems/MovementSystem.js` · `locomotion/steps.js` ·
`systems/DisturbanceSystem.js` · `config/species/schema.js` (a note only —
`climbs` is an always-per-species **field**, like `crypsis`, not a block) ·
`protocol/snapshots.js` (`PUBLIC_ENTITY_FIELDS` + `elevation`) ·
`persistence/SimulationSerializer.js`.

**Off switch:** `config.climbing.enabled: false`, and `climbs` absent from every
species — two independent zeros, deliberately.

**Inertness proof:** byte-identical with no species declaring `climbs`. Entities
serialize whole (`{ ...entity }`), so a new field rides free — which means the
proof has to be read carefully: the *state* will differ by the literal
`"elevation":0` per entity, so compare with the field stripped, or assert on
behaviour-bearing fields.

**Protocol:** `elevation` in the bulk snapshot is a **v31 bump** — the same
argument `gestating`/`seekingMate` made at v30 (a renderer cannot show what it
cannot see, and a leopard in a tree is the most watchable thing this plan
produces). Measure the projection cost on the projection loop directly, not in a
whole-tick number (v30 measured +0.009 ms at 11 300 entities; expect the same
order). ⚠ `SUPPORTED_PROTOCOL_VERSION`, a `test/protocol-v31.test.js`, and
regenerated fixtures move in the same commit.

**Save:** `SAVE_FORMAT_VERSION` 29 → 30. A pre-bump save has no `elevation`;
`undefined` must read as ground everywhere, and the restore path should say so
explicitly rather than relying on falsiness.

**Assert the mechanism directly, not through a population** (§20 step 4): a test
that puts a carcass in the canopy and a hyena beside it, and asserts the hyena
neither walks to it nor eats from it.

#### As built — three corrections

**Inertness held.** No species declares `climbs`; the demo is byte-identical
across seeds 1/2/42 × 1500 ticks with `config.climbing.enabled` on and off, and
`test/protocol-v31.test.js` asserts no entity is ever aloft. Every added
predicate is the identity when all elevations are 0, and nothing draws. Protocol
**v31**, save **v30**, 1060 tests passing.

1. ⚠⚠ **A cached carcass had to gate on *capability*, not on elevation, and the
   plan's rule would not have worked.** §3.2 said the possession gate was
   `shareElevation(eater, carcass)` — be up the tree to eat what is up the tree.
   That fails on **phase ordering**: elevation resolves in the *movement* phase
   from an action, while which carcass an animal is eating is not known until the
   *interaction* phase, so a climber choosing `eat` would need to already be at
   the right height for a body it has not picked yet. Every repair is a stored
   climb-to-eat/eat/climb-down state machine — exactly what possession was
   designed not to have. `reachesCarcass` asks whether the eater *can* climb,
   which needs no state and says the thing that matters (the clan cannot take
   this kill). Cost: a feeding leopard is not necessarily drawn up the tree.

2. ⚠⚠ **`publicEntityView` is a second copy of `PUBLIC_ENTITY_FIELDS`, and the
   existing test could not see the difference.** The whitelist had `elevation`
   and the engine's projection literal did not, so `cloneEntity` read `undefined`
   for every entity: the field arrived *absent* rather than as 0, key present, no
   error. `test/protocol.test.js` compared the two lists' **keys**, which passes
   vacuously because `cloneEntity` builds its keys *from* the whitelist. It now
   asserts every whitelisted field carries a defined value. ⚠ This is a general
   hazard for every future projected field, not a tree thing.

3. ⚠ **A version-pinned literal in a historical bump test.** `test/protocol-v30`
   asserted `PROTOCOL_VERSION === 30`, so bumping to 31 failed a suite about
   *reproductive state* — which says nothing about reproductive state. Changed to
   a floor (`>= 30`) plus "the builder stamps the live version". The v29 suite
   had already got this right; v30 had not.

**One small behaviour change outside the switch, recorded rather than hidden:**
`#availableCarcass` used to return the perceived carcass unexamined when
`possessionEnabled` was false. It now resolves the entity first (to ask about
reachability), so a carcass that has since been removed reads as `null` instead
of as a stale target. That is a fix, it only affects the possession-off arm, and
the demo does not run in it.

---

### Phase T3 — the leopard in the tree

**Ships:** the leopard declares `climbs: true` and a `tree` habitat weight; the
`flee`-toward-a-tree heading rule; and the `cache` action.

**Files:** `config/species/predatorLeopard.js` · `systems/DecisionSystem.js`
(the heading rule, and the one new action) · `systems/MovementSystem.js` (hauling
the held carcass).

**The two halves are not equally load-bearing, and saying so is the point:**

- **Resting above competitors is fidelity, and mechanically near-inert today.**
  Nothing hunts a leopard — no species lists it in `preySpeciesIds` — so a treed
  leopard is safe from something that was never coming. It is visible,
  inspectable, and correct; it is not a survival mechanism. ⚠ Recording that up
  front is what A34 and A57 are records of *not* doing.
- **Caching a kill is the real half**, and it closes a limitation the leopard's
  own species file states: *"this leopard cannot protect a kill from the hyena
  clan, and the carcass-possession contest resolves on dominance alone, so it
  loses kills a real one would keep."*

**⚠ `cache` is the one new action in this plan, and here is the bar it must
clear.** DOCS §9 Decision: a new movement behaviour competes with foraging, and
foraging must win. `cache` competes with **`eat`, for one animal, for a few
ticks, on a carcass it already possesses** — it delays its own meal to secure
it, which is a real trade-off rather than a new claim on a foraging animal's
attention. It is gated on: possessing a carcass, being a climber, a tree cell
within `cacheHaulDistance` (~4), and the carcass not already cached. Every other
animal in the world scores it 0 on the first comparison.

**Hauling.** While `cache` is active the leopard steps toward the tree and the
carcass it holds is moved with it (`world.moveEntity` on a carcass — the spatial
grid handles this already; carcasses have simply never moved before). On arrival
the carcass's elevation becomes canopy. Speed penalty proportional to the
carcass's mass relative to the hauler's.

**⚠ If the gate fails, the recorded fallback is `cacheInPlace`:** the kill is
elevated only when it happens on a tree cell, no hauling and no new action. It
is honest and it will be **near-inert** — trees will cover a few percent of the
map — which is exactly the A34/A57 shape, so it is the fallback rather than the
proposal.

**Measure the shift:** carcasses lost to a stronger scavenger, per leopard kill,
with the mechanism on against off. That is the claim. The population number is
context.

---

### Phase F1 — the flight mode, declared by nobody

**Ships:** `locomotion/flight.js` (the one predicate), `entity.flying`, a
`flight` per-species field, `config.flight.enabled` as the switch, and the five
chokepoint effects from §3.3. **No species declares `flight` yet.**

**Files:** `locomotion/flight.js` (new) · `locomotion/steps.js` ·
`systems/DecisionSystem.js` (writes `entity.flying`; nothing else writes it) ·
`systems/MovementSystem.js` · `systems/PerceptionSystem.js` (radius only, inside
`#perceive`) · `systems/MetabolismSystem.js` · `predation/predation.js` ·
`protocol/snapshots.js` · `persistence/SimulationSerializer.js`.

**Inertness proof:** byte-identical with no species declaring `flight`. Zero
draws added, so the streams cannot shift.

**Protocol:** `flying` joins the bulk snapshot in the same **v31** bump as
`elevation` if the two phases land together; otherwise **v32**. Two bumps is the
honest price of two separately-attributable changes and is cheap — a version
number, a test file, and regenerated fixtures.

**⚠ Watch the neighbour buffer contract.** `world.neighbourhood` is published by
perception at whatever radius that animal used. DOCS' two conditions still hold —
a *longer* list is safe, a shorter one silently drops neighbours — so a flying
animal's wider list is fine, and a *narrower* ground radius for the vulture
(§3.3) is the case to check against `SocialSystem#neighboursOf`.

---

### Phase F2 — the vulture flies

**Ships:** one species file edit — `flight: { speedMultiplier, visionMultiplier,
moveCostFactor }`, and the paired drop in ground `perception.radius` that keeps
the world's widest radius where it is.

**⚠ Predict this one loudly, because it is the largest ecological change in the
plan.** The vulture's mean population already **doubled** (157.8 → 307.3) when
batch 3 put more and heavier animals in the world, and `carcass.decayTicks` is
still a mass-blind constant (B7) feeding it. Flight makes the world's most
numerous animal faster, wider-seeing and cheaper to run at once. Expected
direction: vulture up, other scavengers down at carcasses, and a real chance of
the gate failing on the hyena rather than on the vulture.

**The paired counterweight is Phase V3**, and the two must be measured
**separately** before they are measured together — A12's rule: two changes to
the same quantity at once leave no way to attribute the result.

**Cheap first, gate second** (the batch-3 practice that is the transferable
part): a **3-seed exploratory sweep** and a **one-command A/B**
(`--set=flight.enabled=true --controlSet=flight.enabled=false`) before the
twenty-minute ten-seed gate is started.

---

### Phase V1 — roosting

**Ships:** the vulture declares `climbs: true`, `habitat: { tree: 1.6, … }`, and
a `migration.cueRadius` (it is 0 today, and ⚠ **a habitat preference with no cue
radius has nowhere to act** — the leopard needed exactly this fix at phase 14).

**Expect a small effect and say so.** DOCS §9 Habitat records that scaling
`rest` by the ground underfoot was declined as born-inert: `rest` is 0.8–1.6% of
animal-ticks. Roosting is that action plus an ascent. What to measure is
therefore the *cue*, not the outcome: **the share of vulture ticks spent on tree
cells**, on against off. Communal roosting, if it appears, is the herd label and
the habitat pull agreeing — no mechanism claims it.

---

### Phase V2 — the carcass-discovery network

**Ships:** a scavenger with **no carcass of its own in sight** adopts the
carcass a nearby conspecific has committed to, filling `seekFood`'s target.

**⚠ This is `#joinedHunt` with a different noun, and copying that shape exactly
is the design.** Its guarantees carry over for free: gated on having nothing of
its own, so it can only ever *add* a searcher to a body, never take one off a
body it had already found; it reads the neighbour buffer rather than adding a
third walk; it adds no action and no draw.

**Biology in a field, switch in a section** (§2.5): `scavenging: { followsKin:
true, followRange }` per species, `config.scavenging.enabled` global.

**Measure the shift:** ticks from a carcass's creation to the *n*th feeder
arriving, on against off. That is the cascade `vulture.md` asks for, and it is
measurable in a way "more vultures" is not.

---

### Phase V3 — the slow life history

**Config only, behind the §20 species gate.** `vulture.md` wants slow
maturation, one chick, long dependency. The current bird is deliberately the
opposite — a boom-and-bust breeder, `gestationTicks: 400`, `cooldownTicks: 900`,
`maxAge: 6000` — and those numbers are load-bearing for a demo the docs call a
knife edge.

⚠ **A62 caps how far this can honestly go.** The year is 8000 ticks and
lifespans are compressed beside it, so a large animal has about one year of
adult life; a genuinely slow life history meets that compression head-on, and
the lever is `ticksPerYear`, which re-bases every seasonal measurement in the
project. So: a **modest** shift — longer gestation, longer cooldown, later
maturity — sized to counterweight Phase F2 rather than to satisfy the brief, and
measured as its own arm.

---

## 5. Version and payload impact

| | Change | Phase |
| --- | --- | --- |
| `PROTOCOL_VERSION` | 30 → **31** — `elevation` and `flying` in `PUBLIC_ENTITY_FIELDS`; `trees` in the restart composition fields; a `tree` entry in the terrain legend | T2 / F1 |
| `SUPPORTED_PROTOCOL_VERSION` | moves with it, ⚠ **in the same commit** (D31) | T2 |
| `SAVE_FORMAT_VERSION` | 29 → **30** — two new entity fields; `undefined` reads as ground / not flying | T2 |
| Renderer fixtures | regenerated at **T1** (terrain), **T2** (protocol), and **F2** (roster behaviour) | — |
| New protocol test | `test/protocol-v31.test.js`, modelled on `protocol-v30` | T2 |
| Bulk snapshot size | +2 small fields per entity. Measure on the projection loop directly, not in a whole-tick number (D28) | T2 |
| `/api/metrics` payload | unchanged — no new species, and P14's diagnosis is that the history is 91% of it | — |

---

## 6. What each phase measures, and what would make it fail

⚠ **Every row is a difference against its own control on the same seeds**, per
§2.8. None of these is an after-state.

| Phase | The claim | The measurement | Fails if |
| --- | --- | --- | --- |
| T1 | Trees exist and are shade and light concealment | Exposure deaths; A57's concealed-fawn fraction; gazelle/leopard/vulture means; benchmark | Any species below 6/10 seeds at 15k, or benchmark above the 1% noise floor without an explanation |
| T2 | A canopy carcass is unreachable | Direct assertion (a hyena beside a cached body eats nothing), plus a byte-identical inert arm | The inert arm differs anywhere but the two new fields |
| T3 | A leopard keeps kills it used to lose | Carcasses lost to a stronger scavenger per leopard kill, on vs off; `cache` action-ticks per 1000 (⚠ if it is `patrol`'s 0–1, the mechanism is inert and the fallback applies) | `cache` displaces `eat` enough to move leopard energy, or `cache` never fires |
| F1 | Flight is inert until declared | Byte-identical, seeds 1/2/42 | Any difference at all |
| F2 | A flying vulture searches wider and travels cheaper | Ticks from carcass creation to first feeder; distance covered per 1000 ticks; ground↔air transitions per 1000 ticks; **benchmark, interleaved** | The gate loses the hyena or the leopard; or the perception scan cost shows up in the whole-tick number |
| V1 | A vulture prefers to be in a tree | Share of vulture ticks on tree cells, on vs off | The share does not move — then it is the cue radius, not the weight (the leopard's phase-14 lesson) |
| V2 | Discovery cascades | Ticks to the 1st / 3rd / 5th feeder at a new carcass | No change in time-to-3rd — then the birds were already finding bodies independently and the mechanism is decoration |
| V3 | Slower breeding counterweights F2 | Vulture mean and per-capita carrion, as its own arm | Vulture below 6/10 seeds — an over-correction is as much a failure as none |

**The order of instruments, which is the part worth copying** (§20): a 3-seed
exploratory sweep (~3 min) and a one-command config A/B **before** the ten-seed
gate (~20 min). Batch 3 is the only batch that ever passed first time and that
is why.

---

## 7. Tests

**New suites:** `test/trees.test.js` (generation shape, the four table entries,
`trees: 0` inertness) · `test/elevation.test.js` (the predation gate, the
possession gate, ascent/descent, and ⚠ an explicit assertion that **mate
candidates and guardians are unaffected** — the A63 regression test this plan
owes) · `test/flight.test.js` (the pace predicate, terrain independence, the
landing invariant, zero draws) · `test/caching.test.js` (haul, elevate, refuse a
non-climber) · `test/protocol-v31.test.js`.

**Existing suites that will move, predicted so a break is not read as a
regression:** `test/habitat.test.js` (a third time — trees are new contested
ground) · `test/terrain.test.js` (a new code, and connectivity over it) ·
`test/perception.test.js` and `test/concealment.test.js` (a new concealing
terrain) · `test/weather.test.js` (a new sheltering terrain) ·
`test/renderer-view.test.js` and `test/presets.test.js` (a new composition
field) · `test/persistence.test.js` (the save bump).

**Invariants that must keep passing untouched:** the species-name source scan
(nothing here may branch on a species id — `climbs`, `flight` and `scavenging`
are all data), `test/determinism.test.js`, and
`test/renderer-boundaries.test.js`.

---

## 8. Action items this touches

| Item | Effect |
| --- | --- |
| **A67 — vertical refuge: trees, climbing, cached kills** | **Closed**, in the narrow form A67 asks for: it says "revisit only if *cached out of reach* can be one more possession state rather than a new axis" — §3.2 is exactly that. A67 predicted an elevation dimension threaded through perception, movement and predation; this plan threads it through **predation and possession only**, and does not touch the perception gate |
| **A3 — individual tree/shrub entities** | **Unchanged and still open.** Trees here are a terrain code; the `plant` entity kind stays reserved |
| **A51 — dynamic shrub layer** | **Partly pre-empted, deliberately.** Trees are a second static woody terrain beside thicket. A51's growth, browse and woody floor are untouched, and the browse A65 needs is still unbuilt |
| **A18 — no spatial refuge from predators** | **Narrowed.** A canopy is a genuine refuge — the first one in the world with a hard eligibility gate rather than a probability. Prey crypsis is still 0 and that decision is untouched |
| **A57 — a fawn is concealed only if born on cover** | **Improved for free.** Cover is 3% of the map; trees raise the sheltering fraction with no behavioural change, which A57 names as its strongest lever |
| **A49 — activity pattern is not a schema field** | **Sharpened, not closed.** Roosting is what a diurnal cycle would give a reason to. Worth a line in A49 that a roost exists and has no night to want it |
| **A34 — patrol's target is a place, not a purpose** | **Cited twice.** Nest fidelity is declined on it (§3.4); `cache` is accepted because it has a purpose |
| **B7 — `carcass.decayTicks` is mass-blind** | **Pressure increases.** F2 makes the animal that lives on that constant faster and wider-seeing |
| **New: an elevation flag is not an elevation coordinate** | Worth opening. A treed animal cannot ambush from height, cannot see further from up a tree, and a cliff is not expressible. All three are honest consequences of the flag |

---

## 9. Sequencing, and where to stop

```
T1 trees ──┬─→ T2 elevation ──┬─→ T3 leopard: rest + cache
           │                  └─→ V1 vulture: roosting
           │                        ↑
F1 flight ─┴────→ F2 vulture flies ─┴─→ V2 discovery network ─→ V3 life history
```

**T1 and F1 are independent** and can be built in either order; everything else
follows the arrows. **T1 → T2 → T3** is a complete, shippable deliverable on its
own (features 1 and 2), and **F1 → F2** is a complete one for feature 3.

⚠ **The reasonable place to stop, if this is not finished, is after T3.** That
leaves the world with trees, a leopard that keeps its kills, and no flight —
which is coherent. The one combination to avoid stopping at is **F2 without
V3**: flight without its counterweight leaves the world's most numerous animal
strictly improved, and the vulture population has doubled once already this year
without anyone intending it.

**Effort, in the units this project actually costs:** T1 and F1 are each a
day-scale mechanical change plus a gate; T2 is the one with the protocol and
save bumps; T3 is the only phase that adds an action and is the most likely to
need a second attempt; F2 and V3 are config edits with expensive gates attached.
Per §20: **budget a failed ten-seed gate per net-new mechanism**, which here
means three, not one.
