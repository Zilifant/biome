# biome — Action items

Everything currently open across the engine and the renderer.

**This is a list, not a plan.** Items are grouped by area purely so the list is
navigable; the grouping and the order within it carry no priority, sequence, or
recommendation. The `⚠` markers are inherited from the source docs, where they
mean "this is a defect or a trap" rather than "this is urgent".

Each item keeps the identifier it has in the source docs, so cross-references in
code comments and git history keep resolving. Fuller reasoning, evidence, and
measurements for the engine items are in [`DOCS.md`](DOCS.md) §1; for the
renderer items, in [`src/renderer/DOCS-RENDERER.md`](src/renderer/DOCS-RENDERER.md)
§1. ⚠ **This file and those two §1 sections must be updated together** — closing
an item, or opening one, means editing both.

**Not on this list:** items that were considered and **settled** (a decision not
to build something, taken deliberately), and items already **closed**. Those are
recorded in `DOCS.md` §1.3 / §1.6 and `src/renderer/DOCS-RENDERER.md` §1.5 so
they are not re-opened by accident.

---

## Engine — known defects

- **⚠ A31 — The selection sandbox has never demonstrated its claim.** An unmet
  acceptance criterion. Over seven seeds the trait rose in 3 and fell in 4 (mean
  change −0.0002), with the selection differential negative in five and its sign
  uncorrelated with the trait's direction. Cause: the differential compares
  breeders against _all_ adults, and 71% of adults are breeders in that world.
  Tightening the breeding gate makes it visible but drives the population
  extinct. Closing it means building a world that demonstrates selection, not
  tuning the existing one.

- **⚠ A101 — A dry map may still open a cell the wet map closes; only the symptom
  is fixed** _(opened 2026-08-10, found by `npm run ethologist` during
  SEASON-PLAN D9)_. `#buildDryMap` turns the lake's impassable `LAKE_CORE` into
  shallow drinkable `WATER` for the dry season — the feature — so animals walk in
  to drink, and the returning wet season restores `DEEP_WATER` over them.
  `stepRefused` gates on the destination, so there is no way out: the animal stands
  still for the ~2000 ticks to the next dry season or starves in the lake. Measured,
  2 seeds × 8000 ticks: **30 and 39** animals caught at one turn, **24 and 20** dead
  before the map let go (21 and 18 by starvation), held a mean of ~1490 ticks;
  **82%/81%** of every immobile run over 200 ticks. On seed 3 that is **14–17 of the
  seed's 17 wildebeest starvations**. ✅ **Symptom closed the same day** —
  `evictStranded` (`src/simulation/world/stranding.js`), called by `WeatherSystem`
  on a season turn, moves stranded animals to the nearest passable cell with room
  under `locomotion.maxOccupantsPerCell`; after, **0 and 0** caught and long
  immobile runs **60 → 12** and **72 → 13**. ⬜ **Open is the structural half:** a
  dry map must never make an impassable cell passable. Keep the core deep all year
  and shrink the lake's shallow **ring** instead, the way `dryPondAreaScale` already
  shrinks a pond. See DOCS §1.1 A101 and D60.

- **⚠ A102 — The hyena starves in front of a full prey base, and
  `behavior.minHungerToHunt` is the number that does it** _(opened 2026-08-10, found
  by `npm run ethologist` during SEASON-PLAN D9)_. Starvation is **77–94% of every
  hyena death** across five seeds, against 0–2 for the lion. Prey is in perception
  on **13.8–16.5%** of hyena-ticks and its own hunger gate is shut on **84.6–90.6%**
  of those; the post-attempt cooldown accounts for 3.1–4.5% and `minHuntStamina` for
  0.1–0.4%, so neither is the constraint. A hyena that starves saw prey for 248–366
  ticks of a ~2200-tick life and had the gate open for **42–68**. The arithmetic: at
  `minHungerToHunt: 0.75` on `maxEnergy: 130` it is first allowed to hunt with
  **32.5** energy left, against the lion's **209** at 0.45 on 380 — roughly **280
  ticks of runway against ~800**. ⚠ The stated reason for 0.75 (0.35 drove gazelle
  extinct in 7 of 10 seeds) may no longer hold: the gazelle is collapsing anyway,
  30 → 7–13 on three of five seeds, with **zero** starvation and 33 predation deaths
  on seed 1. ⛔ **No control arm was run**, so that is a hypothesis. See DOCS §1.1
  A102.

- **⚠ A66 — Obstacle deflection leaves a residual, and its ecological effect is
  not established.** Three things left open by the A65 fix (DOCS §1.1). (1) Seven
  animals at `rocks=6 thickets=8` are still pinned for 50+ ticks (longest 114,
  against 964 before), all of them wedged in the corner between the west map edge
  and rock — the *wide concave pocket* limit `escapeHeading` already documents,
  where local room probing cannot tell a way out from a diagonal that merely
  stays clear within the horizon. (2) Crowding is now the dominant refusal, 79.2%
  of a much smaller number; the cheapest correction is letting acute need suspend
  the cap, the shape `needOverridesTerritory` already has. (3) ✅ The ten-seed
  gate **passed** on 2026-08-01 — every species alive, buffalo +16.8, wildebeest
  +7.6, zebra +7.5, leopard +2.7, and extinction events 3 → 2 — with the gazelle
  (−19.2) and vulture (−73.1) falling because fewer stalled animals means fewer
  carcasses. ⚠ The one residual question is the gazelle's 9/10: seed 7 loses it
  where the control keeps it, and the carcass-supply story does not explain that
  one.

- **⚠ A71 — An animal that has never seen water has almost no way to find it.**
  ⚠⚠ **Improved on 2026-08-06, and explicitly _not_ closed.** The second of the
  three levers is in: the drift now reaches a wander **already under way**
  (`migration.holdBiasScale`, 0 = reproducible control). This was A65's shape and
  it is why the lever was named above raising `waterBiasWeight` — the cue was never
  weak, it was *unread*. A wander commitment lasts 8–24 ticks and the drift was
  blended on exactly one of them, so a cue documented as "0.5 × thirst,
  continuously" was applied **once per commitment**. Against a lake covering ~1.5%
  of the map, that is not a cue.

  ✅ Measured, 3 seeds × 6000 ticks: the "NEVER perceived water" class falls
  **25 → 20** and the close-water class **3 → 1**; total living across the three
  seeds 1988 → 2027.

  ⬜ **It is a 20% dent, not a fix, and the reason it cannot become one is now
  measured.** A working water cue *concentrates* thirsty animals on the lake, and a
  lake whose shore `locomotion.maxOccupantsPerCell` cannot admit kills more than
  the cue saves. Dehydration deaths / final population by seed, where seed 1's lake
  is **65 cells** and seeds 2–3 are 1824 and 2364:

  | `holdBiasScale` | seed 1 | seed 2 | seed 3 |
  | --- | --- | --- | --- |
  | 0 | 136 / 535 | 11 / 723 | 7 / 730 |
  | 0.15 | 150 / 519 | 6 / 743 | 2 / 765 |
  | 0.35 | 171 / 450 | 2 / 770 | 4 / 802 |

  Monotone in **both directions at once**: the harder the cue pulls, the better the
  big-lake worlds do and the worse the puddle world does. 0.15 ships because it
  takes nearly all the gain for a third of the cost. ⚠⚠ **This bounds lever 1 as
  well** — `waterBiasWeight` buys the same trade — so the remaining levers are the
  third one (a directed thirst action driven by `world.nearestWater`, which costs
  an entry in the utility table) or making the shore itself admit more animals.
  Past some point, more cue stops meaning "find the water" and starts meaning
  "queue for it".
  With A65 and A67 closed this is the single largest finding in the ethologist's
  sweep: "died of thirst having NEVER perceived water", roaming the whole map,
  dying on the arithmetic clock (~3057 ticks for a gazelle). Dehydration is still
  the leading cause of death in all six worlds. C4 in a form memory cannot close —
  memory needs the animal to have drunk somewhere once, and these never did.
  `migration.tracksWater` only bends a *freshly committed* wander heading at
  ≤ 0.5 × thirst, so it is a nudge on a random walk against a lake covering ~1.5%
  of the map. Levers in DOCS §1.1 A71.

- **A70 — Extinction events rose 2 → 3 in the exposure gate** _(from 2026-08-01,
  A67)_. The ten-seed gate for the thermoregulation change passes on every
  species and improves seven of eight mean populations, but the arm loses the
  gazelle on seed 1 (t14069), the leopard on seed 2 (t13131) and the hyena on
  seed 8 (t14690) against the control's two losses. All three are in the last
  tenth of the run and every species clears the ≥6/10 gate, so this is a
  judgement recorded rather than a failure — but it is the one column that moved
  against the change, and three late single-seed losses in a world with more
  animals in it is worth a second look before it is called noise.

- **A73 — Kill caching moved carrion off the hyena, and the hyena is the species
  to watch** _(from 2026-08-03, phase T3)_. The mechanism works and its whole
  chain is attributable: a leopard hoists ~26% of its kills into a tree, its
  share of all carrion goes 16.3% → 18.2%, the hyena's goes 10.5% → 8.1%, hyena
  **starvation deaths double (10 → 21)** and its mean population falls 8.6 → 6.8
  (−21%). The leopard, not being carrion-limited, gains +0.4 animals for +2.8
  tonnes. ⚠ Not a gate failure — the hyena holds 9/10 seeds in **both** arms —
  but it is the one species the change costs, and it now loses its seed with less
  margin. Worth a second look before anything else is taken off the clan (B7's
  `carcass.decayTicks` and the discovery network, now **A77**, both would).
  ⚠⚠ **Something else already was, one day later.** The vulture's flight (phase F2,
  2026-08-04) takes the clan's carrion share 11.1% → 9.6% and its mean population
  7.8 → 6.4 (**−18%**) on the ten-seed gate. That gate passes at 10/10 in both arms,
  so it is not a failure either — but **two mechanisms in two days have now moved
  carrion off the hyena, and no single gate sees the pair.** This is the item to
  re-read before **A77**, whose whole purpose is getting vultures to bodies faster.
  ⚠ **V1 then went the other way and that does not settle it**: the clan recovers to
  8.4 (from 6.4) while the **lion** loses 16.1 → 12.7 and the vulture gains 41%
  (**A76**). So the guild's carrion is being reshuffled by three consecutive phases,
  each measured only against its own control, and which species ends up short depends
  on which pair you compare. The generalisation is the item, not the hyena: **a
  species can sit inside every individual gate and outside the sum of them.**

