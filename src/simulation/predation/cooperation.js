/**
 * Cooperative hunting (PLAN-SPECIES.md §3.7, phase 10) — the mirror of
 * cooperative defense.
 *
 * `defendersFor` has counted the animals standing *with* a prey animal since
 * Step 23, and it shaves `captureChance` from the prey's side. Nothing has ever
 * counted the animals standing with the **hunter**, so a pride and a solitary cat
 * take a buffalo on identical odds and "lions hunt together" is not a thing this
 * world can express. This module is that missing half, built to the same shape:
 * one count, feeding the same product from the other side.
 *
 * **Two pieces, and they are separable on purpose.**
 *
 *   - `attackersFor` — how many others are committed to this quarry, which
 *     multiplies the capture odds (`cooperationBonus`).
 *   - `adoptedPrey` — a predator joining a hunt a conspecific has already
 *     started, which is what makes several hunters converge on *one* animal
 *     rather than each picking its own.
 *
 * Neither is a new action and neither is a new heading. A joining hunter uses
 * the `stalk`/`chase` it already had, aimed at somebody else's target; the bonus
 * lands on a term of a product that already exists. That is the phase-9 rule
 * generalized (§2c/§2d of the phase-9 handoff): a preference chooses a
 * direction, a need sets the strength, and nothing new competes in the utility
 * table.
 *
 * ⚠ **Inert until a species asks for it, and exactly the identity when it does
 * not.** `hunting.cooperationWeight` is 0 in the config, and 0 means *no
 * mechanism at all*: no bonus (`1 + 0 × n === 1`) and no adoption either, so a
 * roster that states nothing pays one property read and no traversal. That is
 * deliberate rather than timid, and it is what PLAN-SPECIES §9 demands: a
 * cooperative capture only pays when the prey is too large for one hunter, so it
 * is **built at phase 10 and proved at phase 11** against the lion and the 600 kg
 * buffalo that justify it. Tuning the weight against a 30 kg gazelle — which a
 * single hyena takes solo, as a real one does — would fit the parameter to a case
 * it was not built for and guarantee re-tuning it twice.
 *
 * ⚠ **The mass gate and this mechanism do not yet meet, and that is a stated
 * limit.** `predation.maxPreyMassRatio` gates what a hunter will commit to, and it
 * is resolved per animal in perception (§3.6) where it cannot know whether help is
 * at hand. So "prey no single hunter would take on, that a pride will" is *not*
 * expressible today: somebody has to start the hunt, so a cooperative species
 * needs a ceiling high enough to commit alone, and cooperation then supplies the
 * odds rather than the eligibility. Phase 11 is where that is tuned, and a second
 * cooperative ceiling is the named lever if it turns out to be needed.
 *
 * ⚠ **"Conspecific" tightens to "same group record" when the hunter has one.** A
 * clan or a pride hunting together is the version that reads as one, and the test
 * is the same one carcass possession already makes (`groupRecordId` off the live
 * animal, never a stored copy). A hunter in no group joins any conspecific's
 * hunt; a hunter in one joins only its own group's.
 *
 * Ownership: reads only. No draws, no writes, no new state — `huntTargetId`
 * already lives on the entity and the decision system already owns it.
 */

/**
 * World-level cooperation parameters — the machinery and the off switch.
 *
 * ⚠ **The switch is here and not in `config.hunting`**, which is a species block,
 * and a species block *beats* the config (DOCS §8): an `enabled: false` inside one
 * would leave a cooperating species' own weight standing and the "off" arm would
 * silently stay on. That is the trap phase 8 fell into with `aging.hiddenUntil`,
 * and it is now the rule for any per-species mechanism needing a reproducible
 * control — the biology goes in the species block, the switch goes in a global
 * section beside it.
 */
