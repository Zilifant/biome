/**
 * Band affinity (BEHAVIOR-PLAN.md P2) — how much more a **bandmate** is worth than
 * a stranger of the same species when the herd's centre of mass is worked out.
 *
 * ⚠⚠ **This is the persistent group record's first consumer that moves an animal.**
 * DOCS §9 records that `groupRecordId` was read by exactly two things — carcass
 * possession and cooperative hunting — so a zebra band was a roster nobody acted
 * on: members did not seek each other, did not weight each other above unfamiliar
 * zebras, and did not follow a band-specific centre. Two bands that walked into
 * each other became one indistinguishable aggregation while their membership
 * records stayed cleanly separate. That is the gap this closes.
 *
 * **It is the same lever `association.js` pulls, in the same expression.** That
 * file sets the exchange rate between a body of *another species* and one of your
 * own; this one sets it between a body of your own species that is **in your band**
 * and one that is not. Both are spent inside the centroid and nowhere else:
 *
 * ```js
 * behavior: Object.freeze({ sameBandWeight: 2.5, otherBandWeight: 0.35 })
 * ```
 *
 * 1 is parity — a bandmate worth exactly what any conspecific is worth — so a
 * species that declares nothing, or declares 1 and 1, produces the arithmetic it
 * always did, bit for bit (`x * 1` is `x` for every finite double).
 *
 * ⚠⚠ **A weighted mean of positions cannot repel, so `otherBandWeight` is a
 * discount and never a push.** The brief asked for "separation between adjacent
 * bands" and this is the honest approximation of it: **differential attraction**.
 * Each animal's centre is dominated by its own band, so two overlapping bands are
 * drawn to two different points and drift apart — which looks like separation and
 * is not. A *negative* weight would be the literal request, and it is a landmine
 * rather than a feature: it can drive the denominator through zero, and `sum / ~0`
 * is ±Infinity, then a NaN heading, then `entity.x = NaN` **permanently**, at which
 * point the animal vanishes from every spatial query in the world. So a negative
 * declaration is refused below rather than clamped, and this paragraph is why.
 *
 * ⚠ **Zero is allowed and means "ignore", not "avoid".** A species declaring
 * `otherBandWeight: 0` builds its centre from its own band alone; if it has no
 * bandmate in range the total weight is zero and the summary reports no centroid,
 * which the decision system already treats as "nothing to steer at". That is a
 * coherent thing to want, so it is expressible.
 *
 * ⚠ **Conspecifics only, and the gate is deliberate.** A group record is
 * single-species (`GroupRegistry` header), so "in a different band" is a
 * meaningless thing to say about an animal of another species — it is not in your
 * band because it *could* not be, and discounting it for that would be an
 * accidental second heterospecific weight fighting the declared one in
 * `association.js`. Applied to conspecifics, nowhere else.
 *
 * ⚠ **It reads last tick's membership.** `SocialSystem` runs at priority −10 and
 * `GroupSystem` at −8, so the `groupRecordId` compared here was settled on the
 * previous tick. Harmless in steady state — membership changes on the order of
 * once per animal per hundreds of ticks — but a test that founds a band and then
 * asserts on the centroid must step at least twice.
 *
 * The world-level off switch is `config.social.bandAffinity`, in a global section
 * beside the per-species numbers rather than inside a species block — a species
 * block beats the config (DOCS §8), so a switch inside one could not switch
 * anything off. Same shape as `perSpeciesRadius`, `association.enabled`, and every
 * measured mechanism since migration.
 */
import { CONSPECIFIC_WEIGHT } from './association.js';

/**
 * The band weights a species declares, or null when it declares nothing usable.
 *
 * ⚠ A non-number, a non-finite number, or a **negative** one is treated as no
 * declaration at all rather than clamped — see the header for why negative is the
 * one value that cannot be quietly reinterpreted. Zero is accepted: it means
 * "contributes no position", which is coherent.
 *
 * ⚠ Declaring 1 and 1 also resolves to null, because that *is* the unweighted
 * behaviour and an empty map is what buys every other species the one `Map.size`
 * comparison this mechanism costs them.
 *
 * @param {{behavior?: {sameBandWeight?: number, otherBandWeight?: number}}} [species]
 * @returns {{same: number, other: number} | null}
 */
export function bandAffinityOf(species) {
  const usable = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const declared = species?.behavior ?? null;
  if (declared === null) return null;
  const same = usable(declared.sameBandWeight) ? declared.sameBandWeight : CONSPECIFIC_WEIGHT;
  const other = usable(declared.otherBandWeight) ? declared.otherBandWeight : CONSPECIFIC_WEIGHT;
  if (same === CONSPECIFIC_WEIGHT && other === CONSPECIFIC_WEIGHT) return null;
  return { same, other };
}

/**
 * Every species in a world that declares a band affinity, keyed by id.
 *
 * Built once per world and checked for emptiness before the entity walk, the same
 * early-out `associationsIn` and `herdRadiiIn` use and for the same reason.
 *
 * @param {{all: () => object[]}} [registry]
 * @returns {Map<string, {same: number, other: number}>}
 */
export function bandAffinitiesIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const affinity = bandAffinityOf(species);
    if (affinity !== null) byId.set(species.id, affinity);
  }
  return byId;
}

/**
 * What one conspecific body is worth to another, given this animal's declared
 * affinity and the two membership records.
 *
 * ⚠ **Either id being null is parity, not a discount.** An animal that belongs to
 * no band has no basis to prefer anyone, and an animal that belongs to one has no
 * basis to discount a conspecific who belongs to none — it is not in a *rival*
 * band, it is simply unattached, and the registry founds new bands out of exactly
 * those animals.
 *
 * @param {{same: number, other: number} | null} affinity from `bandAffinityOf`
 * @param {number|null} mine the observer's `groupRecordId`
 * @param {number|null} theirs the neighbour's `groupRecordId`
 * @returns {number}
 */
export function bandWorthFor(affinity, mine, theirs) {
  if (affinity === null || mine === null || theirs === null) return CONSPECIFIC_WEIGHT;
  return mine === theirs ? affinity.same : affinity.other;
}
