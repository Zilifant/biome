# Handoff — 2026-07-28 session (species phases 0–5)

Supersedes the phases 0–4 handoff, which it absorbs; the traps there are still
live and repeated in §3. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

This session executed **phases 0–5 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md)**.
Phases 0–4 are committed; **phase 5 — protocol v29 — is uncommitted and is what
this file is about.** No new species have been added yet; **phase 7 is the first
batch (gazelle + hyena)** and everything it needs now exists.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **812 passing / 0 failing**, 206 suites (was 796/202), plus 25 in `tests-ui` |
| `PROTOCOL_VERSION` | **29** (was 28) — fixtures regenerated |
| `SAVE_FORMAT_VERSION` | 29 (unchanged this phase) |
| Species | still 3 — grazer, stalker, corvid |
| Species blocks | 12 |
| Systems | 23 |
| Benchmark | not re-measured — phase 5 changed no engine behaviour (§4) |
| Git | phases 0–4 committed; **phase 5 uncommitted**. The user handles git |

---

## 2. What phase 5 shipped

Two things, taken in one version on purpose.

**a. The founding roster (§6).** `simulation.restart` took three per-role counts
— `herbivores`, `predators`, `scavengers` — which assumed a bijection between a
role and a species. It now takes `founding: [{ speciesId, count }]`, and **the
host publishes its roster** on `/api/status` so the renderer builds one field per
species from what it is told. The three role fields are accepted for one version
and translated host-side; the renderer no longer sends them.

**b. The A54 debt from phases 3 and 4**, paid in the same bump rather than a
second one: the `group` block and `possessorId` on entity inspection, a `groups`
aggregate on `/api/metrics`, and three event types — `entity.robbed`,
`entity.grouped`, `entity.ungrouped` — each with its `EventCatalog` entry.

**Four decisions worth knowing before touching it:**

- ⚠ **A roster replaces; a role alias patches.** `founding` is what the world is
  founded with, full stop — a species left out gets none, because "found only the
  gazelle" has to be expressible. The role fields could never mean that, so they
  override three counts inside the default roster, exactly as at v28.
- ⚠ **Both forms in one command is refused**, not resolved.
- ⚠ **The protocol does not know which species exist** and deliberately does not
  learn. It validates shape and bounds; the host rejects an unknown id loudly,
  naming it. `FOUNDING_ROLE_ALIASES` is the one place a species id appears in
  `src/protocol`, and exists only to retire — **delete it at v30**, along with the
  alias branches in `validation.js` and `buildDemoConfig`.
- ⚠ **`entity.robbed` is not `entity.contested`.** The payloads are nearly
  identical and reusing the existing type would have avoided the bump entirely —
  but the renderer labels that one "contests over a mate", so a carcass fight
  filed under it would have made the UI lie, which is the specific thing this
  version exists to stop.

---

## 3. ⚠ Traps, in the order they will bite again

**D25–D30 are inherited and unchanged.** The four that still matter most: a guard
can go blind silently; a species-level constant is not an entity-level one; ⚠⚠
the hottest function in the engine is arity-sensitive (one extra parameter on
`#perceive` once cost 12%); and an off switch must leave no trace, not merely no
effect (D30).

One new, and it is the sharpest of the session:

⚠ **"Regenerate fixtures on every protocol bump" was discipline only, and it
failed silently the first time it was tested.** Bumping `PROTOCOL_VERSION` to 29
left the renderer's `SUPPORTED_PROTOCOL_VERSION` and all three committed fixtures
on 28 — **with the entire suite green**, because the tests compared the
renderer's version against *itself* (`SUPPORTED_PROTOCOL_VERSION + 1` and so on)
rather than against the protocol's. Fixture mode would have refused every message
at runtime, and `npm test` would never have said so. Now asserted by
`test/protocol-v29.test.js`: the renderer's version equals the protocol's, and
every committed fixture carries it.

