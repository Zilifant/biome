# Handoff — 2026-07-29 session (species phase 9)

Supersedes the phases 7–8 handoff, which it absorbs; the traps there are still
live and repeated in §4. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

**Phase 9 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) is done** — forage guilds and
habitat preference. Phases 0–4 are committed; **phases 5, 6, 7, 8, and 9 are
uncommitted.**

⚠ **Read §2 before touching either mechanism.** Phase 9 shipped its *third*
design; the first two failed the ten-seed gate outright, and both failures were in
the plan's own proposal rather than in the tuning.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **860 passing / 0 failing**, 218 suites (+22 from phase 9's own suite), plus 28 in `tests-ui` |
| `PROTOCOL_VERSION` | 29 (unchanged, and checked rather than assumed: the mechanism stores nothing, and the behaviour it changes is already inspectable — `action` in the snapshot, `utilityBreakdown` in entity inspection) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged — the whole mechanism stores nothing) |
| Species | **4** — gazelle, stalker, vulture, hyena |
| Benchmark | large-5k **79.06 ms/tick** (2026-07-29) — phase 9's own interleaved A/B measured **flat**, and ⚠ 79.06 is *not* comparable to phase 7's 75.7 (different session, different population trajectory) |
| Closed | **A49's habitat half** (habitat preference exists and the gazelle uses it; the activity-pattern half stays open, with no diurnal cycle to hang one on) |
| Opened | **A58** (perception reports the *nearest* food cell, not the best-scoring one) |
| Harness | `npm run sweep --set= / --controlSet=` — a **config** A/B over the same seeds in one process, which the gate needed and nobody had written |
| Git | phases 0–4 committed; **5–9 uncommitted**. The user handles git |

---

## 2. ⚠ Phase 9, and the designs it had to discard

The deliverable is small: a species may state `forage: { preferredBiomass, span }`
(how coarse a sward it can live on) and `habitat: { ground, cover, water, thicket }`
(which terrain it wants). The gazelle states both. Everything else in this section
is what it cost to get there, because **each failure was in the plan's proposal and
each is the kind that would repeat.**

### a. `biomass / capacity` is the wrong axis — use absolute standing crop

`PLAN-SPECIES.md` §3.3 is emphatic that the ratio "**is** the maturity/quality
axis", and it is a good argument: the ratio normalizes away per-cell fertility. It
fails because **a ratio knows nothing about absolute abundance.** In a low-capacity
world every ungrazed cell reads as rank grass — and the sparse-forage selection
sandbox (`vegetation.capacity: 1.0`) is exactly that world, so the gazelle
discounted the only food in it and **went extinct inside 5000 ticks**, breaking a
shipped scenario in `test/metrics.test.js`.

What shipped reads standing crop directly. It is cheaper (the gradient already reads
biomass, so scoring costs **no extra grid read at all**) and physically truer: two
cells holding the same crop are the same height of grass whatever their potential.

### b. A symmetric preference window double-counts scarcity

The obvious shape is a window: ideal at `preferredBiomass`, worse in both
directions. It reads well — a mown lawn has no bite for a gazelle either — and it
**charges the animal twice for one fact**, because a nearly-bare cell already hands
it almost nothing (`consumeAt` returns only what is there). Measured, it punished
exactly the ground a herd lives on, its own grazing halo: the ten-seed gate came
back **gazelle 3/10 seeds against the control's 10/10**, and the stalker and hyena
went down with it.

The falloff is now one-sided — ideal at and below `preferredBiomass`. ⚠ **The other
side of the succession needs no term**: a 300 kg zebra cannot live on a cropped
sward because mass-scaled intake already says so.

### c. ⚠ Scoring a *cue* by preference inverts the animal's motivation

The plan warns that the forage gradient must be scored through the preference, and
it is right. But scoring **both the direction and the strength** from
`biomass × quality` is wrong in a way that is easy to miss: quality is ≤ 1, so it
shrinks the difference between here and there, and an animal surrounded by grass it
dislikes ends up with **almost no reason to move** — when it is precisely the animal
that should be moving. Measured: the drift fell 0.35 → 0.105 in
`test/migration.test.js`'s sandbox.

The rule worth carrying: **a preference chooses the direction; a need sets the
strength.** Same split, differently worded, is what made habitat work (§2d).

### d. Habitat must bend a cue, not compete with one

First cut had habitat compete with forage and water on strength. It went near-inert
the moment the forage cue was restored to full strength — cover occupancy moved
6.9% → 6.3% (measured mid-development, seed 42), where the same weights had moved it
to 4.9% while the forage cue was accidentally weak. That is A34 in miniature: a preference that has to *beat*
foraging either never fires or starves the animal. It now **blends** into whichever
need-heading won, at its own weight, which is the shape the trail drift already
used.