export const DEFAULT_COOPERATION = Object.freeze({
  enabled: true,
  /**
   * How close another hunter must be to the quarry to be in on the kill. A
   * capture happens inside `hunting.captureRange` (1.2), so this is "the animals
   * around the kill", not "the animals somewhere behind it".
   */
  range: 6,
  /**
   * How far a joining hunter will commit to a quarry it has not necessarily seen
   * itself.
   *
   * ⚠ **This is knowledge beyond perception and it is a stand-in rather than an
   * oversight**, the same shape as A42 (the forage cue reaching 18 units against a
   * perception radius of 6) and declared here for the same reason. An animal that
   * watches a clanmate break into a run knows roughly what it is running at, and
   * that is the whole content of "joining a hunt". The bound keeps it honest: the
   * quarry has to be within a plausible sighting of the joiner, not anywhere on
   * the map.
   */
  joinRange: 12,
  /**
   * ⚠⚠ **Whether a committed `stalk` is joinable, or only a `chase`**
   * (PREDATOR-PLAN P4). `adoptedPrey` below took chases only, on two stated
   * grounds: a stalk is not yet a hunt, and *a chase bounds the geometry for
   * free* — a chasing animal is within `chaseRange` of its quarry, so the quarry
   * is near the joiner too.
   *
   * The brief asks for the thing that is only possible once the first ground is
   * given up: **a pride that has converged on a quarry before any member has
   * broken into a run.** With chases only, "several lions on one buffalo" can
   * never precede the first lion's sprint, which is what "collectively decide to
   * attack before a member has entered `chase`" means.
   *
   * The *second* ground is real and is kept: `joinRange` (12) now carries the
   * geometry, plus the caller's own perception-radius gate. Both were already
   * there — the chase was doing the bounding a second time.
   *
   * ⚠ `false` is exactly the pre-P4 behaviour and is the reproducible control.
   */
  joinStalks: false,
});

/**
 * How many *other* hunters are committed to this quarry.
 *
 * ⚠ Costs nothing at all for a species that does not cooperate: the caller's
 * weight is checked first and the grid is never touched. When it does run, it is
 * one radius query around the prey — the spatial index, not a scan (invariant 17)
 * — on the rare tick a capture attempt actually happens.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} hunter the animal making the attempt
 * @param {object} prey its target
 * @param {object} cooperation resolved world-level parameters
 * @returns {number} co-attackers, uncapped (the cap is a species number)
 */
export function attackersFor(world, hunter, prey, cooperation) {
  if (!cooperation.enabled) return 0;
  let attackers = 0;
  for (const otherId of world.grid.queryRadius(prey.x, prey.y, cooperation.range)) {
    if (otherId === hunter.id) continue;
    const other = world.entities.get(otherId);
    if (!other || other.kind !== 'animal' || !other.alive) continue;
    if (other.huntTargetId !== prey.id) continue;
    if (!huntsTogether(hunter, other)) continue;
    attackers += 1;
  }
  return attackers;
}

/**
 * Whether these two animals count as hunting together — same species, and the
 * same group record when the first of them belongs to one.
 *
 * @param {object} hunter @param {object} other
 */
export function huntsTogether(hunter, other) {
  if (other.speciesId !== hunter.speciesId) return false;
  return hunter.groupRecordId === null || hunter.groupRecordId === other.groupRecordId;
}

/**
 * The capture-odds multiplier for a hunt `attackers` others have joined.
 *
 * The mirror of `shielding`, and deliberately the same shape: linear in the
 * count, capped so a crowd is not a certainty (the clamps in `captureChance` are
 * the second guard), and **exactly 1** at weight 0 or with nobody else on it —
 * the identity D16 asks of any "off costs nothing" claim.
 *
 * @param {number} attackers @param {{cooperationWeight?: number, maxAttackers?: number}} params
 *        the **hunter's** resolved `hunting` block
 * @returns {number}
 */
export function cooperationBonus(attackers, params) {
  const weight = params.cooperationWeight ?? 0;
  if (weight <= 0 || attackers <= 0) return 1;
  const counted = Math.min(attackers, params.maxAttackers ?? attackers);
  return 1 + weight * counted;
}

