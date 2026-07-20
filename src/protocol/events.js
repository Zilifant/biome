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
  // The turning year (Step 19). World-level rather than per-entity, and emitted
  // only when the season or the weather actually changes — temperature drifts
  // every tick and would flood the log.
  ENVIRONMENT_CHANGED: 'environment.changed', // { season, weather, temperature, previousSeason, previousWeather }
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