### e. Two consumers were declined on measurement, not taste

§3.4 named three chokepoints. Only the long-range cue was built.

- ❌ Scaling `rest` by the ground underfoot would have been **born near-inert**:
  `rest` is **0.8–1.6%** of animal-ticks in the demo, and it is already gated to
  satisfied animals. Measuring the action distribution *first* is what stopped it.
  (`wander` is 40–77%, which is why the cue is the only place a preference of this
  size can do visible work.)
- ❌ Weighting the home range turns a running average of where an animal has *been*
  into a statement of preference, and its only consumer (`patrol`) is near-inert.

### f. ⚠ A preference needs a `cueRadius`, which three of four species set to 0

Habitat acts only through the long-range cue, and the stalker, vulture, and hyena
all declare `cueRadius: 0` deliberately. **A habitat block on any of them today
would do nothing at all.** A cover-loving leopard needs a cue radius first — batch-4
work, and worth pairing with §3.12.

---

## 3. What the mechanism actually does, measured

The claim is *not* "it resolves correctly" — §1.2 of DOCS is a list of mechanisms
that do that and never fire. Both halves were measured in the demo (seeds 1 and 42,
3000 ticks):

| arm | mean standing crop where a gazelle **eats** | gazelle time on **cover** (2.8% of the map) |
| --- | ---: | ---: |
| both off | 3.31 / 4.25 | 9.2% / 6.9% |
| forage only | 1.97 / 2.88 | 7.3% / 6.4% |
| habitat only | 2.75 / 4.20 | 8.1% / 4.9% |
| both on | 1.93 / 2.88 | 8.4% / 4.3% |

Each half moves its own quantity and neither moves the other much, which is what
attribution looks like when two mechanisms ship together: it grazes shorter grass
and spends less of its life in cover. Both are asserted in `test/habitat.test.js`
against the demo world rather than left as prose.

