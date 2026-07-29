# Handoff — 2026-07-28 session (species phases 0–6)

Supersedes the phases 0–5 handoff, which it absorbs; the traps there are still
live and repeated in §3. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

This session executed **phases 0–6 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md)**.
Phases 0–4 are committed; **phases 5 and 6 are uncommitted.** No new species have
been added yet; **phase 7 is the first batch (gazelle + hyena)** and everything
it needs now exists — including, as of phase 6, its glyphs.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **819 passing / 0 failing**, 208 suites (was 812/206), plus **28** in `tests-ui` (was 25) |
| `PROTOCOL_VERSION` | 29 (unchanged this phase) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged this phase) |
| Species | still 3 shipped — grazer, stalker, corvid — but **10 have glyphs** |
| Species blocks | 12 |
| Systems | 23 |
| Benchmark | not re-measured — phase 6 is renderer-only and touched no engine file |
| Git | phases 0–4 committed; **phases 5 and 6 uncommitted**. The user handles git |

---

## 2. What phase 6 shipped

Renderer-only groundwork (§7 of the plan), the last before species land. Three
things, plus one debt paid.

**a. The whole roster has a glyph.** `SPECIES_APPEARANCE` now carries all ten
planned species — gazelle, wildebeest, zebra, buffalo, rhino, elephant, leopard,
lion, hyena, vulture — exactly as §7's table proposed, beside the three the
engine actually ships. The point is that a species batch stays a **config**
change: the engine can found a species the moment its config file exists, and
without an entry here it would draw as a bare `a` and be nameless in the metrics
and restart panels.

**b. Per-species metrics sections.** Each species is a collapsed `<details>`
whose summary is its grid glyph in its grid colour, its name, its living count,
and the population sparkline. Collapsed, the panel is an overview it never had;
expanded, it is what it always was. Open-set in `localStorage`.

**c. The quadratic sparkline lookup, fixed.** `history.map((s) =>
s.species.find(…))` inside a per-species, per-trait loop — ~7.5k comparisons at
three species, ~84k at ten, on every render. `indexHistory` buckets once.

**d. The v29 `groups` aggregate was being computed and rendered nowhere.** Phase
5 added it to `/api/metrics` and no panel read it. It now shows as a world-level
row and a per-species one, in both cases **only where a group exists** — so it is
invisible today and appears by itself at the first hyena clan.

**Three decisions worth knowing before touching it:**

- ⚠ **`supersededBy` is why two species may share a letter.** Case means age and
  italic means sex, so the letter is all that says *which animal this is* — two
  live species on one letter would be indistinguishable. Three entries
  (`herbivore.grazer`, `scavenger.corvid`, `predator.stalker`) are renamed into
  roster entries later and carry a `supersededBy` naming the successor, which
  makes the transitional duplicate **data rather than folklore**: a test permits a
  shared glyph *only* between a species and its successor. **Phase 7's renderer
  work is "delete the entry whose `supersededBy` is now live"**, and phase 14's
  is the same for the stalker.
- ⚠ **The gazelle keeps the grazer's `g`/`yellow`/50 exactly**, so batch 1 is
  visually identical to today's demo apart from the hyena — which is what makes a
  visual regression obvious.
- **A group count is absent, not zero, in a world with no groups.** Showing `0
  clans` on every species forever would be noise for a mechanism nothing uses;
  the row appearing at all is the signal.

---

## 3. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** The four that still matter most: a guard
can go blind silently; a species-level constant is not an entity-level one; ⚠⚠
the hottest function in the engine is arity-sensitive (one extra parameter on
`#perceive` once cost 12%); and an off switch must leave no trace, not merely no
effect (D30).

