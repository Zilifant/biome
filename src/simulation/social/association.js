/**
 * Heterospecific association (PLAN-SPECIES.md §3.16, phase 12) — standing with
 * animals that are not your own kind.
 *
 * Herding has been conspecific since Step 23: `SocialSystem` walks the
 * neighbourhood, skips everything of another species on its first comparison, and
 * hands the decision system a centre of mass built from your own kind alone. That
 * is right for one grazer and wrong for a savanna. Gazelle stand with wildebeest
 * and zebra for reasons that are all measurable in this engine — more eyes
 * watching, more bodies for a predator to pick between, and the short flush the
 * bigger grazers leave behind (§3.3) — and none of them was expressible.
 *
 * **A species states who it associates with and how strongly**, one weight per
 * partner species, in the shape `habitat` already uses for terrain:
 *
 * ```js
 * association: Object.freeze({ 'herbivore.wildebeest': 0.5, 'herbivore.zebra': 0.35 })
 * ```
 *
 * 1 is parity with a conspecific and 0 (or an unnamed species) is no association
 * at all, so a partial declaration is one number and the intended range is
 * `(0, 1)` — §3.16's "a weight below conspecific herding". ⚠ Nothing *enforces*
 * that ceiling: a weight above 1 says this animal would rather stand with the
 * other species than with its own, which is expressible and almost certainly a
 * typo. Stated rather than clamped, because silently rewriting declared biology is
 * how a species file stops meaning what it says.
 *
 * ⚠⚠ **Association is an attraction, not a membership**, and the whole design is
 * in that sentence — it is the same line §3.8 draws between a herd label and a
 * group record. Two consequences, both of them load-bearing:
 *
 *   - **Herd labels stay conspecific.** `groupId` propagation, `groupmates`,
 *     `adults`, and `nearestDistance` are untouched by association. Letting a
 *     label cross species would merge two species into one herd and make every
 *     per-species herd metric meaningless — and it would silently change what
 *     mobbing counts, since `mobbing.minMobbers` reads `adults` off the same
 *     summary and a mob of gazelle does nothing for a buffalo.
 *   - **It is directional.** Each animal reads *its own* species' list, so a
 *     gazelle can follow wildebeest without the wildebeest caring, which is what
 *     the association actually looks like in the field. Mutual association is two
 *     declarations, not one.
 *
 * **What it does, at the two places it touches:**
 *
 *   - ✅ **The herd centre becomes a weighted mean.** An associate contributes its
 *     position and heading at its weight, so the centroid a lone gazelle steers at
 *     is the mixed group it is standing in, and in mixed company the exchange rate
 *     between a body of one kind and a body of the other decides whose centre
 *     wins. A group of pure conspecifics is arithmetically unchanged.
 *
 *     ⚠⚠ **The pull's *strength* is deliberately NOT scaled by the weight as
 *     well, and the first cut did it and was wrong.** It reads as obviously right
 *     — "below conspecific herding" ought to mean a weaker pull too — and it is
 *     the same error §3.3's symmetric forage window made: **it charges the animal
 *     twice for one fact.** The weight has already been spent inside the centroid.
 *     Measured, because the second charge is not a rounding difference: herding is
 *     the weakest utility there is, so at `herdWeight` 0.6 a second discount of 0.5
 *     caps the pull at 0.30 against a `wanderBias` of 0.35 — it can never win, and
 *     a follower held station no better than one with the mechanism switched off
 *     (16.1 units from the herd either way, 200 ticks). Every weight below ~0.58
 *     was inert, which is most of the range anyone would ever declare. So the
 *     weight means exactly one thing: **how much of a body a member of that
 *     species is worth when the herd's centre is worked out.**
 *   - ✅ **A second, separate number says how hard to hold to that centre**
 *     (`associationPull`, BEHAVIOR-PLAN.md P3, 2026-08-05) — the fix A61 named and
 *     nobody had asked for until now. "Half attached to them, fully attached to my
 *     own" was **not expressible**, because the weight above cancels out of the
 *     mean entirely when only the other kind is standing there: a gazelle alone
 *     among wildebeest stuck to them exactly as hard as to gazelle. See
 *     `associationPullOf` below for the field and `SocialSystem`'s `pullScale` for
 *     what it is spent on. ⚠ It is a **second declaration**, never a reuse of the
 *     first, and that is the whole of A61: reusing the weight is the double charge
 *     the paragraph above measured as inert.
 *
 *     ⚠⚠ **And it is spent on the *distance*, not on the utility**, which is the
 *     other half of the same lesson. Scaling `herdWeight` by 0.55 puts the pull at
 *     0.33 against a `wanderBias` of 0.35 for a bold gazelle and 0.495 against
 *     0.175 for a timid one — a threshold effect keyed on a heritable trait,
 *     dressed as a smooth weight, which is worse than either arm. Scaling the
 *     *distance an animal tolerates* has no comparison to lose: it is monotone in
 *     the pull, and it is directly measurable as the distance a follower settles
 *     at.
 *   - ✅ **An associate's alarm carries** (`sharesAlarm`). This is the "better
 *     vigilance" §3.16 names as the *reason* the association exists, and the
 *     attraction alone cannot deliver it: standing beside an animal whose warnings
 *     you cannot hear buys nothing. It rides the existing wave — same hop counts,
 *     same `maxAlarmHops` cap, same one-hop-per-tick staging — because that cap is
 *     what keeps a local mechanism local (DOCS §9 Sociality), and crossing species
 *     does not change the argument. ⚠ It has its own switch so the two halves can
 *     be measured apart: phase 11's sharpest lesson is that two mechanisms shipped
 *     together confound each other, so the cells are separable *before* anyone
 *     needs them to be.
 *
 * ⚠ **Predator dilution needs nothing and gets nothing.** It already falls out:
 * perception reports the nearest eligible prey (A58), so a predator walking into a
 * mixed aggregation takes whatever is closest, and the odds of that being any one
 * species fall as the mixture grows. There is no dilution term here and there
 * should not be one.
 *
 * ⚠ **Inert until a species declares an association**, and inert by construction
 * rather than by luck: `SocialSystem` builds the set of declaring species once per
 * world and, when it is empty, its neighbour loop is the loop it has always been —
 * one species comparison, no lookup, no arithmetic. No species declares one in
 * phase 12. The wildebeest and zebra arrive in batch 3 (phase 13) and are what the
 * weights will be tuned against; declaring one for the gazelle now would be
 * fitting a parameter to a world with nothing to associate *with*, which is the
 * mistake §9 warns against for `cooperationWeight`.
 *
 * The world-level off switches are in `config.association`, a global section
 * beside the per-species fields rather than inside a species block — a species
 * block beats the config (DOCS §8), so a switch inside one cannot switch anything
 * off. Same shape as `forage`, `habitat`, `cooperation`, and `mobbing`.
 */

