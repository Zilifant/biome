# Plan — trees, vertical refuge, flight, and the vulture

**Status: T1, T2, T3, F1 and F2 are SHIPPED** (2026-08-03 and 2026-08-04). Trees
are terrain, the leopard climbs and caches kills, flight is a pace on the intent,
and the vulture flies. **V1 (roosting), V2 (the discovery network) and V3 (the slow
life history) are not built.** Each phase carries an "As built" section recording
what the plan got wrong; those are the parts worth reading.

⚠ **Stopping here is one of the two combinations §9 warns against.** F2 has shipped
without V3, its counterweight — see §9, and note that the counterweight the vulture
actually got was the **ground perception radius drop** built into F2 itself, which
is why the gate held. V3 remains the honest next step if the bird is ever found to
be too strong.

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

### Phase T3 — the leopard in the tree ✅ **SHIPPED 2026-08-03**

**As built.** The `cache` action and the habitat weight shipped as planned; the
`flee`-toward-a-tree heading rule was **dropped on evidence** and one design
error was caught late. Both at the end of the section.

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

#### As built — one mechanism dropped, one design error, one instrument replaced

**The mechanism fires**, which was the open question: `cache` is **0.66–0.97% of
leopard animal-ticks** (~500 firings per 6000 ticks per seed), against `patrol`'s
0–1 per 3000 that made A34 an action item. It is not near-inert, and the fallback
(`cacheInPlace`) was not needed.

**Measured 2026-08-03, 3 seeds × 6000 ticks, caching on against off** — of the
meat off carcasses a leopard killed, who ate it:

| | leopard | hyena | vulture | lion |
| --- | ---: | ---: | ---: | ---: |
| caching **on** | **65.5%** | 12.6% | 9.4% | 12.4% |
| off | 62.6% | 15.3% | 11.3% | 10.8% |

**+2.9 points to the leopard, taken from the hyena and the vulture.** Modest, and
the reason is structural rather than tunable: only **26% of leopard kills get
cached** (49 of 189), because a tree has to be within `cacheHaulDistance` and
trees are 2.45% of the map. The same ceiling A57 and the ambush both hit.

1. ⚠⚠ **The plan's own instrument could not see the claim, and the first
   measurement read backwards.** §6 proposed "carcasses lost to a stronger
   scavenger", which in this engine means the `entity.robbed` event — and that
   event needs a **holder**. A leopard hauling a kill is not *feeding*, so it
   holds nothing, so the theft that matters most emits no event at all. Measured
   that way, caching looked like it made things **worse** (31.7% of kills stolen
   against 23.1%). The honest instrument attributes every mouthful taken off a
   leopard-killed body by species, which `entity.fed` supports because it carries
   `carcassId`. ⚠ The lesson is older than this phase: *an event is a record of a
   mechanism firing, not of the thing the mechanism is about.*

2. ⚠⚠ **The mechanism was nearly shipped unmeasurable.** `cacheWeight` went into
   the leopard's `behavior` **block** — and a species block *beats* the config,
   so `--set=behavior.cacheWeight=0` would have been overridden by the leopard's
   own 1.2 and the "off" arm would have measured the mechanism against itself.
   That is precisely the trap DOCS §8 records from phase 8, and it was caught
   only when the control arm was built — the mechanism was already firing in the
   demo. Fixed with `config.climbing.caching`, a world-level switch beside the
   axis switch, which also lets the two halves of vertical refuge be measured
   apart. ⚠ A related hole in T2 fell out of the same check: `#haul` hoisted
   carcasses into the canopy even with `climbing.enabled: false`, so the axis's
   own off switch did not fully switch it off.

3. ⚠ **The `flee`-toward-a-tree heading rule was dropped rather than built**, and
   the reason is one the plan could have caught: `flee` fires from a perceived
   threat or a conspecific's alarm, and **nothing hunts a leopard** — no species
   lists it in `preySpeciesIds` — so the rule would have been *provably*
   unreachable. Building it would have been A34's shape shipped knowingly. The
   same argument demotes the resting half of the phase to fidelity: a leopard
   asleep in a tree is out of reach of something that was never coming.

**The ten-seed gate passes**, and it says something the 3-seed probe did not:
_2026-08-03, 10 seeds × 15 000 ticks, `climbing.caching` on against off._

