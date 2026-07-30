# Handoff — 2026-07-30 session (species phase 12)

Supersedes the phases 10–11 handoff and absorbs it; its traps are still live and
the ones that will bite again are repeated in §4. The 2026-07-23 handoff is at
[`legacy-docs/HANDOFF-2026-07-23.md`](legacy-docs/HANDOFF-2026-07-23.md); its
ranked ideas for the edge/corner congregation problem exist nowhere else, and
that problem is still open (§6).

**Phase 12 of [`PLAN-SPECIES.md`](PLAN-SPECIES.md) is done** — the two batch-3
prerequisites: **heterospecific association** (§3.16) and **seasonal breeding
windows** (§3.11). Both ship **inert and byte-identical**, exactly as phase 10
shipped cooperation and mobbing, and batch 3 (phase 13) is the batch that declares
them. Phases 0–11 are committed; **phase 12 is uncommitted.**

⚠ **Read §2 before touching the association weight.** The obvious reading of it
was built first, measured **inert**, and removed — and the reason is the same one
that sank phase 9's first forage design.

---

## 1. Where things stand

| | |
| --- | --- |
| Tests | **927 passing / 0 failing**, 236 suites, plus **28 in `tests-ui`** (both run this session) |
| `PROTOCOL_VERSION` | 29 (unchanged, and **checked rather than assumed** — no new event type, because neither mechanism is an *event*: association changes where an animal walks and a window changes when a female is ready, and both are already visible through actions and `entity.mated`) |
| `SAVE_FORMAT_VERSION` | 29 (unchanged, also checked: `describeSystems()` carries only `{id, phase, priority, updateInterval}`, so the new options do not reach the descriptor comparison, and a pre-phase-12 save's `config` merges over the new defaults — old saves restore) |
| Species | **6**, unchanged — gazelle, buffalo, stalker, lion, vulture, hyena. Phase 12 adds no animal |
| Benchmark | **Flat**, interleaved against HEAD at *two* scenarios (§5). Standing large-5k reading 112.83 ms/tick — ⚠ **not** a regression against phase 11's 106.51; see §5 |
| Opened | **A61** (an association weight only bites in mixed company, and the obvious fix measured inert) |
| Closed | The last-but-one ❌ row in §2 of the plan. **One row left in that table** (`diet`, phase 15) |
| Gate | ⚠ **None, and none was owed.** §9's gate is per *species*; phase 12 adds none. What it owes is the inertness proof, and that is in §5 |
| Git | phases 0–11 committed (`c8bfaff phase 11`); **phase 12 uncommitted**. The user handles git |

---

## 2. ⚠ Phase 12, and the four things it found

### a. ⚠⚠ A weight that has already been spent must not be spent again

§3.16 asks for "a weight below conspecific herding", which reads as *two* things:
an associate contributes less to the herd's centre of mass, **and** the pull toward
that centre is weaker. Both were built. The second is wrong, and it is phase 9's
symmetric forage window in a new costume — **it charges the animal twice for one
fact**, because the weight is already inside the centroid.

It is not a rounding difference. Herding is deliberately the weakest utility in the
table, so the second discount is fatal:

| association weight | max herd pull (`herdWeight` 0.6) | vs `wanderBias` 0.35 |
| ---: | ---: | --- |
| 0.25 | 0.150 | never fires |
| 0.50 | 0.300 | never fires |
| 0.58 | 0.350 | never fires |
| 0.75 | 0.450 | fires |

Measured end to end: a follower at weight 0.5 finished **16.1 units** from the herd
it was supposed to be following, against **16.1** with the mechanism switched off —
the mechanism was doing nothing at all across most of the range anyone would
declare. So the weight now means exactly one thing: **how much of a body a member
of that species is worth when the herd's centre is worked out.** Recorded as
**A61**, with the cost stated: it therefore only bites in *mixed* company.

⚠ **The transferable rule:** *when a per-species weight is applied at one place,
check whether a second application is the same fact twice.* This is now the second
time it has cost a redesign.

### b. ⚠ Association's second half is the reason it exists, and the plan did not propose it

§3.16 names three benefits — vigilance, dilution, and the short grass — and then
proposes only the herd centre. But **standing beside an animal whose warnings you
cannot hear buys nothing**: two of the three named benefits were unreachable from
the proposal. So an associate's alarm carries, on the existing wave (same hops,
same `maxAlarmHops` cap, which is what keeps a local mechanism local).

Two notes on how it shipped:

- ⚠ **It has its own switch** (`association.sharesAlarm`). That is phase 11's
  lesson applied *before* it costs anything: two mechanisms shipped together
  confound each other, and there the uncontrolled comparison read backwards while
  both were working perfectly. The cells are separable now, and phase 13 will want
  them.
