# Handoff — 2026-07-28 session (species groundwork, phases 0–2)

Supersedes the 2026-07-23 handoff, moved verbatim to
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md) — its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open. (`legacy-docs/HANDOFF.md` is an older file again.)
Those threads are **untouched by this session** — see §6, because they now
interact with this work.

This session executed **phases 0, 1, and 2 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md)**:
the groundwork for a multi-species roster. No new species were added. Everything
that shipped is documented where it lives; this file records **state, traps, and
what to do next**.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **742 passing / 0 failing**, 191 suites (was 725/189) |
| Benchmark large-5k | **69.50 ms/tick**. Unmodified HEAD measured 69.2 / 70.6 / 72.1 the same afternoon, so this is **flat** |
| `PROTOCOL_VERSION` | 28 (unchanged) |
| `SAVE_FORMAT_VERSION` | 27 (unchanged) |
| Species | still 3 — grazer, stalker, corvid |
| Species blocks | **11** (was 8): `feeding`, `hunting`, `behavior` added |
| Git | ⚠ **everything is uncommitted on `main`**, stacked on the previous session's uncommitted work. The user handles git |

⚠ **Do not compare against the 67.25 ms/tick figure in older notes.** It predates
line of sight, thickets, the water field, and the crowding cap. The honest
baseline is "HEAD measured on the same machine in the same session", which is why
§1 quotes three HEAD samples rather than one.

---

## 2. What shipped (pointers only — documented where it lives)

| Change | Where it's documented |
| --- | --- |
| One-pass comment stripper shared by all three source scans; demo roster exempted **by name** | DOCS §2.3; `test/helpers/sourceScan.js`; `test/source-scan.test.js` |
| `feeding`, `hunting`, `behavior` → `SPECIES_BLOCKS` | DOCS §8; `config/species/schema.js` |
| `config.decision` split into `behavior` (per-species) + `decision` (global) | DOCS §9 Decision, §19; the two config sections |
| Herbivore intake mass-scaled (`feeding.massScaleIntake`) | DOCS §9 Feeding; §1.6 A52 |
| Carcass nutrients spread over a patch (`carcass.nutrientSpreadRadius`) | DOCS §9 Carcasses; §1.6 A53 |
| Per-species `foodMinLevel`; `drinkRange` and `carcassRange` de-duplicated | DOCS §19 |
| Load-time rejection of a save naming an unknown species | DOCS §12; `SimulationSerializer.js` |
| Mass audit with a written verdict per constant | DOCS §1.4 B7; the config comments |

**New config levers**, all defaulting to current behaviour:
`feeding.massScaleIntake` (false = the old flat rate),
`carcass.nutrientSpreadRadius` (0 = the old single-cell deposit). Both were used
as measurement controls and should stay.

---

## 3. ⚠ Traps this session hit, in the order they will bite again

**These cost real time. Three are now failure patterns D25–D28 in DOCS §16.**

1. **A guard can go blind silently, and a passing test is not evidence it is
   looking.** All three source scans shared a comment stripper that read `/*`
   inside a `//` comment as opening a block comment — and
   `defaultSimulationConfig.js` contains exactly that. It swallowed 600 lines
   including the whole `demo.founding` roster. Fixing it **immediately exposed a
   live violation the blind version had been hiding**. (D25)

2. **A hand-written scanner needs its own tests before it polices anything.** The
   replacement stripper had a bug of its own — it left template-literal mode at
   `${` and never returned, so a file of HTML templates desynced. (D26)

3. ⚠ **A species-level constant is not an entity-level one.** Mass-scaling
   herbivore intake was written up as "inert — the grazer sits at
   `referenceMass`, so its factor is 1". **That was wrong**: the code reads the
   *individual's* `bodyMass` (`adultMass × size` walked up a growth curve), which
   spans 5.1–33.7 kg. A half-grown grazer's intake fell ~40%. The claim was
   written before it was measured. (D27)

4. ⚠⚠ **The hottest function in the engine is arity-sensitive.** Making
   `foodMinLevel` per-species meant passing it alongside `radius` into
   `PerceptionSystem#perceive` — four arguments instead of three. That cost
   **12% of total engine time**. An A/B pinned it on the *arity alone*. Passing
   the resolved block as one object fixed it. **And the whole-system profiler hid
   it**: wrapping prototypes to time each system showed only +0.8%, because the
   wrapper overhead perturbed exactly the inlining under test. (D28)