**⚠ D32 was obeyed and earned its keep again.** `npx playwright test` before
calling a renderer change done — the metrics panel rewrites its whole
`innerHTML` on every poll, and a `<details>` open-state that survives review but
not a rebuild is exactly the failure no node test can see (the repo builds no
DOM). `tests-ui/metrics.spec.js` drives it: expand, wait for a *real* rebuild
(proved by marking the element and watching the mark vanish), assert it is still
open **and** that the toggle still works afterwards. The listener is bound once,
on the container, in the capture phase — `toggle` does not bubble, and one bound
to the sections would be destroyed by the next poll.

⚠ **From phase 5, and still the sharpest of the session:** "regenerate fixtures
on every protocol bump" was discipline only, and it failed silently the first
time it was tested — the suite compared the renderer's `SUPPORTED_PROTOCOL_VERSION`
against *itself*. Now asserted by `test/protocol-v29.test.js`. The general shape
is worth carrying: **a test that compares a copy against itself is not a test of
the copy.**

One new, and it is small but general:

⚠ **A cheap inner lookup is only cheap at today's N.** Nothing about the
sparkline code changed to make it quadratic; the roster did. It was found by
reading for it in advance rather than by feeling jank, which is the same move as
the engine's mass audit — and the equivalence of the fix is **asserted, not
assumed**, because the old form produced an `undefined` slot where the new one
omits a value, and a silently different trend line is exactly what nobody
notices.

---

## 4. Measurements

**None taken, and that is the finding.** Phase 6 touched `src/renderer/app` and
its tests, plus documentation. No engine, protocol, server, or config file
changed, so there is nothing for a seed sweep or the benchmark to say. Phase 4's
figures stand (BENCHMARK.md).

The one measurement phase 6 *should have taken and did not* is carried forward:
**the `/api/metrics` payload size at ten species.** §7 asks whether metrics needs
a server-side species filter, and collapsing the panel changed what is drawn, not
what is fetched. It is answerable only once a long roster exists.

---

## 5. Next step: phase 7 — batch 1 (gazelle + hyena)

Phases 0–6 are done, and phase 7 is the first phase that adds a species.

- **`herbivore.grazer` → `herbivore.gazelle`.** A rename, a docstring, and
  deleting the superseded appearance entry. ⚠ §9 requires this half to be
  provably **byte-identical** — mass and every block unchanged — and measured
  *before* the hyena arrives. If it is not identical, the diff is the answer.
- **`scavenger.corvid` → `scavenger.vulture`**, 4 → 6 kg, otherwise unchanged.
- **`scavenger.hyena` is net-new** and takes the full ten-seed gate. It is the
  first consumer of `groups.forms`, of `predation` mass ratios, and of a
  per-species `herdWeight`.
- ⚠ **`possessionShare: 0.25` was measured on the *corvid–stalker* world**, not
  on the 60 kg hyena and 6 kg vulture the mechanism was designed for. Expect to
  re-measure it; it is not a universal constant.
- ⚠ **Watch the vulture.** A 60 kg facultative scavenger entering a world with a
  6 kg obligate one is the batch's tightest interaction; report its population and
  carcass share per seed explicitly.
- **What batch 1 must actually demonstrate is the group registry** — clans form,
  persist through separation, hold and lose carcasses, and dissolve. Assert those
  directly; a registry that quietly never founds a second clan would pass a
  survival gate.
- The renderer needs **nothing** for any of it except the two deletions, which is
  what phase 6 was for.

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

Also still open: the `escapeHeading` wide-pocket limitation, **A51 (dynamic
shrub layer)** scheduled at phase 15, and the renderer's own P6/E3 — fixture mode
still has no metrics data, so the new per-species sections are only reachable in
live mode (which is why their UI tests use the mocked live host).

---

## 7. Three constants left deliberately mass-blind (DOCS §1.4 B7)

Unchanged. Each waits for the species that exposes it:

- `carcass.decayTicks` — a 600 kg body rots on a 6 kg body's clock. ⚠ It now
  interacts with possession: a longer-lived body is a longer-held one.
- `hunting.captureStaminaCost` — flat against a per-species `maxStamina`.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume.
