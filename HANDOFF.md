# Handoff — 2026-07-29 session (species phase 7, batch 1)

Supersedes the phases 0–6 handoff, which it absorbs; the traps there are still
live and repeated in §3. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

**Phase 7 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) is done: batch 1 has landed.**
The world has **four species** for the first time, and for the first time a
shipped species uses the group registry and the `predation` block. Phases 0–4 are
committed; **phases 5, 6, and 7 are uncommitted.**

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **821 passing / 0 failing**, 208 suites, plus 28 in `tests-ui` |
| `PROTOCOL_VERSION` | 29 (unchanged — batch 1 needed no protocol change) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged) |
| Species | **4** — gazelle, stalker, vulture, **hyena** |
| Benchmark | large-5k **75.7 ms/tick** ⚠ on a changed roster; the hyena is ~+1.6%/animal |
| Closed | **A55** (the group registry fires in the demo) |
| Opened | **A56** (a two-member clan flaps), **P14** carried from phase 6 |
| Git | phases 0–4 committed; **5, 6, 7 uncommitted**. The user handles git |

---

## 2. What phase 7 shipped, in the order it had to happen

**a. `npm run sweep` — the §9 gate, which did not exist.** Per seed and in
aggregate: population by species at each checkpoint, deaths by cause **by
species**, extinction ticks, carrion feeds and mass by species, and group
founding/dissolution. `--control=` runs a second founding roster over the same
seeds **in the same process**, which is the A/B the gate is actually stated in.
⚠ Unlike the benchmark, a sweep is deterministic, so two arms are exactly
comparable and need no interleaving — but a *config* change (a mass, a weight)
still needs two runs, because only a roster difference fits in one.

**b. The rename, proved byte-identical.** `herbivore.grazer` →
`herbivore.gazelle` and `scavenger.corvid` → `scavenger.vulture`: **6.28 MB of
serialized state across three seeds at 1500 ticks, matching exactly modulo the
two id strings.** This is why every dated measurement in `DOCS.md` that says
"grazer" was left alone — a reading records what was true on a date, and renaming
the animal does not change what was measured.

**c. The vulture 4 → 6 kg, as its own arm.** All four species 10/10 seeds; the
stalker *improved* (9/10 → 10/10). ⚠ The gazelle fell ~30 — fewer, larger
vultures leave more carrion, which feeds more stalkers, which kill more gazelle.
A three-step chain nobody predicted and the sweep made visible.

**d. The hyena, behind the ten-seed gate — which it failed first.** See §3.

---

## 3. ⚠ The finding of this phase: a subsidised predator is not limited by its prey

At `minHungerToHunt: 0.35` — a stalker-ish value — the first gate **failed
outright**: **the gazelle went extinct in 7 of 10 seeds**, against a control
where it never went extinct at all, and the vulture halved beside it.

The cause was not that the hyena hunts too well. **Carrion supplied 37% of
everything the world's scavengers took, the hyena population more than doubled on
that subsidy, and the subsidised population then hunted.** A predator whose
numbers do not depend on its prey can eat that prey to extinction without ever
going hungry. That is apparent competition, and it is a genuinely correct thing
for this model to have produced.

Three things worth carrying:

- ⚠ **Lowering the founding count does not fix it, and was tried.** The
  population recovers to whatever *carrion* supports regardless of how many are
  founded — the count changes the ramp, not the ceiling. What fixed it was
  coupling the hunting back to the hunger: `minHungerToHunt: 0.75`, i.e. it hunts
  only when scavenging has failed to feed it.
- ⚠ **The first draft bred faster than the 45 kg stalker**, which is backwards
  for a 60 kg carnivore and was the other half of the collapse. Now 1200/3200
  against the stalker's 1000/2400.
- ⚠ **Expect the same failure mode in batch 2.** The lion is the same shape of
  animal — a large carnivore that also scavenges — and buffalo breed far more
  slowly than gazelle. **Check `minHungerToHunt` first.**

### The passing world, stated with its costs

| Species | With hyena | Control | Read as |
| --- | --- | --- | --- |
| gazelle | **10/10**, mean 95.6 | 10/10, mean 152.1 | suppressed to ~⅔, never extinct — the intended effect |
| stalker | **7/10**, mean 5.1 | 10/10, mean 7.9 | ⚠ **the real cost: three seeds in ten lose the stalker** |
| vulture | **10/10**, mean 116.3 | 10/10, mean 201.3 | ⚠ −42%; §9 warned a halved vulture is a result, not a pass |
| hyena | **9/10**, mean 3.9 | — | establishes, but thinly |

