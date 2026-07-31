/**
 * Cover concealment (PLAN-SPECIES.md §3.12, phase 14) — being harder to see
 * because of the ground you are standing on.
 *
 * Until now cover was two things: it slowed movement, and it sheltered from the
 * weather. It did **not** hide anything, which is DOCS A18's complaint ("prey have
 * no spatial refuge from predators") and, from the other side, the reason a
 * leopard was indistinguishable from any other stalking predator. Sight was
 * binary: rock and thicket were opaque, everything else was plain air.
 *
 * ⚠⚠ **The change is that opacity turned out to be the end of a scale rather than
 * a fact of its own.** `TerrainGrid` now carries one concealment value per terrain
 * code — 0 for open ground, **0.55 for cover**, 1 for rock and thicket — and
 * `blocksSightAt` is derived from it as `>= 1`. So there is one table, the boolean
 * cannot drift from the scale, and the raycast keeps the boolean array it always
 * read. Grading sight cost `hasLineOfSight` nothing at all.
 *
 * **Two different questions, answered in two places, and confusing them is the
 * trap this module exists to prevent:**
 *
 *   - *Can I see **through** that cell?* — `world.blocksSightAt`, asked about the
 *     cells **between** two animals by the raycast. Low brush: yes, you can.
 *   - *Can I pick an animal out **in** that cell?* — `world.concealmentAt`, asked
 *     about the cell the target is standing **on**. Low brush: not from far away.
 *
 * They coincide only at 1, which is exactly why one table serves both.
 *
 * **What it does to perception.** A concealed animal is detected only inside a
 * *shortened* radius: at cover's 0.55 an observer picks it out at 45% of the range
 * it would spot the same animal in the open. That is the whole mechanism — one
 * multiply and one compare, applied at the same place line of sight is applied, so
 * it gates everything uniformly (prey, threats, mates, a guardian). An animal you
 * cannot see is not a threat to flee, not prey to stalk, and not a mate to walk
 * toward.
 *
 * ⚠⚠ **There is no "ambush" term anywhere, and that is the design.** The obvious
 * build is a per-species bonus — a leopard's capture chance multiplied when it
 * attacks from cover — and it would have been a second mechanism doing what this
 * one already does. The advantage falls out of *position*: the leopard declares
 * `habitat: { cover: 1.6, thicket: 1.25 }` and the gazelle declares
 * `{ ground: 1.15, cover: 0.8 }`, so the cat waits where it cannot be seen and the
 * prey grazes where it can. Nothing in the engine knows one is ambushing the other.
 * That is DOCS §9 Decision's standing rule — give existing machinery a reason
 * rather than adding a mechanism — and it is why this phase adds no action, no
 * event, and no term in `captureChance`.
 *
 * ⚠⚠ **The concealment a species actually gets is its own `crypsis`, and the
 * first design left that out — measured, it made the leopard *worse*.** The
 * obvious build is symmetric: cover hides whoever stands in it, and the asymmetry
 * comes from the two species wanting different ground. Built that way and measured
 * over 3 seeds × 4000 ticks, the leopard population went **27 → 19**. The reason is
 * plain in hindsight and invisible in advance: this mechanism helps the animal that
 * *hides* and hurts the animal that *searches*, and a leopard with a perception
 * radius of 12 is overwhelmingly a searcher. It lost more prey sightings to brush
 * than it gained ambushes from it, because its prey is in cover ~7% of the time
 * while it is only in a *useful* patch of cover far less often than that.
 *
 * So concealment is scaled by a per-species `crypsis`, which is the honest missing
 * fact rather than a fudge: **a motionless rosetted cat in brush is hidden; a herd
 * of wildebeest standing in the same brush is a herd of wildebeest.** This engine
 * has no notion of stillness or camouflage, and `crypsis` is that notion as one
 * number.
 *
 * ⚠ **It defaults to 0, so the mechanism is the exact identity for a species that
 * says nothing** (D16), and exactly one species declares it. That is what makes
 * phase 14 attributable to the leopard rather than a change to every animal in the
 * world at once — and it is why cover still does **not** shelter prey from
 * predators, so DOCS A18 stays open. Raising prey crypsis is a real change with a
 * real effect on every predator in the world, and it wants its own gated phase.
 *
 * ⚠ **Distinct from neonatal concealment** (§3.14, `parenting/hiding.js`), which
 * is a *total* exemption for a hiding calf on sheltering ground rather than a
 * range discount, and which is deliberately left alone here: A12's rule is that
 * two changes to juvenile survival never ship together, and the leopard is quite
 * enough for one phase. The systems name them `coverConcealment` and
 * `neonatalConcealment` so no reader has to work out which is which.
 *
 * The world-level off switch is `config.concealment.enabled`, in a global section
 * because there is no per-species half at all: how well brush hides a body is a
 * fact about the brush.
 */

/**
 * World-level concealment parameters — the off switch and the one scaling knob.
 * The per-terrain values are terrain data and live in `TerrainGrid`.
 */
export const DEFAULT_CONCEALMENT = Object.freeze({
  enabled: true,
  /**
   * How much of the terrain's concealment actually applies, 0–1. A dial on the
   * whole mechanism rather than on any one terrain: 0 is the phase-13 world and
   * 1 takes cover's 0.55 at face value. It exists because the terrain table is a
   * *physical* statement ("this is how much brush hides a body") and how far a
   * simulated animal's senses fall off is a tuning question layered on top of it.
   */
  strength: 1,
  /**
   * ⚠ **The second half, on its own switch.** `enabled` is the *detection* half;
   * this is the *approach* half — an ambush predator stepping through cover on its
   * way to prey. Phase 11's lesson (two mechanisms shipped together confound each
   * other) applied in advance, and it earned its keep immediately: the two arms
   * are what showed the detection half alone leaving the leopard *worse* off.
   */
  approach: true,
});