/**
 * Where this animal should walk while stalking a shared quarry — the quarry
 * itself, or a point fanned out around it when others are on the same animal
 * (PREDATOR-PLAN P4).
 *
 * ⚠⚠ **This is approach-from-distinct-bearings, and it is not encirclement.**
 * See `approachSpread` above for why a formation is not expressible here at all.
 * What is claimed, and what a test should measure, is the *angular separation of
 * co-stalkers around their quarry*.
 *
 * **The geometry.** Each co-stalker keeps its own side of the quarry and the group
 * fans apart from there: the bearing from the quarry to this animal is rotated by
 * `spread × (k − (n−1)/2) / (n−1)`, where `k` is this animal's rank among the
 * co-stalkers in ascending id and `n` is how many there are. So with three on one
 * buffalo the ranks take −spread/2, 0, +spread/2.
 *
 * ⚠ **Rank assigns an offset, never a destination**, which is the difference
 * between this and the obvious version. Handing each animal an absolute bearing
 * slot (`2πk/n`) would send whichever lion drew the far side walking the whole way
 * around a buffalo it was already next to. Rotating each animal's *own* bearing
 * keeps every one of them approaching from where it already is.
 *
 * ⚠ **Nothing is stored and nothing is per-pair** (invariant 17). The rank is
 * recomputed from ascending id every tick, so it is stable while the set is stable
 * and re-derived the moment a stalker joins or drops — no assignment to keep in
 * step with the world, and no state to get stuck in. It is the same judgement that
 * keeps possession held by presence and dominance derived on read.
 *
 * ⚠ **It lands on the action *target*, not on the heading and not on the utility
 * table.** Bending the heading would make a stalker circle rather than converge;
 * a new action would have to beat foraging, and this project has recorded four
 * times what happens then.
 *
 * ⚠ **Exactly the identity for a lone stalker**, at `approachSpread: 0`, and for a
 * species that does not cooperate — the caller gates on `cooperationWeight`, so
 * the grid is never touched for six of the eight species. `n <= 1` returns the
 * quarry object itself rather than a copy, so the common case allocates nothing.
 *
 * Cost: one radius query per *stalking* animal per tick, on top of the one
 * `attackersFor` makes at capture time. That is a rare true case — a hungry
 * cooperative predator that has actually chosen `stalk` — but it is genuinely new
 * work and is why the species gate is checked first.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity the stalker
 * @param {object} prey its quarry, in perception's `nearestPrey` shape
 * @param {object} cooperation resolved world-level parameters
 * @returns {object} `prey`, or a copy with `x`/`y` moved to the flank point
 */
export function approachPoint(world, entity, prey, cooperation) {
  if (!cooperation.enabled || !(cooperation.approachSpread > 0)) return prey;
  const quarry = world.entities.get(prey.id);
  if (!quarry) return prey;
  // ⚠ Ascending id, because `queryRadius` returns ids sorted — which is what makes
  // the rank deterministic without sorting anything here.
  let count = 0;
  let rank = -1;
  for (const otherId of world.grid.queryRadius(quarry.x, quarry.y, cooperation.range)) {
    const other = otherId === entity.id ? entity : world.entities.get(otherId);
    if (!other || other.kind !== 'animal' || !other.alive) continue;
    if (other.huntTargetId !== prey.id) continue;
    if (otherId !== entity.id && !huntsTogether(entity, other)) continue;
    if (otherId === entity.id) rank = count;
    count += 1;
  }
  // Alone on this quarry — or not counted at all, which happens on the tick before
  // `huntTargetId` is written. Either way there is nothing to fan out from.
  if (count <= 1 || rank < 0) return prey;
  const bearing = Math.atan2(entity.y - quarry.y, entity.x - quarry.x);
  const offset = (cooperation.approachSpread * (rank - (count - 1) / 2)) / (count - 1);
  const angle = bearing + offset;
  return {
    ...prey,
    x: quarry.x + cooperation.approachRadius * Math.cos(angle),
    y: quarry.y + cooperation.approachRadius * Math.sin(angle),
  };
}