- **Dilution needed nothing and got nothing** — perception reports the *nearest*
  eligible prey (A58), so a predator entering a mixed aggregation takes what is
  closest and the odds of that being any one species fall as the mixture grows. No
  term, no code, and worth recording as a saving rather than a gap.

### c. ⚠⚠ An association is an attraction, and the counts are what must not move

Labels, `groupmates`, `adults`, and `nearestDistance` stay conspecific. The obvious
motivation is the one §3.16 gives (two species sharing a label makes every
per-species herd metric meaningless), but the sharper one is downstream and the
section could not have known it: **`mobbing.minMobbers` counts `adults` off that
same summary.** Counting associates there would let a herd of the wrong species
talk an animal into turning and facing a predator none of them will help with — a
mechanism silently changed by a change to an unrelated one. `test/association.test.js`
asserts it directly, with a mobbing species surrounded by three animals of another.

### d. The breeding window needed no correction, and that is worth a sentence

⚠ It is the **first section in `PLAN-SPECIES.md` whose As-built block records no
wrong prediction.** Birth synchrony emerged exactly as §3.11 said it would: a
compressed conception window plus a constant gestation *is* a calving season, with
nothing anywhere synchronizing anything. Asserted on the **births** rather than the
matings, because the births are the claim.

The reason it was easy is structural and is the thing to copy: **it gates an
existing predicate rather than adding a competitor to the utility table.** Every
expensive lesson in this project is about the second kind of change. What the
section did not say, all decided while wiring it: the switch cannot live in
`reproduction` (a species block); a window may **wrap the year** and that is the
normal case; it gates the **chooser only** (males stay ready year-round, stated as
a limit); and a degenerate window means **year-round, not sterile** — a config typo
must not quietly extinguish a species over ten seeds and look like a result.

---

## 3. What the two mechanisms are, in one paragraph each

**Association.** `association: { 'herbivore.wildebeest': 0.5 }` on the species that
does the following — it is **directional**, so the small species declares it and
the big one need not care. Read in `SocialSystem`'s existing neighbour loop (one
comparison; no new walk, no new state, no save or protocol change). The world-level
switches are `config.association.enabled` and `.sharesAlarm`. See
`src/simulation/social/association.js`.

**Breeding windows.** `reproduction.breedingWindow: { startFraction, endFraction }`
— fractions of the year, wrapping allowed — gating the gestating sex inside
`isReproductivelyReady`, which is the single rule both the reproduction system and
the decision system read, so she does not go looking for a mate she would refuse.
`null` is year-round and skips the test entirely. Switch: `config.breeding.enabled`.
See `src/simulation/mating/breeding.js`.

---

## 4. ⚠ Traps, in the order they will bite again

**D25–D32 are inherited and unchanged.** Still most dangerous: a guard can go
blind silently; a species-level constant is not an entity-level one; ⚠⚠ the
hottest function in the engine is arity-sensitive; an off switch must leave no
trace (D30).

⚠ **A weight already spent must not be spent twice** (§2a). New, and it has now
cost two redesigns in four phases under two different names.

⚠ **An off switch in a species block is not an off switch.** Applied twice more:
`config.association` and `config.breeding` exist *only* because `association` sits
beside a species field and `breedingWindow` sits inside the `reproduction` block.
`config.breeding` holds one boolean and nothing else, which is the pattern reduced
to its point.

⚠ **A mechanism that counts neighbours is a density mechanism** (phase 11's rule,
and association is a third one). ⚠ **A breeding window is one too, indirectly**: it
concentrates every conception into a fraction of the year, which concentrates the
births, which is a density spike by construction. Both are parameters of
`behavior.herdDistance` and the founding counts, and neither says so.

⚠ **The byte-identity readings in `test/association.test.js` and
`test/breeding.test.js` are takeable now and not later.** The moment batch 3 gives
a species an association or a window, those two arms diverge by design — exactly as
phase 11 took cooperation's away. Do not "fix" them then; replace them with the
narrower claim, as `test/cooperation.test.js` did.

⚠ **A single-seed assertion about the demo is an assertion about a trajectory.**
Unchanged from phase 11, and phase 12 broke **none** of them — which is itself the
result, since both mechanisms are inert.

---

## 5. Measurements

