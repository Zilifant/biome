# Handoff — 2026-07-30 session (species phases 10 and 11)

Supersedes the phase-9 handoff, which it absorbs; its traps are still live and
repeated in §4. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

**Phases 10 and 11 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) are done** — phase 10
built cooperative hunting and mobbing and measured the A32 lever; phase 11 shipped
the **lion and buffalo**, which are the species those mechanisms were built for.
Phases 0–10 are committed; **phase 11 is uncommitted.**

⚠ **Read §2 and §3 before touching any of it.** Phase 10's two mechanisms shipped
in a shape the plan did not propose, its third deliverable (the A32 fix) was
measured to do nothing, and phase 11 then found that **both mechanisms are
density mechanisms** — they count neighbours, so they fire or not depending on how
close animals stand, which no parameter is named for.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **890 passing / 0 failing**, 226 suites, plus 28 in `tests-ui` |
| `PROTOCOL_VERSION` | 29 (unchanged, and checked rather than assumed — §2c: mobbing needed **no** new event type, because a mobber *is* what `entity.defended` already means, and two new species need none by construction since v29 publishes the roster) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged — neither phase stores anything new; a mob is read off `defendingId`, which was already saved) |
| Species | **6** — gazelle, **buffalo**, stalker, **lion**, vulture, hyena. The roster now spans **6 kg to 600 kg** |
| Benchmark | large-5k **106.51 ms/tick** (7774→9305 entities). ⚠ Every scenario gained the two species, so **no earlier figure describes this world**; the interleaved roster A/B reads **+5.7% per animal**, and it is the buffalo's long-range cue rather than the new mechanisms (§5) |
| Closed | **A33** (mobbing, built phase 10 and demonstrated phase 11) |
| Opened | **A59** (a pride cannot take prey a lone lion would refuse), **A60** (territory is an individual claim, so a group cannot hold ground) |
| Gate | **PASS** — 10 seeds × 15 000 ticks against the batch-1 roster; every species ≥9/10 and the gazelle within 7% of control (§3f). ⚠ **It failed once first**, exactly as §8 predicted |
| Git | phases 0–10 committed (`5403bce phase 10`); **phase 11 uncommitted**. The user handles git |

---

## 2. ⚠ Phase 10, and the three things it found

### a. ⚠⚠ Mobbing is not a new action — it is the half of `defend` nobody built

`PLAN-SPECIES.md` §3.7 proposes mobbing as a `flee` alternative, and its reasoning
is right (it must not compete with foraging). But it points at an action that did
not need to exist. DOCS §7 Decision has described `defend` as *"a predator is on
kin **or a groupmate**; stand and face it"* since Step 23 — and only the **kin**
half was ever implemented.

So mobbing shipped as a second *trigger* for an existing action: same intent, same
`defendingId` field, same slot in the utility table, its own weight because a
herdmate is a different risk from your own calf. **The rule worth carrying:**
⚠ *before adding an action, check whether the action you want is already described
by an existing one and merely unimplemented on one branch.*

### b. ⚠⚠ The A32 lever was built, measured, and is not the constraint

DOCS A32 has named one fix since Step 23: relax "the calf must be nearer the
predator than I am". Built as `decision.interposeSlack`, measured over 2000 ticks
× seeds 1/2/42, `entity.defended`: strict **1/1/0**, slack 2 **0/1/0**, slack 6
**0/1/1**, **no test at all 0/1/1**. Removing the clause entirely does not move
the thing it was blamed for, so it ships at **0**, its identity.

⚠ Measuring the whole chain instead of the last link produced the diagnosis:
predators commit to a **juvenile** in 6–9% of hunter-ticks, and in **1–4 of those
per 2000 ticks** is a living parent within the 6 units it needs to perceive the
hunt. The remaining levers are prey selection and sensory radius — species
biology. `decision.defendTargeted` shipped from that pass on correctness: a parent
defends the calf the hunter actually committed to.

### c. Mobbing needed no protocol bump, and that was checked rather than assumed

