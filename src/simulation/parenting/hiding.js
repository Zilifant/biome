/**
 * Neonatal concealment — the hidden-fawn stage (PLAN-SPECIES.md §3.14, phase 8).
 *
 * A gazelle fawn does not follow its mother from birth. It lies hidden for its
 * first days while she forages nearby and returns to nurse it, and only then
 * begins to follow and join the herd. Until now this world had no such stage: a
 * juvenile followed its guardian from the tick it was born (`followParent`), so
 * "hidden" was not a thing an animal could be.
 *
 * **Most of this is a suppression, not a new mechanism**, which is the cheap
 * half: a hiding calf does not follow, does not wander, and does not forage, so
 * three existing behaviours simply switch off. The predicates below are that
 * switch, and they are pure so both the decision system and the perception
 * system can read the same answer (D11 — one predicate, one owner, many
 * readers).
 *
 * ⚠ **The expensive half is the mother, and it is A34.** An unweaned juvenile
 * eats nothing but what its guardian provisions, and provisioning needs the
 * guardian in range — so a calf that no longer follows will starve unless the
 * mother has a *reason to come back*. DOCS A34 records that patrolling is
 * near-inert precisely because it has no reason, and names the lever: "give
 * patrol a reason — food worth returning to, or a den." A hidden calf is the
 * first real reason this world has ever had, which is why it is worth building
 * for its own sake as well as for the gazelle. That half lives in the decision
 * system as the `tend` action.
 *
 * ⚠ **Concealment requires cover, not merely hiding.** A fawn lying in the open
 * is still visible; one in cover, thicket, or a burrow is not reported as prey.
 * That is deliberate: it makes cover a genuine refuge (A18) rather than only a
 * speed modifier, and it reuses `world.isShelteredAt`, which is the established
 * chokepoint for "is this ground sheltering" (DOCS §7 Chokepoints) — so a future
 * shelter source works here for free and perception never learns a new one.
 *
 * ⚠ **A species with no `aging.hiddenUntil` is completely unaffected.** The
 * default is 0, and `age < 0` is false for every animal that has ever lived, so
 * this is exactly the identity rather than approximately it (D16) — the same
 * discipline `predation`'s `null` ratios and `hunting.agility`'s 1 follow.
 */

/**
 * Age below which a dependent of this species hides rather than follows.
 * 0 — the default for every species that says nothing — means no hidden stage.
 * @param {{aging?: {hiddenUntil?: number}}} [species] resolved species record
 * @returns {number}
 */
export function hiddenUntilFor(species) {
  return species?.aging?.hiddenUntil ?? 0;
}

/**
 * Whether this animal is in its hidden stage: young enough, still bonded, and
 * still dependent.
 *
 * All three conditions matter. **Bonded**, because a hiding calf is one whose
 * mother is coming back — an orphan must get up and fend for itself, which it
 * does automatically since `ParentingSystem` clears `guardianId` on the
 * guardian's death (and A12's orphan mercy weans it early). **Dependent**,
 * because once weaned the animal feeds itself and lying still would starve it.
 *
 * @param {{age?: number, guardianId?: number|null, weaned?: boolean}} entity
 * @param {object} [species] resolved species record
 * @returns {boolean}
 */
export function isHiding(entity, species) {
  const hiddenUntil = hiddenUntilFor(species);
  if (hiddenUntil <= 0) return false;
  return entity.age < hiddenUntil && entity.guardianId !== null && entity.guardianId !== undefined && !entity.weaned;
}

/**
 * Whether this animal is hidden *and* on ground that hides it — the test a
 * hunter applies, as opposed to the one the calf itself acts on.
 *
 * ⚠ Called from inside the perception neighbour loop, so it sits **after** the
 * species relation and the mass gate and is paid only on their rare true case,
 * exactly as `isEligiblePrey` is. The cheap age check short-circuits before the
 * terrain lookup.
 *
 * @param {object} world
 * @param {object} entity the animal being looked at
 * @param {object} [species] the resolved record of *that animal's* species
 * @returns {boolean}
 */
export function isConcealed(world, entity, species) {
  return isHiding(entity, species) && world.isShelteredAt(entity.x, entity.y);
}
