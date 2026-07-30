# Handoff — 2026-07-29 session (species phases 7–8)

Supersedes the phases 0–6 handoff, which it absorbs; the traps there are still
live and repeated in §4. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

**Phases 7 and 8 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) are done.** Batch 1
landed (four species), and the hidden-fawn stage landed after it as its own
measured change. Phases 0–4 are committed; **phases 5, 6, 7, and 8 are
uncommitted.**

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **838 passing / 0 failing**, 213 suites, plus 28 in `tests-ui` |
| `PROTOCOL_VERSION` | 29 (unchanged — neither phase needed a protocol change) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged) |
| Species | **4** — gazelle, stalker, vulture, hyena |
| Benchmark | large-5k **75.7 ms/tick** ⚠ on a roster that gained the hyena; phase 8 measured **flat** (§5) |
| Closed | **A55** (the group registry fires in the demo) |
| Opened | **A56** (a two-member clan flaps), **A57** (concealment needs cover), **P14** |
| Advanced | **A34** — its named lever was tested and worked; **A32** — its second hoped-for fix failed |
| Git | phases 0–4 committed; **5–8 uncommitted**. The user handles git |

---

## 2. Phase 7 — batch 1 (gazelle + hyena)

**a. `npm run sweep`, the §9 gate harness**, which did not exist. Population by
species at checkpoints, deaths by cause by species, extinction ticks, carrion by
species, group founding/dissolution. `--control=` runs a second roster over the
same seeds in one process. ⚠ Unlike the benchmark a sweep is deterministic, so
two arms are exactly comparable and need no interleaving — but a *config* change
still needs two runs, since only a roster difference fits in one.

**b. The rename, proved byte-identical.** `herbivore.grazer` →
`herbivore.gazelle`, `scavenger.corvid` → `scavenger.vulture`: 6.28 MB of
serialized state across three seeds at 1500 ticks, matching modulo the two id
strings. This is why dated "grazer" measurements in DOCS.md were **left alone** —
a reading records what was true on a date.

**c. Vulture 4 → 6 kg**, its own arm: all species 10/10, stalker 9/10 → 10/10.

**d. The hyena — and ⚠ its gate failed first, which is the finding.** At a
stalker-ish `minHungerToHunt: 0.35` the gazelle went **extinct in 7 of 10 seeds**.
The cause was not that it hunts too well: **a facultative scavenger is not limited
by the prey it hunts.** Carrion supplied 37% of everything scavenged, the hyena
population doubled on that subsidy, and the subsidised population then hunted —
apparent competition. ⚠ **Lowering the founding count does not fix it, and was
tried**; the population recovers to whatever carrion supports. The fix was
coupling hunting back to hunger (`minHungerToHunt: 0.75`) and correcting a draft
that bred *faster* than the 45 kg stalker.

Passing world, with its costs: gazelle 10/10 (mean 95.6 vs control 152.1),
stalker **7/10** (vs 10/10), hyena 9/10, vulture 10/10 (mean 116.3 vs 201.3).
⚠ **The stalker, not the vulture, is the species batch 2 must watch.**

---

## 3. Phase 8 — the hidden-fawn stage, and what it proved

Three parts: `aging.hiddenUntil`, a `hide` action (the calf lies still instead of
following), concealment in perception (a fawn on sheltering ground is not reported
as prey), and a `tend` action (the mother returns to a hungry hidden calf).

### ✅ A34's lever works, and this is the phase's real result

DOCS A34 has recorded for six steps that routine site fidelity is near-inert
because it competes with foraging and has **no reason**, and named the fix: "give
patrol a reason — food worth returning to, or a den." `tend` is patrol's shape
with a reason attached. In the same worlds, on the same tick budget:

| | seed 1 | seed 2 | seed 42 |
| --- | ---: | ---: | ---: |
| `tend` adult-ticks / 3000 | 1455 | 1045 | 1061 |
| `patrol` adult-ticks / 3000 | 0 | 1 | 0 |

A34 stays open, but for a sharper reason: **`patrol`'s target is a place rather
than a purpose.** The pull is scaled by the *calf's* hunger, which is what stops
`tend` being either inert or always-wins.

### ⚠ Two honest negative results

- **A32 did not improve.** §3.14 expected a stationary calf to be easier geometry
  for an interposing parent. `entity.defended` moved 0→0, 1→1, 0→1. Both
  hoped-for fixes have now failed, so the blame moves to the "nearer the predator
  than I am" test itself — now the only lever left.
- **A57 (new): concealment only applies to a fawn born on cover.** Nothing makes a
  mother choose sheltering ground, so **7.6–11.1%** of hiding calf-ticks are
  concealed — tracking the 7.2–9.9% of the map that shelters. Concealment is
  *sampled, not chosen*. The `hide` half is 100% effective; the invisibility half
  is near-inert. Named lever: birth-site selection, its own measured step.

