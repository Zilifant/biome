# Handoff — 2026-07-28 session (species phases 0–3)

Supersedes the earlier 2026-07-28 handoff (phases 0–2), which this file absorbs
rather than replaces — its traps are still live and are repeated in §3. The
2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

This session executed **phases 0, 1, 2, and 3 of
[`PLAN-SPECIES.md`](PLAN-SPECIES.md)**. Phase 3 — the persistent group registry —
was the largest single item in the plan and is the subject of this file.
**No new species were added.** Everything that shipped is documented where it
lives; this records **state, traps, and what to do next**.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **772 passing / 0 failing**, 196 suites (was 742/191) |
| Benchmark large-5k | **77.70 / 78.30 ms/tick**; HEAD interleaved measured **76.21 / 78.94**, so this is **flat** |
| `PROTOCOL_VERSION` | 28 (unchanged — see §5) |
| `SAVE_FORMAT_VERSION` | **28** (was 27) |
| Species | still 3 — grazer, stalker, corvid |
| Species blocks | 11 (unchanged; `groups` is deliberately **not** one — §2) |
| Systems | **23** (was 22) — `GroupSystem` |
| Git | ⚠ **everything is uncommitted**, stacked on the previous sessions' uncommitted work. The user handles git |

⚠ **The machine ran ~10% slower this evening than it did this afternoon**, on
identical code: the same HEAD gave 68.7–72.1 in the afternoon and 76.2–78.9 in
the evening. Every absolute figure above is therefore only comparable to the
interleaved HEAD readings beside it. Do not carry the number forward; re-measure.

---

## 2. What phase 3 shipped

A bounded store of **persistent group records** on the world, beside — never
instead of — the herd label. Full write-up is DOCS §9 Sociality and §9 Persistent
groups; the design record, including where the plan's own sketch was wrong, is
PLAN-SPECIES.md §3.8 "As built".

| Piece | Where |
| --- | --- |
| `GroupRegistry` — the bounded store, `{ id, speciesId, memberIds, founderId, foundedTick }` | `src/simulation/world/GroupRegistry.js` |
| `GroupSystem` — founding, joining, guardian inheritance, sex-biased departure, dissolution | `src/simulation/systems/GroupSystem.js` |
| `groupRecordId` on the entity | `world/EntityManager.js` |
| `config.groups` (world-level + per-species defaults) | `config/defaultSimulationConfig.js` |
| `groups: { forms: false }` stated in all three species files | `config/species/*.js` |
| Save format 27 → 28 | `SimulationSerializer.js` |
| Tests (30 of them) | `test/groups.test.js` |

**Three decisions worth knowing before touching it:**

- ⚠ **`groups` is an always-per-species field, not a `SPECIES_BLOCKS` entry** —
  it follows `migration` and `territory`, not `feeding`/`hunting`/`behavior`. The
  section holds world-level machinery (`enabled`, `updateInterval`, `maxGroups`)
  alongside per-species biology, and a block would have handed every species a
  knob on a store it does not own. **Consequence: there is no config path to make
  an existing species form groups.** `test/groups.test.js` swaps the engine's
  resolved registry to inject an invented clan-forming species; copy
  `withSpecies()` from there rather than inventing a second way.
- ⚠ **No `leaderId` and no `centre`**, though the plan's field sketch named the
  first. Both would contradict rules this codebase already keeps — a stored
  leader is a stored rank ("standing is derived, never stored"), and a saved
  centre is a derived value that can go stale across a load.
- ⚠ **A full store refuses to found; it never evicts.** Evicting would delete a
  clan whose members are all alive. This differs from the tombstone registry on
  purpose, and the difference is now written down in DOCS §11.

**It is inert, and that was measured rather than claimed.** No shipped species
declares `groups.forms: true`, so `GroupSystem` returns on its first branch every
tick. Demo entity state is **byte-identical across seeds 42/7/31 at 1500 ticks**
to the tree without the change. Tracked as DOCS **A55**.

---

## 3. ⚠ Traps, in the order they will bite again

**The first four are inherited from phases 0–2 and are unchanged. They cost real
time and are now failure patterns D25–D28 in DOCS §16.**

1. **A guard can go blind silently, and a passing test is not evidence it is
   looking.** The shared comment stripper read `/*` inside a `//` comment as
   opening a block comment and swallowed 600 lines of config including the whole
   `demo.founding` roster. Fixing it immediately exposed a live violation. (D25)

2. **A hand-written scanner needs its own tests before it polices anything.**
   (D26)

3. ⚠ **A species-level constant is not an entity-level one.** Mass-scaling
   herbivore intake was written up as inert because the grazer sits at
   `referenceMass`; the code reads the *individual's* `bodyMass`, which spans
   5.1–33.7 kg. The claim was written before it was measured. (D27)

4. ⚠⚠ **The hottest function in the engine is arity-sensitive.** A fourth
   argument to `PerceptionSystem#perceive` cost **12% of total engine time**, and
   the whole-system profiler *hid* it (+0.8%), because the wrapper overhead
   perturbed exactly the inlining under test. Measure population trajectory and
   total ms/tick, not a wrapped breakdown. (D28)