| | on | off |
| --- | ---: | ---: |
| leopard's share of all carrion taken | **18.2%** (36 074 kg) | 16.3% (33 309 kg) |
| hyena's share | **8.1%** (16 004 kg) | 10.5% (21 437 kg) |
| hyena starvation deaths | **21** | 10 |
| hyena mean population | **6.8** | 8.6 |
| leopard mean population | 13.8 | 13.4 |

⚠⚠ **The leopard barely grows and the hyena pays for the whole mechanism**, and
that is the finding rather than a side effect. Caching moves carrion off the
clan and onto the cat — exactly as designed — but the leopard was not
carrion-limited, so +2.8 tonnes buys it +0.4 animals; the hyena *was*, so −5.4
tonnes doubles its starvation deaths (10 → 21) and costs it a fifth of its
numbers. The chain is fully attributable end to end, which is rarer here than a
large effect. ⚠ The hyena is the species to watch if this is tuned further: it
holds 9/10 seeds in **both** arms, so it did not fail the gate, but it is now
losing a seed with less margin than before.

**Also fixed, from the sprite-mode review:** neither renderer read `elevation`,
so a treed leopard and a cached kill drew identically to grounded ones — the
phase's whole visible result was invisible, against the "a renderer cannot show
what it cannot see" argument v31 was justified by. Added as one `aloft` entry in
`STATUS_APPEARANCE`, which both renderers consume; `statusesOf` gained a narrow
`remains` flag so a **carcass** can carry that one mark and no other (its
`healthFraction` is 0, so every other status would light up on a corpse).

---

### Phase F1 — the flight mode, declared by nobody ✅ **SHIPPED 2026-08-04**

**As built.** Everything below shipped as planned. The four things worth reading
next time are at the end of the section: three test invariants that flight
*narrowed* rather than broke, and one duplicate the renderer had been carrying by
hand.

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

#### As built — four things worth reading

**Inertness held exactly.** Seeds 1/2/42 × 1500 ticks against a clean HEAD
checkout, hashing each top-level key of the save separately: **every
behaviour-bearing key identical** — entities (with the new field stripped),
terrain, vegetation, features, scent, events, disturbances, groups, tombstones,
environment, metrics history. The only two that differ are `formatVersion`
(30 → 31) and `config` (the new `flight` section), which is the same signature T2
left. Protocol **v32**, save **v31**.

⚠ **Hash each key separately rather than the whole save.** The first run compared
one hash of everything and reported a mismatch that was the *format version* — an
inertness proof that says "something differs" and cannot say what is a proof of
nothing. Per-key hashes name the culprit in one line and still never build a diff
(§2.6).

1. ⚠⚠ **Three suites asserted an invariant flight *narrows*, and narrowing it is
   the finding.** `test/movement.test.js`, `test/terrain.test.js` and
   `test/roundness.test.js` each claimed **"no animal is ever on an impassable
   cell"** — and a flying animal crosses rock and open water, because that is what
   "nothing refuses its step" means. The invariant that survives is the one
   movement actually depends on: **a grounded animal is on passable ground.** The
   movement suite now asserts it in the *strong* direction — an animal on an
   impassable cell must be flying — which catches both the old failure (a walker
   escaping into rock) and the new one (a bird landing in a lake) that
   `flyingFor`'s impassable clause exists to prevent. ⚠ Note this is **not** the
   "expect two or three suites to break per phase" trajectory churn §2.9 predicts:
   nothing moved, three claims were simply now too strong.

2. ⚠ **A step-ceiling test had to read the flag *after* the step.** `flying` is
   written by the decision system in the same tick, ahead of movement, so the
   pre-step value is last tick's and a bird taking off breached a bound computed
   from it. The one-tick offset §3.3 records for *perception* has a mirror image
   here, and it is the reason the bound is resolved per animal from
   `flightSpeedMultiplier` rather than restated as a number.

3. ⚠⚠ **The renderer was carrying two hand-kept copies of the status mark, and
   the third shape is what would have made that a silent bug.**
   `SpriteGridRenderer#drawStatusMark` was a copy of the ASCII one with the
   comment *"kept identical … since the marks are the shared status language"* —
   which is D11's shape written down and left in place. A `chevron` added to one
   copy and not the other draws a diamond in sprite mode and a chevron in ASCII
   mode with nothing failing. Now one exported `paintStatusMark`, two callers,
   colour still each renderer's own.

