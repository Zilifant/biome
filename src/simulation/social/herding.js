/**
 * How far a species' herd reaches (BEHAVIOR-PLAN.md P1).
 *
 * Sociality has had **one** radius since Step 23 — `config.social.groupRadius`,
 * six cells — and it does three different jobs inside `SocialSystem`'s single
 * neighbour loop: it decides who contributes to the herd's **centre of mass**, who
 * counts as a **groupmate** (and therefore as an adult, and therefore as a
 * defender), and how far a herd **label** propagates in one hop. Six is right for
 * a gazelle and too small for a wildebeest aggregation, which is what this file
 * exists to fix.
 *
 * ⚠⚠ **It widens exactly one of those three jobs, and the other two are a
 * deliberate refusal.** A species' `herdRadius` moves the **centroid** gate and
 * nothing else:
 *
 *   - **Not the label.** A wider label means bigger herds, more hop churn, and
 *     `social.maxGroupSize` saturating — which would change the herd-size
 *     distribution in the metrics and the fragmentation story (A43) as a side
 *     effect of a cohesion change.
 *   - **Not `groupmates` / `adults` / `nearestDistance`.** `adults` is read by
 *     `HuntingSystem`'s collective vigilance and by `mobbing.minMobbers`, so
 *     widening it would quietly make the large grazers **harder to kill** — a
 *     cohesion knob turned into a predation knob, which is exactly the line
 *     `social/association.js` draws for the same reason.
 *
 * So one per-species number changes one behaviour, and the collective-defence
 * figures stay comparable with their own history.
 *
 * ⚠ **A species-only key in the `behavior` block, with no `config.behavior`
 * default.** Unset means "as far as the herd label reaches", i.e.
 * `config.social.groupRadius` — so there is one number in one place and the two
 * radii cannot drift apart by half an edit (D11). It lives in `behavior` because
 * it is biology (a wildebeest coordinates over more ground than a gazelle) and
 * because `defendRange` is already a range in that block; the world-level **off
 * switch** is `config.social.perSpeciesRadius`, outside any block, by the phase-8
 * rule that a species block beats the config.
 *
 * ⚠ **Nothing here clamps a declaration against `groupRadius`.** A species that
 * declared a *narrower* herd than its label gets exactly that — a centroid built
 * from its closest neighbours inside a wider label — because `SocialSystem` gates
 * the two independently. Stated rather than rewritten, on the same grounds
 * `association.js` states rather than clamps its weights: silently rewriting
 * declared biology is how a species file stops meaning what it says.
 */

/**
 * The herd radius a species declares, or null when it declares none.
 *
 * The shape of `associationOf` and `groupsOf`: an absent, non-numeric, or
 * non-positive declaration is null rather than a number, so the caller's null
 * check is the only test anything needs.
 *
 * @param {{behavior?: {herdRadius?: number}}} [species] a resolved species record
 * @returns {number|null}
 */
export function herdRadiusOf(species) {
  const radius = species?.behavior?.herdRadius;
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : null;
}

/**
 * Every species in a world that declares a herd radius, keyed by id.
 *
 * Built **once per world** and checked for emptiness before anything else — the
 * same early-out `associationsIn` and `GroupSystem`'s forming set use, and for the
 * same reason: a mechanism no species asks for should cost one `size` comparison,
 * not a lookup per animal per tick.
 *
 * @param {{all: () => object[]}} [registry] the species registry
 * @returns {Map<string, number>}
 */
export function herdRadiiIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const radius = herdRadiusOf(species);
    if (radius !== null) byId.set(species.id, radius);
  }
  return byId;
}