A mobber is reported through **`entity.defended`** — *"an adult putting itself
between a predator and a groupmate or its own young"*, which is exactly what it
is. ⚠ Contrast `entity.contested`, where reuse *would* have made the UI lie and
phase 4 correctly took the bump. **The test is whether the existing type's stated
meaning already covers the new fact, not whether the payload happens to fit.**

---

## 3. ⚠ Phase 11, and why every difficulty was about density

The two species are one deliverable: a lion in a gazelle-only world is a heavy
stalker with a group label, and a buffalo with nothing large enough to hunt it
never mobs.

### a. ⚠⚠ Both mechanisms count neighbours, and nothing in their names says so

Cooperation counts hunters committed to **one quarry** within 6 units; mobbing
counts adults within 6 units of the animal under attack. So:

- A pride whose members forage four units apart produced **0 shared-quarry ticks
  in 8 000**. `herdDistance: 2.0` is what turned a shared record into a shared hunt.
- A buffalo herd thin enough to graze alone cannot defend itself however well the
  mechanism resolves — at 20 buffalo, **0 mobbed attempts**.

**Treat `behavior.herdDistance` and the founding count as parameters of any
mechanism that counts neighbours.** Neither reads as one.

### b. ⚠⚠ A lion that also hunts gazelle never hunts buffalo

Perception reports the **nearest eligible** prey (A58), and the demo runs six
gazelle to every buffalo — so a lion listing both spent its life on gazelle:
**2 buffalo attempts in 4000 ticks, 0 cooperative hunts, 0 mob-ticks.** Batch 2
with neither mechanism firing, and every population number looking reasonable.
`preySpeciesIds: ['herbivore.buffalo']` is the fix and is what §3.6 says
`minPreyMassRatio` is *for*.

### c. ⚠⚠ 600 kg broke a species number before it broke any global constant

The §4 mass audit prepared for global constants. What actually broke was
`maxEnergy`: every energy cost is multiplied by `(bodyMass/30)^0.75`, while the
roster's tanks fit ~mass^0.34 — a trend nobody had to defend inside one order of
magnitude. At 600 kg it means starving **3.4× faster** than a gazelle, and the
first measured buffalo died mostly of **exposure**. Two fixes, both species data:

- size the tank on **mass^0.75**, so time-to-starve and time-to-fill are
  mass-independent;
- **widen the comfort band as mass rises** — bulk is what buys cold tolerance, and
  the first draft gave the largest animal in the world a *narrower* band than a
  45 kg stalker. Exposure was a third of buffalo deaths until it was fixed.

### d. ⚠⚠ A pride cannot hold territory (A60)

`TerritorySystem` marks cells by **entity id** and `retreat` moves an animal off
ground *anyone else* marked, pride-mate included. `territory.defends: true` made
the pride scatter itself. The lion therefore has a home range and no claims, and
"shared pride territory" is not expressible — the fix is keying the claim layer on
`groupRecordId`. ⚠ It sharpens **A35**: territory is not predator-only, it is
*solitary*-only.

### e. One correction to phase 10: the hunted animal stands its ground

A fleeing target is carried away from its herd by the chase, so the capture
happens where no mobber can reach it — **not one attempt in 12 000 tick-seeds was
resolved against a mob** until the buffalo turned and faced. Phase 10 had excluded
the target from its own mob on the reasoning that A33 is about animals *coming to
the aid*; measurement said that makes the mechanism unreachable.

### f. The passing world

10 seeds × 15 000 ticks against the batch-1 roster, same seeds, one process:

| Species | batch 2 | batch-1 control | read as |
| --- | --- | --- | --- |
| gazelle | 10/10, mean 82.4 | 10/10, mean 88.7 | **−7%** — barely touched, because the lion does not hunt it and 35 buffalo do not crowd it off the grass |
| buffalo | **9/10**, mean 15.8 | — | establishes from 35 founders; the one loss is late (t14977) |
| stalker | **9/10**, mean 5.1 | 8/10, mean 4.8 | level, and a seed *better* — it competes with neither newcomer |
| lion | **9/10**, mean 10.2 | — | establishes well; the one loss is early (t8017) |
| hyena | 10/10, mean 7.7 | 10/10, mean 3.7 | ⚠ **doubled** — a 600 kg carcass is twenty gazelle, and the facultative scavenger is what that feeds |
| vulture | 10/10, mean 157.8 | 10/10, mean 140.7 | +12%, same reason |

