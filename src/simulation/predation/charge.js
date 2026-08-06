/**
 * The charge, and the pursuit after it (BEHAVIOR-PLAN.md P9) — what happens when
 * standing your ground is not enough.
 *
 * Read `predation/mobbing.js` first: this is the same behaviour seen a step later.
 * Mobbing made `defend` collective — several adults facing a hunter that has
 * committed to one of them — but it is entirely **reactive and instantaneous**. It
 * exists only while a perceived predator is *committed to a groupmate*, and it
 * evaporates on the tick that stops being true. So the herd turns, the lion thinks
 * better of it and drops its quarry, and every buffalo in the mob goes back to
 * grazing on the same tick. Nothing drives the predator off; it simply stops being
 * mobbed.
 *
 * Two things are added here, and they are two halves of one behaviour:
 *
 *   1. **The charge.** While an animal is defending, its intent **sprints** instead
 *      of walking. `defend`'s comment has read "at a walk: this is interposing, not
 *      charging" since Step 23, and for an interposing parent that is exactly right.
 *      For a 600 kg animal going to a herdmate's aid it is not: arriving sooner is
 *      the whole of what its mass is worth, because every mechanical effect of
 *      defending is **positional** — `shielding` in `captureChance` and the
 *      `defenderInjuryBonus` in `trampleChance` both count who is standing there
 *      *when the attempt resolves*.
 *   2. **The pursuit.** A commitment that keeps `defend` scoring for a bounded spell
 *      after the ward is gone, steering at the position the threat was last seen —
 *      so the herd follows the predator off rather than stopping the instant it
 *      breaks contact.
 *
 * ⚠⚠ **The commitment has to live in the *utility*, and a ttl on the intent is the
 * trap.** `#intentFor` is called fresh from the winning action every tick, and only
 * the `wander` branch reads a prior `moveIntent.ttl` as a continuation. So a
 * `defend` intent with `ttl: 30` is not a thirty-tick commitment to anything: the
 * moment `defendUrgency` goes to 0 another action wins and overwrites the intent on
 * the very next tick. What persists is `entity.defendUntil` plus the remembered
 * position, which are read by the *scoring*.
 *
 * ## The two guards, and why they are structural rather than tuned
 *
 * ⚠⚠ **A pursuit must never suppress fleeing, and `defendWeight` (2.6) and
 * `mobWeight` (2.4) both outrank `fleeWeight` (2.0).** A commitment that simply held
 * `defend` open for N ticks would therefore hold it open **against a second
 * predator** — the animal would walk after the lion it drove off while another one
 * took it from behind. The rule that removes the question rather than tuning it:
 * **any perceived threat cancels the pursuit outright.** A pursuit is by definition
 * about something you can no longer see; the instant you can see a predator again,
 * the ordinary machinery decides, and it decides with the *current* geometry. So
 * "does flee still win against a second threat" is not a comparison between two
 * weights, it is the absence of a competitor.
 *
 * ⚠ **And N is bounded by the world, not by the species.** `config.charge`'s
 * `maxPursuitTicks` clamps whatever a species file declares, for the same reason the
 * switch is world-level: a bound a species can raise is not a bound.
 *
 * ⚠ **The sprint is gated on stamina, and the animal that pays for it is the one
 * sprinting.** `captureChance` reads the *prey's* stamina — `staminaEdge` is the
 * difference in how fresh the two animals are — so an animal that spends its sprint
 * budget charging is measurably easier to catch afterwards, and it has none left for
 * the flee it may need next. `config.charge.staminaFraction` is the reserve it
 * refuses to spend: below it a defender still defends, at a walk, exactly as it did
 * before this phase.
 *
 * ⚠⚠ **An animal does not charge its own attacker**, and this exclusion is not
 * tidiness. Since phase 11 a mobbing species' *target* stands its ground and faces
 * the hunter (a fleeing target separates from its herd, and no attempt in 12 000
 * tick-seeds was ever resolved against a mob). Turning that stand into a sprint
 * would close the distance the predator has to cover **and** spend the stamina
 * `captureChance` is about to read — an own goal on both terms. A charge is going to
 * somebody else's aid; standing your ground is standing still.
 *
 * ⚠ **Inert until a species declares `behavior.chargeWeight`**, which is 0 in the
 * config and 0 for every shipped species but the **buffalo** — the animal mobbing
 * was built for and the only one with the mass to make arriving worth anything. At 0
 * no field is ever written, no commitment is ever formed, and the world is
 * byte-identical.
 *
 * Ownership: `DecisionSystem` writes `defendUntil` / `defendThreatX` /
 * `defendThreatY`; this module only says what a species asked for.
 */