/**
 * ⚠⚠ **How close a herd of this many bodies may be *asked* to stand** — the
 * geometric floor under `behavior.herdDistance` (2026-08-06).
 *
 * **The defect this closes.** P1 widened `herdRadius` 6 → 11 for the wildebeest
 * and the buffalo, which changed *who* contributes to the centre of mass. What an
 * animal does with that centre lives in `DecisionSystem`, and it closes until its
 * drift is inside `behavior.herdDistance` — still **2.0**, the number chosen when
 * a herd was six cells wide. The two are geometric partners and only one of them
 * moved. A disc of radius 2.0 is ~12.6 cells and holds ~25 animals at
 * `locomotion.maxOccupantsPerCell: 2`; an aggregation of a hundred inside an
 * 11-cell radius all steering at one point is asking for ~8 bodies per cell. The
 * movement system refuses the rest, forever — measured at **37.5%** of wildebeest
 * steps refused against 4.7% on the arm without this, with **9.3%** of their ticks
 * spent with no legal step in any direction at all.
 *
 * ⚠⚠ **It is derived from the occupancy cap rather than being a second opinion
 * about it.** `locomotion.maxOccupantsPerCell` is the only thing in this engine
 * that decides how tight a crowd can be, so it is the only honest thing for a
 * cohesion target to be derived *from* — the D11 rule that put `stepRefused` in
 * one module with two readers, applied to a number instead of a predicate. A
 * constant tuned against today's herd sizes would break silently the next time a
 * founding cohort grows, which is exactly how the original 2.0 broke.
 *
 * `n` bodies at a cap of `c` need at least `n / c` cells, so a disc holding them
 * has radius `sqrt(n / (π c))`. That is the radius at which the herd is **packed
 * solid** — every cell at the cap, no free cell to step into — so it is a bound on
 * the impossible rather than a target. `slack` is what turns it into one, and
 * because area goes as the square, a slack of 2 targets **a quarter** of capacity.
 *
 * ⚠ **The slack is validated against A83's measured floor table, not chosen for
 * feel.** A83 measured the tightest mean-distance-from-centre a healthy record
 * reaches, by member count, over 7000 ticks: 2 → 0.10, 3 → 0.53, 4 → 0.76,
 * 8 → 1.39, 12 → 1.49, 16 → 2.01. A uniform disc of radius R has a mean radius of
 * (2/3)R, so those are discs of R ≈ 0.15, 0.80, 1.14, 2.09, 2.24, 3.02. At
 * `slack: 2` this returns 1.13, 1.38, 1.60, 2.26, 2.76, 3.19 for the same counts —
 * within ~10–20% of what real bands actually do from n = 8 up, and *below* the
 * declared 2.0 (so inert) beneath it. It asks a herd to stand where a healthy herd
 * already stands; it only stops it being pulled tighter than that.
 *
 * ⚠⚠ **1.5 was measured and rejected — do not re-derive it from one seed.** On
 * seed 2 alone it looked free (wildebeest refusals 5.2% against 4.1%, buffalo
 * within a few animals). On three seeds it is plainly worse: buffalo mean **77.3
 * against 94.7**, and the leopard goes extinct on seed 1 (2/3 seeds) where slack 2
 * holds it 3/3. D14 again — a herd-size effect measured on a single seed is a
 * measurement of that seed.
 *
 * ⚠⚠ **It was tempting for a second reason that has since dissolved, and the
 * sequence is the lesson.** Spreading herds out cost the herd consensus its
 * coherence: labels holding a single heading fell to **36%** at slack 2 against 54%
 * packed, because `HerdConsensusSystem` re-decides *per animal* as each commitment
 * lapses, so members spread over more ground pooled different cues and agreed on
 * different headings. That looked like a standing cost of this number, and it was
 * written up here as one. It was not — it was **A71**: the migration drift was
 * only ever read on the tick a wander commitment was freshly taken, so between
 * re-decisions each member held its own stale arbitrary heading. With the drift
 * reaching held commitments (`migration.holdBiasScale`) coherence is **74%**, above
 * the packed world's 54%, and `consensus.test.js` passes. ⚠ Two mechanisms looked
 * like a trade-off and were both downstream of a third that was quietly unread;
 * the tell was that the "cost" appeared the moment herds started moving normally.
 *
 * ⚠ `slack: 0` disables the floor entirely and restores the pre-fix arithmetic
 * bit-for-bit, which is what makes it the reproducible control
 * (`--set=social.herdPackingSlack=0`). A cap of `null` — the crowding rule off —
 * means there is nothing to derive a floor from and returns 0 for the same reason.
 *
 * @param {number} weight total weight behind the centre of mass (`centroidWeight`)
 * @param {number|null} maxOccupantsPerCell `config.locomotion.maxOccupantsPerCell`
 * @param {number} slack multiple of the packed-solid radius to target
 * @returns {number} world units, 0 when the floor does not apply
 */
export function herdPackingFloor(weight, maxOccupantsPerCell, slack) {
  if (!(slack > 0)) return 0;
  if (typeof maxOccupantsPerCell !== 'number' || !(maxOccupantsPerCell > 0)) return 0;
  // A herd of one has no packing problem, and `weight` is a *weight* rather than a
  // headcount — a lone gazelle among wildebeest carries a fractional one — so this
  // is `<= 1` rather than `< 2`. Below the unit there is nobody to be crowded by.
  if (!(weight > 1)) return 0;
  return slack * Math.sqrt(weight / (Math.PI * maxOccupantsPerCell));
}
