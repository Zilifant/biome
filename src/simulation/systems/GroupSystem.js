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
 * Ownership: writes `entity.groupRecordId` and `world.groups`. Reads positions,
 * species, `guardianId`, `sex`, dispersal state, and the shared neighbourhood
 * buffer. ⚠ It never touches `groupId` or `groupHops` — those are
 * `SocialSystem`'s, and two systems must never write the same field.
 * Randomness: **none at all**, like migration and engineering, so this cannot
 * shift another system's stream even in principle.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { groupsOf } from '../world/GroupRegistry.js';
import { isDispersing } from '../migration/migration.js';
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
   * @param {number} [options.updateInterval]
   */
  constructor({
    joinRadius = 6,
    maxMembers = 8,
    minMembers = 2,
    leavingSex = Sexes.MALE,
    inheritFromGuardian = true,
    rejoinWhileDispersing = false,
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
      if (record.memberIds.length < this.#paramsFor(world, record.speciesId).minMembers) doomed.push(record.id);
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
      if (shared !== undefined && (world.perception.get(entity.id)?.radius ?? 0) >= radius) {
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
