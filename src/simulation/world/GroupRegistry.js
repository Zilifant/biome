/**
 * Persistent social groups (PLAN-SPECIES.md §3.8) — the **second** sociality
 * mechanism, and the one that remembers.
 *
 * ⚠ **This overrides a documented design decision, and it is meant to.** Since
 * Step 23 the answer to "who is in this herd" has been *nobody knows*: a herd is
 * a label propagated between neighbours, and DOCS §9 Sociality said plainly that
 * "nothing anywhere holds a membership list". That mechanism is **not deleted
 * and not weakened** — it still does what it is good at, and it is what every
 * loosely-aggregating species keeps using. What it cannot express is a group
 * whose identity **survives separation**: a lion pride, a hyena clan, a zebra
 * band, an elephant family. Those are not "who I happen to be standing with";
 * they are "who I belong to", and a positional label loses them the moment the
 * animals walk apart.
 *
 * So the two run side by side and model different things:
 *
 * | mechanism                  | models                              | state          |
 * | -------------------------- | ----------------------------------- | -------------- |
 * | herd label (`groupId`)     | fission–fusion aggregation          | a label, derived every tick by propagation |
 * | group record (this file)   | identity that survives separation   | a record, changed only by explicit joins and departures |
 *
 * ⚠ **They must never write each other's field.** `groupId` / `groupHops` belong
 * to `SocialSystem`; `groupRecordId` and this store belong to `GroupSystem`. That
 * is the state-ownership rule (DOCS §5), and here it is also what keeps the two
 * mechanisms honest — a registry that quietly rewrote herd labels would be a
 * roster pretending to be a label, which is the worst of both.
 *
 * **What a record holds, and what it deliberately does not:**
 *
 *   - `id` — monotonic, **never reused**, exactly as entity ids are not. A
 *     dissolved clan's id is not handed to the next one, so a stale reference
 *     (a carcass's last membership, a saved carcass possession later) can never
 *     resolve to the wrong group.
 *   - `speciesId` — a group is single-species. Heterospecific *association*
 *     (§3.16) is an attraction, not a membership, and stays a separate thing.
 *   - `memberIds` — ascending, always. Every collection in this engine iterates
 *     deterministically, and a membership list feeding cooperative behaviour is
 *     exactly the kind of thing that would otherwise make an outcome depend on
 *     who joined first.
 *   - `founderId` / `foundedTick` — facts about history, which is the only kind
 *     of thing worth storing that cannot be derived.
 *   - `belowMinSince` — the tick this record dropped below its species'
 *     `minMembers`, or null while it is at strength (BEHAVIOR-PLAN P5a, closing
 *     **A56**). ⚠ It is a *deadline*, not a state: nothing reads it except the
 *     reconcile pass that set it, and it exists because a pair that drifts apart
 *     and meets again was dissolving and re-founding — 157 foundings against 150
 *     dissolutions in 3000 ticks. Same shape as `alarmedUntil`, and the same
 *     reasoning: an identity that survives separation has to survive it for
 *     longer than a tick.
 *
 * ⚠ **No leader, and no rank.** The field sketch in the plan named a `leaderId`;
 * it is deliberately absent. DOCS §9 is explicit that "standing is derived, never
 * stored" — `dominanceOf` reads mass, condition, soundness, boldness, and
 * maturity on demand, so a rank you cannot lose by being hurt is a title rather
 * than a rank. A stored leader would be exactly that title. PLAN-SPECIES.md
 * §10.2 also puts rank-structured access out of scope for both prides and clans,
 * so this stores membership and nothing above it. When a consumer needs "the
 * dominant member", it walks `memberIds` (bounded, small) through `dominanceOf`.
 *
 * ⚠ **No centre either.** Where a group *is* changes every tick and is a pure
 * function of where its members are, so it is derived on read by whoever needs
 * it rather than cached into saved state where it could go stale — the same
 * judgement that keeps the home range as four numbers and the group summary in
 * a transient map.
 *
 * **Bounded, and it says so.** At most `maxGroups` records exist. When the store
 * is full a new group is simply **not founded** until one dissolves — a stated
 * limit in the same spirit as `forgotten` in the tombstone registry and the
 * untracked ground in `FeatureGrid`, and deliberately *not* an eviction: evicting
 * a live pride to make room for a new one would silently delete a group whose
 * members are all still walking around.
 *
 * Ownership: written only by `GroupSystem`. Persisted, because who belongs to
 * whom is evolved state that no seed can reproduce.
 */