4. ⚠ **A test set the action weights in the wrong place and bent a knob it was not
   holding.** `DecisionSystem` reads `species.behavior ?? this`, so
   `new DecisionSystem({ restBias: 10 })` is only the fallback for an *unknown*
   species — a declared one keeps the config's value. The bird wandered when the
   test wanted it to perch, which is DOCS §8 in miniature and the same trap phase
   8 and phase T3 each paid for once. The weights go in `config.behavior`.

**One oddity the landing invariant leaves behind, measured rather than waved
away.** A stationary action produces a non-moving intent, so an animal held
airborne over water or rock can be *motionless in the air* until it next chooses to
travel. Measured on the demo (seeds 1 and 42, 3000 ticks): **0.02–0.05% of airborne
animal-ticks, runs of at most 4–5 ticks**, and the actions are `drink` and `eat` —
a bird at a lake edge whose own cell is the water it is drinking from. Left alone
on those numbers; it is also self-limiting, since hunger and thirst rise and every
action they favour travels. ⚠ Recorded because the obvious "fix" is a special case
in the movement system, and a special case that buys 0.03% is how a mechanism stops
being four predicates.

**No benchmark movement is expected or claimed at F1**, because nothing new is
read: `entity.flying` is `false` for every animal in a roster that declares no
flier, and every added predicate short-circuits on it. The measurement that
matters is F2's, where a radius actually moves.

---

### Phase F2 — the vulture flies ✅ **SHIPPED 2026-08-04**

**As built.** The species edit is what the plan asked for. Three findings are at
the end: the plan's loud prediction did not happen, the plan's proposed instrument
measured the wrong thing (again), and the classification of five actions had to be
corrected on evidence.

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

#### As built — the numbers, and three findings

**Shipped at** `speedMultiplier: 1.5`, `visionMultiplier: 1.55`,
`moveCostFactor: 0.6`, with `perception.radius` **14 → 9**. So a flying vulture
travels at 2.25 units/tick (the fastest thing in the world while travelling, back
to ordinary the moment it lands), sees 13.95 — *the radius it always had* — and
pays 0.6 of the walking cost per unit crossed. A **grounded** vulture now sees 9
rather than 14, which is the real cost of the edit and the honest reading of a bird
with its head down at a carcass.

**Measured 2026-08-04, 3 seeds × 6000 ticks, flight on against off** (both arms at
radius 9, so this attributes the *mechanism* and not the radius drop):

| | on | off |
| --- | ---: | ---: |
| vulture animal-ticks airborne | **76.3%** | 0% |
| ground↔air transitions per 1000 animal-ticks | **52.4** | 0 |
| distance per vulture per 1000 ticks | **2052.6** | 1332.0 |
| ticks from a carcass appearing to its first **vulture** | **332.9** | 399.5 |
| ticks from a carcass appearing to its first feeder of any species | 193.9 | 192.3 |
| living vultures at t6000 (mean) | **48** | 33 |

**+54% distance covered and −17% time to the first vulture at a body**, which is
the claim §6 asked for, stated as a difference against its own control.

**The ten-seed gate passes**, and the interesting column is not the vulture's.
_2026-08-04, 10 seeds × 15 000 ticks, `flight.enabled` on against off:_

| | on | off |
| --- | ---: | ---: |
| vulture mean | **295.4** (10/10 seeds) | 272.4 (10/10) |
| vulture share of all carrion | **35.6%** (68 605 kg) | 33.2% (58 723 kg) |
| hyena mean | **6.4** (10/10) | 7.8 (10/10) |
| hyena share of all carrion | **9.6%** (18 514 kg) | 11.1% (19 617 kg) |
| leopard mean | 16.2 (10/10) | 12.4 (10/10) |
| lion mean | 16.1 | 13.9 |
| gazelle mean | 57.4 (9/10) | 56.5 (9/10) |
| extinctions | 1 (gazelle, seed 1, t13606) | 1 (gazelle, seed 1, t13644) |

⚠⚠ **The vulture gains 8.4% and the hyena pays for it — again.** The plan
predicted "a real chance of the gate failing on the hyena rather than on the
vulture", and the direction is exactly right even though the gate held at 10/10 in
both arms: the clan's carrion share falls 11.1% → 9.6% and its mean population
7.8 → 6.4 (**−18%**). That is the **second** mechanism in two days to take carrion
off the same species (**A73** is the first, from T3), and the two are additive in a
way neither gate can see on its own. ⚠ The hyena is now the species to check
before V2 — whose entire purpose is to get vultures to carcasses faster.

