/**
 * Domain event contract.
 *
 * Events describe simulation facts ("an entity died"), never presentation
 * ("play death animation"). Glyphs, colors, sounds, and animations are the
 * renderer's own mapping from these facts.
 *
 * Every event has: { seq, tick, type, ...payload }. `seq` is a global,
 * gap-free sequence number; consumers use it to request "events since".
 */
import { PROTOCOL_VERSION } from './protocolVersion.js';

export const EventTypes = Object.freeze({
  ENTITY_CREATED: 'entity.created', // { entityId, kind, speciesId, x, y }
  ENTITY_MOVED: 'entity.moved', //     { entityId, from: {x, y}, to: {x, y} }
  ENTITY_DIED: 'entity.died', //       { entityId, cause }
  ENTITY_REMOVED: 'entity.removed', // { entityId }
  ENTITY_FED: 'entity.fed', //         { entityId, cell: {cellX, cellY}, amount }
  ENTITY_MATED: 'entity.mated', //     { entityId, partnerId, gestationUntil, quality }
  ENTITY_BORN: 'entity.born', //       { entityId, parents: [id, id], sex }
  // Mate choice (Step 22). One assessment: who was looked over, how good they
  // scored, the standard they were held to, and which way it went. Rejections
  // are reported too — "she sized him up and walked on" is a behaviour, and
  // reporting only the successes would make choice invisible. The threshold is
  // published alongside the quality for the same reason `entity.hunted`
  // publishes its odds: the outcome should be checkable, not taken on trust.
  ENTITY_COURTED: 'entity.courted', // { entityId, candidateId, quality, threshold, accepted }
  ENTITY_PROVISIONED: 'entity.provisioned', // { entityId, guardianId, amount }
  // Predation (Step 16). `entity.hunted` reports one capture attempt and the
  // odds it was made at, so an observer can see that a hunt is resolved from
  // the two animals' state rather than a flat roll; `escaped` and `killed`
  // report which way it went (a kill also emits `entity.died` with cause
  // `predation`).
  ENTITY_HUNTED: 'entity.hunted', //   { entityId, targetId, chance, captured }
  ENTITY_ESCAPED: 'entity.escaped', // { entityId, predatorId }
  ENTITY_KILLED: 'entity.killed', //   { entityId, predatorId }
  // Injury (Step 17). A wound that does not kill still costs the animal speed,
  // feeding, and — because hunting reads condition — safety.
  ENTITY_INJURED: 'entity.injured', //     { entityId, injury, severity, sourceId }
  ENTITY_RECOVERED: 'entity.recovered', // { entityId, injury }
  // Decay (Step 18). A carcass announces each stage it passes through; when it
  // is finally gone the usual `entity.removed` follows.
  ENTITY_DECAYED: 'entity.decayed', // { entityId, stage, stageName, edibleMass }
  // The turning year (Step 19; wet/dry since SEASON-PLAN.md D1). World-level
  // rather than per-entity, and emitted only when the season, the phase or the
  // weather actually changes — temperature drifts every tick and would flood the
  // log. ⚠ The **phase** is on it because a season is two phases: `wetEarly →
  // wetLate` changes what the grass does without changing the season's name.
  ENVIRONMENT_CHANGED: 'environment.changed', // { season, phase, weather, temperature, previousSeason, previousPhase, previousWeather }
  // Sociality (Step 23). `alarmed` fires on the *transition* into panic only —
  // a herd of twenty in view of a predator would otherwise emit twenty events a
  // tick for as long as it stayed in view. `sourceId` is null when the animal
  // saw the threat with its own eyes rather than being told by a neighbour,
  // which is what lets an observer watch a wave of alarm cross a herd.
  ENTITY_ALARMED: 'entity.alarmed', //   { entityId, sourceId, x, y }
  // A dominance contest. There are no odds to report because there is no roll:
  // the stronger animal wins. What is reported is *why* — both scores — and
  // whether it escalated into an actual fight rather than a yield.
  ENTITY_CONTESTED: 'entity.contested', // { entityId, opponentId, winnerId, dominance, opponentDominance, escalated, injured }
  // Two residents and one piece of ground (Step 24). Like `entity.contested`
  // there are no odds — dominance decides it — so both scores are reported
  // instead, plus how much ground actually changed hands, which is the part an
  // observer would otherwise have no way to see.
  ENTITY_DISPUTED: 'entity.disputed', // { entityId, ownerId, winnerId, dominance, ownerDominance, escalated, cellsTransferred }
  // An adult putting itself between a predator and a groupmate or its own young.
  ENTITY_DEFENDED: 'entity.defended', // { entityId, wardId, threatId }
  // Kleptoparasitism (v29): one carnivore takes a carcass off another. Same
  // family as the two contests above and reported the same way — no odds,
  // because dominance decides it, so both scores are published instead.
  //
  // ⚠ There is no `winnerId`: the challenger only ever challenges when it is
  // already stronger, so the winner is always `entityId`. Reporting a field that
  // can only hold one value would be noise dressed as information.
  //
  // ⚠ It is deliberately **not** `entity.contested`, though the payload is
  // nearly identical. That type means "contested a mate" to every consumer that
  // has one — the renderer labels it exactly that — so reusing it would have
  // kept the protocol version and made the UI lie, which is the specific thing
  // this bump exists to stop.
  ENTITY_ROBBED: 'entity.robbed', // { entityId, victimId, carcassId, dominance, victimDominance, escalated, injured }
  // Persistent social groups (v29; see world/GroupRegistry.js). ⚠ Not the herd
  // label — that is positional and rides in every snapshot as `groupId`. These
  // are the *record*: an identity that survives separation, which is what a
  // pride or a clan is. `founded` marks the join that created the group and
  // `dissolved` the departure that ended it, so an observer can see a clan begin
  // and end rather than inferring it from a membership number changing.
  ENTITY_GROUPED: 'entity.grouped', //   { entityId, groupId, speciesId, size, founded }
  ENTITY_UNGROUPED: 'entity.ungrouped', // { entityId, groupId, size, dissolved }
  // Disease (Step 25). `infected` names the animal it came from, which is what
  // makes a transmission chain traceable; note it fires while the new carrier
  // still looks perfectly healthy, because an incubating animal is infectious
  // and invisible. `sickened` is the moment symptoms appear — the first point
  // at which anything else can react — and `cured` reports how long the
  // immunity lasts. A death from it arrives as the usual `entity.died` with
  // cause `disease`.
  ENTITY_INFECTED: 'entity.infected', // { entityId, sourceId }
  ENTITY_SICKENED: 'entity.sickened', // { entityId }
  ENTITY_CURED: 'entity.cured', //      { entityId, immuneUntil }
  // An animal has moved house (Step 26) — its *home range* has shifted a full
  // range radius from where it last lived, which is a different claim from "it
  // walked a long way" and the reason this is reported on the range rather than
  // on position. Rare by construction, so it costs the event budget almost
  // nothing (§1.4 C3). `reason` says which drive did it: `dispersal` for a
  // juvenile still holding its outward heading, `forage` for an adult that
  // followed the grass.
  ENTITY_MIGRATED: 'entity.migrated', // { entityId, from: {x,y}, to: {x,y}, distance, reason }
  // Local disturbances (Step 27). Two events, one at each end, because a
  // disturbance is a *region over a span of ticks* and both boundaries matter:
  // `disturbed` says where it is and when it will stop, `settled` says how long
  // it actually lasted — the one fact an observer cannot reconstruct once the
  // record is gone. Nothing is emitted per tick while it burns; the region rides
  // in every snapshot instead, so a running disturbance costs the event budget
  // exactly two events for its whole life (§1.4 C3).
  ENVIRONMENT_DISTURBED: 'environment.disturbed', // { disturbanceId, kind, x, y, radius, until }
  ENVIRONMENT_SETTLED: 'environment.settled', //    { disturbanceId, kind, x, y, radius, durationTicks }
  // A cell became — or stopped being — something animals made (Step 28).
  // Emitted only on the *transition*: this layer is written by every moving
  // animal every tick, so anything else would swamp the outbox (§1.4 C3). The
  // features themselves ride in snapshots, gated on a revision that only moves
  // when the promoted set changes.
  ENVIRONMENT_FEATURE: 'environment.feature', // { cellX, cellY, kind, state: 'formed' | 'lost' }
  // A milestone in one animal's life history. `event` is a life-event type
  // (weaned | dispersed | orphaned); consumers must tolerate unknown ones.
  // `dispersed` additionally carries the natal centre the animal is leaving
  // (`x`, `y`), which is what makes dispersal checkable as a spatial fact
  // rather than only a bookkeeping one.
  ENTITY_LIFE_EVENT: 'entity.lifeEvent', //    { entityId, event, guardianId, x?, y? }
});

/**
 * Wrap a list of domain events in a versioned batch message.
 * @param {object[]} events
 * @param {object} [meta]
 * @param {string|null} [meta.simulationId]
 * @param {number|null} [meta.tick] tick at which the batch was produced
 */
export function buildEventBatch(events, { simulationId = null, tick = null } = {}) {
  const cloned = events.map((event) => structuredClone(event));
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'events.batch',
    simulationId,
    tick,
    firstSeq: cloned.length > 0 ? cloned[0].seq : null,
    lastSeq: cloned.length > 0 ? cloned[cloned.length - 1].seq : null,
    events: cloned,
  };
}