/** Registry defaults. `maxGroups` is a world-level structural bound. */
export const DEFAULT_GROUP_REGISTRY_PARAMS = Object.freeze({
  maxGroups: 192,
});

/**
 * The persistent-group block of a species, or null if it declares none.
 *
 * The same shape as `migrationOf` and `territoryOf`: an always-per-species
 * field rather than a `SPECIES_BLOCKS` entry, because the section it would fall
 * back to also carries **world-level** parameters (the store bound, the
 * stagger), and a species inheriting those would be inheriting a knob it has no
 * business holding. A species that says nothing forms no persistent groups,
 * which is the right default — most animals do not.
 *
 * @param {object|null} species a resolved species record
 * @returns {object|null}
 */
export function groupsOf(species) {
  return species?.groups ?? null;
}

export class GroupRegistry {
  /** @type {Map<number, {id: number, speciesId: string, memberIds: number[], founderId: number|null, foundedTick: number}>} */
  #records = new Map();
  #nextId = 1;
  #maxGroups;

  /**
   * @param {object} [options]
   * @param {number} [options.maxGroups]
   */
  constructor({ maxGroups = DEFAULT_GROUP_REGISTRY_PARAMS.maxGroups } = {}) {
    this.#maxGroups = maxGroups;
  }

  /** How many groups exist right now. */
  get size() {
    return this.#records.size;
  }

  /** The structural bound, exposed so a caller can say "full" rather than guess. */
  get maxGroups() {
    return this.#maxGroups;
  }

  /** Whether the store can hold another record. */
  get full() {
    return this.#records.size >= this.#maxGroups;
  }

  /**
   * One group by id, or null. Treat the record as read-only: every mutation
   * goes through this class, which is what makes the ascending member order and
   * the size bound trustworthy (DOCS §10).
   * @param {number|null} id
   */
  get(id) {
    if (id === null || id === undefined) return null;
    return this.#records.get(id) ?? null;
  }