/**
 * The distance at which an observer with `radius` sight can still pick out an
 * animal standing on ground of the given concealment.
 *
 * ⚠ Returns `radius` **exactly** for open ground, so an animal in the open is
 * detected at precisely the range it always was — the identity, rather than
 * approximately it (D16).
 *
 * @param {number} radius the observer's perception radius
 * @param {number} concealment 0–1, from `world.concealmentAt`
 * @param {number} strength `config.concealment.strength`
 * @returns {number}
 */
export function visibleRange(radius, concealment, strength) {
  if (concealment <= 0) return radius;
  const hidden = concealment * strength;
  return hidden >= 1 ? 0 : radius * (1 - hidden);
}

/**
 * How well members of a species use cover, 0 (a conspicuous herd) to 1 (a cat
 * that vanishes into a bush). Multiplies the terrain's concealment.
 *
 * ⚠ **0 for a species that says nothing, which is the exact identity**: no cell is
 * read and no range is discounted, so seven of the eight shipped species are
 * untouched by this whole mechanism and the phase is attributable to the one that
 * declares it.
 *
 * @param {{crypsis?: number}} [species] resolved species record
 * @returns {number}
 */
export function crypsisOf(species) {
  const crypsis = species?.crypsis;
  return typeof crypsis === 'number' && crypsis > 0 ? crypsis : 0;
}

/**
 * Every species in a world that is cryptic at all, keyed by id.
 *
 * Built **once per world** and checked for emptiness before the neighbour loop —
 * the same early-out `associationsIn` and `GroupSystem`'s forming-species set use,
 * and for the same reason: a mechanism nobody declares should cost one `size`
 * comparison, not a lookup per neighbour per tick.
 *
 * @param {{all: () => object[]}} [registry]
 * @returns {Map<string, number>}
 */
export function crypticSpeciesIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const crypsis = crypsisOf(species);
    if (crypsis > 0) byId.set(species.id, crypsis);
  }
  return byId;
}

/**
 * Whether this species hunts from cover — declared, not inferred, and declared
 * through a field it already had: a species that weights cover **above 1** in its
 * `habitat` block is one that wants to be in it.
 *
 * ⚠ No new field, because there is nothing a new one could say that this does not.
 * The leopard is the only species in the roster above 1 (1.6); every other animal
 * is at or below neutral, so this is exactly one species' behaviour and the rest
 * of the world takes the untouched branch on one comparison.
 *
 * @param {{habitat?: Record<string, number>}} [species] resolved species record
 * @returns {boolean}
 */
export function stalksFromCover(species) {
  return (species?.habitat?.cover ?? 1) > 1;
}

/**
 * The heading a stalking ambush predator should take toward its prey — the
 * concealed approach.
 *
 * ⚠⚠ **This is the half that makes the range discount worth having, and it was
 * added because the discount alone measured near-inert.** A leopard that walks
 * openly at a gazelle is seen at the gazelle's full 6 units and the gazelle bolts;
 * the discount only ever paid off when the cat happened *already* to be standing in
 * brush, which measured at 9% of its hunt-starts — and the habitat cue, being a
 * weak bias on an aimless wander, did not move that (10.9% of its time on cover
 * with the cue on against 10.7% with it off; the occupancy is mostly cover being
 * *slow* rather than chosen). A mechanism that correct and that rarely load-bearing
 * is A34's shape, and A34's own lesson is the fix: **give it a reason**. The reason
 * is a prey animal it has not been seen by yet.
 *
 * So a stalk is no longer a straight line. It samples the step it is about to take
 * across a fan of headings around the bearing to the prey, and prefers the one that
 * puts it on concealing ground — bounded to a half-turn either side, so the cat
 * always closes rather than circling. When no sampled step is any better hidden
 * than going straight, it goes straight and this costs a few grid reads.
 *
 * ⚠ **It is still not a new action.** `stalk` already existed and already walked
 * toward the prey; this changes *which way* it steps, exactly as `escapeHeading`
 * changes which way a fleeing animal runs without being a new action either.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity the stalker
 * @param {number} bearing radians toward the prey
 * @param {number} step how far it will move this tick
 * @returns {number} the heading to take
 */
export function concealedApproach(world, entity, bearing, step) {
  // The straight line is the incumbent: it wins every tie, so open ground and a
  // world with the mechanism off both behave exactly as they did.
  let bestHeading = bearing;
  let best = world.concealmentAt(entity.x + Math.cos(bearing) * step, entity.y + Math.sin(bearing) * step);
  for (const offset of APPROACH_FAN) {
    const heading = bearing + offset;
    const concealment = world.concealmentAt(entity.x + Math.cos(heading) * step, entity.y + Math.sin(heading) * step);
    // ⚠ Strictly greater, and the fan is walked in a fixed order, so the choice is
    // deterministic and the nearest-to-straight option wins a tie — this consumes
    // no randomness at all, like every heading rule in this system.
    if (concealment > best) {
      best = concealment;
      bestHeading = heading;
    }
  }
  return bestHeading;
}

/**
 * Offsets from the bearing to the prey, in radians, nearest-first so a tie goes
 * to the most direct approach. Bounded at ±60°: wider and a stalker sidles along
 * a cover edge without ever closing, which is a cat that never eats.
 */
const APPROACH_FAN = Object.freeze([
  Math.PI / 8, -Math.PI / 8,
  Math.PI / 4, -Math.PI / 4,
  Math.PI / 3, -Math.PI / 3,
]);
