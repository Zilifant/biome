/**
 * Herd movement consensus (BEHAVIOR-PLAN.md P8) — the herd label's first
 * behavioural consumer, and the arithmetic of a shared heading.
 *
 * ⚠⚠ **DOCS §9 has said "the label has no behavioural consumer at all" since
 * 2026-07-30, and it was measured rather than noticed**: `maxGroupSize` 12 against
 * 24 left all eight species' populations identical to the digit, because herding
 * steers at a centroid built from *neighbours*, mobbing and collective defense
 * count `adults` from the same neighbour summary, and the alarm travels by
 * proximity. None of them reads `groupId`. This is the mechanism that changes that:
 * a **shared directional commitment carried by the label**.
 *
 * **What it is.** Every tick the animals of one label that are free to re-decide
 * pool their migration drifts into a circular mean; that mean becomes the label's
 * heading, and each of them holds it for `commitTicks` whatever its own cue does
 * next. `DecisionSystem` then steers a fresh `wander` by the consensus **in place
 * of** the migration drift. Two consequences, and they are the two things the brief
 * asked for:
 *
 *   1. **A collective front.** The animals of a herd bend the same way at the same
 *      time, because they are reading one number rather than each its own gradient.
 *   2. **It outlives the cue.** The commitment carries a heading *and its strength*,
 *      so a herd keeps going after the gradient that started it has flattened —
 *      which is the "wildebeest subherds that persist while spatially separated"
 *      ask, expressed as the only thing that legally can express it (see below).
 *
 * ⚠ **It is a drift, never an action.** Four phases have now recorded what a
 * movement behaviour that competes with foraging costs (§1.4 A34); a fresh `wander`
 * commitment is the one heading in the engine that was going to be arbitrary, so
 * bending it costs nothing that was doing any work. ⚠⚠ And it is deliberately **not
 * a fourth blend** onto that heading beside migration, rally and trail: it
 * *replaces* the migration drift while live. A fourth channel would make that
 * expression unreadable and would stop the strengths summing to anything meaningful.
 *
 * ## The re-decision rule, and why it has to be stated
 *
 * Members join a label at different ticks. If every animal simply re-decided when
 * its own commitment lapsed, the label's heading would be a rolling average over
 * whoever happened to expire this tick — a smear rather than a front. So:
 *
 *   1. **Free** — its commitment belongs to this label and has lapsed. It
 *      contributes its own cue to the label's fresh consensus and adopts the
 *      result. Because a whole label that decided together expires together, this
 *      is a *collective* re-decision rather than n independent ones.
 *   2. **Committed** — its commitment belongs to this label and is live. It keeps
 *      the heading it has and contributes **nothing** to the fresh consensus.
 *   3. **Joining** — its commitment belongs to *another* label, or it has none. It
 *      adopts the label's **standing** consensus (the live commitments already in
 *      it) with a fresh ttl. ⚠⚠ This is the clause that propagates a front through a
 *      growing herd, and it is the one that is easy to omit: without it a wildebeest
 *      walking into a marching herd would keep walking its own way, and the herd
 *      would only ever be as large as the group that founded it. With no standing
 *      consensus to adopt — every member free — a joiner is simply free too.
 *
 * ⚠⚠ **Clause 3 is why the commitment records its label** (`herdCommitLabel`).
 * "Joining" is not "my ttl expired"; it is "my commitment belongs to something
 * else", and there is no way to ask that question without remembering which label
 * the commitment was made in. A fourth persisted field is the price of the clause,
 * and the alternative — treating a joiner as free — is the smear the rule exists to
 * refuse.
 *
 * ## Why the strength cannot climb
 *
 * A herd that read its own consensus back into its own consensus would ratchet: n
 * animals all holding heading θ at strength s would agree perfectly, and any
 * formula that summed *those* would grow without bound. So the fresh consensus is
 * computed **only from migration cues** — state this system does not write — and a
 * joiner **copies** a standing strength rather than combining several. There is no
 * path from `herdStrength` back into `herdStrength`, which is a structural
 * guarantee rather than a tuned one, and `config.consensus.maxStrength` is the
 * second belt.
 *
 * ## Wildebeest subherds, and what could not be built
 *
 * The brief wanted subherds that persist while spatially separated. That is
 * literally a group record — but the wildebeest is 219 founders declaring
 * `groups.forms: false` as a stated design decision (a wildebeest aggregation is
 * fission–fusion), and putting them on the registry needs ~28–100 records for that
 * species alone. **The nearest legal thing is this commitment**: a shared heading
 * carried on the entity, which two halves of a torn herd keep holding after they
 * can no longer see each other. ⚠ Do not "fix" this later by flipping `forms`.
 */