5. **D23 fires every time a block is added to `SPECIES_BLOCKS`** — a species'
   resolved block silently beats a system's constructor options, so tests keep
   compiling and stop meaning anything. **Phase 3 dodged this entirely** by not
   adding a block; if you add one later, the fix is always the same: route the
   override through the **config**.

6. **New, and cheap to avoid: `social.minGroupSize` counts groupmates, not
   members.** At 2 it means an animal needs two *others* in range, so the
   smallest herd that exists is **three** animals and a pair is nothing. Two test
   iterations went into rediscovering that. Now stated beside the constant and
   recorded as **D29**.

---

## 4. Measurements taken (dates matter — re-run, never inherit)

**Phase 3 took no ecological measurement, and deliberately so** — the mechanism
cannot change an animal's behaviour until a species opts in, so a ten-seed sweep
would have measured only noise. What was measured instead:

| Claim | How |
| --- | --- |
| The demo is unchanged | entity state hashed over seeds 42/7/31 at 1500 ticks, against a `git stash` of the same tree — **identical** |
| The engine is not slower | four interleaved large-5k runs, tree 77.70/78.30 vs HEAD 76.21/78.94 — overlapping, flat |
| The registry draws no randomness | two engines, one with a clan-forming species and one without, identical animal for animal **and stream for stream** after 50 ticks |

The phase 1/2 ten-seed sweep (mass-scaled intake, carcass nutrient spread) still
stands and is written up in DOCS §9 Feeding and §9 Carcasses. ⚠ Its one stalker
seed lost (10/10 → 9/10) is noise — that seed held exactly **one** stalker in the
control — and was deliberately not tuned around.

---

## 5. Next step: phase 4 — predation structure

Phases 0–3 are done. **Phase 4 is next**: `predation` mass/age eligibility
(§3.6), the `agility` capture term (§3.15), and **carcass possession and theft**
(§3.9). Read those three sections before starting. Notes that matter now:

- **Carcass possession is where the registry gets its first real consumer.**
  Possession can be held by a *group* rather than an individual, which is what
  makes a clan displacing a resident predator work. `resolveContest` in
  `social/dominance.js` already exists and already has a ⚠ **fixed three-draw
  budget** asserted by tests — a contest that sometimes draws four values shifts
  every downstream stream.
- **Put the mass gate *after* `hunts()`, not inside it.** That predicate is the
  busiest in the engine and its linear `includes` was measured, not assumed
  (D24). Gate in `PerceptionSystem`'s classification loop on the rare true case.
- ⚠ **Use `bodyMass`, not `adultMass`** for prey eligibility — age-structured
  prey selection then falls out for free, with nothing new stored.

Then phase 5 (protocol v29), phase 6 (renderer), and **phase 7 is the first
species batch: gazelle + hyena**.

⚠ **Phase 5 carries a debt from this phase.** DOCS **A54**: persistent group
membership is not inspectable through the protocol — no entity projection, no
metrics count, no formation/dissolution events. That was held back on purpose so
it rides v29 rather than costing a second fixture regeneration. It stops being a
scheduling choice and becomes a real invariant-19 defect the moment a species
forms groups, which is phase 7. **Do not let v29 ship without it.**

⚠ **Phase 7 also needs `EventCatalog.js` entries** for anything new it emits
(kill theft, group formation/dissolution), or `test/renderer-*.test.js` fails
against the protocol's type list.

---

## 6. ⚠ Open threads, unchanged and now three sessions old

The 2026-07-23 session's findings are still unaddressed, and the user explicitly
chose to skip them:

- **Edge/corner congregation.** `NOTES.md` Tier 1: "animals still tend to
  congregate around the edges of the map and especially corners. fix this." The
  ranked ideas (flee-toward-interior, predator break-off, openness-aware bedding,
  convex island shape) are preserved in
  [`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md).
- **Disturbance size.** `NOTES.md` Tier 1: "floods/storms/droughts should cover
  MUCH larger areas of the map."

⚠ **Both move where animals are and how often they die**, which by DOCS §15
requires a fresh multi-seed sweep. Doing either *after* species land means
**re-gating every species shipped to that point**. The user was told this and
chose the species plan first — so budget for the re-measure rather than being
surprised by it. Phase 3 does not change this either way, because it changed
nothing.

Also still open: the `escapeHeading` wide-pocket limitation, and **A51 (dynamic
shrub layer)**, scheduled at phase 15.

---

## 7. Three constants left deliberately mass-blind (DOCS §1.4 B7)

Unchanged from the phase 0–2 handoff. Each is waiting for the species that
exposes it:

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock. Changing it
  changes a food source, so it needs its own sweep.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`, so the
  ratio is expressible but untested until two predators differ (batch 2).
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume. The fix is an
  occupancy *cost*, and the cap sits on a measured knife edge.
