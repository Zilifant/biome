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
 * How many of this animal's own band are standing with it, for the purpose of
 * the cooperative ceiling below — or 0 for a species that has no such ceiling.
 *
 * ⚠⚠ **The count is not measured here, and that is the whole reason A59 turned
 * out to be affordable.** `SocialSystem` already publishes `bandmates` — how many
 * of this animal's own group record are inside its herd radius — for **every**
 * animal, whatever its species declares, because P7's rally needed it. So the
 * question "is help at hand" was already answered every tick and nobody was
 * reading the answer. A second count here would be two rules for one question
 * (D11) and a second grid walk besides.
 *
 * ⚠⚠ **It is *last tick's* count when perception asks, and that is stated rather
 * than discovered.** `PerceptionSystem` runs in the `perception` phase and
 * `SocialSystem` at priority −10 of `decision`, which is later in the same tick —
 * so the count perception reads was written on the previous tick. Harmless in
 * steady state and precedented (the band affinity reads last tick's
 * `groupRecordId` for exactly the same reason, DOCS §9), but **any test that
 * assembles a group and asserts on eligibility must step ≥ 2 ticks**. Resolving
 * it in the decision system instead would be no better: perception is what
 * *filters* `nearestPrey`, so a ceiling applied later would be a ceiling on an
 * animal already discarded.
 *
 * ⚠⚠ **That cross-phase read is exactly why the count is on the entity and not in
 * `world.social`** (2026-08-09, **A99**, save format 35). The note above stopped one
 * step short for months: a value read a phase *before* its writer runs is a value
 * that must survive a tick boundary, and `world.social` is transient and never
 * serialized. A restored world's map is empty, so every hunter read 0 for one tick,
 * the cooperative ceiling collapsed to the solo ceiling, and prey a clan could take
 * became ineligible — for one tick, on the tick after every load. The symptom was a
 * save/load divergence that looked like float drift in a position field. **The
 * generalisation: transient state read across a phase boundary is not transient.**
 *
 * ⚠ **Gated on the species declaring a group ceiling**, so a roster with none pays
 * one property read and nothing else — the D16 identity rule that every mechanism
 * here ships with. It is now two property reads and no `Map.get` at all, which is
 * strictly cheaper than the version it replaces, in the hottest loop in the engine.
 *
 * @param {{bandmates?: number}} hunter the hunting entity
 * @param {object|null} predation the hunter's resolved block
 * @returns {number}
 */
export function groupBackingFor(hunter, predation) {
  const ratio = predation?.groupPreyMassRatio;
  if (ratio === null || ratio === undefined) return 0;
  return hunter.bandmates ?? 0;
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
 * ⚠⚠ **A second, higher ceiling applies when the hunter has company** — closing
 * **A59**, which has been open since 2026-07-30 with the words "this world can say
 * *a pride is better at it* but not *only a pride will try it*". `backing`
 * band-mates within the herd radius lift the ceiling from `maxPreyMassRatio` to
 * `groupPreyMassRatio` once it reaches `backingForLargePrey`. Both absent is
 * exactly the old function.
 *
 * ⚠ **A59's own note proposed "teaching the perception hot loop about company"
 * and called it not worth it for one species.** It costs nothing here because the
 * count already existed (see `groupBackingFor`) and because eligibility was
 * *already* hoisted per animal — the group ceiling is resolved in the same place,
 * so the in-loop test is still one compare against one number.
 *
 * ⚠ **A ceiling that moves is a target that can stop being eligible mid-stalk**,
 * which is A58's failure shape: a clan that scatters drops its quarry. The guard
 * is the *solo* ceiling staying where it is, so a hunter that commits alone stays
 * committed alone; what the group buys is prey it would never have started on.
 *
 * @param {object} hunter @param {object|null} predation resolved block
 * @param {number} [backing] band-mates at hand (`groupBackingFor`)
 * @returns {number}
 */
export function maxPreyMassFor(hunter, predation, backing = 0) {
  const group = predation?.groupPreyMassRatio;
  if (group !== null && group !== undefined && backing >= (predation.backingForLargePrey ?? Infinity)) {
    return hunter.bodyMass * group;
  }
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
 * ⚠ **`backing` belongs to the *hunter*, not to the caller**, which matters most
 * on the threat side: an animal asking "does that thing hunt me?" has to read the
 * company *it* has, not the company the asker has. A zebra that could not see a
 * clan as a clan would be hunted by one and never flee from it — the asymmetry
 * this parameter exists to prevent, and the mirror the block comment beside the
 * threat branch in `PerceptionSystem` has always made.
 *
 * @param {object} hunter @param {object} prey
 * @param {object|null} predation the **hunter's** resolved predation block
 * @param {number} [backing] the **hunter's** band-mates at hand
 * @returns {boolean}
 */
export function isEligiblePrey(hunter, prey, predation, backing = 0) {
  return (
    isReachablePrey(hunter, prey) &&
    prey.bodyMass <= maxPreyMassFor(hunter, predation, backing) &&
    prey.bodyMass >= minPreyMassFor(hunter, predation)
  );
}

/**
 * Whether `hunter` would take `prey`, resolving the hunter's block **and** its
 * band-mates on the spot — the threat side's one call.
 *
 * ⚠⚠ **This exists to keep a species lookup inside a short-circuit** (D28). The
 * threat branch in `PerceptionSystem` reads `world.species.get(other.speciesId)`,
 * and the cooperative ceiling needs a second read of `world.social` beside it. The
 * first draft of P3 hoisted both onto a `const` above the `if` — which moved them
 * out from behind `hunts()`, so **every neighbour of every animal paid a map
 * lookup every tick** instead of only the rare true case of the reverse predator
 * relation. That is exactly the arity-and-laziness cost D28 records, in exactly the
 * loop it records it about. Wrapping both in one call that the `&&` chain reaches
 * last restores the laziness and keeps the branch readable.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} hunter the animal that might hunt @param {object} prey
 * @returns {boolean}
 */
export function threatens(world, hunter, prey) {
  const predation = world.species.get(hunter.speciesId)?.predation;
  return isEligiblePrey(hunter, prey, predation, groupBackingFor(hunter, predation));
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
