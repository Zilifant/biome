/**
 * Calf weight (BEHAVIOR-PLAN.md P4) — a herd's centre of mass is pulled toward the
 * animals that cannot look after themselves.
 *
 * The fourth thing to occupy the same slot in `SocialSystem`'s neighbour loop, and
 * the first that is not about *identity* at all. `association.js` asks whether a
 * body is of my species, `banding.js` whether it is in my band; this one asks
 * whether it is **somebody's dependent calf**, and answers with the same kind of
 * number: how much of a body it is worth when the herd's centre is worked out.
 * Weight the calves up and the adults converge on them, which is the whole
 * mechanism — no new action, no new state, no second grid walk.
 *
 * ⚠⚠ **"A defensive ring falls out of this" is false, and the claim has been
 * downgraded rather than quietly dropped.** A weighted mean of positions produces a
 * *blob*, not a shell: nothing in this engine repels, so there is no force that
 * could hold adults at a radius from the calves they are converging on. The only
 * thing in the world producing anything shell-like is
 * `locomotion.maxOccupantsPerCell` refusing entry to a full cell, which is an
 * emergent one-cell crust and not a formation. What **is** measurable, and what
 * this ships as, is: **a calf sits nearer the herd's centre than an adult does.**
 *
 * ⚠⚠ **The bonus is gated on the *observer* being grown, and without that gate the
 * mechanism inverts.** A dependent juvenile runs the identical loop, so an ungated
 * bonus makes a crèche of calves weight *each other* up and the adults down — a
 * self-reinforcing calf ball that drifts off the herd it is supposed to be inside.
 * That is not a hypothetical: the zebra's `herdWeight` of 1.15 already outranks its
 * `followWeight` of 0.7, so a calf steering at other calves beats a calf steering at
 * its own mother. It is a `lifeStage` test rather than a species test — legal, and
 * the same test the `adults` tally beside it already makes.
 *
 * ⚠ **`guardianId !== null` is the predicate, and it is *dependency* rather than
 * age.** `ParentingSystem` ends the bond the instant an animal stops being a
 * juvenile or its guardian dies, so this is exactly "a juvenile that still belongs
 * to somebody" — the same thing the inspection block already calls `dependent`. It is
 * strictly narrower than `lifeStage === 'juvenile'`, and where the two disagree is
 * **the orphan**: weaned on the spot, still a juvenile, and no longer weighted up
 * by anybody. That is a stated consequence rather than an oversight — an orphan has
 * no mother keeping station on it, which is the honest reading of what this
 * mechanism models — and it is recorded because it makes an orphan's already poor
 * odds (§1.4 A12) slightly worse.
 *
 * ⚠ **Conspecifics only.** An associate's body is already worth exactly what the
 * observer's species declared it to be worth (`association.js`), and that
 * declaration is the *one* place a heterospecific rate is spent — D34's rule, and
 * the collision `MIXER` exists to catch in `herding.test.js`. Multiplying a
 * world-level calf bonus onto it would put a second, undeclared heterospecific rate
 * in the same product. A gazelle standing with wildebeest is drawn to the
 * wildebeest herd, not preferentially to its calves.
 *
 * ⚠ **It composes with the band affinity rather than replacing it**, and that is
 * not the double charge D34 forbids: "is this animal in my band" and "is this
 * animal a dependent calf" are two independent facts about one body, each spent
 * once. A bandmate's calf is worth `sameBandWeight × calfWeight`, which is what
 * both declarations, read literally, say it should be.
 *
 * The world-level switch **and** the number are `config.social.calfWeight`, in the
 * global section with no per-species half at all. That is deliberate on D11's
 * grounds — a config default plus a species override is two homes for one number —
 * and it is affordable here because, unlike a herd radius or a band affinity, this
 * says nothing species-specific: every species in this world that has young has
 * young that cannot fend for themselves. **1 is the identity and the reproducible
 * control**, and `x * 1` is `x` for every finite double, so the off arm is
 * byte-identical rather than merely close.
 *
 * ⚠⚠ **And 1 is what the demo ships at, because 2.5 and 4 were measured there and
 * neither did anything resolvable.** Four seeds × 1200 ticks, populations matched:
 * an unrelated adult stands 3.21 units from the centre of its herd's calves at
 * weight 1, 3.36 at 2.5, and 3.22 at 4 — against a per-seed spread of 2.8–4.1
 * *within* a single arm. The arithmetic below is real and `test/social.test.js`
 * pins it; what the demo says is that a calf is ~15% of a mixed herd, so the centre
 * moves a fraction of a unit against a `herdDistance` of 2, and herding is the
 * weakest utility there is. That is the same wall every steering mechanism since
 * Step 24 has hit, and it is recorded rather than tuned around.
 */
import { CONSPECIFIC_WEIGHT } from './association.js';

/**
 * Whether this animal is a dependent calf — one whose parent bond has not been
 * broken by weaning-out, maturity, or death.
 *
 * @param {{guardianId?: number|null}} entity
 * @returns {boolean}
 */
export function isDependentCalf(entity) {
  return (entity?.guardianId ?? null) !== null;
}

/**
 * Whether this animal is old enough to be pulled toward somebody else's calf.
 *
 * ⚠ The **observer** test, and the whole reason the mechanism does not invert. See
 * the header: an ungated bonus makes calves converge on calves.
 *
 * @param {{lifeStage?: string}} entity
 * @returns {boolean}
 */
export function keepsStationOnCalves(entity) {
  return entity?.lifeStage === 'adult' || entity?.lifeStage === 'senescent';
}

/**
 * The calf weight a world actually runs on: the declared number, or
 * `CONSPECIFIC_WEIGHT` when it is absent, nonsense, or parity.
 *
 * ⚠ **Resolved once, and it is the mechanism's only source of truth about whether
 * it is on.** The other three social modules early-out on an empty `Map`; this one
 * has no per-species map to be empty, so the equivalent is a single comparison
 * against the identity, made once per world rather than per animal.
 *
 * ⚠ **Anything not strictly above zero is refused rather than clamped**, on
 * `herdRadiusOf`'s grounds. A *negative* weight is `banding.js`'s landmine — it can
 * drive the centroid's denominator through zero, and `sum / ~0` is ±Infinity, then
 * a NaN heading, then an animal parked at NaN forever. **Zero** is refused too,
 * where `otherBandWeight` accepts it: "adults ignore calves entirely" is a
 * different mechanism from this one wearing its name, and it can empty the centroid
 * of an adult whose only neighbours are calves.
 *
 * @param {number} [calfWeight] the world's `config.social.calfWeight`
 * @returns {number}
 */
export function calfWeightOf(calfWeight) {
  const usable = typeof calfWeight === 'number' && Number.isFinite(calfWeight) && calfWeight > 0;
  return usable ? calfWeight : CONSPECIFIC_WEIGHT;
}

/**
 * ⚠ **There is deliberately no `calfWorthFor(calfWeight, observer, other)` here**,
 * and the reason is the shape of the two tests rather than tidiness. The observer
 * half is invariant across a whole neighbour loop — an animal's own life stage does
 * not change while it counts its neighbours — so `SocialSystem` hoists
 * `keepsStationOnCalves(entity)` once per animal and asks only `isDependentCalf`
 * per neighbour, exactly as it already hoists a species' band affinity and its
 * association weights. A composed helper would read the observer's `lifeStage`
 * once per *neighbour*, which is the per-neighbour cost D28 exists to warn about.
 * The multiplication itself is one line at the call site, where it is visible
 * beside the band weight it composes with.
 */
