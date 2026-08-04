/**
 * Prey eligibility (PLAN-SPECIES.md §3.6) — which individuals a predator will
 * commit to, as opposed to which *species* it hunts.
 *
 * `preySpeciesIds` has always been a flat list of who is edible, with no size or
 * age gate on it at all: a predator would commit to any listed species at any
 * size. With a 30 kg grazer and a 45 kg stalker that never mattered. With a
 * 180 kg lion, a 600 kg buffalo, and a 4000 kg elephant on the roster it is the
 * difference between a simulation and a farce — a leopard should take a
 * wildebeest *calf* while its mother walks past unbothered, and nothing should
 * hunt an adult rhino.
 *
 * ⚠ **The gate reads `bodyMass`, not `adultMass`, and that is the whole trick.**
 * `bodyMass` is what the animal weighs *now*, walked up the aging curve, so
 * age-structured prey selection falls out of a mass ratio for free: the calf is
 * under the leopard's ceiling and the cow is over it, with no life-stage
 * conditional anywhere and nothing new stored. Calf targeting, obtained from a
 * field that already existed.
 *
 * ⚠ **The test is deliberately kept out of `SpeciesRegistry.hunts()`.** That
 * predicate is the busiest in the engine — asked twice per neighbour per animal
 * per tick — and its linear `includes` was *measured*, not assumed (D24). It
 * stays the species relation; the mass gate runs after it, so the extra
 * comparison only happens on the rare true case.
 *
 * ⚠ **Elevation joined the gate on 2026-08-03** (phase T2, A67): a hunter and a
 * target on different levels are not each other's business, in both directions.
 * This is the *right* home for it — it sits beside the mass ratios, which
 * already resolve per pair on the rare true case of the species relation — and
 * it is deliberately **not** in `PerceptionSystem`'s shared visibility gate,
 * which is A63's trap. A leopard up a tree is plainly visible; it is simply out
 * of reach.
 *
 * ⚠ **Nothing in the shipped roster sets a ratio, so this is inert by
 * construction.** `null` means "no bound" and skips the comparison entirely —
 * exactly the identity, not approximately (D16). That is deliberate rather than
 * timid: the demo is a knife edge, and a ratio tight enough to be interesting
 * would stop a subadult stalker (bodyMass ~25 kg while it grows toward 45) from
 * taking an adult grazer (up to ~34 kg), which is a large ecological change for
 * a roster that has nothing to gain from it. The species that need ratios
 * declare them when they arrive.
 */

import { shareElevation } from '../locomotion/climbing.js';
import { isAirborne } from '../locomotion/flight.js';

/** The predation block of a species, or null if it declares none. */
export function predationOf(species) {
  return species?.predation ?? null;
}

/**
 * The heaviest prey this animal will commit to, as an absolute mass.
 *
 * Hoisted out of the neighbour loop on purpose: resolving the ratio once per
 * animal turns the in-loop test into a single numeric compare, and an absent
 * bound resolves to `Infinity`, which every real mass passes. The perception
 * loop is the hottest neighbour walk in the engine and D28 is what a small
 * change there can cost, so the cheap form is the one that ships.
 *
 * @param {object} hunter @param {object|null} predation resolved block
 * @returns {number}
 */
export function maxPreyMassFor(hunter, predation) {
  const ratio = predation?.maxPreyMassRatio;
  return ratio === null || ratio === undefined ? Infinity : hunter.bodyMass * ratio;
}

/**
 * The lightest prey this animal will bother with.
 *
 * The gazelle's protection in reverse: what stops a 600 kg predator spending a
 * sprint on something it cannot profit from. Absent ⇒ 0, which every mass
 * passes.
 *
 * @param {object} hunter @param {object|null} predation resolved block
 * @returns {number}
 */
export function minPreyMassFor(hunter, predation) {
  const ratio = predation?.minPreyMassRatio;
  return ratio === null || ratio === undefined ? 0 : hunter.bodyMass * ratio;
}

/**
 * Whether `prey` is an individual `hunter` would take, resolving the hunter's
 * block on the spot.
 *
 * Used where the bounds cannot be hoisted — perception asking "does that animal
 * hunt *me*?" has to read whichever species is doing the looking, and that is a
 * different block per neighbour. Only reached on the rare true case of the
 * species relation, so the lookup is paid at most a handful of times per animal.
 *
 * @param {object} hunter @param {object} prey
 * @param {object|null} predation the **hunter's** resolved predation block
 * @returns {boolean}
 */
export function isEligiblePrey(hunter, prey, predation) {
  return (
    isReachablePrey(hunter, prey) &&
    prey.bodyMass <= maxPreyMassFor(hunter, predation) &&
    prey.bodyMass >= minPreyMassFor(hunter, predation)
  );
}

/**
 * Whether a hunter can reach this individual at all, ignoring size — the half of
 * eligibility that is about *where* the animal is rather than *what* it is.
 *
 * ⚠⚠ **This exists as its own predicate because the prey side of perception
 * cannot call `isEligiblePrey`.** That loop hoists the two mass bounds into
 * plain numbers once per animal (D28: the neighbour walk is the hottest thing in
 * the engine and it is arity-sensitive), so it compares them inline rather than
 * calling in. Both directions therefore need the elevation test spelled out, and
 * spelling it out *twice* is worse than exporting it once.
 *
 * ⚠ **And this is emphatically not in `PerceptionSystem`'s shared gate** — the
 * `continue` that drops an unseen animal. That gate is **A63**: prey, threats,
 * mate candidates, a juvenile's guardian and territorial rivals all pass through
 * it, so a condition added there gates reproduction too, and the failure shows up
 * as a population number three subsystems away. A treed leopard is still visible,
 * still courtable, and still somebody's parent. It just cannot be reached.
 *
 * ⚠ **Flight joined it on 2026-08-04** (phase F1), as a second way of being out
 * of reach rather than as a second predicate: a bird on the wing is not prey, and
 * takes none. Both directions again, and the reasoning is the same as the
 * elevation flag's — flight carries no altitude, so there is no stoop from height
 * to model and nothing in the roster hunts on the wing. Stated as two explicit
 * comparisons rather than folded into `shareElevation`, because "up a tree" and
 * "in the air" are different mechanisms with one consequence, and a reader of
 * either module should not have to know about the other to know what it claims.
 *
 * @param {object} hunter @param {object} prey
 * @returns {boolean}
 */
export function isReachablePrey(hunter, prey) {
  return shareElevation(hunter, prey) && !isAirborne(hunter) && !isAirborne(prey);
}