⚠ **This batch costs the incumbents almost nothing and feeds two of them**, which
is the opposite of batch 1. The reason is the prey partition: the lion took a
species nothing else hunts, so all it added to the old food web was 360 kg of
carrion at a time.

### g. The demonstration, as a 2×2

⚠ **The two mechanisms confound each other** — a co-attacked buffalo is usually
also a mobbed one — and the uncontrolled comparison read **backwards** while both
were working perfectly (0.330 with company against 0.391 alone). Controlled, three
seeds × 8000 ticks:

| lion attempt | attempts | mean capture chance | taken |
| --- | ---: | ---: | ---: |
| alone, unmobbed | 31 | 0.451 | 29.0% |
| with a pride-mate, unmobbed | 20 | **0.535** | 70.0% |
| alone, against a mob | 5 | **0.275** | 0% |
| with a pride-mate, against a mob | 8 | 0.331 | 25% |

⚠ **The odds are the claim; the outcomes are context.** At a few dozen attempts the
captured *rate* is a coin flip — one seed read 54.5% with company against 55.6%
alone, the opposite of the pooled figure, from the same mechanism.
`test/cooperation.test.js` asserts the odds inside the 2×2 for exactly that reason.

### h. ⚠⚠ The gate failed first, and the window is narrower than batch 1's

At `minHungerToHunt: 0.3` the buffalo survived **5/10 seeds** (317 of 501 deaths
from predation) while the lion population *grew* on **37.6% of all carrion taken
in the world**. That is phase 7's lesson exactly: a carrion-subsidised predator is
not limited by its prey, so it eats it out.

⚠ The tension is sharper than in batch 1, and it is the thing to carry into
batch 3: **the same number that keeps the prey alive is the one that stops the
pride hunting often enough to demonstrate cooperation.** 0.3 fires the mechanism
and loses the buffalo; 0.6 saves the buffalo and fires nothing; 0.45 does both.

---

## 4. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** Still most dangerous: a guard can go
blind silently; a species-level constant is not an entity-level one; ⚠⚠ the
hottest function in the engine is arity-sensitive; an off switch must leave no
trace (D30).

⚠ **An off switch in a species block is not an off switch.** Applied twice more by
construction: `hunting.cooperationWeight` and `behavior.mobWeight` are biology,
and their switches live in the global `config.cooperation` / `config.mobbing`.

⚠ **Before adding an action, re-read what the existing actions claim to do.**
`defend` had promised the groupmate case for twenty steps (§2a).

⚠ **Measure the whole chain, not the last link.** A32 was blamed on its final
clause for three phases because that is the clause anyone reads (§2b).

⚠ **A mechanism that counts neighbours is a density mechanism.** Both of phase
10's fire only when animals stand close enough, and nothing in `cooperationWeight`
or `mobWeight` says so (§3a).

⚠ **Two mechanisms shipped together will confound each other's measurement.**
Split the cells before comparing (§3f). This is the same warning phase 9 gave
about attribution, in a sharper form: there it was two mechanisms moving different
quantities, here it is two moving the *same* one in opposite directions.

⚠ **A single-seed assertion about the demo is an assertion about a trajectory**,
and a roster change invalidates several at once. Six broke across these two
phases; **none was a regression**:

- `test/habitat.test.js` cover share — pooled over three seeds at phase 10, then
  **reversed outright** at phase 11 when a second grazer arrived (see §6).
- `test/carcass.test.js` compared an endpoint against a 1-in-100 sample.
- `test/groups.test.js`, `test/protocol-v29.test.js`, and `test/predation.test.js`
  each hardcoded "only the hyena". All three now read the roster.

---

## 5. Measurements

- **Phase 10 inertness**: byte-identical entity state, 400 demo ticks at seed 42,
  both switches off. ⚠ That reading is **gone** as of phase 11 — a species now
  declares each weight. What survives is asserted instead: a world with no lion
  and no buffalo is byte-identical with both mechanisms off.
