/**
 * Persistent social groups (PLAN-SPECIES.md §3.8) — founding, joining, leaving,
 * and dissolution of the records in `world.groups`.
 *
 * Read `world/GroupRegistry.js` first: it explains *why* a second sociality
 * mechanism exists beside the herd label, and what a record deliberately does
 * not hold. This file is the part that changes membership.
 *
 * ⚠ **It is inert unless a species asks for it, and that stopped being "always"
 * on 2026-07-29.** When this landed no shipped species declared
 * `groups.forms: true`, so the system built its species set once and returned
 * immediately, forever — the same shape `feeding`, `hunting`, `behavior`, and
 * `disease` each landed in: the mechanism arriving ahead of the roster that
 * needs it. ✅ **Three species declare it now** — the hyena (batch 1, the clan
 * this was built for), the lion (a pride) and the zebra (a band, and the first
 * *prey* animal on the registry). The early-out still carries every world whose
 * roster happens to contain none of them, but this system moves demo numbers
 * today and a change here is no longer free.
 *
 * **The rules, stated rather than left to be read out of the code.** All of them
 * are the cheapest honest first cut, and every simplification is named:
 *
 *   1. **Founding.** Two unattached conspecifics of a group-forming species
 *      within `joinRadius` found a group. The smaller id is recorded as the
 *      founder.
 *   2. **Joining.** An unattached animal that can see an existing group with
 *      room joins it in preference to founding a new one, smallest record id
 *      first — the same min-id rule herd labels merge by, and for the same
 *      reason: it makes the outcome symmetric, so two animals reach the same
 *      answer without negotiating. ⚠ There is **no admission test**. A pride
 *      does not really accept every passing lioness, but rank-structured
 *      admission is out of scope (§10.2), and without joining the store fills
 *      with two-member groups that never grow.
 *   3. **Inheritance.** A dependent juvenile takes its guardian's group and
 *      never joins by proximity. Since the guardian is the parent that gestated
 *      (DOCS §9 Reproduction), matrilineal descent falls out of that with no sex
 *      conditional anywhere — which is also what makes a female-cored group
 *      expressible later.
 *   4. **Leaving.** The one thing that happens to an existing member: the sex
 *      named by `leavingSex` leaves its natal group when it disperses. Nothing
 *      else removes a living member — ⚠ **membership survives separation**, and
 *      that is the entire point. Two animals fifty units apart are still in the
 *      same group; their herd *labels* diverged long ago.
 *
 *      ⚠⚠ **A disperser does not re-attach until its walk is over** (A64, fixed
 *      2026-07-31), and the two halves of that are deliberately *one* predicate.
 *      Dispersal is a **window**, not an instant, so a rule that only said
 *      "leave while dispersing" removed the animal on one tick and let the
 *      ordinary proximity join put it straight back on the next — it was still
 *      standing beside the family it had just walked out of, and nothing
 *      recorded that it had already gone. The result was a leave/join cycle
 *      every other tick for the whole window: **901 membership changes in 2430
 *      ticks** for one lion, against its own `dispersalTicks: 900`.
 *      `#dispersingOut` now gates **both** sides, so "you leave" and "you do
 *      not join yet" cannot drift apart.
 *   5. **Dissolution.** A record with fewer than `minMembers` living members is
 *      destroyed and its survivors released, which is what reclaims a group
 *      whose members have died. `minMembers: 2` mirrors the herd label's
 *      `minGroupSize` — a lone animal is not a group of one.
 *
 *      ⚠⚠ **Not immediately, as of BEHAVIOR-PLAN P5a (2026-08-05) — this is
 *      A56's named fix.** A pair that drifted apart used to dissolve on the tick
 *      it separated and re-found on the tick it met again: **157 foundings
 *      against 150 dissolutions in 3000 ticks** on one seed. The record's
 *      identity survived separation for exactly one tick, which is not what the
 *      whole mechanism claims to model. A short record now carries
 *      `belowMinSince` and is destroyed only if it is *still* short
 *      `dissolveGraceTicks` later. ⚠ At 0 that is the old behaviour to the tick,
 *      which is what makes it the reproducible control.
 *   6. **No merging.** Two groups meeting stay two groups. Labels merge on
 *      contact because a label *is* proximity; a persistent identity that
 *      dissolved into whichever clan it bumped into would not be persistent.
 *
 * ⚠ **Structural changes happen at one boundary.** Reconciliation walks a
 * snapshot of the record ids and only marks records for dissolution; the
 * dissolutions run after that walk. Founding and joining happen in the entity
 * pass, which iterates entities rather than records. So nothing here ever
 * mutates a collection it is iterating — invariant 13's rule, applied to records
 * rather than to entities.
 *
 * Ownership: writes `entity.groupRecordId`, `entity.rallyHeading` /
 * `entity.rallyStrength`, `world.groups` and `world.groupCentres`. Reads
 * positions, species, `guardianId`, `sex`, dispersal state, the shared
 * neighbourhood buffer, the social summary's `bandmates` count (P7), and — since
 * BEHAVIOR-PLAN P8 — each member's derived **leadership**, which weights the centre
 * a rally steers at (`config.groups.leadWeight`, `behavior.leadAgeWeight`). ⚠ That
 * last one is *read* and never stored: `GroupRegistry`'s rule that standing is
 * derived rather than recorded holds here too, so there is no leader anywhere in
 * state — only a weight recomputed from what each animal is right now.
 * ⚠ It never touches `groupId` or `groupHops` — those are `SocialSystem`'s, and
 * two systems must never write the same field.
 * Randomness: **none at all**, like migration and engineering, so this cannot
 * shift another system's stream even in principle.
 *
 * ✅ **`rallyHeading` / `rallyStrength` need no save-format guarantee, and the
 * invariant that makes that true is worth stating because it is easy to break.**
 * This system runs at priority −8 and `DecisionSystem` at 0, so within every tick
 * the fields are written before anything reads them; a species that forms no groups
 * never has them written at all and keeps `createEntity`'s null/zero for life. So a
 * restored save's values are irrelevant — they are overwritten or ignored before
 * they can matter. ⚠ **That breaks the moment anyone adds a reader at a priority
 * below −8**, or moves this system later in the phase.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { groupsOf } from '../world/GroupRegistry.js';
import { isDispersing } from '../migration/migration.js';
import { leadAgeWeightOf, leadershipOf } from '../social/dominance.js';
import { Sexes } from '../mating/mateChoice.js';

/** `leavingSex` values that are not a sex. */
const LEAVE_NOBODY = 'none';
const LEAVE_EVERYONE = 'both';