- **⚠⚠ A76 — V1 moved the vulture +41% and the lion −21%, and which of its three
  lines did it is not established** _(opened 2026-08-04, phase V1)_. The ten-seed
  gate passes — every species 10/10 except the gazelle at 9/10 in **both** arms,
  losing the same seed at the same tick — but a phase expected to do almost nothing
  took the vulture's mean from **295.4 → 416.0** and its share of all carrion from
  **35.6% → 45.0%**, with the lion falling 16.1 → 12.7 and 36.0% → 29.0%. ⚠ The extra
  meat is mostly **new rather than stolen**: the carrion pool grows 193 → 221 tonnes
  and the vulture's +31 t is close to the pool's +28 t, which is a compounding loop —
  more birds, more bird carcasses (2872 deaths against 2079, nearly all of age), more
  carrion — running on **B7**'s mass-blind `carcass.decayTicks`.
  ⚠⚠ **No line is attributable, and both attempts say why.** A 5-seed decomposition at
  6000 ticks reads off 40.8 / `climbs` 39.8 / `cue` 41.6 / both 46.8; re-run at the
  **full 15 000-tick horizon** (3 seeds) it reads off 322.3 / `climbs` 289.3 / `cue`
  310.3 / both 385.7 — with the per-seed ordering arbitrary and **seed 1 reversing the
  sign** (shipped 227 against its own control's 246). The within-arm spread (216–505
  for the control alone) dwarfs every between-arm difference, so the effect is
  **seed-dominated**. What survives is the direction, from two independent samples
  (+20% on 3 seeds, +41% on 10). ⚠ **The next step is per-seed pairs**
  (`sweep --json` carries `seedRecords`), so "how many of the ten seeds moved up" can
  be counted rather than inferred from a mean — D14 at a larger scale. ⚠ No line was
  dropped: removing the habitat cue was the live option, but doing it on the strength
  of an unattributable difference is the tuning-on-noise this item exists to warn
  about. **Until those pairs are counted, V1 makes flight-without-its-counterweight
  worse rather than better** — the combination the retired plan named as the one to
  avoid — so the slow life history (**A78**) is no longer optional. Related: **A73** (three phases now move carrion
  around the same scavenger guild) and **B7**.