/** Weight of a species this animal says nothing about. Exactly no association. */
export const NO_ASSOCIATION = 0;

/**
 * Conspecific weight. Not a parameter: "as strongly as my own kind" is the unit
 * the declared weights are fractions of, and it is what makes an all-conspecific
 * group arithmetically identical to the pre-association one.
 */
export const CONSPECIFIC_WEIGHT = 1;

/**
 * How hard an animal holds to a centre made of its own kind — and therefore the
 * pull of a partner species it has said nothing more about, and of an animal
 * standing alone with nobody to hold to at all (P3).
 *
 * Not a parameter, for the same reason `CONSPECIFIC_WEIGHT` is not one: "as hard as
 * to my own kind" is the unit a declared pull is a fraction of, and it is what
 * makes every species that declares no `associationPull` — which is seven of the
 * eight shipped — arithmetically identical to the pre-P3 world. `x / 1` is `x` for
 * every finite double, so the identity is bit-for-bit rather than close.
 */
export const CONSPECIFIC_PULL = 1;

/**
 * World-level association parameters — the machinery and the off switches.
 *
 * ⚠ Three switches, not one, and they are the 2×2 (plus a half) this mechanism has
 * argued for since phase 12. `enabled` is the control the mechanism as a whole is
 * measured against; `sharesAlarm` splits the vigilance half from the attraction
 * half, because a co-attracted animal is usually also a co-alarmed one and the
 * pooled comparison would confound them (§10.2's 2×2, learned the expensive way);
 * `scalesPull` (P3) splits **how hard** an animal holds to mixed company from
 * **where** that company puts its centre, which are the two things A61 found were
 * inexpressibly welded together.
 */
export const DEFAULT_ASSOCIATION = Object.freeze({
  enabled: true,
  sharesAlarm: true,
  scalesPull: true,
});

/**
 * The association weights of a species, or null when it has none.
 *
 * Reads the always-per-species `association` field, in the shape of `habitatOf`
 * and `forageOf`. An empty declaration is null rather than an empty map, so the
 * caller's null check is the only test anything needs.
 *
 * @param {{association?: Record<string, number>}} [species]
 * @returns {Record<string, number> | null}
 */
export function associationOf(species) {
  const association = species?.association;
  if (!association || typeof association !== 'object') return null;
  for (const key of Object.keys(association)) {
    if (typeof association[key] === 'number' && association[key] > 0) return association;
  }
  return null;
}