⚠ **Do not read the population numbers off runs like these.** At 3000 ticks on two
seeds they bounce (both-on 135/148 against the control's 163/147) and say nothing;
the ten-seed gate below is the only statement about survival worth making.

**Gate** (10 seeds × 15 000 ticks, on against off over the same seeds, in one
process). ⚠ **Three arms, because the first two record the design failures in §2:**

| Arm | gazelle | stalker | hyena | vulture |
| --- | --- | --- | --- | --- |
| ratio + symmetric window | **3/10**, mean 0.6 | 3/10, 0.4 | **0/10**, 0.0 | 9/10, 19.4 |
| standing crop, floor 0.30 | 9/10, mean 59.8 | 8/10, 4.9 | 7/10, 1.9 | 10/10, 102.6 |
| **shipped** — floor 0.55 | 8/10, mean **94.3** | 9/10, 4.8 | 9/10, 3.0 | 10/10, 119.1 |
| control (off) | 10/10, mean 81.5 | 9/10, 5.4 | 10/10, 3.4 | 10/10, 133.5 |

The shipped arm puts the gazelle **above** the control's mean and the carnivores level
with it; the vulture is down 11%. ⚠ It loses gazelle seeds 7 and 10 *late* (t13291,
t14275) where the 0.30 arm lost seed 8 — and D14 applies: on a population whose
control range is 15–184, one seed is noise rather than the parameter. Recorded rather
than tuned against, and `forage.qualityFloor` is the knob if a future session wants to
revisit it.

---

## 4. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** Still most dangerous: a guard can go
blind silently; a species-level constant is not an entity-level one; ⚠⚠ the
hottest function in the engine is arity-sensitive; an off switch must leave no
trace (D30).

⚠ **An off switch in a species block is not an off switch** — now a *rule* rather
than an anecdote. Phase 8 found it (`aging.hiddenUntil: 0` cannot switch off a
species that declares its own); phase 9 followed it by construction, putting
`enabled` in global `config.forage` / `config.habitat` and the biology in
always-per-species `forage` / `habitat` fields. **Any per-species mechanism that
needs a reproducible control has this shape.** DOCS §8 and §19 both say so now.

⚠ **Measure the action distribution before adding a consumer.** Two of the three
consumers §3.4 proposed would have been near-inert, and a two-minute count of what
the demo's animals actually *do* (wander 40–77%, rest 0.8–1.6%) said so in advance.
This is the cheap version of the A34/A57 lesson: not "did it work" but "could it
possibly have mattered".

⚠ **A test that paints a uniform field is not painting a uniform signal.** Per-cell
fertility varies 0.55–1, so "fill every cell to the same depth" leaves biomass
uneven and the best direction becomes whichever ray sampled fertile ground. The
first draft of the gradient test asserted a heading it had no right to expect. Stub
`biomassAt` instead, as `test/migration.test.js` already does.

⚠ **A newborn has no `utilityBreakdown` until its first decision tick.**
`test/hiding.test.js` asserted on one and threw a null dereference — a latent
fragility that only fired because a later phase moved a birth by a tick.

---

## 5. Measurements

- **Inertness proved before the gazelle declared anything:** 6.42 MB of serialized
  state identical across three seeds at 1500 ticks with the mechanism on and off.
  ⚠ Take that reading *while the roster still states nothing* — once a species
  declares a preference the arms diverge by design and the check is no longer
  available.
- Attribution by arm — both switches are independent, so all four combinations run
  from the config (§3). Each half moves its own quantity: forage the crop an animal
  feeds on, habitat the terrain it stands on.
- Gate: 10 seeds × 15 000 ticks, mechanism on against off, **in one process over the
  same seeds** using the new `--set=` / `--controlSet=` flags.
- Performance: **flat.** Interleaved medium-1k, three rounds alternating both
  switches: 9.664 vs 9.693 ms/tick, "on" slower in **1 of 3** rounds. ⚠ Both arms hold
  **identical entity counts** at that horizon, which is worth checking whenever a
  behavioural change is benchmarked — a mechanism that changes how many animals are
  alive changes ms/tick for a reason unrelated to its own cost.

---

## 6. ⚠ Open threads

**Unchanged from the last handoff:** A56 (a two-member clan flaps — fix not before
batch 2), A57 (concealment needs cover), P14 (metrics payload at a long roster),
A34 (patrol's target is a place, not a purpose), A32 (the "nearer the predator than
I am" test is the only lever left).

**New or sharpened by phase 9:**

- ⚠ **A57 and the gazelle's habitat preference pull against each other.** A57 wants
  mothers near cover, since a fawn is concealed only if born on sheltering ground;
  an open-plain preference makes that rarer. The named fix is unchanged
  (birth-site selection) and the reason it cannot be folded into `habitat` is now
  concrete: a flat per-terrain weight cannot express a preference that changes with
  the animal's state.
- **Perception's nearest-food scan stays monotonic**, so an animal walks to the
  *nearest* grass rather than the best-scoring grass and decides when it arrives.
  Widening it means scoring every candidate cell in the hottest loop in the engine
  (D28). Fine at one grazer; re-examine at batch 3, when three species disagree
  about what a good cell is.
- **The gazelle's numbers are provisional by design.** It is the only herbivore, so
  nothing constrains where its preference sits relative to anybody else's; batch 3
  re-tunes it into a three-tier succession. That is planned work, not a regression.

**Unchanged, and the user explicitly chose to skip them:** edge/corner
congregation and disturbance size (`NOTES.md` Tier 1). ⚠ Both move where animals
are and how often they die, so both need a fresh multi-seed sweep — and there are
now **five** swept results to re-run afterwards (phase 1/2 energy, phase 4
possession, phase 7 batch 1, phase 8 concealment, phase 9 forage guilds).
`npm run sweep` makes that re-run cheap, and `--set=` now makes the config-only
arms cheap too.

Also open: the `escapeHeading` wide-pocket limitation, **A51** at phase 15, and
the renderer's P6/E3 and P9.

---

## 7. Next step: phase 10 — cooperative action

`attackersFor` cooperative hunting (§3.7), mobbing (A33), and the A32 geometry fix.
Three warnings, two inherited and one from this session:

- ⚠ **Do not tune `hunting.cooperationWeight` against the gazelle.** §9 is explicit:
  cooperative capture only pays when prey is too large for one hunter, so it is
  built at phase 10 and *proved* at phase 11 against the buffalo. A parameter fitted
  to a case it was not built for gets re-tuned twice.
- ⚠ **Mobbing is a `flee` alternative, not a `wander` alternative** (§3.7). That is
  what keeps it from competing with foraging.
- **New:** phase 9's §2c/§2d rule generalizes to both. `attackersFor` and mobbing
  each modify an existing product (`captureChance`, `trampleChance`) rather than
  adding a heading or an action — keep it that way, and if either needs to influence
  *where* an animal goes, bend an existing cue rather than adding a competitor to
  the utility table.

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock; interacts
  with possession.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`, and
  ⚠ the hyena is the first species to differ on `maxStamina` (120 vs 100), so the
  ratio it implies is no longer uniform. Re-check when the lion arrives.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
