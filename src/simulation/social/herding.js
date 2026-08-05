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
