/**
 * Mobbing (DOCS A33, PLAN-SPECIES.md §3.7, phase 10) — prey that turns on the
 * predator instead of running.
 *
 * Cooperative defense in this world has been passive: adult groupmates standing
 * near a prey animal shave the capture odds (collective vigilance), and a parent
 * that has chosen to interpose counts double and makes the attempt dangerous. A
 * buffalo herd driving a lion off a calf is neither of those — it is *several*
 * adults actively facing the hunter, and without it a 600 kg buffalo is a gazelle
 * that weighs twenty times as much.
 *
 * ⚠⚠ **It is not a new action, and that is the whole design.** The obvious build
 * is a `mob` action competing with `flee`, and PLAN-SPECIES §3.7 describes it that
 * way. But `defend` **already** is that action — DOCS §7 Decision has described it
 * as "a predator is on kin or a groupmate; stand and face it" since Step 23, and
 * only the *kin* half was ever implemented. So mobbing is the groupmate half of a
 * behaviour that already exists: the same walk-toward-the-threat intent, the same
 * `defendingId` field, the same slot in the utility table, reached by a different
 * trigger and weighted by a different number.
 *
 * What that buys is worth stating, because it is the project's most expensive
 * lesson applied in advance (DOCS §9 Decision: *a new movement behaviour competes
 * with foraging, and foraging must win*):
 *
 *   - **Nothing new competes in the utility table.** The candidate set is exactly
 *     the size it was.
 *   - **The effect lands on products that already exist** — `shielding` in
 *     `captureChance`, and the `defenderInjuryBonus` term in `trampleChance` —
 *     rather than on a new mechanism.
 *   - **It cannot displace foraging**, because it only fires while a perceived
 *     predator is *committed to a groupmate*. A herd standing around unmolested
 *     grazes exactly as it did.
 *
 * ⚠⚠ **The animal being hunted stands its ground, and phase 10 got this wrong.**
 * The first cut excluded it — A33 is "prey collectively attacking a predator", so
 * the mob was the animals coming to the aid while the target ran. Phase 11
 * measured that to be self-defeating: **a fleeing animal separates from its herd**,
 * the chase carries it away from every potential mobber, and the capture then
 * happens alone in open ground. Over 12 000 tick-seeds with a lion pride hunting
 * buffalo, **not one attempt was resolved against a mob**, though the herd mobbed
 * plenty of times somewhere behind the chase.
 *
 * So a mobbing species' *target* turns and faces too, which is what a real buffalo
 * does and what keeps the hunt inside the herd where its herdmates are. The
 * effect is positional rather than a new term: standing does not raise
 * `shielding` — it is not an extra body — and `mobbersFor` still skips the prey.
 * It is also honestly a **trade**: an animal that stops running is reached sooner,
 * and what it buys is that its herd is still there when the predator arrives.
 *
 * ⚠ **Inert until a species declares `behavior.mobWeight`**, which is 0 in the
 * config and 0 for every shipped species: no ward is looked for, no grid is
 * queried, and the world is bit-identical. The buffalo is the animal this is for
 * and it arrives in phase 11 — so, as with `hunting.cooperationWeight`, this is
 * built now and *tuned* against the species it was built for rather than against
 * the gazelle it would otherwise be fitted to.
 *
 * Ownership: reads only, plus the `defendingId` the decision system already
 * writes. No draws, no new entity state, no save-format change.
 */

/**
 * World-level mobbing parameters — the machinery and the off switch.
 *
 * ⚠ In a global section rather than in `behavior` for the phase-8 reason: a
 * species block beats the config, so an off switch inside one cannot switch
 * anything off. The weight (biology) is per-species; the switch and the geometry
 * (machinery) are here.
 */
export const DEFAULT_MOBBING = Object.freeze({
  enabled: true,
  /**
   * How many adult groupmates an animal needs nearby before it will turn on a
   * predator. A mob is a *number* of animals — one buffalo facing a lion is a
   * dead buffalo — so this is the threshold that makes it collective rather than
   * suicidal. Counted from the social summary the sociality system already built
   * (`adults`, excluding this animal), so it costs no walk.
   *
   * ⚠⚠ **2 → 1 on 2026-08-09** (A100), and the reason is a measurement rather than
   * a change of mind about the principle. The count **excludes the animal itself**,
   * so 2 meant *three* buffalo before any of them would face a lion — and the
   * decisive fact is that **a hunt isolates its target**. Buffalo herds here are
   * tight (mean 12–15 adults within 6 units at t3000, 96–100% of adults clearing
   * the old threshold), but at the moment a lion's attempt actually lands, the
   * buffalo under it had `social.adults` of **0 or 1** in most cases. The threshold
   * was therefore being evaluated at precisely the instant it could not be met, and
   * it was blocking the animal from even *standing its ground*.
   *
   * ⚠ 1 is still collective — a pair, not a lone animal — so the principle in the
   * paragraph above is intact rather than abandoned. What changed is the
   * recognition that "the herd is nearby" and "the herd is nearby *when the lion
   * arrives*" are different claims, and only the second one gates a mob.
   */
  minMobbers: 1,
  /**
   * How close the animal under attack must be to be worth going to.
   *
   * ⚠ 6 → 9 on 2026-08-09 (A100). Measured: it is worth ~3 points of mobbing rate
   * on its own, and **9 → 12 is worth exactly nothing** — the same 20%, the same
   * counts — so this is the saturation point rather than a knob to keep turning.
   * Past 9 the binding constraint is the mobber's own `behavior.defendRange`, which
   * is in turn bounded by its perception radius.
   */
  range: 9,
});