  /** Every group id, ascending. */
  ids() {
    return [...this.#records.keys()].sort((a, b) => a - b);
  }

  /**
   * Every group, in ascending id order — a fresh array, so a caller may found
   * or dissolve while walking it without iterating a collection it is changing.
   */
  all() {
    return this.ids().map((id) => this.#records.get(id));
  }

  /**
   * Found a group, or return null when the store is full.
   *
   * ⚠ Full means **refused**, never evicted. See the header: a bounded store
   * whose overflow policy is "delete a living group" trades a stated limit for a
   * silent one.
   *
   * @param {string} speciesId
   * @param {number[]} memberIds founding members (deduplicated and sorted here)
   * @param {number} tick
   * @returns {object|null} the new record, or null if the store is full
   */
  found(speciesId, memberIds, tick) {
    if (this.full) return null;
    const members = [...new Set(memberIds)].sort((a, b) => a - b);
    if (members.length === 0) return null;
    const record = {
      id: this.#nextId,
      speciesId,
      memberIds: members,
      // Who it started with. A historical fact, not a rank — see the header.
      founderId: members[0],
      foundedTick: tick,
      // At strength on the tick it is founded, by construction: `found` is only
      // ever called with enough members to be a group (P5a).
      belowMinSince: null,
    };
    this.#nextId += 1;
    this.#records.set(record.id, record);
    return record;
  }

  /**
   * Add a member, keeping the list ascending and inside `maxMembers`.
   * @param {number} groupId
   * @param {number} entityId
   * @param {number} maxMembers
   * @returns {boolean} whether the member was added
   */
  join(groupId, entityId, maxMembers) {
    const record = this.#records.get(groupId);
    if (!record || record.memberIds.length >= maxMembers) return false;
    const members = record.memberIds;
    // Sorted insert rather than push-then-sort: the list is small and bounded,
    // and keeping it ordered at every instant means no consumer can ever catch
    // it unsorted mid-tick.
    let at = members.length;
    for (let i = 0; i < members.length; i += 1) {
      if (members[i] === entityId) return false;
      if (members[i] > entityId) {
        at = i;
        break;
      }
    }
    members.splice(at, 0, entityId);
    return true;
  }

  /**
   * Remove a member.
   * @param {number} groupId @param {number} entityId
   * @returns {boolean} whether it was a member
   */
  leave(groupId, entityId) {
    const record = this.#records.get(groupId);
    if (!record) return false;
    const at = record.memberIds.indexOf(entityId);
    if (at === -1) return false;
    record.memberIds.splice(at, 1);
    return true;
  }

  /**
   * Drop every member the predicate rejects — how the registry follows the
   * world rather than the world following the registry. Members leave for
   * reasons this store cannot see (they died, they were removed, they were
   * released by their own system), so reconciliation is a filter rather than a
   * set of hooks every death path would have to remember to call.
   *
   * @param {number} groupId
   * @param {(entityId: number) => boolean} keep
   * @returns {number[]} the ids dropped, ascending
   */
  prune(groupId, keep) {
    const record = this.#records.get(groupId);
    if (!record) return [];
    const dropped = [];
    const kept = [];
    for (const id of record.memberIds) (keep(id) ? kept : dropped).push(id);
    if (dropped.length > 0) record.memberIds = kept;
    return dropped;
  }

  /**
   * Note that this group is short of its minimum, starting the grace clock if it
   * was not already running, and report the tick it dropped below (P5a, A56).
   *
   * ⚠ **Idempotent on purpose.** The reconcile pass runs every tick, so a record
   * that stays short must not keep resetting its own clock — that would be a
   * record that never dissolves rather than one that dissolves late, and the
   * difference is a leak. Calling this on a group that is already short returns
   * the *original* tick.
   *
   * @param {number} groupId @param {number} tick
   * @returns {number|null} the tick it dropped below, or null if there is no such group
   */
  markBelowMin(groupId, tick) {
    const record = this.#records.get(groupId);
    if (!record) return null;
    if (record.belowMinSince === null || record.belowMinSince === undefined) record.belowMinSince = tick;
    return record.belowMinSince;
  }

  /** Note that this group is back at strength, stopping the grace clock (P5a). */
  clearBelowMin(groupId) {
    const record = this.#records.get(groupId);
    if (record) record.belowMinSince = null;
  }

  /**
   * Destroy a group. The id is **not** reclaimed — `#nextId` only ever climbs —
   * so nothing that remembers this group can later be handed a different one.
   * @param {number} groupId
   * @returns {boolean} whether a group was destroyed
   */
  dissolve(groupId) {
    return this.#records.delete(groupId);
  }

  /**
   * Serializable plain data. Who belongs to whom is evolved state: it is the
   * accumulated record of which animals met, bred, and stayed together, and no
   * seed reproduces it.
   */
  serialize() {
    return {
      nextId: this.#nextId,
      // Ascending, like every other projected or persisted collection here, so
      // a save is a function of the state and not of the order groups happened
      // to be founded in.
      records: this.all().map((record) => ({ ...record, memberIds: [...record.memberIds] })),
    };
  }

  /** @param {ReturnType<GroupRegistry['serialize']>} saved */
  restore(saved) {
    this.#records = new Map();
    this.#nextId = saved?.nextId ?? 1;
    for (const record of saved?.records ?? []) {
      this.#records.set(record.id, {
        ...record,
        memberIds: [...record.memberIds],
        // ⚠ Defaulted rather than assumed present. A record serializes *whole*, so
        // a save written before P5a carries no `belowMinSince` at all — and
        // `undefined` would make `tick - undefined` NaN, which is never `>= grace`,
        // so that record would sit below its minimum **forever without
        // dissolving**. The save-format bump makes such a save unloadable anyway;
        // this is the belt beside those braces, and it costs one `??`.
        belowMinSince: record.belowMinSince ?? null,
      });
    }
  }
}
