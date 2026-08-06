/**
 * Herd movement consensus (BEHAVIOR-PLAN.md P8) — a shared directional commitment
 * carried by the herd **label**.
 *
 * Read `social/consensus.js` first: it holds the argument for why this exists, the
 * three-clause re-decision rule this file implements, why the strength structurally
 * cannot climb, and what could not be built as asked. This file is the accumulation.
 *
 * ⚠⚠ **This is the herd label's first behavioural consumer**, and DOCS §9 has said
 * it had none since 2026-07-30 — measured, not assumed. Everything social that
 * moves an animal until now reads *neighbours* (the centroid, `adults`, the alarm);
 * nothing anywhere read `groupId`.
 *
 * **Priority −3 in `decision`, and the slot is an argument.** `SocialSystem` (−10)
 * has settled this tick's labels, `GroupSystem` (−8) its records, and
 * `MigrationSystem` (−5) the drift this aggregates — so the consensus is built from
 * finished numbers — and `DecisionSystem` (0) is the only reader, so nothing
 * consumes a half-built one. ⚠ The invariant that makes the ordering matter is
 * stated rather than left implicit: **this system reads `migrationHeading` and must
 * never write it**, and `MigrationSystem` reads nothing of ours. Two systems, two
 * fields each, no shared writes (invariant: two systems never write one field).
 *
 * Ownership: writes `herdHeading`, `herdStrength`, `herdCommitUntil` and
 * `herdCommitLabel`. Reads `groupId`, the migration drift, dispersal state and the
 * species' `behavior.consensusWeight`.
 *
 * Randomness: **none at all** — not one draw on any stream, like migration and
 * groups, so this cannot shift another system's sequence even in principle.
 *
 * Cost: **one walk of the world, then two walks of the animals whose species declared
 * a weight** — no grid walk, no spatial query, and nothing allocated per animal (two
 * parallel arrays per tick, the shape `SocialSystem`'s per-tick maps already use).
 * The three passes cannot be fused and the reason is the rule rather than tidiness: a
 * member's fate depends on whether its label has a *standing* consensus, which is not
 * known until every committed member has been seen, and the fresh consensus is not
 * known until every free member has been. ⚠ A world in which no
 * species declares a weight pays **one `Map.size` comparison** for the whole system,
 * which is the early-out every social mechanism here ships with.
 *
 * ⚠⚠ **Persisted, unlike P7's rally fields, and the difference is the whole point.**
 * `GroupSystem` can leave `rallyHeading` transient because it is rewritten from
 * scratch before every read, within the same tick. A commitment is the opposite kind
 * of thing: it is *supposed* to outlive the cue that made it, so a restore that
 * dropped it would put a marching herd back on its individual noses and diverge from
 * an uninterrupted run. Hence `SAVE_FORMAT_VERSION` 33.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { isDispersing } from '../migration/migration.js';
import { consensusOf, consensusWeightsIn } from '../social/consensus.js';

/**
 * "This animal has no herd to agree with" — no label, or walking out of one.
 *
 * ⚠ A sentinel rather than `null` so the parallel array below stays numeric. Herd
 * labels are entity ids, which are positive and never reused, so `-1` cannot
 * collide with one.
 */
const NO_LABEL = -1;

export class HerdConsensusSystem extends SimulationSystem {
  /**
   * The species registry the weight map was built from, so the map is rebuilt
   * rather than silently describing the wrong roster if one system instance is ever
   * reused across worlds. The same guard `SocialSystem` and `GroupSystem` carry.
   * @type {object|null}
   */
  #weightsFrom = null;
  /** @type {Map<string, number>} */
  #weights = new Map();

  /**
   * @param {object} [options]
   * @param {number} [options.commitTicks] how long a member holds the herd's heading
   * @param {number} [options.maxStrength] hard cap on how far a consensus bends a wander
   * @param {number} [options.updateInterval] re-decision cadence (staggered)
   */
  constructor({ commitTicks = 60, maxStrength = 0.6, updateInterval = 5 } = {}) {
    super({ id: 'herd-consensus', phase: 'decision', priority: -3, updateInterval });
    this.commitTicks = commitTicks;
    this.maxStrength = maxStrength;
  }