5. **D23 fires every time a block is added to `SPECIES_BLOCKS`, and worse than a
   clean break.** `injury.test.js` set `baseCaptureChance: 0` via a constructor
   to *guarantee* failed hunts; the species block silently won, so those tests
   had been passing on luck. **The fix is always the same: route the override
   through the config**, which is what the registry resolves against. Expect this
   for `behavior` overrides too — `social.test.js` and `territory.test.js` were
   converted this session and are the pattern to copy.

---

## 4. Measurements taken (dates matter — re-run, never inherit)

**Ten seeds × 15 000 ticks, four arms**, because two changes both touched an
energy source and A12's reasoning is that two changes to one quantity leave no
way to attribute the result. Populations are grazer / stalker / corvid:

| Arm | intake | carcass return | survival | mean population |
| --- | --- | --- | --- | --- |
| control | flat | one cell | 10 / **10** / 10 | 143.6 / 5.4 / 242.5 |
| intake | scaled | one cell | 10 / **9** / 10 | 173.5 / 6.3 / 215.9 |
| carcass | flat | spread | 10 / **10** / 10 | 153.9 / 7.1 / 222.0 |
| both | scaled | spread | 10 / **9** / 10 | 170.0 / 8.4 / 227.7 |

Scaled intake **raises grazer carrying capacity ~21%** — juveniles no longer eat
an adult ration while paying a juvenile's upkeep.

⚠ **The one stalker seed lost (10/10 → 9/10) is almost certainly noise, and was
deliberately not tuned around.** That seed held exactly **one** stalker in the
control — a coin flip, not a surviving predator — and D14's rule is that a
one-seed difference is the signature of noise. Stalker *means* move the other way
in every arm. If a future change makes stalkers look fragile, this is the prior.

---

## 5. Next step: phase 3 — the persistent group registry

Phases 0–2 are done; **phase 3 is next and it is the largest single item in the
plan.** Read `PLAN-SPECIES.md` §3.8 before starting. In short:

- A bounded record store on the world for **persistent** social groups (lion
  prides, hyena clans), in the shape of the precedents that already exist —
  disturbances (≤3), tombstones (256 FIFO), `FeatureGrid` (8192).
- ⚠ **It overrides a documented design decision.** DOCS §9 Sociality currently
  says "a herd is a label, not a roster. Nothing anywhere holds a membership
  list." That section **must be rewritten to say so**, not quietly changed. The
  existing herd-label mechanism is *kept* alongside it — the two model different
  things (fission–fusion aggregation vs. identity that survives separation).
- ⚠ **Two systems must never write the same field.** The registry must not write
  `groupId`; that belongs to `SocialSystem`. Membership is a separate field with
  a single declared writer.
- Costs to plan for: a `SAVE_FORMAT_VERSION` bump, a protocol projection
  (invariant 19 — "which pride is this lion in" is inspectable behaviour), a
  stated dissolution/eviction policy, and deterministic (ascending-id) iteration.

Then phase 4 (predation structure), phase 5 (protocol v29), phase 6 (renderer),
and **phase 7 is the first species batch: gazelle + hyena**.

---

## 6. ⚠ Open threads from the previous session that now interact with this work

The 2026-07-23 session's findings are **unchanged and unaddressed**, and the user
explicitly chose to skip them for now:

- **Edge/corner congregation.** `NOTES.md` Tier 1 says "animals still tend to
  congregate around the edges of the map and especially corners. fix this." The
  previous handoff's ranked ideas (flee-toward-interior, predator break-off,
  openness-aware bedding, convex island shape) are all still unbuilt and are
  preserved in
  [`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md).
- **Disturbance size.** `NOTES.md` Tier 1: "floods/storms/droughts should cover
  MUCH larger areas of the map."

⚠ **Both move where animals are and how often they die**, which by DOCS §15
requires a fresh multi-seed sweep. Doing either *after* species land means
**re-gating every species shipped to that point**. The user was told this and
chose to proceed with the species plan first — so budget for the re-measure
rather than being surprised by it.

Also still open and unchanged: the `escapeHeading` wide-pocket limitation, and
**A51 (dynamic shrub layer)**, which `PLAN-SPECIES.md` now schedules at phase 15
because it is what makes rhino and elephant browsers rather than heavy grazers.

---

## 7. Three constants left deliberately mass-blind (DOCS §1.4 B7)

The mass audit gave every candidate a written verdict in its config comment.
Three came back **open**, each waiting for the species that exposes it:

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock. Changing it
  changes a food source, so it needs its own sweep.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`, so the
  ratio is expressible but untested until two predators differ (batch 2).
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume. The fix is an
  occupancy *cost*, and the cap sits on a measured knife edge.
