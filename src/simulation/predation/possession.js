/**
 * Carcass possession and kleptoparasitism (PLAN-SPECIES.md §3.9).
 *
 * A carcass used to have no owner. Several carnivores on one body contended
 * only through the deterministic id ordering in `FeedingSystem` — the lower id
 * ate first and the rest took the remainder. That is fine for one predator and
 * one scavenger; it is wrong for a predator, a clan of thieves, and a vulture,
 * which is the most legible thing this roster can produce and arrives in
 * batch 1.
 *
 * **The whole mechanism is one field and three predicates.** A carcass carries
 * `possessorId`; an animal that feeds on it claims it; another carnivore that
 * wants it either feeds beside the holder, waits, or takes it by contest.
 *
 * ⚠ **Possession is held by presence, not by a clock.** The plan asked for
 * "a `possessorId` and a freshness stamp"; the stamp is deliberately absent,
 * because presence answers the same question without storing anything. A holder
 * that is still standing over the body holds it; one that walked away does not,
 * and no timer has to expire to say so. That is the same judgement that keeps
 * dominance, disease severity, and every disturbance effect derived on read —
 * and it means possession cannot get stuck in a state nobody can clear.
 *
 * ⚠ **Group-held possession falls out for free**, which is the first real
 * payoff of the group registry (§3.8). A clanmate of the holder feeds *beside*
 * it rather than against it, and the test is `eater.groupRecordId ===
 * holder.groupRecordId` — read off the live holder, so there is no second copy
 * of the membership on the carcass to go stale. The consequence is that one
 * clan member takes the body by contest and the rest simply eat, which is what
 * a clan displacing a lone predator actually looks like. (If the holder dies its
 * clanmates lose the shared claim for one tick, until whichever of them is still
 * feeding re-claims it. One tick of pedantry, against a stored group id that
 * could outlive the group.)
 *
 * ⚠ **A challenger only challenges when it is strictly stronger, and that is
 * what keeps the mechanism quiet.** Dominance decides a contest — there is no
 * roll to lose (DOCS §9) — so an outmatched animal challenging would be
 * guaranteed to lose, spend three draws, and risk a wound for nothing. It waits
 * instead. And because the winner then holds the body and eats (raising its
 * energy, and so its dominance), the arrangement is self-stabilising: a takeover
 * happens once, not once per tick, with no cooldown field to store and no
 * flapping. Two exactly-equal animals never contest at all, so the tie case
 * cannot oscillate either.
 *
 * ⚠ **One predicate, two readers.** `DecisionSystem` asks whether a carcass is
 * worth walking to and `FeedingSystem` asks whether it may be eaten, and if
 * those two answers ever disagree the animal walks to a body it is then refused
 * — the exact D11 shape that `drinkRange` and `carcassRange` were both fixed
 * for. So both call the functions below rather than each implementing the rule.
 *
 * Ownership: `possessorId` is written only by `FeedingSystem`. Randomness: the
 * contest spends exactly three draws on its **own** `possession` stream,
 * whatever the outcome — a dedicated stream precisely so that carcass fights
 * cannot shift the `social` sequence that mate contests and territory disputes
 * already share.
 */
import { dominanceOf } from '../social/dominance.js';
import { CANOPY, canClimb } from '../locomotion/climbing.js';

/**
 * Whether this animal can get at this body at all — the question that comes
 * *before* who holds it (phase T2, A67).
 *
 * A carcass cached in a tree is reachable only by a species that climbs. ⚠⚠ **It
 * tests what the eater *can* do, not where the eater currently is**, and the
 * alternative was built first and discarded, so the reasoning is worth keeping:
 *
 * The obvious rule is `shareElevation(eater, carcass)` — be up the tree to eat
 * what is up the tree — which is what gates *predation*. It fails here on
 * ordering. Elevation is resolved in the **movement** phase from the action an
 * animal chose, and which carcass it is eating is not known until the
 * **interaction** phase; so a climber choosing `eat` would have to already be at
 * the right height for a body it has not selected yet. Every fix for that is a
 * state machine (climb-to-eat, eat, climb-down) with a stored transition, which
 * is exactly what possession was designed *not* to have — it is held by presence,
 * with no timer to expire and no state to get stuck in.
 *
 * A capability test needs none of that and says the thing that actually matters:
 * **the hyena clan cannot take this kill.** That is A67's own wording — "cached
 * carcasses would remain spatially in the same cell but become inaccessible to
 * non-climbers" — and it is the whole ecological claim. What is given up is
 * cosmetic: a feeding leopard is not necessarily *drawn* up the tree.
 *
 * ⚠ **This is not part of possession and must not be gated on
 * `possessionEnabled`.** Reachability is a fact about the body; possession is a
 * contest over it. Both readers call this before they ask anything else, because
 * a decision system that walks an animal to a body the feeding system then
 * refuses leaves it choosing `eat` and starving on the spot (D11).
 *
 * @param {import('../world/World.js').World} world
 * @param {object} carcass @param {object} eater
 * @returns {boolean}
 */