⚠ **The leopard's +3.8 is not claimed as an effect.** Its range is 3–31 against the
control's 5–18 on ten seeds, its carrion *mass* moves +408 kg on 36 tonnes, and
nothing in the mechanism reaches it. Recorded as observed rather than explained,
which is what D14 asks for when a number moves inside its own spread.

**And the radius drop, separately** (3 seeds × 6000 ticks, this tree against a
clean HEAD checkout — ⚠ a cross-tree comparison, which is legitimate for
populations because they are deterministic, and would not be for timings):
the vulture's share of all carrion goes **10.8% (HEAD, radius 14) → 9.4% (radius 9,
no flight) → 12.4% (radius 9, flying)**. So the narrower ground radius costs it
~1.4 points and flight gives back ~3.0. ⚠ **`--set` cannot control this**, because
`perception.radius` is a species *block* field and a species block beats the config
(DOCS §8) — the only honest control is a second tree, which is worth knowing before
planning a measurement that assumes otherwise.

1. ⚠⚠ **The plan's loud prediction did not happen, and the reason is the
   counterweight was built into the edit.** §4 predicted "the largest ecological
   change in the plan… a real chance of the gate failing on the hyena rather than
   on the vulture", on the grounds that flight makes the world's most numerous
   animal faster, wider-seeing and cheaper at once. It does not: it makes it
   **narrower-seeing on the ground** in exchange, and the ground is where it eats,
   drinks, courts and rests. The perf mitigation §3.3 proposed for the *sight
   radius* turned out to be an ecological brake as well, which is the opposite of
   the usual direction — a performance concession that paid for the ecology.

2. ⚠⚠ **The plan's proposed instrument measured someone else, exactly as T3's
   did.** §6 asks for "ticks from carcass creation to first feeder", and that number
   is **flat** (193.9 against 192.3) — because the first feeder at a carcass is
   usually the animal that killed it, so the instrument mostly reports predator
   behaviour and flight cannot move it. The number that moves is time to the first
   **vulture**. This is the second time in two days that a phase's stated
   measurement had to be narrowed to the species the mechanism is about; the
   transferable form is: **name the animal in the metric, not just the event.**

3. ⚠⚠ **The benchmark could not resolve the cost at the demo's roster and resolved
   it instantly at the affected species', which is D24's rule paying off.** Flight's
   only per-tick cost is the widened perception radius, and §3.3 predicted it would
   be the performance risk of the whole plan. In-process A/B, `flight.enabled` on
   against off, several interleaved rounds each:

   | scenario | rounds | verdict |
   | --- | --- | --- |
   | large-5k (founding ratio, vultures 4.2%) | −1.2%, +6.2%, −19.7%, −19.7%, +16.8%, +5.0%, −15.4% | **mixed — no effect resolvable**, ±20% spread on the day |
   | demo-default, 2000 ticks | −9.0%, −17.8%, −11.2%, +8.2% | **mixed — no effect resolvable** |
   | **vultures-only** (4000 birds, nothing else) | **+23.4%, +43.7%, +51.8%, +76.9%** | **a real cost, every round** |

   The isolated number is the honest one about the *mechanism*: the cell scan is
   (2r+1)², so 9 → 13.95 is 2.25× the scan, paid on ~76% of a flier's ticks. At
   4.2% of the roster that is ~2% of a tick, which this machine cannot see inside a
   ±20% spread; at 100% of the roster it is unmistakable. ⚠⚠ **And the demo is
   nearer the second case than the first, which is the non-obvious part:** the
   vulture is 4.2% of the *founding* roster and **~60% of the living population by
   t15 000** (295 of ~494), so the benchmark scenarios — which are founding ratios —
   systematically understate flight's steady-state cost in the world people actually
   watch. ⚠ A cross-tree re-baseline of `npm run benchmark` was **declined** rather
   than skipped: T1's as-built section established that a cross-tree benchmark cannot
   separate "the code costs something" from "the world contains something", and here
   the world's composition is precisely what differs.

