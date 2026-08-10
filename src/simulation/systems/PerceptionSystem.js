/**
 * Local perception (Step 7).
 *
 * Each tick, every living animal builds a bounded summary of what it can sense
 * within its species' perception radius: nearby animals (via the spatial
 * index), its parent if it still depends on one (Step 13), the nearest animal
 * it hunts and the nearest one that hunts it (Step 16), a bounded set of
 * possible mates (Step 22), and the nearest food cell, water cell, and obstacle
 * (via a local scan of the cell neighborhood). Perception is strictly local — an animal never reads global
 * world state (invariant 17): neighbors come from `SpatialGrid.queryRadius`,
 * and cell features from a radius-bounded scan.
 *
 * The summaries live in `world.perception` (a transient Map keyed by entity
 * id, rebuilt every tick, never serialized). Nothing acts on perception yet —
 * the decision system (Step 8) consumes it; for now it is inspection-only.
 *
 * Ownership: writes `world.perception`; reads the spatial grid, terrain, and
 * vegetation. No randomness.
 *
 * ⚠ **The `radius` in each summary is the radius this animal actually senses at**,
 * not the species' declared one — from phase F1 a flying animal's is wider.
 *
 * ⚠⚠ **The neighbour walk is a separate, never-smaller radius** (BEHAVIOR-PLAN
 * P0), and the two must not be confused. `world.neighbourhood` is the shared walk
 * the social and group systems reuse instead of touching the grid again (§1.4 C6),
 * and those systems have their own radii — a herd wider than its members' eyes, an
 * alarm, a join range. So the query runs at `max(perception, herd, joinRadius,
 * alarmRadius)` and **everything perception itself reports is gated back down to
 * `radius`**: what it can see is unchanged, only who it hands on is wider. The
 * width is published in `world.neighbourhoodRadius`, which is what the reuse
 * checks compare against — a *longer* list is safe (everything past a consumer's
 * own radius fails its distance gate), a shorter one silently drops neighbours.
 *
 * ⚠ **Which is why every consumer of the raw list must gate by distance.** Three
 * do: `SocialSystem`, `GroupSystem`, and `adoptedPrey`. Before P0 the query radius
 * *was* that gate for all of them, which is a thing that stops being true the
 * moment the list is wider than the senses that filled it.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { TerrainType, isPassableCode, SHELTERING_BY_CODE } from '../world/TerrainGrid.js';
import { groupBackingFor, isReachablePrey, maxPreyMassFor, minPreyMassFor, threatens } from '../predation/predation.js';
import { isConcealed } from '../parenting/hiding.js';
import { DEFAULT_CONCEALMENT, crypticSpeciesIn, visibleRange } from '../perception/concealment.js';
import { carrionRadiiIn } from '../perception/carrion.js';
import { flightVisionMultiplier } from '../locomotion/flight.js';
import { herdRadiiIn } from '../social/herding.js';

export class PerceptionSystem extends SimulationSystem {
  /**
   * The species registry the cryptic-species map was built from, so it is rebuilt
   * rather than describing the wrong roster if one instance is reused across
   * worlds. Same guard as `SocialSystem`'s association map and `GroupSystem`'s
   * forming set.
   * @type {object|null}
   */
  #crypticFrom = null;
  /** @type {Map<string, number>} */
  #cryptic = new Map();
  /**
   * Per-species herd radii (BEHAVIOR-PLAN P1), cached against the same registry
   * and for the same reason. Empty for a roster where nobody declares one, and
   * then the neighbour walk is exactly the walk it always was.
   * @type {Map<string, number>}
   */
  #herdRadii = new Map();
  /**
   * Per-species carrion radii (**A102**, 2026-08-10), cached against the same
   * registry and for the same reason. Empty for a roster where nobody declares
   * one, and then the carcass branch is exactly the branch it always was.
   * @type {Map<string, number>}
   */
  #carrionRadii = new Map();

  /**
   * @param {object} [options]
   * @param {number} [options.defaultRadius] radius for species without one
   * @param {number} [options.foodMinLevel] vegetation level that counts as food
   * @param {number} [options.minNeighbourRadius] floor on the *neighbour* walk, so
   *        consumers whose own radius is world-level (the alarm, the join range)
   *        are served out of the shared walk rather than starting a second one
   * @param {number} [options.updateInterval]
   */
  constructor({
    defaultRadius = 5,
    foodMinLevel = 1,
    maxMateCandidates = 6,
    lineOfSight = true,
    neonatalConcealment = true,
    // ⚠ Zero by default, which makes a bare `new PerceptionSystem(config.perception)`
    // walk exactly the radius it always did. The composition root raises it to the
    // largest world-level radius any consumer of the shared walk uses; see
    // `createDemoSimulation`. It is a *floor*, never a cap: a species that senses
    // further still walks its own radius.
    minNeighbourRadius = 0,
    // ⚠⚠ **The same switch `SocialSystem` reads, and it is wired to both on
    // purpose.** The first cut gated only the consumer, on the argument that a
    // wider list is transient and distance-gated and therefore cannot change an
    // outcome. True, and not enough: the off arm was then a *behavioural* control
    // that still paid for the mechanism, so it could not answer "what did this
    // cost". It costs 21% of a demo tick (measured 2026-08-05), which is exactly
    // the size of question a control arm has to be able to settle.
    perSpeciesRadius = true,
    // Cover concealment (phase 14, PLAN-SPECIES.md §3.12). ⚠ Wired from the global
    // `config.concealment` — a different mechanism from the neonatal one above,
    // and the two are kept apart by name because they answer different questions:
    // that one is "is this calf hidden", this one is "how far away can this animal
    // be picked out of the brush". `enabled: false` restores the phase-13 world.
    coverConcealment = DEFAULT_CONCEALMENT.enabled,
    coverConcealmentStrength = DEFAULT_CONCEALMENT.strength,
    updateInterval = 1,
  } = {}) {
    super({ id: 'perception', phase: 'perception', priority: 0, updateInterval });
    this.defaultRadius = defaultRadius;
    this.foodMinLevel = foodMinLevel;
    this.maxMateCandidates = maxMateCandidates;
    // Whether an opaque obstacle (rock today, more later) hides the animals
    // behind it. Applied to *animals and carcasses*, not the cell-feature scan:
    // concealment is about who can see whom, and the cell scan is the engine's
    // hottest loop (§1.4 C6). Off restores sight through everything.
    this.lineOfSight = lineOfSight;
    // Neonatal concealment (PLAN-SPECIES.md §3.14): whether a hidden calf lying on
    // sheltering ground is invisible to a hunter. ⚠ The world-level control for
    // the whole stage, from `config.parenting.concealment` — *not*
    // `aging.hiddenUntil: 0`, which a species overrides (DOCS §8). Off skips the
    // test entirely, so the neighbour loop is exactly what it was.
    this.neonatalConcealment = neonatalConcealment;
    this.coverConcealment = coverConcealment;
    this.coverConcealmentStrength = coverConcealmentStrength;
    this.minNeighbourRadius = minNeighbourRadius;
    this.perSpeciesRadius = perSpeciesRadius;
  }

  update(world, context) {
    const perception = world.perception;
    // Cover concealment (§3.12): which species are cryptic at all, resolved once
    // per world. Empty for a roster that declares none, and then the neighbour
    // loop below is exactly the loop it was.
    //
    // ⚠ The herd radii ride the same guard and the same registry check, so a
    // system instance reused across worlds rebuilds both together — and the same
    // switch `SocialSystem` reads gates them here too, so that turning the
    // mechanism off stops paying for the wider walk as well as ignoring it.
    if (this.#crypticFrom !== world.species) {
      this.#crypticFrom = world.species;
      this.#cryptic = this.coverConcealment ? crypticSpeciesIn(world.species) : new Map();
      this.#herdRadii = this.perSpeciesRadius ? herdRadiiIn(world.species) : new Map();
      // ⚠ Deliberately **not** gated on `perSpeciesRadius`, which is the herd
      // mechanism's switch. A scavenger's nose is its own mechanism with its own
      // off state (declare no `carrionRadius`), and hanging it on somebody else's
      // switch is how two things become impossible to measure apart.
      this.#carrionRadii = carrionRadiiIn(world.species);
    }
    perception.clear();
    world.neighbourhood.clear();
    world.neighbourhoodRadius.clear();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      // The whole resolved `perception` block is handed down, rather than the
      // radius alone: until 2026-07-28 `foodMinLevel` was declared in
      // `config.perception` — already a species block — but read from the
      // constructor, so a species could never actually differ in what counts as
      // food. Harmless while every species used 1; load-bearing the moment a
      // grazer wants short regrowth and a browser wants standing growth.
      //
      // ⚠⚠ **Pass one object, not the fields — `#perceive` is arity-sensitive.**
      // The obvious version of this change resolved `radius` and `foodMinLevel`
      // here and passed both, making `#perceive` a four-argument function. That
      // cost **12% of total engine time** at large-5k (66.1 → 70.7 ms/tick,
      // 2026-07-28), and an A/B pinned it on the arity alone: keeping the extra
      // parameter but passing `this.foodMinLevel` into it was just as slow
      // (70.4), while dropping back to three arguments was 62.8. This is the
      // hottest function in the engine — ~53% of a tick, and it holds the
      // (2r+1)² cell scan — so one more parameter is enough to change what the
      // optimiser will do with it.
      //
      // ⚠ It is the whole **species record** rather than its `perception` block,
      // and the difference is deliberate: prey eligibility (phase 4) needs the
      // `predation` block in the same call, and handing over a second block
      // would have re-sprung exactly the arity trap above. One object in, both
      // blocks read inside, arity still three.
      perception.set(entity.id, this.#perceive(world, entity, world.species.get(entity.speciesId)));
    }
    // Stamped last, so a consumer that reads a half-built map on some future
    // reordering sees a stale tick rather than a partial neighbourhood.
    world.neighbourhoodTick = context?.tick ?? null;
  }

  /**
   * @param {import('../world/World.js').World} world
   * @param {object} entity
   * @param {object | null | undefined} species the resolved species record; the
   *        `perception` and `predation` blocks are read off it here rather than
   *        passed separately, to keep the arity at three (see `update`)
   */
  #perceive(world, entity, species) {
    const sensing = species?.perception;
    // ⚠⚠ **Flight widens the radius, and it is resolved *here*, inside, from the
    // `entity` and the `species` already in hand** (phase F1). D28 is the whole
    // reason: one extra *argument* to this function cost 12% of total engine time
    // at large-5k, so a flight-widened radius may not arrive as a parameter and
    // may not be handed down as a second block. It is one property read on
    // `entity` and, on the rare true case, one on `species`.
    //
    // ⚠ **This is the performance risk of the whole plan.** The cell scan below
    // is (2r+1)², so widening a radius is quadratic in the widening — a radius of
    // 14 taken to 22 is ~2.5× the hottest loop in the engine. The mitigation is
    // to **move the number, not add one**: the flying species drops its ground
    // radius so that ground × multiplier lands on the radius it used to have, and
    // the world's maximum radius does not move at all (see the vulture, phase F2).
    //
    // ⚠ Perception runs *before* decision, so this reads a flag written last
    // tick. A one-tick lag on the sight radius, harmless and deliberate — see
    // `locomotion/flight.js`.
    const ground = sensing?.radius ?? this.defaultRadius;
    const radius = entity.flying === true ? ground * flightVisionMultiplier(species) : ground;
    // ⚠⚠ **The neighbour walk, which is a different number from `radius`**
    // (BEHAVIOR-PLAN P0). Resolved *here*, inside, from the `species` already in
    // hand and one `Map.get` per animal — never as a parameter, for D28's reason:
    // one extra argument to this function cost 12% of total engine time at
    // large-5k. It is the same trick the flight multiplier plays on the line
    // above. `size === 0` is the whole cost for a roster that declares no herd
    // radius, which is every roster before P1.
    //
    // ⚠ It widens `grid.queryRadius` — a bounding-box cell walk — and **not** the
    // (2r+1)² cell scan below, which stays on `radius`. That is the whole point:
    // the quadratic loop is untouched, and the linear one grows only for a species
    // that asked for it.
    const herd = this.#herdRadii.size === 0 ? 0 : (this.#herdRadii.get(entity.speciesId) ?? 0);
    // ⚠⚠ **A scavenger's nose reaches further than its eyes** (A102). Resolved
    // exactly as `herd` is, one `Map.get` per animal behind a `size` check, and it
    // widens the same linear walk — the quadratic cell scan below stays on
    // `radius`. `carrion > radius` is also the flag for "this animal smells rather
    // than sees a body", which is what drops the line-of-sight test on the carcass
    // branch: smell goes around a rock. See `perception/carrion.js`.
    const carrion = this.#carrionRadii.size === 0 ? radius : (this.#carrionRadii.get(entity.speciesId) ?? radius);
    const scentsCarrion = carrion > radius;
    const neighbourRadius = Math.max(radius, herd, carrion, this.minNeighbourRadius);
    const foodMinLevel = sensing?.foodMinLevel ?? this.foodMinLevel;
    const radiusSquared = radius * radius;
    const los = this.lineOfSight;
    // Hoisted out of the neighbour loop for the reason everything else here is:
    // two property loads per animal rather than two per neighbour, and D28's
    // warning that this function is where a per-neighbour cost shows up.
    const cryptic = this.coverConcealmentStrength > 0 && this.#cryptic.size > 0 ? this.#cryptic : null;
    const hideStrength = this.coverConcealmentStrength;
    // Prey eligibility (phase 4, PLAN-SPECIES.md §3.6). Resolved **once per
    // animal**, into two plain numbers, so the in-loop test below is a pair of
    // register compares rather than a call and two property loads. An absent
    // bound resolves to Infinity / 0, which every real mass passes — the
    // comparison still happens but can never change an answer, so a roster that
    // states no ratios behaves exactly as it did.
    const predation = species?.predation;
    // ⚠⚠ **The cooperative ceiling (A59, PREDATOR-PLAN P3) resolves right here**,
    // in the hoist that already existed, which is why it costs a property read
    // rather than the neighbour-loop change A59 priced it at. `bandmates` is a
    // number `SocialSystem` already publishes for every animal, and it is *last
    // tick's* — this phase runs before that one. See `predation/predation.js`.
    const maxPreyMass = maxPreyMassFor(entity, predation, groupBackingFor(entity, predation));
    const minPreyMass = minPreyMassFor(entity, predation);

    // --- Animals: sub-quadratic via the spatial grid (already radius-filtered).
    let animalCount = 0;
    let nearestAnimal = null;
    let guardian = null;
    let nearestPrey = null;
    let nearestThreat = null;
    let nearestCarcass = null;
    /** @type {Array<{id: number, distance: number, x: number, y: number, sex: string}>} */
    const mateCandidates = [];
    // The living animals seen on this walk, flat as [id, distance, …], handed to
    // the social system so it need not repeat the walk (§1.4 C6). Recorded in
    // grid order, which is ascending id.
    /** @type {number[]} */
    const neighbours = [];
    for (const otherId of world.grid.queryRadius(entity.x, entity.y, neighbourRadius)) {
      if (otherId === entity.id) continue;
      const other = world.entities.get(otherId);
      if (!other) continue;
      // Carcasses are what a carnivore actually eats (Step 16), so they are
      // sensed alongside the living.
      //
      // ⚠ **The `distance <= radius` test is new and is not an optimization**
      // (BEHAVIOR-PLAN P0): this branch never had a distance gate of its own,
      // because the query radius *was* the gate. Now that the query can reach
      // past the senses, an ungated carcass branch would silently extend every
      // scavenger's and cacher's nose. The rest of the reordering *is* free — all
      // four predicates are pure and the record is only built when every one of
      // them passes, so putting the register compares ahead of the raycast cannot
      // change which carcass wins.
      if (other.kind === 'carcass') {
        const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
        if (
          distance <= carrion &&
          other.edibleMass > 0 &&
          (nearestCarcass === null || distance < nearestCarcass.distance) &&
          (scentsCarrion || !los || hasLineOfSight(world, entity.x, entity.y, other.x, other.y))
        ) {
          const cell = world.cellOf(other.x, other.y);
          nearestCarcass = {
            id: otherId,
            distance,
            x: other.x,
            y: other.y,
            cellX: cell.cellX,
            cellY: cell.cellY,
            edibleMass: other.edibleMass,
          };
        }
        continue;
      }
      if (other.kind !== 'animal' || !other.alive) continue;
      const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
      // The neighbour list is the shared walk the social and group systems reuse
      // (§1.4 C6), so it stays the raw *neighbour-radius* set — unfiltered by
      // line of sight, because cohesion and a panic call are not strictly
      // line-of-sight (an alarm is a sound that carries around a rock), and
      // unfiltered by the perception radius, because a herd can be wider than the
      // eyes of the animals in it.
      neighbours.push(otherId, distance);
      // ⚠⚠ **Everything from here down is perception, and perception stops at
      // `radius`.** This one line is what separates "who is near me" from "what I
      // can sense", and before P0 there was nothing to separate because the query
      // radius did both jobs. It is deliberately *above* `animalCount`: that count
      // is what the inspector shows and what `perception.test.js` asserts, and it
      // has always meant animals this animal can perceive.
      if (distance > radius) continue;
      animalCount += 1;
      // An animal behind an opaque obstacle is not *seen*, so it is none of the
      // things below. This is what makes rock and thicket a hiding place from
      // predators and prey alike.
      if (los && !hasLineOfSight(world, entity.x, entity.y, other.x, other.y)) continue;
      // ⚠⚠ **Cover concealment** (phase 14, PLAN-SPECIES.md §3.12), and it belongs
      // on exactly this line: sight through a cell and being picked out *in* one
      // are different questions, but they gate the same thing — everything below
      // — so an animal hidden in brush is not prey, not a threat, not a mate, and
      // not a findable guardian. Uniform by construction rather than by four
      // remembered edits.
      //
      // The cost is one `concealmentAt` per neighbour that has line of sight, and
      // it early-outs on the first compare for open ground, which is where 80–90%
      // of this world's animals are standing. Measured at phase 14 (see
      // BENCHMARK.md) rather than assumed, because §3.12 warned this could be the
      // most expensive item in the plan per unit of realism — it was not, and the
      // reason is that the *raycast* was left alone.
      // ⚠ **Conspecifics are exempt, and leaving them in was measured wrong.**
      // Crypsis is camouflage against *other* species; an animal's own kind knows
      // its calls, its scent, and its habits. Mechanically it matters more than it
      // sounds: mate candidates and territorial rivals come through this same gate,
      // so a cryptic solitary species that hid from itself simply stopped breeding —
      // the leopard population fell 27 → 19 with detection on and this exemption
      // missing, which is the mechanism quietly sterilising the animal it was
      // built for.
      if (cryptic !== null && other.speciesId !== entity.speciesId) {
        const crypsis = cryptic.get(other.speciesId);
        if (
          crypsis !== undefined &&
          distance > visibleRange(radius, world.concealmentAt(other.x, other.y) * crypsis, hideStrength)
        ) {
          continue;
        }
      }
      if (nearestAnimal === null || distance < nearestAnimal.distance) {
        // speciesId lets behaviour distinguish conspecifics (e.g. mate seeking).
        nearestAnimal = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y };
      }
      // A dependent juvenile can only follow a parent it can actually sense
      // (Step 13) — the bond gives no magic knowledge of where the parent is.
      if (otherId === entity.guardianId) {
        guardian = { id: otherId, distance, x: other.x, y: other.y };
      }
      // Predation (Step 16), read from the species relation in both
      // directions in this one pass: what I hunt, and what hunts me.
      //
      // ⚠ The mass gate sits **after** `hunts()`, never inside it. That
      // predicate is the busiest in the engine — twice per neighbour per animal
      // per tick — and its linear `includes` was measured rather than assumed
      // (D24), so the species relation stays exactly as cheap as it was and the
      // extra comparisons only run on its rare true case.
      // ⚠ `isConcealed` sits last in this chain for the same reason the mass gate
      // sits after `hunts()`: it is the most expensive test (an age check, then a
      // terrain lookup) and it is only ever reached on the rare true case of a
      // hunter looking at eligible prey. A hidden fawn lying in cover is not
      // *seen*, so it is not prey — which is what finally makes cover a refuge
      // (A18) rather than only a speed modifier. One lying in the open is still
      // taken; concealment needs something to conceal it.
      // ⚠ `isReachablePrey` is the **elevation** half of eligibility (phase T2,
      // A67) and it sits on this branch rather than on the `continue` above,
      // which is the whole care taken over A63: a treed animal is still seen,
      // still a mate candidate, still a guardian — it is only out of reach. It
      // is a function call rather than the inline compare the masses get because
      // the *threat* branch below needs the identical test and two spellings of
      // one rule is D11's shape; it is reached only on the rare true case of the
      // species relation either way.
      if (
        world.species.hunts(entity.speciesId, other.speciesId) &&
        (nearestPrey === null || distance < nearestPrey.distance) &&
        other.bodyMass <= maxPreyMass &&
        other.bodyMass >= minPreyMass &&
        isReachablePrey(entity, other) &&
        !(this.neonatalConcealment && isConcealed(world, other, world.species.get(other.speciesId)))
      ) {
        // `fleeing` is visible to the hunter: prey that has bolted is running,
        // and a predator that keeps walking will never close the gap again.
        nearestPrey = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y, fleeing: other.action === 'flee' };
      }
      // The mirror of it, and the reason the gate belongs in perception rather
      // than in the hunt: an animal too big to be taken should not spend its
      // life fleeing from something that was never going to try. ⚠ The bounds
      // here belong to *whichever species is looking at me*, so unlike the prey
      // side they cannot be hoisted — hence a resolve per threatening neighbour,
      // paid only on the rare true case of the reverse relation.
      // ⚠⚠ **The cooperative ceiling applies here too, and leaving it out would be
      // a real defect rather than an omission** (PREDATOR-PLAN P3). If a clan can
      // commit to a wildebeest but the wildebeest cannot see the clan as one, it is
      // hunted by something it never flees from — the exact asymmetry this branch's
      // comment above exists to refuse, pointed the other way. The backing read is
      // the **threatening animal's**, not this one's.
      //
      // ⚠⚠ **`threatens` wraps the species lookup and the backing read so both stay
      // behind `hunts()`.** The first draft hoisted them onto a `const` above this
      // `if`, which made every neighbour of every animal pay two map lookups per
      // tick rather than only the rare true case — D28's cost, in the loop D28 is
      // about. Do not lift them back out for readability.
      if (
        world.species.hunts(other.speciesId, entity.speciesId) &&
        (nearestThreat === null || distance < nearestThreat.distance) &&
        threatens(world, other, entity)
      ) {
        nearestThreat = { id: otherId, distance, speciesId: other.speciesId, x: other.x, y: other.y };
      }
      // Mate choice (Step 22): sensing a possible mate is sensing, so the
      // candidate set is gathered here in the pass that is already running.
      // Whether any of them is *good enough* is not perception's business —
      // that is scored from traits and condition by mating/mateChoice.js, which
      // the decision and reproduction systems both call. Adults of the opposite
      // sex only; the list is trimmed to the nearest few below, so a crowded
      // cell cannot make this grow.
      if (
        other.speciesId === entity.speciesId &&
        other.lifeStage === 'adult' &&
        other.sex !== null &&
        entity.sex !== null &&
        other.sex !== entity.sex
      ) {
        mateCandidates.push({ id: otherId, distance, x: other.x, y: other.y, sex: other.sex });
      }
    }
    // Nearest first, ties by ascending id (grid queries already return ids in
    // ascending order, and sort is stable) — so the trim is deterministic.
    if (mateCandidates.length > this.maxMateCandidates) {
      mateCandidates.sort((a, b) => a.distance - b.distance);
      mateCandidates.length = this.maxMateCandidates;
    }
    world.neighbourhood.set(entity.id, neighbours);
    // ⚠ Published beside the list rather than in the summary below, which is
    // projected whole to entity inspection: putting it there would make an
    // internal scratch value a protocol change (invariant 11).
    world.neighbourhoodRadius.set(entity.id, neighbourRadius);

    // --- Cell features: a local scan of the radius neighborhood (bounded, not
    // global). Nearest food (vegetation ≥ threshold), water, and obstacle.
    //
    // This is the hottest loop in the engine (§1.4 C6): it runs (2r+1)² times
    // per animal per tick, so everything below is about making one cell cheap
    // rather than about visiting fewer of them. Four things earn their keep,
    // and none of them changes which cell wins:
    //
    //   * The row's x-span is computed from the circle instead of testing every
    //     cell in the bounding box — the corners are ~21% of a square and were
    //     visited only to be rejected. The exact `distSquared > radiusSquared`
    //     guard is *kept*, so a cell on the boundary is still decided by the
    //     same comparison as before rather than by the span arithmetic.
    //   * Terrain is read once per cell and passability derived from the code
    //     (see `isPassableCode`), rather than reading the cell a second time.
    //   * The "is this nearer than the best so far" test comes first, because it
    //     is a register compare, and the grid reads it guards are not. Both
    //     operands are pure, so the reordering is invisible.
    //   * The best-so-far is held in plain numbers and the four result objects
    //     are built once at the end, so a scan that improves its answer twenty
    //     times allocates nothing rather than twenty short-lived records. An
    //     unset best is `Infinity`, which fails `<` exactly as the old `null`
    //     check did.
    const { cellX, cellY } = world.cellOf(entity.x, entity.y);
    const r = Math.ceil(radius);
    const terrain = world.terrain;
    const vegetation = world.vegetation;
    const entityX = entity.x;
    const entityY = entity.y;
    let foodDist = Infinity;
    let foodX = 0;
    let foodY = 0;
    let foodLevel = 0;
    let waterDist = Infinity;
    let waterX = 0;
    let waterY = 0;
    let obstacleDist = Infinity;
    let obstacleX = 0;
    let obstacleY = 0;
    let coverDist = Infinity;
    let coverX = 0;
    let coverY = 0;
    for (let dy = -r; dy <= r; dy += 1) {
      const cy = cellY + dy;
      const ddy = cy + 0.5 - entityY;
      const remaining = radiusSquared - ddy * ddy;
      if (remaining < 0) continue; // whole row lies outside the circle
      // |ddx| ≤ √remaining ⇒ cx ∈ [entityX − √remaining − 0.5, entityX + √remaining − 0.5].
      // Widened by one cell each way so float rounding can never narrow the
      // span past a cell the exact guard would have accepted.
      const span = Math.sqrt(remaining);
      const minCx = Math.max(cellX - r, Math.floor(entityX - span - 1.5));
      const maxCx = Math.min(cellX + r, Math.ceil(entityX + span - 0.5) + 1);
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const ddx = cx + 0.5 - entityX;
        const distSquared = ddx * ddx + ddy * ddy;
        if (distSquared > radiusSquared) continue;

        if (distSquared < foodDist) {
          const level = vegetation.levelAt(cx, cy);
          if (level >= foodMinLevel) {
            foodDist = distSquared;
            foodX = cx;
            foodY = cy;
            foodLevel = level;
          }
        }
        const wantWater = distSquared < waterDist;
        const wantObstacle = distSquared < obstacleDist;
        // Shelter from the weather (Step 19) — the same scan, one more test.
        const wantCover = distSquared < coverDist;
        if (!wantWater && !wantObstacle && !wantCover) continue;
        const code = terrain.codeAt(cx, cy);
        if (wantWater && code === TerrainType.WATER) {
          waterDist = distSquared;
          waterX = cx;
          waterY = cy;
        }
        if (wantObstacle && !isPassableCode(code)) {
          obstacleDist = distSquared;
          obstacleX = cx;
          obstacleY = cy;
        }
        // ⚠⚠ **Anything `world.isShelteredAt` calls shelter, not COVER alone**
        // (2026-08-01). This slot is the *only* cue the `shelter` action has, and
        // it used to report COVER while the thing it feeds — `thermalStress` —
        // took its relief from COVER **or thicket or a burrow**. So two thirds of
        // the demo's sheltering ground (953 thicket cells against 615 of cover on
        // seed 1) was invisible to the animal standing next to it: measured,
        // 15.4% of all "cold and out in the open" animal-ticks had sheltering
        // ground inside the animal's own perception radius and were told there
        // was none. Classic D11 — one rule, two readers, and the readers
        // disagreed. `SHELTERING_BY_CODE` is now the one definition, and
        // `World.isShelteredAt` reads the same table.
        //
        // ⚠⚠ **Terrain only, and a burrow is a measured exclusion rather than an
        // oversight.** `isShelteredAt` counts burrows too, but they live on the
        // *feature* grid, and one `sheltersAt(features, cx, cy)` here cost **+56%
        // of a whole tick** at large-5k (130.6 → 203.2 ms). The
        // `featureCount === 0` early-out inside it saves nothing: any world with
        // **trails** has features, so the guard is true and the call runs for
        // essentially every cell of every scan of every animal. Measured
        // behavioural cost of leaving burrows out: **none** — the "shelter in
        // range but not reported" rate is 1.5% either way. This is the hottest
        // loop in the engine (§1.4 C6), and the rule it leaves behind is
        // explicit: **nothing in this scan may consult a second grid.**
        if (wantCover && SHELTERING_BY_CODE[code]) {
          coverDist = distSquared;
          coverX = cx;
          coverY = cy;
        }
      }
    }

    return {
      radius,
      animalCount,
      nearestAnimal,
      guardian,
      nearestPrey,
      nearestThreat,
      nearestCarcass,
      mateCandidates,
      nearestFood:
        foodDist === Infinity
          ? null
          : { cellX: foodX, cellY: foodY, level: foodLevel, distance: Math.sqrt(foodDist) },
      nearestWater: cellRecord(waterX, waterY, waterDist),
      nearestObstacle: cellRecord(obstacleX, obstacleY, obstacleDist),
      nearestShelter: cellRecord(coverX, coverY, coverDist),
    };
  }
}