- **A74 — The vertical axis is two flags, not a coordinate, and five things are
  therefore inexpressible** _(opened 2026-08-04, phases T2/F1 of the
  [retired trees/flight/vulture plan](legacy-docs/TREES-FLIGHT-VULTURE-PLAN.md), whose
  §8 named the elevation half and never opened it)_. `entity.elevation` (0/1) and
  `entity.flying` (boolean) carry no height, so: **no ambush from above** (a treed
  leopard reaches nothing below it, and nothing hunts on the wing); **no extra
  sight from being up high** beyond a flat per-species multiplier; **no cliff, no
  slope, no per-cell microclimate** (which is also A24's blocker); **no thermals or
  altitude bands**, so a soaring bird and a low glide are the same state; and **no
  vertical distance anywhere** — the spatial index, every `Math.hypot`, and every
  range gate are two-dimensional. All five are honest consequences of the choice
  that made vertical refuge affordable at all (A67 had deferred it, "possibly
  permanently", on the cost of a real axis). Recorded so the next person reaching
  for one knows it is a new dimension rather than a new field. ⚠ **The nearest
  cheap lever is `flight.takeoffCost`**, named but deliberately unbuilt: flight
  currently costs nothing to enter or leave, so a bird alternating between a
  travelling action and a contact one transitions ~52 times per 1000 animal-ticks
  (renderer P17 is what that looks like on screen).

## Engine — implemented, tested, and near-inert

- **⚠⚠ A75 — Roosting is inert by construction: this engine can express a *place*,
  but `vulture.md` asks for a *rest*** _(opened 2026-08-04, phase V1)_. The vulture
  declares `climbs: true` and a `tree` habitat weight, and the cue is **live** — the
  weight resolves, the radius exists, and the gradient points at trees, all
  unit-asserted. ⚠ What cannot be shown is that it changes *where the bird ends up*:
  the tree share moves 2.0% → 2.8%, and a null arm moves it further (see A72). What
  definitely does not happen is the roost: being in the canopy needs a tree cell **and** one of
  `rest`/`shelter`/`hide`/`flee`, and for this species two of the four are
  *structurally impossible* — it declares no `aging.hiddenUntil`, so `hide` does not
  exist for it, and **nothing hunts it**, so `flee` is unreachable (the leopard's
  T3 situation exactly). Of the remaining two, `shelter` measures **0.000%** of its
  animal-ticks and `rest` **0.03–0.11%**. The product is ~1 animal-tick in 100 000,
  measured at **0.000–0.022%**. ⚠ **Both obvious levers are already closed**:
  scaling `rest` by the ground underfoot was declined as born-inert at phase 9
  (DOCS §9 Habitat) and would not help anyway — the problem is that `rest` itself is
  0.1% — and a `roost` **action** would compete with foraging, which is DOCS §9
  Decision's most expensive rule. What would actually close it is a **reason to be
  still**: a diurnal cycle (**A49**) is the honest one, since a roost is a *night*
  behaviour and this world has no night. Recorded rather than repaired.

- **⚠ A72 — The habitat preference's effect on the demo is no longer separable
  from noise** _(from 2026-08-03, phase T1)_. `habitat` resolves correctly and is
  unit-tested from six directions; what cannot be demonstrated any more is that
  it changes **where the demo's animals end up**. That claim has been rewritten
  three times without a single regression behind it — the gazelle's cover share
  (phase 11 reversed it), the buffalo's open-ground share (phase 13 flattened
  it), the grazers' thicket share (exhausted now). ⚠ The third was killed by
  **A65's obstacle deflection**, not by trees: it collapsed thicket occupancy from
  0.25–0.43% to ~0.1% by stopping animals stalling at thicket edges, leaving an
  assertion that passed on HEAD by a hair; trees tipped it over. Two replacements
  were measured and rejected — mean habitat weight underfoot reads the *wrong
  way* on clean HEAD (1.1103 on against 1.1146 off, every seed), and thicket
  share at 6 seeds × 3000 ticks is reversed and noisy (0.041% on / 0.027% off).
  The suite now asserts only that the cue is **live**. ⚠ The pattern is the point:
  every one of those four assertions was a claim about *where a species ends up*,
  which is only a signal while nothing else competes for the same ground. The
  lever is a world built to show it (A31's shape), not a fifth occupancy share.
  ⚠⚠ **The fifth was written anyway, at phase V1 (2026-08-04), and it failed the same
  way — but this time the null control caught it before it was believed.** The
  vulture's `tree` share reads 2.0% → 2.8% with the preference on, which looks like a
  clean +38%; run the three lines separately over 5 seeds and the arm with **no
  steering mechanism in it at all** (`climbs` alone) reads **3.65%** against the
  actual cue's **2.94%** and the control's 2.83%. The null arm beats the mechanism,
  and per seed the ordering is arbitrary. The durable form is what this
  item already recommends: assert the **cue** (the weight resolves, the radius
  exists, the gradient points the right way on the real species) and stop measuring
  occupancy. ⚠ The transferable half is a method: **run the arm that should not be
  able to change the number.**

- **⚠ A34 — Patrolling / site fidelity.** Ramped over six range radii
  (`patrolSpanFactor: 6`) so it never fires during normal foraging, because
  patrol competes with wandering and wandering is how an animal finds its next
  meal. ✅ **The named lever — give it a reason — was tested 2026-07-29 and the
  diagnosis held**: `tend` (a mother returning to a hungry hidden calf) is
  patrol's shape with a reason attached, and it fired **1045–1455 adult-ticks per
  3000** where `patrol` fired **0–1** in the same worlds. Still open, now for a
  sharper reason: `patrol`'s target is a *place* rather than a *purpose*, so
  giving it a den means giving it something at the den to want.

- **✅ A59 — A pride cannot take prey a lone lion would refuse. CLOSED
  2026-08-07** (opened 2026-07-30, phase 10; closed by PREDATOR-PLAN P3). The
  second cooperative ceiling is built, and it needed neither of the two costs this
  item priced it at: `bandmates` — the count `SocialSystem` has published for every
  animal since P7's rally — answers "is help at hand" for free, and eligibility was
  already hoisted once per animal, so the group ceiling resolves in the same place.
  ⚠ **The item was priced against a cost that had stopped existing.** A lone lion
  now refuses an adult buffalo (solo ceiling 3.5 → 1.7) and a pride does not
  (`groupPreyMassRatio: 3.5`); a hyena clan takes an adult wildebeest a single
  hyena cannot. See DOCS §1.1 A59 and PREDATOR-PLAN P3.

- **✅ A60 — Territory is an individual claim, so a social species cannot hold
  ground. CLOSED 2026-08-07** (opened 2026-07-30, phase 11; closed by
  PREDATOR-PLAN P6). It was opened by cooperative hunting measuring **zero
  shared-quarry ticks in 8 000** with the lion at `defends: true`; the same count
  now reads **170** over 2 seeds × 2000 ticks, and the lion holds ground again.
  ⚠ **The claim layer still keys on an entity id** — this item named "keying the
  claim layer on `groupRecordId`" as the fix and that version was built and
  discarded, because a group id stored in `ScentGrid` is a second copy of
  membership that outlives a dissolved record, needs rewriting on every join and
  leave, and is persisted state a save can restore into a world whose groups have
  moved on. What shipped is one derived predicate, `holdsClaim`, shared by the two
  readers so they cannot disagree (D11). ⚠ **Stated limit**: a lost dispute still
  transfers the ground *one animal* marked, so a pride loses a lioness's cells
  rather than the pride's. ⚠ It also un-sharpens **A35**: territory is no longer
  *solitary*-only.

- **⚠ A63 — A perception gate is not a predation gate** (from 2026-07-30, phase
  14). Everything an animal knows about another animal comes through **one** test
  in `PerceptionSystem` — prey, threats, **mate candidates**, a juvenile's
  guardian, territorial rivals. Cover concealment was added there, correctly, and
  the species it was written for is the one it broke: a cryptic **solitary**
  predator stopped finding mates and its population fell **27 → 19**, with the
  hunting half working exactly as designed. Fixed by exempting conspecifics
  (camouflage is against other species), which is right on its own terms — but the
  general hazard stands and has no guard on it. ⚠ **Anything added to that gate
  gates reproduction too**, and the failure looks like a tuning problem rather than
  a plumbing one. The lever, if this bites again, is separating "can I see it" from
  "can I find my own kind"; nothing has needed that yet.

- **⚠ A62 — A calendar mechanism meets the compressed lifespan** (from
  2026-07-30, phase 13). The year is compressed to 8000 ticks and lifespans are
  compressed beside it (PLAN-SPECIES §11.6), each defensible alone; together they
  leave a large animal with **about one year of adult life**, so anything keyed to
  the calendar rather than to the animal's own clock costs a female her whole
  remaining reproductive life when she falls out of phase with it. Measured: a
  wildebeest rut over 0.30 of the year — wide, in life — left the species alive on
  **1 seed in 3** against 3/3 with `breeding.enabled: false`, on a clean
  dose–response (0.30 → 0.3 mean · 0.50 → 6.7 · 0.65 → 10.7 · none → 16.7). It
  ships at 0.65, which is a seasonal restriction rather than a rut. ⚠ The lever is
  `ticksPerYear`, **not** the breeding window: lengthening the year relative to
  lifespan is what makes a narrow window affordable, and it re-bases every seasonal
  measurement in the project.

- **✅ A61 — An association weight only bites in mixed company** (from
  2026-07-30, phase 12; **answered 2026-08-05**, BEHAVIOR-PLAN P3). A species now
  declares a second field, `associationPull`, published as `pullScale` and spent on
  the **distance** an animal tolerates from a mixed centre — not on `herdWeight`,
  where a discount is inert for a bold animal and fires for a timid one. The gazelle
  declares one; the wildebeest declares an association and no pull, which is the
  in-roster control. DOCS §9 Sociality, *Association pull*. The rest of this entry
  is kept because its measurement is why the fix has that shape.
  The weight is an *exchange rate between bodies* in the
  herd's centre of mass, so it decides whose centre wins when both kinds are
  present and cancels out of the mean when only the other kind is: a gazelle alone
  among wildebeest sticks to them exactly as hard as to its own herd. ⚠ The obvious
  fix — scale the herd *pull* by it too — was built first and measured **inert**:
  it charges the animal twice for one fact, and at `herdWeight` 0.6 a second
  discount of 0.5 caps the pull at 0.30 against a `wanderBias` of 0.35, so it can
  never win (a follower held station no better than one with the mechanism off,
  16.1 units either way). The lever is a *separate* pull weight rather than a reuse
  of this one; nothing has asked for it yet.

- **A32 — Juvenile defense fires about once in 12 000 ticks.** ⚠⚠ **All three
  named fixes have now been tried and measured, and all three failed** — territory
  (Step 24), the hidden-fawn stage (2026-07-29), and, at phase 10, relaxing the
  "nearer the predator than I am" test itself (`decision.interposeSlack`, measured
  2026-07-30: `entity.defended` 1/1/0 strict, 0/1/0 at slack 2, **0/1/1 with the
  clause removed entirely**, so the knob ships at its identity). The diagnosis has
  moved off ward selection altogether: predators commit to a **juvenile** in only
  6–9% of hunter-ticks, and in **1–4 of those per 2000 ticks** is a living parent
  within the 6 units it needs to perceive the hunt at all. The remaining levers are
  therefore about *what a predator chooses* and *how far a parent can sense* —
  species biology, to be settled against the buffalo cow in phase 11 rather than
  against the gazelle. `decision.defendTargeted` (a parent defends the calf the
  hunter actually committed to) shipped from this pass on correctness, not on
  measured effect.

- **⚠ A57 — A hidden fawn is concealed only if it was born on cover (~8–10%).**
  The hidden-fawn stage's `hide` half applies to every fawn; the *invisibility*
  half applies only on sheltering ground, and nothing makes a mother choose such
  ground to give birth on — so the concealed fraction (7.6–11.1%) tracks the
  sheltering fraction of the map (7.2–9.9%) almost exactly. Implemented, tested,
  correct, and rarely doing visible work. Named lever: **birth-site selection** (a
  female near term preferring cover), which is a new pull on the existing
  `shelter` action but changes reproduction placement, so it wants its own measured
  step. Also the strongest argument yet for A51 — more cover raises this with no
  behavioural change at all. ⚠ **Phase 9 made it slightly worse, knowingly**: the
  gazelle's new habitat preference is open-plain (`cover: 0.8`), so a mother is
  marginally less likely to be standing on sheltering ground when she gives birth.
  Folding A57 into `habitat` is not the answer — a flat per-terrain weight cannot
  express "a female *near term* prefers cover".

- **✅ A56 — A two-member clan flaps between founding and dissolution. CLOSED
  2026-08-05** (BEHAVIOR-PLAN P5a). A record short of `minMembers` is now held
  `config.groups.dissolveGraceTicks` (300) before dissolving — one field,
  `belowMinSince`, save-format v32. ⚠ **It was far worse than the entry below
  knew**: the 3000-tick measurement missed it almost entirely, because the churn
  arrives with the first wave of deaths around tick 4500. At 9000 ticks the control
  arm has one hyena changing membership **937 times** against 9 with the fix, and
  1168 records destroyed against 18. DOCS §9 has the dose–response; the assertion
  lives in `test/groups.slow.test.js` because it cannot be seen at the 1500-tick
  horizon the rest of the suite uses. The original entry:
  `groups.minMembers: 2` makes a pair a clan and a lone animal not one, so a pair
  that drifts apart dissolves and re-founds on meeting again — measured
  2026-07-29 at **157 foundings against 150 dissolutions in 3000 ticks on seed 2**,
  against 7 and 0 on seed 1. Nothing is corrupted; the identity that "survives
  separation" just survives it only while a second member stays close. The named
  fix is hysteresis (hold a record N ticks below its minimum before dissolving),
  one field on the record, the same shape as `alarmedUntil`. ⚠ Not before batch
  2 — tuning a dissolution delay against the only clan-forming species in the
  world would fit it to a case the mechanism is about to outgrow.

  _(A55, the registry never firing in the demo, **closed 2026-07-29** — the hyena
  declares `groups.forms` and the demo founds real clans, asserted directly in
  `test/groups.test.js` rather than inferred from a survival number.)_

## Engine — behaviour and modelling

- **✅ A84 — A cohesion radius moved without its geometric partner, and it cost two
  species** _(found and closed 2026-08-06)_. `perSpeciesRadius` (P1) widened
  `behavior.herdRadius` 6 → 11 for the wildebeest and the buffalo, which changed
  *who* contributes to the centre of mass. What an animal **does** with that centre
  is `behavior.herdDistance`, and it stayed at the **2.0** chosen for a six-cell
  herd. A disc of radius 2.0 is ~12.6 cells and holds ~25 animals at
  `locomotion.maxOccupantsPerCell: 2`; an aggregation of a hundred inside an
  11-cell radius all steering at one point asks for ~8 bodies per cell.

  **Measured against `main` on the same three seeds × 6000 ticks.** Wildebeest step
  refusals **4.7% → 37.5%**, with **9.3%** of their ticks holding no legal step in
  any direction; buffalo 4.3% → 16.2%; lion 1.5% → 10.5%. Gazelle (3.1 → 3.7) and
  zebra (4.0 → 4.9) were flat — the two species that declare no `herdRadius`, which
  is the dose–response that identified the cause. Mean energy fraction fell 0.77 →
  0.35 (wildebeest) and 0.75 → 0.37 (buffalo); they spent 34.6% and 43.0% of their
  ticks in `seekFood` and starved standing on forage. Populations: wildebeest
  288.7 → 125.0 (**−57%**), buffalo 126.3 → **21.3** (**−83%**), buffalo starvation
  deaths 11 → 168.

  ✅ **The fix is a floor derived from the occupancy cap** —
  `social/herding.js#herdPackingFloor`, `max(declared, slack × sqrt(n / (π c)))`,
  wired through `config.social.herdPackingSlack` (0 is the reproducible control and
  is bit-identical to the pre-fix arithmetic). ⚠ It is derived from
  `maxOccupantsPerCell` rather than being a constant of its own, because a number
  tuned against today's herd sizes is how the original 2.0 broke.
  After: wildebeest refusals **4.0%**, buffalo **3.5%**, lion 1.5%, nobody boxed in; wildebeest
  296.3 and buffalo 94.7.

  ⚠⚠ **The slack is 2, and 1.5 was measured and rejected — do not re-derive it from
  one seed.** Lowering it keeps the herd consensus tidier (below), and on seed 2
  alone it looked free. On three seeds it is plainly worse: buffalo mean **77.3
  against 94.7**, and the **leopard goes extinct on seed 1** (2/3 seeds) where slack
  2 holds it 3/3. D14 again — a herd-size effect measured on one seed is a
  measurement of that seed.

  ⬜ **What stays open, including three failing tests left failing on purpose.**

  1. ✅ **The buffalo residual is explained, and it is not this fix** _(2026-08-06,
     the A82 null arm re-run after the floor landed)_. The buffalo recovers to 94.7
     against `main`'s 126.3 — and with `consensus.enabled=false` it reads **121.0**,
     with starvation deaths falling **52 → 5**. The whole remaining gap is the herd
     consensus (P8), not the packing floor. See **A82**.
  2. The secondary half of the fix — a crowd-locked animal stands still rather than
     re-committing to a heading it cannot take (`DecisionSystem#crowdLocked`) —
     fires on only **0–1%** of blocked ticks even on the broken arm. A correct guard
     whose contribution to the recovery is **not established**; the floor does the
     work. ⚠ Bisected: it is not the cause of any failure below.
  3. ✅ **The three tests this fix broke all pass again, and not because anything
     was weakened** _(2026-08-06, after **A71**)_. They were left failing on purpose
     and were fixed by an unrelated change one item later, which is the part worth
     keeping:
     - `consensus.test.js` "most labels hold one heading" fell to **8 of 22** (36%,
       against a packed-world baseline of 54%) because `HerdConsensusSystem`
       re-decides **per animal** as each commitment lapses, so members spread over
       more ground pooled different cues. That read as a standing cost of the
       slack. It was not: with the A71 drift reaching **held** wander commitments,
       every member feels the same cue between re-decisions instead of holding its
       own stale heading, and coherence is **20 of 27 (74%)** — above the packed
       world it was measured in.
     - `groups.slow.test.js` "the grace period removes most of the membership
       churn" passes for the same reason.
     - `hunting.test.js` "the demo sustains both species" keeps the leopard on
       seed 42 again. ⚠ Still a 2–4 animal population in a species **A81** records
       as persisting on 1/10 seeds, so it remains a single-seed assertion about a
       fragile species (D1/D2/D7) — it is passing, not robust.

     ⚠⚠ **Two mechanisms looked like a trade-off against each other and were both
     downstream of a third that was quietly unread.** The tell, in hindsight: the
     "cost" appeared the moment herds started moving normally. ⚠ **The same horizon
     is what makes the fix urgent** — at t8000 on seed 1 the *pre-fix* arm has
     **buffalo 0 and wildebeest 3**, an extinction the 6000-tick gate never sees.

- **✅ A88 — `circling-in-need` counted `wander` as a search, which is why it never
  became a shortlist** _(found and closed 2026-08-06)_. The detector flagged
  **53–100% of every predator and scavenger in every world** — leopard 3/3, lion
  11/13, hyena 10/13, vulture 10/11 — while flagging ~1% of zebra. The
  2026-07-31 recalibration had added a search-fraction term precisely to stop it
  reading "doing its job in a home range" as "stuck", and then put in that term the
  one action that means an animal has *no* job to do. Share of ticks spent
  wandering: **leopard 94.5%, hyena 73.8%, vulture 64.8%, lion 55.9%** against
  11–14% for the grazers, who are eating, herding and seeking instead.

  ⚠⚠ **The obvious fix was measured first and was wrong**, which is the part worth
  keeping. The hypothesis was that predators are chronically hungrier between
  kills, so `circleNeed` should become a per-species bound rather than a flat 0.4.
  The distribution says otherwise: animal-ticks at need ≥ 0.4 are **vulture 33%,
  lion 39%, hyena 47%** against **buffalo 43%, gazelle 40%** — the guilds are not
  meaningfully different and only the leopard (69%) stands out. A species-relative
  threshold would have discriminated nothing while looking principled. The action
  mix was the whole of it.

  ✅ **Calibrated on both arms**, which is the thing this detector has never had:
  **0 firings across three healthy worlds**, and it still fires on a genuinely
  stuck one (the `herdPackingSlack: 0` arm, where animals really are jammed).
  ⚠ Firing rarely is now acceptable in a way it would not have been before A85 —
  `movement-denied` covers the stuck case directly (154 and 51 firings on that same
  arm), so this detector no longer has to be the only instrument.

- **✅ A89 — `seekMate` did not resolve on arrival** _(found and closed
  2026-08-06)_. The utility scored its full weight whenever a candidate was
  perceived, **at any distance including zero**, so an animal standing on a mate it
  would never be accepted by kept seeking it for life: `seekMate for 120 ticks with
  no progress (dist 0.6→0.0), 193 refused steps`, in every world. ⚠ The seeker
  cannot observe *why* pairing declined — `#eligible`, `contestCooldownTicks` and
  the quality comparison are all invisible from `DecisionSystem` — so the gate is
  the one thing it can observe: whether walking closer is still capable of helping.
  Inside `reproduction.matingRange` it is not, because `ReproductionSystem` already
  sees the pair every tick. Suppressing the *action* leaves the animal in place
  rather than driving it off, so pairing still happens the moment its own gates
  open. `matingRange` is wired from `config.reproduction` rather than restated
  (D11). **0 stalls across three worlds afterwards.**

- **⚠ A92 — Two demo-tier assertions describe the pre-P5 prey partition and now
  fail** _(opened 2026-08-07, PREDATOR-PLAN P5/P8)_. In `test/cooperation.test.js`'s
  **batch 2** block: (1) *"lions and hyenas partition the prey base by mass"*
  asserts a lion never kills a gazelle and now counts **22** — the claim P5 was
  asked to remove ("no artificial partitioning"), so the test is stale rather than
  the engine wrong; (2) *"a buffalo herd stands its ground"* wants ≥3 lion attempts
  resolved against a mob and gets **2** — a sample-size consequence of lions now
  spreading their hunting across four prey species. Both need rewriting to the
  post-P5 world; neither indicates broken behaviour.
  ⚠⚠ **They were invisible for eight consecutive phases** because the fast tier
  skips `demo` and `batch` (**D59**). Do not treat this pair as "known failures to
  live with" — a stale assertion in the block that holds the ecological claims is
  exactly what stops the *next* real regression from being noticed.

- **⚠⚠ A93 — Seed 1 generates a world with almost no water, and it is one of the
  ten sweep seeds** _(opened 2026-08-07, found by `npm run ethologist` during
  PREDATOR-PLAN P8)_. Water cells on `default-small`: **seed 1 has 13** (0.04% of
  passable, and **no deep water at all**) against **712–1085** (2.3–3.5%) on seeds
  2–10 — a 60× deficit. On that world **192 of 247 deaths are dehydration (78%)**
  and the wildebeest finish at **11** against ~155 elsewhere. It is the source of
  the ethologist's "died of thirst having NEVER perceived water" flags.
  ⚠ **Terrain generation, untouched by any recent plan** — but it silently biases
  every ten-seed reading: seed 1 drags every mean down and accounts for one of the
  two gazelle extinctions in the P8 sweep. ⚠ Decide deliberately whether the sweep
  should keep a drought world in its seed set (a legitimate stressor) or whether
  water placement needs a floor; either is defensible, but the reading should not
  keep being taken without knowing. Related: **A86**, **A81**.

- **⚠ A94 — `npm test` does not complete in a sandboxed shell, so the persistence
  and determinism tiers are unverified** _(opened 2026-08-07)_. Two full runs hung
  reproducibly at the same point — after `perception in inspection`, with every
  file alphabetically later never starting — the first for **2h15m** before being
  killed, against a documented full-run time of ~47 min. Excluding
  `test/presets.test.js` (the known port-binding suite) did **not** fix it.
  ⚠ What this leaves unknown after PREDATOR-PLAN: the **persistence** and
  **determinism** tiers have not run against eight phases that touched perception,
  feeding, territory and the decision system. The fast tier is green (1255) and the
  demo tier is green apart from **A92**.
  ⚠ Diagnose before trusting a future "suite green": run the post-`perception`
  files as their own group and find which one never reports.

- **⚠⚠ A91 — The leopard fails the ten-seed gate at 4/10, and the cause is that it
  never meets another leopard** _(opened 2026-08-07, PREDATOR-PLAN P8)_. The first
  §20 sweep of `default-small` (10 seeds × 15 000 ticks) puts seven species over the
  bar and the leopard at **4/10, mean 1.6**. ⚠⚠ **`npm run ethologist` names the
  mechanism and it is not competition**: on one world **3 of 3 leopards** were
  flagged `never-saw-a-mate` — adult for 5232 ticks, roaming x[2..174] y[5..178],
  and never once perceiving a mate candidate. The vulture shows the same anomaly
  once (5 founders). Its deaths are age 34 / starvation 14 out of 50, and it is
  flagged for **no** movement or intent anomaly at all — it is not misbehaving, it
  is alone.
  ⚠ **The lever is the founding count, not a predator mechanism.** Three founders on
  a 230×180 ellipse do not find each other, whatever the hunting rules are. ⚠ The
  ethologist also points at **A63** (crypsis passes through the same perception gate
  as mate-finding), which is the second candidate and the one that would need a
  mechanism rather than a roster edit.
  ⚠⚠ **This sweep cannot attribute the 4/10 to PREDATOR-PLAN**, because
  `default-small` had never been through the §20 gate before it (README says so) —
  there is no pre-plan baseline on this world. For scale, **A81**'s crater reading
  had the leopard at **1/10**. Related: **A81**, **A63**, **A78**.

- **⚠⚠ A87 — The two neighbour walks are not equivalent, and the test that says
  they are has been passing for the wrong reason** _(opened 2026-08-06, found by
  A84; **became deterministic 2026-08-07**, PREDATOR-PLAN P5)_. ⚠⚠ **The seed luck
  has run out.** P5 gave `hunting.cooperationWeight` to the hyena, so ~17 animals
  now reach `adoptedPrey` where 5–8 lions did before, and the byte-identity test
  fails on seed 42 within 400 ticks rather than only at `herdPackingSlack: 1.5`.
  ✅ **The cause is confirmed to be exactly what this item predicted**, and it is
  sharper than "the walks differ": `DecisionSystem#joinedHunt` returns **null** when
  the neighbourhood stamp does not match, so the test's fallback arm never re-walks
  the grid for this consumer — it runs with cooperative joining **switched off**.
  The test was comparing joining against no joining. It now sets
  `cooperation.enabled: false` in **both** arms, so it states what it can prove
  (the walk reuse is a speed change) and no longer implies it has checked
  `adoptedPrey`. ⚠ **Nothing covers `adoptedPrey`'s two walks now**, and closing
  this item means giving `#joinedHunt` a real fallback rather than re-enabling it
  in that test. `social.test.js` asserts that reusing perception's walk gives a
  byte-identical world to re-walking the grid. ⚠ **It passes at the shipped
  `herdPackingSlack: 2` and fails at 1.5**, which is the whole point: the worlds are
  identical through tick 106 and at 107 lion 484 has **`chase: 0.771` in one arm and
  `chase: 0` in the other**, with its perception summary, its social summary and
  every position byte-identical. Nothing about the walk changed between those two
  configurations — only which states the world visits.

  ⚠ **`adoptedPrey` is the only consumer that can do that** — it is the third reader
  of the *raw* neighbour list, it reads `other.action` (mid-tick mutable state
  written by the same decision pass), and its tie-break documents an assumption it
  does not check: "the neighbour walk is in ascending id order", which is true of
  perception's shared list and unverified for a fresh `queryRadius`.

  ⚠⚠ **A84 did not cause this and cannot be blamed for it**: with the floor off, the
  chase utility differs between the arms on **0 of ~400 ticks × ~500 animals**, and
  it is 0 again at the shipped slack. A tuning change to an unrelated utility is
  enough to walk the world into a configuration the latent sensitivity fires on.
  **A determinism guarantee that survives only until somebody re-tunes a weight is
  not a guarantee, and a green test is not evidence that it holds** — D40's null arm
  in a third costume. ⚠ This is currently **latent, not failing**, which is exactly
  why it is written down: the next tuning pass is as likely to surface it as this
  one was. Fix belongs in `predation/cooperation.js` — either sort the raw list by
  id at the consumer, or stop reading mid-tick `action` — not in the floor.

- **✅ A85 — Nothing in the engine had ever reported a refused step** _(2026-08-06,
  from A84)_. An 8× regression in the fraction of steps an animal could not take
  produced no metric, no event and no failing test; the sweep gate passed it,
  because every species was alive at the final checkpoint. Two instruments closed
  it. `metrics.species[].locomotion` now carries `committed` / `refused` /
  `crowdLocked` / `refusedFraction` (protocol **v35**). The ethologist gains
  detector **4e `movement-denied`**, a *rate* rather than an invariant — the only
  one in family 4 that is.

  ⚠⚠ **`crowdLocked` is counted separately because the fix would otherwise have
  hidden the symptom from the instrument.** A crowd-locked tick reports
  `moving: false`, so the naive reading drops it from numerator *and* denominator
  and a world jamming harder reports a **falling** refusal rate. Asserted directly.

  ✅ **Calibrated against both arms rather than shipped on a threshold.** Healthy is
  3–5% for all eight species (including at `rocks=6 thickets=8`, where terrain does
  the blocking); the trigger is 0.25. On the broken arm it fires **261 times**
  (193 wildebeest, 68 buffalo) naming rates of 41–46%; on the fixed arm, **0 times
  across six worlds**. ⚠ It fires on the *mechanism*, not on crowding, so it also
  covers A66's terrain pinning and cannot be fixed into silence by removing one
  cause. 13 tests in [`test/ethologist.test.js`](test/ethologist.test.js).

- **A86 — "Died of thirst with water a few cells away" is back in the report, and it
  is pre-existing rather than new** _(opened 2026-08-06)_. With A84 closed, the
  ethologist's top deaths are no longer starvation-on-forage but the
  thicket-walled-lake shape this tool was calibrated on: 7 across six worlds, worst
  **12.7** — `died of thirst with water ~0.3c away (sees 7c); action=wander, had
  drunk before`. ⚠ **Checked against `main` before being blamed on the fix**: the
  same class appears there (4 over two seeds), so A84 *revealed* it rather than
  caused it — those animals previously died of the jam first. The oddity worth
  drilling into is the action: an animal at 0.3 cells from water, dying of thirst,
  that has drunk before and is **wandering** rather than drinking.

- **A18 — Prey have no spatial refuge from predators.** Cover slows both
  equally. Part of why the founding counts are a knife edge. The static `thicket`
  terrain (A51) is a first refuge: it blocks line of sight and predators will not
  follow prey into it. ⚠ **Phase 14 built the machinery and pointed it the other
  way, on purpose.** Cover now conceals (`world.concealmentAt`, a graded scale) —
  but scaled by a per-species `crypsis` that is **0 for every herbivore** and 1
  only for the leopard, so what shipped is an *ambush* mechanism rather than a
  refuge. Symmetric concealment was measured first and made the ambush predator
  worse (27 → 19), which is why prey crypsis is a separate decision: raising it
  changes every predator's living in the world at once and wants its own gated
  phase. **The mechanism is in place; the number is the open question.**

- **A51 — Dynamic shrub layer (large bush / small tree).** A new *dynamic* plant
  layer — deliberately **not** a terrain code, because terrain is static and a
  shrub grows, is grazed, and matures. It mirrors the vegetation architecture: a
  static seeded *capacity* placed in clumps, plus dynamic *state* (biomass + a
  woody floor) that serializes; its obstacle/cover properties fold into the
  existing `speedModifierAt` / `blocksSightAt` / `isShelteredAt` chokepoints, so
  no system learns shrubs exist to be slowed, hidden, or sheltered by one. Six
  features: (1) blocks line of sight once **mature**; (2) passable but extremely
  slowing; (3) weather shelter; (4) edible but not preferred — and once mature,
  eating strips only the leaves down to a **woody floor**, so the trunk/branches
  and the cover they give remain; (5) grows in clumps, some already mature at
  world init; (6) denser than rock. Maturity (`woodyFloor > 0`) is the stable
  flag driving sight/slow/shelter, so a grazed shrub still blocks and shelters,
  while leaf biomass (`biomass − woodyFloor`) is the edible, regrowing part.
  Suggested build order, gated behind `shrub.enabled` (default off) and measured
  via a config override so the suite stays green each step: **(1)** `ShrubGrid` +
  `ShrubSystem` + the three chokepoints — measure whether dense sight-blocking
  cover finally makes line of sight bite and eases the outer-ring/corner
  gathering; **(2)** floored, non-preferred feeding; **(3)** protocol + renderer
  layer (RLE + revision-gated deltas, a glyph, protocol-version bump, fixtures);
  **(4)** persistence (serialize biomass + woody floor, save-version bump); **(5)**
  tune density / slow factor / food value and enable. The **static `thicket`
  terrain type is the shipped MVP of this** (blocks sight, shelters,
  passable-but-avoided, placed like rock); the dynamic layer is the
  growth/grazing/maturity superset. Relates to A18 (spatial refuge), A3 (the
  reserved `plant` entity kind — this uses a field, not entities), and A65 (it is
  also the browse a forage-source list would need a second source *for*).
  ⚠ **Two shipped limitations now share this one lever**, which is the strongest
  argument for it: A57 (a fawn is concealed only if born on cover) and the
  leopard's ambush ceiling are the same finding from two directions — **cover is
  3% of the map** — and more of it raises both with no behavioural change at all.

- **⚠ A65 — `diet` is a two-valued string, and it is the last unrepresentable
  niche axis.** Tested as `=== 'carnivore'`; everything else grazes. So there is
  no browser, no distinction between grass and woody browse, and no way to say
  "eats leaves off shrubs, not grass off the ground". The replacement is a
  **forage-source list** — which sources a species can use, at what relative rate,
  in what preference order — and it is the one species item that must touch
  `FeedingSystem` and `DecisionSystem`, still data-driven and still with no
  species-name branch. It needs **A51's woody layer first**, or there is nothing
  for the second source to be, and it is what blocks the rhino (A68). ⚠ **The
  measurement harness is inside the blast radius and is half-guarded**:
  `foodModelOf()` in `src/scripts/ethologist.js` is the single place the
  comparison lives and it **throws** on an unrecognised diet, naming the species,
  so an unmigrated ethologist stops rather than silently reclassifying every
  carnivore as a herbivore and reporting confidently wrong anomaly counts.
  Migrating that function is the whole edit and **must land in the same commit**,
  or the fix is untestable. Omnivory is not part of this — no species in this
  roster eats plants and meat.

- **A66 — Territory cannot be restricted by sex, life stage, or season.**
  `territory.defends` is a species-wide boolean, so "bucks hold rut territories
  that females and juveniles walk straight through" is not expressible — which is
  why the gazelle ships with `defends: false` and its male competition runs
  entirely through mate contests instead. The change is widening the field to
  `false | true | 'male' | 'female'` and reading `entity.sex` in
  `TerritorySystem`, plus a life-stage and breeding-window restriction. It is what
  would finally make A35 interesting, and it is a *different* fix from A60, which
  is about a group holding ground rather than an individual. ⚠ Sex-biased
  **dispersal** is already built and is not this: `groups.leavingSex` filters the
  existing dispersal event.

- **✅ A67 — Vertical refuge: trees, climbing, and cached kills. CLOSED
  2026-08-03** (phases T1/T2), **on its own stated condition**: "revisit only if
  *cached out of reach* can be one more possession state rather than a new axis."
  It can. `entity.elevation` is a **flag, not a coordinate** — 0 or 1, with no
  third axis, no height in any distance, and nothing in the spatial index — and
  it gates predation eligibility (both directions) plus access to a cached
  carcass, and ⚠ **nothing in perception's visibility gate** (A63: a treed animal
  is still seen, still a mate candidate, still a guardian, and that is asserted
  rather than trusted). Trees are terrain (T1), not the entities A67 assumed, so
  A3 stayed shut. The protocol change A67 predicted was real: v31. ✅ **The
  behaviour that uses it shipped the same day** (phase T3): the leopard declares
  `climbs`, caches kills, and the ten-seed gate passes — ⚠ with the hyena paying for
  the whole mechanism (−5.4 tonnes of carrion, starvation deaths 10 → 21). See
  DOCS §7 Terrain. ⚠ And one limit is inherent to the flag: **a treed predator can
  reach nothing below it**, so there is no ambush from height, which A67 listed
  among the things a complete leopard does.

- **A77 — The vulture's carcass-discovery network is unbuilt** _(phase V2 of the
  [retired trees/flight/vulture plan](legacy-docs/TREES-FLIGHT-VULTURE-PLAN.md))_. `vulture.md` asks for birds that find food
  by **watching other vultures descend**, so a body draws a cascade rather than
  needing every bird to spot it independently. **The design is settled and is
  deliberately not new machinery**: it is `#joinedHunt` with a different noun — a
  scavenger with **no carcass of its own in sight** adopts the carcass a nearby
  conspecific has committed to, filling `seekFood`'s existing target. Copying that
  shape exactly is the point, because its guarantees carry over for free: gated on
  having nothing of its own, so it can only ever *add* a searcher to a body and never
  take one off a body it had already found; it reads the **neighbour buffer** rather
  than adding a third walk; it adds no action and no draw. Biology in a field, switch
  in a section (§8): `scavenging: { followsKin: true, followRange }` per species,
  `config.scavenging.enabled` global. **Measure the shift**: ticks from a carcass's
  creation to the *n*th feeder, on against off — the cascade is measurable in a way
  "more vultures" is not.
  ⚠⚠ **Read A73 and A76 first.** This takes carrion off the same scavenger guild that
  three consecutive phases have already reshuffled, and it does it by making the
  species that now holds **45% of all the carrion in the world** faster to arrive.
  ⚠ Per D42, the metric must name the vulture: "time to the *n*th feeder" is a fact
  about carcasses and the first feeder is usually whatever made the kill.