/**
 * How strongly this animal is drawn to a member of `speciesId`, `0` when it is
 * not drawn to it at all.
 *
 * @param {Record<string, number> | null} weights from `associationOf`
 * @param {string} speciesId the *other* animal's species
 * @returns {number}
 */
export function associationWeightFor(weights, speciesId) {
  if (weights === null) return NO_ASSOCIATION;
  const weight = weights[speciesId];
  return typeof weight === 'number' && weight > 0 ? weight : NO_ASSOCIATION;
}

/**
 * Every species in a world that declares an association, keyed by id.
 *
 * Built **once per world** and checked for emptiness before anything else, which
 * is the same early-out `GroupSystem` uses for group-forming species and for the
 * same reason: the cost of a mechanism no species asks for should be one `size`
 * comparison, not a lookup per animal per tick.
 *
 * @param {{all: () => object[]}} [registry] the species registry
 * @returns {Map<string, Record<string, number>>}
 */
export function associationsIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const weights = associationOf(species);
    if (weights !== null) byId.set(species.id, weights);
  }
  return byId;
}

/** A usable pull: a finite number strictly above zero. See `associationPullOf`. */
const isPull = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The pull strengths of a species, or null when it declares none (P3, closing A61).
 *
 * ⚠⚠ **A second always-per-species field, `associationPull`, and it is deliberately
 * *not* nested inside `association`.** Nesting it there would break
 * `associationOf`, `associationWeightFor`, and every test that reads the weights as
 * a flat `{speciesId: number}` map — the two are the same shape over the same keys
 * and they mean different things, which is exactly why they are two fields:
 *
 * ```js
 * association:     Object.freeze({ 'herbivore.wildebeest': 0.5 }),  // how much of a body
 * associationPull: Object.freeze({ 'herbivore.wildebeest': 0.55 }), // how hard to hold on
 * ```
 *
 * ⚠ **An unnamed partner pulls at parity**, the opposite convention to
 * `associationWeightFor`, and both are right. There, an unnamed species is not
 * somebody this animal stands with at all, so the default has to be "no". Here, the
 * animal has *already* said it stands with them; saying nothing further about how
 * hard is saying "as hard as my own kind" — which is precisely the pre-P3
 * behaviour, so a species that declares only weights keeps exactly the world it had.
 *
 * ⚠ **Zero is refused rather than clamped**, unlike `otherBandWeight` where it means
 * a coherent "ignore". A pull of zero divides into an infinite tolerated distance —
 * "never close up on them, however far away they get" — which is what *declining to
 * associate at all* already says, in a field that says it clearly. Negative and
 * non-finite go the same way, and for the harder reason: they reach `herdDistance /
 * pull` and come out as a negative or NaN distance in the one comparison that
 * decides whether an animal herds.
 *
 * ⚠ A map whose every usable entry is exactly `1` resolves to null, on
 * `bandAffinityOf`'s precedent: parity *is* the unweighted behaviour, and an empty
 * map is what buys every other species the single `Map.size` comparison this
 * mechanism costs them.
 *
 * @param {{associationPull?: Record<string, number>}} [species]
 * @returns {Record<string, number> | null}
 */
export function associationPullOf(species) {
  const pulls = species?.associationPull;
  if (!pulls || typeof pulls !== 'object') return null;
  for (const key of Object.keys(pulls)) {
    if (isPull(pulls[key]) && pulls[key] !== CONSPECIFIC_PULL) return pulls;
  }
  return null;
}

/**
 * How hard this animal holds to a centre of mass made of `speciesId`, relative to
 * one made of its own kind — `CONSPECIFIC_PULL` when it has said nothing about it.
 *
 * ⚠ Never called for a conspecific: your own kind pulls at the unit by definition,
 * and a species naming *itself* here would otherwise be quietly obeyed.
 *
 * @param {Record<string, number> | null} pulls from `associationPullOf`
 * @param {string} speciesId the *other* animal's species
 * @returns {number}
 */
export function associationPullFor(pulls, speciesId) {
  if (pulls === null) return CONSPECIFIC_PULL;
  const pull = pulls[speciesId];
  return isPull(pull) ? pull : CONSPECIFIC_PULL;
}

/**
 * Every species in a world that declares a pull, keyed by id.
 *
 * Built once per world and checked for emptiness before the entity walk — the same
 * early-out `associationsIn`, `herdRadiiIn` and `bandAffinitiesIn` use, and for the
 * same reason.
 *
 * @param {{all: () => object[]}} [registry] the species registry
 * @returns {Map<string, Record<string, number>>}
 */
export function associationPullsIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const pulls = associationPullOf(species);
    if (pulls !== null) byId.set(species.id, pulls);
  }
  return byId;
}