export class GroupSystem extends SimulationSystem {
  /**
   * The species registry the forming-species set was built from, so the set is
   * rebuilt if a system instance is ever reused across worlds rather than
   * silently describing the wrong roster.
   * @type {object|null}
   */
  #formingFrom = null;
  /** @type {Set<string>} */
  #forming = new Set();

  /**
   * @param {object} [options] fallbacks for a species that states only some of
   *   its group biology; a species' own values always win (DOCS §8)
   * @param {number} [options.joinRadius] how close two animals found or join
   * @param {number} [options.maxMembers] hard cap on one group
   * @param {number} [options.minMembers] below this the record dissolves
   * @param {string} [options.leavingSex] which sex leaves its natal group at dispersal
   * @param {boolean} [options.inheritFromGuardian] whether young are born into their guardian's group
   * @param {boolean} [options.rejoinWhileDispersing] ⚠ `true` restores the A64 flapping — the measured control
   * @param {number} [options.dissolveGraceTicks] how long a record is held below `minMembers` before it dissolves (P5a, A56)
   * @param {boolean} [options.rallyEnabled] whether a separated member drifts back toward its band (P7)
   * @param {number} [options.rallyRange] beyond this the band is lost and no drift is written
   * @param {number} [options.rallyStrength] how hard the drift bends a fresh wander
   * @param {number} [options.leadWeight] how far a record's centre leans toward the animals it follows (P8)
   * @param {number} [options.updateInterval]
   */
  constructor({
    joinRadius = 6,
    maxMembers = 8,
    minMembers = 2,
    leavingSex = Sexes.MALE,
    inheritFromGuardian = true,
    rejoinWhileDispersing = false,
    dissolveGraceTicks = 0,
    rallyEnabled = false,
    rallyRange = 30,
    rallyStrength = 0.35,
    leadWeight = 0,
    updateInterval = 1,
  } = {}) {
    // Priority -8 in `decision`: after `SocialSystem` (-10) has settled this
    // tick's herd labels, and before `MigrationSystem` (-5) and the decision
    // system itself (0), so anything that later scores an action on "who is in
    // my clan" reads settled membership. Labels first, records second.
    super({ id: 'groups', phase: 'decision', priority: -8, updateInterval });
    this.joinRadius = joinRadius;
    this.maxMembers = maxMembers;
    this.minMembers = minMembers;
    this.leavingSex = leavingSex;
    this.inheritFromGuardian = inheritFromGuardian;
    // ⚠ A world-level switch rather than a species field, by the rule in DOCS §8:
    // a species block *beats* the config, so an "off" arm living in one cannot
    // switch anything off. `true` is the pre-2026-07-31 behaviour exactly, which
    // is what the A64 fix was measured against.
    this.rejoinWhileDispersing = rejoinWhileDispersing;
    // ⚠ World-level for the same reason as the line above, and **0 is the
    // identity**: the clock starts and expires on the same tick, which is the
    // pre-P5a engine exactly. The constructor default is 0 rather than the shipped
    // value so that a system built with no options is the old system — every test
    // that constructs one directly keeps meaning what it meant. `config.groups`
    // carries the number the demo actually runs on.
    this.dissolveGraceTicks = dissolveGraceTicks;
    // ⚠ The rally's **switch** is world-level and its **numbers** are per-species
    // fallbacks, exactly as `joinRadius` and `maxMembers` are: a switch inside a
    // species block could not switch anything off (DOCS §8), while a range and a
    // strength are biology a species may reasonably differ on. Default `false`
    // here rather than `true` so that a system constructed with no options is the
    // pre-P7 system — every test that builds one directly keeps meaning what it
    // meant, and `config.groups` carries what the demo actually runs on.
    this.rallyEnabled = rallyEnabled;
    this.rallyRange = rallyRange;
    this.rallyStrength = rallyStrength;
    // ⚠ **World-level, and 0 is the identity** (BEHAVIOR-PLAN P8, closing the seam
    // P7 left open). At 0 every member weighs exactly 1 and the centre below is the
    // plain mean P7 shipped — bit-for-bit, since the multiply is skipped entirely —
    // which is what makes it the reproducible control. The *age* half of leadership
    // is per-species (`behavior.leadAgeWeight`), because whether a society follows
    // its elders is biology; this is the machinery, so it lives outside a block by
    // the rule that a species block beats the config (DOCS §8).
    this.leadWeight = leadWeight;
  }