export function reachesCarcass(world, carcass, eater) {
  if (carcass.elevation !== CANOPY) return true;
  return canClimb(world.species.get(eater.speciesId));
}

/**
 * Possession parameters. Held as one object so a system stores a single field
 * and hands it straight to the predicates, rather than every caller copying
 * five scalars around.
 */
export const DEFAULT_POSSESSION = Object.freeze({
  enabled: true,
  /** How close the holder must still be for the claim to stand. */
  range: 2,
  /**
   * ⚠ What a bystander still gets, as a fraction of its normal intake.
   *
   * **The first version of this excluded outright — share 0 — and it was
   * measured wrong**, in a way worth keeping written down. Ten seeds against the
   * control: stalker survival **9/10 → 6/10**, with their deaths shifting from
   * `age` (53 → 37) to `starvation` (3 → 10) and `dehydration` (2 → 13). The
   * cause was not the predator being robbed of carrion — per-capita carrion
   * barely moved — but *young* predators being locked out by numbers:
   * `dominanceOf` halves for immaturity, so a subadult stalker scores below a
   * well-fed adult corvid, and the demo runs ~80 corvids against ~7 stalkers.
   * Recruitment failed and the population aged out.
   *
   * A share fixes what exclusion got wrong about the ecology, not just about the
   * numbers: a vulture at an occupied kill does not get nothing, it gets scraps
   * at the edge and the carcass when the big animal leaves. The holder still
   * takes four times what a bystander does, which is what possession is *for*.
   * **0 restores strict exclusion** and is the measured variant above.
   */
  share: 0.25,
  escalationChance: 0.3,
  fightInjurySeverity: 0.2,
  fightWinnerInjuryFraction: 0.4,
});

/**
 * The animal currently holding this carcass, or null if it is unclaimed.
 *
 * Pure and side-effect free: a claim that no longer holds simply reads as
 * absent, so nothing has to go around clearing stale `possessorId`s when an
 * animal dies or wanders off.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} carcass
 * @param {object} possession resolved possession parameters
 * @returns {object|null}
 */
export function holderOf(world, carcass, possession) {
  if (!possession.enabled) return null;
  const holderId = carcass.possessorId ?? null;
  if (holderId === null) return null;
  const holder = world.entities.get(holderId);
  if (!holder || !holder.alive || holder.kind !== 'animal') return null;
  const dx = holder.x - carcass.x;
  const dy = holder.y - carcass.y;
  return dx * dx + dy * dy <= possession.range * possession.range ? holder : null;
}

/**
 * Whether `eater` may feed without contesting: the body is unclaimed, it is
 * already the holder, or the holder is a groupmate.
 * @param {object|null} holder @param {object} eater
 */
export function mayFeedFreely(holder, eater) {
  if (holder === null || holder.id === eater.id) return true;
  return eater.groupRecordId !== null && eater.groupRecordId === holder.groupRecordId;
}

/**
 * Whether `challenger` would take the body off `holder` rather than wait.
 * Strictly greater, so an even match is a stand-off rather than a coin flip.
 * @param {object} challenger @param {object} holder
 */
export function outranks(challenger, holder) {
  return dominanceOf(challenger) > dominanceOf(holder);
}

/**
 * What fraction of its normal intake `eater` gets off this body: 1 if it holds
 * it, shares a group with the holder, or is about to take it; `share` otherwise.
 *
 * @param {object|null} holder @param {object} eater @param {object} possession
 * @returns {number}
 */
export function shareFor(holder, eater, possession) {
  if (mayFeedFreely(holder, eater) || outranks(eater, holder)) return 1;
  return possession.share;
}

/**
 * Whether this carcass is worth approaching at all — the single predicate the
 * decision system asks, matching what the feeding system will actually allow.
 *
 * ⚠ With any positive `share` this is always true, which is the point: the
 * dangerous version of possession is the one where a body reads as food to the
 * decision system and is then refused, because the animal keeps choosing `eat`
 * and starves standing on it. Keeping the question here — rather than deleting
 * it once shares made the answer usually yes — is what keeps `share: 0` (strict
 * exclusion) correct as well.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} carcass @param {object} eater
 * @param {object} possession resolved possession parameters
 * @returns {boolean}
 */
export function isAvailableTo(world, carcass, eater, possession) {
  if (!reachesCarcass(world, carcass, eater)) return false;
  return shareFor(holderOf(world, carcass, possession), eater, possession) > 0;
}