- **A78 — The vulture's slow life history is unbuilt, and it is now overdue rather
  than optional** _(phase V3 of the
  [retired trees/flight/vulture plan](legacy-docs/TREES-FLIGHT-VULTURE-PLAN.md))_.
  `vulture.md` wants slow maturation, one chick and long dependency; the shipped bird
  is deliberately the opposite — a boom-and-bust breeder (`gestationTicks: 400`,
  `cooldownTicks: 900`, `maxAge: 6000`) — and those numbers are load-bearing for a
  demo the docs call a knife edge. **Config only, behind the §20 gate.**
  ⚠⚠ **It was the named counterweight to flight, and V1 spent the reprieve.** F2
  shipped with its own brake (the ground perception radius drop) and its gate held;
  V1's gate then read the vulture at **416.0 against 295.4** and **45.0% of all
  carrion against 35.6%** (**A76**). ⚠ Two things to read before building it, both
  from those numbers: the extra meat is mostly **new rather than stolen** (the pool
  grows 193 → 221 tonnes), so the loop runs through **carcass supply** and **B7**'s
  mass-blind `carcass.decayTicks` is at least as good a lever — arguably the honest
  one; and the vulture's population has a **2.3× within-arm spread across seeds**
  (216–505 on a control alone), so this needs ten seeds and **per-seed pairs**, not
  three seeds and a mean (**D41**). ⚠ **A62 caps how far it can honestly go**: the
  year is 8000 ticks and lifespans are compressed beside it, so a genuinely slow life
  history meets that compression head-on and the real lever is `ticksPerYear`, which
  re-bases every seasonal measurement in the project. So: a **modest** shift, sized as
  a counterweight rather than to satisfy the brief, measured as its own arm.