  update(world, context) {
    const forming = this.#formingSpecies(world);
    // The whole system in one branch when no species forms persistent groups,
    // which is every world today. Cheaper than an early-out per animal, and it
    // is what makes this step provably free.
    if (forming.size === 0) return;

    const registry = world.groups;

    // ── 1. Reconcile. The world is authoritative; the registry follows it.
    // Members leave for reasons this system never sees — starvation, predation,
    // removal after decay — so membership is filtered against the world rather
    // than unhooked at every death site, which is one place to be right instead
    // of six places to remember. `all()` returns a fresh ascending array, and
    // dissolutions are held back until the walk is over.
    const doomed = [];
    for (const record of registry.all()) {
      registry.prune(record.id, (memberId) => {
        const member = world.entities.get(memberId);
        return (
          member !== null &&
          member.kind === 'animal' &&
          member.alive &&
          // A member that has already been released (or was never really one)
          // is not in this group, whatever the roster says. The entity field
          // and the roster are written together, so a disagreement means the
          // roster is the stale copy.
          member.groupRecordId === record.id
        );
      });
      // ⚠⚠ **Dissolution is on a grace clock as of P5a, and that closes A56.**
      // `minMembers: 2` makes a pair a group and a lone animal not one, so a pair
      // that drifts apart used to dissolve the moment it separated and re-found on
      // meeting again — 157 foundings against 150 dissolutions in 3000 ticks on
      // seed 2. An identity that "survives separation" survived it for one tick.
      // Now a short record is *held*: `belowMinSince` starts the clock, and only a
      // record still short `dissolveGraceTicks` later is destroyed.
      //
      // ⚠ `markBelowMin` is idempotent, which is what makes this a delay rather
      // than a reprieve: a record that stays short must not restart its own clock
      // every tick, or it would never dissolve at all.
      //
      // ⚠ At `dissolveGraceTicks: 0` this is exactly the pre-P5a behaviour — the
      // clock starts and expires on the same tick — which is what makes 0 the
      // reproducible control rather than a special case in the code.
      if (record.memberIds.length < this.#paramsFor(world, record.speciesId).minMembers) {
        const since = registry.markBelowMin(record.id, context.tick);
        if (since !== null && context.tick - since >= this.dissolveGraceTicks) doomed.push(record.id);
      } else if (record.belowMinSince !== null) {
        // Back at strength: the clock stops, and a later separation starts a fresh
        // one. Gated on the field rather than called unconditionally so the common
        // path — a healthy record, every tick — writes nothing.
        registry.clearBelowMin(record.id);
      }
    }
    for (const id of doomed) this.#dissolve(world, registry, id, context);

    // ── 2. Decide, walking entities in ascending id (creation order). Founding
    // and joining take effect immediately, so a third animal arriving later in
    // the same pass joins the group the first two just founded rather than
    // founding a second one — the same live-tally discipline `SocialSystem`
    // needed for its size cap.
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      if (!forming.has(entity.speciesId)) continue;
      const groups = groupsOf(world.species.get(entity.speciesId));
      const params = this.#resolve(groups);

      // A membership whose record is gone (it dissolved while this animal was
      // elsewhere) is cleared here rather than left dangling. Ids are never
      // reused, so a stale id can only ever resolve to nothing.
      if (entity.groupRecordId !== null && registry.get(entity.groupRecordId) === null) {
        entity.groupRecordId = null;
      }

      if (entity.groupRecordId !== null) {
        if (this.#dispersingOut(entity, params, context.tick)) {
          const groupId = entity.groupRecordId;
          registry.leave(groupId, entity.id);
          entity.groupRecordId = null;
          this.#emitLeft(context, entity, groupId, registry.get(groupId)?.memberIds.length ?? 0, false);
        }
        continue;
      }

      // A dependent juvenile belongs to its guardian's group and to nothing
      // else — it does not found or join by proximity, because the animals it
      // is standing next to are its guardian's business, not its own.
      if (entity.guardianId !== null) {
        if (params.inheritFromGuardian) this.#inherit(world, registry, entity, params, context);
        continue;
      }

      // ⚠⚠ A64. The other half of leaving: an animal still walking out does not
      // attach to anything, so the group it just left cannot immediately take it
      // back. Deliberately *after* the guardian branch — inheritance is a
      // different rule about a dependent, and a dependent is not dispersing.
      // Once the window closes this predicate goes false and the animal joins
      // wherever it has arrived, which is what natal dispersal means.
      if (!this.rejoinWhileDispersing && this.#dispersingOut(entity, params, context.tick)) continue;

      this.#joinOrFound(world, context, registry, entity, params);
    }

    // ── 3. Reunion (P7). ⚠⚠ **A third pass, and the ordering is the whole of why
    // it is one.** A group's centre has to be derived from the membership this
    // tick actually settled on: derived before pass 1 it would include members who
    // died, and derived before pass 2 it would miss the animals that just joined —
    // in both cases pointing an animal at a record that no longer holds what it
    // thinks. Records dissolved in pass 1 are simply absent from the map.
    if (this.rallyEnabled) this.#rally(world, context, registry, forming);
  }

