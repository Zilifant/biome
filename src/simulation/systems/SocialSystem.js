/**
 * Sociality (Step 23) — herds, and the alarm that runs through one.
 *
 * Two jobs, both done from a single grid-local neighbour query per animal, and
 * neither of them building anything per-*pair* (invariant 17 and the risk
 * register's "quadratic neighbour searches" row both forbid it):
 *
 *   1. **Group membership.** Animals in sight of each other converge on a
 *      shared `groupId` by local label propagation: adopt the smallest group id
 *      among your conspecific neighbours, or found one on your own id if nobody
 *      near you has one. Nothing anywhere holds a roster — a group is just a
 *      label that spreads, which is why this stays O(neighbours) and why groups
 *      can form, merge, and dissolve without a single structural operation.
 *
 *      Every label also carries its **distance in hops from the animal whose id
 *      it is** — its root — and is only accepted within `maxGroupHops`. That is
 *      not a size limit (`maxGroupSize` is); it is what makes a herd able to
 *      *split*. Plain "take the smallest label you can see" only ever moves
 *      labels downward, so when a herd tears in half the piece without the root
 *      keeps the old label forever and two herds on opposite sides of the map
 *      stay nominally one. With hop counts, the orphaned half has no route back
 *      to a root, its hop counts climb by one a tick until they exceed the cap,
 *      and it re-founds on its own. Merging still works because a real root is
 *      reachable from both sides. It is the same trick as the alarm below, and
 *      for the same reason: a local mechanism needs a bound to stay local.
 *
 *   2. **Alarm.** An animal that can actually see a predator panics on its own
 *      (that is the decision system's `flee`). This propagates that panic to
 *      the ones that *cannot* see it: a neighbour of a fleeing or alarmed
 *      animal becomes alarmed too, and carries the direction the threat was in.
 *      Because it moves one neighbour-hop per tick, a wave visibly crosses a
 *      herd over several ticks instead of the whole population reacting at
 *      once.
 *
 *      Each alarm carries the **number of hops** it has travelled from whoever
 *      actually saw something, and stops at `maxAlarmHops`. That counter is not
 *      decoration — without it the thing is a chain reaction rather than a
 *      wave: alarmed animals re-alarm the neighbours who alarmed them, the
 *      panic never runs out of fuel, and it spreads to the whole population and
 *      stays there. It did, on the first cut — 106 of 119 grazers permanently
 *      fleeing. A bounded hop count makes "local" a property of the mechanism
 *      rather than a hope about population density, and it is exactly what the
 *      demonstration scenario pins.
 *
 * The group *summary* each animal gets — how many groupmates are in range, how
 * many are adults, where their centre of mass is, which way they are heading —
 * is transient, rebuilt every tick into `world.social`, exactly like
 * `world.perception`. Nothing about a group is stored except the label.
 *
 * Runs in the `decision` phase at priority -10, ahead of the decision system
 * (priority 0) which consumes the summary to score `herd` and `defend`, and
 * ahead of anything that reads alarm state. Ownership: writes `groupId`,
 * `alarmedUntil`, `alarmSource`, and `world.social`; reads positions, headings,
 * life stages, and the perception summary. No randomness.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';

export class SocialSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.groupRadius] how far conspecifics recognize each other as groupmates
   * @param {number} [options.maxGroupSize] hard cap on a herd, so one label cannot swallow the world
   * @param {number} [options.alarmRadius] how far panic carries per hop
   * @param {number} [options.alarmTicks] how long an animal stays alarmed after being told
   * @param {number} [options.maxGroupHops] neighbour-hops a herd label survives from its root
   * @param {number} [options.maxAlarmHops] neighbour-hops a warning survives from the sighting
   * @param {number} [options.minGroupSize] neighbours needed before founding a group
   * @param {number} [options.updateInterval]
   */
  constructor({
    groupRadius = 6,
    maxGroupSize = 12,
    maxGroupHops = 3,
    alarmRadius = 6,
    alarmTicks = 25,
    maxAlarmHops = 2,
    minGroupSize = 2,
    updateInterval = 1,
  } = {}) {
    super({ id: 'social', phase: 'decision', priority: -10, updateInterval });
    this.groupRadius = groupRadius;
    this.maxGroupSize = maxGroupSize;
    this.maxGroupHops = maxGroupHops;
    this.alarmRadius = alarmRadius;
    this.alarmTicks = alarmTicks;
    this.maxAlarmHops = maxAlarmHops;
    this.minGroupSize = minGroupSize;
  }

  update(world, context) {
    const social = world.social;
    social.clear();

    // One O(N) tally of how big each label currently is, so the size cap can be
    // enforced without anyone holding a membership list. A running count keyed
    // by label is not a pairwise structure — it is one integer per group.
    /** @type {Map<number, number>} */
    const groupSizes = new Map();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive || entity.groupId === null) continue;
      groupSizes.set(entity.groupId, (groupSizes.get(entity.groupId) ?? 0) + 1);
    }

    // Alarm is read from the state at the *start* of the tick and written into
    // a staging map, so panic spreads exactly one hop per tick regardless of
    // entity iteration order. Writing straight to the entity would let an alarm
    // race down the id ordering and cross the whole herd in a single tick,
    // which is precisely the global effect this is supposed not to have.
    /** @type {Map<number, {x: number, y: number, sourceId: number|null, hops: number}>} */
    const raised = new Map();

    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      const radius = Math.max(this.groupRadius, this.alarmRadius);
      let groupmates = 0;
      let adults = 0;
      let sumX = 0;
      let sumY = 0;
      let sumSin = 0;
      let sumCos = 0;
      let nearestMate = Infinity;
      // Every animal can always found a herd on its own id, at zero hops from
      // itself. Seeding from the *id* rather than from the label it happens to
      // be carrying is what lets an orphaned half of a split herd escape the
      // old label instead of inheriting it forever.
      let label = entity.id;
      let labelHops = 0;
      /** @type {{x: number, y: number, sourceId: number|null, hops: number} | null} */
      let alarmFrom = null;

      for (const otherId of world.grid.queryRadius(entity.x, entity.y, radius)) {
        if (otherId === entity.id) continue;
        const other = world.entities.get(otherId);
        if (!other || other.kind !== 'animal' || !other.alive) continue;
        if (other.speciesId !== entity.speciesId) continue;
        const distance = Math.hypot(other.x - entity.x, other.y - entity.y);

        if (distance <= this.groupRadius) {
          groupmates += 1;
          if (other.lifeStage === 'adult' || other.lifeStage === 'senescent') adults += 1;
          sumX += other.x;
          sumY += other.y;
          sumSin += Math.sin(other.heading);
          sumCos += Math.cos(other.heading);
          if (distance < nearestMate) nearestMate = distance;
          // Label propagation: the smallest id in sight wins, which makes merges
          // symmetric — both herds reach the same answer without negotiating.
          // A label is only worth taking if its root is still reachable within
          // `maxGroupHops`; that is the check a split fails. The size cap is
          // checked against a *live* tally (see below), so a rush of animals
          // joining in one tick cannot collectively overshoot it.
          if (other.groupId !== null) {
            const hops = (other.groupHops ?? 0) + 1;
            const better = other.groupId < label || (other.groupId === label && hops < labelHops);
            if (hops <= this.maxGroupHops && better) {
              const size = groupSizes.get(other.groupId) ?? 0;
              if (size < this.maxGroupSize || other.groupId === entity.groupId) {
                label = other.groupId;
                labelHops = hops;
              }
            }
          }
        }

        // Panic carries from anyone already running or already frightened — but
        // always by the *shortest* route back to whoever actually saw the
        // threat, so the hop count measures real distance from the sighting
        // rather than however the warning happened to arrive.
        if (distance <= this.alarmRadius) {
          const perceived = world.perception.get(otherId);
          const theirThreat = perceived?.nearestThreat ?? null;
          let candidate = null;
          if (theirThreat) {
            // It can see the predator itself: this is a first-hand report.
            candidate = { x: theirThreat.x, y: theirThreat.y, sourceId: other.id, hops: 1 };
          } else if (other.alarmedUntil !== null && context.tick < other.alarmedUntil && other.alarmSource) {
            const hops = (other.alarmSource.hops ?? 0) + 1;
            if (hops <= this.maxAlarmHops) {
              candidate = { x: other.alarmSource.x, y: other.alarmSource.y, sourceId: other.id, hops };
            }
          }
          if (candidate && (alarmFrom === null || candidate.hops < alarmFrom.hops)) alarmFrom = candidate;
        }
      }

      // An animal that can see the predator itself does not need telling, and
      // its own sighting is better information than a neighbour's.
      const ownThreat = world.perception.get(entity.id)?.nearestThreat ?? null;
      if (ownThreat) {
        raised.set(entity.id, { x: ownThreat.x, y: ownThreat.y, sourceId: null, hops: 0 });
      } else if (alarmFrom) {
        raised.set(entity.id, alarmFrom);
      }

      // Found a label only when there is actually a group to be in; a lone
      // animal is not a herd of one.
      const groupId = groupmates < this.minGroupSize ? null : label;
      entity.groupHops = groupId === null ? null : labelHops;
      // Keep the tally live as labels change, so the cap holds within the tick
      // as well as across ticks. The first cut checked a snapshot taken before
      // the loop and let a herd of 23 form against a cap of 12, because a dozen
      // animals all joined the same under-cap group in the same pass.
      if (groupId !== entity.groupId) {
        if (entity.groupId !== null) {
          const previous = (groupSizes.get(entity.groupId) ?? 1) - 1;
          if (previous > 0) groupSizes.set(entity.groupId, previous);
          else groupSizes.delete(entity.groupId);
        }
        if (groupId !== null) groupSizes.set(groupId, (groupSizes.get(groupId) ?? 0) + 1);
      }
      entity.groupId = groupId;

      world.social.set(entity.id, {
        groupId,
        groupmates,
        adults,
        // The local centre of mass and mean heading — the two signals herding
        // needs. Null when alone, so the decision system has nothing to steer at.
        centroid: groupmates > 0 ? { x: sumX / groupmates, y: sumY / groupmates } : null,
        heading: groupmates > 0 ? Math.atan2(sumSin / groupmates, sumCos / groupmates) : null,
        nearestDistance: groupmates > 0 ? nearestMate : null,
      });
    }

    this.#applyAlarms(world, context, raised);
  }

  /**
   * Commit the staged alarms. Emitting only on the *transition* into alarm
   * keeps a herd of twenty from producing twenty events a tick for as long as
   * the predator is in view — the same discipline Step 22's courtship events
   * needed (§1.4 C3).
   */
  #applyAlarms(world, context, raised) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const alarm = raised.get(entity.id);
      if (!alarm) {
        if (entity.alarmedUntil !== null && context.tick >= entity.alarmedUntil) {
          entity.alarmedUntil = null;
          entity.alarmSource = null;
        }
        continue;
      }
      const wasAlarmed = entity.alarmedUntil !== null && context.tick < entity.alarmedUntil;
      entity.alarmedUntil = context.tick + this.alarmTicks;
      entity.alarmSource = { x: alarm.x, y: alarm.y, hops: alarm.hops };
      if (!wasAlarmed) {
        context.emit(EventTypes.ENTITY_ALARMED, {
          entityId: entity.id,
          // null ⇒ it saw the threat itself rather than being told.
          sourceId: alarm.sourceId,
          hops: alarm.hops,
          x: alarm.x,
          y: alarm.y,
        });
      }
    }
  }
}