- **A79 — Four of the eight species do not name `tree`, so the terrain artifact T1
  measured is still live for them** _(from 2026-08-03, phase T1)_. Every herbivore
  weights `ground` at 1.1–1.2 and names no `tree`, so converting open ground to trees
  **shrinks the preferred habitat of every grazer** — an unnamed terrain resolves to
  neutral 1 while the ground it replaced was above 1. ⚠ It is a general property of
  adding a terrain code to a world whose species enumerate terrain by name, not a fact
  about trees: **any** future code does the same. The leopard named `tree` at T3 and
  the vulture at V1, so two of eight have caught up. The fix is one weight per species
  (gazelle, wildebeest, zebra, buffalo), which is a config edit — ⚠ but it moves four
  species' habitat at once and therefore wants its own arm rather than riding along
  with an unrelated change (it was deliberately left out of T1's gate for exactly
  that reason). Related: **A72** (the occupancy claim it would be measured by is the
  one that cannot be resolved) and **A51**.

- **A80 — Founding cohorts ship on, on a gate that passed rather than convinced**
  _(2026-08-04)_. `config.cohorts` places each founding cohort in herds, prides,
  clans and roosts instead of scattering every animal uniformly over the map, and
  the two social mechanisms pick it up unaided — herd labels and `world.groups`
  records both exist on tick 1, because both read proximity and placement is the
  only social input the world gets before its first tick (DOCS §9 Founding
  cohorts). It writes no social state itself. `clustered: true` since 2026-08-04.

  **This item exists because the gate's bar was met without the evidence being
  strong**, and that is worth keeping visible rather than filing as done. 10 seeds
  × 15 000 ticks, `--set=cohorts.clustered=true --controlSet=cohorts.clustered=false`:
  every species alive on 10/10 seeds bar the leopard on 9/10, comfortably over the
  ≥6/10 bar. But per-seed pairs (**D41**) resolve exactly **one** effect — the
  **lion**, up on 8 of 10 seeds (12.7 → 15.9), the social predator founded as
  prides, which is the result the mechanism predicts. Every other mean is a coin
  flip in its ordering: leopard 4up/6down, hyena 2up/5down/3tie, vulture 3up/7down,
  and the gazelle 5up/4down/1tie *despite* a +11.5 mean carried by two outlier
  seeds. Reporting the means alone would have made this look like a clear win.

  ⚠ It costs the leopard a seed (10/10 → 9/10; starvation deaths 2 → 8), and
  **D14** is explicit that a one-seed disagreement at ten seeds calls for more
  seeds rather than a parameter change. That reading is still outstanding.

  ⚠ **Its honest claim is narrower than it first looks.** Group count and mean
  size converge on the scattered world's by tick 10 000 — 7.5 × 5.3 against
  7.8 × 5.3 over six seeds — while at tick 1 the clustered world holds ~6 groups
  of ~4.7 and the scattered world holds none. So it buys a world that **starts**
  where it was going to end up. That is what a founding condition is for, and it
  is not the same claim as "a more social world".

  ⚠⚠ **It sharpens A56.** Group foundings went 8818 → 15388 (+75%). Peak
  concurrent groups fell 12 → 10, but the size measurement above says that is
  fewer-and-fuller rather than churn, so the founding count is the signal and the
  peak is not. A56's own note deferred its hysteresis fix until there was more
  than one clan-forming species to tune against; there are now three, and this is
  the change that makes it pay.

  ⚠ **The benchmark re-baseline this item was waiting on happened on 2026-08-04**
  (`BENCHMARK.md`, demo-default 5.5224 / large-5k 133.73, the latter flat against
  134.46) — but the demo became the ngorongoro world in the same change, so the
  numbers measure clustering *and* a new world together and attribute neither. A
  clean clustering A/B would need `--set=cohorts.clustered=false` on the current
  demo. ⚠ Every per-seed number above is from the 160×120 world; the current
  demo's own sweep is **A81**, where the leopard is down to 1/10 seeds.
  Related: **A56**, **A60** (a pride still cannot hold shared ground), **A43**.