Every species clears ≥6/10 so the batch ships, but two incumbents are materially
reduced and that is recorded rather than rounded off. ⚠ **The stalker is the
species to watch in batch 2, not the vulture the plan expected** — possession
works and the vulture keeps a living; the stalker is squeezed by a competitor for
the same prey that does not depend on it.

---

## 4. ⚠ Other traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** The four that still matter most: a guard
can go blind silently; a species-level constant is not an entity-level one; ⚠⚠
the hottest function in the engine is arity-sensitive; and an off switch must
leave no trace, not merely no effect (D30).

Two new, both from this phase:

⚠ **A blanket find-and-replace across a rename will hit files that needed
deleting, not renaming.** Substituting the ids across `src`/`test` rewrote the
renderer's *superseded* appearance entries into duplicates of their successors —
two `'herbivore.gazelle'` keys in one object literal, where the later silently
wins. Phase 6 had put `supersededBy` there precisely so the answer was "delete
this entry", and the mechanical pass did not know that. **The `supersededBy`
entries are a delete list, not a rename list.**

⚠ **The dotted id is not the only form of the id.** The same pass missed
`#ctl-founding-herbivore-grazer` in `tests-ui/controls.spec.js`, because a DOM id
is the species id with the dots turned into hyphens. `npm test` stayed green;
Playwright caught it. D32 again, from a new direction.

---

## 5. Measurements

- **Sweep gate:** 10 seeds × 15 000 ticks, arm and control in one process. §3.
- **Rename:** byte-identical, three seeds at 1500 ticks.
- **Count-0 hyena:** every non-config section of the save identical across three
  seeds — a declared-but-unfounded species leaves no trace, including one that
  declares `groups.forms` and so switches `GroupSystem` on (D30 satisfied).
- **Benchmark:** large-5k 75.7 ms/tick on the new roster. ⚠ Not comparable to
  the 68.75 of 2026-07-21 — different population. Interleaved medium-1k A/B, three
  rounds alternating: **+4.0% total for +2.4% more animals, ~+1.6% per animal.**
  The within-arm spread (8.05→8.86) exceeds the between-arm gap, so what makes it
  a result is that the hyena arm is slower in **all three rounds**, each measured
  seconds after its own control.

---

## 6. ⚠ Open threads

**New:**

- **A56 — a two-member clan flaps.** 157 foundings against 150 dissolutions in
  3000 ticks on seed 2; 7 and 0 on seed 1. The boundary behaviour of
  `groups.minMembers: 2`. Named fix is hysteresis, ⚠ **not before batch 2** —
  tuning a dissolution delay against the only clan-forming species in the world
  would fit it to a case the mechanism is about to outgrow.
- **P14 — the `/api/metrics` payload has never been measured against a long
  roster.** Due at batch 3.

**Unchanged, and the user explicitly chose to skip them:**

- **Edge/corner congregation** (`NOTES.md` Tier 1) and **disturbance size**.
  ⚠ Both move where animals are and how often they die, so both require a fresh
  multi-seed sweep — and there are now **three** swept results to re-run
  afterwards (the phase-1/2 energy sweep, phase 4's possession sweep, and this
  phase's batch-1 gate). The sweep harness now makes that re-run cheap, which it
  was not when the debt was taken on.

Also open: the `escapeHeading` wide-pocket limitation, **A51 (dynamic shrub
layer)** at phase 15, and the renderer's P6/E3.

---

## 7. Next step: phase 8 — the hidden-fawn phase

Not batch 2. ⚠ **Phase 8 is deliberately separate from phase 7 because both
change juvenile survival**, and A12 exists precisely so two such changes are
never made together with no way to attribute the result.

It carries the A34 experiment — "give patrol a **reason**" — because a hidden
calf is the first genuine reason this world has ever had for an adult to return
to a place. It also interacts with A32 (a stationary calf is far easier geometry
for an interposing parent) and with A12 itself.

⚠ The gazelle is now the animal this is about, and its file already says so: the
hidden-fawn stage is listed there as scheduled rather than missing.

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

⚠ **One of them is now closer to biting.** The roster spans 6 kg to 60 kg.

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock. It interacts
  with possession: a longer-lived body is a longer-held one.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`, and
  ⚠ **the hyena is the first species to differ on `maxStamina`** (120 against
  everyone else's 100), so the ratio this constant implies is no longer uniform.
  Re-check it when the lion arrives.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