### ⚠ The trap that fired, and it is the codebase's nastiest one

**A species block beats the config** (DOCS §8), so `config.aging.hiddenUntil: 0`
does **not** switch this off — the gazelle's own 120 stands and the "off" arm
silently stays on. My first A/B did exactly that; a guard in the measurement
script caught it. The fix is a world-level `config.parenting.concealment`, and
**any future per-species mechanism needing a reproducible control has this
shape** — the off switch cannot live in the block the species overrides.

### Gate

10 seeds × 15 000 ticks against the phase-7 baseline on the same seeds. Survival
held or improved for **every** species: gazelle 10/10 → 10/10, stalker **7/10 →
9/10**, hyena 9/10 → 10/10, vulture 10/10 → 10/10. Means moved within the demo's
known noise band. It ships as fidelity that costs nothing, not as a rescue.

---

## 4. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** Still most dangerous: a guard can go
blind silently; a species-level constant is not an entity-level one; ⚠⚠ the
hottest function in the engine is arity-sensitive; an off switch must leave no
trace (D30).

New this session:

⚠ **A blanket find-and-replace across a rename hits files that needed deleting.**
Substituting ids across `src`/`test` rewrote the renderer's *superseded*
appearance entries into duplicates of their successors — two identical keys in one
object literal, later silently winning. Phase 6 had added `supersededBy` so the
answer was "delete this entry"; the mechanical pass did not know that. **The
`supersededBy` entries are a delete list, not a rename list.** The same pass also
wrote `Was \`herbivore.gazelle\` until…` into two docstrings that meant to name
the *old* id — caught by reading, not by a test.

⚠ **The dotted id is not the only form of the id.** The pass missed
`#ctl-founding-herbivore-grazer` in `tests-ui/`, because a DOM id is the species id
with dots turned to hyphens. `npm test` stayed green; Playwright caught it (D32).

⚠ **An off switch in a species block is not an off switch.** §3 above.

---

## 5. Measurements

- Phase 7: sweep gate 10×15k (arm + control in one process); rename
  byte-identical; count-0 hyena leaves every non-config section identical.
- Phase 8: sweep gate 10×15k against the phase-7 baseline; `tend`/`patrol` and
  `entity.defended` counts on three seeds; concealed-fraction against
  sheltering-ground fraction.
- **Phase 8 performance: flat.** Interleaved medium-1k with
  `parenting.concealment` off and on, three rounds alternating: 8.73 vs 8.64
  ms/tick (−1.0%, ranges overlapping). ⚠ Note the contrast with the hyena
  measurement, which was slower in **all three** rounds — that is what a real cost
  looks like; an arm that wins two rounds and loses one is what **no effect** looks
  like. The ordering across interleaved rounds is the signal, not the means.

---

## 6. ⚠ Open threads

**New or advanced:** A56 (clan flapping, fix not before batch 2), A57
(concealment needs cover), P14 (metrics payload at a long roster), and A34/A32 as
described in §3.

**Unchanged, and the user explicitly chose to skip them:** edge/corner
congregation and disturbance size (`NOTES.md` Tier 1). ⚠ Both move where animals
are and how often they die, so both need a fresh multi-seed sweep — and there are
now **four** swept results to re-run afterwards (phase 1/2 energy, phase 4
possession, phase 7 batch 1, phase 8 concealment). `npm run sweep` makes that
re-run cheap, which it was not when the debt was taken on.

Also open: the `escapeHeading` wide-pocket limitation, **A51** at phase 15, and
the renderer's P6/E3 and P9.

---

## 7. Next step: phase 9 — forage guilds and habitat

Phase 9 is `biomass / capacity` grass-maturity preference plus a `habitat` block
(closing A49). Two warnings the plan already carries and one this session adds:

- ⚠ It makes forage preference **non-monotonic** in biomass for the first time.
  Everything assuming "more grass is better" needs checking — especially
  `MigrationSystem`'s forage gradient and `world.nearestFood`, or a gazelle
  steering toward maximum biomass while preferring low biomass will oscillate.
- ⚠ Expect to **re-tune the gazelle** when the larger grazers arrive in batch 3;
  it is currently the only herbivore and its preference is unconstrained.
- **New:** A57's named lever (birth-site selection) is habitat-shaped work. If
  phase 9 gives species a per-terrain preference, a female near term preferring
  cover becomes a natural extension of it rather than a separate mechanism —
  worth folding in there rather than building twice.

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock; interacts
  with possession.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`, and
  ⚠ the hyena is the first species to differ on `maxStamina` (120 vs 100), so the
  ratio it implies is no longer uniform. Re-check when the lion arrives.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