  /**
   * Derive every record's centre of mass, then point separated members at their
   * own (BEHAVIOR-PLAN P7 — reunion).
   *
   * ⚠⚠ **This is the group record's first consumer that moves an animal on its
   * own account**, and it is the half P2's band affinity structurally cannot do:
   * affinity re-weights neighbours, so it makes a band that is *together* stay
   * together and does nothing whatsoever for one that has scattered — there is
   * nobody left in range to weight. This is the other half.
   *
   * ⚠ **It writes a drift, never an action**, which is the `MigrationSystem`
   * pattern and the reason it is affordable: a fresh `wander` commitment is the one
   * heading in the whole engine that was going to be arbitrary, so bending it costs
   * nothing that was doing any work (§1.4 A34). A `rally` action would have to
   * compete with foraging, and four phases have now recorded what happens then.
   *
   * ✅ **It cannot fight P2's cohesion, and the reason is structural rather than
   * tuned.** `herd` is an *action*, chosen when there is a centroid worth steering
   * at; a rally only bends `wander`, which is what an animal does when nothing
   * better won. And the gate below is "no bandmate is contributing to my centroid",
   * so the rally fires exactly when the band is not part of what `herd` would aim
   * at. The two are disjoint by construction.
   */
  #rally(world, context, registry, forming) {
    const centres = world.groupCentres;
    centres.clear();
    // Bounded by `maxGroups`, and each record's member list by `maxMembers`, so
    // this is a small fixed walk rather than anything proportional to the world.
    for (const record of registry.all()) {
      // ⚠⚠ **Leadership weighting (BEHAVIOR-PLAN P8), the seam P7 left open on
      // purpose.** P7 derived this centre as a plain mean and said so, because
      // `leadershipOf` was P8's to add; this is the one multiply it wanted, in the
      // loop that was already here. A band's centre leans toward the animals it
      // would actually follow, so a separated member walks back toward *them*
      // rather than toward the arithmetic middle of everybody.
      //
      // ⚠ `w = 1 + leadWeight · score` with the score **normalized against the
      // strongest member of this record**, which is what makes `leadWeight: 0`
      // exactly 1 and every weight exactly 1 in a record of equals. Normalizing is
      // not tidiness: `leadershipOf` is `dominanceOf` scaled, and `dominanceOf` is
      // dominated by body mass, so a raw score would make a buffalo's weight ~600
      // and a gazelle's ~30 — the parameter would mean something different for
      // every species. Relative standing inside one band is the question, and it is
      // scale-free.
      //
      // ⚠ **Nothing is stored** (`world/GroupRegistry.js`: standing is derived,
      // never stored). There is no leader, no election, and no record of who led —
      // only a weight, recomputed from what each animal is right now. That is also
      // why the flicker `dominanceOf` lives with is affordable here: it moves a
      // centre by a hair rather than swapping the animal a band is following.
      const ageWeight = this.leadWeight > 0 ? leadAgeWeightOf(world.species.get(record.speciesId)) : 0;
      let best = 0;
      if (this.leadWeight > 0) {
        for (const memberId of record.memberIds) {
          const member = world.entities.get(memberId);
          if (!member || !member.alive) continue;
          const score = leadershipOf(member, ageWeight);
          if (score > best) best = score;
        }
      }
      let sumX = 0;
      let sumY = 0;
      let counted = 0;
      for (const memberId of record.memberIds) {
        const member = world.entities.get(memberId);
        if (!member || !member.alive) continue;
        // ⚠ `best > 0` guards the division; a record whose every member scores zero
        // (all dead-but-listed, or all impossibly frail) falls back to the plain
        // mean rather than to `0/0`, which would be a NaN centre and then a NaN
        // heading and then an animal parked outside every spatial query for good.
        const weight = best > 0 ? 1 + this.leadWeight * (leadershipOf(member, ageWeight) / best) : 1;
        sumX += member.x * weight;
        sumY += member.y * weight;
        counted += weight;
      }
      if (counted > 0) centres.set(record.id, { x: sumX / counted, y: sumY / counted });
    }

    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      // ⚠ Non-forming species are skipped rather than cleared, and that is safe
      // only because nothing ever writes these fields for them: they hold the
      // `createEntity` defaults for life. Every animal that *can* be written is
      // cleared first and then set, so a stale heading cannot outlive its tick —
      // the `entity.flying` lesson, applied in advance.
      if (!forming.has(entity.speciesId)) continue;
      entity.rallyHeading = null;
      entity.rallyStrength = 0;