/**
 * World-level charge parameters — the machinery, the off switch, and the bound.
 *
 * ⚠ In a global section rather than in `behavior` for the phase-8 reason a whole
 * file of these now shares: a species block beats the config, so an off switch
 * inside one cannot switch anything off. The weights (biology — how hard this
 * animal presses an attack home, and for how long) are per-species; the switch, the
 * stamina reserve and the hard ceiling on the duration are here.
 */
export const DEFAULT_CHARGE = Object.freeze({
  /** False ⇒ no sprint and no commitment, whatever a species declares: the control. */
  enabled: true,
  /**
   * The fraction of its maximum stamina an animal keeps back rather than spending
   * on a charge. Below it a defender still defends — it simply walks, which is
   * every defender's behaviour before this phase.
   *
   * ⚠ 0.4 against a `sprintStaminaCost` of 2.5 and a buffalo's `maxStamina` of 110:
   * a full buffalo can charge for ~26 ticks before it drops to the reserve, which is
   * long enough to cross `defendRange` several times over and short enough that it
   * cannot charge indefinitely. The reserve is what it has left for the flee that a
   * second predator would ask of it.
   */
  staminaFraction: 0.4,
  /**
   * ⚠⚠ **The hard ceiling on a pursuit, and it is world-level precisely so a
   * species cannot raise it.** `defend` outranks `flee` for the species that declare
   * it, so the duration of a commitment is a safety parameter rather than a
   * preference — see the header. 40 ticks is a bounded errand, not a campaign.
   */
  maxPursuitTicks: 40,
});

/**
 * How hard this species presses an attack home, or 0.
 *
 * ⚠ **0 is the identity and the whole mechanism's switch** — the `mobWeight`
 * pattern. A species that says nothing never sprints while defending, never forms a
 * commitment, and never has a field written.
 *
 * ⚠ It is *also* the utility a pursuit scores, and that dual role is deliberate:
 * "how hard I press this" is one fact, and giving it two numbers would let a species
 * charge hard and pursue feebly, which is not a distinction any animal here makes.
 *
 * ⚠⚠ **It has to clear the species' own `fleeWeight × 0.75`, and that is a finding
 * rather than a preference.** That product is `alarmFlee` — what an animal does when
 * it has been *told* about a predator it cannot see — and the two are direct
 * competitors **by construction**: `alarmFlee` fires exactly when no threat is
 * perceived, which is exactly the situation a pursuit exists for. Worse, every
 * pursuit begins moments after a predator was standing in the herd, so the whole
 * herd is inside `social.alarmTicks` when it starts. A weight below that product is
 * therefore not a safety margin, it is an **off switch**: the mechanism would form
 * commitments and never once act on one. Sized *below* the alarm it was silently
 * inert; the first version of this file shipped that way and the test caught it.
 *
 * ⚠ What that costs, stated rather than hidden: **a pursuing animal ignores a
 * second-hand alarm for the length of its commitment.** That is bounded to
 * `config.charge.maxPursuitTicks`, and it is consistent with what the species
 * already is — `mobWeight` 2.4 against `fleeWeight` 1.0 means a buffalo does not run
 * from a lion it can *see*, so running from one it has merely been told about, while
 * chasing a third off its calf, was never the coherent behaviour. A **perceived**
 * threat is a different matter and is handled structurally: it cancels the pursuit
 * outright, whatever the weights say.
 *
 * @param {{behavior?: {chargeWeight?: number}}} [species] a resolved species record
 * @returns {number}
 */
export function chargeWeightOf(species) {
  const weight = species?.behavior?.chargeWeight;
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * How long this species pursues a threat it can no longer see, clamped by the
 * world's ceiling.
 *
 * ⚠ **0 is legal and is its own arm**: charge in, do not follow. That is the
 * difference between a herd that drives a predator off and one that merely repels
 * it, and a species file can ask for either.
 *
 * @param {{behavior?: {pursuitTicks?: number}}} [species] a resolved species record
 * @param {number} maxPursuitTicks `config.charge.maxPursuitTicks`
 * @returns {number}
 */
export function pursuitTicksOf(species, maxPursuitTicks) {
  const ticks = species?.behavior?.pursuitTicks;
  const usable = typeof ticks === 'number' && Number.isFinite(ticks) && ticks > 0 ? ticks : 0;
  return Math.min(usable, Math.max(0, maxPursuitTicks));
}