/**
 * The quarry a conspecific is already chasing, for a predator that has found
 * none of its own — or null.
 *
 * Returned in the shape of perception's `nearestPrey` record, so the decision
 * system scores and steers at it through exactly the code path it already has
 * and no caller has to learn a second kind of target.
 *
 * ⚠⚠ **A committed `chase` is joinable, and since PREDATOR-PLAN P4 a `stalk` is
 * too when `cooperation.joinStalks` says so.** The original rule was chases only,
 * for two reasons: a stalk is not yet a hunt, and a chase bounds the geometry for
 * free — a chasing animal is within `chaseRange` of its quarry (or the quarry has
 * bolted and is in plain sight), so the quarry of a neighbour is near this animal
 * too rather than half a map away.
 *
 * The first reason is what P4 gives up on purpose, because the brief asks for
 * exactly what it forbids: a pride converging on a quarry **before** any member
 * has broken into a run. The second is kept, and is now carried by `joinRange`
 * and the caller's perception gate — which were always there, so the chase was
 * bounding the geometry a second time.
 *
 * ⚠ **Only when this animal has no prey of its own.** The conservative half of
 * the mechanism: joining can add a hunter to a hunt, never take one off a hunt it
 * could have won alone.
 *
 * @param {import('../world/World.js').World} world
 * @param {object} entity the predator looking for something to join
 * ⚠⚠ **The `radius` argument is a correctness gate, not a tuning knob**
 * (BEHAVIOR-PLAN P0). This function reads the shared neighbour walk and has never
 * tested how far away the *neighbour* is — only how far away its quarry is — for
 * the entirely good reason that the walk was the perception radius and a
 * neighbour on it was therefore one this animal could sense. Since the walk may
 * now reach past the senses, an ungated version would let a predator join a hunt
 * run by a pride-mate it cannot see. It is a no-op for the shipped roster (no
 * predator declares a herd radius) and it is added anyway, because the day one
 * does is not the day to discover this.
 *
 * @param {number[]} neighbours the flat `[id, distance, …]` walk perception published
 * @param {object} cooperation resolved world-level parameters
 * @param {number} [radius] how far this animal can actually sense; neighbours
 *        beyond it are on the shared list but not in this animal's world
 * @returns {{id: number, distance: number, speciesId: string, x: number, y: number, fleeing: boolean} | null}
 */
export function adoptedPrey(world, entity, neighbours, cooperation, radius = Infinity) {
  if (!cooperation.enabled || !neighbours) return null;
  let best = null;
  for (let i = 0; i < neighbours.length; i += 2) {
    if (neighbours[i + 1] > radius) continue;
    const other = world.entities.get(neighbours[i]);
    if (!other || other.kind !== 'animal' || !other.alive) continue;
    if (other.huntTargetId === null) continue;
    // ⚠ A stalk counts too when the world says so (P4) — see `joinStalks` above.
    if (other.action !== 'chase' && !(cooperation.joinStalks && other.action === 'stalk')) continue;
    if (!huntsTogether(entity, other)) continue;
    const quarry = world.entities.get(other.huntTargetId);
    if (!quarry || quarry.kind !== 'animal' || !quarry.alive) continue;
    const distance = Math.hypot(quarry.x - entity.x, quarry.y - entity.y);
    if (distance > cooperation.joinRange) continue;
    // The nearest joinable quarry wins; ties keep the first, and the neighbour
    // walk is in ascending id order, so the choice is deterministic.
    if (best !== null && distance >= best.distance) continue;
    best = {
      id: quarry.id,
      distance,
      speciesId: quarry.speciesId,
      x: quarry.x,
      y: quarry.y,
      fleeing: quarry.action === 'flee',
    };
  }
  return best;
}