- **Phase 11 zero-count proof** (the §9 procedure's first half): both species
  added at `count: 0` left **5.9 MB of state identical across three seeds**,
  modulo the roster literal itself.
- **A32**: the slack sweep and the funnel in §2b.
- **Gate**: 10 seeds × 15 000 ticks, batch-2 roster against the batch-1 control.
- **Performance**: phase 10 measured **flat** (interleaved medium-1k, 9.229 off vs
  9.190 on, identical entity counts). ⚠ Phase 11 adds ~30% more animals to every
  benchmark scenario *and* animals that are 600 kg, so its figures are a new
  baseline rather than a comparison — see `BENCHMARK.md`.

---

## 6. ⚠ Open threads

**Unchanged:** A56 (a two-member clan flaps), A57 (concealment needs cover), P14
(metrics payload at a long roster), A34 (patrol's target is a place, not a
purpose), A58 (nearest rather than best), the `escapeHeading` wide-pocket
limitation, A51 at phase 15, and the renderer's P6/E3 and P9.

**New or sharpened:**

- **A32** stays open with a new diagnosis and no lever left in the defense code.
- **A33 closed** — mobbing is built and demonstrated.
- **A59**: cooperation cannot change *eligibility*, so a lone lion commits to a
  buffalo it takes 29% of the time. This world can say "a pride is better at it",
  not "only a pride will try it".
- **A60**: territory is an individual claim; a group cannot hold ground.
- ⚠ **A second grazer reversed a phase-9 finding, and it is not a regression.**
  Habitat preference was measured at phase 9 to move the gazelle *out* of cover;
  with the buffalo in the world the gazelle now spends **more** time in cover with
  preference on (6.6→6.9, 3.9→7.0, 3.7→4.8 percent across three seeds), because a
  600 kg animal with its own open-ground preference grazes the ground both want
  and displaces the smaller one. That is competitive displacement — the first
  two-herbivore interaction in this project, and what §2 is entirely about. The
  test now asserts the claim that is actually about the mechanism: **the species
  that declares a preference acts on it** (buffalo on open ground, 93.9% with the
  cue against 83.6% without, seed 42).
- ⚠ **B7's constants are no longer hypothetical.** `carcass.decayTicks` now has a
  600 kg body on a 6 kg animal's clock, and it is the mechanism behind the lion's
  carrion subsidy. Fixing it changes a food source, so it needs its own sweep —
  and it is the first thing to try if batch 3 sees the same apparent-competition
  failure.

**Unchanged, and the user explicitly chose to skip them:** edge/corner
congregation and disturbance size (`NOTES.md` Tier 1). ⚠ There are now **seven**
swept results to re-run afterwards.

---

## 7. Next step: phase 12 — batch-3 prerequisites

Heterospecific association (§3.16) and seasonal breeding windows (§3.11), then
batch 3 (wildebeest + zebra) at phase 13. Four warnings:

- ⚠ **Batch 3 is three grazers on one grass**, which is the competitive-exclusion
  case §2 is about — and phase 11 has now shown it happening in miniature (§6).
  Expect the gazelle's `forage` numbers to move; §3.3 always said they would.
- ⚠ **`social.maxGroupSize: 12` is still a global cap on a herd label**, and §7
  asked for a decision on it "before batch 2". It was not needed there — 35
  buffalo never crowd one label — but wildebeest are the species the cap is wrong
  for. Decide it at batch 3 with the measurement in hand.
- ⚠ **`hunts()` is due for re-measurement** once a roster reaches four or five
  prey entries (§7). The lion has one; nothing has forced it yet.
- **Density, again.** Anything that counts neighbours is a density mechanism
  (§3a), and batch 3 adds two herd species at once.

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

- `carcass.decayTicks` — ⚠ **now live**: see §6.
- `hunting.captureStaminaCost` — flat against a `maxStamina` that now ranges
  80 (lion) to 120 (hyena), so the ratio it implies varies 50%.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume, and the world now
  holds animals that differ 100× in mass.