The general shape is worth carrying: **a test that compares a copy against itself
is not a test of the copy.** The same pattern held the EventCatalog honestly
(it is checked against `EventTypes`, a different source), which is why the three
new event types could not have gone missing the same way.

And a second, from the same phase and now **D32**:

⚠ **Run `npx playwright test` before calling a renderer change done.** Replacing
the three hardcoded restart fields left `setEnabled` still naming them, so it set
`.disabled` on `undefined` and **the renderer failed to boot in fixture mode
entirely** — with all 812 node tests green, because none of them builds a DOM.
⚠ The near-miss worth remembering: the *live*-mode controls spec passed, because
the panel is only disabled in fixture mode. "The controls test passed" was not
evidence. The full UI suite runs in ~13 s when the browser cooperates.

---

## 4. Measurements

**None taken, and that is the finding.** Phase 5 is protocol, host, and renderer
work; the only engine edits are read-only projections (`getSpeciesRoster`, the
inspection blocks), a metrics aggregate, and three `context.emit` calls. Verified
rather than assumed: with possession switched off the demo is **state-identical
on every entity field to phase-3 HEAD**, across three seeds at 1500 ticks —
the same comparison phases 3 and 4 were held to.

The benchmark was not re-run for the same reason. Phase 4's figures stand
(BENCHMARK.md), including the isolating arm that showed the perception edit free.

---

## 5. Next step: phase 6 — renderer scale

Phases 0–5 are done. **Phase 6 (§7) is renderer-only** and is the last groundwork
before species land:

- The glyph/colour/priority scheme for the ten-species roster (§7 has the table).
  ⚠ The gazelle keeps `g`/`yellow` deliberately, so batch 1 is visually
  indistinguishable from today's demo except for the new carnivore.
- Per-species `<details>` in the metrics panel, collapsed by default — at ten
  species the sidebar is unusable.
- ⚠ **`MetricsPanel.js:75` is quadratic in species count**:
  `history.map((sample) => sample.species.find(…))` inside a per-species,
  per-trait loop, so ~7.5k comparisons at three species and ~84k at ten, on every
  render. Index each history sample by `speciesId` once. Fix it with the
  collapsible work rather than discovering it as jank.

Then **phase 7 is batch 1: gazelle + hyena.** What phases 3–5 built for it, all
untested against a species that wants it:

- `groups.forms` — the hyena is the first species that will set it.
- `predation` mass ratios — the first that will set those too.
- ⚠ **`possessionShare: 0.25` was measured on the *corvid–stalker* world**, not
  on the 60 kg hyena and 6 kg vulture the mechanism was designed for. Expect to
  re-measure it in batch 1; it is not a universal constant.
- ⚠ Phase 7 splits into a **no-op half and a real half** and §9 says to measure
  them separately: the grazer → gazelle rename should be provably byte-identical,
  and only then does the hyena arrive behind the full ten-seed gate.

---

## 6. ⚠ Open threads, unchanged and now three sessions old

The 2026-07-23 findings are still unaddressed, and the user explicitly chose to
skip them:

- **Edge/corner congregation.** `NOTES.md` Tier 1. Ranked ideas preserved in
  [`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md).
- **Disturbance size.** `NOTES.md` Tier 1: floods/storms/droughts should cover
  much larger areas.

⚠ Both move where animals are and how often they die, which by DOCS §15 requires
a fresh multi-seed sweep — and there are now **two** swept results that would need
re-running afterwards (the phase-1/2 energy sweep and phase 4's possession
sweep), not one. Budget for the re-measure.

Also still open: the `escapeHeading` wide-pocket limitation, and **A51 (dynamic
shrub layer)**, scheduled at phase 15.

---

## 7. Three constants left deliberately mass-blind (DOCS §1.4 B7)

Unchanged. Each waits for the species that exposes it:

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock. ⚠ It now
  interacts with possession: a longer-lived body is a longer-held one.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