/**
 * Whether nothing opaque stands between two continuous positions — the sight
 * test perception gates animals on. Walks the grid cells the segment crosses
 * (Amanatides–Woo voxel traversal) and asks `world.blocksSightAt` about each
 * one *between* the endpoints; the endpoints themselves are exempt, since an
 * animal standing next to a rock can still be seen. Cost is one grid step per
 * cell crossed — at most ~2r — so it scales with the perception radius, not the
 * map.
 *
 * @param {import('../world/World.js').World} world
 * @param {number} x0 @param {number} y0 viewer position
 * @param {number} x1 @param {number} y1 target position
 * @returns {boolean}
 */
export function hasLineOfSight(world, x0, y0, x1, y1) {
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const tx = Math.floor(x1);
  const ty = Math.floor(y1);
  if (cx === tx && cy === ty) return true; // same cell, nothing between

  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (stepX > 0 ? cx + 1 - x0 : x0 - cx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? cy + 1 - y0 : y0 - cy) * tDeltaY : Infinity;

  // Bounded by the cells the segment can cross, so a float edge case can never
  // spin: it fails open (visible) rather than looping.
  const maxSteps = Math.abs(tx - cx) + Math.abs(ty - cy) + 2;
  for (let step = 0; step < maxSteps; step += 1) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx === tx && cy === ty) return true; // reached the target unobstructed
    if (world.blocksSightAt(cx + 0.5, cy + 0.5)) return false;
  }
  return true;
}

/**
 * A public nearest-cell record, or null when the scan found nothing. Key order
 * matches what the old `{...rest, distance}` spread produced, since these
 * records are projected to entity inspection.
 */
function cellRecord(cellX, cellY, distSquared) {
  if (distSquared === Infinity) return null;
  return { cellX, cellY, distance: Math.sqrt(distSquared) };
}