- **Inertness (the §9 procedure's first half).** Demo entity state at seeds 1/2/42
  × 1500 ticks is **byte-identical** to HEAD: 651404 / 633919 / 630808 bytes,
  matching sha256 on each, **1.92 MB total**. The whole-save blob differs by
  exactly **100 bytes per seed** — the new config sections in the saved `config`
  literal, and nothing else. Asserted in the suite too, as the demo against each
  mechanism's own switch.
- **The double-count** (§2a): the table above, plus 16.1 vs 16.1 units over 200
  ticks at weight 0.5.
- **Performance: flat**, interleaved against HEAD three rounds each at **two**
  scenarios, because the change is inside a neighbour loop and large-5k is where
  the neighbours are. medium-1k 14.247 (phase 12) vs 14.389 (HEAD); large-5k 85.56
  vs 88.04. Phase 12 wins two rounds and loses one at large-5k, and wins one, ties
  one, loses one at medium-1k — noise in both directions by this project's rule.
- ⚠ **The standing large-5k figure is 112.83 ms/tick and is NOT comparable to
  phase 11's 106.51.** Same roster, same seed, same 7774→9305 entities, and the
  interleaved A/B says flat — but HEAD itself measured **85–90** ms/tick in the
  interleaved rounds an hour earlier. A single dated reading on this machine spans
  ±25%. Interleave, or do not compare. Full table in `BENCHMARK.md`.
- **`npm run sweep` smoke-tested against the new config keys**
  (`--set=association.enabled=false --controlSet=association.enabled=true`): both
  arms identical to the digit, which is the inertness claim from a third direction.

---

## 6. ⚠ Open threads

**Unchanged:** A56 (a two-member clan flaps), A57 (concealment needs cover), P14
(metrics payload at a long roster), A34 (patrol's target is a place, not a
purpose), A58 (nearest rather than best), A59, A60, A32 (open with no lever left
in the defense code), the `escapeHeading` wide-pocket limitation, A51 at phase 15,
and the renderer's P6/E3 and P9.

**New or sharpened:**

- **A61** — an association weight only bites in **mixed** company, because it is an
  exchange rate between bodies in the centre of mass and cancels out of the mean
  when only the other species is present. A gazelle alone among wildebeest sticks
  to them exactly as hard as to its own herd. ⚠ The fix is a *separate* pull weight,
  not a reuse of this one (§2a); nothing has asked for it.
- ⚠ **The plan's §2 table has one row left** (`diet`, phase 15). When it closes,
  the next unrepresentable axis has to be **found** rather than looked up, which is
  a harder job than any of the twelve that were.
- ⚠ **B7's constants**, unchanged and still live: `carcass.decayTicks` is the lion's
  carrion subsidy and the first thing to try if batch 3 sees apparent competition.

**Unchanged, and the user explicitly chose to skip them:** edge/corner
congregation and disturbance size (`NOTES.md` Tier 1). ⚠ There are still **seven**
swept results to re-run afterwards — phase 12 adds none, because it swept nothing.

---

## 7. Next step: phase 13 — batch 3 (wildebeest + zebra)

The first batch whose prerequisites were both built for it in advance, and both are
inert until it declares them. Six warnings, the first two inherited and sharpened:

- ⚠ **Batch 3 is three grazers on one grass**, which is the competitive-exclusion
  case §2 is about — and phase 11 already showed it happening in miniature, with
  the buffalo displacing the gazelle onto ground it had not chosen. Expect the
  gazelle's `forage` numbers to move; §3.3 always said they would.
- ⚠ **`social.maxGroupSize: 12` is still a global cap on a herd label**, and §7
  asked for a decision "before batch 2". It was not needed there — 35 buffalo never
  crowd one label — but **wildebeest are the species the cap is wrong for**, and
  they are arriving. Decide it with the measurement in hand.
- ⚠ **Declare the association on the *gazelle*, not on the wildebeest.** It is
  directional and the small species is the one that benefits. And read A61 first:
  the weight decides whose centre wins in mixed company and nothing else.
- ⚠ **Start the breeding window wide.** A species that misses one loses a year of
  recruitment, and a 15 000-tick sweep contains only **two** windows.
- ⚠ **Three switches, three arms.** `association.enabled`, `association.sharesAlarm`,
  and `breeding.enabled` are independent and all reachable from
  `npm run sweep --set=`. Phase 11's confounded 2×2 is the reason they exist; use
  them rather than reasoning about a pooled number.
- ⚠ **`hunts()` is due for re-measurement** (§7): batch 3 is what finally takes a
  predator's `preySpeciesIds` past one entry.

---

## 8. Three constants left deliberately mass-blind (DOCS §1.4 B7)

Unchanged from phase 11:

- `carcass.decayTicks` — ⚠ live: a 600 kg body on a 6 kg animal's clock.
- `hunting.captureStaminaCost` — flat against a `maxStamina` that ranges 80 (lion)
  to 120 (hyena), so the ratio it implies varies 50%.
- `locomotion.maxOccupantsPerCell` — a headcount, not a volume, in a world whose
  animals differ 100× in mass.