      if (entity.groupRecordId === null) continue;
      const params = this.#resolve(groupsOf(world.species.get(entity.speciesId)));
      // ⚠⚠ **A disperser is left alone.** Dispersal "wins outright" at strength 0.9
      // and is the mechanism by which a young animal leaves home; a rally blended
      // onto it would drag it back toward the band it is walking out of, which is
      // A64 undone at the *movement* layer instead of the membership one.
      //
      // ⚠⚠ **`isDispersing`, deliberately, and NOT the `#dispersingOut` predicate
      // the membership rules use** — the first cut used that one and it was dead
      // code. `#dispersingOut` is dispersal *filtered by `leavingSex`*, and any
      // animal it answers true for has already left its record in the pass above,
      // so it never reaches this line at all. The animal that genuinely can be
      // dragged home is the one dispersal keeps: a dispersing **female** under the
      // default `leavingSex: 'male'` walks out of her natal range still holding her
      // membership. The two predicates ask different questions and only the raw one
      // is the question here.
      if (isDispersing(entity, context.tick)) continue;
      // ⚠ The gate, and it is deliberately read off the social summary rather than
      // measured again here: "is anybody from my band contributing to the centre I
      // am steering at?" A rally is for an animal whose answer is no. Two rules for
      // one question is D11, and a raw distance test here would be exactly that.
      // ⚠ No summary means no answer — sociality is staggered or absent — and the
      // honest response to that is to write nothing.
      const summary = world.social.get(entity.id);
      if (!summary || summary.bandmates > 0) continue;