4. ⚠⚠ **Five actions were classified wrong, and the flicker measurement is what
   caught it.** §3.3 predicted a wander commitment would carry the flight state and
   named `flight.takeoffCost` as the lever if transitions were high. They were —
   **289 per 1000 animal-ticks**, a transition every third tick — and the cause was
   not missing takeoff economics: the transitions were almost entirely `herd`
   (grounded) against `wander` (flying), the two lowest-utility discretionary
   actions, which trade places tick by tick for a bird drifting near its own kind.
   The *action* is re-chosen every tick even when the heading is committed. `herd`,
   `retreat`, `leaveThicket`, `followParent` and `tend` are all directed travel by
   the plan's own stated criterion and were simply missing from its enumeration;
   classifying them correctly took the flicker to **52 per 1000** (and airborne
   share from 55% to 76%). ⚠ **The lever the plan named would have masked the
   defect** — charging energy for a transition would have made a misclassification
   look like an energetics problem. Measure the flicker's *action pairs*, not just
   its rate.

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

**As built.** The two phases landed a day apart, so `elevation` and `flying` took a
version each rather than sharing one — which the plan allowed for ("two bumps is
the honest price of two separately-attributable changes and is cheap") and which is
what actually happened.

| | Change | Phase |
| --- | --- | --- |
| `PROTOCOL_VERSION` | 30 → **31** (`elevation`, `trees` in the restart fields, a `tree` legend entry) → **32** (`flying`) | T2 / F1 |
| `SUPPORTED_PROTOCOL_VERSION` | moved with each, ⚠ **in the same commit** (D31) | T2, F1 |
| `SAVE_FORMAT_VERSION` | 29 → **30** (`elevation`, `config.climbing`, the tree terrain params) → **31** (`flying`, `config.flight`) | T2 / F1 |
| Renderer fixtures | regenerated at **T1** (terrain), **T2** (protocol), and **F1/F2** (protocol *and* roster behaviour) | — |
| New protocol tests | `test/protocol-v31.test.js` and `test/protocol-v32.test.js`, both modelled on `protocol-v30` | T2, F1 |
| Bulk snapshot size | +1 small field per entity per bump. ⚠ **They are not equally cheap**: `elevation` changes when an animal climbs a tree, `flying` every time a bird switches between travelling and contact — measured at ~52 transitions per 1000 vulture animal-ticks, so this one genuinely dirties deltas | T2 / F1 |
| `/api/metrics` payload | unchanged — no new species, and P14's diagnosis is that the history is 91% of it | — |
| ⚠ New renderer item | **P17** — a flying animal's status mark blinks, because the state honestly changes every ~22 animal-ticks | F1 |

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

⚠⚠ **As built, two of these rows were the wrong instrument, and the pattern is now
three for three.** T3's "carcasses lost to a stronger scavenger" needed an event
that a hauling leopard never emits. F2's "ticks from carcass creation to first
feeder" is **flat** (193.9 against 192.3), because the first feeder at a body is
usually whatever killed it — the number that moves is time to the first
**vulture** (332.9 against 399.5). And F1's flicker row named a *rate* without
naming what to break it down by, so a 289-per-1000 reading looked like an
energetics problem when it was a misclassification of five actions.

**The transferable form of all three:** an instrument has to name **the animal and
the mechanism**, not the event. "Time to first feeder" is a fact about carcasses;
"time to the first vulture at a carcass" is a fact about vultures, and only one of
those is what flight is for.

---

## 7. Tests

**New suites:** `test/trees.test.js` (generation shape, the four table entries,
`trees: 0` inertness) · `test/elevation.test.js` (the predation gate, the
possession gate, ascent/descent, and ⚠ an explicit assertion that **mate
candidates and guardians are unaffected** — the A63 regression test this plan
owes) · `test/flight.test.js` (the pace predicate, terrain independence, the
landing invariant, zero draws) · `test/caching.test.js` (haul, elevate, refuse a
non-climber) · `test/protocol-v31.test.js` · `test/protocol-v32.test.js`.

**As built, `test/flight.test.js` is 16 tests in four groups** — the predicate, the
four effects, what it gates and must not (including the A63 guard, which flight
owes for the same reason elevation did), and the decision system's ownership of the
flag. Two assertions there are about the *shape* of the mechanism rather than its
behaviour and are the ones worth keeping: that `flight` is **absent from
`SPECIES_BLOCKS`** (a block would let a species override the off switch), and that a
world of fliers consumes exactly the decision stream a world of walkers does.

**Existing suites that will move, predicted so a break is not read as a
regression:** `test/habitat.test.js` (a third time — trees are new contested
ground) · `test/terrain.test.js` (a new code, and connectivity over it) ·
`test/perception.test.js` and `test/concealment.test.js` (a new concealing
terrain) · `test/weather.test.js` (a new sheltering terrain) ·
`test/renderer-view.test.js` and `test/presets.test.js` (a new composition
field) · `test/persistence.test.js` (the save bump).

⚠ **The F1 list was different from any of that, and predicting it would have been
possible.** Three suites moved — `test/movement.test.js`, `test/terrain.test.js`,
`test/roundness.test.js` — and all three for **one reason**: each asserted "no
animal is ever on an impassable cell", which flight narrows to "no *grounded*
animal is". None of them is trajectory churn; each was a claim that had quietly
become too strong. The transferable form: **a mechanism that removes a constraint
invalidates every test that asserted the constraint universally**, and those tests
are findable by grepping for the constraint rather than by running the suite.
`test/renderer-view.test.js` also moved, for the third status shape.

**Invariants that must keep passing untouched:** the species-name source scan
(nothing here may branch on a species id — `climbs`, `flight` and `scavenging`
are all data), `test/determinism.test.js`, and
`test/renderer-boundaries.test.js`. ✅ All three held across F1 and F2.

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
| **B7 — `carcass.decayTicks` is mass-blind** | **Pressure increases.** F2 makes the animal that lives on that constant faster and cheaper to run — though not wider-seeing on the ground, which is the part the plan did not foresee |
| **New: an elevation flag is not an elevation coordinate** | ✅ **Opened 2026-08-04 as A74**, widened to cover both flags: no ambush from above, no extra sight from height beyond a flat multiplier, no cliff or slope or per-cell microclimate (also A24's blocker), no thermals or altitude bands, and no vertical distance anywhere. Five honest consequences of the two flags, recorded so the next person reaching for one knows it is a **dimension** rather than a field |
| **New: A73 — the hyena pays for kill caching** | Opened at T3 and still the species to watch. ⚠ F2 does *not* add to it (the hyena's carrion share moves 17.0% → 15.1% on 3 seeds, well inside its own range), but **V2 would take from the same clan**, and that is the item to re-read before building it |
| **New: P17 — the flying status mark blinks** | Opened 2026-08-04 (renderer). A flier alternates ground/air roughly every 22 animal-ticks, so the mark honestly follows. Renderer-side unfixable; the engine lever is `flight.takeoffCost`, deliberately unbuilt |

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

✅ **As built: T1 → T2 → T3 → F1 → F2, and the run stopped at exactly the
combination the paragraph above warns against.** The warning turned out to rest on
a premise that F2 falsified: flight does **not** leave the vulture strictly
improved, because the mitigation §3.3 proposed for the *perception cost* — drop the
ground radius so that flying restores the old one — is also an ecological brake. A
grounded vulture now sees 9 where it saw 14, and the ground is where it eats,
drinks, courts and rests. Measured, the mechanism buys it +3.0 points of carrion
share and the radius drop costs it 1.4, so the net against the pre-F2 world is
about **+1.6 points**, not a doubling.

⚠ **That is a reprieve, not a refutation.** V3 remains the honest next step, and the
argument for it is unchanged: the vulture is fed by a mass-blind
`carcass.decayTicks` (**B7**), it doubled once this year without anyone intending
it, and a boom-and-bust breeder is the opposite of the animal `vulture.md`
describes. What F2 establishes is that the counterweight is not *urgent*, which is
a different claim from not being needed. ⚠ **V1 and V2 are the phases to be careful
with from here** — V2 in particular takes carrion off the same hyena clan that
A73 records already paying for T3.

**Effort, in the units this project actually costs:** T1 and F1 are each a
day-scale mechanical change plus a gate; T2 is the one with the protocol and
save bumps; T3 is the only phase that adds an action and is the most likely to
need a second attempt; F2 and V3 are config edits with expensive gates attached.
Per §20: **budget a failed ten-seed gate per net-new mechanism**, which here
means three, not one.

✅ **As built, the estimate held except in one place: F2 is a config edit whose
gate had to be run twice**, and not because it failed. The flicker measurement
found five misclassified actions *after* the first gate was already running, and a
behaviour change invalidates a gate in progress — so the run was stopped and
restarted rather than reported. The transferable lesson is about ordering rather
than effort: **take the cheap behavioural measurements before starting the
twenty-minute gate, not beside it.** §6's "cheap first, gate second" says exactly
this and was followed for the *populations* (a 3-seed sweep ran first); the flicker
number was not on that list and should have been.
