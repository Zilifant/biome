# Handoff — 2026-07-28 session (species phases 0–4)

Supersedes the phases 0–3 handoff, which it absorbs; the traps there are still
live and repeated in §3. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

This session executed **phases 0–4 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md)**.
Phases 0–3 are committed; **phase 4 — predation structure — is what this file is
about.** No new species were added.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **796 passing / 0 failing**, 202 suites (was 772/196) |
| Benchmark large-5k | tree **85.11 / 85.33 ms/tick**, HEAD **83.94 / 84.55**, and ⚠ tree with possession **off** 84.73 — see §4 |
| `PROTOCOL_VERSION` | 28 (unchanged — see §5) |
| `SAVE_FORMAT_VERSION` | **29** (was 28) |
| Species | still 3 — grazer, stalker, corvid |
| Species blocks | **12** — `predation` joined |
| Systems | 23 (unchanged) |
| Git | phases 0–3 are committed; **phase 4 is uncommitted**. The user handles git |

---

## 2. What phase 4 shipped

Three things, and it matters which are inert and which is not.

| Change | Inert? | Where |
| --- | --- | --- |
| `predation` block: prey mass ceiling/floor, gated in perception **both ways** | ✅ exactly — no species states a ratio | `predation/predation.js`, `PerceptionSystem` |
| `hunting.agility` — the missing manoeuvre term in `captureChance`, **prey-resolved** | ✅ exactly — default 1 | `HuntingSystem` |
| `predation.riskyMassRatio` — replaces a hardcoded `2` in the hunter's injury odds | ✅ exactly — default 2 | `HuntingSystem` |
| **Carcass possession and kill theft** | ❌ **live in the demo** | `predation/possession.js`, `FeedingSystem`, `DecisionSystem` |

⚠ **"Inert" is measured, not claimed.** With possession switched off the demo is
**state-identical to phase-3 HEAD on every entity field**, across three seeds at
1500 ticks. That is what makes possession the single attributable change and the
only one that needed a sweep.

**Possession in one paragraph.** A carcass carries `possessorId`; feeding claims
it; another carnivore feeds beside the holder (same `groupRecordId` — a clan
shares a kill), takes it by contest if it is stronger, or picks at the edge for
`possessionShare` of its normal intake. Possession is held by **presence**, so
there is no timer to expire and no stale claim to clear. Group-held possession is
read off the live holder, so phase 3's registry is its first real consumer.

---

## 3. ⚠ Traps, in the order they will bite again

**D25–D28 are inherited and unchanged** — a guard can go blind silently; a
hand-written scanner needs its own tests; a species-level constant is not an
entity-level one; and ⚠⚠ **the hottest function in the engine is arity-sensitive**
(one extra parameter on `#perceive` once cost 12% of total engine time, and the
per-system profiler *hid* it). Phase 4 touched `#perceive` and stayed at three
arguments by passing the whole species record; §4 has the measurement.

Two new ones from this phase:

1. ⚠ **An off switch must leave no trace, not merely no effect** (now **D30**).
   Possession shipped behind `possessionEnabled`, and with the switch off the
   feeding system still stamped `possessorId` on every body it fed from. Nothing
   read it, nothing failed — but the "control" was the old world *plus a field*,
   which would have made every "identical to before" claim in this phase quietly
   false. Caught only because a test asserted the control claims **nothing**
   rather than merely behaving the same. Put the guard on the write.

2. ⚠ **The predicted victim was the wrong one, and the predicted mechanism was
   the wrong one.** `PLAN-SPECIES.md` §10.1 says of carcass contention that "the
   vulture is the species at risk, not the stalker". Strict exclusion cost
   **stalker** survival 9/10 → 6/10 — and not by robbing predators of carrion
   (per-capita carrion barely moved) but by locking *young* ones out:
   `dominanceOf` halves for immaturity, so a subadult stalker scores below a
   well-fed adult corvid, and the demo runs ~80 corvids to ~7 stalkers.
   **Diagnose before tuning** — a turn-away counter and per-species deaths-by-cause
   found it in one run, where a parameter sweep would have found nothing.

---