      const centre = centres.get(entity.groupRecordId);
      if (!centre) continue;
      const dx = centre.x - entity.x;
      const dy = centre.y - entity.y;
      const distance = Math.hypot(dx, dy);
      // ⚠ Beyond the range the band is genuinely lost; at zero distance there is no
      // direction to give (`atan2(0, 0)` is a valid-looking heading due east, which
      // is how a whole band ends up marching east — the same trap `blendHeadings`
      // guards against internally).
      if (distance > params.rallyRange || distance < 1e-9) continue;
      // ⚠ The centre includes this animal's own position, which halves the pull it
      // feels and is the right trade: a per-member centre would be O(members²) per
      // record, and the two-member case converges either way.
      entity.rallyHeading = Math.atan2(dy, dx);
      entity.rallyStrength = params.rallyStrength;
    }
  }

  /**
   * Species ids that form persistent groups, cached against the registry they
   * were read from. Resolution is immutable per engine, so this is computed
   * once per world rather than per tick.
   */
  #formingSpecies(world) {
    if (this.#formingFrom !== world.species) {
      this.#formingFrom = world.species;
      this.#forming = new Set(world.species.all().filter((s) => groupsOf(s)?.forms).map((s) => s.id));
    }
    return this.#forming;
  }

  /**
   * A species' group parameters over this system's fallbacks.
   *
   * ⚠ A species' own value wins, which is the rule that inverted 23 tests when
   * the species schema landed (DOCS §8, D23). The constructor values are the
   * fallback for a species that states only `forms`, never an override of one
   * that states more.
   */
  #resolve(groups) {
    return {
      joinRadius: groups?.joinRadius ?? this.joinRadius,
      maxMembers: groups?.maxMembers ?? this.maxMembers,
      minMembers: groups?.minMembers ?? this.minMembers,
      leavingSex: groups?.leavingSex ?? this.leavingSex,
      inheritFromGuardian: groups?.inheritFromGuardian ?? this.inheritFromGuardian,
      rallyRange: groups?.rallyRange ?? this.rallyRange,
      rallyStrength: groups?.rallyStrength ?? this.rallyStrength,
    };
  }

  /** The same, by species id — used when reconciling a record rather than an animal. */
  #paramsFor(world, speciesId) {
    return this.#resolve(groupsOf(world.species.get(speciesId)));
  }

  /**
   * Whether this animal is **walking out of its natal group right now**. Natal
   * dispersal already exists as a bounded outward walk (`beginDispersal`, DOCS §9
   * Migration), so sex-biased dispersal needs no new state and no new clock: it
   * is that event, filtered by sex. `'none'` keeps everyone, `'both'` empties the
   * natal group of every disperser.
   *
   * ⚠⚠ **Read by both membership rules, and that is the whole of the A64 fix.**
   * It answers one question — "is this animal in the middle of leaving?" — and
   * the two consequences follow from the same answer: an attached animal leaves,
   * and an unattached one does not join. When only the first consequence existed,
   * this predicate stayed true for the entire dispersal window while the join
   * rule knew nothing about it, so the animal was expelled and re-admitted on
   * alternating ticks for 900 ticks. ⚠ Renamed from `#leavesAtDispersal` because
   * the old name described one of its two callers rather than the fact it states.
   */
  #dispersingOut(entity, params, tick) {
    const leaving = params.leavingSex;
    if (leaving === LEAVE_NOBODY) return false;
    if (!isDispersing(entity, tick)) return false;
    return leaving === LEAVE_EVERYONE || entity.sex === leaving;
  }

  /** Join the guardian's group, if it has one with room. */
  #inherit(world, registry, entity, params, context) {
    const guardian = world.entities.get(entity.guardianId);
    if (!guardian || !guardian.alive || guardian.speciesId !== entity.speciesId) return;
    if (guardian.groupRecordId === null) return;
    if (registry.join(guardian.groupRecordId, entity.id, params.maxMembers)) {
      entity.groupRecordId = guardian.groupRecordId;
      this.#emitJoined(context, entity, registry.get(guardian.groupRecordId), false);
    }
  }

  /**
   * ⚠ Emitted on the **transition**, never on the state — the discipline every
   * event in this engine follows (DOCS §11). Membership changes are rare by
   * construction (a group is joined once and left once), so these are milestone
   * events rather than a per-tick stream, and the renderer keeps them for as
   * long as it keeps births and deaths.
   */
  #emitJoined(context, entity, record, founded) {
    if (!record) return;
    context.emit(EventTypes.ENTITY_GROUPED, {
      entityId: entity.id,
      groupId: record.id,
      speciesId: record.speciesId,
      size: record.memberIds.length,
      founded,
    });
  }

  #emitLeft(context, entity, groupId, size, dissolved) {
    context.emit(EventTypes.ENTITY_UNGROUPED, { entityId: entity.id, groupId, size, dissolved });
  }

  /**
   * Join the nearest available group, or found one with an unattached
   * conspecific. Joining is preferred: a clan that accretes is one clan, while
   * a rule that only ever founds produces a scatter of pairs.
   */
  #joinOrFound(world, context, registry, entity, params) {
    const radius = params.joinRadius;
    const neighbours = this.#neighboursOf(world, context, entity, radius);

    let bestGroupId = null;
    let partnerId = null;
    for (let i = 0; i < neighbours.length; i += 2) {
      if (neighbours[i + 1] > radius) continue;
      const other = world.entities.get(neighbours[i]);
      if (!other || other.kind !== 'animal' || !other.alive) continue;
      if (other.speciesId !== entity.speciesId) continue;
      // A dependent is its guardian's, not a founding partner.
      if (other.guardianId !== null) continue;
      if (other.groupRecordId === null) {
        if (partnerId === null || other.id < partnerId) partnerId = other.id;
        continue;
      }
      const record = registry.get(other.groupRecordId);
      if (!record || record.memberIds.length >= params.maxMembers) continue;
      if (bestGroupId === null || record.id < bestGroupId) bestGroupId = record.id;
    }

    if (bestGroupId !== null) {
      if (registry.join(bestGroupId, entity.id, params.maxMembers)) {
        entity.groupRecordId = bestGroupId;
        this.#emitJoined(context, entity, registry.get(bestGroupId), false);
      }
      return;
    }
    if (partnerId === null) return;

    // ⚠ Founding can be refused: the store is bounded and full means full, not
    // "evict somebody". Both animals simply stay unattached and will try again
    // next tick, which is the same shape as `FeatureGrid` declining to track
    // new ground.
    const founded = registry.found(entity.speciesId, [entity.id, partnerId], context.tick);
    if (founded === null) return;
    entity.groupRecordId = founded.id;
    const partner = world.entities.get(partnerId);
    if (partner) partner.groupRecordId = founded.id;
    // `founded: true` on both, because a group beginning is one fact about two
    // animals rather than a join and a separate creation — there is no moment
    // at which the record exists with one member in it.
    this.#emitJoined(context, entity, founded, true);
    if (partner) this.#emitJoined(context, partner, founded, true);
  }

  /** Destroy a group and release whoever is left in it. */
  #dissolve(world, registry, groupId, context) {
    const record = registry.get(groupId);
    if (!record) return;
    for (const memberId of record.memberIds) {
      const member = world.entities.get(memberId);
      if (member && member.groupRecordId === groupId) {
        member.groupRecordId = null;
        // ⚠ `size: 0` and `dissolved: true` — the group is gone, so reporting
        // the roster it had a moment ago would describe something that no
        // longer exists. What survives is that this animal is out and the
        // group ended, which is the whole of what an observer can act on.
        this.#emitLeft(context, member, groupId, 0, true);
      }
    }
    registry.dissolve(groupId);
  }

  /**
   * The neighbours of `entity` within `radius`, as a flat `[id, distance, …]`
   * array in ascending-id order — from the perception system's walk when that is
   * usable, and from our own grid query when it is not.
   *
   * ⚠ **There is exactly one neighbour walk per tick and it is perception's**
   * (DOCS §9). Both conditions are checked rather than assumed: the buffer must
   * carry the current tick, since perception supports `updateInterval`, and its
   * radius must reach at least as far as ours — a longer list is safe because
   * everything past `radius` fails the distance gate above, a shorter one
   * silently drops neighbours.
   *
   * This is a copy of `SocialSystem#neighboursOf`, which DOCS §9 names as "the
   * helper to copy", and it is a copy on purpose: the alternative is threading
   * a shared helper through the per-animal loop of a system that sits next to
   * the hottest code in the engine, and D28 is what a small change to a hot
   * call signature costs. If a third consumer appears, extract it then and
   * re-baseline.
   *
   * @returns {number[]}
   */
  #neighboursOf(world, context, entity, radius) {
    if (world.neighbourhoodTick === context.tick) {
      const shared = world.neighbourhood.get(entity.id);
      // ⚠ The **neighbour** radius, not the perception radius (BEHAVIOR-PLAN P0) —
      // see the same note in `SocialSystem#neighboursOf`.
      if (shared !== undefined && (world.neighbourhoodRadius.get(entity.id) ?? 0) >= radius) {
        return shared;
      }
    }
    const ids = world.grid.queryRadius(entity.x, entity.y, radius);
    const neighbours = [];
    for (const otherId of ids) {
      if (otherId === entity.id) continue;
      const other = world.entities.get(otherId);
      if (!other || other.kind !== 'animal' || !other.alive) continue;
      neighbours.push(otherId, Math.hypot(other.x - entity.x, other.y - entity.y));
    }
    return neighbours;
  }
}