/**
 * Below this the resultant of a set of headings has no direction, and asking for
 * one is the trap this constant exists for.
 *
 * ⚠⚠ **`Math.atan2(0, 0)` is `0`** — a perfectly valid-looking heading pointing due
 * east. It is the third member of the family §16 records (`0/0` silently deleting
 * an action through `argmaxUtility`, `clamp01(undefined)` parking an animal at NaN)
 * and much the nastiest to spot, because it does not look like an error at all: it
 * looks like a whole wildebeest herd deciding to march east. Opposed cues cancel
 * exactly this way — a resultant of `6.1e-17` from `sin(0)` and `sin(π)` is not a
 * direction, it is the floating-point residue of two headings that disagreed
 * completely — and the honest answer for a herd that could not agree is **no
 * consensus**, which sends every member back to its own nose.
 *
 * `blendHeadings` already guards its own version of this (migration/migration.js).
 */
export const RESULTANT_EPSILON = 1e-12;

/**
 * The consensus weight a species declares, or 0 when it declares none.
 *
 * ⚠ **0 is the identity and the mechanism leaves on its first comparison** — the
 * `mobWeight` pattern. A species that says nothing is never accumulated, never
 * committed, and never has a field written, so it keeps `createEntity`'s nulls for
 * life.
 *
 * ⚠ **1 is not a maximum, but it is the meaningful reference point**: at 1 a
 * perfectly coherent herd drifts at exactly the mean strength of the cues behind
 * it, so the consensus *replaces* the migration drift with the herd's version of
 * the same thing rather than amplifying it. Above 1 the herd pulls harder than its
 * own evidence, which is a claim a species file should have to make out loud.
 *
 * The shape of `herdRadiusOf` and `groupsOf`: absent, non-numeric or non-positive
 * is refused rather than clamped, so the caller's one test is the only test.
 *
 * @param {{behavior?: {consensusWeight?: number}}} [species] a resolved species record
 * @returns {number}
 */
export function consensusWeightOf(species) {
  const weight = species?.behavior?.consensusWeight;
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Every species in a world that declares a consensus weight, keyed by id.
 *
 * Built **once per world** and checked for emptiness before anything else — the
 * same early-out `associationsIn`, `herdRadiiIn` and `GroupSystem`'s forming set
 * use, and for the same reason: a mechanism no species asks for should cost one
 * `size` comparison, not a lookup per animal per tick.
 *
 * @param {{all: () => object[]}} [registry] the species registry
 * @returns {Map<string, number>}
 */
export function consensusWeightsIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const weight = consensusWeightOf(species);
    if (weight > 0) byId.set(species.id, weight);
  }
  return byId;
}

/**
 * Resolve an accumulated resultant into a heading and a strength, or null when the
 * cues behind it cancelled.
 *
 * `sumSin`/`sumCos` are strength-weighted sums over `count` contributors, so the
 * resultant's length divided by the count is the **circular mean magnitude**: the
 * mean cue strength scaled by how much the contributors agreed. Perfect agreement
 * gives the mean strength back; disagreement drives it toward zero. That is where
 * "the consensus decays when the gradient reverses" comes from, and it needs no
 * decay term anywhere — reversal *is* disagreement.
 *
 * ⚠ Returns null rather than a zeroed pair when the resultant is degenerate, so a
 * caller cannot accidentally commit to `atan2(0, 0)`. See `RESULTANT_EPSILON`.
 *
 * @param {number} sumSin @param {number} sumCos @param {number} count
 * @returns {{heading: number, strength: number}|null}
 */
export function consensusOf(sumSin, sumCos, count) {
  if (!(count > 0)) return null;
  const resultant = Math.hypot(sumSin, sumCos);
  if (!(resultant > RESULTANT_EPSILON)) return null;
  return { heading: Math.atan2(sumSin, sumCos), strength: resultant / count };
}