## 4. Measurements (dates matter — re-run, never inherit)

**Ten seeds × 15 000 ticks, three arms**, because possession is the only change
in the phase that a shipped world can feel:

| Arm | bystander gets | survival g/s/c | mean population |
| --- | --- | --- | --- |
| control | possession off | 10 / **9** / 10 | 161.4 / 9.1 / 76.5 |
| strict | nothing (`share: 0`) | 10 / **6** / 9 | 176.2 / 7.6 / 80.3 |
| shared | a quarter rate | 10 / **9** / 10 | 158.8 / 8.6 / 86.4 |

Stalker deaths by cause tell the story better than the means do — strict moves
them from `age` to `starvation` (9 → 17) and `dehydration` (2 → 13), and the
shared arm puts them back. Full tables in DOCS §9 Carcasses. ⚠ Read the mean
populations as noise: per-seed stalker counts move as much between arms as
between seeds.

**Benchmark, interleaved, large-5k:** tree 85.11 / 85.33, HEAD 83.94 / 84.55 —
and, decisively, **tree with possession off 84.73 with identical entity counts**.
So the perception edit is free and the ~1% is the mechanism doing real work.
⚠ The machine drifted ~10% *again* across the session (the same HEAD read 76–79
earlier in the evening), which is why only interleaved readings are quoted.

---

## 5. Next step: phase 5 — protocol v29

Phases 0–4 are done. **Phase 5 is the protocol bump**, and it now carries a
two-phase debt that must not be dropped:

- **§6's own scope:** restart takes `founding: [{ speciesId, count }]`, the host
  publishes its species roster, the renderer generates one field per species,
  and the ethologist's flags follow. Keep the three role fields as accepted
  aliases for one version.
- ⚠ **DOCS A54, owed from phases 3 and 4:** the group projection ("which pride
  is this lion in"), `possessorId` on carcass inspection, and **at least one new
  event type** for kill theft with its `EventCatalog.js` entry. Possession is
  *live in the demo* and currently emits nothing, so an observer sees a scavenger
  stop eating for no stated reason — that is the sharper half of the debt.
- ⚠ **Reusing `entity.contested` for a carcass fight was considered and
  rejected**: the renderer labels it "contests over a mate", so it would make the
  UI lie, which is the exact thing v29 exists to stop. Do not revisit it.
- ⚠ `npm run fixtures:renderer` is **mandatory** on the bump —
  `SUPPORTED_PROTOCOL_VERSION` is checked on every message, so a bump without
  regeneration leaves fixture mode refusing everything.

Then phase 6 (renderer scale) and **phase 7 is the first species batch: gazelle +
hyena**. Notes for that batch that phase 4 changed:

- The hyena is the first species that will actually **set** `predation` ratios
  and `groups.forms`. Both mechanisms are built and tested but have never run
  against a species that wanted them, so budget for the first real tuning there.
- ⚠ **`possessionShare` will want re-visiting with a 60 kg hyena and a 6 kg
  vulture**, which is the pairing the mechanism was designed for. 0.25 is what
  the *corvid–stalker* world measured, not a universal constant.

---

## 6. ⚠ Open threads, unchanged and now three sessions old

The 2026-07-23 findings are still unaddressed, and the user explicitly chose to
skip them:

- **Edge/corner congregation.** `NOTES.md` Tier 1. Ranked ideas preserved in
  [`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md).
- **Disturbance size.** `NOTES.md` Tier 1: floods/storms/droughts should cover
  much larger areas.

⚠ Both move where animals are and how often they die, which by DOCS §15 requires
a fresh multi-seed sweep — and phase 4 has now added a second sweep that would
need re-running afterwards, not just the phase-1/2 one. Budget for the re-measure.

Also still open: the `escapeHeading` wide-pocket limitation, and **A51 (dynamic
shrub layer)**, scheduled at phase 15.

---

## 7. Three constants left deliberately mass-blind (DOCS §1.4 B7)

Unchanged. Each waits for the species that exposes it:

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock. Changing it
  changes a food source, so it needs its own sweep. ⚠ Note it now interacts with
  possession: a longer-lived body is a longer-held one.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