- **A68 — The species roster stops at eight; the rhino and the elephant are
  deferred** _(decided 2026-07-30)_. Scope rather than work. The **black rhino**
  is config-only but gated on A51 — without a woody layer it is a heavy
  wildebeest. The **elephant may never be built**: it needs A51, matriarchal
  families on the group registry, a `musthUntil` timed state (defensible — the
  same shape as `alarmedUntil` — but it must modify *derived* dominance rather
  than replace it), woody-floor damage, and it has no top-down control on a
  128×128 map. A config-only elephant would be physiology without ecology, which
  is worse than no elephant.

- **A35 — Territory is a predator-only phenomenon** at ~9 individuals. Grazers
  get a home range but no site fidelity and no claims.

- **A37 — Disease does not cross species.** The two species carry it
  independently; a shared or zoonotic pathogen is unbuilt.

- **A12 — Orphan mercy.** An orphaned unweaned juvenile is weaned early rather
  than facing a real dependency crisis. Left in place deliberately, so that
  removing it is not bundled with any other change to juvenile survival.

- **A47 — Animals do not seek other animals' burrows.** A burrow shelters
  whoever stands on it, but only trails exert a pull. Giving burrows one means
  teaching the perception hot loop about features.

- **A24 — No per-cell microclimate.** Temperature is global and cover is the only
  spatial modifier. Needs terrain elevation, which does not exist. This is also
  why migration has no "warmer south" to steer toward.

- **A3 — Individual tree/shrub entities.** Vegetation is a cell-level biomass
  field. The `plant` entity kind is reserved for point vegetation if a use for it
  arrives.

## Engine — schema and configuration