  update(world, context) {
    const weights = this.#weightsFor(world);
    // The whole system in one comparison for a roster that asks for nothing, which
    // is every roster before this phase and most of this one after it.
    if (weights.size === 0) return;
    const tick = context.tick;

    // ── 1. Who can hold a consensus at all, and the standing consensus of each
    // label: the live commitments already in it. That standing answer is what a
    // **joiner** adopts, and it is what spreads a front through a herd that is
    // *growing* rather than only through one that decided together. It has to be
    // complete before pass 2, because whether a member re-decides depends on whether
    // its label already has an answer.
    //
    // ⚠ **Only this pass walks the world.** The two below walk the animals this one
    // kept, which for the shipped roster is the wildebeest and the buffalo and
    // nothing else — so a world where most animals declare nothing pays one entity
    // walk rather than three. The two arrays are the tick's only allocation, in the
    // shape `SocialSystem`'s per-tick maps already use; nothing is allocated per
    // animal.
    /** @type {object[]} */
    const members = [];
    /** @type {number[]} */
    const labels = [];
    /** @type {Map<number, {sumSin: number, sumCos: number, count: number}>} */
    const standing = new Map();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      if (!weights.has(entity.speciesId)) continue;
      // ⚠⚠ **The dispersal gate, and it is A64 at the movement layer.**
      // `MigrationSystem` writes a disperser's *outward* heading into
      // `migrationHeading` at `dispersalWeight: 0.9`, which "wins outright" — so an
      // ungated consensus would do two wrong things at once: pull the herd's heading
      // toward wherever its young happen to be walking out to, and then **replace
      // that young animal's dispersal heading with the herd's**, walking it straight
      // back into the herd it is leaving. P7 gated its rally on the same predicate
      // for the same reason, and the same warning applies to any test of it: the
      // animal a dispersal gate protects has to actually reach the gate.
      //
      // ⚠ `NO_LABEL` rather than null so the array stays a numeric one; a disperser
      // and an unlabelled animal are the same case here — nothing to agree with —
      // and both are cleared in pass 3 rather than skipped, or a stale heading would
      // outlive its tick (the `entity.flying` lesson).
      const label = entity.groupId !== null && !isDispersing(entity, tick) ? entity.groupId : NO_LABEL;
      members.push(entity);
      labels.push(label);
      if (label !== NO_LABEL && this.#committed(entity, label, tick)) {
        accumulate(standing, label, entity.herdHeading, entity.herdStrength);
      }
    }