/**
 * The groupmate this animal should turn and face, or null.
 *
 * Three questions in cheapening order, so the common case (no predator in sight,
 * or a species that does not mob) leaves after one comparison:
 *
 *   1. does this species mob at all, and is a threat actually perceived?
 *   2. is there a mob to be part of (`minMobbers` adults nearby)?
 *   3. is the threat *committed* to somebody — and is that somebody a groupmate
 *      of mine, close enough to reach?
 *
 * ⚠ Step 3 is what keeps mobbing from being a standing posture: the hunter must
 * already have chosen its target (`huntTargetId`, written by the decision system
 * when it commits to `stalk` or `chase`), so a mob forms in response to a hunt
 * and dissolves when the hunt does. A predator merely walking past a herd is
 * ignored, which is both true to life and the reason this can never compete with
 * grazing.
 *
 * ⚠ It reads the hunter's `huntTargetId` off the live entity, which is knowledge
 * the mobber's senses do not strictly have. It is the cheapest honest expression
 * of "the lion is going for that one" — a hunter closing on prey is the most
 * legible thing in this world — and it costs one O(1) lookup on the rare tick an
 * adult of a mobbing species has a predator in view.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity the potential mobber
 * @param {{id: number, distance: number}|null} threat its perceived nearest threat
 * @param {{mobWeight?: number, defendRange: number}} behavior resolved species block
 * @param {object} mobbing resolved world-level parameters
 * @param {{adults?: number}|null} social this animal's social summary
 * @returns {object|null} the animal to stand over — a herdmate, or **itself**
 */
export function mobWardFor(world, entity, threat, behavior, mobbing, social) {
  if (!mobbing.enabled || !((behavior.mobWeight ?? 0) > 0) || threat === null) return null;
  // Juveniles never mob, for the same reason they never interpose: a half-grown
  // animal facing a predator is not brave, it is prey.
  if (entity.lifeStage !== 'adult' && entity.lifeStage !== 'senescent') return null;
  if (threat.distance > behavior.defendRange) return null;
  if ((social?.adults ?? 0) < mobbing.minMobbers) return null;

  const hunter = world.entities.get(threat.id);
  const targetId = hunter?.huntTargetId ?? null;
  if (targetId === null) return null;
  // ⚠ Itself, when it is the one being hunted: standing its ground is what keeps
  // the hunt inside the herd (see the header — with the target fleeing instead,
  // no attempt in 12 000 tick-seeds was ever resolved against a mob).
  if (targetId === entity.id) return entity;
  const ward = world.entities.get(targetId);
  if (!ward || ward.kind !== 'animal' || !ward.alive) return null;
  if (ward.speciesId !== entity.speciesId) return null;
  return Math.hypot(ward.x - entity.x, ward.y - entity.y) <= mobbing.range ? ward : null;
}

/**
 * The animals actively standing over this prey, other than an interposing
 * parent — the mob, as the hunting system sees it.
 *
 * ⚠ **`defendingId` is the whole signal**, and it is already written, already
 * serialized, and already projected to entity inspection. A mob needs no state of
 * its own: it is however many animals happen to have chosen to defend the same
 * one this tick, which is exactly what a mob is.
 *
 * Costs nothing for a prey species that does not mob — the caller checks the
 * weight first — and one radius query on the rare tick a capture attempt lands on
 * one that does.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} prey @param {object|null} guardian the interposing parent, counted separately
 * @param {object} mobbing resolved world-level parameters
 * @returns {object[]} defenders, in ascending id order
 */
export function mobbersFor(world, prey, guardian, mobbing) {
  if (!mobbing.enabled) return EMPTY_MOB;
  let mobbers = null;
  for (const otherId of world.grid.queryRadius(prey.x, prey.y, mobbing.range)) {
    if (otherId === prey.id || otherId === guardian?.id) continue;
    const other = world.entities.get(otherId);
    if (!other || other.kind !== 'animal' || !other.alive) continue;
    if (other.defendingId !== prey.id) continue;
    (mobbers ??= []).push(other);
  }
  return mobbers ?? EMPTY_MOB;
}

/** One shared empty result, so the overwhelmingly common answer allocates nothing. */
const EMPTY_MOB = Object.freeze([]);