- **A96 — The three water features are unmeasured, and the marsh is the one that
  matters** _(2026-08-08, TERRAIN-PLAN.md)_. Ponds, a stream and a marsh ship on
  by default and no ecological reading was taken of any of them — deliberately, but
  the exposure is real: all three add **drinkable water**, and a 5% marsh is a large
  permanent water source that is not the lake. Second-order, and easier to forget:
  the marsh also converts open ground to cover (more grass), thicket (refuge, and
  sight-blocking) and trees (shelter, and a leopard's larder), in a region that is
  by construction next to water. The instrument is `npm run sweep`, ten seeds,
  `marsh: 0` as the control. See DOCS §1.4 and §7 Terrain.

- **A81 — Three species did not persist in the crater demo, and the demo is no
  longer held to a knife edge** _(2026-08-04; **the open half closed 2026-08-07**)_.
  ✅ **`default-small` has now been swept** (PREDATOR-PLAN P8, 10 seeds × 15 000):
  seven species clear ≥6/10 and the **leopard is 4/10** — better than the crater's
  1/10, on a different world. Vulture **6/10 but mean 21.0 over a range of 0–75**,
  i.e. bimodal rather than merely scarce. The leopard's cause is now named
  (**A91**), and one of the ten seeds is a drought world (**A93**). ⚠ The doctrine
  this item establishes is unchanged and still governs: **a sweep is a reading to
  record, not a bar to pass.**
  ⚠⚠ **The world this item measures stopped being the demo on 2026-08-07**, when the
  default became `default-small` (230×180, `roundness: 4`, terrain counts
  18/18/24/180, 263 animals). **The crater sweep below does not transfer** — the map is
  0.37× the area against 0.53× the headcount, and the hyena went 9 → 20 while every
  grazer fell. Re-running `npm run sweep` on ten seeds is the open work; the
  doctrine (a reading to record, not a bar to pass) carries over unchanged.
  ⚠⚠ **The lever this item recommended has incidentally been pulled.** It named
  terrain density rather than founder counts, on the grounds that the two collapsed
  species were the tree-caching ambusher and the tree-roosting scavenger, and it
  proposed `--rocks=8 --thickets=8`. `default-small` runs 18/18 rock and thicket
  formations and 24/180 trees on a map with 0.37 the cells, which puts **tree back
  to 2.61% of the map and thicket to 2.20%** — roughly their 160×120 shares, and
  ~2.7× and ~3.9× their crater shares. So the new sweep is, among other things, the
  experiment this item asked for; read it that way. ⚠ It is not a clean test of the
  hypothesis, because the roster and the map moved at the same time.
  The reading below describes the `ngorongoro-500-10x` world (332×280, `roundness:
  4`, doubled terrain counts, ~500 animals at the real crater's herbivore ratios),
  which itself replaced 222 animals on a 160×120 rectangle.
  ⚠⚠ Swept on ten seeds × 15 000 ticks: the four grazers and the lion are alive on
  **10/10** seeds (gazelle 169.5, wildebeest 168.0, zebra 147.2, buffalo 96.5, lion
  17.1 mean), the hyena on **7/10** (3.4), and the **leopard (1/10) and vulture
  (1/10) are effectively gone** — the vulture's one surviving seed carrying 47
  birds. Leopard deaths are 10 starvation to 30 age: three founders cannot find
  enough on a map ~4.8× the old one.
  ⚠ **Accepted rather than re-tuned** — as of this date the demo is not maintained
  as a knife edge, and `npm run sweep` is a reading to record, not a bar to pass.
  ⚠⚠ The likelier lever is **terrain density, not founder counts**: rock, thicket
  and tree are absolute formation counts, so doubling them on a map 4.84× larger
  left tree at **0.98%** of the map (was 2.48%) and thicket at **0.56%** (was
  1.69%) — and the two species that collapsed are the crypsis ambusher that caches
  kills in trees and the woodland scavenger that roosts in them. Testable in one
  command: `npm run sweep -- --rocks=8 --thickets=8`.
  ⚠ Carcasses are **still accumulating at tick 9000** (peak ~364 near t11 000,
  settling into a 180–320 band by t16 000), so `test/carcass.test.js` now runs to
  15 000 ticks — the same finding as the starving scavengers, from the other side.
  Still stale: the mobbing / cooperative-capture densities, measured as counts on
  the smaller map. See [`DOCS.md`](DOCS.md) §1.4.

- **A49 — "Activity pattern" is not a schema field.** ⚠ Half of this item
  **closed 2026-07-29**: habitat preference now exists as a per-species `habitat`
  field (one weight per terrain name) consumed by the long-range cue, and the
  gazelle uses it. What is still open is the *activity pattern* half — there is no
  diurnal cycle for one to exist in. See [`DOCS.md`](DOCS.md) §9 Migration.
  ⚠⚠ **It now has its first concrete consumer, which it did not have before**
  (2026-08-04, phase V1): a **roost exists and has no night to want it** (**A75**).
  The vulture can be in a tree, prefers wooded ground, and is aloft ~0.01% of the
  time, because the actions that put it there are all rare or impossible for it. A
  diurnal cycle is the one lever that makes an animal *want to be still somewhere*
  without adding an action that competes with foraging — which is what makes this
  the honest fix for A75 rather than a nicety.

- **A58 — Perception reports the *nearest* food cell, not the best-scoring one**
  _(2026-07-29, phase 9)_. Forage preference discounts a cell once an animal is
  standing on it, but perception still picks the nearest cell with anything on it, so
  a grazer walks to ordinary grass with a better patch two cells further off.
  Widening it means scoring every candidate instead of only cells nearer than the
  best so far — in the hottest loop in the engine, where D28 records one extra
  *argument* costing 12% of a tick. A stated bargain, harmless at one grazer.
  ⚠ **Phase 11 hit the same limit on the predator side, where it was decisive**:
  perception reports the nearest *eligible prey*, so a lion listing both gazelle
  and buffalo engaged a buffalo twice in 4000 ticks and batch 2 demonstrated
  nothing. Narrowing `preySpeciesIds` fixed that case; the general fix would close
  both. ⚠ **Re-examined at batch 3 (2026-07-30), it did not bite on the herbivore
  side.** Three grazers now disagree about what a good cell is, and the preference
  still moved each in its declared direction: gazelle −0.97/−1.64 standing crop
  against the mechanism off, wildebeest −0.51/−0.62, and the two bulk feeders
  approximately zero. The discount does the work once an animal is standing on a
  cell, and a grazer reaches nearby grass often enough. It remains open on the
  predator side, where the lion's three-item prey list makes nearest-eligible prey
  the animal it lives on.

- **B7 — Three mass-blind constants, found by the 2026-07-28 mass audit** and
  deliberately left until the species that exposes each one exists. ⚠ **The
  species arrived on 2026-07-30**: `carcass.decayTicks` now has a 600 kg body
  rotting on a 6 kg animal's clock (one buffalo is 360 edible mass against a
  gazelle's 18, and the lion took 37.6% of all carrion in the world), and
  `hunting.captureStaminaCost` is flat against a `maxStamina` that now ranges
  80–140 (lion 80, leopard 90, zebra 140). Both are still unfixed, because each changes a food source or a hunt
  and phase 11 already changed both.
  `carcass.decayTicks` (a 600 kg body rots on a 6 kg body's clock — and changing
  it changes a food source, so it needs its own multi-seed sweep);
  `hunting.captureStaminaCost` (flat against a per-species `maxStamina`, so the
  ratio is expressible but remains untested despite the lion and leopard differing
  at 80 and 90); and
  `locomotion.maxOccupantsPerCell` (a headcount rather than a volume — the fix is
  an occupancy *cost*, on a knife edge). Every other candidate audited as scaled
  or correctly flat, with the verdict written into its config comment. Full
  reasoning in [`DOCS.md`](DOCS.md) §1.4 and
  [`legacy-docs/PLAN-SPECIES.md`](legacy-docs/PLAN-SPECIES.md) §4.

- **Four species blocks are still inherited unchanged by all eight species**
  _(2026-07-28, narrowed 2026-07-31)_: `feeding`, `traits`, `genetics`, and
  `disease`. No species varies what it gets out of a mouthful, how widely its
  individuals differ, how fast it mutates, or how it takes an infection, so a
  6 kg vulture and a 600 kg buffalo assimilate at the same declared rate with only
  the mass scaling between them. That is A38's shape four blocks deep. ⚠ **The
  other three blocks this item used to name have since been declared**: `hunting`
  by the lion, `behavior` by five species, `predation` by the three carnivores —
  so the pattern is "schema ahead of the roster", not dead weight, and it resolves
  by a species arriving rather than by an engine change. Closing what remains is a
  config edit apiece behind the [`DOCS.md`](DOCS.md) §20 species gate.

- **B1 — `createDemoSimulation.js` was never renamed to `createEcosystem.js`.**
  Cosmetic; the rename is churn across server, scripts, and tests.

## Engine — observability

- **A28 — Bottleneck detection is left to the caller.** The bounded history
  carries population per species over time, but nothing computes a minimum or
  flags a crash. Closing it means choosing what counts as a crash.

- **A82 — Three sociality mechanisms are inert or unmeasurable in the demo *by
  construction*, and each invites the wrong measurement** _(2026-08-06, from the
  retired herbivore-behaviour plan)_. Grouped because they share a failure mode:
  somebody re-tunes one against a population number that cannot possibly respond.

  - **`behavior.leadAgeWeight` is inert in short runs.** Seniority is `senescent`
    or nothing, and buffalo reach `adultUntil: 11000`, so a 1500-tick demo contains
    **no matriarch at all**. What `config.groups.leadWeight` moves in a short run is
    plain `dominanceOf` (mass and condition). Measuring the age half needs a horizon
    past 11 000 ticks — the A56 lesson in a new suit.
  - **The charge and pursuit fire ~25 ticks in 4000.** Zero live pursuits exist at
    tick 1500 on seed 42 (DOCS §11), so any survival or population reading of them
    is noise by construction. ⚠ Anyone re-tuning `chargeWeight` must re-read the
    `alarmFlee` collision first (**D44**) — that, not `fleeWeight`, is what it
    competes with.
  - **A consensus replaces the *whole* migration drift, and that drift multiplexes
    thirst** — so a thirsty animal in a herd that is not thirsty loses its
    long-range water cue for up to 60 ticks. This is why the buffalo declares
    `consensusWeight: 0.6` rather than 1.0. Measured and currently benign:
    wildebeest dehydration deaths **655 with the consensus against 708 without**.
    ⚠ Re-check it if anyone raises a `consensusWeight`. The short-range `drink` /
    `seekWater` / `recallWater` are *actions* and cannot be replaced by any of this.

    ✅ **Re-measured after A84, and the thirst hazard is still benign** _(2026-08-06,
    3 seeds × 6000 ticks)_: wildebeest dehydration **131 with the consensus against
    165 without** — same direction as the original reading, on a world where herds
    now stand at a realistic density rather than packed. The multiplexing worry can
    be closed.

    ⚠⚠ **But the same null arm found what that reading was hiding, and it is a
    different species and a different cause.** With the consensus off the **buffalo
    mean is 121.0 against 94.7 on**, and its **starvation deaths fall 52 → 5**;
    the gazelle reads 109.0 against 95.3 and the wildebeest 312.0 against 296.3.
    So P8 costs the buffalo ~26 animals — the entire residual **A84** could not
    explain — while the leopard goes the other way (3/3 seeds with it, 2/3 without).
    ⚠ **Nobody had run this arm against a population**: A82 measured the consensus
    against the *thirst* hazard it was predicted to have, found it clean, and the
    cost it actually carries is a foraging one in the largest grazer. Checking the
    predicted failure mode is not checking the mechanism.

- **A43 — Population fragmentation is enabled, not asserted.** Herd labels split
  by hop count and separate forage patches pull herds apart, but no test claims a
  fragmentation outcome.

  ⚠ **Narrowed, not closed** _(decided 2026-08-06, BEHAVIOR-PLAN P10)_. The plan
  proposed that P2's two-bands test is the assertion this item says nobody has
  written. Read against what A43 asks for, it is not: that test asserts a
  **centroid** — that one animal's centre of mass is dominated by its own band —
  inside a two-band sandbox on a single tick. It is a differential-attraction claim
  about a steering *input*, and A43 asks for a fragmentation **outcome** in a
  population.

  ✅ **What P10 does close is the half this item's own resolution named**: DOCS §1
  said A43 waits on "a later observability pass, if a fragmentation _measure_ earns
  its keep". That measure now exists — `groups.spread` in the metrics aggregate,
  the mean distance of a record's living members from its own centre. Its first
  reading on the demo (seed 42) is that bands loosen from **5.5** mean spread at
  tick 200 to **14.8** at 600 and **15.6** at 1500, with a per-record maximum of
  **83** — some bands are genuinely scattering, which is the thing A43 suspected and
  nothing could previously say.

  ⬜ **What is still open is one sentence long**: no test claims that a herd
  *label* splits in a real world — that a population under a hop-count or forage
  split ends up as two herds rather than one. ⚠ The reason it was not written here
  is worth recording rather than leaving as an omission: a label count on the demo
  is an **equilibrium**, and a test that measures an equilibrium is measuring the
  seed unless it has been shown otherwise on five of them. That is the shape of the
  13 tests already audited as fishing for a rare event in a fixed window, and adding
  a fourteenth to close a documentation item would be the wrong trade. The
  sandbox split assertion (`social.test.js`, "two separated herds keep separate
  labels, and merge on contact") pins the *mechanism*; what is missing is a
  population reading, and the measure to take it with now exists.

- **A83 — The ethologist covers two of the four risks the behaviour plan named,
  and staleness is its standing failure mode** _(2026-08-06)_.

  ⚠⚠ **The generalisation first, because it will recur:** `npm run ethologist` was
  cited twice as evidence that the behaviour plan's mechanisms behaved — "reports
  no new anomaly kind across six worlds" — at a point when it **could not have
  seen any of them**. It read no position for finiteness, read `stamina` nowhere at
  all, and `defend`/`chase` are deliberately excluded from both the seek and
  circling detectors because their targets move evasively. A clean report from a
  detector that cannot see the mechanism is not evidence about the mechanism
  (**D40**'s null arm and **D31**'s tautological fixture, in a third costume).
  **A phase that adds a mechanism must either extend this tool or record that it
  did not.**

  ✅ **Closed on 2026-08-06 — detector family 4, four kinds:**
  `non-finite-state` (any NaN in a position, a steering drift, a physiological
  scalar, a utility score, or `social.pullScale` — which is a **divisor**, so zero
  is as fatal as NaN and does not look it); `commitment-past-ceiling` (a ttl
  further out than `config.charge.maxPursuitTicks` or
  `commitTicks + updateInterval` allows); `sprint-to-exhaustion` (holding
  `defend`/`chase` past that ceiling with most of the episode spent on an empty
  tank); and `lost-from-its-band` (a long-standing record member that never once
  had a bandmate in the centre it steers at — P7's premise, and the only coverage
  P3/P7 have). All four are proved to fire in
  [`test/ethologist.test.js`](test/ethologist.test.js), 28 tests, and **17
  mutations of them each fail that suite**.

  ⛔ **Two of the plan's four risks were measured and deliberately NOT built**,
  because in both cases the measurement says a detector cannot discriminate. The
  numbers are in the tool's header; the short version:
  - **"An animal locked on one bearing."** Net-displacement-over-path at a
    600-tick window reaches **0.999 in a healthy world** — straight-line travel is
    ordinary. At 1500 ticks a null arm does separate the mechanism (consensus on:
    max 0.567, p99 0.506, top six all wildebeest; off: max 0.522, p99 0.457, top
    six mixed) — but any threshold that avoids firing on the control has **0.017
    of headroom**, which is noise. Consensus strength on the demo runs ~0.10, a
    weak bend on an already-arbitrary heading. ⚠ The sharper framing, a commitment
    that never *expires*, is already covered by `commitment-past-ceiling`.
  - **"A band collapsed to a point."** `locomotion.maxOccupantsPerCell: 2` already
    imposes a geometric floor, and healthy records sit **on** it: minimum mean
    distance from centre by member count over 7000 ticks is 2 → 0.10, 3 → 0.53,
    4 → 0.76, 8 → 1.39, 12 → 1.49, 16 → 2.01, with tight buffalo/zebra records at
    a *median* of ~2.1. There is no gap between "collapsed" and "a band standing
    together" because the engine prevents the collapse — the same finding the
    behaviour plan recorded about the defensive ring, from the other direction.

  ⬜ **What remains open is the tool's own live-world calibration.** The unit suite
  proves each detector *can* fire; only a sweep shows whether it fires too often,
  and `circling-in-need`'s 146-flags-per-healthy-world history is the precedent.
  Two of the four new kinds have **never fired** on the demo (7000 ticks, seed 42),
  which is the correct result and not a reason to loosen them.

  ⚠⚠ **This item's own generalisation came true one phase later, and the shape is
  worth reading twice** _(2026-08-06, **A85**)_. Family 4 was built for the four
  risks the behaviour plan *named*, and all four are clean. The risk nobody named —
  a cohesion target asking for a density the movement system forbids — cost the
  wildebeest 57% of its population and the buffalo 83%, and **the lead was in this
  tool's own output the whole time**: it reported the deaths as `starved with 122
  biomass within 2c` and one buffalo as `unresolved-intent … 294 refused steps`.
  Nothing triggered on the refusal count, so the report read as an ecology problem.
  **Extending the tool to the risks a plan lists is necessary and is not
  sufficient** — the question to ask alongside it is which *existing* field in the
  output nothing is thresholded on. `movement-denied` is that field, promoted.

  ⚠ It is also the first detector here that is a **rate rather than an invariant**,
  which cost it a real calibration pass (3–5% healthy against 41–46% broken, both
  arms measured) rather than the "has never fired, which is correct" that the four
  invariants get. `circling-in-need` is the standing warning about shipping one of
  these uncalibrated.

- **A22 — Tombstones are bounded at 256**, so ancestry cannot be walked further
  back than that. Only bites a query that walks ancestry; lineage _depth_ is
  carried on the entity as `generation`.

- **✅ A36 — The territorial claim layer is not projected to the renderer. CLOSED
  2026-08-08** (protocol v37). It stood open on "the claim layer would need to earn its per-snapshot
  cost", and what earned it was projecting **less** of it: owner ids only over the
  coarse claim grid, RLE-encoded, behind a second `ownerRevision` on `ScentGrid`
  that moves when a cell changes hands rather than on every mark and decay sweep.
  Measured over 1000 mature demo ticks: **445 bytes of a 320 KB full snapshot**,
  and **0.013% of delta bytes** across the 377 ticks in 1000 that carry it at all.
  Claim *strength* stays inside the engine — it is what the mechanism runs on, it
  is the half that changes every tick, and dropping it is what makes the revision
  gate work. Unblocks renderer P1, now the **territory layer**.
  ⚠ The home-range ring is still an inspection-only overlay for the selected
  animal, which is a different fact and was never what A36 was about.

- **A5 — No renderer debug overlay of perceived cells.**

- **A7 — No action glyph tint.** The current action is textual in the inspector
  only; `action` already rides in the bulk snapshot.

## Engine — performance and payload


- **The mature performance target is not reached.** ~25 000 behaviourally complex
  animals inside a one-second tick. Linear extrapolation from large-5k puts ~25k
  entities at ~220 ms/tick, but that assumes the world grows with the population
  and has not been run. The next gain is structural — visiting fewer cells per
  animal, or staggering perception — not another cleanup pass.

- **A90 — The perception cell scan searches every tick for three things that
  cannot move.** `PerceptionSystem`'s `(2r+1)²` scan finds nearest food, water,
  obstacle and cover per animal per tick — ~127 000 cell visits per tick on the
  pre-2026-08-07 demo roster, against a world of 92 960 cells, so it visits more
  cells per tick than the world contains. `TerrainGrid` exposes **no mutators**,
  so water, obstacles and cover are fixed at generation; only food changes. Hit
  rates at tick 1500 (seed 42): food **85.0%**, water **53.1%**, obstacle
  **19.2%**, cover **0.0%** — cover is searched for exhaustively and never found.
  The fix is a precomputed distance field per static cue (an O(1) lookup), or at
  minimum a conservative early-out that skips the per-cell `terrain.codeAt` read
  when the field proves the cue is out of range. ⚠ **Not a drop-in**: the scan
  measures from the animal's exact float position to each cell centre and breaks
  ties by scan order, so a field measuring centre-to-centre picks a different cell
  near boundaries and silently changes behaviour. Accept it the way A2 was
  accepted — on byte-identical demo state, not on a green suite. ⚠ The dynamic
  half (nearest food, and the only cue with a high hit rate) is the genuinely hard
  part and needs an incrementally maintained field; the static early-out is worth
  doing on its own first. Profiled 2026-08-07; see DOCS §13.

- **C3 — Per-tick event volume.** One `entity.moved` per animal per tick, plus
  one `entity.fed` per eater and one `entity.provisioned` per nursing juvenile in
  range. Bounded by the buffer, and in the renderer both off by default and
  expired within a few hundred events, but it competes for the retention
  window — and events are **42% of a 1.78 MiB demo save**, more than the entire
  entity array.

- **B5 — `utilityBreakdown` persists on the entity.** It is recomputed every tick
  and read by nothing in the simulation. Measured at **3.3% of a save**;
  removing it costs a `SAVE_FORMAT_VERSION` bump and a fixture regeneration.

---

## Renderer — decisions not yet taken

- **Phase D — what "step backward" means.** The engine only moves forward; there
  is no reverse command and `validateCommand` requires `ticks >= 1`. Three
  recorded options: **D1** don't offer it (label the control `Advance N`);
  **D2** a renderer-side bounded review buffer (~300 ticks) scrubbed read-only
  behind a `REVIEW t1234` badge, needing no protocol or engine change; **D3** a
  true engine rewind via a ring of `captureSimulationState` saves, which needs a
  new command, a protocol bump, and a forced full-snapshot resync — and which
  belongs in the engine plan rather than the renderer's. `DOCS-RENDERER.md` §1.2
  records D2 as its own recommendation. Whichever is chosen, a past tick must
  never be displayed as though it were the present.

## Renderer — verification and tooling

- **✅ The social layer *has* been driven in a browser** _(2026-08-04, with the
  layer itself)_ — `tests-ui/layers.spec.js` counts pixels of a band's colour on
  the canvas with the layer off, on, and off again, and the outlines were also
  looked at by eye at 32px, 16px and the 10px floor. Recorded here because it is
  the counter-example to the two items below rather than an open item: the same
  run is what found the half-pixel stroke alignment bug (`ringInset`), which no
  amount of node testing would have shown.

- **⚠ The `»` flying mark has never been drawn in a browser** _(opened 2026-08-04
  with phase F1)_. Its geometry is asserted through the canvas stub (twelve
  vertices, apex centred and above the midpoint, cyan) and its legend row from the
  registry, but no real canvas has drawn it at a real zoom. The claim that needs a
  browser is **legibility at the 10px floor**, where the chevron pair is expected
  to fuse into one wedge; the fill thickness is floored at a whole pixel for that
  reason and the floor is visually untested. `tests-ui/status-marks.spec.js` now
  names the label, so the next Playwright run covers the legend half — it could not
  be run where this shipped from (no port binding).

- **⚠ P9 — The inspector popover's placement and hosting have never been driven
  in a browser.** Its pure logic is tested and its wiring was reviewed (which
  caught two real bugs), but positioning, edge-flipping, dragging, and the
  dock/float path stand on review rather than evidence. ⚠ Narrowed 2026-07-28:
  `tests-ui` opens the popover and checks it, and the `<details>` toggle path is
  covered for the metrics panel — this is now four specific unwritten specs, not
  an absence of browser automation. The clicks that would settle it: select a
  cell near the right edge (flip), drag the header (pin), press dock then float,
  expand Genome and reload (persistence).

- **P6 / E3 — Fixture mode has no inspection or metrics data at all**, so the
  panel shows ground and bulk fields but no sections offline. Closing it means
  adding an `entity.inspection` fixture to
  `scripts/generateRendererFixtures.js`. ⚠ **More conspicuous since 2026-08-01**, when population moved into a column of its own: offline that column is now a whole empty panel rather than an empty section of a shared sidebar.

- **⚠ P14 — The `/api/metrics` payload is 383 KB at eight species, and the
  species dimension is not what makes it that.** ✅ **Measured 2026-07-30 at batch
  3**, as this item asked. The report splits **347 KB of bounded history (91%)
  against 36 KB of current metrics (9%)**, and a species block is ~4.4 KB of which
  3.2 KB is eight trait histograms. So the **server-side species filter** PLAN-
  SPECIES §7 proposed is the wrong lever: it attacks the 9%, and the client wants
  every species' counts for its legend anyway. The payload is
  `historyLength × species × ~355 bytes` plus `species × ~4.4 KB`, polled every
  3 s — the history is 120 points of eight trait *means* per species, and the
  levers on it are fewer points, fewer traits in `summarizeForHistory`, or a delta
  encoding. Left open with the diagnosis corrected rather than fixed: on a
  localhost poll it is not yet a defect, and the roster grows by two more species
  at most (§10.4).

- **E4 — Keep `README-RENDERER.md`, `DOCS-RENDERER.md`, `PLAN-RENDERER.md`, and
  `HANDOFF-RENDERER.md` current _with_ each phase** rather than after it. An
  ongoing discipline rather than a discrete task.

- **⚠ `persistence.test.js` runs out of memory and never finishes** _(found
  2026-08-08)_. Node dies ~3 s in at the default 4 GB heap, and the test runner
  then leaves a worker hung rather than exiting — so it reads as *slow*, not as
  *crashed*, and a run left alone sat 75 minutes producing nothing. ⚠ Verified
  **pre-existing** against a clean `HEAD` worktree (byte-identical 58-line crash),
  so it is the machine or the suite rather than any change. Consequence:
  **`npm test` cannot complete on this machine.** Diagnose by redirecting to a
  file and reading its *head* — a `| tail` pipe hides the stack trace behind an
  exit that never comes. See DOCS §14.

## Renderer — known limitations

- **✅ P1 — Per-cell territory ownership is not shown. CLOSED 2026-08-08** — as the **Territory**
  map layer: the ground each pride, clan and lone holder marks, outlined in the
  same design language as the social layer and in the group's own colour. Closed
  by engine A36 projecting the claim layer. See `DOCS-RENDERER.md` §9b.

- **P20 — `CellDetail` still says nothing about who owns a cell** _(2026-08-08)_.
  The store has the answer for every cell now; clicking one reports terrain,
  forage, wear and disturbances but not the claim. Deliberately not bundled with
  the layer — the boundary is what makes territory watchable, a row in the
  inspector is what makes one cell's owner addressable. ⚠ Whatever writes it must
  resolve the holder the way `TerritoryLayer` does (through the live entity,
  alive), or the panel and the grid will disagree about ground a dead lion marked.

- **P21 — A hyena clan outlines no territory, and that is engine data, not a
  renderer gap** _(2026-08-08)_. `scavenger.hyena` ships
  `territory.defends: false`, which its species file argues for at length as one
  of three axes keeping the clan from competing the leopard to extinction. The
  layer already names and colours clans. ⚠ Flipping the flag switches on `patrol`
  as well as marking, which DOCS §9 records as having cost the demo seeds four
  times, so it is an ecological change owing a multi-seed gate — related to **A35**
  and **A66**, and not fixable from the renderer side.

- **P5 — The renderer cannot show a tick it never received, and cannot move the
  engine backward at all.** Resolved by whatever Phase D decides; currently
  stated in the UI rather than worked around.

- **P23 — A section body is replaced wholesale, so the panel has to freeze
  itself while it is being clicked, and a rebuild has to read its own open
  sections back out of the DOM** _(2026-08-09)_. `#patchSections` writes
  `host.innerHTML = body` for any section whose content changed, which at speed
  is most of them most ticks — and replacing the node under a finger is what
  stops a `click` from firing at all (§5). The shipped fix defers the whole
  render for the length of a press, which works and is bounded, but it treats the
  symptom. The panel's own stated rule is **values are patched, shapes are
  rebuilt**, and section bodies are the one place that does both: extending the
  `data-live` mechanism into them would mean a body is never replaced, and
  nothing would need deferring. See DOCS-RENDERER §5.
- **⚠⚠ P22 — The per-tick delta is 180–310 KB, and two thirds of it is re-sent
  rather than diffed** _(2026-08-09)_. `updated` carries complete public entity
  objects rather than field patches (`snapshots.js`: "favors correctness over
  compression"), so every animal that moved ships all ~40 whitelisted fields every
  tick — **121–180 KB**. `features` re-sends every worn cell whenever its revision
  moves, ~80% of ticks — **11–72 KB** — where `vegetation` and `territory` carry
  real sparse diffs and cost ~1 KB. Broadcast coalescing (2026-08-09) capped the
  *rate* at 20/s and measurably fixed the reported unresponsiveness; this is the
  *size*, and it is the next lever. A sparse `features` diff is a copy of
  `diffVegetation` and needs no protocol bump; field patches for `updated` do. See DOCS §11.
- **⚠ P12 — A coalesced delta is ~95% event payload**, and a step long enough to
  overrun the bounded outbox drops events: ~77 000 emitted at 500 ticks, 8 810
  delivered. World state stays exact; the narration does not. The named fix is
  for a long step to send _no_ events rather than a truncated set — a protocol
  question, not a renderer one.

- **P13 — A large advance blocks the host's event loop for its whole duration**
  (~1.4 ms/tick), so 10 000 ticks is ~14 s unresponsive. UI defaults stay under a
  second; a genuinely long run belongs in `npm run headless`.

- **P11 — The inspection poll runs at a fixed 2 s** whether the simulation is
  paused or running at 8×. The run state is now known, so backing it off while
  paused is a two-line change; left undone because re-fetching identical data is
  cheap.

- **P8 — The whole world is streamed.** Bounded region subscription awaits
  region-scoped deltas; `requestSnapshot(bounds)` is isolated for when they
  exist.

- **P14 — The legend stays glyph-based in sprite mode.** `LegendPanel` is built
  once and knows nothing about sprite assignments; sprite thumbnails would need
  it to become config-aware and re-renderable.

- **P15 — A sprite tint is a flat silhouette only.** One fill clipped to the
  sprite's alpha, matching the single-colour glyph aesthetic; a
  shading-preserving tint mode is unbuilt.

- **P16 — Sprites ignore `heading` and `action`.** Both ride unused in every
  bulk snapshot; directional/pose sprite variants would be an additive slot-id
  suffix, not a rework.

- **P18 — At the 10px zoom floor the social layer's two rings fuse into one line**
  _(opened 2026-08-04 with the layer)_. The gap between the herd label's ring and a
  record's is a proportion of the cell (`max(1.5px, cellSize × 0.14)`), so at the
  floor it is a pixel and a half and an animal in a band inside a herd reads as one
  outline in the band's colour. Still legible as a group boundary, just not as two;
  one zoom level up separates them. The same trade the `»` chevron makes at the
  same floor, and listed for the same reason — so it is not read as a bug.

- **P17 — The flying status mark blinks, because the state genuinely changes every
  ~19 animal-ticks** _(opened 2026-08-04 with phase F1)_. Measured at **52
  ground↔air transitions per 1000 vulture animal-ticks** — an animal alternating
  between a travelling action and a contact one is alternately airborne and
  grounded, and the mark honestly follows. Nothing renderer-side can fix it (the
  renderer portrays authoritative output); the engine lever is
  `flight.takeoffCost`, deliberately unbuilt. Listed so a blinking `»` is not read
  as a rendering fault.