    // ── 2. The fresh consensus of each label, from the members that are free to
    // re-decide: those whose commitment belongs to this label and has lapsed, plus
    // any joiner with no standing consensus to adopt.
    //
    // ⚠⚠ **Only from the migration cue, never from `herdStrength`.** There is no
    // path from a consensus back into a consensus, which is what makes "the strength
    // does not climb tick over tick" a structural guarantee rather than a tuning
    // result. See `social/consensus.js`.
    //
    // ⚠ The denominator counts every free member, not only the ones with a cue: an
    // animal with no reason to be going anywhere is a vote for staying put, and
    // counting only the movers would let one hungry animal march a satisfied herd
    // across the map at full strength.
    /** @type {Map<number, {sumSin: number, sumCos: number, count: number}>} */
    const fresh = new Map();
    for (let i = 0; i < members.length; i += 1) {
      const entity = members[i];
      const label = labels[i];
      if (label === NO_LABEL || this.#committed(entity, label, tick)) continue;
      if (entity.herdCommitLabel !== label && standing.has(label)) continue; // a joiner adopts
      accumulate(fresh, label, entity.migrationHeading, entity.migrationStrength);
    }

    // ── 3. Assign. Every animal this system can write is written or cleared on
    // every path — a field left alone on one branch outlives its tick, which is the
    // `entity.flying` lesson and the reason P7 clears before it sets.
    for (let i = 0; i < members.length; i += 1) {
      const entity = members[i];
      const label = labels[i];
      if (label === NO_LABEL) {
        // No label, or walking out of one: nothing to agree with. ⚠ The commitment
        // is dropped rather than frozen, so an animal that rejoins later arrives as
        // a joiner and adopts whatever that herd has decided since.
        clear(entity);
        continue;
      }
      // Clause 2: a live commitment is kept, untouched, whatever the cue now says.
      // This is the half that makes the consensus outlive the cue.
      if (this.#committed(entity, label, tick)) continue;

      // Clause 3 before clause 1: a member whose commitment belongs to *another*
      // label — or which has none at all — takes what this herd has already decided,
      // and only falls back to deciding when there is nothing to take. ⚠ The
      // standing strength is copied verbatim and **not** re-multiplied by the
      // species weight: the animals it came from were already charged for it, and
      // charging twice is how a herd ratchets itself up to the cap.
      const adopted = entity.herdCommitLabel !== label ? resolve(standing, label) : null;
      const decided = adopted ?? this.#decide(fresh, label, weights.get(entity.speciesId));
      if (decided === null) {
        clear(entity);
        continue;
      }
      entity.herdHeading = decided.heading;
      entity.herdStrength = decided.strength;
      entity.herdCommitUntil = tick + this.commitTicks;
      entity.herdCommitLabel = label;
    }
  }

  /**
   * Whether this animal is holding a live commitment **made in this label**.
   *
   * ⚠⚠ Both halves matter and the second is the one that is easy to drop. A live
   * ttl alone would make an animal that walked from one herd into another keep the
   * heading its old herd agreed on until the ttl ran out, and the label it is
   * standing in would never reach it — which is exactly the clause `herdCommitLabel`
   * exists for. See `social/consensus.js`.
   */
  #committed(entity, label, tick) {
    return (
      entity.herdCommitLabel === label &&
      entity.herdCommitUntil !== null &&
      tick < entity.herdCommitUntil &&
      entity.herdHeading !== null
    );
  }

  /**
   * The fresh consensus of a label, priced at this species' weight and capped.
   *
   * ⚠ `consensusOf` returns null rather than a heading when the cues cancelled —
   * `Math.atan2(0, 0)` is a valid-looking heading due east — so a herd that could
   * not agree gets **no consensus** and every member falls back to its own nose.
   */
  #decide(fresh, label, weight) {
    const consensus = resolve(fresh, label);
    if (consensus === null) return null;
    const strength = Math.min(this.maxStrength, consensus.strength * weight);
    // A strength of zero is not a commitment, it is a wander; committing to one
    // would suppress the migration drift it replaces for `commitTicks` and steer
    // by nothing at all.
    if (!(strength > 0)) return null;
    return { heading: consensus.heading, strength };
  }

  /**
   * The consensus weight of every species in this world that declares one, keyed by
   * id — empty when nobody does, which is the one `Map.size` comparison the whole
   * mechanism costs such a world. Cached against the registry it was read from, for
   * the same reason `SocialSystem`'s four maps are: the registry is per-world.
   */
  #weightsFor(world) {
    const registry = world.species ?? null;
    if (this.#weightsFrom !== registry) {
      this.#weightsFrom = registry;
      this.#weights = consensusWeightsIn(registry);
    }
    return this.#weights;
  }
}

/**
 * Add one strength-weighted heading to a label's resultant.
 *
 * ⚠ A contributor with no heading or no strength still raises `count`. That is the
 * denominator decision stated in pass 2: no cue is a vote, not an abstention.
 */
function accumulate(byLabel, label, heading, strength) {
  let sums = byLabel.get(label);
  if (sums === undefined) {
    sums = { sumSin: 0, sumCos: 0, count: 0 };
    byLabel.set(label, sums);
  }
  sums.count += 1;
  if (heading === null || !(strength > 0)) return;
  sums.sumSin += Math.sin(heading) * strength;
  sums.sumCos += Math.cos(heading) * strength;
}

/** A label's accumulated resultant as a heading and a strength, or null. */
function resolve(byLabel, label) {
  const sums = byLabel.get(label);
  if (sums === undefined) return null;
  return consensusOf(sums.sumSin, sums.sumCos, sums.count);
}

/** Drop a commitment entirely, on every path that does not renew one. */
function clear(entity) {
  entity.herdHeading = null;
  entity.herdStrength = 0;
  entity.herdCommitUntil = null;
  entity.herdCommitLabel = null;
}
